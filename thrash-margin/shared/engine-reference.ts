// shared/engine-reference.ts
// Complete game engine ported from the v6 prototype.
// This is the reference implementation. Claude Code should split this
// into server/src/engine/{state,combat,ai,actions,index}.ts

import {
  GameState, GameAction, GameConfig, Territory, Resources,
  Owner, BuildingType, LogEntry, GameStatus, TurnEvent,
  PLAYER, ENEMY, NEUTRAL, isEnemy, TerrainType,
} from './types';

const AP_COST = { ATTACK: 2, RECRUIT: 1, BUILD: 1, UPGRADE: 1, MOVE: 1, ANNEX: 1, RESEARCH: 1 } as const;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FACTION_COLORS: Record<number, string> = {
  0: '#52525b',
  1: '#2563eb',
  2: '#dc2626',
  3: '#7c3aed',
  4: '#059669',
};

export const FACTION_NAMES: Record<number, string> = {
  1: 'Ironhold',
  2: 'Crimson Horde',
  3: 'Dusk Court',
  4: 'Emerald League',
};

export const FACTION_BORDER: Record<number, string> = {
  0: '#71717a',
  1: '#3b82f6',
  2: '#ef4444',
  3: '#8b5cf6',
  4: '#10b981',
};

export const TERRAIN_COLORS: Record<string, string> = {
  plains:   '#52525b',
  forest:   '#15803d',
  mountain: '#78716c',
  coast:    '#0ea5e9',
  desert:   '#d97706',
};

export const TERRAIN_LABELS: Record<string, string> = {
  plains:   'Plains',
  forest:   'Forest',
  mountain: 'Mountain',
  coast:    'Coast',
  desert:   'Desert',
};

export function getTerrainBonus(terrain?: string): { gold: number; food: number; mat: number; def: number } {
  switch (terrain) {
    case 'forest':   return { gold:  0, food:  1, mat: 0, def: -1 };
    case 'mountain': return { gold: -1, food:  0, mat: 0, def:  3 };
    case 'coast':    return { gold:  2, food:  0, mat: 0, def:  0 };
    case 'desert':   return { gold:  0, food: -1, mat: 1, def:  0 };
    default:         return { gold:  0, food:  0, mat: 0, def:  0 };
  }
}

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
// Tech tree
// ---------------------------------------------------------------------------

export interface TechDef {
  id: string; name: string; branch: 'military' | 'economic' | 'expansion';
  tier: 1|2|3|4; prereq: string|null; cost: { gold: number; mat: number }; desc: string;
}

export const TECH_TREE: TechDef[] = [
  // Military
  { id:'iron_will',       name:'Iron Will',         branch:'military',  tier:1, prereq:null,               cost:{gold:15,mat:8},  desc:'Attack costs 1 AP instead of 2' },
  { id:'siege_craft',     name:'Siege Craft',        branch:'military',  tier:2, prereq:'iron_will',        cost:{gold:25,mat:15}, desc:'+25% effective attack troops' },
  { id:'war_doctrine',    name:'War Doctrine',       branch:'military',  tier:3, prereq:'siege_craft',      cost:{gold:40,mat:25}, desc:'Failed attacks deal extra 3 damage to defenders' },
  { id:'total_war',       name:'Total War',          branch:'military',  tier:4, prereq:'war_doctrine',     cost:{gold:60,mat:40}, desc:'Your troop losses on victories reduced by 40%' },
  // Economic
  { id:'trade_routes',    name:'Trade Routes',       branch:'economic',  tier:1, prereq:null,               cost:{gold:10,mat:12}, desc:'+1 gold per 2 territories per turn' },
  { id:'industrialisation',name:'Industrialisation', branch:'economic',  tier:2, prereq:'trade_routes',     cost:{gold:20,mat:18}, desc:'Each mine produces +1 extra mat per turn' },
  { id:'granaries',       name:'Granaries',          branch:'economic',  tier:3, prereq:'industrialisation',cost:{gold:30,mat:25}, desc:'Starvation damage halved' },
  { id:'market_dominance',name:'Market Dominance',   branch:'economic',  tier:4, prereq:'granaries',        cost:{gold:50,mat:35}, desc:'Markets produce +3 gold instead of +2' },
  // Expansion
  { id:'cartography',     name:'Cartography',        branch:'expansion', tier:1, prereq:null,               cost:{gold:12,mat:10}, desc:'Fog of war permanently lifted regardless of settings' },
  { id:'colonisation',    name:'Colonisation',       branch:'expansion', tier:2, prereq:'cartography',      cost:{gold:20,mat:15}, desc:'Annexing neutrals costs 12 influence instead of 20' },
  { id:'fortifications',  name:'Fortifications',     branch:'expansion', tier:3, prereq:'colonisation',     cost:{gold:35,mat:22}, desc:'Towers give +6 defence instead of +4' },
  { id:'grand_strategy',  name:'Grand Strategy',     branch:'expansion', tier:4, prereq:'fortifications',   cost:{gold:55,mat:38}, desc:'+1 action point per turn permanently' },
];

// ---------------------------------------------------------------------------
// Territory derived stats (pure functions, no mutation)
// ---------------------------------------------------------------------------

