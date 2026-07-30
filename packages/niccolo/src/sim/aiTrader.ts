import { CITIES, findCity, marketGoodsAt, otherEndOfRoute, planRoute, findRouteById } from './content';
import { adjustScarcity, cargoTotal, priceAt } from './market';
import type { Cargo, MarketScarcity, Vessel } from './types';

/**
 * A real trading opponent — the walking skeleton for free-play mode (see
 * `freeplay-ai-design.md` for the full design and the reasoning behind the difficulty model).
 *
 * Deliberately built as a self-contained module over the *existing* types (`Vessel`, `Cargo`,
 * `MarketScarcity`) with **no changes to `GameState`, `sim/actions.ts` or `sim/state.ts`** — the
 * wiring into a real game mode is a separate, later step. Everything here is a pure function of
 * its inputs, so the whole opponent is testable by a scripted driver with no React, no save
 * format, and no campaign content involved.
 *
 * ## The central design decision: difficulty is information, not cheating
 *
 * An AI trader never sees live prices. It trades off `remembered` — its own cache of what a city's
 * prices were when it last had a report from there — and `reportLagWeeks` controls how stale that
 * cache is allowed to get. A hard opponent has fresher reports and more capital; it never gets
 * hidden knowledge, never ignores travel time, and never trades at a price the player couldn't
 * also get. That makes the opponent an expression of this game's actual subject (information
 * asymmetry, design doc §3) rather than a difficulty slider bolted onto it, and it means a player
 * who invests in couriers is genuinely buying an edge over the AI, not just over the map.
 *
 * An AI's trades move the *same* `MarketScarcity` the player trades against, so competition is
 * felt as prices moving under you — and because `sim/market.ts`'s `deriveMarketCauses` already
 * attributes moves to a named actor, a wired-up AI can be named in the price narration for free.
 */

/** What an AI trader currently believes a city's prices were, and when it learnt that. */
export interface RememberedPrices {
  week: number;
  prices: Record<string, number>;
}

export interface AiTrader {
  id: string;
  name: string;
  cash: number;
  /** Reuses the player's own `Vessel` shape, so movement/capacity/cargo behave identically. */
  vessels: Vessel[];
  /**
   * How many weeks behind live this trader's price knowledge runs — the difficulty dial. 0 would
   * be omniscient (deliberately not used by any shipped profile); higher is a weaker opponent
   * that acts on staler information, exactly as a real distant merchant would.
   */
  reportLagWeeks: number;
  /** Per-city price memory. A city absent from here has never been visited or reported on. */
  remembered: Record<string, RememberedPrices>;
}

export interface AiTraderProfile {
  id: string;
  name: string;
  startingCash: number;
  reportLagWeeks: number;
  homeCity: string;
  shipCapacity: number;
}

/** Three profiles differing only in capital and information quality — never in the rules they play by. */
export const AI_PROFILES: Record<'cautious' | 'steady' | 'ruthless', Omit<AiTraderProfile, 'id' | 'name' | 'homeCity'>> = {
  cautious: { startingCash: 300, reportLagWeeks: 6, shipCapacity: 15 },
  steady: { startingCash: 600, reportLagWeeks: 4, shipCapacity: 20 },
  ruthless: { startingCash: 1200, reportLagWeeks: 2, shipCapacity: 30 },
};

/** Snapshot of one city's live prices, as learnt on arrival or by a report. */
function observe(scarcity: MarketScarcity, cityId: string, week: number): RememberedPrices {
  const prices: Record<string, number> = {};
  for (const goodId of Object.keys(findCity(cityId)?.market ?? {})) {
    const p = priceAt(scarcity, cityId, goodId);
    if (p !== null) prices[goodId] = p;
  }
  return { week, prices };
}

