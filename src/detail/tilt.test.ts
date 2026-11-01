import { describe, expect, it } from "vitest";
import { aimAt, FLAT, flick, lean, MAX_TILT, settle, type Tilt } from "./tilt";

const SCREEN = { width: 800, height: 600 };
// Runs the spring for `seconds` at 60 frames a second.
const run = (tilt: Tilt, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) tilt = settle(tilt, 1 / 60);
  return tilt;
};
// A touch drag of `dx` pixels to the right, spread evenly over `seconds`, and how far it leaned at most.
const drag = (dx: number, seconds: number) => {
  let tilt = FLAT;
  let most = 0;
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) {
    tilt = settle(flick(tilt, dx / frames, 0), 1 / 60);
    most = Math.max(most, tilt.angle[1]);
  }
  return { tilt, most };
};

describe("tilt", () => {
  it("turns the face toward the cursor", () => {
    // Right of and below the stamp's center: the face turns right (+ about y) and down (+ about x).
    const { aim } = aimAt(FLAT, [200, 150], [0, 0], SCREEN);
    expect(aim[0]).toBeCloseTo(MAX_TILT / 2);
    expect(aim[1]).toBeCloseTo(MAX_TILT / 2);
  });

  it("aims from the stamp's center, wherever it's panned", () => {
    const { aim } = aimAt(FLAT, [100, -50], [100, -50], SCREEN);
    expect(aim).toEqual([0, 0]);
  });

  it("leans no further than MAX_TILT", () => {
    const { aim } = aimAt(FLAT, [-400, 300], [300, -200], SCREEN);
    expect(aim).toEqual([MAX_TILT, -MAX_TILT]);
  });

  it("eases toward its aim, and back once the aim is released", () => {
    const leaning = run(aimAt(FLAT, [400, 0], [0, 0], SCREEN), 1);
    expect(leaning.angle[1]).toBeCloseTo(MAX_TILT, 2);
    const flat = run({ ...leaning, aim: [0, 0] }, 1);
    expect(flat.angle[1]).toBeCloseTo(0, 2);
  });

  it("stays steady through a long frame", () => {
    const tilt = settle(aimAt(FLAT, [400, 300], [0, 0], SCREEN), 0.5);
    expect(Math.abs(tilt.angle[0])).toBeLessThanOrEqual(MAX_TILT);
    expect(run(tilt, 1).angle[0]).toBeCloseTo(MAX_TILT, 2);
  });

  it("leans the way a touch drags, further the faster it goes", () => {
    const quick = drag(300, 0.2);
    const slow = drag(300, 1);
    expect(slow.most).toBeGreaterThan(0);
    expect(quick.most).toBeGreaterThan(2 * slow.most);
    expect(quick.most).toBeLessThanOrEqual(MAX_TILT);
  });

  it("springs flat after a touch drag", () => {
    const { tilt } = drag(300, 0.2);
    expect(run(tilt, 1.5).angle[1]).toBeCloseTo(0, 2);
  });

  it("leans less as the stamp zooms in, so a close-up stays easy to read", () => {
    const tilt = { ...FLAT, angle: [0.2, -0.2] as [number, number] };
    expect(lean(tilt, 1)).toEqual([0.2, -0.2]);
    expect(lean(tilt, 4)).toEqual([0.05, -0.05]);
  });
});
