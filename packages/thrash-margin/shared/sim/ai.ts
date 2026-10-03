/**
 * The AI. It plays through exactly the same `step` handlers a human does: it pays for every
 * recruit, building, upgrade and technology from its own treasury, feeds its own troops, and
 * spends its own action points. Difficulty changes its income and action budget (content.ts),
 * and how boldly it attacks, never what it is allowed to do.
 *
 * The prototype's AI instead conjured troops from gold production every turn, paid nothing for
 * buildings, ignored food, and attacked as often as it liked, so its strength had nothing to do
 * with the economy the player was being asked to manage.
 *
 * The planner is a priority list rather than a search: feed the army, shore up a threatened
 * border, take a good fight, stage troops for the next fight, grow the economy, and push spare
 * troops toward the front. Each pass applies the first legal candidate and looks again.
 */
import { step } from './actions';
import { BUILDINGS, DIFFICULTY, TECH_TREE } from './content';
import {
  atPeace, attackStrength, defenceOf, foodOf, fortificationOf, frontDistance, friendlyPath, goldOf, incomeOf,
  matOf, neighboursOf, resolveCombat, slotsOf, troopCapOf, troopsToWin,
} from './rules';
import { upgradeCost, annexCost } from './actions';
import type { BuildingType, FactionId, GameAction, GameState, Territory } from './types';
import { NEUTRAL } from './types';

const HORIZON = 10;

interface Ctx {
  s: GameState;
  f: FactionId;
  owned: Territory[];
  front: Map<number, number>;
}

function context(s: GameState): Ctx {
  const f = s.activeFaction;
  return { s, f, owned: s.nodes.filter(n => n.owner === f), front: frontDistance(s, f) };
}

const hostile = (c: Ctx, t: Territory) => t.owner !== c.f && !atPeace(c.s, c.f, t.owner);

/** Strongest single attack a rival could launch on `t` next turn. Neutrals never attack. */
function danger(c: Ctx, t: Territory): number {
  let worst = 0;
  for (const m of neighboursOf(c.s, t.id)) {
    const h = c.s.nodes[m];
    if (h.owner === NEUTRAL || h.owner === c.f || atPeace(c.s, c.f, h.owner) || h.troops < 2) continue;
    worst = Math.max(worst, attackStrength(c.s, h.owner, h.troops - 1));
  }
  return worst;
}

function worth(t: Territory, research: string[] = []): number {
  return goldOf(t, research) + foodOf(t) * 0.8 + matOf(t, research) * 0.8 + t.buildings.length * 1.5 + (t.stronghold ? 2 : 0);
}

/** How many more troops the treasury and the granary can carry right now. */
function affordableTroops(c: Ctx): number {
  const f = c.s.factions[c.f];
  const byGold = Math.floor(f.resources.gold / c.s.config.recruitCost);
  const inc = incomeOf(c.s, c.f);
  const upkeep = c.s.config.upkeep;
  if (upkeep <= 0) return byGold;
  const byFood = Math.floor((inc.foodNet + f.resources.food / 6) / upkeep);
  return Math.max(0, Math.min(byGold, byFood));
}

function tryAct(s: GameState, a: GameAction): GameState | null {
  const next = step(s, a);
  return next === s ? null : next;
}

// ---------------------------------------------------------------------------
// Attacks
// ---------------------------------------------------------------------------

interface Column { from: Territory; avail: number }
interface Plan { to: Territory; columns: Array<{ fromId: number; troops: number }>; score: number; need: number; sources: Column[] }

/** The difficulty profile the faction plays to. Humans stood in for by the harness play to Normal. */
function profile(c: Ctx) {
  return c.s.factions[c.f].human ? DIFFICULTY.normal : DIFFICULTY[c.s.config.diff];
}

/** Splits `total` troops across columns, biggest first. */
function allocate(sources: Column[], total: number): Array<{ fromId: number; troops: number }> {
  const out: Array<{ fromId: number; troops: number }> = [];
  let left = total;
  for (const c of sources) {
    if (left <= 0) break;
    const n = Math.min(c.avail, left);
    if (n >= 1) { out.push({ fromId: c.from.id, troops: n }); left -= n; }
  }
  return out;
}

