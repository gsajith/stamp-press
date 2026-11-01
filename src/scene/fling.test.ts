import { describe, expect, it } from "vitest";
import type { Spot } from "../desk/desk";
import { aimFling, DRAG, flightAt, GLIDE, GRAVITY, type Vec3 } from "./fling";

// Steps a stamp through the air at 4 kHz, independent of the closed form: gravity pulls it down and drag
// slows it in proportion to its speed, less across the desk than up and down. Returns where it is after `time` seconds, or where it first meets the
// desk if that comes sooner.
function simulate(from: Vec3, velocity: Vec3, time = Infinity): Vec3 {
  const dt = 1 / 4000;
  const p: Vec3 = [...from];
  const v: Vec3 = [...velocity];
  for (let t = 0; t < time && t < 10; t += dt) {
    v[0] -= GLIDE * v[0] * dt;
    v[1] -= (GRAVITY + DRAG * v[1]) * dt;
    v[2] -= GLIDE * v[2] * dt;
    p[0] += v[0] * dt;
    p[1] += v[1] * dt;
    p[2] += v[2] * dt;
    if (p[1] <= 0) break;
  }
  return p;
}

// Launch points just in front of a desktop camera and a phone camera, which backs off higher and further. The
// camera's center is the origin.
const DESKTOP: Vec3 = [0.4, 2.4, 1.7];
const PHONE: Vec3 = [0.7, 4.3, 3.1];
// Spots across the visible desk: the middle, the far corners, close by and off to one side.
const SPOTS: Spot[] = [
  [0, 0],
  [-2.4, -1.2],
  [2.4, -1.2],
  [-1.6, 1.4],
  [1.6, 1.4],
  [3, 0.5],
];

describe("aimFling", () => {
  for (const [name, from] of [
    ["desktop", DESKTOP],
    ["phone", PHONE],
  ] as const)
    it(`lands on each spot from a ${name} launch`, () => {
      for (const to of SPOTS) {
        const { velocity } = aimFling(from, to);
        const [x, , z] = simulate(from, velocity);
        expect(Math.hypot(x - to[0], z - to[1])).toBeLessThan(0.05);
      }
    });

  it("reaches the desk after the flight's duration", () => {
    for (const to of SPOTS) {
      const { velocity, duration } = aimFling(DESKTOP, to);
      expect(simulate(DESKTOP, velocity, duration - 0.02)[1]).toBeGreaterThan(
        0,
      );
      expect(
        simulate(DESKTOP, velocity, duration + 0.02)[1],
      ).toBeLessThanOrEqual(0);
    }
  });

  it("arcs up before it falls", () => {
    const { velocity, duration } = aimFling(DESKTOP, [0, 0]);
    const peak = Math.max(
      ...Array.from(
        { length: 50 },
        (_, i) => flightAt(DESKTOP, velocity, (duration * i) / 50)[1],
      ),
    );
    expect(peak).toBeGreaterThan(DESKTOP[1]);
  });
});

describe("flightAt", () => {
  it("follows the stepped flight", () => {
    const { velocity, duration } = aimFling(PHONE, [-2.4, -1.2]);
    for (const t of [0, 0.1, 0.4, duration / 2, duration]) {
      const [x, y, z] = flightAt(PHONE, velocity, t);
      const [sx, sy, sz] = simulate(PHONE, velocity, t);
      expect(Math.hypot(x - sx, y - sy, z - sz)).toBeLessThan(0.05);
    }
  });

  it("lands exactly on the spot at the end of the flight", () => {
    const to: Spot = [1.6, 1.4];
    const { velocity, duration } = aimFling(DESKTOP, to);
    const [x, y, z] = flightAt(DESKTOP, velocity, duration);
    expect(x).toBeCloseTo(to[0], 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(to[1], 6);
  });
});
