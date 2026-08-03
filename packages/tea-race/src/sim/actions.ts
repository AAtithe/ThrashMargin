/**
 * The reducer. `processAction(state, action)` is the only way state ever changes.
 *
 * Two conventions the rest of the codebase leans on:
 *
 *  1. An illegal action returns the SAME object it was given (reference equality, not a copy).
 *     The AI loop uses that to detect a rejected move and stop rather than spin, and the UI uses
 *     it to leave React state untouched.
 *  2. Nothing here calls Math.random or reads a clock. Dice come from `rng.ts` against
 *     `state.rngSeed`; timestamps are passed in at creation.
 */
import { GOOD_BY_ID, HOME_PORT, goodName, portDemands, portName, portSupplies } from './content';
import { drawContract, faceUpKeys, isContractComplete, nextRank } from './contracts';
import { destinationOf, plotCourse, pointsToDestination, sail } from './movement';
import { roll2d6 } from './rng';
import {
  canBuyOut,
  DECLARATION_ROUNDS,
  LOG_LIMIT,
  MAX_SHIPS,
  PAYOUT_MULTIPLIERS,
  SHARE_BUYBACK_FRACTION,
  SHARE_MAJORITY,
  SHARE_PRICE,
  SHARE_RAID_MULTIPLIER,
  SHIP_NAMES,
  SHIP_PRICE,
  VICTORY_CASH,
} from './rules';
import { activeCaptain, isHotseat, shipsOf } from './state';
import { nextAiAction } from './ai';
import type {
  Captain,
  ContractFill,
  GameAction,
  GameState,
  LogEntry,
  LogKind,
  Ship,
} from './types';

const money = (n: number) => `£${n.toLocaleString('en-GB')}`;

function log(
  s: GameState,
  kind: LogKind,
  text: string,
  captainId: string | null = null,
  data?: Record<string, string | number>,
): GameState {
  const entry: LogEntry = { seq: s.nextLogSeq, turn: s.turn, round: s.round, captainId, kind, text };
  if (data) entry.data = data;
  const next = [...s.log, entry];
  return {
    ...s,
    nextLogSeq: s.nextLogSeq + 1,
    log: next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next,
  };
}

const replaceShip = (s: GameState, ship: Ship): GameState => ({
  ...s,
  ships: s.ships.map(x => (x.id === ship.id ? ship : x)),
});

const updateCaptain = (s: GameState, id: string, patch: Partial<Captain>): GameState => ({
  ...s,
  captains: s.captains.map(c => (c.id === id ? { ...c, ...patch } : c)),
});

/** The active captain's ship, or null if the id is unknown, not theirs, or the phase is wrong. */
function ownShip(s: GameState, shipId: string): Ship | null {
  if (s.phase !== 'act') return null;
  const ship = s.ships.find(x => x.id === shipId);
  if (!ship) return null;
  return ship.ownerId === activeCaptain(s).id ? ship : null;
}

// ---------------------------------------------------------------------------
// Contract replacement
// ---------------------------------------------------------------------------

/** Retires any spent card and deals its replacement, keeping the five distinct. */
function replenishContracts(state: GameState): GameState {
  let s = state;
  for (const contract of s.contracts) {
    if (!isContractComplete(contract)) continue;
    const drawn = drawContract(s.rngSeed, s.deck, s.nextContractSeq, faceUpKeys(s.contracts));
    s = {
      ...s,
      rngSeed: drawn.seed,
      deck: drawn.deck,
      nextContractSeq: drawn.seq,
      contracts: s.contracts.map(c => (c.id === contract.id ? drawn.contract : c)),
    };
    s = log(
      s,
      'contract',
      `New commission posted: ${goodName(drawn.contract.good)}, ${portName(
        drawn.contract.source,
      )} to ${portName(drawn.contract.destination)}, ${money(drawn.contract.price)} a lot.`,
    );
  }
  return s;
}

// ---------------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------------

