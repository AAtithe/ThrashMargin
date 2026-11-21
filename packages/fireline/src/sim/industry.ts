/**
 * Industry (2026-11-21, `setup.industry`; fireline-design.md): fuel and alloys beside credits.
 *
 * - A Fuel Well, placed beside an ore field, draws ore out of the ground within FUEL_WELL_REACH
 *   tiles and pumps fuel. The ore it takes is ore no hauler will bring in: the field is shared.
 * - A Foundry turns credits (refined ore) and fuel into alloys, while the alloy store has room and
 *   never with the side's last FOUNDRY_RESERVE credits.
 * - Vehicles, ships and aircraft are paid partly in alloys, aircraft partly in fuel as well, and an
 *   aircraft burns fuel for every load it takes on at its Helipad. Infantry and structures are paid
 *   in credits alone, and so are the Ore Hauler and the Forward Base Truck, so a side can always
 *   rebuild its economy.
 *
 * Never in a mission or a planet battle. Pure, like the rest of src/sim/: no clock, no dice; the
 * well and the foundry work on the tick count, offset by their id.
 *
 * Imports rules.ts, specs.ts and types only, so state.ts and tick.ts can use it without a cycle.
 */
import {
  AIR_LOAD_FUEL,
  ALLOY_STORE_BASE,
  ALLOY_STORE_PER_FOUNDRY,
  ALLOY_VALUE,
  BUILDINGS,
  FOUNDRY_ALLOYS,
  FOUNDRY_CREDITS,
  FOUNDRY_FUEL,
  FOUNDRY_RESERVE,
  FOUNDRY_TICKS,
  FUEL_STORE_BASE,
  FUEL_STORE_PER_WELL,
  FUEL_VALUE,
  FUEL_WELL_ORE,
  FUEL_WELL_REACH,
  FUEL_WELL_TICKS,
  INDUSTRY_AIR_FUEL_SHARE,
  INDUSTRY_ALLOY_SHARE,
  INDUSTRY_EXEMPT,
  INDUSTRY_START_ALLOYS,
  INDUSTRY_START_FUEL,
  UNITS,
  WELL_HOLD,
  type BuildingKind,
  type Owner,
  type UnitKind,
} from './rules';
import type { Building, GameState, PlayerState, QueueItem } from './types';

/** The structures that exist only with industry on. */
export const INDUSTRY_BUILDINGS: BuildingKind[] = ['fuelwell', 'foundry'];

/** True in a skirmish set up with industry on. Never in a mission or a planet battle. */
export const industryOn = (s: GameState): boolean => !s.mission && !s.planet && s.setup?.industry === true;

/** True for a kind paid partly in goods when industry is on: vehicles, ships and aircraft, bar the exempt and the heroes. */
export function paysInGoods(kind: BuildingKind | UnitKind): boolean {
  if (!(kind in UNITS)) return false;
  const spec = UNITS[kind as UnitKind];
  if (spec.hero || INDUSTRY_EXEMPT.includes(kind as UnitKind)) return false;
  return spec.category === 'vehicle' || spec.category === 'naval' || spec.category === 'air';
}

/** The shares of a kind's price paid in alloys and in fuel (both 0 for a kind paid in credits alone). */
function shares(kind: BuildingKind | UnitKind): { alloy: number; fuel: number } {
  if (!paysInGoods(kind)) return { alloy: 0, fuel: 0 };
  return { alloy: INDUSTRY_ALLOY_SHARE, fuel: UNITS[kind as UnitKind].category === 'air' ? INDUSTRY_AIR_FUEL_SHARE : 0 };
}

/** The credits part of a price whose whole is `full`: the whole, less the shares paid in goods. */
export function creditsPart(s: GameState, kind: BuildingKind | UnitKind, full: number): number {
  if (!industryOn(s)) return full;
  const sh = shares(kind);
  if (!sh.alloy && !sh.fuel) return full;
  return Math.round(full * (1 - sh.alloy - sh.fuel));
}

/** The goods part of a price whose whole is `full`, in alloys and fuel. Zero without industry. */
export function goodsPart(s: GameState, kind: BuildingKind | UnitKind, full: number): { alloys: number; fuel: number } {
  if (!industryOn(s)) return { alloys: 0, fuel: 0 };
  const sh = shares(kind);
  return { alloys: Math.round((full * sh.alloy) / ALLOY_VALUE), fuel: Math.round((full * sh.fuel) / FUEL_VALUE) };
}

/** True when the side holds these goods. */
export const hasGoods = (p: PlayerState, g: { alloys: number; fuel: number }): boolean => (p.alloys ?? 0) >= g.alloys && (p.fuel ?? 0) >= g.fuel;

/** Takes the goods from the side's store and records them on the queue item, for its refund. */
export function payGoods(p: PlayerState, item: QueueItem, g: { alloys: number; fuel: number }): void {
  if (g.alloys) {
    p.alloys = (p.alloys ?? 0) - g.alloys;
    item.alloys = g.alloys;
  }
  if (g.fuel) {
    p.fuel = (p.fuel ?? 0) - g.fuel;
    item.fuel = g.fuel;
  }
}

