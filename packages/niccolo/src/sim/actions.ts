import { advanceWeek as advanceWeekCounter } from './clock';
import { HOME_CITY, ROUTES, findCity, findRoute, findRouteById, otherEndOfRoute } from './content';
import { assignCharacter, resolveWeeklyUpkeep, tradeBonus } from './characters';
import { resolveWeeklyCondotta } from './condotta';
import { discountObligation, resolveMaturingObligations, takeDeposit, writeBill, writeLoan } from './credit';
import { driftExchangeRates } from './currency';
import { establishEstate, harvestEstate, resolveWeeklyEstate, shipEstateGoods } from './estates';
import { checkTriggers, resolveEvent } from './events';
import { resolveWeeklyExpedition } from './expedition';
import {
  applyHouseTradeFootprint,
  corruptNews,
  driftHouseRelations,
  placeAgent,
  resolveHouseSabotage,
  resolveWeeklyAgentIntelligence,
} from './houses';
import { canInsureAt, clearArrivedInsurance, quoteInsurance, resolveVoyageRisk } from './insurance';
import { addGrade, gradeBuyMultiplier, gradeHeld, gradeSellMultiplier, reconcileVesselCargoGrades, removeGrade } from './grades';
import { adjustScarcity, applyBackgroundFlows, cargoTotal, deriveMarketCauses, driftScarcity, priceAt } from './market';
import { canInvestFurther, courierInvestmentCost, generateNews, resolveArrivals } from './news';
import { resolveSecretExpiry, useSecret } from './secrets';
import type { GameState, GameAction, GradeId, HotseatDecision, Vessel } from './types';

function tickVessel(v: Vessel): Vessel {
  if (!v.destination || v.weeksRemaining <= 0) return v;
  const weeksRemaining = v.weeksRemaining - 1;
  if (weeksRemaining <= 0) {
    return { ...v, location: v.destination, destination: null, routeId: null, weeksRemaining: 0 };
  }
  return { ...v, weeksRemaining };
}

function dispatchVessel(
  state: GameState,
  vesselId: string,
  destinationId: string,
  insure?: boolean,
  plannedRoute?: string[],
): GameState {
  const vessel = state.vessels.find(v => v.id === vesselId);
  if (!vessel) throw new Error(`No such vessel: ${vesselId}`);
  if (vessel.destination) throw new Error(`${vessel.name} is already under way`);

  const landOnly = vessel.kind === 'courier';
  const route = findRoute(vessel.location, destinationId);
  if (!route) throw new Error(`No route from ${vessel.location} to ${destinationId}`);
  if (landOnly && route.type !== 'land') {
    throw new Error(`${vessel.name} cannot travel by sea`);
  }

  let cash = state.cash;
  let insurance = state.insurance ?? [];
  if (insure) {
    if (!canInsureAt(vessel.location)) {
      throw new Error('Insurance is only underwritten at Bruges, Venice, or Genoa');
    }
    const quote = quoteInsurance(state, vessel, route, destinationId);
    if (quote.coverage <= 0) throw new Error(`${vessel.name} is carrying no cargo to insure`);
    if (quote.premium > cash) {
      throw new Error(`Not enough cash for the premium (need ${quote.premium}, have ${Math.round(cash)})`);
    }
    cash -= quote.premium;
    insurance = [
      ...insurance.filter(i => i.vesselId !== vesselId),
      { vesselId, routeId: route.id, coverage: quote.coverage, premiumPaid: quote.premium },
    ];
  }

  return {
    ...state,
    cash,
    insurance,
    vessels: state.vessels.map(v =>
      v.id === vesselId
        ? {
            ...v,
            destination: destinationId,
            routeId: route.id,
            weeksRemaining: route.distanceWeeks,
            // Always set explicitly (undefined if not passed) — a manual redispatch away from a
            // queued journey correctly drops the stale plan rather than leaving a "Continue to X?"
            // prompt pointing at a city the vessel is no longer chained toward.
            plannedRoute,
          }
        : v,
    ),
  };
}

