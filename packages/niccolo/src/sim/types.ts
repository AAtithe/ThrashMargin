export interface Good {
  id: string;
  name: string;
  unit: string;
}

export interface CityMarketGood {
  base: number;
}

/** florin is the player's home ledger currency; the rest are foreign, grouped by City.power.
 * `asper` (Chapter 2, Phase 9) is Trebizond's money of account; `bezant` (Chapter 3, Phase 10)
 * is the Lusignan kingdom of Cyprus's; `cruzado` (Chapter 4, Phase 13) is Lisbon/Madeira/Gambia's. */
export type CurrencyId = 'florin' | 'groot' | 'pound' | 'ecu' | 'ducat' | 'asper' | 'bezant' | 'cruzado';

export interface City {
  id: string;
  name: string;
  region: string;
  power: string;
  x: number;
  y: number;
  port: boolean;
  market?: Record<string, CityMarketGood>;
  /** The money of account this city settles bills and deposits in. */
  currency: CurrencyId;
}

export interface Route {
  id: string;
  from: string;
  to: string;
  distanceWeeks: number;
  /** `river` (Chapter 4, Phase 13): the Gambia-Timbuktu leg. Ship-only, exactly like `sea` — every
   * courier-restriction check already excludes "not land" generically, so no river-specific
   * exclusion was needed anywhere. Deliberately excluded from `insurance.ts`'s sea/land premium
   * and risk branches (falls through to the land rate as written) since `sim/expedition.ts`'s
   * disease clock is the dedicated risk model for this route — stacking storm/piracy risk on top
   * would double-jeopardy the same voyage. */
  type: 'land' | 'sea' | 'river';
  seasonal: boolean;
}

export type VesselKind = 'ship' | 'courier';

/** goodId -> quantity carried */
export type Cargo = Record<string, number>;

export interface Vessel {
  id: string;
  kind: VesselKind;
  name: string;
  /** City id where the vessel currently sits. Undefined while under way. */
  location: string;
  /** City id the vessel is heading to, if under way. */
  destination: string | null;
  routeId: string | null;
  weeksRemaining: number;
  cargo: Cargo;
  /** Total units of goods this vessel can hold. Couriers carry none. */
  capacity: number;
}

/**
 * Cargo insurance for one voyage (design doc §4: "purchasable in Bruges/Venice/Genoa at a
 * premium that reflects the insurer's information, not the player's"). Bought at dispatch time
 * while docked at one of the three underwriting cities; pays out in cash if a storm/piracy loss
 * (see `sim/insurance.ts`) strikes that vessel before it reaches its destination. Cleared on
 * arrival (unused) or on a loss (paid out), so at most one policy exists per vessel at a time.
 */
export interface Insurance {
  vesselId: string;
  routeId: string;
  /** Florin value of the cargo insured, fixed at purchase. */
  coverage: number;
  premiumPaid: number;
}

/** The most recent storm/piracy loss, kept for the UI to report — there is no other feedback
 * channel for something that happens automatically inside ADVANCE_WEEK. Null until the first. */
export interface VoyageLossEvent {
  week: number;
  vesselId: string;
  vesselName: string;
  goodId: string;
  quantityLost: number;
  insured: boolean;
  payout: number;
}

/** The most recent hostile-house sabotage (see `resolveHouseSabotage`) — same "no other feedback
 * channel" problem `VoyageLossEvent` solves, for a cargo loss that can happen while a vessel is
 * simply docked at a hostile house's home city, not under way. Optional on `GameState` (a save
 * from before this field existed just has no history to show, not a shape mismatch) so it never
 * invalidates an in-progress campaign the way a required field would. */
export interface SabotageLossEvent {
  week: number;
  vesselId: string;
  vesselName: string;
  goodId: string;
  quantityLost: number;
  cityId: string;
  houseName: string;
}

export type ExpeditionHealthStatus = 'healthy' | 'ailing' | 'stricken';

/**
 * Chapter 4's disease clock (design doc §9: "the Gambia voyage: river navigation, disease
 * clock"). Tracks at most one vessel at a time — the same singular-instance discipline `Estate`
 * used for its first outing — while it lingers at Gambia, at Timbuktu, or under way on the
 * `river` route; clears to null the week the tracked vessel leaves that zone (a live clock, not a
 * history — `ExpeditionHealthEvent` below is the history). Resolved weekly in `resolveWeeklyExpedition`.
 */
export interface ExpeditionState {
  vesselId: string;
  weeksUpriver: number;
  healthStatus: ExpeditionHealthStatus;
}

/** The most recent expedition-health event, for the UI to report — same "no other feedback
 * channel" reasoning as `VoyageLossEvent`/`SabotageLossEvent`. Optional/undefined for a save from
 * before this field existed, null on a fresh campaign until the first one occurs. */
