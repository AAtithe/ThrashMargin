import { dateForWeek } from '@repo/engine';
import { CAMPAIGN_START, EVENTS, findEvent } from './content';
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
  if (typeof effects.cash === 'number') next = { ...next, cash: next.cash + effects.cash };
  if (typeof effects.conscience === 'number') {
    next = { ...next, conscience: clamp(next.conscience + effects.conscience, 0, 100) };
  }
  return next;
}
