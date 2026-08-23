import { CITIES, findCity } from './content';
import { cargoValue } from './insurance';
import { AI_PROFILES, aiNetWorth, createAiTrader, resolveAiWeek, seedHomeKnowledge } from './aiTrader';
import { warehousesValue } from './warehouse';
import { resaleValue } from './shipyard';
import type { AiTradeNote, AiTrader, GameState, MarketScarcity, ActiveMarketEvent } from './types';

/**
 * Free-play mode (`freeplay-and-trading-design.md` Part 1, built as Phase 27).
 *
 * The same simulation with the scripted layer switched off: no chapter events, no objectives, no
 * chapter freeze, the whole map open from week one, and one to three rival houses actually trading
 * against the player. Everything else — couriers and report latency, credit, grades, warehousing,
 * market events, voyage risk, sabotage, the household and its wages — runs exactly as it does in the
 * campaign, because it *is* the campaign's code.
 *
 * **Difficulty here is information, never cheating.** The three profiles differ in capital, hull
 * size and `reportLagWeeks` and in nothing else. A rival never reads a live price it has not
 * reached, never ignores travel time, and — since Phase 27 threaded the demand layer and
 * `sellProceeds` through `resolveAiWeek` — never transacts at a price the player could not also
 * get. That is what makes courier investment a real edge over an opponent rather than only over the
 * map, and it is why one dial produces the whole difficulty curve with no special cases.
 */

export type RivalCount = 0 | 1 | 2 | 3;

/** Which profile each successive rival takes, and where it sits. Home ports are spread across the
 * map on purpose: three rivals all starting at Bruges would fight over one market and explore the
 * same direction, which reads as one opponent with three hulls. */
const RIVAL_SEATS: { key: keyof typeof AI_PROFILES; id: string; name: string; homeCity: string }[] = [
  { key: 'steady', id: 'rival_venice', name: 'The Grimani of Venice', homeCity: 'venice' },
  { key: 'ruthless', id: 'rival_genoa', name: 'The Doria consortium', homeCity: 'genoa' },
  { key: 'cautious', id: 'rival_london', name: 'The Hanse factory at London', homeCity: 'london' },
];

export function createRivals(count: RivalCount, scarcity: MarketScarcity, events?: ActiveMarketEvent[]): AiTrader[] {
  return RIVAL_SEATS.slice(0, count).map(seat =>
    seedHomeKnowledge(
      createAiTrader({ ...AI_PROFILES[seat.key], id: seat.id, name: seat.name, homeCity: seat.homeCity }),
      scarcity,
      0,
      events,
    ),
  );
}

/**
 * The win condition: **first house to `FREEPLAY_TARGET_NET_WORTH` florins.**
 *
 * Chosen from the three the spec offers because it is the only one that is legible at every moment
 * of play — "highest at a fixed year" hides who is winning until the end, and "last house solvent"
 * rewards sitting still, which is the opposite of what a trading sandbox should reward. A target
 * makes the standings panel meaningful from week one.
 *
 * The figure is ~7x the ruthless rival's starting capital and ~200x the player's, so it is several
 * in-game years of compounding rather than a lucky run.
 */
export const FREEPLAY_TARGET_NET_WORTH = 8000;

/**
 * **On showing a net-worth figure at all.** `banco-di-niccolo-design.md` §11 and Phase 15 both
 * rejected an ambient wealth readout, because a permanently visible number in the story campaign
 * becomes a de facto score and quietly undermines "no scripted victory" — and Phase 25 deferred the
 * real figure to the epilogue, after the campaign is over and can no longer be optimised against.
 *
 * Free play is a different context, not a reversal of that call. Here the standings *are* the game:
 * an explicitly competitive sandbox with a stated target, where hiding the score would make the
 * mode unplayable rather than principled. The campaign's rule is untouched — `mode === 'freeplay'`
 * gates every one of these readouts, and a campaign save has no `aiTraders` to stand against.
 */
