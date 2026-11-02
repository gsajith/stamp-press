// Imaginary flower: a gongbi painting of one plant that doesn't exist, ported from Lingdong Huang's Nonflowers
// (https://github.com/LingDong-/nonflowers). Its plant grammar is kept: a herb of curving stems topped with
// shoots and flowers, or a woody shrub of forking branches dotted with leaves and blossoms. Leaves and petals
// are ribbons swept along a bending spine in 3D and seen flat, so they twist, curl and fold; petals shade from
// base to tip, leaves by how they face the light, and every edge and vein is traced with a fine brush line.
// The foliage prints as a wash multiplied into the paper and fades in and out with noise, and the flowers
// paint over it, as in the original.
//
// Changes for a stamp: colors come from the palette instead of free hues, the shapes are rasterized here with
// exact area coverage instead of by canvas, and the plant is fitted to the frame. Like land1, it computes
// every pixel itself, so its pixels match in every browser and in Node, which the golden test relies on
// (ADR 0001). Only IEEE-exact arithmetic here: trig, exp and pow come from exact.ts, and p5's noise, which the
// original uses, is ported with its table filled from our seeded stream.
//
// Nonflowers is under the MIT License:
//
// Copyright (c) 2018 Lingdong Huang
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without
// limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
// the Software, and to permit persons to whom the Software is furnished to do so, subject to the following
// conditions:
//
// The above copyright notice and this permission notice shall be included in all copies or substantial
// portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
// LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
// EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN
// AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE
// OR OTHER DEALINGS IN THE SOFTWARE.

import { atan2, cos, exp, pow, sin } from "../exact";
import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

type Rgb = [number, number, number];
type V3 = [number, number, number];

const PI = Math.PI;

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const mapval = (v: number, a: number, b: number, c: number, d: number) =>
  c + (d - c) * ((v - a) / (b - a));

// p5's cosine ease, 0.5 - 0.5 cos(pi t) for t in [0, 1), as 0.5 + 0.5 sin(pi u) with u = t - 0.5, whose
// series to u^11 is within 2e-7 of it.
function ease(t: number): number {
  const u = PI * (t - 0.5);
  const u2 = u * u;
  return (
    0.5 +
    0.5 *
      u *
      (1 +
        u2 *
          (-1 / 6 +
            u2 *
              (1 / 120 +
                u2 * (-1 / 5040 + u2 * (1 / 362880 + u2 * (-1 / 39916800))))))
  );
}

// p5's noise, as the original uses it: value noise on a 4096-entry table, cosine-eased, four octaves each
// half as strong. `octaves` drops the finest ones for their average, so a draw doesn't alias detail finer
// than its pixels.
type Noise = (x: number, y?: number, z?: number, octaves?: number) => number;
function p5Noise(rand: () => number): Noise {
  const table = new Float64Array(4096);
  for (let i = 0; i < 4096; i++) table[i] = rand();
  return (x, y = 0, z = 0, octaves = 4) => {
    // With every octave dropped, the sum of their averages.
    if (octaves === 0) return 0.46875;
    x = Math.abs(x);
    y = Math.abs(y);
    z = Math.abs(z);
    let xi = Math.floor(x);
    let yi = Math.floor(y);
    let zi = Math.floor(z);
    let xf = x - xi;
    let yf = y - yi;
    let zf = z - zi;
    let r = 0;
    let amp = 0.5;
    for (let o = 0; o < 4; o++) {
      if (o >= octaves) {
        // A dropped octave adds its average.
        r += amp * 0.5;
      } else {
        let of = xi + (yi << 4) + (zi << 8);
        const rx = ease(xf);
        const ry = ease(yf);
        let n1 = table[of & 4095];
        n1 += rx * (table[(of + 1) & 4095] - n1);
        let n2 = table[(of + 16) & 4095];
        n2 += rx * (table[(of + 17) & 4095] - n2);
        n1 += ry * (n2 - n1);
        of += 256;
        n2 = table[of & 4095];
        n2 += rx * (table[(of + 1) & 4095] - n2);
        let n3 = table[(of + 16) & 4095];
        n3 += rx * (table[(of + 17) & 4095] - n3);
        n2 += ry * (n3 - n2);
        n1 += (zf === 0 ? 0 : ease(zf)) * (n2 - n1);
        r += n1 * amp;
      }
      amp *= 0.5;
      xi <<= 1;
      xf *= 2;
      yi <<= 1;
      yf *= 2;
      zi <<= 1;
      zf *= 2;
      if (xf >= 1) {
        xi++;
        xf--;
      }
      if (yf >= 1) {
        yi++;
        yf--;
      }
      if (zf >= 1) {
        zi++;
        zf--;
      }
    }
    return r;
  };
}

// The original's Euler rotation, z then x then y, as a row-major 3x3 matrix.
function euler([x, y, z]: V3): number[] {
  const [cx, sx, cy, sy, cz, sz] = [
    cos(x),
    sin(x),
    cos(y),
    sin(y),
    cos(z),
    sin(z),
  ];
  return [
    cy * cz + sy * sx * sz,
    sy * sx * cz - cy * sz,
    sy * cx,
    cx * sz,
    cx * cz,
    -sx,
    cy * sx * sz - sy * cz,
    sy * sz + cy * sx * cz,
    cy * cx,
  ];
}
const mul = (a: number[], b: number[]) => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
  a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
  a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
  a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
  a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
  a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
  a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];
// Points on the page, in 2D, from u to v by p.
const lerp = (u: number[], v: number[], p: number) => [
  u[0] + (v[0] - u[0]) * p,
  u[1] + (v[1] - u[1]) * p,
];

