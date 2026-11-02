import { cos, sin } from "../exact";
import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Isometric blocks: a small building in the manner of Jordan Scales' isomer, stacked prisms, pyramids and
// stairs shaded flat by one light, like the model on a 1960s architecture stamp. Ported from isomer
// (github.com/jdan/isomer), under its license:
//
//   The MIT License (MIT)
//
//   Copyright (c) 2014 Jordan Scales <scalesjordan@gmail.com>
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in
//   all copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
//   THE SOFTWARE.
//
// From isomer come the projection (x and y at 30 degrees either side of the horizontal, z straight up), its
// Prism, Pyramid and Stairs shapes, and its shading: each face's base color lightened in HSL by 0.2 times the
// dot product of its normal with the light (2, -1, 3), so a block's top, right and left faces take three
// tones. The buildings follow its "draw structure" castle and its logo of colored columns.
//
// isomer paints whole faces back to front on a canvas, stroking each in its own color to hide the seams. Here
// every pixel is computed in our code so it matches in every browser and Node (ADR 0001): each sample row
// finds every face's span, the nearest face along the view owns each stretch of the row, and each pixel takes
// the exact width of every stretch across it. Faces never bleed into each other, and nothing depends on the
// order the shapes were added.

type Vec = [number, number, number];
type Rgb = [number, number, number];

// isomer's angle, pi / 6, precomputed: x runs up and right, y up and left.
const COS = cos(Math.PI / 6);
const SIN = sin(Math.PI / 6);
// Moving along this direction keeps a point's place on screen, so it measures distance from the viewer.
const VIEW: Vec = [1, 1, -2 * SIN];
// isomer's light position, normalized, and how far a face's lightness moves at most.
const LIGHT_NORM = Math.sqrt(14);
const LIGHT: Vec = [2 / LIGHT_NORM, -1 / LIGHT_NORM, 3 / LIGHT_NORM];
const COLOR_DIFFERENCE = 0.2;

// Paper around the building, as a share of the art's short side.
const PAD = 0.08;
// Sample rows per pixel. Across each row the coverage is exact, so these only smooth the sloped edges' steps.
const ROWS = 4;

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

// isomer's Color.lighten: `base` with its HSL lightness moved by `amount`, clamped to [0, 1].
function lighten([r0, g0, b0]: Rgb, amount: number): Rgb {
  const [r, g, b] = [r0 / 255, g0 / 255, b0 / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h =
      max === r
        ? (g - b) / d + (g < b ? 6 : 0)
        : max === g
          ? (b - r) / d + 2
          : (r - g) / d + 4;
    h /= 6;
  }
  l = Math.min(1, Math.max(0, l + amount));
  if (s === 0) return [l * 255, l * 255, l * 255].map(Math.floor) as Rgb;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map((c) =>
    Math.floor(c * 255),
  ) as Rgb;
}

// One flat face in world units: its corners in order, the ink it's printed in, and its outward unit normal.
type Face = { points: Vec[]; ink: number; normal: Vec };

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

// A face, with its normal turned away from `inside`, a point within the solid.
function face(points: Vec[], ink: number, inside: Vec): Face {
  let n = cross(sub(points[1], points[0]), sub(points[2], points[1]));
  if (dot(n, sub(points[0], inside)) < 0) n = [-n[0], -n[1], -n[2]];
  const len = Math.sqrt(dot(n, n));
  return { points, ink, normal: [n[0] / len, n[1] / len, n[2] / len] };
}

// The building, as a list of faces. `mirror` swaps x and y, so the same plan can face either way.
class Scene {
  faces: Face[] = [];
  constructor(private mirror: boolean) {}

  private at(x: number, y: number, z: number): Vec {
    return this.mirror ? [y, x, z] : [x, y, z];
  }

