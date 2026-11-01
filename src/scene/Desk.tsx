import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useMemo } from "react";
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

export const DESK_COLOR = "#f1ede6";
const SIZE = 200;

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
  texture.repeat.set(SIZE, SIZE);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

// The warm paper surface stamps land on.
export function Desk() {
  const texture = useMemo(grain, []);
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider
        args={[SIZE / 2, 0.5, SIZE / 2]}
        position={[0, -0.5, 0]}
        friction={1}
      />
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[SIZE, SIZE]} />
        <meshStandardMaterial color={DESK_COLOR} map={texture} roughness={1} />
      </mesh>
    </RigidBody>
  );
}
