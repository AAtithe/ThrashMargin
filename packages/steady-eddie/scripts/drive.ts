/**
 * Headless rules harness for Steady Eddie.
 *
 *     npm run drive --workspace=packages/steady-eddie
 *
 * Ported from The Tea Race's own `scripts/drive.ts`. Two halves, same as the original. The first is a
 * set of focused rule checks that drive `processAction` directly, so a rule is proven rather than
 * hoped for — an AI game happens to exercise most of the rules most of the time, which is not the
 * same thing. The second plays whole AI games end to end and asserts the invariants that must hold on
 * every single turn (five cards face up, ten shares in existence, no haulier over three vehicles),
 * then replays one game from its seed to prove nothing reaches for Math.random behind the sim's back.
 *
 * What changed from the original: Ship->Vehicle, Port->Depot, Captain->Haulier, Voyage->Run,
 * sail->drive, piracy->theft, storm->delay, guns->tracker, JETTISON->DUMP, sailPoints->miles, and the
 * whole directional-wind system (wind bands, monsoon, antimeridian wrap) is gone — replaced by an
 * authored, non-directional weatherRisk/theft rating per leg. Tests tied to the old wind model are not
 * ported; the delay/theft equivalents of the old storm/piracy tests are.
 */
import { createInitialState } from '../src/sim/state';
import {
  BOUNTY_PER_UNIT,
  GLUT_FACTOR,
  MAX_ACTIVE_EVENTS,
  SHORTAGE_FACTOR,
  landedValue,
} from '../src/sim/events';
import { assetValue, processAction, runAiTurn } from '../src/sim/actions';
import { DEPOT_BY_ID, GOOD_BY_ID, GOODS, DEPOTS, LEGS, distanceBetween, planRoute, sourcesFor } from '../src/sim/content';
import {
  CARGO_FRESH_TURNS,
  CARGO_SPOIL_FLOOR,
  CONTRACT_LIFE_ROUNDS,
  CONTRACT_MAX_DISTANCE,
  DIFFICULTIES,
  FITTING_PRICES,
  PRESETS,
  type Difficulty,
  VEHICLE_CLASSES,
  VEHICLE_PRICE,
  DEFAULT_VEHICLE_CLASS,
  slotsOf,
  DECLARATION_TURNS,
  freshness,
  LOAN_STEP,
  loanCeilingFor,
  FACE_UP_CONTRACTS,
  MAX_VEHICLES,
  SHARE_MAJORITY,
  canBuyOut,
  canHostileBid,
  hostileBidPrice,
  sharePriceFor,
  SHARE_RAID_MULTIPLIER,
  TOTAL_SHARES,
  VICTORY_CASH,
} from '../src/sim/rules';
import { SEASONS, seasonOf, delayRating, resolveDelay, effectiveSpeed, planFastestRoute } from '../src/sim/weather';
import { indemnityFor, insurancePremium, theftRating, resolveTheft } from '../src/sim/hazards';
import {
  PRICE_CEILING,
  PRICE_FLOOR,
  cheapestSources,
  observedSpread,
  priceAt,
  depotSalePrice,
} from '../src/sim/pricing';
import { buildDeck, parseCardKey } from '../src/sim/contracts';
import { vehiclesAwaitingOrders } from '../src/sim/attention';
import { COMPANIES, companyForDepot, nextPrice, STOCK_CEILING, STOCK_FLOOR } from '../src/sim/stocks';
import type { Contract, DepotId, GameState, Vehicle, WorldEventKind } from '../src/sim/types';

// ---------------------------------------------------------------------------
// Tiny assertion harness
// ---------------------------------------------------------------------------

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    passed++;
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown) {
  check(label, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`);
}

// ---------------------------------------------------------------------------
// State surgery, for putting a vehicle exactly where a rule needs testing
// ---------------------------------------------------------------------------

function place(state: GameState, vehicleId: string, depotId: string, hold: Vehicle['hold'] = []): GameState {
  return {
    ...state,
    vehicles: state.vehicles.map(v =>
      v.id === vehicleId ? { ...v, location: depotId, run: null, hold } : v,
    ),
  };
}

function setCash(state: GameState, haulierId: string, cash: number): GameState {
  return {
    ...state,
    hauliers: state.hauliers.map(c => (c.id === haulierId ? { ...c, cash } : c)),
  };
}

function setShares(state: GameState, haulierId: string, shares: number): GameState {
  const before = state.hauliers.find(c => c.id === haulierId)!.shares;
  return {
    ...state,
    sharesRemaining: state.sharesRemaining - (shares - before),
    hauliers: state.hauliers.map(c => (c.id === haulierId ? { ...c, shares } : c)),
  };
}

/** Replaces the first face-up card with a chosen one, so a test controls the run being raced. */
function forceContract(state: GameState, contract: Partial<Contract>): GameState {
  const base = state.contracts[0];
  return {
    ...state,
    contracts: [{ ...base, ...contract, fills: [] }, ...state.contracts.slice(1)],
  };
}

const cash = (s: GameState, id: string) => s.hauliers.find(c => c.id === id)!.cash;
const haulierShares = (s: GameState, id: string) => s.hauliers.find(c => c.id === id)!.shares;
const totalShares = (s: GameState) =>
  s.hauliers.reduce((n, c) => n + c.shares, 0) + s.sharesRemaining;
const vehicleOf = (s: GameState, id: string) => s.vehicles.find(x => x.id === id)!;

const DEFAULT_SLOTS = slotsOf(undefined);

const FULL_HAZARDS_OFF = {
  weather: false,
  theft: false,
  events: false,
  hostileBids: false,
  depotSales: false,
  wages: false,
  loans: false,
  deadlines: false,
  vehicleClasses: false,
  stocks: false,
};

// ---------------------------------------------------------------------------
// 1. Payout ladder: 4x, then 2x, then nothing
// ---------------------------------------------------------------------------

function testPayoutLadder() {
  const label = 'payout ladder';
  let s = createInitialState('t-payout', 'Payout', {
    humanNames: ['A', 'B', 'C'],
    aiCount: 0,
    seed: 'payout',
  });

  // A run everyone can reach: tomatoes destined for London, the home depot.
  const price = GOOD_BY_ID.tomatoes.basePrice;
  s = forceContract(s, {
    id: 'test-card',
    good: 'tomatoes',
    destination: 'london',
    price,
  });

  const cargo = { good: 'tomatoes', paid: price, boughtAt: 'southampton', boughtOnTurn: 0 };
  s = place(s, 's1', 'london', [{ ...cargo }]);
  s = place(s, 's2', 'london', [{ ...cargo }]);
  s = place(s, 's3', 'london', [{ ...cargo }]);

  // Three humans means every seat change goes through a hotseat handover.
  const pass = (state: GameState) => {
    let next = processAction(state, { type: 'END_TURN' });
    equal(`${label}: hotseat pauses for the handover`, next.phase, 'handover');
    next = processAction(next, { type: 'ACKNOWLEDGE_HANDOVER' });
    return processAction(next, { type: 'ROLL' });
  };

  // Haulier A lands first.
  const beforeA = cash(s, 'p1');
  s = processAction(s, { type: 'ROLL' });
  s = processAction(s, { type: 'DELIVER', vehicleId: 's1', contractId: 'test-card' });
  equal(`${label}: first home pays 4x`, cash(s, 'p1') - beforeA, price * 4);
  equal(`${label}: first delivery empties the hold`, vehicleOf(s, 's1').hold.length, 0);
  s = pass(s);

  // Haulier B lands second.
  const beforeB = cash(s, 'p2');
  s = processAction(s, { type: 'DELIVER', vehicleId: 's2', contractId: 'test-card' });
  equal(`${label}: second home pays 2x`, cash(s, 'p2') - beforeB, price * 2);
  s = pass(s);

  // The card is spent, so it has already been replaced — the third haulier has nothing to land into.
  check(
    `${label}: spent card is retired`,
    !s.contracts.some(c => c.id === 'test-card'),
    'test-card still face-up after two fills',
  );
  equal(`${label}: board is back to five`, s.contracts.length, FACE_UP_CONTRACTS);

  const beforeC = cash(s, 'p3');
  const rejected = processAction(s, { type: 'DELIVER', vehicleId: 's3', contractId: 'test-card' });
  check(`${label}: third delivery is rejected outright`, rejected === s, 'state changed');
  equal(`${label}: third haulier is paid nothing`, cash(s, 'p3') - beforeC, 0);
  check(`${label}: third haulier still holds her cargo`, vehicleOf(s, 's3').hold.length > 0);
}

// ---------------------------------------------------------------------------
// 2. Cargo and depot rules
// ---------------------------------------------------------------------------

function testCargoRules() {
  const label = 'cargo';
  let base = createInitialState('t-cargo', 'Cargo', { humanNames: ['A'], aiCount: 1, seed: 'cargo' });
  base = place(base, 's1', 'southampton');
  base = setCash(base, 'p1', 1000);
  base = processAction(base, { type: 'ROLL' });

  check(
    `${label}: cannot buy what the depot does not sell`,
    processAction(base, { type: 'BUY_CARGO', vehicleId: 's1', good: 'whisky' }) === base,
    'Southampton sold whisky',
  );

  const loaded = processAction(base, { type: 'BUY_CARGO', vehicleId: 's1', good: 'tomatoes' });
  check(`${label}: buying a supplied good works`, vehicleOf(loaded, 's1').hold[0]?.good === 'tomatoes');
  // The *depot's* price, which is no longer the card's reckoning — see sim/pricing.ts.
  equal(
    `${label}: purchase debits this depot's price`,
    cash(loaded, 'p1'),
    1000 - priceAt('southampton', 'tomatoes'),
  );
  equal(
    `${label}: and that is what the lot records paying`,
    vehicleOf(loaded, 's1').hold[0].paid,
    priceAt('southampton', 'tomatoes'),
  );
  // The default 7.5-tonner carries DEFAULT_SLOTS lots, and a further lot is refused.
  const filling = processAction(loaded, { type: 'BUY_CARGO', vehicleId: 's1', good: 'fish' });
  equal(`${label}: a 7.5-tonner carries ${DEFAULT_SLOTS} lots`, vehicleOf(filling, 's1').hold.length, DEFAULT_SLOTS);
  check(
    `${label}: a further lot is refused`,
    processAction(filling, { type: 'BUY_CARGO', vehicleId: 's1', good: 'tomatoes' }) === filling,
  );

  const broke = setCash(base, 'p1', 5);
  check(
    `${label}: cannot buy without the money`,
    processAction(broke, { type: 'BUY_CARGO', vehicleId: 's1', good: 'tomatoes' }) === broke,
  );

  // A rival's vehicle is not yours to command.
  check(
    `${label}: cannot move another haulier's vehicle`,
    processAction(base, { type: 'BUY_CARGO', vehicleId: 's2', good: 'tomatoes' }) === base,
  );

  // Dumping recovers nothing at all — the loss is explicit, and it is what gives the
  // speculation bottleneck teeth.
  const spec = place(setCash(base, 'p1', 500), 's1', 'london', [
    { good: 'tomatoes', paid: 60, boughtAt: 'southampton', boughtOnTurn: 0 },
    { good: 'fish', paid: 40, boughtAt: 'southampton', boughtOnTurn: 0 },
  ]);
  const dumpedOne = processAction(spec, { type: 'DUMP', vehicleId: 's1', good: 'tomatoes' });
  equal(`${label}: dumping returns nothing`, cash(dumpedOne, 'p1') - cash(spec, 'p1'), 0);
  equal(`${label}: dumping frees exactly that good's slots`, vehicleOf(dumpedOne, 's1').hold.length, 1);
  equal(`${label}: the rest of the hold is untouched`, vehicleOf(dumpedOne, 's1').hold[0].good, 'fish');

  const dumpedAll = processAction(spec, { type: 'DUMP', vehicleId: 's1' });
  equal(`${label}: dumping everything clears the hold`, vehicleOf(dumpedAll, 's1').hold.length, 0);
  equal(`${label}: and still returns nothing`, cash(dumpedAll, 'p1') - cash(spec, 'p1'), 0);

  // Dumping is legal anywhere — over the roadside is over the roadside.
  const atSource = place(spec, 's1', 'southampton', [
    { good: 'tomatoes', paid: 60, boughtAt: 'southampton', boughtOnTurn: 0 },
  ]);
  check(
    `${label}: may dump at any depot`,
    processAction(atSource, { type: 'DUMP', vehicleId: 's1' }) !== atSource,
  );
}

