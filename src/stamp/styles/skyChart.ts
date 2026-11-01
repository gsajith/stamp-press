import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Made-up sky chart: a planisphere of a sky that doesn't exist. Dark ink fills the sky, and stars print in the
// paper tone, sized by how bright they are. Graticule lines and a dotted ecliptic cross it, and three to six
// constellations join their stars by a minimum spanning tree plus one extra edge. The chart is a round disc, a
// strip or a half dome on a horizon, edged by a band of degree ticks, and some charts hold a comet, a nebula or
// a milky way. Hundreds of faint stars and the finest ticks only resolve in the detail view.
//
// Like land1, it computes every pixel itself from positions in scene units (the art's short side is 1), so it
// is resolution independent and its pixels match in every browser and in Node, which the golden test relies
// on (ADR 0001). Only IEEE-exact arithmetic here: no Math.sin, Math.pow or the like.

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
  let sum = 1;
  for (let k = 17; k > 1; k -= 2) sum = 1 - (y2 / (k * (k - 1))) * sum;
  return y * sum;
}
const cos = (x: number) => sin(x + TAU / 4);

// A float in [0, 1) for each lattice point, the "lowbias32" hash of its coordinates and a salt.
function hash2(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ salt;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Smooth 2D value noise in [0, 1], one lattice cell per unit.
function noise2(x: number, y: number, salt: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, salt);
  const b = hash2(ix + 1, iy, salt);
  const c = hash2(ix, iy + 1, salt);
  const d = hash2(ix + 1, iy + 1, salt);
  const top = a + (b - a) * sx;
  return top + (c + (d - c) * sx - top) * sy;
}

// The share of a pixel-wide cell that a line `half` wide covers when the cell's center sits `d` from its middle,
// both in pixels. Exact for straight lines, so a line keeps its weight at any size, even thinner than a pixel.
const cover = (d: number, half: number) =>
  clamp01(Math.min(d + 0.5, half) - Math.max(d - 0.5, -half));

// Something printed at a spot: a disc (a star or an ecliptic dot) or a straight line (a constellation line, a
// graticule spoke, a tick), in scene units.
type Mark = {
  disc: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  // A disc's radius or a line's half width.
  size: number;
  color: Rgb;
  // Whether it prints in front of the ground, rather than behind it with the sky.
  front: boolean;
};

const disc = (x: number, y: number, r: number, color: Rgb): Mark => ({
  disc: true,
  x1: x,
  y1: y,
  x2: x,
  y2: y,
  size: r,
  color,
  front: false,
});
const line = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  half: number,
  color: Rgb,
  front = false,
): Mark => ({ disc: false, x1, y1, x2, y2, size: half, color, front });

// Distance from (x, y) to a mark's center point or line.
function distance({ x1, y1, x2, y2 }: Mark, x: number, y: number): number {
  const [dx, dy] = [x2 - x1, y2 - y1];
  const length2 = dx * dx + dy * dy;
  const t =
    length2 > 0 ? clamp01(((x - x1) * dx + (y - y1) * dy) / length2) : 0;
  const [ex, ey] = [x - x1 - t * dx, y - y1 - t * dy];
  return Math.sqrt(ex * ex + ey * ey);
}

// How much of a pixel `px` wide at (x, y) a line mark covers: the share of the pixel across the line it covers,
// times the share along it. Its ends are square, so a tick shorter than a pixel keeps its true weight.
function lineCover(
  { x1, y1, x2, y2, size }: Mark,
  x: number,
  y: number,
  px: number,
): number {
  const [dx, dy] = [x2 - x1, y2 - y1];
  const length = Math.sqrt(dx * dx + dy * dy);
  const along = ((x - x1) * dx + (y - y1) * dy) / length / px;
  const across = ((y - y1) * dx - (x - x1) * dy) / length / px;
  const end = length / px;
  return (
    cover(Math.abs(across), size / px) *
    clamp01(Math.min(along + 0.5, end) - Math.max(along - 0.5, 0))
  );
}

