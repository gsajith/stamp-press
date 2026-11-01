import type { Palette } from "../palettes";
import { stream, subSeed } from "../random";
import type { Style } from "../sources";

// Island survey: the survey sheet of an island that doesn't exist. Contour lines ring the hills, every fifth
// one heavier, rivers run down from the high ground to the coast, spot heights mark the summits, settlements
// sit on the flat coast, and a compass rose stands in a corner of the sea, all inside a ruled frame.
//
// The height field is warped noise over one or two mounds that fall off toward the frame. It's sampled once on a
// grid fixed in map units (see mapUnits) and read back through a cubic B-spline, so contours stay smooth at any
// size and the picture doesn't depend on the pixel count. Sizes of lines and marks are in art units, where the
// art's short side is 1. Every pixel is computed here, so pixels match in every browser and in Node, which the
// golden test relies on (ADR 0001). Only IEEE-exact arithmetic: no Math.sin, Math.pow or the like.

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

// A float in [0, 1) for each lattice point, the "lowbias32" hash of its coordinates and a salt.
function hash2(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ salt;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Smooth 2D value noise in [0, 1], one lattice cell per unit.
function noise2(x: number, y: number, salt: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, salt);
  const b = hash2(ix + 1, iy, salt);
  const c = hash2(ix, iy + 1, salt);
  const d = hash2(ix + 1, iy + 1, salt);
  const top = a + (b - a) * sx;
  return top + (c + (d - c) * sx - top) * sy;
}

// `octaves` of noise2, each twice the frequency and half the weight of the last, in [0, 1].
function fbm(x: number, y: number, salt: number, octaves: number): number {
  let sum = 0;
  let weight = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += weight * noise2(x, y, salt + o);
    total += weight;
    weight *= 0.5;
    // Turn each octave off the last one's lattice so their grid lines don't stack.
    const turned = 1.6 * x + 1.2 * y + 5.3;
    y = 1.6 * y - 1.2 * x + 9.1;
    x = turned;
  }
  return sum / total;
}

// The ruled frame, in art units from the art's edge: an outer rule, a band of alternating blocks, then the neat
// line that bounds the map. Full-bleed stamps lose up to about 0.04 to the punch, so the outer rule sits inside.
const OUTER = 0.055;
const BAND = 0.014;
const NEAT = OUTER + BAND;
// How far land stays from the neat line.
const CLEAR = 0.035;

// Tries at an island before the last one is forced to fit.
const TRIES = 8;

// Height samples per map unit. The B-spline smooths away anything finer than a couple of samples.
const G = 64;

// The height field: samples on the grid, with node (i, j) at ((i - 1) / G, (j - 1) / G), scaled so the summit
// is 1 and sea level is 0.
type Field = { h: Float64Array; nx: number; ny: number };

