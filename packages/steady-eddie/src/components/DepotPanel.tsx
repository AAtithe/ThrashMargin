import { useMemo, useState } from 'react';
import { priceAt, priceStanding, depotSalePrice } from '../sim/pricing';
import { slotsOf } from '../sim/rules';
import { GOOD_BY_ID, DEPOT_BY_ID, goodName, planRoute, depotName } from '../sim/content';
import { payoutFor } from '../sim/contracts';
import { destinationOf, pointsToDestination, reachableOnRoad } from '../sim/movement';
import { UI, money } from '../theme';
import { planFastestRoute, routeTurns, delayRating, type Season } from '../sim/weather';
import { insurancePremium, theftRating, routeRisk } from '../sim/hazards';
import { Button, Empty, Label, Panel, bodySmall, dataText } from './ui';
import type { Haulier, Contract, GameAction, DepotId, Vehicle } from '../sim/types';

interface Props {
  vehicle: Vehicle | null;
  haulier: Haulier;
  contracts: Contract[];
  miles: Record<string, number>;
  /** A depot the player has clicked on the chart, if any — the candidate destination. */
  targetDepot: DepotId | null;
  onClearTarget: () => void;
  dispatch: (action: GameAction) => void;
  enabled: boolean;
  /** Null when the game is played without weather. */
  season: Season | null;
  theftOn: boolean;
  /** Whether cargo may be sold off at the depot rather than only dumped. */
  sellable: boolean;
}

/**
 * Everything the selected vehicle can do. Kept as one panel rather than split by activity: a vehicle
 * in depot has exactly one turn's worth of choices, and spreading four of them across four
 * collapsible sections would be filing rather than designing.
 */
