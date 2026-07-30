import { findCity } from './content';
import type { DiviningPurpose, DiviningState, GameState } from './types';

/**
 * The divining gift (design doc §8 track 4: "Nicholas's dowsing/scrying from the novels is in: a
 * limited-use ability (find water/ore, sense a person's direction) with a Conscience and health
 * cost, unlocking specific story branches (Sinai, the mines, the search scenes)").
 *
 * Three deliberate scope decisions, all recorded rather than left implicit:
 *
 * 1. **Each purpose is tied to one city**, not usable anywhere. The gift answers a question about
 *    ground the player is physically standing on, so it needs a docked vessel at that city — which
 *    also means the ability can never be a free flag collected from Bruges on turn one. The three
 *    cities are exactly the three uses §8 names: water at Sinai (the desert crossing), ore at
 *    Edinburgh (the Scottish mines), a person's direction at Cairo (the search for the child).
 *
 * 2. **"Health cost" is a recovery cooldown plus a hard campaign cap, not a second health meter.**
 *    Nicholas is not a `Character` record — the player *is* him — so there is no existing health
 *    stat to spend, and Conscience is the one personal meter the sim has. Inventing a parallel
 *    0-100 health bar for one chapter's ability would be a bigger mechanic than §8 asks for, and
 *    would immediately raise the question of how it recovers, what else damages it, and why the
 *    Ledger doesn't show it. A four-week cooldown during which the gift cannot be used again is
 *    real, felt, and needs no new display: it is time, which this game already prices in weeks.
 *
 * 3. **Divining never gates the chapter's spine.** Every flag a use sets opens an *additional*
 *    branch (a better outcome, a piece of evidence, a payment) and no main thread requires one.
 *    This is the Chapter 4 soft-lock lesson applied before the fact: a limited-use ability that a
 *    player could exhaust, or simply never discover, must not be able to strand a campaign.
 */

export const DIVINING_TOTAL_USES = 3;
export const DIVINING_CONSCIENCE_COST = 6;
export const DIVINING_REST_WEEKS = 4;

/** Which city each of §8's three named uses actually has to be exercised at. */
export const DIVINING_CITIES: Record<DiviningPurpose, string> = {
  water: 'sinai',
  ore: 'edinburgh',
  person: 'cairo',
};

/** The flag a successful use sets, for Chapter 5's own content to trigger a branch off. */
export const DIVINING_FLAGS: Record<DiviningPurpose, string> = {
  water: 'divined_water',
  ore: 'divined_ore',
  person: 'divined_person',
};

export const DIVINING_UNLOCK_FLAG = 'divining_unlocked';

export function diviningState(state: GameState): DiviningState {
  return state.divining ?? { usesRemaining: DIVINING_TOTAL_USES, restUntilWeek: 0 };
}

export interface DiviningAvailability {
  /** Whether the gift is unlocked at all — Chapter 5's own content sets the flag. */
  unlocked: boolean;
  usesRemaining: number;
  /** Weeks still to wait before another use is possible; 0 when rested. */
  restWeeksLeft: number;
  /** Null when this purpose can be exercised right now; otherwise why it can't. */
  blockedReason: string | null;
}

/** Everything the panel needs to render one purpose's button, and exactly the same checks
 * `useDivining` enforces — so a disabled button and a thrown error can never disagree. */
export function diviningAvailability(state: GameState, purpose: DiviningPurpose): DiviningAvailability {
  const d = diviningState(state);
  const restWeeksLeft = Math.max(0, d.restUntilWeek - state.week);
  const cityId = DIVINING_CITIES[purpose];
  const cityName = findCity(cityId)?.name ?? cityId;
  const unlocked = !!state.flags[DIVINING_UNLOCK_FLAG];

  let blockedReason: string | null = null;
  if (!unlocked) blockedReason = 'The gift has not been put to deliberate use yet.';
  else if (state.flags[DIVINING_FLAGS[purpose]]) blockedReason = 'Already answered.';
  else if (d.usesRemaining <= 0) blockedReason = 'Nothing left to draw on.';
  else if (restWeeksLeft > 0) {
    blockedReason = `Still recovering — ${restWeeksLeft} week${restWeeksLeft === 1 ? '' : 's'}.`;
  } else if (!state.vessels.some(v => !v.destination && v.location === cityId)) {
    blockedReason = `Requires being at ${cityName}.`;
  }

  return { unlocked, usesRemaining: d.usesRemaining, restWeeksLeft, blockedReason };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Exercise the gift. Throws on every condition `diviningAvailability` reports as blocked, using the
 * same checks in the same order, so the panel's disabled state and this function can't drift apart.
 * Sets the purpose's flag (a scripted event reacts on the following ADVANCE_WEEK, per the engine's
 * existing once-a-week trigger grain) and spends Conscience and four weeks of recovery.
 */
export function useDivining(state: GameState, purpose: DiviningPurpose): GameState {
  const availability = diviningAvailability(state, purpose);
  if (availability.blockedReason) throw new Error(availability.blockedReason);

  const d = diviningState(state);
  const cityId = DIVINING_CITIES[purpose];

  return {
    ...state,
    conscience: clamp(state.conscience - DIVINING_CONSCIENCE_COST, 0, 100),
    divining: {
      usesRemaining: d.usesRemaining - 1,
      restUntilWeek: state.week + DIVINING_REST_WEEKS,
    },
    flags: { ...state.flags, [DIVINING_FLAGS[purpose]]: true },
    flagWeeks: { ...(state.flagWeeks ?? {}), [DIVINING_FLAGS[purpose]]: state.week },
    lastDiviningEvent: {
      week: state.week,
      purpose,
      cityId,
      conscienceCost: DIVINING_CONSCIENCE_COST,
      restWeeks: DIVINING_REST_WEEKS,
    },
  };
}
