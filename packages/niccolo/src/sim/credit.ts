import { findCity, HOME_CITY } from './content';
import { applyConscienceCost, CONSCIENCE_COST_PRINCE_LOAN, negotiateDiscount } from './characters';
import { toFlorins } from './currency';
import { adjustScarcity, priceAt } from './market';
import type { ExchangeRates, GameState, MarketScarcity, Obligation, Vessel } from './types';

export const MIN_TERM_WEEKS = 2;
export const MAX_TERM_WEEKS = 26;

/** Hidden interest, expressed as a fraction of principal per week. Bills cost more than deposits
 * — the design pillar that deposits are "cheap capital" and bills are leverage you pay for. */
export const BILL_SPREAD_PER_WEEK = 0.006;
export const DEPOSIT_RATE_PER_WEEK = 0.0015;
export const LOAN_MERCHANT_RATE_PER_WEEK = 0.004;
export const LOAN_PRINCE_RATE_PER_WEEK = 0.009;
/** "May default politically" — a prince loan's high margin comes with real default risk. */
export const LOAN_PRINCE_DEFAULT_CHANCE = 0.2;
/** Selling a receivable early (discounting) costs more than just waiting out its own accrual. */
export const DISCOUNT_RATE_PER_WEEK = 0.01;
/** Extra discount on a Florence bill's spread once the Medici relationship (Ch1 content) pays off. */
export const MEDICI_FAVOR_DISCOUNT = 0.15;
/** Forced liquidation during insolvency sells cargo at this fraction of local market price. */
export const LIQUIDATION_HAIRCUT = 0.7;

let nextObligationSeq = 0;
function obligationId(): string {
  nextObligationSeq += 1;
  return `ob_${nextObligationSeq}_${Math.random().toString(36).slice(2, 8)}`;
}

function assertTerm(termWeeks: number) {
  if (!Number.isInteger(termWeeks) || termWeeks < MIN_TERM_WEEKS || termWeeks > MAX_TERM_WEEKS) {
    throw new Error(`Term must be a whole number of weeks between ${MIN_TERM_WEEKS} and ${MAX_TERM_WEEKS}`);
  }
}

function assertFlorins(florins: number) {
  if (!Number.isFinite(florins) || florins <= 0) throw new Error('Amount must be a positive number of florins');
}

/** Borrow now via a bill of exchange, repayable at `cityId` in that city's currency. */
export function writeBill(state: GameState, cityId: string, florins: number, termWeeks: number): GameState {
  assertFlorins(florins);
  assertTerm(termWeeks);
  const city = findCity(cityId);
  if (!city) throw new Error(`No such city: ${cityId}`);

  const currency = city.currency;
  const rate = state.exchangeRates[currency];
  const principal = florins / rate;
  const medici = cityId === 'florence' && state.flags.medici_favor ? MEDICI_FAVOR_DISCOUNT : 0;
  const spread = BILL_SPREAD_PER_WEEK * (1 - negotiateDiscount(state.characters, cityId)) * (1 - medici);
  const amount = principal * (1 + spread * termWeeks);

  const obligation: Obligation = {
    id: obligationId(),
    kind: 'bill_payable',
    direction: 'payable',
    currency,
    cityId,
    amount,
    issuedWeek: state.week,
    matureWeek: state.week + termWeeks,
    settled: false,
  };

  return {
    ...state,
    cash: state.cash + florins,
    obligations: [...state.obligations, obligation],
  };
}

/** A merchant deposits with the bank now; the bank owes principal plus a fixed discretion payment back at term. */
export function takeDeposit(state: GameState, florins: number, termWeeks: number): GameState {
  assertFlorins(florins);
  assertTerm(termWeeks);

  const rate = DEPOSIT_RATE_PER_WEEK * (1 - negotiateDiscount(state.characters, HOME_CITY));
  const obligation: Obligation = {
    id: obligationId(),
    kind: 'deposit',
    direction: 'payable',
    currency: 'florin',
    cityId: HOME_CITY,
    amount: florins * (1 + rate * termWeeks),
    issuedWeek: state.week,
    matureWeek: state.week + termWeeks,
    settled: false,
  };

  return {
    ...state,
    cash: state.cash + florins,
    obligations: [...state.obligations, obligation],
  };
}

/** Lend out now; merchant loans are secured on cargo (safe, lower margin), prince loans pay more but may default. */
export function writeLoan(state: GameState, kind: 'merchant' | 'prince', florins: number, termWeeks: number): GameState {
  assertFlorins(florins);
  assertTerm(termWeeks);
  if (florins > state.cash) throw new Error(`Not enough cash (need ${florins}, have ${Math.round(state.cash)})`);

  const baseRate = kind === 'prince' ? LOAN_PRINCE_RATE_PER_WEEK : LOAN_MERCHANT_RATE_PER_WEEK;
  const rate = baseRate * (1 - negotiateDiscount(state.characters, HOME_CITY));
  const obligation: Obligation = {
    id: obligationId(),
    kind: kind === 'prince' ? 'loan_prince' : 'loan_merchant',
    direction: 'receivable',
    currency: 'florin',
    cityId: HOME_CITY,
    amount: florins * (1 + rate * termWeeks),
    issuedWeek: state.week,
    matureWeek: state.week + termWeeks,
    settled: false,
  };

  const next: GameState = {
    ...state,
    cash: state.cash - florins,
    obligations: [...state.obligations, obligation],
  };

  // Lending to a prince means exploiting a ruler's political need — that costs Conscience,
  // and Godscalc and Tobie specifically, regardless of whether the prince later defaults.
  return kind === 'prince' ? applyConscienceCost(next, CONSCIENCE_COST_PRINCE_LOAN) : next;
}

