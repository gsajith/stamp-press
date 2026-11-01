import { describe, expect, it } from "vitest";
import type { StampRef } from "../stamp";
import { type Desk, deskReducer, type DeskEvent, EMPTY_DESK } from "./desk";

const ref = (seed: number): StampRef => ({ source: "procedural1", seed });
const run = (events: DeskEvent[], from: Desk = EMPTY_DESK) =>
  events.reduce(deskReducer, from);
const load: DeskEvent = { type: "load", ref: ref(1) };

// `n` presses, each landing before the next, so the in-flight cap never refuses one. Ids after a load count
// up from 1.
const pressAndLand = (n: number): DeskEvent[] =>
  Array.from({ length: n }, (_, i): DeskEvent[] => [
    { type: "press", ref: ref(100 + i) },
    { type: "land", id: i + 1 },
  ]).flat();

const spotOf = (desk: Desk, i: number) => desk.stamps[i].drop.spot;
const dist = (a: [number, number], b: [number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

describe("desk", () => {
  it("drops one stamp in the middle of the desk on first load", () => {
    const desk = run([load]);
    expect(desk.stamps).toHaveLength(1);
    expect(desk.stamps[0]).toMatchObject({
      ref: ref(1),
      landed: false,
      drop: { spot: [0, 0] },
    });
  });

  it("lands each pressed stamp under a stamp's length from the last, so neighbors can overlap", () => {
    // A stamp's long side is 1 and its short side at least 0.6.
    const desk = run([load, { type: "land", id: 0 }, ...pressAndLand(40)]);
    expect(desk.stamps).toHaveLength(41);
    for (let i = 1; i < desk.stamps.length; i++) {
      const step = dist(spotOf(desk, i), spotOf(desk, i - 1));
      expect(step).toBeGreaterThan(0.4);
      expect(step).toBeLessThan(1);
    }
  });

  it("drifts toward open desk instead of piling up", () => {
    const desk = run([load, { type: "land", id: 0 }, ...pressAndLand(60)]);
    // No stamp lands nearer an older stamp than the shortest step, so the trail never heaps in one spot.
    for (let i = 2; i < desk.stamps.length; i++)
      for (let j = 0; j < i - 1; j++)
        expect(dist(spotOf(desk, i), spotOf(desk, j))).toBeGreaterThan(0.4);
  });
});
