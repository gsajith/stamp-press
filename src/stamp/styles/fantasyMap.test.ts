import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, NEW_STYLES, resolveStamp, STYLES } from "..";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number, source = "map1") {
  const stamp = resolveStamp({ source, seed })!;
  expect(stamp.art.style.id).toBe("map1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("fantasy map 1", () => {
  it("is pressed in the new style set", () => {
    expect(NEW_STYLES.map((s) => s.id)).toContain("map1");
    expect(STYLES.map((s) => s.id)).not.toContain("map1");
    expect(resolveStamp({ source: "map1w", seed: 1 })?.palette.id).toMatch(
      /^wada/,
    );
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 78, 100))).toBe("6cd8d5a57de06f34");
    expect(sha(pixels(2, 100, 78))).toBe("a1c64e4cac329b8a");
    expect(sha(pixels(3, 88, 88))).toBe("ec7ca0f63b85930c");
    expect(sha(pixels(4, 78, 100, "map1w"))).toBe("041d58013a67cf46");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 40, 52))),
    );
    expect(hashes.size).toBe(5);
  });

  // Hairline hatching and lettering have to average out, not alias, so a small draw matches a large one shrunk.
  it.each([
    [40, 52, 8, 1.5],
    [200, 256, 4, 2.5],
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
  // room for a loaded CI runner, so they catch a slow change rather than measure the budget.
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
    expect(time(1600, 2048, [25])).toBeLessThan(1500);
  });
});
