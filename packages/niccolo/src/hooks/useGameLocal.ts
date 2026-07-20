import { useCallback, useState } from 'react';
import { createInitialState } from '../sim/state';
import { processAction } from '../sim/actions';
import type { GameAction, GameState } from '../sim/types';

const INDEX_KEY = 'niccolo_saves';
const stateKey = (id: string) => `niccolo_save_${id}`;
const OLD_SINGLE_SLOT_KEY = 'niccolo_save';

export interface SaveMeta {
  id: string;
  name: string;
  turn: number;
  status: 'active' | 'victory' | 'defeated';
  savedAt: number; // ms timestamp
}

function statusOf(s: GameState): SaveMeta['status'] {
  if (s.insolvent) return 'defeated';
  if (s.flags.chapter1_complete) return 'victory';
  return 'active';
}

/** A save from before Phase 2/3/4/5/6/7/8 is missing fields those phases added and would crash
 * the sim if loaded as-is — discard it rather than throw, matching every prior phase's guard. */
function isCurrentShape(parsed: unknown): parsed is GameState {
  const s = parsed as Partial<GameState> | null;
  if (!s || typeof s !== 'object') return false;
  if (typeof s.cash !== 'number' || !s.scarcity || !s.vessels?.every(v => v.cargo)) return false;
  if (!s.knownPrices || !s.pendingNews || !s.courierInvestment) return false;
  if (!s.exchangeRates || !s.obligations || typeof s.insolvent !== 'boolean') return false;
  if (!s.characters || typeof s.conscience !== 'number') return false;
  if (!s.flags || !s.firedEvents || !s.pendingEvents) return false;
  if (!s.secrets || !('condotta' in s)) return false;
  if (!s.houseRelations || !s.agents) return false;
  return true;
}

function readIndex(): SaveMeta[] {
  const raw = localStorage.getItem(INDEX_KEY);
  if (raw) {
    try { return JSON.parse(raw) as SaveMeta[]; }
    catch { return []; }
  }

  // One-time migration from the old single-slot format (pre-Phase-8 saves).
  const old = localStorage.getItem(OLD_SINGLE_SLOT_KEY);
  localStorage.removeItem(OLD_SINGLE_SLOT_KEY);
  if (!old) return [];
  try {
    const parsed = JSON.parse(old);
    if (!isCurrentShape(parsed)) return [];
    const meta: SaveMeta[] = [{
      id: parsed.id,
      name: parsed.name ?? 'Imported Campaign',
      turn: parsed.week,
      status: statusOf(parsed),
      savedAt: Date.now(),
    }];
    localStorage.setItem(INDEX_KEY, JSON.stringify(meta));
    localStorage.setItem(stateKey(parsed.id), old);
    return meta;
  } catch {
    return [];
  }
}

function writeIndex(idx: SaveMeta[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
}

function upsertIndex(s: GameState): SaveMeta[] {
  const idx = readIndex();
  const existing = idx.find(e => e.id === s.id);
  const meta: SaveMeta = {
    id: s.id,
    name: s.name ?? existing?.name ?? 'Campaign',
    turn: s.week,
    status: statusOf(s),
    savedAt: Date.now(),
  };
  const next = existing ? idx.map(e => (e.id === s.id ? meta : e)) : [meta, ...idx];
  writeIndex(next);
  return next;
}

export function useGameLocal() {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saves, setSaves] = useState<SaveMeta[]>(readIndex);

  const createGame = useCallback((name?: string): string => {
    const idx = readIndex();
    const id = crypto.randomUUID();
    const campaignName = name?.trim() || `Campaign #${idx.length + 1}`;
    const fresh = createInitialState(id, campaignName);
    localStorage.setItem(stateKey(id), JSON.stringify(fresh));
    setSaves(upsertIndex(fresh));
    setState(fresh);
    setError(null);
    return id;
  }, []);

  const loadGame = useCallback((gameId: string) => {
    try {
      const raw = localStorage.getItem(stateKey(gameId));
      const parsed = raw ? JSON.parse(raw) : null;
      if (!isCurrentShape(parsed)) { setError('Save not found or too old to load'); return; }
      setState(parsed);
      setError(null);
    } catch {
      setError('Could not load save');
    }
  }, []);

  const dispatch = useCallback((action: GameAction) => {
    setState(prev => {
      if (!prev) return prev;
      try {
        const next = processAction(prev, action);
        localStorage.setItem(stateKey(next.id), JSON.stringify(next));
        setSaves(upsertIndex(next));
        setError(null);
        return next;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return prev;
      }
    });
  }, []);

  const deleteGame = useCallback((gameId: string) => {
    localStorage.removeItem(stateKey(gameId));
    const next = readIndex().filter(e => e.id !== gameId);
    writeIndex(next);
    setSaves(next);
  }, []);

  return { state, error, saves, createGame, loadGame, dispatch, deleteGame };
}
