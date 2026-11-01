import type { Palette } from "../palettes";
import { pick, stream } from "../random";
import type { Style } from "../sources";

// Cross-stitch sampler: a needlework motif (a cottage, a strawberry, a pair of birds or a potted carnation)
// inside a geometric border band, worked in thread X's on Aida cloth. Every X's top leg lies the same way, the
// cloth's woven blocks and holes show between stitches, and some samplers outline the motif in backstitch.
// The border comes from symmetric rules on its distance in from the edge and along it from the middle, and
// small fillers and a scatter of single stitches sit symmetrically around the motif.
//
// Every stitched cell looks alike up to its thread's color, so the cloth and the X are each drawn once into a
// tile, and a pixel takes the exact average of the tiles over the cells it covers, through summed-area tables.
// That box filter makes the thread's twist and the weave show at 2048 px and average out at desk size, and
// draws the same picture at any size. Only IEEE-exact arithmetic here, so pixels match in every browser and in
// Node, which the golden test relies on (ADR 0001).

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
const frac = (x: number) => x - Math.floor(x);

// A float in [0, 1) for each cell, the "lowbias32" hash of its coordinates and a salt.
function hash2(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ salt;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Charts, one character per cell: `.` is bare cloth, `D` the darkest ink, `A` the main thread, `B` the second,
// `L` a light tint of the main thread, and `S` the main thread seeded with light stitches in a lattice. Every
// chart has an odd width, so it centers on the sampler's middle column.
const MOTIFS: readonly (readonly string[])[] = [
  // Cottage
  [
    "..............DD...",
    "..............DD...",
    ".........A....DD...",
    "........AAA...DD...",
    ".......AAAAA..DD...",
    "......AAAAAAA.DD...",
    ".....AAAAAAAAADD...",
    "....AAAAAAAAAAA....",
    "...AAAAAAAAAAAAA...",
    "..AAAAAAAAAAAAAAA..",
    "...LLLLLLLLLLLLL...",
    "...LBDBLDDDLBDBL...",
    "...LDDDLDDDLDDDL...",
    "...LBDBLDDDLBDBL...",
    "...LLLLLDDDLLLLL...",
    "...LLLLLDDDLLLLL...",
    "BBBBBBBBBBBBBBBBBBB",
  ],
  // Strawberry
  [
    "........B......",
    ".......B.......",
    "..BB...B...BB..",
    "...BBBBBBBBB...",
    ".SSBBBSBSBBBSS.",
    "SSSSBSSBSSBSSSS",
    "SSSSSSSSSSSSSSS",
    "SSSSSSSSSSSSSSS",
    "SSSSSSSSSSSSSSS",
    ".SSSSSSSSSSSSS.",
    ".SSSSSSSSSSSSS.",
    "..SSSSSSSSSSS..",
    "..SSSSSSSSSSS..",
    "...SSSSSSSSS...",
    "....SSSSSSS....",
    ".....SSSSS.....",
    "......SSS......",
  ],
  // Pair of birds under a heart
  [
    "........AA.AA........",
    ".......AAAAAAA.......",
    ".......AAAAAAA.......",
    "........AAAAA........",
    ".........AAA.........",
    "......BB..A..BB......",
    ".....BBDBD.DBDBB.....",
    ".....BBBB...BBBB.....",
    "B...BBBBB...BBBBB...B",
    "BB.BBLLLB...BLLLBB.BB",
    ".BBBLLLLB...BLLLLBBB.",
    "..BBLLLBB...BBLLLBB..",
    "...BBBBB.....BBBBB...",
    "....D.D.......D.D....",
    "DDDDDDDDDDDDDDDDDDDDD",
  ],
  // Potted carnation
  [
    "...A.A.A.A.A...",
    "...AAAAAAAAA...",
    "....AALALAA....",
    ".....AAAAA.....",
    "......BBB......",
    ".......B.......",
    "...BB..B..BB...",
    "..BBBB.B.BBBB..",
    "....BBBBBBB....",
    ".......B.......",
    ".......B.......",
    ".BB....B....BB.",
    "..BBB..B..BBB..",
    "....BBBBBBB....",
    ".......B.......",
    "..DDDDDDDDDDD..",
    "...AAAAAAAAA...",
    "...ALAAAAALA...",
    "....AAAAAAA....",
    "....AAAAAAA....",
    ".....DDDDD.....",
  ],
];

// Small charts set around the motif: a heart, an eight-pointed star, a tulip and a diamond.
const FILLERS: readonly (readonly string[])[] = [
  [".A.A.", "AAAAA", "AAAAA", ".AAA.", "..A.."],
  ["A..A..A", ".A.A.A.", "..AAA..", "AAALAAA", "..AAA..", ".A.A.A.", "A..A..A"],
  ["A.A.A", "AAAAA", ".AAA.", "..B..", "B.B.B", ".BBB."],
  ["..A..", ".ALA.", "ALBLA", ".ALA.", "..A.."],
];

// Border bands, as rules from a cell's place in the band to its thread: 0 bare, 1 the border's thread, 2 its
// accent. `e` counts rows in from the band's outer edge, `h` rows in all, and `s` cells along it from the
// middle of its side, in either direction, so every side is mirror symmetric about its middle.
type Band = {
  rows: number[];
  rule: (s: number, e: number, h: number) => number;
};
const zig = (s: number, h: number) => {
  const p = 2 * (h - 1);
  return Math.abs((s % p) - (h - 1));
};
const BANDS: readonly Band[] = [
  // Zigzag
  { rows: [3, 4], rule: (s, e, h) => (e === zig(s, h) ? 1 : 0) },
  // Diamond lattice: two zigzags crossing, an accent in each diamond
  {
    rows: [3, 5],
    rule: (s, e, h) => {
      const z = zig(s, h);
      if (e === z || e === h - 1 - z) return 1;
      return h === 5 && e === 2 && s % 4 === 0 ? 2 : 0;
    },
  },
  // Chain of diamonds, a dot in each, a bead between
  {
    rows: [5],
    rule: (s, e) => {
      const m = Math.min(s % 6, 6 - (s % 6)) + Math.abs(e - 2);
      return m === 2 ? 1 : m === 0 ? 2 : m === 3 && e === 2 ? 2 : 0;
    },
  },
  // Checks
  {
    rows: [3],
    rule: (s, e) => ((s + e) % 2 === 0 ? (e === 1 ? 2 : 1) : 0),
  },
  // Battlement
  {
    rows: [3, 4],
    rule: (s, e, h) => {
      const k = (s + 1) % 4;
      return k === 0 ||
        k === 2 ||
        (k === 1 && e === 0) ||
        (k === 3 && e === h - 1)
        ? 1
        : 0;
    },
  },
];

// Corner blocks, from a cell's place in a b by b square folded to one quarter (x, y count in from its outer
// edges) to its thread, as in the bands.
const CORNERS: readonly ((x: number, y: number, b: number) => number)[] = [
  // A diamond
  (x, y, b) => {
    const m = Math.abs(x - (b - 1) / 2) + Math.abs(y - (b - 1) / 2);
    return m <= (b - 3) / 2 ? (m === 0 ? 2 : 1) : 0;
  },
  // A cross
  (x, y, b) => (x === (b - 1) / 2 || y === (b - 1) / 2 ? 2 : 0),
  // Solid, with an accent center
  (x, y, b) => (x === (b - 1) / 2 && y === (b - 1) / 2 ? 2 : 1),
];

// The tiles: one cell of bare cloth, and one stitched with an X, in cell units with y down.

const HOLE = 0.12; // radius of the holes woven into the cloth at each cell's corners
const HALF = 0.21; // half the width of a leg of the X, where it isn't tapering into a hole
const PLY = 0.13; // how far along a thread one ply's twist repeats

// How much of the cloth's color shows at a point: its woven block, the holes at its corners, and the sparser
// weave along its edges between them.
function cloth(u: number, v: number): number {
  const du = u < 0.5 ? u : 1 - u;
  const dv = v < 0.5 ? v : 1 - v;
  const r = Math.sqrt(du * du + dv * dv);
  if (r < HOLE) return 0.45 + (0.3 * r) / HOLE;
  let shade = 0.82 + 0.18 * clamp01((r - HOLE) / 0.07);
  if ((du < dv ? du : dv) < 0.05) shade *= 0.93;
  // Four threads each way, crossing over and under in turn.
  const [iu, iv] = [Math.floor(u * 4), Math.floor(v * 4)];
  const t = (iu + iv) % 2 === 0 ? frac(u * 4) : frac(v * 4);
  const edge = 2 * Math.abs(t - 0.5);
  return shade * (1 - 0.08 * edge * edge);
}

// A leg's width tapers where it runs into the holes at its ends. `a` runs 0 to 1 along it and `d` is the signed
// distance from its center line, in cells. Returns how far across the thread the point lies, -1 to 1, or 2 off
// the thread.
function across(a: number, d: number): number {
  const end = (a < 0.5 ? a : 1 - a) * Math.SQRT2;
  const half = HALF * (0.45 + 0.55 * clamp01(end / 0.3));
  return d > -half && d < half ? d / half : 2;
}

// A thread's shade and sheen at `n` across it, -1 to 1, and `s` cells along it: round, lit from the top left,
// with its two plies twisting along it.
function thread(n: number, s: number, out: Float64Array, shadow: number) {
  const round = Math.sqrt(1 - n * n);
  const g = 2 * Math.abs(frac(s / PLY + 0.4 * n) - 0.5);
  const groove = g * g * g * g;
  const sheen = 0.3 * clamp01(1 - ((n + 0.35) / 0.3) * ((n + 0.35) / 0.3));
  out[0] = 0;
  out[1] = (0.6 + 0.4 * round) * (1 - 0.35 * groove) * shadow;
  out[2] = sheen * (1 - groove) * shadow;
}

// A stitched cell, as [cloth, thread, sheen] weights: the bottom leg runs from bottom left to top right, the top
// leg crosses it from top left to bottom right and shades it where they cross.
function stitch(u: number, v: number, out: Float64Array) {
  const top = across((u + v) / 2, (u - v) * Math.SQRT1_2);
  if (top < 2) return thread(top, (u + v) * Math.SQRT1_2, out, 1);
  const d = (u + v - 1) * Math.SQRT1_2;
  const bottom = across((u - v + 1) / 2, d);
  const gap = Math.abs((u - v) * Math.SQRT1_2) - HALF;
  if (bottom < 2)
    return thread(bottom, (u - v) * Math.SQRT1_2, out, gap < 0.06 ? 0.72 : 1);
  out[0] = cloth(u, v) * (Math.abs(d) - HALF < 0.04 || gap < 0.04 ? 0.8 : 1);
  out[1] = 0;
  out[2] = 0;
}

// A summed-area table of a tile drawn at `res` texels per cell, each the mean of 3 by 3 samples, with `channels`
// values per texel. Entry (x, y) holds the sum over texels left of x and above y.
function table(
  res: number,
  channels: number,
  tile: (u: number, v: number, out: Float64Array) => void,
): Float64Array {
  const sat = new Float64Array((res + 1) * (res + 1) * channels);
  const out = new Float64Array(3);
  const texel = new Float64Array(channels);
  const row = (res + 1) * channels;
  for (let y = 0; y < res; y++)
    for (let x = 0; x < res; x++) {
      texel.fill(0);
      for (let j = 0; j < 3; j++)
        for (let i = 0; i < 3; i++) {
          tile((x + (i + 0.5) / 3) / res, (y + (j + 0.5) / 3) / res, out);
          for (let c = 0; c < channels; c++) texel[c] += out[c] / 9;
        }
      const k = ((y + 1) * (res + 1) + x + 1) * channels;
      for (let c = 0; c < channels; c++)
        sat[k + c] =
          texel[c] +
          sat[k + c - row] +
          sat[k + c - channels] -
          sat[k + c - row - channels];
    }
  return sat;
}

// The difference between a running sum at fraction f1 past entry o1 and at f0 past o0, with `step` between
// entries: the integral between those two points.
const between = (
  sums: Float64Array,
  o0: number,
  o1: number,
  f0: number,
  f1: number,
  step: number,
) =>
  sums[o1] +
  (sums[o1 + step] - sums[o1]) * f1 -
  sums[o0] -
  (sums[o0 + step] - sums[o0]) * f0;

// For each pixel along one axis, the cells it overlaps and the span of each it covers, in texels.
function spans(pixels: number, cells: number, res: number): number[][] {
  const per = cells / pixels;
  return Array.from({ length: pixels }, (_, p) => {
    const parts: number[] = [];
    // The last pixel ends on the last cell's edge exactly, so rounding can't reach a cell past the grid.
    const [start, end] = [p * per, p + 1 === pixels ? cells : (p + 1) * per];
    for (let i = Math.floor(start); i < end; i++) {
      const [a, b] = [Math.max(start, i) - i, Math.min(end, i + 1) - i];
      if (b > a) parts.push(i, a * res, b * res);
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
  const salt = Math.floor(rand() * 2 ** 32);

  // Threads: the darkest ink, a main and a second thread from the rest, a light tint of the main, and the
  // border's thread and accent.
  const paperRgb = rgb(paper);
  const dark = rgb(inks[0]);
  const rest = inks.slice(1).map(rgb);
  const main = pick(rest, rand);
  const others = rest.filter((ink) => ink !== main);
  const second = others.length ? pick(others, rand) : mix(main, dark, 0.45);
  const light = mix(main, paperRgb, 0.5);
  const threads: Rgb[] = [dark, main, second, light];
  const border = Math.floor(rand() * 3);
  const accent = (border + 1 + Math.floor(rand() * 2)) % 3;
  // Aida comes white, cream or tinted.
  const clothRgb =
    rand() < 0.3 ? mix(paperRgb, rgb(inks[inks.length - 1]), 0.12) : paperRgb;

  const motif = pick(MOTIFS, rand);
  const band = pick(BANDS, rand);
  const h = pick(band.rows, rand);
  const framed = rand() < 0.7;
  const b = h + (framed ? 2 : 0);
  const corner = pick(CORNERS, rand);
  const filler = pick(FILLERS, rand);
  const scatter = rand() < 0.4;
  const backstitch = rand() < 0.5;

  // The grid: bare cloth around the edge, wide enough that a full-bleed stamp's punch doesn't bite the border,
  // then the border band, a gap, and the field the motif sits in. Both sides hold an odd number of cells, so
  // there's a middle cell to mirror about, and the cells stretch a hair to fill the art exactly.
  const OUTER = 3;
  const GAP = 2;
  const [mw, mh] = [motif[0].length, motif.length];
  const ring = 2 * (OUTER + b + GAP);
  const short = ring + Math.max(mw, mh) + 2 + 2 * Math.floor(rand() * 3);
  const odd = (x: number) => 2 * Math.round((x - 1) / 2) + 1;
  const long = odd((short * Math.max(width, height)) / Math.min(width, height));
  const [cols, rows] = width <= height ? [short, long] : [long, short];

  // Each cell's thread, -1 for bare cloth, and whether it's part of the motif, for the backstitch.
  const cells = new Int8Array(cols * rows).fill(-1);
  const inMotif = new Uint8Array(cols * rows);
  const at = (x: number, y: number) => cells[y * cols + x];

  // The border band.
  const [cx, cy] = [(cols - 1) / 2, (rows - 1) / 2];
  for (let y = OUTER; y < rows - OUTER; y++)
    for (let x = OUTER; x < cols - OUTER; x++) {
      const [dx, dy] = [
        Math.min(x, cols - 1 - x) - OUTER,
        Math.min(y, rows - 1 - y) - OUTER,
      ];
      if (dx >= b && dy >= b) continue;
      let ink: number;
      if (dx < b && dy < b) ink = corner(dx, dy, b);
      else {
        const d = Math.min(dx, dy);
        const s = dx < dy ? Math.abs(y - cy) : Math.abs(x - cx);
        ink =
          framed && (d === 0 || d === b - 1)
            ? 1
            : band.rule(s, d - (framed ? 1 : 0), h);
      }
      if (ink) cells[y * cols + x] = ink === 1 ? border : accent;
    }

  // Copies a chart onto the grid with its top left at (x0, y0).
  const place = (
    chart: readonly string[],
    x0: number,
    y0: number,
    isMotif: boolean,
  ) =>
    chart.forEach((line, j) => {
      const ccx = (line.length - 1) / 2;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === ".") continue;
        const seeded = j > 4 && (Math.abs(i - ccx) + 2 * j) % 4 === 1;
        const k = (y0 + j) * cols + x0 + i;
        cells[k] = ch === "S" ? (seeded ? 3 : 1) : "DABL".indexOf(ch);
        if (isMotif) inMotif[k] = 1;
      }
    });

  // The field, the motif in its middle, and fillers in the space left along its long side, in an odd count
  // so they stay symmetric.
  const f0 = OUTER + b + GAP;
  const [fw, fh] = [cols - 2 * f0, rows - 2 * f0];
  const [mx, my] = [f0 + (fw - mw) / 2, f0 + Math.floor((fh - mh) / 2)];
  place(motif, mx, my, true);
  const [lw, lh] = [filler[0].length, filler.length];
  // Three fillers in a row two cells apart if they fit across `room`, else one.
  const row = (size: number, room: number) => (3 * size + 4 <= room ? 3 : 1);
  if (fh - mh >= fw - mw) {
    const space = my - f0;
    const count = row(lw, fw);
    if (space >= lh + 2) {
      const x0 = f0 + (fw - (count * lw + (count - 1) * 2)) / 2;
      const y0 = f0 + Math.floor((space - lh) / 2);
      for (let k = 0; k < count; k++) {
        place(filler, x0 + k * (lw + 2), y0, false);
        place(filler, x0 + k * (lw + 2), rows - y0 - lh, false);
      }
    }
  } else {
    const space = mx - f0;
    const count = row(lh, fh);
    if (space >= lw + 2) {
      const y0 = f0 + Math.floor((fh - (count * lh + (count - 1) * 2)) / 2);
      const x0 = f0 + Math.floor((space - lw) / 2);
      for (let k = 0; k < count; k++) {
        place(filler, x0, y0 + k * (lh + 2), false);
        place(filler, cols - x0 - lw, y0 + k * (lh + 2), false);
      }
    }
  }

  // Single stitches scattered on a diamond lattice through the field, kept clear of everything else.
  if (scatter)
    for (let y = f0 + 1; y < rows - f0 - 1; y++)
      for (let x = f0 + 1; x < cols - f0 - 1; x++) {
        const [dx, dy] = [Math.abs(x - cx), Math.abs(y - cy)];
        if (dx % 2 || dy % 2 || (dx + dy) % 4) continue;
        let clear = true;
        for (let j = -2; j <= 2 && clear; j++)
          for (let i = -2; i <= 2; i++)
            if (at(x + i, y + j) >= 0) clear = false;
        if (clear) cells[y * cols + x] = 3;
      }

  // The backstitch: a dark line along every edge between the motif and bare cloth. A cell's left and top edges
  // are its own, flagged in `edges` (1 left, 2 top), and `near` marks cells within one of a line.
  const edges = new Uint8Array(cols * rows);
  const near = new Uint8Array(cols * rows);
  let backstitched = false;
  if (backstitch)
    for (let y = 1; y < rows - 1; y++)
      for (let x = 1; x < cols - 1; x++) {
        const k = y * cols + x;
        const left = k - 1;
        const up = k - cols;
        if (inMotif[k] !== inMotif[left] && cells[inMotif[k] ? left : k] < 0)
          edges[k] |= 1;
        if (inMotif[k] !== inMotif[up] && cells[inMotif[k] ? up : k] < 0)
          edges[k] |= 2;
        if (!edges[k]) continue;
        backstitched = true;
        for (let j = -1; j <= 1; j++)
          for (let i = -1; i <= 1; i++) near[k + j * cols + i] = 1;
      }

  // The tiles, at two texels or more per pixel up to 2048 px.
  const cellPx = Math.min(width / cols, height / rows);
  const res = cellPx <= 12 ? 32 : cellPx <= 32 ? 64 : 128;
  const bare = table(res, 1, (u, v, out) => {
    out[0] = cloth(u, v);
  });
  const stitched = table(res, 3, stitch);

  // Each pixel column's parts, one per cell it overlaps, and for each part its tile summed across the part's
  // span and down to every texel row: [cloth] for a bare cell, [cloth, thread, sheen] for a stitch. A part's
  // integral over a pixel is then the difference between two of those rows.
  const W = res + 1;
  const xs = spans(width, cols, res);
  const ys = spans(height, rows, res);
  const first = new Int32Array(width + 1);
  for (let px = 0; px < width; px++)
    first[px + 1] = first[px] + xs[px].length / 3;
  const bareCols = new Float64Array(first[width] * W);
  const stitchCols = new Float64Array(first[width] * W * 3);
  for (let px = 0; px < width; px++)
    for (let q = 0; q < xs[px].length; q += 3) {
      const g = first[px] + q / 3;
      const [a, b] = [xs[px][q + 1], xs[px][q + 2]];
      const [ia, ib] = [
        Math.min(Math.floor(a), res - 1),
        Math.min(Math.floor(b), res - 1),
      ];
      const [fa, fb] = [a - ia, b - ib];
      for (let y = 0; y < W; y++) {
        const [ka, kb] = [y * W + ia, y * W + ib];
        bareCols[g * W + y] =
          bare[kb] +
          (bare[kb + 1] - bare[kb]) * fb -
          bare[ka] -
          (bare[ka + 1] - bare[ka]) * fa;
        for (let c = 0; c < 3; c++) {
          const [sa, sb] = [stitched[ka * 3 + c], stitched[kb * 3 + c]];
          stitchCols[(g * W + y) * 3 + c] =
            sb +
            (stitched[kb * 3 + 3 + c] - sb) * fb -
            sa -
            (stitched[ka * 3 + 3 + c] - sa) * fa;
        }
      }
    }

  // Each stitch's thread, and how it catches the light, a little different from its neighbors'.
  const tones = new Float64Array(cols * rows * 3);
  for (let k = 0; k < cols * rows; k++)
    if (cells[k] >= 0) {
      const tone = 0.95 + 0.1 * hash2(k % cols, Math.floor(k / cols), salt);
      for (let c = 0; c < 3; c++)
        tones[k * 3 + c] = threads[cells[k]][c] * tone;
    }

  const area = (res * cols * res * rows) / (width * height);
  const thick = 0.07; // half the backstitch's width, in cells
  const [sx, sy] = [cols / width, rows / height];
  const [white, cr, cg, cb] = [
    255 / area,
    clothRgb[0] / area,
    clothRgb[1] / area,
    clothRgb[2] / area,
  ];

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let py = 0; py < height; py++) {
    const yp = ys[py];
    for (let px = 0; px < width; px++) {
      const xp = xs[px];
      let [red, green, blue] = [0, 0, 0];
      for (let r = 0; r < yp.length; r += 3) {
        const row = yp[r] * cols;
        const [c0, c1] = [yp[r + 1], yp[r + 2]];
        const [i0, i1] = [
          Math.min(Math.floor(c0), res - 1),
          Math.min(Math.floor(c1), res - 1),
        ];
        const [f0, f1] = [c0 - i0, c1 - i1];
        for (let q = 0, g = first[px]; q < xp.length; q += 3, g++) {
          const k = row + xp[q];
          if (cells[k] < 0) {
            const v = between(bareCols, g * W + i0, g * W + i1, f0, f1, 1);
            red += v * cr;
            green += v * cg;
            blue += v * cb;
            continue;
          }
          const [o0, o1] = [(g * W + i0) * 3, (g * W + i1) * 3];
          const onCloth = between(stitchCols, o0, o1, f0, f1, 3);
          const onThread =
            between(stitchCols, o0 + 1, o1 + 1, f0, f1, 3) / area;
          const sheen = between(stitchCols, o0 + 2, o1 + 2, f0, f1, 3) * white;
          const t = k * 3;
          red += onCloth * cr + onThread * tones[t] + sheen;
          green += onCloth * cg + onThread * tones[t + 1] + sheen;
          blue += onCloth * cb + onThread * tones[t + 2] + sheen;
        }
      }
      // Backstitch over the top: the exact area of each line, a thin rectangle, inside the pixel.
      const [i0, i1, j0, j1] = [
        xp[0],
        xp[xp.length - 3],
        yp[0],
        yp[yp.length - 3],
      ];
      let close = false;
      if (backstitched)
        for (let y = j0; y <= j1 && !close; y++)
          for (let x = i0; x <= i1; x++) if (near[y * cols + x]) close = true;
      if (close) {
        const [ux0, ux1, uy0, uy1] = [
          px * sx,
          (px + 1) * sx,
          py * sy,
          (py + 1) * sy,
        ];
        // The area of a line from (ax, ay) to (bx, by), a thin rectangle, inside the pixel.
        const line = (ax: number, ay: number, bx: number, by: number) => {
          const ox = Math.min(ux1, bx + thick) - Math.max(ux0, ax - thick);
          const oy = Math.min(uy1, by + thick) - Math.max(uy0, ay - thick);
          return ox > 0 && oy > 0 ? ox * oy : 0;
        };
        let cover = 0;
        for (let y = Math.max(j0 - 1, 0); y <= Math.min(j1 + 1, rows - 1); y++)
          for (
            let x = Math.max(i0 - 1, 0);
            x <= Math.min(i1 + 1, cols - 1);
            x++
          ) {
            const e = edges[y * cols + x];
            if (e & 1) cover += line(x, y, x, y + 1);
            if (e & 2) cover += line(x, y, x + 1, y);
          }
        cover = Math.min(1, cover / (sx * sy));
        red += (dark[0] * 0.9 - red) * cover;
        green += (dark[1] * 0.9 - green) * cover;
        blue += (dark[2] * 0.9 - blue) * cover;
      }

      const p = (py * width + px) * 4;
      data[p] = Math.round(red);
      data[p + 1] = Math.round(green);
      data[p + 2] = Math.round(blue);
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export const crossStitch1: Style = {
  id: "stitch1",
  draw,
};
