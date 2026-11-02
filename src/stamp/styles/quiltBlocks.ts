// Quilt blocks: a pieced patchwork quilt in big flat shapes, ported from Kjetil Golid's tilework and patchwork
// sketches. Half the seeds lay a grid of single blocks, mostly half- and quarter-square triangles with a few
// of tilework's circle tiles, each block in two or three of the palette's colors. The other half use
// patchwork4's layout: the quilt splits recursively into rectangles, and each rectangle repeats one 2x2 set of
// patches in two inks on the paper, so large fields of one pattern sit beside small odd blocks. Faint running
// stitches sometimes follow the seams, too thin to read at desk size but clear when zoomed in.
//
// Like the other styles it computes every pixel itself, in units of the patch grid, so it is resolution
// independent, and with only IEEE-exact arithmetic its pixels match in every browser and in Node (ADR 0001).
// Every turn is a quarter turn, so no trigonometry is needed.
//
// Ported from https://github.com/kgolid/tilework (tiles.js, index.js) and
// https://github.com/kgolid/p5ycho (patchwork, patchwork4), both under the MIT License:
//
//   tilework: Copyright (c) 2020 Kjetil Midtgarden Golid
//   p5ycho: Copyright (c) 2017 Kjetil Midtgarden Golid
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

// ---- Shapes ----
// Each is a region of a unit patch, x right and y down, as Golid's p5 paths draw it. Kinds are numbers and one
// switch tests them all, which keeps the per-pixel path fast.
const R = {
  square: 0,
  half: 1,
  smallSquare: 2,
  ell: 3,
  corner: 4,
  diagonal: 5,
  triangle: 6,
  house: 7,
  arrow: 8,
  semi: 9,
  quarter: 10,
  // tilework's own tiles
  halfTriangle: 11,
  bigQuarter: 12,
  disc: 13,
  smallDisc: 14,
} as const;
type Kind = (typeof R)[keyof typeof R];

function inKind(kind: Kind, x: number, y: number): boolean {
  const unit = x >= 0 && y >= 0 && x < 1 && y < 1;
  switch (kind) {
    case R.square:
      return x >= 0 && y >= 0 && x < 0.5 && y < 0.5;
    case R.half:
      return unit && y < 0.5;
    case R.smallSquare:
      return x >= 0 && y >= 0 && x < 1 / 3 && y < 1 / 3;
    case R.ell:
      return unit && (x < 1 / 3 || y < 1 / 3);
    case R.corner:
      return x >= 0 && y >= 0 && x + y < 0.5;
    case R.diagonal:
      return x >= 0 && y >= 0 && x + y >= 0.5 && x + y < 1;
    case R.triangle:
      return y >= 0 && y < x && y < 1 - x;
    case R.house:
      return x >= 0 && x < 0.5 && y >= 0 && y < 0.5 + x;
    case R.arrow: {
      const d = Math.abs(x - 0.5);
      return d <= 0.5 && y >= 0.5 - d && y < 1 - d;
    }
    case R.semi:
      return y >= 0 && (x - 0.5) * (x - 0.5) + y * y < 0.25;
    case R.quarter:
      return x >= 0 && y >= 0 && x * x + y * y < 0.25;
    case R.halfTriangle:
      return unit && y > x;
    case R.bigQuarter:
      return x >= 0 && y >= 0 && x * x + y * y < 1;
    case R.disc:
      return (x - 0.5) * (x - 0.5) + (y - 0.5) * (y - 0.5) < 0.25;
    case R.smallDisc:
      return (x - 0.5) * (x - 0.5) + (y - 0.5) * (y - 0.5) < 0.0625;
  }
}

// A point of a unit patch after undoing `turns` quarter turns about its center, one coordinate at a time so
// the per-pixel path allocates nothing.
const turnU = (u: number, v: number, turns: number) =>
  turns === 0 ? u : turns === 1 ? v : turns === 2 ? 1 - u : 1 - v;
const turnV = (u: number, v: number, turns: number) =>
  turns === 0 ? v : turns === 1 ? 1 - u : turns === 2 ? 1 - v : u;

