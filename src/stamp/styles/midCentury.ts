import type { Palette } from "../palettes";
import { pick, stream } from "../random";
import type { Style } from "../sources";

// Mid-century illustration: one composed subject (a bird on a branch, a rocket in a starry sky, or a modernist
// house among trees) built from flat shapes, printed as if from separate plates. The subject's dark key plate
// sits true while its color plate is offset, so a sliver of key shows along one side. Patterns and a grain give
// the ink texture.
//
// Like land1 it computes every pixel itself from signed distances to shapes, so it is resolution independent
// and its pixels are identical in every browser and in Node, which the golden test relies on (ADR 0001). Only
// IEEE-exact arithmetic here: no Math.sin, Math.pow or the like. Rotations come from slopes, not angles.
//
// Art units: the art's shorter side is 1, centered on the origin with v down. Subjects compose inside the
// central unit square, and backgrounds run out to the art's edges, so every aspect and margin frames them.

type Rgb = [number, number, number];

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const len = (x: number, y: number) => Math.sqrt(x * x + y * y);

// A shape: the signed distance from a point to its edge in art units, negative inside, and a box bounding it
// as [u0, v0, u1, v1]. Distances may run short outside corners, which only softens antialiasing there.
type Shape = { d: (u: number, v: number) => number; box: number[] };

const circle = (cx: number, cy: number, r: number): Shape => ({
  d: (u, v) => len(u - cx, v - cy) - r,
  box: [cx - r, cy - r, cx + r, cy + r],
});

// An approximate ellipse distance, close to exact near the edge, which is all antialiasing needs.
const ellipse = (cx: number, cy: number, rx: number, ry: number): Shape => ({
  d: (u, v) => {
    const [x, y] = [(u - cx) / rx, (v - cy) / ry];
    const k1 = len(x / rx, y / ry);
    if (k1 === 0) return -Math.min(rx, ry);
    const k0 = len(x, y);
    return (k0 * (k0 - 1)) / k1;
  },
  box: [cx - rx, cy - ry, cx + rx, cy + ry],
});

// A rectangle from its center and half sizes, with corners rounded by `r`.
const rect = (
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  r = 0,
): Shape => ({
  d: (u, v) => {
    const qx = Math.abs(u - cx) - hw + r;
    const qy = Math.abs(v - cy) - hh + r;
    return (
      len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
    );
  },
  box: [cx - hw, cy - hh, cx + hw, cy + hh],
});

// A stroke from a to b with round ends.
const line = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
): Shape => {
  const [ex, ey] = [bx - ax, by - ay];
  const ee = ex * ex + ey * ey;
  return {
    d: (u, v) => {
      const [px, py] = [u - ax, v - ay];
      const t = clamp01((px * ex + py * ey) / ee);
      return len(px - ex * t, py - ey * t) - r;
    },
    box: [
      Math.min(ax, bx) - r,
      Math.min(ay, by) - r,
      Math.max(ax, bx) + r,
      Math.max(ay, by) + r,
    ],
  };
};

// A convex polygon from its corners, in either winding.
const poly = (...points: [number, number][]): Shape => {
  let area = 0;
  points.forEach(([x0, y0], i) => {
    const [x1, y1] = points[(i + 1) % points.length];
    area += x0 * y1 - x1 * y0;
  });
  const sign = area > 0 ? 1 : -1;
  const edges = points.map(([x0, y0], i) => {
    const [x1, y1] = points[(i + 1) % points.length];
    const l = len(x1 - x0, y1 - y0);
    return [x0, y0, (sign * (y1 - y0)) / l, (sign * (x0 - x1)) / l];
  });
  const us = points.map((p) => p[0]);
  const vs = points.map((p) => p[1]);
  return {
    d: (u, v) => {
      let d = -Infinity;
      for (const [x, y, nx, ny] of edges)
        d = Math.max(d, (u - x) * nx + (v - y) * ny);
      return d;
    },
    box: [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)],
  };
};

// A pointed leaf or arch: the lens between two circles, tips at (±l/2, 0) and `w` wide, centered on the origin.
const lens = (l: number, w: number): Shape => {
  const r = (l * l + w * w) / (4 * w);
  return intersect(circle(0, r - w / 2, r), circle(0, w / 2 - r, r));
};

