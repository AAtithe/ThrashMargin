export interface Good {
  id: string;
  name: string;
  unit: string;
}

export interface CityMarketGood {
  base: number;
  /** Quality grades (pilot: cloth/silk, `sim/grades.ts`): this city pays a real premium for a
   * `fine`/`excellent` lot of this good, not just the flat buy-side markup every city charges —
   * the reason to route a graded lot here specifically rather than sell it wherever's convenient. */
  qualityMarket?: boolean;
}

/** Quality grades (pilot: cloth/silk only — `sim/grades.ts`). `common` is never stored explicitly
 * in `Vessel.cargoGrades`; it's whatever's left of `cargo[goodId]` once `fine`/`excellent` are
 * subtracted, so a pre-grades save (or any non-pilot good) needs no migration at all — it's just
 * entirely, implicitly `common`. */
export type GradeId = 'common' | 'fine' | 'excellent';

/** florin is the player's home ledger currency; the rest are foreign, grouped by City.power.
 * `asper` (Chapter 2, Phase 9) is Trebizond's money of account; `bezant` (Chapter 3, Phase 10)
 * is the Lusignan kingdom of Cyprus's; `cruzado` (Chapter 4, Phase 13) is Lisbon/Madeira/Gambia's.
 * `scots_pound` and `dinar` (Chapter 5, Phase 19) are the two §5 names still unimplemented —
 * "Scottish/English pounds" as two separate coins, and "Ottoman/Mamluk coin" — added together
 * because this one chapter is the first to have a city using either. */
export type CurrencyId =
  | 'florin'
  | 'groot'
  | 'pound'
  | 'ecu'
  | 'ducat'
  | 'asper'
  | 'bezant'
  | 'cruzado'
  | 'scots_pound'
  | 'dinar';

/** Which side of its own icon a city's label sits on. Borrowed from tea-race's `Port.labelSide`,
 * which solves the same problem far better than a binary "flip it left" set did: in a tight cluster
 * the escape route is often up or down, not sideways. Optional — a city without one gets 'e', the
 * old default, so no existing city content needed changing. */
export type LabelSide = 'n' | 's' | 'e' | 'w';

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
  /** Legibility only — never gameplay. Defaults to 'e' (right of the icon). */
  labelSide?: LabelSide;
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
  /** Remaining route ids of a multi-hop journey queued via "Queue journey" (Phase 15), set
   * explicitly on every `DISPATCH_VESSEL` (undefined clears any stale plan on a manual redispatch
   * elsewhere). While docked with a non-empty plan, the UI offers a "Continue to X?" prompt that
   * dispatches the next leg via `CONTINUE_PLANNED_ROUTE` — each leg remains its own real,
   * individually insured `dispatchVessel` call; nothing sails through a city without stopping. */
  plannedRoute?: string[];
  /** Non-`common` grade breakdown for pilot goods only (`sim/grades.ts`) — goodId -> the `fine`/
   * `excellent` units held; `common` held is always derived as `cargo[goodId]` minus these, never
   * stored. Absent entirely on any vessel that has never held a graded lot. */
  cargoGrades?: Record<string, Partial<Record<'fine' | 'excellent', number>>>;
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

/**
 * The two dossiers the Evidence Board (design doc §11 screen 7) actually holds. `parentage` is the
 * long track §8 describes as assembled across all eight chapters and resolved in Chapter 8 — Chapter
 * 5 only contributes to it, it does not answer it. `vatachino` is the short, self-contained track:
 * enough of it in hand and the masked rival company's backers are named (see `House.hiddenBackers`),
 * which is §9's own "a mystery the intelligence system can unmask early or late".
 */
export type EvidenceTrack = 'parentage' | 'vatachino';

/**
 * One item pinned to the Evidence Board — a document, a testimony, or a date, the three kinds §8
 * itself names. Deliberately *not* a `Secret`: a secret has a florin value and is spent by selling
 * it, while evidence is never sold and only matters in combination with other evidence. Sharing the
 * Secret type would have meant either a sellable dossier or a `value: 0` secret that the Secrets
 * panel would then have to learn to hide.
 */
