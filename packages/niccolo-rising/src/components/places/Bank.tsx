import { useState } from 'react';
import { CONFIG, perks } from '../../sim/content';
import { FONT, UI } from '../../theme';
import { duration, gr } from '../../lib/format';
import { Blurb, Meta, Panel, Row } from '../ui';
import ActButton from './ActButton';
import type { PlaceProps } from '../types';

export default function Bank(p: PlaceProps) {
  const { s, now } = p;
  const [amount, setAmount] = useState('');
  const n = Math.floor(Number(amount));
  return (
    <Panel title="The Medici counting house">
      <Blurb>
        Tommaso Portinari takes deposits for a fixed term and pays at maturity, not before. One deposit at a time. It is
        the only income in Bruges that needs no Energy and no Nerve.
      </Blurb>
      {s.deposit ? (
        <Row>
          <Meta colour={UI.verdigris}>
            {gr(s.deposit.amount)} at {s.deposit.pct}%, matures in {duration(s.deposit.matures - now)}, paying{' '}
            {gr(s.deposit.amount * (1 + s.deposit.pct / 100))}
          </Meta>
        </Row>
      ) : (
        <>
          <Row>
            <input
              value={amount}
              onChange={e => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder={`at least ${CONFIG.bank.minDeposit}`}
              style={{ flex: 1, background: UI.ground, border: `1px solid ${UI.rule}`, color: UI.text, fontFamily: FONT.data, padding: '0.4rem 0.6rem' }}
            />
            <button
              type="button"
              onClick={() => setAmount(String(s.groats))}
              style={{ background: 'transparent', border: `1px solid ${UI.rule}`, color: UI.textSoft, padding: '0.35rem 0.6rem', cursor: 'pointer' }}
            >
              All
            </button>
          </Row>
          {CONFIG.bank.terms.map(t => {
            // The same rounding the sim applies, so the quote is what the deposit will pay.
            const pct = Math.round(t.pct * (1 + perks(s).depositPct / 100) * 100) / 100;
            return (
            <Row key={t.days}>
              <Meta>
                {t.days} day{t.days === 1 ? '' : 's'} at {pct}%{n > 0 ? `: returns ${gr(n * (1 + pct / 100))}` : ''}
              </Meta>
              <ActButton p={p} verb={{ type: 'DEPOSIT', amount: n, days: t.days }}>Deposit</ActButton>
            </Row>
            );
          })}
        </>
      )}
    </Panel>
  );
}
