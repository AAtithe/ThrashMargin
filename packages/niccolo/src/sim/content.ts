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
import cities4Data from '../content/cities/chapter4.json';
import routes4Data from '../content/routes/chapter4.json';
import goods4Data from '../content/goods/chapter4.json';
import characters4Data from '../content/characters/chapter4.json';
import events4Data from '../content/events/chapter4.json';
import cities5Data from '../content/cities/chapter5.json';
import routes5Data from '../content/routes/chapter5.json';
import characters5Data from '../content/characters/chapter5.json';
import events5Data from '../content/events/chapter5.json';
import houses5Data from '../content/houses/chapter5.json';
import objectives1Data from '../content/objectives/chapter1.json';
import objectives2Data from '../content/objectives/chapter2.json';
import objectives3Data from '../content/objectives/chapter3.json';
import objectives4Data from '../content/objectives/chapter4.json';
import objectives5Data from '../content/objectives/chapter5.json';
import type { City, Route, Good, Character, ScriptedEvent, House, Objective } from './types';

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
 * only its own `events/chapter0.json`, concatenated first into `EVENTS`. Chapter 4 (Phase 13)
 * continues the same convention: a new currency, route type, and one mid-campaign character all
 * live in code (types.ts/currency.ts/houses.ts), while the map/goods/events content that uses them
 * lives here in `chapter4.json` per type, same as every chapter since. Chapter 5 (Phase 19) is the
 * first chapter pack to add **no** new goods file at all: Scotland's cheap wool, Egypt's cheap
 * spices and sugar, and the court market at Cairo for Flemish cloth and Venetian glass are all
 * existing goods placed in new markets, which is both historically what those cities actually
 * traded and the only way to add four cities without opening four new dead-end goods (see the
 * dead-end-goods audit in PROGRESS.md's own Phase 15 follow-up #2 entry for why that matters).
 */
export const CITIES: City[] = [
  ...(citiesData as unknown as City[]),
  ...(cities2Data as unknown as City[]),
  ...(cities3Data as unknown as City[]),
  ...(cities4Data as unknown as City[]),
  ...(cities5Data as unknown as City[]),
];
export const ROUTES: Route[] = [
  ...(routesData as Route[]),
  ...(routes2Data as Route[]),
  ...(routes3Data as Route[]),
  ...(routes4Data as Route[]),
  ...(routes5Data as Route[]),
];
export const GOODS: Good[] = [...(goodsData as Good[]), ...(goods3Data as Good[]), ...(goods4Data as Good[])];
export const CHARACTERS: Character[] = [
  ...(charactersData as unknown as Character[]),
  ...(characters2Data as unknown as Character[]),
  ...(characters4Data as unknown as Character[]),
  ...(characters5Data as unknown as Character[]),
];
export const EVENTS: ScriptedEvent[] = [
  ...(events0Data as unknown as ScriptedEvent[]),
  ...(eventsData as unknown as ScriptedEvent[]),
  ...(events2Data as unknown as ScriptedEvent[]),
  ...(events3Data as unknown as ScriptedEvent[]),
  ...(events4Data as unknown as ScriptedEvent[]),
  ...(events5Data as unknown as ScriptedEvent[]),
];
export const HOUSES: House[] = [
  ...(housesData as unknown as House[]),
  ...(houses2Data as unknown as House[]),
  ...(houses5Data as unknown as House[]),
];
/** Story-tied objectives (Phase 14) — a read-only projection over flags the chapters above already
 * set, authored per chapter like every other content type. Chapter 0 has none of its own (see
 * `sim/objectives.ts`'s own note on why). */
export const OBJECTIVES: Objective[] = [
  ...(objectives1Data as Objective[]),
  ...(objectives2Data as Objective[]),
  ...(objectives3Data as Objective[]),
  ...(objectives4Data as Objective[]),
  ...(objectives5Data as Objective[]),
];

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

export function findRouteById(routeId: string): Route | undefined {
  return ROUTES.find(r => r.id === routeId);
}

/** The city at the other end of a route from a known endpoint — routes are stored one-directional
 * but sailable either way, so every caller that already has "the end I'm not at" needs this same
 * from/to flip (dispatching the first leg of a queued journey, resolving a `CONTINUE_PLANNED_ROUTE`
 * to its destination, describing a planned path back to the player). */
export function otherEndOfRoute(route: Route, cityId: string): string {
  return route.from === cityId ? route.to : route.from;
}

/** Cities directly reachable from `fromId`, honouring courier land-only restriction. */
export function reachableFrom(fromId: string, landOnly: boolean): Route[] {
  return ROUTES.filter(r => {
    if (landOnly && r.type !== 'land') return false;
    return r.from === fromId || r.to === fromId;
  });
}

export interface PlannedRoute {
  /** Ordered route ids from `fromId` to `toId`, one hop each. */
  routeIds: string[];
  totalWeeks: number;
}

/**
 * Shortest path (by total `distanceWeeks`) from `fromId` to `toId` across the existing `ROUTES`
 * graph — a plain Dijkstra, since every edge weight is positive and the graph is small (≤20
 * cities). Used only by the UI (path preview, "Queue journey") to explain and offer a multi-hop
 * dispatch as a *chain of the existing single-hop `dispatchVessel` calls*; the sim's own dispatch
 * mechanic still only ever moves a vessel one direct edge at a time — see `Vessel.plannedRoute`'s
 * own doc comment for why that invariant (a vessel always docks, and becomes tradeable, at every
 * intermediate city) is preserved rather than replaced. Returns null if no path exists at all
 * under the given `landOnly` restriction (e.g. a courier trying to reach a sea-locked city).
 */
export function planRoute(fromId: string, toId: string, landOnly: boolean): PlannedRoute | null {
  if (fromId === toId) return null;
  const dist: Record<string, number> = { [fromId]: 0 };
  const viaRoute: Record<string, Route> = {};
  const visited = new Set<string>();

  while (true) {
    let current: string | null = null;
    let currentDist = Infinity;
    for (const cityId of Object.keys(dist)) {
      if (!visited.has(cityId) && dist[cityId] < currentDist) {
        current = cityId;
        currentDist = dist[cityId];
      }
    }
    if (current === null || current === toId) break;
    visited.add(current);
    for (const route of reachableFrom(current, landOnly)) {
      const neighbor = otherEndOfRoute(route, current);
      const candidate = currentDist + route.distanceWeeks;
      if (dist[neighbor] === undefined || candidate < dist[neighbor]) {
        dist[neighbor] = candidate;
        viaRoute[neighbor] = route;
      }
    }
  }

  if (dist[toId] === undefined) return null;
  const routeIds: string[] = [];
  let cursor = toId;
  while (cursor !== fromId) {
    const route = viaRoute[cursor];
    routeIds.unshift(route.id);
    cursor = otherEndOfRoute(route, cursor);
  }
  return { routeIds, totalWeeks: dist[toId] };
}
