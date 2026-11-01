import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Escher tessellation: a field of interlocking creatures that tile with no gaps, each with an eye and a few
// stripes, in alternating inks, outlined in the darkest.
//
// It starts from a plain tiling with a wallpaper symmetry: squares, hexagons, rhombi, or the triangles that
// split them, around rotation centers of order 1, 2, 3, 4 or 6. Then it bends the plane with a seeded flow
// whose velocity has that same symmetry. A flow never tears or folds the plane, and one that commutes with the
// symmetry carries every tile to a congruent creature, so the creatures always tile: each one's edge is a
// deformed copy of its neighbor's, moved by translation or rotation, as in Heesch's tile types. Each pixel is
// carried along the flow to find its tile and its place in it. The flow is stored as a table, which can fold
// where the flow squeezes hard, so the flow's strength is capped and the table checks itself for folds.
//
// Like land1 it computes every pixel itself, so it is resolution independent and its pixels match in every
// browser and in Node (ADR 0001). Only IEEE-exact arithmetic here: no Math.sin, Math.pow or the like.

type Rgb = [number, number, number];
type Vec = [number, number];

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

const SQRT3 = Math.sqrt(3);

// A base tiling: a lattice's Voronoi cells, each split into `order` equal sectors around its lattice point by
// rays toward cell corners. The lattice point is a rotation center of that order, so the tiling has the
// wallpaper symmetry p1, p2, p3, p4 or p6. `colors` fill colors are enough that neighbors always differ.
export type Tiling = {
  lattice: "square" | "hex";
  order: 1 | 2 | 3 | 4 | 6;
  colors: number;
};

export const TILINGS: readonly Tiling[] = [
  { lattice: "square", order: 1, colors: 2 }, // squares
  { lattice: "square", order: 2, colors: 2 }, // half squares, in rows
  { lattice: "square", order: 4, colors: 2 }, // quarter squares, corner to center
  { lattice: "hex", order: 1, colors: 3 }, // hexagons
  { lattice: "hex", order: 3, colors: 3 }, // rhombi, three to a hexagon
  { lattice: "hex", order: 6, colors: 2 }, // triangles, six to a hexagon
];

// A lattice's basis, and the directions to the neighbors whose bisectors bound a cell.
const BASIS: Record<Tiling["lattice"], [Vec, Vec]> = {
  square: [
    [1, 0],
    [0, 1],
  ],
  hex: [
    [1, 0],
    [0.5, SQRT3 / 2],
  ],
};
const NEIGHBORS: Record<Tiling["lattice"], readonly Vec[]> = {
  square: [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ],
  hex: [
    [1, 0],
    [0.5, SQRT3 / 2],
    [-0.5, SQRT3 / 2],
    [-1, 0],
    [-0.5, -SQRT3 / 2],
    [0.5, -SQRT3 / 2],
  ],
};

// Rotations by whole turns over `order`, as [cos, sin], built from exact values.
function turns(order: number): Vec[] {
  const step: Vec =
    order === 1
      ? [1, 0]
      : order === 2
        ? [-1, 0]
        : order === 3
          ? [-0.5, SQRT3 / 2]
          : order === 4
            ? [0, 1]
            : [0.5, SQRT3 / 2];
  const out: Vec[] = [[1, 0]];
  for (let k = 1; k < order; k++) {
    const [c, s] = out[k - 1];
    out.push([c * step[0] - s * step[1], c * step[1] + s * step[0]]);
  }
  return out;
}

const rotate = ([x, y]: Vec, [c, s]: Vec): Vec => [
  x * c - y * s,
  x * s + y * c,
];

// The rays that bound sector 0, from the lattice point toward a cell corner: square corners at 45 degrees and
// hexagon corners at 30. Squares split in two take the ray along an axis instead, so the halves are rows of
// rectangles that two colors can alternate on. Null for unsplit cells.
function sectorRays(tiling: Tiling): [Vec, Vec] | null {
  if (tiling.order === 1) return null;
  const r0: Vec =
    tiling.lattice === "hex"
      ? [SQRT3 / 2, 0.5]
      : tiling.order === 2
        ? [1, 0]
        : [Math.SQRT1_2, Math.SQRT1_2];
  return [r0, rotate(r0, turns(tiling.order)[1])];
}

