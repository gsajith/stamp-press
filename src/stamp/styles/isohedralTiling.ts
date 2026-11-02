// Isohedral tiling: one of the 81 isohedral tiling types, its edges bent into seeded curves, filled in three
// flat colors with a thin dark outline, in the manner of Craig Kaplan's Tactile-JS demo (demo/autodemo.js).
// Every tile is a copy of one prototile, so the curves interlock the way Escher's tiles do.
//
// Ported from Tactile-JS (github.com/isohedral/tactile-js): the tiling type tables (isohedralTypes.ts), the
// placement of tiling vertices, edges and aspects from a type's parameters, the tile colouring, and the demo's
// random edge shapes and parameter jitter. The demo draws with p5's filled Bezier paths. Here every pixel is
// computed instead, so the art is resolution independent and its pixels match in every browser and in Node
// (ADR 0001). Only IEEE-exact arithmetic here, with sin and cos from exact.ts.
//
// Tactile-JS
// Copyright 2018 Craig S. Kaplan, csk@uwaterloo.ca
// Distributed under the terms of the 3-clause BSD license. The full notice is in isohedralTypes.ts, and
// applies to the code ported here too.

import { cos, sin } from "../exact";
import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";
import {
  type EdgeShape,
  TILING_TYPES,
  type TilingType,
} from "./isohedralTypes";

type Rgb = [number, number, number];
type Vec = [number, number];
// The top two rows of a 3x3 affine matrix: [a, b, c, d, e, f] maps (x, y) to (a x + b y + c, d x + e y + f).
type Mat = readonly number[];

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

const mul = (A: Mat, B: Mat): Mat => [
  A[0] * B[0] + A[1] * B[3],
  A[0] * B[1] + A[1] * B[4],
  A[0] * B[2] + A[1] * B[5] + A[2],
  A[3] * B[0] + A[4] * B[3],
  A[3] * B[1] + A[4] * B[4],
  A[3] * B[2] + A[4] * B[5] + A[5],
];
const apply = (M: Mat, [x, y]: Vec): Vec => [
  M[0] * x + M[1] * y + M[2],
  M[3] * x + M[4] * y + M[5],
];
// The matrix taking (0, 0) to p and (1, 0) to q, without reflecting.
const matchSeg = ([px, py]: Vec, [qx, qy]: Vec): Mat => [
  qx - px,
  py - qy,
  px,
  qy - py,
  qx - px,
  py,
];

// How a canonical edge, from (0, 0) to (1, 0), is flipped or turned into place: as is, turned a half turn about
// its middle, mirrored across its bisector, or mirrored across its length.
const ORIENTS: readonly Mat[] = [
  [1, 0, 0, 0, 1, 0],
  [-1, 0, 1, 0, -1, 0],
  [-1, 0, 1, 0, 1, 0],
  [1, 0, 0, 0, -1, 0],
];

// A tiling of one type with its parameters set: Tactile's IsohedralTiling, computed once.
export type Tiling = {
  type: TilingType;
  // Translation vectors: the unit of `aspects` tiles repeats along them.
  t1: Vec;
  t2: Vec;
  // The prototile's tiling vertices, and per tiling edge, the matrix that carries the canonical edge into
  // place from vertex k to k + 1, the edge shape it draws, and whether that shape runs backwards.
  vertices: Vec[];
  edges: { T: Mat; id: number; shape: EdgeShape; rev: boolean }[];
  // Where each copy of the prototile in the unit at the origin goes.
  aspects: Mat[];
};

