/**
 * Owners' charters: personal objectives, two per captain, paid on completion and replaced.
 *
 * Pure. Progress is recorded by the reducer at the moment something happens (a delivery, a race
 * placing, a ship bought), never reconstructed from the log, which is trimmed.
 *
 * Why they exist: with five public cards and one greedy score, every captain wants the same run
 * every turn and the table converges on one plan. A charter is a private reason to prefer one run
 * over another that pays the same, so captains pull apart — and since charters are public, reading
 * what a rival is working towards becomes part of the game.
 */
import { GOODS, PORTS, goodName, regionName, regionOf } from './content';
import { nextInt } from './rng';
import { CHARTERS_HELD, CHARTER_TERMS } from './rules';
import type { Captain, Charter, CharterKind, GameState, PortId } from './types';

/** Regions with somewhere that buys, so a regionTrade charter is always completable. */
const TRADING_REGIONS = [...new Set(PORTS.filter(p => p.demands.length > 0).map(p => p.region))];

/** Goods a card can actually ask for in useful numbers. */
const CHARTER_GOODS = GOODS.filter(g => g.basePrice >= 30 && PORTS.some(p => p.demands.includes(g.id)));

export const chartersOn = (s: GameState): boolean => Boolean(s.hazards?.charters) && s.rules === 'classic';

/** Kinds that make sense in this game: no tea race charter without a tea race. */
function kindsFor(s: GameState): CharterKind[] {
  const kinds: CharterKind[] = ['regionTrade', 'firstHome', 'goodTrade', 'spread', 'fleet'];
  if (s.hazards?.teaRace) kinds.push('teaRace');
  return kinds;
}

/** Deal one charter, of a kind the captain does not already hold. */
export function drawCharter(
  s: GameState,
  captain: Captain,
): { seed: number; charter: Charter | null; nextSeq: number } {
  const held = new Set((captain.charters ?? []).map(c => c.kind));
  const ships = s.ships.filter(sh => sh.ownerId === captain.id).length;
  // A fleet charter is no objective for a captain who already runs the full three.
  const kinds = kindsFor(s).filter(k => !held.has(k) && !(k === 'fleet' && ships >= CHARTER_TERMS.fleet.target));
  const seq = s.nextCharterSeq ?? 1;
  if (kinds.length === 0) return { seed: s.rngSeed, charter: null, nextSeq: seq };

  let seed = s.rngSeed;
  const k = nextInt(seed, 0, kinds.length - 1);
  seed = k.seed;
  const kind = kinds[k.value];
  const terms = CHARTER_TERMS[kind];
  const charter: Charter = { id: seq, kind, target: terms.target, progress: 0, reward: terms.reward };

  if (kind === 'regionTrade') {
    const r = nextInt(seed, 0, TRADING_REGIONS.length - 1);
    seed = r.seed;
    charter.region = TRADING_REGIONS[r.value];
  } else if (kind === 'goodTrade') {
    const g = nextInt(seed, 0, CHARTER_GOODS.length - 1);
    seed = g.seed;
    charter.good = CHARTER_GOODS[g.value].id;
  } else if (kind === 'spread') {
    charter.regions = [];
  } else if (kind === 'fleet') {
    charter.progress = Math.min(ships, terms.target);
  }
  return { seed, charter, nextSeq: seq + 1 };
}

/** One line saying what a charter asks. */
export function charterText(c: Charter): string {
  switch (c.kind) {
    case 'regionTrade':
      return `Land ${c.target} lots in ${regionName(c.region ?? '')}`;
    case 'firstHome':
      return `Be first home on ${c.target} commissions`;
    case 'goodTrade':
      return `Land ${c.target} lots of ${goodName(c.good ?? '')}`;
    case 'spread':
      return `Land cargo in ${c.target} different regions`;
    case 'teaRace':
      return 'Place in a Great Tea Race';
    case 'fleet':
      return `Run a fleet of ${c.target} ships`;
  }
}

/** What happened, as far as a charter cares. */
export type CharterEvent =
  | { kind: 'landed'; port: PortId; good: string; units: number; rank: 1 | 2 | null }
  | { kind: 'racePlaced' }
  | { kind: 'fleet'; ships: number };

/** Advance one charter by an event. Returns the same object when nothing changed. */
export function advance(c: Charter, e: CharterEvent): Charter {
  switch (c.kind) {
    case 'regionTrade':
      return e.kind === 'landed' && regionOf(e.port) === c.region
        ? { ...c, progress: Math.min(c.target, c.progress + e.units) }
        : c;
    case 'goodTrade':
      return e.kind === 'landed' && e.good === c.good
        ? { ...c, progress: Math.min(c.target, c.progress + e.units) }
        : c;
    case 'firstHome':
      return e.kind === 'landed' && e.rank === 1 ? { ...c, progress: Math.min(c.target, c.progress + 1) } : c;
    case 'spread': {
      if (e.kind !== 'landed') return c;
      const region = regionOf(e.port);
      const seen = c.regions ?? [];
      if (!region || seen.includes(region)) return c;
      const regions = [...seen, region];
      return { ...c, regions, progress: Math.min(c.target, regions.length) };
    }
    case 'teaRace':
      return e.kind === 'racePlaced' ? { ...c, progress: c.target } : c;
    case 'fleet':
      return e.kind === 'fleet' && e.ships > c.progress ? { ...c, progress: Math.min(c.target, e.ships) } : c;
  }
}

export const isComplete = (c: Charter): boolean => c.progress >= c.target;

/**
 * What landing `units` of `good` at `port` would be worth to this captain's charters, for the AI.
 * The reward spread across the target, so a lot is worth a lot's share — never the whole reward
 * for one lot, which would have her chase a charter over a card that pays more.
 */
export function charterValue(captain: Captain | undefined, port: PortId, good: string, units: number, firstHome: boolean): number {
  let value = 0;
  for (const c of captain?.charters ?? []) {
    const left = c.target - c.progress;
    if (left <= 0) continue;
    const share = c.reward / c.target;
    if (c.kind === 'regionTrade' && regionOf(port) === c.region) value += share * Math.min(units, left);
    if (c.kind === 'goodTrade' && good === c.good) value += share * Math.min(units, left);
    if (c.kind === 'spread' && !(c.regions ?? []).includes(regionOf(port))) value += share;
    if (c.kind === 'firstHome' && firstHome) value += share;
  }
  return value;
}

/** Deal every captain their opening charters. Only ever called at the birth of a game. */
export function dealOpeningCharters(state: GameState): GameState {
  if (!chartersOn(state)) return state;
  let s = state;
  for (let i = 0; i < CHARTERS_HELD; i++) {
    for (const captain of s.captains) {
      const current = s.captains.find(c => c.id === captain.id)!;
      const drawn = drawCharter(s, current);
      if (!drawn.charter) continue;
      s = {
        ...s,
        rngSeed: drawn.seed,
        nextCharterSeq: drawn.nextSeq,
        captains: s.captains.map(c =>
          c.id === captain.id ? { ...c, charters: [...(c.charters ?? []), drawn.charter!] } : c,
        ),
      };
    }
  }
  return s;
}
