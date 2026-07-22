import { useEffect, useState } from 'react';
import type { GameState } from '../sim/types';

const GOLD = '#e8d5a3';
const INK = '#4a3d28';

const CARD: React.CSSProperties = {
  position: 'fixed',
  zIndex: 102,
  width: '20rem',
  background: '#17130d',
  border: `1px solid ${INK}`,
  boxShadow: '0 0 0 1px #0e0b07, 0 8px 40px rgba(0,0,0,0.6)',
  padding: '1.1rem',
  fontFamily: '"Georgia", "Times New Roman", serif',
  color: '#c9b88a',
  transition: 'top 0.2s ease, left 0.2s ease',
};

const STEP_LABEL: React.CSSProperties = {
  fontSize: '0.65rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '0 0 0.4rem',
};

const TITLE: React.CSSProperties = {
  fontSize: '1.05rem',
  letterSpacing: '0.03em',
  color: GOLD,
  margin: '0 0 0.6rem',
};

const BODY: React.CSSProperties = {
  fontSize: '0.85rem',
  lineHeight: 1.55,
  margin: '0 0 0.9rem',
};

const FOOTER: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
};

const BUTTON: React.CSSProperties = {
  background: '#1a1510',
  border: `1px solid ${INK}`,
  color: '#c9b88a',
  padding: '0.4rem 0.7rem',
  fontFamily: 'inherit',
  fontSize: '0.75rem',
  cursor: 'pointer',
};

const PRIMARY_BUTTON: React.CSSProperties = { ...BUTTON, borderColor: GOLD, color: GOLD };
const GHOST_BUTTON: React.CSSProperties = { ...BUTTON, border: 'none', color: '#6a5a40', padding: '0.4rem 0.2rem' };

/** Fixed vessel id `createInitialState` always assigns the player's ship — stable enough for a
 * tour scoped to the very first moves of a fresh campaign (see the eligibility gate this
 * component's caller applies before ever rendering it). */
const SHIP_ID = 'ship_1';
const FIRST_HOP_CITY = 'ghent';
const FIRST_HOP_GOOD = 'wool';

interface TourStep {
  title: string;
  body: string;
  /** DOM id of the real UI element to spotlight; null for the intro/outro cards, which have no
   * single target and instead show a manual button. */
  targetId: string | null;
  isComplete: (state: GameState, selectedVesselId: string | null) => boolean;
}

const STEPS: TourStep[] = [
  {
    title: "Let's make your first move",
    body: "I'll point at what to click, one step at a time — the campaign itself keeps running, so anything you do here is real. Skip anytime.",
    targetId: null,
    isComplete: () => false,
  },
  {
    title: 'Select your ship',
    body: 'Click "The Charetty ship" in the Vessels list.',
    targetId: `vessel-button-${SHIP_ID}`,
    isComplete: (_state, selectedVesselId) => selectedVesselId === SHIP_ID,
  },
  {
    title: 'Buy some wool',
    body: 'Bruges sells wool cheap. Click Buy to load a unit aboard.',
    targetId: `market-buy-${FIRST_HOP_GOOD}`,
    isComplete: state => (state.vessels.find(v => v.id === SHIP_ID)?.cargo[FIRST_HOP_GOOD] ?? 0) > 0,
  },
  {
    title: 'Send the ship to Ghent',
    body: "Ghent is a day's ride from Bruges — click its marker on the map.",
    targetId: `city-node-${FIRST_HOP_CITY}`,
    isComplete: state => state.vessels.find(v => v.id === SHIP_ID)?.destination === FIRST_HOP_CITY,
  },
  {
    title: 'Advance the clock',
    body: 'Click "Advance one week" to let the ship travel.',
    targetId: 'advance-week-button',
    isComplete: state => state.week >= 1,
  },
  {
    title: "That's the loop",
    body: 'Buy low, carry it somewhere it sells dear, mind the clock and the ledger. From here, the house is yours to run.',
    targetId: null,
    isComplete: () => false,
  },
];

function firstIncompleteStep(state: GameState, selectedVesselId: string | null): number {
  let i = 0;
  while (i < STEPS.length && STEPS[i].isComplete(state, selectedVesselId)) i++;
  return Math.min(i, STEPS.length - 1);
}

