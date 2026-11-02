import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Hat monotile: a patch of the 2023 aperiodic hat tiling, built by substitution, cropped to the frame and
// outlined, with each hat filled by its metatile or its orientation and the reflected hats in their own ink.
// Some stamps also draw the metatile outlines over the hats, as hatviz does. Ported from hatviz
// (github.com/isohedral/hatviz), under its license:
//
//   BSD 3-Clause License
//
//   Copyright (c) 2023, Craig S. Kaplan
//
//   Redistribution and use in source and binary forms, with or without
//   modification, are permitted provided that the following conditions are met:
//
//   1. Redistributions of source code must retain the above copyright notice, this
//      list of conditions and the following disclaimer.
//
//   2. Redistributions in binary form must reproduce the above copyright notice,
//      this list of conditions and the following disclaimer in the documentation
//      and/or other materials provided with the distribution.
//
//   3. Neither the name of the copyright holder nor the names of its
//      contributors may be used to endorse or promote products derived from
//      this software without specific prior written permission.
//
//   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
//   AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
//   IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
//   DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
//   FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
//   DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
//   SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
//   CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
//   OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
//   OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//
// The geometry (the hat, the four level-1 metatiles, the patch rules and the supertile step) is the original's,
// with its turns by 60 and 120 degrees written out instead of taken from Math.cos and Math.sin. The original
// draws with p5 strokes. Here each pixel takes the exact area of every fill and outline under it, so the
// picture matches at any size and in every browser and Node (ADR 0001).

// An affine map [a, b, c, d, e, f]: (x, y) to (a x + b y + c, d x + e y + f).
type Mat = readonly [number, number, number, number, number, number];
type Pt = { x: number; y: number };

const HR3 = 0.8660254037844386; // sqrt(3) / 2
const IDENT: Mat = [1, 0, 0, 0, 1, 0];

const pt = (x: number, y: number): Pt => ({ x, y });
const hexPt = (x: number, y: number) => pt(x + 0.5 * y, HR3 * y);

function inv(T: Mat): Mat {
  const det = T[0] * T[4] - T[1] * T[3];
  return [
    T[4] / det,
    -T[1] / det,
    (T[1] * T[5] - T[2] * T[4]) / det,
    -T[3] / det,
    T[0] / det,
    (T[2] * T[3] - T[0] * T[5]) / det,
  ];
}

function mul(A: Mat, B: Mat): Mat {
  return [
    A[0] * B[0] + A[1] * B[3],
    A[0] * B[1] + A[1] * B[4],
    A[0] * B[2] + A[1] * B[5] + A[2],
    A[3] * B[0] + A[4] * B[3],
    A[3] * B[1] + A[4] * B[4],
    A[3] * B[2] + A[4] * B[5] + A[5],
  ];
}

const padd = (p: Pt, q: Pt) => pt(p.x + q.x, p.y + q.y);
const psub = (p: Pt, q: Pt) => pt(p.x - q.x, p.y - q.y);
const ttrans = (x: number, y: number): Mat => [1, 0, x, 0, 1, y];
const transPt = (M: Mat, p: Pt) =>
  pt(M[0] * p.x + M[1] * p.y + M[2], M[3] * p.x + M[4] * p.y + M[5]);
// Turns by -60 and -120 degrees.
const TURN_60: Mat = [0.5, HR3, 0, -HR3, 0.5, 0];
const TURN_120: Mat = [-0.5, HR3, 0, -HR3, -0.5, 0];
const turnAbout = (p: Pt, turn: Mat) =>
  mul(ttrans(p.x, p.y), mul(turn, ttrans(-p.x, -p.y)));

// The map taking the unit interval to the segment p to q, turning and scaling.
const matchSeg = (p: Pt, q: Pt): Mat => [
  q.x - p.x,
  p.y - q.y,
  p.x,
  q.y - p.y,
  q.x - p.x,
  p.y,
];
// The map taking segment p1 to q1 onto segment p2 to q2.
const matchTwo = (p1: Pt, q1: Pt, p2: Pt, q2: Pt) =>
  mul(matchSeg(p2, q2), inv(matchSeg(p1, q1)));

