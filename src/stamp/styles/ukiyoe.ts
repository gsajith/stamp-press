import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Ukiyo-e woodblock view, after Hokusai's and Hiroshige's series of views: a snow-capped peak, a curling wave,
// pines under the moon, or a red bridge over a river, under a bokashi sky that fades from ink to bare paper.
// Each color prints from its own block, a little off register from the keyblock, which prints the outlines in
// the darkest ink. Large flats show the wood's grain. A cartouche names the view and numbers it in the series.
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
const smooth = (t: number) => t * t * (3 - 2 * t);

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
  const sx = smooth(x - ix);
  const sy = smooth(y - iy);
  const a = hash2(ix, iy, salt);
  const b = hash2(ix + 1, iy, salt);
  const c = hash2(ix, iy + 1, salt);
  const d = hash2(ix + 1, iy + 1, salt);
  const top = a + (b - a) * sx;
  return top + (c + (d - c) * sx - top) * sy;
}

// Smooth 1D value noise in [0, 1], three octaves, from a table of seeded values.
function ridgeNoise(rand: () => number): (x: number) => number {
  const table = Array.from({ length: 64 }, rand);
  const at = (x: number) => {
    const i = Math.floor(x);
    const a = table[i & 63];
    return a + (table[(i + 1) & 63] - a) * smooth(x - i);
  };
  return (x) => (at(x) * 4 + at(x * 2 + 17) * 2 + at(x * 4 + 31)) / 7;
}

// The share of a sample, 1 wide, that a line `half` wide covers when the sample's center sits `d` from the
// line's middle, all in samples. Exact for straight lines, so a line keeps its weight at any size.
const cover = (d: number, half: number) =>
  clamp01(Math.min(d + 0.5, half) - Math.max(d - 0.5, -half));

// How much of a sample a set of parallel lines covers, lines at phi = (k + 0.5) * gap, each `half` of the gap
// wide on either side. `px` is the sample's size in the units of phi. Lines closer than a sample fade to their
// average cover, so they shade rather than alias.
function hatch(phi: number, gap: number, px: number, half: number): number {
  const mean = 2 * half;
  const fine = clamp01(gap / px - 1);
  if (fine === 0) return mean;
  const t = phi / gap;
  const d = (t - Math.floor(t) - 0.5) * gap;
  const exact = cover(d / px, (half * gap) / px);
  return mean + (exact - mean) * fine;
}

// The integral from 0 to `u` of a triangle wave that rises from 0 to 1 and back over each unit, so the wave can
// be averaged over a sample exactly.
function triSum(u: number): number {
  const k = Math.floor(u);
  const f = u - k;
  return k * 0.5 + (f < 0.5 ? f * f : 2 * f - f * f - 0.5);
}

// Thick segments, each [ax, ay, bx, by, radius], as one shape: its signed distance, positive inside. Segments
// further than `far` beyond their own bounds are skipped, so the distance is only right within `far` of the
// shape, which is all the drawing needs.
function strokes(list: readonly (readonly number[])[], far: number) {
  const s = Float64Array.from(list.flat());
  return (x: number, y: number) => {
    let d = -1e9;
    for (let i = 0; i < s.length; i += 5) {
      const ax = s[i];
      const ay = s[i + 1];
      const bx = s[i + 2];
      const by = s[i + 3];
      const m = s[i + 4] + far;
      if (
        x < (ax < bx ? ax : bx) - m ||
        x > (ax < bx ? bx : ax) + m ||
        y < (ay < by ? ay : by) - m ||
        y > (ay < by ? by : ay) + m
      )
        continue;
      const dx = bx - ax;
      const dy = by - ay;
      const t = clamp01(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy));
      const ex = x - ax - dx * t;
      const ey = y - ay - dy * t;
      const e = s[i + 4] - Math.sqrt(ex * ex + ey * ey);
      if (e > d) d = e;
    }
    return d;
  };
}

