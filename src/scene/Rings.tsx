import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import { Quaternion, Vector3 } from "three";
import type { Placed } from "./placed";

// Keeps each stamp's focus ring, a button over the Canvas, on the stamp it stands for: around the box its
// corners make on screen. A stamp whose center is off screen hides its ring, which takes it out of the Tab
// order until it comes back.
export function Rings({
  placed,
  rings,
}: {
  placed: Placed;
  rings: Map<number, HTMLButtonElement>;
}) {
  const scratch = useMemo(
    () => ({
      corner: new Vector3(),
      center: new Vector3(),
      turn: new Quaternion(),
    }),
    [],
  );
  useFrame(({ camera, size }) => {
    const { corner, center, turn } = scratch;
    for (const [id, ring] of rings) {
      const stamp = placed.get(id);
      const body = stamp?.body.current;
      if (!stamp || !body) continue;
      center.copy(body.translation());
      turn.copy(body.rotation());
      let [left, right, top, bottom] = [
        Infinity,
        -Infinity,
        Infinity,
        -Infinity,
      ];
      for (const [x, z] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        corner
          .set((x * stamp.width) / 2, 0, (z * stamp.height) / 2)
          .applyQuaternion(turn)
          .add(center)
          .project(camera);
        const sx = ((corner.x + 1) / 2) * size.width;
        const sy = ((1 - corner.y) / 2) * size.height;
        [left, right] = [Math.min(left, sx), Math.max(right, sx)];
        [top, bottom] = [Math.min(top, sy), Math.max(bottom, sy)];
      }
      center.project(camera);
      ring.hidden = Math.abs(center.x) > 1 || Math.abs(center.y) > 1;
      if (ring.hidden) continue;
      Object.assign(ring.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${right - left}px`,
        height: `${bottom - top}px`,
      });
    }
  });
  return null;
}
