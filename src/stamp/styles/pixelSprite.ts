import type { Palette } from "../palettes";
import { pick, stream } from "../random";
import type { Style } from "../sources";

// Pixel sprite: a creature, ship or object grown from a random mask, mirrored left to right, outlined in the
// darkest ink and centred on a plain field. It computes every pixel itself as the exact area-weighted mix of
// the sprite cells the pixel covers, so the sprite stays crisp when large, smooth when small, and draws the
// same picture at any size. Only IEEE-exact arithmetic here, so pixels match in every browser and in Node,
// which the golden test relies on (ADR 0001).

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

// Left halves of the masks, outer column first; the right half mirrors them. `#` is always body, `+` usually,
// `?` sometimes, `.` never. A `.` walled in by body, like the creature's eye, ends up as outline.
const MASKS = [
  // Creature
  [
    "......",
    "...??+",
    "..?++#",
    ".?+++#",
    ".?+#+#",
    "?++#.#",
    "?+++##",
    ".?+++#",
    "..?++#",
    "..?+?+",
    ".?+..?",
    ".?...?",
  ],
  // Ship
  [
    ".....#",
    "....?#",
    "....+#",
    "...?+#",
    "...++#",
    "..?+##",
    ".?++#+",
    "?+++##",
    "?++#+#",
    ".?+++#",
    "...?+?",
    "....?.",
  ],
  // Object
  [
    "......",
    "...??#",
    "...+##",
    "..?+.#",
    "..?++#",
    ".?++##",
    "?++###",
    "?++###",
    ".?++##",
    "..?++#",
    "...?+#",
    "......",
  ],
];

const HALF = 6;
const ROWS = 12;
// The sprite plus a one-cell ring for its outline.
const GRID = HALF * 2 + 2;
// How much of the art's shorter side the grid spans.
const SPAN = 0.72;

// For each pixel along one axis, the grid cells it overlaps and by how much. Cell -1 is the field outside the
// grid. Weights sum to 1.
function coverage(
  length: number,
  start: number,
  cell: number,
): [number, number][][] {
  return Array.from({ length }, (_, p) => {
    const parts: [number, number][] = [];
    let at = p;
    while (at < p + 1) {
      const j = Math.floor((at - start) / cell);
      const inside = j >= 0 && j < GRID;
      // The next cell edge, or the pixel's end if the edge lies past it or the pixel is outside the grid.
      const edge = inside ? start + (j + 1) * cell : j < 0 ? start : p + 1;
      const end = edge > at && edge < p + 1 ? edge : p + 1;
      parts.push([inside ? j : -1, end - at]);
      at = end;
    }
    return parts;
  });
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const mask = pick(MASKS, rand);
  const paperInk = rgb(paper);
  const outline = rgb(inks[0]);
  const lights = inks.slice(1).map(rgb);
  const body = pick(lights, rand);
  const others = lights.filter((ink) => ink !== body);
  const accent = others.length ? pick(others, rand) : mix(body, paperInk, 0.5);
  const field = mix(paperInk, body, 0.12);

  // Fill the left half from the mask, then mirror it. Cells outside the sprite are null.
  const filled: (Rgb | null)[][] = Array.from({ length: GRID }, () =>
    Array<Rgb | null>(GRID).fill(null),
  );
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < HALF; c++) {
      const odds = { "#": 1, "+": 0.8, "?": 0.5, ".": 0 }[mask[r][c]] ?? 0;
      const on = rand() < odds;
      const ink = rand() < 0.25 ? accent : body;
      if (!on) continue;
      // Lighter towards the top, as if lit from above.
      const color = mix(ink, paperInk, 0.2 * (1 - r / (ROWS - 1)));
      filled[r + 1][c + 1] = color;
      filled[r + 1][GRID - 2 - c] = color;
    }

  // Each grid cell's final color: body, outline where an empty cell touches the body, field otherwise.
  const cells: Rgb[][] = filled.map((row, r) =>
    row.map((color, c) => {
      if (color) return color;
      const touches = [
        [r - 1, c],
        [r + 1, c],
        [r, c - 1],
        [r, c + 1],
      ].some(([y, x]) => filled[y]?.[x]);
      return touches ? outline : field;
    }),
  );

  const cell = (SPAN * Math.min(width, height)) / GRID;
  const columns = coverage(width, (width - cell * GRID) / 2, cell);
  const rows = coverage(height, (height - cell * GRID) / 2, cell);

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const color: Rgb = [0, 0, 0];
      for (const [r, wy] of rows[y])
        for (const [c, wx] of columns[x]) {
          const ink = r < 0 || c < 0 ? field : cells[r][c];
          const w = wx * wy;
          color[0] += ink[0] * w;
          color[1] += ink[1] * w;
          color[2] += ink[2] * w;
        }
      const p = (y * width + x) * 4;
      data[p] = Math.round(color[0]);
      data[p + 1] = Math.round(color[1]);
      data[p + 2] = Math.round(color[2]);
      data[p + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
}

export const pixelSprite1: Style = {
  id: "sprite1",
  draw,
};
