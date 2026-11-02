import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, NEW_STYLES, pressStampRef, resolveStamp } from "..";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number) {
  const stamp = resolveStamp({ source: "marble2", seed })!;
  expect(stamp.art.style.id).toBe("marble2");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("mathematical marbling 2", () => {
  it("is pressed in the new style set, in both color sets", () => {
    expect(NEW_STYLES.map((s) => s.id)).toContain("marble2");
    const style = NEW_STYLES.find((s) => s.id === "marble2")!;
    const only = [style];
    expect(pressStampRef(only, () => 0, "original").source).toBe("marble2");
    expect(pressStampRef(only, () => 0, "wada").source).toBe("marble2w");
    expect(resolveStamp({ source: "marble2w", seed: 1 })!.art.style).toBe(
      style,
    );
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead. The seeds cover every punch
  // aspect and every recipe: stone, nonpareil, banner, heart, feather, bouquet and swirl.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("0428a57728224411");
    expect(sha(pixels(3, 50, 39))).toBe("73ff6d4c76885b52");
    expect(sha(pixels(4, 44, 44))).toBe("15d00ce13f72353b");
    expect(sha(pixels(6, 39, 50))).toBe("07e66db3e5f78a06");
    expect(sha(pixels(8, 50, 39))).toBe("7a5eb99149246984");
    expect(sha(pixels(10, 44, 44))).toBe("05852a7408027fa2");
    expect(sha(pixels(12, 39, 50))).toBe("e7ef84681d305fc7");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Band edges finer than a pixel have to average out, not alias. Stone, banner, heart and swirl stay within
  // about 1.3 of 255. A nonpareil strays most, near 4: its comb's teeth taper to points thinner than a pixel,
  // so their tips land differently at each size, though the two pictures match by eye.
  it.each([
    [40, 52, 8, 4.5],
    [200, 256, 4, 4.5],
  ])("draws the same picture at %ix%i as %i times larger", (w, h, k, bound) => {
    for (const seed of [1, 4, 6, 12, 3]) {
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
