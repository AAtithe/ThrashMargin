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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  /** The haulier the run belongs to — its owner, not whoever's seat is active. In a hotseat game
   *  those differ on every other player's turn. */
  haulier: Haulier;
  /** The vehicle the run is taught on. */
  vehicle: Vehicle | null;
  /** The vehicle the Orders panel is showing. Every depot-side control acts on this one, so when it
   *  is not the run's vehicle the step has to say "select her first" rather than point at a
   *  button that would load somebody else. */
  selectedVehicleId: string | null;
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
  /**
   * Passed over, rather than shown, when it is already complete at the moment the run reaches it.
   *
   * Only for steps whose work the game can legitimately do for the player on the way in: a vehicle
   * that covers the whole leg on the day she sets off is already there, and "End the turn, I will
   * wait until she arrives" then flashed up for the 650ms advance pause and vanished — a step that
   * completed itself. Every other step stays shown even if done, so a predicate that reads true too
   * early still shows up as a card that skips past (which is what the browser harness looks for)
   * instead of being silently swallowed here.
   */
  skipIfDone?: boolean;
  /**
   * True while the step has nothing for the player to do but read: it then waits for "Carry on"
   * instead of completing on its own. For news the game delivered without being asked, which an
   * automatic advance would show for 650ms and take away again.
   */
  manual?: (v: TourView, plan: TourPlan) => boolean;
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
  /** Whose run this is. In a hotseat game the active seat changes every turn, and a run that read
   *  "the active haulier" taught the second player's turn against the first player's vehicle. */
  haulierId: string;
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
        haulierId: haulier.id,
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
  const { haulierId, vehicleId, contractId, good, loadDepot, destination } = best;
  return { haulierId, vehicleId, contractId, good, loadDepot, destination };
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

/**
 * Beaten to it: the commission is spent and she is still carrying its cargo. Read from the hold,
 * not from the card, because a landing that fills the second berth retires the card in the same
 * action (`replenishContracts` runs inside DELIVER), so "the card is gone" is also what her own
 * successful landing as second home looks like.
 */
const lostTheRace = (v: TourView, plan: TourPlan): boolean =>
  commissionClosed(v.state, v.haulier, plan.contractId) && lotsOf(v.vehicle, plan.good) > 0;

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
function depotside(step: TourStep, { perVehicle = true }: { perVehicle?: boolean } = {}): TourStep {
  return {
    ...step,
    target: (v, plan) => {
      if (!isMyTurn(v)) return null;
      if (step.manual?.(v, plan)) return step.target(v, plan);
      if (v.state.phase === 'roll') return 'roll-button';
      if (perVehicle && needsSelecting(v, plan)) return `vehicle-button-${plan.vehicleId}`;
      return step.target(v, plan);
    },
    body: (v, plan) => {
      if (!isMyTurn(v)) return 'The other hauliers are taking their turns. I will wait.';
      if (step.manual?.(v, plan)) return step.body(v, plan);
      if (v.state.phase === 'roll') {
        return 'Roll for the day first — nothing at the depot can be touched until the fleet has its miles. Then we carry on where we left off.';
      }
      if (perVehicle && needsSelecting(v, plan)) {
        return `The Orders panel is showing another vehicle. Select ${v.vehicle?.name ?? 'her'} in your fleet first — every order there goes to whichever vehicle is selected.`;
      }
      return step.body(v, plan);
    },
  };
}

/**
 * The Orders panel acts on the selected vehicle, not on the run's. A haulier with a second vehicle
 * (bought mid-run, or already owned when the run was asked for from the header) could be looking at
 * the wrong one, and the step would then ring a "Set off" or "Load" button that drives somebody
 * else — or ring nothing at all, because the other vehicle is on the road and has no such button.
 */
const needsSelecting = (v: TourView, plan: TourPlan): boolean =>
  !!v.vehicle && v.selectedVehicleId !== plan.vehicleId;

/** For the steps whose control is not depot-side: just stand down on somebody else's turn. */
function ownTurn(step: TourStep): TourStep {
  return {
    ...step,
    target: (v, plan) => (isMyTurn(v) ? step.target(v, plan) : null),
    body: (v, plan) => (isMyTurn(v) ? step.body(v, plan) : 'The other hauliers are taking their turns. I will wait.'),
  };
}

