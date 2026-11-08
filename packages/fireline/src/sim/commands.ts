import { dockTile, nearestPassable, occupancy } from './grid';
import { idx, inBounds, isWalkable } from './map';
import {
  BUILD_RADIUS,
  BUILDINGS,
  MAP_W,
  MAX_QUEUE,
  SELL_RETURN,
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
  costOf,
  log,
  readyStructure,
  unlocked,
} from './state';
import type { GameState, Unit } from './types';

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
  if (categoryOf(kind) !== category) return false;
  const p = s.players[owner];
  if (p.queues[category].length >= (category === 'building' ? 1 : MAX_QUEUE)) return false;
  if (!unlocked(s, owner, kind)) return false;
  return p.credits >= costOf(kind);
}

export function doQueue(s: GameState, owner: Owner, category: Category, kind: BuildingKind | UnitKind): void {
  const p = s.players[owner];
  p.credits -= costOf(kind);
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
      s.players[owner].credits += costOf(kind);
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
    const d = { x: x + 1, y: y + spec.h };
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

export function canMove(s: GameState, owner: Owner, ids: number[], x: number, y: number): boolean {
  return validPoint(x, y) && ownUnits(s, owner, ids).length > 0;
}

/**
 * Spreads a group around the target point so they do not all fight for one tile: unit i of n
 * takes a slot on a small spiral, in the order they were selected.
 */
export function doMove(s: GameState, owner: Owner, ids: number[], x: number, y: number, attackMove: boolean): void {
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
    u.order = attackMove && UNITS[u.kind].weapon ? { type: 'attackMove', x: tx, y: ty } : { type: 'move', x: tx, y: ty };
    u.engage = 0;
    u.path = [];
    u.pathGoal = -1;
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

export function canAttack(s: GameState, owner: Owner, ids: number[], target: number): boolean {
  const enemy =
    s.units.some(u => u.id === target && u.owner !== owner) || s.buildings.some(b => b.id === target && b.owner !== owner);
  return enemy && ownUnits(s, owner, ids).some(u => UNITS[u.kind].weapon);
}

export function doAttack(s: GameState, owner: Owner, ids: number[], target: number): void {
  for (const u of ownUnits(s, owner, ids)) {
    if (!UNITS[u.kind].weapon) continue;
    u.order = { type: 'attack', target };
    u.engage = target;
    u.path = [];
    u.pathGoal = -1;
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
    u.path = [];
    u.pathGoal = -1;
  }
}

export { buildTicksOf };
