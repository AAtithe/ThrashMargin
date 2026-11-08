// GENERATED from shared/portal/client/Loading.tsx by scripts/sync-shared.mjs. Do not edit this copy: edit the original,
// then run `npm run sync-shared`. `npm run check` fails while any copy differs.
import { useEffect, useState, type ReactNode } from 'react';

/**
 * The portal's loading states, shared by all five games (copied into each game's lib/ by
 * scripts/sync-shared.mjs). The standard they implement is in loading-animations-plan.md:
 *
 * - Nothing appears for the first 300ms. Most loads finish inside that, and a spinner that flashes
 *   for a tenth of a second makes the app feel slower than no spinner. The delay is pure CSS
 *   (animation-delay), so no timer drives it; the only state is the handover record below.
 * - After 8 seconds the loader says the load is slow and offers the caller's `actions`, so a
 *   request that hangs is never a dead end. Also pure CSS: the actions are in the page from the
 *   start, hidden (visibility, so not focusable either) until the reveal.
 * - No minimum display time: a loaded game is never held back so an animation can finish.
 * - An error shows at once, looks different from loading, and offers whatever actions the caller
 *   passes (Retry and Back to the lobby, in each game's own Button).
 * - A loader that replaces another one (Banco di Niccolò: the code chunk, then the save) shows at
 *   once, with no second delay, so the two stages read as one load instead of a blink between them.
 * - prefers-reduced-motion stops every movement; the loader still appears, standing still.
 * - Colours are the game's own tokens (--ui-…), falling back to the portal's (--portal-…), so it
 *   follows light and dark mode with no colour of its own.
 *
 * The keyframes travel in a <style> element the component renders. The CSP allows inline styles
 * and forbids inline scripts; this needs no script.
 */

/**
 * What a game screen says when its load was refused because the sign-in has expired. The hooks'
 * own message points at "Sign out" in the nav bar, which several game screens do not show; this one
 * goes with a "Sign in again" button instead of a Try again that could never succeed.
 */
export const SIGN_IN_AGAIN = 'Your sign-in has expired. Sign in again to open this game.';

export type LoadingMotif = 'territories' | 'ledger' | 'coins' | 'lorry' | 'clipper';

const TEXT = 'var(--ui-text, var(--portal-text))';
const SOFT = 'var(--ui-text-soft, var(--portal-soft))';
const FAINT = 'var(--ui-text-faint, var(--portal-faint))';
const RULE = 'var(--ui-rule, var(--portal-rule))';
const RAISED = 'var(--ui-panel-raised, var(--portal-raised))';
const BAD = 'var(--ui-bad, var(--portal-bad))';

/** How long a load runs before the loader admits it is slow and offers a way out. */
const SLOW_MS = 8000;

const CSS = `
@keyframes wsl-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes wsl-bob { 0%,100% { transform: translateY(0) rotate(-3deg) } 50% { transform: translateY(-3px) rotate(3deg) } }
@keyframes wsl-swell { from { transform: translateX(0) } to { transform: translateX(-16px) } }
@keyframes wsl-road { from { transform: translateX(0) } to { transform: translateX(-14px) } }
@keyframes wsl-spin { to { transform: rotate(360deg) } }
@keyframes wsl-judder { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-1px) } }
@keyframes wsl-page { 0% { transform: scaleX(1) } 45%,55% { transform: scaleX(0) } 100% { transform: scaleX(-1) } }
@keyframes wsl-drop { 0% { transform: translateY(-26px); opacity: 0 } 15% { opacity: 1 } 55%,100% { transform: translateY(0); opacity: 1 } }
@keyframes wsl-node { 0%,100% { opacity: .35 } 20%,40% { opacity: 1 } }
@keyframes wsl-run { from { stroke-dashoffset: 0 } to { stroke-dashoffset: -20 } }
@keyframes wsl-reveal { from { visibility: hidden; opacity: 0 } to { visibility: visible; opacity: 1 } }
@keyframes wsl-shimmer { 0%,100% { opacity: .55 } 50% { opacity: 1 } }

.wsl-wait { animation: wsl-in 180ms ease-out 300ms both }
.wsl-loader svg * { transform-box: fill-box; transform-origin: center }
.wsl-ship { animation: wsl-bob 2.4s ease-in-out infinite }
.wsl-swell { animation: wsl-swell 1.6s linear infinite }
.wsl-road { animation: wsl-road .5s linear infinite }
.wsl-wheel { animation: wsl-spin .5s linear infinite }
.wsl-lorry { animation: wsl-judder .25s steps(2) infinite }
.wsl-page { transform-origin: left center !important; animation: wsl-page 1.6s ease-in-out infinite }
.wsl-coin { animation: wsl-drop 1.4s cubic-bezier(.5,0,.7,1) infinite }
.wsl-node { animation: wsl-node 1.5s ease-in-out infinite }
.wsl-run { stroke-dasharray: 4 6; animation: wsl-run .8s linear infinite }
.wsl-slow { animation: wsl-reveal 200ms ease-out ${SLOW_MS}ms both }
.wsl-bone { animation: wsl-shimmer 1.4s ease-in-out infinite }
.wsl-busy { display: inline-block; width: .8em; height: .8em; border-radius: 50%;
  border: 2px solid currentColor; border-right-color: transparent; vertical-align: -.1em;
  margin-right: .45em; animation: wsl-spin .7s linear infinite }

@media (prefers-reduced-motion: reduce) {
  .wsl-loader svg *, .wsl-bone, .wsl-busy { animation: none !important }
  /* Each game's styles.css sets animation: none on everything here; a class outranks *, so the
     300ms delay survives and a fast load still shows nothing. */
  .wsl-wait { animation: wsl-in 1ms linear 300ms both !important }
  .wsl-slow { animation: wsl-reveal 1ms linear ${SLOW_MS}ms both !important }
}
`;

