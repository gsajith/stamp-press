// Mathematical marbling, ported from Marblizer by Nick Walker (https://github.com/nickswalker/marblizer):
//
//   MIT License
//
//   Copyright (c) 2016 Nick Walker
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.
//
// Marblizer implements Lu, Jaffer et al.'s "Mathematical Marbling" (IEEE CG&A, 2012): flat inks dropped on a
// bath, then raked with straight, wavy and circular tines and spun into vortices, each a closed-form map of
// the bath. A pixel's color comes from running its position back through the inverse maps, newest first,
// until it lands inside a drop. Its look is bold flat bands with crisp edges, pulled into ogees, hearts and
// swirls. This port keeps its operations and their falloff constants, and picks a recipe from the seed:
// Marblizer's banner, its tutorial with one side mirrored, and the classic stone, feather, nonpareil and
// bouquet, plus a swirl, built from its concentric drops and combs.
//
// Only IEEE-exact arithmetic (ADR 0001): sine and cosine come from exact.ts. Sizes are fractions of the art's
// short side, and Marblizer's pixel constants are scaled to match.

import { cos, sin } from "../exact";
import type { Palette } from "../palettes";
import { stream } from "../random";
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

// Marblizer's constants are in screen pixels. This many of them make one unit, the art's short side.
const PX = 700;
// Its tines' falloff: a tine drags ink alpha * lambda / (d + lambda) at distance d.
const LAMBDA = 32 / PX;

const TAU = 2 * Math.PI;

// The bath operations, Marblizer's, oldest first. Each is STRIDE numbers in one flat array, its kind first,
// so the per-sample loop stays fast.
// - DROPS (x, y, start, count): ink drops at one center, newest first, their squared radii and colors at
//   `start` in the drop lists. A drop of radius r pushes the bath out from its center, |p - c|² grows by r²,
//   and fills the disc it leaves. Drops on one center make concentric bands.
// - LINE (ox, oy, lx, ly, tines, spacing, alpha * lambda, lambda): a straight comb dragged along (lx, ly), tines
//   every `spacing` across it, `tines` either side of the origin, each dragging ink alpha * lambda / (d + lambda)
//   at distance d.
// - WAVY (mx, my, amp, k, phase): ink slides along (mx, my) by amp * sin(k v + phase), v its position across.
// - TURN (x, y, scale, offset, tines, interval, ±alpha * lambda, lambda): ink turns about a center by arc length
//   alpha * lambda / (d + lambda), d being |scale * radius - offset| folded onto tines `interval` apart. A
//   circular comb has tines on rings from radius `offset`. A vortex has d grow from its center.
const DROPS = 0;
const LINE = 1;
const WAVY = 2;
const TURN = 3;
const STRIDE = 9;
// The radius inside which a turn divides its arc length by this, not by the distance from its center.
const CORE = 0.02;

// Marblizer folds a distance onto its nearest tine, out to `tines` tines, past which it keeps growing.
function fold(d: number, tines: number, spacing: number): number {
  if (spacing <= 0 || d >= spacing * tines) return d - spacing * tines;
  const half = spacing / 2;
  const t = d - Math.floor(d / spacing) * spacing;
  return half - Math.abs(t - half);
}

