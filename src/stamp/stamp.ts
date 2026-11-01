import type { Palette } from "./palettes";
import { type Punch, punchFromRandom, punchGeometry } from "./punch";
import { pick, stream } from "./random";
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
// source. Every style shares the draws below, so they are frozen: append new ones, never reorder.
export function resolveStamp(
  ref: StampRef,
  sources: readonly ArtSource[] = SOURCES,
): Stamp | null {
  const source = sources.find((s) => s.id === ref.source);
  if (!source) return null;
  const rand = stream(ref.seed, 0x3b9aca07);
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

// Draws a stamp's art to fill the `width` by `height` pixels at the top left of `ctx`, at any size.
export function drawArt(
  ctx: CanvasRenderingContext2D,
  { art, palette }: Stamp,
  width: number,
  height: number,
) {
  art.style.draw(ctx, width, height, art.seed, palette);
}

// How far the art sits inside the stamp's bounds on every side, in stamp units. A full-bleed stamp's art runs
// into the teeth. Otherwise it sits a margin inside the notches. Frozen, since every style shares it.
export function artInset({ punch, margin }: Stamp): number {
  return margin > 0 ? punch.notch + margin : 0;
}

// Draws a stamp's whole face at `scale` pixels per stamp unit: paper, the art inside its margin, and the punch
// cut out of it, with everything outside the outline left transparent. `canvas` makes a scratch canvas.
export function drawFace(
  ctx: CanvasRenderingContext2D,
  stamp: Stamp,
  scale: number,
  canvas: (width: number, height: number) => CanvasRenderingContext2D,
) {
  const { width, height, outline } = punchGeometry(stamp.punch);
  const [w, h] = [Math.round(width * scale), Math.round(height * scale)];
  ctx.fillStyle = stamp.palette.paper;
  ctx.fillRect(0, 0, w, h);
  const inset = Math.round(artInset(stamp) * scale);
  const [aw, ah] = [w - 2 * inset, h - 2 * inset];
  const art = canvas(aw, ah);
  drawArt(art, stamp, aw, ah);
  ctx.drawImage(art.canvas, inset, inset);
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.beginPath();
  for (const [x, y] of outline)
    ctx.lineTo((x + width / 2) * (w / width), (height / 2 - y) * (h / height));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
