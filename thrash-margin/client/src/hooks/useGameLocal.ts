import { useState, useCallback } from 'react';
import { createInitialState, DEFAULT_CONFIG, processAction } from 'shared/engine-reference';
import type { GameState, GameAction, GameConfig } from 'shared/types';

const KEY = 'tm_local_game';

function save(s: GameState) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function useGameLocal() {
  const [state, setState] = useState<GameState | null>(null);
  const [loading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createGame = useCallback((config?: Partial<GameConfig>): string => {
    const id = crypto.randomUUID();
    const s = createInitialState(id, { ...DEFAULT_CONFIG, ...config });
    setState(s);
    save(s);
    return id;
  }, []);

  const loadGame = useCallback((gameId: string) => {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    try {
      const s: GameState = JSON.parse(raw);
      if (s.id === gameId) setState(s);
    } catch {
      setError('Could not load saved game');
    }
  }, []);

  const sendAction = useCallback(async (_gameId: string, action: GameAction) => {
    setState(prev => {
      if (!prev) return prev;
      const next = processAction(prev, action);
      save(next);
      return next;
    });
  }, []);

  return { state, loading, error, createGame, loadGame, sendAction };
}
