import { cos, log, perlin2, sin } from "../exact";
import type { Palette } from "../palettes";
import { stream, subSeed } from "../random";
import type { Style } from "../sources";

// Flow lines: evenly spaced streamlines through a seeded vector field, the Tyler Hobbs flow-field look without
// the tangle. Lines never cross: each grows until it would come within dTest of another, and new lines start
// dSep to the side of finished ones (Jobard and Lefer's method). Where the field converges the lines crowd
// into bright ridges, as in anvaka's demo. The field is Perlin noise, a few seeded vortices, or one of a few
// formulas in the demo's spirit, and some stamps change ink by region.
//
// The streamline placement is a synchronous port of anvaka/streamlines (https://github.com/anvaka/streamlines):
//
//   MIT License
//
//   Copyright (c) 2018-2026 Andrei Kashcha
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
// Lines are placed in art units (the art's short side is 1), so the same seed gives the same lines at any
// size, and drawn by computing each pixel's coverage, so its pixels match in every browser and in Node
// (ADR 0001). Only IEEE-exact arithmetic here: trig, log and noise come from exact.ts.

type Rgb = [number, number, number];
export type Pt = [number, number];
// A vector field: the flow's direction at a point, any length, or null where it's undefined.
export type Field = (x: number, y: number) => Pt | null;

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

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

export type StreamlineOptions = {
  // The box the lines fill, from (0, 0).
  width: number;
  height: number;
  // The distance between neighboring lines' seeds.
  dSep: number;
  // How close a growing line may come to another before it stops.
  dTest: number;
  // The length of one integration step.
  timeStep: number;
  // Where lines start. The first seeds the whole flow; each later one starts a fresh flow where the earlier
  // ones left room, such as a region a singular line walls off.
  seeds: readonly Pt[];
  // Stops starting lines once this many points are placed, to bound the work.
  maxPoints?: number;
};

// Points closer than a limit by under this share of it count as at the limit. The original's 1e-4, scaled to
// its demo's spacing.
const SAME = 1e-3;

