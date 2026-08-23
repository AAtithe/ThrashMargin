import { CITIES, findCity, marketGoodsAt, otherEndOfRoute, planRoute, findRouteById } from './content';
import { SCARCITY_STEP, adjustScarcity, cargoTotal, priceAt, sellProceeds } from './market';
import { tradeBlockedAt } from './marketEvents';
import type {
  ActiveMarketEvent,
  AiTradeNote,
  AiTrader,
  Cargo,
  MarketScarcity,
  RememberedPrices,
  Vessel,
} from './types';

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

/**
 * Snapshot of one city's live prices, as learnt on arrival or by a report.
 *
 * `events` is the Phase 23 demand layer, and passing it is not optional in spirit even though the
 * parameter is: `priceAt` without it returns `base × scarcity` and omits `× demand`, so a trader
 * reading prices that way would remember — and trade on — numbers **no player can ever transact
 * at**. The design's whole claim about this opponent is that it "never trades at a price the player
 * couldn't also get"; that claim is only true if demand is threaded all the way down. The demand
 * layer's own doc comment flagged `aiTrader.ts` as the one deliberate omission, to be closed when
 * the trader was wired into a game mode. This is that closing.
 *
 * A good currently under a `guild_embargo` is omitted from memory entirely rather than remembered
 * at a price it cannot be bought or sold at — so the trader routes around a closed market, which is
 * what a merchant does, instead of planning voyages into one.
 */