// The shape of a chart: where its sky, its rim band of ticks and any ground below a horizon sit, and the lines
// and marks that belong to the shape rather than to the stars.
type Chart = {
  // How far a point is inside the sky, and inside the dark ink (the sky and its rim), in scene units: positive
  // inside, negative outside.
  sky(x: number, y: number): number;
  ink(x: number, y: number): number;
  // How far a point is into the ground in front of the chart, when it has any.
  ground?(x: number, y: number): number;
  // How far a point is into a nearer ridge of darker hills, when it has one.
  near?(x: number, y: number): number;
  // How much of a pixel `px` wide the graticule's rings or grid lines cover, and the paper keylines along the
  // sky's and rim's edges.
  graticule(x: number, y: number, px: number): number;
  keylines(x: number, y: number, px: number): number;
  // Spokes, ticks and the ecliptic's dots.
  marks: Mark[];
  // Where the chart's middle is.
  middle: [number, number];
};

type Inks = { grid: Rgb; accent: Rgb; paper: Rgb; ground: Rgb };

const GRID_HALF = 0.0008;
const KEY_HALF = 0.0011;
const TICK_HALF = 0.0006;
const DOT_R = 0.0022;

// Dots along a circle, every `gap` or so, where they fall in the sky.
function circleDots(
  cx: number,
  cy: number,
  radius: number,
  gap: number,
  inSky: (x: number, y: number) => boolean,
  color: Rgb,
): Mark[] {
  const count = Math.round((TAU * radius) / gap);
  const dots: Mark[] = [];
  for (let k = 0; k < count; k++) {
    const a = (TAU * k) / count;
    const [x, y] = [cx + radius * cos(a), cy + radius * sin(a)];
    if (inSky(x, y)) dots.push(disc(x, y, DOT_R, color));
  }
  return dots;
}

// Degree ticks standing out from radius `from` toward `to`, one per degree from angle `start` for `degrees`,
// longer every 5 and 10. Angles turn from +x toward -y, so a half dome's arc runs over the top.
function arcTicks(
  cx: number,
  cy: number,
  from: number,
  to: number,
  start: number,
  degrees: number,
  color: Rgb,
): Mark[] {
  const ticks: Mark[] = [];
  for (let k = 0; k <= degrees; k++) {
    const a = start + (TAU * k) / 360;
    const length = (to - from) * (k % 10 === 0 ? 0.7 : k % 5 === 0 ? 0.5 : 0.3);
    const [c, s] = [cos(a), -sin(a)];
    ticks.push(
      line(
        cx + from * c,
        cy + from * s,
        cx + (from + length) * c,
        cy + (from + length) * s,
        TICK_HALF,
        color,
      ),
    );
  }
  return ticks;
}

// How much of a pixel `px` wide at radius `r` the graticule's rings cover: rings `spacing` apart round the
// chart's middle, up to but not including radius `last`.
function rings(r: number, spacing: number, last: number, px: number): number {
  const k = Math.round(r / spacing);
  if (k < 1 || k * spacing > last - spacing / 2) return 0;
  return cover((r - k * spacing) / px, GRID_HALF / px);
}

// A round planisphere: a disc of sky in a band of ticks.
function roundChart(
  rand: () => number,
  W: number,
  H: number,
  { grid, accent, paper }: Inks,
): Chart {
  const [cx, cy] = [W / 2, H / 2];
  const outer = 0.47;
  const band = 0.03 + 0.014 * rand();
  const R = outer - band;
  const spacing = R / (3 + Math.floor(rand() * 3));
  const spokes = [12, 16, 24][Math.floor(rand() * 3)];
  const radius = (x: number, y: number) =>
    Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
  const sky = (x: number, y: number) => R - radius(x, y);
  const marks: Mark[] = [];
  // Spokes start at the first ring, but four reach the middle and cross there.
  for (let k = 0; k < spokes; k++) {
    const a = (TAU * k) / spokes;
    const from = k % (spokes / 4) === 0 ? 0 : spacing;
    const [c, s] = [cos(a), sin(a)];
    marks.push(
      line(
        cx + from * c,
        cy + from * s,
        cx + R * c,
        cy + R * s,
        GRID_HALF,
        grid,
      ),
    );
  }
  // The ecliptic: a great circle, which projects to a circle off the middle.
  const off = R * (0.12 + 0.18 * rand());
  const tilt = TAU * rand();
  marks.push(
    ...circleDots(
      cx + off * cos(tilt),
      cy + off * sin(tilt),
      R * (0.55 + 0.2 * rand()),
      0.012 + 0.006 * rand(),
      (x, y) => sky(x, y) > 0.008,
      accent,
    ),
  );
  marks.push(...arcTicks(cx, cy, R, outer, 0, 359, paper));
  return {
    sky,
    ink: (x, y) => outer - radius(x, y),
    graticule: (x, y, px) => rings(radius(x, y), spacing, R, px),
    keylines: (x, y, px) => {
      const r = radius(x, y);
      return Math.max(
        cover((r - R) / px, KEY_HALF / px),
        cover((r - outer + 0.004) / px, KEY_HALF / px),
      );
    },
    marks,
    middle: [cx, cy],
  };
}

