/**
 * Static content plus the derived route graph. Everything here is computed once at module load
 * from src/content/*.json and is immutable for the life of the process — no game state lives here.
 */
import depotsData from '../content/depots.json';
import goodsData from '../content/goods.json';
import legsData from '../content/legs.json';
import type { Good, GoodId, Depot, DepotId, RoadLeg } from './types';

export const DEPOTS: Depot[] = (depotsData.depots as Depot[]).slice();
export const GOODS: Good[] = (goodsData.goods as Good[]).slice();
export const LEGS: RoadLeg[] = (legsData.legs as RoadLeg[]).slice();

export const DEPOT_BY_ID: Record<DepotId, Depot> = Object.fromEntries(DEPOTS.map(p => [p.id, p]));
export const GOOD_BY_ID: Record<GoodId, Good> = Object.fromEntries(GOODS.map(g => [g.id, g]));

export const HOME_DEPOT: DepotId = (DEPOTS.find(p => p.home) ?? DEPOTS[0]).id;

export const depotName = (id: DepotId): string => DEPOT_BY_ID[id]?.name ?? id;
export const goodName = (id: GoodId): string => GOOD_BY_ID[id]?.name ?? id;

/** Undirected adjacency: depot -> [{ to, distance }]. */
export const ADJACENCY: Record<DepotId, { to: DepotId; distance: number }[]> = (() => {
  const adj: Record<DepotId, { to: DepotId; distance: number }[]> = {};
  for (const p of DEPOTS) adj[p.id] = [];
  for (const leg of LEGS) {
    adj[leg.a].push({ to: leg.b, distance: leg.distance });
    adj[leg.b].push({ to: leg.a, distance: leg.distance });
  }
  return adj;
})();

export function legBetween(a: DepotId, b: DepotId): RoadLeg | undefined {
  return LEGS.find(l => (l.a === a && l.b === b) || (l.a === b && l.b === a));
}

export function legDistance(a: DepotId, b: DepotId): number {
  return legBetween(a, b)?.distance ?? Infinity;
}

export interface Route {
  /** Depots after the origin, in order. The last is the destination. */
  path: DepotId[];
  /** Total drive points. */
  distance: number;
  /** Expected turns, when the route was planned against a season's weather. */
  turns?: number;
}

/** How an edge is costed. Distance is pure geography; turns account for the weather on it. */
export type EdgeCost = (from: DepotId, to: DepotId, distance: number) => number;

const byDistance: EdgeCost = (_from, _to, distance) => distance;

/**
 * Dijkstra over ADJACENCY with a pluggable edge cost. Unlike Niccolo's dispatch, a course here may
 * cross several legs in one plot — a vehicle does not have to stop at every depot — so intermediate
 * depots are drove straight past. To trade somewhere on the way, plot a course to that depot instead.
 *
 * The edge cost is a parameter because of the weather. Costing edges by raw distance makes the
 * geometrically shortest path always the answer, which would leave a fog- or flood-prone leg as
 * nothing but a tax on a route everyone takes anyway. Costing them by expected turns is what lets
 * a risky leg actually get routed around in the season it's worst.
 */
export function searchRoute(from: DepotId, to: DepotId, cost: EdgeCost): Route | null {
  if (from === to) return { path: [], distance: 0 };
  if (!ADJACENCY[from] || !ADJACENCY[to]) return null;

  const score: Record<DepotId, number> = { [from]: 0 };
  const prev: Record<DepotId, DepotId> = {};
  const settled = new Set<DepotId>();

  // Small graph (26 depots) — a linear scan for the next node beats the cost of a heap.
  for (;;) {
    let best: DepotId | null = null;
    let bestCost = Infinity;
    for (const [id, c] of Object.entries(score)) {
      if (!settled.has(id) && c < bestCost) {
        best = id;
        bestCost = c;
      }
    }
    if (best === null) return null;
    if (best === to) break;
    settled.add(best);
    for (const edge of ADJACENCY[best]) {
      const nextCost = bestCost + cost(best, edge.to, edge.distance);
      if (nextCost < (score[edge.to] ?? Infinity)) {
        score[edge.to] = nextCost;
        prev[edge.to] = best;
      }
    }
  }

  const path: DepotId[] = [];
  for (let at: DepotId | undefined = to; at !== undefined && at !== from; at = prev[at]) path.unshift(at);

  // Report the path's real drive-point length whatever it was costed by, so callers always get a
  // number they can compare against a leg distance.
  let distance = 0;
  let cursor = from;
  for (const step of path) {
    distance += legDistance(cursor, step);
    cursor = step;
  }
  return { path, distance };
}

/**
 * The geometrically shortest route, ignoring weather.
 *
 * Still the right answer for anything that should be a stable fact about the world rather than
 * about this month's weather: the contract deck's distance cap, and the depot table's "how far" readout.
 * For actually driving somewhere, see `planFastestRoute` in sim/weather.ts.
 */
export function planRoute(from: DepotId, to: DepotId): Route | null {
  return searchRoute(from, to, byDistance);
}

/** Every pairwise shortest distance, precomputed — the AI scores contracts against this constantly. */
export const DISTANCE_MATRIX: Record<DepotId, Record<DepotId, number>> = (() => {
  const out: Record<DepotId, Record<DepotId, number>> = {};
  for (const from of DEPOTS) {
    out[from.id] = { [from.id]: 0 };
    for (const to of DEPOTS) {
      if (to.id === from.id) continue;
      out[from.id][to.id] = planRoute(from.id, to.id)?.distance ?? Infinity;
    }
  }
  return out;
})();

export const distanceBetween = (a: DepotId, b: DepotId): number => DISTANCE_MATRIX[a]?.[b] ?? Infinity;

export const depotSupplies = (depotId: DepotId, good: GoodId): boolean =>
  DEPOT_BY_ID[depotId]?.supplies.includes(good) ?? false;

export const depotDemands = (depotId: DepotId, good: GoodId): boolean =>
  DEPOT_BY_ID[depotId]?.demands.includes(good) ?? false;

/** Depots that sell `good`, nearest first from `origin`. */
export function sourcesFor(good: GoodId, origin: DepotId): DepotId[] {
  return DEPOTS.filter(p => p.supplies.includes(good))
    .map(p => p.id)
    .sort((a, b) => distanceBetween(origin, a) - distanceBetween(origin, b));
}
