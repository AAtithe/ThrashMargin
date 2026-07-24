import { useState } from 'react';
import { CITIES, HOME_CITY } from '../sim/content';
import { findCurrency } from '../sim/currency';
import { MAX_TERM_WEEKS, MIN_TERM_WEEKS } from '../sim/credit';

const LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '0.9rem 0 0.4rem',
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

interface CountingHousePanelProps {
  flags: Record<string, boolean>;
  onWriteBill: (cityId: string, florins: number, termWeeks: number) => void;
  onTakeDeposit: (florins: number, termWeeks: number) => void;
  onWriteLoan: (kind: 'merchant' | 'prince', florins: number, termWeeks: number) => void;
}

/**
 * Bill/deposit/loan issuance (design doc §11, screen 3, "Counting house") — split out of
 * `LedgerPanel` in Phase 13, which keeps the balance sheet/maturity ladder ("Discount now" stays
 * there too, deliberately — see that component's own note). No "protest" form: nothing in the sim
 * implements protesting a bill, so there's nothing here to split out for it yet.
 */
export default function CountingHousePanel({ flags, onWriteBill, onTakeDeposit, onWriteLoan }: CountingHousePanelProps) {
  const [billCity, setBillCity] = useState(CITIES.find(c => c.id !== HOME_CITY)?.id ?? HOME_CITY);
  const [billFlorins, setBillFlorins] = useState(50);
  const [billTerm, setBillTerm] = useState(8);

  const [depositFlorins, setDepositFlorins] = useState(20);
  const [depositTerm, setDepositTerm] = useState(8);

  const [loanKind, setLoanKind] = useState<'merchant' | 'prince'>('merchant');
  const [loanFlorins, setLoanFlorins] = useState(20);
  const [loanTerm, setLoanTerm] = useState(8);

  // Chapter 0: credit isn't Claes's to extend until he's formally made the house's factor.
  if (!flags.chapter0_complete) return null;

  return (
    <div>
      <p style={LABEL}>Counting House</p>

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
        <button id="counting-house-borrow-button" style={SMALL_BUTTON} onClick={() => onWriteBill(billCity, billFlorins, billTerm)}>
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
    </div>
  );
}
