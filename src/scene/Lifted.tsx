import { useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import {
  Euler,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type PerspectiveCamera,
  type PointLight,
  Quaternion,
  type Texture,
  Vector3,
} from "three";
import type { DeskStamp } from "../desk/desk";
import { lean, settle } from "../detail/tilt";
import type { View } from "../detail/view";
import { punchGeometry, resolveStamp } from "../stamp";
import { DESK_COLOR } from "./Desk";
import type { Placed } from "./placed";
import { StampMesh } from "./StampBody";
import { DETAIL_TEXTURE, embossTexture, faceTexture } from "./stampMesh";

// How far in front of the camera the stamp floats, in desk units. Its scale, not its distance, makes it fill
// the screen, so it stays well clear of the camera's near plane however far it zooms.
const DISTANCE = 2;
// How much of the screen's width or height the stamp fills, whichever runs out first, before zooming.
const FILL = 0.8;
// Seconds to lift from the desk, and to settle back.
const LIFT_TIME = 0.45;
// How far the desk fades behind the stamp once it's up.
const BACKDROP = 0.75;
// A soft white light up and to the left, between the camera and the stamp, whose sheen slides across the
// paper as it tilts. In camera space, in desk units, with its reach kept short of the desk.
const SHEEN = { at: [-0.8, 0.9, -0.9], intensity: 0.7, reach: 2.4 } as const;

// Turns a stamp lying face up, its top away from the camera, to face the camera upright.
const FACING = new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0));
const ease = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

// The detail view's stamp, in the Canvas: the open stamp, drawn here in place of its desk mesh, lifts from
// where it lies to float face on in front of the camera, while the desk fades behind it. There it pans, zooms
// and tilts with `view`, which the detail view's gestures write and this steps the tilt's spring in. Its paper
// is embossed along the punch, and a light up close puts a sheen on it, unless the visitor prefers reduced
// motion, which keeps it flat. It lifts with its desk texture while a worker
// redraws it at DETAIL_TEXTURE, swaps that in when it's ready, and releases it on unmount. `leaving` takes it
// back down, then `onDown`.
export function Lifted({
  entry,
  placed,
  view,
  leaving,
  onDown,
}: {
  entry: DeskStamp;
  placed: Placed;
  view: RefObject<View>;
  leaving: boolean;
  onDown: () => void;
}) {
  const stamp = useMemo(() => resolveStamp(entry.ref)!, [entry.ref]);
  const { width, height } = punchGeometry(stamp.punch);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const anisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy());
  const group = useRef<Group>(null);
  const backdrop = useRef<Mesh>(null);
  const sheen = useRef<PointLight>(null);
  const [still] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const relief = useMemo(() => embossTexture(stamp), [stamp]);
  useEffect(() => () => relief.dispose(), [relief]);
  // The lift's progress: 0 on the desk, 1 up.
  const t = useRef(0);
  const down = useRef(false);
  const [face, setFace] = useState<Texture | null>(null);
  const wanted = !leaving && !face;
  useEffect(() => {
    if (!wanted) return;
    const worker = new Worker(new URL("./face.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }: MessageEvent<ImageBitmap>) => {
      const texture = faceTexture(data);
      texture.anisotropy = anisotropy;
      setFace(texture);
    };
    // If it fails, the stamp stays at desk size.
    worker.postMessage({ ref: entry.ref, size: DETAIL_TEXTURE });
    return () => worker.terminate();
  }, [wanted, entry.ref, anisotropy]);
  useEffect(
    () => () => {
      face?.dispose();
      (face?.image as ImageBitmap | undefined)?.close();
    },
    [face],
  );

  // Where it lies on the desk, read as it opens: a stamp only opens once it has landed and gone still.
  const [from] = useState(() => {
    const body = placed.get(entry.id)?.body.current;
    const [x, z] = entry.drop.spot;
    return {
      position: body
        ? new Vector3().copy(body.translation())
        : new Vector3(x, 0, z),
      quaternion: body
        ? new Quaternion().copy(body.rotation())
        : new Quaternion().setFromEuler(new Euler(0, entry.drop.yaw, 0)),
    };
  });
  const scratch = useMemo(
    () => ({
      position: new Vector3(),
      quaternion: new Quaternion(),
      along: new Vector3(),
      tilt: new Quaternion(),
      euler: new Euler(),
    }),
    [],
  );

  useFrame((_, delta) => {
    const g = group.current;
    const b = backdrop.current;
    const l = sheen.current;
    if (!g || !b || !l) return;
    const step = (leaving ? -delta : delta) / LIFT_TIME;
    t.current = Math.min(1, Math.max(0, t.current + step));
    const e = ease(t.current);

    // The view's height at the stamp, in desk units, and so the scale that fits it and the size of a pixel.
    const tall = 2 * DISTANCE * Math.tan((camera.fov * Math.PI) / 360);
    const fit = FILL * Math.min((tall * camera.aspect) / width, tall / height);
    const pixel = tall / size.height;
    if (!still)
      view.current = {
        ...view.current,
        tilt: settle(view.current.tilt, delta),
      };
    const { pan, zoom, tilt: leaning } = view.current;
    const { position, quaternion, along, tilt, euler } = scratch;
    position
      .copy(camera.position)
      .add(along.set(0, 0, -DISTANCE).applyQuaternion(camera.quaternion))
      .add(
        along
          .set(pan[0] * pixel, -pan[1] * pixel, 0)
          .applyQuaternion(camera.quaternion),
      );
    // Leans about the screen's axes, then faces the camera.
    tilt.setFromEuler(euler.set(...lean(leaning, zoom), 0));
    quaternion.copy(camera.quaternion).multiply(tilt).multiply(FACING);
    g.position.lerpVectors(from.position, position, e);
    g.quaternion.slerpQuaternions(from.quaternion, quaternion, e);
    g.scale.setScalar(1 + (fit * zoom - 1) * e);

    // The backdrop hangs just behind the stamp, filling the view.
    b.position
      .copy(camera.position)
      .add(along.set(0, 0, -DISTANCE - 1).applyQuaternion(camera.quaternion));
    b.quaternion.copy(camera.quaternion);
    (b.material as MeshBasicMaterial).opacity = BACKDROP * e;
    l.position
      .copy(camera.position)
      .add(along.set(...SHEEN.at).applyQuaternion(camera.quaternion));
    l.intensity = SHEEN.intensity * e;

    if (leaving && t.current === 0 && !down.current) {
      down.current = true;
      onDown();
    }
  });

  return (
    <>
      <mesh ref={backdrop} renderOrder={1} frustumCulled={false}>
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial
          color={DESK_COLOR}
          transparent
          opacity={0}
          depthTest={false}
          depthWrite={false}
          fog={false}
        />
      </mesh>
      <pointLight
        ref={sheen}
        color="#ffffff"
        intensity={0}
        distance={SHEEN.reach}
      />
      <group ref={group}>
        <StampMesh stamp={stamp} face={face} relief={relief} onTop />
      </group>
    </>
  );
}
