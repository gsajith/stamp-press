import { atan, exp, log } from "../exact";
import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";
import { advance, BASELINE, layout } from "./hersheySerif";

// Fantasy map: Martin O'Leary's eroded fantasy maps, the ones behind @unchartedatlas, as a stamp. A coastline,
// rivers, hatched slopes, a few towns and the borders between their territories, in black ink on paper, with
// every place named in one invented language.
//
// Ported from mewo2/terrain (github.com/mewo2/terrain) and mewo2/naming-language
// (github.com/mewo2/naming-language), both Copyright (c) 2016 Martin O'Leary, under the MIT License:
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
//   documentation files (the "Software"), to deal in the Software without restriction, including without
//   limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
//   Software, and to permit persons to whom the Software is furnished to do so, subject to the following
//   conditions:
//
//   The above copyright notice and this permission notice shall be included in all copies or substantial portions
//   of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
//   TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
//   THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
//   CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
//   DEALINGS IN THE SOFTWARE.
//
// Changes from the original: d3's Voronoi mesh is a jittered grid cut into triangles, about 3500 of them, whose
// adjacency has the same shape (each triangle has three neighbours, and a coastline runs along the edges between
// triangles). Sinks fill by priority flood, which reaches the same surface as the original's repeated sweeps in
// one pass. Smoothing, the slopes that get hatched and the map's scale are tuned to the coarser mesh and a
// stamp's size (see RELAX, SLOPE_GAIN and ZOOM), and coastlines are smoothed like rivers to hide the grid. Every
// random draw comes from a seeded stream, and the math is IEEE-exact (ADR 0001), so pixels match in every browser
// and in Node. Labels are drawn in Hershey's serif stroke font, since text from the canvas differs between
// machines.

type Rand = () => number;

// The naming language (mewo2/naming-language): phonemes, a syllable shape and a spelling, picked once per map.

const CONSONANTS = [
  "ptkmnls",
  "ptkbdgmnlrsʃzʒʧ",
  "ptkmnh",
  "hklmnpwʔ",
  "ptkqvsgrmnŋlj",
  "tksʃdbqɣxmnlrwj",
  "tkdgmnsʃ",
  "ptkbdgmnszʒʧhjw",
];
const VOWELS = [
  "aeiou",
  "aiu",
  "aeiouAEI",
  "aeiouU",
  "aiuAI",
  "eou",
  "aeiouAOU",
];
const LIQUIDS = ["rl", "r", "l", "wj", "rlwj"];
const SIBILANTS = ["s", "sʃ", "sʃf"];
const FINALS = ["mn", "sk", "mnŋ", "sʃzʒ"];
const SYLLABLES = [
  "CVC",
  "CVV?C",
  "CVVC?",
  "CVC?",
  "CV",
  "VC",
  "CVF",
  "C?VC",
  "CVF?",
  "CL?VC",
  "CL?VF",
  "S?CVC",
  "S?CVF",
  "S?CVC?",
  "C?VF",
  "C?VC?",
  "C?VF?",
  "C?L?VC",
  "VC",
  "CVL?C?",
  "C?VL?C",
  "C?VLC?",
];
// No doubled sounds and no hard clusters.
const RESTRICTS = [/[sʃf][sʃ]/, /(.)\1/, /[rl][rl]/];
const DEFAULT_ORTHO: Record<string, string> = {
  ʃ: "sh",
  ʒ: "zh",
  ʧ: "ch",
  ʤ: "j",
  ŋ: "ng",
  j: "y",
  x: "kh",
  ɣ: "gh",
  ʔ: "‘",
  A: "á",
  E: "é",
  I: "í",
  O: "ó",
  U: "ú",
};
const CONSONANT_ORTHO: Record<string, string>[] = [
  {},
  { ʃ: "š", ʒ: "ž", ʧ: "č", ʤ: "ǧ", j: "j" },
  { ʃ: "sch", ʒ: "zh", ʧ: "tsch", ʤ: "dz", j: "j", x: "ch" },
  { ʃ: "ch", ʒ: "j", ʧ: "tch", ʤ: "dj", x: "kh" },
  { ʃ: "x", ʧ: "q", ʤ: "j" },
];
const VOWEL_ORTHO: Record<string, string>[] = [
  {},
  { A: "ä", E: "ë", I: "ï", O: "ö", U: "ü" },
  { A: "â", E: "ê", I: "y", O: "ô", U: "w" },
  { A: "au", E: "ei", I: "ie", O: "ou", U: "oo" },
  { A: "aa", E: "ee", I: "ii", O: "oo", U: "uu" },
];

type Language = {
  rand: Rand;
  phonemes: Record<string, string[]>;
  structure: string;
  cortho: Record<string, string>;
  vortho: Record<string, string>;
  minsyll: number;
  maxsyll: number;
  morphemes: Map<string, string[]>;
  words: Map<string, string[]>;
  names: string[];
  joiner: string;
  genitive: string;
  definite: string;
};

// A list item, weighted toward the front when `exponent` is 2.
const choose = <T>(list: ArrayLike<T>, rand: Rand, exponent = 1): T => {
  const r = rand();
  return list[Math.floor((exponent === 2 ? r * r : r) * list.length)];
};
const randrange = (lo: number, hi: number, rand: Rand) =>
  Math.floor(rand() * (hi - lo)) + lo;

