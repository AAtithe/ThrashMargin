/**
 * A guided first run, played on the real game.
 *
 * This is not a slideshow and not a sandbox. It spotlights a control in the live UI, waits for the
 * player to actually use it, and moves on when the game state says they did. Everything they do in
 * it counts — the cargo is real cargo, the commission is a real commission, the money is theirs.
 * That is the whole point: a player who finishes this tour has not watched a demonstration of the
 * loop, they have run it once, from an empty hold to a landed commission to a share bought with
 * the proceeds.
 *
 * ## Why the route is computed rather than scripted
 *
 * Banco di Niccolò's tour (`packages/niccolo/src/components/GuidedTour.tsx`) hardcodes its first
 * hop — Bruges to Antwerp with cloth — because that campaign starts from one fixed city with one
 * fixed market. This game cannot do that. Liverpool supplies exactly one good (cloth), the five
 * face-up commissions are dealt at random from nineteen goods, and a commission names a *buyer*,
 * never a seller. So on most new games there is no commission the home port can load for, and a
 * scripted "buy cloth here" step would be telling the player to do the wrong thing.
 *
 * `planFirstRun` therefore picks the run at the moment the tour starts: every live commission,
 * against every port that sells its good, scored on total distance and filtered by what the
 * captain can actually afford. The step list is then *built from that plan* — the three
 * sail-to-the-seller steps appear only when the cargo has to be fetched from somewhere else,
 * which is the usual case and also the lesson (sourcing is the player's decision, and it is where
 * the game is won).
 *
 * ## What the predicates have to tolerate
 *
 * Every step's `isComplete` is read against live state on every render, and the tour recomputes
 * where to resume whenever it is remounted. Two consequences, both learned the hard way in the
 * Niccolò tour:
 *
 * - **Transient UI state cannot be the only evidence.** "Lay off a course" is satisfied by
 *   `targetPort`, which clears the moment she casts off. A predicate reading only that would send
 *   a resumed tour back to a step the player finished three moves ago, so each one also accepts
 *   the downstream proof (she is heading there, or she is already there).
 * - **The narrative bookends never complete.** The intro and outro return `false` for ever, so
 *   "resume at the first incomplete step" has to ignore them when deciding whether this is a
 *   fresh start or a resume.
 *
 * Unlike the Niccolò tour, every step here can be stepped past by hand. A tour that waits on an
 * action the player cannot afford — a second lot of cargo, a share — is worse than no tour, and
 * the predicates cannot anticipate every way a game can go sideways while four rivals are sailing.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { distanceBetween, goodName, portName, sourcesFor } from '../sim/content';
import { destinationOf } from '../sim/movement';
import { HOLD_SLOTS, PAYOUT_MULTIPLIERS, SHARE_MAJORITY, slotsOf } from '../sim/rules';
import { FONT, UI, money } from '../theme';
import type { Captain, Contract, ContractId, GameState, GoodId, PortId, Ship, ShipId } from '../sim/types';

const TOUR_SEEN_KEY = 'tea_race_tour_seen';

/** Whether this browser has finished or skipped the tour before. A UI preference, not game state,
 *  so it lives in localStorage rather than in the save. */
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

/** Everything a step needs to know, assembled by `GameScreen` from state plus its own selection. */
export interface TourView {
  state: GameState;
  /** The captain whose run this is (`plan.captainId`) — not the active seat, which in a hot-seat
   *  game is somebody else every other turn. */
  captain: Captain;
  /** The ship the tour is following — the captain's first, and on a new game her only one. */
  ship: Ship | null;
  targetPort: PortId | null;
  focusedContract: Contract | null;
  /** The ship the Orders panel is showing. Every order there, and every course laid off, goes to
   *  this ship — which is not necessarily the run's once the captain owns a second hull. */
  selectedShipId: string | null;
  /** What this quay charges for a good, which depends on the ruleset in play. */
  priceFor: (port: PortId, good: GoodId) => number;
}

