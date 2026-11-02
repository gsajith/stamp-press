// Fair Isle knit: an all-over sweater swatch of horizontal bands, knitted in two colors per row. A large
// band of stars, crosses or OXO diamonds sits in the middle, small "peerie" borders separate it from the
// bands above and below, and the sequence repeats to the edges, mirrored about the middle. Inside a band the
// colors shade from row to row toward its center, as Shetland knitters work them. Each cell is one stitch,
// drawn as the V of stockinette: two twisted legs meeting at the bottom, with the point of the stitch above
// tucked into the notch between their tops.
//
// The motifs come from the wave function collapse overlapping model. Each band runs it on one of our own
// 8x8 two-color motifs, with all eight rotations and reflections, into a quarter of the band. The quarter is
// mirrored across and down, so every motif is symmetric like a hand-charted one. The model is a port of
// kchapelier's JavaScript port of Maxim Gumin's WaveFunctionCollapse. Its randomness comes from our seeded
// stream and its logarithms from exact.ts. Its output mapping is fixed for quarters under 2N - 2 cells.
//
// Like crossStitch, a pixel takes the exact average of a stitch tile over the stitches it covers, through
// summed-area tables, so the yarn's twist shows at 2048 px, averages out at desk size, and the same seed
// draws the same picture at any size. Only IEEE-exact arithmetic, so pixels match in every browser and in
// Node (ADR 0001).
//
// Ported from https://github.com/kchapelier/wavefunctioncollapse (model.js, overlapping-model.js,
// random-indice.js) under the MIT License:
//
//   Copyright (c) 2014 Kevin Chapelier
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

import { log } from "../exact";
import type { Palette } from "../palettes";
import { pick, stream } from "../random";
import type { Style } from "../sources";

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
const lum = (c: Rgb) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const frac = (x: number) => x - Math.floor(x);