/** Laying off a course also acts on the selected vehicle, so it needs the same "select her" guard
 *  as the Orders panel, but not the roll: a course can be drawn before the dice. */
function courseStep(step: TourStep): TourStep {
  return ownTurn({
    ...step,
    target: (v, plan) => (needsSelecting(v, plan) ? `vehicle-button-${plan.vehicleId}` : step.target(v, plan)),
    body: (v, plan) =>
      needsSelecting(v, plan)
        ? `The Orders panel is showing another vehicle. Select ${v.vehicle?.name ?? 'her'} in your fleet first — a course is laid off for whichever vehicle is selected.`
        : step.body(v, plan),
  });
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
  isComplete: (v, plan) =>
    (v.targetDepot === plan.loadDepot && !needsSelecting(v, plan)) || boundFor(v.vehicle, plan.loadDepot),
};

/**
 * The "Set off" button only exists while a course to the right depot is laid off, and the course
 * is screen state the player can clear without meaning to — "Not yet", another depot, the commission
 * board, or reselecting the vehicle all reset it. Pointing at `set-off-button` regardless left the
 * card ringing nothing (or ringing a course to the wrong depot) with no way forward but Back. So the
 * step re-asks for the course whenever the course is not the one it is waiting on.
 */
function setOff(depotOf: (plan: TourPlan) => DepotId, step: TourStep): TourStep {
  return {
    ...step,
    target: (v, plan) => (v.targetDepot === depotOf(plan) ? step.target(v, plan) : `ledger-depot-${depotOf(plan)}`),
    body: (v, plan) =>
      v.targetDepot === depotOf(plan)
        ? step.body(v, plan)
        : `The course was cleared. Click ${depotName(depotOf(plan))} again to lay it off, then set off.`,
  };
}

const SET_OFF_TO_SELLER: TourStep = setOff(plan => plan.loadDepot, {
  title: 'Set off',
  body: (_v, plan) =>
    `Commit her to it. She spends today's miles towards ${depotName(plan.loadDepot)} and carries on tomorrow — a vehicle already on the road drives the moment you roll, and you do not steer her again.`,
  target: () => 'set-off-button',
  isComplete: (v, plan) => boundFor(v.vehicle, plan.loadDepot),
});

const DRIVE_TO_SELLER: TourStep = {
  title: 'Run her up there',
  body: (v, plan) =>
    v.state.phase === 'roll'
      ? `Roll, and she drives. Keep rolling and ending turns until she pulls into ${depotName(plan.loadDepot)}.`
      : `End the turn. I will wait until she makes ${depotName(plan.loadDepot)}.`,
  target: turnBarTarget,
  isComplete: (v, plan) => v.vehicle?.location === plan.loadDepot,
  skipIfDone: true,
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
  // Reached already done when the first lot filled the bay or spent the last of the money.
  skipIfDone: true,
};

const COURSE_TO_BUYER: TourStep = {
  title: 'Set a course for the buyer',
  body: (_v, plan) =>
    `She is loaded. Click ${depotName(plan.destination)} to lay off the route that pays — the map will draw it.`,
  target: (_v, plan) => `ledger-depot-${plan.destination}`,
  isComplete: (v, plan) =>
    (v.targetDepot === plan.destination && !needsSelecting(v, plan)) || boundFor(v.vehicle, plan.destination),
};

const SET_OFF_TO_BUYER: TourStep = setOff(plan => plan.destination, {
  title: 'Set off for the buyer',
  body: (_v, plan) =>
    `Send her. Remember what the race actually is: first vehicle home on this commission takes ${PAYOUT_MULTIPLIERS[1]}× the price a lot, second takes ${PAYOUT_MULTIPLIERS[2]}×, and everybody after that takes nothing at all.`,
  target: () => 'set-off-button',
  isComplete: (v, plan) => boundFor(v.vehicle, plan.destination),
});

