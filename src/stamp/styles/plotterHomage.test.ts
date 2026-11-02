import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, NEW_STYLES, pressStampRef, resolveStamp, STYLES } from "..";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number) {
  const stamp = resolveStamp({ source: "homage1", seed })!;
  expect(stamp.art.style.id).toBe("homage1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("plotter homage 1", () => {
  it("is pressed in the new style set only", () => {
    expect(NEW_STYLES.map((s) => s.id)).toContain("homage1");
    expect(STYLES.map((s) => s.id)).not.toContain("homage1");
    // A press draws one random number to pick a style: try one that lands in every slot.
    const refs = NEW_STYLES.map((_, i) =>
      pressStampRef(NEW_STYLES, () => (i + 0.5) / NEW_STYLES.length),
    );
    expect(refs.map((ref) => ref.source)).toContain("homage1");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead. One seed per piece.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(5, 39, 50))).toBe("b1893e462b5af8fa"); // Un Deux Trois
    expect(sha(pixels(6, 50, 39))).toBe("a987c8225bd62dc1"); // Cubic Disarray
    expect(sha(pixels(1, 44, 44))).toBe("acedf1dc14548cb2"); // Joy Division
    expect(sha(pixels(2, 39, 50))).toBe("baf6e011ecdc300d"); // Hypnotic Squares
    expect(sha(pixels(11, 50, 39))).toBe("141b8eb407a39713"); // Tiled Lines
    expect(sha(pixels(7, 44, 44))).toBe("2a6968a30f49db53"); // Triangular Mesh
    // Large enough not to be supersampled, as at desk size and in the detail view.
    expect(sha(pixels(1, 160, 200))).toBe("cef11d39bb3ebd0e");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Each pixel's coverage comes from the lines' exact geometry, so a large draw scaled down matches a small one,
  // apart from where lines cross or join. Draws with a short side under 128 px are supersampled, since their
  // lines run closer than a pixel apart.
  it.each([
    [40, 52, 8, 2],
    [200, 256, 4, 2.5],
  ])("draws the same picture at %ix%i as %i times larger", (w, h, k, bound) => {
    for (const seed of [5, 6, 1, 2, 11, 7]) {
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
