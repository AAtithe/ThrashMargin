import { findCity, findRouteById, otherEndOfRoute } from '../sim/content';
import { cargoTotal } from '../sim/market';
import { canInsureAt } from '../sim/insurance';
import { activeCharacters, assignmentSummary } from '../sim/characters';
import { UI, FONT } from '../theme';
import { Button, Label, Panel, bodySmall } from './ui';
import ConvoyPanel from './ConvoyPanel';
import ShipyardPanel from './ShipyardPanel';
import type { Character, GameState } from '../sim/types';

interface FleetPanelProps {
  state: GameState;
  selectedVesselId: string | null;
  onSelect: (vesselId: string) => void;
  /** True while a scripted event or the chapter-close card owns the screen — see the comment below
   * on why "Set sail now"/"Cancel journey" must not render as clickable while that's true. */
  blocked: boolean;
  continueInsure: Record<string, boolean>;
  onSetContinueInsure: (vesselId: string, checked: boolean) => void;
  onSetSailNow: (vesselId: string, insure: boolean) => void;
  onCancelRoute: (vesselId: string) => void;
  onFormConvoy: (vesselIds: string[]) => void;
  onDisbandConvoy: () => void;
  onHireEscort: (escortName?: string) => void;
  onBuyVessel: (typeId: string, name?: string) => void;
  onSellVessel: (vesselId: string) => void;
}

/**
 * The left half of Tea Race's own two-panel "assign and move ships" pattern (`FleetPanel` +
 * `PortPanel`) — always on screen rather than behind a menu, so selecting a ship is one click
 * instead of "open Fleet, then click inside it". Everything here used to live inside the Fleet
 * popup; nothing about *what* it shows changed, only that it is now permanent chrome rather than a
 * drawer, so no per-item "something changed" badge is needed any more — there is nothing left for a
 * badge to be a substitute for seeing directly.
 */
