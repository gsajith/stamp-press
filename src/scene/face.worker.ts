import { resolveStamp, type StampRef } from "../stamp";
import { EMBOSS_TEXTURE, paintEmboss } from "./emboss";
import { type MakeCanvas, paintFace } from "./face";

// Paints a stamp's face off the main thread, since a 2048 px face can take a second to draw, along with its
// embossed edge's height map, and sends both back as ImageBitmaps. One request per worker: the detail view
// starts one as it opens, and ends it as it closes.
const canvas: MakeCanvas = (width, height) =>
  // The 2D calls the styles make are the same on an OffscreenCanvas.
  new OffscreenCanvas(width, height).getContext(
    "2d",
  ) as unknown as CanvasRenderingContext2D;

// What the worker sends back.
export type Painted = { face: ImageBitmap; relief: ImageBitmap };

self.onmessage = ({ data }: MessageEvent<{ ref: StampRef; size: number }>) => {
  // The page only asks for stamps it has resolved.
  const stamp = resolveStamp(data.ref)!;
  const bitmap = (ctx: CanvasRenderingContext2D) =>
    (ctx.canvas as unknown as OffscreenCanvas).transferToImageBitmap();
  const face = canvas(1, 1);
  paintFace(face, stamp, data.size, canvas);
  const relief = canvas(1, 1);
  paintEmboss(relief, stamp.punch, EMBOSS_TEXTURE);
  const painted: Painted = { face: bitmap(face), relief: bitmap(relief) };
  self.postMessage(painted, { transfer: [painted.face, painted.relief] });
};
