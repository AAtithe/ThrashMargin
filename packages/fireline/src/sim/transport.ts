import { isAir, padSpot } from './air';
import { doMove } from './commands';
import { dist, nearestPassable, occupancy } from './grid';
import { BOARD_RANGE, UNITS, UNLOAD_RADIUS, type Owner } from './rules';
import { log } from './state';
import type { GameState, Unit } from './types';

/**
 * Troop Carriers (the air war, 2026-11-10). Advanced tech only, like every aircraft.
 *
 * Boarding: infantry ordered aboard (`board`) walk to the carrier with `Unit.boarding` set. Once one
 * is within BOARD_RANGE of it, and the carrier is still (hovering with no order, or parked on its
 * pad) with room, it climbs in: it leaves `s.units` and is kept, exactly as it was, in the carrier's
 * `carried` list. Any other order cancels the walk; so does arriving to find the carrier gone.
 *
 * Unloading (`unload`): a still carrier sets its infantry down at once, each on its own free tile
 * within UNLOAD_RADIUS of it; a moving one sets them down where it next stops (`Unit.drop`). With
 * no ground to stand on there (water, rock), it cannot unload, and a pending drop waits.
 *
 * A carrier shot down takes everyone aboard with it.
 */

export const capacityOf = (u: Unit): number => UNITS[u.kind].carries ?? 0;
export const aboard = (u: Unit): number => u.carried?.length ?? 0;
/**
 * Infantry that may ride: any infantry but the heroes and (round 6 merge) the field General, whose
 * aura and doctrine would read it as fallen the moment it left the map.
 */
export const canRide = (u: Unit): boolean => UNITS[u.kind].category === 'infantry' && !UNITS[u.kind].hero && u.kind !== 'general';

/** A carrier that is not moving: hovering with no order, or landed on its pad. */
export function isStill(s: GameState, c: Unit): boolean {
  if (c.order.type === 'idle') return true;
  if (c.order.type !== 'rearm' || !c.pad) return false;
  const pad = s.buildings.find(b => b.id === c.pad && b.hp > 0);
  if (!pad) return false;
  const spot = padSpot(s, pad, c);
  return c.x === spot.x && c.y === spot.y;
}

function carrierOf(s: GameState, owner: Owner, id: number): Unit | null {
  const c = s.units.find(u => u.id === id);
  return c && c.owner === owner && c.hp > 0 && capacityOf(c) > 0 ? c : null;
}

/** Why these units cannot be ordered aboard that carrier now, or null if (some of) they can. */
export function boardProblem(s: GameState, owner: Owner, ids: number[], carrier: number): string | null {
  const c = carrierOf(s, owner, carrier);
  if (!c) return 'No such Troop Carrier';
  const riders = s.units.filter(u => ids.includes(u.id) && u.owner === owner && u.hp > 0 && canRide(u));
  if (!riders.length) return 'Only infantry can board';
  if (aboard(c) >= capacityOf(c)) return 'The Troop Carrier is full';
  return null;
}

/** Sends the infantry among `ids` to the carrier, to climb in when they reach it. */
export function doBoard(s: GameState, owner: Owner, ids: number[], carrier: number): void {
  const c = carrierOf(s, owner, carrier)!;
  const riders = s.units.filter(u => ids.includes(u.id) && u.owner === owner && u.hp > 0 && canRide(u)).map(u => u.id);
  doMove(s, owner, riders, c.x, c.y, false);
  for (const u of s.units) if (riders.includes(u.id)) u.boarding = c.id;
}

/** Why this carrier cannot unload now, or null if it can (now, or where it next stops). */
export function unloadProblem(s: GameState, owner: Owner, id: number): string | null {
  const c = carrierOf(s, owner, id);
  if (!c) return 'No such Troop Carrier';
  if (!aboard(c)) return 'Nobody aboard';
  if (isStill(s, c) && !landingTiles(s, c, 1).length) return 'No ground to set them down on here';
  return null;
}

export function doUnload(s: GameState, owner: Owner, id: number): void {
  const c = carrierOf(s, owner, id)!;
  if (isStill(s, c)) setDown(s, c);
  else c.drop = true;
}

/** Up to n free tiles to stand on round the carrier, nearest first. */
function landingTiles(s: GameState, c: Unit, n: number): number[] {
  const occ = occupancy(s);
  for (const u of s.units) if (u.hp > 0 && !isAir(u)) occ[Math.floor(u.y) * s.mapW + Math.floor(u.x)] = -1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = nearestPassable(s, occ, c.x, c.y, UNLOAD_RADIUS);
    if (k < 0) break;
    out.push(k);
    occ[k] = -1;
  }
  return out;
}

/** Sets down as many aboard as there is ground for. True when someone got out. */
function setDown(s: GameState, c: Unit): boolean {
  const riders = c.carried ?? [];
  const tiles = landingTiles(s, c, riders.length);
  if (!tiles.length) return false;
  const out = riders.slice(0, tiles.length).map((r, i): Unit => ({
    ...r,
    x: (tiles[i] % s.mapW) + 0.5,
    y: Math.floor(tiles[i] / s.mapW) + 0.5,
    order: { type: 'idle' },
    engage: 0,
    path: [],
    pathGoal: -1,
    queue: [],
    stuck: 0,
    cooldown: 0,
  }));
  s.units = s.units.concat(out);
  const left = riders.slice(out.length);
  if (left.length) c.carried = left;
  else delete c.carried;
  if (!left.length && c.drop) delete c.drop;
  if (c.owner === 0) log(s, `${out.length} infantry set down.`, 'info');
  return true;
}

/**
 * One tick of boarding and setting down, after every unit has moved (tick.ts). Works in place on the
 * state the reducer cloned; units climbing in leave `s.units` here, never during the units loop.
 */
export function transportStep(s: GameState): void {
  let any = false;
  for (const u of s.units) if (u.boarding || u.drop) any = true;
  if (!any) return;
  const gone = new Set<number>();
  for (const u of s.units) {
    if (!u.boarding || u.hp <= 0) continue;
    const c = s.units.find(v => v.id === u.boarding);
    if (!c || c.hp <= 0 || c.owner !== u.owner || !canRide(u)) {
      delete u.boarding;
      continue;
    }
    if (dist(u.x, u.y, c.x, c.y) <= BOARD_RANGE && isStill(s, c) && aboard(c) < capacityOf(c)) {
      const rider: Unit = { ...u, order: { type: 'idle' }, engage: 0, path: [], pathGoal: -1, queue: [] };
      delete rider.boarding;
      c.carried = [...(c.carried ?? []), rider];
      gone.add(u.id);
      if (c.owner === 0 && aboard(c) === capacityOf(c)) log(s, 'Troop Carrier full.', 'info');
    } else if (u.order.type === 'idle') delete u.boarding;
  }
  if (gone.size) s.units = s.units.filter(u => !gone.has(u.id));
  for (const c of s.units) if (c.drop && c.hp > 0 && isStill(s, c)) setDown(s, c);
}

/** A carrier going down: everyone aboard is lost with it (counted in the side's losses). */
export function lostAboard(s: GameState, c: Unit): void {
  const n = aboard(c);
  if (!n) return;
  s.players[c.owner].stats.lost += n;
  if (c.owner === 0) log(s, `Troop Carrier down with ${n} aboard.`, 'bad');
  delete c.carried;
}
