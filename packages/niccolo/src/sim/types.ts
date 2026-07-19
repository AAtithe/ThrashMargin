export interface Good {
  id: string;
  name: string;
  unit: string;
}

export interface CityMarketGood {
  base: number;
}

/** florin is the player's home ledger currency; the rest are foreign, grouped by City.power. */
export type CurrencyId = 'florin' | 'groot' | 'pound' | 'ecu' | 'ducat';

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
  type: 'land' | 'sea';
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
  status: 'active' | 'departed';
  assignment: CharacterAssignment;
}

export interface GameState {
  id: string;
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
}

export type GameAction =
  | { type: 'ADVANCE_WEEK' }
  | { type: 'DISPATCH_VESSEL'; vesselId: string; destinationId: string }
  | { type: 'BUY_GOOD'; vesselId: string; goodId: string; quantity: number }
  | { type: 'SELL_GOOD'; vesselId: string; goodId: string; quantity: number }
  | { type: 'INVEST_COURIER'; cityId: string }
  | { type: 'WRITE_BILL'; cityId: string; florins: number; termWeeks: number }
  | { type: 'TAKE_DEPOSIT'; florins: number; termWeeks: number }
  | { type: 'WRITE_LOAN'; kind: 'merchant' | 'prince'; florins: number; termWeeks: number }
  | { type: 'DISCOUNT_OBLIGATION'; obligationId: string }
  | { type: 'ASSIGN_CHARACTER'; characterId: string; assignment: CharacterAssignment };