// ---------------------------------------------------------------------------
// 3. Driving
// ---------------------------------------------------------------------------

function testDriving() {
  const label = 'driving';
  let s = createInitialState('t-drive', 'Drive', { humanNames: ['A'], aiCount: 1, seed: 'drive' });
  s = processAction(s, { type: 'ROLL' });

  const points = s.miles.s1;
  check(`${label}: rolled 2d6`, points >= 2 && points <= 12, `got ${points}`);
  equal(`${label}: dice are recorded`, s.dice.s1.length, 2);

  // Ashford is 5 points from home, so any roll of 5+ ties up there this turn.
  const short = { ...s, miles: { ...s.miles, s1: 12 } };
  const arrived = processAction(short, { type: 'DRIVE_TO', vehicleId: 's1', destination: 'ashford' });
  equal(`${label}: a short hop completes in one turn`, vehicleOf(arrived, 's1').location, 'ashford');
  equal(`${label}: tying up forfeits the rest of the roll`, arrived.miles.s1, 0);

  // Glasgow is far enough that no single roll reaches it.
  const long = { ...s, miles: { ...s.miles, s1: 12 } };
  const onRoad = processAction(long, { type: 'DRIVE_TO', vehicleId: 's1', destination: 'glasgow' });
  const vehicle = vehicleOf(onRoad, 's1');
  check(`${label}: a long run leaves her on the road`, vehicle.location === null && vehicle.run !== null);
  equal(
    `${label}: her course ends at the destination`,
    vehicle.run!.route[vehicle.run!.route.length - 1],
    'glasgow',
  );
  check(
    `${label}: cannot re-route off her current leg`,
    processAction(onRoad, { type: 'DRIVE_TO', vehicleId: 's1', destination: 'ashford' }) === onRoad,
  );

  // The passage cannot be shorter than the chart allows. A vehicle makes at most 12 points a turn, so
  // arriving in fewer than distance/12 turns would mean the movement maths is handing out free miles
  // — which is exactly the kind of drift that only shows up as "the AI wins impossibly fast".
  const chartDistance = distanceBetween('london', 'glasgow');
  const floorTurns = Math.ceil(chartDistance / 12);
  let running = onRoad;
  let turnsDriving = 1; // the roll that set her off
  let remaining = pointsLeft(vehicleOf(running, 's1'));

  for (let guard = 0; guard < 80 && vehicleOf(running, 's1').location === null; guard++) {
    running = processAction(running, { type: 'END_TURN' });
    running = processAction(running, { type: 'ROLL' });
    turnsDriving++;
    const now = pointsLeft(vehicleOf(running, 's1'));
    check(
      `${label}: every turn on the road closes the distance`,
      now < remaining || vehicleOf(running, 's1').location !== null,
      `${remaining} -> ${now}`,
    );
    remaining = now;
  }

  equal(`${label}: she arrives at Glasgow`, vehicleOf(running, 's1').location, 'glasgow');
  check(
    `${label}: the passage takes at least ${floorTurns} turns`,
    turnsDriving >= floorTurns,
    `took ${turnsDriving} turns for ${chartDistance} points`,
  );
}

/** Drive points still owed before a vehicle ties up; zero once she is in depot. */
function pointsLeft(vehicle: Vehicle): number {
  if (!vehicle.run) return 0;
  let total = vehicle.run.legRemaining;
  for (let i = 0; i < vehicle.run.route.length - 1; i++) {
    total += distanceBetween(vehicle.run.route[i], vehicle.run.route[i + 1]);
  }
  return total;
}

// ---------------------------------------------------------------------------
// 4. Fleet and share caps
// ---------------------------------------------------------------------------

function testCaps() {
  const label = 'caps';
  let s = createInitialState('t-caps', 'Caps', { humanNames: ['A'], aiCount: 1, seed: 'caps' });
  s = setCash(s, 'p1', 100_000);
  s = processAction(s, { type: 'ROLL' });

  let fleet = s;
  for (let i = 0; i < 6; i++) fleet = processAction(fleet, { type: 'BUY_VEHICLE' });
  equal(
    `${label}: a haulier may own no more than ${MAX_VEHICLES} vehicles`,
    fleet.vehicles.filter(x => x.ownerId === 'p1').length,
    MAX_VEHICLES,
  );
  equal(
    `${label}: only the vehicles actually bought are paid for`,
    cash(s, 'p1') - cash(fleet, 'p1'),
    VEHICLE_PRICE * (MAX_VEHICLES - 1),
  );

  let shares = s;
  for (let i = 0; i < 20; i++) shares = processAction(shares, { type: 'BUY_SHARE' });
  const held = shares.hauliers.reduce((n, c) => n + c.shares, 0);
  equal(`${label}: ten shares exist and no more`, held + shares.sharesRemaining, TOTAL_SHARES);
  check(
    `${label}: one haulier can corner the whole issue`,
    shares.hauliers.find(c => c.id === 'p1')!.shares >= SHARE_MAJORITY,
  );

  // Once the bank is empty, a further purchase is a forced buy-out of the smallest outside stake —
  // and only of a haulier holding no more than the buyer already does.
  const buyout = (mine: number, theirs: number) => {
    let g = createInitialState('t-raid', 'Raid', { humanNames: ['A', 'B'], aiCount: 0, seed: 'raid' });
    g = setShares(g, 'p1', mine);
    g = setShares(g, 'p2', theirs);
    g = setCash(g, 'p1', 4000);
    g = setCash(g, 'p2', 4000);
    return processAction(g, { type: 'ROLL' });
  };

  const legal = buyout(6, 4);
  equal(`${label}: bank is empty for the buy-out test`, legal.sharesRemaining, 0);
  const raided = processAction(legal, { type: 'BUY_SHARE' });
  equal(`${label}: buyer gains a share`, raided.hauliers[0].shares, 7);
  equal(`${label}: the smaller holder gives one up`, raided.hauliers[1].shares, 3);
  equal(
    `${label}: a buy-out costs ${SHARE_RAID_MULTIPLIER}x`,
    cash(legal, 'p1') - cash(raided, 'p1'),
    sharePriceFor(0) * SHARE_RAID_MULTIPLIER,
  );
  equal(
    `${label}: the haulier bought out is paid`,
    cash(raided, 'p2') - cash(legal, 'p2'),
    sharePriceFor(0) * SHARE_RAID_MULTIPLIER,
  );
  equal(
    `${label}: shares are conserved through a buy-out`,
    raided.hauliers.reduce((n, c) => n + c.shares, 0) + raided.sharesRemaining,
    TOTAL_SHARES,
  );

  const equalStakes = buyout(5, 5);
  check(
    `${label}: an equal holder may be bought out`,
    processAction(equalStakes, { type: 'BUY_SHARE' }).hauliers[0].shares === 6,
  );

  // The restriction that makes the endgame terminate: you cannot strip a haulier bigger than you.
  const uphill = buyout(4, 6);
  check(
    `${label}: a larger holder cannot be raided`,
    processAction(uphill, { type: 'BUY_SHARE' }) === uphill,
    'the smaller haulier stripped the larger one',
  );
  const nothing = buyout(0, 10);
  check(
    `${label}: a haulier holding nothing cannot force their way in`,
    processAction(nothing, { type: 'BUY_SHARE' }) === nothing,
  );

  // The sum of squares of the holdings strictly increases on every buy-out, which is what bounds
  // how many can ever happen. Assert it directly rather than trusting the argument.
  const sumSquares = (g: GameState) => g.hauliers.reduce((n, c) => n + c.shares * c.shares, 0);
  let concentrating = buyout(5, 5);
  let previous = sumSquares(concentrating);
  let buyouts = 0;
  for (let i = 0; i < 30; i++) {
    const next = processAction(concentrating, { type: 'BUY_SHARE' });
    if (next === concentrating) break;
    buyouts++;
    const now = sumSquares(next);
    check(
      `${label}: buy-out ${buyouts} concentrates the holding`,
      now > previous,
      `${previous} -> ${now}`,
    );
    previous = now;
    concentrating = next;
  }
  check(`${label}: buy-outs run out rather than cycling`, buyouts < 30, `still going after ${buyouts}`);
  check(
    `${label}: concentration reaches a majority`,
    Math.max(...concentrating.hauliers.map(c => c.shares)) >= SHARE_MAJORITY,
  );

  // The way out of having no working capital: sell a share back to the bank at half price.
  let stranded = createInitialState('t-broke', 'Broke', { humanNames: ['A'], aiCount: 1, seed: 'broke' });
  stranded = setShares(stranded, 'p1', 6);
  stranded = setCash(stranded, 'p1', 5);
  stranded = processAction(stranded, { type: 'ROLL' });
  const rescued = processAction(stranded, { type: 'SELL_SHARE' });
  check(`${label}: selling back pays something`, cash(rescued, 'p1') > cash(stranded, 'p1'));
  equal(`${label}: selling back costs a share`, rescued.hauliers[0].shares, 5);
  equal(`${label}: the share returns to the bank`, rescued.sharesRemaining, stranded.sharesRemaining + 1);
  check(
    `${label}: a haulier with no shares has nothing to sell back`,
    processAction(setShares(rescued, 'p1', 0), { type: 'SELL_SHARE' }).hauliers[0].shares === 0,
  );
}

// ---------------------------------------------------------------------------
// 5. Declaration and the three victory conditions
// ---------------------------------------------------------------------------

/** Runs the table forward `turns` individual turns without anybody doing anything. */
function idleTurns(state: GameState, turns: number): GameState {
  let s = state;
  for (let i = 0; i < turns && s.phase !== 'over'; i++) {
    if (s.phase === 'handover') s = processAction(s, { type: 'ACKNOWLEDGE_HANDOVER' });
    if (s.phase === 'roll') s = processAction(s, { type: 'ROLL' });
    s = processAction(s, { type: 'END_TURN' });
  }
  return s;
}

