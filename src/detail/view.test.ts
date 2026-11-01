import { describe, expect, it } from "vitest";
import { FLAT, flick } from "./tilt";
import { panBy, type View, ZOOM, zoomAt } from "./view";

const SCREEN = { width: 800, height: 600 };
const START: View = { pan: [0, 0], zoom: 1, tilt: FLAT };
// Where a point on the stamp, `p` pixels from its center at zoom 1, sits on screen.
const onScreen = ({ pan, zoom }: View, p: [number, number]) => [
  pan[0] + p[0] * zoom,
  pan[1] + p[1] * zoom,
];

describe("detail view", () => {
  it("keeps the point under the cursor in place as it zooms", () => {
    const view = zoomAt(START, 2, [100, -50], SCREEN);
    expect(view.zoom).toBe(2);
    expect(onScreen(view, [100, -50])).toEqual([100, -50]);
  });

  it("zooms between its limits", () => {
    expect(zoomAt(START, 100, [0, 0], SCREEN).zoom).toBe(ZOOM.max);
    expect(zoomAt(START, 0.01, [0, 0], SCREEN).zoom).toBe(ZOOM.min);
  });

  it("pans with the drag, but never takes the stamp's center off screen", () => {
    expect(panBy(START, 30, -20, SCREEN).pan).toEqual([30, -20]);
    expect(panBy(START, 5000, -5000, SCREEN).pan).toEqual([400, -300]);
  });

  it("keeps the stamp's center on screen when zooming about a far point", () => {
    // Zooming 4x about the screen's left edge would carry a stamp at the right edge 2800 px off.
    const view = zoomAt({ ...START, pan: [400, 0] }, 4, [-400, 0], SCREEN);
    expect(view.pan).toEqual([400, 0]);
  });

  it("keeps the stamp's tilt as it pans and zooms", () => {
    const tilted = { ...START, tilt: flick(FLAT, 10, 0) };
    expect(panBy(tilted, 30, 0, SCREEN).tilt).toBe(tilted.tilt);
    expect(zoomAt(tilted, 2, [0, 0], SCREEN).tilt).toBe(tilted.tilt);
  });
});
