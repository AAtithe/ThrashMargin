import { useState } from 'react';
import { UI } from '../theme';
import { findCity } from '../sim/content';
import { cargoTotal } from '../sim/market';
import {
  SHIPYARD_CITY_IDS, VESSEL_TYPES, findVesselType, fleetUpkeepPerWeek,
  isShipyard, resaleValue, vesselSpeed, vesselUpkeep,
} from '../sim/shipyard';
import type { GameState } from '../sim/types';

/**
 * The shipyard (`freeplay-and-trading-design.md` Part 4, Phase 28).
 *
 * Belongs at the head of whatever view lists the fleet, above the vessels themselves — the yard
 * sits directly above the hulls it sells you, and the player should not have to go looking to find
 * out what their fleet costs to keep.
 *
 * It has had three homes in a day, and the reasoning is worth keeping because each move was for a
 * different reason. First drafted nested in the Fleet *drawer section*. Moved to its own rail tab
 * when a concurrent refactor was extracting that section into a `FleetPanel` sidebar — an
 * extraction that would (and briefly did) drop this from the UI while every driver still passed.
 * Then back into the fleet view once that landed, because a permanent sidebar removes the original
 * objection entirely: the tab was there to survive a drawer being dismantled, and there is no
 * drawer left to survive. The separate tab was removed rather than left as a second entry point to
 * one panel.
 *
 * Every class shows cost, upkeep, hold **and passage**, because passage is the whole reason class is
 * a decision — Phase 27 measured that hold beyond what a market can absorb mostly buys time in port,
 * so a carrack's 40 units are only worth their 35% slower passage on a long run into a deep market.
 * A panel that showed capacity and price alone would make this a shopping list.
 */

const LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: UI.textSoft,
  margin: '1rem 0 0.4rem',
};

const ROW: React.CSSProperties = {
  padding: '0.45rem 0',
  borderBottom: `1px solid ${UI.rule}`,
  fontSize: '0.8rem',
};

const SMALL_BUTTON: React.CSSProperties = {
  background: UI.panel,
  border: `1px solid ${UI.rule}`,
  color: UI.text,
  padding: '0.2rem 0.5rem',
  fontFamily: 'inherit',
  fontSize: '0.7rem',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const FIELD: React.CSSProperties = {
  background: UI.panel,
  border: `1px solid ${UI.rule}`,
  color: UI.text,
  fontFamily: 'inherit',
  fontSize: '0.75rem',
  padding: '0.2rem 0.35rem',
  width: '9rem',
};

function passageLabel(speed: number): string {
  if (speed === 1) return 'ordinary passage';
  const pct = Math.round(Math.abs(speed - 1) * 100);
  return speed < 1 ? `${pct}% quicker` : `${pct}% slower`;
}

interface ShipyardPanelProps {
  state: GameState;
  onBuy: (typeId: string, name?: string) => void;
  onSell: (vesselId: string) => void;
}

export default function ShipyardPanel({ state, onBuy, onSell }: ShipyardPanelProps) {
  const [name, setName] = useState('');

  const yardCityId = state.vessels.find(v => !v.destination && isShipyard(v.location))?.location ?? null;
  const upkeep = fleetUpkeepPerWeek(state);
  const yardNames = SHIPYARD_CITY_IDS.map(id => findCity(id)?.name ?? id).join(', ');
  const laidUp = state.vesselLaidUp?.week === state.week ? state.vesselLaidUp : null;

  // Only what can actually be sold is offered, and the reason is shown when it cannot — a greyed
  // button with no explanation is the thing that makes a player think the game is broken.
  const sellable = state.vessels.map(v => {
    let blocked: string | null = null;
    if (v.destination) blocked = 'under way';
    else if (!isShipyard(v.location)) blocked = 'not at a yard';
    else if (cargoTotal(v.cargo) > 0) blocked = 'still loaded';
    else if (state.convoy?.vesselIds.includes(v.id)) blocked = 'in the convoy';
    else if ((state.insurance ?? []).some(i => i.vesselId === v.id)) blocked = 'policy running';
    else if (state.expedition?.vesselId === v.id) blocked = 'on the expedition';
    else if (v.capacity > 0 && state.vessels.filter(x => x.capacity > 0).length <= 1) blocked = 'the only hull';
    return { vessel: v, blocked };
  });

  return (
    <div>
      {laidUp && (
        <p style={{ fontSize: '0.78rem', color: UI.bad, margin: '0 0 0.5rem' }}>
          {laidUp.vesselName} has been laid up — the house could not meet her upkeep. She still sails
          and still carries, but no faster than any other hull, and she costs nothing now.
        </p>
      )}

      <p style={{ ...LABEL, marginTop: 0 }}>The yard</p>
      <p style={{ fontSize: '0.78rem', color: UI.textSoft, margin: '0 0 0.5rem' }}>
        {upkeep > 0
          ? `${state.vessels.length} hulls, ${upkeep}f a week in upkeep — drawn with the household's wages.`
          : `${state.vessels.length} hulls, none of them costing upkeep. Hulls the house was given cost nothing to keep.`}
        {' '}Yards at {yardNames}.
      </p>

      {yardCityId ? (
        <>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.5rem' }}>
            <input
              style={FIELD}
              placeholder="Name her (optional)"
              value={name}
              maxLength={32}
              onChange={e => setName(e.target.value)}
            />
            <span style={{ fontSize: '0.72rem', color: UI.textFaint }}>
              at {findCity(yardCityId)?.name ?? yardCityId}
            </span>
          </div>
          {VESSEL_TYPES.map(t => {
            const affordable = t.cost <= state.cash;
            return (
              <div key={t.id} style={ROW}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'baseline' }}>
                  <span>
                    {t.name}
                    <span style={{ color: UI.textSoft, fontSize: '0.72rem' }}>
                      {' '}— hold {t.capacity}, {passageLabel(t.speed)}, {t.upkeepPerWeek}f a week
                    </span>
                  </span>
                  <button
                    style={SMALL_BUTTON}
                    disabled={!affordable}
                    onClick={() => { onBuy(t.id, name || undefined); setName(''); }}
                  >
                    {t.cost}f{!affordable && ' — short'}
                  </button>
                </div>
                <div style={{ fontSize: '0.72rem', color: UI.textFaint, marginTop: '0.15rem' }}>{t.note}</div>
              </div>
            );
          })}
        </>
      ) : (
        <p style={{ fontSize: '0.75rem', color: UI.textSoft, margin: 0 }}>
          Bring a vessel to {yardNames} to buy or sell a hull.
        </p>
      )}

      <p style={LABEL}>Sell a hull</p>
      {sellable.map(({ vessel: v, blocked }) => {
        const type = findVesselType(v.typeId);
        return (
          <div key={v.id} style={{ ...ROW, display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'baseline' }}>
            <span>
              {v.name}
              <span style={{ color: UI.textSoft, fontSize: '0.72rem' }}>
                {' '}— {type ? type.name : 'unclassed'}
                {v.capacity > 0 && `, hold ${v.capacity}`}
                {vesselUpkeep(v) > 0 && `, ${vesselUpkeep(v)}f a week`}
                {vesselSpeed(v) !== 1 && `, ${passageLabel(vesselSpeed(v))}`}
              </span>
            </span>
            {blocked ? (
              <span style={{ fontSize: '0.72rem', color: UI.textFaint, whiteSpace: 'nowrap' }}>{blocked}</span>
            ) : (
              <button style={SMALL_BUTTON} onClick={() => onSell(v.id)}>
                Sell — {resaleValue(v)}f
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
