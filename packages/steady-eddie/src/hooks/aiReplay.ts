import { processAction, runAiTurn } from '../sim/actions';
import { activeHaulier, isHotseat } from '../sim/state';
import type { GameAction, GameState, LogEntry } from '../sim/types';

/**
 * Recording the computer hauliers' turns so the screen can replay them.
 *
 * END_TURN plays every computer haulier's whole turn inside the reducer, so the game state jumps
 * from "you end your turn" straight to "it is your turn again". That state is saved at once and is
 * never held back. This file only works out, after the fact, what the board looked like between the
 * two, so the screen can show it: each haulier's turn starting, their roll, each drive and trade.
 *
 * It re-runs the same pure reducer the saved state came from (sim/actions.ts, read-only), with the
 * `observe` hook `runAiTurn` already offers. The one thing it cannot call directly is END_TURN's
 * seat advance, which is private, so it gets that by ending the turn on a copy where nobody is
 * human: END_TURN only plays computer turns when a human is seated, so that copy stops after the
 * seat advance. `kind` is read nowhere else in the reducer (only by END_TURN's loop and the hotseat
 * check), and the kinds are put back before anything else runs.
 *
 * The recording is then checked against the state the game actually holds, byte for byte. If they
 * ever differ (a future rules change that this misses), there is no replay at all rather than a
 * wrong one: the screen simply shows the result, as it always did.
 */

export interface ReplayFrame {
  /** The board at this point in the computer turns. */
  state: GameState;
  /** Whose turn is being shown. */
  haulierId: string;
  /** Null for the frame that opens a haulier's turn, before they roll. */
  action: GameAction | null;
  /** Log entries this step wrote, oldest first. */
  entries: LogEntry[];
}

export function recordAiTurns(prev: GameState, next: GameState): ReplayFrame[] | null {
  if (prev.phase !== 'act' || prev.id !== next.id) return null;
  const kinds = new Map(prev.hauliers.map(h => [h.id, h.kind] as const));

  const asAi: GameState = { ...prev, hauliers: prev.hauliers.map(h => ({ ...h, kind: 'ai' as const })) };
  let s = processAction(asAi, { type: 'END_TURN' });
  if (s === asAi) return null;
  s = { ...s, hauliers: s.hauliers.map(h => ({ ...h, kind: kinds.get(h.id) ?? h.kind })) };

  const raw: { state: GameState; haulierId: string; action: GameAction | null }[] = [];
  // The same loop, and the same guard, as endTurn in sim/actions.ts.
  let guard = 0;
  while (s.phase !== 'over' && activeHaulier(s).kind === 'ai' && guard++ < s.hauliers.length) {
    const who = activeHaulier(s).id;
    raw.push({ state: s, haulierId: who, action: null });
    s = runAiTurn(s, (st, action) => raw.push({ state: st, haulierId: who, action }));
  }
  if (s.phase !== 'over' && isHotseat(s)) s = { ...s, phase: 'handover' };

  if (raw.length === 0) return null;
  if (JSON.stringify(s) !== JSON.stringify(next)) return null;

  // Attach each step's new log lines; drop steps that changed nothing anyone could see, and fold a
  // run of desk work (loading, fittings, loans, shares) into one step so the replay stays brisk.
  const frames: ReplayFrame[] = [];
  let seen = prev.log.reduce((m, e) => Math.max(m, e.seq), -1);
  for (const f of raw) {
    const entries = f.state.log.filter(e => e.seq > seen);
    if (entries.length) seen = entries[entries.length - 1].seq;
    if (f.action && entries.length === 0) continue;
    const last = frames[frames.length - 1];
    if (last && last.haulierId === f.haulierId && isDeskWork(last.action) && isDeskWork(f.action)) {
      frames[frames.length - 1] = { ...f, entries: [...last.entries, ...entries] };
      continue;
    }
    frames.push({ ...f, entries });
  }
  return frames;
}

/** Actions that move nothing on the chart. */
function isDeskWork(action: GameAction | null): boolean {
  return action !== null && action.type !== 'ROLL' && action.type !== 'DRIVE_TO' && action.type !== 'DELIVER';
}

/**
 * How long each step holds at full pace: an opening beat while the dice tumble, longer for the
 * moments that matter (a roll moving lorries, a drive, a delivery), shorter for desk work.
 */
export function frameMs(frame: ReplayFrame): number {
  switch (frame.action?.type) {
    case undefined:
      return 420;
    case 'ROLL':
    case 'DRIVE_TO':
      return 560;
    case 'DELIVER':
      return 700;
    default:
      return 420;
  }
}
