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

// Cosine and sine of `a` radians from their Taylor series, which uses only exact arithmetic. Accurate to well
// under a pixel for |a| up to pi.
function cosSin(a: number): Pt {
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

// A stroke: a tapered line from `a` to `b` whose radius at a fraction t along it is radius(t). A zero-length
// stroke is a disc. Units are turtle steps until the plant is fitted to the art, then pixels.
type Stroke = { a: Pt; b: Pt; radius: (t: number) => number; max: number };

type Layer = { width: number; height: number; cover: Float32Array };

// Paints a stroke's coverage into a layer, keeping the larger where strokes overlap. Coverage comes from the
// distance to the stroke's center line, so edges stay smooth at any size. A stroke thinner than a pixel draws
// a pixel wide at matching strength, so thin twigs keep the same weight when the art is drawn small.
function paint({ width, height, cover }: Layer, { a, b, radius, max }: Stroke) {
  const pad = Math.max(max, 0.5) + 1;
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
      const r = radius(t);
      const c =
        clamp01(Math.max(r, 0.5) - Math.sqrt(dx * dx + dy * dy) + 0.5) *
        Math.min(1, 2 * r);
      const i = y * width + x;
      if (c > cover[i]) cover[i] = c;
    }
}

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
  const leaves: Stroke[] = [];
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

  const layer = (): Layer => ({
    width,
    height,
    cover: new Float32Array(width * height),
  });
  const [stemLayer, leafLayer, veinLayer, petalLayer, heartLayer] = [
    layer(),
    layer(),
    layer(),
    layer(),
    layer(),
  ];
  // Radii by branch order, by repeated multiplying since ** isn't exact in every engine.
  const radii = [trunk];
  for (const { order } of stems)
    while (radii.length <= order) radii.push(radii[radii.length - 1] * taper);
  for (const { a, b, order } of stems) {
    const r = Math.max(hairline, radii[order]);
    paint(stemLayer, { a: toPx(a), b: toPx(b), radius: () => r, max: r });
  }
  for (const leaf of leaves) {
    const [a, b] = [toPx(leaf.a), toPx(leaf.b)];
    paint(leafLayer, {
      a,
      b,
      radius: (t) => leaf.radius(t) * scale,
      max: leaf.max * scale,
    });
    // The midrib, which only shows when the art is drawn large.
    const rib = 0.07 * leaf.max * scale;
    paint(veinLayer, {
      a,
      b: [a[0] + (b[0] - a[0]) * 0.85, a[1] + (b[1] - a[1]) * 0.85],
      radius: () => rib,
      max: rib,
    });
  }
  for (const { at, spin } of flowers) {
    const c = toPx(at);
    const R = flowerRadius * scale;
    for (let i = 0; i < petals; i++) {
      const [ox, oy] = cosSin(spin + (i * 2 * Math.PI) / petals - Math.PI);
      const petal: Pt = [c[0] + ox * 0.55 * R, c[1] + oy * 0.55 * R];
      paint(petalLayer, {
        a: petal,
        b: petal,
        radius: () => 0.45 * R,
        max: 0.45 * R,
      });
    }
    paint(heartLayer, { a: c, b: c, radius: () => 0.3 * R, max: 0.3 * R });
  }

  // Stems in the darkest ink, leaves in the next (or a lighter darkest ink when there are only two), flowers in
  // the last ink with a contrasting heart.
  const dark = rgb(inks[0]);
  const leafInk = inks.length > 2 ? rgb(inks[1]) : mix(dark, rgb(paper), 0.35);
  const flowerInk = rgb(inks[inks.length - 1]);
  const heartInk = inks.length > 3 ? rgb(inks[2]) : dark;
  const field = mix(rgb(paper), leafInk, 0.05 + 0.08 * rand());
  const veinInk = mix(leafInk, dark, 0.6);

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let i = 0; i < width * height; i++) {
    let color = mix(field, dark, stemLayer.cover[i]);
    color = mix(color, leafInk, leafLayer.cover[i]);
    color = mix(
      color,
      veinInk,
      Math.min(veinLayer.cover[i], leafLayer.cover[i]),
    );
    color = mix(color, flowerInk, petalLayer.cover[i]);
    color = mix(color, heartInk, heartLayer.cover[i]);
    const p = i * 4;
    data[p] = Math.round(color[0]);
    data[p + 1] = Math.round(color[1]);
    data[p + 2] = Math.round(color[2]);
    data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

export const botanicalLSystem1: Style = {
  id: "bot1",
  draw,
};
