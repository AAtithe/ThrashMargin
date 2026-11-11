import { canQueue, doMove, doQueue, placementProblem } from './commands';
import { deployProblem, deploySpot, doDeploy } from './engineering';
import { buildingCentre, dist, distToBuilding, occupancy, onMap, tileAt } from './grid';
import { BUILDINGS, UNITS, type BuildingKind, type Category, type Owner, type UnitKind } from './rules';
import { costFor, countBuildings, isStructure, setupOf, techAllowed, unlocked } from './state';
import { isEnemy } from './sides';
import type { AiMemory, Building, GameState, Unit } from './types';

/**
 * The computer commander's engineering vehicles (fireline-round5-design.md, workstream C). Called
 * once a decision from the commander in ai.ts, after airPlan, and only in a skirmish on advanced
 * tech (never in a mission, never on standard tech, where it returns at once).
 *
 *  - Repair Trucks, at any map size: one once it fields 6 ground vehicles (haulers count: they are
 *    mended too; the trucks do not), one per 8 after that, at most 3, saved for as the expansion is
 *    (below). They are unarmed, so they never count in a wave; like the Medics they keep with the
 *    wave's vehicles while it is out, and wait at the staging point otherwise.
 *  - Expansion, on large and huge maps only: with two refineries and no threat at home, a Forward
 *    Base Truck goes to an ore field at least EXPAND_FROM tiles from all its structures with no enemy
 *    within EXPAND_CLEAR tiles, deploys there, and the yard then gets a Refinery and a Gun Turret
 *    within its radius (placed through expansionSpot, which the commander asks before its own spot).
 *    One expansion at a time; after a failure the next waits EXPAND_RETRY ticks. The commander
 *    spends whatever it holds on units, so the expansion saves: at each decision half its credits go
 *    into a fund in its memory (`engineeringFund`) until the next purchase can be paid for.
 *    The expansion has the fund first: no Repair Truck is saved for while one is under way.
 */

interface Pt {
  x: number;
  y: number;
}

/** Ground vehicles fielded (not counting the trucks) before the first Repair Truck, then one more per this many. */
const TRUCK_FIRST = 6;
const TRUCK_PER = 8;
const TRUCK_MAX = 3;

/** An expansion's ore field is at least this far from every structure the side owns. */
const EXPAND_FROM = 24;
/** ...and no enemy unit or structure is within this many tiles of it. */
const EXPAND_CLEAR = 12;
/** Ticks before trying again after a failure (two minutes), and between looks for a field. */
const EXPAND_RETRY = 1200;
const EXPAND_LOOK = 300;
/** Longest a truck may wait in the queue, drive, or a yard wait for its structures, before giving up. */
const EXPAND_QUEUE_TICKS = 3000;
const EXPAND_DRIVE_TICKS = 3000;
const EXPAND_BUILD_TICKS = 6000;
/** Structures within this distance of the yard's footprint count as the expansion's. */
const EXPANSION_REACH = 8;
/** Share of its credits the computer sets aside at each decision while saving for the expansion. */
const FUND_SHARE = 0.5;

export function engineeringPlan(s: GameState, owner: Owner, home: Pt, enemyHome: Pt, units: Unit[], foes: Unit[]): void {
  if (s.mission || !techAllowed(s, owner, 'repairtruck')) return;
  repairTrucks(s, owner, home, enemyHome, units);
  if (setupOf(s).size !== 'standard' || s.ai[owner].expansion) expansion(s, owner, home, units, foes);
}

/** A point `by` tiles from a toward b. */
function toward(a: Pt, b: Pt, by: number): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: a.x + (dx / d) * by, y: a.y + (dy / d) * by };
}

function middle(list: Unit[]): Pt {
  let x = 0;
  let y = 0;
  for (const u of list) {
    x += u.x;
    y += u.y;
  }
  return { x: x / list.length, y: y / list.length };
}

