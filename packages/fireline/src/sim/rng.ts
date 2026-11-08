/**
 * Seeded PRNG. The simulation never calls Math.random: every roll goes through here against
 * `GameState.rngSeed`, which is persisted with the save, so a battle replays identically from its
 * seed and `scripts/drive.ts` can assert on exact outcomes.
 *
 * mulberry32: small, fast, good enough for map generation and AI choices.
 */

/** Advances the seed and returns the next float in [0, 1) alongside it. Pure. */
export function next(seed: number): { seed: number; value: number } {
  let t = (seed + 0x6d2b79f5) | 0;
  const s = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { seed: s, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

/** A stateful stream over a seed, for code that draws many numbers at once (map generation). */
export function stream(seed: number) {
  let s = seed;
  return {
    float(): number {
      const r = next(s);
      s = r.seed;
      return r.value;
    },
    int(min: number, max: number): number {
      return min + Math.floor(this.float() * (max - min + 1));
    },
    get seed() {
      return s;
    },
  };
}

/** Derives a stable numeric seed from a string, so a player can type a memorable seed. */
export function seedFromString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