/** Dispatches the next leg of a journey queued via "Queue journey" (Phase 15) — resolves the
 * queued route id to a real destination from the vessel's *current* location (not assumed from
 * when the plan was made) and dispatches through the exact same `dispatchVessel` every other
 * voyage uses, so this leg is insured, risked, and expedition-tracked identically to a manually
 * chosen one. */
function continuePlannedRoute(state: GameState, vesselId: string, insure?: boolean): GameState {
  const vessel = state.vessels.find(v => v.id === vesselId);
  if (!vessel) throw new Error(`No such vessel: ${vesselId}`);
  if (!vessel.plannedRoute || vessel.plannedRoute.length === 0) {
    throw new Error(`${vessel.name} has no planned route to continue`);
  }
  const [nextRouteId, ...remaining] = vessel.plannedRoute;
  const route = findRouteById(nextRouteId);
  if (!route) throw new Error(`Unknown route: ${nextRouteId}`);
  const destinationId = otherEndOfRoute(route, vessel.location);
  return dispatchVessel(state, vesselId, destinationId, insure, remaining);
}

/** Drops a queued journey without moving the vessel — it stays a normal docked, tradeable,
 * freely-redirectable vessel exactly as if it had never been queued. */
function cancelPlannedRoute(state: GameState, vesselId: string): GameState {
  return {
    ...state,
    vessels: state.vessels.map(v => (v.id === vesselId ? { ...v, plannedRoute: undefined } : v)),
  };
}

/**
 * Auto-continues any vessel that's sitting docked with a queued plan still remaining (Phase 17
 * follow-up: "it still only takes you one port at a time" — the owner wanted the queued journey
 * to keep sailing on its own rather than needing a manual "Continue?" click at every intermediate
 * stop). Deliberately uninsured — insuring is a paid, opt-in choice (`quoteInsurance`), and
 * auto-applying it would silently charge the player a premium they never explicitly asked for on
 * this leg; a player who wants a leg insured can still cancel the plan and redispatch manually.
 *
 * Called at the very top of `advanceWeek`, *before* this week's own `tickVessel`/`checkTriggers`
 * run — critically, this means a vessel that arrives at an intermediate city *this* week is never
 * auto-continued in that same tick. It's still sitting there (destination non-null) when this
 * function runs, since it only acts on vessels already docked *before* this week's movement — so
 * arrival events (e.g. "Landfall at Madeira") always get a full turn to queue and be resolved
 * first. The vessel only actually auto-continues on the *next* `ADVANCE_WEEK` after it arrives,
 * exactly mirroring how a manual "Continue" click already worked (dispatch is a free action; only
 * the following `ADVANCE_WEEK` ticks travel time). The player can still interrupt at any
 * intermediate stop with `CANCEL_PLANNED_ROUTE` any time before that next `ADVANCE_WEEK`.
 */
function autoContinuePlannedRoutes(state: GameState): GameState {
  let next = state;
  for (const vessel of state.vessels) {
    if (!vessel.destination && vessel.plannedRoute && vessel.plannedRoute.length > 0) {
      next = continuePlannedRoute(next, vessel.id);
    }
  }
  return next;
}

/** Records that the player has seen the "Chapter N complete" acknowledgment card (Phase 15) — a
 * monotonic high-water mark, never lowered, so re-showing an already-seen card is impossible even
 * if this were somehow dispatched twice for the same transition. */
function acknowledgeChapter(state: GameState, chapterNumber: number): GameState {
  return { ...state, lastAcknowledgedChapter: Math.max(state.lastAcknowledgedChapter ?? 0, chapterNumber) };
}

