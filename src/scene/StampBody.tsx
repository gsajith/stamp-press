import { useFrame, useThree } from "@react-three/fiber";
import {
  CuboidCollider,
  type RapierRigidBody,
  RigidBody,
} from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import type { Group } from "three";
import { punchGeometry, type Stamp } from "../stamp";
import { stampGeometry, stampTexture, THICKNESS } from "./stampMesh";

export type Drop = {
  // Where it lands on the desk, and its turn about the vertical.
  spot: [number, number];
  yaw: number;
  // Random phases and rates, so no two stamps flutter alike.
  flutter: [number, number, number, number];
};

export const DROP_HEIGHT = 4;
// The height over which a falling stamp's flutter dies away, so it lands flat.
const FLUTTER_HEIGHT = 1.2;
const TILT = 0.5;
const SWAY = 0.35;

// One stamp falling like light paper: a thin rigid body with heavy drag that can only turn about the
// vertical, so it always lands art up. The flutter is scripted on top: the art tilts and the body sways side
// to side, both fading out as it nears the desk.
export function StampBody({ stamp, drop }: { stamp: Stamp; drop: Drop }) {
  const body = useRef<RapierRigidBody>(null);
  const art = useRef<Group>(null);
  const anisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy());
  const { width, height } = punchGeometry(stamp.punch);
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

  const [p1, p2, w1, w2] = drop.flutter;
  const landed = useRef(false);
  useFrame(({ clock }) => {
    const b = body.current;
    if (landed.current || !b || !art.current) return;
    const fall = Math.min(1, Math.max(0, b.translation().y / FLUTTER_HEIGHT));
    const t = clock.elapsedTime;
    art.current.rotation.set(
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
    // Down, or resting on another stamp: let physics have it from here.
    if (fall < 0.02) {
      landed.current = true;
      art.current.rotation.set(0, 0, 0);
    }
  });

  return (
    <RigidBody
      ref={body}
      position={[drop.spot[0], DROP_HEIGHT, drop.spot[1]]}
      rotation={[0, drop.yaw, 0]}
      colliders={false}
      enabledRotations={[false, true, false]}
      linearDamping={2.6}
      angularDamping={1.5}
      gravityScale={0.8}
      ccd
    >
      <CuboidCollider
        args={[width / 2, THICKNESS / 2, height / 2]}
        friction={0.9}
      />
      <group ref={art}>
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
      </group>
    </RigidBody>
  );
}
