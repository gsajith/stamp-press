import { atan2, cos, sin } from "../exact";
import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";
import { CHARGES, type ChargePart } from "./coatOfArmsCharges";

// Coat of arms: one shield on the paper, its field divided, an ordinary and charges laid on it in tinctures
// from the palette. A port of Azgaar's Armoria (github.com/Azgaar/Armoria), which its README licenses under
// MIT. Armoria has no LICENSE file, so the notice below is MIT's, with the author Armoria names:
//
//   MIT License
//
//   Copyright (c) Azgaar
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.
//
// The charges are only Armoria's CC0 ones (coatOfArmsCharges.ts). Its other charges, many from WappenWiki under
// CC BY-NC-SA, are left out.
//
// The generator follows Armoria's generator.js draw for draw: the same odds for a division, an ordinary and a
// charge, the same placement tables and the rule of tincture, in Armoria's own 200-unit space. What changed:
// - Random draws come from our seeded stream instead of a patched Math.random.
// - Tinctures come from the palette. The paper and any light ink are the metals, the other inks the colours,
//   with the darkest ink as sable. Armoria's stains have no palette color and are left out.
// - Charge categories hold only the CC0 charges: conventional ones and crosses, as in Armoria, and the
//   figurative CC0 charges pooled into one category (`figures`), since most of Armoria's categories keep one or
//   two charges at most.
// - Two of Armoria's branches can't run, since they test values the generator never sets (a coat-wide `line`,
//   and a bordure position spelled without its J). They're left out.
// - The shield comes from Armoria's heraldic shield types: basic, regional, historical and specific shapes, at
//   its odds. Banners, simple and fantasy shapes are left out.
// - Flat tinctures, without Armoria's gloss gradient, like a print. Charges keep Armoria's dark outline, never
//   finer than LINE, so it holds at desk size.
//
// The drawing computes every pixel itself, so its pixels match in every browser and in Node (ADR 0001). It
// flattens the SVG paths into polygons and fills each with a scanline rasterizer like peep1's: exact coverage
// across each sample row, several rows per pixel. Armoria's clip paths become coverage masks, and strokes
// become polygons. Only IEEE-exact arithmetic here; arcs and rotations use exact.ts.

type Rgb = [number, number, number];
type Weights = Record<string, number>;

// An Armoria division or ordinary: its SVG snippet, the snippet with a partition line when it takes one, and
// where charges go on it, off it, or in the fields it makes.
type Template = {
  template?: string;
  templateLined?: (line: string) => string;
  line?: Weights;
  positions?: Weights;
  positionsOn?: Weights;
  positionsOff?: Weights;
};

// The data below is Armoria's dataModel.js and ordinaries.js as it stands. Charge positions by kind of charge,
// as strings of position letters with their odds.
const POSITIONS: Record<string, Weights> = {
  conventional: {
    e: 20,
    abcdefgzi: 3,
    beh: 3,
    behdf: 2,
    acegi: 1,
    kn: 3,
    bhdf: 1,
    jeo: 1,
    abc: 3,
    jln: 6,
    jlh: 3,
    kmo: 2,
    jleh: 1,
    def: 3,
    abcpqh: 4,
    ABCDEFGHIJKL: 1,
  },
  complex: {
    e: 40,
    beh: 1,
    kn: 1,
    jeo: 1,
    abc: 2,
    jln: 7,
    jlh: 2,
    def: 1,
    abcpqh: 1,
  },
  inescutcheon: { e: 4, jln: 1 },
};

// Partition lines, as a strip across the 200-unit space that templates turn and place.
const LINES: { variants: Weights; data: Record<string, string> } = {
  variants: {
    straight: 50,
    wavy: 8,
    engrailed: 4,
    invecked: 3,
    rayonne: 3,
    embattled: 1,
    raguly: 1,
    urdy: 1,
    dancetty: 1,
    indented: 2,
    dentilly: 1,
    bevilled: 1,
    angled: 1,
    flechy: 1,
    barby: 1,
    enclavy: 1,
    escartely: 1,
    arched: 2,
    archedReversed: 1,
    nowy: 1,
    nowyReversed: 1,
    embattledGhibellin: 1,
    embattledNotched: 1,
    embattledGrady: 1,
    dovetailedIndented: 1,
    dovetailed: 1,
    potenty: 1,
    potentyDexter: 1,
    potentySinister: 1,
    nebuly: 2,
    seaWaves: 1,
    dragonTeeth: 1,
    firTrees: 1,
  },
  data: {
    straight: "m 0,115 v -15 h 200 v 15",
    engrailed: `m 0,115 v -20 ${"a 6.25,6.25 0 0 0 12.5,0".repeat(16)} v 20`,
    invecked: `m 0,115 v -12.5 ${"a 6.25,6.25 0 0 1 12.5,0".repeat(16)} v 12.5`,
    embattled: `m 0,115 v -10 h 2.5 ${"v -10 h 15 v 10 h 15".repeat(6)} v -10 h 15 v 10 h 2.5 v 10`,
    wavy: `m 0,115 v -15 ${"c 8.9,-3.5 16,-3.1 25,0 8.9,3.5 16,3.1 25,0 8.9,-3.5 16,-3.2 25,0 8.9,3.5 16,3.2 25,0".repeat(2)} v 15`,
    raguly: `m 0,115 v -20 h 7 ${"l -5,10 h 10 l 5,-10 h 10".repeat(9)} l -5,10 h 10 l 5,-10 h 3 v 20`,
    dancetty: `m 0,115 v -10 l 10,-15 ${"l 15,20 15,-20".repeat(6)} l 10,15 v 10`,
    dentilly: `m 0,115 v -20 ${"l 10,10 v -10".repeat(19)} l 10,10 v 10`,
    angled: "m 0,115 v -20 h 100 v 10 h 100 v 10",
    urdy: `m 0,115 v -25 ${"l 5,5 v 10 l 5,5 5,-5 v -10 l 5,-5".repeat(3)} l 5,5 v 10 l 5,6 5,-6 v -10 l 5,-5 ${"l 5,5 v 10 l 5,5 5,-5 v -10 l 5,-5".repeat(2)} l 5,5 v 10 l 5,6 5,-6 v -10 l 5,-5 ${"l 5,5 v 10 l 5,5 5,-5 v -10 l 5,-5".repeat(3)} v 25`,
    indented: `m 0,115 v -20 ${"l 5,10 5,-10".repeat(20)} v 20`,
    bevilled: "m 0,115 v -22.5 h 110 l -20,15 h 110 v 7.5",
    nowy: "m 0,115 v -20 h 80 c 0,0 0.1,20.1 20,20 19.9,-0.1 20,-20 20,-20 h 80 v 20",
    nowyReversed:
      "m 0,115 v -10 h 80 c 0,0 0.1,-20.1 20,-20 19.9,0.1 20,20 20,20 h 80 v 10",
    potenty: `m 0,115 v -10 ${"h 7.5 v -5 h -5 v -5 h 15 v 5 h -5 v 5 h 7.5".repeat(10)} v 10`,
    potentyDexter: `m 0,115 v -20 h 3 ${"v 10 h 10 v -5 h -5 v -5 h 10".repeat(13)} v 10 h 2 v 20`,
    potentySinister: `m 0,115 v -10 h 2.5 ${"v -10 h 10 v 5 h -5 v 5 h 10".repeat(13)} v -10 h 2.5 v 20`,
    embattledGhibellin: `m 0,115 v -15 ${"l 5,-5 v 10 l 5,-5 5,5 V 95 l 5,5".repeat(10)} v 15`,
    embattledNotched: `m 0,115 v -10 ${"h 5 v -10 l 5,5 5,-5 v 10".repeat(13)} h 5 v 10`,
    embattledGrady: `m 0,115 v -20 ${"h 2.5 v 5 h 5 v 5 h 5 v -5 h 5 v -5 h 2.5".repeat(10)} v 20`,
    dovetailed: `m 0,115 v -20 ${"h 7 l -4,10 h 14 l -4,-10 h 7".repeat(10)} v 20`,
    dovetailedIndented: `m 0,115 v -15 ${"l 7,-5 -4,10 7,-5 7,5 -4,-10 7,5".repeat(10)} v 15`,
    nebuly: `m 0,115 v -10.1 h 2.35 ${"c 4,0 7.3,-2 7.3,-4.5 0,-1.2 -0.7,-2.3 -1.9,-3 -1.2,-0.8 -1.8,-1.9 -1.8,-3.1 0,-2.5 3.2,-4.5 7.2,-4.5 4.1,0 7.3,2 7.3,4.5 0,1.2 -0.7,2.3 -1.8,3.1 -1.2,0.7 -1.9,1.8 -1.9,3 0,2.5 3.3,4.5 7.3,4.5".repeat(9)} h 2.35 v 10.1`,
    rayonne: `m 0,115 v -5 ${"a9 9 0 003.1-4.6c.5-2 .4-3.9-.3-5.4-.7-1.5-.8-3.4-.3-5.4.5-2 1.7-3.6 3.1-4.6-.7 1.5-.8 3.4-.3 5.4.5 2 1.7 3.6 3.1 4.6a9 9 0 013.1 4.6c.5 2 .4 3.9-.3 5.4".repeat(17)} a9 9 0 003.1-4.6c.5-2 .4-3.9-.3-5.4-.7-1.5-.8-3.4-.3-5.4.5-2 1.7-3.6 3.1-4.6-.7 1.5-.8 3.4-.3 5.4.75 2.79 2.72 4.08 4.3 5.67 V 115`,
    seaWaves: `m 0,115 v -14.89 ${"c 1.59,-2.01 4.5,-5.18 8.74,-5.18 2.26,0 4.12,1.54 4.45,3.55 -0.57,-0.31 -1.23,-0.48 -1.93,-0.48 -2.16,0 -3.91,1.63 -3.91,3.64 0,2.01 1.75,3.64 3.91,3.64 4.25,0 7.16,-3.17 8.74,-5.18".repeat(10)} v 14.89`,
    dragonTeeth: `m 0,115 v -5.7 c 0,-2.7 2.4,4.2 3.9,5.7 ${"c -1.5,-4.6 -1.9,-10.3 -0.8,-16.2 1.1,-5.9 3.5,-10.7 6.3,-13.8 -1.5,4.6 -1.9,10.3 -0.8,16.2 1.1,5.9 3.5,10.7 6.4,13.8".repeat(17)} c -1.5,-4.6 -1.9,-10.3 -0.8,-16.2 1.1,-5.9 3.5,-10.7 6.3,-13.8 -1.5,4.6 -1.9,10.3 -0.8,16.2 0.6,2.9 1.5,5.6 2.7,8 v 5.7`,
    firTrees: `m 0,115 v -15 l 2,-3.5 -2,0.5 4,-7 ${"l 4,7 -2,-0.5 4,7 -2,-0.5 4,7 4,-7 -2,0.5 4,-7 -2,0.5 4,-7".repeat(12)} 4,7 -2,-0.5 2,3.5 v 15`,
    flechy: "m 0,115 v -15 h 85 l 15,-15 15,15 h 85 v 15",
    barby: "m 0,115 v -15 h 85 l 15,15 15,-15 h 85 v 15",
    enclavy: "m 0,115 v -15 H 85 V 85 h 30 v 15 h 85 v 15",
    escartely: "m 0,115 v -15 h 85 v 15 h 30 v -15 h 85 v 15",
    arched: "m 0,115 c 0,0 60,-19.8 100,-20 c 40,-0.2 100,20 100,20",
    archedReversed:
      "m 0,115 v -30 c 0,0 60,20.2 100,20 40,-0.2 100,-20 100,-20 v 30",
  },
};

// Patterns as SVG pattern tiles in two tinctures, c1 and c2, scaled by size.
const PATTERNS: Record<
  string,
  (p: string, c1: string, c2: string, size: number, chargeId?: string) => string
