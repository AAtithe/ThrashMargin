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
import { HOME_DEPOT, goodName, depotName, depotSupplies } from './content';
import { drawContract, faceUpKeys, isContractComplete, nextRank } from './contracts';
import { destinationOf, plotCourse, pointsToDestination, reorderOnRoad, drive } from './movement';
import { roll2d6 } from './rng';
import { planFastestRoute, seasonOf, resolveDelay } from './weather';
import { indemnityFor, insurancePremium, resolveTheft, routeRisk } from './hazards';
import { priceAt, priceStanding, depotSalePrice } from './pricing';
import {
  COMPANIES,
  companyForDepot,
  holdingsValue,
  nextPrice,
  openingPrices,
  STOCK_IDS,
  type StockId,
} from './stocks';
import type { VehicleClassId } from './rules';
import {
  drawEvent,
  expired,
  goodEmbargoed,
  landedValue,
  depotStruck,
  remember,
  stillRunning,
} from './events';
import {
  canBuyOut,
  AEROKIT_SPEED_BONUS,
  DECLARATION_TURNS,
  FITTING_PRICES,
  LOG_LIMIT,
  MAX_VEHICLES,
  CONTRACT_LIFE_ROUNDS,
  freshness,
  PAYOUT_MULTIPLIERS,
  canHostileBid,
  hostileBidPrice,
  LOAN_INTEREST_PER_ROUND,
  LOAN_STEP,
  loanCeilingFor,
  loanRateLabel,
  wagesFor,
  hostileBidProceeds,
  SHARE_MAJORITY,
  SHARE_RAID_MULTIPLIER,
  TOTAL_SHARES,
  shareBuybackFor,
  sharePriceFor,
  VEHICLE_NAMES,
  VEHICLE_CLASSES,
  DEFAULT_VEHICLE_CLASS,
  slotsOf,
  speedOf,
  VICTORY_CASH,
} from './rules';
import { activeHaulier, isHotseat, vehiclesOf } from './state';
import { nextAiAction } from './ai';
import type {
  Haulier,
  ContractFill,
  GameAction,
  GameState,
  LogEntry,
  LogKind,
  Vehicle,
} from './types';

const money = (n: number) => `£${n.toLocaleString('en-GB')}`;

function log(
  s: GameState,
  kind: LogKind,
  text: string,
  haulierId: string | null = null,
  data?: Record<string, string | number>,
): GameState {
  const entry: LogEntry = { seq: s.nextLogSeq, turn: s.turn, round: s.round, haulierId, kind, text };
  if (data) entry.data = data;
  const next = [...s.log, entry];
  return {
    ...s,
    nextLogSeq: s.nextLogSeq + 1,
    log: next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next,
  };
}

const replaceVehicle = (s: GameState, vehicle: Vehicle): GameState => ({
  ...s,
  vehicles: s.vehicles.map(x => (x.id === vehicle.id ? vehicle : x)),
});

const updateHaulier = (s: GameState, id: string, patch: Partial<Haulier>): GameState => ({
  ...s,
  hauliers: s.hauliers.map(c => (c.id === id ? { ...c, ...patch } : c)),
});

/** The active haulier's vehicle, or null if the id is unknown, not theirs, or the phase is wrong. */
function ownVehicle(s: GameState, vehicleId: string): Vehicle | null {
  if (s.phase !== 'act') return null;
  const vehicle = s.vehicles.find(x => x.id === vehicleId);
  if (!vehicle) return null;
  return vehicle.ownerId === activeHaulier(s).id ? vehicle : null;
}

// ---------------------------------------------------------------------------
// Contract replacement
// ---------------------------------------------------------------------------

/** Retires any spent card and deals its replacement, keeping the five distinct. */
function replenishContracts(state: GameState): GameState {
  let s = state;
  for (const contract of s.contracts) {
    if (!isContractComplete(contract)) continue;
    const drawn = drawContract(s.rngSeed, s.deck, s.nextContractSeq, faceUpKeys(s.contracts), s.round);
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
      `New commission posted: ${depotName(drawn.contract.destination)} wants ${goodName(
        drawn.contract.good,
      )} at ${money(drawn.contract.price)} a lot. Load it wherever you can get it.`,
    );
  }
  return s;
}

// ---------------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------------

/**
 * Everything a haulier is worth: cash, vehicles at what they cost, shares at the bank's current band,
 * and whatever is in the holds. Used when a claim collapses and the game is decided on assets.
 */
export function assetValue(state: GameState, haulier: Haulier): number {
  const vehicles = state.vehicles.filter(sh => sh.ownerId === haulier.id);
  const holds = vehicles.reduce(
    (sum, sh) => sum + sh.hold.reduce((n, lot) => n + lot.paid, 0),
    0,
  );
  return (
    haulier.cash +
    vehicles.reduce((n, sh) => n + VEHICLE_CLASSES[sh.vehicleClass ?? DEFAULT_VEHICLE_CLASS].price, 0) +
    haulier.shares * sharePriceFor(TOTAL_SHARES - haulier.shares) +
    holds -
    // Net of what is owed. A failed declaration is settled on this figure, and a haulier who has
    // borrowed their way to the top of the table has not actually got there.
    (haulier.debt ?? 0) -
    (haulier.arrears ?? 0) +
    holdingsValue(haulier.holdings, state.stockPrices)
  );
}

