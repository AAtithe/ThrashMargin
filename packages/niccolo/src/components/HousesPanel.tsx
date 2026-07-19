import { useState } from 'react';
import { CITIES, findCity } from '../sim/content';
import { agentPlacementCost } from '../sim/houses';
import type { Agent, AgentPlacement, House } from '../sim/types';

const LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '0.9rem 0 0.4rem',
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

const FIELD: React.CSSProperties = {
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  fontFamily: 'inherit',
  fontSize: '0.7rem',
  padding: '0.2rem 0.3rem',
  marginTop: '0.25rem',
  width: '100%',
};

const SMALL_BUTTON: React.CSSProperties = {
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  padding: '0.2rem 0.5rem',
  fontFamily: 'inherit',
  fontSize: '0.7rem',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

function dispositionColor(disposition: House['disposition']): string {
  if (disposition === 'ally') return '#3a6b5a';
  if (disposition === 'hostile') return '#b5451a';
  return '#a08040';
}

interface HousesPanelProps {
  houses: House[];
  houseRelations: Record<string, number>;
  agents: Agent[];
  cash: number;
  onPlaceAgent: (placement: AgentPlacement, name?: string) => void;
}

export default function HousesPanel({ houses, houseRelations, agents, cash, onPlaceAgent }: HousesPanelProps) {
  const [target, setTarget] = useState<string>(() => (houses[0] ? `house:${houses[0].id}` : ''));
  const [name, setName] = useState('');
  const cost = agentPlacementCost(agents);
  const canAfford = cost <= cash;

  const submit = () => {
    const [type, id] = target.split(':');
    const placement: AgentPlacement = type === 'city' ? { type: 'city', cityId: id } : { type: 'house', houseId: id };
    onPlaceAgent(placement, name);
    setName('');
  };

  return (
    <div>
      <p style={LABEL}>Houses &amp; Agents</p>
      {houses.map(house => {
        const relation = Math.round(houseRelations[house.id] ?? house.baselineRelation);
        const placed = agents.filter(a => a.placement.type === 'house' && a.placement.houseId === house.id);
        return (
          <div key={house.id} style={ROW}>
            <div style={{ flex: 1 }}>
              <div>
                {house.name}{' '}
                <span style={{ color: dispositionColor(house.disposition), fontSize: '0.7rem' }}>
                  ({house.disposition})
                </span>
              </div>
              <div style={{ fontSize: '0.7rem', color: '#8a7a5a' }}>
                Seat: {findCity(house.homeCity)?.name ?? house.homeCity} · relation {relation}/100
                {placed.length > 0 && ` · ${placed.map(a => a.name).join(', ')} inside`}
              </div>
            </div>
          </div>
        );
      })}

      {agents.filter(a => a.placement.type === 'city').length > 0 && (
        <p style={{ fontSize: '0.7rem', color: '#8a7a5a', margin: '0.4rem 0 0' }}>
          Shielding cities:{' '}
          {agents
            .filter(a => a.placement.type === 'city')
            .map(a => `${a.name} (${findCity((a.placement as { cityId: string }).cityId)?.name ?? ''})`)
            .join(', ')}
        </p>
      )}

      <div style={{ marginTop: '0.5rem' }}>
        <input
          style={FIELD}
          placeholder="Agent's name (optional)"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <select style={FIELD} value={target} onChange={e => setTarget(e.target.value)}>
          <optgroup label="Inside a house">
            {houses.map(h => (
              <option key={`house:${h.id}`} value={`house:${h.id}`}>
                Inside {h.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="In a city">
            {CITIES.map(c => (
              <option key={`city:${c.id}`} value={`city:${c.id}`}>
                Shield {c.name}'s reports
              </option>
            ))}
          </optgroup>
        </select>
        <button style={{ ...SMALL_BUTTON, marginTop: '0.35rem', width: '100%' }} disabled={!canAfford} onClick={submit}>
          Place agent — {cost}f{!canAfford && ' (not enough cash)'}
        </button>
      </div>
    </div>
  );
}
