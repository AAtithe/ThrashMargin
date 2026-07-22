import { HOUSES, findCity, findHouse } from './content';
import { addSecret } from './secrets';
import { adjustScarcity, cargoTotal } from './market';
import type { Agent, AgentPlacement, GameState, House, MarketScarcity, NewsItem, Secret, Vessel } from './types';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function initialHouseRelations(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of HOUSES) out[h.id] = h.baselineRelation;
  return out;
}

/** Fraction of the gap to a house's baseline that closes each week — the same mean-reversion
 * shape already used for exchange rates and market scarcity, not a fresh invented mechanic. */
const RELATION_DRIFT_RATE = 0.05;
/** Once blood is actually drawn (design doc §8's vendetta track), St Pol's own baseline sours —
 * relation keeps drifting, just toward a worse floor. */
const STPOL_FIRST_BLOOD_BASELINE_PENALTY = 20;

function baselineFor(house: House, flags: Record<string, boolean>): number {
  if (house.id === 'stpol' && flags.stpol_first_blood) {
    return clamp(house.baselineRelation - STPOL_FIRST_BLOOD_BASELINE_PENALTY, 0, 100);
  }
  return house.baselineRelation;
}

export function driftHouseRelations(
  relations: Record<string, number>,
  flags: Record<string, boolean>,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const house of HOUSES) {
    const current = relations[house.id] ?? house.baselineRelation;
    const target = baselineFor(house, flags);
    next[house.id] = current + (target - current) * RELATION_DRIFT_RATE;
  }
  return next;
}

/** A house's own trade, as far as the player can observe it: a small weekly nudge to its home
 * city's scarcity, exactly like a player's own buy/sell would produce, reusing `adjustScarcity`'s
 * existing quantity semantics rather than inventing a parallel price-delta mechanism. This is the
 * "reduced fidelity" trade design doc §10 asks for — houses are not full second players with
 * their own cargo and ledgers. */
const HOUSE_TRADE_UNITS = 2;
export function applyHouseTradeFootprint(scarcity: MarketScarcity): MarketScarcity {
  let next = scarcity;
  for (const house of HOUSES) {
    const city = findCity(house.homeCity);
    if (!city?.market) continue;
    const goodIds = Object.keys(city.market);
    if (goodIds.length === 0) continue;
    const goodId = goodIds[Math.floor(Math.random() * goodIds.length)];
    const direction = Math.random() < 0.5 ? 1 : -1;
    next = adjustScarcity(next, house.homeCity, goodId, direction * HOUSE_TRADE_UNITS);
  }
  return next;
}

export const AGENT_BASE_COST = 25;

/** Each successive agent costs more to place and run — the same escalating-cost shape courier
 * investment already uses for the same reason (an early, cheap network shouldn't stay cheap forever). */
export function agentPlacementCost(existingAgents: Agent[]): number {
  return AGENT_BASE_COST * (existingAgents.length + 1);
}

let nextAgentSeq = 0;
function agentId(): string {
  nextAgentSeq += 1;
  return `agent_${nextAgentSeq}_${Math.random().toString(36).slice(2, 8)}`;
}

export function placeAgent(state: GameState, placement: AgentPlacement, name?: string): GameState {
  if (placement.type === 'city' && !findCity(placement.cityId)) {
    throw new Error(`No such city: ${placement.cityId}`);
  }
  if (placement.type === 'house' && !findHouse(placement.houseId)) {
    throw new Error(`No such house: ${placement.houseId}`);
  }
  const cost = agentPlacementCost(state.agents);
  if (cost > state.cash) throw new Error(`Not enough cash (need ${cost}, have ${Math.round(state.cash)})`);

  const agent: Agent = {
    id: agentId(),
    name: name?.trim() || 'An unnamed agent',
    placement,
    placedWeek: state.week,
  };

  return { ...state, cash: state.cash - cost, agents: [...state.agents, agent] };
}

export function cityIsShielded(agents: Agent[], cityId: string): boolean {
  return agents.some(a => a.placement.type === 'city' && a.placement.cityId === cityId);
}

export function agentsInHouse(agents: Agent[], houseId: string): Agent[] {
  return agents.filter(a => a.placement.type === 'house' && a.placement.houseId === houseId);
}

