import {
  CanvasTexture,
  ExtrudeGeometry,
  Shape,
  SRGBColorSpace,
  Texture,
  Vector2,
} from "three";
import { punchGeometry, type Stamp } from "../stamp";
import { paintEmboss } from "./emboss";
import { paintFace } from "./face";

// A stamp's paper thickness, in stamp units (a long side is 1).
export const THICKNESS = 0.008;
// Desk stamps draw small, and the detail view redraws at around 2048 px, so zooming in stays sharp. Both are
// pixels along a stamp's long side.
const DESK_TEXTURE = 256;
export const DETAIL_TEXTURE = 2048;
// The embossed edge's height map, in the same pixels. Its slopes are soft, so it needs far fewer than the face.
const EMBOSS_TEXTURE = 1024;

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

// The stamp's face at desk size, as a texture.
export function deskTexture(stamp: Stamp): CanvasTexture {
  const ctx = canvas(1, 1);
  paintFace(ctx, stamp, DESK_TEXTURE, canvas);
  const texture = new CanvasTexture(ctx.canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

// The detail view's large face, painted off the main thread (see face.worker.ts). An ImageBitmap ignores
// flipY, so its rows run top down: the texture flips them back as it samples.
export function faceTexture(bitmap: ImageBitmap): Texture {
  const texture = new Texture(bitmap);
  texture.flipY = false;
  texture.repeat.set(1, -1);
  texture.offset.set(0, 1);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// The detail view's embossed punch edge, as a bump map across the stamp's face (see emboss.ts). Heights, not
// colors, so it stays linear.
export function embossTexture(stamp: Stamp): CanvasTexture {
  const ctx = canvas(1, 1);
  paintEmboss(ctx, stamp.punch, EMBOSS_TEXTURE);
  return new CanvasTexture(ctx.canvas);
}
