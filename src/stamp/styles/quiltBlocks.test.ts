import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, NEW_STYLES, resolveStamp, STYLES } from "..";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number) {
  const stamp = resolveStamp({ source: "quilt1", seed })!;
  expect(stamp.art.style.id).toBe("quilt1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("quilt blocks 1", () => {
  it("is pressed in the new style set, not the classic one", () => {
    expect(NEW_STYLES.map((s) => s.id)).toContain("quilt1");
    expect(STYLES.map((s) => s.id)).not.toContain("quilt1");
  });

  it("prints in Sanzo Wada's colors too", () => {
    expect(resolveStamp({ source: "quilt1w", seed: 1 })!.palette.id).toMatch(
      /^wada/,
    );
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("19979ba062731077");
    expect(sha(pixels(2, 50, 39))).toBe("d6a33839b833a7d9");
    expect(sha(pixels(3, 44, 44))).toBe("49de4c76faf9c8d1");
    // Large enough that only edge pixels are supersampled, as at desk size and in the detail view.
    expect(sha(pixels(7, 160, 200))).toBe("60971564acd271f9");
    expect(sha(pixels(5, 200, 160))).toBe("5a636144b5201281");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Edges and stitches finer than a pixel have to average out, not alias. Small draws are supersampled
  // everywhere; desk-sized ones only along edges.
  it.each([
    [40, 52, 8],
    [160, 208, 4],
  ])("draws the same picture at %ix%i as %i times larger", (w, h, k) => {
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
      expect(total / (w * h * 3)).toBeLessThan(2);
    }
  });
});
