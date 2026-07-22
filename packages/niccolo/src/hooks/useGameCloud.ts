import { useCallback, useEffect, useState } from 'react';
import { processAction } from '../sim/actions';
import { withAllCurrencies } from '../sim/currency';
import { API, authHeaders } from '../lib/api';
import type { GameAction, GameState } from '../sim/types';
import type { SaveMeta } from './useGameLocal';

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

  const fetchSaves = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/niccolo/game`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setSaves(data.saves ?? []);
    } catch { /* non-fatal — the lobby just shows what it already has */ }
  }, []);

  useEffect(() => { fetchSaves(); }, [fetchSaves]);

  const createGame = useCallback(async (name?: string): Promise<string | null> => {
    setError(null);
    try {
      const res = await fetch(`${API}/api/niccolo/game`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message ?? 'Failed to start campaign'); return null; }
      setState(data.state);
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
      const res = await fetch(`${API}/api/niccolo/game/${gameId}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) { setError(data.message ?? 'Failed to load campaign'); return; }
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
      // Fire-and-forget sync — the UI already has the new state; a failed sync just means
      // this particular week's progress stays local until the next successful sync.
      fetch(`${API}/api/niccolo/game/${next.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ state: next }),
      })
        .then(() => fetchSaves())
        .catch(() => { /* non-fatal */ });
      return next;
    });
  }, [fetchSaves]);

  const deleteGame = useCallback(async (gameId: string) => {
    try {
      await fetch(`${API}/api/niccolo/game/${gameId}`, { method: 'DELETE', headers: authHeaders() });
      setSaves(prev => prev.filter(s => s.id !== gameId));
    } catch { /* ignore */ }
  }, []);

  return { state, error, saves, createGame, loadGame, dispatch, deleteGame };
}
