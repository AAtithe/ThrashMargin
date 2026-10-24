import { freshness } from '../sim/rules';
import { GOOD_BY_ID, portName } from '../sim/content';
import { SHIP_CLASSES, slotsOf } from '../sim/rules';
import { destinationOf, pointsToDestination } from '../sim/movement';
import { FONT, UI, money } from '../theme';
import { Label, Panel, Pill, bodySmall, dataText } from './ui';
import { Die, ShipProfile, TeaChest } from './Art';
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
  /** The year of the tea race now running, if one is, so new-season tea can be marked. */
  raceYear?: number | null;
  /** The extra die each ship threw cracking on this turn. */
  crackedOn?: Record<string, number>;
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
  raceYear = null,
  crackedOn = {},
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
          const racing = raceYear !== null && ship.hold.some(l => l.good === 'tea' && l.season === raceYear);
          const extra = crackedOn[ship.id];


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
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <ShipProfile
                  shipClass={ship.shipClass}
                  colour={captain.colour}
                  width={50}
                  damaged={ship.damaged}
                  pennant={racing ? UI.brass : undefined}
                />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: FONT.display, fontSize: '0.9rem', color: UI.text }}>
                    {ship.name}
                    {ship.damaged && (
                      <span style={{ ...dataText, fontSize: '0.62rem', color: UI.bad, marginLeft: '0.35rem' }}>DAMAGED</span>
                    )}
                  </span>
                  {rolled && roll && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                      <Die value={roll[0]} size={17} tone={points > 0 ? UI.brass : UI.textFaint} faint={points === 0} />
                      <Die value={roll[1]} size={17} tone={points > 0 ? UI.brass : UI.textFaint} faint={points === 0} />
                      {extra !== undefined && (
                        <Die value={extra} size={17} tone={ship.damaged ? UI.bad : UI.good} title={`cracked on: ${extra}`} />
                      )}
                      <span style={{ ...dataText, color: points > 0 ? UI.brass : UI.textFaint, fontSize: '0.72rem', marginLeft: '0.15rem' }}>
                        {points > 0 ? `${points} pts` : 'spent'}
                      </span>
                    </span>
                  )}
                  {rolled && !roll && (
                    <span style={{ ...dataText, color: UI.textFaint, fontSize: '0.72rem' }}>no wind</span>
                  )}
                </span>
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
                          {raceYear !== null && lot.good === 'tea' && lot.season === raceYear && (
                            <span title="New-season tea, running in this year's race"><TeaChest size={10} /> </span>
                          )}
                          {g?.name ?? lot.good} {lot.atSea === 'derelict' ? 'salvage' : money(lot.paid)}
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
