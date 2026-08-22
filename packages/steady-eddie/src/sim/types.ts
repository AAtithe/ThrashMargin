/**
 * Steady Eddie — core types.
 *
 * Forked from The Tea Race's engine (see steady-eddie-design.md), re-themed from a clipper trading
 * race to UK haulage. The whole simulation is pure: `processAction(state, action) -> state`.
 * Nothing here reads the clock or calls Math.random — every random draw goes through `sim/rng.ts`
 * against the seed persisted in `GameState.rngSeed`, so a game replays identically from its seed.
 * That is what makes `scripts/drive.ts` a real test rather than a smoke check.
 */

export type DepotId = string;
export type GoodId = string;
export type HaulierId = string;
export type VehicleId = string;
export type ContractId = string;

// ---------------------------------------------------------------------------
// Static content (loaded from src/content/*.json by sim/content.ts)
// ---------------------------------------------------------------------------

export type LabelSide = 'n' | 's' | 'e' | 'w';

export interface Depot {
  id: DepotId;
  name: string;
  region: string;
  /** Real WGS84. Screen position is derived from these by sim/geography.ts, never authored. */
  lon: number;
  lat: number;
  /** Optional post-projection [dx, dy] nudge, purely for chart legibility. */
  nudge?: [number, number];
  labelSide: LabelSide;
  /** Exactly one depot is the home depot — every haulier starts there. */
  home?: boolean;
  supplies: GoodId[];
  demands: GoodId[];
}

export interface Good {
  id: GoodId;
  name: string;
  /** Purchase price at any supplying depot; the figure the 4x/2x payout multiplies. */
  basePrice: number;
  colour: string;
}

export interface RoadLeg {
  a: DepotId;
  b: DepotId;
  /** Drive points. A 2d6 roll averages 7 — see legs.json's $comment for the miles-per-point scale. */
  distance: number;
  /**
   * How fog/snow/flood-prone this road is, 1 to 3. Absent means clear.
   *
   * Authored rather than derived: the Pennine crossings and the Somerset Levels are dangerous for
   * reasons of terrain and drainage, not a formula over coordinates.
   */
  weatherRisk?: number;
  /**
   * How theft-prone this route is, 1 to 3. Absent means safe.
   *
   * Authored the same way — a handful of real freight-crime corridors (motorway services on the
   * Kent and M1 approaches, isolated stretches north of Newcastle), not derived from anything.
   */
  theft?: number;
}

// ---------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------

export interface CargoLot {
  good: GoodId;
  /** What was actually paid. Payouts are multiples of this, not of the current base price. */
  paid: number;
  boughtAt: DepotId;
  boughtOnTurn: number;
}

export interface Run {
  /** Depots still to touch, in order. The last entry is the destination. */
  route: DepotId[];
  /** Where the current leg (towards route[0]) started. */
  legFrom: DepotId;
  /** Drive points still owed on the current leg. */
  legRemaining: number;
  /** Total drive points for the current leg, so the UI can draw progress. */
  legDistance: number;
}

export interface VehicleFittings {
  /** Cuts the chance of a theft encounter, and turns most losses into a recovered load. */
  tracker?: boolean;
  /** Cuts a weather delay's setback, and adds a point of speed always — a well-kept rig loses less time. */
  aeroKit?: boolean;
}

export interface Vehicle {
  id: VehicleId;
  ownerId: HaulierId;
  name: string;
  /** The depot it is parked at. Null exactly when `run` is set. */
  location: DepotId | null;
  run: Run | null;
  /**
   * The load bed: up to `slotsOf(vehicleClass)` lots, one good per slot.
   *
   * Three slots, not one — carried over from The Tea Race, where that single fact turned a run from
   * a there-and-back errand into a routing puzzle: load three things, plan the drops, and decide how
   * much of the load bed to gamble on speculation rather than a named contract.
   */
  hold: CargoLot[];
  /**
   * Which vehicle class she is. Optional, and absent means the default 7.5-tonner, so every vehicle
   * in a save written before classes existed keeps exactly the behaviour she had.
   */
  vehicleClass?: import('./rules').VehicleClassId;
  /**
   * Permanent fittings. Optional so that a save written before hazards existed loads untouched —
   * the same reason every other field added by the hazards work is optional.
   */
  fittings?: VehicleFittings;
  /**
   * A standing open insurance policy. Set once and every run she makes is covered, with the
   * premium taken at dispatch. Deliberately not a per-dispatch prompt: a checkbox you set once is a
   * decision, a modal on every dispatch is a chore.
   */
  insured?: boolean;
}