> = {
  semy: (p, c1, c2, size, chargeId) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 25}" viewBox="0 0 200 200" patternUnits="userSpaceOnUse" stroke="#000"><rect width="200" height="200" fill="${c1}" stroke="none"/><g fill="${c2}"><use transform="translate(-100 -50)" href="#${chargeId}"/><use transform="translate(100 -50)" href="#${chargeId}"/><use transform="translate(0 50)" href="#${chargeId}"/></g></pattern>`,
  vair: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 50}" viewBox="0 0 25 50" patternUnits="userSpaceOnUse" stroke="#000" stroke-width=".2"><rect width="25" height="25" fill="${c1}" stroke="none"/><path d="m12.5,0 l6.25,6.25 v12.5 l6.25,6.25 h-25 l6.25,-6.25 v-12.5 z" fill="${c2}"/><rect x="0" y="25" width="25" height="25" fill="${c2}" stroke="none"/><path d="m25,25 l-6.25,6.25 v12.5 l-6.25,6.25 l-6.25,-6.25 v-12.5 l-6.25,-6.25 z" fill="${c1}"/><path d="M0 50 h25" fill="none"/></pattern>`,
  counterVair: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 50}" viewBox="0 0 25 50" patternUnits="userSpaceOnUse" stroke="#000" stroke-width=".2"><rect width="25" height="50" fill="${c2}" stroke="none"/><path d="m 12.5,0 6.25,6.25 v 12.5 L 25,25 18.75,31.25 v 12.5 L 12.5,50 6.25,43.75 V 31.25 L 0,25 6.25,18.75 V 6.25 Z" fill="${c1}"/></pattern>`,
  vairInPale: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 25}" viewBox="0 0 25 25" patternUnits="userSpaceOnUse"><rect width="25" height="25" fill="${c1}"/><path d="m12.5,0 l6.25,6.25 v12.5 l6.25,6.25 h-25 l6.25,-6.25 v-12.5 z" fill="${c2}" stroke="#000" stroke-width=".2"/></pattern>`,
  vairEnPointe: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 50}" viewBox="0 0 25 50" patternUnits="userSpaceOnUse"><rect width="25" height="25" fill="${c2}"/><path d="m12.5,0 l6.25,6.25 v12.5 l6.25,6.25 h-25 l6.25,-6.25 v-12.5 z" fill="${c1}"/><rect x="0" y="25" width="25" height="25" fill="${c1}" stroke-width="1" stroke="${c1}"/><path d="m12.5,25 l6.25,6.25 v12.5 l6.25,6.25 h-25 l6.25,-6.25 v-12.5 z" fill="${c2}"/></pattern>`,
  vairAncien: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 25}" viewBox="0 0 100 100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="${c1}"/><path fill="${c2}" stroke="none" d="m 0,90 c 10,0 25,-5 25,-40 0,-25 10,-40 25,-40 15,0 25,15 25,40 0,35 15,40 25,40 v 10 H 0 Z"/><path fill="none" stroke="#000" d="M 0,90 c 10,0 25,-5 25,-40 0,-35 15,-40 25,-40 10,0 25,5 25,40 0,35 15,40 25,40 M0,100 h100"/></pattern>`,
  potent: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 25}" viewBox="0 0 200 200" patternUnits="userSpaceOnUse" stroke="#000"><rect width="200" height="100" fill="${c1}" stroke="none"/><rect y="100" width="200" height="100" fill="${c2}" stroke="none"/><path d="m25 50h50v-50h50v50h50v50h-150z" fill="${c2}"/><path d="m25 100v50h50v50h50v-50h50v-50z" fill="${c1}"/><path d="m0 0h200 M0 100h200" fill="none"/></pattern>`,
  counterPotent: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 25}" viewBox="0 0 200 200" patternUnits="userSpaceOnUse" stroke="none"><rect width="200" height="200" fill="${c1}"/><path d="m25 50h50v-50h50v50h50v100h-50v50h-50v-50h-50v-50z" fill="${c2}"/><path d="m0 0h200 M0 100h200 M0 200h200"/></pattern>`,
  potentInPale: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 12.5}" viewBox="0 0 200 100" patternUnits="userSpaceOnUse" stroke-width="1"><rect width="200" height="100" fill="${c1}" stroke="none"/><path d="m25 50h50v-50h50v50h50v50h-150z" fill="${c2}" stroke="#000"/><path d="m0 0h200 M0 100h200" fill="none" stroke="#000"/></pattern>`,
  potentEnPointe: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 25}" viewBox="0 0 200 200" patternUnits="userSpaceOnUse" stroke="none"><rect width="200" height="200" fill="${c1}"/><path d="m0 0h25v50h50v50h50v-50h50v-50h25v100h-25v50h-50v50h-50v-50h-50v-50h-25v-100" fill="${c2}"/></pattern>`,
  ermine: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 25}" viewBox="0 0 200 200" patternUnits="userSpaceOnUse" fill="${c2}"><rect width="200" height="200" fill="${c1}"/><g stroke="none" fill="${c2}"><g transform="translate(-100 -50)"><path d="m100 81.1c-4.25 17.6-12.7 29.8-21.2 38.9 3.65-0.607 7.9-3.04 11.5-5.47-2.42 4.86-4.86 8.51-7.3 12.7 1.82-0.607 6.07-4.86 12.7-10.9 1.21 8.51 2.42 17.6 4.25 23.6 1.82-5.47 3.04-15.2 4.25-23.6 3.65 3.65 7.3 7.9 12.7 10.9l-7.9-13.3c3.65 1.82 7.9 4.86 11.5 6.07-9.11-9.11-17-21.2-20.6-38.9z"/><path d="m82.4 81.7c-0.607-0.607-6.07 2.42-9.72-4.25 7.9 6.68 15.2-7.3 21.8 1.82 1.82 4.25-6.68 10.9-12.1 2.42z"/><path d="m117 81.7c0.607-1.21 6.07 2.42 9.11-4.86-7.3 7.3-15.2-7.3-21.2 2.42-1.82 4.25 6.68 10.9 12.1 2.42z"/><path d="m101 66.5c-1.02-0.607 3.58-4.25-3.07-8.51 5.63 7.9-10.2 10.9-1.54 17.6 3.58 2.42 12.2-2.42 4.6-9.11z"/></g><g transform="translate(100 -50)"><path d="m100 81.1c-4.25 17.6-12.7 29.8-21.2 38.9 3.65-0.607 7.9-3.04 11.5-5.47-2.42 4.86-4.86 8.51-7.3 12.7 1.82-0.607 6.07-4.86 12.7-10.9 1.21 8.51 2.42 17.6 4.25 23.6 1.82-5.47 3.04-15.2 4.25-23.6 3.65 3.65 7.3 7.9 12.7 10.9l-7.9-13.3c3.65 1.82 7.9 4.86 11.5 6.07-9.11-9.11-17-21.2-20.6-38.9z"/><path d="m82.4 81.7c-0.607-0.607-6.07 2.42-9.72-4.25 7.9 6.68 15.2-7.3 21.8 1.82 1.82 4.25-6.68 10.9-12.1 2.42z"/><path d="m117 81.7c0.607-1.21 6.07 2.42 9.11-4.86-7.3 7.3-15.2-7.3-21.2 2.42-1.82 4.25 6.68 10.9 12.1 2.42z"/><path d="m101 66.5c-1.02-0.607 3.58-4.25-3.07-8.51 5.63 7.9-10.2 10.9-1.54 17.6 3.58 2.42 12.2-2.42 4.6-9.11z"/></g><g transform="translate(0 50)"><path d="m100 81.1c-4.25 17.6-12.7 29.8-21.2 38.9 3.65-0.607 7.9-3.04 11.5-5.47-2.42 4.86-4.86 8.51-7.3 12.7 1.82-0.607 6.07-4.86 12.7-10.9 1.21 8.51 2.42 17.6 4.25 23.6 1.82-5.47 3.04-15.2 4.25-23.6 3.65 3.65 7.3 7.9 12.7 10.9l-7.9-13.3c3.65 1.82 7.9 4.86 11.5 6.07-9.11-9.11-17-21.2-20.6-38.9z"/><path d="m82.4 81.7c-0.607-0.607-6.07 2.42-9.72-4.25 7.9 6.68 15.2-7.3 21.8 1.82 1.82 4.25-6.68 10.9-12.1 2.42z"/><path d="m117 81.7c0.607-1.21 6.07 2.42 9.11-4.86-7.3 7.3-15.2-7.3-21.2 2.42-1.82 4.25 6.68 10.9 12.1 2.42z"/><path d="m101 66.5c-1.02-0.607 3.58-4.25-3.07-8.51 5.63 7.9-10.2 10.9-1.54 17.6 3.58 2.42 12.2-2.42 4.6-9.11z"/></g></g></pattern>`,
  chequy: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 50}" height="${size * 50}" viewBox="0 0 50 50" patternUnits="userSpaceOnUse" fill="${c2}"><rect width="50" height="50"/><rect width="25" height="25" fill="${c1}"/><rect x="25" y="25" width="25" height="25" fill="${c1}"/></pattern>`,
  lozengy: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 25}" viewBox="0 0 50 50" patternUnits="userSpaceOnUse"><rect width="50" height="50" fill="${c1}"/><polygon points="25,0 50,25 25,50 0,25" fill="${c2}"/></pattern>`,
  fusily: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 50}" viewBox="0 0 50 100" patternUnits="userSpaceOnUse"><rect width="50" height="100" fill="${c2}"/><polygon points="25,0 50,50 25,100 0,50" fill="${c1}"/></pattern>`,
  pally: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 100}" height="${size * 25}" viewBox="0 0 100 25" patternUnits="userSpaceOnUse"><rect width="100" height="25" fill="${c2}"/><rect x="25" y="0" width="25" height="25" fill="${c1}"/><rect x="75" y="0" width="25" height="25" fill="${c1}"/></pattern>`,
  barry: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 100}" viewBox="0 0 25 100" patternUnits="userSpaceOnUse"><rect width="25" height="100" fill="${c2}"/><rect x="0" y="25" width="25" height="25" fill="${c1}"/><rect x="0" y="75" width="25" height="25" fill="${c1}"/></pattern>`,
  gemelles: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 25}" viewBox="0 0 50 50" patternUnits="userSpaceOnUse"><rect width="50" height="50" fill="${c1}"/><rect y="5" width="50" height="10" fill="${c2}"/><rect y="40" width="50" height="10" fill="${c2}"/></pattern>`,
  bendy: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 100}" height="${size * 100}" viewBox="0 0 100 100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="${c1}"/><polygon points="0,25 75,100 25,100 0,75" fill="${c2}"/><polygon points="25,0 75,0 100,25 100,75" fill="${c2}"/></pattern>`,
  bendySinister: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 100}" height="${size * 100}" viewBox="0 0 100 100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="${c2}"/><polygon points="0,25 25,0 75,0 0,75" fill="${c1}"/><polygon points="25,100 100,25 100,75 75,100" fill="${c1}"/></pattern>`,
  palyBendy: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 125.16}" height="${size * 71.52}" viewBox="0 0 175 100" patternUnits="userSpaceOnUse"><rect y="0" x="0" width="175" height="100" fill="${c2}"/><g fill="${c1}"><path d="m0 20 35 30v50l-35-30z"/><path d="m35 0 35 30v50l-35-30z"/><path d="m70 0h23l12 10v50l-35-30z"/><path d="m70 80 23 20h-23z"/><path d="m105 60 35 30v10h-35z"/><path d="m105 0h35v40l-35-30z"/><path d="m 140,40 35,30 v 30 h -23 l -12,-10z"/><path d="M 175,0 V 20 L 152,0 Z"/></g></pattern>`,
  barryBendy: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 71.44}" height="${size * 125.02}" viewBox="0 0 100 175" patternUnits="userSpaceOnUse"><rect width="100" height="175" fill="${c2}"/><g fill="${c1}"><path d="m20 0 30 35h50l-30-35z"/><path d="m0 35 30 35h50l-30-35z"/><path d="m0 70v23l10 12h50l-30-35z"/><path d="m80 70 20 23v-23z"/><path d="m60 105 30 35h10v-35z"/><path d="m0 105v35h40l-30-35z"/><path d="m 40,140 30,35 h 30 v -23 l -10,-12 z"/><path d="m0 175h20l-20-23z"/></g></pattern>`,
  pappellony: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 25}" viewBox="0 0 100 100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="${c1}"/><circle cx="0" cy="51" r="45" stroke="${c2}" fill="${c1}" stroke-width="10"/><circle cx="100" cy="51" r="45" stroke="${c2}" fill="${c1}" stroke-width="10"/><circle cx="50" cy="1" r="45" stroke="${c2}" fill="${c1}" stroke-width="10"/></pattern>`,
  pappellony2: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 25}" viewBox="0 0 100 100" patternUnits="userSpaceOnUse" stroke="#000" stroke-width="2"><rect width="100" height="100" fill="${c1}" stroke="none"/><circle cy="50" r="49" fill="${c2}"/><circle cx="100" cy="50" r="49" fill="${c2}"/><circle cx="50" cy="0" r="49" fill="${c1}"/></pattern>`,
  scaly: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 25}" viewBox="0 0 100 100" patternUnits="userSpaceOnUse" stroke="#000"><rect width="100" height="100" fill="${c1}" stroke="none"/><path d="M 0,84 C -40,84 -50,49 -50,49 -50,79 -27,99 0,99 27,99 50,79 50,49 50,49 40,84 0,84 Z" fill="${c2}"/><path d="M 100,84 C 60,84 50,49 50,49 c 0,30 23,50 50,50 27,0 50,-20 50,-50 0,0 -10,35 -50,35 z" fill="${c2}"/><path d="M 50,35 C 10,35 0,0 0,0 0,30 23,50 50,50 77,50 100,30 100,0 100,0 90,35 50,35 Z" fill="${c2}"/></pattern>`,
  plumetty: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 50}" viewBox="0 0 50 100" patternUnits="userSpaceOnUse" stroke-width=".8"><rect width="50" height="100" fill="${c2}" stroke="none"/><path fill="${c1}" stroke="none" d="M 25,100 C 44,88 49.5,74 50,50 33.5,40 25,25 25,4e-7 25,25 16.5,40 0,50 0.5,74 6,88 25,100 Z"/><path fill="none" stroke="${c2}" d="m17 40c5.363 2.692 10.7 2.641 16 0m-19 7c7.448 4.105 14.78 3.894 22 0m-27 7c6-2 10.75 3.003 16 3 5.412-0.0031 10-5 16-3m-35 9c4-7 12 3 19 2 7 1 15-9 19-2m-35 6c6-2 11 3 16 3s10-5 16-3m-30 7c8 0 8 3 14 3s7-3 14-3m-25 8c7.385 4.048 14.72 3.951 22 0m-19 8c5.455 2.766 10.78 2.566 16 0m-8 6v-78"/><g fill="none" stroke="${c1}"><path d="m42 90c2.678 1.344 5.337 2.004 8 2m-11 5c3.686 2.032 7.344 3.006 10.97 3m0.0261-1.2e-4v-30"/><path d="m0 92c2.689 0.0045 5.328-0.6687 8-2m-8 10c3.709-0.0033 7.348-1.031 11-3m-11 3v-30"/><path d="m0 7c5.412-0.0031 10-5 16-3m-16 11c7 1 15-9 19-2m-19 9c5 0 10-5 16-3m-16 10c6 0 7-3 14-3m-14.02 11c3.685-0.002185 7.357-1.014 11.02-3m-11 10c2.694-0.01117 5.358-0.7036 7.996-2m-8 6v-48"/><path d="m34 4c6-2 10.75 3.003 16 3m-19 6c4-7 12 3 19 2m-16 4c6-2 11 3 16 3m-14 4c8 0 8 3 14 3m-11 5c3.641 1.996 7.383 2.985 11 3m-8 5c2.762 1.401 5.303 2.154 8.002 2.112m-0.00154 3.888v-48"/></g></pattern>`,
  masoned: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 25}" height="${size * 25}" viewBox="0 0 100 100" patternUnits="userSpaceOnUse" fill="none"><rect width="100" height="100" fill="${c1}"/><rect width="100" height="50" stroke="${c2}" stroke-width="4"/><line x1="50" y1="50" x2="50" y2="100" stroke="${c2}" stroke-width="5"/></pattern>`,
  fretty: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 40}" height="${size * 40}" viewBox="0 0 140 140" patternUnits="userSpaceOnUse" stroke="#000" stroke-width="2"><rect width="140" height="140" fill="${c1}" stroke="none"/><path d="m-15 5 150 150 20-20-150-150z" fill="${c2}"/><path d="m10 150 140-140-20-20-140 140z" fill="${c2}" stroke="none"/><path d="m0 120 20 20 120-120-20-20z" fill="none"/></pattern>`,
  grillage: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 50}" height="${size * 50}" viewBox="0 0 200 200" patternUnits="userSpaceOnUse" stroke="#000" stroke-width="2"><rect width="200" height="200" fill="${c1}" stroke="none"/><path d="m205 65v-30h-210v30z" fill="${c2}"/><path d="m65-5h-30v210h30z" fill="${c2}"/><path d="m205 165v-30h-210v30z" fill="${c2}"/><path d="m165,65h-30v140h30z" fill="${c2}"/><path d="m 165,-5h-30v40h30z" fill="${c2}"/></pattern>`,
  chainy: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 33.4}" height="${size * 33.4}" viewBox="0 0 200 200" patternUnits="userSpaceOnUse" stroke="#000" stroke-width="2"><rect x="-6.691e-6" width="200" height="200" fill="${c1}" stroke="none"/><path d="m155-5-20-20-160 160 20 20z" fill="${c2}"/><path d="m45 205 160-160 20 20-160 160z" fill="${c2}"/><path d="m45-5 20-20 160 160-20 20-160-160" fill="${c2}"/><path d="m-5 45-20 20 160 160 20-20-160-160" fill="${c2}"/></pattern>`,
  maily: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 33.4}" height="${size * 33.4}" viewBox="0 0 200 200" patternUnits="userSpaceOnUse" stroke="#000" stroke-width="1.2"><path fill="${c1}" stroke="none" d="M0 0h200v200H0z"/><g fill="${c2}"><path d="m80-2c-5.27e-4 2.403-0.1094 6.806-0.3262 9.199 5.014-1.109 10.1-1.768 15.19-2.059 0.09325-1.712 0.1401-5.426 0.1406-7.141z"/><path d="m100 5a95 95 0 0 0-95 95 95 95 0 0 0 95 95 95 95 0 0 0 95-95 95 95 0 0 0-95-95zm0 15a80 80 0 0 1 80 80 80 80 0 0 1-80 80 80 80 0 0 1-80-80 80 80 0 0 1 80-80z"/><path d="m92.8 20.33c-5.562 0.4859-11.04 1.603-16.34 3.217-7.793 25.31-27.61 45.12-52.91 52.91-5.321 1.638-10.8 2.716-16.34 3.217-2.394 0.2168-6.796 0.3256-9.199 0.3262v15c1.714-4.79e-4 5.429-0.04737 7.141-0.1406 5.109-0.2761 10.19-0.9646 15.19-2.059 36.24-7.937 64.54-36.24 72.47-72.47z"/><path d="m202 80c-2.403-5.31e-4 -6.806-0.1094-9.199-0.3262 1.109 5.014 1.768 10.1 2.059 15.19 1.712 0.09326 5.426 0.1401 7.141 0.1406z"/><path d="m179.7 92.8c-0.4859-5.562-1.603-11.04-3.217-16.34-25.31-7.793-45.12-27.61-52.91-52.91-1.638-5.321-2.716-10.8-3.217-16.34-0.2168-2.394-0.3256-6.796-0.3262-9.199h-15c4.8e-4 1.714 0.0474 5.429 0.1406 7.141 0.2761 5.109 0.9646 10.19 2.059 15.19 7.937 36.24 36.24 64.54 72.47 72.47z"/><path d="m120 202c5.3e-4 -2.403 0.1094-6.806 0.3262-9.199-5.014 1.109-10.1 1.768-15.19 2.059-0.0933 1.712-0.1402 5.426-0.1406 7.141z"/><path d="m107.2 179.7c5.562-0.4859 11.04-1.603 16.34-3.217 7.793-25.31 27.61-45.12 52.91-52.91 5.321-1.638 10.8-2.716 16.34-3.217 2.394-0.2168 6.796-0.3256 9.199-0.3262v-15c-1.714 4.7e-4 -5.429 0.0474-7.141 0.1406-5.109 0.2761-10.19 0.9646-15.19 2.059-36.24 7.937-64.54 36.24-72.47 72.47z"/><path d="m -2,120 c 2.403,5.4e-4 6.806,0.1094 9.199,0.3262 -1.109,-5.014 -1.768,-10.1 -2.059,-15.19 -1.712,-0.0933 -5.426,-0.1402 -7.141,-0.1406 z"/><path d="m 20.33,107.2 c 0.4859,5.562 1.603,11.04 3.217,16.34 25.31,7.793 45.12,27.61 52.91,52.91 1.638,5.321 2.716,10.8 3.217,16.34 0.2168,2.394 0.3256,6.796 0.3262,9.199 L 95,202 c -4.8e-4,-1.714 -0.0472,-5.44 -0.1404,-7.152 -0.2761,-5.109 -0.9646,-10.19 -2.059,-15.19 -7.937,-36.24 -36.24,-64.54 -72.47,-72.47 z"/></g></pattern>`,
  honeycombed: (p, c1, c2, size) =>
    `<pattern id="${p}" width="${size * 28.6}" height="${size * 49.028}" viewBox="0 0 70 120" patternUnits="userSpaceOnUse"><rect width="70" height="120" fill="${c1}"/><path d="M 70,0 V 20 L 35,40 m 35,80 V 100 L 35,80 M 0,120 V 100 L 35,80 V 40 L 0,20 V 0" stroke="${c2}" fill="none" stroke-width="3"/></pattern>`,
};