function resolveDeclaration(state: GameState): GameState {
  const d = state.declaration;
  if (!d) return state;
  const haulier = state.hauliers.find(c => c.id === d.haulierId);
  if (!haulier) return { ...state, declaration: null };

  const vehicles = vehiclesOf(state, haulier.id).length;
  const holdsMajority = haulier.shares >= SHARE_MAJORITY;
  const holdsCash = haulier.cash >= VICTORY_CASH;

  if (holdsMajority && holdsCash && vehicles >= 1) {
    let s: GameState = { ...state, declaration: null, winnerId: haulier.id, phase: 'over' };
    return log(
      s,
      'victory',
      `${haulier.name} carries the company: ${haulier.shares} shares, ${money(
        haulier.cash,
      )} in hand and ${vehicles} vehicle${vehicles === 1 ? '' : 's'} still on the road.`,
      haulier.id,
    );
  }

  // A failed claim ends the game outright — the declarer loses, and the company goes to whoever
  // holds the most by value. Carried over from The Tea Race, and it means nobody is ever locked out of
  // winning just because they lost the share race: out-trade the table and the collapse hands it to
  // you. It also removes the endgame drag, since a lapse used to restart the whole thing.
  const missing: string[] = [];
  if (!holdsMajority) missing.push(`only ${haulier.shares} shares`);
  if (!holdsCash) missing.push(`only ${money(haulier.cash)} in hand`);
  if (vehicles < 1) missing.push('no vehicle running');

  const ranked = state.hauliers
    .filter(c => c.id !== haulier.id)
    .map(c => ({ c, worth: assetValue(state, c) }))
    .sort((a, b) => b.worth - a.worth);
  const heir = ranked[0];

  let s: GameState = { ...state, declaration: null, phase: 'over', winnerId: heir?.c.id ?? null };
  s = log(
    s,
    'lapse',
    `${haulier.name}'s claim collapses — ${missing.join(', ')}. The company is broken up.`,
    haulier.id,
  );
  if (heir) {
    s = log(
      s,
      'victory',
      `${heir.c.name} is left holding the most by value — ${money(
        heir.worth,
      )} in cash, vehicles and shares — and takes the company.`,
      heir.c.id,
    );
  }
  return s;
}

/**
 * Withdraws commissions that have been on the board too long and posts fresh ones.
 *
 * Expires a card whatever its state, including one that already has first money taken. Losing the
 * remaining second place to the clock is the sharpest version of the pressure this exists to create:
 * a run you were saving for later can simply stop being available.
 */
function expireContracts(state: GameState): GameState {
  if (!state.hazards?.deadlines) return state;

  let s = state;
  for (const contract of state.contracts) {
    const posted = contract.postedOn;
    if (posted === undefined) continue;
    if (s.round - posted < CONTRACT_LIFE_ROUNDS) continue;

    const drawn = drawContract(s.rngSeed, s.deck, s.nextContractSeq, faceUpKeys(s.contracts), s.round);
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
      `The ${goodName(contract.good)} commission for ${depotName(
        contract.destination,
      )} is withdrawn unfilled. ${depotName(drawn.contract.destination)} wants ${goodName(
        drawn.contract.good,
      )} in its place.`,
      null,
      { expired: contract.id, good: contract.good },
    );
  }
  return s;
}

/**
 * Runs the world event deck for the round just starting: retires what has expired, then draws.
 *
 * No new event is drawn once a declaration is live. The endgame is a fixed countdown against a
 * fixed target and it took real work to make it resolve exactly once; a strike landing on the
 * declarer's home depot mid-count would settle the game by dice instead of by play.
 *
 * Expiry, though, keeps running throughout — and it must. Gating the whole of this function on the
 * declaration was the first version, and it quietly froze the deck: anything in force at the moment
 * somebody declared stayed in force for the rest of the game, depot closures included. The harness
 * caught it as "bounty in force has not expired". Retiring news is never the unfair half.
 */
function turnTheWorld(state: GameState): GameState {
  if (!state.hazards?.events) return state;
  if (state.phase === 'over') return state;

  let s = state;
  const active = s.events ?? [];
  const done = expired(active, s.round);
  const running = stillRunning(active, s.round);

  if (done.length > 0) {
    s = { ...s, events: running };
    for (const e of done) {
      s = log(s, 'event', `${e.headline} — the news is stale; trade returns to normal.`, null, {
        event: e.kind,
        ended: 1,
      });
    }
  }

  if (s.declaration || s.winnerId) return s;

  const draw = drawEvent(s.rngSeed, s.round, running, s.nextEventSeq ?? 1, s.recentEvents ?? []);
  s = { ...s, rngSeed: draw.seed };
  if (!draw.event) return s;

  const e = draw.event;
  s = {
    ...s,
    events: [...(s.events ?? running), e],
    nextEventSeq: e.id + 1,
    recentEvents: remember(s.recentEvents ?? [], e.kind),
  };
  return log(s, 'event', `${e.headline}. ${e.detail}`, null, {
    event: e.kind,
    until: e.until,
    ...(e.depot ? { depot: e.depot } : {}),
    ...(e.good ? { good: e.good } : {}),
  });
}

/**
 * Moves the haulage exchange, then clears the round's trade tally.
 *
 * Prices are driven by what hauliers actually landed, so the market is a readable consequence of
 * play rather than a random walk: if you can see where the cards are sending everyone, you can see
 * which company is about to move.
 */
function settleExchange(state: GameState): GameState {
  if (!state.hazards?.stocks) return state;

  const prices = { ...(state.stockPrices ?? openingPrices()) };
  const volume = state.stockVolume ?? {};
  const moved: string[] = [];

  for (const id of STOCK_IDS) {
    const before = prices[id] ?? COMPANIES[id].base;
    const after = nextPrice(before, COMPANIES[id].base, volume[id] ?? 0);
    prices[id] = after;
    if (after !== before) moved.push(`${COMPANIES[id].name} ${after > before ? 'up' : 'down'} to ${money(after)}`);
  }

  let s: GameState = { ...state, stockPrices: prices, stockVolume: {} };
  if (moved.length > 0) s = log(s, 'stock', `On the exchange: ${moved.join(', ')}.`, null);
  return s;
}

/** Buy into one of the other companies at the price on the board. */
function doBuyStock(state: GameState, stock: StockId, lots = 1): GameState {
  if (state.phase !== 'act' || !state.hazards?.stocks) return state;
  if (!COMPANIES[stock] || lots < 1) return state;

  const haulier = activeHaulier(state);
  const price = state.stockPrices?.[stock] ?? COMPANIES[stock].base;
  const cost = price * lots;
  if (haulier.cash < cost) return state;

  const holdings = { ...(haulier.holdings ?? {}) };
  holdings[stock] = (holdings[stock] ?? 0) + lots;
  const s = updateHaulier(state, haulier.id, { cash: haulier.cash - cost, holdings });
  return log(
    s,
    'stock',
    `${haulier.name} buys ${lots} of ${COMPANIES[stock].name} at ${money(price)} — ${money(cost)}.`,
    haulier.id,
    { stock, lots, price },
  );
}

