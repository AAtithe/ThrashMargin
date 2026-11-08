// Switches between cloud (useGameCloud) and localStorage (useGameLocal) based on auth state.
// Both hooks always run (hooks cannot be conditional); only one's return value is used, the same
// pattern the other three games on the portal use.
import { useGameCloud } from './useGameCloud';
import { useGameLocal } from './useGameLocal';
import { getToken } from '../lib/token';
import type { GameHook } from './types';

export function useGameHybrid(): GameHook {
  const cloud = useGameCloud();
  const local = useGameLocal();
  return getToken() ? cloud : local;
}
