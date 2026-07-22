import type { CurrencyId, ExchangeRates } from './types';

export interface Currency {
  id: CurrencyId;
  name: string;
  symbol: string;
}

/**
 * Five currencies grouped by City.power (confirmed 2026-07-19): florin is the player's home
 * ledger currency (and Florence's own), groot covers Burgundy/Flanders, pound covers England,
 * écu covers Savoy/France/Milan/Genoa, ducat covers Venice. Pegs below are simplified money-of-
 * account values relative to the florin, not literal historical mint weights — a flavour pass
 * can sharpen them later without touching the mechanic. `asper` (Chapter 2, Phase 9) adds
 * Trebizond on the same basis.
 */
export const CURRENCIES: Currency[] = [
  { id: 'florin', name: 'Florentine florin', symbol: 'f' },
  { id: 'groot', name: 'Flemish groot', symbol: 'g' },
  { id: 'pound', name: 'Pound sterling', symbol: '£' },
  { id: 'ecu', name: 'Écu', symbol: 'é' },
  { id: 'ducat', name: 'Venetian ducat', symbol: 'd' },
  { id: 'asper', name: 'Trapezuntine asper', symbol: 'a' },
];

const PEG: ExchangeRates = {
  florin: 1,
  groot: 0.9,
  pound: 1.3,
  ecu: 0.95,
  ducat: 1.05,
  asper: 0.4,
};

/** Largest random walk step an exchange rate can take in a week, as a fraction of its peg. */
const DRIFT_MAX = 0.03;
/** Fraction of the gap back to par that closes each week, keeping rates from wandering forever. */
const REVERSION_RATE = 0.08;
const BAND = 0.25;

export function findCurrency(id: CurrencyId): Currency {
  return CURRENCIES.find(c => c.id === id) ?? CURRENCIES[0];
}

export function initialExchangeRates(): ExchangeRates {
  return { ...PEG };
}

/** Backfills any currency missing from a *loaded* save's exchange rates at its peg value — a
 * save from before that currency existed (e.g. `asper`, Chapter 2) would otherwise read
 * `undefined` in any consumer (display, bill-writing) that runs before the first ADVANCE_WEEK,
 * which is the only place `driftExchangeRates`'s own missing-key fallback would normally apply. */
export function withAllCurrencies(rates: ExchangeRates): ExchangeRates {
  return { ...initialExchangeRates(), ...rates };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Rates random-walk week to week but mean-revert toward par, so drift is a risk, not a trend.
 * Falls back to par for a currency missing from `rates` — a save from before that currency
 * existed (e.g. a Chapter 1 campaign in progress when `asper` shipped) rather than drifting
 * `undefined` into `NaN` forever. */
export function driftExchangeRates(rates: ExchangeRates): ExchangeRates {
  const next: ExchangeRates = { ...rates };
  for (const currency of CURRENCIES) {
    if (currency.id === 'florin') continue;
    const par = PEG[currency.id];
    const current = rates[currency.id] ?? par;
    const reverted = current + (par - current) * REVERSION_RATE;
    const delta = (Math.random() * 2 - 1) * DRIFT_MAX * par;
    next[currency.id] = clamp(reverted + delta, par * (1 - BAND), par * (1 + BAND));
  }
  return next;
}

/** Florins one unit of `currency` buys at the current rate. */
export function toFlorins(amount: number, currency: CurrencyId, rates: ExchangeRates): number {
  return amount * rates[currency];
}

/** Units of `currency` a florin amount buys at the current rate. */
export function fromFlorins(florins: number, currency: CurrencyId, rates: ExchangeRates): number {
  return florins / rates[currency];
}