// Everything below v0 (larger v), or above it.
const below = (v0: number): Shape => ({
  d: (_, v) => v0 - v,
  box: [-Infinity, v0, Infinity, Infinity],
});
const above = (v0: number): Shape => ({
  d: (_, v) => v - v0,
  box: [-Infinity, -Infinity, Infinity, v0],
});

// Plain loops in the distance functions: they run for every pixel a shape's box touches.
const union = (...shapes: Shape[]): Shape => ({
  d: (u, v) => {
    let d = Infinity;
    for (const s of shapes) d = Math.min(d, s.d(u, v));
    return d;
  },
  box: [0, 1, 2, 3].map((i) =>
    (i < 2 ? Math.min : Math.max)(...shapes.map((s) => s.box[i])),
  ),
});
const intersect = (...shapes: Shape[]): Shape => ({
  d: (u, v) => {
    let d = -Infinity;
    for (const s of shapes) d = Math.max(d, s.d(u, v));
    return d;
  },
  box: [0, 1, 2, 3].map((i) =>
    (i < 2 ? Math.max : Math.min)(...shapes.map((s) => s.box[i])),
  ),
});
const subtract = (a: Shape, b: Shape): Shape => ({
  d: (u, v) => Math.max(a.d(u, v), -b.d(u, v)),
  box: a.box,
});
// The outline of a shape, `r` either side of its edge.
const ring = (s: Shape, r: number): Shape => ({
  d: (u, v) => Math.abs(s.d(u, v)) - r,
  box: [s.box[0] - r, s.box[1] - r, s.box[2] + r, s.box[3] + r],
});

// A rotation from a slope: turning (1, 0) toward (1, t), clockwise on screen for positive t.
type Turn = { c: number; s: number };
const turn = (t: number): Turn => {
  const l = len(1, t);
  return { c: 1 / l, s: t / l };
};
const STRAIGHT: Turn = { c: 1, s: 0 };

// A shape drawn in its own frame, placed at (x, y), turned, scaled by k, and mirrored left to right if `flip`.
// An unbounded shape, such as a half plane, stays unbounded.
type Frame = { x: number; y: number; turn: Turn; k: number; flip: boolean };
const place = (
  shape: Shape,
  { x, y, turn: { c, s }, k, flip }: Frame,
): Shape => {
  const f = flip ? -1 : 1;
  const [u0, v0, u1, v1] = shape.box;
  const bounded = shape.box.every(Number.isFinite);
  const corners = [
    [u0, v0],
    [u1, v0],
    [u0, v1],
    [u1, v1],
  ].map(([lu, lv]) => [
    x + k * (c * f * lu - s * lv),
    y + k * (s * f * lu + c * lv),
  ]);
  return {
    d: (u, v) => {
      const [du, dv] = [(u - x) / k, (v - y) / k];
      return k * shape.d(f * (c * du + s * dv), c * dv - s * du);
    },
    box: bounded
      ? [
          Math.min(...corners.map((p) => p[0])),
          Math.min(...corners.map((p) => p[1])),
          Math.max(...corners.map((p) => p[0])),
          Math.max(...corners.map((p) => p[1])),
        ]
      : [-Infinity, -Infinity, Infinity, Infinity],
  };
};
const shift = (shape: Shape, dx: number, dy: number): Shape =>
  place(shape, { x: dx, y: dy, turn: STRAIGHT, k: 1, flip: false });

// A pattern printed over a shape in a second ink: how much of that ink covers a point, given the pixel size
// `px` in art units. Detail finer than a few pixels fades to its average cover, so small draws match large
// ones scaled down rather than aliasing.
type Pattern = (u: number, v: number, px: number) => number;
const sharpness = (period: number, px: number) => clamp01(period / px / 2 - 1);

// Bands `period` apart, stepping along the direction `dir`, covering `share` of the shape.
const stripes = (period: number, share: number, dir: Turn): Pattern => {
  return (u, v, px) => {
    const f = (dir.c * u + dir.s * v) / period;
    const d = (Math.abs(f - Math.floor(f) - 0.5) - share / 2) * period;
    const sharp = sharpness(period, px);
    return share + (clamp01(0.5 - d / px) - share) * sharp;
  };
};

