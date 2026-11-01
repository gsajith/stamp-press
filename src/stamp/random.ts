// Small, fast, seedable PRNG. Returns floats in [0, 1).
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// An independent 32-bit seed drawn from `seed`, one per `salt`, so separate uses of a seed don't move together.
export function subSeed(seed: number, salt: number): number {
  return Math.floor(mulberry32((seed ^ salt) >>> 0)() * 2 ** 32);
}

// A fresh seed for a new stamp.
export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

export const pick = <T>(list: readonly T[], rand: () => number): T =>
  list[Math.floor(rand() * list.length)];
