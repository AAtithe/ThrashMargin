import { placementProblem } from './commands';
import { dist } from './grid';
import { upgradeNewUnit } from './research';
import {
  BUILDINGS,
  REPAIR_TRUCK_HP,
  REPAIR_TRUCK_RANGE,
  REPAIR_TRUCK_SEEK,
  REPAIR_TRUCK_TICKS,
  UNITS,
  type BuildingKind,
  type Owner,
} from './rules';
import { addBuilding, addUnit, isStructure, log, maxHpOf, producerFor, readyStructure } from './state';
import type { Building, GameState, Unit } from './types';
import { buildingSpec, buildingSpecOf, unitSpec, unitSpecOf } from './specs';

/**
 * Engineering vehicles (fireline-round5-design.md, workstream C): the Repair Truck, and the Forward
 * Base Truck that deploys into a Field Yard and packs up again. Advanced tech, skirmish only: none of
 * the three kinds is in STANDARD_TECH, so techAllowed keeps them out of every mission and every
 * standard-tech battle. The numbers are in rules.ts; the computer's use of them is in aiEngineering.ts.
 *
 * The `*Problem` functions read the state without changing it (null when the order is legal); the
 * `do*` functions apply an order its check has passed, to a state the caller has already cloned.
 */

/** A ground vehicle a Repair Truck can mend: category 'vehicle' (aircraft are 'air', infantry 'infantry'). */
const mendable = (v: Unit) => UNITS[v.kind].category === 'vehicle';

/**
 * A Repair Truck at work, called for every unit whose spec has `mender`. Every REPAIR_TRUCK_TICKS
 * the most damaged (by share of health) of its own side's ground vehicles within REPAIR_TRUCK_RANGE,
 * never itself, gets REPAIR_TRUCK_HP back, free. Idle and not on hold, it drives to the nearest
 * damaged vehicle of its side within REPAIR_TRUCK_SEEK; given an order, it follows the order.
 */
export function menderStep(s: GameState, u: Unit): void {
  if ((s.tick + u.id) % REPAIR_TRUCK_TICKS === 0) {
    let best: Unit | null = null;
    let bestShare = 1;
    for (const v of s.units) {
      if (v === u || v.owner !== u.owner || v.hp <= 0 || !mendable(v)) continue;
      if (Math.abs(v.x - u.x) > REPAIR_TRUCK_RANGE || Math.abs(v.y - u.y) > REPAIR_TRUCK_RANGE) continue;
      const max = maxHpOf(v);
      if (v.hp >= max || dist(u.x, u.y, v.x, v.y) > REPAIR_TRUCK_RANGE) continue;
      const share = v.hp / max;
      if (share < bestShare) {
        bestShare = share;
        best = v;
      }
    }
    if (best) {
      best.hp = Math.min(maxHpOf(best), best.hp + REPAIR_TRUCK_HP);
      // The spark on the mended vehicle, every other mend (enough to see it working).
      if (Math.floor(s.tick / REPAIR_TRUCK_TICKS) % 2 === 0) s.effects.push({ id: s.nextId++, kind: 'repair', x: best.x, y: best.y, at: s.tick, size: 0 });
    }
  }
  if (u.order.type !== 'idle' || u.stance === 'hold' || (s.tick + u.id) % 10 !== 0) return;
  let target: Unit | null = null;
  let bestD = REPAIR_TRUCK_SEEK;
  for (const v of s.units) {
    if (v === u || v.owner !== u.owner || v.hp <= 0 || !mendable(v) || v.hp >= maxHpOf(v)) continue;
    const d = dist(u.x, u.y, v.x, v.y);
    if (d < bestD) {
      bestD = d;
      target = v;
    }
  }
  // Close enough already: stay put and keep mending.
  if (target && bestD > REPAIR_TRUCK_RANGE * 0.6) u.order = { type: 'move', x: target.x, y: target.y };
}

