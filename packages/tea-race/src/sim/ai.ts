/**
 * Computer captains.
 *
 * Deliberately "reduced fidelity", the same modelling level Niccolo's AI houses use: the AI plays
 * the real rules through the real reducer, but reasons with a single greedy score rather than any
 * lookahead. It is an opponent to race, not a solver.
 *
 * The engine calls `nextAiAction` repeatedly and applies whatever comes back until it returns null
 * or the reducer rejects a move (see the reference-equality convention in actions.ts). Everything
 * here is therefore a pure function of the current state — no memory between calls, which means
 * every proposal must make progress or the loop would just re-propose it. The guard in
 * `runAiTurn` bounds that, but relying on the guard would show up as a captain who wastes turns.
 */
import { distanceBetween, portDemands, portSupplies, GOODS, GOOD_BY_ID, PORT_BY_ID } from './content';
import { payoutFor } from './contracts';
import {
  canBuyOut,
  MAX_SHIPS,
  SHARE_MAJORITY,
  SHARE_PRICE,
  SHARE_RAID_MULTIPLIER,
  SHIP_PRICE,
  VICTORY_CASH,
} from './rules';
import { activeCaptain, shipsOf } from './state';
import type { AiProfile, Captain, Contract, GameAction, GameState, Ship } from './types';

/** Average of 2d6 — used to turn sail points into an estimate of turns. */
const POINTS_PER_TURN = 7;

/**
 * Cash a computer captain will never spend on shares or ships, whatever its temperament.
 *
 * Without a hard floor the harness produced a captain sitting on a winning majority of six shares
 * and £10 — too little to buy the cheapest lot on any quay, so no way to ever earn the £750 the
 * win also requires. She sailed in circles for 370 rounds. SELL_SHARE now exists as the way back
 * out of that hole, but not falling in beats climbing out: this is roughly two mid-value lots.
 */
const TRADING_FLOAT = 130;

interface Temperament {
  /** Cash kept back rather than spent on shares. */
  shareReserve: number;
  /** Cash kept back rather than spent on a new ship. */
  shipReserve: number;
  /** Below this score, an empty ship will load something on spec rather than chase a contract. */
  speculateBelow: number;
  /** Turns a lot may sit unwanted before it is dumped at half price. */
  patience: number;
}

const TEMPERAMENTS: Record<AiProfile, Temperament> = {
  // Chases the cards. Buys ships early, shares late.
  racer: { shareReserve: 260, shipReserve: 140, speculateBelow: 0, patience: 10 },
  // Will load a valuable good with no card against it and wait for one to turn up.
  speculator: { shareReserve: 220, shipReserve: 260, speculateBelow: 26, patience: 6 },
  // Treats the ships as a means to shares.
  financier: { shareReserve: 60, shipReserve: 420, speculateBelow: 0, patience: 8 },
};

const temperamentOf = (c: Captain): Temperament => TEMPERAMENTS[c.aiProfile ?? 'racer'];

const turnsFor = (points: number) => Math.max(1, points / POINTS_PER_TURN);

const liveContracts = (s: GameState): Contract[] => s.contracts.filter(c => c.fills.length < 2);

/** The cheapest lot on any quay. Below this a captain literally cannot trade. */
const CHEAPEST_LOT = Math.min(...GOODS.map(g => g.basePrice));

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface Run {
  contract: Contract;
  /** Profit per turn, the only number the AI actually ranks on. */
  score: number;
}

/**
 * How many rival ships are already carrying this card's good and are closer to its destination.
 *
 * Without this the AI chases races it has visibly lost, buys the cargo anyway, arrives to find the
 * card spent, and dumps the lot at half price. The harness measured that directly: before this
 * check, computer captains dumped cargo more often than they landed it (185 SELL_LOCAL against 132
 * DELIVER in a single game). Only the first two ships home are paid, so a run with two rivals
 * already ahead is worth nothing and should not be started.
 */
function rivalsAhead(s: GameState, contract: Contract, mine: string, myDistance: number): number {
  let ahead = 0;
  for (const ship of s.ships) {
    if (ship.ownerId === mine) continue;
    if (ship.cargo?.good !== contract.good) continue;
    const from = ship.location ?? ship.voyage?.route[ship.voyage.route.length - 1];
    if (!from) continue;
    if (distanceBetween(from, contract.destination) < myDistance) ahead++;
  }
  return ahead;
}

