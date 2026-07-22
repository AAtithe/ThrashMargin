import { useState } from 'react';
import { findCity, findGood } from '../sim/content';
import { ESTATE_CITY, ESTATE_ESTABLISH_COST, ESTATE_GOOD } from '../sim/estates';
import { cargoTotal } from '../sim/market';
import type { Estate, Vessel } from '../sim/types';

const LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '0 0 0.4rem',
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

const QTY_INPUT: React.CSSProperties = {
  width: '2.6rem',
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  fontFamily: 'inherit',
  fontSize: '0.75rem',
  padding: '0.15rem',
};

function stageLabel(estate: Estate): string {
  if (estate.stage === 'growing') return `growing (${estate.weeksInStage} of 8 weeks)`;
  if (estate.stage === 'refining') return `refining (${estate.weeksInStage} of 3 weeks)`;
  return 'ready to harvest';
}

interface EstatePanelProps {
  estate: Estate | null;
  flags: Record<string, boolean>;
  cash: number;
  selectedVessel: Vessel | null;
  onEstablish: () => void;
  onHarvest: () => void;
  onShip: (vesselId: string, quantity: number) => void;
}

export default function EstatePanel({ estate, flags, cash, selectedVessel, onEstablish, onHarvest, onShip }: EstatePanelProps) {
  const [qty, setQty] = useState(1);

  if (!estate && !flags.kouklia_estate_available) return null;

  const cityName = findCity(ESTATE_CITY)?.name ?? ESTATE_CITY;
  const goodName = findGood(ESTATE_GOOD)?.name ?? ESTATE_GOOD;

  if (!estate) {
    const canAfford = ESTATE_ESTABLISH_COST <= cash;
    return (
      <div>
        <p style={LABEL}>Estate</p>
        <p style={{ fontSize: '0.8rem', margin: '0 0 0.4rem' }}>
          A sugar estate has been offered near {cityName}, awaiting the house's capital.
        </p>
        <button style={SMALL_BUTTON} disabled={!canAfford} onClick={onEstablish}>
          Establish the estate — {ESTATE_ESTABLISH_COST}f{!canAfford && ' (not enough cash)'}
        </button>
      </div>
    );
  }

  const vesselHere = selectedVessel && !selectedVessel.destination && selectedVessel.location === estate.cityId
    ? selectedVessel
    : null;
  const spaceLeft = vesselHere ? vesselHere.capacity - cargoTotal(vesselHere.cargo) : 0;
  const maxLoad = Math.min(estate.stockpile, spaceLeft);

  return (
    <div>
      <p style={LABEL}>Estate — {cityName}</p>
      <p style={{ fontSize: '0.8rem', margin: '0 0 0.4rem' }}>
        {goodName}: {stageLabel(estate)} · {estate.stockpile} in store
      </p>
      {estate.stage === 'ready' && (
        <button style={{ ...SMALL_BUTTON, marginBottom: '0.4rem' }} onClick={onHarvest}>
          Harvest the crop
        </button>
      )}
      {vesselHere ? (
        estate.stockpile > 0 ? (
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input
              type="number"
              min={1}
              max={maxLoad || 1}
              value={qty}
              style={QTY_INPUT}
              onChange={e => setQty(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
            />
            <button
              style={SMALL_BUTTON}
              disabled={maxLoad <= 0}
              onClick={() => onShip(vesselHere.id, Math.min(qty, maxLoad))}
            >
              Load onto {vesselHere.name}
            </button>
          </div>
        ) : (
          <p style={{ fontSize: '0.75rem', color: '#8a7a5a', margin: 0 }}>Nothing in store yet to load.</p>
        )
      ) : (
        <p style={{ fontSize: '0.75rem', color: '#8a7a5a', margin: 0 }}>
          Dock a vessel at {cityName} to load its store.
        </p>
      )}
    </div>
  );
}
