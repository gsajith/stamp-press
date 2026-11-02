// Portrait bust, ported from DiceBear's Open Peeps style (https://github.com/dicebear/dicebear,
// packages/@dicebear/open-peeps). The code it follows is MIT licensed:
//
//   MIT License. Copyright (c) 2024 Florian Körner. Permission is hereby granted, free of charge, to any person
//   obtaining a copy of this software and associated documentation files (the "Software"), to deal in the
//   Software without restriction, including without limitation the rights to use, copy, modify, merge,
//   publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
//   Software is furnished to do so, subject to the following conditions: The above copyright notice and this
//   permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS
//   PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
//   WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
//   CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
//   DEALINGS IN THE SOFTWARE.
//
// The art is Pablo Stanley's Open Peeps (https://www.openpeeps.com), released under CC0 1.0. Its path data
// lives in openPeepsParts.ts.
//
// A hand-drawn head-and-shoulders bust, as DiceBear assembles it: a shared bust, then a head (hair or hat), a
// face, sometimes facial hair and sometimes glasses or an eyepatch, each at DiceBear's offset and with its
// odds. Masks are left out. The parts' flat fills map to palette colors, with the darkest ink as the line. The
// bust sits like a definitive stamp's portrait: on a flat field, or in an oval window cut through a surround.
//
// Like land1, it computes every pixel itself, so its pixels match in every browser and in Node (ADR 0001). It
// flattens the SVG paths into polygons, then fills each with its own scanline rasterizer: exact coverage across
// each sample row, several rows per pixel. Only IEEE-exact arithmetic here; arcs use exact.ts.

import { atan2, cos, sin } from "../exact";
import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";
import {
  ACCESSORIES,
  BODY,
  FACES,
  FACIAL_HAIR,
  type Fill,
  HEADS,
  type Part,
  type PartPath,
} from "./openPeepsParts";

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
const WHITE: Rgb = [255, 255, 255];

// SVG path data to closed polygons, as flat [x0, y0, x1, y1, ...] lists in the path's own units. Curves and arcs
// become chords that stray at most about `tol` from them. Handles every command the parts use: M L H V C S A Z,
// absolute and relative.
export function polygons(d: string, tol: number): number[][] {
  const out: number[][] = [];
  let poly: number[] = [];
  let i = 0;
  const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
  const skip = () => {
    while (i < d.length && (d[i] === " " || d[i] === "," || d[i] === "\n")) i++;
  };
  const num = () => {
    skip();
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(d)!;
    i = NUMBER.lastIndex;
    return parseFloat(m[0]);
  };
  // Arc flags are single digits, which minified paths run together: "0 01-2 2".
  const flag = () => {
    skip();
    return d[i++] === "1";
  };
  let [x, y, sx, sy] = [0, 0, 0, 0];
  // The last cubic's second control point, for S.
  let [qx, qy] = [0, 0];
  let cmd = "";
  let last = "";
  const close = () => {
    if (poly.length >= 6) out.push(poly);
    poly = [];
  };
  const lineTo = (nx: number, ny: number) => {
    poly.push(nx, ny);
    [x, y] = [nx, ny];
  };
  const cubic = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
  ) => {
    // The control polygon's bend bounds the chord error: about 3/4 of it over n squared.
    const dd = Math.max(
      Math.abs(x - 2 * x1 + x2) + Math.abs(y - 2 * y1 + y2),
      Math.abs(x1 - 2 * x2 + x3) + Math.abs(y1 - 2 * y2 + y3),
    );
    const n = Math.min(64, Math.floor(Math.sqrt((0.75 * dd) / tol)) + 1);
    const [x0, y0] = [x, y];
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      const [a, b, c, e] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      poly.push(
        a * x0 + b * x1 + c * x2 + e * x3,
        a * y0 + b * y1 + c * y2 + e * y3,
      );
    }
    [x, y, qx, qy] = [x3, y3, x2, y2];
  };
  // An elliptical arc, from endpoint to center form as in SVG's implementation notes (F.6.5).
  const arc = (
    rx: number,
    ry: number,
    angle: number,
    large: boolean,
    sweep: boolean,
    x2: number,
    y2: number,
  ) => {
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (rx === 0 || ry === 0) return lineTo(x2, y2);
    const phi = (angle * Math.PI) / 180;
    const [cp, sp] = [cos(phi), sin(phi)];
    const [dx, dy] = [(x - x2) / 2, (y - y2) / 2];
    const x1p = cp * dx + sp * dy;
    const y1p = -sp * dx + cp * dy;
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
      const s = Math.sqrt(lambda);
      [rx, ry] = [rx * s, ry * s];
    }
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const num = rx * rx * ry * ry - den;
    const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
    const cxp = (co * rx * y1p) / ry;
    const cyp = (-co * ry * x1p) / rx;
    const cx = cp * cxp - sp * cyp + (x + x2) / 2;
    const cy = sp * cxp + cp * cyp + (y + y2) / 2;
    const t1 = atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
    let dt = atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx) - t1;
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    // A chord over angle a strays r a^2 / 8 from the arc.
    const r = Math.max(rx, ry);
    const n = Math.min(
      256,
      Math.floor(Math.abs(dt) * Math.sqrt(r / (8 * tol))) + 1,
    );
    for (let k = 1; k < n; k++) {
      const t = t1 + (dt * k) / n;
      const [ct, st] = [cos(t), sin(t)];
      poly.push(
        cx + rx * ct * cp - ry * st * sp,
        cy + rx * ct * sp + ry * st * cp,
      );
    }
    lineTo(x2, y2);
  };
  for (;;) {
    skip();
    if (i >= d.length) break;
    // Repeated arguments repeat the command, except that M's repeats are L.
    if (/[A-Za-z]/.test(d[i])) cmd = d[i++];
    else if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
    const rel = cmd === cmd.toLowerCase();
    const [ox, oy] = rel ? [x, y] : [0, 0];
    switch (cmd.toUpperCase()) {
      case "M": {
        close();
        const [nx, ny] = [ox + num(), oy + num()];
        [sx, sy] = [nx, ny];
        lineTo(nx, ny);
        break;
      }
      case "L": {
        const nx = ox + num();
        lineTo(nx, oy + num());
        break;
      }
      case "H":
        lineTo(ox + num(), y);
        break;
      case "V":
        lineTo(x, oy + num());
        break;
      case "C": {
        const [x1, y1, x2, y2] = [
          ox + num(),
          oy + num(),
          ox + num(),
          oy + num(),
        ];
        cubic(x1, y1, x2, y2, ox + num(), oy + num());
        break;
      }
      case "S": {
        // The first control point mirrors the last cubic's second, or sits on the pen after anything else.
        const prev = "CcSs".includes(last);
        const [x1, y1] = prev ? [2 * x - qx, 2 * y - qy] : [x, y];
        const [x2, y2] = [ox + num(), oy + num()];
        cubic(x1, y1, x2, y2, ox + num(), oy + num());
        break;
      }
      case "A": {
        const [rx, ry, angle] = [num(), num(), num()];
        const [large, sweep] = [flag(), flag()];
        arc(rx, ry, angle, large, sweep, ox + num(), oy + num());
        break;
      }
      case "Z":
        close();
        [x, y] = [sx, sy];
        // A path that goes on after Z starts its next polygon at the start point.
        poly.push(x, y);
        break;
      default:
        throw new Error(`peep1: unsupported path command ${cmd}`);
    }
    last = cmd;
  }
  close();
  return out;
}

