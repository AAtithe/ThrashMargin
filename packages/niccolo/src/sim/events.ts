import { dateForWeek } from './clock';
import { CAMPAIGN_START, EVENTS, findCharacter, findEvent } from './content';
import { addEvidence } from './dossier';
import { addSecret } from './secrets';
import { startCondotta } from './condotta';
import type { EventTrigger, GameState } from './types';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Sets flags and, for any that were not already set, records the week it happened — the backing
 * store `EventTrigger.weeksAfterFlag` reads for a relative deadline (Chapter 5, Phase 19). Exported
 * because `advanceWeek` sets a handful of engine-side flags of its own (a completed condotta, a
 * sabotage, an expedition crisis, a house unmasked) and those deserve the same timestamps as an
 * event choice's; nothing should be able to set a flag without dating it. Already-set flags keep
 * their original week — this records the first time, not the most recent.
 */
export function withFlagsSet(
  flags: Record<string, boolean>,
  flagWeeks: Record<string, number> | undefined,
  week: number,
  ids: string[],
): { flags: Record<string, boolean>; flagWeeks: Record<string, number> } {
  const nextFlags = { ...flags };
  const nextWeeks = { ...(flagWeeks ?? {}) };
  for (const id of ids) {
    if (!nextFlags[id]) nextWeeks[id] = week;
    nextFlags[id] = true;
  }
  return { flags: nextFlags, flagWeeks: nextWeeks };
}

function triggerMatches(state: GameState, trigger: EventTrigger): boolean {
  if (trigger.dateAfter && dateForWeek(state.week, CAMPAIGN_START) < new Date(trigger.dateAfter)) {
    return false;
  }
  if (trigger.location && !state.vessels.some(v => !v.destination && v.location === trigger.location)) {
    return false;
  }
  if (trigger.flag && !state.flags[trigger.flag]) return false;
  if (trigger.flags && !trigger.flags.every(f => state.flags[f])) return false;
  if (trigger.flagAbsent && state.flags[trigger.flagAbsent]) return false;
  if (trigger.cargoAtLeast) {
    const { location, goodId, quantity } = trigger.cargoAtLeast;
    const satisfied = state.vessels.some(
      v => !v.destination && v.location === location && (v.cargo[goodId] ?? 0) >= quantity,
    );
    if (!satisfied) return false;
  }
  if (trigger.vesselKindAt) {
    const { kind, location } = trigger.vesselKindAt;
    const satisfied = state.vessels.some(v => !v.destination && v.location === location && v.kind === kind);
    if (!satisfied) return false;
  }
  if (trigger.vesselIdAt) {
    const { vesselId, location } = trigger.vesselIdAt;
    const satisfied = state.vessels.some(v => !v.destination && v.location === location && v.id === vesselId);
    if (!satisfied) return false;
  }
  if (trigger.combinedCargoAtLeast) {
    const { location, goodId, quantity } = trigger.combinedCargoAtLeast;
    const held = state.vessels
      .filter(v => !v.destination && v.location === location)
      .reduce((sum, v) => sum + (v.cargo[goodId] ?? 0), 0);
    if (held < quantity) return false;
  }
  if (trigger.weeksAfterFlag) {
    const { flag, weeks } = trigger.weeksAfterFlag;
    if (!state.flags[flag]) return false;
    const setWeek = state.flagWeeks?.[flag];
    // A flag set before `flagWeeks` existed has no timestamp to count from — degrade to the plain
    // flag check rather than blocking forever (see EventTrigger's own doc comment).
    if (setWeek !== undefined && state.week < setWeek + weeks) return false;
  }
  return true;
}

/**
 * Runs after every ADVANCE_WEEK (and once on a fresh campaign): any event not already fired or
 * pending whose trigger now holds joins the pending queue, oldest first. An event never fires
 * twice, and firing only queues it — the player resolves it explicitly via RESOLVE_EVENT.
 *
 * Chapter 0 and Chapter 1+ events are mutually exclusive on top of whatever their own trigger
 * says: Chapter 0's own events only fire while `chapter0_complete` isn't yet set (a skip-prologue
 * campaign starts with it already true, so `ev_c0_001` — trigger is bare `location: "bruges"`,
 * with no flag of its own — must not also fire alongside Chapter 1's real opener); Chapter 1+
 * events only fire once it is set. Most of Chapter 1's own events only gate on
 * `dateAfter`+`location: "bruges"` with no flag at all (authored before Chapter 0 existed), and
 * Chapter 0 can genuinely take several real calendar weeks (courier/handcart round trips) — without
 * this backstop the calendar can cross into Chapter 1's own dates while the prologue is still
 * running, misfiring its content mid Chapter 0. `ev_c1_001` already carries an explicit
 * `flag: "chapter0_complete"` for documentation, but every later Chapter 1 event needs the same
 * guarantee, hence enforcing both directions here once for all.
 */
