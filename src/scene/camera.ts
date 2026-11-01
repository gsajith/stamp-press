import { PerspectiveCamera, Plane, Ray, Vector3 } from "three";
import type { Area, Spot } from "../desk/desk";

// Where the camera looks from, relative to the spot it looks at: tilted down and round to one side.
export const VIEW = [0.6, 3.3, 2.4] as const;
export const FOV = 35;

// How far the camera backs off along VIEW on a narrow screen, so a stamp keeps its margins on a phone.
export const backoff = (aspect: number) =>
  aspect < 1 ? Math.min(2, 1 / aspect) ** 0.8 : 1;

// The screen a burst may fill, in normalized device coordinates: clear of the edges, and of the button along
// the bottom.
const SCREEN = { x: 0.85, top: 0.85, bottom: -0.6 };
// Half a stamp's long side, so a stamp centered inside the area shows whole.
const HALF_STAMP = 0.5;

// The desk area on screen for this aspect, as offsets from the spot the camera looks at: the patch of desk
// under the screen, shrunk so a stamp centered anywhere in it shows whole.
export function visibleArea(aspect: number): Area {
  const k = backoff(aspect);
  const camera = new PerspectiveCamera(FOV, aspect);
  camera.position.set(VIEW[0] * k, VIEW[1] * k, VIEW[2] * k);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const desk = new Plane(new Vector3(0, 1, 0), 0);
  const hit = (x: number, y: number) => {
    const toward = new Vector3(x, y, 0.5).unproject(camera);
    const ray = new Ray(
      camera.position,
      toward.sub(camera.position).normalize(),
    );
    // The camera looks down by more than half its field of view, so every ray on screen meets the desk.
    return ray.intersectPlane(desk, new Vector3())!;
  };
  const farLeft = hit(-SCREEN.x, SCREEN.top);
  const farRight = hit(SCREEN.x, SCREEN.top);
  const nearLeft = hit(-SCREEN.x, SCREEN.bottom);
  const nearRight = hit(SCREEN.x, SCREEN.bottom);
  // Moves a corner half a stamp along each of its two edges, or to the middle of an edge too short for that.
  const inset = (corner: Vector3, across: Vector3, along: Vector3): Spot => {
    const step = (to: Vector3) => {
      const d = to.clone().sub(corner);
      return d.multiplyScalar(Math.min(HALF_STAMP / d.length(), 0.5));
    };
    const p = corner.clone().add(step(across)).add(step(along));
    return [p.x, p.z];
  };
  return {
    far: [
      inset(farLeft, farRight, nearLeft),
      inset(farRight, farLeft, nearRight),
    ],
    near: [
      inset(nearLeft, nearRight, farLeft),
      inset(nearRight, nearLeft, farRight),
    ],
  };
}
