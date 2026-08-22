/**
 * World events — the deck of things that happen *to* the world rather than to one vehicle.
 *
 * Delays and theft already act on a single vehicle on a single leg. This module is the other half:
 * news that changes what every haulier should be doing this round. A strike shuts a depot; a glut
 * halves what a good is worth landing; the Admiralty posts a bounty and suddenly one commodity is
 * worth crossing an ocean for.
 *
 * Two design rules hold the whole module together:
 *
 *  - **Everything expires.** An event carries the last round it applies to, so no draw can put the
 *    game into a state it cannot leave. That is what makes it safe to close a depot at all.
 *  - **Nothing is drawn once the endgame has begun.** A declaration is a countdown with a fixed
 *    cost; a strike landing on the declarer's home depot mid-count would decide the game by dice
 *    rather than by play. The endgame took real work to make resolve exactly once and this module
 *    stays out of it.
 *
 * AUTHORED throughout. The 1988 rules have no event deck — this is the "flat gameplay" fix, and it
 * lives behind the `events` toggle so a faithful game never sees it.
 */

import { GOODS, DEPOTS, goodName, depotName } from './content';
import { nextInt, next } from './rng';
import type { GameState, GoodId, DepotId, WorldEvent, WorldEventKind } from './types';

/** Chance per round that the world does something, once events are switched on. */
export const EVENT_CHANCE = 0.3;
/**
 * How many past draws the deck remembers, to avoid dealing the same kind twice running.
 *
 * "No two of a kind *at once*" is not enough on its own: with a short span and five kinds, watching
 * the card stack gave four shortages in a row, each retiring just before the next was dealt. It read
 * as a stuck deck. Remembering the last two draws is what makes it feel dealt rather than looped.
 */
export const EVENT_MEMORY = 2;
/** Never more than this many at once, or the board becomes unreadable. */
export const MAX_ACTIVE_EVENTS = 2;
/** Inclusive round span an event covers, counted from the round it is drawn. */
export const EVENT_DURATION: Record<WorldEventKind, [number, number]> = {
  // The two that *stop* trade are kept short on purpose: they cost every haulier turns, and turns
  // are the one currency this game cannot mint. The three that only reprice it can run longer.
  strike: [2, 3],
  embargo: [2, 3],
  glut: [3, 5],
  shortage: [3, 5],
  bounty: [2, 4],
};

/** What a glut or a shortage does to the multiplier a landed lot is paid at. */
export const GLUT_FACTOR = 0.55;
export const SHORTAGE_FACTOR = 1.5;
/** Flat premium per unit landed while the Admiralty's bounty stands. */
export const BOUNTY_PER_UNIT = 45;

const KINDS: WorldEventKind[] = ['strike', 'embargo', 'glut', 'shortage', 'bounty'];

/** Depots worth striking: somewhere that actually trades, so the news bites. */
const STRIKEABLE: DepotId[] = DEPOTS.filter(p => p.supplies.length > 0 || p.demands.length > 0).map(p => p.id);

function headlineFor(kind: WorldEventKind, depot: DepotId | undefined, good: GoodId | undefined): {
  headline: string;
  detail: string;
} {
  switch (kind) {
    case 'strike':
      return {
        headline: `Strike at ${depotName(depot!)}`,
        detail: `The lumpers have downed tools at ${depotName(depot!)}. Nothing loads and nothing lands there until the dispute is settled.`,
      };
    case 'embargo':
      return {
        headline: `${goodName(good!)} embargoed`,
        detail: `An order in council forbids the lading of ${goodName(good!).toLowerCase()} in any depot. Cargo already in the hold may still be landed.`,
      };
    case 'glut':
      return {
        headline: `Glut in ${goodName(good!).toLowerCase()}`,
        detail: `The market is swimming in ${goodName(good!).toLowerCase()}. Deliveries fetch barely half their worth while it lasts.`,
      };
    case 'shortage':
      return {
        headline: `${goodName(good!)} scarce`,
        detail: `${goodName(good!)} is not to be had for love nor money. Anything landed now fetches half again.`,
      };
    case 'bounty':
      return {
        headline: `Admiralty bounty on ${goodName(good!).toLowerCase()}`,
        detail: `The Admiralty will pay ${BOUNTY_PER_UNIT} a unit over the market for ${goodName(good!).toLowerCase()} landed under contract.`,
      };
  }
}