function buyGood(
  state: GameState,
  vesselId: string,
  goodId: string,
  quantity: number,
  grade: GradeId = 'common',
): GameState {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Quantity must be a positive whole number');

  const vessel = state.vessels.find(v => v.id === vesselId);
  if (!vessel) throw new Error(`No such vessel: ${vesselId}`);
  if (vessel.destination) throw new Error(`${vessel.name} is under way and cannot trade`);
  if (vessel.capacity <= 0) throw new Error(`${vessel.name} has no cargo hold`);

  const city = findCity(vessel.location);
  const price = priceAt(state.scarcity, vessel.location, goodId);
  if (price === null) throw new Error(`${city?.name ?? vessel.location} has no market for that good`);

  const spaceLeft = vessel.capacity - cargoTotal(vessel.cargo);
  if (quantity > spaceLeft) throw new Error(`Only ${spaceLeft} unit${spaceLeft === 1 ? '' : 's'} of cargo space left`);

  // Quality grades (pilot: cloth/silk, `sim/grades.ts`) charge a flat premium on top of the same
  // market price every other buyer pays — a real cost, not a discount, so grade is never "free."
  const cost = price * quantity * gradeBuyMultiplier(grade) * (1 - tradeBonus(state.characters, vesselId));
  if (cost > state.cash) throw new Error(`Not enough cash (need ${Math.round(cost)}, have ${Math.round(state.cash)})`);

  // Deliberately does NOT call adjustScarcity: an earlier version raised the local price on every
  // purchase, priced at a single pre-trade snapshot for the whole quantity — buying up a port's
  // stock (or as much as capacity allowed) inflated the price *after* the fact, and immediately
  // selling the same goods back cashed in that self-inflicted spike for a real, repeatable,
  // zero-risk profit. The player's own buying no longer moves the price at all; only selling
  // does (below), which still creates the intended "dump crashes the local price, recovers over
  // about a month" dynamic without a same-city round-trip to exploit. Genuine cross-city arbitrage
  // (buy cheap here, sail elsewhere, sell for more) is untouched — that price gap comes from each
  // city's own base price plus background flows/AI house trade, not the player's own purchase.
  return {
    ...state,
    cash: state.cash - cost,
    vessels: state.vessels.map(v =>
      v.id === vesselId
        ? {
            ...v,
            cargo: { ...v.cargo, [goodId]: (v.cargo[goodId] ?? 0) + quantity },
            cargoGrades: addGrade(v.cargoGrades, goodId, grade, quantity),
          }
        : v,
    ),
  };
}

function sellGood(
  state: GameState,
  vesselId: string,
  goodId: string,
  quantity: number,
  grade: GradeId = 'common',
): GameState {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Quantity must be a positive whole number');

  const vessel = state.vessels.find(v => v.id === vesselId);
  if (!vessel) throw new Error(`No such vessel: ${vesselId}`);
  if (vessel.destination) throw new Error(`${vessel.name} is under way and cannot trade`);

  const held = gradeHeld(vessel.cargo, vessel.cargoGrades, goodId, grade);
  if (quantity > held) throw new Error(`${vessel.name} is not carrying that much of that grade`);

  const city = findCity(vessel.location);
  const price = priceAt(state.scarcity, vessel.location, goodId);
  if (price === null) throw new Error(`${city?.name ?? vessel.location} has no market for that good`);

  const qualityMarket = city?.market?.[goodId]?.qualityMarket ?? false;
  const revenue = price * quantity * gradeSellMultiplier(grade, qualityMarket) * (1 + tradeBonus(state.characters, vesselId));

  return {
    ...state,
    cash: state.cash + revenue,
    scarcity: adjustScarcity(state.scarcity, vessel.location, goodId, -quantity),
    vessels: state.vessels.map(v =>
      v.id === vesselId
        ? {
            ...v,
            cargo: { ...v.cargo, [goodId]: (v.cargo[goodId] ?? 0) - quantity },
            cargoGrades: removeGrade(v.cargoGrades, goodId, grade, quantity),
          }
        : v,
    ),
  };
}

