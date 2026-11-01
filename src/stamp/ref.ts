// A stamp reference: an art source id plus a seed, which together fully determine a stamp (ADR 0001).
// Its text form, `<source>-<seed>`, is what a share link carries in `?stamp=`.
export type StampRef = { source: string; seed: number };

// A source id is lowercase letters then digits-or-letters, with no dash, so the one dash splits the pair. The
// seed is a 32-bit unsigned integer without leading zeros, so every reference has exactly one text form.
const REF = /^([a-z][a-z0-9]*)-(0|[1-9][0-9]{0,9})$/;

export function parseStampRef(text: string): StampRef | null {
  const match = REF.exec(text);
  if (!match) return null;
  const seed = Number(match[2]);
  return seed <= 0xffffffff ? { source: match[1], seed } : null;
}

export function formatStampRef({ source, seed }: StampRef): string {
  return `${source}-${seed}`;
}
