import { dockTile, frontRow, nearestPassable, occupancy, passable } from './grid';
import { idx, inBounds, isWalkable } from './map';
import {
  BUILD_RADIUS,
  BUILDINGS,
  MAP_W,
  MAX_QUEUE,
  ORDER_QUEUE_MAX,
  SELL_RETURN,
  survivorsFor,
  UNITS,
  type BuildingKind,
  type Category,
  type Owner,
  type UnitKind,
} from './rules';
import {
  addBuilding,
  addUnit,
  buildTicksOf,
  categoryOf,
  costFor,
  log,
  readyStructure,
  unlocked,
} from './state';
import type { Building, GameState, QueuedOrder, Stance, Unit } from './types';

/**
 * Orders, shared by the player and the computer. Each `can*` check reads the state without
 * changing it; each `do*` applies an order the matching check has passed, to a state the caller
 * has already cloned. The reducer uses the checks to return an illegal action's state untouched.
 */

export function ownUnits(s: GameState, owner: Owner, ids: number[]): Unit[] {
  const want = new Set(ids);
  return s.units.filter(u => u.owner === owner && want.has(u.id));
}

export function canQueue(s: GameState, owner: Owner, category: Category, kind: BuildingKind | UnitKind): boolean {
  if (!(kind in BUILDINGS) && !(kind in UNITS)) return false;
  if (kind === 'hq') return false;
  // Heroes are campaign characters, never built.
  if (kind in UNITS && UNITS[kind as UnitKind].hero) return false;
  if (categoryOf(kind) !== category) return false;
  // A mission limits what side 0 may build to what the campaign has unlocked.
  if (owner === 0 && s.allowed && !s.allowed.includes(kind)) return false;
  const p = s.players[owner];
  if (p.queues[category].length >= (category === 'building' ? 1 : MAX_QUEUE)) return false;
  if (!unlocked(s, owner, kind)) return false;
  return p.credits >= costFor(s, owner, kind);
}

export function doQueue(s: GameState, owner: Owner, category: Category, kind: BuildingKind | UnitKind): void {
  const p = s.players[owner];
  p.credits -= costFor(s, owner, kind);
  p.queues[category].push({ kind, progress: 0 });
}

/** Cancels the last queued item of that kind, refunding it in full. */
export function canCancel(s: GameState, owner: Owner, category: Category, kind: BuildingKind | UnitKind): boolean {
  return s.players[owner].queues[category]?.some(q => q.kind === kind) ?? false;
}

export function doCancel(s: GameState, owner: Owner, category: Category, kind: BuildingKind | UnitKind): void {
  const q = s.players[owner].queues[category];
  for (let i = q.length - 1; i >= 0; i--) {
    if (q[i].kind === kind) {
      q.splice(i, 1);
      s.players[owner].credits += costFor(s, owner, kind);
      return;
    }
  }
}

/** Why a structure cannot go at (x, y), or null if it can. Shared with the placement preview. */
export function placementProblem(s: GameState, owner: Owner, kind: BuildingKind, x: number, y: number, occ = occupancy(s)): string | null {
  const spec = BUILDINGS[kind];
  if (!spec || kind === 'hq') return 'Cannot build that';
  if (!Number.isInteger(x) || !Number.isInteger(y)) return 'Off the map';
  if (!inBounds(x, y) || !inBounds(x + spec.w - 1, y + spec.h - 1)) return 'Off the map';
  const foot = new Set<number>();
  for (let ty = y; ty < y + spec.h; ty++)
    for (let tx = x; tx < x + spec.w; tx++) {
      const k = idx(tx, ty);
      foot.add(k);
      if (!isWalkable(s.tiles[k])) return 'Ground is not clear';
      if (s.ore[k] > 0) return 'Cannot build on ore';
      if (occ[k]) return 'Something is already there';
    }
  for (const u of s.units) {
    if (u.x >= x - 0.2 && u.x < x + spec.w + 0.2 && u.y >= y - 0.2 && u.y < y + spec.h + 0.2) return 'Units in the way';
  }
  // Never cover a refinery's dock, and a new refinery needs its own dock clear.
  for (const b of s.buildings) {
    if (b.kind !== 'refinery') continue;
    const d = dockTile(b);
    if (foot.has(idx(d.x, d.y))) return 'Blocks a refinery dock';
  }
  if (kind === 'refinery') {
    const d = { x: x + 1, y: frontRow(owner, y, spec.h) };
    if (!inBounds(d.x, d.y) || !isWalkable(s.tiles[idx(d.x, d.y)]) || occ[idx(d.x, d.y)]) return 'The dock pad below needs clear ground';
  }
  // Near something we already own.
  const near = s.buildings.some(b => {
    if (b.owner !== owner) return false;
    const bs = BUILDINGS[b.kind];
    const gapX = Math.max(0, b.x - (x + spec.w - 1), x - (b.x + bs.w - 1));
    const gapY = Math.max(0, b.y - (y + spec.h - 1), y - (b.y + bs.h - 1));
    return Math.max(gapX, gapY) <= BUILD_RADIUS;
  });
  if (!near) return 'Too far from your base';
  return null;
}

