import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Reaction diffusion: P. M. Neila's Gray-Scott solver, the coral, maze and leopard-spot patterns two chemicals
// make as they diffuse and react, printed as a stencil in two or three flat inks. Ported from the `grayscott`
// experiment in jsexp (github.com/pmneila/jsexp), under its license:
//
//   Copyright (c) 2012-2015, P. M. Neila
//   All rights reserved.
//
//   Redistribution and use in source and binary forms, with or without
//   modification, are permitted provided that the following conditions are met:
//
//   * Redistributions of source code must retain the above copyright notice, this
//     list of conditions and the following disclaimer.
//
//   * Redistributions in binary form must reproduce the above copyright notice,
//     this list of conditions and the following disclaimer in the documentation
//     and/or other materials provided with the distribution.
//
//   * Neither the name of the copyright holder nor the names of its
//     contributors may be used to endorse or promote products derived from
//     this software without specific prior written permission.
//
//   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
//   AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
//   IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
//   DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
//   FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
//   DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
//   SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
//   CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
//   OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
//   OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
//
// The original runs its update rule in a fragment shader on a wrapping float texture, eight Euler steps a frame
// for as long as the page is open, and colors the second chemical through a five-stop gradient. Here the same
// rule runs on the CPU for a capped number of steps, on a wrapping grid fixed in art units, so the picture is
// the same at any size. Each pixel interpolates the grid with Catmull-Rom splines and takes the ink of the
// band its value falls in, blending across a band edge by its distance to it, as contour1 does. Only + - * /
// touch the field, so the pixels match in every browser and Node (ADR 0001).

type Rgb = [number, number, number];

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

// The grid: SHORT cells across the art's short side, LONG along its long side, wrapping at both. A portrait
// punch is 0.78 wide, so LONG covers it. Wider margins show a few cells more, which wrap around seamlessly.
const SHORT = 44;
const LONG = 56;
// Steps and their length. The original takes steps of at most 0.8 and never stops. A desk draw affords about
// 450 steps of this grid, so each step is 1.4 long, as long as the scaled diffusion below stays stable, to
// reach about 630 time units: enough for the patterns to settle.
const STEPS = 450;
const DT = 1.4;
// The original's diffusion rates, per texel of its half-resolution texture.
const DU = 0.2097;
const DV = 0.105;

// Drops seeded on the grid: enough that the patterns grow from them and meet within our steps.
const DROPS = 25;
// The original's presets that settle within our steps, as [feed, kill]. Its others (solitons, worms, chaos,
// waves and the U-Skate world) die out at this step length, or spread too slowly or never settle.
const PRESETS = [
  [0.037, 0.06], // Default: fingerprint stripes
  [0.029, 0.057], // Mazes
  [0.039, 0.058], // Holes: leopard spots in a solid field
  [0.034, 0.056], // Chaos and holes (by clem)
];

// Runs Gray-Scott from a field of drops and returns the second chemical on the SHORT x LONG grid.
function simulate(rand: () => number): Float32Array {
  const [feed, kill] = PRESETS[Math.floor(rand() * PRESETS.length)];
  // Scales the original's diffusion rates, which sets the pattern's size: stripes and spots are about a third
  // wider at the high end than at the low. Above about 0.75, the 1.4 step turns unstable and the field dies.
  const scale = 0.35 + 0.3 * rand();
  const [W, H] = [SHORT, LONG];
  const n = W * H;
  let u = new Float32Array(n).fill(1);
  let v = new Float32Array(n);
  let u2 = new Float32Array(n);
  let v2 = new Float32Array(n);
  // The original seeds a drop of the second chemical wherever the visitor clicks: radius sqrt(5) texels, v = 0.9.
  // A bare drop overshoots at our step length and dies, so ours also halves the first chemical inside it.
  for (let d = 0; d < DROPS; d++) {
    const [cx, cy] = [Math.floor(rand() * W), Math.floor(rand() * H)];
    for (let y = -2; y <= 2; y++)
      for (let x = -2; x <= 2; x++)
        if (x * x + y * y < 5) {
          const k = ((cy + y + H) % H) * W + ((cx + x + W) % W);
          [u[k], v[k]] = [0.5, 1];
        }
  }

  // The original's rule, u' = u + dt (Du lap u - u v^2 + feed (1 - u)) and v' = v + dt (Dv lap v + u v^2 -
  // (feed + kill) v), with its constants folded, since this loop is the whole draw's cost.
  const du = DT * DU * scale;
  const dv = DT * DV * scale;
  const uKeep = 1 - DT * feed;
  const uFeed = DT * feed;
  const vKeep = 1 - DT * (feed + kill);
  const left = new Int32Array(W);
  const right = new Int32Array(W);
  for (let i = 0; i < W; i++) {
    left[i] = (i + W - 1) % W;
    right[i] = (i + 1) % W;
  }
  for (let s = 0; s < STEPS; s++) {
    for (let j = 0; j < H; j++) {
      const row = j * W;
      const up = ((j + H - 1) % H) * W;
      const down = ((j + 1) % H) * W;
      for (let i = 0; i < W; i++) {
        const k = row + i;
        const l = row + left[i];
        const r = row + right[i];
        const uc = u[k];
        const vc = v[k];
        const uvv = DT * uc * vc * vc;
        u2[k] =
          uc * uKeep +
          uFeed +
          du * (u[l] + u[r] + u[up + i] + u[down + i] - 4 * uc) -
          uvv;
        v2[k] =
          vc * vKeep +
          dv * (v[l] + v[r] + v[up + i] + v[down + i] - 4 * vc) +
          uvv;
      }
    }
    const [uNext, vNext] = [u2, v2];
    u2 = u;
    v2 = v;
    u = uNext;
    v = vNext;
  }
  return v;
}

