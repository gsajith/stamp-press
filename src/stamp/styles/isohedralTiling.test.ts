import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, NEW_STYLES, resolveStamp } from "..";
import { layOut, makeTiling, prototile, type Spot } from "./isohedralTiling";
import { TILING_TYPES } from "./isohedralTypes";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number) {
  const stamp = resolveStamp({ source: "isotile1", seed })!;
  expect(stamp.art.style.id).toBe("isotile1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("isohedral tiling 1", () => {
  it("is pressed in the new style set", () => {
    expect(NEW_STYLES.map((s) => s.id)).toContain("isotile1");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("cb5e5fba2e28a4fd");
    expect(sha(pixels(2, 50, 39))).toBe("1e0a1f560bcc0082");
    expect(sha(pixels(3, 44, 44))).toBe("dc8ce23537f3f4f0");
    // Large enough not to be supersampled, as at desk size and in the detail view.
    expect(sha(pixels(7, 160, 200))).toBe("10c4635ec359bd4f");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Outlines finer than a pixel have to average out, not alias. Draws with a short side under 160 px are
  // supersampled, so they match closely. Larger ones, like desk stamps, aren't, and stray more.
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

describe("the tiling types", () => {
  // Checks the ported tables end to end: the prototile's copies cover the plane once over, and the colouring
  // gives the tiles on either side of every edge different colours. Probes straddle the middle of each edge
  // segment of each copy of the prototile in the unit at the origin.
  it.each(TILING_TYPES.map((t) => [t.type, t] as const))(
    "tiles the plane and colours neighbors apart in IH%i",
    (_, type) => {
      const tiling = makeTiling(type);
      const outline = prototile(tiling, []);
      const layout = layOut(tiling, outline, 0.01)!;
      expect(layout).not.toBeNull();
      const [a, b]: Spot[] = [
        { colour: 0, distance: 0 },
        { colour: 0, distance: 0 },
      ];
      for (const [m0, m1, m2, m3, m4, m5] of tiling.aspects)
        for (let s = 0; s < outline.length; s++) {
          const [p, q] = [outline[s], outline[(s + 1) % outline.length]];
          const [x, y] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
          const [mx, my] = [m0 * x + m1 * y + m2, m3 * x + m4 * y + m5];
          const [ex, ey] = [q[0] - p[0], q[1] - p[1]];
          const [dx, dy] = [m0 * ex + m1 * ey, m3 * ex + m4 * ey];
          const e = 1e-4 / Math.sqrt(dx * dx + dy * dy);
          layout.at(mx - dy * e, my + dx * e, a);
          layout.at(mx + dy * e, my - dx * e, b);
          expect(a.colour).not.toBe(b.colour);
        }
    },
  );
});
