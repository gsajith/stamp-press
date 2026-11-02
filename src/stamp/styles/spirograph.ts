// Spirograph rosette: g.wygonik's Spiroh, a guilloche maker. Three layers, each a ring of equal circles whose
// centers sit evenly round the middle, drawn in fine lines that cross into a rosette like banknote engraving.
// Each layer has Spiroh's five controls: how many circles, their radius, how far their centers sit from the
// middle, line thickness and a turn. Some seeds clear the middle for a denomination, as on a banknote.
// https://github.com/gwygonik/Spiroh
//
// Ported from spiroh.pde, which is released under the Unlicense:
//
// This is free and unencumbered software released into the public domain.
//
// Anyone is free to copy, modify, publish, use, compile, sell, or
// distribute this software, either in source code form or as a compiled
// binary, for any purpose, commercial or non-commercial, and by any
// means.
//
// In jurisdictions that recognize copyright laws, the author or authors
// of this software dedicate any and all copyright interest in the
// software to the public domain. We make this dedication for the benefit
// of the public at large and to the detriment of our heirs and
// successors. We intend this dedication to be an overt act of
// relinquishment in perpetuity of all present and future rights to this
// software under copyright law.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
// IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
// OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
// ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
// OTHER DEALINGS IN THE SOFTWARE.
//
// For more information, please refer to <http://unlicense.org>
//
// Spiroh strokes ellipses on a Processing canvas, whose pixels differ between renderers. Here each circle is
// rasterized over its thin ring of pixels with IEEE-exact arithmetic (ADR 0001): a pixel's distance to a circle
// needs only a square root. Units: the art's short side is 1.

import { cos, sin } from "../exact";
import type { Palette } from "../palettes";
import { pick, stream } from "../random";
import type { Style } from "../sources";

type Rgb = [number, number, number];

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

const TAU = 6.283185307179586;

// The share of a square cell, 1 wide, that a line `half` wide covers when the cell's center sits `d` from its
// middle. Exact for straight lines, so a line keeps its weight at any size, even thinner than a pixel.
const cover = (d: number, half: number) =>
  clamp01(Math.min(d + 0.5, half) - Math.max(d - 0.5, -half));

// One of Spiroh's layers: `count` circles of `radius`, their centers spread evenly on a circle `distance` from
// the middle and turned by `turn`, each stroked `half` wide on either side.
type Layer = {
  count: number;
  radius: number;
  distance: number;
  turn: number;
  half: number;
  color: Rgb;
};

// A fine engraved line's full width: 0.7 to 1.1 pixels on the desk, where the art's short side is 142 to 225 pixels
// across margin and full-bleed stamps.
const FINE = 0.005;

// A layer reaching `extent` from the middle, its circles' centers `ratio` times their radius from it. Below 1
// every circle rings the middle, at 1 they all pass through it, above 1 they leave a hole.
function layer(
  extent: number,
  ratio: number,
  count: number,
  weight: number,
  rand: () => number,
  color: Rgb,
): Layer {
  const radius = extent / (1 + ratio);
  return {
    count,
    radius,
    distance: radius * ratio,
    turn: (TAU * rand()) / count,
    half: (FINE * weight) / 2,
    color,
  };
}

// Pick an integer in [lo, hi].
const int = (rand: () => number, lo: number, hi: number) =>
  lo + Math.floor(rand() * (hi - lo + 1));

// Denomination numerals as polylines in a box 0.6 wide and 1 tall, y down.
type Glyph = readonly (readonly [number, number])[][];
// Points along an ellipse from angle a0 to a1, in turns, y down: a quarter turn is straight down.
function arc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
): [number, number][] {
  const steps = Math.ceil(Math.abs(a1 - a0) * 32);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = TAU * (a0 + ((a1 - a0) * i) / steps);
    return [cx + rx * cos(a), cy + ry * sin(a)];
  });
}
const DIGITS: Record<string, Glyph> = {
  "0": [arc(0.3, 0.5, 0.3, 0.5, 0, 1)],
  "1": [
    [
      [0.1, 0.2],
      [0.35, 0],
      [0.35, 1],
    ],
  ],
  "2": [[...arc(0.3, 0.28, 0.3, 0.28, 0.5, 1.1), [0, 1], [0.6, 1]]],
  "3": [
    [
      ...arc(0.3, 0.25, 0.28, 0.25, 0.55, 1.25),
      ...arc(0.3, 0.73, 0.3, 0.27, 0.75, 1.42),
    ],
  ],
  "5": [
    [
      [0.58, 0],
      [0.06, 0],
      [0.03, 0.45],
      ...arc(0.3, 0.68, 0.3, 0.32, 0.61, 1.45),
    ],
  ],
};
const VALUES = ["1", "2", "3", "5", "10", "20", "25", "50"];
// A numeral's advance in heights.
const ADVANCE = 0.9;

