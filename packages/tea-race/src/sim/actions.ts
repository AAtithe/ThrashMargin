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
import { HOME_PORT, goodName, portName, portSupplies } from './content';
import { drawContract, faceUpKeys, isContractComplete, nextRank } from './contracts';
import { destinationOf, plotCourse, pointsToDestination, reorderAtSea, sail } from './movement';
import { roll2d6 } from './rng';
import { planFastestRoute, seasonOf, windForShip, resolveStorm } from './weather';
import { indemnityFor, insurancePremium, resolvePiracy, routeRisk } from './hazards';
import { priceAt, priceStanding, quaysidePrice } from './pricing';
import type { ShipClassId } from './rules';
import {
  drawEvent,
  expired,
  goodEmbargoed,
  landedValue,
  portStruck,
  remember,
  stillRunning,
} from './events';
import {
  canBuyOut,
  COPPER_SPEED_BONUS,
  DECLARATION_TURNS,
  FITTING_PRICES,
  LOG_LIMIT,
  MAX_SHIPS,
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
  SHIP_NAMES,
  SHIP_CLASSES,
  DEFAULT_SHIP_CLASS,
  slotsOf,
  speedOf,
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
      `New commission posted: ${portName(drawn.contract.destination)} wants ${goodName(
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
 * Everything a captain is worth: cash, ships at what they cost, shares at the bank's current band,
 * and whatever is in the holds. Used when a claim collapses and the game is decided on assets.
 */
export function assetValue(state: GameState, captain: Captain): number {
  const ships = state.ships.filter(sh => sh.ownerId === captain.id);
  const holds = ships.reduce(
    (sum, sh) => sum + sh.hold.reduce((n, lot) => n + lot.paid, 0),
    0,
  );
  return (
    captain.cash +
    ships.reduce((n, sh) => n + SHIP_CLASSES[sh.shipClass ?? DEFAULT_SHIP_CLASS].price, 0) +
    captain.shares * sharePriceFor(TOTAL_SHARES - captain.shares) +
    holds -
    // Net of what is owed. A failed declaration is settled on this figure, and a captain who has
    // borrowed their way to the top of the table has not actually got there.
    (captain.debt ?? 0) -
    (captain.arrears ?? 0)
  );
}

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

  // A failed claim ends the game outright — the declarer loses, and the company goes to whoever
  // holds the most by value. Straight from the source, and it means nobody is ever locked out of
  // winning just because they lost the share race: out-trade the table and the collapse hands it to
  // you. It also removes the endgame drag, since a lapse used to restart the whole thing.
  const missing: string[] = [];
  if (!holdsMajority) missing.push(`only ${captain.shares} shares`);
  if (!holdsCash) missing.push(`only ${money(captain.cash)} in hand`);
  if (ships < 1) missing.push('no ship afloat');

  const ranked = state.captains
    .filter(c => c.id !== captain.id)
    .map(c => ({ c, worth: assetValue(state, c) }))
    .sort((a, b) => b.worth - a.worth);
  const heir = ranked[0];

  let s: GameState = { ...state, declaration: null, phase: 'over', winnerId: heir?.c.id ?? null };
  s = log(
    s,
    'lapse',
    `${captain.name}'s claim collapses — ${missing.join(', ')}. The company is broken up.`,
    captain.id,
  );
  if (heir) {
    s = log(
      s,
      'victory',
      `${heir.c.name} is left holding the most by value — ${money(
        heir.worth,
      )} in cash, ships and shares — and takes the company.`,
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
      `The ${goodName(contract.good)} commission for ${portName(
        contract.destination,
      )} is withdrawn unfilled. ${portName(drawn.contract.destination)} wants ${goodName(
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
 * declarer's home port mid-count would settle the game by dice instead of by play.
 *
 * Expiry, though, keeps running throughout — and it must. Gating the whole of this function on the
 * declaration was the first version, and it quietly froze the deck: anything in force at the moment
 * somebody declared stayed in force for the rest of the game, port closures included. The harness
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
    ...(e.port ? { port: e.port } : {}),
    ...(e.good ? { good: e.good } : {}),
  });
}

/**
 * Crew wages, victualling and interest, charged at the turn of every round.
 *
 * Deliberately not a bankruptcy system. A captain who cannot pay hands over what they have and the
 * remainder becomes arrears, which are then taken off the top of anything they earn. That is a real
 * constraint — a broke captain's next delivery is not their own money — without needing a way to
 * eliminate a player, which this game has no other use for and which would interact badly with a
 * share market that requires everyone to keep holding their shares.
 */
function chargeStandingCosts(state: GameState): GameState {
  const wagesOn = state.hazards?.wages ?? false;
  const loansOn = state.hazards?.loans ?? false;
  if (!wagesOn && !loansOn) return state;

  let s = state;
  for (const captain of state.captains) {
    const ships = s.ships.filter(sh => sh.ownerId === captain.id);
    const laden = ships.reduce((n, sh) => n + sh.hold.length, 0);

    const wages = wagesOn ? wagesFor(ships.length, laden) : 0;
    const debt = captain.debt ?? 0;
    const interest = loansOn && debt > 0 ? Math.ceil(debt * LOAN_INTEREST_PER_ROUND) : 0;
    const owed = wages + interest + (captain.arrears ?? 0);
    if (owed <= 0) continue;

    const current = s.captains.find(c => c.id === captain.id)!;
    const paid = Math.min(current.cash, owed);
    const short = owed - paid;
    s = updateCaptain(s, captain.id, {
      cash: current.cash - paid,
      ...(short > 0 || current.arrears ? { arrears: short } : {}),
    });

    s = log(
      s,
      'wages',
      short > 0
        ? `${captain.name} cannot meet the ${money(owed)} due — ${money(paid)} paid, ${money(
            short,
          )} left owing.`
        : `${captain.name} pays ${money(owed)} in wages${interest > 0 ? ' and interest' : ''}.`,
      captain.id,
      { wages, interest, paid, arrears: short },
    );
  }
  return s;
}

/** Draw down another step against the fleet. */
function doTakeLoan(state: GameState): GameState {
  if (state.phase !== 'act' || !state.hazards?.loans) return state;
  const captain = activeCaptain(state);
  const debt = captain.debt ?? 0;
  const fleet = state.ships.filter(sh => sh.ownerId === captain.id).length;
  if (debt + LOAN_STEP > loanCeilingFor(fleet, captain.shares)) return state;

  let s = updateCaptain(state, captain.id, {
    cash: captain.cash + LOAN_STEP,
    debt: debt + LOAN_STEP,
  });
  return log(
    s,
    'wages',
    `${captain.name} draws ${money(LOAN_STEP)} against the fleet — ${money(
      debt + LOAN_STEP,
    )} outstanding at ${loanRateLabel()} a round.`,
    captain.id,
    { borrowed: LOAN_STEP, debt: debt + LOAN_STEP },
  );
}

/** Pay down as much of the debt as one step and the purse allow. */
function doRepayLoan(state: GameState): GameState {
  if (state.phase !== 'act' || !state.hazards?.loans) return state;
  const captain = activeCaptain(state);
  const debt = captain.debt ?? 0;
  if (debt <= 0) return state;
  const paying = Math.min(debt, LOAN_STEP, captain.cash);
  if (paying <= 0) return state;

  const s = updateCaptain(state, captain.id, {
    cash: captain.cash - paying,
    debt: debt - paying,
  });
  return log(
    s,
    'wages',
    `${captain.name} pays ${money(paying)} off the debt — ${money(debt - paying)} outstanding.`,
    captain.id,
    { repaid: paying, debt: debt - paying },
  );
}

/** Moves to the next seat, handling the round roll-over and the declaration countdown. */
function advanceSeat(state: GameState): GameState {
  let s: GameState = { ...state, sailPoints: {}, dice: {}, turn: state.turn + 1, phase: 'roll' };

  const nextIndex = (s.activeIndex + 1) % s.captains.length;
  s = { ...s, activeIndex: nextIndex };
  if (nextIndex === 0) {
    s = { ...s, round: s.round + 1 };
    s = chargeStandingCosts(s);
    s = expireContracts(s);
    s = turnTheWorld(s);
  }

  // Every individual turn, not once per completed round — see DECLARATION_TURNS. Read as rounds it
  // made the endgame forty-eight turns long at a four-captain table.
  if (s.declaration) {
    const remaining = s.declaration.turnsRemaining - 1;
    s = { ...s, declaration: { ...s.declaration, turnsRemaining: remaining } };
    if (remaining <= 0) s = resolveDeclaration(s);
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
  const season = seasonOf(state.round);
  const weather = state.hazards?.weather ?? false;
  const piracy = state.hazards?.piracy ?? false;
  let s: GameState = { ...state, phase: 'act' };

  const sailPoints: Record<string, number> = {};
  const dice: Record<string, [number, number]> = {};
  let seed = s.rngSeed;

  for (const ship of shipsOf(s, captain.id)) {
    const r = roll2d6(seed);
    seed = r.seed;

    // Wind is applied to the leg the ship is on when she takes it, and to that whole roll. A ship
    // that crosses a waypoint mid-turn keeps the old leg's wind for the remainder — a deliberate
    // simplification, so the number shown is the number used.
    const wind = weather ? windForShip(ship, season) : null;
    const copper = ship.fittings?.copper ? COPPER_SPEED_BONUS : 0;
    // Her class rides on the same roll as wind and copper, rather than being a separate stat, so a
    // heavy hull is slow in exactly the way a foul wind is slow and the two simply add.
    const hull = state.hazards?.shipClasses ? speedOf(ship.shipClass) : 0;
    sailPoints[ship.id] = Math.max(0, r.total + (wind?.modifier ?? 0) + copper + hull);
    dice[ship.id] = r.dice;
  }
  s = { ...s, rngSeed: seed, sailPoints, dice };

  const rolls = Object.entries(dice)
    .map(([id, d]) => {
      const ship = s.ships.find(x => x.id === id);
      const total = s.sailPoints[id] ?? 0;
      const raw = d[0] + d[1];
      return `${ship?.name}: ${d[0]}+${d[1]}${total !== raw ? ` = ${total}` : ''}`;
    })
    .join(', ');
  s = log(s, 'roll', `${captain.name} takes the wind — ${rolls}.`, captain.id);

  // Ships already at sea have no decision to make; advance them now.
  for (const ship of shipsOf(s, captain.id)) {
    if (!ship.voyage) continue;

    if (weather) {
      const wind = windForShip(ship, season);
      if (wind && wind.modifier !== 0) {
        s = log(
          s,
          'sail',
          `${ship.name} is ${wind.modifier > 0 ? 'carried' : 'held'} — ${wind.label}, ${
            wind.modifier > 0 ? '+' : ''
          }${wind.modifier} points.`,
          captain.id,
          { shipId: ship.id, band: wind.band, modifier: wind.modifier },
        );
      }
    }

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

    // Hazards fall on ships still at sea after the run — a ship that reached port is safe in it.
    const afloat = s.ships.find(x => x.id === ship.id)!;
    if (weather && afloat.voyage) s = applyStorm(s, afloat, season, captain.id);
    const stillAfloat = s.ships.find(x => x.id === ship.id)!;
    if (piracy && stillAfloat.voyage) s = applyPiracy(s, stillAfloat, captain.id);
  }
  return s;
}

/** Weather on a ship at sea. Costs time and nothing else — never a ship, never a cargo. */
function applyStorm(state: GameState, ship: Ship, season: ReturnType<typeof seasonOf>, captainId: string): GameState {
  const outcome = resolveStorm(state.rngSeed, ship, season);
  let s: GameState = { ...state, rngSeed: outcome.seed };
  if (outcome.setback <= 0 || !ship.voyage) return s;

  s = replaceShip(s, {
    ...ship,
    voyage: { ...ship.voyage, legRemaining: ship.voyage.legRemaining + outcome.setback },
  });
  // Whatever was left of this turn's wind goes with it.
  s = { ...s, sailPoints: { ...s.sailPoints, [ship.id]: 0 } };
  return log(
    s,
    'storm',
    `${ship.name} is caught by heavy weather and driven back ${outcome.setback} points.${
      ship.fittings?.copper ? ' Her copper saved her the worst of it.' : ''
    }`,
    captainId,
    { shipId: ship.id, setback: outcome.setback },
  );
}

/** Pirates on a ship at sea, in waters that carry a rating. Ransom is the common outcome. */
function applyPiracy(state: GameState, ship: Ship, captainId: string): GameState {
  const captain = state.captains.find(c => c.id === captainId)!;
  const outcome = resolvePiracy(state.rngSeed, ship, captain.cash);
  let s: GameState = { ...state, rngSeed: outcome.seed };
  if (outcome.kind === 'none') return s;

  const covered = ship.insured ? indemnityFor(outcome, ship) : 0;

  if (outcome.kind === 'ransom') {
    s = updateCaptain(s, captainId, { cash: captain.cash - outcome.amount + covered });
    s = log(
      s,
      'piracy',
      `${ship.name} is boarded and ransomed for ${money(outcome.amount)}.${
        ship.fittings?.guns ? ' Her guns bought her off cheaply.' : ''
      }`,
      captainId,
      { shipId: ship.id, ransom: outcome.amount },
    );
  } else {
    // Pirates take the whole hold. With three slots that finally hurts, which is the point.
    const lost = ship.hold;
    s = replaceShip(s, { ...ship, hold: [] });
    if (covered > 0) s = updateCaptain(s, captainId, { cash: captain.cash + covered });
    s = log(
      s,
      'piracy',
      `${ship.name} is taken and stripped — ${
        lost.length ? lost.map(l => goodName(l.good)).join(', ') : 'her cargo'
      } gone.`,
      captainId,
      { shipId: ship.id, seized: lost.reduce((n, l) => n + l.paid, 0), units: lost.length },
    );
  }

  if (covered > 0) {
    s = log(
      s,
      'insurance',
      `The underwriters make ${money(covered)} good on ${ship.name}'s policy.`,
      captainId,
      { shipId: ship.id, indemnity: covered },
    );
  }
  return s;
}