/** Sell out of a company at the price on the board. No discount: this is a real market. */
function doSellStock(state: GameState, stock: StockId, lots = 1): GameState {
  if (state.phase !== 'act' || !state.hazards?.stocks) return state;
  const haulier = activeHaulier(state);
  const held = haulier.holdings?.[stock] ?? 0;
  const selling = Math.min(held, Math.max(1, lots));
  if (selling <= 0) return state;

  const price = state.stockPrices?.[stock] ?? COMPANIES[stock].base;
  const holdings = { ...(haulier.holdings ?? {}) };
  holdings[stock] = held - selling;
  const s = updateHaulier(state, haulier.id, {
    cash: haulier.cash + price * selling,
    holdings,
  });
  return log(
    s,
    'stock',
    `${haulier.name} sells ${selling} of ${COMPANIES[stock].name} at ${money(price)} — ${money(
      price * selling,
    )}.`,
    haulier.id,
    { stock, lots: selling, price, sold: 1 },
  );
}

/**
 * Crew wages, victualling and interest, charged at the turn of every round.
 *
 * Deliberately not a bankruptcy system. A haulier who cannot pay hands over what they have and the
 * remainder becomes arrears, which are then taken off the top of anything they earn. That is a real
 * constraint — a broke haulier's next delivery is not their own money — without needing a way to
 * eliminate a player, which this game has no other use for and which would interact badly with a
 * share market that requires everyone to keep holding their shares.
 */
function chargeStandingCosts(state: GameState): GameState {
  const wagesOn = state.hazards?.wages ?? false;
  const loansOn = state.hazards?.loans ?? false;
  if (!wagesOn && !loansOn) return state;

  let s = state;
  for (const haulier of state.hauliers) {
    const vehicles = s.vehicles.filter(sh => sh.ownerId === haulier.id);
    const laden = vehicles.reduce((n, sh) => n + sh.hold.length, 0);

    const wages = wagesOn ? wagesFor(vehicles.length, laden) : 0;
    const debt = haulier.debt ?? 0;
    const interest = loansOn && debt > 0 ? Math.ceil(debt * LOAN_INTEREST_PER_ROUND) : 0;
    const owed = wages + interest + (haulier.arrears ?? 0);
    if (owed <= 0) continue;

    const current = s.hauliers.find(c => c.id === haulier.id)!;
    const paid = Math.min(current.cash, owed);
    const short = owed - paid;
    s = updateHaulier(s, haulier.id, {
      cash: current.cash - paid,
      ...(short > 0 || current.arrears ? { arrears: short } : {}),
    });

    s = log(
      s,
      'wages',
      short > 0
        ? `${haulier.name} cannot meet the ${money(owed)} due — ${money(paid)} paid, ${money(
            short,
          )} left owing.`
        : `${haulier.name} pays ${money(owed)} in wages${interest > 0 ? ' and interest' : ''}.`,
      haulier.id,
      { wages, interest, paid, arrears: short },
    );
  }
  return s;
}

/** Draw down another step against the fleet. */
function doTakeLoan(state: GameState): GameState {
  if (state.phase !== 'act' || !state.hazards?.loans) return state;
  const haulier = activeHaulier(state);
  const debt = haulier.debt ?? 0;
  const fleet = state.vehicles.filter(sh => sh.ownerId === haulier.id).length;
  if (debt + LOAN_STEP > loanCeilingFor(fleet, haulier.shares)) return state;

  let s = updateHaulier(state, haulier.id, {
    cash: haulier.cash + LOAN_STEP,
    debt: debt + LOAN_STEP,
  });
  return log(
    s,
    'wages',
    `${haulier.name} draws ${money(LOAN_STEP)} against the fleet — ${money(
      debt + LOAN_STEP,
    )} outstanding at ${loanRateLabel()} a round.`,
    haulier.id,
    { borrowed: LOAN_STEP, debt: debt + LOAN_STEP },
  );
}

/** Pay down as much of the debt as one step and the purse allow. */
function doRepayLoan(state: GameState): GameState {
  if (state.phase !== 'act' || !state.hazards?.loans) return state;
  const haulier = activeHaulier(state);
  const debt = haulier.debt ?? 0;
  if (debt <= 0) return state;
  const paying = Math.min(debt, LOAN_STEP, haulier.cash);
  if (paying <= 0) return state;

  const s = updateHaulier(state, haulier.id, {
    cash: haulier.cash - paying,
    debt: debt - paying,
  });
  return log(
    s,
    'wages',
    `${haulier.name} pays ${money(paying)} off the debt — ${money(debt - paying)} outstanding.`,
    haulier.id,
    { repaid: paying, debt: debt - paying },
  );
}

/** Moves to the next seat, handling the round roll-over and the declaration countdown. */
function advanceSeat(state: GameState): GameState {
  let s: GameState = { ...state, miles: {}, dice: {}, turn: state.turn + 1, phase: 'roll' };

  const nextIndex = (s.activeIndex + 1) % s.hauliers.length;
  s = { ...s, activeIndex: nextIndex };
  if (nextIndex === 0) {
    s = { ...s, round: s.round + 1 };
    s = chargeStandingCosts(s);
    s = settleExchange(s);
    s = expireContracts(s);
    s = turnTheWorld(s);
  }

  // Every individual turn, not once per completed round — see DECLARATION_TURNS. Read as rounds it
  // made the endgame forty-eight turns long at a four-haulier table.
  if (s.declaration) {
    const remaining = s.declaration.turnsRemaining - 1;
    s = { ...s, declaration: { ...s.declaration, turnsRemaining: remaining } };
    if (remaining <= 0) s = resolveDeclaration(s);
  }
  return s;
}

