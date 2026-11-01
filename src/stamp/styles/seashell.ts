import type { Palette } from "../palettes";
import { pick, stream } from "../random";
import type { Style } from "../sources";

// Seashell: one large shell, or a trio, as on a natural history plate. Gastropods (cone, turret, whelk, conch)
// follow Raup's coiling model: one generating curve, the whorl's profile, grows by a fixed ratio each turn as
// it winds down the axis, and the spire is the earlier whorls showing above the body whorl. A nautilus is the
// same model coiled flat, seen from the side, and a scallop is a bivalve's fan. Pigment grows like a real cone
// shell's: a row of cells along the growing edge, each generation set from the last by a cellular automaton.
//
// Like land1, it computes every pixel itself in resolution-independent units, so its pixels match in every
// browser and in Node, which the golden test relies on (ADR 0001). Only IEEE-exact arithmetic here: sine, e^x,
// ln and atan2 come from series below. Sizes are in art units, where the art's short side is 1, or in a
// shell's own units, scaled to fit.

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

const TAU = 6.283185307179586;
const LN2 = 0.6931471805599453;

// Sine from a Taylor polynomial, which is the same in every engine, unlike Math.sin. Error under 1e-11.
function sin(x: number): number {
  let y = x - TAU * Math.round(x / TAU);
  if (y > TAU / 4) y = TAU / 2 - y;
  else if (y < -TAU / 4) y = -TAU / 2 - y;
  const y2 = y * y;
  let sum = 1;
  for (let k = 15; k > 1; k -= 2) sum = 1 - (y2 / (k * (k - 1))) * sum;
  return y * sum;
}
const cos = (x: number) => sin(x + TAU / 4);

// e^x as 2^k times a Taylor series on the remainder, which stays under ln 2 / 2.
function exp(x: number): number {
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  let s = 1;
  for (let n = 13; n > 0; n--) s = 1 + (s * r) / n;
  let p = 1;
  for (let i = Math.abs(k); i > 0; i--) p *= 2;
  return k < 0 ? s / p : s * p;
}

// ln x from the series for 2 atanh((m - 1) / (m + 1)), after halving or doubling x into [0.75, 1.5].
function ln(x: number): number {
  let k = 0;
  while (x > 1.5) [x, k] = [x / 2, k + 1];
  while (x < 0.75) [x, k] = [x * 2, k - 1];
  const z = (x - 1) / (x + 1);
  const z2 = z * z;
  let s = 0;
  for (let n = 21; n > 0; n -= 2) s = s * z2 + 1 / n;
  return k * LN2 + 2 * z * s;
}

// atan z for |z| <= 1: two half-angle steps bring z under tan(pi / 16), where the series converges fast.
function atan(z: number): number {
  z = z / (1 + Math.sqrt(1 + z * z));
  z = z / (1 + Math.sqrt(1 + z * z));
  const z2 = z * z;
  let s = 0;
  for (let n = 23; n > 0; n -= 2) s = 1 / n - s * z2;
  return 4 * z * s;
}

function atan2(y: number, x: number): number {
  if (Math.abs(x) >= Math.abs(y)) {
    if (x === 0) return 0;
    const a = atan(y / x);
    return x > 0 ? a : y >= 0 ? a + TAU / 2 : a - TAU / 2;
  }
  return (y > 0 ? TAU / 4 : -TAU / 4) - atan(x / y);
}

// The share of a square cell, 1 wide, that a line `half` wide covers when the cell's center sits `d` from its
// middle, so a line keeps its weight at any size, even thinner than a pixel.
const cover = (d: number, half: number) =>
  clamp01(Math.min(d + 0.5, half) - Math.max(d - 0.5, -half));

// Pigment at a spot: `u` cells across the growing edge, `v` generations along the growth, `foot` the size of a
// pixel there in cells. 0 is bare shell, 1 full pigment.
type Pigment = (u: number, v: number, foot: number) => number;

// Elementary cellular automaton rules that read as shell patterns. 204 copies each cell, so its stripes run
// along the growth, 51 flips every cell each generation, so its bands cross it, and the rest grow the
// triangles and branching tents of cone shells.
const BANDS = 204;
const RINGS = 51;
const PLAIN = -1;