function repairTrucks(s: GameState, owner: Owner, home: Pt, enemyHome: Pt, units: Unit[]): void {
  const p = s.players[owner];
  const trucks = units.filter(u => UNITS[u.kind].mender);
  const vehicles = units.filter(u => UNITS[u.kind].category === 'vehicle' && !UNITS[u.kind].mender && !UNITS[u.kind].deploysTo).length;
  const want = vehicles < TRUCK_FIRST ? 0 : Math.min(TRUCK_MAX, Math.max(1, Math.floor(vehicles / TRUCK_PER)));
  const queued = p.queues.vehicle.filter(q => q.kind === 'repairtruck').length;
  // Saved for like the expansion (which comes first: no truck while one is under way).
  const mem = s.ai[owner];
  if (!mem.expansion) {
    if (trucks.length + queued < want && unlocked(s, owner, 'repairtruck')) payFor(s, owner, 'vehicle', 'repairtruck');
    else if (mem.engineeringFund) {
      // No longer wanted (the vehicles it was for are gone): the savings go back.
      p.credits += mem.engineeringFund;
      mem.engineeringFund = 0;
    }
  }
  if (!trucks.length) return;
  // With the wave's vehicles while it is out; at the staging point otherwise.
  const alive = new Map(units.map(u => [u.id, u]));
  const waveVehicles =
    mem.wavePhase === 2
      ? mem.waveIds.map(id => alive.get(id)).filter((u): u is Unit => !!u && UNITS[u.kind].category === 'vehicle')
      : [];
  const meet = waveVehicles.length >= 2 ? middle(waveVehicles) : toward(home, enemyHome, 8);
  const near = waveVehicles.length >= 2 ? 3 : 6;
  const follow = trucks.filter(u => u.order.type === 'idle' && dist(u.x, u.y, meet.x, meet.y) > near).map(u => u.id);
  if (follow.length) doMove(s, owner, follow, meet.x, meet.y, false);
}

/** Ends the expansion under way, handing its fund back; the next is tried no sooner than `wait` ticks from now. */
function endExpansion(mem: AiMemory, s: GameState, wait: number, owner: Owner): void {
  mem.expansion = null;
  mem.expandAfter = s.tick + wait;
  s.players[owner].credits += mem.engineeringFund ?? 0;
  mem.engineeringFund = 0;
}

/**
 * Buys this for the engineering plan out of the fund and the credits when it can (true); otherwise sets
 * half the credits aside in the fund, never more than the price, and buys it at a later decision.
 */
function payFor(s: GameState, owner: Owner, category: Category, kind: BuildingKind | UnitKind): boolean {
  const mem = s.ai[owner];
  const p = s.players[owner];
  p.credits += mem.engineeringFund ?? 0;
  mem.engineeringFund = 0;
  if (canQueue(s, owner, category, kind)) {
    doQueue(s, owner, category, kind);
    return true;
  }
  const keep = Math.min(costFor(s, owner, kind), Math.floor(p.credits * FUND_SHARE));
  p.credits -= keep;
  mem.engineeringFund = keep;
  return false;
}

