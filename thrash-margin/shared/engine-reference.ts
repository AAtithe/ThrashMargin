// shared/engine-reference.ts
// Complete game engine ported from the v6 prototype.
// This is the reference implementation. Claude Code should split this
// into server/src/engine/{state,combat,ai,actions,index}.ts

import {
  GameState, GameAction, GameConfig, Territory, Resources,
  Owner, BuildingType, LogEntry, GameStatus, TurnEvent,
  PLAYER, ENEMY, NEUTRAL,
} from './types';

const AP_COST = { ATTACK: 2, RECRUIT: 1, BUILD: 1, UPGRADE: 1, MOVE: 1 } as const;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BUILDINGS: Record<string, {
  name: string; icon: string; col: string;
  cost: { gold: number; mat: number };
  prod?: { food?: number; mat?: number; gold?: number };
  troopCap?: number; defBonus?: number; desc: string;
}> = {
  farm:     { name: 'Farm',     icon: 'F', col: '#2d6e2d', cost: { gold: 6,  mat: 8  }, prod: { food: 4 }, desc: '+4 food/turn' },
  mine:     { name: 'Mine',     icon: 'M', col: '#7a6010', cost: { gold: 8,  mat: 6  }, prod: { mat: 3  }, desc: '+3 mat/turn'  },
  barracks: { name: 'Barracks', icon: 'B', col: '#1a4a8a', cost: { gold: 10, mat: 10 }, troopCap: 5,       desc: '+5 troop cap' },
  market:   { name: 'Market',   icon: '$', col: '#c07010', cost: { gold: 12, mat: 8  }, prod: { gold: 2 }, desc: '+2 gold/turn' },
  tower:    { name: 'Tower',    icon: 'T', col: '#6a1a6a', cost: { gold: 10, mat: 12 }, defBonus: 4,       desc: '+4 def str'   },
};

export const LV = {
  slots:      [0, 1, 2, 3, 4],
  goldBase:   [2, 3, 4, 6, 8],
  troopBase:  [5, 8, 12, 16, 20],
  upCostMat:  [0, 12, 22, 36, 55],
  upCostGold: [0,  5,  9, 15, 22],
};
export const MAX_LV = 4;
export const RECRUIT_GOLD_DEFAULT = 4;
export const UPKEEP_DEFAULT = 1;

// ---------------------------------------------------------------------------
// Territory derived stats (pure functions, no mutation)
// ---------------------------------------------------------------------------

export function getSlots(t: Territory): number { return LV.slots[t.lv]; }

export function getGoldProd(t: Territory): number {
  let g = LV.goldBase[t.lv - 1] + (t.capital ? 2 : 0);
  t.buildings.forEach(b => { g += BUILDINGS[b]?.prod?.gold ?? 0; });
  return g;
}

export function getFoodProd(t: Territory): number {
  let f = t.capital ? 2 : 0;
  t.buildings.forEach(b => { f += BUILDINGS[b]?.prod?.food ?? 0; });
  return f;
}

export function getMatProd(t: Territory): number {
  let m = t.capital ? 2 : 0;
  t.buildings.forEach(b => { m += BUILDINGS[b]?.prod?.mat ?? 0; });
  return m;
}

export function getTroopCap(t: Territory): number {
  let c = LV.troopBase[t.lv - 1] + (t.capital ? 8 : 0);
  t.buildings.forEach(b => { c += BUILDINGS[b]?.troopCap ?? 0; });
  return c;
}

export function getDefStr(t: Territory): number {
  let d = t.troops + (t.capital ? 3 : 0) + (t.lv > 1 ? t.lv : 0);
  t.buildings.forEach(b => { d += BUILDINGS[b]?.defBonus ?? 0; });
  return d;
}

