import { useState } from 'react';
import { UI } from '../theme';
import { findCity, findGood } from '../sim/content';
import { gradeBreakdown, isPilotGood } from '../sim/grades';
import { cargoTotal, priceAt } from '../sim/market';
import {
  WAREHOUSE_EXPANSION_CAPACITY,
  WAREHOUSE_EXPANSION_COST,
  WAREHOUSE_LEASE_COST,
  WAREHOUSE_MAX_CAPACITY,
  canLeaseWarehouseAt,
  warehouseRentPerWeek,
  warehouseSpaceLeft,
  warehouseUsed,
} from '../sim/warehouse';
import type { GameState, GradeId, Vessel, Warehouse } from '../sim/types';

/**
 * City warehousing (`freeplay-and-trading-design.md` Part 2, Phase 26).
 *
 * Two halves, and the split matters: the **lease** half is about the city the selected vessel is
 * standing in, because that is the only city where anything can be signed or moved; the **standing**
 * half lists every shed the house holds anywhere, because rent is drawn on all of them every week
 * and a warehouse the player has forgotten about is a slow leak. A panel that only showed the
 * current city would hide exactly the thing that costs money.
 *
 * Storing and withdrawing are shown as one row per good with a single quantity box and two buttons,
 * mirroring `MarketPanel`'s row rather than inventing a second vocabulary for moving goods — the
 * player already knows that shape means "how many, and which way".
 */

const LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: UI.textSoft,
  margin: '0.9rem 0 0.4rem',
};

