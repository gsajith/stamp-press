import { atan2, cos, exp, log, pow, sin } from "../exact";
import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Ink landscape: a vignette from a Chinese shan shui scroll. One mountain with its texture strokes, pines and
// the odd hut on its slopes, water lines at its foot and a pale far range behind, then one subject in front:
// a grove, a pavilion or a boat. Mist is bare paper between them.
//
// Ported from shan-shui-inf by Lingdong Huang (github.com/LingDong-/shan-shui-inf), whose license follows:
//
//   MIT License
//
//   Copyright (c) 2018 Lingdong Huang
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
//   associated documentation files (the "Software"), to deal in the Software without restriction, including
//   without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
//   following conditions:
//
//   The above copyright notice and this permission notice shall be included in all copies or substantial
//   portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
//   LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
//   EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
//   IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
//   USE OR OTHER DEALINGS IN THE SOFTWARE.
//
// The generators below keep the original's structure, names and constants, so they can be read side by side
// with it. What changed: they take a seeded stream instead of Math.random, use exact.ts for trig, pow, exp and
// log (ADR 0001), and push shapes to a list instead of writing SVG. The original draws its SVG in the browser;
// here the shapes are filled by the exact-area rasterizer at the bottom, so pixels match in every browser and
// in Node. Left out: the infinite scroll and its planner, flat mountains, tree07, transmission towers and the
// "Pizza Hut" sign.

type Pt = [number, number];
type Rgb = [number, number, number];

// A color as the original writes it, rgba(g, g, g, a): a grey level from 0, full ink, to 255, paper, and an
// opacity. `ink` is FAR for the far range's wash, which prints in its own ink.
type Col = { g: number; a: number; ink: number };
const FAR = 1;
const grey = (a: number, g = 100, ink = 0): Col => ({ g, a, ink });
// The original's "white": paper, which hides what's behind it.
const WHITE: Col = grey(1, 255);

// A shape to paint, in scene units: a filled polygon, or with `line`, an open polyline that wide.
type Shape = { pts: Pt[]; col: Col; line?: number };

// The original's units are screen pixels, its scroll 800 tall. The art's short side spans this many, which
// frames one peak and puts a desk stamp's finest strokes at about a pixel.
const SPAN = 400;
// How much darker than the original its greys print: its grey 100, the usual ink, comes out a quarter of the
// way from ink to paper rather than two fifths. Stamp art is small, and the original's light greys wash out.
const DARKEN = 1.25;
const PI = Math.PI;

const distance = (a: Pt, b: Pt) => {
  const [dx, dy] = [a[0] - b[0], a[1] - b[1]];
  return Math.sqrt(dx * dx + dy * dy);
};
const midPt = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
// pow for the original's Math.pow(sin(...), k), whose base can come out a hair below 0 where it should be 0.
const root = (x: number, k: number) =>
  x > 0 ? (k === 0.5 ? Math.sqrt(x) : pow(x, k)) : 0;

// Blob outlines: the original's default dab, and the pointed leaf its pines and twigs use.
const DAB = (x: number) =>
  x <= 1 ? root(sin(x * PI), 0.5) : -root(sin((x + 1) * PI), 0.5);
const LEAF = (x: number) =>
  x <= 1 ? root(sin(x * PI) * x, 0.5) : -root(sin((x - 2) * PI * (x - 2)), 0.5);
// A blob's outline function at its 21 points, worked out once per function.
const profiles = new Map<(x: number) => number, Float64Array>();
const profileOf = (fun: (x: number) => number) => {
  let got = profiles.get(fun);
  if (!got) {
    got = Float64Array.from({ length: 21 }, (_, i) => fun((i / 20) * 2));
    profiles.set(fun, got);
  }
  return got;
};

// p5.js's noise(), which the original copies: 4 octaves of value noise over a table of 4096 random values,
// eased by a cosine. Returns [0, 1).
function p5Noise(rand: () => number) {
  const YWRAPB = 4;
  const YWRAP = 1 << YWRAPB;
  const ZWRAPB = 8;
  const ZWRAP = 1 << ZWRAPB;
  const SIZE = 4095;
  const perlin = Float64Array.from({ length: SIZE + 1 }, rand);
  // 0.5 (1 - cos(pi t)) for t in [0, 1), written as 0.5 + 0.5 sin(pi (t - 0.5)) by its Taylor series, which
  // is within 1e-9 and much cheaper than a general cosine.
  const ease = (t: number) => {
    const x = PI * (t - 0.5);
    const x2 = x * x;
    return (
      0.5 +
      0.5 *
        x *
        (1 +
          x2 *
            (-1 / 6 +
              x2 *
                (1 / 120 +
                  x2 *
                    (-1 / 5040 +
                      x2 *
                        (1 / 362880 +
                          x2 * (-1 / 39916800 + x2 / 6227020800))))))
    );
  };
  return (x: number, y = 0, z = 0) => {
    if (x < 0) x = -x;
    if (y < 0) y = -y;
    if (z < 0) z = -z;
    let xi = Math.floor(x);
    let yi = Math.floor(y);
    let zi = Math.floor(z);
    let xf = x - xi;
    let yf = y - yi;
    let zf = z - zi;
    let r = 0;
    let ampl = 0.5;
    for (let o = 0; o < 4; o++) {
      let of = xi + (yi << YWRAPB) + (zi << ZWRAPB);
      const rxf = ease(xf);
      const ryf = ease(yf);
      let n1 = perlin[of & SIZE];
      n1 += rxf * (perlin[(of + 1) & SIZE] - n1);
      let n2 = perlin[(of + YWRAP) & SIZE];
      n2 += rxf * (perlin[(of + YWRAP + 1) & SIZE] - n2);
      n1 += ryf * (n2 - n1);
      // The next z layer, which only counts off whole z.
      if (zf !== 0) {
        of += ZWRAP;
        n2 = perlin[of & SIZE];
        n2 += rxf * (perlin[(of + 1) & SIZE] - n2);
        let n3 = perlin[(of + YWRAP) & SIZE];
        n3 += rxf * (perlin[(of + YWRAP + 1) & SIZE] - n3);
        n2 += ryf * (n3 - n2);
        n1 += ease(zf) * (n2 - n1);
      }
      r += n1 * ampl;
      ampl *= 0.5;
      xi <<= 1;
      xf *= 2;
      yi <<= 1;
      yf *= 2;
      zi <<= 1;
      zf *= 2;
      if (xf >= 1) {
        xi++;
        xf--;
      }
      if (yf >= 1) {
        yi++;
        yf--;
      }
      if (zf >= 1) {
        zi++;
        zf--;
      }
    }
    return r;
  };
}

// Splits a convex polygon into triangles under `area`, as the original's PolyTools.triangulate does with
// { convex: true, optimize: false }: cut the first ear, then halve each triangle across its longest side.
function triangulate(plist: Pt[], area: number): Pt[][] {
  const sides = (p: Pt[]) =>
    p.map((pt, i) => distance(pt, p[(i + 1) % p.length]));
  const areaOf = (p: Pt[]) => {
    const [a, b, c] = sides(p);
    const s = (a + b + c) / 2;
    return Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)));
  };
  const shatter = (p: Pt[]): Pt[][] => {
    if (p.length === 0) return [];
    if (areaOf(p) < area) return [p];
    const s = sides(p);
    const ind = s.reduce((m, x, i) => (x > s[m] ? i : m), 0);
    const nind = (ind + 1) % p.length;
    const lind = (ind + 2) % p.length;
    const mid = midPt(p[ind], p[nind]);
    return shatter([p[ind], mid, p[lind]]).concat(
      shatter([p[lind], p[nind], mid]),
    );
  };
  const out: Pt[][] = [];
  let rest = plist;
  while (rest.length > 3) {
    out.push(...shatter([rest[rest.length - 1], rest[0], rest[1]]));
    rest = rest.slice(1);
  }
  return out.concat(shatter(rest));
}