// The rotation that turns the z axis toward direction `d`: the original searches for it in 5 degree steps.
function toEuler([x, y, z]: V3): V3 {
  return [atan2(-y, Math.sqrt(x * x + z * z)), atan2(x, z), 0];
}
// The direction of polyline `P` at point `i`.
const grot = (P: V3[], i: number): V3 =>
  toEuler([
    P[i][0] - P[i - 1][0],
    P[i][1] - P[i - 1][1],
    P[i][2] - P[i - 1][2],
  ]);

// A color the original gives in HSV, here as a palette ink: `k` of the ink over white, at brightness `v`,
// with alpha `a`.
type Tone = { ink: Rgb; k: number; v: number; a: number };
type Tones = { min: Tone; max: Tone };
const tone = (ink: Rgb, k: number, v: number, a = 1): Tone => ({
  ink,
  k,
  v,
  a,
});
const flat = (t: Tone): Tones => ({ min: t, max: t });

// One brush stroke: polygons that tile it, each with its own color, laid down together so the seams between
// them don't show. Colors are 0 to 1, with alpha.
type Shape = { polys: number[][]; colors: number[][] };

function colorOf(
  { min, max }: Tones,
  t: number,
  dim = 1,
): [number, number, number, number] {
  const k = (min.k + (max.k - min.k) * t) * dim;
  const v = (min.v + (max.v - min.v) * t) * dim;
  const a = min.a + (max.a - min.a) * t;
  const c = [0, 0, 0, a] as [number, number, number, number];
  for (let i = 0; i < 3; i++) {
    const ink = min.ink[i] + (max.ink[i] - min.ink[i]) * t;
    c[i] = clamp01(((255 + (ink - 255) * k) * v) / 255);
  }
  return c;
}

// How wide the brush lines are, in the plant's units. The original's are a pixel on its 600 px canvas, which
// would vanish on a desk stamp.
const VEIN = 1.4;
const EDGE = 2.2;

// The plant, in the original's canvas units with its root at (600, 840): two layers of strokes, the foliage
// (multiplied into the paper) and the flowers (painted over it).
type Plant = { foliage: Shape[]; flowers: Shape[] };

// The colors of a plant, from the palette: the inks its petals shade from and to, its leaves', its wood's and
// the flowers' hearts', and the dark ink the brush lines are drawn in.
type Inks = { flower: [Rgb, Rgb]; leaf: Rgb; wood: Rgb; heart: Rgb; line: Rgb };

// A stamp shows one clear plant, and the draw has a budget, so a plant stops adding leaves and flowers past
// these many, though each herb's stem still ends in a flower.
const MAX_LEAVES = 40;
const MAX_FLOWERS = 12;
const BLOOM = 1.3;

