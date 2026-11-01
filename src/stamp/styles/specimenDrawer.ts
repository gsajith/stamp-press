import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Specimen drawer: a museum drawer of unit trays, each holding one pinned moth or beetle above a small label.
// Some drawers hold a series of one species, others a mix. The specimen stands off the foam on its pin, so it
// casts a soft shadow, and so does the pin.
//
// Insects are mirrored halves. A moth's wing is an outline radius over the direction from its root, a spline
// through a jittered template, filled with dusting, cross lines, a border, eyespots, veins and scales. A beetle
// is width profiles down its length for pronotum and elytra, with legs and antennae as chains of capsules.
//
// Like land1, it computes every pixel itself, in units where the art's short side is 1, so it draws the same
// picture at any size and the same pixels in every browser and in Node (ADR 0001). Only IEEE-exact arithmetic
// here: no Math.sin, Math.atan2 or the like. Directions are pseudo-angles, dy / (|dx| + |dy|).
//
// The per-pixel code avoids allocating, since it runs a few million times for a detail view.

type Rgb = readonly [number, number, number];

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

// How much of a sample `px` wide lies inside an edge, when its center is `d` inside it.
const edge = (d: number, px: number) => clamp01(d / px + 0.5);
// How much of a sample `px` wide a line `half` wide covers, when the sample's center is `d` from its middle.
// Exact for straight lines, so a line keeps its weight at any size, even thinner than a pixel.
const line = (d: number, half: number, px: number) =>
  clamp01((Math.min(d + px / 2, half) - Math.max(d - px / 2, -half)) / px);
// How strongly to show texture repeating every `period`: fully from 4 samples a period, fading out by 2, so
// texture finer than a pixel averages out instead of aliasing. Textures here average to zero, so fading them
// keeps a small draw's tone.
const sharp = (period: number, px: number) => clamp01(period / px / 2 - 1);
// A triangle wave in [-0.5, 0.5] with period 1, averaging zero.
const tri = (t: number) => 2 * Math.abs(t - Math.floor(t) - 0.5) - 0.5;
// A smooth bump, 1 at 0 and falling to 0 at ±1.
const bump = (t: number) => (t * t < 1 ? (1 - t * t) * (1 - t * t) : 0);

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

// A Catmull-Rom spline through `table`, its values evenly spaced over t in [0, 1]. It leaves its slope,
// d/dt, in `slope`, which edges use to measure distance square to an outline.
let slope = 0;
function spline(table: Float64Array, t: number): number {
  const n = table.length - 1;
  const s = clamp01(t) * n;
  const i = Math.min(n - 1, Math.floor(s));
  const f = s - i;
  const p0 = table[i > 0 ? i - 1 : 0];
  const p1 = table[i];
  const p2 = table[i + 1];
  const p3 = table[i + 2 <= n ? i + 2 : n];
  const a = p2 - p0;
  const b = 2 * p0 - 5 * p1 + 4 * p2 - p3;
  const c = 3 * (p1 - p2) + p3 - p0;
  slope = 0.5 * (a + f * (2 * b + 3 * f * c)) * n;
  return p1 + 0.5 * f * (a + f * (b + f * c));
}

// The pixel being shaded, and scratch colors its parts are built in.
type Buf = Float64Array;
const out = new Float64Array(3);
const tray = new Float64Array(3);
const part = new Float64Array(3);
const set = (b: Buf, c: Rgb | Buf) => {
  b[0] = c[0];
  b[1] = c[1];
  b[2] = c[2];
};
// Lays `c` over `b` at coverage `a`.
const over = (b: Buf, c: Rgb | Buf, a: number) => {
  if (a <= 0) return;
  b[0] += (c[0] - b[0]) * a;
  b[1] += (c[1] - b[1]) * a;
  b[2] += (c[2] - b[2]) * a;
};
// Specimens paint front to back into `out`, so a pixel stops once something opaque covers it. `keep` is how
// much of what lies further back still shows.
let keep = 1;
// Lays `c` at coverage `a` under what `out` already holds.
const under = (c: Rgb | Buf, a: number) => {
  if (a <= 0) return;
  const w = keep * a;
  out[0] += c[0] * w;
  out[1] += c[1] * w;
  out[2] += c[2] * w;
  keep -= w;
};
// Scales `b` by 1 - `a`, for texture that averages out: `a` averages to zero.
const shadeBy = (b: Buf, a: number) => {
  b[0] *= 1 - a;
  b[1] *= 1 - a;
  b[2] *= 1 - a;
};

const pick = <T>(rand: () => number, list: readonly T[]): T =>
  list[Math.floor(rand() * list.length)];
const range = (rand: () => number, lo: number, hi: number) =>
  lo + (hi - lo) * rand();

// A box in specimen units, y down.
type Box = { x0: number; x1: number; y0: number; y1: number };
const grow = (b: Box, x: number, y: number) => {
  if (x < b.x0) b.x0 = x;
  if (x > b.x1) b.x1 = x;
  if (y < b.y0) b.y0 = y;
  if (y > b.y1) b.y1 = y;
};

// A tapered stroke from a to b, for legs, antennae, tails, horns and the pin's shadow. Its half width runs from
// w0 at a to w1 at b. `beads` bulges it into that many segments, for beaded antennae and tarsi.
type Capsule = {
  ax: number;
  ay: number;
  vx: number;
  vy: number;
  bx: number;
  by: number;
  // 1 / |b - a|², and |b - a| / beads.
  inv: number;
  bead: number;
  w0: number;
  w1: number;
  beads: number;
  box: Box;
};

function capsuleOf(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  w0: number,
  w1: number,
  beads = 0,
): Capsule {
  const [vx, vy] = [bx - ax, by - ay];
  const w = Math.max(w0, w1) * 1.5;
  const box = {
    x0: Math.min(ax, bx) - w,
    x1: Math.max(ax, bx) + w,
    y0: Math.min(ay, by) - w,
    y1: Math.max(ay, by) + w,
  };
  const len = Math.sqrt(vx * vx + vy * vy);
  const inv = 1 / (vx * vx + vy * vy);
  return {
    ax,
    ay,
    vx,
    vy,
    bx,
    by,
    inv,
    bead: len / (beads || 1),
    w0,
    w1,
    beads,
    box,
  };
}

// How much of a sample `px` wide at (x, y) the capsule covers, and in `along` how far along it the point is.
let along = 0;
function capsule(c: Capsule, x: number, y: number, px: number): number {
  const b = c.box;
  if (x < b.x0 - px || x > b.x1 + px || y < b.y0 - px || y > b.y1 + px)
    return 0;
  const qx = x - c.ax;
  const qy = y - c.ay;
  const h = clamp01((qx * c.vx + qy * c.vy) * c.inv);
  along = h;
  const dx = qx - c.vx * h;
  const dy = qy - c.vy * h;
  let w = c.w0 + (c.w1 - c.w0) * h;
  if (c.beads > 0) w *= 1 + 0.4 * sharp(c.bead, px) * tri(h * c.beads);
  return edge(w - Math.sqrt(dx * dx + dy * dy), px);
}