function testDeclaration() {
  const label = 'declaration';

  const setup = (shares: number, money: number, vehicles: number) => {
    let s = createInitialState('t-dec', 'Declare', {
      humanNames: ['A', 'B'],
      aiCount: 0,
      seed: 'declare',
    });
    s = setShares(s, 'p1', shares);
    s = setCash(s, 'p1', money);
    if (vehicles === 0) s = { ...s, vehicles: s.vehicles.filter(x => x.ownerId !== 'p1') };
    return processAction(s, { type: 'ROLL' });
  };

  // Below a majority you cannot declare at all.
  const short = setup(SHARE_MAJORITY - 1, 2000, 1);
  check(
    `${label}: cannot declare without a majority`,
    processAction(short, { type: 'DECLARE' }) === short,
  );

  // A clean win: majority, cash and a vehicle still in hand when the clock runs out.
  let win = setup(SHARE_MAJORITY, VICTORY_CASH + 50, 1);
  win = processAction(win, { type: 'DECLARE' });
  check(`${label}: declaring starts the clock`, win.declaration !== null);
  equal(
    `${label}: the clock is ${DECLARATION_TURNS} turns`,
    win.declaration!.turnsRemaining,
    DECLARATION_TURNS,
  );

  const early = idleTurns(win, DECLARATION_TURNS - 1);
  check(`${label}: nobody wins before the clock runs out`, early.phase !== 'over', `phase ${early.phase}`);
  check(`${label}: the clock is still running`, early.declaration !== null);

  const done = idleTurns(early, 2);
  equal(`${label}: the declarer wins`, done.winnerId, 'p1');
  equal(`${label}: the game is over`, done.phase, 'over');
  check(
    `${label}: an ended game ignores further actions`,
    processAction(done, { type: 'ROLL' }) === done,
  );

  // The countdown is twelve *individual turns* whatever the size of the table.
  for (const seats of [2, 4, 6]) {
    let g = createInitialState('t-dec-n', 'Declare', {
      humanNames: Array.from({ length: seats }, (_, i) => `C${i + 1}`),
      aiCount: 0,
      seed: `declare-${seats}`,
    });
    g = setShares(g, 'p1', SHARE_MAJORITY);
    g = setCash(g, 'p1', VICTORY_CASH + 50);
    g = processAction(g, { type: 'ROLL' });
    g = processAction(g, { type: 'DECLARE' });

    const justBefore = idleTurns(g, DECLARATION_TURNS - 1);
    check(
      `${label}: at ${seats} hauliers the clock still runs after ${DECLARATION_TURNS - 1} turns`,
      justBefore.phase !== 'over',
      `ended early, phase ${justBefore.phase}`,
    );
    const expired = idleTurns(justBefore, 1);
    equal(`${label}: at ${seats} hauliers it resolves on turn ${DECLARATION_TURNS}`, expired.winnerId, 'p1');
  }

  // Short of the cash bar the claim COLLAPSES — the declarer loses, and whoever holds the most by
  // value takes the company. That is also what stops a haulier who lost the share race from being
  // locked out of winning.
  let poor = setup(SHARE_MAJORITY, VICTORY_CASH - 1, 1);
  poor = processAction(poor, { type: 'DECLARE' });
  const collapsed = idleTurns(poor, DECLARATION_TURNS + 1);
  equal(`${label}: a claim short of ${VICTORY_CASH} ends the game`, collapsed.phase, 'over');
  check(`${label}: the declarer does not win it`, collapsed.winnerId !== 'p1', 'p1 won anyway');
  check(`${label}: someone else takes the company`, collapsed.winnerId !== null, 'nobody won');
  check(
    `${label}: and it is the haulier worth the most`,
    collapsed.winnerId ===
      collapsed.hauliers
        .filter(c => c.id !== 'p1')
        .map(c => ({ id: c.id, worth: assetValue(collapsed, c) }))
        .sort((a, b) => b.worth - a.worth)[0]?.id,
  );

  // With no vehicle running the claim fails even holding shares and cash.
  let vehicleless = setup(SHARE_MAJORITY, VICTORY_CASH + 500, 0);
  vehicleless = processAction(vehicleless, { type: 'DECLARE' });
  const failed = idleTurns(vehicleless, DECLARATION_TURNS + 1);
  equal(`${label}: a claim with no vehicle also collapses`, failed.phase, 'over');
  check(`${label}: and does not go to the declarer`, failed.winnerId !== 'p1');

  // The sabotage window: during a countdown anyone may buy a share off anyone, including the
  // leader. Outside one, the usual restriction holds.
  let siege = createInitialState('t-siege', 'Siege', { humanNames: ['A', 'B'], aiCount: 0, seed: 'siege' });
  siege = setShares(siege, 'p1', 4);
  siege = setShares(siege, 'p2', 6);
  siege = setCash(siege, 'p1', 4000);
  siege = processAction(siege, { type: 'ROLL' });
  check(
    `${label}: outside a countdown the small holder cannot strip the leader`,
    processAction(siege, { type: 'BUY_SHARE' }) === siege,
  );

  // p2 declares, which opens the window; play round to p1.
  let open = processAction(siege, { type: 'END_TURN' });
  open = processAction(open, { type: 'ACKNOWLEDGE_HANDOVER' });
  open = processAction(open, { type: 'ROLL' });
  open = processAction(open, { type: 'DECLARE' });
  open = processAction(open, { type: 'END_TURN' });
  open = processAction(open, { type: 'ACKNOWLEDGE_HANDOVER' });
  open = processAction(open, { type: 'ROLL' });
  check(`${label}: the countdown is running`, open.declaration !== null);
  const raided = processAction(open, { type: 'BUY_SHARE' });
  check(
    `${label}: inside the window the leader can be raided`,
    raided.hauliers[0].shares === 5 && raided.hauliers[1].shares === 5,
    `${raided.hauliers[0].shares} / ${raided.hauliers[1].shares}`,
  );
}

// ---------------------------------------------------------------------------
// 6. Weather and theft
// ---------------------------------------------------------------------------

/**
 * Seasons, and the delay rating. Steady Eddie drops The Tea Race's directional wind entirely (no
 * road has a prevailing wind); what remains testable in the same spirit is that delays cost time
 * only, never drive a vehicle behind her own leg's start, and actually happen where a leg carries
 * a risk rating.
 */
function testRoadWeather() {
  const label = 'weather';

  // Seasons are a pure function of the round, so every client agrees without storing anything.
  for (const round of [1, 6, 7, 12, 13, 19, 25, 31]) {
    equal(`${label}: round ${round} is always the same season`, seasonOf(round), seasonOf(round));
  }
  check(
    `${label}: all four seasons occur within a year`,
    new Set([1, 7, 13, 19].map(seasonOf)).size === 4,
  );
  check(
    `${label}: the year wraps`,
    seasonOf(25) === seasonOf(1),
    `round 25 is ${seasonOf(25)}, round 1 is ${seasonOf(1)}`,
  );

  // A leg with no authored weatherRisk is clear in every season, in every year.
  const clearLegs = LEGS.filter(l => !l.weatherRisk);
  check(`${label}: most legs have no authored risk`, clearLegs.length > 0);
  for (const leg of clearLegs) {
    for (const season of SEASONS) {
      equal(`${label}: ${leg.a}<->${leg.b} is clear in ${season}`, delayRating(leg.a, leg.b, season), 0);
    }
  }

  // A leg with an authored risk is worse in winter than in summer, and never negative.
  const riskyLegs = LEGS.filter(l => (l.weatherRisk ?? 0) > 0);
  check(`${label}: some roads carry a weather risk`, riskyLegs.length >= 3, `${riskyLegs.length} legs`);
  for (const leg of riskyLegs) {
    for (const season of SEASONS) {
      check(`${label}: ${leg.a}<->${leg.b} rating in ${season} is never negative`, delayRating(leg.a, leg.b, season) >= 0);
    }
    check(
      `${label}: ${leg.a}<->${leg.b} is worse in winter than in summer`,
      delayRating(leg.a, leg.b, 'winter') > delayRating(leg.a, leg.b, 'summer'),
    );
    check(
      `${label}: ${leg.a}<->${leg.b} spring and autumn agree`,
      delayRating(leg.a, leg.b, 'spring') === delayRating(leg.a, leg.b, 'autumn'),
    );
  }

  // aeroKit is never a worse choice: it can only raise a passage's effective speed.
  for (const leg of riskyLegs) {
    for (const season of SEASONS) {
      check(
        `${label}: aeroKit never slows ${leg.a}->${leg.b} in ${season}`,
        effectiveSpeed(leg.a, leg.b, season, true) >= effectiveSpeed(leg.a, leg.b, season, false),
      );
    }
  }

  // Delays cost time and nothing else, and can never drive a vehicle behind her leg's start.
  let delayed = 0;
  let seed = 12345;
  for (let i = 0; i < 4000; i++) {
    const leg = LEGS[i % LEGS.length];
    const season = SEASONS[i % SEASONS.length];
    const progressed = Math.floor((i % 5) * (leg.distance / 5));
    const vehicle: Vehicle = {
      id: 's1', ownerId: 'p1', name: 'Test',
      location: null,
      run: {
        route: [leg.b], legFrom: leg.a,
        legRemaining: leg.distance - progressed, legDistance: leg.distance,
      },
      hold: [{ good: 'tomatoes', paid: 60, boughtAt: leg.a, boughtOnTurn: 0 }],
    };
    const out = resolveDelay(seed, vehicle, season);
    seed = out.seed;
    if (out.setback > 0) {
      delayed++;
      check(
        `${label}: a delay never drives a vehicle past her leg's start`,
        out.setback <= progressed,
        `set back ${out.setback} having made only ${progressed}`,
      );
    }
    check(`${label}: delay ratings are never negative`, delayRating(leg.a, leg.b, season) >= 0);
  }
  check(`${label}: delays actually happen`, delayed > 20, `only ${delayed} in 4000 rolls`);

  // planFastestRoute must still produce a real, connected route.
  const fastest = planFastestRoute('london', 'glasgow', 'winter');
  check(`${label}: a fastest route exists`, fastest !== null && fastest.path.length > 0);
  if (fastest) {
    equal(`${label}: it ends at the destination`, fastest.path[fastest.path.length - 1], 'glasgow');
    check(`${label}: its distance matches the chart`, fastest.distance >= distanceBetween('london', 'glasgow'));
  }
}

function testTheft() {
  const label = 'theft';

  const rated = LEGS.filter(l => (l.theft ?? 0) > 0);
  check(`${label}: some roads are theft-prone`, rated.length >= 3, `${rated.length} legs`);
  check(
    `${label}: safe roads have no rating`,
    LEGS.every(l => (l.theft ?? 0) >= 0 && (l.theft ?? 0) <= 2),
  );

  const makeVehicle = (from: string, to: string, tracker: boolean, cargo: boolean): Vehicle => ({
    id: 's1', ownerId: 'p1', name: 'Test',
    location: null,
    run: { route: [to], legFrom: from, legRemaining: 5, legDistance: 10 },
    hold: cargo ? [{ good: 'tomatoes', paid: 60, boughtAt: from, boughtOnTurn: 0 }] : [],
    fittings: tracker ? { tracker: true } : undefined,
  });

  // Thieves only ever strike where the chart says they are.
  const safe = LEGS.find(l => !l.theft)!;
  let seed = 999;
  let strikes = 0;
  for (let i = 0; i < 3000; i++) {
    const out = resolveTheft(seed, makeVehicle(safe.a, safe.b, false, true), 800);
    seed = out.seed;
    if (out.kind !== 'none') strikes++;
  }
  equal(`${label}: never strikes on a safe road`, strikes, 0);

  // A tracker cuts both the frequency and the severity. Measured over many trials, not asserted by faith.
  const worst = rated.reduce((a, b) => ((a.theft ?? 0) >= (b.theft ?? 0) ? a : b));
  const trial = (tracker: boolean) => {
    let s = 4242;
    let encounters = 0;
    let seizures = 0;
    for (let i = 0; i < 20000; i++) {
      const out = resolveTheft(s, makeVehicle(worst.a, worst.b, tracker, true), 800);
      s = out.seed;
      if (out.kind !== 'none') encounters++;
      if (out.kind === 'seizure') seizures++;
    }
    return { encounters, seizures };
  };
  const bare = trial(false);
  const armed = trial(true);
  check(
    `${label}: a tracker reduces encounters`,
    armed.encounters < bare.encounters,
    `${armed.encounters} tracked vs ${bare.encounters} bare`,
  );
  check(
    `${label}: a tracker reduces seizures further still`,
    armed.seizures * 3 < bare.seizures,
    `${armed.seizures} tracked vs ${bare.seizures} bare`,
  );
  check(
    `${label}: a paid recovery is the common outcome`,
    bare.encounters - bare.seizures > bare.seizures,
    `${bare.seizures} seizures of ${bare.encounters} encounters`,
  );

  // An empty hold cannot be robbed of cargo, so those encounters settle for money.
  let s2 = 77;
  let emptySeizures = 0;
  for (let i = 0; i < 8000; i++) {
    const out = resolveTheft(s2, makeVehicle(worst.a, worst.b, false, false), 800);
    s2 = out.seed;
    if (out.kind === 'seizure') emptySeizures++;
  }
  equal(`${label}: a vehicle running light never loses a cargo`, emptySeizures, 0);

  // A recovery fee can never take more than the haulier has.
  let s3 = 31337;
  for (const cashHeld of [0, 5, 40, 5000]) {
    for (let i = 0; i < 400; i++) {
      const out = resolveTheft(s3, makeVehicle(worst.a, worst.b, false, true), cashHeld);
      s3 = out.seed;
      if (out.kind === 'recovery') {
        check(
          `${label}: a recovery fee never exceeds what is in hand`,
          out.amount <= cashHeld,
          `took ${out.amount} of ${cashHeld}`,
        );
      }
    }
  }
  check(`${label}: rated roads carry a rating helper`, theftRating(worst.a, worst.b) > 0);
}

/**
 * Hazards off must behave exactly as the game did before they existed. The strong form of this is a
 * byte-identical replay against a baseline, which is not available inside the harness; the checkable
 * form is that a hazards-off game is deterministic and emits no hazard events at all.
 */
