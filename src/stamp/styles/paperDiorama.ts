import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Paper diorama: a shadow box of layered cut paper. A sky panel at the back has a sun or moon cut out of it,
// and three to five cut layers stand in front of it, palest at the back and darkest ink at the front: forest
// ridges, a village of gables, or waves with a boat. Each layer casts a soft shadow on the layers behind it,
// offset along the light, and the box's frame shades its edges.
//
// Like lino1, it computes every pixel itself from positions in scene units (the art's short side is 1), so it
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
// A shadow's strength from a signed distance over its blur width: none at -1 and below, full at 1 and above.
const soft = (t: number) => {
  const u = t <= -1 ? 0 : t >= 1 ? 1 : 0.5 + 0.5 * t;
  return u * u * (3 - 2 * u);
};

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

// Smooth 1D value noise in [0, 1], three octaves, from a table of seeded values.
function ridgeNoise(rand: () => number): (x: number) => number {
  const table = Array.from({ length: 64 }, rand);
  const at = (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = table[i & 63];
    return a + (table[(i + 1) & 63] - a) * f * f * (3 - 2 * f);
  };
  return (x) => (at(x) * 4 + at(x * 2 + 17) * 2 + at(x * 4 + 31)) / 7;
}

// A layer's top edge is a profile: its height at every column of a fixed grid in scene units, so it's the
// same shape at any draw size. The grid runs a little past the art on both sides, where shadows reach.
const GRID = 1024;
const PAD = 0.25;

// A profile with the highest point of each run of PEAK_CELLS columns, its neighbours included, so a point well
// above it can skip measuring the profile at all.
type Profile = { top: Float64Array; peaks: Float64Array };
const PEAK_CELLS = 16;

function profile(top: Float64Array): Profile {
  const n = Math.ceil(top.length / PEAK_CELLS);
  const own = new Float64Array(n).fill(Infinity);
  for (let g = 0; g < top.length; g++) {
    const b = Math.floor(g / PEAK_CELLS);
    if (top[g] < own[b]) own[b] = top[g];
  }
  const peaks = new Float64Array(n);
  for (let b = 0; b < n; b++)
    peaks[b] = Math.min(
      own[b],
      own[b > 0 ? b - 1 : b],
      own[b < n - 1 ? b + 1 : b],
    );
  return { top, peaks };
}

// The highest the profile reaches near scene x.
function peakAt({ peaks }: Profile, x: number): number {
  const b = Math.floor(((x + PAD) * GRID) / PEAK_CELLS);
  return peaks[b < 0 ? 0 : b >= peaks.length ? peaks.length - 1 : b];
}

// A profile sampled at each pixel column of a draw, its x moved back by `shift`. Per column: the edge's
// height, the factor that turns height above or below it into distance square to the edge, and the highest
// the profile reaches nearby. A point's distance below the edge, positive in the paper, is then
// (y - height) * factor.
function columns(
  profile: Profile,
  width: number,
  px: number,
  shift: number,
): Float64Array {
  const { top } = profile;
  const last = top.length - 2;
  const out = new Float64Array(width * 3);
  for (let c = 0; c < width; c++) {
    const x = (c + 0.5) * px - shift;
    const g = (x + PAD) * GRID;
    const i = g < 0 ? 0 : g >= last ? last : Math.floor(g);
    const f = g < 0 ? 0 : g >= last + 1 ? 1 : g - i;
    const rise = top[i + 1] - top[i];
    const s = rise * GRID;
    out[c * 3] = top[i] + rise * f;
    out[c * 3 + 1] = 1 / Math.sqrt(1 + s * s);
    out[c * 3 + 2] = peakAt(profile, x);
  }
  return out;
}

// The profile averaged over `r` cells either side. Its edges lean across that many cells, so even a wall stays
// antialiased, and shadows use a wider average as a blurred edge: a wall's shadow fades out sideways, and a
// thin spire's shadow is faint, as a soft light would make them.
function boxed(top: Float64Array, r: number): Float64Array {
  const n = top.length;
  const sums = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sums[i + 1] = sums[i] + top[i];
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = i - r < 0 ? 0 : i - r;
    const b = i + r > n - 1 ? n - 1 : i + r;
    out[i] = (sums[b + 1] - sums[a]) / (b - a + 1);
  }
  return out;
}