const DRIVE_TO_BUYER: TourStep = {
  title: 'Run her home',
  body: (v, plan) =>
    v.state.phase === 'roll'
      ? `Roll, and keep rolling. ${depotName(plan.destination)} is the target — I will wait.`
      : `End the turn, and keep going until she pulls into ${depotName(plan.destination)}.`,
  target: turnBarTarget,
  isComplete: (v, plan) => v.vehicle?.location === plan.destination,
  skipIfDone: true,
};

const LAND: TourStep = {
  title: 'Land the load',
  body: (v, plan) => {
    if (lostTheRace(v, plan)) {
      // Depot sales are a rules toggle: with them off, the cargo can only be held or dumped.
      const elsewhere = v.state.hazards?.depotSales
        ? 'Sell the cargo at the depot, or hold it for the next card that wants it'
        : 'Hold the cargo for the next card that wants it';
      return `Both berths went to other hauliers while you were on the road, and the commission is off the board. That is the game, and it is why speed is worth more than margin here. ${elsewhere}, and carry on when you are ready.`;
    }
    const contract = contractOf(v.state, plan.contractId);
    // Landed (as second home the card is retired at once) or the cargo went another way: the step
    // is complete and about to move on.
    if (!contract || contract.fills.some(f => f.haulierId === v.haulier.id) || lotsOf(v.vehicle, plan.good) === 0) {
      return 'Done — the cargo is off the vehicle.';
    }
    const rank = contract.fills.length + 1;
    return `Land her. Every matching slot goes at once and is paid per lot — you are ${rank === 1 ? 'first home' : 'second home'}, at ${PAYOUT_MULTIPLIERS[rank as 1 | 2]}× ${money(contract.price)} a lot.`;
  },
  target: (v, plan) => (lostTheRace(v, plan) ? null : `land-contract-${plan.contractId}`),
  // Landed, or the cargo went some other way once she was on the bay. The last clause is anchored
  // to her being *at* the destination: an empty bay on its own is the state she starts in, and
  // would read as a finished step before she had driven anywhere.
  //
  // Beaten to both berths is *not* completion. It used to be, and since it is almost always settled
  // by rivals while she is still on the road, the step was already complete when reached: the card
  // explaining what had happened flashed up for the 650ms pause and was gone before it could be
  // read. Now it waits for "Carry on".
  isComplete: (v, plan) =>
    !!contractOf(v.state, plan.contractId)?.fills.some(f => f.haulierId === v.haulier.id) ||
    (v.vehicle?.location === plan.destination && lotsOf(v.vehicle, plan.good) === 0),
  manual: lostTheRace,
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
    ownTurn(ROLL),
    ownTurn(PICK_COMMISSION),
    courseStep(COURSE_TO_SELLER),
    depotside(SET_OFF_TO_SELLER),
    ownTurn(DRIVE_TO_SELLER),
    depotside(LOAD),
    depotside(FILL),
    courseStep(COURSE_TO_BUYER),
    depotside(SET_OFF_TO_BUYER),
    ownTurn(DRIVE_TO_BUYER),
    depotside(LAND),
    // The counting house is the haulier's, not a vehicle's: no need to select her first.
    depotside(BUY_SHARE, { perVehicle: false }),
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
function useTargetRect(targetId: string | null, stepIndex: number): DOMRect | null {
  // The rect remembers which target and step it was measured for, so the first render of a new
  // step never lays its card out against the previous step's box (one painted frame, which put The
  // Tea Race's closing card off the bottom of the screen).
  const key = `${targetId ?? ''}|${stepIndex}`;
  const [measured, setMeasured] = useState<{ key: string; rect: DOMRect | null }>({ key, rect: null });
  const setRect = (rect: DOMRect | null) => setMeasured({ key, rect });

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
      // In the DOM but not laid out: ringing it would draw a box in the corner of the screen.
      if (r.width === 0 && r.height === 0) {
        setRect(null);
        return;
      }
      if (!scrolledOnce && (r.top < 0 || r.bottom > window.innerHeight)) {
        el.scrollIntoView({ block: 'center', behavior: 'auto' });
        scrolledOnce = true;
      }
      setRect(visibleRectOf(el));
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
    // Keyed on the step as well as the id. "Load her up" and "Fill the bay" ring the same button,
    // and the Orders panel reflows between them, so keyed on the id alone the second step had
    // already spent its one scroll and left the button half under the bottom edge of a phone.
  }, [targetId, stepIndex]);

  return measured.key === key ? measured.rect : null;
}

