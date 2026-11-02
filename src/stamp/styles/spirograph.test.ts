import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, NEW_STYLES, resolveStamp } from "..";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(
  seed: number,
  width: number,
  height: number,
  source = "spiro1",
) {
  const stamp = resolveStamp({ source, seed })!;
  expect(stamp.art.style.id).toBe("spiro1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("spirograph rosette 1", () => {
  it("is pressed in the new style set", () => {
    expect(NEW_STYLES.map((s) => s.id)).toContain("spiro1");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead. Seed 10 prints a denomination.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("67867727dae708f1");
    expect(sha(pixels(2, 50, 39))).toBe("ce6ea9e7bedcbf14");
    expect(sha(pixels(3, 44, 44))).toBe("7c1eed9ceda53c3e");
    expect(sha(pixels(4, 39, 50, "spiro1w"))).toBe("d9856832af66c910");
    expect(sha(pixels(10, 50, 39))).toBe("c54eb06647519eaf");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Sizes and line weights are fractions of the art's short side, and each pixel averages its line coverage, so a
  // downscaled large draw matches a small one, up to where lines cross inside one small pixel.
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

  // The budget is about 10 ms for a desk stamp and 1 s at 2048 px on a typical machine. The limits here leave
  // room for a loaded CI runner, so they catch a slow change rather than measure the budget. 142x182 is the
  // smallest desk art, a portrait with the widest margin, where each pixel takes the most samples.
  it("draws within its time budget", () => {
    const time = (w: number, h: number, seeds: number[]) =>
      Math.min(
        ...seeds.map((seed) => {
          const t0 = performance.now();
          pixels(seed, w, h);
          return performance.now() - t0;
        }),
      );
    pixels(0, 200, 256);
    expect(time(200, 256, [20, 21, 22, 23, 24])).toBeLessThan(40);
    expect(time(142, 182, [20, 21, 22, 23, 24])).toBeLessThan(40);
    expect(time(1600, 2048, [25])).toBeLessThan(1500);
  });
});
