// Type-only import: erased at compile time, so this does not make a runtime cycle with types.ts
// (which refers to VehicleClassId here the same way). rules.ts otherwise stays a leaf module.
import type { VehicleFittings } from './types';
/**
 * Every tunable number in one place.
 *
 * Steady Eddie is a fork of The Tea Race's engine (see steady-eddie-design.md), not an adaptation of
 * a published board game, so the FAITHFUL/AUTHORED split below is repurposed rather than dropped:
 * constants marked FAITHFUL carry over The Tea Race's own tuned value unchanged (that game measured
 * them against its harness, sometimes across several sessions, and there is no reason to re-tune a
 * number the road theme doesn't touch). Constants marked AUTHORED are new or changed specifically
 * for the road — a vehicle class, a wage rate, a fitting — and are this fork's own ruling.
 */

/** FAITHFUL — five commodity cards are face-up at all times. */
export const FACE_UP_CONTRACTS = 5;

/** FAITHFUL — only the first two deliveries on a card are paid. */
export const PAYOUT_MULTIPLIERS: Record<1 | 2, number> = { 1: 4, 2: 2 };

/** FAITHFUL — ten shares exist. */
export const TOTAL_SHARES = 10;

/** FAITHFUL — a majority of the ten. */
export const SHARE_MAJORITY = 6;

/**
 * FAITHFUL — declaring runs the game on for twelve more turns, counted as twelve **individual
 * turns**, not twelve complete table rounds.
 *
 * This was originally read as full rounds, and that reading was wrong twice over. At a four-haulier
 * table it made the endgame forty-eight turns long — the harness showed the first declaration
 * landing around round 66-107 and then twelve more rounds in which everyone already knew the
 * answer. And in ordinary board-game usage "twelve turns" means twelve player turns anyway, so the
 * shorter reading is also the more faithful one.
 *
 * Consequence worth knowing: the countdown now scales with the size of the table — three rounds at
 * four hauliers, six at two. That follows from taking "turns" literally, and twelve turns of play is
 * twelve turns of play however many people are at the table.
 */
export const DECLARATION_TURNS = 12;

/** FAITHFUL — the cash bar at the end of the countdown. */
export const VICTORY_CASH = 750;

/** FAITHFUL — a haulier may own up to three vehicles (the starting one plus two). */
export const MAX_VEHICLES = 3;

/**
 * FAITHFUL — dumping cargo recovers nothing at all. "Dumping forfeits the entire original purchase
 * price to the bank, returning exactly £0."
 *
 * This replaces an earlier authored half-price sale, which was far too gentle: at half back,
 * speculating badly cost a haulier almost nothing, and the source's "speculation bottleneck" — the
 * risk that guessing wrong locks up your hull — had no teeth.
 */
export const DUMP_RECOVERS = 0;

/** FAITHFUL — the source gives a range of £500 to £1,000 depending on variant. */
export const STARTING_CASH = 600;

/** AUTHORED — price of an additional vehicle. */
export const VEHICLE_PRICE = 250;

/**
 * FAITHFUL — the share price **scales as the pool empties**. The source: "As the pool diminishes,
 * the remaining shares become progressively more expensive, preventing a wealthy player from buying
 * a victory in a single turn."
 *
 * This replaces a flat £120, which was measurably wrong: across 20 seeds the bank sold out by round
 * 37-63 of a ~155-round game, so the entire share market closed in the first third and any haulier
 * who had not bought in was locked out for the rest of the game. Six shares cost £720 — four or five
 * good deliveries.
 *
 * On this ladder the first share is cheap and the last is dear, so six now cost about £1,600 and
 * have to be earned across the whole game rather than banked early.
 */
export const SHARE_BASE_PRICE = 90;
export const SHARE_SCARCITY_STEP = 45;

/** What the bank charges for the next share, given how many it still holds. */
export function sharePriceFor(sharesRemaining: number): number {
  const sold = TOTAL_SHARES - Math.max(0, Math.min(TOTAL_SHARES, sharesRemaining));
  return SHARE_BASE_PRICE + sold * SHARE_SCARCITY_STEP;
}

/** What the bank pays to take one back, at the price band it would next sell at. */
export const shareBuybackFor = (sharesRemaining: number): number =>
  Math.floor(sharePriceFor(Math.min(TOTAL_SHARES - 1, sharesRemaining)) * SHARE_BUYBACK_FRACTION);


// ---------------------------------------------------------------------------
// The hostile bid
// ---------------------------------------------------------------------------