// A float in [0, 1) for each cell, the "lowbias32" hash of its coordinates and a salt.
function hash2(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ salt;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---- Wave function collapse, overlapping model ----

// Our own sample motifs, 8x8 and repeating both ways: `X` is the pattern yarn, `.` the ground.
const SAMPLES: readonly (readonly string[])[] = [
  // Eight-pointed star
  [
    "X..X..X.",
    ".X.X.X..",
    "..XXX...",
    "XXX.XXX.",
    "..XXX...",
    ".X.X.X..",
    "X..X..X.",
    "........",
  ],
  // OXO: a ring around a ring
  [
    "..XXXX..",
    ".X....X.",
    "X..XX..X",
    "X.X..X.X",
    "X.X..X.X",
    "X..XX..X",
    ".X....X.",
    "..XXXX..",
  ],
  // Lattice of single-stitch diagonals
  [
    "X......X",
    ".X....X.",
    "..X..X..",
    "...XX...",
    "...XX...",
    "..X..X..",
    ".X....X.",
    "X......X",
  ],
  // Solid-edged diamond
  [
    "...X....",
    "..XXX...",
    ".XX.XX..",
    "XX...XX.",
    ".XX.XX..",
    "..XXX...",
    "...X....",
    "........",
  ],
  // Tree of life
  [
    "...X....",
    "..XXX...",
    ".X.X.X..",
    "...X....",
    ".XXXXX..",
    "X..X..X.",
    "...X....",
    "..XXX...",
  ],
];

const N = 3; // pattern size
const DX = [-1, 0, 1, 0];
const DY = [0, 1, 0, -1];
const OPPOSITE = [2, 3, 0, 1];

// A sample's patterns: every N by N window, in all eight orientations, counted, and for each direction which
// patterns may sit next to which. Built once per sample, since it depends on nothing else.
type Model = {
  T: number;
  patterns: Uint8Array; // T patterns of N * N cells
  weights: Float64Array;
  weightLogWeights: Float64Array;
  sumOfWeights: number;
  sumOfWeightLogWeights: number;
  startingEntropy: number;
  // propagator[d][t]: the patterns that agree with t when placed one step in direction d.
  propagator: Int32Array[][];
};

const models: Model[] = [];

function model(index: number): Model {
  if (models[index]) return models[index];
  const sample = SAMPLES[index];
  const [sw, sh] = [sample[0].length, sample.length];
  const pattern = (f: (x: number, y: number) => number) => {
    const p: number[] = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) p.push(f(x, y));
    return p;
  };
  const rotate = (p: number[]) => pattern((x, y) => p[N - 1 - y + x * N]);
  const reflect = (p: number[]) => pattern((x, y) => p[N - 1 - x + y * N]);
  const keys: number[] = [];
  const found: number[][] = [];
  const counts: number[] = [];
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      const ps = [
        pattern((dx, dy) =>
          sample[(y + dy) % sh][(x + dx) % sw] === "X" ? 1 : 0,
        ),
      ];
      ps[1] = reflect(ps[0]);
      ps[2] = rotate(ps[0]);
      ps[3] = reflect(ps[2]);
      ps[4] = rotate(ps[2]);
      ps[5] = reflect(ps[4]);
      ps[6] = rotate(ps[4]);
      ps[7] = reflect(ps[6]);
      for (const p of ps) {
        const key = p.reduce((s, v) => s * 2 + v, 0);
        const i = keys.indexOf(key);
        if (i >= 0) counts[i]++;
        else {
          keys.push(key);
          found.push(p);
          counts.push(1);
        }
      }
    }
  const T = keys.length;
  const agrees = (p1: number[], p2: number[], dx: number, dy: number) => {
    for (let y = Math.max(0, dy); y < Math.min(N, dy + N); y++)
      for (let x = Math.max(0, dx); x < Math.min(N, dx + N); x++)
        if (p1[x + N * y] !== p2[x - dx + N * (y - dy)]) return false;
    return true;
  };
  const weights = Float64Array.from(counts);
  const weightLogWeights = weights.map((w) => w * log(w));
  let [sumOfWeights, sumOfWeightLogWeights] = [0, 0];
  for (let t = 0; t < T; t++) {
    sumOfWeights += weights[t];
    sumOfWeightLogWeights += weightLogWeights[t];
  }
  models[index] = {
    T,
    patterns: Uint8Array.from(found.flat()),
    weights,
    weightLogWeights,
    sumOfWeights,
    sumOfWeightLogWeights,
    startingEntropy: log(sumOfWeights) - sumOfWeightLogWeights / sumOfWeights,
    propagator: DX.map((dx, d) =>
      found.map((p) =>
        Int32Array.from(
          found.flatMap((p2, t2) => (agrees(p, p2, dx, DY[d]) ? [t2] : [])),
        ),
      ),
    ),
  };
  return models[index];
}