// Where a point lies in a base tiling: its cell's lattice coordinates, its sector, and its position (x, y) in
// the canonical tile, the sector-0 tile of the cell at the origin, which every tile is a turned, moved copy of.
export type Place = { i: number; j: number; k: number; x: number; y: number };

export function locator(tiling: Tiling): {
  // Writes where (x, y) lies into `place`.
  locate(x: number, y: number, place: Place): void;
  // The tile's fill color, 0 to `tiling.colors` - 1.
  color(place: Place): number;
} {
  const [[ax, ay], [bx, by]] = BASIS[tiling.lattice];
  const det = ax * by - ay * bx;
  const order = tiling.order;
  const turned = turns(order);
  const rot = turned.flat();
  const ray0 = sectorRays(tiling);
  // Every sector's first ray, then sector 0's again, as flat [x, y] pairs.
  const rays = ray0
    ? [...turned, turned[0]].flatMap((r) => rotate(ray0[0], r))
    : [];

  const locate = (x: number, y: number, place: Place) => {
    // Lattice coordinates, then the nearest lattice point among the four corners of their cell. For the hex
    // lattice the cell is two equilateral triangles, so the nearest corner is the nearest lattice point.
    const s0 = Math.floor((x * by - y * bx) / det);
    const t0 = Math.floor((y * ax - x * ay) / det);
    let i = 0;
    let j = 0;
    let best = Infinity;
    for (let dj = 0; dj < 2; dj++)
      for (let di = 0; di < 2; di++) {
        const dx = x - (s0 + di) * ax - (t0 + dj) * bx;
        const dy = y - (s0 + di) * ay - (t0 + dj) * by;
        const d = dx * dx + dy * dy;
        if (d < best) {
          i = s0 + di;
          j = t0 + dj;
          best = d;
        }
      }
    const dx = x - i * ax - j * bx;
    const dy = y - i * ay - j * by;
    let k = 0;
    for (; k < order - 1; k++) {
      const a = 2 * k;
      if (
        rays[a] * dy - rays[a + 1] * dx >= 0 &&
        dx * rays[a + 3] - dy * rays[a + 2] > 0
      )
        break;
    }
    const c = rot[2 * k];
    const s = rot[2 * k + 1];
    place.i = i;
    place.j = j;
    place.k = k;
    place.x = dx * c + dy * s;
    place.y = dy * c - dx * s;
  };

  const color = ({ i, j, k }: Place): number => {
    if (tiling.lattice === "square")
      // A checkerboard of squares, of rows of half squares, or of quarter squares.
      return (tiling.order === 2 ? i + 2 * j + k : i + j + k) & 1;
    // Each hexagon differs from its six neighbors, rhombi go by orientation, and triangles alternate around
    // each hexagon and across its edges.
    if (tiling.order === 1) return (((i + 2 * j) % 3) + 3) % 3;
    return tiling.order === 3 ? k : k & 1;
  };

  return { locate, color };
}

// The steepest the flow's velocity may change, per unit of lattice space. A flow that changes faster stretches
// creatures into spaghetti, needs more steps to follow, and squeezes the plane too hard for the table, which
// then folds. At 3, about one seed in five folded; at 2, about one in 400 before the table's own check.
const MAX_SLOPE = 2;

