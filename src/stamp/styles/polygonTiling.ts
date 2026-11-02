// Polygon tiling: a tiling of regular polygons, or its dual, ported from Michael Fogleman's Tiling. Each
// polygon is inset from its neighbours and outlined in one dark tone with round joins, so the ground shows
// between them as grout, and the polygons are filled by type: hexagons in one ink, squares in another. The
// tilings are built as Fogleman builds them: a first polygon, rings of neighbours attached edge to edge, and
// a set of those polygons whose centers are repeated across the plane. Seeds pick one of his 13 patterns or
// its dual, the zoom, a quarter turn, the center and the colors, on his dark ground or on the paper.
//
// Like the other styles it computes every pixel itself, in units of the polygons' edge, so it is resolution
// independent, and with only IEEE-exact arithmetic (trigonometry from exact.ts) its pixels match in every
// browser and in Node (ADR 0001).
//
// Ported from https://github.com/fogleman/Tiling (tile.py, main.py), under the MIT License:
//
//   Copyright (C) 2014 Michael Fogleman
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

import { atan2, cos, sin } from "../exact";
import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

type Rgb = [number, number, number];
type Point = [number, number];

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

const PI = Math.PI;

// ---- tile.py ----
// A regular polygon with edges 1 long, by its side count, center and rotation.
type Shape = { sides: number; x: number; y: number; rotation: number };

// Corners relative to the center, by side count and rotation. Repeats copy a shape's rotation exactly, so
// thousands of copies share a few entries here instead of each redoing the trigonometry.
const cornerOffsets = new Map<string, Point[]>();

// Its corners, the first repeated at the end.
function shapePoints({ sides, x, y, rotation }: Shape): Point[] {
  const k = `${sides} ${rotation}`;
  let offsets = cornerOffsets.get(k);
  if (!offsets) {
    const angle = (2 * PI) / sides;
    let r = rotation - PI / 2;
    if (sides % 2 === 0) r += angle / 2;
    const d = 0.5 / sin(angle / 2);
    offsets = [];
    for (let i = 0; i < sides; i++) {
      const a = angle * i + r;
      offsets.push([cos(a) * d, sin(a) * d]);
    }
    cornerOffsets.set(k, offsets);
  }
  const points = offsets.map(([dx, dy]): Point => [x + dx, y + dy]);
  points.push(points[0]);
  return points;
}

// The `sides`-gon sharing edge `edge` of `shape`, on its far side.
function adjacent(shape: Shape, sides: number, edge: number): Shape {
  const [[x1, y1], [x2, y2]] = shapePoints(shape).slice(edge, edge + 2);
  const angle = (2 * PI) / sides;
  let a = atan2(y2 - y1, x2 - x1);
  const b = a - PI / 2;
  const d = (0.5 * cos(angle / 2)) / sin(angle / 2); // 0.5 / tan(angle / 2)
  const x = x1 + (x2 - x1) / 2 + cos(b) * d;
  const y = y1 + (y2 - y1) / 2 + sin(b) * d;
  // tile.py is Python 2, so (sides - 1) / 2 is integer division.
  a += angle * Math.floor((sides - 1) / 2);
  return { sides, x, y, rotation: a };
}

// tile.py's normalize: positions to 6 decimals, as a map key. Both fit in 26 bits within 30 edges of the
// origin, so the key is one exact integer, which maps look up faster than strings.
const key = (x: number, y: number) =>
  (Math.round(x * 1e6) + 2 ** 25) * 2 ** 26 + Math.round(y * 1e6) + 2 ** 25;

class Model {
  shapes: Shape[] = [];
  lookup = new Map<number, Shape>();

  append(shape: Shape) {
    this.shapes.push(shape);
    this.lookup.set(key(shape.x, shape.y), shape);
  }

  add(indexes: number | number[], edges: number | number[], sides: number) {
    const start = this.shapes.length;
    for (const index of typeof indexes === "number" ? [indexes] : indexes)
      for (const edge of typeof edges === "number" ? [edges] : edges)
        this.append(adjacent(this.shapes[index], sides, edge));
    return range(start, this.shapes.length);
  }

  // Copies every shape to (x, y) from where it is, keeping the copies centered within `extent` of the origin.
  private addRepeats(x: number, y: number, extent: number) {
    for (const shape of this.shapes) {
      const [sx, sy] = [x + shape.x, y + shape.y];
      const k = key(sx, sy);
      if (
        Math.abs(sx) <= extent &&
        Math.abs(sy) <= extent &&
        !this.lookup.has(k)
      )
        this.lookup.set(k, { ...shape, x: sx, y: sy });
    }
  }

