/**
 * Voyage mode — free play on a living market.
 *
 * `GameState.rules` has carried a documented `'voyage'` reason to exist since the first session. This
 * is it, and it is worth being exact about what it is and is not.
 *
 * §7 of the design document specs a full Niccolò-style continuous simulation: weeks instead of dice,
 * courier-latency news, a rewritten AI. That is a second game and it is not what this is. What this
 * is, is the part the owner asked for — **free play** — built on the machinery that already exists:
 *
 *  - **No commissions.** The card deck goes away entirely. You buy at one port's price and sell at
 *    another's, and the spread is the whole of your profit. Sourcing and routing are the game.
 *  - **A market that moves.** Every port's price for every good drifts, and responds to what is
 *    actually bought and sold there. Land four lots of tea at London and London's tea price sags;
 *    leave a port alone and it recovers. This is the piece classic mode does not have — there,
 *    `priceAt` is fixed for the whole game.
 *  - **No declaration, no share majority, no endgame race.** Free play means free play: it runs
 *    until the season count is up, and the largest fortune wins. Nothing to declare and nothing to
 *    lose by trading on.
 *
 * What it reuses unchanged: ports, goods, legs, the chart, movement and the dice, weather, piracy,
 * wages, loans, agents, the exchange, the save layer. What it deliberately does not touch: the
 * classic endgame, which took a great deal of work to make resolve exactly once and has no business
 * being near a mode with no declaration in it.
 */

import { GOOD_BY_ID, GOODS, PORTS, PORT_BY_ID } from './content';
import { priceAt } from './pricing';
import type { GameState, GoodId, PortId } from './types';

/** How many rounds a free-play game runs before the reckoning. */
export const VOYAGE_ROUNDS = 120;

/**
 * How far a port's price may wander from its standing price.
 *
 * Bounded on purpose. An unbounded random walk eventually makes one port absurd, and "absurd" in a
 * trading game means a single correct answer for the rest of the session.
 */
export const VOYAGE_FLOOR = 0.55;
export const VOYAGE_CEILING = 1.7;

/** How hard one lot bought or sold moves that port's price for that good. */
export const VOYAGE_IMPACT = 0.035;
/** How much of the gap back to the standing price closes each round. */
export const VOYAGE_RECOVERY = 0.18;

/**
 * The structural spread that makes trade possible at all: a port that produces a good sells it below
 * the reckoning, and a port that wants it pays above.
 *
 * This was missing from the first cut and free play simply did not work without it. `priceAt` gives
 * every port a price within ±22% of the reckoning regardless of whether it grows the stuff or craves
 * it, so buying and selling were the same number give or take noise — captains sailed 20 times per
 * trade hunting a margin that was not there, and finished a 120-round season *poorer* than they
 * started (median £258 against £600 of starting capital). Producing ports being cheap and consuming
 * ports being dear is not a balance knob, it is what trading is.
 */
export const VOYAGE_SUPPLY_DISCOUNT = 0.8;
export const VOYAGE_DEMAND_PREMIUM = 1.4;

/** Key for the drift table. Flat string keys keep the save small and JSON-friendly. */
export const driftKey = (port: PortId, good: GoodId): string => `${port}|${good}`;

/**
 * A port's live price, standing price adjusted by however the market has been pushed.
 *
 * Drift is stored as a multiplier rather than an absolute, so it survives any retune of the
 * underlying price model without becoming nonsense.
 */
export function livePrice(state: GameState, port: PortId, good: GoodId): number {
  const standing = priceAt(port, good);
  if (state.rules !== 'voyage') return standing;

  const p = PORT_BY_ID[port];
  // A producing port is cheap and a consuming port is dear. A port that is both — and several are —
  // takes the discount, because that is where the stuff comes from.
  const structural = p?.supplies.includes(good)
    ? VOYAGE_SUPPLY_DISCOUNT
    : p?.demands.includes(good)
      ? VOYAGE_DEMAND_PREMIUM
      : 1;

  const drift = state.priceDrift?.[driftKey(port, good)] ?? 1;
  return Math.max(1, Math.round(standing * structural * drift));
}

