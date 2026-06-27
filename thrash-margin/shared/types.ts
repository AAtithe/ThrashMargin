// shared/types.ts
// All types shared between client and server

export type Owner = 0 | 1 | 2; // 0=Neutral, 1=Player, 2=Enemy
export const NEUTRAL = 0;
export const PLAYER = 1;
export const ENEMY = 2;

export type BuildingType = 'farm' | 'mine' | 'barracks' | 'market' | 'tower';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'brutal';

export type ActionType =
  | 'ATTACK'
  | 'RECRUIT'
  | 'BUILD'
  | 'UPGRADE'
  | 'END_TURN';

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

export interface EndTurnAction {
  type: 'END_TURN';
}

export type GameAction =
  | AttackAction
  | RecruitAction
  | BuildAction
  | UpgradeAction
  | EndTurnAction;

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
}

export interface Resources {
  gold: number;
  food: number;
  mat: number;
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
}

export interface LogEntry {
  turn: number;
  message: string;
  timestamp: number;
}

export type GameStatus = 'active' | 'victory' | 'defeated';

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
