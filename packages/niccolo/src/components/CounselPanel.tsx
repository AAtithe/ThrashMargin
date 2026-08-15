import { adviceFor, MAX_ADVICE_SHOWN } from '../sim/advisors';
import type { Advice, AdviceUrgency } from '../sim/advisors';
import type { GameState } from '../sim/types';

/**
 * The household's counsel (Phase 21) — read-only by design. There is deliberately no button on any
 * of these: an officer points at something, the player decides. See `sim/advisors.ts` for why.
 */

const LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '0 0 0.5rem',
};

const ROW: React.CSSProperties = {
  padding: '0.55rem 0',
  borderBottom: '1px solid #2a2117',
  fontSize: '0.82rem',
};

function urgencyColor(u: AdviceUrgency): string {
  if (u === 'urgent') return '#b5451a';
  if (u === 'notable') return '#a08040';
  return '#6a5a40';
}

function urgencyLabel(u: AdviceUrgency): string {
  if (u === 'urgent') return 'pressing';
  if (u === 'notable') return 'worth a look';
  return 'in passing';
}

export function AdviceRow({ advice }: { advice: Advice }) {
  return (
    <div style={ROW}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'baseline' }}>
        <span style={{ color: '#e8d5a3' }}>
          {advice.officerName} <span style={{ fontSize: '0.7rem', color: '#8a7a5a' }}>· {advice.officerRole}</span>
        </span>
        <span style={{ fontSize: '0.68rem', color: urgencyColor(advice.urgency), whiteSpace: 'nowrap' }}>
          {urgencyLabel(advice.urgency)}
        </span>
      </div>
      <p style={{ margin: '0.25rem 0 0', color: '#c9b88a', fontStyle: 'italic' }}>“{advice.body}”</p>
    </div>
  );
}

export default function CounselPanel({ state }: { state: GameState }) {
  // The projection returns everything it has; the cap is this panel's call. See MAX_ADVICE_SHOWN.
  const all = adviceFor(state);
  const advice = all.slice(0, MAX_ADVICE_SHOWN);
  const withheld = all.length - advice.length;

  if (advice.length === 0) {
    return (
      <div>
        <p style={LABEL}>Counsel</p>
        <p style={{ fontSize: '0.8rem', color: '#6a5a40', margin: 0, fontStyle: 'italic' }}>
          Nobody has anything pressing to say this week.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p style={LABEL}>Counsel</p>
      <p style={{ fontSize: '0.72rem', color: '#8a7a5a', margin: '0 0 0.5rem' }}>
        What the household would tell you, if asked. They see only what you see — a price they quote is
        from a report that has actually arrived, and may already be out of date.
      </p>
      {advice.map(a => (
        <AdviceRow key={a.id} advice={a} />
      ))}
      {withheld > 0 && (
        <p style={{ fontSize: '0.7rem', color: '#6a5a40', margin: '0.5rem 0 0', fontStyle: 'italic' }}>
          {withheld} lesser {withheld === 1 ? 'matter' : 'matters'} not worth the household's breath this week.
        </p>
      )}
    </div>
  );
}
