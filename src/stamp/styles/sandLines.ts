import { cos, exp, pow, sin } from "../exact";
import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Sand lines: Anders Hoff's sand technique. A curve is drawn as many translucent grains rather than a
// stroke, so ink builds up where curves overlap and thins to dust where they spread. The seed picks one of
// two ports. Ribbons, from sand-spline: splines whose points take a random walk, one end held still and the
// other wandering more each step, so each ribbon frays from a clean line into smoke. Glyphs, from
// sand-glyphs: rows of made-up cursive words, each a spline through a few random points per letter, drawn
// with a slanted nib, like asemic handwriting.
//
// Ported from inconvergent/sand-spline (https://github.com/inconvergent/sand-spline) and
// inconvergent/sand-glyphs (https://github.com/inconvergent/sand-glyphs). Both carry this license:
//
//   The MIT License (MIT)
//
//   Copyright (c) 2016 Anders Hoff
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
//   associated documentation files (the "Software"), to deal in the Software without restriction, including
//   without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
//   following conditions:
//
//   The above copyright notice and this permission notice shall be included in all copies or substantial
//   portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
//   LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
//   EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
//   IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR
//   THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//
// Curves are built in art units (the art's short side is 1) from one random stream, so the same seed gives
// the same curves at any size. Grains come from a second stream, and their number grows with the pixel count
// while each lays down less ink, so the ink lies the same at 256 px and 2048 px, only finer grained.
// Pixels are computed in code with IEEE-exact arithmetic (ADR 0001): trig comes from exact.ts.

type Rgb = [number, number, number];

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

// ---- The sand helper -------------------------------------------------------------------------------------

// Ink density per pixel, one layer per ink. A pixel's density is the ink laid on it per unit of its area:
// at 1 it shows its ink about three quarters strong (see `tone`).
export type Sand = {
  width: number;
  height: number;
  // Pixels per art unit.
  unit: number;
  density: Float32Array[];
};

export function sandCanvas(width: number, height: number, inks: number): Sand {
  return {
    width,
    height,
    unit: Math.min(width, height),
    density: Array.from(
      { length: inks },
      () => new Float32Array(width * height),
    ),
  };
}

// The density one grain lays on a pixel. Smaller means more, fainter grains: smoother sand, more work.
const GRAIN = 0.08;

// A broad pen for `sprinkle`: each grain lands somewhere on a short stroke across the curve, set by the pen's
// angle there, rather than on the curve itself. sand-glyphs' nib.
export type Nib = {
  // The stroke's half length, in art units.
  size: number;
  // The pen's direction as cos, sin pairs at evenly spaced knots along the curve, from start to end.
  dirs: readonly number[];
};

// A spline ready for `sprinkle`: its points (flat x, y pairs in art units), each point's knot (the chord length
// along the points up to it, like the original's scipy splprep), and the natural cubic spline's slopes there.
export type Curve = {
  path: readonly number[];
  at: Float64Array;
  m: Float64Array;
};

// The curve through `path`, on knots `at` when given (as many as the points), else on its chord lengths.
export function curve(path: readonly number[], at?: Float64Array): Curve {
  if (!at) {
    at = new Float64Array(path.length / 2);
    for (let i = 1; i < at.length; i++) {
      const dx = path[2 * i] - path[2 * i - 2];
      const dy = path[2 * i + 1] - path[2 * i - 1];
      at[i] = at[i - 1] + Math.sqrt(dx * dx + dy * dy);
    }
  }
  return { path, at, m: slopes(path, at) };
}

// Scratch rows for `slopes`, grown as needed: it runs once per spline per step.
let diag = new Float64Array(64);
let upper = new Float64Array(64);
let rhs = new Float64Array(64);