// Runs (x, y) back through `ops`, newest first, until it lands in a drop, and returns that drop's color
// index. Otherwise returns -1 and leaves where it ended in X and Y.
let X = 0;
let Y = 0;
function undo(
  ops: Float64Array,
  r2: Float64Array,
  color: Uint8Array,
  x: number,
  y: number,
): number {
  for (let o = ops.length - STRIDE; o >= 0; o -= STRIDE) {
    const kind = ops[o];
    if (kind === DROPS) {
      const dx = x - ops[o + 1];
      const dy = y - ops[o + 2];
      const d2 = dx * dx + dy * dy;
      // r2 holds how far each drop, newest first, pushed the bath out to, squared. The point is inside the
      // first that reaches past it: a binary search.
      let lo = ops[o + 3];
      let hi = lo + ops[o + 4] - 1;
      if (d2 <= r2[hi]) {
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (d2 <= r2[mid]) hi = mid;
          else lo = mid + 1;
        }
        return color[lo];
      }
      // Outside every drop: before they fell, the point sat |p - c|² - R² from the center, R the outermost.
      const k = Math.sqrt((d2 - r2[hi]) / d2);
      x = ops[o + 1] + dx * k;
      y = ops[o + 2] + dy * k;
    } else if (kind === LINE) {
      const lx = ops[o + 3];
      const ly = ops[o + 4];
      const across = (y - ops[o + 2]) * lx - (x - ops[o + 1]) * ly;
      const d = fold(across < 0 ? -across : across, ops[o + 5], ops[o + 6]);
      // The comb slides ink along its own line, so the distance across, and so the slide, is the same
      // before and after: the inverse is the same slide backward.
      const f = ops[o + 7] / (d + ops[o + 8]);
      x -= lx * f;
      y -= ly * f;
    } else if (kind === WAVY) {
      const mx = ops[o + 1];
      const my = ops[o + 2];
      const f = ops[o + 3] * sin(ops[o + 4] * (x * my - y * mx) + ops[o + 5]);
      x -= mx * f;
      y -= my * f;
    } else {
      const dx = x - ops[o + 1];
      const dy = y - ops[o + 2];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) continue;
      const e = ops[o + 3] * len - ops[o + 4];
      const d = fold(e < 0 ? -e : e, ops[o + 5], ops[o + 6]);
      // A turn keeps each point's distance from the center, so undoing it is the same turn backward. Its
      // angle is arc length over radius. Inside CORE it divides by CORE instead, since it would wind without end.
      const theta = -ops[o + 7] / (d + ops[o + 8]) / (len < CORE ? CORE : len);
      const c = cos(theta);
      const s = sin(theta);
      x = ops[o + 1] + dx * c - dy * s;
      y = ops[o + 2] + dx * s + dy * c;
    }
  }
  X = x;
  Y = y;
  return -1;
}

type Recipe =
  | "banner"
  | "heart"
  | "swirl"
  | "stone"
  | "feather"
  | "nonpareil"
  | "bouquet";
// Marblizer's own compositions, and stone, come up twice as often as each combed pattern.
const RECIPES: readonly Recipe[] = [
  "banner",
  "banner",
  "heart",
  "heart",
  "stone",
  "stone",
  "swirl",
  "feather",
  "nonpareil",
  "bouquet",
];