// One try at an island on a map `mw` by `mh`, or null when it touches the frame or is too small or large for the
// map. With `force` it always returns one, pressing any land near the frame down under the sea.
function island(
  seed: number,
  mw: number,
  mh: number,
  force = false,
): Field | null {
  const rand = stream(seed, 0x51ab);
  const salt = () => Math.floor(rand() * 2 ** 32);
  const [warpSalt, heightSalt] = [salt(), salt()];
  // The island rises from one or two overlapping mounds, each an ellipse along a random direction.
  const size = Math.min(mw, mh);
  const lobes = Array.from({ length: rand() < 0.45 ? 2 : 1 }, (_, k) => {
    let [ux, uy] = [rand() - 0.5, rand() - 0.5];
    const len = Math.sqrt(ux * ux + uy * uy) || 1;
    [ux, uy] = [ux / len, uy / len];
    const along = size * (k ? 0.2 + 0.1 * rand() : 0.3 + 0.14 * rand());
    return {
      x: mw * (k ? 0.25 + 0.5 * rand() : 0.4 + 0.2 * rand()),
      y: mh * (k ? 0.25 + 0.5 * rand() : 0.4 + 0.2 * rand()),
      ux,
      uy,
      along,
      across: along * (0.55 + 0.45 * rand()),
      peak: 1,
    };
  });
  // Some islands have islets offshore: small, low mounds of their own.
  const islets = rand() < 0.5 ? 0 : 1 + Math.floor(rand() * 3);
  for (let k = 0; k < islets; k++) {
    const along = 0.025 + 0.035 * rand();
    lobes.push({
      x: mw * (0.15 + 0.7 * rand()),
      y: mh * (0.15 + 0.7 * rand()),
      ux: 1,
      uy: 0,
      along,
      across: along,
      peak: 0.45,
    });
  }
  const warp = 0.14 + 0.16 * rand();
  const freq = 1.8 + 1.6 * rand();
  const rough = 0.6 + 0.4 * rand();

  const height = (x: number, y: number) => {
    const wx = x + warp * (fbm(x * 2.5, y * 2.5, warpSalt, 3) - 0.5);
    const wy = y + warp * (fbm(x * 2.5, y * 2.5, warpSalt + 7, 3) - 0.5);
    const n = fbm(wx * freq, wy * freq, heightSalt, 4);
    let mound = -Infinity;
    for (const m of lobes) {
      const dx = wx - m.x;
      const dy = wy - m.y;
      const a = (dx * m.ux + dy * m.uy) / m.along;
      const b = (dy * m.ux - dx * m.uy) / m.across;
      mound = Math.max(mound, m.peak * (1 - a * a - b * b));
    }
    return 0.4 * mound + rough * (n - 0.5);
  };

  const nx = Math.ceil(mw * G) + 4;
  const ny = Math.ceil(mh * G) + 4;
  const h = new Float64Array(nx * ny);
  let [top, land, inside] = [0, 0, 0];
  // The samples near or outside the frame go first, since land there is the usual reason to give up.
  for (const nearFrame of [true, false])
    for (let j = 0; j < ny; j++) {
      const y = (j - 1) / G;
      for (let i = 0; i < nx; i++) {
        const x = (i - 1) / G;
        // How far inside the map this sample sits, negative outside it.
        const edge = Math.min(x, mw - x, y, mh - y);
        if (edge < CLEAR + 2 / G !== nearFrame) continue;
        let v = height(x, y);
        if (nearFrame && v > 0) {
          if (!force) return null;
          v = Math.min(v, edge - CLEAR - 3 / G);
        }
        h[j * nx + i] = v;
        if (v > top) top = v;
        if (edge > 0) {
          inside++;
          if (v > 0) land++;
        }
      }
    }
  const share = land / inside;
  if (!force && (share < 0.12 || share > 0.5)) return null;
  // Scaled so the summit is 1, then land flattened toward the coast and steepened toward the peaks.
  for (let k = 0; k < h.length; k++) {
    const v = h[k] / (top > 0 ? top : 1);
    h[k] = v > 0 ? v * (0.3 + 0.7 * v) : v;
  }
  return { h, nx, ny };
}

// Islands that touch the frame, or fill too little or too much of it, are redrawn from a derived seed. The
// last try always stands, pressed down near the frame.
function fitIsland(seed: number, mw: number, mh: number): Field {
  for (let t = 1; t < TRIES; t++) {
    const field = island(subSeed(seed, t), mw, mh);
    if (field) return field;
  }
  return island(subSeed(seed, TRIES), mw, mh, true)!;
}

// The map's size in map units, which depends only on whether the art is portrait, square or landscape. Islands,
// summits, rivers, settlements and the rose are all placed in map units, by tests against the height field, so
// the same seed makes the same choices at 256 px and 2048 px even though the art's exact aspect differs a little
// between them. Drawing then stretches map units onto the art's map by a few percent at most.
function mapUnits(W: number, H: number): [number, number] {
  const aspect = W / H;
  const side = 1 - 2 * NEAT;
  // Portrait and landscape maps run from about 0.68 to 0.75 between their short and long sides.
  if (aspect < 0.89) return [side, side / 0.72];
  if (aspect > 1.12) return [side / 0.72, side];
  return [side, side];
}

// The cubic B-spline weights for a sample at `f` between nodes 1 and 2 of four, and their derivatives.
function basis(f: number, w: Float64Array, d: Float64Array) {
  const g = 1 - f;
  const f2 = f * f;
  w[0] = (g * g * g) / 6;
  w[1] = (3 * f2 * f - 6 * f2 + 4) / 6;
  w[2] = (-3 * f2 * f + 3 * f2 + 3 * f + 1) / 6;
  w[3] = (f2 * f) / 6;
  d[0] = (-g * g) / 2;
  d[1] = (3 * f2 - 4 * f) / 2;
  d[2] = (-3 * f2 + 2 * f + 1) / 2;
  d[3] = f2 / 2;
}

// Reads the field at a point: its height and the length and direction of its slope, per art unit.
function sampler({ h, nx, ny }: Field) {
  const [wx, dx, wy, dy] = [0, 0, 0, 0].map(() => new Float64Array(4));
  const out = { h: 0, gx: 0, gy: 0 };
  return (x: number, y: number) => {
    const tx = x * G + 1;
    const ty = y * G + 1;
    const ix = Math.min(Math.max(Math.floor(tx), 1), nx - 3);
    const iy = Math.min(Math.max(Math.floor(ty), 1), ny - 3);
    basis(tx - ix, wx, dx);
    basis(ty - iy, wy, dy);
    let v = 0;
    let gx = 0;
    let gy = 0;
    for (let b = 0; b < 4; b++) {
      const row = (iy - 1 + b) * nx + ix - 1;
      let r = 0;
      let rd = 0;
      for (let a = 0; a < 4; a++) {
        const s = h[row + a];
        r += wx[a] * s;
        rd += dx[a] * s;
      }
      v += wy[b] * r;
      gx += wy[b] * rd;
      gy += dy[b] * r;
    }
    out.h = v;
    out.gx = gx * G;
    out.gy = gy * G;
    return out;
  };
}
type Sample = ReturnType<typeof sampler>;

