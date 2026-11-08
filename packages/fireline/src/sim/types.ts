import type { BuildingKind, Category, Difficulty, Owner, UnitKind, WeaponKind } from './rules';

/**
 * Positions are in tiles, as floats: the centre of tile (3, 7) is (3.5, 7.5). Tile indices are
 * `y * MAP_W + x`. Every list here is replaced, never mutated in place, by the reducer: an action
 * clones the state once and works on the clone, so the state passed in is never touched.
 */

export type Order =
  | { type: 'idle' }
  | { type: 'move'; x: number; y: number }
  | { type: 'attackMove'; x: number; y: number }
  | { type: 'attack'; target: number }
  | {
      type: 'harvest';
      phase: 'seek' | 'gather' | 'return' | 'unload';
      /** The ore tile being worked, or -1. */
      tile: number;
      /** The refinery being returned to, or 0. */
      refinery: number;
    };

/** Orders a unit can hold in its waypoint queue, run one after another. */
export type QueuedOrder = Extract<Order, { type: 'move' } | { type: 'attackMove' } | { type: 'attack' }>;

/**
 * What an idle unit does about enemies. Guard (the default) fires at anything in range and answers
 * fire from close by; aggressive chases anything in sight; hold fires only when ordered to.
 * Explicit orders (attack, attack-move) work the same under every stance.
 */
export type Stance = 'aggressive' | 'guard' | 'hold';

export interface Unit {
  id: number;
  owner: Owner;
  kind: UnitKind;
  x: number;
  y: number;
  hp: number;
  /** Hull facing, a unit vector. */
  fx: number;
  fy: number;
  /** Turret facing, a unit vector. */
  tx: number;
  ty: number;
  order: Order;
  /** Id of what this unit is currently shooting at, or 0. */
  engage: number;
  /** Waypoints still to visit, as tile indices. */
  path: number[];
  /** Tile index the current path leads to, or -1. */
  pathGoal: number;
  /** Tick the path was last computed, for throttled re-pathing. */
  pathTick: number;
  cooldown: number;
  /** Ore carried (haulers only). */
  cargo: number;
  /** Ticks spent unable to make progress, which triggers a re-path. */
  stuck: number;
  kills: number;
  /** Rank from kills: 0 rookie, 1 veteran, 2 elite (thresholds in rules.ts VET_KILLS). */
  vet: number;
  /** Orders to run after the current one, oldest first (shift-click). */
  queue: QueuedOrder[];
  stance: Stance;
}

export interface Building {
  id: number;
  owner: Owner;
  kind: BuildingKind;
  /** Top-left tile. */
  x: number;
  y: number;
  hp: number;
  placedAt: number;
  repairing: boolean;
  /** Where units leaving this building head, if set. */
  rally: { x: number; y: number } | null;
  cooldown: number;
  engage: number;
  /** Turret facing, for buildings with a weapon. */
  tx: number;
  ty: number;
}

export interface QueueItem {
  kind: BuildingKind | UnitKind;
  /** Ticks of work done. Halves its rate while power is short. */
  progress: number;
}

export interface PlayerState {
  owner: Owner;
  name: string;
  credits: number;
  queues: Record<Category, QueueItem[]>;
  stats: { built: number; trained: number; lost: number; killed: number; harvested: number };
}

export interface Projectile {
  id: number;
  owner: Owner;
  weapon: WeaponKind;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  firedAt: number;
  hitAt: number;
  target: number;
  damage: number;
  splash: number;
  /** Id of the unit that fired it, or 0 (structures, and saves from before this field). */
  shooter?: number;
}

/** Things that happened, kept for a few seconds so the renderer can draw them. Never read back. */
export interface Effect {
  id: number;
  kind: 'muzzle' | 'boom' | 'sold';
  x: number;
  y: number;
  at: number;
  /** Explosion size: 0 small hit, 1 vehicle, 2 structure. */
  size: number;
  weapon?: WeaponKind;
  /** For muzzle flashes: where the shot is going. */
  x2?: number;
  y2?: number;
}

export interface LogEntry {
  tick: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}

/** What the computer side remembers between decisions. Lives in state so replays stay exact. */
export interface AiMemory {
  nextAttack: number;
  wave: number;
  /** The last time and place one of its structures was hit. */
  hurtTick: number;
  hurtX: number;
  hurtY: number;
}

export interface GameState {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  seedText: string;
  rngSeed: number;
  difficulty: Difficulty;
  tick: number;
  /** One character per tile: g grass, d dirt, r rock, w water, t trees. Never changes. */
  tiles: string;
  /** Ore held by each tile, 0 for none. */
  ore: number[];
  /** Tiles the player has ever seen, one character each: '1' seen, '0' not. */
  explored: string;
  units: Unit[];
  buildings: Building[];
  players: [PlayerState, PlayerState];
  projectiles: Projectile[];
  effects: Effect[];
  ai: [AiMemory, AiMemory];
  /** When true the computer also plays side 0. Used by the test harness only. */
  autopilot: boolean;
  nextId: number;
  winner: Owner | null;
  log: LogEntry[];
  /** Last tick each kind of warning was logged, so alarms do not flood the log. */
  alarms: Record<string, number>;
}

export type GameAction =
  | { type: 'tick'; n?: number }
  | { type: 'move'; ids: number[]; x: number; y: number; attackMove?: boolean; queue?: boolean }
  | { type: 'attack'; ids: number[]; target: number; queue?: boolean }
  | { type: 'stance'; ids: number[]; stance: 'aggressive' | 'guard' | 'hold' }
  | { type: 'stop'; ids: number[] }
  | { type: 'harvest'; ids: number[]; tile?: number; refinery?: number }
  | { type: 'queue'; category: Category; kind: BuildingKind | UnitKind }
  | { type: 'cancel'; category: Category; kind: BuildingKind | UnitKind }
  | { type: 'place'; kind: BuildingKind; x: number; y: number }
  | { type: 'sell'; id: number }
  | { type: 'repair'; id: number }
  | { type: 'rally'; id: number; x: number; y: number };