// The most any of `cs` covers.
function capsules(cs: readonly Capsule[], x: number, y: number, px: number) {
  let a = 0;
  for (let i = 0; i < cs.length; i++) {
    const c = capsule(cs[i], x, y, px);
    if (c > a) a = c;
  }
  return a;
}

const capsuleBox = (b: Box, c: Capsule) => {
  grow(b, c.box.x1, c.box.y0);
  grow(b, c.box.x1, c.box.y1);
};

// An eyespot or a spot, centered at (x, y).
type Spot = { x: number; y: number; r: number };

// A wing: its outline radius over the pseudo-angle p from its root, in [-1, 1] from straight up to straight
// down, and what's printed on it, placed by u, the fraction of the way from root (0) to margin (1).
type Wing = {
  x: number;
  y: number;
  radii: Float64Array;
  scallop: number;
  scallops: number;
  ground: Rgb;
  dust: Rgb;
  dustAt: number;
  border: { ink: Rgb; at: number; wave: number; waves: number } | null;
  dots: { ink: Rgb; count: number; r: number } | null;
  lines: { at: number; zig: number; zigs: number }[];
  lineInk: Rgb;
  eyes: Spot[];
  eyeInks: readonly Rgb[];
  discal: Spot | null;
  veins: { p0: number; gap: number; count: number; bend: number; ink: Rgb };
  scale: number;
};

// Where in the wing the last point wingAt looked at sits.
let wingU = 0;
let wingR = 0;
let wingP = 0;
let wingD = 0;
let wingArc = 0;

// How much of a sample `soft` wide at (x, y), with x ≥ 0, the wing covers. It leaves where the point sits in
// the wing in wingU and the like.
function wingAt(w: Wing, x: number, y: number, soft: number): number {
  const dx = x - w.x;
  if (dx <= 0) return 0;
  const dy = y - w.y;
  const ady = dy < 0 ? -dy : dy;
  const p = dy / (dx + ady);
  let r = spline(w.radii, (p + 1) / 2);
  // The outline's slope against the true angle: dθ/dp is 1 / ((1 - |p|)² + p²).
  const ap = p < 0 ? -p : p;
  const jac = (1 - ap) * (1 - ap) + p * p;
  const dr = (slope / 2) * jac;
  if (w.scallop > 0) {
    const s = 2 * tri(p * w.scallops);
    r -= w.scallop * (1 - s * s);
  }
  if (r <= 0) return 0;
  const d = Math.sqrt(dx * dx + dy * dy);
  // Distance square to the outline, from distance along the ray. Where the outline runs nearly along the ray
  // that estimate breaks down, so cap the correction.
  const g = dr / r;
  const k = Math.sqrt(1 + g * g);
  const cover = edge((r - d) / (k < 3 ? k : 3), soft);
  wingU = d / r;
  wingR = r;
  wingP = p;
  wingD = d;
  // Distance along the arc per unit of p, here.
  wingArc = d / jac;
  return cover;
}

// Paints a wing at (x, y), with x ≥ 0, under `out`.
function paintWing(w: Wing, x: number, y: number, px: number) {
  const cover = wingAt(w, x, y, px);
  if (cover === 0) return;
  const u = wingU;
  const r = wingR;
  const p = wingP;
  const arc = wingArc;
  set(part, w.ground);

  // Darker scales dusted toward the root.
  if (u < w.dustAt) {
    const t = 1 - u / w.dustAt;
    over(part, w.dust, 0.75 * t * t);
  }
  // Wavy cross lines.
  for (let i = 0; i < w.lines.length; i++) {
    const l = w.lines[i];
    const at = l.at + l.zig * tri(p * l.zigs);
    over(part, w.lineInk, 0.9 * line((u - at) * r, 0.006, px));
  }
  // The discal spot, a ring at the end of the wing's central cell.
  const ds = w.discal;
  if (ds) {
    const ex = x - ds.x;
    const ey = y - ds.y;
    const e = Math.sqrt(ex * ex * 1.8 + ey * ey * 0.7);
    over(part, w.lineInk, 0.85 * line(e - ds.r, 0.007, px));
  }
  // A border, its inner edge waved, with a row of pale dots along it.
  const b = w.border;
  if (b) {
    const at = b.at + b.wave * tri(p * b.waves);
    over(part, b.ink, edge((u - at) * r, px));
    const dots = w.dots;
    if (dots) {
      const k = Math.round(p * dots.count);
      const du = (u - (at + 1) / 2) * r;
      const dp = (p - k / dots.count) * arc;
      over(part, dots.ink, edge(dots.r - Math.sqrt(du * du + dp * dp), px));
    }
  }
  // Eyespots, ring by ring, with a highlight.
  for (let i = 0; i < w.eyes.length; i++) {
    const e = w.eyes[i];
    const ex = x - e.x;
    const ey = y - e.y;
    const de = Math.sqrt(ex * ex + ey * ey);
    if (de > e.r + px) continue;
    over(part, w.eyeInks[0], edge(e.r - de, px));
    over(part, w.eyeInks[1], edge(e.r * 0.74 - de, px));
    over(part, w.eyeInks[2], edge(e.r * 0.42 - de, px));
    const hx = ex + e.r * 0.16;
    const hy = ey + e.r * 0.16;
    over(
      part,
      w.eyeInks[3],
      edge(e.r * 0.13 - Math.sqrt(hx * hx + hy * hy), px),
    );
  }
  // Veins fanning from the root, bending as they go.
  const v = w.veins;
  if (u > 0.1) {
    const q = (p - v.p0 - v.bend * u * u) / v.gap;
    const k = Math.round(q);
    if (k >= 0 && k < v.count)
      over(
        part,
        v.ink,
        0.8 * line((q - k) * v.gap * arc, 0.0035 * (1.3 - u), px),
      );
  }
  // Scales in overlapping rows, each lighter at its tip than its base, and each its own shade.
  const f = sharp(w.scale, px);
  if (f > 0) {
    const a = wingD / w.scale;
    const row = Math.floor(a);
    const c = (p * arc) / w.scale + 0.5 * (row & 1);
    const col = Math.floor(c);
    const lit = a - row - 0.5 + 0.6 * (hash2(row, col, 0x51ce) - 0.5);
    shadeBy(part, 0.12 * f * lit);
  }
  // A fringe of hair-like scales along the margin, checkered.
  const fringe = (1 - u) * r;
  if (fringe < 0.02) {
    const check = (Math.floor(p * 25) & 1) - 0.5;
    shadeBy(
      part,
      (0.1 + 0.25 * sharp(arc / 25, px) * check) * (1 - fringe / 0.02),
    );
  }
  under(part, cover);
}