// Divisions of the field: the division part's clip path, plain or along a line.
const DIVISIONS: { variants: Weights; data: Record<string, Template> } = {
  variants: {
    perPale: 25,
    perFess: 25,
    perBend: 10,
    perBendSinister: 5,
    perChevron: 5,
    perChevronReversed: 5,
    perCross: 25,
    perPile: 5,
    perSaltire: 5,
    gyronnyOfSixPerFess: 1,
    gyronnyOfSixPerPale: 1,
    gyronny: 5,
    gyronnyOfTenPerFess: 1,
    gyronnyOfTenPerPale: 1,
    gyronnyOfTwelve: 1,
    chevronny: 5,
  },
  data: {
    chevronny: {
      template: `<path d="M0,80 100,-15 200,80 200,120 100,25 0,120z M0,160 100,65 200,160 200,200 100,105 0,200z M0,240 100,145 200,240 0,240z"/>`,
    },
    gyronny: {
      template: `<polygon points="0,0 200,200 200,100 0,100"/><polygon points="200,0 0,200 100,200 100,0"/>`,
    },
    gyronnyOfSixPerFess: {
      template: `<polygon points="0,100 200,100 200,200 157.7,200 42.3,0 157.7,0 42.3,200 0,200"/>`,
    },
    gyronnyOfSixPerPale: {
      template: `<polygon points="100,0 100,200 200,200 200,157.7 0,42.3 0,157.7 200,42.3 200,0"/>`,
    },
    gyronnyOfTenPerFess: {
      template: `<polygon points="0,100 200,100 200,27.3 0,172.7 0,200 67.5,200 132.5,0 67.5,0 132.5,200 200,200 200,172.7 0,27.3"/>`,
    },
    gyronnyOfTenPerPale: {
      template: `<polygon points="100,0 100,200 27.3,200 172.7,0 200,0 200,67.5 0,132.5 0,67.5 200,132.5 200,200 172.7,200 27.3,0"/>`,
    },
    gyronnyOfTwelve: {
      template: `<polygon points="100,0 100,200 157.7,200 42.3,0"/><polygon points="0,100 200,100 200,157.7 0,42.3"/><polygon points="0,157.7 0,200 42.3,200 157.7,0 200,0 200,42.3"/>`,
    },
    perBend: {
      template: `<polygon points="0,0 200,200 0,200"/>`,
      templateLined: (line) =>
        `<path d="${line} V200 H0 Z" transform="translate(-10 -10) rotate(45 110 110) scale(1.1)"/>`,
      positions: { e: 5, lm: 5, bcfdgh: 1 },
    },
    perBendSinister: {
      template: `<polygon points="200,0 0,200 200,200"/>`,
      templateLined: (line) =>
        `<path d="${line} V200 H0 Z" transform="translate(-10 -10) rotate(-45 110 110) scale(1.1)"/>`,
      positions: { e: 1, jo: 1 },
    },
    perChevron: {
      template: `<polygon points="0,200 100,100 200,200"/>`,
      templateLined: (line) =>
        `<path d="${line} L100,200 Z" transform="translate(129 71) rotate(-45 -100 100) scale(-1 1)"/><path d="${line} L100,200 Z" transform="translate(71 71) rotate(45 100 100)"/>`,
      positions: { e: 1, jlh: 1, dfk: 1, dfbh: 2, bdefh: 1 },
    },
    perChevronReversed: {
      template: `<polygon points="0,0 100,100 200,0"/>`,
      templateLined: (line) =>
        `<path d="${line} L100,200 Z" transform="translate(-70.7 -70.7) rotate(225 100 100)"/><path d="${line} L100,200 Z" transform="translate(270.7 -70.7) rotate(-225 -100 100) scale(-1 1)"/>`,
      positions: { e: 1, mok: 2, dfh: 2, dfbh: 1, bdefh: 1 },
    },
    perCross: {
      template: `<rect x="100" y="0" width="100" height="100"/><rect x="0" y="100" width="100" height="100"/>`,
      templateLined: (line) =>
        `<path d="${line} V400 H0 Z" transform="translate(0 50) scale(.5)"/><path d="${line} V400 H0 Z" transform="translate(200 150) scale(-.5)"/>`,
      positions: { e: 4, jlmo: 1, j: 1, jo: 2, jl: 1 },
      line: {
        straight: 20,
        wavy: 5,
        engrailed: 4,
        invecked: 3,
        rayonne: 1,
        embattled: 1,
        raguly: 1,
        urdy: 1,
        indented: 2,
        dentilly: 1,
        bevilled: 1,
        angled: 1,
        embattledGhibellin: 1,
        embattledGrady: 1,
        dovetailedIndented: 1,
        dovetailed: 1,
        potenty: 1,
        potentyDexter: 1,
        potentySinister: 1,
        nebuly: 1,
      },
    },
    perFess: {
      template: `<rect x="0" y="100" width="200" height="100"/>`,
      templateLined: (line) => `<path d="${line} V200 H0 Z"/>`,
      positions: {
        e: 12,
        kn: 4,
        jkl: 2,
        gizgiz: 1,
        jlh: 3,
        kmo: 1,
        ABCDEFGHIJKL: 1,
      },
    },
    perPale: {
      template: `<rect x="100" y="0" width="100" height="200"/>`,
      templateLined: (line) =>
        `<path d="${line} V200 H0 Z" transform="rotate(-90 100 100)"/>`,
      positions: { e: 15, pq: 5, jo: 2, jl: 2, ABCDEFGHIJKL: 1 },
    },
    perPile: {
      template: `<polygon points="0,0 15,0 100,200 185,0 200,0 200,200 0,200"/>`,
      templateLined: (line) =>
        `<path d="${line} V200 H0 Z" transform="translate(161.66 10) rotate(66.66 -100 100) scale(-1 1)"/><path d="${line} V200 H0 Z" transform="translate(38.33 10) rotate(-66.66 100 100)"/>`,
      positions: { ee: 3, be: 2, abceh: 1, abcabc: 1, jleh: 1 },
    },
    perSaltire: {
      template: `<polygon points="0,0 0,200 200,0 200,200"/>`,
      positions: { bhdf: 8, e: 3, abcdefgzi: 1, bh: 1, df: 1, ABCDEFGHIJKL: 1 },
    },
  },
};

// Ordinaries, plain or lined, as SVG snippets. The bordure and orle are strokes of the shield, drawn apart.
const ORDINARIES: {
  lined: Weights;
  straight: Weights;
  data: Record<string, Template>;
} = {
  lined: {
    pale: 7,
    fess: 5,
    bend: 3,
    bendSinister: 2,
    chief: 5,
    bar: 2,
    gemelle: 1,
    fessCotissed: 1,
    fessDoubleCotissed: 1,
    bendlet: 2,
    bendletSinister: 1,
    terrace: 3,
    cross: 6,
    crossParted: 1,
    saltire: 2,
    saltireParted: 1,
  },
  straight: {
    bordure: 8,
    orle: 4,
    mount: 1,
    point: 2,
    flaunches: 1,
    gore: 1,
    gyron: 1,
    quarter: 1,
    canton: 2,
    pall: 3,
    pallReversed: 2,
    chevron: 4,
    chevronReversed: 3,
    pile: 2,
    pileInBend: 2,
    pileInBendSinister: 1,
    piles: 1,
    pilesInPoint: 2,
    label: 1,
  },
  data: {
    bar: {
      template: `<rect x="0" y="87.5" width="200" height="25"/>`,
      templateLined: (line) =>
        `<path d="${line}" transform="translate(0,-12.5)"/><path d="${line}" transform="translate(0,12.5) rotate(180.00001 100 100)"/><rect x="0" y="94" width="200" height="12" stroke="none"/>`,
      positionsOn: { defdefdef: 1 },
      positionsOff: { abc: 2, abcgzi: 1, jlh: 5, bgi: 2, ach: 1 },
    },
    bend: {
      template: `<polygon points="35,0 200,165 200,200 165,200 0,35 0,0"/>`,
      templateLined: (line) =>
        `<path d="${line}" transform="translate(8 -18) rotate(45 110 100) scale(1.1 1)"/><path d="${line}" transform="translate(-28 18) rotate(225 110 100) scale(1.1 1)"/><rect x="0" y="88" width="200" height="24" transform="translate(-10 0) rotate(45 110 100) scale(1.1 1)" stroke="none"/>`,
      positionsOn: { ee: 2, jo: 1, joe: 1 },
      positionsOff: { ccg: 2, ccc: 1 },
    },
    bendSinister: {
      template: `<polygon points="0,165 165,0 200,0 200,35 35,200 0,200"/>`,
      templateLined: (line) =>
        `<path d="${line}" transform="translate(-28 -18) rotate(-45 110 100) scale(1.1 1)"/><path d="${line}" transform="translate(8 18) rotate(-225 110 100) scale(1.1 1)"/><rect x="0" y="88" width="200" height="24" transform="translate(-10 0) rotate(-45 110 100) scale(1.1 1)" stroke="none"/>`,
      positionsOn: { ee: 1, lm: 1, lem: 4 },
      positionsOff: { aai: 2, aaa: 1 },
    },
    bendlet: {
      template: `<polygon points="22,0 200,178 200,200 178,200 0,22 0,0"/>`,
      templateLined: (line) =>
        `<path d="${line}" transform="translate(2 -12) rotate(45 110 100) scale(1.1 1)"/><path d="${line}" transform="translate(-22 12) rotate(225 110 100) scale(1.1 1)"/><rect x="0" y="94" width="200" height="12" transform="translate(-10 0) rotate(45 110 100) scale(1.1 1)" stroke="none"/>`,
      positionsOn: { joejoejoe: 1 },
      positionsOff: { ccg: 2, ccc: 1 },
    },
    bendletSinister: {
      template: `<polygon points="0,178 178,0 200,0 200,22 22,200 0,200"/>`,
      templateLined: (line) =>
        `<path d="${line}" transform="translate(-22 -12) rotate(-45 110 100) scale(1.1 1)"/><path d="${line}" transform="translate(2 12) rotate(-225 110 100) scale(1.1 1)"/><rect x="0" y="94" width="200" height="12" transform="translate(-10 0) rotate(-45 110 100) scale(1.1 1)" stroke="none"/>`,
      positionsOn: { lemlemlem: 1 },
      positionsOff: { aai: 2, aaa: 1 },
    },
    bordure: {
      positionsOn: { ABCDEFGHIJKL: 1 },
      positionsOff: { e: 4, jleh: 2, kenken: 1, peqpeq: 1 },
    },
    canton: {
      template: `<rect width="75" height="75"/>`,
      positionsOn: { yyyy: 1 },
      positionsOff: { e: 5, beh: 1, def: 1, bdefh: 1, kn: 1 },
    },
    chevron: {
      template: `<polygon points="0,125 100,60 200,125 200,165 100,100 0,165"/>`,
      positionsOn: { ach: 3, hhh: 1 },
    },
    chevronReversed: {
      template: `<polygon points="0,75 100,140 200,75 200,35 100,100 0,35"/>`,
      positionsOff: { bbb: 1 },
    },
    chief: {
      template: `<rect width="200" height="75"/>`,
      templateLined: (line) =>
        `<path d="${line}" transform="translate(0,-25) rotate(180.00001 100 100)"/><rect width="200" height="62" stroke="none"/>`,
      positionsOn: { abc: 5, bbb: 1 },
      positionsOff: { emo: 2, emoz: 1, ez: 2 },
    },
    cross: {
      template: `<polygon points="85,0 85,85 0,85 0,115 85,115 85,200 115,200 115,115 200,115 200,85 115,85 115,0"/>`,
      templateLined: (line) =>
        `<path d="${line}" transform="translate(0 -14.5)"/><path d="${line}" transform="rotate(180 100 100) translate(0 -14.5)"/><path d="${line}" transform="rotate(-90 100 100) translate(0 -14.5)"/><path d="${line}" transform="rotate(-270 100 100) translate(0 -14.5)"/>`,
      positionsOn: { eeee: 1, behdfbehdf: 3, behbehbeh: 2 },
      positionsOff: { acgi: 1 },
    },
    crossParted: {
      template: `<path d="M 80 0 L 80 80 L 0 80 L 0 95 L 80 95 L 80 105 L 0 105 L 0 120 L 80 120 L 80 200 L 95 200 L 95 120 L 105 120 L 105 200 L 120 200 L 120 120 L 200 120 L 200 105 L 120 105 L 120 95 L 200 95 L 200 80 L 120 80 L 120 0 L 105 0 L 105 80 L 95 80 L 95 0 L 80 0 z M 95 95 L 105 95 L 105 105 L 95 105 L 95 95 z"/>`,
      templateLined: (line) =>
        `<path d="${line}" transform="translate(0 -20)"/><path d="${line}" transform="rotate(180 100 100) translate(0 -20)"/><path d="${line}" transform="rotate(-90 100 100) translate(0 -20)"/><path d="${line}" transform="rotate(-270 100 100) translate(0 -20)"/>`,
      positionsOn: { e: 5, ee: 1 },
    },
    fess: {
      template: `<rect x="0" y="75" width="200" height="50"/>`,
      templateLined: (line) =>
        `<path d="${line}" transform="translate(0 -25)"/><path d="${line}" transform="translate(0 25) rotate(180 100 100)"/><rect x="0" y="88" width="200" height="24" stroke="none"/>`,
      positionsOn: { ee: 1, def: 3 },
      positionsOff: { abc: 3, abcz: 1 },
    },
    fessCotissed: {
      template: `<rect x="0" y="67" width="200" height="8"/><rect x="0" y="83" width="200" height="34"/><rect x="0" y="125" width="200" height="8"/>`,
      templateLined: (line) =>
        `<path d="${line}" transform="translate(0 15) scale(1 .5)"/><path d="${line}" transform="translate(0 85) rotate(180 100 50) scale(1 .5)"/><rect x="0" y="80" width="200" height="40"/>`,
      positionsOn: { ee: 1, def: 3 },
    },
    fessDoubleCotissed: {
      template: `<rect x="0" y="60" width="200" height="7.5"/><rect x="0" y="72.5" width="200" height="7.5"/><rect x="0" y="85" width="200" height="30"/><rect x="0" y="120" width="200" height="7.5"/><rect x="0" y="132.5" width="200" height="7.5"/>`,
      templateLined: (line) =>
        `<rect x="0" y="85" width="200" height="30"/><rect x="0" y="72.5" width="200" height="7.5"/><rect x="0" y="120" width="200" height="7.5"/><path d="${line}" transform="translate(0 10) scale(1 .5)"/><path d="${line}" transform="translate(0 90) rotate(180 100 50) scale(1 .5)"/>`,
      positionsOn: { ee: 1, defdef: 3 },
    },
    flaunches: {
      template: `<path d="M0,0 q120,100 0,200 M200,0 q-120,100 0,200"/>`,
      positionsOff: { e: 3, kn: 1, beh: 3 },
    },
    gemelle: {
      template: `<rect x="0" y="76" width="200" height="16"/><rect x="0" y="108" width="200" height="16"/>`,
      templateLined: (line) =>
        `<path d="${line}" transform="translate(0,-22.5)"/><path d="${line}" transform="translate(0,22.5) rotate(180.00001 100 100)"/>`,
      positionsOff: { abc: 1 },
    },
    gore: {
      template: `<path d="M20,0 Q30,75 100,100 Q80,150 100,200 L0,200 L0,0 Z"/>`,
    },
    gyron: {
      template: `<polygon points="0,0 100,100 0,100"/>`,
      positionsOff: { bh: 1 },
    },
    label: {
      template: `<path d="m 46,54.8 6.6,-15.6 95.1,0 5.9,15.5 -16.8,0.1 4.5,-11.8 L 104,43 l 4.3,11.9 -16.8,0 4.3,-11.8 -37.2,0 4.5,11.8 -16.9,0 z"/>`,
      positionsOff: { defgzi: 2, eh: 3, defdefhmo: 1, egiegi: 1, pqn: 5 },
    },
    mount: {
      template: `<path d="m0,250 a100,100,0,0,1,200,0"/>`,
      positionsOff: { e: 5, def: 1, bdf: 3 },
    },
    orle: {
      positionsOff: { e: 4, jleh: 1, kenken: 1, peqpeq: 1 },
    },
    pale: {
      template: `<rect x="75" y="0" width="50" height="200"/>`,
      templateLined: (line) =>
        `<path d="${line}" transform="rotate(-90 100 100) translate(0 -25)"/><path d="${line}" transform="rotate(90 100 100) translate(0 -25)"/><rect x="88" y="0" width="24" height="200" stroke="none"/>`,
      positionsOn: { ee: 12, beh: 10, kn: 3, bb: 1 },
      positionsOff: { yyy: 1 },
    },
    pall: {
      template: `<polygon points="0,0 30,0 100,70 170,0 200,0 200,30 122,109 122,200 78,200 78,109 0,30"/>`,
      positionsOn: { ee: 1, jleh: 5, jlhh: 3 },
      positionsOff: { BCKFEILGJbdmfo: 1 },
    },
    pallReversed: {
      template: `<polygon points="0,200 0,170 78,91 78,0 122,0 122,91 200,170 200,200 170,200 100,130 30,200"/>`,
      positionsOn: { ee: 1, bemo: 5 },
      positionsOff: { aczac: 1 },
    },
    pile: {
      template: `<polygon points="70,0 100,175 130,0"/>`,
      positionsOn: { bbb: 1 },
      positionsOff: { acdfgi: 1, acac: 1 },
    },
    pileInBend: {
      template: `<polygon points="200,200 200,144 25,25 145,200"/>`,
      positionsOn: { eeee: 1, eeoo: 1 },
      positionsOff: { cg: 1 },
    },
    pileInBendSinister: {
      template: `<polygon points="0,200 0,144 175,25 55,200"/>`,
      positionsOn: { eeee: 1, eemm: 1 },
      positionsOff: { ai: 1 },
    },
    piles: {
      template: `<polygon points="46,0 75,175 103,0"/><polygon points="95,0 125,175 154,0"/>`,
    },
    pilesInPoint: {
      template: `<path d="M15,0 100,200 60,0Z M80,0 100,200 120,0Z M140,0 100,200 185,0Z"/>`,
    },
    point: {
      template: `<path d="M0,200 Q80,180 100,135 Q120,180 200,200"/>`,
      positionsOff: { e: 2, def: 1, bdf: 3, acbdef: 1 },
    },
    quarter: {
      template: `<rect width="100" height="100"/>`,
      positionsOn: { jjj: 1 },
      positionsOff: { e: 1 },
    },
    saltire: {
      template: `<path d="M 0,21 79,100 0,179 0,200 21,200 100,121 179,200 200,200 200,179 121,100 200,21 200,0 179,0 100,79 21,0 0,0 Z"/>`,
      templateLined: (line) =>
        `<path d="${line}" transform="translate(0 -10) rotate(45 110 100) scale(1.1 1)"/><path d="${line}" transform="translate(-20 10) rotate(225 110 100) scale(1.1 1)"/><path d="${line}" transform="translate(-20 -10) rotate(-45 110 100) scale(1.1 1)"/><path d="${line}" transform="translate(0 10) rotate(-225 110 100) scale(1.1 1)"/>`,
      positionsOn: { ee: 5, jlemo: 1 },
    },
    saltireParted: {
      template: `<path d="M 7 0 L 89 82 L 82 89 L 0 7 L 0 28 L 72 100 L 0 172 L 0 193 L 82 111 L 89 118 L 7 200 L 28 200 L 100 128 L 172 200 L 193 200 L 111 118 L 118 111 L 200 193 L 200 172 L 128 100 L 200 28 L 200 7 L 118 89 L 111 82 L 193 0 L 172 0 L 100 72 L 28 0 L 7 0 z M 100 93 L 107 100 L 100 107 L 93 100 L 100 93 z"/>`,
      templateLined: (line) =>
        `<path d="${line}" transform="translate(3 -13) rotate(45 110 100) scale(1.1 1)"/><path d="${line}" transform="translate(-23 13) rotate(225 110 100) scale(1.1 1)"/><path d="${line}" transform="translate(-23 -13) rotate(-45 110 100) scale(1.1 1)"/><path d="${line}" transform="translate(3 13) rotate(-225 110 100) scale(1.1 1)"/>`,
      positionsOn: { e: 5, ee: 1 },
    },
    terrace: {
      template: `<rect x="0" y="145" width="200" height="55"/>`,
      templateLined: (line) =>
        `<path d="${line}" transform="translate(0,50)"/><rect x="0" y="164" width="200" height="36" stroke="none"/>`,
      positionsOff: { e: 5, def: 1, bdf: 3 },
    },
  },
};

