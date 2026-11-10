import { MAP_SIZE_FOR, type DifficultySpec, type MapSize } from './rules';
import type { GameState } from './types';

/**
 * The computer's numbers for the size of the map (fireline-round5-design.md, workstream B).
 *
 * On a standard map every function here returns exactly what it always did: `scaledFor` returns
 * the difficulty it was given (the same object), and the two distances are the literals the wave
 * code used before round 5 (30 and 10). On a large or huge map the walk to the enemy is longer
 * and there is more ore to build on, so the commander waits longer before its first attack,
 * attacks less often but with more, stages further forward and recruits from further out.
 *
 * Pure: reads the state's setup and size, never the clock or a random stream. Does not import
 * state.ts, so createInitialState can use it.
 */

/** The map's size, as the setup says. Missions and saves from before round 5: standard. */
const sizeOf = (s: GameState): MapSize => s.setup?.size ?? 'standard';

/**
 * How much bigger this map is than a standard one for the same number of sides: 1 on standard, 1.5
 * on a large two-sided map, 2 on a huge one (1.33 and 1.67 with four sides).
 */
export function mapScale(s: GameState): number {
  if (sizeOf(s) === 'standard') return 1;
  const n = s.players.length;
  const base = MAP_SIZE_FOR[(n === 3 || n === 4 ? n : 2) as 2 | 3 | 4];
  return Math.max(1, s.mapW / base);
}

/**
 * How each number grows with the scale above, per unit of (scale - 1). Measured with the AI ladder
 * over 150 seeds (round 5 build log): the first attack 60% later per unit, the interval 40%
 * longer, two more in the first wave and eight more in the largest.
 */
export const AI_SCALE = {
  firstAttack: 0.6,
  attackInterval: 0.4,
  firstWave: 2,
  waveCap: 8,
  /** Extra refineries per unit of scale (the computer has more fields to work). */
  refineries: 1,
  /** The staging point: 10 tiles from home on a standard map, and this much further per unit. */
  stage: 8,
  /** The reserve a wave recruits from: within 30 tiles of home on a standard map, scaled with the map. */
  reserve: 30,
};

/** The difficulty's numbers for this map's size. Standard size: `d` itself. */
export function scaledFor(s: GameState, d: DifficultySpec): DifficultySpec {
  const k = mapScale(s);
  if (k === 1) return d;
  const e = k - 1;
  return {
    ...d,
    firstAttack: Math.round(d.firstAttack * (1 + AI_SCALE.firstAttack * e)),
    attackInterval: Math.round(d.attackInterval * (1 + AI_SCALE.attackInterval * e)),
    firstWave: d.firstWave + Math.round(AI_SCALE.firstWave * e),
    waveCap: d.waveCap + Math.round(AI_SCALE.waveCap * e),
    refineries: d.refineries + Math.round(AI_SCALE.refineries * e),
  };
}

/** A wave recruits only units within this many tiles of home. Standard: 30, as always. */
export function reserveRadius(s: GameState): number {
  const k = mapScale(s);
  return k === 1 ? 30 : Math.round(AI_SCALE.reserve * k);
}

/** How far from home, toward the enemy, new units gather. Standard: 10, as always. */
export function stageDistance(s: GameState): number {
  const k = mapScale(s);
  return k === 1 ? 10 : Math.round(10 + AI_SCALE.stage * (k - 1));
}