/** Chance per week a hostile house plants a false report in a city the player has no agent
 * shielding, rather than the truth ("some incoming news is planted", design doc §6). The player
 * has no way to tell — a planted report reads exactly like a true one until corrected by a later
 * arrival or a physical visit, which is the entire point. Bruges is never targeted: it's home,
 * and the design doc already treats first-hand knowledge there as absolute (see news.ts). */
const PLANT_CHANCE_PER_HOSTILE_HOUSE = 0.12;
const PLANT_PRICE_DISTORTION_MIN = 0.5;
const PLANT_PRICE_DISTORTION_MAX = 1.8;

export function corruptNews(news: NewsItem[], agents: Agent[], homeCityId: string): NewsItem[] {
  const hostile = HOUSES.filter(h => h.disposition === 'hostile');
  if (hostile.length === 0) return news;

  return news.map(item => {
    if (item.cityId === homeCityId) return item;
    if (cityIsShielded(agents, item.cityId)) return item;
    const targeted = hostile.some(() => Math.random() < PLANT_CHANCE_PER_HOSTILE_HOUSE);
    if (!targeted) return item;

    const prices: Record<string, number> = {};
    for (const [goodId, price] of Object.entries(item.prices)) {
      const distortion =
        PLANT_PRICE_DISTORTION_MIN + Math.random() * (PLANT_PRICE_DISTORTION_MAX - PLANT_PRICE_DISTORTION_MIN);
      prices[goodId] = Math.max(1, Math.round(price * distortion));
    }
    return { ...item, prices };
  });
}

/** A player agent placed inside a house has a weekly chance of surfacing that house's one piece
 * of insider knowledge as a Secret, reusing Phase 7's Secret system rather than inventing a
 * second one. Each house's insider secret can only ever be surfaced once. */
const AGENT_SECRET_CHANCE_PER_WEEK = 0.15;

export function resolveWeeklyAgentIntelligence(
  agents: Agent[],
  secrets: Secret[],
  week: number,
): Secret[] {
  let next = secrets;
  for (const house of HOUSES) {
    if (!house.insiderSecret) continue;
    if (agentsInHouse(agents, house.id).length === 0) continue;
    if (next.some(s => s.id === house.insiderSecret!.id)) continue;
    if (Math.random() < AGENT_SECRET_CHANCE_PER_WEEK) {
      next = addSecret(next, week, house.insiderSecret);
    }
  }
  return next;
}

/**
 * Doria's "sabotage" (design doc §10/Chapter 2): a hostile house with a home city the player's
 * own vessels actually visit can, some weeks, cost a docked vessel part of one cargo good — spoilage,
 * a bribed customs man, a fouled cask, left to the player's imagination. Reduced-fidelity, same as
 * every other house behaviour here: no named crew, no combat, just a number moving. Any hostile
 * house with cargo docked at its own home city can trigger this, not only Doria by name, so a
 * future chapter's hostile house gets it for free.
 */
const SABOTAGE_CHANCE_PER_WEEK = 0.15;
const SABOTAGE_LOSS_FRACTION = 0.3;

export interface SabotageResolution {
  vessels: Vessel[];
  /** True if some vessel was hit this week — content can react to this via a flag the caller sets. */
  sabotaged: boolean;
}

export function resolveHouseSabotage(vessels: Vessel[]): SabotageResolution {
  const hostileHomes = new Set(HOUSES.filter(h => h.disposition === 'hostile').map(h => h.homeCity));
  if (hostileHomes.size === 0) return { vessels, sabotaged: false };

  const target = vessels.find(
    v => !v.destination && hostileHomes.has(v.location) && cargoTotal(v.cargo) > 0,
  );
  if (!target || Math.random() >= SABOTAGE_CHANCE_PER_WEEK) return { vessels, sabotaged: false };

  const goodIds = Object.keys(target.cargo).filter(id => (target.cargo[id] ?? 0) > 0);
  if (goodIds.length === 0) return { vessels, sabotaged: false };
  const goodId = goodIds[Math.floor(Math.random() * goodIds.length)];
  const held = target.cargo[goodId];
  const lost = Math.max(1, Math.floor(held * SABOTAGE_LOSS_FRACTION));

  return {
    vessels: vessels.map(v => (v.id === target.id ? { ...v, cargo: { ...v.cargo, [goodId]: held - lost } } : v)),
    sabotaged: true,
  };
}