  // isomer's Shape.Prism: a box from (x, y, z), dx by dy by dz. Only its left, right and top faces can show.
  prism(
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    ink: number,
  ) {
    const p = (i: number, j: number, k: number) =>
      this.at(x + i * dx, y + j * dy, z + k * dz);
    const c = p(0.5, 0.5, 0.5);
    this.faces.push(
      face([p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)], ink, c),
      face([p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)], ink, c),
      face([p(0, 0, 0), p(0, 1, 0), p(0, 1, 1), p(0, 0, 1)], ink, c),
    );
  }

  // isomer's Shape.Pyramid: four triangles from the edges of a dx by dy base up to an apex dz above its middle.
  pyramid(
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    ink: number,
  ) {
    const p = (i: number, j: number, k: number) =>
      this.at(x + i * dx, y + j * dy, z + k * dz);
    const apex = p(0.5, 0.5, 1);
    const c = p(0.5, 0.5, 0.25);
    const base = [p(0, 0, 0), p(1, 0, 0), p(1, 1, 0), p(0, 1, 0)];
    base.forEach((a, i) =>
      this.faces.push(face([a, base[(i + 1) % 4], apex], ink, c)),
    );
  }

  // isomer's Stairs: steps rising `rise` over a run of the same length, `width` wide, climbing toward +y, or
  // toward +x when `alongX`. Each step is a block from the floor, which gives isomer's zigzag sides.
  stairs(
    x: number,
    y: number,
    z: number,
    width: number,
    rise: number,
    alongX: boolean,
    ink: number,
  ) {
    const steps = Math.max(2, Math.round(rise * STEPS_PER_UNIT));
    const d = rise / steps;
    for (let i = 0; i < steps; i++)
      if (alongX) this.prism(x + i * d, y, z, d, width, (i + 1) * d, ink);
      else this.prism(x, y + i * d, z, width, d, (i + 1) * d, ink);
  }
}

// isomer's stairs take 10 steps per unit. A stamp's building spans about 8 units, so 5 keep each step a few
// pixels tall at desk size.
const STEPS_PER_UNIT = 5;

const int = (rand: () => number, lo: number, hi: number) =>
  lo + Math.floor(rand() * (hi - lo + 1));

// Inks by role: `body` for the main blocks, `trim` for stairs and terraces, `roofs` for pyramids and caps.
type Inks = { body: number; trim: number; roofs: number[] };

// isomer's "draw structure": a block with a lower wing and a raised tier, stairs climbing each level, and
// pyramids on the tier's corners.
function castle(s: Scene, rand: () => number, inks: Inks, tall: boolean) {
  const w = int(rand, 3, 5);
  const d = int(rand, 3, 5);
  const h = tall ? 2 : int(rand, 1, 2);
  s.prism(1, 0, 0, w, d, h, inks.body);
  // The lower wing on the left, with stairs from the ground.
  s.prism(0, 1, 0, 1, d - 1, h / 2, inks.trim);
  s.stairs(0, 0, 0, 1, h / 2, false, inks.trim);
  // Stairs from the wing up to the block's roof, climbing toward +x along the wing's back.
  s.stairs(0, d - 1, h / 2, 1, h / 2, true, inks.trim);
  // The tier, set back one unit, and stairs up to it on the front.
  const tw = w - 1;
  const td = d - 1;
  const th = tall ? int(rand, 2, 3) : 1;
  s.prism(2, 1, h, tw, td, th, inks.body);
  s.stairs(1 + Math.floor(w / 2), 0, h, 1, 1, false, inks.trim);
  const top = h + th;
  // A pyramid on each corner of the tier, each a half unit across, as in isomer.
  const corners: [number, number][] = [
    [2, 1],
    [1 + w - 0.5, 1],
    [2, d - 0.5],
    [1 + w - 0.5, d - 0.5],
  ];
  corners.forEach(([x, y], i) =>
    s.pyramid(
      x,
      y,
      top,
      0.5,
      0.5,
      0.5 + 0.5 * rand(),
      inks.roofs[i % inks.roofs.length],
    ),
  );
  // isomer's dark plinth in the middle of the roof, with a block on it.
  if (rand() < 0.6) {
    const [cx, cy] = [1 + w / 2, d / 2 + 0.5];
    s.prism(cx - 0.5, cy - 0.5, top, 1, 1, 0.2, inks.trim);
    s.prism(cx - 0.3, cy - 0.3, top + 0.2, 0.6, 0.6, 0.6, inks.roofs[0]);
  }
}

