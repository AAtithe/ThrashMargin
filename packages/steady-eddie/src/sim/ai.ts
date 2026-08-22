/**
 * Computer hauliers.
 *
 * Deliberately "reduced fidelity", the same modelling level Niccolo's AI houses use: the AI plays
 * the real rules through the real reducer, but reasons with a single greedy score rather than any
 * lookahead. It is an opponent to race, not a solver.
 *
 * The engine calls `nextAiAction` repeatedly and applies whatever comes back until it returns null
 * or the reducer rejects a move (see the reference-equality convention in actions.ts). Everything
 * here is therefore a pure function of the current state — no memory between calls, which means
 * every proposal must make progress or the loop would just re-propose it. The guard in
 * `runAiTurn` bounds that, but relying on the guard would show up as a haulier who wastes turns.
 */
import {
  distanceBetween,
  depotSupplies,
  sourcesFor,
  GOODS,
  GOOD_BY_ID,
  DEPOTS,
  DEPOT_BY_ID,
} from './content';
import { payoutFor } from './contracts';
import { goodEmbargoed, landedValue, depotStruck } from './events';
import {
  canBuyOut,
  FITTING_PRICES,
  MAX_VEHICLES,
  LOAN_INTEREST_PER_ROUND,
  LOAN_STEP,
  loanCeilingFor,
  CONTRACT_LIFE_ROUNDS,
  freshness,
  difficultyProfile,
  SHARE_MAJORITY,
  canHostileBid,
  wagesFor,
  hostileBidPrice,
  SHARE_RAID_MULTIPLIER,
  VEHICLE_CLASSES,
  slotsOf,
  VICTORY_CASH,
  sharePriceFor,
} from './rules';
import { activeHaulier, vehiclesOf } from './state';
import { seasonOf, turnsBetween } from './weather';
import { theftRating } from './hazards';
import { priceAt, depotSalePrice } from './pricing';
import { COMPANIES, STOCK_IDS } from './stocks';
import type { AiProfile, Haulier, Contract, GameAction, GameState, DepotId, Vehicle } from './types';
import type { VehicleClassId } from './rules';

/** This haulier's playing strength: her own level if she has one, else the table's. */
function levelOf(s: GameState, haulierId: string) {
  const haulier = s.hauliers.find(c => c.id === haulierId);
  return difficultyProfile(haulier?.aiLevel ?? s.difficulty);
}

/** Average of 2d6 — used to turn drive points into an estimate of turns. */
const POINTS_PER_TURN = 7;

/**
 * Cash a computer haulier will never spend on shares or vehicles, whatever its temperament.
 *
 * Without a hard floor the harness produced a haulier sitting on a winning majority of six shares
 * and £10 — too little to buy the cheapest lot on any depot, so no way to ever earn the £750 the
 * win also requires. She drove in circles for 370 rounds. SELL_SHARE now exists as the way back
 * out of that hole, but not falling in beats climbing out: this is roughly two mid-value lots.
 */
const TRADING_FLOAT = 130;

interface Temperament {
  /** Cash kept back rather than spent on shares. */
  shareReserve: number;
  /** Cash kept back rather than spent on a new vehicle. */
  vehicleReserve: number;
  /** Below this score, an empty vehicle will load something on spec rather than chase a contract. */
  speculateBelow: number;
  /** Turns a lot may sit unwanted before it goes over the side. Dumping recovers nothing. */
  patience: number;
}

const TEMPERAMENTS: Record<AiProfile, Temperament> = {
  // Chases the cards. Buys vehicles early, shares late.
  racer: { shareReserve: 260, vehicleReserve: 140, speculateBelow: 0, patience: 10 },
  // Will load a valuable good with no card against it and wait for one to turn up.
  speculator: { shareReserve: 220, vehicleReserve: 260, speculateBelow: 26, patience: 6 },
  // Treats the vehicles as a means to shares.
  financier: { shareReserve: 60, vehicleReserve: 420, speculateBelow: 0, patience: 8 },
};

