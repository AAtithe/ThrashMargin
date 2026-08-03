/**
 * Seeded PRNG. The simulation must NEVER call Math.random — every roll and shuffle goes through
 * here against `GameState.rngSeed`, which is persisted with the save. That buys three things:
 * a game replays identically from its seed, `scripts/drive.ts` can assert on exact outcomes, and
 * a cloud save resumed on another device continues the same sequence it would have locally.
 *
 * mulberry32: small, fast, and good enough for dice. Not cryptographic — nothing here needs to be.
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

/** One six-sided die. */
export function rollDie(seed: number): { seed: number; value: number } {
  return nextInt(seed, 1, 6);
}

/** The wind roll: 2d6, returned as the pair so the UI can show real dice. */
export function roll2d6(seed: number): { seed: number; dice: [number, number]; total: number } {
  const a = rollDie(seed);
  const b = rollDie(a.seed);
  return { seed: b.seed, dice: [a.value, b.value], total: a.value + b.value };
}

/** Fisher-Yates against the seeded stream. Returns a new array; does not mutate the input. */
export function shuffle<T>(seed: number, items: readonly T[]): { seed: number; items: T[] } {
  const out = items.slice();
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    const r = nextInt(s, 0, i);
    s = r.seed;
    const j = r.value;
    [out[i], out[j]] = [out[j], out[i]];
  }
  return { seed: s, items: out };
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
