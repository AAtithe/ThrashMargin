import { OBJECTIVES } from './content';
import type { GameState, Objective } from './types';

/** Which chapter's own objective list is currently "live" — one past the most recent chapter-
 * complete flag set, mirroring the same flag-chain logic the finale events themselves already use
 * to hand off from one chapter to the next. Chapter 0 has no objectives content (its own finale is
 * a single bare flag, no AND-gate to describe) — `objectivesForChapter(state, 0)` simply returns
 * an empty list, which is what lets `ObjectivesPanel` self-hide during the prologue for free. */
export function currentChapterNumber(state: GameState): number {
  if (state.flags.chapter3_complete) return 4;
  if (state.flags.chapter2_complete) return 3;
  if (state.flags.chapter1_complete) return 2;
  if (state.flags.chapter0_complete) return 1;
  return 0;
}

export type ObjectiveStatusKind = 'pending' | 'complete' | 'missed';

export interface ObjectiveProgress {
  objective: Objective;
  status: ObjectiveStatusKind;
  outcome?: 'positive' | 'costly';
  /** Whether `objective.description` should actually be shown (Phase 15's "forward-looking
   * hints"). True whenever the objective has no `revealFlag`, the flag is already set, or the
   * objective is no longer pending — once a thread resolves (complete or missed) there's nothing
   * left to spoil, only context to give, so the real description always shows from that point on
   * regardless of whether its reveal flag ever fired (e.g. declining a commission before it's
   * ever offered still resolves the thread without ever "having a lead"). */
  revealed: boolean;
}

/** Chapter titles (design doc §9's own names), used by the chapter-close acknowledgment card and
 * the ambient campaign-progress header — kept here, not duplicated in each UI component, so both
 * read the exact same list as more chapters ship. */
export const CHAPTER_TITLES: Record<number, string> = {
  0: 'Claes Begins',
  1: 'Niccolo Rising',
  2: 'The Spring of the Ram',
  3: 'Race of Scorpions',
  4: 'Scales of Gold',
};

/**
 * Pure, read-only projection over flags/state a chapter's own event content already sets —
 * nothing here writes to `GameState`, and nothing in `sim/events.ts`'s trigger/effect machinery
 * changes because this exists. An `Objective` is content describing an existing thread's gating
 * flag, not a new mechanic deciding anything.
 */
export function objectivesForChapter(state: GameState, chapterNumber: number): ObjectiveProgress[] {
  return OBJECTIVES.filter(o => o.chapterNumber === chapterNumber).map(o => {
    let status: ObjectiveStatusKind = 'pending';
    if (o.kind.type === 'flag') {
      status = state.flags[o.kind.flag] ? 'complete' : 'pending';
    } else if (o.kind.type === 'flagAbsent') {
      status = state.flags[o.kind.flag] ? 'missed' : 'complete';
    } else if (o.kind.type === 'cashThreshold') {
      if (state.cash >= o.kind.amount) status = 'complete';
      else if (state.week > o.kind.byWeek) status = 'missed';
    }

    let outcome: 'positive' | 'costly' | undefined;
    if (o.outcomeFlags?.positive && state.flags[o.outcomeFlags.positive]) outcome = 'positive';
    else if (o.outcomeFlags?.costly && state.flags[o.outcomeFlags.costly]) outcome = 'costly';

    const revealed = status !== 'pending' || !o.revealFlag || !!state.flags[o.revealFlag];

    return { objective: o, status, outcome, revealed };
  });
}