  // Copies every shape to each sum of the repeat shapes' centers, taking one more step each round until some
  // copy lies past every corner of the square `extent` either side of the origin. tile.py reaches the same sums
  // by a depth-first search it restarts one level deeper each round, which is slow in JS.
  repeat(indexes: number[], extent: number) {
    const seen = new Set([key(0, 0)]);
    let layer: Point[] = [[0, 0]];
    this.addRepeats(0, 0, extent);
    const corners = new Set<number>();
    while (corners.size < 4) {
      const next: Point[] = [];
      for (const [x, y] of layer)
        for (const index of indexes) {
          const [nx, ny] = [x + this.shapes[index].x, y + this.shapes[index].y];
          const k = key(nx, ny);
          if (seen.has(k)) continue;
          seen.add(k);
          next.push([nx, ny]);
          this.addRepeats(nx, ny, extent);
          if (Math.abs(nx) > extent && Math.abs(ny) > extent)
            corners.add((nx > 0 ? 1 : 0) + (ny > 0 ? 2 : 0));
        }
      layer = next;
    }
  }

  // The dual tiling: one face per vertex where three or more shapes meet, its corners the shapes' centers.
  dual(): Point[][] {
    const vertexes = new Map<
      number,
      { x: number; y: number; shapes: Shape[] }
    >();
    for (const shape of this.lookup.values())
      for (const [x, y] of shapePoints(shape).slice(0, -1)) {
        const k = key(x, y);
        let v = vertexes.get(k);
        if (!v) vertexes.set(k, (v = { x, y, shapes: [] }));
        v.shapes.push(shape);
      }
    const result: Point[][] = [];
    for (const { x, y, shapes } of vertexes.values()) {
      if (shapes.length < 3) continue;
      const points = shapes
        .map((s) => ({ s, angle: atan2(s.y - y, s.x - x) }))
        .sort((a, b) => b.angle - a.angle)
        .map(({ s }): Point => [s.x, s.y]);
      points.push(points[0]);
      result.push(points);
    }
    return result;
  }
}

const range = (start: number, end: number, step = 1) => {
  const out: number[] = [];
  for (let i = start; i < end; i += step) out.push(i);
  return out;
};

