import { CITIES, findCity, marketGoodsAt, otherEndOfRoute, planRoute, findRouteById } from './content';
import { SCARCITY_STEP, adjustScarcity, cargoTotal, priceAt, sellProceeds } from './market';
import { tradeBlockedAt } from './marketEvents';
import { addGrade, gradeBuyMultiplier, gradeHeld, gradeSellMultiplier, isPilotGood, removeGrade } from './grades';
import { findVesselType, resaleValue, vesselSpeed, vesselUpkeep } from './shipyard';
import type {
  ActiveMarketEvent,
  AiTradeNote,
  AiTrader,
  Cargo,
  GradeId,
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
  /**
   * Which entry in `content/vesselTypes.json` this rival sails (Phase 30). Capacity, weekly upkeep
   * and passage time all come from the class, exactly as they do for a hull the player bought — so
   * a rival's hull is not a separate stat block that happens to look similar.
   */
  vesselTypeId: string;
  /**
   * How much shed space this rival leases at each city it trades into (Phase 30). Zero means it does
   * not warehouse at all, which is how the difficulty dial expresses the mechanic: the weakest rival
   * simply has not thought of it.
   */
  warehouseCapacity: number;
}

/**
 * The three profiles. They differ in **capital, information quality, hull class and whether they
 * warehouse** — and in nothing else. Every rule they play by is the player's own.
 *
 * Phase 30 gave the last two of those four. Before it, `shipCapacity` was a bare number on the
 * profile and rivals sailed at a flat speed with no upkeep and no storage: the opponent was playing
 * a strictly simpler game than the player, which the spec permitted only "until those are the
 * player's own settled mechanics". Phases 26 and 28 settled them.
 */