function resolveDeclaration(state: GameState): GameState {
  const d = state.declaration;
  if (!d) return state;
  const captain = state.captains.find(c => c.id === d.captainId);
  if (!captain) return { ...state, declaration: null };

  const ships = shipsOf(state, captain.id).length;
  const holdsMajority = captain.shares >= SHARE_MAJORITY;
  const holdsCash = captain.cash >= VICTORY_CASH;

  if (holdsMajority && holdsCash && ships >= 1) {
    let s: GameState = { ...state, declaration: null, winnerId: captain.id, phase: 'over' };
    return log(
      s,
      'victory',
      `${captain.name} carries the company: ${captain.shares} shares, ${money(
        captain.cash,
      )} in hand and ${ships} ship${ships === 1 ? '' : 's'} still afloat.`,
      captain.id,
    );
  }

  const missing: string[] = [];
  if (!holdsMajority) missing.push(`only ${captain.shares} shares`);
  if (!holdsCash) missing.push(`only ${money(captain.cash)} in hand`);
  if (ships < 1) missing.push('no ship afloat');
  return log(
    { ...state, declaration: null },
    'lapse',
    `${captain.name}'s claim lapses — ${missing.join(', ')}. Trading continues.`,
    captain.id,
  );
}

/** Moves to the next seat, handling the round roll-over and the declaration countdown. */
function advanceSeat(state: GameState): GameState {
  let s: GameState = { ...state, sailPoints: {}, dice: {}, turn: state.turn + 1, phase: 'roll' };

  const nextIndex = (s.activeIndex + 1) % s.captains.length;
  s = { ...s, activeIndex: nextIndex };

  if (nextIndex === 0) {
    s = { ...s, round: s.round + 1 };
    if (s.declaration) {
      const remaining = s.declaration.roundsRemaining - 1;
      s = { ...s, declaration: { ...s.declaration, roundsRemaining: remaining } };
      if (remaining <= 0) s = resolveDeclaration(s);
    }
  }
  return s;
}

/**
 * Plays one computer captain's whole turn, then hands the seat on. Exported because an all-AI
 * table (scripts/drive.ts) drives turns explicitly rather than relying on END_TURN's auto-run,
 * which only fires when there is a human waiting.
 *
 * `observe` is called after every action the captain takes. A whole AI turn is otherwise atomic
 * from the outside, which hides anything that happens and reverses within it — notably a card
 * taking both its fills in one turn, so that it is retired before any per-turn check could see it.
 */
export function runAiTurn(
  state: GameState,
  observe?: (s: GameState, action: GameAction) => void,
): GameState {
  if (state.phase === 'over') return state;
  const roll: GameAction = { type: 'ROLL' };
  let s = processAction(state, roll);
  observe?.(s, roll);

  // Bounded: a mis-scoring AI that keeps proposing the same rejected move must not wedge the game.
  for (let guard = 0; guard < 40; guard++) {
    const action = nextAiAction(s);
    if (!action || action.type === 'END_TURN') break;
    const after = processAction(s, action);
    if (after === s) break; // rejected — stop rather than spin
    s = after;
    observe?.(s, action);
  }
  return advanceSeat(s);
}

function endTurn(state: GameState): GameState {
  let s = advanceSeat(state);
  const hasHuman = s.captains.some(c => c.kind === 'human');

  if (hasHuman) {
    let guard = 0;
    while (s.phase !== 'over' && activeCaptain(s).kind === 'ai' && guard++ < s.captains.length) {
      s = runAiTurn(s);
    }
  }

  if (s.phase !== 'over' && isHotseat(s)) s = { ...s, phase: 'handover' };
  return s;
}

// ---------------------------------------------------------------------------
// Individual actions
// ---------------------------------------------------------------------------

