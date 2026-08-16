// Type-only import: erased at compile time, so this does not make a runtime cycle with types.ts
// (which refers to ShipClassId here the same way). rules.ts otherwise stays a leaf module.
import type { ShipFittings } from './types';
/**
 * Every tunable number in one place.
 *
 * Public sources describe the 1988 board's skeleton but not its full rulebook. Constants marked
 * AUTHORED fill a documented gap and are my own ruling, not the original game's — tea-race-design.md
 * lists them all so a later session can tell faithful from invented. Constants marked FAITHFUL come
 * straight from the published description of the game.
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
 * This was originally read as full rounds, and that reading was wrong twice over. At a four-captain
 * table it made the endgame forty-eight turns long — the harness showed the first declaration
 * landing around round 66-107 and then twelve more rounds in which everyone already knew the
 * answer. And in ordinary board-game usage "twelve turns" means twelve player turns anyway, so the
 * shorter reading is also the more faithful one.
 *
 * Consequence worth knowing: the countdown now scales with the size of the table — three rounds at
 * four captains, six at two. That follows from taking "turns" literally, and twelve turns of play is
 * twelve turns of play however many people are at the table.
 */
export const DECLARATION_TURNS = 12;

/** FAITHFUL — the cash bar at the end of the countdown. */
export const VICTORY_CASH = 750;

/** FAITHFUL — a captain may own up to three ships (the starting one plus two). */
export const MAX_SHIPS = 3;

/** FAITHFUL — every ship has exactly three cargo slots, so a full fleet carries nine. */
export const HOLD_SLOTS = 3;

/**
 * FAITHFUL — dumping cargo recovers nothing at all. "Dumping forfeits the entire original purchase
 * price to the bank, returning exactly £0."
 *
 * This replaces an earlier authored half-price sale, which was far too gentle: at half back,
 * speculating badly cost a captain almost nothing, and the source's "speculation bottleneck" — the
 * risk that guessing wrong locks up your hull — had no teeth.
 */
export const JETTISON_RECOVERS = 0;

/** FAITHFUL — the source gives a range of £500 to £1,000 depending on variant. */
export const STARTING_CASH = 600;

/** AUTHORED — price of an additional clipper. */
export const SHIP_PRICE = 250;

/**
 * FAITHFUL — the share price **scales as the pool empties**. The source: "As the pool diminishes,
 * the remaining shares become progressively more expensive, preventing a wealthy player from buying
 * a victory in a single turn."
 *
 * This replaces a flat £120, which was measurably wrong: across 20 seeds the bank sold out by round
 * 37-63 of a ~155-round game, so the entire share market closed in the first third and any captain
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
 * AUTHORED — the way back in for a captain who has fallen behind on shares.
 *
 * The problem it solves, in the owner's words: "if you fall behind the others in shares, there is
 * nothing you can do to win?" Very nearly yes. `canBuyOut` below requires the buyer to already hold
 * at least as many shares as the seller, and nobody holds fewer than zero — so once the bank is
 * empty a captain on nothing is locked out permanently. Measured across 20 seeds: two captains
 * finished the bank-emptying round holding nothing, and **neither ever won**. One of them, in the
 * `levanter` game, ended on £27,623 — the richest on the board and unable to make a single move on
 * the share market.
 *
 * So: **any captain may buy a share from any holder, including the leader, at a steep premium.**
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
 * buy-out's proof (see `canBuyOut`) does not cover this move — a bid from a captain holding fewer
 * shares than the seller *lowers* the sum of squares, which is exactly the oscillation that once
 * produced a 10,850-transaction game.
 *
 * What replaces it: **every bid doubles the price for everyone after it**, for the rest of the game.
 * One sentence a player can hold in their head, and a hard bound. Note it compounds with the
 * buyer's-holding term above, so a captain who bids and thereby gains a share sees their own next
 * bid go up fourfold, not twofold — £180 then £720. The UI quotes the real figure rather than the
 * rule of thumb. The cheapest possible bid — a captain
 * holding nothing — is £180, then £360, £720, £1,440, £2,880, £5,760, £11,520, £23,040. The richest
 * captain the harness has ever produced finished on £27,623. Measured across 20 seeds it settles at
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
 * so it is won by whoever has the most money, and the captain who led at round 30 usually leads
 * because they have been trading well, so they are also the richest. A/B over 20 identical seeds:
 * the flat version tripled the number of lead changes after round 30 (16 to 49, so the endgame did
 * get genuinely turbulent) but pushed the round-30 leader's conversion rate *up*, 50% to 65%. An
 * expensive comeback mechanic favours the rich, and the rich are usually the leader. Exactly
 * backwards.
 *
 * Charging on the buyer's own holding fixes that at the root. A captain with nothing pays a first
 * share cheaply — that is the way back in the whole move exists to provide — while the captain
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

/** Of that price, what actually reaches the captain whose share is taken. */
export const hostileBidProceeds = (price: number): number =>
  Math.round(price * (1 - HOSTILE_BID_BROKERAGE));