function expansion(s: GameState, owner: Owner, home: Pt, units: Unit[], foes: Unit[]): void {
  const mem = s.ai[owner];
  const p = s.players[owner];
  const ex = mem.expansion;
  if (!ex) {
    if (s.tick < (mem.expandAfter ?? 0)) return;
    if (countBuildings(s, owner, 'refinery') < 2) return;
    const threat = s.tick - mem.hurtTick < 40 || foes.some(f => UNITS[f.kind].weapon && dist(f.x, f.y, home.x, home.y) < 15);
    if (threat || !unlocked(s, owner, 'basetruck') || !techAllowed(s, owner, 'basetruck')) return;
    const spot = expansionField(s, owner, foes);
    if (!spot) {
      mem.expandAfter = s.tick + EXPAND_LOOK;
      return;
    }
    // Saving for the truck starts now; it is queued once paid for.
    mem.expansion = { truck: 0, x: spot.x, y: spot.y, since: s.tick };
    payFor(s, owner, 'vehicle', 'basetruck');
    return;
  }
  const e = { ...ex };
  mem.expansion = e;
  if (e.yard) {
    // Deployed: a Refinery, then a Gun Turret, within the yard's radius.
    const yard = s.buildings.find(b => b.id === e.yard && b.owner === owner);
    if (!yard) return endExpansion(mem, s, EXPAND_RETRY, owner);
    const want = expansionWants(s, owner, yard);
    if (!want) return endExpansion(mem, s, EXPAND_RETRY, owner);
    if (s.tick - e.since > EXPAND_BUILD_TICKS) return endExpansion(mem, s, EXPAND_RETRY, owner);
    if (p.queues.building.length === 0) payFor(s, owner, 'building', want);
    return;
  }
  if (!e.truck) {
    // Waiting for the truck to come out of the factory.
    const queued = p.queues.vehicle.some(q => q.kind === 'basetruck');
    // The newest truck on the map (an older one left over from a failed try will do as well).
    const out = units.filter(u => u.kind === 'basetruck').sort((a, b) => b.id - a.id)[0];
    if (out) {
      e.truck = out.id;
      e.since = s.tick;
      doMove(s, owner, [out.id], e.x + 1, e.y + 1, false);
      return;
    }
    if (s.tick - e.since > EXPAND_QUEUE_TICKS) return endExpansion(mem, s, EXPAND_RETRY, owner);
    // Not yet bought (saving), or bought and in the factory.
    if (!queued) payFor(s, owner, 'vehicle', 'basetruck');
    return;
  }
  const truck = units.find(u => u.id === e.truck);
  if (!truck || s.tick - e.since > EXPAND_DRIVE_TICKS) return endExpansion(mem, s, EXPAND_RETRY, owner);
  if (dist(truck.x, truck.y, e.x + 1, e.y + 1) > 3) {
    if (truck.order.type === 'idle') doMove(s, owner, [truck.id], e.x + 1, e.y + 1, false);
    return;
  }
  if (deployProblem(s, owner, truck.id) === null) {
    const yard = doDeploy(s, owner, truck.id);
    e.yard = yard.id;
    e.x = yard.x;
    e.y = yard.y;
    e.since = s.tick;
    return;
  }
  // Not quite on a clear spot: the nearest one round where it stands.
  if (truck.order.type !== 'idle') return;
  const at = deploySpot(truck);
  const alt = yardSpotNear(s, owner, at.x + 1, at.y + 1, 0, 4, truck.id);
  if (!alt) return endExpansion(mem, s, EXPAND_RETRY, owner);
  e.x = alt.x;
  e.y = alt.y;
  doMove(s, owner, [truck.id], alt.x + 1, alt.y + 1, false);
}

/** What the expansion round this yard still wants: a Refinery, then a Gun Turret, then nothing. */
function expansionWants(s: GameState, owner: Owner, yard: Building): BuildingKind | null {
  let refinery = false;
  let turret = false;
  for (const b of s.buildings) {
    if (b.owner !== owner || b === yard) continue;
    const c = buildingCentre(b);
    if (distToBuilding(c.x, c.y, yard) > EXPANSION_REACH) continue;
    if (b.kind === 'refinery') refinery = true;
    if (b.kind === 'turret') turret = true;
  }
  if (!refinery) return techAllowed(s, owner, 'refinery') ? 'refinery' : null;
  if (!turret) return techAllowed(s, owner, 'turret') ? 'turret' : null;
  return null;
}

/**
 * Where the commander places a finished structure that its expansion wants, within the Field Yard's
 * radius; null for anything else (the commander then finds its own spot near home).
 */
export function expansionSpot(s: GameState, owner: Owner, kind: BuildingKind, enemyHome: Pt): Pt | null {
  const e = s.ai[owner]?.expansion;
  if (!e || !e.yard) return null;
  const yard = s.buildings.find(b => b.id === e.yard && b.owner === owner);
  if (!yard || expansionWants(s, owner, yard) !== kind) return null;
  const spec = BUILDINGS[kind];
  const c = buildingCentre(yard);
  // The Refinery towards the nearest ore, the turret towards the enemy.
  let focus = toward(c, enemyHome, 3);
  if (kind === 'refinery') {
    const ore = nearestOre(s, c.x, c.y, 10);
    if (ore) focus = toward(c, ore, 2.5);
  }
  const occ = occupancy(s);
  const r = (BUILDINGS[yard.kind].buildRadius ?? 4) + 1;
  const cands: [number, number, number][] = [];
  for (let y = yard.y - r - spec.h; y <= yard.y + r + 2; y++)
    for (let x = yard.x - r - spec.w; x <= yard.x + r + 2; x++) {
      if (!onMap(s, x, y)) continue;
      cands.push([x, y, (x + spec.w / 2 - focus.x) ** 2 + (y + spec.h / 2 - focus.y) ** 2]);
    }
  cands.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  let fallback: Pt | null = null;
  for (const [x, y] of cands) {
    if (placementProblem(s, owner, kind, x, y, occ)) continue;
    // Prefer a spot with a free ring round it, so nothing is walled in.
    let clear = true;
    for (let ty = y - 1; ty <= y + spec.h && clear; ty++)
      for (let tx = x - 1; tx <= x + spec.w; tx++) if (onMap(s, tx, ty) && occ[tileAt(s, tx, ty)]) clear = false;
    if (clear) return { x, y };
    fallback ??= { x, y };
  }
  return fallback;
}

