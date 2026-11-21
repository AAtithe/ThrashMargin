/**
 * The computer's industry (2026-11-21, `setup.industry`; industry.ts). Without industry nothing
 * here does anything, so the commander plays exactly as before.
 *
 * - Its structure plan gains a Fuel Well and a Foundry right after its first War Factory, at every
 *   level, so alloys are coming in by the time the factory has used the opening stock.
 * - A Fuel Well goes beside the ore field nearest home that holds enough in reach.
 * - A Fuel Well that has drained its field is sold, and the plan puts a new one by another field.
 */
import { doSell } from './commands';
import { dist } from './grid';
import { industryOn, wellDry } from './industry';
import { isStructure } from './state';
import { FUEL_WELL_MIN_ORE, FUEL_WELL_REACH, type BuildingKind, type Owner } from './rules';
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
  let best: Pt | null = null;
  let bestScore = -Infinity;
  const r = FUEL_WELL_REACH;
  for (let k = 0; k < s.ore.length; k++) {
    if (s.ore[k] <= 0) continue;
    const x = k % s.mapW;
    const y = (k / s.mapW) | 0;
    if (!own.some(b => Math.abs(b.x + 1 - x) <= WELL_SEARCH && Math.abs(b.y + 1 - y) <= WELL_SEARCH)) continue;
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
