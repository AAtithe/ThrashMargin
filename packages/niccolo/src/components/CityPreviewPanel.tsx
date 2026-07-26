import { marketGoodsAt, reachableFrom, findGood, findCity, findRouteById, otherEndOfRoute, planRoute } from '../sim/content';
import type { PlannedRoute } from '../sim/content';
import { priceAt } from '../sim/market';
import { canInsureAt } from '../sim/insurance';
import type { City, MarketScarcity, NewsItem, Vessel } from '../sim/types';

/** Turns a computed path into "Bruges (1wk) → Venice (8wk) → Trebizond (6wk)" — the per-leg
 * arrival nature is spelled out in the surrounding copy (see below), not implied by this string
 * alone, since nothing here actually moves the vessel through the intermediate stops in one tick. */
function describePath(fromId: string, plan: PlannedRoute): string {
  const names: string[] = [findCity(fromId)?.name ?? fromId];
  let cursor = fromId;
  for (const routeId of plan.routeIds) {
    const route = findRouteById(routeId);
    if (!route) continue;
    const next = otherEndOfRoute(route, cursor);
    names.push(`${findCity(next)?.name ?? next} (${route.distanceWeeks}wk)`);
    cursor = next;
  }
  return names.join(' → ');
}

const LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '0 0 0.3rem',
};

const ROW: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: '0.78rem',
  padding: '0.15rem 0',
};

const BUTTON: React.CSSProperties = {
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  padding: '0.4rem 0.7rem',
  fontFamily: 'inherit',
  fontSize: '0.8rem',
  cursor: 'pointer',
  marginTop: '0.5rem',
};

// Override the full `border` shorthand, not just `borderColor` — mixing a shorthand and a longhand
// for the same property across renders of the same element is a real React warning ("Removing
// borderColor border"), not just a lint nag. This button toggles in and out with `isLive`/
// reachability on every vessel/preview-city change, so it hits this path often.
const PRIMARY_BUTTON: React.CSSProperties = { ...BUTTON, border: '1px solid #e8d5a3', color: '#e8d5a3' };

interface CityPreviewPanelProps {
  city: City;
  isLive: boolean;
  report: NewsItem | undefined;
  week: number;
  scarcity: MarketScarcity;
  vessel: Vessel | null;
  insureNext: boolean;
  onInsureChange: (value: boolean) => void;
  onConfirmDispatch: () => void;
  /** Phase 15: dispatches the first hop of a multi-leg path and queues the rest — same insurance
   * flag as a direct dispatch, applied only to that first leg. */
  onQueueRoute: (plan: PlannedRoute) => void;
}

/**
 * Shown whenever a city marker on the map is clicked — reachable or not, docked or never
 * visited. Clicking a city no longer dispatches the selected vessel by itself (that used to be
 * one click, with no way to compare a destination's prices first); this panel is where the
 * player actually reviews what's known about the place and, if it's currently reachable,
 * confirms the voyage with a deliberate second action.
 */
