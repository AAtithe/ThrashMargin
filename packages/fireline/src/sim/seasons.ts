/**
 * Seasons and spoilage (2026-11-27, `setup.seasons` with army upkeep; the second step of the
 * long-game plan in fireline-design.md). Pure, like the rest of src/sim/: the season is read from
 * the tick, never a clock.
 *
 * - A year is SEASON_YEAR ticks: GROWING_TICKS of growing season, then the lean season. Farms grow a
 *   food every GROWING_FARM_TICKS in the growing season (half as fast again as without seasons) and
 *   every LEAN_FARM_TICKS in the lean one (a quarter), so the year's harvest is about the same, but an
 *   army sized on it goes hungry in the lean season unless the store was filled beforehand.
 * - Spoilage, once a minute: in the lean season food above half the store rots LEAN_ROT of the excess;
 *   all year, credits above HOARD_FREE lose HOARD_DECAY of the excess. Banking stops paying, so the
 *   money is spent on an army (the vast Coast stalemate was a side holding 300,000 credits).
 *
 * The rhythm this gives a long game: campaign in the growing season, consolidate in the lean one.
 * Off (absent) in every battle that does not ask for it.
 */
import { FARM_TICKS } from './rules';
import { foodStore } from './production';
import { upkeepOn } from './upkeep';
import type { GameState } from './types';

/** True in a skirmish with army upkeep and seasons on. */
export const seasonsOn = (s: GameState): boolean => upkeepOn(s) && s.setup?.seasons === true;

/** A year: twenty minutes, twelve of them growing. */
export const SEASON_YEAR = 12000;
export const GROWING_TICKS = 7200;
/** A Farm's beat in each season (FARM_TICKS without seasons). */
export const GROWING_FARM_TICKS = 13;
export const LEAN_FARM_TICKS = 80;
/** Spoilage, once a minute. */
export const SPOIL_TICKS = 600;
/** Lean season: this share of the food above half the store rots each minute. */
export const LEAN_ROT = 0.1;
/** All year: this share of the credits above HOARD_FREE is lost each minute. */
export const HOARD_FREE = 5000;
export const HOARD_DECAY = 0.02;

export type Season = 'growing' | 'lean';

/** The season at a tick. */
export const seasonAt = (tick: number): Season => (tick % SEASON_YEAR < GROWING_TICKS ? 'growing' : 'lean');

/** Ticks until the season changes. */
export const seasonLeft = (tick: number): number => {
  const t = tick % SEASON_YEAR;
  return t < GROWING_TICKS ? GROWING_TICKS - t : SEASON_YEAR - t;
};

/** A Farm's beat now: the season's with seasons on, FARM_TICKS otherwise. */
export const farmBeat = (s: GameState): number => (!seasonsOn(s) ? FARM_TICKS : seasonAt(s.tick) === 'growing' ? GROWING_FARM_TICKS : LEAN_FARM_TICKS);

/** One tick: on the minute, food rots in the lean season and hoarded credits decay. A no-op without seasons. */
export function seasonsStep(s: GameState, say: (s: GameState, text: string, tone: 'info' | 'good' | 'bad') => void): void {
  if (!seasonsOn(s) || s.tick === 0) return;
  // The player hears when a season turns.
  if (s.tick % SEASON_YEAR === 0) say(s, 'The growing season begins: Farms yield half as much again.', 'good');
  else if (s.tick % SEASON_YEAR === GROWING_TICKS) say(s, `The lean season begins: Farms yield a quarter for ${Math.round((SEASON_YEAR - GROWING_TICKS) / 600)} minutes, and food above half the store rots.`, 'bad');
  if (s.tick % SPOIL_TICKS !== 0) return;
  const lean = seasonAt(s.tick) === 'lean';
  for (const p of s.players) {
    if (lean) {
      const keep = Math.floor(foodStore(s, p.owner) / 2);
      const food = p.food ?? 0;
      if (food > keep) p.food = food - Math.ceil((food - keep) * LEAN_ROT);
    }
    if (p.credits > HOARD_FREE) p.credits -= Math.ceil((p.credits - HOARD_FREE) * HOARD_DECAY);
  }
}