function doSailTo(
  state: GameState,
  shipId: string,
  destination: string,
  via?: string[],
): GameState {
  const ship = ownShip(state, shipId);
  if (!ship) return state;

  // At sea: she may only be re-ordered to one end of the leg she is on.
  if (ship.location === null) {
    const turned = reorderAtSea(ship, destination);
    if (!turned) return state;
    const captain = activeCaptain(state);
    const putAbout = destination === ship.voyage!.legFrom;
    const s = replaceShip(state, turned);
    return log(
      s,
      'sail',
      putAbout
        ? `${ship.name} puts about and runs back for ${portName(destination)}.`
        : `${ship.name} is re-ordered to hold at ${portName(destination)}.`,
      captain.id,
      { shipId: ship.id, reordered: destination },
    );
  }

  if (ship.location === destination) return state;

  // No explicit path: plan the one a captain would actually want — fastest for the season when
  // there is weather to reckon with, shortest when there is not.
  let path = via;
  if (!path && state.hazards?.weather) {
    path = planFastestRoute(
      ship.location,
      destination,
      seasonOf(state.round),
      ship.fittings?.copper,
    )?.path;
  }

  const plotted = plotCourse(ship, destination, path);
  if (!plotted) return state;

  const captain = activeCaptain(state);
  const points = state.sailPoints[ship.id] ?? 0;

  // A standing policy is charged per voyage, at cast-off, priced from this course's real risk and
  // the cargo actually aboard.
  //
  // If the premium cannot be met the **cover lapses** and she sails uninsured, told plainly. The
  // first version refused the voyage instead, reasoning that sailing uninsured while believing
  // yourself covered is worse — true, but it imprisons the ship. The harness found a captain with a
  // winning six shares, two lots of opium aboard, orders for Shanghai and £1 in hand: every cast-off
  // was rejected for an unpaid premium, so she never sailed, never sold the cargo, never reached the
  // £750, and could not be raided. Four hundred rounds tied up at Bombay. An unpayable bill must
  // never be able to hold a ship alongside, and a lapsed policy is what really happens.
  let s: GameState = state;
  let hull = plotted;
  if (ship.insured && state.hazards?.piracy) {
    const risk = routeRisk(ship.location, plotted.voyage!.route, seasonOf(state.round));
    const premium = insurancePremium(ship.hold.reduce((n, l) => n + l.paid, 0), risk);
    // A light passage costs nothing and is covered for nothing, so there is no bill to write about.
    if (premium <= 0) {
      // fall through: no charge, no entry, and the policy simply does not bite this voyage.
    } else if (captain.cash < premium) {
      hull = { ...plotted, insured: false };
      s = log(
        s,
        'insurance',
        `${ship.name}'s policy lapses — the ${money(premium)} premium could not be met. She sails uncovered.`,
        captain.id,
        { shipId: ship.id, premium, lapsed: 1 },
      );
    } else {
      s = updateCaptain(s, captain.id, { cash: captain.cash - premium });
      s = log(
        s,
        'insurance',
        `${ship.name}'s policy is endorsed for the passage — premium ${money(premium)}.`,
        captain.id,
        { shipId: ship.id, premium, risk: Math.round(risk * 100) },
      );
    }
  }

  const outcome = sail(hull, points);
  s = replaceShip(s, outcome.ship);
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
  if (!ship || ship.location === null) return state;
  if (ship.hold.length >= slotsOf(ship.shipClass)) return state;
  if (!portSupplies(ship.location, good)) return state;
  // A struck port loads nothing and an embargoed good loads nowhere. Cargo already aboard is
  // untouched by both — only lading is stopped, so nobody is ever left holding an unlandable hold.
  if (portStruck(state, ship.location)) return state;
  if (goodEmbargoed(state, good)) return state;

  const captain = activeCaptain(state);
  // The quay's price, not the card's — see sim/pricing.ts for why those are different numbers.
  const price = priceAt(ship.location, good);
  if (price <= 0 || captain.cash < price) return state;

  const standing = priceStanding(ship.location, good);
  let s = updateCaptain(state, captain.id, { cash: captain.cash - price });
  s = replaceShip(s, {
    ...ship,
    hold: [...ship.hold, { good, paid: price, boughtAt: ship.location, boughtOnTurn: s.turn }],
  });
  return log(
    s,
    'buy',
    `${ship.name} loads ${goodName(good)} at ${portName(ship.location)} for ${money(price)}${
      standing === 'level' ? '' : standing === 'cheap' ? ' — under the reckoning' : ' — over the reckoning'
    } — ${ship.hold.length + 1} of ${slotsOf(ship.shipClass)} slots full.`,
    captain.id,
  );
}