export function canPlace(s: GameState, owner: Owner, kind: BuildingKind, x: number, y: number): boolean {
  if (readyStructure(s, owner) !== kind) return false;
  return placementProblem(s, owner, kind, x, y) === null;
}

export function doPlace(s: GameState, owner: Owner, kind: BuildingKind, x: number, y: number): void {
  s.players[owner].queues.building.shift();
  const b = addBuilding(s, owner, kind, x, y);
  s.players[owner].stats.built++;
  if (kind === 'refinery') {
    const d = dockTile(b);
    const h = addUnit(s, owner, 'hauler', d.x + 0.5, d.y + 0.5);
    h.order = { type: 'harvest', phase: 'seek', tile: -1, refinery: b.id };
  }
  if (owner === 0) log(s, `${BUILDINGS[kind].name} placed.`, 'good');
}

export function canSell(s: GameState, owner: Owner, id: number): boolean {
  return s.buildings.some(b => b.id === id && b.owner === owner);
}

export function doSell(s: GameState, owner: Owner, id: number): void {
  const b = s.buildings.find(x => x.id === id)!;
  const spec = BUILDINGS[b.kind];
  const refund = Math.floor((spec.cost * SELL_RETURN * (b.hp / spec.hp)) / 10) * 10;
  s.players[owner].credits += refund;
  s.buildings = s.buildings.filter(x => x.id !== id);
  s.effects.push({ id: s.nextId++, kind: 'sold', x: b.x + spec.w / 2, y: b.y + spec.h / 2, at: s.tick, size: Math.max(spec.w, spec.h) });
  if (owner === 0) log(s, `${spec.name} sold for ${refund} credits.`);
  // The crew walks out, unless that was the last structure and the battle is over.
  if (s.buildings.some(o => o.owner === owner)) spawnSurvivors(s, b, occupancy(s));
}

/**
 * The crew of a structure that has just gone (sold or destroyed, already removed from the state):
 * one to three riflemen by size, for its owner, on its footprint or the ring around it, on clear
 * ground with nobody already standing there. Fewer come out when there is less room. `occ` must
 * not include the structure. Returns how many came out.
 */
export function spawnSurvivors(s: GameState, b: Building, occ: Int32Array): number {
  const spec = BUILDINGS[b.kind];
  const want = survivorsFor(spec.w, spec.h);
  const taken = new Set<number>();
  for (const u of s.units) if (u.hp > 0) taken.add(Math.floor(u.y) * MAP_W + Math.floor(u.x));
  let made = 0;
  // The footprint first, then the ring around it, each in row order, so a replay picks the same.
  for (let ring = 0; ring <= 1 && made < want; ring++)
    for (let y = b.y - ring; y < b.y + spec.h + ring && made < want; y++)
      for (let x = b.x - ring; x < b.x + spec.w + ring && made < want; x++) {
        const inside = x >= b.x && x < b.x + spec.w && y >= b.y && y < b.y + spec.h;
        if (ring === 1 && inside) continue;
        const k = y * MAP_W + x;
        if (taken.has(k) || !passable(s, occ, x, y)) continue;
        taken.add(k);
        addUnit(s, b.owner, 'rifleman', x + 0.5, y + 0.5);
        made++;
      }
  return made;
}

export function canRepair(s: GameState, owner: Owner, id: number): boolean {
  return s.buildings.some(b => b.id === id && b.owner === owner);
}

export function doRepair(s: GameState, id: number): void {
  const b = s.buildings.find(x => x.id === id)!;
  b.repairing = !b.repairing;
}

export function canRally(s: GameState, owner: Owner, id: number, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !inBounds(Math.floor(x), Math.floor(y))) return false;
  const b = s.buildings.find(v => v.id === id && v.owner === owner);
  return !!b && (b.kind === 'barracks' || b.kind === 'factory');
}

export function doRally(s: GameState, id: number, x: number, y: number): void {
  const b = s.buildings.find(v => v.id === id)!;
  b.rally = { x, y };
}

const validPoint = (x: number, y: number) =>
  Number.isFinite(x) && Number.isFinite(y) && inBounds(Math.floor(x), Math.floor(y));

/** True when this unit's current order is one a queued order waits behind. */
const busy = (u: Unit) => u.order.type === 'move' || u.order.type === 'attackMove' || u.order.type === 'attack';

/** Whether a queued order would be taken: an idle unit starts it, a busy one needs queue room. */
const acceptsQueued = (u: Unit) => !busy(u) || u.queue.length < ORDER_QUEUE_MAX;

export function canMove(s: GameState, owner: Owner, ids: number[], x: number, y: number, queue = false): boolean {
  if (!validPoint(x, y)) return false;
  const units = ownUnits(s, owner, ids);
  return queue ? units.some(acceptsQueued) : units.length > 0;
}

/**
 * Gives a unit an order. Not queued: replaces whatever it was doing and forgets its queue. Queued:
 * a unit that is idle (or harvesting) starts it at once; a busy one adds it to the end of its
 * queue, if there is room.
 */
