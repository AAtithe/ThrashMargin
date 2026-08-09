import { useCallback, useState } from 'react';
import { createInitialState, migrateState, type NewGameOptions } from '../sim/state';
import { processAction } from '../sim/actions';
import type { GameAction, GameState } from '../sim/types';

const INDEX_KEY = 'tearace_saves';
const stateKey = (id: string) => `tearace_save_${id}`;

export interface SaveMeta {
  id: string;
  name: string;
  /** Rounds elapsed. Called `turn` to match the shape the other two games' lobbies use. */
  turn: number;
  status: 'active' | 'victory';
  savedAt: number;
}

const statusOf = (s: GameState): SaveMeta['status'] => (s.winnerId ? 'victory' : 'active');

/**
 * A save written before a field existed would crash the sim if loaded as-is, so discard it rather
 * than throw. Every field checked here is one the reducer reads unconditionally.
 *
 * Worth remembering when this game grows: Niccolo learned the hard way that this guard only sees
 * the TOP level. A new key added inside an existing nested record slips straight past it and
 * crashes whatever reads it. If a future change adds one, check for it explicitly.
 */
function isCurrentShape(parsed: unknown): parsed is GameState {
  const s = parsed as Partial<GameState> | null;
  if (!s || typeof s !== 'object') return false;
  if (s.rules !== 'classic') return false;
  if (typeof s.rngSeed !== 'number' || typeof s.round !== 'number') return false;
  if (!Array.isArray(s.captains) || !Array.isArray(s.ships)) return false;
  if (!Array.isArray(s.contracts) || !Array.isArray(s.deck)) return false;
  if (typeof s.sharesRemaining !== 'number' || !('declaration' in s) || !('winnerId' in s)) return false;
  if (!s.sailPoints || !s.dice || !Array.isArray(s.log)) return false;
  // Every ship must have a hold — migrateState converts the old single-cargo shape first.
  if (!s.ships.every(sh => Array.isArray((sh as { hold?: unknown }).hold))) return false;
  if (typeof s.nextContractSeq !== 'number' || typeof s.nextShipSeq !== 'number') return false;
  if (typeof s.nextLogSeq !== 'number') return false;
  return true;
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
  const existing = idx.find(e => e.id === s.id);
  const meta: SaveMeta = {
    id: s.id,
    name: s.name ?? existing?.name ?? 'Voyage',
    turn: s.round,
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

  const createGame = useCallback((name?: string, opts?: NewGameOptions): string => {
    const idx = readIndex();
    const id = crypto.randomUUID();
    const gameName = name?.trim() || `Voyage #${idx.length + 1}`;
    const fresh = createInitialState(id, gameName, { ...opts, createdAt: Date.now() });
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
        setError('Save not found, or from an older version of the game');
        return;
      }
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
        if (next === prev) return prev; // rejected — nothing to write
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