// A strip map: the sky laid out flat between two bands of ticks, its graticule a square grid.
function stripChart(
  rand: () => number,
  W: number,
  H: number,
  { accent, paper }: Inks,
): Chart {
  const band = 0.045 + 0.02 * rand();
  const [top, bottom] = [band, H - band];
  const columns = 4 + Math.floor(rand() * 4);
  const rows = 3 + Math.floor(rand() * 3);
  const [gx, gy] = [W / columns, (bottom - top) / rows];
  const sky = (_x: number, y: number) => Math.min(y - top, bottom - y);
  const marks: Mark[] = [];
  // The ecliptic: one wave of a sine across the strip.
  const amp = (bottom - top) * (0.22 + 0.12 * rand());
  const phase = TAU * rand();
  const gap = 0.012 + 0.006 * rand();
  const count = Math.round(W / gap);
  for (let k = 0; k <= count; k++) {
    const x = (k * W) / count;
    const y = H / 2 + amp * sin((TAU * x) / W + phase);
    marks.push(disc(x, y, DOT_R, accent));
  }
  // Ticks stand out of the sky into both bands, longer every 5 and 10.
  const ticks = Math.round(W / 0.009);
  for (let k = 1; k < ticks; k++) {
    const x = (k * W) / ticks;
    const length = band * (k % 10 === 0 ? 0.7 : k % 5 === 0 ? 0.5 : 0.3);
    marks.push(line(x, top, x, top - length, TICK_HALF, paper));
    marks.push(line(x, bottom, x, bottom + length, TICK_HALF, paper));
  }
  // Grid lines, k gaps in from `start`, but not along the edges.
  const along = (t: number, gap: number, count: number, px: number) => {
    const k = Math.round(t / gap);
    return k < 1 || k >= count ? 0 : cover((t - k * gap) / px, GRID_HALF / px);
  };
  return {
    sky,
    ink: () => 1,
    graticule: (x, y, px) =>
      Math.max(along(x, gx, columns, px), along(y - top, gy, rows, px)),
    keylines: (_x, y, px) =>
      Math.max(
        cover((y - top) / px, KEY_HALF / px),
        cover((y - bottom) / px, KEY_HALF / px),
      ),
    marks,
    middle: [W / 2, H / 2],
  };
}