function grow(rand: () => number, noise: Noise, inks: Inks): Plant {
  const normRand = (m: number, M: number) => m + (M - m) * rand();
  const choice = <T>(xs: T[]) => xs[Math.floor(xs.length * rand())];
  const plant: Plant = { foliage: [], flowers: [] };
  let leaves = 0;

  const quad = (s: Shape, pts: number[][], c: number[]) => {
    const flatPts: number[] = [];
    for (const p of pts) flatPts.push(p[0], p[1]);
    s.polys.push(flatPts);
    s.colors.push(c);
  };

  // The outline of a ribbon of width `wid` along `pts`, in 2D, as the original's tubify: offsets square to the
  // line, at each point along the bisector of its turn.
  function tubify(
    pts: number[][],
    wid: (x: number) => number,
  ): [number[][], number[][]] {
    const n = pts.length;
    const L: number[][] = [];
    const R: number[][] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      let [tx, ty] = [b[0] - a[0], b[1] - a[1]];
      if (i > 0 && i < n - 1) {
        // The bisector of the two segments' directions.
        const [ax, ay] = [pts[i][0] - a[0], pts[i][1] - a[1]];
        const [bx, by] = [b[0] - pts[i][0], b[1] - pts[i][1]];
        const [la, lb] = [
          Math.sqrt(ax * ax + ay * ay),
          Math.sqrt(bx * bx + by * by),
        ];
        if (la > 0 && lb > 0) [tx, ty] = [ax / la + bx / lb, ay / la + by / lb];
      }
      const l = Math.sqrt(tx * tx + ty * ty);
      const w = i === 0 ? wid(0) : i === n - 1 ? wid(1) : wid(i / n);
      const [nx, ny] = l > 0 ? [(ty / l) * w, (-tx / l) * w] : [0, 0];
      L.push([pts[i][0] + nx, pts[i][1] + ny]);
      R.push([pts[i][0] - nx, pts[i][1] - ny]);
    }
    return [L, R];
  }

  // A tapered brush line along `pts`, one quad per segment.
  function stroke(
    layer: Shape[],
    pts: number[][],
    c: number[],
    wid: (x: number) => number = (x) =>
      EDGE * sin(x * PI) * mapval(noise(x * 10), 0, 1, 0.5, 1),
  ) {
    const [L, R] = tubify(pts, wid);
    const s: Shape = { polys: [], colors: [] };
    for (let i = 1; i < pts.length; i++)
      quad(s, [L[i - 1], L[i], R[i], R[i - 1]], c);
    layer.push(s);
  }

  const lineColor = (a: number) => [
    inks.line[0] / 255,
    inks.line[1] / 255,
    inks.line[2] / 255,
    a,
  ];

  // A leaf or a petal: a ribbon of width `wid` swept along a spine that starts along `rot` and bends by `ben`.
  type LeafArgs = {
    layer: Shape[];
    xof: number;
    yof: number;
    rot: V3;
    len: number;
    seg?: number;
    wid: (x: number) => number;
    vei: number[];
    flo?: boolean;
    col: Tones;
    cof?: (x: number) => number;
    ben: (x: number) => V3;
    // The outline's color, or none.
    rim?: number[] | null;
  };
  function leaf({
    layer,
    xof,
    yof,
    rot,
    len,
    seg = 16,
    wid,
    vei,
    flo = false,
    col,
    cof = (x) => x,
    ben,
    rim = lineColor(0.3),
  }: LeafArgs): V3[] {
    if (!flo) leaves++;
    const orient = euler(rot);
    let disp: V3 = [0, 0, 0];
    let crot: V3 = [0, 0, 0];
    const P: V3[] = [disp];
    const L: V3[] = [disp];
    const R: V3[] = [disp];
    const fill: Shape = { polys: [], colors: [] };
    const at = (p: number[]) => [p[0] + xof, p[1] + yof];
    for (let i = 0; i < seg; i++) {
      const p = i / (seg - 1);
      const b = ben(p);
      crot = [crot[0] + b[0] / seg, crot[1] + b[1] / seg, crot[2] + b[2] / seg];
      const m = mul(orient, euler(crot));
      const step = len / seg;
      disp = [
        disp[0] + m[2] * step,
        disp[1] + m[5] * step,
        disp[2] + m[8] * step,
      ];
      const w = wid(p);
      const l: V3 = [
        disp[0] - m[0] * w,
        disp[1] - m[3] * w,
        disp[2] - m[6] * w,
      ];
      const r: V3 = [
        disp[0] + m[0] * w,
        disp[1] + m[3] * w,
        disp[2] + m[6] * w,
      ];
      if (i > 0) {
        let lt: number;
        if (!flo) {
          // Lit by how the leaf's face turns toward the viewer's up.
          const prevL = L[L.length - 1];
          const v0 = [
            disp[0] - prevL[0],
            disp[1] - prevL[1],
            disp[2] - prevL[2],
          ];
          const v1 = [l[0] - disp[0], l[1] - disp[1], l[2] - disp[2]];
          const n = [
            v0[1] * v1[2] - v0[2] * v1[1],
            v0[2] * v1[0] - v0[0] * v1[2],
            v0[0] * v1[1] - v0[1] * v1[0],
          ];
          const nl = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
          const c = -n[1] / nl;
          // acos(c), from atan2. A segment folded flat has no face, and the original shades it dark.
          lt =
            nl > 0 ? 1 - atan2(Math.sqrt(Math.max(0, 1 - c * c)), c) / PI : 0;
        } else {
          lt = p * normRand(0.95, 1);
        }
        lt = clamp01(cof(lt));
        const c = colorOf(col, lt);
        const prevP = at(P[P.length - 1]);
        quad(fill, [at(l), at(L[L.length - 1]), prevP, at(disp)], c);
        quad(fill, [at(r), at(R[R.length - 1]), prevP, at(disp)], c);
      }
      P.push(disp);
      L.push(l);
      R.push(r);
    }
    layer.push(fill);

    if (vei[0] === 1) {
      // Veins running the leaf's length, `vei[1]` to a side.
      for (let j = 0; j < vei[1]; j++) {
        const p = j / vei[1];
        for (const side of [L, R]) {
          const line = P.map((q, i) => at(lerp(side[i], q, p))).slice(1);
          const alphas = line.map(() => normRand(0.4, 0.9));
          const [A, B] = tubify(line, () => VEIN / 2);
          const s: Shape = { polys: [], colors: [] };
          for (let i = 1; i < line.length; i++)
            quad(s, [A[i - 1], A[i], B[i], B[i - 1]], lineColor(alphas[i]));
          layer.push(s);
        }
      }
      stroke(layer, P.map(at), lineColor(0.3));
    } else if (vei[0] === 2) {
      // Veins branching from the midrib to the edge, `vei[1]` of the original's 40 segments on, every
      // `vei[2]` of them.
      const s: Shape = { polys: [], colors: [] };
      const reach = Math.max(1, Math.round((vei[1] * seg) / 40));
      const every = Math.max(1, Math.round((vei[2] * seg) / 40));
      for (let i = 1; i < P.length - reach; i += every)
        for (const side of [L, R]) {
          const [a, b] = [at(P[i]), at(side[i + reach])];
          const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d === 0) continue;
          const [nx, ny] = [(-dy / d) * (VEIN / 2), (dx / d) * (VEIN / 2)];
          quad(
            s,
            [
              [a[0] + nx, a[1] + ny],
              [b[0] + nx, b[1] + ny],
              [b[0] - nx, b[1] - ny],
              [a[0] - nx, a[1] - ny],
            ],
            lineColor(normRand(0.4, 0.9)),
          );
        }
      layer.push(s);
      stroke(layer, P.map(at), lineColor(0.3));
    }
    // The outline, in a lighter line.
    if (rim) {
      stroke(layer, L.map(at), rim);
      stroke(layer, R.map(at), rim);
    }
    return P;
  }

  // A stem: a ribbon along a bending spine, shaded in strips across it, with outlined edges.
  type StemArgs = {
    xof: number;
    yof: number;
    rot: V3;
    len: number;
    seg?: number;
    wid: (x: number) => number;
    col: Tones;
    ben: (x: number) => V3;
  };
  function stem({
    xof,
    yof,
    rot,
    len,
    seg = 24,
    wid,
    col,
    ben,
  }: StemArgs): V3[] {
    const orient = euler(rot);
    let disp: V3 = [0, 0, 0];
    let crot: V3 = [0, 0, 0];
    const P: V3[] = [disp];
    for (let i = 0; i < seg; i++) {
      const p = i / (seg - 1);
      const b = ben(p);
      crot = [crot[0] + b[0] / seg, crot[1] + b[1] / seg, crot[2] + b[2] / seg];
      const m = mul(orient, euler(crot));
      const step = len / seg;
      disp = [
        disp[0] + m[2] * step,
        disp[1] + m[5] * step,
        disp[2] + m[8] * step,
      ];
      P.push(disp);
    }
    const [L, R] = tubify(
      P.map((q) => [q[0] + xof, q[1] + yof]),
      wid,
    );
    const fill: Shape = { polys: [], colors: [] };
    for (let i = 1; i < P.length; i++)
      for (let j = 1; j < 4; j++) {
        const [m, n, p] = [(j - 1) / 3, j / 3, i / (P.length - 1)];
        const p0 = lerp(L[i - 1], R[i - 1], m);
        const p1 = lerp(L[i], R[i], m);
        const p2 = lerp(L[i - 1], R[i - 1], n);
        const p3 = lerp(L[i], R[i], n);
        const dim = mapval(noise(p * 10, m * 10, n * 10), 0, 1, 0.5, 1);
        quad(fill, [p0, p1, p3, p2], colorOf(col, clamp01(n / p), dim));
      }
    plant.foliage.push(fill);
    stroke(plant.foliage, L, lineColor(0.5));
    stroke(plant.foliage, R, lineColor(0.5));
    return P;
  }

  // A branch that forks into thinner ones, `dep` levels deep. Returns every branch's spine, placed.
  type BranchArgs = {
    xof: number;
    yof: number;
    rot: V3;
    len?: number;
    seg?: number;
    wid?: number;
    twi?: number;
    col?: Tones;
    dep?: number;
    frk?: number;
  };
  function branch({
    xof,
    yof,
    rot,
    len = 400,
    seg = 20,
    wid = 1,
    twi = 5,
    col = flat(tone(inks.wood, 0.2, 0.8)),
    dep = 3,
    frk = 4,
  }: BranchArgs): [number, V3[]][] {
    // Joints, where the branch kinks and thickens, placed on the original's 40 segments.
    const jnt: [number, number][] = [];
    for (let i = 0; i < twi; i++)
      jnt.push([Math.floor(rand() * 40), normRand(-1, 1)]);
    const jntdist = (x: number): [number, number] => {
      let [m, j] = [40, 0];
      for (let i = 0; i < jnt.length; i++) {
        const n = Math.abs(x * 40 - jnt[i][0]);
        if (n < m) [m, j] = [n, i];
      }
      return [m, jnt[j][1]];
    };
    const P = stem({
      xof,
      yof,
      rot,
      len,
      seg,
      col,
      wid: (x) =>
        jntdist(x)[0] < 1
          ? wid * (3 + 5 * (1 - x))
          : wid * (2 + 7 * (1 - x) * mapval(noise(x * 10), 0, 1, 0.5, 1)),
      ben: (x) => {
        const [m, j] = jntdist(x);
        return m < 1
          ? [0, j * 20, 0]
          : [0, normRand(-5, 5) * Math.sqrt(seg / 40), 0];
      },
    });
    let child: [number, V3[]][] = [];
    if (dep > 0 && wid > 0.1)
      for (let i = 0; i < frk * rand(); i++) {
        const ind = Math.floor(normRand(1, P.length));
        const r = grot(P, ind);
        child = child.concat(
          branch({
            xof: xof + P[ind][0],
            yof: yof + P[ind][1],
            rot: [
              r[0] + (normRand(-1, 1) * PI) / 6,
              r[1] + (normRand(-1, 1) * PI) / 6,
              r[2] + (normRand(-1, 1) * PI) / 6,
            ],
            seg,
            len: len * normRand(0.4, 0.6),
            wid: wid * normRand(0.4, 0.7),
            twi: twi * 0.7,
            dep: dep - 1,
          }),
        );
      }
    return [
      [dep, P.map((v): V3 => [v[0] + xof, v[1] + yof, v[2]])] as [number, V3[]],
    ].concat(child);
  }

  // The plant's parameters, drawn as the original's genParams draws them.
  const randint = (x: number, y: number) => Math.floor(normRand(x, y));
  const sinPow = (x: number, e: number) => pow(Math.max(0, sin(PI * x)), e);
  // The original's woody plants are sometimes bare twigs, which read as nothing on a stamp, so there's a floor.
  const flowerChance = choice([normRand(0.02, 0.08), normRand(0.012, 0.03)]);
  const leafChance = choice([0, normRand(0, 0.1), normRand(0, 0.1)]);
  const leafType = choice([
    [1, randint(2, 5)],
    [2, randint(3, 7), randint(3, 8)],
    [2, randint(3, 7), randint(3, 8)],
  ]);
  const flowerShapeSeed = rand() * PI;
  const flowerJaggedness = normRand(0.5, 8);
  const flowerShape = (x: number) =>
    noise(x * flowerJaggedness, flowerShapeSeed) * sinPow(x, 0.2);
  const leafJaggedness = normRand(0.1, 40);
  const leafPointyness = normRand(0.5, 1.5);
  // The original seeds the jagged leaf's noise with the flower's seed too.
  const leafShape = choice([
    (x: number) => noise(x * leafJaggedness, flowerShapeSeed) * sinPow(x, 0.5),
    (x: number) => sinPow(x, leafPointyness),
  ]);

  // Flower colors: the original picks two hues near each other, pale to fully saturated.
  const flowerV0 = Math.min(1, normRand(0.75, 1.15));
  const flowerV1 = Math.min(1, normRand(0.75, 1.15));
  const flowerColor: Tones = {
    min: tone(inks.flower[0], normRand(0.35, 1), flowerV0, normRand(0.8, 1)),
    max: tone(inks.flower[1], normRand(0.05, 0.7), flowerV1, normRand(0.5, 1)),
  };
  const leafColor: Tones = {
    min: tone(
      inks.leaf,
      normRand(0.25, 0.7),
      normRand(0.55, 0.85),
      normRand(0.8, 1),
    ),
    max: tone(
      inks.leaf,
      normRand(0.25, 0.7),
      normRand(0.55, 0.85),
      normRand(0.8, 1),
    ),
  };
  const curve0 = [normRand(-0.5, 0.5), normRand(5, 10)];
  const curve2 = [rand() * PI, normRand(5, 15)];
  const curve4 = [rand() * 0.5, normRand(0.8, 1.2)];
  const flowerOpenCurve = choice([
    (x: number, op: number) =>
      x < 0.1 ? 2 + op * curve2[1] : noise(x * 10, curve2[0]),
    (x: number, op: number) =>
      x < curve4[0] ? 0 : 10 - x * mapval(op, 0, 1, 16, 20) * curve4[1],
  ]);
  const flowerColorCurve = (x: number) =>
    1 / (1 + exp(-curve0[1] * (x + curve0[0] - 0.5)));
  const leafLength = normRand(30, 100);
  const flowerLength = normRand(5, 55);
  const pedicelLength = normRand(5, 30);
  const leafWidth = normRand(5, 30);
  const flowerWidth = normRand(5, 30);
  const stemWidth = normRand(2, 11);
  const stemBend = normRand(2, 16);
  const stemLength = normRand(300, 400);
  const stemCount = choice([2, 3, 4, 5]);
  const sheathLength = choice([0, normRand(50, 100)]);
  const sheathWidth = normRand(5, 15);
  const shootCount = normRand(1, 7);
  const shootLength = normRand(50, 180);
  const leafPosition = choice([1, 2]);
  const flowerPetal = Math.round(mapval(flowerWidth, 5, 50, 10, 3));
  const innerLength = Math.min(normRand(0, 20), flowerLength * 0.8);
  const innerColor: Tones = {
    min: tone(
      inks.heart,
      normRand(0.3, 0.9),
      normRand(0.6, 0.95),
      normRand(0.8, 1),
    ),
    max: tone(
      inks.heart,
      normRand(0.3, 0.9),
      normRand(0.6, 0.95),
      normRand(0.5, 1),
    ),
  };
  const branchWidth = normRand(0.4, 1.3);
  const branchTwist = Math.round(normRand(2, 5));
  const branchDepth = choice([3, 4]);
  const branchFork = choice([4, 5, 6, 7]);
  const branchColor = flat(
    tone(inks.wood, normRand(0.1, 0.35), normRand(0.7, 0.9)),
  );

  // A flower at (x, y) facing `hhr`: a ring of petals and a ring of short inner ones, all opening by `op`.
  // Flowers are larger than the original's, so they read on a desk stamp.
  let flowers = 0;
  // Petals are outlined softly in their own color, as the original's are in olive.
  const rim = [0, 1, 2].map((i) => (inks.flower[0][i] + inks.line[i]) / 510);
  rim.push(0.3);
  function flower(x: number, y: number, hhr: V3, size: number) {
    flowers++;
    size *= BLOOM;
    const op = rand();
    for (let k = 0; k < flowerPetal; k++) {
      const rot: V3 = [hhr[0], hhr[1], hhr[2] + (k / flowerPetal) * PI * 2];
      const ben = (t: number): V3 => [flowerOpenCurve(t, op), 0, 0];
      leaf({
        layer: plant.flowers,
        flo: true,
        xof: x,
        yof: y,
        rot,
        seg: 12,
        len: flowerLength * normRand(0.7, 1.3) * size,
        wid: (t) => size * flowerShape(t) * flowerWidth,
        vei: [0],
        col: flowerColor,
        cof: flowerColorCurve,
        ben,
        rim,
      });
      leaf({
        layer: plant.flowers,
        flo: true,
        xof: x,
        yof: y,
        rot,
        seg: 8,
        len: innerLength * normRand(0.8, 1.2) * BLOOM,
        // Too small to need the original's outline.
        rim: null,
        wid: (t) => sin(t * PI) * 4 * BLOOM,
        vei: [0],
        col: innerColor,
        ben,
      });
    }
  }

  const leafBend =
    (i: number, by: number) =>
    (x: number): V3 => [
      mapval(noise(x, i), 0, 1, -1, 1) * by,
      0,
      mapval(noise(x, i + PI), 0, 1, -1, 1) * by,
    ];

  const [x0, y0] = [600, 840];
  if (rand() <= 0.5) {
    // Woody: a branching shrub, with leaves and flowers on stalks along its branches.
    const PL = branch({
      xof: x0,
      yof: y0,
      rot: [PI / 2, 0, 0],
      wid: branchWidth,
      twi: branchTwist,
      dep: branchDepth,
      col: branchColor,
      frk: branchFork,
    });
    // Leaves and flowers grow along every branch past the first tenth. Their chances are thinned to about
    // MAX_LEAVES and MAX_FLOWERS over all those points, so a shrub fills out all over, not just on the
    // branches drawn first.
    const first = Math.floor(PL.length * 0.1) + 1;
    let sites = 0;
    for (let i = first; i < PL.length; i++) sites += PL[i][1].length;
    const leafAt = Math.min(leafChance, MAX_LEAVES / sites);
    const flowerAt = Math.min(flowerChance, MAX_FLOWERS / sites);
    for (let i = first; i < PL.length; i++) {
      for (const [px, py] of PL[i][1]) {
        if (leaves < MAX_LEAVES && rand() < leafAt)
          leaf({
            layer: plant.foliage,
            xof: px,
            yof: py,
            len: leafLength * normRand(0.8, 1.2),
            vei: leafType,
            col: leafColor,
            rot: [
              normRand(-1, 1) * PI,
              normRand(-1, 1) * PI,
              normRand(-1, 1) * 0,
            ],
            wid: (x) => leafShape(x) * leafWidth,
            ben: leafBend(i, 5),
          });
        if (flowers < MAX_FLOWERS && rand() < flowerAt) {
          const hr: V3 = [
            normRand(-1, 1) * PI,
            normRand(-1, 1) * PI,
            normRand(-1, 1) * 0,
          ];
          const P_ = stem({
            xof: px,
            yof: py,
            rot: hr,
            len: pedicelLength,
            seg: 6,
            col: flat(tone(inks.flower[0], 1, 0.9)),
            wid: (x) => sin(x * PI) * x * 2 + 1,
            ben: () => [0, 0, 0],
          });
          const end = P_[P_.length - 1];
          flower(px + end[0], py + end[1], grot(P_, P_.length - 1), 1);
        }
      }
    }
  } else {
    // Herbaceous: stems from one root, each ending in a sheath and a spray of flowering shoots.
    for (let i = 0; i < stemCount; i++) {
      const P = stem({
        xof: x0,
        yof: y0,
        len: stemLength * normRand(0.7, 1.3),
        rot: [PI / 2, 0, normRand(-1, 1) * PI],
        col: { min: tone(inks.leaf, 0.2, 0.4), max: tone(inks.leaf, 0.3, 0.6) },
        wid: (x) =>
          stemWidth *
          (pow(Math.max(0, sin((x * PI) / 2 + PI / 2)), 0.5) *
            noise(x * 10) *
            0.5 +
            0.5),
        ben: (x) => {
          const b = leafBend(i, stemBend)(x);
          return [b[0] * x, 0, b[2] * x];
        },
      });
      if (leafPosition === 2)
        for (const [px, py] of P)
          if (leaves < MAX_LEAVES && rand() < leafChance * 2)
            leaf({
              layer: plant.foliage,
              xof: x0 + px,
              yof: y0 + py,
              len: 2 * leafLength * normRand(0.8, 1.2),
              vei: leafType,
              col: leafColor,
              rot: [
                normRand(-1, 1) * PI,
                normRand(-1, 1) * PI,
                normRand(-1, 1) * 0,
              ],
              wid: (x) => 2 * leafShape(x) * leafWidth,
              ben: leafBend(i, 5),
            });
      const hr = grot(P, P.length - 1);
      const top = P[P.length - 1];
      if (sheathLength !== 0)
        stem({
          xof: x0 + top[0],
          yof: y0 + top[1],
          rot: hr,
          len: sheathLength,
          seg: 10,
          col: flat(tone(inks.leaf, 0.3, 0.9)),
          wid: (x) =>
            sheathWidth * (pow(Math.max(0, sin(x * PI)), 2) - x * 0.5 + 0.5),
          ben: () => [0, 0, 0],
        });
      const shoots = Math.max(1, shootCount * normRand(0.5, 1.5));
      for (let j = 0; j < shoots && (j === 0 || flowers < MAX_FLOWERS); j++) {
        const P_ = stem({
          xof: x0 + top[0],
          yof: y0 + top[1],
          rot: hr,
          len: shootLength * normRand(0.5, 1.5),
          seg: 14,
          col: flat(tone(inks.leaf, 0.2, 0.9)),
          wid: () => 2,
          ben: (x) => {
            const b = leafBend(j, 10)(x);
            return [b[0] * x, 0, b[2] * x];
          },
        });
        const end = P_[P_.length - 1];
        const hhr: V3 = [
          normRand(-1, 1) * PI,
          normRand(-1, 1) * PI,
          normRand(-1, 1) * PI,
        ];
        flower(x0 + top[0] + end[0], y0 + top[1] + end[1], hhr, 1.5);
      }
    }
    if (leafPosition === 1)
      for (let i = 0; i < leafChance * 100 && leaves < MAX_LEAVES; i++)
        leaf({
          layer: plant.foliage,
          xof: x0,
          yof: y0,
          rot: [PI / 3, 0, normRand(-1, 1) * PI],
          len: 4 * leafLength * normRand(0.8, 1.2),
          wid: (x) => 2 * leafShape(x) * leafWidth,
          vei: leafType,
          col: {
            min: tone(inks.leaf, 0.2, 0.3),
            max: tone(inks.leaf, 0.1, 0.9),
          },
          ben: leafBend(i, 10),
        });
  }
  return plant;
}