function shuffled(list: string, rand: Rand): string[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randrange(0, i, rand);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Gives up on a loop that keeps rejecting what it draws: a guard the original doesn't need, since it never
// replays a seed.
const TRIES = 200;

function makeLanguage(rand: Rand): Language {
  const lang: Language = {
    rand,
    phonemes: {
      C: shuffled(choose(CONSONANTS, rand, 2), rand),
      V: shuffled(choose(VOWELS, rand, 2), rand),
      L: shuffled(choose(LIQUIDS, rand, 2), rand),
      S: shuffled(choose(SIBILANTS, rand, 2), rand),
      F: shuffled(choose(FINALS, rand, 2), rand),
    },
    structure: choose(SYLLABLES, rand),
    cortho: choose(CONSONANT_ORTHO, rand, 2),
    vortho: choose(VOWEL_ORTHO, rand, 2),
    minsyll: randrange(1, 3, rand),
    maxsyll: 0,
    morphemes: new Map(),
    words: new Map(),
    names: [],
    joiner: "",
    genitive: "",
    definite: "",
  };
  if (lang.structure.length < 3) lang.minsyll++;
  lang.maxsyll = randrange(lang.minsyll + 1, 7, rand);
  lang.joiner = choose("   -", rand);
  lang.genitive = morpheme(lang, "of");
  lang.definite = morpheme(lang, "the");
  return lang;
}

function syllable(lang: Language): string {
  let syll = "";
  for (let t = 0; t < TRIES; t++) {
    syll = "";
    const s = lang.structure;
    for (let i = 0; i < s.length; i++) {
      const type = s[i];
      if (s[i + 1] === "?") {
        i++;
        if (lang.rand() < 0.5) continue;
      }
      syll += choose(lang.phonemes[type], lang.rand, 2);
    }
    if (!RESTRICTS.some((re) => re.test(syll))) break;
  }
  let spelled = "";
  for (const c of syll)
    spelled += lang.cortho[c] ?? lang.vortho[c] ?? DEFAULT_ORTHO[c] ?? c;
  return spelled;
}

function morpheme(lang: Language, key: string): string {
  const list = lang.morphemes.get(key) ?? [];
  lang.morphemes.set(key, list);
  const extras = key ? 1 : 10;
  for (let t = 0; ; t++) {
    const n = randrange(0, list.length + extras, lang.rand);
    if (list[n]) return list[n];
    const morph = syllable(lang);
    if (
      t < TRIES &&
      [...lang.morphemes.values()].some((l) => l.includes(morph))
    )
      continue;
    list.push(morph);
    return morph;
  }
}

function word(lang: Language, key: string): string {
  const list = lang.words.get(key) ?? [];
  lang.words.set(key, list);
  const extras = key ? 2 : 3;
  for (let t = 0; ; t++) {
    const n = randrange(0, list.length + extras, lang.rand);
    if (list[n]) return list[n];
    const count = randrange(lang.minsyll, lang.maxsyll + 1, lang.rand);
    const keyAt = randrange(0, count, lang.rand);
    let w = "";
    for (let i = 0; i < count; i++) w += morpheme(lang, i === keyAt ? key : "");
    if (t < TRIES && [...lang.words.values()].some((l) => l.includes(w)))
      continue;
    list.push(w);
    return w;
  }
}

const capitalize = (w: string) => w[0].toUpperCase() + w.slice(1);

// A place name of 5 to 12 letters that neither contains nor sits inside an earlier one.
function makeName(lang: Language, key: string): string {
  const { rand } = lang;
  let name = "";
  for (let t = 0; t < TRIES; t++) {
    if (rand() < 0.5) name = capitalize(word(lang, key));
    else {
      const w1 = capitalize(word(lang, rand() < 0.6 ? key : ""));
      const w2 = capitalize(word(lang, rand() < 0.6 ? key : ""));
      if (w1 === w2) continue;
      name =
        rand() > 0.5
          ? [w1, w2].join(lang.joiner)
          : [w1, lang.genitive, w2].join(lang.joiner);
    }
    if (rand() < 0.1) name = [lang.definite, name].join(lang.joiner);
    if (name.length < 5 || name.length > 12) continue;
    if (lang.names.some((n) => name.includes(n) || n.includes(name))) continue;
    break;
  }
  lang.names.push(name);
  return name;
}

// The mesh (mewo2/terrain's makeMesh). Heights live on triangles, the nodes. Neighbouring nodes share an edge
// between two grid points, which is where a coast or border crosses between them.

type Mesh = {
  n: number;
  // Each node's centroid, in map units with (0, 0) at the center and y down.
  x: Float64Array;
  y: Float64Array;
  adj: number[][];
  // Per edge between nodes a and b, sharing grid points p and q: [a, b, p, q].
  edges: number[];
  px: Float64Array;
  py: Float64Array;
  w: number;
  h: number;
  // Grid cells across and down. Cell (i, j) holds nodes 2 (j nx + i) and the one after.
  nx: number;
  ny: number;
};

function makeMesh(rand: Rand, w: number, h: number, across: number): Mesh {
  const cell = Math.min(w, h) / across;
  const nx = Math.round(w / cell);
  const ny = Math.round(h / cell);
  const [cx, cy] = [w / nx, h / ny];
  const cols = nx + 1;
  const px = new Float64Array(cols * (ny + 1));
  const py = new Float64Array(cols * (ny + 1));
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      // Points inside the frame wander up to about a third of a cell, so the triangles don't line up.
      const inner = i > 0 && i < nx && j > 0 && j < ny;
      px[j * cols + i] =
        -w / 2 + i * cx + (inner ? (rand() - 0.5) * 0.7 * cx : 0);
      py[j * cols + i] =
        -h / 2 + j * cy + (inner ? (rand() - 0.5) * 0.7 * cy : 0);
    }
  const d2 = (a: number, b: number) =>
    (px[a] - px[b]) * (px[a] - px[b]) + (py[a] - py[b]) * (py[a] - py[b]);
  const tris: number[] = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * cols + i;
      const [b, c, d] = [a + 1, a + cols, a + cols + 1];
      // Each cell splits along its shorter diagonal.
      if (d2(a, d) <= d2(b, c)) tris.push(a, b, d, a, d, c);
      else tris.push(a, b, c, b, d, c);
    }
  const n = tris.length / 3;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const adj: number[][] = Array.from({ length: n }, () => []);
  const edges: number[] = [];
  const firstOn = new Map<number, number>();
  for (let t = 0; t < n; t++) {
    const v = [tris[3 * t], tris[3 * t + 1], tris[3 * t + 2]];
    x[t] = (px[v[0]] + px[v[1]] + px[v[2]]) / 3;
    y[t] = (py[v[0]] + py[v[1]] + py[v[2]]) / 3;
    for (let k = 0; k < 3; k++) {
      const p = Math.min(v[k], v[(k + 1) % 3]);
      const q = Math.max(v[k], v[(k + 1) % 3]);
      const key = p * px.length + q;
      const other = firstOn.get(key);
      if (other === undefined) firstOn.set(key, t);
      else {
        adj[t].push(other);
        adj[other].push(t);
        edges.push(other, t, p, q);
      }
    }
  }
  return { n, x, y, adj, edges, px, py, w, h, nx, ny };
}

