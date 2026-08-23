import { findCity } from './content';
import { cargoTotal } from './market';
import { cityBarred } from './marketEvents';
import { inConvoy } from './convoy';
import vesselTypeData from '../content/vesselTypes.json';
import type { GameState, Vessel, VesselKind } from './types';

/**
 * Fleet growth (`freeplay-and-trading-design.md` Part 4, built as Phase 28 — the last unbuilt part
 * of that spec).
 *
 * Buying and selling hulls at a short list of shipyards, three classes that differ in more than
 * capacity, and per-vessel weekly upkeep so an overlarge fleet genuinely hurts rather than being
 * free once bought.
 *
 * **The class is the interesting part.** Capacity alone would make this a shopping list: bigger is
 * better, buy the biggest you can afford. A speed multiplier applied in `dispatchVessel` turns it
 * into a real choice, and Phase 27 measured exactly why that matters — hold beyond what a market can
 * absorb buys mostly time in port, so a carrack is only worth its 40 units on a long run into a deep
 * market, and a galley's 10 units arriving early can be worth more than 40 arriving late.
 */

export interface VesselType {
  id: string;
  name: string;
  kind: VesselKind;
  capacity: number;
  cost: number;
  upkeepPerWeek: number;
  /** Multiplies a route's `distanceWeeks`. Below 1 is faster; above 1 is slower. */
  speed: number;
  note: string;
}

export const VESSEL_TYPES = vesselTypeData as VesselType[];

export function findVesselType(typeId: string | undefined): VesselType | undefined {
  return typeId === undefined ? undefined : VESSEL_TYPES.find(t => t.id === typeId);
}

/**
 * Where hulls are bought and sold. A short named list, following the `canInsureAt` precedent that
 * this spec asks for by name, rather than every port — a shipyard is a fact about a city, and the
 * three here are the ones the campaign already treats as the house's financial and maritime centres.
 */
export const SHIPYARD_CITY_IDS = ['bruges', 'venice', 'genoa'];

export function isShipyard(cityId: string): boolean {
  return SHIPYARD_CITY_IDS.includes(cityId);
}

/**
 * What a hull costs to keep for a week, and how fast it is.
 *
 * **Both default to the pre-Phase-28 behaviour when a vessel has no `typeId`**, which every existing
 * vessel does: `ship_1`, `courier_1`, and anything an `EventEffects.grantVessel` handed over. That
 * is what makes this feature additive rather than a migration — an older save's fleet costs nothing
 * new and sails at exactly the speed it always did, and a chapter can keep granting hulls without
 * knowing the shipyard exists. Only hulls the player actually bought carry a class.
 */
export function vesselUpkeep(vessel: Vessel): number {
  return findVesselType(vessel.typeId)?.upkeepPerWeek ?? 0;
}

export function vesselSpeed(vessel: Vessel): number {
  return findVesselType(vessel.typeId)?.speed ?? 1;
}

export function fleetUpkeepPerWeek(state: GameState): number {
  return state.vessels.reduce((sum, v) => sum + vesselUpkeep(v), 0);
}

/** What the yard pays for a used hull. A real haircut, so churning the fleet is never a way to
 * raise money — the same discipline the warehouse's distress sale follows. */
export const RESALE_FRACTION = 0.6;

/** Cheapest class of a given kind — the yard's valuation for a hull with no class of its own. */
function baselineCost(kind: VesselKind): number {
  const ofKind = VESSEL_TYPES.filter(t => t.kind === kind);
  return ofKind.length > 0 ? Math.min(...ofKind.map(t => t.cost)) : 0;
}

export function resaleValue(vessel: Vessel): number {
  const type = findVesselType(vessel.typeId);
  // An untyped hull (`ship_1`, `courier_1`, or anything an event granted) has no purchase price to
  // discount, so it is valued as the cheapest class of its own **kind**.
  //
  // Its own kind matters, and live testing is what showed why: pricing every untyped hull off the
  // cog valued the house's dispatch rider at 132f when a new courier costs 90f — selling the rider
  // and buying a replacement was a 42f profit for no reason at all. Small, but it is free money, and
  // free money is the one thing this economy has repeatedly had to have designed out of it.
  const cost = type?.cost ?? baselineCost(vessel.kind);
  return Math.round(cost * RESALE_FRACTION);
}

