import { findCity } from './content';
import { cargoTotal } from './market';
import type { Estate, GameState } from './types';

/** Chapter 3's estate is Kouklia-only and sugar-only — the design doc's own line names both
 * specifically, and every prior chapter's first outing of a new mechanic (condotta, agents)
 * stayed just as narrow on its first pass. */
export const ESTATE_CITY = 'kouklia';
export const ESTATE_GOOD = 'sugar';
export const ESTATE_ESTABLISH_COST = 25;

const GROWING_WEEKS = 8;
const REFINING_WEEKS = 3;
const BATCH_SIZE = 15;

/** Founding the estate plants it in the same action — there is no separate PLANT_ESTATE step. */
export function establishEstate(state: GameState): GameState {
  if (!state.flags.kouklia_estate_available) {
    throw new Error('No estate has been offered here yet');
  }
  if (state.estate) throw new Error('The estate is already established');
  if (ESTATE_ESTABLISH_COST > state.cash) {
    throw new Error(`Not enough cash (need ${ESTATE_ESTABLISH_COST}, have ${Math.round(state.cash)})`);
  }

  const estate: Estate = {
    cityId: ESTATE_CITY,
    goodId: ESTATE_GOOD,
    stage: 'growing',
    weeksInStage: 0,
    stockpile: 0,
  };
  return { ...state, cash: state.cash - ESTATE_ESTABLISH_COST, estate };
}

/** Harvest is the one deliberate step in the cycle — growing and refining both advance on their
 * own via `resolveWeeklyEstate`, but a ripe crop waits for the player to bring it in. */
export function harvestEstate(state: GameState): GameState {
  if (!state.estate) throw new Error('There is no estate to harvest');
  if (state.estate.stage !== 'ready') throw new Error('The crop is not ready to harvest yet');
  return { ...state, estate: { ...state.estate, stage: 'refining', weeksInStage: 0 } };
}

/** "Ship" reuses the existing cargo/capacity system rather than a second one — refined sugar
 * loaded this way sells through the ordinary market just like anything bought at a city. */
export function shipEstateGoods(state: GameState, vesselId: string, quantity: number): GameState {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Quantity must be a positive whole number');
  if (!state.estate) throw new Error('There is no estate to ship from');

  const vessel = state.vessels.find(v => v.id === vesselId);
  if (!vessel) throw new Error(`No such vessel: ${vesselId}`);
  if (vessel.destination) throw new Error(`${vessel.name} is under way and cannot load cargo`);
  if (vessel.location !== state.estate.cityId) {
    const cityName = findCity(state.estate.cityId)?.name ?? state.estate.cityId;
    throw new Error(`${vessel.name} must be docked at ${cityName} to load the estate's goods`);
  }
  if (quantity > state.estate.stockpile) throw new Error("The estate doesn't have that much in store");

  const spaceLeft = vessel.capacity - cargoTotal(vessel.cargo);
  if (quantity > spaceLeft) throw new Error(`Only ${spaceLeft} unit${spaceLeft === 1 ? '' : 's'} of cargo space left`);

  const goodId = state.estate.goodId;
  return {
    ...state,
    estate: { ...state.estate, stockpile: state.estate.stockpile - quantity },
    vessels: state.vessels.map(v =>
      v.id === vesselId ? { ...v, cargo: { ...v.cargo, [goodId]: (v.cargo[goodId] ?? 0) + quantity } } : v,
    ),
  };
}

/** Runs every ADVANCE_WEEK: growing and refining both count up and transition on their own;
 * `ready` is a hold state that only `harvestEstate` clears. */
export function resolveWeeklyEstate(estate: Estate | null): Estate | null {
  if (!estate) return estate;

  if (estate.stage === 'growing') {
    const weeksInStage = estate.weeksInStage + 1;
    if (weeksInStage >= GROWING_WEEKS) return { ...estate, stage: 'ready', weeksInStage: 0 };
    return { ...estate, weeksInStage };
  }

  if (estate.stage === 'refining') {
    const weeksInStage = estate.weeksInStage + 1;
    if (weeksInStage >= REFINING_WEEKS) {
      return { ...estate, stage: 'growing', weeksInStage: 0, stockpile: estate.stockpile + BATCH_SIZE };
    }
    return { ...estate, weeksInStage };
  }

  return estate;
}
