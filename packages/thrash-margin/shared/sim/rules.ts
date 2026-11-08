/**
 * Derived numbers: production, capacity, defence, combat, adjacency and visibility. All pure and
 * all shared by the engine, the AI and the UI, so a preview in the sidebar can never disagree
 * with what the engine then does.
 */
import {
  BUILDINGS, CAPITAL_BONUS, DIFFICULTY, FACTION_NAMES, LEVELS, STRONGHOLD_GOLD, terrainOf,
} from './content';
import type { FactionId, FactionState, GameState, Territory } from './types';
import { NEUTRAL } from './types';

// ---------------------------------------------------------------------------
// Territory economics
// ---------------------------------------------------------------------------

export const slotsOf = (t: Territory) => LEVELS.slots[t.lv];

export function goldOf(t: Territory, research: readonly string[] = []): number {
  let g = LEVELS.gold[t.lv] + (t.capital ? CAPITAL_BONUS.gold : 0) + (t.stronghold ? STRONGHOLD_GOLD : 0);
  const dominance = research.includes('market_dominance');
  for (const b of t.buildings) {
    g += BUILDINGS[b].prod?.gold ?? 0;
    if (dominance && BUILDINGS[b].family === 'market') g += 2;
  }
  g += terrainOf(t.terrain).gold;
  return Math.max(1, g);
}

export function foodOf(t: Territory): number {
  let f = LEVELS.food[t.lv] + (t.capital ? CAPITAL_BONUS.food : 0);
  for (const b of t.buildings) f += BUILDINGS[b].prod?.food ?? 0;
  f += terrainOf(t.terrain).food;
  return f;
}

export function matOf(t: Territory, research: readonly string[] = []): number {
  let m = t.capital ? CAPITAL_BONUS.mat : 0;
  const industrial = research.includes('industrialisation');
  for (const b of t.buildings) {
    m += BUILDINGS[b].prod?.mat ?? 0;
    if (industrial && BUILDINGS[b].family === 'mine') m += 1;
  }
  m += terrainOf(t.terrain).mat;
  return m;
}

export function popOf(t: Territory): number {
  return t.buildings.reduce((s, b) => s + (BUILDINGS[b].pop ?? 0), 0);
}

export function troopCapOf(t: Territory): number {
  let c = LEVELS.troopCap[t.lv] + (t.capital ? CAPITAL_BONUS.troopCap : 0);
  for (const b of t.buildings) c += BUILDINGS[b].troopCap ?? 0;
  return c;
}

/** Fixed defence on top of the garrison: capital, level, towers and terrain. */
export function fortificationOf(t: Territory, research: readonly string[] = []): number {
  const towerMult = research.includes('fortifications') ? 1.5 : 1;
  let d = (t.capital ? CAPITAL_BONUS.def : 0) + (t.lv > 1 ? t.lv : 0);
  for (const b of t.buildings) d += Math.round((BUILDINGS[b].defBonus ?? 0) * towerMult);
  d += terrainOf(t.terrain).def;
  return d;
}

export function defenceOf(t: Territory, research: readonly string[] = []): number {
  return Math.max(0, t.troops + fortificationOf(t, research));
}

// ---------------------------------------------------------------------------
// Faction economics
// ---------------------------------------------------------------------------

export const researchOf = (state: GameState, faction: FactionId): string[] =>
  state.factions[faction]?.research ?? [];

export function territoriesOf(state: GameState, faction: FactionId): Territory[] {
  return state.nodes.filter(n => n.owner === faction);
}

export function troopsOf(state: GameState, faction: FactionId): number {
  return state.nodes.reduce((s, n) => s + (n.owner === faction ? n.troops : 0), 0);
}

export function upkeepOf(state: GameState, faction: FactionId): number {
  const raw = troopsOf(state, faction) * state.config.upkeep;
  return researchOf(state, faction).includes('granaries') ? Math.ceil(raw * 0.75) : raw;
}

export interface Income {
  gold: number;
  food: number;
  mat: number;
  influence: number;
  population: number;
  upkeep: number;
  /** Food after upkeep. */
  foodNet: number;
}