export function playerNetWorth(state: GameState): number {
  let total = Math.max(0, state.cash);
  for (const v of state.vessels) {
    total += cargoValue(state.scarcity, v.cargo, v.location, state.marketEvents);
  }
  total += warehousesValue(state);
  // Hulls count, at what the yard would actually pay. Without this, converting cash into a carrack
  // reads as a 520f loss in the standings, which would make the mode punish fleet growth — and the
  // rival side counts its hulls the same way, so the comparison stays honest.
  for (const v of state.vessels) total += resaleValue(v);
  for (const o of state.obligations) {
    if (o.settled) continue;
    // Deliberately florin-face-value rather than `toFlorins`: the standings must be comparable
    // week to week, and a receivable's worth wobbling with the exchange-rate drift would move the
    // score without anybody trading. The epilogue's reckoning, which is taken once, does convert.
    total += o.direction === 'payable' ? -o.amount : o.amount;
  }
  return Math.round(total);
}

export interface Standing {
  id: string;
  name: string;
  netWorth: number;
  isPlayer: boolean;
}

/** The whole table, richest first. Ties break on name so the order never flickers between renders. */
export function standings(state: GameState): Standing[] {
  const rows: Standing[] = [
    { id: 'player', name: state.name?.trim() || 'Your house', netWorth: playerNetWorth(state), isPlayer: true },
    ...(state.aiTraders ?? []).map(t => ({
      id: t.id,
      name: t.name,
      netWorth: aiNetWorth(t, state.scarcity, state.marketEvents),
      isPlayer: false,
    })),
  ];
  return rows.sort((a, b) => b.netWorth - a.netWorth || a.name.localeCompare(b.name));
}

export interface FreeplayResolution {
  aiTraders: AiTrader[];
  scarcity: MarketScarcity;
  notes: AiTradeNote[];
}

/**
 * Runs every rival's week, threading `scarcity` through each in turn.
 *
 * **In turn, not in parallel.** Each rival sees the market the previous one has just left, so two
 * rivals dumping the same good into the same port really do crowd each other — the second gets the
 * worse price. Resolving them all against one snapshot would let an arbitrary number of traders sell
 * into a market at its untouched price, which is the same snapshot mistake Phase 26 found in
 * `sellGood`, one level up.
 *
 * Returns unchanged input when there are no rivals, so a campaign save costs nothing here.
 */
export function resolveFreeplayWeek(state: GameState, week: number): FreeplayResolution {
  const traders = state.aiTraders ?? [];
  if (traders.length === 0) return { aiTraders: traders, scarcity: state.scarcity, notes: [] };

  let scarcity = state.scarcity;
  const out: AiTrader[] = [];
  const notes: AiTradeNote[] = [];
  for (const trader of traders) {
    const result = resolveAiWeek(trader, scarcity, week, state.marketEvents);
    scarcity = result.scarcity;
    out.push(result.trader);
    notes.push(...result.notes);
  }
  return { aiTraders: out, scarcity, notes };
}

/** Every city, for a mode with no chapters to unlock them. Used by the free-play map so a sandbox
 * player is not gated behind story content that will never fire. */
export function freeplayCityIds(): string[] {
  return CITIES.filter(c => c.market && Object.keys(c.market).length > 0).map(c => c.id);
}

export interface WinCheck {
  /** Who has crossed the line, richest first — usually empty, occasionally one, rarely several. */
  winners: Standing[];
  playerWon: boolean;
}

/**
 * Has anybody reached the target?
 *
 * **Deliberately does not stop the clock.** A campaign ends because its story has ended; a sandbox
 * has no story to end, and freezing a free-play game the week a rival crosses the line would take
 * the board away mid-game — including from a player who is 200f behind and about to pass them. So
 * this records the week the target was first reached (`freeplayWonWeek`) and the UI announces it;
 * play continues for anyone who wants to keep going. That also means the standings stay honest
 * afterwards rather than frozen at the moment of the announcement.
 */
export function checkFreeplayWin(state: GameState): WinCheck {
  const table = standings(state);
  const winners = table.filter(r => r.netWorth >= FREEPLAY_TARGET_NET_WORTH);
  return { winners, playerWon: winners.some(r => r.isPlayer) };
}

/** Where a free-play player starts. Named so the lobby copy and the sim cannot disagree. */
export const FREEPLAY_START_CASH = 400;
export const FREEPLAY_HOME_CITY = 'bruges';

export function isFreeplay(state: GameState): boolean {
  return state.mode === 'freeplay';
}

/** The rival's home port, for the standings panel — a rival with no vessels left has none. */
export function rivalSeat(traderId: string): string | null {
  const seat = RIVAL_SEATS.find(s => s.id === traderId);
  return seat ? findCity(seat.homeCity)?.name ?? seat.homeCity : null;
}

