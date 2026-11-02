import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, NEW_STYLES, pressStampRef, resolveStamp, STYLES } from "..";
import { streamlines } from "./flowLines";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number, source = "flow1") {
  const stamp = resolveStamp({ source, seed })!;
  expect(stamp.art.style.id).toBe("flow1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("flow lines 1", () => {
  it("is pressed in the new style set, not the classic one", () => {
    expect(NEW_STYLES.map((s) => s.id)).toContain("flow1");
    expect(STYLES.map((s) => s.id)).not.toContain("flow1");
    const flow = NEW_STYLES.findIndex((s) => s.id === "flow1");
    const ref = pressStampRef(
      NEW_STYLES,
      () => (flow + 0.5) / NEW_STYLES.length,
    );
    expect(ref.source).toBe("flow1");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("3b59b15871077f45");
    expect(sha(pixels(2, 50, 39))).toBe("b12c539239a36070");
    expect(sha(pixels(3, 44, 44))).toBe("10a5dff0d5df64c8");
    expect(sha(pixels(4, 44, 56, "flow1w"))).toBe("c743bc0368b58b55");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Portrait, landscape and square. The lines are placed in art units, so only their rasterizing changes with
  // size. A tiny draw packs lines about a pixel apart, which the small draw smears and the large one resolves,
  // so pixels stray more there than at desk size, without any bias.
  it.each([
    [7, 40, 52, 8, 8],
    [8, 52, 40, 8, 8],
    [9, 46, 46, 8, 8],
    [7, 160, 208, 4, 3],
    [8, 208, 160, 4, 3],
    [9, 184, 184, 4, 3],
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

describe("streamlines", () => {
  // A whirlpool around the box's center.
  const swirl = (x: number, y: number): [number, number] => [
    -(y - 0.5),
    x - 0.5,
  ];
  const options = {
    width: 1,
    height: 1,
    dSep: 0.05,
    dTest: 0.02,
    timeStep: 0.01,
    seeds: [[0.7, 0.5] as [number, number]],
  };

  it("keeps lines at least dTest apart", () => {
    const lines = streamlines(swirl, options);
    expect(lines.length).toBeGreaterThan(5);
    const points = lines.flatMap((line, l) =>
      line.map(([x, y]) => ({ x, y, l })),
    );
    let closest = Infinity;
    for (const a of points)
      for (const b of points)
        if (a.l !== b.l)
          closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
    expect(closest).toBeGreaterThan(options.dTest * 0.99);
  });

  it("fills the box with evenly spaced lines", () => {
    const lines = streamlines(swirl, options);
    const points = lines.flat();
    // Every spot of the box, away from the singular center, has a line within about dSep.
    for (let y = 0.05; y < 1; y += 0.1)
      for (let x = 0.05; x < 1; x += 0.1) {
        if (Math.hypot(x - 0.5, y - 0.5) < 0.1) continue;
        const near = Math.min(
          ...points.map(([px, py]) => Math.hypot(px - x, py - y)),
        );
        expect(near).toBeLessThan(options.dSep * 1.5);
      }
  });
});