// The original's generators, drawing from `R` in place of Math.random. Each call pushes its shapes, back to
// front, onto the list `shapes` holds at the time.
function shanShui(R: () => number, noiseRand: () => number) {
  const noise = p5Noise(noiseRand);
  let shapes: Shape[] = [];
  const choice = <T>(arr: readonly T[]) => arr[Math.floor(arr.length * R())];
  const normRand = (m: number, M: number) => m + (M - m) * R();
  const wtrand = (f: (x: number) => number) => {
    for (;;) {
      const x = R();
      if (R() < f(x)) return x;
    }
  };
  const randGaussian = () =>
    wtrand((x) => exp(-24 * (x - 0.5) * (x - 0.5))) * 2 - 1;
  // The shapes `f` pushes, held back to push later.
  const capture = (f: () => void) => {
    const saved = shapes;
    shapes = [];
    f();
    const got = shapes;
    shapes = saved;
    return got;
  };

  function loopNoise(ns: number[]) {
    const dif = ns[ns.length - 1] - ns[0];
    let [lo, hi] = [100, -100];
    for (let i = 0; i < ns.length; i++) {
      ns[i] += (dif * (ns.length - 1 - i)) / (ns.length - 1);
      lo = Math.min(lo, ns[i]);
      hi = Math.max(hi, ns[i]);
    }
    for (let i = 0; i < ns.length; i++)
      ns[i] = hi > lo ? (ns[i] - lo) / (hi - lo) : 0;
  }

  // A rational quadratic Bezier spline through the midpoints of P.
  function bezmh(P: Pt[], w = 1): Pt[] {
    if (P.length === 2) P = [P[0], midPt(P[0], P[1]), P[1]];
    const plist: Pt[] = [];
    for (let j = 0; j < P.length - 2; j++) {
      const p0 = j === 0 ? P[j] : midPt(P[j], P[j + 1]);
      const p1 = P[j + 1];
      const p2 = j === P.length - 3 ? P[j + 2] : midPt(P[j + 1], P[j + 2]);
      const pl = 20;
      for (let i = 0; i < pl + (j === P.length - 3 ? 1 : 0); i++) {
        const t = i / pl;
        const u = (1 - t) * (1 - t) + 2 * t * (1 - t) * w + t * t;
        plist.push([
          ((1 - t) * (1 - t) * p0[0] +
            2 * t * (1 - t) * p1[0] * w +
            t * t * p2[0]) /
            u,
          ((1 - t) * (1 - t) * p0[1] +
            2 * t * (1 - t) * p1[1] * w +
            t * t * p2[1]) /
            u,
        ]);
      }
    }
    return plist;
  }

  function poly(pts: Pt[], fil?: Col, str?: Col, wid = 0) {
    if (fil) shapes.push({ pts, col: fil });
    if (str && wid > 0) shapes.push({ pts, col: str, line: wid });
  }

  // A brush stroke along ptlist, `wid` either side at its widest and tapering by `fun`. The original also
  // outlines it `out` wide in the same color, which here widens it instead.
  function stroke(
    ptlist: Pt[],
    col: Col,
    {
      wid = 2,
      noi = 0.5,
      out = 1,
      fun = (x: number) => sin(x * PI),
    }: {
      wid?: number;
      noi?: number;
      out?: number;
      fun?: (x: number) => number;
    } = {},
  ) {
    // Two points have no body to widen, so only the original's outline shows: a short dash.
    if (ptlist.length === 2 && out > 0)
      shapes.push({ pts: ptlist, col, line: out });
    if (ptlist.length < 3) return;
    const v0: Pt[] = [];
    const v1: Pt[] = [];
    const n0 = R() * 10;
    for (let i = 1; i < ptlist.length - 1; i++) {
      let w = wid * fun(i / ptlist.length);
      w = w * (1 - noi) + w * noi * noise(i * 0.5, n0);
      w += w < 0 ? -out / 2 : out / 2;
      // The original offsets along the bisector of the angles to the neighbours. The normal to the chord
      // between them is the same on smooth strokes, needs no trig, and never flips sides.
      const [p, a0, b0] = [ptlist[i], ptlist[i - 1], ptlist[i + 1]];
      const [tx, ty] = [b0[0] - a0[0], b0[1] - a0[1]];
      const tl = Math.sqrt(tx * tx + ty * ty);
      if (tl === 0) continue;
      const [c, s] = [-ty / tl, tx / tl];
      v0.push([p[0] + w * c, p[1] + w * s]);
      v1.push([p[0] - w * c, p[1] - w * s]);
    }
    shapes.push({
      pts: [ptlist[0], ...v0, ptlist[ptlist.length - 1], ...v1.reverse()],
      col,
    });
  }

  type BlobArgs = {
    len?: number;
    wid?: number;
    ang?: number;
    col?: Col;
    noi?: number;
    fun?: (x: number) => number;
  };
  // A leaf- or dab-shaped outline, `len` long and `wid` wide, turned by `ang`.
  function blobPts(
    x: number,
    y: number,
    { len = 20, wid = 5, ang = 0, noi = 0.5, fun = DAB }: BlobArgs,
  ): Pt[] {
    const reso = 20;
    const profile = profileOf(fun);
    const ns: number[] = [];
    const n0 = R() * 10;
    for (let i = 0; i < reso + 1; i++) ns.push(noise(i * 0.05, n0));
    loopNoise(ns);
    // The original turns each point by its angle plus `ang`. Turning the point itself by `ang` is the same.
    const [ca, sa] = [cos(ang), sin(ang)];
    return ns.map((n, i): Pt => {
      const p = (i / reso) * 2;
      const k = n * noi + (1 - noi);
      const xo = (len / 2 - Math.abs(p - 1) * len) * k;
      const yo = ((profile[i] * wid) / 2) * k;
      return [x + xo * ca - yo * sa, y + xo * sa + yo * ca];
    });
  }
  const blob = (x: number, y: number, args: BlobArgs) =>
    poly(blobPts(x, y, args), args.col ?? grey(0.9, 200));

  function div(plist: Pt[], reso: number): Pt[] {
    const tl = (plist.length - 1) * reso;
    const rlist: Pt[] = [];
    for (let i = 0; i < tl; i++) {
      const lastp = plist[Math.floor(i / reso)];
      const nextp = plist[Math.ceil(i / reso)];
      const p = (i % reso) / reso;
      rlist.push([
        lastp[0] * (1 - p) + nextp[0] * p,
        lastp[1] * (1 - p) + nextp[1] * p,
      ]);
    }
    if (plist.length > 0) rlist.push(plist[plist.length - 1]);
    return rlist;
  }

  // Short strokes laid across a grid of points, rows `ptlist` running from outline to core: a mountain's or a
  // rock's texture.
  function texture(
    ptlist: Pt[][],
    {
      xof = 0,
      yof = 0,
      tex = 400,
      wid = 1.5,
      len = 0.2,
      sha = 0,
      noi = (x: number) => 30 / x,
      col = () => grey(R() * 0.3),
      dis = () => (R() > 0.5 ? (1 / 3) * R() : 2 / 3 + (1 / 3) * R()),
    }: {
      xof?: number;
      yof?: number;
      tex?: number;
      wid?: number;
      len?: number;
      sha?: number;
      noi?: (x: number) => number;
      col?: (x: number) => Col;
      dis?: () => number;
    },
  ) {
    const reso = [ptlist.length, ptlist[0].length];
    const texlist: Pt[][] = [];
    for (let i = 0; i < tex; i++) {
      const mid = Math.floor(dis() * reso[1]);
      const hlen = Math.floor(R() * (reso[1] * len));
      const start = Math.min(Math.max(mid - hlen, 0), reso[1]);
      const end = Math.min(Math.max(mid + hlen, 0), reso[1]);
      const layer = (i / tex) * (reso[0] - 1);
      const row: Pt[] = [];
      for (let j = start; j < end; j++) {
        const p = layer - Math.floor(layer);
        const [a, b] = [
          ptlist[Math.floor(layer)][j],
          ptlist[Math.ceil(layer)][j],
        ];
        const x = a[0] * p + b[0] * (1 - p);
        const y = a[1] * p + b[1] * (1 - p);
        const k = noi(layer + 1);
        row.push([
          x + k * (noise(x, j * 0.5) - 0.5),
          y + k * (noise(y, j * 0.5) - 0.5),
        ]);
      }
      texlist.push(row.map(([x, y]): Pt => [x + xof, y + yof]));
    }
    if (sha) {
      for (let j = 0; j < texlist.length; j += 2)
        stroke(texlist[j], grey(0.1), { wid: sha });
    }
    for (let j = sha; j < texlist.length; j += 1 + sha) {
      stroke(texlist[j], col(j / texlist.length), { wid });
    }
  }

  // ---- Trees ----

  // A thin pine: two wavering trunk lines and dabs of needles.
  function tree01(
    x: number,
    y: number,
    { hei = 50, wid = 3, col = grey(0.5) } = {},
  ) {
    const reso = 10;
    const nslist: Pt[] = [];
    for (let i = 0; i < reso; i++)
      nslist.push([noise(i * 0.5), noise(i * 0.5, 0.5)]);
    const line1: Pt[] = [];
    const line2: Pt[] = [];
    for (let i = 0; i < reso; i++) {
      const nx = x;
      const ny = y - (i * hei) / reso;
      if (i >= reso / 4) {
        for (let j = 0; j < (reso - i) / 5; j++) {
          blob(
            nx + (R() - 0.5) * wid * 1.2 * (reso - i),
            ny + (R() - 0.5) * wid,
            {
              len: R() * 20 * (reso - i) * 0.2 + 10,
              wid: R() * 6 + 3,
              ang: ((R() - 0.5) * PI) / 6,
              col: grey(Math.round((R() * 0.2 + col.a) * 10) / 10),
            },
          );
        }
      }
      line1.push([nx + (nslist[i][0] - 0.5) * wid - wid / 2, ny]);
      line2.push([nx + (nslist[i][1] - 0.5) * wid + wid / 2, ny]);
    }
    poly(line1, undefined, col, 1.5);
    poly(line2, undefined, col, 1.5);
  }

  // A tuft of small trees, the dots along a ridge.
  function tree02(
    x: number,
    y: number,
    { hei = 16, wid = 8, clu = 5, col = grey(0.5) } = {},
  ) {
    for (let i = 0; i < clu; i++) {
      blob(x + randGaussian() * clu * 4, y + randGaussian() * clu * 4, {
        ang: PI / 2,
        fun: LEAF,
        wid: R() * wid * 0.75 + wid * 0.5,
        len: R() * hei * 0.75 + hei * 0.5,
        col,
      });
    }
  }

  // A pine with a solid trunk and needles spreading wider toward its foot.
  function tree03(
    x: number,
    y: number,
    {
      hei = 50,
      wid = 5,
      ben = () => 0,
      col = grey(0.5),
    }: {
      hei?: number;
      wid?: number;
      ben?: (x: number) => number;
      col?: Col;
    } = {},
  ) {
    const reso = 10;
    const nslist: Pt[] = [];
    for (let i = 0; i < reso; i++)
      nslist.push([noise(i * 0.5), noise(i * 0.5, 0.5)]);
    const line1: Pt[] = [];
    const line2: Pt[] = [];
    const blobs = capture(() => {
      for (let i = 0; i < reso; i++) {
        const nx = x + ben(i / reso) * 100;
        const ny = y - (i * hei) / reso;
        if (i >= reso / 5) {
          for (let j = 0; j < (reso - i) * 2; j++) {
            const shape = (x: number) => log(50 * x + 1) / 3.95;
            const ox = R() * wid * 2 * shape((reso - i) / reso);
            blob(nx + ox * choice([-1, 1]), ny + (R() - 0.5) * wid * 2, {
              len: ox * 2,
              wid: R() * 6 + 3,
              ang: ((R() - 0.5) * PI) / 6,
              col: grey(R() * 0.2 + col.a),
            });
          }
        }
        line1.push([
          nx + (((nslist[i][0] - 0.5) * wid - wid / 2) * (reso - i)) / reso,
          ny,
        ]);
        line2.push([
          nx + (((nslist[i][1] - 0.5) * wid + wid / 2) * (reso - i)) / reso,
          ny,
        ]);
      }
    });
    poly(line1.concat(line2.reverse()), WHITE, col, 1.5);
    shapes.push(...blobs);
  }

  // A trunk or bough: three bent segments from the origin, `hei` long, as its two edges.
  function branch({
    hei = 300,
    wid = 6,
    ang = 0,
    det = 10,
    ben = PI * 0.2,
  }: {
    hei?: number;
    wid?: number;
    ang?: number;
    det?: number;
    ben?: number;
  }): [Pt[], Pt[]] {
    let [nx, ny] = [0, 0];
    const tlist: Pt[] = [[nx, ny]];
    let a0 = 0;
    const g = 3;
    for (let i = 0; i < g; i++) {
      a0 += (ben / 2 + (R() * ben) / 2) * choice([-1, 1]);
      nx += (cos(a0) * hei) / g;
      ny -= (sin(a0) * hei) / g;
      tlist.push([nx, ny]);
    }
    const ta = atan2(tlist[tlist.length - 1][1], tlist[tlist.length - 1][0]);
    for (const t of tlist) {
      const a = atan2(t[1], t[0]);
      const d = Math.sqrt(t[0] * t[0] + t[1] * t[1]);
      [t[0], t[1]] = [d * cos(a - ta + ang), d * sin(a - ta + ang)];
    }
    const trlist1: Pt[] = [];
    const trlist2: Pt[] = [];
    const span = det;
    const tl = (tlist.length - 1) * span;
    let [lx, ly] = [0, 0];
    for (let i = 0; i < tl; i++) {
      const lastp = tlist[Math.floor(i / span)];
      const nextp = tlist[Math.ceil(i / span)];
      const p = (i % span) / span;
      const nx = lastp[0] * (1 - p) + nextp[0] * p;
      const ny = lastp[1] * (1 - p) + nextp[1] * p;
      const ang = atan2(ny - ly, nx - lx);
      const woff = ((noise(i * 0.3) - 0.5) * wid * hei) / 80;
      const b = p === 0 ? R() * wid : 0;
      const nw = wid * (((tl - i) / tl) * 0.5 + 0.5);
      const [c, s] = [cos(ang + PI / 2), sin(ang + PI / 2)];
      trlist1.push([nx + c * (nw + woff + b), ny + s * (nw + woff + b)]);
      trlist2.push([nx - c * (nw - woff + b), ny - s * (nw - woff + b)]);
      [lx, ly] = [nx, ny];
    }
    return [trlist1, trlist2];
  }

  // A curving twig, forking `dep` more times, with leaves at its tips when lea[0].
  function twig(
    tx: number,
    ty: number,
    dep: number,
    {
      dir = 1,
      sca = 1,
      wid = 1,
      ang = 0,
      lea = [true, 12] as [boolean, number],
    }: {
      dir?: number;
      sca?: number;
      wid?: number;
      ang?: number;
      lea?: [boolean, number];
    } = {},
  ) {
    const twlist: Pt[] = [];
    const tl = 10;
    const hs = R() * 0.5 + 0.5;
    const tfun = (x: number) => 1 - 1 / pow(x + 1, 5);
    const a0 = ((R() * PI) / 6) * dir + ang;
    for (let i = 0; i < tl; i++) {
      const mx = dir * tfun(i / tl) * 50 * sca * hs;
      const my = -i * 5 * sca;
      const a = atan2(my, mx);
      const d = Math.sqrt(mx * mx + my * my);
      const nx = cos(a + a0) * d;
      const ny = sin(a + a0) * d;
      twlist.push([nx + tx, ny + ty]);
      if (
        (i === Math.floor(tl / 3) || i === Math.floor((tl * 2) / 3)) &&
        dep > 0
      ) {
        twig(nx + tx, ny + ty, dep - 1, {
          ang,
          sca: sca * 0.8,
          wid,
          dir: dir * choice([-1, 1]),
          lea,
        });
      }
      if (i === tl - 1 && lea[0]) {
        for (let j = 0; j < 5; j++) {
          const dj = (j - 2.5) * 5;
          blob(
            nx + tx + cos(ang) * dj * wid,
            ny + ty + (sin(ang) * dj - lea[1] / (dep + 1)) * wid,
            {
              wid: (6 + 3 * R()) * wid,
              len: (15 + 12 * R()) * wid,
              ang: ang / 2 + PI / 2 + PI * 0.2 * (R() - 0.5),
              col: grey(0.5 + dep * 0.2),
              fun: LEAF,
            },
          );
        }
      }
    }
    stroke(twlist, grey(0.5), { wid: 1, fun: (x) => cos((x * PI) / 2) });
  }

  // Bark marks, knots and the rough edge lines of a trunk given as its two edges.
  function barkify(x: number, y: number, trlist: [Pt[], Pt[]]) {
    const bark = (x: number, y: number, wid: number, ang: number) => {
      const len = 10 + 10 * R();
      const pts = blobPts(x, y, { len, wid, ang, noi: 0.5 });
      const fr = R();
      stroke(pts, grey(0.4), {
        wid: 0.8,
        noi: 0,
        out: 0,
        fun: (x) => sin((x + fr) * PI * 3),
      });
    };
    for (let i = 2; i < trlist[0].length - 1; i++) {
      const a0 = atan2(
        trlist[0][i][1] - trlist[0][i - 1][1],
        trlist[0][i][0] - trlist[0][i - 1][0],
      );
      const a1 = atan2(
        trlist[1][i][1] - trlist[1][i - 1][1],
        trlist[1][i][0] - trlist[1][i - 1][0],
      );
      const p = R();
      const nx = trlist[0][i][0] * (1 - p) + trlist[1][i][0] * p;
      const ny = trlist[0][i][1] * (1 - p) + trlist[1][i][1] * p;
      if (R() < 0.2) {
        blob(nx + x, ny + y, {
          noi: 1,
          len: 15,
          wid: 6 - Math.abs(p - 0.5) * 10,
          ang: (a0 + a1) / 2,
          col: grey(0.6),
        });
      } else {
        bark(nx + x, ny + y, 5 - Math.abs(p - 0.5) * 10, (a0 + a1) / 2);
      }
      if (R() < 0.05) {
        const jl = R() * 2 + 2;
        const xya = choice([
          [trlist[0][i][0], trlist[0][i][1], a0],
          [trlist[1][i][0], trlist[1][i][1], a1],
        ]);
        for (let j = 0; j < jl; j++) {
          blob(
            xya[0] + x + cos(xya[2]) * (j - jl / 2) * 4,
            xya[1] + y + sin(xya[2]) * (j - jl / 2) * 4,
            {
              wid: 4,
              len: 4 + 6 * R(),
              ang: a0 + PI / 2,
              col: grey(0.6),
            },
          );
        }
      }
    }
    const trflist = trlist[0].concat(trlist[1].slice().reverse());
    let rglist: Pt[][] = [[]];
    for (const t of trflist) {
      if (R() < 0.5) rglist.push([]);
      else rglist[rglist.length - 1].push(t);
    }
    rglist = rglist.map((r, i) =>
      div(r, 4).map(
        ([px, py], j): Pt => [
          px + (noise(i, j * 0.1, 1) - 0.5) * (15 + 5 * randGaussian()),
          py + (noise(i, j * 0.1, 2) - 0.5) * (15 + 5 * randGaussian()),
        ],
      ),
    );
    for (const r of rglist) {
      stroke(
        r.map(([px, py]): Pt => [px + x, py + y]),
        grey(0.7),
        { wid: 1.5, out: 0 },
      );
    }
  }

  // A trunk's outline drawn as one stroke along it, over a paper fill.
  function trunk(trmlist: Pt[], x: number, y: number, alpha: number) {
    poly(
      trmlist.map(([px, py]): Pt => [px + x, py + y]),
      WHITE,
    );
    stroke(
      trmlist.slice(1, -1).map(([px, py]): Pt => [px + x, py + y]),
      grey(alpha),
      { wid: 2.5, fun: () => sin(1), noi: 0.9, out: 0 },
    );
  }

  // A big leaning tree with a few long boughs and leafy twigs.
  function tree04(x: number, y: number, { hei = 300, wid = 6 } = {}) {
    let twigs: Shape[] = [];
    const tr = branch({ hei, wid, ang: -PI / 2 });
    const trunkBark = capture(() => barkify(x, y, tr));
    const trlist = tr[0].concat(tr[1].reverse());
    let trmlist: Pt[] = [];
    for (let i = 0; i < trlist.length; i++) {
      if (
        (i >= trlist.length * 0.3 && i <= trlist.length * 0.7 && R() < 0.1) ||
        i === trlist.length / 2 - 1
      ) {
        const ba = PI * 0.2 - PI * 1.4 * (i > trlist.length / 2 ? 1 : 0);
        const brlist = branch({
          hei: hei * (R() + 1) * 0.3,
          wid: wid * 0.5,
          ang: ba,
        });
        brlist[0].splice(0, 1);
        brlist[1].splice(0, 1);
        const foff = (v: Pt): Pt => [v[0] + trlist[i][0], v[1] + trlist[i][1]];
        trunkBark.push(
          ...capture(() =>
            barkify(x, y, [brlist[0].map(foff), brlist[1].map(foff)]),
          ),
        );
        for (let j = 0; j < brlist[0].length; j++) {
          if (R() < 0.2 || j === brlist[0].length - 1) {
            twigs = twigs.concat(
              capture(() =>
                twig(
                  brlist[0][j][0] + trlist[i][0] + x,
                  brlist[0][j][1] + trlist[i][1] + y,
                  1,
                  {
                    wid: hei / 300,
                    ang: ba > -PI / 2 ? ba : ba + PI,
                    sca: (0.5 * hei) / 300,
                    dir: ba > -PI / 2 ? 1 : -1,
                  },
                ),
              ),
            );
          }
        }
        trmlist = trmlist.concat(
          brlist[0].concat(brlist[1].reverse()).map(foff),
        );
      } else {
        trmlist.push(trlist[i]);
      }
    }
    trunk(trmlist, x, y, 0.4 + R() * 0.1);
    shapes.push(...trunkBark, ...twigs);
  }

  // A tall straight tree with short boughs ending in tufts.
  function tree05(x: number, y: number, { hei = 300, wid = 5 } = {}) {
    let twigs: Shape[] = [];
    const tr = branch({ hei, wid, ang: -PI / 2, ben: 0 });
    const trunkBark = capture(() => barkify(x, y, tr));
    const trlist = tr[0].concat(tr[1].reverse());
    let trmlist: Pt[] = [];
    for (let i = 0; i < trlist.length; i++) {
      const p = Math.abs(i - trlist.length * 0.5) / (trlist.length * 0.5);
      if (
        (i >= trlist.length * 0.2 &&
          i <= trlist.length * 0.8 &&
          i % 3 === 0 &&
          R() > p) ||
        i === trlist.length / 2 - 1
      ) {
        const bar = R() * 0.2;
        const ba =
          -bar * PI - (1 - bar * 2) * PI * (i > trlist.length / 2 ? 1 : 0);
        const brlist = branch({
          hei: hei * (0.3 * p - R() * 0.05),
          wid: wid * 0.5,
          ang: ba,
          ben: 0.5,
        });
        brlist[0].splice(0, 1);
        brlist[1].splice(0, 1);
        for (let j = 0; j < brlist[0].length; j++) {
          if (j % 20 === 0 || j === brlist[0].length - 1) {
            twigs = twigs.concat(
              capture(() =>
                twig(
                  brlist[0][j][0] + trlist[i][0] + x,
                  brlist[0][j][1] + trlist[i][1] + y,
                  0,
                  {
                    wid: hei / 300,
                    ang: ba > -PI / 2 ? ba : ba + PI,
                    sca: (0.2 * hei) / 300,
                    dir: ba > -PI / 2 ? 1 : -1,
                    lea: [true, 5],
                  },
                ),
              ),
            );
          }
        }
        const foff = (v: Pt): Pt => [v[0] + trlist[i][0], v[1] + trlist[i][1]];
        trmlist = trmlist.concat(
          brlist[0].concat(brlist[1].reverse()).map(foff),
        );
      } else {
        trmlist.push(trlist[i]);
      }
    }
    trunk(trmlist, x, y, 0.4 + R() * 0.1);
    shapes.push(...trunkBark, ...twigs);
  }

  // A bare tree forking three times, like antlers.
  function tree06(x: number, y: number, { hei = 100, wid = 6 } = {}) {
    const bark: Shape[] = [];
    let twigs: Shape[] = [];
    const fracTree = (
      xoff: number,
      yoff: number,
      dep: number,
      { hei = 300, wid = 5, ang = 0, ben = PI * 0.2 },
    ): Pt[] => {
      const tr = branch({ hei, wid, ang, ben, det: hei / 20 });
      bark.push(...capture(() => barkify(xoff, yoff, tr)));
      const trlist = tr[0].concat(tr[1].reverse());
      let trmlist: Pt[] = [];
      for (let i = 0; i < trlist.length; i++) {
        const half = Math.floor(trlist.length / 2);
        if (
          ((R() < 0.025 &&
            i >= trlist.length * 0.2 &&
            i <= trlist.length * 0.8) ||
            i === half - 1 ||
            i === half + 1) &&
          dep > 0
        ) {
          const bar = 0.02 + R() * 0.08;
          const ba = bar * PI - bar * 2 * PI * (i > trlist.length / 2 ? 1 : 0);
          const brlist = fracTree(
            trlist[i][0] + xoff,
            trlist[i][1] + yoff,
            dep - 1,
            {
              hei: hei * (0.7 + R() * 0.2),
              wid: wid * 0.6,
              ang: ang + ba,
              ben: 0.55,
            },
          );
          for (const b of brlist) {
            if (R() < 0.03) {
              twigs = twigs.concat(
                capture(() =>
                  twig(
                    b[0] + trlist[i][0] + xoff,
                    b[1] + trlist[i][1] + yoff,
                    2,
                    {
                      ang: ba * (R() * 0.5 + 0.75),
                      sca: 0.3,
                      dir: ba > 0 ? 1 : -1,
                      lea: [false, 0],
                    },
                  ),
                ),
              );
            }
          }
          trmlist = trmlist.concat(
            brlist.map((v): Pt => [v[0] + trlist[i][0], v[1] + trlist[i][1]]),
          );
        } else {
          trmlist.push(trlist[i]);
        }
      }
      return trmlist;
    };
    const trmlist = fracTree(x, y, 3, { hei, wid, ang: -PI / 2, ben: 0 });
    trunk(trmlist, x, y, 0.4 + R() * 0.1);
    shapes.push(...bark, ...twigs);
  }

  // A slim leaning tree bristling with fine forked twigs.
  function tree08(x: number, y: number, { hei = 80, wid = 1 } = {}) {
    const ang = normRand(-1, 1) * PI * 0.2;
    const tr = branch({
      hei,
      wid,
      ang: -PI / 2 + ang,
      ben: PI * 0.2,
      det: hei / 20,
    });
    const trlist = tr[0].concat(tr[1].reverse());
    const fracTree = (
      xoff: number,
      yoff: number,
      dep: number,
      { ang = -PI / 2, len = 15, ben = 0 },
    ) => {
      const fun = dep === 0 ? (x: number) => cos(0.5 * PI * x) : () => 1;
      const spt: Pt = [xoff, yoff];
      const ept: Pt = [xoff + cos(ang) * len, yoff + sin(ang) * len];
      const bfun = choice([
        (x: number) => sin(x * PI),
        (x: number) => -sin(x * PI),
      ]);
      const trm = div(
        [
          [xoff, yoff],
          [xoff + len, yoff],
        ],
        10,
      ).map((p, i, all): Pt => [p[0], p[1] + bfun(i / all.length) * 2]);
      const rotated = trm.map((p): Pt => {
        const d = distance(p, spt);
        const a = atan2(p[1] - spt[1], p[0] - spt[0]);
        return [spt[0] + d * cos(a + ang), spt[1] + d * sin(a + ang)];
      });
      stroke(rotated, grey(0.5), { fun, wid: 0.8 });
      if (dep !== 0) {
        const nben = ben + choice([-1, 1]) * PI * 0.001 * dep * dep;
        if (R() < 0.5) {
          fracTree(ept[0], ept[1], dep - 1, {
            ang:
              ang +
              ben +
              PI * choice([normRand(-1, 0.5), normRand(0.5, 1)]) * 0.2,
            len: len * normRand(0.8, 0.9),
            ben: nben,
          });
          fracTree(ept[0], ept[1], dep - 1, {
            ang:
              ang +
              ben +
              PI * choice([normRand(-1, -0.5), normRand(0.5, 1)]) * 0.2,
            len: len * normRand(0.8, 0.9),
            ben: nben,
          });
        } else {
          fracTree(ept[0], ept[1], dep - 1, {
            ang: ang + ben,
            len: len * normRand(0.8, 0.9),
            ben: nben,
          });
        }
      }
    };
    const twigs = capture(() => {
      for (let i = 0; i < trlist.length; i++) {
        if (R() < 0.2) {
          fracTree(x + trlist[i][0], y + trlist[i][1], Math.floor(4 * R()), {
            ang: -PI / 2 - ang * R(),
          });
        } else if (i === Math.floor(trlist.length / 2)) {
          fracTree(x + trlist[i][0], y + trlist[i][1], 3, {
            ang: -PI / 2 + ang,
          });
        }
      }
    });
    poly(
      trlist.map(([px, py]): Pt => [px + x, py + y]),
      WHITE,
    );
    stroke(
      trlist.map(([px, py]): Pt => [px + x, py + y]),
      grey(0.6 + R() * 0.1),
      { wid: 2.5, fun: () => sin(1), noi: 0.9, out: 0 },
    );
    shapes.push(...twigs);
  }

  // ---- Mountains, rocks and water ----

  // Pale fans of strokes where a mountain's ridges meet the ground, over paper that hides the mountain's foot.
  function foot(ptlist: Pt[][], xof: number, yof: number) {
    const ftlist: Pt[][] = [];
    const span = 10;
    let ni = 0;
    for (let i = 0; i < ptlist.length - 2; i++) {
      if (i !== ni) continue;
      ni = Math.min(ni + choice([1, 2]), ptlist.length - 1);
      const a: Pt[] = [];
      const b: Pt[] = [];
      for (let j = 0; j < Math.min(ptlist[i].length / 8, 10); j++) {
        a.push([ptlist[i][j][0] + noise(j * 0.1, i) * 10, ptlist[i][j][1]]);
        const r = ptlist[i][ptlist[i].length - 1 - j];
        b.push([r[0] - noise(j * 0.1, i) * 10, r[1]]);
      }
      a.reverse();
      b.reverse();
      const last = ptlist[i].length - 1;
      for (let j = 0; j < span; j++) {
        const p = j / span;
        let y1 = ptlist[i][0][1] * (1 - p) + ptlist[ni][0][1] * p;
        let y2 = ptlist[i][last][1] * (1 - p) + ptlist[ni][last][1] * p;
        const vib = -1.7 * (p - 1) * root(p, 1 / 5);
        y1 += vib * 5 + noise(xof * 0.05, i) * 5;
        y2 += vib * 5 + noise(xof * 0.05, i) * 5;
        a.push([ptlist[i][0][0] * (1 - p) + ptlist[ni][0][0] * p, y1]);
        b.push([ptlist[i][last][0] * (1 - p) + ptlist[ni][last][0] * p, y2]);
      }
      ftlist.push(a, b);
    }
    const shift = (l: Pt[]) => l.map(([x, y]): Pt => [x + xof, y + yof]);
    for (const f of ftlist) poly(shift(f), WHITE);
    for (const f of ftlist) stroke(shift(f), grey(0.1 + R() * 0.1), { wid: 1 });
  }

  // The main peak: rows of points from its outline in to its core, its texture, and what grows and stands on
  // it. `peak` is how tall it stands at most, so the scene can keep it in frame.
  function mountain(
    xoff: number,
    yoff: number,
    seed: number,
    { hei = 300, wid = 500, tex = 200, depth = 400, peak = Infinity },
  ) {
    let h = hei;
    const w = wid;
    const reso = [10, 50];
    const ptlist: Pt[][] = [];
    let hoff = 0;
    for (let j = 0; j < reso[0]; j++) {
      hoff += (R() * depth) / 100;
      const row: Pt[] = [];
      for (let i = 0; i < reso[1]; i++) {
        const x = (i / reso[1] - 0.5) * PI;
        const y = cos(x) * noise(x + 10, j * 0.15, seed);
        const p = 1 - j / reso[0];
        row.push([(x / PI) * w * p, -y * h * p + hoff]);
      }
      ptlist.push(row);
    }
    // Shrinks a peak that would leave the frame.
    const top = -Math.min(...ptlist[0].map((p) => p[1]));
    if (top > peak) {
      const k = peak / top;
      for (const row of ptlist) for (const p of row) p[1] *= k;
      h *= k;
    }

    const vegetate = (
      treeFunc: (x: number, y: number) => void,
      growthRule: (i: number, j: number) => boolean,
      proofRule: (veglist: Pt[], i: number) => boolean = () => true,
    ) => {
      const veglist: Pt[] = [];
      for (let i = 0; i < ptlist.length; i++) {
        for (let j = 0; j < ptlist[i].length; j++) {
          if (growthRule(i, j))
            veglist.push([ptlist[i][j][0], ptlist[i][j][1]]);
        }
      }
      for (let i = 0; i < veglist.length; i++) {
        if (proofRule(veglist, i)) treeFunc(veglist[i][0], veglist[i][1]);
      }
    };
    const treeCol = (x: number, y: number, base: number) =>
      grey(noise(0.01 * x, 0.01 * y) * 0.5 * 0.3 + base);
    const shift = (l: Pt[]) => l.map(([x, y]): Pt => [x + xoff, y + yoff]);

    // Rim
    vegetate(
      (x, y) =>
        tree02(x + xoff, y + yoff - 5, { col: treeCol(x, y, 0.5), clu: 2 }),
      (i, j) => {
        const ns = noise(j * 0.1, seed);
        return (
          i === 0 && ns * ns * ns < 0.1 && Math.abs(ptlist[i][j][1]) / h > 0.2
        );
      },
    );
    // White background and outline
    poly(shift(ptlist[0].concat([[0, reso[0] * 4]])), WHITE);
    stroke(shift(ptlist[0]), grey(0.3), { noi: 1, wid: 3 });
    foot(ptlist, xoff, yoff);
    texture(ptlist, {
      xof: xoff,
      yof: yoff,
      tex,
      sha: choice([0, 0, 0, 0, 5]),
    });
    // Top
    vegetate(
      (x, y) => tree02(x + xoff, y + yoff, { col: treeCol(x, y, 0.5) }),
      (i, j) => {
        const ns = noise(i * 0.1, j * 0.1, seed + 2);
        return ns * ns * ns < 0.1 && Math.abs(ptlist[i][j][1]) / h > 0.5;
      },
    );
    // Middle
    vegetate(
      (x, y) => {
        let ht = ((h + y) / h) * 70;
        ht = ht * 0.3 + R() * ht * 0.7;
        tree01(x + xoff, y + yoff, {
          hei: ht,
          wid: R() * 3 + 1,
          col: treeCol(x, y, 0.3),
        });
      },
      (i, j) => {
        const ns = noise(i * 0.2, j * 0.05, seed);
        return (
          j % 2 === 1 &&
          ns * ns * ns * ns < 0.012 &&
          Math.abs(ptlist[i][j][1]) / h < 0.3
        );
      },
      (veglist, i) => {
        let counter = 0;
        for (let j = 0; j < veglist.length; j++) {
          const [dx, dy] = [
            veglist[i][0] - veglist[j][0],
            veglist[i][1] - veglist[j][1],
          ];
          if (i !== j && dx * dx + dy * dy < 30 * 30) counter++;
          if (counter > 2) return true;
        }
        return false;
      },
    );
    // Bottom
    vegetate(
      (x, y) => {
        let ht = ((h + y) / h) * 120;
        ht = ht * 0.5 + R() * ht * 0.5;
        const bc = R() * 0.1;
        tree03(x + xoff, y + yoff, {
          hei: ht,
          ben: (x) => x * bc,
          col: treeCol(x, y, 0.3),
        });
      },
      (i, j) => {
        const ns = noise(i * 0.2, j * 0.05, seed);
        return (
          (j === 0 || j === ptlist[i].length - 1) && ns * ns * ns * ns < 0.012
        );
      },
    );
    // Huts at the foot
    vegetate(
      (x, y) => {
        const tt = choice([0, 0, 1, 1, 1, 2]);
        if (tt === 1) {
          arch02(x + xoff, y + yoff, {
            wid: normRand(40, 70),
            sto: choice([1, 2, 2, 3]),
            rot: R(),
            sty: choice([1, 2, 3]),
          });
        } else if (tt === 2) {
          arch04(x + xoff, y + yoff, { sto: choice([1, 1, 1, 2, 2]) });
        }
      },
      (i, j) => {
        const ns = noise(i * 0.2, j * 0.05, seed + 10);
        return (
          i !== 0 &&
          (j === 1 || j === ptlist[i].length - 2) &&
          ns * ns * ns * ns < 0.008
        );
      },
    );
    // A pagoda near the top
    vegetate(
      (x, y) =>
        arch03(x + xoff, y + yoff, { sto: choice([5, 7]), wid: 40 + R() * 20 }),
      (i, j) => i === 1 && Math.abs(j - ptlist[i].length / 2) < 1 && R() < 0.02,
    );
    // Rocks at the foot
    vegetate(
      (x, y) =>
        rock(x + xoff, y + yoff, R() * 100, {
          wid: 20 + R() * 20,
          hei: 20 + R() * 20,
          sha: 2,
        }),
      (i, j) => (j === 0 || j === ptlist[i].length - 1) && R() < 0.1,
    );
  }

  // A boulder: an ellipse of rows like a mountain's, with heavier, paler texture.
  function rock(
    xoff: number,
    yoff: number,
    seed: number,
    { hei = 80, wid = 100, tex = 40, sha = 10 },
  ) {
    const reso = [10, 50];
    const ptlist: Pt[][] = [];
    for (let i = 0; i < reso[0]; i++) {
      const ns: number[] = [];
      for (let j = 0; j < reso[1]; j++) ns.push(noise(i, j * 0.2, seed));
      loopNoise(ns);
      const row: Pt[] = [];
      for (let j = 0; j < reso[1]; j++) {
        const a = (j / reso[1]) * PI * 2 - PI / 2;
        const [ca, sa] = [cos(a), sin(a)];
        let l =
          (wid * hei) /
          Math.sqrt(hei * ca * (hei * ca) + wid * sa * (wid * sa));
        l *= 0.7 + 0.3 * ns[j];
        const p = 1 - i / reso[0];
        const nx = ca * l * p;
        let ny = -sa * l * p;
        if (PI < a || a < 0) ny *= 0.2;
        ny += hei * (i / reso[0]) * 0.2;
        row.push([nx, ny]);
      }
      ptlist.push(row);
    }
    const shift = (l: Pt[]) => l.map(([x, y]): Pt => [x + xoff, y + yoff]);
    poly(shift(ptlist[0].concat([[0, 0]])), WHITE);
    stroke(shift(ptlist[0]), grey(0.3), { noi: 1, wid: 3 });
    texture(ptlist, {
      xof: xoff,
      yof: yoff,
      tex,
      wid: 3,
      sha,
      col: () => grey(0.3 + R() * 0.3, 180),
      dis: () => (R() > 0.5 ? 0.15 + 0.15 * R() : 0.85 - 0.15 * R()),
    });
  }

  // A far range as a wash: strips of noise-shaded triangles, paler the further they rise.
  function distMount(
    xoff: number,
    yoff: number,
    seed: number,
    { hei = 300, len = 2000, seg = 5 },
  ) {
    const span = 10;
    const tran = (k: number, top: boolean): Pt => [
      xoff + k * span,
      top
        ? yoff -
          hei * noise(k * 0.05, seed) * root(sin((PI * k) / (len / span)), 0.5)
        : yoff +
          24 * noise(k * 0.05, 2, seed) * root(sin((PI * k) / (len / span)), 1),
    ];
    const getCol = (x: number, y: number) =>
      grey(1, Math.floor(noise(x * 0.02, y * 0.02, yoff) * 55 + 200), FAR);
    for (let i = 0; i < len / span / seg; i++) {
      const pts: Pt[] = [];
      for (let j = 0; j < seg + 1; j++) pts.push(tran(i * seg + j, true));
      for (let j = 0; j < seg / 2 + 1; j++)
        pts.unshift(tran(i * seg + j * 2, false));
      poly(pts, getCol(...pts[pts.length - 1]));
      for (const t of triangulate(pts, 100)) {
        const m: Pt = [
          (t[0][0] + t[1][0] + t[2][0]) / 3,
          (t[0][1] + t[1][1] + t[2][1]) / 3,
        ];
        const co = getCol(...m);
        poly(t, co, co, 1);
      }
    }
  }

  // Ripples: a few long wavy strokes.
  function water(
    xoff: number,
    yoff: number,
    { hei = 2, len = 800, clu = 10 } = {},
  ) {
    const ptlist: Pt[][] = [];
    let yk = 0;
    for (let i = 0; i < clu; i++) {
      const row: Pt[] = [];
      const xk = (R() - 0.5) * (len / 8);
      yk += R() * 5;
      const lk = len / 4 + R() * (len / 4);
      for (let j = -lk; j < lk; j += 5) {
        row.push([
          j + xk + xoff,
          sin(j * 0.2) * hei * noise(j * 0.1) - 20 + yk + yoff,
        ]);
      }
      ptlist.push(row);
    }
    for (let j = 1; j < ptlist.length; j++)
      stroke(ptlist[j], grey(0.3 + R() * 0.3), { wid: 1 });
  }

  // ---- Architecture ----

  const flip = (ptlist: Pt[], axis = 0): Pt[] =>
    ptlist.map(([x, y]): Pt => [axis - (x - axis), y]);

  // A thatched roof.
  function hut(xoff: number, yoff: number, { hei = 40, wid = 180, tex = 300 }) {
    const reso = [10, 10];
    const ptlist: Pt[][] = [];
    for (let i = 0; i < reso[0]; i++) {
      const row: Pt[] = [];
      const heir = hei + hei * 0.2 * R();
      for (let j = 0; j < reso[1]; j++) {
        const nx =
          wid * (i / (reso[0] - 1) - 0.5) * root(j / (reso[1] - 1), 0.7);
        row.push([nx, heir * (j / (reso[1] - 1))]);
      }
      ptlist.push(row);
    }
    const shift = (l: Pt[]) => l.map(([x, y]): Pt => [x + xoff, y + yoff]);
    poly(
      shift(
        ptlist[0]
          .slice(0, -1)
          .concat(ptlist[ptlist.length - 1].slice(0, -1).reverse()),
      ),
      WHITE,
    );
    poly(shift(ptlist[0]), undefined, grey(0.3), 2);
    poly(shift(ptlist[ptlist.length - 1]), undefined, grey(0.3), 2);
    texture(ptlist, {
      xof: xoff,
      yof: yoff,
      tex,
      wid: 1,
      len: 0.25,
      col: () => grey(0.3 + R() * 0.3, 120),
      dis: () => wtrand((a) => a * a),
      noi: () => 5,
    });
  }

  type Corners = { pul: Pt; pur: Pt; pdl: Pt; pdr: Pt };
  // Lattice on a wall: rails, posts or a grid.
  function deco(
    style: number,
    { pul, pur, pdl, pdr, hsp, vsp }: Corners & { hsp: Pt; vsp: Pt },
  ) {
    const plist: Pt[][] = [];
    const dl = div([pul, pdl], vsp[1]);
    const dr = div([pur, pdr], vsp[1]);
    const du = div([pul, pur], hsp[1]);
    const dd = div([pdl, pdr], hsp[1]);
    if (style === 1 || style === 3) {
      const mlu = du[hsp[0]];
      const mru = du[du.length - 1 - hsp[0]];
      const mld = dd[hsp[0]];
      const mrd = dd[du.length - 1 - hsp[0]];
      for (let i = vsp[0]; i < dl.length - vsp[0]; i += vsp[0]) {
        const mml = div([mlu, mld], vsp[1])[i];
        const mmr = div([mru, mrd], vsp[1])[i];
        if (style === 1) {
          plist.push(div([mml, dl[i]], 5));
          plist.push(div([mmr, dr[i]], 5));
        } else {
          const mmu = div([mlu, mru], vsp[1])[i];
          const mmd = div([mld, mrd], vsp[1])[i];
          plist.push(div([mml, mmr], 5));
          plist.push(div([mmu, mmd], 5));
        }
      }
      plist.push(div([mlu, mld], 5));
      plist.push(div([mru, mrd], 5));
    } else if (style === 2) {
      for (let i = hsp[0]; i < du.length - hsp[0]; i += hsp[0])
        plist.push(div([du[i], dd[i]], 5));
    }
    return plist;
  }

  // A storey's walls in two-point view, `rot` of the way round, with lattice from `dec`.
  function box(
    xoff: number,
    yoff: number,
    {
      hei = 20,
      wid = 120,
      rot = 0.7,
      per = 4,
      tra = true,
      bot = true,
      wei = 3,
      dec = (): Pt[][] => [],
    }: {
      hei?: number;
      wid?: number;
      rot?: number;
      per?: number;
      tra?: boolean;
      bot?: boolean;
      wei?: number;
      dec?: (corners: Corners) => Pt[][];
    },
  ) {
    const mid = -wid * 0.5 + wid * rot;
    const bmid = -wid * 0.5 + wid * (1 - rot);
    let ptlist: Pt[][] = [];
    ptlist.push(
      div(
        [
          [-wid * 0.5, -hei],
          [-wid * 0.5, 0],
        ],
        5,
      ),
    );
    ptlist.push(
      div(
        [
          [wid * 0.5, -hei],
          [wid * 0.5, 0],
        ],
        5,
      ),
    );
    if (bot) {
      ptlist.push(
        div(
          [
            [-wid * 0.5, 0],
            [mid, per],
          ],
          5,
        ),
      );
      ptlist.push(
        div(
          [
            [wid * 0.5, 0],
            [mid, per],
          ],
          5,
        ),
      );
    }
    ptlist.push(
      div(
        [
          [mid, -hei],
          [mid, per],
        ],
        5,
      ),
    );
    if (tra) {
      if (bot) {
        ptlist.push(
          div(
            [
              [-wid * 0.5, 0],
              [bmid, -per],
            ],
            5,
          ),
        );
        ptlist.push(
          div(
            [
              [wid * 0.5, 0],
              [bmid, -per],
            ],
            5,
          ),
        );
      }
      ptlist.push(
        div(
          [
            [bmid, -hei],
            [bmid, -per],
          ],
          5,
        ),
      );
    }
    const surf = (rot < 0.5 ? 1 : 0) * 2 - 1;
    ptlist = ptlist.concat(
      dec({
        pul: [surf * wid * 0.5, -hei],
        pur: [mid, -hei + per],
        pdl: [surf * wid * 0.5, 0],
        pdr: [mid, per],
      }),
    );
    const shift = (l: Pt[]) => l.map(([x, y]): Pt => [x + xoff, y + yoff]);
    if (!tra) {
      poly(
        shift([
          [-wid * 0.5, -hei],
          [wid * 0.5, -hei],
          [wid * 0.5, 0],
          [mid, per],
          [-wid * 0.5, 0],
        ]),
        WHITE,
      );
    }
    for (const l of ptlist)
      stroke(shift(l), grey(0.4), { noi: 1, wid: wei, fun: () => 1 });
  }

  // A railing: top and bottom rails with wavering posts between.
  function rail(
    xoff: number,
    yoff: number,
    seed: number,
    {
      hei = 20,
      wid = 180,
      rot = 0.7,
      per = 4,
      seg = 4,
      wei = 1,
      tra = true,
      fro = true,
    },
  ) {
    const mid = -wid * 0.5 + wid * rot;
    const bmid = -wid * 0.5 + wid * (1 - rot);
    const ptlist: Pt[][] = [];
    if (fro) {
      ptlist.push(
        div(
          [
            [-wid * 0.5, 0],
            [mid, per],
          ],
          seg,
        ),
      );
      ptlist.push(
        div(
          [
            [mid, per],
            [wid * 0.5, 0],
          ],
          seg,
        ),
      );
    }
    if (tra) {
      ptlist.push(
        div(
          [
            [-wid * 0.5, 0],
            [bmid, -per],
          ],
          seg,
        ),
      );
      ptlist.push(
        div(
          [
            [bmid, -per],
            [wid * 0.5, 0],
          ],
          seg,
        ),
      );
    }
    if (fro) {
      ptlist.push(
        div(
          [
            [-wid * 0.5, -hei],
            [mid, -hei + per],
          ],
          seg,
        ),
      );
      ptlist.push(
        div(
          [
            [mid, -hei + per],
            [wid * 0.5, -hei],
          ],
          seg,
        ),
      );
    }
    if (tra) {
      ptlist.push(
        div(
          [
            [-wid * 0.5, -hei],
            [bmid, -hei - per],
          ],
          seg,
        ),
      );
      ptlist.push(
        div(
          [
            [bmid, -hei - per],
            [wid * 0.5, -hei],
          ],
          seg,
        ),
      );
    }
    if (tra) {
      const open = Math.floor(R() * ptlist.length);
      ptlist[open] = ptlist[open].slice(0, -1);
      ptlist[open] = ptlist[open].slice(0, -1);
    }
    const shift = (l: Pt[]) => l.map(([x, y]): Pt => [x + xoff, y + yoff]);
    const n = ptlist.length;
    for (let i = 0; i < n / 2; i++) {
      for (let j = 0; j < ptlist[i].length; j++) {
        const other = ptlist[(n / 2 + i) % n];
        ptlist[i][j][1] += (noise(i, j * 0.5, seed) - 0.5) * hei;
        other[j % other.length][1] +=
          (noise(i + 0.5, j * 0.5, seed) - 0.5) * hei;
        const ln = div([ptlist[i][j], other[j % other.length]], 2);
        ln[0][0] += (R() - 0.5) * hei * 0.5;
        poly(shift(ln), undefined, grey(0.5), 2);
      }
    }
    for (const l of ptlist)
      stroke(shift(l), grey(0.5), { noi: 0.5, wid: wei, fun: () => 1 });
  }

  // A hip roof with upturned corners.
  function roof(
    xoff: number,
    yoff: number,
    { hei = 20, wid = 120, rot = 0.7, per = 4, cor = 5, wei = 3 },
  ) {
    const opf = (l: Pt[]) => (rot < 0.5 ? flip(l) : l);
    const rrot = rot < 0.5 ? 1 - rot : rot;
    const mid = -wid * 0.5 + wid * rrot;
    const quat = (mid + wid * 0.5) * 0.5 - mid;
    const ptlist: Pt[][] = [
      div(
        opf([
          [-wid * 0.5 + quat, -hei - per / 2],
          [-wid * 0.5 + quat * 0.5, -hei / 2 - per / 4],
          [-wid * 0.5 - cor, 0],
        ]),
        5,
      ),
      div(
        opf([
          [mid + quat, -hei],
          [(mid + quat + wid * 0.5) / 2, -hei / 2],
          [wid * 0.5 + cor, 0],
        ]),
        5,
      ),
      div(
        opf([
          [mid + quat, -hei],
          [mid + quat / 2, -hei / 2 + per / 2],
          [mid + cor, per],
        ]),
        5,
      ),
      div(
        opf([
          [-wid * 0.5 - cor, 0],
          [mid + cor, per],
        ]),
        5,
      ),
      div(
        opf([
          [wid * 0.5 + cor, 0],
          [mid + cor, per],
        ]),
        5,
      ),
      div(
        opf([
          [-wid * 0.5 + quat, -hei - per / 2],
          [mid + quat, -hei],
        ]),
        5,
      ),
    ];
    const shift = (l: Pt[]) => l.map(([x, y]): Pt => [x + xoff, y + yoff]);
    poly(
      shift(
        opf([
          [-wid * 0.5, 0],
          [-wid * 0.5 + quat, -hei - per / 2],
          [mid + quat, -hei],
          [wid * 0.5, 0],
          [mid, per],
        ]),
      ),
      WHITE,
    );
    for (const l of ptlist)
      stroke(shift(l), grey(0.4), { noi: 1, wid: wei, fun: () => 1 });
  }

  // A pagoda's pyramid roof.
  function pagroof(
    xoff: number,
    yoff: number,
    { hei = 20, wid = 120, per = 4, cor = 10, sid = 4, wei = 3 },
  ) {
    const ptlist: Pt[][] = [];
    const polist: Pt[] = [[0, -hei]];
    for (let i = 0; i < sid; i++) {
      const fx = wid * (i / (sid - 1) - 0.5);
      const fy = per * (1 - Math.abs(i / (sid - 1) - 0.5) * 2);
      const fxx = (wid + cor) * (i / (sid - 1) - 0.5);
      if (i > 0) ptlist.push([ptlist[ptlist.length - 1][2], [fxx, fy]]);
      ptlist.push([
        [0, -hei],
        [fx * 0.5, (-hei + fy) * 0.5],
        [fxx, fy],
      ]);
      polist.push([fxx, fy]);
    }
    const shift = (l: Pt[]) => l.map(([x, y]): Pt => [x + xoff, y + yoff]);
    poly(shift(polist), WHITE);
    for (const l of ptlist)
      stroke(shift(div(l, 5)), grey(0.4), { noi: 1, wid: wei, fun: () => 1 });
  }

  // A house: thatched roof over open walls, rails around, and a figure or two.
  function arch01(
    xoff: number,
    yoff: number,
    seed: number,
    { hei = 70, wid = 180, per = 5 },
  ) {
    const p = 0.4 + R() * 0.2;
    const [h0, h1] = [hei * p, hei * (1 - p)];
    hut(xoff, yoff - hei, { hei: h0, wid });
    box(xoff, yoff, { hei: h1, wid: (wid * 2) / 3, per, bot: false });
    rail(xoff, yoff, seed, {
      tra: true,
      fro: false,
      hei: 10,
      wid,
      per: per * 2,
      seg: Math.floor(3 + R() * 3),
    });
    const mcnt = choice([0, 1, 1, 2]);
    if (mcnt === 1) {
      man(xoff + normRand(-wid / 3, wid / 3), yoff, {
        fli: choice([true, false]),
        sca: 0.42,
      });
    } else if (mcnt === 2) {
      man(xoff + normRand(-wid / 4, -wid / 5), yoff, { fli: false, sca: 0.42 });
      man(xoff + normRand(wid / 5, wid / 4), yoff, { fli: true, sca: 0.42 });
    }
    rail(xoff, yoff, seed, {
      tra: false,
      fro: true,
      hei: 10,
      wid,
      per: per * 2,
      seg: Math.floor(3 + R() * 3),
    });
  }

  // A pavilion of `sto` storeys, each a lattice-walled box under a hip roof.
  function arch02(
    xoff: number,
    yoff: number,
    { hei = 10, wid = 50, rot = 0.3, per = 5, sto = 3, sty = 1 },
  ) {
    let hoff = 0;
    for (let i = 0; i < sto; i++) {
      box(xoff, yoff - hoff, {
        tra: false,
        hei,
        wid: wid * pow(0.85, i),
        rot,
        wei: 1.5,
        per,
        dec: (a) =>
          deco(sty, {
            ...a,
            hsp: (
              [
                [1, 5],
                [1, 5],
                [1, 4],
              ] as Pt[]
            )[sty - 1],
            vsp: (
              [
                [1, 2],
                [1, 2],
                [1, 3],
              ] as Pt[]
            )[sty - 1],
          }),
      });
      roof(xoff, yoff - hoff - hei, {
        hei,
        wid: wid * pow(0.9, i),
        rot,
        wei: 1.5,
        per,
      });
      hoff += hei * 1.5;
    }
  }

  // A pagoda: storeys with rails under pyramid roofs.
  function arch03(
    xoff: number,
    yoff: number,
    { hei = 10, wid = 50, rot = 0.7, per = 5, sto = 7 },
  ) {
    let hoff = 0;
    for (let i = 0; i < sto; i++) {
      box(xoff, yoff - hoff, {
        tra: false,
        hei,
        wid: wid * pow(0.85, i),
        rot,
        wei: 1.5,
        per: per / 2,
        dec: (a) => deco(1, { ...a, hsp: [1, 4], vsp: [1, 2] }),
      });
      rail(xoff, yoff - hoff, i * 0.2, {
        seg: 5,
        wid: wid * pow(0.85, i) * 1.1,
        hei: hei / 2,
        per: per / 2,
        rot,
        wei: 0.5,
        tra: false,
      });
      pagroof(xoff, yoff - hoff - hei, {
        hei: hei * 1.5,
        wid: wid * pow(0.9, i),
        wei: 1.5,
        per,
      });
      hoff += hei * 1.5;
    }
  }

  // An open pavilion: posts and rails under a pyramid roof.
  function arch04(
    xoff: number,
    yoff: number,
    { hei = 15, wid = 30, rot = 0.7, per = 5, sto = 2 },
  ) {
    let hoff = 0;
    for (let i = 0; i < sto; i++) {
      box(xoff, yoff - hoff, {
        tra: true,
        hei,
        wid: wid * pow(0.85, i),
        rot,
        wei: 1.5,
        per: per / 2,
      });
      rail(xoff, yoff - hoff, i * 0.2, {
        seg: 3,
        wid: wid * pow(0.85, i) * 1.2,
        hei: hei / 3,
        per: per / 2,
        rot,
        wei: 0.5,
        tra: true,
      });
      pagroof(xoff, yoff - hoff - hei, {
        hei,
        wid: wid * pow(0.9, i),
        wei: 1.5,
        per,
      });
      hoff += hei * 1.2;
    }
  }

  // A skiff with a boatman poling it.
  function boat01(
    xoff: number,
    yoff: number,
    { len = 120, sca = 1, fli = false },
  ) {
    const dir = fli ? -1 : 1;
    man(xoff + 20 * sca * dir, yoff, {
      ite: stick01,
      hat: hat02,
      sca: 0.5 * sca,
      fli: !fli,
      len: [0, 30, 20, 30, 10, 30, 30, 30, 30],
    });
    const plist1: Pt[] = [];
    const plist2: Pt[] = [];
    for (let i = 0; i < len * sca; i += 5 * sca) {
      plist1.push([i * dir, root(sin((i / len) * PI), 0.5) * 7 * sca]);
      plist2.push([i * dir, root(sin((i / len) * PI), 0.5) * 10 * sca]);
    }
    const plist = plist1
      .concat(plist2.reverse())
      .map(([x, y]): Pt => [x + xoff, y + yoff]);
    poly(plist, WHITE);
    stroke(plist, grey(0.4), { wid: 1, fun: (x) => sin(x * PI * 2) });
  }

  // ---- Figures ----

  // A limb's two edges, `wfun` either side of the line through ptlist.
  function expand(ptlist: Pt[], wfun: (x: number) => number): [Pt[], Pt[]] {
    const v0: Pt[] = [];
    const v1: Pt[] = [];
    for (let i = 1; i < ptlist.length - 1; i++) {
      const w = wfun(i / ptlist.length);
      const a1 = atan2(
        ptlist[i][1] - ptlist[i - 1][1],
        ptlist[i][0] - ptlist[i - 1][0],
      );
      const a2 = atan2(
        ptlist[i][1] - ptlist[i + 1][1],
        ptlist[i][0] - ptlist[i + 1][0],
      );
      let a = (a1 + a2) / 2;
      if (a < a2) a += PI;
      v0.push([ptlist[i][0] + w * cos(a), ptlist[i][1] + w * sin(a)]);
      v1.push([ptlist[i][0] - w * cos(a), ptlist[i][1] - w * sin(a)]);
    }
    const l = ptlist.length - 1;
    const a0 =
      atan2(ptlist[1][1] - ptlist[0][1], ptlist[1][0] - ptlist[0][0]) - PI / 2;
    const a1 =
      atan2(ptlist[l][1] - ptlist[l - 1][1], ptlist[l][0] - ptlist[l - 1][0]) -
      PI / 2;
    const [w0, w1] = [wfun(0), wfun(1)];
    v0.unshift([ptlist[0][0] + w0 * cos(a0), ptlist[0][1] + w0 * sin(a0)]);
    v1.unshift([ptlist[0][0] - w0 * cos(a0), ptlist[0][1] - w0 * sin(a0)]);
    v0.push([ptlist[l][0] + w1 * cos(a1), ptlist[l][1] + w1 * sin(a1)]);
    v1.push([ptlist[l][0] - w1 * cos(a1), ptlist[l][1] - w1 * sin(a1)]);
    return [v0, v1];
  }

  // Maps a shape drawn on the unit segment up the y axis onto the segment from p0 to p1.
  function tranpoly(p0: Pt, p1: Pt, ptlist: Pt[]): Pt[] {
    const ang = atan2(p1[1] - p0[1], p1[0] - p0[0]) - PI / 2;
    const scl = distance(p0, p1);
    return ptlist.map(([vx, vy]): Pt => {
      const v: Pt = [-vx, vy];
      const d = distance(v, [0, 0]);
      const a = atan2(v[1], v[0]);
      return [p0[0] + d * scl * cos(ang + a), p0[1] + d * scl * sin(ang + a)];
    });
  }
  const flipper = (l: Pt[]) => l.map(([x, y]): Pt => [-x, y]);
  type Item = (p0: Pt, p1: Pt, fli: boolean) => void;

  // A cap with a trailing ribbon.
  const hat01: Item = (p0, p1, fli) => {
    const seed = R();
    const f = fli ? flipper : (x: Pt[]) => x;
    poly(
      tranpoly(
        p0,
        p1,
        f([
          [-0.3, 0.5],
          [0.3, 0.8],
          [0.2, 1],
          [0, 1.1],
          [-0.3, 1.15],
          [-0.55, 1],
          [-0.65, 0.5],
        ]),
      ),
      grey(0.8),
    );
    const q: Pt[] = [];
    for (let i = 0; i < 10; i++)
      q.push([-0.3 - noise(i * 0.2, seed) * i * 0.1, 0.5 - i * 0.3]);
    poly(tranpoly(p0, p1, f(q)), undefined, grey(0.8), 1);
  };
  // A wide straw hat.
  const hat02: Item = (p0, p1, fli) => {
    const f = fli ? flipper : (x: Pt[]) => x;
    poly(
      tranpoly(
        p0,
        p1,
        f([
          [-0.3, 0.5],
          [-1.1, 0.5],
          [-1.2, 0.6],
          [-1.1, 0.7],
          [-0.3, 0.8],
          [0.3, 0.8],
          [1.0, 0.7],
          [1.3, 0.6],
          [1.2, 0.5],
          [0.3, 0.5],
        ]),
      ),
      grey(0.8),
    );
  };
  // A punting pole.
  const stick01: Item = (p0, p1, fli) => {
    const seed = R();
    const f = fli ? flipper : (x: Pt[]) => x;
    const q: Pt[] = [];
    const l = 12;
    for (let i = 0; i < l; i++)
      q.push([-noise(i * 0.1, seed) * 0.1 * sin((i / l) * PI) * 5, i * 0.3]);
    poly(tranpoly(p0, p1, f(q)), undefined, grey(0.5), 1);
  };

  // A robed figure from a jointed skeleton:
  //      2
  //    1/
  // 7/  | \_ 6
  // 8| 0 \ 5
  //      /3
  //     4
  function man(
    xoff: number,
    yoff: number,
    {
      sca = 0.5,
      hat = hat01,
      ite = (() => {}) as Item,
      fli = true,
      len = [0, 30, 20, 30, 30, 30, 30, 30, 30],
    }: { sca?: number; hat?: Item; ite?: Item; fli?: boolean; len?: number[] },
  ) {
    const ang = [
      0,
      -PI / 2,
      normRand(0, 0),
      (PI / 4) * R(),
      ((PI * 3) / 4) * R(),
      (PI * 3) / 4,
      -PI / 4,
      (-PI * 3) / 4 - (PI / 4) * R(),
      -PI / 4,
    ];
    const lens = len.map((v) => v * sca);
    // Each joint's chain of joints from the root.
    const PATHS = [
      [0],
      [0, 1],
      [0, 1, 2],
      [0, 3],
      [0, 3, 4],
      [0, 1, 5],
      [0, 1, 5, 6],
      [0, 1, 7],
      [0, 1, 7, 8],
    ];
    const grot = (ind: number) => PATHS[ind].reduce((r, k) => r + ang[k], 0);
    const pts = PATHS.map((path): Pt => {
      const pos: Pt = [0, 0];
      for (const k of path) {
        const a = grot(k);
        pos[0] += lens[k] * cos(a);
        pos[1] += lens[k] * sin(a);
      }
      return pos;
    });
    yoff -= pts[4][1];
    const toGlobal = (v: Pt): Pt => [(fli ? -1 : 1) * v[0] + xoff, v[1] + yoff];
    const cloth = (plist: Pt[], fun: (x: number) => number) => {
      const [t1, t2] = expand(bezmh(plist, 2), fun);
      poly(t1.concat(t2.slice().reverse()).map(toGlobal), WHITE);
      stroke(t1.map(toGlobal), grey(0.5), { wid: 1 });
      stroke(t2.map(toGlobal), grey(0.6), { wid: 1 });
    };
    const fsleeve = (x: number) =>
      sca * 8 * (sin(0.5 * x * PI) * root(sin(x * PI), 0.1) + (1 - x) * 0.4);
    const fbody = (x: number) =>
      sca * 11 * (sin(0.5 * x * PI) * root(sin(x * PI), 0.1) + (1 - x) * 0.5);
    const fhead = (x: number) =>
      sca * 7 * root(0.25 - (x - 0.5) * (x - 0.5), 0.3);
    ite(toGlobal(pts[8]), toGlobal(pts[6]), fli);
    cloth([pts[1], pts[7], pts[8]], fsleeve);
    cloth([pts[1], pts[0], pts[3], pts[4]], fbody);
    cloth([pts[1], pts[5], pts[6]], fsleeve);
    cloth([pts[1], pts[2]], fhead);
    const [h1, h2] = expand(bezmh([pts[1], pts[2]], 2), fhead);
    h1.splice(0, Math.floor(h1.length * 0.1));
    h2.splice(0, Math.floor(h2.length * 0.95));
    poly(h1.concat(h2.reverse()).map(toGlobal), grey(0.6));
    hat(toGlobal(pts[1]), toGlobal(pts[2]), fli);
  }

  return {
    shapes: () => shapes,
    // Draws what `f` draws `k` times larger about (ax, ay), strokes included, as if nearer.
    near: (ax: number, ay: number, k: number, f: () => void) => {
      for (const s of capture(f)) {
        s.pts = s.pts.map(
          ([x, y]): Pt => [ax + (x - ax) * k, ay + (y - ay) * k],
        );
        if (s.line) s.line *= k;
        shapes.push(s);
      }
    },
    R,
    choice,
    mountain,
    distMount,
    water,
    rock,
    tree03,
    tree04,
    tree05,
    tree06,
    tree08,
    arch01,
    arch02,
    arch03,
    boat01,
  };
}