export function incomeOf(state: GameState, faction: FactionId): Income {
  const research = researchOf(state, faction);
  const owned = territoriesOf(state, faction);
  let gold = 0, food = 0, mat = 0, population = 0, markets = 0;
  for (const t of owned) {
    gold += goldOf(t, research);
    food += foodOf(t);
    mat += matOf(t, research);
    population += popOf(t);
    markets += t.buildings.filter(b => BUILDINGS[b].family === 'market').length;
  }
  if (research.includes('trade_routes')) gold += Math.floor(owned.length / 2);
  const f = state.factions[faction];
  if (f && !f.human) {
    const mult = DIFFICULTY[state.config.diff].incomeMult;
    gold = Math.round(gold * mult);
    food = Math.round(food * mult);
    mat = Math.round(mat * mult);
  }
  // Influence pays for diplomacy and for spies. The prototype only paid it with diplomacy on,
  // so enabling spies alone gave you a spy panel you could never afford to use.
  const influence = state.config.enableDiplomacy || state.config.enableSpies ? Math.floor(owned.length / 3) + markets : 0;
  const upkeep = upkeepOf(state, faction);
  return { gold, food, mat, influence, population, upkeep, foodNet: food - upkeep };
}

// ---------------------------------------------------------------------------
// Combat — fully deterministic, by strength ratio
// ---------------------------------------------------------------------------

export interface CombatResult {
  won: boolean;
  ratio: number;
  attack: number;
  defence: number;
  attackerLoss: number;
  defenderLoss: number;
  surviving: number;
  tier: string;
}

export const COMBAT_TIERS: Array<{ min: number; won: boolean; loss: number; label: string }> = [
  { min: 2.5,  won: true,  loss: 0.15, label: 'Rout' },
  { min: 1.8,  won: true,  loss: 0.35, label: 'Decisive' },
  { min: 1.3,  won: true,  loss: 0.55, label: 'Costly' },
  { min: 1.0,  won: true,  loss: 0.80, label: 'Pyrrhic' },
  { min: 0.75, won: false, loss: 0.55, label: 'Repelled' },
  { min: 0.5,  won: false, loss: 0.25, label: 'Beaten back' },
  { min: 0,    won: false, loss: 0,    label: 'Slaughtered' },
];

/** Attack strength of `sending` troops for a faction, after research and the human bonus. */
export function attackStrength(state: GameState, faction: FactionId, sending: number): number {
  const research = researchOf(state, faction);
  const human = state.factions[faction]?.human ?? false;
  const bonus = human ? state.config.playerBonus : 0;
  const siege = research.includes('siege_craft') ? 1.25 : 1;
  return sending * (1 + bonus) * siege;
}

export function resolveCombat(state: GameState, faction: FactionId, sending: number, target: Territory): CombatResult {
  const research = researchOf(state, faction);
  const attack = attackStrength(state, faction, sending);
  const defence = defenceOf(target, researchOf(state, target.owner));
  const ratio = attack / Math.max(defence, 1);
  const tier = COMBAT_TIERS.find(t => ratio >= t.min)!;
  let attackerLoss: number, defenderLoss: number;
  if (tier.won) {
    attackerLoss = Math.round(sending * tier.loss);
    defenderLoss = target.troops;
    if (research.includes('total_war')) attackerLoss = Math.round(attackerLoss * 0.6);
  } else {
    attackerLoss = sending;
    defenderLoss = Math.round(target.troops * tier.loss);
    if (research.includes('war_doctrine')) defenderLoss += 3;
  }
  attackerLoss = Math.min(sending, Math.max(0, attackerLoss));
  defenderLoss = Math.min(target.troops, Math.max(0, defenderLoss));
  // A won attack always leaves at least one survivor to hold the ground.
  if (tier.won && attackerLoss >= sending) attackerLoss = sending - 1;
  return { won: tier.won, ratio, attack, defence, attackerLoss, defenderLoss, surviving: sending - attackerLoss, tier: tier.label };
}

