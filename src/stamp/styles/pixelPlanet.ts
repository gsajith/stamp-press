import { cos, sin } from "../exact";
import type { Palette } from "../palettes";
import { pick, stream } from "../random";
import type { Style } from "../sources";

// Pixel planet: one dithered pixel-art planet on a starfield, ported from Deep-Fold's PixelPlanets
// (github.com/Deep-Fold/PixelPlanets). Each kind of planet stacks the same Godot shaders the original does,
// with the parameters from its scenes: a terran world (water, land, clouds), an ice world (ice, lakes,
// clouds), a lava world (rock, craters, lava rivers), a gas giant (two cloud decks), a ringed giant (banded
// gas and a ring), a cratered moon and an asteroid. The palette's inks stand in for the shader colors, the
// darkest ink is the night sky, and the stars are the generator's twinkle sprites.
//
// The shaders run once per cell of a coarse grid, 100 cells across the art's short side, as the original runs
// once per pixel of a 100 px planet. Every output pixel is the area-weighted mix of the cells it covers, so
// cells stay crisp blocks at 2048 px and average down cleanly at desk size, and the same seed draws the same
// picture at any size. The shaders hash their noise with fract(sin(x)), which differs between GPUs; seeded
// lattice tables stand in for it, and only IEEE-exact arithmetic runs, so pixels match in every browser and in
// Node (ADR 0001).
//
// PixelPlanets is under the MIT License:
//
// Copyright (c) 2020 Deep-Fold
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without
// limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
// Software, and to permit persons to whom the Software is furnished to do so, subject to the following
// conditions:
//
// The above copyright notice and this permission notice shall be included in all copies or substantial
// portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
// TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
// THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
// CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
// DEALINGS IN THE SOFTWARE.

type Rgb = readonly [number, number, number];
type Uv = [number, number];

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

// Cells across the art's short side, and down the long side of portrait and landscape art. The art's long side
// is at most about 1.4 times its short side, with the widest margin, so LONG covers it.
const GRID = 100;
const LONG = 142;

// The grid's columns and rows. They depend only on whether the art is square, portrait or landscape, not its
// exact size, so drawFace's rounding never moves a cell between the desk and the detail view. On the long side
// the art shows the middle of the grid.
export function gridSize(width: number, height: number): [number, number] {
  const long =
    Math.max(width, height) / Math.min(width, height) < 1.1 ? GRID : LONG;
  return width < height ? [GRID, long] : [long, GRID];
}

// ---- GLSL helpers ----

const fract = (x: number) => x - Math.floor(x);
const dist = (u: number, v: number, x: number, y: number) =>
  Math.sqrt((u - x) * (u - x) + (v - y) * (v - y));