export function makeTiling(
  type: TilingType,
  params: readonly number[] = type.defaultParams,
): Tiling {
  const ps = [...params, 1];
  const n = ps.length;
  const point = (coeffs: readonly number[], at: number): Vec => {
    let [x, y] = [0, 0];
    for (let i = 0; i < n; i++) {
      x += coeffs[at + i] * ps[i];
      y += coeffs[at + n + i] * ps[i];
    }
    return [x, y];
  };
  const matrix = (coeffs: readonly number[], at: number): Mat => {
    const m: number[] = [];
    for (let k = 0; k < 6; k++, at += n) {
      let v = 0;
      for (let i = 0; i < n; i++) v += coeffs[at + i] * ps[i];
      m.push(v);
    }
    return m;
  };
  const vertices = Array.from({ length: type.vertices }, (_, k) =>
    point(type.vertexCoeffs, 2 * n * k),
  );
  const edges = vertices.map((v, k) => {
    const flip = type.edgeOrientations[2 * k];
    const turn = type.edgeOrientations[2 * k + 1];
    const id = type.edgeShapeIds[k];
    return {
      T: mul(
        matchSeg(v, vertices[(k + 1) % vertices.length]),
        ORIENTS[2 * flip + turn],
      ),
      id,
      shape: type.edgeShapes[id],
      rev: flip !== turn,
    };
  });
  const aspects = Array.from({ length: type.aspects }, (_, k) =>
    matrix(type.aspectCoeffs, 6 * n * k),
  );
  return {
    type,
    t1: point(type.translationCoeffs, 0),
    t2: point(type.translationCoeffs, 2 * n),
    vertices,
    edges,
    aspects,
  };
}

// The colour, 0 to 2, of the tile of aspect `asp` in the unit `a` steps along t1 and `b` along t2. Neighbors
// never share one.
export function colour(
  { colouring }: TilingType,
  a: number,
  b: number,
  asp: number,
): number {
  const nc = colouring[18];
  const s = ((a % nc) + nc) % nc;
  const t = ((b % nc) + nc) % nc;
  let c = colouring[asp];
  for (let i = 0; i < s; i++) c = colouring[12 + c];
  for (let i = 0; i < t; i++) c = colouring[15 + c];
  return c;
}

// An edge shape's two Bezier control points, for a cubic from (0, 0) to (1, 0). Null draws it straight.
export type Controls = readonly (readonly [Vec, Vec] | null)[];

// Random control points per edge shape, as the demo draws them, with the bend across the edge scaled by `bend`.
// S edges keep their half-turn symmetry and U edges their mirror symmetry, so the tiles still fit.
export function randomControls(
  tiling: Tiling,
  rand: () => number,
  bend: number,
): Controls {
  return tiling.type.edgeShapes.map((shape) => {
    if (shape === "I") return null;
    const a: Vec = [rand() * 0.6, (rand() - 0.5) * bend];
    if (shape === "J") return [a, [rand() * 0.6 + 0.4, (rand() - 0.5) * bend]];
    return [a, [1 - a[0], shape === "S" ? -a[1] : a[1]]];
  });
}

// Straight segments per curved edge: enough that no facet shows at 2048 px.
const CURVE_STEPS = 24;

// The prototile's outline, as a closed polygon from vertex 0, each edge drawn with its shape's controls.
export function prototile(tiling: Tiling, controls: Controls): Vec[] {
  const out: Vec[] = [tiling.vertices[0]];
  for (const { T, id, rev } of tiling.edges) {
    const c = controls[id];
    if (!c) {
      out.push(apply(T, rev ? [0, 0] : [1, 0]));
      continue;
    }
    const [[ax, ay], [bx, by]] = c;
    for (let k = 1; k <= CURVE_STEPS; k++) {
      // A reversed edge runs the same curve from (1, 0) back to (0, 0).
      const t = rev ? 1 - k / CURVE_STEPS : k / CURVE_STEPS;
      const u = 1 - t;
      const [w1, w2, w3] = [3 * u * u * t, 3 * u * t * t, t * t * t];
      out.push(apply(T, [w1 * ax + w2 * bx + w3, w1 * ay + w2 * by]));
    }
  }
  out.pop(); // back at vertex 0
  return out;
}

// Whether two segments cross at a single point inside both. Touching at an end doesn't count.
function crosses(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

// Whether a polygon's outline never crosses itself. Bent edges can loop or cut through each other.
export function isSimple(poly: readonly Vec[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [a, b] = [poly[i], poly[(i + 1) % n]];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbors around the end
      const [c, d] = [poly[j], poly[(j + 1) % n]];
      if (crosses(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1])) return false;
    }
  }
  return true;
}

