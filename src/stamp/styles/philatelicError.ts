import type { Palette } from "../palettes";
import { pick, stream } from "../random";
import type { Style } from "../sources";

// Philatelic error: an engraved two-plate stamp printed wrong, like the Inverted Jenny. The frame plate prints
// a border with reversed-out lettering and value circles around a window. The center plate prints a vignette
// in that window: a biplane, lighthouse, sailing ship, steamship, balloon or locomotive, shaded with engraved
// lines. The seed rolls one error from a weighted table (see ERRORS): a shifted center plate, a missing ink, a
// plate printed twice, a paper fold, or the rare inverted center. About 1 in 20 prints perfect.
//
// Like land1 it computes every pixel itself from positions in art units (the art's short side is 1), so it is
// resolution independent and its pixels match in every browser and in Node, which the golden test relies on
// (ADR 0001). Only IEEE-exact arithmetic here: no Math.sin, Math.pow or the like. Shapes are signed distance
// functions, so each edge's antialiasing comes from the distance to it.

type Rgb = [number, number, number];
type Pt = [number, number];

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
// How much of a sample `px` wide a shape covers, from the signed distance to its edge at the sample's center.
const cover = (d: number, px: number) => clamp01(0.5 - d / px);

// A unit vector in a random direction.
function direction(rand: () => number): Pt {
  for (;;) {
    const [x, y] = [rand() - 0.5, rand() - 0.5];
    const r = Math.sqrt(x * x + y * y);
    if (r > 0.05 && r < 0.5) return [x / r, y / r];
  }
}

// Smooth 1D value noise in [0, 1] from a table of seeded values, one lattice cell per unit.
function noise1(rand: () => number): (x: number) => number {
  const table = Array.from({ length: 64 }, rand);
  return (x) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = table[i & 63];
    return a + (table[(i + 1) & 63] - a) * f * f * (3 - 2 * f);
  };
}

// Cumulative ink, from 0 to `t`, of horizontal lines `frac` of each gap `g` wide, centered in each gap.
function stripes(t: number, g: number, frac: number): number {
  const k = Math.floor(t / g);
  const h = frac * g;
  const r = t - k * g - (g - h) / 2;
  return k * h + (r < 0 ? 0 : r > h ? h : r);
}
// How much of a sample `px` tall at `y` those lines cover. Exact at any size, so lines finer than a pixel
// average to their true tone rather than aliasing.
const lines = (y: number, px: number, g: number, frac: number) =>
  frac <= 0
    ? 0
    : (stripes(y + px / 2, g, frac) - stripes(y - px / 2, g, frac)) / px;

// A piece of a shape: its signed distance (negative inside) and its bounds.
type Piece = {
  d: (x: number, y: number) => number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

function circle(cx: number, cy: number, r: number): Piece {
  return {
    d: (x, y) => {
      const [dx, dy] = [x - cx, y - cy];
      return Math.sqrt(dx * dx + dy * dy) - r;
    },
    x0: cx - r,
    y0: cy - r,
    x1: cx + r,
    y1: cy + r,
  };
}

// An axis-aligned ellipse, by Quilez's approximation, which is close to the true distance near the edge.
function ellipse(cx: number, cy: number, rx: number, ry: number): Piece {
  return {
    d: (x, y) => {
      const [u, v] = [(x - cx) / rx, (y - cy) / ry];
      const k0 = Math.sqrt(u * u + v * v);
      const [u1, v1] = [u / rx, v / ry];
      const k1 = Math.sqrt(u1 * u1 + v1 * v1);
      return k1 === 0 ? -Math.min(rx, ry) : (k0 * (k0 - 1)) / k1;
    },
    x0: cx - rx,
    y0: cy - ry,
    x1: cx + rx,
    y1: cy + ry,
  };
}

// The outline of a piece, `r` either side of its edge.
const ring = (p: Piece, r: number): Piece => ({
  d: (x, y) => Math.abs(p.d(x, y)) - r,
  x0: p.x0 - r,
  y0: p.y0 - r,
  x1: p.x1 + r,
  y1: p.y1 + r,
});

// A segment with round ends, `r` thick either side.
function seg(ax: number, ay: number, bx: number, by: number, r: number): Piece {
  const [dx, dy] = [bx - ax, by - ay];
  const l2 = dx * dx + dy * dy;
  return {
    d: (x, y) => {
      const t = l2 > 0 ? clamp01(((x - ax) * dx + (y - ay) * dy) / l2) : 0;
      const [ex, ey] = [x - ax - dx * t, y - ay - dy * t];
      return Math.sqrt(ex * ex + ey * ey) - r;
    },
    x0: Math.min(ax, bx) - r,
    y0: Math.min(ay, by) - r,
    x1: Math.max(ax, bx) + r,
    y1: Math.max(ay, by) + r,
  };
}

// An axis-aligned box with corners rounded by `round`.
function box(x0: number, y0: number, x1: number, y1: number, round = 0): Piece {
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const [hx, hy] = [(x1 - x0) / 2 - round, (y1 - y0) / 2 - round];
  return {
    d: (x, y) => {
      const [qx, qy] = [Math.abs(x - cx) - hx, Math.abs(y - cy) - hy];
      const [ox, oy] = [Math.max(qx, 0), Math.max(qy, 0)];
      return (
        Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - round
      );
    },
    x0,
    y0,
    x1,
    y1,
  };
}

// A convex polygon, either winding. Its distance is the largest over its edges' lines: exact inside and along
// edges, a little short just outside corners, which is all antialiasing needs.
function poly(pts: readonly Pt[]): Piece {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const sign = area > 0 ? 1 : -1;
  // Each edge's outward normal and offset, interleaved.
  const edges: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
    const len = Math.sqrt(ex * ex + ey * ey);
    const [nx, ny] = [(sign * ey) / len, (-sign * ex) / len];
    edges.push(nx, ny, nx * a[0] + ny * a[1]);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    d: (x, y) => {
      let d = -Infinity;
      for (let i = 0; i < edges.length; i += 3) {
        const e = edges[i] * x + edges[i + 1] * y - edges[i + 2];
        if (e > d) d = e;
      }
      return d;
    },
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
}

// A convex polygon moved `e` inward along every edge, for an outline's inner edge.
function shrink(pts: readonly Pt[], e: number): Pt[] {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const sign = area > 0 ? 1 : -1;
  // Each edge's line moved inward: a point on it and its direction.
  const moved = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
    const len = Math.sqrt(ex * ex + ey * ey);
    const [nx, ny] = [(-sign * ey) / len, (sign * ex) / len];
    return [a[0] + nx * e, a[1] + ny * e, ex, ey];
  });
  return moved.map((l, i) => {
    const p = moved[(i + moved.length - 1) % moved.length];
    // Where the previous edge's line meets this one's.
    const den = p[2] * l[3] - p[3] * l[2];
    const t = ((l[0] - p[0]) * l[3] - (l[1] - p[1]) * l[2]) / den;
    return [p[0] + p[2] * t, p[1] + p[3] * t];
  });
}

