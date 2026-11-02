import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, NEW_STYLES, resolveStamp } from "..";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number, source = "rd1") {
  const stamp = resolveStamp({ source, seed })!;
  expect(stamp.art.style.id).toBe("rd1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("reaction diffusion 1", () => {
  it("is pressed in the new style set", () => {
    expect(NEW_STYLES.map((s) => s.id)).toContain("rd1");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("c195dac71103ba8a");
    expect(sha(pixels(2, 50, 39))).toBe("5232486c9aae20cd");
    expect(sha(pixels(3, 44, 44))).toBe("8d7fe08ec60e4344");
    expect(sha(pixels(4, 39, 50, "rd1w"))).toBe("d0604ecb63956762");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // The simulation runs on a grid fixed in art units, and each pixel blends across an ink edge by its distance
  // to it, so a downscaled large draw matches a small one, up to curved edges within a small pixel.
  it.each([
    [40, 52, 8, 4],
    [200, 256, 4, 0.5],
  ])("draws the same picture at %ix%i as %i times larger", (w, h, k, bound) => {
    for (const seed of [4, 5, 6]) {
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
      // Mean difference per channel, out of 255.
      expect(total / (w * h * 3)).toBeLessThan(bound);
    }
  });
});