// Reads the same field at every pixel center, a row at a time. The B-spline collapses along y once per row and
// each column's x weights are worked out once, so a pixel only blends four values, where `sampler` blends 16.
// Pixel columns are `px` art units wide, and map unit x sits at art unit x0 + x * scale.
function rasterSampler(
  { h, nx, ny }: Field,
  width: number,
  px: number,
  x0: number,
  scale: number,
) {
  const first = new Int32Array(width);
  const wx = new Float64Array(width * 4);
  const dx = new Float64Array(width * 4);
  const [w, d] = [new Float64Array(4), new Float64Array(4)];
  for (let c = 0; c < width; c++) {
    const t = (((c + 0.5) * px - x0) / scale) * G + 1;
    const i = Math.min(Math.max(Math.floor(t), 1), nx - 3);
    basis(t - i, w, d);
    first[c] = i - 1;
    wx.set(w, c * 4);
    dx.set(d, c * 4);
  }
  // The field along the current row, and its y slope, at every grid column.
  const col = new Float64Array(nx);
  const colY = new Float64Array(nx);
  const out = { h: 0, gx: 0, gy: 0 };
  return {
    // Moves to the row at map unit y.
    row(y: number) {
      const t = y * G + 1;
      const j = Math.min(Math.max(Math.floor(t), 1), ny - 3);
      basis(t - j, w, d);
      const r = (j - 1) * nx;
      for (let i = 0; i < nx; i++) {
        const a = h[r + i];
        const b = h[r + nx + i];
        const c = h[r + 2 * nx + i];
        const e = h[r + 3 * nx + i];
        col[i] = w[0] * a + w[1] * b + w[2] * c + w[3] * e;
        colY[i] = d[0] * a + d[1] * b + d[2] * c + d[3] * e;
      }
    },
    at(c: number) {
      const i = first[c];
      const k = c * 4;
      const a = col[i];
      const b = col[i + 1];
      const e = col[i + 2];
      const f = col[i + 3];
      out.h = wx[k] * a + wx[k + 1] * b + wx[k + 2] * e + wx[k + 3] * f;
      out.gx = (dx[k] * a + dx[k + 1] * b + dx[k + 2] * e + dx[k + 3] * f) * G;
      out.gy =
        (wx[k] * colY[i] +
          wx[k + 1] * colY[i + 1] +
          wx[k + 2] * colY[i + 2] +
          wx[k + 3] * colY[i + 3]) *
        G;
      return out;
    },
  };
}

// How much of a pixel-wide box centered at `u` a set of parallel bands covers, the bands `half` either side of
// u = k * period. All in pixels. Exact at any spacing, so lines finer or denser than a pixel average out.
function bands(u: number, period: number, half: number): number {
  if (2 * half >= period) return 1;
  return clamp01(
    bandsBelow(u + 0.5, period, half) - bandsBelow(u - 0.5, period, half),
  );
}

// How much of the line up to `t` the bands cover, counted from where k = 0's band starts.
function bandsBelow(t: number, period: number, half: number): number {
  const v = t + half;
  const k = Math.floor(v / period);
  return k * 2 * half + Math.min(v - k * period, 2 * half);
}

// How much of a pixel-wide box `d` from a line's center a line `half` wide either side covers. In pixels.
const line = (d: number, half: number) =>
  clamp01(Math.min(d + 0.5, half) - Math.max(d - 0.5, -half));

// A mark drawn over the map: a stroke, a filled triangle, box or disc, or a ring. Marks in one `group` don't
// darken where they overlap, so a polyline's joints print evenly.
type Mark = {
  group: number;
  color: Rgb;
  box: [number, number, number, number];
} & (
  | {
      kind: "seg";
      ax: number;
      ay: number;
      bx: number;
      by: number;
      half: number;
    }
  // `thin` is the shape's narrowest width.
  | { kind: "tri"; pts: number[]; thin: number }
  | { kind: "rect"; x: number; y: number; hw: number; hh: number }
  | { kind: "disc"; x: number; y: number; r: number; thin: number }
  | { kind: "ring"; x: number; y: number; r: number; half: number }
);