// Where the lines through p1, q1 and p2, q2 cross.
function intersect(p1: Pt, q1: Pt, p2: Pt, q2: Pt): Pt {
  const d = (q2.y - p2.y) * (q1.x - p1.x) - (q2.x - p2.x) * (q1.y - p1.y);
  const u = ((q2.x - p2.x) * (p1.y - p2.y) - (q2.y - p2.y) * (p1.x - p2.x)) / d;
  return pt(p1.x + u * (q1.x - p1.x), p1.y + u * (q1.y - p1.y));
}

// The hat: eight kites of a hexagon grid.
const HAT: readonly Pt[] = [
  hexPt(0, 0),
  hexPt(-1, -1),
  hexPt(0, -2),
  hexPt(2, -2),
  hexPt(2, -1),
  hexPt(4, -2),
  hexPt(5, -1),
  hexPt(4, 0),
  hexPt(3, 0),
  hexPt(2, 2),
  hexPt(0, 3),
  hexPt(0, 2),
  hexPt(-1, 2),
];

// A hat's label: the metatile that placed it. H1 is the H metatile's odd hat, the only reflected one.
type Label = "H1" | "H" | "T" | "P" | "F";

// A metatile: its outline, and its children placed by maps, each a smaller metatile or a hat. `box` bounds its
// outline and everything inside it, outlines and hats, as [x0, y0, x1, y1], so a draw can skip metatiles off
// the frame.
type Meta = { shape: Pt[]; children: Child[]; box: number[] };
type Child = { T: Mat; geom: Label | Meta };

// The box around `points`.
function bounds(points: readonly Pt[]) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { x, y } of points) {
    box[0] = Math.min(box[0], x);
    box[1] = Math.min(box[1], y);
    box[2] = Math.max(box[2], x);
    box[3] = Math.max(box[3], y);
  }
  return box;
}

// The four corners of a box, taken through T.
const corners = (T: Mat, [x0, y0, x1, y1]: number[]) =>
  [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)].map((p) => transPt(T, p));

function meta(shape: Pt[], children: Child[]): Meta {
  const points = children.flatMap(({ T, geom }) =>
    typeof geom === "string"
      ? HAT.map((p) => transPt(T, p))
      : corners(T, geom.box),
  );
  return { shape, children, box: bounds([...shape, ...points]) };
}

// Moves a metatile so its outline's vertex average sits at the origin, as the original does.
function recentre({ shape, children }: Meta): Meta {
  let [cx, cy] = [0, 0];
  for (const p of shape) [cx, cy] = [cx + p.x, cy + p.y];
  const M = ttrans(-cx / shape.length, -cy / shape.length);
  return meta(
    shape.map((p) => transPt(M, p)),
    children.map(({ T, geom }) => ({ T: mul(M, T), geom })),
  );
}

// The original's four level-1 metatiles, H, T, P and F.
function firstTiles(): Meta[] {
  const Ho = [
    pt(0, 0),
    pt(4, 0),
    pt(4.5, HR3),
    pt(2.5, 5 * HR3),
    pt(1.5, 5 * HR3),
    pt(-0.5, HR3),
  ];
  const H = meta(Ho, [
    { T: matchTwo(HAT[5], HAT[7], Ho[5], Ho[0]), geom: "H" },
    { T: matchTwo(HAT[9], HAT[11], Ho[1], Ho[2]), geom: "H" },
    { T: matchTwo(HAT[5], HAT[7], Ho[3], Ho[4]), geom: "H" },
    {
      T: mul(
        ttrans(2.5, HR3),
        mul([-0.5, -HR3, 0, HR3, -0.5, 0], [0.5, 0, 0, 0, -0.5, 0]),
      ),
      geom: "H1",
    },
  ]);
  const T = meta(
    [pt(0, 0), pt(3, 0), pt(1.5, 3 * HR3)],
    [{ T: [0.5, 0, 0.5, 0, 0.5, HR3], geom: "T" }],
  );
  const pair = (label: Label): Child[] => [
    { T: [0.5, 0, 1.5, 0, 0.5, HR3], geom: label },
    {
      T: mul(
        ttrans(0, 2 * HR3),
        mul([0.5, HR3, 0, -HR3, 0.5, 0], [0.5, 0, 0, 0, 0.5, 0]),
      ),
      geom: label,
    },
  ];
  const P = meta(
    [pt(0, 0), pt(4, 0), pt(3, 2 * HR3), pt(-1, 2 * HR3)],
    pair("P"),
  );
  const F = meta(
    [pt(0, 0), pt(3, 0), pt(3.5, HR3), pt(3, 2 * HR3), pt(-1, 2 * HR3)],
    pair("F"),
  );
  return [H, T, P, F];
}