export interface ExpeditionHealthEvent {
  week: number;
  vesselId: string;
  vesselName: string;
  healthStatus: ExpeditionHealthStatus;
  cashCost: number;
  conscienceCost: number;
}

/** cityId -> goodId -> scarcity multiplier (1 = base price, >1 = scarce/dear, <1 = glut/cheap) */
export type MarketScarcity = Record<string, Record<string, number>>;

/** A market report for one city, true as of one week and not seen by the player until another. */
export interface NewsItem {
  cityId: string;
  trueAsOfWeek: number;
  receivedOnWeek: number;
  /** goodId -> price, as it stood at trueAsOfWeek. */
  prices: Record<string, number>;
}

/** cityId -> weeks of latency shaved off that city's reports by courier investment. */
export type CourierInvestment = Record<string, number>;

/** currencyId -> florins one unit of that currency buys right now. florin is always 1. */
export type ExchangeRates = Record<CurrencyId, number>;

export type ObligationKind = 'bill_payable' | 'deposit' | 'loan_merchant' | 'loan_prince';

/**
 * A single credit instrument on the maturity ladder. `payable` obligations are money the
 * player owes (bills borrowed against, deposits taken in); `receivable` obligations are money
 * owed to the player (loans out). Amounts are denominated in `currency`, not florins — the
 * florin value floats with the exchange rate until the week it settles.
 */
export interface Obligation {
  id: string;
  kind: ObligationKind;
  direction: 'payable' | 'receivable';
  currency: CurrencyId;
  cityId: string;
  /** Amount owed at maturity, in `currency` — principal plus the instrument's hidden spread. */
  amount: number;
  issuedWeek: number;
  matureWeek: number;
  settled: boolean;
  /** loan_prince only: set once resolved, true if the prince defaulted and paid nothing. */
  defaulted?: boolean;
}

export interface CharacterSkills {
  law: number;
  trade: number;
  combat: number;
  intrigue: number;
}

/**
 * What an officer is doing this week. `aboard` gives a vessel's trades a trade-skill bonus;
 * `negotiate` gives that city's credit instruments a law-skill discount; `investigate` gives
 * that city's news reports an intrigue-skill latency cut. Only one assignment at a time —
 * reassigning simply overwrites it, there is no travel time to a new posting.
 */
export type CharacterAssignment =
  | { type: 'idle' }
  | { type: 'aboard'; vesselId: string }
  | { type: 'negotiate'; cityId: string }
  | { type: 'investigate'; cityId: string };

export interface Character {
  id: string;
  name: string;
  role: string;
  skills: CharacterSkills;
  loyalty: number;
  /** Florins per week, drawn from cash at ADVANCE_WEEK alongside deposits/loans. */
  salary: number;
  /** Home city while idle; otherwise informational only (the assignment target is authoritative). */
  location: string;
  /** `pending` (Chapter 2, Phase 9): authored in content but not yet part of the roster — a
   * mid-campaign `joinCharacter` event effect is what flips one to `active`. Every function that
   * already filters on `status === 'active'` (upkeep, assignment, discounts) treats `pending`
   * exactly like `departed`: present in save data, invisible to every system until it joins. */
  status: 'active' | 'departed' | 'pending';
  assignment: CharacterAssignment;
}

/**
 * All conditions present must hold for the event to trigger (AND semantics). `dateAfter` is
 * an ISO calendar date compared against the in-game clock; `location` requires some vessel to
 * be docked (not under way) at that city; `flag`/`flags` require a flag (or every flag in the
 * list) already set by an earlier event's choice — the mechanism for scripting a chain;
 * `flagAbsent` requires a flag NOT be set — the mechanism for scripting mutually exclusive
 * outcomes (e.g. a deadline-miss event that must not fire once the success event already has);
 * `cargoAtLeast` requires some non-under-way vessel at `location` to be carrying at least
 * `quantity` of `goodId` — the mechanism for a real logistics delivery check (Phase 7's cannon
 * shipment set piece).
 */
export interface EventTrigger {
  dateAfter?: string;
  location?: string;
  flag?: string;
  flags?: string[];
  flagAbsent?: string;
  cargoAtLeast?: { location: string; goodId: string; quantity: number };
}

/**
 * Effects an event choice can apply. Only systems that already exist in the sim are wired —
 * no `rep.*` (AI houses, Phase 8) and no scripted character death/departure (roster characters
 * are never killed by Ch1 content; Felix, Simon and Jordan are narrative-only, not Character
 * records). `secret` and `condotta` are Phase 7 additions: §6 and §5 of the design doc name
 * both as their own asset classes, so each gets a real (if minimal) system rather than being
 * faked as a one-off cash/flag pair.
 */
