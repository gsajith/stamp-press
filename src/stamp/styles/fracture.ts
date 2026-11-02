import { cos, perlin2, sin } from "../exact";
import type { Palette } from "../palettes";
import { stream, subSeed } from "../random";
import type { Style } from "../sources";

// Fracture: cracks that spread from a few blows through a field of scattered points, branching sideways and
// stopping where they meet another crack, like crazed glaze. Crisp lines in the darkest ink, as in Hoff's
// plots. Some stamps tint a patch of the cells between the cracks.
//
// The crack growth is a port of inconvergent/fracture (https://github.com/inconvergent/fracture):
//
//   The MIT License (MIT)
//
//   Copyright (c) 2015 Anders Hoff
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
// The original keeps its points in a k-d tree and tests collisions on a Delaunay triangulation. Here one
// spatial grid serves both. Cracks grow in art units (the art's short side is 1), so the same seed gives the
// same cracks at any size, and each pixel's coverage comes from the cracks' exact geometry, so its pixels
// match in every browser and in Node (ADR 0001). Only IEEE-exact arithmetic: trig and noise from exact.ts.

type Rgb = [number, number, number];
export type Pt = [number, number];

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lightness = ([r, g, b]: Rgb) => 0.299 * r + 0.587 * g + 0.114 * b;
// The least lightness, out of 255, between a tint and the line ink.
const MIN_CONTRAST = 60;

// The original's growth constants. A crack turns toward the points ahead of it within a cone whose half angle
// has this cosine (about 32 degrees). Each step it branches with SPAWN_FACTOR times its chance, which starts
// at 1 and shrinks every step. A branch starts with SPAWN_DIMINISH of its parent's chance, at right angles to
// it give or take SPAWN_ANGLE / 2 radians. SPAWN_FACTOR is the original's 0.2 raised to 0.3: with the shorter
// look ahead below, 0.2 left cells about twice as wide, in steps, as the original's sample shows.
const DOT = 0.85;
const DOT2 = DOT * DOT;
const SPAWN_DIMINISH = 0.9;
const SPAWN_ANGLE = 2.0;
const SPAWN_FACTOR = 0.3;
// Salts a branch's random stream, seeded by its parent's.
const BRANCH_SALT = 0x5bd1e995;

export type FractureOptions = {
  // The scattered points cracks travel through. A crack dies where none lie ahead of it.
  sources: readonly Pt[];
  // Where the cracks start: each blow starts `count` cracks in random directions from the source nearest `at`.
  blows: readonly { at: Pt; count: number }[];
  // The length of one step.
  step: number;
  // How far ahead a crack looks for points to turn toward.
  reach: number;
  // The pull straight ahead of the sources beyond `reach`, which this port doesn't visit one by one.
  far?: number;
  // Each step, a crack's chance to branch is multiplied by this.
  diminish: number;
  // Stops growing once this many crack points are placed, to bound the work.
  maxPoints?: number;
  // The box the lookup grid covers, as x0, y0, x1, y1: the sources' box when absent. A fixed box keeps the
  // grid, and with it the order the pulls on a crack add up in, the same however the sources are cropped.
  box?: readonly [number, number, number, number];
};