/**
 * Plays one computer haulier's whole turn, then hands the seat on. Exported because an all-AI
 * table (scripts/drive.ts) drives turns explicitly rather than relying on END_TURN's auto-run,
 * which only fires when there is a human waiting.
 *
 * `observe` is called after every action the haulier takes. A whole AI turn is otherwise atomic
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
  const hasHuman = s.hauliers.some(c => c.kind === 'human');

  if (hasHuman) {
    let guard = 0;
    while (s.phase !== 'over' && activeHaulier(s).kind === 'ai' && guard++ < s.hauliers.length) {
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
  const haulier = activeHaulier(state);
  const season = seasonOf(state.round);
  const weather = state.hazards?.weather ?? false;
  const theft = state.hazards?.theft ?? false;
  let s: GameState = { ...state, phase: 'act' };

  const miles: Record<string, number> = {};
  const dice: Record<string, [number, number]> = {};
  let seed = s.rngSeed;

  for (const vehicle of vehiclesOf(s, haulier.id)) {
    const r = roll2d6(seed);
    seed = r.seed;

    const aeroKit = vehicle.fittings?.aeroKit ? AEROKIT_SPEED_BONUS : 0;
    // Her class rides on the same roll as everything else, rather than being a separate stat, so a
    // heavy vehicle is slow in exactly the way bad weather is slow and the two simply add.
    const classSpeed = state.hazards?.vehicleClasses ? speedOf(vehicle.vehicleClass) : 0;
    miles[vehicle.id] = Math.max(0, r.total + aeroKit + classSpeed);
    dice[vehicle.id] = r.dice;
  }
  s = { ...s, rngSeed: seed, miles, dice };

  const rolls = Object.entries(dice)
    .map(([id, d]) => {
      const vehicle = s.vehicles.find(x => x.id === id);
      const total = s.miles[id] ?? 0;
      const raw = d[0] + d[1];
      return `${vehicle?.name}: ${d[0]}+${d[1]}${total !== raw ? ` = ${total}` : ''}`;
    })
    .join(', ');
  s = log(s, 'roll', `${haulier.name} rolls for the day's miles — ${rolls}.`, haulier.id);

  // Vehicles already on the road have no decision to make; advance them now.
  for (const vehicle of vehiclesOf(s, haulier.id)) {
    if (!vehicle.run) continue;

    const points = s.miles[vehicle.id] ?? 0;
    const outcome = drive(vehicle, points);
    s = replaceVehicle(s, outcome.vehicle);
    // Parking up forfeits the rest of the roll — you cannot bank the miles and set off again.
    const left = outcome.arrivedAt ? 0 : points - outcome.spent;
    s = { ...s, miles: { ...s.miles, [vehicle.id]: left } };
    if (outcome.arrivedAt) {
      s = log(s, 'arrive', `${vehicle.name} pulls into ${depotName(outcome.arrivedAt)} and parks up.`, haulier.id);
    } else if (outcome.spent > 0) {
      const dest = destinationOf(outcome.vehicle);
      s = log(
        s,
        'drive',
        `${vehicle.name} makes ${outcome.spent} points, ${pointsToDestination(
          outcome.vehicle,
        )} still to run to ${dest ? depotName(dest) : 'her destination'}.`,
        haulier.id,
      );
    }

    // Hazards fall on vehicles still on the road after the run — a vehicle that reached depot is safe in it.
    const stillOnRoad = s.vehicles.find(x => x.id === vehicle.id)!;
    if (weather && stillOnRoad.run) s = applyDelay(s, stillOnRoad, season, haulier.id);
    const stillAfloat = s.vehicles.find(x => x.id === vehicle.id)!;
    if (theft && stillAfloat.run) s = applyTheft(s, stillAfloat, haulier.id);
  }
  return s;
}

/** Weather on a vehicle on the road. Costs time and nothing else — never a vehicle, never a cargo. */
function applyDelay(state: GameState, vehicle: Vehicle, season: ReturnType<typeof seasonOf>, haulierId: string): GameState {
  const outcome = resolveDelay(state.rngSeed, vehicle, season);
  let s: GameState = { ...state, rngSeed: outcome.seed };
  if (outcome.setback <= 0 || !vehicle.run) return s;

  s = replaceVehicle(s, {
    ...vehicle,
    run: { ...vehicle.run, legRemaining: vehicle.run.legRemaining + outcome.setback },
  });
  // Whatever was left of this turn's roll goes with it.
  s = { ...s, miles: { ...s.miles, [vehicle.id]: 0 } };
  return log(
    s,
    'delay',
    `${vehicle.name} is caught by heavy weather and driven back ${outcome.setback} points.${
      vehicle.fittings?.aeroKit ? ' Her aeroKit saved her the worst of it.' : ''
    }`,
    haulierId,
    { vehicleId: vehicle.id, setback: outcome.setback },
  );
}

/** Theft on a vehicle on the road, on a route that carries a rating. Recovery is the common outcome. */
function applyTheft(state: GameState, vehicle: Vehicle, haulierId: string): GameState {
  const haulier = state.hauliers.find(c => c.id === haulierId)!;
  const outcome = resolveTheft(state.rngSeed, vehicle, haulier.cash);
  let s: GameState = { ...state, rngSeed: outcome.seed };
  if (outcome.kind === 'none') return s;

  const covered = vehicle.insured ? indemnityFor(outcome, vehicle) : 0;

  if (outcome.kind === 'recovery') {
    s = updateHaulier(s, haulierId, { cash: haulier.cash - outcome.amount + covered });
    s = log(
      s,
      'theft',
      `${vehicle.name} is held up and robbed for ${money(outcome.amount)}.${
        vehicle.fittings?.tracker ? ' Her tracker got the load back cheaply.' : ''
      }`,
      haulierId,
      { vehicleId: vehicle.id, recovery: outcome.amount },
    );
  } else {
    // Thieves take the whole load bed. With three slots that finally hurts, which is the point.
    const lost = vehicle.hold;
    s = replaceVehicle(s, { ...vehicle, hold: [] });
    if (covered > 0) s = updateHaulier(s, haulierId, { cash: haulier.cash + covered });
    s = log(
      s,
      'theft',
      `${vehicle.name} is taken and stripped — ${
        lost.length ? lost.map(l => goodName(l.good)).join(', ') : 'her cargo'
      } gone.`,
      haulierId,
      { vehicleId: vehicle.id, seized: lost.reduce((n, l) => n + l.paid, 0), units: lost.length },
    );
  }

  if (covered > 0) {
    s = log(
      s,
      'insurance',
      `The underwriters make ${money(covered)} good on ${vehicle.name}'s policy.`,
      haulierId,
      { vehicleId: vehicle.id, indemnity: covered },
    );
  }
  return s;
}

