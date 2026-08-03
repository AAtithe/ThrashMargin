import { useMemo, useState } from 'react';
import { GOOD_BY_ID, PORT_BY_ID, goodName, planRoute, portDemands, portName } from '../sim/content';
import { payoutFor } from '../sim/contracts';
import { destinationOf, pointsToDestination } from '../sim/movement';
import { UI, money } from '../theme';
import { planFastestRoute, routeTurns, windFor, type Season } from '../sim/weather';
import { insurancePremium, piracyRating, routeRisk } from '../sim/hazards';
import { Button, Empty, Label, Panel, bodySmall, dataText } from './ui';
import type { Captain, Contract, GameAction, PortId, Ship } from '../sim/types';

interface Props {
  ship: Ship | null;
  captain: Captain;
  contracts: Contract[];
  sailPoints: Record<string, number>;
  /** A port the player has clicked on the chart, if any — the candidate destination. */
  targetPort: PortId | null;
  onClearTarget: () => void;
  dispatch: (action: GameAction) => void;
  enabled: boolean;
  /** Null when the game is played without weather. */
  season: Season | null;
  piracyOn: boolean;
}

/**
 * Everything the selected ship can do. Kept as one panel rather than split by activity: a clipper
 * in port has exactly one turn's worth of choices, and spreading four of them across four
 * collapsible sections would be filing rather than designing.
 */
