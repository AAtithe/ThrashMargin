import { useState } from 'react';
import { CONFIG, DAY } from '../../sim/content';
import { FONT, UI } from '../../theme';
import { duration, gr } from '../../lib/format';
import { Blurb, Button, Meta, Panel, Row } from '../ui';
import ActButton from './ActButton';
import { TimerBar } from '../motion';
import type { PlaceProps } from '../types';

export default function Bank(p: PlaceProps) {
  const { s, now } = p;
  const [amount, setAmount] = useState('');
  const n = Math.floor(Number(amount));
  // The deposit records its rate, not its term; the rate names the term (display only).
  const term = s.deposit ? CONFIG.bank.terms.find(t => t.pct === s.deposit!.pct) : undefined;
  return (
    <Panel title="The Medici counting house">
      <Blurb>
        Tommaso Portinari takes deposits for a fixed term and pays at maturity, not before. One deposit at a time. It is
        the only income in Bruges that needs no Energy and no Nerve.
      </Blurb>
      {s.deposit ? (
        <>
          <Row>
            <Meta colour={UI.verdigris}>
              {gr(s.deposit.amount)} at {s.deposit.pct}%, matures in {duration(s.deposit.matures - now)}, paying{' '}
              {gr(s.deposit.amount * (1 + s.deposit.pct / 100))}
            </Meta>
          </Row>
          {term && <TimerBar start={s.deposit.matures - term.days * DAY} end={s.deposit.matures} now={now} colour={UI.verdigris} style={{ height: 3, marginTop: 0 }} />}
        </>
      ) : (
        <>
          <Row>
            <input
              className="nr-field"
              aria-label="Groats to deposit"
              inputMode="numeric"
              value={amount}
              onChange={e => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder={`at least ${CONFIG.bank.minDeposit}`}
              style={{ flex: 1, minWidth: 0, background: UI.ground, border: `1px solid ${UI.ruleStrong}`, color: UI.text, fontFamily: FONT.data, fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}
            />
            <Button tone="quiet" onClick={() => setAmount(String(s.groats))}>
              All
            </Button>
          </Row>
          {CONFIG.bank.terms.map(t => (
            <Row key={t.days}>
              <Meta>
                {t.days} day{t.days === 1 ? '' : 's'} at {t.pct}%{n > 0 ? `: returns ${gr(n * (1 + t.pct / 100))}` : ''}
              </Meta>
              <ActButton p={p} verb={{ type: 'DEPOSIT', amount: n, days: t.days }}>Deposit</ActButton>
            </Row>
          ))}
        </>
      )}
    </Panel>
  );
}