// What a shape prints where it covers: a fill from 0 (paper) to 1 (solid ink), by height, for line hatching.
type Fill = (y: number, px: number) => number;
const SOLID: Fill = () => 1;
const PAPER: Fill = () => 0;
const hatch =
  (g: number, frac: number): Fill =>
  (y, px) =>
    lines(y, px, g, frac);

// A shape: the union of its pieces, cut down to the union of `clip` when it has one, painted with `fill`.
type Shape = {
  pieces: Piece[];
  clip?: Piece[];
  fill: Fill;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

function shape(fill: Fill, pieces: Piece[], clip?: Piece[]): Shape {
  const bounds = (ps: Piece[]) => ({
    x0: Math.min(...ps.map((p) => p.x0)),
    y0: Math.min(...ps.map((p) => p.y0)),
    x1: Math.max(...ps.map((p) => p.x1)),
    y1: Math.max(...ps.map((p) => p.y1)),
  });
  const b = bounds(pieces);
  if (clip) {
    const c = bounds(clip);
    [b.x0, b.y0] = [Math.max(b.x0, c.x0), Math.max(b.y0, c.y0)];
    [b.x1, b.y1] = [Math.min(b.x1, c.x1), Math.min(b.y1, c.y1)];
  }
  return { pieces, clip, fill, ...b };
}

const unionD = (pieces: Piece[], x: number, y: number) => {
  let d = Infinity;
  for (const p of pieces) {
    const e = p.d(x, y);
    if (e < d) d = e;
  }
  return d;
};

const shapeD = (s: Shape, x: number, y: number) => {
  const d = unionD(s.pieces, x, y);
  return s.clip ? Math.max(d, unionD(s.clip, x, y)) : d;
};

// A grid over the art, and a margin round it for plates printed off the paper, to find what is near a point.
// Each cell sorts each shape by the distance from the cell's center to it: one that misses the whole cell is
// left out, and one that covers it all paints without testing its edge and hides every shape under it. The
// distances are only estimates for ellipses, so the test allows half again the cell's reach.
const CELL = 1 / 32;
const MARGIN = 0.25;

function grid(W: number, H: number) {
  const [cols, rows] = [
    Math.ceil((W + 2 * MARGIN) / CELL),
    Math.ceil((H + 2 * MARGIN) / CELL),
  ];
  const at = (v: number, n: number) =>
    Math.min(n - 1, Math.max(0, Math.floor((v + MARGIN) / CELL)));
  return {
    count: cols * rows,
    // The cell holding a point.
    cell: (x: number, y: number) => at(y, rows) * cols + at(x, cols),
    // The center of cell `i`.
    center: (i: number): Pt => [
      ((i % cols) + 0.5) * CELL - MARGIN,
      (Math.floor(i / cols) + 0.5) * CELL - MARGIN,
    ],
    // How far from its center a cell's points can be, as a shape's estimated distance sees it.
    reach: (px: number) => 1.5 * CELL * Math.SQRT1_2 + px / 2,
  };
}
type Grid = ReturnType<typeof grid>;

// Paints shapes in order over a starting ink amount: each pulls the ink toward its fill where it covers.
function layer(shapes: Shape[], g: Grid, px: number) {
  const reach = g.reach(px);
  const cells = Array.from({ length: g.count }, (_, i) => {
    const [x, y] = g.center(i);
    let list: { s: Shape; full: boolean }[] = [];
    for (const s of shapes) {
      if (
        x < s.x0 - reach ||
        x > s.x1 + reach ||
        y < s.y0 - reach ||
        y > s.y1 + reach
      )
        continue;
      const d = shapeD(s, x, y);
      if (d >= reach) continue;
      if (d <= -reach) list = [];
      list.push({ s, full: d <= -reach });
    }
    return list;
  });
  return (cell: number, x: number, y: number, px: number, ink: number) => {
    for (const { s, full } of cells[cell]) {
      if (full) {
        ink = s.fill(y, px);
        continue;
      }
      if (x < s.x0 - px || x > s.x1 + px || y < s.y0 - px || y > s.y1 + px)
        continue;
      const d = shapeD(s, x, y);
      if (d < px / 2) ink += (s.fill(y, px) - ink) * cover(d, px);
    }
    return ink;
  };
}

// Where a union of pieces lies in each cell: -1 wholly outside, 1 wholly inside, 0 across its edge.
function regions(pieces: Piece[], g: Grid, px: number): Int8Array {
  const reach = g.reach(px);
  return Int8Array.from({ length: g.count }, (_, i) => {
    const d = unionD(pieces, ...g.center(i));
    return d >= reach ? -1 : d <= -reach ? 1 : 0;
  });
}

// Draws a motif in window units (the window's half height is 1, from its center, y down): a motif's own units
// are scaled by `s` and placed at (ox, oy), turned by the unit vector (c, sn), then mirrored when `flip` is -1.
class Pen {
  shapes: Shape[] = [];
  ox = 0;
  oy = 0;
  s = 1;
  flip = 1;
  c = 1;
  sn = 0;
  constructor(
    // The window's center and half height in art units.
    private cx: number,
    private cy: number,
    private unit: number,
  ) {}

  place(ox: number, oy: number, s: number, flip = 1, c = 1, sn = 0) {
    Object.assign(this, { ox, oy, s, flip, c, sn });
  }
  p(u: number, v: number): Pt {
    const [ru, rv] = [this.c * u - this.sn * v, this.sn * u + this.c * v];
    return [
      this.cx + this.unit * (this.ox + this.flip * this.s * ru),
      this.cy + this.unit * (this.oy + this.s * rv),
    ];
  }
  r(r: number) {
    return r * this.s * this.unit;
  }
  circle(u: number, v: number, r: number) {
    return circle(...this.p(u, v), this.r(r));
  }
  // Not turned: only for motifs placed upright.
  ellipse(u: number, v: number, ru: number, rv: number) {
    return ellipse(...this.p(u, v), this.r(ru), this.r(rv));
  }
  seg(u0: number, v0: number, u1: number, v1: number, r: number) {
    return seg(...this.p(u0, v0), ...this.p(u1, v1), this.r(r));
  }
  poly(pts: readonly Pt[]) {
    return poly(pts.map(([u, v]) => this.p(u, v)));
  }
  box(u0: number, v0: number, u1: number, v1: number, round = 0) {
    if (this.sn !== 0)
      return this.poly([
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ]);
    const [[x0, y0], [x1, y1]] = [this.p(u0, v0), this.p(u1, v1)];
    return box(
      Math.min(x0, x1),
      Math.min(y0, y1),
      Math.max(x0, x1),
      Math.max(y0, y1),
      this.r(round),
    );
  }
  // An outlined polygon: ink `e` wide around paper.
  outline(pts: readonly Pt[], e: number) {
    this.ink(this.poly(pts));
    this.cut(this.poly(shrink(pts, e)));
  }
  ink(...pieces: Piece[]) {
    this.shapes.push(shape(SOLID, pieces));
  }
  cut(...pieces: Piece[]) {
    this.shapes.push(shape(PAPER, pieces));
  }
  cutWithin(clip: Piece[], ...pieces: Piece[]) {
    this.shapes.push(shape(PAPER, pieces, clip));
  }
  hatch(fill: Fill, pieces: Piece[], clip?: Piece[]) {
    this.shapes.push(shape(fill, pieces, clip));
  }
}

// What a vignette stands on: the sea or land below its horizon, in window units.
type Scene = { ground: "sea" | "land"; horizon: number; clouds: number };

// Gulls, a stroke each side of a body.
function gulls(pen: Pen, rand: () => number, A: number, top: number) {
  const n = Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    pen.place(
      A * 1.4 * (rand() - 0.5),
      top + 0.3 * rand(),
      0.04 + 0.03 * rand(),
    );
    const lift = 0.3 + 0.4 * rand();
    pen.ink(pen.seg(-1, -lift, 0, 0, 0.12), pen.seg(0, 0, 1, -lift, 0.12));
  }
}