type Moth = {
  kind: "moth";
  fore: Wing;
  hind: Wing;
  tail: Capsule | null;
  tailInk: Rgb;
  antennae: Capsule[];
  // The comb of a feathered antenna, a wider stroke along each antenna, or none.
  feathers: Capsule[];
  club: number;
  body: Rgb;
  hair: Rgb;
  pin: [number, number];
  box: Box;
};

type Beetle = {
  kind: "beetle";
  head: { y: number; rx: number; ry: number };
  pronotum: { y0: number; y1: number; widths: Float64Array };
  elytra: { y0: number; y1: number; widths: Float64Array; striae: number };
  limbs: Capsule[];
  shell: Rgb;
  pattern: Rgb;
  shine: Rgb;
  dark: Rgb;
  spots: Spot[];
  bands: { t: number; half: number; zig: number }[];
  stripes: { n: number; half: number }[];
  margin: number;
  pin: [number, number];
  box: Box;
};

type Species = Moth | Beetle;

// Wing outlines, radius against pseudo-angle from straight up (-1) to straight down (1), 17 points, for a
// forewing rooted at (0.05, -0.12) and a hindwing at (0.05, -0.02).
type Template = {
  fore: readonly number[];
  hind: readonly number[];
  antenna: "feather" | "thread" | "club";
  tail: { p: number; length: number; width: number } | null;
  scallop: number;
  eyes: number;
};

// prettier-ignore
const MOTHS: readonly Template[] = [
  // An owlet: a triangular forewing over a rounded hindwing.
  {
    fore: [0, 0, 0.03, 0.1, 0.28, 0.9, 0.85, 0.74, 0.63, 0.5, 0.22, 0.12, 0.08, 0.06, 0.04, 0, 0],
    hind: [0, 0, 0, 0, 0, 0.2, 0.42, 0.55, 0.6, 0.62, 0.62, 0.6, 0.55, 0.47, 0.37, 0.27, 0.18],
    antenna: "thread", tail: null, scallop: 0, eyes: 0.15,
  },
  // A silk moth: broad, rounded and often eyed.
  {
    fore: [0, 0, 0.04, 0.14, 0.4, 0.95, 0.92, 0.8, 0.7, 0.58, 0.3, 0.15, 0.1, 0.07, 0.05, 0, 0],
    hind: [0, 0, 0, 0, 0, 0.3, 0.55, 0.7, 0.78, 0.82, 0.82, 0.78, 0.72, 0.62, 0.5, 0.38, 0.26],
    antenna: "feather", tail: null, scallop: 0, eyes: 0.85,
  },
  // A hawk moth: long narrow forewings and small hindwings.
  {
    fore: [0, 0, 0.02, 0.06, 0.14, 0.42, 1.02, 0.7, 0.42, 0.3, 0.15, 0.08, 0.05, 0.04, 0.03, 0, 0],
    hind: [0, 0, 0, 0, 0, 0, 0.25, 0.4, 0.45, 0.46, 0.44, 0.4, 0.34, 0.27, 0.2, 0.14, 0.1],
    antenna: "thread", tail: null, scallop: 0, eyes: 0.1,
  },
  // A geometer: broad thin wings, the hindwing scalloped.
  {
    fore: [0, 0, 0.04, 0.14, 0.42, 0.88, 0.84, 0.76, 0.68, 0.55, 0.25, 0.14, 0.1, 0.07, 0.05, 0, 0],
    hind: [0, 0, 0, 0, 0, 0.25, 0.5, 0.62, 0.68, 0.7, 0.7, 0.68, 0.62, 0.52, 0.4, 0.3, 0.2],
    antenna: "feather", tail: null, scallop: 0.03, eyes: 0.2,
  },
  // A swallowtail butterfly, with clubbed antennae and a tail on each hindwing.
  {
    fore: [0, 0, 0.04, 0.12, 0.36, 0.98, 0.9, 0.76, 0.62, 0.48, 0.2, 0.11, 0.07, 0.05, 0.04, 0, 0],
    hind: [0, 0, 0, 0, 0, 0.25, 0.5, 0.6, 0.64, 0.66, 0.66, 0.64, 0.6, 0.52, 0.42, 0.3, 0.2],
    antenna: "club", tail: { p: 0.4, length: 0.22, width: 0.026 }, scallop: 0.025, eyes: 0.4,
  },
  // A moon moth, its hindwings drawn out into long tails.
  {
    fore: [0, 0, 0.04, 0.13, 0.38, 0.9, 0.82, 0.7, 0.6, 0.47, 0.2, 0.11, 0.07, 0.05, 0.04, 0, 0],
    hind: [0, 0, 0, 0, 0, 0.25, 0.48, 0.58, 0.62, 0.62, 0.6, 0.56, 0.5, 0.44, 0.38, 0.3, 0.2],
    antenna: "feather", tail: { p: 0.45, length: 0.4, width: 0.04 }, scallop: 0, eyes: 0.9,
  },
];

// Jitters a template's radii, at most 8% each way, so a species is its own shape but its wings keep the
// outline that keeps them apart: zero stays zero, and no wing reaches past its sector.
const jitter = (rand: () => number, radii: readonly number[], scale: number) =>
  Float64Array.from(radii, (r) => r * scale * (1 + 0.16 * (rand() - 0.5)));

// A point on a wing at pseudo-angle p and fraction u of the way from root to margin.
function wingPoint(w: Wing, p: number, u: number): [number, number] {
  const [dx, dy] = [1 - Math.abs(p), p];
  const len = Math.sqrt(dx * dx + dy * dy);
  const r = spline(w.radii, (p + 1) / 2) * u;
  return [w.x + (dx / len) * r, w.y + (dy / len) * r];
}

// The span of p where a wing is more than a stub.
function wingSpan(radii: Float64Array): [number, number] {
  let [lo, hi] = [1, -1];
  for (let i = 0; i < radii.length; i++)
    if (radii[i] > 0.15) {
      const p = -1 + (2 * i) / (radii.length - 1);
      if (p < lo) lo = p;
      if (p > hi) hi = p;
    }
  return [lo, hi];
}

// Colors for a specimen: the darkest ink for markings, the rest for grounds, and paper for highlights.
type Inks = { paper: Rgb; dark: Rgb; light: readonly Rgb[] };