export function getNeighbours(edges: [number, number][], id: number): number[] {
  return edges.flatMap(([a, b]) => a === id ? [b] : b === id ? [a] : []);
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

export interface CombatResult {
  won: boolean;
  attackerLoss: number;
  defenderLoss: number;
  surviving: number;
  ratio: number;
}

export function resolveCombat(
  sending: number,
  defender: Territory,
  playerBonus = 0,
): CombatResult {
  const effective = sending * (1 + playerBonus);
  const ds = getDefStr(defender);
  const ratio = effective / Math.max(ds, 1);
  let won: boolean, aL: number, dL: number;

  if      (ratio >= 2.5) { won = true;  aL = Math.max(0, Math.round(sending * .15)); dL = defender.troops; }
  else if (ratio >= 1.8) { won = true;  aL = Math.round(sending * .35);              dL = defender.troops; }
  else if (ratio >= 1.3) { won = true;  aL = Math.round(sending * .55);              dL = defender.troops; }
  else if (ratio >= 1.0) { won = true;  aL = Math.round(sending * .80);              dL = defender.troops; }
  else if (ratio >= .75) { won = false; aL = sending;                                dL = Math.round(defender.troops * .55); }
  else if (ratio >= .50) { won = false; aL = sending;                                dL = Math.round(defender.troops * .25); }
  else                   { won = false; aL = sending;                                dL = 0; }

  aL = Math.min(aL, sending);
  dL = Math.min(dL, defender.troops);
  return { won, attackerLoss: aL, defenderLoss: dL, surviving: sending - aL, ratio };
}

// ---------------------------------------------------------------------------
// Production totals
// ---------------------------------------------------------------------------

export function prodTotals(nodes: Territory[], owner: Owner) {
  let g = 0, f = 0, m = 0;
  nodes.forEach(n => {
    if (n.owner === owner) { g += getGoldProd(n); f += getFoodProd(n); m += getMatProd(n); }
  });
  return { gold: g, food: f, mat: m };
}

export function totalTroops(nodes: Territory[], owner: Owner): number {
  return nodes.filter(n => n.owner === owner).reduce((s, n) => s + n.troops, 0);
}

// ---------------------------------------------------------------------------
// Difficulty multiplier
// ---------------------------------------------------------------------------

export function diffMult(diff: string): number {
  return ({ easy: 0.6, normal: 1.0, hard: 1.3, brutal: 1.7 }[diff] ?? 1.0);
}

// ---------------------------------------------------------------------------
// Map definitions
// ---------------------------------------------------------------------------

export interface MapDef {
  id: string;
  name: string;
  style: string;
  desc: string;
  territories: number;
}

export const MAP_DEFS: MapDef[] = [
  { id: 'heartlands', name: 'Heartlands',   style: 'Balanced',        territories: 20, desc: 'Classic grid. Player NW, enemy SE. Two enemy capitals at opposite corners.' },
  { id: 'narrows',    name: 'The Narrows',   style: 'Chokepoint',      territories: 14, desc: 'Two wide flanks joined by a 2-territory bottleneck. Control the pass to win.' },
  { id: 'crossroads', name: 'Crossroads',    style: 'Central Control', territories: 16, desc: 'Four arms meet at a contested 4-territory centre cluster. Race for the middle.' },
  { id: 'frontier',   name: 'Frontier',      style: 'Open Field',      territories: 18, desc: 'Scattered settlements, staggered routes. Enemy holds two far corners at the top.' },
];

// ---------------------------------------------------------------------------
// Map builder helpers
// ---------------------------------------------------------------------------

type EnemySlot = { id: number; troops: number; capital: boolean; lv: number; buildings: BuildingType[] };

function applySlot(slot: EnemySlot, cfg: GameConfig, activeIds: Set<number>): Partial<Territory> {
  if (!activeIds.has(slot.id)) {
    return { owner: NEUTRAL, troops: cfg.neutralStr, capital: false, lv: 1, buildings: [] };
  }
  return {
    owner: ENEMY,
    troops: Math.max(3, Math.round(slot.troops * cfg.enemyTroopScale)),
    capital: slot.capital,
    lv: slot.lv,
    buildings: cfg.enemyStartBuildings ? slot.buildings : [],
  };
}

// ---------------------------------------------------------------------------
// buildHeartlands  — 20 territories, NW player, SE enemy
// ---------------------------------------------------------------------------

function buildHeartlands(cfg: GameConfig): { nodes: Territory[]; edges: [number, number][] } {
  const SLOTS: EnemySlot[] = [
    { id:  4, troops: 7, capital: true,  lv: 2, buildings: ['farm', 'tower'] },
    { id: 19, troops: 6, capital: true,  lv: 2, buildings: ['mine', 'barracks'] },
    { id:  9, troops: 5, capital: false, lv: 1, buildings: ['farm'] },
    { id: 14, troops: 5, capital: false, lv: 1, buildings: [] },
  ];
  const active = new Set(SLOTS.slice(0, cfg.enemyTerritories).map(s => s.id));
  const ns = cfg.neutralStr;

  const nodes: Territory[] = [
    { id:  0, x:  68, y:  55, name: 'Ironhold',   owner: PLAYER,  troops: 8,      capital: true,  lv: 2, buildings: [] },
    { id:  1, x: 195, y:  42, name: 'Ashford',    owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  2, x: 320, y:  35, name: 'Dunepass',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  3, x: 445, y:  42, name: 'Stormgate',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  4, x: 548, y:  58, name: 'Redfort',    ...applySlot(SLOTS[0], cfg, active) } as Territory,
    { id:  5, x:  62, y: 158, name: 'Millhaven',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  6, x: 178, y: 148, name: 'Greywall',   owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [] },
    { id:  7, x: 300, y: 140, name: 'Thornfield', owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  8, x: 422, y: 148, name: 'Ironpass',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  9, x: 535, y: 165, name: 'Crimsonton', ...applySlot(SLOTS[2], cfg, active) } as Territory,
    { id: 10, x:  80, y: 268, name: 'Lowbridge',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 11, x: 200, y: 258, name: 'Saltmere',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 12, x: 318, y: 252, name: 'Midkeep',    owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [] },
    { id: 13, x: 436, y: 258, name: 'Ashveil',    owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 14, x: 540, y: 272, name: 'Emberveil',  ...applySlot(SLOTS[3], cfg, active) } as Territory,
    { id: 15, x:  65, y: 375, name: 'Southfen',   owner: NEUTRAL, troops: Math.max(1, ns - 1), capital: false, lv: 1, buildings: [] },
    { id: 16, x: 190, y: 368, name: 'Marshgate',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 17, x: 312, y: 362, name: 'Stonekeep',  owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [] },
    { id: 18, x: 432, y: 368, name: 'Cindervale', owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 19, x: 542, y: 385, name: 'Ashpeak',    ...applySlot(SLOTS[1], cfg, active) } as Territory,
  ];

  const edges: [number, number][] = [
    [0,1],[1,2],[2,3],[3,4],[4,9],[0,5],[1,5],[1,6],[2,6],[2,7],[3,7],[3,8],[8,9],[9,14],
    [5,6],[6,7],[7,8],[8,13],[13,14],
    [5,10],[6,10],[6,11],[7,11],[7,12],[8,12],[13,18],[14,18],[14,19],
    [10,11],[10,15],[11,12],[11,15],[11,16],[12,13],[12,16],[12,17],[13,17],[13,18],
    [15,16],[16,17],[17,18],[18,19],
  ];

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// buildNarrows  — 14 territories, wide flanks + 2-node chokepoint
// ---------------------------------------------------------------------------

function buildNarrows(cfg: GameConfig): { nodes: Territory[]; edges: [number, number][] } {
  // Node IDs must equal array indices for engine lookups to work.
  // Layout: left flank 0-5, narrows 6-7, right flank 8-13.
  // Enemy priority: 11=NE cap, 12=SE cap, 8=far-north non-cap, 13=far-south non-cap
  const SLOTS: EnemySlot[] = [
    { id: 11, troops: 7, capital: true,  lv: 2, buildings: ['farm', 'tower'] },
    { id: 12, troops: 6, capital: true,  lv: 2, buildings: ['mine', 'barracks'] },
    { id:  8, troops: 5, capital: false, lv: 1, buildings: ['farm'] },
    { id: 13, troops: 5, capital: false, lv: 1, buildings: [] },
  ];
  const active = new Set(SLOTS.slice(0, cfg.enemyTerritories).map(s => s.id));
  const ns = cfg.neutralStr;

  const nodes: Territory[] = [
    // Left flank (player side) — ids 0-5
    { id:  0, x:  90, y:  80, name: 'Ironhold',  owner: PLAYER,  troops: 8,      capital: true,  lv: 2, buildings: [] },
    { id:  1, x:  90, y: 200, name: 'Millhaven', owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  2, x:  90, y: 340, name: 'Southfen',  owner: NEUTRAL, troops: Math.max(1, ns - 1), capital: false, lv: 1, buildings: [] },
    { id:  3, x: 200, y: 140, name: 'Ashford',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  4, x: 200, y: 270, name: 'Saltmere',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  5, x: 200, y: 375, name: 'Marshgate', owner: NEUTRAL, troops: Math.max(1, ns - 1), capital: false, lv: 1, buildings: [] },
    // THE NARROWS — ids 6-7, only 2 territories connecting the two flanks
    { id:  6, x: 300, y: 175, name: 'Thornpass', owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [] },
    { id:  7, x: 300, y: 295, name: 'Stoneford', owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [] },
    // Right flank (enemy side) — ids 8-13
    { id:  8, x: 415, y:  80, name: 'Dunegate',  ...applySlot(SLOTS[2], cfg, active) } as Territory,
    { id:  9, x: 415, y: 200, name: 'Ironpass',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 10, x: 415, y: 340, name: 'Ashveil',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 11, x: 535, y:  80, name: 'Redfort',   ...applySlot(SLOTS[0], cfg, active) } as Territory,
    { id: 12, x: 535, y: 210, name: 'Ashpeak',   ...applySlot(SLOTS[1], cfg, active) } as Territory,
    { id: 13, x: 535, y: 350, name: 'Crimsonton',...applySlot(SLOTS[3], cfg, active) } as Territory,
  ];

  const edges: [number, number][] = [
    // Left flank internal
    [0,1],[1,2],[0,3],[1,3],[1,4],[2,4],[3,4],[4,5],[2,5],
    // Left to narrows
    [3,6],[4,6],[4,7],[5,7],
    // Narrows internal
    [6,7],
    // Narrows to right
    [6,8],[6,9],[7,9],[7,10],
    // Right flank internal
    [8,9],[9,10],[8,11],[9,11],[9,12],[10,12],[10,13],[11,12],[12,13],
  ];

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// buildCrossroads  — 16 territories, star shape with 4-node contested centre
// ---------------------------------------------------------------------------

function buildCrossroads(cfg: GameConfig): { nodes: Territory[]; edges: [number, number][] } {
  // SW arm = player; NE arm = primary enemy; SE arm = secondary enemy (slot 1)
  const SLOTS: EnemySlot[] = [
    { id: 13, troops: 7, capital: true,  lv: 2, buildings: ['farm', 'tower'] },    // NE corner
    { id: 10, troops: 6, capital: true,  lv: 2, buildings: ['mine', 'barracks'] }, // SE corner
    { id: 14, troops: 5, capital: false, lv: 1, buildings: ['farm'] },              // NE arm node
    { id: 15, troops: 4, capital: false, lv: 1, buildings: [] },                    // NE entry node
  ];
  const active = new Set(SLOTS.slice(0, cfg.enemyTerritories).map(s => s.id));
  const ns = cfg.neutralStr;

  const nodes: Territory[] = [
    // SW arm — player
    { id:  0, x:  90, y: 360, name: 'Ironhold',   owner: PLAYER,  troops: 8,      capital: true,  lv: 2, buildings: [] },
    { id:  1, x: 175, y: 315, name: 'Southfen',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  2, x: 225, y: 260, name: 'Saltmere',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    // NW arm — neutral
    { id:  3, x:  90, y:  80, name: 'Ashford',    owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  4, x: 175, y: 120, name: 'Millhaven',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  5, x: 230, y: 185, name: 'Greywall',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    // Centre — contested
    { id:  6, x: 305, y: 190, name: 'Crossgate',  owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [] },
    { id:  7, x: 375, y: 190, name: 'Midkeep',    owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [] },
    { id:  8, x: 305, y: 275, name: 'Thornfield', owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [] },
    { id:  9, x: 375, y: 275, name: 'Stonevale',  owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [] },
    // SE arm — secondary enemy
    { id: 10, x: 540, y: 360, name: 'Emberveil',  ...applySlot(SLOTS[1], cfg, active) } as Territory,
    { id: 11, x: 455, y: 315, name: 'Cindervale', owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 12, x: 400, y: 265, name: 'Ashveil',    owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    // NE arm — primary enemy
    { id: 13, x: 540, y:  80, name: 'Redfort',    ...applySlot(SLOTS[0], cfg, active) } as Territory,
    { id: 14, x: 455, y: 120, name: 'Crimsonton', ...applySlot(SLOTS[2], cfg, active) } as Territory,
    { id: 15, x: 400, y: 185, name: 'Ironpass',   ...applySlot(SLOTS[3], cfg, active) } as Territory,
  ];

  const edges: [number, number][] = [
    // Arms internal
    [0,1],[1,2],           // SW player arm
    [3,4],[4,5],           // NW neutral arm
    [10,11],[11,12],       // SE neutral/enemy arm
    [13,14],[14,15],       // NE enemy arm
    // Arms → centre
    [2,6],[2,8],           // SW → centre
    [5,6],[5,7],           // NW → centre
    [12,8],[12,9],         // SE → centre
    [15,7],[15,9],         // NE → centre
    // Centre mesh (full + diagonals make it richly connected)
    [6,7],[6,8],[7,9],[8,9],[6,9],[7,8],
  ];

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// buildFrontier  — 18 territories, staggered grid, enemy at top corners
// ---------------------------------------------------------------------------

function buildFrontier(cfg: GameConfig): { nodes: Territory[]; edges: [number, number][] } {
  // Player bottom-left; enemy at NW and NE corners + optional inner north nodes
  const SLOTS: EnemySlot[] = [
    { id:  0, troops: 7, capital: true,  lv: 2, buildings: ['farm', 'tower'] },    // NW corner
    { id:  3, troops: 6, capital: true,  lv: 2, buildings: ['mine', 'barracks'] }, // NE corner
    { id:  1, troops: 5, capital: false, lv: 1, buildings: ['farm'] },              // North-centre
    { id:  6, troops: 4, capital: false, lv: 1, buildings: [] },                    // NE inner
  ];
  const active = new Set(SLOTS.slice(0, cfg.enemyTerritories).map(s => s.id));
  const ns = cfg.neutralStr;

  const nodes: Territory[] = [
    // Row 1 (y=55) — top
    { id:  0, x:  90, y:  55, name: 'Redfort',    ...applySlot(SLOTS[0], cfg, active) } as Territory,
    { id:  1, x: 230, y:  55, name: 'Ashford',    ...applySlot(SLOTS[2], cfg, active) } as Territory,
    { id:  2, x: 365, y:  55, name: 'Dunepass',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  3, x: 480, y:  55, name: 'Ashpeak',    ...applySlot(SLOTS[1], cfg, active) } as Territory,
    // Row 2 (y=150) — staggered
    { id:  4, x: 160, y: 150, name: 'Millhaven',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  5, x: 300, y: 150, name: 'Thornfield', owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [] },
    { id:  6, x: 430, y: 150, name: 'Ironpass',   ...applySlot(SLOTS[3], cfg, active) } as Territory,
    // Row 3 (y=245)
    { id:  7, x:  90, y: 245, name: 'Greywall',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  8, x: 230, y: 245, name: 'Midkeep',    owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [] },
    { id:  9, x: 365, y: 245, name: 'Saltmere',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 10, x: 480, y: 245, name: 'Crimsonton', owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    // Row 4 (y=335) — staggered
    { id: 11, x: 160, y: 335, name: 'Lowbridge',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 12, x: 300, y: 335, name: 'Stonekeep',  owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [] },
    { id: 13, x: 430, y: 335, name: 'Cindervale', owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    // Row 5 (y=390) — bottom
    { id: 14, x:  90, y: 390, name: 'Ironhold',   owner: PLAYER,  troops: 8,      capital: true,  lv: 2, buildings: [] },
    { id: 15, x: 230, y: 390, name: 'Southfen',   owner: NEUTRAL, troops: Math.max(1, ns - 1), capital: false, lv: 1, buildings: [] },
    { id: 16, x: 365, y: 390, name: 'Marshgate',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 17, x: 480, y: 390, name: 'Emberveil',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
  ];

  const edges: [number, number][] = [
    // Row 1
    [0,1],[1,2],[2,3],
    // Row 1 → Row 2 (stagger)
    [0,4],[1,4],[1,5],[2,5],[2,6],[3,6],
    // Row 2
    [4,5],[5,6],
    // Row 2 → Row 3
    [4,7],[4,8],[5,8],[5,9],[6,9],[6,10],
    // Row 3
    [7,8],[8,9],[9,10],
    // Row 3 → Row 4 (stagger)
    [7,11],[8,11],[8,12],[9,12],[9,13],[10,13],
    // Row 4
    [11,12],[12,13],
    // Row 4 → Row 5
    [11,14],[11,15],[12,15],[12,16],[13,16],[13,17],
    // Row 5
    [14,15],[15,16],[16,17],
  ];

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Initial state factory
// ---------------------------------------------------------------------------

export function createInitialState(id: string, config: GameConfig): GameState {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const map = (() => {
    switch (cfg.mapId) {
      case 'narrows':    return buildNarrows(cfg);
      case 'crossroads': return buildCrossroads(cfg);
      case 'frontier':   return buildFrontier(cfg);
      default:           return buildHeartlands(cfg);
    }
  })();

  return {
    id,
    turn: 1,
    status: 'active',
    nodes: map.nodes,
    edges: map.edges,
    resources: { gold: cfg.startGold, food: cfg.startFood, mat: cfg.startMat },
    config: cfg,
    log: [{ turn: 1, message: 'Campaign begins.', timestamp: Date.now() }],
    sel: null,
    tgt: null,
    actionsLeft: cfg.apPerTurn,
    lastEvent: null,
  };
}

export const DEFAULT_CONFIG: GameConfig = {
  aggro: 0.85,
  expand: 6,
  growth: 2,
  buildChance: 0.15,
  diff: 'normal',
  startGold: 25,
  startFood: 20,
  startMat: 12,
  recruitCost: 4,
  upkeep: 1,
  playerBonus: 0,
  neutralStr: 3,
  enemyTerritories: 4,
  enemyTroopScale: 1.0,
  enemyStartBuildings: true,
  apPerTurn: 4,
  fogOfWar: false,
  enableEvents: true,
  mapId: 'heartlands',
};

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

function addLog(state: GameState, message: string): GameState {
  return {
    ...state,
    log: [{ turn: state.turn, message, timestamp: Date.now() }, ...state.log].slice(0, 200),
  };
}

function checkWin(state: GameState): GameState {
  const hasEnemy = state.nodes.some(n => n.owner === ENEMY);
  const hasPlayer = state.nodes.some(n => n.owner === PLAYER);
  if (!hasEnemy) return { ...state, status: 'victory' };
  if (!hasPlayer) return { ...state, status: 'defeated' };
  return state;
}

function apLeft(state: GameState): number {
  return state.actionsLeft ?? state.config.apPerTurn ?? 4;
}

function handleAttack(state: GameState, action: { fromId: number; toId: number; troops: number }): GameState {
  if (apLeft(state) < AP_COST.ATTACK) return addLog(state, `Not enough action points to attack (costs ${AP_COST.ATTACK} AP).`);

  const nodes = state.nodes.map(n => ({ ...n, buildings: [...n.buildings] }));
  const att = nodes[action.fromId];
  const def = nodes[action.toId];

  if (!att || !def) return state;
  if (att.owner !== PLAYER) return state;
  if (def.owner === PLAYER) return state;
  if (!getNeighbours(state.edges, action.fromId).includes(action.toId)) return state;
  if (action.troops < 1 || action.troops >= att.troops) return state;

  const result = resolveCombat(action.troops, def, state.config.playerBonus);
  att.troops -= action.troops;

  let message: string;
  if (result.won) {
    def.owner = PLAYER;
    def.troops = Math.max(1, result.surviving);
    message = `Captured ${def.name}. Sent ${action.troops}, lost ${result.attackerLoss}. ${result.surviving} now garrison.`;
  } else {
    def.troops = Math.max(0, def.troops - result.defenderLoss);
    message = `Repelled at ${def.name}. Lost ${action.troops}. Defender lost ${result.defenderLoss}.`;
  }

  let next = { ...state, nodes, actionsLeft: apLeft(state) - AP_COST.ATTACK };
  next = addLog(next, message);
  return checkWin(next);
}

function handleRecruit(state: GameState, action: { nodeId: number; amount: number }): GameState {
  if (apLeft(state) < AP_COST.RECRUIT) return addLog(state, `Not enough action points to recruit (costs ${AP_COST.RECRUIT} AP).`);

  const nodes = state.nodes.map(n => ({ ...n, buildings: [...n.buildings] }));
  const node = nodes[action.nodeId];
  if (!node || node.owner !== PLAYER) return state;

  const space = getTroopCap(node) - node.troops;
  const actual = Math.min(action.amount, space);
  if (actual < 1) return addLog(state, `${node.name} is at troop capacity.`);

  const cost = actual * state.config.recruitCost;
  if (state.resources.gold < cost) return addLog(state, 'Not enough gold.');

  node.troops += actual;
  const troops = totalTroops(nodes, PLAYER);
  const resources = { ...state.resources, gold: state.resources.gold - cost };
  return addLog({ ...state, nodes, resources, actionsLeft: apLeft(state) - AP_COST.RECRUIT },
    `Recruited ${actual} at ${node.name} for ${cost}g. Upkeep now ${troops}f/turn.`);
}

function handleBuild(state: GameState, action: { nodeId: number; building: BuildingType }): GameState {
  if (apLeft(state) < AP_COST.BUILD) return addLog(state, `Not enough action points to build (costs ${AP_COST.BUILD} AP).`);

  const nodes = state.nodes.map(n => ({ ...n, buildings: [...n.buildings] }));
  const node = nodes[action.nodeId];
  if (!node || node.owner !== PLAYER) return state;
  if (node.buildings.length >= getSlots(node)) return addLog(state, 'No building slots. Upgrade first.');

  const b = BUILDINGS[action.building];
  if (!b) return state;
  if (state.resources.gold < b.cost.gold || state.resources.mat < b.cost.mat) {
    return addLog(state, `Need ${b.cost.gold}g + ${b.cost.mat}m to build ${b.name}.`);
  }

  node.buildings.push(action.building);
  const resources = {
    ...state.resources,
    gold: state.resources.gold - b.cost.gold,
    mat: state.resources.mat - b.cost.mat,
  };
  return addLog({ ...state, nodes, resources, actionsLeft: apLeft(state) - AP_COST.BUILD },
    `Built ${b.name} at ${node.name}. ${b.desc}.`);
}

function handleUpgrade(state: GameState, action: { nodeId: number }): GameState {
  if (apLeft(state) < AP_COST.UPGRADE) return addLog(state, `Not enough action points to upgrade (costs ${AP_COST.UPGRADE} AP).`);

  const nodes = state.nodes.map(n => ({ ...n, buildings: [...n.buildings] }));
  const node = nodes[action.nodeId];
  if (!node || node.owner !== PLAYER) return state;
  if (node.lv >= MAX_LV) return addLog(state, 'Already at max level.');

  const mc = LV.upCostMat[node.lv];
  const gc = LV.upCostGold[node.lv];
  if (state.resources.mat < mc || state.resources.gold < gc) {
    return addLog(state, `Need ${mc}m + ${gc}g to upgrade.`);
  }

  node.lv++;
  const resources = { ...state.resources, mat: state.resources.mat - mc, gold: state.resources.gold - gc };
  return addLog({ ...state, nodes, resources, actionsLeft: apLeft(state) - AP_COST.UPGRADE },
    `${node.name} upgraded to Lv${node.lv}. ${getSlots(node)} slots, cap ${getTroopCap(node)}, ${getGoldProd(node)}g/turn.`);
}

function handleEndTurn(state: GameState): GameState {
  const cfg = state.config;
  const p = prodTotals(state.nodes, PLAYER);
  const troops = totalTroops(state.nodes, PLAYER);
  const upkeep = troops * cfg.upkeep;
  const foodNet = p.food - upkeep;

  let nodes = state.nodes.map(n => ({ ...n, buildings: [...n.buildings] }));
  let resources = {
    gold: state.resources.gold + p.gold,
    food: state.resources.food + foodNet,
    mat: state.resources.mat + p.mat,
  };

  // Starvation
  let starved = 0;
  if (resources.food < 0) {
    let deficit = Math.abs(resources.food);
    resources.food = 0;
    while (deficit-- > 0) {
      const fed = nodes.filter(n => n.owner === PLAYER && n.troops > 0);
      if (!fed.length) break;
      fed[Math.floor(Math.random() * fed.length)].troops--;
      starved++;
    }
  }

  let next = { ...state, nodes, resources };
  next = addLog(next, `T${state.turn}: +${p.gold}g +${p.food}f +${p.mat}m. Upkeep ${upkeep}f. Net food ${foodNet >= 0 ? '+' : ''}${foodNet}.${starved > 0 ? ` ${starved} troops starved.` : ''}`);

  // Enemy turn
  next = runEnemyTurn(next);

  // Start next player turn
  next = { ...next, turn: state.turn + 1, sel: null, tgt: null, actionsLeft: cfg.apPerTurn ?? 4, lastEvent: null };
  next = checkWin(next);

  // Turn events
  if (next.status === 'active' && cfg.enableEvents) {
    next = drawTurnEvent(next);
  }

  return next;
}

// ---------------------------------------------------------------------------
// Turn events
// ---------------------------------------------------------------------------

interface EventDef {
  id: string;
  title: string;
  type: 'positive' | 'negative' | 'neutral';
  run: (s: GameState) => { state: GameState; message: string };
}

const EVENT_POOL: EventDef[] = [
  {
    id: 'trade_windfall', title: 'Trade Windfall', type: 'positive',
    run: s => ({ state: { ...s, resources: { ...s.resources, gold: s.resources.gold + 12 } }, message: 'Merchants flood the markets — +12 gold.' }),
  },
  {
    id: 'harvest', title: 'Harvest Season', type: 'positive',
    run: s => ({ state: { ...s, resources: { ...s.resources, food: s.resources.food + 10 } }, message: 'Bumper crop this year — +10 food.' }),
  },
  {
    id: 'ore_strike', title: 'Rich Ore Strike', type: 'positive',
    run: s => ({ state: { ...s, resources: { ...s.resources, mat: s.resources.mat + 8 } }, message: 'Workers uncover a rich vein — +8 mat.' }),
  },
  {
    id: 'enemy_unrest', title: 'Enemy Unrest', type: 'positive',
    run: s => {
      const targets = s.nodes.filter(n => n.owner === ENEMY && n.troops > 2);
      if (!targets.length) return { state: s, message: 'Enemy unrest fomented but had no effect.' };
      const nodes = s.nodes.map(n => ({ ...n, buildings: [...n.buildings] }));
      const t = targets[Math.floor(Math.random() * targets.length)];
      nodes[t.id].troops = Math.max(1, nodes[t.id].troops - 3);
      return { state: { ...s, nodes }, message: `Internal strife in ${t.name} — enemy loses 3 troops.` };
    },
  },
  {
    id: 'plague', title: 'Plague', type: 'negative',
    run: s => {
      const targets = s.nodes.filter(n => n.owner === PLAYER && n.troops > 2);
      if (!targets.length) return { state: s, message: 'Plague strikes but spares your garrisons.' };
      const nodes = s.nodes.map(n => ({ ...n, buildings: [...n.buildings] }));
      const t = targets[Math.floor(Math.random() * targets.length)];
      nodes[t.id].troops = Math.max(1, nodes[t.id].troops - 3);
      return { state: { ...s, nodes }, message: `Disease sweeps through ${t.name} — you lose 3 troops.` };
    },
  },
  {
    id: 'crop_blight', title: 'Crop Blight', type: 'negative',
    run: s => ({ state: { ...s, resources: { ...s.resources, food: Math.max(0, s.resources.food - 10) } }, message: 'The harvest fails — -10 food.' }),
  },
  {
    id: 'supply_crisis', title: 'Supply Crisis', type: 'negative',
    run: s => ({ state: { ...s, resources: { ...s.resources, mat: Math.max(0, s.resources.mat - 8) } }, message: 'Supply lines disrupted — -8 mat.' }),
  },
  {
    id: 'border_unrest', title: 'Border Unrest', type: 'negative',
    run: s => {
      const targets = s.nodes.filter(n => n.owner === NEUTRAL);
      if (!targets.length) return { state: s, message: 'Border unrest but no neutral territories remain.' };
      const nodes = s.nodes.map(n => ({ ...n, buildings: [...n.buildings] }));
      const t = targets[Math.floor(Math.random() * targets.length)];
      nodes[t.id].troops += 2;
      return { state: { ...s, nodes }, message: `Unrest in ${t.name} — neutral territory grows stronger (+2 troops).` };
    },
  },
  // Calm appears 3× to weight it at ~25% probability
  { id: 'calm', title: 'Uneventful Turn', type: 'neutral', run: s => ({ state: s, message: 'The realm is quiet this turn.' }) },
  { id: 'calm', title: 'Uneventful Turn', type: 'neutral', run: s => ({ state: s, message: 'The realm is quiet this turn.' }) },
  { id: 'calm', title: 'Uneventful Turn', type: 'neutral', run: s => ({ state: s, message: 'The realm is quiet this turn.' }) },
];

function drawTurnEvent(state: GameState): GameState {
  const def = EVENT_POOL[Math.floor(Math.random() * EVENT_POOL.length)];
  const { state: next, message } = def.run(state);
  const event: TurnEvent = { id: def.id, title: def.title, message, type: def.type };
  return addLog({ ...next, lastEvent: event }, `📜 ${def.title}: ${message}`);
}

// ---------------------------------------------------------------------------
// Enemy AI
// ---------------------------------------------------------------------------

function runEnemyTurn(state: GameState): GameState {
  const dm = diffMult(state.config.diff);
  let nodes = state.nodes.map(n => ({ ...n, buildings: [...n.buildings] }));
  const log: string[] = [];

  // Income and building
  nodes.forEach(n => {
    if (n.owner !== ENEMY) return;
    const income = Math.ceil((getGoldProd(n) * dm) / 2) * state.config.growth;
    n.troops = Math.min(n.troops + income, getTroopCap(n));
    if (Math.random() < state.config.buildChance * dm && n.buildings.length < getSlots(n)) {
      const opts = Object.keys(BUILDINGS).filter(k => !n.buildings.includes(k as BuildingType));
      if (opts.length) n.buildings.push(opts[Math.floor(Math.random() * opts.length)] as BuildingType);
    }
    if (Math.random() < 0.08 * dm && n.lv < MAX_LV) n.lv = Math.min(n.lv + 1, MAX_LV);
  });

  // Attacks
  const eNodes = nodes.filter(n => n.owner === ENEMY).sort(() => Math.random() - 0.5);
  eNodes.forEach(att => {
    if (att.troops <= 3) return;
    const tgts = getNeighbours(state.edges, att.id).filter(id => nodes[id].owner !== ENEMY);
    if (!tgts.length) return;

    const score = (id: number) =>
      (nodes[id].owner === PLAYER ? state.config.expand : state.config.expand - 4)
      + getGoldProd(nodes[id]) - getDefStr(nodes[id]) * 0.8;

    const bestId = tgts.reduce((b, id) => score(id) > score(b) ? id : b, tgts[0]);
    const def = nodes[bestId];
    const sending = Math.max(1, att.troops - 2);
    const ratio = (sending * dm) / Math.max(getDefStr(def), 1);
    if (ratio < state.config.aggro) return;

    const result = resolveCombat(sending, def);
    att.troops -= sending;
    if (result.won) {
      def.owner = ENEMY;
      def.troops = Math.max(1, result.surviving);
      log.push(`Enemy captured ${def.name}!`);
    } else {
      def.troops = Math.max(0, def.troops - result.defenderLoss);
    }
  });

  let next = { ...state, nodes };
  log.forEach(m => { next = addLog(next, m); });
  return next;
}

function handleMove(state: GameState, action: { fromId: number; toId: number; troops: number }): GameState {
  if (apLeft(state) < AP_COST.MOVE) return addLog(state, `Not enough action points to move (costs ${AP_COST.MOVE} AP).`);

  const nodes = state.nodes.map(n => ({ ...n, buildings: [...n.buildings] }));
  const src = nodes[action.fromId];
  const dst = nodes[action.toId];

  if (!src || !dst) return state;
  if (src.owner !== PLAYER || dst.owner !== PLAYER) return state;
  if (!getNeighbours(state.edges, action.fromId).includes(action.toId)) return state;
  if (action.troops < 1 || action.troops >= src.troops) return state;

  const space = getTroopCap(dst) - dst.troops;
  const actual = Math.min(action.troops, space);
  if (actual < 1) return addLog(state, `${dst.name} is at troop capacity.`);

  src.troops -= actual;
  dst.troops += actual;
  return addLog({ ...state, nodes, actionsLeft: apLeft(state) - AP_COST.MOVE },
    `Moved ${actual} troops from ${src.name} to ${dst.name}.`);
}

// ---------------------------------------------------------------------------
// Main process function — this is the single entry point for all actions
// ---------------------------------------------------------------------------

export function processAction(state: GameState, action: GameAction): GameState {
  if (state.status !== 'active') return state;

  switch (action.type) {
    case 'ATTACK':    return handleAttack(state, action);
    case 'RECRUIT':   return handleRecruit(state, action);
    case 'BUILD':     return handleBuild(state, action);
    case 'UPGRADE':   return handleUpgrade(state, action);
    case 'MOVE':      return handleMove(state, action);
    case 'END_TURN':  return handleEndTurn(state);
    default:          return state;
  }
}
