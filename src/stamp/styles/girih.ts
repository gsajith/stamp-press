import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Girih star pattern: interlaced Islamic stars drawn by Hankin's method. A periodic tiling of regular polygons
// (4.8.8, 6.6.6, 3.12.12 or 4.6.12) is the scaffold. From each edge midpoint two rays leave at the contact
// angle, one each way, and stop where they meet the ray from the next edge, on the bisector of the corner
// between them. The rays are the straps, in the darkest ink. Each tile's star, inside its rays, and the
// rosette around each tiling vertex, outside them, fill with the other inks by class. Rays from neighbouring
// tiles cross at each edge midpoint, and the straps can weave over and under there.
//
// Like land1, it computes every pixel itself, in units of the tiling's edge, so it is resolution independent
// and its pixels match in every browser and in Node, which the golden test relies on (ADR 0001). Only
// IEEE-exact arithmetic here: no Math.sin or the like.

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
const SQRT2 = Math.sqrt(2);
const SQRT3 = Math.sqrt(3);

// Sine from its Taylor polynomial, which is the same in every engine, unlike Math.sin. Error under 1e-11.
function sin(x: number): number {
  let y = x - TAU * Math.round(x / TAU);
  if (y > TAU / 4) y = TAU / 2 - y;
  else if (y < -TAU / 4) y = -TAU / 2 - y;
  const y2 = y * y;
  let sum = 1;
  for (let k = 15; k > 1; k -= 2) sum = 1 - sum * (y2 / (k * (k - 1)));
  return y * sum;
}
const cos = (x: number) => sin(x + TAU / 4);

// A tiling: two lattice vectors and the tiles in one cell of the lattice, each a regular polygon with edges 1
// long, its center, its side count and the direction of its first edge's outward normal in turns.
type Tiling = {
  lattice: [[number, number], [number, number]];
  motif: { x: number; y: number; n: number; turn: number }[];
};

const A = 1 + SQRT2; // 4.8.8: octagons on a square lattice, squares between
const D = 2 + SQRT3; // 3.12.12: dodecagons on a triangular lattice, triangles between
const E = 3 + SQRT3; // 4.6.12: dodecagons further apart, squares and hexagons between
const TILINGS: readonly Tiling[] = [
  {
    lattice: [
      [A, 0],
      [0, A],
    ],
    motif: [
      { x: 0, y: 0, n: 8, turn: 0 },
      { x: A / 2, y: A / 2, n: 4, turn: 1 / 8 },
    ],
  },
  {
    lattice: [
      [SQRT3, 0],
      [SQRT3 / 2, 1.5],
    ],
    motif: [{ x: 0, y: 0, n: 6, turn: 0 }],
  },
  {
    lattice: [
      [D, 0],
      [D / 2, (D * SQRT3) / 2],
    ],
    motif: [
      { x: 0, y: 0, n: 12, turn: 0 },
      { x: D / 2, y: D / (2 * SQRT3), n: 3, turn: 1 / 4 },
      { x: D, y: D / SQRT3, n: 3, turn: 1 / 12 },
    ],
  },
  {
    lattice: [
      [E, 0],
      [E / 2, (E * SQRT3) / 2],
    ],
    motif: [
      { x: 0, y: 0, n: 12, turn: 0 },
      { x: E / 2, y: 0, n: 4, turn: 0 },
      { x: E / 4, y: (E * SQRT3) / 4, n: 4, turn: 1 / 6 },
      { x: -E / 4, y: (E * SQRT3) / 4, n: 4, turn: 1 / 3 },
      { x: E / 2, y: E / (2 * SQRT3), n: 6, turn: 1 / 12 },
      { x: E, y: E / SQRT3, n: 6, turn: 1 / 12 },
    ],
  },
];

// One placed tile: its center, apothem and circumradius, the length of its rays, its star's fill, and the
// outward normal of each edge, counterclockwise, interleaved x and y.
type Tile = {
  x: number;
  y: number;
  apothem: number;
  radius: number;
  length: number;
  fill: Rgb;
  normals: Float64Array;
};

// How far (x, y) reaches along the tile's furthest edge normal. The point is inside the tile when the reach is
// at most the apothem. That edge's index into the normals goes in `reachEdge`, so the hot loop allocates nothing.
let reachEdge = 0;
function reach(t: Tile, x: number, y: number): number {
  const dx = x - t.x;
  const dy = y - t.y;
  let best = -Infinity;
  let k = 0;
  for (let i = 0; i < t.normals.length; i += 2) {
    const d = dx * t.normals[i] + dy * t.normals[i + 1];
    if (d > best) {
      best = d;
      k = i;
    }
  }
  reachEdge = k;
  return best;
}