function makeWing(
  rand: () => number,
  x: number,
  y: number,
  radii: Float64Array,
  ground: Rgb,
  inks: Inks,
  eyed: boolean,
): Wing {
  const { paper, dark } = inks;
  const border = rand() < 0.55;
  const w: Wing = {
    x,
    y,
    radii,
    scallop: 0,
    scallops: 0,
    ground,
    dust: mix(ground, dark, 0.55),
    dustAt: range(rand, 0.2, 0.5),
    border: border
      ? {
          ink: rand() < 0.75 ? dark : pick(rand, inks.light),
          at: range(rand, 0.72, 0.86),
          wave: range(rand, 0, 0.03),
          waves: Math.floor(range(rand, 4, 12)),
        }
      : null,
    dots: null,
    lines: [],
    lineInk: dark,
    eyes: [],
    eyeInks: [dark, pick(rand, inks.light), dark, paper],
    discal: null,
    veins: {
      p0: 0,
      gap: 0,
      count: 0,
      bend: range(rand, -0.15, 0.15),
      ink: rand() < 0.7 ? mix(ground, dark, 0.6) : mix(ground, paper, 0.7),
    },
    scale: range(rand, 0.011, 0.016),
  };
  if (border && rand() < 0.6)
    w.dots = {
      ink: rand() < 0.7 ? paper : pick(rand, inks.light),
      count: Math.floor(range(rand, 8, 14)),
      r: range(rand, 0.012, 0.022),
    };
  const lines = Math.floor(rand() * 3);
  for (let i = 0; i < lines; i++)
    w.lines.push({
      at: 0.3 + 0.35 * i + 0.08 * rand(),
      zig: range(rand, 0.01, 0.035),
      zigs: Math.floor(range(rand, 3, 9)),
    });
  const [lo, hi] = wingSpan(radii);
  const count = Math.floor(range(rand, 5, 9));
  w.veins.count = count;
  w.veins.gap = (hi - lo) / (count - 0.5);
  w.veins.p0 = lo + w.veins.gap / 4;
  const mid = lo + (hi - lo) * range(rand, 0.35, 0.65);
  if (eyed) {
    const [ex, ey] = wingPoint(w, mid, range(rand, 0.5, 0.62));
    w.eyes.push({
      x: ex,
      y: ey,
      r: spline(radii, (mid + 1) / 2) * range(rand, 0.12, 0.2),
    });
  } else if (rand() < 0.5) {
    const [ex, ey] = wingPoint(w, mid, 0.5);
    w.discal = { x: ex, y: ey, r: 0.028 };
  }
  return w;
}

function makeMoth(rand: () => number, inks: Inks): Moth {
  const t = pick(rand, MOTHS);
  const { dark, paper, light } = inks;
  const size = range(rand, 0.9, 1.05);
  const fore = jitter(rand, t.fore, size);
  const hind = jitter(rand, t.hind, size);

  // Grounds: a light ink on each wing, the same or a contrast, sometimes a pale or a drab forewing over a
  // bright hindwing.
  const scheme = rand();
  const bright = pick(rand, light);
  const foreGround =
    scheme < 0.2
      ? mix(paper, dark, range(rand, 0.25, 0.45))
      : scheme < 0.35
        ? mix(paper, bright, 0.35)
        : bright;
  const hindGround =
    rand() < 0.6 ? (scheme < 0.35 ? bright : foreGround) : pick(rand, light);
  const eyes = rand() < t.eyes;
  const f = makeWing(
    rand,
    0.05,
    -0.12,
    fore,
    foreGround,
    inks,
    eyes && rand() < 0.6,
  );
  const h = makeWing(rand, 0.05, -0.02, hind, hindGround, inks, eyes);
  h.scallop = t.scallop;
  h.scallops = Math.floor(range(rand, 6, 10));

  // A tail grows out of the hindwing's outer corner, hanging down and a little out, tapering.
  let tail: Capsule | null = null;
  if (t.tail) {
    const [ax, ay] = wingPoint(h, t.tail.p, 0.92);
    const [dx, dy] = [0.35, 1];
    const len = Math.sqrt(dx * dx + dy * dy);
    const l = t.tail.length * size * range(rand, 0.85, 1.15);
    const w = t.tail.width * size;
    tail = capsuleOf(
      ax,
      ay,
      ax + (dx / len) * l,
      ay + (dy / len) * l,
      w * 1.2,
      w * 0.7,
    );
  }

  // Antennae lean out ahead of the head, bending once.
  const reach = range(rand, 0.3, 0.45) * (t.antenna === "feather" ? 0.8 : 1);
  const lean = range(rand, 0.4, 0.9);
  const [tx, ty] = [0.03 + reach * lean, -0.25 - reach];
  const [mx, my] = [0.03 + reach * lean * 0.35, -0.25 - reach * 0.55];
  const antennae = [
    capsuleOf(0.025, -0.24, mx, my, 0.006, 0.005),
    capsuleOf(mx, my, tx, ty, 0.005, 0.004),
  ];
  const feather = range(rand, 0.025, 0.04);
  const feathers =
    t.antenna === "feather"
      ? antennae.map((c) =>
          capsuleOf(c.ax, c.ay, c.bx, c.by, feather * 0.7, feather * 0.4),
        )
      : [];

  const moth: Moth = {
    kind: "moth",
    fore: f,
    hind: h,
    tail,
    tailInk: h.border ? h.border.ink : hindGround,
    antennae,
    feathers,
    club: t.antenna === "club" ? 0.016 : 0,
    body: rand() < 0.6 ? dark : mix(foreGround, dark, 0.5),
    hair: mix(foreGround, paper, 0.3),
    pin: [0, -0.07],
    box: { x0: 0, x1: 0, y0: -0.3, y1: 0.55 },
  };
  // The bounds, from the outlines and the parts that stick out.
  for (const w of [f, h])
    for (let i = 0; i <= 32; i++) {
      const [x, y] = wingPoint(w, -1 + i / 16, 1);
      grow(moth.box, x, y);
    }
  for (const c of [...antennae, ...feathers, ...(tail ? [tail] : [])])
    capsuleBox(moth.box, c);
  return moth;
}

// Beetle forms: an elytra width profile from shoulder to tip as a fraction of its widest, a pronotum profile,
// and the parts that set the form apart.
type Form = {
  elytra: readonly number[];
  length: [number, number];
  width: [number, number];
  pronotum: readonly number[];
  antenna: "beads" | "club" | "long";
  jaws: "none" | "mandibles" | "horn";
  striae: number;
  legs: number;
};

