import { useEffect, useRef, useState } from 'react';
import type { GameState } from '../sim/types';
import { tradeBlockedAt } from '../sim/marketEvents';
import { canInvestFurther, courierInvestmentCost } from '../sim/news';
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
  maxWidth: 'calc(100vw - 32px)',
  boxSizing: 'border-box',
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

/**
 * What the campaign looked like when this run of the tour began, captured once on mount. A step's
 * predicate compares against it rather than against an absolute ("week >= 1", "Julius isn't idle",
 * "any obligation exists"), because the tour is offered after Chapter 0 — weeks in, with officers
 * possibly already posted and bills possibly already on the ladder — and an absolute predicate read
 * true before the player had done anything, so the card skipped straight past the step.
 */
interface TourMemory {
  week: number;
  cloth: number;
  juliusAssignment: string;
  courierLondon: number;
  obligationIds: Set<string>;
}

function captureMemory(state: GameState): TourMemory {
  const julius = state.characters.find(c => c.id === DEMO_CHARACTER_ID);
  return {
    week: state.week,
    cloth: state.vessels.find(v => v.id === SHIP_ID)?.cargo[FIRST_HOP_GOOD] ?? 0,
    juliusAssignment: JSON.stringify(julius?.assignment ?? null),
    courierLondon: state.courierInvestment[DEMO_INVEST_CITY] ?? 0,
    obligationIds: new Set(state.obligations.map(o => o.id)),
  };
}

interface TourStep {
  title: string;
  body: string;
  /** DOM id of the real UI element to spotlight; null for the intro/outro cards, which have no
   * single target and instead show a manual button. */
  targetId: string | null;
  isComplete: (state: GameState, selectedVesselId: string | null, previewCityId: string | null, memory: TourMemory) => boolean;
  /** Only set for a step whose target lives inside a popup drawer section rather than the header,
   * the map, or one of the always-visible sidebars (Fleet, Orders) — `GameScreen.tsx`'s
   * `onStepChange` forces the right popup open whenever this step becomes current, the same way
   * it already forces the Ledger/Counting-House split for the "write a bill" step specifically.
   * Fleet- and Orders-targeting steps no longer need an entry here: both panels are permanent
   * chrome now, not a menu to open first. */
  requiresSection?: 'household' | 'dispatches' | 'ledger';
  /** A sentence appended to the body when the world has put the step out of reach for now — the
   * card otherwise kept telling the player to press a disabled button. */
  blockedNote?: (state: GameState) => string | null;
}

/** A market event (a guild closure, an embargo) can shut the scripted good at either end of the
 * first hop; the seeded RNG decides, so some campaigns hit it and others never do. */
const closedNote = (cityId: string, cityName: string) => (state: GameState) =>
  tradeBlockedAt(state.marketEvents, cityId, FIRST_HOP_GOOD)
    ? `${cityName} has closed the cloth trade for now (marked "closed" beside it), so this button is disabled — advance the week until it reopens, or skip this step.`
    : null;