/**
 * AUTHORED — may `buyer` bid for one of `seller`'s shares?
 *
 * Deliberately permissive about holdings — that is the entire point of the move — and restrictive
 * about everything else. A captain already holding a majority is barred: they do not need it, they
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
 * whichever OTHER captain holds the FEWEST shares — a forced buy-out of the smallest stake.
 *
 * Both halves of that rule are doing work, and both were arrived at by measurement.
 *
 * That shares can change hands at all is necessary: ten shares split 3/3/2/2 with the bank empty
 * means no captain can ever reach a majority, nobody can declare, and the game has no ending.
 * Published descriptions of the 1988 board do not say how shares move between players, but a rule
 * of this shape must exist, because the same deadlock would sink the physical game. The harness
 * reproduced it exactly: five games, none finished, every captain rich, all ten shares out, no
 * majority anywhere.
 *
 * That the seller is the SMALLEST holder is half of what makes it converge. The obvious rule — buy
 * from the largest holder, to break up a rival's block — cannot terminate: A raids B to reach six,
 * B raids A straight back down to five, forever, and the harness duly produced games that declared
 * and lapsed 32 times without settling.
 *
 * The other half is the restriction in `canBuyOut` below, and it is the part that is actually
 * provable. Targeting the smallest holder alone is NOT enough: it concentrates the holding within
 * one captain's turn, but the next captain simply strips it back, and the harness caught exactly
 * that — the same shares rotating round the table 10,850 times in one game, nobody ever settling
 * on six, because a forced sale moves money between players and so nothing is ever spent down.
 *
 * Double price keeps it a real decision rather than a reflex, and hands the money to the captain
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
 * Take the sum of the squares of every captain's holding. Moving one share from a captain with `s`
 * to a captain with `b >= s` changes that sum by `2(b - s) + 2`, which is always positive. So every
 * forced sale strictly increases it, and it is bounded above by 100 (one captain holding all ten).
 * The whole game therefore admits only a bounded number of forced sales, and each one concentrates
 * the holding further, so a majority is always reached.
 *
 * Drop the `>=` and that argument collapses: 0-for-1 and 1-for-0 swaps leave the sum unchanged and
 * can repeat forever, which is precisely the 10,850-transaction game the harness produced.
 *
 * The cost to a trailing captain is real and deliberate: hold no shares and you cannot force your
 * way in, only buy from the bank. Every captain gets the same chance at the bank's ten in the
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
 * AUTHORED — a card is only dealt if its source and destination are within this many sail points.
 * Without it the deck contains genuinely undeliverable runs (Hamburg timber to Yokohama is the
 * width of the chart, seven turns of sailing for a £75 profit) that would just sit face-up, dead,
 * occupying one of only five slots. At 24 the median run is about two turns and every good still
 * appears somewhere in the deck — 18 would drop guano out of the game entirely.
 */
export const CONTRACT_MAX_DISTANCE = 24;

/** AUTHORED — the wind roll. Averages 7, so a 14-point leg is about two turns of hard sailing. */
export const DICE_PER_SHIP = 2;
export const DIE_FACES = 6;

