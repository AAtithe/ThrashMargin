import { SHARE_MAJORITY, VICTORY_CASH } from '../sim/rules';
import { FONT, UI, money } from '../theme';
import { Label, Panel } from './ui';
import { assetValue } from '../sim/actions';
import type { GameState } from '../sim/types';

/**
 * Everyone's position, always visible. This is a board game: cash, shares and fleet are public,
 * and hiding them would make the race unplayable rather than tense — which is also why hotseat
 * here needs no per-player fog, only a pause between turns.
 */
export default function CaptainsTable({ state }: { state: GameState }) {
  const active = state.captains[state.activeIndex];
  /**
   * Free play has no share race, so the column that matters is worth. Showing "0 shares" beside every
   * captain for a hundred rounds tells a player nothing about who is winning.
   */
  const freePlay = state.rules === 'voyage';
  const worthOf = (c: (typeof state.captains)[number]) => assetValue(state, c);
  const leader = freePlay
    ? Math.max(...state.captains.map(worthOf))
    : Math.max(...state.captains.map(c => c.shares));

  return (
    <Panel title="The table" aside={<Label>{`round ${state.round}`}</Label>}>
      <table style={table}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>Captain</th>
            <th style={th}>Cash</th>
            <th style={th}>{freePlay ? 'Worth' : 'Shares'}</th>
            <th style={th}>Ships</th>
          </tr>
        </thead>
        <tbody>
          {state.captains.map(captain => {
            const ships = state.ships.filter(s => s.ownerId === captain.id).length;
            const isActive = captain.id === active.id;
            const isDeclarer = state.declaration?.captainId === captain.id;
            return (
              <tr key={captain.id} style={isActive ? { background: UI.panelRaised } : undefined}>
                <td style={{ ...td, textAlign: 'left' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ ...dot, background: captain.colour }} />
                    <span style={{ color: isActive ? UI.text : UI.textSoft }}>
                      {captain.name}
                      {captain.kind === 'ai' ? '' : ' ·'}
                    </span>
                    {isDeclarer && <span style={{ color: UI.warn, fontSize: '0.7rem' }}>claimed</span>}
                  </span>
                </td>
                <td
                  style={{
                    ...td,
                    color: captain.cash >= VICTORY_CASH ? UI.good : UI.textSoft,
                  }}
                >
                  {money(captain.cash)}
                </td>
                <td
                  style={{
                    ...td,
                    color:
                      !freePlay && captain.shares >= SHARE_MAJORITY
                        ? UI.brass
                        : (freePlay ? worthOf(captain) : captain.shares) === leader && leader > 0
                          ? UI.text
                          : UI.textSoft,
                  }}
                >
                  {freePlay ? money(worthOf(captain)) : captain.shares}
                </td>
                <td style={{ ...td, color: UI.textSoft }}>{ships}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ fontFamily: FONT.data, fontSize: '0.66rem', color: UI.textFaint, margin: 0 }}>
        A dot after a name marks a human captain.{' '}
        {freePlay
          ? 'Worth counts cash, cargo, hulls and holdings, less anything owed.'
          : `Cash turns green past ${money(VICTORY_CASH)}.`}
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