// The original's patch rules, each placing one metatile against those already placed. [n, i, shape, j] lays
// the new shape's edge j along child n's edge i. [n, i, m, k, shape, j] lays it along the segment from child m's
// vertex k to child n's vertex i.
const RULES: readonly (readonly (number | string)[])[] = [
  ["H"],
  [0, 0, "P", 2],
  [1, 0, "H", 2],
  [2, 0, "P", 2],
  [3, 0, "H", 2],
  [4, 4, "P", 2],
  [0, 4, "F", 3],
  [2, 4, "F", 3],
  [4, 1, 3, 2, "F", 0],
  [8, 3, "H", 0],
  [9, 2, "P", 0],
  [10, 2, "H", 0],
  [11, 4, "P", 2],
  [12, 0, "H", 2],
  [13, 0, "F", 3],
  [14, 2, "F", 1],
  [15, 3, "H", 4],
  [8, 2, "F", 1],
  [17, 3, "H", 0],
  [18, 2, "P", 0],
  [19, 2, "H", 2],
  [20, 4, "F", 3],
  [20, 0, "P", 2],
  [22, 0, "H", 2],
  [23, 4, "F", 3],
  [23, 0, "F", 3],
  [16, 0, "P", 2],
  [9, 4, 0, 2, "T", 2],
  [4, 0, "F", 3],
];

// The original's constructPatch: 29 metatiles of one level laid out by the rules.
function patch([H, T, P, F]: Meta[]): Child[] {
  const shapes: Record<string, Meta> = { H, T, P, F };
  const placed: Child[] = [];
  const vertex = (n: number, i: number) => {
    const { T, geom } = placed[n];
    const { shape } = geom as Meta;
    return transPt(T, shape[i % shape.length]);
  };
  for (const r of RULES) {
    if (r.length === 1) {
      placed.push({ T: IDENT, geom: shapes[r[0]] });
      continue;
    }
    const next = shapes[r[r.length - 2]];
    const [n, i] = [r[0] as number, r[1] as number];
    const [p, q] =
      r.length === 4
        ? [vertex(n, i + 1), vertex(n, i)]
        : [vertex(r[2] as number, r[3] as number), vertex(n, i)];
    const j = r[r.length - 1] as number;
    const s = next.shape;
    placed.push({
      T: matchTwo(s[j], s[(j + 1) % s.length], p, q),
      geom: next,
    });
  }
  return placed;
}

// The original's constructMetatiles: the next level's four metatiles, cut from a patch of this level's.
function supertiles(placed: Child[]): Meta[] {
  const at = (n: number, i: number) =>
    transPt(placed[n].T, (placed[n].geom as Meta).shape[i]);
  const pick = (ids: number[]) => ids.map((n) => placed[n]);
  const bps1 = at(8, 2);
  const bps2 = at(21, 2);
  const rbps = transPt(turnAbout(bps1, TURN_120), bps2);
  const p72 = at(7, 2);
  const p252 = at(25, 2);
  const llc = intersect(bps1, rbps, at(6, 2), p72);
  let w = psub(at(6, 2), llc);

  const hOutline = [llc, bps1];
  w = transPt(TURN_60, w);
  hOutline.push(padd(hOutline[1], w));
  hOutline.push(at(14, 2));
  w = transPt(TURN_60, w);
  hOutline.push(psub(hOutline[3], w));
  hOutline.push(at(6, 2));
  const H = meta(hOutline, pick([0, 9, 16, 27, 26, 6, 1, 8, 10, 15]));

  const P = meta(
    [p72, padd(p72, psub(bps1, llc)), bps1, llc],
    pick([7, 2, 3, 4, 28]),
  );
  const F = meta(
    [bps2, at(24, 2), at(25, 0), p252, padd(p252, psub(llc, bps1))],
    pick([21, 20, 22, 23, 24, 25]),
  );
  const a = hOutline[2];
  const b = padd(hOutline[1], psub(hOutline[4], hOutline[5]));
  const c = transPt(turnAbout(b, TURN_60), a);
  const T = meta([b, c, a], pick([11]));
  return [H, T, P, F].map(recentre);
}