// The pattern a shell grows: a ring of `cells` along the edge, `gens` generations of it, each cell set from its
// neighbors in the last generation by `rule`, with the odd cell flipped, as real pigment cells misfire. Read
// back smoothly and cut at half, so its spots have rounded edges at any size, and a pixel that spans more than
// a cell sees the pattern's average.
function automaton(
  rand: () => number,
  rule: number,
  cells: number,
  gens: number,
): Pigment {
  if (rule === PLAIN) return () => 0;
  const density =
    rule === RINGS ? 0.04 * rand() : rule === BANDS ? 0.3 + 0.3 * rand() : 0.5;
  const flips = 0.004 + 0.012 * rand();
  const grid = new Uint8Array(cells * gens);
  for (let i = 0; i < cells; i++) grid[i] = rand() < density ? 1 : 0;
  for (let g = 1; g < gens; g++) {
    const [last, row] = [(g - 1) * cells, g * cells];
    for (let i = 0; i < cells; i++) {
      const l = grid[last + ((i + cells - 1) % cells)];
      const r = grid[last + ((i + 1) % cells)];
      const bit = (rule >> ((l << 2) | (grid[last + i] << 1) | r)) & 1;
      grid[row + i] = rand() < flips ? 1 - bit : bit;
    }
  }
  let mean = 0;
  for (let i = 0; i < grid.length; i++) mean += grid[i];
  mean /= grid.length;
  return (u, v, foot) => {
    const x = u - 0.5;
    const y = Math.min(Math.max(v - 0.5, 0), gens - 1.001);
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const [fx, fy] = [x - ix, y - iy];
    const i0 = ((ix % cells) + cells) % cells;
    const i1 = (i0 + 1) % cells;
    const [r0, r1] = [iy * cells, (iy + 1) * cells];
    const top = grid[r0 + i0] + (grid[r0 + i1] - grid[r0 + i0]) * fx;
    const bottom = grid[r1 + i0] + (grid[r1 + i1] - grid[r1 + i0]) * fx;
    const b = top + (bottom - top) * fy;
    const p = clamp01((b - 0.5) / Math.max(0.12, foot) + 0.5);
    return p + (mean - p) * clamp01(foot - 1);
  };
}

// How a shell is colored: bare shell, its pigment, the shading ink and the paper, which lights the highlight.
type Look = { ground: Rgb; pigment: Rgb; dark: Rgb; paper: Rgb };

// Light from the upper left, toward the viewer, and the half vector between it and the view for highlights.
// Image axes: x right, y down, z toward the viewer.
const LIGHT = [-0.5, -0.62, 0.6].map(
  (c) => c / Math.sqrt(0.25 + 0.3844 + 0.36),
);
const HALF = (() => {
  const h = [LIGHT[0], LIGHT[1], LIGHT[2] + 1];
  const n = Math.sqrt(h[0] * h[0] + h[1] * h[1] + h[2] * h[2]);
  return h.map((c) => c / n);
})();

// Where shade writes its color, so the hot loops allocate nothing.
const INK: Rgb = [0, 0, 0];

// A shell's color where its surface has unit normal (nx, ny, nz), `pig` of pigment and `line` of engraved
// line over it: lit from the upper left, darkening toward its silhouette, with a porcelain highlight. Returns
// INK, which the next call overwrites.
function shade(
  look: Look,
  nx: number,
  ny: number,
  nz: number,
  pig: number,
  line: number,
): Rgb {
  const lit = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
  const rim = clamp01(1 - nz / 0.35);
  const shadow = clamp01(0.62 * (1 - lit) + 0.45 * rim * rim);
  let h = Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]);
  h *= h;
  h *= h;
  h *= h;
  h *= h;
  const dark = 1 - (1 - shadow * 0.85) * (1 - line);
  const shine = h * h * 0.75;
  const { ground, pigment, dark: ink, paper } = look;
  for (let i = 0; i < 3; i++) {
    const c = ground[i] + (pigment[i] - ground[i]) * pig;
    const d = c + (ink[i] - c) * dark;
    INK[i] = d + (paper[i] - d) * shine;
  }
  return INK;
}

// The art being drawn: RGB samples, filled with paper and painted shell by shell.
type Canvas = { data: Float64Array; width: number; height: number };

function blend(img: Canvas, x: number, y: number, c: Rgb, cov: number) {
  const p = (y * img.width + x) * 3;
  const d = img.data;
  d[p] += (c[0] - d[p]) * cov;
  d[p + 1] += (c[1] - d[p + 1]) * cov;
  d[p + 2] += (c[2] - d[p + 2]) * cov;
}

// A shell, laid out in its own units: it paints itself onto the art with its unit at `k` samples and its
// origin at sample (ox, oy), inked round with an outline `edge` samples wide. `bounds` is [left, top, right,
// bottom].
type Shell = {
  bounds: [number, number, number, number];
  paint(img: Canvas, ox: number, oy: number, k: number, edge: number): void;
};

// How dark a shell's engraved outline prints.
const OUTLINE = 0.7;

// A smooth curve through knots (t, p) by cubic Hermite segments, with tangents from the neighboring knots.
function spline(ts: number[], ps: number[]): (t: number) => number {
  const n = ts.length;
  const ms = ps.map((_, i) => {
    const [a, b] = [Math.max(0, i - 1), Math.min(n - 1, i + 1)];
    return (ps[b] - ps[a]) / (ts[b] - ts[a]);
  });
  return (t) => {
    let i = 0;
    while (i < n - 2 && t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i];
    const s = clamp01((t - ts[i]) / h);
    const [s2, s3] = [s * s, s * s * s];
    return (
      (2 * s3 - 3 * s2 + 1) * ps[i] +
      (s3 - 2 * s2 + s) * h * ms[i] +
      (3 * s2 - 2 * s3) * ps[i + 1] +
      (s3 - s2) * h * ms[i + 1]
    );
  };
}