function doDriveTo(
  state: GameState,
  vehicleId: string,
  destination: string,
  via?: string[],
): GameState {
  const vehicle = ownVehicle(state, vehicleId);
  if (!vehicle) return state;

  // On the road: she may only be re-ordered to one end of the leg she is on.
  if (vehicle.location === null) {
    const turned = reorderOnRoad(vehicle, destination);
    if (!turned) return state;
    const haulier = activeHaulier(state);
    const putAbout = destination === vehicle.run!.legFrom;
    const s = replaceVehicle(state, turned);
    return log(
      s,
      'drive',
      putAbout
        ? `${vehicle.name} turns back and runs for ${depotName(destination)}.`
        : `${vehicle.name} is re-ordered to hold at ${depotName(destination)}.`,
      haulier.id,
      { vehicleId: vehicle.id, reordered: destination },
    );
  }

  if (vehicle.location === destination) return state;

  // No explicit path: plan the one a haulier would actually want — fastest for the season when
  // there is weather to reckon with, shortest when there is not.
  let path = via;
  if (!path && state.hazards?.weather) {
    path = planFastestRoute(
      vehicle.location,
      destination,
      seasonOf(state.round),
      vehicle.fittings?.aeroKit,
    )?.path;
  }

  const plotted = plotCourse(vehicle, destination, path);
  if (!plotted) return state;

  const haulier = activeHaulier(state);
  const points = state.miles[vehicle.id] ?? 0;

  // A standing policy is charged per run, at dispatch, priced from this course's real risk and
  // the cargo actually aboard.
  //
  // If the premium cannot be met the **cover lapses** and she drives uninsured, told plainly, rather
  // than refusing the dispatch — a lesson carried straight over from The Tea Race, which shipped the
  // stricter rule first and paid for it: a captain with a winning six shares, cargo aboard, orders
  // for a contract and £1 in hand sat unable to drive for four hundred rounds because every dispatch
  // was rejected for an unpaid premium, and being stuck like that made her unraidable too. A vehicle
  // stuck at a depot the same way here would be exactly as broken, so the rule is not repeated.
  let s: GameState = state;
  let driven = plotted;
  if (vehicle.insured && state.hazards?.theft) {
    const risk = routeRisk(vehicle.location, plotted.run!.route, seasonOf(state.round));
    const premium = insurancePremium(vehicle.hold.reduce((n, l) => n + l.paid, 0), risk);
    // A light passage costs nothing and is covered for nothing, so there is no bill to write about.
    if (premium <= 0) {
      // fall through: no charge, no entry, and the policy simply does not bite this run.
    } else if (haulier.cash < premium) {
      driven = { ...plotted, insured: false };
      s = log(
        s,
        'insurance',
        `${vehicle.name}'s policy lapses — the ${money(premium)} premium could not be met. She drives uncovered.`,
        haulier.id,
        { vehicleId: vehicle.id, premium, lapsed: 1 },
      );
    } else {
      s = updateHaulier(s, haulier.id, { cash: haulier.cash - premium });
      s = log(
        s,
        'insurance',
        `${vehicle.name}'s policy is endorsed for the passage — premium ${money(premium)}.`,
        haulier.id,
        { vehicleId: vehicle.id, premium, risk: Math.round(risk * 100) },
      );
    }
  }

  const outcome = drive(driven, points);
  s = replaceVehicle(s, outcome.vehicle);
  // Tying up forfeits the rest of the roll — see doRoll.
  const left = outcome.arrivedAt ? 0 : points - outcome.spent;
  s = { ...s, miles: { ...s.miles, [vehicle.id]: left } };

  if (outcome.arrivedAt) {
    s = log(
      s,
      'arrive',
      `${vehicle.name} runs to ${depotName(outcome.arrivedAt)} and parks up.`,
      haulier.id,
    );
  } else {
    s = log(
      s,
      'drive',
      `${vehicle.name} clears ${depotName(vehicle.location)} for ${depotName(destination)}${
        outcome.passed.length ? ` by way of ${outcome.passed.map(depotName).join(', ')}` : ''
      }.`,
      haulier.id,
    );
  }
  return s;
}

function doBuyCargo(state: GameState, vehicleId: string, good: string): GameState {
  const vehicle = ownVehicle(state, vehicleId);
  if (!vehicle || vehicle.location === null) return state;
  if (vehicle.hold.length >= slotsOf(vehicle.vehicleClass)) return state;
  if (!depotSupplies(vehicle.location, good)) return state;
  // A struck depot loads nothing and an embargoed good loads nowhere. Cargo already aboard is
  // untouched by both — only lading is stopped, so nobody is ever left holding an unlandable hold.
  if (depotStruck(state, vehicle.location)) return state;
  if (goodEmbargoed(state, good)) return state;

  const haulier = activeHaulier(state);
  // The depot's price, not the card's — see sim/pricing.ts for why those are different numbers.
  const price = priceAt(vehicle.location, good);
  if (price <= 0 || haulier.cash < price) return state;

  const standing = priceStanding(vehicle.location, good);
  let s = updateHaulier(state, haulier.id, { cash: haulier.cash - price });
  s = replaceVehicle(s, {
    ...vehicle,
    hold: [...vehicle.hold, { good, paid: price, boughtAt: vehicle.location, boughtOnTurn: s.turn }],
  });
  return log(
    s,
    'buy',
    `${vehicle.name} loads ${goodName(good)} at ${depotName(vehicle.location)} for ${money(price)}${
      standing === 'level' ? '' : standing === 'cheap' ? ' — under the reckoning' : ' — over the reckoning'
    } — ${vehicle.hold.length + 1} of ${slotsOf(vehicle.vehicleClass)} slots full.`,
    haulier.id,
  );
}