// How much of a pixel `px` units wide at (x, y) a mark covers.
function coverage(m: Mark, x: number, y: number, px: number): number {
  switch (m.kind) {
    case "seg": {
      const ex = m.bx - m.ax;
      const ey = m.by - m.ay;
      const len2 = ex * ex + ey * ey;
      const t =
        len2 > 0 ? clamp01(((x - m.ax) * ex + (y - m.ay) * ey) / len2) : 0;
      const qx = x - m.ax - t * ex;
      const qy = y - m.ay - t * ey;
      return line(Math.sqrt(qx * qx + qy * qy) / px, m.half / px);
    }
    case "tri":
    case "disc": {
      // An edge ramp a pixel wide overstates a shape thinner than a pixel, so thin ones are supersampled.
      const n = Math.min(4, Math.ceil((2 * px) / m.thin));
      const sub = px / n;
      let sum = 0;
      for (let b = 0; b < n; b++)
        for (let a = 0; a < n; a++) {
          const [sx, sy] = [
            x + (a + 0.5) * sub - px / 2,
            y + (b + 0.5) * sub - px / 2,
          ];
          sum += clamp01(0.5 - inside(m, sx, sy) / sub);
        }
      return sum / (n * n);
    }
    case "rect": {
      const ox =
        Math.min(x + px / 2, m.x + m.hw) - Math.max(x - px / 2, m.x - m.hw);
      const oy =
        Math.min(y + px / 2, m.y + m.hh) - Math.max(y - px / 2, m.y - m.hh);
      return ox > 0 && oy > 0 ? (ox * oy) / (px * px) : 0;
    }
    case "ring": {
      const qx = x - m.x;
      const qy = y - m.y;
      return line((Math.sqrt(qx * qx + qy * qy) - m.r) / px, m.half / px);
    }
  }
}

// Signed distance from a point to a filled mark's edge, negative inside. For a triangle it's the farthest of its
// edges' lines: exact inside and along the edges.
function inside(m: Mark & { kind: "tri" | "disc" }, x: number, y: number) {
  if (m.kind === "disc") {
    const qx = x - m.x;
    const qy = y - m.y;
    return Math.sqrt(qx * qx + qy * qy) - m.r;
  }
  const p = m.pts;
  let sd = -Infinity;
  for (let k = 0; k < 6; k += 2) {
    const ax = p[k];
    const ay = p[k + 1];
    const ex = p[(k + 2) % 6] - ax;
    const ey = p[(k + 3) % 6] - ay;
    sd = Math.max(
      sd,
      ((x - ax) * ey - (y - ay) * ex) / Math.sqrt(ex * ex + ey * ey),
    );
  }
  return sd;
}

// Collects marks, each with its bounding box, for the pixel loop.
class Marks {
  list: Mark[] = [];
  private group = 0;
  // Starts a new group: marks added after this print over the ones before.
  next() {
    this.group++;
  }
  seg(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    half: number,
    color: Rgb,
  ) {
    this.list.push({
      kind: "seg",
      ax,
      ay,
      bx,
      by,
      half,
      color,
      group: this.group,
      box: [
        Math.min(ax, bx) - half,
        Math.min(ay, by) - half,
        Math.max(ax, bx) + half,
        Math.max(ay, by) + half,
      ],
    });
  }
  polyline(pts: number[], half: number, color: Rgb) {
    for (let k = 0; k + 3 < pts.length; k += 2)
      this.seg(pts[k], pts[k + 1], pts[k + 2], pts[k + 3], half, color);
  }
  tri(pts: number[], color: Rgb) {
    const xs = [pts[0], pts[2], pts[4]];
    const ys = [pts[1], pts[3], pts[5]];
    // The narrowest width is the shortest altitude: twice the area over the longest side.
    const area = Math.abs(
      (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]),
    );
    const longest = Math.max(
      ...[0, 1, 2].map((k) => {
        const [ex, ey] = [xs[(k + 1) % 3] - xs[k], ys[(k + 1) % 3] - ys[k]];
        return Math.sqrt(ex * ex + ey * ey);
      }),
    );
    this.list.push({
      kind: "tri",
      pts,
      thin: area / longest,
      color,
      group: this.group,
      box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    });
  }
  rect(x: number, y: number, hw: number, hh: number, color: Rgb) {
    this.list.push({
      kind: "rect",
      x,
      y,
      hw,
      hh,
      color,
      group: this.group,
      box: [x - hw, y - hh, x + hw, y + hh],
    });
  }
  disc(x: number, y: number, r: number, color: Rgb) {
    this.list.push({
      kind: "disc",
      x,
      y,
      r,
      thin: 2 * r,
      color,
      group: this.group,
      box: [x - r, y - r, x + r, y + r],
    });
  }
  ring(x: number, y: number, r: number, half: number, color: Rgb) {
    const e = r + half;
    this.list.push({
      kind: "ring",
      x,
      y,
      r,
      half,
      color,
      group: this.group,
      box: [x - e, y - e, x + e, y + e],
    });
  }
}

