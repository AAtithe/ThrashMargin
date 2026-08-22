/**
 * Seasons and road weather.
 *
 * The Tea Race derived a directional wind from real geography — a leg's mid-latitude and the way you
 * sailed it gave opposite answers for the outbound and homeward passages, which was the whole
 * substance of clipper routing. That system has no UK equivalent: a road doesn't have a prevailing
 * wind, and a lorry doesn't sail closer to or further from one. Forcing a directional model onto a
 * country-sized road network would be authored decoration, not a real mechanic, so it is dropped
 * rather than reskinned.
 *
 * What replaces it is simpler and, for a road network, more honest: each leg carries its own
 * authored `weatherRisk` (legs.json — the Pennine crossings and the Somerset Levels are the obvious
 * candidates, the same way The Tea Race authored piracy per leg rather than deriving it), and a
 * season multiplies that risk rather than reversing it. Every leg without an authored risk is
 * always clear, in every season — there is no latitude band making an otherwise-safe road worse.
 */
import { DEPOTS, legBetween, legDistance, searchRoute, type Route } from './content';
import { next } from './rng';
import { AEROKIT_DELAY_REDUCTION, AEROKIT_SPEED_BONUS, ROUNDS_PER_SEASON, DELAY_CHANCE_PER_RATING, DELAY_SETBACK } from './rules';
import type { DepotId, Vehicle } from './types';

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export const SEASON_NAMES: Record<Season, string> = {
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
  winter: 'Winter',
};

/**
 * The season is a pure function of the round — derived, never stored, so there is nothing to migrate
 * and the same round always yields the same season on every client.
 */
export function seasonOf(round: number): Season {
  const index = Math.floor(Math.max(0, round - 1) / ROUNDS_PER_SEASON) % SEASONS.length;
  return SEASONS[index];
}

/** Rounds until the season turns. Shown in the header so a haulier can time a run. */
export function roundsLeftInSeason(round: number): number {
  return ROUNDS_PER_SEASON - (Math.max(0, round - 1) % ROUNDS_PER_SEASON);
}

/** Which year of the game this is, 1-based. Flavour for the header. */
export const gameYear = (round: number): number =>
  Math.floor(Math.max(0, round - 1) / (ROUNDS_PER_SEASON * SEASONS.length)) + 1;

/**
 * How much a season worsens an already-risky leg. Winter is worst (ice, fog, short daylight),
 * summer is mildest (roadworks aside, this is when the network runs most freely).
 *
 * Zero for a leg with no authored risk at all — the point of authoring risk per leg rather than
 * deriving it from geography is that most of the network simply isn't exposed to this, in any
 * season, and no formula should invent exposure a real road doesn't have.
 */
const SEASON_RISK_BONUS: Record<Season, number> = {
  winter: 2,
  autumn: 1,
  spring: 1,
  summer: 0,
};

// ---------------------------------------------------------------------------
// Delays
// ---------------------------------------------------------------------------

/** How delay-prone a leg is this season, 0 upward. Zero for any leg with no authored weatherRisk. */
export function delayRating(from: DepotId, to: DepotId, season: Season): number {
  const base = legBetween(from, to)?.weatherRisk ?? 0;
  if (base <= 0) return 0;
  return base + SEASON_RISK_BONUS[season];
}

export interface DelayOutcome {
  /** Drive points the vehicle is driven back along her current leg. Zero means she got through. */
  setback: number;
  rating: number;
  seed: number;
}

/**
 * Rolls for weather on a vehicle on the road. Delays cost **time only** — never a vehicle, never a
 * cargo. Keeping that line clean is what stops weather and theft feeling like one undifferentiated
 * tax: the road delays you, thieves rob you.
 */
export function resolveDelay(seed: number, vehicle: Vehicle, season: Season): DelayOutcome {
  if (!vehicle.run) return { setback: 0, rating: 0, seed };

  const rating = delayRating(vehicle.run.legFrom, vehicle.run.route[0], season);
  if (rating <= 0) return { setback: 0, rating, seed };

  const roll = next(seed);
  if (roll.value >= rating * DELAY_CHANCE_PER_RATING) {
    return { setback: 0, rating, seed: roll.seed };
  }

  const magnitude = next(roll.seed);
  let setback =
    DELAY_SETBACK.min + Math.floor(magnitude.value * (DELAY_SETBACK.max - DELAY_SETBACK.min + 1));

  if (vehicle.fittings?.aeroKit) setback = Math.max(1, Math.round(setback * AEROKIT_DELAY_REDUCTION));

  // She can be driven back, but never behind the depot she set off from — otherwise a long enough
  // run of bad weather could push a vehicle's remaining distance past her own leg length.
  const room = vehicle.run.legDistance - vehicle.run.legRemaining;
  return { setback: Math.min(setback, room), rating, seed: magnitude.seed };
}

