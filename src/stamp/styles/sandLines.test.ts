import { describe, expect, it } from "vitest";
import { NEW_STYLES, pressStampRef, STYLES } from "..";
import { mulberry32 } from "../random";
import { sandCanvas, sprinkle } from "./sandLines";

describe("sand lines 1", () => {
  it("is pressed in the new style set, not the classic one", () => {
    expect(NEW_STYLES.map((s) => s.id)).toContain("sand1");
    expect(STYLES.map((s) => s.id)).not.toContain("sand1");
    const sand = NEW_STYLES.findIndex((s) => s.id === "sand1");
    const ref = pressStampRef(
      NEW_STYLES,
      () => (sand + 0.5) / NEW_STYLES.length,
    );
    expect(ref.source).toBe("sand1");
  });
});

describe("sprinkle", () => {
  const total = (density: Float32Array) => density.reduce((a, b) => a + b, 0);
  // A wavy curve well inside a 1 by 1 art.
  const path = [0.1, 0.5, 0.3, 0.3, 0.5, 0.6, 0.7, 0.4, 0.9, 0.5];

  // The grains a curve gets grow with the pixel count, and each lays down less, so its ink per art area is the
  // same at every size: the sum over pixels scales with the pixel area.
  it.each([40, 160, 640])(
    "lays down the curve's mass at %i px, whatever the grain count",
    (size) => {
      const sand = sandCanvas(size, size, 1);
      sprinkle(sand, mulberry32(1), path, 0.02, 0);
      expect(total(sand.density[0]) / (size * size)).toBeCloseTo(0.02, 4);
    },
  );

  it("keeps each ink's grains apart", () => {
    const sand = sandCanvas(64, 64, 2);
    sprinkle(sand, mulberry32(2), path, 0.01, 1);
    expect(total(sand.density[0])).toBe(0);
    expect(total(sand.density[1]) / (64 * 64)).toBeCloseTo(0.01, 4);
  });
});