// Catmull-Rom weights at fraction t between nodes 1 and 2 of four, and their derivatives.
function spline(t: number, w: Float64Array, d: Float64Array, at: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  w[at] = (-t3 + 2 * t2 - t) / 2;
  w[at + 1] = (3 * t3 - 5 * t2 + 2) / 2;
  w[at + 2] = (-3 * t3 + 4 * t2 + t) / 2;
  w[at + 3] = (t3 - t2) / 2;
  d[at] = (-3 * t2 + 4 * t - 1) / 2;
  d[at + 1] = (9 * t2 - 10 * t) / 2;
  d[at + 2] = (-9 * t2 + 8 * t + 1) / 2;
  d[at + 3] = (3 * t2 - 2 * t) / 2;
}

// For each of `pixels` along an axis with `nodes` wrapping grid nodes, centered: the four nodes it reads and
// their weights and derivative weights.
function axis(pixels: number, nodes: number, s: number) {
  const index = new Int32Array(pixels * 4);
  const w = new Float64Array(pixels * 4);
  const d = new Float64Array(pixels * 4);
  for (let p = 0; p < pixels; p++) {
    const g = (p + 0.5 - pixels / 2) * s + nodes / 2;
    const i = Math.floor(g);
    for (let k = 0; k < 4; k++)
      index[p * 4 + k] = (((i - 1 + k) % nodes) + nodes) % nodes;
    spline(g - i, w, d, p * 4);
  }
  return { index, w, d };
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const field = simulate(rand);

  // The original's gradient turns from its background color at v = 0.2 and reaches its brightest at 0.4 and
  // up. A settled pattern peaks below 0.4, so the second edge sits between 0.2 and the field's peak, as a
  // core line inside each stripe and a dot inside each spot.
  let peak = 0;
  for (let k = 0; k < field.length; k++) peak = Math.max(peak, field[k]);
  const steps = [0.2, 0.2 + (peak - 0.2) * (0.45 + 0.2 * rand())];
  // Ink on paper, or the pattern cut out of a solid ink, like the original's dark background. The core takes
  // another ink, or the edge's color for a two-color print.
  const [ink, other] = [
    inks[0],
    inks[1 + Math.floor(rand() * (inks.length - 1))],
  ];
  const invert = rand() < 0.4;
  const core = rand() < 0.65 ? other : invert ? paper : ink;
  const fill = (invert ? [ink, paper, core] : [paper, ink, core]).map(rgb);

  // The grid in the art's orientation: SHORT across the short side, LONG along the long side.
  const portrait = height >= width;
  const [gw, gh] = portrait ? [SHORT, LONG] : [LONG, SHORT];
  const grid = new Float64Array(gw * gh);
  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++)
      grid[j * gw + i] = portrait ? field[j * SHORT + i] : field[i * SHORT + j];

  // Grid cells per pixel, so the short side spans SHORT cells at any size.
  const s = SHORT / Math.min(width, height);
  const xs = axis(width, gw, s);
  const ys = axis(height, gh, s);
  // Each pixel row first blends the grid's rows into one row of values and one of y-slopes, so each pixel
  // then reads only four of each.
  const value = new Float64Array(gw);
  const slopeY = new Float64Array(gw);

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let py = 0; py < height; py++) {
    const q = py * 4;
    for (let i = 0; i < gw; i++) {
      let a = 0;
      let b = 0;
      for (let k = 0; k < 4; k++) {
        const g = grid[ys.index[q + k] * gw + i];
        a += ys.w[q + k] * g;
        b += ys.d[q + k] * g;
      }
      value[i] = a;
      slopeY[i] = b;
    }
    for (let px = 0; px < width; px++) {
      const p = px * 4;
      let h = 0;
      let gx = 0;
      let gy = 0;
      for (let k = 0; k < 4; k++) {
        const i = xs.index[p + k];
        h += xs.w[p + k] * value[i];
        gx += xs.d[p + k] * value[i];
        gy += xs.w[p + k] * slopeY[i];
      }
      // The value's slope per pixel, so a value difference over it is a distance in pixels.
      const slope = Math.sqrt(gx * gx + gy * gy) * s;

      let band = 0;
      while (band < steps.length && h > steps[band]) band++;
      // Within half a pixel of an edge, the pixel takes the neighbor band's color in proportion to its area
      // past the edge, as a straight edge through the pixel would cover it.
      let below = 0;
      let above = 0;
      if (slope > 0) {
        if (band > 0) below = Math.max(0, 0.5 - (h - steps[band - 1]) / slope);
        if (band < steps.length)
          above = Math.max(0, 0.5 - (steps[band] - h) / slope);
      }
      const own = 1 - below - above;
      const c = fill[band];
      const lo = fill[band > 0 ? band - 1 : band];
      const hi = fill[band < steps.length ? band + 1 : band];
      const o = (py * width + px) * 4;
      data[o] = Math.round(c[0] * own + lo[0] * below + hi[0] * above);
      data[o + 1] = Math.round(c[1] * own + lo[1] * below + hi[1] * above);
      data[o + 2] = Math.round(c[2] * own + lo[2] * below + hi[2] * above);
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export const reactionDiffusion1: Style = { id: "rd1", draw };
