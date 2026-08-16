import { freshness } from '../sim/rules';
import { GOOD_BY_ID, portName } from '../sim/content';
import { SHIP_CLASSES, slotsOf } from '../sim/rules';
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
  /** The turn now, and whether cargo spoils at all, for the freshness marker on each lot. */
  turn: number;
  deadlines: boolean;
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
  turn,
  deadlines,
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
                {ship.shipClass && ship.shipClass !== 'clipper' && (
                  <span style={{ color: UI.textFaint }}>
                    {SHIP_CLASSES[ship.shipClass].name} ·{' '}
                  </span>
                )}
                {ship.location ? (
                  <>
                    Tied up at {portName(ship.location)}
                    {/* Rolled for and going nowhere — the wasted roll, said before the turn ends
                        rather than after. */}
                    {points > 0 && (
                      <span style={{ color: UI.warn }}> — awaiting orders</span>
                    )}
                  </>
                ) : dest ? (
                  `At sea — ${pointsToDestination(ship)} pts to ${portName(dest)}`
                ) : (
                  'At sea'
                )}
              </span>

              <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', alignItems: 'center' }}>
                {ship.hold.length === 0 ? (
                  <span style={{ ...dataText, fontSize: '0.68rem', color: UI.textFaint }}>
                    hold empty — {slotsOf(ship.shipClass)} slots
                  </span>
                ) : (
                  <>
                    {ship.hold.map((lot, i) => {
                      const g = GOOD_BY_ID[lot.good];
                      // How much of her value the lot still has. Shown only once it has actually
                      // started to go off, so a fresh hold stays uncluttered.
                      const keeps = deadlines ? freshness(turn - lot.boughtOnTurn) : 1;
                      return (
                        <Pill key={i} colour={g?.colour ?? UI.textSoft}>
                          {g?.name ?? lot.good} {money(lot.paid)}
                          {keeps < 1 && (
                            <span style={{ color: UI.warn }}> ·{Math.round(keeps * 100)}%</span>
                          )}
                        </Pill>
                      );
                    })}
                    <span style={{ ...dataText, fontSize: '0.66rem', color: UI.textFaint }}>
                      {ship.hold.length}/{slotsOf(ship.shipClass)}
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
