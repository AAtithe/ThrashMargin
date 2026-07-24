import { dateForWeek } from './clock';
import { CAMPAIGN_START, EVENTS, findCharacter, findEvent } from './content';
import { addSecret } from './secrets';
import { startCondotta } from './condotta';
import type { EventTrigger, GameState } from './types';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
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
  return true;
}

/**
 * Runs after every ADVANCE_WEEK (and once on a fresh campaign): any event not already fired or
 * pending whose trigger now holds joins the pending queue, oldest first. An event never fires
 * twice, and firing only queues it — the player resolves it explicitly via RESOLVE_EVENT.
 */
export function checkTriggers(state: GameState): GameState {
  const known = new Set([...state.firedEvents, ...state.pendingEvents]);
  const newlyTriggered = EVENTS.filter(e => !known.has(e.id) && triggerMatches(state, e.trigger)).map(e => e.id);
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
  if (effects.flag) next = { ...next, flags: { ...next.flags, [effects.flag]: true } };
  if (effects.flags) {
    const set = { ...next.flags };
    for (const f of effects.flags) set[f] = true;
    next = { ...next, flags: set };
  }
  if (typeof effects.cash === 'number') next = { ...next, cash: next.cash + effects.cash };
  if (typeof effects.conscience === 'number') {
    next = { ...next, conscience: clamp(next.conscience + effects.conscience, 0, 100) };
  }
  if (effects.secret) next = { ...next, secrets: addSecret(next.secrets, next.week, effects.secret) };
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
  return next;
}
