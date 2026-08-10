/**
 * The commodity deck: which cards exist, how they are drawn, and what a delivery pays.
 *
 * The deck is persisted as compact "good|destination" keys rather than whole Contract objects.
 * Keys are self-describing, so a save made before a content change still loads: an entry naming a
 * port or good that no longer exists is skipped at draw time rather than crashing.
 *
 * A card names the buyer and the price, never the seller — see the Contract type. The three-part
 * "good|source|destination" keys of earlier saves are still parsed, with the middle field dropped.
 */
import { CONTRACT_MAX_DISTANCE, FACE_UP_CONTRACTS, PAYOUT_MULTIPLIERS } from './rules';
import { GOODS, GOOD_BY_ID, PORTS, PORT_BY_ID, distanceBetween } from './content';
import { shuffle } from './rng';
import type { Contract, ContractFill, GoodId, PortId } from './types';

export type CardKey = string;

const key = (good: GoodId, destination: PortId): CardKey => `${good}|${destination}`;

export function parseCardKey(k: CardKey): { good: GoodId; destination: PortId } | null {
  const parts = k.split('|');
  // Two parts is the current form. Three is a save from when cards named a source port: the middle
  // field is dropped rather than rejected, so an existing game keeps its draw pile.
  const good = parts[0];
  const destination = parts.length >= 3 ? parts[2] : parts[1];
  if (!good || !destination) return null;
  if (!GOOD_BY_ID[good] || !PORT_BY_ID[destination]) return null;
  return { good, destination };
}

/**
 * Every legal card: a good and a port that wants it, with at least one port selling that good near
 * enough to make a real race of it. Deterministic and content-derived, so two clients agree.
 *
 * The distance cap is now a *reachability* test rather than a property of one named pair: some
 * supplier has to be within CONTRACT_MAX_DISTANCE of the buyer, but which one the captain uses is
 * their business. This is why the deck is a few dozen cards rather than a few hundred — the old one
 * enumerated every source-sink pair, and most of those were the same commission over again.
 */
export function buildDeck(): CardKey[] {
  const cards: CardKey[] = [];
  for (const good of GOODS) {
    const sources = PORTS.filter(p => p.supplies.includes(good.id));
    for (const d of PORTS.filter(p => p.demands.includes(good.id))) {
      const reachable = sources.some(
        s => s.id !== d.id && distanceBetween(s.id, d.id) <= CONTRACT_MAX_DISTANCE,
      );
      if (!reachable) continue;
      cards.push(key(good.id, d.id));
    }
  }
  return cards;
}

export function shuffledDeck(seed: number): { seed: number; deck: CardKey[] } {
  const r = shuffle(seed, buildDeck());
  return { seed: r.seed, deck: r.items };
}

export interface DrawResult {
  seed: number;
  deck: CardKey[];
  contract: Contract;
  seq: number;
}

/**
 * Draws one card. If the pile is exhausted it is rebuilt and reshuffled — with ~230 cards and two
 * fills each that should never happen in a real game, but a deck that can run dry is a deck that
 * can wedge the whole turn loop, so it is handled rather than asserted away.
 *
 * `exclude` keeps the five face-up cards distinct; without it the same run can appear twice and
 * the race for it becomes incoherent.
 */
export function drawContract(
  seed: number,
  deck: CardKey[],
  seq: number,
  exclude: ReadonlySet<CardKey> = new Set(),
): DrawResult {
  let s = seed;
  let pile = deck;

  for (let attempts = 0; attempts < 2; attempts++) {
    for (let i = 0; i < pile.length; i++) {
      const card = pile[i];
      if (exclude.has(card)) continue;
      const parsed = parseCardKey(card);
      if (!parsed) continue;
      const remaining = pile.slice(0, i).concat(pile.slice(i + 1));
      return {
        seed: s,
        deck: remaining,
        seq: seq + 1,
        contract: {
          id: `c${seq}`,
          good: parsed.good,
          destination: parsed.destination,
          price: GOOD_BY_ID[parsed.good].basePrice,
          fills: [],
        },
      };
    }
    // Pile exhausted (or every remaining card is already face-up) — rebuild and reshuffle.
    const r = shuffle(s, buildDeck());
    s = r.seed;
    pile = r.items;
  }

  throw new Error('drawContract: no drawable card after a full reshuffle');
}

/** Deals the opening five. */
export function dealOpeningContracts(seed: number, deck: CardKey[], seq: number) {
  let s = seed;
  let pile = deck;
  let n = seq;
  const contracts: Contract[] = [];
  const seen = new Set<CardKey>();
  for (let i = 0; i < FACE_UP_CONTRACTS; i++) {
    const drawn = drawContract(s, pile, n, seen);
    s = drawn.seed;
    pile = drawn.deck;
    n = drawn.seq;
    contracts.push(drawn.contract);
    seen.add(key(drawn.contract.good, drawn.contract.destination));
  }
  return { seed: s, deck: pile, seq: n, contracts };
}

/** The keys currently face-up, for passing as `exclude`. */
export const faceUpKeys = (contracts: readonly Contract[]): Set<CardKey> =>
  new Set(contracts.map(c => key(c.good, c.destination)));

/** What the next delivery on this contract would pay. Zero once two captains have filled it. */
export function payoutFor(contract: Contract): number {
  const rank = contract.fills.length + 1;
  if (rank !== 1 && rank !== 2) return 0;
  return contract.price * PAYOUT_MULTIPLIERS[rank];
}

/** True once the card is spent and should be replaced. */
export const isContractComplete = (contract: Contract): boolean => contract.fills.length >= 2;

export function nextRank(contract: Contract): 1 | 2 | null {
  const rank = contract.fills.length + 1;
  return rank === 1 || rank === 2 ? rank : null;
}

export function recordFill(contract: Contract, fill: ContractFill): Contract {
  return { ...contract, fills: [...contract.fills, fill] };
}
