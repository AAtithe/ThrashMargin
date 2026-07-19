import { useCallback, useState } from 'react';
import { createInitialState } from '../sim/state';
import { processAction } from '../sim/actions';
import type { GameAction, GameState } from '../sim/types';

const SAVE_KEY = 'niccolo_save';

function readSave(): GameState | null {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GameState;
    // Saves from before Phase 2 lack cash/scarcity/cargo — discard rather than crash on them.
    if (typeof parsed.cash !== 'number' || !parsed.scarcity || !parsed.vessels.every(v => v.cargo)) {
      return null;
    }
    // Saves from before Phase 3 lack the news/courier-investment fields.
    if (!parsed.knownPrices || !parsed.pendingNews || !parsed.courierInvestment) {
      return null;
    }
    // Saves from before Phase 4 lack the credit/currency fields.
    if (!parsed.exchangeRates || !parsed.obligations || typeof parsed.insolvent !== 'boolean') {
      return null;
    }
    // Saves from before Phase 5 lack the roster/conscience fields.
    if (!parsed.characters || typeof parsed.conscience !== 'number') {
      return null;
    }
    // Saves from before Phase 6 lack the event-engine fields.
    if (!parsed.flags || !parsed.firedEvents || !parsed.pendingEvents) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSave(state: GameState) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

export function useGameLocal() {
  const [state, setState] = useState<GameState>(() => readSave() ?? createInitialState(crypto.randomUUID()));
  const [error, setError] = useState<string | null>(null);

  const dispatch = useCallback((action: GameAction) => {
    setState(prev => {
      try {
        const next = processAction(prev, action);
        writeSave(next);
        setError(null);
        return next;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return prev;
      }
    });
  }, []);

  const resetGame = useCallback(() => {
    const fresh = createInitialState(crypto.randomUUID());
    writeSave(fresh);
    setError(null);
    setState(fresh);
  }, []);

  return { state, error, dispatch, resetGame };
}
