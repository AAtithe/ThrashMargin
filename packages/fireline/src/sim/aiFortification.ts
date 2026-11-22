/**
 * Round 7: the computer and the Fortification line (fireline-round7-fortification.md). Normal and
 * Hard only, on the Long and Epic paces, and only once its structures have taken indirect fire
 * (fortification.ts counts it): the line costs a research slot and a doctrine, so a commander that is
 * not being shelled or bombed spends neither on it.
 *
 *  - Research: Reinforced concrete, then Hardened shelters, then a doctrine: Counter-battery when more
 *    than twice as much of the fire came from guns on the ground as from the air and support powers,
 *    and it has two Artillery or more to answer them with; Point Defence otherwise.
 *  - Point Defence emplacements while it is being shelled, up to two (Normal) or three (Hard), each
 *    beside the structure last hit, or the nearest core structure no emplacement yet covers.
 */
import { dist } from './grid';
import { doDoctrine, doctrineProblem } from './research';
import { POINT_DEFENCE_RADIUS, UPGRADES, type BuildingKind, type Difficulty, type Owner, type UpgradeId } from './rules';
import { fortificationOn } from './fortify';
import { countBuildings, paceOf } from './state';
import { buildingSpecOf } from './specs';
import type { GameState } from './types';

/** Blasts on its structures before the commander turns to the line. */
export const FORT_PRESSURE_MIN = 6;
/** Ticks since the last blast within which it still counts as being shelled (for Point Defence). */
export const FORT_RECENT = 900;
/** Point Defence emplacements the commander keeps, by difficulty. */
export const FORT_PD_MAX: Record<Difficulty, number> = { easy: 0, normal: 2, hard: 3 };

/** True when this side's commander plays the line at all in this battle. */
export function commanderFortifies(s: GameState, diff: Difficulty): boolean {
  const pace = paceOf(s);
  return fortificationOn(s) && diff !== 'easy' && (pace === 'long' || pace === 'epic');
}

const has = (s: GameState, owner: Owner, id: UpgradeId) => !!s.players[owner].upgrades?.includes(id);
const standsFor = (s: GameState, owner: Owner, id: UpgradeId) => UPGRADES[id].requires.every(k => countBuildings(s, owner, k) > 0);

/** The branch the commander adopts: see the header. */
export function fortificationBranch(s: GameState, owner: Owner): UpgradeId {
  const m = s.ai[owner];
  const air = m.shellAir ?? 0;
  const ground = m.shellGround ?? 0;
  // Counter-battery pays only with guns of its own to answer with, and only against fire that comes
  // mostly from guns on the ground: Point Defence also stops shells, and bombs and powers besides.
  if (ground <= 2 * air) return 'pointdef';
  const guns = s.units.filter(u => u.owner === owner && u.kind === 'artillery' && u.hp > 0).length;
  return guns >= 2 ? 'counterbattery' : 'pointdef';
}

/**
 * The line's next research for this commander, ahead of its paced list, or null to leave the list
 * alone. Adopts the doctrine itself (free) when Mk II is done.
 */
export function fortificationNext(s: GameState, owner: Owner, diff: Difficulty): UpgradeId | null {
  if (!commanderFortifies(s, diff)) return null;
  const m = s.ai[owner];
  if ((m.shellAir ?? 0) + (m.shellGround ?? 0) < FORT_PRESSURE_MIN) return null;
  if (!has(s, owner, 'concrete')) return standsFor(s, owner, 'concrete') ? 'concrete' : null;
  if (!has(s, owner, 'shelters')) return standsFor(s, owner, 'shelters') ? 'shelters' : null;
  let d = s.players[owner].doctrines?.fortification;
  if (!d) {
    const want = fortificationBranch(s, owner);
    if (doctrineProblem(s, owner, 'fortification', want) !== null) return null;
    doDoctrine(s, owner, 'fortification', want);
    d = want;
  }
  if (has(s, owner, d) || !standsFor(s, owner, d)) return null;
  return d;
}

/** True when the commander wants another Point Defence emplacement now. */
export function wantsPointDefence(s: GameState, owner: Owner, diff: Difficulty): boolean {
  if (!commanderFortifies(s, diff) || !has(s, owner, 'pointdef')) return false;
  const m = s.ai[owner];
  if (m.shellTick === undefined || s.tick - m.shellTick > FORT_RECENT) return false;
  const p = s.players[owner];
  if (p.queues.building.length) return false;
  return countBuildings(s, owner, 'pointdefence') < FORT_PD_MAX[diff];
}

const CORE: BuildingKind[] = ['hq', 'factory', 'refinery', 'researchlab', 'techcentre', 'power', 'barracks'];

/**
 * Where findSpot (ai.ts) puts the next emplacement: the structure last shelled, unless an emplacement
 * already covers it; then the first core structure none covers. Null: the Command Yard's area.
 */
export function pointDefenceFocus(s: GameState, owner: Owner): { x: number; y: number } | null {
  const pds = s.buildings.filter(b => b.owner === owner && b.kind === 'pointdefence' && b.hp > 0);
  const covered = (x: number, y: number) => pds.some(b => dist(b.x + 0.5, b.y + 0.5, x, y) <= POINT_DEFENCE_RADIUS - 1);
  const m = s.ai[owner];
  if (m.shellX !== undefined && m.shellY !== undefined && !covered(m.shellX, m.shellY)) return { x: m.shellX, y: m.shellY };
  for (const kind of CORE)
    for (const b of s.buildings) {
      if (b.owner !== owner || b.kind !== kind || b.hp <= 0) continue;
      const spec = buildingSpecOf(s, b);
      const x = b.x + spec.w / 2;
      const y = b.y + spec.h / 2;
      if (!covered(x, y)) return { x, y };
    }
  return null;
}
