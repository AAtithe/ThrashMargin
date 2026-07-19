import { findCity } from './content';
import type { Character, CharacterAssignment, GameState } from './types';

export const STARTING_CONSCIENCE = 100;

/** A negotiator can't cut a credit rate by more than half, however high their law skill. */
const NEGOTIATE_DISCOUNT_FLOOR_FRACTION = 0.5;
const NEGOTIATE_DISCOUNT_PER_LAW_SKILL = 0.05;

/** Weeks of latency an investigator's intrigue skill shaves off a city's reports, floored below. */
const INVESTIGATE_WEEKS_PER_INTRIGUE_SKILL = 0.5;

/** Fraction of better price (cheaper buy, dearer sell) a trade skill point aboard a vessel is worth. */
const TRADE_BONUS_PER_SKILL = 0.01;
const TRADE_BONUS_CAP = 0.05;

const UPKEEP_PAID_LOYALTY_DELTA = 1;
const UPKEEP_UNPAID_LOYALTY_DELTA = -4;
const DEPARTURE_LOYALTY_THRESHOLD = 0;

/** Writing a prince loan means lending to exploit a ruler's political need. Costs Conscience,
 * and the company's conscience — Godscalc and Tobie specifically — take it personally. */
export const CONSCIENCE_COST_PRINCE_LOAN = 5;
const CONSCIENCE_AFFECTED_CHARACTER_IDS = ['godscalc', 'tobie'];
const CONSCIENCE_LOYALTY_PENALTY = 3;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function activeCharacters(characters: Character[]): Character[] {
  return characters.filter(c => c.status === 'active');
}

export function assignCharacter(
  state: GameState,
  characterId: string,
  assignment: CharacterAssignment,
): GameState {
  const character = state.characters.find(c => c.id === characterId);
  if (!character) throw new Error(`No such character: ${characterId}`);
  if (character.status !== 'active') throw new Error(`${character.name} is no longer with the company`);

  if (assignment.type === 'aboard' && !state.vessels.find(v => v.id === assignment.vesselId)) {
    throw new Error(`No such vessel: ${assignment.vesselId}`);
  }
  if ((assignment.type === 'negotiate' || assignment.type === 'investigate') && !findCity(assignment.cityId)) {
    throw new Error(`No such city: ${assignment.cityId}`);
  }

  return {
    ...state,
    characters: state.characters.map(c => (c.id === characterId ? { ...c, assignment } : c)),
  };
}

/** Fraction knocked off a per-week credit rate by whoever is negotiating at `cityId`, from their law skill. */
export function negotiateDiscount(characters: Character[], cityId: string): number {
  const negotiator = activeCharacters(characters).find(
    c => c.assignment.type === 'negotiate' && c.assignment.cityId === cityId,
  );
  if (!negotiator) return 0;
  return clamp(negotiator.skills.law * NEGOTIATE_DISCOUNT_PER_LAW_SKILL, 0, NEGOTIATE_DISCOUNT_FLOOR_FRACTION);
}

/** Extra weeks knocked off `cityId`'s report latency by whoever is investigating there, from their intrigue skill. */
export function investigateLatencyBonus(characters: Character[], cityId: string): number {
  const investigator = activeCharacters(characters).find(
    c => c.assignment.type === 'investigate' && c.assignment.cityId === cityId,
  );
  if (!investigator) return 0;
  return Math.floor(investigator.skills.intrigue * INVESTIGATE_WEEKS_PER_INTRIGUE_SKILL);
}

/** Fraction of better price a vessel's trades get from whoever is aboard it, from their trade skill. */
export function tradeBonus(characters: Character[], vesselId: string): number {
  const aboard = activeCharacters(characters).find(
    c => c.assignment.type === 'aboard' && c.assignment.vesselId === vesselId,
  );
  if (!aboard) return 0;
  return clamp(aboard.skills.trade * TRADE_BONUS_PER_SKILL, 0, TRADE_BONUS_CAP);
}

/**
 * Weekly wages: paid in full when cash covers the whole roster (loyalty ticks up for everyone
 * active), skipped entirely otherwise (loyalty drops hard for everyone active) — there is no
 * partial pay and no back-pay debt added to the maturity ladder. A character whose loyalty
 * reaches zero leaves the company for good and their assignment reverts to idle.
 */
export function resolveWeeklyUpkeep(state: GameState): { cash: number; characters: Character[] } {
  const active = activeCharacters(state.characters);
  const totalSalary = active.reduce((sum, c) => sum + c.salary, 0);
  const canPay = totalSalary <= state.cash;
  const cash = canPay ? state.cash - totalSalary : state.cash;
  const delta = canPay ? UPKEEP_PAID_LOYALTY_DELTA : UPKEEP_UNPAID_LOYALTY_DELTA;

  const characters = state.characters.map(c => {
    if (c.status !== 'active') return c;
    const loyalty = clamp(c.loyalty + delta, 0, 100);
    if (loyalty <= DEPARTURE_LOYALTY_THRESHOLD) {
      return { ...c, loyalty, status: 'departed' as const, assignment: { type: 'idle' as const } };
    }
    return { ...c, loyalty };
  });

  return { cash, characters };
}

/** Certain profitable actions cost Conscience outright, and cost Godscalc and Tobie's loyalty with it. */
export function applyConscienceCost(state: GameState, amount: number): GameState {
  const conscience = clamp(state.conscience - amount, 0, 100);
  const characters = state.characters.map(c =>
    CONSCIENCE_AFFECTED_CHARACTER_IDS.includes(c.id) && c.status === 'active'
      ? { ...c, loyalty: clamp(c.loyalty - CONSCIENCE_LOYALTY_PENALTY, 0, 100) }
      : c,
  );
  return { ...state, conscience, characters };
}
