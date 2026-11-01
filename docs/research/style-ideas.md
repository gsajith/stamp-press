# Style ideas

Four agents brainstormed new procedural styles, each from one lens: algorithms, print and craft, subjects, and design traditions plus experiments. They returned 73 ideas. Merging duplicates leaves 66, listed below. Ids are proposals.

## Rules every new style follows

- Pixels match in every browser and in Node (ADR 0001). Only IEEE-exact arithmetic: `+ - * /` and `Math.sqrt`. No `Math.sin`, `Math.pow`, `Math.exp` or `Math.atan2`. Use a polynomial or a table instead, as `rosette1` and `half1` do. This matters most for chaotic simulations, where a last-bit difference grows into a different picture.
- 256 px and 2048 px are the same picture. Detail finer than a 256 px pixel is prefiltered, with analytic coverage like `cover()` in `rosette1` or contrast that fades toward the mean as pixels grow. Simulations run in fixed unit space, so their whole cost lands at 256 too.
- 256 px draws in under about 10 ms on the main thread. 2048 px draws in the worker in under about 1 s.
- Inks come from the palette: paper plus 2 to 4 inks, darkest first.

## Shared helpers worth building once

- A stroke font for numerals, made of path or capsule segments, never a system font. Needed by `swiss1`, `press1`, `map1`, `nest1` and microprinting.
- Microprinting: a border rule that resolves into tiny repeating numerals only at 2048 px. Any style can add it.

## Recommended first wave

Picked for range: each one looks unlike the 10 existing styles and unlike each other, and each is cheap enough to hit the budget without a cache.

| Id         | Idea                                                                                                         | Why first                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `engr1`    | Steel engraving vignette: a lighthouse, ship or lake in an oval frame, all tone made of swelling burin lines | The classic stamp look, and the set has no line-engraved pictorial yet. Reuses `rosette1`'s line coverage. |
| `marble1`  | Paper marbling: combed nonpareil, stone and bouquet patterns                                                 | Closed-form math (Jaffer), every seed is a one-off sheet. Two agents proposed it independently.            |
| `moth1`    | Specimen drawer: pinned moths and beetles built from mirrored parts                                          | Strong silhouette, high hit rate, scales and veins reward zoom.                                            |
| `error1`   | Philatelic error: a simple vignette printed with an inverted center, shifted plate, missing ink or fold      | Errors are what real collectors hunt. A rare inverted center gives the desk a chase.                       |
| `ukiyo1`   | Ukiyo-e woodblock view: peak, wave, moon over pines, with bokashi sky and off-register blocks                | Instantly readable, and seeds read as a numbered series of views.                                          |
| `stars1`   | Made-up sky chart: planisphere with constellations joined by minimum spanning trees                          | Dark ground stands out on the desk. Thousands of faint stars at 2048.                                      |
| `topo1`    | Survey map of an island that doesn't exist: contours, river, spot heights, compass rose                      | Three agents proposed it. Seed digits can print as grid coordinates.                                       |
| `tess1`    | Escher tessellation: interlocking creatures from deformed lattice edges                                      | Every seed is a new species, and the math guarantees no gaps.                                              |
| `girih1`   | Girih star patterns by Hankin's method on a seeded base tiling                                               | Two agents proposed it. Pure geometry, easy to test.                                                       |
| `shell1`   | Seashell from Raup's coiling model, pigment from a 1D cellular automaton                                     | Real biology math. Needs hand-tuned family presets to look good often.                                     |
| `diorama1` | Paper diorama: layered cut-paper ridges and villages with soft shadows between layers                        | The most 3D-looking stamp on the desk.                                                                     |
| `stitch1`  | Cross-stitch sampler: motif in a border band, thread X's on Aida cloth                                       | Tactile at 2048, reads as needlework from across the desk.                                                 |

## Full catalog

### Algorithms

