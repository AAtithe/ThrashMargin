import { CITIES, findCity } from './content';
import { demandFactor } from './marketEvents';
import type { ActiveMarketEvent, AiTradeNote, HouseTradeNote, MarketScarcity, PriceCauseKind, PriceCauseNote } from './types';

/** How sharply one unit traded moves the local price. */
/** How far one traded unit moves a city-good's scarcity multiplier. Exported since Phase 27 so
 * `sim/aiTrader.ts` can price its *own* expected market impact from the same constant rather than
 * hard-coding a second copy of it — see `SALE_IMPACT_FACTOR` there. */
export const SCARCITY_STEP = 0.03;
const SCARCITY_MIN = 0.5;
const SCARCITY_MAX = 2;
/** Fraction of the gap back to 1.0 (base price) that closes each week. Tuned so a full dump's
 * price crash mostly recovers within about a month (1 - 0.7^4 ≈ 76% closed after 4 weeks) rather
 * than the old 0.1 rate's ~34% — the previous rate left a depressed/inflated price sitting still
 * for a long time, which is part of what made the buy/sell round-trip exploit (see actions.ts's
 * buyGood — buying no longer moves scarcity at all, precisely to close that loop) worth repeating
 * instead of a one-off. */
const DRIFT_RATE = 0.3;

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

/**
 * Current price of a good at a city, or null if that city has no market for it.
 *
 * `base × scarcity × demand` (Phase 23). `events` is optional and defaults to no demand at all, so
 * every pre-existing call site kept working unchanged — but **any path a price is actually shown or
 * transacted at must pass it**, or the player will be quoted one number and charged another. The
 * paths that do: buying and selling (`actions.ts`), the market and city panels, report generation
 * (`news.ts`), insurance coverage (`insurance.ts`) and forced liquidation (`credit.ts`). The one
 * deliberate omission is `sim/aiTrader.ts`, which is not wired into any game mode yet — see
 * `finishing-the-campaign-plan.md`; whoever wires it must thread demand through `resolveAiWeek`
 * too, or the opponent will trade on prices nobody else has.
 */
export function priceAt(
  scarcity: MarketScarcity,
  cityId: string,
  goodId: string,
  events?: ActiveMarketEvent[],
): number | null {
  const base = findCity(cityId)?.market?.[goodId]?.base;
  if (base === undefined) return null;
  const multiplier = scarcity[cityId]?.[goodId] ?? 1;
  return Math.round(base * multiplier * demandFactor(events, cityId, goodId));
}

/** A positive `quantityBought` raises the local price, negative depresses it — generic in
 * direction since this is shared by the player's own selling (`sim/actions.ts`'s `sellGood`,
 * always negative), forced liquidation (`sim/credit.ts`, always negative), and an AI house's own
 * weekly trade footprint (`sim/houses.ts`, either sign). The player's own *buying* deliberately
 * does not call this at all (see `buyGood`'s own comment) — only selling moves price from the
 * player's side, to close a same-city buy-then-sell round-trip exploit. */
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

/**
 * What a sale of `quantity` units actually fetches, and the scarcity it leaves behind.
 *
 * **Why this exists (Phase 26).** `sellGood` used to read one price and multiply it by the whole
 * quantity, then depress scarcity afterwards. That is the *same* mistake `buyGood`'s own comment
 * records fixing on the buy side — a single pre-trade snapshot priced against a quantity large
 * enough to move the market — and on the sell side it had two consequences that were exactly
 * backwards from the design's intent:
 *
 *   - **Dumping a full hold was free.** Sixteen units all sold at the untouched base price; the
 *     crash only ever landed on the *next* sale. The warehousing spec's whole premise (store the
 *     cargo, meter the sale out, don't be forced to dump) was therefore worthless — metering
 *     returned to the florin exactly what dumping did, which is how the Phase 26 driver found this.
 *   - **Splitting a sale was punished.** Two sales of eight in one week fetched 24f then 18f, while
 *     one sale of sixteen fetched 24f throughout. The player was rewarded for issuing one big order
 *     and penalised for the identical trade expressed in two — a pure artefact of where the
 *     snapshot was taken.
 *
 * So the impact is applied *as the units go out*: each unit sells at the price standing when it is
 * sold, and drives the next one down. A large sale now gets a declining average, splitting a sale
 * within a week is exactly neutral, and waiting for `driftScarcity` to recover between batches is
 * what actually earns more — which is precisely the lever a warehouse is for.
 *
 * Walked unit by unit rather than solved in closed form on purpose: `adjustScarcity` owns the curve
 * (including its clamps), and a closed form would be a second, silently divergent copy of it.
 * Quantities here are bounded by a hull or a shed, so this is tens of iterations, not thousands.
 *
 * Deliberately NOT used by `credit.ts`'s forced liquidation, which keeps its own snapshot-plus-
 * haircut pricing: there the quantity is chosen by the engine to cover a shortfall rather than by
 * the player, so there is no dump-vs-meter decision to get wrong and nothing to exploit.
 */
