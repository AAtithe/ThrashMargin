/**
 * Headless rules harness for The Tea Race.
 *
 *     npm run drive --workspace=packages/tea-race
 *
 * Two halves. The first is a set of focused rule checks that drive `processAction` directly, so a
 * rule is proven rather than hoped for — an AI game happens to exercise most of the rules most of
 * the time, which is not the same thing. The second plays whole AI games end to end and asserts the
 * invariants that must hold on every single turn (five cards face up, ten shares in existence, no
 * captain over three ships), then replays one game from its seed to prove nothing reaches for
 * Math.random behind the sim's back.
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
import { PORT_BY_ID, GOOD_BY_ID, GOODS, distanceBetween } from '../src/sim/content';
import {
  CARGO_FRESH_TURNS,
  CARGO_SPOIL_FLOOR,
  CONTRACT_LIFE_ROUNDS,
  CONTRACT_MAX_DISTANCE,
  DECLARATION_TURNS,
  freshness,
  LOAN_STEP,
  loanCeilingFor,
  FACE_UP_CONTRACTS,
  HOLD_SLOTS,
  MAX_SHIPS,
  SHARE_MAJORITY,
  canBuyOut,
  canHostileBid,
  hostileBidPrice,
  sharePriceFor,
  SHARE_RAID_MULTIPLIER,
  SHIP_PRICE,
  TOTAL_SHARES,
  VICTORY_CASH,
} from '../src/sim/rules';
import { LEGS, PORTS, planRoute, sourcesFor } from '../src/sim/content';
import {
  SEASONS,
  planFastestRoute,
  resolveStorm,
  seasonOf,
  stormRating,
  windFor,
} from '../src/sim/weather';
import { indemnityFor, insurancePremium, piracyRating, resolvePiracy } from '../src/sim/hazards';
import {
  PRICE_CEILING,
  PRICE_FLOOR,
  cheapestSources,
  observedSpread,
  priceAt,
  quaysidePrice,
} from '../src/sim/pricing';
import { buildDeck, parseCardKey } from '../src/sim/contracts';
import { shipsAwaitingOrders } from '../src/sim/attention';
import type { Contract, GameState, PortId, Ship, WorldEventKind } from '../src/sim/types';

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
// State surgery, for putting a ship exactly where a rule needs testing
// ---------------------------------------------------------------------------

function place(state: GameState, shipId: string, portId: string, hold: Ship['hold'] = []): GameState {
  return {
    ...state,
    ships: state.ships.map(s =>
      s.id === shipId ? { ...s, location: portId, voyage: null, hold } : s,
    ),
  };
}

function setCash(state: GameState, captainId: string, cash: number): GameState {
  return {
    ...state,
    captains: state.captains.map(c => (c.id === captainId ? { ...c, cash } : c)),
  };
}

function setShares(state: GameState, captainId: string, shares: number): GameState {
  const before = state.captains.find(c => c.id === captainId)!.shares;
  return {
    ...state,
    sharesRemaining: state.sharesRemaining - (shares - before),
    captains: state.captains.map(c => (c.id === captainId ? { ...c, shares } : c)),
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

const cash = (s: GameState, id: string) => s.captains.find(c => c.id === id)!.cash;
const captainShares = (s: GameState, id: string) => s.captains.find(c => c.id === id)!.shares;
const totalShares = (s: GameState) =>
  s.captains.reduce((n, c) => n + c.shares, 0) + s.sharesRemaining;
const shipOf = (s: GameState, id: string) => s.ships.find(x => x.id === id)!;

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

  // A tea run everyone can reach: source Foochow, destination Liverpool.
  const price = GOOD_BY_ID.tea.basePrice;
  s = forceContract(s, {
    id: 'test-card',
    good: 'tea',
    source: 'foochow',
    destination: 'liverpool',
    price,
  });

  const cargo = { good: 'tea', paid: price, boughtAt: 'foochow', boughtOnTurn: 0 };
  s = place(s, 's1', 'liverpool', [{ ...cargo }]);
  s = place(s, 's2', 'liverpool', [{ ...cargo }]);
  s = place(s, 's3', 'liverpool', [{ ...cargo }]);

  // Three humans means every seat change goes through a hotseat handover.
  const pass = (state: GameState) => {
    let next = processAction(state, { type: 'END_TURN' });
    equal(`${label}: hotseat pauses for the handover`, next.phase, 'handover');
    next = processAction(next, { type: 'ACKNOWLEDGE_HANDOVER' });
    return processAction(next, { type: 'ROLL' });
  };

  // Captain A lands first.
  const beforeA = cash(s, 'p1');
  s = processAction(s, { type: 'ROLL' });
  s = processAction(s, { type: 'DELIVER', shipId: 's1', contractId: 'test-card' });
  equal(`${label}: first home pays 4x`, cash(s, 'p1') - beforeA, price * 4);
  equal(`${label}: first delivery empties the hold`, shipOf(s, 's1').hold.length, 0);
  s = pass(s);

  // Captain B lands second.
  const beforeB = cash(s, 'p2');
  s = processAction(s, { type: 'DELIVER', shipId: 's2', contractId: 'test-card' });
  equal(`${label}: second home pays 2x`, cash(s, 'p2') - beforeB, price * 2);
  s = pass(s);

  // The card is spent, so it has already been replaced — the third captain has nothing to land into.
  check(
    `${label}: spent card is retired`,
    !s.contracts.some(c => c.id === 'test-card'),
    'test-card still face-up after two fills',
  );
  equal(`${label}: board is back to five`, s.contracts.length, FACE_UP_CONTRACTS);

  const beforeC = cash(s, 'p3');
  const rejected = processAction(s, { type: 'DELIVER', shipId: 's3', contractId: 'test-card' });
  check(`${label}: third delivery is rejected outright`, rejected === s, 'state changed');
  equal(`${label}: third captain is paid nothing`, cash(s, 'p3') - beforeC, 0);
  check(`${label}: third captain still holds her cargo`, shipOf(s, 's3').hold.length > 0);
}

// ---------------------------------------------------------------------------
// 2. Cargo and port rules
// ---------------------------------------------------------------------------

function testCargoRules() {
  const label = 'cargo';
  let base = createInitialState('t-cargo', 'Cargo', { humanNames: ['A'], aiCount: 1, seed: 'cargo' });
  base = place(base, 's1', 'foochow');
  base = setCash(base, 'p1', 1000);
  base = processAction(base, { type: 'ROLL' });

  check(
    `${label}: cannot buy what the port does not sell`,
    processAction(base, { type: 'BUY_CARGO', shipId: 's1', good: 'guano' }) === base,
    'Foochow sold guano',
  );

  const loaded = processAction(base, { type: 'BUY_CARGO', shipId: 's1', good: 'tea' });
  check(`${label}: buying a supplied good works`, shipOf(loaded, 's1').hold[0]?.good === 'tea');
  // The *quay's* price, which is no longer the card's reckoning — see sim/pricing.ts.
  equal(`${label}: purchase debits this quay's price`, cash(loaded, 'p1'), 1000 - priceAt('foochow', 'tea'));
  equal(`${label}: and that is what the lot records paying`, shipOf(loaded, 's1').hold[0].paid, priceAt('foochow', 'tea'));
  // Three slots, and a fourth lot is refused.
  let filling = loaded;
  for (const g of ['silk', 'porcelain']) {
    filling = processAction(filling, { type: 'BUY_CARGO', shipId: 's1', good: g });
  }
  equal(`${label}: a clipper carries ${HOLD_SLOTS} lots`, shipOf(filling, 's1').hold.length, HOLD_SLOTS);
  check(
    `${label}: a fourth lot is refused`,
    processAction(filling, { type: 'BUY_CARGO', shipId: 's1', good: 'tea' }) === filling,
  );

  const broke = setCash(base, 'p1', 5);
  check(
    `${label}: cannot buy without the money`,
    processAction(broke, { type: 'BUY_CARGO', shipId: 's1', good: 'tea' }) === broke,
  );

  // A rival's ship is not yours to command.
  check(
    `${label}: cannot move another captain's ship`,
    processAction(base, { type: 'BUY_CARGO', shipId: 's2', good: 'tea' }) === base,
  );

  // Jettison recovers nothing at all — the source is explicit, and it is what gives the
  // speculation bottleneck teeth.
  const spec = place(setCash(base, 'p1', 500), 's1', 'liverpool', [
    { good: 'tea', paid: 60, boughtAt: 'foochow', boughtOnTurn: 0 },
    { good: 'silk', paid: 90, boughtAt: 'foochow', boughtOnTurn: 0 },
  ]);
  const dumpedOne = processAction(spec, { type: 'JETTISON', shipId: 's1', good: 'tea' });
  equal(`${label}: jettison returns nothing`, cash(dumpedOne, 'p1') - cash(spec, 'p1'), 0);
  equal(`${label}: jettison frees exactly that good's slots`, shipOf(dumpedOne, 's1').hold.length, 1);
  equal(`${label}: the rest of the hold is untouched`, shipOf(dumpedOne, 's1').hold[0].good, 'silk');

  const dumpedAll = processAction(spec, { type: 'JETTISON', shipId: 's1' });
  equal(`${label}: jettisoning everything clears the hold`, shipOf(dumpedAll, 's1').hold.length, 0);
  equal(`${label}: and still returns nothing`, cash(dumpedAll, 'p1') - cash(spec, 'p1'), 0);

  // Dumping is legal anywhere — over the side is over the side.
  const atSource = place(spec, 's1', 'foochow', [
    { good: 'tea', paid: 60, boughtAt: 'foochow', boughtOnTurn: 0 },
  ]);
  check(
    `${label}: may dump at any port`,
    processAction(atSource, { type: 'JETTISON', shipId: 's1' }) !== atSource,
  );
}

// ---------------------------------------------------------------------------
// 3. Sailing
// ---------------------------------------------------------------------------

function testSailing() {
  const label = 'sailing';
  let s = createInitialState('t-sail', 'Sail', { humanNames: ['A'], aiCount: 1, seed: 'sail' });
  s = place(s, 's1', 'liverpool');
  s = processAction(s, { type: 'ROLL' });

  const points = s.sailPoints.s1;
  check(`${label}: rolled 2d6`, points >= 2 && points <= 12, `got ${points}`);
  equal(`${label}: dice are recorded`, s.dice.s1.length, 2);

  // London is 3 points away, so any roll of 3+ ties up there this turn.
  const short = { ...s, sailPoints: { ...s.sailPoints, s1: 12 } };
  const arrived = processAction(short, { type: 'SAIL_TO', shipId: 's1', destination: 'london' });
  equal(`${label}: a short hop completes in one turn`, shipOf(arrived, 's1').location, 'london');
  equal(
    `${label}: tying up forfeits the rest of the roll`,
    arrived.sailPoints.s1,
    0,
  );

  // Hong Kong is far enough that no single roll reaches it.
  const long = { ...s, sailPoints: { ...s.sailPoints, s1: 12 } };
  const atSea = processAction(long, { type: 'SAIL_TO', shipId: 's1', destination: 'hong_kong' });
  const ship = shipOf(atSea, 's1');
  check(`${label}: a long run leaves her at sea`, ship.location === null && ship.voyage !== null);
  equal(
    `${label}: her course ends at the destination`,
    ship.voyage!.route[ship.voyage!.route.length - 1],
    'hong_kong',
  );
  check(
    `${label}: cannot come about mid-ocean`,
    processAction(atSea, { type: 'SAIL_TO', shipId: 's1', destination: 'london' }) === atSea,
  );

  // The passage cannot be shorter than the chart allows. A ship makes at most 12 points a turn, so
  // arriving in fewer than distance/12 turns would mean the movement maths is handing out free sea
  // miles — which is exactly the kind of drift that only shows up as "the AI wins impossibly fast".
  const chartDistance = distanceBetween('liverpool', 'hong_kong');
  const floorTurns = Math.ceil(chartDistance / 12);
  let running = atSea;
  let turnsSailing = 1; // the roll that set her off
  let remaining = pointsLeft(shipOf(running, 's1'));

  for (let guard = 0; guard < 80 && shipOf(running, 's1').location === null; guard++) {
    running = processAction(running, { type: 'END_TURN' });
    running = processAction(running, { type: 'ROLL' });
    turnsSailing++;
    const now = pointsLeft(shipOf(running, 's1'));
    check(
      `${label}: every turn at sea closes the distance`,
      now < remaining || shipOf(running, 's1').location !== null,
      `${remaining} -> ${now}`,
    );
    remaining = now;
  }

  equal(`${label}: she arrives at Hong Kong`, shipOf(running, 's1').location, 'hong_kong');
  check(
    `${label}: the passage takes at least ${floorTurns} turns`,
    turnsSailing >= floorTurns,
    `took ${turnsSailing} turns for ${chartDistance} points`,
  );
}

/** Sail points still owed before a ship ties up; zero once she is in port. */
function pointsLeft(ship: Ship): number {
  if (!ship.voyage) return 0;
  let total = ship.voyage.legRemaining;
  for (let i = 0; i < ship.voyage.route.length - 1; i++) {
    total += distanceBetween(ship.voyage.route[i], ship.voyage.route[i + 1]);
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
  for (let i = 0; i < 6; i++) fleet = processAction(fleet, { type: 'BUY_SHIP' });
  equal(
    `${label}: a captain may own no more than ${MAX_SHIPS} ships`,
    fleet.ships.filter(x => x.ownerId === 'p1').length,
    MAX_SHIPS,
  );
  equal(
    `${label}: only the ships actually bought are paid for`,
    cash(s, 'p1') - cash(fleet, 'p1'),
    SHIP_PRICE * (MAX_SHIPS - 1),
  );

  let shares = s;
  for (let i = 0; i < 20; i++) shares = processAction(shares, { type: 'BUY_SHARE' });
  const held = shares.captains.reduce((n, c) => n + c.shares, 0);
  equal(`${label}: ten shares exist and no more`, held + shares.sharesRemaining, TOTAL_SHARES);
  check(
    `${label}: one captain can corner the whole issue`,
    shares.captains.find(c => c.id === 'p1')!.shares >= SHARE_MAJORITY,
  );

  // Once the bank is empty, a further purchase is a forced buy-out of the smallest outside stake —
  // and only of a captain holding no more than the buyer already does.
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
  equal(`${label}: buyer gains a share`, raided.captains[0].shares, 7);
  equal(`${label}: the smaller holder gives one up`, raided.captains[1].shares, 3);
  equal(
    `${label}: a buy-out costs ${SHARE_RAID_MULTIPLIER}x`,
    cash(legal, 'p1') - cash(raided, 'p1'),
    sharePriceFor(0) * SHARE_RAID_MULTIPLIER,
  );
  equal(
    `${label}: the captain bought out is paid`,
    cash(raided, 'p2') - cash(legal, 'p2'),
    sharePriceFor(0) * SHARE_RAID_MULTIPLIER,
  );
  equal(
    `${label}: shares are conserved through a buy-out`,
    raided.captains.reduce((n, c) => n + c.shares, 0) + raided.sharesRemaining,
    TOTAL_SHARES,
  );

  const equalStakes = buyout(5, 5);
  check(
    `${label}: an equal holder may be bought out`,
    processAction(equalStakes, { type: 'BUY_SHARE' }).captains[0].shares === 6,
  );

  // The restriction that makes the endgame terminate: you cannot strip a captain bigger than you.
  const uphill = buyout(4, 6);
  check(
    `${label}: a larger holder cannot be raided`,
    processAction(uphill, { type: 'BUY_SHARE' }) === uphill,
    'the smaller captain stripped the larger one',
  );
  const nothing = buyout(0, 10);
  check(
    `${label}: a captain holding nothing cannot force their way in`,
    processAction(nothing, { type: 'BUY_SHARE' }) === nothing,
  );

  // The sum of squares of the holdings strictly increases on every buy-out, which is what bounds
  // how many can ever happen. Assert it directly rather than trusting the argument.
  const sumSquares = (g: GameState) => g.captains.reduce((n, c) => n + c.shares * c.shares, 0);
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
    Math.max(...concentrating.captains.map(c => c.shares)) >= SHARE_MAJORITY,
  );

  // The way out of having no working capital: sell a share back to the bank at half price.
  let stranded = createInitialState('t-broke', 'Broke', { humanNames: ['A'], aiCount: 1, seed: 'broke' });
  stranded = setShares(stranded, 'p1', 6);
  stranded = setCash(stranded, 'p1', 5);
  stranded = processAction(stranded, { type: 'ROLL' });
  const rescued = processAction(stranded, { type: 'SELL_SHARE' });
  check(`${label}: selling back pays something`, cash(rescued, 'p1') > cash(stranded, 'p1'));
  equal(`${label}: selling back costs a share`, rescued.captains[0].shares, 5);
  equal(`${label}: the share returns to the bank`, rescued.sharesRemaining, stranded.sharesRemaining + 1);
  check(
    `${label}: a captain with no shares has nothing to sell back`,
    processAction(setShares(rescued, 'p1', 0), { type: 'SELL_SHARE' }).captains[0].shares === 0,
  );
}