// A gastropod's form. Its whorl grows by `W` a turn. The spire's slope is `p0`, a whorl's radius over its
// depth below the apex. `band` shapes a whorl's exposed band between sutures, as knots [t, radius over the
// spire's slope] from t = 0 at the upper suture to 1 at the lower, which both have radius 1. `body` carries the
// last whorl on from its last band knot before the lower suture down to its tip, as knots [depth below where
// that suture would be, radius], both over the radius there.
type SpireForm = {
  W: number;
  p0: number;
  band: [number, number][];
  body: [number, number][];
  // Pigment cells across a band.
  cells: number;
  // Axial ribs per turn, their height as a share of the radius, and where across the band they stand.
  ribs: number;
  ribAmp: number;
  ribAt: number;
  ribSpan: number;
  // Spiral cords per band, and their height.
  cords: number;
  cordAmp: number;
  rules: number[];
};

// How far a row's sweep reaches round the axis either side of the front, a little past the outline's edge.
const SWEEP_SPAN = 0.62 * (TAU / 2);

// A gastropod seen from its back, apex up. In shell units the aperture's top is 1 below the apex.
//
// A point on the shell is (y, a): y its depth below the apex, a its azimuth round the axis, 0 facing the
// viewer. The whorl passing azimuth a at growth time tau (in turns, 0 at the aperture) has scale W^tau, and its
// band spans depths W^tau to W^(tau + 1), so a depth and azimuth find their whorl and the position t across it,
// and so the radius. Each row of the image is a horizontal slice of the shell: sweeping the azimuth gives the
// slice's outline, and its front-most point at each column is the one seen there.
function spire(rand: () => number, form: SpireForm, look: Look): Shell {
  const { W, p0 } = form;
  const lnW = ln(W);
  const g = (t: number) => 1 + (W - 1) * t;
  const bandT = form.band.map(([t]) => t);
  const bandP = form.band.map(([t, r]) => p0 * g(t) * r);
  const band = spline(bandT, bandP);
  // The last whorl has no whorl below it, so it skips the lower suture and swells on round its base.
  const ts = [...bandT.slice(0, -1)];
  const ps = [...bandP.slice(0, -1)];
  for (const [dh, r] of form.body) {
    ts.push((W + dh * W * p0 - 1) / (W - 1));
    ps.push(W * p0 * r);
  }
  const body = spline(ts, ps);
  const tEnd = ts[ts.length - 1];
  // The aperture faces away, so the front shows the body whorl's back.
  const aperture = TAU * (0.35 + 0.3 * rand());
  const lastTime = (a: number) => -frac((aperture - a) / TAU);

  // Arc length along the profile, a whorl's scale being 1, for laying pigment cells evenly round a whorl.
  const ARC = 256;
  const arc = new Float64Array(ARC + 1);
  for (let i = 1; i <= ARC; i++) {
    const [t0, t1] = [(tEnd * (i - 1)) / ARC, (tEnd * i) / ARC];
    const [dp, dh] = [body(t1) - body(t0), (W - 1) * (t1 - t0)];
    arc[i] = arc[i - 1] + Math.sqrt(dp * dp + dh * dh);
  }
  const arcAt = (t: number) => {
    const x = (Math.min(Math.max(t, 0), tEnd) / tEnd) * ARC;
    const i = Math.min(Math.floor(x), ARC - 1);
    return arc[i] + (arc[i + 1] - arc[i]) * (x - i);
  };
  const cell = arcAt(1) / form.cells;
  const cells = Math.ceil(arc[ARC] / cell);
  const meanRadius = (p0 * (1 + W)) / 2;
  const perTurn = Math.max(8, Math.round((TAU * meanRadius) / cell));
  const turns = Math.ceil(ln(300) / lnW);
  const pigment = automaton(
    rand,
    pick(form.rules, rand),
    cells + 1,
    turns * perTurn + 2,
  );
  const lines = 45 + 50 * rand();
  const linePhase = rand();

  // Where rho last landed: position across the whorl, growth time, the whorl's scale and how many whorls above
  // the last it is.
  let atT = 0;
  let atTau = 0;
  let atScale = 0;
  let atWhorl = 0;

  // The shell's radius at depth y on the whorls passing an azimuth last at growth time `tl`, W^tl being `wt`,
  // or -1 below the shell. Ribs and cords finer than a few pixels of `px` fade, so they don't alias.
  function rho(y: number, tl: number, wt: number, px: number): number {
    if (y <= 0) return -1;
    let s = wt;
    let j = 0;
    let t: number;
    if (y >= s * W) {
      t = (y / s - 1) / (W - 1);
      if (t > tEnd) return -1;
    } else {
      while (y < s) {
        s /= W;
        j++;
      }
      t = (y / s - 1) / (W - 1);
    }
    const tau = tl - j;
    const r = s * (j === 0 ? body(t) : band(t));
    let bump = 1;
    if (form.ribs > 0) {
      const fade = clamp01(((TAU * r) / form.ribs / px - 2) / 3);
      const near = (t - form.ribAt) / form.ribSpan;
      if (fade > 0 && near * near < 1)
        bump +=
          form.ribAmp * fade * (1 - near * near) * cos(TAU * form.ribs * tau);
    }
    if (form.cords > 0) {
      const fade = clamp01(((s * (W - 1)) / form.cords / px - 2) / 3);
      if (fade > 0) bump += form.cordAmp * fade * cos(TAU * form.cords * t);
    }
    atT = t;
    atTau = tau;
    atScale = s;
    atWhorl = j;
    return r * bump;
  }

  // Azimuths for a sweep of `n` steps, with when each was last grown and that whorl's scale.
  function azimuths(n: number) {
    const az = new Float64Array(n);
    const sn = new Float64Array(n);
    const cs = new Float64Array(n);
    const last = new Float64Array(n);
    const scale = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      az[i] = -SWEEP_SPAN + (2 * SWEEP_SPAN * i) / (n - 1);
      sn[i] = sin(az[i]);
      cs[i] = cos(az[i]);
      last[i] = lastTime(az[i]);
      scale[i] = exp(last[i] * lnW);
    }
    return { az, sn, cs, last, scale };
  }

  // Bounds from a coarse set of slices. The tip is lowest where the last whorl is newest.
  const coarse = azimuths(128);
  let [left, right, bottom] = [0, 0, 0];
  for (let i = 0; i < 128; i++)
    bottom = Math.max(bottom, coarse.scale[i] * g(tEnd));
  for (let row = 1; row <= 96; row++) {
    const y = (bottom * row) / 96;
    for (let i = 0; i < 128; i++) {
      const r = rho(y, coarse.last[i], coarse.scale[i], 1e-9);
      if (r < 0) continue;
      left = Math.min(left, r * coarse.sn[i]);
      right = Math.max(right, r * coarse.sn[i]);
    }
  }
  const size = Math.max(right - left, bottom);

  // The shell's color at depth y and azimuth a, `px` being a sample's size and `outline` how much of the
  // outline covers it.
  function color(y: number, a: number, px: number, outline: number): Rgb {
    const tl = lastTime(a);
    const wt = exp(tl * lnW);
    const r = rho(y, tl, wt, px);
    const t = atT;
    const tau = atTau;
    const s = atScale;
    const j = atWhorl;
    // Slopes down the axis and round it, by finite differences.
    const h = px * 0.5;
    let dy = h;
    let ry = rho(y + h, tl, wt, px);
    if (ry < 0) {
      dy = -h;
      ry = rho(y - h, tl, wt, px);
    }
    const ha = h / Math.max(r, h);
    const tla = lastTime(a + ha);
    const ra = rho(y, tla, exp(tla * lnW), px);
    const slopeY = (ry - r) / dy;
    const slopeA = (ra - r) / ha / r;
    const sa = sin(a);
    const ca = cos(a);
    let nx = sa - slopeA * ca;
    let ny = -slopeY;
    let nz = ca + slopeA * sa;
    const n = Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx /= n;
    ny /= n;
    nz /= n;

    // How far a column moves per unit of azimuth, which foreshortens growth lines and pigment near the edges.
    const across = Math.max(Math.abs(r * (ca + slopeA * sa)), 1e-9);
    const footU = px / (s * cell);
    const footV = (px * perTurn) / (TAU * across);
    const pig = pigment(
      arcAt(t) / cell,
      (tau + turns) * perTurn,
      Math.max(footU, footV),
    );

    // Growth lines across each whorl, a little irregular, and the sutures between whorls.
    const q = tau * lines + 0.35 * sin(TAU * (tau * 2.3 + linePhase));
    const spacing = (TAU * across) / lines / px;
    const growth =
      cover(Math.abs(q - Math.round(q)) * spacing, 0.1 * spacing) *
      clamp01((spacing - 3) / 4) *
      0.3;
    const height = (s * (W - 1)) / px;
    const fromSuture = Math.min(t, j > 0 ? 1 - t : Infinity) * height;
    const suture =
      cover(fromSuture, Math.min((0.003 * size) / px, 0.1 * height)) * 0.6;
    const line = 1 - (1 - growth) * (1 - suture) * (1 - outline);
    return shade(look, nx, ny, nz, pig, line);
  }

  return {
    bounds: [left, 0, right, bottom],
    paint(img, ox, oy, k, edge) {
      const px = 1 / k;
      const c0 = Math.max(0, Math.floor(ox + left * k) - 2);
      const c1 = Math.min(img.width, Math.ceil(ox + right * k) + 2);
      const r0 = Math.max(0, Math.floor(oy) - 2);
      const r1 = Math.min(img.height, Math.ceil(oy + bottom * k) + 2);
      const cols = c1 - c0;
      const rows = r1 - r0;
      if (cols <= 0 || rows <= 0) return;
      // Enough azimuths that the slice's outline bends by well under a sample between them.
      const n = Math.min(384, Math.max(96, Math.ceil(2 * cols)));
      const { az, sn, cs, last, scale } = azimuths(n);

      // Each row's slice: the azimuth seen at each column, and the slice's left and right ends.
      const seen = new Float64Array(cols * rows).fill(NaN);
      const lo = new Float64Array(rows).fill(NaN);
      const hi = new Float64Array(rows).fill(NaN);
      const loAz = new Float64Array(rows);
      const hiAz = new Float64Array(rows);
      const xs = new Float64Array(n);
      const ds = new Float64Array(n);
      const depth = new Float64Array(cols);
      for (let row = 0; row < rows; row++) {
        const y = (r0 + row + 0.5 - oy) / k;
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < n; i++) {
          const r = rho(y, last[i], scale[i], px);
          if (r < 0) {
            xs[i] = NaN;
            continue;
          }
          const x = ox - c0 + r * sn[i] * k;
          xs[i] = x;
          ds[i] = r * cs[i];
          if (x < min) {
            min = x;
            loAz[row] = az[i];
          }
          if (x > max) {
            max = x;
            hiAz[row] = az[i];
          }
        }
        if (min > max) continue;
        lo[row] = min;
        hi[row] = max;
        depth.fill(-Infinity);
        const out = row * cols;
        for (let i = 0; i + 1 < n; i++) {
          const x0 = xs[i];
          const x1 = xs[i + 1];
          if (x0 !== x0 || x1 !== x1) continue;
          const from = Math.max(0, Math.ceil(Math.min(x0, x1) - 0.5));
          const to = Math.min(cols - 1, Math.floor(Math.max(x0, x1) - 0.5));
          for (let c = from; c <= to; c++) {
            const f = x1 === x0 ? 0 : (c + 0.5 - x0) / (x1 - x0);
            const d = ds[i] + (ds[i + 1] - ds[i]) * f;
            if (d > depth[c]) {
              depth[c] = d;
              seen[out + c] = az[i] + (az[i + 1] - az[i]) * f;
            }
          }
        }
      }

      for (let row = 0; row < rows; row++) {
        const min = lo[row];
        const max = hi[row];
        if (min !== min) continue;
        // The outline's slope from the neighboring slices, so a shallow edge antialiases across its width.
        const mid = (min + max) / 2;
        const prev = row > 0 && lo[row - 1] === lo[row - 1];
        const next = row + 1 < rows && lo[row + 1] === lo[row + 1];
        const slopeL =
          ((next ? lo[row + 1] : mid) - (prev ? lo[row - 1] : mid)) / 2;
        const slopeR =
          ((next ? hi[row + 1] : mid) - (prev ? hi[row - 1] : mid)) / 2;
        const normL = Math.sqrt(1 + slopeL * slopeL);
        const normR = Math.sqrt(1 + slopeR * slopeR);
        const y = (r0 + row + 0.5 - oy) / k;
        const from = Math.max(0, Math.floor(min - 1));
        const to = Math.min(cols - 1, Math.ceil(max + 1));
        for (let c = from; c <= to; c++) {
          const x = c + 0.5;
          const inside = Math.min((x - min) / normL, (max - x) / normR);
          const cov = clamp01(inside + 0.5);
          if (cov <= 0) continue;
          let a = seen[row * cols + c];
          if (a !== a) a = x < mid ? loAz[row] : hiAz[row];
          const outline = cover(inside - edge, edge) * OUTLINE;
          blend(img, c0 + c, r0 + row, color(y, a, px, outline), cov);
        }
      }
    },
  };
}