export default function PortPanel({
  ship,
  captain,
  contracts,
  sailPoints,
  targetPort,
  onClearTarget,
  dispatch,
  enabled,
  season,
  piracyOn,
}: Props) {
  const port = ship?.location ? PORT_BY_ID[ship.location] : null;
  const points = ship ? (sailPoints[ship.id] ?? 0) : 0;

  /** Commissions this ship could land right here, right now. */
  const landable = useMemo(
    () =>
      ship?.location && ship.cargo
        ? contracts.filter(
            c => c.destination === ship.location && c.good === ship.cargo!.good && c.fills.length < 2,
          )
        : [],
    [contracts, ship],
  );

  const [preferFastest, setPreferFastest] = useState(true);

  const courses = useMemo(() => {
    if (!ship?.location || !targetPort || targetPort === ship.location) return null;
    const shortest = planRoute(ship.location, targetPort);
    if (!shortest) return null;
    const copper = ship.fittings?.copper ?? false;
    const fastest = season ? planFastestRoute(ship.location, targetPort, season, copper) : null;
    const differ =
      Boolean(fastest) && fastest!.path.join('>') !== shortest.path.join('>');
    return {
      shortest,
      fastest,
      differ,
      shortestTurns: season ? routeTurns(ship.location, shortest.path, season, copper) : null,
      fastestTurns: fastest?.turns ?? null,
    };
  }, [ship, targetPort, season]);

  // When both exist and differ, the player picks; otherwise there is only one answer.
  const course = courses ? (courses.differ && preferFastest ? courses.fastest! : courses.shortest) : null;

  const premium = useMemo(() => {
    if (!ship?.location || !course || !piracyOn || !ship.insured || !season) return null;
    return insurancePremium(ship.cargo?.paid ?? 0, routeRisk(ship.location, course.path, season));
  }, [ship, course, piracyOn, season]);

  if (!ship) {
    return (
      <Panel title="Orders">
        <Empty>Choose one of your ships to give her orders.</Empty>
      </Panel>
    );
  }

  if (!ship.location) {
    const dest = destinationOf(ship);
    return (
      <Panel title="Orders" aside={<Label>{ship.name}</Label>}>
        <p style={{ ...bodySmall, margin: 0 }}>
          {ship.name} is at sea, {pointsToDestination(ship)} sail points off{' '}
          {dest ? portName(dest) : 'her destination'}. She sails on with each turn's wind — there is
          nothing to decide until she ties up.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Orders" aside={<Label>{`${ship.name} · ${port?.name ?? ''}`}</Label>}>
      {/* --- Land a cargo ------------------------------------------------------------- */}
      {landable.length > 0 && (
        <div style={block}>
          <Label>Land her cargo</Label>
          {landable.map(c => {
            const rank = c.fills.length + 1;
            return (
              <Button
                key={c.id}
                tone="primary"
                disabled={!enabled}
                onClick={() => dispatch({ type: 'DELIVER', shipId: ship.id, contractId: c.id })}
              >
                Land {goodName(c.good)} — {rank === 1 ? 'first home' : 'second home'}, {money(payoutFor(c))}
              </Button>
            );
          })}
        </div>
      )}

      {/* --- Buy a cargo -------------------------------------------------------------- */}
      {!ship.cargo && port && (
        <div style={block}>
          <Label>Load a cargo</Label>
          {port.supplies.length === 0 ? (
            <Empty>{port.name} has nothing to sell. She must go elsewhere for a cargo.</Empty>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {port.supplies.map(id => {
                const good = GOOD_BY_ID[id];
                const wanted = contracts.some(
                  c => c.good === id && c.source === port.id && c.fills.length < 2,
                );
                const afford = captain.cash >= good.basePrice;
                return (
                  <Button
                    key={id}
                    disabled={!enabled || !afford}
                    title={afford ? undefined : `${good.name} costs ${money(good.basePrice)}`}
                    onClick={() => dispatch({ type: 'BUY_CARGO', shipId: ship.id, good: id })}
                    style={wanted ? { borderColor: UI.brass, color: UI.brass } : undefined}
                  >
                    {good.name} {money(good.basePrice)}
                    {wanted ? ' ★' : ''}
                  </Button>
                );
              })}
            </div>
          )}
          <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.textFaint }}>
            ★ marks a good a face-up commission wants from this quay. Anything else is a gamble on a
            card turning up.
          </p>
        </div>
      )}

      {/* --- Dump a cargo nobody wants -------------------------------------------------- */}
      {ship.cargo && landable.length === 0 && portDemands(port!.id, ship.cargo.good) && (
        <div style={block}>
          <Label>No commission here</Label>
          <Button
            tone="danger"
            disabled={!enabled}
            onClick={() => dispatch({ type: 'SELL_LOCAL', shipId: ship.id })}
          >
            Clear the hold of {goodName(ship.cargo.good)} for {money(Math.floor(ship.cargo.paid / 2))}
          </Button>
          <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.textFaint }}>
            Half what you paid. Only worth it to free the ship.
          </p>
        </div>
      )}

      {/* --- Set a course ---------------------------------------------------------------- */}
      <div style={block}>
        <Label>Set a course</Label>
        {!targetPort ? (
          <Empty>Click a port on the chart to lay off a course.</Empty>
        ) : targetPort === ship.location ? (
          /* Clicking your own port is a natural thing to do — it must not read as an error, which
             is what the generic "no sea route" branch below made it say. */
          <Empty>{ship.name} is already tied up at {portName(targetPort)}. Pick another port.</Empty>
        ) : course ? (
          <>
            <p style={{ ...bodySmall, margin: 0 }}>
              <strong style={{ color: UI.text }}>{portName(targetPort)}</strong> — {course.distance}{' '}
              sail points
              {course.path.length > 1 && (
                <>
                  {' '}
                  by way of {course.path.slice(0, -1).map(portName).join(', ')}
                </>
              )}
              .
            </p>
            <p style={{ ...dataText, fontSize: '0.72rem', margin: 0, color: UI.textFaint }}>
              {points >= course.distance
                ? `She has ${points} points and ties up this turn.`
                : `She has ${points} points — about ${Math.max(1, Math.ceil((course.distance - points) / 7)) + 1} turns.`}
            </p>

            {season && course.path.length > 0 && (
              <p style={{ ...bodySmall, fontSize: '0.76rem', margin: 0 }}>
                First leg:{' '}
                {(() => {
                  const wind = windFor(ship.location!, course.path[0], season);
                  const good = wind.modifier > 0;
                  return (
                    <span style={{ color: good ? UI.good : wind.modifier < 0 ? UI.bad : UI.textFaint }}>
                      {wind.label} ({wind.modifier > 0 ? '+' : ''}
                      {wind.modifier})
                    </span>
                  );
                })()}
              </p>
            )}

            {courses?.differ && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <Label>Two ways round</Label>
                {([true, false] as const).map(fast => {
                  const c = fast ? courses.fastest! : courses.shortest;
                  const turns = fast ? courses.fastestTurns : courses.shortestTurns;
                  return (
                    <label key={String(fast)} style={{ ...bodySmall, fontSize: '0.76rem', display: 'flex', gap: '0.4rem', alignItems: 'baseline', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        checked={preferFastest === fast}
                        onChange={() => setPreferFastest(fast)}
                        style={{ accentColor: UI.brass }}
                      />
                      <span>
                        <strong style={{ color: UI.text }}>{fast ? 'Fastest this season' : 'Shortest'}</strong>{' '}
                        — {c.distance} points
                        {turns !== null ? `, about ${turns.toFixed(1)} turns` : ''}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {piracyOn && course.path.length > 0 && (() => {
              const worst = Math.max(
                ...[ship.location!, ...course.path].slice(0, -1).map((p, i, arr) =>
                  piracyRating(p, i + 1 < arr.length ? arr[i + 1] : course.path[course.path.length - 1]),
                ),
                piracyRating(course.path[course.path.length - 2] ?? ship.location!, course.path[course.path.length - 1]),
              );
              if (worst <= 0) return null;
              return (
                <p style={{ ...bodySmall, fontSize: '0.76rem', margin: 0, color: UI.bad }}>
                  This course runs through piratical waters.
                  {ship.fittings?.guns ? ' Her guns will help.' : ' She carries no guns.'}
                </p>
              );
            })()}

            {premium !== null && (
              <p style={{ ...dataText, fontSize: '0.72rem', margin: 0, color: UI.verdigris }}>
                Premium on cast-off: {money(premium)}
              </p>
            )}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <Button
                tone="primary"
                disabled={!enabled}
                onClick={() => {
                  // Send the exact path the player chose, so picking the longer fair-wind route
                  // actually sails that route.
                  dispatch({
                    type: 'SAIL_TO',
                    shipId: ship.id,
                    destination: targetPort,
                    via: course.path,
                  });
                  onClearTarget();
                }}
              >
                Cast off for {portName(targetPort)}
              </Button>
              <Button tone="quiet" onClick={onClearTarget}>
                Not yet
              </Button>
            </div>
          </>
        ) : (
          <Empty>No sea route from {port?.name} to {portName(targetPort)}.</Empty>
        )}
      </div>

      {/* --- What this port trades ------------------------------------------------------- */}
      {port && (
        <div style={{ ...block, borderTop: `1px solid ${UI.rule}`, paddingTop: '0.55rem' }}>
          <Label>{port.name} buys</Label>
          <p style={{ ...bodySmall, fontSize: '0.76rem', margin: 0 }}>
            {port.demands.length ? port.demands.map(goodName).join(', ') : 'nothing'}
          </p>
        </div>
      )}
    </Panel>
  );
}

const block: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
  alignItems: 'flex-start',
};
