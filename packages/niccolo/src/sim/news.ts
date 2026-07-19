import { CITIES, HOME_CITY, ROUTES, marketGoodsAt } from './content';
import { investigateLatencyBonus } from './characters';
import { priceAt } from './market';
import type { Character, CourierInvestment, MarketScarcity, NewsItem } from './types';

/** A report can never arrive faster than this, however much courier investment is put in — someone still has to carry it. */
const MIN_LATENCY = 1;

export const COURIER_INVESTMENT_BASE_COST = 15;

/**
 * Shortest correspondence time in weeks from the home city to `toId`, over every route
 * (land or sea — a letter travels on whatever ship or rider is already making the crossing).
 * Dijkstra over a graph small enough (12 nodes) that a simple linear scan per step is fine.
 */
function shortestReportWeeks(toId: string): number {
  if (toId === HOME_CITY) return 0;
  const dist = new Map<string, number>([[HOME_CITY, 0]]);
  const unvisited = new Set(CITIES.map(c => c.id));

  while (unvisited.size > 0) {
    let current: string | null = null;
    let currentDist = Infinity;
    for (const id of unvisited) {
      const d = dist.get(id) ?? Infinity;
      if (d < currentDist) {
        current = id;
        currentDist = d;
      }
    }
    if (current === null) break;
    unvisited.delete(current);

    for (const route of ROUTES) {
      const neighbour =
        route.from === current ? route.to : route.to === current ? route.from : null;
      if (!neighbour || !unvisited.has(neighbour)) continue;
      const candidate = currentDist + route.distanceWeeks;
      if (candidate < (dist.get(neighbour) ?? Infinity)) {
        dist.set(neighbour, candidate);
      }
    }
  }

  return dist.get(toId) ?? Infinity;
}

const BASE_LATENCY: Record<string, number> = {};
for (const city of CITIES) {
  BASE_LATENCY[city.id] = shortestReportWeeks(city.id);
}

export function baseLatencyFor(cityId: string): number {
  return BASE_LATENCY[cityId] ?? Infinity;
}

/** Weeks a report from `cityId` currently takes to reach the player, after courier investment
 * and any officer investigating there (the two stack — money and skill both buy speed). */
export function currentLatencyFor(
  cityId: string,
  courierInvestment: CourierInvestment,
  characters: Character[] = [],
): number {
  if (cityId === HOME_CITY) return 0;
  const base = baseLatencyFor(cityId);
  if (!Number.isFinite(base)) return Infinity;
  const reduction = (courierInvestment[cityId] ?? 0) + investigateLatencyBonus(characters, cityId);
  return Math.max(MIN_LATENCY, base - reduction);
}

/** Cost in florins of the next courier investment level for a city. */
export function courierInvestmentCost(cityId: string, courierInvestment: CourierInvestment): number {
  const level = courierInvestment[cityId] ?? 0;
  return COURIER_INVESTMENT_BASE_COST * (level + 1);
}

/** Whether spending more on this city's courier line would still shorten its latency. */
export function canInvestFurther(
  cityId: string,
  courierInvestment: CourierInvestment,
  characters: Character[] = [],
): boolean {
  if (cityId === HOME_CITY) return false;
  return currentLatencyFor(cityId, courierInvestment, characters) > MIN_LATENCY;
}

/** Snapshot every city's true prices this week and schedule their arrival. */
export function generateNews(
  scarcity: MarketScarcity,
  week: number,
  courierInvestment: CourierInvestment,
  characters: Character[] = [],
): NewsItem[] {
  return CITIES.filter(c => c.market).map(c => {
    const prices: Record<string, number> = {};
    for (const goodId of marketGoodsAt(c.id)) {
      prices[goodId] = priceAt(scarcity, c.id, goodId) ?? 0;
    }
    return {
      cityId: c.id,
      trueAsOfWeek: week,
      receivedOnWeek: week + currentLatencyFor(c.id, courierInvestment, characters),
      prices,
    };
  });
}

/** Split a pending-news queue into what has arrived by `week` and what is still in transit. */
export function resolveArrivals(
  pending: NewsItem[],
  week: number,
): { arrived: NewsItem[]; stillPending: NewsItem[] } {
  const arrived = pending.filter(n => n.receivedOnWeek <= week);
  const stillPending = pending.filter(n => n.receivedOnWeek > week);
  return { arrived, stillPending };
}
