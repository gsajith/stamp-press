import { PALETTES_1, type Palette } from "./palettes";
import { pick, randomSeed, subSeed } from "./random";
import type { StampRef } from "./ref";
import { bauhausGrid1 } from "./styles/bauhausGrid";
import { botanicalLSystem1 } from "./styles/botanicalLSystem";
import { landscapeSilhouette1 } from "./styles/landscapeSilhouette";
import { pixelSprite1 } from "./styles/pixelSprite";
import { risoOverprint1 } from "./styles/risoOverprint";

// A style: one procedural look, drawn by code from a seed and a palette. It draws in resolution-independent
// units, so the same seed at 256 px and 2048 px is the same picture. `id` carries a version: per ADR 0001 a
// published style's output never changes, so a change ships as a new style with a new id.
export type Style = {
  // Lowercase letters then digits-or-letters, no dash, such as `land1`: it's the source id in share links.
  id: string;
  // The ids of the palettes this style accepts. Every palette when absent.
  palettes?: readonly string[];
  draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    seed: number,
    palette: Palette,
  ): void;
};

// Where a stamp's art comes from. It turns a seed into art (a style and the seed that style draws from) and
// owns the palettes its stamps are printed in.
export type ArtSource = {
  id: string;
  palettes: readonly Palette[];
  art(seed: number): { style: Style; seed: number };
};

// The art source for one procedural style: its id is the style's id, and the seed drives the stamp within it.
export function styleSource(
  style: Style,
  palettes: readonly Palette[] = PALETTES_1,
): ArtSource {
  return {
    id: style.id,
    palettes,
    art: (seed) => ({ style, seed: subSeed(seed, 0x2c1b3c6d) }),
  };
}

// The styles a press picks from. To add a style, add one line here and nothing else: a reference names its
// style, so adding one never changes an existing reference's stamp.
export const STYLES: readonly Style[] = [
  landscapeSilhouette1,
  bauhausGrid1,
  pixelSprite1,
  risoOverprint1,
  botanicalLSystem1,
];

// Style versions no longer pressed. They stay registered so their share links keep working: when a new
// version replaces a style in STYLES, move the old one here.
const RETIRED_STYLES: readonly Style[] = [];

export const SOURCES: readonly ArtSource[] = [...STYLES, ...RETIRED_STYLES].map(
  (style) => styleSource(style),
);

// A new press: a style picked at random from `styles`, then a fresh seed that drives the stamp within it.
export function pressStampRef(
  styles: readonly Style[] = STYLES,
  rand: () => number = Math.random,
): StampRef {
  return { source: pick(styles, rand).id, seed: randomSeed() };
}