export function getSlots(t: Territory): number { return LV.slots[t.lv]; }

export function getGoldProd(t: Territory, research: string[] = []): number {
  let g = LV.goldBase[t.lv - 1] + (t.capital ? 2 : 0) + (t.stronghold ? 3 : 0);
  t.buildings.forEach(b => {
    const base = BUILDINGS[b]?.prod?.gold ?? 0;
    if (b === 'market' && research.includes('market_dominance')) {
      g += 3;
    } else {
      g += base;
    }
  });
  g += getTerrainBonus(t.terrain).gold;
  return Math.max(1, g);
}

export function getFoodProd(t: Territory): number {
  let f = t.capital ? 2 : 0;
  t.buildings.forEach(b => { f += BUILDINGS[b]?.prod?.food ?? 0; });
  f += getTerrainBonus(t.terrain).food;
  return f;
}

export function getMatProd(t: Territory, research: string[] = []): number {
  let m = t.capital ? 2 : 0;
  t.buildings.forEach(b => {
    const base = BUILDINGS[b]?.prod?.mat ?? 0;
    if (b === 'mine' && research.includes('industrialisation')) {
      m += base + 1;
    } else {
      m += base;
    }
  });
  m += getTerrainBonus(t.terrain).mat;
  return m;
}

export function getTroopCap(t: Territory): number {
  let c = LV.troopBase[t.lv - 1] + (t.capital ? 8 : 0);
  t.buildings.forEach(b => { c += BUILDINGS[b]?.troopCap ?? 0; });
  return c;
}

export function getDefStr(t: Territory, research: string[] = []): number {
  const towerBonus = research.includes('fortifications') ? 6 : 4;
  let d = t.troops + (t.capital ? 3 : 0) + (t.lv > 1 ? t.lv : 0);
  t.buildings.forEach(b => {
    if (b === 'tower') {
      d += towerBonus;
    } else {
      d += BUILDINGS[b]?.defBonus ?? 0;
    }
  });
  d += getTerrainBonus(t.terrain).def;
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
  research: string[] = [],
): CombatResult {
  const siegeMultiplier = research.includes('siege_craft') ? 1.25 : 1;
  const effective = sending * (1 + playerBonus) * siegeMultiplier;
  const ds = getDefStr(defender, research);
  const ratio = effective / Math.max(ds, 1);
  let won: boolean, aL: number, dL: number;

  if      (ratio >= 2.5) { won = true;  aL = Math.max(0, Math.round(sending * .15)); dL = defender.troops; }
  else if (ratio >= 1.8) { won = true;  aL = Math.round(sending * .35);              dL = defender.troops; }
  else if (ratio >= 1.3) { won = true;  aL = Math.round(sending * .55);              dL = defender.troops; }
  else if (ratio >= 1.0) { won = true;  aL = Math.round(sending * .80);              dL = defender.troops; }
  else if (ratio >= .75) { won = false; aL = sending;                                dL = Math.round(defender.troops * .55); }
  else if (ratio >= .50) { won = false; aL = sending;                                dL = Math.round(defender.troops * .25); }
  else                   { won = false; aL = sending;                                dL = 0; }

  // war_doctrine: failed attacks deal extra 3 defender losses
  if (!won && research.includes('war_doctrine')) {
    dL = Math.min(defender.troops, dL + 3);
  }

  // total_war: successful attack reduces attacker losses by 40%
  if (won && research.includes('total_war')) {
    aL = Math.max(0, Math.round(aL * 0.6));
  }

  aL = Math.min(aL, sending);
  dL = Math.min(dL, defender.troops);
  return { won, attackerLoss: aL, defenderLoss: dL, surviving: sending - aL, ratio };
}

// ---------------------------------------------------------------------------
// Production totals
// ---------------------------------------------------------------------------

export function prodTotals(nodes: Territory[], owner: Owner, research: string[] = []) {
  let g = 0, f = 0, m = 0;
  const playerNodes = nodes.filter(n => n.owner === owner);
  playerNodes.forEach(n => {
    g += getGoldProd(n, research);
    f += getFoodProd(n);
    m += getMatProd(n, research);
  });
  // trade_routes: +1 gold per 2 territories per turn
  if (research.includes('trade_routes')) {
    g += Math.floor(playerNodes.length / 2);
  }
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
  viewBox: string;
}