export function createAiTrader(profile: AiTraderProfile): AiTrader {
  return {
    id: profile.id,
    name: profile.name,
    cash: profile.startingCash,
    vessels: [
      {
        id: `${profile.id}_ship`,
        kind: 'ship',
        name: `${profile.name}'s ship`,
        location: profile.homeCity,
        destination: null,
        routeId: null,
        weeksRemaining: 0,
        cargo: {},
        capacity: profile.shipCapacity,
      },
    ],
    reportLagWeeks: profile.reportLagWeeks,
    // Knows its own home market only. Everywhere else must be *reached* before it can be traded
    // against — see `refreshAiKnowledge` for why that restriction is the whole point.
    remembered: {},
  };
}

/**
 * Refreshes what the trader knows, under a strict rule: **it can only learn a market it has
 * actually reached, or one it already has a standing report line to.**
 *
 * A city with a vessel docked in it is learnt exactly (the trader is standing in the market). A
 * city it already knows gets refreshed once its memory is older than `reportLagWeeks` — a report
 * arriving, so its knowledge is never worse than that many weeks stale. A city it has *never
 * visited* is not learnt at all, at any lag.
 *
 * That last clause is load-bearing and was got wrong first time round: refreshing every city whose
 * memory was merely "stale" meant a brand-new trader with empty memory instantly learnt the entire
 * map's live prices, which is precisely the omniscience this model exists to avoid. A scripted
 * driver caught it. Because unknown cities stay unknown, the trader has to *explore* to build a
 * map (see `resolveAiWeek`'s exploration fallback), which is both the honest behaviour and the
 * thing that makes `reportLagWeeks` a real difficulty dial rather than decoration.
 */
export function refreshAiKnowledge(trader: AiTrader, scarcity: MarketScarcity, week: number): AiTrader {
  const remembered = { ...trader.remembered };
  const dockedAt = new Set(trader.vessels.filter(v => !v.destination).map(v => v.location));

  for (const cityId of dockedAt) {
    if (findCity(cityId)?.market) remembered[cityId] = observe(scarcity, cityId, week);
  }
  for (const cityId of Object.keys(remembered)) {
    if (dockedAt.has(cityId)) continue;
    if (week - remembered[cityId].week >= trader.reportLagWeeks) {
      remembered[cityId] = observe(scarcity, cityId, week);
    }
  }
  return { ...trader, remembered };
}

/** Seeds a trader's knowledge of its own home port, so it starts with somewhere to trade from. */
export function seedHomeKnowledge(trader: AiTrader, scarcity: MarketScarcity, week: number): AiTrader {
  const home = trader.vessels[0]?.location;
  if (!home || !findCity(home)?.market) return trader;
  return { ...trader, remembered: { ...trader.remembered, [home]: observe(scarcity, home, week) } };
}

/** What the trader believes `goodId` fetches at `cityId`, or null if it has no knowledge of it. */
function believedPrice(trader: AiTrader, cityId: string, goodId: string): number | null {
  return trader.remembered[cityId]?.prices[goodId] ?? null;
}

export interface AiPlan {
  goodId: string;
  quantity: number;
  /** Where it intends to sell, per its own (possibly stale) beliefs. */
  sellCityId: string;
  /** Believed profit per unit after the trip, ignoring any price movement while sailing. */
  beliefMarginPerUnit: number;
  weeksAway: number;
}

/**
 * Picks the best buy-here-sell-there trade available to a docked vessel, judged purely on what
 * this trader *believes*. Margin is divided by trip length so a fat but slow run doesn't always
 * beat a thin quick one — the same instinct a real factor would apply, and the thing that keeps
 * a low-lag (harder) opponent visibly better at routing than a high-lag one.
 */