/**
 * AUTHORED — the way back in for a haulier who has fallen behind on shares.
 *
 * The problem it solves, in the owner's words: "if you fall behind the others in shares, there is
 * nothing you can do to win?" Very nearly yes. `canBuyOut` below requires the buyer to already hold
 * at least as many shares as the seller, and nobody holds fewer than zero — so once the bank is
 * empty a haulier on nothing is locked out permanently. Measured across 20 seeds: two hauliers
 * finished the bank-emptying round holding nothing, and **neither ever won**. One of them, in the
 * `levanter` game, ended on £27,623 — the richest on the board and unable to make a single move on
 * the share market.
 *
 * So: **any haulier may buy a share from any holder, including the leader, at a steep premium.**
 * No shareholding requirement. In a trading game the answer to falling behind should be to get rich
 * and buy your way in.
 *
 * The price escalates permanently and globally with every bid anyone makes, and that is not
 * flavour — it is what keeps the game finishing. See `hostileBidPrice`.
 */
export const HOSTILE_BID_PREMIUM = 2;

/**
 * How much dearer each successive bid is than the last, across the whole table.
 *
 * This is the termination argument, and it has to be stated carefully because the ordinary
 * buy-out's proof (see `canBuyOut`) does not cover this move — a bid from a haulier holding fewer
 * shares than the seller *lowers* the sum of squares, which is exactly the oscillation that once
 * produced a 10,850-transaction game.
 *
 * What replaces it: **every bid doubles the price for everyone after it**, for the rest of the game.
 * One sentence a player can hold in their head, and a hard bound. Note it compounds with the
 * buyer's-holding term above, so a haulier who bids and thereby gains a share sees their own next
 * bid go up fourfold, not twofold — £180 then £720. The UI quotes the real figure rather than the
 * rule of thumb. The cheapest possible bid — a haulier
 * holding nothing — is £180, then £360, £720, £1,440, £2,880, £5,760, £11,520, £23,040. The richest
 * haulier the harness has ever produced finished on £27,623. Measured across 20 seeds it settles at
 * about five bids a game.
 *
 * The rate was chosen by measurement, not taste. At 1.6x the endgame churned harder but games ran
 * 19% longer (median 99 rounds against an 83 baseline); at 2x the round-30 leader's conversion rate
 * is lowest *and* the median is back to 89 with a tighter worst case. 1.8x was worse than both,
 * which is a useful reminder that at 20 seeds these numbers carry about +/-10 points of noise —
 * 2x was taken because it wins on all three axes at once, not on any single one.
 *
 * The full argument: sum-of-squares is non-decreasing on every ordinary buy-out and can only fall on
 * a hostile bid; hostile bids are bounded by an exponentially rising price against a bounded purse;
 * therefore total transactions are bounded and the game still terminates. Bounded, not proven at
 * 100 — which is why the harness asserts the bid count stays small rather than trusting the algebra.
 */
export const HOSTILE_BID_ESCALATION = 2;

/**
 * The slice of a hostile bid that does **not** reach the seller — brokerage, stamp and the
 * exchange's cut.
 *
 * Money leaving the game matters mechanically, not just thematically. The original forced buy-out
 * moves cash from buyer to seller, so the table's total purse is unchanged and nothing is ever spent
 * down — which is half of why that rule needed a combinatorial invariant to terminate at all. A bid
 * that destroys some of its own price makes each one genuinely costly in absolute terms.
 */
export const HOSTILE_BID_BROKERAGE = 0.3;

/**
 * What the next hostile bid costs: **dearer the more the buyer already holds**, and dearer again
 * with every bid anyone has made.
 *
 * The buyer's-holding term is the part that took measurement to get right, and the first version
 * did not have it. Priced flat, a hostile bid is simply a machine for turning money into shares —
 * so it is won by whoever has the most money, and the haulier who led at round 30 usually leads
 * because they have been trading well, so they are also the richest. A/B over 20 identical seeds:
 * the flat version tripled the number of lead changes after round 30 (16 to 49, so the endgame did
 * get genuinely turbulent) but pushed the round-30 leader's conversion rate *up*, 50% to 65%. An
 * expensive comeback mechanic favours the rich, and the rich are usually the leader. Exactly
 * backwards.
 *
 * Charging on the buyer's own holding fixes that at the root. A haulier with nothing pays a first
 * share cheaply — that is the way back in the whole move exists to provide — while the haulier
 * going from five to a winning six pays the most anyone pays. It is also the idiom this game
 * already speaks: `sharePriceFor` charges the bank's shares on exactly this shape.
 *
 * The ladder is twice the bank's step, so a hostile bid is never the cheap option when the bank
 * still has stock.
 */
export function hostileBidPrice(bidsAlreadyMade: number, buyerShares: number): number {
  const ladder = SHARE_BASE_PRICE + Math.max(0, buyerShares) * SHARE_SCARCITY_STEP * 2;
  return Math.round(
    ladder * HOSTILE_BID_PREMIUM * Math.pow(HOSTILE_BID_ESCALATION, Math.max(0, bidsAlreadyMade)),
  );
}

