import { describe, expect, it } from "vitest";
import { atan2, cos, exp, log, perlin2, pow, sin } from "./exact";

const xs = Array.from({ length: 2001 }, (_, i) => (i - 1000) * 0.0377);
const close = (a: number, b: number) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-13 * Math.max(1, Math.abs(b)));

describe("exact math", () => {
  it("matches the built-in functions to about 1e-14", () => {
    for (const x of xs) {
      close(sin(x), Math.sin(x));
      close(cos(x), Math.cos(x));
      close(atan2(x, 0.7 - x * 0.3), Math.atan2(x, 0.7 - x * 0.3));
      close(exp(x / 3), Math.exp(x / 3));
    }
    for (const x of [1e-9, 0.01, 0.5, 1, 2.5, 1000, 1e12]) {
      close(log(x), Math.log(x));
      close(pow(x, 0.37), Math.pow(x, 0.37));
    }
    close(pow(-2, 3), -8);
    close(atan2(-1, -1), Math.atan2(-1, -1));
    expect(atan2(0, 0)).toBe(0);
  });
});

describe("perlin noise", () => {
  it("is smooth, bounded and differs by seed", () => {
    const a = perlin2(1);
    const b = perlin2(2);
    let differs = false;
    for (let i = 0; i < 400; i++) {
      const x = i * 0.137;
      const y = i * 0.071;
      expect(Math.abs(a(x, y))).toBeLessThanOrEqual(1.01);
      expect(Math.abs(a(x + 1e-4, y) - a(x, y))).toBeLessThan(1e-3);
      if (Math.abs(a(x, y) - b(x, y)) > 0.01) differs = true;
    }
    expect(differs).toBe(true);
    expect(a(3, 4)).toBe(0);
  });
});