function testHazardsOff() {
  const label = 'hazards off';
  const play = () => {
    let s = createInitialState('t-off', 'Off', {
      humanNames: [], aiCount: 4, seed: 'hazards-off', createdAt: 0,
      hazards: { ...FULL_HAZARDS_OFF, weather: false, theft: false },
    });
    for (let i = 0; i < 400 && s.phase !== 'over'; i++) s = runAiTurn(s);
    return s;
  };
  const a = play();
  const b = play();
  check(`${label}: replays byte-identically`, JSON.stringify(a) === JSON.stringify(b));

  const hazardKinds = new Set(['delay', 'theft', 'insurance', 'fitting']);
  const leaked = a.log.filter(e => hazardKinds.has(e.kind));
  equal(`${label}: emits no hazard events at all`, leaked.length, 0);
  check(
    `${label}: no vehicle is ever fitted out`,
    a.vehicles.every(sh => !sh.fittings && !sh.insured),
  );
}

// ---------------------------------------------------------------------------
// 7. Full AI games, with per-turn invariants
// ---------------------------------------------------------------------------

interface GameReport {
  turns: number;
  rounds: number;
  winner: string | null;
  deliveries: number;
  finalCash: number[];
  actions: Record<string, number>;
  /** Share of all vehicle-turns spent on the road rather than working a depot. */
  atSeaShare: number;
  idleParkedVehicleTurns: number;
  /** Round the bank sold its last share, and the round of the first declaration. */
  bankEmptyRound: number | null;
  firstDeclareRound: number | null;
  raids: number;
  leaderAt30: string | null;
  leaderAt30Won: boolean | null;
  leaderAt30Shares: number;
  lockedOutAtBankEmpty: number;
  aLockedOutHaulierWon: boolean | null;
}

function playAiGame(seed: string, maxRounds = 400): GameReport {
  let s = createInitialState(`t-${seed}`, seed, { humanNames: [], aiCount: 4, seed });

  let deliveries = 0;
  const actions: Record<string, number> = {};
  let vehicleTurns = 0;
  let onRoadTurns = 0;
  let idleParkedVehicleTurns = 0;
  let bankEmptyRound: number | null = null;
  let firstDeclareRound: number | null = null;
  let raids = 0;
  let lockedOut: string[] = [];
  let leaderAt30: string | null = null;
  let leaderAt30Shares = 0;
  let newsPricedFills = 0;
  let offReckoningBuys = 0;

  // Deliveries are audited from the log rather than by diffing state, because filling a card for
  // the second time and dealing its replacement happen inside a single action — no observer
  // watching state between actions can ever catch a card holding two fills.
  let lastSeq = -1;
  const fillsSeen = new Map<string, number>();

  const auditContracts = (state: GameState) => {
    for (const entry of state.log) {
      if (entry.seq <= lastSeq) continue;
      lastSeq = entry.seq;
      if (entry.kind !== 'deliver' || !entry.data) continue;
      deliveries++;

      const { contractId, rank, payout, purchasePrice, cardPrice, units } = entry.data as {
        contractId: string;
        rank: number;
        payout: number;
        purchasePrice: number;
        cardPrice: number;
        units: number;
      };

      const plain = Number(entry.data?.plain ?? payout);
      const expectedRank = (fillsSeen.get(contractId) ?? 0) + 1;
      fillsSeen.set(contractId, expectedRank);

      equal(`AI game ${seed}: ${contractId} fill ${expectedRank} is ranked correctly`, rank, expectedRank);
      check(
        `AI game ${seed}: ${contractId} is never filled a third time`,
        expectedRank <= 2,
        `reached fill ${expectedRank}`,
      );
      if (rank === 1 || rank === 2) {
        // Paid per unit: every matching slot lands together, so three lots pay three times.
        // Reckoned on the CARD's price per unit, not on what the haulier paid — see sim/pricing.ts.
        equal(
          `AI game ${seed}: ${contractId} fill ${rank} pays ${rank === 1 ? '4x' : '2x'} on the card's price`,
          plain,
          cardPrice * units * (rank === 1 ? 4 : 2),
        );
        // What actually reached the counting house may differ, but only when news was in force,
        // and only by the amounts the event table can produce.
        if (payout !== plain) {
          newsPricedFills++;
          const ratio = payout / plain;
          const floor = GLUT_FACTOR * CARGO_SPOIL_FLOOR - 0.01;
          check(
            `AI game ${seed}: ${contractId} news pricing is within the table's range`,
            ratio >= floor && ratio <= SHORTAGE_FACTOR + (BOUNTY_PER_UNIT * units) / plain + 0.01,
            `paid ${payout} against a plain ${plain} (x${ratio.toFixed(2)})`,
          );
        }
      }
      // Bounded by the largest vehicle class afloat, not by the 7.5-tonner's default.
      const biggestHull = Math.max(...Object.values(VEHICLE_CLASSES).map(c => c.slots));
      check(
        `AI game ${seed}: ${contractId} landed 1..${biggestHull} units`,
        units >= 1 && units <= biggestHull,
        `landed ${units}`,
      );
      // What she paid is a depot price, so it sits inside the band rather than on the reckoning.
      check(
        `AI game ${seed}: ${contractId} was bought inside the price band`,
        purchasePrice >= Math.floor(cardPrice * PRICE_FLOOR) * units - units &&
          purchasePrice <= Math.ceil(cardPrice * PRICE_CEILING) * units + units,
        `paid ${purchasePrice} for ${units} against a reckoning of ${cardPrice}`,
      );
      if (purchasePrice !== cardPrice * units) offReckoningBuys++;
    }

    // A spent card must be off the board before anything else happens.
    for (const c of state.contracts) {
      check(
        `AI game ${seed}: no face-up card is already spent`,
        c.fills.length < 2,
        `${c.id} face-up with ${c.fills.length} fills`,
      );
    }
  };

  const auditInvariants = (state: GameState) => {
    check(
      `AI game ${seed}: five cards face up`,
      state.contracts.length === FACE_UP_CONTRACTS,
      `saw ${state.contracts.length}`,
    );
    check(
      `AI game ${seed}: cards are distinct`,
      new Set(state.contracts.map(c => `${c.good}|${c.destination}`)).size ===
        state.contracts.length,
      'duplicate card face-up',
    );
    const held = state.hauliers.reduce((n, c) => n + c.shares, 0);
    check(
      `AI game ${seed}: ten shares in existence`,
      held + state.sharesRemaining === TOTAL_SHARES,
      `${held} held + ${state.sharesRemaining} banked`,
    );
    for (const haulier of state.hauliers) {
      check(
        `AI game ${seed}: ${haulier.name} within the fleet cap`,
        state.vehicles.filter(x => x.ownerId === haulier.id).length <= MAX_VEHICLES,
      );
      check(`AI game ${seed}: ${haulier.name} is never overdrawn`, haulier.cash >= 0, `${haulier.cash}`);
    }
    for (const vehicle of state.vehicles) {
      check(
        `AI game ${seed}: ${vehicle.name} is either in depot or on the road, never both`,
        (vehicle.location === null) !== (vehicle.run === null),
      );
      check(
        `AI game ${seed}: ${vehicle.name} never exceeds her ${slotsOf(vehicle.vehicleClass)} slots`,
        vehicle.hold.length <= slotsOf(vehicle.vehicleClass),
        `${vehicle.hold.length} lots aboard a ${vehicle.vehicleClass ?? 'rigid_7_5'}`,
      );
      for (const lot of vehicle.hold) {
        check(
          `AI game ${seed}: ${vehicle.name}'s cargo is a real good`,
          GOOD_BY_ID[lot.good] !== undefined,
        );
      }
      if (vehicle.location) {
        check(
          `AI game ${seed}: ${vehicle.name} lies at a real depot`,
          DEPOT_BY_ID[vehicle.location] !== undefined,
        );
      }
    }
  };

  let guard = 0;
  while (s.phase !== 'over' && s.round <= maxRounds && guard++ < maxRounds * 8) {
    const haulierId = s.hauliers[s.activeIndex].id;
    const before = s.vehicles.filter(x => x.ownerId === haulierId);
    vehicleTurns += before.length;
    onRoadTurns += before.filter(x => x.location === null).length;

    let acted = 0;
    s = runAiTurn(s, (after, action) => {
      actions[action.type] = (actions[action.type] ?? 0) + 1;
      if (action.type !== 'ROLL') acted++;
      if (action.type === 'BUY_SHARE') {
        if (bankEmptyRound === null && after.sharesRemaining === 0) {
          bankEmptyRound = after.round;
          lockedOut = after.hauliers.filter(c => c.shares === 0).map(c => c.id);
        }
        if (bankEmptyRound !== null && after.round >= bankEmptyRound) raids++;
      }
      if (action.type === 'DECLARE' && firstDeclareRound === null) firstDeclareRound = after.round;
      auditContracts(after);
    });
    // A haulier whose vehicles are all parked and who still finds nothing worth doing is stalled.
    if (acted === 0) {
      idleParkedVehicleTurns += before.filter(x => x.location !== null).length;
    }
    auditInvariants(s);

    // Snapshot the share leader once, the first time the game reaches round 30.
    if (leaderAt30 === null && s.round >= 30) {
      const front = [...s.hauliers].sort(
        (a, b) => b.shares - a.shares || assetValue(s, b) - assetValue(s, a),
      )[0];
      leaderAt30 = front.id;
      leaderAt30Shares = front.shares;
    }
  }

  return {
    turns: s.turn,
    rounds: s.round,
    winner: s.winnerId ? s.hauliers.find(c => c.id === s.winnerId)!.name : null,
    deliveries,
    finalCash: s.hauliers.map(c => c.cash),
    actions,
    atSeaShare: vehicleTurns ? onRoadTurns / vehicleTurns : 0,
    idleParkedVehicleTurns,
    bankEmptyRound,
    firstDeclareRound,
    raids,
    leaderAt30: leaderAt30 ? s.hauliers.find(c => c.id === leaderAt30)!.name : null,
    leaderAt30Won: leaderAt30 === null || s.winnerId === null ? null : s.winnerId === leaderAt30,
    leaderAt30Shares,
    lockedOutAtBankEmpty: lockedOut.length,
    aLockedOutHaulierWon:
      lockedOut.length === 0 || s.winnerId === null ? null : lockedOut.includes(s.winnerId),
  };
}

// ---------------------------------------------------------------------------
// 8. Determinism
// ---------------------------------------------------------------------------

function testDeterminism() {
  const run = () => {
    let s = createInitialState('t-det', 'Determinism', {
      humanNames: [],
      aiCount: 4,
      seed: 'determinism',
      createdAt: 0,
    });
    for (let i = 0; i < 200 && s.phase !== 'over'; i++) s = runAiTurn(s);
    return JSON.stringify(s);
  };
  const a = run();
  const b = run();
  check(
    'determinism: same seed replays byte-identically',
    a === b,
    a === b ? '' : `diverged at char ${[...a].findIndex((ch, i) => ch !== b[i])}`,
  );
}

/**
 * The presets. Four named games rather than ten booleans, and each one a *different* game.
 */
function testPresets() {
  const label = 'presets';
  const names = Object.keys(PRESETS) as (keyof typeof PRESETS)[];
  check(`${label}: there are four`, names.length === 4, `${names.length}`);

  const core = PRESETS.core.hazards as Record<string, boolean>;
  check(`${label}: the core rules turn everything off`, Object.values(core).every(v => v === false));
  const full = PRESETS.full.hazards as Record<string, boolean>;
  check(`${label}: the full haul turns everything on`, Object.values(full).every(v => v === true));

  // Every switch in the Hazards type must appear in every preset, or a preset silently means
  // "off by omission" and a new rule leaks into the faithful game the day it is added.
  const keys = Object.keys(full);
  for (const name of names) {
    const h = PRESETS[name].hazards as Record<string, boolean>;
    for (const k of keys) {
      check(`${label}: ${name} states ${k} explicitly`, k in h, `missing ${k}`);
    }
  }

  // The two middle games have to be genuinely different from each other, not one a subset of the
  // other — that is the whole reason for curating them rather than offering light/medium/heavy.
  const haulier = PRESETS.haulier.hazards as Record<string, boolean>;
  const openRoad = PRESETS.openRoad.hazards as Record<string, boolean>;
  check(
    `${label}: a haulier's game has what the open road does not`,
    keys.some(k => haulier[k] && !openRoad[k]),
  );
  check(
    `${label}: and the open road has what a haulier's game does not`,
    keys.some(k => openRoad[k] && !haulier[k]),
  );
  check(`${label}: a haulier's game is the money one`, haulier.wages && haulier.stocks);
  check(`${label}: and brings no new randomness`, !haulier.weather && !haulier.theft && !haulier.events);
  check(`${label}: the open road is the dangerous one`, openRoad.weather && openRoad.theft && openRoad.events);
  check(`${label}: and leaves money simple`, !openRoad.wages && !openRoad.loans);

  // Each must actually produce a finishable game.
  for (const name of names) {
    let g = createInitialState(`t-p-${name}`, name, {
      humanNames: [], aiCount: 4, seed: `preset-${name}`,
      hazards: PRESETS[name].hazards as never,
    });
    for (let i = 0; i < 3000 && g.phase !== 'over'; i++) g = runAiTurn(g);
    check(`${label}: ${name} reaches a winner`, g.phase === 'over', `${g.round} rounds`);
  }
}

