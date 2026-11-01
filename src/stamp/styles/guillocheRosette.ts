import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Guilloche rosette: the engraved security pattern of banknotes. A medallion of rings, each woven from phase
// shifted copies of one wavy circle, sits on a field of crossing waves. Like land1 it computes every pixel
// itself, so its pixels match in every browser and in Node, which the golden test relies on (ADR 0001). Only
// IEEE-exact arithmetic here: no Math.sin, Math.atan2 or the like. Sizes are fractions of the art's short side.

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

const TAU = 6.283185307179586;

// Sine from a Taylor polynomial, which is the same in every engine, unlike Math.sin. Error under 1e-11.
function sin(x: number): number {
  let y = x - TAU * Math.round(x / TAU);
  if (y > TAU / 4) y = TAU / 2 - y;
  else if (y < -TAU / 4) y = -TAU / 2 - y;
  const y2 = y * y;
  let sum = 0;
  for (let k = 15; k > 1; k -= 2) sum = (sum - 1) * (y2 / (k * (k - 1)));
  return y * (sum + 1);
}
const cos = (x: number) => sin(x + TAU / 4);

// The share of a square cell, 1 wide, that a line `half` wide covers when the cell's center sits `d` from its
// middle. Exact for straight lines, so a line keeps its weight at any size, even thinner than a pixel.
const cover = (d: number, half: number) =>
  clamp01(Math.min(d + 0.5, half) - Math.max(d - 0.5, -half));

// A ring of `count` curves r = radius + amp * sin(lobes * angle + phase), with the phases spread evenly round
// the circle, so the curves cross into a lattice. Radii in pixels from the medallion's center.
type Ring = {
  radius: number;
  amp: number;
  lobes: number;
  // cos and sin of each curve's phase.
  phases: [number, number][];
  color: Rgb;
};

function ring(
  radius: number,
  amp: number,
  lobes: number,
  count: number,
  offset: number,
  color: Rgb,
): Ring {
  const phases = Array.from({ length: count }, (_, j): [number, number] => {
    const a = offset + (TAU * j) / count;
    return [cos(a), sin(a)];
  });
  return { radius, amp, lobes, phases, color };
}

// Pick an integer in [lo, hi].
const int = (rand: () => number, lo: number, hi: number) =>
  lo + Math.floor(rand() * (hi - lo + 1));

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const unit = Math.min(width, height);
  const ink = inks.map(rgb);
  const base = rgb(paper);
  const last = ink[ink.length - 1];
  // The outer ring and keyline take the darkest ink. The inner rings share the rest, in either order; with two
  // inks the core sometimes takes the darkest one too.
  const [midInk, coreInk] =
    rand() < 0.5 ? [ink[1], last] : [last, ink[1 % (ink.length - 1)]];
  const half = (0.0017 + 0.0007 * rand()) * unit;

  // Outside in. Outer rings have small amplitude and many lobes, the core is a deep-lobed flower.
  const outer = (0.37 + 0.03 * rand()) * unit;
  const outerAmp = (0.03 + 0.02 * rand()) * unit;
  const mid = (0.22 + 0.04 * rand()) * unit;
  const midAmp = (0.045 + 0.035 * rand()) * unit;
  const core = (0.1 + 0.03 * rand()) * unit;
  const coreAmp = (0.45 + 0.3 * rand()) * core;
  const rings: Ring[] = [
    ring(
      outer,
      outerAmp,
      int(rand, 14, 26),
      int(rand, 8, 14),
      TAU * rand(),
      ink[0],
    ),
    ring(
      mid,
      midAmp,
      int(rand, 7, 14),
      int(rand, 12, 22),
      TAU * rand(),
      midInk,
    ),
    ring(
      core,
      coreAmp,
      int(rand, 5, 9),
      int(rand, 10, 18),
      TAU * rand(),
      coreInk,
    ),
  ];
  // A plain keyline round the medallion: a ring with no wave.
  const rim = outer + outerAmp + (0.02 + 0.015 * rand()) * unit;
  rings.push(ring(rim, 0, 1, 1, 0, ink[0]));
  const maxLobes = Math.max(...rings.map((r) => r.lobes));

  // The field: horizontal waves crossing their mirror image, in a pale tint, left blank inside the medallion.
  const spacing = (0.028 + 0.016 * rand()) * unit;
  const waveAmp = spacing * (0.5 + 0.6 * rand());
  const freq = TAU / ((0.12 + 0.1 * rand()) * unit);
  const fieldInk = mix(base, ink[ink.length > 2 ? 1 : 0], 0.35 + 0.15 * rand());
  const clear = rim + (0.025 + 0.02 * rand()) * unit;
  // Fine lines at a small size need more than one sample per pixel to keep their weight and shape, so each
  // pixel averages an n by n grid of samples, enough that a sample spans at most 1/400 of the short side.
  const n = Math.max(1, Math.ceil(400 / unit));
  const step = 1 / n;
  // The share of a sample a line covers, `d` pixels from the sample's center.
  const line = (d: number, half: number) => cover(d / step, half / step);

  // Each wave's offset and slope at each sample column.
  const waves = Array.from({ length: width * n }, (_, i) => {
    const t = freq * ((i + 0.5) * step - width / 2);
    const slope = waveAmp * freq * cos(t);
    return { offset: waveAmp * sin(t), stretch: Math.sqrt(1 + slope * slope) };
  });

  const powers: [number, number][] = Array.from(
    { length: maxLobes + 1 },
    () => [1, 0],
  );
  // The color at one sample, `column` being its sample column.
  function sample(cx: number, cy: number, column: number): Rgb {
    const r = Math.sqrt(cx * cx + cy * cy);
    if (r > clear) {
      const { offset, stretch } = waves[column];
      let blank = 1;
      for (const f of [cy - offset, cy + offset]) {
        const d = (f - spacing * Math.round(f / spacing)) / stretch;
        blank *= 1 - line(d, half * 0.8);
      }
      return mix(base, fieldInk, 1 - blank);
    }
    let color = base;
    if (r < 1e-9) return color;
    // cos and sin of k times the angle, for every lobe count, by repeated complex multiplication.
    const [c1, s1] = [cx / r, cy / r];
    for (let k = 1; k <= maxLobes; k++) {
      const [c, s] = powers[k - 1];
      powers[k] = [c * c1 - s * s1, c * s1 + s * c1];
    }
    for (const { radius, amp, lobes, phases, color: lineInk } of rings) {
      if (Math.abs(r - radius) > amp + half + 1) continue;
      const [cn, sn] = powers[lobes];
      let blank = 1;
      for (const [cp, sp] of phases) {
        // Distance to the curve: the radial gap, shrunk by how steeply the curve runs across the radius.
        const wave = sn * cp + cn * sp;
        const steep = (lobes * amp * (cn * cp - sn * sp)) / r;
        const d = (r - radius - amp * wave) / Math.sqrt(1 + steep * steep);
        blank *= 1 - line(d, half);
      }
      color = mix(color, lineInk, 1 - blank);
    }
    return color;
  }

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sum: Rgb = [0, 0, 0];
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const c = sample(
            x + (i + 0.5) * step - width / 2,
            y + (j + 0.5) * step - height / 2,
            x * n + i,
          );
          sum[0] += c[0];
          sum[1] += c[1];
          sum[2] += c[2];
        }
      const p = (y * width + x) * 4;
      data[p] = Math.round(sum[0] / (n * n));
      data[p + 1] = Math.round(sum[1] / (n * n));
      data[p + 2] = Math.round(sum[2] / (n * n));
      data[p + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
}

export const guillocheRosette1: Style = {
  id: "rosette1",
  draw,
};