/**
 * Draws at most one event for the round that is just starting. Pure: takes the seed, hands back the
 * advanced seed, and returns null when nothing happens — which is most rounds.
 */
export function drawEvent(
  seed: number,
  round: number,
  active: WorldEvent[],
  nextId: number,
  recent: WorldEventKind[] = [],
): { seed: number; event: WorldEvent | null } {
  if (active.length >= MAX_ACTIVE_EVENTS) return { seed, event: null };

  const chance = next(seed);
  if (chance.value >= EVENT_CHANCE) return { seed: chance.seed, event: null };

  // Never two of a kind at once, and never a repeat of what was just dealt.
  const available = KINDS.filter(
    k => !active.some(e => e.kind === k) && !recent.includes(k),
  );
  if (available.length === 0) return { seed: chance.seed, event: null };

  const pick = nextInt(chance.seed, 0, available.length - 1);
  const kind = available[pick.value];

  let s = pick.seed;
  let depot: DepotId | undefined;
  let good: GoodId | undefined;

  if (kind === 'strike') {
    const p = nextInt(s, 0, STRIKEABLE.length - 1);
    s = p.seed;
    depot = STRIKEABLE[p.value];
  } else {
    const g = nextInt(s, 0, GOODS.length - 1);
    s = g.seed;
    good = GOODS[g.value].id;
  }

  const [minRounds, maxRounds] = EVENT_DURATION[kind];
  const span = nextInt(s, minRounds, maxRounds);
  s = span.seed;

  const { headline, detail } = headlineFor(kind, depot, good);
  const event: WorldEvent = {
    id: nextId,
    kind,
    from: round,
    until: round + span.value - 1,
    headline,
    detail,
  };
  if (depot !== undefined) event.depot = depot;
  if (good !== undefined) event.good = good;

  return { seed: s, event };
}

/** Events that have run their course, given the round now starting. */
export const expired = (events: WorldEvent[], round: number): WorldEvent[] =>
  events.filter(e => e.until < round);

export const stillRunning = (events: WorldEvent[], round: number): WorldEvent[] =>
  events.filter(e => e.until >= round);

// --- Queries the rest of the sim asks -----------------------------------------------------------
//
// Every one of these is a no-op on a game with events switched off, because `state.events` is then
// always empty. No caller needs to check the toggle.

const activeOf = (state: GameState): WorldEvent[] => state.events ?? [];

/** Is this depot shut to all trade — no lading, no landing? */
export const depotStruck = (state: GameState, depot: DepotId): boolean =>
  activeOf(state).some(e => e.kind === 'strike' && e.depot === depot);

/** Is this good forbidden to load anywhere? Cargo already aboard is unaffected. */
export const goodEmbargoed = (state: GameState, good: GoodId): boolean =>
  activeOf(state).some(e => e.kind === 'embargo' && e.good === good);

/**
 * What a landed lot of this good is actually worth, given the contract multiplier.
 *
 * Returned as a rate rather than applied here so the AI can score a plan with the same arithmetic
 * the reducer will use — one function, no drift between what the AI expects and what it is paid.
 */
export function landedValue(state: GameState, good: GoodId, paid: number, multiplier: number): number {
  let factor = multiplier;
  let bonus = 0;
  for (const e of activeOf(state)) {
    if (e.good !== good) continue;
    if (e.kind === 'glut') factor *= GLUT_FACTOR;
    if (e.kind === 'shortage') factor *= SHORTAGE_FACTOR;
    if (e.kind === 'bounty') bonus += BOUNTY_PER_UNIT;
  }
  return Math.round(paid * factor) + bonus;
}

/** The deck's memory after a draw, trimmed to EVENT_MEMORY. Newest first. */
export const remember = (recent: WorldEventKind[], kind: WorldEventKind): WorldEventKind[] =>
  [kind, ...recent].slice(0, EVENT_MEMORY);

/** One-line summary for the news banner, newest first. */
export const newsLine = (events: WorldEvent[]): string =>
  events.map(e => e.headline).join('  ·  ');