interface TourStep {
  title: string;
  body: (v: TourView, plan: TourPlan) => string;
  /** The element to spotlight, resolved per render: targets move as the game moves (the turn bar
   *  swaps the roll button for the end-turn button, the Load block vanishes when the hold fills). */
  target: (v: TourView, plan: TourPlan) => string | null;
  isComplete: (v: TourView, plan: TourPlan, memory: TourMemory) => boolean;
  /**
   * A step that only waits — it asks for nothing the player has not already done — and so is
   * passed over, unseen, when it is already complete at the moment the tour would open it.
   *
   * The sail steps are the case. Casting off spends this turn's points at once, so a short leg
   * ends at the quay in the same click, and "Sail her there — end the turn, I will wait" was then
   * shown already satisfied and snatched away 650ms later: a card that completes itself, which
   * reads as the tour skipping something. "Fill the hull" carries it too, for when the first lot
   * filled the hold or spent the cash. Only steps with nothing left to ask may carry this flag; on
   * a step that still asks for an action it would hide a predicate that is true too early.
   */
  passWhenReachedDone?: boolean;
  /**
   * When this returns a label, the step is waiting on nothing but the player having read it: the
   * card's own button carries the label, in the primary style, and pressing it moves on. Used where
   * the game has taken the action away from the player, so that the explanation stays up until it
   * has been read instead of flashing past on a predicate that is already true.
   */
  acknowledge?: (v: TourView, plan: TourPlan) => string | null;
}

/**
 * What the tour remembers for itself: a starting value to measure change against, and one latch.
 *
 * The latch is not an optimisation. The commissions board's own click handler *toggles* focus, so
 * a player who clicks the card twice — or clicks it, looks at another, and comes back — would
 * otherwise watch a finished step come undone. A step that can un-complete itself is a step the
 * tour can get stuck on, so "they have picked it up" is recorded once and kept.
 */
interface TourMemory {
  shares: number;
  pickedCommission: boolean;
}

/* -------------------------------------------------------------------------------------------- */
/* The plan                                                                                       */
/* -------------------------------------------------------------------------------------------- */

export interface TourPlan {
  /** Whose run this is. In a hot-seat game the active captain changes every turn, and a tour that
   *  read "the captain" off the active seat followed whoever was holding the mouse: it pointed the
   *  second player at the first player's steps, and counted their share purchases as the lesson. */
  captainId: string;
  /** The ship the run is taught on. Held by id, not by reference, so a captain who buys a second
   *  ship mid-tour does not quietly change which hull the steps are talking about. */
  shipId: ShipId;
  contractId: ContractId;
  good: GoodId;
  /** Where the cargo is bought. Equal to the ship's starting port when she is lucky. */
  loadPort: PortId;
  /** Where the commission is landed. */
  destination: PortId;
  /** True when the cargo has to be fetched from another port first. */
  needsSourcingLeg: boolean;
}

/**
 * Choose the run to teach: the cheapest round of "fetch it, carry it, land it" the captain can
 * actually pay for from where she is standing.
 *
 * Scored on sail distance rather than on profit, deliberately. The tour's job is to get the player
 * through one complete loop while they still have the patience for it, and a 40-point voyage to
 * Canton for a better price teaches the same four verbs as an 8-point run to Lisbon, three turns
 * slower. The commission price is used only to break ties.
 *
 * Returns null when nothing is affordable or nothing is reachable — the caller treats that as
 * "this game is not a sensible one to start a tour on" rather than starting a tour that cannot be
 * finished.
 */
export function planFirstRun(
  state: GameState,
  captain: Captain,
  ship: Ship,
  priceFor: (port: PortId, good: GoodId) => number,
): TourPlan | null {
  const from = ship.location;
  if (!from) return null;

  let best: (TourPlan & { cost: number; price: number }) | null = null;


  for (const contract of state.contracts) {
    // Only the first two ships home are paid, so a commission with both berths taken is worthless.
    if (contract.fills.length >= 2) continue;
    if (!Number.isFinite(distanceBetween(from, contract.destination))) continue;

    for (const seller of sourcesFor(contract.good, from)) {
      const outbound = distanceBetween(from, seller);
      const run = distanceBetween(seller, contract.destination);
      if (!Number.isFinite(outbound) || !Number.isFinite(run)) continue;
      // One lot has to be payable on arrival at the seller. Prices drift, so this is a guide, not
      // a guarantee — the load step tolerates being stepped past if the quay has moved against her.
      if (priceFor(seller, contract.good) > captain.cash) continue;

      const cost = outbound + run;
      if (best && (cost > best.cost || (cost === best.cost && contract.price <= best.price))) continue;
      best = {
        captainId: captain.id,
        shipId: ship.id,
        contractId: contract.id,
        good: contract.good,
        loadPort: seller,
        destination: contract.destination,
        needsSourcingLeg: seller !== from,
        cost,
        price: contract.price,
      };
    }
  }

  if (!best) return null;
  const { captainId, shipId, contractId, good, loadPort, destination, needsSourcingLeg } = best;
  return { captainId, shipId, contractId, good, loadPort, destination, needsSourcingLeg };
}