// The slopes, per unit of chord length, of the natural cubic spline through `path` on knots `at`, as flat
// x, y pairs, so the curve passes through every point and bends smoothly through each. The Thomas algorithm
// on the rows 2 D0 + D1 = 3 (p1 - p0) / h0 at the start, the mirror at the end, and between them
// h_i D_(i-1) + 2 (h_(i-1) + h_i) D_i + h_(i-1) D_(i+1) = 3 (h_i dp_(i-1) / h_(i-1) + h_(i-1) dp_i / h_i).
function slopes(path: readonly number[], at: Float64Array): Float64Array {
  const n = at.length;
  const out = new Float64Array(2 * n);
  if (n < 2) return out;
  if (diag.length < n) {
    diag = new Float64Array(2 * n);
    upper = new Float64Array(2 * n);
    rhs = new Float64Array(2 * n);
  }
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < n; i++) {
      let lo = 0;
      let mid = 2;
      let hi = 0;
      // Knot spacings before and after, kept above zero where two points coincide.
      const a = i > 0 ? Math.max(at[i] - at[i - 1], 1e-9) : 0;
      const b = i < n - 1 ? Math.max(at[i + 1] - at[i], 1e-9) : 0;
      const p = path[2 * i + k];
      if (i === 0) {
        hi = 1;
        rhs[i] = (3 * (path[2 + k] - p)) / b;
      } else if (i === n - 1) {
        lo = 1;
        rhs[i] = (3 * (p - path[2 * i - 2 + k])) / a;
      } else {
        lo = b;
        mid = 2 * (a + b);
        hi = a;
        rhs[i] =
          3 *
          ((b * (p - path[2 * i - 2 + k])) / a +
            (a * (path[2 * i + 2 + k] - p)) / b);
      }
      if (i > 0) {
        const f = lo / diag[i - 1];
        mid -= f * upper[i - 1];
        rhs[i] -= f * rhs[i - 1];
      }
      diag[i] = mid;
      upper[i] = hi;
    }
    out[2 * (n - 1) + k] = rhs[n - 1] / diag[n - 1];
    for (let i = n - 2; i >= 0; i--)
      out[2 * i + k] = (rhs[i] - upper[i] * out[2 * (i + 1) + k]) / diag[i];
  }
  return out;
}

// The cubic Hermite curve from p0 (t = 0) to p1 (t = 1) with slopes m0 and m1 per unit of chord length,
// over a span h long.
const hermite = (
  p0: number,
  p1: number,
  m0: number,
  m1: number,
  h: number,
  t: number,
) => {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * p0 +
    (t3 - 2 * t2 + t) * h * m0 +
    (3 * t2 - 2 * t3) * p1 +
    (t3 - t2) * h * m1
  );
};

// Scatters grains of `ink` along `curve`, spread evenly over its knots, `mass` art units of ink in all.
// Grains are stratified along the curve, so they come out in order and leave no gaps, and each is shared
// bilinearly between the four pixels around it, so the ink laid down is exactly `mass` at any size.
//
// With `from`, the same spline a step earlier (on the same knots), each grain lands at a random moment between
// the two, so a moving spline fills the band it sweeps instead of leaving one hatched line per step. The
// original paints thousands of steps a pixel apart. That's out of budget here, and this draws the same sweep.
export function sprinkle(
  sand: Sand,
  rand: () => number,
  { path, at, m }: Curve,
  mass: number,
  ink: number,
  { nib, from }: { nib?: Nib; from?: Curve } = {},
) {
  const { width, height, unit } = sand;
  const layer = sand.density[ink];
  const points = at.length;
  const length = at[points - 1];
  if (points < 2 || !(mass > 0) || !(length > 0)) return;
  const grains = Math.ceil((mass * unit * unit) / GRAIN);
  const each = (mass * unit * unit) / grains;
  const knots = nib ? nib.dirs.length / 2 - 1 : 0;
  const p0 = from?.path;
  const m0 = from?.m;
  let seg = 0;
  for (let g = 0; g < grains; g++) {
    const u = ((g + rand()) / grains) * length;
    while (seg < points - 2 && at[seg + 1] <= u) seg++;
    const span = at[seg + 1] - at[seg];
    const t = span > 0 ? (u - at[seg]) / span : 0;
    const b = 2 * seg;
    const c = b + 2;
    let x = hermite(path[b], path[c], m[b], m[c], span, t);
    let y = hermite(path[b + 1], path[c + 1], m[b + 1], m[c + 1], span, t);
    if (p0 && m0) {
      const x0 = hermite(p0[b], p0[c], m0[b], m0[c], span, t);
      const y0 = hermite(p0[b + 1], p0[c + 1], m0[b + 1], m0[c + 1], span, t);
      const w = rand();
      x = x0 + w * (x - x0);
      y = y0 + w * (y - y0);
    }
    if (nib) {
      // The pen's direction here, between the two knots around it, then a point on its stroke: from
      // (cos, sin) to (sin, -cos) times its size, as sand-glyphs draws it.
      const k = (u / length) * knots;
      const kf = Math.min(knots - 1, Math.floor(k));
      const f = k - kf;
      const c =
        nib.dirs[2 * kf] + f * (nib.dirs[2 * kf + 2] - nib.dirs[2 * kf]);
      const s =
        nib.dirs[2 * kf + 1] +
        f * (nib.dirs[2 * kf + 3] - nib.dirs[2 * kf + 1]);
      const v = rand();
      x += nib.size * ((1 - v) * c + v * s);
      y += nib.size * ((1 - v) * s - v * c);
    }
    // Shared between the four pixels whose centers surround the grain.
    const fx = x * unit - 0.5;
    const fy = y * unit - 0.5;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const ax = fx - ix;
    const ay = fy - iy;
    if (ix < -1 || iy < -1 || ix >= width || iy >= height) continue;
    const w00 = each * (1 - ax) * (1 - ay);
    const w10 = each * ax * (1 - ay);
    const w01 = each * (1 - ax) * ay;
    const w11 = each * ax * ay;
    const row0 = iy * width;
    const row1 = row0 + width;
    if (iy >= 0) {
      if (ix >= 0) layer[row0 + ix] += w00;
      if (ix + 1 < width) layer[row0 + ix + 1] += w10;
    }
    if (iy + 1 < height) {
      if (ix >= 0) layer[row1 + ix] += w01;
      if (ix + 1 < width) layer[row1 + ix + 1] += w11;
    }
  }
}