/**
 * AUTHORED — what the bank pays to take a share back, as a fraction of the price band.
 *
 * This is the game's only escape hatch, and it exists because the harness found a real softlock: a
 * captain who spends down to £10 buying shares cannot afford the cheapest lot on any quay (£20),
 * so she has no way to earn, no way to sell, and simply sails in circles for the rest of the game.
 * The harness watched exactly that happen — a captain sat on a winning majority of six shares and
 * £10 for 370 rounds, unable to raise the cash the win also requires, while nobody else could
 * reach a majority either. Selling a share back at half price always converts a holding into
 * working capital, so any captain with an asset can always trade again.
 *
 * Half is deliberately a bad price. It should hurt to need it.
 */
export const SHARE_BUYBACK_FRACTION = 0.5;

// ---------------------------------------------------------------------------
// Weather, wind and piracy
//
// All AUTHORED — the 1988 rules say nothing about any of it. But authored *in the spirit of* the
// source rather than bolted on top: without directional wind every captain races round the world in
// the same direction, because raw distance is the only thing telling one route from another. The
// real tea races turned on the outbound and homeward passages being different problems, and on the
// fast way round in one season being the slow way in another.
// ---------------------------------------------------------------------------

/** Rounds per season. Four seasons, so a year is 24 rounds. */
export const ROUNDS_PER_SEASON = 6;

/**
 * Wind modifiers in sail points, against a 2d6 roll averaging 7.
 *
 * Sized to change decisions, not to be a polite nudge. A ±1 modifier is a tax nobody reroutes for;
 * at these magnitudes a foul beat costs enough that the longer way round with a fair wind is
 * genuinely the faster passage, which is the whole point. The harness asserts that some port pairs
 * really do route differently in summer than in winter — if that ever stops being true, these
 * numbers have gone too timid.
 *
 * **Every directional band's two directions must sum to zero.** The wind's job is to redistribute
 * speed around the chart, not to remove it: a net-negative field simply makes the whole fleet
 * slower and stretches the game, which is measurable and was measured. The first pass came out at
 * -0.41 points distance-weighted — a 5.8% fleet-wide slowdown — because the horse latitudes and the
 * doldrums were -2 in *both* directions while nothing anywhere was +2 in both. Those two bands
 * genuinely have no fair side, so they keep a penalty, but a small one. Check this with the mean
 * modifier, not by eye.
 */
export const WIND = {
  /** Dead downwind in the trades, a settled monsoon, or the Forties. */
  fair: 3,
  /** Its exact opposite, close-hauled. Paired with `fair` so those bands net to zero. */
  foul: -3,
  /** A useful slant — the northern westerlies behind you. */
  favourable: 2,
  /** Beating into the westerlies. Paired with `favourable`. */
  contrary: -2,
  /** The light airs of a turning monsoon, either way. */
  light: 1,
  lightFoul: -1,
  /** Nothing doing in either direction. */
  slack: 0,
  /** Beating into the Forties the wrong way. Paired with `fair` plus the same seasonal term. */
  hard: -3,
  /** Bands with no fair side at all. Kept small deliberately — see the note below. */
  doldrums: -1,
  fitful: -1,
} as const;

/** AUTHORED — chance a ship at sea is caught by weather, per point of the leg's storm rating. */
export const STORM_CHANCE_PER_RATING = 0.055;

/** AUTHORED — sail points a storm sets a ship back, before copper. Never past her leg's start. */
export const STORM_SETBACK = { min: 2, max: 4 } as const;

/** AUTHORED — copper cuts a storm's setback by this fraction, and adds a point of speed always. */
export const COPPER_STORM_REDUCTION = 0.5;
export const COPPER_SPEED_BONUS = 1;

/** AUTHORED — chance of a piracy encounter per point of a leg's piracy rating. */
export const PIRACY_CHANCE_PER_RATING = 0.06;

/** AUTHORED — guns cut the chance of an encounter, and downgrade most seizures to a ransom. */
export const GUNS_ENCOUNTER_REDUCTION = 0.5;
export const GUNS_SEIZURE_TO_RANSOM = 0.75;

