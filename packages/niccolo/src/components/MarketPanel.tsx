import { useState } from 'react';
import { findCity, findGood, marketGoodsAt } from '../sim/content';
import { gradeBreakdown, gradeBuyMultiplier, gradeSellMultiplier, isPilotGood } from '../sim/grades';
import { cargoTotal, priceAt } from '../sim/market';
import { describeMarketCause } from './marketCauseText';
import type { Cargo, GradeId, MarketScarcity, PriceCauseNote, Vessel } from '../sim/types';

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
  onBuy: (quantity: number, grade?: GradeId) => void;
  onSell: (quantity: number, grade?: GradeId) => void;
}

function MarketRow({ goodId, price, held, canBuy, canSell, grades, onBuy, onSell }: MarketRowProps) {
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
  onBuy,
  onSell,
}: MarketPanelProps) {
  const goods = marketGoodsAt(cityId);
  const used = cargoTotal(cargo);
  const city = findCity(cityId);

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
      {causes && causes.length > 0 && (
        <p style={{ fontSize: '0.7rem', color: '#8a7a5a', margin: '0 0 0.5rem' }}>
          {causes.map(cause => describeMarketCause(cause, cityName)).join(' ')}
        </p>
      )}
      {goods.map(goodId => {
        const price = priceAt(scarcity, cityId, goodId) ?? 0;
        const held = cargo[goodId] ?? 0;
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
            canBuy={capacity > used}
            canSell={held > 0}
            onBuy={(quantity, grade) => onBuy(goodId, quantity, grade)}
            onSell={(quantity, grade) => onSell(goodId, quantity, grade)}
          />
        );
      })}
    </div>
  );
}