function advanceWeek(rawState: GameState, hotseatDecision?: HotseatDecision): GameState {
  const state = autoContinuePlannedRoutes(rawState);
  const week = advanceWeekCounter(state.week);
  const exchangeRates = driftExchangeRates(state.exchangeRates);
  const maturity = resolveMaturingObligations(state, week, exchangeRates);
  // Chapter 0: an apprentice doesn't owe the household's wages — that's Marian's problem until
  // Claes is formally made her factor. Wages and loyalty drift are suspended until then.
  const upkeep = state.flags.chapter0_complete
    ? resolveWeeklyUpkeep({ ...state, cash: maturity.cash })
    : { cash: maturity.cash, characters: state.characters };
  const condottaResolution = resolveWeeklyCondotta({ ...state, cash: upkeep.cash });
  // A hotseat house's own weekly decision (Phase 14) replaces that one house's dice at each of the
  // three points below — every other house still rolls, exactly as before.
  const hotseatHouseId = state.hotseatHouseId ?? null;
  const manualTrade =
    hotseatHouseId && hotseatDecision
      ? { houseId: hotseatHouseId, goodId: hotseatDecision.tradeGoodId, direction: hotseatDecision.tradeDirection }
      : undefined;
  const manualPlant =
    hotseatHouseId && hotseatDecision
      ? { houseId: hotseatHouseId, targetCityId: hotseatDecision.plantTargetCityId }
      : undefined;
  const manualSabotage =
    hotseatHouseId && hotseatDecision
      ? { houseId: hotseatHouseId, attempt: hotseatDecision.attemptSabotage }
      : undefined;
  // Named intermediates (Phase 16), not a single chained expression — deriveMarketCauses (below)
  // needs to compare each stage against the last to explain which force actually moved a price.
  const afterBackgroundFlows = applyBackgroundFlows(maturity.scarcity);
  const afterDrift = driftScarcity(afterBackgroundFlows);
  const houseFootprint = applyHouseTradeFootprint(afterDrift, manualTrade);
  const scarcity = houseFootprint.scarcity;
  const houseRelations = driftHouseRelations(state.houseRelations, state.flags);
  const secretsAfterExpiry = resolveSecretExpiry(state.secrets, week);
  const secrets = resolveWeeklyAgentIntelligence(state.agents, secretsAfterExpiry, week);
  const risk = resolveVoyageRisk(maturity.vessels, state.insurance ?? [], ROUTES, week);
  const tickedVessels = risk.vessels.map(tickVessel);
  const insurance = clearArrivedInsurance(risk.insurance, tickedVessels);
  const sabotage = resolveHouseSabotage(tickedVessels, week, manualSabotage);
  const estate = resolveWeeklyEstate(state.estate);
  const expeditionResolution = resolveWeeklyExpedition(
    { ...state, cash: condottaResolution.cash + risk.cashDelta, vessels: sabotage.vessels, characters: upkeep.characters },
    week,
  );

  const marketCauses = deriveMarketCauses(maturity.scarcity, afterBackgroundFlows, afterDrift, scarcity, houseFootprint.trades);
  const rawNews = generateNews(scarcity, week, state.courierInvestment, upkeep.characters, marketCauses);
  const newNews = corruptNews(rawNews, state.agents, HOME_CITY, manualPlant);
  const { arrived, stillPending } = resolveArrivals([...state.pendingNews, ...newNews], week);
  const knownPrices = { ...state.knownPrices };
  for (const item of arrived) knownPrices[item.cityId] = item;

  let flags = state.flags;
  if (condottaResolution.condottaJustCompleted) flags = { ...flags, condotta_naples_complete: true };
  if (sabotage.sabotaged) flags = { ...flags, doria_sabotage_occurred: true };
  if (expeditionResolution.crisisReached) flags = { ...flags, expedition_crisis: true };

  // Storm/piracy loss, sabotage, and forced liquidation (maturity.vessels, above) each just remove
  // `n` units of some good with no idea grades (`sim/grades.ts`) exist — this is the one place all
  // three have already run, so it's the one place a pilot good's cargoGrades needs clamping back
  // down to what `cargo` actually still holds, rather than patching all three files individually.
  const vessels = sabotage.vessels.map(reconcileVesselCargoGrades);

  return checkTriggers({
    ...state,
    week,
    cash: expeditionResolution.cash,
    conscience: expeditionResolution.conscience,
    vessels,
    obligations: maturity.obligations,
    insolvent: state.insolvent || maturity.insolvent,
    characters: upkeep.characters,
    condotta: condottaResolution.condotta,
    flags,
    exchangeRates,
    scarcity,
    houseRelations,
    secrets,
    pendingNews: stillPending,
    knownPrices,
    lastMarketCauses: marketCauses,
    estate,
    insurance,
    lastVoyageEvent: risk.event ?? state.lastVoyageEvent,
    lastSabotageEvent: sabotage.event ?? state.lastSabotageEvent ?? null,
    expedition: expeditionResolution.expedition,
    lastExpeditionEvent: expeditionResolution.event ?? state.lastExpeditionEvent ?? null,
  });
}