// A cut-out in a layer: a window or a round attic light. Sizes are half widths.
type Hole = { x: number; y: number; hw: number; hh: number; round: boolean };

// Signed distance to a hole's edge, negative inside it.
function holeDistance(hole: Hole, qx: number, qy: number) {
  const dx = Math.abs(qx - hole.x);
  const dy = Math.abs(qy - hole.y);
  if (hole.round) return Math.sqrt(dx * dx + dy * dy) - hole.hw;
  const ox = dx - hole.hw;
  const oy = dy - hole.hh;
  const mx = ox > 0 ? ox : 0;
  const my = oy > 0 ? oy : 0;
  return Math.sqrt(mx * mx + my * my) + Math.min(Math.max(ox, oy), 0);
}

// Holes are bucketed by column so a lookup only checks the few nearby. A bucket holds every hole within
// REACH of it, far enough for the widest shadow blur and offset.
const BUCKET = 32;
const REACH = 0.08;

function holeField(
  holes: Hole[],
  span: number,
): ((x: number, y: number) => number) | null {
  if (holes.length === 0) return null;
  const buckets: Hole[][] = Array.from(
    { length: Math.ceil(span * BUCKET) + 1 },
    () => [],
  );
  for (const hole of holes) {
    const from = Math.floor((hole.x - hole.hw - REACH + PAD) * BUCKET);
    const to = Math.floor((hole.x + hole.hw + REACH + PAD) * BUCKET);
    for (let b = Math.max(0, from); b <= Math.min(buckets.length - 1, to); b++)
      buckets[b].push(hole);
  }
  return (x, y) => {
    const list = buckets[Math.floor((x + PAD) * BUCKET)];
    let d = Infinity;
    if (list)
      for (let i = 0; i < list.length; i++) {
        const h = holeDistance(list[i], x, y);
        if (h < d) d = h;
      }
    return d;
  };
}

// A layer shades the layers up to this many steps behind it. Further back, its shadow is too faint to matter.
const MAX_CAST = 3;
// A shadow's blur across `dz` steps of depth. Each step also moves the shadow along the light.
const blurFor = (dz: number) => 0.005 + 0.007 * dz;
// How much light each shadow takes away, at its darkest.
const SHADOW = 0.42;
// The thin bright rim where the paper is cut and its edge catches the light.
const RIM = 0.0022;

