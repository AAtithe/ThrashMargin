import { useCallback, useEffect, useState, useRef } from 'react';
import { processAction } from '../sim/actions';
import { isCurrentShape, migrateState } from '../sim/state';
import { API, authHeaders } from '../lib/api';
import type { GameAction, GameState } from '../sim/types';
import type { SaveMeta } from './useGameLocal';
import { createSaver, SAVE_ERRORS, SAVE_MESSAGES, type Saver } from '../lib/saveQueue';

/** See Steady Eddie's useGameCloud for why an expired token is reported rather than cleared. */
const SESSION_EXPIRED =
  'Your sign-in has expired. Use "Sign out" above, then sign in again to reach your characters.';

const ENDPOINT = `${API}/api/play/niccolo-rising`;

/**
 * Cloud persistence for signed-in players, in the shared `games` table (`game = 'niccolo_rising'`).
 * The client is authoritative and mirrors each accepted action's state to the server. A rejected
 * action, or a TICK that changed nothing, returns the same object and is never written.
 */
export function useGameCloud() {
  const [state, setState] = useState<GameState | null>(null);
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Saves go through one queue: one request in flight, always the latest state, carrying the
  // version the game was loaded at, so another tab's newer progress is never overwritten
  // (lib/saveQueue.ts). Kept in a ref so every render shares it.
  const afterSave = useRef<() => void>(() => {});
  const saver = useRef<Saver | null>(null);
  if (!saver.current) {
    saver.current = createSaver(ENDPOINT, authHeaders, outcome => {
      if (outcome === 'saved') {
        setError(prev => (prev && SAVE_ERRORS.has(prev) ? null : prev));
        afterSave.current();
      } else {
        setError(outcome === 'expired' ? SESSION_EXPIRED : SAVE_MESSAGES[outcome]);
      }
    });
  }

  const fetchSaves = useCallback(async () => {
    try {
      const res = await fetch(ENDPOINT, { headers: authHeaders() });
      if (res.status === 401) {
        setError(SESSION_EXPIRED);
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setSaves(data.saves ?? []);
    } catch {
      /* non-fatal: the lobby shows what it already has */
    }
  }, []);

  useEffect(() => {
    fetchSaves();
  }, [fetchSaves]);

  const createGame = useCallback(
    async (name?: string, seed?: string): Promise<string | null> => {
      setError(null);
      try {
        const res = await fetch(ENDPOINT, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name, seed }) });
        if (res.status === 401) {
          setError(SESSION_EXPIRED);
          return null;
        }
        const data = await res.json();
        if (!res.ok) {
          setError(data.message ?? 'Failed to create the character');
          return null;
        }
        setState(data.state);
        saver.current?.reset(data.gameId, data.version);
        await fetchSaves();
        return data.gameId as string;
      } catch {
        setError('Network error: failed to create the character');
        return null;
      }
    },
    [fetchSaves],
  );

  const loadGame = useCallback(async (gameId: string) => {
    setError(null);
    try {
      const res = await fetch(`${ENDPOINT}?id=${encodeURIComponent(gameId)}`, { headers: authHeaders() });
      if (res.status === 401) {
        setError(SESSION_EXPIRED);
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? 'Failed to load the character');
        return;
      }
      const migrated = migrateState(data.state);
      if (!isCurrentShape(migrated)) {
        setError('That character is from an older version of the game');
        return;
      }
      saver.current?.reset(gameId, data.version);
      setState(migrated);
    } catch {
      setError('Network error: failed to load the character');
    }
  }, []);

  const dispatch = useCallback((action: GameAction) => {
    setState(prev => {
      if (!prev) return prev;
      let next: GameState;
      try {
        next = processAction(prev, action);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return prev;
      }
      if (next === prev) return prev;
      saver.current?.save(next.id, next);
      return next;
    });
  }, []);

  const deleteGame = useCallback(async (gameId: string) => {
    try {
      await fetch(`${ENDPOINT}?id=${encodeURIComponent(gameId)}`, { method: 'DELETE', headers: authHeaders() });
      setSaves(prev => prev.filter(s => s.id !== gameId));
    } catch {
      /* ignore */
    }
  }, []);

  return { state, error, saves, createGame, loadGame, dispatch, deleteGame };
}
