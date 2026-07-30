import { findCity } from '../sim/content';
import {
  DIVINING_CITIES,
  DIVINING_CONSCIENCE_COST,
  DIVINING_REST_WEEKS,
  DIVINING_UNLOCK_FLAG,
  diviningAvailability,
  diviningState,
} from '../sim/divining';
import type { DiviningPurpose, GameState } from '../sim/types';

/**
 * The divining gift (design doc §8 track 4). Sits in the same popup as the Evidence Board because
 * both belong to §8's personal plot layer rather than to the commercial game — the Household screen
 * is for officers who draw a salary, and Nicholas is not one of them.
 *
 * Every button's disabled state comes from `diviningAvailability`, the same function `useDivining`
 * itself checks, so a greyed-out button and a thrown error can never disagree about why.
 */

const LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '1.2rem 0 0.4rem',
};

const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '0.5rem',
  padding: '0.4rem 0',
  borderBottom: '1px solid #2a2117',
  fontSize: '0.78rem',
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

const PURPOSES: { purpose: DiviningPurpose; label: string; asks: string }[] = [
  { purpose: 'water', label: 'Water', asks: 'Where a well will come in on the desert road.' },
  { purpose: 'ore', label: 'Ore', asks: "Whether there is a seam under a tenant's field, and where." },
  { purpose: 'person', label: 'A direction', asks: "Which way a particular person lies from here, and nothing more." },
];

interface DiviningPanelProps {
  state: GameState;
  onUse: (purpose: DiviningPurpose) => void;
}

export default function DiviningPanel({ state, onUse }: DiviningPanelProps) {
  const unlocked = !!state.flags[DIVINING_UNLOCK_FLAG];
  const d = diviningState(state);

  return (
    <div>
      <p style={LABEL}>The gift</p>
      {!unlocked ? (
        <p style={{ fontSize: '0.78rem', color: '#6a5a40', margin: 0, fontStyle: 'italic' }}>
          Not yet put to any deliberate use.
        </p>
      ) : (
        <>
          <p style={{ fontSize: '0.75rem', color: '#8a7a5a', margin: '0 0 0.4rem' }}>
            {d.usesRemaining} use{d.usesRemaining === 1 ? '' : 's'} left this campaign. Each costs{' '}
            {DIVINING_CONSCIENCE_COST} conscience and {DIVINING_REST_WEEKS} weeks laid up afterwards.
            {state.flags.divining_concealed && ' The household still does not know it is deliberate.'}
          </p>
          {PURPOSES.map(({ purpose, label, asks }) => {
            const availability = diviningAvailability(state, purpose);
            const cityId = DIVINING_CITIES[purpose];
            const cityName = findCity(cityId)?.name ?? cityId;
            return (
              <div key={purpose} style={ROW}>
                <div style={{ flex: 1 }}>
                  <div>
                    {label} <span style={{ fontSize: '0.68rem', color: '#8a7a5a' }}>— at {cityName}</span>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#8a7a5a' }}>{asks}</div>
                  {availability.blockedReason && (
                    <div style={{ fontSize: '0.7rem', color: '#6a5a40' }}>{availability.blockedReason}</div>
                  )}
                </div>
                <button
                  style={SMALL_BUTTON}
                  disabled={!!availability.blockedReason}
                  onClick={() => onUse(purpose)}
                >
                  Use the rods
                </button>
              </div>
            );
          })}
        </>
      )}

      {state.lastDiviningEvent && (
        <p style={{ fontSize: '0.75rem', color: '#8a7a5a', margin: '0.5rem 0 0' }}>
          Week {state.lastDiviningEvent.week}: the rods were used at{' '}
          {findCity(state.lastDiviningEvent.cityId)?.name ?? state.lastDiviningEvent.cityId} —{' '}
          {state.lastDiviningEvent.conscienceCost} conscience spent, {state.lastDiviningEvent.restWeeks} weeks to recover.
        </p>
      )}
    </div>
  );
}
