// client/src/hooks/useGame.ts
// Claude Code: implement API calls, local state management, optimistic updates

import { useState, useCallback } from 'react';
import type { GameState, GameAction, GameConfig } from 'shared/types';

const API = '/api';

export function useGame() {
  const [state, setState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createGame = useCallback(async (config?: Partial<GameConfig>) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/game`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      const data = await res.json();
      setState(data.state);
      return data.gameId as string;
    } catch (e) {
      setError('Failed to create game');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGame = useCallback(async (gameId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/game/${gameId}`);
      const data = await res.json();
      setState(data.state);
    } catch (e) {
      setError('Failed to load game');
    } finally {
      setLoading(false);
    }
  }, []);

  const sendAction = useCallback(async (gameId: string, action: GameAction) => {
    if (!state) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/game/${gameId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) setState(data.state);
      else setError(data.message ?? 'Action failed');
    } catch (e) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [state]);

  return { state, loading, error, createGame, loadGame, sendAction };
}