// A stepped temple: tiers shrinking by a unit each side, a stairway up the front of every tier, and a shrine.
function ziggurat(s: Scene, rand: () => number, inks: Inks, tall: boolean) {
  const tiers = tall ? int(rand, 3, 4) : int(rand, 2, 3);
  const size = 2 * tiers + int(rand, 0, 2);
  const h = tall ? 1 : 0.75;
  for (let k = 0; k < tiers; k++)
    s.prism(k, k, k * h, size - 2 * k, size - 2 * k, h, inks.body);
  const sw = size % 2 === 0 ? 2 : 1;
  const sx = (size - sw) / 2;
  for (let k = 0; k < tiers; k++)
    s.stairs(sx, k - h, k * h, sw, h, false, inks.trim);
  const inner = size - 2 * tiers;
  const top = tiers * h;
  const shrine = Math.max(1, inner - 1);
  const o = tiers + (inner - shrine) / 2;
  s.prism(o, o, top, shrine, shrine, shrine * 0.75, inks.trim);
  s.pyramid(
    o,
    o,
    top + shrine * 0.75,
    shrine,
    shrine,
    shrine * 0.8,
    inks.roofs[0],
  );
}

// isomer's logo: a cluster of square columns, the rear ones tallest, each in its own ink.
function columns(s: Scene, rand: () => number, inks: Inks, tall: boolean) {
  const n = int(rand, 2, 3);
  const all = [inks.body, inks.trim, ...inks.roofs];
  let k = int(rand, 0, all.length - 1);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (i + j > 0 && rand() < 0.15) continue;
      const h =
        0.5 * int(rand, 1, 2) +
        (i + j) * (tall ? 0.75 : 0.5) * (0.6 + 0.8 * rand());
      const ink = all[k++ % all.length];
      s.prism(i, j, 0, 1, 1, h, ink);
      if (rand() < 0.25)
        s.pyramid(
          i,
          j,
          h,
          1,
          1,
          0.6,
          inks.roofs[0] === ink ? inks.body : inks.roofs[0],
        );
    }
}

// A modern block: a wide podium with stairs, a tall slab on it, and a pavilion with a pyramid roof.
function slab(s: Scene, rand: () => number, inks: Inks, tall: boolean) {
  const w = int(rand, 4, 6);
  const d = int(rand, 3, 4);
  s.prism(0, 0, 0, w, d, 0.5, inks.trim);
  s.stairs(
    int(rand, 0, w - 2),
    -0.5,
    0,
    int(rand, 1, 2),
    0.5,
    false,
    inks.trim,
  );
  const sw = w - 2;
  const sh = tall ? int(rand, 4, 6) : int(rand, 2, 4);
  s.prism(0.5, d - 1.5, 0.5, sw, 1, sh, inks.body);
  // Floors: thin bands across the slab's faces, as a ledge every unit.
  for (let z = 1; z < sh; z++)
    s.prism(0.4, d - 1.6, 0.5 + z - 0.08, sw + 0.2, 1.2, 0.08, inks.trim);
  s.prism(1, d - 1.25, 0.5 + sh, sw - 1, 0.5, 0.4, inks.trim);
  const px = w - 1.5;
  s.prism(px, 0.5, 0.5, 1, 1, 1, inks.body);
  s.pyramid(px, 0.5, 1.5, 1, 1, 0.7, inks.roofs[0]);
}

// A hamlet: houses with pyramid roofs on a shared platform, a stair up its front.
function hamlet(s: Scene, rand: () => number, inks: Inks) {
  const w = int(rand, 4, 5);
  const d = int(rand, 3, 4);
  s.prism(0, 0, 0, w, d, 0.5, inks.trim);
  const door = int(rand, 0, w - 1);
  s.stairs(door, -0.5, 0, 1, 0.5, false, inks.trim);
  // Houses on about half the cells, at least three, leaving the cell the stairs land on clear.
  const cells: [number, number][] = [];
  for (let j = 0; j < d; j++)
    for (let i = 0; i < w; i++) if (i !== door || j > 0) cells.push([i, j]);
  let roof = 0;
  let built = 0;
  cells.forEach(([i, j], k) => {
    if (rand() >= 0.5 && cells.length - k > 3 - built) return;
    built++;
    const h = 0.75 + 0.25 * int(rand, 0, 2);
    s.prism(i + 0.1, j + 0.1, 0.5, 0.8, 0.8, h, inks.body);
    const peak = 0.6 + 0.3 * rand();
    s.pyramid(
      i,
      j,
      0.5 + h,
      1,
      1,
      peak,
      inks.roofs[roof++ % inks.roofs.length],
    );
  });
}

