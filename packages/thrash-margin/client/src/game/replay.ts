/**
 * Turning a resolved End turn back into something the player can watch.
 *
 * The engine plays every AI faction inside END_TURN and returns the finished state at once. This
 * module reads what changed (the new chronicle lines and the board before and after) and lays it
 * out as a short list of beats: a banner per AI faction, then each territory it took, each attack
 * that broke on a wall, each annexation. The screen steps through the beats (see useBeats) while
 * the real state is already applied and saved. Nothing here feeds back into the game.
 *
 * Pure: no clock, no randomness, no DOM.
 */
import { NEUTRAL, type FactionId, type GameAction, type GameState, type LogEntry, type Territory } from 'shared/sim';

export type BeatKind = 'banner' | 'capture' | 'repelled' | 'annex';

export interface Beat {
  kind: BeatKind;
  faction: FactionId;
  /** The territory the beat happens at; null for a banner. */
  node: number | null;
  /** The chronicle line, or the banner's summary. */
  text: string;
  /** The viewer's own territory was attacked in this beat. */
  againstViewer: boolean;
  /** Troops the defender lost here, when the viewer was the defender (from the dispatch). */
  viewerLoss?: number;
  /** How long to hold this beat at full pace, in ms. */
  ms: number;
}

/** New chronicle lines since `before`, oldest first. The log is newest-first and capped. */
export function newLogEntries(before: GameState, after: GameState): LogEntry[] {
  const head = before.log[0];
  if (!head) return after.log.slice().reverse();
  let k = after.log.indexOf(head);
  if (k < 0) k = after.log.findIndex(e => e.turn === head.turn && e.faction === head.faction && e.message === head.message);
  if (k < 0) k = after.log.findIndex(e => e.turn < before.turn);
  if (k < 0) k = after.log.length;
  return after.log.slice(0, k).reverse();
}

const TOOK = /took (.+?) from /;
const REPELLED = /was .+? at (.+?): lost all /;
const ANNEXED = /annexed (.+?) peacefully/;
const WIPED = /wiped from the map/;

const BANNER_MS = 260;
/** A faction's events share roughly this much time, each held between the two bounds. */
const EVENTS_MS = 460;
const EVENT_MIN_MS = 90;
const EVENT_MAX_MS = 200;
/** Long turns are summarised: at most this many board beats per faction. */
const MAX_EVENTS = 6;

/**
 * Beats for every AI faction that acted between `before` (the viewer's turn, just ended) and
 * `after`. Human factions are left out: the viewer watched their own moves, and in hot seat the
 * next human's turn has not started yet.
 */
