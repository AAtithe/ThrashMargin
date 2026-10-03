/**
 * Static content: buildings, settlement levels, terrain, the tech tree, factions, difficulty and
 * the lobby presets. Nothing in here changes during a game.
 */
import type { BuildingType, Difficulty, GameConfig, TechBranch, TerrainType } from './types';

// ---------------------------------------------------------------------------
// Factions
// ---------------------------------------------------------------------------

export const FACTION_NAMES: Record<number, string> = {
  0: 'Neutral',
  1: 'Ironhold',
  2: 'Crimson Horde',
  3: 'Dusk Court',
  4: 'Emerald League',
};

/** Fill and edge colour per faction. Muted so terrain still reads underneath. */
export const FACTION_COLORS: Record<number, { fill: string; edge: string; ink: string }> = {
  0: { fill: '#5b5e66', edge: '#8a8d94', ink: '#c9cbd0' },
  1: { fill: '#2f6fb3', edge: '#6aa6e6', ink: '#cfe3fa' },
  2: { fill: '#b2403a', edge: '#e5776f', ink: '#fbd4d0' },
  3: { fill: '#7550b0', edge: '#a888e0', ink: '#e4d8fa' },
  4: { fill: '#2f8a5f', edge: '#66c496', ink: '#d0f2e1' },
};

// ---------------------------------------------------------------------------
// Action point costs
// ---------------------------------------------------------------------------

export const AP_COST = {
  ATTACK: 2,
  /** Recruiting costs gold, not time: action points are for strategic moves. */
  RECRUIT: 0,
  BUILD: 1,
  UPGRADE: 1,
  MOVE: 1,
  /** A move that passes through other friendly territory on the way. */
  MOVE_FAR: 2,
  ANNEX: 1,
  RESEARCH: 1,
  SPY: 1,
  CEASEFIRE: 1,
} as const;

/** `apPerTurn` at or above this means "unlimited" for humans. */
export const UNLIMITED_AP = 99;

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export const TERRAIN: Record<TerrainType, { label: string; gold: number; food: number; mat: number; def: number; note: string }> = {
  plains:   { label: 'Plains',   gold:  0, food:  0, mat: 0, def:  0, note: 'No modifiers.' },
  forest:   { label: 'Forest',   gold:  0, food:  1, mat: 0, def: -1, note: '+1 food, -1 defence.' },
  mountain: { label: 'Mountain', gold: -1, food:  0, mat: 1, def:  3, note: '+3 defence, +1 materials, -1 gold.' },
  coast:    { label: 'Coast',    gold:  2, food:  0, mat: 0, def:  0, note: '+2 gold from trade.' },
  desert:   { label: 'Desert',   gold:  0, food: -1, mat: 1, def:  0, note: '+1 materials, -1 food.' },
};

