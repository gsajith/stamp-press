import { describe, expect, it } from "vitest";
import { CURRENT_SOURCE, proceduralSource, resolveStamp } from ".";

const seeds = Array.from({ length: 300 }, (_, i) => i * 7919 + 1);
const stamps = seeds.map(
  (seed) => resolveStamp({ source: CURRENT_SOURCE, seed })!,
);

describe("resolving a stamp reference", () => {
  it("gives the same stamp for the same reference", () => {
    const ref = { source: CURRENT_SOURCE, seed: 90210 };
    expect(resolveStamp(ref)).toEqual(resolveStamp({ ...ref }));
  });

  it("varies palette, punch and margin across seeds", () => {
    const count = (f: (s: (typeof stamps)[number]) => unknown) =>
      new Set(stamps.map(f)).size;
    expect(count((s) => s.palette.id)).toBeGreaterThan(4);
    expect(count((s) => s.punch.aspect)).toBe(3);
    expect(count((s) => s.punch.pitch)).toBeGreaterThan(100);
    expect(count((s) => s.punch.notch)).toBeGreaterThan(100);
    expect(count((s) => s.margin > 0)).toBe(2);
  });

  it("returns null for an unknown source", () => {
    expect(resolveStamp({ source: "nosuchsource", seed: 1 })).toBeNull();
  });

  it("only picks palettes the style accepts", () => {
    const fussy = {
      id: "fussy-1",
      palettes: ["harbor", "ochre"],
      draw: () => {},
    };
    const source = proceduralSource("test1", [fussy]);
    const picked = new Set(
      seeds.map(
        (seed) => resolveStamp({ source: "test1", seed }, [source])!.palette.id,
      ),
    );
    expect(picked).toEqual(new Set(["harbor", "ochre"]));
  });
});
