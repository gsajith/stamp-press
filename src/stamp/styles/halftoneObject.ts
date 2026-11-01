import type { Palette } from "../palettes";
import { pick, stream } from "../random";
import type { Style } from "../sources";

// Halftone object: one lit subject, a ball on a ground plane or a ringed planet, printed as dots of the darkest
// ink on a rotated halftone screen, over a slightly misregistered flat tint of its silhouette.
//
// The subject is a tone field: a function from a point to how much ink it wants, 0 to 1. Each dot samples it at
// its cell's center, which is what drawing the subject offscreen and resampling it would do, without a canvas
// whose antialiasing differs between browsers. Like land1, it computes every pixel itself, in units where the
// art's short side is 1, so it draws the same picture at any size and the same pixels everywhere (ADR 0001).
// Only IEEE-exact arithmetic here: no Math.sin, Math.pow or the like, so angles come from a table.

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

// [cos, sin] of the classic screen angles 15, 45 and 75 degrees.
const SCREENS: readonly [number, number][] = [
  [0.9659258262890683, 0.25881904510252074],
  [0.7071067811865476, 0.7071067811865476],
  [0.25881904510252074, 0.9659258262890683],
];
// [cos, sin] of ring tilts: -20, -10, 10 and 20 degrees.
const TILTS: readonly [number, number][] = [
  [0.9396926207859084, -0.3420201433256687],
  [0.984807753012208, -0.17364817766693033],
  [0.984807753012208, 0.17364817766693033],
  [0.9396926207859084, 0.3420201433256687],
];
// How flat a planet's ring looks: its minor axis over its major axis.
const RING_FLAT = 0.3;

// A dot edge ramps from ink to paper over one pixel, which spreads a dot of `r` pixels radius over an area of
// π(r² + 1/12), or π(r + ½)³ / 3 below half a pixel, where the ramp never reaches full ink. This scales the
// ramp back to the dot's true area π r², so a small draw holds as much ink as a large one.
const inkScale = (r: number) =>
  r < 0.5
    ? (3 * r * r) / ((r + 0.5) * (r + 0.5) * (r + 0.5))
    : (r * r) / (r * r + 1 / 12);

// A subject: its tone at a point, and how much of a pixel `px` units wide at that point its silhouette covers.
// Points are in art units from the art's center, y down.
type Subject = {
  tone(x: number, y: number): number;
  cover(x: number, y: number, px: number): number;
};

// A unit light direction, from the upper left or upper right and toward the viewer.
function light(rand: () => number): [number, number, number] {
  const lx = (rand() < 0.5 ? -1 : 1) * (0.35 + 0.3 * rand());
  const ly = -(0.3 + 0.25 * rand());
  return [lx, ly, Math.sqrt(1 - lx * lx - ly * ly)];
}

// Ink wanted on a sphere of radius `r` at offset (dx, dy) from its center, lit from `l`.
function sphereTone(dx: number, dy: number, r: number, l: number[]) {
  const [nx, ny] = [dx / r, dy / r];
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  const lit = Math.max(0, nx * l[0] + ny * l[1] + nz * l[2]);
  return 0.95 - 0.9 * lit;
}

// A ball resting on a ground line, with a soft shadow cast away from the light.
function ball(rand: () => number, halfH: number): Subject {
  const r = 0.24 + 0.08 * rand();
  const cx = (rand() - 0.5) * 0.2;
  const ground = Math.min(halfH - 0.12, r + 0.04 + 0.08 * rand());
  const cy = ground - r;
  const l = light(rand);
  const shadow = { x: cx - l[0] * r * 0.9, rx: r * 1.25, ry: r * 0.22 };
  return {
    tone(x, y) {
      const [dx, dy] = [x - cx, y - cy];
      if (dx * dx + dy * dy < r * r) return sphereTone(dx, dy, r, l);
      if (y < ground) return 0.03 + 0.09 * clamp01((y + halfH) / (2 * halfH));
      const [ex, ey] = [(x - shadow.x) / shadow.rx, (y - ground) / shadow.ry];
      return 0.28 + 0.55 * clamp01(1 - ex * ex - ey * ey);
    },
    cover(x, y, px) {
      const [dx, dy] = [x - cx, y - cy];
      return clamp01((r - Math.sqrt(dx * dx + dy * dy)) / px + 0.5);
    },
  };
}