const isEdge = (m: Mesh, i: number) => m.adj[i].length < 3;
const isNearEdge = (m: Mesh, i: number) =>
  m.x[i] < -0.45 * m.w ||
  m.x[i] > 0.45 * m.w ||
  m.y[i] < -0.45 * m.h ||
  m.y[i] > 0.45 * m.h;
const distance = (m: Mesh, i: number, j: number) =>
  Math.sqrt(
    (m.x[i] - m.x[j]) * (m.x[i] - m.x[j]) +
      (m.y[i] - m.y[j]) * (m.y[i] - m.y[j]),
  );

// A binary min-heap of integer values by key, for the priority flood and the territories. It grows as needed.
class Heap {
  private keys = new Float64Array(1024);
  private vals = new Int32Array(1024);
  size = 0;
  // The key of the value `pop` last returned.
  key = 0;
  push(key: number, val: number) {
    if (this.size === this.keys.length) {
      const [keys, vals] = [this.keys, this.vals];
      this.keys = new Float64Array(2 * keys.length);
      this.vals = new Int32Array(2 * keys.length);
      this.keys.set(keys);
      this.vals.set(vals);
    }
    const { keys, vals } = this;
    let i = this.size++;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (keys[up] <= key) break;
      keys[i] = keys[up];
      vals[i] = vals[up];
      i = up;
    }
    keys[i] = key;
    vals[i] = val;
  }
  // Removes and returns the value with the smallest key.
  pop(): number {
    const { keys, vals } = this;
    this.key = keys[0];
    const top = vals[0];
    const n = --this.size;
    const [lastKey, last] = [keys[n], vals[n]];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && keys[c + 1] < keys[c]) c++;
      if (keys[c] >= lastKey) break;
      keys[i] = keys[c];
      vals[i] = vals[c];
      i = c;
    }
    keys[i] = lastKey;
    vals[i] = last;
    return top;
  }
}

// The terrain (mewo2/terrain's generateCoast): a tilted cone with fifty bumps, smoothed, sharpened, eroded along
// its rivers, then cut by the sea.

type Field = Float64Array;

function rnorm(rand: Rand): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let [x1, x2, w] = [0, 0, 2];
    while (w >= 1) {
      x1 = 2 * rand() - 1;
      x2 = 2 * rand() - 1;
      w = x1 * x1 + x2 * x2;
    }
    w = Math.sqrt((-2 * log(w)) / w);
    spare = x2 * w;
    return x1 * w;
  };
}

function mountains(m: Mesh, rand: Rand, count: number, r: number): Field {
  const h = new Float64Array(m.n);
  // Past 3.5 radii a bump adds under 5e-6, too little to see, so each one visits only the cells within reach.
  const reach = 3.5 * r;
  const [cx, cy] = [m.w / m.nx, m.h / m.ny];
  for (let k = 0; k < count; k++) {
    const mx = m.w * (rand() - 0.5);
    const my = m.h * (rand() - 0.5);
    const i0 = Math.max(0, Math.floor((mx - reach + m.w / 2) / cx));
    const i1 = Math.min(m.nx - 1, Math.floor((mx + reach + m.w / 2) / cx));
    const j0 = Math.max(0, Math.floor((my - reach + m.h / 2) / cy));
    const j1 = Math.min(m.ny - 1, Math.floor((my + reach + m.h / 2) / cy));
    for (let j = j0; j <= j1; j++)
      for (let t = 2 * (j * m.nx + i0); t < 2 * (j * m.nx + i1 + 1); t++) {
        const d2 =
          (m.x[t] - mx) * (m.x[t] - mx) + (m.y[t] - my) * (m.y[t] - my);
        if (d2 < reach * reach) h[t] += exp(-d2 / (r * r));
      }
  }
  return h;
}

function relax(m: Mesh, h: Field): Field {
  const out = new Float64Array(m.n);
  for (let i = 0; i < m.n; i++) {
    const nbs = m.adj[i];
    if (nbs.length < 3) continue;
    out[i] = (h[nbs[0]] + h[nbs[1]] + h[nbs[2]]) / 3;
  }
  return out;
}

function normalize(h: Field): Field {
  let [lo, hi] = [Infinity, -Infinity];
  for (const v of h) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
  return h.map((v) => (v - lo) / (hi - lo));
}

function downhill(m: Mesh, h: Field): Int32Array {
  const down = new Int32Array(m.n);
  for (let i = 0; i < m.n; i++) {
    if (isEdge(m, i)) {
      down[i] = -2;
      continue;
    }
    let best = -1;
    let low = h[i];
    for (const j of m.adj[i])
      if (h[j] < low) {
        best = j;
        low = h[j];
      }
    down[i] = best;
  }
  return down;
}

// Raises every pit until water can run from it to the map's edge, each node at least `eps` above the next.
function fillSinks(m: Mesh, h: Field, eps = 1e-5): Field {
  const out = new Float64Array(m.n).fill(Infinity);
  const heap = new Heap();
  for (let i = 0; i < m.n; i++)
    if (isNearEdge(m, i)) {
      out[i] = h[i];
      heap.push(h[i], i);
    }
  while (heap.size) {
    const c = heap.pop();
    for (const j of m.adj[c]) {
      if (out[j] !== Infinity) continue;
      out[j] = Math.max(h[j], out[c] + eps);
      heap.push(out[j], j);
    }
  }
  return out;
}