// A face as the renderer sees it: its corners on screen, its depth plane and its shaded color.
type Drawn = {
  xs: Float64Array;
  ys: Float64Array;
  top: number;
  bottom: number;
  // Distance from the viewer at screen point (x, y): da * x + db * y + dc.
  da: number;
  db: number;
  dc: number;
  color: Rgb;
};

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  // Portrait art builds taller, as apparatus does: a square punch's art is square, the others at least 1.28 to 1.
  const tall = height > width * 1.14;

  // Inks by role. The darkest stays for trim when there are three or more, so bodies and roofs take the colors.
  const order = inks.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const roles: Inks =
    inks.length === 2
      ? { body: order[0], trim: order[0], roofs: [order[1]] }
      : {
          body: order.find((i) => i !== 0)!,
          trim: 0,
          roofs: order.filter((i) => i !== 0).slice(1),
        };

  const scene = new Scene(rand() < 0.5);
  const kind = Math.floor(rand() * 5);
  if (kind === 0) castle(scene, rand, roles, tall);
  else if (kind === 1) ziggurat(scene, rand, roles, tall);
  else if (kind === 2) columns(scene, rand, roles, tall);
  else if (kind === 3) slab(scene, rand, roles, tall);
  else hamlet(scene, rand, roles);

  // Faces turned toward the viewer, projected at scale 1: u across, v up.
  const colors = inks.map(rgb);
  const visible = scene.faces.filter((f) => dot(f.normal, VIEW) < 0);
  const project = ([x, y, z]: Vec) => [(x - y) * COS, (x + y) * SIN + z];
  let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const f of visible)
    for (const p of f.points) {
      const [u, v] = project(p);
      [u0, u1, v0, v1] = [
        Math.min(u0, u),
        Math.max(u1, u),
        Math.min(v0, v),
        Math.max(v1, v),
      ];
    }
  const pad = PAD * Math.min(width, height);
  const scale = Math.min(
    (width - 2 * pad) / (u1 - u0),
    (height - 2 * pad) / (v1 - v0),
  );
  const [uc, vc] = [(u0 + u1) / 2, (v0 + v1) / 2];

  const drawn: Drawn[] = visible.map((f) => {
    const n = f.points.length;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const ds = f.points.map((p) => dot(p, VIEW));
    f.points.forEach((p, i) => {
      const [u, v] = project(p);
      xs[i] = width / 2 + (u - uc) * scale;
      ys[i] = height / 2 - (v - vc) * scale;
    });
    // The depth plane through the first three corners.
    const [ax, ay, bx, by] = [
      xs[1] - xs[0],
      ys[1] - ys[0],
      xs[2] - xs[0],
      ys[2] - ys[0],
    ];
    const [ad, bd] = [ds[1] - ds[0], ds[2] - ds[0]];
    const det = ax * by - bx * ay;
    const da = (ad * by - bd * ay) / det;
    const db = (ax * bd - bx * ad) / det;
    return {
      xs,
      ys,
      top: Math.min(...ys),
      bottom: Math.max(...ys),
      da,
      db,
      dc: ds[0] - da * xs[0] - db * ys[0],
      color: lighten(colors[f.ink], dot(f.normal, LIGHT) * COLOR_DIFFERENCE),
    };
  });
  drawn.sort((a, b) => a.top - b.top);

  const image = ctx.createImageData(width, height);
  const data = image.data;
  const bg = rgb(paper);
  // Per pixel and channel: partial-pixel coverage, and a running sum for whole pixels.
  const cover = new Float64Array(3 * (width + 1));
  const run = new Float64Array(3 * (width + 1));
  const share = 1 / ROWS;
  const add = (a: number, b: number, c: Rgb) => {
    const ia = Math.floor(a);
    const ib = Math.floor(b);
    if (ia === ib) {
      const w = (b - a) * share;
      for (let k = 0; k < 3; k++) cover[3 * ia + k] += c[k] * w;
      return;
    }
    const wa = (ia + 1 - a) * share;
    const wb = (b - ib) * share;
    for (let k = 0; k < 3; k++) {
      cover[3 * ia + k] += c[k] * wa;
      run[3 * (ia + 1) + k] += c[k] * share;
      run[3 * ib + k] -= c[k] * share;
      cover[3 * ib + k] += c[k] * wb;
    }
  };

  // Spans on one sample row, and the row's span ends as events sorted by x: +i + 1 opens span i, -i - 1 closes it.
  const spanA = new Float64Array(drawn.length);
  const spanB = new Float64Array(drawn.length);
  const spanFace = new Int32Array(drawn.length);
  const eventX = new Float64Array(2 * drawn.length);
  const eventId = new Int32Array(2 * drawn.length);
  const open = new Int32Array(drawn.length);
  let active: number[] = [];
  let next = 0;

  for (let py = 0; py < height; py++) {
    for (let r = 0; r < ROWS; r++) {
      const sy = py + (r + 0.5) * share;
      while (next < drawn.length && drawn[next].top <= sy) active.push(next++);
      active = active.filter((f) => drawn[f].bottom > sy);
      // Each face is convex, so the row crosses it in one span.
      let spans = 0;
      for (const f of active) {
        const { xs, ys } = drawn[f];
        let a = Infinity;
        let b = -Infinity;
        for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
          if (ys[i] <= sy === ys[j] <= sy) continue;
          const x = xs[i] + ((sy - ys[i]) * (xs[j] - xs[i])) / (ys[j] - ys[i]);
          a = Math.min(a, x);
          b = Math.max(b, x);
        }
        a = Math.max(0, a);
        b = Math.min(width, b);
        if (b <= a) continue;
        spanA[spans] = a;
        spanB[spans] = b;
        spanFace[spans++] = f;
      }
      // Events by insertion sort, closes before opens at the same x.
      let events = 0;
      const push = (x: number, id: number) => {
        let k = events++;
        while (
          k > 0 &&
          (eventX[k - 1] > x || (eventX[k - 1] === x && eventId[k - 1] > id))
        ) {
          eventX[k] = eventX[k - 1];
          eventId[k] = eventId[k - 1];
          k--;
        }
        eventX[k] = x;
        eventId[k] = id;
      };
      for (let i = 0; i < spans; i++) {
        push(spanA[i], i + 1);
        push(spanB[i], -i - 1);
      }
      // Walks the row: paper where no span is open, else the nearest open face at each stretch's middle.
      let x = 0;
      let opened = 0;
      for (let e = 0; e <= events; e++) {
        const to = e < events ? eventX[e] : width;
        if (to > x) {
          let c = bg;
          if (opened > 0) {
            const mid = (x + to) / 2;
            let best = Infinity;
            for (let k = 0; k < opened; k++) {
              const f = drawn[spanFace[open[k]]];
              const depth = f.da * mid + f.db * sy + f.dc;
              if (depth < best) {
                best = depth;
                c = f.color;
              }
            }
          }
          add(x, to, c);
          x = to;
        }
        if (e === events) break;
        const id = eventId[e];
        if (id > 0) open[opened++] = id - 1;
        else {
          let k = 0;
          while (open[k] !== -id - 1) k++;
          open[k] = open[--opened];
        }
      }
    }
    const sum: Rgb = [0, 0, 0];
    for (let px = 0; px < width; px++) {
      const o = (py * width + px) * 4;
      for (let k = 0; k < 3; k++) {
        sum[k] += run[3 * px + k];
        data[o + k] = Math.round(sum[k] + cover[3 * px + k]);
        run[3 * px + k] = 0;
        cover[3 * px + k] = 0;
      }
      data[o + 3] = 255;
    }
    run.fill(0, 3 * width);
    cover.fill(0, 3 * width);
  }
  ctx.putImageData(image, 0, 0);
}

export const isometricBlocks1: Style = { id: "iso1", draw };