/** For an empty ship at `from`: sail to the card's source, load, run it in. */
function bestRunForEmptyShip(s: GameState, from: string, owner: string): Run | null {
  let best: Run | null = null;
  for (const contract of liveContracts(s)) {
    const toSource = distanceBetween(from, contract.source);
    const toDest = distanceBetween(contract.source, contract.destination);
    if (!isFinite(toSource) || !isFinite(toDest)) continue;

    // Rivals already loaded and closer will take the paid places before this ship even loads.
    const contested = rivalsAhead(s, contract, owner, toSource + toDest);
    const placesLeft = 2 - contract.fills.length - contested;
    if (placesLeft <= 0) continue;

    // If one paid place is already gone, the realistic outcome is second money, not first.
    const takenPlaces = contract.fills.length + contested;
    const multiplier = takenPlaces === 0 ? 4 : 2;
    const profit = contract.price * (multiplier - 1);

    const score = profit / turnsFor(toSource + toDest);
    if (!best || score > best.score) best = { contract, score };
  }
  return best;
}

/** For a loaded ship at `from`: the card its cargo can still fill, ranked by payout per turn. */
function bestRunForLoadedShip(s: GameState, ship: Ship): Run | null {
  if (!ship.cargo || !ship.location) return null;
  let best: Run | null = null;
  for (const contract of liveContracts(s)) {
    if (contract.good !== ship.cargo.good) continue;
    const distance = distanceBetween(ship.location, contract.destination);
    if (!isFinite(distance)) continue;

    // The lot is already paid for, so even second money is worth sailing for — but not if the
    // paid places will all be gone by the time she gets there.
    const contested = rivalsAhead(s, contract, ship.ownerId, distance);
    if (contract.fills.length + contested >= 2) continue;

    const score = (ship.cargo.paid * (payoutFor(contract) / contract.price)) / turnsFor(distance);
    if (!best || score > best.score) best = { contract, score };
  }
  return best;
}