// How much a pixel shows its ink at a density: grains stack like the original's translucent dots, so
// 1 - exp(-density), then lifted by the original's output gamma so faint dust stays visible. A table, since
// exact.ts's exp is too slow per pixel: TONE_STEPS entries per unit of density, up to TONE_MAX.
const GAMMA = 1.5;
const TONE_MAX = 8;
const TONE_STEPS = 128;
const TONE = Float64Array.from({ length: TONE_MAX * TONE_STEPS + 2 }, (_, i) =>
  i === 0 ? 0 : pow(1 - exp(-i / TONE_STEPS), 1 / GAMMA),
);
function tone(d: number): number {
  const k = d * TONE_STEPS;
  if (k >= TONE_MAX * TONE_STEPS) return TONE[TONE_MAX * TONE_STEPS];
  const i = Math.floor(k);
  return TONE[i] + (k - i) * (TONE[i + 1] - TONE[i]);
}

// Prints the sand onto `ground`, each layer in its ink.
function printSand(
  ctx: CanvasRenderingContext2D,
  { width, height, density }: Sand,
  ground: Rgb,
  inks: readonly Rgb[],
) {
  const image = ctx.createImageData(width, height);
  const data = image.data;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    let total = 0;
    for (const layer of density) total += layer[i];
    const alpha = tone(total);
    for (let k = 0; k < 3; k++) {
      let ink = ground[k];
      if (total > 0) {
        ink = 0;
        for (let l = 0; l < density.length; l++)
          ink += density[l][i] * inks[l][k];
        ink /= total;
      }
      data[i * 4 + k] = Math.round(ground[k] + (ink - ground[k]) * alpha);
    }
    data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

// ---- Ribbons: sand-spline ---------------------------------------------------------------------------------

// Directions for the random walk, so a step needs no trig: a random angle out of DIRS, as cos, sin pairs.
const DIRS = 64;
const DIR = Float64Array.from({ length: 2 * DIRS }, (_, i) => {
  const a = (2 * Math.PI * (i >> 1)) / DIRS;
  return i & 1 ? sin(a) : cos(a);
});

// The steps every spline wanders, each laying down its grains: the original's frames.
const STEPS = 300;
// The ink a stamp's ribbons lay down in all, shared by their starting lengths: a lone ring gets as much as a
// wreath, so its smoke reads as the original's does. Grains grow with it, so it also sets the draw's cost.
const RIBBON_INK = 0.24;

// One sand spline: control points that wander a little more each step. Point i's speed itself takes a random
// walk with steps up to i times `stir`, so the first point never moves and the far end frays most.
// `mass` is the ink it lays down per step: the same every step, as the original paints a fixed number of
// grains per frame, so the ink thins as the ribbon spreads.
type Spline = {
  curve: Curve;
  speed: number[];
  stir: number;
  ink: number;
  mass: number;
};

// A spline through `path`, laying down ink in proportion to its starting length until `ribbons` scales it.
// Its knots stay those of its starting shape as it wanders, so each step's curve can sweep from the last.
function spline(path: number[], stir: number, ink: number): Spline {
  const start = curve(path);
  const length = start.at[start.at.length - 1];
  const speed = new Array<number>(path.length / 2).fill(0);
  return {
    curve: start,
    speed,
    stir,
    ink,
    mass: length / STEPS,
  };
}

// One step: each point's speed takes a random step, then the point moves that far in a random direction.
function wander(s: Spline, rand: () => number) {
  const path = s.curve.path.slice();
  for (let i = 0; i < s.speed.length; i++) {
    s.speed[i] += (1 - 2 * rand()) * i * s.stir;
    const d = 2 * Math.floor(rand() * DIRS);
    path[2 * i] += DIR[d] * s.speed[i];
    path[2 * i + 1] += DIR[d + 1] * s.speed[i];
  }
  s.curve = curve(path, s.curve.at);
}

// Points evenly spaced from (x0, y0) to (x1, y1), as flat pairs.
function line(x0: number, y0: number, x1: number, y1: number, n: number) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push(x0 + t * (x1 - x0), y0 + t * (y1 - y0));
  }
  return out;
}

