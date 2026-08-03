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

/** FAITHFUL — declaring runs the game on for twelve more turns. Read here as full table rounds. */
export const DECLARATION_ROUNDS = 12;

/** FAITHFUL — the cash bar at the end of the countdown. */
export const VICTORY_CASH = 750;

/** FAITHFUL — a captain may own up to three ships (the starting one plus two). */
export const MAX_SHIPS = 3;

/** AUTHORED — starting cash. Enough for two mid-value lots, not enough for a share. */
export const STARTING_CASH = 250;

/** AUTHORED — price of an additional clipper. */
export const SHIP_PRICE = 250;

/** AUTHORED — price of one share from the bank. Six of them plus the cash bar is ~£1470 to raise. */
export const SHARE_PRICE = 120;

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
export const canBuyOut = (buyerShares: number, sellerShares: number): boolean =>
  buyerShares >= sellerShares;

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
 * AUTHORED — what the bank pays to take a share back, as a fraction of its issue price.
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

/** AUTHORED — how many entries of the running log to keep. Older lines are dropped from the save. */
export const LOG_LIMIT = 400;

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
