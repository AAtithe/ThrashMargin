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

  // Attach each step's new log lines and drop steps that changed nothing anyone could see.
  const visible: ReplayFrame[] = [];
  let seen = prev.log.reduce((m, e) => Math.max(m, e.seq), -1);
  for (const f of raw) {
    const entries = f.state.log.filter(e => e.seq > seen);
    if (entries.length) seen = entries[entries.length - 1].seq;
    if (f.action && entries.length === 0) continue;
    visible.push({ ...f, entries });
  }

  // Desk work (loading, fittings, loans, shares) moves nothing on the chart, so it never gets a beat
  // of its own. It rides with the same haulier's next roll, drive or delivery ("Loaded tea. Set off
  // for Leeds."), or, at the end of their turn, with the beat before it, which then shows the board
  // as it stood after the desk work (only cash and holds differ).
  const frames: ReplayFrame[] = [];
  let carried: LogEntry[] = [];
  for (let i = 0; i < visible.length; i++) {
    const f = visible[i];
    const nextIsSameTurn = visible[i + 1]?.haulierId === f.haulierId;
    if (isDeskWork(f.action)) {
      if (nextIsSameTurn) {
        carried = [...carried, ...f.entries];
        continue;
      }
      const last = frames[frames.length - 1];
      if (last && last.haulierId === f.haulierId) {
        frames[frames.length - 1] = { ...last, state: f.state, entries: [...last.entries, ...carried, ...f.entries] };
        carried = [];
        continue;
      }
    }
    frames.push(carried.length ? { ...f, entries: [...carried, ...f.entries] } : f);
    carried = [];
  }
  return frames;
}

/** Actions that move nothing on the chart. */
function isDeskWork(action: GameAction | null): boolean {
  return action !== null && action.type !== 'ROLL' && action.type !== 'DRIVE_TO' && action.type !== 'DELIVER';
}

/**
 * How long each step would like to hold at full pace: a short opening beat while the dice tumble,
 * longer for the moments that matter (a roll moving lorries, a drive, a delivery). `replayHolds`
 * then fits the whole round to a budget, so these are the most a step ever gets, not what it gets.
 */
export function frameMs(frame: ReplayFrame): number {
  switch (frame.action?.type) {
    case undefined:
      return 360;
    case 'ROLL':
      return 440;
    case 'DRIVE_TO':
      return 500;
    case 'DELIVER':
      return 640;
    default:
      return 380; // desk work, only ever alone when it is all a haulier did after rolling
  }
}

/** The shortest a step is squeezed to before the round as a whole is squeezed instead. Long enough
 * to read the strip's one line and see the dice land. */
function floorMs(frame: ReplayFrame): number {
  switch (frame.action?.type) {
    case undefined:
      return 240;
    case 'ROLL':
      return 260;
    case 'DELIVER':
      return 380;
    default:
      return 280;
  }
}

/** A typical round (three computer hauliers) plays in about this long at full pace. */
export const REPLAY_TARGET_MS = 2800;
/** No round ever plays for longer than this at full pace, however busy. */
export const REPLAY_CAP_MS = 3800;

/**
 * Each step's hold at full pace, fitted to the round. A quiet round keeps `frameMs` as it is. A busy
 * one is squeezed toward `REPLAY_TARGET_MS` evenly, no step below its floor, so a delivery still
 * outlasts a drive; and if the floors alone overrun `REPLAY_CAP_MS` (a round of many vehicles),
 * every step shares the cut. Pure, so the timing can be measured outside a browser.
 */
export function replayHolds(frames: ReplayFrame[]): number[] {
  const base = frames.map(frameMs);
  const floors = frames.map(floorMs);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  if (sum(base) <= REPLAY_TARGET_MS) return base;
  const at = (k: number) => base.map((b, i) => Math.max(floors[i], b * k));
  let lo = 0;
  let hi = 1;
  for (let n = 0; n < 24; n++) {
    const mid = (lo + hi) / 2;
    if (sum(at(mid)) > REPLAY_TARGET_MS) hi = mid;
    else lo = mid;
  }
  let holds = at(lo);
  const total = sum(holds);
  if (total > REPLAY_CAP_MS) holds = holds.map(h => (h * REPLAY_CAP_MS) / total);
  return holds.map(h => Math.round(h));
}