export default function CityPreviewPanel({
  city,
  isLive,
  report,
  week,
  scarcity,
  vessel,
  insureNext,
  onInsureChange,
  onConfirmDispatch,
  onQueueRoute,
}: CityPreviewPanelProps) {
  const goods = marketGoodsAt(city.id);
  // Whether the *selected* vessel itself is already sitting here — distinct from `isLive`, which
  // is true whenever *any* vessel is docked here (so the player genuinely does know this city's
  // true current prices). Conflating the two used to hide the dispatch controls for a selected
  // vessel that was elsewhere entirely, whenever some *other* vessel happened to be docked at the
  // previewed city — e.g. previewing Bruges to send a courier home while a second vessel already
  // sat there made the "Send ... here" button vanish, with no way to dispatch back at all.
  const selectedVesselHere = !!vessel && !vessel.destination && vessel.location === city.id;
  const reachable =
    !!vessel &&
    !vessel.destination &&
    !selectedVesselHere &&
    reachableFrom(vessel.location, vessel.kind === 'courier').some(r => r.from === city.id || r.to === city.id);
  const canInsureHere = !!vessel && canInsureAt(vessel.location);
  // Phase 15: when there's no direct edge, offer the actual multi-hop path through the existing
  // route graph instead of a bare "not reachable" dead end — see planRoute's own doc comment for
  // why this stays a UI-only convenience (queuing a chain of real, individually-insured single-hop
  // dispatches) rather than a new "sail anywhere in one move" mechanic.
  const plan =
    vessel && !vessel.destination && !selectedVesselHere && !reachable
      ? planRoute(vessel.location, city.id, vessel.kind === 'courier')
      : null;

  return (
    <div style={{ border: '1px solid #2a2117', padding: '0.6rem 0.7rem' }}>
      <p style={LABEL}>
        {city.name} — {city.region}
      </p>

      {goods.length === 0 ? (
        <p style={{ fontSize: '0.78rem', color: '#6a5a40', margin: 0 }}>No market here.</p>
      ) : isLive ? (
        <>
          <p style={{ fontSize: '0.72rem', color: '#3a6b5a', margin: '0 0 0.3rem' }}>You are here — prices are true.</p>
          {goods.map(goodId => (
            <div key={goodId} style={ROW}>
              <span>{findGood(goodId)?.name ?? goodId}</span>
              <span style={{ color: '#e8d5a3' }}>{priceAt(scarcity, city.id, goodId)}f</span>
            </div>
          ))}
        </>
      ) : report ? (
        <>
          <p style={{ fontSize: '0.72rem', color: '#8a7a5a', margin: '0 0 0.3rem' }}>
            As of week {report.trueAsOfWeek} ({week - report.trueAsOfWeek} wk{week - report.trueAsOfWeek === 1 ? '' : 's'} old)
          </p>
          {goods.map(goodId => (
            <div key={goodId} style={ROW}>
              <span>{findGood(goodId)?.name ?? goodId}</span>
              <span style={{ color: '#e8d5a3' }}>{report.prices[goodId] ?? '—'}f</span>
            </div>
          ))}
        </>
      ) : (
        <p style={{ fontSize: '0.78rem', color: '#6a5a40', margin: 0 }}>No report yet for this city.</p>
      )}

      {vessel && !selectedVesselHere && (
        <>
          {reachable ? (
            <>
              {canInsureHere && vessel.capacity > 0 && (
                <label style={{ fontSize: '0.72rem', color: '#8a7a5a', display: 'flex', gap: '0.4rem', alignItems: 'flex-start', marginTop: '0.5rem' }}>
                  <input type="checkbox" checked={insureNext} onChange={e => onInsureChange(e.target.checked)} />
                  <span>Insure this cargo before it departs — underwritten at the ship's current port.</span>
                </label>
              )}
              <button id="confirm-dispatch-button" style={PRIMARY_BUTTON} onClick={onConfirmDispatch}>
                Send {vessel.name} here
              </button>
            </>
          ) : plan ? (
            <>
              <p style={{ fontSize: '0.72rem', color: '#6a5a40', margin: '0.5rem 0 0.3rem' }}>
                Not reachable directly. Nearest path: {describePath(vessel.location, plan)} —{' '}
                {plan.routeIds.length} dispatch{plan.routeIds.length === 1 ? '' : 'es'}, {plan.totalWeeks} weeks of
                sailing. {vessel.name} will dock — and can trade — at each stop; you'll be prompted to continue on
                arrival.
              </p>
              {canInsureHere && vessel.capacity > 0 && (
                <label style={{ fontSize: '0.72rem', color: '#8a7a5a', display: 'flex', gap: '0.4rem', alignItems: 'flex-start', marginBottom: '0.3rem' }}>
                  <input type="checkbox" checked={insureNext} onChange={e => onInsureChange(e.target.checked)} />
                  <span>Insure this cargo for the first leg only — underwritten at the ship's current port.</span>
                </label>
              )}
              <button style={PRIMARY_BUTTON} onClick={() => onQueueRoute(plan)}>
                Queue journey to {city.name}
              </button>
            </>
          ) : (
            <p style={{ fontSize: '0.72rem', color: '#6a5a40', margin: '0.5rem 0 0' }}>
              {vessel.kind === 'courier'
                ? `No all-land route connects ${vessel.name}'s position to ${city.name} — try a ship.`
                : `No route connects ${vessel.name}'s position to ${city.name}.`}
            </p>
          )}
        </>
      )}
    </div>
  );
}