function doRoll(state: GameState): GameState {
  if (state.phase !== 'roll') return state;
  const captain = activeCaptain(state);
  let s: GameState = { ...state, phase: 'act' };

  const sailPoints: Record<string, number> = {};
  const dice: Record<string, [number, number]> = {};
  let seed = s.rngSeed;

  for (const ship of shipsOf(s, captain.id)) {
    const r = roll2d6(seed);
    seed = r.seed;
    sailPoints[ship.id] = r.total;
    dice[ship.id] = r.dice;
  }
  s = { ...s, rngSeed: seed, sailPoints, dice };

  const rolls = Object.entries(dice)
    .map(([id, d]) => `${s.ships.find(x => x.id === id)?.name}: ${d[0]}+${d[1]}`)
    .join(', ');
  s = log(s, 'roll', `${captain.name} takes the wind — ${rolls}.`, captain.id);

  // Ships already at sea have no decision to make; advance them now.
  for (const ship of shipsOf(s, captain.id)) {
    if (!ship.voyage) continue;
    const points = s.sailPoints[ship.id] ?? 0;
    const outcome = sail(ship, points);
    s = replaceShip(s, outcome.ship);
    // Tying up forfeits the rest of the roll — you cannot bank the wind and set off again.
    const left = outcome.arrivedAt ? 0 : points - outcome.spent;
    s = { ...s, sailPoints: { ...s.sailPoints, [ship.id]: left } };
    if (outcome.arrivedAt) {
      s = log(s, 'arrive', `${ship.name} ties up at ${portName(outcome.arrivedAt)}.`, captain.id);
    } else if (outcome.spent > 0) {
      const dest = destinationOf(outcome.ship);
      s = log(
        s,
        'sail',
        `${ship.name} makes ${outcome.spent} points, ${pointsToDestination(
          outcome.ship,
        )} still to run to ${dest ? portName(dest) : 'her destination'}.`,
        captain.id,
      );
    }
  }
  return s;
}

function doSailTo(state: GameState, shipId: string, destination: string): GameState {
  const ship = ownShip(state, shipId);
  if (!ship || ship.location === null) return state;
  if (ship.location === destination) return state;

  const plotted = plotCourse(ship, destination);
  if (!plotted) return state;

  const captain = activeCaptain(state);
  const points = state.sailPoints[ship.id] ?? 0;
  const outcome = sail(plotted, points);

  let s = replaceShip(state, outcome.ship);
  // Tying up forfeits the rest of the roll — see doRoll.
  const left = outcome.arrivedAt ? 0 : points - outcome.spent;
  s = { ...s, sailPoints: { ...s.sailPoints, [ship.id]: left } };

  if (outcome.arrivedAt) {
    s = log(
      s,
      'arrive',
      `${ship.name} runs to ${portName(outcome.arrivedAt)} and ties up.`,
      captain.id,
    );
  } else {
    s = log(
      s,
      'sail',
      `${ship.name} clears ${portName(ship.location)} for ${portName(destination)}${
        outcome.passed.length ? ` by way of ${outcome.passed.map(portName).join(', ')}` : ''
      }.`,
      captain.id,
    );
  }
  return s;
}

function doBuyCargo(state: GameState, shipId: string, good: string): GameState {
  const ship = ownShip(state, shipId);
  if (!ship || ship.location === null || ship.cargo) return state;
  if (!portSupplies(ship.location, good)) return state;

  const captain = activeCaptain(state);
  const price = GOOD_BY_ID[good]?.basePrice;
  if (price === undefined || captain.cash < price) return state;

  let s = updateCaptain(state, captain.id, { cash: captain.cash - price });
  s = replaceShip(s, {
    ...ship,
    cargo: { good, paid: price, boughtAt: ship.location, boughtOnTurn: s.turn },
  });
  return log(
    s,
    'buy',
    `${ship.name} loads ${goodName(good)} at ${portName(ship.location)} for ${money(price)}.`,
    captain.id,
  );
}

