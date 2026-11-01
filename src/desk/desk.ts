import { stream, type StampRef } from "../stamp";
import { chooseDropSpot } from "./trail";

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

export type Desk = { stamps: DeskStamp[] };

// Load drops the page's first stamp. Press drops another, carrying its fresh reference. The scene sends land
// when a stamp first touches down.
export type DeskEvent =
  | { type: "load"; ref: StampRef }
  | { type: "press"; ref: StampRef }
  | { type: "land"; id: number };

export const EMPTY_DESK: Desk = { stamps: [] };

// The most stamps that can fall at once. Mashing past it refuses presses until one lands.
export const MAX_IN_FLIGHT = 8;

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
      return { stamps: [stampAt(0, event.ref, [0, 0])] };
    case "press": {
      const { stamps } = desk;
      if (stamps.filter((s) => !s.landed).length >= MAX_IN_FLIGHT) return desk;
      const trail = stamps.map((s) => s.drop.spot);
      const spot = chooseDropSpot(trail, stream(event.ref.seed, 0x2545f491));
      return { stamps: [...stamps, stampAt(stamps.length, event.ref, spot)] };
    }
    case "land": {
      const stamp = desk.stamps[event.id];
      if (!stamp || stamp.landed) return desk;
      const stamps = desk.stamps.slice();
      stamps[event.id] = { ...stamp, landed: true };
      return { stamps };
    }
  }
}

const stampAt = (id: number, ref: StampRef, spot: Spot): DeskStamp => ({
  id,
  ref,
  drop: dropFor(ref, spot),
  landed: false,
});

// Where the camera heads: the newest drop. Assumes a loaded desk.
export const focusOf = (desk: Desk): Spot =>
  desk.stamps[desk.stamps.length - 1].drop.spot;

// The camera frames a few desk units around the newest drop, even backed off on a phone, so stamps further
// than this from it can't be on screen and stop rendering. The camera only moves on with new drops, so the
// trail behind it fades out of the scene while staying on the desk.
const RENDER_RADIUS = 8;

export function isNearFocus(desk: Desk, stamp: DeskStamp): boolean {
  const [x, z] = focusOf(desk);
  const [sx, sz] = stamp.drop.spot;
  return Math.hypot(sx - x, sz - z) <= RENDER_RADIUS;
}
