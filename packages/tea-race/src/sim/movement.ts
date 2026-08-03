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

/** Sets a ship's course. Only legal while docked — a clipper does not come about mid-ocean. */
export function plotCourse(ship: Ship, destination: PortId): Ship | null {
  if (ship.location === null) return null;
  if (ship.location === destination) return null;
  const route = planRoute(ship.location, destination);
  if (!route || route.path.length === 0) return null;

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
        ship: { ...ship, voyage: null, location: reached, cargo: ship.cargo },
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