/** The most valuable thing this port sells that the captain can afford, for a speculative load. */
function bestSpeculativeLoad(s: GameState, captain: Captain, portId: string): string | null {
  const port = PORT_BY_ID[portId];
  if (!port) return null;
  let best: string | null = null;
  let bestPrice = 0;
  for (const good of port.supplies) {
    const price = GOOD_BY_ID[good]?.basePrice ?? 0;
    if (price > bestPrice && price <= captain.cash) {
      best = good;
      bestPrice = price;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Investment
// ---------------------------------------------------------------------------

function investmentAction(s: GameState, captain: Captain): GameAction | null {
  const temperament = temperamentOf(captain);
  const ships = shipsOf(s, captain.id);
  const bankHasShares = s.sharesRemaining > 0;
  const sharePrice = bankHasShares ? SHARE_PRICE : SHARE_PRICE * SHARE_RAID_MULTIPLIER;

  // Already declared: the only job left is to be holding the cash and the shares when the clock
  // runs out. Buying anything that drops cash below the bar would lose the game it just claimed.
  if (s.declaration?.captainId === captain.id) {
    const spare = captain.cash - Math.max(VICTORY_CASH, TRADING_FLOAT);
    if (spare >= sharePrice && (bankHasShares || canRaid(s, captain))) return { type: 'BUY_SHARE' };
    return null;
  }

  // One share short of a majority is always worth taking, at any price it can afford.
  const oneShort = captain.shares === SHARE_MAJORITY - 1;
  if (
    oneShort &&
    captain.cash - sharePrice >= TRADING_FLOAT &&
    (bankHasShares || canRaid(s, captain))
  ) {
    return { type: 'BUY_SHARE' };
  }

  if (captain.cash - sharePrice >= Math.max(TRADING_FLOAT, temperament.shareReserve)) {
    if (bankHasShares) return { type: 'BUY_SHARE' };

    // Bank empty: buy out a smaller stake. Deliberately NOT gated on already being close to a
    // majority — that guard looks prudent and is fatal. The harness produced a board of 6/2/2/0
    // where the leader was too poor to buy and nobody else was "close enough" to be allowed to,
    // so the shares never moved again. Concentration has to be able to start from a standing
    // start; the price and the cash floor are what keep it from becoming a habit.
    if (canRaid(s, captain) && captain.cash - sharePrice >= VICTORY_CASH * 0.6) {
      return { type: 'BUY_SHARE' };
    }
  }

  if (
    ships.length < MAX_SHIPS &&
    captain.shares < SHARE_MAJORITY - 1 &&
    captain.cash - SHIP_PRICE >= Math.max(TRADING_FLOAT, temperament.shipReserve)
  ) {
    return { type: 'BUY_SHIP' };
  }

  return null;
}

/** Mirrors the reducer's own test — proposing a buy-out it will reject just wastes the AI's turn. */
const canRaid = (s: GameState, captain: Captain): boolean =>
  s.captains.some(c => c.id !== captain.id && c.shares > 0 && canBuyOut(captain.shares, c.shares));

// ---------------------------------------------------------------------------

export function nextAiAction(s: GameState): GameAction | null {
  if (s.phase !== 'act') return null;
  const captain = activeCaptain(s);
  if (captain.kind !== 'ai') return null;

  // Winning beats everything else on the board — but only claim it when the cash bar is within
  // reach of twelve rounds' trading. Declaring at £80 in hand just burns the claim and hands the
  // table twelve rounds of warning, which the harness saw happen over and over.
  if (
    captain.shares >= SHARE_MAJORITY &&
    !s.declaration &&
    captain.cash >= VICTORY_CASH * 0.4
  ) {
    return { type: 'DECLARE' };
  }

  const temperament = temperamentOf(captain);
  const ships = shipsOf(s, captain.id);
  const docked = ships.filter(sh => sh.location !== null);

  // 1. Land anything that can be landed this instant.
  for (const ship of docked) {
    if (!ship.cargo) continue;
    const here = s.contracts.find(
      c => c.destination === ship.location && c.good === ship.cargo!.good && c.fills.length < 2,
    );
    if (here) return { type: 'DELIVER', shipId: ship.id, contractId: here.id };
  }

  // 2. Loaded ships still in port: set a course for the card their cargo fits.
  for (const ship of docked) {
    if (!ship.cargo) continue;
    const run = bestRunForLoadedShip(s, ship);
    if (run) return { type: 'SAIL_TO', shipId: ship.id, destination: run.contract.destination };

    // Nothing face-up wants it. Hold a while in case a card turns up, then cut the loss —
    // a hold full of unsellable spec cargo takes a ship out of the game permanently.
    const held = s.turn - ship.cargo.boughtOnTurn;
    if (held >= temperament.patience && portDemands(ship.location!, ship.cargo.good)) {
      return { type: 'SELL_LOCAL', shipId: ship.id };
    }
    // Otherwise carry it somewhere that at least buys it, so SELL_LOCAL becomes possible.
    const outlet = nearestOutlet(s, ship);
    if (outlet) return { type: 'SAIL_TO', shipId: ship.id, destination: outlet };
  }

  // 3. Empty ships in port: load here if this is the source, otherwise sail for one.
  for (const ship of docked) {
    if (ship.cargo) continue;
    const run = bestRunForEmptyShip(s, ship.location!, captain.id);

    if (run && run.contract.source === ship.location) {
      if (captain.cash >= run.contract.price) {
        return { type: 'BUY_CARGO', shipId: ship.id, good: run.contract.good };
      }
    }

    if (run && (run.score >= temperament.speculateBelow || temperament.speculateBelow === 0)) {
      if (run.contract.source !== ship.location) {
        return { type: 'SAIL_TO', shipId: ship.id, destination: run.contract.source };
      }
    }

    // Speculators will load the best thing on the quay when no card is worth chasing.
    if (temperament.speculateBelow > 0 && (!run || run.score < temperament.speculateBelow)) {
      const good = bestSpeculativeLoad(s, captain, ship.location!);
      if (good && portSupplies(ship.location!, good)) {
        return { type: 'BUY_CARGO', shipId: ship.id, good };
      }
    }

    // Nothing to load and nothing worth chasing — go where the cards generally are.
    if (run) return { type: 'SAIL_TO', shipId: ship.id, destination: run.contract.source };
  }

  // 4. Too poor to buy the cheapest lot anywhere and holding shares? Cash one in. This is the
  //    softlock escape, and the AI reaches for it before it is completely stuck rather than after.
  if (captain.shares > 0 && captain.cash < CHEAPEST_LOT && !ships.some(sh => sh.cargo)) {
    return { type: 'SELL_SHARE' };
  }

  // 5. Put the money to work.
  return investmentAction(s, captain);
}

/** Nearest port that buys this ship's cargo, so an unwanted lot can eventually be cleared. */
function nearestOutlet(s: GameState, ship: Ship): string | null {
  if (!ship.cargo || !ship.location) return null;
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const port of Object.values(PORT_BY_ID)) {
    if (port.id === ship.location) continue;
    if (!portDemands(port.id, ship.cargo.good)) continue;
    const d = distanceBetween(ship.location, port.id);
    if (d < bestDistance) {
      best = port.id;
      bestDistance = d;
    }
  }
  return best;
}
