import { CITIES, findCity } from './content';
import type { MarketScarcity } from './types';

/** How sharply one unit traded moves the local price. */
const SCARCITY_STEP = 0.03;
const SCARCITY_MIN = 0.5;
const SCARCITY_MAX = 2;
/** Fraction of the gap back to 1.0 (base price) that closes each week. */
const DRIFT_RATE = 0.1;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function initialScarcity(): MarketScarcity {
  const out: MarketScarcity = {};
  for (const city of CITIES) {
    if (!city.market) continue;
    out[city.id] = {};
    for (const goodId of Object.keys(city.market)) {
      out[city.id][goodId] = 1;
    }
  }
  return out;
}

/** Current price of a good at a city, or null if that city has no market for it. */
export function priceAt(scarcity: MarketScarcity, cityId: string, goodId: string): number | null {
  const base = findCity(cityId)?.market?.[goodId]?.base;
  if (base === undefined) return null;
  const multiplier = scarcity[cityId]?.[goodId] ?? 1;
  return Math.round(base * multiplier);
}

/** Buying `quantity` units depletes local supply and raises the price; selling does the reverse. */
export function adjustScarcity(
  scarcity: MarketScarcity,
  cityId: string,
  goodId: string,
  quantityBought: number,
): MarketScarcity {
  const current = scarcity[cityId]?.[goodId] ?? 1;
  const next = clamp(current + quantityBought * SCARCITY_STEP, SCARCITY_MIN, SCARCITY_MAX);
  return {
    ...scarcity,
    [cityId]: { ...scarcity[cityId], [goodId]: next },
  };
}

/** Each week, every price drifts back a step toward its base (1.0 multiplier). */
export function driftScarcity(scarcity: MarketScarcity): MarketScarcity {
  const next: MarketScarcity = {};
  for (const cityId of Object.keys(scarcity)) {
    next[cityId] = {};
    for (const goodId of Object.keys(scarcity[cityId])) {
      const s = scarcity[cityId][goodId];
      next[cityId][goodId] = s + (1 - s) * DRIFT_RATE;
    }
  }
  return next;
}

/** Largest random nudge background trade flows can apply to one city-good's scarcity in a week. */
const BACKGROUND_FLOW_MAX = 0.08;

/**
 * Supply and demand the player never sees directly: other merchants trading the same goods
 * elsewhere on the map. This is why a stale report can lie — nothing else in the sim moves
 * prices except the player's own trades, so without this a report would always still be true
 * by the time it arrived.
 */
export function applyBackgroundFlows(scarcity: MarketScarcity): MarketScarcity {
  const next: MarketScarcity = {};
  for (const cityId of Object.keys(scarcity)) {
    next[cityId] = {};
    for (const goodId of Object.keys(scarcity[cityId])) {
      const delta = (Math.random() * 2 - 1) * BACKGROUND_FLOW_MAX;
      next[cityId][goodId] = clamp(scarcity[cityId][goodId] + delta, SCARCITY_MIN, SCARCITY_MAX);
    }
  }
  return next;
}

export function cargoTotal(cargo: Record<string, number>): number {
  return Object.values(cargo).reduce((sum, qty) => sum + qty, 0);
}
