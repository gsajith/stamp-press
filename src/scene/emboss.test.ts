import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import type { Punch } from "../stamp";
import { paintEmboss, RIDGE } from "./emboss";

const PUNCH: Punch = { aspect: "landscape", pitch: 0.07, notch: 0.02 };
const SIZE = 400;

// The height map's grey levels along the middle row, left to right.
function middleRow() {
  const ctx = createCanvas(1, 1).getContext("2d");
  paintEmboss(ctx as unknown as CanvasRenderingContext2D, PUNCH, SIZE);
  const { width, height } = ctx.canvas;
  const row = ctx.getImageData(0, Math.floor(height / 2), width, 1).data;
  return { width, height, heights: [...row].filter((_, i) => i % 4 === 0) };
}

describe("emboss", () => {
  it("covers the stamp at the given size", () => {
    const { width, height } = middleRow();
    expect([width, height]).toEqual([400, 312]);
  });

  it("raises a ridge along the cut and leaves the art flat", () => {
    const { width, heights } = middleRow();
    const top = Math.max(...heights);
    const peak = heights.indexOf(top);
    // The ridge stands inside the deepest notch, close to the cut.
    const band = (PUNCH.notch + 3 * RIDGE) * SIZE;
    expect(peak).toBeLessThan(band);
    // It rises from the cut rather than starting at full height.
    expect(heights[Math.ceil(PUNCH.notch * SIZE)]).toBeLessThan(top);
    // The middle, where the art is, sits flat and below the ridge.
    const middle = heights.slice(band, width - band);
    expect(new Set(middle).size).toBe(1);
    expect(middle[0]).toBeLessThan(top);
  });
});
