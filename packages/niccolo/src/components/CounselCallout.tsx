import { AdviceRow } from './CounselPanel';
import type { Advice } from '../sim/advisors';

/**
 * The "popping up" half of the counsel feature (Phase 21): when an officer has something genuinely
 * pressing, they say it unprompted rather than waiting for the player to open a panel.
 *
 * Deliberately **not** a modal and deliberately **not** a backdrop. This codebase has twice shipped
 * a bug where a full-viewport translucent backdrop (`EventOverlay`, `ChapterCompleteCard`) sat over
 * controls that still looked clickable and silently swallowed the clicks — see PROGRESS.md's Phase 15
 * and Phase 18 entries. Counsel is advice, not a decision, so it has no business blocking the map or
 * the header: it is a small corner card that can be read and dismissed while play continues.
 *
 * Only ever one at a time, only ever `urgent`, and dismissal is recorded per week in `GameState` so
 * a reload doesn't re-interrupt with counsel already read.
 */

const CARD: React.CSSProperties = {
  position: 'fixed',
  right: '1.1rem',
  bottom: '2.6rem',
  zIndex: 60,
  width: 'min(22rem, calc(100vw - 2.2rem))',
  background: '#161009',
  border: '1px solid #4a3d28',
  borderLeft: '3px solid #b5451a',
  padding: '0.7rem 0.9rem',
  boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
  fontFamily: '"Georgia", "Times New Roman", serif',
};

const HEAD: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: '0.5rem',
  marginBottom: '0.2rem',
};

const TITLE: React.CSSProperties = {
  fontSize: '0.68rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
};

const DISMISS: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#8a7a5a',
  fontFamily: 'inherit',
  fontSize: '0.85rem',
  cursor: 'pointer',
  padding: 0,
  lineHeight: 1,
};

interface CounselCalloutProps {
  advice: Advice;
  onDismiss: () => void;
  onOpenCounsel: () => void;
}

export default function CounselCallout({ advice, onDismiss, onOpenCounsel }: CounselCalloutProps) {
  return (
    <div style={CARD} id="counsel-callout">
      <div style={HEAD}>
        <span style={TITLE}>A word from the household</span>
        <button style={DISMISS} onClick={onDismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
      <AdviceRow advice={advice} />
      <button
        id="counsel-callout-open"
        style={{
          background: '#1a1510',
          border: '1px solid #4a3d28',
          color: '#c9b88a',
          fontFamily: 'inherit',
          fontSize: '0.7rem',
          padding: '0.2rem 0.5rem',
          marginTop: '0.5rem',
          cursor: 'pointer',
        }}
        onClick={onOpenCounsel}
      >
        Hear the rest
      </button>
    </div>
  );
}