const temperamentOf = (c: Haulier): Temperament => TEMPERAMENTS[c.aiProfile ?? 'racer'];

const turnsFor = (points: number) => Math.max(1, points / POINTS_PER_TURN);

/**
 * How long a passage really takes, weather included. Without this the AI keeps scoring runs by raw
 * distance and so keeps choosing the geometrically shortest one — the exact failure the
 * weather-aware pathfinder exists to prevent, just relocated into the opponent's head.
 */
function passageTurns(
  s: GameState,
  from: string,
  to: string,
  fallbackDistance: number,
  readsForecast = true,
): number {
  // A haulier who does not read the forecast simply reckons on the shortest line, and is wrong
  // about how long a fog- or flood-prone passage will actually take in a bad season.
  if (!readsForecast) return Math.max(1, Math.round(fallbackDistance / POINTS_PER_TURN));
  if (!s.hazards?.weather) return turnsFor(fallbackDistance);
  const turns = turnsBetween(from, to, seasonOf(s.round));
  return Number.isFinite(turns) ? Math.max(0.5, turns) : turnsFor(fallbackDistance);
}

/** Expected fraction of a cargo's value lost to theft on a passage. Used to discount a run. */
function theftDrag(s: GameState, from: string, to: string): number {
  if (!s.hazards?.theft) return 0;
  // Cheap proxy: the worst rating on the direct leg, if there is one. The AI is reduced-fidelity by
  // design and does not path-integrate risk.
  return Math.min(0.3, theftRating(from, to) * 0.04);
}

const liveContracts = (s: GameState): Contract[] => s.contracts.filter(c => c.fills.length < 2);

/** The cheapest lot on any depot. Below this a haulier literally cannot trade. */
// The cheapest lot obtainable anywhere on the chart. Measured across depots, not off base prices,
// because a depot can price below the reckoning and this figure gates the softlock escape.
const CHEAPEST_LOT = Math.min(
  ...GOODS.flatMap(g => DEPOTS.filter(p => p.supplies.includes(g.id)).map(p => priceAt(p.id, g.id))),
);

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface Run {
  contract: Contract;
  /**
   * The depot she means to load at. Chosen, not read off the card — cards name the buyer only, so
   * picking the supplier is now part of the decision and part of what the AI has to be good at.
   * Null for a vehicle already carrying the good, who needs no source.
   */
  source: DepotId | null;
  /** Profit per turn, the only number the AI actually ranks on. */
  score: number;
}

/**
 * How many rival vehicles are already carrying this card's good and are closer to its destination.
 *
 * Without this the AI chases races it has visibly lost, buys the cargo anyway, arrives to find the
 * card spent, and dumps the lot at half price. The harness measured that directly: before this
 * check, computer hauliers dumped cargo more often than they landed it (185 SELL_LOCAL against 132
 * DELIVER in a single game). Only the first two vehicles home are paid, so a run with two rivals
 * already ahead is worth nothing and should not be started.
 */
function rivalsAhead(s: GameState, contract: Contract, mine: string, myDistance: number): number {
  let ahead = 0;
  for (const vehicle of s.vehicles) {
    if (vehicle.ownerId === mine) continue;
    if (!vehicle.hold.some(lot => lot.good === contract.good)) continue;
    const from = vehicle.location ?? vehicle.run?.route[vehicle.run.route.length - 1];
    if (!from) continue;
    if (distanceBetween(from, contract.destination) < myDistance) ahead++;
  }
  return ahead;
}

