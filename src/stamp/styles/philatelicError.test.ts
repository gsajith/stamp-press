import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, resolveStamp, STYLES } from "..";
import { rollError, type PrintError } from "./philatelicError";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number) {
  const stamp = resolveStamp({ source: "error1", seed })!;
  expect(stamp.art.style.id).toBe("error1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("philatelic error 1", () => {
  it("is pressed alongside the other styles", () => {
    expect(STYLES.map((s) => s.id)).toContain("error1");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("3b52e322e924efde");
    expect(sha(pixels(2, 50, 39))).toBe("43862e6451b3422b");
    expect(sha(pixels(3, 44, 44))).toBe("ee1247f262eb0375");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  it("prints about 1 in 20 stamps perfect, and inverted centers rarely", () => {
    const counts: Partial<Record<PrintError, number>> = {};
    const n = 20000;
    for (let seed = 0; seed < n; seed++) {
      const error = rollError(seed);
      counts[error] = (counts[error] ?? 0) + 1;
    }
    const share = (error: PrintError) => (counts[error] ?? 0) / n;
    expect(share("perfect")).toBeGreaterThan(0.04);
    expect(share("perfect")).toBeLessThan(0.06);
    expect(share("inverted")).toBeGreaterThan(0.02);
    expect(share("inverted")).toBeLessThan(share("perfect"));
    for (const error of ["double", "fold", "missingInk", "perfect"] as const)
      expect(share("misregistered")).toBeGreaterThan(share(error));
  });

  // Fine engraved lines have to average out, not alias. Draws with a short side under 128 px are
  // supersampled, so they match closely. Larger ones, like desk stamps, aren't, and stray a little more:
  // seed 6 doubles a hatched frame, and two copies of the same lines overlapping inside a pixel print a
  // slightly different tone than they do resolved.
  it.each([
    [40, 52, 8, 2],
    [200, 256, 4, 3],
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