// One filled shape: its edges in pixels, each [top y, bottom y, x at top, dx per dy, winding], sorted by top.
type Shape = { edges: Float64Array; count: number; evenOdd: boolean };

// Builds a shape from polygons in path units, mapped to pixels by x * a + b, y * |a| + c.
function shape(
  polys: readonly number[][],
  evenOdd: boolean,
  a: number,
  b: number,
  c: number,
): Shape {
  const list: number[][] = [];
  for (const p of polys) {
    const n = p.length / 2;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const [x0, y0] = [p[2 * k] * a + b, p[2 * k + 1] * Math.abs(a) + c];
      const [x1, y1] = [p[2 * j] * a + b, p[2 * j + 1] * Math.abs(a) + c];
      if (y0 === y1) continue;
      const [top, bottom, dir] = y0 < y1 ? [y0, y1, 1] : [y1, y0, -1];
      const xt = y0 < y1 ? x0 : x1;
      list.push([top, bottom, xt, (x1 - x0) / (y1 - y0), dir]);
    }
  }
  list.sort((p, q) => p[0] - q[0] || p[2] - q[2]);
  const edges = new Float64Array(list.length * 5);
  list.forEach((e, k) => edges.set(e, k * 5));
  return { edges, count: list.length, evenOdd };
}

// Scratch buffers for fill, grown as needed.
let cover = new Float64Array(0);
let run = new Float64Array(0);
let active = new Int32Array(0);
let crossX = new Float64Array(0);
let crossW = new Int8Array(0);

