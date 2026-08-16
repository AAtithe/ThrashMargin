/**
 * Piracy, ransoms and insurance.
 *
 * The design constraint that shapes all of this: **taking the cargo off a captain who was winning
 * the race is the harshest thing this game can do**, so it is the uncommon outcome. Most encounters
 * cost money and let the voyage continue. That keeps the race alive, which weather does too by
 * costing only time. The two hazards are deliberately kept distinct — the sea delays you, pirates
 * rob you — so that they never blur into one undifferentiated tax.
 *
 * Unlike the wind, piracy is **authored** rather than derived: it lives on `SeaLeg.piracy` in
 * legs.json, because the Malacca Strait was dangerous for reasons no formula over latitude would
 * ever find.
 */
import { legBetween, legDistance } from './content';
import { next } from './rng';
import {
  GUNS_ENCOUNTER_REDUCTION,
  GUNS_SEIZURE_TO_RANSOM,
  INSURANCE_BASE_RATE,
  INSURANCE_MINIMUM_PREMIUM,
  INSURANCE_RISK_LOADING,
  PIRACY_CHANCE_PER_RATING,
  PIRACY_RANSOM_SHARE,
  RANSOM_BOUNDS,
  RANSOM_CASH_SHARE,
} from './rules';
import { stormRating, type Season } from './weather';
import type { PortId, Ship } from './types';

/** How piratical the waters between two ports are. 0 is safe. */
export const piracyRating = (from: PortId, to: PortId): number =>
  legBetween(from, to)?.piracy ?? 0;

/** The rating for the leg a ship is currently sailing. */
export function piracyRatingForShip(ship: Ship): number {
  if (!ship.voyage) return 0;
  return piracyRating(ship.voyage.legFrom, ship.voyage.route[0]);
}

export type PiracyOutcome =
  | { kind: 'none'; seed: number }
  /** They took a cut and let her go. */
  | { kind: 'ransom'; amount: number; seed: number }
  /** They took the cargo. */
  | { kind: 'seizure'; seed: number };

/**
 * Rolls for a piracy encounter on a ship at sea.
 *
 * Guns do two separate jobs, which is what makes them worth £120: they halve the chance of being
 * troubled at all, and they turn most of the seizures that do happen into a ransom, because a ship
 * that can shoot back is worth boarding but not worth fighting.
 */
export function resolvePiracy(seed: number, ship: Ship, captainCash: number): PiracyOutcome {
  const rating = piracyRatingForShip(ship);
  if (rating <= 0) return { kind: 'none', seed };

  let chance = rating * PIRACY_CHANCE_PER_RATING;
  if (ship.fittings?.guns) chance *= GUNS_ENCOUNTER_REDUCTION;

  const encounter = next(seed);
  if (encounter.value >= chance) return { kind: 'none', seed: encounter.seed };

  const severity = next(encounter.seed);
  let seizure = severity.value >= PIRACY_RANSOM_SHARE;

  // Guns talk most boarders down to a ransom.
  let s = severity.seed;
  if (seizure && ship.fittings?.guns) {
    const talkedDown = next(s);
    s = talkedDown.seed;
    if (talkedDown.value < GUNS_SEIZURE_TO_RANSOM) seizure = false;
  }

  // An empty hold has nothing worth seizing, so they settle for money instead. Without this a
  // captain running light would "lose" a cargo that was never aboard.
  if (seizure && ship.hold.length === 0) seizure = false;

  if (seizure) return { kind: 'seizure', seed: s };

  const amount = Math.min(
    captainCash,
    Math.max(RANSOM_BOUNDS.min, Math.min(RANSOM_BOUNDS.max, Math.round(captainCash * RANSOM_CASH_SHARE))),
  );
  return { kind: 'ransom', amount, seed: s };
}

// ---------------------------------------------------------------------------
// Insurance
// ---------------------------------------------------------------------------

/**
 * How dangerous a plotted course is, normalised to roughly 0..1. Combines the weather the route
 * will meet with how piratical it is, so a premium prices the actual passage rather than a flat rate.
 */
export function routeRisk(from: PortId, path: PortId[], season: Season): number {
  if (path.length === 0) return 0;
  let weighted = 0;
  let distance = 0;
  let cursor = from;
  for (const step of path) {
    const legLength = legDistance(cursor, step);
    // Pirates weigh heavier than weather here because insurance only covers what they take.
    weighted += (stormRating(cursor, step, season) + piracyRating(cursor, step) * 2.5) * legLength;
    distance += legLength;
    cursor = step;
  }
  if (distance === 0) return 0;
  return Math.max(0, Math.min(1, weighted / distance / 8));
}

/**
 * The premium for one voyage under a standing open policy, charged at cast-off.
 *
 * Priced off the cargo actually aboard, because that is what is at risk — plus a floor, since the
 * policy still covers ransoms on a ship running light.
 */
export function insurancePremium(insuredValue: number, risk: number): number {
  // No cargo, no premium — and correspondingly no cover. It is a cargo policy, and charging the
  // minimum to insure an empty hull is what made the old numbers a tax rather than a choice.
  if (insuredValue <= 0) return 0;
  const rate = INSURANCE_BASE_RATE * (1 + risk * INSURANCE_RISK_LOADING);
  return Math.max(INSURANCE_MINIMUM_PREMIUM, Math.round(insuredValue * rate));
}

/**
 * What the underwriters pay out. Goods taken and ransoms paid are covered; **lost time never is**.
 * A storm that costs a captain the race is not an insurable loss, and pretending otherwise would
 * make the policy the only purchase in the game worth making.
 */
export function indemnityFor(outcome: PiracyOutcome, ship: Ship): number {
  // Cover follows the premium: an empty hull pays nothing and is therefore covered for nothing.
  // Without this the policy would be free money on every light passage.
  if (ship.hold.length === 0) return 0;
  if (outcome.kind === 'ransom') return outcome.amount;
  if (outcome.kind === 'seizure') return ship.hold.reduce((n, lot) => n + lot.paid, 0);
  return 0;
}