/**
 * Chance per week, per agent placed inside a rival, that the agent gets a lie into that rival's
 * books. Set just above the 15% insider-secret roll a house agent gets: a rival's price cache is a
 * softer target than the secret a masked company guards hardest.
 */
const RIVAL_PLANT_CHANCE_PER_WEEK = 0.18;

/** How far a planted price is bent. Deliberately both directions — a lie that only ever said
 * "cheaper than it is" would be a single predictable trick, and half the value of a false report is
 * making a rival sail somewhere worthless. */
const PLANT_LOW = 0.45;
const PLANT_HIGH = 1.9;

export interface RivalPlantResolution {
  aiTraders: AiTrader[];
  plant: { week: number; traderName: string; cityName: string; agentName: string } | null;
}

/**
 * Runs every ADVANCE_WEEK: an agent inside a rival feeds its counting house a false price
 * (design doc §6, "can plant false news" — the last verb in that section, deferred since Phase 8).
 *
 * **The mirror of what the hostile houses already do to the player.** `corruptNews` distorts the
 * player's incoming reports; this distorts a rival's. §3's information pillar is supposed to cut
 * both ways, and until now it only cut one.
 *
 * **It does not break the fairness model, and it interacts with it beautifully.** The rival still
 * never reads a price it has not reached and still never trades at a price the player could not get
 * — it is simply *wrong* about one, exactly as the player is wrong when a house plants on them. And
 * because `refreshAiKnowledge` overwrites a memory once it is older than `reportLagWeeks`, **a lie
 * washes out of a sharper opponent's books sooner**: the plant is stamped with the current week so
 * it survives its full lag, which means it lasts 2 weeks against the ruthless profile and 6 against
 * the cautious one. The harder rival is harder to deceive, for the same reason it is harder to beat.
 * That is the difficulty dial doing the work in a third place, without a special case.
 *
 * One lie per week at most, like `resolveHouseSabotage` and the voyage-risk roll — a week where
 * three agents all land at once would read as a bug.
 */
export function resolveWeeklyRivalPlants(state: GameState, week: number): RivalPlantResolution {
  const traders = state.aiTraders ?? [];
  if (traders.length === 0) return { aiTraders: traders, plant: null };

  const planted = state.agents.filter(a => a.placement.type === 'rival');
  if (planted.length === 0) return { aiTraders: traders, plant: null };

  for (const agent of planted) {
    const placement = agent.placement;
    if (placement.type !== 'rival') continue;
    if (Math.random() >= RIVAL_PLANT_CHANCE_PER_WEEK) continue;

    const trader = traders.find(t => t.id === placement.traderId);
    if (!trader) continue;

    // Only a market the rival actually has an opinion about can be lied to it about — you cannot
    // corrupt a report that was never going to arrive. Its home port is excluded: the rival is
    // standing in that market and would see the truth out of its own window, which is exactly the
    // rule `corruptNews` applies to the player's own home city.
    const home = trader.vessels[0]?.location;
    const candidates = Object.keys(trader.remembered).filter(c => c !== home);
    if (candidates.length === 0) continue;

    const cityId = candidates[Math.floor(Math.random() * candidates.length)];
    const entry = trader.remembered[cityId];
    const goods = Object.keys(entry.prices);
    if (goods.length === 0) continue;

    const prices: Record<string, number> = {};
    for (const goodId of goods) {
      const factor = Math.random() < 0.5 ? PLANT_LOW : PLANT_HIGH;
      prices[goodId] = Math.max(1, Math.round(entry.prices[goodId] * factor));
    }

    const index = traders.indexOf(trader);
    const next = [...traders];
    // Stamped with the current week on purpose: an entry that still looked stale would be refreshed
    // to the truth on this very tick. Stamping it fresh is what makes the lie last exactly as long
    // as that rival's own report lag, and no longer.
    next[index] = { ...trader, remembered: { ...trader.remembered, [cityId]: { week, prices } } };
    return {
      aiTraders: next,
      plant: {
        week,
        traderName: trader.name,
        cityName: findCity(cityId)?.name ?? cityId,
        agentName: agent.name,
      },
    };
  }

  return { aiTraders: traders, plant: null };
}
