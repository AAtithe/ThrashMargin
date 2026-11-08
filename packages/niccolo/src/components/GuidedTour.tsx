import { useEffect, useState } from 'react';
import type { GameState } from '../sim/types';
import { UI, FONT } from '../theme';

const GOLD = UI.brass;
const INK = UI.rule;

/** Its own key, deliberately not `TutorialOverlay`'s. The two are different pieces of onboarding:
 *  the overlay is read, this is played, and a player can legitimately want one and not the other.
 *  A UI preference, not campaign state, so it lives in localStorage rather than in the save. */
const TOUR_SEEN_KEY = 'niccolo_guided_tour_seen';

/** Whether this browser has finished or skipped the tour before. */
export function hasSeenGuidedTour(): boolean {
  try {
    return !!localStorage.getItem(TOUR_SEEN_KEY);
  } catch {
    // Private browsing and blocked storage both throw here. Offering the tour again is the
    // harmless failure; crashing the game screen is not.
    return false;
  }
}

export function markGuidedTourSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    /* see above */
  }
}

const CARD: React.CSSProperties = {
  position: 'fixed',
  zIndex: 102,
  width: '20rem',
  background: UI.panelRaised,
  border: `1px solid ${INK}`,
  boxShadow: `0 0 0 1px ${UI.ground}, 0 8px 40px ${UI.shadow}`,
  padding: '1.1rem',
  fontFamily: FONT.body,
  color: UI.text,
  transition: 'top 0.2s ease, left 0.2s ease',
};

const STEP_LABEL: React.CSSProperties = {
  fontSize: '0.65rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: UI.textSoft,
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
  background: UI.panel,
  border: `1px solid ${INK}`,
  color: UI.text,
  padding: '0.4rem 0.7rem',
  fontFamily: 'inherit',
  fontSize: '0.75rem',
  cursor: 'pointer',
};

