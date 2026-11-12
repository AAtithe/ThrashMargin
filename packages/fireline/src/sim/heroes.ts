/**
 * Heroes in free play (fireline-round6-design.md, workstream B). A skirmish set up with heroes on
 * and advanced tech may recruit the campaign's four heroes once a Command Academy stands, through
 * the ordinary queues (the Spy, Commando and Engineer at the Barracks, the Ace at the War Factory).
 *
 * - One of each per side, counting the hero standing and the hero queued.
 * - A hero that falls may be recruited again HERO_REVIVE_TICKS later, at HERO_REVIVE_SHARE of its
 *   price, and comes back wounded (half health) with the experience it had: the campaign's own rule
 *   for a hero who fell, applied within one battle.
 * - A recruited hero gets its hero state (level from its experience, ability ready) and its health
 *   from heroMaxHp the step it leaves the producer (enlistHeroes, from the hero tick).
 *
 * Nothing here runs in a mission or with heroes off: a mission's heroes are the campaign's, placed
 * by createMissionState, and its rules are untouched.
 */
import { heroLevelFor, TICKS_PER_SECOND, UNITS, type HeroKind, type Owner, type UnitKind } from './rules';
import { setupOf } from './state';
import { heroMaxHp, setMaxHp } from './mission';
import type { GameState, Unit } from './types';

/** True in a skirmish set up with heroes on and advanced tech: the one place free-play heroes exist. */
export function heroesInPlay(s: GameState): boolean {
  // A planet battle's heroes are the war's own (main's, side 0 only), never round 6's recruits.
  if (s.mission || s.planet) return false;
  const setup = setupOf(s);
  return setup.heroes === true && setup.tech === 'advanced';
}

export const isHeroKind = (kind: string): kind is HeroKind => kind in UNITS && !!UNITS[kind as UnitKind].hero;

/** This side's heroes of a kind: standing (alive) plus queued. */
export function heroCount(s: GameState, owner: Owner, kind: HeroKind): number {
  let n = 0;
  for (const u of s.units) if (u.owner === owner && u.kind === kind && u.hp > 0) n++;
  for (const q of s.players[owner].queues[UNITS[kind].category] ?? []) if (q.kind === kind) n++;
  return n;
}

/** Ticks until this side may recruit a fallen hero again; 0 when it may (or it never fell). */
export function reviveWait(s: GameState, owner: Owner, kind: HeroKind): number {
  const f = s.players[owner].heroFallen?.[kind];
  return f ? Math.max(0, f.at - s.tick) : 0;
}

/**
 * Why this side cannot recruit this hero now, beyond the rules every queue shares (tech, the
 * Academy, room in the queue, credits), or null if nothing else stands in the way.
 */
export function heroRecruitProblem(s: GameState, owner: Owner, kind: HeroKind): string | null {
  if (heroCount(s, owner, kind) > 0) return `${UNITS[kind].name} is already in the field`;
  const wait = reviveWait(s, owner, kind);
  if (wait > 0) return `${UNITS[kind].name} can be recruited again in ${Math.ceil(wait / TICKS_PER_SECOND)}s`;
  return null;
}

/**
 * Freshly trained heroes become heroes: level from the experience a fallen one kept, the ability
 * ready, full health (half for one coming back after falling). The fallen record goes with it. Works
 * in place on the state the step is advancing.
 */
export function enlistHeroes(s: GameState): void {
  for (const u of s.units) {
    if (u.hero || u.hp <= 0 || !isHeroKind(u.kind)) continue;
    enlist(s, u);
  }
}

function enlist(s: GameState, u: Unit): void {
  const kind = u.kind as HeroKind;
  const p = s.players[u.owner];
  const fallen = p.heroFallen?.[kind];
  const xp = fallen ? fallen.xp : 0;
  const level = heroLevelFor(xp);
  u.hero = { level, xp, abilityCd: 0 };
  const max = heroMaxHp(s, u, level);
  setMaxHp(u, max);
  u.hp = fallen ? Math.max(1, Math.round(max / 2)) : max;
  if (fallen) {
    const rest = { ...p.heroFallen };
    delete rest[kind];
    if (Object.keys(rest).length) p.heroFallen = rest;
    else delete p.heroFallen;
  }
}