// Numerals as strokes on a grid 2 wide and 4 tall, y down, each a list of polylines.
const DIGITS: readonly (readonly number[])[][] = [
  [[0, 0, 2, 0, 2, 4, 0, 4, 0, 0]],
  [
    [0.4, 0.8, 1.2, 0, 1.2, 4],
    [0.4, 4, 2, 4],
  ],
  [[0, 0, 2, 0, 2, 2, 0, 2, 0, 4, 2, 4]],
  [
    [0, 0, 2, 0, 2, 4, 0, 4],
    [0.6, 2, 2, 2],
  ],
  [
    [0, 0, 0, 2.4, 2, 2.4],
    [1.5, 0, 1.5, 4],
  ],
  [[2, 0, 0, 0, 0, 2, 2, 2, 2, 4, 0, 4]],
  [[2, 0, 0, 0, 0, 4, 2, 4, 2, 2, 0, 2]],
  [[0, 0, 2, 0, 0.8, 4]],
  [
    [0, 0, 2, 0, 2, 4, 0, 4, 0, 0],
    [0, 2, 2, 2],
  ],
  [[2, 2, 0, 2, 0, 0, 2, 0, 2, 4, 0, 4]],
];
const LETTER_N = [[0, 4, 0, 0, 2, 4, 2, 0]];

// Strokes a glyph `size` tall with its top left at (x, y).
function glyph(
  marks: Marks,
  strokes: readonly (readonly number[])[],
  x: number,
  y: number,
  size: number,
  color: Rgb,
) {
  const s = size / 4;
  for (const pts of strokes)
    marks.polyline(
      pts.map((v, k) => (k % 2 === 0 ? x + v * s : y + v * s)),
      size * 0.07,
      color,
    );
}

// Width of a number's label `size` tall.
const labelWidth = (n: number, size: number) =>
  (String(n).length * 3 - 1) * (size / 4);

function label(
  marks: Marks,
  n: number,
  x: number,
  y: number,
  size: number,
  color: Rgb,
) {
  for (const [k, ch] of [...String(n)].entries()) {
    marks.next();
    glyph(marks, DIGITS[Number(ch)], x + k * 3 * (size / 4), y, size, color);
  }
}