/** The structure a deploying unit becomes, or null for a unit that does not deploy. */
export const deploysTo = (u: Unit): BuildingKind | null => UNITS[u.kind].deploysTo ?? null;

/** Where a Forward Base Truck's Field Yard would stand: the 2x2 footprint's top-left tile. */
export function deploySpot(u: Unit): { x: number; y: number } {
  return { x: Math.round(u.x) - 1, y: Math.round(u.y) - 1 };
}

/**
 * Why this side cannot deploy this unit now, or null if it can. Legal for the side's own Forward
 * Base Truck, idle or moving, where its Field Yard passes placementProblem with two exceptions: no
 * "near your base" rule, and the truck itself is not in the way.
 */
export function deployProblem(s: GameState, owner: Owner, id: number): string | null {
  const u = s.units.find(v => v.id === id);
  if (!u || u.owner !== owner || u.hp <= 0) return 'Not your unit';
  const kind = deploysTo(u);
  if (!kind) return 'Cannot deploy';
  if (u.order.type !== 'idle' && u.order.type !== 'move' && u.order.type !== 'attackMove') return 'Busy';
  const at = deploySpot(u);
  return placementProblem(s, owner, kind, at.x, at.y, undefined, { ignoreUnit: u.id, anywhere: true });
}

/** The truck goes and its Field Yard stands in its place at once, with the truck's share of health. */
export function doDeploy(s: GameState, owner: Owner, id: number): Building {
  const u = s.units.find(v => v.id === id)!;
  const kind = deploysTo(u)!;
  const at = deploySpot(u);
  const share = u.hp / maxHpOf(u);
  s.units = s.units.filter(v => v.id !== id);
  const b = addBuilding(s, owner, kind, at.x, at.y);
  b.hp = Math.max(1, Math.round(buildingSpec(s, owner, kind).hp * share));
  if (owner === 0) log(s, `${buildingSpec(s, owner, kind).name} deployed.`, 'good');
  return b;
}

/**
 * Why this side cannot pack up this structure now, or null if it can. Legal for the side's own
 * Field Yard (any structure with `undeploysTo`) unless it is the side's last structure (the battle
 * would end), or a structure is ready to place and no other producer of structures stands.
 */
export function undeployProblem(s: GameState, owner: Owner, id: number): string | null {
  const b = s.buildings.find(v => v.id === id);
  if (!b || b.owner !== owner || b.hp <= 0) return 'Not your structure';
  if (!BUILDINGS[b.kind].undeploysTo) return 'Cannot pack up';
  if (!s.buildings.some(o => o !== b && o.owner === owner && isStructure(o))) return 'Your last structure';
  if (readyStructure(s, owner)) {
    const rest = { ...s, buildings: s.buildings.filter(o => o !== b) };
    if (!producerFor(rest, owner, 'building')) return 'Place the ready structure first';
  }
  return null;
}

/** The structure goes and its truck stands at its centre, with the structure's share of health. */
export function doUndeploy(s: GameState, owner: Owner, id: number): Unit {
  const b = s.buildings.find(v => v.id === id)!;
  const spec = buildingSpecOf(s, b);
  const kind = spec.undeploysTo!;
  const share = b.hp / spec.hp;
  s.buildings = s.buildings.filter(v => v.id !== id);
  // The same ring and chime as a sale, which also tells the renderer to leave clean ground, not rubble.
  s.effects.push({ id: s.nextId++, kind: 'sold', x: b.x + spec.w / 2, y: b.y + spec.h / 2, at: s.tick, size: Math.max(spec.w, spec.h) });
  const u = addUnit(s, owner, kind, b.x + spec.w / 2, b.y + spec.h / 2);
  upgradeNewUnit(s, u);
  u.hp = Math.max(1, Math.round(maxHpOf(u) * share));
  if (owner === 0) log(s, `${spec.name} packed up.`);
  return u;
}
