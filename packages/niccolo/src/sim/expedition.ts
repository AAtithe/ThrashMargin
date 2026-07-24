import { activeCharacters } from './characters';
import type { ExpeditionHealthEvent, ExpeditionHealthStatus, ExpeditionState, GameState, Vessel } from './types';

/**
 * Chapter 4's disease clock (design doc §9: "the Gambia voyage: river navigation, disease
 * clock"), mirroring `insurance.ts`/`resolveHouseSabotage`'s self-contained, one-dramatic-event-
 * per-week shape: a vessel lingering at Gambia, at Timbuktu, or under way on the `river` route
 * accrues risk the longer it stays, resolved automatically every ADVANCE_WEEK with no dedicated
 * player action — the hazard is ambient to where the player already chose to sail, exactly like
 * voyage risk and sabotage, not a deliberate commitment the way `ESTABLISH_ESTATE` is.
 */
export const EXPEDITION_ZONE_CITIES = ['gambia', 'timbuktu'];
export const EXPEDITION_RIVER_ROUTE_ID = 'gambia-timbuktu';

const BASE_CHANCE_PER_WEEK = 0.12;
const ESCALATION_PER_WEEK_UPRIVER = 0.015;
const CHANCE_CAP = 0.45;
/** Tobie is the household's physician (content/characters/chapter1.json). Having him aboard the
 * tracked vessel halves the roll — a thematic reuse of an existing character, not a new stat. */
const TOBIE_ABOARD_RISK_MULTIPLIER = 0.5;

const AILING_CASH_COST = 15;
const AILING_CONSCIENCE_COST = 2;
const STRICKEN_CASH_COST = 35;
const STRICKEN_CONSCIENCE_COST = 5;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function inZone(v: Vessel): boolean {
  if (!v.destination) return EXPEDITION_ZONE_CITIES.includes(v.location);
  return v.routeId === EXPEDITION_RIVER_ROUTE_ID;
}

function tobieAboard(characters: GameState['characters'], vesselId: string): boolean {
  return activeCharacters(characters).some(
    c => c.id === 'tobie' && c.assignment.type === 'aboard' && c.assignment.vesselId === vesselId,
  );
}

/** healthy -> ailing -> stricken, capped — a repeat hit while already stricken re-applies that
 * tier's cost again but never regresses and never re-fires `crisisReached`. */
function nextStage(stage: ExpeditionHealthStatus): ExpeditionHealthStatus {
  return stage === 'healthy' ? 'ailing' : 'stricken';
}

export interface ExpeditionResolution {
  expedition: ExpeditionState | null;
  cash: number;
  conscience: number;
  event: ExpeditionHealthEvent | null;
  /** True only the week `healthStatus` first reaches `stricken` — content can react to this via
   * the `expedition_crisis` flag the caller sets, same as `sabotage.sabotaged` today. */
  crisisReached: boolean;
}

/**
 * Runs every ADVANCE_WEEK. Takes the whole `GameState` (mirroring `resolveWeeklyCondotta`'s own
 * signature) rather than raw deltas, so conscience comes back already clamped from one obvious
 * place, not spread across the caller. Tracks at most one vessel at a time — the same singular-
 * instance discipline `Estate` used for its first outing — and clears itself the week the tracked
 * vessel (or the only qualifying one, if the previously-tracked vessel already left) is no longer
 * in the zone: a live clock, not a history (`lastExpeditionEvent` is the history).
 */
export function resolveWeeklyExpedition(state: GameState, week: number): ExpeditionResolution {
  const noChange: ExpeditionResolution = {
    expedition: null,
    cash: state.cash,
    conscience: state.conscience,
    event: null,
    crisisReached: false,
  };

  const tracked = state.expedition && state.vessels.find(v => v.id === state.expedition!.vesselId);
  const candidate = tracked && inZone(tracked) ? tracked : state.vessels.find(inZone);
  if (!candidate) return noChange;

  const continuing = state.expedition?.vesselId === candidate.id;
  const priorWeeksUpriver = continuing ? state.expedition!.weeksUpriver : 0;
  const priorHealth: ExpeditionHealthStatus = continuing ? state.expedition!.healthStatus : 'healthy';
  const weeksUpriver = priorWeeksUpriver + 1;

  const chance =
    Math.min(CHANCE_CAP, BASE_CHANCE_PER_WEEK + weeksUpriver * ESCALATION_PER_WEEK_UPRIVER) *
    (tobieAboard(state.characters, candidate.id) ? TOBIE_ABOARD_RISK_MULTIPLIER : 1);

  if (Math.random() >= chance) {
    return {
      expedition: { vesselId: candidate.id, weeksUpriver, healthStatus: priorHealth },
      cash: state.cash,
      conscience: state.conscience,
      event: null,
      crisisReached: false,
    };
  }

  const healthStatus = nextStage(priorHealth);
  const crisisReached = healthStatus === 'stricken' && priorHealth !== 'stricken';
  const cashCost = healthStatus === 'stricken' ? STRICKEN_CASH_COST : AILING_CASH_COST;
  const conscienceCost = healthStatus === 'stricken' ? STRICKEN_CONSCIENCE_COST : AILING_CONSCIENCE_COST;

  return {
    expedition: { vesselId: candidate.id, weeksUpriver, healthStatus },
    cash: state.cash - cashCost,
    conscience: clamp(state.conscience - conscienceCost, 0, 100),
    event: {
      week,
      vesselId: candidate.id,
      vesselName: candidate.name,
      healthStatus,
      cashCost,
      conscienceCost,
    },
    crisisReached,
  };
}