// prettier-ignore
const BEETLES: readonly Form[] = [
  // A ground beetle: long, grooved, long-legged.
  {
    elytra: [0.85, 0.97, 1, 1, 0.97, 0.9, 0.76, 0.52, 0], length: [0.78, 0.9], width: [0.24, 0.28],
    pronotum: [0.6, 0.85, 0.95, 0.95, 0.8], antenna: "beads", jaws: "none", striae: 8, legs: 1.15,
  },
  // A ladybird or leaf beetle: short and round.
  {
    elytra: [0.82, 0.96, 1, 1, 0.97, 0.9, 0.77, 0.52, 0], length: [0.55, 0.65], width: [0.33, 0.38],
    pronotum: [0.55, 0.8, 0.92, 0.98, 1], antenna: "club", jaws: "none", striae: 0, legs: 0.7,
  },
  // A longhorn: narrow and parallel, with antennae longer than its body.
  {
    elytra: [0.92, 1, 1, 0.98, 0.95, 0.9, 0.8, 0.6, 0], length: [0.85, 0.95], width: [0.2, 0.24],
    pronotum: [0.6, 0.8, 0.9, 0.85, 0.75], antenna: "long", jaws: "none", striae: 0, legs: 1,
  },
  // A stag beetle, with great jaws.
  {
    elytra: [0.92, 1, 1, 1, 0.98, 0.93, 0.82, 0.58, 0], length: [0.62, 0.72], width: [0.27, 0.31],
    pronotum: [0.85, 0.95, 1, 1, 0.95], antenna: "club", jaws: "mandibles", striae: 0, legs: 1,
  },
  // A rhinoceros beetle: broad and glossy, with a horn.
  {
    elytra: [0.88, 0.98, 1, 1, 0.97, 0.9, 0.78, 0.55, 0], length: [0.62, 0.72], width: [0.3, 0.35],
    pronotum: [0.7, 0.9, 1, 1, 0.98], antenna: "club", jaws: "horn", striae: 0, legs: 0.9,
  },
  // A jewel beetle: bullet shaped, tapering to its tip.
  {
    elytra: [0.95, 1, 0.97, 0.92, 0.85, 0.74, 0.58, 0.36, 0], length: [0.75, 0.85], width: [0.24, 0.28],
    pronotum: [0.65, 0.85, 0.95, 1, 1], antenna: "beads", jaws: "none", striae: 10, legs: 0.75,
  },
];

// A chain of capsules from (x, y), one per [dx, dy, length] step, tapering from w to w / 2. The last one is
// beaded.
function chain(
  x: number,
  y: number,
  steps: readonly [number, number, number][],
  w: number,
  beads = 0,
): Capsule[] {
  return steps.map(([dx, dy, len], i) => {
    const l = Math.sqrt(dx * dx + dy * dy);
    const [bx, by] = [x + (dx / l) * len, y + (dy / l) * len];
    const w0 = w * (1 - (0.5 * i) / steps.length);
    const w1 = w * (1 - (0.5 * (i + 1)) / steps.length);
    const c = capsuleOf(
      x,
      y,
      bx,
      by,
      w0,
      w1,
      i === steps.length - 1 ? beads : 0,
    );
    [x, y] = [bx, by];
    return c;
  });
}

function makeBeetle(rand: () => number, inks: Inks): Beetle {
  const form = pick(rand, BEETLES);
  const { dark, paper, light } = inks;
  const length = range(rand, ...form.length);
  const width = range(rand, ...form.width);
  const e0 = -0.25;
  const e1 = e0 + length;
  const pl = range(rand, 0.17, 0.24) * (form.jaws === "horn" ? 1.2 : 1);
  const p0 = e0 - pl;
  const pw = width * range(rand, 0.75, 0.95);
  const head = { y: p0 - 0.06, rx: pw * range(rand, 0.45, 0.6), ry: 0.08 };
  const j = (x: number) => x * (1 + 0.2 * (rand() - 0.5));
  const legs = form.legs * range(rand, 0.9, 1.1);

  // Front, middle and hind legs: femur, tibia and beaded tarsus.
  // prettier-ignore
  const limbs: Capsule[] = [
    ...chain(pw * 0.5, p0 + pl * 0.6, [[1, j(-0.4), 0.2 * legs], [j(0.5), -1, 0.2 * legs], [j(0.3), -1, 0.12 * legs]], 0.028, 4),
    ...chain(width * 0.5, e0 + 0.08, [[1, j(0.1), 0.22 * legs], [j(0.9), 0.6, 0.22 * legs], [j(0.5), 1, 0.12 * legs]], 0.028, 4),
    ...chain(width * 0.5, e0 + 0.25, [[1, j(0.7), 0.24 * legs], [j(0.4), 1, 0.26 * legs], [j(0.2), 1, 0.14 * legs]], 0.028, 4),
  ];
  const top = head.y - head.ry * 0.6;
  if (form.antenna === "long") {
    const l = range(rand, 0.9, 1.2);
    // prettier-ignore
    limbs.push(...chain(head.rx * 0.6, top, [[0.6, -1, 0.25 * l], [1, j(0.2), 0.3 * l], [0.35, 1, 0.45 * l]], 0.014, 9));
  } else {
    const l = range(rand, 0.8, 1.1);
    // prettier-ignore
    const ant = chain(head.rx * 0.7, top, [[0.5, -1, 0.14 * l], [1, -0.6, 0.12 * l]], 0.012, form.antenna === "beads" ? 7 : 0);
    limbs.push(...ant);
    if (form.antenna === "club") {
      const end = ant[ant.length - 1];
      limbs.push(
        capsuleOf(end.bx, end.by, end.bx + 0.03, end.by - 0.02, 0.022, 0.018),
      );
    }
  }
  if (form.jaws === "mandibles") {
    const l = range(rand, 0.7, 1.2);
    // prettier-ignore
    limbs.push(...chain(head.rx * 0.5, head.y - head.ry * 0.7, [[0.5, -1, 0.14 * l], [-0.3, -1, 0.1 * l], [-1, -0.5, 0.06 * l]], 0.03));
  } else if (form.jaws === "horn") {
    const l = range(rand, 0.15, 0.3);
    limbs.push(capsuleOf(0, head.y, 0, head.y - head.ry - l, 0.05, 0.012));
  }

  // Shell colors: a light ink, or glossy dark with light markings.
  const darkShell = rand() < 0.3;
  const shell = darkShell ? dark : pick(rand, light);
  const pattern = darkShell
    ? pick(rand, [...light, paper])
    : rand() < 0.8
      ? dark
      : paper;
  const elytra = {
    y0: e0,
    y1: e1,
    widths: Float64Array.from(form.elytra, (w) => w * width),
    striae: form.striae,
  };
  const b: Beetle = {
    kind: "beetle",
    head,
    pronotum: {
      y0: p0,
      y1: e0 + 0.01,
      widths: Float64Array.from(form.pronotum, (w) => w * pw),
    },
    elytra,
    limbs,
    shell,
    pattern,
    shine: mix(shell, paper, 0.6),
    dark,
    spots: [],
    bands: [],
    stripes: [],
    margin: 0,
    // Beetles are pinned through the right elytron.
    pin: [width * 0.4, e0 + length * 0.2],
    box: { x0: 0, x1: width, y0: top, y1: e1 },
  };
  for (const c of limbs) capsuleBox(b.box, c);

  const kind = rand();
  if (form.striae === 0 && kind < 0.4) {
    // Spots, and on some a spot astride the suture at the top.
    const count = Math.floor(range(rand, 2, 5));
    for (let i = 0; i < count; i++) {
      const t = 0.15 + (0.65 * (i + rand() * 0.6)) / count;
      const n = range(rand, 0.3, 0.75);
      const w = spline(elytra.widths, t);
      b.spots.push({
        x: n * w,
        y: e0 + t * length,
        r: w * range(rand, 0.16, 0.26),
      });
    }
    if (rand() < 0.4) b.spots.push({ x: 0, y: e0 + 0.08, r: width * 0.18 });
  } else if (kind < 0.65) {
    const count = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++)
      b.bands.push({
        t: (i + 0.5 + 0.3 * (rand() - 0.5)) / count,
        half: range(rand, 0.03, 0.07),
        zig: range(rand, 0, 0.04),
      });
  } else if (kind < 0.8) {
    b.stripes.push({
      n: range(rand, 0.35, 0.6),
      half: range(rand, 0.08, 0.16),
    });
  } else if (kind < 0.92) b.margin = range(rand, 0.78, 0.88);
  return b;
}

