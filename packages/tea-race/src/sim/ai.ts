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
import {
  distanceBetween,
  portSupplies,
  sourcesFor,
  GOODS,
  GOOD_BY_ID,
  PORTS,
  PORT_BY_ID,
} from './content';
import { payoutFor } from './contracts';
import { goodEmbargoed, landedValue, portStruck } from './events';
import {
  canBuyOut,
  FITTING_PRICES,
  HOLD_SLOTS,
  MAX_SHIPS,
  LOAN_INTEREST_PER_ROUND,
  LOAN_STEP,
  loanCeilingFor,
  SHARE_MAJORITY,
  canHostileBid,
  wagesFor,
  hostileBidPrice,
  SHARE_RAID_MULTIPLIER,
  SHIP_PRICE,
  VICTORY_CASH,
  sharePriceFor,
} from './rules';
import { activeCaptain, shipsOf } from './state';
import { seasonOf, turnsBetween } from './weather';
import { piracyRating } from './hazards';
import { priceAt, quaysidePrice } from './pricing';
import type { AiProfile, Captain, Contract, GameAction, GameState, PortId, Ship } from './types';

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
  /** Turns a lot may sit unwanted before it goes over the side. Dumping recovers nothing. */
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

/**
 * How long a passage really takes, wind included. Without this the AI keeps scoring runs by raw
 * distance and so keeps choosing the geometrically shortest one — the exact failure the wind-aware
 * pathfinder exists to prevent, just relocated into the opponent's head.
 */
function passageTurns(s: GameState, from: string, to: string, fallbackDistance: number): number {
  if (!s.hazards?.weather) return turnsFor(fallbackDistance);
  const turns = turnsBetween(from, to, seasonOf(s.round));
  return Number.isFinite(turns) ? Math.max(0.5, turns) : turnsFor(fallbackDistance);
}

/** Expected fraction of a cargo's value lost to pirates on a passage. Used to discount a run. */
function piracyDrag(s: GameState, from: string, to: string): number {
  if (!s.hazards?.piracy) return 0;
  // Cheap proxy: the worst rating on the direct leg, if there is one. The AI is reduced-fidelity by
  // design and does not path-integrate risk.
  return Math.min(0.3, piracyRating(from, to) * 0.04);
}

const liveContracts = (s: GameState): Contract[] => s.contracts.filter(c => c.fills.length < 2);

/** The cheapest lot on any quay. Below this a captain literally cannot trade. */
// The cheapest lot obtainable anywhere on the chart. Measured across quays, not off base prices,
// because a quay can price below the reckoning and this figure gates the softlock escape.
const CHEAPEST_LOT = Math.min(
  ...GOODS.flatMap(g => PORTS.filter(p => p.supplies.includes(g.id)).map(p => priceAt(p.id, g.id))),
);

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface Run {
  contract: Contract;
  /**
   * The port she means to load at. Chosen, not read off the card — cards name the buyer only, so
   * picking the supplier is now part of the decision and part of what the AI has to be good at.
   * Null for a ship already carrying the good, who needs no source.
   */
  source: PortId | null;
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
    if (!ship.hold.some(lot => lot.good === contract.good)) continue;
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
    // An embargo stops her lading the good anywhere, so the card is out whatever the route.
    if (goodEmbargoed(s, contract.good)) continue;

    // Priced through the same call the reducer will use, so a glut genuinely deters her and an
    // Admiralty bounty genuinely tempts her across an ocean.
    const multiplierIfFirst = 4;

    // The card names no source, so every port that stocks the good is a candidate and the whole
    // out-and-back has to be costed for each. This is the work the old code got for free by being
    // told where to load — and getting it right is what makes an off-card sourcing decision, the
    // thing the owner remembered from the board game, actually pay off.
    for (const source of sourcesFor(contract.good, from)) {
      if (source === contract.destination) continue;
      // Shut today means she cannot load there today; another supplier probably serves.
      if (portStruck(s, source)) continue;

      const toSource = distanceBetween(from, source);
      const toDest = distanceBetween(source, contract.destination);
      if (!isFinite(toSource) || !isFinite(toDest)) continue;

      // Rivals already loaded and closer will take the paid places before this ship even loads.
      const contested = rivalsAhead(s, contract, owner, toSource + toDest);
      const takenPlaces = contract.fills.length + contested;
      if (2 - takenPlaces <= 0) continue;

      // If one paid place is already gone, the realistic outcome is second money, not first.
      const multiplier = takenPlaces === 0 ? multiplierIfFirst : 2;
      // Paid at this quay's price, landed at the card's reckoning: the margin is the whole reason to
      // sail past a nearer supplier for a cheaper one, so it has to be in the score.
      const cost = priceAt(source, contract.good);
      const profit = landedValue(s, contract.good, contract.price, multiplier) - cost;

      const turns =
        passageTurns(s, from, source, toSource) +
        passageTurns(s, source, contract.destination, toDest);
      const drag = piracyDrag(s, source, contract.destination);
      const score = (profit * (1 - drag)) / Math.max(0.5, turns);
      if (!best || score > best.score) best = { contract, source, score };
    }
  }
  return best;
}