// Points around a circle from angle a0, a whole turn, the last on the first like the original's linspace.
function circle(cx: number, cy: number, r: number, a0: number, n: number) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (2 * Math.PI * i) / (n - 1);
    out.push(cx + r * cos(a), cy + r * sin(a));
  }
  return out;
}

// A stir that frays a spline of n points about `fray` art units at its far end after STEPS steps. The far
// point's speed walks to about stir n sqrt(steps / 3), and its position sums those speeds in random
// directions, so it travels about stir n STEPS / sqrt(6).
const stirFor = (fray: number, n: number) =>
  (fray * Math.sqrt(6)) / (STEPS * (n - 1));

// The ribbon layouts, after the original's main scripts. Each returns its splines in a W by H art.
const LAYOUTS: ((
  rand: () => number,
  W: number,
  H: number,
  inks: number,
) => Spline[])[] = [
  // main-hlines: rows of lines across the art, frayed toward one end, more on each row.
  (rand, W, H, inks) => {
    const across = rand() < 0.5;
    const [long, short] = across ? [W, H] : [H, W];
    const rows = 6 + Math.floor(rand() * 7);
    const edge = 0.1 + 0.04 * rand();
    const flip = rand() < 0.5;
    const two = inks > 1 && rand() < 0.4;
    const out: Spline[] = [];
    for (let i = 0; i < rows; i++) {
      const v = short * (edge + ((1 - 2 * edge) * (i + 0.5)) / rows);
      const n = 4 + i + Math.floor(rand() * 3);
      const fray = (0.03 + 0.05 * rand()) * (0.5 + (0.8 * i) / rows);
      const [a, b] = flip
        ? [long * (1 - edge), long * edge]
        : [long * edge, long * (1 - edge)];
      const pts = line(a, v, b, v, n);
      if (!across)
        for (let k = 0; k < pts.length; k += 2)
          [pts[k], pts[k + 1]] = [pts[k + 1], pts[k]];
      out.push(spline(pts, stirFor(fray, n), two && i % 2 === 1 ? 1 : 0));
    }
    return out;
  },
  // main-circle: a ring that frays from where it starts, sometimes a second, smaller one in another ink.
  (rand, W, H, inks) => {
    const out: Spline[] = [];
    const count = rand() < 0.3 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const n = 15 + Math.floor(rand() * 60);
      const r = (0.28 + 0.06 * rand()) * (i === 0 ? 1 : 0.55 + 0.2 * rand());
      const pts = circle(W / 2, H / 2, r, 2 * Math.PI * rand(), n);
      out.push(spline(pts, stirFor(0.14 + 0.14 * rand(), n), i % inks));
    }
    return out;
  },
  // main-circles: many rings around one center, each fraying from its own start: a wreath of smoke.
  (rand, W, H, inks) => {
    const count = 9 + Math.floor(rand() * 7);
    const out: Spline[] = [];
    for (let i = 0; i < count; i++) {
      const n = 12 + Math.floor(rand() * 28);
      const r = 0.12 + 0.26 * rand();
      const pts = circle(W / 2, H / 2, r, 2 * Math.PI * rand(), n);
      out.push(spline(pts, stirFor(0.04 + 0.08 * rand(), n), i % inks));
    }
    return out;
  },
  // Spokes from the center, as in the repo's .genlog sketches: each frays outward.
  (rand, W, H, inks) => {
    const count = 10 + Math.floor(rand() * 14);
    const a0 = 2 * Math.PI * rand();
    const reach = 0.36 + 0.06 * rand();
    const out: Spline[] = [];
    for (let i = 0; i < count; i++) {
      const a = a0 + (2 * Math.PI * (i + 0.3 * rand())) / count;
      const len = reach * (0.75 + 0.25 * rand());
      const n = 8 + Math.floor(rand() * 10);
      const pts = line(
        W / 2,
        H / 2,
        W / 2 + len * cos(a),
        H / 2 + len * sin(a),
        n,
      );
      out.push(
        spline(
          pts,
          stirFor(0.06 + 0.08 * rand(), n),
          inks > 1 && rand() < 0.25 ? 1 : 0,
        ),
      );
    }
    return out;
  },
  // A grid of small rings, as in the repo's .genlog sketches.
  (rand, W, H, inks) => {
    const cols = 3 + Math.floor(rand() * 2);
    const size = (W * 0.84) / cols;
    const rowsN = Math.max(1, Math.floor((H * 0.84) / size));
    const [ox, oy] = [(W - cols * size) / 2, (H - rowsN * size) / 2];
    const out: Spline[] = [];
    for (let j = 0; j < rowsN; j++)
      for (let i = 0; i < cols; i++) {
        const n = 8 + Math.floor(rand() * 14);
        const r = size * (0.26 + 0.08 * rand());
        const pts = circle(
          ox + (i + 0.5) * size,
          oy + (j + 0.5) * size,
          r,
          2 * Math.PI * rand(),
          n,
        );
        out.push(
          spline(pts, stirFor(size * (0.25 + 0.3 * rand()), n), (i + j) % inks),
        );
      }
    return out;
  },
];

