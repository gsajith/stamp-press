import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, resolveStamp, STYLES } from "..";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number) {
  const stamp = resolveStamp({ source: "girih1", seed })!;
  expect(stamp.art.style.id).toBe("girih1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("girih 1", () => {
  it("is pressed alongside the other styles", () => {
    expect(STYLES.map((s) => s.id)).toContain("girih1");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead.
  it("draws the same pixels it shipped with", () => {
    // Seeds 1 and 2 draw 6.6.6 and 3.12.12, 5 draws 4.8.8 and 7 draws 4.6.12, so each tiling is pinned.
    expect(sha(pixels(1, 39, 50))).toBe("994d0db0608aeb26");
    expect(sha(pixels(2, 50, 39))).toBe("67338daac0f3d945");
    expect(sha(pixels(3, 44, 44))).toBe("5a5d60ca27461918");
    expect(sha(pixels(5, 39, 50))).toBe("b7a5f61881df707f");
    expect(sha(pixels(7, 50, 39))).toBe("98f0c9d3d8eac4df");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Straps finer than a pixel have to keep their weight, and the edges between fills, which run under the
  // straps, mustn't alias. Draws with a short side under 192 px are supersampled, larger ones use exact strap
  // coverage at one sample per pixel.
  it.each([
    [40, 52, 8, 1.5],
    [200, 256, 4, 1.5],
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
