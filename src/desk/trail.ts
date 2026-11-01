import type { Spot } from "./desk";

// Ported from the blind box. Each drop lands a step away from the last stamp, toward open desk, so stamps
// leave a wandering trail. The step is under a stamp's length (its long side is 1), so neighbors often
// overlap like scattered mail.
const DROP_STEP = { min: 0.55, max: 0.85 } as const;
const DIRECTIONS = 12;
// How strongly a direction is pushed away from the stamps around it, against the random wander.
const WANDER = 0.6;

// `trail` is every stamp's spot on the desk, oldest first, and holds at least one. `rand` gives numbers in
// [0, 1).
export function chooseDropSpot(trail: Spot[], rand: () => number): Spot {
  const last = trail[trail.length - 1];
  const older = trail.slice(0, -1);
  const step = DROP_STEP.min + (DROP_STEP.max - DROP_STEP.min) * rand();
  const turn = rand() * ((2 * Math.PI) / DIRECTIONS);
  let best: Spot = [last[0] + step, last[1]];
  let bestScore = -Infinity;
  for (let i = 0; i < DIRECTIONS; i++) {
    const angle = turn + (i / DIRECTIONS) * Math.PI * 2;
    const spot: Spot = [
      last[0] + Math.cos(angle) * step,
      last[1] + Math.sin(angle) * step,
    ];
    // Distance to the nearest older stamp, capped so all open desk scores alike and the wander decides.
    let room = 3 * step;
    for (const [x, z] of older)
      room = Math.min(room, Math.hypot(spot[0] - x, spot[1] - z));
    const score = room / step + WANDER * rand();
    if (score > bestScore) [best, bestScore] = [spot, score];
  }
  return best;
}