// Smoke from a stack at (u, v) drifting back, as hatched puffs.
function smoke(pen: Pen, rand: () => number, u: number, v: number, g: number) {
  const pieces: Piece[] = [];
  const n = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++)
    pieces.push(
      pen.circle(
        u - 0.11 * i - 0.04 * rand(),
        v - 0.05 - 0.035 * i,
        0.045 + 0.02 * i,
      ),
    );
  pen.hatch(hatch(g, 0.5), pieces);
}

// The six vignettes. Each places itself with `pen` in a window `A` half-heights wide each side of center and
// returns what it stands on. `g` is the sky's line gap in art units, for hatching that matches it.
type Motif = (pen: Pen, rand: () => number, A: number, g: number) => Scene;

const biplane: Motif = (pen, rand, A) => {
  const horizon = 0.5 + 0.25 * rand();
  const s = (0.6 + 0.15 * rand()) * Math.min(A, 1.2);
  const climb = 0.3 * (rand() - 0.5);
  const len = Math.sqrt(1 + climb * climb);
  const flip = rand() < 0.5 ? 1 : -1;
  pen.place(
    0.2 * A * (rand() - 0.5),
    -0.2 - 0.15 * rand(),
    s,
    flip,
    1 / len,
    climb / len,
  );
  // Tail, then fuselage, wings and struts, then the propeller and gear in front.
  pen.ink(
    pen.poly([
      [-1.02, 0.0],
      [-0.98, -0.28],
      [-0.86, -0.27],
      [-0.76, -0.04],
    ]),
    pen.box(-1.02, -0.01, -0.72, 0.03),
  );
  pen.ink(
    pen.poly([
      [-1.0, -0.05],
      [0.55, -0.12],
      [0.76, -0.1],
      [0.78, 0.08],
      [0.55, 0.12],
      [-1.0, 0.03],
    ]),
  );
  pen.cut(pen.seg(-0.88, -0.005, 0.5, -0.035, 0.012));
  pen.ink(pen.circle(-0.42, -0.02, 0.05));
  pen.cut(pen.circle(-0.42, -0.02, 0.032));
  pen.ink(pen.circle(-0.42, -0.02, 0.014));
  pen.ink(pen.circle(0.08, -0.16, 0.05));
  pen.ink(pen.box(-0.05, -0.43, 0.48, -0.36), pen.box(0.0, 0.05, 0.44, 0.11));
  pen.cut(pen.seg(-0.02, -0.395, 0.45, -0.395, 0.008));
  pen.ink(
    pen.seg(0.04, -0.37, 0.07, 0.07, 0.013),
    pen.seg(0.4, -0.37, 0.4, 0.07, 0.013),
    pen.seg(0.04, -0.37, 0.4, 0.07, 0.005),
    pen.seg(0.4, -0.37, 0.07, 0.07, 0.005),
    pen.seg(0.22, -0.37, 0.3, -0.1, 0.012),
    pen.seg(0.33, 0.1, 0.42, 0.3, 0.013),
    pen.seg(0.56, 0.1, 0.42, 0.3, 0.013),
  );
  pen.ink(pen.box(0.785, -0.3, 0.83, 0.3), pen.circle(0.8, 0, 0.04));
  pen.ink(pen.circle(0.42, 0.32, 0.075));
  pen.cut(pen.circle(0.42, 0.32, 0.04));
  pen.ink(pen.circle(0.42, 0.32, 0.015));
  return { ground: "land", horizon, clouds: 1 + Math.floor(rand() * 3) };
};

const lighthouse: Motif = (pen, rand, A) => {
  const horizon = 0.15 + 0.25 * rand();
  const side = rand() < 0.5 ? -1 : 1;
  const s = 0.85 + 0.2 * rand();
  pen.place(side * A * (0.2 + 0.25 * rand()), 0.62 + 0.1 * rand(), s, -side);
  const beams = rand() < 0.5;
  if (beams)
    pen.cut(
      pen.poly([
        [0.06, -1.0],
        [3, -1.3],
        [3, -0.7],
        [0.06, -0.95],
      ]),
      pen.poly([
        [-0.06, -1.0],
        [-3, -1.3],
        [-3, -0.7],
        [-0.06, -0.95],
      ]),
    );
  const tower: Pt[] = [
    [-0.12, 0.02],
    [0.12, 0.02],
    [0.075, -0.86],
    [-0.075, -0.86],
  ];
  const towerPiece = pen.poly(tower);
  pen.ink(towerPiece);
  if (rand() < 0.6) {
    const n = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const v = -0.14 - (i * 0.7) / n;
      pen.cutWithin([towerPiece], pen.box(-0.2, v - 0.1, 0.2, v));
    }
  } else
    for (const v of [-0.62, -0.38])
      pen.cut(pen.box(-0.022, v - 0.06, 0.022, v));
  pen.cut(pen.box(-0.028, -0.11, 0.028, 0.02, 0.01));
  pen.ink(
    pen.box(-0.12, -0.91, 0.12, -0.85),
    pen.seg(-0.105, -0.96, 0.105, -0.96, 0.008),
    pen.seg(-0.105, -0.96, -0.105, -0.9, 0.007),
    pen.seg(0.105, -0.96, 0.105, -0.9, 0.007),
    pen.box(-0.065, -1.07, 0.065, -0.9),
  );
  pen.cut(pen.box(-0.048, -1.05, 0.048, -0.93));
  pen.ink(
    pen.seg(0, -1.05, 0, -0.93, 0.007),
    pen.ellipse(0, -1.07, 0.072, 0.055),
    pen.seg(0, -1.1, 0, -1.18, 0.01),
    pen.circle(0, -1.19, 0.016),
  );
  if (rand() < 0.5) {
    pen.ink(
      pen.box(0.15, -0.19, 0.43, 0.02),
      pen.poly([
        [0.12, -0.18],
        [0.46, -0.18],
        [0.29, -0.33],
      ]),
      pen.box(0.37, -0.33, 0.41, -0.22),
    );
    pen.cut(pen.box(0.2, -0.13, 0.26, -0.07), pen.box(0.32, -0.12, 0.37, 0.02));
  }
  // The rock it stands on, with cracks.
  pen.ink(pen.ellipse(0, 0.06, 0.55, 0.13), pen.ellipse(-0.25, 0.1, 0.45, 0.1));
  pen.cut(
    pen.seg(-0.4, 0.06, -0.25, 0.1, 0.008),
    pen.seg(0.2, 0.04, 0.34, 0.09, 0.008),
  );
  gulls(pen, rand, A, -0.8);
  return { ground: "sea", horizon, clouds: Math.floor(rand() * 3) };
};

