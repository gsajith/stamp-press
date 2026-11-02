import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, NEW_STYLES, pressStampRef, resolveStamp, STYLES } from "..";
import { mulberry32 } from "../random";
import { curve, sandCanvas, sprinkle } from "./sandLines";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number, source = "sand1") {
  const stamp = resolveStamp({ source, seed })!;
  expect(stamp.art.style.id).toBe("sand1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("sand lines 1", () => {
  it("is pressed in the new style set, not the classic one", () => {
    expect(NEW_STYLES.map((s) => s.id)).toContain("sand1");
    expect(STYLES.map((s) => s.id)).not.toContain("sand1");
    const sand = NEW_STYLES.findIndex((s) => s.id === "sand1");
    const ref = pressStampRef(
      NEW_STYLES,
      () => (sand + 0.5) / NEW_STYLES.length,
    );
    expect(ref.source).toBe("sand1");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("847651dd3d1744a3");
    expect(sha(pixels(2, 50, 39))).toBe("48482be0112ae06a");
    expect(sha(pixels(5, 44, 44))).toBe("696eb6fe2ef86aa7");
    expect(sha(pixels(4, 44, 56, "sand1w"))).toBe("3c895ef0c20880a4");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Portrait, landscape and square, ribbons (7 to 9) and glyphs (5). The curves are built in art units and
  // grains grow with the pixel count, so both draws lay the same ink in the same places. They differ by grain
  // noise, and because a stroke under a pixel wide spreads its ink over the whole pixel in the small draw,
  // where the large one piles it onto fewer pixels that saturate: the small draw prints hairlines bolder, by
  // design. At desk size that measures 2 to 5 out of 255, at 40 px 5 to 10.
  it.each([
    [7, 40, 52, 8, 13],
    [8, 52, 40, 8, 13],
    [9, 46, 46, 8, 13],
    [5, 40, 52, 8, 13],
    [7, 160, 208, 4, 7],
    [8, 208, 160, 4, 7],
    [9, 184, 184, 4, 7],
    [5, 160, 208, 4, 7],
  ])(
    "draws seed %i the same at %ix%i as %i times larger",
    (seed, w, h, k, bound) => {
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
    },
  );
});

describe("sprinkle", () => {
  const total = (density: Float32Array) => density.reduce((a, b) => a + b, 0);
  // A wavy curve well inside a 1 by 1 art.
  const path = [0.1, 0.5, 0.3, 0.3, 0.5, 0.6, 0.7, 0.4, 0.9, 0.5];

  // The grains a curve gets grow with the pixel count, and each lays down less, so its ink per art area is the
  // same at every size: the sum over pixels scales with the pixel area.
  it.each([40, 160, 640])(
    "lays down the curve's mass at %i px, whatever the grain count",
    (size) => {
      const sand = sandCanvas(size, size, 1);
      sprinkle(sand, mulberry32(1), curve(path), 0.02, 0);
      expect(total(sand.density[0]) / (size * size)).toBeCloseTo(0.02, 4);
    },
  );

  it("keeps each ink's grains apart", () => {
    const sand = sandCanvas(64, 64, 2);
    sprinkle(sand, mulberry32(2), curve(path), 0.01, 1);
    expect(total(sand.density[0])).toBe(0);
    expect(total(sand.density[1]) / (64 * 64)).toBeCloseTo(0.01, 4);
  });
});
