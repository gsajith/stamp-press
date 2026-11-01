import type { Palette } from "./palettes";
import { type Punch, punchFromRandom } from "./punch";
import { mulberry32, pick } from "./random";
import type { StampRef } from "./ref";
import { type ArtSource, SOURCES, type Style } from "./sources";

// A stamp: its art (a style and the seed it draws from), the palette it's printed in, its punch, and its
// margin, the plain paper between art and punch in stamp units (0 is full bleed).
export type Stamp = {
  ref: StampRef;
  art: { style: Style; seed: number };
  palette: Palette;
  punch: Punch;
  margin: number;
};

// Everything follows from the reference, so the same one always gives the same stamp. Null for an unknown
// source. The draws below are frozen with every published source: append new ones, never reorder.
export function resolveStamp(
  ref: StampRef,
  sources: readonly ArtSource[] = SOURCES,
): Stamp | null {
  const source = sources.find((s) => s.id === ref.source);
  if (!source) return null;
  const rand = mulberry32(ref.seed);
  const art = source.art(ref.seed);
  const accepted = art.style.palettes;
  const palette = pick(
    accepted
      ? source.palettes.filter((p) => accepted.includes(p.id))
      : source.palettes,
    rand,
  );
  const punch = punchFromRandom(rand);
  const margin = rand() < 0.6 ? 0.045 + 0.035 * rand() : 0;
  return { ref, art, palette, punch, margin };
}
