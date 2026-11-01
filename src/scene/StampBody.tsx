import { useFrame, useThree } from "@react-three/fiber";
import {
  CuboidCollider,
  type RapierRigidBody,
  RigidBody,
} from "@react-three/rapier";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import type { DeskStamp } from "../desk/desk";
import { punchGeometry, resolveStamp, type Stamp } from "../stamp";
import { stampGeometry, stampTexture, THICKNESS } from "./stampMesh";

export const DROP_HEIGHT = 4;
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
const SWAY = 0.35;

// One stamp falling like light paper: a thin rigid body with heavy drag that can only turn about the
// vertical, so it always lands art up. The flutter is scripted on top: the art tilts and the body sways side
// to side, both fading out as it nears the desk and ending when it first touches down, which it reports with
// `onLand`. Shortly after landing the body is fixed in place, so a pile of thin stamps can't jostle. A stamp that isn't `shown` stays on the desk as a body
// alone, its mesh and texture released until it comes back into range.
export const StampBody = memo(function StampBody({
  entry: { id, ref, drop },
  shown,
  onLand,
}: {
  entry: DeskStamp;
  shown: boolean;
  onLand: (id: number) => void;
}) {
  // A press always makes a reference to a known source.
  const stamp = useMemo(() => resolveStamp(ref)!, [ref]);
  const body = useRef<RapierRigidBody>(null);
  const art = useRef<Group>(null);
  const { width, height } = punchGeometry(stamp.punch);

  const [p1, p2, w1, w2] = drop.flutter;
  // Set on the first contact, with the desk or with a stamp already lying there. From then on physics has it.
  const landed = useRef(false);
  const settling = useRef(0);
  const [fixed, setFixed] = useState(false);
  useFrame(({ clock }, dt) => {
    const b = body.current;
    const a = art.current;
    if (!b || !a) return;
    if (landed.current) {
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
    // The flutter also fades with height over the desk, so a stamp that reaches it untouched lands flat.
    const fall = Math.min(1, Math.max(0, b.translation().y / FLUTTER_HEIGHT));
    const t = clock.elapsedTime;
    a.rotation.set(
      TILT * fall * Math.sin(w1 * t + p1),
      0,
      TILT * fall * Math.sin(w2 * t + p2),
    );
    const v = b.linvel();
    b.setLinvel(
      {
        x: SWAY * fall * Math.cos(w2 * t + p2),
        y: v.y,
        z: SWAY * fall * Math.cos(w1 * t + p1),
      },
      true,
    );
  });

  return (
    <RigidBody
      ref={body}
      type={fixed ? "fixed" : "dynamic"}
      position={[drop.spot[0], DROP_HEIGHT, drop.spot[1]]}
      rotation={[0, drop.yaw, 0]}
      colliders={false}
      enabledRotations={[false, true, false]}
      linearDamping={2.6}
      angularDamping={1.5}
      gravityScale={1.04}
      ccd
      onCollisionEnter={() => {
        if (landed.current) return;
        landed.current = true;
        onLand(id);
      }}
    >
      <CuboidCollider
        args={[width / 2, THICKNESS / 2, height / 2]}
        friction={0.9}
      />
      <group ref={art}>{shown && <StampMesh stamp={stamp} />}</group>
    </RigidBody>
  );
});

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