export function bestPlanFor(trader: AiTrader, vessel: Vessel): AiPlan | null {
  if (vessel.destination) return null;
  const here = vessel.location;
  const space = vessel.capacity - cargoTotal(vessel.cargo);
  if (space <= 0) return null;

  let best: AiPlan | null = null;
  let bestScore = 0;

  for (const goodId of marketGoodsAt(here)) {
    const buyPrice = believedPrice(trader, here, goodId);
    if (buyPrice === null || buyPrice <= 0) continue;
    const affordable = Math.floor(trader.cash / buyPrice);
    // Capped by what one market can absorb without the sale crashing it — buying more of a single
    // good than that is dead weight, not an advantage. Extra hold space is filled by *diversifying*
    // into other goods the same destination buys (see `resolveAiWeek`), which is what makes a
    // larger ship genuinely better rather than just slower to unload.
    const quantity = Math.min(space, affordable, ABSORBABLE_UNITS);
    if (quantity <= 0) continue;

    for (const city of CITIES) {
      if (city.id === here || !city.market?.[goodId]) continue;
      const sellPrice = believedPrice(trader, city.id, goodId);
      if (sellPrice === null) continue;
      const margin = sellPrice - buyPrice;
      if (margin <= 0) continue;

      const plan = planRoute(here, city.id, false);
      if (!plan) continue;
      const score = (margin * quantity) / Math.max(1, plan.totalWeeks);
      if (score > bestScore) {
        bestScore = score;
        best = { goodId, quantity, sellCityId: city.id, beliefMarginPerUnit: margin, weeksAway: plan.totalWeeks };
      }
    }
  }
  return best;
}

export interface AiTradeNote {
  traderId: string;
  traderName: string;
  cityId: string;
  goodId: string;
  /** +1 bought here, -1 sold here — matches `HouseTradeNote.direction`'s convention. */
  direction: 1 | -1;
  quantity: number;
}

export interface AiWeekResult {
  trader: AiTrader;
  scarcity: MarketScarcity;
  notes: AiTradeNote[];
}

/**
 * One AI trader's whole week: sell what's worth selling here, buy the best run it can see, set
 * sail, and tick any vessel already under way.
 *
 * Its selling calls the same `adjustScarcity` the player's selling does (so an AI dumping a cargo
 * really does depress that market), and its buying deliberately does **not** — preserving exactly
 * the asymmetry `sim/actions.ts`'s `buyGood` established to close the buy/sell round-trip exploit.
 * Keeping the AI on identical price mechanics is what makes it a fair opponent rather than a
 * separate simulation that happens to share a map.
 */