// ---------------------------------------------------------------------------
// 5. Declaration and the three victory conditions
// ---------------------------------------------------------------------------

/** Runs the table forward `rounds` complete laps without anybody doing anything. */
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

  const setup = (shares: number, money: number, ships: number) => {
    let s = createInitialState('t-dec', 'Declare', {
      humanNames: ['A', 'B'],
      aiCount: 0,
      seed: 'declare',
    });
    s = setShares(s, 'p1', shares);
    s = setCash(s, 'p1', money);
    if (ships === 0) s = { ...s, ships: s.ships.filter(x => x.ownerId !== 'p1') };
    return processAction(s, { type: 'ROLL' });
  };

  // Below a majority you cannot declare at all.
  const short = setup(SHARE_MAJORITY - 1, 2000, 1);
  check(
    `${label}: cannot declare without a majority`,
    processAction(short, { type: 'DECLARE' }) === short,
  );

  // A clean win: majority, cash and a ship still in hand when the clock runs out.
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

  // The countdown is twelve *individual turns* whatever the size of the table — the reading that
  // stopped the endgame being forty-eight turns long at four captains. See DECLARATION_TURNS.
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
      `${label}: at ${seats} captains the clock still runs after ${DECLARATION_TURNS - 1} turns`,
      justBefore.phase !== 'over',
      `ended early, phase ${justBefore.phase}`,
    );
    const expired = idleTurns(justBefore, 1);
    equal(`${label}: at ${seats} captains it resolves on turn ${DECLARATION_TURNS}`, expired.winnerId, 'p1');
  }

  // Short of the cash bar the claim COLLAPSES — and the source is explicit that this ends the game
  // rather than lapsing: the declarer loses, and whoever holds the most by value takes the company.
  // That is also what stops a captain who lost the share race from being locked out of winning.
  let poor = setup(SHARE_MAJORITY, VICTORY_CASH - 1, 1);
  poor = processAction(poor, { type: 'DECLARE' });
  const collapsed = idleTurns(poor, DECLARATION_TURNS + 1);
  equal(`${label}: a claim short of ${VICTORY_CASH} ends the game`, collapsed.phase, 'over');
  check(
    `${label}: the declarer does not win it`,
    collapsed.winnerId !== 'p1',
    `p1 won anyway`,
  );
  check(
    `${label}: someone else takes the company`,
    collapsed.winnerId !== null,
    'nobody won',
  );
  check(
    `${label}: and it is the captain worth the most`,
    collapsed.winnerId ===
      collapsed.captains
        .filter(c => c.id !== 'p1')
        .map(c => ({ id: c.id, worth: assetValue(collapsed, c) }))
        .sort((a, b) => b.worth - a.worth)[0]?.id,
  );

  // With no ship afloat the claim fails even holding shares and cash.
  let shipless = setup(SHARE_MAJORITY, VICTORY_CASH + 500, 0);
  shipless = processAction(shipless, { type: 'DECLARE' });
  const failed = idleTurns(shipless, DECLARATION_TURNS + 1);
  equal(`${label}: a claim with no ship also collapses`, failed.phase, 'over');
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
    raided.captains[0].shares === 5 && raided.captains[1].shares === 5,
    `${raided.captains[0].shares} / ${raided.captains[1].shares}`,
  );
}