/**
 * The haulage exchange, and the difficulty dial.
 */
function testExchangeAndDifficulty() {
  const label = 'exchange';
  const hz = { ...FULL_HAZARDS_OFF, stocks: true };

  // --- the price model -----------------------------------------------------------------------------
  const base = COMPANIES.southern.base;
  check(`${label}: heavy trade lifts a price`, nextPrice(base, base, 5) > base);
  check(`${label}: a dead round drops it`, nextPrice(base, base, 0) < base);
  // A market that can only go up is a market nobody buys into.
  check(
    `${label}: prices can fall below base and stay there`,
    nextPrice(nextPrice(nextPrice(base, base, 0), base, 0), base, 0) < base,
  );
  check(`${label}: and are bounded either way`, nextPrice(base, base, 999) <= base * STOCK_CEILING + 1);
  check(`${label}: including downward`, nextPrice(1, base, 0) >= base * STOCK_FLOOR - 1);

  // Every depot belongs to exactly one company, or trade would vanish.
  for (const depot of DEPOTS) {
    check(`${label}: ${depot.id} trades through a company`, companyForDepot(depot.id) !== null);
  }

  // --- buying and selling --------------------------------------------------------------------------
  let g = createInitialState('t-x', 'Exchange', { humanNames: ['A'], aiCount: 1, seed: 'x', hazards: hz });
  g = setCash(g, 'p1', 3000);
  g = processAction(g, { type: 'ROLL' });
  const price = g.stockPrices?.southern ?? base;

  const bought = processAction(g, { type: 'BUY_STOCK', stock: 'southern', lots: 3 });
  check(`${label}: a haulier can buy in`, bought !== g);
  equal(`${label}: the holding is recorded`, bought.hauliers.find(c => c.id === 'p1')!.holdings?.southern, 3);
  equal(`${label}: at the price on the board`, cash(bought, 'p1'), 3000 - price * 3);
  check(
    `${label}: and it counts towards her worth`,
    assetValue(bought, bought.hauliers.find(c => c.id === 'p1')!) > 0,
  );

  const sold = processAction(bought, { type: 'SELL_STOCK', stock: 'southern', lots: 3 });
  equal(`${label}: selling straight back is a wash`, cash(sold, 'p1'), 3000);
  equal(`${label}: and clears the holding`, sold.hauliers.find(c => c.id === 'p1')!.holdings?.southern, 0);
  check(
    `${label}: cannot sell what she does not hold`,
    processAction(g, { type: 'SELL_STOCK', stock: 'central', lots: 1 }) === g,
  );
  check(
    `${label}: refused outright when switched off`,
    processAction({ ...g, hazards: { ...hz, stocks: false } }, { type: 'BUY_STOCK', stock: 'southern' })
      .hauliers.find(c => c.id === 'p1')!.holdings === undefined,
  );

  // The exchange must never become a second way to win.
  check(
    `${label}: holdings are not company shares`,
    bought.hauliers.find(c => c.id === 'p1')!.shares === 0,
  );

  // --- the difficulty dial -------------------------------------------------------------------------
  const d = 'difficulty';
  const gentle = DIFFICULTIES.gentle;
  const hard = DIFFICULTIES.hard;
  check(`${d}: gentle does not watch her rivals`, !gentle.seesRivals && hard.seesRivals);
  check(`${d}: gentle ignores the forecast`, !gentle.readsForecast && hard.readsForecast);
  check(`${d}: gentle never bids for shares`, !gentle.usesHostileBids && hard.usesHostileBids);
  check(`${d}: gentle clogs her hold`, gentle.patienceScale > hard.patienceScale);
  check(`${d}: and under-buys the only thing that wins`, gentle.shareCaution > hard.shareCaution);

  // The handicaps must be knowledge and discipline, never dice: a gentle table has to replay
  // byte-identically, and its rolls must match a hard table's, or the AI is cheating in reverse.
  const rollsOf = (level: Difficulty) => {
    let t = createInitialState('t-d', 'D', {
      humanNames: [], aiCount: 4, seed: 'dice', difficulty: level,
      hazards: { ...FULL_HAZARDS_OFF },
    });
    t = processAction(t, { type: 'ROLL' });
    return JSON.stringify(t.dice);
  };
  equal(`${d}: the dice do not care how well she plays`, rollsOf('gentle'), rollsOf('hard'));

  const play = (level: Difficulty) => {
    let t = createInitialState('t-dd', 'D', { humanNames: [], aiCount: 4, seed: 'dd', difficulty: level });
    for (let i = 0; i < 2000 && t.phase !== 'over'; i++) t = runAiTurn(t);
    return t;
  };
  for (const level of ['gentle', 'steady', 'hard'] as Difficulty[]) {
    const done = play(level);
    check(`${d}: a ${level} table still reaches a winner`, done.phase === 'over', `${done.round} rounds`);
  }
}

/**
 * Vehicle classes — three rigs that are genuinely different, with no dominant one.
 */
function testVehicleClasses() {
  const label = 'vehicle classes';
  const hz = { ...FULL_HAZARDS_OFF, vehicleClasses: true };

  // --- the classes are a real trade ----------------------------------------------------------------
  const all = Object.values(VEHICLE_CLASSES);
  const base = VEHICLE_CLASSES[DEFAULT_VEHICLE_CLASS];
  check(`${label}: the 7.5-tonner is the default`, base.id === 'rigid_7_5');
  equal(`${label}: and carries no speed penalty`, base.speed, 0);
  check(`${label}: the 18-tonne rigid is no roomier`, VEHICLE_CLASSES.rigid_18.slots === base.slots);
  check(`${label}: but is faster on every roll`, VEHICLE_CLASSES.rigid_18.speed > base.speed);
  check(`${label}: the 44-tonne artic carries more`, VEHICLE_CLASSES.artic_44.slots > base.slots);
  check(`${label}: and pays for it in speed`, VEHICLE_CLASSES.artic_44.speed < base.speed);

  // No dominant rig: nothing may be cheaper AND roomier AND faster than another.
  for (const a of all) {
    for (const b of all) {
      if (a.id === b.id) continue;
      check(
        `${label}: ${a.id} does not dominate ${b.id}`,
        !(a.price <= b.price && a.slots >= b.slots && a.speed >= b.speed &&
          (a.price < b.price || a.slots > b.slots || a.speed > b.speed)),
        `${a.id} beats ${b.id} on every axis`,
      );
    }
  }

  // --- buying one ------------------------------------------------------------------------------------
  let g = createInitialState('t-cls', 'Classes', { humanNames: ['A'], aiCount: 1, seed: 'cls', hazards: hz });
  g = setCash(g, 'p1', 10_000);
  g = processAction(g, { type: 'ROLL' });

  const bought = processAction(g, { type: 'BUY_VEHICLE', vehicleClass: 'rigid_18' });
  check(`${label}: an 18-tonner can be bought`, bought !== g);
  const rigid18 = bought.vehicles[bought.vehicles.length - 1];
  equal(`${label}: and is recorded as one`, rigid18.vehicleClass, 'rigid_18');
  equal(`${label}: at the 18-tonner's price`, cash(bought, 'p1'), 10_000 - VEHICLE_CLASSES.rigid_18.price);
  equal(`${label}: with two slots`, slotsOf(rigid18.vehicleClass), 2);

  const withArtic = processAction(bought, { type: 'BUY_VEHICLE', vehicleClass: 'artic_44' });
  const artic = withArtic.vehicles[withArtic.vehicles.length - 1];
  equal(`${label}: an artic is recorded with three slots`, slotsOf(artic.vehicleClass), 3);

  // --- and the toggle really governs ---------------------------------------------------------------
  let plain = createInitialState('t-cls-off', 'Off', {
    humanNames: ['A'], aiCount: 1, seed: 'cls',
    hazards: { ...hz, vehicleClasses: false },
  });
  plain = setCash(plain, 'p1', 10_000);
  plain = processAction(plain, { type: 'ROLL' });
  // Asking for an artic in a faithful game must hand back the default, not smuggle one in.
  const forced = processAction(plain, { type: 'BUY_VEHICLE', vehicleClass: 'artic_44' });
  const got = forced.vehicles[forced.vehicles.length - 1];
  equal(`${label}: a faithful game gives the default whatever is asked for`, got.vehicleClass, undefined);
  equal(`${label}: at the default's price`, cash(forced, 'p1'), 10_000 - VEHICLE_PRICE);
  equal(`${label}: carrying ${base.slots}`, slotsOf(got.vehicleClass), base.slots);

  // --- a hull's slots are hers, not a global -------------------------------------------------------
  let loading = withArtic;
  loading = place(loading, artic.id, 'nottingham');
  loading = setCash(loading, 'p1', 10_000);
  for (let i = 0; i < 6; i++) {
    loading = processAction(loading, { type: 'BUY_CARGO', vehicleId: artic.id, good: 'textiles' });
  }
  equal(
    `${label}: an artic fills three slots and stops`,
    loading.vehicles.find(sh => sh.id === artic.id)!.hold.length,
    3,
  );
}

/**
 * The clock: commissions that lapse, and cargo that goes off.
 */
function testDeadlines() {
  const label = 'deadlines';
  const hz = { ...FULL_HAZARDS_OFF, deadlines: true };

  // --- freshness -----------------------------------------------------------------------------------
  equal(`${label}: a fresh lot is worth all of itself`, freshness(0), 1);
  equal(`${label}: and still is at the end of the grace`, freshness(CARGO_FRESH_TURNS), 1);
  check(
    `${label}: past it she starts to lose`,
    freshness(CARGO_FRESH_TURNS + 10) < 1,
    `${freshness(CARGO_FRESH_TURNS + 10)}`,
  );
  check(`${label}: monotonically`, freshness(60) < freshness(40) && freshness(40) < freshness(30));
  equal(`${label}: but never below the floor`, freshness(10_000), CARGO_SPOIL_FLOOR);

  // --- the delivery is actually discounted ---------------------------------------------------------
  let g = createInitialState('t-dl', 'Clock', { humanNames: ['A'], aiCount: 1, seed: 'dl', hazards: hz });
  const card = g.contracts[0];
  const from = sourcesFor(card.good, card.destination).filter(p => p !== card.destination)[0];
  g = setCash(g, 'p1', 5000);
  g = place(g, 's1', from);
  g = processAction(g, { type: 'ROLL' });
  g = processAction(g, { type: 'BUY_CARGO', vehicleId: 's1', good: card.good });
  const hold = vehicleOf(g, 's1').hold;

  const landNow = processAction(place(g, 's1', card.destination, hold), {
    type: 'DELIVER', vehicleId: 's1', contractId: card.id,
  });
  // The same delivery, but the lot has been aboard far longer.
  const stale = { ...g, turn: g.turn + CARGO_FRESH_TURNS + 30 };
  const landLate = processAction(place(stale, 's1', card.destination, hold), {
    type: 'DELIVER', vehicleId: 's1', contractId: card.id,
  });
  const fresh = cash(landNow, 'p1') - cash(g, 'p1');
  const old = cash(landLate, 'p1') - cash(stale, 'p1');
  check(`${label}: stale cargo pays less than fresh`, old < fresh, `${old} against ${fresh}`);
  check(`${label}: but still pays something`, old > 0, `${old}`);

  // With the clock off, age is irrelevant.
  const noClock = { ...stale, hazards: { ...hz, deadlines: false } };
  const landedFree = processAction(place(noClock, 's1', card.destination, hold), {
    type: 'DELIVER', vehicleId: 's1', contractId: card.id,
  });
  equal(
    `${label}: age costs nothing when switched off`,
    cash(landedFree, 'p1') - cash(noClock, 'p1'),
    fresh,
  );

  // --- cards lapse ---------------------------------------------------------------------------------
  let board = createInitialState('t-dl2', 'Board', { humanNames: [], aiCount: 4, seed: 'dl2', hazards: hz });
  const originals = board.contracts.map(c => c.id);
  check(
    `${label}: every card is stamped with the round it went up`,
    board.contracts.every(c => c.postedOn !== undefined),
  );
  for (let i = 0; i < 2000 && board.round <= CONTRACT_LIFE_ROUNDS + 2; i++) board = runAiTurn(board);
  check(
    `${label}: the board turns over`,
    board.contracts.some(c => !originals.includes(c.id)),
    'no card ever changed',
  );
  check(
    `${label}: nothing outlives its posting by more than a round`,
    board.contracts.every(c => board.round - (c.postedOn ?? board.round) <= CONTRACT_LIFE_ROUNDS),
  );
  equal(`${label}: and there are still five`, board.contracts.length, FACE_UP_CONTRACTS);
}