function doDeliver(state: GameState, shipId: string, contractId: string): GameState {
  const ship = ownShip(state, shipId);
  if (!ship || ship.location === null || ship.hold.length === 0) return state;

  const contract = state.contracts.find(c => c.id === contractId);
  if (!contract) return state;
  if (contract.destination !== ship.location) return state;
  if (portStruck(state, ship.location)) return state;

  // Every matching slot goes ashore at once, and is paid per unit. This is the source's own
  // "fill all three slots with identical goods to maximise a single delivery payout".
  const landed = ship.hold.filter(lot => lot.good === contract.good);
  if (landed.length === 0) return state;

  const rank = nextRank(contract);
  if (rank === null) return state;

  const captain = activeCaptain(state);
  // Priced through the event table, so a glut, a shortage or an Admiralty bounty is felt here and
  // the AI can score a plan with the identical call.
  //
  // Reckoned on the **card's** price per unit, never on what the captain happened to pay for it.
  // Paying from `lot.paid` would mean the cheapest quay earned the least, so the correct play would
  // be to always buy at the dearest one — see sim/pricing.ts.
  const plain = landed.length * contract.price * PAYOUT_MULTIPLIERS[rank];
  // Each lot is paid on its own freshness, so a hull used as a warehouse earns less than one used
  // as a ship. Per lot rather than per delivery: three lots loaded at different times have
  // genuinely different ages.
  const spoils = state.hazards?.deadlines ?? false;
  const payout = landed.reduce((sum, lot) => {
    const full = landedValue(state, lot.good, contract.price, PAYOUT_MULTIPLIERS[rank]);
    return sum + (spoils ? Math.round(full * freshness(state.turn - lot.boughtOnTurn)) : full);
  }, 0);
  const fill: ContractFill = { captainId: captain.id, rank, paid: payout, onTurn: state.turn };

  let s = updateCaptain(state, captain.id, { cash: captain.cash + payout });
  s = replaceShip(s, { ...ship, hold: ship.hold.filter(lot => lot.good !== contract.good) });
  s = {
    ...s,
    contracts: s.contracts.map(c => (c.id === contract.id ? { ...c, fills: [...c.fills, fill] } : c)),
  };
  s = log(
    s,
    'deliver',
    `${ship.name} lands ${landed.length} of ${goodName(contract.good)} at ${portName(
      contract.destination,
    )} — ${rank === 1 ? 'first home' : 'second home'}, ${PAYOUT_MULTIPLIERS[rank]}x, ${money(payout)}.`,
    captain.id,
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
      /** Profit after what the quays actually charged — the number the sourcing decision moves. */
      margin: payout - landed.reduce((sum, lot) => sum + lot.paid, 0),
      cardPrice: contract.price,
    },
  );
  return replenishContracts(s);
}

