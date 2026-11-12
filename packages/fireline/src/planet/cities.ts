/**
 * War for the Planet: cities and their buildings (fireline-planet-design.md, section 6.2). W1. Pure.
 */
import type { BuildingKind } from '../sim/rules';
import { note } from './journal';
import { planetMapOf } from './map';
import { CITY_BUILDING_SPECS } from './rules';
import { CITY_BUILDINGS, RESOURCES, type BuildingLevel, type CityBuildingId, type CityState, type PlanetState, type RegionId, type Stock } from './types';

export const isCityBuilding = (v: unknown): v is CityBuildingId => typeof v === 'string' && (CITY_BUILDINGS as string[]).includes(v);

/** Distinct buildings a city of this level may hold. */
export const citySlots = (level: number): number => level + 1;
/** Highest Mk a city of this level may hold. */
export const cityMaxMk = (level: number): number => Math.min(3, level);
export const buildingCount = (c: CityState): number => CITY_BUILDINGS.filter(b => (c.b[b] ?? 0) > 0).length;

export function buildingName(b: CityBuildingId, mk: number): string {
  const spec = CITY_BUILDING_SPECS[b];
  return mk >= 3 && spec.name3 ? spec.name3 : spec.name;
}

export function scaleStock(cost: Partial<Stock>, k: number): Stock {
  const out: Stock = { ore: 0, fuel: 0, alloys: 0, food: 0 };
  for (const r of RESOURCES) out[r] = (cost[r] ?? 0) * k;
  return out;
}

/** Why building (or raising) b in region r is impossible regardless of stock, or null. */
export function buildBlock(s: PlanetState, r: RegionId, b: CityBuildingId): string | null {
  const reg = s.regions[r];
  if (!reg) return 'There is no such region.';
  if (!isCityBuilding(b)) return 'There is no such building.';
  const c = reg.city;
  const mk = c.b[b] ?? 0;
  const next = mk + 1;
  if (next > 3) return `${buildingName(b, mk)} is already at Mk 3.`;
  if (next > cityMaxMk(c.level)) return `A level ${c.level} city cannot hold a Mk ${next} building. Grow the city first.`;
  if (mk === 0 && buildingCount(c) >= citySlots(c.level)) return `A level ${c.level} city has room for ${citySlots(c.level)} buildings.`;
  if (CITY_BUILDING_SPECS[b].coastal && !planetMapOf(s).regions[r].coastal) return 'A port needs a coastal region.';
  return null;
}

/** Cost of the next Mk of b in region r, or null when it cannot be built there. */
export function buildCost(s: PlanetState, r: RegionId, b: CityBuildingId): Stock | null {
  if (buildBlock(s, r, b)) return null;
  const next = (s.regions[r].city.b[b] ?? 0) + 1;
  return scaleStock(CITY_BUILDING_SPECS[b].cost, next);
}

/** Growth from level L to L + 1: ore 6L, alloys 4L, food 8L. */
export function growCost(level: number): Stock {
  return { ore: 6 * level, fuel: 0, alloys: 4 * level, food: 8 * level };
}

/** Clips buildings to what the city can hold: levels to the city level, then excess removed in reverse order. */
export function cutBack(c: CityState): void {
  const max = cityMaxMk(c.level);
  for (const b of CITY_BUILDINGS) {
    const mk = c.b[b];
    if (mk !== undefined && mk > max) c.b[b] = max as BuildingLevel;
    if (mk !== undefined && (c.b[b] ?? 0) <= 0) delete c.b[b];
  }
  for (let i = CITY_BUILDINGS.length - 1; i >= 0 && buildingCount(c) > citySlots(c.level); i--) delete c.b[CITY_BUILDINGS[i]];
}

/** Applies a report's building damage and level loss to a draft city, then the cut-back. */
export function damageCity(c: CityState, damage: Partial<Record<CityBuildingId, number>>, levelLost: number): void {
  for (const b of CITY_BUILDINGS) {
    const mk = c.b[b];
    const loss = Math.max(0, Math.floor(damage[b] ?? 0));
    if (mk === undefined || !loss) continue;
    const left = mk - loss;
    if (left <= 0) delete c.b[b];
    else c.b[b] = left as BuildingLevel;
  }
  if (levelLost > 0) c.level = Math.max(1, c.level - 1) as CityState['level'];
  cutBack(c);
}

/** The battle structures a defending principal's city buildings stand for (section 6.2's table). */
export function cityStructures(c: CityState): { kind: BuildingKind; tag: CityBuildingId }[] {
  const out: { kind: BuildingKind; tag: CityBuildingId }[] = [];
  const add = (kind: BuildingKind, tag: CityBuildingId, n = 1) => {
    for (let i = 0; i < n; i++) out.push({ kind, tag });
  };
  for (const b of CITY_BUILDINGS) {
    const mk = c.b[b] ?? 0;
    if (!mk) continue;
    switch (b) {
      case 'refinery':
        add('refinery', b, mk);
        break;
      case 'factory':
        add('factory', b);
        if (mk >= 2) add('repairbay', b);
        break;
      case 'institute':
        add('researchlab', b);
        if (mk >= 2) add('techcentre', b);
        break;
      case 'fortifications':
        add('turret', b, 2 * mk);
        add('rocketturret', b, mk);
        if (mk >= 3) add('strikecommand', b);
        break;
      case 'airfield':
        add('helipad', b);
        if (mk >= 3) add('helipad', b);
        add('flakcannon', b, mk);
        break;
      default:
        break;
    }
  }
  return out;
}

/** Unlocks the Spy (institute Mk 2) and the Ace (airfield Mk 2) the first time the player holds one. */
export function unlockHeroes(d: PlanetState): void {
  const own = d.regions.filter(r => r.owner === 0);
  if (!d.heroes.spy.unlocked && own.some(r => (r.city.b.institute ?? 0) >= 2)) {
    d.heroes.spy.unlocked = true;
    note(d, 'A research institute at Mk 2 brings the Spy to your staff.', 'good', 0);
  }
  if (!d.heroes.ace.unlocked && own.some(r => (r.city.b.airfield ?? 0) >= 2)) {
    d.heroes.ace.unlocked = true;
    note(d, 'An airfield at Mk 2 brings the Ace to your staff.', 'good', 0);
  }
}