export type AiProfile = 'racer' | 'speculator' | 'financier';

export interface Haulier {
  id: HaulierId;
  name: string;
  kind: 'human' | 'ai';
  colour: string;
  cash: number;
  shares: number;
  /**
   * Wages owed and not yet paid. Optional, absent meaning none, so a save from before standing costs
   * existed loads untouched.
   *
   * There is no bankruptcy in this game and inventing one would need a whole resolution path nothing
   * else needs, so a haulier who cannot meet the wage bill pays what they have and falls into
   * arrears. Arrears are settled ahead of anything else the moment money comes in, which is a
   * harsher constraint than it sounds: it means a broke haulier's next delivery is not theirs.
   */
  arrears?: number;
  /** Outstanding principal borrowed against the fleet. */
  debt?: number;
  /**
   * Shares held in the other haulage firms. Investments only — the ten shares of this haulier's own
   * company are `shares` above, and remain the only route to a win.
   */
  holdings?: Partial<Record<import('./stocks').StockId, number>>;
  aiProfile?: AiProfile;
  /**
   * How well this computer haulier plays, overriding the table default in `GameState.difficulty`.
   *
   * Per haulier rather than only per table because that is the only way to measure the dial at all:
   * with one setting shared by everyone, every seat is handicapped identically and the win rates just
   * report seat order. Seating one level against another is what shows whether the difficulty does
   * anything.
   */
  aiLevel?: import('./rules').Difficulty;
}

export interface ContractFill {
  haulierId: HaulierId;
  /** 1 pays four times the purchase price, 2 pays twice. There is no rank 3. */
  rank: 1 | 2;
  paid: number;
  onTurn: number;
}

/**
 * A posted contract: a good, the depot that wants it, and the price it is reckoned at.
 *
 * **No source depot.** A card names the buyer, not the seller — load the good at any depot that
 * stocks it. Tomatoes bought at Southampton fill a "Tesco RDC, Ashford" card for the full 4x just
 * as tomatoes bought anywhere else that stocks them would. There is no source lock to find here —
 * The Tea Race shipped one by accident (a card that only *read* as naming a source) and fixed it;
 * Steady Eddie starts from that fix rather than re-discovering the bug.
 *
 * Sourcing is therefore a decision — where is it cheapest to reach, and which rival is nearer —
 * rather than a lookup.
 */
export interface Contract {
  id: ContractId;
  /**
   * The round this card was posted. Optional, absent meaning it predates the clock, in which case it
   * simply never expires — a save from before deadlines existed keeps its board.
   */
  postedOn?: number;
  good: GoodId;
  destination: DepotId;
  price: number;
  fills: ContractFill[];
}

export interface Hazards {
  /** Road & weather: fog, snow and flooding cost time on the legs authored for it, worse in season. */
  weather: boolean;
  /** Load theft on the corridors authored for it, with recoveries, losses and insurance. */
  theft: boolean;
  /** The world event deck — strikes, low-emission bans, gluts, shortages, DVSA bounties. */
  events?: boolean;
  /** Hostile bids: buy a share off anyone at an escalating premium, whatever your own holding. */
  hostileBids?: boolean;
  /** Depot sales: offload unwanted cargo at a loss rather than dumping it for nothing. */
  depotSales?: boolean;
  /** Driver wages and diesel, charged every round against every vehicle on the road. */
  wages?: boolean;
  /** Borrowing against the fleet, at interest. */
  loans?: boolean;
  /** Contracts expire, and cargo loses value the longer it is carried. */
  deadlines?: boolean;
  /** Three vehicle classes to choose between when buying, rather than one repeated. */
  vehicleClasses?: boolean;
  /** The haulage exchange: rival firms whose shares move with the trade through their regions. */
  stocks?: boolean;
}

/** The kinds of thing the world does to everybody at once. See sim/events.ts. */
export type WorldEventKind = 'strike' | 'embargo' | 'glut' | 'shortage' | 'bounty';