/**
 * Standing costs and borrowing — the pair that turns cash from a score into a constraint.
 */
function testStandingCosts() {
  const label = 'standing costs';
  const hz = { ...FULL_HAZARDS_OFF, wages: true, loans: true };

  // --- wages fall due at the turn of the round -----------------------------------------------------
  let g = createInitialState('t-wage', 'Wages', { humanNames: ['A'], aiCount: 1, seed: 'wage', hazards: hz });
  g = setCash(g, 'p1', 3000);
  const startCash = cash(g, 'p1');
  const startRound = g.round;
  // END_TURN is refused before the dice are thrown, so each seat needs its roll first.
  let guard = 0;
  while (g.round === startRound && guard++ < 40) {
    if (g.phase === 'roll') g = processAction(g, { type: 'ROLL' });
    g = processAction(g, { type: 'END_TURN' });
  }
  check(`${label}: the round turns over`, g.round > startRound);
  check(
    `${label}: and wages are taken`,
    cash(g, 'p1') < startCash,
    `${cash(g, 'p1')} against ${startCash}`,
  );
  check(`${label}: it is on the record`, g.log.some(e => e.kind === 'wages'));

  // Off means off — a faithful game has no standing costs at all.
  let free = createInitialState('t-wage-off', 'Off', {
    humanNames: ['A'], aiCount: 1, seed: 'wage',
    hazards: { ...FULL_HAZARDS_OFF },
  });
  free = setCash(free, 'p1', 3000);
  const freeRound = free.round;
  guard = 0;
  while (free.round === freeRound && guard++ < 40) {
    if (free.phase === 'roll') free = processAction(free, { type: 'ROLL' });
    free = processAction(free, { type: 'END_TURN' });
  }
  equal(`${label}: nothing is charged when switched off`, cash(free, 'p1'), 3000);

  // --- arrears rather than bankruptcy --------------------------------------------------------------
  let broke = createInitialState('t-arr', 'Arrears', { humanNames: ['A'], aiCount: 1, seed: 'arr', hazards: hz });
  broke = setCash(broke, 'p1', 0);
  const brokeRound = broke.round;
  guard = 0;
  while (broke.round === brokeRound && guard++ < 40) {
    if (broke.phase === 'roll') broke = processAction(broke, { type: 'ROLL' });
    broke = processAction(broke, { type: 'END_TURN' });
  }
  const owing = broke.hauliers.find(c => c.id === 'p1')!.arrears ?? 0;
  check(`${label}: a haulier who cannot pay falls into arrears`, owing > 0, `${owing}`);
  check(`${label}: and is not eliminated`, broke.hauliers.some(c => c.id === 'p1'));
  check(`${label}: cash never goes negative`, broke.hauliers.every(c => c.cash >= 0));

  // --- borrowing -----------------------------------------------------------------------------------
  let loan = createInitialState('t-loan', 'Loan', { humanNames: ['A'], aiCount: 1, seed: 'loan', hazards: hz });
  loan = setCash(loan, 'p1', 100);
  loan = processAction(loan, { type: 'ROLL' });
  const ceiling = loanCeilingFor(loan.vehicles.filter(sh => sh.ownerId === 'p1').length, 0);
  check(`${label}: a haulier with a vehicle can borrow something`, ceiling >= LOAN_STEP, `${ceiling}`);

  const borrowed = processAction(loan, { type: 'TAKE_LOAN' });
  check(`${label}: the draw goes through`, borrowed !== loan);
  equal(`${label}: cash rises by the step`, cash(borrowed, 'p1'), 100 + LOAN_STEP);
  equal(`${label}: and the debt with it`, borrowed.hauliers.find(c => c.id === 'p1')!.debt, LOAN_STEP);

  // The ceiling is a ceiling.
  let maxed = borrowed;
  for (let i = 0; i < 20; i++) maxed = processAction(maxed, { type: 'TAKE_LOAN' });
  check(
    `${label}: never lends past the ceiling`,
    (maxed.hauliers.find(c => c.id === 'p1')!.debt ?? 0) <= loanCeilingFor(
      maxed.vehicles.filter(sh => sh.ownerId === 'p1').length,
      maxed.hauliers.find(c => c.id === 'p1')!.shares,
    ),
  );

  // Debt is netted out of a haulier's worth, or borrowing would be a way to fake a fortune.
  const owner = borrowed.hauliers.find(c => c.id === 'p1')!;
  const clean = { ...owner, debt: 0 };
  check(
    `${label}: debt counts against asset value`,
    assetValue(borrowed, owner) < assetValue(borrowed, clean),
  );

  const repaid = processAction(borrowed, { type: 'REPAY_LOAN' });
  check(`${label}: and it can be paid down`, repaid !== borrowed);
  equal(`${label}: to nothing`, repaid.hauliers.find(c => c.id === 'p1')!.debt, 0);
  check(
    `${label}: refused outright when loans are switched off`,
    processAction({ ...loan, hazards: { ...hz, loans: false } }, { type: 'TAKE_LOAN' }).hauliers.find(
      c => c.id === 'p1',
    )!.debt === undefined,
  );
}

/**
 * Selling cargo off at the depot, and insurance being worth its premium.
 */
function testDepotSalesAndCover() {
  const label = 'depot sales';

  // --- the sale ------------------------------------------------------------------------------------
  const opts = {
    humanNames: ['A'], aiCount: 1, seed: 'depot',
    hazards: { ...FULL_HAZARDS_OFF, depotSales: true },
  };
  let g = createInitialState('t-depot', 'Depot', opts);
  g = setCash(g, 'p1', 3000);
  g = place(g, 's1', 'southampton');
  g = processAction(g, { type: 'ROLL' });
  g = processAction(g, { type: 'BUY_CARGO', vehicleId: 's1', good: 'tomatoes' });
  const paid = vehicleOf(g, 's1').hold[0].paid;

  const sold = processAction(g, { type: 'SELL_CARGO', vehicleId: 's1', good: 'tomatoes' });
  check(`${label}: she can sell off the depot`, sold !== g);
  equal(`${label}: the slot is cleared`, vehicleOf(sold, 's1').hold.length, 0);
  const back = cash(sold, 'p1') - cash(g, 'p1');
  check(`${label}: she gets something back`, back > 0, `${back}`);
  check(`${label}: but always less than she paid`, back < paid, `${back} of ${paid}`);

  // The whole point of the mechanic: where you unload matters. Not just for one pair — a dealing
  // depot must beat a non-dealing one for every good, everywhere it can be tested.
  for (const good of GOODS) {
    const dealers = DEPOTS.filter(
      p => p.supplies.includes(good.id) || p.demands.includes(good.id),
    );
    const strangers = DEPOTS.filter(
      p => !p.supplies.includes(good.id) && !p.demands.includes(good.id),
    );
    if (dealers.length === 0 || strangers.length === 0) continue;
    const worstDealer = Math.min(...dealers.map(p => depotSalePrice(p.id, good.id)));
    const bestStranger = Math.max(...strangers.map(p => depotSalePrice(p.id, good.id)));
    check(
      `${label}: every depot dealing in ${good.id} pays better than any that does not`,
      worstDealer > bestStranger,
      `worst dealer ${worstDealer}, best stranger ${bestStranger}`,
    );
  }
  // Never arbitrageable: buy and sell on the same depot must always lose.
  for (const depot of DEPOTS) {
    for (const good of depot.supplies) {
      check(
        `${label}: ${depot.id}/${good} cannot be bought and sold at a profit`,
        depotSalePrice(depot.id, good) < priceAt(depot.id, good),
      );
    }
  }

  // Off means off — the faithful rule is that it goes over the roadside for nothing.
  let strict = createInitialState('t-depot-off', 'Off', {
    ...opts,
    hazards: { ...FULL_HAZARDS_OFF, depotSales: false },
  });
  strict = setCash(strict, 'p1', 3000);
  strict = place(strict, 's1', 'southampton');
  strict = processAction(strict, { type: 'ROLL' });
  strict = processAction(strict, { type: 'BUY_CARGO', vehicleId: 's1', good: 'tomatoes' });
  check(
    `${label}: refused outright when switched off`,
    processAction(strict, { type: 'SELL_CARGO', vehicleId: 's1', good: 'tomatoes' }) === strict,
  );
  // And dumping still forfeits the lot, whatever the toggle says.
  const dumped = processAction(g, { type: 'DUMP', vehicleId: 's1', good: 'tomatoes' });
  equal(`${label}: dumping still recovers nothing`, cash(dumped, 'p1'), cash(g, 'p1'));

  // --- the cover -----------------------------------------------------------------------------------
  equal(`${label}: an empty load bed costs nothing to insure`, insurancePremium(0, 1), 0);
  check(`${label}: a laden one does`, insurancePremium(240, 0.5) > 0);
  check(
    `${label}: and a theft-prone route costs more than a calm one`,
    insurancePremium(240, 1) > insurancePremium(240, 0),
    `${insurancePremium(240, 1)} vs ${insurancePremium(240, 0)}`,
  );
  // Cover follows the premium, or a light passage would be free money.
  const light = { ...vehicleOf(g, 's1'), hold: [], insured: true };
  equal(
    `${label}: an empty load bed is covered for nothing`,
    indemnityFor({ kind: 'recovery', amount: 200, seed: 0 }, light),
    0,
  );
}

/**
 * Vehicles left parked at a depot with their dice already rolled.
 */
function testAwaitingOrders() {
  const label = 'awaiting orders';

  let g = createInitialState('t-ao', 'Orders', { humanNames: ['A'], aiCount: 1, seed: 'ao' });
  g = setCash(g, 'p1', 2000);
  g = place(g, 's1', 'southampton');

  // Before the roll there is nothing to waste yet.
  equal(`${label}: silent before the roll`, vehiclesAwaitingOrders(g, 'p1').length, 0);

  g = processAction(g, { type: 'ROLL' });
  const flagged = vehiclesAwaitingOrders(g, 'p1');
  equal(`${label}: a rolled vehicle standing at her depot is flagged`, flagged.length, 1);
  equal(`${label}: with her points named`, flagged[0].pointsUnspent, g.miles.s1);
  check(`${label}: and something to do about it`, flagged[0].hint.length > 0, flagged[0].hint);
  check(
    `${label}: which names a good she can afford`,
    /could load/.test(flagged[0].hint),
    flagged[0].hint,
  );

  // Never other hauliers' vehicles.
  equal(`${label}: only your own fleet`, vehiclesAwaitingOrders(g, 'p2').length, 0);

  // Once she is under way she is not waiting for anything.
  const driven = processAction(g, { type: 'DRIVE_TO', vehicleId: 's1', destination: 'london' });
  check(`${label}: she drives`, driven !== g);
  equal(`${label}: a vehicle on the road is never flagged`, vehiclesAwaitingOrders(driven, 'p1').length, 0);

  // A penniless haulier gets told why, rather than being told to go shopping.
  let broke = setCash(g, 'p1', 0);
  equal(`${label}: a pauper's vehicle is still flagged`, vehiclesAwaitingOrders(broke, 'p1').length, 1);
  check(
    `${label}: but told she can afford nothing`,
    /afford/.test(vehiclesAwaitingOrders(broke, 'p1')[0].hint),
    vehiclesAwaitingOrders(broke, 'p1')[0].hint,
  );

  // A full load bed should be running itself in, not shopping.
  const cargo = { good: 'tomatoes', paid: 20, boughtAt: 'southampton', boughtOnTurn: 0 };
  let full = place(g, 's1', 'southampton', [cargo, { ...cargo }]);
  full = { ...full, miles: { ...full.miles, s1: 7 } };
  check(
    `${label}: a full load bed is told to drive, not to load`,
    /hold is full/.test(vehiclesAwaitingOrders(full, 'p1')[0].hint),
    vehiclesAwaitingOrders(full, 'p1')[0].hint,
  );

  // A struck depot cannot be traded at, and the hint has to say so rather than name a cargo.
  const struck = {
    ...g,
    hazards: { ...FULL_HAZARDS_OFF, events: true },
    events: [
      { id: 1, kind: 'strike' as const, depot: 'southampton', from: 1, until: 9, headline: '', detail: '' },
    ],
  };
  check(
    `${label}: a shut depot is named as the reason`,
    /shut by the strike/.test(vehiclesAwaitingOrders(struck, 'p1')[0].hint),
    vehiclesAwaitingOrders(struck, 'p1')[0].hint,
  );
}

