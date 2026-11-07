/**
 * A hands-on walkthrough of a real first turn.
 *
 * Not a slideshow. Each step spotlights a control that actually exists on the screen (found by DOM
 * id, measured with `getBoundingClientRect`) and advances only once the player performs the real
 * action — the game underneath is the live game, and everything done here counts.
 *
 * **Why the script is computed, not hardcoded.** The five contracts are dealt from a shuffled deck
 * against the save's own seed, so naming a good and a destination outright would be wrong in most
 * games. `planFirstRun` reads the live board and picks a real, reachable first run out of it.
 *
 * **And why this game needs that more than The Tea Race does.** London, the home depot, supplies
 * nothing at all — it is a distribution hub, not a producer. Every first move in Steady Eddie is
 * therefore a fetch: drive out empty to where the cargo is. A tour written as "load up and go"
 * would be wrong on the opening turn of every single game, so the load step is written to say so
 * and step aside when there is nothing to load.
 */

import { useEffect, useState } from 'react';
import {
  DEPOT_BY_ID,
  GOOD_BY_ID,
  depotName,
  distanceBetween,
  goodName,
  sourcesFor,
} from '../sim/content';
import { PAYOUT_MULTIPLIERS, slotsOf } from '../sim/rules';
import { FONT, UI, money } from '../theme';
import type { Contract, DepotId, GameState, GoodId, Vehicle } from '../sim/types';

/** Dismissal is a browser preference, not campaign state, so it never belongs in a save. */
const TOUR_SEEN_KEY = 'steady_eddie_tour_seen';

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
  /** What to load where she is parked, if this depot sells anything worth taking. */
  good: GoodId | null;
  /** Where to send her: the consignee if we can load here, otherwise the nearest supplier. */
  destination: DepotId;
  /** The contract the run is aimed at, for the "read the board" step. */
  contract: Contract | null;
  /** True when the cargo can be loaded where she already stands — a one-hop run, not a fetch. */
  loadHere: boolean;
}

/**
 * The best honest first move from where the vehicle actually is.
 *
 * Preference order, which is the order a haulier reasons in:
 *  1. A live contract for something this depot already stocks — load and run, nearest drop first.
 *  2. Otherwise, go and fetch: the live contract whose nearest supplier is closest to us. This is
 *     the path every opening turn takes, since the home depot stocks nothing.
 *  3. Otherwise (no contract reachable at all, which the deck makes vanishingly unlikely but which
 *     must not crash a tour), just the nearest depot.
 */
export function planFirstRun(state: GameState, vehicle: Vehicle): FirstRun | null {
  const from = vehicle.location;
  if (!from) return null;
  const here = DEPOT_BY_ID[from]?.supplies ?? [];
  const live = state.contracts.filter(c => c.fills.length < 2);

  const direct = live
    .filter(c => here.includes(c.good) && c.destination !== from)
    .sort((a, b) => distanceBetween(from, a.destination) - distanceBetween(from, b.destination));
  if (direct[0]) {
    return { good: direct[0].good, destination: direct[0].destination, contract: direct[0], loadHere: true };
  }

  const fetches = live
    .map(c => {
      const source = sourcesFor(c.good, from).find(d => d !== from);
      return source ? { contract: c, source, distance: distanceBetween(from, source) } : null;
    })
    .filter((f): f is { contract: Contract; source: DepotId; distance: number } => f !== null)
    .sort((a, b) => a.distance - b.distance);
  if (fetches[0]) {
    return {
      good: here[0] ?? null,
      destination: fetches[0].source,
      contract: fetches[0].contract,
      loadHere: false,
    };
  }

  const nearest = Object.keys(DEPOT_BY_ID)
    .filter(d => d !== from && Number.isFinite(distanceBetween(from, d)))
    .sort((a, b) => distanceBetween(from, a) - distanceBetween(from, b))[0];
  if (!nearest) return null;
  return { good: here[0] ?? null, destination: nearest, contract: null, loadHere: false };
}

/**
 * Whether this game is at a position the script below is actually true of: the player's own turn,
 * one vehicle, parked with an empty bed, at the top of the game.
 */
export function canRunGuidedTour(state: GameState | null, haulierId: string | null): boolean {
  if (!state || !haulierId) return false;
  if (state.phase === 'over' || state.phase === 'handover') return false;
  if (state.hauliers[state.activeIndex]?.id !== haulierId) return false;
  if (state.round > 1) return false;
  const mine = state.vehicles.filter(v => v.ownerId === haulierId);
  return mine.length === 1 && !!mine[0].location && mine[0].hold.length === 0 && !mine[0].run;
}

// ---------------------------------------------------------------------------
// The script
// ---------------------------------------------------------------------------

interface TourContext {
  state: GameState;
  vehicle: Vehicle | null;
  plan: FirstRun | null;
  targetDepot: DepotId | null;
  focusedContractId: string | null;
  /** `state.turn` when the tour was opened, so "end the turn" can tell a real turn from a reload. */
  startTurn: number;
}

