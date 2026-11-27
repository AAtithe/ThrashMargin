/**
 * Advanced production (2026-11-22, `setup.production` with territory, supply lines and industry;
 * phase 4 of the economy, fireline-design.md). Pure, like the rest of src/sim/.
 *
 * - Food. A Farm grows a food every FARM_TICKS. Every FOOD_TICKS each Quarters, lowest id first,
 *   eats QUARTERS_FOOD; one that cannot is hungry until its next meal and houses half its workers
 *   (territory.ts reads `hungry`). Yards feed their own.
 * - Munitions. A Munitions Works turns alloys and fuel into munitions. The heavy guns
 *   (MUNITION_UNITS) spend one a shot and hold fire without; aircraft spend one a load and take
 *   twice as long without.
 * - The Supply Truck. Idle, it drives to the cut-off Refinery or Fuel Well holding the most, loads
 *   what it can carry, and takes it to the nearest linked yard or Depot, where it goes into store.
 *   Any order the player gives takes it over; idle again, it carries on.
 *
 * A structure without its crew (territory.ts) does nothing, as everywhere.
 */
import { doMove } from './commands';
import { distToBuilding, nearestPassable, occupancy } from './grid';
import {
  BUILDINGS,
  FARM_TICKS,
  FOOD_STORE_BASE,
  FOOD_STORE_PER_FARM,
  FOOD_TICKS,
  MUNITION_UNITS,
  MUNITIONS_ALLOYS,
  MUNITIONS_FUEL,
  MUNITIONS_MADE,
  MUNITIONS_STORE_BASE,
  MUNITIONS_STORE_PER_WORKS,
  MUNITIONS_TICKS,
  QUARTERS_FOOD,
  START_FOOD,
  START_MUNITIONS,
  TRUCK_CREDITS,
  TRUCK_FUEL,
  TRUCK_MIN,
  TRUCK_REACH,
  type BuildingKind,
  type Owner,
} from './rules';
import { centreOf, cutOff, linkedHubs } from './supply';
import { staffed, territoryOn } from './territory';
import { PROJECTS, SHELL_CASTING_MADE, type ProjectId } from './rules';
import type { Building, GameState, Unit } from './types';

/** True in a skirmish with every economy toggle on and advanced production too. */
export const productionOn = (s: GameState): boolean => territoryOn(s) && s.setup?.production === true;

/** The structures that exist only with advanced production on. */
export const PRODUCTION_BUILDINGS: BuildingKind[] = ['farm', 'munitions'];

const countOwn = (s: GameState, owner: Owner, kind: BuildingKind): number => {
  let n = 0;
  for (const b of s.buildings) if (b.owner === owner && b.kind === kind && b.hp > 0) n++;
  return n;
};
export const foodStore = (s: GameState, owner: Owner): number => FOOD_STORE_BASE + FOOD_STORE_PER_FARM * countOwn(s, owner, 'farm');
export const munitionsStore = (s: GameState, owner: Owner): number => MUNITIONS_STORE_BASE + MUNITIONS_STORE_PER_WORKS * countOwn(s, owner, 'munitions');

/** Every side's opening food and munitions: called once, as a battle with advanced production is created. */
export function startProduction(s: GameState): void {
  if (!productionOn(s)) return;
  for (const p of s.players) {
    p.food = START_FOOD;
    p.munitions = START_MUNITIONS;
  }
}