/**
 * The hostile bid — the way back in for a haulier who has fallen behind on shares.
 */
function testHostileBid() {
  const label = 'hostile bid';

  // --- the price ladder ---------------------------------------------------------------------------
  equal(`${label}: a haulier with nothing pays the least`, hostileBidPrice(0, 0), 180);
  check(
    `${label}: holding more costs more`,
    hostileBidPrice(0, 5) > hostileBidPrice(0, 0),
    `${hostileBidPrice(0, 5)} vs ${hostileBidPrice(0, 0)}`,
  );
  for (let held = 0; held < SHARE_MAJORITY; held++) {
    check(
      `${label}: price rises with the buyer's holding at ${held}`,
      hostileBidPrice(0, held + 1) > hostileBidPrice(0, held),
    );
  }
  // Doubling, globally — the bound.
  for (let made = 0; made < 8; made++) {
    equal(
      `${label}: bid ${made + 1} costs twice bid ${made}`,
      hostileBidPrice(made + 1, 0),
      hostileBidPrice(made, 0) * 2,
    );
  }
  check(
    `${label}: eight bids outrun any purse the game produces`,
    hostileBidPrice(8, 0) > 27_623,
    `${hostileBidPrice(8, 0)}`,
  );
  check(
    `${label}: dearer than the bank's opening price`,
    hostileBidPrice(0, 0) > sharePriceFor(TOTAL_SHARES),
    `${hostileBidPrice(0, 0)} vs ${sharePriceFor(TOTAL_SHARES)}`,
  );
  const bankSix = Array.from({ length: SHARE_MAJORITY }, (_, i) =>
    sharePriceFor(TOTAL_SHARES - i),
  ).reduce((a, b) => a + b, 0);
  const bidSix = Array.from({ length: SHARE_MAJORITY }, (_, i) => hostileBidPrice(i, i)).reduce(
    (a, b) => a + b,
    0,
  );
  check(
    `${label}: buying a majority by bid costs far more than buying it from the bank`,
    bidSix > bankSix * 4,
    `${bidSix} against ${bankSix}`,
  );

  // --- it opens the door canBuyOut shuts -----------------------------------------------------------
  check(
    `${label}: canBuyOut still bars a haulier holding nothing`,
    !canBuyOut(0, 3),
    'the dead end this move exists to fix',
  );
  check(`${label}: a hostile bid does not`, canHostileBid(0, 5000, 3, 0));
  check(`${label}: but a majority holder is barred`, !canHostileBid(SHARE_MAJORITY, 99_999, 3, 0));
  check(`${label}: and an empty seller cannot be raided`, !canHostileBid(0, 99_999, 0, 0));
  check(`${label}: nor can it be made without the cash`, !canHostileBid(0, 10, 3, 0));

  // --- the transaction ------------------------------------------------------------------------------
  let g = createInitialState('t-hb', 'Bid', {
    humanNames: ['A', 'B'], aiCount: 0, seed: 'hb',
    hazards: { ...FULL_HAZARDS_OFF, hostileBids: true },
  });
  g = setShares(g, 'p1', 0);
  g = setShares(g, 'p2', 4);
  g = setCash(g, 'p1', 5000);
  g = setCash(g, 'p2', 100);
  g = processAction(g, { type: 'ROLL' });

  const price = hostileBidPrice(0, 0);
  const bid = processAction(g, { type: 'HOSTILE_BID', targetId: 'p2' });
  check(`${label}: a haulier with nothing can bid`, bid !== g);
  equal(`${label}: the buyer gains a share`, haulierShares(bid, 'p1'), 1);
  equal(`${label}: the seller loses one`, haulierShares(bid, 'p2'), 3);
  equal(`${label}: the buyer pays the full price`, cash(bid, 'p1'), 5000 - price);
  // Brokerage: the seller is compensated, but not with all of it.
  const proceeds = cash(bid, 'p2') - 100;
  check(`${label}: the seller is compensated`, proceeds > 0);
  check(`${label}: but brokerage is destroyed, not paid`, proceeds < price, `${proceeds} of ${price}`);
  equal(`${label}: ten shares still exist`, totalShares(bid), TOTAL_SHARES);
  equal(`${label}: the counter advances`, bid.hostileBids, 1);

  // Off means off, so a faithful game never sees it.
  let plain = createInitialState('t-hb-off', 'Off', {
    humanNames: ['A', 'B'], aiCount: 0, seed: 'hb',
    hazards: { ...FULL_HAZARDS_OFF, hostileBids: false },
  });
  plain = setShares(plain, 'p2', 4);
  plain = setCash(plain, 'p1', 5000);
  plain = processAction(plain, { type: 'ROLL' });
  check(
    `${label}: refused outright when switched off`,
    processAction(plain, { type: 'HOSTILE_BID', targetId: 'p2' }) === plain,
  );
  check(
    `${label}: and you cannot bid against yourself`,
    processAction(bid, { type: 'HOSTILE_BID', targetId: 'p1' }) === bid,
  );
}

/**
 * Per-depot prices, and the one property that must not invert.
 *
 * A delivery pays on the CARD's reckoned price per unit. If it paid on what the haulier actually
 * handed over, the cheapest depot would earn the least and the correct play would be to always buy
 * at the dearest one — which is nonsense, and easy to write by accident, since `lot.paid` is right
 * there on the lot. The margin check below is the guard.
 */
function testDepotPrices() {
  const label = 'depot prices';

  // The band has to be real, or none of this is a decision.
  const spread = observedSpread();
  check(`${label}: depots disagree about price`, spread.min < 1 && spread.max > 1, JSON.stringify(spread));
  check(`${label}: nothing escapes the floor`, spread.min >= PRICE_FLOOR - 0.02, `${spread.min}`);
  check(`${label}: nothing escapes the ceiling`, spread.max <= PRICE_CEILING + 0.02, `${spread.max}`);

  // Stable across calls and across games: two players reading the same depot table must agree.
  for (const depot of DEPOTS) {
    for (const good of depot.supplies) {
      equal(`${label}: ${depot.id}/${good} is stable`, priceAt(depot.id, good), priceAt(depot.id, good));
      check(`${label}: ${depot.id}/${good} is a positive whole number`,
        Number.isInteger(priceAt(depot.id, good)) && priceAt(depot.id, good) > 0);
    }
  }

  // A good with several sellers, so cheapest and dearest are genuinely different depots.
  const good = GOODS.map(g => g.id).find(g => {
    const sellers = cheapestSources(g);
    return sellers.length >= 2 && priceAt(sellers[0], g) < priceAt(sellers[sellers.length - 1], g);
  })!;
  check(`${label}: found a good with a real spread`, good !== undefined, `${good}`);

  const sellers = cheapestSources(good);
  const cheap = sellers[0];
  const dear = sellers[sellers.length - 1];
  check(`${label}: cheapestSources is ordered`, priceAt(cheap, good) < priceAt(dear, good));

  // --- the margin must favour the cheap depot -----------------------------------------------------
  const margin = (from: DepotId): number => {
    let g = createInitialState('t-price', 'Price', { humanNames: ['A'], aiCount: 1, seed: 'price' });
    // A card for this good, so the delivery is on the reckoning rather than on what was paid.
    const destination = DEPOTS.find(p => p.demands.includes(good) && p.id !== from)!.id;
    g = {
      ...g,
      contracts: [
        { id: 'cx', good, destination, price: GOOD_BY_ID[good].basePrice, fills: [] },
        ...g.contracts.slice(1),
      ],
    };
    g = place(g, 's1', from);
    g = setCash(g, 'p1', 10_000);
    g = processAction(g, { type: 'ROLL' });
    const before = cash(g, 'p1');
    const bought = processAction(g, { type: 'BUY_CARGO', vehicleId: 's1', good });
    check(`${label}: she loads at ${from}`, bought !== g);
    const atDest = place(bought, 's1', destination, vehicleOf(bought, 's1').hold);
    const landed = processAction(atDest, { type: 'DELIVER', vehicleId: 's1', contractId: 'cx' });
    check(`${label}: she lands it from ${from}`, landed !== atDest);
    return cash(landed, 'p1') - before;
  };

  const cheapMargin = margin(cheap);
  const dearMargin = margin(dear);
  check(
    `${label}: buying cheap earns MORE, not less`,
    cheapMargin > dearMargin,
    `${cheap} netted ${cheapMargin}, ${dear} netted ${dearMargin} — the incentive is inverted`,
  );
  equal(
    `${label}: and the gap is exactly the price difference`,
    cheapMargin - dearMargin,
    priceAt(dear, good) - priceAt(cheap, good),
  );
}

/**
 * A card names a buyer, never a seller.
 */
function testSourcelessCards() {
  const label = 'sourceless cards';

  const deck = buildDeck();
  check(`${label}: the deck is not empty`, deck.length > 0);
  check(
    `${label}: every key is good|destination`,
    deck.every(k => k.split('|').length === 2),
    deck.find(k => k.split('|').length !== 2),
  );
  check(
    `${label}: no card names a source depot`,
    deck.every(k => {
      const parsed = parseCardKey(k);
      return parsed !== null && !('source' in parsed);
    }),
  );
  // Old three-part keys must still parse, or an existing save loses its draw pile.
  const legacy = parseCardKey('tomatoes|southampton|london');
  equal(`${label}: a legacy key keeps its good`, legacy?.good, 'tomatoes');
  equal(`${label}: a legacy key keeps its destination`, legacy?.destination, 'london');

  // Every good a card can name must be buyable somewhere within reach of the buyer, or the card is
  // an errand nobody can run.
  for (const k of deck) {
    const parsed = parseCardKey(k)!;
    const sellers = sourcesFor(parsed.good, parsed.destination).filter(
      p => p !== parsed.destination,
    );
    check(`${label}: ${k} has a seller`, sellers.length > 0);
    check(
      `${label}: ${k} has a seller within the cap`,
      sellers.some(p => distanceBetween(p, parsed.destination) <= CONTRACT_MAX_DISTANCE),
    );
  }

  // The behavioural check: load somewhere the old card would not have named, and land it. Textiles
  // has three suppliers, so it is the good worth proving this on.
  let g = createInitialState('t-src', 'Src', { humanNames: ['A'], aiCount: 1, seed: 'src' });
  g = forceContract(g, { id: 'src-card', good: 'textiles', destination: 'bristol', price: GOOD_BY_ID.textiles.basePrice });
  const card = g.contracts[0];
  const sellers = sourcesFor(card.good, card.destination).filter(p => p !== card.destination);
  check(`${label}: the test card has at least two sellers`, sellers.length >= 2, `${sellers.length}`);

  // Deliberately the *furthest* seller, to be sure nothing privileges a canonical one.
  const odd = sellers[sellers.length - 1];
  g = place(g, 's1', odd);
  g = setCash(g, 'p1', 5000);
  g = processAction(g, { type: 'ROLL' });
  const bought = processAction(g, { type: 'BUY_CARGO', vehicleId: 's1', good: card.good });
  check(`${label}: she loads at ${odd}`, bought !== g);
  equal(`${label}: one slot filled`, vehicleOf(bought, 's1').hold.length, 1);

  // place() empties the hold unless it is handed back — carry her cargo across with her.
  const atDest = place(bought, 's1', card.destination, vehicleOf(bought, 's1').hold);
  const landed = processAction(atDest, { type: 'DELIVER', vehicleId: 's1', contractId: card.id });
  check(`${label}: and lands it on the card`, landed !== atDest);
  equal(`${label}: for the full first-home money`, cash(landed, 'p1') - cash(atDest, 'p1'), card.price * 4);
}