function ribbons(
  sand: Sand,
  rand: () => number,
  grains: () => number,
  W: number,
  H: number,
  inks: number,
) {
  const layout = LAYOUTS[Math.floor(rand() * LAYOUTS.length)];
  const splines = layout(rand, W, H, inks);
  const total = STEPS * splines.reduce((sum, s) => sum + s.mass, 0);
  for (const s of splines) s.mass *= RIBBON_INK / total;
  for (let step = 0; step < STEPS; step++)
    for (const s of splines) {
      const from = s.curve;
      wander(s, rand);
      sprinkle(sand, grains, s.curve, s.mass, s.ink, { from });
    }
}

// ---- Glyphs: sand-glyphs ----------------------------------------------------------------------------------

// One made-up letter: 2 to 5 random points in an ellipse `w` wide and `h` tall around (x, y), put in order by
// walking to the nearest unvisited point from the leftmost. Some letters rise or drop by 1.7 heights, like
// ascenders and descenders, and half end by doubling back to an earlier point. sand-glyphs' _get_glyph.
function letter(
  rand: () => number,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const n = 2 + Math.floor(rand() * 4);
  const pts: number[][] = [];
  for (let i = 0; i < n; i++) {
    // A uniform point in the unit disc, by the original's sum of two draws.
    const a = 2 * Math.PI * rand();
    const u = rand() + rand();
    const r = 0.5 * (u > 1 ? 2 - u : u);
    pts.push([r * cos(a) * w, r * sin(a) * h]);
  }
  let at = pts.reduce((best, p, i) => (p[0] < pts[best][0] ? i : best), 0);
  const order = [pts[at]];
  const left = new Set(pts.keys());
  left.delete(at);
  while (left.size > 0) {
    let next = -1;
    let best = Infinity;
    for (const i of left) {
      const dx = pts[i][0] - pts[at][0];
      const dy = pts[i][1] - pts[at][1];
      const d = dx * dx + dy * dy;
      if (d < best) [best, next] = [d, i];
    }
    order.push(pts[next]);
    left.delete(next);
    at = next;
  }
  const shift = rand() < SHIFT ? (rand() < 0.5 ? -1 : 1) * 1.7 * h : 0;
  if (rand() < 0.5) order.push(order[Math.floor(rand() * (n - 1))]);
  return order.flatMap(([px, py]) => [x + px, y + py + shift]);
}

