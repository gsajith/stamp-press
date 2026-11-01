import type { Palette } from "../palettes";
import { pick, stream } from "../random";
import type { Style } from "../sources";

// Bauhaus grid: a Swiss-style grid of cells, each a flat field with one bold shape on it (quarter circle,
// half disc, triangle, disc, ring or bar), turned a random quarter turn. Sometimes one 2x2 block holds a
// single large shape to give the grid a focal point. Like the landscape style it computes every pixel from
// positions as fractions of the art's size, with IEEE-exact arithmetic only, so its pixels match in every
// browser and in Node (ADR 0001).

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
const len = (x: number, y: number) => Math.sqrt(x * x + y * y);

// Each shape's signed distance from a point (u, v) in its tile, both in [0, 1], negative inside.
const SHAPES: readonly ((u: number, v: number) => number)[] = [
  (u, v) => len(u, v) - 1, // quarter circle on a corner
  (u, v) => len(u - 0.5, v) - 0.5, // half disc on an edge
  (u, v) => (u + v - 1) * Math.SQRT1_2, // triangle, half the tile
  (u, v) => len(u - 0.5, v - 0.5) - 0.5, // disc
  (u, v) => Math.abs(len(u - 0.5, v - 0.5) - 0.31) - 0.12, // ring
  (_, v) => Math.abs(v - 0.5) - 1 / 6, // bar across the middle
];

type Tile = { shape: number; turn: number; field: Rgb; ink: Rgb };

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const colors = [paper, ...inks].map(rgb);
  // Paper fields keep the grid airy. Each tile's shape takes another color than its field.
  const tile = (): Tile => {
    const f = rand() < 0.4 ? 0 : 1 + Math.floor(rand() * inks.length);
    const others = colors.filter((_, i) => i !== f);
    return {
      shape: Math.floor(rand() * SHAPES.length),
      turn: Math.floor(rand() * 4),
      field: colors[f],
      ink: pick(others, rand),
    };
  };

  // Near-square cells (within about 17%), rows from the art's ratio. The desk and detail views round the art to whole pixels,
  // so its ratio drifts about 1% between them. Rounding at .7 rather than .5 keeps every ratio a stamp's
  // aspect and margin allow (0.71 to 1.4) clear of a boundary, so the row count holds at every size.
  const cols = 3 + Math.floor(rand() * 2);
  const rows = Math.max(2, Math.floor((cols * height) / width + 0.3));
  const tiles = Array.from({ length: cols * rows }, tile);
  const block =
    rand() < 0.6
      ? {
          col: Math.floor(rand() * (cols - 1)),
          row: Math.floor(rand() * (rows - 1)),
          tile: tile(),
        }
      : null;
  if (block) block.tile.shape = Math.floor(rand() * 4); // corner, edge, triangle or disc: the boldest ones

  const [cw, ch] = [width / cols, height / rows];
  // The color at pixel center (x, y) drawn by the tile at cell (col, row).
  const shade = (x: number, y: number, col: number, row: number): Rgb => {
    let [t, c0, r0, span] = [tiles[row * cols + col], col, row, 1];
    const inBlock =
      block &&
      col >= block.col &&
      col <= block.col + 1 &&
      row >= block.row &&
      row <= block.row + 1;
    if (inBlock) [t, c0, r0, span] = [block.tile, block.col, block.row, 2];
    // Shapes sit in a square frame centered on the tile, so circles stay round in a cell that isn't quite
    // square. The field fills the sliver either side of the frame.
    const side = span * Math.min(cw, ch);
    let u = (x - (c0 + span / 2) * cw) / side + 0.5;
    let v = (y - (r0 + span / 2) * ch) / side + 0.5;
    for (let k = 0; k < t.turn; k++) [u, v] = [v, 1 - u];
    // Coverage from the distance in pixels, so shape edges stay smooth at any size.
    return mix(t.field, t.ink, clamp01(0.5 - SHAPES[t.shape](u, v) * side));
  };
  // The cells a pixel span [i, i + 1] overlaps, with the share of the pixel in each, so a pixel on a cell
  // edge blends both cells by area.
  const overlaps = (i: number, size: number, count: number) => {
    const [a, b] = [Math.floor(i / size), Math.floor((i + 1) / size)];
    if (b === a || b >= count) return [[Math.min(a, count - 1), 1]];
    const share = b * size - i;
    return [
      [a, share],
      [b, 1 - share],
    ];
  };
  const colSpans = Array.from({ length: width }, (_, x) =>
    overlaps(x, cw, cols),
  );

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y++) {
    const rowSpans = overlaps(y, ch, rows);
    for (let x = 0; x < width; x++) {
      const color: Rgb = [0, 0, 0];
      for (const [row, wy] of rowSpans)
        for (const [col, wx] of colSpans[x]) {
          const c = shade(x + 0.5, y + 0.5, col, row);
          for (let i = 0; i < 3; i++) color[i] += c[i] * wx * wy;
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

export const bauhausGrid1: Style = {
  id: "bau1",
  draw,
};
