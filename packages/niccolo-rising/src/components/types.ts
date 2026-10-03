import type { GameAction, GameState } from '../sim/types';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An action as a panel builds it: the screen stamps the time when it is dispatched. */
export type Verb = DistributiveOmit<GameAction, 'at'>;

export interface PlaceProps {
  /** The state advanced to `now`, so every timer and bar on the panel is current. */
  s: GameState;
  now: number;
  act: (v: Verb) => void;
  /** Why a verb would be refused right now, or null. Drives disabled buttons and their tooltips. */
  why: (v: Verb) => string | null;
}