type Scene = "forest" | "village" | "sea";
const SCENES: readonly Scene[] = ["forest", "village", "sea"];

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const between = (a: number, b: number) => a + (b - a) * rand();
  const salt = () => Math.floor(rand() * 2 ** 32);

  const unit = Math.min(width, height);
  const W = width / unit;
  const H = height / unit;
  const px = 1 / unit;

  const scene = SCENES[Math.floor(rand() * SCENES.length)];
  const count = 3 + Math.floor(rand() * 3);
  const night = rand() < 0.35;

  // Colors: the sky panel a pale wash of paper, the layers stepping from near it to the darkest ink at the
  // front, through a middle ink on some stamps. The cut-out sun shows a warm ink behind the panel. The moon
  // shows bare paper behind a darker night sky.
  const paperRgb = rgb(paper);
  const dark = rgb(inks[0]);
  const accent = rgb(inks[inks.length - 1]);
  const mid = rgb(inks[inks.length > 2 ? 1 : inks.length - 1]);
  const sky = night
    ? mix(paperRgb, dark, between(0.3, 0.45))
    : mix(paperRgb, mid, between(0.1, 0.25));
  const glow = night ? paperRgb : mix(paperRgb, accent, between(0.6, 0.85));
  const twoTone = rand() < 0.55;
  const tone = (u: number): Rgb =>
    twoTone
      ? u < 0.6
        ? mix(sky, mid, u / 0.6)
        : mix(mid, dark, (u - 0.6) / 0.4)
      : mix(sky, dark, u);

  // Light from the upper left or right, so shadows fall away from it, mostly sideways and a little down.
  const side = rand() < 0.5 ? -1 : 1;
  const lightX = side * between(0.004, 0.007);
  const lightY = between(0.001, 0.003);

  // The sun or moon, cut out of the sky panel. A moon is a crescent: the cut leaves a disc of sky on it.
  const disc = {
    x: W * between(0.2, 0.8),
    y: H * between(0.13, 0.3),
    r: between(0.07, 0.12),
  };
  const bite = {
    x: disc.x + side * disc.r * between(0.35, 0.55),
    y: disc.y - disc.r * between(0, 0.3),
    r: disc.r * between(0.8, 0.95),
  };
  const skyHoles = (x: number, y: number) => {
    const dx = x - disc.x;
    const dy = y - disc.y;
    const d = Math.sqrt(dx * dx + dy * dy) - disc.r;
    if (!night) return d;
    const bx = x - bite.x;
    const by = y - bite.y;
    return Math.max(d, bite.r - Math.sqrt(bx * bx + by * by));
  };

  // Profiles: one per scenery layer, back to front, built as a ridge with things standing on it.
  const span = W + 2 * PAD;
  const cols = Math.ceil(span * GRID) + 2;
  const xAt = (g: number) => g / GRID - PAD;

  // Things stand on the ridge at its lowest point under them, so their base never floats above it.
  const groundUnder = (ridge: (x: number) => number, x: number, hw: number) =>
    Math.max(ridge(x - hw), ridge(x), ridge(x + hw)) + 0.004;
  // Raises the profile to the shape `f` between two x positions, in either order.
  const raise = (
    top: Float64Array,
    x0: number,
    x1: number,
    f: (x: number) => number,
  ) => {
    const from = Math.max(0, Math.floor((Math.min(x0, x1) + PAD) * GRID));
    const to = Math.min(
      top.length - 1,
      Math.ceil((Math.max(x0, x1) + PAD) * GRID),
    );
    for (let g = from; g <= to; g++) {
      const y = f(xAt(g));
      if (y < top[g]) top[g] = y;
    }
  };
  const arc = (top: Float64Array, x: number, y: number, r: number) =>
    raise(top, x - r, x + r, (u) => {
      const dx = u - x;
      return y - Math.sqrt(Math.max(0, r * r - dx * dx));
    });

  // A tiered pine, or a round tree with a lumpy crown, `h` tall.
  const tree = (
    top: Float64Array,
    ridge: (x: number) => number,
    x: number,
    h: number,
    pine: boolean,
    crown = h * between(0.2, 0.25),
  ) => {
    const hw = pine ? h * between(0.24, 0.32) : crown / 0.62;
    const ground = groundUnder(ridge, x, hw);
    if (pine) {
      // Three tiers, each a triangle narrower and higher than the one below.
      for (let t = 0; t < 3; t++) {
        const apex = ground - h * (0.48 + 0.26 * t);
        const foot = ground - h * (0.06 + 0.3 * t);
        const w = hw * (1 - 0.24 * t);
        raise(
          top,
          x - w,
          x + w,
          (u) => apex + ((foot - apex) * Math.abs(u - x)) / w,
        );
      }
    } else {
      const r = hw * 0.62;
      arc(top, x, ground - h + r, r);
      arc(top, x - r * 0.75, ground - h + r * 1.55, r * 0.68);
      arc(top, x + r * 0.75, ground - h + r * 1.45, r * 0.72);
    }
  };

  // A row of trees along a layer, close enough to read as woods, with the odd gap.
  const forestRow = (
    top: Float64Array,
    ridge: (x: number) => number,
    size: number,
    pines: number,
  ) => {
    let x = -PAD + size * rand();
    while (x < W + PAD) {
      if (rand() < 0.85)
        tree(top, ridge, x, size * between(0.6, 1.3), rand() < pines);
      x += size * between(0.3, 0.6);
    }
  };

  // Houses along a layer: walls and a gabled roof, with windows cut out, and now and then a church.
  const village = (
    top: Float64Array,
    ridge: (x: number) => number,
    size: number,
    holes: Hole[],
  ) => {
    let x = -PAD + size * between(0.3, 1);
    let church = rand() < 0.5;
    while (x < W + PAD) {
      const steeple = church && x > W * 0.2 && rand() < 0.4;
      if (steeple) church = false;
      const hw = size * (steeple ? between(0.2, 0.26) : between(0.4, 0.62));
      const wall = size * (steeple ? between(1.4, 1.8) : between(0.55, 0.85));
      const roof = steeple ? hw * between(2.2, 3) : hw * between(0.6, 1.05);
      const eave = hw * 0.12;
      const ground = groundUnder(ridge, x, hw);
      const eaves = ground - wall;
      raise(top, x - hw, x + hw, () => eaves);
      raise(top, x - hw - eave, x + hw + eave, (u) => {
        const t = Math.abs(u - x) / (hw + eave);
        return eaves - roof * (1 - t) + eave * 0.6 * t;
      });
      // A chimney on one slope.
      if (!steeple && rand() < 0.5) {
        const cx = x + (rand() < 0.5 ? -1 : 1) * hw * 0.45;
        raise(
          top,
          cx - size * 0.06,
          cx + size * 0.06,
          () => eaves - roof * 0.8,
        );
      }
      // Windows sit above the highest ground under the house, so they're cut through the wall, not the hill.
      const sill =
        Math.min(ridge(x - hw), ridge(x), ridge(x + hw)) - size * 0.06;
      const win = size * 0.08;
      const rows = steeple ? 2 : 1;
      for (let r = 0; r < rows; r++) {
        const wy = eaves + wall * (steeple ? 0.15 + 0.3 * r : 0.25) + win;
        if (wy + win > sill) break;
        const across = steeple ? 1 : hw > size * 0.5 ? 3 : 2;
        for (let i = 0; i < across; i++)
          holes.push({
            x: across === 1 ? x : x - hw * 0.55 + (hw * 1.1 * i) / (across - 1),
            y: wy,
            hw: win * (steeple ? 0.7 : 0.75),
            hh: win * (steeple ? 1.6 : 1),
            round: false,
          });
      }
      if (!steeple && rand() < 0.35)
        holes.push({
          x,
          y: eaves - roof * 0.38,
          hw: Math.min(roof * 0.16, hw * 0.2),
          hh: 0,
          round: true,
        });
      x += hw * 2 + size * between(0.12, 0.7);
    }
  };

  // A sailboat riding a wave: a hull, a mast, and a mainsail and jib, with sky between them, the mast and the
  // deck.
  const boat = (
    top: Float64Array,
    ridge: (x: number) => number,
    x: number,
    size: number,
    holes: Hole[],
  ) => {
    const hw = size * between(0.55, 0.8);
    const hull = size * between(0.18, 0.24);
    // It floats on the highest water under it, so no crest swamps the hull.
    const deck = Math.min(ridge(x - hw), ridge(x), ridge(x + hw)) - hull;
    const facing = rand() < 0.5 ? -1 : 1;
    // The hull's ends rake from its deck down to the water.
    raise(top, x - hw, x + hw, (u) => {
      const t = Math.abs(u - x) / hw;
      return t < 0.7 ? deck : deck + (hull * (t - 0.7)) / 0.3;
    });
    const mast = size * between(1.2, 1.6);
    const mx = x - facing * hw * 0.12;
    const gap = size * 0.07;
    const foot = deck - size * 0.12;
    raise(top, mx - size * 0.02, mx + size * 0.02, () => deck - mast);
    // A sail is a triangle with its luff `gap` off the mast, a slit of sky cut under its foot.
    const sail = (dir: number, length: number, peak: number) => {
      const luff = mx + dir * gap;
      raise(top, luff, luff + dir * length, (u) => {
        const t = Math.abs(u - luff) / length;
        return deck - peak + (foot - deck + peak) * t;
      });
      holes.push({
        x: luff + (dir * length) / 2,
        y: (foot + deck) / 2,
        hw: length / 2,
        hh: (deck - foot) / 2,
        round: false,
      });
    };
    // The mainsail trails the mast, and the jib runs forward toward the bow.
    sail(-facing, hw * between(0.7, 0.9), mast * 0.95);
    sail(facing, hw * 0.85 - gap, mast * 0.8);
  };

  // Round trees spaced out along a layer, each crown on a trunk with sky either side.
  const orchard = (
    top: Float64Array,
    ridge: (x: number) => number,
    size: number,
    holes: Hole[],
  ) => {
    let x = -PAD + size * rand();
    while (x < W + PAD) {
      const h = size * between(0.8, 1.2);
      const r = h * 0.3;
      const reach = r * 1.5;
      tree(top, ridge, x, h, false, r);
      // Cut away under the crown down to the highest ground beneath it, so the hill itself is never cut.
      const crown = groundUnder(ridge, x, reach) - h + r * 2.1;
      const ground =
        Math.min(ridge(x - reach), ridge(x), ridge(x + reach)) - 0.003;
      const trunk = r * 0.14;
      if (ground - crown > r * 0.25)
        for (const dir of [-1, 1])
          holes.push({
            x: x + (dir * (reach + trunk)) / 2,
            y: (crown + ground) / 2,
            hw: (reach - trunk) / 2,
            hh: (ground - crown) / 2,
            round: false,
          });
      x += r * between(3.4, 4.6);
    }
  };

  const boatLayer =
    scene === "sea" && rand() < 0.85
      ? count - 1 - Math.floor(rand() * Math.min(2, count - 1))
      : -1;
  const houseLayers =
    scene === "village"
      ? new Set([count - 2, count - 2 - Math.floor(rand() * 2)])
      : new Set<number>();

  // Every sheet, back to front: the backing that shows through the sun or moon, the sky panel, then scenery.
  // A panel's `top` is null. A sheet's index is its depth.
  const colors: Rgb[] = [glow, sky];
  const tops: (Profile | null)[] = [null, null];
  const cuts: (((x: number, y: number) => number) | null)[] = [null, skyHoles];
  // Each profile blurred for each depth gap it casts across, 1 to MAX_CAST.
  const blurred: Profile[][] = [[], []];

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const noise = ridgeNoise(rand);
    const base = H * (0.5 + 0.38 * t + 0.03 * rand());
    // Things on nearer layers are bigger.
    const size = 0.06 + 0.07 * t;
    let ridge: (x: number) => number;
    if (scene === "sea" && (i > 0 || rand() < 0.6)) {
      // Waves: scallops meeting in pointed crests, swelling on a slow roll, leaning one way.
      const period = 0.07 + 0.09 * t + 0.03 * rand();
      const amp = 0.018 + 0.03 * t;
      const phase = rand();
      const lean = between(-0.5, 0.5);
      const freq = between(0.8, 1.6);
      ridge = (x) => {
        const p = x / period + phase;
        const f = p - Math.floor(p);
        const g = f + lean * f * (1 - f);
        return (
          base + 0.05 * (noise(x * freq) - 0.5) - amp * (1 - 4 * g * (1 - g))
        );
      };
    } else {
      // Hills, gentler in a village. A back layer is sometimes a range of sharp peaks.
      const peaks = i === 0 && scene !== "village" && rand() < 0.5;
      const amp = (scene === "village" ? 0.06 : 0.14) * (1 - 0.5 * t);
      const freq = between(1.2, 2.6);
      ridge = peaks
        ? (x) =>
            base -
            amp * 1.4 * (1 - 2 * Math.abs(noise(x * freq * 1.5) - 0.5)) +
            amp * 0.3
        : (x) => base - amp * noise(x * freq);
    }
    const top = new Float64Array(cols);
    for (let g = 0; g < cols; g++) top[g] = ridge(xAt(g));
    const holes: Hole[] = [];
    if (scene === "forest" && rand() < 0.8) {
      if (i === count - 1 && rand() < 0.3)
        orchard(top, ridge, size * 1.6, holes);
      else forestRow(top, ridge, size * 1.6, rand() < 0.7 ? 0.85 : 0.35);
    }
    if (houseLayers.has(i)) village(top, ridge, size * 1.25, holes);
    else if (scene === "village" && rand() < 0.5)
      orchard(top, ridge, size * 1.2, holes);
    if (i === boatLayer)
      boat(top, ridge, W * between(0.25, 0.75), size * 1.5, holes);
    const cut = boxed(top, 2);
    colors.push(tone(0.25 + (0.75 * i) / (count - 1)));
    tops.push(profile(cut));
    cuts.push(holeField(holes, span));
    blurred.push(
      Array.from({ length: MAX_CAST }, (_, k) =>
        profile(boxed(cut, Math.round(blurFor(k + 1) * GRID))),
      ),
    );
  }

  // The box's front frame, two steps in front of the front layer. Sometimes it shows as a band of paper or ink,
  // and always it shades the edges.
  const F = colors.length;
  const band = rand() < 0.55 ? between(0.028, 0.045) : 0;
  colors.push(rand() < 0.5 ? dark : mix(paperRgb, dark, 0.06));
  const frameZ = F + 1;
  const frameSolid = (x: number, y: number) =>
    band - Math.min(x, W - x, y, H - y);

  const textureSalt = salt();
  // The fine fibre only shows once a draw is large enough to resolve it.
  const fine = clamp01(1.5 - 640 * px);

  // Every profile sampled at the pixel columns: each sheet's edge, and each blurred edge where it falls as a
  // shadow, moved along the light by its depth gap.
  const edges = tops.map((top) => top && columns(top, width, px, 0));
  const shadows = blurred.map((list) =>
    list.map((blur, k) => columns(blur, width, px, lightX * (k + 1))),
  );

  // How far into a sheet's paper a point in column `c` is, negative outside it. The backing is everywhere.
  const solid = (k: number, c: number, x: number, y: number): number => {
    if (k === F) return frameSolid(x, y);
    const edge = edges[k];
    let d = Infinity;
    if (edge) {
      // Holes only take paper away, so a point well above the profile is outside the sheet either way.
      if (y < edge[c * 3 + 2] - px) return -Infinity;
      d = (y - edge[c * 3]) * edge[c * 3 + 1];
    }
    const holes = cuts[k];
    if (!holes) return d;
    const h = holes(x, y);
    return h < d ? h : d;
  };

  // How much of the light reaching sheet `k` at a point sheet `i`, in front of it, blocks.
  const occlusion = (
    i: number,
    k: number,
    c: number,
    x: number,
    y: number,
  ): number => {
    const dz = (i === F ? frameZ : i) - k;
    const b = blurFor(dz);
    const sx = x - lightX * dz;
    const sy = y - lightY * dz;
    if (i === F) return soft(frameSolid(sx, sy) / b);
    let edge = 1;
    if (tops[i]) {
      const blur = shadows[i][dz - 1];
      if (sy < blur[c * 3 + 2] - b) return 0;
      edge = soft(((sy - blur[c * 3]) * blur[c * 3 + 1]) / b);
    }
    const holes = cuts[i];
    return holes && edge > 0 ? edge * soft(holes(sx, sy) / b) : edge;
  };

  // A sheet's color at a point, into `out`: its paper, mottled a little, darkened by the shadows on it, with a
  // bright rim along its cut edge `d` away.
  const out = new Float64Array(3);
  const shaded = (k: number, c: number, x: number, y: number, d: number) => {
    let lit = 1;
    const last = Math.min(k + MAX_CAST, F - 1);
    for (let i = k + 1; i <= last; i++)
      lit *= 1 - SHADOW * occlusion(i, k, c, x, y);
    if (k !== F) lit *= 1 - SHADOW * occlusion(F, k, c, x, y);
    let fibre = 0.025 * (noise2(x * 40 + k * 7.3, y * 40, textureSalt) - 0.5);
    if (fine > 0)
      fibre +=
        0.03 *
        fine *
        (noise2(x * 160, y * 160 + k * 5.1, textureSalt + 1) - 0.5);
    const shade = lit * (1 + fibre);
    const rim = 0.3 * (clamp01(d / px + 0.5) - clamp01((d - RIM) / px + 0.5));
    const color = colors[k];
    for (let ch = 0; ch < 3; ch++) {
      const v = color[ch] * shade;
      out[ch] = v + (paperRgb[ch] - v) * rim;
    }
  };

  const image = ctx.createImageData(width, height);
  const data = image.data;
  const depth = new Float64Array(F + 1);
  for (let py = 0; py < height; py++) {
    const y = (py + 0.5) * px;
    for (let pxi = 0; pxi < width; pxi++) {
      const x = (pxi + 0.5) * px;
      // Down from the front to the first sheet that fully covers the point. Only it and what's in front show.
      let j = 0;
      for (let k = F; k > 0; k--) {
        const d = solid(k, pxi, x, y);
        depth[k] = d;
        if (d / px + 0.5 >= 1) {
          j = k;
          break;
        }
      }
      shaded(j, pxi, x, y, j === 0 ? Infinity : depth[j]);
      let r = out[0];
      let g = out[1];
      let b = out[2];
      for (let k = j + 1; k <= F; k++) {
        const cover = clamp01(depth[k] / px + 0.5);
        if (cover === 0) continue;
        shaded(k, pxi, x, y, depth[k]);
        r += (out[0] - r) * cover;
        g += (out[1] - g) * cover;
        b += (out[2] - b) * cover;
      }
      const p = (py * width + pxi) * 4;
      data[p] = Math.round(r);
      data[p + 1] = Math.round(g);
      data[p + 2] = Math.round(b);
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export const paperDiorama1: Style = {
  id: "diorama1",
  draw,
};
