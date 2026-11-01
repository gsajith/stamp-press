import { type Punch, punchGeometry } from "../stamp";

// How far in from the cut the embossed ridge peaks, in stamp units (a long side is 1).
export const RIDGE = 0.01;
// The height of the paper inside the ridge, where the art lies flat, from 0 at the cut to 1 on the ridge.
const PLATEAU = 0.6;
// Grey levels from the cut to the plateau. More makes a smoother slope.
const STEPS = 32;

const smooth = (t: number) => t * t * (3 - 2 * t);
// The paper's height `d` in from the cut: it rises to the ridge, then eases down onto the plateau by 3 * RIDGE.
const height = (d: number) =>
  d < RIDGE
    ? smooth(d / RIDGE)
    : 1 - (1 - PLATEAU) * smooth(Math.min(1, (d - RIDGE) / (2 * RIDGE)));

// Paints the height map behind the detail view's embossed punch edge, `size` pixels along the stamp's long
// side, sizing its canvas to fit: a raised ridge that follows the cut, teeth and notches alike. Ever narrower
// strokes along the cut each paint the height at their half width, so every pixel ends up with the height for
// its distance from the cut. Mapped edge to edge across the stamp's bounds, like its face.
export function paintEmboss(
  ctx: CanvasRenderingContext2D,
  punch: Punch,
  size: number,
) {
  const { width, height: tall, outline } = punchGeometry(punch);
  [ctx.canvas.width, ctx.canvas.height] = [
    Math.round(width * size),
    Math.round(tall * size),
  ];
  const grey = (h: number) => {
    const v = Math.round(255 * h);
    return `rgb(${v}, ${v}, ${v})`;
  };
  // Stamp units, centered, y up, as the outline runs.
  ctx.setTransform(
    size,
    0,
    0,
    -size,
    ctx.canvas.width / 2,
    ctx.canvas.height / 2,
  );
  ctx.beginPath();
  for (const [x, y] of outline) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fillStyle = grey(PLATEAU);
  ctx.fill();
  ctx.lineJoin = "round";
  for (let i = STEPS; i > 0; i--) {
    const d = (3 * RIDGE * i) / STEPS;
    ctx.lineWidth = 2 * d;
    ctx.strokeStyle = grey(height(d));
    ctx.stroke();
  }
  // Trims the strokes back to the paper, then sets it on the cut's height, 0. A clip would leave a stray bright
  // pixel along the cut, where the fill's soft edge pokes out from under it.
  ctx.globalCompositeOperation = "destination-in";
  ctx.fill();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = grey(0);
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.globalCompositeOperation = "source-over";
}
