import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Apparatus: Kjetil Golid's machine of flat-colored rectangular blocks grown on a grid, mirrored left to right
// and outlined in the darkest ink, heavy around the silhouette and thin between blocks. Ported from the
// `apparat4` sketch in p5ycho (github.com/kgolid/p5ycho), under its license:
//
//   MIT License
//
//   Copyright (c) 2017 Kjetil Midtgarden Golid
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
// The growth rules are the original's, with Math.random swapped for a seeded stream. The original paints with
// p5 strokes, twice: a wide stroke, then the fills again and a thin stroke, so fills cover the wide stroke's
// inner half and it shows only outside the machine. Here a pixel takes the exact area of each color under it
// instead, since every edge is axis-aligned, so the picture matches at any size and in every browser and Node
// (ADR 0001). Strokes end square rather than round.

// One grid cell, as in the original: `h` and `v` draw its top and left edges, `inside` marks it part of the
// machine, and `color` is its fill.
type Cell = { h: boolean; v: boolean; inside: boolean; color: number };

const OUT: Cell = { h: false, v: false, inside: false, color: -1 };

type Growth = {
  cols: number; // cells across, odd, so the middle column is the mirror axis
  rows: number;
  radius: number; // the active region's radius, in cells
  kx: number; // squash factors: below 1 stretches the region along that axis
  ky: number;
  chanceNew: number;
  chanceExtend: number;
  colors: number; // how many fill colors there are
};

// The original's BlockBuilder.generate. Each cell follows from its left and top neighbors: a block either
// starts, extends right or down, or stops, and only within an elliptical active region around the middle.
// Cells right of the middle column copy their mirror image. Row 0 and column 0 stay empty.
function grow(g: Growth, rand: () => number): Cell[][] {
  const { cols, rows } = g;
  const mid = (cols + 1) / 2;
  const cy = rows / 2;
  let main = Math.floor(rand() * g.colors);

  const active = (x: number, y: number, fuzz: number) => {
    const fuzziness = 1 + rand() * fuzz;
    const [dx, dy] = [(x - mid) * g.kx, (y - cy) * g.ky];
    return Math.sqrt(dx * dx + dy * dy) < g.radius * fuzziness;
  };
  const startFromBlank = (x: number, y: number) =>
    active(x, y, -0.2) && rand() <= g.chanceNew / 10;
  const start = (x: number, y: number) =>
    active(x, y, -0.2) && rand() <= g.chanceNew;
  const extend = (x: number, y: number) =>
    active(x, y, 0.2) && rand() <= g.chanceExtend;
  const newBlock = (): Cell => {
    if (rand() > 0.85) main = Math.floor(rand() * g.colors);
    return { h: true, v: true, inside: true, color: main };
  };

  const next = (x: number, y: number, left: Cell, top: Cell): Cell => {
    const blank = (h: boolean, v: boolean): Cell =>
      startFromBlank(x, y) ? newBlock() : { ...OUT, h, v };
    if (!left.inside && !top.inside) return blank(false, false);
    if (left.inside && !top.inside) {
      if (left.h && extend(x, y))
        return { h: true, v: false, inside: true, color: left.color };
      return blank(false, true);
    }
    if (!left.inside && top.inside) {
      if (top.v && extend(x, y))
        return { h: false, v: true, inside: true, color: top.color };
      return blank(true, false);
    }
    if (!left.h && !top.v)
      return { h: false, v: false, inside: true, color: left.color };
    if (left.h && top.v)
      return rand() <= 0.5
        ? { h: false, v: true, inside: true, color: top.color }
        : { h: true, v: false, inside: true, color: left.color };
    // One neighbor's block reaches this edge: extend it, start another, or close the machine here.
    if (extend(x, y))
      return left.h
        ? { h: true, v: false, inside: true, color: left.color }
        : { h: false, v: true, inside: true, color: top.color };
    if (start(x, y)) return newBlock();
    return { h: true, v: true, inside: false, color: -1 };
  };

  const grid: Cell[][] = [];
  for (let i = 0; i <= rows; i++) {
    const row: Cell[] = [];
    grid.push(row);
    for (let j = 0; j <= cols; j++) {
      if (i === 0 || j === 0) row.push(OUT);
      else if (j > mid) {
        const [m, m1] = [row[cols + 1 - j], row[cols + 2 - j]];
        row.push({ h: m.h, v: m1.v, inside: m.inside, color: m.color });
      } else row.push(next(j, i, row[j - 1], grid[i - 1][j]));
    }
  }
  return grid;
}

type Rgb = [number, number, number];

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