/**
 * Over the side, recovering nothing. The source is explicit that dumping forfeits the whole purchase
 * price to the bank — which is what gives the "speculation bottleneck" teeth. An earlier authored
 * rule gave half back at a port that wanted the goods, and made guessing wrong almost free.
 */
/**
 * Sell a lot off the ship at the quay she lies at.
 *
 * The published rule is that cargo you cannot place goes over the side and the whole purchase is
 * forfeit, and `doJettison` still does exactly that. This is the toggleable mercy: you take a real
 * loss rather than a total one, and where you take it matters, because a port that deals in the good
 * pays nearly twice what one that does not will offer.
 */
function doSellCargo(state: GameState, shipId: string, good: string): GameState {
  if (!state.hazards?.quaysideSales) return state;
  const ship = ownShip(state, shipId);
  if (!ship || ship.location === null || ship.hold.length === 0) return state;
  // A shut port buys nothing, for the same reason it lades nothing.
  if (portStruck(state, ship.location)) return state;

  const sold = ship.hold.filter(l => l.good === good);
  if (sold.length === 0) return state;
  const kept = ship.hold.filter(l => l.good !== good);

  const captain = activeCaptain(state);
  const unit = quaysidePrice(ship.location, good);
  const takings = unit * sold.length;
  const paid = sold.reduce((sum, l) => sum + l.paid, 0);

  let s = updateCaptain(state, captain.id, { cash: captain.cash + takings });
  s = replaceShip(s, { ...ship, hold: kept });
  return log(
    s,
    'missed',
    `${ship.name} sells ${sold.length} ${goodName(good)} on the quay at ${portName(
      ship.location,
    )} for ${money(takings)} — ${money(paid - takings)} down on what she paid.`,
    captain.id,
    { shipId: ship.id, units: sold.length, takings, recovered: takings, forfeited: paid - takings },
  );
}