// Buckets per side of the grid over one translational unit, in lattice coordinates.
const GRID = 32;

// Where a point lies in a laid-out tiling: its tile's colour and its distance to the nearest tile edge, up to
// the layout's margin, beyond which it's Infinity.
export type Spot = { colour: number; distance: number };

// The tiling laid out for lookups, or null if its tiles overlap, which bent edges can make them do. `margin`
// is how far from an edge distances must be exact, in tiling units.
//
// Every point lies in the unit at the origin plus whole steps along t1 and t2, so only that unit needs a
// layout. It's cut into a grid of buckets, each listing the tile outline segments within `margin` of it and
// which tile holds its center. A point's tile is then its bucket center's tile, updated at each outline its
// walk from the center crosses, and its distance the nearest segment in the bucket.
export function layOut(
  tiling: Tiling,
  outline: readonly Vec[],
  margin: number,
): { at(x: number, y: number, out: Spot): void } | null {
  const { type, t1, t2 } = tiling;
  const det = t1[0] * t2[1] - t1[1] * t2[0];
  // Lattice coordinates (a, b) of a point: a = (x, y) . A, b = (x, y) . B.
  const A: Vec = [t2[1] / det, -t2[0] / det];
  const B: Vec = [-t1[1] / det, t1[0] / det];
  const lat = ([x, y]: Vec): Vec => [x * A[0] + y * A[1], x * B[0] + y * B[1]];
  // A margin in tiling units, as a margin in each lattice coordinate.
  const marginA = margin * Math.sqrt(A[0] * A[0] + A[1] * A[1]);
  const marginB = margin * Math.sqrt(B[0] * B[0] + B[1] * B[1]);

  // Every tile that reaches the unit at the origin, padded by the margin: each aspect's copy of the
  // prototile, moved by every translation that brings it close.
  const tiles: { poly: Vec[]; a: number; b: number; asp: number }[] = [];
  tiling.aspects.forEach((M, asp) => {
    const poly = outline.map((p) => apply(M, p));
    const ls = poly.map(lat);
    const [aMin, aMax] = [
      Math.min(...ls.map((l) => l[0])),
      Math.max(...ls.map((l) => l[0])),
    ];
    const [bMin, bMax] = [
      Math.min(...ls.map((l) => l[1])),
      Math.max(...ls.map((l) => l[1])),
    ];
    for (
      let a = Math.ceil(-marginA - aMax);
      a <= Math.floor(1 + marginA - aMin);
      a++
    )
      for (
        let b = Math.ceil(-marginB - bMax);
        b <= Math.floor(1 + marginB - bMin);
        b++
      ) {
        const [dx, dy] = [a * t1[0] + b * t2[0], a * t1[1] + b * t2[1]];
        tiles.push({ poly: poly.map(([x, y]) => [x + dx, y + dy]), a, b, asp });
      }
  });

  // Bucket centers in lattice coordinates, nudged off the grid's round fractions so they don't sit exactly on
  // a straight edge.
  const centerU = (i: number) => (i + 0.5137) / GRID;
  const centerV = (j: number) => (j + 0.4781) / GRID;

  // Which tile holds each bucket center, found row by row: where each tile's outline crosses the row, in
  // pairs, bounds the stretches of the row inside it.
  const lats = tiles.map(({ poly }) => poly.map(lat));
  const rows: number[][] = Array.from({ length: GRID }, () => []);
  lats.forEach((ls, t) => {
    for (let s = 0; s < ls.length; s++) {
      const [p, q] = [ls[s], ls[(s + 1) % ls.length]];
      const [lo, hi] = p[1] < q[1] ? [p, q] : [q, p];
      for (
        let j = Math.max(0, Math.ceil(lo[1] * GRID - 0.4781));
        j < GRID && centerV(j) < hi[1];
        j++
      ) {
        const v = centerV(j);
        if (v < lo[1]) continue;
        rows[j].push(
          t,
          lo[0] + ((v - lo[1]) * (hi[0] - lo[0])) / (hi[1] - lo[1]),
        );
      }
    }
  });
  const centerTile = new Int32Array(GRID * GRID).fill(-1);
  for (let j = 0; j < GRID; j++) {
    const row = rows[j];
    const order = Array.from({ length: row.length / 2 }, (_, n) => n).sort(
      (m, n) => row[2 * m] - row[2 * n] || row[2 * m + 1] - row[2 * n + 1],
    );
    for (let n = 0; n + 1 < order.length; n += 2) {
      const [m0, m1] = [order[n], order[n + 1]];
      const t = row[2 * m0];
      if (row[2 * m1] !== t) return null; // an odd crossing count: a tile that isn't closed
      for (
        let i = Math.max(0, Math.ceil(row[2 * m0 + 1] * GRID - 0.5137));
        i < GRID && centerU(i) < row[2 * m1 + 1];
        i++
      ) {
        if (centerU(i) < row[2 * m0 + 1]) continue;
        const k = j * GRID + i;
        if (centerTile[k] >= 0) return null; // two tiles overlap here
        centerTile[k] = t;
      }
    }
  }
  if (centerTile.includes(-1)) return null; // a gap
  const centerX = new Float64Array(GRID * GRID);
  const centerY = new Float64Array(GRID * GRID);
  for (let j = 0; j < GRID; j++)
    for (let i = 0; i < GRID; i++) {
      const [u, v] = [centerU(i), centerV(j)];
      centerX[j * GRID + i] = u * t1[0] + v * t2[0];
      centerY[j * GRID + i] = u * t1[1] + v * t2[1];
    }

  // The segments near each bucket, as tile and segment index pairs.
  const near: number[][] = Array.from({ length: GRID * GRID }, () => []);
  tiles.forEach(({ poly }, t) => {
    const ls = lats[t];
    for (let s = 0; s < poly.length; s++) {
      const [p, q] = [ls[s], ls[(s + 1) % poly.length]];
      const i0 = Math.max(
        0,
        Math.floor((Math.min(p[0], q[0]) - marginA) * GRID),
      );
      const i1 = Math.min(
        GRID - 1,
        Math.floor((Math.max(p[0], q[0]) + marginA) * GRID),
      );
      const j0 = Math.max(
        0,
        Math.floor((Math.min(p[1], q[1]) - marginB) * GRID),
      );
      const j1 = Math.min(
        GRID - 1,
        Math.floor((Math.max(p[1], q[1]) + marginB) * GRID),
      );
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) near[j * GRID + i].push(t, s);
    }
  });

  // Flattened for speed. Per bucket: its segments' endpoints, and per segment its tile's slot among the
  // bucket's tiles, which are listed with whether each holds the bucket's center.
  const start = new Int32Array(GRID * GRID + 1);
  for (let k = 0; k < GRID * GRID; k++)
    start[k + 1] = start[k] + near[k].length / 2;
  const seg = new Float64Array(start[GRID * GRID] * 4);
  const segSlot = new Uint8Array(start[GRID * GRID]);
  const slotStart = new Int32Array(GRID * GRID + 1);
  const slotTiles: number[] = [];
  const slotInside: number[] = [];
  for (let k = 0; k < GRID * GRID; k++) {
    const slots = [centerTile[k]];
    const list = near[k];
    for (let n = 0; n < list.length; n += 2) {
      const [t, s] = [list[n], list[n + 1]];
      const poly = tiles[t].poly;
      const [p, q] = [poly[s], poly[(s + 1) % poly.length]];
      const at = start[k] + n / 2;
      seg.set([p[0], p[1], q[0], q[1]], at * 4);
      let slot = slots.indexOf(t);
      if (slot < 0) slot = slots.push(t) - 1;
      segSlot[at] = slot;
    }
    slotStart[k + 1] = slotStart[k] + slots.length;
    for (const t of slots) {
      slotTiles.push(t);
      slotInside.push(t === centerTile[k] ? 1 : 0);
    }
  }
  const colours = tiles.map(({ a, b, asp }) => [a, b, asp]);
  const parity = new Uint8Array(256);

  return {
    at(x, y, out) {
      const a = x * A[0] + y * A[1];
      const b = x * B[0] + y * B[1];
      const fa = Math.floor(a);
      const fb = Math.floor(b);
      const [u, v] = [a - fa, b - fb];
      const k =
        Math.min(GRID - 1, Math.floor(v * GRID)) * GRID +
        Math.min(GRID - 1, Math.floor(u * GRID));
      // The point, moved into the unit at the origin.
      const px = u * t1[0] + v * t2[0];
      const py = u * t1[1] + v * t2[1];
      let tile = centerTile[k];
      let best = Infinity;
      const [s0, s1] = [start[k], start[k + 1]];
      if (s1 > s0) {
        const [cx, cy] = [centerX[k], centerY[k]];
        const slots = slotStart[k + 1] - slotStart[k];
        parity.fill(0, 0, slots);
        for (let s = s0; s < s1; s++) {
          const p = s * 4;
          const [ax, ay, bx, by] = [seg[p], seg[p + 1], seg[p + 2], seg[p + 3]];
          const [ex, ey] = [bx - ax, by - ay];
          const len2 = ex * ex + ey * ey;
          let t = len2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / len2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const [dx, dy] = [ax + t * ex - px, ay + t * ey - py];
          const d2 = dx * dx + dy * dy;
          if (d2 < best) best = d2;
          // Whether the walk from the center crosses this segment, counting an end on the walk's line once.
          const sa = (px - cx) * (ay - cy) - (py - cy) * (ax - cx) > 0;
          const sb = (px - cx) * (by - cy) - (py - cy) * (bx - cx) > 0;
          if (sa !== sb) {
            const sc = ex * (cy - ay) - ey * (cx - ax) > 0;
            const sp = ex * (py - ay) - ey * (px - ax) > 0;
            if (sc !== sp) parity[segSlot[s]] ^= 1;
          }
        }
        for (let n = 0; n < slots; n++)
          if ((slotInside[slotStart[k] + n] ^ parity[n]) === 1) {
            tile = slotTiles[slotStart[k] + n];
            break;
          }
        best = best <= margin * margin ? Math.sqrt(best) : Infinity;
      }
      const [ta, tb, asp] = colours[tile];
      out.colour = colour(type, ta + fa, tb + fb, asp);
      out.distance = best;
    },
  };
}

