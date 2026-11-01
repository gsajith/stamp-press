import { useFrame, useThree } from "@react-three/fiber";
import {
  CuboidCollider,
  type RapierRigidBody,
  RigidBody,
  useRapier,
} from "@react-three/rapier";
import { memo, type RefObject, useEffect, useMemo, useRef } from "react";
import { type Camera, type Group, Vector3 } from "three";
import type { DeskStamp } from "../desk/desk";
import { punchGeometry, resolveStamp, type Stamp } from "../stamp";
import { backoff } from "./camera";
import { aimFling, DRAG, flightAt, type Vec3 } from "./fling";
import { stampGeometry, stampTexture, THICKNESS } from "./stampMesh";

// How far in front of the camera a stamp leaves the press, along the line of sight through the button. A
// phone's camera backs off further, and so does the launch, so a stamp leaves at the same size on screen.
const LAUNCH_DISTANCE = 2;
// Below this height, on the way down, physics takes over the flight so the stamp can land on the pile.
const HANDOFF = 0.3;
// The height over which a falling stamp's flutter dies away, so it lands flat.
const FLUTTER_HEIGHT = 1.2;
const TILT = 0.5;
// How far the flutter sways a stamp side to side.
const SWAY = 0.12;

// A stamp's flight from the press: its launch, velocity, how long it lasts and how long it has flown, in
// seconds, and where the script put it last frame.
type Flight = {
  from: Vec3;
  velocity: Vec3;
  duration: number;
  t: number;
  at: Vec3;
};

// One stamp flung from the press like light paper. It leaves from the `press` button's place on screen, just in
// front of the camera, arcs away over the desk, and flutters down onto its spot: the art tilts and sways side to
// side once it's away from the press, both fading out near the desk. The script flies it as a kinematic body, so stamps in the
// air never knock into each other. Near the desk it becomes a thin dynamic body with heavy drag that can only
// turn about the vertical, so physics lands it art up on whatever lies there. It reports its first touch with
// `onLand`, and Rapier puts it to sleep once settled. A stamp that isn't `shown` stays on the desk as a body
// alone, its mesh and texture released until it comes back into range.
export const StampBody = memo(function StampBody({
  entry: { id, ref, drop },
  shown,
  press,
  onLand,
}: {
  entry: DeskStamp;
  shown: boolean;
  press: RefObject<HTMLElement | null>;
  onLand: (id: number) => void;
}) {
  // A press always makes a reference to a known source.
  const stamp = useMemo(() => resolveStamp(ref)!, [ref]);
  const { rapier } = useRapier();
  const body = useRef<RapierRigidBody>(null);
  const art = useRef<Group>(null);
  const { width, height } = punchGeometry(stamp.punch);

  const [p1, p2, w1, w2] = drop.flutter;
  // A stamp waits for its first frame to leave the press, flies on the script, falls under physics near the
  // desk, and has landed from its first contact there, with the desk or a stamp already lying on it.
  const phase = useRef<"press" | "flying" | "falling" | "landed">("press");
  const flight = useRef<Flight>(null);
  useFrame(({ camera, clock, gl }, dt) => {
    const b = body.current;
    const a = art.current;
    if (!b || !a) return;
    if (phase.current === "press") {
      phase.current = "flying";
      const from = launchPoint(camera, gl.domElement, press.current);
      flight.current = { from, ...aimFling(from, drop.spot), t: 0, at: from };
      b.setTranslation({ x: from[0], y: from[1], z: from[2] }, true);
      // The mesh shows from the next frame, once it has moved to the launch.
      return;
    }
    a.visible = true;
    if (phase.current === "landed") {
      // Ease the last of the tilt out rather than snapping flat.
      if (a.rotation.x === 0 && a.rotation.z === 0) return;
      const k = Math.exp(-12 * dt);
      a.rotation.x = Math.abs(a.rotation.x) < 1e-3 ? 0 : a.rotation.x * k;
      a.rotation.z = Math.abs(a.rotation.z) < 1e-3 ? 0 : a.rotation.z * k;
      return;
    }
    const t = clock.elapsedTime;
    // How much the stamp flutters: none near the desk, so it lands flat, and none as it leaves the press. It
    // flutters in over the first half of the flight.
    let flutter = Math.min(1, Math.max(0, b.translation().y / FLUTTER_HEIGHT));
    const f = flight.current;
    if (phase.current === "flying" && f) {
      f.t += dt;
      const [x, y, z] = flightAt(f.from, f.velocity, f.t);
      flutter =
        Math.min(1, Math.max(0, y / FLUTTER_HEIGHT)) *
        Math.min(1, (2 * f.t) / f.duration);
      const at: Vec3 = [
        x + SWAY * flutter * Math.sin(w2 * t + p2),
        y,
        z + SWAY * flutter * Math.sin(w1 * t + p1),
      ];
      if (y < HANDOFF && y < f.at[1]) {
        // Hand over to physics at the speed the script was flying it. A long frame can carry the script below
        // the desk, so the hand-off stays just above it.
        phase.current = "falling";
        b.setBodyType(rapier.RigidBodyType.Dynamic, true);
        b.setTranslation(
          { x: at[0], y: Math.max(at[1], 0.05), z: at[2] },
          true,
        );
        const step = Math.max(dt, 1e-3);
        b.setLinvel(
          {
            x: (at[0] - f.at[0]) / step,
            y: (at[1] - f.at[1]) / step,
            z: (at[2] - f.at[2]) / step,
          },
          true,
        );
      } else {
        b.setNextKinematicTranslation({ x: at[0], y: at[1], z: at[2] });
        f.at = at;
      }
    }
    a.rotation.set(
      TILT * flutter * Math.sin(w1 * t + p1),
      0,
      TILT * flutter * Math.sin(w2 * t + p2),
    );
  });

  return (
    <RigidBody
      ref={body}
      type="kinematicPosition"
      // Parked high over its spot, clear of the desk's stamps, until its first frame moves it to the press.
      position={[drop.spot[0], 100, drop.spot[1]]}
      rotation={[0, drop.yaw, 0]}
      colliders={false}
      enabledRotations={[false, true, false]}
      linearDamping={DRAG}
      angularDamping={1.5}
      gravityScale={1.04}
      ccd
      onCollisionEnter={() => {
        // Only physics lands a stamp. One still waiting or flying passes through what it meets.
        if (phase.current !== "falling") return;
        phase.current = "landed";
        onLand(id);
      }}
    >
      <CuboidCollider
        args={[width / 2, THICKNESS / 2, height / 2]}
        friction={0.9}
      />
      <group ref={art} visible={false}>
        {shown && <StampMesh stamp={stamp} />}
      </group>
    </RigidBody>
  );
});