// How much of a sample `px` wide at (x, y) an axis-aligned ellipse at (0, cy) covers.
function ellipse(
  x: number,
  y: number,
  cy: number,
  rx: number,
  ry: number,
  px: number,
) {
  const ex = x / rx;
  const ey = (y - cy) / ry;
  const k = Math.sqrt(ex * ex + ey * ey);
  if (k > 1.5) return 0;
  // Distance square to the outline, from the gradient of k.
  const g = Math.sqrt((ex / rx) * (ex / rx) + (ey / ry) * (ey / ry));
  return edge(((1 - k) * k) / (g > 0 ? g : 1), px);
}

// Paints a beetle's pronotum or elytra at (x, y), x ≥ 0, under `out`: a glossy highlight, darker toward the
// edges, and on the elytra grooves and a pattern.
function paintShield(
  b: Beetle,
  y0: number,
  y1: number,
  widths: Float64Array,
  elytra: boolean,
  x: number,
  y: number,
  px: number,
) {
  if (y < y0 - px || y > y1 + px) return;
  const t = (y - y0) / (y1 - y0);
  const w = spline(widths, t);
  if (w <= 0) return;
  const dw = slope / (y1 - y0);
  const cover = Math.min(
    edge((w - x) / Math.sqrt(1 + dw * dw), px),
    edge(y - y0, px),
    edge(y1 - y, px),
  );
  if (cover === 0) return;
  const n = x / w;
  set(part, b.shell);
  if (elytra) {
    for (let i = 0; i < b.spots.length; i++) {
      const s = b.spots[i];
      const sx = x - s.x;
      const sy = y - s.y;
      over(part, b.pattern, edge(s.r - Math.sqrt(sx * sx + sy * sy), px));
    }
    for (let i = 0; i < b.bands.length; i++) {
      const band = b.bands[i];
      const off = t - band.t - band.zig * tri(n * 2.5);
      over(part, b.pattern, edge((band.half - Math.abs(off)) * (y1 - y0), px));
    }
    for (let i = 0; i < b.stripes.length; i++) {
      const s = b.stripes[i];
      over(part, b.pattern, edge((s.half - Math.abs(n - s.n)) * w, px));
    }
    if (b.margin > 0) over(part, b.pattern, edge((n - b.margin) * w, px));
    const striae = b.elytra.striae;
    if (striae > 0) {
      const s = n * striae;
      const k = Math.round(s);
      const dx = ((s - k) * w) / striae;
      over(part, b.dark, 0.55 * line(dx, 0.0025, px));
      // Punctures along each groove.
      const f = sharp(0.02, px);
      if (f > 0) {
        const a = (y - y0) / 0.02;
        const dy = (a - Math.round(a)) * 0.02;
        const dot = edge(0.005 - Math.sqrt(dx * dx + dy * dy), px) - 0.2;
        over(part, b.dark, 0.5 * f * dot);
      }
    }
    // The suture where the elytra meet.
    over(part, b.dark, 0.8 * line(x, 0.004, px));
  }
  over(part, b.dark, 0.5 * n * n * n * n);
  over(part, b.shine, 0.55 * bump((n - 0.42) / 0.16) * bump((t - 0.32) / 0.4));
  under(part, cover);
}

// Paints a beetle at (x, y), x ≥ 0, under `out`, front to back.
function paintBeetle(b: Beetle, x: number, y: number, px: number) {
  const e = b.elytra;
  paintShield(b, e.y0, e.y1, e.widths, true, x, y, px);
  const p = b.pronotum;
  paintShield(b, p.y0, p.y1, p.widths, false, x, y, px);
  if (keep === 0) return;
  // The head, with eyes at its sides.
  const h = b.head;
  const head = ellipse(x, y, h.y, h.rx, h.ry, px);
  if (head > 0) {
    const ex = x - h.rx * 0.82;
    const ey = y - h.y + h.ry * 0.2;
    under(b.shine, 0.35 * edge(h.rx * 0.22 - Math.sqrt(ex * ex + ey * ey), px));
    under(b.dark, head);
  }
  under(b.dark, capsules(b.limbs, x, y, px));
}