function doDeliver(state: GameState, shipId: string, contractId: string): GameState {
  const ship = ownShip(state, shipId);
  if (!ship || ship.location === null || !ship.cargo) return state;

  const contract = state.contracts.find(c => c.id === contractId);
  if (!contract) return state;
  if (contract.destination !== ship.location) return state;
  if (contract.good !== ship.cargo.good) return state;

  const rank = nextRank(contract);
  if (rank === null) return state;

  const captain = activeCaptain(state);
  // "Four times the purchase price" — what this captain actually paid, not the card's face value.
  const payout = ship.cargo.paid * PAYOUT_MULTIPLIERS[rank];
  const fill: ContractFill = { captainId: captain.id, rank, paid: payout, onTurn: state.turn };

  let s = updateCaptain(state, captain.id, { cash: captain.cash + payout });
  s = replaceShip(s, { ...ship, cargo: null });
  s = {
    ...s,
    contracts: s.contracts.map(c => (c.id === contract.id ? { ...c, fills: [...c.fills, fill] } : c)),
  };
  s = log(
    s,
    'deliver',
    `${ship.name} lands ${goodName(contract.good)} at ${portName(contract.destination)} — ${
      rank === 1 ? 'first home' : 'second home'
    }, ${PAYOUT_MULTIPLIERS[rank]}x, ${money(payout)}.`,
    captain.id,
    {
      contractId: contract.id,
      good: contract.good,
      rank,
      payout,
      purchasePrice: ship.cargo.paid,
      cardPrice: contract.price,
    },
  );
  return replenishContracts(s);
}

function doSellLocal(state: GameState, shipId: string): GameState {
  const ship = ownShip(state, shipId);
  if (!ship || ship.location === null || !ship.cargo) return state;
  if (!portDemands(ship.location, ship.cargo.good)) return state;

  const captain = activeCaptain(state);
  const proceeds = Math.floor(ship.cargo.paid / 2);
  const cargoName = goodName(ship.cargo.good);

  let s = updateCaptain(state, captain.id, { cash: captain.cash + proceeds });
  s = replaceShip(s, { ...ship, cargo: null });
  return log(
    s,
    'missed',
    `${ship.name} clears her hold of ${cargoName} at ${portName(
      ship.location,
    )} for ${money(proceeds)} — half what it cost.`,
    captain.id,
  );
}

function doBuyShip(state: GameState): GameState {
  if (state.phase !== 'act') return state;
  const captain = activeCaptain(state);
  const owned = shipsOf(state, captain.id);
  if (owned.length >= MAX_SHIPS) return state;
  if (captain.cash < SHIP_PRICE) return state;

  const ship: Ship = {
    id: `s${state.nextShipSeq}`,
    ownerId: captain.id,
    name: SHIP_NAMES[(state.nextShipSeq - 1) % SHIP_NAMES.length],
    // She is bought from the yard at home and fits out there, wherever her owner happens to be.
    location: HOME_PORT,
    voyage: null,
    cargo: null,
  };

  let s: GameState = {
    ...state,
    ships: [...state.ships, ship],
    nextShipSeq: state.nextShipSeq + 1,
  };
  s = updateCaptain(s, captain.id, { cash: captain.cash - SHIP_PRICE });
  return log(
    s,
    'ship',
    `${captain.name} buys ${ship.name} for ${money(SHIP_PRICE)}; she fits out at ${portName(
      HOME_PORT,
    )}.`,
    captain.id,
  );
}

