/**
 * The turn cycle, and `processAction`, the single entry point for every action.
 *
 * Factions take turns in id order. Ending a turn pays that faction's income and feeds its troops,
 * then plays every AI faction in order until the next human's turn begins (or the game ends). A
 * round is complete when play wraps back to the lowest living id; `turn` counts rounds.
 */
import { explain, step } from './actions';
import { playAiTurn } from './ai';
import { drawEvent } from './events';
import { factionName, incomeOf, troopsOf } from './rules';
import { apFor, emptyReport } from './state';
import type { FactionId, GameAction, GameState, HistoryEntry, TurnEvent } from './types';
import { addLog, checkAchievements, checkVictory } from './victory';

function endFactionTurn(state: GameState, fid: FactionId): GameState {
  const f = state.factions[fid];
  if (!f || f.eliminated) return state;
  const inc = incomeOf(state, fid);
  const r = f.resources;
  const resources = {
    gold: r.gold + inc.gold,
    food: r.food + inc.foodNet,
    mat: r.mat + inc.mat,
    influence: r.influence + inc.influence,
    population: r.population + inc.population,
  };

  // Starvation: each missing unit of food costs a troop, taken from the largest garrison first
  // (ties to the lowest id). Deterministic, so nobody's capital empties on a coin flip.
  let nodes = state.nodes;
  let starved = 0;
  if (resources.food < 0) {
    let deficit = -resources.food;
    if (f.research.includes('granaries')) deficit = Math.ceil(deficit / 2);
    resources.food = 0;
    nodes = state.nodes.map(n => ({ ...n }));
    while (deficit-- > 0) {
      let pick: number | null = null;
      for (const n of nodes) if (n.owner === fid && n.troops > 0 && (pick === null || n.troops > nodes[pick].troops)) pick = n.id;
      if (pick === null) break;
      nodes[pick].troops -= 1;
      starved++;
    }
  }

  let next: GameState = {
    ...state,
    nodes,
    factions: { ...state.factions, [fid]: { ...f, resources, stats: { ...f.stats, starved: f.stats.starved + starved } } },
  };

  if (f.human) {
    const report = emptyReport(fid, state.turn);
    report.income = { gold: inc.gold, food: inc.food, mat: inc.mat, influence: inc.influence, population: inc.population, upkeep: inc.upkeep, starved };
    next = { ...next, reports: { ...next.reports, [fid]: report } };
    const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    next = addLog(next, {
      faction: fid, kind: 'economy',
      message: `${factionName(next, fid)} collected ${sign(inc.gold)} gold, ${sign(inc.mat)} materials and ${sign(inc.foodNet)} food after ${inc.upkeep} upkeep.${starved ? ` ${starved} troops starved.` : ''}`,
    });
  } else if (starved) {
    next = addLog(next, { faction: fid, kind: 'economy', message: `${factionName(next, fid)} lost ${starved} troops to hunger.` });
  }

  // History: one row per round, one column per faction, written as each faction finishes.
  const snap = { territories: next.nodes.filter(n => n.owner === fid).length, troops: troopsOf(next, fid), gold: resources.gold };
  const history = next.history.slice();
  const last = history[history.length - 1];
  if (last && last.turn === state.turn) history[history.length - 1] = { ...last, factions: { ...last.factions, [fid]: snap } };
  else history.push({ turn: state.turn, factions: { [fid]: snap } } as HistoryEntry);
  next = { ...next, history };

  return checkVictory(next, fid);
}

function tickCeasefires(state: GameState): GameState {
  const factions = { ...state.factions };
  for (const f of Object.values(factions)) {
    const cf: Record<number, number> = {};
    for (const [k, v] of Object.entries(f.ceasefires)) if (v > 1) cf[Number(k)] = v - 1;
    factions[f.id] = { ...f, ceasefires: cf };
  }
  return { ...state, factions };
}

function startFactionTurn(state: GameState, fid: FactionId): GameState {
  const f = state.factions[fid];
  const revealed: Record<number, number> = {};
  for (const [k, v] of Object.entries(f.revealed)) if (v >= state.turn) revealed[Number(k)] = v;
  let next: GameState = {
    ...state,
    activeFaction: fid,
    factions: { ...state.factions, [fid]: { ...f, revealed, traded: { food: 0, mat: 0 } } },
  };
  next = { ...next, actionsLeft: apFor(next, fid) };
  if (!f.human) return next;

  next = { ...next, lastEvent: null };
  if (!next.config.enableEvents || next.turn < 2) return next;

  const draw = drawEvent(next.rngSeed, next.turn);
  next = { ...next, rngSeed: draw.seed };
  const def = draw.event;
  if (def.choices) {
    return addLog({
      ...next,
      pendingEvent: {
        id: def.id, faction: fid, title: def.title, tone: def.tone, text: def.text,
        choices: def.choices.map(c => ({ label: c.label, desc: c.desc, ...(c.cost ? { cost: c.cost } : {}) })),
      },
    }, { faction: fid, kind: 'event', message: `${def.title}: a decision awaits.` });
  }
  const applied = def.apply!(next, fid, next.rngSeed);
  const event: TurnEvent = { id: def.id, title: def.title, message: applied.message, tone: def.tone };
  next = { ...applied.state, rngSeed: applied.seed, lastEvent: event };
  const report = next.reports[fid];
  if (report) next = { ...next, reports: { ...next.reports, [fid]: { ...report, event } } };
  if (def.id !== 'calm') next = addLog(next, { faction: fid, kind: 'event', message: `${def.title}: ${applied.message}` });
  return next;
}

function nextFaction(state: GameState, after: FactionId): { id: FactionId; wrapped: boolean } | null {
  const ids = Object.values(state.factions).filter(f => !f.eliminated).map(f => f.id).sort((a, b) => a - b);
  if (!ids.length) return null;
  const later = ids.find(id => id > after);
  return later !== undefined ? { id: later, wrapped: false } : { id: ids[0], wrapped: true };
}

function endTurn(state: GameState): GameState {
  let s = endFactionTurn(state, state.activeFaction);
  // At most one full lap: every AI faction once, then back to a human.
  for (let i = 0; i < 8 && s.status === 'active'; i++) {
    const nf = nextFaction(s, s.activeFaction);
    if (!nf) break;
    if (nf.wrapped) s = tickCeasefires({ ...s, turn: s.turn + 1 });
    s = startFactionTurn(s, nf.id);
    if (s.factions[nf.id].human) break;
    s = playAiTurn(s);
    if (s.status !== 'active') break;
    s = endFactionTurn(s, nf.id);
  }
  return s;
}

/** The single entry point. Returns the same state object when the action is illegal. */
export function processAction(state: GameState, action: GameAction): GameState {
  if (action.type === 'END_TURN') {
    if (explain(state, action) !== null) return state;
    return checkAchievements(endTurn(state));
  }
  const next = step(state, action);
  return next === state ? state : checkAchievements(next);
}


