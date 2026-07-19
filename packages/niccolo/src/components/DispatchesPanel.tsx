import { CITIES, HOME_CITY, findGood } from '../sim/content';
import { activeCharacters } from '../sim/characters';
import { baseLatencyFor, canInvestFurther, courierInvestmentCost, currentLatencyFor } from '../sim/news';
import type { Character, CourierInvestment, NewsItem } from '../sim/types';

const LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '0 0 0.4rem',
};

const LIST: React.CSSProperties = {
  maxHeight: '260px',
  overflowY: 'auto',
  paddingRight: '0.3rem',
};

const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '0.5rem',
  padding: '0.4rem 0',
  borderBottom: '1px solid #2a2117',
  fontSize: '0.8rem',
};

const SMALL_BUTTON: React.CSSProperties = {
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  padding: '0.2rem 0.5rem',
  fontFamily: 'inherit',
  fontSize: '0.65rem',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

interface DispatchesPanelProps {
  week: number;
  cash: number;
  knownPrices: Record<string, NewsItem>;
  pendingNews: NewsItem[];
  courierInvestment: CourierInvestment;
  characters: Character[];
  dockedCityIds: Set<string>;
  onInvest: (cityId: string) => void;
}

export default function DispatchesPanel({
  week,
  cash,
  knownPrices,
  pendingNews,
  courierInvestment,
  characters,
  dockedCityIds,
  onInvest,
}: DispatchesPanelProps) {
  return (
    <div>
      <p style={LABEL}>Dispatches</p>
      <div style={LIST}>
        {CITIES.filter(c => c.market).map(c => {
          const live = dockedCityIds.has(c.id);
          const report = knownPrices[c.id];
          const age = report ? week - report.trueAsOfWeek : null;
          const nextDue = pendingNews
            .filter(n => n.cityId === c.id)
            .sort((a, b) => a.receivedOnWeek - b.receivedOnWeek)[0];
          const latency = currentLatencyFor(c.id, courierInvestment, characters);
          const base = baseLatencyFor(c.id);
          const investable = canInvestFurther(c.id, courierInvestment, characters);
          const cost = courierInvestmentCost(c.id, courierInvestment);
          const investigator = activeCharacters(characters).find(
            ch => ch.assignment.type === 'investigate' && ch.assignment.cityId === c.id,
          );

          return (
            <div key={c.id} style={ROW}>
              <div style={{ flex: 1 }}>
                <div>
                  {c.name}
                  {live && <span style={{ color: '#3a6b5a' }}> · live</span>}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#8a7a5a' }}>
                  {live
                    ? 'You are here — prices are true.'
                    : report
                      ? `As of week ${report.trueAsOfWeek} (${age} wk${age === 1 ? '' : 's'} old)`
                      : 'No report yet'}
                  {!live && nextDue && ` · next report due week ${nextDue.receivedOnWeek}`}
                  {!live && c.id !== HOME_CITY && ` · ${latency} wk${latency === 1 ? '' : 's'} latency (base ${base})`}
                  {!live && investigator && ` · ${investigator.name} investigating`}
                </div>
                {!live && report && (
                  <div style={{ fontSize: '0.7rem', color: '#c9b88a', marginTop: '0.15rem' }}>
                    {Object.entries(report.prices)
                      .map(([goodId, price]) => `${findGood(goodId)?.name ?? goodId} ${price}f`)
                      .join(' · ')}
                  </div>
                )}
              </div>
              {c.id !== HOME_CITY && (
                <button
                  style={SMALL_BUTTON}
                  disabled={!investable || cost > cash}
                  onClick={() => onInvest(c.id)}
                >
                  {investable ? `Invest ${cost}f` : 'Fastest'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