export interface EventEffects {
  flag?: string;
  flags?: string[];
  cash?: number;
  conscience?: number;
  secret?: { id: string; name: string; description: string; value: number; expiresInWeeks?: number };
  condotta?: { retainerPerWeek: number; weeks: number };
  /**
   * houseId -> relation delta (design doc §8's own example: `"rep.stpol": -10`). Deferred at
   * Phase 6 and Phase 7 for lack of an AI house to hold a reputation with; wired now that Phase 8
   * gives it one. Chapter 2 (Phase 9) is its first real user.
   */
  rep?: Record<string, number>;
  /** Chapter 2 (Phase 9): activates a character already present in save data with `status:
   * 'pending'`, or — for a save from before that character existed — adds them fresh from
   * content. Scripts a mid-campaign join (Diniz) without a chapter-scripted join-date system. */
  joinCharacter?: string;
  /** Chapter 2 (Phase 9): a scripted departure (the extraction's human stake), distinct from the
   * generic loyalty-zero departure — a no-op if the character isn't currently active. */
  characterDeparts?: string;
  /** Chapter 0: hands the player a new vessel mid-campaign (Claes's cargo ship, granted once he's
   * formally made the house's factor) — a no-op if a vessel with that id already exists, so a
   * replayed or already-past finale can't duplicate it. Docks immediately at `location`. */
  grantVessel?: { id: string; kind: VesselKind; name: string; capacity: number; location: string };
  /** Chapter 0: hands a vessel starter cargo with no purchase behind it — the mechanism for
   * giving Claes something to sell before he has any florins of his own to buy with. A no-op if
   * the named vessel doesn't exist (a replayed event, or a skip-prologue save that never has it
   * pending in the first place). */
  grantCargo?: { vesselId: string; goodId: string; quantity: number };
}

export interface EventChoice {
  text: string;
  effects: EventEffects;
}

export interface ScriptedEvent {
  id: string;
  chapter: number;
  trigger: EventTrigger;
  title: string;
  body: string;
  choices: EventChoice[];
}

/**
 * A discovered piece of held knowledge (design doc §6): an explicit value, realised by
 * `USE_SECRET` (exploiting or selling are the same mechanical move — there are no named buyers
 * yet, that's Phase 8's AI houses), and an optional expiry after which it's worthless if unused.
 */
export interface Secret {
  id: string;
  name: string;
  description: string;
  value: number;
  discoveredWeek: number;
  expiresWeek: number | null;
  used: boolean;
  expired: boolean;
}

/**
 * Astorre's company under contract (design doc §5: "pays a retainer plus campaign bonuses").
 * Resolved automatically every ADVANCE_WEEK: pays `retainerPerWeek` and counts down; on reaching
 * zero, pays a campaign-bonus lump sum and clears, setting `condotta_naples_complete`.
 */
export interface CondottaContract {
  retainerPerWeek: number;
  weeksRemaining: number;
}

export type HouseDisposition = 'ally' | 'neutral' | 'hostile';

/**
 * Static content for one of the AI houses (design doc §10). Phase 8 ships exactly the three
 * Section 12 names for Phase 8 itself — Medici, St Pol interests, one Genoese house — not the
 * fuller §10 roster (Doria, Vatachino, Adorne), which belongs to the chapters that actually
 * introduce them. Each house runs "the same systems as the player... at reduced fidelity": here,
 * a light weekly trade footprint at its home city, nothing else.
 */
export interface House {
  id: string;
  name: string;
  homeCity: string;
  disposition: HouseDisposition;
  /** Relation the house's standing drifts toward over time, absent any push from events or agents. */
  baselineRelation: number;
  /** One piece of insider knowledge a player agent placed inside this house might surface. */
  insiderSecret?: {
    id: string;
    name: string;
    description: string;
    value: number;
    expiresInWeeks?: number;
  };
}

/**
 * Where a placed agent works (design doc §6): a city agent shields that city's weekly report
 * from being planted by a hostile house; a house agent has a weekly chance of surfacing that
 * house's insider secret via the existing Secret system.
 */
export type AgentPlacement = { type: 'city'; cityId: string } | { type: 'house'; houseId: string };

export interface Agent {
  id: string;
  name: string;
  placement: AgentPlacement;
  placedWeek: number;
}

export type EstateStage = 'growing' | 'ready' | 'refining';

