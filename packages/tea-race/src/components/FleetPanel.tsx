import { GOOD_BY_ID, portName } from '../sim/content';
import { HOLD_SLOTS } from '../sim/rules';
import { destinationOf, pointsToDestination } from '../sim/movement';
import { FONT, UI, money } from '../theme';
import { Label, Panel, Pill, bodySmall, dataText } from './ui';
import type { Captain, Ship } from '../sim/types';

interface Props {
  ships: Ship[];
  captain: Captain;
  sailPoints: Record<string, number>;
  dice: Record<string, [number, number]>;
  selectedShipId: string | null;
  onSelect: (shipId: string) => void;
  /** False before the captain has rolled — the wind figures are not known yet. */
  rolled: boolean;
}

/** The active captain's ships: where each one is, what she's carrying, what wind she has left. */
export default function FleetPanel({
  ships,
  captain,
  sailPoints,
  dice,
  selectedShipId,
  onSelect,
  rolled,
}: Props) {
  return (
    <Panel
      title="Your fleet"
      aside={<Label>{ships.length === 1 ? 'one ship' : `${ships.length} ships`}</Label>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {ships.map(ship => {
          const selected = ship.id === selectedShipId;
          const points = sailPoints[ship.id] ?? 0;
          const roll = dice[ship.id];
          const dest = destinationOf(ship);


          return (
            <button
              key={ship.id}
              type="button"
              id={`ship-button-${ship.id}`}
              onClick={() => onSelect(ship.id)}
              style={{
                ...row,
                borderColor: selected ? captain.colour : UI.rule,
                background: selected ? UI.panelRaised : 'transparent',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem' }}>
                <span style={{ fontFamily: FONT.display, fontSize: '0.9rem', color: UI.text }}>
                  {ship.name}
                </span>
                {rolled &&
                  (points > 0 ? (
                    <span style={{ ...dataText, color: UI.brass, fontSize: '0.72rem' }}>
                      {points} pts{roll ? ` (${roll[0]}+${roll[1]})` : ''}
                    </span>
                  ) : (
                    <span style={{ ...dataText, color: UI.textFaint, fontSize: '0.72rem' }}>
                      {roll ? `${roll[0]}+${roll[1]} spent` : 'no wind'}
                    </span>
                  ))}
              </span>

              <span style={{ ...bodySmall, fontSize: '0.78rem' }}>
                {ship.location
                  ? `Tied up at ${portName(ship.location)}`
                  : dest
                    ? `At sea — ${pointsToDestination(ship)} pts to ${portName(dest)}`
                    : 'At sea'}
              </span>

              <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', alignItems: 'center' }}>
                {ship.hold.length === 0 ? (
                  <span style={{ ...dataText, fontSize: '0.68rem', color: UI.textFaint }}>
                    hold empty — {HOLD_SLOTS} slots
                  </span>
                ) : (
                  <>
                    {ship.hold.map((lot, i) => {
                      const g = GOOD_BY_ID[lot.good];
                      return (
                        <Pill key={i} colour={g?.colour ?? UI.textSoft}>
                          {g?.name ?? lot.good} {money(lot.paid)}
                        </Pill>
                      );
                    })}
                    <span style={{ ...dataText, fontSize: '0.66rem', color: UI.textFaint }}>
                      {ship.hold.length}/{HOLD_SLOTS}
                    </span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

const row: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  textAlign: 'left',
  border: '1px solid',
  borderRadius: 2,
  padding: '0.45rem 0.55rem',
  cursor: 'pointer',
  font: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};