/**
 * The next hull id, and it must never be one already used *in this campaign's history* — not merely
 * one currently in the fleet.
 *
 * **The driver caught the difference, which is the whole reason this is a function.** Deriving the
 * next number from the vessels currently owned recycles ids: buy `ship_2`, sell it, buy again, and
 * the new hull is `ship_2` a second time. That matters far more here than it looks, because
 * `EventTrigger.vesselIdAt` names ids **in content** — a recycled id would silently satisfy another
 * chapter's trigger with a hull that never made the voyage, which is the exact class of bug pinning
 * ids was introduced to fix.
 *
 * So the high-water mark is carried on the state (`vesselSeq`), seeded from the fleet for any save
 * written before it existed. Counted across ships and couriers together, so one sequence covers
 * both prefixes.
 */
function nextVesselSeq(state: GameState): number {
  let highest = 0;
  for (const v of state.vessels) {
    const m = /^(?:ship|courier)_(\d+)$/.exec(v.id);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return Math.max(highest, state.vesselSeq ?? 0) + 1;
}

function vesselIdFor(kind: VesselKind, seq: number): string {
  return `${kind === 'courier' ? 'courier' : 'ship'}_${seq}`;
}

export function buyVessel(state: GameState, typeId: string, name?: string): GameState {
  const type = findVesselType(typeId);
  if (!type) throw new Error(`No such vessel class: ${typeId}`);

  // Bought where the house is standing. Any docked vessel counts as the house being present, which
  // is the same test `MarketPanel` and the warehouse use — a yard needs somebody there to sign.
  const at = state.vessels.find(v => !v.destination && isShipyard(v.location));
  if (!at) throw new Error('The house has nobody at a shipyard — Bruges, Venice or Genoa');
  if (cityBarred(state.flags, at.location)) {
    throw new Error(`${findCity(at.location)?.name ?? at.location} is closed to the house while the ban stands`);
  }
  if (type.cost > state.cash) {
    throw new Error(`Not enough cash (need ${type.cost}, have ${Math.round(state.cash)})`);
  }

  const seq = nextVesselSeq(state);
  const id = vesselIdFor(type.kind, seq);
  const vessel: Vessel = {
    id,
    kind: type.kind,
    name: name?.trim() || `${type.name} (${id.replace('_', ' ')})`,
    location: at.location,
    destination: null,
    routeId: null,
    weeksRemaining: 0,
    cargo: {},
    capacity: type.capacity,
    typeId: type.id,
  };
  return { ...state, cash: state.cash - type.cost, vessels: [...state.vessels, vessel], vesselSeq: seq };
}

/**
 * Sells a hull back to the yard.
 *
 * **The guards here are the whole point, and one of them is a soft-lock fix.** Four scripted
 * triggers across Chapters 4, 5 and 7 name `ship_1` by id (`EventTrigger.vesselIdAt`), because
 * pinning the exact hull was itself the fix for an earlier regression. Letting the player sell that
 * hull would make three chapters' beats permanently unsatisfiable. Two things address it, belt and
 * braces, because a soft-lock is the worst class of bug this game can have:
 *
 *  1. A vessel that any live scripted business depends on cannot be sold at all — the expedition's
 *     own hull while the expedition runs, and a hull under way, in a convoy, insured, or carrying
 *     cargo. Those cover every case where selling would strand something in flight.
 *  2. `checkTriggers`'s `vesselIdAt` **degrades to a kind check when the named vessel no longer
 *     exists** (see `sim/events.ts`), so even a hull sold long after its chapter cannot orphan a
 *     later one. That is the same "degrade rather than block forever" discipline `weeksAfterFlag`
 *     already applies, and for the same stated reason: a stuck deadline soft-locks a chapter.
 *
 * The house must also always keep a hull that can actually carry goods, or the player is left with
 * a courier, no way to trade, and no way to earn the money to fix it.
 */
export function sellVessel(state: GameState, vesselId: string): GameState {
  const vessel = state.vessels.find(v => v.id === vesselId);
  if (!vessel) throw new Error(`No such vessel: ${vesselId}`);
  if (vessel.destination) throw new Error(`${vessel.name} is under way and cannot be sold`);
  if (!isShipyard(vessel.location)) {
    throw new Error(`${vessel.name} must be at Bruges, Venice or Genoa to be sold`);
  }
  if (cargoTotal(vessel.cargo) > 0) throw new Error(`${vessel.name} is still carrying cargo`);
  if (inConvoy(state.convoy, vesselId)) throw new Error(`${vessel.name} is sailing in the convoy`);
  if ((state.insurance ?? []).some(i => i.vesselId === vesselId)) {
    throw new Error(`${vessel.name} has a policy running on it`);
  }
  if (state.expedition && state.expedition.vesselId === vesselId) {
    throw new Error(`${vessel.name} is carrying the expedition`);
  }
  if (vessel.capacity > 0 && state.vessels.filter(v => v.capacity > 0).length <= 1) {
    throw new Error('The house cannot sell its only hull — there would be no way left to trade');
  }

  return {
    ...state,
    cash: state.cash + resaleValue(vessel),
    vessels: state.vessels.filter(v => v.id !== vesselId),
    // A sold hull's queued-journey plan and its convoy membership go with it. Convoy membership is
    // already refused above, so this is only the plan.
    insurance: (state.insurance ?? []).filter(i => i.vesselId !== vesselId),
  };
}

export interface FleetResolution {
  cash: number;
  vessels: Vessel[];
  laidUp: { week: number; vesselName: string } | null;
}

/**
 * Per-vessel weekly upkeep, drawn with the household's wages, the escort's pay and the warehouse
 * rent — "so an overlarge fleet genuinely hurts", which is this section's own stated purpose.
 *
 * **A hull that cannot be paid for is laid up, not repossessed.** Losing a 520f carrack over a 8f
 * shortfall would be a punishment out of all proportion, and unlike a warehouse lease a hull is not
 * somebody else's property to seize. Laying up means its `typeId` is cleared: it keeps sailing and
 * carrying, at the default speed, and costs nothing — the house has stopped maintaining it. That is
 * a real and legible loss (a carrack laid up is a carrack that has stopped being fast) without ever
 * removing the player's ability to trade, which is the failure mode that matters.
 *
 * Only ever one hull per week, the dearest first, so a bad week is a setback rather than a wipeout.
 */
export function resolveWeeklyFleet(state: GameState, week: number): FleetResolution {
  const due = fleetUpkeepPerWeek(state);
  if (due === 0) return { cash: state.cash, vessels: state.vessels, laidUp: null };
  if (due <= state.cash) return { cash: state.cash - due, vessels: state.vessels, laidUp: null };

  const dearest = [...state.vessels]
    .filter(v => vesselUpkeep(v) > 0)
    .sort((a, b) => vesselUpkeep(b) - vesselUpkeep(a) || a.id.localeCompare(b.id))[0];
  if (!dearest) return { cash: state.cash, vessels: state.vessels, laidUp: null };

  const vessels = state.vessels.map(v => {
    if (v.id !== dearest.id) return v;
    const { typeId: _dropped, ...laid } = v;
    return laid as Vessel;
  });
  // What is left of the bill is still paid if it can be — the other hulls' crews do not go unpaid
  // because one ship was laid up.
  const remaining = vessels.reduce((sum, v) => sum + vesselUpkeep(v), 0);
  return {
    cash: Math.max(0, state.cash - Math.min(state.cash, remaining)),
    vessels,
    laidUp: { week, vesselName: dearest.name },
  };
}
