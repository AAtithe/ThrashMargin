import { useCallback, useEffect, useState, useRef } from 'react';
import { processAction } from '../sim/actions';
import { migrateState } from '../sim/state';
import { API, authHeaders } from '../lib/api';
import type { NewGameOptions } from '../sim/state';
import type { GameAction, GameState } from '../sim/types';
import type { SaveMeta } from './useGameLocal';
import { createSaver, SAVE_ERRORS, SAVE_MESSAGES, type Saver } from '../lib/saveQueue';

/**
 * The `tm_token` JWT this hook sends (see api/_lib/auth.ts) expires after 7 days by default. Every
 * endpoint 401s once that happens, and without a distinct message the player just sees games
 * silently fail to list or start with no clue why — the token sits in localStorage still looking
 * "signed in", because PortalNav only checks that it is present, not that it still verifies.
 *
 * This exact failure hit Niccolo in production. Carried over deliberately, along with the reason it
 * does NOT clear the token automatically: useGameHybrid re-reads getToken() on every render, so
 * clearing here would flip the hook from cloud to local on the very next render and swallow this
 * message before anyone read it. The header's own "Sign out" is the explicit next step.
 */
const SESSION_EXPIRED =
  'Your sign-in has expired — use "Sign out" above, then sign in again to reach your cloud games.';

/**
 * Cloud persistence for signed-in players, backed by the same Supabase/Postgres `games` table the
 * other two games use (see packages/tea-race/api/game/*, discriminated by `game = 'tea_race'`).
 * The client stays authoritative — the same trust model useGameLocal has — this hook just mirrors
 * every dispatched action's resulting state to the server so it survives a reload elsewhere.
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
    saver.current = createSaver(`${API}/api/play/tea-race`, authHeaders, outcome => {
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
      const res = await fetch(`${API}/api/play/tea-race`, { headers: authHeaders() });
      if (res.status === 401) {
        setError(SESSION_EXPIRED);
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setSaves(data.saves ?? []);
    } catch {
      /* non-fatal — the lobby just shows what it already has */
    }
  }, []);

  afterSave.current = fetchSaves;

  useEffect(() => {
    fetchSaves();
  }, [fetchSaves]);

  const createGame = useCallback(
    async (name?: string, opts?: NewGameOptions): Promise<string | null> => {
      setError(null);
      try {
        const res = await fetch(`${API}/api/play/tea-race`, {
          method: 'POST',
          headers: authHeaders(),
          // Every field the lobby can set has to go over the wire. This sent only the first four
          // for a long time, which meant that for any signed-in player — and the sign-in gate makes
          // that everybody — the presets, all eleven rule toggles, the difficulty dial and the
          // choice of ruleset were silently discarded and every game came out as the default. The
          // settings screen worked perfectly and changed nothing.
          body: JSON.stringify({
            name,
            humanNames: opts?.humanNames,
            aiCount: opts?.aiCount,
            seed: opts?.seed,
            rules: opts?.rules,
            hazards: opts?.hazards,
            difficulty: opts?.difficulty,
          }),
        });
        if (res.status === 401) {
          setError(SESSION_EXPIRED);
          return null;
        }
        const data = await res.json();
        if (!res.ok) {
          setError(data.message ?? 'Failed to start the voyage');
          return null;
        }
        setState(data.state);
        saver.current?.reset(data.gameId, data.version);
        await fetchSaves();
        return data.gameId as string;
      } catch {
        setError('Network error — failed to start the voyage');
        return null;
      }
    },
    [fetchSaves],
  );

  const loadGame = useCallback(async (gameId: string) => {
    setError(null);
    try {
      const res = await fetch(`${API}/api/play/tea-race?id=${gameId}`, { headers: authHeaders() });
      if (res.status === 401) {
        setError(SESSION_EXPIRED);
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? 'Failed to load the voyage');
        return;
      }
      saver.current?.reset(gameId, data.version);
      setState(migrateState(data.state));
    } catch {
      setError('Network error — failed to load the voyage');
    }
  }, []);

  const dispatch = useCallback(
    (action: GameAction) => {
      setState(prev => {
        if (!prev) return prev;
        let next: GameState;
        try {
          next = processAction(prev, action);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          return prev;
        }
        if (next === prev) return prev; // rejected — nothing to sync
        setError(null);
        saver.current?.save(next.id, next);
        return next;
      });
    },
    [fetchSaves],
  );

  const deleteGame = useCallback(async (gameId: string) => {
    try {
      await fetch(`${API}/api/play/tea-race?id=${gameId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      setSaves(prev => prev.filter(s => s.id !== gameId));
    } catch {
      /* ignore */
    }
  }, []);

  return { state, error, saves, createGame, loadGame, dispatch, deleteGame };
}
