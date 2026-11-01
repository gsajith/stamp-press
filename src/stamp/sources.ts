import { PALETTES_1, type Palette } from "./palettes";
import { pick, stream, subSeed } from "./random";
import { landscapeSilhouette1 } from "./styles/landscapeSilhouette";

// A style: one procedural look, drawn by code from a seed and a palette. It draws in resolution-independent
// units, so the same seed at 256 px and 2048 px is the same picture. `id` carries a version: per ADR 0001 a
// published style's output never changes, so a change ships as a new style with a new id.
export type Style = {
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

// The procedural art source: the seed picks one of `styles`. A version's lists are frozen, since adding a style
// or palette would change which stamp an existing seed resolves to. Ship new styles and palettes as a new
// version, such as `procedural2`, and keep the old one registered so its share links keep working.
export function proceduralSource(
  id: string,
  styles: readonly Style[],
  palettes: readonly Palette[] = PALETTES_1,
): ArtSource {
  return {
    id,
    palettes,
    art: (seed) => ({
      style: pick(styles, stream(seed, 0x51ed270b)),
      seed: subSeed(seed, 0x2c1b3c6d),
    }),
  };
}

export const SOURCES: readonly ArtSource[] = [
  proceduralSource("procedural1", [landscapeSilhouette1]),
];
// The source new presses draw from: the newest procedural version.
export const CURRENT_SOURCE = "procedural1";
