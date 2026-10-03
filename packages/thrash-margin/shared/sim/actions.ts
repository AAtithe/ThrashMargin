/**
 * Every action except END_TURN, for whichever faction is active.
 *
 * `explain(state, action)` is the single source of truth for legality: it returns null when the
 * action is legal, or the reason it is not. The handlers call it first and return the same state
 * object when it objects, so an illegal action is detectable by reference equality (the AI uses
 * that to spot a rejected move, the save hooks use it to skip a pointless write) and the UI shows
 * the very same sentence on a disabled button. The prototype instead logged a complaint into the
 * battle log for every rejected click.
 */
import {
  ANNEX_COST, ANNEX_COST_COLONISATION, AP_COST, BUILDING_PREREQ, BUILDINGS, CAPITAL_PLUNDER,
  CEASEFIRE_COST, CEASEFIRE_TURNS, LEVELS, MAX_LV, SPY_REVEAL_COST, SPY_REVEAL_TURNS,
  SPY_SABOTAGE_COST, TECH_BY_ID, TRADE_LOT, TRADE_LOTS_PER_TURN, TRADE_PRICES, UNLIMITED_AP,
} from './content';
import { canAfford, EVENT_BY_ID } from './events';
import {
  adjacent, atPeace, factionName, friendlyPath, goldOf, neighboursOf, resolveCombat, slotsOf,
  troopCapOf,
} from './rules';
import { bestSeat } from './state';
import type { FactionId, FactionState, GameAction, GameState, Resources, Territory } from './types';
import { NEUTRAL } from './types';
import { addHeadline, addLog, checkEliminations, checkVictory } from './victory';

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

export function apCost(state: GameState, action: GameAction): number {
  const f = state.factions[state.activeFaction];
  switch (action.type) {
    case 'ATTACK': return f?.research.includes('iron_will') ? 1 : AP_COST.ATTACK;
    case 'MOVE': return adjacent(state, action.fromId, action.toId) ? AP_COST.MOVE : AP_COST.MOVE_FAR;
    case 'RECRUIT': return AP_COST.RECRUIT;
    case 'BUILD': return AP_COST.BUILD;
    case 'UPGRADE': return AP_COST.UPGRADE;
    case 'RESEARCH': return AP_COST.RESEARCH;
    case 'ANNEX': return AP_COST.ANNEX;
    case 'SPY': return AP_COST.SPY;
    case 'CEASEFIRE': return AP_COST.CEASEFIRE;
    default: return 0;
  }
}

export const annexCost = (f: FactionState) => (f.research.includes('colonisation') ? ANNEX_COST_COLONISATION : ANNEX_COST);

export function upgradeCost(t: Territory): { gold: number; mat: number; pop: number } | null {
  if (t.lv >= MAX_LV) return null;
  const to = t.lv + 1;
  return { gold: LEVELS.upGold[to], mat: LEVELS.upMat[to], pop: LEVELS.upPop[to] };
}

const int = (n: unknown) => typeof n === 'number' && Number.isInteger(n);
/** Own-key lookup, so 'constructor' or '__proto__' is never mistaken for content. */
const own = (o: object, k: unknown) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

function shortfall(have: Resources, need: Partial<Resources>): string | null {
  const parts: string[] = [];
  if ((need.gold ?? 0) > have.gold) parts.push(`${need.gold} gold`);
  if ((need.mat ?? 0) > have.mat) parts.push(`${need.mat} materials`);
  if ((need.food ?? 0) > have.food) parts.push(`${need.food} food`);
  if ((need.influence ?? 0) > have.influence) parts.push(`${need.influence} influence`);
  if ((need.population ?? 0) > have.population) parts.push(`${need.population} population`);
  return parts.length ? `Needs ${parts.join(' and ')}.` : null;
}

// ---------------------------------------------------------------------------
// Legality
// ---------------------------------------------------------------------------