// Override the full `border` shorthand, not just `borderColor` — mixing a shorthand and a longhand
// for the same property across renders of the same element is a real React warning ("Removing
// borderColor border"), not just a lint nag.
const PRIMARY_BUTTON: React.CSSProperties = { ...BUTTON, border: `1px solid ${GOLD}`, color: GOLD };
const GHOST_BUTTON: React.CSSProperties = { ...BUTTON, border: 'none', color: UI.textFaint, padding: '0.4rem 0.2rem' };

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
  /** Only set for a step whose target lives inside a popup drawer section rather than the header,
   * the map, or one of the always-visible sidebars (Fleet, Orders) — `GameScreen.tsx`'s
   * `onStepChange` forces the right popup open whenever this step becomes current, the same way
   * it already forces the Ledger/Counting-House split for the "write a bill" step specifically.
   * Fleet- and Orders-targeting steps no longer need an entry here: both panels are permanent
   * chrome now, not a menu to open first. */
  requiresSection?: 'household' | 'dispatches' | 'ledger';
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
    body: 'Click "The Charetty ship" in the Fleet panel, on the right.',
    targetId: `vessel-button-${SHIP_ID}`,
    isComplete: (_state, selectedVesselId) => selectedVesselId === SHIP_ID,
  },
  {
    title: 'Buy some cloth',
    body: "Bruges weaves fine cloth — it's in the Orders panel below Fleet. Click Buy to load a bale aboard.",
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
    body: "Officers can be given a posting instead of sitting idle. Open the Household menu and give Julius an assignment — negotiate or investigate somewhere, or send him aboard a ship.",
    targetId: `household-assign-${DEMO_CHARACTER_ID}`,
    isComplete: state => state.characters.find(c => c.id === DEMO_CHARACTER_ID)?.assignment.type !== 'idle',
    requiresSection: 'household',
  },
  {
    title: 'Invest in a courier line',
    body: "Reports arrive faster from a city you've paid to speed up. Open the Dispatches menu and try investing in London's courier line.",
    targetId: `dispatches-invest-${DEMO_INVEST_CITY}`,
    isComplete: state => (state.courierInvestment[DEMO_INVEST_CITY] ?? 0) >= 1,
    requiresSection: 'dispatches',
  },
  {
    title: 'Write a bill of exchange',
    body: 'The Ledger menu\'s Counting House lets you borrow now against a future repayment — real leverage, real risk. Try the Borrow button with whatever terms are already filled in.',
    targetId: 'counting-house-borrow-button',
    isComplete: state => state.obligations.length > 0,
    requiresSection: 'ledger',
  },
  {
    title: "That's the loop",
    body:
      "Buy low, carry it somewhere it sells dear, mind the clock and the ledger. Cargo at sea can be insured before it departs, at Bruges, Venice, or Genoa; rival houses and the secrets you uncover from them live in their own menu. From here, the house is yours to run.",
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
/* `firstIncompleteStep` used to guess where to resume by asking whether any real step was already
 * complete. It could not work, and never did: "Sell it at a profit" completes when the hold is
 * empty of cloth, which is true of an empty hold, so the "has anything happened yet?" probe was
 * true before the player had done a thing and the welcome card was unreachable. On a
 * skip-the-prologue campaign "Select your ship" was satisfied at mount too, because `GameScreen`
 * auto-selects the only vessel, so the tour opened on step three.
 *
 * Guessing was the wrong shape. The caller already knows the difference between a tour the player
 * has just asked for and one being remounted because a scripted event briefly took the screen, so
 * the step index lives in `GameScreen` and is passed in. A fresh tour starts at the welcome card;
 * an interrupted one comes back exactly where it was, which is what the guessing was reaching for.
 */

function useTargetRect(targetId: string | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!targetId) {
      setRect(null);
      return;
    }
    // The target may be anywhere: the header, the map, one of the two sidebars (each its own
    // scroller), or inside a popup section's scrolling body (`id="section-popup-scroll"` in
    // `SectionPopup.tsx`). An earlier version computed the scroll by hand against that one popup
    // container's `scrollTop`, which is why the sidebars were never scrolled at all: an Orders- or
    // Fleet-targeting step whose control sat below the fold rang a rectangle hundreds of pixels
    // under the viewport, and placed its own card there too, so the player saw no tour whatsoever
    // (measured: the "Buy some cloth" step ringed y=1362 in a 1000px window). `scrollIntoView`
    // scrolls every scrollable ancestor, which is exactly what is wanted here, and the note that
    // it "proved unreliable" was about the *smooth* variant: a smooth scroll is still moving the
    // element for a few hundred milliseconds after it is measured, so the ring lands wrong and
    // then slides on. `behavior: 'auto'` settles synchronously, so the rect taken immediately
    // afterwards is the one the player sees. `scrolledOnce` stops it re-yanking the page if the
    // player deliberately scrolls elsewhere afterward.
    let scrolledOnce = false;
    const measure = () => {
      const el = document.getElementById(targetId);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      if (!scrolledOnce && (r.top < 0 || r.bottom > window.innerHeight)) {
        el.scrollIntoView({ block: 'center', behavior: 'auto' });
        scrolledOnce = true;
        setRect(el.getBoundingClientRect());
        return;
      }
      setRect(r);
    };
    measure();
    // Re-measure on a short interval — the popup's content can show/hide as the player acts, and a
    // plain resize listener wouldn't catch that.
    const interval = setInterval(measure, 250);
    window.addEventListener('resize', measure);
    // Capture-phase, so a scroll of either sidebar or of a popup's own body counts, not just the
    // window's. Without it the ring lags a quarter-second behind anything the player scrolls.
    window.addEventListener('scroll', measure, true);
    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [targetId]);

  return rect;
}

interface GuidedTourProps {
  state: GameState;
  selectedVesselId: string | null;
  previewCityId: string | null;
  /** Which step to show. Owned by `GameScreen` so an interrupted tour resumes where it was. */
  stepIndex: number;
  /** Report a move so the caller's copy keeps up. */
  onStepIndexChange: (index: number) => void;
  onFinish: () => void;
  /** Called whenever the current step changes (including on mount, so a tour resumed directly onto
   * a step that needs a popup section still forces it open immediately, and a step that doesn't
   * needs the caller to close whatever was open before) — the caller owns what "showing a section"
   * actually means, since popup state lives in `GameScreen`, not here. */
  onStepChange?: (requiresSection: TourStep['requiresSection'], targetId: string | null) => void;
}

