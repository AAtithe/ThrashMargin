/**
 * Round 7: the Fortification line's pure queries (fireline-round7-fortification.md). Imports rules.ts,
 * specs.ts and types only, so state.ts, research.ts and tick.ts can all read it without a cycle. The
 * simulation step (Point Defence, counter-battery) is in fortification.ts.
 *
 * Every function here answers exactly as the game did before round 7 when the line is not in play:
 * the same object, the same number, multiplied by nothing.
 */
import {
  CONCRETE_HP,
  LINE_ORDER,
  SHELTERS_KINDS,
  SHELTERS_TAKEN,
  type BattleLineId,
  type BuildingKind,
  type Owner,
  type SkirmishSetup,
  type WeaponKind,
} from './rules';
import { buildingSpec, buildingSpecOf } from './specs';
import type { Building, GameState } from './types';

/** True when this setup plays the Fortification line: advanced tech, development lines and the toggle. */
export const fortificationInSetup = (setup: SkirmishSetup | undefined): boolean =>
  !!setup && setup.fortification === true && setup.tech === 'advanced' && setup.research === 'lines';

/** True when this battle plays the Fortification line. Never in a mission. */
export const fortificationOn = (s: GameState): boolean => !s.mission && fortificationInSetup(s.setup);

const FIVE: readonly BattleLineId[] = LINE_ORDER;
const SIX: readonly BattleLineId[] = [...LINE_ORDER, 'fortification'];

/**
 * The development lines this battle offers, in the Research tree's order: the five, and Fortification
 * last when the battle has it. Battle-side readers (research legality, the Research tree, the
 * computer's lists) go through this; War for the Planet's research keeps LINE_ORDER's five.
 */
export const linesFor = (s: GameState): readonly BattleLineId[] => (fortificationOn(s) ? SIX : FIVE);

const has = (s: GameState, owner: Owner, id: string): boolean => {
  const ups = s.players[owner]?.upgrades;
  return !!ups && ups.length > 0 && (ups as string[]).includes(id);
};

/** A structure's full health: its spec's, a fifth more with Reinforced concrete. */
export function structureMaxHp(s: GameState, b: Building): number {
  const hp = buildingSpecOf(s, b).hp;
  return has(s, b.owner, 'concrete') ? Math.round(hp * CONCRETE_HP) : hp;
}

/** The same for a kind this side is about to stand up (a Field Yard deploying). */
export function structureMaxHpFor(s: GameState, owner: Owner, kind: BuildingKind): number {
  const hp = buildingSpec(s, owner, kind).hp;
  return has(s, owner, 'concrete') ? Math.round(hp * CONCRETE_HP) : hp;
}

/**
 * Hardened shelters: the multiplier on what a structure takes from a blast. Only splash (a weapon
 * landing on a point and hurting what is round it: hit()'s splash branch in tick.ts) of the kinds in
 * SHELTERS_KINDS: artillery shells and the barrage, grenades (which fire as 'artillery'), bombs and
 * missiles. A direct hit (a shell or rocket aimed at the structure with no splash) is never reduced,
 * nor is a flame tank's or a Firebrand's burning splash, nor a Fortress's or Sapper's shell splash.
 */
export function shelterMul(s: GameState, b: Building, weapon: WeaponKind): number {
  if (!SHELTERS_KINDS.includes(weapon)) return 1;
  return has(s, b.owner, 'shelters') ? SHELTERS_TAKEN : 1;
}
