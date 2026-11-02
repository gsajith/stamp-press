import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, NEW_STYLES, pressStampRef, resolveStamp } from "..";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number) {
  const stamp = resolveStamp({ source: "arms1", seed })!;
  expect(stamp.art.style.id).toBe("arms1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("coat of arms 1", () => {
  it("is pressed in the new style set", () => {
    const at = NEW_STYLES.findIndex((s) => s.id === "arms1");
    expect(at).toBeGreaterThanOrEqual(0);
    // A press whose random pick lands on arms1's slot.
    const pick = () => (at + 0.5) / NEW_STYLES.length;
    expect(pressStampRef(NEW_STYLES, pick).source).toBe("arms1");
    expect(pressStampRef(NEW_STYLES, pick, "wada").source).toBe("arms1w");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("0c66ea0ac345ca00");
    expect(sha(pixels(2, 50, 39))).toBe("c73ad14b529a4cbd");
    expect(sha(pixels(3, 44, 44))).toBe("c0a6e699164a3665");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Each pixel is inked by the share of it a shape covers, so the picture holds at any size. Where shapes stack
  // their edge pixels blend in turn, which strays from exact areas, most where a pattern's lines or a thin
  // orle are about a pixel wide: seed 11's pappellony field at 40x52 is the worst case here.
  it.each([
    [40, 52, 8, 3.5],
    [200, 256, 4, 1.5],
  ])("draws the same picture at %ix%i as %i times larger", (w, h, k, bound) => {
    for (const seed of [4, 5, 6, 11]) {
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
