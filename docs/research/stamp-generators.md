# Stamp art generators: survey

Research for stamp press: one generator per style, `seed -> canvas`, cut with a perforated edge.
Researched 2026-11-01.

## 1. Existing stamp makers

Nothing on the web generates postage stamps procedurally from a seed. That gap is the opening.

- Rubber stamp and seal editors (EditStamp, Stampdy, Stamps Designer) are template tools: circle or
  rectangle frame, ring text, a clip-art icon. They produce office seals, not postage.
  [stampdy](https://stamp.nuxt.dev/stamp-maker), [stampsdesigner](https://stampsdesigner.pages.dev/blog/articles/stamp-templates-custom-stamps)
- Personalized postage services (for example Luxembourg Post) drop your photo into a fixed frame.
  [postphilately.lu](https://postphilately.lu/en-US/Page/MengPost)
- Generative stamp series on fxhash: "Stamps of Onablo" renders pixel art as an album of stamps;
  "Stamps of the digital skin" turns pre-Columbian stamp motifs into JS stamping processes.
  [Onablo](https://www.raster.art/artwork/stamps-of-onablo-by-tamas-antal/about),
  [digital skin](https://www.raster.art/artwork/stamps-of-the-digital-skin-by-henry-lamina/about)
- billguo.me shows six postage-stamp thumbnails as project cards. The site has no write-up or code
  for how they are made. [billguo.me](https://billguo.me)

Takeaway: prior art is either templates or one-look generative series. A press with many styles is new.

## 2. Styles that work at stamp size

Stamp art reads at roughly 200 to 400 px. Rules that hold across styles: 2 to 4 flat inks, one big
shape or a dense even texture, no fine detail under 2 px, a clear figure against the field.

Difficulty: S = an afternoon, M = a day or two, L = a week. "Stampy" = how much it reads as a stamp.

| Style                                                         | Difficulty | Stampy      | Notes                                                                                                        |
| ------------------------------------------------------------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| Landscape silhouette (layered ridges, sun disc, sky gradient) | S          | High        | Noise ridgelines, 3 to 5 layers lerped to the horizon colour. Classic scenic stamp.                          |
| Bauhaus / Swiss geometric grid                                | S          | High        | Grid of cells, each a circle, quarter circle, half disc or triangle in a 3-ink palette.                      |
| Truchet tiles                                                 | S          | Medium-high | Quarter-arc or diagonal tiles, random rotation. Multi-scale Truchet looks richer.                            |
| Riso overprint (2 to 3 offset shapes, multiply blend)         | S          | High        | `globalCompositeOperation = "multiply"` plus a 1 to 3 px misregistration per ink. Doubles as a shared layer. |
| Halftone portrait or object                                   | M          | High        | Draw a shape to an offscreen canvas, then resample as dots on a rotated grid.                                |
| Memphis pattern                                               | S          | Medium      | Scattered squiggles, zigzags, dots, confetti on a pastel field. Busy, reads as a pattern stamp.              |
| Op-art (concentric rings, warped stripes)                     | S          | Medium-high | Stripe field bent by a bulge function. Strong at tiny sizes because contrast is high.                        |
| Topographic contours                                          | M          | Medium      | Noise field, marching squares, stroke iso-lines. Good map stamp with a pin or label.                         |
| Flow field lines                                              | M          | Medium      | Pretty, but thin lines mush at small size. Use thick strokes and few lines.                                  |
| Botanical L-system                                            | M          | High        | Single plant centred on a plain field. Reads like a flora series stamp.                                      |
| Pixel art sprite                                              | S          | Medium-high | Mirrored random mask, 8 to 16 px grid scaled up crisp. Fun "8-bit post" series.                              |
| Mondrian / cubic disarray                                     | S          | Medium      | Recursive splits with 3 fills. Easy, a bit generic alone.                                                    |
| Linocut / woodcut                                             | L          | High        | Needs carved hatch lines clipped to shapes and rough edges. Hard to make convincing.                         |
| Mosaic / Voronoi tiles                                        | M          | Medium      | Voronoi cells with a grout gap, coloured from a hidden image.                                                |
| Guilloche rosette                                             | S          | Very high   | Parametric spirograph curves. Banknote and stamp security look in about 30 lines.                            |
| Mid-century illustration (flat shapes, grain)                 | L          | Very high   | Needs composed subjects (birds, rockets, fruit). Best as a later "subject" style.                            |

## 3. Code and articles

Flow fields and noise

- Tyler Hobbs, "Flow Fields" essay (angle grid, step length, start points, distortions).
  https://www.tylerxhobbs.com/words/flow-fields

Tiles and grids

- Multi-scale Truchet tiles in JS, with geometry explained. https://alexwlchan.net/2025/truchet-tiles/
- p5 Truchet basics. https://happycoding.io/tutorials/p5js/images/truchet-tiles
- Generative Artistry tutorials: Tiled Lines, Cubic Disarray, Joy Division, Mondrian, all Canvas2D.
  https://generativeartistry.com/tutorials/
- Bauhaus/Swiss generator "zurich" (p5). https://github.com/IamRifki/zurich
- Bauhaus quadtree SVG tool "qqquad". https://fffuel.co/qqquad/
- p5 grid pattern experiments (MIT). https://github.com/b2renger/p5js_patterns
- Memphis pattern generator (Paper.js). https://github.com/leomuehlfeld/Memphis-Pattern-Generator

Print effects

- p5.riso: ink layers, halftones, overprint. https://antiboredom.github.io/p5.riso/
- Codrops, risograph with WebGL (one pass per ink). https://tympanus.net/codrops/2024/06/27/digital-meets-physical-risograph-printing-with-webgl/
- Halftone on Canvas2D from scratch. https://anderoonies.github.io/projects/halftone
- Hatching fields paper (Philbrick and Kaplan 2022). https://cs.uwaterloo.ca/~csk/publications/Papers/philbrick_kaplan_2022.pdf
- Matt DesLauriers hatch-fill gist (canvas-sketch-util). https://gist.github.com/mattdesl/444f1c967f31535bc5982012c74c63df
- Linocut from JS, and why texture is the hard part. https://meowni.ca/posts/tree-rings/

Subjects

- Layered mountain landscape (p5). https://github.com/erdry/a-sun-day and
  https://editor.p5js.org/jonfroehlich/sketches/KFDQe5sbQ
- SVG landscape write-up (sunset palette via midpoint colour). https://kwa.ng/procedurally-generated-svg-landscapes
- L-systems on canvas. https://github.com/Auoja/lindenmayer.js
- Pixel sprites from mirrored masks. https://github.com/zfedoran/pixel-sprite-generator
- Seeded sprite generator, tiny (MIT). https://github.com/KilledByAPixel/ZzSprite
- Contours via marching squares. https://github.com/d3/d3-contour,
  https://observablehq.com/@mahog/marching-squares
- Guilloche rosettes on canvas. https://github.com/binarymax/guilloche

## 4. What makes a stamp read as a stamp

From [Wikipedia: postage stamp design](https://en.wikipedia.org/wiki/Postage_stamp_design) and
philatelic glossaries ([stampcommunity](https://stampcommunity.org/dictionary/stamps_d.asp)):

- Denomination is the most important element. A big numeral in a corner ("45", "1.20") does more
  than any frame.
- Country name, required by UPU rules for international mail (UK excepted). Use a made-up country
  or the app name.
- Purpose line: "POSTAGE", "AIR MAIL", "PAR AVION". Tiny caps text along an edge.
- Frame: a thin keyline inset from the edge with a white margin between art and perforations.
  Ornate frames and corner blocks for older styles.
- Limited inks. Most stamps print in 1 to 4 colours, often on cream paper.
- Intaglio engraving: fine parallel lines for tone, slightly raised ink. Guilloche rosettes behind
  the denomination as security pattern.
- Series identity: same frame, same type, different art. This maps to "style = series".
- Optional wear: a wavy cancellation postmark over a corner, a slight colour shift, paper grain.

## Shared layer proposal

One `finishStamp(ctx, seed, art)` pass shared by every style, cheapest first:

1. Paper: cream fill plus a faint noise grain.
2. Art clipped to an inner rect with a 6 to 8 percent white margin.
3. Palette clamp: each style draws from a seeded 2 to 4 ink palette. Optional multiply overprint
   with 1 to 2 px misregistration for riso flavour.
4. Keyline frame around the art.
5. Text: denomination numeral, country or series name, tiny "POSTAGE" line. One condensed font.
6. Optional postmark: concentric circle with date text and 4 to 5 wavy lines, at low alpha.

Steps 1, 2, 4 and 5 make even plain art read as a stamp. Steps 3 and 6 add variety for free.
