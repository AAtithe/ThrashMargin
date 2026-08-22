import { freshness } from '../sim/rules';
import { GOOD_BY_ID, depotName } from '../sim/content';
import { VEHICLE_CLASSES, slotsOf } from '../sim/rules';
import { destinationOf, pointsToDestination } from '../sim/movement';
import { FONT, UI, money } from '../theme';
import { Label, Panel, Pill, bodySmall, dataText } from './ui';
import type { Haulier, Vehicle } from '../sim/types';

interface Props {
  vehicles: Vehicle[];
  haulier: Haulier;
  miles: Record<string, number>;
  dice: Record<string, [number, number]>;
  selectedVehicleId: string | null;
  onSelect: (vehicleId: string) => void;
  /** False before the haulier has rolled — the mileage isn't known yet. */
  rolled: boolean;
  /** The turn now, and whether cargo spoils at all, for the freshness marker on each lot. */
  turn: number;
  deadlines: boolean;
}

/** The active haulier's vehicles: where each one is, what she's carrying, how many miles she has left. */
export default function FleetPanel({
  vehicles,
  haulier,
  miles,
  dice,
  selectedVehicleId,
  onSelect,
  rolled,
  turn,
  deadlines,
}: Props) {
  return (
    <Panel
      title="Your fleet"
      aside={<Label>{vehicles.length === 1 ? 'one vehicle' : `${vehicles.length} vehicles`}</Label>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {vehicles.map(vehicle => {
          const selected = vehicle.id === selectedVehicleId;
          const points = miles[vehicle.id] ?? 0;
          const roll = dice[vehicle.id];
          const dest = destinationOf(vehicle);


          return (
            <button
              key={vehicle.id}
              type="button"
              id={`vehicle-button-${vehicle.id}`}
              onClick={() => onSelect(vehicle.id)}
              style={{
                ...row,
                borderColor: selected ? haulier.colour : UI.rule,
                background: selected ? UI.panelRaised : 'transparent',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem' }}>
                <span style={{ fontFamily: FONT.display, fontSize: '0.9rem', color: UI.text }}>
                  {vehicle.name}
                </span>
                {rolled &&
                  (points > 0 ? (
                    <span style={{ ...dataText, color: UI.brass, fontSize: '0.72rem' }}>
                      {points} pts{roll ? ` (${roll[0]}+${roll[1]})` : ''}
                    </span>
                  ) : (
                    <span style={{ ...dataText, color: UI.textFaint, fontSize: '0.72rem' }}>
                      {roll ? `${roll[0]}+${roll[1]} spent` : 'not rolled'}
                    </span>
                  ))}
              </span>

              <span style={{ ...bodySmall, fontSize: '0.78rem' }}>
                {vehicle.vehicleClass && vehicle.vehicleClass !== 'rigid_7_5' && (
                  <span style={{ color: UI.textFaint }}>
                    {VEHICLE_CLASSES[vehicle.vehicleClass].name} ·{' '}
                  </span>
                )}
                {vehicle.location ? (
                  <>
                    Parked up at {depotName(vehicle.location)}
                    {/* Rolled for and going nowhere — the wasted roll, said before the turn ends
                        rather than after. */}
                    {points > 0 && (
                      <span style={{ color: UI.warn }}> — awaiting orders</span>
                    )}
                  </>
                ) : dest ? (
                  `On the road — ${pointsToDestination(vehicle)} pts to ${depotName(dest)}`
                ) : (
                  'On the road'
                )}
              </span>

              <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', alignItems: 'center' }}>
                {vehicle.hold.length === 0 ? (
                  <span style={{ ...dataText, fontSize: '0.68rem', color: UI.textFaint }}>
                    hold empty — {slotsOf(vehicle.vehicleClass)} slots
                  </span>
                ) : (
                  <>
                    {vehicle.hold.map((lot, i) => {
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
                      {vehicle.hold.length}/{slotsOf(vehicle.vehicleClass)}
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
