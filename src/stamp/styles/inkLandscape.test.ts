import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, NEW_STYLES, resolveStamp } from "..";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number, source = "shan1") {
  const stamp = resolveStamp({ source, seed })!;
  expect(stamp.art.style.id).toBe("shan1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("ink landscape 1", () => {
  it("is pressed in the new style set", () => {
    expect(NEW_STYLES.map((s) => s.id)).toContain("shan1");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("52bd7d6de635b995");
    expect(sha(pixels(2, 50, 39))).toBe("a9911b5a4c645c21");
    expect(sha(pixels(5, 44, 44))).toBe("58301d3990961758");
    expect(sha(pixels(7, 52, 40, "shan1w"))).toBe("fe21778f06f3d042");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Strokes thinner than a pixel cover it by their exact area, so a small draw is the large one scaled down,
  // give or take where translucent strokes cross inside one pixel.
  it.each([
    [40, 52, 8, 1.5],
    [200, 256, 4, 0.75],
  ])("draws the same picture at %ix%i as %i times larger", (w, h, k, bound) => {
    for (const seed of [4, 5, 6, 7]) {
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