// ---- Rasterizer ----

// Fills shapes into an RGB buffer by each pixel's exact covered area, using only + - * / and floor, so every
// browser and Node agree (ADR 0001). Edges accumulate signed area per cell and a running sum across each row
// gives the coverage, as in font rasterizers. Overlaps within one shape count once, like SVG's nonzero fill.
// Shapes come in scene units, which map to pixels as ((x + ox) * scale, (y + oy) * scale).
function rasterizer(
  width: number,
  height: number,
  paper: Rgb,
  ox: number,
  oy: number,
  scale: number,
) {
  const img = new Float64Array(width * height * 3);
  for (let i = 0; i < width * height * 3; i += 3) {
    img[i] = paper[0];
    img[i + 1] = paper[1];
    img[i + 2] = paper[2];
  }
  const stride = width + 2;
  const acc = new Float64Array(stride * height);
  // The first and last cell each row's edges touched, so a fill sweeps only those: past them the running sum
  // is 0, or a rounding residue too small to paint.
  const lo = new Int32Array(height).fill(stride);
  const hi = new Int32Array(height).fill(-1);

  // One straight edge from (x0, y0) to (x1, y1), in pixels.
  function edge(x0: number, y0: number, x1: number, y1: number) {
    if (y0 === y1) return;
    // Parts beyond the left or right side become vertical edges along it, so they still cover what's right
    // of them, or nothing.
    for (let side = 0; side <= width; side += width) {
      if (x0 < side !== x1 < side && x0 !== side && x1 !== side) {
        const ym = y0 + ((y1 - y0) * (side - x0)) / (x1 - x0);
        edge(x0, y0, side, ym);
        edge(side, ym, x1, y1);
        return;
      }
    }
    x0 = x0 < 0 ? 0 : x0 > width ? width : x0;
    x1 = x1 < 0 ? 0 : x1 > width ? width : x1;
    let dir = 1;
    if (y0 > y1) {
      let t = x0;
      x0 = x1;
      x1 = t;
      t = y0;
      y0 = y1;
      y1 = t;
      dir = -1;
    }
    const dxdy = (x1 - x0) / (y1 - y0);
    let x = y0 < 0 ? x0 - y0 * dxdy : x0;
    const end = Math.min(height, Math.ceil(y1));
    for (let y = Math.max(0, Math.floor(y0)); y < end; y++) {
      const row = y * stride;
      const dy = Math.min(y + 1, y1) - Math.max(y, y0);
      const xnext = x + dxdy * dy;
      const d = dy * dir;
      const xa = x < xnext ? x : xnext;
      const xb = x < xnext ? xnext : x;
      const xaFloor = Math.floor(xa);
      const xai = xaFloor;
      const xbi = Math.ceil(xb);
      if (xai < lo[y]) lo[y] = xai;
      if (xbi + 1 > hi[y]) hi[y] = xbi + 1;
      if (xbi <= xai + 1) {
        const xmf = 0.5 * (x + xnext) - xaFloor;
        acc[row + xai] += d - d * xmf;
        acc[row + xai + 1] += d * xmf;
      } else {
        const s = 1 / (xb - xa);
        const xaf = xa - xaFloor;
        const a0 = 0.5 * s * (1 - xaf) * (1 - xaf);
        const xbf = xb - xbi + 1;
        const am = 0.5 * s * xbf * xbf;
        acc[row + xai] += d * a0;
        if (xbi === xai + 2) {
          acc[row + xai + 1] += d * (1 - a0 - am);
        } else {
          const a1 = s * (1.5 - xaf);
          acc[row + xai + 1] += d * (a1 - a0);
          for (let xi = xai + 2; xi < xbi - 1; xi++) acc[row + xi] += d * s;
          const a2 = a1 + (xbi - xai - 3) * s;
          acc[row + xbi - 1] += d * (1 - a2 - am);
        }
        acc[row + xbi] += d * am;
      }
      x = xnext;
    }
  }

  // Fills closed polygons as one shape in `color` at `alpha`.
  function fill(polys: Pt[][], color: Rgb, alpha: number) {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of polys) {
      for (const pt of p) {
        const x = (pt[0] + ox) * scale;
        const y = (pt[1] + oy) * scale;
        if (!(x === x && y === y)) return;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0 || y1 < 0 || x0 > width || y0 > height) return;
    for (const p of polys) {
      for (let i = 0; i < p.length; i++) {
        const b = p[i + 1 < p.length ? i + 1 : 0];
        edge(
          (p[i][0] + ox) * scale,
          (p[i][1] + oy) * scale,
          (b[0] + ox) * scale,
          (b[1] + oy) * scale,
        );
      }
    }
    const r1 = Math.min(height, Math.ceil(y1));
    for (let y = Math.max(0, Math.floor(y0)); y < r1; y++) {
      const c0 = lo[y];
      const c1 = hi[y] < width + 1 ? hi[y] : width + 1;
      lo[y] = stride;
      hi[y] = -1;
      let sum = 0;
      for (let x = c0; x <= c1; x++) {
        const i = y * stride + x;
        sum += acc[i];
        acc[i] = 0;
        if (x >= width) continue;
        const cover = sum < 0 ? -sum : sum;
        if (cover < 1e-9) continue;
        const t = (cover > 1 ? 1 : cover) * alpha;
        const j = (y * width + x) * 3;
        img[j] += (color[0] - img[j]) * t;
        img[j + 1] += (color[1] - img[j + 1]) * t;
        img[j + 2] += (color[2] - img[j + 2]) * t;
      }
    }
  }

  // An open polyline `w` wide, as one quad per segment.
  function line(pts: Pt[], w: number, color: Rgb, alpha: number) {
    const quads: Pt[][] = [];
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) continue;
      const [nx, ny] = [(-dy / len) * (w / 2), (dx / len) * (w / 2)];
      quads.push([
        [a[0] + nx, a[1] + ny],
        [b[0] + nx, b[1] + ny],
        [b[0] - nx, b[1] - ny],
        [a[0] - nx, a[1] - ny],
      ]);
    }
    if (quads.length > 0) fill(quads, color, alpha);
  }

  return { img, fill, line };
}

