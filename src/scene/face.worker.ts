import { resolveStamp, type StampRef } from "../stamp";
import { type MakeCanvas, paintFace } from "./face";

// Paints a stamp's face off the main thread, since a 2048 px face can take a second to draw, and sends it
// back as an ImageBitmap. One request per worker: the detail view starts one as it opens, and ends it as it
// closes.
const canvas: MakeCanvas = (width, height) =>
  // The 2D calls the styles make are the same on an OffscreenCanvas.
  new OffscreenCanvas(width, height).getContext(
    "2d",
  ) as unknown as CanvasRenderingContext2D;

self.onmessage = ({ data }: MessageEvent<{ ref: StampRef; size: number }>) => {
  // The page only asks for stamps it has resolved.
  const stamp = resolveStamp(data.ref)!;
  const ctx = canvas(1, 1);
  paintFace(ctx, stamp, data.size, canvas);
  const bitmap = (
    ctx.canvas as unknown as OffscreenCanvas
  ).transferToImageBitmap();
  self.postMessage(bitmap, { transfer: [bitmap] });
};