// A shape placed in a patch: p5's translate(0.5, 0.5), rotate(turns quarter turns), translate(-0.5, -0.5),
// translate(dx, dy).
type Shape = { kind: Kind; dx: number; dy: number; turns: number };
const shape = (kind: Kind, dx: number, dy: number, turns: number): Shape => ({
  kind,
  dx,
  dy,
  turns,
});
const hit = ({ kind, dx, dy, turns }: Shape, u: number, v: number) =>
  inKind(kind, turnU(u, v, turns) - dx, turnV(u, v, turns) - dy);

// A patch: shapes in its first color, then shapes in its second over them, on its ground.
type Patch = readonly [readonly Shape[], readonly Shape[]];

// patchwork4's patches.
const checkered: Patch = [
  [shape(R.square, 0, 0, 0)],
  [shape(R.square, 0.5, 0.5, 0)],
];
const halfNHalf: Patch = [[shape(R.half, 0, 0, 0)], [shape(R.half, 0, 0, 2)]];
const diagonalStripes: Patch = [
  [shape(R.corner, 0, 0, 0), shape(R.corner, 0, 0, 2)],
  [shape(R.diagonal, 0, 0, 0)],
];
const skewed: Patch = [[shape(R.house, 0, 0, 0)], [shape(R.house, 0, 0, 2)]];
const wedge: Patch = [[shape(R.triangle, 0, 0, 0)], [shape(R.arrow, 0, 0, 0)]];
const spruce: Patch = [
  [shape(R.triangle, 0, 0, 0), shape(R.triangle, 0, 0.5, 0)],
  [shape(R.corner, 0, 0.5, 2), shape(R.corner, 0.5, 0, 3)],
];
const corners: Patch = [
  [shape(R.quarter, 0, 0, 0), shape(R.quarter, 0, 0, 2)],
  [shape(R.quarter, 0, 0, 1), shape(R.quarter, 0, 0, 3)],
];
const kings: Patch = [
  [shape(R.quarter, 0, 0, 0), shape(R.quarter, 0, 0.5, 3)],
  [shape(R.quarter, 0, 0, 3), shape(R.quarter, 0.5, 0, 0)],
];
const kingsFlipped: Patch = [kings[1], kings[0]];
const yoyo: Patch = [[shape(R.semi, 0, 0, 0)], [shape(R.semi, 0, 0, 2)]];
const ellAndSquare: Patch = [
  [shape(R.smallSquare, 0, 0, 0)],
  [shape(R.ell, 0, 0, 2)],
];
const trisquare: Patch = [
  [shape(R.square, 0, 0, 0)],
  [shape(R.corner, 0, 0, 1), shape(R.corner, 0, 0, 3)],
];

const PATCHES: readonly Patch[] = [
  checkered,
  halfNHalf,
  diagonalStripes,
  skewed,
  wedge,
  spruce,
  corners,
  kings,
  kingsFlipped,
  yoyo,
  ellAndSquare,
  trisquare,
];

// patchwork4's patch sets: four patches and their turns, laid clockwise from the top left of a 2x2 block.
type PatchSet = readonly [
  Patch,
  number,
  Patch,
  number,
  Patch,
  number,
  Patch,
  number,
];
const ds = diagonalStripes;
const PATCH_SETS: readonly PatchSet[] = [
  [ds, 0, ds, 1, ds, 2, ds, 3],
  [ds, 2, ds, 3, ds, 0, ds, 1],
  [ds, 2, ds, 2, ds, 1, ds, 1],
  [ds, 0, ds, 0, ds, 0, ds, 0],
  [checkered, 0, checkered, 1, checkered, 2, checkered, 3],
  [checkered, 0, halfNHalf, 2, checkered, 2, halfNHalf, 0],
  [corners, 0, corners, 1, corners, 0, corners, 1],
  [kings, 0, kings, 0, kingsFlipped, 2, kingsFlipped, 2],
  [kings, 2, kings, 3, kings, 0, kings, 1],
  [yoyo, 1, yoyo, 3, yoyo, 1, yoyo, 3],
  [ellAndSquare, 0, ellAndSquare, 1, ellAndSquare, 2, ellAndSquare, 3],
  [ellAndSquare, 2, ellAndSquare, 3, ellAndSquare, 0, ellAndSquare, 1],
  [skewed, 0, skewed, 1, skewed, 2, skewed, 3],
  [spruce, 2, spruce, 2, spruce, 2, spruce, 2],
];

