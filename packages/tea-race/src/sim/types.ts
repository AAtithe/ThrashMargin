/**
 * The Tea Race — core types.
 *
 * The whole simulation is pure: `processAction(state, action) -> state`. Nothing here reads the
 * clock or calls Math.random — every random draw goes through `sim/rng.ts` against the seed
 * persisted in `GameState.rngSeed`, so a game replays identically from its seed. That is what
 * makes `scripts/drive.ts` a real test rather than a smoke check.
 */

export type PortId = string;
export type GoodId = string;
export type CaptainId = string;
export type ShipId = string;
export type ContractId = string;

// ---------------------------------------------------------------------------
// Static content (loaded from src/content/*.json by sim/content.ts)
// ---------------------------------------------------------------------------

export type LabelSide = 'n' | 's' | 'e' | 'w';

export interface Port {
  id: PortId;
  name: string;
  region: string;
  /** Real WGS84. Screen position is derived from these by sim/geography.ts, never authored. */
  lon: number;
  lat: number;
  /** Optional post-projection [dx, dy] nudge, purely for chart legibility. */
  nudge?: [number, number];
  labelSide: LabelSide;
  /** Exactly one port is the home port — every captain starts there. */
  home?: boolean;
  supplies: GoodId[];
  demands: GoodId[];
}

export interface Good {
  id: GoodId;
  name: string;
  /** Purchase price at any supplying port; the figure the 4x/2x payout multiplies. */
  basePrice: number;
  colour: string;
}

export interface SeaLeg {
  a: PortId;
  b: PortId;
  /** Sail points. A 2d6 roll averages 7. */
  distance: number;
  /** Rounding one of the great capes. Named for the chart, and adds to the leg's storm rating. */
  cape?: string;
  /**
   * How piratical these waters are, 1 to 3. Absent means safe.
   *
   * Authored rather than derived, unlike the wind: piracy is a fact of history, not of latitude.
   * The Malacca approaches, the South China Sea, the Caribbean, the Barbary Mediterranean and the
   * Zanzibar runs are dangerous for reasons no formula over coordinates would find.
   */
  piracy?: number;
}

// ---------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------

export interface CargoLot {
  good: GoodId;
  /** What was actually paid. Payouts are multiples of this, not of the current base price. */
  paid: number;
  boughtAt: PortId;
  boughtOnTurn: number;
}

export interface Voyage {
  /** Ports still to touch, in order. The last entry is the destination. */
  route: PortId[];
  /** Where the current leg (towards route[0]) started. */
  legFrom: PortId;
  /** Sail points still owed on the current leg. */
  legRemaining: number;
  /** Total sail points for the current leg, so the UI can draw progress. */
  legDistance: number;
}

export interface ShipFittings {
  /** Cuts the chance of a piracy encounter, and turns most seizures into a ransom. */
  guns?: boolean;
  /** Cuts a storm's setback, and adds a point of speed always — coppered hulls fouled less. */
  copper?: boolean;
}

export interface Ship {
  id: ShipId;
  ownerId: CaptainId;
  name: string;
  /** The port it is tied up at. Null exactly when `voyage` is set. */
  location: PortId | null;
  voyage: Voyage | null;
  /**
   * The hold: up to HOLD_SLOTS lots, one good per slot.
   *
   * The real 1988 ship carries **three** slots, not one, and that single fact is what turns a
   * voyage from a there-and-back errand into a routing puzzle — load three things, plan the drops,
   * and decide how much of the hull to gamble on speculation. The source calls that last tension
   * the "speculation bottleneck": spec cargo locks up a third to two thirds of your capacity.
   */
  hold: CargoLot[];
  /**
   * Which hull she is. Optional, and absent means the 1988 clipper, so every ship in a save written
   * before classes existed keeps exactly the behaviour she had.
   */
  shipClass?: import('./rules').ShipClassId;
  /**
   * Permanent fittings. Optional so that a save written before hazards existed loads untouched —
   * the same reason every other field added by the hazards work is optional.
   */
  fittings?: ShipFittings;
  /**
   * A standing open insurance policy. Set once and every voyage she makes is covered, with the
   * premium taken at cast-off. Deliberately not a per-dispatch prompt: a checkbox you set once is a
   * decision, a modal on every dispatch is a chore.
   */
  insured?: boolean;
}

export type AiProfile = 'racer' | 'speculator' | 'financier';

