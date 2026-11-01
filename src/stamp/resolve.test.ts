import { describe, expect, it } from "vitest";
import {
  artInset,
  CURRENT_SOURCE,
  proceduralSource,
  punchGeometry,
  resolveStamp,
} from ".";

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

  // The same rule for how those stamps are cut and where their art sits: one seed per aspect, plus a full bleed.
  it("cuts procedural1 stamps the way it shipped", () => {
    const cut = [1, 3, 5, 8].map((seed) => {
      const stamp = resolveStamp({ source: "procedural1", seed })!;
      const { width, height, outline, inner } = punchGeometry(stamp.punch);
      return [
        width,
        height,
        outline.length,
        outline[5],
        inner,
        artInset(stamp),
      ];
    });
    expect(cut).toEqual([
      [
        0.78,
        1,
        454,
        [-0.35454545454545455, -0.4794731237499806],
        { width: 0.7389462474999612, height: 0.9589462474999612 },
        0.09371649481190195,
      ],
      [
        0.78,
        1,
        382,
        [-0.3466666666666667, -0.47076893548947746],
        { width: 0.7215378709789549, height: 0.9415378709789549 },
        0,
      ],
      [
        1,
        0.78,
        418,
        [-0.46153846153846156, -0.36200109099271033],
        { width: 0.9440021819854206, height: 0.7240021819854207 },
        0.08628467258997007,
      ],
      [
        0.88,
        0.88,
        544,
        [-0.4106666666666667, -0.4239721348175655],
        { width: 0.847944269635131, height: 0.847944269635131 },
        0.06914546726347254,
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
