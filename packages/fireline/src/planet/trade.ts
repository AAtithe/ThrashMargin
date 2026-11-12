/**
 * War for the Planet: trade routes (fireline-planet-design.md, section 7). W1. Pure.
 * A route stores only its endpoints; its path is recomputed every turn and never saved.
 */
import { ROUTE_CAP_MAX, ROUTE_COST, ROUTE_MAX_HOPS } from './rules';
import { stanceOf, isInt } from './state';
import { bfsPath, mayPass } from './supply';
import { NEUTRAL, type FactionId, type PlanetState, type RegionId, type Stock, type TradeRoute } from './types';

const ZERO = (): Stock => ({ ore: 0, fuel: 0, alloys: 0, food: 0 });

/** The partner of a foreign route (the owner of its far end), or null for a domestic one. */
export function routePartner(s: PlanetState, route: TradeRoute): FactionId | null {
  const o = s.regions[route.to]?.owner;
  return o === undefined || o === route.owner || o === NEUTRAL ? null : o;
}

const tradesWith = (s: PlanetState, a: FactionId, b: FactionId): boolean => {
  const st = stanceOf(s, a, b);
  return st === 'trade' || st === 'alliance';
};

/** Still standing: the owner holds `from`, and `to` belongs to the owner or a trading partner. */
export function routeStands(s: PlanetState, route: TradeRoute): boolean {
  const from = s.regions[route.from];
  const to = s.regions[route.to];
  if (!from || !to || from.owner !== route.owner || !s.factions[route.owner]?.alive) return false;
  if (to.owner === route.owner) return true;
  if (to.owner === NEUTRAL || !s.factions[to.owner]?.alive) return false;
  return tradesWith(s, route.owner, to.owner);
}

/** The path this turn (at most ROUTE_MAX_HOPS hops), or null when blockaded. */
export function routePath(s: PlanetState, route: TradeRoute): RegionId[] | null {
  if (!routeStands(s, route)) return null;
  const partner = routePartner(s, route);
  const pass = (r: RegionId) => mayPass(s, route.owner, r) || (partner !== null && mayPass(s, partner, r));
  return bfsPath(s, route.from, route.to, pass, ROUTE_MAX_HOPS);
}

/** What the route pays its owner this turn (a foreign route pays its partner the same). */
export function routeYield(s: PlanetState, route: TradeRoute): Stock {
  const out = ZERO();
  if (!routePath(s, route)) return out;
  const y = 1 + Math.floor((s.regions[route.from].city.level + s.regions[route.to].city.level) / 4);
  if (routePartner(s, route) === null) {
    out.ore = y;
    out.food = y;
  } else {
    out.fuel = y;
    out.alloys = y;
  }
  return out;
}

/** Most routes f may own: min(8, 1 + floor(city levels / 6) + port Mks). */
export function routeCap(s: PlanetState, f: FactionId): number {
  let levels = 0;
  let ports = 0;
  for (const r of s.regions) if (r.owner === f) {
    levels += r.city.level;
    ports += r.city.b.port ?? 0;
  }
  return Math.min(ROUTE_CAP_MAX, 1 + Math.floor(levels / 6) + ports);
}

/** Why f cannot open a route from `from` to `to` (ignoring stock and the general refusals), or null. */
export function routeProblem(s: PlanetState, f: FactionId, from: unknown, to: unknown): string | null {
  const n = s.regions.length;
  if (!isInt(from, 0, n - 1) || !isInt(to, 0, n - 1)) return 'There is no such region.';
  if (from === to) return 'A route needs two different cities.';
  if (s.regions[from].owner !== f) return 'A route must start from one of your cities.';
  const toOwner = s.regions[to].owner;
  if (toOwner === NEUTRAL) return 'Independent cities do not trade.';
  if (toOwner !== f && !tradesWith(s, f, toOwner)) return 'A foreign route needs a trade pact or an alliance with that faction.';
  if (s.routes.some(r => (r.from === from && r.to === to) || (r.from === to && r.to === from))) return 'That route is already open.';
  if (s.routes.filter(r => r.owner === f).length >= routeCap(s, f)) return `You have room for ${routeCap(s, f)} routes. Grow cities or build ports for more.`;
  if (toOwner === f) {
    const hops = bfsPath(s, from, to, () => true);
    if (hops && hops.length - 1 < 2) return 'A route between your own cities must span at least 2 hops.';
  }
  const route: TradeRoute = { id: 0, owner: f, from, to };
  if (!routePath(s, route)) return `No safe path of ${ROUTE_MAX_HOPS} hops or fewer joins those cities.`;
  return null;
}

export const routeCost = (): Stock => ({ ...ROUTE_COST });

/** Removes routes that no longer stand (an endpoint changed hands, a partner stopped trading). */
export function pruneRoutes(d: PlanetState): void {
  d.routes = d.routes.filter(r => routeStands(d, r));
}

/** Exchange terms flow only while some foreign route between a and b (either owner) is unblocked. */
export function exchangeFlows(s: PlanetState, a: FactionId, b: FactionId): boolean {
  return s.routes.some(r => {
    const p = routePartner(s, r);
    return ((r.owner === a && p === b) || (r.owner === b && p === a)) && routePath(s, r) !== null;
  });
}

/** Hops between two regions over every link, for the interface and AI. */
export function hopsBetween(s: PlanetState, a: RegionId, b: RegionId): number {
  const p = bfsPath(s, a, b, () => true);
  return p ? p.length - 1 : Infinity;
}

