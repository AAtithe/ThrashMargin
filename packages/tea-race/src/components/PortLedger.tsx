import { useMemo, useState } from 'react';
import { GOOD_BY_ID, PORTS, distanceBetween } from '../sim/content';
import { FONT, UI, money } from '../theme';
import { Panel } from './ui';
import type { Contract, GoodId, PortId, Ship } from '../sim/types';

interface Props {
  contracts: Contract[];
  /** Distances are measured from this ship, when one is selected. */
  reference: Ship | null;
  /** Clicking a port here does the same thing as clicking it on the chart. */
  onPortClick: (portId: PortId) => void;
  targetPort: PortId | null;
}

const REGION_NAMES: Record<string, string> = {
  britain: 'Britain',
  europe: 'Europe & the Mediterranean',
  north_america: 'North America',
  caribbean: 'The Caribbean',
  south_america: 'South America',
  pacific_america: 'The Pacific coast',
  africa: 'Africa',
  indian_ocean: 'India & the Indian Ocean',
  east_indies: 'The East Indies',
  far_east: 'The Far East',
  australasia: 'Australasia',
};

const REGION_ORDER = [
  'britain',
  'europe',
  'north_america',
  'caribbean',
  'south_america',
  'pacific_america',
  'africa',
  'indian_ocean',
  'east_indies',
  'far_east',
  'australasia',
];

type Mode = 'sells' | 'buys';

/**
 * What every port trades, on the board at all times — the printed table the 1988 board carried
 * around the edge of its map.
 *
 * This is reference, not decoration. Without it, working out where to load a cargo means clicking
 * ports one at a time and reading the Orders panel, which is exactly the kind of hunting a printed
 * board never made you do. Sells and buys are separate views rather than crammed together: at any
 * given moment a captain is asking one question or the other, never both.
 */
