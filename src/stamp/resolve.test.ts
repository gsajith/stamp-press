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

  // ADR 0001: a published source keeps resolving a seed to the same stamp. If this fails, restore the old
  // behavior and ship the change as a new source version instead.
  it("resolves procedural1 seeds to the stamps it shipped with", () => {
    const summary = [1, 2, 3].map((seed) => {
      const { art, palette, punch, margin } = resolveStamp({
        source: "procedural1",
        seed,
      })!;
      return [art.style.id, art.seed, palette.id, punch, margin];
    });
    expect(summary).toEqual([
      [
        "landscape-silhouette-1",
        1983344870,
        "riso",
        {
          aspect: "portrait",
          pitch: 0.07300047545926645,
          notch: 0.020526876250019414,
        },
        0.07318961856188252,
      ],
      [
        "landscape-silhouette-1",
        1290762667,
        "harbor",
        {
          aspect: "portrait",
          pitch: 0.0720323305367492,
          notch: 0.026893274029233152,
        },
        0.07723850482143463,
      ],
      [
        "landscape-silhouette-1",
        2075127583,
        "brick",
        {
          aspect: "portrait",
          pitch: 0.08499600142706186,
          notch: 0.02923106451052254,
        },
        0,
      ],
    ]);
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
