// Plotter homage: one of the early computer-art pieces from Tim Holman's Generative Artistry tutorials, picked by
// seed. Un Deux Trois (after Vera Molnár), Cubic Disarray (after Georg Nees), Joy Division, Hypnotic Squares,
// Tiled Lines and Triangular Mesh. Each piece below follows its tutorial's final code: the same grids, the same
// random draws in the same order and the same proportions, tuned to fewer, larger cells for a stamp.
// https://generativeartistry.com, https://github.com/tholman/generative-artistry
//
// Ported from the tutorials' code, which is licensed:
//
// MIT License
//
// Copyright (c) 2018 Tim Holman
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// The tutorials draw with Canvas strokes, whose pixels differ between browsers. Here each piece lists its strokes
// and fills as marks, and every pixel's coverage is computed from them with IEEE-exact arithmetic (ADR 0001).
// Units: the art's short side is 1.

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
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// The tutorials' 2 px line on a canvas about 320 px across: a plotter pen, about 1.25 px wide at desk size.
const PEN = 1 / 320;

// A straight stroke from a to b, `half` wide on each side, with round or square ends.
type Line = {
  kind: "line";
  ax: number;
  ay: number;
  // Unit direction and length.
  ux: number;
  uy: number;
  length: number;
  half: number;
  round: boolean;
};
// A filled convex polygon: each edge as nx * x + ny * y + c, the distance inside it.
type Fill = { kind: "fill"; edges: number[] };
// A strip of paper under one segment of a Joy Division line, from the segment down to the line's baseline. It
// covers pixels whose centers sit in [ax, bx), so the strips under one line tile without seams.
type Curtain = {
  kind: "curtain";
  ax: number;
  ay: number;
  bx: number;
  slope: number;
  // The segment's cosine, which turns a vertical distance into a distance across it.
  cosine: number;
  base: number;
};
// Something printed, in paint order. The marks of one shape share a group and print as one: a pixel takes the
// most any of them covers it, so a polyline's joints and a square's corners don't print twice.
type Mark = (Line | Fill | Curtain) & {
  group: number;
  color: Rgb;
  // Bounds, including the line's width and, for a square end, the corners of its cap.
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

// Collects marks. `shape` starts a new group in a color, and the marks after it belong to it.
class Plot {
  marks: Mark[] = [];
  private group = 0;
  private color: Rgb = [0, 0, 0];

  shape(color: Rgb) {
    this.group++;
    this.color = color;
  }

  line(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    half: number,
    round = true,
  ) {
    const [dx, dy] = [bx - ax, by - ay];
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) return;
    // A square cap's corners reach half * sqrt(2) past the endpoint.
    const reach = round ? half : half * Math.SQRT2;
    this.marks.push({
      kind: "line",
      ax,
      ay,
      ux: dx / length,
      uy: dy / length,
      length,
      half,
      round,
      group: this.group,
      color: this.color,
      x0: Math.min(ax, bx) - reach,
      y0: Math.min(ay, by) - reach,
      x1: Math.max(ax, bx) + reach,
      y1: Math.max(ay, by) + reach,
    });
  }

  // A closed outline through `points`, with square ends so the corners close.
  outline(
    points: readonly (readonly [number, number])[],
    half: number,
    round = false,
  ) {
    points.forEach(([ax, ay], i) => {
      const [bx, by] = points[(i + 1) % points.length];
      this.line(ax, ay, bx, by, half, round);
    });
  }

  fill(points: readonly (readonly [number, number])[]) {
    const n = points.length;
    const cx = points.reduce((s, p) => s + p[0], 0) / n;
    const cy = points.reduce((s, p) => s + p[1], 0) / n;
    const edges: number[] = [];
    for (let i = 0; i < n; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[(i + 1) % n];
      const length = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
      if (length === 0) continue;
      let [nx, ny] = [(ay - by) / length, (bx - ax) / length];
      // Turn the normal inward, toward the centroid.
      if (nx * (cx - ax) + ny * (cy - ay) < 0) [nx, ny] = [-nx, -ny];
      edges.push(nx, ny, -(nx * ax + ny * ay));
    }
    this.marks.push({
      kind: "fill",
      edges,
      group: this.group,
      color: this.color,
      x0: Math.min(...points.map((p) => p[0])),
      y0: Math.min(...points.map((p) => p[1])),
      x1: Math.max(...points.map((p) => p[0])),
      y1: Math.max(...points.map((p) => p[1])),
    });
  }

  curtain(ax: number, ay: number, bx: number, by: number, base: number) {
    // A flat stretch lying on the baseline covers nothing.
    if (!(bx > ax) || (ay >= base && by >= base)) return;
    const length = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    this.marks.push({
      kind: "curtain",
      ax,
      ay,
      bx,
      slope: (by - ay) / (bx - ax),
      cosine: (bx - ax) / length,
      base,
      group: this.group,
      color: this.color,
      x0: ax,
      y0: Math.min(ay, by),
      x1: bx,
      y1: base,
    });
  }
}