/** The keyframes. Rendered by every component here; duplicate <style> elements are harmless. */
function LoadingStyles() {
  return <style>{CSS}</style>;
}

function Motif({ motif, accent }: { motif: LoadingMotif; accent: string }) {
  const common = { width: 72, height: 72, viewBox: '0 0 64 64', 'aria-hidden': true, focusable: false } as const;
  switch (motif) {
    case 'clipper':
      return (
        <svg {...common}>
          <g className="wsl-ship">
            <path d="M14 40 h36 l-6 8 h-24 z" fill={accent} />
            <path d="M31 12 v28" stroke={TEXT} strokeWidth="1.5" />
            <path d="M31 14 c8 4 10 12 9 22 h-9 z" fill={SOFT} opacity=".8" />
            <path d="M31 16 c-6 4 -8 11 -8 20 h8 z" fill={FAINT} />
          </g>
          <g className="wsl-swell">
            <path d="M0 52 q4 -3 8 0 t8 0 t8 0 t8 0 t8 0 t8 0 t8 0 t8 0 t8 0" stroke={SOFT} strokeWidth="2" fill="none" />
          </g>
        </svg>
      );
    case 'lorry':
      return (
        <svg {...common}>
          <g className="wsl-lorry">
            <rect x="8" y="22" width="30" height="18" rx="1.5" fill={accent} />
            <path d="M38 28 h10 l6 7 v5 h-16 z" fill={SOFT} />
            <path d="M41 30 h6 l3.5 4 h-9.5 z" fill={RAISED} />
          </g>
          <g className="wsl-wheel"><circle cx="16" cy="42" r="4" fill={TEXT} /><path d="M16 39 v6" stroke={RAISED} strokeWidth="1.5" /></g>
          <g className="wsl-wheel"><circle cx="46" cy="42" r="4" fill={TEXT} /><path d="M46 39 v6" stroke={RAISED} strokeWidth="1.5" /></g>
          <g className="wsl-road">
            <path d="M0 52 h78" stroke={FAINT} strokeWidth="2" strokeDasharray="8 6" />
          </g>
        </svg>
      );
    case 'ledger':
      return (
        <svg {...common}>
          <path d="M8 18 q12 -4 24 2 v30 q-12 -6 -24 -2 z" fill={RAISED} stroke={RULE} />
          <path d="M56 18 q-12 -4 -24 2 v30 q12 -6 24 -2 z" fill={RAISED} stroke={RULE} />
          <path d="M13 25 h14 M13 30 h14 M13 35 h10 M37 25 h14 M37 30 h14 M37 35 h10" stroke={FAINT} strokeWidth="1.2" />
          <path className="wsl-page" d="M32 20 q12 -6 22 -2 v30 q-10 -4 -22 2 z" fill={accent} opacity=".85" />
          <path d="M32 20 v30" stroke={TEXT} strokeWidth="1.2" />
        </svg>
      );
    case 'coins':
      return (
        <svg {...common}>
          {[48, 43, 38].map(y => (
            <g key={y}>
              <rect x="18" y={y} width="28" height="5" rx="2.5" fill={accent} />
              <path d={`M20 ${y + 2.5} h24`} stroke={RAISED} strokeWidth=".8" opacity=".7" />
            </g>
          ))}
          <g className="wsl-coin">
            <rect x="18" y="33" width="28" height="5" rx="2.5" fill={accent} stroke={TEXT} strokeWidth=".6" />
          </g>
        </svg>
      );
    case 'territories':
      return (
        <svg {...common}>
          <path d="M12 44 L32 18 L52 44 Z" stroke={RULE} strokeWidth="2" fill="none" />
          <path className="wsl-run" d="M12 44 L32 18 L52 44 Z" stroke={accent} strokeWidth="2" fill="none" />
          {[[12, 44, 0], [32, 18, 0.5], [52, 44, 1]].map(([x, y, d]) => (
            <circle key={x} className="wsl-node" cx={x} cy={y} r="6" fill={accent} style={{ animationDelay: `${d}s` }} />
          ))}
        </svg>
      );
  }
}

