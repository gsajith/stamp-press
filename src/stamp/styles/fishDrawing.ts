import { atan2, cos, exp, pow, sin } from "../exact";
import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Fish drawing: one invented fish in pen-plotter line work, with hatched scales, fin rays, stripes and shading,
// captioned with its made-up binomial name in a Hershey italic. A port of Lingdong Huang's fishdraw
// (github.com/LingDong-/fishdraw), whose notice follows:
//
//   MIT License
//
//   Copyright (c) 2021 Lingdong Huang
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
// The generator keeps fishdraw's body plan, parameters and line work, in its own units (a 500 by 300 plate).
// What changed: random draws come from our seeded streams, trig and powers from ../exact, and clipping goes
// through a grid of each polygon's edges. fishdraw grew one polygon union per scale to hide the scales behind
// it; here each scale clips against the few earlier ones it overlaps, which hides the same lines and keeps a
// fish to a few milliseconds.
//
// The drawing step lays the fish and caption out in units of the art's short side, then rasterizes every
// polyline as a round-capped line with its exact box-filtered coverage, so a line keeps its weight at any size
// and the pixels match in every browser and in Node (ADR 0001).

type Pt = [number, number];
type Line = Pt[];

const PI = Math.PI;

// The stream every draw in one fish comes from, and p5's noise table, refilled per fish.
let rand: () => number = () => 0;
const perlin = new Float64Array(4096);

// p5.js's value noise, as fishdraw carries it: four octaves over a 4096-entry table, in about [0, 1].
// p5's fade, 0.5 * (1 - cos(pi * i)) for i in [0, 1). It runs millions of times a fish, so it's written as
// 0.5 + 0.5 * sin(pi * (i - 0.5)) by its Taylor series, which is within 1e-9 for |i - 0.5| <= 0.5.
function scaledCosine(i: number): number {
  const u = (i - 0.5) * PI;
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
                u2 *
                  (-1 / 5040 +
                    u2 *
                      (1 / 362880 + u2 * (-1 / 39916800 + u2 / 6227020800))))))
  );
}
function noise(x: number, y = 0, z = 0): number {
  if (x < 0) x = -x;
  if (y < 0) y = -y;
  if (z < 0) z = -z;
  let xi = Math.floor(x);
  let yi = Math.floor(y);
  let zi = Math.floor(z);
  let xf = x - xi;
  let yf = y - yi;
  let zf = z - zi;
  let r = 0;
  let ampl = 0.5;
  for (let o = 0; o < 4; o++) {
    let of = xi + (yi << 4) + (zi << 8);
    const rxf = scaledCosine(xf);
    const ryf = scaledCosine(yf);
    let n1 = perlin[of & 4095];
    n1 += rxf * (perlin[(of + 1) & 4095] - n1);
    let n2 = perlin[(of + 16) & 4095];
    n2 += rxf * (perlin[(of + 17) & 4095] - n2);
    n1 += ryf * (n2 - n1);
    of += 256;
    n2 = perlin[of & 4095];
    n2 += rxf * (perlin[(of + 1) & 4095] - n2);
    let n3 = perlin[(of + 16) & 4095];
    n3 += rxf * (perlin[(of + 17) & 4095] - n3);
    n2 += ryf * (n3 - n2);
    n1 += scaledCosine(zf) * (n2 - n1);
    r += n1 * ampl;
    ampl *= 0.5;
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
}

// fishdraw's signed power, sign(a) * |a|^b.
const spow = (a: number, b: number) =>
  a < 0 ? -pow(-a, b) : a > 0 ? pow(a, b) : 0;
// acos(x) for |x| <= 1, NaN outside, like Math.acos.
const acos = (x: number) =>
  x > 1 || x < -1 ? NaN : atan2(Math.sqrt(1 - x * x), x);

const dist = (x0: number, y0: number, x1: number, y1: number) =>
  Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const lerp2d = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  t: number,
): Pt => [x0 * (1 - t) + x1 * t, y0 * (1 - t) + y1 * t];
const deviate = (n: number) => rand() * 2 * n - n;

type Box = { x: number; y: number; w: number; h: number };
function bbox(points: readonly Pt[]): Box {
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  for (const [x, y] of points) {
    if (x < xmin) xmin = x;
    if (y < ymin) ymin = y;
    if (x > xmax) xmax = x;
    if (y > ymax) ymax = y;
  }
  return { x: xmin, y: ymin, w: xmax - xmin, h: ymax - ymin };
}

const trsl = (poly: Line, x: number, y: number): Line =>
  poly.map(([px, py]) => [px + x, py + y]);
const shr = (poly: Line, sx: number): Line =>
  poly.map(([px, py]) => [px + py * sx, py]);
function rot(poly: Line, th: number): Line {
  const c = cos(th);
  const s = sin(th);
  return poly.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

// ---- Clipping ----

// A polygon readied for clipping: its edges bucketed in a grid over its bounds, so a segment tests only the
// edges near it. fishdraw tested every edge, which was nine tenths of its time.
type Prepared = {
  xs: Float64Array;
  ys: Float64Array;
  box: Box;
  cols: number;
  rows: number;
  cw: number;
  ch: number;
  start: Int32Array;
  edges: Int32Array;
  seen: Int32Array;
  stamp: number;
};

function prepare(poly: readonly Pt[]): Prepared {
  const n = poly.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) [xs[i], ys[i]] = poly[i];
  const box = bbox(poly);
  const side = Math.max(1, Math.min(48, Math.floor(Math.sqrt(n))));
  const cols = side;
  const rows = side;
  const cw = box.w / cols || 1;
  const ch = box.h / rows || 1;
  const cell = (v: number, o: number, size: number, count: number) =>
    Math.min(count - 1, Math.max(0, Math.floor((v - o) / size)));
  // Two passes: count each cell's edges, then fill them in.
  const count = new Int32Array(cols * rows + 1);
  const ranges = new Int32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const c0 = cell(Math.min(xs[i], xs[j]), box.x, cw, cols);
    const c1 = cell(Math.max(xs[i], xs[j]), box.x, cw, cols);
    const r0 = cell(Math.min(ys[i], ys[j]), box.y, ch, rows);
    const r1 = cell(Math.max(ys[i], ys[j]), box.y, ch, rows);
    ranges.set([c0, c1, r0, r1], i * 4);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) count[r * cols + c + 1]++;
  }
  for (let k = 1; k <= cols * rows; k++) count[k] += count[k - 1];
  const start = count.slice();
  const edges = new Int32Array(count[cols * rows]);
  for (let i = 0; i < n; i++) {
    const [c0, c1, r0, r1] = ranges.subarray(i * 4, i * 4 + 4);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) edges[count[r * cols + c]++] = i;
  }
  return {
    xs,
    ys,
    box,
    cols,
    rows,
    cw,
    ch,
    start,
    edges,
    seen: new Int32Array(n),
    stamp: 0,
  };
}

// Calls `visit` once for each edge whose cell overlaps the box [x0, x1] by [y0, y1].
function nearEdges(
  P: Prepared,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (i: number) => void,
) {
  const { box } = P;
  if (x1 < box.x || x0 > box.x + box.w || y1 < box.y || y0 > box.y + box.h)
    return;
  const c0 = Math.max(0, Math.floor((x0 - box.x) / P.cw));
  const c1 = Math.min(P.cols - 1, Math.floor((x1 - box.x) / P.cw));
  const r0 = Math.max(0, Math.floor((y0 - box.y) / P.ch));
  const r1 = Math.min(P.rows - 1, Math.floor((y1 - box.y) / P.ch));
  const stamp = ++P.stamp;
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      const k = r * P.cols + c;
      for (let e = P.start[k]; e < P.start[k + 1]; e++) {
        const i = P.edges[e];
        if (P.seen[i] === stamp) continue;
        P.seen[i] = stamp;
        visit(i);
      }
    }
}

// Whether a point is inside the polygon, by the parity of edges crossed by a ray towards +x.
function inside(P: Prepared, px: number, py: number): boolean {
  const n = P.xs.length;
  let odd = false;
  nearEdges(P, px, py, Infinity, py, (i) => {
    const j = i + 1 === n ? 0 : i + 1;
    const [ax, ay, bx, by] = [P.xs[i], P.ys[i], P.xs[j], P.ys[j]];
    if (ay > py !== by > py && px < ax + ((py - ay) * (bx - ax)) / (by - ay))
      odd = !odd;
  });
  return odd;
}

// Where the segment a-b crosses the polygon's edges, as fractions along it, in order.
const crossings: number[] = [];
function cross(P: Prepared, ax: number, ay: number, bx: number, by: number) {
  crossings.length = 0;
  const n = P.xs.length;
  const dx = bx - ax;
  const dy = by - ay;
  nearEdges(
    P,
    Math.min(ax, bx),
    Math.min(ay, by),
    Math.max(ax, bx),
    Math.max(ay, by),
    (i) => {
      const j = i + 1 === n ? 0 : i + 1;
      const ex = P.xs[j] - P.xs[i];
      const ey = P.ys[j] - P.ys[i];
      const vc = dx * ey - dy * ex;
      if (vc === 0) return;
      const qx = P.xs[i] - ax;
      const qy = P.ys[i] - ay;
      const t = (qx * ey - qy * ex) / vc;
      const s = (qx * dy - qy * dx) / vc;
      if (t >= 0 && t < 1 && s >= 0 && s < 1) crossings.push(t);
    },
  );
  if (crossings.length > 1) crossings.sort((p, q) => p - q);
  return crossings;
}

type Split = { in: Line[]; out: Line[] };

// Splits polylines into their runs inside and outside a polygon.
function clipMulti(lines: readonly Line[], poly: readonly Pt[]): Split {
  const result: Split = { in: [], out: [] };
  if (poly.length < 3) {
    result.out.push(...lines);
    return result;
  }
  const P = prepare(poly);
  for (const line of lines) {
    if (!line.length) continue;
    let io = inside(P, line[0][0], line[0][1]);
    let run: Line = [];
    for (let i = 0; i < line.length; i++) {
      const a = line[i];
      run.push(a);
      const b = line[i + 1];
      if (!b) break;
      for (const t of cross(P, a[0], a[1], b[0], b[1])) {
        const xy = lerp2d(a[0], a[1], b[0], b[1], t);
        run.push(xy);
        (io ? result.in : result.out).push(run);
        io = !io;
        run = [xy];
      }
    }
    (io ? result.in : result.out).push(run);
  }
  return result;
}
const clipOut = (lines: readonly Line[], poly: readonly Pt[]) =>
  clipMulti(lines, poly).out;
const clipIn = (lines: readonly Line[], poly: readonly Pt[]) =>
  clipMulti(lines, poly).in;

// The runs inside any of several polygons: fishdraw's clip against their union.
function clipInAny(lines: readonly Line[], polys: readonly Line[]): Line[] {
  const kept: Line[] = [];
  let rest = lines;
  for (const poly of polys) {
    const split = clipMulti(rest, poly);
    kept.push(...split.in);
    rest = split.out;
  }
  return kept;
}

// Splits polylines where a predicate of each point (and its fraction along the line) flips.
function binclip(
  lines: readonly Line[],
  func: (x: number, y: number, t: number) => boolean,
): Split {
  const result: Split = { in: [], out: [] };
  for (const line of lines) {
    if (!line.length) continue;
    const bins = line.map(([x, y], i) => func(x, y, i / (line.length - 1)));
    let io = bins[0];
    let run: Line = [];
    for (let i = 0; i < line.length; i++) {
      const a = line[i];
      run.push(a);
      const b = line[i + 1];
      if (!b) break;
      if (bins[i] !== bins[i + 1]) {
        const pt = lerp2d(a[0], a[1], b[0], b[1], 0.5);
        run.push(pt);
        (io ? result.in : result.out).push(run);
        io = !io;
        run = [pt];
      }
    }
    (io ? result.in : result.out).push(run);
  }
  return result;
}

// ---- Shading ----