function doDeliver(state: GameState, vehicleId: string, contractId: string): GameState {
  const vehicle = ownVehicle(state, vehicleId);
  if (!vehicle || vehicle.location === null || vehicle.hold.length === 0) return state;

  const contract = state.contracts.find(c => c.id === contractId);
  if (!contract) return state;
  if (contract.destination !== vehicle.location) return state;
  if (depotStruck(state, vehicle.location)) return state;

  // Every matching slot is unloaded at once, and is paid per unit. This is carried over from The Tea Race's own
  // "fill all three slots with identical goods to maximise a single delivery payout".
  const landed = vehicle.hold.filter(lot => lot.good === contract.good);
  if (landed.length === 0) return state;

  const rank = nextRank(contract);
  if (rank === null) return state;

  const haulier = activeHaulier(state);
  // Priced through the event table, so a glut, a shortage or an Admiralty bounty is felt here and
  // the AI can score a plan with the identical call.
  //
  // Reckoned on the **card's** price per unit, never on what the haulier happened to pay for it.
  // Paying from `lot.paid` would mean the cheapest depot earned the least, so the correct play would
  // be to always buy at the dearest one — see sim/pricing.ts.
  const plain = landed.length * contract.price * PAYOUT_MULTIPLIERS[rank];
  // Each lot is paid on its own freshness, so a vehicle used as a warehouse earns less than one used
  // as a vehicle. Per lot rather than per delivery: three lots loaded at different times have
  // genuinely different ages.
  const spoils = state.hazards?.deadlines ?? false;
  const payout = landed.reduce((sum, lot) => {
    const full = landedValue(state, lot.good, contract.price, PAYOUT_MULTIPLIERS[rank]);
    return sum + (spoils ? Math.round(full * freshness(state.turn - lot.boughtOnTurn)) : full);
  }, 0);
  const fill: ContractFill = { haulierId: haulier.id, rank, paid: payout, onTurn: state.turn };

  let s = updateHaulier(state, haulier.id, { cash: haulier.cash + payout });
  // Trade landed here passes through whichever company works this region, and lifts its price at
  // the turn of the round.
  if (s.hazards?.stocks) {
    const company = companyForDepot(vehicle.location);
    if (company) {
      s = {
        ...s,
        stockVolume: { ...(s.stockVolume ?? {}), [company]: (s.stockVolume?.[company] ?? 0) + landed.length },
      };
    }
  }
  s = replaceVehicle(s, { ...vehicle, hold: vehicle.hold.filter(lot => lot.good !== contract.good) });
  s = {
    ...s,
    contracts: s.contracts.map(c => (c.id === contract.id ? { ...c, fills: [...c.fills, fill] } : c)),
  };
  s = log(
    s,
    'deliver',
    `${vehicle.name} lands ${landed.length} of ${goodName(contract.good)} at ${depotName(
      contract.destination,
    )} — ${rank === 1 ? 'first home' : 'second home'}, ${PAYOUT_MULTIPLIERS[rank]}x, ${money(payout)}.`,
    haulier.id,
    {
      contractId: contract.id,
      good: contract.good,
      rank,
      payout,
      /**
       * What the card would have paid with no news in force. The driver audits the multiplier off
       * this rather than off a hard-coded 4x, because a glut is *meant* to break that constant —
       * so the invariant worth checking is "payout equals plain except where the news says
       * otherwise", not "payout equals plain".
       */
      plain,
      units: landed.length,
      purchasePrice: landed.reduce((sum, lot) => sum + lot.paid, 0),
      /** Profit after what the depots actually charged — the number the sourcing decision moves. */
      margin: payout - landed.reduce((sum, lot) => sum + lot.paid, 0),
      cardPrice: contract.price,
    },
  );
  return replenishContracts(s);
}

/**
 * Over the side, recovering nothing. The source is explicit that dumping forfeits the whole purchase
 * price to the bank — which is what gives the "speculation bottleneck" teeth. An earlier authored
 * rule gave half back at a depot that wanted the goods, and made guessing wrong almost free.
 */
/**
 * Sell a lot off the vehicle at the depot she lies at.
 *
 * The published rule is that cargo you cannot place goes over the side and the whole purchase is
 * forfeit, and `doDump` still does exactly that. This is the toggleable mercy: you take a real
 * loss rather than a total one, and where you take it matters, because a depot that deals in the good
 * pays nearly twice what one that does not will offer.
 */
function doSellCargo(state: GameState, vehicleId: string, good: string): GameState {
  if (!state.hazards?.depotSales) return state;
  const vehicle = ownVehicle(state, vehicleId);
  if (!vehicle || vehicle.location === null || vehicle.hold.length === 0) return state;
  // A shut depot buys nothing, for the same reason it lades nothing.
  if (depotStruck(state, vehicle.location)) return state;

  const sold = vehicle.hold.filter(l => l.good === good);
  if (sold.length === 0) return state;
  const kept = vehicle.hold.filter(l => l.good !== good);

  const haulier = activeHaulier(state);
  const unit = depotSalePrice(vehicle.location, good);
  const takings = unit * sold.length;
  const paid = sold.reduce((sum, l) => sum + l.paid, 0);

  let s = updateHaulier(state, haulier.id, { cash: haulier.cash + takings });
  s = replaceVehicle(s, { ...vehicle, hold: kept });
  return log(
    s,
    'missed',
    `${vehicle.name} sells ${sold.length} ${goodName(good)} on the depot at ${depotName(
      vehicle.location,
    )} for ${money(takings)} — ${money(paid - takings)} down on what she paid.`,
    haulier.id,
    { vehicleId: vehicle.id, units: sold.length, takings, recovered: takings, forfeited: paid - takings },
  );
}

