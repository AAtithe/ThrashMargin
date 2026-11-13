import { adviceFor, MAX_ADVICE_SHOWN } from '../sim/advisors';
import type { Advice, AdviceUrgency } from '../sim/advisors';
import type { GameState } from '../sim/types';
import { UI } from '../theme';
import { useWeekStagger } from './motionKit';

/**
 * The household's counsel (Phase 21) — read-only by design. There is deliberately no button on any
 * of these: an officer points at something, the player decides. See `sim/advisors.ts` for why.
 */

// No heading of its own: GameScreen frames this in a Panel titled "Counsel", and a second label
// directly under that title read as a stutter.

const ROW: React.CSSProperties = {
  padding: '0.55rem 0',
  borderBottom: `1px solid ${UI.rule}`,
  fontSize: '0.82rem',
};

function urgencyColor(u: AdviceUrgency): string {
  if (u === 'urgent') return UI.bad;
  if (u === 'notable') return UI.warn;
  return UI.textFaint;
}

function urgencyLabel(u: AdviceUrgency): string {
  if (u === 'urgent') return 'pressing';
  if (u === 'notable') return 'worth a look';
  return 'in passing';
}

export function AdviceRow({ advice, className, style }: { advice: Advice; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={className} style={{ ...ROW, ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'baseline' }}>
        <span style={{ color: UI.brass }}>
          {advice.officerName} <span style={{ fontSize: '0.7rem', color: UI.textSoft }}>· {advice.officerRole}</span>
        </span>
        <span style={{ fontSize: '0.68rem', color: urgencyColor(advice.urgency), whiteSpace: 'nowrap' }}>
          {urgencyLabel(advice.urgency)}
        </span>
      </div>
      <p style={{ margin: '0.25rem 0 0', color: UI.text, fontStyle: 'italic' }}>“{advice.body}”</p>
    </div>
  );
}

export default function CounselPanel({ state }: { state: GameState }) {
  // The projection returns everything it has; the cap is this panel's call. See MAX_ADVICE_SHOWN.
  const all = adviceFor(state);
  const advice = all.slice(0, MAX_ADVICE_SHOWN);
  const withheld = all.length - advice.length;
  // A new week's counsel is offered one voice at a time. Hooks above the early return.
  const reveal = useWeekStagger(state.week, advice.length, 220);

  if (advice.length === 0) {
    return (
      <div>
        <p style={{ fontSize: '0.8rem', color: UI.textFaint, margin: 0, fontStyle: 'italic' }}>
          Nobody has anything pressing to say this week.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: '0.72rem', color: UI.textSoft, margin: '0 0 0.5rem' }}>
        What the household would tell you, if asked. They see only what you see — a price they quote is
        from a report that has actually arrived, and may already be out of date.
      </p>
      {advice.map((a, i) => (
        <AdviceRow key={a.id} advice={a} {...reveal(i)} />
      ))}
      {withheld > 0 && (
        <p style={{ fontSize: '0.7rem', color: UI.textFaint, margin: '0.5rem 0 0', fontStyle: 'italic' }}>
          {withheld} lesser {withheld === 1 ? 'matter' : 'matters'} not worth the household's breath this week.
        </p>
      )}
    </div>
  );
}