export interface Captain {
  id: CaptainId;
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
   * else needs, so a captain who cannot meet the wage bill pays what they have and falls into
   * arrears. Arrears are settled ahead of anything else the moment money comes in, which is a
   * harsher constraint than it sounds: it means a broke captain's next delivery is not theirs.
   */
  arrears?: number;
  /** Outstanding principal borrowed against the fleet. */
  debt?: number;
  /**
   * Shares held in the other shipping companies. Investments only — the ten shares of this captain's
   * own company are `shares` above, and remain the only route to a win.
   */
  holdings?: Partial<Record<import('./stocks').StockId, number>>;
  aiProfile?: AiProfile;
  /**
   * How well this computer captain plays, overriding the table default in `GameState.difficulty`.
   *
   * Per captain rather than only per table because that is the only way to measure the dial at all:
   * with one setting shared by everyone, every seat is handicapped identically and the win rates just
   * report seat order. Seating one level against another is what shows whether the difficulty does
   * anything.
   */
  aiLevel?: import('./rules').Difficulty;
}

export interface ContractFill {
  captainId: CaptainId;
  /** 1 pays four times the purchase price, 2 pays twice. There is no rank 3. */
  rank: 1 | 2;
  paid: number;
  onTurn: number;
}

/**
 * A posted commission: a good, the port that wants it, and the price it is reckoned at.
 *
 * **No source port.** A card names the buyer, not the seller — load the good at any port that
 * stocks it. The reducer always worked this way (`doDeliver` only ever matched the good and the
 * destination), but the card used to *read* "Calcutta → Foochow", which everybody took as an
 * instruction. Opium bought at Bombay filled that card for the full 4x and always would have. The
 * label was the only lock, and the owner's recollection of the board game was right.
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
  destination: PortId;
  price: number;
  fills: ContractFill[];
}

export interface Hazards {
  /** Seasonal directional wind, and storms that cost time. */
  weather: boolean;
  /** Piracy in historically piratical waters, with ransoms, seizures and insurance. */
  piracy: boolean;
  /** The world event deck — strikes, embargoes, gluts, shortages, Admiralty bounties. */
  events?: boolean;
  /** Hostile bids: buy a share off anyone at an escalating premium, whatever your own holding. */
  hostileBids?: boolean;
  /** Quayside sales: offload unwanted cargo at a loss rather than dumping it for nothing. */
  quaysideSales?: boolean;
  /** Crew wages and victualling, charged every round against every ship afloat. */
  wages?: boolean;
  /** Borrowing against the fleet, at interest. */
  loans?: boolean;
  /** Commissions expire, and cargo loses value the longer it is carried. */
  deadlines?: boolean;
  /** Three hulls to choose between when buying, rather than one repeated. */
  shipClasses?: boolean;
  /** The shipping exchange: companies whose shares move with the trade in their waters. */
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
  /** The port shut, for a strike. */
  port?: PortId;
  /** The commodity affected, for everything else. */
  good?: GoodId;
  from: number;
  /** Inclusive: the event is in force while `round <= until`. */
  until: number;
  headline: string;
  detail: string;
}

export interface Declaration {
  captainId: CaptainId;
  declaredOnRound: number;
  /**
   * Counts down by one on every individual turn, not once per table round — see
   * DECLARATION_TURNS in rules.ts for why that reading is both shorter and more faithful.
   */
  turnsRemaining: number;
}

export type LogKind =
  | 'roll'
  | 'sail'
  | 'arrive'
  | 'storm'
  | 'piracy'
  | 'insurance'
  | 'fitting'
  | 'season'
  | 'buy'
  | 'deliver'
  | 'missed'
  | 'ship'
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
  captainId: CaptainId | null;
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
  /** The active captain must roll for wind before doing anything else. */
  | 'roll'
  /** Rolled; may sail, trade and invest until they end the turn. */
  | 'act'
  /** Hotseat only: the device must be passed before the next captain's turn begins. */
  | 'handover'
  | 'over';

export interface GameState {
  id: string;
  name: string;
  /**
   * Ruleset discriminator. 'classic' is the 1988 board rules and is the only value today;
   * 'voyage' (the Niccolo-style continuous simulation) is designed in tea-race-design.md but
   * deliberately not implemented — see that document before adding it.
   */
  rules: 'classic';
  /**
   * Which hazards this game plays with. Optional, and **absent means off** — so a save written
   * before hazards existed keeps playing the pure 1988 rules, and the faithful-versus-authored line
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
  /** Current price of each company on the shipping exchange. */
  stockPrices?: Partial<Record<import('./stocks').StockId, number>>;
  /** Lots landed in each company's waters since prices last moved. */
  stockVolume?: Partial<Record<import('./stocks').StockId, number>>;
  /** The last few event kinds dealt, newest first, so the deck does not repeat itself. */
  recentEvents?: WorldEventKind[];
  /**
   * Hostile bids made so far, by anyone. Drives the escalating price, and it is global rather than
   * per-captain on purpose: that is what bounds the total and keeps the game finishing.
   */
  hostileBids?: number;
  /**
   * How well the computer captains play. Optional, absent meaning 'steady', so a save from before
   * difficulty existed keeps exactly the opponents it had.
   */
  difficulty?: import('./rules').Difficulty;
  /** ms epoch, stamped by the caller. The sim itself never reads a clock. */
  createdAt: number;
  rngSeed: number;