export function explain(state: GameState, action: GameAction): string | null {
  if (state.status !== 'active') return 'The game is over.';
  const fid = state.activeFaction;
  const f = state.factions[fid];
  if (!f || f.eliminated) return 'That faction is out of the game.';
  if (state.pendingEvent && action.type !== 'CHOICE') return `Answer "${state.pendingEvent.title}" first.`;
  const cfg = state.config;
  const node = (id: number) => (int(id) ? state.nodes[id] : undefined);
  const ap = apCost(state, action);
  const apShort = ap > state.actionsLeft
    ? `Needs ${ap} action point${ap === 1 ? '' : 's'}; ${state.actionsLeft} left.`
    : null;

  switch (action.type) {
    case 'ATTACK': {
      const to = node(action.toId);
      if (!to) return 'No such territory.';
      if (to.owner === fid) return 'That territory is already yours.';
      if (atPeace(state, fid, to.owner)) return `You are at peace with ${factionName(state, to.owner)} for ${f.ceasefires[to.owner]} more turn${f.ceasefires[to.owner] === 1 ? '' : 's'}.`;
      const columns = [{ fromId: action.fromId, troops: action.troops }, ...(Array.isArray(action.support) ? action.support : [])];
      const used = new Set<number>();
      for (const col of columns) {
        const from = node(col?.fromId);
        if (!from) return 'No such territory.';
        if (used.has(from.id)) return `${from.name} is listed twice.`;
        used.add(from.id);
        if (from.owner !== fid) return 'You can only attack from your own territory.';
        if (!adjacent(state, from.id, to.id)) return `${to.name} does not border ${from.name}.`;
        if (from.troops < 2) return `${from.name} needs at least 2 troops: one must stay behind.`;
        if (!int(col.troops) || col.troops < 1 || col.troops >= from.troops) return `Send between 1 and ${from.troops - 1} troops from ${from.name}.`;
      }
      return apShort;
    }
    case 'RECRUIT': {
      const t = node(action.nodeId);
      if (!t) return 'No such territory.';
      if (t.owner !== fid) return 'You can only recruit in your own territory.';
      const room = troopCapOf(t) - t.troops;
      if (room < 1) return `${t.name} is at its troop capacity of ${troopCapOf(t)}.`;
      if (!int(action.amount) || action.amount < 1) return 'Recruit at least one troop.';
      const n = Math.min(action.amount, room);
      return shortfall(f.resources, { gold: n * cfg.recruitCost }) ?? apShort;
    }
    case 'BUILD': {
      const t = node(action.nodeId);
      const b = own(BUILDINGS, action.building) ? BUILDINGS[action.building] : undefined;
      if (!t || !b) return 'No such building or territory.';
      if (t.owner !== fid) return 'You can only build in your own territory.';
      const prereq = BUILDING_PREREQ[action.building];
      if (prereq) {
        if (!t.buildings.includes(prereq)) return `Needs a ${BUILDINGS[prereq].name} here to upgrade.`;
      } else if (t.buildings.length >= slotsOf(t)) {
        return `All ${slotsOf(t)} building slot${slotsOf(t) === 1 ? '' : 's'} used. Raise the settlement level for more.`;
      }
      return shortfall(f.resources, b.cost) ?? apShort;
    }
    case 'UPGRADE': {
      const t = node(action.nodeId);
      if (!t) return 'No such territory.';
      if (t.owner !== fid) return 'You can only upgrade your own territory.';
      const c = upgradeCost(t);
      if (!c) return `${t.name} is already at the top level.`;
      const short = shortfall(f.resources, { gold: c.gold, mat: c.mat, population: c.pop });
      if (short && c.pop > f.resources.population) return `${short} Farms grow population.`;
      return short ?? apShort;
    }
    case 'MOVE': {
      const from = node(action.fromId), to = node(action.toId);
      if (!from || !to) return 'No such territory.';
      if (from.owner !== fid || to.owner !== fid) return 'Troops can only move between your own territories.';
      if (from.id === to.id) return 'Pick a different destination.';
      if (!friendlyPath(state, fid, from.id, to.id)) return `No route from ${from.name} to ${to.name} through your own land.`;
      if (from.troops < 2) return `${from.name} needs at least 2 troops: one must stay behind.`;
      if (!int(action.troops) || action.troops < 1 || action.troops >= from.troops) return `Move between 1 and ${from.troops - 1} troops.`;
      if (troopCapOf(to) - to.troops < 1) return `${to.name} is at its troop capacity.`;
      return apShort;
    }
    case 'RESEARCH': {
      if (!cfg.enableTechTree) return 'The tech tree is off in this game.';
      const tech = own(TECH_BY_ID, action.techId) ? TECH_BY_ID[action.techId] : undefined;
      if (!tech) return 'No such technology.';
      if (f.research.includes(tech.id)) return `${tech.name} is already researched.`;
      if (tech.prereq && !f.research.includes(tech.prereq)) return `Research ${TECH_BY_ID[tech.prereq].name} first.`;
      return shortfall(f.resources, tech.cost) ?? apShort;
    }
    case 'ANNEX': {
      if (!cfg.enableDiplomacy) return 'Diplomacy is off in this game.';
      const t = node(action.nodeId);
      if (!t) return 'No such territory.';
      if (t.owner !== NEUTRAL) return 'Only neutral territory can be annexed.';
      if (!neighboursOf(state, t.id).some(m => state.nodes[m].owner === fid)) return `${t.name} must border your territory.`;
      return shortfall(f.resources, { influence: annexCost(f) }) ?? apShort;
    }
    case 'SPY': {
      if (!cfg.enableSpies) return 'Spies are off in this game.';
      const t = node(action.nodeId);
      if (!t) return 'No such territory.';
      if (t.owner === fid) return 'That is your own territory.';
      if (action.mode === 'reveal') {
        if (!cfg.fogOfWar || f.research.includes('cartography')) return 'There is no fog of war to see through.';
        if ((f.revealed[t.id] ?? -1) >= state.turn) return `${t.name} is already under watch.`;
        return shortfall(f.resources, { influence: SPY_REVEAL_COST }) ?? apShort;
      }
      if (action.mode === 'sabotage') {
        if (t.owner === NEUTRAL) return 'Sabotage targets rival factions, not neutrals.';
        if (!neighboursOf(state, t.id).some(m => state.nodes[m].owner === fid)) return `${t.name} must border your territory.`;
        if (!t.buildings.length) return `${t.name} has nothing to sabotage.`;
        return shortfall(f.resources, { influence: SPY_SABOTAGE_COST }) ?? apShort;
      }
      return 'Unknown spy mission.';
    }
    case 'CEASEFIRE': {
      if (!cfg.enableDiplomacy) return 'Diplomacy is off in this game.';
      const other = state.factions[action.faction];
      if (!other || other.id === fid || other.eliminated) return 'No such faction to treat with.';
      if (atPeace(state, fid, other.id)) return `Already at peace with ${other.name}.`;
      return shortfall(f.resources, { influence: CEASEFIRE_COST }) ?? apShort;
    }
    case 'CHOICE': {
      const pe = state.pendingEvent;
      if (!pe) return 'There is no decision waiting.';
      if (pe.faction !== fid) return 'That decision belongs to another player.';
      const choice = pe.choices[action.choiceIndex];
      if (!int(action.choiceIndex) || !choice) return 'No such choice.';
      if (!canAfford(f.resources, choice.cost)) return shortfall(f.resources, choice.cost ?? {});
      return null;
    }
    case 'TRADE': {
      if (action.resource !== 'food' && action.resource !== 'mat') return 'Only food and materials trade.';
      if (action.side !== 'buy' && action.side !== 'sell') return 'Buy or sell.';
      if (!state.nodes.some(n => n.owner === fid && n.buildings.some(b => BUILDINGS[b].family === 'market'))) return 'The exchange needs a market in one of your territories.';
      if (!int(action.lots) || action.lots < 1) return 'Trade at least one lot.';
      const left = TRADE_LOTS_PER_TURN - f.traded[action.resource];
      if (action.lots > left) return left > 0 ? `Only ${left} more lot${left === 1 ? '' : 's'} of ${action.resource === 'mat' ? 'materials' : 'food'} this turn.` : `The exchange has no more ${action.resource === 'mat' ? 'materials' : 'food'} for you this turn.`;
      const price = TRADE_PRICES[action.resource];
      if (action.side === 'buy') return shortfall(f.resources, { gold: price.buy * action.lots });
      return shortfall(f.resources, { [action.resource]: TRADE_LOT * action.lots });
    }
    case 'END_TURN':
      return state.pendingEvent ? `Answer "${state.pendingEvent.title}" first.` : null;
    default:
      return 'Unknown action.';
  }
}