// One generation of fmx by fmy cells, not wrapping at its edges, or null on a contradiction. Both sides must
// be at least N.
function generate(
  m: Model,
  fmx: number,
  fmy: number,
  rand: () => number,
): Uint8Array | null {
  const { T, weights, weightLogWeights, propagator } = m;
  const F = fmx * fmy;
  const wave = new Uint8Array(F * T).fill(1);
  const compatible = new Int32Array(F * T * 4);
  for (let i = 0; i < F; i++)
    for (let t = 0; t < T; t++)
      for (let d = 0; d < 4; d++)
        compatible[(i * T + t) * 4 + d] = propagator[OPPOSITE[d]][t].length;
  const sumsOfOnes = new Int32Array(F).fill(T);
  const sumsOfWeights = new Float64Array(F).fill(m.sumOfWeights);
  const sumsOfWeightLogWeights = new Float64Array(F).fill(
    m.sumOfWeightLogWeights,
  );
  const entropies = new Float64Array(F).fill(m.startingEntropy);
  const stack = new Int32Array(F * T * 2);
  let stackSize = 0;

  const onBoundary = (x: number, y: number) =>
    x + N > fmx || y + N > fmy || x < 0 || y < 0;
  const ban = (i: number, t: number) => {
    const k = (i * T + t) * 4;
    for (let d = 0; d < 4; d++) compatible[k + d] = 0;
    wave[i * T + t] = 0;
    stack[stackSize++] = i;
    stack[stackSize++] = t;
    sumsOfOnes[i] -= 1;
    sumsOfWeights[i] -= weights[t];
    sumsOfWeightLogWeights[i] -= weightLogWeights[t];
    const sum = sumsOfWeights[i];
    entropies[i] = log(sum) - sumsOfWeightLogWeights[i] / sum;
  };

  for (;;) {
    // Observe: collapse the cell of least entropy, with a little noise to break ties.
    let min = 1000;
    let argmin = -1;
    for (let i = 0; i < F; i++) {
      if (onBoundary(i % fmx, Math.floor(i / fmx))) continue;
      const amount = sumsOfOnes[i];
      if (amount === 0) return null;
      const entropy = entropies[i];
      if (amount > 1 && entropy <= min) {
        const noise = 0.000001 * rand();
        if (entropy + noise < min) {
          min = entropy + noise;
          argmin = i;
        }
      }
    }
    if (argmin === -1) break;

    // Pick a pattern for it, weighted by how often it appears in the sample (random-indice.js).
    let sum = 0;
    for (let t = 0; t < T; t++) if (wave[argmin * T + t]) sum += weights[t];
    const r = rand() * sum;
    let chosen = 0;
    for (let t = 0, x = 0; r && t < T; t++) {
      if (!wave[argmin * T + t]) continue;
      x += weights[t];
      if (r <= x) {
        chosen = t;
        break;
      }
    }
    for (let t = 0; t < T; t++)
      if (wave[argmin * T + t] && t !== chosen) ban(argmin, t);

    // Propagate: a neighbor's pattern goes once nothing on one side supports it.
    while (stackSize > 0) {
      const t1 = stack[--stackSize];
      const i1 = stack[--stackSize];
      const [x1, y1] = [i1 % fmx, Math.floor(i1 / fmx)];
      for (let d = 0; d < 4; d++) {
        const [x2, y2] = [x1 + DX[d], y1 + DY[d]];
        if (onBoundary(x2, y2)) continue;
        const i2 = x2 + y2 * fmx;
        const p = propagator[d][t1];
        for (let l = 0; l < p.length; l++) {
          const k = (i2 * T + p[l]) * 4 + d;
          compatible[k]--;
          if (compatible[k] === 0) ban(i2, p[l]);
        }
      }
    }
  }

  // Each cell's color, from the pattern placed at or before it. The original offsets cells in the last N - 1
  // rows and columns by N - 1, which reaches past the grid when a side is under 2N - 2.
  const out = new Uint8Array(F);
  for (let y = 0; y < fmy; y++)
    for (let x = 0; x < fmx; x++) {
      const [ox, oy] = [Math.min(x, fmx - N), Math.min(y, fmy - N)];
      const i = ox + oy * fmx;
      let t = 0;
      while (!wave[i * T + t]) t++;
      out[y * fmx + x] = m.patterns[t * N * N + (x - ox) + (y - oy) * N];
    }
  return out;
}

// ---- Bands ----

// A band: a chart of 0 (ground) and 1 (pattern) given as its top-left quarter, mirrored across its left edge
// and every 2(w - 1) columns after, and down across its bottom row. Each row's two yarns.
type Band = {
  quarter: Uint8Array;
  w: number;
  h: number; // rows in the quarter: the band has 2h - 1
  ground: Rgb[];
  pattern: Rgb[];
};

// Peeries, the small borders between bands, as quarters like a band's.
const PEERIES: readonly (readonly string[])[] = [
  ["X.."], // lice
  ["X.", ".X"], // checks
  ["X...", ".X.X", "..X."], // diamonds
  ["X..", "XX.", "X.."], // teeth
  ["XX..", "..X."], // crosses
  ["X"], // a stripe
];

const chartQuarter = (rows: readonly string[]) =>
  Uint8Array.from(rows.flatMap((r) => [...r].map((c) => (c === "X" ? 1 : 0))));

