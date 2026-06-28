import { useState, useCallback, useEffect } from 'react';
import type { GameState, GameAction, GameConfig } from 'shared/types';
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
    } catch {
      setError('Failed to load game');
    } finally {
      setLoading(false);
    }
  }, []);

  const sendAction = useCallback(async (gameId: string, action: GameAction) => {
    if (!state) return;
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
    }
  }, [state]);

  const deleteGame = useCallback(async (gameId: string) => {
    try {
      await fetch(`${API}/api/game/${gameId}`, { method: 'DELETE', headers: authHeaders() });
      setSaves(prev => prev.filter(s => s.id !== gameId));
    } catch { /* ignore */ }
  }, []);

  return { state, loading, error, saves, createGame, loadGame, sendAction, deleteGame };
}
