import { perlin2 } from "../exact";
import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Contour bands: Kjetil Golid's screenprinted topographic map. Marching squares cuts an octave noise field into
// bands at evenly spaced heights, and each band is filled flat with a palette color. Ported from the
// `index-interactive-cols` sketch in topographic (github.com/kgolid/topographic), under its license:
//
//   MIT License
//
//   Copyright (c) 2020 Kjetil Midtgarden Golid
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
// The original samples simplex noise on a grid and fills each cell's marching-squares polygons, one pass per
// height. Its polygons cut each cell edge where the linear interpolation between corners crosses the height,
// which is where the bilinear interpolation of the corners crosses it too. So here each pixel interpolates the
// grid bilinearly and takes the band its height falls in, blending into the next band by its distance to the
// boundary. That needs only exact arithmetic, so the pixels match in every browser and Node (ADR 0001), and
// the grid is fixed in art units, so the picture matches at any size.

type Rgb = [number, number, number];

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

// Grid cells across the art's short side. The original uses 400 on an 800 px canvas: 2 px cells, small enough
// that the polygons read as smooth curves. At 2048 px these cells are about 12 px, still smooth.
const CELLS = 128;
// Noise octaves. The original sums 16, but at our persistence of at most 0.4 the fifth would weigh under 3% of
// the first, too little to move a band edge visibly.
const OCTAVES = 4;

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const noise = perlin2(seed);
  // Noise lattice cells across the short side: the original's field spans 2 (scale 400 on 800 px). A stamp
  // shows a smaller crop, so its bands stay wide enough to read at desk size. Persistence brackets the
  // original's 0.3: higher turns the bands into camouflage blots at stamp size.
  const span = 1 + 0.7 * rand();
  const persistence = 0.25 + 0.15 * rand();
  // Each octave reads its own patch of the field, as the original reads its own slice of 3D noise.
  // Flat arrays, read by index: field() runs for every grid node, so it stays free of iterators.
  const ox = new Float64Array(OCTAVES);
  const oy = new Float64Array(OCTAVES);
  for (let k = 0; k < OCTAVES; k++)
    [ox[k], oy[k]] = [256 * rand(), 256 * rand()];
  // The original's height at (u, v), in short-side units from the art's center: octaves summed and divided by
  // their total amplitude.
  const field = (u: number, v: number) => {
    let sum = 0;
    let total = 0;
    let amp = 1;
    let freq = span;
    for (let k = 0; k < OCTAVES; k++) {
      sum += amp * noise(u * freq + ox[k], v * freq + oy[k]);
      total += amp;
      amp *= persistence;
      freq *= 2;
    }
    return sum / total;
  };

  // The original steps its heights 1/40 apart, about 50 bands across its field. A stamp keeps 6 to 10, spread
  // evenly over the heights in the centered square every punch shape contains, so each stamp uses them all.
  // Heights outside that range, in a landscape or portrait stamp's ends, fall in the end bands.
  const bands = 6 + Math.floor(5 * rand());
  let [lo, hi] = [Infinity, -Infinity];
  for (let i = 0; i <= 32; i++)
    for (let j = 0; j <= 32; j++) {
      const h = field(i / 32 - 0.5, j / 32 - 0.5);
      [lo, hi] = [Math.min(lo, h), Math.max(hi, h)];
    }
  const steps = Array.from(
    { length: bands - 1 },
    (_, k) => lo + ((hi - lo) * (k + 1)) / bands,
  );
  // The original picks each band's color at random from the palette. With our three to five colors, paper
  // included, a repeat would merge two bands, so each band takes a different color from the one below it.
  const colors = [paper, ...inks].map(rgb);
  const fill: Rgb[] = [];
  let color = Math.floor(rand() * colors.length);
  for (let b = 0; b < bands; b++) {
    if (b > 0)
      color =
        (color + 1 + Math.floor(rand() * (colors.length - 1))) % colors.length;
    fill.push(colors[color]);
  }

  // Grid nodes sit CELLS to the short side, centered on the art. A pixel's center at p lies `(p + 0.5 -
  // size / 2) * s` cells from the center, so the grid spans from the first pixel's cell to past the last's.
  const unit = Math.min(width, height);
  const s = CELLS / unit;
  const axis = (pixels: number) => {
    const first = Math.floor((0.5 - pixels / 2) * s);
    const cell = new Int32Array(pixels);
    const frac = new Float64Array(pixels);
    for (let p = 0; p < pixels; p++) {
      const g = (p + 0.5 - pixels / 2) * s;
      const i = Math.floor(g);
      cell[p] = i - first;
      frac[p] = g - i;
    }
    return { first, cell, frac, nodes: cell[pixels - 1] + 2 };
  };
  const xs = axis(width);
  const ys = axis(height);
  const grid = new Float64Array(xs.nodes * ys.nodes);
  for (let j = 0; j < ys.nodes; j++)
    for (let i = 0; i < xs.nodes; i++)
      grid[j * xs.nodes + i] = field(
        (i + xs.first) / CELLS,
        (j + ys.first) / CELLS,
      );

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let py = 0; py < height; py++) {
    const row = ys.cell[py] * xs.nodes;
    const fy = ys.frac[py];
    for (let px = 0; px < width; px++) {
      const k = row + xs.cell[px];
      const fx = xs.frac[px];
      const a = grid[k];
      const b = grid[k + 1];
      const c = grid[k + xs.nodes];
      const d = grid[k + xs.nodes + 1];
      const top = a + (b - a) * fx;
      const bottom = c + (d - c) * fx;
      const h = top + (bottom - top) * fy;
      // The height's slope in units per pixel, so a height difference over it is a distance in pixels.
      const gx = (b - a + (d - c - (b - a)) * fy) * s;
      const gy = (bottom - top) * s;
      const slope = Math.sqrt(gx * gx + gy * gy);

      let band = 0;
      while (band < steps.length && h > steps[band]) band++;
      // Within half a pixel of a boundary, the pixel takes the neighbor band's color in proportion to its
      // area past the boundary, as a straight edge through the pixel would cover it. Each share is at most
      // half, so a band thinner than a pixel still leaves its own color a share.
      let below = 0;
      let above = 0;
      if (slope > 0) {
        if (band > 0) below = Math.max(0, 0.5 - (h - steps[band - 1]) / slope);
        if (band < steps.length)
          above = Math.max(0, 0.5 - (steps[band] - h) / slope);
      }
      const own = 1 - below - above;
      const p = fill[band];
      const q = fill[band > 0 ? band - 1 : band];
      const r = fill[band < steps.length ? band + 1 : band];
      const o = (py * width + px) * 4;
      data[o] = Math.round(p[0] * own + q[0] * below + r[0] * above);
      data[o + 1] = Math.round(p[1] * own + q[1] * below + r[1] * above);
      data[o + 2] = Math.round(p[2] * own + q[2] * below + r[2] * above);
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export const contourBands1: Style = { id: "contour1", draw };
