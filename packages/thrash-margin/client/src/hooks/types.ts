import type { GameAction, GameConfig, GameState } from 'shared/sim';

export interface SaveMeta {
  id: string;
  name: string;
  turn: number;
  status: 'active' | 'victory' | 'defeated';
  diff: string;
  mapId?: string;
  savedAt: number;
  campaignScenario?: number;
  achievements?: string[];
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** What both persistence hooks provide, so the pages never care which one is live. */
export interface GameHook {
  state: GameState | null;
  error: string | null;
  loading: boolean;
  saveStatus: SaveStatus;
  saves: SaveMeta[];
  createGame: (config: Partial<GameConfig>, name?: string) => Promise<string | null>;
  loadGame: (id: string) => Promise<void>;
  /** Applies an action. Returns the new state, or null if the engine rejected it. */
  dispatch: (action: GameAction) => GameState | null;
  /** Puts back an earlier state (undo) and saves it. */
  restore: (state: GameState) => void;
  deleteGame: (id: string) => Promise<void>;
}

export function metaOf(s: GameState, name?: string): SaveMeta {
  return {
    id: s.id,
    name: name ?? s.name ?? 'Campaign',
    turn: s.turn,
    status: s.status,
    diff: s.config.diff,
    mapId: s.config.mapId,
    savedAt: Date.now(),
    ...(s.config.campaignScenario !== undefined ? { campaignScenario: s.config.campaignScenario } : {}),
    ...(s.achievements.length ? { achievements: s.achievements } : {}),
  };
}

/** A fresh seed for a new game. Randomness is fine out here: the sim only ever sees the number. */
export const newSeed = () => Math.floor(Math.random() * 0xffffffff) >>> 0;
