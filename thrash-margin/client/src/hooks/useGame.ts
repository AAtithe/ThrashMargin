import { useState, useCallback } from 'react';
import type { GameState, GameAction, GameConfig } from 'shared/types';
import { getToken } from '../lib/token';

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createGame = useCallback(async (config?: Partial<GameConfig>) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/game`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ config }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message ?? 'Failed to create game'); return null; }
      setState(data.state);
      return data.gameId as string;
    } catch {
      setError('Failed to create game');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGame = useCallback(async (gameId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/game/${gameId}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) { setError(data.message ?? 'Failed to load game'); return; }
      setState(data.state);
    } catch {
      setError('Failed to load game');
    } finally {
      setLoading(false);
    }
  }, []);

  const sendAction = useCallback(async (gameId: string, action: GameAction) => {
    if (!state) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/game/${gameId}/action`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) setState(data.state);
      else setError(data.message ?? 'Action failed');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [state]);

  return { state, loading, error, createGame, loadGame, sendAction };
}
