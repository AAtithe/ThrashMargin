/**
 * A hands-on walkthrough of a real first turn.
 *
 * Not a slideshow. Each step spotlights a control that actually exists on the screen (found by DOM
 * id, measured with `getBoundingClientRect`) and advances only once the player performs the real
 * action — the game underneath is the live game, and everything done here counts.
 *
 * **Why the script is computed, not hardcoded.** Banco di Niccolò's tour could name a city and a
 * good outright because its opening position is scripted. This game's is not: the five commissions
 * are dealt from a shuffled deck against the save's own seed, so "buy tea and run it to Foochow"
 * would be wrong in most games. `planFirstRun` therefore reads the live board and picks a real,
 * reachable first run out of it, and every step's completion test is written so that a player who
 * does something sensible but different is still counted as having done the step.
 *
 * The same reasoning is why every working step carries a "Skip step" control: a tour that can be
 * entered on a board where its suggestion happens to be a bad one must never trap anybody.
 */

import { useEffect, useState } from 'react';
import {
  GOOD_BY_ID,
  PORT_BY_ID,
  distanceBetween,
  goodName,
  portName,
  sourcesFor,
} from '../sim/content';
import { PAYOUT_MULTIPLIERS, slotsOf } from '../sim/rules';
import { FONT, UI, money } from '../theme';
import type { Contract, GameState, GoodId, PortId, Ship } from '../sim/types';

/** Dismissal is a browser preference, not campaign state, so it never belongs in a save. */
const TOUR_SEEN_KEY = 'tea_race_tour_seen';

export function hasSeenGuidedTour(): boolean {
  try {
    return !!localStorage.getItem(TOUR_SEEN_KEY);
  } catch {
    // A browser with storage blocked still gets a playable game; it just gets offered the tour again.
    return false;
  }
}

export function markGuidedTourSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    /* ignore — see above */
  }
}

// ---------------------------------------------------------------------------
// Reading a real first run off the live board
// ---------------------------------------------------------------------------

export interface FirstRun {
  /** What to load where she lies, if anything posted makes that worth doing. */
  good: GoodId | null;
  /** Where to send her: the buyer if we can load here, otherwise the nearest seller. */
  destination: PortId;
  /** The commission the run is aimed at, for the "read the exchange" step. */
  contract: Contract | null;
  /** True when the cargo can be loaded where she already lies — a one-hop run, not a fetch. */
  loadHere: boolean;
}

/**
 * The best honest first move from where the ship actually is.
 *
 * Preference order, which is the order a captain reasons in:
 *  1. A live commission for something this quay already sells — load and run, nearest buyer first.
 *  2. Otherwise, go and fetch: the live commission whose nearest seller is closest to us.
 *  3. Otherwise (no commissions reachable at all, which the deck makes vanishingly unlikely but
 *     which must not crash a tour), just the nearest port.
 */
export function planFirstRun(state: GameState, ship: Ship): FirstRun | null {
  const from = ship.location;
  if (!from) return null;
  const here = PORT_BY_ID[from]?.supplies ?? [];
  const live = state.contracts.filter(c => c.fills.length < 2);

  const direct = live
    .filter(c => here.includes(c.good) && c.destination !== from)
    .sort((a, b) => distanceBetween(from, a.destination) - distanceBetween(from, b.destination));
  if (direct[0]) {
    return { good: direct[0].good, destination: direct[0].destination, contract: direct[0], loadHere: true };
  }

  const fetches = live
    .map(c => {
      const source = sourcesFor(c.good, from).find(p => p !== from);
      return source ? { contract: c, source, distance: distanceBetween(from, source) } : null;
    })
    .filter((f): f is { contract: Contract; source: PortId; distance: number } => f !== null)
    .sort((a, b) => a.distance - b.distance);
  if (fetches[0]) {
    return {
      // Nothing posted wants what this quay sells, so loading here would be pure speculation. The
      // step that uses this is written to say exactly that rather than pretend otherwise.
      good: here[0] ?? null,
      destination: fetches[0].source,
      contract: fetches[0].contract,
      loadHere: false,
    };
  }

  const nearest = Object.keys(PORT_BY_ID)
    .filter(p => p !== from && Number.isFinite(distanceBetween(from, p)))
    .sort((a, b) => distanceBetween(from, a) - distanceBetween(from, b))[0];
  if (!nearest) return null;
  return { good: here[0] ?? null, destination: nearest, contract: null, loadHere: false };
}