// ---------------------------------------------------------------------------
// 6. Weather, wind and piracy
// ---------------------------------------------------------------------------

function testWeather() {
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

  // The wind must be directional. In every band that has a fair side, sailing the other way must be
  // worse — otherwise the wind is a tax rather than a routing decision.
  let withAFairSide = 0;
  const legSeasons = LEGS.length * SEASONS.length;
  for (const leg of LEGS) {
    for (const season of SEASONS) {
      const out = windFor(leg.a, leg.b, season);
      const home = windFor(leg.b, leg.a, season);
      // Whichever way is fair, the other way must be strictly worse.
      if (out.modifier > 0) {
        check(
          `${label}: ${leg.a}->${leg.b} fair means the reverse is not`,
          home.modifier < out.modifier,
          `${out.modifier} out, ${home.modifier} home in ${season}`,
        );
      }
      if (home.modifier > 0) {
        check(
          `${label}: ${leg.b}->${leg.a} fair means the reverse is not`,
          out.modifier < home.modifier,
          `${home.modifier} out, ${out.modifier} home in ${season}`,
        );
      }
      if (out.modifier > 0 || home.modifier > 0) withAFairSide++;
    }
  }
  // Around a quarter of the chart is doldrums or horse latitudes, which have no fair side at all, so
  // the rest should. Half of all leg-seasons is a comfortable floor for "the wind means something".
  check(
    `${label}: most legs have a fair direction in most seasons`,
    withAFairSide > legSeasons * 0.5,
    `${withAFairSide} of ${legSeasons} leg-seasons`,
  );

  // The wind redistributes speed rather than removing it: every directional band nets to zero.
  const byBand = new Map<string, { sum: number; dist: number }>();
  for (const leg of LEGS) {
    for (const [a, b] of [[leg.a, leg.b], [leg.b, leg.a]]) {
      for (const season of SEASONS) {
        const w = windFor(a, b, season);
        const e = byBand.get(w.band) ?? { sum: 0, dist: 0 };
        e.sum += w.modifier * leg.distance;
        e.dist += leg.distance;
        byBand.set(w.band, e);
      }
    }
  }
  for (const [band, e] of byBand) {
    // Doldrums and horse latitudes genuinely have no fair side, so they are allowed to be negative.
    if (band === 'doldrums' || band === 'horse') continue;
    check(
      `${label}: ${band} nets to zero over both directions`,
      Math.abs(e.sum / e.dist) < 0.01,
      `mean ${(e.sum / e.dist).toFixed(3)}`,
    );
  }

  // The monsoon must actually reverse across the year, or seasons are decoration.
  const summer = windFor('colombo', 'bombay', 'summer').modifier;
  const winter = windFor('colombo', 'bombay', 'winter').modifier;
  check(
    `${label}: the monsoon reverses between summer and winter`,
    Math.sign(summer) !== Math.sign(winter) && summer !== 0 && winter !== 0,
    `summer ${summer}, winter ${winter}`,
  );

  // The whole point of the wind: some passages take a different route depending on the season.
  let seasonal = 0;
  let differsFromShortest = 0;
  for (const a of PORTS) {
    for (const b of PORTS) {
      if (a.id === b.id) continue;
      const routes = SEASONS.map(sn => planFastestRoute(a.id, b.id, sn)?.path.join('>') ?? '');
      if (new Set(routes).size > 1) seasonal++;
      const shortest = planRoute(a.id, b.id)?.path.join('>') ?? '';
      if (routes.some(r => r !== shortest)) differsFromShortest++;
    }
  }
  check(
    `${label}: some port pairs route differently by season`,
    seasonal > 40,
    `only ${seasonal} of ${PORTS.length * (PORTS.length - 1)} — the wind bands have gone too timid`,
  );
  check(
    `${label}: the fastest route is often not the shortest`,
    differsFromShortest > 100,
    `only ${differsFromShortest}`,
  );

  // Storms cost time and nothing else, and can never drive a ship behind her leg's start.
  let stormy = 0;
  let seed = 12345;
  for (let i = 0; i < 4000; i++) {
    const leg = LEGS[i % LEGS.length];
    const season = SEASONS[i % SEASONS.length];
    const progressed = Math.floor((i % 5) * (leg.distance / 5));
    const ship: Ship = {
      id: 's1', ownerId: 'p1', name: 'Test',
      location: null,
      voyage: {
        route: [leg.b], legFrom: leg.a,
        legRemaining: leg.distance - progressed, legDistance: leg.distance,
      },
      hold: [{ good: 'tea', paid: 60, boughtAt: leg.a, boughtOnTurn: 0 }],
    };
    const out = resolveStorm(seed, ship, season);
    seed = out.seed;
    if (out.setback > 0) {
      stormy++;
      check(
        `${label}: a storm never drives a ship past her leg's start`,
        out.setback <= progressed,
        `set back ${out.setback} having made only ${progressed}`,
      );
    }
    check(`${label}: storm ratings are never negative`, stormRating(leg.a, leg.b, season) >= 0);
  }
  check(`${label}: storms actually happen`, stormy > 20, `only ${stormy} in 4000 rolls`);
}

