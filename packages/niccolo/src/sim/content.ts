import events0Data from '../content/events/chapter0.json';
import citiesData from '../content/cities/chapter1.json';
import routesData from '../content/routes/chapter1.json';
import goodsData from '../content/goods/chapter1.json';
import charactersData from '../content/characters/chapter1.json';
import eventsData from '../content/events/chapter1.json';
import housesData from '../content/houses/chapter1.json';
import cities2Data from '../content/cities/chapter2.json';
import routes2Data from '../content/routes/chapter2.json';
import characters2Data from '../content/characters/chapter2.json';
import events2Data from '../content/events/chapter2.json';
import houses2Data from '../content/houses/chapter2.json';
import cities3Data from '../content/cities/chapter3.json';
import routes3Data from '../content/routes/chapter3.json';
import goods3Data from '../content/goods/chapter3.json';
import events3Data from '../content/events/chapter3.json';
import type { City, Route, Good, Character, ScriptedEvent, House } from './types';

export const CAMPAIGN_START = new Date(1460, 2, 14); // 14 March 1460

/** The Charetty company's seat — the player always has live, first-hand knowledge of prices here. */
export const HOME_CITY = 'bruges';

/**
 * Chapter 1 (Phase 1-8) content lives in `chapter1.json` per content type; Chapter 2 (Phase 9) and
 * Chapter 3 (Phase 10) each ship as their own `chapterN.json` files, concatenated in here, rather
 * than appended into the chapter1 files the way Phase 7/8 grew Naples/cannon/houses in place —
 * establishing (Phase 9) and continuing (Phase 10) the one-chapter-one-file-per-type convention
 * Section 12 describes for Phase 10+. Chapter 3 has no new characters or houses of its own (the
 * Cyprus arc's antagonist is a historical siege, not a rival trading house), so `goods3Data` and
 * `events3Data` are the only new imports it needs beyond cities and routes. Chapter 0 (the
 * pre-Chapter-1 prologue) reuses Chapter 1's own cities/routes/characters entirely — it needs
 * only its own `events/chapter0.json`, concatenated first into `EVENTS`.
 */
export const CITIES: City[] = [
  ...(citiesData as unknown as City[]),
  ...(cities2Data as unknown as City[]),
  ...(cities3Data as unknown as City[]),
];
export const ROUTES: Route[] = [...(routesData as Route[]), ...(routes2Data as Route[]), ...(routes3Data as Route[])];
export const GOODS: Good[] = [...(goodsData as Good[]), ...(goods3Data as Good[])];
export const CHARACTERS: Character[] = [
  ...(charactersData as unknown as Character[]),
  ...(characters2Data as unknown as Character[]),
];
export const EVENTS: ScriptedEvent[] = [
  ...(events0Data as unknown as ScriptedEvent[]),
  ...(eventsData as unknown as ScriptedEvent[]),
  ...(events2Data as unknown as ScriptedEvent[]),
  ...(events3Data as unknown as ScriptedEvent[]),
];
export const HOUSES: House[] = [...(housesData as unknown as House[]), ...(houses2Data as unknown as House[])];

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