// Armoria's heraldic shield types and the shields in each, with their odds.
const SHIELD_TYPES = { basic: 10, regional: 2, historical: 1, specific: 1 };
const SHIELD_GROUPS: Record<string, Weights> = {
  basic: { heater: 12, spanish: 6, french: 1 },
  regional: { horsehead: 1, horsehead2: 1, polish: 1, hessen: 1, swiss: 1 },
  historical: {
    boeotian: 1,
    roman: 2,
    kite: 1,
    oldFrench: 5,
    renaissance: 2,
    baroque: 2,
  },
  specific: { targe: 1, pavise: 5, wedged: 10, embowed: 1 },
};

type Shield = {
  path: string;
  size?: number;
  positions?: Record<string, readonly [number, number]>;
};

// Each shield's path in the 200-unit space, its charge size factor when not 1, and its charge positions
// relative to the middle. A shield without positions uses the Spanish shield's.
const SHIELDS: Record<string, Shield> = {
  heater: {
    path: "m25,25 h150 v50 a150,150,0,0,1,-75,125 a150,150,0,0,1,-75,-125 v-50 z",
    positions: {
      a: [-43.75, -50],
      b: [0, -50],
      c: [43.75, -50],
      d: [-43.75, 0],
      e: [0, 0],
      f: [43.75, 0],
      g: [-32.25, 37.5],
      h: [0, 50],
      i: [32.25, 37.5],
      y: [-50, -50],
      z: [0, 62.5],
      j: [-37.5, -37.5],
      k: [0, -37.5],
      l: [37.5, -37.5],
      m: [-30, 30],
      n: [0, 42.5],
      o: [30, 30],
      p: [-37.5, 0],
      q: [37.5, 0],
      A: [-66.2, -66.6],
      B: [-22, -66.6],
      C: [22, -66.6],
      D: [66.2, -66.6],
      K: [-66.2, -20],
      E: [66.2, -20],
      J: [-55.5, 26],
      F: [55.5, 26],
      I: [-33, 62],
      G: [33, 62],
      H: [0, 89.5],
    },
  },
  spanish: {
    path: "m25,25 h150 v100 a75,75,0,0,1,-150,0 v-100 z",
    positions: {
      a: [-43.75, -50],
      b: [0, -50],
      c: [43.75, -50],
      d: [-43.75, 0],
      e: [0, 0],
      f: [43.75, 0],
      g: [-43.75, 50],
      h: [0, 50],
      i: [43.75, 50],
      y: [-50, -50],
      z: [0, 50],
      j: [-37.5, -37.5],
      k: [0, -37.5],
      l: [37.5, -37.5],
      m: [-37.5, 37.5],
      n: [0, 37.5],
      o: [37.5, 37.5],
      p: [-37.5, 0],
      q: [37.5, 0],
      A: [-66.2, -66.6],
      B: [-22, -66.6],
      C: [22, -66.6],
      D: [66.2, -66.6],
      K: [-66.4, -20],
      E: [66.4, -20],
      J: [-66.4, 26],
      F: [66.4, 26],
      I: [-49, 70],
      G: [49, 70],
      H: [0, 92],
    },
  },
  french: {
    path: "m 25,25 h 150 v 139.15 c 0,41.745 -66,18.15 -75,36.3 -9,-18.15 -75,5.445 -75,-36.3 v-139.15 z",
    positions: {
      a: [-43.75, -50],
      b: [0, -50],
      c: [43.75, -50],
      d: [-43.75, 0],
      e: [0, 0],
      f: [43.75, 0],
      g: [-43.75, 50],
      h: [0, 50],
      i: [43.75, 50],
      y: [-50, -50],
      z: [0, 65],
      j: [-37.5, -37.5],
      k: [0, -37.5],
      l: [37.5, -37.5],
      m: [-37.5, 37.5],
      n: [0, 37.5],
      o: [37.5, 37.5],
      p: [-37.5, 0],
      q: [37.5, 0],
      A: [-66.2, -66.6],
      B: [-22, -66.6],
      C: [22, -66.6],
      D: [66.2, -66.6],
      K: [-66.4, -20],
      E: [66.4, -20],
      J: [-66.4, 26],
      F: [66.4, 26],
      I: [-65.4, 70],
      G: [65.4, 70],
      H: [0, 89],
    },
  },
  horsehead: {
    path: "m 20,40 c 0,60 40,80 40,100 0,10 -4,15 -0.5,30 C 65,185.7 81,200 100,200 c 19,0 35,-14.3 40.5,-30 C 144,155 140,150 140,140 140,120 180,100 180,40 143,40 148,15 100,15 52,15 57,40 20,40 Z",
    size: 0.9,
    positions: {
      a: [-43.75, -47.5],
      b: [0, -50],
      c: [43.75, -47.5],
      d: [-35, 0],
      e: [0, 0],
      f: [35, 0],
      h: [0, 50],
      y: [-50, -50],
      z: [0, 55],
      j: [-35, -35],
      k: [0, -40],
      l: [35, -35],
      m: [-30, 30],
      n: [0, 40],
      o: [30, 30],
      p: [-27.5, 0],
      q: [27.5, 0],
      A: [-71, -52],
      B: [-24, -73],
      C: [24, -73],
      D: [71, -52],
      K: [-62, -16],
      E: [62, -16],
      J: [-39, 20],
      F: [39, 20],
      I: [-33.5, 60],
      G: [33.5, 60],
      H: [0, 91.5],
    },
  },
  horsehead2: {
    path: "M60 20c-5 20-10 35-35 55 25 35 35 65 30 100 20 0 35 10 45 26 10-16 30-26 45-26-5-35 5-65 30-100a87 87 0 01-35-55c-25 3-55 3-80 0z",
    size: 0.9,
    positions: {
      a: [-37.5, -47.5],
      b: [0, -50],
      c: [37.5, -47.5],
      d: [-35, 0],
      e: [0, 0],
      f: [35, 0],
      g: [-35, 47.5],
      h: [0, 50],
      i: [35, 47.5],
      y: [-50, -50],
      z: [0, 55],
      j: [-30, -30],
      k: [0, -40],
      l: [30, -30],
      m: [-30, 30],
      n: [0, 40],
      o: [30, 30],
      p: [-27.5, 0],
      q: [27.5, 0],
      A: [-49, -39],
      B: [-22, -70],
      C: [22, -70],
      D: [49, -39],
      K: [-51, -2],
      E: [51, -2],
      J: [-38.5, 31],
      F: [38.5, 31],
      I: [-35, 67],
      G: [35, 67],
      H: [0, 85],
    },
  },
  polish: {
    path: "m 100,10 c 0,0 -2.5,-3.7 -9.7,-3.7 -12.7,0 -20.7,10.9 -40.5,14 0,11.8 -4.9,23.5 -11.4,31.1 0,0 12.7,6 12.7,19.3 C 51.1,90.8 30,90.8 30,90.8 c 0,0 -3.6,7.4 -3.6,22.4 0,34.3 23.1,60.2 40.7,68.2 17.6,8 27.7,11.4 32.9,18.6 5.2,-7.3 15.3,-10.7 32.8,-18.6 17.6,-8 40.7,-33.9 40.7,-68.2 0,-15 -3.6,-22.4 -3.6,-22.4 0,0 -21.1,0 -21.1,-20.1 0,-13.3 12.7,-19.3 12.7,-19.3 C 155.1,43.7 150.2,32.1 150.2,20.3 130.4,17.2 122.5,6.3 109.7,6.3 102.5,6.3 100,10 100,10 z",
    size: 0.85,
    positions: {
      a: [-35, -50],
      b: [0, -50],
      c: [35, -50],
      d: [-40, 0],
      e: [0, 0],
      f: [40, 0],
      g: [-37.5, 50],
      h: [0, 50],
      i: [37.5, 50],
      y: [-50, -50],
      z: [0, 65],
      j: [-27.5, -27.5],
      k: [0, -45],
      l: [27.5, -27.5],
      m: [-27.5, 27.5],
      n: [0, 45],
      o: [27.5, 27.5],
      p: [-32.5, 0],
      q: [32.5, 0],
      A: [-48, -52],
      B: [-23, -80],
      C: [23, -80],
      D: [48, -52],
      K: [-47, -10],
      E: [47, -10],
      J: [-62, 32],
      F: [62, 32],
      I: [-37, 68],
      G: [37, 68],
      H: [0, 86],
    },
  },
  hessen: {
    path: "M170 20c4 5 8 13 15 20 0 0-10 0-10 15 0 100-15 140-75 145-65-5-75-45-75-145 0-15-10-15-10-15l15-20c0 15 10-5 70-5s70 20 70 5z",
    positions: {
      a: [-43.75, -50],
      b: [0, -50],
      c: [43.75, -50],
      d: [-43.75, 0],
      e: [0, 0],
      f: [43.75, 0],
      g: [-43.75, 50],
      h: [0, 50],
      i: [43.75, 50],
      y: [-50, -50],
      z: [0, 52.5],
      j: [-40, -40],
      k: [0, -40],
      l: [40, -40],
      m: [-40, 40],
      n: [0, 40],
      o: [40, 40],
      p: [-40, 0],
      q: [40, 0],
      A: [-69, -64],
      B: [-22, -76],
      C: [22, -76],
      D: [69, -64],
      K: [-66.4, -20],
      E: [66.4, -20],
      J: [-62, 26],
      F: [62, 26],
      I: [-46, 70],
      G: [46, 70],
      H: [0, 91.5],
    },
  },
  swiss: {
    path: "m 25,20 c 0.1,0 25.2,8.5 37.6,8.5 C 75.1,28.5 99.1,20 100,20 c 0.6,0 24.9,8.5 37.3,8.5 C 149.8,28.5 174.4,20 175,20 l -0.3,22.6 C 173.2,160.3 100,200 100,200 100,200 26.5,160.9 25.2,42.6 l -0.2,-22.6 Z",
    size: 0.95,
    positions: {
      a: [-43.75, -50],
      b: [0, -50],
      c: [43.75, -50],
      d: [-43.75, 0],
      e: [0, 0],
      f: [43.75, 0],
      g: [-32, 37.5],
      h: [0, 50],
      i: [32, 37.5],
      y: [-50, -50],
      z: [0, 62.5],
      j: [-37.5, -37.5],
      k: [0, -37.5],
      l: [37.5, -37.5],
      m: [-32, 32.5],
      n: [0, 42.5],
      o: [32, 32.5],
      p: [-37.5, 0],
      q: [37.5, 0],
      A: [-66.2, -66.6],
      B: [-22, -66],
      C: [22, -66],
      D: [66.2, -66.6],
      K: [-63, -20],
      E: [63, -20],
      J: [-50, 26],
      F: [50, 26],
      I: [-29, 62],
      G: [29, 62],
      H: [0, 89.5],
    },
  },
  boeotian: {
    path: "M150 115c-5 0-10-5-10-15s5-15 10-15c10 0 7 10 15 10 10 0 0-30 0-30-10-25-30-55-65-55S45 40 35 65c0 0-10 30 0 30 8 0 5-10 15-10 5 0 10 5 10 15s-5 15-10 15c-10 0-7-10-15-10-10 0 0 30 0 30 10 25 30 55 65 55s55-30 65-55c0 0 10-30 0-30-8 0-5 10-15 10z",
    size: 0.75,
    positions: {
      a: [-37.5, -47.5],
      b: [0, -47.5],
      c: [37.5, -47.5],
      d: [-25, 0],
      e: [0, 0],
      f: [25, 0],
      g: [-37.5, 47.5],
      h: [0, 47.5],
      i: [37.5, 47.5],
      y: [-48, -48],
      z: [0, 60],
      j: [-32.5, -37.5],
      k: [0, -45],
      l: [32.5, -37.5],
      m: [-32.5, 37.5],
      n: [0, 45],
      o: [32.5, 37.5],
      p: [-20, 0],
      q: [20, 0],
      A: [-45, -55],
      B: [-20, -77],
      C: [20, -77],
      D: [45, -55],
      K: [-59, -25],
      E: [59, -25],
      J: [-58, 27],
      F: [58, 27],
      I: [-39, 63],
      G: [39, 63],
      H: [0, 81],
    },
  },
  roman: {
    path: "m 160,170 c -40,20 -80,20 -120,0 V 30 C 80,10 120,10 160,30 V 170 Z",
    size: 0.95,
  },
  kite: {
    path: "m 100,200 c 0,0 38.6,-85.6 45.7,-141.2 0,0 1,-8.1 1,-12.3 C 146.7,20.9 125.8,0.1 100,0.1 74.2,0.1 53.3,20.9 53.3,46.4 c 0,4.1 1,12.3 1,12.3 7.1,55.7 45.7,141.3 45.7,141.3 Z",
    size: 0.65,
    positions: {
      b: [0, -65],
      e: [0, -15],
      h: [0, 35],
      z: [0, 35],
      k: [0, -50],
      n: [0, 20],
      p: [-20, -15],
      q: [20, -15],
      A: [-38, -52],
      B: [-29, -78],
      C: [29, -78],
      D: [38, -52],
      K: [-33, -20],
      E: [33, -20],
      J: [-25, 11],
      F: [25, 11],
      I: [-15, 42],
      G: [15, 42],
      H: [0, 73],
      L: [0, -91],
    },
  },
  oldFrench: {
    path: "m25,25 h150 v75 a100,100,0,0,1,-75,100 a100,100,0,0,1,-75,-100 v-75 z",
    positions: {
      a: [-43.75, -50],
      b: [0, -50],
      c: [43.75, -50],
      d: [-43.75, 0],
      e: [0, 0],
      f: [43.75, 0],
      g: [-37.5, 50],
      h: [0, 50],
      i: [37.5, 50],
      y: [-50, -50],
      z: [0, 62.5],
      j: [-37.5, -37.5],
      k: [0, -37.5],
      l: [37.5, -37.5],
      m: [-37.5, 37.5],
      n: [0, 45],
      o: [37.5, 37.5],
      p: [-37.5, 0],
      q: [37.5, 0],
      A: [-66.2, -66.6],
      B: [-22, -66.6],
      C: [22, -66.6],
      D: [66.2, -66.6],
      K: [-66.2, -20],
      E: [66.2, -20],
      J: [-64, 26],
      F: [64, 26],
      I: [-45, 62],
      G: [45, 62],
      H: [0, 91],
    },
  },
  renaissance: {
    path: "M 25,33.9 C 33.4,50.3 36.2,72.9 36.2,81.7 36.2,109.9 25,122.6 25,141 c 0,29.4 24.9,44.1 40.2,47.7 15.3,3.7 29.3,0 34.8,11.3 5.5,-11.3 19.6,-7.6 34.8,-11.3 C 150.1,185 175,170.3 175,141 c 0,-18.4 -11.2,-31.1 -11.2,-59.3 0,-8.8 2.8,-31.3 11.2,-47.7 L 155.7,14.4 C 138.2,21.8 119.3,25.7 100,25.7 c -19.3,0 -38.2,-3.9 -55.7,-11.3 z",
    positions: {
      a: [-43.75, -50],
      b: [0, -50],
      c: [43.75, -50],
      d: [-41.5, 0],
      e: [0, 0],
      f: [41.5, 0],
      g: [-43.75, 50],
      h: [0, 50],
      i: [43.75, 50],
      y: [-50, -50],
      z: [0, 62.5],
      j: [-37.5, -37.5],
      k: [0, -37.5],
      l: [37.5, -37.5],
      m: [-37.5, 37.5],
      n: [0, 37.5],
      o: [37.5, 37.5],
      p: [-37.5, 0],
      q: [37.5, 0],
      A: [-61, -55],
      B: [-23, -67],
      C: [23, -67],
      D: [61, -55],
      K: [-55, -11],
      E: [55, -11],
      J: [-65, 31],
      F: [65, 31],
      I: [-45, 76],
      G: [45, 76],
      H: [0, 87],
    },
  },
  baroque: {
    path: "m 25,39 C 50,27 82,25 100,25 c 18,0 50,2 75,14 v 37 l -2.7,3.2 c -4.9,5.4 -6.6,9.6 -6.7,16.2 0,6.5 2,11.6 6.9,17.2 l 2.8,3.1 v 10.2 c 0,17.7 -2.2,27.7 -7.8,35.9 -5,7.3 -11.7,11.3 -32.3,19.4 -12.6,5 -20.2,8.8 -28.6,14.5 C 103.3,198 100,200 100,200 c 0,0 -2.8,-2.3 -6.4,-4.7 C 85.6,189.8 78,186 65,180.9 32.4,168.1 26.9,160.9 25.8,129.3 L 25,116 l 3.3,-3.3 c 4.8,-5.2 7,-10.7 7,-17.3 0,-6.8 -1.8,-11.1 -6.5,-16.1 L 25,76 V 39 Z",
    positions: {
      a: [-43.75, -45],
      b: [0, -45],
      c: [43.75, -45],
      d: [-43.75, 0],
      e: [0, 0],
      f: [43.75, 0],
      g: [-43.75, 50],
      h: [0, 50],
      i: [43.75, 50],
      y: [-50, -50],
      z: [0, 60],
      j: [-37.5, -37.5],
      k: [0, -37.5],
      l: [37.5, -37.5],
      m: [-37.5, 37.5],
      n: [0, 37.5],
      o: [37.5, 37.5],
      p: [-37.5, 0],
      q: [37.5, 0],
      A: [-65, -54.5],
      B: [-22, -65],
      C: [22, -65],
      D: [65, -54.5],
      K: [-58.5, -15],
      E: [58.5, -15],
      J: [-65, 31],
      F: [66, 31],
      I: [-35, 73],
      G: [35, 73],
      H: [0, 89],
    },
  },
  targe: {
    path: "m 20,35 c 15,0 115,-60 155,-10 -5,10 -15,15 -10,50 5,45 10,70 -10,90 C 125,195 75,195 50,175 25,150 30,130 35,85 50,95 65,85 65,70 65,50 50,45 40,50 30,55 27,65 30,70 23,73 20,70 14,70 11,60 20,45 20,35 Z",
    positions: {
      a: [-43.75, -50],
      b: [0, -50],
      c: [43.75, -50],
      d: [-43.75, 0],
      e: [0, 0],
      f: [43.75, 0],
      g: [-43.75, 50],
      h: [0, 50],
      i: [43.75, 50],
      y: [-50, -50],
      z: [0, 50],
      j: [-40, -40],
      k: [0, -40],
      l: [40, -40],
      m: [-40, 40],
      n: [0, 40],
      o: [40, 40],
      p: [-32.5, 0],
      q: [32.5, 0],
      A: [-66.2, -60],
      B: [-22, -77],
      C: [22, -86],
      D: [60, -66.6],
      K: [-28, -20],
      E: [57, -20],
      J: [-61, 26],
      F: [61, 26],
      I: [-49, 63],
      G: [49, 59],
      H: [0, 80],
    },
  },
  pavise: {
    path: "M95 7L39.9 37.3a10 10 0 00-5.1 9.5L46 180c.4 5.2 3.7 10 9 10h90c5.3 0 9.6-4.8 10-10l10.6-133.2a10 10 0 00-5-9.5L105 7c-4.2-2.3-6.2-2.3-10 0z",
    size: 0.9,
    positions: {
      a: [-40, -52.5],
      b: [0, -52.5],
      c: [40, -52.5],
      d: [-40, 0],
      e: [0, 0],
      f: [40, 0],
      g: [-40, 52.5],
      h: [0, 52.5],
      i: [40, 52.5],
      y: [-42.5, -52.5],
      z: [0, 60],
      j: [-30, -35],
      k: [0, -37.5],
      l: [30, -35],
      m: [-30, 35],
      n: [0, 37.5],
      o: [30, 35],
      p: [-30, 0],
      q: [30, 0],
      A: [-57, -55],
      B: [-22, -74],
      C: [22, -74],
      D: [57, -55],
      K: [-54, -11],
      E: [54, -11],
      J: [-50, 36],
      F: [50, 36],
      I: [-46, 81],
      G: [46, 81],
      H: [0, 81],
    },
  },
  wedged: {
    path: "m 51.2,19 h 96.4 c 3.1,12.7 10.7,20.9 26.5,20.8 C 175.7,94.5 165.3,144.3 100,200 43.5,154.2 22.8,102.8 25.1,39.7 37,38.9 47.1,34.7 51.2,19 Z",
    size: 0.95,
    positions: {
      a: [-43.75, -50],
      b: [0, -50],
      c: [43.75, -50],
      d: [-43.75, 0],
      e: [0, 0],
      f: [43.75, 0],
      g: [-32.25, 37.5],
      h: [0, 50],
      i: [32.25, 37.5],
      y: [-50, -50],
      z: [0, 62.5],
      j: [-37.5, -37.5],
      k: [0, -37.5],
      l: [37.5, -37.5],
      m: [-32.5, 32.5],
      n: [0, 42.5],
      o: [32.5, 32.5],
      p: [-37.5, 0],
      q: [37.5, 0],
      A: [-66, -53],
      B: [-22, -72.5],
      C: [22, -72.5],
      D: [66, -53],
      K: [-62.6, -13],
      E: [62.6, -13],
      J: [-50, 26],
      F: [50, 26],
      I: [-27, 62],
      G: [27, 62],
      H: [0, 87],
    },
  },
  embowed: {
    path: "m 25,25 a 170,170,0,0,1,150,0 v 50 a 150,150,0,0,1,-75,125 a 150,150,0,0,1,-75,-125 v -50 z",
    positions: {
      a: [-43.75, -50],
      b: [0, -60],
      c: [43.75, -50],
      d: [-43.75, 0],
      e: [0, 0],
      f: [43.75, 0],
      g: [-32.25, 37.5],
      h: [0, 50],
      i: [32.25, 37.5],
      y: [-50, -50],
      z: [0, 62.5],
      j: [-37.5, -37.5],
      k: [0, -47.5],
      l: [37.5, -37.5],
      m: [-30, 30],
      n: [0, 42.5],
      o: [30, 30],
      p: [-37.5, 0],
      q: [37.5, 0],
      A: [-66.2, -66.6],
      B: [-22, -82],
      C: [22, -82],
      D: [66.2, -66.6],
      K: [-66.2, -20],
      E: [66.2, -20],
      J: [-55.5, 26],
      F: [55.5, 26],
      I: [-33, 62],
      G: [33, 62],
      H: [0, 89.5],
    },
  },
};

