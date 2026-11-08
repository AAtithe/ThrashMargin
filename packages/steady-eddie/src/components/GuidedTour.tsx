/**
 * A guided first run, driven on the real game.
 *
 * Not a slideshow and not a sandbox. It spotlights a control in the live UI, waits for the player
 * to actually use it, and moves on when the game state says they did. Everything in it counts —
 * the load is real, the commission is real, the money is theirs. A player who finishes has not
 * watched the loop demonstrated, they have run it once: empty bay, cargo sourced, commission
 * landed, share bought with the proceeds.
 *
 * Forked from `packages/tea-race/src/components/GuidedTour.tsx` along with the rest of this
 * package, and the two should be kept in step when either is fixed. Three differences are not
 * cosmetic:
 *
 * - **Every run needs a sourcing leg.** London, the home depot, supplies nothing at all. In The
 *   Tea Race the home port at least sells cloth, so the "load it where you stand" shape is
 *   occasionally possible; here it never is, and the sourcing leg is the game's first real lesson
 *   rather than an edge case.
 * - **Depots strike and goods go under embargo.** Both silently make a button unusable, so the
 *   plan filters them out before it recommends anything.
 * - **One price, not two.** There is no second ruleset here, so `priceAt` is read directly rather
 *   than threaded down from the screen the way The Tea Race has to.
 *
 * ## What the predicates have to tolerate
 *
 * Every `isComplete` is read against live state on every render. Two rules, both learned the hard
 * way in the Niccolò tour this pattern comes from:
 *
 * - **Transient UI state cannot be the only evidence.** "Lay off a course" is satisfied by
 *   `targetDepot`, which clears the moment she sets off, so each such step also accepts the
 *   downstream proof — she is heading there, or she is already there.
 * - **The bookends never complete.** The intro and outro return `false` for ever, so the opening
 *   scan has to treat "stopped at the first real step" as a fresh start rather than a resume.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { distanceBetween, depotName, goodName, sourcesFor } from '../sim/content';
import { destinationOf } from '../sim/movement';
import { depotStruck, goodEmbargoed } from '../sim/events';
import { priceAt } from '../sim/pricing';
import { PAYOUT_MULTIPLIERS, SHARE_MAJORITY, slotsOf } from '../sim/rules';
import { FONT, UI, money } from '../theme';
import type { Contract, ContractId, DepotId, GameState, GoodId, Haulier, Vehicle, VehicleId } from '../sim/types';

const TOUR_SEEN_KEY = 'steady_eddie_tour_seen';

/** Whether this browser has finished or skipped the run before. A UI preference, not game state,
 *  so it lives in localStorage rather than in the save. */
