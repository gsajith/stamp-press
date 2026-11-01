import { describe, expect, it } from "vitest";
import { punchGeometry } from ".";

const punch = { pitch: 0.07, notch: 0.02 } as const;

describe("punch geometry", () => {
  it("shapes each aspect with a long side of at most 1", () => {
    const portrait = punchGeometry({ ...punch, aspect: "portrait" });
    const landscape = punchGeometry({ ...punch, aspect: "landscape" });
    const square = punchGeometry({ ...punch, aspect: "square" });
    expect(portrait.height).toBe(1);
    expect(portrait.width).toBeLessThan(1);
    expect([landscape.width, landscape.height]).toEqual([
      portrait.height,
      portrait.width,
    ]);
    expect(square.width).toBe(square.height);
    expect(square.width).toBeLessThan(1);
  });

  it("builds an outline that fills its bounds, bitten notch-deep on every edge", () => {
    const { width, height, outline, inner } = punchGeometry({
      ...punch,
      aspect: "portrait",
    });
    const xs = outline.map(([x]) => x);
    const ys = outline.map(([, y]) => y);
    expect(Math.min(...xs)).toBeCloseTo(-width / 2);
    expect(Math.max(...xs)).toBeCloseTo(width / 2);
    expect(Math.min(...ys)).toBeCloseTo(-height / 2);
    expect(Math.max(...ys)).toBeCloseTo(height / 2);
    // The deepest point of a notch on each edge sits on the inner rectangle.
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    expect(outline.some(([, y]) => near(y, inner.height / 2))).toBe(true);
    expect(outline.some(([, y]) => near(y, -inner.height / 2))).toBe(true);
    expect(outline.some(([x]) => near(x, inner.width / 2))).toBe(true);
    expect(outline.some(([x]) => near(x, -inner.width / 2))).toBe(true);
    expect(inner.width).toBeCloseTo(width - 2 * punch.notch);
  });

  it("cuts more teeth with a finer pitch", () => {
    const coarse = punchGeometry({ ...punch, aspect: "square" });
    const fine = punchGeometry({ ...punch, aspect: "square", pitch: 0.05 });
    expect(fine.outline.length).toBeGreaterThan(coarse.outline.length);
  });
});