// Half a planisphere standing on a horizon, with hills in front of it printed in a second ink. A tall stamp
// keeps the dome near its top, and a nearer ridge of hills, darker, fills the deeper ground.
function domeChart(
  rand: () => number,
  W: number,
  H: number,
  { grid, accent, paper }: Inks,
): Chart {
  const band = 0.03 + 0.012 * rand();
  const widest = W / 2 - 0.035;
  // A third or so of the height the dome and the least ground leave spare goes above the dome.
  const spare = H - 0.13 - widest - 0.035;
  const horizon = Math.min(
    H - 0.13,
    widest + 0.075 + spare * (0.25 + 0.15 * rand()),
  );
  const outer = Math.min(widest, horizon - 0.035);
  const R = outer - band;
  const cx = W / 2;
  const spacing = R / (3 + Math.floor(rand() * 3));
  const spokes = [6, 8, 12][Math.floor(rand() * 3)];
  const hills = 0.03 + 0.04 * rand();
  const hillSalt = Math.floor(rand() * 2 ** 32);
  const ridge = (x: number, salt: number) =>
    0.25 + 0.5 * noise2(x * 3, 0.5, salt) + 0.25 * noise2(x * 9, 0.5, salt + 1);
  const deep = H - horizon > 0.3;
  const nearTop = horizon + (H - horizon) * 0.5;
  const radius = (x: number, y: number) =>
    Math.sqrt((x - cx) * (x - cx) + (y - horizon) * (y - horizon));
  const sky = (x: number, y: number) => Math.min(R - radius(x, y), horizon - y);
  const marks: Mark[] = [];
  for (let k = 1; k < spokes; k++) {
    const a = (TAU * k) / (2 * spokes);
    const [c, s] = [cos(a), -sin(a)];
    marks.push(
      line(
        cx + spacing * c,
        horizon + spacing * s,
        cx + R * c,
        horizon + R * s,
        GRID_HALF,
        grid,
      ),
    );
  }
  // The ecliptic rises out of the horizon and sets back into it.
  const ecliptic = R * (0.6 + 0.25 * rand());
  marks.push(
    ...circleDots(
      cx + R * (0.4 * rand() - 0.2),
      horizon + ecliptic * (0.15 + 0.3 * rand()),
      ecliptic,
      0.012 + 0.006 * rand(),
      (x, y) => sky(x, y) > 0.008,
      accent,
    ),
  );
  marks.push(...arcTicks(cx, horizon, R, outer, 0, 180, paper));
  // Compass ticks hang into the ground, every 10 degrees of the dome's width.
  for (let k = 0; k <= 18; k++) {
    const x = cx + outer * (k / 9 - 1);
    const length = k % 9 === 0 ? 0.035 : k % 3 === 0 ? 0.024 : 0.014;
    marks.push(
      line(
        x,
        horizon + 0.012,
        x,
        horizon + 0.012 + length,
        TICK_HALF * 1.4,
        paper,
        true,
      ),
    );
  }
  return {
    sky,
    ink: (x, y) => outer - radius(x, y),
    // Rolling hills along the horizon, two octaves of noise. Gentle enough that the height above them stands in
    // for the distance to them.
    ground: (x, y) => y - horizon + hills * ridge(x, hillSalt),
    near: deep
      ? (x, y) =>
          y < nearTop - 0.08 ? -1 : y - nearTop + 0.08 * ridge(x, hillSalt + 2)
      : undefined,
    graticule: (x, y, px) => rings(radius(x, y), spacing, R, px),
    keylines: (x, y, px) => {
      if (y > horizon) return 0;
      const r = radius(x, y);
      return Math.max(
        cover((r - R) / px, KEY_HALF / px),
        cover((r - outer + 0.004) / px, KEY_HALF / px),
      );
    },
    marks,
    middle: [cx, horizon - R / 2],
  };
}

const sq = (dx: number, dy: number) => dx * dx + dy * dy;

// Pick an integer in [lo, hi].
const int = (rand: () => number, lo: number, hi: number) =>
  lo + Math.floor(rand() * (hi - lo + 1));

// The edges of a minimum spanning tree over `points` (Prim's), plus the shortest other edge that crosses none
// of them, which closes one loop as real constellation figures often do.
function figure(points: [number, number][]): [number, number][] {
  const n = points.length;
  const d = (i: number, j: number) => {
    const [dx, dy] = [points[i][0] - points[j][0], points[i][1] - points[j][1]];
    return dx * dx + dy * dy;
  };
  const edges: [number, number][] = [];
  const inTree = [true, ...Array<boolean>(n - 1).fill(false)];
  for (let added = 1; added < n; added++) {
    let best: [number, number] = [0, 0];
    let bestD = Infinity;
    for (let i = 0; i < n; i++)
      if (inTree[i])
        for (let j = 0; j < n; j++)
          if (!inTree[j] && d(i, j) < bestD) [best, bestD] = [[i, j], d(i, j)];
    inTree[best[1]] = true;
    edges.push(best);
  }
  // Whether segments ab and cd properly cross.
  const side = (a: number, b: number, c: number) =>
    (points[b][0] - points[a][0]) * (points[c][1] - points[a][1]) -
    (points[b][1] - points[a][1]) * (points[c][0] - points[a][0]);
  const crosses = ([a, b]: [number, number], [c, e]: [number, number]) =>
    a !== c &&
    a !== e &&
    b !== c &&
    b !== e &&
    side(a, b, c) * side(a, b, e) < 0 &&
    side(c, e, a) * side(c, e, b) < 0;
  let extra: [number, number] | null = null;
  let extraD = Infinity;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const edge: [number, number] = [i, j];
      if (
        d(i, j) < extraD &&
        !edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i)) &&
        !edges.some((e) => crosses(e, edge))
      )
        [extra, extraD] = [edge, d(i, j)];
    }
  return extra ? [...edges, extra] : edges;
}