function useTargetRect(targetId: string | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!targetId) {
      setRect(null);
      return;
    }
    // The sidebar (id="game-sidebar" in GameScreen.tsx) scrolls internally, and a step's target
    // (e.g. the Advance-week button, well below the fold once enough panels are showing) may not
    // be visible yet. Scroll it into view once per step — computed directly against the sidebar's
    // own scrollTop rather than delegated to `Element.scrollIntoView`, whose browser-implemented
    // scroll distance proved unreliable here (observed nudging the container a few pixels instead
    // of the ~1000px actually needed). Checked on every poll tick rather than only when the step
    // starts, since right after a dispatched action the sidebar's layout (panels appearing or
    // disappearing) can still be settling at that exact instant. `scrolledOnce` stops it from
    // re-yanking the sidebar if the player deliberately scrolls elsewhere afterward.
    let scrolledOnce = false;
    const measure = () => {
      const el = document.getElementById(targetId);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect(r);
      if (!scrolledOnce && (r.top < 0 || r.bottom > window.innerHeight)) {
        const sidebar = document.getElementById('game-sidebar');
        if (sidebar) {
          const sidebarRect = sidebar.getBoundingClientRect();
          const target = sidebar.scrollTop + (r.top - sidebarRect.top) - sidebarRect.height / 2 + r.height / 2;
          sidebar.scrollTop = Math.max(0, target);
        }
        scrolledOnce = true;
      }
    };
    measure();
    // Re-measure on a short interval — the sidebar scrolls and panels show/hide as the player
    // acts, and a plain resize listener wouldn't catch either of those.
    const interval = setInterval(measure, 250);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', measure);
    };
  }, [targetId]);

  return rect;
}

interface GuidedTourProps {
  state: GameState;
  selectedVesselId: string | null;
  onFinish: () => void;
}

export default function GuidedTour({ state, selectedVesselId, onFinish }: GuidedTourProps) {
  const [stepIndex, setStepIndex] = useState(() => firstIncompleteStep(state, selectedVesselId));
  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const isManual = step.targetId === null;
  const rect = useTargetRect(step.targetId);

  // Auto-advance once the player actually performs the real action a step asks for.
  useEffect(() => {
    if (isManual) return;
    if (!step.isComplete(state, selectedVesselId)) return;
    const t = setTimeout(() => setStepIndex(i => Math.min(i + 1, STEPS.length - 1)), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, selectedVesselId, stepIndex]);

  const PADDING = 8;
  const spotlight: React.CSSProperties | null = rect
    ? {
        position: 'fixed',
        zIndex: 101,
        left: rect.left - PADDING,
        top: rect.top - PADDING,
        width: rect.width + PADDING * 2,
        height: rect.height + PADDING * 2,
        borderRadius: 6,
        border: `2px solid ${GOLD}`,
        boxShadow: '0 0 0 9999px rgba(8, 6, 4, 0.78)',
        pointerEvents: 'none',
        transition: 'all 0.2s ease',
      }
    : null;

  // Estimated card height — real height varies slightly with body copy length, but this only
  // needs to be close enough to decide which side of the target has room, not pixel-exact.
  const CARD_HEIGHT_ESTIMATE = 170;
  const cardStyle: React.CSSProperties = rect
    ? {
        ...CARD,
        // Prefer below the target; if there isn't room, place it above instead of clamping into
        // an overlap with the very element it's pointing at.
        top:
          rect.bottom + 16 + CARD_HEIGHT_ESTIMATE <= window.innerHeight
            ? rect.bottom + 16
            : Math.max(16, rect.top - CARD_HEIGHT_ESTIMATE - 16),
        left: Math.max(16, Math.min(rect.left, window.innerWidth - 16 - 320)),
      }
    : {
        ...CARD,
        top: window.innerHeight / 2 - 100,
        left: window.innerWidth / 2 - 160,
      };

  return (
    <>
      {!rect && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 101,
            background: 'rgba(8, 6, 4, 0.6)',
          }}
        />
      )}
      {spotlight && <div style={spotlight} />}
      <div style={cardStyle}>
        <p style={STEP_LABEL}>
          Guided walkthrough — {stepIndex + 1} of {STEPS.length}
        </p>
        <h3 style={TITLE}>{step.title}</h3>
        <p style={BODY}>{step.body}</p>
        <div style={FOOTER}>
          <button style={GHOST_BUTTON} onClick={onFinish}>
            Skip tour
          </button>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {stepIndex > 0 && (
              <button style={BUTTON} onClick={() => setStepIndex(i => Math.max(0, i - 1))}>
                Back
              </button>
            )}
            {isManual && (
              <button
                style={PRIMARY_BUTTON}
                onClick={() => (isLast ? onFinish() : setStepIndex(i => i + 1))}
              >
                {isLast ? 'Finish' : 'Start'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
