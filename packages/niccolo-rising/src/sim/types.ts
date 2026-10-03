/**
 * Niccolò Rising's state and action shapes.
 *
 * Everything here is plain JSON: the whole GameState is persisted as one document in the `games`
 * table, so no Maps, no class instances, no functions. Times are epoch milliseconds supplied by the
 * caller (see the purity note in `actions.ts`).
 */

export type BarId = 'energy' | 'nerve' | 'spirits' | 'health';
export type BattleStat = 'strength' | 'defence' | 'speed' | 'dexterity';
export type WorkStat = 'craft' | 'wit' | 'stamina';

export const BAR_IDS: readonly BarId[] = ['energy', 'nerve', 'spirits', 'health'];
export const BATTLE_STATS: readonly BattleStat[] = ['strength', 'defence', 'speed', 'dexterity'];
export const WORK_STATS: readonly WorkStat[] = ['craft', 'wit', 'stamina'];

/**
 * A regenerating bar. `max` is not stored: it is derived from level, lodging and so on (`bars.ts`),
 * so it can never disagree with the things it depends on.
 *
 * `anchor` is the time the next regeneration tick counts from. While a bar is at or above its
 * maximum the anchor is meaningless and left alone; spending from a full bar resets it to the
 * moment of spending, so the first tick lands one full period later, as it should.
 */
export interface Bar {
  cur: number;
  anchor: number;
}

export type Status =
  | { kind: 'free' }
  | { kind: 'infirmary'; until: number; reason: string }
  | { kind: 'steen'; until: number; reason: string }
  | { kind: 'travelling'; to: string; departs: number; arrives: number }
  | { kind: 'abroad'; city: string };

export interface JobState {
  id: string;
  rank: number;
  /** When the current job was taken. Paydays fall at whole days after this. */
  since: number;
  /** Paydays already paid out since `since`. */
  paidDays: number;
}

export interface Deposit {
  amount: number;
  pct: number;
  matures: number;
}

export interface LogEntry {
  seq: number;
  at: number;
  text: string;
  tone: 'good' | 'bad' | 'neutral' | 'honour';
}

export interface FightReport {
  opponentId: string;
  at: number;
  outcome: 'won' | 'lost' | 'stalemate';
  lines: string[];
}

export interface GameState {
  /** Schema discriminator, checked by the local save loader. */
  rules: 'rising-1';
  id: string;
  name: string;
  createdAt: number;
  rngSeed: number;
  /**
   * Fixed at creation and never advanced. The Waterhalle's daily prices hash against this rather
   * than `rngSeed`, which moves with every roll: otherwise a scheme attempted at noon would change
   * the price of silk at noon.
   */
  marketSeed: number;
  /** Time of the latest accepted action. Never moves backwards. */
  clock: number;

  level: number;
  xp: number;
  standing: number;
  groats: number;

  bars: Record<BarId, Bar>;
  battle: Record<BattleStat, number>;
  work: Record<WorkStat, number>;
  /** Scheme skill. Fractional internally; shown floored. */
  schemeSkill: number;

  status: Status;
  job: JobState | null;
  course: { id: string; ends: number } | null;
  coursesDone: string[];
  deposit: Deposit | null;

  /** Item id to quantity held. Equipped items are not counted here. */
  inventory: Record<string, number>;
  equipped: { weapon: string | null; armour: string | null };
  lodgings: string[];
  yards: string[];

  /** Items bought abroad on the current trip, against the carry limit. Reset on departure. */
  tripBought: number;
  /**
   * Abroad markets that have been bought from since their last restock. A city absent from this
   * record has full stock, so an untouched market costs nothing to store or to restock.
   */
  abroad: Record<string, { since: number; sold: Record<string, number> }>;
  /** Opponent id to the time they can be fought again. */
  opponents: Record<string, number>;

  honours: string[];
  /**
   * The story spine (Phase 5). One mission active at a time. `progress` holds a running count for
   * each counting objective (schemes, duels, training, arrivals) since the mission was accepted;
   * holding objectives (an item, a course, a level) are read live and their slot stays 0.
   */
  missions: {
    active: { id: string; accepted: number; deadline: number | null; progress: number[] } | null;
    done: string[];
  };
  counters: { schemes: number; schemesWon: number; duelsWon: number; duelsLost: number; voyages: number };
  lastFight: FightReport | null;

  log: LogEntry[];
  nextLogSeq: number;
}

/** Every action carries the time it happened. The reducer never reads a clock of its own. */
export type GameAction =
  | { type: 'TICK'; at: number }
  | { type: 'BUY_YARD'; at: number; yardId: string }
  | { type: 'TRAIN'; at: number; yardId: string; stat: BattleStat; times: number }
  | { type: 'SCHEME'; at: number; schemeId: string }
  | { type: 'JOIN_JOB'; at: number; jobId: string }
  | { type: 'LEAVE_JOB'; at: number }
  | { type: 'PROMOTE'; at: number }
  | { type: 'ENROL'; at: number; courseId: string }
  | { type: 'TRAVEL'; at: number; to: string }
  | { type: 'BUY_ABROAD'; at: number; itemId: string; qty: number }
  | { type: 'BUY'; at: number; itemId: string; qty: number }
  | { type: 'SELL'; at: number; itemId: string; qty: number }
  | { type: 'USE_ITEM'; at: number; itemId: string }
  | { type: 'EQUIP'; at: number; itemId: string }
  | { type: 'UNEQUIP'; at: number; slot: 'weapon' | 'armour' }
  | { type: 'BUY_LODGING'; at: number; lodgingId: string }
  | { type: 'DUEL'; at: number; opponentId: string }
  | { type: 'DEPOSIT'; at: number; amount: number; days: number }
  | { type: 'BRIBE'; at: number }
  | { type: 'ACCEPT_MISSION'; at: number; missionId: string }
  | { type: 'COMPLETE_MISSION'; at: number }
  | { type: 'ABANDON_MISSION'; at: number };