function investCourier(state: GameState, cityId: string): GameState {
  if (cityId === HOME_CITY) throw new Error(`${findCity(HOME_CITY)?.name ?? HOME_CITY} is home — reports are already instant`);
  if (!canInvestFurther(cityId, state.courierInvestment)) {
    throw new Error(`The courier line to ${findCity(cityId)?.name ?? cityId} is already as fast as it can be`);
  }

  const cost = courierInvestmentCost(cityId, state.courierInvestment);
  if (cost > state.cash) throw new Error(`Not enough cash (need ${cost}, have ${Math.round(state.cash)})`);

  return {
    ...state,
    cash: state.cash - cost,
    courierInvestment: {
      ...state.courierInvestment,
      [cityId]: (state.courierInvestment[cityId] ?? 0) + 1,
    },
  };
}

export function processAction(state: GameState, action: GameAction): GameState {
  if (state.insolvent) return state;
  // chapter1_complete through chapter3_complete no longer freeze play — each is a mid-campaign
  // flag the next chapter's own events trigger on (design doc §12, "Phase 9 onward: one chapter
  // content pack per phase"). Only the true end of the shipped content (chapter4_complete) stops
  // the clock now.
  if (state.flags.chapter4_complete) return state;
  // ACKNOWLEDGE_CHAPTER is UI bookkeeping (dismissing the "Chapter N complete" card), not a
  // commercial/narrative action — it must go through even while the next chapter's own opening
  // event is already queued in pendingEvents (which it typically is, by design: that event's
  // trigger fires the same tick the previous chapter's flag does), or the card could never be
  // dismissed at all.
  if (state.pendingEvents.length > 0 && action.type !== 'RESOLVE_EVENT' && action.type !== 'ACKNOWLEDGE_CHAPTER') {
    return state;
  }

  switch (action.type) {
    case 'ADVANCE_WEEK':
      return advanceWeek(state, action.hotseatDecision);
    case 'DISPATCH_VESSEL':
      return dispatchVessel(state, action.vesselId, action.destinationId, action.insure, action.plannedRoute);
    case 'CONTINUE_PLANNED_ROUTE':
      return continuePlannedRoute(state, action.vesselId, action.insure);
    case 'CANCEL_PLANNED_ROUTE':
      return cancelPlannedRoute(state, action.vesselId);
    case 'ACKNOWLEDGE_CHAPTER':
      return acknowledgeChapter(state, action.chapterNumber);
    case 'BUY_GOOD':
      return buyGood(state, action.vesselId, action.goodId, action.quantity, action.grade);
    case 'SELL_GOOD':
      return sellGood(state, action.vesselId, action.goodId, action.quantity, action.grade);
    case 'INVEST_COURIER':
      return investCourier(state, action.cityId);
    case 'WRITE_BILL':
      return writeBill(state, action.cityId, action.florins, action.termWeeks);
    case 'TAKE_DEPOSIT':
      return takeDeposit(state, action.florins, action.termWeeks);
    case 'WRITE_LOAN':
      return writeLoan(state, action.kind, action.florins, action.termWeeks);
    case 'DISCOUNT_OBLIGATION':
      return discountObligation(state, action.obligationId);
    case 'ASSIGN_CHARACTER':
      return assignCharacter(state, action.characterId, action.assignment);
    case 'RESOLVE_EVENT':
      return resolveEvent(state, action.eventId, action.choiceIndex);
    case 'USE_SECRET':
      return useSecret(state, action.secretId);
    case 'PLACE_AGENT':
      return placeAgent(state, action.placement, action.name);
    case 'ESTABLISH_ESTATE':
      return establishEstate(state);
    case 'HARVEST_ESTATE':
      return harvestEstate(state);
    case 'SHIP_ESTATE_GOODS':
      return shipEstateGoods(state, action.vesselId, action.quantity);
    default:
      return state;
  }
}