function nearestOre(s: GameState, x: number, y: number, within: number): Pt | null {
  let best: Pt | null = null;
  let bestD = within;
  const x0 = Math.max(0, Math.floor(x - within));
  const x1 = Math.min(s.mapW - 1, Math.ceil(x + within));
  const y0 = Math.max(0, Math.floor(y - within));
  const y1 = Math.min(s.mapH - 1, Math.ceil(y + within));
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) {
      if (s.ore[tileAt(s, tx, ty)] <= 0) continue;
      const d = dist(x, y, tx + 0.5, ty + 0.5);
      if (d < bestD) {
        bestD = d;
        best = { x: tx + 0.5, y: ty + 0.5 };
      }
    }
  return best;
}

/**
 * The nearest ore field to home that is at least EXPAND_FROM tiles from all this side's structures,
 * with no enemy unit or structure within EXPAND_CLEAR, and a Field Yard spot beside it: the yard's
 * top-left tile, or null.
 */
function expansionField(s: GameState, owner: Owner, foes: Unit[]): Pt | null {
  const mine = s.buildings.filter(b => b.owner === owner && isStructure(b));
  const theirs = s.buildings.filter(b => isEnemy(s, owner, b.owner));
  if (!mine.length) return null;
  const anchor = buildingCentre(mine.find(b => b.kind === 'hq') ?? mine[0]);
  const fields: [number, number, number][] = [];
  for (let k = 0; k < s.ore.length; k++) {
    if (s.ore[k] <= 0) continue;
    const x = (k % s.mapW) + 0.5;
    const y = ((k / s.mapW) | 0) + 0.5;
    if (mine.some(b => distToBuilding(x, y, b) < EXPAND_FROM)) continue;
    if (theirs.some(b => distToBuilding(x, y, b) < EXPAND_CLEAR)) continue;
    if (foes.some(f => dist(f.x, f.y, x, y) < EXPAND_CLEAR)) continue;
    fields.push([x, y, dist(x, y, anchor.x, anchor.y)]);
  }
  fields.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  // A few of the nearest fields, in case the first has no room beside it.
  for (const [x, y] of fields.slice(0, 8)) {
    const spot = yardSpotNear(s, owner, x, y, 2, 7);
    if (spot) return spot;
  }
  return null;
}

/**
 * The nearest top-left tile, between `from` and `to` tiles (Chebyshev) of (x, y), where a Field Yard
 * could be deployed, with a free ring round it so a Refinery fits beside it. `ignore`: the truck.
 */
function yardSpotNear(s: GameState, owner: Owner, x: number, y: number, from: number, to: number, ignore?: number): Pt | null {
  const spec = BUILDINGS.fieldyard;
  const occ = occupancy(s);
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const cands: [number, number, number][] = [];
  for (let dy = -to; dy <= to; dy++)
    for (let dx = -to; dx <= to; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < from) continue;
      const fx = cx + dx - 1;
      const fy = cy + dy - 1;
      cands.push([fx, fy, dx * dx + dy * dy]);
    }
  cands.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  for (const [fx, fy] of cands) {
    if (placementProblem(s, owner, 'fieldyard', fx, fy, occ, { anywhere: true, ignoreUnit: ignore })) continue;
    let clear = true;
    for (let ty = fy - 1; ty <= fy + spec.h && clear; ty++)
      for (let tx = fx - 1; tx <= fx + spec.w; tx++) {
        if (!onMap(s, tx, ty) || occ[tileAt(s, tx, ty)]) {
          clear = false;
          break;
        }
      }
    if (clear) return { x: fx, y: fy };
  }
  return null;
}