export default function GuidedTour({
  state,
  selectedVesselId,
  previewCityId,
  stepIndex,
  onStepIndexChange,
  onFinish,
  onStepChange,
}: GuidedTourProps) {
  const setStepIndex = (next: number) => onStepIndexChange(Math.max(0, Math.min(next, STEPS.length - 1)));
  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const isManual = step.targetId === null;
  const rect = useTargetRect(step.targetId);

  useEffect(() => {
    // The target too, so the caller can open whichever floating panel holds it.
    onStepChange?.(step.requiresSection, step.targetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  // Auto-advance once the player actually performs the real action a step asks for.
  useEffect(() => {
    if (isManual) return;
    if (!step.isComplete(state, selectedVesselId, previewCityId)) return;
    const t = setTimeout(() => setStepIndex(stepIndex + 1), 700);
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
        boxShadow: `0 0 0 9999px ${UI.scrim}`,
        pointerEvents: 'none',
        transition: 'all 0.2s ease',
      }
    : null;

  // Estimated card height — real height varies slightly with body copy length, but this only
  // needs to be close enough to decide which side of the target has room, not pixel-exact.
  const CARD_HEIGHT_ESTIMATE = 170;
  // The *border box*, which is what has to fit on screen: `CARD` is content-box, so its 20rem
  // width plus 1.1rem of padding and 1px of border on each side comes to this. Clamping against
  // the bare 320 instead hung 21px of every right-hand-sidebar step's card off the right edge.
  const CARD_WIDTH = 20 * 16 + 2 * 1.1 * 16 + 2;
  const cardStyle: React.CSSProperties = rect
    ? {
        ...CARD,
        // Prefer below the target; if there isn't room, place it above instead of clamping into
        // an overlap with the very element it's pointing at.
        top:
          rect.bottom + 16 + CARD_HEIGHT_ESTIMATE <= window.innerHeight
            ? rect.bottom + 16
            : Math.max(16, rect.top - CARD_HEIGHT_ESTIMATE - 16),
        left: Math.max(16, Math.min(rect.left, window.innerWidth - 16 - CARD_WIDTH)),
      }
    : {
        ...CARD,
        top: window.innerHeight / 2 - 100,
        left: Math.max(16, window.innerWidth / 2 - CARD_WIDTH / 2),
      };

  const finish = () => {
    markGuidedTourSeen();
    onFinish();
  };

  return (
    <>
      {!rect && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 101,
            background: UI.scrim,
          }}
        />
      )}
      {spotlight && <div style={spotlight} />}

      {/* `data-tour-*` is how an automated pass drives the tour: it reads which control the card
          is pointing at and clicks that, rather than guessing from the copy. It reports the
          element actually ringed, not the step's preference — a step whose target is not on
          screen rings nothing, and a pass told to click it anyway would hunt a control that is
          not there. */}
      <div style={cardStyle} data-tour-step={String(stepIndex)} data-tour-target={rect ? step.targetId ?? '' : ''}>
        <p style={STEP_LABEL}>
          Guided walkthrough — {stepIndex + 1} of {STEPS.length}
        </p>
        <h3 style={TITLE}>{step.title}</h3>
        <p style={BODY}>{step.body}</p>
        <div style={FOOTER}>
          <button style={GHOST_BUTTON} onClick={finish}>
            Skip tour
          </button>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {stepIndex > 0 && (
              <button style={BUTTON} onClick={() => setStepIndex(stepIndex - 1)}>
                Back
              </button>
            )}
            {isManual && (
              <button
                style={PRIMARY_BUTTON}
                onClick={() => (isLast ? finish() : setStepIndex(stepIndex + 1))}
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
