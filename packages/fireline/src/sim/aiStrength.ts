// How the commander weighs its army against the enemy's (fireline-design.md, 2026-11-25: the Normal
// tank weakness). Pure: reads the state, changes nothing.
//
// The scripted-opening test found a tank column beating the Normal commander 150 times in 150 at the
// Long pace. The cause was not its unit mix: with paced research the commander held its unit spending
// to save for upgrades until enemy troops came within PACED_HOLD_RADIUS of home, so it researched four
// upgrades while the column outbuilt it, then sent its infantry wave into the tanks and collapsed.
// A commander that is clearly outmatched in the field now builds army before research.
import { UNITS, type Owner } from './rules';
import { isAlly, isEnemy } from './sides';
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

// Aircraft are left out: the answer to them is anti-air (airPlan), which an outmatched commander must still build.
const fielded = (s: GameState, u: Unit): boolean =>
  u.hp > 0 && u.kind !== 'hauler' && UNITS[u.kind].category !== 'air' && !isShip(u) && !UNITS[u.kind].hero && !!unitSpecOf(s, u).weapon;

/** The price of a side's armed land army (haulers, aircraft, ships and heroes left out). */
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

// ---- 2026-11-27: the passive commander -------------------------------------------------------------
//
// The hold above made the computer passive against a player who keeps a large army at home. Two
// faults, both measured (fireline-design.md, 2026-11-27):
// - The wave was weighed against every enemy on the map, so with three or four sides the commander
//   was nearly always "outmatched" and sent nothing. A wave is now weighed against the side it is
//   aimed at (and that side's allies), not the whole map.
// - The hold had no end. Against a player who never attacked, the Normal commander held 37% of the
//   time at the Standard pace and 50% with the full economy, and some battles saw no wave in 40
//   minutes. A wave now waits at most WAVE_PATIENCE intervals past due; after that it goes if its
//   army is worth at least WAVE_NERVE of the enemy's, since an army that only grows behind turrets
//   gives the player nothing to answer.

/** Intervals past due a wave may be held for being outmatched. */
export const WAVE_PATIENCE = 1;
/** Past that, the wave goes if its army is worth at least this share of the enemy's. */
export const WAVE_NERVE = 0.6;

/** The armed land army of `target` and every side on its team, by price. */
export function teamArmyValue(s: GameState, target: Owner): number {
  let v = 0;
  for (const u of s.units) if (isAlly(s, target, u.owner) && fielded(s, u)) v += UNITS[u.kind].cost;
  return v;
}

/**
 * True when a wave aimed at `target` should wait at home: the target's team is past the floor and
 * worth more than OUTMATCH_WAVE times this side's army, and the wave has not yet waited `waited`
 * ticks past `patience`, or has and is still worth under WAVE_NERVE of the enemy. With no target,
 * every enemy counts, as before.
 */
export function holdWave(s: GameState, owner: Owner, target: Owner | null, waited: number, patience: number): boolean {
  const foe = target === null ? enemyArmyValue(s, owner) : teamArmyValue(s, target);
  const own = armyValue(s, owner);
  if (foe < OUTMATCH_FLOOR || foe <= own * OUTMATCH_WAVE) return false;
  if (waited < patience) return true;
  return own < foe * WAVE_NERVE;
}

// ---- 2026-11-27: the adaptive commander's counter-punch ---------------------------------------------
//
// Changing its unit mix never made the adaptive commander beat a repeated plan (a tank column won 75%
// against it and against the fixed commander alike). What it lacked was timing. Against an enemy that
// commits a heavy armoured army of about its own size, it now braces: it keeps its wave at home, where
// its turrets fight beside it, for at most WAVE_PATIENCE intervals past due. And whenever the enemy's
// army has just been ground down (worth PUNCH_DROP or less of its largest in the last PUNCH_LOOK
// minutes) and its own is at least as large, it strikes at once with whatever is ready, wave due or not,
// before the enemy rebuilds. Adaptive commanders only; the fixed commander plays as before.

/** The enemy's army is "ground down" at this share of its recent peak or less. */
export const PUNCH_DROP = 0.7;
/** Minutes of the enemy's army value remembered (one sample a minute). */
export const PUNCH_LOOK = 3;
/** Bracing: the enemy's army is worth at least this share of ours. */
export const BRACE_SHARE = 0.8;

const valueOf = (s: GameState, owner: Owner, target: Owner | null): number => (target === null ? enemyArmyValue(s, owner) : teamArmyValue(s, target));

/** Once a minute, the enemy's army value goes into the commander's memory (replaced, never changed in place). */
export function sampleFoe(s: GameState, owner: Owner, target: Owner | null): void {
  if (s.tick % 600 !== 0) return;
  const mem = s.ai[owner];
  mem.foeValues = [...(mem.foeValues ?? []).slice(-(PUNCH_LOOK - 1)), valueOf(s, owner, target)];
}

/** The enemy's army has just been ground down and ours is at least as large: strike now. */
export function counterPunch(s: GameState, owner: Owner, target: Owner | null): boolean {
  const vals = s.ai[owner].foeValues;
  if (!vals || vals.length < 2) return false;
  const peak = Math.max(...vals);
  const now = valueOf(s, owner, target);
  return peak >= OUTMATCH_FLOOR && now <= peak * PUNCH_DROP && armyValue(s, owner) >= now;
}

/** A heavy armoured enemy army of about our size: fight it at home first. */
export function bracing(s: GameState, owner: Owner, target: Owner | null): boolean {
  return armourThreat(s, owner) && valueOf(s, owner, target) >= armyValue(s, owner) * BRACE_SHARE;
}