export const AI_PROFILES: Record<'cautious' | 'steady' | 'ruthless', Omit<AiTraderProfile, 'id' | 'name' | 'homeCity'>> = {
  // A cog, no shed, and the staleest reports. Trades the way a rival did before Phase 30.
  cautious: { startingCash: 300, reportLagWeeks: 6, vesselTypeId: 'cog', warehouseCapacity: 0 },
  // A cog and a small shed: it has worked out that landing a hold and sailing on beats sitting in
  // port selling six units a week.
  steady: { startingCash: 600, reportLagWeeks: 4, vesselTypeId: 'cog', warehouseCapacity: 20 },
  // A carrack — slower, but twice the hold, and the sheds to make that hold mean something. The
  // combination is the point: Phase 27 measured that extra hull alone mostly buys time in port, so
  // capacity is only an advantage to a trader that can *put the cargo down*.
  ruthless: { startingCash: 1200, reportLagWeeks: 2, vesselTypeId: 'carrack', warehouseCapacity: 40 },
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
  // Capacity comes from the class rather than being stated twice — a rival's hull is the *same*
  // object as a hull the player bought, so it must be described the same way or the two will drift.
  const type = findVesselType(profile.vesselTypeId);
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
        capacity: type?.capacity ?? 20,
        typeId: profile.vesselTypeId,
      },
    ],
    vesselTypeId: profile.vesselTypeId,
    warehouses: {},
    warehouseCapacity: profile.warehouseCapacity,
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

  // Hull upkeep (Phase 30), drawn from the same `vesselUpkeep` the player's fleet pays and covering
  // the sheds too — see `AiTrader.warehouses` on why rent is folded in here rather than tracked per
  // shed. A rival that cannot pay is laid up exactly as the player's hull is: the class is cleared,
  // so it keeps sailing and carrying at ordinary speed and costs nothing further. That is what stops
  // the carrack profile being a free upgrade — its 40 units of hold cost 8f every week it owns them.
  // Recommission anything mothballed if the whole bill is affordable again, exactly as
  // `resolveWeeklyFleet` does for the player.
  if (working.vessels.some(v => v.laidUp)) {
    const restored = working.vessels.map(v => ({ ...v, laidUp: false }));
    if (restored.reduce((sum, v) => sum + vesselUpkeep(v), 0) <= cash) {
      working = { ...working, vessels: restored };
    }
  }
  const upkeepDue = working.vessels.reduce((sum, v) => sum + vesselUpkeep(v), 0);
  if (upkeepDue > 0) {
    if (upkeepDue <= cash) {
      cash -= upkeepDue;
    } else {
      // Mothballed, not declassed — the same correction the player's fleet got. Clearing the class
      // would have handed a struggling rival a *faster, free* carrack with all forty units of hold,
      // which a live free-play run showed happening to both rivals inside forty weeks.
      working = { ...working, vessels: working.vessels.map(v => ({ ...v, laidUp: true })) };
    }
  }

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

    // Warehousing, half one (Phase 30): standing in a city where it has stock stored, so bring what
    // will fit back aboard before deciding anything. This is what makes a shed useful rather than a
    // hole goods fall into — the trader's whole reason to route back here is sitting in it.
    if ((working.warehouseCapacity ?? 0) > 0) {
      const stored = working.warehouses?.[vessel.location];
      if (stored && cargoTotal(stored) > 0) {
        let room = vessel.capacity - cargoTotal(vessel.cargo);
        let cargo = vessel.cargo;
        const remaining: Cargo = { ...stored };
        for (const goodId of Object.keys(stored)) {
          if (room <= 0) break;
          const units = Math.min(stored[goodId] ?? 0, room);
          if (units <= 0) continue;
          cargo = { ...cargo, [goodId]: (cargo[goodId] ?? 0) + units };
          remaining[goodId] = (remaining[goodId] ?? 0) - units;
          room -= units;
        }
        vessel = { ...vessel, cargo };
        working = { ...working, warehouses: { ...working.warehouses, [vessel.location]: remaining } };
      }
    }

    // A mothballed hull sells what it is carrying but goes nowhere — the same rule
    // `dispatchVessel` applies to the player's. Marked here rather than skipping the vessel
    // entirely, because a rival that could not even unload would be stuck for good.
    const mothballed = !!vessel.laidUp;

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
      // Quality grades (Phase 30), through `sim/grades.ts` — the player's own functions, not a
      // parallel copy. **Which grade goes out matters, and this is the whole point of grades:** at a
      // `qualityMarket` the trader sells its graded lots first, because that is the only place the
      // premium is actually paid; anywhere else it sells `common` first and keeps the fine cloth for
      // a city that wants it. Selling a fine lot at an ordinary port recovers exactly its premium
      // and no more, so doing it in the wrong order is not a loss — it is a wasted opportunity, and
      // an opponent that wasted it would be playing a simpler game than the player.
      const qualityHere = findCity(vessel.location)?.market?.[goodId]?.qualityMarket ?? false;
      const order: GradeId[] = qualityHere
        ? ['excellent', 'fine', 'common']
        : ['common', 'fine', 'excellent'];
      let toSell = qty;
      let revenue = 0;
      let grades = vessel.cargoGrades;
      // Priced through `sellProceeds`, the same function the player's own `sellGood` uses (Phase
      // 26): the market impact is applied across the quantity rather than after it. This was the
      // last place in the codebase still doing snapshot-times-quantity, and leaving it would have
      // handed the AI a systematically better price than the player gets for the identical trade —
      // a cheat, and precisely the kind the difficulty model forbids. It also makes
      // `MAX_UNITS_SOLD_PER_WEEK` mean what its own doc comment claims: the metering now genuinely
      // caps a self-inflicted price hit that the trader really pays.
      const sale = sellProceeds(nextScarcity, vessel.location, goodId, qty, events);
      if (sale === null) continue;
      // `sellProceeds` gives the base take for the quantity; each grade's own multiplier is then
      // applied to its share of it, which is exactly how `sellGood` composes the two.
      const perUnit = sale.revenue / qty;
      for (const grade of order) {
        if (toSell <= 0) break;
        const atGrade = gradeHeld(vessel.cargo, grades, goodId, grade);
        if (atGrade <= 0) continue;
        const take = Math.min(atGrade, toSell);
        revenue += perUnit * take * gradeSellMultiplier(grade, qualityHere);
        grades = removeGrade(grades, goodId, grade, take);
        toSell -= take;
      }
      cash += revenue;
      nextScarcity = sale.scarcity;
      notes.push({
        traderId: working.id,
        traderName: working.name,
        cityId: vessel.location,
        goodId,
        direction: -1,
        quantity: qty,
      });
      vessel = { ...vessel, cargo: { ...vessel.cargo, [goodId]: held - qty }, cargoGrades: grades };
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
      // Warehousing, half two (Phase 30), and the reason a rival wants a shed at all: rather than
      // sit here selling six units a week, land what is left and go and earn with the hull.
      //
      // **This is what finally makes a large hull worth having.** Phase 27 measured that capacity
      // beyond what a market can absorb mostly buys time in port — thirty units at six a week is
      // five weeks alongside while a twelve-unit ship sells out in two and leaves. A shed turns that
      // dead time back into voyages, which is exactly the lever the player got in Phase 26 and the
      // reason the carrack profile is paired with sheds rather than given hold alone.
      const shed = working.warehouseCapacity ?? 0;
      if (shed > 0) {
        const existing = working.warehouses?.[vessel.location] ?? {};
        let room = shed - cargoTotal(existing);
        if (room > 0) {
          let cargo = vessel.cargo;
          const stored: Cargo = { ...existing };
          for (const goodId of Object.keys(vessel.cargo)) {
            if (room <= 0) break;
            const units = Math.min(vessel.cargo[goodId] ?? 0, room);
            if (units <= 0) continue;
            stored[goodId] = (stored[goodId] ?? 0) + units;
            cargo = { ...cargo, [goodId]: (cargo[goodId] ?? 0) - units };
            room -= units;
          }
          // Storing touches no scarcity, in either direction — the same rule the player's own
          // `storeGood` follows, and the rule that keeps buy-store-sell-later from being free money.
          vessel = { ...vessel, cargo };
          working = { ...working, warehouses: { ...working.warehouses, [vessel.location]: stored } };
        }
      }
      if (cargoTotal(vessel.cargo) > 0) {
        const better = sailTowardBestKnownMarket({ ...working, cash }, vessel);
        vessels.push(better ?? vessel);
        continue;
      }
    }

    // Then look for the next run — unless she is mothballed, in which case there is no run to be had.
    const plan = mothballed ? null : bestPlanFor({ ...working, cash }, vessel);
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
        // Quality grades on the buy side (Phase 30). A grade is only ever worth its premium if the
        // *destination* is the city that pays for it — buying fine cloth to sell at an ordinary port
        // recovers exactly the premium and nothing more, so the trader buys up a grade only when it
        // already intends to sell somewhere that wants it. That is precisely the "the only real
        // profit in grade comes from routing it to the city that actually wants it" rule
        // `sim/grades.ts` states, applied by the opponent rather than only available to the player.
        const grade: GradeId =
          isPilotGood(goodId) && (findCity(plan.sellCityId)?.market?.[goodId]?.qualityMarket ?? false)
            ? 'fine'
            : 'common';
        const unitCost = live * gradeBuyMultiplier(grade);
        const quantity = Math.min(space, Math.floor(cash / unitCost), ABSORBABLE_UNITS);
        if (quantity <= 0) continue;
        cash -= unitCost * quantity;
        vessel = {
          ...vessel,
          cargo: { ...vessel.cargo, [goodId]: (vessel.cargo[goodId] ?? 0) + quantity },
          cargoGrades: addGrade(vessel.cargoGrades, goodId, grade, quantity),
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
            weeksRemaining: legWeeks(vessel, firstLeg.distanceWeeks),
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
          weeksRemaining: legWeeks(vessel, leg.distanceWeeks),
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
      if (!mothballed) {
        const relocation = sailTowardBestKnownMarket(working, vessel);
        vessel = relocation ?? sailTowardNearestUnknown(working, vessel);
      }
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

    // Goods the trader has left in a shed there are a reason to go back (Phase 30) — valued at what
    // it believes that market pays, since that is where it chose to land them. Without this the
    // trader would store cargo and then have no notion that it was owed anything, which would make
    // a warehouse a hole rather than a lever.
    let value = 0;
    const stored = trader.warehouses?.[cityId];
    if (stored) {
      for (const goodId of Object.keys(stored)) {
        const units = stored[goodId] ?? 0;
        if (units <= 0) continue;
        const there = trader.remembered[cityId].prices[goodId];
        if (there !== undefined) value += there * units * SALE_IMPACT_FACTOR;
      }
    }
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
    weeksRemaining: legWeeks(vessel, leg.distanceWeeks),
    plannedRoute: plan.routeIds.slice(1),
  };
}