// Paper around the machine, as a share of the art's short side.
const PAD = 0.09;
// How far each stroke reaches either side of an edge, in cells: the original's 2 and 6 px strokes on 10 px
// cells. A machine spans a few dozen cells, so at desk size the thin stroke comes to about a pixel.
const THIN = 0.1;
const THICK = 0.3;

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const unit = Math.min(width, height);
  // Portrait art grows a tall machine and landscape art a wide one, as the original squashes its region by
  // 0.8. Art from a square punch is square, and the others are at least 1.28 to 1, so 1.14 splits them at
  // every size.
  const tall = height > width * 1.14;
  const wide = width > height * 1.14;
  const radius = 13 + 5 * rand();
  const kx = wide ? 0.78 : 1;
  const ky = tall ? 0.78 : wide ? 1 : 0.9;
  const reach = radius * 1.2 + 2;
  const growth: Growth = {
    cols: 2 * Math.ceil(reach / kx) + 1,
    rows: 2 * Math.ceil(reach / ky) + 1,
    radius,
    kx,
    ky,
    chanceNew: 0.4 + 0.6 * rand(),
    chanceExtend: 0.72 + 0.18 * rand(),
    // Blocks fill in the lighter inks. The darkest ink draws the lines.
    colors: inks.length - 1,
  };
  const grid = grow(growth, rand);
  const fills = inks.slice(1).map(rgb);
  const cell = (i: number, j: number) => grid[i]?.[j] ?? OUT;

  // The machine's bounds, in cells: every inside cell and every edge drawn.
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  grid.forEach((row, i) =>
    row.forEach((c, j) => {
      if (!c.inside && !c.h && !c.v) return;
      [x0, x1] = [Math.min(x0, j), Math.max(x1, c.inside || c.h ? j + 1 : j)];
      [y0, y1] = [Math.min(y0, i), Math.max(y1, c.inside || c.v ? i + 1 : i)];
    }),
  );
  // A machine that never started still gets one block in the middle.
  if (x0 > x1) {
    const [i, j] = [(growth.rows + 1) / 2, (growth.cols + 1) / 2];
    grid[i][j] = { h: true, v: true, inside: true, color: 0 };
    grid[i][j + 1] = { ...OUT, v: true };
    grid[i + 1][j] = { ...OUT, h: true };
    [x0, x1, y0, y1] = [j, j + 1, i, i + 1];
  }

  // Fits the machine and its wide stroke inside the padding, centered.
  const pad = PAD * unit;
  const size = Math.min(
    (width - 2 * pad) / (x1 - x0 + 2 * THICK),
    (height - 2 * pad) / (y1 - y0 + 2 * THICK),
  );
  const ox = width / 2 - (size * (x0 + x1)) / 2;
  const oy = height / 2 - (size * (y0 + y1)) / 2;

  // Whether the point (x, y), in cells, lies within `hw` of a drawn edge. Edges end square, `hw` past their ends.
  const onEdge = (x: number, y: number, hw: number) => {
    const jn = Math.round(x);
    const iy = Math.floor(y);
    if (Math.abs(x - jn) < hw)
      for (let i = iy - 1; i <= iy + 1; i++)
        if (y > i - hw && y < i + 1 + hw && cell(i, jn).v) return true;
    const in_ = Math.round(y);
    const jx = Math.floor(x);
    if (Math.abs(y - in_) < hw)
      for (let j = jx - 1; j <= jx + 1; j++)
        if (x > j - hw && x < j + 1 + hw && cell(in_, j).h) return true;
    return false;
  };
  // The color at (x, y), in cells, as an index into `colors`. The thin stroke draws over everything, the wide
  // one only outside the machine.
  const colors = [rgb(paper), rgb(inks[0]), ...fills];
  const shade = (x: number, y: number) => {
    const c = cell(Math.floor(y), Math.floor(x));
    if (onEdge(x, y, THIN)) return 1;
    if (c.inside) return 2 + c.color;
    return onEdge(x, y, THICK) ? 1 : 0;
  };

  // Along one axis, the color changes only at a grid line or a stroke's side, so it's constant on each slab
  // between these breaks. `mids` holds each slab's middle in cells, and each pixel lists the slabs it overlaps
  // with their share of it, as flat (slab, share) pairs.
  const axis = (pixels: number, origin: number, lines: number) => {
    const breaks: number[] = [];
    for (let k = 0; k <= lines + 1; k++)
      for (const d of [-THICK, -THIN, 0, THIN, THICK]) breaks.push(k + d);
    // Slab s runs from break s - 1 to break s. The first and last run on past the grid.
    const mids = [
      breaks[0] - 1,
      ...breaks.slice(1).map((b, s) => (breaks[s] + b) / 2),
      breaks[breaks.length - 1] + 1,
    ];
    const at = breaks.map((b) => origin + b * size);
    let first = 0;
    const shares = Array.from({ length: pixels }, (_, p) => {
      while (first < at.length && at[first] <= p) first++;
      const out: number[] = [];
      for (let s = first, from = p; from < p + 1; s++) {
        const to = s < at.length ? Math.min(at[s], p + 1) : p + 1;
        out.push(s, to - from);
        from = to;
      }
      return out;
    });
    return { mids, shares };
  };
  const xs = axis(width, ox, growth.cols);
  const ys = axis(height, oy, growth.rows);

  // Each slab pair's color, found the first time a pixel needs it.
  const stride = xs.mids.length;
  const known = new Int8Array(stride * ys.mids.length).fill(-1);
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let py = 0; py < height; py++) {
    const rowShares = ys.shares[py];
    for (let px = 0; px < width; px++) {
      const colShares = xs.shares[px];
      let r = 0;
      let g = 0;
      let b = 0;
      for (let a = 0; a < rowShares.length; a += 2)
        for (let e = 0; e < colShares.length; e += 2) {
          const key = rowShares[a] * stride + colShares[e];
          let k = known[key];
          if (k < 0)
            k = known[key] = shade(
              xs.mids[colShares[e]],
              ys.mids[rowShares[a]],
            );
          const c = colors[k];
          const w = rowShares[a + 1] * colShares[e + 1];
          r += c[0] * w;
          g += c[1] * w;
          b += c[2] * w;
        }
      const o = (py * width + px) * 4;
      data[o] = Math.round(r);
      data[o + 1] = Math.round(g);
      data[o + 2] = Math.round(b);
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export const apparatus1: Style = { id: "apparat1", draw };