// GLSL's smoothstep. Equal edges make it a step, where GLSL leaves the result undefined.
function smoothstep(e0: number, e1: number, x: number) {
  if (e0 === e1) return x < e0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Bends a flat disc's uv onto a ball, as the shaders' `spherify`.
function spherify(u: number, v: number): Uv {
  const x = u * 2 - 1;
  const y = v * 2 - 1;
  // Clamped: on the rim, rounding can dip below zero where the shader would get NaN.
  const z = Math.sqrt(Math.max(0, 1 - (x * x + y * y)));
  return [(x / (z + 1)) * 0.5 + 0.5, (y / (z + 1)) * 0.5 + 0.5];
}

// The shaders' `rotate`: turns uv by `angle` about the square's centre.
function turn(angle: number): (u: number, v: number) => Uv {
  const c = cos(angle);
  const s = sin(angle);
  return (u, v) => {
    const x = u - 0.5;
    const y = v - 0.5;
    return [x * c - y * s + 0.5, x * s + y * c + 0.5];
  };
}

// The shaders' `rand`: a value in [0, 1) on each integer lattice point, repeating every `px` by `py` points,
// as the shaders wrap their noise around the planet.
type Lattice = { table: Float64Array; px: number; py: number };
function lattice(rand: () => number, px: number, py: number): Lattice {
  return {
    table: Float64Array.from({ length: px * py }, () => rand()),
    px,
    py,
  };
}
// Wraps an integer into [0, n).
function wrap(i: number, n: number) {
  const r = i % n;
  return r < 0 ? r + n : r;
}
const at = ({ table, px, py }: Lattice, x: number, y: number) =>
  table[wrap(x, px) + wrap(y, py) * px];

// The shaders' value noise and its fractal sum.
function noise({ table, px, py }: Lattice, x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const x0 = wrap(ix, px);
  const x1 = x0 + 1 === px ? 0 : x0 + 1;
  const y0 = wrap(iy, py) * px;
  const y1 = y0 + px === px * py ? 0 : y0 + px;
  const a = table[x0 + y0];
  const b = table[x1 + y0];
  const c = table[x0 + y1];
  const d = table[x1 + y1];
  const cx = fx * fx * (3 - 2 * fx);
  const cy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * cx + (c - a) * cy * (1 - cx) + (d - b) * cx * cy;
}
function fbm(rand: Lattice, octaves: number, x: number, y: number) {
  let value = 0;
  let scale = 0.5;
  for (let i = 0; i < octaves; i++) {
    value += noise(rand, x, y) * scale;
    x *= 2;
    y *= 2;
    scale *= 0.5;
  }
  return value;
}

// Leukbaars' circle noise (shadertoy.com/view/4tK3zR): a circle of random size in each lattice cell. Clouds
// and gas use the soft profile, craters the hard rim.
function circleNoise(rand: Lattice, x: number, y: number, hard: boolean) {
  const row = Math.floor(y);
  x += row * 0.31;
  const h = at(rand, Math.floor(x), row);
  const dx = fract(x) - 0.25 - h * 0.5;
  const dy = y - row - 0.25 - h * 0.5;
  const m = Math.sqrt(dx * dx + dy * dy);
  const r = h * 0.25;
  return hard ? smoothstep(r - 0.1 * r, r, m) : smoothstep(0, r, m * 0.75);
}

// ---- The shaders ----

// One shader: the color it paints on the cell at (u, v) of its square, or null where it's clear. `dith` is the
// shader's checkerboard dither for that cell.
type Shader = (u: number, v: number, dith: boolean) => Rgb | null;

// What every shader of one planet shares: cells across its square, light position, tilt and a random stream
// for its noise and the offset the original animates with `time`.
type Setup = {
  pixels: number;
  light: Uv;
  rotation: number;
  rand: () => number;
};

// Three light bands with dithered edges, from PlanetUnder and NoAtmosphere.
function lightBands(
  colors: readonly Rgb[],
  d: number,
  border1: number,
  border2: number,
  edge: number,
  dith: boolean,
) {
  let col = colors[0];
  if (d > border1) col = d < border1 + edge && dith ? colors[0] : colors[1];
  if (d > border2) col = d < border2 + edge && dith ? colors[1] : colors[2];
  return col;
}

// PlanetUnder.gdshader: the ball under the land, its light bands roughened by noise.
function under(
  { pixels, light, rotation, rand }: Setup,
  colors: readonly Rgb[],
  size: number,
  octaves: number,
  border1: number,
  border2: number,
): Shader {
  const s = Math.round(size);
  const noiseAt = lattice(rand, 2 * s, s);
  const time = rand() * 2 * s;
  const rotate = turn(rotation);
  return (u, v, dith) => {
    if (dist(u, v, 0.5, 0.5) > 0.49999) return null;
    const [x, y] = rotate(...spherify(u, v));
    const d =
      dist(u, v, ...light) +
      fbm(noiseAt, octaves, x * size + time, y * size) * 0.3;
    return lightBands(colors, d, border1, border2, 2 / pixels, dith);
  };
}

// NoAtmosphere.gdshader: the same bands on a flat disc, the noise warped by itself.
function bareGround(
  { pixels, light, rotation, rand }: Setup,
  colors: readonly Rgb[],
  size: number,
  octaves: number,
  border1: number,
  border2: number,
): Shader {
  const s = Math.round(size);
  const noiseAt = lattice(rand, s, s);
  const time = rand() * s;
  const rotate = turn(rotation);
  return (u, v, dith) => {
    if (dist(u, v, 0.5, 0.5) > 0.49999) return null;
    const [x, y] = rotate(u, v);
    const warp = fbm(noiseAt, octaves, x, y);
    const d =
      dist(u, v, ...light) +
      fbm(noiseAt, octaves, x * size + warp + time, y * size + warp) * 0.3;
    return lightBands(colors, d, border1, border2, 2 / pixels, dith);
  };
}

// PlanetLandmass.gdshader: continents, shaded by sampling the noise again offset toward the light.
function landmass(
  { light, rotation, rand }: Setup,
  colors: readonly Rgb[],
  size: number,
  octaves: number,
  border1: number,
  border2: number,
  cutoff: number,
): Shader {
  const s = Math.round(size);
  const noiseAt = lattice(rand, 2 * s, s);
  const time = rand() * 2 * s;
  const rotate = turn(rotation);
  const [lx, ly] = light;
  return (u, v) => {
    if (dist(u, v, 0.5, 0.5) > 0.49999) return null;
    let d = dist(u, v, lx, ly);
    const [x, y] = spherify(...rotate(u, v));
    const bx = x * size + time;
    const by = y * size;
    const f1 = fbm(noiseAt, octaves, bx, by);
    if (f1 < cutoff) return null;
    let f2 = fbm(noiseAt, octaves, bx - lx * f1, by - ly * f1);
    let f3 = fbm(noiseAt, octaves, bx - lx * 1.5 * f1, by - ly * 1.5 * f1);
    let f4 = fbm(noiseAt, octaves, bx - lx * 2 * f1, by - ly * 2 * f1);
    if (d < border1) f4 *= 0.9;
    if (d > border1) {
      f2 *= 1.05;
      f3 *= 1.05;
      f4 *= 1.05;
    }
    if (d > border2) {
      f2 *= 1.3;
      f3 *= 1.4;
      f4 *= 1.8;
    }
    d = d * d * 0.1;
    let col = colors[3];
    if (f4 + d < f1) col = colors[2];
    if (f3 + d < f1) col = colors[1];
    if (f2 + d < f1) col = colors[0];
    return col;
  };
}

// Clouds.gdshader, which GasPlanet.gdshader repeats: circle-noise turbulence under a noise field, cut at
// `cover` and shaded by distance from the light.
function clouds(
  { light, rotation, rand }: Setup,
  colors: readonly Rgb[],
  noiseAt: Lattice,
  size: number,
  octaves: number,
  cover: number,
  stretch: number,
  curve: number,
  border1: number,
  border2: number,
): Shader {
  const time = rand() * Math.round(size);
  const rotate = turn(rotation);
  return (u, v) => {
    if (dist(u, v, 0.5, 0.5) > 0.49999) return null;
    const d = dist(u, v, ...light);
    const [x, y0] = spherify(...rotate(u, v));
    // Bends the clouds down to the right and up to the left.
    const y = (y0 + smoothstep(0, curve, Math.abs(x - 0.4))) * stretch;
    let turbulence = 0;
    for (let i = 0; i < 9; i++)
      turbulence += circleNoise(
        noiseAt,
        x * size * 0.3 + i + 11 + time,
        y * size * 0.3 + i + 11,
        false,
      );
    const c = fbm(
      noiseAt,
      octaves,
      x * size + turbulence + time,
      y * size + turbulence,
    );
    if (c < cover) return null;
    let col = colors[0];
    if (c < cover + 0.03) col = colors[1];
    if (d + c * 0.2 > border1) col = colors[2];
    if (d + c * 0.2 > border2) col = colors[3];
    return col;
  };
}

// The cloud shaders' noise: one lattice per deck, wrapping every `size` points both ways.
const cloudNoise = (rand: () => number, size: number) =>
  lattice(rand, Math.round(size), Math.round(size));

// IceWorld's lakes and LavaWorld's Rivers.gdshader: noise cut at `cutoff`, darkened away from the light. Lava
// warps its noise by a second, finer field into rivers; lakes don't.
function pools(
  { light, rotation, rand }: Setup,
  colors: readonly Rgb[],
  size: number,
  octaves: number,
  border1: number,
  border2: number,
  cutoff: number,
  rivers: boolean,
): Shader {
  const s = Math.round(size);
  const noiseAt = lattice(rand, 2 * s, s);
  const time = rand() * 2 * s;
  const rotate = turn(rotation);
  return (u, v) => {
    const [ru, rv] = rotate(u, v);
    if (dist(ru, rv, 0.5, 0.5) > (rivers ? 0.49999 : 0.5)) return null;
    const [x, y] = spherify(ru, rv);
    const f1 = fbm(noiseAt, octaves, x * size + time, y * size);
    const f = rivers ? fbm(noiseAt, octaves, x + f1 * 2.5, y + f1 * 2.5) : f1;
    if (f < cutoff) return null;
    let d = dist(u, v, ...light);
    d = d * d * 0.4;
    d -= d * f;
    let col = colors[0];
    if (d > border1) col = colors[1];
    if (d > border2) col = colors[2];
    return col;
  };
}

// The craters' value: 1 inside a crater's rim, from two layers of hard circle noise.
function crater(noiseAt: Lattice, x: number, y: number, time: number) {
  return (
    1 -
    circleNoise(noiseAt, x + 11 + time, y + 11, true) *
      circleNoise(noiseAt, x + 12 + time, y + 12, true)
  );
}

// Craters.gdshader: crater floors, their far rims shadowed by sampling again toward the light.
function craters(
  { light, rotation, rand }: Setup,
  colors: readonly Rgb[],
  size: number,
  border: number,
): Shader {
  const s = Math.round(size);
  const noiseAt = lattice(rand, s, s);
  const time = rand() * s;
  const rotate = turn(rotation);
  const [lx, ly] = light;
  return (u, v) => {
    if (dist(u, v, 0.5, 0.5) > 0.49999) return null;
    const d = dist(u, v, lx, ly);
    const [x, y] = spherify(...rotate(u, v));
    const c1 = crater(noiseAt, x * size, y * size, time);
    if (c1 < 0.5) return null;
    const c2 = crater(
      noiseAt,
      (x + (lx - 0.5) * 0.03) * size,
      (y + (ly - 0.5) * 0.03) * size,
      time,
    );
    return c2 < c1 - (0.5 - d) * 2 || d > border ? colors[1] : colors[0];
  };
}

// GasLayers.gdshader: bands from one-dimensional noise, stirred by turbulence and posterized into three light
// and three dark colors.
function gasBands(
  { light, rotation, rand }: Setup,
  colors: readonly Rgb[],
  dark: readonly Rgb[],
  size: number,
  octaves: number,
  bands: number,
): Shader {
  const s = Math.round(size);
  const noiseAt = lattice(rand, 2 * s, s);
  const time = rand() * 2 * s;
  const rotate = turn(rotation);
  return (u, v, dith) => {
    if (dist(u, v, 0.5, 0.5) > 0.49999) return null;
    const lightD = dist(u, v, ...light);
    const [x, y] = spherify(...rotate(u, v));
    const band = fbm(noiseAt, octaves, 0, y * size * bands);
    let turbulence = 0;
    for (let i = 0; i < 10; i++)
      turbulence += circleNoise(
        noiseAt,
        x * size * 0.3 + i + 11 + time,
        y * size * 0.3 + i + 11,
        false,
      );
    const f1 = fbm(noiseAt, octaves, x * size, y * size);
    let f2 = fbm(
      noiseAt,
      octaves,
      x * size + f1 - time + turbulence,
      y * 2 * size + f1 + turbulence,
    );
    f2 *= band * band * 7;
    const lit = f2 + lightD * 1.8;
    f2 += lightD - 0.3;
    f2 = smoothstep(-0.2, 4 - f2, lit);
    if (dith) f2 *= 1.1;
    const level = Math.floor(f2 * 4) / 2;
    return f2 < 0.625
      ? colors[Math.min(2, Math.trunc(level * 2))]
      : dark[Math.min(2, Math.trunc((level - 1) * 2))];
  };
}

// Ring.gdshader, on a square three planets wide: a flattened annulus of noise, hidden behind the planet in its
// upper half.
function ring(
  { light, rotation, rand }: Setup,
  colors: readonly Rgb[],
  dark: readonly Rgb[],
  size: number,
  octaves: number,
  width: number,
  perspective: number,
): Shader {
  const s = Math.round(size);
  const noiseAt = lattice(rand, 2 * s, s);
  const spin = turn(rand() * 2 * Math.PI);
  const rotate = turn(rotation);
  return (u, v) => {
    const lightD = dist(u, v, ...light);
    const [ru, rv] = rotate(u, v);
    const cx = ru;
    const cy = (rv - 0.5) * perspective;
    const centerD = dist(cx, cy, 0.5, 0);
    let r =
      smoothstep(0.5 - width * 2, 0.5 - width, centerD) *
      smoothstep(centerD - width, centerD, 0.4);
    // The planet is a third of the square: a sixth of it in radius.
    if (rv < 0.5 && dist(ru, rv, 0.5, 0.5) < 1 / 6) r = 0;
    // The noise below is under 1, so a ring this thin stays clear.
    if (r < 0.28) return null;
    const [nx, ny] = spin(cx, cy + 0.5);
    r *= fbm(noiseAt, octaves, nx * size, ny * size);
    if (r < 0.28) return null;
    const level = Math.min(2, Math.floor((r + lightD * lightD * 2) * 4) / 4);
    return level <= 1
      ? colors[Math.trunc(level * 2)]
      : dark[Math.trunc((level - 1) * 2)];
  };
}

// Asteroids.gdshader: a lumpy rock cut from noise by distance from the centre, rimmed light and dark by a
// second sample toward the light, and cratered.
function asteroid(
  { light, rotation, rand }: Setup,
  colors: readonly Rgb[],
  size: number,
  octaves: number,
): Shader {
  // The asteroid's noise doesn't wrap: a lattice wider than the rock never repeats on it.
  const noiseAt = lattice(rand, 64, 64);
  const rotate = turn(rotation);
  const [lu, lv] = rotate(...light);
  const [lx, ly] = light;
  return (u, v, dith) => {
    const d = dist(u, v, 0.5, 0.5);
    const [x, y] = rotate(u, v);
    const n = fbm(noiseAt, octaves, x * size, y * size);
    if (n - d < 0.2) return null;
    const n2 = fbm(
      noiseAt,
      octaves,
      x * size + (lu - 0.5) * 0.5,
      y * size + (lv - 0.5) * 0.5,
    );
    const rel = (n2 - d >= 0.2 ? 1 : 0) + n2 - (1 + n);
    let col = colors[1];
    if (rel < -0.06 || (rel < -0.04 && dith)) col = colors[0];
    if (rel > 0.05 || (rel > 0.03 && dith)) col = colors[2];
    const c1 = crater(noiseAt, x * size, y * size, 0);
    const c2 = crater(
      noiseAt,
      (x + (lx - 0.5) * 0.03) * size,
      (y + (ly - 0.5) * 0.03) * size,
      0,
    );
    if (c1 > 0.4) col = colors[1];
    if (c2 < c1) col = colors[2];
    return col;
  };
}

// ---- Planets ----

// A shader on a square `scale` planet diameters wide, centred on the planet.
type Layer = { shader: Shader; scale: number };

// The palette as the planets use it: paper, the sky's ink, and two hues for the planet.
type Inks = { paper: Rgb; sky: Rgb; main: Rgb; second: Rgb };
const lit = (inks: Inks, c: Rgb, t: number) => mix(c, inks.paper, t);
const dim = (inks: Inks, c: Rgb, t: number) => mix(c, inks.sky, t);

// A kind of planet: its diameter in grid cells, where the light sits on its square (the original's, before any
// mirroring), whether it may tilt all the way round, whether to keep only its largest piece, and its shaders
// bottom to top.
type Kind = {
  diameter: number;
  light: Uv;
  tumbles: boolean;
  whole?: boolean;
  layers(setup: (pixels: number) => Setup, inks: Inks): Layer[];
};

const one = (shader: Shader): Layer => ({ shader, scale: 1 });

const KINDS: readonly Kind[] = [
  // LandMasses: water, continents, clouds. The scene's land cutoff (0.633) and the generator's cloud cover
  // (0.35 to 0.6) often leave a bare ocean, so land and cloud reach a little further here.
  {
    diameter: 64,
    light: [0.39, 0.39],
    tumbles: true,
    layers(setup, k) {
      const s = setup(64);
      const { main, second, paper } = k;
      return [
        one(
          under(
            s,
            [lit(k, second, 0.35), second, dim(k, second, 0.45)],
            5.228,
            3,
            0.4,
            0.6,
          ),
        ),
        one(
          landmass(
            s,
            [lit(k, main, 0.4), main, dim(k, main, 0.35), dim(k, main, 0.6)],
            4.292,
            6,
            0.32,
            0.534,
            0.57 + 0.06 * s.rand(),
          ),
        ),
        one(
          clouds(
            s,
            [
              paper,
              mix(paper, k.sky, 0.2),
              mix(paper, k.sky, 0.45),
              mix(paper, k.sky, 0.65),
            ],
            cloudNoise(s.rand, 7.745),
            7.745,
            2,
            0.35 + 0.15 * s.rand(),
            2,
            1.3,
            0.52,
            0.62,
          ),
        ),
      ];
    },
  },
  // IceWorld: ice, lakes, clouds.
  {
    diameter: 64,
    light: [0.3, 0.3],
    tumbles: true,
    layers(setup, k) {
      const s = setup(64);
      const { main, second, paper } = k;
      return [
        one(
          under(
            s,
            [paper, lit(k, main, 0.6), lit(k, main, 0.15)],
            8,
            2,
            0.48,
            0.632,
          ),
        ),
        one(
          pools(
            s,
            [lit(k, second, 0.2), second, dim(k, second, 0.4)],
            10,
            3,
            0.024,
            0.047,
            0.55,
            false,
          ),
        ),
        one(
          clouds(
            s,
            [
              paper,
              lit(k, main, 0.8),
              mix(paper, k.sky, 0.45),
              mix(paper, k.sky, 0.65),
            ],
            cloudNoise(s.rand, 4),
            4,
            4,
            0.45 + 0.15 * s.rand(),
            2.5,
            1.3,
            0.566,
            0.781,
          ),
        ),
      ];
    },
  },
  // LavaWorld: dark rock, craters, lava rivers.
  {
    diameter: 64,
    light: [0.3, 0.3],
    tumbles: true,
    layers(setup, k) {
      const s = setup(64);
      // Darkened, but not so far that the rock sinks into the sky.
      const rock = [
        dim(k, k.second, 0.2),
        dim(k, k.second, 0.4),
        dim(k, k.second, 0.55),
      ];
      return [
        one(bareGround(s, rock, 10, 3, 0.4, 0.6)),
        one(craters(s, [rock[1], rock[2]], 3.5, 0.4)),
        one(
          pools(
            s,
            [lit(k, k.main, 0.3), k.main, dim(k, k.main, 0.3)],
            10,
            4,
            0.019,
            0.036,
            0.579,
            true,
          ),
        ),
      ];
    },
  },
  // GasPlanet: a dark deck under a lit one, sharing their noise.
  {
    diameter: 64,
    light: [0.25, 0.25],
    tumbles: false,
    layers(setup, k) {
      const s = setup(64);
      const { main } = k;
      const noiseAt = cloudNoise(s.rand, 9);
      return [
        one(
          clouds(
            s,
            [dim(k, main, 0.7), dim(k, main, 0.7), k.sky, dim(k, main, 0.85)],
            noiseAt,
            9,
            5,
            0,
            1,
            1.3,
            0.692,
            0.666,
          ),
        ),
        one(
          clouds(
            s,
            [lit(k, main, 0.4), main, dim(k, main, 0.3), dim(k, main, 0.55)],
            noiseAt,
            9,
            5,
            0.28 + 0.22 * s.rand(),
            1,
            1.3,
            0.439,
            0.746,
          ),
        ),
      ];
    },
  },
  // GasPlanetLayers: banded gas inside a ring three planets wide, tilted 0.7 from the planet. The ring's width
  // and perspective vary within the original's slider ranges.
  {
    diameter: 40,
    light: [-0.1, 0.3],
    tumbles: false,
    layers(setup, k) {
      const s = setup(40);
      const r = setup(120);
      const { main } = k;
      r.rotation += s.light[0] < 0.5 ? 0.7 : -0.7;
      return [
        one(
          gasBands(
            s,
            [lit(k, main, 0.5), main, dim(k, main, 0.3)],
            [dim(k, main, 0.5), dim(k, main, 0.68), dim(k, main, 0.85)],
            10.107,
            3,
            0.892,
          ),
        ),
        {
          shader: ring(
            r,
            [lit(k, main, 0.6), lit(k, main, 0.25), dim(k, main, 0.2)],
            [dim(k, main, 0.45), dim(k, main, 0.62), dim(k, main, 0.78)],
            15,
            4,
            0.12 + 0.03 * r.rand(),
            4 + 2 * r.rand(),
          ),
          scale: 3,
        },
      ];
    },
  },
  // NoAtmosphere: a cratered moon.
  {
    diameter: 64,
    light: [0.25, 0.25],
    tumbles: true,
    layers(setup, k) {
      const s = setup(64);
      const ground = [
        lit(k, k.main, 0.45),
        dim(k, k.main, 0.15),
        dim(k, k.main, 0.45),
      ];
      return [
        one(bareGround(s, ground, 8, 4, 0.615, 0.729)),
        one(craters(s, [ground[1], ground[2]], 5, 0.465)),
      ];
    },
  },
  // Asteroid: the rock fills about half its square, so the square spans the art. Noise near the square's edge
  // can break off crumbs; only the largest piece stays, so the stamp shows one rock.
  {
    diameter: 96,
    light: [0, 0],
    tumbles: true,
    whole: true,
    layers(setup, k) {
      const s = setup(96);
      return [
        one(
          asteroid(
            s,
            [lit(k, k.main, 0.45), dim(k, k.main, 0.15), dim(k, k.main, 0.45)],
            5.294,
            2,
          ),
        ),
      ];
    },
  },
];

// The generator's twinkling star sprite, one frame per star: a centre dot and four matching arms, each arm read
// outward from the centre, `#` lit.
const STAR_ARMS = [
  "#.##",
  ".##.",
  ".#..",
  "#...",
  "##.#",
  ".#.#",
  "....",
  "..#.",
  "#...",
  "....",
  "....",
];

// ---- Drawing ----

// For each pixel along an axis `length` pixels long, the grid cells it covers and how much of it each covers.
// Cells are `cell` pixels wide from `start`; pixels past the grid's ends take its edge cells.
function coverage(
  length: number,
  start: number,
  cell: number,
  count: number,
): [number, number][][] {
  return Array.from({ length }, (_, p) => {
    const parts: [number, number][] = [];
    let at = p;
    while (at < p + 1) {
      let j = Math.floor((at - start) / cell);
      // At an edge, division can round back into the cell just before it. Step past it.
      if (start + (j + 1) * cell <= at) j++;
      const end = Math.min(start + (j + 1) * cell, p + 1);
      parts.push([Math.min(count - 1, Math.max(0, j)), end - at]);
      at = end;
    }
    return parts;
  });
}

// Finds the largest edge-connected piece of painted cells, returns every other painted cell to `background`, and
// returns the largest piece's size in cells.
function keepLargestPiece(
  painted: Uint8Array,
  cols: number,
  rows: number,
  cells: Rgb[],
  background: readonly Rgb[],
) {
  // Each painted cell's piece number, from 1.
  const piece = new Int32Array(cols * rows);
  const sizes = [0];
  for (let start = 0; start < painted.length; start++) {
    if (!painted[start] || piece[start]) continue;
    const id = sizes.length;
    const queue = [start];
    piece[start] = id;
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q];
      const x = c % cols;
      for (const n of [
        x > 0 ? c - 1 : -1,
        x < cols - 1 ? c + 1 : -1,
        c - cols,
        c + cols,
      ])
        if (n >= 0 && n < painted.length && painted[n] && !piece[n]) {
          piece[n] = id;
          queue.push(n);
        }
    }
    sizes.push(queue.length);
  }
  const largest = sizes.indexOf(Math.max(...sizes));
  for (let c = 0; c < cells.length; c++)
    if (painted[c] && piece[c] !== largest) cells[c] = background[c];
  return sizes[largest];
}

