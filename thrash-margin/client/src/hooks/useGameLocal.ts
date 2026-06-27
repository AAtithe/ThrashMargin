import { useState, useCallback } from 'react';
import { createInitialState, DEFAULT_CONFIG, processAction } from 'shared/engine-reference';
import type { GameState, GameAction, GameConfig } from 'shared/types';

const INDEX_KEY = 'tm_saves';
const stateKey = (id: string) => `tm_save_${id}`;

export interface SaveMeta {
  id: string;
  name: string;
  turn: number;
  status: 'active' | 'victory' | 'defeated';
  diff: string;
  savedAt: number; // ms timestamp
}

function readIndex(): SaveMeta[] {
  const raw = localStorage.getItem(INDEX_KEY);
  if (!raw) {
    // One-time migration from the old single-slot format
    const old = localStorage.getItem('tm_local_game');
    if (old) {
      try {
        const s = JSON.parse(old) as GameState;
        if (s?.id) {
          const meta: SaveMeta[] = [{
            id: s.id, name: 'Imported Campaign',
            turn: s.turn, status: s.status as SaveMeta['status'],
            diff: s.config?.diff ?? 'normal', savedAt: Date.now(),
          }];
          localStorage.setItem(INDEX_KEY, JSON.stringify(meta));
          localStorage.setItem(stateKey(s.id), old);
          localStorage.removeItem('tm_local_game');
          return meta;
        }
      } catch { /* ignore */ }
    }
    return [];
  }
  try { return JSON.parse(raw) as SaveMeta[]; }
  catch { return []; }
}

function writeIndex(idx: SaveMeta[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
}

function upsertIndex(s: GameState, nameOverride?: string): SaveMeta[] {
  const idx = readIndex();
  const existing = idx.find(e => e.id === s.id);
  const meta: SaveMeta = {
    id: s.id,
    name: nameOverride ?? existing?.name ?? 'Campaign',
    turn: s.turn,
    status: s.status as SaveMeta['status'],
    diff: s.config?.diff ?? 'normal',
    savedAt: Date.now(),
  };
  const newIdx = existing
    ? idx.map(e => e.id === s.id ? meta : e)
    : [meta, ...idx];
  writeIndex(newIdx);
  return newIdx;
}

export function useGameLocal() {
  const [state, setState] = useState<GameState | null>(null);
  const [loading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saves, setSaves] = useState<SaveMeta[]>(readIndex);

  const createGame = useCallback((config?: Partial<GameConfig>, name?: string): string => {
    const idx = readIndex();
    const id = crypto.randomUUID();
    const s = createInitialState(id, { ...DEFAULT_CONFIG, ...config });
    const campaignName = name?.trim() || `Campaign #${idx.length + 1}`;
    localStorage.setItem(stateKey(id), JSON.stringify(s));
    setSaves(upsertIndex(s, campaignName));
    setState(s);
    return id;
  }, []);

  const loadGame = useCallback((gameId: string) => {
    try {
      const raw = localStorage.getItem(stateKey(gameId));
      if (!raw) { setError('Save not found'); return; }
      setState(JSON.parse(raw) as GameState);
    } catch {
      setError('Could not load save');
    }
  }, []);

  const sendAction = useCallback(async (_gameId: string, action: GameAction) => {
    setState(prev => {
      if (!prev) return prev;
      const next = processAction(prev, action);
      localStorage.setItem(stateKey(next.id), JSON.stringify(next));
      setSaves(upsertIndex(next));
      return next;
    });
  }, []);

  const deleteGame = useCallback((gameId: string) => {
    localStorage.removeItem(stateKey(gameId));
    const newIdx = readIndex().filter(e => e.id !== gameId);
    writeIndex(newIdx);
    setSaves(newIdx);
  }, []);

  return { state, loading, error, saves, createGame, loadGame, sendAction, deleteGame };
}
