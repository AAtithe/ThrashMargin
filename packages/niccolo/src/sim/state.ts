import { CHARACTERS } from './content';
import { STARTING_CONSCIENCE } from './characters';
import { initialExchangeRates } from './currency';
import { checkTriggers } from './events';
import { initialHouseRelations } from './houses';
import { initialScarcity } from './market';
import { generateNews, resolveArrivals } from './news';
import type { GameState } from './types';

/** Starting stake: small and dangerous, as the design pillar demands — the stake Chapter 0's own
 * finale hands Claes once he's formally made the house's factor, and what a skip-prologue
 * campaign starts with directly. */
const STARTING_CASH = 40;
const SHIP_CAPACITY = 20;

function newShip(): GameState['vessels'][number] {
  return {
    id: 'ship_1',
    kind: 'ship',
    name: 'The Charetty ship',
    location: 'bruges',
    destination: null,
    routeId: null,
    weeksRemaining: 0,
    cargo: {},
    capacity: SHIP_CAPACITY,
  };
}

function newCourier(): GameState['vessels'][number] {
  return {
    id: 'courier_1',
    kind: 'courier',
    name: 'The dispatch rider',
    location: 'bruges',
    destination: null,
    routeId: null,
    weeksRemaining: 0,
    cargo: {},
    capacity: 0,
  };
}

/** The 3 of the 6 Chapter 1 officers Chapter 0 seeds `pending` (the design doc's "3 friendships"
 * start), joining narratively as its own events unfold. Skipping the prologue force-activates
 * only these — never *every* `pending` character, which would wrongly also activate Chapter 2's
 * own mid-campaign joiner (Diniz), whose status is that chapter's business, not Chapter 0's. */
const CHAPTER0_PENDING_IDS = ['tobie', 'gregorio', 'astorre'];

export interface CreateInitialStateOptions {
  /** Today's exact pre-Chapter-0 behaviour: both vessels, 40f, every character active,
   * `chapter0_complete` already true — for returning players who don't want to replay the
   * prologue. Default (false/omitted) starts Claes with nothing yet — see Chapter 0's own
   * content pack for how he earns his way into the same state this produces immediately. */
  skipPrologue?: boolean;
  /** Lobby "Hide chapter objectives" toggle (Phase 14). Default (false/omitted) shows them. */
  hideObjectives?: boolean;
  /** Lobby "hotseat house" toggle (Phase 14) — which house, if any, a seated human plays this
   * campaign instead of `sim/houses.ts`'s own formulas. Default (undefined/null) is no house. */
  hotseatHouseId?: string | null;
}

export function createInitialState(id: string, name?: string, options?: CreateInitialStateOptions): GameState {
  const skipPrologue = options?.skipPrologue ?? false;
  const objectivesHidden = options?.hideObjectives ?? false;
  const hotseatHouseId = options?.hotseatHouseId ?? null;
  const scarcity = initialScarcity();
  const characters = CHARACTERS.map(c => ({
    ...c,
    skills: { ...c.skills },
    status: skipPrologue && CHAPTER0_PENDING_IDS.includes(c.id) ? ('active' as const) : c.status,
  }));
  const seedNews = generateNews(scarcity, 0, {}, characters);
  const { arrived, stillPending } = resolveArrivals(seedNews, 0);
  const knownPrices: GameState['knownPrices'] = {};
  for (const item of arrived) knownPrices[item.cityId] = item;

  const state: GameState = {
    id,
    name,
    week: 0,
    cash: skipPrologue ? STARTING_CASH : 0,
    scarcity,
    pendingNews: stillPending,
    knownPrices,
    courierInvestment: {},
    exchangeRates: initialExchangeRates(),
    obligations: [],
    insolvent: false,
    characters,
    conscience: STARTING_CONSCIENCE,
    // Chapter 1's own opening event waits on this flag (see content/events/chapter1.json); a
    // skip-prologue campaign sets it immediately so that event fires at week 0 exactly as it did
    // before Chapter 0 existed.
    flags: skipPrologue ? { chapter0_complete: true } : {},
    firedEvents: [],
    pendingEvents: [],
    secrets: [],
    condotta: null,
    houseRelations: initialHouseRelations(),
    agents: [],
    estate: null,
    insurance: [],
    lastVoyageEvent: null,
    lastSabotageEvent: null,
    expedition: null,
    lastExpeditionEvent: null,
    evidence: [],
    divining: null,
    lastDiviningEvent: null,
    flagWeeks: skipPrologue ? { chapter0_complete: 0 } : {},
    objectivesHidden,
    hotseatHouseId,
    // Seeded to match the campaign's actual starting chapter (1 for skip-prologue, which begins
    // already past chapter0_complete; 0 otherwise) so no "Chapter 0 complete" card falsely appears
    // at creation for a campaign that never played chapter 0 at all.
    lastAcknowledgedChapter: skipPrologue ? 1 : 0,
    vessels: skipPrologue ? [newShip(), newCourier()] : [newCourier()],
  };

  return checkTriggers(state);
}
