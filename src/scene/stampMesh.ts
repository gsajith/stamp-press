import {
  CanvasTexture,
  ExtrudeGeometry,
  Shape,
  SRGBColorSpace,
  Vector2,
} from "three";
import { drawFace, punchGeometry, type Stamp } from "../stamp";

// A stamp's paper thickness, in stamp units (a long side is 1).
export const THICKNESS = 0.008;
// Desk stamps draw small. The detail view will redraw at around 2048 px.
const DESK_TEXTURE = 256;

const canvas = (width: number, height: number) => {
  const c = document.createElement("canvas");
  [c.width, c.height] = [width, height];
  return c.getContext("2d")!;
};

// The punch outline extruded to paper thickness, lying flat with its face up. Group 0 is the face and back,
// mapped edge to edge across the stamp's bounds. Group 1 is the cut edge.
export function stampGeometry(stamp: Stamp): ExtrudeGeometry {
  const { width, height, outline } = punchGeometry(stamp.punch);
  const geometry = new ExtrudeGeometry(
    new Shape(outline.map(([x, y]) => new Vector2(x, y))),
    { depth: THICKNESS, bevelEnabled: false },
  );
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++)
    uv.setXY(
      i,
      position.getX(i) / width + 0.5,
      position.getY(i) / height + 0.5,
    );
  // Centered on its thickness, then laid down: the shape's +y runs away from the camera, its face looks up.
  geometry.translate(0, 0, -THICKNESS / 2);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

// The stamp's face, punched, at desk size. Paper fills in behind the cut, so its edge texels blend to paper
// rather than to transparent black.
export function stampTexture(stamp: Stamp): CanvasTexture {
  const ctx = canvas(DESK_TEXTURE, DESK_TEXTURE);
  const { width, height } = punchGeometry(stamp.punch);
  [ctx.canvas.width, ctx.canvas.height] = [
    Math.round(width * DESK_TEXTURE),
    Math.round(height * DESK_TEXTURE),
  ];
  drawFace(ctx, stamp, DESK_TEXTURE, canvas);
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = stamp.palette.paper;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const texture = new CanvasTexture(ctx.canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