// A nautilus, coiled flat and seen from the side: one whorl wraps all the earlier ones, so the side shows the
// last turn from its deep navel out to the keel, and the outline is a logarithmic spiral ending at the
// aperture. Its stripes run with the growth lines and fade toward the aperture. Centered on the coil, with the
// outline 1 from it where the aperture's lip would cross it unbowed.
function nautilus(rand: () => number, look: Look): Shell {
  const W = 2.6 + 0.8 * rand();
  const lnW = ln(W);
  const end = TAU * (rand() - 0.5) * 0.4;
  const bulge = 0.45 + 0.2 * rand();
  const navel = 0.12 + 0.08 * rand();
  // Growth lines, and the aperture's lip, bow forward of a straight spoke by up to this many turns.
  const bow = 0.03 + 0.04 * rand();
  const lip = (u: number) => -bow * (1 - 4 * (u - 0.5) * (u - 0.5));
  const outer = exp(bow * lnW);
  const cells = 18 + Math.floor(16 * rand());
  const perTurn = 36 + Math.floor(30 * rand());
  const rule = pick([RINGS, RINGS, RINGS, 170, 240, PLAIN], rand);
  const pigment = automaton(rand, rule, cells, perTurn + 4);
  const lines = 60 + 50 * rand();
  const reach = 0.55 + 0.35 * rand();

  let [left, top, right, bottom] = [0, 0, 0, 0];
  for (let i = 0; i < 360; i++) {
    const back = i / 360 - bow;
    const r = exp(-back * lnW);
    const x = r * cos(end - TAU * back);
    const y = r * sin(end - TAU * back);
    [left, top] = [Math.min(left, x), Math.min(top, y)];
    [right, bottom] = [Math.max(right, x), Math.max(bottom, y)];
  }

  return {
    bounds: [left, top, right, bottom],
    paint(img, ox, oy, k, edge) {
      const px = 1 / k;
      const c0 = Math.max(0, Math.floor(ox + left * k) - 2);
      const c1 = Math.min(img.width, Math.ceil(ox + right * k) + 2);
      const r0 = Math.max(0, Math.floor(oy + top * k) - 2);
      const r1 = Math.min(img.height, Math.ceil(oy + bottom * k) + 2);
      for (let row = r0; row < r1; row++)
        for (let col = c0; col < c1; col++) {
          const x = (col + 0.5 - ox) / k;
          const y = (row + 0.5 - oy) / k;
          const r = Math.sqrt(x * x + y * y);
          if (r > outer + px || r < 1e-9) continue;
          // How far back from the aperture this angle is, in turns, and the outline there.
          let back = frac((end - atan2(y, x)) / TAU);
          let rim = exp(-back * lnW);
          // Past the aperture's lip, the outline drops to the whorl before. Near the lip, the distance to it.
          let inside: number;
          if (back > 0.5 && r > rim) {
            back -= 1;
            rim *= W;
          }
          inside = (rim - r) / px;
          if (r > rim / W && back < 0.5)
            inside = Math.min(inside, ((back - lip(r)) * TAU * r) / px);
          const cov = clamp01(inside + 0.5);
          if (cov <= 0) continue;

          // The side's height over the plane, rim * F(u), u running from the navel out to the keel.
          const u = Math.min(r / rim, 0.995);
          const root = Math.sqrt(1 - u * u);
          const dip = clamp01(1 - u / navel);
          const lift = 1 - 0.7 * dip * dip;
          const F = bulge * root * lift;
          const dF =
            bulge * ((-u / root) * lift + root * ((1.4 * dip) / navel));
          const ht = ((rim * lnW) / TAU) * (F - u * dF);
          const ct = x / r;
          const st = y / r;
          const gx = dF * ct - (ht / r) * st;
          const gy = dF * st + (ht / r) * ct;
          const n = Math.sqrt(gx * gx + gy * gy + 1);

          const tau = lip(u) - back;
          const foot = Math.max((px * cells) / rim, (px * perTurn) / (TAU * r));
          const fade =
            clamp01((-tau - 0.15) / 0.35) * clamp01((reach - u) / 0.3);
          const pig = pigment(u * cells, (tau + 1) * perTurn + 2, foot) * fade;
          const q = tau * lines;
          const spacing = (TAU * r) / lines / px;
          const growth =
            cover(Math.abs(q - Math.round(q)) * spacing, 0.1 * spacing) *
            clamp01((spacing - 3) / 4) *
            0.3;
          const line =
            1 - (1 - growth) * (1 - cover(inside - edge, edge) * OUTLINE);
          blend(
            img,
            col,
            row,
            shade(look, -gx / n, -gy / n, 1 / n, pig, line),
            cov,
          );
        }
    },
  };
}