/**
 * Every fight worth considering: for each hostile territory, the bordering territories that could
 * contribute, the troops needed, and a score in rough gold terms (what the territory earns over
 * the next few turns, plus capitals and finishing blows, minus the troops it costs).
 */
function attackPlans(c: Ctx): Plan[] {
  const d = profile(c);
  const research = c.s.factions[c.f].research;
  const counts = new Map<number, number>();
  for (const n of c.s.nodes) counts.set(n.owner, (counts.get(n.owner) ?? 0) + 1);
  const plans: Plan[] = [];
  const targets = new Set<number>();
  for (const t of c.owned) for (const m of neighboursOf(c.s, t.id)) if (hostile(c, c.s.nodes[m])) targets.add(m);
  for (const id of [...targets].sort((a, b) => a - b)) {
    const to = c.s.nodes[id];
    const sources: Column[] = neighboursOf(c.s, id)
      .map(m => c.s.nodes[m])
      .filter(n => n.owner === c.f && n.troops >= 2)
      .map(from => ({ from, avail: from.troops - (from.capital ? Math.max(2, Math.ceil(danger(c, from) * 0.4)) : 1) }))
      .filter(x => x.avail >= 1)
      .sort((a, b) => b.avail - a.avail || a.from.id - b.from.id);
    const total = sources.reduce((sum, x) => sum + x.avail, 0);
    const need = troopsToWin(c.s, c.f, to, 9999, Math.max(1, d.minRatio))!;
    const better = troopsToWin(c.s, c.f, to, 9999, 1.8)!;
    const send = better <= total ? better : need;
    let value = worth(to, research) * HORIZON;
    if (to.capital) value += 60;
    if (to.owner !== NEUTRAL && counts.get(to.owner) === 1) value += 80;
    if (to.owner !== NEUTRAL) value += c.s.factions[to.owner]?.human ? 12 * d.humanFocus : 6;
    const r = resolveCombat(c.s, c.f, Math.max(send, 1), to);
    const loss = r.attackerLoss * c.s.config.recruitCost * 1.3;
    const columns = send <= total ? allocate(sources, send) : [];
    // Holding it matters. A sliver of survivors next to a rival army is a gift to them: the
    // territory flips straight back and both sides bleed for nothing. Price in being retaken,
    // and the same for any column left too thin to hold its own ground.
    const hold = r.surviving + fortificationOf(to, research);
    let exposure = 0;
    for (const k of neighboursOf(c.s, id)) {
      const h = c.s.nodes[k];
      if (h.owner === NEUTRAL || h.owner === c.f || atPeace(c.s, c.f, h.owner) || h.troops < 2) continue;
      const threat = attackStrength(c.s, h.owner, h.troops - 1);
      if (threat >= hold) exposure = Math.max(exposure, value * 0.8 + r.surviving * c.s.config.recruitCost);
      else if (threat >= hold * 0.75) exposure = Math.max(exposure, value * 0.3);
    }
    for (const col of columns) {
      const src = c.s.nodes[col.fromId];
      const left = { ...src, troops: src.troops - col.troops };
      if (danger(c, src) >= defenceOf(left, research)) exposure += worth(src, research) * (src.capital ? 6 : 2);
    }
    plans.push({ to, columns, need: send, sources, score: value - loss - exposure });
  }
  return plans.sort((a, b) => b.score - a.score || a.to.id - b.to.id);
}

function attackAction(p: Plan): GameAction {
  const [main, ...support] = p.columns;
  return { type: 'ATTACK', toId: p.to.id, fromId: main.fromId, troops: main.troops, ...(support.length ? { support } : {}) };
}

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

