/**
 * What the build window remembers outside the battle state (fireline-round8-build-window.md): the
 * income rate, the enemy kinds seen, new unlocks, the structure being pointed at, the advisor
 * switch, the view and the quick bar. Interface only: none of it is saved with the battle or read
 * by the simulation. Browser storage is wrapped, so a blocked or spoiled store only loses the
 * viewer's preference.
 */
import { useSyncExternalStore } from 'react';
import { TICKS_PER_SECOND, type UnitKind } from '../sim/rules';
import { isEnemy } from '../sim/sides';
import type { GameState } from '../sim/types';
import type { Kind } from './buildPlan';
import type { Tab } from './Sidebar';

// ---- A small store -------------------------------------------------------------------------------

export interface Store<T> {
  get: () => T;
  set: (v: T) => void;
  sub: (f: () => void) => () => void;
}

export function store<T>(init: T): Store<T> {
  let v = init;
  const subs = new Set<() => void>();
  return {
    get: () => v,
    set: n => {
      if (Object.is(n, v)) return;
      v = n;
      subs.forEach(f => f());
    },
    sub: f => {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}

export const useStore = <T,>(s: Store<T>): T => useSyncExternalStore(s.sub, s.get, s.get);

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Blocked storage: the preference lasts this visit only. */
  }
}

// ---- Income ---------------------------------------------------------------------------------------

const WINDOW_TICKS = 60 * TICKS_PER_SECOND;
let incomeFor = '';
let samples: [number, number][] = [];

/** Notes the ore harvested so far; called with every state the screen shows. */
export function noteIncome(state: GameState): void {
  const id = String(state.id ?? '');
  const last = samples[samples.length - 1];
  if (id !== incomeFor || (last && state.tick < last[0])) {
    incomeFor = id;
    samples = [];
  }
  const h = state.players[0].stats.harvested;
  if (last && last[0] === state.tick) return;
  samples.push([state.tick, h]);
  while (samples.length > 2 && samples[0][0] < state.tick - WINDOW_TICKS) samples.shift();
}

/** Credits harvested per second of battle over the last minute, or null before ten seconds of it. */
export function incomePerSecond(state: GameState): number | null {
  if (String(state.id ?? '') !== incomeFor || samples.length < 2) return null;
  const [t0, h0] = samples[0];
  const [t1, h1] = samples[samples.length - 1];
  if (t1 - t0 < 10 * TICKS_PER_SECOND) return null;
  return ((h1 - h0) / (t1 - t0)) * TICKS_PER_SECOND;
}

// ---- Scouting -------------------------------------------------------------------------------------

let scoutFor = '';
let seenIds = new Map<string, Set<number>>();
let seenCounts: Record<string, number> = {};

/** Notes every enemy unit side 0 can see now, by kind. */
export function noteScouting(state: GameState, vis: Uint8Array): void {
  const id = String(state.id ?? '');
  if (id !== scoutFor) {
    scoutFor = id;
    seenIds = new Map();
    seenCounts = {};
  }
  let changed = false;
  for (const u of state.units) {
    if (u.hp <= 0 || !isEnemy(state, 0, u.owner)) continue;
    if (!vis[Math.floor(u.y) * state.mapW + Math.floor(u.x)]) continue;
    let ids = seenIds.get(u.kind);
    if (!ids) seenIds.set(u.kind, (ids = new Set()));
    if (!ids.has(u.id)) {
      ids.add(u.id);
      changed = true;
    }
  }
  if (changed) {
    const next: Record<string, number> = {};
    for (const [k, ids] of seenIds) next[k as UnitKind] = ids.size;
    seenCounts = next;
  }
}

/** Enemy units seen this visit, by kind (distinct units). */
export const scouted = (state: GameState): Readonly<Record<string, number>> => (String(state.id ?? '') === scoutFor ? seenCounts : {});

// ---- New unlocks ----------------------------------------------------------------------------------

/** Kinds unlocked during this visit, with when (performance.now()), and the tabs not yet looked at. */
export const fresh = store<{ kinds: ReadonlyMap<Kind, number>; tabs: ReadonlySet<Tab> }>({ kinds: new Map(), tabs: new Set() });

export function markFresh(kinds: { kind: Kind; tab: Tab }[]): void {
  if (!kinds.length) return;
  const cur = fresh.get();
  const k = new Map(cur.kinds);
  const t = new Set(cur.tabs);
  const now = performance.now();
  for (const x of kinds) {
    k.set(x.kind, now);
    t.add(x.tab);
  }
  fresh.set({ kinds: k, tabs: t });
}

export function seenTab(tab: Tab): void {
  const cur = fresh.get();
  if (!cur.tabs.has(tab)) return;
  const t = new Set(cur.tabs);
  t.delete(tab);
  fresh.set({ kinds: cur.kinds, tabs: t });
}

export function clearFresh(): void {
  fresh.set({ kinds: new Map(), tabs: new Set() });
}

/** How long a new card glows. */
export const FRESH_MS = 6000;

// ---- The structure being pointed at (the power meter's preview) -----------------------------------

export const preview = store<Kind | null>(null);

// ---- Viewer preferences ---------------------------------------------------------------------------

export type BuildView = 'build' | 'tree';
export const buildView = store<BuildView>(readPref('fl_build_view') === 'tree' ? 'tree' : 'build');
export function setBuildView(v: BuildView): void {
  buildView.set(v);
  writePref('fl_build_view', v);
}

/** 'on', 'off', or null: never chosen, so the battle's difficulty decides (on at Easy). */
export const advisorPref = store<'on' | 'off' | null>(((v: string | null) => (v === 'on' || v === 'off' ? v : null))(readPref('fl_advisor')));
export function setAdvisor(on: boolean): void {
  advisorPref.set(on ? 'on' : 'off');
  writePref('fl_advisor', on ? 'on' : 'off');
}
export const advisorOn = (pref: 'on' | 'off' | null, state: GameState): boolean => (pref === null ? state.difficulty === 'easy' : pref === 'on');

// ---- Quick bar ------------------------------------------------------------------------------------

export const QUICK_MAX = 6;
/** The keys of the quick bar's slots, in order. F5 is left to the browser. */
export const QUICK_KEYS = ['F1', 'F2', 'F3', 'F4', 'F6', 'F7'] as const;

function readPins(): Kind[] {
  try {
    const v = JSON.parse(readPref('fl_quickbar') ?? '[]');
    return Array.isArray(v) ? (v.filter(x => typeof x === 'string').slice(0, QUICK_MAX) as Kind[]) : [];
  } catch {
    return [];
  }
}
export const pins = store<readonly Kind[]>(readPins());

/** Pins or unpins a kind; false when the bar is full. */
export function togglePin(kind: Kind): boolean {
  const cur = pins.get();
  let next: Kind[];
  if (cur.includes(kind)) next = cur.filter(k => k !== kind);
  else if (cur.length >= QUICK_MAX) return false;
  else next = [...cur, kind];
  pins.set(next);
  writePref('fl_quickbar', JSON.stringify(next));
  return true;
}
