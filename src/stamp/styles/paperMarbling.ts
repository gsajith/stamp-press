import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Paper marbling: an endpaper sheet. Inks are dropped on a bath in layers, each drop pushing the ink already
// there outward into rings, with a pale rim of gall that later drops squeeze into thin paper veins. Then, by
// pattern, the bath is left as stone or raked back and forth into gel-git. Gel-git combed across with a fine
// comb makes nonpareil, and nonpareil waved makes a bouquet. A longer rake folded in a zigzag makes chevrons.
// A slow drift of the bath bends it all.
//
// It follows Aubrey Jaffer's mathematical marbling: every drop and stroke is a closed-form map of the bath
// with a closed-form inverse, so a pixel's color comes from running its position back through them, newest
// first, until it lands in a drop. Along the way it carries the map's Jacobian, which gives each drop edge's
// width in pixels, so edges are antialiased at any size and bands thinner than a pixel fade instead of
// aliasing. Only IEEE-exact arithmetic here (ADR 0001): no Math.sin, Math.pow or the like. Sizes are
// fractions of the art's short side.

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

// Sine and cosine of `x`, written to `sine` and `cosine`, from one Taylor polynomial, which is the same in every
// engine, unlike Math.sin. Sine is within 1e-7. Cosine comes from sqrt(1 - sine²), so it strays up to 4e-4 near
// a quarter turn, plenty for the drift's direction, its one use.
let sine = 0;
let cosine = 0;
function sincos(x: number) {
  let y = x - TAU * Math.round(x / TAU);
  let sign = 1;
  if (y > TAU / 4) {
    y = TAU / 2 - y;
    sign = -1;
  } else if (y < -TAU / 4) {
    y = -TAU / 2 - y;
    sign = -1;
  }
  const y2 = y * y;
  sine =
    y *
    (1 -
      (y2 / 6) *
        (1 - (y2 / 20) * (1 - (y2 / 42) * (1 - (y2 / 72) * (1 - y2 / 110)))));
  const s2 = sine * sine;
  cosine = sign * Math.sqrt(s2 < 1 ? 1 - s2 : 0);
}

// A drop of ink: a disc of radius `r` whose outer `r - core` is its pale rim. `thinned` is how far its ink
// moves toward the paper where it spreads thinnest.
type Drop = {
  x: number;
  y: number;
  r: number;
  core: number;
  ink: Rgb;
  thinned: Rgb;
  rim: Rgb;
};

// A stroke through the bath: it slides ink along (mx, my) by an amount that depends only on how far a point
// sits along (nx, ny), the perpendicular, so it is a shear and its inverse is the same slide backward.
// - A comb: tines every `period`, each dragging ink `amp` along its line and less with distance, falling to
//   half at `sharp` away. With `alternate`, neighboring tines run opposite ways, as a rake pulled back and forth.
// - A wave: a smooth slide, near a sine, `amp` high, one cycle per `period`.
// - A zigzag: a triangle-wave slide, which folds bands into chevrons.
type Stroke = {
  kind: "comb" | "wave" | "zigzag";
  mx: number;
  my: number;
  nx: number;
  ny: number;
  amp: number;
  period: number;
  phase: number;
  sharp: number;
  alternate: boolean;
};

// How far a stroke slides ink at `v` along its perpendicular, and how fast that changes with `v`. Written to
// `shift` and `rate` rather than returned, since it runs for every pixel and stroke.
let shift = 0;
let rate = 0;
function slide(s: Stroke, v: number) {
  const t = v / s.period + s.phase;
  const k = Math.floor(t);
  const f = t - k;
  if (s.kind === "wave") {
    // Two parabolas, 4u(1 - |u|), which trace a sine to within 6% and cost far less.
    const u = 2 * f - 1;
    const m = u < 0 ? -u : u;
    shift = 4 * s.amp * u * (1 - m);
    rate = (8 * s.amp * (1 - 2 * m)) / s.period;
  } else if (s.kind === "zigzag") {
    const up = f < 0.5;
    shift = s.amp * (up ? 4 * f - 1 : 3 - 4 * f);
    rate = ((up ? 4 : -4) * s.amp) / s.period;
  } else {
    // A comb: the two nearest tines, one either side, which keeps the slide continuous between them. Each
    // drags amp * sharp / (distance + sharp), and the two share one division.
    const below = f * s.period + s.sharp;
    const above = (1 - f) * s.period + s.sharp;
    const sb = s.alternate && (k & 1) === 1 ? -1 : 1;
    const sa = s.alternate ? -sb : 1;
    const inv = 1 / (below * above);
    const ib = s.amp * s.sharp * above * inv;
    const ia = s.amp * s.sharp * below * inv;
    shift = sb * ib + sa * ia;
    rate = (sa * ia * below - sb * ib * above) * inv;
  }
}

