import { describe, expect, it } from "vitest";
import type { StampRef } from "../stamp";
import {
  type Area,
  type Desk,
  deskReducer,
  type DeskEvent,
  EMPTY_DESK,
  isNearFocus,
  type Spot,
} from "./desk";

const ref = (seed: number): StampRef => ({ source: "land1", seed });
const run = (events: DeskEvent[], from: Desk = EMPTY_DESK) =>
  events.reduce(deskReducer, from);
const load: DeskEvent = { type: "load", ref: ref(1) };
const land = (id: number): DeskEvent => ({ type: "land", id });

// Where on the desk, around the camera's center, a stamp can land and show whole on a landscape screen: wider
// far away than close up.
const AREA: Area = {
  far: [
    [-2.4, -1.2],
    [2.4, -1.2],
  ],
  near: [
    [-1.6, 1.4],
    [1.6, 1.4],
  ],
};
const press = (seed: number, at: number): DeskEvent => ({
  type: "press",
  ref: ref(seed),
  at,
  area: AREA,
});

// `n` presses seconds apart, each landing before the next, so none is a burst or refused. Ids after a load
// count up from 1.
const pressAndLand = (n: number, from = 0): DeskEvent[] =>
  Array.from({ length: n }, (_, i): DeskEvent[] => [
    press(100 + i, (from + i) * 3000),
    land(i + 1),
  ]).flat();
// `n` presses in quick succession, starting at time `at`.
const mash = (n: number, seed: number, at: number): DeskEvent[] =>
  Array.from({ length: n }, (_, i) => press(seed + i, at + i * 100));

const spotOf = (desk: Desk, i: number) => desk.stamps[i].drop.spot;
const dist = (a: Spot, b: Spot) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe("desk", () => {
  it("drops one stamp in the middle of the desk on first load", () => {
    const desk = run([load]);
    expect(desk.stamps).toHaveLength(1);
    expect(desk.stamps[0]).toMatchObject({
      ref: ref(1),
      landed: false,
      drop: { spot: [0, 0] },
    });
    expect(desk.focus).toEqual([0, 0]);
  });

  it("lands each lone press under a stamp's length from the last, so neighbors can overlap, and follows it", () => {
    // A stamp's long side is 1 and its short side at least 0.6.
    const desk = run([load, land(0), ...pressAndLand(40)]);
    expect(desk.stamps).toHaveLength(41);
    for (let i = 1; i < desk.stamps.length; i++) {
      const step = dist(spotOf(desk, i), spotOf(desk, i - 1));
      expect(step).toBeGreaterThan(0.4);
      expect(step).toBeLessThan(1);
    }
    expect(desk.focus).toEqual(spotOf(desk, 40));
  });

  it("drifts toward open desk instead of piling up", () => {
    const desk = run([load, land(0), ...pressAndLand(60)]);
    // No stamp lands nearer an older stamp than the shortest step, so the trail never heaps in one spot.
    for (let i = 2; i < desk.stamps.length; i++)
      for (let j = 0; j < i - 1; j++)
        expect(dist(spotOf(desk, i), spotOf(desk, j))).toBeGreaterThan(0.4);
  });

  it("drops every rapid press, up to 8 stamps in flight, and refuses the rest", () => {
    // The first-load stamp is still falling, so 7 presses fill the air.
    const full = run([load, ...mash(7, 200, 0)]);
    expect(full.stamps).toHaveLength(8);
    expect(run(mash(3, 300, 800), full)).toBe(full);
    // A landing frees room for exactly one more.
    const landed = run([land(3), ...mash(3, 400, 900)], full);
    expect(landed.stamps).toHaveLength(9);
    expect(landed.stamps[8].ref).toEqual(ref(400));
  });

  describe("a burst of presses", () => {
    // One lone press moves the camera along the trail, then the mashing starts.
    const before = run([load, land(0), press(50, 0)]);
    const center = spotOf(before, 1);

    it("holds the camera where it is", () => {
      // While a drop is still falling.
      expect(run([press(51, 5000)], before).focus).toEqual(center);
      // Or within a second of the last press, even with everything landed.
      expect(run([land(1), press(51, 600)], before).focus).toEqual(center);
    });

    it("spreads its drops across the visible desk instead of stacking them", () => {
      const desk = run(mash(7, 60, 100), before);
      const burst = desk.stamps.slice(2).map((s) => s.drop.spot);
      expect(burst).toHaveLength(7);
      for (const [x, z] of burst) {
        const [dx, dz] = [x - center[0], z - center[1]];
        expect(dz).toBeGreaterThanOrEqual(-1.2);
        expect(dz).toBeLessThanOrEqual(1.4);
        // The patch's sides run from x = ±2.4 at its far edge to ±1.6 at its near edge.
        const half = 2.4 - (0.8 * (dz + 1.2)) / 2.6;
        expect(Math.abs(dx)).toBeLessThanOrEqual(half + 1e-9);
      }
      // Eight stamps share a patch of about 10.4 square units: packed evenly they'd sit about 1.1 apart.
      for (let i = 0; i < burst.length; i++)
        for (let j = 0; j < i; j++)
          expect(dist(burst[i], burst[j])).toBeGreaterThan(0.6);
    });

    it("hands back to the trail once it settles", () => {
      const burst = run(
        [...mash(7, 60, 100), ...[1, 2, 3, 4, 5, 6, 7, 8].map(land)],
        before,
      );
      const desk = run([press(90, 5000)], burst);
      const next = spotOf(desk, 9);
      const step = dist(next, spotOf(burst, 8));
      expect(step).toBeGreaterThan(0.4);
      expect(step).toBeLessThan(1);
      expect(desk.focus).toEqual(next);
    });
  });

  it("stops rendering stamps far from the camera's center, and keeps the ones around it", () => {
    const desk = run([load, land(0), ...pressAndLand(300)]);
    const near = desk.stamps.filter((s) => dist(s.drop.spot, desk.focus) < 4);
    const far = desk.stamps.filter((s) => dist(s.drop.spot, desk.focus) > 12);
    // The camera frames a few desk units around its center, on a phone or a wide screen.
    expect(near.length).toBeGreaterThan(5);
    expect(far.length).toBeGreaterThan(100);
    for (const s of near) expect(isNearFocus(desk, s)).toBe(true);
    for (const s of far) expect(isNearFocus(desk, s)).toBe(false);
  });
});
