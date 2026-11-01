import { describe, expect, it } from "vitest";
import type { StampRef } from "../stamp";
import {
  type Area,
  type Desk,
  deskReducer,
  type DeskEvent,
  deskLink,
  EMPTY_DESK,
  isNearFocus,
  linkUrl,
  type Spot,
} from "./desk";

const ref = (seed: number): StampRef => ({ source: "land1", seed });
const run = (events: DeskEvent[], from: Desk = EMPTY_DESK) =>
  events.reduce(deskReducer, from);
const load: DeskEvent = { type: "load", link: null, ref: ref(1) };
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
    // The first-load stamp is still in the air, so 7 presses fill the air.
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
      // While a drop is still in the air.
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

  describe("the detail view", () => {
    const open = (id: number): DeskEvent => ({ type: "open", id });
    const close: DeskEvent = { type: "close" };
    const settled = run([load, land(0), ...pressAndLand(3)]);

    it("opens a landed stamp, one at a time", () => {
      const desk = run([open(2)], settled);
      expect(desk.open).toBe(2);
      expect(run([open(1)], desk).open).toBe(2);
    });

    it("won't open a stamp that is still falling, or one that isn't on the desk", () => {
      const falling = run([press(500, 20_000)], settled);
      expect(run([open(4)], falling)).toBe(falling);
      expect(run([open(9)], settled)).toBe(settled);
    });

    it("refuses presses while a stamp is open", () => {
      const desk = run([open(2)], settled);
      expect(run([press(501, 20_000)], desk)).toBe(desk);
    });

    it("closes back to the same desk, with the camera where it was", () => {
      const desk = run([open(2), close], settled);
      expect(desk.open).toBeNull();
      expect(desk.stamps).toBe(settled.stamps);
      expect(desk.focus).toEqual(settled.focus);
    });

    it("starts with no stamp open", () => {
      expect(run([load]).open).toBeNull();
    });
  });

  describe("a share link", () => {
    const loadLink = (link: string | null): DeskEvent => ({
      type: "load",
      link,
      ref: ref(1),
    });
    const close: DeskEvent = { type: "close" };

    it("drops the stamp it names, then opens it once it has landed", () => {
      const desk = run([loadLink("bau1-1z141z3")]);
      expect(desk.stamps).toHaveLength(1);
      expect(desk.stamps[0].ref).toEqual({ source: "bau1", seed: 2 ** 32 - 1 });
      expect(desk.opening).toBe(0);
      // It can't open while it's still falling.
      expect(desk.open).toBeNull();
      expect(deskLink(desk)).toBeNull();
      const landed = run([land(0), { type: "open", id: 0 }], desk);
      expect(landed.open).toBe(0);
      expect(landed.opening).toBeNull();
      expect(deskLink(landed)).toBe("bau1-1z141z3");
      // Closing clears the link, and the desk carries on as usual.
      const closed = run([close], landed);
      expect(deskLink(closed)).toBeNull();
      expect(run([press(7, 9000)], closed).stamps).toHaveLength(2);
    });

    it("stays down once the visitor presses before it opens", () => {
      const desk = run([loadLink("bau1-1z141z3"), press(7, 500)]);
      expect(desk.stamps).toHaveLength(2);
      expect(desk.opening).toBeNull();
    });

    it.each([
      ["malformed", "land1_zz"],
      ["out of range", "land1-zzzzzzz"],
      ["from an unknown source", "nope9-1z141z3"],
      ["missing", null],
    ])("falls back to a fresh press when %s", (_, link) => {
      const desk = run([loadLink(link)]);
      expect(desk.stamps.map((s) => s.ref)).toEqual([ref(1)]);
      expect(desk.opening).toBeNull();
      expect(deskLink(desk)).toBeNull();
    });

    it("links any open stamp by its reference", () => {
      const desk = run([load, land(0), { type: "open", id: 0 }]);
      expect(deskLink(desk)).toBe("land1-1");
    });

    it("writes the link into the address, or takes it out, and keeps the rest", () => {
      const base = "https://stamp.press/?a=1";
      expect(linkUrl(base, "land1-1")).toBe(
        "https://stamp.press/?a=1&stamp=land1-1",
      );
      expect(linkUrl("https://stamp.press/?stamp=land1-1&a=1#x", null)).toBe(
        "https://stamp.press/?a=1#x",
      );
      expect(linkUrl("https://stamp.press/?stamp=junk", null)).toBe(
        "https://stamp.press/",
      );
      expect(linkUrl("https://stamp.press/?stamp=land1-1", "land1-2")).toBe(
        "https://stamp.press/?stamp=land1-2",
      );
    });
  });

  it("stops rendering stamps far from the camera's center, and keeps the ones around it", () => {
    const desk = run([load, land(0), ...pressAndLand(300)]);
    const near = desk.stamps.filter((s) => dist(s.drop.spot, desk.focus) < 7);
    const far = desk.stamps.filter((s) => dist(s.drop.spot, desk.focus) > 20);
    // The camera frames several desk units around its center, on a phone or a wide screen.
    expect(near.length).toBeGreaterThan(5);
    expect(far.length).toBeGreaterThan(100);
    for (const s of near) expect(isNearFocus(desk, s)).toBe(true);
    for (const s of far) expect(isNearFocus(desk, s)).toBe(false);
  });
});