export function resolveAiWeek(trader: AiTrader, scarcity: MarketScarcity, week: number): AiWeekResult {
  let working = refreshAiKnowledge(trader, scarcity, week);
  let nextScarcity = scarcity;
  const notes: AiTradeNote[] = [];
  let cash = working.cash;
  const vessels: Vessel[] = [];

  for (const original of working.vessels) {
    let vessel = original;

    // Under way: just close the distance. Arrival is handled on a later week, exactly like the
    // player's own `tickVessel`, so an arriving vessel always gets a full turn docked first.
    if (vessel.destination) {
      const weeksRemaining = vessel.weeksRemaining - 1;
      vessel =
        weeksRemaining <= 0
          ? { ...vessel, location: vessel.destination, destination: null, routeId: null, weeksRemaining: 0 }
          : { ...vessel, weeksRemaining };
      vessels.push(vessel);
      continue;
    }

    // Docked: sell into this market, but *metered* — see MAX_UNITS_SOLD_PER_WEEK.
    let soldSomething = false;
    for (const goodId of Object.keys(vessel.cargo)) {
      const held = vessel.cargo[goodId] ?? 0;
      if (held <= 0) continue;
      const live = priceAt(nextScarcity, vessel.location, goodId);
      if (live === null) continue;
      const paidBelief = believedPrice(working, vessel.location, goodId);
      // Only sell where this city is (per its beliefs) actually a good market — otherwise hold and
      // keep sailing, or the trader would dump cargo at the first port that merely buys the good.
      const bestElsewhere = bestKnownSellPrice(working, goodId, vessel.location);
      if (bestElsewhere !== null && paidBelief !== null && bestElsewhere > paidBelief * 1.1) continue;

      const qty = Math.min(held, MAX_UNITS_SOLD_PER_WEEK);
      cash += live * qty;
      nextScarcity = adjustScarcity(nextScarcity, vessel.location, goodId, -qty);
      notes.push({
        traderId: working.id,
        traderName: working.name,
        cityId: vessel.location,
        goodId,
        direction: -1,
        quantity: qty,
      });
      vessel = { ...vessel, cargo: { ...vessel.cargo, [goodId]: held - qty } };
      soldSomething = true;
    }

    // Still holding stock this market wants? Stay docked and keep selling it down next week rather
    // than sailing off half-loaded — metering only helps if the trader actually sees it through.
    if (soldSomething && cargoTotal(vessel.cargo) > 0) {
      vessels.push(vessel);
      continue;
    }

    // Then look for the next run.
    const plan = bestPlanFor({ ...working, cash }, vessel);
    if (plan) {
      // Load the chosen good, then fill any remaining hold with *other* goods the same destination
      // also pays a margin on. One good per voyage would leave a large ship permanently
      // under-loaded, since a single market can only absorb `ABSORBABLE_UNITS` before the sale
      // starts crushing its own price — diversifying is what turns capacity into an advantage.
      // Deduped: `marketGoodsAt` also contains `plan.goodId`, and without this the chosen good gets
      // loaded a second time — which piles a single good well past `ABSORBABLE_UNITS` and recreates
      // the exact self-inflicted price crash the cap exists to prevent (driver caught it).
      const loadOrder = [plan.goodId, ...marketGoodsAt(vessel.location).filter(g => g !== plan.goodId)];
      for (const goodId of loadOrder) {
        const space = vessel.capacity - cargoTotal(vessel.cargo);
        if (space <= 0) break;
        if (goodId !== plan.goodId) {
          if ((vessel.cargo[goodId] ?? 0) > 0) continue;
          if (!findCity(plan.sellCityId)?.market?.[goodId]) continue;
          const buyBelief = believedPrice(working, vessel.location, goodId);
          const sellBelief = believedPrice(working, plan.sellCityId, goodId);
          if (buyBelief === null || sellBelief === null || sellBelief <= buyBelief) continue;
        }
        const live = priceAt(nextScarcity, vessel.location, goodId);
        if (live === null || live <= 0) continue;
        const quantity = Math.min(space, Math.floor(cash / live), ABSORBABLE_UNITS);
        if (quantity <= 0) continue;
        cash -= live * quantity;
        vessel = {
          ...vessel,
          cargo: { ...vessel.cargo, [goodId]: (vessel.cargo[goodId] ?? 0) + quantity },
        };
        notes.push({
          traderId: working.id,
          traderName: working.name,
          cityId: vessel.location,
          goodId,
          direction: 1,
          quantity,
        });
      }
      // Set sail toward the intended market, one real leg at a time via the existing route graph.
      const routePlan = planRoute(vessel.location, plan.sellCityId, false);
      if (routePlan && routePlan.routeIds.length > 0) {
        const firstLeg = findRouteById(routePlan.routeIds[0]);
        if (firstLeg) {
          const destination = otherEndOfRoute(firstLeg, vessel.location);
          vessel = {
            ...vessel,
            destination,
            routeId: firstLeg.id,
            weeksRemaining: firstLeg.distanceWeeks,
            plannedRoute: routePlan.routeIds.slice(1),
          };
        }
      }
    } else if (vessel.plannedRoute && vessel.plannedRoute.length > 0) {
      // Nothing worth buying here, but still mid-journey — carry on to the intended market.
      const leg = findRouteById(vessel.plannedRoute[0]);
      if (leg) {
        vessel = {
          ...vessel,
          destination: otherEndOfRoute(leg, vessel.location),
          routeId: leg.id,
          weeksRemaining: leg.distanceWeeks,
          plannedRoute: vessel.plannedRoute.slice(1),
        };
      }
    } else {
      // No known-profitable run and nothing queued: go and *look*. Because unknown cities are
      // genuinely unknown (see `refreshAiKnowledge`), a trader that never explored would sit in its
      // home port forever — exploration is what bootstraps the map it then trades on.
      vessel = sailTowardNearestUnknown(working, vessel);
    }

    vessels.push(vessel);
  }

  working = { ...working, cash, vessels };
  return { trader: working, scarcity: nextScarcity, notes };
}

