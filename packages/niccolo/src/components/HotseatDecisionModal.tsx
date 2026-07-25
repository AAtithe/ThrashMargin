import { useState } from 'react';
import { CITIES, HOME_CITY, findGood, marketGoodsAt } from '../sim/content';
import type { House, HotseatDecision } from '../sim/types';

const BACKDROP: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(8, 6, 4, 0.78)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: '2rem',
};

const CARD: React.CSSProperties = {
  background: '#17130d',
  border: '1px solid #4a3d28',
  boxShadow: '0 0 0 1px #0e0b07, 0 8px 40px rgba(0,0,0,0.6)',
  maxWidth: '28rem',
  width: '100%',
  padding: '1.6rem',
  fontFamily: '"Georgia", "Times New Roman", serif',
  color: '#c9b88a',
};

const TITLE: React.CSSProperties = {
  fontSize: '1.15rem',
  letterSpacing: '0.03em',
  color: '#e8d5a3',
  margin: '0 0 0.3rem',
};

const SUB: React.CSSProperties = {
  fontSize: '0.8rem',
  color: '#8a7a5a',
  margin: '0 0 1.3rem',
};

const LABEL: React.CSSProperties = {
  fontSize: '0.72rem',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '0 0 0.4rem',
};

const FIELD: React.CSSProperties = {
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  fontFamily: 'inherit',
  fontSize: '0.82rem',
  padding: '0.4rem 0.5rem',
};

const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  marginBottom: '1.1rem',
  flexWrap: 'wrap',
};

const BUTTON: React.CSSProperties = {
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  padding: '0.5rem 0.9rem',
  fontFamily: 'inherit',
  fontSize: '0.82rem',
  cursor: 'pointer',
};

const PRIMARY_BUTTON: React.CSSProperties = { ...BUTTON, border: '1px solid #e8d5a3', color: '#e8d5a3' };

interface HotseatDecisionModalProps {
  house: House;
  /** True if some docked, cargo-carrying player vessel currently sits at this house's own home
   * city — the same eligibility `resolveHouseSabotage` itself requires before anything can happen. */
  sabotageEligible: boolean;
  onConfirm: (decision: HotseatDecision) => void;
  onCancel: () => void;
}

/**
 * The hotseat house experiment's weekly decision prompt (Phase 14) — shown instead of advancing
 * immediately when `GameState.hotseatHouseId` names a house, mirroring Thrash Margin's own
 * same-device "your move" hotseat pattern. Collects the small number of choices
 * `sim/houses.ts` otherwise resolves by `Math.random()` for this one house; every other house is
 * untouched. Plant/sabotage controls only appear for a hostile house — an ally or neutral house
 * never rolls either mechanic today, so there's nothing to hand a human for those two.
 */
export default function HotseatDecisionModal({ house, sabotageEligible, onConfirm, onCancel }: HotseatDecisionModalProps) {
  const homeGoods = marketGoodsAt(house.homeCity);
  const [tradeGoodId, setTradeGoodId] = useState(homeGoods[0] ?? '');
  const [tradeDirection, setTradeDirection] = useState<1 | -1>(1);
  const [wantsToPlant, setWantsToPlant] = useState(false);
  const [plantTargetCityId, setPlantTargetCityId] = useState(
    CITIES.find(c => c.id !== HOME_CITY)?.id ?? '',
  );
  const [attemptSabotage, setAttemptSabotage] = useState(false);

  const isHostile = house.disposition === 'hostile';

  return (
    <div style={BACKDROP}>
      <div style={CARD}>
        <h2 style={TITLE}>{house.name}'s move this week</h2>
        <p style={SUB}>You're seated at {house.name} this week — everyone else's business proceeds as usual.</p>

        <p style={LABEL}>Nudge the market at {house.homeCity}</p>
        <div style={ROW}>
          <select style={FIELD} value={tradeGoodId} onChange={e => setTradeGoodId(e.target.value)}>
            {homeGoods.map(goodId => (
              <option key={goodId} value={goodId}>{findGood(goodId)?.name ?? goodId}</option>
            ))}
          </select>
          <select
            style={FIELD}
            value={tradeDirection}
            onChange={e => setTradeDirection(Number(e.target.value) as 1 | -1)}
          >
            <option value={1}>scarcer (dearer)</option>
            <option value={-1}>more plentiful (cheaper)</option>
          </select>
        </div>

        {isHostile && (
          <>
            <p style={LABEL}>Plant false news?</p>
            <div style={ROW}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}>
                <input type="checkbox" checked={wantsToPlant} onChange={e => setWantsToPlant(e.target.checked)} />
                target a city's report
              </label>
              {wantsToPlant && (
                <select style={FIELD} value={plantTargetCityId} onChange={e => setPlantTargetCityId(e.target.value)}>
                  {CITIES.filter(c => c.id !== HOME_CITY).map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>

            <p style={LABEL}>Sabotage</p>
            <div style={ROW}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', opacity: sabotageEligible ? 1 : 0.5 }}>
                <input
                  type="checkbox"
                  checked={attemptSabotage}
                  disabled={!sabotageEligible}
                  onChange={e => setAttemptSabotage(e.target.checked)}
                />
                {sabotageEligible
                  ? `attempt it against cargo docked at ${house.homeCity}`
                  : `no eligible cargo at ${house.homeCity} this week`}
              </label>
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button style={BUTTON} onClick={onCancel}>Not yet</button>
          <button
            style={PRIMARY_BUTTON}
            onClick={() =>
              onConfirm({
                tradeGoodId,
                tradeDirection,
                plantTargetCityId: isHostile && wantsToPlant ? plantTargetCityId : null,
                attemptSabotage: isHostile && sabotageEligible && attemptSabotage,
              })
            }
          >
            Confirm {house.name}'s move
          </button>
        </div>
      </div>
    </div>
  );
}