/* -------------------------------------------------------------------------------------------- */
/* Small readers over live state                                                                  */
/* -------------------------------------------------------------------------------------------- */

const heading = (ship: Ship | null): PortId | null => (ship ? destinationOf(ship) : null);

/** She is there, or she is on her way there. The two together are what "this step is behind us"
 *  means for anything to do with a course. */
const boundFor = (ship: Ship | null, port: PortId): boolean =>
  !!ship && (ship.location === port || heading(ship) === port);

const lotsOf = (ship: Ship | null, good: GoodId): number =>
  ship ? ship.hold.filter(lot => lot.good === good).length : 0;

const contractOf = (state: GameState, id: ContractId): Contract | null =>
  state.contracts.find(c => c.id === id) ?? null;

/** She has landed this commission. */
const landedBy = (state: GameState, captain: Captain, id: ContractId): boolean =>
  !!contractOf(state, id)?.fills.some(f => f.captainId === captain.id);

/** The commission went while she was at sea — withdrawn from the board, or both berths taken by
 *  others — and she is still carrying its cargo, so there is nothing at this quay to land it on.
 *
 *  The cargo clause is not optional. Her own second-place landing fills the card's last berth and
 *  deals its replacement inside the same action, so the card is gone the instant she has landed on
 *  it: "the card is gone" alone would read her own success as having lost the race. */
const commissionLost = (state: GameState, captain: Captain, ship: Ship | null, good: GoodId, id: ContractId): boolean => {
  if (lotsOf(ship, good) === 0) return false;
  const contract = contractOf(state, id);
  if (!contract) return true;
  return contract.fills.length >= 2 && !contract.fills.some(f => f.captainId === captain.id);
};

/** Whichever turn-bar button is live right now. Null while a rival is taking their turn. */
const turnBarTarget = (v: TourView): string | null => {
  if (v.captain.id !== v.state.captains[v.state.activeIndex]?.id) return null;
  if (v.state.phase === 'roll') return 'roll-button';
  if (v.state.phase === 'act') return 'end-turn-button';
  return null;
};

const isMyTurn = (v: TourView): boolean => v.captain.id === v.state.captains[v.state.activeIndex]?.id;

/**
 * The Orders panel acts on the selected ship, not on the run's. A captain with a second ship
 * (bought mid-run, or already owned when the run was asked for from the header) could be looking
 * at the wrong one, and the step would then ring a Load or Cast off button that sends somebody
 * else — or ring nothing, because the other ship is at sea and has no such button.
 */
const needsSelecting = (v: TourView, plan: TourPlan): boolean =>
  !!v.ship && v.selectedShipId !== plan.shipId;

const SELECT_HER = (v: TourView, what: string) =>
  `The Orders panel is showing another ship. Select ${v.ship?.name ?? 'her'} in your fleet first — ${what} goes to whichever ship is selected.`;

/**
 * Wrap a step whose control lives in the Orders panel or the counting house.
 *
 * Every one of those is driven by `canAct`, which is false until the fleet has rolled — and a ship
 * arrives at the *end* of a turn, so the step that follows her arrival is reached with the next
 * turn's roll still pending. Unwrapped, the tour spent those turns pointing at a dead button:
 * observed as "load her hold" and then "cast off for the buyer" both landing on a disabled
 * control, after which the ship sat at the quay while the rivals played the game out around her.
 *
 * So: point at the roll first, and say why. The wrapped step's own completion is untouched —
 * rolling is not what finishes it, it is what makes finishing it possible.
 */
function quayside(step: TourStep): TourStep {
  return {
    ...step,
    target: (v, plan) => {
      if (!isMyTurn(v)) return null;
      if (v.state.phase === 'roll') return 'roll-button';
      if (needsSelecting(v, plan)) return `ship-button-${plan.shipId}`;
      return step.target(v, plan);
    },
    body: (v, plan) => {
      if (!isMyTurn(v)) return 'The other captains are taking their turns. I will wait.';
      if (v.state.phase === 'roll') {
        return 'Take the wind first — nothing at the quay can be touched until the fleet has its points for the turn. Then we carry on where we left off.';
      }
      if (needsSelecting(v, plan)) return SELECT_HER(v, 'every order there');
      return step.body(v, plan);
    },
  };
}

/** Laying off a course also acts on the selected ship, so it needs the same "select her" guard as
 *  the Orders panel — but not the roll: a course can be drawn before the dice. */