// A WFC quarter of w by h with a reasonable amount of pattern, or the sample itself after a few
// contradictions. Its outer row is left as ground, so the band has a row of ground above and below.
function motif(
  sample: number,
  w: number,
  h: number,
  rand: () => number,
): Uint8Array {
  const m = model(sample);
  for (let attempt = 0; attempt < 8; attempt++) {
    const q = generate(m, w, h - 1, rand);
    if (!q) continue;
    let on = 0;
    for (let i = 0; i < q.length; i++) on += q[i];
    if (on < 0.2 * q.length || on > 0.6 * q.length) continue;
    const quarter = new Uint8Array(w * h);
    quarter.set(q, w);
    return quarter;
  }
  const rows = SAMPLES[sample];
  return Uint8Array.from({ length: w * h }, (_, k) => {
    const [x, y] = [k % w, Math.floor(k / w)];
    return y === 0 ? 0 : rows[(y - 1) % 8][x % 8] === "X" ? 1 : 0;
  });
}

// A band's cell at column c (0 on the art's middle) and row y of its 2h - 1.
function cell(band: Band, c: number, y: number): number {
  const { w, h, quarter } = band;
  const qy = y < h ? y : 2 * h - 2 - y;
  if (w === 1) return quarter[qy];
  const p = 2 * (w - 1);
  const m = ((c % p) + p) % p;
  return quarter[qy * w + (m < w ? m : p - m)];
}

// ---- The stitch ----

const ROW = 0.8; // a row's height, in stitch widths: stockinette stitches are wider than tall
const HALF = 0.215; // half a leg's width at its middle, in stitch widths
const SINK = 0.35; // how far a leg's point runs into the stitch below, in rows
const PLY = 0.11; // how far along a leg one ply's twist repeats
const C = 4; // the tile's channels

// The left leg runs from the stitch's top left down to its bottom middle, then on into the notch of the
// stitch below. Writes [shade, sheen] at (x, y) to `out`, in stitch widths with y down from the top of the
// leg's own row, and returns false off the leg. The right leg is its mirror.
function leg(x: number, y: number, out: Float64Array): boolean {
  const [x0, y0, x1, y1] = [0.08, 0, 0.5, ROW * (1 + SINK)];
  const [dx, dy] = [x1 - x0, y1 - y0];
  const len = Math.sqrt(dx * dx + dy * dy);
  const a = ((x - x0) * dx + (y - y0) * dy) / (len * len);
  if (a <= 0 || a >= 1) return false;
  const d = ((x - x0) * dy - (y - y0) * dx) / len;
  // A grain of rice: widest at its middle, round at both ends.
  const half = HALF * Math.sqrt(1 - (2 * a - 1) * (2 * a - 1));
  if (d <= -half || d >= half) return false;
  const n = d / half;
  const round = Math.sqrt(1 - n * n);
  const g = 2 * Math.abs(frac((a * len) / PLY + 0.45 * n) - 0.5);
  const groove = g * g * g * g;
  // The top tucks under the stitch above, so it falls into shadow.
  const tuck = 0.55 + 0.45 * clamp01(a / 0.22);
  out[0] = (0.5 + 0.5 * round) * (1 - 0.3 * groove) * tuck;
  const s = (n + 0.3) / 0.35;
  out[1] = 0.16 * clamp01(1 - s * s) * (1 - groove) * tuck;
  return true;
}

// A stitch's tile, as [own yarn, the yarn of the stitch above, sheen, shadow] weights at (u, v) in the cell, both 0
// to 1: its own two legs, the point of the stitch above in the notch between their tops, and shadow between.
const part = new Float64Array(2);
function stitch(u: number, v: number, out: Float64Array) {
  const [x, y] = [u < 0.5 ? u : 1 - u, v * ROW];
  if (leg(x, y, part)) {
    out[0] = part[0];
    out[1] = 0;
    out[2] = part[1];
    out[3] = 0;
    return;
  }
  if (leg(x, y + ROW, part)) {
    out[0] = 0;
    out[1] = part[0];
    out[2] = part[1];
    out[3] = 0;
    return;
  }
  // The gaps between legs fall into one deep shadow, whatever the yarn, as the fabric's depths do.
  out[0] = 0.1;
  out[1] = 0;
  out[2] = 0;
  out[3] = 1;
}