/** For an empty vehicle at `from`: drive to the card's source, load, run it in. */
function bestRunForEmptyVehicle(s: GameState, from: string, owner: string): Run | null {
  const skill = levelOf(s, owner);
  let best: Run | null = null;
  for (const contract of liveContracts(s)) {
    // An embargo stops her lading the good anywhere, so the card is out whatever the route.
    if (goodEmbargoed(s, contract.good)) continue;

    // Priced through the same call the reducer will use, so a glut genuinely deters her and an
    // Admiralty bounty genuinely tempts her across an ocean.
    const multiplierIfFirst = 4;

    // The card names no source, so every depot that stocks the good is a candidate and the whole
    // out-and-back has to be costed for each. This is the work the old code got for free by being
    // told where to load — and getting it right is what makes an off-card sourcing decision, the
    // thing the owner remembered from the board game, actually pay off.
    for (const source of sourcesFor(contract.good, from)) {
      if (source === contract.destination) continue;
      // Shut today means she cannot load there today; another supplier probably serves.
      if (depotStruck(s, source)) continue;

      const toSource = distanceBetween(from, source);
      const toDest = distanceBetween(source, contract.destination);
      if (!isFinite(toSource) || !isFinite(toDest)) continue;

      // Rivals already loaded and closer will take the paid places before this vehicle even loads.
      const contested = skill.seesRivals ? rivalsAhead(s, contract, owner, toSource + toDest) : 0;
      const takenPlaces = contract.fills.length + contested;
      if (2 - takenPlaces <= 0) continue;

      // If one paid place is already gone, the realistic outcome is second money, not first.
      const multiplier = takenPlaces === 0 ? multiplierIfFirst : 2;
      // Paid at this depot's price, landed at the card's reckoning: the margin is the whole reason to
      // drive past a nearer supplier for a cheaper one, so it has to be in the score.
      const cost = priceAt(source, contract.good);
      const profit = landedValue(s, contract.good, contract.price, multiplier) - cost;

      const turns =
        passageTurns(s, from, source, toSource, skill.readsForecast) +
        passageTurns(s, source, contract.destination, toDest, skill.readsForecast);
      const drag = theftDrag(s, source, contract.destination);
      const score = (profit * (1 - drag)) / Math.max(0.5, turns);
      if (!best || score > best.score) best = { contract, source, score };
    }
  }
  return best;
}

/** For a loaded vehicle at `from`: the card her hold can still fill, ranked by payout per turn. */
function bestRunForLoadedVehicle(s: GameState, vehicle: Vehicle): Run | null {
  if (vehicle.hold.length === 0 || !vehicle.location) return null;
  const skill = levelOf(s, vehicle.ownerId);
  let best: Run | null = null;
  for (const contract of liveContracts(s)) {
    if (!vehicle.hold.some(lot => lot.good === contract.good)) continue;
    const distance = distanceBetween(vehicle.location, contract.destination);
    if (!isFinite(distance)) continue;

    // The lot is already paid for, so even second money is worth driving for — but not if the
    // paid places will all be gone by the time she gets there.
    const contested = skill.seesRivals ? rivalsAhead(s, contract, vehicle.ownerId, distance) : 0;
    if (contract.fills.length + contested >= 2) continue;

    // Hoisted above the payout, because what a lot is worth on arrival depends on how old it will be
    // when it gets there, not how old it is now.
    const turns = passageTurns(s, vehicle.location, contract.destination, distance, skill.readsForecast);

    // No point steering for a card that will be off the board before she reaches the depot.
    if (s.hazards?.deadlines && contract.postedOn !== undefined) {
      const roundsLeft = CONTRACT_LIFE_ROUNDS - (s.round - contract.postedOn);
      if (turns / Math.max(1, s.hauliers.length) > roundsLeft) continue;
    }

    const drag = theftDrag(s, vehicle.location, contract.destination);
    // Every matching slot lands together and is paid per unit, so three lots are worth three times
    // the trip. That is what makes filling the hull with one good the right move.
    const units = vehicle.hold.filter(lot => lot.good === contract.good);
    const multiplier = payoutFor(contract) / contract.price;
    // Landed on the card's reckoning per unit, not on what was paid for the lot — the reducer pays
    // that way and the AI must score it that way or it will chase the wrong cards. Discounted for
    // how long each lot has been aboard, for the same reason.
    const spoils = s.hazards?.deadlines ?? false;
    const gross = units.reduce((n, lot) => {
      const full = landedValue(s, lot.good, contract.price, multiplier);
      return n + (spoils ? full * freshness(s.turn + turns - lot.boughtOnTurn) : full);
    }, 0);
    const score = (gross * (1 - drag)) / Math.max(0.5, turns);
    if (!best || score > best.score) best = { contract, source: null, score };
  }
  return best;
}