function doDump(state: GameState, vehicleId: string, good?: string): GameState {
  const vehicle = ownVehicle(state, vehicleId);
  if (!vehicle || vehicle.hold.length === 0) return state;

  const dumped = good ? vehicle.hold.filter(l => l.good === good) : vehicle.hold;
  if (dumped.length === 0) return state;
  const kept = good ? vehicle.hold.filter(l => l.good !== good) : [];

  const haulier = activeHaulier(state);
  const lost = dumped.reduce((sum, l) => sum + l.paid, 0);
  const s = replaceVehicle(state, { ...vehicle, hold: kept });
  return log(
    s,
    'missed',
    `${vehicle.name} puts ${dumped.length} ${
      good ? goodName(good) : 'lot' + (dumped.length === 1 ? '' : 's')
    } over the side — ${money(lost)} lost outright, ${slotsOf(vehicle.vehicleClass) - kept.length} slot${
      slotsOf(vehicle.vehicleClass) - kept.length === 1 ? '' : 's'
    } clear.`,
    haulier.id,
    { vehicleId: vehicle.id, units: dumped.length, forfeited: lost },
  );
}

function doBuyVehicle(state: GameState, requested?: VehicleClassId): GameState {
  if (state.phase !== 'act') return state;
  const haulier = activeHaulier(state);
  const owned = vehiclesOf(state, haulier.id);
  if (owned.length >= MAX_VEHICLES) return state;

  // With classes off there is only ever the default 7.5-tonner, whatever was asked for — so a UI that offers
  // the choice cannot smuggle a bigger class into a faithful game.
  const classes = state.hazards?.vehicleClasses ?? false;
  const chosen = classes ? (requested ?? DEFAULT_VEHICLE_CLASS) : DEFAULT_VEHICLE_CLASS;
  const vehicleClass = VEHICLE_CLASSES[chosen];
  if (!vehicleClass) return state;
  if (haulier.cash < vehicleClass.price) return state;

  const vehicle: Vehicle = {
    id: `s${state.nextVehicleSeq}`,
    ownerId: haulier.id,
    name: VEHICLE_NAMES[(state.nextVehicleSeq - 1) % VEHICLE_NAMES.length],
    // She is bought from the yard at home and fits out there, wherever her owner happens to be.
    location: HOME_DEPOT,
    run: null,
    hold: [],
    ...(classes ? { vehicleClass: chosen } : {}),
    ...(vehicleClass.fittings ? { fittings: { ...vehicleClass.fittings } } : {}),
  };

  let s: GameState = {
    ...state,
    vehicles: [...state.vehicles, vehicle],
    nextVehicleSeq: state.nextVehicleSeq + 1,
  };
  s = updateHaulier(s, haulier.id, { cash: haulier.cash - vehicleClass.price });
  return log(
    s,
    'vehicle',
    `${haulier.name} buys ${vehicle.name}, ${classes ? `a ${vehicleClass.name.toLowerCase()}, ` : ''}for ${money(
      vehicleClass.price,
    )} — ${vehicleClass.slots} slots${vehicleClass.fittings?.tracker ? ', tracker aboard' : ''}. She fits out at ${depotName(
      HOME_DEPOT,
    )}.`,
    haulier.id,
  );
}

function doBuyShare(state: GameState): GameState {
  if (state.phase !== 'act') return state;
  const haulier = activeHaulier(state);

  if (state.sharesRemaining > 0) {
    const price = sharePriceFor(state.sharesRemaining);
    if (haulier.cash < price) return state;
    let s: GameState = { ...state, sharesRemaining: state.sharesRemaining - 1 };
    s = updateHaulier(s, haulier.id, { cash: haulier.cash - price, shares: haulier.shares + 1 });
    return log(
      s,
      'share',
      `${haulier.name} takes up a share for ${money(price)} — ${haulier.shares + 1} held, ${
        s.sharesRemaining
      } left with the bank at ${money(sharePriceFor(s.sharesRemaining))}.`,
      haulier.id,
      { price, held: haulier.shares + 1, remaining: s.sharesRemaining },
    );
  }

  // Bank empty: a forced buy-out. Normally only of a haulier holding no more than you — but during
  // the countdown that restriction lifts entirely, which is The Tea Race's sabotage window.
  const sabotage = state.declaration !== null;
  const seller = state.hauliers
    .filter(c => c.id !== haulier.id && c.shares > 0 && canBuyOut(haulier.shares, c.shares, sabotage))
    // In the sabotage window you go for the leader; otherwise you absorb the smallest partner.
    .sort((a, b) =>
      sabotage
        ? b.shares - a.shares || state.hauliers.indexOf(a) - state.hauliers.indexOf(b)
        : a.shares - b.shares || state.hauliers.indexOf(a) - state.hauliers.indexOf(b),
    )[0];
  if (!seller) return state;

  const price = sharePriceFor(0) * SHARE_RAID_MULTIPLIER;
  if (haulier.cash < price) return state;

  let s = updateHaulier(state, haulier.id, {
    cash: haulier.cash - price,
    shares: haulier.shares + 1,
  });
  s = updateHaulier(s, seller.id, { cash: seller.cash + price, shares: seller.shares - 1 });
  return log(
    s,
    'share',
    sabotage
      ? `${haulier.name} buys a share out from under ${seller.name} for ${money(price)} — ${
          haulier.shares + 1
        } against ${seller.shares - 1}.`
      : `${haulier.name} buys a share off ${seller.name} on the exchange for ${money(price)} — ${
          haulier.shares + 1
        } against ${seller.shares - 1}.`,
    haulier.id,
  );
}

/**
 * Buy a share off a named haulier at a premium, whatever your own holding.
 *
 * The comeback move. Everything about it is deliberately expensive: it costs twice the bank's top
 * price to begin with, that price rises for *everyone* each time anyone uses it, and nearly a third
 * of what is paid vanishes in brokerage rather than reaching the seller. Those three together are
 * what let it break the `canBuyOut` shareholding rule without breaking the game's termination —
 * see `hostileBidPrice` in rules.ts for the argument.
 */