const STEPS: TourStep[] = [
  {
    title: "Let's make your first move",
    body: "I'll point at what to click, one step at a time — the campaign itself keeps running, so anything you do here is real. Skip anytime.",
    targetId: null,
    isComplete: () => false,
  },
  {
    title: 'Select your ship',
    // No "on the right": in the phone layout the Fleet panel sits below the map.
    body: 'Click "The Charetty ship" in the Fleet panel.',
    targetId: `vessel-button-${SHIP_ID}`,
    isComplete: (_state, selectedVesselId) => selectedVesselId === SHIP_ID,
  },
  {
    title: 'Buy some cloth',
    body: "Bruges weaves fine cloth — it's in the Orders panel below Fleet. Click Buy to load a bale aboard.",
    targetId: `market-buy-${FIRST_HOP_GOOD}`,
    blockedNote: closedNote('bruges', 'Bruges'),
    isComplete: (state, _v, _p, memory) =>
      (state.vessels.find(v => v.id === SHIP_ID)?.cargo[FIRST_HOP_GOOD] ?? 0) > memory.cloth,
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
    // Done when the ship has actually docked at Antwerp, not when the calendar reads past week 0:
    // a campaign reaches this tour after Chapter 0, weeks in, and "week >= 1" was already true, so
    // the card flashed past this step and parked on "Sell" while the ship was still at sea — a Sell
    // button that does not exist yet, under a full-screen scrim.
    isComplete: state => {
      const ship = state.vessels.find(v => v.id === SHIP_ID);
      return !!ship && !ship.destination && ship.location === FIRST_HOP_CITY;
    },
  },
  {
    title: 'Sell it at a profit',
    body: 'Antwerp pays more for cloth than Bruges did. Click Sell to close the loop.',
    targetId: `market-sell-${FIRST_HOP_GOOD}`,
    blockedNote: closedNote(FIRST_HOP_CITY, 'Antwerp'),
    isComplete: state => (state.vessels.find(v => v.id === SHIP_ID)?.cargo[FIRST_HOP_GOOD] ?? 0) === 0,
  },
  {
    title: 'Assign an officer',
    body: "Officers can be given a posting instead of sitting idle. Open the Household menu and give Julius an assignment — negotiate or investigate somewhere, or send him aboard a ship.",
    targetId: `household-assign-${DEMO_CHARACTER_ID}`,
    // A change of posting, not "not idle": Julius may already hold one when the run begins.
    isComplete: (state, _v, _p, memory) =>
      JSON.stringify(state.characters.find(c => c.id === DEMO_CHARACTER_ID)?.assignment ?? null) !== memory.juliusAssignment,
    requiresSection: 'household',
  },
  {
    title: 'Invest in a courier line',
    body: "Reports arrive faster from a city you've paid to speed up. Open the Dispatches menu and try investing in London's courier line.",
    targetId: `dispatches-invest-${DEMO_INVEST_CITY}`,
    isComplete: (state, _v, _p, memory) => (state.courierInvestment[DEMO_INVEST_CITY] ?? 0) > memory.courierLondon,
    requiresSection: 'dispatches',
    // A second run of the tour finds London already at the fastest a courier gets (the first run
    // invested in it), and a lean purse cannot pay; either way the button is disabled.
    blockedNote: state => {
      if (!canInvestFurther(DEMO_INVEST_CITY, state.courierInvestment, state.characters)) {
        return 'London\'s courier line is already as fast as it gets (the button reads "Fastest"), so there is nothing to buy here — skip this step.';
      }
      const cost = courierInvestmentCost(DEMO_INVEST_CITY, state.courierInvestment);
      return cost > state.cash
        ? `Investing costs ${cost}f and the house holds ${Math.floor(state.cash)}f, so the button is disabled — skip this step, or come back once you can pay.`
        : null;
    },
  },
  {
    title: 'Write a bill of exchange',
    body: 'The Ledger menu\'s Counting House lets you borrow now against a future repayment — real leverage, real risk. Try the Borrow button with whatever terms are already filled in.',
    targetId: 'counting-house-borrow-button',
    // A *new* obligation: Chapter 0's story, or the player, may already have put one on the ladder.
    isComplete: (state, _v, _p, memory) => state.obligations.some(o => !memory.obligationIds.has(o.id)),
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
 * The part of an element a player can actually see: its box cut down by every ancestor that clips
 * its overflow, and by the window. The Orders panel's Buy/Sell buttons sit far down the right
 * sidebar's own scroller, and a city marker can sit outside the map pane once the map is panned;
 * ringing the raw box drew the spotlight (and parked the card) off the bottom of the screen.
 * Returns null when nothing of it is visible.
 */
function visibleRectOf(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect();
  let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p);
    if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
    const c = p.getBoundingClientRect();
    left = Math.max(left, c.left); top = Math.max(top, c.top);
    right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
  }
  left = Math.max(left, 0); top = Math.max(top, 0);
  right = Math.min(right, window.innerWidth); bottom = Math.min(bottom, window.innerHeight);
  if (right - left < 4 || bottom - top < 4) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * Centre the element in every scrolling ancestor that is hiding part of it, innermost first, by
 * setting `scrollTop` directly and instantly. Not `Element.scrollIntoView`: this screen's root is
 * `overflow: hidden`, and scrollIntoView scrolls that too, shoving the header off the top. Not a
 * smooth scroll either: the element would still be moving when it is measured, and the ring would
 * land wrong and slide on. Only vertical scrollers are touched, so a city marker brings the map pane
 * back into view in the phone layout's single scrolling column without disturbing the map's own
 * pan-and-zoom (a transform, not a scroller — its markers are only ever clipped).
 */
function scrollIntoScrollers(el: Element): boolean {
  let moved = false;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o !== 'auto' && o !== 'scroll') continue;
    if (p.scrollHeight <= p.clientHeight) continue;
    const r = el.getBoundingClientRect();
    const c = p.getBoundingClientRect();
    if (r.top >= c.top - 1 && r.bottom <= c.bottom + 1) continue;
    const before = p.scrollTop;
    p.scrollTop = Math.max(0, before + (r.top - c.top) - c.height / 2 + r.height / 2);
    if (p.scrollTop !== before) moved = true;
  }
  return moved;
}