// The share of a pixel-wide cell that a band `half` wide covers when the cell's center sits `d` from the band's
// middle, both in pixels. Exact for lines along the pixel grid, and it keeps any line's total ink, so a line
// keeps its weight at any size, even under a pixel.
const cover = (d: number, half: number) =>
  clamp01(Math.min(d + 0.5, half) - Math.max(d - 0.5, -half));

// How much of the pixel `px` wide centered at (x, y) a mark covers.
function coverage(mark: Mark, x: number, y: number, px: number): number {
  switch (mark.kind) {
    case "line": {
      const [rx, ry] = [x - mark.ax, y - mark.ay];
      const along = rx * mark.ux + ry * mark.uy;
      const across = Math.abs(rx * mark.uy - ry * mark.ux);
      if (!mark.round) {
        // A square end reaches `half` past the endpoint, like Canvas's square line cap.
        const a = along / px;
        const lo = -mark.half / px;
        const hi = (mark.length + mark.half) / px;
        return (
          cover(across / px, mark.half / px) *
          clamp01(Math.min(a + 0.5, hi) - Math.max(a - 0.5, lo))
        );
      }
      let d = across;
      if (along < 0) d = Math.sqrt(rx * rx + ry * ry);
      else if (along > mark.length) {
        const [ex, ey] = [
          rx - mark.ux * mark.length,
          ry - mark.uy * mark.length,
        ];
        d = Math.sqrt(ex * ex + ey * ey);
      }
      return cover(d / px, mark.half / px);
    }
    case "fill": {
      const e = mark.edges;
      let inside = Infinity;
      for (let i = 0; i < e.length; i += 3)
        inside = Math.min(inside, e[i] * x + e[i + 1] * y + e[i + 2]);
      return clamp01(inside / px + 0.5);
    }
    case "curtain": {
      if (x < mark.ax || x >= mark.bx) return 0;
      const top = mark.ay + mark.slope * (x - mark.ax);
      return (
        clamp01(((y - top) * mark.cosine) / px + 0.5) *
        clamp01((mark.base - y) / px + 0.5)
      );
    }
  }
}

// The pieces. Each lays out its marks on `plot` over a W by H frame, in units of the art's short side, with
// `ink` for its lines. `px` is one pixel in those units.
type Frame = {
  W: number;
  H: number;
  px: number;
  paper: Rgb;
  ink: Rgb;
  accent: Rgb;
};
type Piece = (rand: () => number, plot: Plot, frame: Frame) => void;

// Tiled Lines: every cell of a grid gets one diagonal, either way at a coin flip, which makes a maze.
const tiledLines: Piece = (rand, plot, { W, H, ink }) => {
  const step = 1 / (8 + Math.floor(rand() * 5));
  const [cols, rows] = [Math.ceil(W / step), Math.ceil(H / step)];
  const [ox, oy] = [(W - cols * step) / 2, (H - rows * step) / 2];
  plot.shape(ink);
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const [x, y] = [ox + i * step, oy + j * step];
      if (rand() >= 0.5) plot.line(x, y, x + step, y + step, PEN, false);
      else plot.line(x + step, y, x, y + step, PEN, false);
    }
};