/**
 * AUTHORED — of encounters that happen, this fraction are a ransom and the rest a seizure.
 * Ransom-first on purpose: taking the cargo off a captain who was winning the race is the harshest
 * thing this game can do, so it should be the uncommon case.
 */
export const PIRACY_RANSOM_SHARE = 0.72;

/** AUTHORED — a ransom takes this share of the captain's cash, within these bounds. */
export const RANSOM_CASH_SHARE = 0.11;
export const RANSOM_BOUNDS = { min: 12, max: 140 } as const;

/** AUTHORED — permanent per-ship fittings, bought while docked. */
export const FITTING_PRICES = { guns: 120, copper: 150 } as const;

/**
 * AUTHORED — an open **cargo** policy. Set once on a ship and every laden voyage she makes is
 * covered: it indemnifies goods taken and ransoms paid, and never lost time.
 *
 * These numbers were recalibrated after measuring what the policy actually returned, and the first
 * set were badly wrong. Over 20 full games captains paid 4,507 premiums totalling £29,715 and
 * claimed £8,343 back — **28p in the pound**. Not a decision with a downside, just a tax the AI
 * paid every game without noticing.
 *
 * Two causes. The premium was charged at *every* cast-off including an empty hull, so most of those
 * 4,507 charges insured nothing at all — the minimum premium applied to a ship with no cargo aboard.
 * And the base rate was set by eye rather than against the measured hazard: piracy fires on about
 * 2.75% of voyages for an average loss near £87, so the fair price of a laden passage is nearer 2%
 * of the cargo than 6%.
 *
 * It is now priced as a real policy should be: **nothing to insure means nothing to pay and nothing
 * covered**, and what you do pay scales with the cargo aboard and the route's own piracy rating, so
 * covering the Malacca run is worth it and covering an Atlantic hop is not. That is the decision the
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
 * a piratical one, while the chance of claiming climbs faster still, so the policy is a good buy
 * precisely where the danger is and a poor one everywhere else.
 */
export const INSURANCE_BASE_RATE = 0.008;
export const INSURANCE_RISK_LOADING = 3.5;
export const INSURANCE_MINIMUM_PREMIUM = 1;

// ---------------------------------------------------------------------------
// Standing costs
// ---------------------------------------------------------------------------

/**
 * AUTHORED — crew wages and victualling, charged every round against every ship afloat.
 *
 * The purpose is to stop cash being a score and make it a constraint. Without a standing cost, money
 * only ever goes up: a captain with four ships has strictly more capacity than one with two and
 * pays nothing for it, so buying hulls is a free good and the £750 victory bar is a formality by the
 * time anyone has a majority. With wages running, a fleet has to earn its keep, a bad season of
 * storms genuinely hurts, and the declaration money has to be *held* rather than merely reached.
 *
 * Charged per ship rather than per crew member, and a laden ship costs more than a light one —
 * cargo needs working. The rate is per round, not per turn, so a four-captain table and a
 * two-captain table cost the same to run.
 *
 * The rate is small and that is the whole finding. The first attempt used £26 a ship, sized by eye
 * against what felt like a plausible wage bill, and it destroyed the game: **4 of 20 seeds finished
 * at all**, captains ended on an average of £42, and the table spent 38,525 turns in arrears,
 * because nobody could ever hold the £750 a declaration needs. A captain earns on the order of £50 a
 * round; a bill anywhere near that is not pressure, it is an ending.
 *
 * Swept against the harness: £4 gives a 110-round median, £5 gives 126, £6 gives 150 but stalls one
 * seed at the round cap, £8 stalls two, £12 stalls nine. £5 with £2 a laden slot is the most that
 * still finishes every seed — a 50% longer game than the 84-round baseline, with average final cash
 * down from £2,048 to £1,150 and captains genuinely in arrears about a twentieth of the time.
 */
export const WAGES_PER_SHIP = 5;
/** Extra per occupied cargo slot — a full hull is more work than an empty one. */
export const WAGES_PER_LADEN_SLOT = 2;

