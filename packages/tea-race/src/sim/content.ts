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
}

/**
 * Shortest sea route by sail points (Dijkstra over ADJACENCY). Unlike Niccolo's dispatch, a course
 * here may cross several legs in one plot — a clipper does not have to stop at every island — so
 * intermediate ports are sailed straight past. To trade somewhere on the way, plot a course to
 * that port instead.
 */
export function planRoute(from: PortId, to: PortId): Route | null {
  if (from === to) return { path: [], distance: 0 };
  if (!ADJACENCY[from] || !ADJACENCY[to]) return null;

  const dist: Record<PortId, number> = { [from]: 0 };
  const prev: Record<PortId, PortId> = {};
  const settled = new Set<PortId>();

  // Small graph (26 ports) — a linear scan for the next node beats the cost of a heap.
  for (;;) {
    let best: PortId | null = null;
    let bestCost = Infinity;
    for (const [id, cost] of Object.entries(dist)) {
      if (!settled.has(id) && cost < bestCost) {
        best = id;
        bestCost = cost;
      }
    }
    if (best === null) return null;
    if (best === to) break;
    settled.add(best);
    for (const edge of ADJACENCY[best]) {
      const next = bestCost + edge.distance;
      if (next < (dist[edge.to] ?? Infinity)) {
        dist[edge.to] = next;
        prev[edge.to] = best;
      }
    }
  }

  const path: PortId[] = [];
  for (let at: PortId | undefined = to; at !== undefined && at !== from; at = prev[at]) path.unshift(at);
  return { path, distance: dist[to] };
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