/**
 * Handover between two loaders. A new loader skips its delay if the player can already see one:
 * either one is still mounted and past its delay, or one went away within HANDOVER_MS. Both are
 * needed, because React renders the new loader before it runs the old one's cleanup, so a
 * "gone at" time alone is read too early to help. Only a visible loader counts: if the first stage
 * finished inside its own 300ms the player saw nothing, and the second must wait its 300ms too or
 * it would flash.
 */
type Live = { since: number; instant: boolean };
const live = new Set<Live>();
let loaderGoneAt = -Infinity;
const HANDOVER_MS = 600;
const DELAY_MS = 300;
const isVisible = (l: Live, now: number) => l.instant || now - l.since >= DELAY_MS;

/**
 * The game screen while its save is fetched, or after the fetch failed. While loading it fades in
 * after 300ms, and after 8 seconds offers the caller's `actions` under a "slower than usual" line.
 * With `error` set it shows at once, with a warning glyph and the same `actions` (normally Try
 * again and Back to the lobby).
 */
export function LoadingScreen({
  motif,
  caption,
  error,
  actions,
  accent = 'var(--ui-brass, var(--ui-accent, var(--portal-action)))',
  fullPage = true,
}: {
  motif: LoadingMotif;
  caption: string;
  error?: string | null;
  actions?: ReactNode;
  accent?: string;
  /** False when the caller keeps its own header and footer around it: then it fills the space between. */
  fullPage?: boolean;
}) {
  // Decided once, on mount, so a re-render part-way through the delay cannot cut it short.
  const [self] = useState<Live>(() => {
    const now = Date.now();
    const instant = now - loaderGoneAt < HANDOVER_MS || [...live].some(l => isVisible(l, now));
    return { since: now, instant };
  });
  useEffect(() => {
    live.add(self);
    return () => {
      live.delete(self);
      if (isVisible(self, Date.now())) loaderGoneAt = Date.now();
    };
  }, [self]);
  const handover = self.instant;
  const box = {
    ...(fullPage ? { minHeight: '100vh' } : { flex: 1 }),
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
    textAlign: 'center' as const,
    background: 'var(--ui-ground, var(--portal-ground))',
  };
  if (error) {
    return (
      <div role="alert" data-testid="loading-error" style={box}>
        <LoadingStyles />
        <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden focusable={false}>
          <circle cx="22" cy="22" r="19" fill="none" stroke={BAD} strokeWidth="2.5" />
          <path d="M22 12 v13" stroke={BAD} strokeWidth="3" strokeLinecap="round" />
          <circle cx="22" cy="31" r="2" fill={BAD} />
        </svg>
        <p style={{ margin: 0, color: TEXT, fontSize: '0.95rem', lineHeight: 1.5, maxWidth: '42ch' }}>{error}</p>
        {actions && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>{actions}</div>}
      </div>
    );
  }
  return (
    <div role="status" aria-live="polite" aria-busy="true" data-testid="loading-screen" style={box}>
      <LoadingStyles />
      <div className={handover ? 'wsl-loader' : 'wsl-loader wsl-wait'} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <Motif motif={motif} accent={accent} />
        <p style={{ margin: 0, color: SOFT, fontSize: '0.95rem', letterSpacing: '0.01em', maxWidth: '42ch', lineHeight: 1.5 }}>{caption}</p>
      </div>
      {actions && (
        <div className="wsl-slow" data-testid="loading-slow" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginTop: 6 }}>
          <p style={{ margin: 0, color: FAINT, fontSize: '0.85rem', maxWidth: '42ch', lineHeight: 1.5 }}>
            This is taking longer than usual. The connection may be slow; you can try again.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>{actions}</div>
        </div>
      )}
    </div>
  );
}

/**
 * Placeholder rows for a saves list that has not answered yet, so an empty list is never mistaken
 * for "you have no games". Same 300ms delay as the loader.
 */
export function LoadingRows({ rows = 3, label = 'Loading your saved games' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" aria-label={label} data-testid="loading-rows" className="wsl-wait" style={{ display: 'grid', gap: 8 }}>
      <LoadingStyles />
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="wsl-bone"
          style={{ height: 44, borderRadius: 6, background: RAISED, border: `1px solid ${RULE}`, animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

/** A button's label while its request is in flight: a small turning ring before the text. */
export function BusyLabel({ children }: { children: ReactNode }) {
  return (
    <span aria-live="polite">
      <LoadingStyles />
      <span className="wsl-busy" aria-hidden />
      {children}
    </span>
  );
}
