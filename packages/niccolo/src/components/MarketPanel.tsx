import { useState } from 'react';
import { findCity, findGood, marketGoodsAt } from '../sim/content';
import { gradeBreakdown, gradeBuyMultiplier, gradeSellMultiplier, isPilotGood } from '../sim/grades';
import { cargoTotal, priceAt } from '../sim/market';
import { eventsAffecting, marketEventTag } from '../sim/marketEvents';
import { describeMarketCause } from './marketCauseText';
import type { ActiveMarketEvent, Cargo, GradeId, MarketScarcity, PriceCauseNote, Vessel } from '../sim/types';

const GRADE_LABEL: Record<GradeId, string> = { common: 'common', fine: 'fine', excellent: 'excellent' };

const LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '0 0 0.4rem',
};

const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
  padding: '0.35rem 0',
  borderBottom: '1px solid #2a2117',
  fontSize: '0.8rem',
};

const QTY_INPUT: React.CSSProperties = {
  width: '2.6rem',
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  fontFamily: 'inherit',
  fontSize: '0.75rem',
  padding: '0.15rem',
};

const SMALL_BUTTON: React.CSSProperties = {
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  padding: '0.2rem 0.5rem',
  fontFamily: 'inherit',
  fontSize: '0.7rem',
  cursor: 'pointer',
};

interface MarketRowProps {
  goodId: string;
  price: number;
  held: number;
  canBuy: boolean;
  canSell: boolean;
  /** Only set for pilot goods (`sim/grades.ts`) — undefined means "not a graded good," so this
   * row renders exactly as it always has, with no grade selector at all. */
  grades?: { breakdown: Record<GradeId, number>; qualityMarket: boolean };
  /** Phase 23: a short market-event marker on this row ('in demand' / 'glut' / 'closed'). */
  tag?: string;
  onBuy: (quantity: number, grade?: GradeId) => void;
  onSell: (quantity: number, grade?: GradeId) => void;
}

