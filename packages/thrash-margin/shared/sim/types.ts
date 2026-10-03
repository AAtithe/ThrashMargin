/**
 * Thrash Margin — every type the simulation, the API and the client share.
 *
 * Save format version 2. Version 1 (the single-file prototype engine) kept one treasury and one
 * research list on the root of the state, which is why hot seat's second player spent the first
 * player's gold. Version 2 gives every faction, human or AI, its own `FactionState`, and the AI
 * plays through the same action handlers the human does. `migrateState` in state.ts upgrades a
 * version 1 save on load.
 */

/** 0 = neutral, 1 = the first human, 2..4 = the other factions (AI, or the second human in hot seat). */
export type FactionId = number;
export const NEUTRAL = 0;
export const PLAYER = 1;

export type BuildingType =
  | 'farm' | 'large_farm' | 'granary'
  | 'mine' | 'deep_mine' | 'foundry'
  | 'barracks' | 'fort'
  | 'market' | 'grand_market'
  | 'tower' | 'fortress';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'brutal';
export type TerrainType = 'plains' | 'forest' | 'mountain' | 'coast' | 'desert';
export type TechBranch = 'military' | 'economic' | 'expansion';

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * `fromId`/`troops` is the main column. `support` adds troops from any other bordering territory,
 * so a fortified capital that no single territory can hold enough troops to crack can still fall
 * to a combined assault. All attackers fight as one force and the survivors occupy the target.
 */
export interface AttackAction {
  type: 'ATTACK';
  fromId: number;
  toId: number;
  troops: number;
  support?: Array<{ fromId: number; troops: number }>;
}
export interface RecruitAction { type: 'RECRUIT'; nodeId: number; amount: number }
export interface BuildAction { type: 'BUILD'; nodeId: number; building: BuildingType }
export interface UpgradeAction { type: 'UPGRADE'; nodeId: number }
/** Moves troops to any friendly territory reachable through friendly territory. */
export interface MoveAction { type: 'MOVE'; fromId: number; toId: number; troops: number }
export interface EndTurnAction { type: 'END_TURN' }
export interface ResearchAction { type: 'RESEARCH'; techId: string }
export interface AnnexAction { type: 'ANNEX'; nodeId: number }
export interface SpyAction { type: 'SPY'; nodeId: number; mode: 'reveal' | 'sabotage' }
export interface CeasefireAction { type: 'CEASEFIRE'; faction: FactionId }
export interface ChoiceAction { type: 'CHOICE'; choiceIndex: number }
/** Buys or sells food or materials for gold at the exchange. Needs a market somewhere. */
export interface TradeAction { type: 'TRADE'; resource: 'food' | 'mat'; side: 'buy' | 'sell'; lots: number }

export type GameAction =
  | AttackAction | RecruitAction | BuildAction | UpgradeAction | MoveAction | EndTurnAction
  | ResearchAction | AnnexAction | SpyAction | CeasefireAction | ChoiceAction | TradeAction;

export type ActionType = GameAction['type'];

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export interface Territory {
  id: number;
  x: number;
  y: number;
  name: string;
  owner: FactionId;
  troops: number;
  /** Exactly one per living faction. Moves to the faction's best territory if the seat falls. */
  capital: boolean;
  lv: number;
  buildings: BuildingType[];
  stronghold?: boolean;
  terrain?: TerrainType;
}

export interface Resources {
  gold: number;
  food: number;
  mat: number;
  influence: number;
  population: number;
}

export interface FactionStats {
  battlesWon: number;
  battlesLost: number;
  captures: number;
  annexed: number;
  ceasefires: number;
  troopsLost: number;
  capitalsTaken: number;
  starved: number;
}

