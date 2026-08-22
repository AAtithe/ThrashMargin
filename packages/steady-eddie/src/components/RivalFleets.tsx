import { GOOD_BY_ID, depotName } from '../sim/content';
import { slotsOf } from '../sim/rules';
import { destinationOf, pointsToDestination } from '../sim/movement';
import { FONT, UI, money } from '../theme';
import { Label, Panel } from './ui';
import type { GameState } from '../sim/types';

/**
 * What every other haulier is actually doing.
 *
 * The whole board is public information in this game, so hiding it was never a design choice, just
 * friction — you could see rival vehicles on the chart but had no way to tell what they carried or
 * where they were bound without hovering each one. Since only the first two vehicles home are paid,
 * knowing who is already loaded and closer than you is the single most useful thing on the screen.
 */
export default function RivalFleets({
  state,
  viewerId,
}: {
  state: GameState;
  viewerId: string | null;
}) {
  const rivals = state.hauliers.filter(c => c.id !== viewerId);

  return (
    <Panel title="The other hauliers" aside={<Label>everything is public</Label>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {rivals.map(haulier => {
          const vehicles = state.vehicles.filter(s => s.ownerId === haulier.id);
          return (
            <div key={haulier.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
                <span style={{ ...dot, background: haulier.colour }} />
                <span style={{ fontFamily: FONT.display, fontSize: '0.84rem', color: UI.text }}>
                  {haulier.name}
                </span>
                <span style={{ ...meta, color: UI.brass }}>{money(haulier.cash)}</span>
                <span style={{ ...meta, color: UI.verdigris }}>{haulier.shares} sh</span>
              </div>

              {vehicles.length === 0 ? (
                <span style={{ ...meta, paddingLeft: '1rem' }}>no vehicles</span>
              ) : (
                vehicles.map(vehicle => {
                  const dest = destinationOf(vehicle);
                  const slots = slotsOf(vehicle.vehicleClass);
                  return (
                    <div key={vehicle.id} style={row}>
                      <span style={{ ...meta, color: UI.textSoft, minWidth: 0 }}>{vehicle.name}</span>
                      <span style={{ ...meta, color: UI.textFaint }}>
                        {vehicle.location
                          ? depotName(vehicle.location)
                          : dest
                            ? `→ ${depotName(dest)} (${pointsToDestination(vehicle)})`
                            : 'on the road'}
                      </span>
                      <span
                        title={`${vehicle.hold.length} of ${slots} slots loaded`}
                        style={{ display: 'flex', gap: '0.15rem', flexWrap: 'wrap' }}
                      >
                        {vehicle.hold.length === 0 ? (
                          <span style={{ ...meta, color: UI.textFaint }}>light</span>
                        ) : (
                          vehicle.hold.map((lot, i) => (
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
        Coloured squares are loaded slots — hover a fleet to see how full she is (capacity depends on her
        class). Only the first two vehicles home are paid, so a rival already loaded and closer than you
        has the race.
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
