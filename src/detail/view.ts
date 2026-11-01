import { FLAT, type Tilt } from "./tilt";

// How the detail view shows its stamp, in CSS pixels: `pan` moves its center off the screen's center (x right,
// y down), `zoom` scales it up from fitting the screen, and `tilt` leans it toward the cursor or the finger.
export type View = { pan: [number, number]; zoom: number; tilt: Tilt };
export type Screen = { width: number; height: number };

export const ZOOM = { min: 1, max: 4 } as const;
export const UNMOVED: View = { pan: [0, 0], zoom: 1, tilt: FLAT };

// The stamp's center stays on screen, so a drag can never lose it.
const clamp = ([x, y]: [number, number], { width, height }: Screen) => {
  const within = (v: number, half: number) =>
    Math.min(half, Math.max(-half, v));
  return [within(x, width / 2), within(y, height / 2)] as [number, number];
};

export function panBy(
  view: View,
  dx: number,
  dy: number,
  screen: Screen,
): View {
  return { ...view, pan: clamp([view.pan[0] + dx, view.pan[1] + dy], screen) };
}

// Zooms by `factor` about the point `at`, relative to the screen's center, which stays put under the cursor
// or between the fingers.
export function zoomAt(
  view: View,
  factor: number,
  at: [number, number],
  screen: Screen,
): View {
  const zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, view.zoom * factor));
  const k = zoom / view.zoom;
  const pan: [number, number] = [
    at[0] - (at[0] - view.pan[0]) * k,
    at[1] - (at[1] - view.pan[1]) * k,
  ];
  return { ...view, pan: clamp(pan, screen), zoom };
}
