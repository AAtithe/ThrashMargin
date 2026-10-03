/**
 * Elimination, victory and achievements: the checks that run after anything that can change who
 * holds what.
 */
import { ACHIEVEMENTS } from './achievements';
import { DIFFICULTY, TECH_BRANCHES } from './content';
import { factionName } from './rules';
import type { FactionId, GameState, LogEntry, TechBranch, VictoryType } from './types';
import { NEUTRAL, PLAYER } from './types';

export const LOG_LIMIT = 250;

export function addLog(state: GameState, entry: Omit<LogEntry, 'turn'> & { turn?: number }): GameState {
  const e: LogEntry = { turn: entry.turn ?? state.turn, faction: entry.faction, kind: entry.kind, message: entry.message };
  return { ...state, log: [e, ...state.log].slice(0, LOG_LIMIT) };
}

/** Sends a line to every human's dispatch except `except`'s (they watched it happen). */
export function addHeadline(state: GameState, text: string, except?: FactionId): GameState {
  const reports = { ...state.reports };
  for (const f of Object.values(state.factions)) {
    if (!f.human || f.id === except || !reports[f.id]) continue;
    reports[f.id] = { ...reports[f.id], headlines: [...reports[f.id].headlines, text] };
  }
  return { ...state, reports };
}

/** Marks factions with no territory left as eliminated, and clears their treaties. */
export function checkEliminations(state: GameState, by?: FactionId): GameState {
  let next = state;
  for (const f of Object.values(state.factions)) {
    if (f.eliminated || state.nodes.some(n => n.owner === f.id)) continue;
    const factions = { ...next.factions };
    factions[f.id] = { ...f, eliminated: true, eliminatedOnTurn: state.turn, ceasefires: {} };
    for (const other of Object.values(factions)) {
      if (other.ceasefires[f.id] === undefined) continue;
      const cf = { ...other.ceasefires };
      delete cf[f.id];
      factions[other.id] = { ...other, ceasefires: cf };
    }
    next = { ...next, factions };
    const who = by !== undefined && by !== NEUTRAL ? ` by ${factionName(next, by)}` : '';
    const text = `${factionName(next, f.id)} has been wiped from the map${who}.`;
    next = addLog(next, { faction: f.id, kind: 'capture', message: text });
    next = addHeadline(next, text, by);
  }
  return next;
}

/**
 * Gold a faction must hold at the end of its own turn to win economically. AI factions earn more
 * than humans on the harder difficulties, so their target scales by the same factor: the race is
 * the same number of turns of effort for everyone, not a gift to whoever has the multiplier.
 */
export function economicTarget(state: GameState, faction: FactionId): number {
  const f = state.factions[faction];
  const mult = f && !f.human ? DIFFICULTY[state.config.diff].incomeMult : 1;
  return Math.round(state.config.altVictoryGold * mult);
}

function finish(state: GameState, winner: FactionId, type: VictoryType, branch?: TechBranch): GameState {
  const human = state.factions[winner]?.human ?? false;
  const how = type === 'conquest' ? 'by conquest' : type === 'economic' ? 'by economic dominance' : `by mastering ${branch} research`;
  const next: GameState = {
    ...state,
    status: human ? 'victory' : 'defeated',
    winner,
    victoryType: type,
    ...(branch ? { researchBranch: branch } : {}),
  };
  return addLog(next, { faction: winner, kind: 'system', message: `${factionName(state, winner)} wins ${how}.` });
}

/**
 * Conquest: one faction left standing. Defeat: no human left standing (in single player, the
 * moment faction 1 falls). Alternative victories: a branch completed, or the gold threshold held
 * at the end of a faction's own turn (`atEndOf`).
 */
export function checkVictory(state: GameState, atEndOf?: FactionId): GameState {
  if (state.status !== 'active') return state;
  const alive = Object.values(state.factions).filter(f => !f.eliminated);
  const humansAlive = alive.filter(f => f.human);
  if (alive.length === 1) return finish(state, alive[0].id, 'conquest');
  if (!humansAlive.length) {
    const leader = alive.sort((a, b) => state.nodes.filter(n => n.owner === b.id).length - state.nodes.filter(n => n.owner === a.id).length)[0];
    return { ...finish(state, leader?.id ?? NEUTRAL, 'conquest'), status: 'defeated' };
  }
  if (state.config.enableAltVictory) {
    if (state.config.enableTechTree) {
      for (const f of alive) {
        for (const [branch, ids] of Object.entries(TECH_BRANCHES) as Array<[TechBranch, string[]]>) {
          if (ids.every(id => f.research.includes(id))) return finish(state, f.id, 'research', branch);
        }
      }
    }
    if (atEndOf !== undefined) {
      const f = state.factions[atEndOf];
      if (f && !f.eliminated && f.resources.gold >= economicTarget(state, f.id)) return finish(state, f.id, 'economic');
    }
  }
  return state;
}

export function checkAchievements(state: GameState): GameState {
  if (!state.factions[PLAYER]) return state;
  const have = new Set(state.achievements);
  const fresh = ACHIEVEMENTS.filter(a => !have.has(a.id) && a.check(state));
  if (!fresh.length) return state;
  let next: GameState = { ...state, achievements: [...state.achievements, ...fresh.map(a => a.id)] };
  for (const a of fresh) next = addLog(next, { faction: PLAYER, kind: 'achievement', message: `Achievement: ${a.name}. ${a.desc}` });
  return next;
}