// The flow's velocity: smooth value noise that repeats with the lattice, averaged over the tiling's rotations
// about the origin, so it has the tiling's full symmetry. `velocity` writes the velocity at a point in lattice
// space into `out`. `slope` is about how fast it changes at most, the largest norm of its Jacobian, at most
// MAX_SLOPE.
function velocityField(
  tiling: Tiling,
  rand: () => number,
  strength: number,
): {
  velocity: (x: number, y: number, out: Float64Array) => void;
  slope: number;
} {
  const [[ax, ay], [bx, by]] = BASIS[tiling.lattice];
  const det = ax * by - ay * bx;
  const M = tiling.order === 1 ? 3 : 4; // noise cells per lattice cell
  // Averaging over n turns shrinks random vectors by about the square root of n, so scale them back up.
  const amp = strength * Math.sqrt(tiling.order);
  const grid = Float64Array.from(
    { length: M * M * 2 },
    () => amp * (rand() - 0.5),
  );
  const rot = turns(tiling.order).flat();
  const n = tiling.order;
  const velocity = (x: number, y: number, out: Float64Array) => {
    let vx = 0;
    let vy = 0;
    for (let r = 0; r < 2 * n; r += 2) {
      // The base noise at the point turned by r, turned back by r.
      const c = rot[r];
      const sn = rot[r + 1];
      const px = x * c - y * sn;
      const py = x * sn + y * c;
      const s = ((px * by - py * bx) / det) * M;
      const t = ((py * ax - px * ay) / det) * M;
      const s0 = Math.floor(s);
      const t0 = Math.floor(t);
      let fs = s - s0;
      let ft = t - t0;
      fs = fs * fs * (3 - 2 * fs);
      ft = ft * ft * (3 - 2 * ft);
      const i0 = ((s0 % M) + M) % M;
      const j0 = ((t0 % M) + M) % M;
      const i1 = i0 === M - 1 ? 0 : i0 + 1;
      const j1 = j0 === M - 1 ? 0 : j0 + 1;
      const [p00, p10, p01, p11] = [
        (j0 * M + i0) * 2,
        (j0 * M + i1) * 2,
        (j1 * M + i0) * 2,
        (j1 * M + i1) * 2,
      ];
      const tu = grid[p00] + (grid[p10] - grid[p00]) * fs;
      const bu = grid[p01] + (grid[p11] - grid[p01]) * fs;
      const tv = grid[p00 + 1] + (grid[p10 + 1] - grid[p00 + 1]) * fs;
      const bv = grid[p01 + 1] + (grid[p11 + 1] - grid[p01 + 1]) * fs;
      const u = tu + (bu - tu) * ft;
      const v = tv + (bv - tv) * ft;
      vx += u * c + v * sn;
      vy += v * c - u * sn;
    }
    out[0] = vx / n;
    out[1] = vy / n;
  };

  // Estimate the slope from differences across a grid over one cell, then scale the noise down to the cap.
  const [a, b] = [new Float64Array(2), new Float64Array(2)];
  const G = 16;
  let slope = 0;
  for (let j = 0; j < G; j++)
    for (let i = 0; i < G; i++) {
      const [x, y] = [(i * ax + j * bx) / G, (i * ay + j * by) / G];
      const e = 1 / 64;
      velocity(x + e, y, a);
      velocity(x - e, y, b);
      const [gxx, gyx] = [(a[0] - b[0]) / (2 * e), (a[1] - b[1]) / (2 * e)];
      velocity(x, y + e, a);
      velocity(x, y - e, b);
      const [gxy, gyy] = [(a[0] - b[0]) / (2 * e), (a[1] - b[1]) / (2 * e)];
      const norm = Math.sqrt(gxx * gxx + gyx * gyx + gxy * gxy + gyy * gyy);
      if (norm > slope) slope = norm;
    }
  if (slope > MAX_SLOPE) {
    for (let i = 0; i < grid.length; i++) grid[i] *= MAX_SLOPE / slope;
    slope = MAX_SLOPE;
  }
  return { velocity, slope };
}

// Samples per side of the table of the flow's displacement over one lattice cell. Turning the lattice about the
// origin by a tiling's rotation moves table samples onto table samples, which these integer matrices do in
// lattice coordinates: [i, j] goes to [a i + b j, c i + d j].
const TABLE = 40;
const TURN_STEP: Record<string, readonly number[]> = {
  "square 2": [-1, 0, 0, -1],
  "square 4": [0, -1, 1, 0],
  "hex 3": [-1, -1, 1, 0],
  "hex 6": [0, -1, 1, 1],
};
// How far a flow step may go, as a fraction of the distance over which the velocity changes, so steps follow
// the flow closely enough not to fold the plane themselves.
const STEP_REACH = 0.3;

