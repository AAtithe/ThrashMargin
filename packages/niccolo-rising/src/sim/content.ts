/**
 * Typed access to the JSON content, and the derived numbers every other module reads: bar maxima,
 * perks, carrying capacity, level thresholds and the Waterhalle's prices.
 *
 * Content lives in data files so the world can be edited without touching logic. Everything here is
 * a pure function of content and state.
 */
import configJson from '../content/config.json';
import yardsJson from '../content/yards.json';
import schemesJson from '../content/schemes.json';
import jobsJson from '../content/jobs.json';
import coursesJson from '../content/courses.json';
import itemsJson from '../content/items.json';
import destinationsJson from '../content/destinations.json';
import lodgingJson from '../content/lodging.json';
import opponentsJson from '../content/opponents.json';
import honoursJson from '../content/honours.json';
import housesJson from '../content/houses.json';
import type {
  BarId,
  Config,
  Course,
  Destination,
  GameState,
  Honour,
  House,
  HouseContract,
  HouseRank,
  Item,
  Job,
  Lodging,
  Opponent,
  Perks,
  Scheme,
  Yard,
} from './types';

export const CONFIG = configJson as Config;
export const YARDS = yardsJson as Yard[];
export const SCHEMES = schemesJson as Scheme[];
export const JOBS = jobsJson as Job[];
export const COURSES = coursesJson as Course[];
export const ITEMS = itemsJson as Item[];
export const DESTINATIONS = destinationsJson as Destination[];
export const LODGINGS = lodgingJson as Lodging[];
export const OPPONENTS = opponentsJson as Opponent[];
export const HONOURS = honoursJson as Honour[];
export const HOUSES = housesJson as House[];

function index<T extends { id: string }>(list: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const x of list) out[x.id] = x;
  return out;
}

export const YARD = index(YARDS);
export const SCHEME = index(SCHEMES);
export const JOB = index(JOBS);
export const COURSE = index(COURSES);
export const ITEM = index(ITEMS);
export const DESTINATION = index(DESTINATIONS);
export const LODGING = index(LODGINGS);
export const OPPONENT = index(OPPONENTS);
export const HONOUR = index(HONOURS);
export const HOUSE = index(HOUSES);

/** Every house contract by id, with the house that offers it. Contract ids are unique across houses. */
export const CONTRACT: Record<string, { house: House; contract: HouseContract }> = {};
for (const house of HOUSES) for (const contract of house.contracts) CONTRACT[contract.id] = { house, contract };

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------------------------
// Perks
// ---------------------------------------------------------------------------------------------

export interface PerkTotals {
  gymPct: number;
  schemePct: number;
  travelPct: number;
  carry: number;
  infirmaryPct: number;
  steenPct: number;
  payPct: number;
  depositPct: number;
  abroadPct: number;
}

/** The rank a house's favour has earned: the highest whose threshold it meets. */
export function houseRankIndex(house: House, favour: number): number {
  let r = 0;
  house.ranks.forEach((rank, i) => {
    if (favour >= rank.favour) r = i;
  });
  return r;
}

/** The player's house, its current rank and that rank's index, or null outside every house. */
export function houseOf(s: GameState): { house: House; rank: HouseRank; index: number } | null {
  const h = s.house ? HOUSE[s.house.id] : null;
  if (!h || !s.house) return null;
  const index = houseRankIndex(h, s.house.favour);
  return { house: h, rank: h.ranks[index], index };
}

/**
 * Sum of every completed course's standing perks and the house rank's perks. One-off grants
 * (workGains, battle) excluded. House perks are the rank's totals, not added up rank by rank.
 */
export function perks(s: GameState): PerkTotals {
  const t: PerkTotals = { gymPct: 0, schemePct: 0, travelPct: 0, carry: 0, infirmaryPct: 0, steenPct: 0, payPct: 0, depositPct: 0, abroadPct: 0 };
  const sources: Perks[] = s.coursesDone.map(id => COURSE[id]?.perks ?? {});
  const h = houseOf(s);
  if (h) sources.push(h.rank.perks);
  for (const p of sources) {
    t.gymPct += p.gymPct ?? 0;
    t.schemePct += p.schemePct ?? 0;
    t.travelPct += p.travelPct ?? 0;
    t.carry += p.carry ?? 0;
    t.infirmaryPct += p.infirmaryPct ?? 0;
    t.steenPct += p.steenPct ?? 0;
    t.payPct += p.payPct ?? 0;
    t.depositPct += p.depositPct ?? 0;
    t.abroadPct += p.abroadPct ?? 0;
  }
  return t;
}

/** What one of an abroad market's goods costs this player, after a Doria discount. */
export function abroadPrice(s: GameState, baseCost: number): number {
  return Math.max(1, Math.round(baseCost * (1 - Math.min(50, perks(s).abroadPct) / 100)));
}

/** The chain multiplier a win at this chain length earns: the highest tier reached. */
export function chainMult(count: number): number {
  let m = 1;
  for (const tier of CONFIG.house.chainTiers) if (count >= tier.count) m = tier.mult;
  return m;
}

