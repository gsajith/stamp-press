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
    expect(sha(pixels(1, 39, 50))).toBe("cf24301c349e2798");
    expect(sha(pixels(2, 50, 39))).toBe("921efeb633f82f8d");
    expect(sha(pixels(3, 44, 44))).toBe("b5ed1bd9c7c0099c");
    expect(sha(pixels(4, 44, 56, "crack1w"))).toBe("6416242440aa7a95");
    // Tinted cells: a patch, then cells scattered in one ink.
    expect(sha(pixels(7, 39, 50))).toBe("96d8dd2b30fe8d55");
    expect(sha(pixels(10, 50, 39))).toBe("906b6cd151bdd0e5");
    // Desk size, where nothing is supersampled: lines only, then cells scattered in two inks.
    expect(sha(pixels(5, 160, 205))).toBe("a1d77d8568053c97");
    expect(sha(pixels(14, 205, 160))).toBe("2cbf0ac3b019a43e");
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

  // The detail view rounds each side on its own, so its art's shape is a pixel off the desk's: a portrait art
  // 200x256 on the desk is 1597x2048 in the detail view. Seed 631 once drew unrelated art at these two sizes. Each large pixel falls in the small pixel at the same
  // spot in art units, measured from the art's middle, and the small pixels it fills are compared.
  it.each([
    [7, 200, 256, 1597, 2048],
    [8, 256, 200, 2048, 1597],
    [9, 226, 226, 1805, 1806],
    [10, 172, 228, 1379, 1820],
    [631, 256, 200, 2048, 1597],
  ])("draws seed %i the same at %ix%i as at %ix%i", (seed, w, h, wl, hl) => {
    const small = pixels(seed, w, h);
    const large = pixels(seed, wl, hl);
    const [unit, unitL] = [Math.min(w, h), Math.min(wl, hl)];
    const sums = new Float64Array(w * h * 3);
    const counts = new Float64Array(w * h);
    for (let y = 0; y < hl; y++) {
      const sy = Math.floor(((y + 0.5 - hl / 2) / unitL) * unit + h / 2);
      if (sy < 0 || sy >= h) continue;
      for (let x = 0; x < wl; x++) {
        const sx = Math.floor(((x + 0.5 - wl / 2) / unitL) * unit + w / 2);
        if (sx < 0 || sx >= w) continue;
        const i = sy * w + sx;
        counts[i]++;
        for (let c = 0; c < 3; c++)
          sums[i * 3 + c] += large[(y * wl + x) * 4 + c];
      }
    }
    let [total, n] = [0, 0];
    for (let i = 0; i < w * h; i++) {
      if (counts[i] === 0) continue;
      n++;
      for (let c = 0; c < 3; c++)
        total += Math.abs(sums[i * 3 + c] / counts[i] - small[i * 4 + c]);
    }
    // Mean difference per channel, out of 255.
    expect(total / (n * 3)).toBeLessThan(3);
  });
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
    const cracks = fractures(1, {
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