// The H supertile at each level, 1 being the original's first tiles: built once, then shared by every draw.
const LEVELS: Meta[] = [];
function hTile(level: number): Meta {
  if (LEVELS.length === 0) {
    let tiles = firstTiles();
    LEVELS.push(tiles[0]);
    for (let l = 2; l <= TOP; l++) {
      tiles = supertiles(patch(tiles));
      LEVELS.push(tiles[0]);
    }
  }
  return LEVELS[level - 1];
}

// The deepest level drawn. A level-5 H supertile's hats cover a disc of radius 65 around CENTER, in hat-grid
// units (found by sampling), so a frame fits anywhere its corners stay within CENTER_ROOM of it.
const TOP = 5;
const CENTER = pt(-6, 5.5);
const CENTER_ROOM = 64;
// The art's longest side over its shortest, at most: a portrait stamp with the widest margin, about 0.56 by 0.78.
const LONGEST = 1.45;

type Hat = { label: Label; T: Mat };

// Every hat of the H supertile at `level`, in its own coordinates. Tests check the port with it.
export function hatPatch(level: number): Hat[] {
  const hats: Hat[] = [];
  walk(hTile(level), level, IDENT, () => true, hats, []);
  return hats;
}

// A metatile's outline: `level` 0 is the first metatiles, 1 the first supertiles, and so on.
type Outline = { level: number; points: Pt[] };

// Walks a metatile at `level` down to its hats, taking each through S, and collects the outlines of the
// metatiles on the way. `visible` gets each metatile's box corners through S, and skips it when false.
function walk(
  m: Meta,
  level: number,
  S: Mat,
  visible: (corners: Pt[]) => boolean,
  hats: Hat[],
  outlines: Outline[],
) {
  if (!visible(corners(S, m.box))) return;
  outlines.push({
    level: level - 1,
    points: m.shape.map((p) => transPt(S, p)),
  });
  for (const { T, geom } of m.children) {
    const ST = mul(S, T);
    if (typeof geom === "string") hats.push({ label: geom, T: ST });
    else walk(geom, level - 1, ST, visible, hats, outlines);
  }
}

// Exact-area rasterizing, after the accumulation scheme in font-rs (Raph Levien): each polygon edge adds the
// signed area it sweeps to the cells it crosses, and a running sum along each row turns that into coverage.
// Only + - * /, floor and ceil, so the pixels are the same everywhere. A canvas is drawn in strips of rows,
// and each strip accumulates one color layer at a time.

const STRIP = 32;

// Polygons as flat [x0, y0, x1, y1, ...] lists in pixels, all in one color.
type Layer = { polys: number[][]; color: Rgb };

// Adds the area under one piece of an edge within a row, from x = a to x = b (both in [0, width]), with
// height d (signed), to the row's cells starting at `o`.
function cell(acc: Float64Array, o: number, a: number, b: number, d: number) {
  const [x0, x1] = a < b ? [a, b] : [b, a];
  const i0 = Math.floor(x0);
  const i1 = Math.ceil(x1);
  if (i1 <= i0 + 1) {
    const xm = 0.5 * (x0 + x1) - i0;
    acc[o + i0] += d * (1 - xm);
    acc[o + i0 + 1] += d * xm;
    return;
  }
  const s = 1 / (x1 - x0);
  const f0 = x0 - i0;
  const a0 = 0.5 * s * (1 - f0) * (1 - f0);
  const f1 = x1 - i1 + 1;
  const am = 0.5 * s * f1 * f1;
  acc[o + i0] += d * a0;
  if (i1 === i0 + 2) acc[o + i0 + 1] += d * (1 - a0 - am);
  else {
    const a1 = s * (1.5 - f0);
    acc[o + i0 + 1] += d * (a1 - a0);
    for (let i = i0 + 2; i < i1 - 1; i++) acc[o + i] += d * s;
    const a2 = a1 + (i1 - i0 - 3) * s;
    acc[o + i1 - 1] += d * (1 - a2 - am);
  }
  acc[o + i1] += d * am;
}

// Adds one piece of an edge within a row, clipping it to [0, width]: left of the canvas it runs down the left
// edge instead, which covers the same cells, and right of it, it covers none.
function span(
  acc: Float64Array,
  o: number,
  width: number,
  a: number,
  b: number,
  d: number,
) {
  for (const edge of [0, width])
    if ((a < edge && b > edge) || (a > edge && b < edge)) {
      const t = (edge - a) / (b - a);
      span(acc, o, width, a, edge, d * t);
      span(acc, o, width, edge, b, d * (1 - t));
      return;
    }
  if (a >= width && b >= width) return;
  cell(acc, o, Math.max(a, 0), Math.max(b, 0), d);
}

