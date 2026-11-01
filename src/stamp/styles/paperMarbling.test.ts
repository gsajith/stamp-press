import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, resolveStamp, STYLES } from "..";
import { sinCos } from "./paperMarbling";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number) {
  const stamp = resolveStamp({ source: "marble1", seed })!;
  expect(stamp.art.style.id).toBe("marble1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("paper marbling 1", () => {
  it("is pressed alongside the other styles", () => {
    expect(STYLES.map((s) => s.id)).toContain("marble1");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead. The seeds cover every punch
  // aspect and every pattern: nonpareil, chevron, stone, bouquet and gel-git.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("943344d795fcb53a");
    expect(sha(pixels(2, 50, 39))).toBe("1bd1e7ffe729bc2d");
    expect(sha(pixels(3, 44, 44))).toBe("0dd4828dca59554c");
    expect(sha(pixels(5, 39, 50))).toBe("715350f993b6048c");
    expect(sha(pixels(7, 50, 39))).toBe("9e1d3ed1710dd126");
    expect(sha(pixels(6, 44, 44))).toBe("13eb067d77e4c7cd");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Veins and combed scallops finer than a pixel have to average out, not alias. Draws with a short side
  // under 128 px are supersampled, so they match closely. Larger ones, like desk stamps, rely on each edge's
  // exact width alone, and a nonpareil's scallops, a pixel or two wide there, stray more.
  it.each([
    [40, 52, 8, 2.5],
    [200, 256, 4, 3.5],
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

describe("sinCos", () => {
  it("matches Math.sin and Math.cos to within 1e-9", () => {
    let worst = 0;
    for (let i = 0; i <= 20000; i++) {
      const x = -20 + (40 * i) / 20000;
      const [sin, cos] = sinCos(x);
      worst = Math.max(
        worst,
        Math.abs(sin - Math.sin(x)),
        Math.abs(cos - Math.cos(x)),
      );
    }
    expect(worst).toBeLessThan(1e-9);
  });
});
