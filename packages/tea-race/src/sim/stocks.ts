/**
 * The shipping exchange — companies whose shares move with the trade actually flowing through their
 * waters.
 *
 * **Not a second victory condition.** The ten shares of the player's own company remain the only way
 * to win, at the owner's direction. These are investments: somewhere for money to go besides hulls
 * and shares, and a market to read rather than a counter to fill. That separation is deliberate and
 * load-bearing — the endgame took a great deal of work to make resolve exactly once, and a second
 * majority race would put all of it back in play.
 *
 * Prices move off **what captains actually land**, not off a random walk. Every delivery into a
 * company's region is trade passing through its hands, so a run of tea into London lifts the Eastern
 * line and a quiet season lets it drift back. That makes the market a readable consequence of play:
 * if you can see where the cards are sending everyone, you can see which stock is about to move.
 */

import { PORT_BY_ID } from './content';
import type { PortId } from './types';

export type StockId = 'eastern' | 'pacific' | 'atlantic';

export interface Company {
  id: StockId;
  name: string;
  blurb: string;
  /** Port regions whose trade this company is exposed to. */
  regions: string[];
  /** The price it drifts back towards, and where it opens. */
  base: number;
}

export const COMPANIES: Record<StockId, Company> = {
  eastern: {
    id: 'eastern',
    name: 'Eastern & Oriental',
    blurb: 'Tea, silk and opium. Moves with the China and India runs.',
    regions: ['far_east', 'east_indies', 'indian_ocean'],
    base: 100,
  },
  pacific: {
    id: 'pacific',
    name: 'Pacific Union',
    blurb: 'The long Pacific and the southern colonies.',
    regions: ['pacific_america', 'australasia', 'south_america'],
    base: 80,
  },
  atlantic: {
    id: 'atlantic',
    name: 'Atlantic & Western',
    blurb: 'The short, busy runs — home waters, the Americas, the Cape.',
    regions: ['britain', 'europe', 'north_america', 'caribbean', 'africa'],
    base: 90,
  },
};

export const STOCK_IDS = Object.keys(COMPANIES) as StockId[];

/** How hard one lot of trade above or below expectation moves a price. */
export const STOCK_TRADE_SENSITIVITY = 6;

/**
 * The volume a company needs each round merely to hold its price.
 *
 * Without this the market only ever goes up. Volume is never negative, so a price could rise on
 * trade and drift back towards base, but never *below* it — which meant nothing was ever cheap,
 * "buy low" could not fire, and across 20 games the computer captains made exactly zero trades. A
 * price has to be able to disappoint.
 *
 * Set near the real per-company, per-round delivery rate, so an ordinary season holds a price steady
 * and it is a busy or a dead one that moves it.
 */
export const STOCK_EXPECTED_VOLUME = 0.35;
/**
 * How much of the gap to its base a price closes each round.
 *
 * Together with the sensitivity above this sets how wide the market swings, and the first pair were
 * too timid to be worth trading: sensitivity 0.9 against a drift of 0.12 gave a trough of 0.93 of
 * base across 20 games, so nothing was ever cheap and the computer captains made literally zero
 * trades in any game. A market nobody trades is a decoration.
 *
 * At 6 against 0.08 a dead season settles around three quarters of base and a busy one runs well
 * above it, which is a swing worth having an opinion about.
 */
export const STOCK_DRIFT = 0.08;
/** Prices are bounded, so a runaway feedback loop cannot make a stock worthless or infinite. */
export const STOCK_FLOOR = 0.4;
export const STOCK_CEILING = 2.6;

/** Which company, if any, a port's trade flows through. */
export function companyForPort(portId: PortId): StockId | null {
  const region = PORT_BY_ID[portId]?.region;
  if (!region) return null;
  for (const id of STOCK_IDS) {
    if (COMPANIES[id].regions.includes(region)) return id;
  }
  return null;
}

/**
 * The new price after a round, given the trade that landed in this company's waters.
 *
 * Two forces pulling against each other: trade above the expected rate lifts the price and trade
 * below it drags the price down, while mean reversion pulls gently back towards base either way. The
 * reversion is what stops a good early run from making one stock permanently correct, so holding is
 * a decision with a wrong answer and not just a matter of buying whatever went up.
 *
 * `volume` is measured in lots landed, so it is on the order of 0-6 in a busy round and 0 in a dead
 * one — and a dead one has to cost the price something, or nothing is ever worth buying.
 */
export function nextPrice(price: number, base: number, volume: number): number {
  const lifted = price + (volume - STOCK_EXPECTED_VOLUME) * STOCK_TRADE_SENSITIVITY;
  const reverted = lifted + (base - lifted) * STOCK_DRIFT;
  return Math.max(
    Math.round(base * STOCK_FLOOR),
    Math.min(Math.round(base * STOCK_CEILING), Math.round(reverted)),
  );
}

/** Opening prices, at each company's base. */
export const openingPrices = (): Record<StockId, number> =>
  Object.fromEntries(STOCK_IDS.map(id => [id, COMPANIES[id].base])) as Record<StockId, number>;

/** What a holding is worth right now. */
export function holdingsValue(
  holdings: Partial<Record<StockId, number>> | undefined,
  prices: Partial<Record<StockId, number>> | undefined,
): number {
  if (!holdings) return 0;
  let total = 0;
  for (const id of STOCK_IDS) {
    total += (holdings[id] ?? 0) * (prices?.[id] ?? COMPANIES[id].base);
  }
  return total;
}

/** How far a price sits from its base, for the UI to show a trend rather than a bare number. */
export const standing = (price: number, base: number): 'high' | 'low' | 'level' =>
  price > base * 1.08 ? 'high' : price < base * 0.92 ? 'low' : 'level';