/** Of that price, what actually reaches the haulier whose share is taken. */
export const hostileBidProceeds = (price: number): number =>
  Math.round(price * (1 - HOSTILE_BID_BROKERAGE));

/**
 * AUTHORED — may `buyer` bid for one of `seller`'s shares?
 *
 * Deliberately permissive about holdings — that is the entire point of the move — and restrictive
 * about everything else. A haulier already holding a majority is barred: they do not need it, they
 * have a declaration to make instead, and letting the leader hoover up the board with it would turn
 * a comeback mechanic into a runaway one.
 */
export const canHostileBid = (
  buyerShares: number,
  buyerCash: number,
  sellerShares: number,
  bidsAlreadyMade: number,
): boolean =>
  sellerShares > 0 &&
  buyerShares < SHARE_MAJORITY &&
  buyerCash >= hostileBidPrice(bidsAlreadyMade, buyerShares);

/**
 * AUTHORED, and load-bearing: what a share costs once the bank has none left. The seller is
 * whichever OTHER haulier holds the FEWEST shares — a forced buy-out of the smallest stake.
 *
 * Both halves of that rule are doing work, and both were arrived at by measurement.
 *
 * That shares can change hands at all is necessary: ten shares split 3/3/2/2 with the bank empty
 * means no haulier can ever reach a majority, nobody can declare, and the game has no ending.
 * Published descriptions of the 1988 board do not say how shares move between players, but a rule
 * of this shape must exist, because the same deadlock would sink the physical game. The harness
 * reproduced it exactly: five games, none finished, every haulier rich, all ten shares out, no
 * majority anywhere.
 *
 * That the seller is the SMALLEST holder is half of what makes it converge. The obvious rule — buy
 * from the largest holder, to break up a rival's block — cannot terminate: A raids B to reach six,
 * B raids A straight back down to five, forever, and the harness duly produced games that declared
 * and lapsed 32 times without settling.
 *
 * The other half is the restriction in `canBuyOut` below, and it is the part that is actually
 * provable. Targeting the smallest holder alone is NOT enough: it concentrates the holding within
 * one haulier's turn, but the next haulier simply strips it back, and the harness caught exactly
 * that — the same shares rotating round the table 10,850 times in one game, nobody ever settling
 * on six, because a forced sale moves money between players and so nothing is ever spent down.
 *
 * Double price keeps it a real decision rather than a reflex, and hands the money to the haulier
 * being bought out. Price is not what makes this terminate, and trying to make it terminate by
 * raising the price was a dead end — the money goes to another player either way.
 */
export const SHARE_RAID_MULTIPLIER = 2;

/**
 * AUTHORED — may `buyer` force `seller` to give up a share? Only if the buyer already holds at
 * least as many as the seller: you absorb a smaller partner, you do not muscle into a company you
 * have no stake in.
 *
 * This is the rule that makes the endgame provably finish, and the reasoning is worth keeping.
 * Take the sum of the squares of every haulier's holding. Moving one share from a haulier with `s`
 * to a haulier with `b >= s` changes that sum by `2(b - s) + 2`, which is always positive. So every
 * forced sale strictly increases it, and it is bounded above by 100 (one haulier holding all ten).
 * The whole game therefore admits only a bounded number of forced sales, and each one concentrates
 * the holding further, so a majority is always reached.
 *
 * Drop the `>=` and that argument collapses: 0-for-1 and 1-for-0 swaps leave the sum unchanged and
 * can repeat forever, which is precisely the 10,850-transaction game the harness produced.
 *
 * The cost to a trailing haulier is real and deliberate: hold no shares and you cannot force your
 * way in, only buy from the bank. Every haulier gets the same chance at the bank's ten in the
 * opening rounds, so declining to take one is a decision, not an accident.
 */
export const canBuyOut = (
  buyerShares: number,
  sellerShares: number,
  /**
   * FAITHFUL — during the twelve-turn countdown the restriction lifts entirely. The source calls
   * this the sabotage window and states its purpose outright: "Opponents use this window to buy
   * shares away from the leader." Termination is not at risk, because the countdown itself is
   * bounded — twelve turns and the game is over either way.
   */
  sabotageWindow = false,
): boolean => sabotageWindow || buyerShares >= sellerShares;

/**
 * AUTHORED — a card is only dealt if its source and destination are within this many drive points.
 * Without it the deck contains genuinely undeliverable runs (Hamburg timber to Yokohama is the
 * width of the chart, seven turns of driving for a £75 profit) that would just sit face-up, dead,
 * occupying one of only five slots. At 24 the median run is about two turns and every good still
 * appears somewhere in the deck — 18 would drop guano out of the game entirely.
 */
export const CONTRACT_MAX_DISTANCE = 24;