// Dots of radius r on a square grid `period` apart.
const dots = (period: number, r: number): Pattern => {
  const share = (3.141592653589793 * r * r) / (period * period);
  return (u, v, px) => {
    const [fu, fv] = [u / period, v / period];
    const d =
      len(fu - Math.floor(fu) - 0.5, fv - Math.floor(fv) - 0.5) * period - r;
    const sharp = sharpness(period, px);
    return share + (clamp01(0.5 - d / px) - share) * sharp;
  };
};

// Smooth value noise in [0, 1] on a grid of `cell`-sized squares, from an integer hash of each grid point.
function noise(seed: number, cell: number): (u: number, v: number) => number {
  const at = (i: number, j: number) => {
    let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ seed;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  };
  return (u, v) => {
    const [x, y] = [u / cell, v / cell];
    const [i, j] = [Math.floor(x), Math.floor(y)];
    const [fx, fy] = [x - i, y - j];
    const [sx, sy] = [fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)];
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
    const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return top + (bottom - top) * sy;
  };
}

// A layer: a shape printed in one ink, with an optional pattern in a second ink over it.
type Layer = { shape: Shape; ink: Rgb; pattern?: Pattern; over?: Rgb };

// What a subject draws with: the palette's colors, the art's half extents, randomness, and the plates.
type Kit = {
  rand: () => number;
  paper: Rgb;
  dark: Rgb;
  // Three color roles from the palette's lighter inks and a tint of its dark one, in a seeded order.
  ink: [Rgb, Rgb, Rgb];
  tint: (ink: Rgb, t: number) => Rgb;
  // Half the art's width and height in art units.
  w: number;
  h: number;
  // Printed true: backgrounds and key details.
  print: (shape: Shape, ink: Rgb, pattern?: Pattern, over?: Rgb) => void;
  // Printed on the offset color plate.
  color: (shape: Shape, ink: Rgb, pattern?: Pattern, over?: Rgb) => void;
};

const between = (rand: () => number, a: number, b: number) =>
  a + (b - a) * rand();

// A bird perched on a branch in front of a big sun, with leaves.
function bird(kit: Kit): Rgb {
  const { rand, paper, dark, ink, tint, w, print, color } = kit;
  const [body, accent, warm] = ink;
  print(
    circle(
      between(rand, -0.25, 0.25),
      between(rand, -0.3, -0.15),
      between(rand, 0.22, 0.3),
    ),
    tint(warm, 0.55),
  );

  const perch = between(rand, 0.27, 0.33);
  const lean = between(rand, -0.06, 0.06);
  const branch = line(-w - 0.05, perch - lean, w + 0.05, perch + lean, 0.017);
  const slope = lean / (w + 0.05);
  const at = (u: number) => perch + slope * u;
  const leaves = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < leaves; i++) {
    const u = -w + ((i + 0.5 + between(rand, -0.3, 0.3)) / leaves) * 2 * w;
    const t = between(rand, -1.6, 1.6);
    const l = between(rand, 0.12, 0.17);
    const leaf = place(shift(lens(l, l * 0.42), l / 2 - 0.012, 0), {
      x: u,
      y: at(u),
      turn: turn(t),
      k: 1,
      flip: rand() < 0.5,
    });
    color(leaf, i % 2 ? accent : tint(accent, 0.6));
  }
  print(branch, dark);

  // The bird in its own frame, facing right, its feet at v = 0.29.
  const k = between(rand, 0.9, 1.1);
  const tail = between(rand, 0.32, 0.4);
  const tilt = turn(between(rand, -0.35, -0.15));
  const torso = place(ellipse(0, 0, 0.2, 0.13), {
    x: 0.01,
    y: 0.08,
    turn: tilt,
    k: 1,
    flip: false,
  });
  const head = circle(0.15, -0.06, between(rand, 0.075, 0.09));
  const tailShape = poly(
    [-0.1, 0.04],
    [-tail, -0.07],
    [-tail + 0.03, 0.02],
    [-0.08, 0.15],
  );
  const beak = poly([0.21, -0.09], [0.31, -0.055], [0.21, -0.035]);
  const wing = place(shift(lens(0.26, 0.11), -0.13, 0), {
    x: 0.08,
    y: 0.04,
    turn: turn(between(rand, 0.12, 0.3)),
    k: 1,
    flip: false,
  });
  const breast = intersect(torso, circle(0.12, 0.17, 0.15));
  const legs = [-0.02, 0.04].map((u) => line(u, 0.17, u + 0.01, 0.29, 0.009));
  const eye = circle(0.165, -0.075, 0.021);

  // Set on the branch at its slope, feet just into it.
  const x = between(rand, -0.06, 0.06);
  const frame: Frame = {
    x,
    y: at(x) - k * 0.29 + 0.008,
    turn: turn(slope),
    k,
    flip: rand() < 0.5,
  };
  const pat = pick(
    [stripes(0.03, 0.4, turn(-0.4)), dots(0.034, 0.008), undefined],
    rand,
  );
  for (const leg of legs) print(place(leg, frame), dark);
  print(place(union(torso, head, tailShape, beak), frame), dark);
  color(place(union(torso, head), frame), body);
  color(place(tailShape, frame), accent, pat, tint(accent, 0.4));
  color(place(breast, frame), tint(warm, 0.7));
  color(place(beak, frame), warm);
  color(place(wing, frame), accent, pat, tint(accent, 0.4));
  print(place(eye, frame), paper);
  print(place(circle(0.17, -0.075, 0.01), frame), dark);
  return tint(accent, 0.22);
}

