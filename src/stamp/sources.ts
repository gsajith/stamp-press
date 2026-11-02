import { PALETTES_1, PALETTES_WADA, type Palette } from "./palettes";
import { pick, randomSeed, subSeed } from "./random";
import type { StampRef } from "./ref";
import { apparatus1 } from "./styles/apparatus";
import { bauhausGrid1 } from "./styles/bauhausGrid";
import { botanicalLSystem1 } from "./styles/botanicalLSystem";
import { contourBands1 } from "./styles/contourBands";
import { crossStitch1 } from "./styles/crossStitch";
import { escherTessellation1 } from "./styles/escherTessellation";
import { fishDrawing1 } from "./styles/fishDrawing";
import { flowLines1 } from "./styles/flowLines";
import { girih1 } from "./styles/girih";
import { guillocheRosette1 } from "./styles/guillocheRosette";
import { halftoneObject1 } from "./styles/halftoneObject";
import { inkLandscape1 } from "./styles/inkLandscape";
import { islandSurvey1 } from "./styles/islandSurvey";
import { isohedralTiling1 } from "./styles/isohedralTiling";
import { landscapeSilhouette1 } from "./styles/landscapeSilhouette";
import { linocut1 } from "./styles/linocut";
import { mathMarbling2 } from "./styles/mathMarbling";
import { midCentury1 } from "./styles/midCentury";
import { nonflowers1 } from "./styles/nonflowers";
import { openPeeps1 } from "./styles/openPeeps";
import { paperDiorama1 } from "./styles/paperDiorama";
import { paperMarbling1 } from "./styles/paperMarbling";
import { philatelicError1 } from "./styles/philatelicError";
import { pixelPlanet1 } from "./styles/pixelPlanet";
import { pixelSprite1 } from "./styles/pixelSprite";
import { plotterHomage1 } from "./styles/plotterHomage";
import { quiltBlocks1 } from "./styles/quiltBlocks";
import { risoOverprint1 } from "./styles/risoOverprint";
import { seashell1 } from "./styles/seashell";
import { skyChart1 } from "./styles/skyChart";
import { specimenDrawer1 } from "./styles/specimenDrawer";
import { steelEngraving1 } from "./styles/steelEngraving";
import { truchetTiles1 } from "./styles/truchetTiles";
import { ukiyoe1 } from "./styles/ukiyoe";

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
  id: string = style.id,
): ArtSource {
  return {
    id,
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
  truchetTiles1,
  botanicalLSystem1,
  guillocheRosette1,
  halftoneObject1,
  midCentury1,
  linocut1,
  skyChart1,
  steelEngraving1,
  paperDiorama1,
  paperMarbling1,
  girih1,
  crossStitch1,
  islandSurvey1,
  philatelicError1,
  seashell1,
  specimenDrawer1,
  ukiyoe1,
  escherTessellation1,
];

// The new style set: generators ported from open-source artists' work (docs/research/open-source-generators.md),
// pressed instead of STYLES when the settings pick it. Same rule as STYLES: add one line per style.
export const NEW_STYLES: readonly Style[] = [
  apparatus1,
  flowLines1,
  pixelPlanet1,
  openPeeps1,
  quiltBlocks1,
  plotterHomage1,
  mathMarbling2,
  contourBands1,
  inkLandscape1,
  fishDrawing1,
  nonflowers1,
  isohedralTiling1,
];

// Style versions no longer pressed. They stay registered so their share links keep working: when a new
// version replaces a style in STYLES or NEW_STYLES, move the old one here.
const RETIRED_STYLES: readonly Style[] = [];

// Which colors a press prints in: PALETTES_1, or Sanzo Wada's combinations.
export type Colors = "original" | "wada";

// A style printed in Wada's palettes is its own source, `<style id>w`, so turning the setting on or off never
// recolors a stamp someone already shared. A style that names the palettes it accepts keeps them.
const wadaId = (style: Style) => `${style.id}w`;
const hasWada = (style: Style) => !style.palettes;

const ALL_STYLES = [...STYLES, ...NEW_STYLES, ...RETIRED_STYLES];
export const SOURCES: readonly ArtSource[] = [
  ...ALL_STYLES.map((style) => styleSource(style)),
  ...ALL_STYLES.filter(hasWada).map((style) =>
    styleSource(style, PALETTES_WADA, wadaId(style)),
  ),
];

// A new press: a style picked at random from `styles`, then a fresh seed that drives the stamp within it.
export function pressStampRef(
  styles: readonly Style[] = STYLES,
  rand: () => number = Math.random,
  colors: Colors = "original",
): StampRef {
  const style = pick(styles, rand);
  const source = colors === "wada" && hasWada(style) ? wadaId(style) : style.id;
  return { source, seed: randomSeed() };
}