export function checkTriggers(state: GameState): GameState {
  const known = new Set([...state.firedEvents, ...state.pendingEvents]);
  const newlyTriggered = EVENTS.filter(
    e =>
      !known.has(e.id) &&
      (e.chapter === 0 ? !state.flags.chapter0_complete : state.flags.chapter0_complete) &&
      triggerMatches(state, e.trigger),
  ).map(e => e.id);
  if (newlyTriggered.length === 0) return state;
  return { ...state, pendingEvents: [...state.pendingEvents, ...newlyTriggered] };
}

/** Only the front of the queue can be resolved — one scripted scene at a time. */
export function resolveEvent(state: GameState, eventId: string, choiceIndex: number): GameState {
  if (state.pendingEvents[0] !== eventId) {
    throw new Error(`${eventId} is not the event currently awaiting a decision`);
  }
  const event = findEvent(eventId);
  if (!event) throw new Error(`No such event: ${eventId}`);
  const choice = event.choices[choiceIndex];
  if (!choice) throw new Error(`${event.title} has no such choice`);

  let next: GameState = {
    ...state,
    pendingEvents: state.pendingEvents.slice(1),
    firedEvents: [...state.firedEvents, eventId],
  };
  const { effects } = choice;
  const flagsToSet = [...(effects.flag ? [effects.flag] : []), ...(effects.flags ?? [])];
  if (flagsToSet.length > 0) {
    next = { ...next, ...withFlagsSet(next.flags, next.flagWeeks, next.week, flagsToSet) };
  }
  if (typeof effects.cash === 'number') next = { ...next, cash: next.cash + effects.cash };
  if (typeof effects.conscience === 'number') {
    next = { ...next, conscience: clamp(next.conscience + effects.conscience, 0, 100) };
  }
  if (effects.secret) next = { ...next, secrets: addSecret(next.secrets, next.week, effects.secret) };
  if (effects.evidence) {
    next = { ...next, evidence: addEvidence(next.evidence ?? [], next.week, effects.evidence) };
  }
  if (effects.condotta) {
    const { retainerPerWeek, weeks } = effects.condotta;
    next = { ...next, condotta: startCondotta(next.condotta, { retainerPerWeek, weeksRemaining: weeks }) };
  }
  if (effects.rep) {
    const houseRelations = { ...next.houseRelations };
    for (const [houseId, delta] of Object.entries(effects.rep)) {
      houseRelations[houseId] = clamp((houseRelations[houseId] ?? 0) + delta, 0, 100);
    }
    next = { ...next, houseRelations };
  }
  if (effects.joinCharacter) {
    const id = effects.joinCharacter;
    if (next.characters.some(c => c.id === id)) {
      next = {
        ...next,
        characters: next.characters.map(c => (c.id === id ? { ...c, status: 'active' as const } : c)),
      };
    } else {
      // A save from before this character existed in content — add them fresh rather than no-op,
      // so a mid-campaign join still works for a campaign that predates it.
      const template = findCharacter(id);
      if (template) next = { ...next, characters: [...next.characters, { ...template, status: 'active' as const }] };
    }
  }
  if (effects.characterDeparts) {
    const id = effects.characterDeparts;
    next = {
      ...next,
      characters: next.characters.map(c =>
        c.id === id && c.status === 'active'
          ? { ...c, status: 'departed' as const, assignment: { type: 'idle' as const } }
          : c,
      ),
    };
  }
  if (effects.grantVessel && !next.vessels.some(v => v.id === effects.grantVessel!.id)) {
    const { id, kind, name, capacity, location } = effects.grantVessel;
    next = {
      ...next,
      vessels: [
        ...next.vessels,
        { id, kind, name, capacity, location, destination: null, routeId: null, weeksRemaining: 0, cargo: {} },
      ],
    };
  }
  if (effects.grantCargo) {
    const { vesselId, goodId, quantity } = effects.grantCargo;
    next = {
      ...next,
      vessels: next.vessels.map(v =>
        v.id === vesselId ? { ...v, cargo: { ...v.cargo, [goodId]: (v.cargo[goodId] ?? 0) + quantity } } : v,
      ),
    };
  }
  return next;
}
