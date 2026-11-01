import type { Spot } from "../desk/desk";

// The fling: a stamp shot out of the press, flying under gravity through air that slows it in proportion to
// its speed, so it leaves fast, loses its forward speed, and drifts down at a gentle terminal speed. Pure math,
// so the aim can be tested away from the scene.

export type Vec3 = [number, number, number];

// How hard the air slows a stamp, per second, and how hard gravity pulls it, matching the stamp's rigid body.
export const DRAG = 2.6;
export const GRAVITY = 9.81 * 1.04;
// How fast a stamp leaves the press upward, so its path arcs up before it falls.
const RISE = 3;

// Where a stamp launched from `from` at `velocity` is `t` seconds later. Each axis eases from its launch speed
// toward its terminal speed: zero across the desk, -GRAVITY / DRAG straight down.
export function flightAt(from: Vec3, velocity: Vec3, t: number): Vec3 {
  const ease = (1 - Math.exp(-DRAG * t)) / DRAG;
  const sink = GRAVITY / DRAG;
  return [
    from[0] + velocity[0] * ease,
    from[1] + (velocity[1] + sink) * ease - sink * t,
    from[2] + velocity[2] * ease,
  ];
}

// The launch velocity that carries a stamp from `from`, above the desk, down onto the desk at `to`, and how
// long the flight takes in seconds. Every stamp rises at the same speed, which fixes the flight's duration, and
// the speed across the desk is whatever covers the distance in that time.
export function aimFling(
  from: Vec3,
  to: Spot,
): { velocity: Vec3; duration: number } {
  const height = (t: number) => flightAt(from, [0, RISE, 0], t)[1];
  // The flight rises then falls, so it meets the desk once. Its height never beats `from` plus the full ease
  // term, falling at terminal speed, and that bound reaches the desk at `high`.
  const sink = GRAVITY / DRAG;
  let low = 0;
  let high = (from[1] + (RISE + sink) / DRAG) / sink;
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2;
    if (height(mid) > 0) low = mid;
    else high = mid;
  }
  const duration = (low + high) / 2;
  const ease = (1 - Math.exp(-DRAG * duration)) / DRAG;
  return {
    velocity: [(to[0] - from[0]) / ease, RISE, (to[1] - from[2]) / ease],
    duration,
  };
}