function give(u: Unit, o: QueuedOrder, queue: boolean): void {
  if (queue && busy(u)) {
    if (u.queue.length < ORDER_QUEUE_MAX) u.queue.push(o);
    return;
  }
  u.order = o;
  u.engage = o.type === 'attack' ? o.target : 0;
  u.path = [];
  u.pathGoal = -1;
  if (!queue) u.queue = [];
}

/**
 * Spreads a group around the target point so they do not all fight for one tile: unit i of n
 * takes a slot on a small spiral, in the order they were selected.
 */
export function doMove(s: GameState, owner: Owner, ids: number[], x: number, y: number, attackMove: boolean, queue = false): void {
  const units = ownUnits(s, owner, ids);
  const occ = occupancy(s);
  const slots = formation(units.length);
  units.forEach((u, i) => {
    const [ox, oy] = slots[i] ?? [0, 0];
    let tx = x + ox;
    let ty = y + oy;
    const k = nearestPassable(s, occ, tx, ty, 4);
    if (k >= 0 && (Math.floor(tx) !== k % MAP_W || Math.floor(ty) !== ((k / MAP_W) | 0))) {
      tx = (k % MAP_W) + 0.5;
      ty = ((k / MAP_W) | 0) + 0.5;
    }
    give(u, attackMove && UNITS[u.kind].weapon ? { type: 'attackMove', x: tx, y: ty } : { type: 'move', x: tx, y: ty }, queue);
  });
}

/** Slots on a grid 0.9 tiles apart, nearest first. Integer maths only, so it replays exactly. */
const SLOTS: [number, number][] = (() => {
  const out: [number, number, number][] = [];
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) out.push([dx, dy, dx * dx + dy * dy]);
  out.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  return out.map(([dx, dy]) => [dx * 0.9, dy * 0.9]);
})();

function formation(n: number): [number, number][] {
  return SLOTS.slice(0, Math.max(1, Math.min(n, SLOTS.length)));
}

export function canAttack(s: GameState, owner: Owner, ids: number[], target: number, queue = false): boolean {
  const enemy =
    s.units.some(u => u.id === target && u.owner !== owner) || s.buildings.some(b => b.id === target && b.owner !== owner);
  return enemy && ownUnits(s, owner, ids).some(u => UNITS[u.kind].weapon && (!queue || acceptsQueued(u)));
}

export function doAttack(s: GameState, owner: Owner, ids: number[], target: number, queue = false): void {
  for (const u of ownUnits(s, owner, ids)) {
    if (!UNITS[u.kind].weapon) continue;
    give(u, { type: 'attack', target }, queue);
  }
}

const STANCES: readonly Stance[] = ['aggressive', 'guard', 'hold'];

/** Legal when at least one of the armed units named would change stance. */
export function canStance(s: GameState, owner: Owner, ids: number[], stance: Stance): boolean {
  if (!STANCES.includes(stance)) return false;
  return ownUnits(s, owner, ids).some(u => UNITS[u.kind].weapon && u.stance !== stance);
}

export function doStance(s: GameState, owner: Owner, ids: number[], stance: Stance): void {
  for (const u of ownUnits(s, owner, ids)) {
    if (!UNITS[u.kind].weapon) continue;
    u.stance = stance;
    // Holding fire: an idle unit drops whatever it was shooting at.
    if (stance === 'hold' && u.order.type === 'idle') {
      u.engage = 0;
      u.path = [];
      u.pathGoal = -1;
    }
  }
}

export function canStop(s: GameState, owner: Owner, ids: number[]): boolean {
  return ownUnits(s, owner, ids).length > 0;
}

export function doStop(s: GameState, owner: Owner, ids: number[]): void {
  for (const u of ownUnits(s, owner, ids)) {
    u.order = { type: 'idle' };
    u.engage = 0;
    u.path = [];
    u.pathGoal = -1;
    u.queue = [];
  }
}

export function canHarvest(s: GameState, owner: Owner, ids: number[], tile?: number, refinery?: number): boolean {
  if (!ownUnits(s, owner, ids).some(u => u.kind === 'hauler')) return false;
  if (tile !== undefined && (!Number.isInteger(tile) || tile < 0 || tile >= s.ore.length || s.ore[tile] <= 0)) return false;
  if (refinery !== undefined && !s.buildings.some(b => b.id === refinery && b.owner === owner && b.kind === 'refinery')) return false;
  return true;
}

export function doHarvest(s: GameState, owner: Owner, ids: number[], tile?: number, refinery?: number): void {
  for (const u of ownUnits(s, owner, ids)) {
    if (u.kind !== 'hauler') continue;
    if (refinery !== undefined) u.order = { type: 'harvest', phase: 'return', tile: -1, refinery };
    else u.order = { type: 'harvest', phase: 'seek', tile: tile ?? -1, refinery: 0 };
    u.queue = [];
    u.path = [];
    u.pathGoal = -1;
  }
}

export { buildTicksOf };
