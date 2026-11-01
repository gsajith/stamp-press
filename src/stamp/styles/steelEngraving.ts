import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Steel engraving vignette: the classic definitive stamp. A small scene (a lighthouse on a headland, a sailing
// ship, a mountain lake or a stone bridge) sits in an oval, arched or octagonal vignette, inside a frame of
// rules and, usually, a beaded border. Every tone is made of parallel burin lines that swell in shadow and thin
// to hairlines in the light, crossed by a second set only in the deepest darks. The scene prints in the darkest
// ink, and the frame sometimes in a second ink, like a bicolor engraved issue.
//
// Like rosette1 it computes every pixel itself, from positions in art units (the art's short side is 1), so
// it is resolution independent and its pixels match in every browser and in Node, which the golden test relies
// on (ADR 0001). Only IEEE-exact arithmetic here: no Math.sin, Math.pow or the like.

type Rgb = [number, number, number];

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

// Pick an integer in [lo, hi].
const int = (rand: () => number, lo: number, hi: number) =>
  lo + Math.floor(rand() * (hi - lo + 1));

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

// Smooth 1D value noise in [0, 1], two octaves, from a table of seeded values.
function noise1(rand: () => number): (x: number) => number {
  const table = Array.from({ length: 64 }, rand);
  const at = (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = table[i & 63];
    return a + (table[(i + 1) & 63] - a) * f * f * (3 - 2 * f);
  };
  return (x) => (at(x) * 2 + at(x * 2.3 + 17)) / 3;
}

// How much of a stretch `px` wide, centered at `t`, a set of parallel lines covers. The lines sit at
// (k + 0.5) * gap, each `half` wide on either side. It integrates the lines exactly, so lines finer than a pixel
// or packed closer than one average to their share of ink instead of aliasing into moire.
function lines(t: number, gap: number, half: number, px: number): number {
  if (half <= 0) return 0;
  if (half * 2 >= gap) return 1;
  return (run(t + px / 2, gap, half) - run(t - px / 2, gap, half)) / px;
}

// How much ink the lines lay down from 0 to `s`.
function run(s: number, gap: number, half: number): number {
  const k = Math.floor(s / gap);
  const into = s - k * gap - gap / 2 + half;
  return k * 2 * half + (into < 0 ? 0 : into > 2 * half ? 2 * half : into);
}

// The thinnest line an engraver cuts, as a share of the line spacing.
const HAIR = 0.1;
// Tones darker than this get a second, crossing set of lines.
const CROSS = 0.6;

// Small draws are supersampled until the art's short side has this many samples, so shape edges and beads
// finer than a pixel average out. Lines need no supersampling: `lines` covers them exactly.
const MIN_UNIT = 128;

// A layer of the scene. It returns how much of the sample it covers, and sets `tone` (0 is paper, 1 solid
// ink) and `phase`, the position across its lines in art units, for the covered part.
type Layer = (u: number, v: number, col: number) => number;

// A scene: layers back to front (water, at `horizon`, prints between `back` and `front`), and how much a
// reflection darkens the water at a point.
type Scene = {
  horizon: number;
  back: Layer[];
  front: Layer[];
  reflect: (u: number, v: number, col: number) => number;
};

// A profile's top where there is no land, far below the art.
const FAR = 10;

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
  const [W, H] = [width / unit, height / unit];
  const n = Math.max(1, Math.ceil(MIN_UNIT / unit));
  // A sample's size in art units.
  const px = 1 / (unit * n);

  const paperRgb = rgb(paper);
  const darkRgb = rgb(inks[0]);
  // Some issues print the frame in a second ink.
  const frameRgb = rand() < 0.4 ? rgb(inks[1]) : darkRgb;

  // The frame, from the art's edge in: a heavy rule, a row of beads, a thin rule, then a tint of lines up to
  // the vignette. Distances from the art's edge.
  const outerAt = 0.045 + 0.012 * rand();
  const outerEnd = outerAt + 0.008 + 0.006 * rand();
  const beaded = rand() < 0.75;
  const beadR = 0.0055 + 0.002 * rand();
  const beadAt = outerEnd + 0.005 + beadR;
  const innerAt = beaded ? beadAt + beadR + 0.005 : outerEnd + 0.006;
  const innerEnd = innerAt + 0.003 + 0.0015 * rand();
  const fieldAt = innerEnd + 0.004;
  // Beads sit on a rectangle, a whole number to each side with one in every corner.
  const [bx, by] = [W / 2 - beadAt, H / 2 - beadAt];
  const beadGap = beadR * (2.6 + 0.6 * rand());
  const nbx = Math.max(1, Math.round((2 * bx) / beadGap));
  const nby = Math.max(1, Math.round((2 * by) / beadGap));
  const [sbx, sby] = [(2 * bx) / nbx, (2 * by) / nby];
  // The tint between the inner rule and the vignette.
  const tintTone = 0.35 + 0.3 * rand();
  const tintVertical = rand() < 0.3;

  // The vignette, centered, its half sizes A by B. Its edge is a keyline with a little paper either side.
  const shape = int(rand, 0, 2);
  const pad = shape === 0 ? 0.006 + 0.012 * rand() : 0.022 + 0.02 * rand();
  const A = W / 2 - fieldAt - pad;
  const B = H / 2 - fieldAt - pad;
  // An arch's rise, and the circle it's cut from.
  const rise = Math.min(A, B) * (0.55 + 0.45 * rand());
  const archR = (A * A + rise * rise) / (2 * rise);
  const archY = -B + archR;
  const chamfer = Math.min(A, B) * (0.25 + 0.2 * rand());
  const keyAt = 0.004;
  const keyEnd = keyAt + 0.0025 + 0.0015 * rand();
  const tintAt = keyEnd + 0.006;

  // Signed distance to the vignette's edge, negative inside, from its center.
  const vignette = (X: number, Y: number) => {
    const [ax, ay] = [Math.abs(X), Math.abs(Y)];
    if (shape === 0) {
      const qx = X / A;
      const qy = Y / B;
      const q = Math.sqrt(qx * qx + qy * qy);
      if (q < 0.5) return -FAR;
      const gx = qx / A;
      const gy = qy / B;
      return ((q - 1) * q) / Math.sqrt(gx * gx + gy * gy);
    }
    const box = Math.max(ax - A, ay - B);
    if (shape === 1) {
      if (Y >= archY) return box;
      const dy = Y - archY;
      return Math.max(box, Math.sqrt(X * X + dy * dy) - archR);
    }
    return Math.max(box, (ax + ay - (A + B - chamfer)) * Math.SQRT1_2);
  };

  // The scene lives in scene units, where the vignette's half height is 1: u across from its center, v down.
  const S = B;
  const uMax = A / S;
  // Light comes from the left (-1) or the right (1).
  const L = rand() < 0.5 ? -1 : 1;
  const gap = 0.0075 + 0.003 * rand();
  // The second set of lines crosses on a diagonal, a unit vector.
  const [cu, cv] = [
    [0.6, 0.8],
    [-0.6, 0.8],
    [0.8, 0.6],
    [-0.8, 0.6],
  ][int(rand, 0, 3)];

  // Set by each layer for the part of the sample it covers.
  let tone = 0;
  let phase = 0;

  // Profiles of land along the scene, tabulated once per sample column: the top's v and its slope.
  const cols = width * n;
  const colU = (c: number) => ((c + 0.5) * px - W / 2) / S;
  const tabulate = (f: (u: number) => number) => {
    const t = new Float64Array(2 * cols);
    for (let c = 0; c < cols; c++) {
      const u = colU(c);
      const [a, m, b] = [f(u - 1e-4), f(u), f(u + 1e-4)];
      t[2 * c] = m;
      // One-sided where land ends, so the slope never spans the gap to FAR.
      t[2 * c + 1] =
        m >= FAR
          ? 0
          : a >= FAR
            ? (b - m) / 1e-4
            : b >= FAR
              ? (m - a) / 1e-4
              : (b - a) / 2e-4;
    }
    return t;
  };
  // How far a point lies below a profile's top, in art units, measured square to the top.
  const below = (tab: Float64Array, col: number, v: number) => {
    const slope = tab[2 * col + 1];
    return ((v - tab[2 * col]) * S) / Math.sqrt(1 + slope * slope);
  };
  // How much of a sample a distance inside an edge covers, in art units and scene units.
  const edge = (d: number) => clamp01(d / px + 0.5);
  const edgeS = (d: number) => clamp01((d * S) / px + 0.5);
  // How much of a sample `d` from an edge lies between `lo` and `hi`.
  const band = (d: number, lo: number, hi: number) =>
    clamp01((Math.min(d + px / 2, hi) - Math.max(d - px / 2, lo)) / px);

  // A filled triangle, given its corners: each edge as (a, b, c), where a u + b v + c is the distance inside.
  const triangle = (p: [number, number][]) => {
    const [[x0, y0], [x1, y1], [x2, y2]] = p;
    const sign = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0) > 0 ? 1 : -1;
    const t = new Float64Array(9);
    for (let k = 0; k < 3; k++) {
      const [ax, ay] = p[k];
      const [bx2, by2] = p[(k + 1) % 3];
      const l = Math.sqrt((bx2 - ax) * (bx2 - ax) + (by2 - ay) * (by2 - ay));
      const a = ((ay - by2) / l) * sign;
      const b = ((bx2 - ax) / l) * sign;
      t[3 * k] = a;
      t[3 * k + 1] = b;
      t[3 * k + 2] = -(a * ax + b * ay);
    }
    return (u: number, v: number) =>
      edgeS(
        Math.min(
          t[0] * u + t[1] * v + t[2],
          t[3] * u + t[4] * v + t[5],
          t[6] * u + t[7] * v + t[8],
        ),
      );
  };

  // The sky: lines darkest at the top, thinning to hairlines at the horizon, broken by clouds.
  const skyTop = 0.32 + 0.22 * rand();
  const skyLow = 0.02 + 0.04 * rand();
  const clouds = rand() < 0.65;
  const cloudAt = 0.52 + 0.1 * rand();
  const cloudSalt = salt();
  const waterSalt = salt();
  // A beam of light across the sky, set by a scene, as a unit direction from a point.
  let beam: [number, number, number, number] | null = null;
  const skyLayer =
    (horizon: number): Layer =>
    (u, v) => {
      let t = skyTop + (skyLow - skyTop) * clamp01((v + 1) / (horizon + 1));
      if (clouds) {
        const c =
          0.65 * noise2(u * 1.4, v * 4.5, cloudSalt) +
          0.35 * noise2(u * 3.1, v * 9, cloudSalt + 1);
        t *= 1 - 0.9 * smooth((c - cloudAt) / 0.08);
      }
      if (beam) {
        const [bu, bv, du, dv] = beam;
        const along = (u - bu) * du + (v - bv) * dv;
        const across = Math.abs((u - bu) * dv - (v - bv) * du);
        if (along > 0)
          t *= 1 - 0.85 * smooth((0.03 + 0.14 * along - across) / 0.03);
      }
      tone = t;
      phase = v * S;
      return 1;
    };

  const scene = [lighthouse, ship, lake, bridge][int(rand, 0, 3)]();
  const { horizon } = scene;

  // The water: lines a little darker toward the viewer, broken into ripples, darker under reflections.
  const waterLayer: Layer = (u, v, col) => {
    const c = edgeS(v - horizon);
    if (c === 0) return 0;
    const near = clamp01((v - horizon) / (1 - horizon));
    const ripple = noise2(u * 2.2, (v * 26) / (0.25 + near), waterSalt);
    tone =
      0.16 +
      0.3 * near +
      0.32 * (ripple - 0.5) +
      scene.reflect(u, v, col) * (1 - 0.6 * near) * (0.5 + ripple);
    phase = v * S + gap * 0.3 * (noise2(u * 9, v * 4, waterSalt + 1) - 0.5);
    return c;
  };
  const layers = [skyLayer(horizon), ...scene.back, waterLayer, ...scene.front];

  function lighthouse(): Scene {
    const horizon = 0.18 + 0.2 * rand();
    // The headland rises on side D, its cliff edge `edgeAt` from the center toward D.
    const D = rand() < 0.5 ? -1 : 1;
    const edgeAt = -0.15 + 0.3 * rand();
    const height = 0.2 + 0.18 * rand();
    const steep = 0.04 + 0.06 * rand();
    const lumps = noise1(rand);
    const grassSalt = salt();
    const head = (u: number) => {
      const g = D * u - edgeAt;
      if (g <= 0) return FAR;
      return (
        horizon +
        0.03 -
        height * smooth(g / steep) * (0.95 + 0.1 * lumps(g * 2.5)) -
        0.08 * smooth(g / 1.2)
      );
    };
    const top = tabulate(head);
    // The headland's foot comes toward the viewer as it nears the frame.
    const foot = (u: number) =>
      horizon + 0.03 + 0.5 * smooth((D * u - edgeAt) / 0.9);
    const faceLit = L === -D;
    const headland: Layer = (u, v, col) => {
      const depth = below(top, col, v);
      const c = edge(depth) * edgeS(foot(u) - v);
      if (c === 0) return 0;
      const cliff = clamp01(Math.abs(top[2 * col + 1]) / 3);
      const grass = 0.4 + 0.25 * (noise2(u * 7, v * 14, grassSalt) - 0.5);
      tone =
        cliff * (faceLit ? 0.3 : 0.82) +
        (1 - cliff) * grass +
        0.3 * clamp01(depth / (0.3 * S));
      phase = depth;
      return c;
    };

    // The tower stands back from the cliff edge, narrowing upward, with a gallery, a lantern and a cap.
    const at = Math.min(
      steep + 0.08 + 0.15 * rand(),
      Math.max(steep + 0.05, uMax - edgeAt - 0.2),
    );
    const tu = D * (edgeAt + at);
    const base = head(tu) + 0.02;
    const tall = Math.min(0.42 + 0.25 * rand(), base + 0.62);
    const [w0, w1] = [0.07 + 0.02 * rand(), 0.045 + 0.01 * rand()];
    const gallery = base - tall;
    const lantern = gallery - 0.03;
    const glass = lantern - 0.07 - 0.03 * rand();
    const capTop = glass - 0.06;
    const bands = rand() < 0.5 ? int(rand, 2, 4) : 0;
    const cap = triangle([
      [tu - w1 * 0.9, glass],
      [tu + w1 * 0.9, glass],
      [tu, capTop],
    ]);
    const tower: Layer = (u, v) => {
      if (v < capTop - 0.01 || v > base + 0.01) return 0;
      const du = u - tu;
      const side = (half: number) => edgeS(half - Math.abs(du));
      if (v > gallery) {
        const half = w0 + ((w1 - w0) * (base - v)) / tall;
        const across = du / half;
        tone = 0.06 + 0.78 * smooth(0.5 - L * across * 0.8);
        if (
          bands > 0 &&
          Math.floor(((base - v) / tall) * (2 * bands + 1)) % 2 === 1
        )
          tone = Math.max(tone + 0.4, 0.62);
        phase = u * S;
        return side(half) * edgeS(base - v);
      }
      if (v > lantern) {
        tone = 0.85;
        phase = v * S;
        return side(w1 + 0.03) * edgeS(gallery - v);
      }
      if (v > glass) {
        tone = 0.12;
        phase = u * S;
        return side(w1 * 0.75);
      }
      tone = 0.8;
      phase = u * S;
      return cap(u, v);
    };
    // Some keep their light on, a beam out to sea.
    if (rand() < 0.5) {
      const [du, dv] = [-D, -0.05 - 0.2 * rand()];
      const l = Math.sqrt(du * du + dv * dv);
      beam = [tu, (glass + lantern) / 2, du / l, dv / l];
    }
    return {
      horizon,
      back: [],
      front: [headland, tower],
      reflect: (_u, v, col) => {
        const m = 2 * horizon - v;
        return m > top[2 * col] && m < horizon ? 0.3 : 0;
      },
    };
  }

  // A distant shore along the horizon, up to `high` tall, pale, its lines following its ridge. Taller shores
  // roll more gently, so their lines don't crowd.
  function coast(horizon: number, high: number): Layer {
    const ridge = noise1(rand);
    const lift = high * (0.4 + 0.6 * rand());
    const freq = 2.5 * Math.min(1, 0.15 / high);
    const top = tabulate((u) => horizon - lift * ridge(u * freq + 3));
    return (_u, v, col) => {
      const depth = below(top, col, v);
      const c = edge(depth);
      if (c === 0) return 0;
      tone = 0.22 + 0.15 * clamp01(depth / (0.1 * S));
      phase = depth;
      return c;
    };
  }

  function ship(): Scene {
    const horizon = 0.12 + 0.22 * rand();
    const dir = rand() < 0.5 ? -1 : 1;
    const half = Math.min(uMax * 0.68, 0.38 + 0.22 * rand());
    const mid = (rand() - 0.5) * 2 * Math.max(0, uMax - half - 0.15);
    const keel = horizon + 0.02;
    const deep = 0.09 + 0.05 * rand();
    const deck = (u: number) => {
      const t = (u - mid) / half;
      return keel - deep - 0.05 * t * t;
    };
    // How far inside the hull, in scene units: under the deck, above the water, and between the stern and the
    // bow, which rakes back toward the keel.
    const inHull = (u: number, v: number) => {
      const t = clamp01((v - deck(u)) / (keel - deck(u)));
      const along = dir * (u - mid);
      return Math.min(
        v - deck(u),
        keel - v,
        along + half * (1 - 0.06 * t),
        half * (1 - 0.3 * t) - along,
      );
    };
    const hull: Layer = (u, v) => {
      const d = inHull(u, v);
      if (d < -0.05) return 0;
      tone = v - deck(u) < 0.025 ? 0.28 : 0.82;
      phase = v * S;
      return edgeS(d);
    };

    // Two or three masts, the middle one tallest, each with a stack of square sails and a yard over each.
    const masts = int(rand, 2, 3);
    const rig: { u: number; top: number; sails: number[] }[] = [];
    const tallest = Math.min(0.58 + 0.25 * rand(), keel - deep + 0.86);
    for (let i = 0; i < masts; i++) {
      const u = mid + dir * half * (-0.55 + (1.15 * i) / (masts - 1)) * 0.8;
      const top = deck(u) - tallest * (i === 1 ? 1 : 0.86);
      const count = int(rand, 2, 3);
      const from = deck(u) - 0.07;
      const to = top + 0.07;
      const sails = Array.from(
        { length: count + 1 },
        (_, k) => from + ((to - from) * k) / count,
      );
      rig.push({ u, top, sails });
    }
    const spread = (0.15 + 0.05 * rand()) * Math.min(1, half / 0.45);
    const shade = rand() < 0.5 ? 1 : -1;
    const sails: Layer = (u, v) => {
      for (const { u: mu, top, sails } of rig) {
        const du = u - mu;
        if (Math.abs(du) > spread + 0.03 || v < top - 0.01) continue;
        // The mast, with a yard across the top of every sail.
        const mast =
          edgeS(0.007 - Math.abs(du)) * edgeS(Math.min(v - top, deck(mu) - v));
        for (let k = 1; k < sails.length; k++) {
          const [low, high] = [sails[k - 1], sails[k]];
          const w = spread * (1 - 0.14 * k);
          const yard =
            edgeS(0.006 - Math.abs(v - high)) * edgeS(w + 0.02 - Math.abs(du));
          if (yard > 0 || mast > 0) {
            tone = 0.9;
            phase = v * S;
            return Math.max(yard, mast);
          }
          if (v > low || v < high) continue;
          // Down the sail from 0 to 1, bellied so its lines bow.
          const s = (v - high) / (low - high);
          const belly = 1 - (2 * s - 1) * (2 * s - 1);
          const wide = w * (0.88 + 0.12 * s) + 0.015 * belly;
          tone =
            0.08 +
            0.32 * smooth(0.5 + shade * L * (du / wide) * 0.9) +
            0.12 * s;
          phase = (du - 0.25 * wide * belly * (du / wide)) * S;
          return (
            edgeS(wide - Math.abs(du)) *
            edgeS(Math.min(v - high, low - v) - 0.006)
          );
        }
        if (mast > 0) {
          tone = 0.9;
          phase = v * S;
          return mast;
        }
      }
      return 0;
    };
    // A jib from the bowsprit to the foremast, and a pennant at the main top.
    const fore = rig[dir > 0 ? rig.length - 1 : 0];
    const tip = mid + dir * (half + 0.16);
    const jib = triangle([
      [tip, deck(mid + dir * half) - 0.03],
      [fore.u + dir * 0.02, fore.top + 0.08],
      [fore.u + dir * 0.02, deck(fore.u) - 0.08],
    ]);
    const main = rig[1];
    const pennant = triangle([
      [main.u, main.top],
      [main.u, main.top + 0.035],
      [main.u - dir * 0.12, main.top + 0.012],
    ]);
    const headsails: Layer = (u, v) => {
      const p = pennant(u, v);
      if (p > 0) {
        tone = 0.85;
        phase = v * S;
        return p;
      }
      tone = 0.1 + 0.25 * clamp01((v - fore.top) / 0.6);
      phase = (u + 0.4 * v) * S;
      return jib(u, v);
    };
    return {
      horizon,
      back: rand() < 0.7 ? [coast(horizon, 0.15)] : [],
      front: [headsails, sails, hull],
      reflect: (u, v) => (inHull(u, 2 * horizon - v) > 0 ? 0.35 : 0),
    };
  }

  // Mountains as overlapping peaks, each lit on one flank and shaded on the other, snow on the heights.
  function mountains(horizon: number, high: number, toneAt: number) {
    const count = int(rand, 2, 4);
    const peaks = Array.from({ length: count }, (_, i) => ({
      at: (-1 + (2 * (i + 0.2 + 0.6 * rand())) / count) * uMax,
      high: high * (0.55 + 0.45 * rand()),
      steep: 0.8 + 0.8 * rand(),
    }));
    const rough = noise1(rand);
    const owner = new Float64Array(cols);
    const height = (u: number) => {
      let best = -FAR;
      for (const p of peaks)
        best = Math.max(best, p.high - p.steep * Math.abs(u - p.at));
      return (
        Math.max(0.02, best) +
        0.04 * (rough(u * 7) - 0.5) +
        0.015 * (rough(u * 23 + 5) - 0.5)
      );
    };
    for (let c = 0; c < cols; c++) {
      const u = colU(c);
      let best = -FAR;
      for (const p of peaks) {
        const h = p.high - p.steep * Math.abs(u - p.at);
        if (h > best) {
          best = h;
          owner[c] = p.at;
        }
      }
    }
    const top = tabulate((u) => horizon - height(u));
    const snowAt = horizon - high * (0.55 + 0.2 * rand());
    const gullySalt = salt();
    const layer: Layer = (u, v, col) => {
      const depth = below(top, col, v);
      const c = edge(depth);
      if (c === 0) return 0;
      const gully = noise2(u * 6, v * 5, gullySalt) - 0.5;
      // The terminator runs down from each peak, ragged with gullies.
      const shadow = smooth(
        0.5 - (L * (u - owner[col] + 0.3 * gully * (v - top[2 * col]))) / 0.05,
      );
      let t = toneAt + 0.42 * shadow + 0.15 * gully;
      const snow = smooth((snowAt - v) / 0.04 + 2 * gully);
      t *= 1 - snow * (shadow > 0.5 ? 0.45 : 0.85);
      tone = t;
      phase = depth;
      return c;
    };
    return { top, layer };
  }

  // A dark bank on one side, in front of the water, with pines on it.
  function bank(horizon: number) {
    const D = rand() < 0.5 ? -1 : 1;
    const from = 0.05 + 0.3 * rand() * uMax;
    const lift = 0.06 + 0.12 * rand();
    const lumps = noise1(rand);
    const groundSalt = salt();
    const ground = (u: number) => {
      const g = D * u - from;
      if (g <= 0) return FAR;
      return (
        horizon + 0.06 - lift * smooth(g / 0.35) * (0.85 + 0.3 * lumps(g * 2))
      );
    };
    const top = tabulate(ground);
    const foot = (u: number) =>
      horizon + 0.07 + 0.6 * smooth((D * u - from) / 0.8);
    const land: Layer = (u, v, col) => {
      const depth = below(top, col, v);
      const c = edge(depth) * edgeS(foot(u) - v);
      if (c === 0) return 0;
      tone =
        0.55 +
        0.25 * clamp01(depth / (0.2 * S)) +
        0.2 * (noise2(u * 9, v * 9, groundSalt) - 0.5);
      phase = depth;
      return c;
    };
    // Pines in tiers, each tier widest at its foot.
    const pines = Array.from({ length: int(rand, 1, 4) }, () => {
      const u = D * (from + 0.15 + (uMax - from) * rand());
      return {
        u,
        foot: ground(u) + 0.02,
        tall: 0.22 + 0.35 * rand(),
        wide: 0.08 + 0.04 * rand(),
        tiers: int(rand, 4, 7),
      };
    }).filter((p) => p.foot < FAR);
    const trees: Layer = (u, v) => {
      for (const p of pines) {
        const t = (p.foot - v) / p.tall;
        if (t < -0.05 || t > 1.05) continue;
        const du = u - p.u;
        if (Math.abs(du) > p.wide + 0.01) continue;
        const tier = t * p.tiers - Math.floor(t * p.tiers);
        const w = p.wide * (1 - t) * (1 - 0.45 * tier) + 0.008;
        const c =
          edgeS(w - Math.abs(du)) *
          edgeS(Math.min(p.foot - v, v - (p.foot - p.tall)));
        if (c === 0) continue;
        tone = 0.72 + 0.18 * smooth(0.5 - (L * du) / (p.wide * 0.6));
        phase = ((v + 0.6 * Math.abs(du)) * S) / 1.17;
        return c;
      }
      return 0;
    };
    return { land, trees };
  }

  function lake(): Scene {
    const horizon = 0.08 + 0.2 * rand();
    const far = mountains(
      horizon,
      Math.min(0.62 + 0.3 * rand(), horizon + 0.92),
      0.14,
    );
    const back = [far.layer];
    // Sometimes a lower, darker range in front.
    const near =
      rand() < 0.5 ? mountains(horizon, 0.22 + 0.15 * rand(), 0.3) : null;
    if (near) back.push(near.layer);
    const shore = bank(horizon);
    return {
      horizon,
      back,
      front: [shore.land, shore.trees],
      reflect: (_u, v, col) => {
        const m = 2 * horizon - v;
        if (m >= horizon) return 0;
        if (near && m > near.top[2 * col]) return 0.32;
        return m > far.top[2 * col] ? 0.22 : 0;
      },
    };
  }

  function bridge(): Scene {
    const horizon = 0.15 + 0.2 * rand();
    // Arches of radius r with piers between, centered, as many as fit across. The arches spring a little above
    // the water, and the deck runs a course of masonry above their crowns.
    const count = int(rand, 2, 5);
    const pier = 0.5 + 0.4 * rand();
    const r = Math.min(0.32, (1.5 * uMax) / (2 * count + pier * (count - 1)));
    const spring = horizon - 0.04 - 0.08 * rand();
    const parapet = spring - r - 0.06 - 0.06 * rand();
    const deck = parapet - 0.035 - 0.015 * rand();
    const step = r * (2 + pier);
    const first = -((count - 1) * step) / 2;
    const ringWide = 0.05 + 0.02 * rand();
    // How far a point lies inside the nearest arch's opening, in scene units, and how far from its center.
    const opening = (u: number, v: number): [number, number] => {
      const k = Math.min(
        count - 1,
        Math.max(0, Math.round((u - first) / step)),
      );
      const du = u - (first + k * step);
      if (v >= spring) return [r - Math.abs(du), Math.abs(du)];
      const dv = v - spring;
      const out = Math.sqrt(du * du + dv * dv);
      return [r - out, out];
    };
    const span: Layer = (u, v) => {
      if (v < deck - 0.01 || v > horizon + 0.01) return 0;
      const [inside, out] = opening(u, v);
      const body = edgeS(Math.min(v - deck, horizon - v));
      if (inside > 0) {
        // Through the arch: the shadowed underside of the vault near its crown.
        const vault = edgeS(0.045 - inside) * edgeS(spring + r * 0.4 - v);
        tone = 0.86;
        phase = (out - r) * S;
        return body * Math.max(vault, edgeS(-inside));
      }
      const c = body * edgeS(-inside);
      if (v < parapet) {
        tone = 0.82;
        phase = v * S;
      } else if (-inside < ringWide && v < spring + 0.02) {
        // The ring of voussoirs round each arch, cut in concentric lines.
        tone = 0.5;
        phase = (out - r) * S;
      } else {
        tone = 0.66 + 0.12 * clamp01((v - parapet) / (horizon - parapet));
        phase = v * S;
      }
      return c;
    };
    return {
      horizon,
      back: [coast(horizon - 0.02, horizon - deck + 0.2)],
      front: [span],
      reflect: (u, v) => {
        const m = 2 * horizon - v;
        if (m < deck || m >= horizon) return 0;
        return opening(u, m)[0] > 0 ? 0.1 : 0.38;
      },
    };
  }

  // Ink at one sample, in the scene's ink and the frame's.
  let ink = 0;
  let frameInk = 0;
  function sample(x: number, y: number, col: number) {
    ink = 0;
    frameInk = 0;
    const fromEdge = Math.min(x, W - x, y, H - y);
    if (fromEdge < fieldAt + px) {
      let f =
        band(fromEdge, outerAt, outerEnd) + band(fromEdge, innerAt, innerEnd);
      if (beaded && Math.abs(fromEdge - beadAt) < beadR + px) {
        const X = x - W / 2;
        const Y = y - H / 2;
        const kx = Math.round((X + bx) / sbx);
        const ky = Math.round((Y + by) / sby);
        const hx = X - (Math.min(nbx, Math.max(0, kx)) * sbx - bx);
        const hy = Math.abs(Y) - by;
        const vx = Math.abs(X) - bx;
        const vy = Y - (Math.min(nby, Math.max(0, ky)) * sby - by);
        const d = Math.min(
          Math.sqrt(hx * hx + hy * hy),
          Math.sqrt(vx * vx + vy * vy),
        );
        f += edge(beadR - d);
      }
      frameInk = clamp01(f);
      if (fromEdge < fieldAt - px) return;
    }
    const X = x - W / 2;
    const Y = y - H / 2;
    const d = vignette(X, Y);
    if (d > -px) {
      const field = edge(fromEdge - fieldAt) * edge(d - tintAt);
      const tint =
        field > 0
          ? field *
            lines(
              tintVertical ? X : Y,
              gap * 0.85,
              (tintTone * gap * 0.85) / 2,
              px,
            )
          : 0;
      frameInk += (1 - frameInk) * tint;
      ink = band(d, keyAt, keyEnd);
    }
    const inside = edge(-d);
    if (inside === 0) return;
    const u = X / S;
    const v = Y / S;
    const cross = X * cu + Y * cv;
    // Front to back, each layer printing into what the ones in front leave uncovered.
    let scene = 0;
    let open = 1;
    for (let k = layers.length - 1; k >= 0 && open > 0; k--) {
      const c = layers[k](u, v, col);
      if (c <= 0) continue;
      let e = 0;
      if (tone > 0) {
        const share =
          tone < 0.03
            ? (tone * HAIR) / 0.03
            : Math.max(HAIR, Math.min(0.75, tone));
        e = lines(phase, gap, (share * gap) / 2, px);
        if (tone > CROSS) {
          const t = lines(
            cross,
            gap,
            (Math.min(1, (tone - CROSS) / 0.35) * 0.55 * gap) / 2,
            px,
          );
          e += t - e * t;
        }
      }
      scene += open * c * e;
      open *= 1 - c;
    }
    ink += (scene - ink) * inside;
  }

  const image = ctx.createImageData(width, height);
  const data = image.data;
  const step = 1 / n;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let [r, g, b] = [0, 0, 0];
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          sample(
            (x + (i + 0.5) * step) / unit,
            (y + (j + 0.5) * step) / unit,
            x * n + i,
          );
          const fr = paperRgb[0] + (frameRgb[0] - paperRgb[0]) * frameInk;
          const fg = paperRgb[1] + (frameRgb[1] - paperRgb[1]) * frameInk;
          const fb = paperRgb[2] + (frameRgb[2] - paperRgb[2]) * frameInk;
          r += fr + (darkRgb[0] - fr) * ink;
          g += fg + (darkRgb[1] - fg) * ink;
          b += fb + (darkRgb[2] - fb) * ink;
        }
      const p = (y * width + x) * 4;
      data[p] = Math.round(r / (n * n));
      data[p + 1] = Math.round(g / (n * n));
      data[p + 2] = Math.round(b / (n * n));
      data[p + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
}

export const steelEngraving1: Style = {
  id: "engr1",
  draw,
};
