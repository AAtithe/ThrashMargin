/**
 * Static content plus the derived route graph. Everything here is computed once at module load
 * from src/content/*.json and is immutable for the life of the process — no game state lives here.
 */
import portsData from '../content/ports.json';
import goodsData from '../content/goods.json';
import legsData from '../content/legs.json';
import type { Good, GoodId, Port, PortId, SeaLeg } from './types';

export const PORTS: Port[] = (portsData.ports as Port[]).slice();
export const GOODS: Good[] = (goodsData.goods as Good[]).slice();
export const LEGS: SeaLeg[] = (legsData.legs as SeaLeg[]).slice();

export const PORT_BY_ID: Record<PortId, Port> = Object.fromEntries(PORTS.map(p => [p.id, p]));
export const GOOD_BY_ID: Record<GoodId, Good> = Object.fromEntries(GOODS.map(g => [g.id, g]));

export const HOME_PORT: PortId = (PORTS.find(p => p.home) ?? PORTS[0]).id;

export const portName = (id: PortId): string => PORT_BY_ID[id]?.name ?? id;
export const goodName = (id: GoodId): string => GOOD_BY_ID[id]?.name ?? id;

/** Undirected adjacency: port -> [{ to, distance }]. */
export const ADJACENCY: Record<PortId, { to: PortId; distance: number }[]> = (() => {
  const adj: Record<PortId, { to: PortId; distance: number }[]> = {};
  for (const p of PORTS) adj[p.id] = [];
  for (const leg of LEGS) {
    adj[leg.a].push({ to: leg.b, distance: leg.distance });
    adj[leg.b].push({ to: leg.a, distance: leg.distance });
  }
  return adj;
})();

export function legBetween(a: PortId, b: PortId): SeaLeg | undefined {
  return LEGS.find(l => (l.a === a && l.b === b) || (l.a === b && l.b === a));
}

export function legDistance(a: PortId, b: PortId): number {
  return legBetween(a, b)?.distance ?? Infinity;
}

export interface Route {
  /** Ports after the origin, in order. The last is the destination. */
  path: PortId[];
  /** Total sail points. */
  distance: number;
  /** Expected turns, when the route was planned against a season's wind. */
  turns?: number;
}

/** How an edge is costed. Distance is pure geography; turns account for the wind on it. */
export type EdgeCost = (from: PortId, to: PortId, distance: number) => number;

const byDistance: EdgeCost = (_from, _to, distance) => distance;

/**
 * Dijkstra over ADJACENCY with a pluggable edge cost. Unlike Niccolo's dispatch, a course here may
 * cross several legs in one plot — a clipper does not have to stop at every island — so intermediate
 * ports are sailed straight past. To trade somewhere on the way, plot a course to that port instead.
 *
 * The edge cost is a parameter because of the wind. Costing edges by raw distance makes the
 * geometrically shortest path always the answer, which would leave directional wind as nothing but
 * a tax on a route everyone takes anyway. Costing them by expected turns is what lets the homeward
 * passage legitimately differ from the outbound one.
 */
export function searchRoute(from: PortId, to: PortId, cost: EdgeCost): Route | null {
  if (from === to) return { path: [], distance: 0 };
  if (!ADJACENCY[from] || !ADJACENCY[to]) return null;

  const score: Record<PortId, number> = { [from]: 0 };
  const prev: Record<PortId, PortId> = {};
  const settled = new Set<PortId>();

  // Small graph (26 ports) — a linear scan for the next node beats the cost of a heap.
  for (;;) {
    let best: PortId | null = null;
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

  const path: PortId[] = [];
  for (let at: PortId | undefined = to; at !== undefined && at !== from; at = prev[at]) path.unshift(at);

  // Report the path's real sail-point length whatever it was costed by, so callers always get a
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
 * about this month's wind: the contract deck's distance cap, and the port table's "how far" readout.
 * For actually sailing somewhere, see `planFastestRoute` in sim/weather.ts.
 */
export function planRoute(from: PortId, to: PortId): Route | null {
  return searchRoute(from, to, byDistance);
}

/** Every pairwise shortest distance, precomputed — the AI scores contracts against this constantly. */
export const DISTANCE_MATRIX: Record<PortId, Record<PortId, number>> = (() => {
  const out: Record<PortId, Record<PortId, number>> = {};
  for (const from of PORTS) {
    out[from.id] = { [from.id]: 0 };
    for (const to of PORTS) {
      if (to.id === from.id) continue;
      out[from.id][to.id] = planRoute(from.id, to.id)?.distance ?? Infinity;
    }
  }
  return out;
})();

export const distanceBetween = (a: PortId, b: PortId): number => DISTANCE_MATRIX[a]?.[b] ?? Infinity;

export const portSupplies = (portId: PortId, good: GoodId): boolean =>
  PORT_BY_ID[portId]?.supplies.includes(good) ?? false;

export const portDemands = (portId: PortId, good: GoodId): boolean =>
  PORT_BY_ID[portId]?.demands.includes(good) ?? false;

/** Ports that sell `good`, nearest first from `origin`. */
export function sourcesFor(good: GoodId, origin: PortId): PortId[] {
  return PORTS.filter(p => p.supplies.includes(good))
    .map(p => p.id)
    .sort((a, b) => distanceBetween(origin, a) - distanceBetween(origin, b));
}