function chooseBuilding(c: Ctx, t: Territory): BuildingType | null {
  const inc = incomeOf(c.s, c.f);
  const res = c.s.factions[c.f].resources;
  const isFront = (c.front.get(t.id) ?? 0) === 0;
  const upgrades: BuildingType[] = [];
  for (const b of t.buildings) {
    const up = ({ farm: 'large_farm', large_farm: 'granary', mine: 'deep_mine', deep_mine: 'foundry', market: 'grand_market', tower: 'fortress', barracks: 'fort' } as Partial<Record<BuildingType, BuildingType>>)[b];
    if (up) upgrades.push(up);
  }
  const hasSlot = t.buildings.length < slotsOf(t);
  const want: BuildingType[] = [];
  if (inc.foodNet < 3 || (res.gold > 80 && inc.foodNet < 8)) want.push('farm', 'large_farm', 'granary');
  if (t.capital && isFront && danger(c, t) > defenceOf(t) * 0.6) want.push('tower', 'fortress');
  if (inc.mat < 4 || res.mat < 15 || (res.gold > 80 && inc.mat < 8)) want.push('mine', 'deep_mine', 'foundry');
  if (isFront && t.troops >= troopCapOf(t) - 1) want.push('barracks', 'fort');
  want.push('market', 'grand_market', 'farm', 'mine', 'large_farm', 'deep_mine', 'granary', 'foundry');
  for (const b of want) {
    const isUpgrade = !(['farm', 'mine', 'barracks', 'market', 'tower'] as BuildingType[]).includes(b);
    if (isUpgrade ? !upgrades.includes(b) : !hasSlot) continue;
    const cost = BUILDINGS[b].cost;
    if (res.gold >= cost.gold && res.mat >= cost.mat) return b;
  }
  return null;
}

function bestBuild(c: Ctx): GameAction | null {
  // Safest, richest territory first: interior before frontier, capital before others.
  const order = c.owned.slice().sort((a, b) =>
    (c.front.get(b.id) ?? 0) - (c.front.get(a.id) ?? 0) || Number(b.capital) - Number(a.capital) || b.lv - a.lv || a.id - b.id);
  for (const t of order) {
    const b = chooseBuilding(c, t);
    if (b) return { type: 'BUILD', nodeId: t.id, building: b };
  }
  return null;
}

function bestUpgrade(c: Ctx): GameAction | null {
  const res = c.s.factions[c.f].resources;
  const order = c.owned
    .filter(t => t.buildings.length >= slotsOf(t) || t.capital)
    .sort((a, b) => Number(b.capital) - Number(a.capital) || b.buildings.length - a.buildings.length || a.id - b.id);
  for (const t of order) {
    const cost = upgradeCost(t);
    if (!cost) continue;
    // Keep a working float back so an upgrade never leaves the treasury unable to answer a threat.
    if (res.gold >= cost.gold + 10 && res.mat >= cost.mat && res.population >= cost.pop) return { type: 'UPGRADE', nodeId: t.id };
  }
  return null;
}

