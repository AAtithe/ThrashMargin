/**
 * War for the Planet: yields, upkeep, costs and caps (fireline-planet-design.md, sections 6.1 to
 * 6.3 and 6.6). W1. Pure.
 */
import { UNITS } from '../sim/rules';
import { buildCost, growCost } from './cities';
import { planetMapOf } from './map';
import { AI_ARMY_BONUS, AI_INCOME, CAPITAL_BONUS, CITY_BUILDING_SPECS, ORE_K, TERRAIN_YIELD, isInfantry, isVehicle } from './rules';
import { garrisonTotal } from './state';
import { suppliedRegions } from './supply';
import { routePartner, routeYield } from './trade';
import { ARMY_KINDS, CITY_BUILDINGS, NEUTRAL, RESOURCES, type ArmyKind, type FactionId, type PlanetState, type RegionId, type Stock } from './types';

export { buildCost, growCost };

export type Yield = Stock & { science: number };
const ZERO = (): Stock => ({ ore: 0, fuel: 0, alloys: 0, food: 0 });
const ZERO_Y = (): Yield => ({ ore: 0, fuel: 0, alloys: 0, food: 0, science: 0 });

/** Region yield before the computer factions' income multiplier, with `cut` halving applied. */
export function regionYieldWith(s: PlanetState, r: RegionId, supplied: boolean[] | null): Yield {
  const out = ZERO_Y();
  const reg = s.regions[r];
  if (!reg) return out;
  const g = planetMapOf(s).regions[r];
  const t = TERRAIN_YIELD[g.terrain];
  out.ore += Math.floor((t.ore * ORE_K[g.ore]) / 2);
  out.fuel += t.fuel;
  out.food += t.food;
  for (const b of CITY_BUILDINGS) {
    const mk = reg.city.b[b] ?? 0;
    if (!mk) continue;
    const y = CITY_BUILDING_SPECS[b].yieldPerMk;
    out.ore += (y.ore ?? 0) * mk;
    out.fuel += (y.fuel ?? 0) * mk;
    out.alloys += (y.alloys ?? 0) * mk;
    out.food += (y.food ?? 0) * mk;
    out.science += (y.science ?? 0) * mk;
  }
  if (reg.owner !== NEUTRAL && s.factions[reg.owner]?.capital === r) {
    out.ore += CAPITAL_BONUS.ore;
    out.alloys += CAPITAL_BONUS.alloys;
    out.science += CAPITAL_BONUS.science;
  }
  if (reg.owner !== NEUTRAL && supplied && !supplied[r]) {
    out.ore = Math.floor(out.ore / 2);
    out.fuel = Math.floor(out.fuel / 2);
    out.alloys = Math.floor(out.alloys / 2);
    out.food = Math.floor(out.food / 2);
    out.science = Math.floor(out.science / 2);
  }
  return out;
}

/** What region r yields its owner each turn (cut-off regions halved). */
export function regionYield(s: PlanetState, r: RegionId): Yield {
  const owner = s.regions[r]?.owner;
  return regionYieldWith(s, r, owner === undefined || owner === NEUTRAL ? null : suppliedRegions(s, owner));
}

export const yieldTotal = (y: Yield): number => y.ore + y.fuel + y.alloys + y.food + y.science;

/** Region yields for f this turn (step 1 of production), the income multiplier applied. */
export function regionIncome(s: PlanetState, f: FactionId, supplied?: boolean[]): Yield {
  const sup = supplied ?? suppliedRegions(s, f);
  const out = ZERO_Y();
  s.regions.forEach((reg, r) => {
    if (reg.owner !== f) return;
    const y = regionYieldWith(s, r, sup);
    out.ore += y.ore;
    out.fuel += y.fuel;
    out.alloys += y.alloys;
    out.food += y.food;
    out.science += y.science;
  });
  if (f !== 0) {
    const k = AI_INCOME[s.difficulty];
    out.ore = Math.floor(out.ore * k);
    out.fuel = Math.floor(out.fuel * k);
    out.alloys = Math.floor(out.alloys * k);
    out.food = Math.floor(out.food * k);
    out.science = Math.floor(out.science * k);
  }
  return out;
}

/** Route income for f this turn: routes it owns plus foreign routes where it is the partner. */
export function routeIncome(s: PlanetState, f: FactionId): Stock {
  const out = ZERO();
  for (const route of s.routes) {
    const mine = route.owner === f;
    const partner = routePartner(s, route) === f;
    if (!mine && !partner) continue;
    const y = routeYield(s, route);
    for (const r of RESOURCES) out[r] += y[r];
  }
  return out;
}