export function terrainOf(t?: TerrainType) {
  return TERRAIN[t ?? 'plains'];
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export interface BuildingDef {
  name: string;
  short: string;
  family: 'farm' | 'mine' | 'barracks' | 'market' | 'tower';
  tier: 1 | 2 | 3;
  cost: { gold: number; mat: number };
  prod?: { food?: number; mat?: number; gold?: number };
  pop?: number;
  troopCap?: number;
  defBonus?: number;
  desc: string;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  farm:         { name: 'Farm',         short: 'Fa', family: 'farm',     tier: 1, cost: { gold: 6,  mat: 8  }, prod: { food: 4 },  pop: 1, desc: '+4 food, +1 population per turn' },
  large_farm:   { name: 'Large Farm',   short: 'LF', family: 'farm',     tier: 2, cost: { gold: 10, mat: 12 }, prod: { food: 6 },  pop: 2, desc: '+6 food, +2 population per turn' },
  granary:      { name: 'Granary',      short: 'Gr', family: 'farm',     tier: 3, cost: { gold: 18, mat: 20 }, prod: { food: 10 }, pop: 3, desc: '+10 food, +3 population per turn' },
  mine:         { name: 'Mine',         short: 'Mi', family: 'mine',     tier: 1, cost: { gold: 8,  mat: 6  }, prod: { mat: 3 },  desc: '+3 materials per turn' },
  deep_mine:    { name: 'Deep Mine',    short: 'DM', family: 'mine',     tier: 2, cost: { gold: 12, mat: 8  }, prod: { mat: 5 },  desc: '+5 materials per turn' },
  foundry:      { name: 'Foundry',      short: 'Fd', family: 'mine',     tier: 3, cost: { gold: 22, mat: 15 }, prod: { mat: 8 },  desc: '+8 materials per turn' },
  barracks:     { name: 'Barracks',     short: 'Ba', family: 'barracks', tier: 1, cost: { gold: 10, mat: 10 }, troopCap: 5,  desc: '+5 troop capacity' },
  fort:         { name: 'Fort',         short: 'Ft', family: 'barracks', tier: 2, cost: { gold: 18, mat: 18 }, troopCap: 10, desc: '+10 troop capacity' },
  market:       { name: 'Market',       short: 'Mk', family: 'market',   tier: 1, cost: { gold: 12, mat: 8  }, prod: { gold: 2 }, desc: '+2 gold per turn, +1 influence with diplomacy' },
  grand_market: { name: 'Grand Market', short: 'GM', family: 'market',   tier: 2, cost: { gold: 20, mat: 14 }, prod: { gold: 4 }, desc: '+4 gold per turn, +1 influence with diplomacy' },
  tower:        { name: 'Tower',        short: 'To', family: 'tower',    tier: 1, cost: { gold: 10, mat: 12 }, defBonus: 4, desc: '+4 defence' },
  fortress:     { name: 'Fortress',     short: 'Fx', family: 'tower',    tier: 2, cost: { gold: 18, mat: 22 }, defBonus: 8, desc: '+8 defence' },
};

export const BASE_BUILDINGS: BuildingType[] = ['farm', 'mine', 'barracks', 'market', 'tower'];

/** Building -> what it upgrades into, in the same slot. */
export const BUILDING_UPGRADES: Partial<Record<BuildingType, BuildingType>> = {
  farm: 'large_farm', large_farm: 'granary',
  mine: 'deep_mine', deep_mine: 'foundry',
  barracks: 'fort',
  market: 'grand_market',
  tower: 'fortress',
};

/** Upgrade -> the building it replaces. */
export const BUILDING_PREREQ: Partial<Record<BuildingType, BuildingType>> = {
  large_farm: 'farm', granary: 'large_farm',
  deep_mine: 'mine', foundry: 'deep_mine',
  fort: 'barracks',
  grand_market: 'market',
  fortress: 'tower',
};

// ---------------------------------------------------------------------------
// Settlement levels (index = level; index 0 unused)
// ---------------------------------------------------------------------------

export const MAX_LV = 8;

export const LEVELS = {
  slots:      [0, 1, 2, 3, 4,  5,  5,  6,  6],
  gold:       [0, 2, 3, 4, 6,  8, 11, 14, 18],
  /** Every settlement feeds a few of its own troops. The prototype's fed none, so a new
   *  player's starting garrison ate 8 food a turn against a capital that grew 2. */
  food:       [0, 1, 1, 2, 2,  3,  3,  4,  4],
  troopCap:   [0, 6, 10, 14, 18, 22, 28, 34, 42],
  /** Cost to reach this level from the one below. */
  upMat:      [0, 0, 12, 22, 36, 55, 80, 110, 145],
  upGold:     [0, 0,  5,  9, 15, 22, 32,  45,  60],
  upPop:      [0, 0,  0,  0,  0, 10, 20,  35,  55],
};

export const CAPITAL_BONUS = { gold: 2, food: 3, mat: 2, troopCap: 8, def: 3 };
export const STRONGHOLD_GOLD = 3;

// ---------------------------------------------------------------------------
// Tech tree
// ---------------------------------------------------------------------------

export interface TechDef {
  id: string;
  name: string;
  branch: TechBranch;
  tier: 1 | 2 | 3 | 4;
  prereq: string | null;
  cost: { gold: number; mat: number };
  desc: string;
}

export const TECH_TREE: TechDef[] = [
  { id: 'iron_will',         name: 'Iron Will',         branch: 'military',  tier: 1, prereq: null,                cost: { gold: 15, mat: 8  }, desc: 'Attacks cost 1 action point instead of 2.' },
  { id: 'siege_craft',       name: 'Siege Craft',       branch: 'military',  tier: 2, prereq: 'iron_will',         cost: { gold: 25, mat: 15 }, desc: '+25% attack strength.' },
  { id: 'war_doctrine',      name: 'War Doctrine',      branch: 'military',  tier: 3, prereq: 'siege_craft',       cost: { gold: 40, mat: 25 }, desc: 'Failed attacks kill 3 more defenders.' },
  { id: 'total_war',         name: 'Total War',         branch: 'military',  tier: 4, prereq: 'war_doctrine',      cost: { gold: 60, mat: 40 }, desc: 'Losses on a victory are cut by 40%.' },
  { id: 'trade_routes',      name: 'Trade Routes',      branch: 'economic',  tier: 1, prereq: null,                cost: { gold: 10, mat: 12 }, desc: '+1 gold per turn for every 2 territories held.' },
  { id: 'industrialisation', name: 'Industrialisation', branch: 'economic',  tier: 2, prereq: 'trade_routes',      cost: { gold: 20, mat: 18 }, desc: 'Every mine, deep mine and foundry gives +1 material.' },
  { id: 'granaries',         name: 'Supply Lines',      branch: 'economic',  tier: 3, prereq: 'industrialisation', cost: { gold: 30, mat: 25 }, desc: 'Troop upkeep cut by a quarter, and starvation halved.' },
  { id: 'market_dominance',  name: 'Market Dominance',  branch: 'economic',  tier: 4, prereq: 'granaries',         cost: { gold: 50, mat: 35 }, desc: 'Every market and grand market gives +2 gold.' },
  { id: 'cartography',       name: 'Cartography',       branch: 'expansion', tier: 1, prereq: null,                cost: { gold: 12, mat: 10 }, desc: 'Lifts the fog of war for good.' },
  { id: 'colonisation',      name: 'Colonisation',      branch: 'expansion', tier: 2, prereq: 'cartography',       cost: { gold: 20, mat: 15 }, desc: 'Annexing a neutral costs 12 influence instead of 20.' },
  { id: 'fortifications',    name: 'Fortifications',    branch: 'expansion', tier: 3, prereq: 'colonisation',      cost: { gold: 35, mat: 22 }, desc: 'Towers and fortresses defend 50% harder.' },
  { id: 'grand_strategy',    name: 'Grand Strategy',    branch: 'expansion', tier: 4, prereq: 'fortifications',    cost: { gold: 55, mat: 38 }, desc: '+1 action point every turn.' },
];

export const TECH_BY_ID: Record<string, TechDef> = Object.fromEntries(TECH_TREE.map(t => [t.id, t]));

export const TECH_BRANCHES: Record<TechBranch, string[]> = {
  military:  ['iron_will', 'siege_craft', 'war_doctrine', 'total_war'],
  economic:  ['trade_routes', 'industrialisation', 'granaries', 'market_dominance'],
  expansion: ['cartography', 'colonisation', 'fortifications', 'grand_strategy'],
};

export const BRANCH_LABELS: Record<TechBranch, string> = {
  military: 'Military',
  economic: 'Economic',
  expansion: 'Expansion',
};

// ---------------------------------------------------------------------------
// The exchange
// ---------------------------------------------------------------------------

/** Units per lot, and gold per lot to buy or sell. Selling recovers half. */
export const TRADE_LOT = 5;
export const TRADE_PRICES: Record<'food' | 'mat', { buy: number; sell: number }> = {
  food: { buy: 6, sell: 3 },
  mat: { buy: 15, sell: 7 },
};
/** Lots a faction may trade per resource per turn, so the exchange is a lever, not a printing press. */
export const TRADE_LOTS_PER_TURN = 4;

// ---------------------------------------------------------------------------
// Diplomacy and espionage
// ---------------------------------------------------------------------------

export const ANNEX_COST = 20;
export const ANNEX_COST_COLONISATION = 12;
export const CEASEFIRE_COST = 30;
export const CEASEFIRE_TURNS = 4;
export const SPY_REVEAL_COST = 15;
export const SPY_REVEAL_TURNS = 3;
export const SPY_SABOTAGE_COST = 25;
/** Share of the loser's gold taken when their capital falls. */
export const CAPITAL_PLUNDER = 0.25;

// ---------------------------------------------------------------------------
// Difficulty — applies to AI factions only
// ---------------------------------------------------------------------------

export interface DifficultyDef {
  label: string;
  /** Multiplier on an AI faction's gold, food and materials income. */
  incomeMult: number;
  /** Added to the AI's action point budget. */
  apBonus: number;
  /** How much better than even the AI wants its odds before it attacks. Lower is bolder. */
  minRatio: number;
  /** How keenly it targets humans over neutrals and other AI. */
  humanFocus: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
  easy:   { label: 'Easy',   incomeMult: 0.7,  apBonus: -1, minRatio: 1.8, humanFocus: 0.5 },
  normal: { label: 'Normal', incomeMult: 1.0,  apBonus: 0,  minRatio: 1.3, humanFocus: 1.0 },
  hard:   { label: 'Hard',   incomeMult: 1.2,  apBonus: 0,  minRatio: 1.3, humanFocus: 1.5 },
  brutal: { label: 'Brutal', incomeMult: 1.4,  apBonus: 0,  minRatio: 1.0, humanFocus: 0.8 },
};

/** AI factions never get more than this many action points, even when humans have unlimited. */
export const AI_AP_CAP = 7;

// ---------------------------------------------------------------------------
// Configuration and presets
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: GameConfig = {
  diff: 'normal',
  mapId: 'heartlands',
  enemyFactions: 1,
  enemyTerritories: 2,
  enemyTroopScale: 1,
  enemyStartBuildings: false,
  startGold: 35,
  startFood: 20,
  startMat: 15,
  recruitCost: 4,
  upkeep: 1,
  playerBonus: 0,
  neutralStr: 3,
  apPerTurn: 5,
  fogOfWar: false,
  enableEvents: true,
  enableDiplomacy: false,
  enableTechTree: true,
  enableAltVictory: false,
  enableStrongholds: false,
  enableSpies: false,
  altVictoryGold: 400,
  hotseat: false,
};

/** Every rule toggle. A preset must state each one, so a new toggle cannot leak in by omission. */
export const RULE_TOGGLES = [
  'fogOfWar', 'enableEvents', 'enableDiplomacy', 'enableTechTree',
  'enableAltVictory', 'enableStrongholds', 'enableSpies', 'enemyStartBuildings',
] as const;

export type PresetConfig = Pick<GameConfig,
  | 'diff' | 'playerBonus' | 'neutralStr' | 'enemyFactions' | 'enemyTerritories' | 'enemyTroopScale'
  | 'apPerTurn' | (typeof RULE_TOGGLES)[number]>;

export const PRESETS: Record<Difficulty, PresetConfig> = {
  easy: {
    diff: 'easy', playerBonus: 0.25, neutralStr: 2, enemyFactions: 1, enemyTerritories: 1, enemyTroopScale: 0.75,
    apPerTurn: 6, fogOfWar: false, enableEvents: true, enableDiplomacy: false, enableTechTree: true,
    enableAltVictory: false, enableStrongholds: false, enableSpies: false, enemyStartBuildings: false,
  },
  normal: {
    diff: 'normal', playerBonus: 0, neutralStr: 3, enemyFactions: 1, enemyTerritories: 1, enemyTroopScale: 1,
    apPerTurn: 5, fogOfWar: false, enableEvents: true, enableDiplomacy: false, enableTechTree: true,
    enableAltVictory: false, enableStrongholds: false, enableSpies: false, enemyStartBuildings: false,
  },
  hard: {
    diff: 'hard', playerBonus: 0, neutralStr: 4, enemyFactions: 2, enemyTerritories: 2, enemyTroopScale: 1,
    apPerTurn: 5, fogOfWar: true, enableEvents: true, enableDiplomacy: true, enableTechTree: true,
    enableAltVictory: true, enableStrongholds: true, enableSpies: true, enemyStartBuildings: true,
  },
  brutal: {
    diff: 'brutal', playerBonus: 0, neutralStr: 5, enemyFactions: 3, enemyTerritories: 2, enemyTroopScale: 1.25,
    apPerTurn: 5, fogOfWar: true, enableEvents: true, enableDiplomacy: true, enableTechTree: true,
    enableAltVictory: true, enableStrongholds: true, enableSpies: true, enemyStartBuildings: true,
  },
};

export const PRESET_BLURB: Record<Difficulty, string> = {
  easy: 'One rival on a single territory, earning 30% less than you. Your attacks hit 25% harder and you get 6 actions a turn.',
  normal: 'One rival, an even economy and 5 actions a turn. The intended game.',
  hard: 'Two rivals on two territories each, earning 20% more than you. Fog of war, diplomacy, spies, strongholds and alternative victories.',
  brutal: 'Three rivals with heavier garrisons, earning 40% more than you and attacking at even odds. Everything is on.',
};

// ---------------------------------------------------------------------------
// Campaign
// ---------------------------------------------------------------------------

export interface CampaignScenario {
  index: number;
  title: string;
  mapId: string;
  diff: Difficulty;
  desc: string;
  bonusGold: number;
  bonusTechs: string[];
}

export const CAMPAIGN_SCENARIOS: CampaignScenario[] = [
  { index: 0, title: 'Act I: The Narrows',           mapId: 'narrows',    diff: 'normal', desc: 'Hold the pass. One rival waits beyond the two-territory chokepoint.', bonusGold: 0, bonusTechs: [] },
  { index: 1, title: 'Act II: Battle of Crossroads', mapId: 'crossroads', diff: 'hard',   desc: 'Two rivals race you for the four-territory centre. You start with Iron Will.', bonusGold: 35, bonusTechs: ['iron_will'] },
  { index: 2, title: 'Act III: The Heartlands War',  mapId: 'heartlands', diff: 'brutal', desc: 'Three rivals, the whole realm. You carry Iron Will and Trade Routes into it.', bonusGold: 70, bonusTechs: ['iron_will', 'trade_routes'] },
];