function useTargetRect(targetId: string | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!targetId) {
      setRect(null);
      return;
    }
    // One-shot per step, so the run doesn't fight a player who deliberately scrolls elsewhere. The
    // target may not exist yet on the first tick (a popup section opening, a panel re-rendering),
    // so "once" means once the element has been found, not once per effect.
    let scrolledOnce = false;
    const measure = () => {
      const el = document.getElementById(targetId);
      if (!el) {
        setRect(null);
        return;
      }
      if (!scrolledOnce) {
        scrolledOnce = true;
        scrollIntoScrollers(el);
      }
      setRect(prev => {
        const next = visibleRectOf(el);
        if (prev && next && prev.x === next.x && prev.y === next.y && prev.width === next.width && prev.height === next.height) return prev;
        return next;
      });
    };
    measure();
    // Re-measure on a short interval — the popup's content can show/hide as the player acts, and a
    // plain resize listener wouldn't catch that — and on any scroll, so the ring follows a sidebar
    // the player scrolls by hand.
    const interval = setInterval(measure, 250);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [targetId]);

  return rect;
}

/**
 * Where the card goes: below the target, then above, then to the right, then to the left — the
 * first that fits on screen without covering it. A target too big for any of those gets the card in
 * whichever screen corner overlaps it least. The old rule ("below, else above, clamped to 16px")
 * put the card straight on top of a target near the top of a short window.
 */
function placeCard(rect: DOMRect, cardW: number, cardH: number): { top: number; left: number } {
  const W = window.innerWidth, H = window.innerHeight, M = 16, GAP = 16;
  const w = Math.min(cardW, W - 2 * M);
  const clampX = (x: number) => Math.max(M, Math.min(x, W - M - w));
  const clampY = (y: number) => Math.max(M, Math.min(y, H - M - cardH));
  const candidates = [
    { top: rect.bottom + GAP, left: clampX(rect.left), ok: rect.bottom + GAP + cardH <= H - M },
    { top: rect.top - GAP - cardH, left: clampX(rect.left), ok: rect.top - GAP - cardH >= M },
    { top: clampY(rect.top), left: rect.right + GAP, ok: rect.right + GAP + w <= W - M },
    { top: clampY(rect.top), left: rect.left - GAP - w, ok: rect.left - GAP - w >= M },
  ];
  const fit = candidates.find(c => c.ok);
  if (fit) return { top: fit.top, left: fit.left };
  const overlap = (x: number, y: number) =>
    Math.max(0, Math.min(x + w, rect.right) - Math.max(x, rect.left)) *
    Math.max(0, Math.min(y + cardH, rect.bottom) - Math.max(y, rect.top));
  const corners = [
    { left: W - M - w, top: H - M - cardH }, { left: M, top: H - M - cardH },
    { left: W - M - w, top: M }, { left: M, top: M },
  ];
  return corners.reduce((best, c) => (overlap(c.left, c.top) < overlap(best.left, best.top) ? c : best));
}

