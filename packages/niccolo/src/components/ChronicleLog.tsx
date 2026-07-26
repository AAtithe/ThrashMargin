import { useState } from 'react';
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
  maxWidth: '34rem',
  width: '100%',
  maxHeight: '80vh',
  overflowY: 'auto',
  padding: '1.8rem',
  fontFamily: '"Georgia", "Times New Roman", serif',
  color: '#c9b88a',
};

const TITLE: React.CSSProperties = {
  fontSize: '1.15rem',
  letterSpacing: '0.03em',
  color: '#e8d5a3',
  margin: '0 0 1rem',
};

const CHAPTER_HEADER: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  width: '100%',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid #2a2117',
  color: '#e8d5a3',
  fontFamily: 'inherit',
  fontSize: '0.9rem',
  padding: '0.6rem 0',
  cursor: 'pointer',
  textAlign: 'left',
};

const CLOSE_BUTTON: React.CSSProperties = {
  background: '#1a1510',
  border: '1px solid #4a3d28',
  color: '#c9b88a',
  padding: '0.5rem 1rem',
  fontFamily: 'inherit',
  fontSize: '0.82rem',
  cursor: 'pointer',
  marginTop: '1.2rem',
};

export interface ChronicleChapter {
  chapterNumber: number;
  title: string;
  progress: ObjectiveProgress[];
}

interface ChronicleLogProps {
  chapters: ChronicleChapter[];
  onClose: () => void;
}

/**
 * Opt-in record of every chapter already closed (Phase 15's fast-follow to the chapter-close
 * card) — the same `objectivesForChapter` projection ObjectivesPanel and ChapterCompleteCard
 * already use, just re-read for a past chapter number instead of the live one. Purely a UI
 * re-render of existing flags: no GameState field, no write-site, nothing new for a chapter's own
 * content to author. Opened from a header button rather than forced on screen; self-hides (via
 * `chapters.length === 0`'s caller, see GameScreen.tsx) until at least one chapter has actually
 * closed, since an empty log has nothing to say yet.
 */
export default function ChronicleLog({ chapters, onClose }: ChronicleLogProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set(chapters.length ? [chapters[chapters.length - 1].chapterNumber] : []));

  const toggle = (n: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  return (
    <div style={BACKDROP}>
      <div style={CARD}>
        <h2 style={TITLE}>Chronicle</h2>
        {chapters.map(chapter => {
          const counted = chapter.progress.filter(p => !p.objective.optional);
          const resolved = counted.filter(p => p.status !== 'pending').length;
          const isOpen = expanded.has(chapter.chapterNumber);
          return (
            <div key={chapter.chapterNumber}>
              <button style={CHAPTER_HEADER} onClick={() => toggle(chapter.chapterNumber)}>
                <span>
                  {isOpen ? '▾' : '▸'} Chapter {chapter.chapterNumber} — {chapter.title}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#8a7a5a' }}>
                  {resolved} of {counted.length} resolved
                </span>
              </button>
              {isOpen && (
                <div style={{ padding: '0.4rem 0 0.6rem' }}>
                  {chapter.progress.length === 0 ? (
                    <p style={{ fontSize: '0.78rem', color: '#8a7a5a', margin: 0 }}>No objectives recorded for this chapter.</p>
                  ) : (
                    chapter.progress.map(p => <ObjectiveRow key={p.objective.id} p={p} />)
                  )}
                </div>
              )}
            </div>
          );
        })}
        <button style={CLOSE_BUTTON} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