// ---- main.py ----
// Fogleman's 13 patterns, by vertex configuration where it has one. Each builds a model and repeats it to
// cover `extent` either side of the origin. Pattern 9 is finite: a pentagon in rings of squares and pentagons.
const PATTERNS: readonly ((extent: number) => Model)[] = [
  (extent) => {
    // 3.6.3.6
    const model = new Model();
    model.append({ sides: 6, x: 0, y: 0, rotation: 0 });
    const a = model.add(0, range(0, 6), 3);
    const b = model.add(a, 1, 6);
    model.repeat(b, extent);
    return model;
  },
  (extent) => {
    // 4.6.12
    const model = new Model();
    model.append({ sides: 12, x: 0, y: 0, rotation: 0 });
    model.add(0, range(0, 12, 2), 6);
    const b = model.add(0, range(1, 12, 2), 4);
    const c = model.add(b, 2, 12);
    model.repeat(c, extent);
    return model;
  },
  (extent) => {
    // 3.3.4.3.4
    const model = new Model();
    model.append({ sides: 4, x: 0, y: 0, rotation: 0 });
    const a = model.add(0, range(0, 4), 3);
    const b = model.add(a, 1, 4);
    const c = model.add(b, [2, 3], 3);
    const d = model.add(c, 2, 4);
    model.repeat(d, extent);
    return model;
  },
  (extent) => {
    // 3.3.3.3.6
    const model = new Model();
    model.append({ sides: 6, x: 0, y: 0, rotation: 0 });
    const a = model.add(0, range(0, 6), 3);
    model.add(a, 1, 3);
    const c = model.add(a, 2, 3);
    const d = model.add(c, 1, 6);
    model.repeat(d, extent);
    return model;
  },
  (extent) => {
    // 4.8.8
    const model = new Model();
    model.append({ sides: 8, x: 0, y: 0, rotation: 0 });
    const a = model.add(0, range(1, 8, 2), 4);
    const b = model.add(a, 1, 8);
    model.repeat(b, extent);
    return model;
  },
  (extent) => {
    // 3.3.4.12 / 3.3.3.3.3.3
    const model = new Model();
    model.append({ sides: 12, x: 0, y: 0, rotation: 0 });
    model.add(0, range(0, 12, 2), 3);
    const b = model.add(0, range(1, 12, 2), 4);
    model.add(b, [1, 3], 3);
    const d = model.add(b, 2, 12);
    model.repeat(d, extent);
    return model;
  },
  (extent) => {
    // 3.4.6.4
    const model = new Model();
    model.append({ sides: 6, x: 0, y: 0, rotation: 0 });
    const a = model.add(0, range(0, 6), 4);
    model.add(a, 1, 3);
    const c = model.add(a, 2, 6);
    model.repeat(c, extent);
    return model;
  },
  (extent) => {
    // 3.3.4.4
    const model = new Model();
    model.append({ sides: 4, x: 0, y: 0, rotation: 0 });
    const a = [...model.add(0, [0, 2], 4), 0];
    const b = model.add(a, [1, 3], 3);
    const c = model.add(b, 1, 3);
    const d = model.add(c, 2, 4);
    model.repeat(d, extent);
    return model;
  },
  (extent) => {
    // 3.3.3.3.3.3
    const model = new Model();
    model.append({ sides: 3, x: 0, y: 0, rotation: 0 });
    const a = model.add(0, range(0, 3), 3);
    const b = model.add(a, [1, 2], 3);
    model.repeat(b, extent);
    return model;
  },
  () => {
    const model = new Model();
    model.append({ sides: 5, x: 0, y: 0, rotation: 0 });
    let a = model.add(0, range(0, 5), 4);
    for (let i = 0; i < 8; i++) {
      const b = model.add(a, 2, 5);
      a = model.add(b, 2, 4);
    }
    return model;
  },
  (extent) => {
    const model = new Model();
    model.append({ sides: 6, x: 0, y: 0, rotation: 0 });
    const a = model.add(0, range(0, 6), 4);
    const b = model.add(a, 2, 3);
    const c = model.add(b, 1, 4);
    const d = model.add(b, 2, 4);
    const e = model.add(d, 2, 6);
    model.add(a, 1, 3);
    model.add(c, 1, 3);
    model.repeat(e, extent);
    return model;
  },
  (extent) => {
    const model = new Model();
    model.append({ sides: 8, x: 0, y: 0, rotation: 0 });
    const a = model.add(0, range(0, 8, 2), 6);
    const b = model.add(a, 3, 8);
    model.repeat(b, extent);
    return model;
  },
  (extent) => {
    // 3.12.12
    const model = new Model();
    model.append({ sides: 12, x: 0, y: 0, rotation: 0 });
    model.add(0, range(0, 12, 2), 3);
    const b = model.add(0, range(1, 12, 2), 12);
    model.repeat(b, extent);
    return model;
  },
];

// ---- Drawing ----
// tile.py's defaults, in edge units: each polygon is inset MARGIN from its edges and outlined LINE wide, so a
// gap of 2 * MARGIN - LINE shows the ground between neighbours.
const MARGIN = 0.1;
const LINE = 0.1;
// Polygons within GRID edges of the origin, along either axis, are binned for lookup. The view turns only by
// quarter turns, so it spans at most 4.5 * 1.4 edges from its center along either axis (9 edges across the
// short side, a 1.4 ratio), and the center is at most a dodecagon's radius, 1.93, from the origin: 8.2 in all.
// Repeats keep copies centered within EXTENT, two dodecagon radii further, so every polygon and dual face
// reaching into the view is complete.
const EXTENT = 13;
const GRID = 9;

// A tiling ready to draw: its convex polygons as edges, each edge's outward unit normal and offset (n·p = c on
// the edge), the inset corner where it starts, and a color class per polygon. `cells` lists the polygons
// overlapping each unit cell of the square GRID either side of the origin.
type Tiling = {
  start: Int32Array;
  nx: Float64Array;
  ny: Float64Array;
  c: Float64Array;
  ix: Float64Array;
  iy: Float64Array;
  cls: Int32Array;
  classes: number;
  cells: Int32Array[];
  // How far the farthest corner sits from the origin, for the finite pattern.
  radius: number;
  // A corner of the first polygon, which sits at the origin.
  corner: Point;
};