// Where a stamp leaves the press: LAUNCH_DISTANCE, backed off with the camera, along the line of sight through
// the middle of `press` on screen. Without the button, the middle of the bottom of the screen.
function launchPoint(
  camera: Camera,
  canvas: HTMLCanvasElement,
  press: HTMLElement | null,
): Vec3 {
  const screen = canvas.getBoundingClientRect();
  const button = press?.getBoundingClientRect();
  const x = button
    ? button.left + button.width / 2
    : screen.left + screen.width / 2;
  const y = button ? button.top + button.height / 2 : screen.bottom;
  const ray = new Vector3(
    ((x - screen.left) / screen.width) * 2 - 1,
    -((y - screen.top) / screen.height) * 2 + 1,
    0.5,
  )
    .unproject(camera)
    .sub(camera.position)
    .normalize();
  const p = camera.position
    .clone()
    .addScaledVector(
      ray,
      LAUNCH_DISTANCE * backoff(screen.width / screen.height),
    );
  return [p.x, p.y, p.z];
}

// A stamp's punched paper and printed face. Its geometry and texture live only while it's mounted.
function StampMesh({ stamp }: { stamp: Stamp }) {
  const anisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy());
  const geometry = useMemo(() => stampGeometry(stamp), [stamp]);
  const texture = useMemo(() => {
    const t = stampTexture(stamp);
    t.anisotropy = anisotropy;
    return t;
  }, [stamp, anisotropy]);
  useEffect(
    () => () => {
      geometry.dispose();
      texture.dispose();
    },
    [geometry, texture],
  );
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        attach="material-0"
        map={texture}
        roughness={0.85}
      />
      <meshStandardMaterial
        attach="material-1"
        color={stamp.palette.paper}
        roughness={0.9}
      />
    </mesh>
  );
}