// Water from every node, each passing its own and its upstream share down to its lowest neighbour. The original
// visits nodes from the highest down. Visiting each once everything upstream of it is done gives the same sums.
function flux(m: Mesh, h: Field): Field {
  const down = downhill(m, h);
  const inflow = new Int32Array(m.n);
  for (let i = 0; i < m.n; i++) if (down[i] >= 0) inflow[down[i]]++;
  const f = new Float64Array(m.n).fill(1 / m.n);
  const queue = new Int32Array(m.n);
  let tail = 0;
  for (let i = 0; i < m.n; i++) if (!inflow[i]) queue[tail++] = i;
  for (let head = 0; head < tail; head++) {
    const j = queue[head];
    const d = down[j];
    if (d < 0) continue;
    f[d] += f[j];
    if (--inflow[d] === 0) queue[tail++] = d;
  }
  return f;
}

// Each node's slope along x and y: the slope of the plane through its three neighbours, or 0 at the map's edge
// (trislope).
function gradient(m: Mesh, h: Field): [Float64Array, Float64Array] {
  const gx = new Float64Array(m.n);
  const gy = new Float64Array(m.n);
  for (let i = 0; i < m.n; i++) {
    const nbs = m.adj[i];
    if (nbs.length !== 3) continue;
    const [a, b, c] = nbs;
    const x1 = m.x[b] - m.x[a];
    const x2 = m.x[c] - m.x[a];
    const y1 = m.y[b] - m.y[a];
    const y2 = m.y[c] - m.y[a];
    const det = x1 * y2 - x2 * y1;
    const h1 = h[b] - h[a];
    const h2 = h[c] - h[a];
    gx[i] = (y2 * h1 - y1 * h2) / det;
    gy[i] = (-x2 * h1 + x1 * h2) / det;
  }
  return [gx, gy];
}

function erode(m: Mesh, h: Field, amount: number): Field {
  const f = flux(m, h);
  const [gx, gy] = gradient(m, h);
  const rate = new Float64Array(m.n);
  let most = 0;
  for (let i = 0; i < m.n; i++) {
    const s = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]);
    rate[i] = Math.min(200, 1000 * Math.sqrt(f[i]) * s + s * s);
    if (rate[i] > most) most = rate[i];
  }
  const out = new Float64Array(m.n);
  for (let i = 0; i < m.n; i++) out[i] = h[i] - (amount * rate[i]) / most;
  return out;
}

// The height below which `q` of the nodes lie, as d3.quantile reads it.
function quantile(h: Field, q: number): number {
  const sorted = Float64Array.from(h).sort();
  const at = (sorted.length - 1) * q;
  const i = Math.floor(at);
  return i + 1 < sorted.length
    ? sorted[i] + (sorted[i + 1] - sorted[i]) * (at - i)
    : sorted[i];
}

// Sinks a lone land node with one land neighbour, then raises a lone sea node, so the coast loses its spurs.
function cleanCoast(m: Mesh, h: Field, iters: number): Field {
  for (let iter = 0; iter < iters; iter++)
    for (const land of [true, false]) {
      const out = Float64Array.from(h);
      for (let i = 0; i < m.n; i++) {
        const nbs = m.adj[i];
        if (h[i] > 0 !== land || nbs.length !== 3) continue;
        let count = 0;
        let best = land ? -Infinity : Infinity;
        for (const j of nbs) {
          if (h[j] > 0 === land) count++;
          else best = land ? Math.max(best, h[j]) : Math.min(best, h[j]);
        }
        if (count > 1) continue;
        out[i] = best / 2;
      }
      h = out;
    }
  return h;
}

// Smoothing passes. The original smooths ten times on a mesh about three times finer, so two passes here round
// off as far without flattening its fifty bumps.
const RELAX = 2;

function terrain(m: Mesh, rand: Rand): Field {
  const normal = rnorm(rand);
  const [tx, ty] = [4 * normal(), 4 * normal()];
  const bumps = mountains(m, rand, 50, 0.05);
  let h: Field = new Float64Array(m.n).map(
    (_, i) =>
      m.x[i] * tx +
      m.y[i] * ty -
      Math.sqrt(m.x[i] * m.x[i] + m.y[i] * m.y[i]) +
      bumps[i],
  );
  for (let i = 0; i < RELAX; i++) h = relax(m, h);
  h = normalize(h).map(Math.sqrt);
  const amount = 0.1 * rand();
  h = fillSinks(m, h);
  for (let i = 0; i < 5; i++) h = fillSinks(m, erode(m, h, amount));
  // The original fills sinks again after lowering the sea, which changes nothing on a surface already filled.
  const sea = quantile(h, 0.2 + 0.4 * rand());
  return cleanCoast(
    m,
    h.map((v) => v - sea),
    3,
  );
}

// Lines on the map: coasts, rivers and borders, as chains of points.

// Joins segments, flat [a, b, a, b, ...] point keys, into paths of keys that run on through every point where
// exactly two segments meet, as mergeSegments does.
function mergeSegments(segs: readonly number[]): number[][] {
  const at = new Map<number, number[]>();
  for (let s = 0; s < segs.length / 2; s++)
    for (const key of [segs[2 * s], segs[2 * s + 1]]) {
      const list = at.get(key) ?? [];
      list.push(s);
      at.set(key, list);
    }
  const done = new Uint8Array(segs.length / 2);
  const grow = (path: number[]) => {
    for (;;) {
      const end = path[path.length - 1];
      const list = at.get(end)!;
      const s = list.length === 2 ? list.find((k) => !done[k]) : undefined;
      if (s === undefined) return;
      done[s] = 1;
      path.push(segs[2 * s] === end ? segs[2 * s + 1] : segs[2 * s]);
    }
  };
  const paths: number[][] = [];
  for (let s = 0; s < done.length; s++) {
    if (done[s]) continue;
    done[s] = 1;
    const path = [segs[2 * s + 1], segs[2 * s]];
    grow(path);
    path.reverse();
    grow(path);
    paths.push(path);
  }
  return paths;
}