/** AUTHORED — the daily roll. Averages 7, so a 14-point leg is about two turns of hard driving. */
export const DICE_PER_VEHICLE = 2;
export const DIE_FACES = 6;

/**
 * AUTHORED — what the bank pays to take a share back, as a fraction of the price band.
 *
 * This is the game's only escape hatch, and it exists because the harness found a real softlock: a
 * haulier who spends down to £10 buying shares cannot afford the cheapest lot on any depot (£20),
 * so she has no way to earn, no way to sell, and simply drives in circles for the rest of the game.
 * The harness watched exactly that happen — a haulier sat on a winning majority of six shares and
 * £10 for 370 rounds, unable to raise the cash the win also requires, while nobody else could
 * reach a majority either. Selling a share back at half price always converts a holding into
 * working capital, so any haulier with an asset can always trade again.
 *
 * Half is deliberately a bad price. It should hurt to need it.
 */
export const SHARE_BUYBACK_FRACTION = 0.5;

// ---------------------------------------------------------------------------
// Weather and theft
//
// All AUTHORED for the road. The Tea Race derived a directional wind from real geography — every
// haulier there raced in a genuinely different direction depending on the season. That system has
// no UK equivalent (a road has no prevailing wind), so it is not carried over: see the header of
// weather.ts for the replacement, an authored per-leg weatherRisk scaled by season instead.
// ---------------------------------------------------------------------------

/** Rounds per season. Four seasons, so a year is 24 rounds. */
export const ROUNDS_PER_SEASON = 6;

/** AUTHORED — chance a vehicle on the road is caught by weather, per point of the leg's delay rating. */
export const DELAY_CHANCE_PER_RATING = 0.055;

/** AUTHORED — drive points a delay sets a vehicle back, before aeroKit. Never past her leg's start. */
export const DELAY_SETBACK = { min: 2, max: 4 } as const;

/** AUTHORED — aeroKit cuts a delay's setback by this fraction, and adds a point of speed always. */
export const AEROKIT_DELAY_REDUCTION = 0.5;
export const AEROKIT_SPEED_BONUS = 1;

/** AUTHORED — chance of a theft encounter per point of a leg's theft rating. */
export const THEFT_CHANCE_PER_RATING = 0.06;

/** AUTHORED — tracker cut the chance of an encounter, and downgrade most seizures to a ransom. */
export const TRACKER_ENCOUNTER_REDUCTION = 0.5;
export const TRACKER_LOSS_TO_RECOVERY = 0.75;

/**
 * AUTHORED — of encounters that happen, this fraction are a ransom and the rest a seizure.
 * Ransom-first on purpose: taking the cargo off a haulier who was winning the race is the harshest
 * thing this game can do, so it should be the uncommon case.
 */
export const THEFT_RECOVERY_SHARE = 0.72;

/** AUTHORED — a ransom takes this share of the haulier's cash, within these bounds. */
export const RECOVERY_COST_SHARE = 0.11;
export const RECOVERY_COST_BOUNDS = { min: 12, max: 140 } as const;

/** AUTHORED — permanent per-vehicle fittings, bought while parked. */
export const FITTING_PRICES = { tracker: 120, aeroKit: 150 } as const;

/**
 * AUTHORED — an open **cargo** policy. Set once on a vehicle and every laden run she makes is
 * covered: it indemnifies goods taken and ransoms paid, and never lost time.
 *
 * These numbers were recalibrated after measuring what the policy actually returned, and the first
 * set were badly wrong. Over 20 full games hauliers paid 4,507 premiums totalling £29,715 and
 * claimed £8,343 back — **28p in the pound**. Not a decision with a downside, just a tax the AI
 * paid every game without noticing.
 *
 * Two causes. The premium was charged at *every* dispatch including an empty vehicle, so most of those
 * 4,507 charges insured nothing at all — the minimum premium applied to a vehicle with no cargo aboard.
 * And the base rate was set by eye rather than against the measured hazard: theft fires on about
 * 2.75% of runs for an average loss near £87, so the fair price of a laden passage is nearer 2%
 * of the cargo than 6%.
 *
 * It is now priced as a real policy should be: **nothing to insure means nothing to pay and nothing
 * covered**, and what you do pay scales with the cargo aboard and the route's own theft rating, so
 * covering a theft-prone corridor is worth it and covering a quiet motorway hop is not. That is the decision the
 * mechanic was supposed to offer.
 *
 * Calibrated against the harness rather than by eye: swept across rates, a policy now returns
 * 0.90 / 0.74 / 0.67 in the pound at 0.008 / 0.010 / 0.012, and 0.28 at the rate it shipped with.
 * The claim count over 20 games is only about thirty, so these carry real noise — the point is the
 * order of magnitude, not the second digit. 0.008 is taken as roughly fair. Deliberately a shade under fair — the underwriters take
 * their margin, and the reason to buy is not the expected return but the variance. A seizure takes
 * the whole hold, and three lots gone can end a game; paying a little over the odds to not lose that
 * way is exactly what insurance is for.
 *
 * The risk loading matters more than the rate. It spreads the premium 4.5x between a calm route and
 * a theft-prone one, while the chance of claiming climbs faster still, so the policy is a good buy
 * precisely where the danger is and a poor one everywhere else.
 */