/**
 * The part of an element a player can actually see: its box cut down by every ancestor that clips
 * its overflow, and by the window. Ringing the raw box of a control taller than the screen, or one
 * a player has scrolled half out of view, drew the spotlight off the page and parked the card on
 * top of the very thing it pointed at. Returns null when nothing of it is visible.
 */
function visibleRectOf(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect();
  let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p);
    if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
    const c = p.getBoundingClientRect();
    left = Math.max(left, c.left);
    top = Math.max(top, c.top);
    right = Math.min(right, c.right);
    bottom = Math.min(bottom, c.bottom);
  }
  left = Math.max(left, 0);
  top = Math.max(top, 0);
  right = Math.min(right, window.innerWidth);
  bottom = Math.min(bottom, window.innerHeight);
  if (right - left < 4 || bottom - top < 4) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * Where the card goes: below the target, then above, then to the right, then to the left — the
 * first that fits on screen without covering it. Placed from the card's *measured* height: the
 * fixed 200px estimate this replaced is short of the real card on a phone (the body copy wraps to
 * eight lines), so "above" put the card's bottom edge over the control it was pointing at. A target
 * too big for any side gets the card in whichever screen corner overlaps it least.
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
    { left: W - M - w, top: H - M - cardH },
    { left: M, top: H - M - cardH },
    { left: W - M - w, top: M },
    { left: M, top: M },
  ];
  return corners.reduce((best, c) => (overlap(c.left, c.top) < overlap(best.left, best.top) ? c : best));
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
   * Told which element the card is pointing at, whenever that changes, so the screen can open the
   * panel it sits in. The panels slide away over the chart, and a ring round a control in a closed
   * panel would point at nothing.
   */
  onTargetChange?: (targetId: string | null) => void;
  /**
   * Draw nothing this render, but stay mounted. Set while one of the game's own modals owns the
   * display. It is a prop rather than the caller unmounting the run because the run's place in
   * the walk lives in this component: unmounting throws away both the captured memory and the
   * step index, and the card comes back at step one, so the run loops and never reaches its last
   * step. Thrash Margin hit this on its end-of-turn dispatch; here it is the same structure.
   */
  hidden?: boolean;
}