// Pulls each inner point a quarter of the way toward each neighbour, keeping the ends, so a path stops zigzagging
// from node to node. Points are flat [x, y, x, y, ...].
function relaxPath(pts: number[]): number[] {
  const out = pts.slice();
  for (let k = 2; k + 2 < pts.length; k += 2)
    for (const c of [0, 1])
      out[k + c] =
        0.25 * pts[k - 2 + c] + 0.5 * pts[k + c] + 0.25 * pts[k + 2 + c];
  return out;
}

const gridPath = (m: Mesh, keys: number[]) =>
  keys.flatMap((k) => [m.px[k], m.py[k]]);

function coasts(m: Mesh, h: Field): number[][] {
  const segs: number[] = [];
  for (let e = 0; e < m.edges.length; e += 4) {
    const [a, b, p, q] = [
      m.edges[e],
      m.edges[e + 1],
      m.edges[e + 2],
      m.edges[e + 3],
    ];
    if (isNearEdge(m, a) || isNearEdge(m, b)) continue;
    if (h[a] > 0 !== h[b] > 0) segs.push(p, q);
  }
  return mergeSegments(segs).map((keys) =>
    relaxPath(relaxPath(gridPath(m, keys))),
  );
}

// Rivers trace every node draining more than a share of the land's water down to the sea.
function rivers(m: Mesh, h: Field, f: Field, down: Int32Array): number[][] {
  let above = 0;
  for (const v of h) if (v > 0) above++;
  const limit = (0.01 * above) / m.n;
  const segs: number[] = [];
  // River mouths stop halfway to the first node under the sea. They're keyed after the nodes.
  const mouths: number[] = [];
  for (let i = 0; i < m.n; i++) {
    if (isNearEdge(m, i) || !(f[i] > limit && h[i] > 0 && down[i] >= 0))
      continue;
    const j = down[i];
    if (h[j] > 0) segs.push(i, j);
    else {
      segs.push(i, m.n + mouths.length / 2);
      mouths.push((m.x[i] + m.x[j]) / 2, (m.y[i] + m.y[j]) / 2);
    }
  }
  return mergeSegments(segs).map((keys) =>
    relaxPath(
      keys.flatMap((k) =>
        k < m.n
          ? [m.x[k], m.y[k]]
          : [mouths[2 * (k - m.n)], mouths[2 * (k - m.n) + 1]],
      ),
    ),
  );
}

// The visible map's half width and height, in map units, inside which towns and labels must sit.
type Bounds = { x: number; y: number };

// Towns go where water gathers, away from the frame and from each other (cityScore and placeCity).
function placeCities(
  m: Mesh,
  h: Field,
  f: Field,
  count: number,
  safe: Bounds,
  view: Bounds,
) {
  const cities: number[] = [];
  for (let c = 0; c < count; c++) {
    let [best, top] = [-1, -Infinity];
    for (let i = 0; i < m.n; i++) {
      const [x, y] = [m.x[i], m.y[i]];
      if (h[i] <= 0 || Math.abs(x) > safe.x || Math.abs(y) > safe.y) continue;
      let score = Math.sqrt(f[i]);
      score += 0.01 / (1e-9 + Math.abs(x) - view.x);
      score += 0.01 / (1e-9 + Math.abs(y) - view.y);
      for (const j of cities) score -= 0.02 / (distance(m, i, j) + 1e-9);
      if (score > top) [best, top] = [i, score];
    }
    if (best < 0) break;
    cities.push(best);
  }
  return cities;
}

// Each capital claims the land it reaches most cheaply, where climbing, crossing rivers and the sea cost more
// (getTerritories). -1 marks a node no capital reached.
function territories(
  m: Mesh,
  h: Field,
  f: Field,
  capitals: number[],
): Int32Array {
  const terr = new Int32Array(m.n).fill(-1);
  const weight = (u: number, v: number) => {
    const horiz = distance(m, u, v);
    let vert = h[v] - h[u];
    if (vert > 0) vert /= 10;
    let diff = 1 + 0.25 * (vert / horiz) * (vert / horiz);
    diff += 100 * Math.sqrt(f[u]);
    if (h[u] <= 0) diff = 100;
    if (h[u] > 0 !== h[v] > 0) return 1000;
    return horiz * diff;
  };
  const heap = new Heap();
  const [cityOf, nodeOf]: number[][] = [[], []];
  const queue = (score: number, city: number, node: number) => {
    heap.push(score, cityOf.length);
    cityOf.push(city);
    nodeOf.push(node);
  };
  for (const c of capitals) {
    terr[c] = c;
    for (const j of m.adj[c]) queue(weight(c, j), c, j);
  }
  while (heap.size) {
    const e = heap.pop();
    const [u, city, score] = [nodeOf[e], cityOf[e], heap.key];
    if (terr[u] >= 0) continue;
    terr[u] = city;
    for (const v of m.adj[u])
      if (terr[v] < 0) queue(score + weight(u, v), city, v);
  }
  return terr;
}

function borders(m: Mesh, h: Field, terr: Int32Array): number[][] {
  const segs: number[] = [];
  for (let e = 0; e < m.edges.length; e += 4) {
    const [a, b, p, q] = [
      m.edges[e],
      m.edges[e + 1],
      m.edges[e + 2],
      m.edges[e + 3],
    ];
    if (isNearEdge(m, a) || isNearEdge(m, b) || h[a] < 0 || h[b] < 0) continue;
    if (terr[a] !== terr[b]) segs.push(p, q);
  }
  return mergeSegments(segs).map((keys) => relaxPath(gridPath(m, keys)));
}

// How much steeper slopes read for hatching than in the original, whose finer mesh carves steeper valleys, and
// the strokes' half length in node spacings.
const SLOPE_GAIN = 2.5;
const HATCH_R = 0.3;

