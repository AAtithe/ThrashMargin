/**
 * Seeded PRNG. The simulation must never call Math.random. Every roll goes through here against
 * `GameState.rngSeed`, which is persisted with the save, so a game replays identically from its
 * seed and `scripts/drive.ts` can assert exact outcomes. Same mulberry32 the Tea Race uses.
 */

/** Advances the seed and returns the next float in [0, 1) alongside it. Pure. */
export function next(seed: number): { seed: number; value: number } {
  let t = (seed + 0x6d2b79f5) | 0;
  const s = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { seed: s, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

/** Integer in [min, max] inclusive. */
export function nextInt(seed: number, min: number, max: number): { seed: number; value: number } {
  const r = next(seed);
  return { seed: r.seed, value: min + Math.floor(r.value * (max - min + 1)) };
}

/** Fisher-Yates against the seeded stream. Returns a new array. */
export function shuffle<T>(seed: number, items: readonly T[]): { seed: number; items: T[] } {
  const out = items.slice();
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    const r = nextInt(s, 0, i);
    s = r.seed;
    [out[i], out[r.value]] = [out[r.value], out[i]];
  }
  return { seed: s, items: out };
}

/** Stable numeric seed from a string, used to give migrated version 1 saves a seed. */
export function seedFromString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
