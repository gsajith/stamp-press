import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, NEW_STYLES, pressStampRef, resolveStamp } from "..";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number) {
  const stamp = resolveStamp({ source: "polytile1", seed })!;
  expect(stamp.art.style.id).toBe("polytile1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("polygon tiling 1", () => {
  it("is pressed in the new style set", () => {
    const at = NEW_STYLES.findIndex((s) => s.id === "polytile1");
    expect(at).toBeGreaterThanOrEqual(0);
    // A press whose random pick lands on polytile1's slot.
    const pick = () => (at + 0.5) / NEW_STYLES.length;
    expect(pressStampRef(NEW_STYLES, pick).source).toBe("polytile1");
    expect(pressStampRef(NEW_STYLES, pick, "wada").source).toBe("polytile1w");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("530ab8704e03b6e1");
    expect(sha(pixels(2, 50, 39))).toBe("2acfa57eb4c21985");
    expect(sha(pixels(3, 44, 44))).toBe("6f13b0d851177145");
    // Large enough that one sample per pixel suffices, as at desk size and in the detail view.
    expect(sha(pixels(7, 160, 200))).toBe("4e51bc554627051e");
    expect(sha(pixels(5, 200, 160))).toBe("c7985d92611918b5");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Outlines and gaps a tenth of an edge wide have to average out, not alias. Small draws take several
  // samples per pixel; desk-sized ones shade one sample by its distance to the outline.
  it.each([
    [40, 52, 8],
    [160, 208, 4],
  ])("draws the same picture at %ix%i as %i times larger", (w, h, k) => {
    let worst = 0;
    for (const seed of [4, 5, 6, 7]) {
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
      worst = Math.max(worst, total / (w * h * 3));
    }
    expect(worst).toBeLessThan(1.5);
  });
});