/** What a port pays for a lot landed there. Only ports that deal in the good will buy at all. */
export function sellsFor(state: GameState, port: PortId, good: GoodId): number | null {
  const p = PORT_BY_ID[port];
  if (!p) return null;
  if (!p.demands.includes(good)) return null;
  return livePrice(state, port, good);
}

/** Ports that will buy this good, best price first — the free-play equivalent of reading the board. */
export function buyersFor(state: GameState, good: GoodId): { port: PortId; price: number }[] {
  return PORTS.filter(p => p.demands.includes(good))
    .map(p => ({ port: p.id, price: livePrice(state, p.id, good) }))
    .sort((a, b) => b.price - a.price || a.port.localeCompare(b.port));
}

/**
 * Pushes a port's price after trade. Buying lifts it, selling into it depresses it.
 *
 * This is the feedback loop that makes the market worth watching, and the reason a rival landing 400
 * chests of tea ahead of you actually costs you something — which §7 named as the whole point of the
 * mode.
 */
export function applyTrade(
  state: GameState,
  port: PortId,
  good: GoodId,
  lots: number,
  direction: 'bought' | 'sold',
): GameState {
  if (state.rules !== 'voyage' || lots === 0) return state;
  const key = driftKey(port, good);
  const current = state.priceDrift?.[key] ?? 1;
  const push = lots * VOYAGE_IMPACT * (direction === 'bought' ? 1 : -1);
  const next = Math.max(VOYAGE_FLOOR, Math.min(VOYAGE_CEILING, current + push));
  return { ...state, priceDrift: { ...(state.priceDrift ?? {}), [key]: next } };
}

/**
 * Lets every pushed price ease back towards its standing value. Called once a round.
 *
 * Only touches keys that have actually moved, so the drift table stays as small as the trade that
 * created it rather than growing to every port-and-good pair on the chart.
 */
export function recoverPrices(state: GameState): GameState {
  if (state.rules !== 'voyage') return state;
  const drift = state.priceDrift;
  if (!drift) return state;

  const next: Record<string, number> = {};
  for (const [key, value] of Object.entries(drift)) {
    const eased = value + (1 - value) * VOYAGE_RECOVERY;
    // Drop it once it is back to standing, so the table self-cleans.
    if (Math.abs(eased - 1) > 0.01) next[key] = Math.round(eased * 1000) / 1000;
  }
  return { ...state, priceDrift: next };
}

/**
 * The best spread on the board right now: buy here, sell there, this much a lot.
 *
 * Shared by the UI and the computer captains deliberately — the AI reasons about exactly the
 * information the player can see, so a human is never beaten by something they could not have looked
 * up.
 */
export interface Spread {
  good: GoodId;
  from: PortId;
  to: PortId;
  buy: number;
  sell: number;
  margin: number;
}

export function bestSpreads(state: GameState, from: PortId | null, limit = 6): Spread[] {
  const out: Spread[] = [];
  for (const good of GOODS) {
    const sources = from
      ? PORT_BY_ID[from]?.supplies.includes(good.id)
        ? [from]
        : []
      : PORTS.filter(p => p.supplies.includes(good.id)).map(p => p.id);
    for (const source of sources) {
      const buy = livePrice(state, source, good.id);
      for (const buyer of buyersFor(state, good.id)) {
        if (buyer.port === source) continue;
        out.push({
          good: good.id,
          from: source,
          to: buyer.port,
          buy,
          sell: buyer.price,
          margin: buyer.price - buy,
        });
      }
    }
  }
  return out
    .sort((a, b) => b.margin - a.margin || a.good.localeCompare(b.good))
    .slice(0, limit);
}

/** Rounds left before the reckoning. */
export const roundsLeft = (state: GameState): number =>
  Math.max(0, VOYAGE_ROUNDS - state.round + 1);

/** Free play has no declaration; the largest fortune at the close takes it. */
export const isVoyageOver = (state: GameState): boolean =>
  state.rules === 'voyage' && state.round > VOYAGE_ROUNDS;

export const goodName = (id: GoodId): string => GOOD_BY_ID[id]?.name ?? id;
