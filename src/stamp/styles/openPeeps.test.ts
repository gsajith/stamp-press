import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, NEW_STYLES, resolveStamp } from "..";
import { polygons } from "./openPeeps";
import { ACCESSORIES, BODY, FACES, FACIAL_HAIR, HEADS } from "./openPeepsParts";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number) {
  const stamp = resolveStamp({ source: "peep1", seed })!;
  expect(stamp.art.style.id).toBe("peep1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("open peeps 1", () => {
  it("is pressed in the new style set", () => {
    expect(NEW_STYLES.map((s) => s.id)).toContain("peep1");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("06c0f34e0aeccdbf");
    expect(sha(pixels(2, 50, 39))).toBe("b250ab3a1780d79c");
    expect(sha(pixels(3, 44, 44))).toBe("e854d694ca7e19c2");
    // Desk size, which takes fewer sample rows a pixel.
    expect(sha(pixels(2, 200, 256))).toBe("2422ad0d97fb8c1f");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Lines thinner than a pixel have to average out, not alias. Each shape is painted over the ones below it, so
  // where two share an edge a tiny draw blends them a little differently than the large one does, which is
  // most of the 40 px draw's difference. A desk-size draw matches closely.
  it.each([
    [40, 52, 8, 2.5],
    [200, 256, 4, 1],
  ])("draws the same picture at %ix%i as %i times larger", (w, h, k, bound) => {
    for (const seed of [4, 5, 6, 7, 8, 9]) {
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

  // The part data is frozen, so a command the parser can't read would only show up when a seed picks that part.
  it("reads every Open Peeps part", () => {
    const parts = [HEADS, FACES, FACIAL_HAIR, ACCESSORIES].flatMap((group) =>
      group.flatMap(([, paths]) => paths),
    );
    for (const [, , d] of [...BODY, ...parts]) {
      const values = polygons(d, 0.5).flat();
      expect(values.length).toBeGreaterThan(0);
      // Every point lands near the 704 unit view box, which a misread number or command would throw off.
      expect(Math.min(...values)).toBeGreaterThan(-400);
      expect(Math.max(...values)).toBeLessThan(1400);
    }
  });

  // Minified paths run arc flags together, as in "0 01" here.
  it("flattens arcs onto their circle", () => {
    for (const d of ["M0 0a10 10 0 0 1 20 0Z", "M0 0a10 10 0 0120 0Z"]) {
      const [p] = polygons(d, 0.01);
      expect(p.length).toBeGreaterThan(20);
      for (let k = 0; k < p.length; k += 2) {
        expect(Math.hypot(p[k] - 10, p[k + 1])).toBeCloseTo(10, 1);
        // Sweep flag 1 runs clockwise on screen, through y = -10.
        expect(p[k + 1]).toBeLessThanOrEqual(1e-9);
      }
    }
  });
});