/**
 * How long a leg takes this rival, from its hull's class — the same `vesselSpeed` the player's own
 * `dispatchVessel` applies (Phase 30).
 *
 * Before this, every rival sailed at a flat `distanceWeeks` regardless of hull, which meant the
 * carrack the ruthless profile now sails would have had 40 units of hold and *no* speed penalty for
 * it — a strictly better ship than any the player can buy. Routing it through the same function is
 * what keeps "never trades at a price the player couldn't get" true of time as well as money.
 */
function legWeeks(vessel: Vessel, distanceWeeks: number): number {
  return Math.max(1, Math.ceil(distanceWeeks * vesselSpeed(vessel)));
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
    weeksRemaining: legWeeks(vessel, leg.distanceWeeks),
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
    // Hulls counted the same way the player's are (Phase 28), so neither side of the standings is
    // measured on a different balance sheet. A rival's hull is untyped, so this is the cog's resale
    // value — which is exactly what an untyped player hull is worth too.
    total += resaleValue(vessel);
  }
  // Goods left in a shed (Phase 30) count exactly as the player's warehoused goods do in
  // `playerNetWorth`. Without this a rival that had just landed forty units would read as poorer for
  // having done the clever thing, and the standings would be comparing two different balance sheets
  // — the specific asymmetry Phase 28 had to fix for hulls.
  for (const [cityId, cargo] of Object.entries(trader.warehouses ?? {})) {
    total += cargoValueAt(cargo, scarcity, cityId, events);
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