// A scallop valve, hinge up: a fan of ribs from the beak, an ear either side of it along the hinge, and growth
// lines rippling out to the scalloped margin. Its pigment grows along the margin too, so rays follow the ribs
// and bands follow the growth. The beak is at the origin and the margin about 1 below it.
function scallop(rand: () => number, look: Look): Shell {
  const spread = 0.82 + 0.2 * rand();
  const ribs = 14 + Math.floor(10 * rand());
  const ribAmp = 0.02 + 0.015 * rand();
  const round = 0.26 + 0.12 * rand();
  const dome = 0.25 + 0.15 * rand();
  const earW = 0.2 + 0.08 * rand();
  const earH = 0.1 + 0.05 * rand();
  const cells = ribs;
  const perTurn = 14 + Math.floor(18 * rand());
  const rule = pick([BANDS, RINGS, 90, 150, 30, 18, PLAIN], rand);
  const pigment = automaton(rand, rule, cells, perTurn + 4);
  const lines = 40 + 40 * rand();
  const rib = (TAU / 2) * (ribs / spread);
  const reach = (a: number) => 1 - round * (a / spread) * (a / spread);
  const side = Math.max(earW, sin(spread) * reach(spread));

  return {
    bounds: [-side, 0, side, 1],
    paint(img, ox, oy, k, edge) {
      const px = 1 / k;
      const c0 = Math.max(0, Math.floor(ox - side * k) - 2);
      const c1 = Math.min(img.width, Math.ceil(ox + side * k) + 2);
      const r0 = Math.max(0, Math.floor(oy) - 2);
      const r1 = Math.min(img.height, Math.ceil(oy + k) + 2);
      for (let row = r0; row < r1; row++)
        for (let col = c0; col < c1; col++) {
          const x = (col + 0.5 - ox) / k;
          const y = (row + 0.5 - oy) / k;
          const r = Math.sqrt(x * x + y * y);
          const a = atan2(x, y);
          const rim = reach(a);
          const ribFade = clamp01(((r * TAU) / (2 * ribs) / px - 2) / 3);
          const cr = cos(rib * a);
          const margin = rim * (1 + 0.012 * ribFade * cr);
          const fan = Math.min(
            (margin - r) / px,
            ((spread - Math.abs(a)) * r) / px,
          );
          // An ear: the hinge along its top, its outer edge raking in toward the fan.
          const wing = earW * (1 - (0.5 * y) / earH);
          const ear = Math.min(
            y / px,
            (earH - y) / px,
            (wing - Math.abs(x)) / px,
          );
          const inside = Math.max(fan, ear);
          const cov = clamp01(inside + 0.5);
          if (cov <= 0) continue;
          const outline = cover(inside - edge, edge) * OUTLINE;

          // The seam where an ear meets the fan.
          const seam = ear > 0 ? cover(Math.abs(fan), edge * 0.6) * 0.5 : 0;
          if (ear > fan) {
            // The ears are flat, tipped down and away from the beak, ribbed along the hinge and colored like the
            // fan's edge.
            const q = (y / earH) * 6;
            const spacing = earH / 6 / px;
            const growth =
              cover(Math.abs(q - Math.round(q)) * spacing, 0.12 * spacing) *
              clamp01((spacing - 3) / 4) *
              0.4;
            const tilt = x < 0 ? -0.35 : 0.35;
            const n = Math.sqrt(1.09 + tilt * tilt);
            const pig = pigment(x < 0 ? 0 : cells - 1, (y / earH) * 4 + 2, 1);
            const line = 1 - (1 - growth) * (1 - outline) * (1 - seam);
            blend(
              img,
              col,
              row,
              shade(look, tilt / n, 0.3 / n, 1 / n, pig, line),
              cov,
            );
            continue;
          }

          // The valve's height: a dome over the fan, highest along its middle, with the ribs on it.
          const tau = r / rim;
          const dRim = (-2 * round * a) / (spread * spread);
          const wide = 1 - (0.5 * a * a) / (spread * spread);
          const dWide = -a / (spread * spread);
          const sr = sin(rib * a);
          const hr = -2 * dome * tau * wide + ribAmp * ribFade * cr;
          const ha =
            dome * dRim * (1 + tau * tau) * wide +
            dome * rim * (1 - tau * tau) * dWide -
            ribAmp * ribFade * r * rib * sr;
          const rr = Math.max(r, 1e-9);
          const sa = x / rr;
          const ca = y / rr;
          const gx = hr * sa + (ha / rr) * ca;
          const gy = hr * ca - (ha / rr) * sa;
          const n = Math.sqrt(gx * gx + gy * gy + 1);

          const foot = Math.max(
            (px * cells) / (2 * spread * Math.max(r, px)),
            (px * perTurn) / rim,
          );
          const pig = pigment(
            ((a / spread + 1) / 2) * cells,
            tau * perTurn + 2,
            foot,
          );
          const q = tau * lines;
          const spacing = rim / lines / px;
          const growth =
            cover(Math.abs(q - Math.round(q)) * spacing, 0.1 * spacing) *
            clamp01((spacing - 3) / 4) *
            0.35;
          const line = 1 - (1 - growth) * (1 - outline) * (1 - seam);
          blend(
            img,
            col,
            row,
            shade(look, -gx / n, -gy / n, 1 / n, pig, line),
            cov,
          );
        }
    },
  };
}

