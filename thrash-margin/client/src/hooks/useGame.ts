import { useState, useCallback, useEffect, useRef } from 'react';
import type { GameState, GameAction, GameConfig } from 'shared/types';
import { processAction } from 'shared/engine-reference';
import { getToken } from '../lib/token';
import type { SaveMeta } from './useGameLocal';

const API = import.meta.env.VITE_API_URL ?? '';

function authHeaders(): HeadersInit {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function useGame() {
  const [state, setState] = useState<GameState | null>(null);
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gameIdRef = useRef<string | null>(null);
  // Always holds the latest committed state so we can read it outside React renders
  const latestStateRef = useRef<GameState | null>(null);

  const fetchSaves = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/game`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setSaves(data.saves ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchSaves(); }, [fetchSaves]);

  const createGame = useCallback(async (config?: Partial<GameConfig>, name?: string): Promise<string | null> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/game`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ config, name }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message ?? 'Failed to create game'); return null; }
      setState(data.state);
      gameIdRef.current = data.gameId;
      await fetchSaves();
      return data.gameId as string;
    } catch {
      setError('Failed to create game');
      return null;
    } finally {
      setLoading(false);
    }
  }, [fetchSaves]);

  const loadGame = useCallback(async (gameId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/game/${gameId}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) { setError(data.message ?? 'Failed to load game'); return; }
      setState(data.state);
      latestStateRef.current = data.state;
      gameIdRef.current = gameId;
    } catch {
      setError('Failed to load game');
    } finally {
      setLoading(false);
    }
  }, []);

  // Apply actions locally (instant), sync full state to server only on END_TURN.
  const sendAction = useCallback(async (gameId: string, action: GameAction) => {
    // Apply locally and capture the resulting state in the ref
    setState(prev => {
      if (!prev) return prev;
      const next = processAction(prev, action);
      latestStateRef.current = next;
      return next;
    });

    if (action.type === 'END_TURN') {
      // Defer slightly so React has committed the setState above
      setTimeout(async () => {
        const current = latestStateRef.current;
        if (!current) return;
        try {
          await fetch(`${API}/api/game/${gameId}/state`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ state: current }),
          });
          // Refresh saves list so lobby shows updated status (victory/defeat/turn count)
          fetchSaves();
        } catch { /* non-fatal — state is still correct locally */ }
      }, 0);
    }
  }, [fetchSaves]);

  const deleteGame = useCallback(async (gameId: string) => {
    try {
      await fetch(`${API}/api/game/${gameId}`, { method: 'DELETE', headers: authHeaders() });
      setSaves(prev => prev.filter(s => s.id !== gameId));
    } catch { /* ignore */ }
  }, []);

  return { state, loading, error, saves, createGame, loadGame, sendAction, deleteGame };
}