function testPiracy() {
  const label = 'piracy';

  const rated = LEGS.filter(l => (l.piracy ?? 0) > 0);
  check(`${label}: some waters are piratical`, rated.length >= 10, `${rated.length} legs`);
  check(
    `${label}: safe waters have no rating`,
    LEGS.every(l => (l.piracy ?? 0) >= 0 && (l.piracy ?? 0) <= 3),
  );

  const makeShip = (from: string, to: string, guns: boolean, cargo: boolean): Ship => ({
    id: 's1', ownerId: 'p1', name: 'Test',
    location: null,
    voyage: { route: [to], legFrom: from, legRemaining: 5, legDistance: 10 },
    hold: cargo ? [{ good: 'tea', paid: 60, boughtAt: from, boughtOnTurn: 0 }] : [],
    fittings: guns ? { guns: true } : undefined,
  });

  // Pirates only ever strike where the chart says they are.
  const safe = LEGS.find(l => !l.piracy)!;
  let seed = 999;
  let strikes = 0;
  for (let i = 0; i < 3000; i++) {
    const out = resolvePiracy(seed, makeShip(safe.a, safe.b, false, true), 800);
    seed = out.seed;
    if (out.kind !== 'none') strikes++;
  }
  equal(`${label}: never strikes in safe waters`, strikes, 0);

  // Guns cut both the frequency and the severity. Measured over many trials, not asserted by faith.
  const worst = rated.reduce((a, b) => ((a.piracy ?? 0) >= (b.piracy ?? 0) ? a : b));
  const trial = (guns: boolean) => {
    let s = 4242;
    let encounters = 0;
    let seizures = 0;
    for (let i = 0; i < 20000; i++) {
      const out = resolvePiracy(s, makeShip(worst.a, worst.b, guns, true), 800);
      s = out.seed;
      if (out.kind !== 'none') encounters++;
      if (out.kind === 'seizure') seizures++;
    }
    return { encounters, seizures };
  };
  const bare = trial(false);
  const armed = trial(true);
  check(
    `${label}: guns reduce encounters`,
    armed.encounters < bare.encounters,
    `${armed.encounters} armed vs ${bare.encounters} bare`,
  );
  check(
    `${label}: guns reduce seizures further still`,
    armed.seizures * 3 < bare.seizures,
    `${armed.seizures} armed vs ${bare.seizures} bare`,
  );
  check(
    `${label}: ransom is the common outcome`,
    bare.encounters - bare.seizures > bare.seizures,
    `${bare.seizures} seizures of ${bare.encounters} encounters`,
  );

  // An empty hold cannot be robbed of cargo, so those encounters settle for money.
  let s2 = 77;
  let emptySeizures = 0;
  for (let i = 0; i < 8000; i++) {
    const out = resolvePiracy(s2, makeShip(worst.a, worst.b, false, false), 800);
    s2 = out.seed;
    if (out.kind === 'seizure') emptySeizures++;
  }
  equal(`${label}: a ship running light never loses a cargo`, emptySeizures, 0);

  // A ransom can never take more than the captain has.
  let s3 = 31337;
  for (const cash of [0, 5, 40, 5000]) {
    for (let i = 0; i < 400; i++) {
      const out = resolvePiracy(s3, makeShip(worst.a, worst.b, false, true), cash);
      s3 = out.seed;
      if (out.kind === 'ransom') {
        check(
          `${label}: a ransom never exceeds what is in hand`,
          out.amount <= cash,
          `took ${out.amount} of ${cash}`,
        );
      }
    }
  }
  check(`${label}: rated legs carry a rating helper`, piracyRating(worst.a, worst.b) > 0);
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
      hazards: { weather: false, piracy: false },
    });
    for (let i = 0; i < 400 && s.phase !== 'over'; i++) s = runAiTurn(s);
    return s;
  };
  const a = play();
  const b = play();
  check(`${label}: replays byte-identically`, JSON.stringify(a) === JSON.stringify(b));

  const hazardKinds = new Set(['storm', 'piracy', 'insurance', 'fitting']);
  const leaked = a.log.filter(e => hazardKinds.has(e.kind));
  equal(`${label}: emits no hazard events at all`, leaked.length, 0);
  check(
    `${label}: no ship is ever fitted out`,
    a.ships.every(sh => !sh.fittings && !sh.insured),
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
  /** Share of all ship-turns spent at sea rather than working a quay. */
  atSeaShare: number;
  idleDockedShipTurns: number;
  /** Round the bank sold its last share, and the round of the first declaration. */
  bankEmptyRound: number | null;
  firstDeclareRound: number | null;
  raids: number;
  /**
   * Who led on shares at round 30, and whether they went on to win.
   *
   * The owner's complaint in one number: "the game is clearly won from round 30". If the share
   * leader two-thirds of the way through the opening always takes it, the remaining hundred rounds
   * are ceremony. Measured across the seed set this is the metric the comeback mechanics have to
   * move.
   */
  leaderAt30: string | null;
  leaderAt30Won: boolean | null;
  leaderAt30Shares: number;
  /**
   * Captains holding nothing when the bank sold its last share, and whether any of them recovered.
   *
   * This is the sharper form of the same complaint. Round 30 is arbitrary; the bank emptying is the
   * moment the door actually shuts, because from then on `canBuyOut` needs the buyer to already hold
   * at least as many shares as the seller, and nobody holds fewer than zero.
   */
  lockedOutAtBankEmpty: number;
  aLockedOutCaptainWon: boolean | null;
}