/** For a loaded ship at `from`: the card her hold can still fill, ranked by payout per turn. */
function bestRunForLoadedShip(s: GameState, ship: Ship): Run | null {
  if (ship.hold.length === 0 || !ship.location) return null;
  let best: Run | null = null;
  for (const contract of liveContracts(s)) {
    if (!ship.hold.some(lot => lot.good === contract.good)) continue;
    const distance = distanceBetween(ship.location, contract.destination);
    if (!isFinite(distance)) continue;

    // The lot is already paid for, so even second money is worth sailing for — but not if the
    // paid places will all be gone by the time she gets there.
    const contested = rivalsAhead(s, contract, ship.ownerId, distance);
    if (contract.fills.length + contested >= 2) continue;

    const turns = passageTurns(s, ship.location, contract.destination, distance);
    const drag = piracyDrag(s, ship.location, contract.destination);
    // Every matching slot lands together and is paid per unit, so three lots are worth three times
    // the trip. That is what makes filling the hull with one good the right move.
    const units = ship.hold.filter(lot => lot.good === contract.good);
    const multiplier = payoutFor(contract) / contract.price;
    // Landed on the card's reckoning per unit, not on what was paid for the lot — the reducer pays
    // that way and the AI must score it that way or it will chase the wrong cards.
    const gross = units.reduce(
      (n, lot) => n + landedValue(s, lot.good, contract.price, multiplier),
      0,
    );
    const score = (gross * (1 - drag)) / Math.max(0.5, turns);
    if (!best || score > best.score) best = { contract, source: null, score };
  }
  return best;
}

