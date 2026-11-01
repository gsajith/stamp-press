import type { Palette } from "../palettes";
import { pick, stream } from "../random";
import type { Style } from "../sources";

// Botanical L-system: one plant grown by rewriting a seeded stochastic L-system, drawn by a turtle, and fitted
// to the middle of a plain field, like a flora series stamp. Branch tips carry leaves, and some carry flowers.
// Like the landscape style it computes every pixel's coverage from distances in its own code rather than
// drawing canvas paths, so its pixels are identical in every browser and in Node, which the golden test relies
// on (ADR 0001). Only IEEE-exact arithmetic here: no Math.sin, Math.cos or the like, hence cosSin below.

type Rgb = [number, number, number];
type Pt = [number, number];

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
const DEG = Math.PI / 180;

// Cosine and sine of `a` radians from their Taylor series, which uses only exact arithmetic. The angle is
// wrapped into [-pi, pi] first, where the series is accurate to well under a pixel.
function cosSin(a: number): Pt {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  let [c, s, term] = [0, 0, 1];
  for (let n = 0; n < 24; n++) {
    if (n % 4 === 0) c += term;
    else if (n % 4 === 1) s += term;
    else if (n % 4 === 2) c -= term;
    else s -= term;
    term = (term * a) / (n + 1);
  }
  return [c, s];
}

const turn = ([x, y]: Pt, a: number): Pt => {
  const [c, s] = cosSin(a);
  return [x * c - y * s, x * s + y * c];
};

// A plant's grammar. F draws a step, + and - turn left and right, [ and ] start and end a branch, and other
// letters only drive the rewriting. Each rule lists alternatives, one picked at random per rewrite.
type Plant = {
  axiom: string;
  rules: Record<string, readonly string[]>;
  generations: number;
  angle: number;
};

// After Prusinkiewicz and Lindenmayer, "The Algorithmic Beauty of Plants", figures 1.24 and 1.27, with mirrored
// alternatives so no two plants grow alike. Generations stay low so branches still read at desk size.
const PLANTS: readonly Plant[] = [
  {
    axiom: "X",
    rules: { X: ["F[+X]F[-X]+X", "F[-X]F[+X]-X"], F: ["FF"] },
    generations: 5,
    angle: 20,
  },
  {
    axiom: "X",
    rules: { X: ["F-[[X]+X]+F[+FX]-X", "F+[[X]-X]-F[-FX]+X"], F: ["FF"] },
    generations: 4,
    angle: 22.5,
  },
  {
    axiom: "F",
    rules: { F: ["F[+F]F[-F]F", "F[+F]F", "F[-F]F"] },
    generations: 4,
    angle: 25.7,
  },
  {
    axiom: "A",
    rules: { A: ["F[+X]F[-X]A", "F[-X]F[+X]A"], X: ["F[+X]F[-X]", "FX"] },
    generations: 6,
    angle: 32,
  },
];

function grow({ axiom, rules, generations }: Plant, rand: () => number) {
  let word = axiom;
  for (let g = 0; g < generations; g++)
    word = Array.from(word, (ch) =>
      rules[ch] ? pick(rules[ch], rand) : ch,
    ).join("");
  return word;
}

// A leaf: a tapered line from `a` to `b` whose radius at a fraction t along it is radius(t), at most `max`.
// Units are turtle steps.
type Leaf = { a: Pt; b: Pt; radius: (t: number) => number; max: number };

// Visits every pixel within `reach` of the line from `a` to `b` (a disc when they're equal), with the pixel's
// index, the fraction t along the line it's nearest, and its distance from there.
function paint(
  width: number,
  height: number,
  a: Pt,
  b: Pt,
  reach: number,
  apply: (i: number, t: number, d: number) => void,
) {
  const pad = Math.max(reach, 0.5) + 1;
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - pad));
  const x1 = Math.min(width, Math.ceil(Math.max(a[0], b[0]) + pad));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - pad));
  const y1 = Math.min(height, Math.ceil(Math.max(a[1], b[1]) + pad));
  const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
  const length2 = ex * ex + ey * ey;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const [px, py] = [x + 0.5 - a[0], y + 0.5 - a[1]];
      const t = length2 > 0 ? clamp01((px * ex + py * ey) / length2) : 0;
      const [dx, dy] = [px - t * ex, py - t * ey];
      apply(y * width + x, t, Math.sqrt(dx * dx + dy * dy));
    }
}

