# Open-source generators to port as styles

Several of our hand-written styles read as generic. This is a shortlist of open-source generators by artists with a recognizable hand, found on GitHub on 2026-11-01. Every license below was read from the repo itself. Port means: rewrite as one `Style` with our seeded random, keeping the original copyright notice in the file header and a line in a credits list.

## Fix palettes first

Three separate searches pointed at the same thing: our palettes may cause more of the generic look than any single style. Real stamps print in 2 to 4 inks on paper.

| Repo                                                                                                        | License | Use                                                                                             |
| ----------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| [mattdesl/dictionary-of-colour-combinations](https://github.com/mattdesl/dictionary-of-colour-combinations) | MIT     | 348 combinations from Sanzo Wada's 1930s color book, with CMYK. Best fit for a new palette set. |
| [kgolid/chromotome](https://github.com/kgolid/chromotome)                                                   | MIT     | About 200 artist palettes, each with a separate background and stroke color: paper plus ink.    |
| [mattdesl/riso-colors](https://github.com/mattdesl/riso-colors)                                             | MIT     | Real Risograph ink names and hex values, for `riso1`.                                           |
| [rvanwijnen/spectral.js](https://github.com/rvanwijnen/spectral.js)                                         | MIT     | Pigment-style mixing (blue over yellow gives green), for any overprint style.                   |

Per ADR 0001 this ships as a new palette version, not an edit to `PALETTES_1`.

## Port first

| Repo                                                                          | License           | What it draws                                                                                                      | Effort                                                 |
| ----------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| [LingDong-/fishdraw](https://github.com/LingDong-/fishdraw)                   | MIT               | One invented fish in engraved pen line, with a pseudo-Latin name. Seeded already, outputs polylines.               | Medium, one 2,600-line file, 130 trig calls to replace |
| [LingDong-/nonflowers](https://github.com/LingDong-/nonflowers)               | MIT               | Gongbi-style paintings of imaginary plants. Seeded, already Canvas 2D. Draw one plant per stamp.                   | Medium, one 1,300-line file                            |
| [kgolid/p5ycho](https://github.com/kgolid/p5ycho)                             | MIT               | Kjetil Golid's sketchbook. Best for us: `apparat` (apparatus machines), `patchwork`, `weave`, `topology`.          | Small per sketch, plus a p5 shim                       |
| [kgolid/tilework](https://github.com/kgolid/tilework)                         | MIT               | Quilt blocks from half and quarter-square triangles. No trig.                                                      | Small                                                  |
| [isohedral/tactile-js](https://github.com/isohedral/tactile-js)               | BSD-3             | Craig Kaplan's library for all 81 isohedral tilings. Replaces `tess1` with the real thing.                         | Medium                                                 |
| [Deep-Fold/PixelPlanets](https://github.com/Deep-Fold/PixelPlanets)           | MIT               | Dithered pixel-art planets: terran, ice, lava, gas giant, ringed. Run the shader math per pixel on a ~100 px grid. | Medium                                                 |
| [dicebear Open Peeps](https://www.dicebear.com/styles/open-peeps)             | MIT code, CC0 art | Pablo Stanley's hand-drawn busts from parts. A definitive-stamp portrait.                                          | Medium                                                 |
| [tholman/generative-artistry](https://github.com/tholman/generative-artistry) | MIT               | Tiny homages to Molnar (Un Deux Trois), Nees (Cubic Disarray), Joy Division. Plain canvas already.                 | Small each                                             |

## Worth a second wave

| Repo                                                                                                                                                                                                                                    | License                      | Notes                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| [LingDong-/shan-shui-inf](https://github.com/LingDong-/shan-shui-inf)                                                                                                                                                                   | MIT                          | Ink landscape scroll. Crop to one peak and a boat. Large, dense file, so port after nonflowers.  |
| [inconvergent/sand-spline](https://github.com/inconvergent/sand-spline), [sand-glyphs](https://github.com/inconvergent/sand-glyphs), [fracture](https://github.com/inconvergent/fracture), [tree](https://github.com/inconvergent/tree) | MIT                          | Short Python, Cairo calls map 1:1 to Canvas. The sand technique could be one shared helper.      |
| [anvaka/streamlines](https://github.com/anvaka/streamlines)                                                                                                                                                                             | MIT                          | Evenly spaced flow lines, the Tyler Hobbs look without the tangle.                               |
| [kgolid/topographic](https://github.com/kgolid/topographic)                                                                                                                                                                             | MIT                          | Filled contour bands, screenprinted-map look.                                                    |
| [mewo2/terrain](https://github.com/mewo2/terrain) + [naming-language](https://github.com/mewo2/naming-language)                                                                                                                         | MIT                          | Martin O'Leary's hatched fantasy maps, plus believable place names for any stamp's country line. |
| [nickswalker/marblizer](https://github.com/nickswalker/marblizer)                                                                                                                                                                       | MIT                          | Published marbling math (Lu, Jaffer et al.). Would replace `marble1`.                            |
| [kchapelier/wavefunctioncollapse](https://github.com/kchapelier/wavefunctioncollapse)                                                                                                                                                   | MIT                          | Feed it our own 8x8 knit motifs for Fair Isle bands. Would replace `stitch1`'s engine.           |
| [pmneila/jsexp](https://github.com/pmneila/jsexp)                                                                                                                                                                                       | BSD-3                        | Gray-Scott reaction-diffusion, thresholded to two inks. Watch the CPU budget.                    |
| [isohedral/hatviz](https://github.com/isohedral/hatviz)                                                                                                                                                                                 | BSD-3                        | The 2023 aperiodic hat tiling. A math commemorative.                                             |
| [jdan/isomer](https://github.com/jdan/isomer)                                                                                                                                                                                           | MIT                          | Isometric blocks, for 1960s architecture stamps.                                                 |
| [gwygonik/Spiroh](https://github.com/gwygonik/Spiroh)                                                                                                                                                                                   | Unlicense                    | Guilloche rosettes, as a frame behind a denomination.                                            |
| [techninja/hersheytextjs](https://github.com/techninja/hersheytextjs)                                                                                                                                                                   | MIT                          | Hershey single-stroke engraving fonts for denominations. Saves writing our own numeral font.     |
| [Azgaar/Armoria](https://github.com/Azgaar/Armoria)                                                                                                                                                                                     | MIT code, CC0 simple charges | Coats of arms. Its complex charges are CC BY-NC, so ship only the CC0 ones.                      |
| [fogleman/Tiling](https://github.com/fogleman/Tiling)                                                                                                                                                                                   | MIT                          | Regular polygon tilings and duals.                                                               |

## Ask before using

[kgolid/byrne-generator](https://github.com/kgolid/byrne-generator) draws Oliver Byrne Euclid figures in flat red, yellow and blue on cream, which would make an ideal stamp. [kgolid/ornament](https://github.com/kgolid/ornament) does symmetric medallions. Neither has a LICENSE file. Their package.json files say ISC, which is npm's default and may not be intentional. Ask Kjetil Golid, or write our own from the idea.

## Reference only

These licenses block porting, but the work is worth looking at: watabou's town, compass and rune generators (GPL or none), Jason Webb's growth experiments (CC BY-NC-SA, but the papers behind them are public), mattdesl/subscapes (non-commercial), p5.riso (Anti-Capitalist License), spite/sketch (MIT but WebGL 3D, useful as a hatching reference for `engr1`), eskimoblood/gerstnerizer (none).

## Gaps

No well-made permissive generator turned up for birds, insects, ships, building facades, Celtic knots, woodcut or Swiss posters. For creatures and objects, follow fishdraw's method: a polyline body plan, hatched shading and a caption.

## Porting notes

- Pass our seeded random into each ported module rather than patching `Math.random`.
- Several sources call Perlin noise. One shared seeded value-noise helper with no trig covers them.
- Fine-line output needs strokes of about 1 to 1.5 px at desk size, or it turns grey.
- Trig-heavy sources (fishdraw, nonflowers) need the polynomial or table replacements described in `style-ideas.md`.