// The smallest share of its square a whole kind's piece may fill before it's drawn again.
const MIN_PIECE = 0.08;

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  palette: Palette,
) {
  const rand = stream(seed, 0);
  const paper = rgb(palette.paper);
  const sky = rgb(palette.inks[0]);
  const lights = palette.inks.slice(1).map(rgb);
  const main = pick(lights, rand);
  const others = lights.filter((ink) => ink !== main);
  const second = others.length ? pick(others, rand) : mix(sky, paper, 0.45);
  const inks: Inks = { paper, sky, main, second };

  const kind = pick(KINDS, rand);
  // Light from the upper left as in the original, or mirrored to the upper right.
  const mirrored = rand() < 0.5;
  const light: Uv = mirrored ? [1 - kind.light[0], kind.light[1]] : kind.light;
  const rotation = kind.tumbles ? rand() * 2 * Math.PI : (rand() - 0.5) * 0.8;
  const noiseRand = stream(seed, 1);
  // As in the original, every shader gets the same light position, even the ring on its wider square.
  const setup = (pixels: number): Setup => ({
    pixels,
    light,
    rotation,
    rand: noiseRand,
  });

  // The grid: square cells, GRID across the short side, centred on the art.
  const [cols, rows] = gridSize(width, height);
  const cell = Math.min(width, height) / GRID;
  const starfield: Rgb[] = Array<Rgb>(cols * rows).fill(sky);

  // Stars first, so the planet covers any behind it.
  const stars = Math.round((cols * rows) / 900);
  for (let i = 0; i < stars; i++) {
    const cx = Math.floor(rand() * cols);
    const cy = Math.floor(rand() * rows);
    const arms = pick(STAR_ARMS, rand);
    const color = mix(sky, paper, 0.35 + 0.35 * rand());
    const plot = (x: number, y: number) => {
      if (x >= 0 && x < cols && y >= 0 && y < rows)
        starfield[y * cols + x] = color;
    };
    plot(cx, cy);
    for (let a = 0; a < 4; a++)
      if (arms[a] === "#") {
        plot(cx + a + 1, cy);
        plot(cx - a - 1, cy);
        plot(cx, cy + a + 1);
        plot(cx, cy - a - 1);
      }
  }

  // Each cell takes the topmost layer that paints it, so layers under clouds never run.
  const ox = Math.floor((cols - kind.diameter) / 2);
  const oy = Math.floor((rows - kind.diameter) / 2);
  const paint = (layers: Layer[]) => {
    const squares = layers.map(({ shader, scale }) => {
      const offset = ((scale - 1) * kind.diameter) / 2;
      return {
        shader,
        left: ox - offset,
        top: oy - offset,
        pixels: kind.diameter * scale,
      };
    });
    squares.reverse();
    const cells = starfield.slice();
    const painted = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++)
        for (const { shader, left, top, pixels } of squares) {
          const i = x - left;
          const j = y - top;
          if (i < 0 || j < 0 || i >= pixels || j >= pixels) continue;
          const color = shader(i / pixels, j / pixels, (i + j) % 2 === 0);
          if (color) {
            cells[y * cols + x] = color;
            painted[y * cols + x] = 1;
            break;
          }
        }
    const size = kind.whole
      ? keepLargestPiece(painted, cols, rows, cells, starfield)
      : Infinity;
    return { cells, size };
  };
  // An asteroid can come out a speck. Like rerolling the generator, draw fresh noise until the rock is big
  // enough, up to eight tries.
  let { cells, size } = paint(kind.layers(setup, inks));
  for (
    let tries = 1;
    size < MIN_PIECE * kind.diameter * kind.diameter && tries < 8;
    tries++
  )
    ({ cells, size } = paint(kind.layers(setup, inks)));

  const across = coverage(width, (width - cols * cell) / 2, cell, cols);
  const down = coverage(height, (height - rows * cell) / 2, cell, rows);
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y++) {
    const ys = down[y];
    for (let x = 0; x < width; x++) {
      const xs = across[x];
      let r = 0;
      let g = 0;
      let b = 0;
      for (let m = 0; m < ys.length; m++)
        for (let n = 0; n < xs.length; n++) {
          const c = cells[ys[m][0] * cols + xs[n][0]];
          const w = ys[m][1] * xs[n][1];
          r += c[0] * w;
          g += c[1] * w;
          b += c[2] * w;
        }
      const p = (y * width + x) * 4;
      data[p] = Math.round(r);
      data[p + 1] = Math.round(g);
      data[p + 2] = Math.round(b);
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export const pixelPlanet1: Style = {
  id: "planet1",
  draw,
};
