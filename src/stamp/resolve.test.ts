import { describe, expect, it } from "vitest";
import {
  artInset,
  formatStampRef,
  PALETTES_WADA,
  parseStampRef,
  pressStampRef,
  punchGeometry,
  resolveStamp,
  SOURCES,
  STYLES,
  styleSource,
  type Style,
} from ".";

const seeds = Array.from({ length: 300 }, (_, i) => i * 7919 + 1);
const stamps = seeds.map((seed) => resolveStamp({ source: "land1", seed })!);
const testStyle = (id: string): Style => ({ id, draw: () => {} });

describe("resolving a stamp reference", () => {
  it("gives the same stamp for the same reference", () => {
    const ref = { source: "land1", seed: 90210 };
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

  it("resolves each registered style as its own source", () => {
    for (const style of STYLES)
      expect(resolveStamp({ source: style.id, seed: 7 })!.art.style).toBe(
        style,
      );
  });

  // Retired styles included. A duplicate id would send one style's links to the other's art, and an id outside
  // the reference grammar would give links that don't parse.
  it("registers every source under a unique id that round-trips", () => {
    const ids = SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const source of ids) {
      const ref = { source, seed: 7 };
      expect(parseStampRef(formatStampRef(ref))).toEqual(ref);
    }
  });

  it("keeps every existing reference's stamp when a style is added", () => {
    const refs = [1, 2, 3, 90210, 0xffffffff].map((seed) => ({
      source: "land1",
      seed,
    }));
    const before = refs.map((ref) => resolveStamp(ref));
    const more = [...SOURCES, styleSource(testStyle("extra1"))];
    expect(refs.map((ref) => resolveStamp(ref, more))).toEqual(before);
  });

  // ADR 0001: a published style keeps resolving a seed to the same stamp. If this fails, restore the old
  // behavior and ship the change as a new style version instead.
  it("resolves land1 seeds to the stamps it shipped with", () => {
    const summary = [1, 2, 3].map((seed) => {
      const { art, palette, punch, margin } = resolveStamp({
        source: "land1",
        seed,
      })!;
      return [art.style.id, art.seed, palette.id, punch, margin];
    });
    expect(summary).toEqual([
      [
        "land1",
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
        "land1",
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
        "land1",
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
  it("cuts land1 stamps the way it shipped", () => {
    const cut = [1, 3, 5, 8].map((seed) => {
      const stamp = resolveStamp({ source: "land1", seed })!;
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
    const fussy = { ...testStyle("fussy1"), palettes: ["harbor", "ochre"] };
    const source = styleSource(fussy);
    const picked = new Set(
      seeds.map(
        (seed) =>
          resolveStamp({ source: "fussy1", seed }, [source])!.palette.id,
      ),
    );
    expect(picked).toEqual(new Set(["harbor", "ochre"]));
  });
});

describe("pressing a stamp", () => {
  const styles = ["a1", "b1", "c1"].map(testStyle);

  it("picks a style from the current list with its own randomness", () => {
    expect(pressStampRef(styles, () => 0).source).toBe("a1");
    expect(pressStampRef(styles, () => 0.5).source).toBe("b1");
    expect(pressStampRef(styles, () => 0.99).source).toBe("c1");
  });

  it("draws a fresh seed independent of the style", () => {
    const presses = Array.from({ length: 20 }, () =>
      pressStampRef(styles, () => 0),
    );
    expect(new Set(presses.map((r) => r.seed)).size).toBe(20);
  });

  it("presses the registered styles by default", () => {
    const ids = STYLES.map((s) => s.id);
    expect(ids).toContain(pressStampRef().source);
  });
});

describe("Wada colors", () => {
  const styles = ["a1"].map(testStyle);

  it("presses a style's Wada source when the setting is on", () => {
    expect(pressStampRef(styles, () => 0, "wada").source).toBe("a1w");
    expect(pressStampRef(styles, () => 0, "original").source).toBe("a1");
  });

  it("prints a Wada source in Wada's palettes and keeps the same art", () => {
    for (const seed of [1, 2, 3, 90210]) {
      const original = resolveStamp({ source: "land1", seed })!;
      const wada = resolveStamp({ source: "land1w", seed })!;
      expect(PALETTES_WADA).toContain(wada.palette);
      expect(wada.art).toEqual(original.art);
    }
  });

  it("keeps a style that names its palettes in them", () => {
    const fussy = { ...testStyle("fussy1"), palettes: ["harbor"] };
    expect(pressStampRef([fussy], () => 0, "wada").source).toBe("fussy1");
  });
});
