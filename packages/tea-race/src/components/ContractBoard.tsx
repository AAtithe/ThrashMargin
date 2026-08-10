import { sourcesFor, GOOD_BY_ID, distanceBetween, portName } from '../sim/content';
import { payoutFor } from '../sim/contracts';
import { FONT, UI, money } from '../theme';
import { Empty, Label, Panel, bodySmall, dataText } from './ui';
import type { Captain, Contract, Ship } from '../sim/types';

interface Props {
  contracts: Contract[];
  captains: Captain[];
  /** The ship whose position the "how far" figures are measured from, if one is selected. */
  reference: Ship | null;
  onFocus: (contract: Contract) => void;
  focusedId: string | null;
}

/**
 * The five face-up commissions. This is the screen's centre of gravity — it is what every captain
 * is racing over — so it shows the payout ladder explicitly rather than making anyone remember
 * that the multipliers are four and two.
 */
export default function ContractBoard({ contracts, captains, reference, onFocus, focusedId }: Props) {
  const nameOf = (id: string) => captains.find(c => c.id === id)?.name ?? 'someone';

  return (
    <Panel title="The exchange" aside={<Label>five commissions</Label>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {contracts.map(contract => {
          const good = GOOD_BY_ID[contract.good];
          const next = payoutFor(contract);
          const focused = contract.id === focusedId;
          // Every port that stocks the good, nearest the destination first — the list a captain
          // actually reads when deciding where to load.
          const sellers = sourcesFor(contract.good, contract.destination);

          // Distance is measured from wherever the selected ship actually is: if she is empty the
          // run starts at whichever port selling this good is nearest her, if she is already loaded
          // with the right cargo it starts at the destination. Anything else would be answering a
          // question nobody asked.
          //
          // "Nearest seller" rather than a named source port, because the card names no source —
          // sourcing is the captain's decision, and this line is the number that decision needs.
          let reach: string | null = null;
          let nearestSeller: string | null = null;
          if (reference) {
            const at = reference.location ?? reference.voyage?.route[reference.voyage.route.length - 1];
            if (at) {
              const carryingIt = reference.hold.some(lot => lot.good === contract.good);
              nearestSeller = sourcesFor(contract.good, at)[0] ?? null;
              const target = carryingIt ? contract.destination : nearestSeller;
              const legs = target ? distanceBetween(at, target) : Infinity;
              if (Number.isFinite(legs)) {
                reach = carryingIt ? `${legs} pts to deliver` : `${legs} pts to the nearest seller`;
              }
            }
          }

          return (
            <button
              key={contract.id}
              type="button"
              onClick={() => onFocus(contract)}
              style={{
                ...cardStyle,
                borderColor: focused ? UI.brass : UI.rule,
                background: focused ? UI.panelRaised : 'transparent',
              }}
            >
              <span style={{ ...swatch, background: good?.colour ?? UI.textFaint }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={goodName}>{good?.name ?? contract.good}</span>
                  <span style={{ ...dataText, color: UI.textSoft }}>{money(contract.price)} a lot</span>
                </span>

                <span style={{ ...bodySmall, color: UI.textSoft }}>
                  wanted at <strong style={{ color: UI.text }}>{portName(contract.destination)}</strong>
                </span>

                {/* Where it can be had. The card does not dictate a source, so the useful thing to
                    show is the choice: nearest first, with the selected ship's nearest picked out. */}
                <span style={{ ...bodySmall, color: UI.textFaint, fontSize: '0.72rem' }}>
                  load at{' '}
                  {sellers.length === 0
                    ? 'nowhere on this chart'
                    : sellers.map((portId, i) => (
                        <span key={portId}>
                          {i > 0 && ', '}
                          <span
                            style={
                              portId === nearestSeller
                                ? { color: UI.verdigris, fontWeight: 600 }
                                : undefined
                            }
                          >
                            {portName(portId)}
                          </span>
                        </span>
                      ))}
                </span>

                <span style={ladder}>
                  {([1, 2] as const).map(rank => {
                    const fill = contract.fills[rank - 1];
                    const multiplier = rank === 1 ? 4 : 2;
                    return (
                      <span
                        key={rank}
                        style={{
                          ...rung,
                          color: fill ? UI.textFaint : rank === 1 ? UI.brass : UI.verdigris,
                          textDecoration: fill ? 'line-through' : 'none',
                        }}
                      >
                        {rank === 1 ? '1st' : '2nd'} ×{multiplier} {money(contract.price * multiplier)}
                        {fill ? ` — ${nameOf(fill.captainId)}` : ''}
                      </span>
                    );
                  })}
                </span>

                <span style={{ display: 'flex', gap: '0.7rem', flexWrap: 'wrap' }}>
                  <span style={{ ...dataText, color: next > 0 ? UI.good : UI.textFaint, fontSize: '0.72rem' }}>
                    {next > 0 ? `pays ${money(next)} next` : 'spent'}
                  </span>
                  {reach && (
                    <span style={{ ...dataText, color: UI.textFaint, fontSize: '0.72rem' }}>{reach}</span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
        {contracts.length === 0 && <Empty>The exchange is empty.</Empty>}
      </div>
    </Panel>
  );
}

const cardStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.6rem',
  alignItems: 'stretch',
  textAlign: 'left',
  border: '1px solid',
  borderRadius: 2,
  padding: '0.5rem 0.6rem',
  cursor: 'pointer',
  font: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

const swatch: React.CSSProperties = { width: 3, flex: '0 0 3px', borderRadius: 1 };

const goodName: React.CSSProperties = {
  fontFamily: FONT.display,
  fontSize: '0.95rem',
  color: UI.text,
};

const ladder: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.05rem',
  fontFamily: FONT.data,
  fontSize: '0.68rem',
  fontVariantNumeric: 'tabular-nums',
};

const rung: React.CSSProperties = { whiteSpace: 'nowrap' };