function buildTiling(polygons: Point[][], corner: Point): Tiling {
  // The polygons whose bounding boxes reach into the binned square.
  const kept = polygons.filter(
    (points) =>
      points.some(([x]) => x > -GRID) &&
      points.some(([x]) => x < GRID) &&
      points.some(([, y]) => y > -GRID) &&
      points.some(([, y]) => y < GRID),
  );
  const edges = kept.reduce((sum, p) => sum + p.length - 1, 0);
  const start = new Int32Array(kept.length + 1);
  const [nx, ny, c, ix, iy] = [0, 0, 0, 0, 0].map(
    () => new Float64Array(edges),
  );
  const cells: number[][] = Array.from({ length: 4 * GRID * GRID }, () => []);
  let radius = 0;
  let e = 0;
  kept.forEach((points, j) => {
    start[j] = e;
    const k = points.length - 1;
    let area = 0;
    for (let i = 0; i < k; i++)
      area += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1];
    const sign = area > 0 ? 1 : -1;
    for (let i = 0; i < k; i++) {
      const [[x1, y1], [x2, y2]] = [points[i], points[i + 1]];
      const len = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
      nx[e + i] = (sign * (y2 - y1)) / len;
      ny[e + i] = (sign * (x1 - x2)) / len;
      c[e + i] = nx[e + i] * x1 + ny[e + i] * y1;
      radius = Math.max(radius, Math.sqrt(x1 * x1 + y1 * y1));
    }
    // Each inset corner is where the inset lines of the edges before and after it cross.
    for (let i = 0; i < k; i++) {
      const [a, b] = [e + ((i + k - 1) % k), e + i];
      const [ca, cb] = [c[a] - MARGIN, c[b] - MARGIN];
      const det = nx[a] * ny[b] - ny[a] * nx[b];
      ix[b] = (ca * ny[b] - cb * ny[a]) / det;
      iy[b] = (nx[a] * cb - nx[b] * ca) / det;
    }
    e += k;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const cell = (v: number) =>
      Math.min(2 * GRID - 1, Math.max(0, Math.floor(v) + GRID));
    for (let gy = cell(Math.min(...ys)); gy <= cell(Math.max(...ys)); gy++)
      for (let gx = cell(Math.min(...xs)); gx <= cell(Math.max(...xs)); gx++)
        cells[gy * 2 * GRID + gx].push(j);
  });
  start[kept.length] = e;

  // Polygons are colored by type, as Fogleman colors hexagons, squares and triangles. A tiling of one type
  // (the triangles, and most duals) is colored by orientation instead, which picks out its symmetry.
  const sides = new Set(kept.map((p) => p.length));
  const classKey = (points: Point[]) => {
    if (sides.size > 1) return `${points.length}`;
    const k = points.length - 1;
    let [mx, my] = [0, 0];
    for (let i = 0; i < k; i++)
      [mx, my] = [mx + points[i][0], my + points[i][1]];
    [mx, my] = [mx / k, my / k];
    const corners = points
      .slice(0, k)
      .map(
        ([x, y]) =>
          `${Math.round((x - mx) * 1000)},${Math.round((y - my) * 1000)}`,
      )
      .sort();
    return corners.join(" ");
  };
  const keys = kept.map(classKey);
  const order = [...new Set(keys)].sort();
  if (sides.size > 1) order.sort((a, b) => Number(b) - Number(a));
  const index = new Map(order.map((k, i) => [k, i]));
  return {
    start,
    nx,
    ny,
    c,
    ix,
    iy,
    cls: Int32Array.from(keys, (k) => index.get(k)!),
    classes: order.length,
    cells: cells.map((list) => Int32Array.from(list)),
    radius,
    corner,
  };
}

// Tilings are built once per pattern and kind, since every seed draws the same geometry.
const tilings = new Map<number, Tiling>();
function tilingFor(pattern: number, dual: boolean): Tiling {
  const id = 2 * pattern + (dual ? 1 : 0);
  let tiling = tilings.get(id);
  if (!tiling) {
    const model = PATTERNS[pattern](EXTENT);
    tiling = buildTiling(
      dual ? model.dual() : [...model.lookup.values()].map(shapePoints),
      shapePoints(model.shapes[0])[0],
    );
    tilings.set(id, tiling);
  }
  return tiling;
}