const sailingShip: Motif = (pen, rand, A, g) => {
  const horizon = 0.1 + 0.2 * rand();
  const s = (0.72 + 0.12 * rand()) * Math.min(A, 1.15);
  pen.place(
    0.2 * A * (rand() - 0.5),
    horizon + 0.35 + 0.1 * rand(),
    s,
    rand() < 0.5 ? 1 : -1,
  );
  const masts =
    rand() < 0.5
      ? [
          [-0.2, 1.0],
          [0.3, 1.1],
        ]
      : [
          [-0.36, 0.95],
          [0.04, 1.12],
          [0.42, 0.95],
        ];
  const fore = masts[masts.length - 1];
  // The jib, from the bowsprit's tip to the foremast.
  pen.outline(
    [
      [0.98, -0.31],
      [fore[0] + 0.02, -0.82 * fore[1]],
      [fore[0] + 0.04, -0.22],
    ],
    0.012,
  );
  for (const [m, h] of masts) {
    const n = 3;
    for (let j = 0; j < n; j++) {
      const [vb, vt] = [
        -0.2 - (j * (h - 0.25)) / n,
        -0.2 - ((j + 1) * (h - 0.25)) / n + 0.02,
      ];
      const w = 0.2 * (1 - 0.22 * j);
      const sail: Pt[] = [
        [m - w, vt],
        [m + w, vt],
        [m + w * 1.1, vb],
        [m - w * 1.1, vb],
      ];
      pen.outline(sail, 0.012);
      pen.hatch(
        hatch(g * 0.7, 0.4),
        [pen.box(m - w * 1.2, vt, m - w * 0.35, vb)],
        [pen.poly(shrink(sail, 0.012))],
      );
      pen.ink(pen.seg(m - w - 0.02, vt, m + w + 0.02, vt, 0.009));
    }
    pen.ink(pen.seg(m, -0.12, m, -h, 0.014));
    pen.ink(
      pen.poly([
        [m, -h],
        [m + 0.13, -h + 0.025],
        [m, -h + 0.05],
      ]),
    );
  }
  pen.ink(
    pen.seg(masts[0][0], -masts[0][1], -0.64, -0.24, 0.004),
    pen.seg(0.6, -0.14, 0.98, -0.31, 0.011),
    pen.poly([
      [-0.62, -0.12],
      [0.66, -0.14],
      [0.5, 0.06],
      [-0.5, 0.06],
    ]),
    pen.box(-0.66, -0.25, -0.36, -0.1, 0.01),
    pen.box(0.4, -0.2, 0.62, -0.12),
  );
  pen.cut(pen.seg(-0.58, -0.07, 0.58, -0.085, 0.013));
  for (let u = -0.45; u < 0.5; u += 0.12)
    pen.ink(pen.box(u - 0.018, -0.094, u + 0.018, -0.062));
  return { ground: "sea", horizon, clouds: Math.floor(rand() * 3) };
};

const steamship: Motif = (pen, rand, A, g) => {
  const horizon = 0.1 + 0.2 * rand();
  const s = (0.7 + 0.12 * rand()) * Math.min(A, 1.2);
  pen.place(
    0.2 * A * (rand() - 0.5),
    horizon + 0.4 + 0.1 * rand(),
    s,
    rand() < 0.5 ? 1 : -1,
  );
  const funnels = 1 + Math.floor(rand() * 3);
  const at = (i: number) =>
    funnels === 1 ? -0.1 : -0.32 + (0.42 * i) / (funnels - 1);
  for (let i = 0; i < funnels; i++)
    smoke(pen, rand, at(i) - 0.07, -0.68, g * 0.7);
  pen.ink(
    pen.seg(0.6, -0.18, 0.6, -0.78, 0.01),
    pen.seg(-0.7, -0.14, -0.7, -0.66, 0.01),
    pen.seg(0.6, -0.78, 0.85, -0.18, 0.004),
    pen.seg(-0.7, -0.66, -0.9, -0.14, 0.004),
    pen.seg(0.6, -0.72, -0.7, -0.6, 0.004),
  );
  for (let i = 0; i < funnels; i++) {
    const u = at(i);
    const funnel = pen.poly([
      [u - 0.055, -0.4],
      [u + 0.055, -0.4],
      [u + 0.015, -0.68],
      [u - 0.095, -0.68],
    ]);
    pen.ink(funnel);
    pen.cutWithin([funnel], pen.box(u - 0.2, -0.63, u + 0.2, -0.59));
  }
  const decks = [
    pen.box(-0.5, -0.3, 0.35, -0.15),
    pen.box(-0.3, -0.42, 0.15, -0.3),
    pen.box(0.05, -0.5, 0.22, -0.42),
  ];
  pen.ink(...decks);
  for (const [v, u0, u1] of [
    [-0.215, -0.46, 0.32],
    [-0.36, -0.26, 0.12],
    [-0.46, 0.08, 0.2],
  ])
    for (let u = u0; u < u1; u += 0.06)
      pen.cut(pen.box(u, v - 0.022, u + 0.03, v + 0.022));
  const hull = pen.poly([
    [-0.9, -0.14],
    [0.85, -0.18],
    [0.7, 0.06],
    [-0.8, 0.06],
  ]);
  pen.ink(hull);
  pen.cutWithin([hull], pen.seg(-0.95, -0.1, 0.95, -0.135, 0.01));
  for (let u = -0.6; u < 0.6; u += 0.1) pen.cut(pen.circle(u, -0.04, 0.016));
  return { ground: "sea", horizon, clouds: Math.floor(rand() * 3) };
};