// Paints a moth at (x, y), x ≥ 0, under `out`, front to back.
function paintMoth(m: Moth, x: number, y: number, px: number) {
  // Body: the head, a furred thorax and a ringed abdomen.
  under(m.body, ellipse(x, y, -0.21, 0.045, 0.04, px));
  const thorax = ellipse(x, y, -0.07, 0.075, 0.13, px);
  if (thorax > 0) {
    set(part, m.body);
    const f = sharp(0.008, px);
    if (f > 0)
      over(
        part,
        m.hair,
        0.5 * f * clamp01(noise2(x / 0.004, y / 0.03, 0x4a17) * 2 - 1),
      );
    under(part, thorax);
  }
  const abdomen = ellipse(x, y, 0.24, 0.05, 0.3, px);
  if (abdomen > 0) {
    set(part, m.body);
    shadeBy(part, -0.12 * sharp(0.05, px) * tri((y - 0.24) / 0.05));
    under(part, abdomen);
  }
  if (keep === 0) return;

  // Antennae: threads, clubbed at the tip, or feathered, the feather a comb of fine branches.
  let ant = capsules(m.antennae, x, y, px);
  for (let i = 0; i < m.feathers.length; i++) {
    const a = capsule(m.feathers[i], x, y, px);
    if (a === 0) continue;
    const comb =
      0.45 + 0.9 * sharp(0.012, px) * tri((y - m.feathers[i].ay) / 0.012);
    if (a * comb > ant) ant = a * comb;
  }
  if (m.club > 0) {
    const tip = m.antennae[m.antennae.length - 1];
    const cx = x - tip.bx;
    const cy = y - tip.by;
    const club = edge(m.club - Math.sqrt(cx * cx + cy * cy * 0.6), px);
    if (club > ant) ant = club;
  }
  under(m.body, ant);

  paintWing(m.fore, x, y, px);
  if (keep === 0) return;
  paintWing(m.hind, x, y, px);
  if (m.tail) under(m.tailInk, capsule(m.tail, x, y, px));
}

// A specimen's silhouette at (x, y), x ≥ 0, blurred by `soft`, for its shadow.
function silhouette(s: Species, x: number, y: number, soft: number): number {
  if (s.kind === "moth")
    return Math.max(wingAt(s.fore, x, y, soft), wingAt(s.hind, x, y, soft));
  const p = s.pronotum;
  const e = s.elytra;
  if (y < p.y0 - soft || y > e.y1 + soft) return 0;
  const w =
    y < e.y0
      ? spline(p.widths, (y - p.y0) / (e.y0 - p.y0))
      : spline(e.widths, (y - e.y0) / (e.y1 - e.y0));
  return edge(w - x, soft) * edge(y - p.y0, soft) * edge(e.y1 - y, soft);
}

// A grid of unit trays, `cols` by `rows`, and the one left empty, or -1.
type Layout = { cols: number; rows: number; empty: number };

// The grid for `count` specimens, with at most one tray to spare in a drawer of three or more, whose trays come closest to `shape`, the
// width over height that fits a specimen and its label.
function layout(
  count: number,
  W: number,
  H: number,
  shape: number,
  rand: () => number,
): Layout {
  let best: Layout = { cols: 1, rows: 1, empty: -1 };
  let score = Infinity;
  for (let cols = 1; cols <= 3; cols++)
    for (let rows = 1; rows <= 3; rows++) {
      const spare = cols * rows - count;
      if (spare < 0 || spare > (count < 3 ? 0 : 1)) continue;
      const ratio = W / cols / (H / rows) / shape;
      const s = ratio > 1 ? ratio : 1 / ratio;
      if (s < score) {
        best = {
          cols,
          rows,
          empty: spare ? Math.floor(rand() * cols * rows) : -1,
        };
        score = s;
      }
    }
  return best;
}

// Where a tray's specimen sits: its center and scale, art units per specimen unit, 0 for an empty tray.
type Placed = {
  s: Species;
  cx: number;
  cy: number;
  S: number;
  label: Box;
  salt: number;
};

// Small draws are supersampled until the art's short side has this many samples, so scales, veins and text
// finer than a pixel average out the way they would in a large draw scaled down.
const MIN_UNIT = 128;