// ---------------------------------------------------------------------------
// Helpers for the handlers
// ---------------------------------------------------------------------------

function cloneNodes(state: GameState): Territory[] {
  return state.nodes.map(n => ({ ...n, buildings: [...n.buildings] }));
}

function withFaction(state: GameState, id: FactionId, patch: (f: FactionState) => FactionState): GameState {
  const f = state.factions[id];
  if (!f) return state;
  return { ...state, factions: { ...state.factions, [id]: patch(f) } };
}

function spend(state: GameState, id: FactionId, cost: Partial<Resources>, ap: number): GameState {
  const next = withFaction(state, id, f => {
    const r = { ...f.resources };
    for (const [k, v] of Object.entries(cost) as Array<[keyof Resources, number]>) r[k] -= v;
    return { ...f, resources: r };
  });
  const left = state.actionsLeft >= UNLIMITED_AP ? state.actionsLeft : state.actionsLeft - ap;
  return { ...next, actionsLeft: left };
}

function bumpStats(state: GameState, id: FactionId, delta: Partial<FactionState['stats']>): GameState {
  if (id === NEUTRAL) return state;
  return withFaction(state, id, f => {
    const stats = { ...f.stats };
    for (const [k, v] of Object.entries(delta) as Array<[keyof FactionState['stats'], number]>) stats[k] += v;
    return { ...f, stats };
  });
}

