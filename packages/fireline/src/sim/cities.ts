/**
 * Grand War, G1 (fireline-grand-war-design.md): what a city is, read by territory.ts, commands.ts
 * and grand.ts. Pure, like the rest of src/sim/, and imports rules.ts and types only, so the economy
 * modules can read it without a cycle.
 *
 * A city is a Command Yard or a Field Yard carrying a population (`Building.pop`), which only a Grand
 * War battle sets. Its level (1 to 5) follows its population and widens the ground it claims and the
 * district structures it may hold. An independent town (`Site`, kind 'town') counts as a city for
 * dominion once held, houses workers and claims ground, but has no population of its own.
 */
import {
  BUILDINGS,
  CITY_CLAIM_PER_LEVEL,
  CITY_DISTRICTS_BASE,
  CITY_DISTRICTS_PER_LEVEL,
  CITY_LEVEL_POP,
  CREW,
  SITES,
  type BuildingKind,
  type Owner,
} from './rules';
import type { Building, GameState, Site } from './types';

/** True in a Grand War battle (a skirmish with the grand block and the economy it needs). */
export const grandOn = (s: Pick<GameState, 'setup' | 'mission' | 'planet'>): boolean =>
  !s.mission && !s.planet && !!s.setup?.grand && s.setup.production === true && s.setup.territory === true;

/** True for a standing city: a yard with a population, in a Grand War battle. */
export const isCity = (s: GameState, b: Building): boolean => b.pop !== undefined && b.hp > 0 && (b.kind === 'hq' || b.kind === 'fieldyard') && grandOn(s);

/** A city's level, 1 to 5, from its population. */
export function cityLevel(pop: number): number {
  let n = 1;
  for (const p of CITY_LEVEL_POP) if (pop >= p) n++;
  return n;
}

/** Extra claim radius a city has for its level. */
export const cityClaimBonus = (b: Building): number => (b.pop === undefined ? 0 : CITY_CLAIM_PER_LEVEL * (cityLevel(b.pop) - 1));

/** District structures a city of this level may hold. */
export const districtCap = (level: number): number => CITY_DISTRICTS_BASE + CITY_DISTRICTS_PER_LEVEL * level;

/** A district structure: anything that needs a crew to work (CREW). */
export const isDistrict = (kind: BuildingKind): boolean => (CREW[kind] ?? 0) > 0;

export const centreOf = (b: Building): { x: number; y: number } => ({ x: b.x + BUILDINGS[b.kind].w / 2, y: b.y + BUILDINGS[b.kind].h / 2 });
export const townCentre = (t: Site): { x: number; y: number } => ({ x: t.x + SITES[t.kind].w / 2, y: t.y + SITES[t.kind].h / 2 });

/** This side's standing cities, in id order. */
export const citiesOf = (s: GameState, owner: Owner): Building[] => s.buildings.filter(b => b.owner === owner && isCity(s, b));

/** Every standing city on the map. */
export const allCities = (s: GameState): Building[] => s.buildings.filter(b => isCity(s, b));

/** The towns on the map. */
export const townsOf = (s: GameState): Site[] => (s.sites ?? []).filter(t => t.kind === 'town');

/** The towns this side holds. */
export const townsHeld = (s: GameState, owner: Owner): Site[] => townsOf(s).filter(t => t.owner === owner);

/** This side's city nearest the point (lowest id on a tie), or null. */
export function nearestCity(s: GameState, owner: Owner, x: number, y: number): Building | null {
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of s.buildings) {
    if (b.owner !== owner || !isCity(s, b)) continue;
    const c = centreOf(b);
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/** The district structures counted against a city: this side's, nearest it of all its cities. */
export function districtsOf(s: GameState, city: Building): Building[] {
  return s.buildings.filter(b => {
    if (b.owner !== city.owner || b.hp <= 0 || !isDistrict(b.kind)) return false;
    const c = centreOf(b);
    return nearestCity(s, city.owner, c.x, c.y) === city;
  });
}

/** Why a district structure may not go here for this city's size, or null. Grand War only. */
export function districtProblem(s: GameState, owner: Owner, kind: BuildingKind, x: number, y: number): string | null {
  if (!grandOn(s) || !isDistrict(kind)) return null;
  const spec = BUILDINGS[kind];
  const city = nearestCity(s, owner, x + spec.w / 2, y + spec.h / 2);
  if (!city) return null;
  const cap = districtCap(cityLevel(city.pop!));
  if (districtsOf(s, city).length >= cap) return `This city holds ${cap} districts at level ${cityLevel(city.pop!)}: grow it, or found another`;
  return null;
}

/** Total population of this side's cities. */
export const populationOf = (s: GameState, owner: Owner): number => citiesOf(s, owner).reduce((n, b) => n + (b.pop ?? 0), 0);

/** This side's first city (lowest id) with room for another district, or null: Grand War only. */
export function cityWithRoom(s: GameState, owner: Owner): Building | null {
  for (const c of citiesOf(s, owner)) if (districtsOf(s, c).length < districtCap(cityLevel(c.pop!))) return c;
  return null;
}