// Diagonal hatching inside a polygon, carved away where the polygon shifted by (dx, dy) covers it, so it falls
// on one side like a shadow.
function shadeShape(poly: Line, step = 5, dx = 10, dy = 20): Line[] {
  const b = bbox(poly);
  b.x -= step;
  b.y -= step;
  b.w += step * 2;
  b.h += step * 2;
  let lines: Line[] = [];
  for (let i = -b.h; i < b.w; i += step)
    lines.push([
      [b.x + i, b.y],
      [b.x + i + b.h, b.y + b.h],
    ]);
  lines = clipIn(lines, poly);
  lines = clipOut(lines, trsl(poly, -dx, -dy));
  for (const line of lines) {
    if (line.length < 2) continue;
    const [a, c] = line;
    const s = rand() * 0.5;
    if (dy > 0) line[0] = lerp2d(a[0], a[1], c[0], c[1], s);
    else line[1] = lerp2d(c[0], c[1], a[0], a[1], s);
  }
  return lines;
}

function fillShape(poly: Line, step = 5): Line[] {
  const b = bbox(poly);
  b.x -= step;
  b.y -= step;
  b.w += step * 2;
  b.h += step * 2;
  const lines: Line[] = [];
  for (let i = 0; i < b.w + b.h / 2; i += step)
    lines.push([
      [b.x + i, b.y],
      [b.x + i - b.h / 2, b.y + b.h],
    ]);
  return clipIn(lines, poly);
}

// Hatching inside a region, kept only where a pattern holds: stripes, spots or mottling.
function patternshadeShape(
  region: Line[],
  step: number,
  pattern: (x: number, y: number) => boolean,
): Line[] {
  const b = bbox(region.flat());
  b.x -= step;
  b.y -= step;
  b.w += step * 2;
  b.h += step * 2;
  let lines: Line[] = [];
  for (let i = -b.h / 2; i < b.w; i += step)
    lines.push([
      [b.x + i, b.y],
      [b.x + i + b.h / 2, b.y + b.h],
    ]);
  lines = clipInAny(lines, region).map((l) => resample(l, 2));
  return binclip(lines, pattern).in;
}

// Short random walks along the noise field: the veined texture of gill covers and jaws.
function veinShape(poly: Line, n = 50): Line[] {
  const b = bbox(poly);
  const out: Line[] = [];
  for (let i = 0; i < n; i++) {
    let x = b.x + rand() * b.w;
    let y = b.y + rand() * b.h;
    const o: Line = [[x, y]];
    for (let j = 0; j < 15; j++) {
      const dx = (noise(x * 0.1, y * 0.1, 7) - 0.5) * 4;
      const dy = (noise(x * 0.1, y * 0.1, 6) - 0.5) * 4;
      x += dx;
      y += dy;
      o.push([x, y]);
    }
    out.push(o);
  }
  return clipIn(out, poly);
}

// Tiny double ellipses scattered by Poisson disk, thinning towards the belly.
function smalldotShape(region: Line[], scale = 1): Line[] {
  const b = bbox(region.flat());
  const samples = poissondisk(b.w, b.h, 5 * scale);
  const out: Line[] = [];
  for (const [sx, sy] of samples) {
    const x = sx + b.x;
    const y = sy + b.y;
    const t = y > 0 ? y / 300 : 0.5;
    if ((t > 0.4 || y < 0) && t > rand()) continue;
    for (let k = 0; k < 2; k++) {
      let o: Line = [];
      for (let j = 0; j < 7; j++) {
        const a = (j / 6) * PI * 2;
        o.push([cos(a) - k * 0.3, sin(a) * 0.5 - k * 0.3]);
      }
      o = trsl(rot(o, rand() * PI * 2), x, y);
      out.push(o);
    }
  }
  return clipInAny(out, region);
}

// ---- Polyline utilities ----

// Where the segment (x0, y0)-(x1, y1) first meets the circle, as a fraction along it, or null.
function isectCircLine(
  cx: number,
  cy: number,
  r: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const fx = x0 - cx;
  const fy = y0 - cy;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  disc = Math.sqrt(disc);
  const t0 = (-b - disc) / (2 * a);
  if (t0 >= 0 && t0 <= 1) return t0;
  const t = (-b + disc) / (2 * a);
  return t > 1 || t < 0 ? null : t;
}

// Points every `step` along a polyline.
function resample(input: Line, step: number): Line {
  if (input.length < 2) return input.slice();
  const polyline = input.slice();
  const out: Line = [[polyline[0][0], polyline[0][1]]];
  let i = 0;
  while (i < polyline.length - 1) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d === 0) {
      i++;
      continue;
    }
    const n = Math.floor(d / step);
    const rest = (n * step) / d;
    const rpx = a[0] * (1 - rest) + b[0] * rest;
    const rpy = a[1] * (1 - rest) + b[1] * rest;
    for (let j = 1; j <= n; j++) {
      const t = j / n;
      out.push([a[0] * (1 - t) + rpx * t, a[1] * (1 - t) + rpy * t]);
    }
    let next: number | null = null;
    for (let j = i + 2; j < polyline.length; j++) {
      const p = polyline[j - 1];
      const c = polyline[j];
      if (p[0] === c[0] && p[1] === c[1]) continue;
      const t = isectCircLine(rpx, rpy, step, p[0], p[1], c[0], c[1]);
      if (t === null) continue;
      const q: Pt = [p[0] * (1 - t) + c[0] * t, p[1] * (1 - t) + c[1] * t];
      out.push(q);
      polyline[j - 1] = q;
      next = j - 1;
      break;
    }
    if (next === null) break;
    i = next;
  }
  if (out.length > 1) {
    const [lx, ly] = out[out.length - 1];
    const [mx, my] = polyline[polyline.length - 1];
    if (dist(lx, ly, mx, my) < step * 0.5) out.pop();
  }
  const last = polyline[polyline.length - 1];
  out.push([last[0], last[1]]);
  return out;
}

function ptSegDist(p: Pt, p0: Pt, p1: Pt): number {
  const [x, y] = p;
  const [x1, y1] = p0;
  const [x2, y2] = p1;
  const C = x2 - x1;
  const D = y2 - y1;
  const lenSq = C * C + D * D;
  const param = lenSq !== 0 ? ((x - x1) * C + (y - y1) * D) / lenSq : -1;
  const [xx, yy] =
    param < 0
      ? [x1, y1]
      : param > 1
        ? [x2, y2]
        : [x1 + param * C, y1 + param * D];
  return dist(x, y, xx, yy);
}

// Douglas-Peucker simplification.
function approxPolyDp(polyline: Line, epsilon: number): Line {
  if (polyline.length <= 2) return polyline;
  const keep = new Uint8Array(polyline.length);
  keep[0] = keep[polyline.length - 1] = 1;
  const stack = [0, polyline.length - 1];
  while (stack.length) {
    const hi = stack.pop()!;
    const lo = stack.pop()!;
    let dmax = 0;
    let argmax = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = ptSegDist(polyline[i], polyline[lo], polyline[hi]);
      if (d > dmax) {
        dmax = d;
        argmax = i;
      }
    }
    if (dmax > epsilon) {
      keep[argmax] = 1;
      stack.push(lo, argmax, argmax, hi);
    }
  }
  return polyline.filter((_, i) => keep[i]);
}

// Bridson's Poisson disk sampling over a W by H box, from its center.
function poissondisk(W: number, H: number, r: number): Pt[] {
  const samples: Pt[] = [];
  const w = r / 1.4142135624;
  const r2 = r * r;
  const cols = Math.floor(W / w);
  const rows = Math.floor(H / w);
  const grid = new Int32Array(Math.max(0, cols * rows)).fill(-1);
  const first: Pt = [W / 2, H / 2];
  samples.push(first);
  const fc = Math.floor(first[0] / w);
  const fr = Math.floor(first[1] / w);
  if (fc + fr * cols < grid.length) grid[fc + fr * cols] = 0;
  const active: Pt[] = [first];
  while (active.length) {
    const ridx = Math.floor(rand() * active.length);
    const pos = active[ridx];
    let found = false;
    for (let n = 0; n < 30; n++) {
      const sr = r + rand() * r;
      // A uniform direction, by rejection from the square, rather than fishdraw's angle: the same spread
      // with no trig.
      let ux: number;
      let uy: number;
      let u2: number;
      do {
        ux = rand() * 2 - 1;
        uy = rand() * 2 - 1;
        u2 = ux * ux + uy * uy;
      } while (u2 > 1 || u2 < 1e-6);
      const ul = Math.sqrt(u2);
      const sx = pos[0] + (sr * ux) / ul;
      const sy = pos[1] + (sr * uy) / ul;
      const col = Math.floor(sx / w);
      const row = Math.floor(sy / w);
      if (col <= 0 || row <= 0 || col >= cols - 1 || row >= rows - 1) continue;
      if (grid[col + row * cols] !== -1) continue;
      let ok = true;
      for (let i = -1; i <= 1 && ok; i++)
        for (let j = -1; j <= 1; j++) {
          const nbr = grid[(row + i) * cols + col + j];
          if (nbr === -1) continue;
          const [nx, ny] = samples[nbr];
          if ((sx - nx) * (sx - nx) + (sy - ny) * (sy - ny) < r2) {
            ok = false;
            break;
          }
        }
      if (ok) {
        found = true;
        grid[row * cols + col] = samples.length;
        const sample: Pt = [sx, sy];
        active.push(sample);
        samples.push(sample);
      }
    }
    if (!found) {
      active[ridx] = active[active.length - 1];
      active.pop();
    }
  }
  return samples;
}

// ---- Scales ----

// A scale's outline and the mask that hides what's behind it, at unit size. Every scale is one of these
// stretched, so they're computed once.
const SQUAMA_MASK: readonly Pt[] = Array.from({ length: 7 }, (_, i) => {
  const a = (i / 7) * PI * 2;
  return [-spow(cos(a), 1.3), spow(sin(a), 1.3)];
});
const SQUAMA_EDGE: readonly Pt[] = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 7) * PI + PI / 2;
  return [-spow(cos(a), 1.4), spow(sin(a), 1.4)];
});

const squamaMask = (w: number, h: number): Line =>
  SQUAMA_MASK.map(([x, y]) => [x * w, y * h]);

// One scale: a half-round edge, with `m` short strokes inside it.
function squama(w: number, h: number, m = 3): Line[] {
  const q = [SQUAMA_EDGE.map(([x, y]): Pt => [x * w, y * h])];
  for (let i = 0; i < m; i++) {
    const t = i / (m - 1);
    q.push([
      [-w * 0.3 + (rand() - 0.5), -h * 0.2 + t * h * 0.4 + (rand() - 0.5)],
      [w * 0.5 + (rand() - 0.5), -h * 0.3 + t * h * 0.6 + (rand() - 0.5)],
    ]);
  }
  return q;
}

type SquamaFunc = (x: number, y: number, w: number, h: number) => Line[];

