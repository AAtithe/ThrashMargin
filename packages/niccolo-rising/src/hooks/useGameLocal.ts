import { useCallback, useState } from 'react';
import { createInitialState, isCurrentShape, migrateState } from '../sim/state';
import { processAction } from '../sim/actions';
import type { GameAction, GameState } from '../sim/types';

const INDEX_KEY = 'nrising_saves';
const stateKey = (id: string) => `nrising_save_${id}`;

export interface SaveMeta {
  id: string;
  name: string;
  /** The character's level. Called `turn` to match the shape every other game's lobby uses. */
  turn: number;
  status: 'active';
  savedAt: number;
}

function readIndex(): SaveMeta[] {
  const raw = localStorage.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as SaveMeta[];
  } catch {
    return [];
  }
}

const writeIndex = (idx: SaveMeta[]) => localStorage.setItem(INDEX_KEY, JSON.stringify(idx));

function upsertIndex(s: GameState): SaveMeta[] {
  const idx = readIndex();
  const meta: SaveMeta = { id: s.id, name: s.name, turn: s.level, status: 'active', savedAt: Date.now() };
  const next = idx.some(e => e.id === s.id) ? idx.map(e => (e.id === s.id ? meta : e)) : [meta, ...idx];
  writeIndex(next);
  return next;
}

/**
 * localStorage persistence. Reached only when there is no token, which the sign-in gate means is
 * never in normal play; it stays because the hybrid pattern is the portal's, and because it is what
 * a signed-in player whose token has been cleared mid-session falls back to.
 */
export function useGameLocal() {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saves, setSaves] = useState<SaveMeta[]>(readIndex);

  const createGame = useCallback((name?: string, seed?: string): string => {
    const id = crypto.randomUUID();
    const fresh = createInitialState(id, name?.trim() || 'Claes', { seed, createdAt: Date.now() });
    localStorage.setItem(stateKey(id), JSON.stringify(fresh));
    setSaves(upsertIndex(fresh));
    setState(fresh);
    setError(null);
    return id;
  }, []);

  const loadGame = useCallback((gameId: string) => {
    try {
      const raw = localStorage.getItem(stateKey(gameId));
      const parsed = migrateState(raw ? JSON.parse(raw) : null);
      if (!isCurrentShape(parsed)) {
        setError('Character not found, or from an older version of the game');
        return;
      }
      setState(parsed);
      setError(null);
    } catch {
      setError('Could not load the character');
    }
  }, []);

  const dispatch = useCallback((action: GameAction) => {
    setState(prev => {
      if (!prev) return prev;
      try {
        const next = processAction(prev, action);
        if (next === prev) return prev;
        localStorage.setItem(stateKey(next.id), JSON.stringify(next));
        setSaves(upsertIndex(next));
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