/**
 * Whether this game is at a position the script below is actually true of: the player's own turn,
 * one ship, tied up with an empty hold, at the top of the game. Checked by `GameScreen` before the
 * tour is ever offered, and exported so the lobby and the header agree on one answer.
 */
export function canRunGuidedTour(state: GameState | null, captainId: string | null): boolean {
  if (!state || !captainId) return false;
  if (state.phase === 'over' || state.phase === 'handover') return false;
  if (state.captains[state.activeIndex]?.id !== captainId) return false;
  if (state.round > 1) return false;
  const mine = state.ships.filter(s => s.ownerId === captainId);
  return mine.length === 1 && !!mine[0].location && mine[0].hold.length === 0 && !mine[0].voyage;
}

// ---------------------------------------------------------------------------
// The script
// ---------------------------------------------------------------------------

interface TourContext {
  state: GameState;
  ship: Ship | null;
  plan: FirstRun | null;
  targetPort: PortId | null;
  focusedContractId: string | null;
  /** `state.turn` when the tour was opened, so "end the turn" can tell a real turn from a reload. */
  startTurn: number;
}

interface TourStep {
  title: string;
  /** Computed from the live board, since the board is dealt rather than authored. */
  body: (ctx: TourContext) => string;
  /** DOM id of the control to spotlight; null for the two narrative bookends. */
  targetId: (ctx: TourContext) => string | null;
  isComplete: (ctx: TourContext) => boolean;
}

const STEPS: TourStep[] = [
  {
    title: 'One turn, done properly',
    body: () =>
      'I will point at the control you want next and wait until you use it. This is your real game — every move you make here counts, and you can leave the tour at any point.',
    targetId: () => null,
    isComplete: () => false,
  },
  {
    title: 'Take the wind',
    body: ctx =>
      `Nothing moves until the dice are down. Roll, and every ship gets two of her own — ${
        ctx.ship ? ctx.ship.name : 'your ship'
      } spends those points this turn and no others. A ship already at sea sails the moment you roll, so you never steer her twice.`,
    targetId: () => 'roll-button',
    isComplete: ctx => ctx.state.phase === 'act' || Object.keys(ctx.state.sailPoints).length > 0,
  },
  {
    title: 'Read the exchange',
    body: ctx => {
      const c = ctx.plan?.contract;
      if (!c) return 'The five commissions on the left are what everyone is racing over. Click one to see the run it implies drawn on the chart.';
      const good = GOOD_BY_ID[c.good];
      return `Click the ${goodName(c.good)} card. It wants ${goodName(c.good)} landed at ${portName(
        c.destination,
      )} and pays ${PAYOUT_MULTIPLIERS[1]}× what you paid for it — about ${money(
        (good?.basePrice ?? c.price) * PAYOUT_MULTIPLIERS[1],
      )} a lot. Second ship home takes ${PAYOUT_MULTIPLIERS[2]}×. Third takes nothing, which is the whole game in one line.`;
    },
    targetId: ctx => (ctx.plan?.contract ? `contract-card-${ctx.plan.contract.id}` : null),
    isComplete: ctx => ctx.focusedContractId !== null,
  },
  {
    title: 'Load her hold',
    body: ctx => {
      const plan = ctx.plan;
      if (!plan?.good) return 'This quay has nothing to sell. She will have to go elsewhere for a cargo.';
      if (!plan.loadHere) {
        return `Nothing posted wants ${goodName(
          plan.good,
        )}, which is all this quay sells. You can take a lot on speculation if you like the odds, or skip this step and go where the cargo is — ${portName(
          plan.destination,
        )}.`;
      }
      const slots = slotsOf(ctx.ship?.shipClass);
      return `Buy ${goodName(plan.good)} here. Her hold takes ${slots} lots, and lots of the same good landed together are paid for one by one — filling the hull with one cargo is usually the strongest move on the board.`;
    },
    targetId: ctx => (ctx.plan?.good ? `market-buy-${ctx.plan.good}` : null),
    isComplete: ctx => (ctx.ship?.hold.length ?? 0) > 0 || !ctx.ship?.location,
  },
  {
    title: 'Lay off a course',
    body: ctx =>
      ctx.plan
        ? `Click ${portName(ctx.plan.destination)} on the chart. ${
            ctx.plan.loadHere
              ? 'That is the quay that wants what you are carrying.'
              : 'That is the nearest quay selling what the board actually wants.'
          } The course appears on the chart before you commit to it.`
        : 'Click a port on the chart to lay off a course to it.',
    targetId: ctx => (ctx.plan ? `port-node-${ctx.plan.destination}` : null),
    isComplete: ctx =>
      !ctx.ship?.location ||
      (ctx.targetPort !== null && ctx.targetPort !== ctx.ship?.location),
  },
  {
    title: 'Cast off',
    body: () =>
      'Commit her. She spends this turn\'s points towards the course and carries on next turn — a long run is several turns of sailing, not one. You can change her orders at sea, but only towards one end of the leg she is on.',
    targetId: () => 'cast-off-button',
    isComplete: ctx => !ctx.ship?.location || !!ctx.ship?.voyage,
  },
  {
    title: 'End the turn',
    body: () =>
      'That is the turn: roll, work the quay, lay off a course. If a ship is still tied up with her dice unspent the button stops and tells you before you waste the roll — which is worth trusting, because an unspent roll is the most expensive thing a new captain does.',
    targetId: () => 'end-turn-button',
    isComplete: ctx => ctx.state.turn > ctx.startTurn,
  },
  {
    title: 'That is the loop',
    body: () =>
      'Buy where it is cheap, land it first, and turn the money into shares of your own company before the bank runs out of them — they get dearer as they go. Everything else on this screen is a way of doing those three things better. How to play has the detail when you want it.',
    targetId: () => null,
    isComplete: () => false,
  },
];

