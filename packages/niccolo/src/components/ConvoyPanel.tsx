import { useState } from 'react';
import { findCity } from '../sim/content';
import {
  ESCORT_HIRE_COST,
  ESCORT_UPKEEP_PER_WEEK,
  convoyEligible,
  convoySummary,
} from '../sim/convoy';
import type { GameState } from '../sim/types';

/**
 * Convoys, Chapter 6's "mass logistics" (design doc §12). Lives inside the existing Fleet section
 * rather than claiming a tenth rail tab — it is a fact about the vessels already listed there, and
 * the same consolidation call Phase 4 made folding the Counting House into the Ledger and Phase 11
 * made folding insurance into the dispatch flow.
 *
 * Self-hides until the player actually has two cargo-capable hulls, which only happens once Chapter
 * 6 grants them: every earlier campaign has exactly one ship plus couriers, and a permanently
 * greyed-out "form a convoy" control would be noise for five chapters.
 */

const LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '1.1rem 0 0.4rem',
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

const FIELD: React.CSSProperties = {
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  fontFamily: 'inherit',
  fontSize: '0.7rem',
  padding: '0.2rem 0.3rem',
  marginBottom: '0.35rem',
  width: '100%',
};

interface ConvoyPanelProps {
  state: GameState;
  onForm: (vesselIds: string[]) => void;
  onDisband: () => void;
  onHireEscort: (escortName?: string) => void;
}

export default function ConvoyPanel({ state, onForm, onDisband, onHireEscort }: ConvoyPanelProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const [escortName, setEscortName] = useState('');

  const eligible = convoyEligible(state.vessels);
  const convoy = state.convoy;

  if (!convoy && eligible.length < 2) return null;

  if (convoy) {
    const members = state.vessels.filter(v => convoy.vesselIds.includes(v.id));
    const totalHold = members.reduce((sum, v) => sum + v.capacity, 0);
    const carried = members.reduce(
      (sum, v) => sum + Object.values(v.cargo).reduce((a, b) => a + (b > 0 ? b : 0), 0),
      0,
    );
    const underWay = members.some(v => v.destination);
    return (
      <div>
        <p style={LABEL}>Convoy</p>
        <p style={{ fontSize: '0.8rem', margin: '0 0 0.3rem' }}>{convoySummary(state)}</p>
        <p style={{ fontSize: '0.72rem', color: '#8a7a5a', margin: '0 0 0.4rem' }}>
          Combined hold {carried}/{totalHold} · {members.map(v => v.name).join(', ')}. Sending any one of
          them sends them all.
        </p>
        {convoy.escorted ? (
          <p style={{ fontSize: '0.75rem', color: '#3a6b5a', margin: '0 0 0.4rem' }}>
            Under escort{convoy.escortName ? ` — ${convoy.escortName}` : ''} · {ESCORT_UPKEEP_PER_WEEK}f a week.
            Storm and piracy losses run well under half their usual chance.
          </p>
        ) : (
          <>
            <input
              style={FIELD}
              placeholder="Name the escort (optional)"
              value={escortName}
              onChange={e => setEscortName(e.target.value)}
            />
            <button
              id="convoy-hire-escort"
              style={{ ...SMALL_BUTTON, marginBottom: '0.4rem' }}
              disabled={underWay || ESCORT_HIRE_COST > state.cash}
              onClick={() => {
                onHireEscort(escortName);
                setEscortName('');
              }}
            >
              Hire an escort — {ESCORT_HIRE_COST}f, then {ESCORT_UPKEEP_PER_WEEK}f a week
              {underWay ? ' (only in port)' : ESCORT_HIRE_COST > state.cash ? ' (not enough cash)' : ''}
            </button>
          </>
        )}
        {state.escortLapsed && (
          <p style={{ fontSize: '0.72rem', color: '#b5451a', margin: '0 0 0.4rem' }}>
            The escort was paid off this week — there was nothing to pay it with.
          </p>
        )}
        <button style={SMALL_BUTTON} onClick={onDisband}>
          Break up the convoy
        </button>
      </div>
    );
  }

  const toggle = (id: string) =>
    setPicked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  // Only vessels sitting in the same port can form up, and the sim enforces it too — but showing
  // where each one is beats letting the player pick an impossible set and read an error.
  const canForm = picked.length >= 2;

  return (
    <div>
      <p style={LABEL}>Convoy</p>
      <p style={{ fontSize: '0.75rem', color: '#8a7a5a', margin: '0 0 0.4rem' }}>
        Two or more vessels in the same port can sail as one, and share an escort.
      </p>
      {eligible.map(v => (
        <label
          key={v.id}
          style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start', fontSize: '0.75rem', margin: '0 0 0.25rem' }}
        >
          <input type="checkbox" checked={picked.includes(v.id)} onChange={() => toggle(v.id)} />
          <span>
            {v.name}{' '}
            <span style={{ color: '#8a7a5a' }}>
              — {v.destination ? 'at sea' : `in port at ${findCity(v.location)?.name ?? v.location}`}
            </span>
          </span>
        </label>
      ))}
      <button
        id="convoy-form"
        style={{ ...SMALL_BUTTON, marginTop: '0.3rem' }}
        disabled={!canForm}
        onClick={() => {
          onForm(picked);
          setPicked([]);
        }}
      >
        Form a convoy{!canForm ? ' (pick at least two)' : ''}
      </button>
    </div>
  );
}