// Un Deux Trois, after Vera Molnár: a grid of short strokes, each cell's turned at random. The top third holds
// one stroke per cell, the middle two and the bottom three. A blank cell rings the grid.
const unDeuxTrois: Piece = (rand, plot, { W, H, ink }) => {
  const step = 1 / (9 + Math.floor(rand() * 3));
  const [cols, rows] = [Math.floor(W / step) - 2, Math.floor(H / step) - 2];
  const [ox, oy] = [(W - cols * step) / 2, (H - rows * step) / 2];
  // The tutorial's 4 px stroke in a 20 px cell.
  const half = step / 10;
  const bands = [[0.5], [0.2, 0.8], [0.1, 0.5, 0.9]];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const band =
        (3 * (j + 0.5)) / rows < 1 ? 0 : (3 * (j + 0.5)) / rows < 2 ? 1 : 2;
      const angle = rand() * 5;
      const [c, s] = [cos(angle), sin(angle)];
      const [cx, cy] = [ox + (i + 0.5) * step, oy + (j + 0.5) * step];
      for (const p of bands[band]) {
        const u = (p - 0.5) * step;
        const v = step / 2;
        plot.shape(ink);
        plot.line(
          cx + u * c + v * s,
          cy + u * s - v * c,
          cx + u * c - v * s,
          cy + u * s + v * c,
          half,
        );
      }
    }
};

// Cubic Disarray, after Georg Nees: a grid of squares, ordered at the top and more turned and shifted further
// down, up to 20 degrees and half a square.
const cubicDisarray: Piece = (rand, plot, { W, H, ink }) => {
  const size = 1 / (8 + Math.floor(rand() * 4));
  const [cols, rows] = [Math.floor(W / size) - 1, Math.floor(H / size) - 1];
  const [ox, oy] = [(W - cols * size) / 2, (H - rows * size) / 2];
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const [cx, cy] = [ox + (i + 0.5) * size, oy + (j + 0.5) * size];
      const depth = cy / H;
      let plusOrMinus = rand() < 0.5 ? -1 : 1;
      const angle = ((depth * Math.PI) / 180) * plusOrMinus * rand() * 20;
      plusOrMinus = rand() < 0.5 ? -1 : 1;
      const shift = depth * plusOrMinus * rand() * (size / 2);
      const [c, s] = [cos(angle), sin(angle)];
      const h = size / 2;
      const corner = (u: number, v: number) =>
        [cx + shift + u * c - v * s, cy + u * s + v * c] as const;
      plot.shape(ink);
      plot.outline(
        [corner(-h, -h), corner(h, -h), corner(h, h), corner(-h, h)],
        PEN,
      );
    }
};

// Joy Division, after Peter Saville's cover for Unknown Pleasures: stacked lines that rise into random peaks
// toward the middle. Each line is smoothed with quadratic curves through midpoints, then paints over the lines
// above it before it's stroked, so nearer ridges hide farther ones.
const joyDivision: Piece = (rand, plot, { W, H, px, paper, ink }) => {
  const gap = 1 / (24 + Math.floor(rand() * 9));
  const margin = 0.07;
  // Peaks rise anywhere but `flat` from each side, highest in the middle.
  const flat = (0.14 + 0.08 * rand()) * W;
  const reach = (W / 2 - flat) / 2;
  const first = margin + reach * (0.75 + 0.25 * rand());
  const count = Math.floor((H - margin - first) / gap) + 1;
  const top = H - margin - (count - 1) * gap;
  // The tutorial steps the same distance between points as between lines.
  const points = Math.round((W - 2 * margin) / gap) + 1;
  const dx = (W - 2 * margin) / (points - 1);

  for (let k = 0; k < count; k++) {
    const base = top + k * gap;
    const line: [number, number][] = [];
    for (let j = 0; j < points; j++) {
      const x = margin + j * dx;
      const variance = Math.max(W / 2 - flat - Math.abs(x - W / 2), 0);
      line.push([x, base - (rand() * variance) / 2]);
    }
    // The smoothed line as a polyline: a quadratic from each midpoint to the next, around the point between.
    const curve: [number, number][] = [line[0]];
    const quad = (c: [number, number], e: [number, number]) => {
      const [s0, s1] = curve[curve.length - 1];
      // Enough segments that the polyline strays under a third of a pixel from the curve: n segments stray
      // at most |s - 2c + e| / (4 n^2). Flat stretches take one.
      const [bx, by] = [s0 - 2 * c[0] + e[0], s1 - 2 * c[1] + e[1]];
      const bend = Math.sqrt(bx * bx + by * by);
      const n = Math.max(1, Math.ceil(Math.sqrt((3 * bend) / (4 * px))));
      for (let t = 1; t <= n; t++) {
        const [a, b] = [(n - t) / n, t / n];
        curve.push([
          a * a * s0 + 2 * a * b * c[0] + b * b * e[0],
          a * a * s1 + 2 * a * b * c[1] + b * b * e[1],
        ]);
      }
    };
    for (let j = 0; j < points - 2; j++)
      quad(line[j], [
        (line[j][0] + line[j + 1][0]) / 2,
        (line[j][1] + line[j + 1][1]) / 2,
      ]);
    quad(line[points - 2], line[points - 1]);

    plot.shape(paper);
    for (let j = 1; j < curve.length; j++)
      plot.curtain(
        curve[j - 1][0],
        curve[j - 1][1],
        curve[j][0],
        curve[j][1],
        base,
      );
    plot.shape(ink);
    for (let j = 1; j < curve.length; j++)
      plot.line(
        curve[j - 1][0],
        curve[j - 1][1],
        curve[j][0],
        curve[j][1],
        PEN,
      );
  }
};