/** The most valuable thing this depot sells within the given budget, for a speculative load. */
function bestSpeculativeLoad(s: GameState, budget: number, depotId: string): string | null {
  const depot = DEPOT_BY_ID[depotId];
  if (!depot) return null;
  if (depotStruck(s, depotId)) return null;
  // Ranked on the reckoned value she could land, less what this depot charges — a lot going cheap
  // here is a better gamble than an expensive one, which the old "dearest affordable" rule had
  // exactly backwards once depots stopped agreeing on price.
  let best: string | null = null;
  let bestEdge = -Infinity;
  for (const good of depot.supplies) {
    if (goodEmbargoed(s, good)) continue;
    const price = priceAt(depotId, good);
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
 * is the whole reason a trailing haulier would pay that price.
 */
function biggestRival(s: GameState, haulier: Haulier): Haulier | null {
  let best: Haulier | null = null;
  for (const c of s.hauliers) {
    if (c.id === haulier.id) continue;
    if (!best || c.shares > best.shares) best = c;
  }
  return best && best.shares > 0 ? best : null;
}

/**
 * Bid for a share at the exchange, whatever this haulier's own holding.
 *
 * Reached only when the ordinary routes are shut — the bank is empty and the buy-out rule will not
 * let this haulier in — so it stays the expensive last resort it is meant to be. Gated on being
 * *behind*: a haulier already level with or ahead of the field has cheaper ways to concentrate, and
 * letting the leader use it would turn a comeback mechanic into a runaway one.
 */
function hostileBidAction(s: GameState, haulier: Haulier): GameAction | null {
  if (!s.hazards?.hostileBids) return null;
  if (!levelOf(s, haulier.id).usesHostileBids) return null;
  if (haulier.shares >= SHARE_MAJORITY) return null;
  // The bank is always cheaper while it has any left.
  if (s.sharesRemaining > 0) return null;

  const target = biggestRival(s, haulier);
  if (!target || target.shares <= haulier.shares) return null;

  const made = s.hostileBids ?? 0;
  if (!canHostileBid(haulier.shares, haulier.cash, target.shares, made)) return null;

  // What she must still hold afterwards. One share short of a majority she is buying the game
  // outright, so she has to keep the declaration money too — a bid that wins the shares and loses
  // the cash bar has bought nothing.
  const oneShort = haulier.shares === SHARE_MAJORITY - 1;
  const floor = oneShort ? VICTORY_CASH + TRADING_FLOAT : TRADING_FLOAT * 3;
  if (haulier.cash - hostileBidPrice(made, haulier.shares) < floor) return null;

  return { type: 'HOSTILE_BID', targetId: target.id };
}

/**
 * Trade the haulage exchange: buy what is cheap against its base, sell what has run up.
 *
 * Deliberately a plain mean-reversion rule rather than anything cleverer. The market moves off trade
 * the hauliers themselves generate, so a smarter AI would be trading against its own influence and
 * the prices would stop being readable. This keeps the exchange something a human can out-think,
 * which is the point of adding it — and, being mean-reverting, it does provide a floor and a ceiling
 * of demand so prices are not purely one haulier's plaything.
 */
function stockAction(s: GameState, haulier: Haulier): GameAction | null {
  if (!s.hazards?.stocks) return null;
  if (!levelOf(s, haulier.id).usesStocks) return null;

  for (const id of STOCK_IDS) {
    const base = COMPANIES[id].base;
    const price = s.stockPrices?.[id] ?? base;
    const held = haulier.holdings?.[id] ?? 0;

    // Take a profit once a holding has run above where it was bought.
    if (held > 0 && price > base * 1.15) return { type: 'SELL_STOCK', stock: id, lots: held };

    // Buy in when it is cheap and the money is genuinely spare — never at the cost of trading, and
    // never out of the declaration money once a majority is within reach.
    const closeToWinning = haulier.shares >= SHARE_MAJORITY - 1;
    const keepBack = closeToWinning ? Math.max(VICTORY_CASH, TRADING_FLOAT * 5) : TRADING_FLOAT * 3;
    const spare = haulier.cash - keepBack;
    if (price < base * 0.95 && spare >= price * 2 && held < 8) {
      return { type: 'BUY_STOCK', stock: id, lots: 2 };
    }
  }
  return null;
}

/**
 * Borrow when the purse will not cover the running costs.
 *
 * Only when genuinely squeezed — with wages running, a haulier who lets cash reach zero starts
 * accruing arrears that come off the top of everything they earn afterwards, which is a far worse
 * position than paying interest on a loan taken in time.
 */
function loanAction(s: GameState, haulier: Haulier): GameAction | null {
  if (!s.hazards?.loans) return null;
  const vehicles = vehiclesOf(s, haulier.id);
  const laden = vehicles.reduce((n, sh) => n + sh.hold.length, 0);
  const nextBill =
    (s.hazards?.wages ? wagesFor(vehicles.length, laden) : 0) +
    Math.ceil((haulier.debt ?? 0) * LOAN_INTEREST_PER_ROUND) +
    (haulier.arrears ?? 0);

  // Squeezed means: cannot cover the coming bill and still trade.
  if (haulier.cash >= nextBill + TRADING_FLOAT) return null;
  if ((haulier.debt ?? 0) + LOAN_STEP > loanCeilingFor(vehicles.length, haulier.shares)) return null;
  return { type: 'TAKE_LOAN' };
}

function investmentAction(s: GameState, haulier: Haulier): GameAction | null {
  const temperament = temperamentOf(haulier);
  const skill = levelOf(s, haulier.id);
  const vehicles = vehiclesOf(s, haulier.id);
  const bankHasShares = s.sharesRemaining > 0;
  const sharePrice = bankHasShares
    ? sharePriceFor(s.sharesRemaining)
    : sharePriceFor(0) * SHARE_RAID_MULTIPLIER;

  // Already declared: the only job left is to be holding the cash and the shares when the clock
  // runs out. Buying anything that drops cash below the bar would lose the game it just claimed.
  if (s.declaration?.haulierId === haulier.id) {
    const spare = haulier.cash - Math.max(VICTORY_CASH, TRADING_FLOAT);
    if (spare >= sharePrice && (bankHasShares || canRaid(s, haulier))) return { type: 'BUY_SHARE' };
    return null;
  }

  /**
   * A majority already in hand: stop buying shares and save for the cash bar.
   *
   * Shares beyond six do nothing — the win needs a majority, not a maximum — and buying them is
   * actively self-defeating, because the same cash is the other half of the victory condition. The
   * harness found a game that ran to 401 rounds without an ending because of precisely this: a
   * haulier held a majority for 1,170 consecutive turns and was cash-ready on none of them, since
   * every time she clawed back up to £370 she spent £240 on a seventh share. Her rivals ended on
   * £5,947 and £5,029 while she sat on £620 and could never declare.
   */
  if (haulier.shares >= SHARE_MAJORITY) return null;

  // One share short of a majority is always worth taking, at any price it can afford.
  const oneShort = haulier.shares === SHARE_MAJORITY - 1;
  if (
    oneShort &&
    haulier.cash - sharePrice >= TRADING_FLOAT * skill.shareCaution &&
    (bankHasShares || canRaid(s, haulier))
  ) {
    return { type: 'BUY_SHARE' };
  }

  if (haulier.cash - sharePrice >= Math.max(TRADING_FLOAT, temperament.shareReserve) * skill.shareCaution) {
    if (bankHasShares) return { type: 'BUY_SHARE' };

    // Bank empty: buy out a smaller stake. Deliberately NOT gated on already being close to a
    // majority — that guard looks prudent and is fatal. The harness produced a board of 6/2/2/0
    // where the leader was too poor to buy and nobody else was "close enough" to be allowed to,
    // so the shares never moved again. Concentration has to be able to start from a standing
    // start; the price and the cash floor are what keep it from becoming a habit.
    if (canRaid(s, haulier) && haulier.cash - sharePrice >= VICTORY_CASH * 0.6) {
      return { type: 'BUY_SHARE' };
    }
  }

  // The exchange, before hulls and shares: it is the cheapest thing to be right about.
  const trade = stockAction(s, haulier);
  if (trade) return trade;

  // Debt costs interest every round, so clear it whenever the money is genuinely spare. Ahead of
  // the share market on purpose: a haulier servicing a loan out of a shrinking purse is losing.
  if (s.hazards?.loans && (haulier.debt ?? 0) > 0) {
    const spare = haulier.cash - Math.max(VICTORY_CASH, TRADING_FLOAT * 4);
    if (spare >= LOAN_STEP) return { type: 'REPAY_LOAN' };
  }

  // Every ordinary route shut and still behind: bid at the exchange.
  const bid = hostileBidAction(s, haulier);
  if (bid) return bid;

  // A cautious haulier buys her shares first and her vehicles after; an incautious one does the
  // reverse, and with wages running that is how she loses.
  if (
    vehicles.length < MAX_VEHICLES &&
    (skill.overbuysVehicles || haulier.shares < SHARE_MAJORITY - 1)
  ) {
    // Which class, when there is a choice. Not a fixed preference: a haulier short on slots wants
    // the artic's capacity, one already carrying plenty wants the rigid's extra pace instead.
    const wantsClasses = s.hazards?.vehicleClasses ?? false;
    const slots = vehicles.reduce((n, sh) => n + slotsOf(sh.vehicleClass), 0);
    const preference: VehicleClassId[] = !wantsClasses
      ? ['rigid_7_5']
      : slots >= 6
        ? ['rigid_18', 'rigid_7_5']
        : ['artic_44', 'rigid_7_5'];

    for (const id of preference) {
      const option = VEHICLE_CLASSES[id];
      const reserve = skill.overbuysVehicles ? TRADING_FLOAT : Math.max(TRADING_FLOAT, temperament.vehicleReserve);
      if (haulier.cash - option.price >= reserve) {
        return { type: 'BUY_VEHICLE', vehicleClass: id };
      }
    }
  }

  return null;
}

/** Mirrors the reducer's own test — proposing a buy-out it will reject just wastes the AI's turn. */
const canRaid = (s: GameState, haulier: Haulier): boolean =>
  s.hauliers.some(c => c.id !== haulier.id && c.shares > 0 && canBuyOut(haulier.shares, c.shares));

// ---------------------------------------------------------------------------

export function nextAiAction(s: GameState): GameAction | null {
  if (s.phase !== 'act') return null;
  const haulier = activeHaulier(s);
  if (haulier.kind !== 'ai') return null;
  // How well this table's computer hauliers play. See DIFFICULTIES in rules.ts — every handicap
  // is knowledge or discipline, never dice.
  const skill = levelOf(s, haulier.id);

  // Winning beats everything else on the board — but only claim it holding the cash the claim
  // actually requires.
  //
  // This was `VICTORY_CASH * 0.4`, on the theory that a haulier could trade the rest up before the
  // clock ran out. In practice they could not, and the harness showed *five* declare-and-lapse
  // cycles in a single 91-round game. Every one of them puts the countdown banner back on screen at
  // full, which is what "the game keeps counting down and never finishes" looks like from the
  // outside. A claim should be the end of the game, not a recurring event.
  if (haulier.shares >= SHARE_MAJORITY && !s.declaration && haulier.cash >= VICTORY_CASH) {
    return { type: 'DECLARE' };
  }

  const temperament = temperamentOf(haulier);
  const vehicles = vehiclesOf(s, haulier.id);
  const parked = vehicles.filter(sh => sh.location !== null);

  /**
   * Once this haulier has declared, the cash bar is the win condition and must be protected. The
   * investment path already guards it, but buying cargo did not — which is why the harness still
   * saw claims lapse "only £725 in hand", losing a won game for the sake of one more lot.
   */
  const declarer = s.declaration?.haulierId === haulier.id;
  const spendable = declarer ? Math.max(0, haulier.cash - VICTORY_CASH) : haulier.cash;

  // 1. Land anything that can be landed this instant.
  for (const vehicle of parked) {
    if (vehicle.hold.length === 0) continue;
    const here = s.contracts.find(
      c =>
        c.destination === vehicle.location &&
        vehicle.hold.some(lot => lot.good === c.good) &&
        c.fills.length < 2,
    );
    if (here) return { type: 'DELIVER', vehicleId: vehicle.id, contractId: here.id };
  }

  // 2. Fit out and insure, before anyone is ordered to sea.
  //
  // Two postures, and the difference matters. A haulier still building is buying protection for a
  // long campaign, so fittings are worth a real outlay. A haulier already holding a majority is
  // waiting on one number — the cash bar — and every pound of variance between here and there is
  // what stops them declaring. The harness found a game that never finished for exactly that
  // reason: a leader on six shares ransomed back below £750 again and again. For them, insurance is
  // the point (it converts variance into a small known cost) and fittings are just money leaving.
  const closingOut = haulier.shares >= SHARE_MAJORITY;

  if (s.hazards?.theft) {
    for (const vehicle of parked) {
      const holdValue = vehicle.hold.reduce((n, lot) => n + lot.paid, 0);
      const worthInsuring = closingOut ? holdValue > 0 : holdValue >= 90;
      if (worthInsuring && !vehicle.insured) {
        if (skill.fitsOut) return { type: 'SET_INSURANCE', vehicleId: vehicle.id, insured: true };
      }
      // Deliberately never closed again. A policy only costs anything at dispatch, and an empty
      // hold pays the minimum premium, so churning it open and shut saves almost nothing and
      // produced 800-odd log lines of noise across a handful of games.
    }
  }

  if (!closingOut) {
    // Fittings are a real outlay, so they wait for a real surplus. Buying aeroKit on every vehicle the
    // moment it was affordable diverted the money that buys shares and stretched the game.
    const surplus = spendable - TRADING_FLOAT - 60;
    for (const vehicle of parked) {
      if (s.hazards?.weather && !vehicle.fittings?.aeroKit && surplus >= FITTING_PRICES.aeroKit) {
        if (skill.fitsOut) return { type: 'BUY_FITTING', vehicleId: vehicle.id, fitting: 'aeroKit' };
      }
      if (
        s.hazards?.theft &&
        !vehicle.fittings?.tracker &&
        vehicle.hold.reduce((n, lot) => n + lot.paid, 0) >= 90 &&
        surplus >= FITTING_PRICES.tracker
      ) {
        if (skill.fitsOut) return { type: 'BUY_FITTING', vehicleId: vehicle.id, fitting: 'tracker' };
      }
    }
  }

  // 3. Loaded vehicles still in depot. Top up the hold first if there is a good reason to, then drive.
  for (const vehicle of parked) {
    if (vehicle.hold.length === 0) continue;
    const run = bestRunForLoadedVehicle(s, vehicle);

    // Filling spare slots with more of what she is already carrying multiplies the same run.
    if (run && vehicle.hold.length < slotsOf(vehicle.vehicleClass) && depotSupplies(vehicle.location!, run.contract.good)) {
      const price = priceAt(vehicle.location!, run.contract.good);
      if (spendable >= price) {
        return { type: 'BUY_CARGO', vehicleId: vehicle.id, good: run.contract.good };
      }
    }
    if (run) return { type: 'DRIVE_TO', vehicleId: vehicle.id, destination: run.contract.destination };

    // Nothing face-up wants any of it. Dumping now recovers nothing at all, so hold considerably
    // longer than when a half-price sale was available — the hull is only worth clearing once the
    // cargo is genuinely dead weight blocking better work.
    const oldest = Math.max(...vehicle.hold.map(lot => s.turn - lot.boughtOnTurn));
    if (oldest >= temperament.patience * 2 * skill.patienceScale && vehicle.hold.length >= slotsOf(vehicle.vehicleClass)) {
      // Sell it if the depot will take it — anything beats nothing, and she is standing right there.
      // Sell the single worst lot rather than the lot, so a hull is cleared a slot at a time and one
      // dud does not cost her the two lots that were fine.
      if (s.hazards?.depotSales && vehicle.location && !depotStruck(s, vehicle.location)) {
        const worst = [...vehicle.hold].sort(
          (a, b) =>
            depotSalePrice(vehicle.location!, a.good) - a.paid - (depotSalePrice(vehicle.location!, b.good) - b.paid),
        )[0];
        // Only where the depot deals in it; hawking cargo at a depot with no buyer is barely better
        // than the sea, and holding on for a depot that wants it is usually the better play.
        if (worst && depotSalePrice(vehicle.location, worst.good) >= worst.paid * 0.5) {
          return { type: 'SELL_CARGO', vehicleId: vehicle.id, good: worst.good };
        }
      }
      return { type: 'DUMP', vehicleId: vehicle.id };
    }
  }

  // 3b. Raise money before the bill falls due, rather than sliding into arrears.
  const loan = loanAction(s, haulier);
  if (loan) return loan;

  // 4. Too poor to buy the cheapest lot anywhere and holding shares? Cash one in.
  //
  //    This is the softlock escape, and it has to come *before* the driving below, which is the
  //    mistake the first version made. Sitting at step 4b it was unreachable: a haulier with vehicles
  //    always finds some card worth steering for, returns DRIVE_TO, and never falls through to here.
  //    The harness found her holding a winning six shares on £1 — no cargo, nothing affordable on
  //    any depot, and unraidable, because a forced buy-out needs the buyer to hold at least as many
  //    shares as the seller and she held the most. Four hundred rounds of driving to depots where she
  //    could not buy anything. A majority you can never turn into the £750 the win also needs is
  //    worth nothing, so sell one and trade back up.
  if (haulier.shares > 0 && haulier.cash < CHEAPEST_LOT && !vehicles.some(sh => sh.hold.length > 0)) {
    return { type: 'SELL_SHARE' };
  }

  // 4a. Empty vehicles in depot: load here if this is the source, otherwise drive for one.
  for (const vehicle of parked) {
    if (vehicle.hold.length > 0) continue;
    const run = bestRunForEmptyVehicle(s, vehicle.location!, haulier.id);

    if (run && run.source === vehicle.location) {
      if (spendable >= run.contract.price) {
        return { type: 'BUY_CARGO', vehicleId: vehicle.id, good: run.contract.good };
      }
    }

    if (run?.source && (run.score >= temperament.speculateBelow || temperament.speculateBelow === 0)) {
      if (run.source !== vehicle.location) {
        return { type: 'DRIVE_TO', vehicleId: vehicle.id, destination: run.source };
      }
    }

    // Speculators will load the best thing on the depot when no card is worth chasing.
    if (temperament.speculateBelow > 0 && (!run || run.score < temperament.speculateBelow)) {
      const good = bestSpeculativeLoad(s, spendable, vehicle.location!);
      if (good && depotSupplies(vehicle.location!, good) && !goodEmbargoed(s, good)) {
        return { type: 'BUY_CARGO', vehicleId: vehicle.id, good };
      }
    }

    // Nothing to load and nothing worth chasing — go where the cards generally are.
    if (run?.source) return { type: 'DRIVE_TO', vehicleId: vehicle.id, destination: run.source };
  }

  // 5. Put the money to work.
  return investmentAction(s, haulier);
}


