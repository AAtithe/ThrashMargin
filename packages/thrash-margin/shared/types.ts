// shared/types.ts
// All types shared between client and server

export type Owner = number; // 0=Neutral, 1=Player, 2+=Enemy factions
export const NEUTRAL = 0;
export const PLAYER = 1;
export const ENEMY = 2;

export function isEnemy(o: Owner): boolean { return o >= 2; }

export type BuildingType =
  | 'farm' | 'large_farm' | 'granary'
  | 'mine' | 'deep_mine' | 'foundry'
  | 'barracks' | 'fort'
  | 'market' | 'grand_market'
  | 'tower' | 'fortress';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'brutal';
export type TerrainType = 'plains' | 'forest' | 'mountain' | 'coast' | 'desert';

export type ActionType =
  | 'ATTACK'
  | 'RECRUIT'
  | 'BUILD'
  | 'UPGRADE'
  | 'MOVE'
  | 'END_TURN'
  | 'RESEARCH'
  | 'ANNEX'
  | 'SPY'
  | 'CEASEFIRE'
  | 'CHOICE';

export interface AttackAction {
  type: 'ATTACK';
  fromId: number;
  toId: number;
  troops: number;
}

export interface RecruitAction {
  type: 'RECRUIT';
  nodeId: number;
  amount: number;
}

export interface BuildAction {
  type: 'BUILD';
  nodeId: number;
  building: BuildingType;
}

export interface UpgradeAction {
  type: 'UPGRADE';
  nodeId: number;
}

export interface MoveAction {
  type: 'MOVE';
  fromId: number;
  toId: number;
  troops: number;
}

export interface EndTurnAction {
  type: 'END_TURN';
}

export interface ResearchAction {
  type: 'RESEARCH';
  techId: string;
}

export interface AnnexAction {
  type: 'ANNEX';
  nodeId: number;
}

export interface SpyAction { type: 'SPY'; nodeId: number; mode: 'reveal' | 'sabotage'; }
export interface CeasefireAction { type: 'CEASEFIRE'; faction: number; }
export interface ChoiceAction { type: 'CHOICE'; choiceIndex: number; }

export type GameAction =
  | AttackAction
  | RecruitAction
  | BuildAction
  | UpgradeAction
  | MoveAction
  | EndTurnAction
  | ResearchAction
  | AnnexAction
  | SpyAction
  | CeasefireAction
  | ChoiceAction;

export interface Territory {
  id: number;
  x: number;
  y: number;
  name: string;
  owner: Owner;
  troops: number;
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

export interface GameConfig {
  aggro: number;
  expand: number;
  growth: number;
  buildChance: number;
  diff: Difficulty;
  startGold: number;
  startFood: number;
  startMat: number;
  recruitCost: number;
  upkeep: number;
  playerBonus: number;
  neutralStr: number;
  enemyTerritories: number;
  enemyTroopScale: number;
  enemyStartBuildings: boolean;
  apPerTurn: number;         // action points available each player turn
  fogOfWar: boolean;         // hide troop counts/buildings for non-adjacent territories
  enableEvents: boolean;     // trigger a random event each turn
  mapId: string;             // which map layout to use
  enemyFactions: number;     // number of enemy factions (1-3)
  enableDiplomacy: boolean;  // influence resource + peaceful annexation
  enableTechTree: boolean;   // tech tree system
  enableAltVictory: boolean; // economic / research victory conditions
  enableStrongholds: boolean;// neutral stronghold territories
  altVictoryGold: number;    // gold threshold for economic victory
  enableTutorial?: boolean;  // guided tutorial mode
  hotseat?: boolean;         // two human players alternate turns
  enableSpies?: boolean;     // spy actions: reveal / sabotage
  campaignScenario?: number;     // which act this is (0-based)
  campaignBonusGold?: number;    // bonus gold carried over from previous act
  campaignBonusTechs?: string[]; // techs carried over from previous act
}

export interface TurnEvent {
  id: string;
  title: string;
  message: string;
  type: 'positive' | 'negative' | 'neutral';
}

export interface LogEntry {
  turn: number;
  message: string;
  timestamp: number;
}

export type GameStatus = 'active' | 'victory' | 'defeated';

export interface HistoryEntry { turn: number; gold: number; territories: number; troops: number; }

export interface GameState {
  id: string;
  turn: number;
  status: GameStatus;
  nodes: Territory[];
  edges: [number, number][];
  resources: Resources;
  config: GameConfig;
  log: LogEntry[];
  sel: number | null;
  tgt: number | null;
  actionsLeft: number;
  lastEvent: TurnEvent | null;
  research: string[];
  victoryType?: string;
  researchBranch?: string;
  activePlayer: number;      // 1 = Player 1 turn, 2 = Player 2 turn (hot seat only)
  revealed: number[];        // node ids revealed by spy
  ceasefires: Record<number, number>; // faction -> turns remaining
  achievements: string[];
  history: HistoryEntry[];
  pendingEvent?: { id: string; title: string; type: 'positive'|'negative'|'neutral'; choices: Array<{ label: string; desc: string }> };
}

export interface ActionResult {
  success: boolean;
  state: GameState;
  message?: string;
}

// API request/response shapes
export interface CreateGameRequest {
  config?: Partial<GameConfig>;
}

export interface CreateGameResponse {
  gameId: string;
  state: GameState;
}

export interface ActionRequest {
  action: GameAction;
}

export interface ActionResponse {
  success: boolean;
  state: GameState;
  message?: string;
}

export interface AuthRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  userId: string;
  username: string;
}
