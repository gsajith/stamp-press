import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import {
  artInset,
  drawArt,
  NEW_STYLES,
  PALETTES_WADA,
  punchGeometry,
  resolveStamp,
} from "..";
import { gridSize } from "./pixelPlanet";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(
  seed: number,
  width: number,
  height: number,
  source = "planet1",
) {
  const stamp = resolveStamp({ source, seed })!;
  expect(stamp.art.style.id).toBe("planet1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("pixel planet 1", () => {
  it("is pressed in the new style set, in both colors", () => {
    expect(NEW_STYLES.map((s) => s.id)).toContain("planet1");
    const ids = PALETTES_WADA.map((p) => p.id);
    expect(ids).toContain(
      resolveStamp({ source: "planet1w", seed: 1 })!.palette.id,
    );
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("ce27dc96bbaca364");
    expect(sha(pixels(2, 50, 39))).toBe("c6932c93849f9359");
    expect(sha(pixels(3, 44, 44))).toBe("9bac3d35389a5bb1");
    // Seeds 1, 2, 3, 6, 7 and 21 draw lava, ringed, ice, asteroid, gas and terran planets.
    expect(sha(pixels(6, 39, 50))).toBe("db09b626e57024d8");
    expect(sha(pixels(21, 39, 50))).toBe("f5d425b1f5941a19");
    // Desk size, where each grid cell is about two pixels.
    expect(sha(pixels(7, 160, 200))).toBe("ef59df964f8f6b2e");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Every pixel is the exact area-weighted mix of the grid cells it covers, so a large draw averaged down is
  // the small draw, up to rounding.
  it.each([
    [40, 52, 8],
    [200, 256, 4],
  ])("draws the same picture at %ix%i as %i times larger", (w, h, k) => {
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
      expect(total / (w * h * 3)).toBeLessThan(1);
    }
  });

  // drawFace rounds the art's size differently on the desk (256 px per stamp unit) and in the detail view (2048),
  // so the grid has to come out the same from both, and cover the art.
  it("lays out the same grid on the desk and in the detail view", () => {
    for (let seed = 0; seed < 500; seed++) {
      const stamp = resolveStamp({ source: "planet1", seed })!;
      const { width, height } = punchGeometry(stamp.punch);
      const [desk, detail] = [256, 2048].map((scale) => {
        const inset = 2 * Math.round(artInset(stamp) * scale);
        const [w, h] = [
          Math.round(width * scale) - inset,
          Math.round(height * scale) - inset,
        ];
        const [cols, rows] = gridSize(w, h);
        const cell = Math.min(w, h) / 100;
        expect(cols * cell).toBeGreaterThanOrEqual(w);
        expect(rows * cell).toBeGreaterThanOrEqual(h);
        return [cols, rows];
      });
      expect(detail).toEqual(desk);
    }
  });
});
