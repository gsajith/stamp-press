import type { Palette } from "../palettes";
import { pick, stream } from "../random";
import type { Style } from "../sources";

// Truchet tiles: Christopher Carlson's multi-scale Truchet tiling. A grid of square tiles, each showing quarter
// arcs, a bar or a cross in two colours. Some tiles split into four half-size tiles with the colours swapped,
// and those split again. Every tile edge shows the same pattern in thirds, and each tile has "wings" past its
// edges (background discs at its corners, foreground discs at its edge midpoints), so tiles of different sizes
// still join up. See https://alexwlchan.net/2025/truchet-tiles/.
//
// Like land1 it computes every pixel itself, in units of the tile grid, so it is resolution independent and its
// pixels match in every browser and in Node (ADR 0001). Only IEEE-exact arithmetic: no Math.sin or the like.

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

// Tiles per level are a fixed grid, so each one's randomness is a hash of its level and cell rather than a draw
// from a stream: any pixel can ask about any tile in any order. Returns a float in [0, 1).
function cellRandom(seed: number, level: number, i: number, j: number) {
  let x =
    seed ^
    Math.imul(level + 1, 0x9e3779b9) ^
    Math.imul(i, 0x85ebca6b) ^
    Math.imul(j, 0xc2b2ae35);
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// The tile designs, weighted by repeats: arcs from opposite corners in both turns, a bar both ways, and a cross.
type Tile = "arcs" | "arcsTurned" | "bar" | "barTurned" | "cross";
const TILES: readonly Tile[] = [
  "arcs",
  "arcsTurned",
  "arcs",
  "arcsTurned",
  "arcs",
  "arcsTurned",
  "bar",
  "barTurned",
  "cross",
];

const THIRD = 1 / 3;
const SIXTH = 1 / 6;
const LEVELS = 3;

// Whether point (u, v) inside a unit tile is foreground. Every design keeps the base: background within a third
// of each corner, foreground within a sixth of each edge midpoint.
function foreground(tile: Tile, u: number, v: number): boolean {
  const ring = (cu: number, cv: number) => {
    const d = Math.sqrt((u - cu) * (u - cu) + (v - cv) * (v - cv));
    return d >= THIRD && d < 2 * THIRD;
  };
  const across = Math.abs(v - 0.5) < SIXTH; // the horizontal bar
  const down = Math.abs(u - 0.5) < SIXTH; // the vertical bar
  const cap = (mu: number, mv: number) =>
    (u - mu) * (u - mu) + (v - mv) * (v - mv) < SIXTH * SIXTH;
  switch (tile) {
    case "arcs":
      return ring(0, 0) || ring(1, 1);
    case "arcsTurned":
      return ring(1, 0) || ring(0, 1);
    case "bar":
      return across || cap(0.5, 0) || cap(0.5, 1);
    case "barTurned":
      return down || cap(0, 0.5) || cap(1, 0.5);
    case "cross":
      return across || down;
  }
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const tilesAcross = 2 + Math.floor(rand() * 2); // tiles across the short side at the top level
  const split = [0.2 + 0.3 * rand(), 0.15 + 0.25 * rand()]; // chance a tile splits, per level
  const tileSeed = Math.floor(rand() * 2 ** 32);
  // Ink from all but the lightest of three or more, so it stands out; the paper takes a hint of the lightest.
  const ink = rgb(pick(inks.slice(0, Math.max(2, inks.length - 1)), rand));
  const ground = mix(rgb(paper), rgb(inks[inks.length - 1]), 0.18 * rand());

  // The tile at (level, i, j) is drawn when every tile above it split.
  const splits = (level: number, i: number, j: number) =>
    cellRandom(tileSeed, level, i, j) < split[level];
  const exists = (level: number, i: number, j: number): boolean =>
    level === 0 ||
    (exists(level - 1, i >> 1, j >> 1) && splits(level - 1, i >> 1, j >> 1));
  const design = (level: number, i: number, j: number) =>
    TILES[
      Math.floor(cellRandom(tileSeed ^ 0x5bd1e995, level, i, j) * TILES.length)
    ];

  // Whether the point at (x, y), in top-level tiles, shows ink. Tiles paint coarse to fine, so the finest level
  // that covers the point decides. Within a level the tiles and their wings agree wherever they overlap.
  const inked = (x: number, y: number): boolean => {
    for (let level = LEVELS - 1; level >= 0; level--) {
      const [lx, ly] = [x * 2 ** level, y * 2 ** level];
      const [i, j] = [Math.floor(lx), Math.floor(ly)];
      const swap = level % 2 === 1;
      if (exists(level, i, j))
        return foreground(design(level, i, j), lx - i, ly - j) !== swap;
      // Wings of the neighbouring tiles: a background disc at their corners, a foreground disc at their edge
      // midpoints. A third and a sixth don't overlap, so at most one applies.
      const [ci, cj] = [Math.round(lx), Math.round(ly)];
      const [dx, dy] = [lx - ci, ly - cj];
      if (dx * dx + dy * dy < THIRD * THIRD) {
        if (
          exists(level, ci - 1, cj - 1) ||
          exists(level, ci, cj - 1) ||
          exists(level, ci - 1, cj) ||
          exists(level, ci, cj)
        )
          return swap;
        continue;
      }
      const [u, v] = [lx - i, ly - j];
      const near = (mu: number, mv: number) =>
        (u - mu) * (u - mu) + (v - mv) * (v - mv) < SIXTH * SIXTH;
      if (
        (near(0.5, 0) && exists(level, i, j - 1)) ||
        (near(0.5, 1) && exists(level, i, j + 1)) ||
        (near(0, 0.5) && exists(level, i - 1, j)) ||
        (near(1, 0.5) && exists(level, i + 1, j))
      )
        return !swap;
    }
    return false; // unreachable: every top-level tile exists
  };

  // Pixel (px, py) in tile units, with the grid centred so the long side shows equal part tiles at each end.
  const size = Math.min(width, height) / tilesAcross;
  const tx = (px: number) => (px - width / 2) / size + tilesAcross / 2;
  const ty = (py: number) => (py - height / 2) / size + tilesAcross / 2;

  // Ink at every pixel corner. A pixel whose corners agree is solid unless a feature could hide inside it, so
  // only edge pixels are supersampled. The smallest feature is a sixth of a finest tile.
  const corners = new Uint8Array((width + 1) * (height + 1));
  for (let y = 0; y <= height; y++)
    for (let x = 0; x <= width; x++)
      corners[y * (width + 1) + x] = inked(tx(x), ty(y)) ? 1 : 0;
  const tiny = size / 2 ** (LEVELS - 1) / 6 < 2;
  const S = tiny ? 8 : 4; // samples per side

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const c = y * (width + 1) + x;
      const sum =
        corners[c] +
        corners[c + 1] +
        corners[c + width + 1] +
        corners[c + width + 2];
      let cover = sum / 4;
      if (tiny || (sum > 0 && sum < 4)) {
        let hits = 0;
        for (let sy = 0; sy < S; sy++)
          for (let sx = 0; sx < S; sx++)
            if (inked(tx(x + (sx + 0.5) / S), ty(y + (sy + 0.5) / S))) hits++;
        cover = hits / (S * S);
      }
      const color = mix(ground, ink, cover);
      const p = (y * width + x) * 4;
      data[p] = Math.round(color[0]);
      data[p + 1] = Math.round(color[1]);
      data[p + 2] = Math.round(color[2]);
      data[p + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
}

export const truchetTiles1: Style = {
  id: "truchet1",
  draw,
};