export const INSURANCE_BASE_RATE = 0.008;
export const INSURANCE_RISK_LOADING = 3.5;
export const INSURANCE_MINIMUM_PREMIUM = 1;

// ---------------------------------------------------------------------------
// Standing costs
// ---------------------------------------------------------------------------

/**
 * AUTHORED — crew wages and victualling, charged every round against every vehicle running.
 *
 * The purpose is to stop cash being a score and make it a constraint. Without a standing cost, money
 * only ever goes up: a haulier with four vehicles has strictly more capacity than one with two and
 * pays nothing for it, so buying hulls is a free good and the £750 victory bar is a formality by the
 * time anyone has a majority. With wages running, a fleet has to earn its keep, a bad season of
 * storms genuinely hurts, and the declaration money has to be *held* rather than merely reached.
 *
 * Charged per vehicle rather than per crew member, and a laden vehicle costs more than a light one —
 * cargo needs working. The rate is per round, not per turn, so a four-haulier table and a
 * two-haulier table cost the same to run.
 *
 * The rate is small and that is the whole finding. The first attempt used £26 a vehicle, sized by eye
 * against what felt like a plausible wage bill, and it destroyed the game: **4 of 20 seeds finished
 * at all**, hauliers ended on an average of £42, and the table spent 38,525 turns in arrears,
 * because nobody could ever hold the £750 a declaration needs. A haulier earns on the order of £50 a
 * round; a bill anywhere near that is not pressure, it is an ending.
 *
 * Swept against the harness: £4 gives a 110-round median, £5 gives 126, £6 gives 150 but stalls one
 * seed at the round cap, £8 stalls two, £12 stalls nine. £5 with £2 a laden slot is the most that
 * still finishes every seed — a 50% longer game than the 84-round baseline, with average final cash
 * down from £2,048 to £1,150 and hauliers genuinely in arrears about a twentieth of the time.
 */
export const WAGES_PER_VEHICLE = 5;
/** Extra per occupied cargo slot — a full hull is more work than an empty one. */
export const WAGES_PER_LADEN_SLOT = 2;

/**
 * What a haulier owes at the turn of the round.
 *
 * A haulier who cannot pay does not go bankrupt — there is no bankruptcy in this game and inventing
 * one would need a whole resolution path — they simply pay what they have and fall into arrears,
 * which is tracked and settled later. See `doWages`.
 */
export function wagesFor(vehicleCount: number, ladenSlots: number): number {
  return vehicleCount * WAGES_PER_VEHICLE + ladenSlots * WAGES_PER_LADEN_SLOT;
}

/**
 * AUTHORED — borrowing against the fleet.
 *
 * The other half of making cash a constraint: once it can run out, being able to raise it becomes a
 * real decision. Interest accrues per round on the outstanding principal, and the ceiling is tied to
 * what the haulier could actually be pursued for — vehicles and shares — so it scales with success
 * rather than handing a struggling haulier unlimited rope.
 */
export const LOAN_INTEREST_PER_ROUND = 0.025;
/** The rate as it should be written for a reader: "2.5%", never a rounded "3%". */
export const loanRateLabel = (): string =>
  `${(LOAN_INTEREST_PER_ROUND * 100).toFixed(1).replace(/\.0$/, '')}%`;
export const LOAN_STEP = 250;
/** Fraction of a haulier's assets the bank will lend against. */
export const LOAN_MARGIN = 0.6;

/**
 * The most the bank will advance, measured against what it could actually pursue.
 *
 * Takes counts rather than a GameState so it can live here in the rules, where both the reducer and
 * the AI can reach it — `ai.ts` cannot import from `actions.ts` without a cycle.
 *
 * Tied to vehicles and shares rather than to cash, so the ceiling scales with a haulier's standing
 * instead of handing whoever is most desperate the most rope.
 */