// Local summits of the height grid, highest first, at least `apart` from each other. Each is moved from its grid
// sample to the top of the smoothed field nearby, so its spot height sits inside the innermost contour.
function summits(
  field: Field,
  at: Sample,
  apart: number,
): [number, number, number][] {
  const { h, nx, ny } = field;
  const found: [number, number, number][] = [];
  for (let j = 2; j < ny - 2; j++)
    for (let i = 2; i < nx - 2; i++) {
      const v = h[j * nx + i];
      if (v < 0.25) continue;
      let peak = true;
      for (let b = -1; b <= 1 && peak; b++)
        for (let a = -1; a <= 1; a++)
          if ((a || b) && h[(j + b) * nx + i + a] >= v) {
            peak = false;
            break;
          }
      if (peak) found.push(climb(at, (i - 1) / G, (j - 1) / G));
    }
  found.sort((p, q) => q[2] - p[2]);
  const kept: [number, number, number][] = [];
  for (const p of found)
    if (
      kept.every((q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 > apart * apart)
    )
      kept.push(p);
  return kept;
}

// The highest point of the field within a grid step of (x, y), found on finer and finer lattices.
function climb(at: Sample, x: number, y: number): [number, number, number] {
  let best = at(x, y).h;
  for (let reach = 1 / G; reach > 1 / (G * 64); reach /= 4) {
    let [bx, by] = [x, y];
    for (let b = -4; b <= 4; b++)
      for (let a = -4; a <= 4; a++) {
        const [cx, cy] = [x + (a * reach) / 4, y + (b * reach) / 4];
        const v = at(cx, cy).h;
        if (v > best) [best, bx, by] = [v, cx, cy];
      }
    [x, y] = [bx, by];
  }
  return [x, y, best];
}

// A river from (x, y) down the steepest slope to the sea, as a polyline, or null if it pools in a hollow first.
// It joins another river it runs into, so tributaries meet.
function river(
  at: Sample,
  x: number,
  y: number,
  others: number[][],
): number[] | null {
  const step = 0.004;
  const pts = [x, y];
  for (let k = 0; k < 500; k++) {
    const { h, gx, gy } = at(x, y);
    const g = Math.sqrt(gx * gx + gy * gy);
    if (h < 0) return pts;
    if (g < 1e-4) return null;
    x -= (gx / g) * step;
    y -= (gy / g) * step;
    pts.push(x, y);
    for (const o of others)
      for (let m = 0; m < o.length; m += 2)
        if ((o[m] - x) ** 2 + (o[m + 1] - y) ** 2 < step * step) {
          pts.push(o[m], o[m + 1]);
          return pts;
        }
  }
  return null;
}

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
  const px = 1 / unit;

  // The map on the art, and map units on it.
  const map = { x0: NEAT, y0: NEAT, x1: W - NEAT, y1: H - NEAT };
  const [mw, mh] = mapUnits(W, H);
  const sx = (map.x1 - map.x0) / mw;
  const sy = (map.y1 - map.y0) / mh;
  const artX = (x: number) => map.x0 + x * sx;
  const artY = (y: number) => map.y0 + y * sy;

  const field = fitIsland(seed, mw, mh);
  const at = sampler(field);

  const paperRgb = rgb(paper);
  const dark = rgb(inks[0]);
  const others = inks.slice(1).map(rgb);
  const contourInk = others[Math.floor(rand() * others.length)];
  const seaInk = others[Math.floor(rand() * others.length)];
  const riverInk = mix(seaInk, dark, 0.35);

  // Contour interval: between 9 and 16 contours from the coast to the summit, with heights in round metres.
  const levels = 9 + Math.floor(rand() * 8);
  const step = 1 / (levels + 0.3 + 0.6 * rand());
  const interval = [10, 20, 25, 50][Math.floor(rand() * 4)];
  const metres = (h: number) => Math.round((h / step) * interval);

  const seaStyle = Math.floor(rand() * 3); // 0 wash, 1 hatch, 2 water lines
  const landStyle = Math.floor(rand() * 3); // 0 paper, 1 flat wash, 2 layered by height
  const grid = rand() < 0.6 ? 0.2 : 0;
  const hatchGap = 0.009 + 0.004 * rand();

  const marks = new Marks();

  // Rivers rise just below the high points and run to the sea.
  const peaks = summits(field, at, 0.1);
  const rivers: number[][] = [];
  for (const [x, y] of peaks.slice(0, 4)) {
    const a = rand() * 4;
    // A start a little off the summit, in one of four directions.
    const [ox, oy] = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ][Math.floor(a)];
    const r = river(at, x + 0.03 * ox, y + 0.03 * oy, rivers);
    if (r && r.length >= 20) rivers.push(r);
  }
  for (const r of rivers) {
    marks.next();
    // Rivers widen toward the mouth.
    const n = r.length / 2;
    for (let k = 0; k + 1 < n; k++)
      marks.seg(
        artX(r[2 * k]),
        artY(r[2 * k + 1]),
        artX(r[2 * k + 2]),
        artY(r[2 * k + 3]),
        0.0009 + 0.0016 * (k / n),
        riverInk,
      );
  }

  // Spot heights: a trig point on the summit, dots on the next high points, each with its height.
  const labelSize = 0.022;
  for (const [k, [mx, my, v]] of peaks.slice(0, 3).entries()) {
    const [x, y] = [artX(mx), artY(my)];
    marks.next();
    if (k === 0) {
      const s = 0.009;
      marks.polyline(
        [
          x,
          y - s,
          x + s * 0.87,
          y + s * 0.5,
          x - s * 0.87,
          y + s * 0.5,
          x,
          y - s,
        ],
        0.0012,
        dark,
      );
      marks.next();
      marks.disc(x, y + 0.0005, 0.0018, dark);
    } else marks.disc(x, y, 0.0024, dark);
    const n = metres(v);
    const w = labelWidth(n, labelSize);
    // Right of the point, unless that runs into the frame. Decided in map units, like every placement.
    const lx = mx + 0.014 + w < mw - 0.01 ? x + 0.014 : x - 0.014 - w;
    label(marks, n, lx, y - labelSize / 2, labelSize, dark);
  }

  // Settlements: a few on low, gentle ground near the coast, far apart, each a cluster of blocks.
  const spots: [number, number][] = [];
  const tries = 160;
  for (let k = 0; k < tries && spots.length < 3; k++) {
    const x = mw * rand();
    const y = mh * rand();
    const { h, gx, gy } = at(x, y);
    const g = Math.sqrt(gx * gx + gy * gy);
    if (h < 0.02 || h > step * 1.5 || g > 6) continue;
    if (spots.some(([sx, sy]) => (sx - x) ** 2 + (sy - y) ** 2 < 0.15 * 0.15))
      continue;
    spots.push([x, y]);
  }
  for (const [x, y] of spots) {
    marks.next();
    const count = 3 + Math.floor(rand() * 5);
    for (let k = 0; k < count; k++) {
      const [bx, by] = [x + 0.03 * (rand() - 0.5), y + 0.03 * (rand() - 0.5)];
      if (at(bx, by).h < 0.01) continue;
      const s = 0.003 + 0.003 * rand();
      marks.rect(artX(bx), artY(by), s, s * (0.7 + 0.6 * rand()), dark);
    }
  }

  // The compass rose, in the first corner whose sea is open enough for it.
  const rr = 0.06 + 0.025 * rand();
  const corners = [
    [0, 0, 1, 1],
    [mw, 0, -1, 1],
    [0, mh, 1, -1],
    [mw, mh, -1, -1],
  ];
  const first = Math.floor(rand() * 4);
  for (let c = 0; c < 4; c++) {
    const [x0, y0, dx, dy] = corners[(first + c) % 4];
    const [cx, cy] = [x0 + dx * (rr + 0.03), y0 + dy * (rr + 0.045)];
    let open = true;
    for (const [ux, uy] of ROSE_DIRS)
      for (const f of [0, 0.5, 1, 1.4]) {
        if (at(cx + ux * rr * f, cy + uy * rr * f).h > -0.02) open = false;
      }
    if (!open) continue;
    rose(marks, artX(cx), artY(cy), rr, dark, paperRgb);
    break;
  }

  // Marks sorted into buckets of the art, each holding the marks that can touch a pixel inside it.
  const CELL = 1 / 32;
  const bw = Math.ceil(W / CELL);
  const bh = Math.ceil(H / CELL);
  const buckets: number[][] = Array.from({ length: bw * bh }, () => []);
  for (const [k, m] of marks.list.entries()) {
    const [x0, y0, x1, y1] = m.box;
    const i0 = Math.max(0, Math.floor((x0 - px) / CELL));
    const i1 = Math.min(bw - 1, Math.floor((x1 + px) / CELL));
    const j0 = Math.max(0, Math.floor((y0 - px) / CELL));
    const j1 = Math.min(bh - 1, Math.floor((y1 + px) / CELL));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) buckets[j * bw + i].push(k);
  }

  const landWash = landStyle === 0 ? 0 : 0.14;
  const coastHalf = 0.002;
  const contourHalf = 0.0007;
  const indexHalf = 0.0014;

  const image = ctx.createImageData(width, height);
  const data = image.data;
  const color: Rgb = [0, 0, 0];
  const paint = (ink: Rgb, a: number) => {
    if (a <= 0) return;
    for (let c = 0; c < 3; c++) color[c] += (ink[c] - color[c]) * a;
  };

  const raster = rasterSampler(field, width, px, map.x0, sx);
  for (let py = 0; py < height; py++) {
    const y = (py + 0.5) * px;
    raster.row((y - map.y0) / sy);
    for (let pxi = 0; pxi < width; pxi++) {
      const x = (pxi + 0.5) * px;
      color[0] = paperRgb[0];
      color[1] = paperRgb[1];
      color[2] = paperRgb[2];

      // How much of the pixel the map covers, inside the neat line.
      const inX = Math.min(x + px / 2, map.x1) - Math.max(x - px / 2, map.x0);
      const inY = Math.min(y + px / 2, map.y1) - Math.max(y - px / 2, map.y0);
      const inMap =
        inX > 0 && inY > 0 ? Math.min(1, inX / px) * Math.min(1, inY / px) : 0;

      if (inMap > 0) {
        const s = raster.at(pxi);
        // The slope per art unit, from the slope per map unit.
        const [gx, gy] = [s.gx / sx, s.gy / sy];
        const g = Math.max(Math.sqrt(gx * gx + gy * gy), 1e-6);
        // Height and distances in pixels, measured square to the contours.
        const u = s.h / g / px;
        const land = clamp01(u + 0.5);
        const sea = 1 - land;

        if (sea > 0) {
          if (seaStyle === 0) {
            paint(seaInk, 0.3 * sea * inMap);
            paint(seaInk, 0.8 * sea * inMap * waterLines(s.h, g, px, 2));
          } else if (seaStyle === 1) {
            paint(
              seaInk,
              0.85 * sea * inMap * bands(y / px, hatchGap / px, 0.0011 / px),
            );
          } else paint(seaInk, 0.9 * sea * inMap * waterLines(s.h, g, px, 6));
        }
        if (land > 0) {
          let wash = landWash;
          if (landStyle === 2)
            // A step darker above each heavy contour, with the step's edge antialiased.
            for (let k = 5; k * step < 1; k += 5)
              wash += 0.09 * clamp01((s.h - k * step) / g / px + 0.5);
          paint(contourInk, wash * land * inMap);
          // Every contour, plus every fifth one heavier, without counting the fifth ones twice.
          const p = step / g / px;
          const thin = bands(u, p, contourHalf / px);
          const heavy =
            bands(u, 5 * p, indexHalf / px) - bands(u, 5 * p, contourHalf / px);
          paint(contourInk, clamp01(thin + heavy) * land * inMap);
        }
        if (grid) {
          const gx = bands((x - map.x0) / px, grid / px, 0.0005 / px);
          const gy = bands((y - map.y0) / px, grid / px, 0.0005 / px);
          paint(dark, 0.45 * clamp01(gx + gy - gx * gy) * inMap);
        }
        paint(dark, line(u, coastHalf / px) * inMap);
      }

      // Marks, each group compositing the most any of its marks covers.
      const bucket = buckets[Math.floor(y / CELL) * bw + Math.floor(x / CELL)];
      let group = -1;
      let most = 0;
      let ink = dark;
      for (const k of bucket) {
        const m = marks.list[k];
        if (
          x < m.box[0] - px ||
          x > m.box[2] + px ||
          y < m.box[1] - px ||
          y > m.box[3] + px
        )
          continue;
        if (m.group !== group || m.color !== ink) {
          paint(ink, most * inMap);
          group = m.group;
          most = 0;
          ink = m.color;
        }
        most = Math.max(most, coverage(m, x, y, px));
      }
      paint(ink, most * inMap);

      // The frame: neat line, a band of blocks alternating along each side, and the outer rule.
      const edge = Math.min(x, W - x, y, H - y);
      if (edge < NEAT + px) {
        paint(dark, line((edge - NEAT) / px, 0.0016 / px));
        paint(dark, line((edge - OUTER) / px, 0.0008 / px));
        const inBand = clamp01(Math.min(edge - OUTER, NEAT - edge) / px + 0.5);
        if (inBand > 0) {
          // Along the side the pixel is nearest, blocks one grid fifth long, counted from the corner.
          const along = edge === x || edge === W - x ? y - NEAT : x - NEAT;
          const block = 0.04;
          paint(
            dark,
            inBand *
              bands(
                along / px - block / px / 2,
                (2 * block) / px,
                block / 2 / px,
              ),
          );
        }
      }

      const p = (py * width + pxi) * 4;
      data[p] = Math.round(color[0]);
      data[p + 1] = Math.round(color[1]);
      data[p + 2] = Math.round(color[2]);
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

// How much of a pixel `count` water lines cover offshore: lines that follow the coast, spaced wider as the sea
// deepens, and fading out. `h` and `g` are the height and slope at the pixel.
function waterLines(h: number, g: number, px: number, count: number): number {
  if (h >= 0) return 0;
  // Depth below the coast, on a square-root scale so line spacing widens with distance offshore.
  const SCALE = 0.04;
  const q = Math.sqrt(-h / SCALE);
  const gq = g / (2 * SCALE * Math.max(q, 1e-3));
  const gap = 0.55;
  const k = q / gap;
  if (k > count + 0.5) return 0;
  return (
    bands(q / gq / px, gap / gq / px, 0.0006 / px) * clamp01(count + 0.5 - k)
  );
}

// The eight compass directions, unit vectors, north first, clockwise, y down.
const D = Math.SQRT1_2;
const ROSE_DIRS: readonly [number, number][] = [
  [0, -1],
  [D, -D],
  [1, 0],
  [D, D],
  [0, 1],
  [-D, D],
  [-1, 0],
  [-D, -D],
];

// A compass rose of radius `r` at (x, y): a ring, four long points and four short ones, each point half inked
// and half paper, and an N over north.
function rose(
  marks: Marks,
  x: number,
  y: number,
  r: number,
  dark: Rgb,
  paper: Rgb,
) {
  marks.next();
  marks.ring(x, y, r * 0.62, r * 0.012, dark);
  marks.next();
  marks.ring(x, y, r * 0.7, r * 0.02, dark);
  for (const long of [false, true])
    for (let k = long ? 0 : 1; k < 8; k += 2) {
      const [dx, dy] = ROSE_DIRS[k];
      const len = r * (long ? 1 : 0.6);
      const wide = r * (long ? 0.16 : 0.12);
      const tip = [x + dx * len, y + dy * len];
      const left = [x - dy * wide, y + dx * wide];
      const right = [x + dy * wide, y - dx * wide];
      marks.next();
      marks.tri([x, y, tip[0], tip[1], left[0], left[1]], dark);
      marks.next();
      marks.tri([x, y, tip[0], tip[1], right[0], right[1]], paper);
      marks.next();
      marks.polyline([x, y, ...right, ...tip, ...left], r * 0.015, dark);
    }
  const size = r * 0.32;
  marks.next();
  glyph(marks, LETTER_N, x - size * 0.25, y - r - size * 1.25, size, dark);
}

export const islandSurvey1: Style = {
  id: "topo1",
  draw,
};
