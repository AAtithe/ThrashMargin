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
  /** A clipper carries one lot at a time. */
  cargo: CargoLot | null;
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
  aiProfile?: AiProfile;
}

export interface ContractFill {
  captainId: CaptainId;
  /** 1 pays four times the purchase price, 2 pays twice. There is no rank 3. */
  rank: 1 | 2;
  paid: number;
  onTurn: number;
}

export interface Contract {
  id: ContractId;
  good: GoodId;
  source: PortId;
  destination: PortId;
  price: number;
  fills: ContractFill[];
}

export interface Hazards {
  /** Seasonal directional wind, and storms that cost time. */
  weather: boolean;
  /** Piracy in historically piratical waters, with ransoms, seizures and insurance. */
  piracy: boolean;
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
  | 'contract';

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
  /** Remaining draw pile, as compact "good|source|destination" keys. */
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
  /** Plot a course from a docked ship and spend this turn's points on it in one go. */
  | { type: 'SAIL_TO'; shipId: ShipId; destination: PortId }
  | { type: 'BUY_CARGO'; shipId: ShipId; good: GoodId }
  | { type: 'DELIVER'; shipId: ShipId; contractId: ContractId }
  /** Dump a speculative lot nobody ended up wanting, at half what was paid. */
  | { type: 'SELL_LOCAL'; shipId: ShipId }
  | { type: 'BUY_SHIP' }
  /** Fit guns or copper to a docked ship, permanently. */
  | { type: 'BUY_FITTING'; shipId: ShipId; fitting: keyof ShipFittings }
  /** Open or close a ship's standing insurance policy. */
  | { type: 'SET_INSURANCE'; shipId: ShipId; insured: boolean }
  | { type: 'BUY_SHARE' }
  /** Sell a share back to the bank at half price — the way out of having no working capital. */
  | { type: 'SELL_SHARE' }
  | { type: 'DECLARE' }
  | { type: 'END_TURN' }
  | { type: 'ACKNOWLEDGE_HANDOVER' };
