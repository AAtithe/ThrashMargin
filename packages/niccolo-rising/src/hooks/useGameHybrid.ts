// Cloud when there is a token, localStorage otherwise. Both hooks always run (hooks cannot be
// conditional) and only one's return value is used: the pattern every game in the portal shares.
import { useGameCloud } from './useGameCloud';
import { useGameLocal } from './useGameLocal';
import { getToken } from '../lib/portalAuth';
import type { GameAction, GameState } from '../sim/types';
import type { SaveMeta } from './useGameLocal';

export interface GameHook {
  state: GameState | null;
  error: string | null;
  saves: SaveMeta[];
  createGame: (name?: string, seed?: string) => string | null | Promise<string | null>;
  loadGame: (gameId: string) => void | Promise<void>;
  dispatch: (action: GameAction) => void;
  deleteGame: (gameId: string) => void | Promise<void>;
}

export function useGameHybrid(): GameHook {
  const cloud = useGameCloud();
  const local = useGameLocal();
  return getToken() ? cloud : local;
}
