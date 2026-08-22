/**
 * Theft, recoveries and insurance.
 *
 * The design constraint that shapes all of this: **taking the cargo off a haulier who was winning
 * the race is the harshest thing this game can do**, so it is the uncommon outcome. Most encounters
 * cost money and let the run continue. That keeps the race alive, which weather does too by
 * costing only time. The two hazards are deliberately kept distinct — bad weather delays you,
 * thieves rob you — so that they never blur into one undifferentiated tax.
 *
 * Unlike weather, theft is **authored** rather than derived: it lives on `RoadLeg.theft` in
 * legs.json, because a handful of real corridors are dangerous for reasons of history and geography
 * no formula could find on its own.
 */
import { legBetween, legDistance } from './content';
import { next } from './rng';
import {
  TRACKER_ENCOUNTER_REDUCTION,
  TRACKER_LOSS_TO_RECOVERY,
  INSURANCE_BASE_RATE,
  INSURANCE_MINIMUM_PREMIUM,
  INSURANCE_RISK_LOADING,
  THEFT_CHANCE_PER_RATING,
  THEFT_RECOVERY_SHARE,
  RECOVERY_COST_BOUNDS,
  RECOVERY_COST_SHARE,
} from './rules';
import { delayRating, type Season } from './weather';
import type { DepotId, Vehicle } from './types';

/** How theft-prone the road between two depots is. 0 is safe. */
export const theftRating = (from: DepotId, to: DepotId): number =>
  legBetween(from, to)?.theft ?? 0;

/** The rating for the leg a vehicle is currently driving. */
export function theftRatingForVehicle(vehicle: Vehicle): number {
  if (!vehicle.run) return 0;
  return theftRating(vehicle.run.legFrom, vehicle.run.route[0]);
}

export type TheftOutcome =
  | { kind: 'none'; seed: number }
  /** Held up, and let go for a fee rather than losing the load. */
  | { kind: 'recovery'; amount: number; seed: number }
  /** They took the cargo. */
  | { kind: 'seizure'; seed: number };

/**
 * Rolls for a theft encounter on a vehicle on the road.
 *
 * A tracker does two separate jobs, which is what makes it worth £120: it halves the chance of
 * being targeted at all, and it turns most of the seizures that do happen into a fast recovery,
 * because a tracked vehicle is worth stopping but not worth the risk of actually driving off in.
 */
export function resolveTheft(seed: number, vehicle: Vehicle, haulierCash: number): TheftOutcome {
  const rating = theftRatingForVehicle(vehicle);
  if (rating <= 0) return { kind: 'none', seed };

  let chance = rating * THEFT_CHANCE_PER_RATING;
  if (vehicle.fittings?.tracker) chance *= TRACKER_ENCOUNTER_REDUCTION;

  const encounter = next(seed);
  if (encounter.value >= chance) return { kind: 'none', seed: encounter.seed };

  const severity = next(encounter.seed);
  let seizure = severity.value >= THEFT_RECOVERY_SHARE;

  // A tracker talks most of these down to a paid recovery instead of a total loss.
  let s = severity.seed;
  if (seizure && vehicle.fittings?.tracker) {
    const recovered = next(s);
    s = recovered.seed;
    if (recovered.value < TRACKER_LOSS_TO_RECOVERY) seizure = false;
  }

  // An empty load bed has nothing worth taking, so they settle for a cash grab instead. Without
  // this a haulier running light would "lose" a cargo that was never aboard.
  if (seizure && vehicle.hold.length === 0) seizure = false;

  if (seizure) return { kind: 'seizure', seed: s };

  const amount = Math.min(
    haulierCash,
    Math.max(RECOVERY_COST_BOUNDS.min, Math.min(RECOVERY_COST_BOUNDS.max, Math.round(haulierCash * RECOVERY_COST_SHARE))),
  );
  return { kind: 'recovery', amount, seed: s };
}

// ---------------------------------------------------------------------------
// Insurance
// ---------------------------------------------------------------------------

/**
 * How dangerous a plotted course is, normalised to roughly 0..1. Combines the weather the route
 * will meet with how theft-prone it is, so a premium prices the actual passage rather than a flat rate.
 */
export function routeRisk(from: DepotId, path: DepotId[], season: Season): number {
  if (path.length === 0) return 0;
  let weighted = 0;
  let distance = 0;
  let cursor = from;
  for (const step of path) {
    const legLength = legDistance(cursor, step);
    // Theft weighs heavier than weather here because insurance only covers what a thief takes.
    weighted += (delayRating(cursor, step, season) + theftRating(cursor, step) * 2.5) * legLength;
    distance += legLength;
    cursor = step;
  }
  if (distance === 0) return 0;
  return Math.max(0, Math.min(1, weighted / distance / 8));
}

/**
 * The premium for one run under a standing open policy, charged at dispatch.
 *
 * Priced off the cargo actually aboard, because that is what is at risk — plus a floor, since the
 * policy still covers a paid recovery on a vehicle running light.
 */
export function insurancePremium(insuredValue: number, risk: number): number {
  // No cargo, no premium — and correspondingly no cover. It is a cargo policy, and charging the
  // minimum to insure an empty vehicle is what made the old numbers a tax rather than a choice.
  if (insuredValue <= 0) return 0;
  const rate = INSURANCE_BASE_RATE * (1 + risk * INSURANCE_RISK_LOADING);
  return Math.max(INSURANCE_MINIMUM_PREMIUM, Math.round(insuredValue * rate));
}

/**
 * What the underwriters pay out. Goods taken and recovery fees paid are covered; **lost time never
 * is**. A delay that costs a haulier the race is not an insurable loss, and pretending otherwise
 * would make the policy the only purchase in the game worth making.
 */
export function indemnityFor(outcome: TheftOutcome, vehicle: Vehicle): number {
  // Cover follows the premium: an empty vehicle pays nothing and is therefore covered for nothing.
  // Without this the policy would be free money on every light passage.
  if (vehicle.hold.length === 0) return 0;
  if (outcome.kind === 'recovery') return outcome.amount;
  if (outcome.kind === 'seizure') return vehicle.hold.reduce((n, lot) => n + lot.paid, 0);
  return 0;
}
