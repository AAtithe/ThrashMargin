/**
 * What a lot actually costs on a given quay.
 *
 * Until now every good had one price everywhere, so the card's "£45 a lot" was both the reckoning
 * and the till. Once prices vary by port those come apart, and the order matters:
 *
 *   **The card's price is the reckoning. The quay's price is what you pay.**
 *
 * A delivery pays 4x or 2x the *card's* stated price per unit; buying below it is the profit and
 * buying above it is the cost of convenience. Getting this the wrong way round inverts the whole
 * game — with payout computed from what you paid, the cheapest port would earn you the least and the
 * correct play would be to always buy at the dearest quay, which is nonsense. It reads as a
 * faithfulness question ("four times the purchase price") but with a single global price the two
 * readings are numerically identical, so nothing published is contradicted; the card's figure is
 * simply the one that was always meant.
 *
 * AUTHORED. Nothing is hand-authored per port: the factors fall out of the content, so adding a port
 * or a good needs no price table maintained alongside it.
 */

import { GOODS, GOOD_BY_ID, PORTS, PORT_BY_ID } from './content';
import type { GoodId, PortId } from './types';

/**
 * What a quay pays for cargo sold off the ship, as a fraction of its own asking price.
 *
 * Well under 1 in both cases, and deliberately: the faithful rule is that unwanted cargo goes over
 * the side for nothing, and this is the toggleable mercy on top of it, not a way to trade profitably
 * without ever landing a commission. Selling at a port that deals in the good still loses you money
 * against what you paid; it just does not lose you all of it.
 */
export const QUAYSIDE_TRADED = 0.65;
export const QUAYSIDE_UNTRADED = 0.35;

/** The band a quay's price can fall in, as a multiple of the card's reckoned price. */
export const PRICE_FLOOR = 0.78;
export const PRICE_CEILING = 1.22;

/** How much of the spread the entrepôt discount accounts for, the rest being local conditions. */
const ENTREPOT_WEIGHT = 0.35;

/** Median number of goods a port supplies — the line the entrepôt discount is measured from. */
const MEDIAN_SUPPLY = (() => {
  const counts = PORTS.map(p => p.supplies.length).sort((a, b) => a - b);
  return counts[Math.floor(counts.length / 2)] || 1;
})();

const MAX_SUPPLY = Math.max(...PORTS.map(p => p.supplies.length), 1);

/**
 * A stable value in [0, 1) for a port-and-good pair. Not `Math.random` and not seeded off the game:
 * a quay's standing price must be the same in every game and on every client, or two players
 * looking at the same port table would disagree about what a lot costs.
 */