/** One tick: Farms grow, Works make munitions, and Quarters eat on their meal tick. `idle` holds structures without a crew. */
export function productionStep(s: GameState, low: ArrayLike<boolean>, idle: ReadonlySet<number>): void {
  if (!productionOn(s)) return;
  for (const b of s.buildings) {
    if (b.hp <= 0 || idle.has(b.id) || (b.kind !== 'farm' && b.kind !== 'munitions')) continue;
    const p = s.players[b.owner];
    if (!p) continue;
    const beat = (b.kind === 'farm' ? FARM_TICKS : MUNITIONS_TICKS) * (low[b.owner] && b.kind === 'munitions' ? 2 : 1);
    if ((s.tick + b.id) % beat !== 0) continue;
    if (b.kind === 'farm') {
      if ((p.food ?? 0) < foodStore(s, b.owner)) p.food = (p.food ?? 0) + 1;
    } else {
      if ((p.alloys ?? 0) < MUNITIONS_ALLOYS || (p.fuel ?? 0) < MUNITIONS_FUEL) continue;
      if ((p.munitions ?? 0) + MUNITIONS_MADE > munitionsStore(s, b.owner)) continue;
      p.alloys = (p.alloys ?? 0) - MUNITIONS_ALLOYS;
      p.fuel = (p.fuel ?? 0) - MUNITIONS_FUEL;
      p.munitions = (p.munitions ?? 0) + (hasProject(s, b.owner, 'shellcasting') ? SHELL_CASTING_MADE : MUNITIONS_MADE);
    }
  }
  // Industry projects: a crewed Training Centre works the one under way, half as fast short of power.
  for (const p of s.players) {
    const pr = p.project;
    if (!pr) continue;
    const centre = s.buildings.some(b => b.owner === p.owner && b.kind === 'trainingcentre' && b.hp > 0 && !idle.has(b.id));
    if (!centre) continue;
    pr.progress = Math.min(PROJECTS[pr.id].ticks, pr.progress + (low[p.owner] ? 0.5 : 1));
    if (pr.progress >= PROJECTS[pr.id].ticks) {
      p.projects = [...(p.projects ?? []), pr.id];
      p.project = null;
    }
  }
  if (s.tick % FOOD_TICKS === 0) {
    const quarters = s.buildings.filter(b => b.kind === 'quarters' && b.hp > 0).sort((a, b) => a.id - b.id);
    for (const q of quarters) {
      const p = s.players[q.owner];
      if (!p) continue;
      if ((p.food ?? 0) >= QUARTERS_FOOD) {
        p.food = (p.food ?? 0) - QUARTERS_FOOD;
        if (q.hungry) delete q.hungry;
      } else q.hungry = true;
    }
  }
}

/** A heavy gun's shot: spends a munition with advanced production on. False when there is none (it holds fire). */
export function spendMunition(s: GameState, u: Unit): boolean {
  if (!productionOn(s) || !MUNITION_UNITS.includes(u.kind)) return true;
  const p = s.players[u.owner];
  if (!p || (p.munitions ?? 0) < 1) return false;
  p.munitions = (p.munitions ?? 0) - 1;
  return true;
}

/** An aircraft's load: spends a munition with advanced production on. False when there is none (the load takes twice as long). */
export function loadMunition(s: GameState, owner: Owner): boolean {
  if (!productionOn(s)) return true;
  const p = s.players[owner];
  if (!p || (p.munitions ?? 0) < 1) return false;
  p.munitions = (p.munitions ?? 0) - 1;
  return true;
}

/** Where a truck should drive to reach a structure: open ground beside it. */
function approach(s: GameState, occ: Int32Array, b: Building): { x: number; y: number } {
  const spec = BUILDINGS[b.kind];
  const k = nearestPassable(s, occ, b.x + spec.w / 2, b.y + spec.h + 0.5);
  return k < 0 ? centreOf(b) : { x: (k % s.mapW) + 0.5, y: ((k / s.mapW) | 0) + 0.5 };
}

/** Sends a truck somewhere on its errand, remembering where, so another order can be told apart. */
function send(s: GameState, u: Unit, to: { x: number; y: number }): void {
  doMove(s, u.owner, [u.id], to.x, to.y, false);
  if (u.truck) {
    u.truck.x = to.x;
    u.truck.y = to.y;
  }
}

