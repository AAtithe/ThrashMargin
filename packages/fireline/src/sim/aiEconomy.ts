/**
 * The computer's industry (2026-11-21, `setup.industry`; industry.ts). Without industry nothing
 * here does anything, so the commander plays exactly as before.
 *
 * - Its structure plan gains a Fuel Well and a Foundry right after its first War Factory, at every
 *   level, so alloys are coming in by the time the factory has used the opening stock.
 * - A Fuel Well goes beside the ore field nearest home that holds enough in reach.
 * - A Fuel Well that has drained its field is sold, and the plan puts a new one by another field.
 * - Supply lines: a cut-off producer gets a Depot to reconnect it, before anything else is built.
 */
import { canQueue, doQueue, doSell, placementProblem } from './commands';
import { doProject, productionOn, projectProblem } from './production';
import { FARM_TICKS, FOOD_TICKS, PROJECTS, QUARTERS_FOOD, type ProjectId } from './rules';
import { upkeepDue, upkeepOn } from './upkeep';
import { dist, occupancy } from './grid';
import { centreOf, cutOff, linkedHubs, supplyOn } from './supply';
import { NO_OWNER, territoryGrid, territoryOn } from './territory';
import { industryOn, wellDry } from './industry';
import { isStructure } from './state';
import { MUNITION_UNITS, UNITS, type UnitKind, CLAIM_RADIUS, FUEL_WELL_MIN_ORE, FUEL_WELL_REACH, SUPPLY_LINK_RANGE, SUPPLY_SERVE_RANGE, type BuildingKind, type Owner } from './rules';
import type { GameState } from './types';

type Pt = { x: number; y: number };

/** wellFocus: ore in reach worth one tile of distance from home. */
const WELL_ORE_PER_TILE = 400;
/** wellFocus: how far from one of its own structures a side looks for a field (the build radius and a well's reach). */
const WELL_SEARCH = 7;

/** The industry entries of the structure plan, after the first War Factory. None without industry. */
export function industryPlanFor(s: GameState, owner: Owner): [BuildingKind, number][] {
  if (!industryOn(s)) return [];
  // No well wanted while no field near its structures is rich enough to feed one: queueing one it
  // could never place held up every structure behind it.
  const wells = s.buildings.some(b => b.owner === owner && b.kind === 'fuelwell');
  const anchor = s.buildings.find(b => b.owner === owner && b.kind === 'hq') ?? s.buildings.find(b => b.owner === owner && isStructure(b));
  const home = anchor ? { x: anchor.x + 1.5, y: anchor.y + 1.5 } : null;
  const wellWanted = wells || (!!home && wellFocus(s, owner, home) !== null);
  // Supply lines and territory: no field it may use, so push its lines toward the nearest rich one,
  // a Watchtower where the field is outside its borders, a Depot where it is outside its supply.
  // Without this, a commander whose home field ran out never had fuel again (fireline-design.md).
  if (!wellWanted && home) {
    const step = expansionStep(s, owner, home);
    if (step) return [[step, countOwn(s, owner, step) + 1], ...centreFirst(s), ['foundry', 1], ...productionPlanFor(s, owner)];
  }
  // One of each at every level. Hard once built two of each: the second well drained the field its
  // haulers lived on and the second Foundry turned its income into stock, and in seat 0, without the
  // computer seat's income bonus, it won 15% against Normal (fireline-design.md, 2026-11-21).
  // Army upkeep: the machines burn fuel every minute, so a Fuel Well per FUEL_MACHINES_PER_WELL of
  // them beyond the first (whose fuel goes to the Foundry), where a field in reach will feed one.
  let wellCount = wellWanted ? 1 : 0;
  if (upkeepOn(s) && wellWanted && home) {
    const want = Math.min(MAX_WELLS_UPKEEP, 1 + Math.ceil(upkeepDue(s, owner).machines / FUEL_MACHINES_PER_WELL));
    const have = countOwn(s, owner, 'fuelwell');
    wellCount = want > have && wellFocus(s, owner, home) === null ? Math.max(1, have) : want;
  }
  return [
    // Advanced production: soldiers eat, so a Farm before anything else in the chain.
    ...(productionOn(s) ? ([['farm', 1]] as [BuildingKind, number][]) : []),
    ['fuelwell', wellCount],
    // Advanced production: the Training Centre first, since the Foundry needs a Technician.
    ...centreFirst(s),
    ['foundry', 1],
    // Advanced production (2026-11-22): Farms for its Quarters and a Munitions Works. None without it.
    ...productionPlanFor(s, owner),
  ];
}