export interface EvidenceItem {
  id: string;
  name: string;
  description: string;
  track: EvidenceTrack;
  /** `document` | `testimony` | `date` — §8's own three words for what the dossier is made of. */
  kind: 'document' | 'testimony' | 'date';
  discoveredWeek: number;
}

/** Which of §8's three named uses of the divining gift ("find water/ore, sense a person's
 * direction") a `USE_DIVINING` action is attempting. Each is tied to one city in
 * `sim/divining.ts` — the gift answers a question about the ground the player is standing on, so
 * it can't be exercised from Bruges to reach across the map. */
export type DiviningPurpose = 'water' | 'ore' | 'person';

/**
 * The divining gift (design doc §8 track 4: "a limited-use ability... with a Conscience and health
 * cost"). Absent/null until Chapter 5's own content unlocks it, then created on first use.
 * `usesRemaining` is the hard campaign cap; `restUntilWeek` is how "health cost" is modelled — see
 * `sim/divining.ts` for why a recovery cooldown rather than a second health meter beside Conscience.
 */
export interface DiviningState {
  usesRemaining: number;
  restUntilWeek: number;
}

/** The most recent use of the divining gift, for the UI to report — the flag a use sets is only
 * reacted to by a scripted event on the *following* ADVANCE_WEEK, so without this the action would
 * appear to do nothing at all in the week it was actually taken. */
export interface DiviningEvent {
  week: number;
  purpose: DiviningPurpose;
  cityId: string;
  conscienceCost: number;
  restWeeks: number;
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
  /** Why each good's price moved that week, if it moved enough to be worth narrating (Phase 16) —
   * optional and often absent, since silence (no notable move) is the common case. A corrupted
   * report (`houses.ts`'s `corruptNews`) overwrites this with fabricated notes matching its own
   * fabricated prices, so a planted report's causes read exactly like a true one's — there is no
   * "no cause shown" tell that would give away which reports are corrected later. */
  causes?: PriceCauseNote[];
}

/** `house_trade`: a specific AI house's own weekly footprint moved this exact good at its home
 * city (see `houses.ts`'s `applyHouseTradeFootprint`). `unknown_flows`: background trade the
 * player never sees directly moved it (`market.ts`'s `applyBackgroundFlows`) — the pre-existing
 * reason a stale report can already be wrong, now given a name. `settling`: the price is decaying
 * back toward its base rate (`market.ts`'s `driftScarcity`), the natural end of any prior spike or
 * crash (including the player's own selling — see `sim/actions.ts`'s `buyGood` for why buying no
 * longer causes one). */
export type PriceCauseKind = 'house_trade' | 'unknown_flows' | 'settling';

export interface PriceCauseNote {
  goodId: string;
  kind: PriceCauseKind;
  /** 1 = price rose, -1 = price fell — the real observed direction, independent of kind. */
  direction: 1 | -1;
  /** Only set for `kind: 'house_trade'`. */
  houseName?: string;
}

/** One AI house's own weekly trade footprint, as `sim/houses.ts`'s `applyHouseTradeFootprint`
 * actually resolved it that week — surfaced so `deriveMarketCauses` (`sim/market.ts`) can name the
 * house responsible for a price move, rather than lumping every non-player cause into one vague
 * "unknown flows" bucket. */