// Adds a shape's area coverage to `acc`, a `aw` by `ah` grid: the signed area each edge sweeps, accumulated
// along each row afterwards (as in font-rs). Exact for any polygon, so shapes thinner than a pixel fade
// instead of aliasing.
function edge(
  acc: Float64Array,
  aw: number,
  ah: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  if (y0 === y1) return;
  let dir = 1;
  if (y0 > y1) {
    dir = -1;
    let t = x0;
    x0 = x1;
    x1 = t;
    t = y0;
    y0 = y1;
    y1 = t;
  }
  const dxdy = (x1 - x0) / (y1 - y0);
  let x = x0;
  if (y0 < 0) {
    x -= y0 * dxdy;
    y0 = 0;
  }
  if (y1 > ah) y1 = ah;
  if (y0 >= y1) return;
  const end = Math.ceil(y1);
  for (let y = Math.floor(y0); y < end; y++) {
    const row = y * aw;
    const dy = Math.min(y + 1, y1) - Math.max(y, y0);
    const xnext = x + dxdy * dy;
    const d = dy * dir;
    const xa = x < xnext ? x : xnext;
    const xb = x < xnext ? xnext : x;
    const xai = Math.floor(xa);
    const xbi = Math.ceil(xb);
    if (xbi <= xai + 1) {
      const xmf = 0.5 * (x + xnext) - xai;
      acc[row + xai] += d - d * xmf;
      acc[row + xai + 1] += d * xmf;
    } else {
      const s = 1 / (xb - xa);
      const x0f = xa - xai;
      const a0 = 0.5 * s * (1 - x0f) * (1 - x0f);
      const x1f = xb - xbi + 1;
      const am = 0.5 * s * x1f * x1f;
      acc[row + xai] += d * a0;
      if (xbi === xai + 2) acc[row + xai + 1] += d * (1 - a0 - am);
      else {
        const a1 = s * (1.5 - x0f);
        acc[row + xai + 1] += d * (a1 - a0);
        for (let xi = xai + 2; xi < xbi - 1; xi++) acc[row + xi] += d * s;
        const a2 = a1 + (xbi - xai - 3) * s;
        acc[row + xbi - 1] += d * (1 - a2 - am);
      }
      acc[row + xbi] += d * am;
    }
    x = xnext;
  }
}