const balloon: Motif = (pen, rand, A, g) => {
  const horizon = 0.45 + 0.25 * rand();
  const one = (u: number, v: number, s: number) => {
    pen.place(u, v, s);
    const envelope = [
      pen.circle(0, -0.35, 0.35),
      pen.poly([
        [-0.335, -0.26],
        [0.335, -0.26],
        [0.11, 0.1],
        [-0.11, 0.1],
      ]),
    ];
    pen.ink(...envelope);
    const gores = 6 + 2 * Math.floor(rand() * 3);
    for (let i = 1; i < gores; i += 2) {
      const [a, b] = [-0.9 + (1.8 * i) / gores, -0.9 + (1.8 * (i + 1)) / gores];
      pen.hatch(
        hatch(g * 0.6, 0.45),
        [
          pen.poly([
            [0, 0.3],
            [a, -0.8],
            [b, -0.8],
          ]),
        ],
        envelope,
      );
    }
    pen.ink(
      pen.box(-0.115, 0.08, 0.115, 0.11),
      pen.seg(-0.11, 0.1, -0.065, 0.18, 0.006),
      pen.seg(0.11, 0.1, 0.065, 0.18, 0.006),
      pen.seg(0, 0.1, 0, 0.18, 0.006),
      pen.box(-0.075, 0.17, 0.075, 0.28, 0.012),
    );
    pen.cut(pen.seg(-0.06, 0.22, 0.06, 0.22, 0.007));
  };
  const side = rand() < 0.5 ? -1 : 1;
  if (rand() < 0.4)
    one(-side * A * 0.55, -0.45 + 0.2 * rand(), 0.25 + 0.1 * rand());
  one(side * A * 0.3 * rand(), 0.15 + 0.1 * rand(), 0.85 + 0.2 * rand());
  return { ground: "land", horizon, clouds: 2 + Math.floor(rand() * 3) };
};

// The cos and sin of four diameters, each drawn as two spokes.
const SPOKES: readonly Pt[] = [
  [1, 0],
  [0.7071067811865476, 0.7071067811865476],
  [0, 1],
  [-0.7071067811865476, 0.7071067811865476],
];

const locomotive: Motif = (pen, rand, A, g) => {
  const horizon = 0.3 + 0.2 * rand();
  const s = (0.62 + 0.1 * rand()) * Math.min(A, 1.25);
  pen.place(
    0.15 * A * (rand() - 0.5),
    horizon + 0.3 + 0.1 * rand(),
    s,
    rand() < 0.5 ? 1 : -1,
  );
  smoke(pen, rand, 0.5, -0.66, g * 0.7);
  const wheel = (u: number, v: number, r: number) => {
    pen.ink(pen.circle(u, v, r));
    pen.cut(pen.circle(u, v, r * 0.78));
    pen.ink(
      pen.circle(u, v, r * 0.24),
      ...SPOKES.map(([c, sn]) =>
        pen.seg(
          u - c * r * 0.8,
          v - sn * r * 0.8,
          u + c * r * 0.8,
          v + sn * r * 0.8,
          0.01,
        ),
      ),
    );
  };
  if (rand() < 0.55) {
    pen.ink(pen.box(-1.08, -0.42, -0.64, -0.08, 0.02));
    pen.cut(pen.box(-1.03, -0.36, -0.69, -0.33));
    wheel(-0.97, 0.0, 0.075);
    wheel(-0.75, 0.0, 0.075);
  }
  const boiler = pen.box(-0.3, -0.4, 0.5, -0.12, 0.06);
  pen.ink(
    pen.box(-0.6, -0.58, -0.28, -0.08),
    pen.box(-0.64, -0.63, -0.24, -0.57, 0.01),
    boiler,
    pen.box(0.45, -0.42, 0.6, -0.1, 0.02),
    pen.poly([
      [0.48, -0.4],
      [0.57, -0.4],
      [0.6, -0.6],
      [0.45, -0.6],
    ]),
    pen.box(0.43, -0.66, 0.62, -0.59, 0.01),
    pen.ellipse(0.12, -0.41, 0.07, 0.06),
    pen.ellipse(-0.1, -0.41, 0.05, 0.045),
    pen.box(-0.64, -0.12, 0.66, -0.07),
    pen.poly([
      [0.6, -0.08],
      [0.66, -0.08],
      [0.8, 0.08],
      [0.6, 0.08],
    ]),
  );
  pen.cut(pen.box(-0.52, -0.5, -0.38, -0.36, 0.01));
  for (const u of [-0.12, 0.15, 0.36])
    pen.cutWithin([boiler], pen.seg(u, -0.45, u, -0.05, 0.007));
  const drivers = rand() < 0.5 ? [-0.42, -0.14, 0.14] : [-0.36, -0.04];
  for (const u of drivers) wheel(u, -0.04, 0.12);
  wheel(0.44, 0.01, 0.07);
  pen.ink(pen.seg(drivers[0], 0.0, drivers[drivers.length - 1], 0.0, 0.015));
  pen.ink(pen.box(-4, 0.08, 4, 0.105));
  return { ground: "land", horizon, clouds: Math.floor(rand() * 3) };
};

const MOTIFS: readonly Motif[] = [
  biplane,
  lighthouse,
  sailingShip,
  steamship,
  balloon,
  locomotive,
];

