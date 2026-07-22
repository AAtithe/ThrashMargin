import { advanceWeek as advanceWeekCounter } from './clock';
import { HOME_CITY, findCity, findRoute } from './content';
import { assignCharacter, resolveWeeklyUpkeep, tradeBonus } from './characters';
import { resolveWeeklyCondotta } from './condotta';
import { discountObligation, resolveMaturingObligations, takeDeposit, writeBill, writeLoan } from './credit';
import { driftExchangeRates } from './currency';
import { checkTriggers, resolveEvent } from './events';
import {
  applyHouseTradeFootprint,
  corruptNews,
  driftHouseRelations,
  placeAgent,
  resolveHouseSabotage,
  resolveWeeklyAgentIntelligence,
} from './houses';
import { adjustScarcity, applyBackgroundFlows, cargoTotal, driftScarcity, priceAt } from './market';
import { canInvestFurther, courierInvestmentCost, generateNews, resolveArrivals } from './news';
import { resolveSecretExpiry, useSecret } from './secrets';
import type { GameState, GameAction, Vessel } from './types';

function tickVessel(v: Vessel): Vessel {
  if (!v.destination || v.weeksRemaining <= 0) return v;
  const weeksRemaining = v.weeksRemaining - 1;
  if (weeksRemaining <= 0) {
    return { ...v, location: v.destination, destination: null, routeId: null, weeksRemaining: 0 };
  }
  return { ...v, weeksRemaining };
}

function dispatchVessel(state: GameState, vesselId: string, destinationId: string): GameState {
  const vessel = state.vessels.find(v => v.id === vesselId);
  if (!vessel) throw new Error(`No such vessel: ${vesselId}`);
  if (vessel.destination) throw new Error(`${vessel.name} is already under way`);

  const landOnly = vessel.kind === 'courier';
  const route = findRoute(vessel.location, destinationId);
  if (!route) throw new Error(`No route from ${vessel.location} to ${destinationId}`);
  if (landOnly && route.type !== 'land') {
    throw new Error(`${vessel.name} cannot travel by sea`);
  }

  return {
    ...state,
    vessels: state.vessels.map(v =>
      v.id === vesselId
        ? { ...v, destination: destinationId, routeId: route.id, weeksRemaining: route.distanceWeeks }
        : v,
    ),
  };
}

function buyGood(state: GameState, vesselId: string, goodId: string, quantity: number): GameState {
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

  const cost = price * quantity * (1 - tradeBonus(state.characters, vesselId));
  if (cost > state.cash) throw new Error(`Not enough cash (need ${Math.round(cost)}, have ${Math.round(state.cash)})`);

  return {
    ...state,
    cash: state.cash - cost,
    scarcity: adjustScarcity(state.scarcity, vessel.location, goodId, quantity),
    vessels: state.vessels.map(v =>
      v.id === vesselId
        ? { ...v, cargo: { ...v.cargo, [goodId]: (v.cargo[goodId] ?? 0) + quantity } }
        : v,
    ),
  };
}

function sellGood(state: GameState, vesselId: string, goodId: string, quantity: number): GameState {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Quantity must be a positive whole number');

  const vessel = state.vessels.find(v => v.id === vesselId);
  if (!vessel) throw new Error(`No such vessel: ${vesselId}`);
  if (vessel.destination) throw new Error(`${vessel.name} is under way and cannot trade`);

  const held = vessel.cargo[goodId] ?? 0;
  if (quantity > held) throw new Error(`${vessel.name} is not carrying that much`);

  const city = findCity(vessel.location);
  const price = priceAt(state.scarcity, vessel.location, goodId);
  if (price === null) throw new Error(`${city?.name ?? vessel.location} has no market for that good`);

  const revenue = price * quantity * (1 + tradeBonus(state.characters, vesselId));

  return {
    ...state,
    cash: state.cash + revenue,
    scarcity: adjustScarcity(state.scarcity, vessel.location, goodId, -quantity),
    vessels: state.vessels.map(v =>
      v.id === vesselId ? { ...v, cargo: { ...v.cargo, [goodId]: held - quantity } } : v,
    ),
  };
}

function advanceWeek(state: GameState): GameState {
  const week = advanceWeekCounter(state.week);
  const exchangeRates = driftExchangeRates(state.exchangeRates);
  const maturity = resolveMaturingObligations(state, week, exchangeRates);
  const upkeep = resolveWeeklyUpkeep({ ...state, cash: maturity.cash });
  const condottaResolution = resolveWeeklyCondotta({ ...state, cash: upkeep.cash });
  const scarcity = applyHouseTradeFootprint(driftScarcity(applyBackgroundFlows(maturity.scarcity)));
  const houseRelations = driftHouseRelations(state.houseRelations, state.flags);
  const secretsAfterExpiry = resolveSecretExpiry(state.secrets, week);
  const secrets = resolveWeeklyAgentIntelligence(state.agents, secretsAfterExpiry, week);
  const sabotage = resolveHouseSabotage(maturity.vessels.map(tickVessel));

  const rawNews = generateNews(scarcity, week, state.courierInvestment, upkeep.characters);
  const newNews = corruptNews(rawNews, state.agents, HOME_CITY);
  const { arrived, stillPending } = resolveArrivals([...state.pendingNews, ...newNews], week);
  const knownPrices = { ...state.knownPrices };
  for (const item of arrived) knownPrices[item.cityId] = item;

  let flags = state.flags;
  if (condottaResolution.condottaJustCompleted) flags = { ...flags, condotta_naples_complete: true };
  if (sabotage.sabotaged) flags = { ...flags, doria_sabotage_occurred: true };

  return checkTriggers({
    ...state,
    week,
    cash: condottaResolution.cash,
    vessels: sabotage.vessels,
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
  // chapter1_complete no longer freezes play — it's a mid-campaign flag Chapter 2's own events
  // trigger on (design doc §12, "Phase 9 onward: one chapter content pack per phase"). Only the
  // true end of the shipped content (chapter2_complete) stops the clock now.
  if (state.flags.chapter2_complete) return state;
  if (state.pendingEvents.length > 0 && action.type !== 'RESOLVE_EVENT') return state;

  switch (action.type) {
    case 'ADVANCE_WEEK':
      return advanceWeek(state);
    case 'DISPATCH_VESSEL':
      return dispatchVessel(state, action.vesselId, action.destinationId);
    case 'BUY_GOOD':
      return buyGood(state, action.vesselId, action.goodId, action.quantity);
    case 'SELL_GOOD':
      return sellGood(state, action.vesselId, action.goodId, action.quantity);
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
    default:
      return state;
  }
}