export default function PortLedger({ contracts, reference, onPortClick, targetPort }: Props) {
  const [mode, setMode] = useState<Mode>('sells');
  const [onlyWanted, setOnlyWanted] = useState(false);

  /** Goods a live commission wants loaded at, or landed at, each port. */
  const { hotSources, hotSinks } = useMemo(() => {
    const sources: Record<PortId, Set<GoodId>> = {};
    const sinks: Record<PortId, Set<GoodId>> = {};
    for (const c of contracts) {
      if (c.fills.length >= 2) continue;
      (sources[c.source] ??= new Set()).add(c.good);
      (sinks[c.destination] ??= new Set()).add(c.good);
    }
    return { hotSources: sources, hotSinks: sinks };
  }, [contracts]);

  const from = reference?.location ?? reference?.voyage?.route[reference.voyage.route.length - 1] ?? null;

  const grouped = useMemo(() => {
    const hot = mode === 'sells' ? hotSources : hotSinks;
    return REGION_ORDER.map(region => ({
      region,
      ports: PORTS.filter(p => p.region === region).filter(
        p => !onlyWanted || (hot[p.id]?.size ?? 0) > 0,
      ),
    })).filter(g => g.ports.length > 0);
  }, [mode, onlyWanted, hotSources, hotSinks]);

  return (
    <Panel
      title="What the ports trade"
      aside={
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={switcher} role="group" aria-label="Show what ports sell or buy">
            {(['sells', 'buys'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                style={{
                  ...switchButton,
                  ...(mode === m ? { background: UI.brass, color: UI.ground } : {}),
                }}
              >
                {m === 'sells' ? 'Sells' : 'Buys'}
              </button>
            ))}
          </div>
          <label style={{ ...checkboxLabel }}>
            <input
              type="checkbox"
              checked={onlyWanted}
              onChange={e => setOnlyWanted(e.target.checked)}
              style={{ accentColor: UI.brass }}
            />
            on a commission
          </label>
        </div>
      }
    >
      <div style={grid}>
        {grouped.map(group => (
          <div key={group.region} style={{ display: 'contents' }}>
            <h3 style={regionHeading}>{REGION_NAMES[group.region] ?? group.region}</h3>
            {group.ports.map(port => {
              const goods = mode === 'sells' ? port.supplies : port.demands;
              const hot = (mode === 'sells' ? hotSources : hotSinks)[port.id];
              const away = from && from !== port.id ? distanceBetween(from, port.id) : null;
              const isTarget = port.id === targetPort;

              return (
                <button
                  key={port.id}
                  type="button"
                  onClick={() => onPortClick(port.id)}
                  style={{
                    ...portCell,
                    borderColor: isTarget ? UI.brass : UI.rule,
                    background: isTarget ? UI.panelRaised : 'transparent',
                  }}
                >
                  <span style={portHead}>
                    <span style={{ fontFamily: FONT.display, fontSize: '0.82rem', color: UI.text }}>
                      {port.name}
                      {port.home ? ' ⚓' : ''}
                    </span>
                    {away !== null && Number.isFinite(away) && (
                      <span style={{ ...distance }}>{away} pts</span>
                    )}
                  </span>

                  {goods.length === 0 ? (
                    <span style={{ ...goodChip, color: UI.textFaint, borderColor: 'transparent' }}>
                      nothing
                    </span>
                  ) : (
                    <span style={chipRow}>
                      {goods.map(id => {
                        const good = GOOD_BY_ID[id];
                        const wanted = hot?.has(id);
                        return (
                          <span
                            key={id}
                            title={
                              wanted
                                ? `A commission wants ${good?.name} ${mode === 'sells' ? 'loaded' : 'landed'} here`
                                : `${good?.name} — ${money(good?.basePrice ?? 0)} a lot`
                            }
                            style={{
                              ...goodChip,
                              color: wanted ? UI.ground : good?.colour ?? UI.textSoft,
                              background: wanted ? good?.colour ?? UI.brass : 'transparent',
                              borderColor: wanted ? good?.colour ?? UI.brass : UI.rule,
                              fontWeight: wanted ? 600 : 400,
                            }}
                          >
                            {good?.name ?? id}
                          </span>
                        );
                      })}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <p style={footnote}>
        {mode === 'sells'
          ? 'Where a cargo can be loaded. A filled chip means a face-up commission wants that good from this quay.'
          : 'Where a cargo can be landed or, failing a commission, dumped at half price.'}
        {from && ' Distances are from the selected ship.'}
      </p>
    </Panel>
  );
}

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
  gap: '0.4rem',
  alignItems: 'start',
};

const regionHeading: React.CSSProperties = {
  gridColumn: '1 / -1',
  margin: '0.35rem 0 0',
  fontFamily: FONT.data,
  fontSize: '0.58rem',
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: UI.textFaint,
  borderBottom: `1px solid ${UI.rule}`,
  paddingBottom: '0.2rem',
};

const portCell: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  alignItems: 'flex-start',
  textAlign: 'left',
  border: '1px solid',
  borderRadius: 2,
  padding: '0.35rem 0.45rem',
  cursor: 'pointer',
  font: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

const portHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '0.4rem',
  width: '100%',
};

const distance: React.CSSProperties = {
  fontFamily: FONT.data,
  fontSize: '0.62rem',
  color: UI.textFaint,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

const chipRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.18rem',
};

const goodChip: React.CSSProperties = {
  fontFamily: FONT.data,
  fontSize: '0.6rem',
  letterSpacing: '0.02em',
  border: '1px solid',
  borderRadius: 2,
  padding: '0.02rem 0.24rem',
  whiteSpace: 'nowrap',
};

const switcher: React.CSSProperties = {
  display: 'flex',
  border: `1px solid ${UI.rule}`,
  borderRadius: 2,
  overflow: 'hidden',
};

const switchButton: React.CSSProperties = {
  appearance: 'none',
  border: 0,
  background: 'transparent',
  color: UI.textSoft,
  fontFamily: FONT.data,
  fontSize: '0.62rem',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  padding: '0.2rem 0.5rem',
  cursor: 'pointer',
};

const checkboxLabel: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
  fontFamily: FONT.data,
  fontSize: '0.6rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: UI.textFaint,
  cursor: 'pointer',
};

const footnote: React.CSSProperties = {
  margin: 0,
  fontFamily: FONT.body,
  fontSize: '0.74rem',
  color: UI.textFaint,
  lineHeight: 1.4,
};