// The crack paths that grow from the blows, each a list of points. A crack that meets another ends on one of
// the other's points, so cracks never cross. Each crack draws from its own random stream, and a branch's
// stream is seeded by its parent's, so a crack that ends a step sooner, such as at the edge of a slightly
// wider draw, changes only its own branches rather than every crack after it.
export function fractures(
  seed: number,
  {
    sources,
    blows,
    step,
    reach,
    far = 0,
    diminish,
    maxPoints = Infinity,
    box,
  }: FractureOptions,
): Pt[][] {
  // Every point, sources first and then the cracks' own points, which later cracks also turn toward.
  const X: number[] = [];
  const Y: number[] = [];
  // Whether a point lies on a crack.
  const onCrack: boolean[] = [];
  // Every crack segment, from point A to point B.
  const A: number[] = [];
  const B: number[] = [];

  // The lookup grid: square cells over the box, each a linked list of the points in it, and another of the
  // segments ending in it. Anything outside the box belongs to its edge cells.
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  if (box) [x0, y0, x1, y1] = box;
  else
    for (const [x, y] of sources) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  const size = reach / 4;
  const cols = Math.max(1, Math.ceil((x1 - x0) / size));
  const rows = Math.max(1, Math.ceil((y1 - y0) / size));
  const head = new Int32Array(cols * rows).fill(-1);
  const next: number[] = [];
  const segHead = new Int32Array(cols * rows).fill(-1);
  const segNext: number[] = [];
  const col = (x: number) =>
    Math.min(cols - 1, Math.max(0, Math.floor((x - x0) / size)));
  const row = (y: number) =>
    Math.min(rows - 1, Math.max(0, Math.floor((y - y0) / size)));
  const add = (x: number, y: number, crack: boolean) => {
    const k = X.length;
    const cell = row(y) * cols + col(x);
    X.push(x);
    Y.push(y);
    onCrack.push(crack);
    next.push(head[cell]);
    head[cell] = k;
    return k;
  };
  const join = (a: number, b: number) => {
    const cell = row(Y[b]) * cols + col(X[b]);
    A.push(a);
    B.push(b);
    segNext.push(segHead[cell]);
    segHead[cell] = A.length - 1;
  };
  for (const [x, y] of sources) add(x, y, false);
  let placed = 0;

  // Where the move from point p to (qx, qy) first crosses a crack segment, as a share of the way, or
  // Infinity. Crossed segments end within one and a half steps of the move's middle, for moves up to a step.
  let crossX = 0;
  let crossY = 0;
  const firstCrossing = (p: number, qx: number, qy: number) => {
    const [px, py] = [X[p], Y[p]];
    const [ux, uy] = [qx - px, qy - py];
    const [mx, my] = [(px + qx) / 2, (py + qy) / 2];
    const r = 1.5 * step;
    let first = Infinity;
    for (let i = row(my - r); i <= row(my + r); i++)
      for (let j = col(mx - r); j <= col(mx + r); j++)
        for (let s = segHead[i * cols + j]; s >= 0; s = segNext[s]) {
          const [a, b] = [A[s], B[s]];
          if (a === p || b === p) continue;
          const [vx, vy] = [X[b] - X[a], Y[b] - Y[a]];
          const den = ux * vy - uy * vx;
          if (den === 0) continue;
          const [wx, wy] = [X[a] - px, Y[a] - py];
          const t = (wx * vy - wy * vx) / den;
          const v = (wx * uy - wy * ux) / den;
          if (t > 0 && t < 1 && v > 0 && v < 1 && t < first) first = t;
        }
    if (first < Infinity) [crossX, crossY] = [px + ux * first, py + uy * first];
    return first;
  };

  type Fracture = {
    path: number[];
    dx: number;
    dy: number;
    chance: number;
    rand: () => number;
  };
  let alive: Fracture[] = [];
  const dead: Fracture[] = [];
  const reach2 = reach * reach;
  const step2 = step * step;
  const spread = Math.sqrt(1 - DOT * DOT);

  // One step of a crack: it turns toward the points in the cone ahead, each weighted by one over its
  // distance, and moves one step. It ends on a crack point that lies within a step of both its tip and the
  // new point (the original's relative neighborhood test), or where its move would cross a crack, which that
  // test can miss. It also ends where no point lies ahead. Returns whether the crack lives on.
  const advance = (f: Fracture) => {
    f.chance *= diminish;
    const c = f.path[f.path.length - 1];
    const [cx, cy, fx, fy] = [X[c], Y[c], f.dx, f.dy];

    // The cone's box: its tip, the ends of its two edges, and wherever its arc crosses an axis.
    const ex1 = fx * DOT - fy * spread;
    const ey1 = fy * DOT + fx * spread;
    const ex2 = fx * DOT + fy * spread;
    const ey2 = fy * DOT - fx * spread;
    const left = cx + reach * Math.min(0, ex1, ex2, -fx > DOT ? -1 : 0);
    const right = cx + reach * Math.max(0, ex1, ex2, fx > DOT ? 1 : 0);
    const top = cy + reach * Math.min(0, ey1, ey2, -fy > DOT ? -1 : 0);
    const bottom = cy + reach * Math.max(0, ey1, ey2, fy > DOT ? 1 : 0);
    let [ax, ay] = [far * fx, far * fy];
    let ahead = false;
    for (let i = row(top); i <= row(bottom); i++)
      for (let j = col(left); j <= col(right); j++)
        for (let k = head[i * cols + j]; k >= 0; k = next[k]) {
          const ex = X[k] - cx;
          const ey = Y[k] - cy;
          const d2 = ex * ex + ey * ey;
          if (d2 > reach2 || d2 <= 1e-18) continue;
          const dot = ex * fx + ey * fy;
          if (dot > 0 && dot * dot > DOT2 * d2) {
            ax += ex / d2;
            ay += ey / d2;
            ahead = true;
          }
        }
    if (!ahead) return false;
    const l = Math.sqrt(ax * ax + ay * ay);
    const [dx, dy] = [ax / l, ay / l];
    const [nx, ny] = [cx + dx * step, cy + dy * step];
    [f.dx, f.dy] = [dx, dy];

    // The crack point nearest the new point among those within a step of both ends.
    let hit = -1;
    let best = Infinity;
    for (let i = row(ny - step); i <= row(ny + step); i++)
      for (let j = col(nx - step); j <= col(nx + step); j++)
        for (let k = head[i * cols + j]; k >= 0; k = next[k]) {
          if (k === c || !onCrack[k]) continue;
          const ex = X[k] - nx;
          const ey = Y[k] - ny;
          const d2 = ex * ex + ey * ey;
          const gx = X[k] - cx;
          const gy = Y[k] - cy;
          if (d2 < step2 && gx * gx + gy * gy < step2 && d2 < best) {
            best = d2;
            hit = k;
          }
        }
    // The original can jump across a crack here, where a crack point sits just off its move. Where the move
    // crosses a crack, it ends there instead.
    const [tx, ty] = hit >= 0 ? [X[hit], Y[hit]] : [nx, ny];
    const crossed = firstCrossing(c, tx, ty) < Infinity;
    // A crack that ends on its first step is dropped, as in the original, so it leaves nothing behind.
    if ((crossed || hit >= 0) && f.path.length === 1) return false;
    if (crossed) {
      const k = add(crossX, crossY, true);
      join(c, k);
      f.path.push(k);
      return false;
    }
    if (hit >= 0) {
      join(c, hit);
      f.path.push(hit);
      return false;
    }
    const k = add(nx, ny, true);
    join(c, k);
    f.path.push(k);
    placed++;
    return true;
  };

  // Starts a crack from point p heading (dx, dy). It takes one step at once, and only a crack that lives
  // through it is kept, as in the original.
  const start = (
    p: number,
    dx: number,
    dy: number,
    chance: number,
    rand: () => number,
  ) => {
    const f: Fracture = { path: [p], dx, dy, chance, rand };
    if (advance(f)) alive.push(f);
  };

  let started = 0;
  for (const { at, count } of blows) {
    let p = 0;
    let best = Infinity;
    for (let k = 0; k < sources.length; k++) {
      const [ex, ey] = [X[k] - at[0], Y[k] - at[1]];
      const d2 = ex * ex + ey * ey;
      if (d2 < best) [best, p] = [d2, k];
    }
    for (let n = 0; n < count; n++) {
      const rand = stream(seed, started++);
      const a = 2 * Math.PI * rand();
      start(p, cos(a), sin(a), 1, rand);
    }
  }

  while (alive.length > 0 && placed < maxPoints) {
    const living: Fracture[] = [];
    for (const f of alive) {
      if (advance(f)) living.push(f);
      else if (f.path.length > 1) dead.push(f);
    }
    alive = living;
    // Each living crack may branch from its tip, at right angles to it, give or take.
    for (const f of living) {
      if (f.rand() > f.chance * SPAWN_FACTOR) continue;
      const side = f.rand() < 0.5 ? -1 : 1;
      const j = (0.5 - f.rand()) * SPAWN_ANGLE;
      const [px, py] = [-f.dy * side, f.dx * side];
      const [c, s] = [cos(j), sin(j)];
      start(
        f.path[f.path.length - 1],
        c * px - s * py,
        s * px + c * py,
        f.chance * SPAWN_DIMINISH,
        stream(Math.floor(f.rand() * 4294967296), BRANCH_SALT),
      );
    }
  }

  return [...dead, ...alive].map(({ path }) =>
    path.map((k): Pt => [X[k], Y[k]]),
  );
}

