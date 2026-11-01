import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawArt, resolveStamp, STYLES } from "..";
import { mulberry32 } from "../random";
import {
  creatureFlow,
  locator,
  type Place,
  TILINGS,
} from "./escherTessellation";

// Draws a stamp's art in Node and returns its RGBA pixels.
function pixels(seed: number, width: number, height: number) {
  const stamp = resolveStamp({ source: "tess1", seed })!;
  expect(stamp.art.style.id).toBe("tess1");
  const ctx = createCanvas(width, height).getContext("2d");
  drawArt(ctx as unknown as CanvasRenderingContext2D, stamp, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

const sha = (data: Uint8ClampedArray) =>
  createHash("sha256").update(data).digest("hex").slice(0, 16);

describe("escher tessellation 1", () => {
  it("is pressed alongside the other styles", () => {
    expect(STYLES.map((s) => s.id)).toContain("tess1");
  });

  // ADR 0001: a published style's output for a seed never changes. If one of these fails, the style's drawing
  // changed: restore it, and ship the change as a new style version instead.
  it("draws the same pixels it shipped with", () => {
    expect(sha(pixels(1, 39, 50))).toBe("dffe74e4d2c1e6ad");
    expect(sha(pixels(2, 50, 39))).toBe("b3227fb50c227e92");
    expect(sha(pixels(3, 44, 44))).toBe("f455df9155e122c1");
    // Large enough not to be supersampled, as at desk size and in the detail view.
    expect(sha(pixels(7, 160, 200))).toBe("5f88e2bf5b8e8758");
  });

  it("draws different art for different seeds", () => {
    const hashes = new Set(
      [10, 11, 12, 13, 14].map((seed) => sha(pixels(seed, 32, 32))),
    );
    expect(hashes.size).toBe(5);
  });

  // Outlines and stripes finer than a pixel have to average out, not alias. Draws with a short side under
  // 160 px are supersampled, so they match closely. Larger ones, like desk stamps, aren't, and stray more.
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

describe("the base tilings", () => {
  // Neighboring creatures print in different inks. A short segment that leaves its tile is bisected down to
  // where it crosses an edge, so the tiles on either side share that edge rather than just a corner, and must
  // get different colors.
  it.each(TILINGS.map((t) => [`${t.lattice} ${t.order}`, t] as const))(
    "never gives neighbors in %s the same color",
    (_, tiling) => {
      const { locate, color } = locator(tiling);
      const rand = mulberry32(7);
      const place = (): Place => ({ i: 0, j: 0, k: 0, x: 0, y: 0 });
      const [a, b, m] = [place(), place(), place()];
      const same = (p: Place, q: Place) =>
        p.i === q.i && p.j === q.j && p.k === q.k;
      let crossings = 0;
      for (let n = 0; n < 4000; n++) {
        let [ax, ay] = [rand() * 6 - 3, rand() * 6 - 3];
        let [bx, by] = [ax + 0.2 * (rand() - 0.5), ay + 0.2 * (rand() - 0.5)];
        locate(ax, ay, a);
        locate(bx, by, b);
        if (same(a, b)) continue;
        for (let step = 0; step < 50; step++) {
          const [mx, my] = [(ax + bx) / 2, (ay + by) / 2];
          locate(mx, my, m);
          if (same(m, a)) [ax, ay] = [mx, my];
          else [bx, by] = [mx, my];
        }
        locate(bx, by, b);
        crossings++;
        expect(color(a)).not.toBe(color(b));
        expect(color(a)).toBeGreaterThanOrEqual(0);
        expect(color(a)).toBeLessThan(tiling.colors);
      }
      expect(crossings).toBeGreaterThan(200);
    },
  );
});

describe("the creature flow", () => {
  // A flow never folds the plane, but its table can if it's too coarse for how hard the flow squeezes: tiles
  // then tear and overlap, with slivers of outline along their edges. The map must keep a positive Jacobian
  // determinant everywhere, checked on a grid finer than the table, at the strongest strength a stamp draws.
  it.each(TILINGS.map((t) => [`${t.lattice} ${t.order}`, t] as const))(
    "never folds the plane in %s",
    (_, tiling) => {
      const [[ax, ay], [bx, by]] =
        tiling.lattice === "square"
          ? [
              [1, 0],
              [0, 1],
            ]
          : [
              [1, 0],
              [0.5, Math.sqrt(3) / 2],
            ];
      const size = Math.sqrt((ax * by - ay * bx) / tiling.order);
      const map = new Float64Array(6);
      const G = 97;
      let folded = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const flow = creatureFlow(tiling, mulberry32(seed), size * 1.8);
        for (let j = 0; j < G; j++)
          for (let i = 0; i < G; i++) {
            flow((i * ax + j * bx) / G, (i * ay + j * by) / G, map);
            if (map[2] * map[5] - map[3] * map[4] <= 0) folded++;
          }
      }
      expect(folded).toBe(0);
    },
  );
});