// Hypnotic Squares: a grid of tiles, each holding a few nested squares that shrink toward the middle while
// drifting toward one side or corner of the tile.
const hypnoticSquares: Piece = (rand, plot, { W, H, ink }) => {
  const offset = 0.012;
  const tile = (W - 2 * offset) / (3 + Math.floor(rand() * 3));
  const [cols, rows] = [
    Math.round((W - 2 * offset) / tile),
    Math.floor((H - 2 * offset) / tile),
  ];
  const [ox, oy] = [(W - cols * tile) / 2, (H - rows * tile) / 2];
  const finalSize = tile / 15;
  const directions = [-1, 0, 1];

  let startSteps = 0;
  const square = (
    x: number,
    y: number,
    size: number,
    xMovement: number,
    yMovement: number,
    steps: number,
  ) => {
    plot.shape(ink);
    plot.outline(
      [
        [x, y],
        [x + size, y],
        [x + size, y + size],
        [x, y + size],
      ],
      PEN,
    );
    if (steps < 0) return;
    const newSize = tile * (steps / startSteps) + finalSize;
    let newX = x + (size - newSize) / 2;
    let newY = y + (size - newSize) / 2;
    newX = newX - ((x - newX) / (steps + 2)) * xMovement;
    newY = newY - ((y - newY) / (steps + 2)) * yMovement;
    square(newX, newY, newSize, xMovement, yMovement, steps - 1);
  };

  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      startSteps = 2 + Math.ceil(rand() * 3);
      const xDirection = directions[Math.floor(rand() * directions.length)];
      const yDirection = directions[Math.floor(rand() * directions.length)];
      square(
        ox + i * tile,
        oy + j * tile,
        tile,
        xDirection,
        yDirection,
        startSteps - 1,
      );
    }
};

// Triangular Mesh: a grid of points, every other row shifted half a gap and every point jittered, joined into
// triangles shaded in one of sixteen tints.
const triangularMesh: Piece = (rand, plot, { W, H, paper, ink, accent }) => {
  const gap = W / (5 + rand() * 1.5);
  const tint = rand() < 0.5 ? ink : accent;
  // The tutorial's rows and columns, from a quarter gap in, moved so the mesh sits centered in the frame.
  const rows = Math.floor((H - gap / 2) / gap) + 1;
  const cols = Math.floor((W - gap / 4) / gap) + 1;
  const ox = (W - (cols - 1) * gap - gap / 2) / 2 - gap / 4;
  const oy = (H - (rows - 1) * gap) / 2 - gap / 2;
  const lines: [number, number][][] = [];
  let odd = false;
  for (let j = 0; j < rows; j++) {
    odd = !odd;
    const [y, line]: [number, [number, number][]] = [
      oy + gap / 2 + j * gap,
      [],
    ];
    for (let i = 0; i < cols; i++)
      line.push([
        ox +
          gap / 4 +
          i * gap +
          (rand() * 0.8 - 0.4) * gap +
          (odd ? gap / 2 : 0),
        y + (rand() * 0.8 - 0.4) * gap,
      ]);
    lines.push(line);
  }

  odd = true;
  for (let y = 0; y < lines.length - 1; y++) {
    odd = !odd;
    const dotLine: [number, number][] = [];
    for (let i = 0; i < lines[y].length; i++) {
      dotLine.push(odd ? lines[y][i] : lines[y + 1][i]);
      dotLine.push(odd ? lines[y + 1][i] : lines[y][i]);
    }
    for (let i = 0; i < dotLine.length - 2; i++) {
      const triangle = [dotLine[i], dotLine[i + 1], dotLine[i + 2]];
      // The tutorial's gray, #000 to #fff in sixteen steps.
      const gray = Math.floor(rand() * 16);
      plot.shape(mix(tint, paper, gray / 15));
      plot.fill(triangle);
      plot.shape(ink);
      plot.outline(triangle, PEN, true);
    }
  }
};

