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
import { processAction, runAiTurn } from '../src/sim/actions';
import { PORT_BY_ID, GOOD_BY_ID, distanceBetween } from '../src/sim/content';
import {
  DECLARATION_TURNS,
  FACE_UP_CONTRACTS,
  MAX_SHIPS,
  SHARE_MAJORITY,
  SHARE_PRICE,
  SHARE_RAID_MULTIPLIER,
  SHIP_PRICE,
  TOTAL_SHARES,
  VICTORY_CASH,
} from '../src/sim/rules';
import type { Contract, GameState, Ship } from '../src/sim/types';

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

function place(state: GameState, shipId: string, portId: string, cargo: Ship['cargo'] = null): GameState {
  return {
    ...state,
    ships: state.ships.map(s =>
      s.id === shipId ? { ...s, location: portId, voyage: null, cargo } : s,
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
  s = place(s, 's1', 'liverpool', { ...cargo });
  s = place(s, 's2', 'liverpool', { ...cargo });
  s = place(s, 's3', 'liverpool', { ...cargo });

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
  equal(`${label}: first delivery empties the hold`, shipOf(s, 's1').cargo, null);
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
  check(`${label}: third captain still holds her cargo`, shipOf(s, 's3').cargo !== null);
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
  check(`${label}: buying a supplied good works`, shipOf(loaded, 's1').cargo?.good === 'tea');
  equal(`${label}: purchase debits the price`, cash(loaded, 'p1'), 1000 - GOOD_BY_ID.tea.basePrice);
  check(
    `${label}: a clipper carries one lot`,
    processAction(loaded, { type: 'BUY_CARGO', shipId: 's1', good: 'silk' }) === loaded,
    'second lot accepted',
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

  // Dumping a lot nobody wants recovers half.
  const spec = place(setCash(base, 'p1', 500), 's1', 'liverpool', {
    good: 'tea',
    paid: 60,
    boughtAt: 'foochow',
    boughtOnTurn: 0,
  });
  const dumped = processAction(spec, { type: 'SELL_LOCAL', shipId: 's1' });
  equal(`${label}: dumping recovers half`, cash(dumped, 'p1') - cash(spec, 'p1'), 30);
  check(`${label}: dumping empties the hold`, shipOf(dumped, 's1').cargo === null);

  const noDemand = place(spec, 's1', 'foochow', {
    good: 'tea',
    paid: 60,
    boughtAt: 'foochow',
    boughtOnTurn: 0,
  });
  check(
    `${label}: cannot dump where nobody buys it`,
    processAction(noDemand, { type: 'SELL_LOCAL', shipId: 's1' }) === noDemand,
    'Foochow bought its own tea back',
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
    SHARE_PRICE * SHARE_RAID_MULTIPLIER,
  );
  equal(
    `${label}: the captain bought out is paid`,
    cash(raided, 'p2') - cash(legal, 'p2'),
    SHARE_PRICE * SHARE_RAID_MULTIPLIER,
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
  equal(`${label}: selling back pays half`, cash(rescued, 'p1') - cash(stranded, 'p1'), SHARE_PRICE / 2);
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

  // Short of the cash bar, the claim lapses and trading goes on.
  let poor = setup(SHARE_MAJORITY, VICTORY_CASH - 1, 1);
  poor = processAction(poor, { type: 'DECLARE' });
  const lapsed = idleTurns(poor, DECLARATION_TURNS + 1);
  equal(`${label}: a claim short of ${VICTORY_CASH} lapses`, lapsed.winnerId, null);
  equal(`${label}: play continues after a lapse`, lapsed.declaration, null);
  check(`${label}: the game is still live`, lapsed.phase !== 'over');
  check(
    `${label}: a lapse can be followed by a fresh claim`,
    processAction({ ...lapsed, phase: 'act', activeIndex: 0 }, { type: 'DECLARE' }).declaration !== null,
  );

  // With no ship afloat the claim fails even holding shares and cash.
  let shipless = setup(SHARE_MAJORITY, VICTORY_CASH + 500, 0);
  shipless = processAction(shipless, { type: 'DECLARE' });
  const failed = idleTurns(shipless, DECLARATION_TURNS + 1);
  equal(`${label}: a claim with no ship lapses`, failed.winnerId, null);
}

// ---------------------------------------------------------------------------
// 6. Full AI games, with per-turn invariants
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

      const { contractId, rank, payout, purchasePrice, cardPrice } = entry.data as {
        contractId: string;
        rank: number;
        payout: number;
        purchasePrice: number;
        cardPrice: number;
      };

      const expectedRank = (fillsSeen.get(contractId) ?? 0) + 1;
      fillsSeen.set(contractId, expectedRank);

      equal(`AI game ${seed}: ${contractId} fill ${expectedRank} is ranked correctly`, rank, expectedRank);
      check(
        `AI game ${seed}: ${contractId} is never filled a third time`,
        expectedRank <= 2,
        `reached fill ${expectedRank}`,
      );
      if (rank === 1 || rank === 2) {
        equal(
          `AI game ${seed}: ${contractId} fill ${rank} pays ${rank === 1 ? '4x' : '2x'}`,
          payout,
          purchasePrice * (rank === 1 ? 4 : 2),
        );
      }
      equal(
        `AI game ${seed}: ${contractId} was bought at the card's price`,
        purchasePrice,
        cardPrice,
      );
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
      new Set(state.contracts.map(c => `${c.good}|${c.source}|${c.destination}`)).size ===
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
      if (ship.cargo) {
        check(
          `AI game ${seed}: ${ship.name}'s cargo is a real good`,
          GOOD_BY_ID[ship.cargo.good] !== undefined,
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
        if (bankEmptyRound === null && after.sharesRemaining === 0) bankEmptyRound = after.round;
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

// ---------------------------------------------------------------------------

function main() {
  testPayoutLadder();
  testCargoRules();
  testSailing();
  testCaps();
  testDeclaration();
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