// The light comes from the upper left, so shadows fall to the lower right, in specimen units.
const SHADOW_X = 0.06;
const SHADOW_Y = 0.08;

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper: paperHex, inks: inkHex }: Palette,
) {
  const rand = stream(seed, 0);
  const paper = rgb(paperHex);
  const ink = inkHex.map(rgb);
  const dark = ink[0];
  const inks: Inks = { paper, dark, light: ink.slice(1) };

  const unitPx = Math.min(width, height);
  const W = width / unitPx;
  const H = height / unitPx;

  // The drawer: a frame, dividers between unit trays, and foam lining them.
  const frame = range(rand, 0.035, 0.06);
  const frameInk = rand() < 0.6 ? dark : mix(dark, ink[ink.length - 1], 0.35);
  const divider = mix(frameInk, paper, range(rand, 0.35, 0.6));
  const foam = mix(paper, pick(rand, ink), range(rand, 0.04, 0.1));
  const gap = range(rand, 0.012, 0.022);

  // What the drawer holds: moths, beetles or both, as a series of one species or all different.
  const theme = rand();
  const series = rand() < 0.3;
  const count = pick(rand, [1, 2, 3, 4, 4, 5, 6, 6]);
  const species = (): Species => {
    const beetle = theme < 0.45 ? false : theme < 0.75 ? true : rand() < 0.5;
    return beetle ? makeBeetle(rand, inks) : makeMoth(rand, inks);
  };
  const first = species();
  const [iw, ih] = [W - 2 * frame, H - 2 * frame];
  const grid = layout(count, iw, ih, first.kind === "moth" ? 1.15 : 0.95, rand);
  const pw = iw / grid.cols;
  const ph = ih / grid.rows;

  const trays: Placed[] = [];
  for (let j = 0; j < grid.rows; j++)
    for (let i = 0; i < grid.cols; i++) {
      const index = trays.length;
      const s = index === 0 || series ? first : species();
      const [x0, y0] = [frame + i * pw + gap / 2, frame + j * ph + gap / 2];
      const [tw, th] = [pw - gap, ph - gap];
      // The label sits at the foot of the tray, the specimen fills the space above.
      const lw = Math.min(tw * 0.34, th * 0.5);
      const lh = lw * 0.32;
      const ly = y0 + th - lh - th * 0.07;
      const label = {
        x0: x0 + tw / 2 - lw,
        x1: x0 + tw / 2 + lw,
        y0: ly - lh,
        y1: ly + lh,
      };
      const salt = Math.floor(rand() * 2 ** 31);
      if (index === grid.empty) {
        trays.push({
          s,
          cx: x0 + tw / 2,
          cy: y0 + th * 0.45,
          S: 0,
          label,
          salt,
        });
        continue;
      }
      const room = (label.y0 - y0) * 0.9;
      const fit = Math.min(
        (tw * 0.86) / (2 * s.box.x1),
        room / (s.box.y1 - s.box.y0),
      );
      const S = fit * (series ? range(rand, 0.85, 1) : 1);
      const cy = y0 + (label.y0 - y0) / 2 - (S * (s.box.y0 + s.box.y1)) / 2;
      trays.push({ s, cx: x0 + tw / 2, cy, S, label, salt });
    }
  const foamSalt = Math.floor(rand() * 2 ** 31);

  const ss = Math.ceil(MIN_UNIT / unitPx);
  const px = 1 / (unitPx * ss);

  // The label, the specimen's shadows, the specimen and its pin at (x, y), into `tray`. The specimen paints
  // into `out` first.
  const paintTray = (t: Placed, x: number, y: number) => {
    const L = t.label;
    // The label lifts a little off the foam.
    const lift = Math.min(
      x - L.x0 - 0.004,
      L.x1 + 0.004 - x,
      y - L.y0 - 0.004,
      L.y1 + 0.004 - y,
    );
    over(tray, dark, 0.2 * edge(lift, px));
    const onLabel = edge(Math.min(x - L.x0, L.x1 - x, y - L.y0, L.y1 - y), px);
    if (onLabel > 0) {
      over(tray, paper, onLabel);
      // Two lines of handwriting: words of letters, some with ascenders.
      const lw = (L.x1 - L.x0) / 2;
      const lh = (L.y1 - L.y0) / 2;
      const u = (x - L.x0) / lw - 1;
      const v = (y - L.y0) / lh - 1;
      const row = v < 0 ? 0 : 1;
      const at = row === 0 ? -0.38 : 0.32;
      const end = row === 0 ? 0.75 : -0.2 + 0.7 * hash2(t.salt, 9, 3);
      if (u > -0.82 && u < end) {
        const word = Math.floor((u + 1) / 0.13);
        const fw = sharp(0.13 * lw, px);
        const inWord =
          0.75 + fw * ((hash2(word, row, t.salt) < 0.75 ? 1 : 0) - 0.75);
        const letter = (u + 1) / 0.045;
        const tall = hash2(Math.floor(letter), row, t.salt + 1) < 0.25;
        const short = line((v - at) * lh, 0.16 * lh, px);
        const high = line((v - at + 0.13) * lh, 0.29 * lh, px);
        // Seen whole, a letter is a stroke 45% of its cell, a quarter of them tall.
        const average = 0.45 * (0.75 * short + 0.25 * high);
        const fs = sharp(0.045 * lw, px);
        const stroke =
          letter - Math.floor(letter) < 0.45 ? (tall ? high : short) : 0;
        over(tray, dark, 0.85 * inWord * (average + fs * (stroke - average)));
      }
    }
    if (t.S === 0) {
      // An empty tray keeps its pin hole.
      const hx = x - t.cx;
      const hy = y - t.cy;
      over(tray, dark, 0.6 * edge(0.006 - Math.sqrt(hx * hx + hy * hy), px));
      return;
    }

    const S = t.S;
    const s = t.s;
    const lx = (x - t.cx) / S;
    const ly = (y - t.cy) / S;
    const lp = px / S;
    const b = s.box;
    if (lx < -b.x1 || lx > b.x1 + 0.45 || ly < b.y0 || ly > b.y1 + 0.6) return;

    // The specimen, then under it, where it doesn't hide them, its shadow on the foam and the pin's.
    out.fill(0);
    keep = 1;
    const ax = lx < 0 ? -lx : lx;
    if (s.kind === "moth") paintMoth(s, ax, ly, lp);
    else paintBeetle(s, ax, ly, lp);
    const pinX = s.pin[0];
    const pinY = s.pin[1];
    if (keep > 0) {
      const sx = lx - SHADOW_X;
      over(
        tray,
        dark,
        0.22 * silhouette(s, sx < 0 ? -sx : sx, ly - SHADOW_Y, 0.08),
      );
      const pin = capsule(PIN_SHADOW, lx - pinX, ly - pinY, lp);
      if (pin > 0) over(tray, dark, 0.35 * pin * (1 - along));
    }
    tray[0] = out[0] + keep * tray[0];
    tray[1] = out[1] + keep * tray[1];
    tray[2] = out[2] + keep * tray[2];
    // The pin's head, on top.
    const hx = lx - pinX;
    const hy = ly - pinY;
    over(tray, dark, edge(PIN_HEAD - Math.sqrt(hx * hx + hy * hy), lp));
    const gx = hx + PIN_HEAD * 0.35;
    const gy = hy + PIN_HEAD * 0.35;
    over(
      tray,
      paper,
      0.8 * edge(PIN_HEAD * 0.3 - Math.sqrt(gx * gx + gy * gy), lp),
    );
  };

  // The dividers, foam and whatever a tray holds at (x, y), into `tray`.
  const shadeTray = (x: number, y: number) => {
    set(tray, divider);
    const i = Math.min(
      grid.cols - 1,
      Math.max(0, Math.floor((x - frame) / pw)),
    );
    const j = Math.min(
      grid.rows - 1,
      Math.max(0, Math.floor((y - frame) / ph)),
    );
    const x0 = frame + i * pw + gap / 2;
    const y0 = frame + j * ph + gap / 2;
    const lining = edge(
      Math.min(x - x0, x0 + pw - gap - x, y - y0, y0 + ph - gap - y),
      px,
    );
    if (lining === 0) return;
    // Foam, faintly mottled, in the shadow of the tray's top and left walls.
    set(part, foam);
    const f1 = sharp(1 / 40, px);
    const f2 = sharp(1 / 110, px);
    shadeBy(
      part,
      0.05 * f1 * (noise2(x * 40, y * 40, foamSalt) - 0.5) +
        0.04 * f2 * (noise2(x * 110, y * 110, foamSalt + 1) - 0.5),
    );
    const wall = Math.max(bump((x - x0) / 0.03), bump((y - y0) / 0.03));
    over(part, dark, 0.16 * wall);
    over(tray, part, lining);
    paintTray(trays[j * grid.cols + i], x, y);
  };

  // The color at (x, y) in the art, into `out`.
  const shade = (x: number, y: number) => {
    const inner = Math.min(x - frame, W - frame - x, y - frame, H - frame - y);
    const inside = edge(inner, px);
    if (inside > 0) shadeTray(x, y);
    set(out, frameInk);
    // The frame's inner edge catches the light.
    over(out, paper, 0.3 * line(inner + 0.006, 0.004, px));
    over(out, tray, inside);
  };

  const image = ctx.createImageData(width, height);
  const data = image.data;
  const n = ss * ss;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < ss; j++)
        for (let i = 0; i < ss; i++) {
          shade((x * ss + i + 0.5) * px, (y * ss + j + 0.5) * px);
          r += out[0];
          g += out[1];
          b += out[2];
        }
      const p = (y * width + x) * 4;
      data[p] = Math.round(r / n);
      data[p + 1] = Math.round(g / n);
      data[p + 2] = Math.round(b / n);
      data[p + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
}

// The pin's head, and the shadow it casts from where it stands, in specimen units from the pin.
const PIN_HEAD = 0.028;
const PIN_SHADOW = capsuleOf(0, 0, 0.4, 0.55, 0.008, 0.004);

export const specimenDrawer1: Style = {
  id: "moth1",
  draw,
};