/** Every Supply Truck's errand, one step. */
export function truckStep(s: GameState): void {
  if (!productionOn(s) || s.tick % 5 !== 0) return;
  let occ: Int32Array | null = null;
  const byId = new Map(s.buildings.map(b => [b.id, b]));
  for (const u of s.units) {
    if (u.kind !== 'supplytruck' || u.hp <= 0) continue;
    const t = u.truck;
    // Another order than its own: the player has it. Its load stays aboard.
    if (t && u.order.type !== 'idle' && !(u.order.type === 'move' && Math.abs(u.order.x - t.x) < 1 && Math.abs(u.order.y - t.y) < 1)) {
      if (!t.credits && !t.fuel) delete u.truck;
      else t.site = t.hub = 0;
      continue;
    }
    if (u.order.type !== 'idle' && !t) continue;
    occ ??= occupancy(s);
    const loaded = !!t && (t.credits > 0 || t.fuel > 0);
    // Loaded: to the nearest linked hub, and unload there.
    if (loaded) {
      const hubs = linkedHubs(s, u.owner);
      let hub = t!.hub ? byId.get(t!.hub) : undefined;
      if (!hub || hub.hp <= 0 || !hubs.some(h => h.id === hub!.id)) {
        hub = hubs.slice().sort((a, b) => distToBuilding(u.x, u.y, a) - distToBuilding(u.x, u.y, b) || a.id - b.id)[0];
        if (!hub) continue;
        t!.hub = hub.id;
        send(s, u, approach(s, occ, hub));
        continue;
      }
      if (distToBuilding(u.x, u.y, hub) <= TRUCK_REACH) {
        const p = s.players[u.owner];
        p.credits += t!.credits;
        p.fuel = (p.fuel ?? 0) + t!.fuel;
        delete u.truck;
        u.order = { type: 'idle' };
      } else if (u.order.type === 'idle') send(s, u, approach(s, occ, hub));
      continue;
    }
    // Empty: to the cut-off site holding the most, and load.
    let site = t?.site ? byId.get(t.site) : undefined;
    const cut = cutOff(s, u.owner).filter(b => (b.held ?? 0) >= TRUCK_MIN && (b.kind === 'refinery' || b.kind === 'fuelwell'));
    if (!site || site.hp <= 0 || !cut.some(b => b.id === site!.id)) {
      // The site that pays most: credits held count as they are, fuel at ten credits each.
      site = cut.sort((a, b) => value(b) - value(a) || a.id - b.id)[0];
      if (!site) {
        if (t) delete u.truck;
        continue;
      }
      u.truck = { site: site.id, hub: 0, credits: 0, fuel: 0, x: 0, y: 0 };
      send(s, u, approach(s, occ, site));
      continue;
    }
    if (distToBuilding(u.x, u.y, site) <= TRUCK_REACH) {
      const take = Math.min(site.held ?? 0, site.kind === 'refinery' ? TRUCK_CREDITS : TRUCK_FUEL);
      if (site.kind === 'refinery') u.truck!.credits += take;
      else u.truck!.fuel += take;
      site.held = (site.held ?? 0) - take;
      if (site.held <= 0) delete site.held;
      u.truck!.site = 0;
      u.order = { type: 'idle' };
    } else if (u.order.type === 'idle') send(s, u, approach(s, occ, site));
  }
}

const value = (b: Building): number => (b.held ?? 0) * (b.kind === 'fuelwell' ? 10 : 1);

// ---------------------------------------------------------------------------------------------
// Industry projects (2026-11-22, phase 4b): run at a Training Centre, one at a time, paid up front.

/** True once this side has finished the project (advanced production only). */
export const hasProject = (s: GameState, owner: Owner, id: ProjectId): boolean => productionOn(s) && !!s.players[owner]?.projects?.includes(id);

/** Why this side may not start this project now, or null. */
export function projectProblem(s: GameState, owner: Owner, id: ProjectId): string | null {
  if (!productionOn(s) || !(id in PROJECTS)) return 'Not available';
  const p = s.players[owner];
  if (p.projects?.includes(id)) return 'Already done';
  if (p.project) return 'A project is under way';
  if (!s.buildings.some(b => b.owner === owner && b.kind === 'trainingcentre' && b.hp > 0)) return 'Needs a Training Centre';
  if (p.credits < PROJECTS[id].cost) return 'Not enough credits';
  return null;
}

export function doProject(s: GameState, owner: Owner, id: ProjectId): void {
  const p = s.players[owner];
  p.credits -= PROJECTS[id].cost;
  p.project = { id, progress: 0 };
}

/** Stops the project under way and refunds it in full. */
export function cancelProject(s: GameState, owner: Owner): boolean {
  const p = s.players[owner];
  if (!p.project) return false;
  p.credits += PROJECTS[p.project.id].cost;
  p.project = null;
  return true;
}

/** True when a crewed Research Lab stands (research pauses without one under advanced production). */
export function labWorking(s: GameState, owner: Owner): boolean {
  if (!productionOn(s)) return true;
  return s.buildings.some(b => b.owner === owner && b.kind === 'researchlab' && b.hp > 0 && staffed(s, b));
}
