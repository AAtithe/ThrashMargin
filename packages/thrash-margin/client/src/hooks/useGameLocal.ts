import { useCallback, useRef, useState } from 'react';
import { createInitialState, migrateState, processAction } from 'shared/sim';
import type { GameAction, GameConfig, GameState } from 'shared/sim';
import { metaOf, newSeed, type GameHook, type SaveMeta } from './types';

const INDEX_KEY = 'tm_saves';
const stateKey = (id: string) => `tm_save_${id}`;

function readIndex(): SaveMeta[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as SaveMeta[];
  } catch {
    return [];
  }
}

function write(s: GameState, name?: string): SaveMeta[] {
  try {
    localStorage.setItem(stateKey(s.id), JSON.stringify(s));
    const idx = readIndex();
    const existing = idx.find(e => e.id === s.id);
    const meta = metaOf(s, name ?? existing?.name);
    const next = existing ? idx.map(e => (e.id === s.id ? meta : e)) : [meta, ...idx];
    localStorage.setItem(INDEX_KEY, JSON.stringify(next));
    return next;
  } catch {
    return readIndex();
  }
}

/** Browser-only persistence: used when there is no sign-in token (see useGameHybrid). */
export function useGameLocal(): GameHook {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saves, setSaves] = useState<SaveMeta[]>(readIndex);
  const ref = useRef<GameState | null>(null);

  const commit = useCallback((s: GameState) => {
    ref.current = s;
    setState(s);
    setSaves(write(s));
  }, []);

  const createGame = useCallback(async (config: Partial<GameConfig>, name?: string) => {
    const id = crypto.randomUUID();
    const label = name?.trim() || `Campaign ${readIndex().length + 1}`;
    const s = createInitialState(id, config, { seed: newSeed(), createdAt: Date.now(), name: label });
    ref.current = s;
    setState(s);
    setSaves(write(s, label));
    return id;
  }, []);

  const loadGame = useCallback(async (id: string) => {
    setError(null);
    try {
      const raw = localStorage.getItem(stateKey(id));
      if (!raw) { setError('Save not found.'); return; }
      const s = migrateState(JSON.parse(raw));
      ref.current = s;
      setState(s);
    } catch {
      setError('That save could not be read.');
    }
  }, []);

  const dispatch = useCallback((action: GameAction) => {
    const prev = ref.current;
    if (!prev) return null;
    const next = processAction(prev, action);
    if (next === prev) return null;
    commit(next);
    return next;
  }, [commit]);

  const deleteGame = useCallback(async (id: string) => {
    localStorage.removeItem(stateKey(id));
    const next = readIndex().filter(e => e.id !== id);
    localStorage.setItem(INDEX_KEY, JSON.stringify(next));
    setSaves(next);
  }, []);

  return { state, error, loading: false, saveStatus: 'saved', saves, createGame, loadGame, dispatch, restore: commit, deleteGame };
}