/**
 * Where to look for a Fuel Well's spot: among ore tiles within WELL_SEARCH tiles of one of this
 * side's own structures (where it may build), the one with the most ore in a well's reach, less a
 * little for distance from home. Null when no field in reach is rich enough.
 */
export function wellFocus(s: GameState, owner: Owner, home: Pt): Pt | null {
  const own = s.buildings.filter(b => b.owner === owner && isStructure(b));
  // Supply lines: only fields a well could stand by and still be supplied.
  const hubs = supplyOn(s) ? linkedHubs(s, owner).map(centreOf) : null;
  // Territory: only fields inside its borders.
  const grid = territoryOn(s) ? territoryGrid(s) : null;
  let best: Pt | null = null;
  let bestScore = -Infinity;
  const r = FUEL_WELL_REACH;
  for (let k = 0; k < s.ore.length; k++) {
    if (s.ore[k] <= 0) continue;
    const x = k % s.mapW;
    const y = (k / s.mapW) | 0;
    if (!own.some(b => Math.abs(b.x + 1 - x) <= WELL_SEARCH && Math.abs(b.y + 1 - y) <= WELL_SEARCH)) continue;
    if (hubs && !hubs.some(h => (h.x - x - 0.5) ** 2 + (h.y - y - 0.5) ** 2 <= (SUPPLY_SERVE_RANGE + 1) ** 2)) continue;
    if (grid && grid[k] !== owner) continue;
    let n = 0;
    for (let ty = Math.max(0, y - r); ty <= Math.min(s.mapH - 1, y + r); ty++)
      for (let tx = Math.max(0, x - r); tx <= Math.min(s.mapW - 1, x + r); tx++) n += s.ore[tx + ty * s.mapW];
    if (n < FUEL_WELL_MIN_ORE * 2) continue;
    const score = n / WELL_ORE_PER_TILE - dist(home.x, home.y, x + 0.5, y + 0.5);
    if (score <= bestScore) continue;
    bestScore = score;
    best = { x: x + 0.5, y: y + 0.5 };
  }
  return best;
}

/** Every decision: sells a Fuel Well with no ore left in reach, so the plan can put one elsewhere. */
export function economyPlan(s: GameState, owner: Owner): void {
  if (!industryOn(s)) return;
  const dry = s.buildings.find(b => b.owner === owner && b.kind === 'fuelwell' && wellDry(s, b));
  if (dry) doSell(s, owner, dry.id);
  // Advanced production: a Supply Truck once a cut-off site holds goods worth fetching and none is out.
  if (productionOn(s)) {
    const stranded = cutOff(s, owner).reduce((a, b) => a + (b.held ?? 0) * (b.kind === 'fuelwell' ? 10 : 1), 0);
    const trucks = s.units.filter(u => u.owner === owner && u.kind === 'supplytruck').length + s.players[owner].queues.vehicle.filter(q => q.kind === 'supplytruck').length;
    if (stranded >= TRUCK_WORTH && trucks === 0 && canQueue(s, owner, 'vehicle', 'supplytruck')) doQueue(s, owner, 'vehicle', 'supplytruck');
    projectPlan(s, owner);
  }
}

/**
 * Advanced production: nothing ahead of the Foundry now (it needs no Technician). The Training
 * Centre comes when something it serves is wanted (productionPlanFor).
 */
const centreFirst = (_s: GameState): [BuildingKind, number][] => [];

/** Stranded goods (in credits) that make a Supply Truck worth its price. */
const TRUCK_WORTH = 700;