// Short strokes down the slopes, steeper where the land climbs to the right, longer on the near side of a hill,
// as if seen from the bottom of the map (visualizeSlopes). Each is [x0, y0, x1, y1] in map units.
function hatches(m: Mesh, h: Field, rand: Rand, r: number): number[][] {
  const normal = rnorm(rand);
  const [gx, gy] = gradient(m, h);
  const strokes: number[][] = [];
  for (let i = 0; i < m.n; i++) {
    if (h[i] <= 0 || isNearEdge(m, i)) continue;
    const nbs = [...m.adj[i], i];
    let [s, s2] = [0, 0];
    for (const j of nbs) {
      s += (gx[j] * SLOPE_GAIN) / 10;
      s2 += gy[j];
    }
    s /= nbs.length;
    s2 /= nbs.length;
    if (Math.abs(s) < 0.1 + 0.3 * rand()) continue;
    const a = atan(s);
    let l = r * (1 + rand()) * (1 - 0.2 * a * a) * exp(s2 / 100);
    const [x, y] = [m.x[i], m.y[i]];
    if (Math.abs(l * s) > 2 * r) {
      let n = Math.floor(Math.abs((l * s) / r));
      l /= n;
      if (n > 4) n = 4;
      for (let k = 0; k < n; k++) {
        const [u, v] = [normal() * r, normal() * r];
        strokes.push([x + u - l, y + v + l * s, x + u + l, y + v - l * s]);
      }
    } else strokes.push([x - l, y + l * s, x + l, y - l * s]);
  }
  return strokes;
}

// Labels: each town's name beside it, and each territory's in small capitals across it (drawLabels). Positions
// and sizes are in map units, with `y` the baseline and `x` where `align` anchors the text.

type Label = {
  chars: [string, number][];
  x: number;
  y: number;
  align: number;
  size: number;
  box: [number, number, number, number];
};

// Font units per em: Hershey's capitals stand 21 units, about 0.7 em.
const EM = 30;

const cityChars = (name: string): [string, number][] =>
  [...name].map((c) => [c, 1]);
const regionChars = (name: string): [string, number][] =>
  [...name].map((c) =>
    c === c.toUpperCase() ? [c, 1] : [c.toUpperCase(), 0.75],
  );

function labelCities(
  m: Mesh,
  cities: number[],
  names: string[],
  sizes: number[],
  avoid: number[][],
  safe: Bounds,
): Label[] {
  const placed: Label[] = [];
  const penalty = ({ box: [x0, y0, x1, y1] }: Label) => {
    let pen = 0;
    if (x0 < -safe.x || x1 > safe.x || y0 < -safe.y || y1 > safe.y) pen += 100;
    for (const { box: b } of placed)
      if (x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]) pen += 100;
    for (const c of cities)
      if (x0 < m.x[c] && x1 > m.x[c] && y0 < m.y[c] && y1 > m.y[c]) pen += 100;
    for (const path of avoid)
      for (let k = 0; k < path.length; k += 2)
        if (
          path[k] > x0 &&
          path[k] < x1 &&
          path[k + 1] > y0 &&
          path[k + 1] < y1
        )
          pen++;
    return pen;
  };
  cities.forEach((c, i) => {
    const [x, y, sy] = [m.x[c], m.y[c], sizes[i]];
    const chars = cityChars(names[i]);
    const sx = (advance(chars) * sy) / EM;
    const at = (
      lx: number,
      ly: number,
      align: number,
      box: [number, number, number, number],
    ): Label => ({ chars, x: lx, y: ly, align, size: sy, box });
    const options = [
      at(x + 0.8 * sy, y + 0.3 * sy, 0, [
        x + 0.7 * sy,
        y - 0.6 * sy,
        x + 0.7 * sy + sx,
        y + 0.6 * sy,
      ]),
      at(x - 0.8 * sy, y + 0.3 * sy, 1, [
        x - 0.9 * sy - sx,
        y - 0.7 * sy,
        x - 0.9 * sy,
        y + 0.7 * sy,
      ]),
      at(x, y - 0.8 * sy, 0.5, [
        x - sx / 2,
        y - 1.9 * sy,
        x + sx / 2,
        y - 0.7 * sy,
      ]),
      at(x, y + 1.2 * sy, 0.5, [
        x - sx / 2,
        y + 0.1 * sy,
        x + sx / 2,
        y + 1.3 * sy,
      ]),
    ];
    let best = options[0];
    for (const o of options.slice(1)) if (penalty(o) < penalty(best)) best = o;
    placed.push(best);
  });
  return placed;
}

function labelRegions(
  m: Mesh,
  h: Field,
  terr: Int32Array,
  capitals: number[],
  cities: number[],
  cityLabels: Label[],
  names: string[],
  sy: number,
  safe: Bounds,
): Label[] {
  const regions: Label[] = [];
  const center = (city: number, landOnly: boolean) => {
    let [x, y, n] = [0, 0, 0];
    for (let i = 0; i < m.n; i++) {
      if (terr[i] !== city || (landOnly && h[i] <= 0)) continue;
      [x, y, n] = [x + m.x[i], y + m.y[i], n + 1];
    }
    return [x / n, y / n];
  };
  capitals.forEach((city, r) => {
    const chars = regionChars(names[r]);
    const sx = (advance(chars) * sy) / EM;
    const [lx, ly] = center(city, true);
    const [ox, oy] = center(city, false);
    let [best, top] = [0, -Infinity];
    for (let j = 0; j < m.n; j++) {
      const [vx, vy] = [m.x[j], m.y[j]];
      let score =
        -3000 * Math.sqrt((vx - lx) * (vx - lx) + (vy - ly) * (vy - ly)) -
        1000 * Math.sqrt((vx - ox) * (vx - ox) + (vy - oy) * (vy - oy));
      if (terr[j] !== city) score -= 3000;
      cities.forEach((c, k) => {
        if (Math.abs(vx - m.x[c]) < sx && Math.abs(vy - sy / 2 - m.y[c]) < sy)
          score -= k < capitals.length ? 4000 : 500;
        const b = cityLabels[k].box;
        if (
          vx - sx / 2 < b[2] &&
          vx + sx / 2 > b[0] &&
          vy - sy < b[3] &&
          vy > b[1]
        )
          score -= 5000;
      });
      for (const l of regions)
        if (
          vx - sx / 2 < l.box[2] &&
          vx + sx / 2 > l.box[0] &&
          vy - sy < l.y &&
          vy > l.y - sy
        )
          score -= 20000;
      if (h[j] <= 0) score -= 500;
      if (
        vx + sx / 2 > safe.x ||
        vx - sx / 2 < -safe.x ||
        vy > safe.y ||
        vy - sy < -safe.y
      )
        score -= 50000;
      if (score > top) [best, top] = [j, score];
    }
    const [x, y] = [m.x[best], m.y[best]];
    regions.push({
      chars,
      x,
      y,
      align: 0.5,
      size: sy,
      box: [x - sx / 2, y - sy, x + sx / 2, y],
    });
  });
  return regions;
}