/**
 * Chapter 3's production asset (design doc §12, "production assets in Ch3") — the sugar estate
 * at Kouklia. Kept singular and single-city, the same reduced-fidelity discipline every other
 * chapter's first outing of a new mechanic already used (one condotta, one house roster at a
 * time). `plant` is folded into `ESTABLISH_ESTATE` (an estate is planted the moment it's
 * founded); `growing`/`refining` advance automatically once a week via `resolveWeeklyEstate`;
 * `ready` waits on the player's own `HARVEST_ESTATE` action, so harvest is a deliberate choice
 * rather than another silent tick; `ship` is `SHIP_ESTATE_GOODS`, loading the stockpile onto a
 * docked vessel exactly like any other cargo, so it sells through the existing market system
 * rather than a second parallel one.
 */
export interface Estate {
  cityId: string;
  goodId: string;
  stage: EstateStage;
  weeksInStage: number;
  stockpile: number;
}

export interface GameState {
  id: string;
  /** Player-chosen campaign name, shown in the lobby's save list. Optional only because saves
   * from before multi-campaign support (Phase 8's persistence work) predate the field. */
  name?: string;
  week: number;
  cash: number;
  vessels: Vessel[];
  scarcity: MarketScarcity;
  /** News dispatched but not yet arrived. */
  pendingNews: NewsItem[];
  /** The newest arrived report the player holds for each city. */
  knownPrices: Record<string, NewsItem>;
  courierInvestment: CourierInvestment;
  exchangeRates: ExchangeRates;
  obligations: Obligation[];
  /** Set once a matured payable can't be covered even after liquidating cargo. Campaign over. */
  insolvent: boolean;
  characters: Character[];
  /** 0-100, starts clean at 100. Certain profitable-but-costly actions spend it permanently. */
  conscience: number;
  /** Flags set permanently by event choices; other events' triggers can require one. */
  flags: Record<string, boolean>;
  /** Ids of events already resolved. An event never fires twice. */
  firedEvents: string[];
  /** Ids of events that have triggered and are awaiting a player choice, oldest first. */
  pendingEvents: string[];
  /** Secrets discovered so far, whether still usable, already used, or expired unused. */
  secrets: Secret[];
  /** Astorre's company, if currently under contract. Null when no condotta is running. */
  condotta: CondottaContract | null;
  /** Dynamic standing with each AI house, 0-100 (mirrors Conscience). Starts at each house's baseline. */
  houseRelations: Record<string, number>;
  /** Player-placed agents: in a city (shields its reports) or inside a rival house (may surface secrets). */
  agents: Agent[];
  /** Chapter 3's sugar estate at Kouklia, once established. Null before then and never removable. */
  estate: Estate | null;
  /** Active cargo-insurance policies, one per insured vessel currently under way. */
  insurance: Insurance[];
  /** The most recent storm/piracy loss, for the UI to report. Null until the first one occurs. */
  lastVoyageEvent: VoyageLossEvent | null;
  /** The most recent hostile-house sabotage loss, for the UI to report. Optional/undefined for a
   * save from before this field existed, and null on a fresh campaign until the first one occurs. */
  lastSabotageEvent?: SabotageLossEvent | null;
  /** Chapter 4's disease clock, if a vessel is currently in the Gambia/Timbuktu zone. Optional
   * (not required-but-nullable like `estate`) so `isCurrentShape` needs no changes — a save from
   * before this field existed simply has no expedition running, not a shape mismatch. */
  expedition?: ExpeditionState | null;
  /** The most recent expedition-health event, for the UI to report. Optional/undefined for a save
   * from before this field existed, null on a fresh campaign until the first one occurs. */
  lastExpeditionEvent?: ExpeditionHealthEvent | null;
}

export type GameAction =
  | { type: 'ADVANCE_WEEK' }
  | { type: 'DISPATCH_VESSEL'; vesselId: string; destinationId: string; insure?: boolean }
  | { type: 'BUY_GOOD'; vesselId: string; goodId: string; quantity: number }
  | { type: 'SELL_GOOD'; vesselId: string; goodId: string; quantity: number }
  | { type: 'INVEST_COURIER'; cityId: string }
  | { type: 'WRITE_BILL'; cityId: string; florins: number; termWeeks: number }
  | { type: 'TAKE_DEPOSIT'; florins: number; termWeeks: number }
  | { type: 'WRITE_LOAN'; kind: 'merchant' | 'prince'; florins: number; termWeeks: number }
  | { type: 'DISCOUNT_OBLIGATION'; obligationId: string }
  | { type: 'ASSIGN_CHARACTER'; characterId: string; assignment: CharacterAssignment }
  | { type: 'RESOLVE_EVENT'; eventId: string; choiceIndex: number }
  | { type: 'USE_SECRET'; secretId: string }
  | { type: 'PLACE_AGENT'; placement: AgentPlacement; name?: string }
  | { type: 'ESTABLISH_ESTATE' }
  | { type: 'HARVEST_ESTATE' }
  | { type: 'SHIP_ESTATE_GOODS'; vesselId: string; quantity: number };
