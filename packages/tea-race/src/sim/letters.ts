/**
 * The captain's letters: offers, errands, dilemmas and rivals' wagers, delivered by post. Pure.
 *
 * Why they exist: captains barely touched one another. Everybody raced the same five cards, but
 * nothing ever passed between two particular captains, and nothing personal ever landed on anyone's
 * desk. A letter is a decision that is yours alone, at the top of your turn, and the wager is the
 * first thing in the game that sets one captain against one other by name.
 *
 * Every letter is a real trade-off, never free money: dispatches carry a bond forfeited on failure,
 * refusing shore leave costs speed, a patron's advance costs a third again, a wager can be lost.
 * The stakes rise with the years, so the post ramps up with the rest of the game.
 */
import { PORTS, distanceBetween, goodName, portName, sourcesFor } from './content';
import { next, nextInt } from './rng';
import { FITTING_PRICES } from './rules';
import { voyageYear } from './weather';
import type { Captain, GameState, Letter, LetterKind, Ship } from './types';

/** AUTHORED — the chance per turn of a letter. About one turn in six. */
export const LETTER_CHANCE = 0.16;

/** AUTHORED — the terms, in year-one money. Multiplied by `stakesFor` as the years pass. */
export const LETTER_TERMS = {
  dispatchReward: 100,
  dispatchBond: 40,
  dispatchRounds: 8,
  /** Dispatches go somewhere a ship of hers could reach in time, but not where she already lies. */
  dispatchMaxDistance: 30,
  dispatchRenown: 1,
  shoreLeave: 30,
  /** Points each ship loses on her next roll if leave is refused. */
  sullenPenalty: 3,
  shipwrightDiscount: 0.5,
  patronAdvance: 150,
  patronRepay: 200,
  patronRounds: 12,
  wagerStake: 50,
  /** Errands a captain may carry at once. */
  maxErrands: 2,
} as const;

/** AUTHORED — the stakes rise a quarter with every year, so year three's post is half again year one's. */
export const stakesFor = (round: number): number => 1 + 0.25 * (voyageYear(round) - 1);

const fives = (n: number) => Math.max(5, Math.round(n / 5) * 5);
const money = (n: number) => `£${n.toLocaleString('en-GB')}`;

export const lettersOn = (s: GameState): boolean => Boolean(s.hazards?.letters) && s.rules === 'classic';

/** Where a ship is, or will next be: her port, or the end of her course. */
const whereabouts = (ship: Ship): string | null => ship.location ?? ship.voyage?.route[ship.voyage.route.length - 1] ?? null;

/** Kinds this captain could actually be offered right now. */
function kindsFor(s: GameState, captain: Captain): LetterKind[] {
  const kinds: LetterKind[] = ['dispatch', 'shoreLeave'];
  if (shipwrightOffer(s, captain)) kinds.push('shipwright');
  if (!captain.patron) kinds.push('patron');
  if (s.captains.length > 1 && s.contracts.some(c => c.fills.length === 0)) kinds.push('wager');
  if ((captain.errands?.length ?? 0) >= LETTER_TERMS.maxErrands) return kinds.filter(k => k !== 'dispatch');
  return kinds;
}

/** A docked ship of hers a yard could fit out, and with what. */
function shipwrightOffer(s: GameState, captain: Captain): { ship: Ship; fitting: 'copper' | 'guns' } | null {
  for (const ship of s.ships) {
    if (ship.ownerId !== captain.id || !ship.location) continue;
    if (s.hazards?.weather && !ship.fittings?.copper) return { ship, fitting: 'copper' };
    if (s.hazards?.piracy && !ship.fittings?.guns) return { ship, fitting: 'guns' };
  }
  return null;
}

/**
 * Maybe a letter for the captain whose turn is starting. Returns the advanced seed either way, so
 * the stream stays in step whether or not one arrives.
 */
