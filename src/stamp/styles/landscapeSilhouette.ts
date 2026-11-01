import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Landscape silhouette: layered noise ridges fading into a banded sky, with a sun disc. It computes every pixel
// itself, from positions as fractions of the art's width and height, rather than drawing canvas paths. That
// keeps it resolution independent and makes its pixels identical in every browser and in Node, which the
// golden test relies on (ADR 0001). Only IEEE-exact arithmetic here: no Math.sin, Math.pow or the like.

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

// Smooth 1D value noise in [0, 1], three octaves, from a table of seeded values.
function ridgeNoise(rand: () => number): (x: number) => number {
  const table = Array.from({ length: 64 }, rand);
  const at = (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const s = f * f * (3 - 2 * f);
    const a = table[i & 63];
    return a + (table[(i + 1) & 63] - a) * s;
  };
  return (x) => (at(x) * 4 + at(x * 2 + 17) * 2 + at(x * 4 + 31)) / 7;
}

type Ridge = {
  base: number;
  amp: number;
  freq: number;
  noise: (x: number) => number;
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
  const dark = rgb(inks[0]);
  const sunInk = rgb(inks[inks.length - 1]);
  const skyInk = rgb(inks.length > 2 ? inks[1] : inks[inks.length - 1]);
  const skyTop = mix(rgb(paper), skyInk, 0.3 + 0.25 * rand());
  const horizon = mix(rgb(paper), sunInk, 0.2 + 0.2 * rand());
  const bands = 4 + Math.floor(rand() * 4);

  const unit = Math.min(width, height);
  const sun = {
    x: (0.2 + 0.6 * rand()) * width,
    y: (0.2 + 0.2 * rand()) * height,
    r: (0.09 + 0.07 * rand()) * unit,
  };

  // Back to front: higher, taller and hazier at the back, lower and darker at the front.
  const layers = 3 + Math.floor(rand() * 3);
  const ridges: Ridge[] = Array.from({ length: layers }, (_, i) => {
    const t = i / (layers - 1);
    return {
      base: 0.5 + 0.3 * t + 0.04 * rand(),
      amp: 0.22 - 0.12 * t,
      freq: 3.5 - 1.5 * t + rand(),
      noise: ridgeNoise(rand),
      color: mix(dark, horizon, 0.75 * (1 - t)),
    };
  });

  const image = ctx.createImageData(width, height);
  const data = image.data;
  // Each ridge's top at each column, in pixels from the top, and its slope in pixels per pixel.
  const tops = ridges.map(({ base, amp, freq, noise }) =>
    Array.from(
      { length: width + 1 },
      (_, x) => (base - amp * noise((x / width) * freq)) * height,
    ),
  );

  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    const sky = mix(
      skyTop,
      horizon,
      Math.min(bands - 1, Math.floor(v * bands)) / (bands - 1),
    );
    for (let x = 0; x < width; x++) {
      const [cx, cy] = [x + 0.5, y + 0.5];
      const [dx, dy] = [cx - sun.x, cy - sun.y];
      const d = Math.sqrt(dx * dx + dy * dy);
      let color = mix(sky, sunInk, clamp01(sun.r - d + 0.5));
      for (let i = 0; i < layers; i++) {
        // Coverage from the distance to the ridge line, so edges stay smooth at any slope and size.
        const [a, b] = [tops[i][x], tops[i][x + 1]];
        const slope = b - a;
        const top = (a + b) / 2;
        const cover = clamp01((cy - top) / Math.sqrt(1 + slope * slope) + 0.5);
        if (cover > 0) color = mix(color, ridges[i].color, cover);
      }
      const p = (y * width + x) * 4;
      data[p] = Math.round(color[0]);
      data[p + 1] = Math.round(color[1]);
      data[p + 2] = Math.round(color[2]);
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export const landscapeSilhouette1: Style = {
  id: "landscape-silhouette-1",
  draw,
};