// tilework's blocks, as patches whose ground is a third color. Weighted by repeats toward the half-square
// triangle, with quarter-square triangles (an hourglass in two colors, or three) and a few of tilework's
// fills, halves and circles.
const hst: Patch = [[shape(R.halfTriangle, 0, 0, 0)], []];
const hourglass: Patch = [
  [shape(R.triangle, 0, 0, 0), shape(R.triangle, 0, 0, 2)],
  [],
];
const qst: Patch = [
  [shape(R.triangle, 0, 0, 0), shape(R.triangle, 0, 0, 2)],
  [shape(R.triangle, 0, 0, 1)],
];
const BLOCKS: readonly Patch[] = [
  hst,
  hst,
  hst,
  hst,
  hst,
  hourglass,
  hourglass,
  qst,
  qst,
  [[], []], // filled
  [[shape(R.half, 0, 0, 0)], []],
  [[shape(R.bigQuarter, 0, 0, 0)], []],
  [[shape(R.bigQuarter, 0, 0, 0)], []],
  [[shape(R.semi, 0, 0, 0)], []],
  [[shape(R.disc, 0, 0, 0)], []],
  [[shape(R.smallDisc, 0, 0, 0)], []],
];

// One cell of the quilt: a patch, its turns, and its ground, first and second colors as palette indices
// (0 is the paper, then the inks).
type Cell = {
  patch: Patch;
  turns: number;
  colors: readonly [number, number, number];
};