/** Items that can be brought home from one trip abroad. Kit stacks: a satchel and a mule both count. */
export function carryCapacity(s: GameState): number {
  let kit = 0;
  for (const [id, qty] of Object.entries(s.inventory)) {
    const item = ITEM[id];
    if (item?.kind === 'kit' && qty > 0) kit += item.carry ?? 0;
  }
  return CONFIG.carryBase + perks(s).carry + kit;
}

// ---------------------------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------------------------

/** The best lodging owned is the one lived in. */
export function currentLodging(s: GameState): Lodging {
  let best = LODGINGS[0];
  for (const id of s.lodgings) {
    const l = LODGING[id];
    if (l && l.spiritsMax > best.spiritsMax) best = l;
  }
  return best;
}

export function barMax(s: GameState, bar: BarId): number {
  const b = CONFIG.bars;
  switch (bar) {
    case 'energy':
      return b.energy.max;
    case 'nerve':
      return Math.min(b.nerve.cap, b.nerve.baseMax + Math.floor((s.level - 1) / 2) * b.nerve.perTwoLevels);
    case 'spirits':
      return currentLodging(s).spiritsMax;
    case 'health':
      return b.health.baseMax + b.health.perLevel * (s.level - 1);
  }
}

export function barTick(s: GameState, bar: BarId): { ms: number; amount: number } {
  const b = CONFIG.bars;
  switch (bar) {
    case 'energy':
      return { ms: b.energy.tickMinutes * MINUTE, amount: b.energy.perTick };
    case 'nerve':
      return { ms: b.nerve.tickMinutes * MINUTE, amount: b.nerve.perTick };
    case 'spirits':
      return { ms: b.spirits.tickMinutes * MINUTE, amount: b.spirits.perTick };
    case 'health':
      return {
        ms: b.health.tickMinutes * MINUTE,
        amount: Math.max(1, Math.floor((barMax(s, 'health') * b.health.pctPerTick) / 100)),
      };
  }
}

// ---------------------------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------------------------

/** Experience needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  const l = CONFIG.levels;
  return Math.round(l.xpBase * Math.pow(l.xpGrowth, level - 1));
}

// ---------------------------------------------------------------------------------------------
// The Waterhalle
// ---------------------------------------------------------------------------------------------

/** 32-bit string-and-number hash. Pure, consumes no RNG, so viewing a price never changes a save. */
function hash(seed: number, text: string): number {
  let h = (seed ^ 2166136261) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * What the Waterhalle pays for one of an item today. Trade goods swing by up to ±half of
 * `dailyMarketSwing` around their value, fixed for a whole calendar day (UTC) per save, so the
 * player can choose which day to sell but not refresh their way to a better price.
 */
export function saleValue(s: GameState, itemId: string, at: number): number {
  const item = ITEM[itemId];
  if (!item) return 0;
  if (item.kind !== 'trade') return item.value;
  const day = Math.floor(at / DAY);
  const swing = CONFIG.dailyMarketSwing;
  const factor = 1 - swing / 2 + swing * hash(s.marketSeed, `${itemId}:${day}`);
  return Math.max(1, Math.round(item.value * factor));
}

/** Stock left today in an abroad market. */
export function abroadStock(s: GameState, cityId: string, itemId: string): number {
  const dest = DESTINATION[cityId];
  const line = dest?.market.find(m => m.item === itemId);
  if (!line) return 0;
  const sold = s.abroad[cityId]?.sold[itemId] ?? 0;
  return Math.max(0, line.stock - sold);
}

/** Ms of a journey from Bruges to `cityId` (or back), after Seamanship and the like. */
export function journeyMs(s: GameState, cityId: string): number {
  const dest = DESTINATION[cityId];
  if (!dest) return 0;
  const pct = Math.min(60, perks(s).travelPct);
  return Math.round(dest.minutes * MINUTE * (1 - pct / 100));
}

export function bribeCost(s: GameState): number {
  return CONFIG.steen.bribeBase + CONFIG.steen.bribePerLevel * s.level;
}

/** Chance a scheme succeeds, given the player's skill and perks. Clamped to [5%, 95%]. */
export function schemeChance(s: GameState, scheme: { difficulty: number }): number {
  const skill = s.schemeSkill + 10;
  const base = 0.25 + (0.75 * skill) / (skill + scheme.difficulty);
  const withPerk = base + perks(s).schemePct / 100;
  return Math.max(0.05, Math.min(0.95, withPerk));
}

/** Gain from one train of `stat` at a yard, before the stat changes. */
export function trainGain(s: GameState, yard: Yard, statValue: number, spirits: number): number {
  const spiritsFactor = 1 + Math.max(0, spirits) / 1500;
  const taper = 4 / (1 + Math.log10(1 + statValue / 50));
  return yard.dots * (yard.energy / 5) * spiritsFactor * taper * (1 + perks(s).gymPct / 100);
}

export function jobRank(s: GameState) {
  if (!s.job) return null;
  const job = JOB[s.job.id];
  return job ? { job, rank: job.ranks[s.job.rank] } : null;
}
