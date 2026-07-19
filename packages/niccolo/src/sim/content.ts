import citiesData from '../content/cities/chapter1.json';
import routesData from '../content/routes/chapter1.json';
import goodsData from '../content/goods/chapter1.json';
import charactersData from '../content/characters/chapter1.json';
import eventsData from '../content/events/chapter1.json';
import housesData from '../content/houses/chapter1.json';
import type { City, Route, Good, Character, ScriptedEvent, House } from './types';

export const CAMPAIGN_START = new Date(1460, 2, 14); // 14 March 1460

/** The Charetty company's seat — the player always has live, first-hand knowledge of prices here. */
export const HOME_CITY = 'bruges';

export const CITIES: City[] = citiesData as unknown as City[];
export const ROUTES: Route[] = routesData as Route[];
export const GOODS: Good[] = goodsData as Good[];
export const CHARACTERS: Character[] = charactersData as unknown as Character[];
export const EVENTS: ScriptedEvent[] = eventsData as unknown as ScriptedEvent[];
export const HOUSES: House[] = housesData as unknown as House[];

export function findCity(id: string): City | undefined {
  return CITIES.find(c => c.id === id);
}

export function findGood(id: string): Good | undefined {
  return GOODS.find(g => g.id === id);
}

export function findCharacter(id: string): Character | undefined {
  return CHARACTERS.find(c => c.id === id);
}

export function findEvent(id: string): ScriptedEvent | undefined {
  return EVENTS.find(e => e.id === id);
}

export function findHouse(id: string): House | undefined {
  return HOUSES.find(h => h.id === id);
}

/** Good ids traded in a city's market, in content-file order. */
export function marketGoodsAt(cityId: string): string[] {
  const city = findCity(cityId);
  return city?.market ? Object.keys(city.market) : [];
}

/** Routes are stored one-directional; a vessel may travel either way along one. */
export function findRoute(fromId: string, toId: string): Route | undefined {
  return ROUTES.find(
    r => (r.from === fromId && r.to === toId) || (r.from === toId && r.to === fromId),
  );
}

/** Cities directly reachable from `fromId`, honouring courier land-only restriction. */
export function reachableFrom(fromId: string, landOnly: boolean): Route[] {
  return ROUTES.filter(r => {
    if (landOnly && r.type !== 'land') return false;
    return r.from === fromId || r.to === fromId;
  });
}
