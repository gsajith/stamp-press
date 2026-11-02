// Grown tree: one tree grown branch by branch, after Anders Hoff's (inconvergent) tree. Each branch walks
// upward, turning a little at random, thinning as it goes, and splits off thinner children more often the
// thinner it gets. Every step paints the branch's cross-section: paper across the body, an ink dot at each
// edge, and a random run of grain in from the right edge, with a lighter run in from the left. Stacked, the
// cross-sections read as a pencil drawing: white limbs with hard outlines and streaky shading down one side.
// https://github.com/inconvergent/tree
//
// The growth and the cross-section drawing are ported from the original, which is licensed:
//
//   The MIT License (MIT)
//
//   Copyright (c) 2014 Anders Hoff
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
// The original grows on a 10000 px canvas, one pixel per step, and stamps single-pixel grain dots. Here the
// tree grows in the original's canvas units with steps ten pixels long, the turning, thinning and splitting
// rescaled to match, so the same seed grows the same tree at any size. Each step's grain becomes its expected
// tone, printed as a stipple of fixed cells when the cells are at least a pixel and as flat tone when smaller.
// Every pixel is computed with IEEE-exact arithmetic, so it matches in every browser and in Node (ADR 0001).

import { cos, exp, log, pow, sin } from "../exact";
import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

type Rgb = [number, number, number];

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

// The original's constants, in its canvas units: the canvas is 1 across and a pixel is ONE.
const ONE = 1e-4;
const INIT_BRANCH = 0.03;
const BRANCH_DIMINISH = ONE / 27;
const BRANCH_PROB_SCALE = 42 / (INIT_BRANCH / ONE);
const BRANCH_ANGLE_MAX = 10 * Math.PI * ONE;
const BRANCH_ANGLE_EXP = 2.2;
// Grain dots per cross-section, as a share of the canvas: 400 on the right, a fifth of that on the left.
const GRAINS = 0.04;

// Ten original pixels per step. Thinning and the chance to split scale with the step, and the random turn
// with its square root, so a branch wanders as far over the same length.
const STEP = 10 * ONE;
const PIXELS_PER_STEP = STEP / ONE;

// How much more a branch turns as it thins: (1 + (ONE + INIT_BRANCH - r) / INIT_BRANCH) ^ 2.2, tabled over
// q = 1 - r / INIT_BRANCH and read by linear interpolation, since exact pow is slow for every step.
const TURN_TABLE = 256;
const TURN = Array.from({ length: TURN_TABLE + 2 }, (_, i) =>
  pow(1 + ONE / INIT_BRANCH + i / TURN_TABLE, BRANCH_ANGLE_EXP),
);
function turnFactor(r: number): number {
  const q = (1 - r / INIT_BRANCH) * TURN_TABLE;
  const i = Math.floor(q);
  return TURN[i] + (TURN[i + 1] - TURN[i]) * (q - i);
}

// Caps the cross-sections painted, so an unusually bushy tree stays within the draw budget.
const MAX_OPS = 12000;
// A tree with fewer cross-sections than this is a bare pole: it's grown again.
const MIN_OPS = 2000;

// One branch tip: where it is, its radius and heading, and the heading's cosine and sine.
type Branch = {
  x: number;
  y: number;
  r: number;
  a: number;
  c: number;
  s: number;
};

// The numbers per cross-section in grow's output.
export const OP = 11;

export type Growth = {
  // The trunk's heading, in radians: -pi/2 is straight up.
  root: number;
  // A child's radius, as a share of its parent's.
  splitDiminish: number;
  // The widest angle between a child and its parent.
  splitAngle: number;
  // The random turn per original pixel, for the trunk.
  angleMax: number;
  // The chance to split per original pixel, per unit the branch has thinned.
  probScale: number;
};

