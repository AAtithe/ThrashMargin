import { findCity } from './content';
import type { Convoy, GameState, Vessel } from './types';

/**
 * Convoys — Chapter 6's "mass logistics" (design doc §12's own system line for this chapter, and
 * §4's "Ships... Capacity, speed, crew, escort", the last word of which had never been built).
 *
 * The Iceland venture is the first beat in the game that one hull cannot carry: stockfish is bulk
 * cargo worth little per unit, so it only pays in tonnage. A convoy is how tonnage becomes a single
 * decision rather than three identical ones — several vessels sail as one, arrive as one, and share
 * one hired escort.
 *
 * Three scope decisions, recorded rather than left implicit:
 *
 * 1. **Convoys do not buy ships.** `BUY_VESSEL`, shipyards and vessel classes are Part 4 of
 *    `freeplay-and-trading-design.md`, a separately-owned workstream sequenced after warehousing.
 *    Chapter 6 hands over its extra hulls through the existing `EventEffects.grantVessel` (Chapter
 *    0's own precedent for a vessel arriving mid-campaign), so a shipyard economy doesn't get
 *    invented in two places at once. If fleet growth lands later, convoys sit on top of it unchanged.
 * 2. **Singular, like `estate` and `expedition` on their first outings.** One convoy at a time. The
 *    player has at most a handful of hulls; a fleet-management screen for three ships would be more
 *    mechanism than the chapter earns.
 * 3. **Dispatching any member sails the whole convoy.** There is no per-vessel opt-out — disbanding
 *    is the way to send one ship alone. A convoy that could silently leave a member behind is the
 *    same class of bug as a queued journey that splits at an intermediate stop, and this keeps the
 *    invariant blunt enough to be obvious.
 */

/** Escort: a hired armed vessel or two, paid up front and then weekly. Deliberately expensive
 * against Chapter 6's own Iceland payoff — an escort should be a real decision on the outbound
 * leg, not a rounding error the player buys reflexively. */
export const ESCORT_HIRE_COST = 60;
export const ESCORT_UPKEEP_PER_WEEK = 4;
/** What an escort does to a convoy member's weekly storm/piracy chance (§4: "war events raise it,
 * escorts lower it"). Not immunity — the Iceland run is dangerous with or without one. */
export const ESCORT_RISK_MULTIPLIER = 0.4;

/** Only vessels with a hold can convoy — the point is tonnage. The dispatch rider and Claes's
 * handcart are excluded for the same reason `MarketPanel` already ignores them. */
export function convoyEligible(vessels: Vessel[]): Vessel[] {
  return vessels.filter(v => v.capacity > 0);
}

export function inConvoy(convoy: Convoy | null | undefined, vesselId: string): boolean {
  return !!convoy?.vesselIds.includes(vesselId);
}

/** Vessel ids currently protected by a paid escort — the set `resolveVoyageRisk` reads. Empty
 * unless a convoy exists *and* it is escorted, so the risk path is untouched for every campaign
 * that never forms one. */
export function escortedVesselIds(convoy: Convoy | null | undefined): Set<string> {
  return new Set(convoy?.escorted ? convoy.vesselIds : []);
}

export function formConvoy(state: GameState, vesselIds: string[]): GameState {
  if (vesselIds.length < 2) throw new Error('A convoy needs at least two vessels');

  const vessels = vesselIds.map(id => {
    const v = state.vessels.find(x => x.id === id);
    if (!v) throw new Error(`No such vessel: ${id}`);
    return v;
  });

  if (vessels.some(v => v.capacity <= 0)) throw new Error('Only vessels with a hold can sail in convoy');
  if (vessels.some(v => v.destination)) throw new Error('Every vessel must be in port to form a convoy');

  const port = vessels[0].location;
  if (vessels.some(v => v.location !== port)) {
    throw new Error('Every vessel must be in the same port to form a convoy');
  }

  return { ...state, convoy: { vesselIds: [...vesselIds], escorted: false } };
}

/** Breaking the convoy never moves or charges anything — the vessels simply stop sailing together.
 * A paid escort is lost with it rather than refunded; it was hired for a voyage, not held on account. */
export function disbandConvoy(state: GameState): GameState {
  if (!state.convoy) throw new Error('No convoy to disband');
  return { ...state, convoy: null };
}

export function hireEscort(state: GameState, escortName?: string): GameState {
  const convoy = state.convoy;
  if (!convoy) throw new Error('Form a convoy before hiring an escort for it');
  if (convoy.escorted) throw new Error('This convoy already sails under escort');
  if (ESCORT_HIRE_COST > state.cash) {
    throw new Error(`Not enough cash (need ${ESCORT_HIRE_COST}, have ${Math.round(state.cash)})`);
  }
  const members = state.vessels.filter(v => convoy.vesselIds.includes(v.id));
  if (members.some(v => v.destination)) throw new Error('An escort can only be taken on in port');

  return {
    ...state,
    cash: state.cash - ESCORT_HIRE_COST,
    convoy: { ...convoy, escorted: true, escortName: escortName?.trim() || undefined },
  };
}

export interface ConvoyResolution {
  convoy: Convoy | null;
  cash: number;
  /** True the week an escort was paid off because the cash wasn't there — the UI needs to say so,
   * since a silently vanishing escort reads exactly like the storm losses it was meant to prevent. */
  escortLapsed: boolean;
}

/**
 * Runs every ADVANCE_WEEK. An escort draws its weekly pay from cash; if it can't be paid, it leaves
 * — the same "no partial pay, no back-pay debt" rule `resolveWeeklyUpkeep` already applies to the
 * household's own wages, rather than a second, subtly different insolvency path.
 */
export function resolveWeeklyConvoy(state: GameState): ConvoyResolution {
  const convoy = state.convoy ?? null;
  if (!convoy || !convoy.escorted) return { convoy, cash: state.cash, escortLapsed: false };

  if (state.cash < ESCORT_UPKEEP_PER_WEEK) {
    return { convoy: { ...convoy, escorted: false, escortName: undefined }, cash: state.cash, escortLapsed: true };
  }
  return { convoy, cash: state.cash - ESCORT_UPKEEP_PER_WEEK, escortLapsed: false };
}

/** Human-readable "where this convoy is", for the panel — every member is by construction either in
 * the same port or on the same leg, so one line covers the lot. */
export function convoySummary(state: GameState): string | null {
  const convoy = state.convoy;
  if (!convoy) return null;
  const members = state.vessels.filter(v => convoy.vesselIds.includes(v.id));
  if (members.length === 0) return null;
  const lead = members[0];
  const where = lead.destination
    ? `at sea for ${findCity(lead.destination)?.name ?? lead.destination}, ${lead.weeksRemaining} week${lead.weeksRemaining === 1 ? '' : 's'} out`
    : `in port at ${findCity(lead.location)?.name ?? lead.location}`;
  return `${members.length} vessels ${where}`;
}
