/**
 * What still wants the captain's attention this turn.
 *
 * The problem this exists for: a ship tied up at a quay with her dice already rolled and no orders
 * given simply wastes the roll, and nothing on screen says so. At a four-ship fleet it is very easy
 * to give three of them orders, end the turn, and never notice the fourth stood still.
 *
 * Deliberately in `sim/` rather than in the component that draws the warning. The hard part is not
 * the dialog, it is the judgement about whether a ship *can* usefully do anything — and judgement is
 * what the harness should be holding down. A warning that nags about a ship with nothing to do is
 * worse than no warning, because it trains you to click through.
 */

import { GOOD_BY_ID, PORT_BY_ID, portName } from './content';
import { goodEmbargoed, portStruck } from './events';
import { priceAt } from './pricing';
import { HOLD_SLOTS } from './rules';
import type { Captain, GameState, PortId, ShipId } from './types';

export interface ShipAwaitingOrders {
  shipId: ShipId;
  shipName: string;
  port: PortId;
  portName: string;
  /** Sail points rolled for her this turn and not yet spent — the wasted part. */
  pointsUnspent: number;
  /** What she could do about it, in one clause, for the confirmation to show. */
  hint: string;
}

/**
 * Ships of `captainId` that are tied up with rolled points still unspent.
 *
 * `sailPoints` is the whole signal and it is exact: `ROLL` writes an entry for every ship and
 * sailing spends it down, so a docked ship still holding points is precisely a ship that was rolled
 * for and never sent anywhere. No log scanning, no inference.
 *
 * Returns empty before the roll — there is nothing to waste yet — and ignores ships at sea, which
 * sail on their own the moment the dice come up.
 */
export function shipsAwaitingOrders(state: GameState, captainId: string): ShipAwaitingOrders[] {
  if (state.phase !== 'act') return [];

  const captain = state.captains.find(c => c.id === captainId);
  if (!captain) return [];

  const waiting: ShipAwaitingOrders[] = [];
  for (const ship of state.ships) {
    if (ship.ownerId !== captainId) continue;
    if (ship.location === null) continue;
    const points = state.sailPoints[ship.id] ?? 0;
    if (points <= 0) continue;

    waiting.push({
      shipId: ship.id,
      shipName: ship.name,
      port: ship.location,
      portName: portName(ship.location),
      pointsUnspent: points,
      hint: hintFor(state, captain, ship.location, ship.hold.length),
    });
  }
  return waiting;
}

/**
 * Why you might reasonably be leaving her, or what she is waiting for.
 *
 * Ordered by what actually decides the next click. A full hold means she should be running it in,
 * whatever else is true; a shut port means she cannot trade here at all; and only then is it worth
 * saying what is on the quay.
 */
function hintFor(
  state: GameState,
  captain: Captain,
  port: PortId,
  holdCount: number,
): string {
  if (holdCount >= HOLD_SLOTS) return 'her hold is full — she should be running it in';
  if (portStruck(state, port)) return `${portName(port)} is shut by the strike — she can only sail`;

  const supplies = PORT_BY_ID[port]?.supplies ?? [];
  const loadable = supplies.filter(
    good => !goodEmbargoed(state, good) && captain.cash >= priceAt(port, good),
  );
  if (loadable.length === 0) {
    return supplies.length === 0
      ? `${portName(port)} sells nothing — she can only sail`
      : 'nothing here she can afford';
  }

  // Name a good a live commission actually wants, if this quay has one — that is the useful nudge.
  const wanted = loadable.find(good => state.contracts.some(c => c.good === good && c.fills.length < 2));
  const pick = wanted ?? loadable[0];
  return `she could load ${GOOD_BY_ID[pick]?.name ?? pick} here${wanted ? ' for a live commission' : ' on spec'}`;
}
