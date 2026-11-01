import { drawFace, punchGeometry, type Stamp } from "../stamp";

// Makes a scratch canvas for drawing, on screen or in a worker.
export type MakeCanvas = (
  width: number,
  height: number,
) => CanvasRenderingContext2D;

// Paints the stamp's face, punched, `size` pixels along its long side, onto `ctx`, sizing its canvas to fit.
// Paper fills in behind the cut, so a texture's edge texels blend to paper rather than to transparent black.
// Free of the DOM and three.js, so the detail view's worker paints the same pixels the page would.
export function paintFace(
  ctx: CanvasRenderingContext2D,
  stamp: Stamp,
  size: number,
  canvas: MakeCanvas,
) {
  const { width, height } = punchGeometry(stamp.punch);
  [ctx.canvas.width, ctx.canvas.height] = [
    Math.round(width * size),
    Math.round(height * size),
  ];
  drawFace(ctx, stamp, size, canvas);
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = stamp.palette.paper;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}