// Grows a tree from (0, 0), and returns its cross-sections in the order the original paints them: each step,
// every live branch in queue order. Each is OP numbers: the branch's previous center and heading's cosine and
// sine (x0, y0, c0, s0), its new ones (x1, y1, c1, s1), its new radius, then how far in from the right and
// left edges its grain runs, as shares of the radius.
export function grow(
  rand: () => number,
  grain: () => number,
  { root, splitDiminish, splitAngle, angleMax, probScale }: Growth,
): number[] {
  const diminish = BRANCH_DIMINISH * PIXELS_PER_STEP;
  const turn = angleMax * Math.sqrt(PIXELS_PER_STEP);
  const ops: number[] = [];
  // A standard normal draw, from four uniforms: close enough, and exact.
  const normal = () => (rand() + rand() + rand() + rand() - 2) * Math.sqrt(3);
  const tip = (x: number, y: number, r: number, a: number): Branch => ({
    x,
    y,
    r,
    a,
    c: cos(a),
    s: sin(a),
  });
  let queue: Branch[] = [tip(0, 0, INIT_BRANCH, root)];
  while (queue.length > 0 && ops.length < MAX_OPS * OP) {
    // Like the original, a branch that splits keeps its place, and the rest move to the back behind the new
    // children, which changes who paints over whom.
    const stay: Branch[] = [];
    const next: Branch[] = [];
    for (const b of queue) {
      const [x0, y0, c0, s0] = [b.x, b.y, b.c, b.s];
      b.r -= diminish;
      b.a += turnFactor(b.r) * normal() * turn;
      b.c = cos(b.a);
      b.s = sin(b.a);
      b.x += b.c * STEP;
      b.y += b.s * STEP;
      if (b.r <= ONE) continue;
      ops.push(x0, y0, c0, s0, b.x, b.y, b.c, b.s, b.r, grain(), grain());
      const prob = (INIT_BRANCH - b.r + ONE) * probScale * PIXELS_PER_STEP;
      if (rand() < prob) {
        const side = rand() < 0.5 ? 1 : -1;
        const a = b.a + side * rand() * splitAngle;
        next.push(tip(b.x, b.y, splitDiminish * b.r, a));
        stay.push(b);
      } else next.push(b);
    }
    queue = [...stay, ...next];
  }
  return ops;
}

// How far apart two colors' lightness is, out of 255.
const contrast = (a: Rgb, b: Rgb) =>
  Math.abs(
    0.299 * (a[0] - b[0]) + 0.587 * (a[1] - b[1]) + 0.114 * (a[2] - b[2]),
  );

// An integer hash of a stipple cell, as a number in [0, 1).
function cellHash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ salt;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// How much of the pixel-wide span around u lies in [lo, hi].
const overlap = (u: number, lo: number, hi: number) =>
  Math.max(0, Math.min(u + 0.5, hi) - Math.max(u - 0.5, lo));

const LOG_HALF = log(0.5);
// The grain's expected tone where `grains` dots per cross-section (as a share of the canvas) fall on a run
// `run` long: dots per dot-sized cell, each laying down half its ink.
const grainTone = (grains: number, run: number) =>
  run > 0 ? 1 - exp((grains / run) * LOG_HALF) : 1;

