import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, resolveStamp, STYLES } from "..";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number) {
  const stamp = resolveStamp({ source: "stars1", seed })!;
  expect(stamp.art.style.id).toBe("stars1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

// Mean difference per channel, out of 255, between a small draw and a large one boxed down to its size.
function downscaleError(seed: number, w: number, h: number, k: number) {
  const small = pixels(seed, w, h);
  const large = pixels(seed, w * k, h * k);
  let total = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = 0; dy < k; dy++)
          for (let dx = 0; dx < k; dx++)
            sum += large[((y * k + dy) * w * k + x * k + dx) * 4 + c];
        total += Math.abs(sum / (k * k) - small[(y * w + x) * 4 + c]);
      }
  return total / (w * h * 3);
}

describe("sky chart 1", () => {
  it("is pressed alongside the other styles", () => {
    expect(STYLES.map((s) => s.id)).toContain("stars1");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead. Seed 1 is a round chart, 2 and 3
  // half domes, and 7 a strip, drawn large enough that its faint stars and ticks resolve.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("28fe4fe21a38c14e");
    expect(sha(pixels(2, 50, 39))).toBe("5af3462d01d1d2fa");
    expect(sha(pixels(3, 44, 44))).toBe("1e6bf0cfcf2224bf");
    expect(sha(pixels(7, 320, 420))).toBe("1ae157ecac11dbf7");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Faint stars, rim ticks and fine lines thinner than a pixel have to average out, not alias or vanish.
  it("draws the same picture at any size", () => {
    for (const seed of [4, 5, 6])
      expect(downscaleError(seed, 40, 52, 8)).toBeLessThan(1.5);
  });

  it("draws the same picture at desk size as at detail size", () => {
    expect(downscaleError(7, 150, 120, 4)).toBeLessThan(1);
  });
});
