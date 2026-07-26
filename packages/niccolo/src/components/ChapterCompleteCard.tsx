import { ObjectiveRow } from './ObjectivesPanel';
import type { ObjectiveProgress } from '../sim/objectives';

const BACKDROP: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(8, 6, 4, 0.78)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: '2rem',
};

const CARD: React.CSSProperties = {
  background: '#17130d',
  border: '1px solid #4a3d28',
  boxShadow: '0 0 0 1px #0e0b07, 0 8px 40px rgba(0,0,0,0.6)',
  maxWidth: '32rem',
  width: '100%',
  padding: '1.8rem',
  fontFamily: '"Georgia", "Times New Roman", serif',
  color: '#c9b88a',
};

const LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '0 0 0.4rem',
};

const TITLE: React.CSSProperties = {
  fontSize: '1.3rem',
  letterSpacing: '0.05em',
  color: '#e8d5a3',
  margin: '0 0 1rem',
};

const BUTTON: React.CSSProperties = {
  background: '#1a1510',
  border: '1px solid #e8d5a3',
  color: '#e8d5a3',
  padding: '0.6rem 1.2rem',
  fontFamily: 'inherit',
  fontSize: '0.85rem',
  cursor: 'pointer',
  marginTop: '1.2rem',
};

interface ChapterCompleteCardProps {
  chapterNumber: number;
  title: string;
  progress: ObjectiveProgress[];
  onContinue: () => void;
}

/**
 * Phase 15's fix for a real, verified gap: reaching chapter1_complete/chapter2_complete/
 * chapter3_complete previously produced zero UI feedback at all, because each new chapter's own
 * opening event was wired to trigger in the exact render slot the prior chapter's full-screen
 * ending used to occupy — that ending screen just moved forward each time a new chapter shipped,
 * leaving nothing behind. This card fires once at each transition, showing what that chapter's
 * own objectives resolved to, before the next chapter's already-queued opening event renders.
 * `GameScreen.tsx` decides *when* to show this (comparing `currentChapterNumber` against the
 * persisted `lastAcknowledgedChapter`) and holds the pending event back meanwhile — this component
 * only renders the card itself. `progress` may be empty (Chapter 0 authors no objectives content),
 * in which case only the transition line shows — still worth a beat of its own, arguably more so,
 * since it's the prologue actually ending. */
export default function ChapterCompleteCard({ chapterNumber, title, progress, onContinue }: ChapterCompleteCardProps) {
  const counted = progress.filter(p => !p.objective.optional);
  const resolved = counted.filter(p => p.status !== 'pending').length;

  return (
    <div style={BACKDROP}>
      <div style={CARD}>
        <p style={LABEL}>Chapter {chapterNumber} complete</p>
        <h2 style={TITLE}>{title}</h2>
        {progress.length > 0 && (
          <>
            {progress.map(p => (
              <ObjectiveRow key={p.objective.id} p={p} />
            ))}
            <p style={{ fontSize: '0.75rem', color: '#8a7a5a', margin: '0.6rem 0 0' }}>
              {resolved} of {counted.length} threads resolved
            </p>
          </>
        )}
        <button style={BUTTON} onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}