// Drawing. Every mark is rasterized here, so the pixels don't depend on the canvas.

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
// How much of a pixel-wide box `d` from a line's center a line `half` wide either side covers. In pixels.
const line = (d: number, half: number) =>
  clamp01(Math.min(d + 0.5, half) - Math.max(d - 0.5, -half));

// Draws marks as ink coverage, 0 to 1 per pixel, into a layer. Marks drawn between two flushes form a group that
// doesn't darken where its marks overlap, so a path's joints print evenly. Groups then build up like ink over ink.
class Pen {
  // The group so far, and the pixels it has touched.
  private group: Float32Array;
  private touched: number[] = [];
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.group = new Float32Array(w * h);
  }
  private put(i: number, c: number) {
    if (c <= 0) return;
    const g = this.group[i];
    if (g === 0) this.touched.push(i);
    if (c > g) this.group[i] = c;
  }
  // The pixel rows and columns within `reach` of a box.
  private span(x0: number, y0: number, x1: number, y1: number, reach: number) {
    return [
      Math.max(0, Math.floor(x0 - reach)),
      Math.max(0, Math.floor(y0 - reach)),
      Math.min(this.w - 1, Math.floor(x1 + reach)),
      Math.min(this.h - 1, Math.floor(y1 + reach)),
    ];
  }
  seg(ax: number, ay: number, bx: number, by: number, half: number) {
    const ex = bx - ax;
    const ey = by - ay;
    const len2 = ex * ex + ey * ey;
    const [i0, j0, i1, j1] = this.span(
      Math.min(ax, bx),
      Math.min(ay, by),
      Math.max(ax, bx),
      Math.max(ay, by),
      half + 1,
    );
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = i + 0.5 - ax;
        const y = j + 0.5 - ay;
        const t = len2 > 0 ? clamp01((x * ex + y * ey) / len2) : 0;
        const qx = x - t * ex;
        const qy = y - t * ey;
        this.put(j * this.w + i, line(Math.sqrt(qx * qx + qy * qy), half));
      }
  }
  polyline(pts: number[], half: number) {
    for (let k = 0; k + 3 < pts.length; k += 2)
      this.seg(pts[k], pts[k + 1], pts[k + 2], pts[k + 3], half);
  }
  disc(cx: number, cy: number, r: number) {
    const [i0, j0, i1, j1] = this.span(cx, cy, cx, cy, r + 1);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = i + 0.5 - cx;
        const y = j + 0.5 - cy;
        let c = 0;
        if (r >= 1) c = clamp01(r - Math.sqrt(x * x + y * y) + 0.5);
        else {
          // Under a pixel wide, count a 4 by 4 grid of samples instead.
          for (let b = 0; b < 4; b++)
            for (let a = 0; a < 4; a++) {
              const sx = x - 0.375 + 0.25 * a;
              const sy = y - 0.375 + 0.25 * b;
              if (sx * sx + sy * sy < r * r) c += 1 / 16;
            }
        }
        this.put(j * this.w + i, c);
      }
  }
  ring(cx: number, cy: number, r: number, half: number) {
    const [i0, j0, i1, j1] = this.span(cx, cy, cx, cy, r + half + 1);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = i + 0.5 - cx;
        const y = j + 0.5 - cy;
        this.put(j * this.w + i, line(Math.sqrt(x * x + y * y) - r, half));
      }
  }
  // Prints the group into `layer` and starts a new one.
  flush(layer: Float32Array) {
    const { group, touched } = this;
    for (const i of touched) {
      layer[i] = 1 - (1 - layer[i]) * (1 - group[i]);
      group[i] = 0;
    }
    touched.length = 0;
  }
}

// Map units per art unit (the art's short side is 1), and the margin of map beyond the art on every side, as a
// share of the map. The original keeps coasts and rivers out of its outer twentieth, which then lies off the art.
const ZOOM = 0.8;
const BLEED = 0.06;
// Grid cells across the map's short side.
const ACROSS = 36;
// Small draws are supersampled until the art's short side has this many samples, so hatching and lettering
// finer than a pixel average out the way they would in a large draw scaled down.
const MIN_UNIT = 192;
// Keeps towns and labels clear of the perforations, in art units from the art's edge.
const SAFE = 0.1;

// Sizes in art units: line half widths, town rings, label ems and the dotted border's dots and spacing.
const HATCH = 0.0021;
const RIVER = 0.003;
const COAST = 0.0058;
const DOT = 0.0042;
const DOT_GAP = 0.019;
const CAPITAL_R = 0.017;
const TOWN_R = 0.009;
const RING = 0.0036;
const CAPITAL_EM = 0.062;
const TOWN_EM = 0.052;
const REGION_EM = 0.085;
// A label's stroke half width, in font units: bolder than Hershey's hairline, so names read at desk size.
const STROKE = 0.9;
// A label's white outline, beyond its strokes, as a share of its em.
const HALO = 0.1;