// A mesh of scales over an m by n grid bent by noise. With `interclip`, each scale hides behind the ones laid
// before it, like shingles.
function squamaMesh(
  m: number,
  n: number,
  uw: number,
  uh: number,
  squamaFunc: SquamaFunc,
  noiseX: number,
  noiseY: number,
  interclip: boolean,
): Line[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) {
      const x = j * uw;
      const y = (n * uh) / 2 - cos((i / (n - 1)) * PI) * ((n * uh) / 2);
      const a = noise(x * 0.005, y * 0.005) * PI * 2 - PI;
      const r = noise(x * 0.005, y * 0.005);
      pts.push([x + cos(a) * r * noiseX, y + cos(a) * r * noiseY]);
    }
  const whs: Pt[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) {
      if (i === 0 || j === 0 || i === n - 1 || j === m - 1) {
        whs.push([uw / 2, uh / 2]);
        continue;
      }
      const [a, b, c, d, e] = [
        pts[i * m + j],
        pts[i * m + j + 1],
        pts[i * m + j - 1],
        pts[(i - 1) * m + j],
        pts[(i + 1) * m + j],
      ];
      whs.push([
        (dist(...a, ...b) + dist(...a, ...c)) / 4,
        (dist(...a, ...d) + dist(...a, ...e)) / 4,
      ]);
    }

  const out: Line[] = [];
  // The masks laid so far, bucketed by position, so a scale only clips against those it overlaps.
  const cell = 2 * Math.max(uw, uh);
  const placed = new Map<number, { poly: Line; box: Box }[]>();
  const key = (cx: number, cy: number) => cx * 65536 + cy;
  const lay = (x: number, y: number, dw: number, dh: number) => {
    let p = squamaFunc(x, y, dw, dh).map((a) => trsl(a, x, y));
    if (!interclip) {
      out.push(...p);
      return;
    }
    const q = trsl(squamaMask(dw, dh), x, y);
    const pb = bbox(p.flat());
    const cx0 = Math.floor(pb.x / cell);
    const cx1 = Math.floor((pb.x + pb.w) / cell);
    const cy0 = Math.floor(pb.y / cell);
    const cy1 = Math.floor((pb.y + pb.h) / cell);
    for (let cx = cx0 - 1; cx <= cx1 + 1; cx++)
      for (let cy = cy0 - 1; cy <= cy1 + 1; cy++)
        for (const { poly, box } of placed.get(key(cx, cy)) ?? []) {
          if (
            box.x > pb.x + pb.w ||
            box.x + box.w < pb.x ||
            box.y > pb.y + pb.h ||
            box.y + box.h < pb.y
          )
            continue;
          p = clipOut(p, poly);
        }
    out.push(...p);
    const qb = bbox(q);
    const k = key(
      Math.floor((qb.x + qb.w / 2) / cell),
      Math.floor((qb.y + qb.h / 2) / cell),
    );
    const bucket = placed.get(k);
    if (bucket) bucket.push({ poly: q, box: qb });
    else placed.set(k, [{ poly: q, box: qb }]);
  };

  for (let j = 1; j < m - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const [x, y] = pts[i * m + j];
      const [dw, dh] = whs[i * m + j];
      lay(x, y, dw, dh);
    }
    for (let i = 1; i < n - 1; i++) {
      const [a, b, c, d] = [
        pts[i * m + j],
        pts[i * m + j + 1],
        pts[(i + 1) * m + j],
        pts[(i + 1) * m + j + 1],
      ];
      const [wa, wb, wc, wd] = [
        whs[i * m + j],
        whs[i * m + j + 1],
        whs[(i + 1) * m + j],
        whs[(i + 1) * m + j + 1],
      ];
      const x = (a[0] + b[0] + c[0] + d[0]) / 4;
      const y = (a[1] + b[1] + c[1] + d[1]) / 4;
      const dw = ((wa[0] + wb[0] + wc[0] + wd[0]) / 4) * 1.2;
      const dh = (wa[1] + wb[1] + wc[1] + wd[1]) / 4;
      lay(x, y, dw, dh);
    }
  }
  return out;
}

// Spots spread by Poisson disk, each a soft blob broken up by noise.
function patternDot(scale = 1): (x: number, y: number) => boolean {
  const samples = poissondisk(500, 300, 20 * scale);
  const rs = samples.map(() => (rand() * 5 + 10) * scale);
  // A spot's radius is under 15 * scale, so a point only needs the spots in its own and neighboring cells.
  const size = 20 * scale;
  const cols = Math.ceil(500 / size) + 1;
  const rows = Math.ceil(300 / size) + 1;
  const cells: number[][] = Array.from({ length: cols * rows }, () => []);
  samples.forEach(([x, y], i) =>
    cells[Math.floor(y / size) * cols + Math.floor(x / size)].push(i),
  );
  return (x, y) => {
    const cx = Math.floor(x / size);
    const cy = Math.floor(y / size);
    for (let r = Math.max(0, cy - 1); r <= Math.min(rows - 1, cy + 1); r++)
      for (let c = Math.max(0, cx - 1); c <= Math.min(cols - 1, cx + 1); c++)
        for (const i of cells[r * cols + c]) {
          const rad = rs[i];
          const [x0, y0] = samples[i];
          if (dist(x, y, x0, y0) >= rad) continue;
          const u = ((x - x0) / rad) * 2;
          const v = ((y - y0) / rad) * 2;
          if (exp(-0.5 * u * u) * exp(-0.5 * v * v) * noise(x, y, 999) > 0.2)
            return true;
        }
    return false;
  };
}

type Pattern = ((x: number, y: number) => boolean) | null;

// ---- Bodies ----

// Overlapping round scales, a band of them left out along the belly.
function fishBodyA(
  curve0: Line,
  curve1: Line,
  scaleScale: number,
  pattern: Pattern,
): Line[] {
  const curve2 = curve0.map((p, i) => lerp2d(...p, ...curve1[i], 0.95));
  const curve3 = curve0.map((p, i) => lerp2d(...p, ...curve1[i], 0.85));
  const outline2 = curve0.concat(curve2.slice().reverse());
  const outline3 = curve0.concat(curve3.slice().reverse());
  const b = bbox(curve0.concat(curve1));
  const m = Math.floor(b.w / (scaleScale * 15));
  const n = Math.floor(b.h / (scaleScale * 15));
  const uw = b.w / m;
  const uh = b.h / n;
  const fn: SquamaFunc = pattern
    ? (x, y, w, h) => squama(w, h, Number(pattern(x, y)) * 3)
    : (_x, _y, w, h) => squama(w, h);
  const sq = squamaMesh(m, n + 3, uw, uh, fn, uw * 3, uh * 3, true).map((a) =>
    trsl(a, b.x, b.y - uh * 1.5),
  );
  const o1 = clipMulti(clipIn(sq, outline2), outline3);
  const belly = o1.out.filter(() => rand() < 0.6);
  return [curve0, curve1.slice().reverse(), ...o1.in, ...belly];
}

// Fine scales that thin out towards the belly, kept wherever the pattern holds.
function fishBodyB(
  curve0: Line,
  curve1: Line,
  scaleScale: number,
  pattern: Pattern,
): Line[] {
  const curve2 = curve0.map((p, i) => lerp2d(...p, ...curve1[i], 0.95));
  const outline2 = curve0.concat(curve2.slice().reverse());
  const b = bbox(curve0.concat(curve1));
  const m = Math.floor(b.w / (scaleScale * 5));
  const n = Math.floor(b.h / (scaleScale * 5));
  const uw = b.w / m;
  const uh = b.h / n;
  const sq = squamaMesh(
    m,
    n + 16,
    uw,
    uh,
    (_x, _y, w, h) => squama(w * 0.7, h * 0.6, 0),
    uw * 8,
    uh * 8,
    false,
  ).map((a) => trsl(a, b.x, b.y - uh * 8));
  const o1: Line[] = [];
  for (const line of clipIn(sq, outline2)) {
    const [x, y] = line[0];
    const t = (y - b.y) / b.h;
    const keep = pattern
      ? pattern(x, y) || (rand() > t && rand() > t)
      : rand() > t;
    if (keep) o1.push(line);
  }
  return [curve0, curve1.slice().reverse(), ...o1];
}

// Crossed diagonal lines bent by noise, broken up towards the belly.
function fishBodyC(curve0: Line, curve1: Line, scaleScale: number): Line[] {
  const step = 6 * scaleScale;
  const curve2 = curve0.map((p, i) => lerp2d(...p, ...curve1[i], 0.95));
  const curve3 = curve0.map((p, i) => lerp2d(...p, ...curve1[i], 0.4));
  const outline2 = curve0.concat(curve2.slice().reverse());
  const b = bbox(curve0.concat(curve1));
  b.x -= step;
  b.y -= step;
  b.w += step * 2;
  b.h += step * 2;
  let lines: Line[] = [curve3.reverse()];
  for (let i = -b.h; i < b.w; i += step)
    lines.push([
      [b.x + i, b.y],
      [b.x + i + b.h, b.y + b.h],
    ]);
  for (let i = 0; i < b.w + b.h; i += step)
    lines.push([
      [b.x + i, b.y],
      [b.x + i - b.h, b.y + b.h],
    ]);
  lines = lines.map((line) =>
    resample(line, 4).map(([x, y]): Pt => {
      const t = (y - b.y) / b.h;
      const y1 = -cos(t * PI) * (b.h / 2) + b.y + b.h / 2;
      const dx = (noise(x * 0.005, y1 * 0.005, 0.1) - 0.5) * 50;
      const dy = (noise(x * 0.005, y1 * 0.005, 1.2) - 0.5) * 50;
      return [x + dx, y1 + dy];
    }),
  );
  const o0 = binclip(
    clipIn(lines, outline2),
    (_x, _y, t) => rand() > t || rand() > t,
  ).in;
  return [curve0, curve1.slice().reverse(), ...o0];
}

// A midline with ribs off it, warped by noise, and veins.
function fishBodyD(c0: Line, c1: Line, scaleScale: number): Line[] {
  let curve2 = c0.map((p, i) => lerp2d(...p, ...c1[i], 0.4));
  const curve0 = resample(c0, 10 * scaleScale);
  const curve1 = resample(c1, 10 * scaleScale);
  curve2 = resample(curve2, 10 * scaleScale);
  const outline1 = curve0.concat(curve1.slice().reverse());
  const o0: Line[] = [curve2];
  for (
    let i = 3;
    i < Math.min(curve0.length, curve1.length, curve2.length);
    i++
  )
    o0.push([curve0[i], curve2[i - 3]], [curve2[i - 3], curve1[i]]);
  let o1: Line[] = [];
  for (const raw of o0) {
    const line = resample(raw, 4).map(
      ([x, y]): Pt => [
        x + 30 * (noise(x * 0.01, y * 0.01, -1) - 0.5),
        y + 30 * (noise(x * 0.01, y * 0.01, 9) - 0.5),
      ],
    );
    o1.push(
      ...binclip(
        [line],
        (x, _y, t) =>
          (rand() > cos(t * PI) && rand() < x / 500) ||
          (rand() > cos(t * PI) && rand() < x / 500),
      ).in,
    );
  }
  o1 = clipIn(o1, outline1);
  return [curve0, curve1.slice().reverse(), ...o1, ...veinShape(outline1)];
}

// ---- Fins ----

// The direction each point of a curve faces, square to it.
function normals(curve: Line): number[] {
  return curve.map((p, i) => {
    if (i === 0) return atan2(curve[1][1] - p[1], curve[1][0] - p[0]) - PI / 2;
    if (i === curve.length - 1)
      return atan2(p[1] - curve[i - 1][1], p[0] - curve[i - 1][0]) - PI / 2;
    const a0 = atan2(curve[i - 1][1] - p[1], curve[i - 1][0] - p[0]);
    let a1 = atan2(curve[i + 1][1] - p[1], curve[i + 1][0] - p[0]);
    while (a1 > a0) a1 -= PI * 2;
    a1 += PI * 2;
    return (a0 + a1) / 2;
  });
}

type Fin = [Line, Line[]];

