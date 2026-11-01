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

// Scrambles a 32-bit integer (the "lowbias32" hash). mulberry32's first draws barely differ between nearby
// seeds, so seeds pass through this first.
function hash32(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

// An independent random stream from `seed`, one per `salt`, so separate uses of a seed don't move together.
export function stream(seed: number, salt: number): () => number {
  return mulberry32(hash32((seed ^ salt) >>> 0));
}

// An independent 32-bit seed drawn from `seed`, one per `salt`.
export function subSeed(seed: number, salt: number): number {
  return Math.floor(stream(seed, salt)() * 2 ** 32);
}

// A fresh seed for a new stamp.
export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

export const pick = <T>(list: readonly T[], rand: () => number): T =>
  list[Math.floor(rand() * list.length)];
