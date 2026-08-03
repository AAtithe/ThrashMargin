// Switches between cloud (useGameCloud) and localStorage (useGameLocal) based on auth state.
// Both hooks always run (hooks can't be conditional), but only one's return value is used —
// exactly the pattern the other two games already establish.
//
// The two hooks' createGame signatures differ in one way that matters: the local one returns a
// string, the cloud one a Promise<string | null>. Callers must await the result either way.
import { useGameCloud } from './useGameCloud';
import { useGameLocal } from './useGameLocal';
import { getToken } from '../lib/portalAuth';
import type { NewGameOptions } from '../sim/state';
import type { GameAction, GameState } from '../sim/types';
import type { SaveMeta } from './useGameLocal';

export interface GameHook {
  state: GameState | null;
  error: string | null;
  saves: SaveMeta[];
  createGame: (name?: string, opts?: NewGameOptions) => string | null | Promise<string | null>;
  loadGame: (gameId: string) => void | Promise<void>;
  dispatch: (action: GameAction) => void;
  deleteGame: (gameId: string) => void | Promise<void>;
}

export function useGameHybrid(): GameHook {
  const cloud = useGameCloud();
  const local = useGameLocal();
  return getToken() ? cloud : local;
}