function doJettison(state: GameState, shipId: string, good?: string): GameState {
  const ship = ownShip(state, shipId);
  if (!ship || ship.hold.length === 0) return state;

  const dumped = good ? ship.hold.filter(l => l.good === good) : ship.hold;
  if (dumped.length === 0) return state;
  const kept = good ? ship.hold.filter(l => l.good !== good) : [];

  const captain = activeCaptain(state);
  const lost = dumped.reduce((sum, l) => sum + l.paid, 0);
  const s = replaceShip(state, { ...ship, hold: kept });
  return log(
    s,
    'missed',
    `${ship.name} puts ${dumped.length} ${
      good ? goodName(good) : 'lot' + (dumped.length === 1 ? '' : 's')
    } over the side — ${money(lost)} lost outright, ${slotsOf(ship.shipClass) - kept.length} slot${
      slotsOf(ship.shipClass) - kept.length === 1 ? '' : 's'
    } clear.`,
    captain.id,
    { shipId: ship.id, units: dumped.length, forfeited: lost },
  );
}

function doBuyShip(state: GameState, requested?: ShipClassId): GameState {
  if (state.phase !== 'act') return state;
  const captain = activeCaptain(state);
  const owned = shipsOf(state, captain.id);
  if (owned.length >= MAX_SHIPS) return state;

  // With classes off there is only ever the clipper, whatever was asked for — so a UI that offers
  // the choice cannot smuggle a barque into a faithful game.
  const classes = state.hazards?.shipClasses ?? false;
  const chosen = classes ? (requested ?? DEFAULT_SHIP_CLASS) : DEFAULT_SHIP_CLASS;
  const hull = SHIP_CLASSES[chosen];
  if (!hull) return state;
  if (captain.cash < hull.price) return state;

  const ship: Ship = {
    id: `s${state.nextShipSeq}`,
    ownerId: captain.id,
    name: SHIP_NAMES[(state.nextShipSeq - 1) % SHIP_NAMES.length],
    // She is bought from the yard at home and fits out there, wherever her owner happens to be.
    location: HOME_PORT,
    voyage: null,
    hold: [],
    ...(classes ? { shipClass: chosen } : {}),
    ...(hull.fittings ? { fittings: { ...hull.fittings } } : {}),
  };

  let s: GameState = {
    ...state,
    ships: [...state.ships, ship],
    nextShipSeq: state.nextShipSeq + 1,
  };
  s = updateCaptain(s, captain.id, { cash: captain.cash - hull.price });
  return log(
    s,
    'ship',
    `${captain.name} buys ${ship.name}, ${classes ? `a ${hull.name.toLowerCase()}, ` : ''}for ${money(
      hull.price,
    )} — ${hull.slots} slots${hull.fittings?.guns ? ', guns aboard' : ''}. She fits out at ${portName(
      HOME_PORT,
    )}.`,
    captain.id,
  );
}

