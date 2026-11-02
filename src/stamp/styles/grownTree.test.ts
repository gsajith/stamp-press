import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, NEW_STYLES, pressStampRef, resolveStamp, STYLES } from "..";
import { stream } from "../random";
import { grow, OP } from "./grownTree";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number, source = "tree1") {
  const stamp = resolveStamp({ source, seed })!;
  expect(stamp.art.style.id).toBe("tree1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("grown tree 1", () => {
  it("is pressed in the new style set, not the classic one", () => {
    expect(NEW_STYLES.map((s) => s.id)).toContain("tree1");
    expect(STYLES.map((s) => s.id)).not.toContain("tree1");
    const tree = NEW_STYLES.findIndex((s) => s.id === "tree1");
    const ref = pressStampRef(
      NEW_STYLES,
      () => (tree + 0.5) / NEW_STYLES.length,
    );
    expect(ref.source).toBe("tree1");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("f032e5996aca1e0e");
    expect(sha(pixels(2, 50, 39))).toBe("cda675506da79f11");
    expect(sha(pixels(3, 44, 44))).toBe("3c12a4657c9b2bdb");
    expect(sha(pixels(4, 44, 56, "tree1w"))).toBe("9ede0b5a28a8580e");
    // Large enough for the grain to print as stipple, as in the detail view.
    expect(sha(pixels(5, 1100, 1400))).toBe("6c8310201e63e36c");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Portrait, landscape and square. The tree grows in its own units, so only its rasterizing changes with
  // size: twigs under a pixel wide spread to a pixel at matching strength, and grain prints as flat tone. A
  // tiny draw blurs most of the tree into those pixel-wide lines, so it strays more than one at desk size.
  it.each([
    [7, 40, 52, 8, 4],
    [8, 52, 40, 8, 4],
    [9, 46, 46, 8, 4],
    [7, 160, 208, 4, 2.5],
    [8, 208, 160, 4, 2.5],
    [9, 184, 184, 4, 2.5],
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

describe("grow", () => {
  // The original's own split rate grows thousands of twigs, which would blow the draw budget. The cap is
  // checked between steps, so the last step may run a little past it.
  it("stops a bushy tree at the cap", () => {
    const ops = grow(stream(1, 0), stream(1, 1), {
      root: -Math.PI / 2,
      splitDiminish: 0.71,
      splitAngle: 0.3 * Math.PI,
      angleMax: 10 * Math.PI * 1e-4,
      probScale: 0.14,
    });
    expect(ops.length / OP).toBeLessThanOrEqual(12000 + 1000);
    expect(ops.length / OP).toBeGreaterThan(11000);
  });
});
