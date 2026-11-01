import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { Suspense } from "react";
import { Desk, DESK_COLOR } from "./Desk";
import { type Drop, StampBody } from "./StampBody";
import type { Stamp } from "../stamp";

export type DeskStamp = { id: number; stamp: Stamp; drop: Drop };

// Where the camera looks from, relative to the spot it looks at: tilted down and round to one side.
const VIEW = [0.6, 3.3, 2.4] as const;

// Backs the camera off on narrow screens so a stamp keeps its margins on a phone.
function CameraRig() {
  const aspect = useThree((s) => s.viewport.aspect);
  useFrame(({ camera }) => {
    const k = aspect < 1 ? Math.min(2, 1 / aspect) ** 0.8 : 1;
    camera.position.set(VIEW[0] * k, VIEW[1] * k, VIEW[2] * k);
    camera.lookAt(0, 0, 0);
  });
  return null;
}

export default function Scene({ stamps }: { stamps: DeskStamp[] }) {
  return (
    <Canvas
      shadows
      // Untoned, so the paper stays paper white and the inks print as drawn.
      flat
      dpr={[1, 2]}
      camera={{ fov: 35, position: [...VIEW], near: 0.1, far: 60 }}
      aria-hidden
    >
      <color attach="background" args={[DESK_COLOR]} />
      <fog attach="fog" args={[DESK_COLOR, 9, 22]} />
      <CameraRig />
      <hemisphereLight args={["#fffaf0", "#e8dfd0", 1.7]} />
      <directionalLight
        position={[-2.5, 6, 1.5]}
        color="#fff6e8"
        intensity={1.7}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.01}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
      />
      <Suspense fallback={null}>
        <Physics>
          <Desk />
          {stamps.map(({ id, stamp, drop }) => (
            <StampBody key={id} stamp={stamp} drop={drop} />
          ))}
        </Physics>
      </Suspense>
    </Canvas>
  );
}