/** Farms for its Quarters (one feeds three) and one Munitions Works. Nothing without advanced production. */
function productionPlanFor(s: GameState, owner: Owner): [BuildingKind, number][] {
  if (!productionOn(s)) return [];
  const quarters = countOwn(s, owner, 'quarters');
  // A Munitions Works only once something fires munitions: one built ahead of any heavy gun or
  // aircraft sat full all battle, a Works and its crew for nothing (fireline-design.md).
  const users =
    s.units.some(u => u.owner === owner && (MUNITION_UNITS.includes(u.kind) || UNITS[u.kind].category === 'air')) ||
    (['vehicle', 'naval', 'air'] as const).some(c => s.players[owner].queues[c]?.some(q => MUNITION_UNITS.includes(q.kind as UnitKind) || c === 'air'));
  // Farms: one for the Barracks (soldiers eat 2 each), and one more per three Quarters; another
  // whenever the store runs low.
  const food = s.players[owner].food ?? 0;
  const standing = countOwn(s, owner, 'farm');
  let farms = Math.min(MAX_FARMS, Math.max(1, Math.ceil(quarters / 3), food < FOOD_LOW ? standing + 1 : 0));
  // Army upkeep (2026-11-27, upkeep.ts): the soldiers eat every minute too, so Farms for the army as
  // well as the Quarters, with a little to spare, and one more while it goes short.
  if (upkeepOn(s)) {
    const eaten = quarters * (TICKS_A_MINUTE / FOOD_TICKS) * QUARTERS_FOOD + upkeepDue(s, owner).food;
    const grown = TICKS_A_MINUTE / FARM_TICKS;
    const short = (s.players[owner].upkeepShort?.food ?? 0) > 0 ? 1 : 0;
    farms = Math.min(MAX_FARMS_UPKEEP, Math.max(farms, Math.ceil((eaten * UPKEEP_MARGIN) / grown) + short));
  }
  // A Training Centre once something needing Technicians is wanted or stands (Munitions Works,
  // Helipad, Research Lab), or once the commander is ready for Industry projects.
  const techWanted = users || s.buildings.some(b => b.owner === owner && (b.kind === 'helipad' || b.kind === 'researchlab')) || s.tick >= PROJECT_FROM;
  return [
    ['farm', farms],
    ['trainingcentre', techWanted ? 1 : 0],
    ['munitions', users ? 1 : 0],
  ];
}

/** Industry projects in the order the computer takes them, and the credits it keeps back first. */
const PROJECT_PLAN: ProjectId[] = ['prefab', 'deepwells', 'blastfurnace', 'mechanised', 'shellcasting', 'relays'];
const PROJECT_RESERVE = 2500;
/** The computer takes on Industry projects from this tick (minute 15): its army comes first. */
const PROJECT_FROM = 9000;
/** Food below which the computer builds its first Farm even with one Quarters. */
const FOOD_LOW = 15;
/** Most Farms the computer builds. */
const MAX_FARMS = 4;
/** Army upkeep (upkeep.ts): Farms enough for the army's meals too, up to this many. */
const MAX_FARMS_UPKEEP = 10;
/** Army upkeep: Farms for this many times what is eaten, so a growing army does not go short. */
const UPKEEP_MARGIN = 1.2;
/** Army upkeep: one more Fuel Well per this many armed machines (at 2 fuel a minute each), up to MAX_WELLS_UPKEEP. */
const FUEL_MACHINES_PER_WELL = 15;
const MAX_WELLS_UPKEEP = 4;
const TICKS_A_MINUTE = 600;

/** Advanced production: the next Industry project once it can spare the credits. */
function projectPlan(s: GameState, owner: Owner): void {
  const p = s.players[owner];
  if (p.project || p.credits < PROJECT_RESERVE || s.tick < PROJECT_FROM) return;
  const next = PROJECT_PLAN.find(id => !p.projects?.includes(id));
  if (next && p.credits >= PROJECTS[next].cost + PROJECT_RESERVE && projectProblem(s, owner, next) === null) doProject(s, owner, next);
}

// ---------------------------------------------------------------------------------------------
// Supply lines (2026-11-21, setup.supply; supply.ts). Without them depotSpot is always null.

/** Most Depots the computer keeps: enough for a chain to a far field, never a sprawl. */
const MAX_DEPOTS = 6;

/**
 * Where a Depot would reconnect this side's first cut-off producer: a legal spot linked to a hub
 * already linked, serving the producer, nearest it. When no single Depot can reach, the linked spot
 * nearest the producer, one step along the chain. Null when nothing is cut off, at the cap, or no
 * spot exists.
 */