export default function DepotPanel({
  vehicle,
  haulier,
  contracts,
  miles,
  targetDepot,
  onClearTarget,
  dispatch,
  enabled,
  season,
  theftOn,
  sellable,
}: Props) {
  const depot = vehicle?.location ? DEPOT_BY_ID[vehicle.location] : null;
  const points = vehicle ? (miles[vehicle.id] ?? 0) : 0;

  /** Commissions this vehicle could land right here, right now, and how many slots each would take. */
  const landable = useMemo(
    () =>
      vehicle?.location && vehicle.hold.length > 0
        ? contracts
            .filter(c => c.destination === vehicle.location && c.fills.length < 2)
            .map(c => ({ contract: c, units: vehicle.hold.filter(l => l.good === c.good).length }))
            .filter(x => x.units > 0)
        : [],
    [contracts, vehicle],
  );

  const [preferFastest, setPreferFastest] = useState(true);

  const courses = useMemo(() => {
    if (!vehicle?.location || !targetDepot || targetDepot === vehicle.location) return null;
    const shortest = planRoute(vehicle.location, targetDepot);
    if (!shortest) return null;
    const aeroKit = vehicle.fittings?.aeroKit ?? false;
    const fastest = season ? planFastestRoute(vehicle.location, targetDepot, season, aeroKit) : null;
    const differ =
      Boolean(fastest) && fastest!.path.join('>') !== shortest.path.join('>');
    return {
      shortest,
      fastest,
      differ,
      shortestTurns: season ? routeTurns(vehicle.location, shortest.path, season, aeroKit) : null,
      fastestTurns: fastest?.turns ?? null,
    };
  }, [vehicle, targetDepot, season]);

  // When both exist and differ, the player picks; otherwise there is only one answer.
  const course = courses ? (courses.differ && preferFastest ? courses.fastest! : courses.shortest) : null;

  const premium = useMemo(() => {
    if (!vehicle?.location || !course || !theftOn || !vehicle.insured || !season) return null;
    return insurancePremium(
      vehicle.hold.reduce((n, l) => n + l.paid, 0),
      routeRisk(vehicle.location, course.path, season),
    );
  }, [vehicle, course, theftOn, season]);

  if (!vehicle) {
    return (
      <Panel title="Orders">
        <Empty>Choose one of your vehicles to give her orders.</Empty>
      </Panel>
    );
  }

  if (!vehicle.location) {
    const dest = destinationOf(vehicle);
    const options = reachableOnRoad(vehicle);
    return (
      <Panel title="Orders" aside={<Label>{vehicle.name}</Label>}>
        <p style={{ ...bodySmall, margin: 0 }}>
          {vehicle.name} is on the road, {pointsToDestination(vehicle)} drive points off{' '}
          {dest ? depotName(dest) : 'her destination'}.
          {vehicle.hold.length > 0 && ` She carries ${vehicle.hold.length} of ${slotsOf(vehicle?.vehicleClass)} slots.`}
        </p>
        {options.length > 0 && (
          <div style={block}>
            <Label>Change her orders</Label>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {options.map(depotId => {
                const putAbout = depotId === vehicle.run!.legFrom;
                return (
                  <Button
                    key={depotId}
                    disabled={!enabled}
                    title={
                      putAbout
                        ? 'Turn back — she loses whatever ground she has made on this leg'
                        : 'Hold at the next depot instead of driving past it'
                    }
                    onClick={() =>
                      dispatch({ type: 'DRIVE_TO', vehicleId: vehicle.id, destination: depotId })
                    }
                  >
                    {putAbout ? 'Turn back for' : 'Hold at'} {depotName(depotId)}
                  </Button>
                );
              })}
            </div>
            <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.textFaint }}>
              Mid-route she can only make for one end of the leg she is on. A fresh course can be
              laid off once she parks up.
            </p>
          </div>
        )}
      </Panel>
    );
  }

  return (
    <Panel title="Orders" aside={<Label>{`${vehicle.name} · ${depot?.name ?? ''}`}</Label>}>
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
                onClick={() => dispatch({ type: 'DELIVER', vehicleId: vehicle.id, contractId: c.id })}
              >
                Land {units} × {goodName(c.good)} — {rank === 1 ? 'first home' : 'second home'},{' '}
                {money(payoutFor(c) * units)}
              </Button>
            );
          })}
        </div>
      )}

      {/* --- Buy a cargo -------------------------------------------------------------- */}
      {vehicle.hold.length < slotsOf(vehicle?.vehicleClass) && depot && (
        <div style={block}>
          <Label>
            Load a cargo — {slotsOf(vehicle?.vehicleClass) - vehicle.hold.length} of {slotsOf(vehicle?.vehicleClass)} slots free
          </Label>
          {depot.supplies.length === 0 ? (
            <Empty>{depot.name} has nothing to sell. She must go elsewhere for a cargo.</Empty>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {depot.supplies.map(id => {
                const good = GOOD_BY_ID[id];
                // A live commission wants this good — and since cards name no source, this depot
                // will do as well as any other that stocks it.
                const wanted = contracts.some(c => c.good === id && c.fills.length < 2);
                // What this depot charges, which may sit either side of the card's reckoning.
                const price = priceAt(depot.id, id);
                const standing = priceStanding(depot.id, id);
                const afford = haulier.cash >= price;
                return (
                  <Button
                    key={id}
                    disabled={!enabled || !afford}
                    title={
                      afford
                        ? `Reckoned at ${money(good.basePrice)} a lot; ${depot.name} asks ${money(price)}`
                        : `${good.name} costs ${money(price)} here`
                    }
                    onClick={() => dispatch({ type: 'BUY_CARGO', vehicleId: vehicle.id, good: id })}
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
          <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.textFaint }}>
            ★ marks a good some face-up commission wants. No card names a source depot, so this depot
            will serve as well as any other that stocks it. Anything unstarred is a gamble on a card
            turning up.
          </p>
        </div>
      )}

      {/* --- Over the side ------------------------------------------------------------- */}
      {vehicle.hold.length > 0 && (
        <div style={block}>
          <Label>Clear the hold</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
            {[...new Set(vehicle.hold.map(l => l.good))].map(good => {
              const lots = vehicle.hold.filter(l => l.good === good);
              const paid = lots.reduce((n, l) => n + l.paid, 0);
              const takings = sellable && depot ? depotSalePrice(depot.id, good) * lots.length : 0;
              return (
                <span key={good} style={{ display: 'inline-flex', gap: '0.3rem' }}>
                  {sellable && depot && (
                    <Button
                      disabled={!enabled}
                      title={`${depot.name} will take them at ${money(
                        depotSalePrice(depot.id, good),
                      )} a lot — ${money(paid - takings)} down on the ${money(paid)} she paid. ${
                        DEPOT_BY_ID[depot.id]?.demands.includes(good) ||
                        DEPOT_BY_ID[depot.id]?.supplies.includes(good)
                          ? 'This depot deals in it, so the price is fair.'
                          : 'This depot has no real buyer for it — somewhere that deals in it would pay far more.'
                      }`}
                      onClick={() => dispatch({ type: 'SELL_CARGO', vehicleId: vehicle.id, good })}
                    >
                      Sell {lots.length} × {goodName(good)} — {money(takings)}
                    </Button>
                  )}
                  <Button
                    tone="danger"
                    disabled={!enabled}
                    title="Dumping recovers nothing at all — the whole purchase price is forfeit"
                    onClick={() => dispatch({ type: 'DUMP', vehicleId: vehicle.id, good })}
                  >
                    Dump {lots.length} × {goodName(good)}
                  </Button>
                </span>
              );
            })}
          </div>
          <p style={{ ...bodySmall, fontSize: '0.75rem', margin: 0, color: UI.textFaint }}>
            {sellable
              ? 'A depot that deals in the good pays best; anywhere else takes it off your hands for little. Over the side gets you nothing at all.'
              : 'Over the side. You get nothing back — only do it to free a slot for better work.'}
          </p>
        </div>
      )}

      {/* --- Set a course ---------------------------------------------------------------- */}
      <div style={block}>
        <Label>Set a course</Label>
        {!targetDepot ? (
          <Empty>Click a depot on the chart to lay off a course.</Empty>
        ) : targetDepot === vehicle.location ? (
          /* Clicking your own depot is a natural thing to do — it must not read as an error, which
             is what the generic "no sea route" branch below made it say. */
          <Empty>{vehicle.name} is already parked up at {depotName(targetDepot)}. Pick another depot.</Empty>
        ) : course ? (
          <>
            <p style={{ ...bodySmall, margin: 0 }}>
              <strong style={{ color: UI.text }}>{depotName(targetDepot)}</strong> — {course.distance}{' '}
              drive points
              {course.path.length > 1 && (
                <>
                  {' '}
                  by way of {course.path.slice(0, -1).map(depotName).join(', ')}
                </>
              )}
              .
            </p>
            <p style={{ ...dataText, fontSize: '0.72rem', margin: 0, color: UI.textFaint }}>
              {points >= course.distance
                ? `She has ${points} points and parks up this turn.`
                : `She has ${points} points — about ${Math.max(1, Math.ceil((course.distance - points) / 7)) + 1} turns.`}
            </p>

            {season && course.path.length > 0 && (() => {
              const rating = delayRating(vehicle.location!, course.path[0], season);
              if (rating <= 0) return null;
              return (
                <p style={{ ...bodySmall, fontSize: '0.76rem', margin: 0 }}>
                  First leg:{' '}
                  <span style={{ color: UI.bad }}>
                    {'☁'.repeat(Math.min(3, rating))} weather-prone this season
                  </span>
                </p>
              );
            })()}

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

            {theftOn && course.path.length > 0 && (() => {
              const worst = Math.max(
                ...[vehicle.location!, ...course.path].slice(0, -1).map((p, i, arr) =>
                  theftRating(p, i + 1 < arr.length ? arr[i + 1] : course.path[course.path.length - 1]),
                ),
                theftRating(course.path[course.path.length - 2] ?? vehicle.location!, course.path[course.path.length - 1]),
              );
              if (worst <= 0) return null;
              return (
                <p style={{ ...bodySmall, fontSize: '0.76rem', margin: 0, color: UI.bad }}>
                  This course runs through theft-prone roads.
                  {vehicle.fittings?.tracker ? ' Her tracker will help.' : ' She carries no tracker.'}
                </p>
              );
            })()}

            {premium !== null && (
              <p style={{ ...dataText, fontSize: '0.72rem', margin: 0, color: UI.verdigris }}>
                Premium on dispatch: {money(premium)}
              </p>
            )}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <Button
                tone="primary"
                disabled={!enabled}
                onClick={() => {
                  // Send the exact path the player chose, so picking the longer weather-avoiding route
                  // actually drives that route.
                  dispatch({
                    type: 'DRIVE_TO',
                    vehicleId: vehicle.id,
                    destination: targetDepot,
                    via: course.path,
                  });
                  onClearTarget();
                }}
              >
                Set off for {depotName(targetDepot)}
              </Button>
              <Button tone="quiet" onClick={onClearTarget}>
                Not yet
              </Button>
            </div>
          </>
        ) : (
          <Empty>No sea route from {depot?.name} to {depotName(targetDepot)}.</Empty>
        )}
      </div>

      {/* --- What this depot trades ------------------------------------------------------- */}
      {depot && (
        <div style={{ ...block, borderTop: `1px solid ${UI.rule}`, paddingTop: '0.55rem' }}>
          <Label>{depot.name} buys</Label>
          <p style={{ ...bodySmall, fontSize: '0.76rem', margin: 0 }}>
            {depot.demands.length ? depot.demands.map(goodName).join(', ') : 'nothing'}
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