export function drawLetter(s: GameState, captain: Captain): { seed: number; letter: Letter | null } {
  const roll = next(s.rngSeed);
  let seed = roll.seed;
  if (roll.value >= LETTER_CHANCE) return { seed, letter: null };

  const kinds = kindsFor(s, captain);
  const k = nextInt(seed, 0, kinds.length - 1);
  seed = k.seed;
  const kind = kinds[k.value];
  const stakes = stakesFor(s.round);
  const id = s.nextLetterSeq ?? 1;
  const base = { id, kind, captainId: captain.id };

  switch (kind) {
    case 'dispatch': {
      const fleet = s.ships.filter(sh => sh.ownerId === captain.id);
      const here = new Set(fleet.map(whereabouts).filter((p): p is string => p !== null));
      const candidates = PORTS.filter(
        p => !here.has(p.id) && [...here].some(h => distanceBetween(h, p.id) <= LETTER_TERMS.dispatchMaxDistance),
      );
      if (candidates.length === 0) return { seed, letter: null };
      const c = nextInt(seed, 0, candidates.length - 1);
      seed = c.seed;
      const port = candidates[c.value].id;
      const reward = fives(LETTER_TERMS.dispatchReward * stakes);
      const bond = fives(LETTER_TERMS.dispatchBond * stakes);
      const byRound = s.round + LETTER_TERMS.dispatchRounds;
      return {
        seed,
        letter: {
          ...base,
          port,
          byRound,
          reward,
          cost: bond,
          headline: 'Admiralty dispatches',
          body:
            `The Admiralty has sealed dispatches for ${portName(port)} and wants a fast ship. Tie up there ` +
            `with any of your fleet by round ${byRound} and they pay ${money(reward)}. Fail, and the ` +
            `${money(bond)} bond you lodge is forfeit.`,
          accept: `Take the dispatches (bond ${money(bond)})`,
          decline: 'Decline',
        },
      };
    }
    case 'shoreLeave': {
      const cost = fives(LETTER_TERMS.shoreLeave * stakes);
      return {
        seed,
        letter: {
          ...base,
          cost,
          headline: 'The hands want leave',
          body:
            `Your crews have been at sea too long and send a round robin aft: shore leave, or they will ` +
            `work the ships with a will to match. ${money(cost)} sees them ashore and content. Refuse, and ` +
            `every ship of yours sails ${LETTER_TERMS.sullenPenalty} points short on your next roll.`,
          accept: `Grant leave (${money(cost)})`,
          decline: 'Refuse them',
        },
      };
    }
    case 'shipwright': {
      const offer = shipwrightOffer(s, captain)!;
      const cost = Math.round(FITTING_PRICES[offer.fitting] * LETTER_TERMS.shipwrightDiscount);
      return {
        seed,
        letter: {
          ...base,
          cost,
          shipId: offer.ship.id,
          fitting: offer.fitting,
          headline: 'A yard with a slip free',
          body:
            `A shipwright at ${portName(offer.ship.location!)} has a slip standing empty and men idle. He ` +
            `will ${offer.fitting === 'copper' ? 'copper' : 'arm'} ${offer.ship.name} for ${money(cost)}, half ` +
            `the usual ${money(FITTING_PRICES[offer.fitting])}, if you say so today.`,
          accept: `${offer.fitting === 'copper' ? 'Copper' : 'Arm'} her (${money(cost)})`,
          decline: 'Not now',
        },
      };
    }
    case 'patron': {
      const advance = fives(LETTER_TERMS.patronAdvance * stakes);
      const repay = fives(LETTER_TERMS.patronRepay * stakes);
      const byRound = s.round + LETTER_TERMS.patronRounds;
      return {
        seed,
        letter: {
          ...base,
          cost: advance,
          repay,
          byRound,
          headline: 'A patron in the City',
          body:
            `A gentleman of means will advance you ${money(advance)} on your name, today, to be repaid ` +
            `${money(repay)} by round ${byRound}. What is not paid then is taken from your next landings.`,
          accept: `Take ${money(advance)}`,
          decline: 'Owe nobody',
        },
      };
    }
    case 'wager': {
      const rivals = s.captains.filter(c => c.id !== captain.id);
      const r = nextInt(seed, 0, rivals.length - 1);
      seed = r.seed;
      const open = s.contracts.filter(c => c.fills.length === 0);
      const c = nextInt(seed, 0, open.length - 1);
      seed = c.seed;
      const card = open[c.value];
      const stake = fives(LETTER_TERMS.wagerStake * stakes);
      const rival = rivals[r.value];
      return {
        seed,
        letter: {
          ...base,
          rivalId: rival.id,
          contractId: card.id,
          stake,
          headline: `A wager from ${rival.name}`,
          body:
            `${rival.name} has lodged ${money(stake)} at the exchange that she lands ` +
            `${goodName(card.good)} at ${portName(card.destination)} before you do. Match it, and whichever of ` +
            `you lands that commission first takes both stakes. If somebody else fills it, the bet is off.`,
          accept: `Match the ${money(stake)}`,
          decline: 'Let it lie',
        },
      };
    }
  }
}

/** How a letter reads in one line, for the Gazette and the log. */
export const letterLine = (l: Letter): string => `${l.headline}: ${l.body}`;

/** The pair key for the head-to-head record. */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** How close a captain is to landing a card: carrying it, or the nearest supplier then the run in. */
export function reachFor(s: GameState, captainId: string, good: string, destination: string): number {
  let best = Infinity;
  for (const ship of s.ships) {
    if (ship.ownerId !== captainId) continue;
    const at = whereabouts(ship);
    if (!at) continue;
    if (ship.hold.some(l => l.good === good)) {
      best = Math.min(best, distanceBetween(at, destination));
      continue;
    }
    const src = sourcesFor(good, at)[0];
    if (src) best = Math.min(best, distanceBetween(at, src) + distanceBetween(src, destination));
  }
  return best;
}