function doHostileBid(state: GameState, targetId: string): GameState {
  if (state.phase !== 'act') return state;
  if (!state.hazards?.hostileBids) return state;

  const buyer = activeHaulier(state);
  if (targetId === buyer.id) return state;
  const seller = state.hauliers.find(c => c.id === targetId);
  if (!seller) return state;

  const made = state.hostileBids ?? 0;
  if (!canHostileBid(buyer.shares, buyer.cash, seller.shares, made)) return state;

  const price = hostileBidPrice(made, buyer.shares);
  const proceeds = hostileBidProceeds(price);

  let s: GameState = { ...state, hostileBids: made + 1 };
  s = updateHaulier(s, buyer.id, { cash: buyer.cash - price, shares: buyer.shares + 1 });
  s = updateHaulier(s, seller.id, { cash: seller.cash + proceeds, shares: seller.shares - 1 });

  return log(
    s,
    'share',
    `${buyer.name} bids ${money(price)} at the exchange and takes a share off ${seller.name} — ` +
      `${buyer.shares + 1} against ${seller.shares - 1}. ${money(price - proceeds)} goes in ` +
      `brokerage, and her next such bid will cost ${money(hostileBidPrice(made + 1, buyer.shares + 1))}.`,
    buyer.id,
    { target: seller.id, price, proceeds, hostileBid: made + 1 },
  );
}

function doSellShare(state: GameState): GameState {
  if (state.phase !== 'act') return state;
  const haulier = activeHaulier(state);
  if (haulier.shares <= 0) return state;

  const proceeds = shareBuybackFor(state.sharesRemaining);
  let s: GameState = { ...state, sharesRemaining: state.sharesRemaining + 1 };
  s = updateHaulier(s, haulier.id, {
    cash: haulier.cash + proceeds,
    shares: haulier.shares - 1,
  });
  return log(
    s,
    'share',
    `${haulier.name} surrenders a share to the bank for ${money(proceeds)} — ${
      haulier.shares - 1
    } held. A poor price, but it buys a cargo.`,
    haulier.id,
  );
}

function doBuyFitting(state: GameState, vehicleId: string, fitting: 'tracker' | 'aeroKit'): GameState {
  const vehicle = ownVehicle(state, vehicleId);
  // Fitted out in depot, like anything else done to a vehicle.
  if (!vehicle || vehicle.location === null) return state;
  if (vehicle.fittings?.[fitting]) return state;

  const haulier = activeHaulier(state);
  const price = FITTING_PRICES[fitting];
  if (haulier.cash < price) return state;

  let s = updateHaulier(state, haulier.id, { cash: haulier.cash - price });
  s = replaceVehicle(s, { ...vehicle, fittings: { ...vehicle.fittings, [fitting]: true } });
  return log(
    s,
    'fitting',
    fitting === 'tracker'
      ? `${vehicle.name} is armed at ${depotName(vehicle.location)} for ${money(price)}.`
      : `${vehicle.name} is serviced at ${depotName(vehicle.location)} for ${money(price)} — a point faster, and easier on heavy weather.`,
    haulier.id,
    { vehicleId: vehicle.id, fitting, price },
  );
}

function doSetInsurance(state: GameState, vehicleId: string, insured: boolean): GameState {
  const vehicle = ownVehicle(state, vehicleId);
  if (!vehicle) return state;
  if ((vehicle.insured ?? false) === insured) return state;

  const haulier = activeHaulier(state);
  const s = replaceVehicle(state, { ...vehicle, insured });
  return log(
    s,
    'insurance',
    insured
      ? `${vehicle.name} is entered on an open policy — every run covered, premium taken at dispatch.`
      : `${vehicle.name}'s policy is closed. She drives at her owner's risk.`,
    haulier.id,
    { vehicleId: vehicle.id },
  );
}

function doDeclare(state: GameState): GameState {
  if (state.phase !== 'act' || state.declaration) return state;
  const haulier = activeHaulier(state);
  if (haulier.shares < SHARE_MAJORITY) return state;

  const s: GameState = {
    ...state,
    declaration: {
      haulierId: haulier.id,
      declaredOnRound: state.round,
      turnsRemaining: DECLARATION_TURNS,
    },
  };
  return log(
    s,
    'declare',
    `${haulier.name} declares a majority — ${haulier.shares} of the ten. The company is wound up in ${DECLARATION_TURNS} turns; ${money(
      VICTORY_CASH,
    )} and a vehicle must still be in hand.`,
    haulier.id,
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
    case 'DRIVE_TO':
      return doDriveTo(state, action.vehicleId, action.destination, action.via);
    case 'BUY_CARGO':
      return doBuyCargo(state, action.vehicleId, action.good);
    case 'DELIVER':
      return doDeliver(state, action.vehicleId, action.contractId);
    case 'SELL_CARGO':
      return doSellCargo(state, action.vehicleId, action.good);
    case 'DUMP':
      return doDump(state, action.vehicleId, action.good);
    case 'BUY_VEHICLE':
      return doBuyVehicle(state, action.vehicleClass);
    case 'BUY_FITTING':
      return doBuyFitting(state, action.vehicleId, action.fitting as 'tracker' | 'aeroKit');
    case 'SET_INSURANCE':
      return doSetInsurance(state, action.vehicleId, action.insured);
    case 'BUY_STOCK':
      return doBuyStock(state, action.stock, action.lots);
    case 'SELL_STOCK':
      return doSellStock(state, action.stock, action.lots);
    case 'TAKE_LOAN':
      return doTakeLoan(state);
    case 'REPAY_LOAN':
      return doRepayLoan(state);
    case 'BUY_SHARE':
      return doBuyShare(state);
    case 'SELL_SHARE':
      return doSellShare(state);
    case 'HOSTILE_BID':
      return doHostileBid(state, action.targetId);
    case 'DECLARE':
      return doDeclare(state);
    case 'END_TURN':
      // Rolling is not optional — ending a turn without it would silently skip the miles.
      return state.phase === 'act' ? endTurn(state) : state;
    default:
      return state;
  }
}