// ---------------------------------------------------------------------------
// Spotlight plumbing
// ---------------------------------------------------------------------------

/**
 * Track where the spotlit element actually is on screen.
 *
 * Measured on a short interval rather than only on mount: panels in this game appear and disappear
 * as the player acts (the cast-off block only exists once a port is picked), and a resize listener
 * would not catch that. `scrolledOnce` stops the sidebar being yanked back if the player
 * deliberately scrolls somewhere else afterwards.
 */
function useTargetRect(targetId: string | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!targetId) {
      setRect(null);
      return;
    }
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
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        scrolledOnce = true;
      }
    };
    measure();
    const interval = setInterval(measure, 250);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', measure);
    };
  }, [targetId]);

  return rect;
}

/**
 * Where to resume. The two narrative bookends always report incomplete — they are not progress — so
 * a naive "skip while complete" scan would never leave the intro on a remount. Instead: no real
 * step done yet means a genuinely fresh start, otherwise jump to the first outstanding one.
 */
function firstIncompleteStep(ctx: TourContext): number {
  const real = STEPS.map((step, index) => ({ step, index })).filter(({ step }) => step.targetId(ctx) !== null);
  if (!real.some(({ step }) => step.isComplete(ctx))) return 0;
  const next = real.find(({ step }) => !step.isComplete(ctx));
  return next ? next.index : STEPS.length - 1;
}

interface Props {
  state: GameState;
  captainId: string;
  targetPort: PortId | null;
  focusedContractId: string | null;
  onFinish: () => void;
}