export function sellProceeds(
  scarcity: MarketScarcity,
  cityId: string,
  goodId: string,
  quantity: number,
  events?: ActiveMarketEvent[],
): { revenue: number; scarcity: MarketScarcity } | null {
  if (priceAt(scarcity, cityId, goodId, events) === null) return null;
  let working = scarcity;
  let revenue = 0;
  for (let i = 0; i < quantity; i++) {
    revenue += priceAt(working, cityId, goodId, events)!;
    working = adjustScarcity(working, cityId, goodId, -1);
  }
  return { revenue, scarcity: working };
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

/** A move must clear both an absolute (1 florin) and a relative (5% of the pre-week price) floor
 * to count as notable. A bare "the rounded integer changed at all" gate turned out, verified by a
 * scripted check, to fire on a large majority of city-good pairs most weeks — `BACKGROUND_FLOW_MAX`
 * alone (an 8% multiplier swing) rounds to a different integer on most typical base prices, so
 * "silence is the common case" didn't actually hold without this second, relative floor. */
const NOTABILITY_FRACTION = 0.05;

/**
 * Explains why each city-good's *displayed* price actually changed this week (Phase 16) — gated
 * on the rounded integer `priceAt` value clearing `NOTABILITY_FRACTION`, not any raw multiplier
 * change, so a small drift stays silent; most goods most weeks stay under that floor and get no
 * note at all, which is the deliberately common case, not a bug. `before` is the scarcity at the
 * very start of the week's resolution (`sim/actions.ts`'s `advanceWeek`, prior to background
 * flow/drift/house footprint); `afterBackground`/`afterDrift` are its own two intermediate stages;
 * `final` is the scarcity after the house-trade footprint has also applied (what the player
 * actually sees).
 *
 * A house trade on the exact city+good takes priority whenever its own direction agrees with the
 * net observed move — it's the most specific, nameable cause available. Otherwise, whichever of
 * background flow or drift contributed the larger raw magnitude decides between 'unknown_flows'
 * (unseen trade) and 'settling' (reverting toward base) — an approximation, not a perfect
 * attribution, since the two stages can partly offset each other; good enough for flavor text
 * that's never used to make a mechanical decision.
 *
 * Deliberately does **not** take market events: demand is identical across all four scarcity stages
 * it compares, so it would cancel out of every delta and contribute nothing. A price move caused by
 * an event starting or ending is narrated by `resolveWeeklyMarketEvents` instead, which is the only
 * place that knows an event changed at all.
 */
export function deriveMarketCauses(
  before: MarketScarcity,
  afterBackground: MarketScarcity,
  afterDrift: MarketScarcity,
  final: MarketScarcity,
  houseTrades: HouseTradeNote[],
  /** Free-play rivals' actual trades this week (Phase 27). A rival's buying and selling really move
   * `scarcity`, so without this they would be derived as anonymous "unknown flows" — the player
   * would see the price move and never learn they were bidding against somebody. Optional, so the
   * campaign's own call site is unchanged. */
  rivalTrades: AiTradeNote[] = [],
): Record<string, PriceCauseNote[]> {
  const houseTradeByKey = new Map<string, HouseTradeNote>();
  for (const trade of houseTrades) houseTradeByKey.set(`${trade.cityId}:${trade.goodId}`, trade);
  // A rival outranks a house footprint at the same city-good: the house is a reduced-fidelity
  // scarcity nudge, the rival is a hull that really arrived and really traded. If both moved the
  // same price the same way, the real one is the truer explanation.
  const rivalTradeByKey = new Map<string, AiTradeNote>();
  for (const trade of rivalTrades) rivalTradeByKey.set(`${trade.cityId}:${trade.goodId}`, trade);

  const out: Record<string, PriceCauseNote[]> = {};
  for (const cityId of Object.keys(final)) {
    const city = findCity(cityId);
    if (!city?.market) continue;
    for (const goodId of Object.keys(city.market)) {
      const priceBefore = priceAt(before, cityId, goodId);
      const priceFinal = priceAt(final, cityId, goodId);
      if (priceBefore === null || priceFinal === null || priceBefore === priceFinal) continue;
      const delta = Math.abs(priceFinal - priceBefore);
      if (delta < 1 || delta < priceBefore * NOTABILITY_FRACTION) continue;
      const direction: 1 | -1 = priceFinal > priceBefore ? 1 : -1;

      const rivalTrade = rivalTradeByKey.get(`${cityId}:${goodId}`);
      const houseTrade = houseTradeByKey.get(`${cityId}:${goodId}`);
      let note: PriceCauseNote;
      if (rivalTrade && rivalTrade.direction === direction) {
        note = { goodId, kind: 'rival_trade', direction, houseName: rivalTrade.traderName };
      } else if (houseTrade && houseTrade.direction === direction) {
        note = { goodId, kind: 'house_trade', direction, houseName: houseTrade.houseName };
      } else {
        const backgroundDelta = Math.abs((afterBackground[cityId]?.[goodId] ?? 1) - (before[cityId]?.[goodId] ?? 1));
        const driftDelta = Math.abs((afterDrift[cityId]?.[goodId] ?? 1) - (afterBackground[cityId]?.[goodId] ?? 1));
        const kind: PriceCauseKind = driftDelta > backgroundDelta ? 'settling' : 'unknown_flows';
        note = { goodId, kind, direction };
      }

      (out[cityId] ??= []).push(note);
    }
  }
  return out;
}
