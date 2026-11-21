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
import { doSell, placementProblem } from './commands';
import { dist, occupancy } from './grid';
import { centreOf, cutOff, linkedHubs, supplyOn } from './supply';
import { industryOn, wellDry } from './industry';
import { isStructure } from './state';
import { FUEL_WELL_MIN_ORE, FUEL_WELL_REACH, SUPPLY_LINK_RANGE, SUPPLY_SERVE_RANGE, type BuildingKind, type Owner } from './rules';
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
  const wellWanted = wells || (!!anchor && wellFocus(s, owner, { x: anchor.x + 1.5, y: anchor.y + 1.5 }) !== null);
  // One of each at every level. Hard once built two of each: the second well drained the field its
  // haulers lived on and the second Foundry turned its income into stock, and in seat 0, without the
  // computer seat's income bonus, it won 15% against Normal (fireline-design.md, 2026-11-21).
  return [
    ['fuelwell', wellWanted ? 1 : 0],
    ['foundry', 1],
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
  let best: Pt | null = null;
  let bestScore = -Infinity;
  const r = FUEL_WELL_REACH;
  for (let k = 0; k < s.ore.length; k++) {
    if (s.ore[k] <= 0) continue;
    const x = k % s.mapW;
    const y = (k / s.mapW) | 0;
    if (!own.some(b => Math.abs(b.x + 1 - x) <= WELL_SEARCH && Math.abs(b.y + 1 - y) <= WELL_SEARCH)) continue;
    if (hubs && !hubs.some(h => (h.x - x - 0.5) ** 2 + (h.y - y - 0.5) ** 2 <= (SUPPLY_SERVE_RANGE + 1) ** 2)) continue;
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
