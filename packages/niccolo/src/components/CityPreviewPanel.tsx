import { marketGoodsAt, reachableFrom, findGood } from '../sim/content';
import { priceAt } from '../sim/market';
import { canInsureAt } from '../sim/insurance';
import type { City, MarketScarcity, NewsItem, Vessel } from '../sim/types';

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

const PRIMARY_BUTTON: React.CSSProperties = { ...BUTTON, borderColor: '#e8d5a3', color: '#e8d5a3' };

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
}: CityPreviewPanelProps) {
  const goods = marketGoodsAt(city.id);
  const reachable =
    !!vessel &&
    !vessel.destination &&
    vessel.location !== city.id &&
    reachableFrom(vessel.location, vessel.kind === 'courier').some(r => r.from === city.id || r.to === city.id);
  const canInsureHere = !!vessel && canInsureAt(vessel.location);

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

      {vessel && !isLive && (
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
          ) : (
            <p style={{ fontSize: '0.72rem', color: '#6a5a40', margin: '0.5rem 0 0' }}>
              Not reachable directly from {vessel.name}'s current position.
            </p>
          )}
        </>
      )}
    </div>
  );
}
