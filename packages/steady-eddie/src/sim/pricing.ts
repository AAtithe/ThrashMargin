/**
 * What a lot actually costs on a given depot.
 *
 * Until now every good had one price everywhere, so the card's "£45 a lot" was both the reckoning
 * and the till. Once prices vary by depot those come apart, and the order matters:
 *
 *   **The card's price is the reckoning. The depot's price is what you pay.**
 *
 * A delivery pays 4x or 2x the *card's* stated price per unit; buying below it is the profit and
 * buying above it is the cost of convenience. Getting this the wrong way round inverts the whole
 * game — with payout computed from what you paid, the cheapest depot would earn you the least and the
 * correct play would be to always buy at the dearest depot, which is nonsense. It reads as a
 * faithfulness question ("four times the purchase price") but with a single global price the two
 * readings are numerically identical, so nothing published is contradicted; the card's figure is
 * simply the one that was always meant.
 *
 * AUTHORED. Nothing is hand-authored per depot: the factors fall out of the content, so adding a depot
 * or a good needs no price table maintained alongside it.
 */

import { GOODS, GOOD_BY_ID, DEPOTS, DEPOT_BY_ID } from './content';
import type { GoodId, DepotId } from './types';

/**
 * What a depot pays for cargo sold off the vehicle, as a fraction of its own asking price.
 *
 * Well under 1 in both cases, and deliberately: the faithful rule is that unwanted cargo goes over
 * the side for nothing, and this is the toggleable mercy on top of it, not a way to trade profitably
 * without ever landing a commission. Selling at a depot that deals in the good still loses you money
 * against what you paid; it just does not lose you all of it.
 */
export const DEPOT_SALE_TRADED = 0.65;
export const DEPOT_SALE_UNTRADED = 0.35;

/** The band a depot's price can fall in, as a multiple of the card's reckoned price. */
export const PRICE_FLOOR = 0.78;
export const PRICE_CEILING = 1.22;

/** How much of the spread the entrepôt discount accounts for, the rest being local conditions. */
const ENTREPOT_WEIGHT = 0.35;

/** Median number of goods a depot supplies — the line the entrepôt discount is measured from. */
const MEDIAN_SUPPLY = (() => {
  const counts = DEPOTS.map(p => p.supplies.length).sort((a, b) => a - b);
  return counts[Math.floor(counts.length / 2)] || 1;
})();

const MAX_SUPPLY = Math.max(...DEPOTS.map(p => p.supplies.length), 1);

/**
 * A stable value in [0, 1) for a depot-and-good pair. Not `Math.random` and not seeded off the game:
 * a depot's standing price must be the same in every game and on every client, or two players
 * looking at the same depot table would disagree about what a lot costs.
 */
function localConditions(depotId: DepotId, good: GoodId): number {
  let h = 2166136261;
  const text = `${depotId}:${good}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * What a lot of `good` costs at `depotId`, in whole pounds.
 *
 * Two forces, both derived:
 *
 *  - **Volume.** A depot that vehicles a great many goods is a place trade passes through, and it prices
 *    accordingly. Singapore is cheap because everything comes past it.
 *  - **Local conditions.** A fixed per-depot idiosyncrasy, so two entrepôts of equal size are still
 *    worth choosing between and the depot table is worth reading rather than deducing.
 */
export function priceAt(depotId: DepotId, good: GoodId): number {
  const base = GOOD_BY_ID[good]?.basePrice;
  if (base === undefined) return 0;
  const depot = DEPOT_BY_ID[depotId];
  if (!depot) return base;

  const spread = PRICE_CEILING - PRICE_FLOOR;

  // Volume: more goods shipped than the median means a discount, fewer means a premium.
  const reach = (depot.supplies.length - MEDIAN_SUPPLY) / Math.max(1, MAX_SUPPLY - MEDIAN_SUPPLY);
  const volume = -Math.max(-1, Math.min(1, reach)) * spread * ENTREPOT_WEIGHT * 0.5;

  // Local conditions: the rest of the spread, centred on the reckoned price.
  const local = (localConditions(depotId, good) - 0.5) * spread * (1 - ENTREPOT_WEIGHT);

  const factor = Math.max(PRICE_FLOOR, Math.min(PRICE_CEILING, 1 + volume + local));
  return Math.max(1, Math.round(base * factor));
}

/**
 * What a depot will pay for a lot already in the hold — a merchant's price, not a contract's.
 *
 * Two rates, and the gap between them is the whole decision. A depot that **deals** in the good has a
 * real buyer for it and pays a solid fraction of its local price; anywhere else you are selling to
 * whoever will take it, at a fraction of that again. So offloading badly-judged cargo is a routing
 * problem — run it somewhere that wants it, or take what you can get here.
 *
 * Never more than the local price, so this can never be arbitraged against `priceAt` by buying and
 * selling on the same depot.
 */
export function depotSalePrice(depotId: DepotId, good: GoodId): number {
  const base = GOOD_BY_ID[good]?.basePrice ?? 0;
  const depot = DEPOT_BY_ID[depotId];
  if (!depot || base <= 0) return 0;

  // A depot that deals in the good has a real market, so it quotes off its own local price. One that
  // does not has no market to quote — it is a distress sale to whoever is standing there, priced
  // flat against the card's reckoning.
  //
  // Quoting *both* off `priceAt` was the first version and it inverted the decision the mechanic
  // exists for: `priceAt` hands a notional price to any depot for any good, and a depot that vehicles
  // almost nothing carries a scarcity premium, so Callao paid 43 for tea against Foochow's 40 —
  // more, for a good it has no buyer for at all. Because the local price never falls below 0.78 of
  // the reckoning, 0.65 x local is always above 0.35 x base, so a dealing depot now always pays
  // better. That is the property the test holds down.
  if (depot.demands.includes(good) || depot.supplies.includes(good)) {
    return Math.max(1, Math.floor(priceAt(depotId, good) * DEPOT_SALE_TRADED));
  }
  return Math.max(1, Math.floor(base * DEPOT_SALE_UNTRADED));
}

/** Depots selling this good, cheapest first. Ties broken by id so the order is stable. */
export const cheapestSources = (good: GoodId): DepotId[] =>
  DEPOTS.filter(p => p.supplies.includes(good))
    .map(p => p.id)
    .sort((a, b) => priceAt(a, good) - priceAt(b, good) || a.localeCompare(b));

/** How this depot's price compares with the card's reckoning, for the UI to colour. */
export function priceStanding(depotId: DepotId, good: GoodId): 'cheap' | 'dear' | 'level' {
  const base = GOOD_BY_ID[good]?.basePrice ?? 0;
  const here = priceAt(depotId, good);
  if (here < base) return 'cheap';
  if (here > base) return 'dear';
  return 'level';
}

/** The spread actually present in the content, for the harness to assert the band is real. */
export function observedSpread(): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const good of GOODS) {
    for (const depot of DEPOTS) {
      if (!depot.supplies.includes(good.id)) continue;
      const ratio = priceAt(depot.id, good.id) / good.basePrice;
      min = Math.min(min, ratio);
      max = Math.max(max, ratio);
    }
  }
  return { min, max };
}
