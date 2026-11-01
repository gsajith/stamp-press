import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, resolveStamp, STYLES } from "..";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number) {
  const stamp = resolveStamp({ source: "diorama1", seed })!;
  expect(stamp.art.style.id).toBe("diorama1");
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

describe("paper diorama 1", () => {
  it("is pressed alongside the other styles", () => {
    expect(STYLES.map((s) => s.id)).toContain("diorama1");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead. The seeds cover a village, a
  // forest and the sea, and the large draw has the fine fibre.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("a386385bff58b89e");
    expect(sha(pixels(5, 50, 39))).toBe("7fcd06a4508faa8e");
    expect(sha(pixels(7, 44, 44))).toBe("80859a438aa35602");
    expect(sha(pixels(9, 640, 820))).toBe("3c058cc400a26a7d");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Edges, shadows and windows finer than a pixel have to average out, not alias, in every scene and aspect.
  // Tiny draws lose the most, since the smallest cut details shrink below a pixel. A desk-size draw matches
  // closely.
  it.each([
    [40, 52, 8, 2],
    [52, 40, 8, 2],
    [48, 48, 8, 2],
    [200, 256, 4, 1],
  ])("draws the same picture at %ix%i as %i times larger", (w, h, k, bound) => {
    for (const seed of [4, 5, 6, 7, 8, 9])
      expect(downscaleError(seed, w, h, k)).toBeLessThan(bound);
  });
});