export function loanCeilingFor(vehicleCount: number, shares: number): number {
  // No vehicle, no credit: there is nothing to lend against and nothing to pursue.
  if (vehicleCount <= 0) return 0;
  const collateral = vehicleCount * VEHICLE_PRICE + shares * sharePriceFor(0);
  const geared = Math.floor((collateral * LOAN_MARGIN) / LOAN_STEP) * LOAN_STEP;
  // A going concern can always raise one step, whatever the arithmetic says. Without this the
  // haulier the facility exists for cannot use it: one vehicle and no shares is £250 of collateral,
  // which at 60% is £150 and rounds down to a ceiling of nothing. The haulier in trouble is exactly
  // the one with a single hull left.
  return Math.max(LOAN_STEP, geared);
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/**
 * AUTHORED — how many rounds a commission stays on the board before it is withdrawn and replaced.
 *
 * Without a clock the five face-up cards are a standing menu: you can plan a leisurely optimum,
 * take the best run twice, and nothing you fail to do costs you anything. A deadline turns the board
 * over, forces a choice between the run in front of you and the better one you might reach, and
 * means a rival taking first money genuinely closes a door rather than merely halving it.
 *
 * Counter-intuitively this makes games **shorter**, not longer, and the length has to be bought back
 * by choosing the number carefully. A haulier who can see a card will lapse before she reaches it
 * simply picks a nearer run, so throughput per round goes up: at an 18-round life the median fell
 * from 126 rounds to 97. At 24 it is 112 with about one card a game withdrawn unfilled, and at 30 it
 * is 115 with the deadline barely biting. 24 keeps most of the length the wage bill bought while
 * leaving the clock on every card real enough to steer by.
 */
export const CONTRACT_LIFE_ROUNDS = 24;

/**
 * AUTHORED — cargo loses value in the hold.
 *
 * This is a tea race. Tea landed a season late is not the same tea, and a hull used as a warehouse
 * should not be as good as a hull used as a vehicle. The grace period is generous — a normal run is
 * well inside it — so this bites only on cargo that has been carried around unsold, which is exactly
 * the behaviour it is meant to discourage.
 */
export const CARGO_FRESH_TURNS = 24;
export const CARGO_SPOIL_PER_TURN = 0.02;
/** However long it sits, a lot never becomes completely worthless. */
export const CARGO_SPOIL_FLOOR = 0.55;

/** What a lot is worth on landing, as a fraction, given how long it has been aboard. */
export function freshness(turnsHeld: number): number {
  const over = Math.max(0, turnsHeld - CARGO_FRESH_TURNS);
  return Math.max(CARGO_SPOIL_FLOOR, 1 - over * CARGO_SPOIL_PER_TURN);
}

// ---------------------------------------------------------------------------
// Vehicle classes
// ---------------------------------------------------------------------------

/**
 * AUTHORED — three vehicle classes to choose between, rather than one repeated. Carried over from
 * The Tea Race's own three-hull idea (clipper/barque/indiaman) and re-cast in UK haulage terms, load
 * bed slots 2/2/3 rather than that game's 3/4/3 — a deliberately smaller spread for a smaller map.
 *
 * The default 7.5-tonner carries two slots and nothing to slow her. That is thin as a fleet on its
 * own: buying a second vehicle would just be buying more of the same. Classes make the composition
 * of a fleet a position rather than a number — a fast two-slot rig is a different instrument from a
 * slow three-slot one, and knowing which you want depends on whether you are racing for first money
 * or hauling volume for second.
 *
 * Each is a real trade with no dominant option:
 *
 *  - the **7.5-tonner** is the default and the baseline;
 *  - the **18-tonne rigid** is no roomier, but a point faster on every roll, for a real premium —
 *    the "pay for pace" option;
 *  - the **44-tonne artic** carries a third slot more than either, but is markedly the slowest off
 *    the line and the dearest to buy — a poor racer and a good freighter, wanting cards where second
 *    money is still worth having.
 *
 * Speed is expressed as a modifier on drive points rather than a separate stat, so it composes with
 * weather, aeroKit and everything else already acting on a passage.
 */
export interface VehicleClass {
  id: VehicleClassId;
  name: string;
  blurb: string;
  slots: number;
  /** Added to every roll. Negative for the heavy rigs. */
  speed: number;
  price: number;
  /** Fittings she is built with. */
  fittings?: VehicleFittings;
}

export type VehicleClassId = 'rigid_7_5' | 'rigid_18' | 'artic_44';

export const VEHICLE_CLASSES: Record<VehicleClassId, VehicleClass> = {
  rigid_7_5: {
    id: 'rigid_7_5',
    name: '7.5-Tonner',
    blurb: 'The everyday rig. Two slots and nothing to slow her.',
    slots: 2,
    speed: 0,
    price: VEHICLE_PRICE,
  },
  rigid_18: {
    id: 'rigid_18',
    name: '18-Tonne Rigid',
    blurb: 'No roomier than the 7.5-tonner, but a point faster on every roll.',
    slots: 2,
    speed: 1,
    price: Math.round(VEHICLE_PRICE * 1.2),
  },
  artic_44: {
    id: 'artic_44',
    name: '44-Tonne Artic',
    /**
     * Dominance check: dearer than either of the other two AND slower than either — the only thing
     * she is not worse at is capacity, which is exactly the trade she has to be bought for. Priced
     * and paced so that a third slot costs both money and time, never one for free.
     */
    blurb: 'A third slot over the rest of the fleet, and markedly the slowest off the line for it.',
    slots: 3,
    speed: -2,
    price: Math.round(VEHICLE_PRICE * 1.5),
  },
};

export const DEFAULT_VEHICLE_CLASS: VehicleClassId = 'rigid_7_5';

/** How many slots this vehicle has. Absent class means the default 7.5-tonner, so old saves are unchanged. */
export const slotsOf = (vehicleClass: VehicleClassId | undefined): number =>
  VEHICLE_CLASSES[vehicleClass ?? DEFAULT_VEHICLE_CLASS].slots;

/** Her speed modifier, applied to every roll. */
export const speedOf = (vehicleClass: VehicleClassId | undefined): number =>
  VEHICLE_CLASSES[vehicleClass ?? DEFAULT_VEHICLE_CLASS].speed;

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

/**
 * How well the computer hauliers play.
 *
 * The Tea Race's owner reported the AI winning about 95% of the time. At a four-haulier table a
 * human playing level should take roughly one game in four, so that is not a difficulty curve, it
 * is a wall — and it is unsurprising: every system gets wired into the AI at the same time it is
 * wired into the rules, so the computer hauliers are never once behind on knowing how to use one.
 *
 * The handicaps are all **knowledge and discipline**, never dice. A cheating AI that rolls better is
 * obvious within two turns and feels like a swindle; an AI that does not bother to check whether a
 * rival is closer to a card, or that ignores the weather forecast, is simply a worse haulier, and
 * losing to it later is a fair loss.
 */
export type Difficulty = 'gentle' | 'steady' | 'hard';

export interface DifficultyProfile {
  label: string;
  blurb: string;
  /** Does she notice that a rival is already closer to the card she is chasing? */
  seesRivals: boolean;
  /** Does she plan around the season's weather forecast, or just take the shortest line? */
  readsForecast: boolean;
  /** Will she bid at the exchange to claw her way back into the share market? */
  usesHostileBids: boolean;
  /** Does she trade the haulage exchange? */
  usesStocks: boolean;
  /** Does she fit tracker and aeroKit, and insure? */
  fitsOut: boolean;
  /**
   * Multiplier on how long she will sit on cargo nobody wants. Above 1 means she clogs her own load
   * bed, which is the single most costly ordinary mistake in this game.
   */
  patienceScale: number;
  /**
   * Multiplier on the cash she insists on keeping back before buying a share. Above 1 means she
   * under-invests in the only thing that actually wins.
   *
   * This is the lever that makes the dial mean anything, and it was missing from the first pass.
   * Handicapping *driving* — rivals, forecast, fittings — barely moved the outcome: a strong haulier
   * beat three gentle ones 57% of the time and three hard ones 45%, a spread of twelve points against
   * a seat-order advantage worth twenty. Driving badly costs turns; not buying shares costs the game.
   */
  shareCaution: number;
  /**
   * Does she keep buying vehicles she cannot afford to run?
   *
   * The classic beginner mistake once wages are on, and a useful one: a fourth vehicle looks like more
   * capacity and is actually a standing bill against the cash she needs for shares.
   */
  overbuysVehicles: boolean;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyProfile> = {
  gentle: {
    label: 'Gentle',
    blurb:
      'Competent, but she does not watch her rivals, ignores the forecast, never fits out and never bids for shares.',
    seesRivals: false,
    readsForecast: false,
    usesHostileBids: false,
    usesStocks: false,
    fitsOut: false,
    patienceScale: 4,
    shareCaution: 6,
    overbuysVehicles: true,
  },
  steady: {
    label: 'Steady',
    blurb: 'She watches her rivals and drives around the forecast, but leaves the sharper instruments alone.',
    seesRivals: true,
    readsForecast: true,
    usesHostileBids: false,
    usesStocks: true,
    fitsOut: true,
    patienceScale: 1.3,
    shareCaution: 1.6,
    overbuysVehicles: false,
  },
  hard: {
    label: 'Hard',
    blurb: 'Everything she has: rivals, forecast, fittings, the exchange, and a bid for your shares.',
    seesRivals: true,
    readsForecast: true,
    usesHostileBids: true,
    usesStocks: true,
    fitsOut: true,
    patienceScale: 1,
    shareCaution: 1,
    overbuysVehicles: false,
  },
};

export const DEFAULT_DIFFICULTY: Difficulty = 'steady';

export const difficultyProfile = (d: Difficulty | undefined): DifficultyProfile =>
  DIFFICULTIES[d ?? DEFAULT_DIFFICULTY];

/** AUTHORED — how many entries of the running log to keep. Older lines are dropped from the save. */
export const LOG_LIMIT = 400;

/**
 * The four ways to play, and everything each one turns on.
 *
 * There are ten independent switches now, and that count is itself a problem: nobody wants to reason
 * about ten booleans before a game, and they interact in ways only measurement finds — wages starve
 * the hostile bid because bids cost money, and deadlines shorten the games wages had lengthened.
 * These presets are the front door; the individual switches stay underneath for anyone who wants to
 * tinker. Carried over from The Tea Race's own four named presets, re-themed for the road.
 *
 * Each is a **different kind of game**, not just more or less of the same one. That is the whole
 * point of curating them rather than offering "light / medium / heavy":
 *
 *  - the core rules are the base ruleset and nothing else;
 *  - a haulier's game adds only economics, and no new randomness at all beyond the dice;
 *  - the open road adds only danger and a changing world, and leaves money simple;
 *  - the full haul is everything at once.
 *
 * Ordered easiest-to-hold-in-your-head first. The Tea Race's own measurement of this shape (median
 * length and cash genuinely differing across all four, and "everything on" running *shorter* than
 * the money-only preset because expiring commissions force turnover harder than wages slow it down)
 * carries over as a starting expectation for this fork's own harness to confirm, not as a fact
 * re-measured for the road yet.
 */
export const PRESETS = {
  core: {
    label: 'The core rules',
    blurb:
      'The base ruleset exactly: dice, five cards, ten shares, nothing else. A middling length, ' +
      'and the most money left in the counting house at the end.',
    hazards: {
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
    },
  },
  haulier: {
    label: "A haulier's game",
    blurb:
      'Money, not weather. Driver wages to pay, loans to raise, vehicle classes to choose between, ' +
      'cargo you can sell off at a loss, and an exchange to read. Nothing random but the dice, and ' +
      'the longest of the four — wages make every season count.',
    hazards: {
      weather: false,
      theft: false,
      events: false,
      hostileBids: true,
      depotSales: true,
      wages: true,
      loans: true,
      deadlines: false,
      vehicleClasses: true,
      stocks: true,
    },
  },
  openRoad: {
    label: 'The open road',
    blurb:
      'Weather, not money. A seasonal forecast, delays on the fog- and flood-prone legs, theft worth ' +
      'fitting a tracker against, a world that throws strikes and gluts at you, and commissions that ' +
      'will not wait. Quick and dangerous — the expiring cards keep everybody moving.',
    hazards: {
      weather: true,
      theft: true,
      events: true,
      hostileBids: false,
      depotSales: true,
      wages: false,
      loans: false,
      deadlines: true,
      vehicleClasses: false,
      stocks: false,
    },
  },
  full: {
    label: 'The full haul',
    blurb:
      'Everything at once, and the one with the most to go wrong. Not the longest, though — the ' +
      "expiring commissions drive it along faster than a haulier's game.",
    hazards: {
      weather: true,
      theft: true,
      events: true,
      hostileBids: true,
      depotSales: true,
      wages: true,
      loans: true,
      deadlines: true,
      vehicleClasses: true,
      stocks: true,
    },
  },
} as const;

export type PresetName = keyof typeof PRESETS;

/** AUTHORED — bounds on the lobby's haulier roster, carried over from The Tea Race's 2-6 players. */
export const MIN_HAULIERS = 2;
export const MAX_HAULIERS = 6;

/** Colours for the haulier markers, assigned in seat order. */
export const HAULIER_COLOURS = [
  '#d9a05b', // brass
  '#6fa8a0', // verdigris
  '#c2606a', // tail-light red
  '#8d94c4', // signal blue
  '#a8b06a', // hi-vis olive
  '#c08fb4', // heather
];

/**
 * Haulier names — trucking-culture nicknames rather than The Tea Race's clipper names, since a
 * haulier here is a person (or a firm's boss), not a vessel.
 */
export const HAULIER_NAMES = [
  'Steady Eddie',
  'Fast Frank',
  'Long-Haul Lou',
  'Night-Shift Nora',
  'Diesel Dave',
  'Motorway Maureen',
];

/**
 * Vehicle names are drawn from this list in order, per haulier — real UK trucking culture names its
 * wagons, the same impulse The Tea Race's clipper names came from.
 */
export const VEHICLE_NAMES = [
  'Bessie',
  'The Duchess',
  'Nightrider',
  'Silver Arrow',
  'The Wanderer',
  'Iron Lady',
  'Midnight Runner',
  'Old Faithful',
  'Yorkshire Rose',
  'Northern Star',
  'Border Reiver',
  'Fen Tiger',
  'The Warrior',
  'Highland Fling',
  'Long Vera',
  'Steel Maiden',
  'Maid Marian',
  'Copper Kate',
];