// Paints shapes into `layer`, premultiplied RGBA on a `w` by `h` grid, with `scale` pixels per plant unit and
// the plant's (ox, oy) at the top left. Within a shape, each polygon's coverage adds up, so polygons that share
// an edge cover it fully between them, and its color is the coverage-weighted mean of theirs.
function paint(
  shapes: Shape[],
  layer: Float32Array,
  w: number,
  h: number,
  scale: number,
  ox: number,
  oy: number,
) {
  let acc = new Float64Array(1024);
  let q = new Float64Array(64);
  let sum = new Float32Array(1024 * 5);
  let [lo, hi] = [new Int32Array(64), new Int32Array(64)];
  for (const { polys, colors } of shapes) {
    // The shape's pixel bounds, clipped to the art.
    let [gx0, gy0, gx1, gy1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const poly of polys)
      for (let i = 0; i < poly.length; i += 2) {
        if (poly[i] < gx0) gx0 = poly[i];
        if (poly[i] > gx1) gx1 = poly[i];
        if (poly[i + 1] < gy0) gy0 = poly[i + 1];
        if (poly[i + 1] > gy1) gy1 = poly[i + 1];
      }
    gx0 = Math.max(0, Math.floor((gx0 - ox) * scale));
    gy0 = Math.max(0, Math.floor((gy0 - oy) * scale));
    gx1 = Math.min(w, Math.ceil((gx1 - ox) * scale) + 1);
    gy1 = Math.min(h, Math.ceil((gy1 - oy) * scale));
    if (!(gx0 < gx1 && gy0 < gy1)) continue;
    const gw = gx1 - gx0;
    const gh = gy1 - gy0;
    // `sum` stays zero between shapes: each clears the spans it touched, row by row.
    if (sum.length < gw * gh * 5) sum = new Float32Array(gw * gh * 5);
    if (lo.length < gh) [lo, hi] = [new Int32Array(gh), new Int32Array(gh)];
    lo.fill(gw, 0, gh);
    hi.fill(-1, 0, gh);

    for (let p = 0; p < polys.length; p++) {
      const poly = polys[p];
      const n = poly.length;
      if (q.length < n) q = new Float64Array(n);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < n; i += 2) {
        const x = (poly[i] - ox) * scale;
        const y = (poly[i + 1] - oy) * scale;
        q[i] = x;
        q[i + 1] = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const bx0 = Math.floor(minX);
      const by0 = Math.max(gy0, Math.floor(minY));
      const by1 = Math.min(gy1, Math.ceil(maxY));
      if (by0 >= by1 || maxX < 0 || minX > w) continue;
      const aw = Math.ceil(maxX) + 2 - bx0;
      const ah = by1 - by0;
      if (acc.length < aw * ah) acc = new Float64Array(aw * ah);
      acc.fill(0, 0, aw * ah);
      for (let i = 0; i < n; i += 2) {
        const j = (i + 2) % n;
        edge(
          acc,
          aw,
          ah,
          q[i] - bx0,
          q[i + 1] - by0,
          q[j] - bx0,
          q[j + 1] - by0,
        );
      }
      const color = colors[p];
      const r = color[0];
      const g = color[1];
      const b = color[2];
      const a = color[3];
      for (let y = 0; y < ah; y++) {
        let s = 0;
        const gy = y + by0 - gy0;
        const row = gy * gw;
        for (let x = 0; x < aw; x++) {
          s += acc[y * aw + x];
          const c = s < 0 ? -s : s;
          if (c < 1e-6) continue;
          const gx = x + bx0;
          if (gx < gx0 || gx >= gx1) continue;
          if (gx - gx0 < lo[gy]) lo[gy] = gx - gx0;
          if (gx - gx0 > hi[gy]) hi[gy] = gx - gx0;
          const cov = c > 1 ? 1 : c;
          const k = (row + gx - gx0) * 5;
          const ca = cov * a;
          sum[k] += cov;
          sum[k + 1] += ca;
          sum[k + 2] += ca * r;
          sum[k + 3] += ca * g;
          sum[k + 4] += ca * b;
        }
      }
    }

    for (let y = 0; y < gh; y++)
      for (let x = lo[y]; x <= hi[y]; x++) {
        const k = (y * gw + x) * 5;
        const s = sum[k];
        const sa = sum[k + 1];
        if (s === 0 || sa === 0) {
          sum[k] = 0;
          continue;
        }
        const alpha = (s > 1 ? 1 : s) * (sa / s);
        const f = alpha / sa;
        const l = ((y + gy0) * w + x + gx0) * 4;
        const keep = 1 - alpha;
        layer[l] = layer[l] * keep + sum[k + 2] * f;
        layer[l + 1] = layer[l + 1] * keep + sum[k + 3] * f;
        layer[l + 2] = layer[l + 2] * keep + sum[k + 4] * f;
        layer[l + 3] = layer[l + 3] * keep + alpha;
        sum[k] = sum[k + 1] = sum[k + 2] = sum[k + 3] = sum[k + 4] = 0;
      }
  }
}