// A rocket climbing a night sky past stars and a ringed planet.
function rocket(kit: Kit): Rgb {
  const { rand, paper, dark, ink, tint, w, h, print, color } = kit;
  const [hull, trim, flame] = ink;
  const stars = 14 + Math.floor(rand() * 10);
  for (let i = 0; i < stars; i++) {
    const [x, y] = [between(rand, -w, w), between(rand, -h, h)];
    const r = between(rand, 0.006, 0.016);
    const star =
      r > 0.011
        ? union(
            poly(
              [x - r * 2.2, y],
              [x, y - r * 0.5],
              [x + r * 2.2, y],
              [x, y + r * 0.5],
            ),
            poly(
              [x, y - r * 2.2],
              [x + r * 0.5, y],
              [x, y + r * 2.2],
              [x - r * 0.5, y],
            ),
          )
        : circle(x, y, r * 0.6);
    print(star, i % 3 ? paper : tint(flame, 0.7));
  }

  // The planet, its ring behind it and then in front.
  const side = rand() < 0.5 ? -1 : 1;
  const [px, py, pr] = [
    side * between(rand, 0.22, 0.32),
    between(rand, -0.32, -0.18),
    between(rand, 0.08, 0.12),
  ];
  const ringTurn = turn(between(rand, -0.5, 0.5));
  const band = place(ring(ellipse(0, 0, pr * 1.9, pr * 0.42), pr * 0.08), {
    x: px,
    y: py,
    turn: ringTurn,
    k: 1,
    flip: false,
  });
  const planet = circle(px, py, pr);
  print(band, tint(trim, 0.7));
  print(
    planet,
    trim,
    stripes(pr * 0.5, 0.35, turn(ringTurn.s / ringTurn.c)),
    tint(trim, 0.6),
  );
  print(
    intersect(
      band,
      union(
        place(below(0), { x: px, y: py, turn: ringTurn, k: 1, flip: false }),
        subtract(band, circle(px, py, pr + 0.01)),
      ),
    ),
    tint(trim, 0.7),
  );

  // The rocket in its own frame, nose up, centered on its body.
  const hw = 0.085;
  const r = 0.3;
  const shoulder = -0.1;
  // The nose runs a little way into the hull, so their union has no seam where both edges meet.
  const nose = intersect(
    circle(r - hw, shoulder, r),
    circle(hw - r, shoulder, r),
    above(shoulder + 0.03),
  );
  const body = union(nose, rect(0, 0.05, hw, 0.15));
  const fin = poly(
    [-hw, 0.04],
    [-hw - 0.085, 0.17],
    [-hw - 0.085, 0.25],
    [-hw, 0.19],
  );
  const fins = union(
    fin,
    place(fin, { x: 0, y: 0, turn: STRAIGHT, k: 1, flip: true }),
  );
  const fire = union(
    circle(0, 0.25, 0.055),
    poly([-0.055, 0.25], [0, between(rand, 0.4, 0.46)], [0.055, 0.25]),
  );
  const core = union(
    circle(0, 0.25, 0.028),
    poly([-0.028, 0.25], [0, 0.34], [0.028, 0.25]),
  );
  const frame: Frame = {
    x: between(rand, -0.08, 0.08),
    y: 0.01,
    turn: turn(between(rand, -0.35, 0.35)),
    k: between(rand, 0.9, 1.05),
    flip: false,
  };
  const at = (s: Shape) => place(s, frame);
  const porthole = circle(0, -0.04, 0.042);
  color(at(fire), flame);
  print(at(core), tint(flame, 0.35));
  // On a dark sky the key plate is paper, so the offset shows as a light edge.
  print(at(union(body, fins)), paper);
  color(
    at(body),
    hull,
    pick([undefined, stripes(0.05, 0.3, STRAIGHT)], rand),
    tint(hull, 0.8),
  );
  color(at(intersect(body, above(-0.16))), trim);
  color(at(intersect(body, rect(0, 0.1, hw, 0.025))), trim);
  color(at(fins), trim);
  print(at(porthole), dark);
  color(at(circle(0, -0.04, 0.03)), tint(flame, 0.45));
  print(at(circle(-0.01, -0.052, 0.009)), paper);
  print(at(rect(0, 0.15, 0.011, 0.05, 0.011)), dark);
  return dark;
}