| Id         | Idea                                                                | Cost and risk                               |
| ---------- | ------------------------------------------------------------------- | ------------------------------------------- |
| `marble1`  | Paper marbling                                                      | 5 to 10 ms at 256. Cap the operation count. |
| `topo1`    | Survey contours of an island                                        | 4 to 8 ms. Near the budget.                 |
| `shell1`   | Cone shell with CA pigment                                          | Under 5 ms. Needs presets.                  |
| `apollo1`  | Apollonian gasket of tangent circles                                | 2 ms. Exact math.                           |
| `hyper1`   | Escher Circle Limit hyperbolic tiling in a Poincare disk            | 5 ms.                                       |
| `flow1`    | Wind chart of evenly spaced streamlines around vortices             | 6 to 10 ms.                                 |
| `chladni1` | Sand on a vibrating plate's nodal lines, mode numbers printed small | Under 5 ms. Needs exact cosine.             |
| `glass1`   | Stained glass: relaxed Voronoi panes with lead came around a motif  | 3 to 4 ms.                                  |
| `penrose2` | Penrose or hat aperiodic tiling as zellige                          | 2 to 4 ms.                                  |
| `knot1`    | Celtic knotwork from the grid-with-breaks method                    | 2 to 4 ms. Crossing logic is fiddly.        |
| `vein1`    | Skeletonised leaf by space colonisation                             | 5 to 10 ms. Tight.                          |
| `coral1`   | Gray-Scott reaction-diffusion contoured into two inks               | 20 to 40 ms. Needs a worker and a cache.    |
| `frost1`   | DLA frost, lichen or snowflake                                      | About 10 ms.                                |
| `growth1`  | Differential growth, one crumpled closed line                       | About 15 ms. Needs a cache.                 |
| `harmo1`   | Harmonograph: damped, detuned pendulum spirals                      | 3 ms.                                       |
| `wfc1`     | Nolli-style town plan by wave function collapse                     | Under 5 ms, but restarts make it vary.      |
| `gosper1`  | One space-filling curve: Gosper, Hilbert, Peano or dragon           | 2 ms.                                       |
| `flock1`   | Starling murmuration from boids                                     | About 10 ms.                                |
| `slime1`   | Physarum transport network as a rail map                            | 30 to 60 ms. Needs a worker and a cache.    |

### Print and craft

| Id         | Idea                                                       | Cost and risk                                                   |
| ---------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| `engr1`    | Steel engraving vignette                                   | 4 to 6 ms. Moire near pixel pitch, solved by analytic coverage. |
| `ukiyo1`   | Ukiyo-e woodblock                                          | About 5 ms.                                                     |
| `delft1`   | Delft tile with crazing                                    | About 5 ms.                                                     |
| `stitch1`  | Cross-stitch sampler                                       | About 3 ms.                                                     |
| `diorama1` | Layered paper diorama                                      | About 3 ms.                                                     |
| `shibori1` | Itajime shibori: folded and clamped indigo resist          | About 2 ms. Very low risk.                                      |
| `mezzo1`   | Mezzotint still life glowing from velvet black             | About 3 ms. Grain prefilter is the risk.                        |
| `batik1`   | Batik with crackle veins in the waxed areas                | About 4 ms.                                                     |
| `quilt1`   | Patchwork quilt block with fabric prints and hand quilting | About 3 ms.                                                     |
| `mosaic1`  | Roman mosaic, tesserae following the outline               | About 4 ms. Contour arc length is medium risk.                  |
| `cyano1`   | Cyanotype photogram of ferns, keys and lace                | About 3 ms.                                                     |
| `press1`   | Letterpress wood-type numeral with ink squash and deboss   | About 3 ms. Needs the stroke font.                              |
| `enamel1`  | Cloisonne enamel pin, catches the detail view's sheen      | About 3 ms.                                                     |
| `folkcut1` | Wycinanki or folk papercut, layered and mirror-symmetric   | About 3 ms. Two agents proposed it.                             |
| `pochoir1` | Pochoir stencil Deco fashion plate with stencil bridges    | About 3 ms.                                                     |
| `kilim1`   | Kilim flatweave with slits where colors meet               | About 2 ms.                                                     |

