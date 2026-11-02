import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, NEW_STYLES, pressStampRef, resolveStamp, STYLES } from "..";
import { stream } from "../random";
import { fractures, type Pt } from "./fracture";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(
  seed: number,
  width: number,
  height: number,
  source = "crack1",
) {
  const stamp = resolveStamp({ source, seed })!;
  expect(stamp.art.style.id).toBe("crack1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("fracture 1", () => {
  it("is pressed in the new style set, not the classic one", () => {
    expect(NEW_STYLES.map((s) => s.id)).toContain("crack1");
    expect(STYLES.map((s) => s.id)).not.toContain("crack1");
    const crack = NEW_STYLES.findIndex((s) => s.id === "crack1");
    const ref = pressStampRef(
      NEW_STYLES,
      () => (crack + 0.5) / NEW_STYLES.length,
    );
    expect(ref.source).toBe("crack1");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("1a108ac28fae8b61");
    expect(sha(pixels(2, 50, 39))).toBe("90603816531a07f8");
    expect(sha(pixels(3, 44, 44))).toBe("f81f208eb1eba64d");
    expect(sha(pixels(4, 44, 56, "crack1w"))).toBe("4ae617911587d9d7");
    // Desk size.
    expect(sha(pixels(5, 160, 205))).toBe("3195e0795eca58fa");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Portrait, landscape and square. The cracks grow in art units, so only their rasterizing changes with size,
  // and the tinted cells are found again at each size. Draws with a short side under 128 px are supersampled.
  // At desk size the lines are about a pixel wide and a few pixels apart, so pixels stray along them, without
  // any bias.
  it.each([
    [7, 40, 52, 8, 3],
    [8, 52, 40, 8, 3],
    [9, 46, 46, 8, 3],
    [7, 160, 208, 4, 4],
    [8, 208, 160, 4, 4],
    [9, 184, 184, 4, 4],
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

describe("fractures", () => {
  // Where the move from a to b crosses the move from c to d, short of touching.
  const crosses = (a: Pt, b: Pt, c: Pt, d: Pt) => {
    const [ux, uy, vx, vy] = [
      b[0] - a[0],
      b[1] - a[1],
      d[0] - c[0],
      d[1] - c[1],
    ];
    const den = ux * vy - uy * vx;
    if (den === 0) return false;
    const [wx, wy] = [c[0] - a[0], c[1] - a[1]];
    const t = (wx * vy - wy * vx) / den;
    const v = (wx * uy - wy * ux) / den;
    const e = 1e-9;
    return t > e && t < 1 - e && v > e && v < 1 - e;
  };

  it("grows cracks that meet without crossing", () => {
    const rand = stream(1, 1);
    const sources: Pt[] = Array.from({ length: 2000 }, () => [rand(), rand()]);
    const step = 0.006;
    const cracks = fractures(rand, {
      sources,
      blows: [
        { at: [0.5, 0.5], count: 3 },
        { at: [0.2, 0.7], count: 2 },
      ],
      step,
      reach: 14 * step,
      far: 2.6 / step,
      diminish: 0.998,
    });
    const segments = cracks.flatMap((crack, i) =>
      crack.slice(1).map((b, p) => ({ a: crack[p], b, i })),
    );
    expect(cracks.length).toBeGreaterThan(50);
    let crossings = 0;
    for (let s = 0; s < segments.length; s++)
      for (let t = s + 1; t < segments.length; t++) {
        const [p, q] = [segments[s], segments[t]];
        if (p.i !== q.i && crosses(p.a, p.b, q.a, q.b)) crossings++;
      }
    expect(crossings).toBe(0);
  });
});