// The family presets, hand-tuned, since much of Raup's parameter space grows shells nothing ever lived in.
// Each jitters its preset so no two shells match.
type Family = (rand: () => number, look: Look) => Shell;

const jitter = (rand: () => number, x: number, by: number) =>
  x * (1 + by * (2 * rand() - 1));

const cone: Family = (rand, look) =>
  spire(
    rand,
    {
      W: jitter(rand, 3.4, 0.12),
      p0: jitter(rand, 1.7, 0.2),
      band: [
        [0, 1],
        [0.7, 1.03],
        [0.9, 1.06],
        [1, 1],
      ],
      body: [
        [0.15, 0.98],
        [jitter(rand, 1.2, 0.2), jitter(rand, 0.62, 0.1)],
        [jitter(rand, 2.5, 0.12), 0.07],
      ],
      cells: 5 + Math.floor(5 * rand()),
      ribs: 0,
      ribAmp: 0,
      ribAt: 0,
      ribSpan: 1,
      cords: 0,
      cordAmp: 0,
      rules: [18, 22, 30, 54, 90, 126, 146, 150, 182, BANDS],
    },
    look,
  );

const turret: Family = (rand, look) =>
  spire(
    rand,
    {
      W: jitter(rand, 1.27, 0.04),
      p0: jitter(rand, 0.23, 0.12),
      band: [
        [0, 1],
        [0.3, jitter(rand, 1.12, 0.04)],
        [0.62, jitter(rand, 1.13, 0.04)],
        [0.88, 1.06],
        [1, 1],
      ],
      body: [
        [0.25, 0.92],
        [0.55, 0.6],
        [0.8, 0.22],
      ],
      cells: 8 + Math.floor(8 * rand()),
      ribs: 0,
      ribAmp: 0,
      ribAt: 0,
      ribSpan: 1,
      cords: 3 + Math.floor(3 * rand()),
      cordAmp: 0.025 + 0.015 * rand(),
      rules: [BANDS, BANDS, PLAIN, 170, 22],
    },
    look,
  );