// How much of a pixel at distance `d` from a line of radius `r` the line covers, so edges stay smooth at any
// size. A line thinner than a pixel draws a pixel wide at matching strength, so thin twigs keep the same
// weight when the art is drawn small.
const coverage = (r: number, d: number) =>
  clamp01(Math.max(r, 0.5) - d + 0.5) * Math.min(1, 2 * r);

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const plant = pick(PLANTS, rand);
  const angle = plant.angle * (0.85 + 0.3 * rand()) * DEG;
  const word = grow(plant, rand);

  // Walk the turtle in steps of 1 with y up, collecting stems, and a tip at the end of every branch that drew a
  // step. A branch's end is a tip even when side branches leave from it.
  const stems: { a: Pt; b: Pt; order: number }[] = [];
  const tips: { at: Pt; dir: Pt }[] = [];
  let state = {
    at: [0, 0] as Pt,
    dir: turn([0, 1], (rand() - 0.5) * 10 * DEG),
    order: 0,
    stepped: false,
  };
  const stack: (typeof state)[] = [];
  for (const ch of word + "]") {
    if (ch === "F") {
      // A slight random bend on every step, so stems don't grow ruler straight.
      const dir = turn(state.dir, (rand() - 0.5) * 8 * DEG);
      const at: Pt = [state.at[0] + dir[0], state.at[1] + dir[1]];
      stems.push({ a: state.at, b: at, order: state.order });
      state = { ...state, at, dir, stepped: true };
    } else if (ch === "+" || ch === "-") {
      const a = angle * (0.8 + 0.4 * rand());
      state = { ...state, dir: turn(state.dir, ch === "+" ? a : -a) };
    } else if (ch === "[") {
      stack.push(state);
      state = { ...state, order: state.order + 1, stepped: false };
    } else if (ch === "]") {
      if (state.stepped) tips.push({ at: state.at, dir: state.dir });
      state = stack.pop() ?? state;
    }
  }

  // Tips become leaves or flowers, sized in steps so denser plants get smaller ones.
  const leafLength = 2.4 + 1.4 * rand();
  const leafWidth = leafLength * (0.3 + 0.15 * rand());
  const ovate = rand() < 0.5;
  const bloom = pick([0, 0.08, 0.2], rand);
  const flowerRadius = leafLength * (0.5 + 0.25 * rand());
  const petals = pick([5, 6, 8], rand);
  const leaves: Leaf[] = [];
  const flowers: { at: Pt; spin: number }[] = [];
  for (const { at, dir } of tips) {
    if (rand() < bloom) {
      flowers.push({ at, spin: rand() * 2 * Math.PI });
      continue;
    }
    const d = turn(dir, (rand() - 0.5) * 40 * DEG);
    leaves.push({
      a: at,
      b: [at[0] + d[0] * leafLength, at[1] + d[1] * leafLength],
      // Pointed at both ends, widest in the middle or, for ovate leaves, a third of the way along.
      radius: ovate
        ? (t) => leafWidth * 6.75 * t * (1 - t) * (1 - t)
        : (t) => leafWidth * 4 * t * (1 - t),
      max: leafWidth,
    });
  }

  // Fit the plant's bounds to the middle of the art, keeping a margin of field around it.
  const points = [
    ...stems.map((s) => s.b),
    ...leaves.map((l) => l.b),
    ...flowers.flatMap(({ at }): Pt[] => [
      [at[0] - flowerRadius, at[1] - flowerRadius],
      [at[0] + flowerRadius, at[1] + flowerRadius],
    ]),
  ];
  let [minX, maxX, minY, maxY] = [0, 0, 0, 0];
  for (const [x, y] of points) {
    [minX, maxX] = [Math.min(minX, x), Math.max(maxX, x)];
    [minY, maxY] = [Math.min(minY, y), Math.max(maxY, y)];
  }
  const pad = 0.1 * Math.min(width, height);
  const scale = Math.min(
    (width - 2 * pad) / (maxX - minX),
    (height - 2 * pad) / (maxY - minY),
  );
  const [cx, cy] = [(minX + maxX) / 2, (minY + maxY) / 2];
  const toPx = ([x, y]: Pt): Pt => [
    width / 2 + (x - cx) * scale,
    height / 2 - (y - cy) * scale,
  ];

  // Stems thin with each branching, down to a hairline, both relative to the plant's size.
  const size = Math.max(maxX - minX, maxY - minY) * scale;
  const trunk = (0.011 + 0.006 * rand()) * size;
  const taper = 0.62 + 0.12 * rand();
  const hairline = 0.0035 * size;

  // Stems in the darkest ink, leaves in the next (or a lighter darkest ink when there are only two), flowers in
  // the last ink with a contrasting heart.
  const paperInk = rgb(paper);
  const dark = rgb(inks[0]);
  const leafInk = inks.length > 2 ? rgb(inks[1]) : mix(dark, paperInk, 0.35);
  const flowerInk = rgb(inks[inks.length - 1]);
  const heartInk = inks.length > 3 ? rgb(inks[2]) : dark;
  const field = mix(paperInk, leafInk, 0.05 + 0.08 * rand());

  // The picture as RGB, painted back to front.
  const color = new Float64Array(width * height * 3);
  for (let i = 0; i < width * height; i++) color.set(field, i * 3);
  const over = (i: number, ink: Rgb, c: number) => {
    for (let k = 0; k < 3; k++)
      color[i * 3 + k] += (ink[k] - color[i * 3 + k]) * c;
  };

  // Stems share one coverage layer, keeping the larger where they overlap, so their joins don't darken.
  // Radii by branch order, by repeated multiplying since ** isn't exact in every engine.
  const stemCover = new Float32Array(width * height);
  const radii = [trunk];
  for (const { order } of stems)
    while (radii.length <= order) radii.push(radii[radii.length - 1] * taper);
  for (const { a, b, order } of stems) {
    const r = Math.max(hairline, radii[order]);
    paint(width, height, toPx(a), toPx(b), r, (i, _, d) => {
      const c = coverage(r, d);
      if (c > stemCover[i]) stemCover[i] = c;
    });
  }
  for (let i = 0; i < width * height; i++) over(i, dark, stemCover[i]);

  // Each leaf over the ones before, in a slightly different tone so overlapping leaves stay apart, with its
  // midrib, which only shows when the art is drawn large, on top of it alone.
  for (const leaf of leaves) {
    const ink = mix(leafInk, rand() < 0.5 ? dark : paperInk, 0.18 * rand());
    const rib = mix(ink, dark, 0.6);
    const ribRadius = 0.07 * leaf.max * scale;
    paint(
      width,
      height,
      toPx(leaf.a),
      toPx(leaf.b),
      leaf.max * scale,
      (i, t, d) => {
        const c = coverage(leaf.radius(t) * scale, d);
        if (c <= 0) return;
        over(i, ink, c);
        if (t < 0.85) over(i, rib, Math.min(c, coverage(ribRadius, d)));
      },
    );
  }

  // Each flower over the ones before, in a slightly different tone like the leaves: a ring of petals and a heart.
  for (const { at, spin } of flowers) {
    const ink = mix(flowerInk, rand() < 0.5 ? dark : paperInk, 0.15 * rand());
    const c = toPx(at);
    const R = flowerRadius * scale;
    for (let k = 0; k < petals; k++) {
      const [ox, oy] = cosSin(spin + (k * 2 * Math.PI) / petals);
      const petal: Pt = [c[0] + ox * 0.55 * R, c[1] + oy * 0.55 * R];
      paint(width, height, petal, petal, 0.45 * R, (i, _, d) =>
        over(i, ink, coverage(0.45 * R, d)),
      );
    }
    paint(width, height, c, c, 0.3 * R, (i, _, d) =>
      over(i, heartInk, coverage(0.3 * R, d)),
    );
  }

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = Math.round(color[i * 3]);
    data[i * 4 + 1] = Math.round(color[i * 3 + 1]);
    data[i * 4 + 2] = Math.round(color[i * 3 + 2]);
    data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

export const botanicalLSystem1: Style = {
  id: "bot1",
  draw,
};