  /** Full table rounds started, 1-based. */
  round: number;
  /** Total individual turns taken across all captains, monotonic. */
  turn: number;
  activeIndex: number;
  phase: TurnPhase;

  captains: Captain[];
  ships: Ship[];

  /** Always FACE_UP_CONTRACTS long while the game is live. */
  contracts: Contract[];
  /** Remaining draw pile, as compact "good|destination" keys. */
  deck: string[];
  /** Monotonic counter behind contract ids, so ids stay unique across reshuffles. */
  nextContractSeq: number;
  /** Monotonic counter behind ship ids. */
  nextShipSeq: number;
  /** Monotonic counter behind LogEntry.seq. */
  nextLogSeq: number;

  sharesRemaining: number;
  declaration: Declaration | null;
  winnerId: CaptainId | null;

  /** Sail points rolled this turn, per ship. Cleared when the turn ends. */
  sailPoints: Record<ShipId, number>;
  /** The two dice behind each entry in `sailPoints`, so the UI can show them. */
  dice: Record<ShipId, [number, number]>;

  log: LogEntry[];
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type GameAction =
  /**
   * Rolls 2d6 of wind for every ship the active captain owns, and immediately advances the ones
   * already at sea — a ship mid-ocean has no decision to make, so making the player click for it
   * would be pure ceremony. Docked ships keep their points for a SAIL_TO this turn.
   */
  | { type: 'ROLL' }
  /**
   * Plot a course from a docked ship and spend this turn's points on it in one go. `via` is the
   * exact path to take, so a player who chose the longer route with a fair wind actually gets it.
   */
  | { type: 'SAIL_TO'; shipId: ShipId; destination: PortId; via?: PortId[] }
  | { type: 'BUY_CARGO'; shipId: ShipId; good: GoodId }
  /** Lands every slot matching the contract, and is paid per unit. */
  | { type: 'DELIVER'; shipId: ShipId; contractId: ContractId }
  /**
   * Over the side. Recovers **nothing** — the source is explicit that dumping forfeits the whole
   * purchase price to the bank. Omit `good` to clear the entire hold.
   */
  | { type: 'JETTISON'; shipId: ShipId; good?: GoodId }
  /**
   * Sell a lot off the ship at the quay she is tied up to, at a merchant's price. The toggleable
   * alternative to putting it over the side for nothing.
   */
  | { type: 'SELL_CARGO'; shipId: ShipId; good: GoodId }
  | { type: 'BUY_SHIP'; shipClass?: import('./rules').ShipClassId }
  /** Fit guns or copper to a docked ship, permanently. */
  | { type: 'BUY_FITTING'; shipId: ShipId; fitting: keyof ShipFittings }
  /** Open or close a ship's standing insurance policy. */
  | { type: 'SET_INSURANCE'; shipId: ShipId; insured: boolean }
  /** Draw down another LOAN_STEP against the fleet. */
  /** Buy or sell shares in one of the other shipping companies, at the current price. */
  | { type: 'BUY_STOCK'; stock: import('./stocks').StockId; lots?: number }
  | { type: 'SELL_STOCK'; stock: import('./stocks').StockId; lots?: number }
  | { type: 'TAKE_LOAN' }
  /** Pay down the debt, as much as the captain can afford up to one step. */
  | { type: 'REPAY_LOAN' }
  | { type: 'BUY_SHARE' }
  /** Sell a share back to the bank at half price — the way out of having no working capital. */
  | { type: 'SELL_SHARE' }
  /**
   * Buy a share off a named captain at a premium, whatever your own holding. The way back in for a
   * captain who has fallen behind — see `canHostileBid` in rules.ts.
   */
  | { type: 'HOSTILE_BID'; targetId: CaptainId }
  | { type: 'DECLARE' }
  | { type: 'END_TURN' }
  | { type: 'ACKNOWLEDGE_HANDOVER' };
