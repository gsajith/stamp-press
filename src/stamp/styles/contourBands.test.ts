import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, NEW_STYLES, resolveStamp } from "..";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(
  seed: number,
  width: number,
  height: number,
  source = "contour1",
) {
  const stamp = resolveStamp({ source, seed })!;
  expect(stamp.art.style.id).toBe("contour1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("contour bands 1", () => {
  it("is pressed in the new style set", () => {
    expect(NEW_STYLES.map((s) => s.id)).toContain("contour1");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("93e616e70c4fdec0");
    expect(sha(pixels(2, 50, 39))).toBe("9588dee7615ed7f4");
    expect(sha(pixels(3, 44, 44))).toBe("e99bd795dee44541");
    expect(sha(pixels(4, 39, 50, "contour1w"))).toBe("0addffc6554d7070");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // The noise grid is fixed in art units and each pixel blends across a band edge by its distance to it, so a
  // downscaled large draw matches a small one, up to curved edges and bands thinner than a small pixel.
  it.each([
    [40, 52, 8, 2],
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