function MarketRow({ goodId, price, held, canBuy, canSell, grades, tag, onBuy, onSell }: MarketRowProps) {
  const [qty, setQty] = useState(1);
  const [grade, setGrade] = useState<GradeId>('common');
  const good = findGood(goodId);

  const gradeHeld = grades ? grades.breakdown[grade] : held;
  const buyPrice = grades ? Math.round(price * gradeBuyMultiplier(grade)) : price;
  const sellPrice = grades ? Math.round(price * gradeSellMultiplier(grade, grades.qualityMarket)) : price;

  return (
    <div style={ROW}>
      <span style={{ flex: 1 }}>
        {good?.name ?? goodId}
        {grades?.qualityMarket && (
          <span style={{ color: '#c9a24a' }} title="Pays a real premium for fine/excellent lots here">
            {' '}★
          </span>
        )}
        {tag && (
          <span style={{ color: tag === 'closed' ? '#b5451a' : '#c9a24a', fontSize: '0.68rem' }}>
            {' '}[{tag}]
          </span>
        )}
        {held > 0 && (
          <span style={{ color: '#8a7a5a' }}>
            {' '}
            ({grades
              ? `${held} held: ${(['common', 'fine', 'excellent'] as GradeId[])
                  .filter(g => grades.breakdown[g] > 0)
                  .map(g => `${grades.breakdown[g]} ${GRADE_LABEL[g]}`)
                  .join(', ')}`
              : `${held} held`})
          </span>
        )}
      </span>
      {grades ? (
        <>
          <select
            value={grade}
            onChange={e => setGrade(e.target.value as GradeId)}
            style={{ ...QTY_INPUT, width: '4.6rem' }}
          >
            <option value="common">common</option>
            <option value="fine">fine</option>
            <option value="excellent">excellent</option>
          </select>
          <span style={{ color: '#e8d5a3', fontSize: '0.72rem' }}>
            buy {buyPrice}f / sell {sellPrice}f
          </span>
        </>
      ) : (
        <span style={{ color: '#e8d5a3' }}>{price}f</span>
      )}
      <input
        type="number"
        min={1}
        value={qty}
        style={QTY_INPUT}
        onChange={e => setQty(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
      />
      <button id={`market-buy-${goodId}`} style={SMALL_BUTTON} disabled={!canBuy} onClick={() => onBuy(qty, grade)}>
        Buy
      </button>
      <button
        id={`market-sell-${goodId}`}
        style={SMALL_BUTTON}
        disabled={!canSell || gradeHeld < qty}
        onClick={() => onSell(qty, grade)}
      >
        Sell
      </button>
    </div>
  );
}

interface MarketPanelProps {
  cityId: string;
  cityName: string;
  cash: number;
  cargo: Cargo;
  cargoGrades?: Vessel['cargoGrades'];
  capacity: number;
  scarcity: MarketScarcity;
  /** Phase 16: this week's causes at the vessel's own (always-live) location — the highest-value
   * spot to explain a price, since it's the exact moment the player is deciding whether to trade. */
  causes?: PriceCauseNote[];
  /** Phase 23: market events running at this city — priced into every row, and announced above them. */
  marketEvents?: ActiveMarketEvent[];
  onBuy: (goodId: string, quantity: number, grade?: GradeId) => void;
  onSell: (goodId: string, quantity: number, grade?: GradeId) => void;
}

export default function MarketPanel({
  cityId,
  cityName,
  cash,
  cargo,
  cargoGrades,
  capacity,
  scarcity,
  causes,
  marketEvents,
  onBuy,
  onSell,
}: MarketPanelProps) {
  const goods = marketGoodsAt(cityId);
  const used = cargoTotal(cargo);
  const city = findCity(cityId);
  const localEvents = (marketEvents ?? []).filter(e => e.cityId === cityId);

  if (goods.length === 0) {
    return <p style={{ fontSize: '0.8rem', color: '#8a7a5a' }}>No market at {cityName}.</p>;
  }

  return (
    <div>
      <p style={LABEL}>Market — {cityName}</p>
      <p style={{ fontSize: '0.8rem', margin: '0 0 0.5rem' }}>
        Cash: <strong style={{ color: '#e8d5a3' }}>{Math.round(cash)}f</strong>
        {' · '}
        Hold: {used}/{capacity}
      </p>
      {localEvents.length > 0 && (
        <div style={{ margin: '0 0 0.6rem' }}>
          {localEvents.map(e => (
            <p key={e.id} style={{ fontSize: '0.74rem', color: e.blocksTrade ? '#b5451a' : '#c9a24a', margin: '0 0 0.3rem', fontStyle: 'italic' }}>
              {e.headline}
            </p>
          ))}
        </div>
      )}
      {causes && causes.length > 0 && (
        <p style={{ fontSize: '0.7rem', color: '#8a7a5a', margin: '0 0 0.5rem' }}>
          {causes.map(cause => describeMarketCause(cause, cityName)).join(' ')}
        </p>
      )}
      {goods.map(goodId => {
        const price = priceAt(scarcity, cityId, goodId, marketEvents) ?? 0;
        const held = cargo[goodId] ?? 0;
        const rowEvents = eventsAffecting(marketEvents, cityId, goodId);
        const blocked = rowEvents.some(e => e.blocksTrade);
        const tag = rowEvents.length > 0 ? marketEventTag(rowEvents[0]) : undefined;
        const grades = isPilotGood(goodId)
          ? {
              breakdown: gradeBreakdown(cargo, cargoGrades, goodId),
              qualityMarket: city?.market?.[goodId]?.qualityMarket ?? false,
            }
          : undefined;
        return (
          <MarketRow
            key={goodId}
            goodId={goodId}
            price={price}
            held={held}
            grades={grades}
            canBuy={capacity > used && !blocked}
            canSell={held > 0 && !blocked}
            tag={tag}
            onBuy={(quantity, grade) => onBuy(goodId, quantity, grade)}
            onSell={(quantity, grade) => onSell(goodId, quantity, grade)}
          />
        );
      })}
    </div>
  );
}
