import { useCallback, useEffect, useState, useRef } from 'react';
import { processAction } from '../sim/actions';
import { withAllCurrencies } from '../sim/currency';
import { API, authHeaders } from '../lib/api';
import type { GameAction, GameState } from '../sim/types';
import type { FreeplayGoal, RivalCount } from '../sim/freeplay';
import type { SaveMeta } from './useGameLocal';
import { createSaver, SAVE_ERRORS, SAVE_MESSAGES, type Saver } from '../lib/saveQueue';

/** The `tm_token` JWT this hook sends (see api/_lib/auth.ts) expires after 7 days by default —
 * every endpoint here 401s once that happens, and without this distinct message the player just
 * sees campaigns silently fail to list/start with no clue why, since the JWT stays sitting in
 * localStorage looking "signed in" (PortalNav only checks for its presence, not validity). */
const SESSION_EXPIRED = 'Your sign-in has expired — use "Sign out" above, then sign in again to reach your cloud campaigns.';

/**
 * Cloud persistence for signed-in players, backed by the same Supabase/Postgres `games` table
 * Thrash Margin uses (see packages/niccolo/api/game/*, discriminated by `game = 'niccolo'`).
 * The client stays authoritative — the same trust model useGameLocal already has — this hook
 * just mirrors every dispatched action's resulting state to the server so it survives a reload
 * on a different device instead of only in this browser's localStorage.
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
    saver.current = createSaver(`${API}/api/play/niccolo`, authHeaders, outcome => {
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
      const res = await fetch(`${API}/api/play/niccolo`, { headers: authHeaders() });
      if (res.status === 401) { setError(SESSION_EXPIRED); return; }
      if (!res.ok) return;
      const data = await res.json();
      setSaves(data.saves ?? []);
    } catch { /* non-fatal — the lobby just shows what it already has */ }
  }, []);

  afterSave.current = fetchSaves;

  useEffect(() => { fetchSaves(); }, [fetchSaves]);

  const createGame = useCallback(async (
    name?: string,
    skipPrologue?: boolean,
    hideObjectives?: boolean,
    hotseatHouseId?: string | null,
    freeplay?: boolean,
    rivals?: RivalCount,
    freeplayGoal?: FreeplayGoal,
  ): Promise<string | null> => {
    setError(null);
    try {
      const res = await fetch(`${API}/api/play/niccolo`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name, skipPrologue, hideObjectives, hotseatHouseId, freeplay, rivals, freeplayGoal }),
      });
      if (res.status === 401) { setError(SESSION_EXPIRED); return null; }
      const data = await res.json();
      if (!res.ok) { setError(data.message ?? 'Failed to start campaign'); return null; }
      setState(data.state);
      saver.current?.reset(data.gameId, data.version);
      await fetchSaves();
      return data.gameId as string;
    } catch {
      setError('Network error — failed to start campaign');
      return null;
    }
  }, [fetchSaves]);

  const loadGame = useCallback(async (gameId: string) => {
    setError(null);
    try {
      const res = await fetch(`${API}/api/play/niccolo?id=${gameId}`, { headers: authHeaders() });
      if (res.status === 401) { setError(SESSION_EXPIRED); return; }
      const data = await res.json();
      if (!res.ok) { setError(data.message ?? 'Failed to load campaign'); return; }
      saver.current?.reset(gameId, data.version);
      setState({ ...data.state, exchangeRates: withAllCurrencies(data.state.exchangeRates) });
    } catch {
      setError('Network error — failed to load campaign');
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
      setError(null);
      saver.current?.save(next.id, next);
      return next;
    });
  }, [fetchSaves]);

  const deleteGame = useCallback(async (gameId: string) => {
    try {
      await fetch(`${API}/api/play/niccolo?id=${gameId}`, { method: 'DELETE', headers: authHeaders() });
      setSaves(prev => prev.filter(s => s.id !== gameId));
    } catch { /* ignore */ }
  }, []);

  return { state, error, saves, createGame, loadGame, dispatch, deleteGame };
}