function courseStep(step: TourStep): TourStep {
  return {
    ...step,
    target: (v, plan) => (needsSelecting(v, plan) ? `ship-button-${plan.shipId}` : step.target(v, plan)),
    body: (v, plan) => (needsSelecting(v, plan) ? SELECT_HER(v, 'a course') : step.body(v, plan)),
  };
}

/**
 * The Cast off button only exists while a course to the right port is laid off, and the course is
 * screen state the player can clear without meaning to — the Orders panel's clear button, another
 * port, the commissions board, or reselecting the ship all reset it. Pointing at `cast-off-button`
 * regardless left the card ringing nothing with no way forward but Back, so the step re-asks for
 * the course whenever the course drawn is not the one it is waiting on.
 */
function castOff(portOf: (plan: TourPlan) => PortId, step: TourStep): TourStep {
  // Once she is under way the course clears itself; that is the step done, not undone, and the
  // card should not flash "the course was cleared" during the pause before it moves on.
  const courseIsDrawn = (v: TourView, plan: TourPlan) =>
    v.targetPort === portOf(plan) || boundFor(v.ship, portOf(plan));
  return {
    ...step,
    target: (v, plan) => (courseIsDrawn(v, plan) ? step.target(v, plan) : `ledger-port-${portOf(plan)}`),
    body: (v, plan) =>
      courseIsDrawn(v, plan)
        ? step.body(v, plan)
        : `The course was cleared. Click ${portName(portOf(plan))} again to lay it off, then cast off.`,
  };
}

/* -------------------------------------------------------------------------------------------- */
/* The steps                                                                                      */
/* -------------------------------------------------------------------------------------------- */

const INTRO: TourStep = {
  title: 'One run, start to finish',
  body: (v, plan) =>
    `I will point at one control at a time and wait while you use it. This is your real game — the cargo, the money and the commission are all yours to keep. ` +
    `We are going after ${goodName(plan.good)} for ${portName(plan.destination)}` +
    (plan.needsSourcingLeg ? `, by way of ${portName(plan.loadPort)} where it can be had.` : `, loaded right here.`) +
    ` Skip at any time.`,
  target: () => null,
  isComplete: () => false,
};

const ROLL: TourStep = {
  title: 'Take the wind',
  body: () =>
    'Nothing moves until you roll. Every ship gets her own two dice and those are her sail points for the turn — roll for the fleet.',
  target: () => 'roll-button',
  isComplete: v => v.state.phase !== 'roll',
};

const PICK_COMMISSION: TourStep = {
  title: 'Pick up the commission',
  body: (_v, plan) =>
    `On the commissions board, click ${goodName(plan.good)} wanted at ${portName(plan.destination)}. ` +
    `Clicking one draws its course on the chart and shows where the cargo can be bought — the card names the buyer, never the seller, so sourcing is yours to decide.`,
  target: (_v, plan) => `contract-card-${plan.contractId}`,
  isComplete: (v, plan, memory) =>
    memory.pickedCommission ||
    v.focusedContract?.id === plan.contractId ||
    lotsOf(v.ship, plan.good) > 0 ||
    // Only evidence when the cargo is somewhere else: with no sourcing leg she is already
    // "bound for" the load port by standing in it, which would be true before the tour began.
    (plan.needsSourcingLeg && boundFor(v.ship, plan.loadPort)),
};

const COURSE_TO_SELLER: TourStep = {
  title: 'Lay off a course for the cargo',
  body: (_v, plan) =>
    `Nobody at your home quay sells ${goodName(plan.good)}. ${portName(plan.loadPort)} does. ` +
    `Click ${portName(plan.loadPort)} — in the port ledger under the chart, or on the chart itself — to lay off a course for her.`,
  target: (_v, plan) => `ledger-port-${plan.loadPort}`,
  isComplete: (v, plan) =>
    (v.targetPort === plan.loadPort && !needsSelecting(v, plan)) || boundFor(v.ship, plan.loadPort),
};

const CAST_OFF_TO_SELLER: TourStep = castOff(plan => plan.loadPort, {
  title: 'Cast off',
  body: (_v, plan) =>
    `Commit her to the crossing. She spends this turn's points towards ${portName(plan.loadPort)} and carries on next turn — a ship at sea sails the moment you roll, you do not steer her again.`,
  target: () => 'cast-off-button',
  isComplete: (v, plan) => boundFor(v.ship, plan.loadPort),
});

