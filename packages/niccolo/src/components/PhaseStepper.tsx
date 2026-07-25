const BUTTON: React.CSSProperties = {
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  padding: '0.4rem 0.7rem',
  fontFamily: 'inherit',
  fontSize: '0.78rem',
  letterSpacing: '0.03em',
  cursor: 'pointer',
};

const BUTTON_ACTIVE: React.CSSProperties = { ...BUTTON, border: '1px solid #e8d5a3', color: '#e8d5a3' };

export interface PhaseStepperStep {
  id: string;
  label: string;
}

interface PhaseStepperProps {
  steps: PhaseStepperStep[];
  active: string;
  visited: Set<string>;
  onSelect: (id: string) => void;
}

/**
 * Multi-step turns (Phase 14) — an organizational grouping only, never a gate: every step stays
 * freely switchable, and "Advance one week" in the header works regardless of which is selected.
 * The checkmark is a cosmetic nudge (has this area been looked at this week?), not a completion
 * requirement — see the design note this shipped with for why a hard gate doesn't fit this game
 * (some weeks genuinely have nothing to do in a given area).
 */
export default function PhaseStepper({ steps, active, visited, onSelect }: PhaseStepperProps) {
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.2rem' }}>
      {steps.map(step => (
        <button
          key={step.id}
          style={step.id === active ? BUTTON_ACTIVE : BUTTON}
          onClick={() => onSelect(step.id)}
        >
          {visited.has(step.id) ? '✓ ' : ''}
          {step.label}
        </button>
      ))}
    </div>
  );
}