/**
 * What a captain owes at the turn of the round.
 *
 * A captain who cannot pay does not go bankrupt — there is no bankruptcy in this game and inventing
 * one would need a whole resolution path — they simply pay what they have and fall into arrears,
 * which is tracked and settled later. See `doWages`.
 */
export function wagesFor(shipCount: number, ladenSlots: number): number {
  return shipCount * WAGES_PER_SHIP + ladenSlots * WAGES_PER_LADEN_SLOT;
}

/**
 * AUTHORED — borrowing against the fleet.
 *
 * The other half of making cash a constraint: once it can run out, being able to raise it becomes a
 * real decision. Interest accrues per round on the outstanding principal, and the ceiling is tied to
 * what the captain could actually be pursued for — ships and shares — so it scales with success
 * rather than handing a struggling captain unlimited rope.
 */
export const LOAN_INTEREST_PER_ROUND = 0.025;
/** The rate as it should be written for a reader: "2.5%", never a rounded "3%". */
export const loanRateLabel = (): string =>
  `${(LOAN_INTEREST_PER_ROUND * 100).toFixed(1).replace(/\.0$/, '')}%`;
export const LOAN_STEP = 250;
/** Fraction of a captain's assets the bank will lend against. */
export const LOAN_MARGIN = 0.6;

/**
 * The most the bank will advance, measured against what it could actually pursue.
 *
 * Takes counts rather than a GameState so it can live here in the rules, where both the reducer and
 * the AI can reach it — `ai.ts` cannot import from `actions.ts` without a cycle.
 *
 * Tied to ships and shares rather than to cash, so the ceiling scales with a captain's standing
 * instead of handing whoever is most desperate the most rope.
 */