// Adds a polygon's edges to `acc`, which holds rows y0 to y0 + rows, `stride` cells each.
function polygon(
  acc: Float64Array,
  stride: number,
  width: number,
  y0: number,
  rows: number,
  p: number[],
) {
  const n = p.length;
  for (let k = 0; k < n; k += 2) {
    let [ax, ay, bx, by] = [p[k], p[k + 1], p[(k + 2) % n], p[(k + 3) % n]];
    if (ay === by) continue;
    let dir = 1;
    if (ay > by) {
      [ax, ay, bx, by] = [bx, by, ax, ay];
      dir = -1;
    }
    const top = Math.max(ay, y0);
    const bottom = Math.min(by, y0 + rows);
    if (top >= bottom) continue;
    const dxdy = (bx - ax) / (by - ay);
    for (let y = Math.floor(top); y < bottom; y++) {
      const ya = Math.max(y, top);
      const yb = Math.min(y + 1, bottom);
      const xa = ax + (ya - ay) * dxdy;
      const xb = ax + (yb - ay) * dxdy;
      span(acc, (y - y0) * stride, width, xa, xb, dir * (yb - ya));
    }
  }
}

// Draws `fills` on paper, then each of `overs` over them, into `image`. Within a layer, polygons all wind the same
// way, or the other way to cut a hole, and areas add, so a layer's polygons mustn't overlap. Across `fills`
// colors add by coverage too, and paper takes what's left. Each of `overs` mixes over what's below.
function rasterize(
  width: number,
  height: number,
  paper: Rgb,
  fills: Layer[],
  overs: Layer[],
  image: ImageData,
) {
  const stride = width + 2;
  const acc = new Float64Array(stride * STRIP);
  const rgb = new Float64Array(width * STRIP * 3);
  const covered = new Float64Array(width * STRIP);
  const data = image.data;
  // Each polygon's top and bottom, so a strip only visits the polygons crossing it.
  const ranges = new Map<number[], [number, number]>();
  for (const { polys } of [...fills, ...overs])
    for (const p of polys) {
      let [lo, hi] = [Infinity, -Infinity];
      for (let k = 1; k < p.length; k += 2)
        [lo, hi] = [Math.min(lo, p[k]), Math.max(hi, p[k])];
      ranges.set(p, [lo, hi]);
    }

  // Accumulates a layer's polygons crossing the strip, and calls `paint` with each pixel's coverage.
  const layer = (
    { polys }: Layer,
    y0: number,
    rows: number,
    paint: (i: number, cover: number) => void,
  ) => {
    acc.fill(0);
    let any = false;
    for (const p of polys) {
      const [lo, hi] = ranges.get(p)!;
      if (hi <= y0 || lo >= y0 + rows) continue;
      polygon(acc, stride, width, y0, rows, p);
      any = true;
    }
    if (!any) return;
    for (let r = 0; r < rows; r++) {
      let sum = 0;
      for (let x = 0; x < width; x++) {
        sum += acc[r * stride + x];
        const cover = Math.min(1, Math.abs(sum));
        if (cover > 0) paint(r * width + x, cover);
      }
    }
  };

  for (let y0 = 0; y0 < height; y0 += STRIP) {
    const rows = Math.min(STRIP, height - y0);
    rgb.fill(0);
    covered.fill(0);
    for (const fill of fills) {
      const [r, g, b] = fill.color;
      layer(fill, y0, rows, (i, cover) => {
        rgb[3 * i] += r * cover;
        rgb[3 * i + 1] += g * cover;
        rgb[3 * i + 2] += b * cover;
        covered[i] += cover;
      });
    }
    for (let i = 0; i < rows * width; i++) {
      const rest = Math.max(0, 1 - covered[i]);
      rgb[3 * i] += paper[0] * rest;
      rgb[3 * i + 1] += paper[1] * rest;
      rgb[3 * i + 2] += paper[2] * rest;
    }
    for (const over of overs) {
      const [r, g, b] = over.color;
      layer(over, y0, rows, (i, cover) => {
        rgb[3 * i] += (r - rgb[3 * i]) * cover;
        rgb[3 * i + 1] += (g - rgb[3 * i + 1]) * cover;
        rgb[3 * i + 2] += (b - rgb[3 * i + 2]) * cover;
      });
    }
    for (let i = 0; i < rows * width; i++) {
      const o = 4 * (y0 * width + i);
      data[o] = Math.round(rgb[3 * i]);
      data[o + 1] = Math.round(rgb[3 * i + 1]);
      data[o + 2] = Math.round(rgb[3 * i + 2]);
      data[o + 3] = 255;
    }
  }
}

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

