import { findCity } from '../sim/content';
import { CURRENCIES, findCurrency, toFlorins } from '../sim/currency';
import type { ExchangeRates, Obligation, ObligationKind } from '../sim/types';

const LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '0.9rem 0 0.4rem',
};

const LIST: React.CSSProperties = {
  maxHeight: '180px',
  overflowY: 'auto',
  paddingRight: '0.3rem',
};

const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
  padding: '0.3rem 0',
  borderBottom: '1px solid #2a2117',
  fontSize: '0.75rem',
};

const SMALL_BUTTON: React.CSSProperties = {
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  padding: '0.2rem 0.5rem',
  fontFamily: 'inherit',
  fontSize: '0.7rem',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const KIND_LABEL: Record<ObligationKind, string> = {
  bill_payable: 'Bill owed',
  deposit: 'Deposit owed',
  loan_merchant: 'Merchant loan due in',
  loan_prince: 'Prince loan due in',
};

interface LedgerPanelProps {
  week: number;
  cash: number;
  exchangeRates: ExchangeRates;
  obligations: Obligation[];
  flags: Record<string, boolean>;
  onDiscount: (obligationId: string) => void;
}

/**
 * The balance sheet: totals, exchange rates, and the maturity ladder (design doc §11, screen 2).
 * Bill/deposit/loan *issuance* lives in the separate `CountingHousePanel` (§11, screen 3) as of
 * Phase 13 — Phase 4 had folded the two together for expedience; this restores the original split.
 * "Discount now" stays here rather than moving to Counting House: it acts on a specific visible
 * ladder row, and moving it would force switching panels mid-action to re-find the same row — the
 * same consolidation-for-usability call Phase 4 and Phase 11 each made in their own day.
 */
export default function LedgerPanel({ week, cash, exchangeRates, obligations, flags, onDiscount }: LedgerPanelProps) {
  // Chapter 0: credit isn't Claes's to extend until he's formally made the house's factor.
  if (!flags.chapter0_complete) return null;

  const ladder = obligations
    .filter(o => !o.settled)
    .map(o => ({
      ...o,
      weeksUntil: o.matureWeek - week,
      florinValue: Math.round(toFlorins(o.amount, o.currency, exchangeRates)),
    }))
    .sort((a, b) => a.matureWeek - b.matureWeek);

  const dueSoon = ladder.filter(o => o.weeksUntil <= 12);
  const beyond = ladder.filter(o => o.weeksUntil > 12);

  const payableTotal = ladder.filter(o => o.direction === 'payable').reduce((sum, o) => sum + o.florinValue, 0);
  const receivableTotal = ladder.filter(o => o.direction === 'receivable').reduce((sum, o) => sum + o.florinValue, 0);

  return (
    <div>
      <p style={LABEL}>Ledger</p>
      <p style={{ fontSize: '0.75rem', margin: 0, color: '#8a7a5a' }}>
        Owed to others: <span style={{ color: '#b5451a' }}>{payableTotal}f</span>
        {' · '}
        Owed to you: <span style={{ color: '#3a6b5a' }}>{receivableTotal}f</span>
      </p>

      <p style={LABEL}>Exchange rates (florins per unit)</p>
      <div style={{ fontSize: '0.7rem', color: '#8a7a5a', display: 'flex', gap: '0.7rem', flexWrap: 'wrap' }}>
        {CURRENCIES.filter(c => c.id !== 'florin').map(c => (
          <span key={c.id}>
            {c.symbol} {c.name}: {exchangeRates[c.id].toFixed(2)}f
          </span>
        ))}
      </div>

      <p style={LABEL}>Maturity ladder{beyond.length > 0 ? ` — next 12 weeks (+${beyond.length} later)` : ''}</p>
      <div style={LIST}>
        {dueSoon.length === 0 && <p style={{ fontSize: '0.75rem', color: '#8a7a5a' }}>Nothing due soon.</p>}
        {dueSoon.map(o => {
          const currency = findCurrency(o.currency);
          const city = findCity(o.cityId);
          return (
            <div key={o.id} style={ROW}>
              <div style={{ flex: 1 }}>
                <span style={{ color: o.direction === 'payable' ? '#b5451a' : '#3a6b5a' }}>
                  {o.direction === 'payable' ? '−' : '+'}
                  {o.florinValue}f
                </span>
                {' · '}
                {KIND_LABEL[o.kind]} {o.weeksUntil} week{o.weeksUntil === 1 ? '' : 's'}
                {o.kind === 'bill_payable' && ` · ${city?.name ?? o.cityId} (${currency.symbol})`}
              </div>
              {o.direction === 'receivable' && o.weeksUntil > 0 && (
                <button style={SMALL_BUTTON} onClick={() => onDiscount(o.id)}>
                  Discount now
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: '0.65rem', color: '#6a5a40', margin: '0.3rem 0 0' }}>Cash on hand: {Math.round(cash)}f</p>
    </div>
  );
}