export function hasSeenGuidedTour(): boolean {
  try {
    return !!localStorage.getItem(TOUR_SEEN_KEY);
  } catch {
    // Private browsing and blocked storage both throw. Offering the run again is the harmless
    // failure; crashing the game screen is not.
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

/** Everything a step needs, assembled by `GameScreen` from state plus its own selection. */
export interface TourView {
  state: GameState;
  haulier: Haulier;
  /** The vehicle the run is taught on. */
  vehicle: Vehicle | null;
  targetDepot: DepotId | null;
  focusedContract: Contract | null;
}

interface TourStep {
  title: string;
  body: (v: TourView, plan: TourPlan) => string;
  /** Resolved per render: targets move as the game moves — the turn bar swaps the roll button for
   *  the end-turn button, the Load block disappears once the bay is full. */
  target: (v: TourView, plan: TourPlan) => string | null;
  isComplete: (v: TourView, plan: TourPlan, memory: TourMemory) => boolean;
}

/**
 * What the run remembers for itself: a starting value to measure change against, and one latch.
 *
 * The latch is not an optimisation. The commissions board's click handler *toggles* focus, so a
 * player who clicks a card twice — or clicks it, looks at another, and comes back — would watch a
 * finished step come undone. A step that can un-complete itself is a step the run can stick on.
 */
interface TourMemory {
  shares: number;
  pickedCommission: boolean;
}

/* -------------------------------------------------------------------------------------------- */
/* The plan                                                                                       */
/* -------------------------------------------------------------------------------------------- */

export interface TourPlan {
  /** Held by id, not by reference, so a haulier who buys a second vehicle mid-run does not
   *  quietly change which cab the steps are talking about. */
  vehicleId: VehicleId;
  contractId: ContractId;
  good: GoodId;
  /** Where the cargo is bought. Never the home depot: London stocks nothing. */
  loadDepot: DepotId;
  /** Where the commission is landed. */
  destination: DepotId;
}

/**
 * Choose the run to teach: the shortest "fetch it, run it, land it" the haulier can pay for from
 * where she is parked.
 *
 * Scored on miles rather than on margin, deliberately. The job is to get the player through one
 * complete loop while they still have the patience for it, and a long haul to Inverness for a
 * better price teaches the same four verbs as a short one to Bristol, several turns slower. The
 * commission price breaks ties.
 *
 * Returns null when nothing is affordable, nothing is reachable, or everything that would serve is
 * struck or embargoed. The caller treats that as "not a sensible game to start a run on" rather
 * than opening a run that cannot be finished.
 */
export function planFirstRun(state: GameState, haulier: Haulier, vehicle: Vehicle): TourPlan | null {
  const from = vehicle.location;
  if (!from) return null;

  let best: (TourPlan & { miles: number; price: number }) | null = null;

  for (const contract of state.contracts) {
    // Only the first two home are paid, so a commission with both berths taken is worthless.
    if (contract.fills.length >= 2) continue;
    if (goodEmbargoed(state, contract.good)) continue;
    // A struck destination refuses the landing, which is the one step of the run that must work.
    if (depotStruck(state, contract.destination)) continue;
    if (!Number.isFinite(distanceBetween(from, contract.destination))) continue;

    for (const seller of sourcesFor(contract.good, from)) {
      if (depotStruck(state, seller)) continue;
      const out = distanceBetween(from, seller);
      const run = distanceBetween(seller, contract.destination);
      if (!Number.isFinite(out) || !Number.isFinite(run)) continue;
      // One lot has to be payable on arrival. Prices drift, so this is a guide rather than a
      // guarantee — the load step can be stepped past if the depot has moved against her.
      if (priceAt(seller, contract.good) > haulier.cash) continue;

      const miles = out + run;
      if (best && (miles > best.miles || (miles === best.miles && contract.price <= best.price))) continue;
      best = {
        vehicleId: vehicle.id,
        contractId: contract.id,
        good: contract.good,
        loadDepot: seller,
        destination: contract.destination,
        miles,
        price: contract.price,
      };
    }
  }

  if (!best) return null;
  const { vehicleId, contractId, good, loadDepot, destination } = best;
  return { vehicleId, contractId, good, loadDepot, destination };
}

/* -------------------------------------------------------------------------------------------- */
/* Small readers over live state                                                                  */
/* -------------------------------------------------------------------------------------------- */

const heading = (vehicle: Vehicle | null): DepotId | null => (vehicle ? destinationOf(vehicle) : null);

/** She is there, or she is on her way there — together, what "this course is behind us" means. */
const boundFor = (vehicle: Vehicle | null, depot: DepotId): boolean =>
  !!vehicle && (vehicle.location === depot || heading(vehicle) === depot);

const lotsOf = (vehicle: Vehicle | null, good: GoodId): number =>
  vehicle ? vehicle.hold.filter(lot => lot.good === good).length : 0;

const contractOf = (state: GameState, id: ContractId): Contract | null =>
  state.contracts.find(c => c.id === id) ?? null;

/** The commission is spent for this haulier: landed by her, or both berths gone. */
const commissionClosed = (state: GameState, haulier: Haulier, id: ContractId): boolean => {
  const contract = contractOf(state, id);
  if (!contract) return true;
  return contract.fills.length >= 2 || contract.fills.some(f => f.haulierId === haulier.id);
};

/** Whichever turn-bar button is live. Null while a rival is taking their turn. */
const turnBarTarget = (v: TourView): string | null => {
  if (v.haulier.id !== v.state.hauliers[v.state.activeIndex]?.id) return null;
  if (v.state.phase === 'roll') return 'roll-button';
  if (v.state.phase === 'act') return 'end-turn-button';
  return null;
};

const isMyTurn = (v: TourView): boolean => v.haulier.id === v.state.hauliers[v.state.activeIndex]?.id;

/**
 * Wrap a step whose control lives in the Orders panel or the counting house.
 *
 * Every one of those is driven by `canAct`, which is false until the fleet has rolled — and a
 * vehicle arrives at the *end* of a turn, so the step after her arrival is reached with the next
 * day's roll still pending. Unwrapped, the run spent those turns pointing at a dead button, and
 * the vehicle sat on the bay while the rivals played the game out around her.
 *
 * So: point at the roll first, and say why. The wrapped step's own completion is untouched —
 * rolling is not what finishes it, it is what makes finishing it possible.
 */
function depotside(step: TourStep): TourStep {
  return {
    ...step,
    target: (v, plan) => {
      if (!isMyTurn(v)) return null;
      if (v.state.phase === 'roll') return 'roll-button';
      return step.target(v, plan);
    },
    body: (v, plan) => {
      if (!isMyTurn(v)) return 'The other hauliers are taking their turns. I will wait.';
      if (v.state.phase === 'roll') {
        return 'Roll for the day first — nothing at the depot can be touched until the fleet has its miles. Then we carry on where we left off.';
      }
      return step.body(v, plan);
    },
  };
}

/* -------------------------------------------------------------------------------------------- */
/* The steps                                                                                      */
/* -------------------------------------------------------------------------------------------- */

const INTRO: TourStep = {
  title: 'One run, start to finish',
  body: (_v, plan) =>
    `I will point at one control at a time and wait while you use it. This is your real game — the load, the money and the commission are all yours to keep. ` +
    `We are going after ${goodName(plan.good)} for ${depotName(plan.destination)}, by way of ${depotName(plan.loadDepot)}, which is where it can be had. Skip at any time.`,
  target: () => null,
  isComplete: () => false,
};

const ROLL: TourStep = {
  title: 'Roll for the day',
  body: () =>
    'Nothing moves until you roll. Every vehicle gets her own two dice and those are her miles for the day — roll for the fleet.',
  target: () => 'roll-button',
  isComplete: v => v.state.phase !== 'roll',
};

const PICK_COMMISSION: TourStep = {
  title: 'Take the commission',
  body: (_v, plan) =>
    `On the commissions board, click ${goodName(plan.good)} wanted at ${depotName(plan.destination)}. ` +
    `Clicking one draws its route on the map and shows where the cargo can be bought — the card names the buyer, never the supplier, so sourcing is your decision and it is where this game is won.`,
  target: (_v, plan) => `contract-card-${plan.contractId}`,
  isComplete: (v, plan, memory) =>
    memory.pickedCommission ||
    v.focusedContract?.id === plan.contractId ||
    lotsOf(v.vehicle, plan.good) > 0 ||
    boundFor(v.vehicle, plan.loadDepot),
};

const COURSE_TO_SELLER: TourStep = {
  title: 'Set a course for the cargo',
  body: (_v, plan) =>
    `Nothing is loaded where she stands. ${depotName(plan.loadDepot)} stocks ${goodName(plan.good)}. ` +
    `Click ${depotName(plan.loadDepot)} — in the depot ledger under the map, or on the map itself — to lay off a route for her.`,
  target: (_v, plan) => `ledger-depot-${plan.loadDepot}`,
  isComplete: (v, plan) => v.targetDepot === plan.loadDepot || boundFor(v.vehicle, plan.loadDepot),
};

const SET_OFF_TO_SELLER: TourStep = {
  title: 'Set off',
  body: (_v, plan) =>
    `Commit her to it. She spends today's miles towards ${depotName(plan.loadDepot)} and carries on tomorrow — a vehicle already on the road drives the moment you roll, and you do not steer her again.`,
  target: () => 'set-off-button',
  isComplete: (v, plan) => boundFor(v.vehicle, plan.loadDepot),
};

const DRIVE_TO_SELLER: TourStep = {
  title: 'Run her up there',
  body: (v, plan) =>
    v.state.phase === 'roll'
      ? `Roll, and she drives. Keep rolling and ending turns until she pulls into ${depotName(plan.loadDepot)}.`
      : `End the turn. I will wait until she makes ${depotName(plan.loadDepot)}.`,
  target: turnBarTarget,
  isComplete: (v, plan) => v.vehicle?.location === plan.loadDepot,
};

const LOAD: TourStep = {
  title: 'Load her up',
  body: (v, plan) =>
    `Buy a lot of ${goodName(plan.good)} here — ${money(priceAt(plan.loadDepot, plan.good))} a lot. ` +
    `Her bay takes ${slotsOf(v.vehicle?.vehicleClass)} lots in all.`,
  target: (_v, plan) => `load-cargo-${plan.good}`,
  isComplete: (v, plan) => lotsOf(v.vehicle, plan.good) > 0,
};

const FILL: TourStep = {
  title: 'Fill the bay',
  body: (_v, plan) =>
    `Three lots of the same good landed together are paid three times over, and the diesel costs the same whether she runs full or half empty. ` +
    `Take another lot of ${goodName(plan.good)} if you can — ${money(priceAt(plan.loadDepot, plan.good))} more. Running her full on one cargo is usually the strongest move in the game.`,
  target: (_v, plan) => `load-cargo-${plan.good}`,
  isComplete: (v, plan) => {
    const lots = lotsOf(v.vehicle, plan.good);
    if (lots >= 3) return true;
    // Bay full of something else, or no money for another lot: nothing more to teach here, and
    // waiting on an action she cannot take is how a guided run becomes a cage.
    if (v.vehicle && v.vehicle.hold.length >= slotsOf(v.vehicle.vehicleClass)) return true;
    if (lots >= 1 && v.haulier.cash < priceAt(plan.loadDepot, plan.good)) return true;
    return lots >= 2;
  },
};

const COURSE_TO_BUYER: TourStep = {
  title: 'Set a course for the buyer',
  body: (_v, plan) =>
    `She is loaded. Click ${depotName(plan.destination)} to lay off the route that pays — the map will draw it.`,
  target: (_v, plan) => `ledger-depot-${plan.destination}`,
  isComplete: (v, plan) => v.targetDepot === plan.destination || boundFor(v.vehicle, plan.destination),
};

const SET_OFF_TO_BUYER: TourStep = {
  title: 'Set off for the buyer',
  body: (_v, plan) =>
    `Send her. Remember what the race actually is: first vehicle home on this commission takes ${PAYOUT_MULTIPLIERS[1]}× the price a lot, second takes ${PAYOUT_MULTIPLIERS[2]}×, and everybody after that takes nothing at all.`,
  target: () => 'set-off-button',
  isComplete: (v, plan) => boundFor(v.vehicle, plan.destination),
};

const DRIVE_TO_BUYER: TourStep = {
  title: 'Run her home',
  body: (v, plan) =>
    v.state.phase === 'roll'
      ? `Roll, and keep rolling. ${depotName(plan.destination)} is the target — I will wait.`
      : `End the turn, and keep going until she pulls into ${depotName(plan.destination)}.`,
  target: turnBarTarget,
  isComplete: (v, plan) => v.vehicle?.location === plan.destination,
};

const LAND: TourStep = {
  title: 'Land the load',
  body: (v, plan) => {
    const contract = contractOf(v.state, plan.contractId);
    if (!contract) {
      return `The commission came off the board while you were driving — it happens. Sell the cargo at the depot instead, or hold it for the next card that wants it, and I will carry on.`;
    }
    if (contract.fills.length >= 2) {
      return `Both berths went to other hauliers while you were on the road. That is the game, and it is why speed is worth more than margin here. Sell it at the depot or keep it for the next commission, and we will move on.`;
    }
    const rank = contract.fills.length + 1;
    return `Land her. Every matching slot goes at once and is paid per lot — you are ${rank === 1 ? 'first home' : 'second home'}, at ${PAYOUT_MULTIPLIERS[rank as 1 | 2]}× ${money(contract.price)} a lot.`;
  },
  target: (_v, plan) => `land-contract-${plan.contractId}`,
  // Landed, beaten to both berths, or the cargo went some other way once she was on the bay. The
  // last clause is anchored to her being *at* the destination: an empty bay on its own is the
  // state she starts in, and would read as a finished step before she had driven anywhere.
  isComplete: (v, plan) =>
    commissionClosed(v.state, v.haulier, plan.contractId) ||
    (v.vehicle?.location === plan.destination && lotsOf(v.vehicle, plan.good) === 0),
};

const BUY_SHARE: TourStep = {
  title: 'Turn the money into shares',
  body: () =>
    `Cash does not win this. In the counting house, buy a share of your own company — hold ${SHARE_MAJORITY} of them, declare, and still be standing at the close, and the company is yours.`,
  target: () => 'buy-share-button',
  isComplete: (v, _plan, memory) => v.haulier.shares > memory.shares,
};

const OUTRO: TourStep = {
  title: 'That is the loop',
  body: () =>
    `Source it, run it, land it first, buy shares with what it made. Everything else — loans, the aero kit, a tracker against the thieves, a hostile bid for somebody else's shares — is a way of doing that loop faster than the haulier next to you. Most of it lives in the counting house. Off you go.`,
  target: () => null,
  isComplete: () => false,
};

function buildSteps(): TourStep[] {
  // Unlike The Tea Race, the sourcing leg is unconditional: the home depot stocks nothing, so
  // there is no version of this game where the first load is bought where she is parked.
  return [
    INTRO,
    ROLL,
    PICK_COMMISSION,
    COURSE_TO_SELLER,
    depotside(SET_OFF_TO_SELLER),
    DRIVE_TO_SELLER,
    depotside(LOAD),
    depotside(FILL),
    COURSE_TO_BUYER,
    depotside(SET_OFF_TO_BUYER),
    DRIVE_TO_BUYER,
    depotside(LAND),
    depotside(BUY_SHARE),
    OUTRO,
  ];
}

/* -------------------------------------------------------------------------------------------- */
/* Placement                                                                                      */
/* -------------------------------------------------------------------------------------------- */

/**
 * Track where the spotlit element actually is.
 *
 * Polled rather than observed: targets appear, disappear and move as panels re-render, and no one
 * listener catches all of it. A quarter-second tick is invisible to a player and cheap beside the
 * game's own renders.
 *
 * The scroll is one-shot and instant. One-shot so the run does not fight a player who has
 * deliberately scrolled elsewhere; instant because a smooth scroll leaves the element moving for
 * a few hundred milliseconds after it is measured, and the ring visibly lands in the wrong place
 * and then slides onto the control.
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
      if (!scrolledOnce && (r.top < 0 || r.bottom > window.innerHeight)) {
        el.scrollIntoView({ block: 'center', behavior: 'auto' });
        scrolledOnce = true;
        setRect(el.getBoundingClientRect());
        return;
      }
      setRect(r);
    };
    measure();
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
 * Where to open.
 *
 * A *prefix* scan — walk forward from the first real step and stop at the first one not done —
 * rather than "find any incomplete step". Predicates are only required to be honest about the
 * state they are actually reached in, and several read true before the run has begun. A prefix
 * scan never consults those, because it has already stopped at "she has not rolled".
 *
 * Stopping on the very first real step means nothing has happened yet, so it opens on the welcome
 * card instead.
 */
function firstIncompleteStep(steps: TourStep[], v: TourView, plan: TourPlan, memory: TourMemory): number {
  const last = steps.length - 1; // the outro, which never completes
  let i = 1;
  while (i < last && steps[i].isComplete(v, plan, memory)) i++;
  return i === 1 ? 0 : i;
}

/* -------------------------------------------------------------------------------------------- */
/* The component                                                                                  */
/* -------------------------------------------------------------------------------------------- */

interface Props {
  view: TourView;
  plan: TourPlan;
  onFinish: () => void;
  /**
   * Draw nothing this render, but stay mounted. Set while one of the game's own modals owns the
   * display. It is a prop rather than the caller unmounting the run because the run's place in
   * the walk lives in this component: unmounting throws away both the captured memory and the
   * step index, and the card comes back at step one, so the run loops and never reaches its last
   * step. Thrash Margin hit this on its end-of-turn dispatch; here it is the same structure.
   */
  hidden?: boolean;
}

export default function GuidedTour({ view, plan, onFinish, hidden = false }: Props) {
  // `useRef`, not `useState`: writing to it must not itself cause a render.
  const memoryRef = useRef<TourMemory>({ shares: view.haulier.shares, pickedCommission: false });
  const memory = memoryRef.current;

  const steps = useMemo(() => buildSteps(), []);
  const [stepIndex, setStepIndex] = useState(() => firstIncompleteStep(steps, view, plan, memory));

  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const isManual = step === INTRO || step === OUTRO;
  // Nothing to measure while hidden, so the 250ms poll cannot scroll the board under a modal.
  const targetId = hidden ? null : step.target(view, plan);
  const rect = useTargetRect(targetId);

  // Declared *before* the advance effect below, and relied on for that: effects run in the order
  // they are declared, so the latch is set on the same commit as the player's click, and the
  // advance effect that follows reads it as already set.
  useEffect(() => {
    if (view.focusedContract?.id === plan.contractId) memory.pickedCommission = true;
  }, [view.focusedContract, plan.contractId, memory]);

  // Advance once the game itself says the step is done. The pause lets the player see the result
  // of what they just did before the card moves on.
  useEffect(() => {
    if (isManual) return;
    if (!step.isComplete(view, plan, memory)) return;
    const t = setTimeout(() => setStepIndex(i => Math.min(i + 1, steps.length - 1)), 650);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, stepIndex]);

  // Every hook above this line, so the run keeps advancing while it is out of sight.
  if (hidden) return null;

  const PADDING = 8;
  const spotlight: React.CSSProperties | null = rect
    ? {
        position: 'fixed',
        zIndex: 61,
        left: rect.left - PADDING,
        top: rect.top - PADDING,
        width: rect.width + PADDING * 2,
        height: rect.height + PADDING * 2,
        borderRadius: 3,
        border: `2px solid ${UI.brass}`,
        boxShadow: `0 0 0 9999px ${SCRIM}`,
        pointerEvents: 'none',
        transition: 'all 0.2s ease',
      }
    : null;

  // Close enough to decide which side of the target has room; the card's real height varies with
  // the length of the body copy, and pixel-exactness buys nothing.
  const CARD_HEIGHT_ESTIMATE = 200;
  const CARD_WIDTH = 21 * 16;
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
        top: Math.max(16, window.innerHeight / 2 - CARD_HEIGHT_ESTIMATE / 2),
        left: Math.max(16, window.innerWidth / 2 - CARD_WIDTH / 2),
      };

  const finish = () => {
    markGuidedTourSeen();
    onFinish();
  };

  return (
    <>
      {/* No target to spotlight (a bookend, or a rival mid-turn): dim the whole board instead, so
          the card still reads as the thing being spoken to. */}
      {!rect && <div style={{ position: 'fixed', inset: 0, zIndex: 61, background: SCRIM, pointerEvents: 'none' }} />}
      {spotlight && <div style={spotlight} />}

      {/* `data-tour-*` is how an automated pass drives the run: it reads which control the card is
          pointing at and clicks that, rather than guessing from the copy. */}
      <div style={cardStyle} data-tour-step={String(stepIndex)} data-tour-target={targetId ?? ''}>
        <p style={stepLabel}>
          Guided run — {stepIndex + 1} of {steps.length}
        </p>
        <h3 style={cardTitle}>{step.title}</h3>
        <p style={cardBody}>{step.body(view, plan)}</p>
        <div style={footer}>
          <button type="button" style={ghostButton} onClick={finish}>
            {isLast ? 'Close' : 'Skip the run'}
          </button>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {!isFirst && (
              <button type="button" style={plainButton} onClick={() => setStepIndex(i => Math.max(0, i - 1))}>
                Back
              </button>
            )}
            <button
              type="button"
              style={isManual ? primaryButton : plainButton}
              onClick={() => (isLast ? finish() : setStepIndex(i => Math.min(i + 1, steps.length - 1)))}
            >
              {isLast ? 'Finish' : isManual ? 'Start' : 'Skip this'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Chrome                                                                                         */
/* -------------------------------------------------------------------------------------------- */

const SCRIM = 'rgba(8, 12, 16, 0.74)';

const CARD: React.CSSProperties = {
  position: 'fixed',
  zIndex: 62,
  width: '21rem',
  maxWidth: 'calc(100vw - 2rem)',
  boxSizing: 'border-box',
  background: UI.panelRaised,
  border: `1px solid ${UI.brass}`,
  boxShadow: '0 10px 44px rgba(0,0,0,0.62)',
  padding: '1rem 1.1rem 0.9rem',
  fontFamily: FONT.body,
  color: UI.text,
  transition: 'top 0.2s ease, left 0.2s ease',
};

const stepLabel: React.CSSProperties = {
  fontFamily: FONT.data,
  fontSize: '0.6rem',
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: UI.textFaint,
  margin: '0 0 0.4rem',
};

const cardTitle: React.CSSProperties = {
  fontFamily: FONT.display,
  fontSize: '1.05rem',
  color: UI.brass,
  margin: '0 0 0.5rem',
};

const cardBody: React.CSSProperties = {
  fontSize: '0.84rem',
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

// The full `border` shorthand is set on every variant rather than overriding `borderColor` on a
// base: mixing a shorthand and a longhand for the same property across renders of one element is
// a real React warning, not a lint nag.
const plainButton: React.CSSProperties = {
  background: UI.panel,
  border: `1px solid ${UI.ruleStrong}`,
  borderRadius: 2,
  color: UI.text,
  padding: '0.35rem 0.65rem',
  fontFamily: 'inherit',
  fontSize: '0.76rem',
  cursor: 'pointer',
};

const primaryButton: React.CSSProperties = {
  ...plainButton,
  border: `1px solid ${UI.brass}`,
  background: UI.brass,
  color: UI.ground,
  fontWeight: 600,
};

const ghostButton: React.CSSProperties = {
  ...plainButton,
  border: '1px solid transparent',
  background: 'transparent',
  color: UI.textFaint,
  padding: '0.35rem 0.2rem',
};