function doBuyShare(state: GameState): GameState {
  if (state.phase !== 'act') return state;
  const captain = activeCaptain(state);

  if (state.sharesRemaining > 0) {
    const price = sharePriceFor(state.sharesRemaining);
    if (captain.cash < price) return state;
    let s: GameState = { ...state, sharesRemaining: state.sharesRemaining - 1 };
    s = updateCaptain(s, captain.id, { cash: captain.cash - price, shares: captain.shares + 1 });
    return log(
      s,
      'share',
      `${captain.name} takes up a share for ${money(price)} — ${captain.shares + 1} held, ${
        s.sharesRemaining
      } left with the bank at ${money(sharePriceFor(s.sharesRemaining))}.`,
      captain.id,
      { price, held: captain.shares + 1, remaining: s.sharesRemaining },
    );
  }

  // Bank empty: a forced buy-out. Normally only of a captain holding no more than you — but during
  // the countdown that restriction lifts entirely, which is the source's sabotage window.
  const sabotage = state.declaration !== null;
  const seller = state.captains
    .filter(c => c.id !== captain.id && c.shares > 0 && canBuyOut(captain.shares, c.shares, sabotage))
    // In the sabotage window you go for the leader; otherwise you absorb the smallest partner.
    .sort((a, b) =>
      sabotage
        ? b.shares - a.shares || state.captains.indexOf(a) - state.captains.indexOf(b)
        : a.shares - b.shares || state.captains.indexOf(a) - state.captains.indexOf(b),
    )[0];
  if (!seller) return state;

  const price = sharePriceFor(0) * SHARE_RAID_MULTIPLIER;
  if (captain.cash < price) return state;

  let s = updateCaptain(state, captain.id, {
    cash: captain.cash - price,
    shares: captain.shares + 1,
  });
  s = updateCaptain(s, seller.id, { cash: seller.cash + price, shares: seller.shares - 1 });
  return log(
    s,
    'share',
    sabotage
      ? `${captain.name} buys a share out from under ${seller.name} for ${money(price)} — ${
          captain.shares + 1
        } against ${seller.shares - 1}.`
      : `${captain.name} buys a share off ${seller.name} on the exchange for ${money(price)} — ${
          captain.shares + 1
        } against ${seller.shares - 1}.`,
    captain.id,
  );
}

