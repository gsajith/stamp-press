import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, NEW_STYLES, pressStampRef, resolveStamp } from "..";
import { hatPatch } from "./hatMonotile";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number, source = "hat1") {
  const stamp = resolveStamp({ source, seed })!;
  expect(stamp.art.style.id).toBe("hat1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("hat monotile 1", () => {
  it("is pressed in the new style set", () => {
    expect(NEW_STYLES.map((s) => s.id)).toContain("hat1");
    const ref = pressStampRef(
      NEW_STYLES.filter((s) => s.id === "hat1"),
      () => 0,
    );
    expect(ref.source).toBe("hat1");
  });

  // The substitution builds an H supertile whose hat count is a squared Fibonacci number at every level, and
  // the hats it places are all the same hat at half size, mirrored exactly when the H metatile's odd hat.
  it("ports hatviz's substitution", () => {
    const counts = [1, 2, 3, 4, 5].map((level) => hatPatch(level).length);
    expect(counts).toEqual([4, 25, 169, 1156, 7921]);
    for (const { label, T } of hatPatch(4)) {
      const det = T[0] * T[4] - T[1] * T[3];
      expect(Math.abs(det)).toBeCloseTo(0.25, 9);
      expect(T[0] * T[0] + T[3] * T[3]).toBeCloseTo(0.25, 9);
      expect(det < 0).toBe(label === "H1");
    }
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("99d34cd24f321843");
    expect(sha(pixels(2, 50, 39))).toBe("352bb02c902673d4");
    expect(sha(pixels(3, 44, 44))).toBe("f5851d6e9a450b70");
    expect(sha(pixels(4, 39, 50, "hat1w"))).toBe("e75fda1ed8fa5c8b");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Each pixel takes the exact area of every color under it, so a downscaled large draw matches a small one up
  // to rounding. Metatile outlines are the exception: they mix over the hats' outlines by coverage, which darkens
  // pixels where both cross. At 40 px a pixel spans most of a hat, so that comes to 2 to 4 out of 255.
  it.each([
    [40, 52, 8, 5],
    [190, 245, 4, 1],
    [245, 190, 4, 1],
    [210, 210, 4, 1],
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