// Charge categories, restricted to Armoria's CC0 charges. `conventional` and `crosses` keep Armoria's lists and
// odds; the figurative CC0 charges, spread over many of Armoria's categories, share `figures`.
const CHARGE_SETS: Record<string, Weights> = {
  conventional: {
    annulet: 4,
    billet: 5,
    carreau: 1,
    compassRose: 1,
    crescent: 5,
    delf: 0,
    fleurDeLis: 6,
    fusil: 4,
    goutte: 4,
    heart: 4,
    lozenge: 2,
    lozengeFaceted: 3,
    lozengePloye: 1,
    mascle: 4,
    mullet: 5,
    mullet10: 1,
    mullet4: 3,
    mullet6: 4,
    mullet6Faceted: 1,
    mullet6Pierced: 1,
    mullet7: 1,
    mullet8: 1,
    mulletFaceted: 1,
    mulletPierced: 1,
    pique: 2,
    roundel: 4,
    roundel2: 3,
    rustre: 2,
    spiral: 1,
    sun: 3,
    sunInSplendour: 1,
    trefle: 2,
    triangle: 3,
    trianglePierced: 1,
  },
  crosses: {
    crossHummetty: 15,
    crossVoided: 1,
    crossPattee: 2,
    crossPatteeAlisee: 1,
    crossFormee: 1,
    crossFormee2: 2,
    crossPotent: 2,
    crossJerusalem: 1,
    crosslet: 1,
    crossClechy: 3,
    crossBottony: 1,
    crossFleury: 3,
    crossPatonce: 1,
    crossPommy: 1,
    crossGamma: 1,
    crossArrowed: 1,
    crossFitchy: 1,
    crossCercelee: 1,
    crossMoline: 2,
    crossFourchy: 1,
    crossAvellane: 1,
    crossErminee: 1,
    crossBiparted: 1,
    crossMaltese: 3,
    crossTemplar: 2,
    crossCeltic: 1,
    crossCeltic2: 1,
    crossTriquetra: 1,
    crossCarolingian: 1,
    crossOccitan: 1,
    crossSaltire: 3,
    crossBurgundy: 1,
    crossLatin: 3,
    crossPatriarchal: 1,
    crossOrthodox: 1,
    crossCalvary: 1,
    crossDouble: 1,
    crossTau: 1,
    crossSantiago: 1,
    crossAnkh: 1,
  },
  figures: {
    anchor: 6,
    ant: 1,
    bowWithThreeArrows: 1,
    bridge2: 1,
    caduceus: 1,
    church: 1,
    dragonfly: 1,
    drawingCompass: 2,
    flamberge: 1,
    flangedMace: 1,
    grapeBunch: 1,
    helmetZischagge: 1,
    laurelWreath2: 1,
    mace: 1,
    maces: 1,
    ouroboros: 1,
    pillar: 1,
    raft: 1,
    scale: 1,
    scaleImbalanced: 1,
    scythe2: 1,
    shears: 1,
    skull2: 1,
    snail: 1,
    squirrel: 1,
    stork: 1,
  },
};