function shuffled<T>(list: readonly T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Pattern 9 is finite, and its dual is a scatter of fragments. Pattern 11's octagons and hexagons leave
// square gaps, so no corner joins three polygons and it has no dual.
const FINITE = 9;
const NO_DUAL = [9, 11];

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const pattern = Math.floor(rand() * PATTERNS.length);
  const dual = rand() < 0.4 && !NO_DUAL.includes(pattern);
  const t = tilingFor(pattern, dual);
  // Edges across the short side. The finite pattern is fitted to the short side, its outer rings just cropped,
  // which keeps its outlines about a desk pixel wide.
  const across = pattern === FINITE ? 1.75 * t.radius : 4.5 + 4.5 * rand();
  const turned = rand() < 0.5;
  // Centered on the first polygon, or on one of its corners.
  const [cx, cy] = pattern !== FINITE && rand() < 0.5 ? t.corner : [0, 0];

  // Fogleman's look: polygons on a black ground, outlined in a dark slate. Or the reverse, inks outlined in
  // the darkest ink on the paper.
  const [ink0, paperRgb] = [rgb(inks[0]), rgb(paper)];
  const dark = rand() < 0.6;
  const ground = dark ? ink0 : paperRgb;
  const stroke = dark ? mix(ink0, paperRgb, 0.22) : ink0;
  const fillRand = stream(seed, 1);
  // On the paper, a paper fill would leave a tiling of one class unfilled, so paper comes last.
  const pool = dark
    ? shuffled([paper, ...inks.slice(1)].map(rgb), fillRand)
    : [...shuffled(inks.slice(1).map(rgb), fillRand), paperRgb];
  const fills = Array.from(
    { length: t.classes },
    (_, i) => pool[i % pool.length],
  );

  const { start, nx, ny, c, ix, iy, cls, cells } = t;
  // How deep (u, v) sits inside polygon j: its distance to the nearest edge, negative outside.
  const depthIn = (j: number, u: number, v: number) => {
    let d = Infinity;
    for (let e = start[j]; e < start[j + 1]; e++) {
      const s = c[e] - nx[e] * u - ny[e] * v;
      if (s < d) {
        d = s;
        if (d < 0) return d;
      }
    }
    return d;
  };
  // Distance from (u, v), outside polygon j's inset outline, to that outline.
  const outsideInset = (j: number, u: number, v: number) => {
    let best = Infinity;
    const [e0, e1] = [start[j], start[j + 1]];
    for (let e = e0; e < e1; e++) {
      const f = e + 1 < e1 ? e + 1 : e0;
      const [ax, ay] = [ix[e], iy[e]];
      const [bx, by] = [ix[f] - ax, iy[f] - ay];
      const along = clamp01(
        ((u - ax) * bx + (v - ay) * by) / (bx * bx + by * by),
      );
      const [dx, dy] = [u - ax - along * bx, v - ay - along * by];
      best = Math.min(best, dx * dx + dy * dy);
    }
    return Math.sqrt(best);
  };

  const unit = Math.min(width, height) / across; // pixels per edge
  // Outlines and gaps are a tenth of an edge. Each sample shades them by its distance to them, which holds up
  // while they're over a pixel wide. Below that, pixels take more samples.
  const S = Math.min(4, Math.ceil(12 / unit)); // samples per pixel side
  const foot = 1 / (unit * S); // a sample's footprint, in edges
  let last = 0;
  // Adds the color at pixel point (px, py) to `sum`.
  const sum = [0, 0, 0];
  const sample = (px: number, py: number) => {
    let u = (px - width / 2) / unit;
    let v = (py - height / 2) / unit;
    if (turned) [u, v] = [v, -u];
    u += cx;
    v += cy;
    let j = last;
    let depth = depthIn(j, u, v);
    if (depth < 0) {
      j = -1;
      const gx = Math.floor(u) + GRID;
      const gy = Math.floor(v) + GRID;
      if (gx >= 0 && gy >= 0 && gx < 2 * GRID && gy < 2 * GRID)
        for (const k of cells[gy * 2 * GRID + gx]) {
          depth = depthIn(k, u, v);
          if (depth >= 0) {
            j = last = k;
            break;
          }
        }
    }
    let color = ground;
    if (j >= 0) {
      const fill = fills[cls[j]];
      if (depth > MARGIN + LINE / 2 + foot) color = fill;
      else if (depth > MARGIN - LINE / 2 - foot) {
        const sd = depth >= MARGIN ? MARGIN - depth : outsideInset(j, u, v);
        const inFill = clamp01(0.5 - (sd + LINE / 2) / foot);
        const inLine = clamp01(0.5 - (sd - LINE / 2) / foot) - inFill;
        for (let i = 0; i < 3; i++)
          sum[i] +=
            ground[i] * (1 - inFill - inLine) +
            stroke[i] * inLine +
            fill[i] * inFill;
        return;
      }
    }
    sum[0] += color[0];
    sum[1] += color[1];
    sum[2] += color[2];
  };

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      sum[0] = sum[1] = sum[2] = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++)
          sample(x + (sx + 0.5) / S, y + (sy + 0.5) / S);
      const p = (y * width + x) * 4;
      data[p] = Math.round(sum[0] / (S * S));
      data[p + 1] = Math.round(sum[1] / (S * S));
      data[p + 2] = Math.round(sum[2] / (S * S));
      data[p + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
}

export const polygonTiling1: Style = {
  id: "polytile1",
  draw,
};
