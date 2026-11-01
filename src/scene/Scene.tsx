import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { type RefObject, Suspense, useRef, useState } from "react";
import type { DirectionalLight } from "three";
import { type Desk as DeskState, isNearFocus } from "../desk/desk";
import type { View } from "../detail/view";
import { backoff, FOV, VIEW } from "./camera";
import { Desk, DESK_COLOR } from "./Desk";
import { Lifted } from "./Lifted";
import type { Placed } from "./placed";
import { Rings } from "./Rings";
import { StampBody } from "./StampBody";

// Where the sun shines from, relative to the spot the camera looks at. It travels with the camera, so its shadows do too.
const SUN = [-2.5, 6, 1.5] as const;
// Roughly how long the camera's glide to a new drop takes to cover most of the way, in seconds.
const SMOOTH_TIME = 0.35;

// One step of a critically damped spring from x toward `to`, carrying velocity v, ported from the blind box.
// A goal that moves mid-glide bends the path instead of jerking it. Returns [x, v].
function damp(x: number, v: number, to: number, dt: number): [number, number] {
  const omega = 2 / SMOOTH_TIME;
  const e = omega * dt;
  const decay = 1 / (1 + e + 0.48 * e * e + 0.235 * e * e * e);
  const change = x - to;
  const pull = (v + omega * change) * dt;
  return [to + (change + pull) * decay, (v - omega * pull) * decay];
}

// Glides the camera to look at `focus`, the desk's camera center, backed off on narrow screens. The sun
// follows, so stamps far from the start still cast shadows.
function CameraRig({
  focus,
  sun,
}: {
  focus: [number, number];
  sun: RefObject<DirectionalLight | null>;
}) {
  const aspect = useThree((s) => s.viewport.aspect);
  const look = useRef({ x: focus[0], z: focus[1], vx: 0, vz: 0 });
  useFrame(({ camera }, dt) => {
    const l = look.current;
    [l.x, l.vx] = damp(l.x, l.vx, focus[0], dt);
    [l.z, l.vz] = damp(l.z, l.vz, focus[1], dt);
    const k = backoff(aspect);
    camera.position.set(l.x + VIEW[0] * k, VIEW[1] * k, l.z + VIEW[2] * k);
    camera.lookAt(l.x, 0, l.z);
    const light = sun.current;
    if (!light) return;
    light.position.set(l.x + SUN[0], SUN[1], l.z + SUN[2]);
    light.target.position.set(l.x, 0, l.z);
    light.target.updateMatrixWorld();
  });
  return null;
}

// The desk in 3D, and a focus ring over each stamp lying on screen, in drop order, so the keyboard and screen
// readers reach them too. Clicking a stamp or pressing a ring asks to open it with `onOpen`. The open stamp
// lifts into the detail view, panned and zoomed by `view`, and stays lifted until it has settled back.
export default function Scene({
  desk,
  view,
  onLand,
  onOpen,
}: {
  desk: DeskState;
  view: RefObject<View>;
  onLand: (id: number) => void;
  onOpen: (id: number) => void;
}) {
  const sun = useRef<DirectionalLight>(null);
  const [placed] = useState<Placed>(() => new Map());
  const [rings] = useState(() => new Map<number, HTMLButtonElement>());
  const { focus, open } = desk;
  // The stamp up in the detail view or on its way back down. A new open takes over at once.
  const [lifted, setLifted] = useState(open);
  if (open !== null && open !== lifted) setLifted(open);
  const ringed = desk.stamps.filter((s) => s.landed && isNearFocus(desk, s));
  return (
    <>
      <Canvas
        shadows
        // Untoned, so the paper stays paper white and the inks print as drawn.
        flat
        dpr={[1, 2]}
        camera={{ fov: FOV, position: [...VIEW], near: 0.1, far: 60 }}
        aria-hidden
      >
        <color attach="background" args={[DESK_COLOR]} />
        <fog attach="fog" args={[DESK_COLOR, 9, 22]} />
        <CameraRig focus={focus} sun={sun} />
        <Rings placed={placed} rings={rings} />
        <hemisphereLight args={["#ffffff", "#e4e4e4", 1.7]} />
        <directionalLight
          ref={sun}
          position={[...SUN]}
          color="#ffffff"
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
            <Desk focus={focus} />
            {desk.stamps.map((entry) => (
              <StampBody
                key={entry.id}
                entry={entry}
                shown={isNearFocus(desk, entry)}
                lifted={entry.id === lifted}
                placed={placed}
                onLand={onLand}
                onOpen={onOpen}
              />
            ))}
          </Physics>
          {lifted !== null && (
            <Lifted
              key={lifted}
              entry={desk.stamps[lifted]}
              placed={placed}
              view={view}
              leaving={open !== lifted}
              onDown={() => setLifted(null)}
            />
          )}
        </Suspense>
      </Canvas>
      <div className="rings">
        {ringed.map((s) => (
          <button
            key={s.id}
            ref={(el) => {
              if (!el) return;
              rings.set(s.id, el);
              return () => void rings.delete(s.id);
            }}
            type="button"
            className="ring"
            data-stamp={s.id}
            aria-label={`Stamp ${s.id + 1}`}
            onClick={() => onOpen(s.id)}
          />
        ))}
      </div>
    </>
  );
}