// A summed-area table of a tile drawn at `res` texels per cell, each the mean of 3 by 3 samples, with
// `channels` values per texel. Entry (x, y) holds the sum over texels left of x and above y.
function table(
  res: number,
  channels: number,
  tile: (u: number, v: number, out: Float64Array) => void,
): Float64Array {
  const sat = new Float64Array((res + 1) * (res + 1) * channels);
  const out = new Float64Array(channels);
  const texel = new Float64Array(channels);
  const row = (res + 1) * channels;
  for (let y = 0; y < res; y++)
    for (let x = 0; x < res; x++) {
      texel.fill(0);
      for (let j = 0; j < 3; j++)
        for (let i = 0; i < 3; i++) {
          tile((x + (i + 0.5) / 3) / res, (y + (j + 0.5) / 3) / res, out);
          for (let c = 0; c < channels; c++) texel[c] += out[c] / 9;
        }
      const k = ((y + 1) * (res + 1) + x + 1) * channels;
      for (let c = 0; c < channels; c++)
        sat[k + c] =
          texel[c] +
          sat[k + c - row] +
          sat[k + c - channels] -
          sat[k + c - row - channels];
    }
  return sat;
}

// The difference between a running sum at fraction f1 past entry o1 and at f0 past o0, with `step` between
// entries: the integral between those two points.
const between = (
  sums: Float64Array,
  o0: number,
  o1: number,
  f0: number,
  f1: number,
  step: number,
) =>
  sums[o1] +
  (sums[o1 + step] - sums[o1]) * f1 -
  sums[o0] -
  (sums[o0 + step] - sums[o0]) * f0;

// For each pixel along one axis, the cells it overlaps and the span of each it covers, in texels. A pixel is
// `per` cells wide, and the first pixel starts `off` cells into a grid of `cells` cells, as far from its end as
// the last pixel ends.
function spans(
  pixels: number,
  per: number,
  off: number,
  cells: number,
  res: number,
): number[][] {
  return Array.from({ length: pixels }, (_, p) => {
    const parts: number[] = [];
    // The last pixel's end is pinned, so rounding can't reach a cell past the grid.
    const [start, end] = [
      p * per + off,
      p + 1 === pixels ? cells - off : (p + 1) * per + off,
    ];
    for (let i = Math.floor(start); i < end; i++) {
      const [a, b] = [Math.max(start, i) - i, Math.min(end, i + 1) - i];
      if (b > a) parts.push(i, a * res, b * res);
    }
    return parts;
  });
}

// ---- Colors ----