function shuffled<T>(list: readonly T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// tilework: every cell its own block, in three of the palette's colors.
function tileworkCells(
  g: number,
  colorCount: number,
  rand: () => number,
): Cell[] {
  const all = Array.from({ length: colorCount }, (_, i) => i);
  return Array.from({ length: g * g }, () => {
    const [ground, a, b] = shuffled(all, rand);
    return {
      patch: pick(BLOCKS, rand),
      turns: Math.floor(rand() * 4),
      colors: [ground, a, b],
    };
  });
}

// patchwork4's fill_block: splits the quilt into rectangles, each one patch or one repeating patch set, in two
// inks on the paper.
function patchworkCells(
  g: number,
  inkCount: number,
  rand: () => number,
): Cell[] {
  const cells: Cell[] = new Array(g * g);
  const inks = Array.from({ length: inkCount }, (_, i) => i + 1);
  const twoInks = (): [number, number, number] => {
    const [a, b] = shuffled(inks, rand);
    return [0, a, b];
  };
  const square = (x: number, y: number) => {
    const colors = twoInks();
    const turns = Math.floor(rand() * 4);
    cells[y * g + x] = { patch: pick(PATCHES, rand), turns, colors };
  };
  const pattern = (x: number, y: number, w: number, h: number) => {
    const set = pick(PATCH_SETS, rand);
    const colors = twoInks();
    const rot = Math.floor(rand() * 4);
    for (let i = 0; i < h; i++)
      for (let j = 0; j < w; j++) {
        const n = i % 2 === 0 ? j % 2 : 3 - (j % 2);
        const m = (((n - rot) % 4) + 4) % 4;
        cells[(y + i) * g + x + j] = {
          patch: set[2 * m] as Patch,
          turns: ((set[2 * m + 1] as number) + rot) % 4,
          colors,
        };
      }
  };
  const block = (x: number, y: number, w: number, h: number) => {
    if (w === 1 && h === 1) square(x, y);
    else if (w <= 3 && h <= 3) pattern(x, y, w, h);
    else if (rand() < 0.7) {
      const tieBreak = rand();
      if (w > h || (w === h && tieBreak > 0.7)) {
        const split = 2 + Math.floor(rand() * (w - 3));
        block(x, y, split, h);
        block(x + split, y, w - split, h);
      } else {
        const split = 2 + Math.floor(rand() * (h - 3));
        block(x, y, w, split);
        block(x, y + split, w, h - split);
      }
    } else pattern(x, y, w, h);
  };
  block(0, 0, g, g);
  return cells;
}

// Running stitches along the seams: a stitch and a gap per a sixth of a patch, a seventieth of a patch wide.
const STITCH = { period: 1 / 6, on: 0.55 / 6, width: 1 / 70, strength: 0.45 };

// The length of stitch along a seam from 0 to t, in patch units.
const stitched = (t: number) => {
  const k = Math.floor(t / STITCH.period);
  return k * STITCH.on + Math.min(t - k * STITCH.period, STITCH.on);
};

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const colors = [paper, ...inks].map(rgb);
  const tilework = rand() < 0.5;
  // Patches across the short side: tilework's blocks are bigger.
  const n = tilework ? 3 + Math.floor(rand() * 4) : 5 + Math.floor(rand() * 4);
  const stitches = rand() < 0.65;
  // The layout is a square grid of g patches a side, generated whole and cropped, so it doesn't depend on the
  // art's ratio. n patches fit the short side exactly, with k more each side to cover the long side at the
  // widest ratio a stamp allows (1.4).
  const k = Math.ceil(0.21 * n);
  const g = n + 2 * k;
  const cells = tilework
    ? tileworkCells(g, colors.length, stream(seed, 1))
    : patchworkCells(g, inks.length, stream(seed, 1));

  // Pixel (px, py) in patch units, the grid centred on the art.
  const size = Math.min(width, height) / n;
  const [ox, oy] = [width / 2 - (g / 2) * size, height / 2 - (g / 2) * size];
  const clampCell = (i: number) => (i < 0 ? 0 : i >= g ? g - 1 : i);

  // The palette index at point (x, y) in patch units.
  const colorAt = (x: number, y: number): number => {
    const i = clampCell(Math.floor(x));
    const j = clampCell(Math.floor(y));
    const { patch, turns, colors: c } = cells[j * g + i];
    const u = turnU(x - i, y - j, turns);
    const v = turnV(x - i, y - j, turns);
    for (const s of patch[1]) if (hit(s, u, v)) return c[2];
    for (const s of patch[0]) if (hit(s, u, v)) return c[1];
    return c[0];
  };
  const gx = (px: number) => (px - ox) / size;
  const gy = (py: number) => (py - oy) / size;

  // The color index at every pixel corner. A pixel whose corners agree is solid unless a shape could hide
  // inside it, so only pixels on an edge are supersampled. The smallest shape is about a sixth of a patch.
  const corners = new Uint8Array((width + 1) * (height + 1));
  for (let y = 0; y <= height; y++)
    for (let x = 0; x <= width; x++)
      corners[y * (width + 1) + x] = colorAt(gx(x), gy(y));
  const tiny = size / 6 < 2;
  const S = tiny ? 8 : 4; // samples per side

  // How much of the pixel span [a, a + 1] (pixels, along one axis) the seams across that axis cover, times how
  // much of the span [b, b + 1] along the seam is stitched.
  const half = (STITCH.width / 2) * size;
  const seamCover = (a: number, origin: number, b: number, bOrigin: number) => {
    const seam = origin + Math.round((a + 0.5 - origin) / size) * size;
    const across = Math.min(a + 1, seam + half) - Math.max(a, seam - half);
    if (across <= 0) return 0;
    const t0 = (b - bOrigin) / size;
    const t1 = (b + 1 - bOrigin) / size;
    return across * ((stitched(t1) - stitched(t0)) / (t1 - t0));
  };

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const c = y * (width + 1) + x;
      const c0 = corners[c];
      let color: Rgb;
      if (
        !tiny &&
        c0 === corners[c + 1] &&
        c0 === corners[c + width + 1] &&
        c0 === corners[c + width + 2]
      )
        color = colors[c0];
      else {
        color = [0, 0, 0];
        for (let sy = 0; sy < S; sy++)
          for (let sx = 0; sx < S; sx++) {
            const s =
              colors[colorAt(gx(x + (sx + 0.5) / S), gy(y + (sy + 0.5) / S))];
            color[0] += s[0];
            color[1] += s[1];
            color[2] += s[2];
          }
        color = [color[0] / (S * S), color[1] / (S * S), color[2] / (S * S)];
      }
      if (stitches) {
        const cover = Math.min(
          1,
          seamCover(x, ox, y, oy) + seamCover(y, oy, x, ox),
        );
        if (cover > 0) {
          // Dark thread on the paper, paper-colored thread on the inks.
          const under = colorAt(gx(x + 0.5), gy(y + 0.5));
          const thread = colors[under === 0 ? 1 : 0];
          color = mix(color, thread, cover * STITCH.strength);
        }
      }
      const p = (y * width + x) * 4;
      data[p] = Math.round(color[0]);
      data[p + 1] = Math.round(color[1]);
      data[p + 2] = Math.round(color[2]);
      data[p + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
}

export const quiltBlocks1: Style = {
  id: "quilt1",
  draw,
};