function bestResearch(c: Ctx): GameAction | null {
  if (!c.s.config.enableTechTree) return null;
  const f = c.s.factions[c.f];
  const avail = TECH_TREE.filter(t => !f.research.includes(t.id) && (!t.prereq || f.research.includes(t.prereq)));
  const pref = ['iron_will', 'trade_routes', 'siege_craft', 'industrialisation', 'granaries', 'total_war', 'war_doctrine', 'market_dominance', 'cartography', 'colonisation', 'fortifications', 'grand_strategy'];
  avail.sort((a, b) => pref.indexOf(a.id) - pref.indexOf(b.id));
  for (const t of avail) {
    if (f.resources.gold >= t.cost.gold + 20 && f.resources.mat >= t.cost.mat + 5) return { type: 'RESEARCH', techId: t.id };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

function* candidates(s: GameState): Generator<GameAction> {
  const c = context(s);
  if (!c.owned.length) return;
  const f = s.factions[c.f];
  const inc = incomeOf(s, c.f);
  const cfg = s.config;

  // 1. A starving army melts: fix food before anything else.
  if (inc.foodNet < 0 && f.resources.food + inc.foodNet * 2 < 0) {
    const order = c.owned.slice().sort((a, b) => (c.front.get(b.id) ?? 0) - (c.front.get(a.id) ?? 0) || a.id - b.id);
    for (const t of order) {
      if (t.buildings.length < slotsOf(t) && f.resources.gold >= BUILDINGS.farm.cost.gold && f.resources.mat >= BUILDINGS.farm.cost.mat) {
        yield { type: 'BUILD', nodeId: t.id, building: 'farm' };
      }
      if (t.buildings.includes('farm') && f.resources.gold >= BUILDINGS.large_farm.cost.gold && f.resources.mat >= BUILDINGS.large_farm.cost.mat) {
        yield { type: 'BUILD', nodeId: t.id, building: 'large_farm' };
      }
    }
  }

  // 2. A border territory a rival could take next turn gets reinforced.
  const threatened = c.owned
    .map(t => ({ t, gap: danger(c, t) - defenceOf(t, f.research) }))
    .filter(x => x.gap >= 0)
    .sort((a, b) => Number(b.t.capital) - Number(a.t.capital) || b.gap - a.gap);
  for (const { t, gap } of threatened) {
    const room = troopCapOf(t) - t.troops;
    // Action points are scarce: a reinforcement is worth one only if it is a real batch.
    const n = Math.min(room, Math.max(gap + 2, 3), affordableTroops(c));
    if (n >= Math.min(2, room)) yield { type: 'RECRUIT', nodeId: t.id, amount: n };
  }

  // 3. Take a good fight.
  const plans = attackPlans(c);
  for (const p of plans.filter(x => x.score > 4 && x.columns.length).slice(0, 4)) yield attackAction(p);

  // 3b. A treasury this full is wasted on anything but growth.
  if (f.resources.gold >= 100 || (f.resources.mat >= 100 && f.resources.gold >= 40)) {
    const u = bestUpgrade(c);
    if (u) yield u;
    const r = bestResearch(c);
    if (r) yield r;
    const b = bestBuild(c);
    if (b) yield b;
  }

  // 4. Grow the economy while it is cheap to do so.
  const buildings = c.owned.reduce((n, t) => n + t.buildings.length, 0);
  if (buildings < c.owned.length) {
    const b = bestBuild(c);
    if (b) yield b;
  }

  // 5. Stage troops where a few more recruits win a fight worth having.
  const staged = plans.filter(p => p.score > 4 && !p.columns.length);
  for (const p of staged) {
    const have = p.sources.reduce((sum, x) => sum + x.avail, 0);
    let deficit = p.need - have;
    const rooms = p.sources.map(x => ({ id: x.from.id, room: troopCapOf(x.from) - x.from.troops })).filter(x => x.room > 0)
      .sort((a, b) => b.room - a.room || a.id - b.id);
    const capacity = rooms.reduce((sum, x) => sum + x.room, 0);
    if (deficit <= 0 || deficit > capacity || deficit > affordableTroops(c) + 2) continue;
    for (const r of rooms) {
      const n = Math.min(r.room, deficit, affordableTroops(c));
      if (n < 1 || (n < 2 && n < deficit)) break;
      yield { type: 'RECRUIT', nodeId: r.id, amount: n };
      deficit -= n;
    }
  }

  // 5b. A fight that the bordering territories cannot even hold enough troops for: raise their
  // capacity, which is how a fortified capital is eventually besieged.
  for (const p of staged.slice(0, 2)) {
    const have = p.sources.reduce((sum, x) => sum + x.avail, 0);
    const capacity = p.sources.reduce((sum, x) => sum + troopCapOf(x.from) - x.from.troops, 0);
    if (p.need - have <= capacity) continue;
    for (const x of p.sources) {
      const t = x.from;
      if (t.buildings.includes('barracks')) yield { type: 'BUILD', nodeId: t.id, building: 'fort' };
      else if (t.buildings.length < slotsOf(t)) yield { type: 'BUILD', nodeId: t.id, building: 'barracks' };
      if (f.resources.gold >= (upgradeCost(t)?.gold ?? 0) + 4) yield { type: 'UPGRADE', nodeId: t.id };
    }
  }

  // 6. Pull idle troops from the interior to the most useful border territory.
  const borders = c.owned.filter(t => (c.front.get(t.id) ?? 0) === 0);
  if (borders.length) {
    const pull = (t: Territory) => Math.max(0, ...plans.filter(p => p.sources.some(x => x.from.id === t.id)).map(p => p.score));
    const target = borders.slice().sort((a, b) => pull(b) - pull(a) || danger(c, b) - danger(c, a) || a.id - b.id)[0];
    const donors = c.owned
      .filter(t => (c.front.get(t.id) ?? 0) > 0 && t.troops >= 3)
      .sort((a, b) => b.troops - a.troops || a.id - b.id);
    for (const d of donors) {
      if (!friendlyPath(s, c.f, d.id, target.id)) continue;
      const room = troopCapOf(target) - target.troops;
      const n = Math.min(d.troops - 1, room);
      if (n >= 2) yield { type: 'MOVE', fromId: d.id, toId: target.id, troops: n };
    }
  }

  // 6b. Turn surplus gold into the materials every upgrade and building is short of, or sell a
  // granary glut for gold when the treasury is empty.
  if (f.resources.gold > 60 && f.resources.mat < 40) {
    yield { type: 'TRADE', resource: 'mat', side: 'buy', lots: Math.min(4 - f.traded.mat, Math.floor((f.resources.gold - 40) / 15)) };
  }
  if (f.resources.gold < 15 && f.resources.food > 80 && inc.foodNet > 0) {
    yield { type: 'TRADE', resource: 'food', side: 'sell', lots: Math.min(4 - f.traded.food, Math.floor((f.resources.food - 60) / 5)) };
  }

  // 7. Everything else that compounds.
  const b = bestBuild(c);
  if (b) yield b;
  const u = bestUpgrade(c);
  if (u) yield u;
  const r = bestResearch(c);
  if (r) yield r;

  // 8. Peaceful expansion when diplomacy allows it.
  if (cfg.enableDiplomacy && f.resources.influence >= annexCost(f)) {
    const options = c.s.nodes
      .filter(t => t.owner === NEUTRAL && neighboursOf(s, t.id).some(m => s.nodes[m].owner === c.f))
      .sort((a, b) => worth(b) - worth(a) || b.troops - a.troops || a.id - b.id);
    if (options.length) yield { type: 'ANNEX', nodeId: options[0].id };
  }

  // 9. Bank spare gold as troops on the most exposed border, within what the granary can feed.
  if (borders.length && f.resources.gold > 30) {
    const pull = (t: Territory) => Math.max(0, ...plans.filter(p => p.sources.some(x => x.from.id === t.id)).map(p => p.score));
    for (const t of borders.slice().sort((a, b) => pull(b) - pull(a) || danger(c, b) - danger(c, a) || a.id - b.id)) {
      const n = Math.min(troopCapOf(t) - t.troops, affordableTroops(c), Math.floor((f.resources.gold - 20) / cfg.recruitCost));
      if (n >= 3) yield { type: 'RECRUIT', nodeId: t.id, amount: n };
    }
  }
}

/** The first legal action the AI would take next, or null when it is done for the turn. */
export function nextAiAction(state: GameState): GameAction | null {
  if (state.status !== 'active') return null;
  for (const a of candidates(state)) if (tryAct(state, a)) return a;
  return null;
}

/**
 * Plays the active faction's turn up to (not including) END_TURN. Used inside END_TURN for every
 * AI faction, and by the harness to stand in for a human.
 */
export function playAiTurn(state: GameState): GameState {
  let s = state;
  for (let guard = 0; guard < 40; guard++) {
    const a = nextAiAction(s);
    if (!a) break;
    s = step(s, a);
  }
  return s;
}