/**
 * Most units of one good an AI will sell into a single market in a single week.
 *
 * `adjustScarcity` moves a city-good's multiplier by 0.03 per unit against a 0.5 floor, so an
 * unmetered trader emptying a 30-unit hold in one go drives the price straight into that floor and
 * realises a fraction of what it expected — verified by a scripted driver, where it made a
 * *larger* ship strictly worse than a small one and inverted the whole difficulty model. Six units
 * caps the self-inflicted price hit at roughly 18%. It is also simply what a competent factor does:
 * feed a market rather than flood it.
 */
const MAX_UNITS_SOLD_PER_WEEK = 6;

/**
 * Most units of a *single* good worth carrying into one market on one voyage — three weeks of
 * metered selling. Beyond this the trader is just queueing up its own price crash, so hold space is
 * better spent on a different good. Driver-verified: without this cap plus the diversification it
 * enables, a 30-unit ship lost to a 12-unit ship on 9 of 12 seeds, because extra capacity bought
 * nothing but a longer stay in port.
 */
const ABSORBABLE_UNITS = MAX_UNITS_SOLD_PER_WEEK * 3;

/** Sends a vessel toward the closest city this trader has no price knowledge of. */
function sailTowardNearestUnknown(trader: AiTrader, vessel: Vessel): Vessel {
  let bestFirstLegId: string | null = null;
  let bestWeeks = Infinity;
  for (const city of CITIES) {
    if (!city.market || city.id === vessel.location) continue;
    if (trader.remembered[city.id]) continue;
    const plan = planRoute(vessel.location, city.id, false);
    if (!plan || plan.routeIds.length === 0) continue;
    if (plan.totalWeeks < bestWeeks) {
      bestWeeks = plan.totalWeeks;
      bestFirstLegId = plan.routeIds[0];
    }
  }
  if (!bestFirstLegId) return vessel;
  const leg = findRouteById(bestFirstLegId);
  if (!leg) return vessel;
  return {
    ...vessel,
    destination: otherEndOfRoute(leg, vessel.location),
    routeId: leg.id,
    weeksRemaining: leg.distanceWeeks,
  };
}

/** Best price this trader believes it could get for `goodId` anywhere other than `exceptCityId`. */
function bestKnownSellPrice(trader: AiTrader, goodId: string, exceptCityId: string): number | null {
  let best: number | null = null;
  for (const cityId of Object.keys(trader.remembered)) {
    if (cityId === exceptCityId) continue;
    if (!findCity(cityId)?.market?.[goodId]) continue;
    const p = trader.remembered[cityId].prices[goodId];
    if (p === undefined) continue;
    if (best === null || p > best) best = p;
  }
  return best;
}

/** Total florin worth of a trader — cash plus cargo valued at live local prices. The free-play
 * standings figure; see the design doc on why a visible score is right here and wrong in the
 * story campaign. */
export function aiNetWorth(trader: AiTrader, scarcity: MarketScarcity): number {
  let total = trader.cash;
  for (const vessel of trader.vessels) {
    total += cargoValueAt(vessel.cargo, scarcity, vessel.location);
  }
  return Math.round(total);
}

function cargoValueAt(cargo: Cargo, scarcity: MarketScarcity, cityId: string): number {
  let total = 0;
  for (const goodId of Object.keys(cargo)) {
    const qty = cargo[goodId] ?? 0;
    if (qty <= 0) continue;
    const p = priceAt(scarcity, cityId, goodId);
    if (p !== null) total += p * qty;
  }
  return total;
}