export function armyCounts(units: { kind: ArmyKind }[]): { infantry: number; vehicles: number } {
  let infantry = 0;
  let vehicles = 0;
  for (const u of units) {
    if (isInfantry(u.kind)) infantry++;
    else if (isVehicle(u.kind)) vehicles++;
  }
  return { infantry, vehicles };
}

/** Upkeep per turn: cities (food), airfields (fuel), the field army, garrisons. */
export function upkeepOf(s: PlanetState, f: FactionId): Stock {
  const out = ZERO();
  let garrison = 0;
  for (const reg of s.regions) {
    if (reg.owner !== f) continue;
    out.food += reg.city.level;
    out.fuel += reg.city.b.airfield ?? 0;
    garrison += garrisonTotal(reg.garrison);
  }
  out.food += Math.ceil(garrison / 5);
  const army = s.factions[f]?.army;
  if (army) {
    const c = armyCounts(army.units);
    out.food += Math.ceil(c.infantry / 3);
    out.fuel += Math.ceil(c.vehicles / 2);
  }
  return out;
}

/** Factory conversion this turn, as if every supplied factory ran with the ore f will have. */
function factoryConversion(s: PlanetState, f: FactionId, oreAvailable: number, supplied: boolean[]): number {
  let ore = oreAvailable;
  let done = 0;
  s.regions.forEach((reg, r) => {
    if (reg.owner !== f || !supplied[r]) return;
    const mk = reg.city.b.factory ?? 0;
    if (!mk) return;
    const n = Math.min(2 * mk, ore);
    ore -= n;
    done += n;
  });
  return done;
}

/** Income, upkeep and net for f per turn (net ignores treaty flows, which the Diplomacy tab lists). */
export function factionIncome(s: PlanetState, f: FactionId): { income: Yield; upkeep: Stock; net: Stock } {
  const supplied = suppliedRegions(s, f);
  const income = regionIncome(s, f, supplied);
  const routes = routeIncome(s, f);
  for (const r of RESOURCES) income[r] += routes[r];
  const stockOre = s.factions[f]?.stock.ore ?? 0;
  const conv = factoryConversion(s, f, stockOre + income.ore, supplied);
  income.ore -= conv;
  income.alloys += conv;
  const upkeep = upkeepOf(s, f);
  const net = ZERO();
  for (const r of RESOURCES) net[r] = income[r] - upkeep[r];
  return { income, upkeep, net };
}

export { factoryConversion };

/** Cost of recruiting one unit (section 6.3). */
export function recruitCost(kind: ArmyKind): Stock {
  const c = UNITS[kind].cost;
  const out = ZERO();
  if (isInfantry(kind)) out.food = Math.max(1, Math.round(c / 100));
  else {
    out.alloys = Math.max(1, Math.round(c / 250));
    out.fuel = Math.max(1, Math.round(c / 500));
  }
  return out;
}

/** Garrison room: 4 + 2 per city level + 3 per Mk of fortifications. */
export function garrisonCap(s: PlanetState, r: RegionId): number {
  const reg = s.regions[r];
  if (!reg) return 0;
  return 4 + 2 * reg.city.level + 3 * (reg.city.b.fortifications ?? 0);
}

/** Most units f's field army may hold. */
export function armyCapOf(s: PlanetState, f: FactionId): number {
  return Math.max(1, s.options.armyCap + (f === 0 ? 0 : AI_ARMY_BONUS[s.difficulty]));
}

export const canAfford = (stock: Stock, cost: Stock): boolean => RESOURCES.every(r => stock[r] >= cost[r]);
export function pay(stock: Stock, cost: Stock): void {
  for (const r of RESOURCES) stock[r] -= cost[r];
}
export function addStock(stock: Stock, gain: Partial<Stock>): void {
  for (const r of RESOURCES) stock[r] += gain[r] ?? 0;
}
export function costText(cost: Stock): string {
  const parts = RESOURCES.filter(r => cost[r] > 0).map(r => `${cost[r]} ${r}`);
  return parts.length ? parts.join(', ') : 'nothing';
}
export function shortfallText(stock: Stock, cost: Stock): string {
  const parts = RESOURCES.filter(r => stock[r] < cost[r]).map(r => `${cost[r] - stock[r]} more ${r}`);
  return `Needs ${parts.join(', ')}.`;
}

export const ARMY_KIND_COUNT = ARMY_KINDS.length;