// Evenly spaced streamlines of `field` across the box, each a list of points along the flow.
export function streamlines(
  field: Field,
  {
    width,
    height,
    dSep,
    dTest,
    timeStep,
    seeds,
    maxPoints = Infinity,
  }: StreamlineOptions,
): Pt[][] {
  // The lookup grid: square cells about dSep across over the box's longer side, each holding the points of
  // finished lines in it as flat x, y pairs.
  const size = Math.max(width, height);
  const count = Math.ceil(size / dSep);
  const cells: number[][] = Array.from({ length: count * count }, () => []);
  // A point on the box's far edge belongs to the last cell.
  const cellOf = (v: number) =>
    Math.min(count - 1, Math.floor((count * v) / size));
  const outside = (x: number, y: number) =>
    x < 0 || x > width || y < 0 || y > height;
  // Whether a finished line has a point within `limit` of (x, y).
  const taken = (x: number, y: number, limit: number) => {
    const reach = limit - limit * SAME;
    const reach2 = reach * reach;
    const cx = cellOf(x);
    const cy = cellOf(y);
    for (let i = cx - 1; i <= cx + 1; i++) {
      if (i < 0 || i >= count) continue;
      for (let j = cy - 1; j <= cy + 1; j++) {
        if (j < 0 || j >= count) continue;
        const cell = cells[i * count + j];
        for (let k = 0; k < cell.length; k += 2) {
          const dx = cell[k] - x;
          const dy = cell[k + 1] - y;
          if (dx * dx + dy * dy < reach2) return true;
        }
      }
    }
    return false;
  };

  // The unit field at (x, y) goes to (ux, uy), and the step from rk4 to (vx, vy). Both return false at a
  // singularity. Plain numbers rather than tuples, since these run a few times per point.
  let ux = 0;
  let uy = 0;
  const unit = (x: number, y: number) => {
    const v = field(x, y);
    if (!v) return false;
    const l = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
    if (!(l > 0 && l < Infinity)) return false;
    ux = v[0] / l;
    uy = v[1] / l;
    return true;
  };
  let vx = 0;
  let vy = 0;
  // One Runge-Kutta 4 step along the unit field.
  const rk4 = (x: number, y: number) => {
    const h = timeStep;
    if (!unit(x, y)) return false;
    const [k1x, k1y] = [ux, uy];
    if (!unit(x + k1x * h * 0.5, y + k1y * h * 0.5)) return false;
    const [k2x, k2y] = [ux, uy];
    if (!unit(x + k2x * h * 0.5, y + k2y * h * 0.5)) return false;
    const [k3x, k3y] = [ux, uy];
    if (!unit(x + k3x * h, y + k3y * h)) return false;
    vx = k1x * (h / 6) + k2x * (h / 3) + k3x * (h / 3) + ux * (h / 6);
    vy = k1y * (h / 6) + k2y * (h / 3) + k3y * (h / 3) + uy * (h / 6);
    return true;
  };

  // Grows one line both ways from `start`, then adds its points to the grid.
  const trace = (start: Pt): Pt[] => {
    // The line's own points, in a sparse grid of cells 0.9 steps across, so it stops before looping back
    // onto itself. Like the original it leaves out `start`.
    const near = timeStep * 0.9;
    const own = new Map<number, number[]>();
    const hitsOwn = (x: number, y: number) => {
      const cx = Math.floor(x / near);
      const cy = Math.floor(y / near);
      for (let i = cx - 1; i <= cx + 1; i++)
        for (let j = cy - 1; j <= cy + 1; j++) {
          const cell = own.get(i * 65536 + j);
          if (!cell) continue;
          for (let k = 0; k < cell.length; k += 2) {
            const dx = cell[k] - x;
            const dy = cell[k + 1] - y;
            if (dx * dx + dy * dy < near * near) return true;
          }
        }
      return false;
    };
    const grow = (sign: number): Pt[] => {
      const out: Pt[] = [];
      let [x, y] = start;
      while (rk4(x, y)) {
        const nx = x + sign * vx;
        const ny = y + sign * vy;
        if (outside(nx, ny) || taken(nx, ny, dTest) || hitsOwn(nx, ny)) break;
        out.push([nx, ny]);
        const key = Math.floor(nx / near) * 65536 + Math.floor(ny / near);
        const cell = own.get(key);
        if (cell) cell.push(nx, ny);
        else own.set(key, [nx, ny]);
        [x, y] = [nx, ny];
      }
      return out;
    };
    const forward = grow(1);
    const backward = grow(-1);
    const line = [...backward.reverse(), start, ...forward];
    for (const [x, y] of line) cells[cellOf(x) * count + cellOf(y)].push(x, y);
    return line;
  };

  const lines: Pt[][] = [];
  let points = 0;
  for (const seed of seeds) {
    if (points >= maxPoints) break;
    if (outside(seed[0], seed[1]) || taken(seed[0], seed[1], dSep)) continue;
    // Finished lines wait in a queue, and each offers new seeds dSep to either side of its points.
    const queue: Pt[][] = [];
    const add = (line: Pt[]) => {
      points += line.length;
      if (line.length > 1) {
        lines.push(line);
        queue.push(line);
      }
    };
    add(trace(seed));
    for (const line of queue) {
      for (let i = 0; i < line.length && points < maxPoints; i++) {
        const [x, y] = line[i];
        if (!unit(x, y)) continue;
        const [nx, ny] = [-uy * dSep, ux * dSep];
        // Both sides of the point, along the normal to the flow. Once a line starts on one side, the point
        // is checked again, finding that side taken, so the other side gets its turn.
        for (const side of [1, -1]) {
          const c: Pt = [x + side * nx, y + side * ny];
          if (!outside(c[0], c[1]) && !taken(c[0], c[1], dSep)) {
            add(trace(c));
            i--;
            break;
          }
        }
      }
    }
  }
  return lines;
}

// Formula fields in the spirit of anvaka's demo, which draws (cos |p|, log |x|) by default, at the demo's
// scale: about ten units across.
const FORMULAS: ((x: number, y: number, k: number) => Pt)[] = [
  // The demo's own field: lens shapes strung along the x axis.
  (x, y) => [cos(Math.sqrt(x * x + y * y)), log(Math.abs(x))],
  // A damped pendulum's phase portrait: eyes that wind into spirals.
  (x, y, k) => [y, -sin(x) - 0.25 * k * y],
  // Rolling cells.
  (x, y, k) => [sin(y) + 0.5 * k, sin(x)],
];