// ---- The scene ----

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const g = shanShui(stream(seed, 0), stream(seed, 1));
  const { R, choice } = g;
  const range = (a: number, b: number) => a + (b - a) * R();

  // The frame in scene units: x from -W/2 to W/2, y from 0 at the top down to H.
  const scale = Math.min(width, height) / SPAN;
  const [W, H] = [width / scale, height / scale];
  const base = H * range(0.58, 0.66);
  const side = choice([-1, 1]);
  const short = Math.min(W, H);

  // A pale far range, behind everything.
  if (R() < 0.75) {
    const len = range(0.7, 1.4) * W;
    g.distMount(
      range(-W / 2 - len / 2, W / 2 - len / 2),
      base - range(10, 50),
      R() * 100,
      {
        hei: range(50, 110),
        len,
        seg: 5,
      },
    );
  }
  // The peak, standing off to one side of the subject, with water at its foot.
  const cx = -side * range(0.04, 0.16) * W;
  g.water(cx, base + 20, { len: W * range(1.2, 1.8), hei: 2, clu: 10 });
  g.mountain(cx, base, R() * 100, {
    hei: range(1.3, 2.1) * base,
    wid: range(0.6, 0.85) * short,
    tex: 200,
    depth: 400,
    peak: base - 25,
  });

  // The subject in front, drawn larger since it's nearer.
  const subject = choice(["grove", "pavilion", "boat"] as const);
  const ground = H - range(0.06, 0.12) * short;
  const sx = side * range(0.1, 0.22) * W;
  const k = range(1.3, 1.6);
  if (subject === "boat") {
    const sca = range(0.8, 1.1);
    const fli = choice([true, false]);
    const by = base + (ground - base) * range(0.45, 0.75);
    g.near(sx, by, k, () => {
      g.water(sx, by + 25, { len: range(160, 260), hei: 2, clu: 6 });
      g.boat01(sx + ((fli ? 1 : -1) * 120 * sca) / 2, by, { sca, fli });
    });
  } else {
    g.near(sx, ground, k, () => {
      const rocks = Math.floor(range(1, 4));
      for (let i = 0; i < rocks; i++) {
        g.rock(sx + range(-50, 50), ground + range(-5, 5), R() * 100, {
          wid: range(30, 60),
          hei: range(20, 40),
          sha: 5,
        });
      }
      if (subject === "pavilion") {
        const kind = choice([1, 2, 2, 3]);
        if (kind === 1) {
          g.arch01(sx, ground - 15, R(), {
            wid: range(100, 130),
            hei: range(50, 70),
            per: R(),
          });
        } else if (kind === 2) {
          g.arch02(sx, ground - 15, {
            wid: range(50, 70),
            sto: choice([1, 2, 2]),
            rot: R(),
            sty: choice([1, 2, 3]),
          });
        } else {
          g.arch03(sx, ground - 15, {
            sto: choice([3, 5]),
            wid: range(35, 45),
          });
        }
        for (let i = 0; i < Math.floor(range(1, 4)); i++) {
          g.tree03(sx - side * range(40, 80), ground, { hei: range(50, 90) });
        }
      } else {
        const tt = choice([1, 2, 3, 4]);
        if (tt === 1) {
          for (let x = -30; x < 30; x += 30)
            g.tree05(sx + x + 20 * range(-1, 1), ground, {
              hei: range(100, 160),
            });
        } else if (tt === 2) {
          g.tree04(sx, ground, { hei: range(120, 170) });
        } else if (tt === 3) {
          for (let i = 0; i < choice([1, 2, 2, 3]); i++)
            g.tree06(sx + range(-40, 40), ground, { hei: range(50, 90) });
        } else {
          for (let i = 0; i < 2 + R() * 3; i++)
            g.tree08(sx + range(-30, 30), ground, { hei: range(50, 80) });
        }
      }
    });
  }

  // Paints back to front. A grey is a tint of its ink toward the paper. Everything prints in the darkest ink
  // but the far range, which takes the coolest, like distant hills going blue.
  const paperRgb = rgb(paper);
  const inkRgb = inks.map(rgb);
  const cool = inkRgb.reduce((a, b) => (b[0] - b[2] < a[0] - a[2] ? b : a));
  const r = rasterizer(width, height, paperRgb, W / 2, 0, scale);
  for (const s of g.shapes()) {
    const ink = s.col.ink === FAR ? cool : inkRgb[0];
    const t = Math.max(0, 1 - (1 - s.col.g / 255) * DARKEN);
    const color: Rgb = [
      ink[0] + (paperRgb[0] - ink[0]) * t,
      ink[1] + (paperRgb[1] - ink[1]) * t,
      ink[2] + (paperRgb[2] - ink[2]) * t,
    ];
    if (s.line) r.line(s.pts, s.line, color, s.col.a);
    else r.fill([s.pts], color, s.col.a);
  }
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    image.data[i * 4] = Math.round(r.img[i * 3]);
    image.data[i * 4 + 1] = Math.round(r.img[i * 3 + 1]);
    image.data[i * 4 + 2] = Math.round(r.img[i * 3 + 2]);
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

export const inkLandscape1: Style = { id: "shan1", draw };
