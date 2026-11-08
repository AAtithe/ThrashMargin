import { useCallback, useEffect, useRef, useState } from 'react';
import { processAction, runAiTurn } from '../sim/actions';
import { paced, usePace, useSkipOnInput } from '../lib/motion';
import type { GameAction, GameState } from '../sim/types';

/**
 * Replays the computer captains' turns on screen, step by step, after the player ends a turn.
 *
 * The reducer runs every AI turn inside END_TURN, synchronously, and the result is saved at once —
 * this hook never holds that back. It only re-derives the in-between states for display: the sim is
 * pure and seeded, so running the same AI turns again from the state before END_TURN, through the
 * exported `runAiTurn` with its `observe` callback, produces exactly the states the reducer passed
 * through. The replay is then checked against the state the reducer actually produced, and if they
 * differ in any way it is discarded and the screen simply shows the result, as it always did.
 *
 * How the re-run reaches the AI turns without touching sim/: END_TURN only auto-plays the computer
 * seats when a human is at the table, so the replay hands the reducer a copy in which every captain
 * is marked 'ai' — END_TURN then just advances the seat — and plays each computer turn itself with
 * `runAiTurn`, exactly as endTurn's own loop does. The captains' real kinds are put back on every
 * frame. (A captain's kind is read only by that loop and by the AI's "is it my turn" check, so the
 * swap changes nothing else — and the final comparison would catch it if that ever stopped being so.)
 *
 * Skippable with the Skip control, or any click or key; with motion off nothing is computed at all.
 */

export interface ReplayFrame {
  state: GameState;
  captainId: string;
  action: GameAction;
  /** One line saying what happened, written from the log where the sim wrote one. */
  text: string;
  /** How long this step holds the screen, at full pace, before the next. */
  holdMs: number;
}

/** Long enough to follow, short enough that three rivals take a few seconds, not a minute. */
const HOLD: Partial<Record<GameAction['type'], number>> = {
  ROLL: 750,
  SAIL_TO: 800,
};
const HOLD_DEFAULT = 400;

function narrate(before: GameState, after: GameState, action: GameAction, captainId: string): string {
  const name = after.captains.find(c => c.id === captainId)?.name ?? 'A rival';
  if (action.type === 'ROLL') {
    const ships = after.ships.filter(s => s.ownerId === captainId && after.dice[s.id]);
    if (ships.length === 0) return `${name} takes the wind.`;
    // The dice, not the points left: a ship already at sea spends hers the moment the dice land.
    return `${name} rolls — ${ships
      .map(s => `${s.name} ${after.dice[s.id][0] + after.dice[s.id][1]}`)
      .join(', ')}.`;
  }
  // The log already says it in the game's own words.
  const seen = before.log.reduce((m, e) => Math.max(m, e.seq), -1);
  const fresh = after.log.filter(e => e.seq > seen);
  const own = fresh.filter(e => e.captainId === captainId);
  const line = (own[0] ?? fresh[0])?.text;
  if (line) return line;
  switch (action.type) {
    case 'SAIL_TO':
      return `${name} sends a ship to sea.`;
    case 'BUY_CARGO':
      return `${name} takes on cargo.`;
    case 'SELL_CARGO':
    case 'DELIVER':
      return `${name} lands cargo.`;
    default:
      return `${name} is busy at the counting house.`;
  }
}

/** The AI turns between `before` (a human's END_TURN) and `after`, or null if they cannot be shown. */
export function replayFrames(before: GameState, after: GameState): ReplayFrame[] | null {
  if (after.phase === 'over' || after.phase === 'handover') return null;
  const kinds = new Map(before.captains.map(c => [c.id, c.kind]));
  const restore = (s: GameState): GameState => ({
    ...s,
    captains: s.captains.map(c => ({ ...c, kind: kinds.get(c.id) ?? c.kind })),
  });
  const realKind = (s: GameState) => kinds.get(s.captains[s.activeIndex]?.id ?? '') ?? 'ai';

  try {
    const allAi: GameState = { ...before, captains: before.captains.map(c => ({ ...c, kind: 'ai' as const })) };
    let s = processAction(allAi, { type: 'END_TURN' });
    if (s === allAi) return null;

    const frames: ReplayFrame[] = [];
    let guard = 0;
    while (s.phase !== 'over' && realKind(s) === 'ai' && guard++ < s.captains.length) {
      const captainId = s.captains[s.activeIndex].id;
      let last = s;
      s = runAiTurn(s, (next, action) => {
        const shown = restore(next);
        frames.push({
          state: shown,
          captainId,
          action,
          text: narrate(last, next, action, captainId),
          holdMs: HOLD[action.type] ?? HOLD_DEFAULT,
        });
        last = next;
      });
    }
    if (frames.length === 0) return null;
    // Only ever show what really happened.
    if (JSON.stringify(restore(s)) !== JSON.stringify(after)) return null;
    return frames;
  } catch {
    return null;
  }
}

export interface AiReplay {
  /** Call with the state just before dispatching the player's END_TURN. */
  arm: (before: GameState) => void;
  /** The frame on screen, or null when nothing is playing. */
  frame: ReplayFrame | null;
  index: number;
  count: number;
  skip: () => void;
}

export function useAiReplay(state: GameState | null): AiReplay {
  const pace = usePace();
  const armed = useRef<GameState | null>(null);
  const [frames, setFrames] = useState<ReplayFrame[]>([]);
  const [index, setIndex] = useState(0);

  const arm = useCallback((before: GameState) => {
    armed.current = before;
  }, []);

  // A new state after an armed END_TURN: work out the replay. Anything else clears it.
  useEffect(() => {
    const before = armed.current;
    if (!state) return;
    if (!before || state === before) {
      if (before === null && frames.length > 0 && index < frames.length) {
        // A state change from elsewhere (a reload, a save conflict): stop replaying a stale turn.
        setFrames([]);
      }
      return;
    }
    armed.current = null;
    if (before.id !== state.id || paced(1000, pace) <= 0) return;
    const f = replayFrames(before, state);
    if (f) {
      setFrames(f);
      setIndex(0);
    }
    // Only a change of state starts or stops a replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const playing = frames.length > 0 && index < frames.length;

  useEffect(() => {
    if (!playing) return;
    const hold = paced(frames[index].holdMs, pace);
    const t = window.setTimeout(() => setIndex(i => i + 1), hold);
    return () => window.clearTimeout(t);
  }, [playing, index, frames, pace]);

  const skip = useCallback(() => setIndex(Number.MAX_SAFE_INTEGER), []);
  useSkipOnInput(playing, skip);

  // Switching motion off mid-replay ends it.
  useEffect(() => {
    if (paced(1000, pace) <= 0) skip();
  }, [pace, skip]);

  return {
    arm,
    frame: playing ? frames[index] : null,
    index: Math.min(index, frames.length),
    count: frames.length,
    skip,
  };
}