const SAIL_TO_SELLER: TourStep = {
  title: 'Sail her there',
  body: (v, plan) =>
    v.state.phase === 'roll'
      ? `Roll, and she sails. Keep rolling and ending turns until she ties up at ${portName(plan.loadPort)}.`
      : `End the turn. I will wait until she makes ${portName(plan.loadPort)}.`,
  target: turnBarTarget,
  isComplete: (v, plan) => v.ship?.location === plan.loadPort,
  passWhenReachedDone: true,
};

const LOAD: TourStep = {
  title: 'Load her hold',
  body: (v, plan) =>
    `Buy a lot of ${goodName(plan.good)} off this quay — ${money(v.priceFor(plan.loadPort, plan.good))} a lot. ` +
    `Her hold takes ${slotsOf(v.ship?.shipClass)} lots in all.`,
  target: (_v, plan) => `load-cargo-${plan.good}`,
  isComplete: (v, plan) => lotsOf(v.ship, plan.good) > 0,
};

const FILL: TourStep = {
  title: 'Fill the hull',
  body: (v, plan) =>
    `Three lots of the same good landed together are paid three times over, and the crossing costs the same whether she is full or not. ` +
    `Buy another lot of ${goodName(plan.good)} if you can — ${money(v.priceFor(plan.loadPort, plan.good))} more. Filling the hull with one cargo is usually the strongest move in the game.`,
  target: (_v, plan) => `load-cargo-${plan.good}`,
  isComplete: (v, plan) => {
    const lots = lotsOf(v.ship, plan.good);
    if (lots >= Math.min(HOLD_SLOTS, slotsOf(v.ship?.shipClass))) return true;
    // Hold full of something else, or no money for another lot: nothing more to teach here, and
    // waiting on an action she cannot take is how a tour becomes a cage.
    if (v.ship && v.ship.hold.length >= slotsOf(v.ship.shipClass)) return true;
    if (lots >= 1 && v.captain.cash < v.priceFor(plan.loadPort, plan.good)) return true;
    return lots >= 2;
  },
  // When the first lot already filled her hold or spent the last of the cash there is nothing to
  // ask, and the card would otherwise arrive complete and flash past.
  passWhenReachedDone: true,
};

const COURSE_TO_BUYER: TourStep = {
  title: 'Lay off a course for the buyer',
  body: (_v, plan) =>
    `She is loaded. Click ${portName(plan.destination)} to lay off the course that pays — the chart will draw it.`,
  target: (_v, plan) => `ledger-port-${plan.destination}`,
  isComplete: (v, plan) =>
    (v.targetPort === plan.destination && !needsSelecting(v, plan)) || boundFor(v.ship, plan.destination),
};

const CAST_OFF_TO_BUYER: TourStep = castOff(plan => plan.destination, {
  title: 'Cast off for the buyer',
  body: (_v, plan) =>
    `Send her. Remember what the race actually is: first ship home on this commission takes ${PAYOUT_MULTIPLIERS[1]}× the price a lot, second takes ${PAYOUT_MULTIPLIERS[2]}×, and everybody after that takes nothing at all.`,
  target: () => 'cast-off-button',
  isComplete: (v, plan) => boundFor(v.ship, plan.destination),
});

const SAIL_TO_BUYER: TourStep = {
  title: 'Run her home',
  body: (v, plan) =>
    v.state.phase === 'roll'
      ? `Roll, and keep rolling. ${portName(plan.destination)} is the target — I will wait.`
      : `End the turn, and keep going until she ties up at ${portName(plan.destination)}.`,
  target: turnBarTarget,
  isComplete: (v, plan) => v.ship?.location === plan.destination,
  passWhenReachedDone: true,
};