const whelk: Family = (rand, look) =>
  spire(
    rand,
    {
      W: jitter(rand, 2, 0.1),
      p0: jitter(rand, 0.47, 0.1),
      band: [
        [0, 1],
        [0.35, jitter(rand, 1.16, 0.04)],
        [0.7, 1.12],
        [1, 1],
      ],
      body: [
        [0.5, 1.04],
        [1.3, 0.72],
        [jitter(rand, 2, 0.1), 0.32],
        [jitter(rand, 2.6, 0.1), 0.12],
      ],
      cells: 8 + Math.floor(8 * rand()),
      ribs: 9 + Math.floor(6 * rand()),
      ribAmp: 0.03 + 0.03 * rand(),
      ribAt: 0.45,
      ribSpan: 0.7,
      cords: 4 + Math.floor(4 * rand()),
      cordAmp: 0.012,
      rules: [BANDS, 30, PLAIN, 170, 18],
    },
    look,
  );

const conch: Family = (rand, look) =>
  spire(
    rand,
    {
      W: jitter(rand, 2.3, 0.1),
      p0: jitter(rand, 0.56, 0.1),
      band: [
        [0, 1],
        [0.55, 1.0],
        [0.84, jitter(rand, 1.28, 0.05)],
        [1, 1],
      ],
      body: [
        [0.2, 1.06],
        [1, 0.74],
        [jitter(rand, 2, 0.1), 0.36],
        [jitter(rand, 2.8, 0.1), 0.12],
      ],
      cells: 8 + Math.floor(6 * rand()),
      ribs: 7 + Math.floor(4 * rand()),
      ribAmp: 0.1 + 0.06 * rand(),
      ribAt: 0.85,
      ribSpan: 0.3,
      cords: 0,
      cordAmp: 0,
      rules: [BANDS, PLAIN, RINGS, 90],
    },
    look,
  );