export default function GuidedTour({ view, plan, onFinish, onTargetChange, hidden = false }: Props) {
  // `useRef`, not `useState`: writing to it must not itself cause a render.
  const memoryRef = useRef<TourMemory>({ shares: view.haulier.shares, pickedCommission: false });
  const memory = memoryRef.current;

  const steps = useMemo(() => buildSteps(), []);
  const [stepIndex, setStepIndex] = useState(() => firstIncompleteStep(steps, view, plan, memory));

  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const isManual = step === INTRO || step === OUTRO || !!step.manual?.(view, plan);
  // Nothing to measure while hidden, so the 250ms poll cannot scroll the board under a modal.
  const targetId = hidden ? null : step.target(view, plan);
  const rect = useTargetRect(targetId, stepIndex);
  // Tell the screen which control is ringed, so it can open the panel that holds it.
  useEffect(() => {
    onTargetChange?.(targetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  // Declared *before* the advance effect below, and relied on for that: effects run in the order
  // they are declared, so the latch is set on the same commit as the player's click, and the
  // advance effect that follows reads it as already set.
  useEffect(() => {
    if (view.focusedContract?.id === plan.contractId) memory.pickedCommission = true;
  }, [view.focusedContract, plan.contractId, memory]);

  // Advance once the game itself says the step is done. The pause lets the player see the result
  // of what they just did before the card moves on.
  //
  // Keyed on the *answer*, not on `view`. `view` is a fresh object on every render of the game
  // screen, so keying on it restarted the 650ms pause on every click: a player who arrived and then
  // rolled and ended turns at a brisk pace never let it elapse, and the card went on saying "end
  // the turn, I will wait until she arrives" for as long as they kept playing.
  //
  // The step after is skipped when it is marked `skipIfDone` and the game has already done it (see
  // TourStep). Read through a ref at the moment the pause ends, so it judges the state the player
  // will actually see, not the one from the click that started the pause.
  const done = !isManual && step.isComplete(view, plan, memory);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [skipped, setSkipped] = useState<number[]>([]);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => {
      const last = steps.length - 1;
      let next = Math.min(stepIndex + 1, last);
      const passed: number[] = [];
      while (next < last && steps[next].skipIfDone && steps[next].isComplete(viewRef.current, plan, memory)) {
        passed.push(next);
        next++;
      }
      if (passed.length) setSkipped(prev => [...prev, ...passed.filter(k => !prev.includes(k))]);
      setStepIndex(next);
    }, 650);
    return () => clearTimeout(t);
  }, [done, stepIndex, steps, plan, memory]);

  const PADDING = 8;
  // The ring's padding is kept on screen too: a control at the very edge of the window otherwise
  // had its ring drawn past the edge, so it read as pointing at something below the fold.
  const ringBox = rect
    ? (() => {
        const l = Math.max(2, rect.left - PADDING), t = Math.max(2, rect.top - PADDING);
        const r = Math.min(window.innerWidth - 2, rect.right + PADDING);
        const b = Math.min(window.innerHeight - 2, rect.bottom + PADDING);
        return { left: l, top: t, width: r - l, height: b - t };
      })()
    : null;
  const spotlight: React.CSSProperties | null = ringBox
    ? {
        position: 'fixed',
        zIndex: 61,
        ...ringBox,
        borderRadius: 3,
        border: `2px solid ${UI.brass}`,
        boxShadow: `0 0 0 9999px ${SCRIM}`,
        pointerEvents: 'none',
        transition: 'all 0.2s ease',
      }
    : null;

  // The card's height varies with the body copy and the viewport width, so it is measured after
  // each render, before the browser paints (a layout effect), so a card coming back from being
  // hidden for a replay is never drawn for a frame at the previous card's height.
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(220);
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardHeight) > 2) setCardHeight(h);
  });
  const CARD_WIDTH = 21 * 16;
  const cardStyle: React.CSSProperties = rect
    ? { ...CARD, ...placeCard(rect, CARD_WIDTH, cardHeight) }
    : {
        ...CARD,
        top: Math.max(16, window.innerHeight / 2 - cardHeight / 2),
        left: Math.max(16, window.innerWidth / 2 - Math.min(CARD_WIDTH, window.innerWidth - 32) / 2),
      };
  // The card glides between positions only once it has been on screen at this step. A new step (or
  // the card coming back after being hidden for a replay) is placed where it belongs at once:
  // sliding in from the previous card's spot, the closing card started in the corner the End turn
  // card had used and, being taller, hung off the bottom of the window until the slide caught up.
  const glideKey = `${stepIndex}|${hidden}`;
  const [settledKey, setSettledKey] = useState<string | null>(null);
  useEffect(() => {
    if (settledKey === glideKey) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setSettledKey(glideKey));
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [glideKey, settledKey]);
  if (settledKey !== glideKey) cardStyle.transition = 'none';

  const finish = () => {
    markGuidedTourSeen();
    onFinish();
  };

  // Every hook is above this line: one placed after an early return renders conditionally.
  if (hidden) return null;

  return (
    <>
      {/* No target to spotlight (a bookend, or a rival mid-turn): dim the whole board instead, so
          the card still reads as the thing being spoken to. */}
      {!rect && <div style={{ position: 'fixed', inset: 0, zIndex: 61, background: SCRIM, pointerEvents: 'none' }} />}
      {spotlight && <div style={spotlight} />}

      {/* `data-tour-*` is how an automated pass drives the run: it reads which control the card is
          pointing at and clicks that, rather than guessing from the copy, and `data-tour-skipped`
          lists the steps passed over as already done, so it can check each had a reason. */}
      <div
        ref={cardRef}
        style={cardStyle}
        data-tour-step={String(stepIndex)}
        data-tour-target={targetId ?? ''}
        data-tour-skipped={skipped.join(',')}
        data-tour-manual={isManual ? '1' : ''}
      >
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
              {isLast ? 'Finish' : isFirst ? 'Start' : isManual ? 'Carry on' : 'Skip this'}
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