export default function FleetPanel({
  state,
  selectedVesselId,
  onSelect,
  blocked,
  continueInsure,
  onSetContinueInsure,
  onSetSailNow,
  onCancelRoute,
  onFormConvoy,
  onDisbandConvoy,
  onHireEscort,
  onBuyVessel,
  onSellVessel,
}: FleetPanelProps) {
  const activeRoster = activeCharacters(state.characters);
  const aboardRoster = activeRoster.filter(
    (c): c is Character & { assignment: { type: 'aboard'; vesselId: string } } => c.assignment.type === 'aboard',
  );
  const notAboardRoster = activeRoster.filter(c => c.assignment.type !== 'aboard');
  const expeditionVessel = state.expedition
    ? state.vessels.find(v => v.id === state.expedition!.vesselId)
    : undefined;

  return (
    <Panel title="Fleet & Household" aside={<Label>{state.vessels.length === 1 ? 'one vessel' : `${state.vessels.length} vessels`}</Label>}>
      <ShipyardPanel state={state} onBuy={onBuyVessel} onSell={onSellVessel} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {state.vessels.map(v => {
          const at = findCity(v.location);
          const to = v.destination ? findCity(v.destination) : null;
          const held = cargoTotal(v.cargo);
          const crew = aboardRoster.filter(c => c.assignment.vesselId === v.id);
          const selected = v.id === selectedVesselId;
          return (
            <div key={v.id}>
              <button
                type="button"
                id={`vessel-button-${v.id}`}
                onClick={() => onSelect(v.id)}
                style={{
                  ...row,
                  borderColor: selected ? UI.brass : UI.rule,
                  background: selected ? UI.panelRaised : 'transparent',
                }}
              >
                <span style={{ fontFamily: FONT.display, fontSize: '0.9rem', color: UI.text }}>{v.name}</span>
                <span style={{ ...bodySmall, fontSize: '0.78rem' }}>
                  {to
                    ? `en route to ${to.name} — ${v.weeksRemaining} week${v.weeksRemaining === 1 ? '' : 's'} left`
                    : `docked at ${at?.name ?? v.location}`}
                  {v.capacity > 0 && ` · hold ${held}/${v.capacity}`}
                </span>
              </button>
              {crew.map(c => (
                <p key={c.id} style={{ ...bodySmall, fontSize: '0.72rem', margin: '0.15rem 0 0.4rem 0.9rem' }}>
                  {c.name} — aboard
                </p>
              ))}
              {!v.destination && v.plannedRoute && v.plannedRoute.length > 0 && (() => {
                const nextRoute = findRouteById(v.plannedRoute[0]);
                if (!nextRoute) return null;
                const nextCity = findCity(otherEndOfRoute(nextRoute, v.location));
                // Real bug, confirmed live: a full-viewport backdrop (EventOverlay/ChapterCompleteCard)
                // sits visually on top of this panel but only darkens it (rgba, not opaque) — a click
                // here would be silently swallowed with zero feedback. Don't render a clickable-looking
                // control that can't actually be clicked; explain why instead.
                if (blocked) {
                  return (
                    <p style={{ margin: '0.15rem 0 0.5rem 0.9rem', ...bodySmall, fontSize: '0.72rem', color: UI.textFaint, fontStyle: 'italic' }}>
                      Continuing on to {nextCity?.name ?? nextRoute.id} waits on the matter above being resolved first.
                    </p>
                  );
                }
                const canInsureNextLeg = canInsureAt(v.location) && held > 0;
                return (
                  <div style={{ margin: '0.15rem 0 0.5rem 0.9rem', fontSize: '0.72rem' }}>
                    <p style={{ ...bodySmall, fontSize: '0.72rem', margin: '0 0 0.3rem' }}>
                      Continuing on to {nextCity?.name ?? nextRoute.id} next week — {v.plannedRoute.length} leg
                      {v.plannedRoute.length === 1 ? '' : 's'} remaining.
                    </p>
                    {canInsureNextLeg && (
                      <label style={{ ...bodySmall, fontSize: '0.72rem', display: 'flex', gap: '0.4rem', alignItems: 'flex-start', margin: '0 0 0.3rem' }}>
                        <input
                          type="checkbox"
                          checked={!!continueInsure[v.id]}
                          onChange={e => onSetContinueInsure(v.id, e.target.checked)}
                        />
                        <span>Insure this cargo for this leg, and set sail now.</span>
                      </label>
                    )}
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      {canInsureNextLeg && (
                        <Button tone="quiet" onClick={() => onSetSailNow(v.id, !!continueInsure[v.id])}>
                          Set sail now
                        </Button>
                      )}
                      <Button tone="quiet" onClick={() => onCancelRoute(v.id)}>
                        Cancel journey
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}
        {notAboardRoster.map(c => (
          <p key={c.id} style={{ ...bodySmall, fontSize: '0.78rem', color: UI.text, margin: '0.3rem 0' }}>
            {c.name} <span style={{ color: UI.textSoft }}>— {assignmentSummary(c, state.vessels)}</span>
          </p>
        ))}
      </div>

      {state.lastVoyageEvent && (
        <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0 }}>
          Week {state.lastVoyageEvent.week}: storm struck {state.lastVoyageEvent.vesselName} — lost{' '}
          {state.lastVoyageEvent.quantityLost} {state.lastVoyageEvent.goodId}.{' '}
          {state.lastVoyageEvent.insured ? (
            <span style={{ color: UI.good }}>Insurance paid {state.lastVoyageEvent.payout}f.</span>
          ) : (
            <span style={{ color: UI.bad }}>Uninsured — a total loss.</span>
          )}
        </p>
      )}

      {state.lastSabotageEvent && (
        <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0 }}>
          Week {state.lastSabotageEvent.week}: {state.lastSabotageEvent.houseName} got to{' '}
          {state.lastSabotageEvent.vesselName}'s cargo at{' '}
          {findCity(state.lastSabotageEvent.cityId)?.name ?? state.lastSabotageEvent.cityId} — lost{' '}
          {state.lastSabotageEvent.quantityLost} {state.lastSabotageEvent.goodId}.
        </p>
      )}

      {state.lastExpeditionEvent && (
        <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0 }}>
          Week {state.lastExpeditionEvent.week}: {state.lastExpeditionEvent.vesselName}'s crew turn{' '}
          {state.lastExpeditionEvent.healthStatus} — {state.lastExpeditionEvent.cashCost}f spent on physicians and delay.
        </p>
      )}

      {state.expedition && (
        <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0 }}>
          {expeditionVessel?.name ?? 'The vessel'} is {state.expedition.weeksUpriver} week
          {state.expedition.weeksUpriver === 1 ? '' : 's'} into the Gambia's interior — crew health:{' '}
          {state.expedition.healthStatus}.
        </p>
      )}

      <ConvoyPanel state={state} onForm={onFormConvoy} onDisband={onDisbandConvoy} onHireEscort={onHireEscort} />
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
