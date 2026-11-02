import { stream } from "./random";

// Math built only from IEEE-exact operations (+ - * /, Math.sqrt, Math.round, Math.floor), so styles draw the
// same pixels in every browser and in Node (ADR 0001). The built-in Math.sin, cos, atan2, exp, log and pow
// may differ in the last bits between engines. Each function here is within about 1e-14 of the built-in one.

const HALF_PI = Math.PI / 2;
// HALF_PI's rounding error, so large angles reduce without losing precision.
const HALF_PI_LO = 6.123233995736766e-17;

// sin and cos of r for |r| <= pi/4, by Taylor series: the first omitted term is under 1e-17.
function sinSmall(r: number): number {
  const r2 = r * r;
  return (
    r *
    (1 +
      r2 *
        (-1 / 6 +
          r2 *
            (1 / 120 +
              r2 *
                (-1 / 5040 +
                  r2 *
                    (1 / 362880 +
                      r2 * (-1 / 39916800 + r2 * (1 / 6227020800)))))))
  );
}
function cosSmall(r: number): number {
  const r2 = r * r;
  return (
    1 +
    r2 *
      (-1 / 2 +
        r2 *
          (1 / 24 +
            r2 *
              (-1 / 720 +
                r2 *
                  (1 / 40320 +
                    r2 *
                      (-1 / 3628800 +
                        r2 * (1 / 479001600 + r2 * (-1 / 87178291200)))))))
  );
}

// Splits x into a quarter turn count and a remainder in [-pi/4, pi/4].
function quadrant(x: number): [number, number] {
  const k = Math.round(x / HALF_PI);
  return [((k % 4) + 4) % 4, x - k * HALF_PI - k * HALF_PI_LO];
}

export function sin(x: number): number {
  const [q, r] = quadrant(x);
  return q === 0
    ? sinSmall(r)
    : q === 1
      ? cosSmall(r)
      : q === 2
        ? -sinSmall(r)
        : -cosSmall(r);
}

export function cos(x: number): number {
  const [q, r] = quadrant(x);
  return q === 0
    ? cosSmall(r)
    : q === 1
      ? -sinSmall(r)
      : q === 2
        ? -cosSmall(r)
        : sinSmall(r);
}

const SQRT3 = Math.sqrt(3);
// tan(pi/12): above it, atan shifts by pi/6 to keep the series short.
const TAN_PI_12 = 2 - SQRT3;

export function atan(x: number): number {
  if (x < 0) return -atan(-x);
  if (x > 1) return HALF_PI - atan(1 / x);
  if (x > TAN_PI_12) return Math.PI / 6 + atan((x * SQRT3 - 1) / (x + SQRT3));
  // |x| <= 0.268: the series' first omitted term is under 1e-16.
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 3; n <= 29; n += 2) {
    term *= -x2;
    sum += term / n;
  }
  return sum;
}

export function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + Math.PI : atan(y / x) - Math.PI;
  return y > 0 ? HALF_PI : y < 0 ? -HALF_PI : 0;
}

const LN2 = 0.6931471805599453;
const LN2_LO = 2.3190468138462996e-17;

// 2 to an integer power, by exact doubling or halving.
function pow2(k: number): number {
  let p = 1;
  for (; k > 0; k--) p *= 2;
  for (; k < 0; k++) p /= 2;
  return p;
}

export function exp(x: number): number {
  if (x > 709) return Infinity;
  if (x < -745) return 0;
  const k = Math.round(x / LN2);
  const r = x - k * LN2 - k * LN2_LO;
  // |r| <= 0.35: 18 terms leave an error under 1e-17.
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 18; n++) {
    term *= r / n;
    sum += term;
  }
  return sum * pow2(k);
}

export function log(x: number): number {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  if (x === Infinity) return Infinity;
  let e = 0;
  while (x > Math.SQRT2) {
    x /= 2;
    e++;
  }
  while (x < Math.SQRT1_2) {
    x *= 2;
    e--;
  }
  // log x = 2 atanh(s), with |s| <= 0.172.
  const s = (x - 1) / (x + 1);
  const s2 = s * s;
  let term = s;
  let sum = s;
  for (let n = 3; n <= 31; n += 2) {
    term *= s2;
    sum += term / n;
  }
  return 2 * sum + e * LN2 + e * LN2_LO;
}

// x to the power y, for x > 0, or any x with an integer y.
export function pow(x: number, y: number): number {
  if (Number.isInteger(y) && Math.abs(y) <= 64) {
    let p = 1;
    for (let i = Math.abs(y); i > 0; i--) p *= x;
    return y < 0 ? 1 / p : p;
  }
  return exp(y * log(x));
}

// Seeded 2D gradient noise (Perlin's improved noise), in about [-1, 1], 0 on integer points. Each seed gives
// an independent field. For ports of p5's `noise()`, which returns [0, 1]: use `0.5 + 0.5 * n(x, y)`.
export function perlin2(seed: number): (x: number, y: number) => number {
  const rand = stream(seed, 0x9e3779b9);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  // Eight gradient directions, the diagonals scaled to unit length.
  const D = Math.SQRT1_2;
  const GX = [1, -1, 0, 0, D, -D, D, -D];
  const GY = [0, 0, 1, -1, D, D, -D, -D];
  const grad = (h: number, x: number, y: number) =>
    GX[h & 7] * x + GY[h & 7] * y;
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    const X = xf & 255;
    const Y = yf & 255;
    x -= xf;
    y -= yf;
    const u = fade(x);
    const v = fade(y);
    const a = perm[X] + Y;
    const b = perm[X + 1] + Y;
    const n00 = grad(perm[a], x, y);
    const n10 = grad(perm[b], x - 1, y);
    const n01 = grad(perm[a + 1], x, y - 1);
    const n11 = grad(perm[b + 1], x - 1, y - 1);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    // Scales the largest possible value to about 1.
    return (nx0 + v * (nx1 - nx0)) * 1.4142135623730951;
  };
}
