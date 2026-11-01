import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Riso overprint: two or three large flat shapes, one ink each, printed one ink at a time on top of each other.
// Inks multiply where they overlap, each ink's drum sits slightly off register, and ink density has a fine
// grain. Like land1 it computes every pixel itself from positions in art units, so it is resolution
// independent and draws identical pixels in every browser and in Node (ADR 0001). Only IEEE-exact arithmetic
// here: Math.sqrt is fine, Math.sin, Math.pow and the like are not.

type Rgb = [number, number, number];

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// A random unit vector, from a random point in the square normalized, so no trig is needed.
function direction(rand: () => number): [number, number] {
  const [x, y] = [rand() - 0.5, rand() - 0.5];
  const length = Math.sqrt(x * x + y * y) || 1;
  return [x / length, y / length];
}

// Rotates a vector a third of a turn, for the triangle's corners.
const SIN_120 = Math.sqrt(3) / 2;
const turn = ([x, y]: [number, number]): [number, number] => [
  -0.5 * x - SIN_120 * y,
  SIN_120 * x - 0.5 * y,
];

// A shape's signed distance in art units: positive inside, negative outside. `x` and `y` are relative to its
// center.
type Shape = (x: number, y: number) => number;

function randomShape(rand: () => number): Shape {
  const kind = Math.floor(rand() * 3);
  if (kind === 0) {
    const r = 0.28 + 0.14 * rand();
    return (x, y) => r - Math.sqrt(x * x + y * y);
  }
  const [ux, uy] = direction(rand);
  if (kind === 1) {
    // A bar: a long rectangle at any angle.
    const [hw, hh] = [0.38 + 0.22 * rand(), 0.13 + 0.12 * rand()];
    return (x, y) => {
      const a = x * ux + y * uy;
      const b = y * ux - x * uy;
      return Math.min(hw - Math.abs(a), hh - Math.abs(b));
    };
  }
  // An equilateral triangle: inside all three edges, each `apothem` from the center.
  const apothem = 0.17 + 0.09 * rand();
  const [bx, by] = turn([ux, uy]);
  const [cx, cy] = turn([bx, by]);
  return (x, y) =>
    apothem - Math.max(x * ux + y * uy, x * bx + y * by, x * cx + y * cy);
}

// One ink's pass through the press: its color, density, misregistration offset and grain, and the shapes it
// prints. A palette ink prints once, so shapes that share an ink are one layer and don't overprint each other.
type Layer = {
  ink: Rgb;
  density: number;
  dx: number;
  dy: number;
  salt: number;
  shapes: { x: number; y: number; shape: Shape }[];
};

// Grain cells per art unit, and how far the grain moves ink density either way. Density tops out at 0.88, so
// the grain never pushes it past 1 and its average stays the flat ink's.
const GRAIN = 420;
const GRAIN_AMOUNT = 0.13;

// Integer lattice hash to [0, 1).
function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ salt;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// Smooth value noise in [-1, 1] over the grain lattice, at a position in grain cells.
function grain(u: number, v: number, salt: number): number {
  const [i, j] = [Math.floor(u), Math.floor(v)];
  const [fu, fv] = [u - i, v - j];
  const [su, sv] = [fu * fu * (3 - 2 * fu), fv * fv * (3 - 2 * fv)];
  const top = hash(i, j, salt) + (hash(i + 1, j, salt) - hash(i, j, salt)) * su;
  const bottom =
    hash(i, j + 1, salt) +
    (hash(i + 1, j + 1, salt) - hash(i, j + 1, salt)) * su;
  return (top + (bottom - top) * sv) * 2 - 1;
}

// Most palettes lead with a near-black ink, which buries everything it overprints. Riso inks are bright, so
// draw() leaves the darkest ink out when two or more others remain. Ochre has only one other, so it's out.
const ACCEPTED = [
  "harbor",
  "desert",
  "pine",
  "dusk",
  "riso",
  "lagoon",
  "brick",
];

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const pool = (inks.length > 2 ? inks.slice(1) : inks).map(rgb);
  const first = Math.floor(rand() * pool.length);
  const count = 2 + Math.floor(rand() * 2);

  // Positions and sizes are in art units: fractions of the art's short side, centered on the art.
  const unit = Math.min(width, height);
  const [halfW, halfH] = [width / unit / 2, height / unit / 2];
  // One layer per ink, each off register by 0.5 to 1.3 percent of the art's short side: 1 to 3 px at desk size.
  const layers: Layer[] = pool.map((ink) => {
    const [ox, oy] = direction(rand);
    const offset = 0.005 + 0.008 * rand();
    return {
      ink,
      density: 0.78 + 0.1 * rand(),
      dx: ox * offset,
      dy: oy * offset,
      salt: Math.floor(rand() * 2 ** 31),
      shapes: [],
    };
  });
  for (let i = 0; i < count; i++) {
    const shape = {
      x: (0.3 + 0.4 * rand()) * 2 * halfW - halfW,
      y: (0.3 + 0.4 * rand()) * 2 * halfH - halfH,
      shape: randomShape(rand),
    };
    layers[(first + i) % pool.length].shapes.push(shape);
    // The first shape prints in a second ink too, so the misregistration shows as a fringe along its edges.
    if (i === 0) layers[(first + 1) % pool.length].shapes.push(shape);
  }
  const printed = layers.filter((layer) => layer.shapes.length > 0);

  // Grain finer than a pixel averages out to flat ink, so it fades in only as its cells grow past a pixel.
  const grainShows = clamp01(unit / GRAIN - 1);
  const base = rgb(paper);
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y++) {
    const py = (y + 0.5) / unit - halfH;
    for (let x = 0; x < width; x++) {
      const px = (x + 0.5) / unit - halfW;
      const color: Rgb = [base[0], base[1], base[2]];
      for (const layer of printed) {
        const [lx, ly] = [px - layer.dx, py - layer.dy];
        let cover = 0;
        for (const s of layer.shapes)
          cover = Math.max(cover, s.shape(lx - s.x, ly - s.y) * unit + 0.5);
        cover = clamp01(cover);
        if (cover === 0) continue;
        let density = layer.density;
        if (grainShows > 0)
          density *=
            1 +
            GRAIN_AMOUNT *
              grainShows *
              grain(lx * GRAIN, ly * GRAIN, layer.salt);
        // Multiply: the ink lets through its own color's share of what's under it.
        const t = cover * density;
        for (let c = 0; c < 3; c++)
          color[c] *= 1 - t + (t * layer.ink[c]) / 255;
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

export const risoOverprint1: Style = {
  id: "riso1",
  palettes: ACCEPTED,
  draw,
};