// The flow for a stamp, in art units with (0, 0) at the art's center.
function makeField(rand: () => number, seed: number): Field {
  const kind = Math.floor(rand() * 3);
  if (kind === 0) {
    // Perlin noise turns the flow: lines drift one way, bending through the noise's hills.
    const noise = perlin2(subSeed(seed, 0x51a3));
    const f = 0.9 + 1.4 * rand();
    const base = 2 * Math.PI * rand();
    const spread = Math.PI * (0.6 + 0.8 * rand());
    const [ox, oy] = [64 * rand(), 64 * rand()];
    return (x, y) => {
      const a = base + spread * noise(x * f + ox, y * f + oy);
      return [cos(a), sin(a)];
    };
  }
  if (kind === 1) {
    // A drift with a few vortices in it.
    const a = 2 * Math.PI * rand();
    const d = 0.4 + 0.8 * rand();
    const drift: Pt = [d * cos(a), d * sin(a)];
    const vortices = Array.from({ length: 2 + Math.floor(rand() * 4) }, () => ({
      x: 1.2 * rand() - 0.6,
      y: 1.4 * rand() - 0.7,
      s: (rand() < 0.5 ? -1 : 1) * (0.06 + 0.12 * rand()),
      core: 0.04 + 0.1 * rand(),
    }));
    return (x, y) => {
      let [vx, vy] = drift;
      for (const { x: cx, y: cy, s, core } of vortices) {
        const [dx, dy] = [x - cx, y - cy];
        const k = s / (dx * dx + dy * dy + core * core);
        vx -= k * dy;
        vy += k * dx;
      }
      return [vx, vy];
    };
  }
  // A window onto a formula: scaled, turned and shifted.
  const formula = FORMULAS[Math.floor(rand() * FORMULAS.length)];
  const zoom = 4 + 5 * rand();
  const turn = 2 * Math.PI * rand();
  const [c, s] = [cos(turn), sin(turn)];
  const [ox, oy] = [4 * rand() - 2, 4 * rand() - 2];
  const k = rand();
  return (x, y) => {
    const [u, v] = [zoom * (c * x - s * y) + ox, zoom * (s * x + c * y) + oy];
    const [fu, fv] = formula(u, v, k);
    // Turned back, so the picture turns rather than shears.
    return [c * fu + s * fv, -s * fu + c * fv];
  };
}

// How far apart two colors' lightness is, out of 255.
const contrast = (a: Rgb, b: Rgb) =>
  Math.abs(
    0.299 * (a[0] - b[0]) + 0.587 * (a[1] - b[1]) + 0.114 * (a[2] - b[2]),
  );
// Region lines in an ink closer than this to the ground would fade out at desk size.
const MIN_CONTRAST = 70;