/** Sell a not-yet-matured receivable for cash now, at a present-value haircut. */
export function discountObligation(state: GameState, id: string): GameState {
  const obligation = state.obligations.find(o => o.id === id);
  if (!obligation) throw new Error('No such obligation');
  if (obligation.direction !== 'receivable') throw new Error('Only a receivable can be discounted');
  if (obligation.settled) throw new Error('Already settled');
  const weeksLeft = obligation.matureWeek - state.week;
  if (weeksLeft <= 0) throw new Error('Already due — it will settle on the next advance');

  const presentValue = obligation.amount / (1 + DISCOUNT_RATE_PER_WEEK * weeksLeft);
  const florinsNow = Math.round(toFlorins(presentValue, obligation.currency, state.exchangeRates));

  return {
    ...state,
    cash: state.cash + florinsNow,
    obligations: state.obligations.filter(o => o.id !== id),
  };
}

/** Forced sale of docked cargo at a distress price. Cargo under way can't be reached in time. */
function liquidateForShortfall(
  vessels: Vessel[],
  scarcity: MarketScarcity,
  shortfallFlorins: number,
): { vessels: Vessel[]; scarcity: MarketScarcity; raised: number } {
  let raised = 0;
  let workingScarcity = scarcity;
  const workingVessels = vessels.map(v => ({ ...v, cargo: { ...v.cargo } }));

  for (const vessel of workingVessels) {
    if (vessel.destination) continue;
    for (const goodId of Object.keys(vessel.cargo)) {
      if (raised >= shortfallFlorins) break;
      const held = vessel.cargo[goodId] ?? 0;
      if (held <= 0) continue;
      const price = priceAt(workingScarcity, vessel.location, goodId);
      if (!price) continue;
      const unitValue = price * LIQUIDATION_HAIRCUT;
      if (unitValue <= 0) continue;
      const remaining = shortfallFlorins - raised;
      const sellQty = Math.min(held, Math.max(1, Math.ceil(remaining / unitValue)));
      raised += sellQty * unitValue;
      vessel.cargo[goodId] = held - sellQty;
      workingScarcity = adjustScarcity(workingScarcity, vessel.location, goodId, -sellQty);
    }
    if (raised >= shortfallFlorins) break;
  }

  return { vessels: workingVessels, scarcity: workingScarcity, raised };
}

export interface MaturityResolution {
  cash: number;
  vessels: Vessel[];
  scarcity: MarketScarcity;
  obligations: Obligation[];
  insolvent: boolean;
}

/**
 * Settle every obligation maturing this week. Receivables pay in (prince loans may default).
 * Payables are drawn from cash first, then from a forced cargo sale at a haircut; if that still
 * doesn't cover it, the campaign is insolvent — no Medici rescue or branch sale exist yet to
 * soften that (Phase 5/8), so a missed obligation ends the campaign, per the design doc's stated
 * failure state.
 */
export function resolveMaturingObligations(
  state: GameState,
  week: number,
  exchangeRates: ExchangeRates,
): MaturityResolution {
  let cash = state.cash;
  let vessels = state.vessels;
  let scarcity = state.scarcity;
  let insolvent = false;
  const obligations: Obligation[] = [];

  const matured = state.obligations.filter(o => !o.settled && o.matureWeek <= week);
  const notYetDue = state.obligations.filter(o => o.settled || o.matureWeek > week);

  const receivables = matured.filter(o => o.direction === 'receivable');
  const payables = matured.filter(o => o.direction === 'payable');

  for (const o of receivables) {
    const defaulted = o.kind === 'loan_prince' && Math.random() < LOAN_PRINCE_DEFAULT_CHANCE;
    if (!defaulted) cash += toFlorins(o.amount, o.currency, exchangeRates);
    obligations.push({ ...o, settled: true, defaulted });
  }

  for (const o of payables) {
    if (insolvent) {
      obligations.push(o);
      continue;
    }
    const owedFlorins = toFlorins(o.amount, o.currency, exchangeRates);
    if (cash >= owedFlorins) {
      cash -= owedFlorins;
      obligations.push({ ...o, settled: true });
      continue;
    }
    const shortfall = owedFlorins - cash;
    const liquidation = liquidateForShortfall(vessels, scarcity, shortfall);
    vessels = liquidation.vessels;
    scarcity = liquidation.scarcity;
    const available = cash + liquidation.raised;
    if (available >= owedFlorins) {
      cash = available - owedFlorins;
      obligations.push({ ...o, settled: true });
    } else {
      cash = available;
      insolvent = true;
      obligations.push(o);
    }
  }

  return { cash, vessels, scarcity, obligations: [...notYetDue, ...obligations], insolvent };
}
