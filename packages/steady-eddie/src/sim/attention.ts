/**
 * What still wants the haulier's attention this turn.
 *
 * The problem this exists for: a vehicle parked up at a depot with her dice already rolled and no orders
 * given simply wastes the roll, and nothing on screen says so. At a four-vehicle fleet it is very easy
 * to give three of them orders, end the turn, and never notice the fourth stood still.
 *
 * Deliberately in `sim/` rather than in the component that draws the warning. The hard part is not
 * the dialog, it is the judgement about whether a vehicle *can* usefully do anything — and judgement is
 * what the harness should be holding down. A warning that nags about a vehicle with nothing to do is
 * worse than no warning, because it trains you to click through.
 */

import { GOOD_BY_ID, DEPOT_BY_ID, depotName } from './content';
import { goodEmbargoed, depotStruck } from './events';
import { priceAt } from './pricing';
import { slotsOf } from './rules';
import type { Haulier, GameState, DepotId, VehicleId } from './types';

export interface VehicleAwaitingOrders {
  vehicleId: VehicleId;
  vehicleName: string;
  depot: DepotId;
  depotName: string;
  /** Sail points rolled for her this turn and not yet spent — the wasted part. */
  pointsUnspent: number;
  /** What she could do about it, in one clause, for the confirmation to show. */
  hint: string;
}

/**
 * Vehicles of `haulierId` that are parked up with rolled points still unspent.
 *
 * `miles` is the whole signal and it is exact: `ROLL` writes an entry for every vehicle and
 * driving spends it down, so a parked vehicle still holding points is precisely a vehicle that was rolled
 * for and never sent anywhere. No log scanning, no inference.
 *
 * Returns empty before the roll — there is nothing to waste yet — and ignores vehicles on the road, which
 * drive on their own the moment the dice come up.
 */
export function vehiclesAwaitingOrders(state: GameState, haulierId: string): VehicleAwaitingOrders[] {
  if (state.phase !== 'act') return [];

  const haulier = state.hauliers.find(c => c.id === haulierId);
  if (!haulier) return [];

  const waiting: VehicleAwaitingOrders[] = [];
  for (const vehicle of state.vehicles) {
    if (vehicle.ownerId !== haulierId) continue;
    if (vehicle.location === null) continue;
    const points = state.miles[vehicle.id] ?? 0;
    if (points <= 0) continue;

    waiting.push({
      vehicleId: vehicle.id,
      vehicleName: vehicle.name,
      depot: vehicle.location,
      depotName: depotName(vehicle.location),
      pointsUnspent: points,
      hint: hintFor(state, haulier, vehicle.location, vehicle.hold.length, slotsOf(vehicle.vehicleClass)),
    });
  }
  return waiting;
}

/**
 * Why you might reasonably be leaving her, or what she is waiting for.
 *
 * Ordered by what actually decides the next click. A full hold means she should be running it in,
 * whatever else is true; a shut depot means she cannot trade here at all; and only then is it worth
 * saying what is on the depot.
 */
function hintFor(
  state: GameState,
  haulier: Haulier,
  depot: DepotId,
  holdCount: number,
  slots: number,
): string {
  if (holdCount >= slots) return 'her hold is full — she should be running it in';
  if (depotStruck(state, depot)) return `${depotName(depot)} is shut by the strike — she can only drive`;

  const supplies = DEPOT_BY_ID[depot]?.supplies ?? [];
  const loadable = supplies.filter(
    good => !goodEmbargoed(state, good) && haulier.cash >= priceAt(depot, good),
  );
  if (loadable.length === 0) {
    return supplies.length === 0
      ? `${depotName(depot)} sells nothing — she can only drive`
      : 'nothing here she can afford';
  }

  // Name a good a live commission actually wants, if this depot has one — that is the useful nudge.
  const wanted = loadable.find(good => state.contracts.some(c => c.good === good && c.fills.length < 2));
  const pick = wanted ?? loadable[0];
  return `she could load ${GOOD_BY_ID[pick]?.name ?? pick} here${wanted ? ' for a live commission' : ' on spec'}`;
}
