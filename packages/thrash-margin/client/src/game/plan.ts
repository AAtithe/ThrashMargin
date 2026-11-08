/**
 * Pure helpers that turn a selection into what the player can do with it. Everything legal is
 * still decided by the engine's `explain`; these only decide what to highlight and suggest.
 */
import {
  atPeace, friendlyPath, neighboursOf, resolveCombat, troopsToWin, type GameAction, type GameState,
} from 'shared/sim';
import { NEUTRAL } from 'shared/sim';
import type { MapMarks } from '../components/MapView';

export type OrderKind = 'attack' | 'move' | 'annex';

/** Map overlays for the current selection. */
export function marksFor(state: GameState, selected: number | null, target: number | null, columns: Map<number, number>): Omit<MapMarks, 'hit'> {
  const empty = { attack: new Set<number>(), move: new Set<number>(), annex: new Set<number>(), columns: new Map<number, number>() };
  if (selected === null) return empty;
  const me = state.activeFaction;
  const sel = state.nodes[selected];
  if (!sel || sel.owner !== me) return empty;
  const attack = new Set<number>();
  const annex = new Set<number>();
  for (const m of neighboursOf(state, selected)) {
    const t = state.nodes[m];
    if (t.owner === me) continue;
    if (!atPeace(state, me, t.owner)) attack.add(m);
    if (t.owner === NEUTRAL && state.config.enableDiplomacy) annex.add(m);
  }
  const move = new Set<number>();
  for (const n of state.nodes) {
    if (n.owner === me && n.id !== selected && friendlyPath(state, me, selected, n.id)) move.add(n.id);
  }
  return { attack, move, annex, columns: target !== null && state.nodes[target]?.owner !== me ? columns : new Map() };
}

export function orderKind(state: GameState, selected: number | null, target: number | null): OrderKind | null {
  if (selected === null || target === null) return null;
  const t = state.nodes[target];
  if (!t) return null;
  if (t.owner === state.activeFaction) return 'move';
  return 'attack';
}

/** Every territory of the active faction that borders `target` and has troops to spare. */
export function possibleColumns(state: GameState, target: number): Array<{ id: number; max: number }> {
  const me = state.activeFaction;
  return neighboursOf(state, target)
    .map(id => state.nodes[id])
    .filter(n => n.owner === me && n.troops >= 2)
    .map(n => ({ id: n.id, max: n.troops - 1 }))
    .sort((a, b) => b.max - a.max || a.id - b.id);
}

/**
 * A sensible opening plan: enough for a decisive win (ratio 1.8) if the bordering territories can
 * manage it, otherwise enough to win at all, otherwise everything. The selected territory goes
 * first so the player's own choice of attacker is honoured.
 */
export function suggestColumns(state: GameState, selected: number, target: number): Map<number, number> {
  const me = state.activeFaction;
  const t = state.nodes[target];
  const cols = possibleColumns(state, target).sort((a, b) => (a.id === selected ? -1 : b.id === selected ? 1 : 0));
  const total = cols.reduce((s, c) => s + c.max, 0);
  const want = troopsToWin(state, me, t, total, 1.8) ?? troopsToWin(state, me, t, total, 1) ?? total;
  const out = new Map<number, number>();
  let left = want;
  for (const c of cols) {
    if (left <= 0) break;
    const n = Math.min(c.max, left);
    out.set(c.id, n);
    left -= n;
  }
  if (!out.size && cols.length) out.set(cols[0].id, cols[0].max);
  return out;
}

export function attackFrom(target: number, columns: Map<number, number>): GameAction | null {
  const cols = [...columns.entries()].filter(([, n]) => n > 0);
  if (!cols.length) return null;
  const [[fromId, troops], ...rest] = cols;
  return { type: 'ATTACK', toId: target, fromId, troops, ...(rest.length ? { support: rest.map(([id, n]) => ({ fromId: id, troops: n })) } : {}) };
}

export function previewAttack(state: GameState, target: number, columns: Map<number, number>) {
  const sent = [...columns.values()].reduce((s, n) => s + n, 0);
  if (sent < 1) return null;
  return { sent, ...resolveCombat(state, state.activeFaction, sent, state.nodes[target]) };
}

/** Actions that reveal nothing and roll nothing can be taken back within the turn. */
export function undoable(action: GameAction): boolean {
  return ['RECRUIT', 'BUILD', 'UPGRADE', 'MOVE', 'RESEARCH', 'ANNEX', 'CEASEFIRE', 'TRADE'].includes(action.type);
}
