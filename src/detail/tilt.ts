// How the detail view's stamp leans, in radians, as [about the screen's horizontal axis, about its vertical].
// Positive turns its face down and to the right. A spring carries `angle` toward `aim` with velocity `spin`.
export type Tilt = {
  aim: [number, number];
  angle: [number, number];
  spin: [number, number];
};

export const FLAT: Tilt = { aim: [0, 0], angle: [0, 0], spin: [0, 0] };
// About 17 degrees: enough to rake light across the paper, not enough to hide the art.
export const MAX_TILT = 0.3;

const clamp = (v: number, limit: number) =>
  Math.min(limit, Math.max(-limit, v));

// Aims the face at a cursor `at` pixels from the screen's center (x right, y down), with the stamp's center at
// `pan`. A cursor half a screen away leans it all the way.
export function aimAt(
  tilt: Tilt,
  at: [number, number],
  pan: [number, number],
  screen: { width: number; height: number },
): Tilt {
  const lean = (d: number, half: number) =>
    clamp((MAX_TILT * d) / half, MAX_TILT);
  return {
    ...tilt,
    aim: [
      lean(at[1] - pan[1], screen.height / 2),
      lean(at[0] - pan[0], screen.width / 2),
    ],
  };
}

// How hard a touch drag flicks the stamp, in radians a second per pixel moved. Each move adds spin, which the
// spring pulls back out, so a quick drag leans further than a slow one over the same distance: a swipe of
// about 1500 pixels a second reaches MAX_TILT.
const FLICK = 0.018;

// Flicks the stamp with a touch drag of `dx`, `dy` pixels, turning its face the way the finger moves.
export function flick(tilt: Tilt, dx: number, dy: number): Tilt {
  return {
    ...tilt,
    spin: [tilt.spin[0] + FLICK * dy, tilt.spin[1] + FLICK * dx],
  };
}

// The spring's pull toward the aim and its drag. Lightly underdamped, so a flicked stamp springs flat with a
// small overshoot, and a cursor's lean eases in over about half a second.
const STIFFNESS = 90;
const DAMPING = 11;
// The longest step the spring takes at once: a long frame runs as several, so it never blows up.
const STEP = 1 / 120;

// Runs the spring for `dt` seconds.
export function settle(tilt: Tilt, dt: number): Tilt {
  const angle: [number, number] = [...tilt.angle];
  const spin: [number, number] = [...tilt.spin];
  for (let left = dt; left > 0; left -= STEP) {
    const h = Math.min(STEP, left);
    for (const i of [0, 1]) {
      spin[i] += (STIFFNESS * (tilt.aim[i] - angle[i]) - DAMPING * spin[i]) * h;
      angle[i] += spin[i] * h;
      // At the limit the stamp stops rather than pressing past it.
      if (Math.abs(angle[i]) > MAX_TILT) {
        angle[i] = clamp(angle[i], MAX_TILT);
        spin[i] = 0;
      }
    }
  }
  return { ...tilt, angle, spin };
}

// The lean the scene draws at this zoom. A zoomed-in stamp fills more of the view, so the same angle would
// swing its edges toward the camera. It leans less in step, which keeps a close-up easy to pan and read.
export const lean = (tilt: Tilt, zoom: number): [number, number] => [
  tilt.angle[0] / zoom,
  tilt.angle[1] / zoom,
];