const LAND: TourStep = {
  title: 'Land the cargo',
  body: (v, plan) => {
    const contract = contractOf(v.state, plan.contractId);
    const instead = v.state.hazards?.quaysideSales
      ? 'Sell the cargo off the quay if you like, or keep it for the next card that wants it'
      : 'Keep the cargo for the next card that wants it — there are no quayside sales in this ruleset';
    if (commissionLost(v.state, v.captain, v.ship, plan.good, plan.contractId)) {
      // A card whose second berth is filled is replaced in the same action, so "gone from the
      // board" usually means rivals filled it, not that it lapsed; the log is the only record.
      const filledByOthers =
        v.state.log.filter(
          e => e.kind === 'deliver' && e.data?.contractId === plan.contractId && e.captainId !== v.captain.id,
        ).length >= 2;
      return contract || filledByOthers
        ? `Both berths went to other captains while you were at sea. That is the game, and it is why speed is worth more than price here. ${instead}, and we will move on.`
        : `The commission was withdrawn from the board while you sailed — it happens. ${instead}, and we will carry on.`;
    }
    // Gone with her cargo ashore: she took the last berth herself, and the card went with it.
    if (!contract) return `Landed — and that filled the card's last berth, so it has left the board.`;
    const rank = contract.fills.length + 1;
    return `Land her. Every matching slot goes at once and is paid per lot — you are ${rank === 1 ? 'first home' : 'second home'}, at ${PAYOUT_MULTIPLIERS[rank as 1 | 2]}× ${money(contract.price)} a lot.`;
  },
  target: (v, plan) => (commissionLost(v.state, v.captain, v.ship, plan.good, plan.contractId) ? null : `land-contract-${plan.contractId}`),
  // Landed, or the cargo went some other way once she was alongside (sold, or over the side). The
  // last clause is anchored to her being *at* the destination: an empty hold on its own is the
  // state she starts the tour in, and would read as a finished step before she had sailed.
  //
  // Losing the commission while at sea is deliberately *not* completion. It used to be, and the
  // step then arrived already done: the "both berths went to other captains" explanation — the
  // one card in the run that tells the player what happened to their cargo — was shown for the
  // 650ms pause and replaced. It now waits for the player to read it and press Carry on.
  isComplete: (v, plan) =>
    landedBy(v.state, v.captain, plan.contractId) ||
    (v.ship?.location === plan.destination && lotsOf(v.ship, plan.good) === 0),
  acknowledge: (v, plan) => (commissionLost(v.state, v.captain, v.ship, plan.good, plan.contractId) ? 'Carry on' : null),
};

const BUY_SHARE: TourStep = {
  title: 'Turn the money into shares',
  body: () =>
    `Cash does not win this. In the counting house, buy a share of your own company — carry ${SHARE_MAJORITY} of them, declare, and hold the line to the close, and the company is yours.`,
  target: () => 'buy-share-button',
  isComplete: (v, _plan, memory) => v.captain.shares > memory.shares,
};

const OUTRO: TourStep = {
  title: 'That is the loop',
  body: () =>
    `Source it, carry it, land it first, buy shares with what it made. Everything else in the game — loans, agents, copper on her bottom, guns against the pirates, a hostile bid for somebody else's shares — is a way of doing that loop faster than the captain next to you. The counting house is where most of it lives. Off you go.`,
  target: () => null,
  isComplete: () => false,
};

function buildSteps(plan: TourPlan): TourStep[] {
  return [
    INTRO,
    ROLL,
    PICK_COMMISSION,
    ...(plan.needsSourcingLeg ? [courseStep(COURSE_TO_SELLER), quayside(CAST_OFF_TO_SELLER), SAIL_TO_SELLER] : []),
    quayside(LOAD),
    quayside(FILL),
    courseStep(COURSE_TO_BUYER),
    quayside(CAST_OFF_TO_BUYER),
    SAIL_TO_BUYER,
    quayside(LAND),
    quayside(BUY_SHARE),
    OUTRO,
  ];
}

/* -------------------------------------------------------------------------------------------- */
/* Placement                                                                                      */
/* -------------------------------------------------------------------------------------------- */

/**
 * Track where the spotlit element actually is on screen.
 *
 * Polled rather than observed: targets appear, disappear and move as panels re-render and the
 * player scrolls, and no single listener catches all of it. A quarter-second tick is invisible to
 * a player and cheap next to the game's own renders.
 *
 * The one-shot scroll is deliberate. A target inside the action column can start off-screen, so
 * the column is scrolled to it once — and then never again, so the tour does not fight a player
 * who has deliberately scrolled somewhere else.
 */
