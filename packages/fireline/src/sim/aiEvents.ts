/**
 * The computer commander and battlefield events (events.ts, 2026-11-28). Called once a decision from
 * ai.ts, before the reserve is counted: a party sent for a crate or to hold a beacon is out of the
 * reserve, so no wave recruits it on the way.
 *
 *  - A supply crate: a few of its fastest units race for the nearest crate it can reach first, or
 *    about as soon as its enemies.
 *  - The relief beacon: a stronger party goes to hold it, by attack-move, so it fights for it.
 *  - An ore strike needs nothing here: the commander's economy already expands toward unclaimed ore.
 *
 * Its character (characters.ts) sets how keen it is: a Striker or Hunter goes further and in greater
 * numbers, a Bulwark only for what lies on its own side of the map. It never sends a party while its
 * base is under threat. Nothing runs without events: the party memory is never created.
 *
 * Pure: no Math.random, no clock, no draws.
 */
import { doMove } from './commands';
import { characterOf } from './characters';
import { liveEvents, type FieldEvent } from './events';
import { dist } from './grid';
import { type Difficulty, type Owner } from './rules';
import { enemiesOf, startOf } from './sides';
import { unitSpecOf } from './specs';
import type { GameState, Unit } from './types';

/** Units in a party for a crate and for the beacon, by difficulty. */
const DROP_PARTY: Record<Difficulty, number> = { easy: 1, normal: 2, hard: 3 };
const RELIEF_PARTY: Record<Difficulty, number> = { easy: 3, normal: 4, hard: 6 };
/** Armed units kept at home beyond a party before one is sent for the beacon. */
const KEEP_HOME = 3;
/** An enemy this close to home (tiles) means no party goes out. */
const THREAT_RANGE = 15;

/** How keen a character is: the share of its nearest enemy's distance it will go beyond its own, and extra hands. */
function keenness(s: GameState, owner: Owner): { reach: number; extra: number } {
  const c = characterOf(s, owner);
  if (c === 'striker' || c === 'hunter') return { reach: 1.5, extra: 1 };
  if (c === 'bulwark') return { reach: 1.0, extra: -1 };
  return { reach: 1.25, extra: 0 };
}

const centreOf = (e: FieldEvent) => ({ x: e.x + 0.5, y: e.y + 0.5 });

/**
 * The commander's event party, kept moving toward its crate or beacon. Returns the ids of the units in
 * it, which the caller leaves out of the reserve.
 */
export function eventsPlan(s: GameState, owner: Owner, army: Unit[], busy: Set<number>, home: { x: number; y: number }, foes: Unit[], diff: Difficulty): number[] {
  const live = liveEvents(s).filter(e => e.kind === 'drop' || e.kind === 'relief');
  const mem = s.ai[owner];
  const party = mem.eventParty;
  if (!live.length && !party) return [];
  const byId = new Map(army.map(u => [u.id, u]));

  // A party already out: kept on its way, or brought home when its crate or beacon is gone.
  if (party && typeof party === 'object' && Array.isArray(party.ids)) {
    const item = live.find(e => e.id === party.item);
    const members = party.ids.map(id => byId.get(id)).filter((u): u is Unit => !!u && !busy.has(u.id));
    if (!item || !members.length) {
      if (members.length) doMove(s, owner, members.map(u => u.id), home.x, home.y, false);
      mem.eventParty = null;
      return [];
    }
    const c = centreOf(item);
    const strays = members.filter(u => u.order.type === 'idle' && dist(u.x, u.y, c.x, c.y) > 1.5).map(u => u.id);
    if (strays.length) doMove(s, owner, strays, c.x, c.y, item.kind === 'relief');
    if (members.length !== party.ids.length) mem.eventParty = { item: party.item, ids: members.map(u => u.id) };
    return members.map(u => u.id);
  }
  if (party !== undefined && party !== null) mem.eventParty = null;

  // Never with the base under threat.
  if (foes.some(f => unitSpecOf(s, f).weapon && dist(f.x, f.y, home.x, home.y) < THREAT_RANGE)) return [];

  const keen = keenness(s, owner);
  const enemyStarts = enemiesOf(s, owner).map(o => {
    const st = startOf(s, o);
    return { x: st.x + 1.5, y: st.y + 1.5 };
  });
  // The nearest item it reaches about as soon as its nearest enemy (by the yards' distances).
  let best: FieldEvent | null = null;
  let bestD = Infinity;
  for (const e of live) {
    const c = centreOf(e);
    const mine = dist(c.x, c.y, home.x, home.y);
    const theirs = Math.min(Infinity, ...enemyStarts.map(p => dist(c.x, c.y, p.x, p.y)));
    if (mine > theirs * keen.reach) continue;
    if (mine < bestD) {
      best = e;
      bestD = mine;
    }
  }
  if (!best) return [];
  const c = centreOf(best);
  const idle = army.filter(
    u => !busy.has(u.id) && u.kind !== 'hauler' && u.hp >= unitSpecOf(s, u).hp * 0.6 && (u.order.type === 'idle' || u.order.type === 'move' || u.order.type === 'attackMove'),
  );
  let ids: number[];
  if (best.kind === 'drop') {
    const want = Math.max(1, DROP_PARTY[diff] + keen.extra);
    // The fastest first, then the nearest: a race.
    ids = idle
      .slice()
      .sort((a, b) => unitSpecOf(s, b).speed - unitSpecOf(s, a).speed || dist(a.x, a.y, c.x, c.y) - dist(b.x, b.y, c.x, c.y) || a.id - b.id)
      .slice(0, want)
      .map(u => u.id);
    if (!ids.length) return [];
  } else {
    const want = Math.max(2, RELIEF_PARTY[diff] + keen.extra);
    if (idle.length < want + KEEP_HOME) return [];
    ids = idle
      .slice()
      .sort((a, b) => dist(a.x, a.y, c.x, c.y) - dist(b.x, b.y, c.x, c.y) || a.id - b.id)
      .slice(0, want)
      .map(u => u.id);
  }
  doMove(s, owner, ids, c.x, c.y, best.kind === 'relief');
  mem.eventParty = { item: best.id, ids };
  return ids;
}