/**
 * Buy a share off a named captain at a premium, whatever your own holding.
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

  const buyer = activeCaptain(state);
  if (targetId === buyer.id) return state;
  const seller = state.captains.find(c => c.id === targetId);
  if (!seller) return state;

  const made = state.hostileBids ?? 0;
  if (!canHostileBid(buyer.shares, buyer.cash, seller.shares, made)) return state;

  const price = hostileBidPrice(made, buyer.shares);
  const proceeds = hostileBidProceeds(price);

  let s: GameState = { ...state, hostileBids: made + 1 };
  s = updateCaptain(s, buyer.id, { cash: buyer.cash - price, shares: buyer.shares + 1 });
  s = updateCaptain(s, seller.id, { cash: seller.cash + proceeds, shares: seller.shares - 1 });

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
  const captain = activeCaptain(state);
  if (captain.shares <= 0) return state;

  const proceeds = shareBuybackFor(state.sharesRemaining);
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

function doBuyFitting(state: GameState, shipId: string, fitting: 'guns' | 'copper'): GameState {
  const ship = ownShip(state, shipId);
  // Fitted out in port, like anything else done to a ship.
  if (!ship || ship.location === null) return state;
  if (ship.fittings?.[fitting]) return state;

  const captain = activeCaptain(state);
  const price = FITTING_PRICES[fitting];
  if (captain.cash < price) return state;

  let s = updateCaptain(state, captain.id, { cash: captain.cash - price });
  s = replaceShip(s, { ...ship, fittings: { ...ship.fittings, [fitting]: true } });
  return log(
    s,
    'fitting',
    fitting === 'guns'
      ? `${ship.name} is armed at ${portName(ship.location)} for ${money(price)}.`
      : `${ship.name} is coppered at ${portName(ship.location)} for ${money(price)} — a point faster, and easier on heavy weather.`,
    captain.id,
    { shipId: ship.id, fitting, price },
  );
}

function doSetInsurance(state: GameState, shipId: string, insured: boolean): GameState {
  const ship = ownShip(state, shipId);
  if (!ship) return state;
  if ((ship.insured ?? false) === insured) return state;

  const captain = activeCaptain(state);
  const s = replaceShip(state, { ...ship, insured });
  return log(
    s,
    'insurance',
    insured
      ? `${ship.name} is entered on an open policy — every voyage covered, premium taken at cast-off.`
      : `${ship.name}'s policy is closed. She sails at her owner's risk.`,
    captain.id,
    { shipId: ship.id },
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
      turnsRemaining: DECLARATION_TURNS,
    },
  };
  return log(
    s,
    'declare',
    `${captain.name} declares a majority — ${captain.shares} of the ten. The company is wound up in ${DECLARATION_TURNS} turns; ${money(
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
      return doSailTo(state, action.shipId, action.destination, action.via);
    case 'BUY_CARGO':
      return doBuyCargo(state, action.shipId, action.good);
    case 'DELIVER':
      return doDeliver(state, action.shipId, action.contractId);
    case 'SELL_CARGO':
      return doSellCargo(state, action.shipId, action.good);
    case 'JETTISON':
      return doJettison(state, action.shipId, action.good);
    case 'BUY_SHIP':
      return doBuyShip(state, action.shipClass);
    case 'BUY_FITTING':
      return doBuyFitting(state, action.shipId, action.fitting as 'guns' | 'copper');
    case 'SET_INSURANCE':
      return doSetInsurance(state, action.shipId, action.insured);
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
      // Rolling is not optional — ending a turn without it would silently skip the wind.
      return state.phase === 'act' ? endTurn(state) : state;
    default:
      return state;
  }
}