/**
 * One piece of news in force. Always carries the last round it applies to, so no draw can put the
 * game somewhere it cannot get out of.
 */
export interface WorldEvent {
  id: number;
  kind: WorldEventKind;
  /** The depot shut, for a strike. */
  depot?: DepotId;
  /** The commodity affected, for everything else. */
  good?: GoodId;
  from: number;
  /** Inclusive: the event is in force while `round <= until`. */
  until: number;
  headline: string;
  detail: string;
}

export interface Declaration {
  haulierId: HaulierId;
  declaredOnRound: number;
  /**
   * Counts down by one on every individual turn, not once per table round — see
   * DECLARATION_TURNS in rules.ts for why that reading is both shorter and more faithful.
   */
  turnsRemaining: number;
}

export type LogKind =
  | 'roll'
  | 'drive'
  | 'arrive'
  | 'delay'
  | 'theft'
  | 'insurance'
  | 'fitting'
  | 'season'
  | 'buy'
  | 'deliver'
  | 'missed'
  | 'vehicle'
  | 'share'
  | 'declare'
  | 'lapse'
  | 'victory'
  | 'contract'
  | 'event'
  | 'wages'
  | 'stock';

export interface LogEntry {
  /**
   * Monotonic across the whole game. The log is trimmed to LOG_LIMIT from the front, so an index
   * into `log` is not a stable identity — anything tracking "entries I have already seen" (the
   * driver's audit, React keys, a Chronicle panel's scroll position) must key on this.
   */
  seq: number;
  turn: number;
  round: number;
  haulierId: HaulierId | null;
  kind: LogKind;
  text: string;
  /**
   * Structured facts behind the prose, for anything that needs the numbers rather than the
   * sentence — the driver audits payouts from here, and the UI can render a rank badge without
   * parsing English. Optional: most entries carry nothing but their text.
   *
   * This matters for deliveries in particular. Filling a card for the second time and dealing its
   * replacement happen inside a single action, so no observer watching state between actions can
   * ever catch a card holding two fills. The log is the only place that moment is recorded.
   */
  data?: Record<string, string | number>;
}

export type TurnPhase =
  /** The active haulier must roll for the day's miles before doing anything else. */
  | 'roll'
  /** Rolled; may drive, trade and invest until they end the turn. */
  | 'act'
  /** Hotseat only: the device must be passed before the next haulier's turn begins. */
  | 'handover'
  | 'over';

export interface GameState {
  id: string;
  name: string;
  /**
   * Ruleset discriminator, kept for structural parity with The Tea Race's save-shape validator
   * (`isCurrentShape` in `useGameLocal.ts`) even though only one ruleset exists today. A
   * continuous "free haulage" mode, the Steady Eddie equivalent of Niccolo/Tea Race's deferred
   * continuous-play ideas, is deliberately not built — see steady-eddie-design.md before starting it.
   */
  rules: 'standard';
  /**
   * Which hazards this game plays with. Optional, and **absent means off** — so a save written
   * before hazards existed keeps playing the pure core rules, and the faithful-versus-authored line
   * in the design doc stays honest. New games default both on.
   */
  hazards?: Hazards;
  /**
   * World events in force. Optional and **absent means none** — a save written before the event deck
   * existed keeps playing without one. Pruned at the top of each round.
   */
  events?: WorldEvent[];
  /** Monotonic counter behind WorldEvent.id. */
  nextEventSeq?: number;
  /** Current price of each company on the haulage exchange. */
  stockPrices?: Partial<Record<import('./stocks').StockId, number>>;
  /** Loads landed in each company's regions since prices last moved. */
  stockVolume?: Partial<Record<import('./stocks').StockId, number>>;
  /** The last few event kinds dealt, newest first, so the deck does not repeat itself. */
  recentEvents?: WorldEventKind[];
  /**
   * Hostile bids made so far, by anyone. Drives the escalating price, and it is global rather than
   * per-haulier on purpose: that is what bounds the total and keeps the game finishing.
   */
  hostileBids?: number;
  /**
   * How well the computer hauliers play. Optional, absent meaning 'steady', so a save from before
   * difficulty existed keeps exactly the opponents it had.
   */
  difficulty?: import('./rules').Difficulty;
  /** ms epoch, stamped by the caller. The sim itself never reads a clock. */
  createdAt: number;
  rngSeed: number;