// Paints `shape` in `color` over the RGBA `data`. Each pixel row takes `rows` sample lines. Along each, the
// coverage of every pixel is exact, so sloped edges stay smooth while flat ones step in 1 / rows.
function fill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  { edges, count, evenOdd }: Shape,
  color: Rgb,
  rows: number,
) {
  if (count === 0) return;
  if (cover.length < width + 2) {
    cover = new Float64Array(width + 2);
    run = new Float64Array(width + 2);
  }
  if (active.length < count) {
    active = new Int32Array(count);
    crossX = new Float64Array(count);
    crossW = new Int8Array(count);
  }
  let bottom = 0;
  for (let k = 0; k < count; k++) bottom = Math.max(bottom, edges[k * 5 + 1]);
  const y0 = Math.max(0, Math.floor(edges[0]));
  const y1 = Math.min(height, Math.floor(bottom) + 1);
  const share = 1 / rows;
  let next = 0;
  let live = 0;
  for (let py = y0; py < y1; py++) {
    let lo = width;
    let hi = -1;
    for (let r = 0; r < rows; r++) {
      const sy = py + (r + 0.5) * share;
      while (next < count && edges[next * 5] <= sy) active[live++] = next++;
      // Crossings on this sample line, sorted by x as they're found.
      let n = 0;
      let keep = 0;
      for (let k = 0; k < live; k++) {
        const e = active[k] * 5;
        if (edges[e + 1] <= sy) continue;
        active[keep++] = active[k];
        const cx = edges[e + 2] + (sy - edges[e]) * edges[e + 3];
        let j = n++;
        while (j > 0 && crossX[j - 1] > cx) {
          crossX[j] = crossX[j - 1];
          crossW[j] = crossW[j - 1];
          j--;
        }
        crossX[j] = cx;
        crossW[j] = edges[e + 4];
      }
      live = keep;
      // Spans where the winding number says inside, added to cover (partial pixels) and run (whole ones).
      let wind = 0;
      for (let k = 0; k < n - 1; k++) {
        wind += crossW[k];
        if (evenOdd ? (wind & 1) === 0 : wind === 0) continue;
        const a = Math.max(0, crossX[k]);
        const b = Math.min(width, crossX[k + 1]);
        if (b <= a) continue;
        const ia = Math.floor(a);
        const ib = Math.floor(b);
        if (ia === ib) cover[ia] += (b - a) * share;
        else {
          cover[ia] += (ia + 1 - a) * share;
          run[ia + 1] += share;
          run[ib] -= share;
          cover[ib] += (b - ib) * share;
        }
        lo = Math.min(lo, ia);
        hi = Math.max(hi, ib);
      }
    }
    // Every span wrote between lo and hi, so clearing them leaves the buffers zeroed for the next row.
    let sum = 0;
    for (let px = lo; px <= hi; px++) {
      sum += run[px];
      const t = Math.min(1, sum + cover[px]);
      run[px] = 0;
      cover[px] = 0;
      if (t <= 0 || px >= width) continue;
      const p = (py * width + px) * 4;
      data[p] += (color[0] - data[p]) * t;
      data[p + 1] += (color[1] - data[p + 1]) * t;
      data[p + 2] += (color[2] - data[p + 2]) * t;
    }
  }
}

// An ellipse as one polygon, from four cubic quarters.
function ellipse(cx: number, cy: number, rx: number, ry: number): number[] {
  const k = 0.5522847498;
  return polygons(
    `M${cx + rx} ${cy}` +
      `C${cx + rx} ${cy + k * ry} ${cx + k * rx} ${cy + ry} ${cx} ${cy + ry}` +
      `C${cx - k * rx} ${cy + ry} ${cx - rx} ${cy + k * ry} ${cx - rx} ${cy}` +
      `C${cx - rx} ${cy - k * ry} ${cx - k * rx} ${cy - ry} ${cx} ${cy - ry}` +
      `C${cx + k * rx} ${cy - ry} ${cx + rx} ${cy - k * ry} ${cx + rx} ${cy}Z`,
    0.1,
  )[0];
}

// Where DiceBear places each part in its 704 unit view box. The head's matrix also squeezes it 0.2% across,
// which is too small to see, so it's left out.
const AT = {
  head: [156, 62],
  face: [315, 248],
  beard: [279, 400],
  glasses: [203, 303],
} as const;

