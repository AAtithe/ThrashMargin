/**
 * Sailing. A ship holds a plotted `route` (ports still to touch) and spends the sail points rolled
 * for it this turn against the current leg. Intermediate ports on a multi-leg course are sailed
 * straight past — a clipper does not have to call at every island. To trade somewhere on the way,
 * plot a course to that port instead. That is the routing decision the game is actually about.
 */
import { legDistance, planRoute, portName } from './content';
import type { PortId, Ship, Voyage } from './types';

export interface SailOutcome {
  ship: Ship;
  /** Sail points actually consumed. */
  spent: number;
  /** The port it tied up at this turn, if any. */
  arrivedAt: PortId | null;
  /** Ports it passed without stopping. */
  passed: PortId[];
}

/**
 * Sets a ship's course. Only legal while docked — a clipper does not come about mid-ocean.
 *
 * `via` lets the caller supply the exact path rather than take the shortest one. That matters once
 * there is wind: the player may deliberately choose a longer route with the weather behind them, and
 * without this the engine would quietly re-plan it as the shortest and make the choice a lie. Any
 * supplied path is validated hop by hop against the real chart, so a malformed one is rejected
 * rather than trusted.
 */
export function plotCourse(ship: Ship, destination: PortId, via?: PortId[]): Ship | null {
  if (ship.location === null) return null;
  if (ship.location === destination) return null;

  let path: PortId[] | null = null;
  if (via && via.length > 0 && via[via.length - 1] === destination) {
    let cursor = ship.location;
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
  if (!path) path = planRoute(ship.location, destination)?.path ?? null;
  if (!path || path.length === 0) return null;
  const route = { path };

  const first = route.path[0];
  return {
    ...ship,
    voyage: {
      route: route.path,
      legFrom: ship.location,
      legRemaining: legDistance(ship.location, first),
      legDistance: legDistance(ship.location, first),
    },
    location: null,
  };
}

/**
 * Re-orders a ship already at sea. She may only be sent to one of the two ports on the leg she is
 * currently sailing: carry on to the next one, or put about and run back the way she came.
 *
 * Authored — the source is silent on this. But the previous rule, that a course could never be
 * changed once set, was simply annoying: a card would be taken while you were three turns from the
 * quay and there was nothing you could do about it. This keeps the physical honesty (no teleporting
 * mid-ocean, and putting about costs you all the ground you had made) while giving the decision back.
 */
export function reorderAtSea(ship: Ship, destination: PortId): Ship | null {
  if (!ship.voyage) return null;
  const ahead = ship.voyage.route[0];
  const behind = ship.voyage.legFrom;

  // Carry on, but stop at the next port rather than sailing past it.
  if (destination === ahead) {
    if (ship.voyage.route.length === 1) return null; // already her destination
    return { ...ship, voyage: { ...ship.voyage, route: [ahead] } };
  }

  // Put about. Whatever she had made on this leg is now the distance back.
  if (destination === behind) {
    return {
      ...ship,
      voyage: {
        route: [behind],
        legFrom: ahead,
        legRemaining: ship.voyage.legDistance - ship.voyage.legRemaining,
        legDistance: ship.voyage.legDistance,
      },
    };
  }
  return null;
}

/** The two ports a ship at sea may be re-ordered to. Empty while she is in port. */
export function reachableAtSea(ship: Ship): PortId[] {
  if (!ship.voyage) return [];
  const ahead = ship.voyage.route[0];
  const behind = ship.voyage.legFrom;
  const out: PortId[] = [];
  if (ship.voyage.route.length > 1) out.push(ahead);
  out.push(behind);
  return out;
}

/** Abandons a plotted course. Only legal while still in port — i.e. before any points are spent. */
export function cancelCourse(ship: Ship): Ship | null {
  if (!ship.voyage) return null;
  const untouched = ship.voyage.legRemaining === ship.voyage.legDistance;
  if (!untouched) return null;
  return { ...ship, voyage: null, location: ship.voyage.legFrom };
}

/**
 * Spends up to `points` on the ship's current course. Rolls through as many legs as the points
 * allow. Any points left over when it ties up are lost — you cannot bank the wind.
 */
export function sail(ship: Ship, points: number): SailOutcome {
  if (!ship.voyage || points <= 0) {
    return { ship, spent: 0, arrivedAt: null, passed: [] };
  }

  let voyage: Voyage = { ...ship.voyage, route: ship.voyage.route.slice() };
  let budget = points;
  let spent = 0;
  const passed: PortId[] = [];

  while (budget > 0) {
    if (budget < voyage.legRemaining) {
      voyage = { ...voyage, legRemaining: voyage.legRemaining - budget };
      spent += budget;
      budget = 0;
      break;
    }

    // This leg completes.
    spent += voyage.legRemaining;
    budget -= voyage.legRemaining;
    const reached = voyage.route[0];
    const rest = voyage.route.slice(1);

    if (rest.length === 0) {
      // Final destination — tie up, and forfeit whatever is left of the roll.
      return {
        ship: { ...ship, voyage: null, location: reached },
        spent,
        arrivedAt: reached,
        passed,
      };
    }

    passed.push(reached);
    const nextLeg = legDistance(reached, rest[0]);
    voyage = { route: rest, legFrom: reached, legRemaining: nextLeg, legDistance: nextLeg };
  }

  return { ship: { ...ship, voyage }, spent, arrivedAt: null, passed };
}

/** Sail points still owed before the ship ties up at its destination. */
export function pointsToDestination(ship: Ship): number {
  if (!ship.voyage) return 0;
  let total = ship.voyage.legRemaining;
  const { route } = ship.voyage;
  for (let i = 0; i < route.length - 1; i++) total += legDistance(route[i], route[i + 1]);
  return total;
}

export const destinationOf = (ship: Ship): PortId | null =>
  ship.voyage ? ship.voyage.route[ship.voyage.route.length - 1] : null;

/** Human-readable position, for the log and the fleet list. */
export function positionText(ship: Ship): string {
  if (ship.location) return `in ${portName(ship.location)}`;
  const dest = destinationOf(ship);
  if (!dest) return 'at sea';
  return `at sea, ${pointsToDestination(ship)} points off ${portName(dest)}`;
}
