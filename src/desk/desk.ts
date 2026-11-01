import { stream, type StampRef } from "../stamp";
import { chooseBurstSpot, chooseDropSpot } from "./trail";

// The desk module: the rules for what's on the desk, free of React and three.js. The scene renders its state
// and reports back when a stamp lands. See GLOSSARY.md.

export type Spot = [number, number];

// How one stamp drops: where it lands on the desk (x, z), its turn about the vertical, and random phases and
// rates so no two stamps flutter alike.
export type Drop = {
  spot: Spot;
  yaw: number;
  flutter: [number, number, number, number];
};

// Ids count up from 0 in drop order, and stamps never leave the desk, so a stamp's id is its index.
export type DeskStamp = {
  id: number;
  ref: StampRef;
  drop: Drop;
  landed: boolean;
};

// `focus` is the spot on the desk the camera centers on. `lastPress` is when the last press dropped a stamp,
// in milliseconds.
export type Desk = { stamps: DeskStamp[]; focus: Spot; lastPress: number };

// The desk under the screen, as offsets from the camera's center: the four-sided patch a stamp's center can
// land in and still show whole, given by its far edge (the top of the screen) and its near edge (the bottom),
// each left to right. It depends on the screen's shape, so the scene measures it.
export type Area = { far: [Spot, Spot]; near: [Spot, Spot] };

// Load drops the page's first stamp. Press drops another, carrying its fresh reference, the time in
// milliseconds, and the visible area. The scene sends land when a stamp first touches down.
export type DeskEvent =
  | { type: "load"; ref: StampRef }
  | { type: "press"; ref: StampRef; at: number; area: Area }
  | { type: "land"; id: number };

export const EMPTY_DESK: Desk = {
  stamps: [],
  focus: [0, 0],
  lastPress: -Infinity,
};

// The most stamps that can be in the air at once. Mashing past it refuses presses until one lands.
export const MAX_IN_FLIGHT = 8;
// A press this soon after the last one, or while a drop is still in the air, is part of a burst.
const BURST_WINDOW = 1000;

// Everything random about a drop comes from the stamp's seed, so the reducer stays pure.
function dropFor(ref: StampRef, spot: Spot): Drop {
  const r = stream(ref.seed, 0x5bd1e995);
  return {
    spot,
    yaw: (r() * 2 - 1) * 0.35,
    flutter: [r() * 6.3, r() * 6.3, 2.2 + r() * 1.5, 2.8 + r() * 1.5],
  };
}

export function deskReducer(desk: Desk, event: DeskEvent): Desk {
  switch (event.type) {
    case "load":
      // The page's first stamp drops in the middle of the desk.
      return { ...EMPTY_DESK, stamps: [stampAt(0, event.ref, [0, 0])] };
    case "press": {
      const { stamps, focus } = desk;
      const inFlight = stamps.filter((s) => !s.landed).length;
      if (inFlight >= MAX_IN_FLIGHT) return desk;
      const spots = stamps.map((s) => s.drop.spot);
      const rand = stream(event.ref.seed, 0x2545f491);
      // A lone press steps along the trail and the camera follows. A burst holds the camera still and scatters
      // its drops over the desk on screen, so mashing fills the screen instead of running off along the trail.
      const burst = inFlight > 0 || event.at - desk.lastPress < BURST_WINDOW;
      const spot = burst
        ? chooseBurstSpot(spots, focus, event.area, rand)
        : chooseDropSpot(spots, rand);
      return {
        stamps: [...stamps, stampAt(stamps.length, event.ref, spot)],
        focus: burst ? focus : spot,
        lastPress: event.at,
      };
    }
    case "land": {
      const stamp = desk.stamps[event.id];
      if (!stamp || stamp.landed) return desk;
      const stamps = desk.stamps.slice();
      stamps[event.id] = { ...stamp, landed: true };
      return { ...desk, stamps };
    }
  }
}

const stampAt = (id: number, ref: StampRef, spot: Spot): DeskStamp => ({
  id,
  ref,
  drop: dropFor(ref, spot),
  landed: false,
});

// The camera frames a few desk units around its center, even backed off on a phone, so stamps further than
// this from it can't be on screen and stop rendering. The camera only moves on along the trail, so the trail
// behind it fades out of the scene while staying on the desk.
const RENDER_RADIUS = 8;

export function isNearFocus(desk: Desk, stamp: DeskStamp): boolean {
  const [x, z] = desk.focus;
  const [sx, sz] = stamp.drop.spot;
  return Math.hypot(sx - x, sz - z) <= RENDER_RADIUS;
}