interface TourStep {
  title: string;
  /** Computed from the live board, since the board is dealt rather than authored. */
  body: (ctx: TourContext) => string;
  /** DOM id of the control to spotlight; null for a step with nothing to point at. */
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
    title: 'Get the miles down',
    body: ctx =>
      `Nothing moves until the dice are down. Roll, and every vehicle gets two of her own — ${
        ctx.vehicle ? ctx.vehicle.name : 'your lorry'
      } runs on those miles this turn and no others. A vehicle already on the road moves the moment you roll, so you never steer her twice.`,
    targetId: () => 'roll-button',
    isComplete: ctx => ctx.state.phase === 'act' || Object.keys(ctx.state.miles).length > 0,
  },
  {
    title: 'Read the board',
    body: ctx => {
      const c = ctx.plan?.contract;
      if (!c) return 'The five contracts on the left are what everyone is competing for. Click one to see the run it implies drawn on the map.';
      const good = GOOD_BY_ID[c.good];
      return `Click the ${goodName(c.good)} card. It wants ${goodName(c.good)} delivered to ${depotName(
        c.destination,
      )} and pays ${PAYOUT_MULTIPLIERS[1]}× what you paid for it — about ${money(
        (good?.basePrice ?? c.price) * PAYOUT_MULTIPLIERS[1],
      )} a pallet. Second lorry in takes ${PAYOUT_MULTIPLIERS[2]}×. Third takes nothing, which is the whole game in one line.`;
    },
    targetId: ctx => (ctx.plan?.contract ? `contract-card-${ctx.plan.contract.id}` : null),
    isComplete: ctx => ctx.focusedContractId !== null,
  },
  {
    title: 'Nothing loads here',
    body: ctx => {
      const plan = ctx.plan;
      if (!plan?.good) {
        return `${
          ctx.vehicle?.location ? depotName(ctx.vehicle.location) : 'This depot'
        } is a distribution hub, not a producer — there is nothing here to load. That is the shape of the game's opening: you run out empty to where the cargo is, and the contract you just read tells you where that is. Carry on.`;
      }
      if (!plan.loadHere) {
        return `Nothing posted wants ${goodName(
          plan.good,
        )}, which is all this depot stocks. You can take a pallet on speculation if you like the odds, or skip this step and go where the cargo is — ${depotName(
          plan.destination,
        )}.`;
      }
      const slots = slotsOf(ctx.vehicle?.vehicleClass);
      return `Load ${goodName(plan.good)} here. Her bed takes ${slots} pallet${
        slots === 1 ? '' : 's'
      }, and pallets of the same good delivered together are paid for one by one — filling the bed with one load is usually the strongest move on the board.`;
    },
    targetId: ctx => (ctx.plan?.good ? `market-buy-${ctx.plan.good}` : null),
    isComplete: ctx => (ctx.vehicle?.hold.length ?? 0) > 0 || !ctx.vehicle?.location,
  },
  {
    title: 'Plan the run',
    body: ctx =>
      ctx.plan
        ? `Click ${depotName(ctx.plan.destination)} on the map. ${
            ctx.plan.loadHere
              ? 'That is the depot that wants what you are carrying.'
              : 'That is the nearest depot stocking what the board actually wants.'
          } The route appears on the map before you commit to it.`
        : 'Click a depot on the map to plan a run to it.',
    targetId: ctx => (ctx.plan ? `depot-node-${ctx.plan.destination}` : null),
    isComplete: ctx =>
      !ctx.vehicle?.location ||
      (ctx.targetDepot !== null && ctx.targetDepot !== ctx.vehicle?.location),
  },
  {
    title: 'Set off',
    body: () =>
      'Commit her. She runs this turn\'s miles towards the destination and carries on next turn — a long haul is several turns of driving, not one. You can re-route her on the road, but only towards one end of the leg she is on.',
    targetId: () => 'set-off-button',
    isComplete: ctx => !ctx.vehicle?.location || !!ctx.vehicle?.run,
  },
  {
    title: 'End the turn',
    body: () =>
      'That is the turn: roll, work the depot, plan the run. If a vehicle is still parked with her dice unspent the button stops and tells you before you waste the roll — which is worth trusting, because an unspent roll is the most expensive thing a new haulier does.',
    targetId: () => 'end-turn-button',
    isComplete: ctx => ctx.state.turn > ctx.startTurn,
  },
  {
    title: 'That is the loop',
    body: () =>
      'Buy where it is cheap, deliver first, and turn the money into shares of your own firm before the bank runs out of them — they get dearer as they go. Everything else on this screen is a way of doing those three things better. How to play has the detail when you want it.',
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
 * as the player acts (the set-off block only exists once a depot is picked), and a resize listener
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
 * Where to resume. A step with nothing to point at always reports incomplete — it is not progress —
 * so a naive "skip while complete" scan would never leave the intro on a remount. Instead: no real
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
  haulierId: string;
  targetDepot: DepotId | null;
  focusedContractId: string | null;
  onFinish: () => void;
}

export default function GuidedTour({ state, haulierId, targetDepot, focusedContractId, onFinish }: Props) {
  // Pinned once, on mount. The plan is read off the board the tour opened on; re-deriving it every
  // render would move the goalposts the moment a rival filled the card we were pointing at.
  const [startTurn] = useState(state.turn);
  const [plan] = useState<FirstRun | null>(() => {
    const vehicle = state.vehicles.find(v => v.ownerId === haulierId) ?? null;
    return vehicle ? planFirstRun(state, vehicle) : null;
  });

  const vehicle = state.vehicles.find(v => v.ownerId === haulierId) ?? null;
  const ctx: TourContext = { state, vehicle, plan, targetDepot, focusedContractId, startTurn };

  const [stepIndex, setStepIndex] = useState(() => firstIncompleteStep(ctx));
  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  /**
   * A step with no control to point at cannot auto-advance, so it carries a manual button instead.
   * That covers the two narrative bookends and, just as importantly, the load step on every opening
   * turn — the home depot stocks nothing, so there is no "load" control to spotlight and the tour
   * must walk past it rather than stall on it.
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
  }, [state, targetDepot, focusedContractId, stepIndex]);

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
