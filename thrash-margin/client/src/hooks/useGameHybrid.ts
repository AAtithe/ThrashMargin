// Switches between cloud (useGame) and localStorage (useGameLocal) based on auth state.
// Both hooks always run (hooks can't be conditional), but only one's return value is used.
import { useGame } from './useGame';
import { useGameLocal } from './useGameLocal';
import { getToken } from '../lib/token';

export function useGameHybrid() {
  const cloud = useGame();
  const local = useGameLocal();
  return getToken() ? cloud : local;
}