// The bust's middle, which a mirrored peep flips around, and the widest view of it worth showing.
const MIDDLE = 372;
const WIDEST = 860;
// Room above the hair, more in an oval, which narrows at the top. And the chest line, where the art ends.
const HEADROOM = 34;
const OVAL_HEADROOM = 80;
const CHEST = 770;

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  palette: Palette,
) {
  const rand = stream(seed, 0x0dea7e57);
  const pickOf = <T>(list: readonly T[]) =>
    list[Math.floor(rand() * list.length)];
  // Parts with DiceBear's default odds: facial hair 10%, glasses or an eyepatch 20%.
  const head = pickOf(HEADS);
  const face = pickOf(FACES);
  const beard = rand() < 0.1 ? pickOf(FACIAL_HAIR) : null;
  const glasses = rand() < 0.2 ? pickOf(ACCESSORIES) : null;
  const mirror = rand() < 0.5;
  const oval = rand() < 0.45;

  // Colors. The darkest ink draws the lines, as Open Peeps' black does. Skin is the paper or a tint of the
  // lightest ink; hair is mostly the line ink, as in the source, or another ink, grey or white.
  const paper = rgb(palette.paper);
  const inks = palette.inks.map(rgb);
  const n = inks.length;
  const line = inks[0];
  const light = inks[n - 1];
  const middle = n > 2 ? inks[1] : mix(line, light, 0.5);
  const skin = mix(paper, light, pickOf([0, 0, 0.14, 0.28, 0.42]));
  const hair = pickOf([
    line,
    line,
    line,
    middle,
    light,
    mix(paper, line, 0.3),
    mix(paper, WHITE, 0.6),
  ]);
  const clothIndex = 1 + Math.floor(rand() * (n - 1));
  const clothing = mix(paper, inks[clothIndex], pickOf([0.55, 0.8, 1]));
  // The field takes another ink than the clothes where there is one.
  const others = inks.slice(1).filter((_, k) => k + 1 !== clothIndex);
  const fieldInk = others.length ? pickOf(others) : inks[clothIndex];
  const field = mix(paper, fieldInk, pickOf([0, 0.16, 0.28]));
  const surround = mix(paper, pickOf(inks), pickOf([0.6, 1]));
  const colors: Record<Fill, Rgb> = {
    line,
    skin,
    hair,
    clothing,
    white: mix(paper, WHITE, 0.6),
    accent: mix(light, line, 0.3),
  };

  // The window the bust shows through: the whole art, or an oval inset in it. The bust scales to fill the
  // window's height from above the hair down to the chest, or its width out to WIDEST, whichever is larger.
  // Hair reaching above -40, like the long afro's, is cropped rather than shrinking the face.
  const short = Math.min(width, height);
  const inset = short * 0.07;
  const [wx, wy, ww, wh] = oval
    ? [inset, inset, width - 2 * inset, height - 2 * inset]
    : [0, 0, width, height];
  const headPolys = head[1].map(([, , d]) => polygons(d, 2));
  let top = Infinity;
  for (const ps of headPolys)
    for (const p of ps)
      for (let k = 1; k < p.length; k += 2) top = Math.min(top, p[k]);
  top = Math.max(-40, top + AT.head[1]) - (oval ? OVAL_HEADROOM : HEADROOM);
  const scale = Math.max(wh / (CHEST - top), ww / WIDEST);
  // Path units to pixels: x * a + b, y * |a| + c, with a negative a mirroring the bust about MIDDLE.
  const a = mirror ? -scale : scale;
  const b = wx + ww / 2 - MIDDLE * a;
  // When the width sets the scale, the window shows less than hair to chest: crop a third of the excess from
  // above the hair and the rest from the chest, so a tall afro doesn't push the face out the bottom.
  const excess = Math.max(0, CHEST - top - wh / scale);
  const c = wy - (top + excess / 3) * scale;
  // Flatten to a quarter pixel, but no finer than the parts were drawn.
  const tol = Math.max(0.1, 0.25 / scale);
  const rows = short < 128 ? 16 : short < 512 ? 6 : 4;

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let p = 0; p < data.length; p += 4) {
    data[p] = field[0];
    data[p + 1] = field[1];
    data[p + 2] = field[2];
    data[p + 3] = 255;
  }
  const paint = (paths: readonly PartPath[], dx: number, dy: number) => {
    for (const [role, evenOdd, d] of paths) {
      const polys = polygons(d, tol);
      fill(
        data,
        width,
        height,
        shape(polys, evenOdd === 1, a, b + dx * a, c + dy * scale),
        colors[role],
        rows,
      );
    }
  };
  const part = (p: Part | null, [dx, dy]: readonly [number, number]) =>
    p && paint(p[1], dx, dy);
  paint(BODY, 0, 0);
  part(head, AT.head);
  part(face, AT.face);
  part(beard, AT.beard);
  part(glasses, AT.glasses);

  if (oval) {
    // A solid surround with an oval cut through it, then an ink rule around the cut. The surround stops in the
    // middle of the rule, so the rule covers its edge and none of its color bleeds inside the oval.
    const [cx, cy, rx, ry] = [width / 2, height / 2, ww / 2, wh / 2];
    const rule = short * 0.012;
    const frame = [0, 0, width, 0, width, height, 0, height];
    const cut = ellipse(cx, cy, rx + rule / 2, ry + rule / 2);
    fill(
      data,
      width,
      height,
      shape([frame, cut], true, 1, 0, 0),
      surround,
      rows,
    );
    fill(
      data,
      width,
      height,
      shape(
        [ellipse(cx, cy, rx + rule, ry + rule), ellipse(cx, cy, rx, ry)],
        true,
        1,
        0,
        0,
      ),
      line,
      rows,
    );
  }
  ctx.putImageData(image, 0, 0);
}

export const openPeeps1: Style = {
  id: "peep1",
  draw,
};