// A modernist house on stilts under a slanted roof, with trees on the lawn.
function house(kit: Kit): Rgb {
  const { rand, paper, dark, ink, tint, w, h, print, color } = kit;
  const [wall, leafy, sun] = ink;
  print(
    circle(
      between(rand, -0.3, 0.3),
      between(rand, -0.3, -0.2),
      between(rand, 0.09, 0.13),
    ),
    sun,
  );
  for (let i = 0, n = 1 + Math.floor(rand() * 2); i < n; i++) {
    const [x, y] = [
      between(rand, -w + 0.1, w - 0.1),
      between(rand, -0.38, -0.2),
    ];
    const l = between(rand, 0.08, 0.13);
    print(
      union(
        rect(x, y, l, 0.022, 0.022),
        rect(x + l * 0.2, y - 0.025, l * 0.5, 0.025, 0.025),
      ),
      paper,
    );
  }
  const ground = between(rand, 0.2, 0.26);
  print(
    rect(0, (ground + h) / 2 + 0.01, w + 0.01, (h - ground) / 2 + 0.01),
    tint(leafy, 0.65),
    stripes(0.04, 0.25, turn(0.15)),
    tint(leafy, 0.85),
  );

  // Trees either side, trunk first.
  const x0 = between(rand, -0.05, 0.05);
  const hw = between(rand, 0.24, 0.29);
  for (const side of [-1, 1]) {
    const x = x0 + side * (hw + between(rand, 0.11, 0.16));
    const top = ground - between(rand, 0.28, 0.38);
    print(line(x, ground, x, top + 0.08, 0.015), dark);
    const crown =
      rand() < 0.5
        ? ellipse(x, top + 0.06, 0.075, 0.1)
        : poly(
            [x, top - 0.04],
            [x + 0.08, ground - 0.07],
            [x - 0.08, ground - 0.07],
          );
    color(
      crown,
      side < 0 ? leafy : tint(leafy, 0.6),
      stripes(0.03, 0.35, turn(1.2 * side)),
      tint(leafy, 0.35),
    );
  }

  // The house, standing on the ground.
  const [floor, ceiling] = [ground - 0.07, ground - between(rand, 0.3, 0.36)];
  const box = rect(x0, (floor + ceiling) / 2, hw, (floor - ceiling) / 2);
  const pitch = between(rand, 0.06, 0.12) * (rand() < 0.5 ? -1 : 1);
  const butterfly = rand() < 0.5;
  const eave = hw + 0.05;
  const slab = (a: number, b: number, ya: number, yb: number) =>
    poly([a, ya - 0.025], [b, yb - 0.025], [b, yb + 0.005], [a, ya + 0.005]);
  const roof = butterfly
    ? union(
        slab(x0 - eave, x0, ceiling - Math.abs(pitch), ceiling),
        slab(x0, x0 + eave, ceiling, ceiling - Math.abs(pitch)),
      )
    : slab(x0 - eave, x0 + eave, ceiling + pitch / 2, ceiling - pitch / 2);
  for (const u of [-0.7, 0, 0.7])
    print(line(x0 + u * hw, floor, x0 + u * hw, ground, 0.011), dark);
  print(union(box, roof), dark);
  color(box, paper);
  const panes = 3 + Math.floor(rand() * 3);
  const door = Math.floor(rand() * panes);
  const pane = (2 * hw - 0.04) / panes;
  for (let i = 0; i < panes; i++) {
    const cx = x0 - hw + 0.02 + pane * (i + 0.5);
    const shape = rect(
      cx,
      (floor + ceiling) / 2 + 0.01,
      pane / 2 - 0.008,
      (floor - ceiling) / 2 - 0.03,
    );
    if (i === door) color(shape, wall);
    else
      color(
        shape,
        tint(sun, 0.45),
        stripes(0.05, 0.2, turn(-1)),
        tint(sun, 0.15),
      );
  }
  print(rect(x0 + hw * 0.55, ceiling - 0.05, 0.022, 0.04), dark);
  return tint(wall, 0.25);
}

