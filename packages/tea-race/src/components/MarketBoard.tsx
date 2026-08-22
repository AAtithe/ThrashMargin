/**
 * Free play's replacement for the commission board: where the money is, right now.
 *
 * In voyage mode there are no cards, so the question the left column has to answer changes from
 * "which of these five should I chase" to "what is worth carrying, and to whom". This shows the best
 * spreads on the chart — buy here, sell there, this much a lot — with the ones the selected ship
 * could start on this turn picked out.
 *
 * Drawn from the same `bestSpreads` the computer captains reason from, deliberately. A human should
 * never be beaten by information they could not have looked up.
 */

import { GOOD_BY_ID, portName } from '../sim/content';
import { bestSpreads, roundsLeft, VOYAGE_ROUNDS } from '../sim/voyage';
import { FONT, UI, money } from '../theme';
import { Empty, Label, Panel, bodySmall, dataText } from './ui';
import type { GameState, Ship } from '../sim/types';

export default function MarketBoard({
  state,
  reference,
  onPortClick,
}: {
  state: GameState;
  reference: Ship | null;
  onPortClick: (port: string) => void;
}) {
  const at = reference?.location ?? null;
  // Two lists: what she could start on where she stands, and the best on the whole chart.
  const local = at ? bestSpreads(state, at, 4).filter(sp => sp.margin > 0) : [];
  const global = bestSpreads(state, null, 6).filter(sp => sp.margin > 0);

  const carrying = reference?.hold[0]?.good ?? null;

  return (
    <Panel
      title="The market"
      aside={
        <Label>
          {roundsLeft(state)} of {VOYAGE_ROUNDS} rounds left
        </Label>
      }
    >
      <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.textFaint }}>
        No commissions in free play — buy where a good is grown and sell where it is wanted. Every
        purchase lifts that port's price and every landing depresses it, so a run that everyone else
        is making stops being worth making.
      </p>

      {carrying && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          <Label>Her hold — best buyers</Label>
          {bestBuyers(state, carrying).map(b => (
            <button key={b.port} type="button" style={row} onClick={() => onPortClick(b.port)}>
              <span style={{ color: UI.text, minWidth: '8rem' }}>{portName(b.port)}</span>
              <span style={{ ...dataText, color: UI.verdigris }}>{money(b.price)} a lot</span>
            </button>
          ))}
        </div>
      )}

      {at && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          <Label>From {portName(at)}</Label>
          {local.length === 0 ? (
            <Empty>Nothing here is worth lading. Try a producing port.</Empty>
          ) : (
            local.map(sp => (
              <button
                key={`${sp.good}-${sp.to}`}
                type="button"
                style={row}
                onClick={() => onPortClick(sp.to)}
              >
                <span style={{ ...swatch, background: GOOD_BY_ID[sp.good]?.colour ?? UI.textFaint }} />
                <span style={{ color: UI.text, minWidth: '5rem' }}>{GOOD_BY_ID[sp.good]?.name}</span>
                <span style={{ ...dataText, color: UI.textFaint }}>
                  {money(sp.buy)} → {portName(sp.to)}
                </span>
                <span style={{ ...dataText, color: UI.brass, marginLeft: 'auto' }}>
                  +{money(sp.margin)}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
        <Label>Best on the chart</Label>
        {global.map(sp => (
          <button
            key={`g-${sp.good}-${sp.from}-${sp.to}`}
            type="button"
            style={row}
            onClick={() => onPortClick(sp.from)}
          >
            <span style={{ ...swatch, background: GOOD_BY_ID[sp.good]?.colour ?? UI.textFaint }} />
            <span style={{ color: UI.text, minWidth: '5rem' }}>{GOOD_BY_ID[sp.good]?.name}</span>
            <span style={{ ...dataText, color: UI.textFaint }}>
              {portName(sp.from)} → {portName(sp.to)}
            </span>
            <span style={{ ...dataText, color: UI.brass, marginLeft: 'auto' }}>
              +{money(sp.margin)}
            </span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

/** The three ports paying most for a good, so a laden ship knows where to run. */
function bestBuyers(state: GameState, good: string) {
  return bestSpreads(state, null, 40)
    .filter(sp => sp.good === good)
    .reduce<{ port: string; price: number }[]>((acc, sp) => {
      if (!acc.some(a => a.port === sp.to)) acc.push({ port: sp.to, price: sp.sell });
      return acc;
    }, [])
    .sort((a, b) => b.price - a.price)
    .slice(0, 3);
}

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.4rem',
  width: '100%',
  background: 'transparent',
  border: `1px solid ${UI.rule}`,
  borderRadius: 2,
  padding: '0.3rem 0.4rem',
  fontFamily: FONT.body,
  fontSize: '0.78rem',
  cursor: 'pointer',
  textAlign: 'left',
};

const swatch: React.CSSProperties = {
  width: '0.5rem',
  height: '0.5rem',
  borderRadius: 1,
  flex: '0 0 auto',
};