function useTargetRect(targetId: string | null, stepIndex: number): DOMRect | null {
  // The rect remembers which target and step it was measured for. Held as a bare rect, the first
  // render of a new step still carried the previous step's box until the effect below cleared it:
  // one painted frame of the closing card laid out against the End turn button at the foot of the
  // screen, and, being taller than the estimate, running off the bottom of it.
  const key = `${targetId ?? ''}|${stepIndex}`;
  const [measured, setMeasured] = useState<{ key: string; rect: DOMRect | null }>({ key, rect: null });
  const setRect = (rect: DOMRect | null) => setMeasured({ key, rect });

  useEffect(() => {
    if (!targetId) {
      setRect(null);
      return;
    }
    let scrolledOnce = false;
    let unblockedOnce = false;
    const measure = () => {
      const el = document.getElementById(targetId);
      if (!el) {
        setRect(null);
        return;
      }
      const raw = el.getBoundingClientRect();
      if (!scrolledOnce && (raw.top < 0 || raw.bottom > window.innerHeight)) {
        // Instant, never smooth. A smooth scroll leaves the element moving for a few hundred
        // milliseconds after it is measured, and the ring visibly lands in the wrong place and
        // then slides onto the control — measured drift of up to 275px on the steps that scroll.
        // An instant scroll settles synchronously, so the rect taken straight afterwards is the
        // one the player sees.
        el.scrollIntoView({ block: 'center', behavior: 'auto' });
        scrolledOnce = true;
      } else if (!unblockedOnce && isObscured(el)) {
        // On screen but under something fixed — on a phone, the event-card stack in the bottom
        // corner routinely sat over the port the card was asking for, so the player's tap
        // dismissed a news card instead. Centre it once, clear of the stack; once only, for the
        // same reason as above.
        el.scrollIntoView({ block: 'center', behavior: 'auto' });
        unblockedOnce = true;
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
    // Keyed on the step as well as the id. "Load her hold" and "Fill the hull" ring the same
    // button and the Orders panel reflows between them; keyed on the id alone the second step had
    // already spent its one scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, stepIndex]);

  return measured.key === key ? measured.rect : null;
}

/**
 * The part of an element a player can actually see: its box cut down by every ancestor that clips
 * its overflow, and by the window. Ringing the raw box drew the spotlight off the top of the
 * screen whenever the target was partly scrolled away (observed on a phone, on the roll button).
 * Null when nothing of it is visible, which dims the whole board rather than ringing nothing.
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

/** Whether something other than the tour's own card sits over the middle of the element. The ring
 *  and scrim take no pointer events, so hit-testing passes straight through them. */
function isObscured(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
  const hit = document.elementFromPoint(x, y);
  if (!hit || el.contains(hit)) return false;
  return !hit.closest('[data-tour-step]');
}

/**
 * Where the card goes: below the target, then above, then to the right, then to the left — the
 * first that fits on screen without covering it. A target too big for any of those gets the card
 * in whichever screen corner overlaps it least. Placement used to be decided against a fixed
 * 200px height estimate while the real card ran to ~225px, so "above" overlapped the top of the
 * commission it pointed at and "below" ran off the bottom of the window.
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

/**
 * Where to open.
 *
 * A *prefix* scan — walk forward from the first real step and stop at the first one that is not
 * done — rather than "find any incomplete step". The difference matters: predicates are only
 * required to be honest about the state they are actually reached in, and several of them read
 * true before the run has begun (nobody has landed this commission yet, so "the commission is
 * not open to me" is trivially false, and so on). Searching the whole list consults those; a
 * prefix scan never gets to them, because it has already stopped at "she has not rolled".
 *
 * Stopping on the very first real step means nothing has happened yet, which is a fresh tour, so
 * it opens on the welcome card instead.
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
  const memoryRef = useRef<TourMemory>({ shares: view.captain.shares, pickedCommission: false });
  const memory = memoryRef.current;

  const steps = useMemo(() => buildSteps(plan), [plan]);
  const [stepIndex, setStepIndex] = useState(() => firstIncompleteStep(steps, view, plan, memory));

  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const isManual = step === INTRO || step === OUTRO;
  const ackLabel = step.acknowledge?.(view, plan) ?? null;
  // Off the owner's turn (another human at a hot-seat table) there is nothing of hers to point at,
  // and the turn bar belongs to somebody else: stand aside entirely — no scrim over the other
  // player's board — and do not advance on their moves.
  const waiting = !isMyTurn(view);
  const done = !isManual && !waiting && step.isComplete(view, plan, memory);

  // During the pause after a step completes, the card keeps pointing where it pointed and saying
  // what it said while the step was live. Targets and copy are computed from live state, and the
  // state that completes a step can also re-aim it: rolling is what brings a ship in on "Sail her
  // there", and the same roll turns the ringed roll button into End the turn — so for 650ms a
  // finished step rang End the turn and said "End the turn, I will wait", and a player quick
  // enough to obey threw away the turn she had just arrived on, with her points still unspent.
  // Written during render, deliberately: it is the last live answer, not state anything renders from.
  const live = useRef<{ stepIndex: number; target: string | null; body: string } | null>(null);
  // Nothing to measure while hidden, so the 250ms poll cannot scroll the board under a modal.
  const liveTarget = waiting || hidden ? null : step.target(view, plan);
  if (!done) live.current = { stepIndex, target: liveTarget, body: step.body(view, plan) };
  const held = done && live.current?.stepIndex === stepIndex ? live.current : null;
  const targetId = held ? held.target : liveTarget;
  const bodyText = held ? held.body : step.body(view, plan);
  const rect = useTargetRect(targetId, stepIndex);
  // Tell the screen which control is ringed, so it can open the panel that holds it.
  useEffect(() => {
    onTargetChange?.(targetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  // Declared *before* the advance effect below, and relied on for that: effects run in the order
  // they are declared, so the latch is set on the same commit in which the player's click landed,
  // and the advance effect that follows reads it as already set.
  useEffect(() => {
    if (view.focusedContract?.id === plan.contractId) memory.pickedCommission = true;
  }, [view.focusedContract, plan.contractId, memory]);

  // Advance once the game itself says the step is done. The pause is so the player sees the result
  // of what they just did before the card moves on.
  //
  // Keyed on the *answer*, not on `view`: `view` is a fresh object on every render of the game
  // screen, so keying on it restarted the 650ms pause on every render, and a player clicking
  // briskly could keep a finished step on screen indefinitely.
  //
  // The step after is read against the view as it stands when the pause ends (hence the ref), and
  // a waiting step that is already satisfied is passed over rather than shown — see
  // `passWhenReachedDone`. The indices passed over are published on the card for automated runs,
  // which otherwise could not tell a step skipped by design from one that never appeared.
  const viewRef = useRef(view);
  viewRef.current = view;
  const [passedOver, setPassedOver] = useState<number[]>([]);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => {
      const last = steps.length - 1;
      let next = Math.min(stepIndex + 1, last);
      const passed: number[] = [];
      while (next < last && steps[next].passWhenReachedDone && steps[next].isComplete(viewRef.current, plan, memory)) {
        passed.push(next);
        next++;
      }
      if (passed.length) setPassedOver(p => [...p, ...passed.filter(i => !p.includes(i))]);
      setStepIndex(next);
    }, 650);
    return () => clearTimeout(t);
  }, [done, stepIndex, steps, plan, memory]);

  const PADDING = 8;
  // The padding is kept on screen too, or a control at the very edge has its ring drawn past it.
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

  // The card's height varies with the body copy, so it is measured after each render, before the
  // browser paints (a layout effect): measured after paint, a card that came back from being
  // hidden for a replay was drawn for a frame at the previous card's height.
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
  if (hidden || waiting) return null;

  return (
    <>
      {/* No target to spotlight (a bookend, or a rival is mid-turn): dim the whole board instead,
          so the card still reads as the thing being spoken to. */}
      {!rect && <div style={{ position: 'fixed', inset: 0, zIndex: 61, background: SCRIM, pointerEvents: 'none' }} />}
      {spotlight && <div style={spotlight} />}

      {/* `data-tour-*` is how an automated pass drives the tour: it reads which control the card
          is pointing at and clicks that, rather than guessing from the copy. */}
      <div
        ref={cardRef}
        style={cardStyle}
        data-tour-step={String(stepIndex)}
        data-tour-target={targetId ?? ''}
        data-tour-passed={passedOver.join(',')}
        data-tour-done={done ? '1' : undefined}
      >
        <p style={stepLabel}>
          Guided run — {stepIndex + 1} of {steps.length}
          {done ? ' · done' : ''}
        </p>
        <h3 style={cardTitle}>{step.title}</h3>
        <p style={cardBody}>{bodyText}</p>
        <div style={footer}>
          <button type="button" style={ghostButton} onClick={finish}>
            {isLast ? 'Close' : 'Skip the tour'}
          </button>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {!isFirst && (
              <button type="button" style={plainButton} onClick={() => setStepIndex(i => Math.max(0, i - 1))}>
                Back
              </button>
            )}
            <button
              type="button"
              style={isManual || ackLabel ? primaryButton : plainButton}
              onClick={() => (isLast ? finish() : setStepIndex(i => Math.min(i + 1, steps.length - 1)))}
            >
              {isLast ? 'Finish' : isManual ? 'Start' : ackLabel ?? 'Skip this'}
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
// base: mixing a shorthand and a longhand for the same property across renders of one element is a
// real React warning, not a lint nag.
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