// Category odds for a charge alongside an ordinary or division (`types`) and for a lone charge (`single`):
// Armoria's for conventional charges, crosses and inescutcheons. `figures` takes 12, between them, where
// Armoria's figurative categories add up to about 50 over hundreds of charges.
const CHARGE_TYPES = {
  conventional: 33,
  crosses: 13,
  figures: 12,
  inescutcheon: 3,
};
const CHARGE_SINGLE = {
  conventional: 10,
  crosses: 8,
  figures: 12,
  inescutcheon: 1,
};
const CHARGE_SEMY = { conventional: 4, crosses: 1 };

// Armoria's per-charge data for the charges kept: how many tinctures a charge takes, whether it may face left
// (sinister) or turn upside down (reversed), and its own positions.
const CHARGE_DATA: Record<
  string,
  {
    colors?: number;
    sinister?: boolean;
    reversed?: boolean;
    positions?: Record<string, number>;
  }
> = {
  ant: { reversed: true },
  bowWithThreeArrows: { colors: 3 },
  caduceus: { colors: 3 },
  church: { colors: 3 },
  dragonfly: { colors: 2, reversed: true },
  drawingCompass: { sinister: true },
  flamberge: { colors: 2, reversed: true },
  flangedMace: { reversed: true },
  grapeBunch: { colors: 3, sinister: true },
  helmetZischagge: { sinister: true },
  mace: { colors: 2 },
  maces: { colors: 2 },
  ouroboros: { sinister: true },
  scale: { colors: 2 },
  scaleImbalanced: { colors: 2, sinister: true },
  scythe2: { sinister: true },
  snail: { colors: 2, sinister: true },
  squirrel: { sinister: true },
  stork: { colors: 2, sinister: true },
  crescent: { reversed: true },
  goutte: { reversed: true },
  mascle: {
    positions: {
      e: 15,
      abcdefgzi: 3,
      beh: 3,
      bdefh: 4,
      acegi: 1,
      kn: 3,
      joe: 2,
      abc: 3,
      jlh: 8,
      jleh: 1,
      df: 3,
      abcpqh: 4,
      pqe: 3,
      eknpq: 3,
    },
  },
  mullet: { reversed: true },
  mullet7: { reversed: true },
  spiral: { sinister: true, reversed: true },
  crossGamma: { sinister: true },
  crossTriquetra: { reversed: true },
  crossLatin: { reversed: true },
  crossTau: { reversed: true },
};

// Armoria's odds for each element's tincture type, without stains, and for its patterns.
const TINCTURE_TYPES = {
  field: { metals: 32, colours: 49, patterns: 14 },
  division: { metals: 35, colours: 49, patterns: 8 },
  charge: { metals: 16, colours: 24, patterns: 0 },
};
const PATTERN_ODDS = {
  semy: 8,
  ermine: 6,
  vair: 4,
  counterVair: 1,
  vairInPale: 1,
  vairEnPointe: 2,
  vairAncien: 2,
  potent: 2,
  counterPotent: 1,
  potentInPale: 1,
  potentEnPointe: 1,
  chequy: 8,
  lozengy: 5,
  fusily: 2,
  pally: 8,
  barry: 10,
  gemelles: 1,
  bendy: 8,
  bendySinister: 4,
  palyBendy: 2,
  barryBendy: 1,
  pappellony: 2,
  pappellony2: 3,
  scaly: 1,
  plumetty: 1,
  masoned: 6,
  fretty: 3,
  grillage: 1,
  chainy: 1,
  maily: 2,
  honeycombed: 1,
};
const PATTERN_SIZE = {
  standard: 154,
  small: 20,
  smaller: 20,
  big: 5,
  smallest: 1,
};
const PATTERN_SCALE: Record<string, number> = {
  standard: 1,
  small: 0.8,
  smaller: 0.5,
  smallest: 0.25,
  big: 1.6,
};

// ---- Tinctures ----

// A tincture is a palette color (0 the paper, k ink k - 1) or a pattern of two.
type Pattern = {
  name: string;
  t1: number;
  t2: number;
  size: number;
  charge?: string;
};
type Tincture = number | Pattern;

// The palette as Armoria's tincture table: the paper and light inks are metals, the other inks colours. The
// paper weighs like argent, a light ink like or. The darkest ink weighs like sable, the other colours like
// gules, azure, purpure and vert in turn. Armoria's named tinctures, which a few patterns ask for, map to
// the same colors.
type Tinctures = {
  metals: Weights;
  colours: Weights;
  named: Record<"argent" | "or" | "gules" | "sable" | "azure", number>;
};

const brightness = (hex: string) =>
  0.299 * parseInt(hex.slice(1, 3), 16) +
  0.587 * parseInt(hex.slice(3, 5), 16) +
  0.114 * parseInt(hex.slice(5, 7), 16);

function tincturesOf(palette: Palette): Tinctures {
  const metals: Weights = { 0: 3 };
  const colours: Weights = {};
  const light: number[] = [];
  const dark: number[] = [];
  palette.inks.forEach((ink, k) =>
    (k > 0 && brightness(ink) > 150 ? light : dark).push(k + 1),
  );
  for (const t of light) metals[t] = 2;
  const COLOUR_WEIGHTS = [5, 4, 3, 2];
  dark.forEach(
    (t, k) => (colours[t] = k === 0 ? 3 : COLOUR_WEIGHTS[(k - 1) % 4]),
  );
  return {
    metals,
    colours,
    named: {
      argent: 0,
      or: light[0] ?? 0,
      sable: dark[0],
      gules: dark[1] ?? dark[0],
      azure: dark[2] ?? dark[1] ?? dark[0],
    },
  };
}

// ---- Generator ----

type Divided = "field" | "division" | "counter";

type ChargeItem = {
  charge: string;
  t: Tincture;
  t2?: Tincture;
  t3?: Tincture;
  p: string;
  size?: number;
  sinister?: boolean;
  reversed?: boolean;
  divided?: Divided;
};

type Coa = {
  shield: string;
  t1: Tincture;
  division?: { division: string; t: Tincture; line?: string };
  ordinary?: {
    ordinary: string;
    t: Tincture;
    line?: string;
    divided?: Divided;
  };
  charges: ChargeItem[];
};

// Armoria's generate(), drawing from `rand` and printing in `tinctures`.
function generate(rand: () => number, tinctures: Tinctures): Coa {
  const P = (probability: number) => rand() < probability;
  // A key picked by weight, in the object's order, as Armoria's rw() does.
  const rw = (weights: Weights): string => {
    let total = 0;
    for (const k in weights) total += weights[k];
    let r = Math.floor(rand() * total);
    for (const k in weights) {
      r -= weights[k];
      if (r < 0) return k;
    }
    throw new Error("arms1: no weights");
  };

  let usedPattern: string | null = null;
  const usedTinctures: number[] = [];
  const isMetal = (t: number) => t in tinctures.metals;
  const base = (t: Tincture) => (typeof t === "number" ? t : t.t1);

  const selectCharge = (set: Weights) => {
    const type = rw(set);
    return type === "inescutcheon" ? "inescutcheon" : rw(CHARGE_SETS[type]);
  };

  const replaceTincture = (t: number) => {
    const candidates = {
      ...(isMetal(t) ? tinctures.metals : tinctures.colours),
    };
    delete candidates[t];
    return Object.keys(candidates).length ? +rw(candidates) : t;
  };

  const definePattern = (name: string, element: string): Pattern => {
    const N = tinctures.named;
    // The first pair whose odds come up, tried in turn, as Armoria's if-else chains draw them.
    const first = (...options: [number, number, number][]) => {
      for (const [odds, a, b] of options) if (P(odds)) return [a, b];
      return null;
    };
    let pair: number[] | null = null;
    let charge: string | undefined;
    if (P(0.5) && (name.includes("air") || name.includes("otent")))
      pair = [N.argent, N.azure];
    else if (name === "ermine")
      pair = first(
        [0.7, N.argent, N.sable],
        [0.3, N.sable, N.argent],
        [0.1, N.or, N.sable],
        [0.1, N.sable, N.or],
        [0.1, N.gules, N.argent],
      );
    else if (name.includes("pappellony") || name === "scaly")
      pair = first(
        [0.2, N.gules, N.or],
        [0.2, N.sable, N.argent],
        [0.2, N.argent, N.sable],
        [0.2, N.azure, N.argent],
      );
    else if (P(0.2) && name === "plumetty") pair = [N.gules, N.or];
    else if (name === "masoned")
      pair = first(
        [0.3, N.gules, N.argent],
        [0.3, N.argent, N.sable],
        [0.1, N.or, N.sable],
      );
    else if (name === "fretty" || name === "grillage" || name === "chainy")
      pair = first(
        [0.35, N.argent, N.gules],
        [0.1, N.sable, N.or],
        [0.2, N.gules, N.argent],
      );
    else if (name === "honeycombed")
      pair = first([0.4, N.sable, N.or], [0.3, N.or, N.sable]);
    else if (name === "semy") charge = selectCharge(CHARGE_SEMY);

    let [t1, t2] = pair ?? [-1, -1];
    if (!pair) {
      const startWithMetal = P(0.7);
      t1 = +rw(startWithMetal ? tinctures.metals : tinctures.colours);
      t2 = +rw(startWithMetal ? tinctures.colours : tinctures.metals);
    }
    // A division should not take the field's tincture.
    if (element === "division") {
      if (usedTinctures.includes(t1)) t1 = replaceTincture(t1);
      if (usedTinctures.includes(t2)) t2 = replaceTincture(t2);
    }
    usedTinctures.push(t1, t2);
    const size = PATTERN_SCALE[rw(PATTERN_SIZE)];
    return { name, t1, t2, size, charge };
  };

  // Drops used tinctures from a type's table, unless that leaves none.
  const excludeTinctures = (
    typeTinctures: Weights,
    used: readonly number[],
  ) => {
    const unused = { ...typeTinctures };
    for (const t of used) delete unused[t];
    let sum = 0;
    for (const k in unused) sum += unused[k];
    return sum ? unused : typeTinctures;
  };

  // A tincture for an element (field, division or charge), avoiding `fields`, and following the rule of
  // tincture against `RoT` when given: no metal on metal, nor colour on colour.
  const getTincture = (
    element: keyof typeof TINCTURE_TYPES,
    fields: readonly number[] = [],
    RoT: Tincture | null = null,
  ): Tincture => {
    let type = rw(TINCTURE_TYPES[element]);
    if (type === "patterns") {
      const name = rw(PATTERN_ODDS);
      usedPattern = name;
      return definePattern(name, element);
    }
    if (RoT !== null) type = isMetal(base(RoT)) ? "colours" : "metals";
    const typeTinctures =
      type === "metals" ? tinctures.metals : tinctures.colours;
    const candidates = fields.length
      ? excludeTinctures(typeTinctures, fields)
      : typeTinctures;
    const tincture = +rw(candidates);
    if (element !== "charge") usedTinctures.push(tincture);
    return tincture;
  };

  const shield = rw(SHIELD_GROUPS[rw(SHIELD_TYPES)]);

  const t1 = getTincture("field");
  const coa: Coa = { shield, t1, charges: [] };

  const addCharge = P(usedPattern ? 0.5 : 0.93);
  const linedOrdinary =
    (addCharge && P(0.3)) || P(0.5) ? rw(ORDINARIES.lined) : null;
  const ordinary =
    (!addCharge && P(0.65)) || P(0.3)
      ? (linedOrdinary ?? rw(ORDINARIES.straight))
      : null;

  const rareDivided =
    ordinary !== null &&
    ["chief", "terrace", "chevron", "quarter", "flaunches"].includes(ordinary);
  const divisioned = rareDivided
    ? P(0.03)
    : addCharge && ordinary
      ? P(0.03)
      : addCharge
        ? P(0.3)
        : ordinary
          ? P(0.7)
          : P(0.995);

  const division = divisioned ? rw(DIVISIONS.variants) : null;
  if (division) {
    const t = getTincture("division", usedTinctures, P(0.98) ? coa.t1 : null);
    coa.division = { division, t };
    const data = DIVISIONS.data[division];
    if (data.templateLined)
      coa.division.line =
        usedPattern || (ordinary && P(0.7))
          ? "straight"
          : rw(data.line ?? LINES.variants);
  }

  if (ordinary) {
    const t = getTincture("charge", usedTinctures, coa.t1);
    coa.ordinary = { ordinary, t };
    if (linedOrdinary)
      coa.ordinary.line =
        usedPattern || (division && P(0.7)) ? "straight" : rw(LINES.variants);
    if (
      division &&
      !addCharge &&
      !usedPattern &&
      P(0.5) &&
      ordinary !== "bordure" &&
      ordinary !== "orle"
    ) {
      if (P(0.8)) coa.ordinary.divided = "counter";
      else if (P(0.6)) coa.ordinary.divided = "field";
      else coa.ordinary.divided = "division";
    }
  }

  if (addCharge) {
    const charge = selectCharge(
      ordinary || divisioned ? CHARGE_TYPES : CHARGE_SINGLE,
    );
    const chargeData = CHARGE_DATA[charge] ?? {};
    let p: string;
    let t: Tincture;
    const ordinaryData = ordinary ? ORDINARIES.data[ordinary] : null;
    const tOrdinary = coa.ordinary ? coa.ordinary.t : null;
    const divisionData = division ? DIVISIONS.data[division] : null;

    if (ordinaryData?.positionsOn && P(0.8)) {
      // On the ordinary, in a tincture against it.
      p = rw(ordinaryData.positionsOn);
      t =
        !usedPattern && P(0.3) ? coa.t1 : getTincture("charge", [], tOrdinary);
    } else if (ordinaryData?.positionsOff && P(0.95)) {
      // Off the ordinary, against the field.
      p = rw(ordinaryData.positionsOff);
      t =
        !usedPattern && P(0.3)
          ? tOrdinary!
          : getTincture("charge", usedTinctures, coa.t1);
    } else if (divisionData?.positions) {
      // In the fields the division makes.
      p = rw(divisionData.positions);
      t = getTincture(
        "charge",
        tOrdinary !== null
          ? usedTinctures.concat(base(tOrdinary))
          : usedTinctures,
        coa.t1,
      );
    } else if (chargeData.positions) {
      p = rw(chargeData.positions);
      t = getTincture("charge", usedTinctures, coa.t1);
    } else {
      // A standard position, in a new tincture.
      p = usedPattern
        ? "e"
        : CHARGE_SETS.conventional[charge]
          ? rw(POSITIONS.conventional)
          : rw(POSITIONS.complex);
      t = getTincture(
        "charge",
        tOrdinary !== null
          ? usedTinctures.concat(base(tOrdinary))
          : usedTinctures,
        coa.t1,
      );
    }

    const item: ChargeItem = { charge, t, p };
    const colors = chargeData.colors ?? 1;
    if (colors > 1)
      item.t2 = P(0.25) ? getTincture("charge", usedTinctures, coa.t1) : t;
    if (colors > 2 && item.t2 !== undefined)
      item.t3 = P(0.5) ? getTincture("charge", usedTinctures, coa.t1) : t;
    coa.charges.push(item);

    if (P(0.8) && charge === "inescutcheon") {
      // A charge on the inescutcheon.
      const charge = selectCharge(CHARGE_TYPES);
      const t2 = getTincture("charge", [], t);
      coa.charges.push({ charge, t: t2, p, size: 0.5 });
    } else if (division && !ordinary) {
      const allowCounter = !usedPattern;
      if (allowCounter && P(0.4)) coa.charges[0].divided = "counter";
      else if (
        ["perPale", "perFess", "perBend", "perBendSinister"].includes(
          division,
        ) &&
        P(0.8)
      ) {
        // Two charges in the division's standard positions.
        const [p1, p2] =
          division === "perPale"
            ? ["p", "q"]
            : division === "perFess"
              ? ["k", "n"]
              : division === "perBend"
                ? ["l", "m"]
                : ["j", "o"];
        coa.charges[0].p = p1;
        const charge = selectCharge(CHARGE_SINGLE);
        const t = getTincture("charge", usedTinctures, coa.division!.t);
        coa.charges.push({ charge, t, p: p2 });
      } else if (["perCross", "perSaltire"].includes(division) && P(0.5)) {
        // Four charges in the division's standard positions.
        const [p1, p2, p3, p4] =
          division === "perCross" ? ["j", "l", "m", "o"] : ["b", "d", "f", "h"];
        coa.charges[0].p = p1;
        const c2 = selectCharge(CHARGE_SINGLE);
        const t2 = getTincture("charge", [], coa.division!.t);
        const c3 = selectCharge(CHARGE_SINGLE);
        const t3 = getTincture("charge", [], coa.division!.t);
        const c4 = selectCharge(CHARGE_SINGLE);
        const t4 = getTincture("charge", [], coa.t1);
        coa.charges.push(
          { charge: c2, t: t2, p: p2 },
          { charge: c3, t: t3, p: p3 },
          { charge: c4, t: t4, p: p4 },
        );
      } else if (allowCounter && p.length > 1)
        coa.charges[0].divided = "counter";
    }

    for (const c of coa.charges) {
      c.size = (c.size ?? 1) * chargeSize(c.p, ordinary, division);
      c.p = [...new Set(c.p)].join("");
      if (P(0.02) && CHARGE_DATA[c.charge]?.sinister) c.sinister = true;
      if (P(0.02) && CHARGE_DATA[c.charge]?.reversed) c.reversed = true;
    }
  }
  return coa;
}