// The flow's displacement, tabulated over one lattice cell, since it repeats with the lattice. The function it
// returns writes the displacement at a point in lattice space and the Jacobian of the whole map, (x, y) plus
// displacement, into `out` as [dx, dy, j00, j01, j10, j11]. It interpolates with Catmull-Rom splines, so the
// creatures' edges stay smooth when zoomed in.
function displacement(
  tiling: Tiling,
  velocity: (x: number, y: number, out: Float64Array) => void,
  slope: number,
): (x: number, y: number, out: Float64Array) => void {
  const [[ax, ay], [bx, by]] = BASIS[tiling.lattice];
  const det = ax * by - ay * bx;
  // Padded by one sample before and two after on each axis, wrapped, so lookups never need to wrap.
  const P = TABLE + 3;
  const table = new Float64Array(P * P * 2);
  const steps = Math.max(4, Math.ceil(slope / STEP_REACH));
  const h = 1 / steps;
  const raw = new Float64Array(TABLE * TABLE * 2);
  const done = new Uint8Array(TABLE * TABLE);
  const v = new Float64Array(2);
  const step = TURN_STEP[`${tiling.lattice} ${tiling.order}`] ?? [1, 0, 0, 1];
  const [tc, ts] = turns(tiling.order)[1 % tiling.order];
  const wrap = (i: number) => ((i % TABLE) + TABLE) % TABLE;
  for (let j = 0; j < TABLE; j++)
    for (let i = 0; i < TABLE; i++) {
      if (done[j * TABLE + i]) continue;
      const [s, t] = [i / TABLE, j / TABLE];
      const [x0, y0] = [s * ax + t * bx, s * ay + t * by];
      let [x, y] = [x0, y0];
      // Midpoint steps.
      for (let n = 0; n < steps; n++) {
        velocity(x, y, v);
        velocity(x + (h / 2) * v[0], y + (h / 2) * v[1], v);
        x += h * v[0];
        y += h * v[1];
      }
      // The flow has the tiling's symmetry, so the sample's turned copies move by its displacement turned.
      let [ci, cj, dx, dy] = [i, j, x - x0, y - y0];
      for (let k = 0; k < tiling.order; k++) {
        const at = cj * TABLE + ci;
        done[at] = 1;
        raw[at * 2] = dx;
        raw[at * 2 + 1] = dy;
        [ci, cj] = [
          wrap(step[0] * ci + step[1] * cj),
          wrap(step[2] * ci + step[3] * cj),
        ];
        [dx, dy] = [dx * tc - dy * ts, dx * ts + dy * tc];
      }
    }
  for (let j = 0; j < P; j++)
    for (let i = 0; i < P; i++) {
      const from =
        (((j + TABLE - 1) % TABLE) * TABLE + ((i + TABLE - 1) % TABLE)) * 2;
      table[(j * P + i) * 2] = raw[from];
      table[(j * P + i) * 2 + 1] = raw[from + 1];
    }
  const weights = (f: number, w: Float64Array) => {
    const f2 = f * f;
    const f3 = f2 * f;
    w[0] = (-f3 + 2 * f2 - f) / 2;
    w[1] = (3 * f3 - 5 * f2 + 2) / 2;
    w[2] = (-3 * f3 + 4 * f2 + f) / 2;
    w[3] = (f3 - f2) / 2;
    w[4] = (-3 * f2 + 4 * f - 1) / 2;
    w[5] = (9 * f2 - 10 * f) / 2;
    w[6] = (-9 * f2 + 8 * f + 1) / 2;
    w[7] = (3 * f2 - 2 * f) / 2;
  };
  const [ws, wt] = [new Float64Array(8), new Float64Array(8)];
  // Derivatives along the table's axes, per unit of x and y.
  const [sx, sy] = [(by / det) * TABLE, (-bx / det) * TABLE];
  const [tx, ty] = [(-ay / det) * TABLE, (ax / det) * TABLE];
  const at = (x: number, y: number, out: Float64Array) => {
    const s = ((x * by - y * bx) / det) * TABLE;
    const t = ((y * ax - x * ay) / det) * TABLE;
    const fs = Math.floor(s);
    const ft = Math.floor(t);
    weights(s - fs, ws);
    weights(t - ft, wt);
    const i0 = ((fs % TABLE) + TABLE) % TABLE;
    const j0 = ((ft % TABLE) + TABLE) % TABLE;
    let dx = 0;
    let dy = 0;
    let dxs = 0;
    let dys = 0;
    let dxt = 0;
    let dyt = 0;
    for (let b = 0; b < 4; b++) {
      let p = ((j0 + b) * P + i0) * 2;
      let rx = 0;
      let ry = 0;
      let rxs = 0;
      let rys = 0;
      for (let a = 0; a < 4; a++, p += 2) {
        rx += ws[a] * table[p];
        ry += ws[a] * table[p + 1];
        rxs += ws[a + 4] * table[p];
        rys += ws[a + 4] * table[p + 1];
      }
      dx += wt[b] * rx;
      dy += wt[b] * ry;
      dxs += wt[b] * rxs;
      dys += wt[b] * rys;
      dxt += wt[b + 4] * rx;
      dyt += wt[b + 4] * ry;
    }
    out[0] = dx;
    out[1] = dy;
    out[2] = 1 + dxs * sx + dxt * tx;
    out[3] = dxs * sy + dxt * ty;
    out[4] = dys * sx + dyt * tx;
    out[5] = 1 + dys * sy + dyt * ty;
  };

  // The flow itself never folds, but where it squeezes hardest the table can be too coarse to follow it, and
  // its splines overshoot into folds. Scaling the displacement by a keeps the flow's symmetry, and the map's
  // Jacobian determinant is then 1 + a tr(A) + a^2 det(A), where A is the displacement's Jacobian. So find the
  // largest a that keeps it positive at every table sample and every cell's middle, and keep a margin under it.
  let scale = 1;
  const out = new Float64Array(6);
  for (let j = 0; j < 2 * TABLE; j++)
    for (let i = 0; i < 2 * TABLE; i++) {
      const [s, t] = [i / (2 * TABLE), j / (2 * TABLE)];
      at(s * ax + t * bx, s * ay + t * by, out);
      const [a00, a01, a10, a11] = [out[2] - 1, out[3], out[4], out[5] - 1];
      const tr = a00 + a11;
      const dt = a00 * a11 - a01 * a10;
      // The smallest positive root of 1 + a tr + a^2 dt, if any.
      let root = Infinity;
      if (dt === 0) {
        if (tr < 0) root = -1 / tr;
      } else {
        const disc = tr * tr - 4 * dt;
        if (disc >= 0) {
          const q = Math.sqrt(disc);
          for (const r of [(-tr - q) / (2 * dt), (-tr + q) / (2 * dt)])
            if (r > 0 && r < root) root = r;
        }
      }
      if (0.8 * root < scale) scale = 0.8 * root;
    }
  if (scale < 1) for (let i = 0; i < table.length; i++) table[i] *= scale;
  return at;
}

