import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useMemo } from "react";
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
import type { Spot } from "../desk/desk";

export const DESK_COLOR = "#f1ede6";
// The paper you can see, which travels with the camera. Fog hides its edge well inside this.
const SIZE = 200;
// The desk has no edge to fall off: the trail can wander over a hundred units in a long session.
const REACH = 1e4;

// Faint speckle, tiled, so the desk reads as paper rather than flat color.
function grain(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) {
    const shade = 240 + Math.floor(Math.random() * 16);
    ctx.fillStyle = `rgb(${shade},${shade - 2},${shade - 6})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
  }
  const texture = new CanvasTexture(c);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  // One grain tile per desk unit.
  texture.repeat.set(SIZE, SIZE);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

// The warm paper surface stamps land on. The paper you see centers on the camera's `focus`, moved in whole
// grain tiles so the grain stays put on the desk.
export function Desk({ focus }: { focus: Spot }) {
  const texture = useMemo(grain, []);
  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[REACH, 0.5, REACH]}
          position={[0, -0.5, 0]}
          friction={1}
        />
      </RigidBody>
      <mesh
        position={[Math.round(focus[0]), 0, Math.round(focus[1])]}
        rotation-x={-Math.PI / 2}
        receiveShadow
      >
        <planeGeometry args={[SIZE, SIZE]} />
        <meshStandardMaterial color={DESK_COLOR} map={texture} roughness={1} />
      </mesh>
    </>
  );
}