const SUBJECTS = [bird, rocket, house];

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  palette: Palette,
) {
  const rand = stream(seed, 0);
  const paper = rgb(palette.paper);
  const [dark, ...rest] = palette.inks.map(rgb);
  // Shuffle the lighter inks and add a tint of the dark one, so even a two-ink palette has two colors to
  // set against each other, then repeat them to fill three roles.
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  rest.push(mix(paper, dark, 0.55));
  const ink: [Rgb, Rgb, Rgb] = [0, 1, 2].map((i) => rest[i % rest.length]) as [
    Rgb,
    Rgb,
    Rgb,
  ];

  // The color plate's offset from the key plate, in art units.
  const off = between(rand, 0.007, 0.013);
  const [ox, oy] = [
    off * (rand() < 0.5 ? -1 : 1),
    off * (rand() < 0.5 ? -1 : 1),
  ];

  const unit = Math.min(width, height);
  const [w, h] = [width / 2 / unit, height / 2 / unit];
  const layers: Layer[] = [];
  const subject = pick(SUBJECTS, rand);
  const background = subject({
    rand,
    paper,
    dark,
    ink,
    tint: (c, t) => mix(paper, c, t),
    w,
    h,
    print: (shape, ink, pattern, over) =>
      layers.push({ shape, ink, pattern, over }),
    color: (shape, ink, pattern, over) =>
      layers.push({ shape: shift(shape, ox, oy), ink, pattern, over }),
  });

  // Grain: a coarse mottle and a finer tooth, in levels either side of the printed color. Each pixel averages
  // the noise over its area, sampled finely enough for the cell, so a small draw shows the grain a large one
  // does once scaled down.
  const px = 1 / unit;
  const grain = [
    { cell: 0.03, amount: 14 },
    { cell: 0.006, amount: 12 },
  ].map(({ cell, amount }) => {
    const n = noise(Math.floor(rand() * 2 ** 32), cell);
    const s = Math.min(4, Math.ceil((2 * px) / cell));
    const at = (i: number) => ((i + 0.5) / s - 0.5) * px;
    return (u: number, v: number) => {
      let sum = 0;
      for (let i = 0; i < s; i++)
        for (let j = 0; j < s; j++) sum += n(u + at(i), v + at(j));
      return (sum / (s * s) - 0.5) * amount;
    };
  });

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / unit - h;
    const row = layers.filter(
      ({ shape: { box } }) => box[1] - px <= v && v <= box[3] + px,
    );
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / unit - w;
      let color = background;
      for (const { shape, ink, pattern, over } of row) {
        const { box } = shape;
        if (u < box[0] - px || u > box[2] + px) continue;
        const cover = clamp01(0.5 - shape.d(u, v) / px);
        if (cover === 0) continue;
        const printed =
          pattern && over ? mix(ink, over, pattern(u, v, px)) : ink;
        color = mix(color, printed, cover);
      }
      let g = 0;
      for (const n of grain) g += n(u, v);
      const p = (y * width + x) * 4;
      data[p] = Math.round(color[0] + g);
      data[p + 1] = Math.round(color[1] + g);
      data[p + 2] = Math.round(color[2] + g);
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export const midCentury1: Style = {
  id: "mid1",
  draw,
};