// The map that bends a base tiling into creatures: a flow with the tiling's symmetry, its velocity noise drawn
// from `rand` at about `strength`. Returns the tabulated displacement, as `displacement` does.
export function creatureFlow(
  tiling: Tiling,
  rand: () => number,
  strength: number,
): (x: number, y: number, out: Float64Array) => void {
  const { velocity, slope } = velocityField(tiling, rand, strength);
  return displacement(tiling, velocity, slope);
}

// How much of a sample `px` wide a band covers, the band being where the distance `d` is within `w` / 2 of 0.
function band(d: number, w: number, px: number): number {
  const overlap = Math.min(d + px / 2, w / 2) - Math.max(d - px / 2, -w / 2);
  return overlap > 0 ? Math.min(1, overlap / px) : 0;
}

// How much of a sample `px` wide lies inside an edge `d` away, positive inside.
const inside = (d: number, px: number) =>
  d >= px / 2 ? 1 : d <= -px / 2 ? 0 : d / px + 0.5;

// Small draws are supersampled until the art's short side has this many samples, so lines finer than a pixel
// average out the way they would in a large draw scaled down.
const MIN_UNIT = 160;

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const tiling = TILINGS[Math.floor(rand() * TILINGS.length)];
  const { locate, color } = locator(tiling);
  const neighbors = NEIGHBORS[tiling.lattice];
  const rays = sectorRays(tiling);
  const rot = turns(tiling.order);
  // A tile's size in lattice units, so the flow and the features scale with the tile, not the cell.
  const tileSize = Math.sqrt(
    (tiling.lattice === "square" ? 1 : SQRT3 / 2) / tiling.order,
  );

  // Roughly the canonical tile's middle: partway out along the sector's bisector, or the cell's center.
  const middle: Vec = (() => {
    if (!rays) return [0, 0];
    const [mx, my] = [rays[0][0] + rays[1][0], rays[0][1] + rays[1][1]];
    const len = Math.sqrt(mx * mx + my * my);
    if (len < 1e-9) return [0, 0.25]; // half squares have opposite rays: their middle is straight up
    const reach = tiling.lattice === "square" ? 0.28 : 0.25;
    return [(mx / len) * reach, (my / len) * reach];
  })();

  const unitVec = (): Vec => {
    for (;;) {
      const [x, y] = [rand() * 2 - 1, rand() * 2 - 1];
      const len = Math.sqrt(x * x + y * y);
      if (len > 0.2 && len < 1) return [x / len, y / len];
    }
  };

  // The creatures: how hard the flow bends them, then their eye and stripes in the canonical tile. The eye
  // looks along `look`, and the stripes cross the body behind it.
  const flow = creatureFlow(tiling, rand, tileSize * (0.9 + 0.9 * rand()));
  const look = unitVec();
  const eyeAt = tileSize * (0.12 + 0.1 * rand());
  const eye = {
    x: middle[0] + look[0] * eyeAt,
    y: middle[1] + look[1] * eyeAt,
    r: tileSize * (0.07 + 0.03 * rand()),
  };
  const pupil = eye.r * (0.4 + 0.2 * rand());
  const stripes = {
    count: 2 + Math.floor(rand() * 3),
    gap: tileSize * (0.07 + 0.04 * rand()),
    width: tileSize * (0.025 + 0.015 * rand()),
    start: eye.r * 1.4 + tileSize * (0.02 + 0.06 * rand()), // clear of the eye
    reach: tileSize * (0.14 + 0.1 * rand()), // half their length
  };
  const line = tileSize * 0.03; // the outline's and the eye's ring's width, on the stamp

  // Fill colors from the lighter inks and the paper, and sometimes the darkest ink, for dark creatures among
  // light ones. Details print in the darkest ink, or in paper on a dark creature.
  const paperRgb = rgb(paper);
  const dark = rgb(inks[0]);
  const light = inks.slice(1).map(rgb);
  const pool: Rgb[] = [...light, paperRgb];
  if (pool.length < 3) pool.push(mix(light[0], paperRgb, 0.5));
  for (let n = pool.length - 1; n > 0; n--) {
    const m = Math.floor(rand() * (n + 1));
    [pool[n], pool[m]] = [pool[m], pool[n]];
  }
  const fills = pool.slice(0, tiling.colors);
  if (rand() < 0.35) fills[Math.floor(rand() * fills.length)] = dark;

  // The tiling's place on the stamp: its size, a turn and an offset.
  const unit = Math.min(width, height);
  const across = 3.2 + 1.6 * rand(); // tiles across the short side
  const scale = (across * tileSize) / unit; // lattice units per pixel
  const [oc, os] = unitVec();
  const [ox, oy] = [rand() * 4, rand() * 4];

  const ss = Math.ceil(MIN_UNIT / unit);
  const px = scale / ss; // a sample's size in lattice units

  const place: Place = { i: 0, j: 0, k: 0, x: 0, y: 0 };
  const map = new Float64Array(6);
  const turn = rot.flat();
  const edges = [...neighbors.flat()];
  const rayList = rays ? rays.flat() : [];
  const [lookX, lookY] = look;
  let [r, g, b] = [0, 0, 0]; // the color being built at a sample
  let [sumR, sumG, sumB] = [0, 0, 0];
  let [tc, ts] = [1, 0]; // the turn from the canonical tile to the sample's tile

  // A distance in the canonical tile, measured along the unit vector (nx, ny) there, as a distance in lattice
  // space: the map stretches distances along a normal n by the length of J^T n, where n is turned back from
  // the canonical tile to the sample's tile.
  const back = (d: number, nx: number, ny: number) => {
    const rx = nx * tc - ny * ts;
    const ry = nx * ts + ny * tc;
    const gx = map[2] * rx + map[4] * ry;
    const gy = map[3] * rx + map[5] * ry;
    return d / Math.sqrt(gx * gx + gy * gy);
  };
  const paint = (col: Rgb, t: number) => {
    r += (col[0] - r) * t;
    g += (col[1] - g) * t;
    b += (col[2] - b) * t;
  };

  // Adds the color at a point in lattice space to the sums.
  const shade = (x: number, y: number) => {
    flow(x, y, map);
    locate(x + map[0], y + map[1], place);
    const fill = fills[color(place)];
    tc = turn[2 * place.k];
    ts = turn[2 * place.k + 1];
    const lx = place.x;
    const ly = place.y;
    const detail = fill === dark ? paperRgb : dark;
    r = fill[0];
    g = fill[1];
    b = fill[2];

    // Stripes, behind the eye across the body, with blunt ends.
    const ex = lx - eye.x;
    const ey = ly - eye.y;
    const along = -ex * lookX - ey * lookY - stripes.start;
    const k = Math.round(along / stripes.gap);
    if (k >= 0 && k < stripes.count) {
      const d = along - k * stripes.gap;
      const across = ex * lookY - ey * lookX;
      const cover =
        band(back(d, lookX, lookY), stripes.width, px) *
        inside(back(stripes.reach - Math.abs(across), lookY, -lookX), px);
      if (cover > 0) paint(detail, cover);
    }

    // The eye: a paper disc ringed in the detail color, with a dark pupil. It stays round on the stamp, however
    // the flow squeezes the tile, so it's measured on the stamp: the offset from its center, turned back to
    // the sample's tile, through the inverse of the Jacobian.
    if (ex * ex + ey * ey < 16 * eye.r * eye.r) {
      const ox = ex * tc - ey * ts;
      const oy = ex * ts + ey * tc;
      const det = map[2] * map[5] - map[3] * map[4];
      const qx = (map[5] * ox - map[3] * oy) / det;
      const qy = (map[2] * oy - map[4] * ox) / det;
      const er = Math.sqrt(qx * qx + qy * qy);
      paint(paperRgb, inside(eye.r - er, px));
      paint(detail, band(er - eye.r, line, px));
      paint(dark, inside(pupil - er, px));
    }

    // The outline, centered on the tile's edge: the cell's boundary, plus for split cells the rays bounding
    // the sector. Each tile draws its own half.
    let edge = Infinity;
    let ux = 1;
    let uy = 0;
    for (let e = 0; e < edges.length; e += 2) {
      const d = 0.5 - (lx * edges[e] + ly * edges[e + 1]);
      if (d < edge) {
        edge = d;
        ux = edges[e];
        uy = edges[e + 1];
      }
    }
    for (let e = 0; e < rayList.length; e += 2) {
      const rx = rayList[e];
      const ry = rayList[e + 1];
      const side = lx * ry - ly * rx;
      if (lx * rx + ly * ry > 0) {
        // Square to the ray. Only the normal's line matters, not which way it points.
        const d = Math.abs(side);
        if (d < edge) {
          const sign = side > 0 ? 1 : -1;
          edge = d;
          ux = sign * ry;
          uy = -sign * rx;
        }
      } else {
        // Behind the lattice point, the nearest edge point is the point itself.
        const d = Math.sqrt(lx * lx + ly * ly);
        if (d < edge && d > 0) {
          edge = d;
          ux = -lx / d;
          uy = -ly / d;
        }
      }
    }
    paint(dark, band(back(edge, ux, uy), 2 * line, px));

    sumR += r;
    sumG += g;
    sumB += b;
  };

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      sumR = sumG = sumB = 0;
      for (let j = 0; j < ss; j++)
        for (let i = 0; i < ss; i++) {
          const sx = (x + (i + 0.5) / ss - width / 2) * scale;
          const sy = (y + (j + 0.5) / ss - height / 2) * scale;
          shade(ox + sx * oc - sy * os, oy + sx * os + sy * oc);
        }
      const p = (y * width + x) * 4;
      data[p] = Math.round(sumR / (ss * ss));
      data[p + 1] = Math.round(sumG / (ss * ss));
      data[p + 2] = Math.round(sumB / (ss * ss));
      data[p + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
}

export const escherTessellation1: Style = {
  id: "tess1",
  draw,
};
