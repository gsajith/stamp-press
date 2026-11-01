// The stamp module: what a stamp is, from a reference to drawn art. See GLOSSARY.md and ADR 0001.
export { formatStampRef, parseStampRef, type StampRef } from "./ref";
export { artInset, drawArt, drawFace, resolveStamp, type Stamp } from "./stamp";
export {
  CURRENT_SOURCE,
  proceduralSource,
  type ArtSource,
  type Style,
} from "./sources";
export { PALETTES_1, type Palette } from "./palettes";
export { randomSeed } from "./random";
export {
  punchGeometry,
  type Aspect,
  type Point,
  type Punch,
  type PunchGeometry,
} from "./punch";