function recordAttack(state: GameState, by: FactionId, target: Territory, victim: FactionId, captured: boolean, lost: number): GameState {
  const v = state.factions[victim];
  if (!v?.human || victim === by || !state.reports[victim]) return state;
  const r = state.reports[victim];
  return {
    ...state,
    reports: { ...state.reports, [victim]: { ...r, attacksSuffered: [...r.attacksSuffered, { by, target: target.id, captured, lost }] } },
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** Every column of an attack, main column first. */
export function attackColumns(a: Extract<GameAction, { type: 'ATTACK' }>): Array<{ fromId: number; troops: number }> {
  return [{ fromId: a.fromId, troops: a.troops }, ...(Array.isArray(a.support) ? a.support : [])];
}

function attack(state: GameState, a: Extract<GameAction, { type: 'ATTACK' }>): GameState {
  const fid = state.activeFaction;
  const nodes = cloneNodes(state);
  const to = nodes[a.toId];
  const victim = to.owner;
  const columns = attackColumns(a);
  const sent = columns.reduce((s, c) => s + c.troops, 0);
  const result = resolveCombat(state, fid, sent, state.nodes[a.toId]);
  for (const c of columns) nodes[c.fromId].troops -= c.troops;
  const joint = columns.length > 1 ? ` from ${columns.length} territories` : '';

  let next: GameState = { ...state, nodes };
  next = spend(next, fid, {}, apCost(state, a));
  const attacker = factionName(state, fid);
  const defender = victim === NEUTRAL ? 'the local militia' : factionName(state, victim);

  if (result.won) {
    const wasCapital = to.capital;
    to.owner = fid;
    to.troops = result.surviving;
    to.capital = false;
    next = bumpStats(next, fid, { battlesWon: 1, captures: 1, troopsLost: result.attackerLoss, capitalsTaken: wasCapital ? 1 : 0 });
    next = bumpStats(next, victim, { battlesLost: 1, troopsLost: state.nodes[a.toId].troops });
    next = addLog(next, {
      faction: fid, kind: 'capture',
      message: `${attacker} took ${to.name} from ${defender} (${result.tier.toLowerCase()}): sent ${sent}${joint}, lost ${result.attackerLoss}, ${result.surviving} hold it.`,
    });
    next = recordAttack(next, fid, to, victim, true, state.nodes[a.toId].troops);

    if (wasCapital && victim !== NEUTRAL) {
      // The seat falls: the victor plunders the treasury, and the loser re-forms its court in
      // its best remaining territory, if it has one.
      const plunder = Math.floor((next.factions[victim]?.resources.gold ?? 0) * CAPITAL_PLUNDER);
      next = withFaction(next, victim, f => ({ ...f, resources: { ...f.resources, gold: f.resources.gold - plunder } }));
      next = withFaction(next, fid, f => ({ ...f, resources: { ...f.resources, gold: f.resources.gold + plunder } }));
      const seat = bestSeat(next.nodes, victim);
      if (seat) next.nodes[seat.id].capital = true;
      const text = `${attacker} sacked ${defender}'s capital at ${to.name}${plunder ? `, plundering ${plunder} gold` : ''}.${seat ? ` Their court flees to ${seat.name}.` : ''}`;
      next = addLog(next, { faction: fid, kind: 'capture', message: text });
      next = addHeadline(next, text, fid);
    } else if (victim !== NEUTRAL && !next.factions[victim]?.human) {
      next = addHeadline(next, `${attacker} took ${to.name} from ${defender}.`, fid);
    }
  } else {
    to.troops -= result.defenderLoss;
    next = bumpStats(next, fid, { battlesLost: 1, troopsLost: sent });
    next = bumpStats(next, victim, { battlesWon: 1, troopsLost: result.defenderLoss });
    next = addLog(next, {
      faction: fid, kind: 'battle',
      message: `${attacker} was ${result.tier.toLowerCase()} at ${to.name}: lost all ${sent}${joint}; ${defender} lost ${result.defenderLoss}.`,
    });
    next = recordAttack(next, fid, to, victim, false, result.defenderLoss);
  }
  next = checkEliminations(next, fid);
  return checkVictory(next);
}

function recruit(state: GameState, a: Extract<GameAction, { type: 'RECRUIT' }>): GameState {
  const fid = state.activeFaction;
  const nodes = cloneNodes(state);
  const t = nodes[a.nodeId];
  const n = Math.min(a.amount, troopCapOf(t) - t.troops);
  t.troops += n;
  const cost = n * state.config.recruitCost;
  const next = spend({ ...state, nodes }, fid, { gold: cost }, apCost(state, a));
  return addLog(next, { faction: fid, kind: 'economy', message: `${factionName(state, fid)} recruited ${n} at ${t.name} for ${cost} gold.` });
}

function build(state: GameState, a: Extract<GameAction, { type: 'BUILD' }>): GameState {
  const fid = state.activeFaction;
  const nodes = cloneNodes(state);
  const t = nodes[a.nodeId];
  const b = BUILDINGS[a.building];
  const prereq = BUILDING_PREREQ[a.building];
  if (prereq) t.buildings[t.buildings.indexOf(prereq)] = a.building;
  else t.buildings.push(a.building);
  const next = spend({ ...state, nodes }, fid, b.cost, apCost(state, a));
  return addLog(next, {
    faction: fid, kind: 'build',
    message: `${factionName(state, fid)} ${prereq ? 'upgraded to' : 'built'} a ${b.name} at ${t.name}: ${b.desc}.`,
  });
}

function upgrade(state: GameState, a: Extract<GameAction, { type: 'UPGRADE' }>): GameState {
  const fid = state.activeFaction;
  const nodes = cloneNodes(state);
  const t = nodes[a.nodeId];
  const c = upgradeCost(t)!;
  t.lv += 1;
  const next = spend({ ...state, nodes }, fid, { gold: c.gold, mat: c.mat, population: c.pop }, apCost(state, a));
  return addLog(next, {
    faction: fid, kind: 'build',
    message: `${t.name} rose to level ${t.lv}: ${slotsOf(t)} slots, ${troopCapOf(t)} troop capacity, ${goldOf(t, next.factions[fid].research)} gold a turn.`,
  });
}

function move(state: GameState, a: Extract<GameAction, { type: 'MOVE' }>): GameState {
  const fid = state.activeFaction;
  const nodes = cloneNodes(state);
  const from = nodes[a.fromId];
  const to = nodes[a.toId];
  const n = Math.min(a.troops, troopCapOf(to) - to.troops);
  from.troops -= n;
  to.troops += n;
  const next = spend({ ...state, nodes }, fid, {}, apCost(state, a));
  return addLog(next, { faction: fid, kind: 'economy', message: `${factionName(state, fid)} marched ${n} troops from ${from.name} to ${to.name}.` });
}

function research(state: GameState, a: Extract<GameAction, { type: 'RESEARCH' }>): GameState {
  const fid = state.activeFaction;
  const tech = TECH_BY_ID[a.techId];
  let next = spend(state, fid, tech.cost, apCost(state, a));
  next = withFaction(next, fid, f => ({ ...f, research: [...f.research, tech.id] }));
  // Grand Strategy's extra action is usable the turn it lands, not only from the next turn.
  if (tech.id === 'grand_strategy' && next.actionsLeft < UNLIMITED_AP) next = { ...next, actionsLeft: next.actionsLeft + 1 };
  next = addLog(next, { faction: fid, kind: 'research', message: `${factionName(state, fid)} researched ${tech.name}. ${tech.desc}` });
  return checkVictory(next);
}

function annex(state: GameState, a: Extract<GameAction, { type: 'ANNEX' }>): GameState {
  const fid = state.activeFaction;
  const cost = annexCost(state.factions[fid]);
  const nodes = cloneNodes(state);
  const t = nodes[a.nodeId];
  t.owner = fid;
  t.troops = Math.max(1, Math.ceil(t.troops / 2));
  let next = spend({ ...state, nodes }, fid, { influence: cost }, apCost(state, a));
  next = bumpStats(next, fid, { annexed: 1 });
  next = addLog(next, { faction: fid, kind: 'diplomacy', message: `${factionName(state, fid)} annexed ${t.name} peacefully for ${cost} influence; ${t.troops} of its militia joined.` });
  return checkVictory(next);
}

function spy(state: GameState, a: Extract<GameAction, { type: 'SPY' }>): GameState {
  const fid = state.activeFaction;
  const target = state.nodes[a.nodeId];
  if (a.mode === 'reveal') {
    let next = spend(state, fid, { influence: SPY_REVEAL_COST }, apCost(state, a));
    next = withFaction(next, fid, f => ({ ...f, revealed: { ...f.revealed, [target.id]: state.turn + SPY_REVEAL_TURNS - 1 } }));
    return addLog(next, { faction: fid, kind: 'diplomacy', message: `Spies watch ${target.name} for ${SPY_REVEAL_TURNS} turns.` });
  }
  const nodes = cloneNodes(state);
  const t = nodes[a.nodeId];
  // Hit the best building: an upgraded one drops a tier, a basic one is destroyed.
  const idx = t.buildings.reduce((best, b, i) => (BUILDINGS[b].tier > BUILDINGS[t.buildings[best]].tier ? i : best), 0);
  const hit = t.buildings[idx];
  const prereq = BUILDING_PREREQ[hit];
  if (prereq) t.buildings[idx] = prereq;
  else t.buildings.splice(idx, 1);
  let next = spend({ ...state, nodes }, fid, { influence: SPY_SABOTAGE_COST }, apCost(state, a));
  const text = prereq
    ? `Saboteurs wrecked the ${BUILDINGS[hit].name} at ${t.name}; it is a ${BUILDINGS[prereq].name} again.`
    : `Saboteurs burned the ${BUILDINGS[hit].name} at ${t.name} to the ground.`;
  next = addLog(next, { faction: fid, kind: 'diplomacy', message: text });
  return addHeadline(next, text, fid);
}

function ceasefire(state: GameState, a: Extract<GameAction, { type: 'CEASEFIRE' }>): GameState {
  const fid = state.activeFaction;
  let next = spend(state, fid, { influence: CEASEFIRE_COST }, apCost(state, a));
  next = withFaction(next, fid, f => ({ ...f, ceasefires: { ...f.ceasefires, [a.faction]: CEASEFIRE_TURNS } }));
  next = withFaction(next, a.faction, f => ({ ...f, ceasefires: { ...f.ceasefires, [fid]: CEASEFIRE_TURNS } }));
  next = bumpStats(next, fid, { ceasefires: 1 });
  const text = `${factionName(state, fid)} and ${factionName(state, a.faction)} agreed a ceasefire for ${CEASEFIRE_TURNS} turns.`;
  next = addLog(next, { faction: fid, kind: 'diplomacy', message: text });
  return addHeadline(next, text, fid);
}

function choice(state: GameState, a: Extract<GameAction, { type: 'CHOICE' }>): GameState {
  const pe = state.pendingEvent!;
  const def = EVENT_BY_ID[pe.id];
  const c = def?.choices?.[a.choiceIndex];
  let next: GameState = { ...state, pendingEvent: null };
  if (c) next = c.apply(next, pe.faction);
  const picked = pe.choices[a.choiceIndex];
  const event = { id: pe.id, title: pe.title, tone: pe.tone, message: `${picked.label}: ${picked.desc}.` };
  next = { ...next, lastEvent: event };
  const r = next.reports[pe.faction];
  if (r) next = { ...next, reports: { ...next.reports, [pe.faction]: { ...r, event } } };
  return addLog(next, { faction: pe.faction, kind: 'event', message: `${pe.title}: ${picked.label}. ${picked.desc}.` });
}

function trade(state: GameState, a: Extract<GameAction, { type: 'TRADE' }>): GameState {
  const fid = state.activeFaction;
  const units = TRADE_LOT * a.lots;
  const price = TRADE_PRICES[a.resource];
  const gold = (a.side === 'buy' ? price.buy : price.sell) * a.lots;
  let next = withFaction(state, fid, f => {
    const r = { ...f.resources };
    if (a.side === 'buy') { r.gold -= gold; r[a.resource] += units; } else { r.gold += gold; r[a.resource] -= units; }
    return { ...f, resources: r, traded: { ...f.traded, [a.resource]: f.traded[a.resource] + a.lots } };
  });
  const what = a.resource === 'mat' ? 'materials' : 'food';
  next = addLog(next, {
    faction: fid, kind: 'economy',
    message: a.side === 'buy' ? `${factionName(state, fid)} bought ${units} ${what} for ${gold} gold.` : `${factionName(state, fid)} sold ${units} ${what} for ${gold} gold.`,
  });
  return next;
}

/**
 * Applies one non-END_TURN action for the active faction. Returns the same state object when the
 * action is illegal.
 */
export function step(state: GameState, action: GameAction): GameState {
  if (action.type === 'END_TURN') return state;
  if (explain(state, action) !== null) return state;
  switch (action.type) {
    case 'ATTACK': return attack(state, action);
    case 'RECRUIT': return recruit(state, action);
    case 'BUILD': return build(state, action);
    case 'UPGRADE': return upgrade(state, action);
    case 'MOVE': return move(state, action);
    case 'RESEARCH': return research(state, action);
    case 'ANNEX': return annex(state, action);
    case 'SPY': return spy(state, action);
    case 'CEASEFIRE': return ceasefire(state, action);
    case 'CHOICE': return choice(state, action);
    case 'TRADE': return trade(state, action);
    default: return state;
  }
}
