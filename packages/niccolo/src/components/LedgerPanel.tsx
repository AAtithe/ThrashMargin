import { useState } from 'react';
import { CITIES, HOME_CITY, findCity } from '../sim/content';
import { CURRENCIES, findCurrency, toFlorins } from '../sim/currency';
import { MAX_TERM_WEEKS, MIN_TERM_WEEKS } from '../sim/credit';
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

const FIELD: React.CSSProperties = {
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  fontFamily: 'inherit',
  fontSize: '0.75rem',
  padding: '0.2rem 0.3rem',
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

const FORM_ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.3rem',
  marginBottom: '0.4rem',
  flexWrap: 'wrap',
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
  onWriteBill: (cityId: string, florins: number, termWeeks: number) => void;
  onTakeDeposit: (florins: number, termWeeks: number) => void;
  onWriteLoan: (kind: 'merchant' | 'prince', florins: number, termWeeks: number) => void;
  onDiscount: (obligationId: string) => void;
}

export default function LedgerPanel({
  week,
  cash,
  exchangeRates,
  obligations,
  onWriteBill,
  onTakeDeposit,
  onWriteLoan,
  onDiscount,
}: LedgerPanelProps) {
  const [billCity, setBillCity] = useState(CITIES.find(c => c.id !== HOME_CITY)?.id ?? HOME_CITY);
  const [billFlorins, setBillFlorins] = useState(50);
  const [billTerm, setBillTerm] = useState(8);

  const [depositFlorins, setDepositFlorins] = useState(20);
  const [depositTerm, setDepositTerm] = useState(8);

  const [loanKind, setLoanKind] = useState<'merchant' | 'prince'>('merchant');
  const [loanFlorins, setLoanFlorins] = useState(20);
  const [loanTerm, setLoanTerm] = useState(8);

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

      <p style={LABEL}>Write a bill of exchange</p>
      <div style={FORM_ROW}>
        <select style={FIELD} value={billCity} onChange={e => setBillCity(e.target.value)}>
          {CITIES.map(c => (
            <option key={c.id} value={c.id}>
              {c.name} ({findCurrency(c.currency).symbol})
            </option>
          ))}
        </select>
        <input
          type="number"
          style={{ ...FIELD, width: '4rem' }}
          value={billFlorins}
          min={1}
          onChange={e => setBillFlorins(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
        />
        f for
        <input
          type="number"
          style={{ ...FIELD, width: '3rem' }}
          value={billTerm}
          min={MIN_TERM_WEEKS}
          max={MAX_TERM_WEEKS}
          onChange={e => setBillTerm(Math.max(MIN_TERM_WEEKS, Math.min(MAX_TERM_WEEKS, Math.floor(Number(e.target.value)) || MIN_TERM_WEEKS)))}
        />
        wks
        <button style={SMALL_BUTTON} onClick={() => onWriteBill(billCity, billFlorins, billTerm)}>
          Borrow
        </button>
      </div>

      <p style={LABEL}>Take a deposit</p>
      <div style={FORM_ROW}>
        <input
          type="number"
          style={{ ...FIELD, width: '4rem' }}
          value={depositFlorins}
          min={1}
          onChange={e => setDepositFlorins(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
        />
        f for
        <input
          type="number"
          style={{ ...FIELD, width: '3rem' }}
          value={depositTerm}
          min={MIN_TERM_WEEKS}
          max={MAX_TERM_WEEKS}
          onChange={e => setDepositTerm(Math.max(MIN_TERM_WEEKS, Math.min(MAX_TERM_WEEKS, Math.floor(Number(e.target.value)) || MIN_TERM_WEEKS)))}
        />
        wks
        <button style={SMALL_BUTTON} onClick={() => onTakeDeposit(depositFlorins, depositTerm)}>
          Accept
        </button>
      </div>

      <p style={LABEL}>Write a loan out</p>
      <div style={FORM_ROW}>
        <select style={FIELD} value={loanKind} onChange={e => setLoanKind(e.target.value as 'merchant' | 'prince')}>
          <option value="merchant">Merchant (safe)</option>
          <option value="prince">Prince (risky)</option>
        </select>
        <input
          type="number"
          style={{ ...FIELD, width: '4rem' }}
          value={loanFlorins}
          min={1}
          onChange={e => setLoanFlorins(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
        />
        f for
        <input
          type="number"
          style={{ ...FIELD, width: '3rem' }}
          value={loanTerm}
          min={MIN_TERM_WEEKS}
          max={MAX_TERM_WEEKS}
          onChange={e => setLoanTerm(Math.max(MIN_TERM_WEEKS, Math.min(MAX_TERM_WEEKS, Math.floor(Number(e.target.value)) || MIN_TERM_WEEKS)))}
        />
        wks
        <button style={SMALL_BUTTON} onClick={() => onWriteLoan(loanKind, loanFlorins, loanTerm)}>
          Lend
        </button>
      </div>
      <p style={{ fontSize: '0.65rem', color: '#6a5a40', margin: '0.3rem 0 0' }}>Cash on hand: {Math.round(cash)}f</p>
    </div>
  );
}
