import { SHARE_MAJORITY, VICTORY_CASH } from '../sim/rules';
import { FONT, UI, money } from '../theme';
import { Label, Panel } from './ui';
import type { GameState } from '../sim/types';

/**
 * Everyone's position, always visible. This is a board game: cash, shares and fleet are public,
 * and hiding them would make the race unplayable rather than tense — which is also why hotseat
 * here needs no per-player fog, only a pause between turns.
 */
export default function HauliersTable({ state }: { state: GameState }) {
  const active = state.hauliers[state.activeIndex];
  const leader = Math.max(...state.hauliers.map(c => c.shares));

  return (
    <Panel title="The table" aside={<Label>{`round ${state.round}`}</Label>}>
      <table style={table}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>Haulier</th>
            <th style={th}>Cash</th>
            <th style={th}>Shares</th>
            <th style={th}>Vehicles</th>
          </tr>
        </thead>
        <tbody>
          {state.hauliers.map(haulier => {
            const vehicles = state.vehicles.filter(s => s.ownerId === haulier.id).length;
            const isActive = haulier.id === active.id;
            const isDeclarer = state.declaration?.haulierId === haulier.id;
            return (
              <tr key={haulier.id} style={isActive ? { background: UI.panelRaised } : undefined}>
                <td style={{ ...td, textAlign: 'left' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ ...dot, background: haulier.colour }} />
                    <span style={{ color: isActive ? UI.text : UI.textSoft }}>
                      {haulier.name}
                      {haulier.kind === 'ai' ? '' : ' ·'}
                    </span>
                    {isDeclarer && <span style={{ color: UI.warn, fontSize: '0.7rem' }}>claimed</span>}
                  </span>
                </td>
                <td
                  style={{
                    ...td,
                    color: haulier.cash >= VICTORY_CASH ? UI.good : UI.textSoft,
                  }}
                >
                  {money(haulier.cash)}
                </td>
                <td
                  style={{
                    ...td,
                    color:
                      haulier.shares >= SHARE_MAJORITY
                        ? UI.brass
                        : haulier.shares === leader && leader > 0
                          ? UI.text
                          : UI.textSoft,
                  }}
                >
                  {haulier.shares}
                </td>
                <td style={{ ...td, color: UI.textSoft }}>{vehicles}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ fontFamily: FONT.data, fontSize: '0.66rem', color: UI.textFaint, margin: 0 }}>
        A dot after a name marks a human haulier. Cash turns green past {money(VICTORY_CASH)}.
      </p>
    </Panel>
  );
}

const table: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontFamily: FONT.data,
  fontSize: '0.74rem',
  fontVariantNumeric: 'tabular-nums',
};

const th: React.CSSProperties = {
  textAlign: 'right',
  fontWeight: 400,
  fontSize: '0.6rem',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: UI.textFaint,
  padding: '0 0.3rem 0.3rem',
  borderBottom: `1px solid ${UI.rule}`,
};

const td: React.CSSProperties = {
  textAlign: 'right',
  padding: '0.28rem 0.3rem',
};

const dot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  display: 'inline-block',
  flex: '0 0 8px',
};