// ---------------------------------------------------------------------------
// Effective speed, for route planning and for the AI
// ---------------------------------------------------------------------------

/**
 * Expected drive points lost to weather on a single passage: the chance of a delay times its
 * average setback. Zero on any leg with no authored risk, whatever the season.
 */
function expectedDelayLoss(from: DepotId, to: DepotId, season: Season, aeroKit: boolean): number {
  const rating = delayRating(from, to, season);
  if (rating <= 0) return 0;
  const chance = Math.min(1, rating * DELAY_CHANCE_PER_RATING);
  const avgSetback = (DELAY_SETBACK.min + DELAY_SETBACK.max) / 2;
  const reduced = aeroKit ? avgSetback * AEROKIT_DELAY_REDUCTION : avgSetback;
  return chance * reduced;
}

/** Average drive points a vehicle makes on a given passage: the 2d6 mean less the weather it expects to eat. */
export function effectiveSpeed(from: DepotId, to: DepotId, season: Season, aeroKit = false): number {
  const loss = expectedDelayLoss(from, to, season, aeroKit);
  return Math.max(1, 7 - loss + (aeroKit ? AEROKIT_SPEED_BONUS : 0));
}

/**
 * Turns a passage is expected to take. This — not raw distance — is what route planning costs
 * edges by once weather is in play, so a route through a fog-prone leg in winter can genuinely lose
 * to a longer one that avoids it.
 */
export function expectedTurns(
  from: DepotId,
  to: DepotId,
  distance: number,
  season: Season,
  aeroKit = false,
): number {
  return distance / effectiveSpeed(from, to, season, aeroKit);
}

// ---------------------------------------------------------------------------
// Weather-aware route planning
// ---------------------------------------------------------------------------

/**
 * The fastest route in a given season, which is not always the shortest one once a fog- or
 * flood-prone leg is involved.
 */
export function planFastestRoute(
  from: DepotId,
  to: DepotId,
  season: Season,
  aeroKit = false,
): Route | null {
  const route = searchRoute(from, to, (a, b, distance) =>
    expectedTurns(a, b, distance, season, aeroKit),
  );
  if (!route) return null;
  return { ...route, turns: routeTurns(from, route.path, season, aeroKit) };
}

/** Expected turns for a whole path, leg by leg, each with its own season-scaled weather risk. */
export function routeTurns(
  from: DepotId,
  path: DepotId[],
  season: Season,
  aeroKit = false,
): number {
  let total = 0;
  let cursor = from;
  for (const step of path) {
    total += expectedTurns(cursor, step, legDistance(cursor, step), season, aeroKit);
    cursor = step;
  }
  return total;
}

/**
 * Expected turns between every pair of depots, per season. Four small tables built once at module
 * load — trivial for a graph this size, and it keeps the AI's scoring cheap.
 */
export const SEASON_TURN_MATRIX: Record<Season, Record<DepotId, Record<DepotId, number>>> = (() => {
  const out = {} as Record<Season, Record<DepotId, Record<DepotId, number>>>;
  for (const season of SEASONS) {
    const table: Record<DepotId, Record<DepotId, number>> = {};
    for (const from of DEPOTS) {
      table[from.id] = { [from.id]: 0 };
      for (const to of DEPOTS) {
        if (to.id === from.id) continue;
        table[from.id][to.id] = planFastestRoute(from.id, to.id, season)?.turns ?? Infinity;
      }
    }
    out[season] = table;
  }
  return out;
})();

/** Expected turns from a to b in a season, by the fastest route. */
export const turnsBetween = (a: DepotId, b: DepotId, season: Season): number =>
  SEASON_TURN_MATRIX[season]?.[a]?.[b] ?? Infinity;
