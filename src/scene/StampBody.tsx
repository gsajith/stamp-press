import { useFrame, useThree } from "@react-three/fiber";
import {
  CuboidCollider,
  type RapierCollider,
  type RapierRigidBody,
  RigidBody,
  useRapier,
} from "@react-three/rapier";
import {
  memo,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Camera, type Group, type Texture, Vector3 } from "three";
import type { DeskStamp } from "../desk/desk";
import { punchGeometry, resolveStamp, type Stamp } from "../stamp";
import { backoff, DISTANCE } from "./camera";
import { aimFling, DRAG, flightAt, type Vec3 } from "./fling";
import type { Placed } from "./placed";
import { deskTexture, stampGeometry, THICKNESS } from "./stampMesh";

// How far in front of the camera a stamp leaves the press, along the line of sight through the button. A
// phone's camera backs off further, and so does the launch, so a stamp leaves at the same size on screen.
const LAUNCH_DISTANCE = 2 * DISTANCE;
// Below this height, on the way down, physics takes over the flight so the stamp can land on the pile.
const HANDOFF = 0.3;
// With reduced motion a stamp skips the fling and drops onto its spot from this height.
const REDUCED_MOTION_HEIGHT = 0.5;
// The height over which a falling stamp's flutter dies away, so it lands flat.
const FLUTTER_HEIGHT = 1.2;
const TILT = 0.5;
// After landing, a stamp settles until it has nearly stopped, or for at most SETTLE_TIME, then it's fixed in
// place. Thin bodies resting on each other otherwise keep trading contact impulses and bounce. It always gets
// MIN_SETTLE first: on the contact frame a stamp can sit inside the desk with almost no speed, and freezing it
// then would leave it buried until Rapier has pushed it back out.
const MIN_SETTLE = 0.25;
const SETTLE_TIME = 0.6;
const REST_SPEED = 0.05;
// How far the flutter sways a stamp side to side.
const SWAY = 0.12;
// How far ahead a falling stamp looks for contacts, in desk units, so it lands on the surface, not in it.
const SOFT_CCD = 0.15;

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
// side once it's away from the press, both fading out near the desk. The script flies it as a kinematic body
// with its collider off, so stamps in the air pass through each other. With reduced motion it skips the fling
// and drops onto its spot from just above. Near the desk it becomes a thin dynamic body with heavy drag that
// can only turn about the vertical, so physics lands it art up on whatever lies there. It reports its first
// touch with `onLand`. Shortly after landing the body is fixed in place, so a pile of thin stamps can't jostle.
// A stamp that isn't `shown` stays on the desk as a body alone, its mesh and texture released until it comes
// back into range. A click on a landed stamp asks to open it with `onOpen`, and while the detail view has it
// `lifted`, it hides here.
export const StampBody = memo(function StampBody({
  entry: { id, ref, drop, landed: settled },
  shown,
  lifted,
  placed,
  press,
  onLand,
  onOpen,
}: {
  entry: DeskStamp;
  shown: boolean;
  lifted: boolean;
  placed: Placed;
  press: RefObject<HTMLElement | null>;
  onLand: (id: number) => void;
  onOpen: (id: number) => void;
}) {
  // A press always makes a reference to a known source.
  const stamp = useMemo(() => resolveStamp(ref)!, [ref]);
  const { rapier } = useRapier();
  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<RapierCollider>(null);
  const art = useRef<Group>(null);
  const { width, height } = punchGeometry(stamp.punch);
  useEffect(() => {
    placed.set(id, { body, width, height });
    return () => void placed.delete(id);
  }, [placed, id, width, height]);
  const cursor = useThree((s) => s.gl.domElement.style);

  const [p1, p2, w1, w2] = drop.flutter;
  // A stamp waits for its first frame to leave the press, flies on the script, falls under physics near the
  // desk, and has landed from its first contact there, with the desk or a stamp already lying on it.
  const phase = useRef<"press" | "flying" | "falling" | "landed">("press");
  const flight = useRef<Flight>(null);
  const settling = useRef(0);
  const [fixed, setFixed] = useState(false);
  useFrame(({ camera, clock, gl }, dt) => {
    const b = body.current;
    const c = collider.current;
    const a = art.current;
    if (!b || !c || !a) return;
    if (phase.current === "press") {
      phase.current = "flying";
      // Stamps in the air pass through each other. Only once physics has it does a stamp touch anything.
      c.setEnabled(false);
      const from: Vec3 = matchMedia("(prefers-reduced-motion: reduce)").matches
        ? [drop.spot[0], REDUCED_MOTION_HEIGHT, drop.spot[1]]
        : launchPoint(camera, gl.domElement, press.current);
      flight.current = { from, ...aimFling(from, drop.spot), t: 0, at: from };
      b.setTranslation({ x: from[0], y: from[1], z: from[2] }, true);
      // The mesh shows from the next frame, once it has moved to the launch.
      return;
    }
    a.visible = !lifted;
    if (phase.current === "landed") {
      if (!fixed) {
        settling.current += dt;
        const v = b.linvel();
        if (
          settling.current > SETTLE_TIME ||
          (settling.current > MIN_SETTLE &&
            Math.hypot(v.x, v.y, v.z) < REST_SPEED)
        )
          setFixed(true);
      }
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
      // A long frame, such as on coming back to the tab, ends the flight at its spot rather than past it.
      f.t = Math.min(f.t + dt, f.duration);
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
        // The body takes its mass from enabled colliders, so it needs the collider back before it can weigh
        // anything. Without mass, contacts can't stop it and it sinks through the desk.
        c.setEnabled(true);
        b.recomputeMassPropertiesFromColliders();
        // CCD only from here. On the script it clamps a stamp's moves against the stamps bunched at the press,
        // so a burst sticks there and then leaps out. Plain CCD still lets a stamp landing at full speed sink
        // below the desk for a few frames, hiding its face: soft CCD sees the contact coming and stops it on
        // the surface.
        b.enableCcd(true);
        b.setSoftCcdPrediction(SOFT_CCD);
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
      // Flying stamps start kinematic and switch to dynamic in the frame loop. A settled stamp is fixed. Keep the
      // other props constant: react-three-rapier re-applies them all, this type included, when any one changes,
      // which would turn a falling stamp kinematic again and leave it hanging in the air.
      type={fixed ? "fixed" : "kinematicPosition"}
      // Parked high over its spot, clear of the desk's stamps, until its first frame moves it to the press.
      position={[drop.spot[0], 100, drop.spot[1]]}
      rotation={[0, drop.yaw, 0]}
      colliders={false}
      enabledRotations={[false, true, false]}
      linearDamping={DRAG}
      angularDamping={1.5}
      gravityScale={1.04}
      onCollisionEnter={() => {
        if (phase.current !== "falling") return;
        phase.current = "landed";
        onLand(id);
      }}
    >
      <CuboidCollider
        ref={collider}
        args={[width / 2, THICKNESS / 2, height / 2]}
        friction={0.9}
      />
      {/* Hidden until the stamp leaves the press. From then on the frame loop shows it unless it's lifted. */}
      <group
        ref={art}
        visible={false}
        onClick={(e) => {
          // Only the stamp on top opens.
          e.stopPropagation();
          onOpen(id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          if (settled) cursor.cursor = "pointer";
        }}
        onPointerOut={() => (cursor.cursor = "")}
      >
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

// The detail view's paper: smoother than on the desk, so it catches a sheen, and how strongly `relief` reads.
const SHEEN_ROUGHNESS = 0.55;
const BUMP = 2;

// A stamp's punched paper and printed face, at desk size or with a larger `face` in its place. Its geometry
// and desk texture live only while it's mounted; `face` and `relief` belong to whoever passes them. `onTop`
// draws it over the whole scene, after the detail view's backdrop, casting no shadow, on smoother paper that
// catches a sheen. `relief`, a height map, embosses the face, so light moves across it as it tilts.
export function StampMesh({
  stamp,
  face,
  relief,
  onTop = false,
}: {
  stamp: Stamp;
  face?: Texture | null;
  relief?: Texture | null;
  onTop?: boolean;
}) {
  const anisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy());
  const geometry = useMemo(() => stampGeometry(stamp), [stamp]);
  const desk = useMemo(() => {
    const t = deskTexture(stamp);
    t.anisotropy = anisotropy;
    return t;
  }, [stamp, anisotropy]);
  useEffect(
    () => () => {
      geometry.dispose();
      desk.dispose();
    },
    [geometry, desk],
  );
  // Drawn last, with no depth test, so neither the desk nor the stamps on it can cut into it. Back faces are
  // culled and the face draws before the cut edge, so it still reads front to back.
  const top = onTop
    ? { transparent: true, depthTest: false, depthWrite: false }
    : {};
  return (
    <mesh
      geometry={geometry}
      castShadow={!onTop}
      receiveShadow={!onTop}
      renderOrder={onTop ? 2 : 0}
    >
      <meshStandardMaterial
        // Three.js only builds a bump map into the shader it compiles first, so the relief arriving swaps in a
        // new material.
        key={relief ? "relief" : "plain"}
        attach="material-0"
        map={face ?? desk}
        roughness={onTop ? SHEEN_ROUGHNESS : 0.85}
        bumpMap={relief ?? null}
        bumpScale={BUMP}
        {...top}
      />
      <meshStandardMaterial
        attach="material-1"
        color={stamp.palette.paper}
        roughness={0.9}
        {...top}
      />
    </mesh>
  );
}