/** Gives back the goods a queue item was paid with (a cancel, or the computer taking it back). Stores may run over for a moment; that is fine. */
export function refundGoods(p: PlayerState, item: QueueItem): void {
  if (item.alloys) p.alloys = (p.alloys ?? 0) + item.alloys;
  if (item.fuel) p.fuel = (p.fuel ?? 0) + item.fuel;
}

const countOwn = (s: GameState, owner: Owner, kind: BuildingKind): number => {
  let n = 0;
  for (const b of s.buildings) if (b.owner === owner && b.kind === kind) n++;
  return n;
};

/** How much fuel this side may hold: a base amount and more per Fuel Well. */
export const fuelStore = (s: GameState, owner: Owner): number => FUEL_STORE_BASE + FUEL_STORE_PER_WELL * countOwn(s, owner, 'fuelwell');
/** How many alloys this side may hold: a base amount and more per Foundry. */
export const alloyStore = (s: GameState, owner: Owner): number => ALLOY_STORE_BASE + ALLOY_STORE_PER_FOUNDRY * countOwn(s, owner, 'foundry');

/** Ore in the ground within FUEL_WELL_REACH of a footprint at (x, y), w by h. */
export function oreInReach(s: GameState, x: number, y: number, w: number, h: number): number {
  let n = 0;
  for (let ty = Math.max(0, y - FUEL_WELL_REACH); ty < Math.min(s.mapH, y + h + FUEL_WELL_REACH); ty++)
    for (let tx = Math.max(0, x - FUEL_WELL_REACH); tx < Math.min(s.mapW, x + w + FUEL_WELL_REACH); tx++) n += s.ore[tx + ty * s.mapW];
  return n;
}

/** The richest ore tile in a Fuel Well's reach (lowest index on a tie), or -1 when it is dry. */
function richestTile(s: GameState, b: Building): number {
  const spec = BUILDINGS[b.kind];
  let best = -1;
  let most = 0;
  for (let ty = Math.max(0, b.y - FUEL_WELL_REACH); ty < Math.min(s.mapH, b.y + spec.h + FUEL_WELL_REACH); ty++)
    for (let tx = Math.max(0, b.x - FUEL_WELL_REACH); tx < Math.min(s.mapW, b.x + spec.w + FUEL_WELL_REACH); tx++) {
      const k = tx + ty * s.mapW;
      if (s.ore[k] > most) {
        most = s.ore[k];
        best = k;
      }
    }
  return best;
}

/** True when a Fuel Well has no ore left in reach. */
export const wellDry = (s: GameState, b: Building): boolean => richestTile(s, b) < 0;

/** Every side's opening stock: called once, as a battle with industry on is created. */
export function startIndustry(s: GameState): void {
  if (!industryOn(s)) return;
  for (const p of s.players) {
    p.fuel = INDUSTRY_START_FUEL;
    p.alloys = INDUSTRY_START_ALLOYS;
  }
}

/**
 * One tick of industry: every Fuel Well pumps and every Foundry smelts, on its own beat (its id
 * offsets it), half as often for a side short of power. `low[owner]` is true for a side short of power.
 */
export function industryStep(s: GameState, low: ArrayLike<boolean>, cut: ReadonlySet<number> = NO_CUT): void {
  if (!industryOn(s)) return;
  for (const b of s.buildings) {
    if (b.hp <= 0 || (b.kind !== 'fuelwell' && b.kind !== 'foundry')) continue;
    const p = s.players[b.owner];
    if (!p) continue;
    const beat = (b.kind === 'fuelwell' ? FUEL_WELL_TICKS : FOUNDRY_TICKS) * (low[b.owner] ? 2 : 1);
    if ((s.tick + b.id) % beat !== 0) continue;
    // Supply lines (supply.ts): a cut-off well pumps into its own tank, a cut-off Foundry stops.
    const isCut = cut.has(b.id);
    if (b.kind === 'fuelwell') {
      if (isCut ? (b.held ?? 0) >= WELL_HOLD : (p.fuel ?? 0) + 1 > fuelStore(s, b.owner)) continue;
      const k = richestTile(s, b);
      if (k < 0) continue;
      s.ore[k] = Math.max(0, s.ore[k] - FUEL_WELL_ORE);
      if (isCut) b.held = (b.held ?? 0) + 1;
      else p.fuel = (p.fuel ?? 0) + 1;
    } else {
      if (isCut) continue;
      if (p.credits < FOUNDRY_CREDITS + FOUNDRY_RESERVE || (p.fuel ?? 0) < FOUNDRY_FUEL) continue;
      if ((p.alloys ?? 0) + FOUNDRY_ALLOYS > alloyStore(s, b.owner)) continue;
      p.credits -= FOUNDRY_CREDITS;
      p.fuel = (p.fuel ?? 0) - FOUNDRY_FUEL;
      p.alloys = (p.alloys ?? 0) + FOUNDRY_ALLOYS;
    }
  }
}

const NO_CUT: ReadonlySet<number> = new Set();

/** An aircraft's load at its Helipad: burns AIR_LOAD_FUEL from the side's store. False when there is not enough. */
export function burnLoadFuel(p: PlayerState | undefined): boolean {
  if (!p || (p.fuel ?? 0) < AIR_LOAD_FUEL) return false;
  p.fuel = (p.fuel ?? 0) - AIR_LOAD_FUEL;
  return true;
}
