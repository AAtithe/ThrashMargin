import { MAP_SIZE_FOR, MAP_SIZE_TILES, type DifficultySpec, type MapSize, type SkirmishSetup } from './rules';
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
  const sides = (n === 3 || n === 4 ? n : 2) as 2 | 3 | 4;
  return damped(Math.max(1, s.mapW / MAP_SIZE_FOR[sides]), sides);
}

/**
 * Vast maps (2026-11-22): beyond a huge map's scale, each number grows at VAST_SCALE_RATE of the
 * rate above, so a vast two-sided map (raw scale 4) plays at 3 rather than 4. Linear growth would
 * have put Normal's first attack five and a half times later than on a standard map and given
 * every side 24 more turrets, and the battle's tick time grows with what is on the field
 * (perf-fire.ts, build log). Large and huge are below the knee and unchanged.
 */
export const VAST_SCALE_RATE = 0.5;
function damped(k: number, sides: 2 | 3 | 4): number {
  const knee = MAP_SIZE_TILES.huge[sides] / MAP_SIZE_FOR[sides];
  return k <= knee ? k : knee + (k - knee) * VAST_SCALE_RATE;
}

/**
 * How each number grows with the scale above, per unit of (scale - 1), tuned with whole battles
 * and the AI ladder on larger maps (round 5 build log): the first attack 150% later per unit, the
 * interval twice as long, two more in the first wave, four more in the largest, one more refinery
 * and eight more turrets. On a large two-sided map (scale 1.5) Normal's first attack comes at
 * 1.75 times its standard tick, its interval 1.5 times.
 */
export const AI_SCALE = {
  firstAttack: 1.5,
  attackInterval: 1,
  firstWave: 2,
  waveCap: 4,
  /** Extra refineries per unit of scale (the computer has more fields to work). */
  refineries: 1,
  /** Extra turrets per unit of scale: a base holds out longer, so the battle runs longer. */
  turrets: 8,
  /** The staging point: 10 tiles from home on a standard map, and this much further per unit. */
  stage: 8,
  /** The reserve a wave recruits from: within 30 tiles of home on a standard map, scaled with the map. */
  reserve: 30,
};

/** The difficulty's numbers for this map's size. Standard size: `d` itself. */
export function scaledFor(s: GameState, d: DifficultySpec): DifficultySpec {
  return scaledBy(mapScale(s), d);
}

/**
 * The same for a setup not yet played (the lobby's enemy cards): the scale its map will have.
 * createInitialState builds the map at MAP_SIZE_TILES, so this equals mapScale of the battle.
 */
export function scaledForSetup(setup: Pick<SkirmishSetup, 'sides' | 'size'>, d: DifficultySpec): DifficultySpec {
  const size = setup.size ?? 'standard';
  return scaledBy(size === 'standard' ? 1 : damped(Math.max(1, MAP_SIZE_TILES[size][setup.sides] / MAP_SIZE_FOR[setup.sides]), setup.sides), d);
}

function scaledBy(k: number, d: DifficultySpec): DifficultySpec {
  if (k === 1) return d;
  const e = k - 1;
  return {
    ...d,
    firstAttack: Math.round(d.firstAttack * (1 + AI_SCALE.firstAttack * e)),
    attackInterval: Math.round(d.attackInterval * (1 + AI_SCALE.attackInterval * e)),
    firstWave: d.firstWave + Math.round(AI_SCALE.firstWave * e),
    waveCap: d.waveCap + Math.round(AI_SCALE.waveCap * e),
    refineries: d.refineries + Math.round(AI_SCALE.refineries * e),
    turrets: d.turrets + Math.round(AI_SCALE.turrets * e),
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

/**
 * Production lines (one per producer): the computer fills a line beyond the first only with this many
 * credits in hand, so the saving it does by taking back units not yet started still has some to take.
 * Never in a campaign mission: the missions were balanced on one line, so their commanders keep it.
 */
export const EXTRA_LINE_RESERVE = 1000;
export const extraLine = (s: GameState, credits: number): boolean => !s.mission && credits >= EXTRA_LINE_RESERVE;

/**
 * Surplus production (2026-11-22). The build plan stops at the difficulty's factories (one on
 * Normal), so a side earning far more than it can train banks the difference: in a vast Coast
 * battle one commander held 300,000 credits at minute 90 against its rival's 1,000, with the same
 * one barracks and one factory, and the two armies ground each other down at the causeways for 270
 * minutes with no end. On a map larger than standard, a commander holding SURPLUS_CREDITS or more
 * builds another factory, then another barracks, up to SURPLUS_FACTORIES and SURPLUS_BARRACKS more
 * than its plan: money it is not spending becomes an army. Never in a campaign mission, and never
 * on a standard map, whose battles were balanced as they are.
 */
export const SURPLUS_CREDITS = 6000;
export const SURPLUS_FACTORIES = 2;
export const SURPLUS_BARRACKS = 1;
export const surplusOn = (s: GameState, credits: number): boolean => !s.mission && mapScale(s) > 1 && credits >= SURPLUS_CREDITS;