// Strokes of the numerals one to ten, as segments in a glyph's unit square, y down, so the cartouche can number
// the view in the series.
const NUMERALS: readonly (readonly (readonly number[])[])[] = [
  [[0.1, 0.5, 0.9, 0.5]],
  [
    [0.22, 0.3, 0.78, 0.3],
    [0.1, 0.75, 0.9, 0.75],
  ],
  [
    [0.22, 0.18, 0.78, 0.18],
    [0.3, 0.5, 0.7, 0.5],
    [0.1, 0.84, 0.9, 0.84],
  ],
  [
    [0.14, 0.18, 0.14, 0.86],
    [0.14, 0.18, 0.86, 0.18],
    [0.86, 0.18, 0.86, 0.86],
    [0.14, 0.86, 0.86, 0.86],
    [0.42, 0.18, 0.32, 0.6],
    [0.6, 0.18, 0.6, 0.56],
    [0.6, 0.56, 0.76, 0.6],
  ],
  [
    [0.16, 0.16, 0.84, 0.16],
    [0.48, 0.16, 0.38, 0.86],
    [0.26, 0.48, 0.74, 0.48],
    [0.74, 0.48, 0.7, 0.86],
    [0.08, 0.86, 0.92, 0.86],
  ],
  [
    [0.48, 0.06, 0.56, 0.2],
    [0.1, 0.34, 0.9, 0.34],
    [0.38, 0.5, 0.16, 0.86],
    [0.62, 0.5, 0.86, 0.84],
  ],
  [
    [0.1, 0.46, 0.9, 0.36],
    [0.4, 0.1, 0.4, 0.8],
    [0.4, 0.8, 0.88, 0.84],
  ],
  [
    [0.42, 0.2, 0.12, 0.84],
    [0.58, 0.24, 0.9, 0.84],
  ],
  [
    [0.46, 0.08, 0.42, 0.44],
    [0.42, 0.44, 0.12, 0.88],
    [0.14, 0.34, 0.7, 0.34],
    [0.7, 0.34, 0.68, 0.84],
    [0.68, 0.84, 0.92, 0.82],
    [0.92, 0.82, 0.92, 0.7],
  ],
  [
    [0.1, 0.46, 0.9, 0.46],
    [0.5, 0.08, 0.5, 0.92],
  ],
];

// The glyphs that write `n`, from 1 to 99, as numerals: 23 is two, ten, three.
function numeralGlyphs(n: number): number[] {
  const [tens, ones] = [Math.floor(n / 10), n % 10];
  const glyphs = tens > 1 ? [tens - 1, 9] : tens === 1 ? [9] : [];
  return ones > 0 ? [...glyphs, ones - 1] : glyphs;
}

// Strokes of a made-up character, a few lines across a glyph's unit square: the cartouche's title.
function madeUpGlyph(rand: () => number): number[][] {
  const at = [0.15, 0.5, 0.85];
  const strokes: number[][] = [];
  if (rand() < 0.3) {
    // A box, like the radical for mouth, on one side.
    const [x0, x1] = rand() < 0.5 ? [0.1, 0.42] : [0.58, 0.9];
    strokes.push(
      [x0, 0.3, x1, 0.3],
      [x0, 0.3, x0, 0.7],
      [x1, 0.3, x1, 0.7],
      [x0, 0.7, x1, 0.7],
    );
  }
  for (let n = 2 + Math.floor(rand() * 3); n > 0; n--) {
    const kind = rand();
    const [a, b] = [at[Math.floor(rand() * 3)], 0.1 + 0.3 * rand()];
    if (kind < 0.4) strokes.push([b, a, 1 - b * 0.6, a]);
    else if (kind < 0.75) strokes.push([a, b, a, 1 - b * 0.4]);
    else if (kind < 0.88) strokes.push([0.5, 0.15, 0.1 + 0.2 * rand(), 0.88]);
    else strokes.push([0.5, 0.4, 0.92, 0.88]);
  }
  return strokes;
}

// One woodblock's print: a shape given by its signed distance in scene units, positive inside, filled with a
// color that can fade down the shape. Blocks print back to front.
type Block = {
  // `col` is the sample column of x, which heightfields look their tops up by.
  sd: (x: number, y: number, col: number) => number;
  // Bounds outside which the shape is empty, [x0, y0, x1, y1].
  box: readonly [number, number, number, number];
  color: Rgb;
  // A second color the fill fades to between `fade[0]` and `fade[1]` down the art.
  color2?: Rgb;
  fade?: readonly [number, number];
  alpha?: number;
  // How far this block prints from the keyblock, in scene units.
  shift?: readonly [number, number];
  // Whether the keyblock outlines it.
  outline?: boolean;
  // Whether the wood's grain shows in it.
  grain?: boolean;
  // Lines carved in the keyblock inside the shape, as how much of a sample they cover there.
  texture?: (x: number, y: number, sd: number, col: number) => number;
};

// Small draws are supersampled until the art's short side has this many samples, so detail finer than a pixel
// averages out the way it would in a large draw scaled down.
const MIN_UNIT = 96;
// The keyblock's outline, half its width.
const LINE = 0.0022;
// How far a color block prints from the keyblock at most, in either direction.
const SHIFT = 0.004;
// How strongly the grain shows in flats, and its rings per unit across the grain.
const GRAIN = 0.2;
const GRAIN_FREQ = 70;
const INF = 1e9;