// Armoria's getSize: a charge's size from its positions, before repeats are dropped.
function chargeSize(p: string, o: string | null, d: string | null): number {
  if (p === "e" && (o === "bordure" || o === "orle")) return 1.1;
  if (p === "e") return 1.5;
  if (p === "jln" || p === "jlh") return 0.7;
  if (p === "abcpqh" || p === "ez" || p === "be") return 0.5;
  if (["a", "b", "c", "d", "f", "g", "h", "i", "bh", "df"].includes(p))
    return 0.5;
  if (["j", "l", "m", "o", "jlmo"].includes(p) && d === "perCross") return 0.6;
  if (p.length > 10) return 0.18;
  if (p.length > 7) return 0.3;
  if (p.length > 4) return 0.4;
  if (p.length > 2) return 0.5;
  return 0.7;
}

// ---- Geometry ----

// An affine map [a, b, c, d, e, f], as SVG's matrix(): x' = a x + c y + e, y' = b x + d y + f.
type Matrix = readonly number[];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
// How much a map scales lengths, on average.
const scaleOf = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

// An SVG transform attribute: translate, scale, rotate (with or without a center) and matrix.
function parseTransform(s: string): Matrix {
  let m = IDENTITY;
  for (const [, fn, args] of s.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const v = args
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    let t: Matrix;
    if (fn === "translate") t = [1, 0, 0, 1, v[0], v[1] ?? 0];
    else if (fn === "scale") t = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
    else if (fn === "matrix") t = v;
    else if (fn === "rotate") {
      const a = (v[0] * Math.PI) / 180;
      const [c, s] = [cos(a), sin(a)];
      t = [c, s, -s, c, 0, 0];
      if (v.length > 1)
        t = multiply(multiply([1, 0, 0, 1, v[1], v[2]], t), [
          1,
          0,
          0,
          1,
          -v[1],
          -v[2],
        ]);
    } else throw new Error(`arms1: unsupported transform ${fn}`);
    m = multiply(m, t);
  }
  return m;
}

// One subpath as a flat [x0, y0, x1, y1, ...] list, and whether it was closed.
type Sub = { pts: number[]; closed: boolean };

// SVG path data to subpaths in the path's own units, mapped by `m`. Curves and arcs become chords that stray
// at most about `tol` from them, in the path's units. Handles M L H V C S Q T A Z, absolute and relative.
function flatten(d: string, tol: number, m: Matrix = IDENTITY): Sub[] {
  const out: Sub[] = [];
  let pts: number[] = [];
  let i = 0;
  const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
  const skip = () => {
    while (i < d.length && " ,\n\t\r".includes(d[i])) i++;
  };
  const num = () => {
    skip();
    NUMBER.lastIndex = i;
    const match = NUMBER.exec(d);
    if (!match)
      throw new Error(`arms1: bad path at ${i}: ${d.slice(i, i + 12)}`);
    i = NUMBER.lastIndex;
    return parseFloat(match[0]);
  };
  // Arc flags are single digits, which minified paths run together: "0 01-2 2".
  const flag = () => {
    skip();
    return d[i++] === "1";
  };
  let [x, y, sx, sy] = [0, 0, 0, 0];
  // The last curve's control point, for S and T.
  let [qx, qy] = [0, 0];
  let cmd = "";
  let last = "";
  const finish = (closed: boolean) => {
    if (pts.length >= 4) out.push({ pts, closed });
    pts = [];
  };
  const push = (px: number, py: number) => pts.push(px, py);
  const lineTo = (nx: number, ny: number) => {
    push(nx, ny);
    [x, y] = [nx, ny];
  };
  const cubic = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
  ) => {
    // The control polygon's bend bounds the chord error: about 3/4 of it over n squared.
    const dd = Math.max(
      Math.abs(x - 2 * x1 + x2) + Math.abs(y - 2 * y1 + y2),
      Math.abs(x1 - 2 * x2 + x3) + Math.abs(y1 - 2 * y2 + y3),
    );
    const n = Math.min(64, Math.floor(Math.sqrt((0.75 * dd) / tol)) + 1);
    const [x0, y0] = [x, y];
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const u = 1 - t;
      const [a, b, c, e] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      push(
        a * x0 + b * x1 + c * x2 + e * x3,
        a * y0 + b * y1 + c * y2 + e * y3,
      );
    }
    [x, y, qx, qy] = [x3, y3, x2, y2];
  };
  const quad = (x1: number, y1: number, x2: number, y2: number) => {
    const [x0, y0] = [x, y];
    cubic(
      x0 + (2 / 3) * (x1 - x0),
      y0 + (2 / 3) * (y1 - y0),
      x2 + (2 / 3) * (x1 - x2),
      y2 + (2 / 3) * (y1 - y2),
      x2,
      y2,
    );
    [qx, qy] = [x1, y1];
  };
  // An elliptical arc, from endpoint to center form as in SVG's implementation notes (F.6.5).
  const arc = (
    rx: number,
    ry: number,
    angle: number,
    large: boolean,
    sweep: boolean,
    x2: number,
    y2: number,
  ) => {
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (rx === 0 || ry === 0 || (x === x2 && y === y2)) return lineTo(x2, y2);
    const phi = (angle * Math.PI) / 180;
    const [cp, sp] = [cos(phi), sin(phi)];
    const [dx, dy] = [(x - x2) / 2, (y - y2) / 2];
    const x1p = cp * dx + sp * dy;
    const y1p = -sp * dx + cp * dy;
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
      const s = Math.sqrt(lambda);
      [rx, ry] = [rx * s, ry * s];
    }
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const numer = rx * rx * ry * ry - den;
    const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numer / den));
    const cxp = (co * rx * y1p) / ry;
    const cyp = (-co * ry * x1p) / rx;
    const cx = cp * cxp - sp * cyp + (x + x2) / 2;
    const cy = sp * cxp + cp * cyp + (y + y2) / 2;
    const t1 = atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
    let dt = atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx) - t1;
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    // A chord over angle a strays r a^2 / 8 from the arc.
    const r = Math.max(rx, ry);
    const n = Math.min(
      256,
      Math.floor(Math.abs(dt) * Math.sqrt(r / (8 * tol))) + 1,
    );
    for (let k = 1; k < n; k++) {
      const t = t1 + (dt * k) / n;
      const [ct, st] = [cos(t), sin(t)];
      push(cx + rx * ct * cp - ry * st * sp, cy + rx * ct * sp + ry * st * cp);
    }
    lineTo(x2, y2);
  };
  for (;;) {
    skip();
    if (i >= d.length) break;
    // Repeated arguments repeat the command, except that M's repeats are L.
    if (/[A-Za-z]/.test(d[i])) cmd = d[i++];
    else if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
    const rel = cmd === cmd.toLowerCase();
    const [ox, oy] = rel ? [x, y] : [0, 0];
    switch (cmd.toUpperCase()) {
      case "M": {
        finish(false);
        const [nx, ny] = [ox + num(), oy + num()];
        [sx, sy] = [nx, ny];
        lineTo(nx, ny);
        break;
      }
      case "L": {
        const nx = ox + num();
        lineTo(nx, oy + num());
        break;
      }
      case "H":
        lineTo(ox + num(), y);
        break;
      case "V":
        lineTo(x, oy + num());
        break;
      case "C": {
        const [x1, y1, x2, y2] = [
          ox + num(),
          oy + num(),
          ox + num(),
          oy + num(),
        ];
        cubic(x1, y1, x2, y2, ox + num(), oy + num());
        break;
      }
      case "S": {
        // The first control point mirrors the last cubic's second, or sits on the pen after anything else.
        const [x1, y1] = "CcSs".includes(last)
          ? [2 * x - qx, 2 * y - qy]
          : [x, y];
        const [x2, y2] = [ox + num(), oy + num()];
        cubic(x1, y1, x2, y2, ox + num(), oy + num());
        break;
      }
      case "Q": {
        const [x1, y1] = [ox + num(), oy + num()];
        quad(x1, y1, ox + num(), oy + num());
        break;
      }
      case "T": {
        const [x1, y1] = "QqTt".includes(last)
          ? [2 * x - qx, 2 * y - qy]
          : [x, y];
        quad(x1, y1, ox + num(), oy + num());
        break;
      }
      case "A": {
        const [rx, ry, angle] = [num(), num(), num()];
        const [large, sweep] = [flag(), flag()];
        arc(rx, ry, angle, large, sweep, ox + num(), oy + num());
        break;
      }
      case "Z":
        finish(true);
        [x, y] = [sx, sy];
        // A path that goes on after Z starts its next subpath at the start point.
        push(x, y);
        break;
      default:
        throw new Error(`arms1: unsupported path command ${cmd}`);
    }
    last = cmd;
  }
  finish(false);
  if (m !== IDENTITY)
    for (const s of out)
      for (let k = 0; k < s.pts.length; k += 2) {
        const [px, py] = [s.pts[k], s.pts[k + 1]];
        s.pts[k] = m[0] * px + m[2] * py + m[4];
        s.pts[k + 1] = m[1] * px + m[3] * py + m[5];
      }
  return out;
}

// A unit circle as `n` points, turning the same way as stroke's segment quads, so the two union under the
// nonzero rule.
const circles = new Map<number, number[]>();
function unitCircle(n: number): number[] {
  let c = circles.get(n);
  if (!c) {
    c = [];
    for (let k = 0; k < n; k++)
      c.push(cos((-2 * Math.PI * k) / n), sin((-2 * Math.PI * k) / n));
    circles.set(n, c);
  }
  return c;
}

// The outline of stroking `subs` at width `w` as polygons to fill under the nonzero rule: a quad per segment,
// butt-ended as SVG's default cap, and a round join where the line turns enough to open a visible notch.
// `pixel` is the size of one output pixel in these units, which sets how round the joins are drawn.
function stroke(subs: readonly Sub[], w: number, pixel: number): number[][] {
  const out: number[][] = [];
  const h = w / 2;
  const n = Math.max(6, Math.min(32, Math.floor((3 * h) / pixel)));
  const circle = unitCircle(n);
  const disc = (cx: number, cy: number) => {
    const p: number[] = [];
    for (let k = 0; k < circle.length; k += 2)
      p.push(cx + h * circle[k], cy + h * circle[k + 1]);
    out.push(p);
  };
  for (const { pts, closed } of subs) {
    const count = pts.length / 2;
    const segs = closed ? count : count - 1;
    let prev: [number, number] | null = null;
    for (let k = 0; k < segs; k++) {
      const j = (k + 1) % count;
      const [x0, y0, x1, y1] = [
        pts[2 * k],
        pts[2 * k + 1],
        pts[2 * j],
        pts[2 * j + 1],
      ];
      const len = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
      if (len === 0) continue;
      const [ux, uy] = [(x1 - x0) / len, (y1 - y0) / len];
      const [nx, ny] = [-uy * h, ux * h];
      out.push([
        x0 + nx,
        y0 + ny,
        x1 + nx,
        y1 + ny,
        x1 - nx,
        y1 - ny,
        x0 - nx,
        y0 - ny,
      ]);
      // The notch between two segments is about h times the turn's sine wide.
      if (prev && h * Math.abs(prev[0] * uy - prev[1] * ux) > 0.15 * pixel)
        disc(x0, y0);
      prev = [ux, uy];
    }
    if (closed && count > 2) disc(pts[0], pts[1]);
  }
  return out;
}

// Clips a polygon to the rectangle [0, w] by [0, h] (Sutherland and Hodgman).
function clipRect(p: number[], w: number, h: number): number[] {
  const edge = (
    pts: number[],
    inside: (x: number, y: number) => boolean,
    cut: (ax: number, ay: number, bx: number, by: number) => [number, number],
  ) => {
    const out: number[] = [];
    const n = pts.length / 2;
    for (let k = 0; k < n; k++) {
      const [ax, ay] = [
        pts[2 * ((k + n - 1) % n)],
        pts[2 * ((k + n - 1) % n) + 1],
      ];
      const [bx, by] = [pts[2 * k], pts[2 * k + 1]];
      const [ia, ib] = [inside(ax, ay), inside(bx, by)];
      if (ib) {
        if (!ia) out.push(...cut(ax, ay, bx, by));
        out.push(bx, by);
      } else if (ia) out.push(...cut(ax, ay, bx, by));
    }
    return out;
  };
  const atX =
    (X: number) =>
    (ax: number, ay: number, bx: number, by: number): [number, number] => [
      X,
      ay + ((by - ay) * (X - ax)) / (bx - ax),
    ];
  const atY =
    (Y: number) =>
    (ax: number, ay: number, bx: number, by: number): [number, number] => [
      ax + ((bx - ax) * (Y - ay)) / (by - ay),
      Y,
    ];
  p = edge(p, (x) => x >= 0, atX(0));
  p = edge(p, (x) => x <= w, atX(w));
  p = edge(p, (_, y) => y >= 0, atY(0));
  return edge(p, (_, y) => y <= h, atY(h));
}

// ---- SVG snippets ----

// A painted element of one of Armoria's SVG snippets: its path, map and presentation attributes.
type Element = {
  d: string;
  m: Matrix;
  fill?: string;
  stroke?: string;
  strokeWidth: number;
};

const rectPath = (x: number, y: number, w: number, h: number) =>
  `M${x} ${y}h${w}v${h}h${-w}Z`;

// Armoria's templates and patterns are SVG snippets: rect, polygon, path, circle, line and use elements in g
// and pattern groups, which pass down fill, stroke, stroke-width and transform. A use names a charge.
const snippets = new Map<
  string,
  { elements: Element[]; root: Record<string, string> }
