/**
 * Modal chrome for one menu section (Phase 17 follow-up: "redesign the menu so there are sections
 * for each part of the game... a pop up menu for each"). Every panel that used to sit permanently
 * stacked in a single long scrolling sidebar now opens here instead, one at a time — mirrors the
 * dark full-viewport backdrop + centered card convention `EventOverlay`/`TutorialOverlay` already
 * use, so a popup section reads as the same kind of surface as the game's other modals, not a new
 * one. `id="section-popup-scroll"` on the scrolling body is a stable hook `GuidedTour.tsx`'s
 * `useTargetRect` scrolls against (the same proven scrollTop-math the old sidebar used, just
 * retargeted — see that file's own comment for why `Element.scrollIntoView()` isn't used here).
 */
const BACKDROP: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(8, 6, 4, 0.72)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 60,
  padding: '2rem',
};

const CARD: React.CSSProperties = {
  width: 'min(640px, 100%)',
  maxHeight: '100%',
  display: 'flex',
  flexDirection: 'column',
  background: '#161009',
  border: '1px solid #4a3d28',
  boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
};

const HEAD: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  padding: '0.9rem 1.2rem 0.7rem',
  borderBottom: '1px solid #2a2117',
  flexShrink: 0,
};

const TITLE: React.CSSProperties = {
  fontSize: '1.05rem',
  letterSpacing: '0.04em',
  color: '#e8d5a3',
  margin: 0,
  fontWeight: 'normal',
};

const CLOSE: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#8a7a5a',
  fontSize: '1.1rem',
  lineHeight: 1,
  cursor: 'pointer',
  padding: '0.2rem',
};

const BODY: React.CSSProperties = {
  padding: '1rem 1.2rem 1.3rem',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
};

interface SectionPopupProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export default function SectionPopup({ title, onClose, children }: SectionPopupProps) {
  return (
    <div style={BACKDROP} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={CARD}>
        <div style={HEAD}>
          <h2 style={TITLE}>{title}</h2>
          <button style={CLOSE} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div id="section-popup-scroll" style={BODY}>
          {children}
        </div>
      </div>
    </div>
  );
}
