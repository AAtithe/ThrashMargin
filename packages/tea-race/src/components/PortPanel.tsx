import { useMemo, useState } from 'react';
import { priceAt, priceStanding, quaysidePrice } from '../sim/pricing';
import { AGENT_LADING_DISCOUNT, AGENT_PRICE, AGENT_SALE_UPLIFT, MAX_AGENTS } from '../sim/agents';
import { slotsOf } from '../sim/rules';
import { GOOD_BY_ID, PORT_BY_ID, goodName, planRoute, portName } from '../sim/content';
import { payoutFor } from '../sim/contracts';
import { destinationOf, pointsToDestination, reachableAtSea } from '../sim/movement';
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
  /** Whether cargo may be sold off at the quay rather than only dumped. */
  sellable: boolean;
  /** Whether port agents are in play. */
  agentsOn: boolean;
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
  sellable,
  agentsOn,
}: Props) {
  const port = ship?.location ? PORT_BY_ID[ship.location] : null;
  const mine = agentsOn && port ? (captain.agents ?? []).includes(port.id) : false;
  const canHire =
    agentsOn && port
      ? (captain.agents?.length ?? 0) < MAX_AGENTS && !mine && captain.cash >= AGENT_PRICE
      : false;
  const points = ship ? (sailPoints[ship.id] ?? 0) : 0;

  /** Commissions this ship could land right here, right now, and how many slots each would take. */
  const landable = useMemo(
    () =>
      ship?.location && ship.hold.length > 0
        ? contracts
            .filter(c => c.destination === ship.location && c.fills.length < 2)
            .map(c => ({ contract: c, units: ship.hold.filter(l => l.good === c.good).length }))
            .filter(x => x.units > 0)
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
    return insurancePremium(
      ship.hold.reduce((n, l) => n + l.paid, 0),
      routeRisk(ship.location, course.path, season),
    );
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
    const options = reachableAtSea(ship);
    return (
      <Panel title="Orders" aside={<Label>{ship.name}</Label>}>
        <p style={{ ...bodySmall, margin: 0 }}>
          {ship.name} is at sea, {pointsToDestination(ship)} sail points off{' '}
          {dest ? portName(dest) : 'her destination'}.
          {ship.hold.length > 0 && ` She carries ${ship.hold.length} of ${slotsOf(ship?.shipClass)} slots.`}
        </p>
        {options.length > 0 && (
          <div style={block}>
            <Label>Change her orders</Label>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {options.map(portId => {
                const putAbout = portId === ship.voyage!.legFrom;
                return (
                  <Button
                    key={portId}
                    disabled={!enabled}
                    title={
                      putAbout
                        ? 'Put about — she loses whatever ground she has made on this leg'
                        : 'Hold at the next port instead of sailing past it'
                    }
                    onClick={() =>
                      dispatch({ type: 'SAIL_TO', shipId: ship.id, destination: portId })
                    }
                  >
                    {putAbout ? 'Put about for' : 'Hold at'} {portName(portId)}
                  </Button>
                );
              })}
            </div>
            <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.textFaint }}>
              Mid-ocean she can only make for one end of the leg she is on. A fresh course can be
              laid off once she ties up.
            </p>
          </div>
        )}
      </Panel>
    );
  }

  return (
    <Panel title="Orders" aside={<Label>{`${ship.name} · ${port?.name ?? ''}`}</Label>}>
      {/* --- Land a cargo ------------------------------------------------------------- */}
      {landable.length > 0 && (
        <div style={block}>
          <Label>Land her cargo</Label>
          {landable.map(({ contract: c, units }) => {
            const rank = c.fills.length + 1;
            return (
              <Button
                key={c.id}
                tone="primary"
                disabled={!enabled}
                title={`Every matching slot lands at once and is paid per unit`}
                onClick={() => dispatch({ type: 'DELIVER', shipId: ship.id, contractId: c.id })}
              >
                Land {units} × {goodName(c.good)} — {rank === 1 ? 'first home' : 'second home'},{' '}
                {money(payoutFor(c) * units)}
              </Button>
            );
          })}
        </div>
      )}

      {/* --- Buy a cargo -------------------------------------------------------------- */}
      {ship.hold.length < slotsOf(ship?.shipClass) && port && (
        <div style={block}>
          <Label>
            Load a cargo — {slotsOf(ship?.shipClass) - ship.hold.length} of {slotsOf(ship?.shipClass)} slots free
          </Label>
          {port.supplies.length === 0 ? (
            <Empty>{port.name} has nothing to sell. She must go elsewhere for a cargo.</Empty>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {port.supplies.map(id => {
                const good = GOOD_BY_ID[id];
                // A live commission wants this good — and since cards name no source, this quay
                // will do as well as any other that stocks it.
                const wanted = contracts.some(c => c.good === id && c.fills.length < 2);
                // What this quay charges, which may sit either side of the card's reckoning.
                const price = priceAt(port.id, id);
                const standing = priceStanding(port.id, id);
                const afford = captain.cash >= price;
                return (
                  <Button
                    key={id}
                    disabled={!enabled || !afford}
                    title={
                      afford
                        ? `Reckoned at ${money(good.basePrice)} a lot; ${port.name} asks ${money(price)}`
                        : `${good.name} costs ${money(price)} here`
                    }
                    onClick={() => dispatch({ type: 'BUY_CARGO', shipId: ship.id, good: id })}
                    style={wanted ? { borderColor: UI.brass, color: UI.brass } : undefined}
                  >
                    {good.name}{' '}
                    <span
                      style={{
                        color:
                          standing === 'cheap' ? UI.verdigris : standing === 'dear' ? UI.warn : undefined,
                      }}
                    >
                      {money(price)}
                    </span>
                    {wanted ? ' ★' : ''}
                  </Button>
                );
              })}
            </div>
          )}
          {/* An agent is a relationship with a place, so he is hired where you are standing. */}
          {agentsOn && port && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.45rem', flexWrap: 'wrap' }}>
              {mine ? (
                <span style={{ ...bodySmall, fontSize: '0.75rem', color: UI.verdigris }}>
                  Your agent is established at {port.name} — he lades{' '}
                  {Math.round(AGENT_LADING_DISCOUNT * 100)}% under the asking price and sells{' '}
                  {Math.round(AGENT_SALE_UPLIFT * 100)}% over it.
                </span>
              ) : (
                <Button
                  disabled={!enabled || !canHire}
                  title={
                    (captain.agents?.length ?? 0) >= MAX_AGENTS
                      ? `No captain keeps more than ${MAX_AGENTS} agents.`
                      : captain.cash < AGENT_PRICE
                        ? `An agent costs ${money(AGENT_PRICE)}.`
                        : `A permanent man at ${port.name}: ${Math.round(
                            AGENT_LADING_DISCOUNT * 100,
                          )}% off everything you lade here, ${Math.round(
                            AGENT_SALE_UPLIFT * 100,
                          )}% more for anything you sell off here, and word ahead of the market. He stays for the rest of the game.`
                  }
                  onClick={() => dispatch({ type: 'HIRE_AGENT', port: port.id })}
                >
                  Set up an agent — {money(AGENT_PRICE)}
                </Button>
              )}
            </div>
          )}

          <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.textFaint }}>
            ★ marks a good some face-up commission wants. No card names a source port, so this quay
            will serve as well as any other that stocks it. Anything unstarred is a gamble on a card
            turning up.
          </p>
        </div>
      )}

      {/* --- Over the side ------------------------------------------------------------- */}
      {ship.hold.length > 0 && (
        <div style={block}>
          <Label>Clear the hold</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
            {[...new Set(ship.hold.map(l => l.good))].map(good => {
              const lots = ship.hold.filter(l => l.good === good);
              const paid = lots.reduce((n, l) => n + l.paid, 0);
              const takings = sellable && port ? quaysidePrice(port.id, good) * lots.length : 0;
              return (
                <span key={good} style={{ display: 'inline-flex', gap: '0.3rem' }}>
                  {sellable && port && (
                    <Button
                      disabled={!enabled}
                      title={`${port.name} will take them at ${money(
                        quaysidePrice(port.id, good),
                      )} a lot — ${money(paid - takings)} down on the ${money(paid)} she paid. ${
                        PORT_BY_ID[port.id]?.demands.includes(good) ||
                        PORT_BY_ID[port.id]?.supplies.includes(good)
                          ? 'This quay deals in it, so the price is fair.'
                          : 'This quay has no real buyer for it — somewhere that deals in it would pay far more.'
                      }`}
                      onClick={() => dispatch({ type: 'SELL_CARGO', shipId: ship.id, good })}
                    >
                      Sell {lots.length} × {goodName(good)} — {money(takings)}
                    </Button>
                  )}
                  <Button
                    tone="danger"
                    disabled={!enabled}
                    title="Dumping recovers nothing at all — the whole purchase price is forfeit"
                    onClick={() => dispatch({ type: 'JETTISON', shipId: ship.id, good })}
                  >
                    Jettison {lots.length} × {goodName(good)}
                  </Button>
                </span>
              );
            })}
          </div>
          <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.textFaint }}>
            {sellable
              ? 'A quay that deals in the good pays best; anywhere else takes it off your hands for little. Over the side gets you nothing at all.'
              : 'Over the side. You get nothing back — only do it to free a slot for better work.'}
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