// A polygon, flat in pixels, moved in by `d` along every edge, with mitered corners. Outlines are drawn as the
// band between a tile and its inset: tiles don't overlap, so neither do their bands, and every pixel gets the
// exact share of outline over it. A line along an edge two tiles share is `d` from each, so `2 d` wide.
export function inset(points: number[], d: number): number[] {
  const n = points.length;
  const side = area(points) > 0 ? d : -d;
  // Each edge's inward normal, `d` long.
  const normals: number[] = [];
  for (let k = 0; k < n; k += 2) {
    const dx = points[(k + 2) % n] - points[k];
    const dy = points[(k + 3) % n] - points[k + 1];
    const len = Math.sqrt(dx * dx + dy * dy);
    normals.push((-dy / len) * side, (dx / len) * side);
  }
  const out: number[] = [];
  for (let k = 0; k < n; k += 2) {
    const j = (k - 2 + n) % n;
    const [ax, ay, bx, by] = [
      normals[j],
      normals[j + 1],
      normals[k],
      normals[k + 1],
    ];
    // Where the two moved edges meet: along the normals' sum, stretched by the corner's miter.
    const m = (d * d) / (d * d + ax * bx + ay * by);
    out.push(points[k] + (ax + bx) * m, points[k + 1] + (ay + by) * m);
  }
  return out;
}

// The frame's short side, in hat-grid units, as a range: from about 5 hats across to about 12.
const ACROSS = [12, 30];
// An outline's half width, as a share of the art's short side: the hats', so they draw lines about 1.1 px wide at
// desk size, and the metatiles', which hatviz draws twice as wide. Hatviz also draws each level of supertiles
// wider again, but those outlines cross the metatiles' at slight angles, and thick ones turn into dark wedges
// at stamp size, so they're left out.
const HAT_HALF = 0.0029;
const META_HALF = 0.0045;

