import { HOUSES, findCity, findHouse } from './content';
import { addSecret } from './secrets';
import { adjustScarcity, cargoTotal } from './market';
import type {
  Agent,
  AgentPlacement,
  GameState,
  House,
  HouseTradeNote,
  MarketScarcity,
  NewsItem,
  PriceCauseNote,
  SabotageLossEvent,
  Secret,
  Vessel,
} from './types';

/** A hotseat player's manual choice for their one house's weekly trade nudge (Phase 14),
 * replacing that house's own random good/direction pick — every other house still rolls. */
export interface ManualTradeChoice {
  houseId: string;
  goodId: string;
  direction: 1 | -1;
}

/** A hotseat player's manual choice for their one house's weekly news-planting attempt (Phase 14).
 * `targetCityId: null` means they chose not to plant this week. */
export interface ManualPlantChoice {
  houseId: string;
  targetCityId: string | null;
}

/** A hotseat player's manual choice for their one house's weekly sabotage attempt (Phase 14). */
export interface ManualSabotageChoice {
  houseId: string;
  attempt: boolean;
}

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
 * relation keeps drifting, just toward a worse floor. Madeira (Chapter 4, Phase 13) is a second,
 * independent souring of the same vendetta — a commercial collision, not a violent one, so it
 * stacks with (rather than replaces) first blood's own penalty: two separate grudges the house
 * has given St Pol, not one bigger version of the first. */
const STPOL_FIRST_BLOOD_BASELINE_PENALTY = 20;
const STPOL_MADEIRA_COLLISION_BASELINE_PENALTY = 10;

function baselineFor(house: House, flags: Record<string, boolean>): number {
  if (house.id !== 'stpol') return house.baselineRelation;
  let penalty = 0;
  if (flags.stpol_first_blood) penalty += STPOL_FIRST_BLOOD_BASELINE_PENALTY;
  if (flags.stpol_madeira_collision) penalty += STPOL_MADEIRA_COLLISION_BASELINE_PENALTY;
  return clamp(house.baselineRelation - penalty, 0, 100);
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

export interface HouseTradeFootprintResult {
  scarcity: MarketScarcity;
  /** Every house's own trade this week, one per house that has a market at its home city — fed
   * into `sim/market.ts`'s `deriveMarketCauses` (Phase 16) so a price move caused by a specific
   * rival house can be named as such, rather than folded into a vaguer "unknown flows" note. */
  trades: HouseTradeNote[];
}

export function applyHouseTradeFootprint(scarcity: MarketScarcity, manual?: ManualTradeChoice): HouseTradeFootprintResult {
  let next = scarcity;
  const trades: HouseTradeNote[] = [];
  for (const house of HOUSES) {
    const city = findCity(house.homeCity);
    if (!city?.market) continue;
    const goodIds = Object.keys(city.market);
    if (goodIds.length === 0) continue;
    let goodId: string;
    let direction: 1 | -1;
    if (manual && house.id === manual.houseId) {
      goodId = manual.goodId;
      direction = manual.direction;
    } else {
      goodId = goodIds[Math.floor(Math.random() * goodIds.length)];
      direction = Math.random() < 0.5 ? 1 : -1;
    }
    next = adjustScarcity(next, house.homeCity, goodId, direction * HOUSE_TRADE_UNITS);
    trades.push({ houseId: house.id, houseName: house.name, cityId: house.homeCity, goodId, direction });
  }
  return { scarcity: next, trades };
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

export function corruptNews(
  news: NewsItem[],
  agents: Agent[],
  homeCityId: string,
  manual?: ManualPlantChoice,
): NewsItem[] {
  const hostile = HOUSES.filter(h => h.disposition === 'hostile');
  if (hostile.length === 0) return news;
  // The hotseat house's own chance is a manual pick, not a roll — every other hostile house
  // still rolls independently, exactly as before.
  const aiHostile = manual ? hostile.filter(h => h.id !== manual.houseId) : hostile;

  return news.map(item => {
    if (item.cityId === homeCityId) return item;
    if (cityIsShielded(agents, item.cityId)) return item;
    const manualHit = !!manual && manual.targetCityId === item.cityId;
    const aiHit = aiHostile.some(() => Math.random() < PLANT_CHANCE_PER_HOSTILE_HOUSE);
    const targeted = manualHit || aiHit;
    if (!targeted) return item;

    const prices: Record<string, number> = {};
    // One fabricated cause per distorted good, not one for "the" price — corruptNews already
    // distorts every good in the targeted report independently, so a single note would leave
    // most of them unexplained (or, worse, still carrying their real cause) while the price next
    // to them is fake. Every fabricated note uses 'unknown_flows' specifically: it's the one kind
    // that never names a checkable specifics (no house, no "settling back" claim), so a corrected
    // report's causes read exactly like a true 'unknown_flows' note would — there's still no tell.
    const causes: PriceCauseNote[] = [];
    for (const [goodId, price] of Object.entries(item.prices)) {
      const distortion =
        PLANT_PRICE_DISTORTION_MIN + Math.random() * (PLANT_PRICE_DISTORTION_MAX - PLANT_PRICE_DISTORTION_MIN);
      const distorted = Math.max(1, Math.round(price * distortion));
      prices[goodId] = distorted;
      causes.push({ goodId, kind: 'unknown_flows', direction: distorted >= price ? 1 : -1 });
    }
    return { ...item, prices, causes };
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
  /** Full detail of the loss, for the UI to report — mirrors `VoyageLossEvent`'s own reasoning:
   * this happens silently inside ADVANCE_WEEK with no other feedback channel, and a vessel simply
   * sitting docked losing cargo with no visible explanation reads as a bug, not a hostile house. */
  event?: SabotageLossEvent;
}

export function resolveHouseSabotage(
  vessels: Vessel[],
  week: number,
  manual?: ManualSabotageChoice,
): SabotageResolution {
  const hostileHouses = HOUSES.filter(h => h.disposition === 'hostile');
  const hostileHomes = new Map(hostileHouses.map(h => [h.homeCity, h]));
  if (hostileHomes.size === 0) return { vessels, sabotaged: false };

  const target = vessels.find(
    v => !v.destination && hostileHomes.has(v.location) && cargoTotal(v.cargo) > 0,
  );
  if (!target) return { vessels, sabotaged: false };
  const targetHouse = hostileHomes.get(target.location)!;
  const attempts =
    manual && manual.houseId === targetHouse.id ? manual.attempt : Math.random() < SABOTAGE_CHANCE_PER_WEEK;
  if (!attempts) return { vessels, sabotaged: false };

  const goodIds = Object.keys(target.cargo).filter(id => (target.cargo[id] ?? 0) > 0);
  if (goodIds.length === 0) return { vessels, sabotaged: false };
  const goodId = goodIds[Math.floor(Math.random() * goodIds.length)];
  const held = target.cargo[goodId];
  const lost = Math.max(1, Math.floor(held * SABOTAGE_LOSS_FRACTION));
  const house = targetHouse;

  return {
    vessels: vessels.map(v => (v.id === target.id ? { ...v, cargo: { ...v.cargo, [goodId]: held - lost } } : v)),
    sabotaged: true,
    event: {
      week,
      vesselId: target.id,
      vesselName: target.name,
      goodId,
      quantityLost: lost,
      cityId: target.location,
      houseName: house.name,
    },
  };
}