// `count` points scattered uniformly in the box, none within `gap` of another: the original's darts.
function darts(
  rand: () => number,
  count: number,
  [bx, by, bw, bh]: [number, number, number, number],
  gap: number,
): Pt[] {
  const cols = Math.ceil(bw / gap);
  const rows = Math.ceil(bh / gap);
  const cells: Pt[][] = Array.from({ length: cols * rows }, () => []);
  const out: Pt[] = [];
  const gap2 = gap * gap;
  for (let n = 0; n < count; n++) {
    const x = bx + bw * rand();
    const y = by + bh * rand();
    const ci = Math.min(cols - 1, Math.floor((x - bx) / gap));
    const ri = Math.min(rows - 1, Math.floor((y - by) / gap));
    let free = true;
    for (
      let i = Math.max(0, ri - 1);
      free && i <= Math.min(rows - 1, ri + 1);
      i++
    )
      for (
        let j = Math.max(0, ci - 1);
        free && j <= Math.min(cols - 1, ci + 1);
        j++
      )
        for (const [px, py] of cells[i * cols + j])
          if ((px - x) * (px - x) + (py - y) * (py - y) < gap2) {
            free = false;
            break;
          }
    if (!free) continue;
    cells[ri * cols + ci].push([x, y]);
    out.push([x, y]);
  }
  return out;
}