// Turns by multiples of 30 degrees, as [cos, sin]: the view keeps the tiling's hexagon grid square to the frame.
const TURNS: readonly [number, number][] = [
  [1, 0],
  [HR3, 0.5],
  [0.5, HR3],
  [0, 1],
  [-0.5, HR3],
  [-HR3, 0.5],
  [-1, 0],
  [-HR3, -0.5],
  [-0.5, -HR3],
  [0, -1],
  [0.5, -HR3],
  [HR3, -0.5],
];

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const unit = Math.min(width, height);

  // The view: hat-grid units to pixels, centered somewhere the patch covers the whole frame, turned and maybe
  // mirrored.
  const across = ACROSS[0] + (ACROSS[1] - ACROSS[0]) * rand();
  const scale = unit / across;
  // The crop's room comes from the longest art any stamp has, not this one's, so it doesn't move when the art's
  // size rounds differently at another scale.
  const halfDiagonal = (across / 2) * Math.sqrt(1 + LONGEST * LONGEST);
  const room = CENTER_ROOM - halfDiagonal;
  const [ox, oy] = inDisc(rand);
  const [cx, cy] = [CENTER.x + ox * room, CENTER.y + oy * room];
  const [c, s] = TURNS[Math.floor(rand() * TURNS.length)];
  const flip = rand() < 0.5 ? -1 : 1;
  // Pixels run down, so y flips unless the view mirrors it back.
  const view = mul(
    [
      scale * c,
      -scale * s,
      width / 2,
      -flip * scale * s,
      -flip * scale * c,
      height / 2,
    ],
    ttrans(-cx, -cy),
  );

  // Hatviz's colors: the reflected hats in a strong blue among light blue H hats, white T and P hats and grey F
  // hats. Here the strong color is one of the lighter inks, or sometimes the darkest. Or the hats take a tone
  // by their orientation, the reflected ones still in their own ink.
  const paperRgb = rgb(paper);
  const dark = rgb(inks[0]);
  const light = inks.slice(1).map(rgb);
  for (let n = light.length - 1; n > 0; n--) {
    const m = Math.floor(rand() * (n + 1));
    [light[n], light[m]] = [light[m], light[n]];
  }
  const strong = light[0];
  const other = light[1] ?? dark;
  const reflected = rand() < 0.25 ? dark : strong;
  const tones: Rgb[] = [
    paperRgb,
    mix(paperRgb, strong, 0.45),
    mix(paperRgb, other, light[1] ? 0.6 : 0.3),
  ];
  const byOrientation = rand() < 0.5;
  if (byOrientation)
    for (let n = 2; n > 0; n--) {
      const m = Math.floor(rand() * (n + 1));
      [tones[n], tones[m]] = [tones[m], tones[n]];
    }
  const byLabel: Record<Label, Rgb> = {
    H1: reflected,
    H: tones[1],
    T: tones[0],
    P: tones[0],
    F: tones[2],
  };
  const metatiles = rand() < 0.4;

  const hats: Hat[] = [];
  const outlines: Outline[] = [];
  const reach = 2 * META_HALF * unit;
  const visible = (box: Pt[]) =>
    box.some(({ x }) => x > -reach) &&
    box.some(({ x }) => x < width + reach) &&
    box.some(({ y }) => y > -reach) &&
    box.some(({ y }) => y < height + reach);
  walk(hTile(TOP), TOP, view, visible, hats, outlines);

  // Each hat fills its inset in its color, and the band around that in the darkest ink. Polygons are all wound
  // one way, so the bands' holes cut the other.
  const fills = new Map<Rgb, number[][]>([[dark, []]]);
  const band = fills.get(dark)!;
  for (const { label, T } of hats) {
    let color = byLabel[label];
    if (byOrientation && label !== "H1") {
      // The hat's turn, from where it sends the x axis: the nearest of the twelve turns, in pairs, since the
      // view turns the grid by a multiple of 30 degrees. Turns half a circle apart share a tone.
      let best = 0;
      TURNS.forEach(([tc, ts], j) => {
        const [bc, bs] = TURNS[best];
        if (T[0] * tc + T[3] * ts > T[0] * bc + T[3] * bs) best = j;
      });
      color = tones[Math.floor(best / 2) % 3];
    }
    const points = wound(
      HAT.flatMap((p) => {
        const q = transPt(T, p);
        return [q.x, q.y];
      }),
    );
    const inner = inset(points, HAT_HALF * unit);
    if (!fills.has(color)) fills.set(color, []);
    fills.get(color)!.push(inner);
    band.push(points, reverse(inner));
  }
  // The metatile outlines, as bands inside each metatile, which tile the plane too. They cut across hats, so
  // they draw over them.
  const overs: Layer[] = [];
  if (metatiles) {
    const polys: number[][] = [];
    for (const o of outlines) {
      if (o.level !== 0) continue;
      const points = wound(o.points.flatMap(({ x, y }) => [x, y]));
      polys.push(points, reverse(inset(points, META_HALF * unit)));
    }
    overs.push({ polys, color: dark });
  }

  const image = ctx.createImageData(width, height);
  rasterize(
    width,
    height,
    paperRgb,
    [...fills].map(([color, polys]) => ({ polys, color })),
    overs,
    image,
  );
  ctx.putImageData(image, 0, 0);
}

// Twice a flat polygon's signed area.
function area(points: number[]) {
  const n = points.length;
  let sum = 0;
  for (let k = 0; k < n; k += 2)
    sum +=
      points[k] * points[(k + 3) % n] - points[(k + 2) % n] * points[k + 1];
  return sum;
}

// A flat polygon wound so its signed area is positive.
const wound = (points: number[]) =>
  area(points) > 0 ? points : reverse(points);

// A uniform point in the unit disc.
function inDisc(rand: () => number): [number, number] {
  for (;;) {
    const [x, y] = [2 * rand() - 1, 2 * rand() - 1];
    if (x * x + y * y <= 1) return [x, y];
  }
}

// A flat point list in the opposite order.
function reverse(points: number[]) {
  const out: number[] = [];
  for (let k = points.length - 2; k >= 0; k -= 2)
    out.push(points[k], points[k + 1]);
  return out;
}

export const hatMonotile1: Style = { id: "hat1", draw };