>();
function parseSnippet(svg: string) {
  let parsed = snippets.get(svg);
  if (parsed) return parsed;
  const elements: Element[] = [];
  let root: Record<string, string> = {};
  type Inherited = {
    m: Matrix;
    fill?: string;
    stroke?: string;
    strokeWidth: number;
  };
  const stack: Inherited[] = [{ m: IDENTITY, strokeWidth: 1 }];
  for (const [, close, tag, rest, self] of svg.matchAll(
    /<(\/?)(\w+)([^>]*?)(\/?)>/g,
  )) {
    if (close) {
      stack.pop();
      continue;
    }
    const a: Record<string, string> = {};
    for (const [, k, v] of rest.matchAll(/([\w:-]+)="([^"]*)"/g)) a[k] = v;
    const top = stack[stack.length - 1];
    const own: Inherited = {
      m: a.transform ? multiply(top.m, parseTransform(a.transform)) : top.m,
      fill: a.fill ?? top.fill,
      stroke: a.stroke ?? top.stroke,
      strokeWidth: a["stroke-width"] ? +a["stroke-width"] : top.strokeWidth,
    };
    if (tag === "pattern") root = a;
    if (tag === "g" || tag === "pattern") {
      if (!self) stack.push(own);
      continue;
    }
    const n = (k: string) => +(a[k] ?? 0);
    let d: string;
    if (tag === "path") d = a.d;
    else if (tag === "rect")
      d = rectPath(n("x"), n("y"), n("width"), n("height"));
    else if (tag === "polygon") d = `M${a.points}Z`;
    else if (tag === "line") d = `M${n("x1")} ${n("y1")}L${n("x2")} ${n("y2")}`;
    else if (tag === "circle") {
      const [cx, cy, r] = [n("cx"), n("cy"), n("r")];
      d = `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
    } else if (tag === "use") {
      // A semy's charge, in the pattern's second tincture, with its own fills.
      for (const [paint, , , pd, pm] of CHARGES[a.href.slice(1)]) {
        const fill =
          paint === 0
            ? "none"
            : paint === 4
              ? "#000"
              : paint === 5
                ? "#fff"
                : own.fill;
        elements.push({
          d: pd,
          m: pm ? multiply(own.m, pm) : own.m,
          fill,
          strokeWidth: 0,
        });
      }
      continue;
    } else throw new Error(`arms1: unsupported element ${tag}`);
    elements.push({ d, ...own });
    if (self === "") stack.push(own);
  }
  parsed = { elements, root };
  snippets.set(svg, parsed);
  return parsed;
}

// ---- Raster ----

// One filled shape: its edges in pixels, each [top y, bottom y, x at top, dx per dy, winding], sorted by top.
type Shape = { edges: Float64Array; count: number };

function shapeOf(polys: readonly number[][]): Shape {
  const list: number[][] = [];
  for (const p of polys) {
    const n = p.length / 2;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const [x0, y0, x1, y1] = [p[2 * k], p[2 * k + 1], p[2 * j], p[2 * j + 1]];
      if (y0 === y1) continue;
      const [top, bottom, dir] = y0 < y1 ? [y0, y1, 1] : [y1, y0, -1];
      list.push([top, bottom, y0 < y1 ? x0 : x1, (x1 - x0) / (y1 - y0), dir]);
    }
  }
  list.sort((p, q) => p[0] - q[0] || p[2] - q[2]);
  const edges = new Float64Array(list.length * 5);
  list.forEach((e, k) => edges.set(e, k * 5));
  return { edges, count: list.length };
}

// Scratch buffers for scan, grown as needed.
let cover = new Float64Array(0);
let run = new Float64Array(0);
let active = new Int32Array(0);
let crossX = new Float64Array(0);
let crossW = new Int8Array(0);

// Calls `emit` with each pixel's index and the share of it `shape` covers under the nonzero rule. Each pixel
// row takes `rows` sample lines. Along each, the coverage of every pixel is exact, so sloped edges stay smooth
// while flat ones step in 1 / rows. Follows peep1's fill.
function scan(
  { edges, count }: Shape,
  width: number,
  height: number,
  rows: number,
  emit: (i: number, t: number) => void,
) {
  if (count === 0) return;
  if (cover.length < width + 2) {
    cover = new Float64Array(width + 2);
    run = new Float64Array(width + 2);
  }
  if (active.length < count) {
    active = new Int32Array(count);
    crossX = new Float64Array(count);
    crossW = new Int8Array(count);
  }
  let bottom = 0;
  for (let k = 0; k < count; k++) bottom = Math.max(bottom, edges[k * 5 + 1]);
  const y0 = Math.max(0, Math.floor(edges[0]));
  const y1 = Math.min(height, Math.floor(bottom) + 1);
  const share = 1 / rows;
  let next = 0;
  let live = 0;
  // Edges that end above the first row never become active.
  while (next < count && edges[next * 5 + 1] <= y0) next++;
  for (let py = y0; py < y1; py++) {
    let lo = width;
    let hi = -1;
    for (let r = 0; r < rows; r++) {
      const sy = py + (r + 0.5) * share;
      while (next < count && edges[next * 5] <= sy) active[live++] = next++;
      // Crossings on this sample line, sorted by x as they're found.
      let n = 0;
      let keep = 0;
      for (let k = 0; k < live; k++) {
        const e = active[k] * 5;
        if (edges[e + 1] <= sy) continue;
        active[keep++] = active[k];
        const cx = edges[e + 2] + (sy - edges[e]) * edges[e + 3];
        let j = n++;
        while (j > 0 && crossX[j - 1] > cx) {
          crossX[j] = crossX[j - 1];
          crossW[j] = crossW[j - 1];
          j--;
        }
        crossX[j] = cx;
        crossW[j] = edges[e + 4];
      }
      live = keep;
      // Spans where the winding number says inside, added to cover (partial pixels) and run (whole ones).
      let wind = 0;
      for (let k = 0; k < n - 1; k++) {
        wind += crossW[k];
        if (wind === 0) continue;
        const a = Math.max(0, crossX[k]);
        const b = Math.min(width, crossX[k + 1]);
        if (b <= a) continue;
        const ia = Math.floor(a);
        const ib = Math.floor(b);
        if (ia === ib) cover[ia] += (b - a) * share;
        else {
          cover[ia] += (ia + 1 - a) * share;
          run[ia + 1] += share;
          run[ib] -= share;
          cover[ib] += (b - ib) * share;
        }
        lo = Math.min(lo, ia);
        hi = Math.max(hi, ib);
      }
    }
    // Every span wrote between lo and hi, so clearing them leaves the buffers zeroed for the next row.
    let sum = 0;
    for (let px = lo; px <= hi; px++) {
      sum += run[px];
      const t = Math.min(1, sum + cover[px]);
      run[px] = 0;
      cover[px] = 0;
      if (t > 0 && px < width) emit(py * width + px, t);
    }
  }
}

// ---- Drawing ----

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

// Chords stray at most this far from curves, in pixels.
const TOL = 0.2;
// The finest a charge's outline gets, and the shield's outline, in Armoria's 200 units. A unit is about one
// pixel on the desk.
const LINE = 0.9;
const BORDER = 1.5;
// The paper kept around the shield, as a share of the art's short side.
const MARGIN = 0.06;

const getTemplate = (
  obj: { template?: string; templateLined?: (line: string) => string },
  line?: string,
) =>
  !line || line === "straight" || !obj.templateLined
    ? obj.template!
    : obj.templateLined(LINES.data[line]);

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  palette: Palette,
) {
  const coa = generate(stream(seed, 0x0a2b1e5), tincturesOf(palette));
  const shield = SHIELDS[coa.shield];
  const paper = rgb(palette.paper);
  const inks = palette.inks.map(rgb);
  const ink = inks[0];
  const colorOf = (t: Tincture): Rgb => {
    const k = typeof t === "number" ? t : t.t1;
    return k === 0 ? paper : inks[k - 1];
  };

  // Fit the shield's outline in the art, less the margin, and center it.
  const short = Math.min(width, height);
  let [bx0, by0, bx1, by1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { pts } of flatten(shield.path, 0.1))
    for (let k = 0; k < pts.length; k += 2) {
      [bx0, bx1] = [Math.min(bx0, pts[k]), Math.max(bx1, pts[k])];
      [by0, by1] = [Math.min(by0, pts[k + 1]), Math.max(by1, pts[k + 1])];
    }
  const pad = short * MARGIN + (BORDER / 2) * (short / 200);
  const k = Math.min(
    (width - 2 * pad) / (bx1 - bx0),
    (height - 2 * pad) / (by1 - by0),
  );
  const ox = (width - (bx1 - bx0) * k) / 2 - bx0 * k;
  const oy = (height - (by1 - by0) * k) / 2 - by0 * k;
  // Armoria's units to pixels.
  const toPx: Matrix = [k, 0, 0, k, ox, oy];
  const rows = short < 128 ? 16 : short < 512 ? 6 : 4;

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let p = 0; p < data.length; p += 4) {
    data[p] = paper[0];
    data[p + 1] = paper[1];
    data[p + 2] = paper[2];
    data[p + 3] = 255;
  }

  // Paints polygons in pixels, blended by coverage times the mask's.
  const paint = (
    polys: readonly number[][],
    color: Rgb,
    mask: Float32Array | null,
    alpha = 1,
  ) =>
    scan(shapeOf(polys), width, height, rows, (i, t) => {
      const a = t * alpha * (mask ? mask[i] : 1);
      if (a <= 0) return;
      const p = i * 4;
      data[p] += (color[0] - data[p]) * a;
      data[p + 1] += (color[1] - data[p + 1]) * a;
      data[p + 2] += (color[2] - data[p + 2]) * a;
    });
  // A coverage mask of `polys`, or `polys` added to the mask `into`.
  const maskOf = (polys: readonly number[][], into?: Float32Array) => {
    const mask = into ?? new Float32Array(width * height);
    scan(shapeOf(polys), width, height, rows, (i, t) => {
      if (t > mask[i]) mask[i] = t;
    });
    return mask;
  };
  const clip = (mask: Float32Array, by: Float32Array) => {
    for (let i = 0; i < mask.length; i++) mask[i] *= by[i];
    return mask;
  };
  const polysOf = (d: string, m: Matrix) => {
    const full = multiply(toPx, m);
    return flatten(d, TOL / scaleOf(full), full);
  };
  const strokeOf = (d: string, m: Matrix, w: number) => {
    const full = multiply(toPx, m);
    return stroke(flatten(d, TOL / scaleOf(full), full), w * k, 1);
  };
  const pts = (subs: readonly Sub[]) => subs.map((s) => s.pts);

  // An SVG snippet's elements, each filled on its own in `color`.
  const paintSnippet = (svg: string, color: Rgb, mask: Float32Array | null) => {
    for (const e of parseSnippet(svg).elements)
      paint(pts(polysOf(e.d, e.m)), color, mask);
  };

  // A tincture over a region: a flat color, or a pattern tiled from Armoria's origin and cut to each tile.
  const paintTincture = (t: Tincture, mask: Float32Array) => {
    if (typeof t === "number") {
      const c = colorOf(t);
      for (let i = 0; i < mask.length; i++) {
        const a = mask[i];
        if (a <= 0) continue;
        const p = i * 4;
        data[p] += (c[0] - data[p]) * a;
        data[p + 1] += (c[1] - data[p + 1]) * a;
        data[p + 2] += (c[2] - data[p + 2]) * a;
      }
      return;
    }
    const pattern = PATTERNS[t.name];
    const { elements, root } = parseSnippet(
      pattern("p", "T1", "T2", t.size, t.charge),
    );
    const [tw, th] = [+root.width, +root.height];
    const [, , vw, vh] = root.viewBox.split(" ").map(Number);
    // Tile units to pixels, and the size of a pixel in tile units.
    const unit = (tw / vw) * k;
    const pixel = 1 / unit;
    const tileColor = (c?: string): Rgb | null =>
      c === "T1"
        ? colorOf(t.t1)
        : c === "T2"
          ? colorOf(t.t2)
          : c === "#000"
            ? ink
            : c === "#fff"
              ? paper
              : null;
    const [i0, i1] = [Math.floor(bx0 / tw), Math.floor(bx1 / tw)];
    const [j0, j1] = [Math.floor(by0 / th), Math.floor(by1 / th)];
    const tiled = (polys: number[][], color: Rgb) => {
      const out: number[][] = [];
      for (const p of polys) {
        const q = clipRect(p, vw, vh);
        if (q.length < 6) continue;
        for (let i = i0; i <= i1; i++)
          for (let j = j0; j <= j1; j++) {
            const [dx, dy] = [i * tw * k + ox, j * th * k + oy];
            out.push(q.map((v, n) => (n % 2 ? v * unit + dy : v * unit + dx)));
          }
      }
      paint(out, color, mask);
    };
    for (const e of elements) {
      const subs = flatten(e.d, TOL * pixel, e.m);
      const fill = tileColor(e.fill);
      if (fill) tiled(pts(subs), fill);
      // Armoria's thin black pattern outlines are left out; colored strokes are the pattern itself.
      const line =
        e.stroke === "T1" || e.stroke === "T2" ? tileColor(e.stroke) : null;
      if (line) tiled(stroke(subs, e.strokeWidth, pixel), line);
    }
  };

  const drawOrdinary = (
    o: NonNullable<Coa["ordinary"]>,
    color: Rgb,
    mask: Float32Array | null,
  ) => {
    if (o.ordinary === "bordure")
      paint(strokeOf(shield.path, IDENTITY, 33.3), color, mask);
    else if (o.ordinary === "orle")
      paint(
        strokeOf(shield.path, [0.85, 0, 0, 0.85, 15, 15], 8.5),
        color,
        mask,
      );
    else
      paintSnippet(
        getTemplate(ORDINARIES.data[o.ordinary], o.line),
        color,
        mask,
      );
  };

  // A charge at each of its positions, as Armoria's getElTransform places it, in its own tinctures or all in
  // `only`. Outlines are the darkest ink.
  const round = (n: number) => Math.round(n * 100) / 100;
  const positions = shield.positions ?? SHIELDS.spanish.positions!;
  const drawCharge = (
    c: ChargeItem,
    only: Tincture | null,
    mask: Float32Array | null,
  ) => {
    const size = round((c.size ?? 1) * (shield.size ?? 1));
    const sx = c.sinister ? -size : size;
    const sy = c.reversed ? -size : size;
    const parts: readonly ChargePart[] =
      c.charge === "inescutcheon"
        ? [[1, 1, 1, shield.path, [0.33, 0, 0, 0.33, 67, 67]]]
        : CHARGES[c.charge];
    const fills = [
      null,
      colorOf(only ?? c.t),
      colorOf(only ?? c.t2 ?? c.t),
      colorOf(only ?? c.t3 ?? c.t),
      ink,
      paper,
    ];
    for (const letter of c.p) {
      const at = positions[letter];
      if (!at) continue;
      const place: Matrix = [
        sx,
        0,
        0,
        sy,
        round(at[0] - 100 * (sx - 1)),
        round(at[1] - 100 * (sy - 1)),
      ];
      for (const [fill, alpha, width, d, m] of parts) {
        const full = m ? multiply(place, m) : place;
        const subs = polysOf(d, full);
        if (fill) paint(pts(subs), fills[fill]!, mask, alpha);
        if (width) {
          const w = Math.max(width * scaleOf(full), LINE) * k;
          paint(stroke(subs, w, 1), ink, mask);
        }
      }
    }
  };

  // Armoria's Shield.svelte, in its order, with clip paths as masks.
  const shieldMask = maskOf(pts(polysOf(shield.path, IDENTITY)));
  paintTincture(coa.t1, shieldMask);
  const { division, ordinary, charges } = coa;
  if (division) {
    // The field part.
    if (ordinary?.divided === "field")
      drawOrdinary(ordinary, colorOf(ordinary.t), shieldMask);
    else if (ordinary?.divided === "counter")
      drawOrdinary(ordinary, colorOf(division.t), shieldMask);
    for (const c of charges)
      if (c.divided === "field") drawCharge(c, null, shieldMask);
      else if (c.divided === "counter") drawCharge(c, division.t, shieldMask);
    // The division part.
    const divisionMask = new Float32Array(width * height);
    for (const e of parseSnippet(
      getTemplate(DIVISIONS.data[division.division], division.line),
    ).elements)
      maskOf(pts(polysOf(e.d, e.m)), divisionMask);
    clip(divisionMask, shieldMask);
    paintTincture(division.t, divisionMask);
    if (ordinary?.divided === "division")
      drawOrdinary(ordinary, colorOf(ordinary.t), divisionMask);
    else if (ordinary?.divided === "counter")
      drawOrdinary(ordinary, colorOf(coa.t1), divisionMask);
    for (const c of charges)
      if (c.divided === "division") drawCharge(c, null, divisionMask);
      else if (c.divided === "counter") drawCharge(c, coa.t1, divisionMask);
  }
  // Overall.
  if (ordinary && !ordinary.divided)
    drawOrdinary(ordinary, colorOf(ordinary.t), shieldMask);
  for (const c of charges)
    if (!c.divided || !division) drawCharge(c, null, shieldMask);
  paint(strokeOf(shield.path, IDENTITY, BORDER), ink, null);

  ctx.putImageData(image, 0, 0);
}

export const coatOfArms1: Style = {
  id: "arms1",
  draw,
};
