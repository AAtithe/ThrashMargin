import type { CondottaContract, GameState } from './types';

/** Paid on top of the final week's retainer when a campaign completes — "campaign bonuses" per design doc §5. */
const CAMPAIGN_BONUS_WEEKS = 4;

/** Start a new contract. If one is somehow already running, the existing contract is left alone. */
export function startCondotta(condotta: CondottaContract | null, contract: CondottaContract): CondottaContract | null {
  return condotta ?? contract;
}

export interface CondottaResolution {
  cash: number;
  condotta: CondottaContract | null;
  condottaJustCompleted: boolean;
}

/** Runs every ADVANCE_WEEK: pays the weekly retainer and counts the contract down to its bonus payout. */
export function resolveWeeklyCondotta(state: GameState): CondottaResolution {
  if (!state.condotta) return { cash: state.cash, condotta: null, condottaJustCompleted: false };

  const weeksRemaining = state.condotta.weeksRemaining - 1;
  let cash = state.cash + state.condotta.retainerPerWeek;

  if (weeksRemaining <= 0) {
    cash += state.condotta.retainerPerWeek * CAMPAIGN_BONUS_WEEKS;
    return { cash, condotta: null, condottaJustCompleted: true };
  }

  return { cash, condotta: { ...state.condotta, weeksRemaining }, condottaJustCompleted: false };
}
