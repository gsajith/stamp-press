import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, resolveStamp } from "..";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number) {
  const stamp = resolveStamp({ source: "riso1", seed })!;
  expect(stamp.art.style.id).toBe("riso1");
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

describe("riso overprint 1", () => {
  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead. The large draw has grain.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("24d23d4fe5ec01e2");
    expect(sha(pixels(2, 50, 39))).toBe("53593128f48eb07b");
    expect(sha(pixels(3, 44, 44))).toBe("ad5de7e924951f6c");
    expect(sha(pixels(4, 840, 640))).toBe("3239be4b2cbb86ce");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  it("never prints in a palette it doesn't accept", () => {
    for (let seed = 0; seed < 200; seed++)
      expect(resolveStamp({ source: "riso1", seed })!.palette.id).not.toBe(
        "ochre",
      );
  });

  it("draws the same picture at any size", () => {
    for (const seed of [4, 5, 6])
      expect(downscaleError(seed, 40, 52, 8)).toBeLessThan(2);
  });

  // At detail-view sizes the grain shows. It has to average out to the flat ink a small draw prints.
  it("keeps the grain's average tone at detail-view size", () => {
    expect(downscaleError(7, 64, 64, 16)).toBeLessThan(2);
  });
});
