import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { artInset, drawArt, punchGeometry, resolveStamp, STYLES } from "..";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number) {
  const stamp = resolveStamp({ source: "stitch1", seed })!;
  expect(stamp.art.style.id).toBe("stitch1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("cross-stitch 1", () => {
  it("is pressed alongside the other styles", () => {
    expect(STYLES.map((s) => s.id)).toContain("stitch1");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("2247a1faaa73e1a6");
    expect(sha(pixels(2, 50, 39))).toBe("c715a5961c9925df");
    expect(sha(pixels(3, 44, 44))).toBe("6637468eb10a9b8f");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Thread twist, weave and holes finer than a pixel have to average out, not alias. Every draw box-filters the
  // same tiles exactly, so a small draw matches a large one scaled down closely at any size.
  it.each([
    [40, 52, 8, 0.5],
    [200, 256, 4, 1],
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

  // drawFace rounds the art's width and height separately, so its ratio drifts a little between the desk and the
  // detail view. That drift mustn't change the design, which is anchored to the art's middle and scaled to its
  // short side. So the large draw, mapped onto the small one that way, should match it closely.
  it("draws the same picture at the art sizes the desk and detail view use", () => {
    const artSize = (seed: number, scale: number) => {
      const stamp = resolveStamp({ source: "stitch1", seed })!;
      const { width, height } = punchGeometry(stamp.punch);
      const inset = Math.round(artInset(stamp) * scale);
      return [
        Math.round(width * scale) - 2 * inset,
        Math.round(height * scale) - 2 * inset,
      ];
    };
    for (const seed of [6, 9, 12, 16, 18, 20, 23, 117]) {
      const [w, h] = artSize(seed, 256);
      const [W, H] = artSize(seed, 1024);
      const small = pixels(seed, w, h);
      const large = pixels(seed, W, H);
      const k = Math.min(W, H) / Math.min(w, h);
      const [ox, oy] = [(W - w * k) / 2, (H - h * k) / 2];
      // Each small pixel against the area-weighted average of the large pixels under it.
      let total = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const [x0, x1] = [
            Math.max(0, x * k + ox),
            Math.min(W, (x + 1) * k + ox),
          ];
          const [y0, y1] = [
            Math.max(0, y * k + oy),
            Math.min(H, (y + 1) * k + oy),
          ];
          const sum = [0, 0, 0];
          let area = 0;
          for (let Y = Math.floor(y0); Y < y1; Y++)
            for (let X = Math.floor(x0); X < x1; X++) {
              const a =
                (Math.min(X + 1, x1) - Math.max(X, x0)) *
                (Math.min(Y + 1, y1) - Math.max(Y, y0));
              for (let c = 0; c < 3; c++)
                sum[c] += large[(Y * W + X) * 4 + c] * a;
              area += a;
            }
          for (let c = 0; c < 3; c++)
            total += Math.abs(sum[c] / area - small[(y * w + x) * 4 + c]);
        }
      expect(total / (w * h * 3), `seed ${seed}`).toBeLessThan(1.5);
    }
  });
});
