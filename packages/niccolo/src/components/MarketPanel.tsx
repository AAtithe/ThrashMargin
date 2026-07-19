import { useState } from 'react';
import { findGood, marketGoodsAt } from '../sim/content';
import { cargoTotal, priceAt } from '../sim/market';
import type { Cargo, MarketScarcity } from '../sim/types';

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
  onBuy: (quantity: number) => void;
  onSell: (quantity: number) => void;
}

function MarketRow({ goodId, price, held, canBuy, canSell, onBuy, onSell }: MarketRowProps) {
  const [qty, setQty] = useState(1);
  const good = findGood(goodId);

  return (
    <div style={ROW}>
      <span style={{ flex: 1 }}>
        {good?.name ?? goodId}
        {held > 0 && <span style={{ color: '#8a7a5a' }}> ({held} held)</span>}
      </span>
      <span style={{ color: '#e8d5a3' }}>{price}f</span>
      <input
        type="number"
        min={1}
        value={qty}
        style={QTY_INPUT}
        onChange={e => setQty(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
      />
      <button style={SMALL_BUTTON} disabled={!canBuy} onClick={() => onBuy(qty)}>
        Buy
      </button>
      <button style={SMALL_BUTTON} disabled={!canSell || held < qty} onClick={() => onSell(qty)}>
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
  capacity: number;
  scarcity: MarketScarcity;
  onBuy: (goodId: string, quantity: number) => void;
  onSell: (goodId: string, quantity: number) => void;
}

export default function MarketPanel({
  cityId,
  cityName,
  cash,
  cargo,
  capacity,
  scarcity,
  onBuy,
  onSell,
}: MarketPanelProps) {
  const goods = marketGoodsAt(cityId);
  const used = cargoTotal(cargo);

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
      {goods.map(goodId => {
        const price = priceAt(scarcity, cityId, goodId) ?? 0;
        const held = cargo[goodId] ?? 0;
        return (
          <MarketRow
            key={goodId}
            goodId={goodId}
            price={price}
            held={held}
            canBuy={capacity > used}
            canSell={held > 0}
            onBuy={quantity => onBuy(goodId, quantity)}
            onSell={quantity => onSell(goodId, quantity)}
          />
        );
      })}
    </div>
  );
}