/** The most valuable thing this port sells within the given budget, for a speculative load. */
function bestSpeculativeLoad(s: GameState, budget: number, portId: string): string | null {
  const port = PORT_BY_ID[portId];
  if (!port) return null;
  if (portStruck(s, portId)) return null;
  // Ranked on the reckoned value she could land, less what this quay charges — a lot going cheap
  // here is a better gamble than an expensive one, which the old "dearest affordable" rule had
  // exactly backwards once quays stopped agreeing on price.
  let best: string | null = null;
  let bestEdge = -Infinity;
  for (const good of port.supplies) {
    if (goodEmbargoed(s, good)) continue;
    const price = priceAt(portId, good);
    if (price > budget) continue;
    const reckoning = GOOD_BY_ID[good]?.basePrice ?? 0;
    // Weighted by the reckoning so she still favours valuable cargo over merely underpriced tat.
    const edge = reckoning - price + reckoning * 0.5;
    if (edge > bestEdge) {
      best = good;
      bestEdge = edge;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Investment
// ---------------------------------------------------------------------------

/**
 * The rival holding the most shares. The target for a hostile bid, because taking one from the
 * leader is a two-share swing — you gain one and they lose one — and breaking up the leading block
 * is the whole reason a trailing captain would pay that price.
 */
function biggestRival(s: GameState, captain: Captain): Captain | null {
  let best: Captain | null = null;
  for (const c of s.captains) {
    if (c.id === captain.id) continue;
    if (!best || c.shares > best.shares) best = c;
  }
  return best && best.shares > 0 ? best : null;
}

/**
 * Bid for a share at the exchange, whatever this captain's own holding.
 *
 * Reached only when the ordinary routes are shut — the bank is empty and the buy-out rule will not
 * let this captain in — so it stays the expensive last resort it is meant to be. Gated on being
 * *behind*: a captain already level with or ahead of the field has cheaper ways to concentrate, and
 * letting the leader use it would turn a comeback mechanic into a runaway one.
 */
function hostileBidAction(s: GameState, captain: Captain): GameAction | null {
  if (!s.hazards?.hostileBids) return null;
  if (captain.shares >= SHARE_MAJORITY) return null;
  // The bank is always cheaper while it has any left.
  if (s.sharesRemaining > 0) return null;

  const target = biggestRival(s, captain);
  if (!target || target.shares <= captain.shares) return null;

  const made = s.hostileBids ?? 0;
  if (!canHostileBid(captain.shares, captain.cash, target.shares, made)) return null;

  // What she must still hold afterwards. One share short of a majority she is buying the game
  // outright, so she has to keep the declaration money too — a bid that wins the shares and loses
  // the cash bar has bought nothing.
  const oneShort = captain.shares === SHARE_MAJORITY - 1;
  const floor = oneShort ? VICTORY_CASH + TRADING_FLOAT : TRADING_FLOAT * 3;
  if (captain.cash - hostileBidPrice(made, captain.shares) < floor) return null;

  return { type: 'HOSTILE_BID', targetId: target.id };
}

/**
 * Borrow when the purse will not cover the running costs.
 *
 * Only when genuinely squeezed — with wages running, a captain who lets cash reach zero starts
 * accruing arrears that come off the top of everything they earn afterwards, which is a far worse
 * position than paying interest on a loan taken in time.
 */
function loanAction(s: GameState, captain: Captain): GameAction | null {
  if (!s.hazards?.loans) return null;
  const ships = shipsOf(s, captain.id);
  const laden = ships.reduce((n, sh) => n + sh.hold.length, 0);
  const nextBill =
    (s.hazards?.wages ? wagesFor(ships.length, laden) : 0) +
    Math.ceil((captain.debt ?? 0) * LOAN_INTEREST_PER_ROUND) +
    (captain.arrears ?? 0);

  // Squeezed means: cannot cover the coming bill and still trade.
  if (captain.cash >= nextBill + TRADING_FLOAT) return null;
  if ((captain.debt ?? 0) + LOAN_STEP > loanCeilingFor(ships.length, captain.shares)) return null;
  return { type: 'TAKE_LOAN' };
}

function investmentAction(s: GameState, captain: Captain): GameAction | null {
  const temperament = temperamentOf(captain);
  const ships = shipsOf(s, captain.id);
  const bankHasShares = s.sharesRemaining > 0;
  const sharePrice = bankHasShares
    ? sharePriceFor(s.sharesRemaining)
    : sharePriceFor(0) * SHARE_RAID_MULTIPLIER;

  // Already declared: the only job left is to be holding the cash and the shares when the clock
  // runs out. Buying anything that drops cash below the bar would lose the game it just claimed.
  if (s.declaration?.captainId === captain.id) {
    const spare = captain.cash - Math.max(VICTORY_CASH, TRADING_FLOAT);
    if (spare >= sharePrice && (bankHasShares || canRaid(s, captain))) return { type: 'BUY_SHARE' };
    return null;
  }

  /**
   * A majority already in hand: stop buying shares and save for the cash bar.
   *
   * Shares beyond six do nothing — the win needs a majority, not a maximum — and buying them is
   * actively self-defeating, because the same cash is the other half of the victory condition. The
   * harness found a game that ran to 401 rounds without an ending because of precisely this: a
   * captain held a majority for 1,170 consecutive turns and was cash-ready on none of them, since
   * every time she clawed back up to £370 she spent £240 on a seventh share. Her rivals ended on
   * £5,947 and £5,029 while she sat on £620 and could never declare.
   */
  if (captain.shares >= SHARE_MAJORITY) return null;

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

  // Debt costs interest every round, so clear it whenever the money is genuinely spare. Ahead of
  // the share market on purpose: a captain servicing a loan out of a shrinking purse is losing.
  if (s.hazards?.loans && (captain.debt ?? 0) > 0) {
    const spare = captain.cash - Math.max(VICTORY_CASH, TRADING_FLOAT * 4);
    if (spare >= LOAN_STEP) return { type: 'REPAY_LOAN' };
  }

  // Every ordinary route shut and still behind: bid at the exchange.
  const bid = hostileBidAction(s, captain);
  if (bid) return bid;

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

  // Winning beats everything else on the board — but only claim it holding the cash the claim
  // actually requires.
  //
  // This was `VICTORY_CASH * 0.4`, on the theory that a captain could trade the rest up before the
  // clock ran out. In practice they could not, and the harness showed *five* declare-and-lapse
  // cycles in a single 91-round game. Every one of them puts the countdown banner back on screen at
  // full, which is what "the game keeps counting down and never finishes" looks like from the
  // outside. A claim should be the end of the game, not a recurring event.
  if (captain.shares >= SHARE_MAJORITY && !s.declaration && captain.cash >= VICTORY_CASH) {
    return { type: 'DECLARE' };
  }

  const temperament = temperamentOf(captain);
  const ships = shipsOf(s, captain.id);
  const docked = ships.filter(sh => sh.location !== null);

  /**
   * Once this captain has declared, the cash bar is the win condition and must be protected. The
   * investment path already guards it, but buying cargo did not — which is why the harness still
   * saw claims lapse "only £725 in hand", losing a won game for the sake of one more lot.
   */
  const declarer = s.declaration?.captainId === captain.id;
  const spendable = declarer ? Math.max(0, captain.cash - VICTORY_CASH) : captain.cash;

  // 1. Land anything that can be landed this instant.
  for (const ship of docked) {
    if (ship.hold.length === 0) continue;
    const here = s.contracts.find(
      c =>
        c.destination === ship.location &&
        ship.hold.some(lot => lot.good === c.good) &&
        c.fills.length < 2,
    );
    if (here) return { type: 'DELIVER', shipId: ship.id, contractId: here.id };
  }

  // 2. Fit out and insure, before anyone is ordered to sea.
  //
  // Two postures, and the difference matters. A captain still building is buying protection for a
  // long campaign, so fittings are worth a real outlay. A captain already holding a majority is
  // waiting on one number — the cash bar — and every pound of variance between here and there is
  // what stops them declaring. The harness found a game that never finished for exactly that
  // reason: a leader on six shares ransomed back below £750 again and again. For them, insurance is
  // the point (it converts variance into a small known cost) and fittings are just money leaving.
  const closingOut = captain.shares >= SHARE_MAJORITY;

  if (s.hazards?.piracy) {
    for (const ship of docked) {
      const holdValue = ship.hold.reduce((n, lot) => n + lot.paid, 0);
      const worthInsuring = closingOut ? holdValue > 0 : holdValue >= 90;
      if (worthInsuring && !ship.insured) {
        return { type: 'SET_INSURANCE', shipId: ship.id, insured: true };
      }
      // Deliberately never closed again. A policy only costs anything at cast-off, and an empty
      // hold pays the minimum premium, so churning it open and shut saves almost nothing and
      // produced 800-odd log lines of noise across a handful of games.
    }
  }

  if (!closingOut) {
    // Fittings are a real outlay, so they wait for a real surplus. Buying copper on every ship the
    // moment it was affordable diverted the money that buys shares and stretched the game.
    const surplus = spendable - TRADING_FLOAT - 60;
    for (const ship of docked) {
      if (s.hazards?.weather && !ship.fittings?.copper && surplus >= FITTING_PRICES.copper) {
        return { type: 'BUY_FITTING', shipId: ship.id, fitting: 'copper' };
      }
      if (
        s.hazards?.piracy &&
        !ship.fittings?.guns &&
        ship.hold.reduce((n, lot) => n + lot.paid, 0) >= 90 &&
        surplus >= FITTING_PRICES.guns
      ) {
        return { type: 'BUY_FITTING', shipId: ship.id, fitting: 'guns' };
      }
    }
  }

  // 3. Loaded ships still in port. Top up the hold first if there is a good reason to, then sail.
  for (const ship of docked) {
    if (ship.hold.length === 0) continue;
    const run = bestRunForLoadedShip(s, ship);

    // Filling spare slots with more of what she is already carrying multiplies the same voyage.
    if (run && ship.hold.length < HOLD_SLOTS && portSupplies(ship.location!, run.contract.good)) {
      const price = priceAt(ship.location!, run.contract.good);
      if (spendable >= price) {
        return { type: 'BUY_CARGO', shipId: ship.id, good: run.contract.good };
      }
    }
    if (run) return { type: 'SAIL_TO', shipId: ship.id, destination: run.contract.destination };

    // Nothing face-up wants any of it. Dumping now recovers nothing at all, so hold considerably
    // longer than when a half-price sale was available — the hull is only worth clearing once the
    // cargo is genuinely dead weight blocking better work.
    const oldest = Math.max(...ship.hold.map(lot => s.turn - lot.boughtOnTurn));
    if (oldest >= temperament.patience * 2 && ship.hold.length >= HOLD_SLOTS) {
      // Sell it if the quay will take it — anything beats nothing, and she is standing right there.
      // Sell the single worst lot rather than the lot, so a hull is cleared a slot at a time and one
      // dud does not cost her the two lots that were fine.
      if (s.hazards?.quaysideSales && ship.location && !portStruck(s, ship.location)) {
        const worst = [...ship.hold].sort(
          (a, b) =>
            quaysidePrice(ship.location!, a.good) - a.paid - (quaysidePrice(ship.location!, b.good) - b.paid),
        )[0];
        // Only where the quay deals in it; hawking cargo at a port with no buyer is barely better
        // than the sea, and holding on for a port that wants it is usually the better play.
        if (worst && quaysidePrice(ship.location, worst.good) >= worst.paid * 0.5) {
          return { type: 'SELL_CARGO', shipId: ship.id, good: worst.good };
        }
      }
      return { type: 'JETTISON', shipId: ship.id };
    }
  }

  // 3b. Raise money before the bill falls due, rather than sliding into arrears.
  const loan = loanAction(s, captain);
  if (loan) return loan;

  // 4. Too poor to buy the cheapest lot anywhere and holding shares? Cash one in.
  //
  //    This is the softlock escape, and it has to come *before* the sailing below, which is the
  //    mistake the first version made. Sitting at step 4b it was unreachable: a captain with ships
  //    always finds some card worth steering for, returns SAIL_TO, and never falls through to here.
  //    The harness found her holding a winning six shares on £1 — no cargo, nothing affordable on
  //    any quay, and unraidable, because a forced buy-out needs the buyer to hold at least as many
  //    shares as the seller and she held the most. Four hundred rounds of sailing to ports where she
  //    could not buy anything. A majority you can never turn into the £750 the win also needs is
  //    worth nothing, so sell one and trade back up.
  if (captain.shares > 0 && captain.cash < CHEAPEST_LOT && !ships.some(sh => sh.hold.length > 0)) {
    return { type: 'SELL_SHARE' };
  }

  // 4a. Empty ships in port: load here if this is the source, otherwise sail for one.
  for (const ship of docked) {
    if (ship.hold.length > 0) continue;
    const run = bestRunForEmptyShip(s, ship.location!, captain.id);

    if (run && run.source === ship.location) {
      if (spendable >= run.contract.price) {
        return { type: 'BUY_CARGO', shipId: ship.id, good: run.contract.good };
      }
    }

    if (run?.source && (run.score >= temperament.speculateBelow || temperament.speculateBelow === 0)) {
      if (run.source !== ship.location) {
        return { type: 'SAIL_TO', shipId: ship.id, destination: run.source };
      }
    }

    // Speculators will load the best thing on the quay when no card is worth chasing.
    if (temperament.speculateBelow > 0 && (!run || run.score < temperament.speculateBelow)) {
      const good = bestSpeculativeLoad(s, spendable, ship.location!);
      if (good && portSupplies(ship.location!, good) && !goodEmbargoed(s, good)) {
        return { type: 'BUY_CARGO', shipId: ship.id, good };
      }
    }

    // Nothing to load and nothing worth chasing — go where the cards generally are.
    if (run?.source) return { type: 'SAIL_TO', shipId: ship.id, destination: run.source };
  }

  // 5. Put the money to work.
  return investmentAction(s, captain);
}