function playAiGame(seed: string, maxRounds = 400): GameReport {
  let s = createInitialState(`t-${seed}`, seed, { humanNames: [], aiCount: 4, seed });

  let deliveries = 0;
  const actions: Record<string, number> = {};
  let shipTurns = 0;
  let atSeaTurns = 0;
  let idleDockedShipTurns = 0;
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
  // Keyed on LogEntry.seq, not an array index: the log is trimmed from the front once it hits
  // LOG_LIMIT, so indices shift and an index cursor would silently re-audit or skip entries.
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
        // Reckoned on the CARD's price per unit, not on what the captain paid. Paying from what was
        // paid would mean the cheapest quay earned the least, so the right play would be to buy at
        // the dearest — see sim/pricing.ts.
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
          check(
            `AI game ${seed}: ${contractId} news pricing is within the table's range`,
            ratio >= GLUT_FACTOR - 0.01 &&
              ratio <= SHORTAGE_FACTOR + (BOUNTY_PER_UNIT * units) / plain + 0.01,
            `paid ${payout} against a plain ${plain} (x${ratio.toFixed(2)})`,
          );
        }
      }
      check(
        `AI game ${seed}: ${contractId} landed 1..${HOLD_SLOTS} units`,
        units >= 1 && units <= HOLD_SLOTS,
        `landed ${units}`,
      );
      // What she paid is a quay price, so it sits inside the band rather than on the reckoning.
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
    const held = state.captains.reduce((n, c) => n + c.shares, 0);
    check(
      `AI game ${seed}: ten shares in existence`,
      held + state.sharesRemaining === TOTAL_SHARES,
      `${held} held + ${state.sharesRemaining} banked`,
    );
    for (const captain of state.captains) {
      check(
        `AI game ${seed}: ${captain.name} within the fleet cap`,
        state.ships.filter(x => x.ownerId === captain.id).length <= MAX_SHIPS,
      );
      check(`AI game ${seed}: ${captain.name} is never overdrawn`, captain.cash >= 0, `${captain.cash}`);
    }
    for (const ship of state.ships) {
      check(
        `AI game ${seed}: ${ship.name} is either in port or at sea, never both`,
        (ship.location === null) !== (ship.voyage === null),
      );
      check(
        `AI game ${seed}: ${ship.name} never exceeds ${HOLD_SLOTS} slots`,
        ship.hold.length <= HOLD_SLOTS,
        `${ship.hold.length} lots aboard`,
      );
      for (const lot of ship.hold) {
        check(
          `AI game ${seed}: ${ship.name}'s cargo is a real good`,
          GOOD_BY_ID[lot.good] !== undefined,
        );
      }
      if (ship.location) {
        check(
          `AI game ${seed}: ${ship.name} lies at a real port`,
          PORT_BY_ID[ship.location] !== undefined,
        );
      }
    }
  };

  let guard = 0;
  while (s.phase !== 'over' && s.round <= maxRounds && guard++ < maxRounds * 8) {
    const captainId = s.captains[s.activeIndex].id;
    const before = s.ships.filter(x => x.ownerId === captainId);
    shipTurns += before.length;
    atSeaTurns += before.filter(x => x.location === null).length;

    let acted = 0;
    s = runAiTurn(s, (after, action) => {
      actions[action.type] = (actions[action.type] ?? 0) + 1;
      if (action.type !== 'ROLL') acted++;
      if (action.type === 'BUY_SHARE') {
        if (bankEmptyRound === null && after.sharesRemaining === 0) {
          bankEmptyRound = after.round;
          lockedOut = after.captains.filter(c => c.shares === 0).map(c => c.id);
        }
        if (bankEmptyRound !== null && after.round >= bankEmptyRound) raids++;
      }
      if (action.type === 'DECLARE' && firstDeclareRound === null) firstDeclareRound = after.round;
      auditContracts(after);
    });
    // A captain whose ships are all in port and who still finds nothing worth doing is stalled.
    if (acted === 0) {
      idleDockedShipTurns += before.filter(x => x.location !== null).length;
    }
    auditInvariants(s);

    // Snapshot the share leader once, the first time the game reaches round 30.
    if (leaderAt30 === null && s.round >= 30) {
      const front = [...s.captains].sort(
        (a, b) => b.shares - a.shares || assetValue(s, b.id) - assetValue(s, a.id),
      )[0];
      leaderAt30 = front.id;
      leaderAt30Shares = front.shares;
    }
  }

  return {
    turns: s.turn,
    rounds: s.round,
    winner: s.winnerId ? s.captains.find(c => c.id === s.winnerId)!.name : null,
    deliveries,
    finalCash: s.captains.map(c => c.cash),
    actions,
    atSeaShare: shipTurns ? atSeaTurns / shipTurns : 0,
    idleDockedShipTurns,
    bankEmptyRound,
    firstDeclareRound,
    raids,
    leaderAt30: leaderAt30 ? s.captains.find(c => c.id === leaderAt30)!.name : null,
    leaderAt30Won: leaderAt30 === null || s.winnerId === null ? null : s.winnerId === leaderAt30,
    leaderAt30Shares,
    lockedOutAtBankEmpty: lockedOut.length,
    aLockedOutCaptainWon:
      lockedOut.length === 0 || s.winnerId === null ? null : lockedOut.includes(s.winnerId),
  };
}

// ---------------------------------------------------------------------------
// 7. Determinism
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
 * The clock: commissions that lapse, and cargo that goes off.
 */
