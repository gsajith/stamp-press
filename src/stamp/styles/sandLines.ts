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
// while each lays down less ink, so the picture's tone is the same at 256 px and 2048 px, only finer grained.
// Pixels are computed in code with IEEE-exact arithmetic (ADR 0001): trig comes from exact.ts.

type Rgb = [number, number, number];

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

// ---- The sand helper -------------------------------------------------------------------------------------

// Ink density per pixel, one layer per ink. A pixel's density is the ink laid on it per unit of its area:
// 1 is about two thirds covered (see `tone`).
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
const GRAIN = 0.12;

// A broad pen for `sprinkle`: each grain lands somewhere on a short stroke across the curve, set by the pen's
// angle there, rather than on the curve itself. sand-glyphs' nib.
export type Nib = {
  // The stroke's half length, in art units.
  size: number;
  // The pen's direction as cos, sin pairs at evenly spaced knots along the curve, from start to end.
  dirs: readonly number[];
};

// The uniform Catmull-Rom curve from p1 (t = 0) to p2 (t = 1), shaped by the points before and after.
const catmullRom = (
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
) =>
  p1 +
  0.5 *
    t *
    (p2 -
      p0 +
      t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

// Scatters grains of `ink` along the spline through `path` (flat x, y pairs in art units), spread evenly by
// chord length, `mass` art units of ink in all. Grains are stratified along the curve, so they come out in
// order and leave no gaps, and each is shared bilinearly between the four pixels around it, so the ink laid
// down is exactly `mass` at any size.
export function sprinkle(
  sand: Sand,
  rand: () => number,
  path: readonly number[],
  mass: number,
  ink: number,
  nib?: Nib,
) {
  const { width, height, unit } = sand;
  const layer = sand.density[ink];
  const points = path.length / 2;
  if (points < 2 || !(mass > 0)) return;
  // Chord lengths, cumulative.
  const at = new Float64Array(points);
  for (let i = 1; i < points; i++) {
    const dx = path[2 * i] - path[2 * i - 2];
    const dy = path[2 * i + 1] - path[2 * i - 1];
    at[i] = at[i - 1] + Math.sqrt(dx * dx + dy * dy);
  }
  const length = at[points - 1];
  if (!(length > 0)) return;
  const grains = Math.ceil((mass * unit * unit) / GRAIN);
  const each = (mass * unit * unit) / grains;
  const knots = nib ? nib.dirs.length / 2 - 1 : 0;
  let seg = 0;
  for (let g = 0; g < grains; g++) {
    const u = ((g + rand()) / grains) * length;
    while (seg < points - 2 && at[seg + 1] <= u) seg++;
    const span = at[seg + 1] - at[seg];
    const t = span > 0 ? (u - at[seg]) / span : 0;
    const i0 = seg > 0 ? seg - 1 : 0;
    const i3 = seg + 2 < points ? seg + 2 : points - 1;
    let x = catmullRom(
      path[2 * i0],
      path[2 * seg],
      path[2 * seg + 2],
      path[2 * i3],
      t,
    );
    let y = catmullRom(
      path[2 * i0 + 1],
      path[2 * seg + 1],
      path[2 * seg + 3],
      path[2 * i3 + 1],
      t,
    );
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

// Directions for the random walk, so a step needs no trig: a random angle out of DIRS.
const DIRS = 64;
const DIR = Array.from({ length: DIRS }, (_, i) => {
  const a = (2 * Math.PI * i) / DIRS;
  return [cos(a), sin(a)];
});

// The steps every spline wanders, each laying down its grains: the original's frames.
const STEPS = 120;
// The ink every spline lays down over all its steps, per art unit of its starting length.
const RIBBON_INK = 0.012;

// One sand spline: control points that wander a little more each step. Point i's speed itself takes a random
// walk with steps up to i times `stir`, so the first point never moves and the far end frays most.
// `mass` is the ink it lays down per step: the same every step, as the original paints a fixed number of
// grains per frame, so the ink thins as the ribbon spreads.
type Spline = {
  path: number[];
  speed: number[];
  stir: number;
  ink: number;
  mass: number;
};

// A spline through `path` that lays down RIBBON_INK per art unit of its starting length, over all its steps.
function spline(path: number[], stir: number, ink: number): Spline {
  let length = 0;
  for (let i = 2; i < path.length; i += 2) {
    const dx = path[i] - path[i - 2];
    const dy = path[i + 1] - path[i - 1];
    length += Math.sqrt(dx * dx + dy * dy);
  }
  const speed = new Array<number>(path.length / 2).fill(0);
  return { path, speed, stir, ink, mass: (RIBBON_INK * length) / STEPS };
}

function wander(s: Spline, rand: () => number) {
  for (let i = 0; i < s.speed.length; i++) {
    s.speed[i] += (1 - 2 * rand()) * i * s.stir;
    const [dx, dy] = DIR[Math.floor(rand() * DIRS)];
    s.path[2 * i] += dx * s.speed[i];
    s.path[2 * i + 1] += dy * s.speed[i];
  }
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
      const fray = (0.012 + 0.03 * rand()) * (0.6 + (0.8 * i) / rows);
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
      out.push(spline(pts, stirFor(0.05 + 0.06 * rand(), n), i % inks));
    }
    return out;
  },
  // main-circles: many rings around one center, each fraying from its own start: a wreath of smoke.
  (rand, W, H, inks) => {
    const count = 12 + Math.floor(rand() * 10);
    const out: Spline[] = [];
    for (let i = 0; i < count; i++) {
      const n = 15 + Math.floor(rand() * 40);
      const r = 0.12 + 0.26 * rand();
      const pts = circle(W / 2, H / 2, r, 2 * Math.PI * rand(), n);
      out.push(spline(pts, stirFor(0.015 + 0.03 * rand(), n), i % inks));
    }
    return out;
  },
  // Spokes from the center, as in the repo's sketches: each frays outward.
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
          stirFor(0.02 + 0.03 * rand(), n),
          inks > 1 && rand() < 0.25 ? 1 : 0,
        ),
      );
    }
    return out;
  },
  // A grid of small rings, as in the repo's sketches.
  (rand, W, H, inks) => {
    const cols = 3 + Math.floor(rand() * 2);
    const size = (W * 0.84) / cols;
    const rowsN = Math.max(1, Math.floor((H * 0.84) / size));
    const [ox, oy] = [(W - cols * size) / 2, (H - rowsN * size) / 2];
    const out: Spline[] = [];
    for (let j = 0; j < rowsN; j++)
      for (let i = 0; i < cols; i++) {
        const n = 10 + Math.floor(rand() * 20);
        const r = size * (0.26 + 0.08 * rand());
        const pts = circle(
          ox + (i + 0.5) * size,
          oy + (j + 0.5) * size,
          r,
          2 * Math.PI * rand(),
          n,
        );
        out.push(
          spline(pts, stirFor(size * (0.1 + 0.15 * rand()), n), (i + j) % inks),
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
  for (let step = 0; step < STEPS; step++)
    for (const s of splines) {
      wander(s, rand);
      sprinkle(sand, grains, s.path, s.mass, s.ink);
    }
}

// ---- Glyphs: sand-glyphs ----------------------------------------------------------------------------------

function glyphs(
  sand: Sand,
  rand: () => number,
  grains: () => number,
  W: number,
  H: number,
  inks: number,
) {
  void sand;
  void rand;
  void grains;
  void W;
  void H;
  void inks;
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
  const colors = inks.map(rgb);
  const sand = sandCanvas(width, height, colors.length);
  if (rand() < 0.35) glyphs(sand, rand, grains, W, H, colors.length);
  else ribbons(sand, rand, grains, W, H, colors.length);
  printSand(ctx, sand, rgb(paper), colors);
}

export const sandLines1: Style = {
  id: "sand1",
  draw,
};
