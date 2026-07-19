import { CITIES, HOME_CITY, findCity } from '../sim/content';
import type { Character, CharacterAssignment, CondottaContract, Vessel } from '../sim/types';

const LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '0.9rem 0 0.4rem',
};

const LIST: React.CSSProperties = {
  maxHeight: '260px',
  overflowY: 'auto',
  paddingRight: '0.3rem',
};

const ROW: React.CSSProperties = {
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

function loyaltyColor(loyalty: number): string {
  if (loyalty <= 20) return '#b5451a';
  if (loyalty <= 50) return '#a08040';
  return '#3a6b5a';
}

function assignmentKey(assignment: CharacterAssignment): string {
  switch (assignment.type) {
    case 'aboard':
      return `aboard:${assignment.vesselId}`;
    case 'negotiate':
      return `negotiate:${assignment.cityId}`;
    case 'investigate':
      return `investigate:${assignment.cityId}`;
    default:
      return 'idle';
  }
}

function parseAssignmentKey(key: string): CharacterAssignment {
  const [type, target] = key.split(':');
  if (type === 'aboard') return { type: 'aboard', vesselId: target };
  if (type === 'negotiate') return { type: 'negotiate', cityId: target };
  if (type === 'investigate') return { type: 'investigate', cityId: target };
  return { type: 'idle' };
}

function assignmentSummary(assignment: CharacterAssignment, vessels: Vessel[]): string {
  switch (assignment.type) {
    case 'aboard':
      return `Aboard ${vessels.find(v => v.id === assignment.vesselId)?.name ?? assignment.vesselId}`;
    case 'negotiate':
      return `Negotiating at ${findCity(assignment.cityId)?.name ?? assignment.cityId}`;
    case 'investigate':
      return `Investigating at ${findCity(assignment.cityId)?.name ?? assignment.cityId}`;
    default:
      return 'Idle, at Bruges';
  }
}

interface HouseholdPanelProps {
  characters: Character[];
  vessels: Vessel[];
  cash: number;
  conscience: number;
  condotta: CondottaContract | null;
  onAssign: (characterId: string, assignment: CharacterAssignment) => void;
}

export default function HouseholdPanel({ characters, vessels, cash, conscience, condotta, onAssign }: HouseholdPanelProps) {
  const active = characters.filter(c => c.status === 'active');
  const departed = characters.filter(c => c.status === 'departed');
  const totalSalary = active.reduce((sum, c) => sum + c.salary, 0);
  const canPayNext = totalSalary <= cash;

  return (
    <div>
      <p style={LABEL}>Household</p>
      <p style={{ fontSize: '0.75rem', margin: 0, color: '#8a7a5a' }}>
        Conscience: <span style={{ color: conscience <= 40 ? '#b5451a' : '#e8d5a3' }}>{Math.round(conscience)}</span>
        {' · '}
        Wages due next week: {totalSalary}f{' '}
        <span style={{ color: canPayNext ? '#3a6b5a' : '#b5451a' }}>{canPayNext ? '(covered)' : '(cannot pay — loyalty will fall)'}</span>
      </p>
      <p style={{ fontSize: '0.75rem', margin: '0.3rem 0 0', color: '#8a7a5a' }}>
        Astorre's company:{' '}
        {condotta ? (
          <span style={{ color: '#3a6b5a' }}>
            on campaign at Naples, {condotta.weeksRemaining} week{condotta.weeksRemaining === 1 ? '' : 's'} left ·{' '}
            {condotta.retainerPerWeek}f/wk retainer
          </span>
        ) : (
          'no active contract'
        )}
      </p>

      <div style={LIST}>
        {active.map(c => (
          <div key={c.id} style={ROW}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>
                {c.name} <span style={{ color: '#8a7a5a' }}>— {c.role}</span>
              </span>
              <span style={{ color: loyaltyColor(c.loyalty) }}>loyalty {Math.round(c.loyalty)}</span>
            </div>
            <div style={{ fontSize: '0.7rem', color: '#8a7a5a' }}>
              law {c.skills.law} · trade {c.skills.trade} · combat {c.skills.combat} · intrigue {c.skills.intrigue}
              {c.salary > 0 && ` · ${c.salary}f/wk`}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#c9b88a' }}>{assignmentSummary(c.assignment, vessels)}</div>
            <select
              style={FIELD}
              value={assignmentKey(c.assignment)}
              onChange={e => onAssign(c.id, parseAssignmentKey(e.target.value))}
            >
              <option value="idle">Idle, at Bruges</option>
              {vessels.map(v => (
                <option key={`aboard:${v.id}`} value={`aboard:${v.id}`}>
                  Aboard {v.name}
                </option>
              ))}
              {CITIES.map(city => (
                <option key={`negotiate:${city.id}`} value={`negotiate:${city.id}`}>
                  Negotiate at {city.name}
                </option>
              ))}
              {CITIES.filter(city => city.id !== HOME_CITY).map(city => (
                <option key={`investigate:${city.id}`} value={`investigate:${city.id}`}>
                  Investigate at {city.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {departed.length > 0 && (
        <p style={{ fontSize: '0.7rem', color: '#6a5a40', margin: '0.4rem 0 0' }}>
          Left the company: {departed.map(c => c.name).join(', ')}.
        </p>
      )}
    </div>
  );
}