interface GuidedTourProps {
  state: GameState;
  selectedVesselId: string | null;
  previewCityId: string | null;
  onFinish: () => void;
  /** Called whenever the current step changes (including on mount, so a tour resumed directly onto
   * a step that needs a popup section still forces it open immediately, and a step that doesn't
   * needs the caller to close whatever was open before) — the caller owns what "showing a section"
   * actually means, since popup state lives in `GameScreen`, not here. */
  onStepChange?: (requiresSection: TourStep['requiresSection'], targetId: string | null) => void;
  /**
   * Hidden rather than unmounted while a scripted event, the chapter card or another modal owns the
   * screen. Unmounting threw the run away: the remount re-derived its step from the predicates, and
   * "Buy some cloth" (cargo > 0) reads false again once the cloth is sold, so an event firing during
   * the Household/Dispatches/Ledger steps sent the player back to buying cloth at Antwerp.
   */
  hidden?: boolean;
}

export default function GuidedTour({ state, selectedVesselId, previewCityId, onFinish, onStepChange, hidden = false }: GuidedTourProps) {
  // Captured once, on the first render; `useRef` because reading it must never cause a render.
  const memoryRef = useRef<TourMemory | null>(null);
  if (memoryRef.current === null) memoryRef.current = captureMemory(state);
  const memory = memoryRef.current;

  // Every mount is a fresh run now (the component stays mounted, hidden, through modals), so it
  // always opens on the welcome card. The old resume-scan could never do that after Chapter 0:
  // "Select your ship" (the first vessel is selected by default on a skip-prologue campaign) and
  // "Sell" (no cloth aboard) both read true before the player had touched anything, so it judged
  // the run already under way and opened on step 2 or 3 with no introduction.
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const isManual = step.targetId === null;
  const rect = useTargetRect(hidden ? null : step.targetId);

  useEffect(() => {
    if (hidden) return;
    // The target too, so the caller can open whichever floating panel holds it.
    onStepChange?.(step.requiresSection, step.targetId ?? null);
    // Re-run on un-hide too: a modal may have closed the popup section this step needs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, hidden]);

  const done = (i: number) =>
    STEPS[i].targetId !== null && STEPS[i].isComplete(state, selectedVesselId, previewCityId, memory);
  // Every way forward — Start, Skip this, and the auto-advance below — lands on the next real step
  // not already done, never on one that is: a done step would sit on screen for 700ms with nothing
  // for the player to do, then advance by itself. On a skip-prologue campaign the ship is selected
  // by default, so Start passes over "Select your ship". A tour reopened after a first run (the ship
  // now docked at Antwerp, Antwerp the previewed city) flashed through "Look at Antwerp", "Confirm
  // the voyage" and "Advance the clock" in two seconds after the cloth was bought, each reading done
  // on arrival. Back skips the same way in reverse, or it could never get past a done step.
  const nextOpen = (from: number) => {
    let i = from + 1;
    while (i < STEPS.length - 1 && done(i)) i++;
    return Math.min(i, STEPS.length - 1);
  };
  const start = () => setStepIndex(nextOpen(stepIndex));

  // Auto-advance once the player actually performs the real action a step asks for. Not while
  // hidden: a step completed by the very action that raised a modal advances once it is dismissed.
  // Any change to the state re-arms the timer, so `nextOpen` always judges the current state.
  useEffect(() => {
    if (isManual || hidden) return;
    if (!step.isComplete(state, selectedVesselId, previewCityId, memory)) return;
    const t = setTimeout(() => setStepIndex(nextOpen(stepIndex)), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, selectedVesselId, previewCityId, stepIndex, hidden]);

  // The padded ring is kept inside the window too: a target flush with a screen edge otherwise drew
  // half its ring off the page.
  const note = isManual ? null : step.blockedNote?.(state) ?? null;
  const back = () => {
    let i = stepIndex - 1;
    while (i > 0 && done(i)) i--;
    setStepIndex(Math.max(0, i));
  };

  const PADDING = 8;
  const ring = rect
    ? {
        left: Math.max(2, rect.left - PADDING),
        top: Math.max(2, rect.top - PADDING),
        right: Math.min(window.innerWidth - 2, rect.right + PADDING),
        bottom: Math.min(window.innerHeight - 2, rect.bottom + PADDING),
      }
    : null;
  const spotlight: React.CSSProperties | null = ring
    ? {
        position: 'fixed',
        zIndex: 101,
        boxSizing: 'border-box',
        left: ring.left,
        top: ring.top,
        width: ring.right - ring.left,
        height: ring.bottom - ring.top,
        borderRadius: 6,
        border: `2px solid ${GOLD}`,
        boxShadow: `0 0 0 9999px ${UI.scrim}`,
        pointerEvents: 'none',
        transition: 'all 0.2s ease',
      }
    : null;

  // The card's height varies with the body copy and the viewport width, so it is measured after
  // each render; the estimate covers only the very first frame.
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(190);
  useEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardHeight) > 2) setCardHeight(h);
  });
  const CARD_WIDTH = 320;
  const cardStyle: React.CSSProperties = rect
    ? { ...CARD, ...placeCard(rect, CARD_WIDTH, cardHeight) }
    : {
        ...CARD,
        top: Math.max(16, window.innerHeight / 2 - cardHeight / 2),
        left: Math.max(16, window.innerWidth / 2 - Math.min(CARD_WIDTH, window.innerWidth - 32) / 2),
      };

  // Skipping and finishing both mean "do not offer this again unasked".
  const finish = () => {
    markGuidedTourSeen();
    onFinish();
  };

  // Every hook is above this line: one placed after an early return renders conditionally.
  if (hidden) return null;

  return (
    <>
      {!rect && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 101,
            background: UI.scrim,
            // Never swallow clicks: on a real step this shows while the target is briefly missing
            // (a popup opening, a panel re-rendering), and a click-eating scrim then left Skip as
            // the only working control on the screen.
            pointerEvents: 'none',
          }}
        />
      )}
      {spotlight && <div style={spotlight} />}
      {/* `data-tour-*` is how an automated pass drives the run: it reads which control the card is
          pointing at and clicks that, rather than guessing from the copy. Empty while nothing is
          ringed. */}
      <div ref={cardRef} style={cardStyle} data-tour-step={String(stepIndex)} data-tour-target={rect ? step.targetId ?? '' : ''}>
        <p style={STEP_LABEL}>
          Guided walkthrough — {stepIndex + 1} of {STEPS.length}
        </p>
        <h3 style={TITLE}>{step.title}</h3>
        <p style={BODY}>{step.body}</p>
        {note && <p data-tour-note="" style={{ ...BODY, color: UI.bad, marginTop: '-0.4rem' }}>{note}</p>}
        <div style={FOOTER}>
          <button style={GHOST_BUTTON} onClick={finish}>
            Skip tour
          </button>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {stepIndex > 0 && (
              <button style={BUTTON} onClick={back}>
                Back
              </button>
            )}
            {isManual ? (
              <button
                style={PRIMARY_BUTTON}
                onClick={() => (isLast ? finish() : start())}
              >
                {isLast ? 'Finish' : 'Start'}
              </button>
            ) : (
              // Every real step needs a way past it that is not "abandon the whole tour": the world
              // keeps running underneath, and a market closure at Antwerp (seed-dependent) left the
              // card pointing at a disabled Sell button with Skip tour as the only control.
              <button style={BUTTON} onClick={start}>
                Skip this
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