export interface HouseTradeNote {
  houseId: string;
  houseName: string;
  cityId: string;
  goodId: string;
  direction: 1 | -1;
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
 * be docked (not under way) at that city — note this is satisfied by *any* docked vessel, so at
 * the home city (where a courier permanently sits) it's true for the whole campaign and can't
 * distinguish "a specific vessel has arrived here" (see `vesselKindAt` for that); `flag`/`flags`
 * require a flag (or every flag in the list) already set by an earlier event's choice — the
 * mechanism for scripting a chain; `flagAbsent` requires a flag NOT be set — the mechanism for
 * scripting mutually exclusive outcomes (e.g. a deadline-miss event that must not fire once the
 * success event already has); `cargoAtLeast` requires some non-under-way vessel at `location` to
 * be carrying at least `quantity` of `goodId` — the mechanism for a real logistics delivery check
 * (Phase 7's cannon shipment set piece); `vesselKindAt` requires some non-under-way vessel of that
 * specific `VesselKind` at `location` — the mechanism for "the ship (not the ever-present courier)
 * has come home" (Phase 17 follow-up: Gambia's return-to-Bruges trigger used a bare `location`
 * check plus a cargo check that only coincidentally forced the right vessel; selling the cargo
 * before reaching Bruges — completely normal trading — broke that, and simply dropping the cargo
 * check let the event fire as soon as *any* vessel, i.e. the stationary home courier, was at
 * Bruges, which is always true).
 *
 * `weeksAfterFlag` (Chapter 5, Phase 19) is a *relative* deadline: satisfied once `flag` has been
 * set for at least `weeks` weeks, read off `GameState.flagWeeks`. It exists to retire a compromise
 * Chapters 2, 3 and 4 each recorded independently — the campaign clock runs continuously with no
 * per-chapter reset, so an absolute `dateAfter` deadline is either already in the past the moment
 * its chapter unlocks or absurdly far in the future. (Chapter 4's own `dateAfter: "1471-01-01"`
 * failure fallback is week 563; a player who reached Timbuktu on schedule faced ~140 weeks of
 * pressing "Advance one week" with nothing to do before the arc would resolve itself either way.)
 * A relative deadline is reachable from wherever the chapter actually starts. If the flag is set but
 * has no `flagWeeks` entry — a save from before that field existed — this degrades to the plain
 * `flag` check rather than blocking forever, which is the safe direction: a stuck deadline soft-locks
 * a chapter, an early one merely resolves it.
 */
export interface EventTrigger {
  dateAfter?: string;
  location?: string;
  flag?: string;
  flags?: string[];
  flagAbsent?: string;
  cargoAtLeast?: { location: string; goodId: string; quantity: number };
  vesselKindAt?: { kind: VesselKind; location: string };
  weeksAfterFlag?: { flag: string; weeks: number };
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
  /** Chapter 5 (Phase 19): pins one item to the Evidence Board (design doc §11 screen 7). Mirrors
   * `secret`'s own shape — an inline spec, idempotent on id — because an event is the only way a
   * document or a testimony enters the dossier from the story side; the other way in is a placed
   * agent (see `House.backerLeads`). */
  evidence?: { id: string; name: string; description: string; track: EvidenceTrack; kind: EvidenceItem['kind'] };
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
  /**
   * Hidden ownership (design doc §10's own parenthesis for the Vatachino, "hidden ownership";
   * §9's "an AI house whose backers are a mystery the intelligence system can unmask early or
   * late"). While `revealedByFlag` is unset, the Houses panel shows the seat and the standing but
   * not who actually stands behind the house; once set, `text` is shown. The flag is set
   * automatically once the player holds `UNMASK_EVIDENCE_THRESHOLD` items on `track` — see
   * `sim/dossier.ts`'s `resolveUnmasking`, which is generic over every house carrying this field
   * rather than special-cased to the Vatachino by name.
   */
  hiddenBackers?: {
    track: EvidenceTrack;
    revealedByFlag: string;
    text: string;
  };
  /**
   * Evidence a player agent placed inside this house may surface week by week — the "unmask early"
   * half of §9's own line. Content-authored, drawn from in file order, and de-duplicated against
   * what the player already holds, so an agent and the chapter's own events can hand over the same
   * dossier in either order without either one producing a duplicate.
   */
  backerLeads?: {
    id: string;
    name: string;
    description: string;
    track: EvidenceTrack;
    kind: EvidenceItem['kind'];
  }[];
}

/**
 * Where a placed agent works (design doc §6): a city agent shields that city's weekly report
 * from being planted by a hostile house; a house agent has a weekly chance of surfacing that
 * house's insider secret via the existing Secret system.
 */
export type AgentPlacement = { type: 'city'; cityId: string } | { type: 'house'; houseId: string };

/**
 * The hotseat house experiment (Phase 14, design doc §10's "reduced fidelity" model kept exactly
 * as-is — no cargo hold, no ledger, nothing new for a human to manage). A seated player, on the
 * same device, makes the small number of decisions `sim/houses.ts` otherwise resolves by
 * `Math.random()` for one chosen house's home-city trade nudge, and — only if that house is
 * hostile — whether to plant corrupted news and where, and whether to attempt sabotage this week.
 * Every other house (and every other mechanic) is unaffected; this never touches persistence,
 * networking, or story content. Collected once per week via a decision prompt shown instead of
 * advancing immediately, mirroring Thrash Margin's own same-device hotseat pattern.
 */
export interface HotseatDecision {
  tradeGoodId: string;
  tradeDirection: 1 | -1;
  /** Null = decided not to plant this week. Only meaningful for a hostile house. */
  plantTargetCityId: string | null;
  /** Only meaningful for a hostile house with an eligible docked, cargo-carrying vessel at its
   * own home city this week. */
  attemptSabotage: boolean;
}

export interface Agent {
  id: string;
  name: string;
  placement: AgentPlacement;
  placedWeek: number;
}

/**
 * Story-tied success conditions (Phase 14), toggleable per campaign (`GameState.objectivesHidden`,
 * mirrors the "Skip the prologue" toggle's own shape). Purely a read-only projection over flags a
 * chapter's own event content already sets — `flag`/`flagAbsent` describe an existing thread's
 * gating flag, never a new one; `checkTriggers`/`resolveEvent`/`EventEffects` are all untouched.
 * `cashThreshold` exists for a future chapter that might genuinely hinge on a real financial
 * deadline, but is deliberately unused by Chapters 1-4's own objective content — see
 * `content/objectives/chapterN.json`'s own authoring notes.
 */
export type ObjectiveKind =
  | { type: 'flag'; flag: string }
  | { type: 'flagAbsent'; flag: string }
  | { type: 'cashThreshold'; amount: number; byWeek: number };

export interface Objective {
  id: string;
  chapterNumber: number;
  label: string;
  description?: string;
  kind: ObjectiveKind;
  /** Cosmetic only: when a thread's gating flag is the shared funnel-point of two narrative
   * branches that already exist in content (a good outcome vs. a costly one), name both flags here
   * so the panel can caption which branch actually resolved — no new gating semantics. */
  outcomeFlags?: { positive?: string; costly?: string };
  /** Gates `description` behind a flag (Phase 15's "forward-looking hints") — while the flag is
   * unset AND the objective is still `pending`, the panel shows a generic "no lead yet" placeholder
   * instead of `description`, so a concrete walkthrough (e.g. the cannon shipment's exact route)
   * doesn't spoil a thread before its own content has actually introduced it. Once the objective is
   * no longer pending (complete or missed), the real description always shows regardless — there's
   * nothing left to spoil, only context to give. Most objectives have no `revealFlag` and are
   * described from the chapter's start, same as before this field existed. */
  revealFlag?: string;
  /** True for a beat the player cannot choose to prevent (a scripted death, an unavoidable
   * confrontation) — the panel renders these as "will occur" / "occurred" rather than implying a
   * success the player could have failed to earn. */
  inevitable?: boolean;
  /** Flavor/character threads that aren't part of the chapter's finale AND-gate — shown for
   * texture but never counted toward the "N of M resolved" footer. */
  optional?: boolean;
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
  /** Campaign-creation toggle (Lobby "Hide chapter objectives"). Optional and defaults falsy-shown
   * (undefined/false both mean "show them"), so a save from before this field existed simply
   * renders the panel — not a shape mismatch, same discipline as `expedition`/`lastExpeditionEvent`. */
  objectivesHidden?: boolean;
  /** Campaign-creation toggle (Lobby "hotseat house") naming which house, if any, a seated human
   * plays this campaign instead of the formulas in `sim/houses.ts`. Optional/null-safe for a save
   * from before this field existed (no house is hotseat-controlled, identical to today). */
  hotseatHouseId?: string | null;
  /** Highest chapter number the player has already seen a "Chapter N complete" acknowledgment card
   * for (Phase 15) — persisted so a save/reload between a chapter flipping and the player clicking
   * "Continue" can't silently eat the card (an ephemeral component-local ref would reinitialize to
   * the already-current chapter number on remount and never show it). `createInitialState` seeds
   * this to match the campaign's actual starting chapter (0, or 1 for skip-prologue) so no false
   * card appears at creation; optional/undefined on an older save just means "acknowledge nothing
   * yet," which at worst re-shows one already-seen card once, never crashes. */
  lastAcknowledgedChapter?: number;
  /** The Evidence Board's contents (Chapter 5, Phase 19) — both tracks in one list, filtered by
   * `track` at the read sites. Optional so a save from before this field existed simply has an
   * empty dossier rather than a shape mismatch, the same discipline `expedition`/`objectivesHidden`
   * already use. */
  evidence?: EvidenceItem[];
  /** The divining gift's remaining uses and recovery window (Chapter 5, Phase 19). Optional/null
   * until Chapter 5's content unlocks it and the player first exercises it. */
  divining?: DiviningState | null;
  /** The most recent use of the divining gift, for the UI to report. Optional/null, same as every
   * other `last*Event` field. */
  lastDiviningEvent?: DiviningEvent | null;
  /** The week each flag was first set — the backing store for `EventTrigger.weeksAfterFlag`'s
   * relative deadlines (Chapter 5, Phase 19). Written whenever a flag flips from unset to set;
   * never rewritten, so it records the first time, not the most recent. Optional: an older save
   * simply has no history, and `weeksAfterFlag` degrades to a plain flag check for any flag missing
   * from it (see that field's own doc comment for why that's the safe direction). */
  flagWeeks?: Record<string, number>;
  /** Every notable price move from the week just resolved, by city — recomputed fresh every
   * `ADVANCE_WEEK` (Phase 16), never accumulated, so it always describes only the most recent
   * week regardless of whether this field existed on an older save. This is the live,
   * latency-free channel for wherever the player is actually standing right now; a city the
   * player isn't currently at instead gets its causes via the normal courier-latency `NewsItem`
   * pipeline (`NewsItem.causes`), same as prices already work. */
  lastMarketCauses?: Record<string, PriceCauseNote[]>;
}

export type GameAction =
  | { type: 'ADVANCE_WEEK'; hotseatDecision?: HotseatDecision }
  | { type: 'DISPATCH_VESSEL'; vesselId: string; destinationId: string; insure?: boolean; plannedRoute?: string[] }
  | { type: 'CONTINUE_PLANNED_ROUTE'; vesselId: string; insure?: boolean }
  | { type: 'CANCEL_PLANNED_ROUTE'; vesselId: string }
  | { type: 'ACKNOWLEDGE_CHAPTER'; chapterNumber: number }
  | { type: 'BUY_GOOD'; vesselId: string; goodId: string; quantity: number; grade?: GradeId }
  | { type: 'SELL_GOOD'; vesselId: string; goodId: string; quantity: number; grade?: GradeId }
  | { type: 'INVEST_COURIER'; cityId: string }
  | { type: 'WRITE_BILL'; cityId: string; florins: number; termWeeks: number }
  | { type: 'TAKE_DEPOSIT'; florins: number; termWeeks: number }
  | { type: 'WRITE_LOAN'; kind: 'merchant' | 'prince'; florins: number; termWeeks: number }
  | { type: 'DISCOUNT_OBLIGATION'; obligationId: string }
  | { type: 'ASSIGN_CHARACTER'; characterId: string; assignment: CharacterAssignment }
  | { type: 'RESOLVE_EVENT'; eventId: string; choiceIndex: number }
  | { type: 'USE_SECRET'; secretId: string }
  | { type: 'PLACE_AGENT'; placement: AgentPlacement; name?: string }
  | { type: 'USE_DIVINING'; purpose: DiviningPurpose }
  | { type: 'ESTABLISH_ESTATE' }
  | { type: 'HARVEST_ESTATE' }
  | { type: 'SHIP_ESTATE_GOODS'; vesselId: string; quantity: number };