// The segments that write `text` `h` tall, centered on (x, y): [ax, ay, bx, by] each.
function numeral(text: string, x: number, y: number, h: number): number[][] {
  const width = (text.length - 1) * ADVANCE + 0.6;
  const segments: number[][] = [];
  [...text].forEach((ch, k) => {
    const left = x + (k * ADVANCE - width / 2) * h;
    const top = y - h / 2;
    for (const line of DIGITS[ch])
      for (let i = 1; i < line.length; i++)
        segments.push([
          left + line[i - 1][0] * h,
          top + line[i - 1][1] * h,
          left + line[i][0] * h,
          top + line[i][1] * h,
        ]);
  });
  return segments;
}

// Distance from (px, py) to the segment from (ax, ay) to (bx, by).
function segmentDistance(
  px: number,
  py: number,
  [ax, ay, bx, by]: number[],
): number {
  const [dx, dy] = [bx - ax, by - ay];
  const length2 = dx * dx + dy * dy;
  const t =
    length2 === 0 ? 0 : clamp01(((px - ax) * dx + (py - ay) * dy) / length2);
  const [ex, ey] = [px - ax - t * dx, py - ay - t * dy];
  return Math.sqrt(ex * ex + ey * ey);
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const ink = inks.map(rgb);
  const last = ink[ink.length - 1];

  // Spiroh's three layers, outside in, each inside the last. The outer one is always a fine lattice of many
  // circles. The middle and core may instead be a few bold circles, like Spiroh's heavier samples.
  const e0 = 0.43 + 0.05 * rand();
  let e1 = e0 * (0.4 + 0.25 * rand());
  let e2 = e1 * (0.35 + 0.3 * rand());
  // Some seeds clear a disc in the middle for a denomination, ringed by a keyline. The core grows to frame it.
  const value = rand() < 0.35 ? pick(VALUES, rand) : "";
  const knock = value ? 0.075 + 0.025 * rand() : 0;
  if (value) {
    e2 = Math.max(e2, knock * (1.5 + 0.4 * rand()));
    e1 = Math.max(e1, e2 * (1.3 + 0.3 * rand()));
  }
  const midBold = rand() < 0.3;
  const coreBold = rand() < 0.4;
  // The outer layer takes the darkest ink, the middle the second, the core the darkest or the lightest.
  const coreInk = rand() < 0.5 ? ink[0] : last;
  const layers: Layer[] = [
    layer(e0, 0.35 + 0.95 * rand(), int(rand, 24, 48), 1, rand, ink[0]),
    midBold
      ? layer(e1, 0.5 + 0.8 * rand(), int(rand, 5, 10), 2.5, rand, ink[1])
      : layer(e1, 0.3 + 1.2 * rand(), int(rand, 16, 36), 1, rand, ink[1]),
    coreBold
      ? layer(e2, 0.4 + 1.2 * rand(), int(rand, 5, 9), 2, rand, coreInk)
      : layer(e2, 0.3 + 1.3 * rand(), int(rand, 8, 18), 1, rand, coreInk),
  ];
  if (value) layers.push(layer(knock, 0, 1, 1.5, rand, ink[0]));

  // Fine lines at a small size need more than one sample per pixel to keep their weight and shape, so each
  // pixel averages an n by n grid of samples, enough that a sample spans at most 1/280 of the short side. That
  // keeps every desk stamp, margin ones included, at 2 by 2.
  const unit = Math.min(width, height);
  const n = Math.max(1, Math.ceil(280 / unit));
  // Sample units from here on: the art's short side is `size` samples.
  const size = unit * n;
  const [cols, rows] = [width * n, height * n];
  const [mx, my] = [cols / 2, rows / 2];
  const clear = knock * size;
  // Each sample's share of paper left by the layer being drawn.
  const blank = new Float32Array(cols * rows);

  const image = ctx.createImageData(width, height);
  const data = image.data;
  const base = rgb(paper);
  for (let p = 0; p < data.length; p += 4) {
    data[p] = base[0];
    data[p + 1] = base[1];
    data[p + 2] = base[2];
    data[p + 3] = 255;
  }

  // The pixels within `extent` samples of the middle, as [x0, y0, x1, y1].
  const bounds = (extent: number) => [
    Math.max(0, Math.floor((mx - extent) / n)),
    Math.max(0, Math.floor((my - extent) / n)),
    Math.min(width, Math.ceil((mx + extent) / n)),
    Math.min(height, Math.ceil((my + extent) / n)),
  ];

  // Prints `color` over the pixels in `box`, covering each by the share of its samples `blank` leaves inked. It
  // mixes into the pixel's color so far, not each sample's, which only matters where layers cross in one pixel.
  function paint(color: Rgb, [x0, y0, x1, y1]: number[]) {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        let sum = 0;
        for (let j = 0; j < n; j++)
          for (let i = 0; i < n; i++)
            sum += blank[(y * n + j) * cols + x * n + i];
        const t = 1 - sum / (n * n);
        if (t <= 0) continue;
        const p = (y * width + x) * 4;
        for (let c = 0; c < 3; c++)
          data[p + c] = Math.round(data[p + c] + (color[c] - data[p + c]) * t);
      }
  }

  for (const { count, radius, distance, turn, half, color } of layers) {
    const r = radius * size;
    const h = half * size;
    // Samples further than `reach` from a circle's radius it misses.
    const reach = h + 1;
    // Only the denomination's keyline is a single circle on the middle.
    const keyline = distance === 0;
    // The pixels this layer touches.
    const box = bounds((radius + distance) * size + reach);
    const [x0, y0, x1, y1] = box;
    for (let y = y0 * n; y < y1 * n; y++)
      blank.fill(1, y * cols + x0 * n, y * cols + x1 * n);

    // Strokes the samples of row j from x = from to x = to with the circle of radius r centered on (cx, cy).
    // The hot loop: a desk-size draw runs it over about a million samples, so it allocates nothing.
    const stroke = (
      j: number,
      cx: number,
      cy: number,
      from: number,
      to: number,
    ) => {
      const dy = j + 0.5 - cy;
      const ey = j + 0.5 - my;
      const i0 = Math.max(0, Math.floor(from - 0.5));
      const i1 = Math.min(cols, Math.ceil(to + 0.5));
      for (let i = i0; i < i1; i++) {
        const dx = i + 0.5 - cx;
        const t = cover(Math.abs(Math.sqrt(dx * dx + dy * dy) - r), h);
        if (t <= 0) continue;
        // Lines stop at the denomination's keyline.
        if (!keyline && clear > 0) {
          const ex = i + 0.5 - mx;
          if (ex * ex + ey * ey < clear * clear) continue;
        }
        blank[j * cols + i] *= 1 - t;
      }
    };

    for (let k = 0; k < count; k++) {
      // Spiroh places circle k at (sin, cos) of its angle times the distance, then turns the layer.
      const a = turn + (TAU * k) / count;
      const cx = mx + distance * size * sin(a);
      const cy = my + distance * size * cos(a);
      const outer = r + reach;
      const inner = r - reach;
      const top = Math.max(0, Math.floor(cy - outer));
      const bottom = Math.min(rows, Math.ceil(cy + outer));
      for (let j = top; j < bottom; j++) {
        const dy = j + 0.5 - cy;
        if (dy * dy >= outer * outer) continue;
        const wide = Math.sqrt(outer * outer - dy * dy);
        // The ring crosses this row in two spans either side of its hole, or in one past the hole's top and bottom.
        if (inner > 0 && dy * dy < inner * inner) {
          const narrow = Math.sqrt(inner * inner - dy * dy);
          stroke(j, cx, cy, cx - wide, cx - narrow);
          stroke(j, cx, cy, cx + narrow, cx + wide);
        } else stroke(j, cx, cy, cx - wide, cx + wide);
      }
    }
    paint(color, box);
  }

  if (value) {
    // The numeral in the darkest ink, sized to fit inside the keyline.
    const h = (value.length > 1 ? 0.9 : 1.15) * clear;
    const segments = numeral(value, mx, my, h);
    const stroke = 0.075 * h;
    const box = bounds(clear);
    const [x0, y0, x1, y1] = box;
    for (let j = y0 * n; j < y1 * n; j++)
      for (let i = x0 * n; i < x1 * n; i++) {
        let d = Infinity;
        for (const s of segments)
          d = Math.min(d, segmentDistance(i + 0.5, j + 0.5, s));
        blank[j * cols + i] = 1 - cover(d, stroke);
      }
    paint(ink[0], box);
  }
  ctx.putImageData(image, 0, 0);
}

export const spirograph1: Style = {
  id: "spiro1",
  draw,
};