// Lettering as strokes in a box 0.6 wide and 1 tall, y down: segments [u0, v0, u1, v1], or "ring" for an O.
const S = [
  [0.6, 0, 0, 0],
  [0, 0, 0, 0.5],
  [0, 0.5, 0.6, 0.5],
  [0.6, 0.5, 0.6, 1],
  [0.6, 1, 0, 1],
];
const GLYPHS: Record<string, readonly (readonly number[])[] | "ring"> = {
  A: [
    [0, 1, 0.3, 0],
    [0.3, 0, 0.6, 1],
    [0.13, 0.62, 0.47, 0.62],
  ],
  E: [
    [0, 0, 0, 1],
    [0, 0, 0.6, 0],
    [0, 0.5, 0.45, 0.5],
    [0, 1, 0.6, 1],
  ],
  H: [
    [0, 0, 0, 1],
    [0.6, 0, 0.6, 1],
    [0, 0.5, 0.6, 0.5],
  ],
  I: [[0.3, 0, 0.3, 1]],
  L: [
    [0, 0, 0, 1],
    [0, 1, 0.6, 1],
  ],
  M: [
    [0, 1, 0, 0],
    [0, 0, 0.3, 0.55],
    [0.3, 0.55, 0.6, 0],
    [0.6, 0, 0.6, 1],
  ],
  N: [
    [0, 1, 0, 0],
    [0, 0, 0.6, 1],
    [0.6, 1, 0.6, 0],
  ],
  O: "ring",
  P: [
    [0, 1, 0, 0],
    [0, 0, 0.6, 0],
    [0.6, 0, 0.6, 0.5],
    [0.6, 0.5, 0, 0.5],
  ],
  R: [
    [0, 1, 0, 0],
    [0, 0, 0.6, 0],
    [0.6, 0, 0.6, 0.5],
    [0.6, 0.5, 0, 0.5],
    [0.25, 0.5, 0.6, 1],
  ],
  S,
  T: [
    [0, 0, 0.6, 0],
    [0.3, 0, 0.3, 1],
  ],
  U: [
    [0, 0, 0, 1],
    [0, 1, 0.6, 1],
    [0.6, 1, 0.6, 0],
  ],
  V: [
    [0, 0, 0.3, 1],
    [0.3, 1, 0.6, 0],
  ],
  "0": "ring",
  "1": [
    [0.12, 0.2, 0.35, 0],
    [0.35, 0, 0.35, 1],
  ],
  "2": [
    [0, 0, 0.6, 0],
    [0.6, 0, 0.6, 0.5],
    [0.6, 0.5, 0, 0.5],
    [0, 0.5, 0, 1],
    [0, 1, 0.6, 1],
  ],
  "3": [
    [0, 0, 0.6, 0],
    [0.6, 0, 0.6, 1],
    [0.6, 1, 0, 1],
    [0.15, 0.5, 0.6, 0.5],
  ],
  "5": S,
  "7": [
    [0, 0, 0.6, 0],
    [0.6, 0, 0.2, 1],
  ],
};
const VOWELS = [..."AEIOU"];
const CONSONANTS = [..."HLMNPRSTV"];
const VALUES = [1, 2, 3, 5, 7, 10, 12, 15, 20, 25, 30, 50, 70];

// A made-up word, mostly alternating consonants and vowels.
function word(rand: () => number, length: number): string {
  let s = "";
  let vowel = rand() < 0.3;
  for (let i = 0; i < length; i++) {
    s += pick(vowel ? VOWELS : CONSONANTS, rand);
    vowel = vowel ? rand() < 0.2 : rand() < 0.75;
  }
  return s;
}

// A letter's advance, and the gap a space leaves, in cap heights.
const ADVANCE = 0.92;
const SPACE = 0.6;
const textWidth = (text: string) =>
  [...text].reduce((w, ch) => w + (ch === " " ? SPACE : ADVANCE), 0) -
  (ADVANCE - 0.6);

// `text` as one shape per letter, `h` tall, centered on (x, y).
function lettering(
  text: string,
  x: number,
  y: number,
  h: number,
  fill: Fill,
): Shape[] {
  const shapes: Shape[] = [];
  let left = x - (textWidth(text) * h) / 2;
  const [top, r] = [y - h / 2, 0.075 * h];
  for (const ch of text) {
    if (ch === " ") {
      left += SPACE * h;
      continue;
    }
    const glyph = GLYPHS[ch];
    shapes.push(
      shape(
        fill,
        glyph === "ring"
          ? [ring(ellipse(left + 0.3 * h, y, 0.3 * h, 0.5 * h), r)]
          : glyph.map(([u0, v0, u1, v1]) =>
              seg(left + u0 * h, top + v0 * h, left + u1 * h, top + v1 * h, r),
            ),
      ),
    );
    left += ADVANCE * h;
  }
  return shapes;
}

// The error a seed prints, from a weighted table, rolled from its own stream so it is independent of the
// design. Misregistration is the most common, as in real printing. The inverted center is the rare chase.
export type PrintError =
  | "misregistered"
  | "double"
  | "fold"
  | "missingInk"
  | "perfect"
  | "inverted";
const ERRORS: readonly [PrintError, number][] = [
  ["misregistered", 0.36],
  ["double", 0.18],
  ["fold", 0.18],
  ["missingInk", 0.19],
  ["perfect", 0.05],
  ["inverted", 0.04],
];

const errorStream = (seed: number) => stream(seed, 0x51a7e);

function rollFrom(rand: () => number): PrintError {
  let r = rand();
  for (const [error, weight] of ERRORS) {
    if (r < weight) return error;
    r -= weight;
  }
  return ERRORS[0][0];
}

export const rollError = (seed: number) => rollFrom(errorStream(seed));

// One pass of a plate through the press: shifted by (dx, dy) after turning half round the window's center when
// `invert`, and printing `strength` of its ink, fading to none across `fade` when it has one.
type Impression = {
  dx: number;
  dy: number;
  invert: boolean;
  strength: number;
  fade?: { nx: number; ny: number; at: number; width: number };
};

const pass = (dx = 0, dy = 0, invert = false, strength = 1): Impression => ({
  dx,
  dy,
  invert,
  strength,
});

// How the stamp was printed: each plate's impressions, and a fold in the paper during printing, which leaves
// a band `width` wide unprinted along the line through `at` square to (nx, ny), and moves what prints beyond
// it across by that width.
type Printing = {
  error: PrintError;
  frame: Impression[];
  center: Impression[];
  fold?: { nx: number; ny: number; at: number; width: number };
};

function printing(seed: number, W: number, H: number): Printing {
  const rand = errorStream(seed);
  const error = rollFrom(rand);
  // Even good sheets register a hair off.
  const jitter = (r: number) => {
    const [x, y] = direction(rand);
    return pass(x * r, y * r);
  };
  if (error === "perfect")
    return { error, frame: [pass()], center: [jitter(0.003 * rand())] };
  if (error === "misregistered")
    return { error, frame: [pass()], center: [jitter(0.03 + 0.06 * rand())] };
  if (error === "inverted") {
    const { dx, dy } = jitter(0.004 + 0.008 * rand());
    return { error, frame: [pass()], center: [pass(dx, dy, true)] };
  }
  if (error === "double") {
    const center = rand() < 0.6;
    const [x, y] = direction(rand);
    const r = 0.007 + 0.012 * rand();
    const twice = [pass(), pass(x * r, y * r, false, 0.55 + 0.4 * rand())];
    return center
      ? { error, frame: [pass()], center: twice }
      : { error, frame: twice, center: [jitter(0.008 * rand())] };
  }
  if (error === "missingInk") {
    const center = rand() < 0.65;
    // Half the time the ink runs dry partway across rather than missing entirely.
    let starved: Impression[] = [];
    if (rand() < 0.5) {
      const [nx, ny] = direction(rand);
      const at = nx * (W / 2) + ny * (H / 2) + 0.4 * (rand() - 0.5);
      starved = [
        { ...pass(), fade: { nx, ny, at, width: 0.15 + 0.25 * rand() } },
      ];
    }
    return center
      ? { error, frame: [pass()], center: starved }
      : { error, frame: starved, center: [jitter(0.006 * rand())] };
  }
  const [nx, ny] = direction(rand);
  const at = nx * W * (0.3 + 0.4 * rand()) + ny * H * (0.3 + 0.4 * rand());
  return {
    error,
    frame: [pass()],
    center: [jitter(0.006 * rand())],
    fold: { nx, ny, at, width: 0.03 + 0.05 * rand() },
  };
}