/** Fewest troops that win the fight at or above `minRatio`, or null if even everything falls short. */
export function troopsToWin(state: GameState, faction: FactionId, target: Territory, available: number, minRatio = 1): number | null {
  const defence = defenceOf(target, researchOf(state, target.owner));
  const perTroop = attackStrength(state, faction, 1);
  const need = Math.max(1, Math.ceil((Math.max(defence, 1) * minRatio) / perTroop - 1e-9));
  return need <= available ? need : null;
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export function neighboursOf(state: Pick<GameState, 'edges'>, id: number): number[] {
  const out: number[] = [];
  for (const [a, b] of state.edges) {
    if (a === id) out.push(b);
    else if (b === id) out.push(a);
  }
  return out;
}

export function adjacent(state: Pick<GameState, 'edges'>, a: number, b: number): boolean {
  return state.edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** Shortest path from `from` to `to` through territory owned by `faction`, or null. */
export function friendlyPath(state: GameState, faction: FactionId, from: number, to: number): number[] | null {
  if (from === to) return [from];
  const prev = new Map<number, number>([[from, -1]]);
  const queue = [from];
  while (queue.length) {
    const n = queue.shift()!;
    for (const m of neighboursOf(state, n)) {
      if (prev.has(m) || state.nodes[m].owner !== faction) continue;
      prev.set(m, n);
      if (m === to) {
        const path = [m];
        let c = n;
        while (c !== -1) { path.unshift(c); c = prev.get(c)!; }
        return path;
      }
      queue.push(m);
    }
  }
  return null;
}

/** Hops from each territory to the nearest territory not owned by `faction`. */
export function frontDistance(state: GameState, faction: FactionId): Map<number, number> {
  const dist = new Map<number, number>();
  const queue: number[] = [];
  for (const n of state.nodes) {
    if (n.owner !== faction) continue;
    if (neighboursOf(state, n.id).some(m => state.nodes[m].owner !== faction)) {
      dist.set(n.id, 0);
      queue.push(n.id);
    }
  }
  while (queue.length) {
    const n = queue.shift()!;
    for (const m of neighboursOf(state, n)) {
      if (state.nodes[m].owner !== faction || dist.has(m)) continue;
      dist.set(m, dist.get(n)! + 1);
      queue.push(m);
    }
  }
  return dist;
}

// ---------------------------------------------------------------------------
// Factions
// ---------------------------------------------------------------------------

export const factionName = (state: GameState | null, id: FactionId) =>
  state?.factions[id]?.name ?? FACTION_NAMES[id] ?? `Faction ${id}`;

export function livingFactions(state: GameState): FactionState[] {
  return Object.values(state.factions).filter(f => !f.eliminated).sort((a, b) => a.id - b.id);
}

export function humanFactions(state: GameState): FactionState[] {
  return Object.values(state.factions).filter(f => f.human).sort((a, b) => a.id - b.id);
}

export function atPeace(state: GameState, a: FactionId, b: FactionId): boolean {
  if (a === NEUTRAL || b === NEUTRAL) return false;
  return (state.factions[a]?.ceasefires[b] ?? 0) > 0;
}

export function capitalOf(state: GameState, faction: FactionId): Territory | null {
  return state.nodes.find(n => n.owner === faction && n.capital) ?? null;
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/** Territory ids `faction` can see in full. Without fog of war, everything. */
export function visibleTo(state: GameState, faction: FactionId): Set<number> {
  const all = () => new Set(state.nodes.map(n => n.id));
  if (!state.config.fogOfWar) return all();
  const f = state.factions[faction];
  if (!f || f.research.includes('cartography')) return all();
  const vis = new Set<number>();
  for (const n of state.nodes) {
    if (n.owner !== faction) continue;
    vis.add(n.id);
    for (const m of neighboursOf(state, n.id)) vis.add(m);
  }
  for (const [id, until] of Object.entries(f.revealed)) {
    if (until >= state.turn) vis.add(Number(id));
  }
  return vis;
}

/** A faction's score, used for the standings table and the end screen. */
export function scoreOf(state: GameState, faction: FactionId): number {
  const owned = territoriesOf(state, faction);
  const levels = owned.reduce((s, t) => s + t.lv, 0);
  const buildings = owned.reduce((s, t) => s + t.buildings.length, 0);
  const f = state.factions[faction];
  return owned.length * 10 + levels * 3 + buildings * 2 + Math.floor(troopsOf(state, faction) / 2)
    + (f?.research.length ?? 0) * 5 + Math.floor((f?.resources.gold ?? 0) / 20);
}