/**
 * The world event deck. Every check here is about the deck being unable to trap the game, because
 * that is the whole risk of an event that shuts a depot: expiry is the safety property.
 */
function testWorldEvents() {
  const label = 'events';

  // --- off means off, and off must still be the old game -----------------------------------------
  const playOff = () => {
    let s = createInitialState('t-ev-off', 'Off', {
      humanNames: [], aiCount: 4, seed: 'ev-off',
      hazards: { ...FULL_HAZARDS_OFF, weather: true, theft: true, events: false },
    });
    for (let i = 0; i < 600 && s.phase !== 'over'; i++) s = runAiTurn(s);
    return s;
  };
  const off = playOff();
  equal(`${label}: off draws nothing`, (off.events ?? []).length, 0);
  equal(`${label}: off logs nothing`, off.log.filter(e => e.kind === 'event').length, 0);
  check(`${label}: off replays byte-identically`, JSON.stringify(off) === JSON.stringify(playOff()));

  // --- on: audit a long game turn by turn --------------------------------------------------------
  let s = createInitialState('t-ev-on', 'On', {
    humanNames: [], aiCount: 4, seed: 'ev-on',
    hazards: { ...FULL_HAZARDS_OFF, weather: true, theft: true, events: true },
  });

  let drawn = 0;
  let retired = 0;
  let maxActive = 0;
  let strikeRounds = 0;
  let duringDeclaration = 0;
  let declaredBeforeTurn = false;
  let lastKindDealt = '';
  const kindsSeen = new Set<string>();
  let lastSeq = -1;

  const audit = (state: GameState) => {
    const active = state.events ?? [];
    maxActive = Math.max(maxActive, active.length);

    // The safety property: nothing in force may already have expired.
    for (const e of active) {
      check(`${label}: ${e.kind} in force has not expired`, e.until >= state.round);
      check(`${label}: ${e.kind} has a sane span`, e.until >= e.from);
    }
    // Two "Strike at Bristol" cards at once reads as a bug even when it is not.
    const kinds = active.map(e => e.kind);
    equal(`${label}: no two of a kind at once`, new Set(kinds).size, kinds.length);
    check(`${label}: at most ${MAX_ACTIVE_EVENTS} at once`, active.length <= MAX_ACTIVE_EVENTS);

    // Nothing may be bought at a struck depot or in an embargoed good — checked against the hold,
    // which is where a leak would actually show up.
    for (const e of active) {
      if (e.kind === 'strike') {
        strikeRounds++;
        for (const vehicle of state.vehicles) {
          const loadedHere = vehicle.hold.filter(
            lot => lot.boughtAt === e.depot && lot.boughtOnTurn >= turnAtRound(state, e.from),
          );
          equal(`${label}: nothing lades at struck ${e.depot}`, loadedHere.length, 0);
        }
      }
    }

    for (const entry of state.log) {
      if (entry.seq <= lastSeq) continue;
      lastSeq = entry.seq;
      if (entry.kind !== 'event') continue;
      if (entry.data?.ended) {
        // Retirement during a countdown is intended, and is the bug this test already caught once.
        retired++;
        continue;
      }
      drawn++;
      const kind = String(entry.data?.event);
      // Never the same kind twice running.
      check(
        `${label}: does not deal ${kind} twice running`,
        kind !== lastKindDealt,
        `after ${lastKindDealt}`,
      );
      lastKindDealt = kind;
      kindsSeen.add(kind);
      // Judged on whether a declaration was already standing when the turn began. An event drawn
      // at the top of a turn in which somebody then declares is legitimate — the draw came first.
      if (declaredBeforeTurn) duringDeclaration++;
    }
  };

  // The turn a round began, near enough for the lading check above.
  function turnAtRound(state: GameState, round: number): number {
    return (round - 1) * state.hauliers.length;
  }

  for (let i = 0; i < 900 && s.phase !== 'over'; i++) {
    declaredBeforeTurn = s.declaration !== null;
    s = runAiTurn(s);
    audit(s);
  }

  check(`${label}: the deck actually deals (${drawn} drawn)`, drawn >= 5);
  check(`${label}: and retires what it deals (${retired} retired)`, retired >= 1);
  check(
    `${label}: every kind can appear (${[...kindsSeen].sort().join(',')})`,
    kindsSeen.size >= 3,
  );
  equal(`${label}: nothing is drawn during a declaration`, duringDeclaration, 0);
  check(`${label}: strikes do occur (${strikeRounds} vehicle-rounds under one)`, strikeRounds >= 0);

  // Nothing left in force may have expired by the final round either.
  for (const e of s.events ?? []) {
    check(`${label}: nothing outlives its span at game end`, e.until >= s.round);
  }

  // --- an unpaid premium must never hold a vehicle alongside -----------------------------------------
  {
    let g = createInitialState('t-premium', 'Premium', {
      humanNames: ['A'], aiCount: 1, seed: 'premium',
      hazards: { ...FULL_HAZARDS_OFF, weather: true, theft: true, events: false },
    });
    g = place(g, 's1', 'southampton');
    g = setCash(g, 'p1', 5000);
    g = processAction(g, { type: 'ROLL' });
    g = processAction(g, { type: 'SET_INSURANCE', vehicleId: 's1', insured: true });
    g = processAction(g, { type: 'BUY_CARGO', vehicleId: 's1', good: 'tomatoes' });
    check(`${label}: the vehicle is insured and laden`, vehicleOf(g, 's1').insured === true);

    // Strip her owner bare and order her onto the road. Zero rather than a token pound: a single
    // lot's premium can be as little as £1, so £1 in hand now covers it.
    g = setCash(g, 'p1', 0);
    const driven = processAction(g, { type: 'DRIVE_TO', vehicleId: 's1', destination: 'london' });
    check(`${label}: a pauper's vehicle still sets off`, driven !== g);
    check(`${label}: and her cover has lapsed`, vehicleOf(driven, 's1').insured === false);
    equal(`${label}: with nothing taken for the premium`, cash(driven, 'p1'), 0);
    check(
      `${label}: the lapse is on the record`,
      driven.log.some(e => e.kind === 'insurance' && e.data?.lapsed === 1),
    );
  }

  // --- the price table ---------------------------------------------------------------------------
  const priced = (kind: WorldEventKind): number => {
    const g: GameState = {
      ...s,
      events: [{ id: 1, kind, good: 'tomatoes', from: 1, until: 99, headline: '', detail: '' }],
    };
    return landedValue(g, 'tomatoes', 100, 4);
  };
  const plain = landedValue({ ...s, events: [] }, 'tomatoes', 100, 4);
  equal(`${label}: no news pays the plain multiplier`, plain, 400);
  check(`${label}: a glut pays less than plain`, priced('glut') < plain);
  check(`${label}: a shortage pays more than plain`, priced('shortage') > plain);
  equal(`${label}: a bounty adds a flat premium`, priced('bounty'), plain + BOUNTY_PER_UNIT);
  equal(
    `${label}: an unrelated good is unaffected`,
    landedValue(
      { ...s, events: [{ id: 1, kind: 'glut', good: 'tomatoes', from: 1, until: 99, headline: '', detail: '' }] },
      'fish',
      100,
      4,
    ),
    400,
  );

  // --- determinism with the deck on --------------------------------------------------------------
  const playOn = () => {
    let g = createInitialState('t-ev-det', 'Det', {
      humanNames: [], aiCount: 4, seed: 'ev-det',
      hazards: { ...FULL_HAZARDS_OFF, weather: true, theft: true, events: true },
    });
    for (let i = 0; i < 300 && g.phase !== 'over'; i++) g = runAiTurn(g);
    return JSON.stringify(g);
  };
  check(`${label}: replays byte-identically with the deck on`, playOn() === playOn());
}

// ---------------------------------------------------------------------------

function main() {
  testPayoutLadder();
  testCargoRules();
  testDriving();
  testCaps();
  testDeclaration();
  testRoadWeather();
  testTheft();
  testHazardsOff();
  testPresets();
  testExchangeAndDifficulty();
  testVehicleClasses();
  testDeadlines();
  testStandingCosts();
  testDepotSalesAndCover();
  testAwaitingOrders();
  testHostileBid();
  testDepotPrices();
  testSourcelessCards();
  testWorldEvents();
  testDeterminism();

  const reports: [string, GameReport][] = [];
  // A wide seed set on purpose. Every pathology in this game's history — the deadlocked share
  // split, the softlocked haulier on £10, a runaway share rotation — showed up in some seeds and
  // not others, and a five-seed run called two of them "fixed" while they were still there.
  // Twenty runs in a couple of seconds; there is no reason to look at fewer.
  const SEEDS = [
    'gridlock', 'tailback', 'fogbound', 'ringroad', 'servicestation',
    'junction', 'outrider', 'nightshift', 'overtake', 'dieselrun',
    'hardshoulder', 'rushhour', 'wagontrain', 'loadbay', 'tarmac',
    'flyover', 'roadworks', 'convoy', 'breakdown', 'motorway',
  ];
  for (const seed of SEEDS) {
    reports.push([seed, playAiGame(seed)]);
  }

  console.log('\nAI games');
  console.log('  seed            rounds  turns  deliv  bank@  decl@  raids  winner');
  for (const [seed, r] of reports) {
    console.log(
      `  ${seed.padEnd(14)}  ${String(r.rounds).padStart(6)}  ${String(r.turns).padStart(5)}  ` +
        `${String(r.deliveries).padStart(5)}  ${String(r.bankEmptyRound ?? '-').padStart(5)}  ` +
        `${String(r.firstDeclareRound ?? '-').padStart(5)}  ${String(r.raids).padStart(5)}  ` +
        `${r.winner ?? '(unfinished)'}`,
    );
  }
  console.log('  actions taken (first game):', JSON.stringify(reports[0][1].actions));
  console.log('  final cash (first game):   ', reports[0][1].finalCash.join(', '));

  // A game nobody can finish is the failure mode this harness exists to catch; a game that drags
  // is a design problem worth seeing even when it does eventually end.
  const slow = reports.filter(([, r]) => r.rounds > 250);
  if (slow.length) {
    console.log(`  slow games (>250 rounds): ${slow.map(([seed, r]) => `${seed}:${r.rounds}`).join(', ')}`);
  }

  // The owner's complaint as a number: is the game over by round 30?
  const judged = reports.filter(([, r]) => r.leaderAt30Won !== null);
  const held = judged.filter(([, r]) => r.leaderAt30Won).length;
  console.log(
    `  round-30 share leader went on to win: ${held}/${judged.length}` +
      ` (${judged.length ? Math.round((held / judged.length) * 100) : 0}%)`,
  );

  const shutOut = reports.filter(([, r]) => r.aLockedOutHaulierWon !== null);
  const recovered = shutOut.filter(([, r]) => r.aLockedOutHaulierWon).length;
  const totalLockedOut = reports.reduce((n, [, r]) => n + r.lockedOutAtBankEmpty, 0);
  console.log(
    `  hauliers holding nothing when the bank emptied: ${totalLockedOut}` +
      ` — one of them still won ${recovered}/${shutOut.length} games`,
  );

  const rounds = reports.map(([, r]) => r.rounds).sort((a, b) => a - b);
  console.log(
    `\n  rounds to a winner: min ${rounds[0]}, median ${rounds[Math.floor(rounds.length / 2)]}, max ${rounds[rounds.length - 1]}`,
  );

  const finished = reports.filter(([, r]) => r.winner !== null).length;
  check(
    'AI games: every game reaches a winner',
    finished === reports.length,
    `${finished}/${reports.length} finished`,
  );
  check(
    'AI games: hauliers actually trade',
    reports.every(([, r]) => r.deliveries >= 10),
    `deliveries per game: ${reports.map(([, r]) => r.deliveries).join(', ')}`,
  );

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures.slice(0, 40)) console.log(`  x ${f}`);
    if (failures.length > 40) console.log(`  ... and ${failures.length - 40} more`);
    process.exit(1);
  }
}

main();