// A planet with a tilted ring that passes behind it at the top and in front of it at the bottom.
function planet(rand: () => number): Subject {
  const r = 0.2 + 0.07 * rand();
  const [cx, cy] = [(rand() - 0.5) * 0.12, (rand() - 0.5) * 0.12];
  const l = light(rand);
  const [c, s] = pick(TILTS, rand);
  const [inner, outer] = [r * (1.3 + 0.1 * rand()), r * (1.75 + 0.2 * rand())];
  // A point in the ring's frame: `q` is its elliptical radius, `g` how fast q changes per art unit there.
  const ring = (x: number, y: number) => {
    const [dx, dy] = [x - cx, y - cy];
    const [u, v] = [dx * c + dy * s, (dy * c - dx * s) / RING_FLAT];
    const q = Math.sqrt(u * u + v * v) || 1e-9;
    const g = Math.sqrt(u * u + (v * v) / (RING_FLAT * RING_FLAT)) / q;
    return { q, g, front: v > 0 };
  };
  const ringCover = (x: number, y: number, px: number) => {
    const { q, g } = ring(x, y);
    const edge = Math.min(q - inner, outer - q) / g;
    return clamp01(edge / px + 0.5);
  };
  return {
    tone(x, y) {
      const [dx, dy] = [x - cx, y - cy];
      const onBall = dx * dx + dy * dy < r * r;
      const { q, front } = ring(x, y);
      const onRing = q > inner && q < outer;
      // Two bands, with a gap between them, like Cassini's division.
      const band = (q - inner) / (outer - inner);
      const ringTone =
        band > 0.55 && band < 0.62 ? 0.05 : band < 0.55 ? 0.7 : 0.45;
      if (onRing && (front || !onBall)) return ringTone;
      if (onBall) return sphereTone(dx, dy, r, l);
      return 0.04;
    },
    cover(x, y, px) {
      const [dx, dy] = [x - cx, y - cy];
      const disc = clamp01((r - Math.sqrt(dx * dx + dy * dy)) / px + 0.5);
      return Math.max(disc, ringCover(x, y, px));
    },
  };
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const unit = Math.min(width, height);
  const [halfW, halfH] = [width / 2 / unit, height / 2 / unit];
  const px = 1 / unit;

  const dot = rgb(inks[0]);
  const tint = rgb(inks[inks.length - 1]);
  const field = mix(rgb(paper), rgb(inks[inks.length > 2 ? 1 : 0]), 0.08);
  const tintStrength = 0.55 + 0.3 * rand();

  const [c, s] = pick(SCREENS, rand);
  // Dot spacing in art units: 18 to 28 dots across the short side.
  const cell = 1 / (18 + Math.floor(rand() * 11));
  // The tint is printed a hair off from the dots, like a second plate out of register.
  const slip = [(rand() - 0.5) * 0.03, (rand() - 0.5) * 0.03];
  const subject = rand() < 0.5 ? ball(rand, halfH) : planet(rand);

  // Every dot's radius, in art units, on a grid of cell indices big enough to cover the art when rotated.
  const span = Math.ceil(Math.sqrt(halfW * halfW + halfH * halfH) / cell) + 2;
  const side = 2 * span + 1;
  const radii = new Float64Array(side * side);
  for (let j = -span; j <= span; j++)
    for (let i = -span; i <= span; i++) {
      const [x, y] = [(i * c - j * s) * cell, (i * s + j * c) * cell];
      const tone = clamp01(subject.tone(x, y));
      // 0.72 of a cell lets the darkest dots merge into solid ink.
      radii[(j + span) * side + i + span] = 0.72 * cell * Math.sqrt(tone);
    }

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y++) {
    const ay = (y + 0.5) / unit - halfH;
    for (let x = 0; x < width; x++) {
      const ax = (x + 0.5) / unit - halfW;
      let color = mix(
        field,
        tint,
        tintStrength * subject.cover(ax - slip[0], ay - slip[1], px),
      );
      // The screen position, in cells. A dot is at most 0.72 cells wide, so only the four nearest can reach.
      const gu = (ax * c + ay * s) / cell;
      const gv = (ay * c - ax * s) / cell;
      const [i0, j0] = [Math.floor(gu), Math.floor(gv)];
      let cover = 0;
      for (let j = j0; j <= j0 + 1; j++)
        for (let i = i0; i <= i0 + 1; i++) {
          const r = radii[(j + span) * side + i + span];
          if (r === 0) continue;
          const [du, dv] = [(gu - i) * cell, (gv - j) * cell];
          const d = Math.sqrt(du * du + dv * dv);
          cover = Math.max(
            cover,
            inkScale(r / px) * clamp01((r - d) / px + 0.5),
          );
        }
      if (cover > 0) color = mix(color, dot, cover);
      const p = (y * width + x) * 4;
      data[p] = Math.round(color[0]);
      data[p + 1] = Math.round(color[1]);
      data[p + 2] = Math.round(color[2]);
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export const halftoneObject1: Style = {
  id: "half1",
  draw,
};