// Draws with a short side under this many pixels are supersampled, so the smallest draws still average
// their thinnest bands.
const MIN_UNIT = 128;
// The strokes after the last drop are a smooth map, so they're undone only every GRID cells and interpolated
// in between.
const GRID = 4;

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const between = (lo: number, hi: number) => lo + (hi - lo) * rand();
  const unit = Math.min(width, height);
  const [W, H] = [width / unit, height / unit];

  // The colors: paper first, which bare bath shows, then each ink, then a pale tint of one.
  const paperRgb = rgb(paper);
  const inkRgb = inks.map(rgb);
  const colors: Rgb[] = [paperRgb, ...inkRgb];
  colors.push(mix(inkRgb[Math.floor(rand() * inkRgb.length)], paperRgb, 0.6));
  // The order bands repeat in: every color once, shuffled, so neighbors always differ.
  const cycle = colors.map((_, i) => i);
  for (let i = cycle.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cycle[i], cycle[j]] = [cycle[j], cycle[i]];
  }

  const recipe = RECIPES[Math.floor(rand() * RECIPES.length)];
  const ops: number[] = [];
  const r2: number[] = [];
  const color: number[] = [];
  // Where the strokes after the last drop start.
  let split = 0;
  const op = (...fields: number[]) => {
    ops.push(...fields);
    for (let i = fields.length; i < STRIDE; i++) ops.push(0);
    if (fields[0] === DROPS) split = ops.length;
  };
  const [cx, cy] = [W / 2, H / 2];
  const angle = rand() * TAU;
  const [ux, uy] = [cos(angle), sin(angle)];

  // Concentric drops at (x, y), sized so the bands come out about `band` wide, from `from` out to `reach`.
  // Drops are stored by the squared radius they push the bath out to, newest and innermost first.
  const target = (
    x: number,
    y: number,
    band: number,
    reach: number,
    from = 0,
  ) => {
    const start = r2.length;
    let j = 0;
    if (from > 0) {
      r2.push(from * from);
      color.push(cycle[j++ % cycle.length]);
    }
    for (let r = from; r < reach; j++) {
      r += band * between(0.7, 1.3);
      r2.push(r * r);
      color.push(cycle[j % cycle.length]);
    }
    op(DROPS, x, y, start, r2.length - start);
  };
  // Stripes across the sheet along (-uy, ux): bands of drops whose center is far off it, so they cross it
  // nearly straight.
  const stripes = () => {
    const far = between(3, 6);
    target(
      cx - ux * far,
      cy - uy * far,
      between(0.04, 0.065),
      far + 1.5,
      far - 1.5,
    );
  };
  // A comb dragged `drag` along (lx, ly) through (ox, oy). Marblizer pulls harder the longer the drag.
  const line = (
    ox: number,
    oy: number,
    lx: number,
    ly: number,
    tines: number,
    spacing: number,
    drag: number,
  ) =>
    op(
      LINE,
      ox,
      oy,
      lx,
      ly,
      tines,
      spacing,
      ((30 + (drag * PX) / 10) / PX) * LAMBDA,
      LAMBDA,
    );
  const wavy = (mx: number, my: number, amp: number, wavelength: number) =>
    op(WAVY, mx, my, amp, TAU / wavelength, rand() * TAU);

  if (recipe === "banner") {
    // Marblizer's banner: concentric bands, a tine pulled past either side of the middle in opposite
    // directions, which draws the center into a leaf, then a slow wave across.
    target(cx, cy, between(0.045, 0.07), 1.3);
    const off = between(0.04, 0.12);
    const drag = between(0.5, 1.1);
    line(cx - uy * off, cy + ux * off, ux, uy, 0, 0, drag);
    line(cx + uy * off, cy - ux * off, -ux, -uy, 0, 0, drag);
    wavy(-uy, ux, between(0.03, 0.06), between(0.45, 0.8));
  } else if (recipe === "heart") {
    // After Marblizer's tutorial: concentric bands raked with arcs from two opposite edges' midpoints, at
    // four radii. The tutorial turns both sides the same way, an S. Here one side is mirrored, which pulls
    // the bands into hearts.
    target(cx, cy, between(0.045, 0.07), 1.3);
    const side = rand() < 0.5;
    const half = side ? W / 2 : H / 2;
    for (let i = 0; i <= 3; i++)
      for (const end of [0, 1]) {
        const [x, y] = side ? [end * W, cy] : [cx, end * H];
        const turn = ((end === 0 ? 1 : -1) * 80 * LAMBDA) / PX;
        op(TURN, x, y, 1, (i * half) / 3, 1, 0, turn, LAMBDA);
      }
  } else if (recipe === "swirl") {
    // Stripes spun into a whirlpool near the middle. Marblizer measures a vortex's falloff as 100 per radius
    // against a lambda of 32, in pixels.
    stripes();
    const radius = between(0.4, 0.8);
    const turn = ((rand() < 0.5 ? 1 : -1) * between(4, 8) * 80 * 32) / PX;
    op(
      TURN,
      cx + between(-0.15, 0.15),
      cy + between(-0.15, 0.15),
      100 / radius,
      0,
      0,
      0,
      turn,
      32,
    );
  } else if (recipe === "stone") {
    // Stone: small rings of drops scattered across the bath and past its edges, each squeezing the ones
    // before it into cells.
    const margin = 0.2;
    const count = 16;
    // Sized so together they cover the bath about twice.
    const size = Math.sqrt(
      (2 * (W + 2 * margin) * (H + 2 * margin)) / (count * Math.PI),
    );
    for (let i = 0; i < count; i++) {
      const reach = size * between(0.7, 1.3);
      target(
        between(-margin, W + margin),
        between(-margin, H + margin),
        reach / between(2.5, 4.5),
        reach,
      );
    }
  } else {
    // Combed patterns start from stripes. Feather pulls a coarse comb across them and waves it along them,
    // bending its teeth into hooks. Nonpareil combs them across with a fine comb, and a bouquet waves that.
    stripes();
    if (recipe === "feather") {
      const gap = between(0.14, 0.22);
      line(cx, cy, ux, uy, 12, gap, between(1, 2));
      wavy(-uy, ux, between(0.05, 0.1), between(0.25, 0.45));
    } else {
      const fine = between(0.07, 0.1);
      line(cx, cy, ux, uy, 20, fine, between(0.8, 1.6));
      if (recipe === "bouquet")
        wavy(ux, uy, between(0.04, 0.08), between(0.3, 0.5));
    }
  }

  // The drops, and the strokes after the last of them.
  const dropOps = Float64Array.from(ops.slice(0, split));
  const strokeOps = Float64Array.from(ops.slice(split));
  const r2List = Float64Array.from(r2);
  const colorList = Uint8Array.from(color);

  // A cell is a pixel, or a supersampled draw's sub-pixel.
  const ss = Math.ceil(MIN_UNIT / unit);
  const cell = 1 / (unit * ss);
  const [cw, ch] = [width * ss, height * ss];

  // Where each grid point was before the strokes, with a spare row and column past the last cell corner.
  const [gw, gh] = [Math.floor(cw / GRID) + 2, Math.floor(ch / GRID) + 2];
  const gx = new Float64Array(gw * gh);
  const gy = new Float64Array(gw * gh);
  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++) {
      undo(strokeOps, r2List, colorList, i * GRID * cell, j * GRID * cell);
      gx[j * gw + i] = X;
      gy[j * gw + i] = Y;
    }
  // Grid squares where interpolating would stray over a cell from the exact position at their
  // center, such as a vortex's middle. Samples there run back through every operation.
  const exact = new Uint8Array(gw * gh);
  const stray = cell;
  for (let j = 0; j < gh - 1; j++)
    for (let i = 0; i < gw - 1; i++) {
      const o = j * gw + i;
      undo(
        strokeOps,
        r2List,
        colorList,
        (i + 0.5) * GRID * cell,
        (j + 0.5) * GRID * cell,
      );
      const ex = (gx[o] + gx[o + 1] + gx[o + gw] + gx[o + gw + 1]) / 4 - X;
      const ey = (gy[o] + gy[o + 1] + gy[o + gw] + gy[o + gw + 1]) / 4 - Y;
      exact[o] = ex * ex + ey * ey > stray * stray ? 1 : 0;
    }
  // The color index at (i, j) in cells.
  const at = (i: number, j: number) => {
    const u = i / GRID;
    const v = j / GRID;
    const iu = Math.floor(u);
    const iv = Math.floor(v);
    const o = iv * gw + iu;
    let x: number;
    let y: number;
    if (exact[o]) {
      undo(strokeOps, r2List, colorList, i * cell, j * cell);
      [x, y] = [X, Y];
    } else {
      const fu = u - iu;
      const fv = v - iv;
      const x0 = gx[o] + (gx[o + 1] - gx[o]) * fu;
      const x1 = gx[o + gw] + (gx[o + gw + 1] - gx[o + gw]) * fu;
      const y0 = gy[o] + (gy[o + 1] - gy[o]) * fu;
      const y1 = gy[o + gw] + (gy[o + gw + 1] - gy[o + gw]) * fu;
      x = x0 + (x1 - x0) * fv;
      y = y0 + (y1 - y0) * fv;
    }
    const c = undo(dropOps, r2List, colorList, x, y);
    return c < 0 ? 0 : c;
  };

  // Every cell corner's color. Then, as Marblizer antialiases, a cell takes the mean of nine samples, its
  // corners, edge midpoints and center, or just its corners' color when they agree.
  const corner = new Uint8Array((cw + 1) * (ch + 1));
  for (let j = 0; j <= ch; j++)
    for (let i = 0; i <= cw; i++) corner[j * (cw + 1) + i] = at(i, j);

  const image = ctx.createImageData(width, height);
  const data = image.data;
  const weight = 1 / (9 * ss * ss);
  let [r, g, b] = [0, 0, 0];
  const add = (c: number, w: number) => {
    r += colors[c][0] * w;
    g += colors[c][1] * w;
    b += colors[c][2] * w;
  };
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      r = g = b = 0;
      for (let sj = 0; sj < ss; sj++)
        for (let si = 0; si < ss; si++) {
          const i = col * ss + si;
          const j = row * ss + sj;
          const o = j * (cw + 1) + i;
          const c00 = corner[o];
          const c10 = corner[o + 1];
          const c01 = corner[o + cw + 1];
          const c11 = corner[o + cw + 2];
          if (c00 === c10 && c00 === c01 && c00 === c11) {
            add(c00, 9);
            continue;
          }
          add(c00, 1);
          add(c10, 1);
          add(c01, 1);
          add(c11, 1);
          add(at(i + 0.5, j), 1);
          add(at(i, j + 0.5), 1);
          add(at(i + 1, j + 0.5), 1);
          add(at(i + 0.5, j + 1), 1);
          add(at(i + 0.5, j + 0.5), 1);
        }
      const p = (row * width + col) * 4;
      data[p] = Math.round(r * weight);
      data[p + 1] = Math.round(g * weight);
      data[p + 2] = Math.round(b * weight);
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export const mathMarbling2: Style = {
  id: "marble2",
  draw,
};
