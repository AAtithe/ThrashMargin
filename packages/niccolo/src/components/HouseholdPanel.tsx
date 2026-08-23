import { CITIES, HOME_CITY } from '../sim/content';
import { activeCharacters, assignmentSummary } from '../sim/characters';
import type { Character, CharacterAssignment, CondottaContract, Vessel } from '../sim/types';
import { UI } from '../theme';

const LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: UI.textSoft,
  margin: '0.9rem 0 0.4rem',
};

const LIST: React.CSSProperties = {
  maxHeight: '260px',
  overflowY: 'auto',
  paddingRight: '0.3rem',
};

const ROW: React.CSSProperties = {
  padding: '0.4rem 0',
  borderBottom: `1px solid ${UI.rule}`,
  fontSize: '0.8rem',
};

const FIELD: React.CSSProperties = {
  background: UI.panel,
  border: `1px solid ${UI.rule}`,
  color: UI.text,
  fontFamily: 'inherit',
  fontSize: '0.7rem',
  padding: '0.2rem 0.3rem',
  marginTop: '0.25rem',
  width: '100%',
};

function loyaltyColor(loyalty: number): string {
  if (loyalty <= 20) return UI.bad;
  if (loyalty <= 50) return UI.warn;
  return UI.good;
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

interface HouseholdPanelProps {
  characters: Character[];
  vessels: Vessel[];
  cash: number;
  conscience: number;
  condotta: CondottaContract | null;
  /** Chapter 0: an apprentice doesn't owe the household's wages yet (see `advanceWeek`'s own
   * matching gate) — showing the usual "cannot pay, loyalty will fall" warning here would be
   * flatly wrong, since no wages are actually deducted until Chapter 0 concludes. */
  wagesSuspended?: boolean;
  onAssign: (characterId: string, assignment: CharacterAssignment) => void;
}

export default function HouseholdPanel({
  characters,
  vessels,
  cash,
  conscience,
  condotta,
  wagesSuspended,
  onAssign,
}: HouseholdPanelProps) {
  const active = activeCharacters(characters);
  const departed = characters.filter(c => c.status === 'departed');
  const totalSalary = active.reduce((sum, c) => sum + c.salary, 0);
  const canPayNext = totalSalary <= cash;

  return (
    <div>
      <p style={LABEL}>Household</p>
      <p style={{ fontSize: '0.75rem', margin: 0, color: UI.textSoft }}>
        Conscience: <span style={{ color: conscience <= 40 ? UI.bad : UI.brass }}>{Math.round(conscience)}</span>
        {' · '}
        {wagesSuspended ? (
          <>Wages: not yet owed — no one draws a salary until you're formally made factor</>
        ) : (
          <>
            Wages due next week: {totalSalary}f{' '}
            <span style={{ color: canPayNext ? UI.good : UI.bad }}>
              {canPayNext ? '(covered)' : '(cannot pay — loyalty will fall)'}
            </span>
          </>
        )}
      </p>
      <p style={{ fontSize: '0.75rem', margin: '0.3rem 0 0', color: UI.textSoft }}>
        Astorre's company:{' '}
        {condotta ? (
          <span style={{ color: UI.good }}>
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
                {c.name} <span style={{ color: UI.textSoft }}>— {c.role}</span>
              </span>
              <span style={{ color: loyaltyColor(c.loyalty) }}>loyalty {Math.round(c.loyalty)}</span>
            </div>
            <div style={{ fontSize: '0.7rem', color: UI.textSoft }}>
              law {c.skills.law} · trade {c.skills.trade} · combat {c.skills.combat} · intrigue {c.skills.intrigue}
              {c.salary > 0 && ` · ${c.salary}f/wk`}
            </div>
            <div style={{ fontSize: '0.7rem', color: UI.text }}>{assignmentSummary(c, vessels)}</div>
            <select
              id={`household-assign-${c.id}`}
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
        <p style={{ fontSize: '0.7rem', color: UI.textFaint, margin: '0.4rem 0 0' }}>
          Left the company: {departed.map(c => c.name).join(', ')}.
        </p>
      )}
    </div>
  );
}