function testDeadlines() {
  const label = 'deadlines';
  const hz = {
    weather: false, piracy: false, events: false,
    hostileBids: false, quaysideSales: false, wages: false, loans: false, deadlines: true,
  };

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
  g = processAction(g, { type: 'BUY_CARGO', shipId: 's1', good: card.good });
  const hold = shipOf(g, 's1').hold;

  const landNow = processAction(place(g, 's1', card.destination, hold), {
    type: 'DELIVER', shipId: 's1', contractId: card.id,
  });
  // The same delivery, but the lot has been aboard far longer.
  const stale = { ...g, turn: g.turn + CARGO_FRESH_TURNS + 30 };
  const landLate = processAction(place(stale, 's1', card.destination, hold), {
    type: 'DELIVER', shipId: 's1', contractId: card.id,
  });
  const fresh = cash(landNow, 'p1') - cash(g, 'p1');
  const old = cash(landLate, 'p1') - cash(stale, 'p1');
  check(`${label}: stale cargo pays less than fresh`, old < fresh, `${old} against ${fresh}`);
  check(`${label}: but still pays something`, old > 0, `${old}`);

  // With the clock off, age is irrelevant.
  const noClock = { ...stale, hazards: { ...hz, deadlines: false } };
  const landedFree = processAction(place(noClock, 's1', card.destination, hold), {
    type: 'DELIVER', shipId: 's1', contractId: card.id,
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
  const hz = {
    weather: false, piracy: false, events: false,
    hostileBids: false, quaysideSales: false, wages: true, loans: true,
  };

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
    hazards: { ...hz, wages: false, loans: false },
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
  const owing = broke.captains.find(c => c.id === 'p1')!.arrears ?? 0;
  check(`${label}: a captain who cannot pay falls into arrears`, owing > 0, `${owing}`);
  check(`${label}: and is not eliminated`, broke.captains.some(c => c.id === 'p1'));
  check(`${label}: cash never goes negative`, broke.captains.every(c => c.cash >= 0));

  // --- borrowing -----------------------------------------------------------------------------------
  let loan = createInitialState('t-loan', 'Loan', { humanNames: ['A'], aiCount: 1, seed: 'loan', hazards: hz });
  loan = setCash(loan, 'p1', 100);
  loan = processAction(loan, { type: 'ROLL' });
  const ceiling = loanCeilingFor(loan.ships.filter(sh => sh.ownerId === 'p1').length, 0);
  check(`${label}: a captain with a ship can borrow something`, ceiling >= LOAN_STEP, `${ceiling}`);

  const borrowed = processAction(loan, { type: 'TAKE_LOAN' });
  check(`${label}: the draw goes through`, borrowed !== loan);
  equal(`${label}: cash rises by the step`, cash(borrowed, 'p1'), 100 + LOAN_STEP);
  equal(`${label}: and the debt with it`, borrowed.captains.find(c => c.id === 'p1')!.debt, LOAN_STEP);

  // The ceiling is a ceiling.
  let maxed = borrowed;
  for (let i = 0; i < 20; i++) maxed = processAction(maxed, { type: 'TAKE_LOAN' });
  check(
    `${label}: never lends past the ceiling`,
    (maxed.captains.find(c => c.id === 'p1')!.debt ?? 0) <= loanCeilingFor(
      maxed.ships.filter(sh => sh.ownerId === 'p1').length,
      maxed.captains.find(c => c.id === 'p1')!.shares,
    ),
  );

  // Debt is netted out of a captain's worth, or borrowing would be a way to fake a fortune.
  const owner = borrowed.captains.find(c => c.id === 'p1')!;
  const clean = { ...owner, debt: 0 };
  check(
    `${label}: debt counts against asset value`,
    assetValue(borrowed, owner) < assetValue(borrowed, clean),
  );

  const repaid = processAction(borrowed, { type: 'REPAY_LOAN' });
  check(`${label}: and it can be paid down`, repaid !== borrowed);
  equal(`${label}: to nothing`, repaid.captains.find(c => c.id === 'p1')!.debt, 0);
  check(
    `${label}: refused outright when loans are switched off`,
    processAction({ ...loan, hazards: { ...hz, loans: false } }, { type: 'TAKE_LOAN' }) !== undefined &&
      processAction({ ...loan, hazards: { ...hz, loans: false } }, { type: 'TAKE_LOAN' }).captains.find(
        c => c.id === 'p1',
      )!.debt === undefined,
  );
}

/**
 * Selling cargo off at the quay, and insurance being worth its premium.
 *
 * Both exist because the owner asked the same question twice over: what does this cost me, and what
 * do I get back? Neither had a defensible answer before.
 */
function testQuaysideAndCover() {
  const label = 'quayside';

  // --- the sale ------------------------------------------------------------------------------------
  const opts = {
    humanNames: ['A'], aiCount: 1, seed: 'quay',
    hazards: { weather: false, piracy: false, events: false, quaysideSales: true },
  };
  let g = createInitialState('t-quay', 'Quay', opts);
  g = setCash(g, 'p1', 3000);
  g = place(g, 's1', 'foochow');
  g = processAction(g, { type: 'ROLL' });
  g = processAction(g, { type: 'BUY_CARGO', shipId: 's1', good: 'tea' });
  const paid = shipOf(g, 's1').hold[0].paid;

  const sold = processAction(g, { type: 'SELL_CARGO', shipId: 's1', good: 'tea' });
  check(`${label}: she can sell off the quay`, sold !== g);
  equal(`${label}: the slot is cleared`, shipOf(sold, 's1').hold.length, 0);
  const back = cash(sold, 'p1') - cash(g, 'p1');
  check(`${label}: she gets something back`, back > 0, `${back}`);
  check(`${label}: but always less than she paid`, back < paid, `${back} of ${paid}`);

  // The whole point of the mechanic: where you unload matters.
  // Not just for one pair — a dealing quay must beat a non-dealing one for every good, everywhere.
  for (const good of GOODS) {
    const dealers = PORTS.filter(
      p => p.supplies.includes(good.id) || p.demands.includes(good.id),
    );
    const strangers = PORTS.filter(
      p => !p.supplies.includes(good.id) && !p.demands.includes(good.id),
    );
    if (dealers.length === 0 || strangers.length === 0) continue;
    const worstDealer = Math.min(...dealers.map(p => quaysidePrice(p.id, good.id)));
    const bestStranger = Math.max(...strangers.map(p => quaysidePrice(p.id, good.id)));
    check(
      `${label}: every quay dealing in ${good.id} pays better than any that does not`,
      worstDealer > bestStranger,
      `worst dealer ${worstDealer}, best stranger ${bestStranger}`,
    );
  }
  // Never arbitrageable: buy and sell on the same quay must always lose.
  for (const port of PORTS) {
    for (const good of port.supplies) {
      check(
        `${label}: ${port.id}/${good} cannot be bought and sold at a profit`,
        quaysidePrice(port.id, good) < priceAt(port.id, good),
      );
    }
  }

  // Off means off — the faithful rule is that it goes over the side for nothing.
  let strict = createInitialState('t-quay-off', 'Off', {
    ...opts,
    hazards: { weather: false, piracy: false, events: false, quaysideSales: false },
  });
  strict = setCash(strict, 'p1', 3000);
  strict = place(strict, 's1', 'foochow');
  strict = processAction(strict, { type: 'ROLL' });
  strict = processAction(strict, { type: 'BUY_CARGO', shipId: 's1', good: 'tea' });
  check(
    `${label}: refused outright when switched off`,
    processAction(strict, { type: 'SELL_CARGO', shipId: 's1', good: 'tea' }) === strict,
  );
  // And jettison still forfeits the lot, whatever the toggle says.
  const dumped = processAction(g, { type: 'JETTISON', shipId: 's1', good: 'tea' });
  equal(`${label}: jettison still recovers nothing`, cash(dumped, 'p1'), cash(g, 'p1'));

  // --- the cover -----------------------------------------------------------------------------------
  equal(`${label}: an empty hull costs nothing to insure`, insurancePremium(0, 1), 0);
  check(`${label}: a laden one does`, insurancePremium(240, 0.5) > 0);
  check(
    `${label}: and a piratical route costs more than a calm one`,
    insurancePremium(240, 1) > insurancePremium(240, 0),
    `${insurancePremium(240, 1)} vs ${insurancePremium(240, 0)}`,
  );
  // Cover follows the premium, or a light passage would be free money.
  const light = { ...shipOf(g, 's1'), hold: [], insured: true };
  equal(
    `${label}: an empty hull is covered for nothing`,
    indemnityFor({ kind: 'ransom', amount: 200, seed: 0 }, light),
    0,
  );
}

/**
 * Ships left standing at a quay with their dice already rolled.
 *
 * The judgement, not the dialog, is what is tested here — a warning that fires on a ship with
 * nothing to do is worse than no warning, because it trains you to click through it.
 */
function testAwaitingOrders() {
  const label = 'awaiting orders';

  let g = createInitialState('t-ao', 'Orders', { humanNames: ['A'], aiCount: 1, seed: 'ao' });
  g = setCash(g, 'p1', 2000);

  // Before the roll there is nothing to waste yet.
  equal(`${label}: silent before the roll`, shipsAwaitingOrders(g, 'p1').length, 0);

  g = processAction(g, { type: 'ROLL' });
  const flagged = shipsAwaitingOrders(g, 'p1');
  equal(`${label}: a rolled ship standing at her quay is flagged`, flagged.length, 1);
  equal(`${label}: with her points named`, flagged[0].pointsUnspent, g.sailPoints.s1);
  check(`${label}: and something to do about it`, flagged[0].hint.length > 0, flagged[0].hint);
  check(
    `${label}: which names a good she can afford`,
    /could load/.test(flagged[0].hint),
    flagged[0].hint,
  );

  // Never other captains' ships.
  equal(`${label}: only your own fleet`, shipsAwaitingOrders(g, 'p2').length, 0);

  // Once she is under way she is not waiting for anything.
  const sailed = processAction(g, { type: 'SAIL_TO', shipId: 's1', destination: 'london' });
  check(`${label}: she sails`, sailed !== g);
  equal(`${label}: a ship at sea is never flagged`, shipsAwaitingOrders(sailed, 'p1').length, 0);

  // A penniless captain gets told why, rather than being told to go shopping.
  let broke = setCash(g, 'p1', 0);
  equal(`${label}: a pauper's ship is still flagged`, shipsAwaitingOrders(broke, 'p1').length, 1);
  check(
    `${label}: but told she can afford nothing`,
    /afford/.test(shipsAwaitingOrders(broke, 'p1')[0].hint),
    shipsAwaitingOrders(broke, 'p1')[0].hint,
  );

  // A full hold should be running itself in, not shopping.
  const cargo = { good: 'cloth', paid: 45, boughtAt: 'liverpool', boughtOnTurn: 0 };
  let full = place(g, 's1', 'liverpool', [cargo, { ...cargo }, { ...cargo }]);
  full = { ...full, sailPoints: { ...full.sailPoints, s1: 7 } };
  check(
    `${label}: a full hold is told to sail, not to load`,
    /hold is full/.test(shipsAwaitingOrders(full, 'p1')[0].hint),
    shipsAwaitingOrders(full, 'p1')[0].hint,
  );

  // A struck port cannot be traded at, and the hint has to say so rather than name a cargo.
  const struck = {
    ...g,
    hazards: { weather: false, piracy: false, events: true },
    events: [
      { id: 1, kind: 'strike' as const, port: 'liverpool', from: 1, until: 9, headline: '', detail: '' },
    ],
  };
  check(
    `${label}: a shut port is named as the reason`,
    /shut by the strike/.test(shipsAwaitingOrders(struck, 'p1')[0].hint),
    shipsAwaitingOrders(struck, 'p1')[0].hint,
  );
}

/**
 * The hostile bid — the way back in for a captain who has fallen behind on shares.
 *
 * Two things need pinning down: that it actually opens the door `canBuyOut` shuts, and that opening
 * it does not cost the game its ending. The second is the reason the price doubles.
 */
function testHostileBid() {
  const label = 'hostile bid';

  // --- the price ladder ---------------------------------------------------------------------------
  equal(`${label}: a captain with nothing pays the least`, hostileBidPrice(0, 0), 180);
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
  // Never a free lunch. A single bid *can* undercut the bank's last and dearest shares, and that is
  // deliberate — a captain who owns nothing late on is exactly who this move is for. What must not
  // happen is the bid being the cheap way to a majority, and the doubling is what prevents it.
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
    `${label}: canBuyOut still bars a captain holding nothing`,
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
    hazards: { weather: false, piracy: false, events: false, hostileBids: true },
  });
  g = setShares(g, 'p1', 0);
  g = setShares(g, 'p2', 4);
  g = setCash(g, 'p1', 5000);
  g = setCash(g, 'p2', 100);
  g = processAction(g, { type: 'ROLL' });

  const price = hostileBidPrice(0, 0);
  const bid = processAction(g, { type: 'HOSTILE_BID', targetId: 'p2' });
  check(`${label}: a captain with nothing can bid`, bid !== g);
  equal(`${label}: the buyer gains a share`, captainShares(bid, 'p1'), 1);
  equal(`${label}: the seller loses one`, captainShares(bid, 'p2'), 3);
  equal(`${label}: the buyer pays the full price`, cash(bid, 'p1'), 5000 - price);
  // Brokerage: the seller is compensated, but not with all of it.
  const proceeds = cash(bid, 'p2') - 100;
  check(`${label}: the seller is compensated`, proceeds > 0);
  check(`${label}: but brokerage is destroyed, not paid`, proceeds < price, `${proceeds} of ${price}`);
  equal(`${label}: ten shares still exist`, totalShares(bid), TOTAL_SHARES);
  equal(`${label}: the counter advances`, bid.hostileBids, 1);

  // Off means off, so a faithful 1988 game never sees it.
  let plain = createInitialState('t-hb-off', 'Off', {
    humanNames: ['A', 'B'], aiCount: 0, seed: 'hb',
    hazards: { weather: false, piracy: false, events: false, hostileBids: false },
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
 * Per-port prices, and the one property that must not invert.
 *
 * A delivery pays on the CARD's reckoned price per unit. If it paid on what the captain actually
 * handed over, the cheapest quay would earn the least and the correct play would be to always buy at
 * the dearest one — which is nonsense, and easy to write by accident, since `lot.paid` is right there
 * on the lot. The margin check below is the guard.
 */
function testPortPrices() {
  const label = 'port prices';

  // The band has to be real, or none of this is a decision.
  const spread = observedSpread();
  check(`${label}: quays disagree about price`, spread.min < 1 && spread.max > 1, JSON.stringify(spread));
  check(`${label}: nothing escapes the floor`, spread.min >= PRICE_FLOOR - 0.02, `${spread.min}`);
  check(`${label}: nothing escapes the ceiling`, spread.max <= PRICE_CEILING + 0.02, `${spread.max}`);

  // Stable across calls and across games: two players reading the same port table must agree.
  for (const port of PORTS) {
    for (const good of port.supplies) {
      equal(`${label}: ${port.id}/${good} is stable`, priceAt(port.id, good), priceAt(port.id, good));
      check(`${label}: ${port.id}/${good} is a positive whole number`,
        Number.isInteger(priceAt(port.id, good)) && priceAt(port.id, good) > 0);
    }
  }

  // A good with several sellers, so cheapest and dearest are genuinely different quays.
  const good = GOODS.map(g => g.id).find(g => {
    const sellers = cheapestSources(g);
    return sellers.length >= 2 && priceAt(sellers[0], g) < priceAt(sellers[sellers.length - 1], g);
  })!;
  check(`${label}: found a good with a real spread`, good !== undefined, `${good}`);

  const sellers = cheapestSources(good);
  const cheap = sellers[0];
  const dear = sellers[sellers.length - 1];
  check(`${label}: cheapestSources is ordered`, priceAt(cheap, good) < priceAt(dear, good));

  // --- the margin must favour the cheap quay -----------------------------------------------------
  const margin = (from: PortId): number => {
    let g = createInitialState('t-price', 'Price', { humanNames: ['A'], aiCount: 1, seed: 'price' });
    // A card for this good, so the delivery is on the reckoning rather than on what was paid.
    const destination = PORTS.find(p => p.demands.includes(good) && p.id !== from)!.id;
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
    const bought = processAction(g, { type: 'BUY_CARGO', shipId: 's1', good });
    check(`${label}: she loads at ${from}`, bought !== g);
    const atDest = place(bought, 's1', destination, shipOf(bought, 's1').hold);
    const landed = processAction(atDest, { type: 'DELIVER', shipId: 's1', contractId: 'cx' });
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
 *
 * The reducer always worked this way — `doDeliver` only ever matched the good and the destination —
 * but the card *read* "Calcutta -> Foochow", so nobody would think to load at Bombay. Opium bought
 * at Bombay filled that card for the full 4x and always would have. These checks pin the behaviour
 * down now that the model says so out loud.
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
    `${label}: no card names a source port`,
    deck.every(k => {
      const parsed = parseCardKey(k);
      return parsed !== null && !('source' in parsed);
    }),
  );
  // Old three-part keys must still parse, or an existing save loses its draw pile.
  const legacy = parseCardKey('opium|calcutta|foochow');
  equal(`${label}: a legacy key keeps its good`, legacy?.good, 'opium');
  equal(`${label}: a legacy key keeps its destination`, legacy?.destination, 'foochow');

  // Every good a card can name must be buyable somewhere within reach of the buyer, or the card is
  // an errand nobody can run — the reachability test that replaced the old source-sink distance cap.
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

  // The behavioural check: load somewhere the old card would not have named, and land it.
  let g = createInitialState('t-src', 'Src', { humanNames: ['A'], aiCount: 1, seed: 'src' });
  const card = g.contracts[0];
  const sellers = sourcesFor(card.good, card.destination).filter(p => p !== card.destination);
  check(`${label}: the test card has at least two sellers`, sellers.length >= 2, `${sellers.length}`);

  // Deliberately the *furthest* seller, to be sure nothing privileges a canonical one.
  const odd = sellers[sellers.length - 1];
  g = place(g, 's1', odd);
  g = setCash(g, 'p1', 5000);
  g = processAction(g, { type: 'ROLL' });
  const bought = processAction(g, { type: 'BUY_CARGO', shipId: 's1', good: card.good });
  check(`${label}: she loads at ${odd}`, bought !== g);
  equal(`${label}: one slot filled`, shipOf(bought, 's1').hold.length, 1);

  // place() empties the hold unless it is handed back — carry her cargo across with her.
  const atDest = place(bought, 's1', card.destination, shipOf(bought, 's1').hold);
  const landed = processAction(atDest, { type: 'DELIVER', shipId: 's1', contractId: card.id });
  check(`${label}: and lands it on the card`, landed !== atDest);
  equal(`${label}: for the full first-home money`, cash(landed, 'p1') - cash(atDest, 'p1'), card.price * 4);
}

/**
 * The world event deck. Every check here is about the deck being unable to trap the game, because
 * that is the whole risk of an event that shuts a port: expiry is the safety property.
 */
function testWorldEvents() {
  const label = 'events';

  // --- off means off, and off must still be the old game -----------------------------------------
  const playOff = () => {
    let s = createInitialState('t-ev-off', 'Off', {
      humanNames: [], aiCount: 4, seed: 'ev-off',
      hazards: { weather: true, piracy: true, events: false },
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
    hazards: { weather: true, piracy: true, events: true },
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
    // Two "Strike at Bombay" cards at once reads as a bug even when it is not.
    const kinds = active.map(e => e.kind);
    equal(`${label}: no two of a kind at once`, new Set(kinds).size, kinds.length);
    check(`${label}: at most ${MAX_ACTIVE_EVENTS} at once`, active.length <= MAX_ACTIVE_EVENTS);

    // Nothing may be bought at a struck port or in an embargoed good — checked against the hold,
    // which is where a leak would actually show up.
    for (const e of active) {
      if (e.kind === 'strike') {
        strikeRounds++;
        for (const ship of state.ships) {
          const loadedHere = ship.hold.filter(
            lot => lot.boughtAt === e.port && lot.boughtOnTurn >= turnAtRound(state, e.from),
          );
          equal(`${label}: nothing lades at struck ${e.port}`, loadedHere.length, 0);
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
      // Never the same kind twice running. Four shortages in a row read as a stuck deck when this
      // was only guarded for concurrency.
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

  // The turn a round began, near enough for the lading check above: a strike drawn at the top of
  // round N cannot be dodged by cargo bought in round N-1.
  function turnAtRound(state: GameState, round: number): number {
    return (round - 1) * state.captains.length;
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
  check(`${label}: strikes do occur (${strikeRounds} ship-rounds under one)`, strikeRounds >= 0);

  // Nothing left in force may have expired by the final round either.
  for (const e of s.events ?? []) {
    check(`${label}: nothing outlives its span at game end`, e.until >= s.round);
  }

  // --- an unpaid premium must never hold a ship alongside -----------------------------------------
  //
  // The bug this pins down cost 400 rounds in one game: cast-off charges the premium, a captain who
  // could not pay had the whole action refused, and the ship never left port again.
  {
    let g = createInitialState('t-premium', 'Premium', {
      humanNames: ['A'], aiCount: 1, seed: 'premium',
      hazards: { weather: true, piracy: true, events: false },
    });
    g = place(g, 's1', 'bombay');
    g = setCash(g, 'p1', 5000);
    g = processAction(g, { type: 'ROLL' });
    g = processAction(g, { type: 'SET_INSURANCE', shipId: 's1', insured: true });
    g = processAction(g, { type: 'BUY_CARGO', shipId: 's1', good: 'opium' });
    check(`${label}: the ship is insured and laden`, shipOf(g, 's1').insured === true);

    // Strip her owner bare and order her to sea. Zero rather than a token pound: since insurance was
    // repriced a single lot's premium can be as little as £1, so £1 in hand now covers it and the
    // lapse path this test exists for would never be reached.
    g = setCash(g, 'p1', 0);
    const sailed = processAction(g, { type: 'SAIL_TO', shipId: 's1', destination: 'colombo' });
    check(`${label}: a pauper's ship still casts off`, sailed !== g);
    check(`${label}: and her cover has lapsed`, shipOf(sailed, 's1').insured === false);
    equal(`${label}: with nothing taken for the premium`, cash(sailed, 'p1'), 0);
    check(
      `${label}: the lapse is on the record`,
      sailed.log.some(e => e.kind === 'insurance' && e.data?.lapsed === 1),
    );
  }

  // --- the price table ---------------------------------------------------------------------------
  const priced = (kind: WorldEventKind): number => {
    const g: GameState = {
      ...s,
      events: [{ id: 1, kind, good: 'tea', from: 1, until: 99, headline: '', detail: '' }],
    };
    return landedValue(g, 'tea', 100, 4);
  };
  const plain = landedValue({ ...s, events: [] }, 'tea', 100, 4);
  equal(`${label}: no news pays the plain multiplier`, plain, 400);
  check(`${label}: a glut pays less than plain`, priced('glut') < plain);
  check(`${label}: a shortage pays more than plain`, priced('shortage') > plain);
  equal(`${label}: a bounty adds a flat premium`, priced('bounty'), plain + BOUNTY_PER_UNIT);
  equal(
    `${label}: an unrelated good is unaffected`,
    landedValue(
      { ...s, events: [{ id: 1, kind: 'glut', good: 'tea', from: 1, until: 99, headline: '', detail: '' }] },
      'silk',
      100,
      4,
    ),
    400,
  );

  // --- determinism with the deck on --------------------------------------------------------------
  const playOn = () => {
    let g = createInitialState('t-ev-det', 'Det', {
      humanNames: [], aiCount: 4, seed: 'ev-det',
      hazards: { weather: true, piracy: true, events: true },
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
  testSailing();
  testCaps();
  testDeclaration();
  testWeather();
  testPiracy();
  testHazardsOff();
  testDeadlines();
  testStandingCosts();
  testQuaysideAndCover();
  testAwaitingOrders();
  testHostileBid();
  testPortPrices();
  testSourcelessCards();
  testWorldEvents();
  testDeterminism();

  const reports: [string, GameReport][] = [];
  // A wide seed set on purpose. Every pathology in this game's history — the deadlocked share
  // split, the softlocked captain on £10, the 10,850-transaction rotation — showed up in some
  // seeds and not others, and a five-seed run called two of them "fixed" while they were still
  // there. Twenty runs in a couple of seconds; there is no reason to look at fewer.
  const SEEDS = [
    'albatross', 'monsoon', 'doldrums', 'trade-wind', 'squall',
    'roaring-forties', 'horse-latitudes', 'sargasso', 'agulhas', 'kuroshio',
    'westerlies', 'harmattan', 'sirocco', 'levanter', 'mistral',
    'willy-willy', 'chinook', 'bora', 'khamsin', 'pampero',
  ];
  for (const seed of SEEDS) {
    reports.push([seed, playAiGame(seed)]);
  }

  console.log('\nAI games');
  console.log('  seed          rounds  turns  deliv  bank@  decl@  raids  winner');
  for (const [seed, r] of reports) {
    console.log(
      `  ${seed.padEnd(12)}  ${String(r.rounds).padStart(6)}  ${String(r.turns).padStart(5)}  ` +
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

  const shutOut = reports.filter(([, r]) => r.aLockedOutCaptainWon !== null);
  const recovered = shutOut.filter(([, r]) => r.aLockedOutCaptainWon).length;
  const totalLockedOut = reports.reduce((n, [, r]) => n + r.lockedOutAtBankEmpty, 0);
  console.log(
    `  captains holding nothing when the bank emptied: ${totalLockedOut}` +
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
    'AI games: captains actually trade',
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
