import type { ObjectiveProgress } from '../sim/objectives';

const LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '0 0 0.4rem',
};

const ROW: React.CSSProperties = {
  padding: '0.35rem 0',
  borderBottom: '1px solid #2a2117',
  fontSize: '0.78rem',
};

function statusColor(p: ObjectiveProgress): string {
  if (p.status === 'missed') return '#b5451a';
  if (p.status === 'complete') return p.outcome === 'costly' ? '#a08040' : '#3a6b5a';
  return '#8a7a5a';
}

function statusSuffix(p: ObjectiveProgress): string {
  if (p.objective.inevitable) {
    return p.status === 'pending' ? 'will occur' : 'occurred';
  }
  if (p.status === 'missed') return 'deadline passed';
  if (p.status === 'complete') return p.outcome === 'costly' ? 'resolved — cost more than it returned' : 'resolved';
  return 'open';
}

interface ObjectivesPanelProps {
  chapterNumber: number;
  progress: ObjectiveProgress[];
}

/** Chapter objectives (Phase 14, design doc §2's "commercial objectives (soft)" line, never built
 * as a visible checklist until now) — a read-only display over flags the chapter's own event
 * content already sets. Self-hides with no progress to show (Chapter 0, which authors none, or the
 * "Hide chapter objectives" campaign toggle, which GameScreen.tsx handles by not rendering this at
 * all rather than passing an empty list — see that call site). */
export default function ObjectivesPanel({ chapterNumber, progress }: ObjectivesPanelProps) {
  if (progress.length === 0) return null;

  const counted = progress.filter(p => !p.objective.optional);
  const resolved = counted.filter(p => p.status !== 'pending').length;

  return (
    <div>
      <p style={LABEL}>Chapter {chapterNumber} objectives</p>
      {progress.map(p => (
        <div key={p.objective.id} style={ROW}>
          <div style={{ color: statusColor(p) }}>{p.objective.label}</div>
          {p.objective.description && (
            <div style={{ fontSize: '0.7rem', color: '#8a7a5a' }}>{p.objective.description}</div>
          )}
          <div style={{ fontSize: '0.7rem', color: statusColor(p) }}>
            {statusSuffix(p)}
            {p.objective.optional && <span style={{ color: '#6a5a40' }}> · optional</span>}
          </div>
        </div>
      ))}
      <p style={{ fontSize: '0.7rem', color: '#6a5a40', margin: '0.4rem 0 0' }}>
        {resolved} of {counted.length} threads resolved
      </p>
    </div>
  );
}