// The outline's width, in art units (the art's short side is 1): about a pixel at desk size.
const OUTLINE = 0.0055;
// The stipple's cell, in art units: about a pixel and a half in the detail view.
const CELL = 1 / 1100;
// Room above and beside the crown, in art units.
const TOP = 0.07;
const SIDE = 0.06;

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const unit = Math.min(width, height);

  // The original's look on some stamps: paper limbs on paper. On others the ground takes the palette's
  // lightest ink, when it stands apart from the paper, and the limbs stay paper.
  const ink = rgb(inks[0]);
  const light = rgb(inks[inks.length - 1]);
  const tinted =
    rand() < 0.35 &&
    inks.length > 1 &&
    contrast(light, rgb(paper)) > 30 &&
    contrast(light, ink) > 60;
  const ground = tinted ? light : rgb(paper);
  const body = rgb(paper);

  // The original's growth, varied per seed around its values. Its split rate grows thousands of twigs; the
  // tree in its sample image is far sparser, so the rate here is a quarter to a half of it.
  const grain = stream(seed, 0x6a1e);
  let ops: number[] = [];
  for (let tries = 0; tries < 4 && ops.length < MIN_OPS * OP; tries++)
    ops = grow(rand, grain, {
      root: -Math.PI / 2 + 0.24 * (rand() - 0.5),
      splitDiminish: 0.66 + 0.1 * rand(),
      splitAngle: Math.PI * (0.2 + 0.18 * rand()),
      angleMax: BRANCH_ANGLE_MAX * (0.6 + rand()),
      probScale: BRANCH_PROB_SCALE * (0.25 + 0.3 * rand()),
    });

  // Fits the tree into the art: the trunk's foot just below the bottom edge, the crown inside the margins.
  let [minX, maxX, minY] = [-INIT_BRANCH, INIT_BRANCH, 0];
  for (let i = 0; i < ops.length; i += OP) {
    const [x, y, r] = [ops[i + 4], ops[i + 5], ops[i + 8]];
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r);
  }
  const [W, H] = [width / unit, height / unit];
  const k = Math.min(
    (H - TOP) / (INIT_BRANCH - minY),
    (W - 2 * SIDE) / (maxX - minX),
  );
  // Pixels per tree unit, and where the tree's origin lands.
  const s = k * unit;
  const ox = (W / 2 - (k * (minX + maxX)) / 2) * unit;
  const oy = (H + k * INIT_BRANCH) * unit;

  const n = width * height;
  const buf = new Float32Array(n * 3);
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 3; c++) buf[i * 3 + c] = ground[c];

  const outline = OUTLINE * unit;
  const cellPx = CELL * unit;
  const stipple = cellPx >= 1;
  const salt = Math.floor(rand() * 4294967296) | 0;

  for (let i = 0; i < ops.length; i += OP) {
    const X0 = ox + ops[i] * s;
    const Y0 = oy + ops[i + 1] * s;
    const [c0, s0] = [ops[i + 2], ops[i + 3]];
    const X1 = ox + ops[i + 4] * s;
    const Y1 = oy + ops[i + 5] * s;
    const [c1, s1] = [ops[i + 6], ops[i + 7]];
    const r = ops[i + 8];
    const [runR, runL] = [ops[i + 9], ops[i + 10]];
    const R = r * s;
    // A branch thinner than a pixel draws a pixel wide at matching strength, so twigs keep their weight
    // small and taper to points large.
    const Rd = Math.max(R, 0.5);
    const fade = Math.min(1, 2 * R);
    const band = Math.min(outline, Rd);
    // The grain tones, worked out when a pixel first needs them.
    let toneR = -1;
    let toneL = -1;

    // The slab between the two cross-sections: ahead of the first, behind the second, within reach of the
    // branch's axis. Consecutive slabs of a branch share a cross-section, so they tile without gaps.
    const ex = X1 - X0;
    const ey = Y1 - Y0;
    const len = Math.sqrt(ex * ex + ey * ey);
    if (!(len > 0)) continue;
    // The right-hand normal: the original's right edge is at heading + pi/2.
    const [nx, ny] = [-ey / len, ex / len];
    const reach = Rd + 0.5;
    // The rows whose pixel centers can fall in the slab. The first cross-section tilts from square by the
    // branch's turn, which reaches past the ends by up to reach times its sine: doubled, with room to spare.
    const tilt = Math.abs(c0 * s1 - s0 * c1);
    const spread = (Math.abs(ny) + 2 * tilt) * reach;
    const yMin = Math.max(0, Math.ceil(Math.min(Y0, Y1) - spread - 0.5));
    const yMax = Math.min(height, Math.floor(Math.max(Y0, Y1) + spread + 0.5));
    // The slab's four sides as half-planes A x + B y + C >= 0: ahead of the first cross-section, behind the
    // second, and within reach on either side of the axis.
    const C0 = -(c0 * X0 + s0 * Y0);
    const C1 = c1 * X1 + s1 * Y1;
    const CN = nx * X0 + ny * Y0;
    const planes = [
      c0,
      s0,
      C0,
      -c1,
      -s1,
      C1,
      nx,
      ny,
      reach - CN,
      -nx,
      -ny,
      reach + CN,
    ];
    for (let y = yMin; y < yMax; y++) {
      const py = y + 0.5;
      // The span of pixel centers the half-planes allow on this row.
      let lo = 0;
      let hi = width;
      for (let p = 0; p < 12; p += 3) {
        const A = planes[p];
        const v = planes[p + 1] * py + planes[p + 2];
        if (A > 0) lo = Math.max(lo, Math.ceil(-v / A - 0.5));
        else if (A < 0) hi = Math.min(hi, Math.floor(-v / A - 0.5) + 1);
        else if (v < 0) hi = 0;
      }
      for (let x = lo; x < hi; x++) {
        const px = x + 0.5;
        // The exact slab test: rounding in the span above can be a pixel out. A center exactly on the next
        // cross-section belongs to the next slab.
        if (c0 * px + s0 * py + C0 < 0 || c1 * px + s1 * py - C1 >= 0) continue;
        const u = (px - X0) * nx + (py - Y0) * ny;
        const shape = overlap(u, -Rd, Rd);
        if (shape <= 0) continue;
        // The outline along each edge, then the grain: in from the right edge as far as runR of the radius,
        // and in from the left as far as runL.
        let tone =
          (overlap(u, Rd - band, Rd) + overlap(u, -Rd, band - Rd)) / shape;
        let g = 0;
        if (u > 0 && R - u < runR * R) {
          if (toneR < 0) toneR = grainTone(GRAINS, runR * r);
          g = toneR;
        } else if (u <= 0 && R + u < runL * R) {
          if (toneL < 0) toneL = grainTone(GRAINS / 5, runL * r);
          g = toneL;
        }
        if (g > 0) {
          const t = stipple
            ? cellHash(Math.floor(px / cellPx), Math.floor(py / cellPx), salt) <
              g
              ? 1
              : 0
            : g;
          tone = 1 - (1 - tone) * (1 - t);
        }
        const alpha = shape * fade;
        const j = (y * width + x) * 3;
        for (let c = 0; c < 3; c++) {
          const color = body[c] + (ink[c] - body[c]) * tone;
          buf[j + c] += (color - buf[j + c]) * alpha;
        }
      }
    }
  }

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(buf[i * 3 + c]);
    data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

export const grownTree1: Style = {
  id: "tree1",
  draw,
};