export interface FactionState {
  id: FactionId;
  name: string;
  human: boolean;
  resources: Resources;
  research: string[];
  /** Other faction id -> turns of peace left. Always stored on both sides. */
  ceasefires: Record<number, number>;
  /** Territory id -> the turn a spy's reveal lapses. */
  revealed: Record<number, number>;
  eliminated: boolean;
  /** Lots traded this turn, per resource. Reset at the start of the faction's turn. */
  traded: { food: number; mat: number };
  /** Turn on which the faction lost its last territory. */
  eliminatedOnTurn?: number;
  stats: FactionStats;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface GameConfig {
  diff: Difficulty;
  mapId: string;
  /** AI (or second human) factions, 1-3. Capped by what the chosen map can seat. */
  enemyFactions: number;
  /** Starting territories per AI faction, 1-4. Humans always start with their capital alone. */
  enemyTerritories: number;
  enemyTroopScale: number;
  enemyStartBuildings: boolean;
  startGold: number;
  startFood: number;
  startMat: number;
  recruitCost: number;
  /** Food per troop per turn. */
  upkeep: number;
  /** Combat multiplier on human attacks, e.g. 0.25 = +25%. */
  playerBonus: number;
  neutralStr: number;
  /** 99 means unlimited for humans. AI factions are capped at a sane budget either way. */
  apPerTurn: number;
  fogOfWar: boolean;
  enableEvents: boolean;
  enableDiplomacy: boolean;
  enableTechTree: boolean;
  enableAltVictory: boolean;
  enableStrongholds: boolean;
  enableSpies: boolean;
  altVictoryGold: number;
  hotseat: boolean;
  campaignScenario?: number;
  campaignBonusGold?: number;
  campaignBonusTechs?: string[];
}

// ---------------------------------------------------------------------------
// Log, events, report
// ---------------------------------------------------------------------------

export type LogKind = 'battle' | 'capture' | 'economy' | 'build' | 'research' | 'diplomacy' | 'event' | 'system' | 'achievement';

export interface LogEntry {
  turn: number;
  faction: FactionId;
  kind: LogKind;
  message: string;
}

export type EventTone = 'positive' | 'negative' | 'neutral';

export interface TurnEvent {
  id: string;
  title: string;
  message: string;
  tone: EventTone;
}

export interface PendingEvent {
  id: string;
  faction: FactionId;
  title: string;
  tone: EventTone;
  text: string;
  choices: Array<{ label: string; desc: string; cost?: Partial<Resources> }>;
}

export interface IncomeLine {
  gold: number;
  food: number;
  mat: number;
  influence: number;
  population: number;
  upkeep: number;
  starved: number;
}

/**
 * What happened to one human faction between the end of its turn and the start of its next: the
 * dispatch it reads before playing on. Reset when that faction ends its turn, then filled in by
 * everything every other faction does until it is that faction's turn again.
 */
export interface TurnReport {
  faction: FactionId;
  fromTurn: number;
  income: IncomeLine | null;
  /** Attacks against this faction's territories by anybody. */
  attacksSuffered: Array<{ by: FactionId; target: number; captured: boolean; lost: number }>;
  /** Territories that changed hands between other factions, and eliminations. */
  headlines: string[];
  event: TurnEvent | null;
}

export interface HistoryEntry {
  turn: number;
  /** Faction id -> snapshot at the end of that faction's turn. */
  factions: Record<number, { territories: number; troops: number; gold: number }>;
}

export type GameStatus = 'active' | 'victory' | 'defeated';
export type VictoryType = 'conquest' | 'economic' | 'research';

export interface GameState {
  version: 2;
  id: string;
  name?: string;
  createdAt: number;
  rngSeed: number;
  turn: number;
  status: GameStatus;
  winner: FactionId | null;
  victoryType?: VictoryType;
  researchBranch?: TechBranch;
  nodes: Territory[];
  edges: [number, number][];
  config: GameConfig;
  factions: Record<number, FactionState>;
  /** Whose turn it is. Only ever a human faction between actions; AI turns run inside END_TURN. */
  activeFaction: FactionId;
  actionsLeft: number;
  log: LogEntry[];
  pendingEvent: PendingEvent | null;
  lastEvent: TurnEvent | null;
  /** Human faction id -> its dispatch. */
  reports: Record<number, TurnReport>;
  history: HistoryEntry[];
  /** Achievement ids earned by faction 1 in this game. Read by the lobby's save list. */
  achievements: string[];
}

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

export interface CreateGameRequest { config?: Partial<GameConfig>; name?: string }
export interface CreateGameResponse { gameId: string; state: GameState }
export interface AuthRequest { username: string; password: string }
export interface AuthResponse { token: string; userId: string; username: string }