// The share of a sample `px` wide, `d` from a band's center line, that a band `half` wide covers. Exact for
// straight bands, so a strap keeps its weight at any size, even thinner than a sample.
const cover = (d: number, half: number, px: number) =>
  clamp01((Math.min(d + px / 2, half) - Math.max(d - px / 2, -half)) / px);

// Distance from (qx, qy) to the ray from the origin along (dx, dy), up to `length` along it and without end
// behind it. Each strap through an edge midpoint is one of these: this tile's ray ahead, the neighbour's behind.
function strapDistance(
  qx: number,
  qy: number,
  dx: number,
  dy: number,
  length: number,
) {
  const t = Math.min(qx * dx + qy * dy, length);
  const ex = qx - t * dx;
  const ey = qy - t * dy;
  return Math.sqrt(ex * ex + ey * ey);
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const tiling = TILINGS[Math.floor(rand() * TILINGS.length)];
  const kinds = [...new Set(tiling.motif.map((m) => m.n))];
  // The contact angle, between each ray and its edge. Low angles give broad stars, high ones deep, thin points.
  const theta = (TAU / 360) * (52 + 16 * rand());
  const [s, c] = [sin(theta), cos(theta)];
  // Lattice cells across the art's short side, so the edge length in art units, where the short side is 1.
  const [l1, l2] = tiling.lattice;
  const period = Math.sqrt(l1[0] * l1[0] + l1[1] * l1[1]);
  const edge = 1 / ((1.25 + 1.1 * rand()) * period);
  // A tile's center sits at the art's center, the biggest tile's more often than not.
  const centered =
    tiling.motif[rand() < 0.5 ? 0 : Math.floor(rand() * tiling.motif.length)];
  const outlined = rand() < 0.5; // straps drawn as an outline round a lighter fill, or solid
  // A strap's half width, in edges. Outlined straps run wider, so their outlines and fill both read at desk size.
  const half = (0.035 + 0.03 * rand()) * (outlined ? 1.35 : 1);
  const rule = half * (0.34 + 0.1 * rand()); // the outline's width
  const interlaced = rand() < 0.65;
  const gap = half * (0.45 + 0.35 * rand()); // the break each over strap leaves in the one under it

  // Fills. The darkest ink draws the straps; stars and rosettes take paper, the other inks or tints of them.
  const base = rgb(paper);
  const ink = inks.map(rgb);
  const strap = ink[0];
  const fills: Rgb[] = [base];
  for (const k of ink.slice(1)) fills.push(k, mix(base, k, 0.4));
  const draws = fills.map(() => rand());
  const order = fills.map((_, i) => i).sort((i, j) => draws[i] - draws[j]);
  // The rosettes take the first fill, each star class one of the rest, so no star matches its rosettes.
  const rosette = fills[order[0]];
  const starFills = kinds.map(
    (_, i) => fills[order[1 + (i % (order.length - 1))]],
  );
  const strapFill = outlined
    ? mix(base, ink[ink.length - 1], 0.25 * rand())
    : strap;

  // The art in edge units, centered on the chosen tile.
  const unit = Math.min(width, height);
  const [hw, hh] = [width / unit / 2 / edge, height / unit / 2 / edge];
  const extent = Math.sqrt(hw * hw + hh * hh) + 2;
  const tiles: Tile[] = [];
  const rows = Math.ceil(extent / Math.min(Math.abs(l2[1]), period)) + 2;
  for (let j = -rows; j <= rows; j++)
    for (let i = -2 * rows; i <= 2 * rows; i++)
      for (const m of tiling.motif) {
        const x = m.x + i * l1[0] + j * l2[0] - centered.x;
        const y = m.y + i * l1[1] + j * l2[1] - centered.y;
        const ap = 0.5 * (cos(TAU / (2 * m.n)) / sin(TAU / (2 * m.n)));
        const radius = Math.sqrt(ap * ap + 0.25);
        if (Math.abs(x) > hw + radius || Math.abs(y) > hh + radius) continue;
        // In a tile's frame, with a along an edge's normal and b along the edge, each ray runs (-s, c) from the
        // midpoint (apothem, 0) until it meets the bisector of the corner at (apothem, 1/2).
        const length = 0.5 / (c + (0.5 * s) / ap);
        const normals = new Float64Array(2 * m.n);
        for (let k = 0; k < m.n; k++) {
          const a = TAU * (m.turn + k / m.n);
          normals[2 * k] = cos(a);
          normals[2 * k + 1] = sin(a);
        }
        const fill = starFills[kinds.indexOf(m.n)];
        tiles.push({ x, y, apothem: ap, radius, length, fill, normals });
      }
  // Larger tiles first, since they hold more of the art.
  tiles.sort((p, q) => q.apothem - p.apothem);

  // Bins half an edge square, each listing the tiles that could hold part of it, or the one that holds all of it.
  const BIN = 0.5;
  const cols = Math.ceil((2 * hw) / BIN) + 1;
  const binRows = Math.ceil((2 * hh) / BIN) + 1;
  const bins: Tile[][] = [];
  for (let j = 0; j < binRows; j++)
    for (let i = 0; i < cols; i++) {
      const [x0, y0] = [i * BIN - hw, j * BIN - hh];
      const near = tiles.filter((t) => {
        const dx = Math.max(x0 - t.x, 0, t.x - x0 - BIN);
        const dy = Math.max(y0 - t.y, 0, t.y - y0 - BIN);
        return dx * dx + dy * dy <= t.radius * t.radius;
      });
      const whole = near.find((t) =>
        [0, BIN].every((u) =>
          [0, BIN].every((v) => reach(t, x0 + u, y0 + v) <= t.apothem),
        ),
      );
      bins.push(whole ? [whole] : near);
    }

  // Samples per pixel side. The edges between fills run under the straps, so they never show while a strap is
  // wider than a sample. Desk draws, whose short side is about 200 px, need one sample; smaller ones get more.
  const n = Math.min(8, Math.ceil(192 / unit));
  const px = 1 / (unit * n * edge); // a sample's width in edges
  // Each sample's color adds into these, and `band` paints a strap over the sample's color in progress.
  let red = 0;
  let green = 0;
  let blue = 0;
  let cr = 0;
  let cg = 0;
  let cb = 0;
  function band(d: number) {
    const t = cover(d, half, px);
    if (t === 0) return;
    const f = outlined ? cover(d, half - rule, px) : 0;
    cr += (strap[0] + (strapFill[0] - strap[0]) * f - cr) * t;
    cg += (strap[1] + (strapFill[1] - strap[1]) * f - cg) * t;
    cb += (strap[2] + (strapFill[2] - strap[2]) * f - cb) * t;
  }

  // Adds the color at (x, y), in edges from the art's center.
  function sample(x: number, y: number) {
    const bin =
      bins[
        Math.min(binRows - 1, Math.max(0, Math.floor((y + hh) / BIN))) * cols +
          Math.min(cols - 1, Math.max(0, Math.floor((x + hw) / BIN)))
      ];
    // The tile holding the point, and the edge it faces: the one whose normal it reaches furthest along. A
    // point a rounding error outside every tile goes to the one it overshoots least.
    let tile = bin[0];
    let a = reach(tile, x, y);
    let edgeIndex = reachEdge;
    for (let i = 1; i < bin.length && a > tile.apothem; i++) {
      const best = reach(bin[i], x, y);
      if (best - bin[i].apothem < a - tile.apothem) {
        tile = bin[i];
        a = best;
        edgeIndex = reachEdge;
      }
    }
    // In the edge's frame: q is the point from the edge midpoint, b along the edge counterclockwise.
    const ux = tile.normals[edgeIndex];
    const uy = tile.normals[edgeIndex + 1];
    const b = -(x - tile.x) * uy + (y - tile.y) * ux;
    const qa = a - tile.apothem;
    // The two straps crossing at the midpoint: one leans forward along the edge, one back.
    const forward = strapDistance(qa, b, -s, c, tile.length);
    const back = strapDistance(qa, b, -s, -c, tile.length);
    const region = c * -qa > s * Math.abs(b) ? tile.fill : rosette;
    cr = region[0];
    cg = region[1];
    cb = region[2];
    if (interlaced) {
      // The forward strap passes over: the back one, then the break, then the forward one on top. Following a
      // strap, its crossings alternate, since it reaches each corner forward and leaves it back.
      band(back);
      const t = cover(forward, half + gap, px);
      cr += (region[0] - cr) * t;
      cg += (region[1] - cg) * t;
      cb += (region[2] - cb) * t;
      band(forward);
    } else band(Math.min(forward, back));
    red += cr;
    green += cg;
    blue += cb;
  }

  const image = ctx.createImageData(width, height);
  const data = image.data;
  const step = 1 / n;
  const scale = 1 / (unit * edge);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      red = green = blue = 0;
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++)
          sample(
            (x + (i + 0.5) * step - width / 2) * scale,
            (y + (j + 0.5) * step - height / 2) * scale,
          );
      const p = (y * width + x) * 4;
      data[p] = Math.round(red / (n * n));
      data[p + 1] = Math.round(green / (n * n));
      data[p + 2] = Math.round(blue / (n * n));
      data[p + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
}

export const girih1: Style = {
  id: "girih1",
  draw,
};