// Small draws are supersampled until the art's short side has this many samples, so engraved lines and
// lettering finer than a pixel average out the way they would in a large draw scaled down.
const MIN_UNIT = 128;

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const unit = Math.min(width, height);
  const [W, H] = [width / unit, height / unit];
  const ss = Math.ceil(MIN_UNIT / unit);
  const px = 1 / (unit * ss);

  // The vignette prints in the darkest ink and the frame in another, or the other way round when that ink is
  // dark enough to carry the vignette.
  const accent = inks[1 + Math.floor(rand() * Math.max(1, inks.length - 2))];
  const [ar, ag, ab] = rgb(accent);
  const swap = rand() < 0.35 && 0.299 * ar + 0.587 * ag + 0.114 * ab < 150;
  const [centerInk, frameInk] = swap ? [accent, inks[0]] : [inks[0], accent];
  const paperRgb = rgb(paper);
  // Each ink as a share of paper per channel, so overprinted inks multiply like transparent inks do.
  const share = (hex: string) =>
    rgb(hex).map((c, i) => Math.min(1, c / paperRgb[i])) as Rgb;
  const [frameShare, centerShare] = [share(frameInk), share(centerInk)];

  // The frame: an outer rule, a body solid or engraved in lines, a window with a ruled edge, lettering at the
  // top, and value circles in the bottom corners with a word between them.
  const edge = 0.06;
  const [side, top, bottom] = [
    0.05 + 0.02 * rand(),
    0.12 + 0.03 * rand(),
    0.12 + 0.03 * rand(),
  ];
  const win = {
    x0: edge + side,
    y0: edge + top,
    x1: W - edge - side,
    y1: H - edge - bottom,
  };
  const [cx, cy] = [(win.x0 + win.x1) / 2, (win.y0 + win.y1) / 2];
  const [rx, ry] = [(win.x1 - win.x0) / 2, (win.y1 - win.y0) / 2];
  const windowShape = pick(["oval", "rect", "arch"] as const, rand);
  // The window grown by `g` on every side.
  const window = (g: number): Piece[] => {
    if (windowShape === "oval") return [ellipse(cx, cy, rx + g, ry + g)];
    if (windowShape === "rect")
      return [box(win.x0 - g, win.y0 - g, win.x1 + g, win.y1 + g, 0.025 + g)];
    const a = Math.min(rx, ry * 0.7);
    return [
      ellipse(cx, win.y0 + a, rx + g, a + g),
      box(win.x0 - g, win.y0 + a, win.x1 + g, win.y1 + g, 0.01 + g),
    ];
  };
  const body = rand() < 0.5 ? SOLID : hatch(0.0065, 0.62 + 0.15 * rand());
  const frame: Shape[] = [
    shape(SOLID, [box(edge, edge, W - edge, H - edge, 0.004)]),
    shape(PAPER, [
      box(edge + 0.005, edge + 0.005, W - edge - 0.005, H - edge - 0.005),
    ]),
    shape(body, [
      box(edge + 0.009, edge + 0.009, W - edge - 0.009, H - edge - 0.009),
    ]),
    shape(PAPER, window(0.022)),
    shape(SOLID, window(0.013)),
    shape(PAPER, window(0.006)),
  ];
  const inner = {
    x0: edge + 0.009,
    y0: edge + 0.009,
    x1: W - edge - 0.009,
    y1: H - edge - 0.009,
  };
  // Rosettes in the top corners.
  const oc = Math.min(side, top) * 0.42;
  for (const x of [inner.x0 + oc + 0.006, inner.x1 - oc - 0.006]) {
    const y = inner.y0 + oc + 0.006;
    frame.push(
      shape(PAPER, [circle(x, y, oc)]),
      shape(SOLID, [circle(x, y, oc * 0.7)]),
      shape(PAPER, [circle(x, y, oc * 0.3)]),
    );
  }
  const topText =
    rand() < 0.4
      ? `${word(rand, 3 + Math.floor(rand() * 3))} ${word(rand, 4 + Math.floor(rand() * 3))}`
      : word(rand, 5 + Math.floor(rand() * 4));
  const topBand = win.y0 - 0.022 - inner.y0;
  const topRoom = inner.x1 - inner.x0 - 4 * oc - 0.04;
  frame.push(
    ...lettering(
      topText,
      W / 2,
      inner.y0 + topBand / 2,
      Math.min(0.5 * topBand, topRoom / textWidth(topText)),
      PAPER,
    ),
  );
  const bottomBand = inner.y1 - (win.y1 + 0.022);
  const rv = Math.min(0.42 * bottomBand, side + 0.02);
  const value = String(pick(VALUES, rand));
  const vy = inner.y1 - bottomBand / 2;
  for (const x of [inner.x0 + rv + 0.008, inner.x1 - rv - 0.008]) {
    frame.push(
      shape(PAPER, [circle(x, vy, rv)]),
      shape(SOLID, [circle(x, vy, rv - 0.006)]),
    );
    frame.push(
      ...lettering(
        value,
        x,
        vy,
        Math.min(rv, (1.5 * rv) / textWidth(value)),
        PAPER,
      ),
    );
  }
  const bottomText = word(rand, 4 + Math.floor(rand() * 3));
  const bottomRoom = inner.x1 - inner.x0 - 4 * rv - 0.06;
  frame.push(
    ...lettering(
      bottomText,
      W / 2,
      vy,
      Math.min(0.42 * bottomBand, bottomRoom / textWidth(bottomText)),
      PAPER,
    ),
  );

  // The vignette: a motif over sky lines that thicken toward the horizon, and sea or land below it.
  const g = 0.0125 + 0.004 * rand();
  const pen = new Pen(cx, cy, ry);
  const scene = pick(MOTIFS, rand)(pen, rand, rx / ry, g);
  const hy = cy + scene.horizon * ry;
  const clouds = Array.from({ length: scene.clouds }, () => {
    const [x, y] = [
      cx + rx * 1.6 * (rand() - 0.5),
      win.y0 + (hy - win.y0) * (0.15 + 0.55 * rand()),
    ];
    const r = ry * (0.07 + 0.06 * rand());
    const n = 3 + Math.floor(rand() * 3);
    return Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1) - 0.5;
      return circle(
        x + t * r * n * 0.9,
        y + r * (0.3 * rand() + 0.6 * t * t),
        r * (1.1 - 0.9 * t * t),
      );
    });
  }).flat();
  const cloudBounds = clouds.length ? shape(SOLID, clouds) : null;
  const cloudSoft = 0.025 * ry;
  const waves = noise1(rand);
  const hills = noise1(rand);
  const hillAmp = 0.05 + 0.15 * rand();
  const hillFreq = 2 + 3 * rand();
  const seaGap = 0.85 * g;
  const seaBottom = win.y1 + 0.02;

  // How much ink the vignette's background prints at a point.
  const background = (x: number, y: number, px: number): number => {
    if (scene.ground === "sea" && y > hy) {
      // Rows of waves, each shifted and broken by noise, thicker toward the viewer.
      let sum = 0;
      const amp = 0.3 * seaGap;
      const lo = Math.max(0, Math.floor((y - px / 2 - hy - amp) / seaGap) - 1);
      const hi = Math.floor((y + px / 2 - hy + amp) / seaGap) + 1;
      for (let k = lo; k <= hi; k++) {
        const depth = clamp01(((k + 0.5) * seaGap) / (seaBottom - hy));
        const dash = clamp01((waves(x * 22 + k * 7.9 + 31) - 0.25) * 4);
        const h = seaGap * (0.08 + 0.3 * depth) * dash;
        if (h <= 0) continue;
        const c =
          hy +
          (k + 0.5) * seaGap +
          amp * (waves(x * (14 - 6 * depth) + k * 2.7) - 0.5);
        const overlap =
          Math.min(y + px / 2, c + h) - Math.max(y - px / 2, c - h);
        if (overlap > 0) sum += overlap;
      }
      return Math.min(1, sum / px);
    }
    let land = 0;
    let ground = 0;
    if (scene.ground === "land") {
      const X = (x - cx) / ry;
      const crest =
        hy -
        ry *
          hillAmp *
          (0.65 * hills(X * hillFreq) + 0.35 * hills(X * hillFreq * 2.3 + 17));
      land = clamp01((y - crest) / px + 0.5);
      if (land > 0)
        ground = lines(
          y,
          px,
          seaGap,
          0.45 + 0.35 * clamp01((y - hy) / (0.6 * ry)),
        );
      if (land === 1) return ground;
    }
    // Sky lines, thinner up high and away in the clouds.
    const t = clamp01((y - win.y0) / (hy - win.y0));
    let frac = 0.1 + 0.42 * t * t;
    if (
      cloudBounds &&
      x > cloudBounds.x0 - cloudSoft &&
      x < cloudBounds.x1 + cloudSoft &&
      y > cloudBounds.y0 - cloudSoft &&
      y < cloudBounds.y1 + cloudSoft
    )
      frac *= clamp01(0.5 + unionD(clouds, x, y) / Math.max(cloudSoft, px));
    const sky = lines(y, px, g, frac);
    return sky + (ground - sky) * land;
  };

  const cells = grid(W, H);
  const frameAt = layer(frame, cells, px);
  const motifAt = layer(pen.shapes, cells, px);
  const clip = window(0.009);
  const clipIn = regions(clip, cells, px);
  const centerAt = (x: number, y: number) => {
    const cell = cells.cell(x, y);
    const where = clipIn[cell];
    if (where < 0) return 0;
    const ink = motifAt(cell, x, y, px, background(x, y, px));
    return where > 0 ? ink : ink * cover(unionD(clip, x, y), px);
  };
  const framePlate = (x: number, y: number) =>
    frameAt(cells.cell(x, y), x, y, px, 0);

  const {
    frame: framePasses,
    center: centerPasses,
    fold,
  } = printing(seed, W, H);
  // How much ink a plate's impressions leave at a point on the paper.
  const plate = (
    at: (x: number, y: number) => number,
    passes: Impression[],
    x: number,
    y: number,
  ) => {
    let left = 1;
    for (const { dx, dy, invert, strength, fade } of passes) {
      let k = strength;
      if (fade)
        k *= clamp01((fade.nx * x + fade.ny * y - fade.at) / fade.width);
      if (k <= 0) continue;
      left *=
        1 -
        k * at((invert ? 2 * cx - x : x) - dx, (invert ? 2 * cy - y : y) - dy);
    }
    return 1 - left;
  };

  // A crease's darkening `w` wide, its weight kept the same at any sample size.
  const crease = (s: number, w: number) => {
    const wide = Math.max(w, px);
    return (clamp01(1 - Math.abs(s) / wide) * w) / wide;
  };

  const image = ctx.createImageData(width, height);
  const data = image.data;
  const sum = [0, 0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      sum[0] = sum[1] = sum[2] = 0;
      for (let j = 0; j < ss; j++) {
        const sy = (y * ss + j + 0.5) * px;
        for (let i = 0; i < ss; i++) {
          const sx = (x * ss + i + 0.5) * px;
          let f = 0;
          let c = 0;
          let shade = 1;
          if (!fold) {
            f = plate(framePlate, framePasses, sx, sy);
            c = plate(centerAt, centerPasses, sx, sy);
          } else {
            // Paper before the fold prints where it lies, the band under the fold doesn't print, and paper beyond
            // it printed where it lay folded back, the band's width over.
            const s = fold.nx * sx + fold.ny * sy - fold.at;
            const before = cover(s, px);
            const after = cover(fold.width - s, px);
            if (before > 0) {
              f += before * plate(framePlate, framePasses, sx, sy);
              c += before * plate(centerAt, centerPasses, sx, sy);
            }
            if (after > 0) {
              const qx = sx - fold.nx * fold.width;
              const qy = sy - fold.ny * fold.width;
              f += after * plate(framePlate, framePasses, qx, qy);
              c += after * plate(centerAt, centerPasses, qx, qy);
            }
            shade =
              1 -
              0.035 * (1 - before - after) -
              0.16 * crease(s, 0.003) -
              0.1 * crease(s - fold.width / 2, 0.003) -
              0.16 * crease(s - fold.width, 0.003);
          }
          for (let k = 0; k < 3; k++)
            sum[k] +=
              paperRgb[k] *
              (1 - f * (1 - frameShare[k])) *
              (1 - c * (1 - centerShare[k])) *
              shade;
        }
      }
      const p = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) data[p + k] = Math.round(sum[k] / (ss * ss));
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export const philatelicError1: Style = {
  id: "error1",
  draw,
};