export const MAP_DEFS: MapDef[] = [
  { id: 'tutorial',       name: 'Tutorial',        style: 'Guided',          territories: 8,  desc: 'A guided map for new players. Learn the basics: attack, recruit, build, and end turn.',                              viewBox: '30 30 580 340' },
  { id: 'heartlands',     name: 'Heartlands',      style: 'Balanced',        territories: 20, desc: 'Classic grid. Player NW, enemy SE. Two enemy capitals at opposite corners.',                                          viewBox: '30 10 560 400' },
  { id: 'narrows',        name: 'The Narrows',      style: 'Chokepoint',      territories: 14, desc: 'Two wide flanks joined by a 2-territory bottleneck. Control the pass to win.',                                       viewBox: '30 10 560 400' },
  { id: 'crossroads',     name: 'Crossroads',       style: 'Central Control', territories: 16, desc: 'Four arms meet at a contested 4-territory centre cluster. Race for the middle.',                                     viewBox: '30 10 560 400' },
  { id: 'frontier',       name: 'Frontier',         style: 'Open Field',      territories: 18, desc: 'Scattered settlements, staggered routes. Enemy holds two far corners at the top.',                                   viewBox: '30 10 560 400' },
  { id: 'grand_continent',name: 'Grand Continent',  style: 'Multi-Faction',   territories: 34, desc: 'Vast map with three rival factions. Player SW, enemies at NW, NE, and SE corners.',                                  viewBox: '0 0 760 545' },
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
    { id:  0, x:  68, y:  55, name: 'Ironhold',   owner: PLAYER,  troops: 8,      capital: true,  lv: 2, buildings: [], terrain: 'coast' },
    { id:  1, x: 195, y:  42, name: 'Ashford',    owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  2, x: 320, y:  35, name: 'Dunepass',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [], terrain: 'forest' },
    { id:  3, x: 445, y:  42, name: 'Stormgate',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  4, x: 548, y:  58, name: 'Redfort',    ...applySlot(SLOTS[0], cfg, active), terrain: 'mountain' } as Territory,
    { id:  5, x:  62, y: 158, name: 'Millhaven',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [], terrain: 'coast' },
    { id:  6, x: 178, y: 148, name: 'Greywall',   owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [] },
    { id:  7, x: 300, y: 140, name: 'Thornfield', owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [], stronghold: cfg.enableStrongholds, terrain: 'forest' },
    { id:  8, x: 422, y: 148, name: 'Ironpass',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  9, x: 535, y: 165, name: 'Crimsonton', ...applySlot(SLOTS[2], cfg, active), terrain: 'mountain' } as Territory,
    { id: 10, x:  80, y: 268, name: 'Lowbridge',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [], terrain: 'coast' },
    { id: 11, x: 200, y: 258, name: 'Saltmere',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 12, x: 318, y: 252, name: 'Midkeep',    owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [], stronghold: cfg.enableStrongholds, terrain: 'forest' },
    { id: 13, x: 436, y: 258, name: 'Ashveil',    owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 14, x: 540, y: 272, name: 'Emberveil',  ...applySlot(SLOTS[3], cfg, active), terrain: 'mountain' } as Territory,
    { id: 15, x:  65, y: 375, name: 'Southfen',   owner: NEUTRAL, troops: Math.max(1, ns - 1), capital: false, lv: 1, buildings: [], terrain: 'coast' },
    { id: 16, x: 190, y: 368, name: 'Marshgate',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 17, x: 312, y: 362, name: 'Stonekeep',  owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [], terrain: 'forest' },
    { id: 18, x: 432, y: 368, name: 'Cindervale', owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 19, x: 542, y: 385, name: 'Ashpeak',    ...applySlot(SLOTS[1], cfg, active), terrain: 'mountain' } as Territory,
  ];

  // Apply stronghold troop bonus
  if (cfg.enableStrongholds) {
    [7, 12].forEach(id => {
      if (nodes[id].owner === NEUTRAL) {
        nodes[id].troops = cfg.neutralStr * 2;
      }
    });
  }

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
    { id:  0, x:  90, y:  80, name: 'Ironhold',  owner: PLAYER,  troops: 8,      capital: true,  lv: 2, buildings: [], terrain: 'forest' },
    { id:  1, x:  90, y: 200, name: 'Millhaven', owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [], terrain: 'forest' },
    { id:  2, x:  90, y: 340, name: 'Southfen',  owner: NEUTRAL, troops: Math.max(1, ns - 1), capital: false, lv: 1, buildings: [], terrain: 'forest' },
    { id:  3, x: 200, y: 140, name: 'Ashford',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  4, x: 200, y: 270, name: 'Saltmere',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  5, x: 200, y: 375, name: 'Marshgate', owner: NEUTRAL, troops: Math.max(1, ns - 1), capital: false, lv: 1, buildings: [] },
    // THE NARROWS — ids 6-7, only 2 territories connecting the two flanks
    { id:  6, x: 300, y: 175, name: 'Thornpass', owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [], stronghold: cfg.enableStrongholds, terrain: 'mountain' },
    { id:  7, x: 300, y: 295, name: 'Stoneford', owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [], terrain: 'mountain' },
    // Right flank (enemy side) — ids 8-13
    { id:  8, x: 415, y:  80, name: 'Dunegate',  ...applySlot(SLOTS[2], cfg, active) } as Territory,
    { id:  9, x: 415, y: 200, name: 'Ironpass',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 10, x: 415, y: 340, name: 'Ashveil',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 11, x: 535, y:  80, name: 'Redfort',   ...applySlot(SLOTS[0], cfg, active), terrain: 'coast' } as Territory,
    { id: 12, x: 535, y: 210, name: 'Ashpeak',   ...applySlot(SLOTS[1], cfg, active), terrain: 'coast' } as Territory,
    { id: 13, x: 535, y: 350, name: 'Crimsonton',...applySlot(SLOTS[3], cfg, active) } as Territory,
  ];

  if (cfg.enableStrongholds) {
    if (nodes[6].owner === NEUTRAL) nodes[6].troops = cfg.neutralStr * 2;
  }

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
    { id:  3, x:  90, y:  80, name: 'Ashford',    owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [], terrain: 'forest' },
    { id:  4, x: 175, y: 120, name: 'Millhaven',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [], terrain: 'forest' },
    { id:  5, x: 230, y: 185, name: 'Greywall',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [], terrain: 'forest' },
    // Centre — contested
    { id:  6, x: 305, y: 190, name: 'Crossgate',  owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [], stronghold: cfg.enableStrongholds, terrain: 'mountain' },
    { id:  7, x: 375, y: 190, name: 'Midkeep',    owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [], terrain: 'mountain' },
    { id:  8, x: 305, y: 275, name: 'Thornfield', owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [], terrain: 'mountain' },
    { id:  9, x: 375, y: 275, name: 'Stonevale',  owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [], stronghold: cfg.enableStrongholds, terrain: 'mountain' },
    // SE arm — secondary enemy
    { id: 10, x: 540, y: 360, name: 'Emberveil',  ...applySlot(SLOTS[1], cfg, active), terrain: 'coast' } as Territory,
    { id: 11, x: 455, y: 315, name: 'Cindervale', owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [], terrain: 'coast' },
    { id: 12, x: 400, y: 265, name: 'Ashveil',    owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [], terrain: 'coast' },
    // NE arm — primary enemy
    { id: 13, x: 540, y:  80, name: 'Redfort',    ...applySlot(SLOTS[0], cfg, active) } as Territory,
    { id: 14, x: 455, y: 120, name: 'Crimsonton', ...applySlot(SLOTS[2], cfg, active) } as Territory,
    { id: 15, x: 400, y: 185, name: 'Ironpass',   ...applySlot(SLOTS[3], cfg, active) } as Territory,
  ];

  if (cfg.enableStrongholds) {
    if (nodes[6].owner === NEUTRAL) nodes[6].troops = cfg.neutralStr * 2;
    if (nodes[9].owner === NEUTRAL) nodes[9].troops = cfg.neutralStr * 2;
  }

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
    { id:  0, x:  90, y:  55, name: 'Redfort',    ...applySlot(SLOTS[0], cfg, active), terrain: 'desert' } as Territory,
    { id:  1, x: 230, y:  55, name: 'Ashford',    ...applySlot(SLOTS[2], cfg, active) } as Territory,
    { id:  2, x: 365, y:  55, name: 'Dunepass',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  3, x: 480, y:  55, name: 'Ashpeak',    ...applySlot(SLOTS[1], cfg, active), terrain: 'desert' } as Territory,
    // Row 2 (y=150) — staggered
    { id:  4, x: 160, y: 150, name: 'Millhaven',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  5, x: 300, y: 150, name: 'Thornfield', owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [], stronghold: cfg.enableStrongholds, terrain: 'forest' },
    { id:  6, x: 430, y: 150, name: 'Ironpass',   ...applySlot(SLOTS[3], cfg, active), terrain: 'forest' } as Territory,
    // Row 3 (y=245)
    { id:  7, x:  90, y: 245, name: 'Greywall',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id:  8, x: 230, y: 245, name: 'Midkeep',    owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [] },
    { id:  9, x: 365, y: 245, name: 'Saltmere',   owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 10, x: 480, y: 245, name: 'Crimsonton', owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    // Row 4 (y=335) — staggered
    { id: 11, x: 160, y: 335, name: 'Lowbridge',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 12, x: 300, y: 335, name: 'Stonekeep',  owner: NEUTRAL, troops: ns + 1, capital: false, lv: 1, buildings: [], stronghold: cfg.enableStrongholds, terrain: 'forest' },
    { id: 13, x: 430, y: 335, name: 'Cindervale', owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    // Row 5 (y=390) — bottom
    { id: 14, x:  90, y: 390, name: 'Ironhold',   owner: PLAYER,  troops: 8,      capital: true,  lv: 2, buildings: [], terrain: 'coast' },
    { id: 15, x: 230, y: 390, name: 'Southfen',   owner: NEUTRAL, troops: Math.max(1, ns - 1), capital: false, lv: 1, buildings: [], terrain: 'coast' },
    { id: 16, x: 365, y: 390, name: 'Marshgate',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
    { id: 17, x: 480, y: 390, name: 'Emberveil',  owner: NEUTRAL, troops: ns,     capital: false, lv: 1, buildings: [] },
  ];

  if (cfg.enableStrongholds) {
    if (nodes[5].owner === NEUTRAL)  nodes[5].troops  = cfg.neutralStr * 2;
    if (nodes[12].owner === NEUTRAL) nodes[12].troops = cfg.neutralStr * 2;
  }

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
// buildGrandContinent  — 34 territories, 3 enemy factions
// ---------------------------------------------------------------------------

interface GrandSlot { id: number; faction: number; priority: number; troops: number; capital: boolean; lv: number; buildings: BuildingType[] }

const GRAND_SLOTS: GrandSlot[] = [
  // Faction 2 (Red, NW)
  { id: 0,  faction: 2, priority: 0, troops: 8, capital: true,  lv: 2, buildings: ['farm', 'tower'] },
  { id: 1,  faction: 2, priority: 1, troops: 5, capital: false, lv: 1, buildings: ['farm'] },
  { id: 6,  faction: 2, priority: 2, troops: 5, capital: false, lv: 1, buildings: [] },
  { id: 11, faction: 2, priority: 3, troops: 4, capital: false, lv: 1, buildings: [] },
  // Faction 3 (Purple, NE)
  { id: 5,  faction: 3, priority: 0, troops: 8, capital: true,  lv: 2, buildings: ['mine', 'barracks'] },
  { id: 4,  faction: 3, priority: 1, troops: 5, capital: false, lv: 1, buildings: ['mine'] },
  { id: 10, faction: 3, priority: 2, troops: 5, capital: false, lv: 1, buildings: [] },
  { id: 16, faction: 3, priority: 3, troops: 4, capital: false, lv: 1, buildings: [] },
  // Faction 4 (Green, SE)
  { id: 33, faction: 4, priority: 0, troops: 8, capital: true,  lv: 2, buildings: ['tower', 'barracks'] },
  { id: 32, faction: 4, priority: 1, troops: 5, capital: false, lv: 1, buildings: ['farm'] },
  { id: 27, faction: 4, priority: 2, troops: 5, capital: false, lv: 1, buildings: [] },
  { id: 21, faction: 4, priority: 3, troops: 4, capital: false, lv: 1, buildings: [] },
];

function buildGrandContinent(cfg: GameConfig): { nodes: Territory[]; edges: [number, number][] } {
  const ns = cfg.neutralStr;

  // Even rows (6 nodes): x = 60, 185, 310, 435, 560, 685
  // Odd rows (5 nodes): x = 122, 248, 372, 498, 623
  const evenX = [60, 185, 310, 435, 560, 685];
  const oddX  = [122, 248, 372, 498, 623];
  const rowY  = [45, 140, 230, 320, 410, 495];

  const names = [
    // Row 0 (ids 0-5)
    'Redfort', 'Ironwall', 'Stonegate', 'Duskpass', 'Tidewatch', 'Ashpeak',
    // Row 1 (ids 6-10)
    'Greyholm', 'Thornvale', 'Midridge', 'Saltcliff', 'Emberton',
    // Row 2 (ids 11-16)
    'Westmere', 'Coppergate', 'The Crossing', 'Silverholm', 'Dunehaven', 'Eastkeep',
    // Row 3 (ids 17-21)
    'Harrow', 'Goldvale', 'The Summit', 'Ironmarsh', 'Greenwatch',
    // Row 4 (ids 22-27)
    'Lowfen', 'Clayfield', 'Stonecroft', 'Ashveil', 'Thornford', 'Ashenmere',
    // Row 5 (ids 28-33)
    'Ironhold', 'Millhaven', 'Southfen', 'Marshgate', 'Cindervale', 'Emberveil',
  ];

  // Build node coordinates from rows
  const coords: { x: number; y: number }[] = [];
  // Row 0: ids 0-5 (even)
  for (let i = 0; i < 6; i++) coords.push({ x: evenX[i], y: rowY[0] });
  // Row 1: ids 6-10 (odd)
  for (let i = 0; i < 5; i++) coords.push({ x: oddX[i], y: rowY[1] });
  // Row 2: ids 11-16 (even)
  for (let i = 0; i < 6; i++) coords.push({ x: evenX[i], y: rowY[2] });
  // Row 3: ids 17-21 (odd)
  for (let i = 0; i < 5; i++) coords.push({ x: oddX[i], y: rowY[3] });
  // Row 4: ids 22-27 (even)
  for (let i = 0; i < 6; i++) coords.push({ x: evenX[i], y: rowY[4] });
  // Row 5: ids 28-33 (even)
  for (let i = 0; i < 6; i++) coords.push({ x: evenX[i], y: rowY[5] });

  // Build slot lookup: nodeId -> GrandSlot (only if faction is active and priority < enemyTerritories)
  const slotMap = new Map<number, GrandSlot>();
  for (const slot of GRAND_SLOTS) {
    if (slot.faction <= 1 + cfg.enemyFactions && slot.priority < cfg.enemyTerritories) {
      slotMap.set(slot.id, slot);
    }
  }

  const strongholdIds = new Set(cfg.enableStrongholds ? [13, 19] : []);

  const nodes: Territory[] = coords.map((c, id) => {
    const slot = slotMap.get(id);
    const isStronghold = strongholdIds.has(id);
    if (id === 28) {
      // Player start
      return { id, x: c.x, y: c.y, name: names[id], owner: PLAYER, troops: 8, capital: true, lv: 2, buildings: [] };
    }
    if (slot) {
      return {
        id, x: c.x, y: c.y, name: names[id],
        owner: slot.faction,
        troops: Math.max(3, Math.round(slot.troops * cfg.enemyTroopScale)),
        capital: slot.capital,
        lv: slot.lv,
        buildings: cfg.enemyStartBuildings ? slot.buildings : [],
      };
    }
    return {
      id, x: c.x, y: c.y, name: names[id],
      owner: NEUTRAL,
      troops: isStronghold ? cfg.neutralStr * 2 : ns,
      capital: false,
      lv: 1,
      buildings: [],
      stronghold: isStronghold || undefined,
    };
  });

  // Terrain assignments for Grand Continent
  const grandTerrainMap: Record<number, TerrainType> = {
    // Top row: mountain for 0,5; forest for 1,2
    0: 'mountain', 1: 'forest', 2: 'forest', 5: 'mountain',
    // Row 1: forest 7,8
    7: 'forest', 8: 'forest',
    // Row 2: coast 11,16
    11: 'coast', 16: 'coast',
    // Row 3: desert 18,19
    18: 'desert', 19: 'desert',
    // Row 4: coast 22; desert 26,27
    22: 'coast', 26: 'desert', 27: 'desert',
    // Row 5: coast 28,29; desert 33
    28: 'coast', 29: 'coast', 33: 'desert',
  };
  nodes.forEach(n => {
    if (grandTerrainMap[n.id]) {
      n.terrain = grandTerrainMap[n.id];
    }
  });

  const edges: [number, number][] = [
    // Row 0→1
    [0,6],[1,6],[1,7],[2,7],[2,8],[3,8],[3,9],[4,9],[4,10],[5,10],
    // Row 1 internal
    [6,7],[7,8],[8,9],[9,10],
    // Row 1→2
    [6,11],[6,12],[7,12],[7,13],[8,13],[8,14],[9,14],[9,15],[10,15],[10,16],
    // Row 2 internal
    [11,12],[12,13],[13,14],[14,15],[15,16],
    // Row 2→3
    [11,17],[12,17],[12,18],[13,18],[13,19],[14,19],[14,20],[15,20],[15,21],[16,21],
    // Row 3 internal
    [17,18],[18,19],[19,20],[20,21],
    // Row 3→4
    [17,22],[17,23],[18,23],[18,24],[19,24],[19,25],[20,25],[20,26],[21,26],[21,27],
    // Row 4 internal
    [22,23],[23,24],[24,25],[25,26],[26,27],
    // Row 4→5
    [22,28],[22,29],[23,29],[23,30],[24,30],[24,31],[25,31],[25,32],[26,32],[26,33],[27,33],
    // Row 5 internal
    [28,29],[29,30],[30,31],[31,32],[32,33],
  ];

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// buildTutorial  — 8 territories, guided intro map
// ---------------------------------------------------------------------------

function buildTutorial(cfg: GameConfig): { nodes: Territory[]; edges: [number, number][] } {
  const SLOTS: EnemySlot[] = [
    { id: 7, troops: 6, capital: true, lv: 2, buildings: ['tower'] },
  ];
  const active = new Set(SLOTS.slice(0, cfg.enemyTerritories).map(s => s.id));
  const ns = Math.min(cfg.neutralStr, 3);

  const nodes: Territory[] = [
    { id: 0, x: 100, y: 180, name: 'Ironhold',   owner: PLAYER,  troops: 6, capital: true,  lv: 2, buildings: [], terrain: 'plains' },
    { id: 1, x: 230, y: 180, name: 'Meadowkeep', owner: NEUTRAL, troops: ns, capital: false, lv: 1, buildings: ['farm'], terrain: 'plains' },
    { id: 2, x: 340, y: 120, name: 'Thornwood',  owner: NEUTRAL, troops: ns, capital: false, lv: 1, buildings: [], terrain: 'forest' },
    { id: 3, x: 450, y: 120, name: 'Ridgepass',  owner: NEUTRAL, troops: ns, capital: false, lv: 1, buildings: [], terrain: 'mountain' },
    { id: 4, x: 230, y: 280, name: 'Saltcove',   owner: NEUTRAL, troops: ns, capital: false, lv: 1, buildings: [], terrain: 'coast' },
    { id: 5, x: 450, y: 240, name: 'Ashfen',     owner: NEUTRAL, troops: ns, capital: false, lv: 1, buildings: [], terrain: 'plains' },
    { id: 6, x: 550, y: 180, name: 'Duskbridge', owner: NEUTRAL, troops: ns, capital: false, lv: 1, buildings: [], terrain: 'plains' },
    { id: 7, x: 550, y: 280, name: 'Ashpeak',    ...applySlot(SLOTS[0], cfg, active), terrain: 'plains' } as Territory,
  ];

  const edges: [number, number][] = [
    [0,1],[1,2],[2,3],[3,5],[1,4],[4,5],[5,6],[6,7],[5,7],
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
      case 'tutorial':        return buildTutorial(cfg);
      case 'narrows':         return buildNarrows(cfg);
      case 'crossroads':      return buildCrossroads(cfg);
      case 'frontier':        return buildFrontier(cfg);
      case 'grand_continent': return buildGrandContinent(cfg);
      default:                return buildHeartlands(cfg);
    }
  })();

  return {
    id,
    turn: 1,
    status: 'active',
    nodes: map.nodes,
    edges: map.edges,
    resources: { gold: cfg.startGold, food: cfg.startFood, mat: cfg.startMat, influence: 0 },
    config: cfg,
    log: [{ turn: 1, message: 'Campaign begins.', timestamp: Date.now() }],
    sel: null,
    tgt: null,
    actionsLeft: cfg.apPerTurn,
    lastEvent: null,
    research: [],
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
  enemyFactions: 1,
  enableDiplomacy: false,
  enableTechTree: true,
  enableAltVictory: false,
  enableStrongholds: false,
  altVictoryGold: 400,
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
  const cfg = state.config;
  const hasEnemy = state.nodes.some(n => isEnemy(n.owner));
  const hasPlayer = state.nodes.some(n => n.owner === PLAYER);
  if (!hasEnemy) return { ...state, status: 'victory', victoryType: 'conquest' };
  if (!hasPlayer) return { ...state, status: 'defeated' };

  if (cfg.enableAltVictory) {
    if (state.resources.gold >= (cfg.altVictoryGold ?? 400)) {
      return { ...state, status: 'victory', victoryType: 'economic' };
    }
    if (cfg.enableTechTree) {
      const branches: Record<string, string[]> = {
        military:  ['iron_will', 'siege_craft', 'war_doctrine', 'total_war'],
        economic:  ['trade_routes', 'industrialisation', 'granaries', 'market_dominance'],
        expansion: ['cartography', 'colonisation', 'fortifications', 'grand_strategy'],
      };
      for (const [b, ids] of Object.entries(branches)) {
        if (ids.every(techId => state.research.includes(techId))) {
          return { ...state, status: 'victory', victoryType: 'research', researchBranch: b };
        }
      }
    }
  }

  return state;
}

function apLeft(state: GameState): number {
  let base = state.actionsLeft ?? state.config.apPerTurn ?? 4;
  // grand_strategy adds 1 AP on init (applied at turn start, not mid-turn)
  return base;
}

function handleAttack(state: GameState, action: { fromId: number; toId: number; troops: number }): GameState {
  const research = state.research ?? [];
  const attackCost = research.includes('iron_will') ? 1 : AP_COST.ATTACK;
  if (apLeft(state) < attackCost) return addLog(state, `Not enough action points to attack (costs ${attackCost} AP).`);

  const nodes = state.nodes.map(n => ({ ...n, buildings: [...n.buildings] }));
  const att = nodes[action.fromId];
  const def = nodes[action.toId];

  if (!att || !def) return state;
  if (att.owner !== PLAYER) return state;
  if (def.owner === PLAYER) return state;
  if (!getNeighbours(state.edges, action.fromId).includes(action.toId)) return state;
  if (action.troops < 1 || action.troops >= att.troops) return state;

  const result = resolveCombat(action.troops, def, state.config.playerBonus, research);
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

  let next = { ...state, nodes, actionsLeft: apLeft(state) - attackCost };
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
  const research = state.research ?? [];
  return addLog({ ...state, nodes, resources, actionsLeft: apLeft(state) - AP_COST.UPGRADE },
    `${node.name} upgraded to Lv${node.lv}. ${getSlots(node)} slots, cap ${getTroopCap(node)}, ${getGoldProd(node, research)}g/turn.`);
}

function handleEndTurn(state: GameState): GameState {
  const cfg = state.config;
  const research = state.research ?? [];
  const p = prodTotals(state.nodes, PLAYER, research);
  const troops = totalTroops(state.nodes, PLAYER);
  const upkeep = troops * cfg.upkeep;
  const foodNet = p.food - upkeep;

  let nodes = state.nodes.map(n => ({ ...n, buildings: [...n.buildings] }));

  // Influence gain
  const playerTerrCount = nodes.filter(n => n.owner === PLAYER).length;
  const marketCount = nodes.filter(n => n.owner === PLAYER && n.buildings.includes('market')).length;
  const influenceGain = cfg.enableDiplomacy
    ? Math.floor(playerTerrCount / 3) + marketCount
    : 0;

  let resources: Resources = {
    gold: state.resources.gold + p.gold,
    food: state.resources.food + foodNet,
    mat: state.resources.mat + p.mat,
    influence: (state.resources.influence ?? 0) + influenceGain,
  };

  // Starvation
  let starved = 0;
  if (resources.food < 0) {
    let deficit = Math.abs(resources.food);
    // granaries: starvation damage halved
    if (research.includes('granaries')) deficit = Math.floor(deficit / 2);
    resources.food = 0;
    while (deficit-- > 0) {
      const fed = nodes.filter(n => n.owner === PLAYER && n.troops > 0);
      if (!fed.length) break;
      fed[Math.floor(Math.random() * fed.length)].troops--;
      starved++;
    }
  }

  let next = { ...state, nodes, resources };
  next = addLog(next, `T${state.turn}: +${p.gold}g +${p.food}f +${p.mat}m. Upkeep ${upkeep}f. Net food ${foodNet >= 0 ? '+' : ''}${foodNet}.${starved > 0 ? ` ${starved} troops starved.` : ''}${influenceGain > 0 ? ` +${influenceGain} influence.` : ''}`);

  // All enemy faction turns
  next = runEnemyTurn(next);

  // Start next player turn
  const baseAp = cfg.apPerTurn ?? 4;
  const bonusAp = research.includes('grand_strategy') ? 1 : 0;
  next = { ...next, turn: state.turn + 1, sel: null, tgt: null, actionsLeft: baseAp + bonusAp, lastEvent: null };
  next = checkWin(next);

  // Turn events
  if (next.status === 'active' && cfg.enableEvents) {
    next = drawTurnEvent(next);
  }

  return next;
}

function handleAnnex(state: GameState, action: { nodeId: number }): GameState {
  const cfg = state.config;
  if (!cfg.enableDiplomacy) return addLog(state, 'Diplomacy is not enabled.');
  if (apLeft(state) < AP_COST.ANNEX) return addLog(state, `Not enough action points to annex (costs ${AP_COST.ANNEX} AP).`);

  const research = state.research ?? [];
  const influenceCost = research.includes('colonisation') ? 12 : 20;
  const influence = state.resources.influence ?? 0;
  if (influence < influenceCost) return addLog(state, `Not enough influence to annex (need ${influenceCost}, have ${influence}).`);

  const nodes = state.nodes.map(n => ({ ...n, buildings: [...n.buildings] }));
  const target = nodes[action.nodeId];
  if (!target) return state;
  if (target.owner !== NEUTRAL) return addLog(state, 'Can only annex neutral territories.');

  const isAdjacentToPlayer = getNeighbours(state.edges, action.nodeId).some(nid => nodes[nid].owner === PLAYER);
  if (!isAdjacentToPlayer) return addLog(state, 'Can only annex territories adjacent to your own.');

  target.owner = PLAYER;
  target.troops = 1;
  const resources = { ...state.resources, influence: influence - influenceCost };
  let next = { ...state, nodes, resources, actionsLeft: apLeft(state) - AP_COST.ANNEX };
  next = addLog(next, `Annexed ${target.name} peacefully for ${influenceCost} influence.`);
  return checkWin(next);
}

function handleResearch(state: GameState, action: { techId: string }): GameState {
  const cfg = state.config;
  if (!cfg.enableTechTree) return addLog(state, 'Tech tree is not enabled.');
  if (apLeft(state) < AP_COST.RESEARCH) return addLog(state, `Not enough action points to research (costs ${AP_COST.RESEARCH} AP).`);

  const research = state.research ?? [];
  if (research.includes(action.techId)) return addLog(state, 'Already researched.');

  const tech = TECH_TREE.find(t => t.id === action.techId);
  if (!tech) return addLog(state, 'Unknown tech.');
  if (tech.prereq && !research.includes(tech.prereq)) return addLog(state, `Requires ${tech.prereq} first.`);
  if (state.resources.gold < tech.cost.gold || state.resources.mat < tech.cost.mat) {
    return addLog(state, `Need ${tech.cost.gold}g + ${tech.cost.mat}m to research ${tech.name}.`);
  }

  const resources = {
    ...state.resources,
    gold: state.resources.gold - tech.cost.gold,
    mat: state.resources.mat - tech.cost.mat,
  };
  let next = { ...state, research: [...research, action.techId], resources, actionsLeft: apLeft(state) - AP_COST.RESEARCH };
  next = addLog(next, `Researched ${tech.name}: ${tech.desc}.`);
  return checkWin(next);
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
      const targets = s.nodes.filter(n => isEnemy(n.owner) && n.troops > 2);
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
// Enemy AI — per-faction turn
// ---------------------------------------------------------------------------

function runFactionTurn(state: GameState, faction: number): GameState {
  const dm = diffMult(state.config.diff);
  let nodes = state.nodes.map(n => ({ ...n, buildings: [...n.buildings] }));
  const log: string[] = [];

  // Income and building
  nodes.forEach(n => {
    if (n.owner !== faction) return;
    const income = Math.ceil((getGoldProd(n) * dm) / 2) * state.config.growth;
    n.troops = Math.min(n.troops + income, getTroopCap(n));
    if (Math.random() < state.config.buildChance * dm && n.buildings.length < getSlots(n)) {
      const opts = Object.keys(BUILDINGS).filter(k => !n.buildings.includes(k as BuildingType));
      if (opts.length) n.buildings.push(opts[Math.floor(Math.random() * opts.length)] as BuildingType);
    }
    if (Math.random() < 0.08 * dm && n.lv < MAX_LV) n.lv = Math.min(n.lv + 1, MAX_LV);
  });

  // Attacks: faction attacks any non-same-faction territory (including other enemies and player)
  const fNodes = nodes.filter(n => n.owner === faction).sort(() => Math.random() - 0.5);
  fNodes.forEach(att => {
    if (att.troops <= 3) return;
    const tgts = getNeighbours(state.edges, att.id).filter(id => nodes[id].owner !== faction);
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
      def.owner = faction;
      def.troops = Math.max(1, result.surviving);
      log.push(`${FACTION_NAMES[faction] ?? `Faction ${faction}`} captured ${def.name}!`);
    } else {
      def.troops = Math.max(0, def.troops - result.defenderLoss);
    }
  });

  let next = { ...state, nodes };
  log.forEach(m => { next = addLog(next, m); });
  return next;
}

function runEnemyTurn(state: GameState): GameState {
  const cfg = state.config;
  const factionCount = cfg.enemyFactions ?? 1;
  let next = state;
  for (let faction = ENEMY; faction <= 1 + factionCount; faction++) {
    if (next.nodes.some(n => n.owner === faction)) {
      next = runFactionTurn(next, faction);
    }
  }
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
    case 'ANNEX':     return handleAnnex(state, action);
    case 'RESEARCH':  return handleResearch(state, action);
    default:          return state;
  }
}