// Two yarns for each of a band's rows, ground and pattern, shading toward its middle row: the ground in up
// to two steps, the pattern in up to three. Every row's pair differs enough in lightness to read.
function shade(
  rows: number,
  dark: boolean,
  yarns: readonly Rgb[],
  rand: () => number,
): { ground: Rgb[]; pattern: Rgb[] } {
  const middle = (rows - 1) / 2;
  const lights = yarns.filter((c) => lum(c) >= 0.6);
  const darks = yarns.filter((c) => lum(c) < 0.6);
  const [grounds, patterns] = dark ? [darks, lights] : [lights, darks];
  for (let attempt = 0; attempt < 12; attempt++) {
    const outer = pick(grounds, rand);
    const inner = rand() < 0.5 ? pick(grounds, rand) : outer;
    const innerRows = Math.floor(middle * (0.3 + 0.4 * rand()));
    const steps = middle < 2 ? 1 : 1 + Math.floor(rand() * 3);
    const tones = Array.from({ length: steps }, () => pick(patterns, rand));
    const ground: Rgb[] = [];
    const pattern: Rgb[] = [];
    let ok = true;
    for (let y = 0; y < rows; y++) {
      const d = Math.abs(y - middle);
      ground.push(d <= innerRows ? inner : outer);
      pattern.push(
        tones[Math.min(steps - 1, Math.floor((1 - d / (middle + 1)) * steps))],
      );
      if (Math.abs(lum(ground[y]) - lum(pattern[y])) < 0.28) ok = false;
    }
    if (ok) return { ground, pattern };
  }
  // The paper and the darkest ink always read against each other.
  const [g, p] = dark ? [yarns[1], yarns[0]] : [yarns[0], yarns[1]];
  return {
    ground: Array.from({ length: rows }, () => g),
    pattern: Array.from({ length: rows }, () => p),
  };
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const salt = Math.floor(rand() * 2 ** 32);

  // Yarns: the paper's tone, every ink, and a pale and a deep heather of each lighter ink. The paper and
  // the darkest ink always come first, for the fallback colors.
  const paperRgb = rgb(paper);
  const inkRgb = inks.map(rgb);
  const yarns: Rgb[] = [paperRgb, inkRgb[0], ...inkRgb.slice(1)];
  for (const ink of inkRgb.slice(1)) {
    yarns.push(mix(ink, paperRgb, 0.5));
    yarns.push(mix(ink, inkRgb[0], 0.4));
  }

  // The bands: a large one in the middle, and either one more large band and two peeries repeating outward
  // from it, or the middle band and one peerie.
  const order = [0, 1, 2, 3, 4];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const darkMiddle = rand() < 0.5;
  const large = (sample: number, dark: boolean, tall: number): Band => {
    const w = 5 + Math.floor(rand() * 4);
    const h = tall + Math.floor(rand() * 3);
    const quarter = motif(sample, w, h, rand);
    return { quarter, w, h, ...shade(2 * h - 1, dark, yarns, rand) };
  };
  const peerie = (dark: boolean): Band => {
    const rows = pick(PEERIES, rand);
    const [w, h] = [rows[0].length, rows.length];
    return {
      quarter: chartQuarter(rows),
      w,
      h,
      ...shade(2 * h - 1, dark, yarns, rand),
    };
  };
  const middle = large(order[0], darkMiddle, 7);
  const cycle: Band[] =
    rand() < 0.65
      ? [
          peerie(!darkMiddle),
          large(order[1], rand() < 0.7 ? !darkMiddle : darkMiddle, 4),
          peerie(!darkMiddle),
          middle,
        ]
      : [peerie(!darkMiddle), middle];

  // The art in stitch widths: its short side spans 30 to 40 stitches.
  const short = 30 + 2 * Math.floor(rand() * 6);
  const [aw, ah] =
    width <= height
      ? [short, (height * short) / width]
      : [(width * short) / height, short];
  const rowsTall = ah / ROW;

  // The grid: columns and rows centered on the art, column 0 and row 0 in its middle, so the design mirrors
  // about the middle both ways. `ex` and `ey` count the stitches out from the middle on each side, and
  // `offX` and `offY` how much of the outer ones falls outside the art. One more row on top gives the top
  // row's stitches the yarn of the row above them.
  const [ex, ey] = [Math.ceil(aw / 2 - 0.5), Math.ceil(rowsTall / 2 - 0.5)];
  const [offX, offY] = [ex + 0.5 - aw / 2, ey + 0.5 - rowsTall / 2];
  const [cols, rows] = [2 * ex + 1, 2 * ey + 1];

  // Which band and row of it each grid row knits, outward from the middle band's middle row.
  const period = cycle.reduce((s, b) => s + 2 * b.h - 1, 0);
  const bandRows: [Band, number][] = [];
  for (let r = -ey - 1; r <= ey; r++) {
    let t = Math.abs(r);
    const half = middle.h - 1;
    if (t <= half) {
      bandRows.push([middle, half + t]);
      continue;
    }
    t = (t - half - 1) % period;
    let k = 0;
    while (t >= 2 * cycle[k].h - 1) t -= 2 * cycle[k++].h - 1;
    bandRows.push([cycle[k], t]);
  }

  // Each stitch's yarn, a little lighter or darker than its neighbors', as hand-dyed wool is. Row 0 of the
  // table is the extra row on top.
  const colors = new Float64Array(cols * (rows + 1) * 3);
  for (let j = 0; j <= rows; j++) {
    const [band, y] = bandRows[j];
    for (let i = 0; i < cols; i++) {
      const c = i - ex;
      const yarn = cell(band, c, y) ? band.pattern[y] : band.ground[y];
      const tone = 0.95 + 0.1 * hash2(c, j - ey - 1, salt);
      const k = (j * cols + i) * 3;
      for (let ch = 0; ch < 3; ch++) colors[k + ch] = yarn[ch] * tone;
    }
  }

  // The tile, at two texels or more per pixel up to 2048 px.
  const cellPx = width / aw;
  const res = cellPx <= 12 ? 32 : cellPx <= 32 ? 64 : 128;
  const tile = table(res, C, stitch);

  // Each pixel column's parts, one per stitch column it overlaps, and for each part the tile summed across
  // the part's span and down to every texel row. A part's integral over a pixel is then the difference
  // between two of those rows.
  const W = res + 1;
  const [sx, sy] = [aw / width, rowsTall / height];
  const xs = spans(width, sx, offX, cols, res);
  const ys = spans(height, sy, offY, rows, res);
  const first = new Int32Array(width + 1);
  for (let px = 0; px < width; px++)
    first[px + 1] = first[px] + xs[px].length / 3;
  const columns = new Float64Array(first[width] * W * C);
  for (let px = 0; px < width; px++)
    for (let q = 0; q < xs[px].length; q += 3) {
      const g = first[px] + q / 3;
      const [a, b] = [xs[px][q + 1], xs[px][q + 2]];
      const [ia, ib] = [
        Math.min(Math.floor(a), res - 1),
        Math.min(Math.floor(b), res - 1),
      ];
      const [fa, fb] = [a - ia, b - ib];
      for (let y = 0; y < W; y++) {
        const [ka, kb] = [(y * W + ia) * C, (y * W + ib) * C];
        for (let c = 0; c < C; c++)
          columns[(g * W + y) * C + c] =
            tile[kb + c] +
            (tile[kb + C + c] - tile[kb + c]) * fb -
            tile[ka + c] -
            (tile[ka + C + c] - tile[ka + c]) * fa;
      }
    }

  const area = res * res * sx * sy;
  const white = 255 / area;
  const shadow = mix(inkRgb[0], [0, 0, 0], 0.55).map((v) => v / area);
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let py = 0; py < height; py++) {
    const yp = ys[py];
    for (let px = 0; px < width; px++) {
      const xp = xs[px];
      let [red, green, blue] = [0, 0, 0];
      for (let r = 0; r < yp.length; r += 3) {
        const own = (yp[r] + 1) * cols;
        const above = yp[r] * cols;
        const [c0, c1] = [yp[r + 1], yp[r + 2]];
        const [i0, i1] = [
          Math.min(Math.floor(c0), res - 1),
          Math.min(Math.floor(c1), res - 1),
        ];
        const [f0, f1] = [c0 - i0, c1 - i1];
        for (let q = 0, g = first[px]; q < xp.length; q += 3, g++) {
          const [o0, o1] = [(g * W + i0) * C, (g * W + i1) * C];
          const mine = between(columns, o0, o1, f0, f1, C) / area;
          const theirs = between(columns, o0 + 1, o1 + 1, f0, f1, C) / area;
          const sheen = between(columns, o0 + 2, o1 + 2, f0, f1, C) * white;
          const dark = between(columns, o0 + 3, o1 + 3, f0, f1, C);
          const [k, ka] = [(own + xp[q]) * 3, (above + xp[q]) * 3];
          red +=
            mine * colors[k] + theirs * colors[ka] + sheen + dark * shadow[0];
          green +=
            mine * colors[k + 1] +
            theirs * colors[ka + 1] +
            sheen +
            dark * shadow[1];
          blue +=
            mine * colors[k + 2] +
            theirs * colors[ka + 2] +
            sheen +
            dark * shadow[2];
        }
      }
      const p = (py * width + px) * 4;
      data[p] = Math.round(red);
      data[p + 1] = Math.round(green);
      data[p + 2] = Math.round(blue);
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export const fairIsle1: Style = {
  id: "knit1",
  draw,
};
