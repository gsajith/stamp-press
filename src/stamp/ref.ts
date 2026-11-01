// A stamp reference: an art source id plus a seed, which together fully determine a stamp (ADR 0001). Each
// procedural style is its own source, so the id is a versioned style id such as `land1`. Its text form,
// `<source>-<seed>` with the seed in base36, is what a share link carries in `?stamp=`, e.g. `land1-1z141z3`.
export type StampRef = { source: string; seed: number };

// A source id is lowercase letters then digits-or-letters, with no dash, so the one dash splits the pair. The
// seed is a 32-bit unsigned integer in lowercase base36 without leading zeros, at most 7 digits (`1z141z3` is
// 2^32 - 1), so every reference has exactly one text form.
const REF = /^([a-z][a-z0-9]*)-(0|[1-9a-z][0-9a-z]{0,6})$/;

export function parseStampRef(text: string): StampRef | null {
  const match = REF.exec(text);
  if (!match) return null;
  const seed = parseInt(match[2], 36);
  return seed <= 0xffffffff ? { source: match[1], seed } : null;
}

export function formatStampRef({ source, seed }: StampRef): string {
  return `${source}-${seed.toString(36)}`;
}