// The tiling types a press picks from: the 72 with an edge that can bend. The other nine are plain triangles,
// squares, hexagons, rhombi and stars, which read as geometry rather than interlocking tiles.
const TYPES = TILING_TYPES.filter((t) => t.edgeShapes.some((e) => e !== "I"));

// How round a polygon is, 4 pi area / perimeter squared: 1 for a circle, about 0.79 for a square, near 0 for a
// sliver. The demo's parameter jitter flattens a few types' tiles to under 0.05.
export function roundness(poly: readonly Vec[]): number {
  let [area, perimeter] = [0, 0];
  for (let i = 0; i < poly.length; i++) {
    const [[ax, ay], [bx, by]] = [poly[i], poly[(i + 1) % poly.length]];
    area += ax * by - ay * bx;
    perimeter += Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
  }
  return (2 * Math.PI * Math.abs(area)) / (perimeter * perimeter);
}
// Jittered tiles rounder than this keep their jitter: an equilateral triangle is 0.6.
const MIN_ROUNDNESS = 0.4;

// How much of a sample `px` wide a band covers, the band being where the distance `d` is within `w` / 2 of 0.
function band(d: number, w: number, px: number): number {
  const overlap = Math.min(d + px / 2, w / 2) - Math.max(d - px / 2, -w / 2);
  return overlap > 0 ? Math.min(1, overlap / px) : 0;
}