### Subjects

| Id         | Idea                                                            | Cost and risk                                        |
| ---------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| `moth1`    | Specimen drawer of moths and beetles                            | 2 to 4 ms.                                           |
| `light1`   | Lighthouse on a headland, beam on at dusk                       | 1 to 2 ms. Very high hit rate.                       |
| `stars1`   | Made-up sky chart                                               | 1 to 3 ms.                                           |
| `balloon1` | Balloon festival over hills, with a rare special-shape balloon  | About 2 ms.                                          |
| `train1`   | Locomotive side elevation with a wheel arrangement              | 1 to 2 ms. Needs proportion tables per era.          |
| `fungi1`   | Mushroom foray on a log                                         | About 2 ms.                                          |
| `crest1`   | Coat of arms following the rule of tincture, pseudo-Latin motto | About 2 ms. About 10 hand-drawn charges.             |
| `gem1`     | Mineral specimen: crystal cluster or geode                      | About 2 ms.                                          |
| `facade1`  | Row of townhouse fronts with a cat on a sill                    | About 2 ms.                                          |
| `fish1`    | Fish of the reef, or a plate of four                            | About 2 ms.                                          |
| `ship1`    | Ships at sea: galleon, junk or steamer                          | 1 to 2 ms.                                           |
| `orbit1`   | Planet with rings and moons, or a whole orrery                  | About 2 ms.                                          |
| `rocket1`  | Retro rocket from a space race that never ran                   | About 1 ms.                                          |
| `fruit1`   | Fruit cross-section                                             | About 2 ms.                                          |
| `robot1`   | Friendly robot with a serial plate                              | Under 1 ms. Keep it vector to stay unlike `sprite1`. |
| `city1`    | Street plan of a walled old town with a river                   | 5 to 8 ms. Riskiest subject.                         |

### Design traditions and experiments

| Id         | Idea                                                  | Cost and risk                                                                    |
| ---------- | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| `error1`   | Philatelic error                                      | About 2 ms. The vignette set has to be good.                                     |
| `girih1`   | Girih star pattern                                    | About 3 ms.                                                                      |
| `tess1`    | Escher tessellating creatures                         | About 4 ms. Limit edge amplitude.                                                |
| `kamon1`   | Kamon crest on a wagara ground                        | About 3 ms. Never copy real mon. Block the 16-petal chrysanthemum and paulownia. |
| `nest1`    | Stamp of a stamp, Droste-style                        | About 1 ms. Check the recursion against the same-picture rule.                   |
| `deco1`    | Art Deco sunburst with a medallion                    | About 2 ms.                                                                      |
| `cons1`    | Constructivist agitprop: red wedge, bars, pseudo-type | Under 2 ms.                                                                      |
| `swiss1`   | Swiss poster with one huge cropped numeral            | About 1 ms. Keep it from reading as a denomination.                              |
| `opart1`   | Op art bulges and Riley waves                         | About 3 ms. Keep stripes above 2 px at 256.                                      |
| `azul1`    | Azulejo tiles from a mirrored quarter motif           | About 2 ms.                                                                      |
| `memph1`   | Memphis party of squiggles and confetti               | About 2 ms.                                                                      |
| `penrose1` | Impossible objects on an isometric grid               | Under 2 ms. Needs 5 or more figure families.                                     |
| `papel1`   | Papel picado with fold-symmetric cuts                 | About 3 ms. Stick to flowers, birds and geometry.                                |
| `weave1`   | Strip weave of narrow sewn strips                     | About 3 ms. Frame as a generic strip weave, not kente.                           |
| `psych1`   | 1967 psychedelic poster bands                         | About 3 ms, but 400 to 800 ms at 2048.                                           |

Skipped on purpose: Aboriginal-style dot fields. Those designs belong to specific communities, and the Indigenous Art Code objects to generating them.
