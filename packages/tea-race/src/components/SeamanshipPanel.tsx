import { portName } from '../sim/content';
import { destinationOf, pointsToDestination } from '../sim/movement';
import { DAMAGE_SPEED_PENALTY, REPAIR_PRICE, slotsOf } from '../sim/rules';
import { canCrackOn, openRace, raceLots, sparRisk } from '../sim/seamanship';
import { FONT, UI, money } from '../theme';
import { Die, ShipProfile, Vignette } from './Art';
import { Button, Label, Panel, bodySmall, dataText } from './ui';
import type { Captain, Encounter, GameAction, GameState, Ship } from '../sim/types';

interface Props {
  state: GameState;
  captain: Captain;
  ships: Ship[];
  dispatch: (action: GameAction) => void;
  enabled: boolean;
}

/**
 * What to do with ships already under way: answer what the sea has offered, drive the ones worth
 * driving, make good the ones that have been driven too hard.
 *
 * Its own panel rather than part of the orders, because the orders are about one docked ship and
 * this is about the whole fleet at once — and because a ship at sea used to have nothing to decide,
 * which is the gap this whole set of rules exists to fill.
 */
export default function SeamanshipPanel({ state, captain, ships, dispatch, enabled }: Props) {
  const hz = state.hazards;
  if (!hz?.pressSail && !hz?.encounters) return null;

  const weather = hz.weather ?? false;
  const race = openRace(state);
  const offers = ships
    .map(ship => ({ ship, enc: state.encounters?.[ship.id] }))
    .filter((x): x is { ship: Ship; enc: Encounter } => Boolean(x.enc));
  const driveable = ships.filter(sh => canCrackOn(state, sh));
  const driven = ships.filter(sh => state.crackedOn?.[sh.id] !== undefined);
  const hurt = ships.filter(sh => sh.damaged);

  const quiet = offers.length === 0 && driveable.length === 0 && driven.length === 0 && hurt.length === 0;

  return (
    <Panel title="Seamanship" aside={<Label>the fleet under way</Label>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
        {quiet && (
          <p style={{ ...bodySmall, margin: 0, fontSize: '0.78rem', color: UI.textFaint }}>
            {state.phase === 'act'
              ? 'Nothing at sea needs you this turn.'
              : 'Roll first. Ships at sea may then be driven for an extra die, and may meet something on the way.'}
          </p>
        )}

        {/* Encounters first: they lapse at the end of the turn. */}
        {offers.map(({ ship, enc }) => (
          <EncounterCard
            key={ship.id}
            ship={ship}
            enc={enc}
            cash={captain.cash}
            enabled={enabled}
            onAnswer={accept => dispatch({ type: 'RESOLVE_ENCOUNTER', shipId: ship.id, accept })}
          />
        ))}

        {hz.pressSail &&
          [...new Set([...driveable, ...driven])].map(ship => {
            const thrown = state.crackedOn?.[ship.id];
            const risk = sparRisk(ship, weather);
            const dest = destinationOf(ship);
            const racing = race && raceLots(ship, race).length > 0;
            return (
              <div key={ship.id} style={driveRow}>
                <ShipProfile
                  shipClass={ship.shipClass}
                  colour={captain.colour}
                  width={58}
                  damaged={ship.damaged}
                  heel={thrown !== undefined && !ship.damaged ? -8 : 0}
                  pennant={racing ? UI.brass : undefined}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: 0, flex: 1 }}>
                  <span style={{ fontFamily: FONT.display, fontSize: '0.86rem' }}>{ship.name}</span>
                  <span style={{ ...bodySmall, fontSize: '0.74rem' }}>
                    {ship.voyage
                      ? `${pointsToDestination(ship)} pts to ${dest ? portName(dest) : 'port'}`
                      : `${state.sailPoints[ship.id] ?? 0} pts to sail from ${portName(ship.location!)}`}
                  </span>
                  {thrown !== undefined ? (
                    <span style={{ ...dataText, fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.35rem', color: ship.damaged ? UI.bad : UI.good }}>
                      <Die value={thrown} size={16} tone={ship.damaged ? UI.bad : UI.good} />
                      {ship.damaged ? 'carried away a spar' : `+${thrown} made good`}
                    </span>
                  ) : (
                    <Button
                      onClick={() => dispatch({ type: 'CRACK_ON', shipId: ship.id })}
                      disabled={!enabled}
                      title={`Throw one more die and add it to her run. On ${risk === 1 ? 'a 1' : `${risk} or less`} she carries away a spar instead: nothing gained, and ${DAMAGE_SPEED_PENALTY} points slower every roll until repaired.`}
                      style={{ alignSelf: 'flex-start', padding: '0.25rem 0.55rem' }}
                    >
                      Crack on — +1d6, {risk === 1 ? '1 in 6' : `${risk} in 6`} to lose a spar
                    </Button>
                  )}
                </div>
              </div>
            );
          })}

        {hurt.map(ship => (
          <div key={`hurt-${ship.id}`} style={{ ...driveRow, borderColor: UI.badRule }}>
            <Vignette kind="repair" size={36} colour={UI.bad} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flex: 1 }}>
              <span style={{ fontFamily: FONT.display, fontSize: '0.86rem' }}>{ship.name} is damaged</span>
              <span style={{ ...bodySmall, fontSize: '0.74rem' }}>
                {DAMAGE_SPEED_PENALTY} points slower every roll, and cannot be driven.
                {ship.location ? '' : ' She can be made good at any quay.'}
              </span>
              {ship.location && (
                <Button
                  onClick={() => dispatch({ type: 'REPAIR_SHIP', shipId: ship.id })}
                  disabled={!enabled || captain.cash < REPAIR_PRICE}
                  style={{ alignSelf: 'flex-start', padding: '0.25rem 0.55rem' }}
                >
                  Make her good at {portName(ship.location)} — {money(REPAIR_PRICE)}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function EncounterCard({
  ship,
  enc,
  cash,
  enabled,
  onAnswer,
}: {
  ship: Ship;
  enc: Encounter;
  cash: number;
  enabled: boolean;
  onAnswer: (accept: boolean) => void;
}) {
  const roomy = ship.hold.length < slotsOf(ship.shipClass);
  const blocked =
    (enc.kind === 'derelict' || enc.kind === 'trader') && !roomy
      ? 'her hold is full'
      : enc.price !== undefined && cash < enc.price
        ? `you have only ${money(cash)}`
        : null;
  const accept: Record<Encounter['kind'], string> = {
    derelict: 'Heave to and board her',
    castaways: 'Stand in and take them off',
    trader: `Buy the lot — ${money(enc.price ?? 0)}`,
    pilot: `Take the pilot — ${money(enc.price ?? 0)}`,
  };
  return (
    <div style={encounterCard}>
      <Vignette kind={enc.kind} size={52} colour={UI.verdigris} style={{ border: `1px solid ${UI.rule}`, background: UI.panel }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: 0 }}>
        <span style={{ fontFamily: FONT.display, fontSize: '0.88rem', color: UI.verdigris }}>{enc.headline}</span>
        <span style={{ ...bodySmall, fontSize: '0.76rem', lineHeight: 1.4 }}>{enc.detail}</span>
        <span style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          <Button tone="primary" onClick={() => onAnswer(true)} disabled={!enabled || blocked !== null} title={blocked ?? undefined} style={{ padding: '0.25rem 0.55rem' }}>
            {accept[enc.kind]}
          </Button>
          <Button tone="quiet" onClick={() => onAnswer(false)} disabled={!enabled} style={{ padding: '0.25rem 0.55rem' }}>
            Hold her course
          </Button>
        </span>
        {blocked && <span style={{ ...dataText, fontSize: '0.66rem', color: UI.warn }}>Cannot: {blocked}.</span>}
      </div>
    </div>
  );
}

const driveRow: React.CSSProperties = {
  display: 'flex',
  gap: '0.6rem',
  alignItems: 'center',
  border: `1px solid ${UI.rule}`,
  borderRadius: 2,
  padding: '0.4rem 0.5rem',
};

const encounterCard: React.CSSProperties = {
  display: 'flex',
  gap: '0.6rem',
  alignItems: 'flex-start',
  border: `1px solid ${UI.verdigris}`,
  borderLeftWidth: 4,
  borderRadius: 2,
  background: UI.tintVerdigris,
  padding: '0.55rem 0.6rem',
};
