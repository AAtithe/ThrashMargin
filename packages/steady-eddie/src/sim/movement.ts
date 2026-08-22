/**
 * Driving. A vehicle holds a plotted `route` (depots still to touch) and spends the drive points rolled
 * for it this turn against the current leg. Intermediate depots on a multi-leg course are drove
 * straight past — a vehicle does not have to call at every depot. To trade somewhere on the way,
 * plot a course to that depot instead. That is the routing decision the game is actually about.
 */
import { legDistance, planRoute, depotName } from './content';
import type { DepotId, Vehicle, Run } from './types';

export interface DriveOutcome {
  vehicle: Vehicle;
  /** Sail points actually consumed. */
  spent: number;
  /** The depot it parked up at this turn, if any. */
  arrivedAt: DepotId | null;
  /** Depots it passed without stopping. */
  passed: DepotId[];
}

/**
 * Sets a vehicle's course. Only legal while parked — a vehicle does not turn around mid-journey.
 *
 * `via` lets the caller supply the exact path rather than take the shortest one. That matters once
 * there is weather: the player may deliberately choose a longer route that dodges a risky leg, and
 * without this the engine would quietly re-plan it as the shortest and make the choice a lie. Any
 * supplied path is validated hop by hop against the real chart, so a malformed one is rejected
 * rather than trusted.
 */
export function plotCourse(vehicle: Vehicle, destination: DepotId, via?: DepotId[]): Vehicle | null {
  if (vehicle.location === null) return null;
  if (vehicle.location === destination) return null;

  let path: DepotId[] | null = null;
  if (via && via.length > 0 && via[via.length - 1] === destination) {
    let cursor = vehicle.location;
    let valid = true;
    for (const step of via) {
      if (!Number.isFinite(legDistance(cursor, step))) {
        valid = false;
        break;
      }
      cursor = step;
    }
    if (valid) path = via.slice();
  }
  if (!path) path = planRoute(vehicle.location, destination)?.path ?? null;
  if (!path || path.length === 0) return null;
  const route = { path };

  const first = route.path[0];
  return {
    ...vehicle,
    run: {
      route: route.path,
      legFrom: vehicle.location,
      legRemaining: legDistance(vehicle.location, first),
      legDistance: legDistance(vehicle.location, first),
    },
    location: null,
  };
}

/**
 * Re-orders a vehicle already on the road. She may only be sent to one of the two depots on the leg she is
 * currently driving: carry on to the next one, or turn back and run back the way she came.
 *
 * Authored — the source is silent on this. But the previous rule, that a course could never be
 * changed once set, was simply annoying: a card would be taken while you were three turns from the
 * depot and there was nothing you could do about it. This keeps the physical honesty (no teleporting
 * mid-route, and putting about costs you all the ground you had made) while giving the decision back.
 */
export function reorderOnRoad(vehicle: Vehicle, destination: DepotId): Vehicle | null {
  if (!vehicle.run) return null;
  const ahead = vehicle.run.route[0];
  const behind = vehicle.run.legFrom;

  // Carry on, but stop at the next depot rather than driving past it.
  if (destination === ahead) {
    if (vehicle.run.route.length === 1) return null; // already her destination
    return { ...vehicle, run: { ...vehicle.run, route: [ahead] } };
  }

  // Turn back. Whatever she had made on this leg is now the distance back.
  if (destination === behind) {
    return {
      ...vehicle,
      run: {
        route: [behind],
        legFrom: ahead,
        legRemaining: vehicle.run.legDistance - vehicle.run.legRemaining,
        legDistance: vehicle.run.legDistance,
      },
    };
  }
  return null;
}

/** The two depots a vehicle on the road may be re-ordered to. Empty while she is in depot. */
export function reachableOnRoad(vehicle: Vehicle): DepotId[] {
  if (!vehicle.run) return [];
  const ahead = vehicle.run.route[0];
  const behind = vehicle.run.legFrom;
  const out: DepotId[] = [];
  if (vehicle.run.route.length > 1) out.push(ahead);
  out.push(behind);
  return out;
}

/** Abandons a plotted course. Only legal while still in depot — i.e. before any points are spent. */
export function cancelCourse(vehicle: Vehicle): Vehicle | null {
  if (!vehicle.run) return null;
  const untouched = vehicle.run.legRemaining === vehicle.run.legDistance;
  if (!untouched) return null;
  return { ...vehicle, run: null, location: vehicle.run.legFrom };
}

/**
 * Spends up to `points` on the vehicle's current course. Rolls through as many legs as the points
 * allow. Any points left over when it parks up are lost — you cannot bank a good roll.
 */
export function drive(vehicle: Vehicle, points: number): DriveOutcome {
  if (!vehicle.run || points <= 0) {
    return { vehicle, spent: 0, arrivedAt: null, passed: [] };
  }

  let run: Run = { ...vehicle.run, route: vehicle.run.route.slice() };
  let budget = points;
  let spent = 0;
  const passed: DepotId[] = [];

  while (budget > 0) {
    if (budget < run.legRemaining) {
      run = { ...run, legRemaining: run.legRemaining - budget };
      spent += budget;
      budget = 0;
      break;
    }

    // This leg completes.
    spent += run.legRemaining;
    budget -= run.legRemaining;
    const reached = run.route[0];
    const rest = run.route.slice(1);

    if (rest.length === 0) {
      // Final destination — tie up, and forfeit whatever is left of the roll.
      return {
        vehicle: { ...vehicle, run: null, location: reached },
        spent,
        arrivedAt: reached,
        passed,
      };
    }

    passed.push(reached);
    const nextLeg = legDistance(reached, rest[0]);
    run = { route: rest, legFrom: reached, legRemaining: nextLeg, legDistance: nextLeg };
  }

  return { vehicle: { ...vehicle, run }, spent, arrivedAt: null, passed };
}

/** Drive points still owed before the vehicle parks up at its destination. */
export function pointsToDestination(vehicle: Vehicle): number {
  if (!vehicle.run) return 0;
  let total = vehicle.run.legRemaining;
  const { route } = vehicle.run;
  for (let i = 0; i < route.length - 1; i++) total += legDistance(route[i], route[i + 1]);
  return total;
}

export const destinationOf = (vehicle: Vehicle): DepotId | null =>
  vehicle.run ? vehicle.run.route[vehicle.run.route.length - 1] : null;

/** Human-readable position, for the log and the fleet list. */
export function positionText(vehicle: Vehicle): string {
  if (vehicle.location) return `in ${depotName(vehicle.location)}`;
  const dest = destinationOf(vehicle);
  if (!dest) return 'on the road';
  return `on the road, ${pointsToDestination(vehicle)} points off ${depotName(dest)}`;
}