const PIECES: readonly Piece[] = [
  unDeuxTrois,
  cubicDisarray,
  joyDivision,
  hypnoticSquares,
  tiledLines,
  triangularMesh,
];

// Pixels per side of a bucket of marks. Only a speed-up: each pixel checks the marks in its bucket.
const BUCKET = 4;
// Draws with a short side under this many pixels are supersampled.
const SUPERSAMPLE_BELOW = 128;

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const piece = PIECES[Math.floor(rand() * PIECES.length)];
  const short = Math.min(width, height);
  const px = 1 / short;
  const frame: Frame = {
    W: width / short,
    px,
    H: height / short,
    paper: rgb(paper),
    ink: rgb(inks[0]),
    accent: rgb(inks[1]),
  };
  const plot = new Plot();
  piece(rand, plot, frame);
  const { marks } = plot;

  // Each mark goes in every bucket its bounds touch, a pixel past them, in paint order.
  const cols = Math.ceil(width / BUCKET);
  const rows = Math.ceil(height / BUCKET);
  const buckets: number[][] = Array.from({ length: cols * rows }, () => []);
  marks.forEach((m, k) => {
    const i0 = Math.max(0, Math.floor((m.x0 / px - 1) / BUCKET));
    const i1 = Math.min(cols - 1, Math.floor((m.x1 / px + 1) / BUCKET));
    const j0 = Math.max(0, Math.floor((m.y0 / px - 1) / BUCKET));
    const j1 = Math.min(rows - 1, Math.floor((m.y1 / px + 1) / BUCKET));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) buckets[j * cols + i].push(k);
  });

  // A small draw's lines run under a pixel apart, where a shape's largest coverage undercounts several
  // strokes sharing one pixel. So S by S samples per pixel, each a pixel of a draw S times larger.
  const S = Math.ceil(SUPERSAMPLE_BELOW / short);
  const sample = px / S;
  const image = ctx.createImageData(width, height);
  const data = image.data;
  const color = new Float64Array(3);
  const over = (c: Rgb, t: number) => {
    color[0] += (c[0] - color[0]) * t;
    color[1] += (c[1] - color[1]) * t;
    color[2] += (c[2] - color[2]) * t;
  };
  for (let py = 0; py < height; py++)
    for (let pxi = 0; pxi < width; pxi++) {
      const bucket =
        buckets[Math.floor(py / BUCKET) * cols + Math.floor(pxi / BUCKET)];
      let [r, g, b] = [0, 0, 0];
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const x = (pxi + (sx + 0.5) / S) * px;
          const y = (py + (sy + 0.5) / S) * px;
          color.set(frame.paper);
          let group = -1;
          let shade: Rgb = frame.paper;
          let most = 0;
          for (const k of bucket) {
            const m = marks[k];
            if (
              x < m.x0 - px ||
              x > m.x1 + px ||
              y < m.y0 - px ||
              y > m.y1 + px
            )
              continue;
            const c = coverage(m, x, y, sample);
            if (m.group !== group) {
              if (most > 0) over(shade, most);
              [group, shade, most] = [m.group, m.color, c];
            } else if (c > most) most = c;
          }
          if (most > 0) over(shade, most);
          [r, g, b] = [r + color[0], g + color[1], b + color[2]];
        }
      const p = (py * width + pxi) * 4;
      data[p] = Math.round(r / (S * S));
      data[p + 1] = Math.round(g / (S * S));
      data[p + 2] = Math.round(b / (S * S));
      data[p + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
}

export const plotterHomage1: Style = {
  id: "homage1",
  draw,
};
