// Switches between cloud (useGameCloud) and localStorage (useGameLocal) based on auth state.
// Both hooks always run (hooks can't be conditional), but only one's return value is used —
// exactly the pattern Thrash Margin's own useGameHybrid already establishes.
import { useGameCloud } from './useGameCloud';
import { useGameLocal } from './useGameLocal';
import { getToken } from '../lib/portalAuth';

export function useGameHybrid() {
  const cloud = useGameCloud();
  const local = useGameLocal();
  return getToken() ? cloud : local;
}