// A fin of soft rays fanned from a root curve, its edge wavering.
function finA(
  curve: Line,
  ang0: number,
  ang1: number,
  func: (t: number) => number,
  clipRoot = false,
  curvature0 = 0,
  curvature1 = 0,
  softness = 10,
): Fin {
  const angs = normals(curve);
  let out0: Line = [];
  const out1: Line[] = [];
  let out2: Line = [];
  let out3: Line = [];
  for (let i = 0; i < curve.length; i++) {
    const t = i / (curve.length - 1);
    const a = angs[i] + lerp(ang0, ang1, t);
    const w = func(t);
    const [x0, y0] = curve[i];
    const p = resample(
      [
        [x0, y0],
        [x0 + cos(a) * w, y0 + sin(a) * w],
      ],
      3,
    );
    for (let j = 0; j < p.length; j++) {
      const s = j / (p.length - 1);
      const ss = Math.sqrt(s);
      const [x, y] = p[j];
      const cv = lerp(curvature0, curvature1, t) * sin(s * PI);
      p[j][0] +=
        noise(x * 0.1, y * 0.1, 3) * ss * softness + cos(a - PI / 2) * cv;
      p[j][1] +=
        noise(x * 0.1, y * 0.1, 4) * ss * softness + sin(a - PI / 2) * cv;
    }
    if (i === 0) out2 = p;
    else if (i === curve.length - 1) out3 = p.slice().reverse();
    else {
      out0.push(p[p.length - 1]);
      const from = clipRoot ? Math.floor(rand() * 4) : 0;
      const q = p.slice(
        from,
        Math.max(2, Math.floor(p.length * (rand() * 0.5 + 0.5))),
      );
      if (q.length) out1.push(q);
    }
  }
  out0 = resample(out0, 3);
  for (const pt of out0) {
    const [x, y] = pt;
    pt[0] += (noise(x * 0.1, y * 0.1) * 6 - 3) * (softness / 10);
    pt[1] += (noise(x * 0.1, y * 0.1) * 6 - 3) * (softness / 10);
  }
  const o = out2.concat(out0).concat(out3);
  out1.unshift(o);
  return [o.concat(curve.slice().reverse()), out1];
}

// A fin of stiff spines with webbing scalloped between them, shaded from the root.
function finB(
  curve: Line,
  ang0: number,
  ang1: number,
  func: (t: number) => number,
  dark = 1,
): Fin {
  const angs = normals(curve);
  const out0: Line[] = [];
  const out2: Line[] = [];
  const out3: Line[] = [];
  for (let i = 0; i < curve.length; i++) {
    const t = i / (curve.length - 1);
    const a = angs[i] + lerp(ang0, ang1, t);
    const w = func(t);
    const [cx, cy] = curve[i];
    const x1 = cx + cos(a) * w;
    const y1 = cy + sin(a) * w;
    out0.push([
      [cx + 1.8 * cos(a - PI / 2), cy + 1.8 * sin(a - PI / 2)],
      [x1 + 0.5 * cos(a - PI / 2), y1 + 0.5 * sin(a - PI / 2)],
      [x1 + 0.5 * cos(a + PI / 2), y1 + 0.5 * sin(a + PI / 2)],
      [cx + 1.8 * cos(a + PI / 2), cy + 1.8 * sin(a + PI / 2)],
    ]);
  }
  const n = 10;
  for (let i = 0; i < curve.length - 1; i++) {
    const [, , a0, q0] = out0[i];
    const [p1, a1] = out0[i + 1];
    const b = lerp2d(...a0, ...q0, 0.1);
    const c = lerp2d(...a1, ...p1, 0.1);
    const ang = atan2(c[1] - b[1], c[0] - b[0]);
    const o: Line = [];
    for (let j = 0; j < n; j++) {
      const t = j / (n - 1);
      const d = sin(t * PI) * 2;
      const a = lerp2d(...b, ...c, t);
      o.push([a[0] + cos(ang + PI / 2) * d, a[1] + sin(ang + PI / 2) * d]);
    }
    out2.push(o);
    const m = Math.floor(
      (Math.min(dist(...a0, ...q0), dist(...a1, ...p1)) / 10) * dark,
    );
    const e = lerp2d(...curve[i], ...curve[i + 1], 0.5);
    for (let k = 0; k < m; k++) {
      const s = (k / m) * 0.7;
      const p: Line = [];
      for (let j = 1; j < n - 1; j++) p.push(lerp2d(...o[j], ...e, s));
      out3.push(p);
    }
  }
  // Each spine hides behind the ones before it.
  const out4: Line[] = [];
  if (out0.length > 1) {
    out4.push(out0[0]);
    for (let i = 1; i < out0.length; i++) {
      let spine = [out0[i]];
      for (let k = 0; k < i; k++) spine = clipOut(spine, out0[k]);
      out4.push(...spine);
    }
  }
  return [
    out2.flat().concat(curve.slice().reverse()),
    out4.concat(out2).concat(out3),
  ];
}

// A row of little finlets, every third point of the curve.
function finlet(curve: Line, h: number, dir = 1): Fin {
  const angs = normals(curve);
  let out0: Line = curve.map(([x0, y0], i) => {
    const t = i / (curve.length - 1);
    let w = (i + 1) % 3 ? 0 : h;
    w *= dir > 0 ? 1 - t * 0.5 : 0.5 + t * 0.5;
    return [x0 + cos(angs[i]) * w, y0 + sin(angs[i]) * w];
  });
  out0 = resample(out0, 2);
  for (const pt of out0) {
    const [x, y] = pt;
    pt[0] += noise(x * 0.1, y * 0.1) * 2 - 3;
    pt[1] += noise(x * 0.1, y * 0.1) * 2 - 3;
  }
  out0.push(curve[curve.length - 1]);
  return [out0.concat(curve.slice().reverse()), [out0]];
}

// The small fleshy fin on the back near the tail, as on a trout.
function finAdipose(curve: Line, dx: number, dy: number, r: number): Fin {
  const [x0, y0] = curve[Math.floor(curve.length / 2)];
  const [x, y] = [x0 + dx, y0 + dy];
  const [x1, y1] = curve[0];
  const [x2, y2] = curve[curve.length - 1];
  const a01 = atan2(y1 - y, x1 - x) + acos(r / dist(x, y, x1, y1));
  let a02 = atan2(y2 - y, x2 - x) - acos(r / dist(x, y, x2, y2));
  a02 -= PI * 2;
  while (a02 < a01) a02 += PI * 2;
  let out0: Line = [[x1, y1]];
  for (let i = 0; i < 20; i++) {
    const a = lerp(a01, a02, i / 19);
    out0.push([x + cos(a) * r, y + sin(a) * r]);
  }
  out0.push([x2, y2]);
  out0 = resample(out0, 3);
  out0.forEach((pt, i) => {
    const s = sin((i / (out0.length - 1)) * PI);
    const [px, py] = pt;
    pt[0] += (noise(px * 0.01, py * 0.01) - 0.5) * s * 50;
    pt[1] += (noise(px * 0.01, py * 0.01) - 0.5) * s * 50;
  });
  const cc = out0.concat(curve.slice().reverse());
  const out1 = binclip(
    clipIn([trsl(out0, 0, 4)], cc),
    (_x, _y, t) => rand() < sin(t * PI),
  ).in;
  return [cc, [out0, ...out1]];
}

// ---- Head ----

function fishLip(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w: number,
): Line {
  x0 += rand() * 0.001 - 0.0005;
  y0 += rand() * 0.001 - 0.0005;
  x1 += rand() * 0.001 - 0.0005;
  y1 += rand() * 0.001 - 0.0005;
  const h = dist(x0, y0, x1, y1);
  const a0 = atan2(y1 - y0, x1 - x0);
  const ang = acos(w / h);
  const dx = cos(a0 + PI / 2) * 0.5;
  const dy = sin(a0 + PI / 2) * 0.5;
  let o: Line = [[x0 - dx, y0 - dy]];
  for (let i = 0; i < 10; i++) {
    const a = lerp(ang, PI * 2 - ang, i / 9) + a0;
    o.push([-cos(a) * w + x1, -sin(a) * w + y1]);
  }
  o.push([x0 + dx, y0 + dy]);
  o = resample(o, 2.5);
  for (const pt of o) {
    const [x, y] = pt;
    pt[0] += noise(x * 0.05, y * 0.05, -1) * 2 - 1;
    pt[1] += noise(x * 0.05, y * 0.05, -2) * 2 - 1;
  }
  return o;
}

function fishTeeth(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  h: number,
  dir: number,
  sep = 3.5,
): Line[] {
  const n = Math.max(2, Math.floor(dist(x0, y0, x1, y1) / sep));
  const ang = atan2(y1 - y0, x1 - x0);
  const out: Line[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = lerp2d(x0, y0, x1, y1, t);
    const w = h * t;
    const b: Pt = [
      a[0] + cos(ang + (dir * PI) / 2) * w,
      a[1] + sin(ang + (dir * PI) / 2) * w,
    ];
    const c: Pt = [a[0] + cos(ang), a[1] + sin(ang)];
    const d: Pt = [a[0] + cos(ang + PI), a[1] + sin(ang + PI)];
    const g: Pt = [
      a[0] + cos(ang + dir * (PI / 2 + 0.15)) * w,
      a[1] + sin(ang + dir * (PI / 2 + 0.15)) * w,
    ];
    out.push([c, lerp2d(...c, ...b, 0.7), g, lerp2d(...d, ...b, 0.7), d]);
  }
  return out;
}

function fishJaw(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Fin {
  const ang = atan2(y2 - y0, x2 - x0);
  const d = dist(x0, y0, x2, y2);
  const o: Line = [];
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    const s = sin(t * PI);
    const w = (s * d) / 20;
    const p = lerp2d(x2, y2, x0, y0, t);
    const q: Pt = [p[0] + cos(ang - PI / 2) * w, p[1] + sin(ang - PI / 2) * w];
    o.push([
      q[0] + (noise(q[0] * 0.01, q[1] * 0.01, 1) - 0.5) * 4 * s,
      q[1] + (noise(q[0] * 0.01, q[1] * 0.01, 4) - 0.5) * 4 * s,
    ]);
  }
  return [
    [
      [x2, y2],
      [x1, y1],
      [x0, y0],
    ],
    [o, ...veinShape(o, 5)],
  ];
}

const circle = (ex: number, ey: number, r: number, a: number): Pt => [
  ex + cos(a) * r,
  ey + sin(a) * r,
];

// A round eye with a ring and a hatched pupil.
function fishEyeA(ex: number, ey: number, rad: number): Fin {
  const eye0: Line = [];
  const eye1: Line = [];
  const eye2: Line = [];
  for (let i = 0; i < 20; i++) {
    const t = i / 19;
    const a = t * PI * 2 + (PI / 4) * 3;
    eye0.push(circle(ex, ey, rad, a));
    if (t > 0.5) eye1.push(circle(ex, ey, rad * 0.8, a));
    const [px, py] = circle(ex, ey, rad * 0.4, a);
    eye2.push([px - 0.75, py - 0.75]);
  }
  return [eye0, [eye0, eye1, eye2, ...shadeShape(eye2, 2.7, 10, 10)]];
}

// An eye with arcs of shading on one side, a filled pupil and a highlight cut out of both.
function fishEyeB(ex: number, ey: number, rad: number): Fin {
  const eye0: Line = [];
  const eye2: Line = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 19) * PI * 2 + Math.E;
    eye0.push(circle(ex, ey, rad, a));
    eye2.push(circle(ex, ey, rad * 0.4, a));
  }
  let eye1: Line[] = [];
  const m = Math.floor((rad * 0.6) / 2);
  for (let i = 0; i < m; i++) {
    const e: Line = [];
    for (let k = 0; k < 20; k++)
      e.push(
        circle(ex, ey, rad - i * 2, lerp((PI * 7) / 8, (PI * 13) / 8, k / 19)),
      );
    eye1.push(e);
  }
  let trig = resample(
    [
      circle(ex, ey, rad * 0.9, (-PI * 3) / 4),
      [ex + 1, ey + 1],
      circle(ex, ey, rad * 0.9, (-PI * 11) / 12),
    ],
    3,
  );
  trig = trig.map(([x, y]): Pt => {
    const nx = x + noise(x * 0.1, y * 0.1, 22) * 4 - 2;
    return [nx, y + noise(nx * 0.1, y * 0.1, 33) * 4 - 2];
  });
  const ef = clipOut(fillShape(eye2, 1.5), trig);
  eye1 = clipOut(eye1, trig);
  const pupil = clipOut([eye2], trig);
  return [eye0, [eye0, ...eye1, ...pupil, ...ef]];
}

