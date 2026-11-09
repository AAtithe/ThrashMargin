import { useEffect, useState } from 'react';

/**
 * One button that puts the whole page into the browser's fullscreen mode and back. Esc (or the
 * browser's own control) also leaves, and the button follows along through `fullscreenchange`.
 * Renders nothing where the browser offers no element fullscreen (Safari on iPhone), rather than a
 * button that does nothing. Older Safari only has the `webkit` prefixed calls, so both are tried.
 */
type WebkitDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = () => document as WebkitDocument;

export const fullscreenSupported = () =>
  typeof document !== 'undefined' && !!(document.fullscreenEnabled || doc().webkitFullscreenEnabled);

export const isFullscreen = () => !!(document.fullscreenElement || doc().webkitFullscreenElement);

export function exitFullscreen() {
  if (!isFullscreen()) return;
  const d = doc();
  try {
    const r = document.exitFullscreen ? document.exitFullscreen() : d.webkitExitFullscreen?.();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch {
    /* already left */
  }
}

function enterFullscreen() {
  const el = document.documentElement as WebkitElement;
  try {
    const r = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch {
    /* refused by the browser (no user gesture, or a policy): the page simply stays as it is */
  }
}

export default function FullscreenToggle({ style }: { style?: React.CSSProperties }) {
  const [on, setOn] = useState(isFullscreen);
  useEffect(() => {
    const sync = () => setOn(isFullscreen());
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);
  if (!fullscreenSupported()) return null;
  return (
    <button
      type="button"
      onClick={() => (on ? exitFullscreen() : enterFullscreen())}
      title={on ? 'Leave fullscreen (Esc)' : 'Fill the whole screen'}
      aria-label={on ? 'Leave fullscreen' : 'Go fullscreen'}
      aria-pressed={on}
      data-testid="fullscreen"
      style={{
        background: 'transparent',
        border: '1px solid var(--portal-btn-rule)',
        color: 'var(--portal-link)',
        borderRadius: 4,
        padding: '0.15rem 0.5rem',
        fontSize: '0.72rem',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {on ? 'Exit fullscreen' : 'Fullscreen'}
    </button>
  );
}