function doBuyShare(state: GameState): GameState {
  if (state.phase !== 'act') return state;
  const captain = activeCaptain(state);

  if (state.sharesRemaining > 0) {
    if (captain.cash < SHARE_PRICE) return state;
    let s: GameState = { ...state, sharesRemaining: state.sharesRemaining - 1 };
    s = updateCaptain(s, captain.id, {
      cash: captain.cash - SHARE_PRICE,
      shares: captain.shares + 1,
    });
    return log(
      s,
      'share',
      `${captain.name} takes up a share for ${money(SHARE_PRICE)} — ${
        captain.shares + 1
      } held, ${s.sharesRemaining} left with the bank.`,
      captain.id,
    );
  }

  // Bank empty: a forced buy-out of the SMALLEST outside stake. Smallest, not largest — see
  // SHARE_RAID_MULTIPLIER for why. Buying out the smallest holder strictly reduces the number of
  // captains holding shares, so the issue always concentrates and a majority is always eventually
  // reached; buying out the largest oscillates forever and leaves the game with no ending.
  const seller = state.captains
    .filter(c => c.id !== captain.id && c.shares > 0 && canBuyOut(captain.shares, c.shares))
    .sort((a, b) => a.shares - b.shares || state.captains.indexOf(a) - state.captains.indexOf(b))[0];
  if (!seller) return state;

  const price = SHARE_PRICE * SHARE_RAID_MULTIPLIER;
  if (captain.cash < price) return state;

  let s = updateCaptain(state, captain.id, {
    cash: captain.cash - price,
    shares: captain.shares + 1,
  });
  s = updateCaptain(s, seller.id, { cash: seller.cash + price, shares: seller.shares - 1 });
  return log(
    s,
    'share',
    `${captain.name} buys a share off ${seller.name} on the exchange for ${money(price)} — ${
      captain.shares + 1
    } against ${seller.shares - 1}.`,
    captain.id,
  );
}

function doSellShare(state: GameState): GameState {
  if (state.phase !== 'act') return state;
  const captain = activeCaptain(state);
  if (captain.shares <= 0) return state;

  const proceeds = Math.floor(SHARE_PRICE * SHARE_BUYBACK_FRACTION);
  let s: GameState = { ...state, sharesRemaining: state.sharesRemaining + 1 };
  s = updateCaptain(s, captain.id, {
    cash: captain.cash + proceeds,
    shares: captain.shares - 1,
  });
  return log(
    s,
    'share',
    `${captain.name} surrenders a share to the bank for ${money(proceeds)} — ${
      captain.shares - 1
    } held. A poor price, but it buys a cargo.`,
    captain.id,
  );
}

function doDeclare(state: GameState): GameState {
  if (state.phase !== 'act' || state.declaration) return state;
  const captain = activeCaptain(state);
  if (captain.shares < SHARE_MAJORITY) return state;

  const s: GameState = {
    ...state,
    declaration: {
      captainId: captain.id,
      declaredOnRound: state.round,
      roundsRemaining: DECLARATION_ROUNDS,
    },
  };
  return log(
    s,
    'declare',
    `${captain.name} declares a majority — ${captain.shares} of the ten. The company is wound up in ${DECLARATION_ROUNDS} rounds; ${money(
      VICTORY_CASH,
    )} and a ship must still be in hand.`,
    captain.id,
  );
}

// ---------------------------------------------------------------------------

export function processAction(state: GameState, action: GameAction): GameState {
  if (state.phase === 'over') return state;

  if (action.type === 'ACKNOWLEDGE_HANDOVER') {
    return state.phase === 'handover' ? { ...state, phase: 'roll' } : state;
  }
  if (state.phase === 'handover') return state;

  switch (action.type) {
    case 'ROLL':
      return doRoll(state);
    case 'SAIL_TO':
      return doSailTo(state, action.shipId, action.destination);
    case 'BUY_CARGO':
      return doBuyCargo(state, action.shipId, action.good);
    case 'DELIVER':
      return doDeliver(state, action.shipId, action.contractId);
    case 'SELL_LOCAL':
      return doSellLocal(state, action.shipId);
    case 'BUY_SHIP':
      return doBuyShip(state);
    case 'BUY_SHARE':
      return doBuyShare(state);
    case 'SELL_SHARE':
      return doSellShare(state);
    case 'DECLARE':
      return doDeclare(state);
    case 'END_TURN':
      // Rolling is not optional — ending a turn without it would silently skip the wind.
      return state.phase === 'act' ? endTurn(state) : state;
    default:
      return state;
  }
}