// A whisker: a tapering ribbon wandering along the noise.
function barbel(x: number, y: number, n: number, ang: number, dd = 3): Line {
  const curve: Line = [[x, y]];
  const sd = rand() * PI * 2;
  let ar = 1;
  for (let i = 0; i < n; i++) {
    x += cos(ang) * dd;
    y += sin(ang) * dd;
    ang += (noise(i * 0.1, sd) - 0.5) * ar;
    ar *= i < n / 2 ? 1.02 : 0.92;
    curve.push([x, y]);
  }
  const o0: Line = [];
  const o1: Line = [];
  for (let i = 0; i < n - 1; i++) {
    const w = 1.5 * (1 - i / (n - 1));
    const a = curve[i - 1];
    const b = curve[i];
    const c = curve[i + 1];
    let a1 = atan2(c[1] - b[1], c[0] - b[0]);
    let a2: number;
    if (a) {
      const a0 = atan2(a[1] - b[1], a[0] - b[0]);
      a1 -= PI * 2;
      while (a1 < a0) a1 += PI * 2;
      a2 = (a0 + a1) / 2;
    } else a2 = a1 - PI / 2;
    o0.push([b[0] + cos(a2) * w, b[1] + sin(a2) * w]);
    o1.push([b[0] + cos(a2 + PI) * w, b[1] + sin(a2 + PI) * w]);
  }
  o0.push(curve[curve.length - 1]);
  return o0.concat(o1.slice().reverse());
}

type Params = ReturnType<typeof generateParams>;

// The head from the nose (x0, y0) back to the gill line from (x1, y1) to (x2, y2): its outline, gill cover,
// eye, lips, jaw, teeth and whiskers.
function fishHead(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  arg: Params,
): Fin {
  const n = 20;
  const curve0: Line = [];
  const curve1: Line = [];
  const curve2: Line = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = (PI / 2) * t;
    const x = x1 - spow(cos(a), 1.5) * (x1 - x0);
    const y = y0 - spow(sin(a), 1.5) * (y0 - y1);
    const dx = (noise(x * 0.01, y * 0.01, 9) * 40 - 20) * (1.01 - t);
    const dy = (noise(x * 0.01, y * 0.01, 8) * 40 - 20) * (1.01 - t);
    curve0.push([x + dx, y + dy]);
  }
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = (PI / 2) * t;
    const x = x2 - spow(cos(a), 0.8) * (x2 - x0);
    const y = y0 + spow(sin(a), 1.5) * (y2 - y0);
    const dx = (noise(x * 0.01, y * 0.01, 9) * 40 - 20) * (1.01 - t);
    const dy = (noise(x * 0.01, y * 0.01, 8) * 40 - 20) * (1.01 - t);
    curve1.unshift([x + dx, y + dy]);
  }
  const ang = atan2(y2 - y1, x2 - x1);
  for (let i = 1; i < n - 1; i++) {
    const t = i / (n - 1);
    const p = lerp2d(x1, y1, x2, y2, t);
    const r = noise(t * 2, 1.2) * Math.sqrt(sin(t * PI)) * 20;
    curve2.push([p[0] + cos(ang - PI / 2) * r, p[1] + sin(ang - PI / 2) * r]);
  }
  const outline = curve0.concat(curve2).concat(curve1);

  // The gill cover's edge.
  const inline = curve2
    .slice(Math.floor(curve2.length / 3))
    .concat(curve1.slice(0, Math.floor(curve1.length / 2)))
    .slice(0, curve0.length)
    .map((p, i, all) => {
      const r = sin((i / (all.length - 1)) * PI);
      const s = r * r * 0.1 + 0.12;
      return lerp2d(...p, ...curve0[i], s);
    });
  const dix = (x0 - inline[inline.length - 1][0]) * 0.3;
  const diy = (y0 - inline[inline.length - 1][1]) * 0.2;
  for (const pt of inline) {
    pt[0] += dix;
    pt[1] += diy;
  }

  let ex = x0 * 0.475 + x1 * 0.375 + x2 * 0.15;
  let ey = y0 * 0.475 + y1 * 0.375 + y2 * 0.15;
  const d0 = ptSegDist([ex, ey], [x0, y0], [x1, y1]);
  const d1 = ptSegDist([ex, ey], [x0, y0], [x2, y2]);
  if (d0 < arg.eye_size && d1 < arg.eye_size) arg.eye_size = Math.min(d0, d1);
  else if (d0 < arg.eye_size) {
    const a = atan2(y1 - y0, x1 - x0) + PI / 2;
    ex = x0 * 0.5 + x1 * 0.5 + cos(a) * arg.eye_size;
    ey = y0 * 0.5 + y1 * 0.5 + sin(a) * arg.eye_size;
  }

  const jawPt0 = curve1[18 - arg.mouth_size];
  const jawL = dist(...jawPt0, ...curve1[18]) * arg.jaw_size;
  const jawAng0 = atan2(curve1[18][1] - jawPt0[1], curve1[18][0] - jawPt0[0]);
  const jawAng =
    jawAng0 - (arg.has_teeth * 0.5 + 0.5) * arg.jaw_open * (PI / 4);
  const jawPt1: Pt = [
    jawPt0[0] + cos(jawAng) * jawL,
    jawPt0[1] + sin(jawAng) * jawL,
  ];

  const [eye0, eyeLines] = (arg.eye_type ? fishEyeB : fishEyeA)(
    ex,
    ey,
    arg.eye_size,
  );
  const ef = clipIn(eyeLines, outline);
  const inlines = clipOut([inline], eye0);
  const lip0 = fishLip(...jawPt0, ...curve1[18], 3);
  const lip1 = fishLip(...jawPt0, ...jawPt1, 3);
  let jaw = fishJaw(...curve1[15 - arg.mouth_size], ...jawPt0, ...jawPt1)[1];
  jaw = clipOut(clipOut(jaw, lip1), outline);

  let teeth0s: Line[] = [];
  let teeth1s: Line[] = [];
  if (arg.has_teeth) {
    const teeth0 = fishTeeth(
      ...jawPt0,
      ...curve1[18],
      arg.teeth_length,
      -1,
      arg.teeth_space,
    );
    const teeth1 = fishTeeth(
      ...jawPt0,
      ...jawPt1,
      arg.teeth_length,
      1,
      arg.teeth_space,
    );
    teeth0s = clipOut(teeth0, lip0);
    teeth1s = clipOut(teeth1, lip1);
  }
  const olines = clipOut([outline], lip0);
  const lip0s = clipOut([lip0], lip1);
  const sh = clipOut(clipOut(shadeShape(outline, 6, -6, -6), lip0), eye0);
  const sh2 = clipOut(
    clipOut(veinShape(outline, arg.head_texture_amount), lip0),
    eye0,
  );

  const bbs: Line[] = [];
  let lip1s: Line[] = [lip1];
  if (arg.has_moustache) {
    const bb0 = barbel(...jawPt0, arg.moustache_length, (PI * 3) / 4, 1.5);
    lip1s = clipOut([lip1], bb0);
    jaw = clipOut(jaw, bb0);
    bbs.push(bb0);
  }
  if (arg.has_beard) {
    const jawPt =
      jaw[0] && jaw[0].length
        ? jaw[0][Math.floor(jaw[0].length / 2)]
        : curve1[8];
    const beard = () =>
      trsl(
        barbel(...jawPt, arg.beard_length, PI * 0.6 + rand() * 0.4 - 0.2),
        rand() - 0.5,
        rand() - 0.5,
      );
    const bb1 = beard();
    const bb2 = beard();
    const bb3 = beard();
    bbs.push(bb1, ...clipOut([bb2], bb1), ...clipOut(clipOut([bb3], bb2), bb1));
  }

  // Everything left of the gill line, to hide the body behind the head.
  const c0end = curve0[curve0.length - 1];
  const outlinel: Line = [
    [0, 0],
    [c0end[0], 0],
    c0end,
    ...curve2,
    curve1[0],
    [curve1[0][0], 300],
    [0, 300],
  ];
  return [
    outlinel,
    [
      ...olines,
      ...inlines,
      ...lip0s,
      ...lip1s,
      ...ef,
      ...sh,
      ...sh2,
      ...bbs,
      ...teeth0s,
      ...teeth1s,
      ...jaw,
    ],
  ];
}

// ---- The fish ----

const bean = (x: number) =>
  Math.sqrt(0.25 - (x - 0.5) * (x - 0.5)) * (2.6 + 2.4 * pow(x, 1.5)) * 0.542;

function choice<T>(opts: readonly T[], percs?: readonly number[]): T {
  const weights = percs ?? opts.map(() => 1);
  let s = 0;
  for (const w of weights) s += w;
  const r = rand() * s;
  s = 0;
  for (let i = 0; i < weights.length; i++) {
    s += weights[i];
    if (r <= s) return opts[i];
  }
  return opts[opts.length - 1];
}

// A random draw from the triangular distribution on [a, c] peaking at b.
function rndtri(a: number, b: number, c: number): number {
  const s0 = (b - a) / 2;
  const s1 = (c - b) / 2;
  const s = s0 + s1;
  const r = rand() * s;
  if (r < s0) return a + Math.sqrt(2 * r * (b - a));
  return c - Math.sqrt(2 * (s - r) * (c - b));
}

// fishdraw's parameters, named as it names them, drawn in its order.
function generateParams() {
  const body_curve_type = choice([0, 1]);
  const body_curve_amount = rndtri(0.5, 0.85, 0.98);
  const body_length = rndtri(200, 350, 420);
  const body_height = rndtri(45, 90, 150);
  const scale_type = choice([0, 1, 2, 3]);
  const scale_scale = rndtri(0.8, 1, 1.5);
  const pattern_type = choice([0, 1, 2, 3, 4]);
  const pattern_scale = rndtri(0.5, 1, 2);
  const dorsal_texture_type = choice([0, 1]);
  const dorsal_type = choice([0, 1]);
  const dorsal_length = rndtri(30, 90, 180);
  const [dorsal_start, dorsal_end] =
    dorsal_type === 0
      ? [Math.floor(rndtri(7, 8, 15)), Math.floor(rndtri(20, 27, 28))]
      : [Math.floor(rndtri(11, 12, 16)), Math.floor(rndtri(19, 21, 24))];
  const wing_texture_type = choice([0, 1]);
  const wing_type = choice([0, 1]);
  const wing_length =
    wing_type === 0 ? rndtri(40, 130, 200) : rndtri(40, 150, 350);
  const [wing_width, wing_y] =
    wing_texture_type === 0
      ? [rndtri(7, 10, 20), rndtri(0.45, 0.7, 0.85)]
      : [rndtri(20, 30, 50), rndtri(0.45, 0.65, 0.75)];
  const wing_start = Math.floor(rndtri(5, 6, 8));
  const wing_end = Math.floor(rndtri(5, 6, 8));
  const pelvic_texture_type = dorsal_texture_type ? choice([0, 1]) : 0;
  const pelvic_type = choice([0, 1]);
  const pelvic_length = rndtri(30, 85, 140);
  let pelvic_start: number;
  let pelvic_end: number;
  if (pelvic_type === 0) {
    pelvic_start = Math.floor(rndtri(7, 9, 11));
    pelvic_end = Math.floor(rndtri(13, 14, 15));
  } else {
    pelvic_start = Math.floor(rndtri(7, 9, 12));
    pelvic_end = pelvic_start + 2;
  }
  const anal_texture_type = dorsal_texture_type ? choice([0, 1]) : 0;
  const anal_type = choice([0, 1]);
  const anal_length = rndtri(20, 50, 80);
  const anal_start = Math.floor(rndtri(16, 19, 23));
  const anal_end = Math.floor(rndtri(25, 29, 31));
  const tail_type = choice([0, 1, 2, 3, 4, 5]);
  const tail_length = rndtri(50, 75, 180);
  const finlet_type = choice([0, 1, 2, 3]);
  const neck_type = choice([0, 1]);
  const nose_height = rndtri(-50, 0, 35);
  const head_length = rndtri(20, 30, 35);
  const mouth_size = Math.floor(rndtri(6, 8, 11));
  const head_texture_amount = Math.floor(rndtri(30, 60, 160));
  const has_moustache = choice([0, 0, 0, 1]);
  const has_beard = choice([0, 0, 0, 0, 0, 1]);
  const moustache_length = Math.floor(rndtri(10, 20, 40));
  const beard_length = Math.floor(rndtri(20, 30, 50));
  const eye_type = choice([0, 1]);
  const eye_size = rndtri(8, 10, 28);
  const jaw_size = rndtri(0.7, 1, 1.4);
  const has_teeth = choice([0, 1, 1]);
  const teeth_length = rndtri(5, 8, 15);
  const teeth_space = rndtri(3, 3.5, 6);
  return {
    body_curve_type,
    body_curve_amount,
    body_length,
    body_height,
    scale_type,
    scale_scale,
    pattern_type,
    pattern_scale,
    dorsal_texture_type,
    dorsal_type,
    dorsal_length,
    dorsal_start,
    dorsal_end,
    wing_texture_type,
    wing_type,
    wing_length,
    wing_width,
    wing_y,
    wing_start,
    wing_end,
    pelvic_texture_type,
    pelvic_type,
    pelvic_length,
    pelvic_start,
    pelvic_end,
    anal_texture_type,
    anal_type,
    anal_length,
    anal_start,
    anal_end,
    tail_type,
    tail_length,
    finlet_type,
    neck_type,
    nose_height,
    head_length,
    mouth_size,
    head_texture_amount,
    has_moustache,
    has_beard,
    moustache_length,
    beard_length,
    eye_type,
    eye_size,
    jaw_size,
    jaw_open: 1,
    has_teeth,
    teeth_length,
    teeth_space,
  };
}