// Caps the crack points placed, so the work stays within the draw budget.
const MAX_POINTS = 11000;
// Half the side of the box points are scattered over, centered on the art: wider than any art's ground, which
// reaches at most 0.7 plus four steps from the middle.
const SCATTER = 0.75;
// Draws with a short side under this many pixels are supersampled.
const SUPERSAMPLE_BELOW = 128;

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  // Cracks grow in art units centered on the art, so a draw a pixel wider or narrower, as the detail view's
  // rounding makes it, moves only the edges.
  const unit = Math.min(width, height);
  const [hw, hh] = [width / unit / 2, height / unit / 2];

  // The ground the cracks spread over: a disc as in the original's sample, a rectangle inset as in its main
  // script, or the whole frame and past it, so cracks run off the edges. It spans gx by gy either side of the
  // middle. The larger the ground, the longer the step, which keeps the work in budget: cells span about
  // fifteen steps.
  const shape = rand();
  let step: number;
  let gx: number;
  let gy: number;
  let inside: (x: number, y: number) => boolean;
  const disc = shape < 0.35;
  if (disc) {
    step = 0.0046 + 0.0014 * rand();
    const r = 0.42 + 0.04 * rand();
    [gx, gy] = [r, r];
    inside = (x, y) => x * x + y * y < r * r;
  } else {
    // The ground is a box of fixed size for the art's shape, so a larger draw's slightly different shape
    // never moves its edges, and no crack near them grows differently. The art's short side is 1, and its
    // long side is either the same, on a square stamp, or 1.28 to 1.4 long.
    const square = Math.abs(hw - hh) < 0.05;
    const inset = shape < 0.55;
    step = inset ? 0.0055 + 0.0017 * rand() : 0.0066 + 0.0018 * rand();
    const m = inset ? 0.07 + 0.03 * rand() : -4 * step;
    const short = 0.5 - m;
    const long = (square ? 0.5 : inset ? 0.64 : 0.7) - m;
    [gx, gy] = hw > hh ? [long, short] : [short, long];
    inside = (x, y) => Math.abs(x) < gx && Math.abs(y) < gy;
  }
  // Points about 3.8 steps apart on average, at least one step apart, as in the original. They're scattered
  // over a box that holds any art's ground, from their own stream, so the same seed scatters the same points
  // whatever the draw's shape.
  const spacing = 3.8 * step;
  const sources = darts(
    stream(seed, 1),
    Math.round((4 * SCATTER * SCATTER) / (spacing * spacing)),
    [-SCATTER, -SCATTER, 2 * SCATTER, 2 * SCATTER],
    step,
  ).filter(([x, y]) => inside(x, y));
  // Blows sit in a box of fixed size around the middle, inside any art's ground, or within the disc. Placing
  // them in art units, not as shares of the ground, keeps them still when a larger draw moves the ground's
  // edges.
  const blowCount = 4 + Math.floor(rand() * 4);
  const blowRand = stream(seed, 2);
  const [bx, by] = disc ? [gx, gy] : shape < 0.55 ? [0.3, 0.3] : [0.45, 0.45];
  const blows = Array.from({ length: blowCount }, () => {
    let [u, v] = [2 * blowRand() - 1, 2 * blowRand() - 1];
    while (disc && u * u + v * v >= 1)
      [u, v] = [2 * blowRand() - 1, 2 * blowRand() - 1];
    return {
      at: [u * bx, v * by] as Pt,
      count: 2 + Math.floor(blowRand() * 2),
    };
  });
  // The original looks 50 steps ahead. Looking 11 steps ahead is cheaper, and the points between count by
  // their expected pull: their density, times the depth of the band, times the cone's width at unit distance.
  const reach = 11 * step;
  const far =
    ((50 * step - reach) * 2 * Math.sqrt(1 - DOT * DOT)) / (spacing * spacing);
  const cracks = fractures(subSeed(seed, 3), {
    sources,
    blows,
    step,
    reach,
    far,
    diminish: 0.997 + 0.002 * rand(),
    maxPoints: MAX_POINTS,
    box: [-SCATTER, -SCATTER, SCATTER, SCATTER],
  });

  // Lines 1 to 1.3 desk pixels wide, over the original's faint halo three times as wide.
  const radius = 0.0025 + 0.0007 * rand();
  const ink = rgb(inks[0]);
  const ground = rgb(paper);
  // Some stamps tint cells: a patch of neighbors in one ink, or cells scattered across the field in the
  // other inks, chosen by noise at each cell's middle so the choice holds at any size.
  const tinting = rand();
  // Tints that would read as a muddy shade of the line ink are left out.
  const tints = inks
    .slice(1)
    .map(rgb)
    .filter((c) => Math.abs(lightness(c) - lightness(ink)) > MIN_CONTRAST);
  const patch = tinting < 0.35;
  const scatter = !patch && tinting < 0.55;
  const noise = perlin2(subSeed(seed, 0x4f1d));
  const which = perlin2(subSeed(seed, 0x2e7b));
  const frequency = patch ? 2 + 1.5 * rand() : 14 + 6 * rand();
  const cut = patch ? 0.15 + 0.2 * rand() : 0.3 + 0.15 * rand();
  const [ox, oy] = [64 * rand(), 64 * rand()];
  const glaze = 0.4 + 0.2 * rand();

  // Paints the picture at `width` by `height` pixels into `data`, four bytes per pixel.
  const paint = (width: number, height: number, data: Uint8ClampedArray) => {
    // Each pixel's squared distance to the nearest crack, in pixels, as far as the halo reaches.
    const n = width * height;
    const unit = Math.min(width, height);
    const [mx, my] = [width / 2, height / 2];
    const dist2 = new Float32Array(n).fill(Infinity);
    const r = radius * unit;
    // A line thinner than a pixel draws a pixel wide at matching strength, so it keeps its weight when small.
    const line = Math.max(r, 0.5);
    const halo = Math.max(3 * r, 0.5);
    const [lineWeight, haloWeight] = [
      Math.min(1, 2 * r),
      0.2 * Math.min(1, 6 * r),
    ];
    const segment = (ax: number, ay: number, bx: number, by: number) => {
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - halo - 1));
      const x1 = Math.min(width, Math.ceil(Math.max(ax, bx) + halo + 1));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - halo - 1));
      const y1 = Math.min(height, Math.ceil(Math.max(ay, by) + halo + 1));
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
          const d2 = dx * dx + dy * dy;
          const i = y * width + x;
          if (d2 < dist2[i]) dist2[i] = d2;
        }
    };
    for (const crack of cracks)
      for (let p = 0; p + 1 < crack.length; p++)
        segment(
          crack[p][0] * unit + mx,
          crack[p][1] * unit + my,
          crack[p + 1][0] * unit + mx,
          crack[p + 1][1] * unit + my,
        );

    // Each pixel's tint, 0 for none or 1 + the index of its ink.
    const tintAt = new Uint8Array(n);
    if ((patch || scatter) && tints.length > 0) {
      // The cells: regions of pixels farther than half a pixel from a crack, which the line covers. A band that
      // wide keeps a crack at any angle a wall that a fill can't slip through between diagonal neighbors.
      const wall2 = line * line;
      // The pixel beside p in direction e (left, right, up, down), or -1 off the edge.
      const beside = (p: number, e: number) =>
        e === 0
          ? p % width > 0
            ? p - 1
            : -1
          : e === 1
            ? p % width < width - 1
              ? p + 1
              : -1
            : e === 2
              ? p - width
              : p + width < n
                ? p + width
                : -1;
      const cell = new Int32Array(n).fill(-1);
      const queue = new Int32Array(n);
      const cells: number[] = [];
      for (let i = 0; i < n; i++) {
        if (cell[i] >= 0 || dist2[i] <= wall2) continue;
        const id = cells.length;
        let [count, sx, sy] = [0, 0, 0];
        let end = 0;
        queue[end++] = i;
        cell[i] = id;
        for (let q = 0; q < end; q++) {
          const p = queue[q];
          count++;
          sx += p % width;
          sy += Math.floor(p / width);
          for (let e = 0; e < 4; e++) {
            const k = beside(p, e);
            if (k >= 0 && cell[k] < 0 && dist2[k] > wall2) {
              cell[k] = id;
              queue[end++] = k;
            }
          }
        }
        // Holes and the ground outside the cracks stay paper: cells larger than a twenty-fifth of the art's
        // short side squared.
        let tint = 0;
        if (count < (unit * unit) / 25) {
          const u = (sx / count + 0.5 - mx) / unit;
          const v = (sy / count + 0.5 - my) / unit;
          const k = noise(u * frequency + ox, v * frequency + oy);
          // Scattered cells take the second ink or the third by another field, which changes only where it
          // crosses zero, so a cell keeps its ink at any size.
          if (k > cut)
            tint =
              scatter &&
              tints.length > 1 &&
              which(u * frequency, v * frequency) > 0
                ? 2
                : 1;
        }
        cells.push(tint);
      }
      // Pixels under the cracks take the tint of the nearest cell, so tints meet under the line.
      let end = 0;
      for (let i = 0; i < n; i++) if (cell[i] >= 0) queue[end++] = i;
      for (let q = 0; q < end; q++) {
        const p = queue[q];
        for (let e = 0; e < 4; e++) {
          const k = beside(p, e);
          if (k >= 0 && cell[k] < 0) {
            cell[k] = cell[p];
            queue[end++] = k;
          }
        }
      }
      for (let i = 0; i < n; i++) if (cell[i] >= 0) tintAt[i] = cells[cell[i]];
    }
    for (let i = 0; i < n; i++) {
      const d = Math.sqrt(dist2[i]);
      const a = clamp01(line - d + 0.5) * lineWeight;
      const h = clamp01(halo - d + 0.5) * haloWeight;
      const tint = tintAt[i] > 0 ? tints[tintAt[i] - 1] : ground;
      const g = tintAt[i] > 0 ? glaze : 0;
      for (let k = 0; k < 3; k++) {
        let c = ground[k] + (tint[k] - ground[k]) * g;
        c += (ink[k] - c) * h;
        c += (ink[k] - c) * a;
        data[i * 4 + k] = Math.round(c);
      }
      data[i * 4 + 3] = 255;
    }
  };

  // A small draw's cracks run a few pixels apart, where a pixel's nearest crack undercounts several sharing it
  // and cells shrink to a pixel or two. So S by S samples per pixel, each a pixel of a draw S times larger.
  const image = ctx.createImageData(width, height);
  const data = image.data;
  if (unit >= SUPERSAMPLE_BELOW) paint(width, height, data);
  else {
    const S = Math.ceil(SUPERSAMPLE_BELOW / unit);
    const samples = new Uint8ClampedArray(width * S * height * S * 4);
    paint(width * S, height * S, samples);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        for (let k = 0; k < 3; k++) {
          let sum = 0;
          for (let sy = 0; sy < S; sy++)
            for (let sx = 0; sx < S; sx++)
              sum += samples[((y * S + sy) * width * S + x * S + sx) * 4 + k];
          data[i * 4 + k] = Math.round(sum / (S * S));
        }
        data[i * 4 + 3] = 255;
      }
  }
  ctx.putImageData(image, 0, 0);
}

export const fracture1: Style = {
  id: "crack1",
  draw,
};