// A turn of `angle` turns, as a unit vector.
function heading(angle: number): [number, number] {
  sincos(TAU * angle);
  return [cosine, sine];
}

type Pattern = "stone" | "gelgit" | "nonpareil" | "chevron" | "bouquet";
const PATTERNS: readonly Pattern[] = [
  "stone",
  "gelgit",
  "nonpareil",
  "chevron",
  "bouquet",
];

// Draws with a short side under this many pixels are supersampled. Desk stamps' art is at least 140 px, so
// they never are.
const MIN_UNIT = 128;

// Remaining weight below which the inks further back can't change a pixel.
const FAINT = 1 / 1024;

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const unit = Math.min(width, height);
  const [W, H] = [width / unit, height / unit];
  // Small draws are supersampled until the art's short side has MIN_UNIT samples, since many bands and veins
  // there are thinner than a pixel, and edge widths alone don't blend several edges in one pixel well.
  const ss = Math.ceil(MIN_UNIT / unit);
  const px = 1 / (unit * ss);
  const paperRgb = rgb(paper);
  const inkRgb = inks.map(rgb);

  const pattern = PATTERNS[Math.floor(rand() * PATTERNS.length)];
  const combed = pattern !== "stone";

  // The colors the layers are dropped in: every ink, a pale tint of one, and sometimes plain paper.
  const colors: Rgb[] = [...inkRgb];
  colors.push(mix(inkRgb[Math.floor(rand() * inkRgb.length)], paperRgb, 0.55));
  if (rand() < 0.5) colors.push(paperRgb);
  for (let i = colors.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [colors[i], colors[j]] = [colors[j], colors[i]];
  }

  // Combs run along one of the sheet's sides, (ax, ay), and the fine comb and waves across it.
  const along = rand() < 0.5;
  const [ax, ay] = along ? [1, 0] : [0, 1];
  const [bx, by] = along ? [0, 1] : [1, 0];

  // Every combed pattern starts with a coarse rake pulled back and forth, gel-git. For chevrons it is pulled
  // further with softer tines, drawing the spots out into stripes for the zigzag to fold.
  const chevron = pattern === "chevron";
  const gap = chevron ? 0.07 + 0.04 * rand() : 0.09 + 0.07 * rand();
  const rake: Stroke = {
    kind: "comb",
    mx: ax,
    my: ay,
    nx: bx,
    ny: by,
    amp: chevron ? 0.3 + 0.2 * rand() : gap * (0.9 + 0.8 * rand()),
    period: gap,
    phase: rand(),
    sharp: chevron ? 0.03 + 0.02 * rand() : 0.015 + 0.02 * rand(),
    alternate: true,
  };

  // Layers of drops, scattered past the art's edges far enough that strokes and drift don't pull bare bath
  // in, and sized so the layers together cover the bath almost twice over. A later drop pushes the ink it
  // lands in out into rings, and squeezes earlier rims into veins. Stone gets more, smaller drops, since
  // nothing draws them out.
  const reachA = combed ? rake.amp + 0.12 : 0.1;
  const reachB = combed ? 0.12 : 0.1;
  const [sx, sy] = [reachA * ax + reachB * bx, reachA * ay + reachB * by];
  const bath = (W + 2 * sx) * (H + 2 * sy);
  const layers = Math.min(colors.length, 3 + Math.floor(rand() * 2));
  const count = combed ? 18 : 28;
  // The mean of (0.6 + 0.8 u)² over u in [0, 1) is 1.0533.
  const base = Math.sqrt((1.8 * bath) / (count * Math.PI * 1.0533));
  // The spacing of the faint rings each drop's ink thins in, and how far it thins.
  const rings = 0.006 + 0.008 * rand();
  const thinning = 0.05 + 0.07 * rand();
  const drops: Drop[] = [];
  for (let l = 0; l < layers; l++) {
    const ink = colors[l];
    const rim = ink === paperRgb ? mix(paperRgb, inkRgb[0], 0.45) : paperRgb;
    const veins = 0.03 + 0.09 * rand();
    const end = Math.round(((l + 1) * count) / layers);
    while (drops.length < end) {
      const r = base * (0.6 + 0.8 * rand());
      const tone = mix(ink, paperRgb, 0.12 * rand());
      drops.push({
        x: -sx + (W + 2 * sx) * rand(),
        y: -sy + (H + 2 * sy) * rand(),
        r,
        core: r * (1 - veins),
        // Each drop's ink spreads a little thinner or thicker than the next.
        ink: tone,
        thinned: [
          (paperRgb[0] - tone[0]) * thinning,
          (paperRgb[1] - tone[1]) * thinning,
          (paperRgb[2] - tone[2]) * thinning,
        ],
        rim,
      });
    }
  }
  // Bare bath, which shows only where no drop reached, is the first layer's color.
  const ground = colors[0];

  // The strokes, in the order they're drawn.
  const strokes: Stroke[] = combed ? [rake] : [];
  // A stroke across the rake, sliding ink along (bx, by).
  const across = (
    kind: Stroke["kind"],
    amp: number,
    period: number,
    sharp = 0,
  ) =>
    strokes.push({
      kind,
      mx: bx,
      my: by,
      nx: ax,
      ny: ay,
      amp,
      period,
      phase: rand(),
      sharp,
      alternate: false,
    });
  if (pattern === "nonpareil" || pattern === "bouquet") {
    // A fine comb drawn once across the rake.
    const fine = 0.022 + 0.016 * rand();
    across("comb", fine * (1.2 + rand()), fine, 0.004 + 0.004 * rand());
  }
  if (chevron) {
    const period = 0.16 + 0.16 * rand();
    across("zigzag", period * (0.15 + 0.15 * rand()), period);
  }
  if (pattern === "bouquet") {
    const period = 0.1 + 0.08 * rand();
    across("wave", period * (0.25 + 0.2 * rand()), period);
  }
  // The bath's slow drift, at any angle, bends everything a little.
  for (let i = 0; i < 2; i++) {
    const [mx, my] = heading(rand());
    strokes.push({
      kind: "wave",
      mx,
      my,
      nx: -my,
      ny: mx,
      amp: 0.012 + 0.03 * rand(),
      period: 0.7 + 0.9 * rand(),
      phase: rand(),
      sharp: 0,
      alternate: false,
    });
  }

  const image = ctx.createImageData(width, height);
  const data = image.data;
  // Each drop's center, radius and core radius, packed for the loop below.
  const shape = new Float64Array(
    drops.flatMap(({ x, y, r, core }) => [x, y, r, core]),
  );
  // The color of the bath at sample (sx, sy), added to (r0, g0, b0).
  let [r0, g0, b0] = [0, 0, 0];
  const sample = (sx: number, sy: number) => {
    // Where the sample was on the bath, and the Jacobian [[a, b], [c, d]] of that position with respect to
    // the sample's, run back through every stroke and then every drop, newest first.
    let x = (sx + 0.5) * px;
    let y = (sy + 0.5) * px;
    let a = 1;
    let b = 0;
    let c = 0;
    let d = 1;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      slide(s, x * s.nx + y * s.ny);
      x -= s.mx * shift;
      y -= s.my * shift;
      // J' = (I - rate m nᵀ) J
      const n0 = s.nx * a + s.ny * c;
      const n1 = s.nx * b + s.ny * d;
      a -= rate * s.mx * n0;
      b -= rate * s.mx * n1;
      c -= rate * s.my * n0;
      d -= rate * s.my * n1;
    }

    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let weight = 1;
    for (let i = drops.length - 1; i >= 0; i--) {
      const o = i * 4;
      const cx = shape[o];
      const cy = shape[o + 1];
      const r = shape[o + 2];
      const core = shape[o + 3];
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      const r2 = r * r;
      // Half a sample, in bath units, by the map's largest stretch here, squared. An edge further than this
      // from the point can't touch its sample, so it skips the edge width below.
      const reach2 = 0.25 * px * px * (a * a + b * b + c * c + d * d);
      if (d2 < 4 * r2 || reach2 > r2) {
        const reach = Math.sqrt(reach2);
        const out = r + reach;
        if (d2 < out * out) {
          // The point is in the drop or by its edge. Away from the edges, and where the rings are too
          // fine to show (finer than 6 reaches, 3 samples), it is plain ink at the rings' average tone.
          let full = 1;
          let solid = 1;
          let thin = 2 / 3;
          const inner = core - reach;
          if (inner < 0 || d2 > inner * inner || rings > 6 * reach) {
            // The edge's width in samples comes from how fast the distance to the drop's center changes
            // across the sample: the length of Jᵀ u, for u the unit vector from the center.
            const dist = Math.sqrt(d2);
            const ux = dist > 0 ? dx / dist : 1;
            const uy = dist > 0 ? dy / dist : 0;
            const gx = a * ux + c * uy;
            const gy = b * ux + d * uy;
            const g = Math.sqrt(gx * gx + gy * gy) * px;
            full = g > 0 ? clamp01((r - dist) / g + 0.5) : dist < r ? 1 : 0;
            solid =
              g > 0 ? clamp01((core - dist) / g + 0.5) : dist < core ? 1 : 0;
            // The ink thins in faint, unevenly spaced rings as the drop spreads. Rings finer than a few
            // samples fade to their average, so a small draw has the tone a large one has scaled down.
            const fade = clamp01(rings / (3 * g) - 1);
            if (fade > 0) {
              const u = dist / (3.3 * rings) + i * 0.37;
              const w = u - Math.floor(u) - 0.5;
              const t = dist / rings + 2.4 * w * (0.5 - (w < 0 ? -w : w));
              const f = t - Math.floor(t);
              thin += fade * (4 * f * (1 - f) - thin);
            }
          }
          const { ink, thinned, rim } = drops[i];
          const ws = weight * solid;
          const wt = ws * thin;
          const wr = weight * (full - solid);
          s0 += ws * ink[0] + wt * thinned[0] + wr * rim[0];
          s1 += ws * ink[1] + wt * thinned[1] + wr * rim[1];
          s2 += ws * ink[2] + wt * thinned[2] + wr * rim[2];
          weight *= 1 - full;
          if (weight <= FAINT) break;
          if (d2 <= r2) {
            // Inside the drop but by an edge: what shows past it is what the drop landed on, at its
            // center. That point stands for the whole disc, so from here on edges are hard.
            x = cx;
            y = cy;
            a = b = c = d = 0;
            continue;
          }
        }
      }
      // Outside the drop: before it fell, this point sat nearer its center, by Jaffer's drop map inverted. p' = c + (p - c) k, with
      // k = sqrt(1 - r² / |p - c|²), and J' = (k I + β (p - c)(p - c)ᵀ) J for β = r² / (k |p - c|⁴).
      const q = r2 / d2;
      const k = Math.sqrt(1 - q);
      const beta = q / (k * d2);
      const t0 = beta * (dx * a + dy * c);
      const t1 = beta * (dx * b + dy * d);
      a = k * a + dx * t0;
      b = k * b + dx * t1;
      c = k * c + dy * t0;
      d = k * d + dy * t1;
      x = cx + dx * k;
      y = cy + dy * k;
    }
    r0 += s0 + weight * ground[0];
    g0 += s1 + weight * ground[1];
    b0 += s2 + weight * ground[2];
  };

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      r0 = g0 = b0 = 0;
      for (let j = 0; j < ss; j++)
        for (let i = 0; i < ss; i++) sample(col * ss + i, row * ss + j);
      const p = (row * width + col) * 4;
      data[p] = Math.round(r0 / (ss * ss));
      data[p + 1] = Math.round(g0 / (ss * ss));
      data[p + 2] = Math.round(b0 / (ss * ss));
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export const paperMarbling1: Style = {
  id: "marble1",
  draw,
};