// The fish's polylines, in fishdraw's plate units.
function fish(arg: Params): Line[] {
  const n = 32;
  const curve0: Line = [];
  const curve1: Line = [];
  for (let side = 0; side < 2; side++)
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = 225 + (t - 0.5) * arg.body_length;
      const swell =
        arg.body_curve_type === 0
          ? sin(t * PI) *
              lerp(0.5, 1, noise(t * 2, side + 1)) *
              arg.body_curve_amount +
            (1 - arg.body_curve_amount)
          : lerp(
              1 - arg.body_curve_amount,
              1,
              noise(t * 1.2, side + 1) * bean(1 - t),
            );
      const y = 150 + (side ? 1 : -1) * swell * arg.body_height;
      (side ? curve1 : curve0).push([x, y]);
    }
  // The body, with the adipose fin when it has one: the region the pattern and dots fill.
  const outline = curve0.concat(curve1.slice().reverse());
  const body: Line[] = [outline];
  let sh = shadeShape(outline, 8, -12, -12);

  let pattern: Pattern = null;
  if (arg.pattern_type === 1) pattern = patternDot(arg.pattern_scale);
  else if (arg.pattern_type === 2)
    pattern = (x, y) =>
      noise(x * 0.1, y * 0.1) * Math.max(0.35, (y - 10) / 280) < 0.2;
  else if (arg.pattern_type === 3)
    pattern = (x, y) => {
      const dx = noise(x * 0.01, y * 0.01) * 30;
      return Math.floor((x + dx) / (30 * arg.pattern_scale)) % 2 === 1;
    };

  let bd =
    arg.scale_type === 0
      ? fishBodyA(curve0, curve1, arg.scale_scale, pattern)
      : arg.scale_type === 1
        ? fishBodyB(curve0, curve1, arg.scale_scale, pattern)
        : arg.scale_type === 2
          ? fishBodyC(curve0, curve1, arg.scale_scale)
          : fishBodyD(curve0, curve1, arg.scale_scale);

  // Dorsal fin.
  let f0Func: (t: number) => number;
  let f0A0: number;
  let f0A1: number;
  let f0Cv: number;
  if (arg.dorsal_type === 0) {
    f0A0 = 0.2 + deviate(0.05);
    f0A1 = 0.3 + deviate(0.05);
    f0Cv = 0;
    f0Func = (t) =>
      (0.3 + noise(t * 3) * 0.7) * arg.dorsal_length * Math.sqrt(sin(t * PI));
  } else {
    f0A0 = 0.6 + deviate(0.05);
    f0A1 = 0.3 + deviate(0.05);
    f0Cv = arg.dorsal_length / 8;
    f0Func = (t) =>
      arg.dorsal_length * ((t - 1) * (t - 1) * 0.5 + (1 - t) * 0.5);
  }
  const dorsal = curve0.slice(arg.dorsal_start, arg.dorsal_end);
  const [c0, dorsalLines] =
    arg.dorsal_texture_type === 0
      ? finA(resample(dorsal, 5), f0A0, f0A1, f0Func, false, f0Cv, 0)
      : finB(resample(dorsal, 15), f0A0, f0A1, f0Func);
  let f0 = clipOut(dorsalLines, trsl(outline, 0, 0.001));

  // Pectoral fin, which lies over the body.
  const f1Pt = lerp2d(
    ...curve0[arg.wing_start],
    ...curve1[arg.wing_end],
    arg.wing_y,
  );
  let f1Curve: Line = [];
  for (let i = 0; i < 10; i++)
    f1Curve.push([
      f1Pt[0],
      lerp(f1Pt[1] - arg.wing_width / 2, f1Pt[1] + arg.wing_width / 2, i / 9),
    ]);
  let f1Func: (t: number) => number;
  let f1A0: number;
  let f1A1: number;
  let f1Soft: number;
  let f1Cv: number;
  if (arg.wing_type === 0) {
    f1A0 = -0.4 + deviate(0.05);
    f1A1 = 0.4 + deviate(0.05);
    f1Soft = 10;
    f1Cv = 0;
    f1Func = (t) =>
      ((40 + (20 + noise(t * 3) * 70) * Math.sqrt(sin(t * PI))) / 130) *
      arg.wing_length;
  } else {
    f1A0 = deviate(0.05);
    f1A1 = 0.4 + deviate(0.05);
    f1Soft = 5;
    f1Cv = arg.wing_length / 25;
    f1Func = (t) => arg.wing_length * (1 - t * 0.95);
  }
  let c1: Line;
  let f1: Line[];
  if (arg.wing_texture_type === 0) {
    f1Curve = resample(f1Curve, 1.5);
    [c1, f1] = finA(f1Curve, f1A0, f1A1, f1Func, true, f1Cv, 0, f1Soft);
  } else {
    f1Curve = resample(f1Curve, 4);
    [c1, f1] = finB(f1Curve, f1A0, f1A1, f1Func, 0.3);
  }
  bd = clipOut(bd, c1);

  // Pelvic fin.
  let f2Func: (t: number) => number;
  let f2A0: number;
  let f2A1: number;
  if (arg.pelvic_type === 0) {
    f2A0 = -0.8 + deviate(0.05);
    f2A1 = -0.5 + deviate(0.05);
    f2Func = (t) =>
      ((10 + (15 + noise(t * 3) * 60) * Math.sqrt(sin(t * PI))) / 85) *
      arg.pelvic_length;
  } else {
    f2A0 = -0.9 + deviate(0.05);
    f2A1 = -0.3 + deviate(0.05);
    f2Func = (t) => (t * 0.5 + 0.5) * arg.pelvic_length;
  }
  const pelvic = curve1.slice(arg.pelvic_start, arg.pelvic_end).reverse();
  let f2 =
    arg.pelvic_texture_type === 0
      ? finA(resample(pelvic, arg.pelvic_type ? 2 : 5), f2A0, f2A1, f2Func)[1]
      : finB(resample(pelvic, arg.pelvic_type ? 2 : 15), f2A0, f2A1, f2Func)[1];
  f2 = clipOut(f2, c1);

  // Anal fin.
  const f3A0 = -0.4 + deviate(0.05);
  const f3A1 = -0.4 + deviate(0.05);
  const f3Func =
    arg.anal_type === 0
      ? (t: number) =>
          ((10 + (10 + noise(t * 3) * 30) * Math.sqrt(sin(t * PI))) / 50) *
          arg.anal_length
      : (t: number) => arg.anal_length * (t * t * 0.8 + 0.2);
  const anal = curve1.slice(arg.anal_start, arg.anal_end).reverse();
  let f3 =
    arg.anal_texture_type === 0
      ? finA(resample(anal, 5), f3A0, f3A1, f3Func)[1]
      : finB(resample(anal, 15), f3A0, f3A1, f3Func)[1];
  f3 = clipOut(f3, c1);

  // Tail.
  const last = curve0.length - 1;
  const f4R = dist(...curve0[last - 1], ...curve1[last - 1]);
  const f4D = f4R / Math.max(Math.min(Math.floor(f4R / 1.5), 20), 8);
  const tailRoot = (k: number, step: number) =>
    resample([curve0[last - k], curve1[last - k]], step);
  const L = arg.tail_length;
  let c4: Line;
  let f4: Line[];
  if (arg.tail_type === 0)
    [c4, f4] = finA(
      tailRoot(0, f4D),
      -0.6,
      0.6,
      (t) => ((75 - (10 + noise(t * 3) * 10) * sin(3 * t * PI - PI)) / 75) * L,
      true,
    );
  else if (arg.tail_type === 1)
    [c4, f4] = finA(
      tailRoot(1, f4D),
      -0.6,
      0.6,
      (t) => L * (sin(t * PI) * 0.5 + 0.5),
      true,
    );
  else if (arg.tail_type === 2) {
    const cv = L / 8;
    [c4, f4] = finA(
      tailRoot(0, f4D * 0.7),
      -0.6,
      0.6,
      (t) => (Math.abs(cos(PI * t)) * 0.8 + 0.2) * L,
      true,
      cv,
      -cv,
    );
  } else if (arg.tail_type === 3)
    [c4, f4] = finA(
      tailRoot(1, f4D),
      -0.6,
      0.6,
      (t) => (1 - sin(t * PI) * 0.3) * L,
      true,
    );
  else if (arg.tail_type === 4)
    [c4, f4] = finA(
      tailRoot(1, f4D),
      -0.6,
      0.6,
      (t) => (1 - sin(t * PI) * 0.6) * (1 - t * 0.45) * L,
      true,
    );
  else
    [c4, f4] = finA(
      tailRoot(1, f4D),
      -0.6,
      0.6,
      (t) => (1 - pow(sin(t * PI), 0.4) * 0.55) * L,
      true,
    );
  bd = clipOut(bd, trsl(c4, 1, 0));
  f4 = clipOut(f4, c1);

  // Finlets, an adipose fin or a second dorsal. As in fishdraw, with finlets on both sides only the lower row
  // is kept.
  let f5: Line[] = [];
  if (arg.finlet_type === 1) {
    const lower = resample(curve1.slice(arg.anal_end, -2).reverse(), 5);
    f5 =
      lower.length > 1
        ? finlet(lower, 5)[1]
        : finlet(resample(curve0.slice(arg.dorsal_end, -2), 5), 5)[1];
  } else if (arg.finlet_type === 2) {
    const [c5, lines] = finAdipose(
      resample(curve0.slice(27, 30), 5),
      20,
      -5,
      6,
    );
    f5 = lines;
    body.push(trsl(c5, 0, -1));
  } else if (arg.finlet_type === 3) {
    const root = resample(curve0.slice(arg.dorsal_end + 2, -3), 5);
    if (root.length > 2)
      f5 = finA(
        root,
        0.2,
        0.3,
        (t) =>
          (0.3 + noise(t * 3) * 0.7) *
          arg.dorsal_length *
          0.6 *
          Math.sqrt(sin(t * PI)),
      )[1];
  }

  const [cf, fh] =
    arg.neck_type === 0
      ? fishHead(
          50 - arg.head_length,
          150 + arg.nose_height,
          ...curve0[6],
          ...curve1[5],
          arg,
        )
      : fishHead(
          50 - arg.head_length,
          150 + arg.nose_height,
          ...curve0[5],
          ...curve1[6],
          arg,
        );
  bd = clipOut(bd, cf);
  sh = clipOut(clipOut(sh, cf), c1);
  f1 = clipOut(f1, cf);
  f0 = clipOut(f0, c1);

  let sh2: Line[] = [];
  if (pattern) {
    sh2 =
      arg.scale_type > 1
        ? patternshadeShape([...body, trsl(c0, 0, 3)], 3.5, pattern)
        : patternshadeShape([c0], 4.5, pattern);
    sh2 = clipOut(clipOut(sh2, cf), c1);
  }
  let sh3: Line[] = [];
  if (arg.pattern_type === 4) {
    sh3 = smalldotShape([...body, trsl(c0, 0, 5)], arg.pattern_scale);
    sh3 = clipOut(clipOut(sh3, c1), cf);
  }
  return [
    ...bd,
    ...f0,
    ...f1,
    ...f2,
    ...f3,
    ...f4,
    ...f5,
    ...fh,
    ...sh,
    ...sh2,
    ...sh3,
  ];
}

