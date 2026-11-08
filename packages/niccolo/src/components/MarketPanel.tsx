import { useEffect, useRef, useState } from 'react';
import { paced, usePace } from '../lib/motion';
import { FloatingAmount, Florins, useStagger } from './motionKit';
import { UI } from '../theme';
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
  color: UI.textSoft,
  margin: '0 0 0.4rem',
};

const ROW: React.CSSProperties = {
  // Anchors the trade feedback (the row's brief highlight and the floating amount).
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
  padding: '0.35rem 0',
  borderBottom: `1px solid ${UI.rule}`,
  fontSize: '0.8rem',
};

const QTY_INPUT: React.CSSProperties = {
  width: '2.6rem',
  background: UI.panel,
  border: `1px solid ${UI.rule}`,
  color: UI.text,
  fontFamily: 'inherit',
  fontSize: '0.75rem',
  padding: '0.15rem',
};

const SMALL_BUTTON: React.CSSProperties = {
  background: UI.panel,
  border: `1px solid ${UI.rule}`,
  color: UI.text,
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
  /** The trade that just landed on this row, if any — see `TradeFlash`. */
  flash?: TradeFlash | null;
  onBuy: (quantity: number, grade?: GradeId) => void;
  onSell: (quantity: number, grade?: GradeId) => void;
}

/**
 * A trade that has just gone through on one row: what it did to the purse and to the hold. Seen
 * only by comparing the state before and after (the sim is unchanged), and only while motion is on.
 * `n` increments per trade so a second purchase of the same good replays the feedback.
 */
interface TradeFlash {
  goodId: string;
  cashDelta: number;
  n: number;
}

function MarketRow({ goodId, price, held, canBuy, canSell, grades, tag, flash, onBuy, onSell }: MarketRowProps) {
  const [qty, setQty] = useState(1);
  const [grade, setGrade] = useState<GradeId>('common');
  const good = findGood(goodId);

  const gradeHeld = grades ? grades.breakdown[grade] : held;
  const buyPrice = grades ? Math.round(price * gradeBuyMultiplier(grade)) : price;
  const sellPrice = grades ? Math.round(price * gradeSellMultiplier(grade, grades.qualityMarket)) : price;

  return (
    <div style={ROW}>
      {flash && (
        <>
          <span key={`hl-${flash.n}`} className="nb-trade-flash" aria-hidden="true" style={TRADE_FLASH} />
          <FloatingAmount key={`fl-${flash.n}`} amount={flash.cashDelta} style={{ right: '0.2rem', top: '-0.2rem' }} />
        </>
      )}
      <span style={{ flex: 1 }}>
        {good?.name ?? goodId}
        {grades?.qualityMarket && (
          <span style={{ color: UI.brass }} title="Pays a real premium for fine/excellent lots here">
            {' '}★
          </span>
        )}
        {tag && (
          <span style={{ color: tag === 'closed' ? UI.bad : UI.brass, fontSize: '0.68rem' }}>
            {' '}[{tag}]
          </span>
        )}
        {held > 0 && (
          <span
            key={flash ? `held-${flash.n}` : 'held'}
            className={flash ? 'tm-anim-pulse' : undefined}
            style={{ color: UI.textSoft, ...(flash ? { display: 'inline-block' } : {}) }}
          >
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
          <span style={{ color: UI.brass, fontSize: '0.72rem' }}>
            buy {buyPrice}f / sell {sellPrice}f
          </span>
        </>
      ) : (
        <span style={{ color: UI.brass }}>{price}f</span>
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

/** The row's brief highlight after a trade: a tint that fades out (keyframes in styles.css). */
const TRADE_FLASH: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: UI.tintBrass,
  pointerEvents: 'none',
};

interface MarketPanelProps {
  cityId: string;
  /** Which vessel is trading — so switching vessels is never mistaken for a trade. */
  vesselId?: string;
  /** The current week — this week's market news lands one line at a time when it turns over. */
  week?: number;
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
  vesselId,
  week,
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

  // Trade feedback, read off the state rather than the click: a purchase the sim refused (short of
  // cash, hold full) changes nothing and so shows nothing. Exactly one good's quantity and the purse
  // must both have moved, at the same dock aboard the same vessel. Hooks sit above the early return.
  const pace = usePace();
  const before = useRef({ cityId, vesselId, cash, cargo });
  const [flash, setFlash] = useState<TradeFlash | null>(null);
  useEffect(() => {
    const prev = before.current;
    before.current = { cityId, vesselId, cash, cargo };
    if (pace === 'off' || prev.cityId !== cityId || prev.vesselId !== vesselId || prev.cash === cash) return;
    const changed = goods.filter(g => (cargo[g] ?? 0) !== (prev.cargo[g] ?? 0));
    if (changed.length !== 1) return;
    setFlash(f => ({ goodId: changed[0], cashDelta: Math.round(cash) - Math.round(prev.cash), n: (f?.n ?? 0) + 1 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cash, cargo, cityId, vesselId]);
  useEffect(() => {
    if (!flash) return;
    const clear = window.setTimeout(() => setFlash(null), paced(1200, pace) + 50);
    return () => window.clearTimeout(clear);
  }, [flash, pace]);

  // This week's market news (event headlines, then the causes line) arrives one line at a time.
  const newsCount = localEvents.length + (causes && causes.length > 0 ? 1 : 0);
  const reveal = useStagger(week, newsCount);

  if (goods.length === 0) {
    return <p style={{ fontSize: '0.8rem', color: UI.textSoft }}>No market at {cityName}.</p>;
  }

  return (
    <div>
      <p style={LABEL}>Market — {cityName}</p>
      <p style={{ fontSize: '0.8rem', margin: '0 0 0.5rem' }}>
        Cash: <strong style={{ color: UI.brass }}><Florins value={cash} /></strong>
        {' · '}
        Hold: {used}/{capacity}
      </p>
      {localEvents.length > 0 && (
        <div style={{ margin: '0 0 0.6rem' }}>
          {localEvents.map((e, i) => {
            const r = reveal(i);
            return (
              <p
                key={e.id}
                className={r.className}
                style={{ fontSize: '0.74rem', color: e.blocksTrade ? UI.bad : UI.brass, margin: '0 0 0.3rem', fontStyle: 'italic', ...r.style }}
              >
                {e.headline}
              </p>
            );
          })}
        </div>
      )}
      {causes && causes.length > 0 && (
        <p
          className={reveal(localEvents.length).className}
          style={{ fontSize: '0.7rem', color: UI.textSoft, margin: '0 0 0.5rem', ...reveal(localEvents.length).style }}
        >
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
            flash={flash && flash.goodId === goodId && pace !== 'off' ? flash : null}
            onBuy={(quantity, grade) => onBuy(goodId, quantity, grade)}
            onSell={(quantity, grade) => onSell(goodId, quantity, grade)}
          />
        );
      })}
    </div>
  );
}
