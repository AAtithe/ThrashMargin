// shared/engine-reference.ts
// Complete game engine ported from the v6 prototype.
// This is the reference implementation. Claude Code should split this
// into server/src/engine/{state,combat,ai,actions,index}.ts

import {
  GameState, GameAction, GameConfig, Territory, Resources,
  Owner, BuildingType, LogEntry, GameStatus,
  PLAYER, ENEMY, NEUTRAL,
} from './types';

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
// Initial state factory
// ---------------------------------------------------------------------------

export function createInitialState(id: string, config: GameConfig): GameState {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Enemy node slots in priority order — first N slots are active enemy, rest become neutral
  const ENEMY_SLOTS: { id: number; troops: number; capital: boolean; lv: number; buildings: BuildingType[] }[] = [
    { id:  4, troops: 7, capital: true,  lv: 2, buildings: ['farm', 'tower'] },
    { id: 19, troops: 6, capital: true,  lv: 2, buildings: ['mine', 'barracks'] },
    { id:  9, troops: 5, capital: false, lv: 1, buildings: ['farm'] },
    { id: 14, troops: 5, capital: false, lv: 1, buildings: [] },
  ];
  const activeEnemyIds = new Set(ENEMY_SLOTS.slice(0, cfg.enemyTerritories).map(s => s.id));

  const enemyNode = (slot: typeof ENEMY_SLOTS[0]): Partial<Territory> => {
    if (!activeEnemyIds.has(slot.id)) {
      return { owner: NEUTRAL, troops: cfg.neutralStr, capital: false, lv: 1, buildings: [] };
    }
    const rawTroops = Math.round(slot.troops * cfg.enemyTroopScale);
    return {
      owner: ENEMY,
      troops: Math.max(3, rawTroops),
      capital: slot.capital,
      lv: slot.lv,
      buildings: cfg.enemyStartBuildings ? slot.buildings : [],
    };
  };

  const nodes: Territory[] = [
    { id:  0, x:  68, y:  55, name: 'Ironhold',   owner: PLAYER,  troops: 8,           capital: true,  lv: 2, buildings: [] },
    { id:  1, x: 195, y:  42, name: 'Ashford',    owner: NEUTRAL, troops: cfg.neutralStr, capital: false, lv: 1, buildings: [] },
    { id:  2, x: 320, y:  35, name: 'Dunepass',   owner: NEUTRAL, troops: cfg.neutralStr, capital: false, lv: 1, buildings: [] },
    { id:  3, x: 445, y:  42, name: 'Stormgate',  owner: NEUTRAL, troops: cfg.neutralStr, capital: false, lv: 1, buildings: [] },
    { id:  4, x: 548, y:  58, name: 'Redfort',    ...enemyNode(ENEMY_SLOTS[0]) } as Territory,
    { id:  5, x:  62, y: 158, name: 'Millhaven',  owner: NEUTRAL, troops: cfg.neutralStr, capital: false, lv: 1, buildings: [] },
    { id:  6, x: 178, y: 148, name: 'Greywall',   owner: NEUTRAL, troops: cfg.neutralStr + 1, capital: false, lv: 1, buildings: [] },
    { id:  7, x: 300, y: 140, name: 'Thornfield', owner: NEUTRAL, troops: cfg.neutralStr, capital: false, lv: 1, buildings: [] },
    { id:  8, x: 422, y: 148, name: 'Ironpass',   owner: NEUTRAL, troops: cfg.neutralStr, capital: false, lv: 1, buildings: [] },
    { id:  9, x: 535, y: 165, name: 'Crimsonton', ...enemyNode(ENEMY_SLOTS[2]) } as Territory,
    { id: 10, x:  80, y: 268, name: 'Lowbridge',  owner: NEUTRAL, troops: cfg.neutralStr, capital: false, lv: 1, buildings: [] },
    { id: 11, x: 200, y: 258, name: 'Saltmere',   owner: NEUTRAL, troops: cfg.neutralStr, capital: false, lv: 1, buildings: [] },
    { id: 12, x: 318, y: 252, name: 'Midkeep',    owner: NEUTRAL, troops: cfg.neutralStr + 1, capital: false, lv: 1, buildings: [] },
    { id: 13, x: 436, y: 258, name: 'Ashveil',    owner: NEUTRAL, troops: cfg.neutralStr, capital: false, lv: 1, buildings: [] },
    { id: 14, x: 540, y: 272, name: 'Emberveil',  ...enemyNode(ENEMY_SLOTS[3]) } as Territory,
    { id: 15, x:  65, y: 375, name: 'Southfen',   owner: NEUTRAL, troops: Math.max(1, cfg.neutralStr - 1), capital: false, lv: 1, buildings: [] },
    { id: 16, x: 190, y: 368, name: 'Marshgate',  owner: NEUTRAL, troops: cfg.neutralStr, capital: false, lv: 1, buildings: [] },
    { id: 17, x: 312, y: 362, name: 'Stonekeep',  owner: NEUTRAL, troops: cfg.neutralStr + 1, capital: false, lv: 1, buildings: [] },
    { id: 18, x: 432, y: 368, name: 'Cindervale', owner: NEUTRAL, troops: cfg.neutralStr, capital: false, lv: 1, buildings: [] },
    { id: 19, x: 542, y: 385, name: 'Ashpeak',    ...enemyNode(ENEMY_SLOTS[1]) } as Territory,
  ];

  const edges: [number, number][] = [
    [0,1],[1,2],[2,3],[3,4],[4,9],[0,5],[1,5],[1,6],[2,6],[2,7],[3,7],[3,8],[8,9],[9,14],
    [5,6],[6,7],[7,8],[8,13],[13,14],
    [5,10],[6,10],[6,11],[7,11],[7,12],[8,12],[13,18],[14,18],[14,19],
    [10,11],[10,15],[11,12],[11,15],[11,16],[12,13],[12,16],[12,17],[13,17],[13,18],
    [15,16],[16,17],[17,18],[18,19],
  ];

  return {
    id,
    turn: 1,
    status: 'active',
    nodes,
    edges,
    resources: { gold: cfg.startGold, food: cfg.startFood, mat: cfg.startMat },
    config: cfg,
    log: [{ turn: 1, message: 'Campaign begins.', timestamp: Date.now() }],
    sel: null,
    tgt: null,
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

function handleAttack(state: GameState, action: { fromId: number; toId: number; troops: number }): GameState {
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

  let next = { ...state, nodes };
  next = addLog(next, message);
  return checkWin(next);
}

function handleRecruit(state: GameState, action: { nodeId: number; amount: number }): GameState {
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
  return addLog({ ...state, nodes, resources }, `Recruited ${actual} at ${node.name} for ${cost}g. Upkeep now ${troops}f/turn.`);
}

function handleBuild(state: GameState, action: { nodeId: number; building: BuildingType }): GameState {
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
  return addLog({ ...state, nodes, resources }, `Built ${b.name} at ${node.name}. ${b.desc}.`);
}

function handleUpgrade(state: GameState, action: { nodeId: number }): GameState {
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
  return addLog({ ...state, nodes, resources },
    `${node.name} upgraded to Lv${node.lv}. ${getSlots(node)} slots, cap ${getTroopCap(node)}, ${getGoldProd(node)}g/turn.`);
}

function handleEndTurn(state: GameState): GameState {
  const p = prodTotals(state.nodes, PLAYER);
  const troops = totalTroops(state.nodes, PLAYER);
  const upkeep = troops * state.config.upkeep;
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

  next = { ...next, turn: state.turn + 1, sel: null, tgt: null };
  return checkWin(next);
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
  return addLog({ ...state, nodes }, `Moved ${actual} troops from ${src.name} to ${dst.name}.`);
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