// ---- The name ----

// Syllables and their weights for each part of a binomial name, from fishdraw.
// prettier-ignore
const SYLLABLES: readonly (readonly [string, number])[][] = [
  [["A",27], ["AB",2], ["AL",4], ["AN",4], ["AP",2], ["AR",2], ["AU",2], ["BA",5], ["BE",2], ["BO",2], ["BRA",3], ["CA",4], ["CAR",2], ["CENT",5], ["CHAE",3], ["CHAN",2], ["CHI",2], ["CHRO",2], ["CHRY",3], ["CO",8], ["CTE",3], ["CY",3], ["CYP",2], ["DE",2], ["E",7], ["EU",2], ["GA",3], ["GAS",2], ["GNA",2], ["GO",2], ["HE",6], ["HIP",3], ["HO",2], ["HY",4], ["LA",5], ["LAB",2], ["LE",5], ["LI",2], ["LO",3], ["LU",2], ["MAC",2], ["ME",5], ["MIC",5], ["MO",4], ["MU",2], ["MY",3], ["NA",2], ["NAN",3], ["NE",2], ["NO",2], ["O",9], ["ON",2], ["OP",2], ["OS",2], ["PA",7], ["PER",2], ["PHO",2], ["PI",2], ["PLA",2], ["PLEU",2], ["PO",5], ["PSEU",6], ["PTE",2], ["RA",2], ["RHI",2], ["RHOM",2], ["RU",2], ["SAL",2], ["SAR",2], ["SCA",2], ["SCOM",2], ["SE",4], ["SI",2], ["STE",2], ["TAU",2], ["TEL",2], ["THO",3], ["TRI",3], ["XE",2], ["XI",3]],
  [["BE",2], ["BI",2], ["BO",3], ["BU",3], ["CA",5], ["CAM",2], ["CAN",11], ["CE",6], ["CENT",4], ["CHA",2], ["CHEI",7], ["CHI",2], ["CHO",4], ["CHY",4], ["CI",3], ["CIRR",3], ["CO",5], ["DI",4], ["DO",9], ["DON",2], ["DOP",2], ["GA",4], ["GAS",5], ["GO",13], ["HI",3], ["HYN",3], ["LA",12], ["LAB",3], ["LE",3], ["LEOT",2], ["LI",8], ["LICH",3], ["LIS",4], ["LO",15], ["LOS",6], ["LU",2], ["LY",3], ["MA",10], ["ME",3], ["MI",3], ["MICH",2], ["MO",2], ["MU",2], ["NA",8], ["NE",7], ["NEC",3], ["NI",4], ["NO",20], ["NOCH",2], ["NOP",2], ["NOS",3], ["PA",4], ["PE",3], ["PEN",2], ["PHA",10], ["PHI",2], ["PHO",6], ["PHY",2], ["PHYO",2], ["PI",5], ["PIP",2], ["PIS",2], ["PO",13], ["POG",2], ["POPH",2], ["RA",14], ["RAE",3], ["RAM",2], ["REOCH",2], ["RI",9], ["RICH",4], ["RIP",2], ["RIS",5], ["RO",42], ["ROI",2], ["ROP",4], ["ROS",2], ["RY",6], ["RYN",3], ["SE",3], ["SO",11], ["TA",2], ["TE",19], ["TEL",2], ["THAL",3], ["THE",2], ["THO",5], ["THOP",3], ["THU",2], ["TI",4], ["TICH",2], ["TO",27], ["TOG",2], ["TOP",2], ["TOS",2], ["VA",2], ["XI",2], ["XO",2]],
  [["BIUS",3], ["BUS",3], ["CA",7], ["CHUS",7], ["CION",3], ["CON",2], ["CUS",3], ["DA",2], ["DES",5], ["DEUS",2], ["DON",13], ["DUS",7], ["GER",2], ["GON",3], ["GUS",4], ["HUS",2], ["LA",13], ["LEA",2], ["LIS",2], ["LIUS",2], ["LUS",24], ["MA",18], ["MIS",13], ["MUS",17], ["NA",12], ["NIA",4], ["NIO",2], ["NIUS",5], ["NOPS",3], ["NUS",19], ["PHEUS",3], ["PHIS",2], ["PIS",2], ["PUS",3], ["RA",7], ["RAS",3], ["RAX",2], ["RIA",5], ["RION",2], ["RIS",6], ["RUS",29], ["RYS",3], ["SA",2], ["SER",2], ["SIA",2], ["SIS",3], ["SUS",4], ["TER",4], ["TES",16], ["TEUS",2], ["THUS",6], ["THYS",12], ["TIA",5], ["TIS",5], ["TUS",6], ["TYS",2]],
  [["A",23], ["AE",3], ["AL",11], ["AN",6], ["AR",6], ["AT",3], ["AU",8], ["AUST",2], ["AY",2], ["BA",2], ["BAR",3], ["BE",3], ["BI",9], ["BO",3], ["CA",8], ["CAL",2], ["CAM",2], ["CAN",3], ["CAR",2], ["CAU",2], ["CE",2], ["CHI",2], ["CHRY",6], ["COR",2], ["CRY",2], ["CU",3], ["CYA",4], ["DA",3], ["DE",4], ["DEN",2], ["DI",2], ["DIA",2], ["DO",2], ["DOR",2], ["DU",2], ["E",15], ["FA",2], ["FAS",4], ["FES",2], ["FI",2], ["FLO",2], ["FOR",2], ["FRE",2], ["FUR",2], ["GLA",2], ["GO",2], ["HA",2], ["HE",5], ["HIP",3], ["HO",2], ["HYP",2], ["I",3], ["IM",2], ["IN",2], ["JA",2], ["LA",7], ["LAB",2], ["LE",2], ["LEU",3], ["LI",3], ["LO",4], ["LU",4], ["MA",13], ["MAC",7], ["MAR",3], ["ME",10], ["MO",2], ["MOO",2], ["MOR",2], ["NA",5], ["NE",2], ["NI",3], ["NIG",6], ["NO",4], ["O",14], ["OR",2], ["PA",3], ["PAL",2], ["PE",5], ["PEC",2], ["PHO",2], ["PLA",3], ["PLU",2], ["PO",3], ["PRO",2], ["PU",2], ["PUL",2], ["RA",3], ["RE",5], ["RHOM",2], ["RI",2], ["RO",3], ["ROST",2], ["RU",3], ["SA",5], ["SAL",2], ["SE",5], ["SO",2], ["SPI",3], ["SPLEN",3], ["STRIA",3], ["TAU",3], ["THO",3], ["TRI",7], ["TY",2], ["U",3], ["UN",2], ["VA",4], ["VI",3], ["VIT",2], ["VUL",2], ["WAL",2], ["XAN",2]],
  [["BA",5], ["BAR",2], ["BER",2], ["BI",4], ["BO",4], ["BOI",2], ["BU",2], ["CA",10], ["CAN",6], ["CAU",2], ["CE",3], ["CEL",5], ["CHA",3], ["CHEL",2], ["CHOP",2], ["CI",6], ["CIA",12], ["CIL",2], ["CIO",3], ["CO",6], ["COS",2], ["CU",22], ["DA",4], ["DE",4], ["DEL",2], ["DI",7], ["DIA",5], ["DO",6], ["FAS",10], ["FEL",2], ["FI",2], ["FOR",2], ["GA",9], ["GE",7], ["GI",4], ["HA",2], ["HYN",2], ["KE",2], ["LA",39], ["LAN",3], ["LE",10], ["LEA",3], ["LEU",2], ["LI",20], ["LIA",2], ["LO",10], ["LON",2], ["LOP",2], ["MA",12], ["ME",9], ["MEN",3], ["MI",8], ["MIE",2], ["MO",4], ["NA",19], ["NE",5], ["NEA",5], ["NEL",3], ["NEN",3], ["NI",12], ["NIF",2], ["NO",9], ["NOI",3], ["NOP",2], ["NU",7], ["PA",3], ["PE",4], ["PER",3], ["PHA",6], ["PHE",2], ["PI",8], ["PIN",5], ["PO",2], ["QUI",4], ["RA",25], ["RAC",2], ["RE",4], ["REN",3], ["RES",2], ["RI",26], ["RIA",2], ["RIEN",2], ["RIF",2], ["RO",21], ["ROR",2], ["ROS",2], ["ROST",4], ["RU",6], ["RYTH",5], ["SA",3], ["SE",6], ["SI",4], ["SO",6], ["SU",2], ["TA",14], ["TAE",2], ["TE",19], ["TER",2], ["THAL",2], ["THO",2], ["THU",2], ["TI",21], ["TIG",3], ["TO",14], ["TU",2], ["VA",3], ["VE",5], ["VES",2], ["VI",5], ["VIT",2], ["XEL",2], ["XI",2], ["ZO",3]],
  [["BEUS",2], ["CA",7], ["CENS",4], ["CEPS",3], ["CEUS",5], ["CHA",2], ["CHUS",5], ["CI",2], ["CUS",13], ["DA",6], ["DAX",2], ["DENS",2], ["DES",6], ["DI",8], ["DIS",2], ["DUS",4], ["FER",3], ["GA",4], ["GI",2], ["GUS",5], ["KEI",2], ["KI",5], ["LA",11], ["LAS",3], ["LI",7], ["LIS",19], ["LIUS",2], ["LOR",2], ["LUM",2], ["LUS",11], ["MA",10], ["MIS",4], ["MUS",6], ["NA",12], ["NEUS",3], ["NI",15], ["NII",4], ["NIS",6], ["NIUS",2], ["NUS",18], ["PIS",3], ["PUS",3], ["RA",11], ["RE",4], ["RI",14], ["RIAE",2], ["RIE",2], ["RII",3], ["RIO",2], ["RIS",13], ["RIX",2], ["RONS",3], ["RU",2], ["RUM",4], ["RUS",21], ["SA",7], ["SEUS",2], ["SI",10], ["SIS",8], ["SUS",13], ["TA",31], ["TEUS",2], ["THUS",5], ["TI",5], ["TIS",2], ["TOR",2], ["TUM",10], ["TUS",68], ["TZI",2], ["ZI",3]],
];

// A pseudo-Latin binomial: a genus of one to three syllables plus an ending, and a species likewise.
function binomen(): string {
  const syl = (k: number) => {
    const slot = SYLLABLES[k];
    return choice(
      slot.map(([s]) => s),
      slot.map(([, w]) => w),
    );
  };
  let name = syl(0);
  for (let i = Math.floor(rand() * 3); i > 0; i--) name += syl(1);
  name += syl(2) + " " + syl(3);
  for (let i = Math.floor(rand() * 3); i > 0; i--) name += syl(4);
  name += syl(5);
  name = name.replace(/([A-Z])\1\1+/g, "$1$1");
  return name[0] + name.slice(1).toLowerCase();
}

// ---- Hershey lettering ----

