import { GOOD_BY_ID, portName } from '../sim/content';
import { HOLD_SLOTS } from '../sim/rules';
import { destinationOf, pointsToDestination } from '../sim/movement';
import { FONT, UI, money } from '../theme';
import { Label, Panel } from './ui';
import type { GameState } from '../sim/types';

/**
 * What every other captain is actually doing.
 *
 * The whole board is public information in this game, so hiding it was never a design choice, just
 * friction — you could see rival hulls on the chart but had no way to tell what they carried or
 * where they were bound without hovering each one. Since only the first two ships home are paid,
 * knowing who is already loaded and closer than you is the single most useful thing on the screen.
 */
export default function RivalFleets({
  state,
  viewerId,
}: {
  state: GameState;
  viewerId: string | null;
}) {
  const rivals = state.captains.filter(c => c.id !== viewerId);

  return (
    <Panel title="The other captains" aside={<Label>everything is public</Label>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {rivals.map(captain => {
          const ships = state.ships.filter(s => s.ownerId === captain.id);
          return (
            <div key={captain.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
                <span style={{ ...dot, background: captain.colour }} />
                <span style={{ fontFamily: FONT.display, fontSize: '0.84rem', color: UI.text }}>
                  {captain.name}
                </span>
                <span style={{ ...meta, color: UI.brass }}>{money(captain.cash)}</span>
                <span style={{ ...meta, color: UI.verdigris }}>{captain.shares} sh</span>
              </div>

              {ships.length === 0 ? (
                <span style={{ ...meta, paddingLeft: '1rem' }}>no ships</span>
              ) : (
                ships.map(ship => {
                  const dest = destinationOf(ship);
                  return (
                    <div key={ship.id} style={row}>
                      <span style={{ ...meta, color: UI.textSoft, minWidth: 0 }}>{ship.name}</span>
                      <span style={{ ...meta, color: UI.textFaint }}>
                        {ship.location
                          ? portName(ship.location)
                          : dest
                            ? `→ ${portName(dest)} (${pointsToDestination(ship)})`
                            : 'at sea'}
                      </span>
                      <span style={{ display: 'flex', gap: '0.15rem', flexWrap: 'wrap' }}>
                        {ship.hold.length === 0 ? (
                          <span style={{ ...meta, color: UI.textFaint }}>light</span>
                        ) : (
                          ship.hold.map((lot, i) => (
                            <span
                              key={i}
                              title={GOOD_BY_ID[lot.good]?.name ?? lot.good}
                              style={{
                                width: 7,
                                height: 7,
                                borderRadius: 1,
                                background: GOOD_BY_ID[lot.good]?.colour ?? UI.textFaint,
                              }}
                            />
                          ))
                        )}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
      <p style={{ ...meta, margin: 0, color: UI.textFaint }}>
        Coloured squares are loaded slots, up to {HOLD_SLOTS}. Only the first two ships home are paid,
        so a rival already loaded and closer than you has the race.
      </p>
    </Panel>
  );
}

const row: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '5.5rem 1fr auto',
  gap: '0.4rem',
  alignItems: 'center',
  paddingLeft: '1rem',
};

const meta: React.CSSProperties = {
  fontFamily: FONT.data,
  fontSize: '0.66rem',
  fontVariantNumeric: 'tabular-nums',
  color: UI.textSoft,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const dot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  display: 'inline-block',
  flex: '0 0 8px',
};