// The visible map's size in map units, which depends only on whether the art is portrait, square or landscape,
// so the same seed makes the same map at 256 px and 2048 px even though the art's exact aspect differs a little
// between them. Drawing stretches map units onto the art by a few percent at most.
function mapUnits(W: number, H: number): [number, number] {
  const aspect = W / H;
  if (aspect < 0.89) return [ZOOM, ZOOM / 0.74];
  if (aspect > 1.12) return [ZOOM / 0.74, ZOOM];
  return [ZOOM, ZOOM];
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const unit = Math.min(width, height);
  const [vw, vh] = mapUnits(width / unit, height / unit);
  const view = { x: vw / 2, y: vh / 2 };
  const safe = { x: view.x - SAFE * ZOOM, y: view.y - SAFE * ZOOM };
  const m = makeMesh(
    stream(seed, 1),
    vw / (1 - 2 * BLEED),
    vh / (1 - 2 * BLEED),
    ACROSS,
  );
  const h = terrain(m, stream(seed, 2));
  const f = flux(m, h);
  const down = downhill(m, h);

  const coast = coasts(m, h);
  const river = rivers(m, h, f, down);
  const rand = stream(seed, 3);
  const count = 3 + Math.floor(rand() * 3);
  const nterrs = 1 + Math.floor(rand() * 2);
  const cities = placeCities(m, h, f, count, safe, view);
  const capitals = cities.slice(0, nterrs);
  const terr = territories(m, h, f, capitals);
  const border = borders(m, h, terr);

  const lang = makeLanguage(stream(seed, 4));
  const cityNames = cities.map(() => makeName(lang, "city"));
  const sizes = cities.map(
    (_, i) => (i < nterrs ? CAPITAL_EM : TOWN_EM) * ZOOM,
  );
  const cityLabels = labelCities(
    m,
    cities,
    cityNames,
    sizes,
    [...river, ...coast, ...border],
    safe,
  );
  const regionNames = capitals.map(() => makeName(lang, "region"));
  const regionLabels = labelRegions(
    m,
    h,
    terr,
    capitals,
    cities,
    cityLabels,
    regionNames,
    REGION_EM * ZOOM,
    safe,
  );
  const spacing = Math.sqrt((m.w * m.h) / m.n);
  const strokes = hatches(m, h, stream(seed, 5), HATCH_R * spacing);

  // Map units to pixels of the drawing, which small art supersamples.
  const ss = Math.ceil(MIN_UNIT / unit);
  const [sw, sh, su] = [width * ss, height * ss, unit * ss];
  const [kx, ky] = [sw / vw, sh / vh];
  const X = (x: number) => (x + view.x) * kx;
  const Y = (y: number) => (y + view.y) * ky;
  const toPx = (pts: number[]) =>
    pts.map((v, k) => (k % 2 === 0 ? X(v) : Y(v)));

  // Lines under everything; a knockout of paper behind towns and labels; then towns and labels on top.
  const pen = new Pen(sw, sh);
  const lines = new Float32Array(sw * sh);
  const knock = new Float32Array(sw * sh);
  const top = new Float32Array(sw * sh);
  for (const path of river) {
    pen.polyline(toPx(path), RIVER * su);
    pen.flush(lines);
  }
  for (const path of coast) {
    pen.polyline(toPx(path), COAST * su);
    pen.flush(lines);
  }
  for (const path of border) {
    // Dots evenly spaced along the path, measured in pixels so they land alike at every size.
    const pts = toPx(path);
    const gap = DOT_GAP * su;
    let next = gap / 2;
    let walked = 0;
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const [ex, ey] = [pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]];
      const len = Math.sqrt(ex * ex + ey * ey);
      while (next <= walked + len) {
        const t = (next - walked) / len;
        pen.disc(pts[k] + t * ex, pts[k + 1] + t * ey, DOT * su);
        next += gap;
      }
      walked += len;
    }
    pen.flush(lines);
  }
  for (const [x0, y0, x1, y1] of strokes) {
    pen.seg(X(x0), Y(y0), X(x1), Y(y1), HATCH * su);
    pen.flush(lines);
  }

  cities.forEach((c, i) => {
    const r = (i < nterrs ? CAPITAL_R : TOWN_R) * su;
    pen.disc(X(m.x[c]), Y(m.y[c]), r + RING * su);
    pen.flush(knock);
    pen.ring(X(m.x[c]), Y(m.y[c]), r, RING * su);
    pen.flush(top);
  });
  // A name no placement keeps clear of the perforations is left off rather than bitten. Its town stays.
  const clear = {
    x: view.x - (SAFE / 2) * ZOOM,
    y: view.y - (SAFE / 2) * ZOOM,
  };
  const shown = [...cityLabels, ...regionLabels].filter(
    ({ box: [x0, y0, x1, y1] }) =>
      x0 > -clear.x && x1 < clear.x && y0 > -clear.y && y1 < clear.y,
  );
  for (const label of shown) {
    // Font units to map units, and the stroke's half width in pixels.
    const u = label.size / EM;
    const half = (STROKE * u * su) / ZOOM;
    const halo = (HALO * label.size * su) / ZOOM;
    const x0 = label.x - label.align * advance(label.chars) * u;
    const strokes = layout(label.chars).map((pts) =>
      pts.map((v, k) =>
        k % 2 === 0 ? X(x0 + v * u) : Y(label.y + (v - BASELINE) * u),
      ),
    );
    for (const pts of strokes) pen.polyline(pts, half + halo);
    pen.flush(knock);
    for (const pts of strokes) pen.polyline(pts, half);
    pen.flush(top);
  }

  const rgb = (hex: string) =>
    [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  const [p, ink] = [rgb(paper), rgb(inks[0])];
  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      // The ink over the pixel, averaged over its samples.
      let c = 0;
      for (let j = y * ss; j < (y + 1) * ss; j++)
        for (let i = x * ss; i < (x + 1) * ss; i++) {
          const k = j * sw + i;
          c += 1 - (1 - lines[k] * (1 - knock[k])) * (1 - top[k]);
        }
      c /= ss * ss;
      const o = 4 * (y * width + x);
      for (let k = 0; k < 3; k++)
        data[o + k] = Math.round(p[k] + (ink[k] - p[k]) * c);
      data[o + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
}

export const fantasyMap1: Style = { id: "map1", draw };