// Glyphs of the Hershey Roman simplex font that fishdraw carries: capitals, lowercase and the period. Each
// coordinate is a letter offset from "R", in units where a capital is 21 tall with its baseline at 9.
// prettier-ignore
const HERSHEY: Record<number, string> = {
  501: "  9I[RFJ[ RRFZ[ RMTWT",
  502: " 24G\\KFK[ RKFTFWGXHYJYLXNWOTP RKPTPWQXRYTYWXYWZT[K[",
  503: " 19H]ZKYIWGUFQFOGMILKKNKSLVMXOZQ[U[WZYXZV",
  504: " 16G\\KFK[ RKFRFUGWIXKYNYSXVWXUZR[K[",
  505: " 12H[LFL[ RLFYF RLPTP RL[Y[",
  506: "  9HZLFL[ RLFYF RLPTP",
  507: " 23H]ZKYIWGUFQFOGMILKKNKSLVMXOZQ[U[WZYXZVZS RUSZS",
  508: "  9G]KFK[ RYFY[ RKPYP",
  509: "  3NVRFR[",
  510: " 11JZVFVVUYTZR[P[NZMYLVLT",
  511: "  9G\\KFK[ RYFKT RPOY[",
  512: "  6HYLFL[ RL[X[",
  513: " 12F^JFJ[ RJFR[ RZFR[ RZFZ[",
  514: "  9G]KFK[ RKFY[ RYFY[",
  515: " 22G]PFNGLIKKJNJSKVLXNZP[T[VZXXYVZSZNYKXIVGTFPF",
  516: " 14G\\KFK[ RKFTFWGXHYJYMXOWPTQKQ",
  517: " 25G]PFNGLIKKJNJSKVLXNZP[T[VZXXYVZSZNYKXIVGTFPF RSWY]",
  518: " 17G\\KFK[ RKFTFWGXHYJYLXNWOTPKP RRPY[",
  519: " 21H\\YIWGTFPFMGKIKKLMMNOOUQWRXSYUYXWZT[P[MZKX",
  520: "  6JZRFR[ RKFYF",
  521: " 11G]KFKULXNZQ[S[VZXXYUYF",
  522: "  6I[JFR[ RZFR[",
  523: " 12F^HFM[ RRFM[ RRFW[ R\\FW[",
  524: "  6H\\KFY[ RYFK[",
  525: "  7I[JFRPR[ RZFRP",
  526: "  9H\\YFK[ RKFYF RK[Y[",
  601: " 18I\\XMX[ RXPVNTMQMONMPLSLUMXOZQ[T[VZXX",
  602: " 18H[LFL[ RLPNNPMSMUNWPXSXUWXUZS[P[NZLX",
  603: " 15I[XPVNTMQMONMPLSLUMXOZQ[T[VZXX",
  604: " 18I\\XFX[ RXPVNTMQMONMPLSLUMXOZQ[T[VZXX",
  605: " 18I[LSXSXQWOVNTMQMONMPLSLUMXOZQ[T[VZXX",
  606: "  9MYWFUFSGRJR[ ROMVM",
  607: " 23I\\XMX]W`VaTbQbOa RXPVNTMQMONMPLSLUMXOZQ[T[VZXX",
  608: " 11I\\MFM[ RMQPNRMUMWNXQX[",
  609: "  9NVQFRGSFREQF RRMR[",
  610: " 12MWRFSGTFSERF RSMS^RaPbNb",
  611: "  9IZMFM[ RWMMW RQSX[",
  612: "  3NVRFR[",
  613: " 19CaGMG[ RGQJNLMOMQNRQR[ RRQUNWMZM\\N]Q][",
  614: " 11I\\MMM[ RMQPNRMUMWNXQX[",
  615: " 18I\\QMONMPLSLUMXOZQ[T[VZXXYUYSXPVNTMQM",
  616: " 18H[LMLb RLPNNPMSMUNWPXSXUWXUZS[P[NZLX",
  617: " 18I\\XMXb RXPVNTMQMONMPLSLUMXOZQ[T[VZXX",
  618: "  9KXOMO[ ROSPPRNTMWM",
  619: " 18J[XPWNTMQMNNMPNRPSUTWUXWXXWZT[Q[NZMX",
  620: "  9MYRFRWSZU[W[ ROMVM",
  621: " 11I\\MMMWNZP[S[UZXW RXMX[",
  622: "  6JZLMR[ RXMR[",
  623: " 12G]JMN[ RRMN[ RRMV[ RZMV[",
  624: "  6J[MMX[ RXMM[",
  625: " 10JZLMR[ RXMR[P_NaLbKb",
  626: "  9J[XMM[ RMMXM RM[X[",
  710: "  6MWRYQZR[SZRY",
};

// A line of text as polylines, and its advance width.
function putText(text: string): [number, Line[]] {
  let x = 0;
  const out: Line[] = [];
  for (const ch of text) {
    const ord = ch.charCodeAt(0);
    const idx =
      ord >= 65 && ord <= 90
        ? 501 + ord - 65
        : ord >= 97 && ord <= 122
          ? 601 + ord - 97
          : ord === 46
            ? 710
            : null;
    if (idx === null) {
      if (ord === 32) x += 10;
      continue;
    }
    const entry = HERSHEY[idx];
    const xmin = entry.charCodeAt(3) - 82;
    const xmax = entry.charCodeAt(4) - 82;
    for (const stroke of entry.slice(5).split(" R")) {
      const line: Line = [];
      for (let j = 0; j + 1 < stroke.length; j += 2)
        line.push([
          x + stroke.charCodeAt(j) - 82 - xmin,
          stroke.charCodeAt(j + 1) - 82,
        ]);
      out.push(line);
    }
    x += xmax - xmin;
  }
  return [x, out];
}

// ---- Drawing ----

// The fish's pen, in fishdraw's units, where its plotter line is 1. A little heavier than 1, so the fish reads at desk
// size, where this pen is under a pixel, and still looks drawn with a fine pen in the detail view.
const PEN = 2.1;
// The lettering and keyline's pen, the keyline's inset and the caption's capital height, in units of the art's
// short side. The pen is about 1 px at desk size, where the short side is about 200 px.
const LETTER_PEN = 0.0048;
const FRAME = 0.06;
const CAP = 0.05;
// Draws with a short side under this many pixels are supersampled.
const MIN_UNIT = 128;

// One fish per seed, kept so a redraw of the same stamp doesn't regenerate it.
let cached: { seed: number; fish: Line[]; name: string } | null = null;
function fishFor(seed: number) {
  if (cached?.seed !== seed) {
    rand = stream(seed, 0x51ab0c4e);
    const table = stream(seed, 0x7e11e5a1);
    for (let i = 0; i < perlin.length; i++) perlin[i] = table();
    const fishLines = fish(generateParams());
    rand = stream(seed, 0x1a71e0ed);
    const name = binomen();
    // Douglas-Peucker at a tenth of a unit, as fishdraw's cleanup does, dropping degenerate runs.
    const lines = fishLines
      .filter(
        (l) => l.length > 1 && l.every(([x, y]) => Number.isFinite(x + y)),
      )
      .map((l) => approxPolyDp(l, 0.1));
    cached = { seed, fish: lines, name };
  }
  return cached;
}

// Rasterizes polylines, in pixels, `half` a pixel wide either side, into `cover`: each line its box-filtered
// area, the lines of one polyline joined by their maximum so joints don't darken, and separate polylines
// combined as overlapping ink. `own` is scratch the size of `cover`, all zero.
function rasterize(
  cover: Float32Array,
  own: Float32Array,
  lines: readonly Line[],
  width: number,
  half: number,
) {
  const height = cover.length / width;
  const touched: number[] = [];
  const reach = half + 0.5;
  for (const line of lines) {
    for (let k = 0; k + 1 < line.length; k++) {
      const [ax, ay] = line[k];
      const [bx, by] = line[k + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - reach));
      const y1 = Math.min(height - 1, Math.floor(Math.max(ay, by) + reach));
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        // The segment's x span within reach of this row.
        let ta = 0;
        let tb = 1;
        if (dy !== 0) {
          ta = (py - reach - ay) / dy;
          tb = (py + reach - ay) / dy;
          if (ta > tb) [ta, tb] = [tb, ta];
          ta = Math.max(0, ta);
          tb = Math.min(1, tb);
          if (ta > tb) continue;
        }
        const xa = ax + dx * ta;
        const xb = ax + dx * tb;
        const x0 = Math.max(0, Math.floor(Math.min(xa, xb) - reach));
        const x1 = Math.min(width - 1, Math.floor(Math.max(xa, xb) + reach));
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = px - ax - dx * t;
          const ey = py - ay - dy * t;
          const d2 = ex * ex + ey * ey;
          if (d2 >= reach * reach) continue;
          const d = Math.sqrt(d2);
          // The share of a one-pixel box centered d from the line's middle that the line covers.
          const c = Math.min(d + 0.5, half) - Math.max(d - 0.5, -half);
          const i = y * width + x;
          if (c > own[i]) {
            if (own[i] === 0) touched.push(i);
            own[i] = c > 1 ? 1 : c;
          }
        }
      }
    }
    for (const i of touched) {
      cover[i] += own[i] - cover[i] * own[i];
      own[i] = 0;
    }
    touched.length = 0;
  }
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  palette: Palette,
) {
  const { fish: fishLines, name } = fishFor(seed);
  const unit = Math.min(width, height);
  const W = width / unit;
  const H = height / unit;

  // The caption, centered under the fish and shrunk to fit a long name.
  const [tw, glyphs] = putText(name + ".");
  const g = Math.min(CAP / 21, (W - 2 * FRAME - 0.12) / tw);
  const baseline = H - FRAME - 0.045;
  const caption = glyphs.map((l) =>
    shr(l, -0.3).map(
      ([x, y]): Pt => [W / 2 + (x - tw / 2) * g, baseline + (y - 9) * g],
    ),
  );

  // The fish, as large as fits between the keyline and the caption.
  const box = bbox(fishLines.flat());
  const pad = FRAME + 0.05;
  const top = pad;
  const bottom = baseline - 21 * g - 0.04;
  const s = Math.min((W - 2 * pad) / box.w, (bottom - top) / box.h);
  const ox = W / 2 - (box.x + box.w / 2) * s;
  const oy = (top + bottom) / 2 - (box.y + box.h / 2) * s;
  // Small draws are drawn n times larger and averaged down, since there whole patches of lines crowd into
  // one pixel and their overlap is no longer a fair guess.
  const n = unit < MIN_UNIT ? Math.ceil(MIN_UNIT / unit) : 1;
  const [sw, sh, su] = [width * n, height * n, unit * n];
  const toPx = (lines: Line[], scale: number, x0: number, y0: number) =>
    lines.map((l) =>
      l.map(([x, y]): Pt => [(x0 + x * scale) * su, (y0 + y * scale) * su]),
    );

  const keyline: Line = [
    [FRAME, FRAME],
    [W - FRAME, FRAME],
    [W - FRAME, H - FRAME],
    [FRAME, H - FRAME],
    [FRAME, FRAME],
  ];
  const fine = new Float32Array(sw * sh);
  const own = new Float32Array(sw * sh);
  rasterize(fine, own, toPx(fishLines, s, ox, oy), sw, (PEN * s * su) / 2);
  rasterize(
    fine,
    own,
    toPx([...caption, keyline], 1, 0, 0),
    sw,
    (LETTER_PEN * su) / 2,
  );
  let cover = fine;
  if (n > 1) {
    cover = new Float32Array(width * height);
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++)
        cover[Math.floor(y / n) * width + Math.floor(x / n)] +=
          fine[y * sw + x];
    for (let i = 0; i < cover.length; i++) cover[i] /= n * n;
  }

  const paper = rgb(palette.paper);
  const ink = rgb(palette.inks[0]);
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let i = 0; i < width * height; i++) {
    const c = cover[i];
    data[4 * i] = Math.round(paper[0] + (ink[0] - paper[0]) * c);
    data[4 * i + 1] = Math.round(paper[1] + (ink[1] - paper[1]) * c);
    data[4 * i + 2] = Math.round(paper[2] + (ink[2] - paper[2]) * c);
    data[4 * i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

export const fishDrawing1: Style = { id: "fish1", draw };