// ---------------------------------------------------------------------------------------------
// Content shapes (the JSON files in src/content)
// ---------------------------------------------------------------------------------------------

export interface Config {
  startGroats: number;
  startCity: string;
  bars: {
    energy: { max: number; tickMinutes: number; perTick: number };
    nerve: { baseMax: number; perTwoLevels: number; cap: number; tickMinutes: number; perTick: number };
    spirits: { tickMinutes: number; perTick: number };
    health: { baseMax: number; perLevel: number; tickMinutes: number; pctPerTick: number };
  };
  duel: { energyCost: number; maxRounds: number; opponentRecoveryMinutes: number };
  levels: { xpBase: number; xpGrowth: number; maxLevel: number };
  steen: { bribePerLevel: number; bribeBase: number };
  carryBase: number;
  restockMinutes: number;
  spiritsDrainPerEnergy: number;
  bank: { terms: { days: number; pct: number }[]; minDeposit: number };
  dailyMarketSwing: number;
}

export interface Yard {
  id: string;
  name: string;
  minLevel: number;
  energy: number;
  dots: number;
  cost: number;
  blurb: string;
}

export interface Scheme {
  id: string;
  name: string;
  nerve: number;
  difficulty: number;
  groats: [number, number];
  xp: number;
  blurb: string;
  requiresCourse?: string;
  /** Probability, given a failure, of being taken to the Steen; and for how long. */
  caught: { chance: number; minutes: number };
  /** Probability, given a failure that was not caught, of being hurt; and for how long. */
  hurt: { chance: number; minutes: number };
}

export interface JobRank {
  name: string;
  pay: number;
  req: Record<WorkStat, number>;
  gains: Record<WorkStat, number>;
}

export interface Job {
  id: string;
  name: string;
  blurb: string;
  ranks: JobRank[];
}

export interface Perks {
  gymPct?: number;
  schemePct?: number;
  travelPct?: number;
  carry?: number;
  infirmaryPct?: number;
  steenPct?: number;
  payPct?: number;
  /** One-off additions to working stats, granted on completion. */
  workGains?: Partial<Record<WorkStat, number>>;
  /** One-off additions to battle stats, granted on completion. */
  battle?: Partial<Record<BattleStat, number>>;
}

export interface Course {
  id: string;
  name: string;
  hours: number;
  cost: number;
  requires?: string;
  blurb: string;
  perks: Perks;
  /** Display only: what completing the course opens up. */
  unlocks?: string;
}

export interface ItemEffect {
  energy?: number;
  nerve?: number;
  spirits?: number;
  health?: number;
  /** Minutes taken off an Infirmary stay. */
  infirmaryMinutes?: number;
}

export interface Item {
  id: string;
  name: string;
  kind: 'consumable' | 'weapon' | 'armour' | 'kit' | 'trade';
  /** Price in the Bruges shops. Zero means not sold there. */
  price: number;
  /** What the Waterhalle pays. Trade goods move about this day to day. */
  value: number;
  blurb: string;
  effect?: ItemEffect;
  damage?: number;
  accuracy?: number;
  armour?: number;
  carry?: number;
}

export interface Destination {
  id: string;
  name: string;
  minutes: number;
  fare: number;
  blurb: string;
  requiresCourse?: string;
  market: { item: string; cost: number; stock: number }[];
}

export interface Lodging {
  id: string;
  name: string;
  cost: number;
  spiritsMax: number;
  blurb: string;
}

export interface Opponent {
  id: string;
  name: string;
  level: number;
  stats: Record<BattleStat, number>;
  health: number;
  weapon: number;
  armour: number;
  groats: [number, number];
  xp: number;
  blurb: string;
}

export interface Honour {
  id: string;
  name: string;
  text: string;
}

/**
 * What a mission asks for. Counting objectives (scheme, duel, train, arrive) count only what happens
 * after the mission is accepted. Holding objectives (deliver, pay, course, job, level, work) are
 * checked at the moment of completion; deliver and pay are consumed by it.
 */
export type Objective =
  | { kind: 'scheme'; schemeId?: string; count: number }
  | { kind: 'duel'; opponentId?: string; count: number }
  | { kind: 'train'; amount: number; stat?: BattleStat }
  | { kind: 'arrive'; city: string }
  | { kind: 'deliver'; itemId: string; qty: number }
  | { kind: 'pay'; groats: number }
  | { kind: 'course'; courseId: string }
  | { kind: 'job'; jobId: string; rank: number }
  | { kind: 'level'; level: number }
  | { kind: 'work'; stat: WorkStat; value: number };

export interface MissionReward {
  groats?: number;
  xp?: number;
  standing?: number;
  items?: Record<string, number>;
  lodging?: string;
  honour?: string;
  /** A scripted consequence: the story puts the player in the Infirmary for this long. */
  infirmaryMinutes?: number;
}

export interface Mission {
  id: string;
  title: string;
  giver: string;
  /** The mission that must be completed first. Absent for the first in the chain. */
  after?: string;
  minLevel: number;
  /** Real hours to complete once accepted. Absent means no deadline. */
  hours?: number;
  brief: string;
  done: string;
  objectives: Objective[];
  reward: MissionReward;
}

/** Something that happened, as missions count it. Emitted by the reducer, consumed by `missions.ts`. */
export type MissionEvent =
  | { kind: 'scheme'; schemeId: string }
  | { kind: 'duel'; opponentId: string }
  | { kind: 'train'; stat: BattleStat; gain: number }
  | { kind: 'arrive'; city: string };