export default function GuidedTour({ state, captainId, targetPort, focusedContractId, onFinish }: Props) {
  // Pinned once, on mount. The plan is read off the board the tour opened on; re-deriving it every
  // render would move the goalposts the moment a rival filled the card we were pointing at.
  const [startTurn] = useState(state.turn);
  const [plan] = useState<FirstRun | null>(() => {
    const ship = state.ships.find(s => s.ownerId === captainId) ?? null;
    return ship ? planFirstRun(state, ship) : null;
  });

  const ship = state.ships.find(s => s.ownerId === captainId) ?? null;
  const ctx: TourContext = { state, ship, plan, targetPort, focusedContractId, startTurn };

  const [stepIndex, setStepIndex] = useState(() => firstIncompleteStep(ctx));
  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  /**
   * A step with no control to point at cannot auto-advance, so it carries a manual button instead.
   * That covers the two narrative bookends and, just as importantly, a working step whose
   * suggestion does not apply to the board this game was dealt — a home port that stocks nothing
   * has no "buy" control to spotlight, and the tour must walk past it rather than stall on it.
   */
  const isNarrative = step.targetId(ctx) === null;
  const rect = useTargetRect(step.targetId(ctx));

  // Advance only once the player has really done the thing.
  useEffect(() => {
    if (isNarrative) return;
    if (!step.isComplete(ctx)) return;
    const t = setTimeout(() => setStepIndex(i => Math.min(i + 1, STEPS.length - 1)), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, targetPort, focusedContractId, stepIndex]);

  const PADDING = 8;
  const spotlight: React.CSSProperties | null = rect
    ? {
        position: 'fixed',
        zIndex: 101,
        left: rect.left - PADDING,
        top: rect.top - PADDING,
        width: rect.width + PADDING * 2,
        height: rect.height + PADDING * 2,
        borderRadius: 4,
        border: `2px solid ${UI.brass}`,
        boxShadow: '0 0 0 9999px rgba(6, 11, 14, 0.74)',
        pointerEvents: 'none',
        transition: 'all 0.2s ease',
      }
    : null;

  // Close enough to decide which side of the target has room; it need not be pixel-exact.
  const CARD_HEIGHT_ESTIMATE = 200;
  const CARD_WIDTH = 320;
  const cardStyle: React.CSSProperties = rect
    ? {
        ...CARD,
        top:
          rect.bottom + 16 + CARD_HEIGHT_ESTIMATE <= window.innerHeight
            ? rect.bottom + 16
            : Math.max(16, rect.top - CARD_HEIGHT_ESTIMATE - 16),
        left: Math.max(16, Math.min(rect.left, window.innerWidth - 16 - CARD_WIDTH)),
      }
    : {
        ...CARD,
        top: Math.max(16, window.innerHeight / 2 - 120),
        left: Math.max(16, window.innerWidth / 2 - CARD_WIDTH / 2),
      };

  return (
    <>
      {!rect && <div style={dimmer} />}
      {spotlight && <div style={spotlight} />}
      <div style={cardStyle} role="dialog" aria-label="Guided walkthrough">
        <p style={stepLabel}>
          Guided walkthrough — {stepIndex + 1} of {STEPS.length}
        </p>
        <h3 style={titleStyle}>{step.title}</h3>
        <p style={bodyStyle}>{step.body(ctx)}</p>
        <div style={footer}>
          <button type="button" style={ghostButton} onClick={onFinish}>
            Leave the tour
          </button>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {stepIndex > 0 && (
              <button type="button" style={button} onClick={() => setStepIndex(i => Math.max(0, i - 1))}>
                Back
              </button>
            )}
            {isNarrative ? (
              <button
                type="button"
                style={primaryButton}
                onClick={() => (isLast ? onFinish() : setStepIndex(i => i + 1))}
              >
                {isLast ? 'Finish' : stepIndex === 0 ? 'Start' : 'Next'}
              </button>
            ) : (
              // Never trap anybody on a suggestion that does not suit the board they were dealt.
              <button type="button" style={button} onClick={() => setStepIndex(i => Math.min(i + 1, STEPS.length - 1))}>
                Skip step
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

const CARD: React.CSSProperties = {
  position: 'fixed',
  zIndex: 102,
  width: 320,
  boxSizing: 'border-box',
  background: UI.panelRaised,
  border: `1px solid ${UI.brass}`,
  boxShadow: `0 0 0 1px ${UI.ground}, 0 8px 40px rgba(0,0,0,0.6)`,
  padding: '1rem 1.05rem',
  fontFamily: FONT.body,
  color: UI.text,
  transition: 'top 0.2s ease, left 0.2s ease',
};

const dimmer: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 101,
  background: 'rgba(6, 11, 14, 0.7)',
};

const stepLabel: React.CSSProperties = {
  fontFamily: FONT.data,
  fontSize: '0.62rem',
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: UI.textFaint,
  margin: '0 0 0.4rem',
};

const titleStyle: React.CSSProperties = {
  fontFamily: FONT.display,
  fontSize: '1.05rem',
  color: UI.brass,
  margin: '0 0 0.5rem',
};

const bodyStyle: React.CSSProperties = {
  fontSize: '0.83rem',
  lineHeight: 1.55,
  color: UI.textSoft,
  margin: '0 0 0.9rem',
};

const footer: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
};

const button: React.CSSProperties = {
  background: UI.panel,
  border: `1px solid ${UI.ruleStrong}`,
  color: UI.text,
  padding: '0.35rem 0.65rem',
  fontFamily: FONT.body,
  fontSize: '0.75rem',
  cursor: 'pointer',
};

// The full `border` shorthand is overridden, not just `borderColor` — mixing a shorthand and a
// longhand for the same property across renders of one element is a real React warning here.
const primaryButton: React.CSSProperties = {
  ...button,
  border: `1px solid ${UI.brass}`,
  color: UI.ground,
  background: UI.brass,
  fontWeight: 600,
};

const ghostButton: React.CSSProperties = {
  ...button,
  border: 'none',
  background: 'transparent',
  color: UI.textFaint,
  padding: '0.35rem 0.2rem',
};