// How often a letter rises or drops.
const SHIFT = 0.2;
// Pen-angle knots per letter. The original turns the pen by a random walk of thousands of tiny steps per
// letter, about a radian in all: these knots take the same walk in a few larger steps, so it doesn't depend
// on how many grains draw the letter.
const KNOTS = 6;
const TURN = Math.sqrt((3 * 1.5) / KNOTS);

// sand-glyphs' writer: rows of made-up words in a broad pen. A word is 3 or more letters of random widths,
// written as one spline through all their points, so letters join like cursive. A word that won't fit the
// row starts the next, unless the row is empty.
function glyphs(
  sand: Sand,
  rand: () => number,
  grains: () => number,
  W: number,
  H: number,
  inks: number,
) {
  const rows = 7 + Math.floor(rand() * 5);
  const side = W * (0.1 + 0.03 * rand());
  const top = H * (0.1 + 0.03 * rand());
  const lead = (H - 2 * top) / (rows - 1);
  const h = lead * (0.26 + 0.08 * rand());
  const w = h * (0.45 + 0.15 * rand());
  const space = w * 1.2;
  // The pen: a stroke 0.2 letter heights each way, held near the original's 0.2 radians.
  const size = h * (0.17 + 0.06 * rand());
  const slant = 0.2 + 0.3 * (rand() - 0.5);
  // Some pages pick out a few words in a second ink, like the original's commented-out red.
  const accent = inks > 1 && rand() < 0.4 ? 0.12 : 0;
  // Ink per art unit of the word's spline, so a stroke prints dark where the pen turns broadside.
  const ink = size * 1.2;
  // The last row stops short on some pages, like the end of a letter.
  const end = rand() < 0.5 ? 0.3 + 0.5 * rand() : 1;

  const nextWord = () => {
    for (;;) {
      const word: number[] = [];
      while (rand() > 0.15) word.push((0.9 + 1.1 * rand()) * w);
      if (word.length > 2) return word;
    }
  };
  let carried: number[] | null = null;
  for (let r = 0; r < rows; r++) {
    const y = top + r * lead;
    const right = W - side - (r === rows - 1 ? (1 - end) * (W - 2 * side) : 0);
    let cursor = side;
    for (;;) {
      const word: number[] = carried ?? nextWord();
      carried = null;
      if (cursor + word.reduce((a, b) => a + b, 0) > right) {
        // The original carries it to the next row, and stalls on a word longer than any row: drop that one.
        if (cursor > side) carried = word;
        break;
      }
      const path: number[] = [];
      for (const width of word) {
        cursor += width;
        path.push(...letter(rand, cursor, y, w, h));
      }
      cursor += space;
      const dirs: number[] = [];
      let angle = slant;
      for (let k = 0; k <= KNOTS * word.length; k++) {
        dirs.push(cos(angle), sin(angle));
        angle += (1 - 2 * rand()) * TURN;
      }
      const written = curve(path);
      const length = written.at[written.at.length - 1];
      const color = rand() < accent ? 1 : 0;
      sprinkle(sand, grains, written, ink * length, color, {
        nib: { size, dirs },
      });
    }
  }
}

// ---- The style --------------------------------------------------------------------------------------------

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const grains = stream(seed, 0x5a4d);
  const unit = Math.min(width, height);
  const [W, H] = [width / unit, height / unit];
  let ground = rgb(paper);
  let colors = inks.map(rgb);
  const sand = sandCanvas(width, height, colors.length);
  if (rand() < 0.35) glyphs(sand, rand, grains, W, H, colors.length);
  else {
    // Some ribbons print pale out of the darkest ink, like sand-spline's second sample: the first ink becomes
    // paper, and the others stay where they stand out from the ground.
    if (rand() < 0.3) {
      const dark = colors[0];
      colors = colors.map((c, i) =>
        i > 0 && contrast(c, dark) > MIN_CONTRAST ? c : ground,
      );
      ground = dark;
    }
    ribbons(sand, rand, grains, W, H, colors.length);
  }
  printSand(ctx, sand, ground, colors);
}

// How far apart two colors' lightness is, out of 255.
const contrast = (a: Rgb, b: Rgb) =>
  Math.abs(
    0.299 * (a[0] - b[0]) + 0.587 * (a[1] - b[1]) + 0.114 * (a[2] - b[2]),
  );
// An ink closer than this to a dark ground would vanish into it.
const MIN_CONTRAST = 90;

export const sandLines1: Style = {
  id: "sand1",
  draw,
};