const FAMILIES: readonly Family[] = [
  cone,
  turret,
  whelk,
  conch,
  nautilus,
  scallop,
];

// Small draws are supersampled until the art's short side has this many samples, so detail finer than a pixel
// averages out the way it would in a large draw scaled down.
const MIN_UNIT = 192;

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const ss = Math.ceil(MIN_UNIT / Math.min(width, height));
  const img: Canvas = {
    data: new Float64Array(width * ss * height * ss * 3),
    width: width * ss,
    height: height * ss,
  };
  const unit = Math.min(width, height) * ss;
  const [W, H] = [img.width / unit, img.height / unit];
  const paperRgb = rgb(paper);
  for (let p = 0; p < img.data.length; p += 3) {
    img.data[p] = paperRgb[0];
    img.data[p + 1] = paperRgb[1];
    img.data[p + 2] = paperRgb[2];
  }

  const ink = inks.map(rgb);
  const look = (): Look => ({
    ground: mix(paperRgb, ink[ink.length - 1], 0.12 + 0.2 * rand()),
    pigment: ink[1 + Math.floor(rand() * (ink.length - 1))],
    dark: ink[0],
    paper: paperRgb,
  });

  // Cells [x, y, width, height] for the shells: one, or a large one and two small beside it along the long side.
  const framed = rand() < 0.5;
  const pad = framed ? 0.1 : 0.06;
  const [iw, ih] = [W - 2 * pad, H - 2 * pad];
  let cells: [number, number, number, number][] = [[pad, pad, iw, ih]];
  if (rand() < 0.35) {
    const big = 0.56;
    const flip = rand() < 0.5;
    cells =
      W >= H
        ? [
            [pad + (flip ? iw * (1 - big) : 0), pad, iw * big, ih],
            [pad + (flip ? 0 : iw * big), pad, iw * (1 - big), ih / 2],
            [pad + (flip ? 0 : iw * big), pad + ih / 2, iw * (1 - big), ih / 2],
          ]
        : [
            [pad, pad + (flip ? ih * (1 - big) : 0), iw, ih * big],
            [pad, pad + (flip ? 0 : ih * big), iw / 2, ih * (1 - big)],
            [pad + iw / 2, pad + (flip ? 0 : ih * big), iw / 2, ih * (1 - big)],
          ];
  }
  for (const [cx, cy, cw, ch] of cells) {
    const shell = pick(FAMILIES, rand)(rand, look());
    const [l, t, r, b] = shell.bounds;
    const scale = Math.min((cw * 0.88) / (r - l), (ch * 0.88) / (b - t));
    const ox = (cx + cw / 2 - ((l + r) / 2) * scale) * unit;
    const oy = (cy + ch / 2 - ((t + b) / 2) * scale) * unit;
    shell.paint(img, ox, oy, scale * unit, 0.0022 * unit);
  }

  // A plate's double keyline, inside the punch's notches.
  if (framed) {
    const dark = ink[0];
    const px = 1 / unit;
    const band = Math.ceil(0.08 * unit);
    for (let row = 0; row < img.height; row++)
      for (let col = 0; col < img.width; col++) {
        // Only the band round the edge holds the keyline.
        if (col === band && row >= band && row < img.height - band)
          col = img.width - band;
        const x = (col + 0.5) * px;
        const y = (row + 0.5) * px;
        const d = Math.min(x, W - x, y, H - y);
        if (d > 0.08) continue;
        const outer = cover((d - 0.05) / px, 0.0025 / px);
        const inner = cover((d - 0.062) / px, 0.0011 / px);
        const line = Math.max(outer, inner);
        if (line > 0) blend(img, col, row, dark, line);
      }
  }

  const image = ctx.createImageData(width, height);
  const out = image.data;
  const n = ss * ss;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let [r, g, b] = [0, 0, 0];
      for (let j = 0; j < ss; j++)
        for (let i = 0; i < ss; i++) {
          const p = ((y * ss + j) * img.width + x * ss + i) * 3;
          r += img.data[p];
          g += img.data[p + 1];
          b += img.data[p + 2];
        }
      const p = (y * width + x) * 4;
      out[p] = Math.round(r / n);
      out[p + 1] = Math.round(g / n);
      out[p + 2] = Math.round(b / n);
      out[p + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
}

export const seashell1: Style = {
  id: "shell1",
  draw,
};