export function depotSpot(s: GameState, owner: Owner): Pt | null {
  if (!supplyOn(s)) return null;
  const cut = cutOff(s, owner);
  if (!cut.length || s.buildings.filter(b => b.owner === owner && b.kind === 'depot').length >= MAX_DEPOTS) return null;
  const hubs = linkedHubs(s, owner);
  if (!hubs.length) return null;
  const occ = occupancy(s);
  const hubCentres = hubs.map(centreOf);
  const linkedAt = (c: Pt) => hubCentres.some(h => (h.x - c.x) ** 2 + (h.y - c.y) ** 2 <= (SUPPLY_LINK_RANGE - 0.5) ** 2);
  for (const target of cut) {
    const tc = centreOf(target);
    let best: Pt | null = null;
    let bestD = Infinity;
    let step: Pt | null = null;
    let stepD = Infinity;
    const r = SUPPLY_LINK_RANGE + SUPPLY_SERVE_RANGE;
    for (let y = Math.max(0, Math.floor(tc.y - r)); y <= Math.min(s.mapH - 2, Math.ceil(tc.y + r)); y++)
      for (let x = Math.max(0, Math.floor(tc.x - r)); x <= Math.min(s.mapW - 2, Math.ceil(tc.x + r)); x++) {
        const c = { x: x + 1, y: y + 1 };
        const d = dist(c.x, c.y, tc.x, tc.y);
        if (d >= stepD && d >= bestD) continue;
        if (!linkedAt(c)) continue;
        if (placementProblem(s, owner, 'depot', x, y, occ)) continue;
        if (d <= SUPPLY_SERVE_RANGE - 0.5) {
          if (d < bestD) {
            bestD = d;
            best = { x, y };
          }
        } else if (d < stepD) {
          stepD = d;
          step = { x, y };
        }
      }
    if (best) return best;
    if (step) return step;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Territory and workforce (2026-11-21, setup.territory; territory.ts).

/** Most Quarters the computer builds. */
export const MAX_QUARTERS = 8;

/** The ore tile nearest home that lies outside this side's borders (where a Watchtower should push), or null. */
export function unclaimedOre(s: GameState, owner: Owner, home: Pt): Pt | null {
  if (!territoryOn(s)) return null;
  const grid = territoryGrid(s);
  let best: Pt | null = null;
  let bestD = Infinity;
  for (let k = 0; k < s.ore.length; k++) {
    if (s.ore[k] <= 0 || grid[k] === owner || (grid[k] !== NO_OWNER && grid[k] !== owner)) continue;
    const x = (k % s.mapW) + 0.5;
    const y = ((k / s.mapW) | 0) + 0.5;
    const d = dist(home.x, home.y, x, y);
    if (d < bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Pushing out toward a field (supply lines and territory).

/** Most Watchtowers the computer builds, and how far from home it looks for a field to push toward. */
const MAX_TOWERS = 3;
const MAX_EXPANSION_DEPOTS = 3;
const EXPAND_REACH = 40;
/** A field more than this far beyond its own nearest claim or hub is too far to push toward in one step. */
const EXPAND_STEP = 10;

const countOwn = (s: GameState, owner: Owner, kind: BuildingKind): number => s.buildings.filter(b => b.owner === owner && b.kind === kind).length;

/**
 * The nearest field to home rich enough for a well (twice FUEL_WELL_MIN_ORE within a well's reach),
 * within EXPAND_REACH and not inside another side's borders. Null when there is none.
 */
export function expansionTarget(s: GameState, owner: Owner, home: Pt): Pt | null {
  if (!supplyOn(s)) return null;
  const grid = territoryOn(s) ? territoryGrid(s) : null;
  const r = FUEL_WELL_REACH;
  let best: Pt | null = null;
  let bestD = Infinity;
  for (let k = 0; k < s.ore.length; k++) {
    if (s.ore[k] <= 0) continue;
    if (grid && grid[k] !== owner && grid[k] !== NO_OWNER) continue;
    const x = k % s.mapW;
    const y = (k / s.mapW) | 0;
    const d = dist(home.x, home.y, x + 0.5, y + 0.5);
    if (d >= bestD || d > EXPAND_REACH) continue;
    let n = 0;
    for (let ty = Math.max(0, y - r); ty <= Math.min(s.mapH - 1, y + r); ty++)
      for (let tx = Math.max(0, x - r); tx <= Math.min(s.mapW - 1, x + r); tx++) n += s.ore[tx + ty * s.mapW];
    if (n < FUEL_WELL_MIN_ORE * 2) continue;
    bestD = d;
    best = { x: x + 0.5, y: y + 0.5 };
  }
  return best;
}

/** What to build next to reach the expansion target: a Watchtower, a Depot, or null (nothing to do, or at the cap). */
export function expansionStep(s: GameState, owner: Owner, home: Pt): 'watchtower' | 'depot' | null {
  const target = expansionTarget(s, owner, home);
  if (!target) return null;
  const k = Math.floor(target.x) + Math.floor(target.y) * s.mapW;
  const hubs = linkedHubs(s, owner).map(centreOf);
  if (territoryOn(s) && territoryGrid(s)[k] !== owner) {
    // One step only: the field must lie within a Watchtower's claim of ground it can already build on.
    const claims = s.buildings.filter(b => b.owner === owner && b.hp > 0 && CLAIM_RADIUS[b.kind]).map(b => ({ c: centreOf(b), r: CLAIM_RADIUS[b.kind]! }));
    if (!claims.some(({ c, r }) => dist(c.x, c.y, target.x, target.y) <= r + EXPAND_STEP)) return null;
    return countOwn(s, owner, 'watchtower') < MAX_TOWERS ? 'watchtower' : null;
  }
  if (!hubs.some(h => (h.x - target.x) ** 2 + (h.y - target.y) ** 2 <= (SUPPLY_SERVE_RANGE + 1) ** 2)) {
    if (!hubs.some(h => dist(h.x, h.y, target.x, target.y) <= SUPPLY_LINK_RANGE + SUPPLY_SERVE_RANGE)) return null;
    return countOwn(s, owner, 'depot') < MAX_EXPANSION_DEPOTS ? 'depot' : null;
  }
  return null;
}

/** A Depot spot toward the expansion target: legal, linked, nearest the target. Null when none. */
export function depotToward(s: GameState, owner: Owner, target: Pt): Pt | null {
  const hubs = linkedHubs(s, owner).map(centreOf);
  if (!hubs.length) return null;
  const occ = occupancy(s);
  let best: Pt | null = null;
  let bestD = Infinity;
  for (const h of hubs)
    for (let y = Math.floor(h.y - SUPPLY_LINK_RANGE); y <= Math.ceil(h.y + SUPPLY_LINK_RANGE); y++)
      for (let x = Math.floor(h.x - SUPPLY_LINK_RANGE); x <= Math.ceil(h.x + SUPPLY_LINK_RANGE); x++) {
        if (x < 0 || y < 0 || x > s.mapW - 2 || y > s.mapH - 2) continue;
        const c = { x: x + 1, y: y + 1 };
        if ((c.x - h.x) ** 2 + (c.y - h.y) ** 2 > (SUPPLY_LINK_RANGE - 0.5) ** 2) continue;
        const d = dist(c.x, c.y, target.x, target.y);
        if (d >= bestD) continue;
        if (placementProblem(s, owner, 'depot', x, y, occ)) continue;
        bestD = d;
        best = { x, y };
      }
  return best;
}

/**
 * Advanced production: food nearly gone and a Farm to spare under the cap, so a Farm goes ahead of
 * everything else in the plan. Without it, Hard's bigger infantry appetite stalled its Barracks
 * while its credits piled up unspent (fireline-design.md, 2026-11-26).
 */
export function farmUrgent(s: GameState, owner: Owner): boolean {
  if (!productionOn(s)) return false;
  const p = s.players[owner];
  return (p.food ?? 0) < FOOD_URGENT && countOwn(s, owner, 'farm') < MAX_FARMS && !p.queues.building.some(q => q.kind === 'farm');
}
/** Food below which a Farm jumps the plan: five soldiers' worth. */
const FOOD_URGENT = 10;