// Room left around the plant, in art units, and the plant's size in art units per plant unit: the original
// paints on a 600 px canvas, about the frame's width. Small plants grow and large ones shrink to fit, within
// these limits, and may overflow the frame by this much, cropped like the original's.
const PAD = 0.07;
const SCALE = 1 / 600;
const OVERFLOW = 1.5;

// Draws whose art is smaller than this many pixels across its short side are supersampled up to it. Desk
// stamps, about 150 to 200 px, draw once per pixel: the exact coverage prefilters them already.
const MIN_UNIT = 128;

// A box [left, top, right, bottom] in plant units.
type Box = [number, number, number, number];
function bounds(shapes: Shape[]): Box {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { polys } of shapes)
    for (const poly of polys)
      for (let i = 0; i < poly.length; i += 2) {
        const x = poly[i];
        const y = poly[i + 1];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return [x0, y0, x1, y1];
}
const union = (a: Box, b: Box): Box => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[2], b[2]),
  Math.max(a[3], b[3]),
];

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const noise = p5Noise(stream(seed, 1));
  const ink = inks.map(rgb);
  const light = ink.slice(1);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const flower = pick(light);
  const leaf =
    light.length > 1 ? pick(light.filter((c) => c !== flower)) : ink[0];
  const plant = grow(rand, noise, {
    flower: [flower, rand() < 0.5 ? flower : pick(light)],
    leaf,
    wood: ink[0],
    heart: rand() < 0.5 ? ink[0] : pick(light),
    line: ink[0],
  });

  // Fit the plant to the frame. Like the original, it may run off the edges, but its flowers stay in.
  const leafy = bounds(plant.foliage);
  const bloom = plant.flowers.length ? bounds(plant.flowers) : leafy;
  const all = union(leafy, bloom);
  const unit = Math.min(width, height);
  const [W, H] = [width / unit, height / unit];
  const fit = ([x0, y0, x1, y1]: Box) =>
    Math.min((W - 2 * PAD) / (x1 - x0), (H - 2 * PAD) / (y1 - y0));
  const s = Math.min(
    SCALE * 2.4,
    Math.max(SCALE * 0.8, Math.min(fit(bloom), fit(all) * OVERFLOW)),
  );
  // Art units to plant units at the top left: centered between the plant and its flowers, then moved as little
  // as keeps the flowers in.
  const place = (
    a0: number,
    a1: number,
    f0: number,
    f1: number,
    span: number,
  ) => {
    const [view, pad] = [span / s, PAD / s];
    if (f1 - f0 > view - 2 * pad) return (f0 + f1) / 2 - view / 2;
    const start = (0.4 * (a0 + a1)) / 2 + (0.6 * (f0 + f1)) / 2 - view / 2;
    return Math.max(Math.min(start, f0 - pad), f1 + pad - view);
  };
  const ox = place(all[0], all[2], bloom[0], bloom[2], W);
  const oy = place(all[1], all[3], bloom[1], bloom[3], H);
  // Small draws paint at `ss` samples a pixel, so strokes finer than a pixel average out as they would in a
  // large draw scaled down.
  const ss = Math.ceil(MIN_UNIT / unit);
  const [w, h] = [width * ss, height * ss];
  const scale = s * unit * ss;
  // The plant's units per sample, for dropping noise finer than a sample.
  const foot = 1 / scale;
  const octaves = (freq: number) => {
    let o = 0;
    while (o < 4 && freq * foot * 2 ** o < 0.5) o++;
    return o;
  };
  // The fade's finest octave and the tint's two finest are too faint to see, so they're dropped at any size.
  const fadeOct = Math.min(3, octaves(0.01));
  const [wispN, wispM] = [octaves(0.2), Math.min(2, octaves(0.5))];

  const paperRgb = rgb(paper);
  const n = w * h;
  const img = new Float32Array(n * 3);
  const layer = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    img[i * 3] = paperRgb[0];
    img[i * 3 + 1] = paperRgb[1];
    img[i * 3 + 2] = paperRgb[2];
  }

  // Each layer, then its wispy texture, as the original filters them: the foliage also fades in and out.
  for (const [shapes, multiply] of [
    [plant.foliage, true],
    [plant.flowers, false],
  ] as const) {
    layer.fill(0);
    paint(shapes, layer, w, h, scale, ox, oy);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const a = layer[i * 4 + 3];
        if (a === 0) continue;
        const X = ox + (x + 0.5) * foot;
        const Y = oy + (y + 0.5) * foot;
        let f = 0.5 + 0.5 * noise(X * 0.2, Y * 0.2, 0, wispN);
        if (multiply)
          f *= clamp01(0.15 + 1.5 * noise(X * 0.01, Y * 0.01, 0, fadeOct));
        // The wisps warm the color a little, taking some green and more blue.
        const m = noise(X * 0.5, Y * 0.5, 2, wispM);
        const alpha = a * f;
        const l = i * 4;
        const k = i * 3;
        const r = layer[l] * f;
        const g = layer[l + 1] * f * (0.95 + 0.05 * m);
        const b = layer[l + 2] * f * (0.9 + 0.1 * m);
        // Multiplied into the paper, or painted over it.
        if (multiply) {
          img[k] *= 1 - alpha + r;
          img[k + 1] *= 1 - alpha + g;
          img[k + 2] *= 1 - alpha + b;
        } else {
          img[k] = img[k] * (1 - alpha) + r * 255;
          img[k + 1] = img[k + 1] * (1 - alpha) + g * 255;
          img[k + 2] = img[k + 2] * (1 - alpha) + b * 255;
        }
      }
  }

  const image = ctx.createImageData(width, height);
  const out = image.data;
  if (ss === 1)
    for (let i = 0; i < n; i++) {
      out[i * 4] = Math.round(img[i * 3]);
      out[i * 4 + 1] = Math.round(img[i * 3 + 1]);
      out[i * 4 + 2] = Math.round(img[i * 3 + 2]);
      out[i * 4 + 3] = 255;
    }
  else
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let j = 0; j < ss; j++)
            for (let i = 0; i < ss; i++)
              sum += img[((y * ss + j) * w + x * ss + i) * 3 + c];
          out[o + c] = Math.round(sum / (ss * ss));
        }
        out[o + 3] = 255;
      }
  ctx.putImageData(image, 0, 0);
}

export const nonflowers1: Style = {
  id: "bloom1",
  draw,
};