  /** Full table rounds started, 1-based. */
  round: number;
  /** Total individual turns taken across all hauliers, monotonic. */
  turn: number;
  activeIndex: number;
  phase: TurnPhase;

  hauliers: Haulier[];
  vehicles: Vehicle[];

  /** Always FACE_UP_CONTRACTS long while the game is live. */
  contracts: Contract[];
  /** Remaining draw pile, as compact "good|destination" keys. */
  deck: string[];
  /** Monotonic counter behind contract ids, so ids stay unique across reshuffles. */
  nextContractSeq: number;
  /** Monotonic counter behind vehicle ids. */
  nextVehicleSeq: number;
  /** Monotonic counter behind LogEntry.seq. */
  nextLogSeq: number;

  sharesRemaining: number;
  declaration: Declaration | null;
  winnerId: HaulierId | null;

  /** Miles rolled this turn, per vehicle. Cleared when the turn ends. */
  miles: Record<VehicleId, number>;
  /** The two dice behind each entry in `miles`, so the UI can show them. */
  dice: Record<VehicleId, [number, number]>;

  log: LogEntry[];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type GameAction =
  /**
   * Rolls 2d6 of miles for every vehicle the active haulier owns, and immediately advances the ones
   * already on the road — a vehicle mid-journey has no decision to make, so making the player click
   * for it would be pure ceremony. Parked vehicles keep their points for a DRIVE_TO this turn.
   */
  | { type: 'ROLL' }
  /**
   * Plot a course from a parked vehicle and spend this turn's points on it in one go. `via` is the
   * exact path to take, so a player who chose the longer route to dodge a risky leg actually gets it.
   */
  | { type: 'DRIVE_TO'; vehicleId: VehicleId; destination: DepotId; via?: DepotId[] }
  | { type: 'BUY_CARGO'; vehicleId: VehicleId; good: GoodId }
  /** Lands every slot matching the contract, and is paid per unit. */
  | { type: 'DELIVER'; vehicleId: VehicleId; contractId: ContractId }
  /**
   * Dumped at the roadside. Recovers **nothing** — dumping forfeits the whole purchase price.
   * Omit `good` to clear the entire load bed.
   */
  | { type: 'DUMP'; vehicleId: VehicleId; good?: GoodId }
  /**
   * Sell a lot off the vehicle at the depot it's parked at, at a merchant's price. The toggleable
   * alternative to dumping it for nothing.
   */
  | { type: 'SELL_CARGO'; vehicleId: VehicleId; good: GoodId }
  | { type: 'BUY_VEHICLE'; vehicleClass?: import('./rules').VehicleClassId }
  /** Fit a tracker or an aero kit to a parked vehicle, permanently. */
  | { type: 'BUY_FITTING'; vehicleId: VehicleId; fitting: keyof VehicleFittings }
  /** Open or close a vehicle's standing insurance policy. */
  | { type: 'SET_INSURANCE'; vehicleId: VehicleId; insured: boolean }
  /** Buy or sell shares in one of the other haulage firms, at the current price. */
  | { type: 'BUY_STOCK'; stock: import('./stocks').StockId; lots?: number }
  | { type: 'SELL_STOCK'; stock: import('./stocks').StockId; lots?: number }
  /** Draw down another LOAN_STEP against the fleet. */
  | { type: 'TAKE_LOAN' }
  /** Pay down the debt, as much as the haulier can afford up to one step. */
  | { type: 'REPAY_LOAN' }
  | { type: 'BUY_SHARE' }
  /** Sell a share back to the bank at half price — the way out of having no working capital. */
  | { type: 'SELL_SHARE' }
  /**
   * Buy a share off a named haulier at a premium, whatever your own holding. The way back in for a
   * haulier who has fallen behind — see `canHostileBid` in rules.ts.
   */
  | { type: 'HOSTILE_BID'; targetId: HaulierId }
  | { type: 'DECLARE' }
  | { type: 'END_TURN' }
  | { type: 'ACKNOWLEDGE_HANDOVER' };