export function deriveBeats(before: GameState, after: GameState, viewer: FactionId): Beat[] {
  const entries = newLogEntries(before, after);
  const byName = new Map<string, number>();
  for (const n of after.nodes) if (!byName.has(n.name)) byName.set(n.name, n.id);

  // Group chronicle lines into consecutive runs by faction. An elimination line is written under
  // the fallen faction's id but belongs to the turn of whoever caused it.
  const runs: Array<{ faction: FactionId; lines: LogEntry[] }> = [];
  for (const e of entries) {
    const last = runs[runs.length - 1];
    if (WIPED.test(e.message) && last) { last.lines.push(e); continue; }
    if (last && last.faction === e.faction) last.lines.push(e);
    else runs.push({ faction: e.faction, lines: [e] });
  }

  // Losses the viewer suffered, in the order the dispatch recorded them.
  const suffered = (after.reports[viewer]?.attacksSuffered ?? []).slice();
  const takeLoss = (by: FactionId, node: number) => {
    const i = suffered.findIndex(a => a.by === by && a.target === node);
    if (i < 0) return undefined;
    return suffered.splice(i, 1)[0].lost;
  };

  const beats: Beat[] = [];
  for (const run of runs) {
    const f = after.factions[run.faction] ?? before.factions[run.faction];
    if (!f || f.human || run.faction === NEUTRAL) continue;
    const events: Beat[] = [];
    let took = 0, held = 0, annexed = 0;
    for (const e of run.lines) {
      const cap = TOOK.exec(e.message);
      const rep = cap ? null : REPELLED.exec(e.message);
      const anx = cap || rep ? null : ANNEXED.exec(e.message);
      const name = cap?.[1] ?? rep?.[1] ?? anx?.[1];
      const node = name !== undefined ? byName.get(name) : undefined;
      if (node === undefined) continue;
      const kind: BeatKind = cap ? 'capture' : rep ? 'repelled' : 'annex';
      if (kind === 'capture') took++; else if (kind === 'repelled') held++; else annexed++;
      // Whose it was at the moment of the attack: the latest earlier capture beat, or the start.
      const prior = [...events].reverse().find(b => b.node === node && b.kind !== 'repelled');
      const ownerThen = prior ? prior.faction : before.nodes[node]?.owner;
      const againstViewer = kind !== 'annex' && ownerThen === viewer;
      events.push({
        kind, faction: run.faction, node, text: e.message, againstViewer,
        viewerLoss: againstViewer ? takeLoss(run.faction, node) : undefined, ms: 0,
      });
    }
    // Keep the beats that matter most to the viewer when a turn is long.
    let shown = events;
    if (events.length > MAX_EVENTS) {
      const keep = new Set(
        events.map((b, i) => ({ b, i, w: (b.againstViewer ? 2 : 0) + (b.kind === 'capture' ? 1 : 0) }))
          .sort((a, b) => b.w - a.w || a.i - b.i).slice(0, MAX_EVENTS).map(x => x.i),
      );
      shown = events.filter((_, i) => keep.has(i));
    }
    const each = shown.length ? Math.max(EVENT_MIN_MS, Math.min(EVENT_MAX_MS, Math.round(EVENTS_MS / shown.length))) : 0;
    for (const b of shown) b.ms = each;
    const bits = [
      took ? `took ${took}` : '',
      held ? `${held} attack${held === 1 ? '' : 's'} repelled` : '',
      annexed ? `annexed ${annexed}` : '',
    ].filter(Boolean);
    beats.push({
      kind: 'banner', faction: run.faction, node: null, againstViewer: false,
      text: bits.length ? bits.join(' · ') : 'mustered and built',
      ms: shown.length ? BANNER_MS : BANNER_MS + 120,
    });
    beats.push(...shown);
  }
  return beats;
}

/**
 * The board as it looked after `revealed` beats: territories that changed hands later in the
 * replay keep their old owner (and garrison) until their beat comes round. Anything that changed
 * without a beat (an event, a revolt) appears with the final board.
 */
export function boardAt(before: GameState, after: GameState, beats: Beat[], revealed: number): Territory[] {
  if (revealed >= beats.length) return after.nodes;
  const lastBeat = new Map<number, number>();
  beats.forEach((b, i) => { if (b.node !== null && b.kind !== 'repelled') lastBeat.set(b.node, i); });
  return after.nodes.map(n => {
    const was = before.nodes[n.id];
    if (!was) return n;
    const last = lastBeat.get(n.id);
    const changed = was.owner !== n.owner || last !== undefined;
    if (!changed) return n;
    if (last !== undefined && last < revealed) return n;
    // Partly through a contested territory's beats: show the latest owner so far.
    let owner = was.owner;
    for (let i = 0; i < revealed; i++) if (beats[i].node === n.id && beats[i].kind !== 'repelled') owner = beats[i].faction;
    return owner === was.owner ? was : { ...was, owner };
  });
}

/** What an attack the viewer just made cost each side, read from the board before and after. */
export function battleOutcome(before: GameState, after: GameState, a: Extract<GameAction, { type: 'ATTACK' }>):
  { captured: boolean; attackerLoss: number; defenderLoss: number } {
  const sent = a.troops + (Array.isArray(a.support) ? a.support.reduce((s, c) => s + c.troops, 0) : 0);
  const was = before.nodes[a.toId];
  const now = after.nodes[a.toId];
  const captured = now.owner === before.activeFaction && was.owner !== before.activeFaction;
  return captured
    ? { captured, attackerLoss: Math.max(0, sent - now.troops), defenderLoss: was.troops }
    : { captured, attackerLoss: sent, defenderLoss: Math.max(0, was.troops - now.troops) };
}
