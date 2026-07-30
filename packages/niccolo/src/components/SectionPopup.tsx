/**
 * Slide-out drawer chrome for one menu section.
 *
 * Started life as a centered modal card over a dimmed full-viewport backdrop, which was the wrong
 * shape for this content: these panels are working surfaces the player reads *against* the map
 * (checking a market against where a ship is, reassigning an officer while looking at the route),
 * and a centered modal both hid the map entirely and read as an interruption. Now it slides in from
 * the left, taking a fixed column and leaving the map visible beside it, with only a very light
 * scrim so the map is dimmed but still legible.
 *
 * Two details are load-bearing and should survive future edits:
 * - `id="section-popup-scroll"` on the scrolling body is a stable hook `GuidedTour.tsx`'s
 *   `useTargetRect` scrolls against (the same scrollTop math the original sidebar used — see that
 *   file for why `Element.scrollIntoView()` isn't used here).
 * - Both layers are `absolute`, not `fixed`, so they are scoped to the map pane (`BODY` in
 *   `GameScreen.tsx` is their positioning context) and **never cover the header or the section
 *   bar**. A first cut used a viewport-wide fixed scrim, which sat on top of the bar and made every
 *   tab click silently close the drawer instead of switching section — verified with
 *   `elementFromPoint`, and the third time this codebase has been bitten by a translucent overlay
 *   quietly eating clicks. Keep them scoped here.
 */
const SCRIM: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(8, 6, 4, 0.35)',
  zIndex: 55,
};

const DRAWER: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  bottom: 0,
  width: 'min(460px, 92vw)',
  display: 'flex',
  flexDirection: 'column',
  background: '#161009',
  borderRight: '1px solid #4a3d28',
  boxShadow: '8px 0 32px rgba(0,0,0,0.55)',
  zIndex: 60,
  animation: 'niccolo-drawer-in 160ms ease-out',
};

/** Keyframes have to be real CSS, not inline style — injected once, idempotently. */
const KEYFRAMES_ID = 'niccolo-drawer-keyframes';
function ensureKeyframes() {
  if (typeof document === 'undefined' || document.getElementById(KEYFRAMES_ID)) return;
  const el = document.createElement('style');
  el.id = KEYFRAMES_ID;
  el.textContent =
    '@keyframes niccolo-drawer-in{from{transform:translateX(-100%)}to{transform:translateX(0)}}' +
    '@media (prefers-reduced-motion: reduce){[data-niccolo-drawer]{animation:none !important}}';
  document.head.appendChild(el);
}

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
  ensureKeyframes();
  return (
    <>
      <div style={SCRIM} onClick={onClose} />
      <div style={DRAWER} data-niccolo-drawer>
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
    </>
  );
}