function observe(
  scarcity: MarketScarcity,
  cityId: string,
  week: number,
  events?: ActiveMarketEvent[],
): RememberedPrices {
  const prices: Record<string, number> = {};
  for (const goodId of Object.keys(findCity(cityId)?.market ?? {})) {
    if (tradeBlockedAt(events, cityId, goodId)) continue;
    const p = priceAt(scarcity, cityId, goodId, events);
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
export function refreshAiKnowledge(
  trader: AiTrader,
  scarcity: MarketScarcity,
  week: number,
  events?: ActiveMarketEvent[],
): AiTrader {
  const remembered = { ...trader.remembered };
  const dockedAt = new Set(trader.vessels.filter(v => !v.destination).map(v => v.location));

  for (const cityId of dockedAt) {
    if (findCity(cityId)?.market) remembered[cityId] = observe(scarcity, cityId, week, events);
  }
  for (const cityId of Object.keys(remembered)) {
    if (dockedAt.has(cityId)) continue;
    if (week - remembered[cityId].week >= trader.reportLagWeeks) {
      remembered[cityId] = observe(scarcity, cityId, week, events);
    }
  }
  return { ...trader, remembered };
}

/** Seeds a trader's knowledge of its own home port, so it starts with somewhere to trade from. */
export function seedHomeKnowledge(
  trader: AiTrader,
  scarcity: MarketScarcity,
  week: number,
  events?: ActiveMarketEvent[],
): AiTrader {
  const home = trader.vessels[0]?.location;
  if (!home || !findCity(home)?.market) return trader;
  return { ...trader, remembered: { ...trader.remembered, [home]: observe(scarcity, home, week, events) } };
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
      // Judged on what the sale will actually realise, not on the standing price — see
      // `SALE_IMPACT_FACTOR`. A margin that only exists before the trader's own selling moves the
      // market is not a margin.
      const margin = sellPrice * SALE_IMPACT_FACTOR - buyPrice;
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
export function resolveAiWeek(
  trader: AiTrader,
  scarcity: MarketScarcity,
  week: number,
  events?: ActiveMarketEvent[],
): AiWeekResult {
  let working = refreshAiKnowledge(trader, scarcity, week, events);
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
      // An embargoed market is closed to the trader exactly as it is closed to the player — the
      // same `tradeBlockedAt` gate `buyGood`/`sellGood` apply. Without this the AI would quietly
      // trade through an event whose entire purpose is to stop trade.
      if (tradeBlockedAt(events, vessel.location, goodId)) continue;
      const live = priceAt(nextScarcity, vessel.location, goodId, events);
      if (live === null) continue;
      const paidBelief = believedPrice(working, vessel.location, goodId);
      // Only sell where this city is (per its beliefs) actually a good market — otherwise hold and
      // keep sailing, or the trader would dump cargo at the first port that merely buys the good.
      const bestElsewhere = bestKnownSellPrice(working, goodId, vessel.location);
      if (bestElsewhere !== null && paidBelief !== null && bestElsewhere > paidBelief * 1.1) continue;

      const qty = Math.min(held, MAX_UNITS_SOLD_PER_WEEK);
      // Priced through `sellProceeds`, the same function the player's own `sellGood` uses (Phase
      // 26): the market impact is applied across the quantity rather than after it. This was the
      // last place in the codebase still doing snapshot-times-quantity, and leaving it would have
      // handed the AI a systematically better price than the player gets for the identical trade —
      // a cheat, and precisely the kind the difficulty model forbids. It also makes
      // `MAX_UNITS_SOLD_PER_WEEK` mean what its own doc comment claims: the metering now genuinely
      // caps a self-inflicted price hit that the trader really pays.
      const sale = sellProceeds(nextScarcity, vessel.location, goodId, qty, events);
      if (sale === null) continue;
      cash += sale.revenue;
      nextScarcity = sale.scarcity;
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

    // Still holding stock after selling into this market? Stay and keep metering it down — *unless*
    // there is a market it knows is materially better for what is left, in which case go there.
    //
    // Both halves are load-bearing, and the driver measured the cost of getting either wrong. An
    // unconditional stay makes metering work but turns a large hull into a liability: thirty units
    // at six a week is five weeks in port while a twelve-unit ship sells out in two and moves on, so
    // a *bigger ship lost to a smaller one on 18 of 24 seeds*. Leaving unconditionally fixes that
    // (24/24) but re-breaks the information model, because a well-informed trader keeps abandoning
    // half-sold cargo — fresher information then won only 1 seed in 24.
    //
    // The condition is `sailTowardBestKnownMarket` returning something, deliberately reusing that
    // one judgement rather than inventing a second threshold beside it: "is anywhere better than
    // here" is a question already answered in exactly one place.
    if (soldSomething && cargoTotal(vessel.cargo) > 0) {
      const better = sailTowardBestKnownMarket({ ...working, cash }, vessel);
      vessels.push(better ?? vessel);
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
        if (tradeBlockedAt(events, vessel.location, goodId)) continue;
        const live = priceAt(nextScarcity, vessel.location, goodId, events);
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
      // No profitable run to be had *here*. Two things to try, in order, and never idling — an idle
      // hull is the one thing a factor is certainly wrong to be.
      //
      // **This ordering is the fix for an inversion the Phase 27 driver measured**, and it is worth
      // recording because it was the opposite of what it looked like. With only exploration as a
      // fallback, a trader that already knew every nearby market and had just crushed the price at
      // its own port would find no positive margin and simply *sit*. A well-informed trader sees
      // that crash accurately and stops; an ignorant one still believes the old price, sails, and
      // trades anyway. So **staler information won 23 of 24 seeds** — not because ignorance is an
      // edge, but because accuracy was being punished with idleness. Relocating toward a market it
      // *knows* is better is what turns knowing into an advantage.
      const relocation = sailTowardBestKnownMarket(working, vessel);
      vessel = relocation ?? sailTowardNearestUnknown(working, vessel);
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
 * The haircut a trader applies to a believed sell price when *planning*, to account for the market
 * impact of its own selling.
 *
 * Phase 26 made a sale's price decline across the quantity sold rather than after it, and Phase 27
 * put the AI on that same function. That immediately exposed a modelling gap the old snapshot
 * pricing had hidden: `bestPlanFor` scored a run as `(believedSellPrice - buyPrice) × quantity`, a
 * flat price it could no longer actually realise. So thin-margin runs became quietly loss-making,
 * and — the part that inverted the whole difficulty model — a *sharper-informed* trader sees more
 * of those thin opportunities and therefore over-trades on them. A driver comparison had the
 * low-lag trader selling 344 units to the high-lag trader's 264 and ending up poorer.
 *
 * Selling is metered at `MAX_UNITS_SOLD_PER_WEEK`, and each unit within a batch moves the price by
 * `SCARCITY_STEP`, so the average unit in a batch realises about `1 - step × (n-1)/2` of the
 * standing price. That is an estimate the trader is entitled to: it is derived from its own known
 * selling behaviour and a published constant, not from any live price it has not earned.
 */
const SALE_IMPACT_FACTOR = 1 - (SCARCITY_STEP * (MAX_UNITS_SOLD_PER_WEEK - 1)) / 2;

/**
 * Most units of a *single* good worth carrying into one market on one voyage — three weeks of
 * metered selling. Beyond this the trader is just queueing up its own price crash, so hold space is
 * better spent on a different good. Driver-verified: without this cap plus the diversification it
 * enables, a 30-unit ship lost to a 12-unit ship on 9 of 12 seeds, because extra capacity bought
 * nothing but a longer stay in port.
 */
const ABSORBABLE_UNITS = MAX_UNITS_SOLD_PER_WEEK * 3;


/**
 * Sends a vessel toward the *known* market it has most reason to be at, or null if there is nothing
 * better than staying put. Purely belief-driven — no live price is read, so this buys the trader
 * nothing it has not earned by having been there or having a report.
 *
 * Carrying cargo: the best market it believes exists for the good it holds most of. Empty: the
 * market whose own goods it believes carry the best onward margin, which is the same judgement
 * `bestPlanFor` makes, evaluated one port ahead.
 *
 * Scored per week of sailing, exactly as `bestPlanFor` scores, so a fat distant market does not
 * always beat a decent near one.
 */
function sailTowardBestKnownMarket(trader: AiTrader, vessel: Vessel): Vessel | null {
  const here = vessel.location;
  const held = Object.entries(vessel.cargo)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];

  let bestCityId: string | null = null;
  let bestScore = 0;

  for (const cityId of Object.keys(trader.remembered)) {
    if (cityId === here) continue;
    const plan = planRoute(here, cityId, false);
    if (!plan || plan.routeIds.length === 0) continue;
    const weeks = Math.max(1, plan.totalWeeks);

    let value = 0;
    if (held) {
      const [goodId, units] = held;
      const there = trader.remembered[cityId].prices[goodId];
      const hereBelief = believedPrice(trader, here, goodId);
      if (there === undefined) continue;
      // Only worth the voyage if that market is believed to beat this one for what we hold.
      if (hereBelief !== null && there <= hereBelief) continue;
      value = (there - (hereBelief ?? 0)) * (units ?? 0);
    } else {
      // Empty hold: go where the *next* run looks best, judged on beliefs alone.
      for (const goodId of Object.keys(trader.remembered[cityId].prices)) {
        const buyThere = trader.remembered[cityId].prices[goodId];
        if (buyThere <= 0) continue;
        const onward = bestKnownSellPrice(trader, goodId, cityId);
        if (onward === null) continue;
        const margin = onward * SALE_IMPACT_FACTOR - buyThere;
        if (margin <= 0) continue;
        const quantity = Math.min(vessel.capacity, Math.floor(trader.cash / buyThere), ABSORBABLE_UNITS);
        value = Math.max(value, margin * quantity);
      }
    }

    const score = value / weeks;
    if (score > bestScore) {
      bestScore = score;
      bestCityId = cityId;
    }
  }

  if (!bestCityId) return null;
  const plan = planRoute(here, bestCityId, false);
  if (!plan || plan.routeIds.length === 0) return null;
  const leg = findRouteById(plan.routeIds[0]);
  if (!leg) return null;
  return {
    ...vessel,
    destination: otherEndOfRoute(leg, here),
    routeId: leg.id,
    weeksRemaining: leg.distanceWeeks,
    plannedRoute: plan.routeIds.slice(1),
  };
}

/** Sends a vessel toward the closest city this trader has no price knowledge of. */
/**
 * Furthest a trader will sail purely to *look* at a market it has never seen.
 *
 * Exploration is the last resort in `resolveAiWeek` (after trading here, and after relocating to a
 * market it already knows is better), so in practice it fires when a trader has run out of ideas.
 * A cap keeps that from becoming a twelve-week voyage to Timbuktu on a whim: measured, it changes
 * almost nothing about outcomes, which is exactly why the cheap sane bound is the right default.
 */
const MAX_EXPLORE_WEEKS = 8;
function sailTowardNearestUnknown(trader: AiTrader, vessel: Vessel): Vessel {
  let bestFirstLegId: string | null = null;
  let bestWeeks = Infinity;
  for (const city of CITIES) {
    if (!city.market || city.id === vessel.location) continue;
    if (trader.remembered[city.id]) continue;
    const plan = planRoute(vessel.location, city.id, false);
    if (!plan || plan.routeIds.length === 0) continue;
    if (plan.totalWeeks > MAX_EXPLORE_WEEKS) continue;
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
export function aiNetWorth(trader: AiTrader, scarcity: MarketScarcity, events?: ActiveMarketEvent[]): number {
  let total = trader.cash;
  for (const vessel of trader.vessels) {
    total += cargoValueAt(vessel.cargo, scarcity, vessel.location, events);
  }
  return Math.round(total);
}

function cargoValueAt(cargo: Cargo, scarcity: MarketScarcity, cityId: string, events?: ActiveMarketEvent[]): number {
  let total = 0;
  for (const goodId of Object.keys(cargo)) {
    const qty = cargo[goodId] ?? 0;
    if (qty <= 0) continue;
    const p = priceAt(scarcity, cityId, goodId, events);
    if (p !== null) total += p * qty;
  }
  return total;
}