// Caps the points placed, so a field that packs lines unusually tight stays within the draw budget.
const MAX_POINTS = 20000;

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

  // Like the demo, some stamps print pale lines out of a dark ground. Others print ink lines on paper.
  const dark = rand() < 0.4;
  const ground = rgb(dark ? inks[0] : paper);
  const main = rgb(dark ? paper : inks[0]);
  // The second ink, for regions: whichever other ink stands out most from the ground.
  const accent = inks
    .slice(1)
    .map(rgb)
    .reduce((a, b) => (contrast(b, ground) > contrast(a, ground) ? b : a));
  // Each line lays down this much of its ink, so lines crowding together build up a ridge.
  const strength = dark ? 0.62 : 0.72;

  const field = makeField(rand, seed);
  const dSep = 0.017 + 0.011 * rand();
  // Small, the lines crowd together where the field converges. Larger, they stop short and keep apart.
  const dTest = dSep * (0.12 + 0.38 * rand());
  // Line radius in art units: 1 to 1.4 pixels wide at desk size.
  const radius = 0.0027 + 0.0009 * rand();
  // On some stamps lines change to the second ink across a few regions, unless it would barely show on the
  // ground. The regions are two octaves of noise: one alone is zero along some lattice lines, which would cut
  // regions with ruler-straight edges.
  const twoInks = rand() < 0.5 && contrast(accent, ground) > MIN_CONTRAST;
  const regions = perlin2(subSeed(seed, 0x7e61));
  const regionScale = 1 + 1.2 * rand();
  const regionCut = 0.3 * rand() - 0.15;
  const inkAt = (x: number, y: number) => {
    if (!twoInks) return 0;
    const [u, v] = [(x - W / 2) * regionScale, (y - H / 2) * regionScale];
    const r =
      regions(u + 9.5, v + 3.5) +
      0.5 * regions(2.13 * u + 31.7, 2.13 * v + 17.3);
    return r > regionCut ? 1 : 0;
  };

  // One seed for the whole flow, then a jittered grid of extra seeds to reach any region it walls off.
  const seeds: Pt[] = [[W * (0.3 + 0.4 * rand()), H * (0.3 + 0.4 * rand())]];
  const step = dSep * 4;
  for (let y = step / 2; y < H; y += step)
    for (let x = step / 2; x < W; x += step)
      seeds.push([x + step * (rand() - 0.5), y + step * (rand() - 0.5)]);
  const lines = streamlines((x, y) => field(x - W / 2, y - H / 2), {
    width: W,
    height: H,
    dSep,
    dTest,
    timeStep: dSep * 0.5,
    seeds,
    maxPoints: MAX_POINTS,
  });

  // How much ink each pixel gets from each ink: the sum over lines of each line's coverage. A line's
  // segments overlap at its joints, so within a line a pixel keeps its largest coverage: `cover` holds it
  // for the line in `owner`, and adds it to the sums when another line reaches the pixel.
  const n = width * height;
  const sums = [new Float32Array(n), new Float32Array(n)];
  const cover = new Float32Array(n);
  const coverInk = new Uint8Array(n);
  const owner = new Int32Array(n).fill(-1);
  const settle = (i: number) => {
    if (cover[i] > 0) sums[coverInk[i]][i] += cover[i];
  };
  const r = radius * unit;
  // A line thinner than a pixel draws a pixel wide at matching strength, so it keeps its weight when small.
  const reach = Math.max(r, 0.5);
  const weight = Math.min(1, 2 * r);
  // Paints the segment from a to b, in pixels, for line `l`. Plain numbers, no tuples: this is the hot loop.
  const segment = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    l: number,
    ink: number,
  ) => {
    // The pixels whose centers lie within reach + 0.5 of the segment's box: the only ones it can cover.
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach));
    const x1 = Math.min(width, Math.ceil(Math.max(ax, bx) + reach));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - reach));
    const y1 = Math.min(height, Math.ceil(Math.max(ay, by) + reach));
    const ex = bx - ax;
    const ey = by - ay;
    const length2 = ex * ex + ey * ey;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const px = x + 0.5 - ax;
        const py = y + 0.5 - ay;
        let t = length2 > 0 ? (px * ex + py * ey) / length2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = px - t * ex;
        const dy = py - t * ey;
        const c = clamp01(reach - Math.sqrt(dx * dx + dy * dy) + 0.5) * weight;
        if (c <= 0) continue;
        const i = y * width + x;
        if (owner[i] !== l) {
          settle(i);
          owner[i] = l;
          cover[i] = 0;
        }
        if (c > cover[i]) {
          cover[i] = c;
          coverInk[i] = ink;
        }
      }
  };
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l];
    for (let p = 0; p + 1 < line.length; p++) {
      const a = line[p];
      const b = line[p + 1];
      const ink = inkAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      // Drawn large, a step spans many pixels, so it follows a Catmull-Rom curve through the points on
      // either side instead of a straight chord, which would show as facets in tight spirals.
      const before = line[p > 0 ? p - 1 : p];
      const after = line[p + 2 < line.length ? p + 2 : p + 1];
      const dx = (b[0] - a[0]) * unit;
      const dy = (b[1] - a[1]) * unit;
      const pieces = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / 4));
      let [x, y] = [a[0] * unit, a[1] * unit];
      for (let k = 1; k <= pieces; k++) {
        const t = k / pieces;
        const nx = catmullRom(before[0], a[0], b[0], after[0], t) * unit;
        const ny = catmullRom(before[1], a[1], b[1], after[1], t) * unit;
        segment(x, y, nx, ny, l, ink);
        [x, y] = [nx, ny];
      }
    }
  }

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let i = 0; i < n; i++) {
    settle(i);
    const [a, b] = [sums[0][i], sums[1][i]];
    const total = a + b;
    const alpha = Math.min(1, strength * total);
    for (let k = 0; k < 3; k++) {
      const ink = total > 0 ? (a * main[k] + b * accent[k]) / total : 0;
      data[i * 4 + k] = Math.round(ground[k] + (ink - ground[k]) * alpha);
    }
    data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

export const flowLines1: Style = {
  id: "flow1",
  draw,
};