function localConditions(portId: PortId, good: GoodId): number {
  let h = 2166136261;
  const text = `${portId}:${good}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * What a lot of `good` costs at `portId`, in whole pounds.
 *
 * Two forces, both derived:
 *
 *  - **Volume.** A port that ships a great many goods is a place trade passes through, and it prices
 *    accordingly. Singapore is cheap because everything comes past it.
 *  - **Local conditions.** A fixed per-quay idiosyncrasy, so two entrepôts of equal size are still
 *    worth choosing between and the port table is worth reading rather than deducing.
 */
export function priceAt(portId: PortId, good: GoodId): number {
  const base = GOOD_BY_ID[good]?.basePrice;
  if (base === undefined) return 0;
  const port = PORT_BY_ID[portId];
  if (!port) return base;

  const spread = PRICE_CEILING - PRICE_FLOOR;

  // Volume: more goods shipped than the median means a discount, fewer means a premium.
  const reach = (port.supplies.length - MEDIAN_SUPPLY) / Math.max(1, MAX_SUPPLY - MEDIAN_SUPPLY);
  const volume = -Math.max(-1, Math.min(1, reach)) * spread * ENTREPOT_WEIGHT * 0.5;

  // Local conditions: the rest of the spread, centred on the reckoned price.
  const local = (localConditions(portId, good) - 0.5) * spread * (1 - ENTREPOT_WEIGHT);

  const factor = Math.max(PRICE_FLOOR, Math.min(PRICE_CEILING, 1 + volume + local));
  return Math.max(1, Math.round(base * factor));
}

/**
 * What a quay will pay for a lot already in the hold — a merchant's price, not a contract's.
 *
 * Two rates, and the gap between them is the whole decision. A port that **deals** in the good has a
 * real buyer for it and pays a solid fraction of its local price; anywhere else you are selling to
 * whoever will take it, at a fraction of that again. So offloading badly-judged cargo is a routing
 * problem — run it somewhere that wants it, or take what you can get here.
 *
 * Never more than the local price, so this can never be arbitraged against `priceAt` by buying and
 * selling on the same quay.
 */
export function quaysidePrice(portId: PortId, good: GoodId): number {
  const base = GOOD_BY_ID[good]?.basePrice ?? 0;
  const port = PORT_BY_ID[portId];
  if (!port || base <= 0) return 0;

  // A quay that deals in the good has a real market, so it quotes off its own local price. One that
  // does not has no market to quote — it is a distress sale to whoever is standing there, priced
  // flat against the card's reckoning.
  //
  // Quoting *both* off `priceAt` was the first version and it inverted the decision the mechanic
  // exists for: `priceAt` hands a notional price to any port for any good, and a port that ships
  // almost nothing carries a scarcity premium, so Callao paid 43 for tea against Foochow's 40 —
  // more, for a good it has no buyer for at all. Because the local price never falls below 0.78 of
  // the reckoning, 0.65 x local is always above 0.35 x base, so a dealing quay now always pays
  // better. That is the property the test holds down.
  if (port.demands.includes(good) || port.supplies.includes(good)) {
    return Math.max(1, Math.floor(priceAt(portId, good) * QUAYSIDE_TRADED));
  }
  return Math.max(1, Math.floor(base * QUAYSIDE_UNTRADED));
}

/** Ports selling this good, cheapest first. Ties broken by id so the order is stable. */
export const cheapestSources = (good: GoodId): PortId[] =>
  PORTS.filter(p => p.supplies.includes(good))
    .map(p => p.id)
    .sort((a, b) => priceAt(a, good) - priceAt(b, good) || a.localeCompare(b));

/** How this quay's price compares with the card's reckoning, for the UI to colour. */
export function priceStanding(portId: PortId, good: GoodId): 'cheap' | 'dear' | 'level' {
  const base = GOOD_BY_ID[good]?.basePrice ?? 0;
  const here = priceAt(portId, good);
  if (here < base) return 'cheap';
  if (here > base) return 'dear';
  return 'level';
}

/** The spread actually present in the content, for the harness to assert the band is real. */
export function observedSpread(): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const good of GOODS) {
    for (const port of PORTS) {
      if (!port.supplies.includes(good.id)) continue;
      const ratio = priceAt(port.id, good.id) / good.basePrice;
      min = Math.min(min, ratio);
      max = Math.max(max, ratio);
    }
  }
  return { min, max };
}

// ---------------------------------------------------------------------------
// Agent-aware prices
// ---------------------------------------------------------------------------
//
// The reducer buys and sells through these rather than through `priceAt` and `quaysidePrice`
// directly, so a port agent's discount applies everywhere money changes hands without any of the
// call sites needing to know agents exist. The bare functions above stay honest about the *market*
// price, which is what the port table and the AI's route scoring want.

import { AGENT_LADING_DISCOUNT, AGENT_SALE_UPLIFT, hasAgent } from './agents';
import type { GameState } from './types';

/** What this captain actually pays for a lot here. */
export function ladingPrice(
  state: GameState,
  captainId: string,
  port: PortId,
  good: GoodId,
): number {
  const market = priceAt(port, good);
  if (!hasAgent(state, captainId, port)) return market;
  return Math.max(1, Math.round(market * (1 - AGENT_LADING_DISCOUNT)));
}

/** What this captain actually gets for selling a lot off here. */
export function saleProceeds(
  state: GameState,
  captainId: string,
  port: PortId,
  good: GoodId,
): number {
  const market = quaysidePrice(port, good);
  if (!hasAgent(state, captainId, port)) return market;
  // Capped at the market asking price, so an agent can never make buy-and-sell-on-the-spot pay.
  return Math.max(1, Math.min(priceAt(port, good) - 1, Math.round(market * (1 + AGENT_SALE_UPLIFT))));
}