export function loanCeilingFor(shipCount: number, shares: number): number {
  // No ship, no credit: there is nothing to lend against and nothing to pursue.
  if (shipCount <= 0) return 0;
  const collateral = shipCount * SHIP_PRICE + shares * sharePriceFor(0);
  const geared = Math.floor((collateral * LOAN_MARGIN) / LOAN_STEP) * LOAN_STEP;
  // A going concern can always raise one step, whatever the arithmetic says. Without this the
  // captain the facility exists for cannot use it: one ship and no shares is £250 of collateral,
  // which at 60% is £150 and rounds down to a ceiling of nothing. The captain in trouble is exactly
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
 * by choosing the number carefully. A captain who can see a card will lapse before she reaches it
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
 * should not be as good as a hull used as a ship. The grace period is generous — a normal run is
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
// Ship classes
// ---------------------------------------------------------------------------

/**
 * AUTHORED — three hulls to choose between, rather than one hull repeated.
 *
 * The 1988 ship is a clipper with three slots and nothing to decide about her. That is fine as a
 * board game and thin as a fleet: buying a second ship is buying more of the same. Classes make the
 * composition of a fleet a position rather than a number — a fast two-slot hull is a different
 * instrument from a slow four-slot one, and knowing which you want depends on whether you are
 * racing for first money or hauling volume for second.
 *
 * Each is a real trade with no dominant option:
 *
 *  - the **clipper** is the 1988 ship, and stays the default and the baseline;
 *  - the **barque** carries a third again but is slower every leg, so she is a poor racer and a good
 *    freighter — she wants cards where second money is still worth having;
 *  - the **Indiaman** comes armed, which is the guns fitting bought into the hull, and is dearer for
 *    it. She earns her keep only where pirates are switched on, which is deliberate: with piracy off
 *    she is simply a worse clipper and the choice collapses to two, as it should.
 *
 * Speed is expressed as a modifier on sail points rather than a separate stat, so it composes with
 * wind, copper and everything else already acting on a passage.
 */
export interface ShipClass {
  id: ShipClassId;
  name: string;
  blurb: string;
  slots: number;
  /** Added to every roll. Negative for the heavy hulls. */
  speed: number;
  price: number;
  /** Fittings she is built with. */
  fittings?: ShipFittings;
}

export type ShipClassId = 'clipper' | 'barque' | 'indiaman';

export const SHIP_CLASSES: Record<ShipClassId, ShipClass> = {
  clipper: {
    id: 'clipper',
    name: 'Clipper',
    blurb: 'The tea ship. Three slots and nothing to slow her.',
    slots: 3,
    speed: 0,
    price: SHIP_PRICE,
  },
  barque: {
    id: 'barque',
    name: 'Barque',
    blurb: 'Four slots and heavy with it — a freighter, not a racer.',
    slots: 4,
    speed: -2,
    price: Math.round(SHIP_PRICE * 1.3),
  },
  indiaman: {
    id: 'indiaman',
    name: 'Indiaman',
    blurb: 'Three slots, built with her guns, and a shade slow for the weight of them.',
    slots: 3,
    speed: -1,
    /**
     * Priced *below* a clipper plus guns bought separately, which is the only thing that makes her
     * worth having. The first pass had her at 1.6x a clipper — £400 against £250 — for £120 of guns
     * and a speed penalty on top, so she was strictly worse than buying a clipper and arming it, in
     * every game, whatever the toggles. The harness caught it as a dominance check.
     *
     * At £300 she is £70 cheaper than the armed clipper she is equivalent to, and pays for that with
     * a point off every roll. With piracy switched off she is simply a worse clipper and the choice
     * collapses to two hulls — which is correct, not a flaw.
     */
    price: SHIP_PRICE + 50,
    fittings: { guns: true },
  },
};

export const DEFAULT_SHIP_CLASS: ShipClassId = 'clipper';

/** How many slots this ship has. Absent class means the 1988 clipper, so old saves are unchanged. */
export const slotsOf = (shipClass: ShipClassId | undefined): number =>
  SHIP_CLASSES[shipClass ?? DEFAULT_SHIP_CLASS].slots;

/** Her speed modifier, applied to every roll. */
export const speedOf = (shipClass: ShipClassId | undefined): number =>
  SHIP_CLASSES[shipClass ?? DEFAULT_SHIP_CLASS].speed;

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

/**
 * How well the computer captains play.
 *
 * The owner's report was that the AI wins about 95% of the time. At a four-captain table a human
 * playing level should take roughly one game in four, so that is not a difficulty curve, it is a
 * wall — and it is unsurprising: every system added over the last two sessions was wired into the
 * AI at the same time it was wired into the rules, so the computer captains have never once been
 * behind on knowing how to use one.
 *
 * The handicaps are all **knowledge and discipline**, never dice. A cheating AI that rolls better is
 * obvious within two turns and feels like a swindle; an AI that does not bother to check whether a
 * rival is closer to a card, or that ignores the wind chart, is simply a worse captain, and losing
 * to it later is a fair loss.
 */
export type Difficulty = 'gentle' | 'steady' | 'hard';

export interface DifficultyProfile {
  label: string;
  blurb: string;
  /** Does she notice that a rival is already closer to the card she is chasing? */
  seesRivals: boolean;
  /** Does she plan around the season's wind, or just take the shortest line? */
  usesWind: boolean;
  /** Will she bid at the exchange to claw her way back into the share market? */
  usesHostileBids: boolean;
  /** Does she trade the shipping exchange? */
  usesStocks: boolean;
  /** Does she fit guns and copper, and insure? */
  fitsOut: boolean;
  /**
   * Multiplier on how long she will sit on cargo nobody wants. Above 1 means she clogs her own hold,
   * which is the single most costly ordinary mistake in this game.
   */
  patienceScale: number;
  /**
   * Multiplier on the cash she insists on keeping back before buying a share. Above 1 means she
   * under-invests in the only thing that actually wins.
   *
   * This is the lever that makes the dial mean anything, and it was missing from the first pass.
   * Handicapping *sailing* — rivals, wind, fittings — barely moved the outcome: a strong captain beat
   * three gentle ones 57% of the time and three hard ones 45%, a spread of twelve points against a
   * seat-order advantage worth twenty. Sailing badly costs turns; not buying shares costs the game.
   */
  shareCaution: number;
  /**
   * Does she keep buying hulls she cannot afford to run?
   *
   * The classic beginner mistake once wages are on, and a useful one: a fourth ship looks like more
   * capacity and is actually a standing bill against the cash she needs for shares.
   */
  overbuysHulls: boolean;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyProfile> = {
  gentle: {
    label: 'Gentle',
    blurb:
      'Competent, but she does not watch her rivals, ignores the wind chart, never fits out and never bids for shares.',
    seesRivals: false,
    usesWind: false,
    usesHostileBids: false,
    usesStocks: false,
    fitsOut: false,
    patienceScale: 4,
    shareCaution: 6,
    overbuysHulls: true,
  },
  steady: {
    label: 'Steady',
    blurb: 'She watches her rivals and sails the wind, but leaves the sharper instruments alone.',
    seesRivals: true,
    usesWind: true,
    usesHostileBids: false,
    usesStocks: true,
    fitsOut: true,
    patienceScale: 1.3,
    shareCaution: 1.6,
    overbuysHulls: false,
  },
  hard: {
    label: 'Hard',
    blurb: 'Everything she has: rivals, wind, fittings, the exchange, and a bid for your shares.',
    seesRivals: true,
    usesWind: true,
    usesHostileBids: true,
    usesStocks: true,
    fitsOut: true,
    patienceScale: 1,
    shareCaution: 1,
    overbuysHulls: false,
  },
};

export const DEFAULT_DIFFICULTY: Difficulty = 'steady';

export const difficultyProfile = (d: Difficulty | undefined): DifficultyProfile =>
  DIFFICULTIES[d ?? DEFAULT_DIFFICULTY];

/** AUTHORED — how many entries of the running log to keep. Older lines are dropped from the save. */
export const LOG_LIMIT = 400;

/**
 * The two ways to play, and everything each one turns on.
 *
 * "1988 Board" is the published game and nothing else — no weather, no pirates, no fittings. It
 * exists so the faithful version is always one click away, which is the whole reason every added
 * rule has been kept behind a switch rather than baked in.
 */
export const PRESETS = {
  board: {
    label: 'The 1988 board',
    blurb: 'The published game exactly: dice, five cards, ten shares, nothing else.',
    hazards: {
      weather: false,
      piracy: false,
      events: false,
      hostileBids: false,
      quaysideSales: false,
      wages: false,
      loans: false,
      deadlines: false,
      shipClasses: false,
      stocks: false,
    },
  },
  full: {
    label: 'Full game',
    blurb:
      'Everything on — seasonal wind, storms, pirates, guns, copper, insurance, the world event ' +
      'deck, and hostile bids for the shares.',
    hazards: {
      weather: true,
      piracy: true,
      events: true,
      hostileBids: true,
      quaysideSales: true,
      wages: true,
      loans: true,
      deadlines: true,
      shipClasses: true,
      stocks: true,
    },
  },
} as const;

export type PresetName = keyof typeof PRESETS;

/** AUTHORED — bounds on the lobby's captain roster. The board itself is 2-6 players. */
export const MIN_CAPTAINS = 2;
export const MAX_CAPTAINS = 6;

/** Colours for the captain markers, assigned in seat order. */
export const CAPTAIN_COLOURS = [
  '#d9a05b', // brass
  '#6fa8a0', // verdigris
  '#c2606a', // ensign red
  '#8d94c4', // signal blue
  '#a8b06a', // olive
  '#c08fb4', // heather
];

export const CAPTAIN_NAMES = [
  'Ariel',
  'Thermopylae',
  'Serica',
  'Taeping',
  'Fiery Cross',
  'Sir Lancelot',
];

/** Ship names are drawn from this list in order, per captain. */
export const SHIP_NAMES = [
  'Cutty Sark',
  'Lightning',
  'Flying Cloud',
  'Spindrift',
  'Titania',
  'Kaisow',
  'Wild Deer',
  'Norman Court',
  'Halloween',
  'Blackadder',
  'Leander',
  'Undine',
  'Osaka',
  'Windhover',
  'Coulnakyle',
  'Maitland',
  'Deerfoot',
  'Ellen Rodger',
];
