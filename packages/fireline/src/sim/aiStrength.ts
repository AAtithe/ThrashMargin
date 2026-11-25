// How the commander weighs its army against the enemy's (fireline-design.md, 2026-11-25: the Normal
// tank weakness). Pure: reads the state, changes nothing.
//
// The scripted-opening test found a tank column beating the Normal commander 150 times in 150 at the
// Long pace. The cause was not its unit mix: with paced research the commander held its unit spending
// to save for upgrades until enemy troops came within PACED_HOLD_RADIUS of home, so it researched four
// upgrades while the column outbuilt it, then sent its infantry wave into the tanks and collapsed.
// A commander that is clearly outmatched in the field now builds army before research.
import { UNITS, type Owner } from './rules';
import { isEnemy } from './sides';
import { unitSpecOf } from './specs';
import { isShip } from './naval';
import type { GameState, Unit } from './types';

/**
 * How far the enemy's field army, by price, must exceed the commander's own to hold a decision back.
 * Spending (new research, the savings hold, the extras and aircraft) waits from level: an army behind
 * in the field is built back up before anything else. A wave waits from a tenth more, so two sides
 * near level still meet.
 */
export const OUTMATCH_RATIO = 1;
export const OUTMATCH_WAVE = 1.1;
/** New research waits only when well behind: upgrades are worth most to an army in a close fight. */
export const OUTMATCH_RESEARCH = 1.25;
/** Below this enemy army value (credits) the opening skirmishes decide nothing, so nothing is outmatched. */
export const OUTMATCH_FLOOR = 2500;

const fielded = (s: GameState, u: Unit): boolean => u.hp > 0 && u.kind !== 'hauler' && !isShip(u) && !UNITS[u.kind].hero && !!unitSpecOf(s, u).weapon;

/** The price of a side's armed land army (haulers, ships and heroes left out). */
export function armyValue(s: GameState, owner: Owner): number {
  let v = 0;
  for (const u of s.units) if (u.owner === owner && fielded(s, u)) v += UNITS[u.kind].cost;
  return v;
}

/** The same, summed over every side the owner is at war with (the commander sees the whole map, a stated rule). */
export function enemyArmyValue(s: GameState, owner: Owner): number {
  let v = 0;
  for (const u of s.units) if (isEnemy(s, owner, u.owner) && fielded(s, u)) v += UNITS[u.kind].cost;
  return v;
}

/** True when the enemy's army is past the floor and more than `ratio` times this side's own. */
export function outmatched(s: GameState, owner: Owner, ratio = OUTMATCH_RATIO): boolean {
  const foe = enemyArmyValue(s, owner);
  return foe >= OUTMATCH_FLOOR && foe > armyValue(s, owner) * ratio;
}

/** Share of the enemy's field army, by price, that is vehicles (anything not armoured as infantry). */
export function enemyArmourShare(s: GameState, owner: Owner): number {
  let armour = 0;
  let all = 0;
  for (const u of s.units) {
    if (!isEnemy(s, owner, u.owner) || !fielded(s, u)) continue;
    const v = UNITS[u.kind].cost;
    all += v;
    if (unitSpecOf(s, u).armor !== 'infantry') armour += v;
  }
  return all > 0 ? armour / all : 0;
}

/** An armour threat: an enemy army past the floor, at least ARMOUR_THREAT of it vehicles by price. */
export const ARMOUR_THREAT = 0.55;
export const armourThreat = (s: GameState, owner: Owner): boolean => enemyArmyValue(s, owner) >= OUTMATCH_FLOOR && enemyArmourShare(s, owner) >= ARMOUR_THREAT;