// The marks are filed in a grid of square cells this wide, so each pixel tests only the marks near it.
const CELL = 1 / 24;

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const salt = () => Math.floor(rand() * 2 ** 32);
  const unit = Math.min(width, height);
  const px = 1 / unit;
  const [W, H] = [width / unit, height / unit];

  const paperRgb = rgb(paper);
  const ink = inks.map(rgb);
  const dark = ink[0];
  const accent = ink[ink.length - 1];
  const middleInk = ink.length > 2 ? ink[1] : paperRgb;
  const chartInks: Inks = {
    grid: mix(dark, middleInk, 0.45),
    accent,
    paper: paperRgb,
    ground: ink.length > 2 ? ink[1] : mix(dark, accent, 0.45),
  };
  // Outside the chart, the paper takes a pale wash of the accent ink.
  const outside = mix(paperRgb, accent, 0.12);

  const kind = rand();
  const chart =
    kind < 0.45
      ? roundChart(rand, W, H, chartInks)
      : kind < 0.75
        ? domeChart(rand, W, H, chartInks)
        : stripChart(rand, W, H, chartInks);

  // A random point at least `margin` inside the sky.
  const point = (margin: number): [number, number] => {
    for (let i = 0; i < 40; i++) {
      const [x, y] = [W * rand(), H * rand()];
      if (chart.sky(x, y) > margin && (chart.ground?.(x, y) ?? -1) < -margin)
        return [x, y];
    }
    return chart.middle;
  };

  // Which of a comet, a nebula or neither the chart holds.
  const extra = rand();
  const marks: Mark[] = [...chart.marks];

  // The milky way: a band of faint glow and crowded faint stars across the sky.
  const milky = rand() < 0.5;
  const [mx, my] = point(0.05);
  const ma = TAU * rand();
  const [mdx, mdy] = [cos(ma), sin(ma)];
  const milkyWidth = 0.05 + 0.04 * rand();
  const [milkySalt, nebulaSalt] = [salt(), salt()];

  // Constellations first, so their lines print under every star.
  const figures = int(rand, 3, 6);
  const centers: [number, number][] = [];
  for (let f = 0; f < figures; f++) {
    let center = point(0.06);
    for (let i = 0; i < 12; i++) {
      if (centers.every(([x, y]) => sq(x - center[0], y - center[1]) > 0.04))
        break;
      center = point(0.06);
    }
    centers.push(center);
    const spread = 0.07 + 0.06 * rand();
    const count = int(rand, 4, 9);
    const stars: [number, number][] = [];
    const radii: number[] = [];
    for (let i = 0; i < 30 && stars.length < count; i++) {
      const x = center[0] + spread * (rand() + rand() - 1);
      const y = center[1] + spread * (rand() + rand() - 1);
      if (chart.sky(x, y) < 0.015) continue;
      if (stars.some(([sx, sy]) => sq(sx - x, sy - y) < 0.03 * 0.03)) continue;
      stars.push([x, y]);
      radii.push(0.003 + 0.0055 * rand() * rand());
    }
    if (stars.length < 2) continue;
    const half = 0.0011 + 0.0006 * rand();
    // Lines stop short of their stars.
    for (const [i, j] of figure(stars)) {
      const [[x1, y1], [x2, y2]] = [stars[i], stars[j]];
      const length = Math.sqrt(sq(x2 - x1, y2 - y1));
      const [a, b] = [radii[i] + 0.004, radii[j] + 0.004];
      if (length - a - b < 0.006) continue;
      const [ux, uy] = [(x2 - x1) / length, (y2 - y1) / length];
      marks.push(
        line(x1 + a * ux, y1 + a * uy, x2 - b * ux, y2 - b * uy, half, accent),
      );
    }
    for (let i = 0; i < stars.length; i++)
      marks.push(disc(stars[i][0], stars[i][1], radii[i], paperRgb));
  }

  // Field stars, mostly dim, a few bright. The brightest glint with a cross of thin rays.
  const field = int(rand, 90, 170);
  for (let i = 0; i < field; i++) {
    const [x, y] = point(0.006);
    const u = rand();
    const r = 0.0018 + 0.0075 * u * u * u * u;
    marks.push(disc(x, y, r, paperRgb));
    if (r > 0.0068) {
      const ray = 2.8 * r;
      marks.push(line(x - ray, y, x + ray, y, TICK_HALF, paperRgb));
      marks.push(line(x, y - ray, x, y + ray, TICK_HALF, paperRgb));
    }
  }
  // Faint stars, too small to see at desk size, crowding into the milky way when there is one.
  const faint = int(rand, 400, 800);
  for (let i = 0; i < faint; i++) {
    let [x, y] = point(0.004);
    if (milky && rand() < 0.6) {
      const along = 1.6 * (rand() - 0.5);
      const across = milkyWidth * (rand() + rand() + rand() - 1.5);
      [x, y] = [
        mx + along * mdx - across * mdy,
        my + along * mdy + across * mdx,
      ];
      if (chart.sky(x, y) < 0.004) continue;
    }
    marks.push(disc(x, y, 0.0005 + 0.0007 * rand(), paperRgb));
  }

  // A comet's head and its tail fanning away from it, or a nebula's glow, or neither.
  const comet = extra < 0.35;
  const nebula = extra >= 0.35 && extra < 0.7;
  const [hx, hy] = point(0.08);
  const [tx0, ty0] = [chart.middle[0] - hx, chart.middle[1] - hy];
  const turn = TAU * (rand() - 0.5) * 0.25;
  const tl = Math.sqrt(tx0 * tx0 + ty0 * ty0) || 1;
  const [ct, st] = [cos(turn), sin(turn)];
  const [tx, ty] = [(tx0 * ct - ty0 * st) / tl, (tx0 * st + ty0 * ct) / tl];
  const tail = 0.12 + 0.1 * rand();
  const tailWide = 0.025 + 0.02 * rand();
  if (comet) marks.push(disc(hx, hy, 0.0065, paperRgb));
  const nebulaR = 0.08 + 0.06 * rand();
  const nebulaInk = ink.length > 2 ? ink[1] : accent;
  const nearInk = mix(chartInks.ground, dark, 0.5);

  // File the marks in the grid. A mark reaches as far as its size, softened to at least a pixel, and a pixel.
  const [cols, rows] = [Math.ceil(W / CELL), Math.ceil(H / CELL)];
  const cells: Mark[][] = Array.from({ length: cols * rows }, () => []);
  const corner = CELL * 0.7072;
  for (const mark of marks) {
    const reach = Math.max(mark.size, px) + px;
    const x0 = Math.max(
      0,
      Math.floor((Math.min(mark.x1, mark.x2) - reach) / CELL),
    );
    const x1 = Math.min(
      cols - 1,
      Math.floor((Math.max(mark.x1, mark.x2) + reach) / CELL),
    );
    const y0 = Math.max(
      0,
      Math.floor((Math.min(mark.y1, mark.y2) - reach) / CELL),
    );
    const y1 = Math.min(
      rows - 1,
      Math.floor((Math.max(mark.y1, mark.y2) + reach) / CELL),
    );
    for (let j = y0; j <= y1; j++)
      for (let i = x0; i <= x1; i++)
        if (distance(mark, (i + 0.5) * CELL, (j + 0.5) * CELL) < corner + reach)
          cells[j * cols + i].push(mark);
  }

  const image = ctx.createImageData(width, height);
  const data = image.data;
  // The pixel's color so far, which each layer below prints over.
  const color = new Float64Array(3);
  const over = (c: Rgb, t: number) => {
    if (t <= 0) return;
    color[0] += (c[0] - color[0]) * t;
    color[1] += (c[1] - color[1]) * t;
    color[2] += (c[2] - color[2]) * t;
  };
  // Prints the marks in a cell at (x, y), those in front of the ground or those behind it.
  const printMarks = (cell: Mark[], x: number, y: number, front: boolean) => {
    for (const mark of cell) {
      if (mark.front !== front) continue;
      // A mark further than it reaches past its ends on either axis misses the pixel, which rules out most
      // marks cheaply.
      const reach = Math.max(mark.size, px) + px;
      if (
        x < Math.min(mark.x1, mark.x2) - reach ||
        x > Math.max(mark.x1, mark.x2) + reach ||
        y < Math.min(mark.y1, mark.y2) - reach ||
        y > Math.max(mark.y1, mark.y2) + reach
      )
        continue;
      if (mark.disc) {
        const d = distance(mark, x, y) / px;
        const size = mark.size / px;
        // The disc's edge ramps over a pixel, which prints pi * (R * R + 1 / 12) square pixels of ink in all.
        // Scaling by its true area keeps its weight, so a disc smaller than a pixel prints fainter, not bigger.
        const R = Math.max(size, 0.5);
        if (d < R + 0.5)
          over(
            mark.color,
            ((size * size) / (R * R + 1 / 12)) * clamp01(R - d + 0.5),
          );
      } else over(mark.color, lineCover(mark, x, y, px));
    }
  };
  for (let py = 0; py < height; py++)
    for (let pxi = 0; pxi < width; pxi++) {
      const x = (pxi + 0.5) * px;
      const y = (py + 0.5) * px;
      color.set(outside);
      over(dark, clamp01(chart.ink(x, y) / px + 0.5));
      const inSky = clamp01(chart.sky(x, y) / px + 0.5);
      if (inSky > 0) {
        if (milky) {
          const across = (x - mx) * -mdy + (y - my) * mdx;
          const t = clamp01(
            1 - (across * across) / (4 * milkyWidth * milkyWidth),
          );
          if (t > 0)
            over(
              paperRgb,
              inSky * 0.13 * t * t * (0.5 + noise2(x * 9, y * 9, milkySalt)),
            );
        }
        if (nebula) {
          const [dx, dy] = [x - hx, y - hy];
          const t = clamp01(1 - (dx * dx + dy * dy) / (nebulaR * nebulaR));
          if (t > 0) {
            const n =
              0.6 * noise2(x * 14, y * 14, nebulaSalt) +
              0.4 * noise2(x * 31, y * 31, nebulaSalt + 1);
            const density = t * t * clamp01((n - 0.25) * 1.6);
            over(nebulaInk, inSky * 0.75 * density);
            over(paperRgb, inSky * 0.35 * density * density);
          }
        }
        if (comet) {
          const dx = x - hx;
          const dy = y - hy;
          const u = dx * tx + dy * ty;
          const v = dy * tx - dx * ty;
          // The coma round the head, then the tail, widening and fading.
          const coma = clamp01(1 - (dx * dx + dy * dy) / (0.02 * 0.02));
          let glow = 0.55 * coma * coma;
          if (u > 0 && u < tail) {
            const w = 0.006 + (tailWide - 0.006) * (u / tail);
            const across = clamp01(1 - (v * v) / (w * w));
            const fade = 1 - u / tail;
            glow = Math.max(glow, 0.8 * fade * fade * across);
          }
          over(paperRgb, inSky * glow);
        }
        over(chartInks.grid, inSky * chart.graticule(x, y, px));
      }
      over(paperRgb, chart.keylines(x, y, px));
      const cell =
        cells[
          Math.min(rows - 1, Math.floor(y / CELL)) * cols +
            Math.min(cols - 1, Math.floor(x / CELL))
        ];
      printMarks(cell, x, y, false);
      if (chart.ground) {
        over(chartInks.ground, clamp01(chart.ground(x, y) / px + 0.5));
        if (chart.near) over(nearInk, clamp01(chart.near(x, y) / px + 0.5));
        printMarks(cell, x, y, true);
      }
      const p = (py * width + pxi) * 4;
      data[p] = Math.round(color[0]);
      data[p + 1] = Math.round(color[1]);
      data[p + 2] = Math.round(color[2]);
      data[p + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
}

export const skyChart1: Style = {
  id: "stars1",
  draw,
};
