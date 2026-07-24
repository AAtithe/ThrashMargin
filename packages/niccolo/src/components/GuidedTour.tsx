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

/**
 * Fixed vessel id `createInitialState` always assigns the player's ship — stable enough for a
 * tour scoped to the very first moves of a fresh campaign (see the eligibility gate this
 * component's caller applies before ever rendering it).
 *
 * The destination/good pair below must actually be a *sellable, profitable* one-hop trade from
 * Bruges — content/cities/chapter1.json's own market data is the source of truth, not assumption:
 * Ghent (an earlier version's target) trades cloth and madder but never wool, so a player
 * following that script correctly could not sell what they'd bought. Antwerp/cloth is a real,
 * profitable pair confirmed against that file (cloth: 24f at Bruges, 30f at Antwerp) — if either
 * city's market ever changes, re-check this pairing still clears a profit before reusing it.
 */
const SHIP_ID = 'ship_1';
const FIRST_HOP_CITY = 'antwerp';
const FIRST_HOP_GOOD = 'cloth';
/** Julius is active in every campaign regardless of the Chapter 0 path (he's one of the "3
 * friendships" characters even in the prologue), so he's a safe, always-present officer to
 * demonstrate an assignment on. */
const DEMO_CHARACTER_ID = 'julius';
/** Ghent/Antwerp/Calais all sit at Bruges' 1-week base latency floor already — courier investment
 * can never improve on that, so their own "Invest" control is permanently stuck on "Fastest" and
 * can't demonstrate the mechanic. London (base latency 2 weeks) is the nearest city investment
 * actually does something to, at the same base 15f first-level cost. */
const DEMO_INVEST_CITY = 'london';

interface TourStep {
  title: string;
  body: string;
  /** DOM id of the real UI element to spotlight; null for the intro/outro cards, which have no
   * single target and instead show a manual button. */
  targetId: string | null;
  isComplete: (state: GameState, selectedVesselId: string | null, previewCityId: string | null) => boolean;
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
    title: 'Buy some cloth',
    body: 'Bruges weaves fine cloth. Click Buy to load a bale aboard.',
    targetId: `market-buy-${FIRST_HOP_GOOD}`,
    isComplete: state => (state.vessels.find(v => v.id === SHIP_ID)?.cargo[FIRST_HOP_GOOD] ?? 0) > 0,
  },
  {
    title: 'Look at Antwerp',
    body: "Antwerp is a day's ride from Bruges, and pays more for cloth than home does — click its marker on the map to see what's known about it.",
    targetId: `city-node-${FIRST_HOP_CITY}`,
    // Also true once the ship is actually en route or has arrived — `previewCityId` alone is
    // transient (it changes the moment any other city is clicked, or resets on vessel reselect),
    // so checking only that would make a resumed tour re-ask for a look that already happened.
    isComplete: (state, _selectedVesselId, previewCityId) => {
      const ship = state.vessels.find(v => v.id === SHIP_ID);
      return previewCityId === FIRST_HOP_CITY || ship?.destination === FIRST_HOP_CITY || ship?.location === FIRST_HOP_CITY;
    },
  },
  {
    title: 'Confirm the voyage',
    body: 'Click "Send The Charetty ship here" to commit to the crossing.',
    targetId: 'confirm-dispatch-button',
    // Checked against `location` too, not just `destination` — once the ship arrives,
    // `destination` reverts to null, and this step needs to still read as done on a resumed tour
    // (e.g. after an unrelated scripted event interrupted it mid-voyage), not ask again.
    isComplete: state => {
      const ship = state.vessels.find(v => v.id === SHIP_ID);
      return ship?.destination === FIRST_HOP_CITY || ship?.location === FIRST_HOP_CITY;
    },
  },
  {
    title: 'Advance the clock',
    body: 'Click "Advance one week" to let the ship travel.',
    targetId: 'advance-week-button',
    isComplete: state => state.week >= 1,
  },
  {
    title: 'Sell it at a profit',
    body: 'Antwerp pays more for cloth than Bruges did. Click Sell to close the loop.',
    targetId: `market-sell-${FIRST_HOP_GOOD}`,
    isComplete: state => (state.vessels.find(v => v.id === SHIP_ID)?.cargo[FIRST_HOP_GOOD] ?? 0) === 0,
  },
  {
    title: 'Assign an officer',
    body: "Officers can be given a posting instead of sitting idle. Give Julius an assignment — negotiate or investigate somewhere, or send him aboard a ship.",
    targetId: `household-assign-${DEMO_CHARACTER_ID}`,
    isComplete: state => state.characters.find(c => c.id === DEMO_CHARACTER_ID)?.assignment.type !== 'idle',
  },
  {
    title: 'Invest in a courier line',
    body: "Reports arrive faster from a city you've paid to speed up. Try investing in London's courier line.",
    targetId: `dispatches-invest-${DEMO_INVEST_CITY}`,
    isComplete: state => (state.courierInvestment[DEMO_INVEST_CITY] ?? 0) >= 1,
  },
  {
    title: 'Write a bill of exchange',
    body: 'The Ledger lets you borrow now against a future repayment — real leverage, real risk. Try the Borrow button with whatever terms are already filled in.',
    targetId: 'ledger-borrow-button',
    isComplete: state => state.obligations.length > 0,
  },
  {
    title: "That's the loop",
    body:
      "Buy low, carry it somewhere it sells dear, mind the clock and the ledger. Cargo at sea can be insured before it departs, at Bruges, Venice, or Genoa; rival houses and the secrets you uncover from them live in their own panel further down. From here, the house is yours to run.",
    targetId: null,
    isComplete: () => false,
  },
];

/**
 * Where to resume on mount. The manual intro/outro steps always report `isComplete() => false` —
 * they're narrative bookends, not real progress — so a naive "skip while complete" scan would
 * never get past the very first (intro) step on a *re*-mount, resetting an interrupted tour back
 * to the welcome card every time (observed happening whenever a scripted story event interrupts
 * the tour mid-flow, since `GameScreen` unmounts `GuidedTour` while that event is up). Instead:
 * if no real (non-manual) step has been completed yet, this is a genuinely fresh start — show the
 * intro. Otherwise skip straight to the first not-yet-complete real step (or the outro, if every
 * real step is already done).
 */
function firstIncompleteStep(state: GameState, selectedVesselId: string | null, previewCityId: string | null): number {
  const realSteps = STEPS.map((step, index) => ({ step, index })).filter(({ step }) => step.targetId !== null);
  const anyProgress = realSteps.some(({ step }) => step.isComplete(state, selectedVesselId, previewCityId));
  if (!anyProgress) return 0;
  const nextIncomplete = realSteps.find(({ step }) => !step.isComplete(state, selectedVesselId, previewCityId));
  return nextIncomplete ? nextIncomplete.index : STEPS.length - 1;
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
  previewCityId: string | null;
  onFinish: () => void;
}

export default function GuidedTour({ state, selectedVesselId, previewCityId, onFinish }: GuidedTourProps) {
  const [stepIndex, setStepIndex] = useState(() => firstIncompleteStep(state, selectedVesselId, previewCityId));
  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const isManual = step.targetId === null;
  const rect = useTargetRect(step.targetId);

  // Auto-advance once the player actually performs the real action a step asks for.
  useEffect(() => {
    if (isManual) return;
    if (!step.isComplete(state, selectedVesselId, previewCityId)) return;
    const t = setTimeout(() => setStepIndex(i => Math.min(i + 1, STEPS.length - 1)), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, selectedVesselId, previewCityId, stepIndex]);

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