type Motif = "peak" | "wave" | "pines" | "bridge";
const MOTIFS: readonly Motif[] = ["peak", "wave", "pines", "bridge"];

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const range = (a: number, b: number) => a + (b - a) * rand();
  const chance = (p: number) => rand() < p;
  const salt = () => Math.floor(rand() * 2 ** 32);
  const shift = () => [range(-SHIFT, SHIFT), range(-SHIFT, SHIFT)] as const;

  // The keyblock prints in the darkest ink. Sky and water take the bluest ink, the bridge and the sun the
  // warmest, and hills and pines whichever is left.
  const paperRgb = rgb(paper);
  const all = inks.map(rgb);
  const key = all[0];
  const warmth = (c: Rgb) => c[0] - c[2];
  const rest = all.slice(1);
  const warm = rest.reduce((a, b) => (warmth(b) > warmth(a) ? b : a));
  const cool = all.reduce((a, b) => (warmth(b) < warmth(a) ? b : a));
  const third =
    rest.find((c) => c !== warm && c !== cool) ?? mix(cool, key, 0.5);
  const tint = (c: Rgb, t: number) => mix(paperRgb, c, t);

  const unit = Math.min(width, height);
  const [W, H] = [width / unit, height / unit];
  const ss = Math.ceil(MIN_UNIT / unit);
  const px = 1 / (unit * ss);
  const cols = width * ss;
  const pad = Math.ceil(SHIFT / px) + 2;
  // How far from a block's edge its shifted print or its outline can still reach.
  const reach = 2 * SHIFT + LINE + 2 * px;

  // A heightfield: the region below `top(x)`, its distance from the top measured square to the slope. Tops are
  // cached for every sample column, with room either side for register shifts.
  const field = (top: (x: number) => number) => {
    const n = cols + 2 * pad;
    const tops = Float64Array.from({ length: n }, (_, c) =>
      top((c - pad + 0.5) * px),
    );
    const inv = Float64Array.from({ length: n }, (_, c) => {
      const slope =
        (tops[Math.min(c + 1, n - 1)] - tops[Math.max(c - 1, 0)]) / (2 * px);
      return 1 / Math.sqrt(1 + slope * slope);
    });
    return (y: number, col: number) => {
      const c = col + pad < 0 ? 0 : col + pad >= n ? n - 1 : col + pad;
      return (y - tops[c]) * inv[c];
    };
  };

  const disc = (cx: number, cy: number, r: number) => (x: number, y: number) =>
    r - Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));

  const motif = MOTIFS[Math.floor(rand() * MOTIFS.length)];
  const view = 1 + Math.floor(rand() * 36);
  const flip = chance(0.5);
  // x across the art, from the left or, flipped, from the right.
  const across = (t: number) => (flip ? W * (1 - t) : W * t);
  const night = chance(motif === "pines" ? 0.65 : 0.12);
  const horizon =
    H *
    (motif === "peak"
      ? range(0.72, 0.84)
      : motif === "wave"
        ? range(0.6, 0.7)
        : motif === "pines"
          ? range(0.62, 0.76)
          : range(0.5, 0.6));

  // The sky's bokashi: ink wiped onto the block's top, fading to bare paper, and sometimes a warm glow over
  // the horizon.
  const skyInk = night ? key : chance(0.7) ? cool : key;
  const skyAlpha = night ? 0.92 : range(0.55, 0.9);
  const skyDepth = H * (night ? range(0.55, 0.8) : range(0.22, 0.45));
  const glow = !night && chance(0.45) ? range(0.3, 0.55) : 0;
  const glowDepth = H * range(0.12, 0.25);

  const blocks: Block[] = [];

  // A body in the sky: the moon at night, pale and ringed by the keyblock, or a red sun.
  if (night || (motif !== "wave" && chance(0.35))) {
    const r = range(0.06, 0.11);
    const [cx, cy] = [across(range(0.45, 0.8)), H * range(0.14, 0.3)];
    blocks.push({
      sd: disc(cx, cy, r),
      box: [cx - r, cy - r, cx + r, cy + r],
      color: night ? tint(warm, 0.12) : warm,
      shift: shift(),
      outline: night,
    });
  }

  // A snow-capped peak, its slopes concave like Fuji's, flattened at the summit. Its body fades from `color`
  // at the top to `color2` at the base, and the snow's lower edge hangs in streaks down the gullies.
  const peak = (
    cx: number,
    peakY: number,
    baseY: number,
    halfW: number,
    color: Rgb,
    color2: Rgb,
  ) => {
    const ridge = ridgeNoise(rand);
    const flat = range(0.04, 0.09);
    const h = baseY - peakY;
    const body = field((x) => {
      const s = clamp01((Math.abs(x - cx) / halfW - flat) / (1 - flat));
      const t = 1 - s;
      return baseY - h * t * (0.3 + 0.7 * t) + 0.012 * h * ridge(x * 5);
    });
    const snowDepth = h * range(0.2, 0.38);
    const [streaks, streakSalt] = [range(14, 26) / halfW, salt()];
    const snowLine = field((x) => {
      const u = x * streaks;
      const k = Math.floor(u);
      const tri = 1 - Math.abs(2 * (u - k) - 1);
      const depth = 0.35 + 0.65 * hash2(k, 0, streakSalt);
      return peakY + snowDepth * (0.45 + 0.55 * tri * depth);
    });
    const box = [cx - halfW, peakY - 0.02, cx + halfW, INF] as const;
    blocks.push(
      {
        sd: (_, y, col) => body(y, col),
        box,
        color,
        color2,
        fade: [peakY, baseY],
        shift: shift(),
        outline: true,
        grain: true,
      },
      {
        sd: (_, y, col) => Math.min(body(y, col), -snowLine(y, col)),
        box,
        color: paperRgb,
        shift: shift(),
        outline: true,
      },
    );
  };

  // A line of hills, their tops from noise, filled with `color`.
  const hills = (base: number, amp: number, color: Rgb, color2 = color) => {
    const [ridge, freq] = [ridgeNoise(rand), range(1.5, 3.5)];
    const top = field((x) => base - amp * ridge(x * freq));
    blocks.push({
      sd: (_, y, col) => top(y, col),
      box: [-INF, base - amp - 0.02, INF, INF],
      color,
      color2,
      fade: [base - amp, H],
      shift: shift(),
      outline: true,
      grain: true,
    });
  };

  // Water from `top` down, darker toward the viewer, with ripples cut in short strokes.
  const water = (top: number) => {
    const rippleSalt = salt();
    const gap = range(0.018, 0.028);
    blocks.push({
      sd: (_, y) => y - top,
      box: [-INF, top, INF, INF],
      color: tint(cool, range(0.35, 0.6)),
      color2: mix(cool, key, 0.25),
      fade: [top, H],
      shift: shift(),
      grain: true,
      texture: (x, _, sd) => {
        const k = Math.floor(sd / gap);
        const f = x * 9 + hash2(k, 0, rippleSalt) * 7;
        const dash = clamp01(
          (hash2(k, Math.floor(f), rippleSalt) - 0.45) * 4 -
            Math.abs(f - Math.floor(f) - 0.5) * 2,
        );
        return dash * hatch(sd, gap, px, 0.06 + 0.06 * clamp01(sd / 0.3)) * 0.7;
      },
    });
  };

  // Kasumi, the flat bands of mist that cross a view: two rounded bars, offset, as one band.
  const mist = (cy: number, color: Rgb) => {
    const cx = range(0, W);
    const [len, r] = [range(0.2, 0.5), range(0.022, 0.04)];
    const [ox, oy] = [range(-0.2, 0.2), r * range(0.8, 1.4)];
    const bar = (bx: number, by: number) => (x: number, y: number) => {
      const dx = Math.max(0, Math.abs(x - bx) - len);
      return r - Math.sqrt(dx * dx + (y - by) * (y - by));
    };
    const [a, b] = [bar(cx, cy), bar(cx + ox, cy + oy)];
    blocks.push({
      sd: (x, y) => Math.max(a(x, y), b(x, y)),
      box: [cx - len - 0.25, cy - r, cx + len + 0.25, cy + oy + r],
      color,
      alpha: 0.92,
      shift: shift(),
    });
  };

  // A great wave swelling up from below the art to its crest at `xc`, then curling over a hollow toward `dir`,
  // its lip breaking into claws of foam, and its face falling away under the hollow. Water lines follow it.
  const wave = (xc: number, crestY: number, R: number, dir: number) => {
    const baseY = H + 0.05;
    const h = baseY - crestY;
    const back = Math.abs(xc - (dir > 0 ? 0 : W)) + h * range(0.3, 0.6);
    const front = Math.max(R * 2, h * range(0.55, 0.8));
    const ripple = ridgeNoise(rand);
    const top = field((x) => {
      const s = dir * (x - xc);
      const t = s <= 0 ? clamp01(1 + s / back) : clamp01(1 - s / front);
      const rise = smooth(t);
      return baseY - h * rise + 0.02 * R * ripple(x * 12);
    });
    // The lip is a disc with the hollow, a second disc, cut out from under it.
    const lip = disc(xc + dir * R * 0.5, crestY + R, R);
    const hollow = disc(xc + dir * R * 0.85, crestY + R * 1.28, R * 0.8);
    const body = (x: number, y: number, col: number) =>
      Math.min(Math.max(top(y, col), lip(x, y)), -hollow(x, y));
    const box = [
      dir > 0 ? -INF : xc - front,
      crestY - 0.02,
      dir > 0 ? xc + front : INF,
      INF,
    ] as const;
    const foamBand = R * range(0.16, 0.24);
    const claws = range(28, 40) / R;
    const foamTo = crestY + R * 2.2;
    const foam = (x: number, y: number) => {
      const u = (dir * x + 0.6 * y) * claws * R;
      const tri = 1 - Math.abs(2 * (u - Math.floor(u)) - 1);
      return (
        foamBand * (0.25 + 0.75 * tri * tri) * clamp01((foamTo - y) / (0.4 * R))
      );
    };
    const lineSalt = salt();
    const lineGap = R * range(0.1, 0.14);
    blocks.push(
      {
        sd: body,
        box,
        color: tint(cool, 0.7),
        color2: mix(cool, key, 0.55),
        fade: [crestY, crestY + 3 * R],
        shift: shift(),
        outline: true,
        texture: (_x, y, _sd, col) => {
          const sd = top(y, col);
          return sd < foamBand
            ? 0
            : hatch(
                sd,
                lineGap,
                px,
                0.05 + 0.1 * hash2(Math.floor(sd / lineGap), 0, lineSalt),
              ) *
                clamp01(1.5 - sd / (2 * R)) *
                0.8;
        },
      },
      {
        sd: (x, y, col) => {
          const d = body(x, y, col);
          return Math.min(d, foam(x, y) - d);
        },
        box,
        color: paperRgb,
        shift: shift(),
        outline: true,
      },
    );
  };

  // An umbrella pine growing from (x0, y0): a leaning trunk, branches, and flat pads of needles at their ends.
  const pine = (x0: number, y0: number, tall: number) => {
    const lean = range(-0.25, 0.25) * tall;
    const [mx, my] = [x0 + lean * 0.3 + range(-0.03, 0.03), y0 - tall * 0.55];
    const [tx, ty] = [x0 + lean, y0 - tall];
    const thick = tall * range(0.025, 0.04);
    const limbs: [number[], number][] = [
      [[x0, y0 + 0.05, mx, my], thick],
      [[mx, my, tx, ty], thick * 0.75],
    ];
    const pads: [number, number, number, number][] = [];
    for (let n = 3 + Math.floor(rand() * 4), i = 0; i < n; i++) {
      const t = i / (n - 1);
      const [bx, by] = [mx + (tx - mx) * (0.3 + 0.7 * t), my + (ty - my) * t];
      const side = i % 2 === 0 ? 1 : -1;
      const a = tall * range(0.12, 0.24) * (1.1 - 0.4 * t);
      const [px2, py2] = [bx + side * a * range(0.4, 0.9), by - range(0, 0.04)];
      limbs.push([[bx, by, px2, py2], thick * 0.4]);
      pads.push([px2, py2, a, a * range(0.28, 0.42)]);
    }
    // Each block's bounds: the limbs' ends and the pads' extents.
    const bounds = (parts: number[][]): [number, number, number, number] => [
      Math.min(...parts.map((p) => p[0])),
      Math.min(...parts.map((p) => p[1])),
      Math.max(...parts.map((p) => p[2])),
      Math.max(...parts.map((p) => p[3])),
    ];
    const limbBox = bounds(
      limbs.map(([[ax, ay, bx, by], r]) => [
        Math.min(ax, bx) - r,
        Math.min(ay, by) - r,
        Math.max(ax, bx) + r,
        Math.max(ay, by) + r,
      ]),
    );
    const padBox = bounds(
      pads.map(([cx, cy, a, b]) => [cx - a, cy - b, cx + a, cy + b]),
    );
    const pad = Float64Array.from(pads.flat());
    blocks.push(
      {
        sd: strokes(
          limbs.map(([seg, r]) => [...seg, r]),
          reach,
        ),
        box: limbBox,
        color: mix(warm, key, 0.6),
        shift: shift(),
        outline: true,
      },
      {
        // Each pad a dome with a flat underside: half an ellipse over a flatter one, its distance from the edge
        // estimated by its gradient.
        sd: (x, y) => {
          let d = -INF;
          for (let i = 0; i < pad.length; i += 4) {
            const a = pad[i + 2];
            const b = y > pad[i + 1] ? pad[i + 3] * 0.35 : pad[i + 3];
            if (Math.abs(x - pad[i]) > a + reach) continue;
            if (Math.abs(y - pad[i + 1]) > b + reach) continue;
            const u = (x - pad[i]) / a;
            const v = (y - pad[i + 1]) / b;
            const gx = u / a;
            const gy = v / b;
            const e =
              (1 - u * u - v * v) / (2 * Math.sqrt(gx * gx + gy * gy) + 1e-9);
            if (e > d) d = e;
          }
          return d;
        },
        box: padBox,
        color: mix(third, key, 0.4),
        color2: mix(third, key, 0.7),
        fade: [ty - 0.1, y0 - tall * 0.3],
        shift: shift(),
        outline: true,
        texture: (_, y, sd) =>
          hatch(y, 0.008, px, 0.14) * clamp01(sd / 0.012) * 0.6,
      },
    );
  };

  // A drum bridge arching over the water: a red deck, posts and a rail, on legs.
  const bridge = (cx: number, deckY: number, half: number) => {
    const rise = range(0.07, 0.13);
    const thick = range(0.02, 0.028);
    const railH = range(0.03, 0.045);
    const deck = (x: number) => {
      const u = (x - cx) / half;
      return deckY - rise * (1 - u * u);
    };
    const steep = (x: number) => {
      const s = (2 * rise * (x - cx)) / (half * half);
      return 1 / Math.sqrt(1 + s * s);
    };
    const posts = 2 * Math.round(range(4, 7));
    const postGap = (2 * half) / posts;
    const legs = 1 + Math.floor(rand() * 3);
    const legGap = (2 * half) / (legs + 1);
    const legBottom = deckY + range(0.06, 0.12);
    const span = (x: number) => half - Math.abs(x - cx);
    const box = [
      cx - half,
      deckY - rise - railH - 0.02,
      cx + half,
      INF,
    ] as const;
    blocks.push(
      {
        sd: (x, y) => {
          const k = Math.round((x - cx) / legGap);
          if (k === 0 || Math.abs(k) > (legs + 1) / 2) return -INF;
          const xl = cx + k * legGap;
          return Math.min(
            0.011 - Math.abs(x - xl),
            y - deck(xl) - thick / 2,
            legBottom - y,
          );
        },
        box,
        color: mix(warm, key, 0.45),
        shift: shift(),
        outline: true,
      },
      {
        sd: (x, y) => {
          const c = deck(x);
          const inv = steep(x);
          const slab = thick / 2 - Math.abs(y - c - thick / 2) * inv;
          const rail = 0.006 - Math.abs(y - c + railH) * inv;
          const k = Math.round((x - cx) / postGap);
          const post = Math.min(
            0.005 - Math.abs(x - cx - k * postGap),
            c - y,
            y - c + railH,
          );
          return Math.min(span(x), Math.max(slab, rail, post));
        },
        box,
        color: warm,
        shift: shift(),
        outline: true,
      },
    );
  };

  // Each view sets its scene back to front.
  const ground = chance(0.5) ? mix(third, key, 0.25) : tint(third, 0.75);
  if (motif === "peak") {
    const cx = across(range(0.35, 0.65));
    const peakY = H * range(0.14, 0.28);
    const red = chance(0.5);
    peak(
      cx,
      peakY,
      horizon + 0.04,
      W * range(0.42, 0.65) + 0.25,
      red ? warm : mix(cool, key, 0.45),
      red ? mix(warm, key, 0.45) : tint(cool, 0.45),
    );
    for (let n = Math.floor(rand() * 3); n > 0; n--)
      mist(range(peakY + 0.15, horizon - 0.02), tint(warm, range(0, 0.25)));
    if (chance(0.4)) water(horizon + 0.02);
    hills(
      H * range(0.9, 0.97),
      range(0.04, 0.09),
      ground,
      mix(ground, key, 0.4),
    );
  } else if (motif === "wave") {
    peak(
      across(range(0.55, 0.8)),
      horizon - range(0.07, 0.14),
      horizon + 0.01,
      range(0.18, 0.3),
      mix(cool, key, 0.5),
      tint(cool, 0.5),
    );
    water(horizon);
    const R = range(0.13, 0.19);
    const dir = flip ? -1 : 1;
    wave(
      across(range(0.25, 0.42)),
      Math.max(H * 0.12, horizon - range(0.3, 0.45)),
      R,
      dir,
    );
    if (chance(0.6))
      wave(
        across(range(0.65, 0.85)),
        H * range(0.68, 0.8),
        R * range(0.35, 0.5),
        dir,
      );
  } else if (motif === "pines") {
    if (chance(0.4))
      peak(
        across(range(0.15, 0.4)),
        horizon - range(0.08, 0.16),
        horizon + 0.01,
        range(0.2, 0.32),
        mix(cool, key, 0.5),
        tint(cool, 0.5),
      );
    hills(horizon, range(0.04, 0.09), tint(cool, 0.5), tint(cool, 0.35));
    if (chance(0.6)) water(horizon + 0.01);
    if (chance(0.5))
      mist(horizon - range(0.02, 0.1), tint(warm, range(0, 0.2)));
    const groundY = H * range(0.88, 0.95);
    hills(groundY, range(0.04, 0.08), ground, mix(ground, key, 0.4));
    for (let n = 1 + Math.floor(rand() * 3), i = 0; i < n; i++)
      pine(across(range(0.08, 0.92)), groundY, H * range(0.38, 0.62));
  } else {
    if (chance(0.6))
      peak(
        across(range(0.3, 0.7)),
        horizon - range(0.12, 0.22),
        horizon + 0.01,
        range(0.25, 0.4),
        mix(cool, key, 0.5),
        tint(cool, 0.5),
      );
    else hills(horizon, range(0.05, 0.12), tint(cool, 0.55), tint(cool, 0.35));
    water(horizon);
    for (let n = Math.floor(rand() * 2); n > 0; n--)
      mist(horizon - range(0.03, 0.12), tint(warm, range(0, 0.2)));
    bridge(
      across(range(0.4, 0.6)),
      H * range(0.68, 0.8),
      W * range(0.32, 0.45),
    );
  }

  // Rain falls across some views, in fine slanting lines with gaps.
  const rain = chance(0.15);
  const [slant, rainGap, rainSalt] = [
    range(0.05, 0.35),
    range(0.01, 0.016),
    salt(),
  ];
  const rainNorm = 1 / Math.sqrt(1 + slant * slant);
  const rainHalf = 0.05 * rainGap;
  // Whether rain line `k` is falling at height y: each line breaks into streaks.
  const raining = (k: number, y: number) =>
    hash2(k, Math.floor(y * 6 + hash2(k, 1, rainSalt) * 6), rainSalt) > 0.4
      ? 1
      : 0;
  // How much of the sample at (x, y) the rain covers. Where lines are two samples apart or more, only the
  // nearest can reach a sample. Closer, every line near enough counts, fading to their average under a sample.
  const rainFine = clamp01(rainGap / px - 1);
  const rainAt = (x: number, y: number) => {
    const phi = (x - slant * y) * rainNorm;
    if (rainFine === 1) {
      const m = Math.floor(phi / rainGap);
      const d = (phi - (m + 0.5) * rainGap) / px;
      return Math.abs(d) < 0.5 + rainHalf / px && raining(m, y)
        ? cover(d, rainHalf / px)
        : 0;
    }
    const k = Math.floor(phi / rainGap);
    let exact = 0;
    let streaks = 0;
    for (let m = k - 1; m <= k + 1; m++) {
      const on = raining(m, y);
      streaks += on;
      if (on) exact += cover((phi - (m + 0.5) * rainGap) / px, rainHalf / px);
    }
    const mean = ((2 * rainHalf) / rainGap) * (streaks / 3);
    return mean + (exact - mean) * rainFine;
  };

  // The cartouche: a framed panel in a top corner, the view's number then its title, in the keyblock.
  const glyphs = [
    ...numeralGlyphs(view).map((i) => NUMERALS[i]),
    ...Array.from({ length: 2 + Math.floor(rand() * 3) }, () =>
      madeUpGlyph(rand),
    ),
  ];
  const cw = range(0.065, 0.08);
  const gw = cw * 0.7;
  const ch = Math.min(H * 0.6, gw * 1.1 * glyphs.length + cw * 0.5);
  const cx0 = flip ? 0.04 : W - 0.04 - cw;
  const cy0 = 0.04;
  const lines: number[][] = [];
  glyphs.forEach((glyph, i) => {
    const [gx, gy] = [cx0 + cw * 0.15, cy0 + cw * 0.2 + i * gw * 1.1];
    if (gy + gw > cy0 + ch) return;
    for (const [ax, ay, bx, by] of glyph)
      lines.push([
        gx + ax * gw,
        gy + ay * gw,
        gx + bx * gw,
        gy + by * gw,
        gw * 0.06,
      ]);
  });
  const cbox = [cx0, cy0, cx0 + cw, cy0 + ch] as const;
  const labels: Block[] = [
    {
      sd: (x, y) => Math.min(x - cx0, cx0 + cw - x, y - cy0, cy0 + ch - y),
      box: cbox,
      color: chance(0.5) ? tint(warm, range(0.25, 0.45)) : paperRgb,
      shift: shift(),
      outline: true,
    },
    {
      sd: strokes(lines, reach),
      box: cbox,
      color: key,
    },
  ];

  const [grainSalt, warpSalt] = [salt(), salt()];
  // A sample's width, in rings.
  const ringWidth = GRAIN_FREQ * px;
  // The grain's rings waver along the block: each column's offset across them.
  const warp = ridgeNoise(stream(warpSalt, 1));
  const warps = Float64Array.from(
    { length: cols },
    (_, c) => 3 * warp((c + 0.5) * px * 4),
  );

  // Each block flattened for the inner loop: its bounds widened by how far it can reach, its shift in whole
  // samples, and its fill as a start color and a change down the fade.
  const printed = [...blocks, ...labels].map((block, i) => {
    const { box, color, color2 = color, fade = [0, 1], shift: s } = block;
    const [sx, sy] = s
      ? [Math.round(s[0] / px), Math.round(s[1] / px)]
      : [0, 0];
    // Every field set, in one order, so all blocks share a shape and the inner loop reads them fast.
    return {
      sd: block.sd,
      texture: block.texture ?? null,
      outline: block.outline ?? false,
      grain: block.grain ?? false,
      r: color[0],
      g: color[1],
      b: color[2],
      x0: box[0] - reach,
      y0: box[1] - reach,
      x1: box[2] + reach,
      y1: box[3] + reach,
      sx,
      dx: sx * px,
      dy: sy * px,
      moved: sx !== 0 || sy !== 0,
      dr: color2[0] - color[0],
      dg: color2[1] - color[1],
      db: color2[2] - color[2],
      f0: fade[0],
      fk: 1 / (fade[1] - fade[0]),
      alpha: block.alpha ?? 1,
      label: i >= blocks.length,
    };
  });

  const image = ctx.createImageData(width, height);
  const data = image.data;
  const [pr, pg, pb] = paperRgb;
  const lineHalf = LINE / px;
  const accum = new Float64Array(width * 3);
  for (let y = 0; y < height; y++) {
    for (let j = 0; j < ss; j++) {
      const sy = (y * ss + j + 0.5) * px;
      // Only blocks whose bounds cross this row of samples.
      const row = printed.filter((b) => sy >= b.y0 && sy <= b.y1);
      const firstLabel = row.findIndex((b) => b.label);
      // Rain falls over the view, under the cartouche.
      const rainFrom = rain ? (firstLabel < 0 ? row.length : firstLabel) : -1;
      const sky = skyAlpha * smooth(clamp01(1 - sy / skyDepth));
      const glowA =
        glow * smooth(clamp01(1 - Math.abs(horizon - sy) / glowDepth));
      for (let x = 0; x < width; x++) {
        let sr = 0;
        let sg = 0;
        let sb = 0;
        for (let i = 0; i < ss; i++) {
          const col = x * ss + i;
          const sx = (col + 0.5) * px;
          // The grain: rings across the block, averaged over the sample so rings finer than a pixel blend to
          // an even tone, and stronger in some patches of the block than others.
          const u = sy * GRAIN_FREQ + warps[col];
          const ring =
            (triSum(u + ringWidth / 2) - triSum(u - ringWidth / 2)) / ringWidth;
          const grain =
            GRAIN * (2 * ring - 1) * noise2(sx * 3, sy * 5, grainSalt);
          let r = pr;
          let g = pg;
          let b = pb;
          let a = sky * (1 + grain);
          r += (skyInk[0] - r) * a;
          g += (skyInk[1] - g) * a;
          b += (skyInk[2] - b) * a;
          if (glowA > 0) {
            a = glowA * (1 + grain);
            r += (warm[0] - r) * a;
            g += (warm[1] - g) * a;
            b += (warm[2] - b) * a;
          }
          for (let n = 0; n <= row.length; n++) {
            if (n === rainFrom) {
              a = 0.4 * rainAt(sx, sy);
              r += (key[0] - r) * a;
              g += (key[1] - g) * a;
              b += (key[2] - b) * a;
            }
            if (n === row.length) break;
            const k = row[n];
            if (sx < k.x0 || sx > k.x1) continue;
            const bx = sx - k.dx;
            const by = sy - k.dy;
            const d = k.sd(bx, by, col - k.sx);
            const fill = clamp01(d / px + 0.5);
            if (fill > 0) {
              const f = clamp01((by - k.f0) * k.fk);
              a = fill * k.alpha * (k.grain ? 1 + grain : 1);
              r += (k.r + k.dr * f - r) * a;
              g += (k.g + k.dg * f - g) * a;
              b += (k.b + k.db * f - b) * a;
              if (k.texture) {
                a = fill * k.texture(bx, by, d, col - k.sx);
                r += (key[0] - r) * a;
                g += (key[1] - g) * a;
                b += (key[2] - b) * a;
              }
            }
            if (k.outline && Math.abs(d) < reach) {
              const e = k.moved ? k.sd(sx, sy, col) : d;
              a = 0.92 * cover(e / px, lineHalf);
              r += (key[0] - r) * a;
              g += (key[1] - g) * a;
              b += (key[2] - b) * a;
            }
          }
          sr += r;
          sg += g;
          sb += b;
        }
        // Rows of subsamples add up per pixel, which rounds once the last row is in.
        const p = (y * width + x) * 4;
        const q = x * 3;
        accum[q] = j === 0 ? sr : accum[q] + sr;
        accum[q + 1] = j === 0 ? sg : accum[q + 1] + sg;
        accum[q + 2] = j === 0 ? sb : accum[q + 2] + sb;
        if (j === ss - 1)
          for (let c = 0; c < 3; c++)
            data[p + c] = Math.round(accum[q + c] / (ss * ss));
        data[p + 3] = 255;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

export const ukiyoe1: Style = {
  id: "ukiyo1",
  draw,
};