const ROW: React.CSSProperties = {
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

const GRADE_LABEL: Record<GradeId, string> = { common: 'common', fine: 'fine', excellent: 'excellent' };

function gradeSummary(cargo: Record<string, number>, grades: Warehouse['grades'], goodId: string): string {
  const breakdown = gradeBreakdown(cargo, grades, goodId);
  return (['common', 'fine', 'excellent'] as GradeId[])
    .filter(g => breakdown[g] > 0)
    .map(g => `${breakdown[g]} ${GRADE_LABEL[g]}`)
    .join(', ');
}

interface MoveRowProps {
  goodId: string;
  /** Units in the shed, and aboard, so the row can show both sides of the move at once. */
  inStore: number;
  aboard: number;
  storeLabel: string;
  aboardLabel: string;
  price: number | null;
  gradedStore?: string;
  gradedAboard?: string;
  onStore: (quantity: number, grade: GradeId) => void;
  onWithdraw: (quantity: number, grade: GradeId) => void;
  maxStore: number;
  maxWithdraw: number;
  graded: boolean;
}

function MoveRow({
  goodId,
  inStore,
  aboard,
  storeLabel,
  aboardLabel,
  price,
  gradedStore,
  gradedAboard,
  onStore,
  onWithdraw,
  maxStore,
  maxWithdraw,
  graded,
}: MoveRowProps) {
  const [qty, setQty] = useState(1);
  const [grade, setGrade] = useState<GradeId>('common');
  const good = findGood(goodId);

  return (
    <div style={ROW}>
      <span style={{ flex: 1 }}>
        {good?.name ?? goodId}
        <span style={{ color: UI.textSoft, fontSize: '0.72rem' }}>
          {' '}
          — {storeLabel} {graded && gradedStore ? `(${gradedStore})` : `${inStore}`}, {aboardLabel}{' '}
          {graded && gradedAboard ? `(${gradedAboard})` : `${aboard}`}
        </span>
      </span>
      {price !== null && <span style={{ color: UI.brass, fontSize: '0.72rem' }}>{price}f here</span>}
      {graded && (
        <select value={grade} onChange={e => setGrade(e.target.value as GradeId)} style={{ ...QTY_INPUT, width: '4.6rem' }}>
          <option value="common">common</option>
          <option value="fine">fine</option>
          <option value="excellent">excellent</option>
        </select>
      )}
      <input
        type="number"
        min={1}
        value={qty}
        style={QTY_INPUT}
        onChange={e => setQty(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
      />
      <button style={SMALL_BUTTON} disabled={maxStore <= 0} onClick={() => onStore(qty, grade)}>
        Store
      </button>
      <button style={SMALL_BUTTON} disabled={maxWithdraw <= 0} onClick={() => onWithdraw(qty, grade)}>
        Load
      </button>
    </div>
  );
}

interface WarehousePanelProps {
  state: GameState;
  selectedVessel: Vessel | null;
  onLease: (cityId: string) => void;
  onExpand: (cityId: string) => void;
  onStore: (vesselId: string, goodId: string, quantity: number, grade: GradeId) => void;
  onWithdraw: (vesselId: string, goodId: string, quantity: number, grade: GradeId) => void;
}

export default function WarehousePanel({
  state,
  selectedVessel,
  onLease,
  onExpand,
  onStore,
  onWithdraw,
}: WarehousePanelProps) {
  const warehouses = Object.values(state.warehouses ?? {});
  const totalRent = warehouses.reduce((sum, w) => sum + warehouseRentPerWeek(w.capacity), 0);

  // Only a docked vessel gives the player a city to act in. A vessel under way has no location the
  // house can sign a lease in or move goods at, which is the same rule `MarketPanel` and
  // `EstatePanel` already apply.
  const here = selectedVessel && !selectedVessel.destination ? selectedVessel : null;
  const hereCityId = here?.location ?? null;
  const hereWarehouse = hereCityId ? state.warehouses?.[hereCityId] ?? null : null;
  const hereCityName = hereCityId ? findCity(hereCityId)?.name ?? hereCityId : null;

  // Every good either side of the move at this city, so a lot can be brought back aboard even after
  // the city has stopped selling it.
  const movableGoods = hereWarehouse && here
    ? Array.from(new Set([...Object.keys(hereWarehouse.cargo), ...Object.keys(here.cargo)])).filter(
        g => (hereWarehouse.cargo[g] ?? 0) > 0 || (here.cargo[g] ?? 0) > 0,
      )
    : [];

  const lapses = (state.lastWarehouseLapses ?? []).filter(l => l.week === state.week);

  return (
    <div>
      {lapses.map(l => (
        <p key={l.cityId} style={{ fontSize: '0.78rem', color: UI.bad, margin: '0 0 0.5rem' }}>
          The lease at {findCity(l.cityId)?.name ?? l.cityId} lapsed for want of rent.{' '}
          {l.unitsLost > 0
            ? `${l.unitsLost} unit${l.unitsLost === 1 ? '' : 's'} went with it${l.proceeds > 0 ? `, for ${l.proceeds}f` : ', for nothing'}.`
            : 'It was empty.'}
        </p>
      ))}

      <p style={{ ...LABEL, marginTop: 0 }}>Storage</p>
      <p style={{ fontSize: '0.78rem', color: UI.textSoft, margin: '0 0 0.5rem' }}>
        {warehouses.length === 0
          ? 'The house stores nothing anywhere. A warehouse lets a full hold be landed and the sale metered out over weeks instead of dumped at once.'
          : `${warehouses.length} lease${warehouses.length === 1 ? '' : 's'}, ${totalRent}f a week in rent. Rent is drawn with the household's wages; unpaid, a lease lapses and its contents are sold off cheap.`}
      </p>

      {hereCityId && hereCityName && (
        <>
          <p style={LABEL}>At {hereCityName}</p>
          {!hereWarehouse ? (
            canLeaseWarehouseAt(hereCityId) ? (
              <button
                style={SMALL_BUTTON}
                disabled={WAREHOUSE_LEASE_COST > state.cash}
                onClick={() => onLease(hereCityId)}
              >
                Lease a warehouse — {WAREHOUSE_LEASE_COST}f, then {warehouseRentPerWeek(20)}f a week
                {WAREHOUSE_LEASE_COST > state.cash && ' (not enough cash)'}
              </button>
            ) : (
              <p style={{ fontSize: '0.75rem', color: UI.textSoft, margin: 0 }}>
                {hereCityName} has no market to time a sale into, so there is nothing to store for.
              </p>
            )
          ) : (
            <>
              <p style={{ fontSize: '0.78rem', margin: '0 0 0.4rem' }}>
                {warehouseUsed(hereWarehouse)} of {hereWarehouse.capacity} units stored ·{' '}
                {warehouseRentPerWeek(hereWarehouse.capacity)}f a week
              </p>
              {hereWarehouse.capacity < WAREHOUSE_MAX_CAPACITY ? (
                <button
                  style={{ ...SMALL_BUTTON, marginBottom: '0.4rem' }}
                  disabled={WAREHOUSE_EXPANSION_COST > state.cash}
                  onClick={() => onExpand(hereCityId)}
                >
                  Take the next bay — +{WAREHOUSE_EXPANSION_CAPACITY} units for {WAREHOUSE_EXPANSION_COST}f
                  {WAREHOUSE_EXPANSION_COST > state.cash && ' (not enough cash)'}
                </button>
              ) : (
                <p style={{ fontSize: '0.72rem', color: UI.textFaint, margin: '0 0 0.4rem', fontStyle: 'italic' }}>
                  As large as the ground allows.
                </p>
              )}
              {here && movableGoods.length > 0 ? (
                movableGoods.map(goodId => {
                  const graded = isPilotGood(goodId);
                  const inStore = hereWarehouse.cargo[goodId] ?? 0;
                  const aboard = here.cargo[goodId] ?? 0;
                  return (
                    <MoveRow
                      key={goodId}
                      goodId={goodId}
                      inStore={inStore}
                      aboard={aboard}
                      storeLabel="in store"
                      aboardLabel="aboard"
                      price={priceAt(state.scarcity, hereCityId, goodId, state.marketEvents)}
                      graded={graded}
                      gradedStore={graded ? gradeSummary(hereWarehouse.cargo, hereWarehouse.grades, goodId) : undefined}
                      gradedAboard={graded ? gradeSummary(here.cargo, here.cargoGrades, goodId) : undefined}
                      maxStore={Math.min(aboard, warehouseSpaceLeft(hereWarehouse))}
                      maxWithdraw={Math.min(inStore, here.capacity - cargoTotal(here.cargo))}
                      onStore={(q, g) => onStore(here.id, goodId, q, g)}
                      onWithdraw={(q, g) => onWithdraw(here.id, goodId, q, g)}
                    />
                  );
                })
              ) : (
                <p style={{ fontSize: '0.75rem', color: UI.textSoft, margin: 0 }}>
                  Nothing aboard and nothing in store to move.
                </p>
              )}
            </>
          )}
        </>
      )}

      {!hereCityId && (
        <p style={{ fontSize: '0.75rem', color: UI.textSoft, margin: '0 0 0.5rem' }}>
          Select a docked vessel to sign a lease or move goods.
        </p>
      )}

      {warehouses.length > 0 && (
        <>
          <p style={LABEL}>Every lease</p>
          {warehouses.map(w => {
            const contents = Object.entries(w.cargo).filter(([, n]) => n > 0);
            return (
              <div key={w.cityId} style={{ ...ROW, display: 'block' }}>
                <div>
                  {findCity(w.cityId)?.name ?? w.cityId}
                  <span style={{ color: UI.textSoft, fontSize: '0.72rem' }}>
                    {' '}
                    — {warehouseUsed(w)}/{w.capacity} units, {warehouseRentPerWeek(w.capacity)}f a week
                  </span>
                </div>
                <div style={{ fontSize: '0.72rem', color: contents.length ? UI.textSoft : UI.textFaint }}>
                  {contents.length
                    ? contents.map(([g, n]) => `${n} ${findGood(g)?.name ?? g}`).join(', ')
                    : 'empty — paying rent for nothing'}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