// Small draws are supersampled until the art's short side has this many samples, so outlines finer than a
// pixel average out the way they would in a large draw scaled down.
const MIN_UNIT = 160;
// The outline's width, as a fraction of the art's short side: about 1.2 pixels on a desk stamp.
const LINE = 0.0065;
// Attempts at bent edges that keep the tiles apart, before the edges go straight.
const TRIES = 8;

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const type = TYPES[Math.floor(rand() * TYPES.length)];
  // The demo's jitter of the type's parameters, unless it pushes a tiling vertex across an edge or squeezes the
  // tile into a sliver.
  const jittered = makeTiling(
    type,
    type.defaultParams.map((p) => p + rand() * 0.3 - 0.15),
  );
  const straight = prototile(jittered, []);
  const tiling =
    isSimple(straight) && roundness(straight) >= MIN_ROUNDNESS
      ? jittered
      : makeTiling(type);

  // The tiling's place on the stamp: how many tiles span the short side, a turn and an offset.
  const area =
    Math.abs(tiling.t1[0] * tiling.t2[1] - tiling.t1[1] * tiling.t2[0]) /
    type.aspects;
  const span = (2.6 + 1.6 * rand()) * Math.sqrt(area); // tiling units across the short side
  const theta = rand() * 2 * Math.PI;
  const [oc, os] = [cos(theta), sin(theta)];
  const [ox, oy] = [rand() * 10, rand() * 10];
  const line = LINE * span;
  // Distances matter out to the outline plus the largest sample, whatever the draw's size.
  const margin = line / 2 + span / MIN_UNIT;

  // Bent edges, redrawn when they make a tile cross itself or overlap a neighbor, and bent less each time.
  let layout: ReturnType<typeof layOut> = null;
  for (let n = 0; n < TRIES && !layout; n++) {
    const outline = prototile(
      tiling,
      randomControls(tiling, rand, 1 - n / TRIES),
    );
    if (isSimple(outline)) layout = layOut(tiling, outline, margin);
  }
  layout ??= layOut(tiling, prototile(tiling, []), margin)!;

  // Three fills from the lighter inks, the paper and a tint between, and sometimes the darkest ink for dark
  // tiles among light ones. The outline prints in the darkest ink.
  const paperRgb = rgb(paper);
  const dark = rgb(inks[0]);
  const light = inks.slice(1).map(rgb);
  const pool: Rgb[] = [...light, paperRgb];
  if (pool.length < 3) pool.push(mix(light[0], paperRgb, 0.5));
  for (let n = pool.length - 1; n > 0; n--) {
    const m = Math.floor(rand() * (n + 1));
    [pool[n], pool[m]] = [pool[m], pool[n]];
  }
  const fills = pool.slice(0, 3);
  if (rand() < 0.25) fills[Math.floor(rand() * 3)] = dark;

  const unit = Math.min(width, height);
  const scale = span / unit; // tiling units per pixel
  const ss = Math.ceil(MIN_UNIT / unit);
  const px = scale / ss; // a sample's size in tiling units

  const spot: Spot = { colour: 0, distance: 0 };
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let [r, g, b] = [0, 0, 0];
      for (let j = 0; j < ss; j++)
        for (let i = 0; i < ss; i++) {
          const sx = (x + (i + 0.5) / ss - width / 2) * scale;
          const sy = (y + (j + 0.5) / ss - height / 2) * scale;
          layout.at(ox + sx * oc - sy * os, oy + sx * os + sy * oc, spot);
          const fill = fills[spot.colour];
          const t = spot.distance < margin ? band(spot.distance, line, px) : 0;
          r += fill[0] + (dark[0] - fill[0]) * t;
          g += fill[1] + (dark[1] - fill[1]) * t;
          b += fill[2] + (dark[2] - fill[2]) * t;
        }
      const p = (y * width + x) * 4;
      data[p] = Math.round(r / (ss * ss));
      data[p + 1] = Math.round(g / (ss * ss));
      data[p + 2] = Math.round(b / (ss * ss));
      data[p + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
}

export const isohedralTiling1: Style = {
  id: "isotile1",
  draw,
};
