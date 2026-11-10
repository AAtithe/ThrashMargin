/**
 * War for the Planet: the start of a war and the small questions everything else asks
 * (fireline-planet-design.md, sections 2, 5.1 and 8.1). W1. Pure: dice from the seed, the
 * creation time passed in.
 */
import { HERO_KINDS, type Difficulty, type HeroKind } from '../sim/rules';
import { seedFromString, stream } from '../sim/rng';
import { cleanCommander } from '../campaign/progression';
import { listNames, note } from './journal';
import { claimStarts, permutation, planetMapOf, placeCapitals, startDeal, terrainYieldTotal } from './map';
import {
  AI_FACTION_NAMES,
  NEUTRAL_BUILDINGS,
  NEUTRAL_GARRISON,
  PLAYER_NAME,
  PRESETS,
  START_ARMY,
  START_CAPITAL_GARRISON,
  START_REGION_GARRISON,
  STARTING_STOCK,
  TEMPERAMENT_LIST,
  TERRAIN_YIELD,
  isLengthPreset,
  normaliseOptions,
} from './rules';
import {
  ARMY_KINDS,
  NEUTRAL,
  type ArmyKind,
  type CityState,
  type CoreUnit,
  type FactionId,
  type FactionState,
  type LengthPreset,
  type PlanetHero,
  type PlanetMap,
  type PlanetState,
  type RegionId,
  type RegionState,
  type Stance,
  type Temperament,
  type Treaty,
} from './types';

// ---- Small helpers shared by every W1 file ----------------------------------------------------

/** A deep copy of plain JSON data. The reducer copies the state once and edits the copy. */
export function deepClone<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = deepClone(v[i]);
    return out as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as object)) out[k] = deepClone((v as Record<string, unknown>)[k]);
  return out as T;
}

export const kindIndex = (k: ArmyKind): number => ARMY_KINDS.indexOf(k);
export const isArmyKind = (v: unknown): v is ArmyKind => typeof v === 'string' && (ARMY_KINDS as string[]).includes(v);
export const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
export const emptyGarrison = (): number[] => ARMY_KINDS.map(() => 0);
export const garrisonTotal = (g: number[]): number => g.reduce((t, n) => t + n, 0);

export function garrisonFrom(list: [ArmyKind, number][], mul = 1): number[] {
  const g = emptyGarrison();
  for (const [k, n] of list) g[kindIndex(k)] += Math.round(n * mul);
  return g;
}

/** A garrison as a flat list of kinds, in ARMY_KINDS order. */
export function garrisonUnits(g: number[]): ArmyKind[] {
  const out: ArmyKind[] = [];
  g.forEach((n, i) => {
    for (let j = 0; j < n; j++) out.push(ARMY_KINDS[i]);
  });
  return out;
}

export const regionsOf = (s: PlanetState, f: FactionId): RegionId[] => {
  const out: RegionId[] = [];
  s.regions.forEach((r, i) => {
    if (r.owner === f) out.push(i);
  });
  return out;
};

export const isFaction = (s: PlanetState, f: unknown): f is FactionId => isInt(f, 0, s.factions.length - 1);
export const aliveFaction = (s: PlanetState, f: unknown): f is FactionId => isFaction(s, f) && s.factions[f].alive;

export const factionName = (s: PlanetState, f: number): string => (f === NEUTRAL ? 'the independents' : s.factions[f]?.name ?? 'Unknown');

export function treatyBetween(s: PlanetState, a: FactionId, b: FactionId): Treaty | null {
  if (a === b) return null;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return s.treaties.find(t => t.a === lo && t.b === hi) ?? null;
}

/** The kind of their treaty, or 'war' with no treaty. Independents are at war with everyone. */
export function stanceOf(s: PlanetState, a: FactionId, b: FactionId): Stance {
  if (a === NEUTRAL || b === NEUTRAL) return 'war';
  if (a === b) return 'alliance';
  return treatyBetween(s, a, b)?.kind ?? 'war';
}

/** True when a and b (different, at least one a faction) are at war. A faction is never at war with itself. */
export const atWar = (s: PlanetState, a: number, b: number): boolean => a !== b && stanceOf(s, a, b) === 'war';
export const allied = (s: PlanetState, a: number, b: number): boolean => a !== b && a !== NEUTRAL && b !== NEUTRAL && stanceOf(s, a, b) === 'alliance';

export function phaseOf(s: PlanetState): 'orders' | 'pending' | 'battle' | 'over' {
  if (s.result) return 'over';
  if (s.pending.length && s.pending[0].fighting) return 'battle';
  if (s.pending.length) return 'pending';
  return 'orders';
}

export function sortTreaties(list: Treaty[]): Treaty[] {
  return list.sort((p, q) => p.a - q.a || p.b - q.b);
}

export { terrainYieldTotal };

// ---- The start (section 5.1) ------------------------------------------------------------------

export function newPlanetState(p: {
  seedText: string;
  preset: LengthPreset;
  options?: unknown;
  difficulty: Difficulty;
  commander: string;
  createdAt: number;
}): PlanetState {
  const preset: LengthPreset = isLengthPreset(p.preset) ? p.preset : 'short';
  const options = normaliseOptions(p.options ?? PRESETS[preset], preset);
  const seedText = String(p.seedText ?? '').slice(0, 64) || 'planet';
  const difficulty: Difficulty = p.difficulty === 'easy' || p.difficulty === 'hard' ? p.difficulty : 'normal';
  const m = planetMapOf({ seedText, options });
  let rnd = stream(seedFromString(seedText + ':start'));
  const F = options.factions;

  // 1 and 2. Capitals, dealt by a seeded permutation, then start regions in rounds, faction 0
  // first. planetMapOf kept the first geometry attempt where this succeeds; only a seed whose every
  // attempt failed takes the fallback, redrawn from the top of the stream as it always was.
  let start = startDeal(m, options, rnd);
  if (!start) {
    rnd = stream(seedFromString(seedText + ':start'));
    const caps = placeCapitals(m, F, rnd) ?? fallbackCapitals(m, F);
    const deal = permutation(F, rnd);
    const capitalOf: RegionId[] = new Array(F);
    deal.forEach((f, k) => (capitalOf[f] = caps[k]));
    start = { capitalOf, owner: claimStarts(m, capitalOf, options.startRegions) };
  }
  const { capitalOf } = start;
  const owner = start.owner;

  const regions: RegionState[] = m.regions.map((_, r) => ({
    owner: owner[r],
    city: { level: 1, b: {}, built: -1 },
    garrison: emptyGarrison(),
    cut: 0,
  }));

  // 3 and 4. Cities and garrisons of the factions.
  for (let r = 0; r < regions.length; r++) {
    const reg = regions[r];
    if (reg.owner === NEUTRAL) continue;
    if (capitalOf[reg.owner] === r) {
      reg.city = { level: 3, b: { refinery: 1, farms: 1, factory: 1, fortifications: 1 }, built: -1 };
      reg.garrison = garrisonFrom(START_CAPITAL_GARRISON);
    } else {
      const food = TERRAIN_YIELD[m.regions[r].terrain].food;
      reg.city = { level: 1, b: food >= 2 ? { farms: 1 } : { refinery: 1 }, built: -1 };
      reg.garrison = garrisonFrom(START_REGION_GARRISON);
    }
  }

  // Temperaments and names, each by a seeded permutation.
  const temps = permutation(3, rnd).map(i => TEMPERAMENT_LIST[i]);
  const names = permutation(AI_FACTION_NAMES.length, rnd).map(i => AI_FACTION_NAMES[i]);

  // Independents (section 9.3).
  for (let r = 0; r < regions.length; r++) {
    const reg = regions[r];
    if (reg.owner !== NEUTRAL) continue;
    const level: 1 | 2 = rnd.float() < 0.3 ? 2 : 1;
    const city: CityState = { level, b: {}, built: -1 };
    if (level === 2) city.b[NEUTRAL_BUILDINGS[rnd.int(0, NEUTRAL_BUILDINGS.length - 1)]] = 1;
    reg.city = city;
    reg.garrison = garrisonFrom(NEUTRAL_GARRISON[level], options.neutralStrength);
    // The cap wins over neutralStrength (Very long's 1.4 overfills a level 2 city): trim from the last kind.
    const cap = 4 + 2 * level + 3 * (city.b.fortifications ?? 0);
    let over = garrisonTotal(reg.garrison) - cap;
    for (let i = reg.garrison.length - 1; i >= 0 && over > 0; i--) {
      const n = Math.min(reg.garrison[i], over);
      reg.garrison[i] -= n;
      over -= n;
    }
  }

  const army = (): CoreUnit[] => {
    const out: CoreUnit[] = [];
    for (const [k, n] of START_ARMY) for (let i = 0; i < n; i++) out.push({ kind: k, kills: 0 });
    return out;
  };
  const factions: FactionState[] = [];
  for (let f = 0; f < F; f++) {
    const temperament: Temperament | null = f === 0 ? null : temps[(f - 1) % 3];
    factions.push({
      id: f,
      name: f === 0 ? PLAYER_NAME : names[f - 1],
      temperament,
      alive: true,
      capital: capitalOf[f],
      stock: { ...STARTING_STOCK },
      research: { current: null, points: 0, done: [], doctrines: {}, loadouts: {} },
      army: { region: capitalOf[f], units: army(), moved: 0, attacked: false },
    });
  }

  const trust = factions.map((_, a) => factions.map((__, b) => (a === b ? 100 : 50)));
  const treaties: Treaty[] = [];
  for (let a = 0; a < F; a++) for (let b = a + 1; b < F; b++) {
    treaties.push({ kind: 'ceasefire', turns: options.openingTruce, terms: [], a, b, since: 1, ends: options.openingTruce });
  }
  const heroes = {} as Record<HeroKind, PlanetHero>;
  for (const k of HERO_KINDS) heroes[k] = { unlocked: k === 'engineer' || k === 'commando', xp: 0, wounded: false, lost: false };

  const s: PlanetState = {
    version: 1,
    seedText,
    rngSeed: seedFromString(seedText + ':war'),
    createdAt: p.createdAt,
    options,
    difficulty,
    turn: 1,
    regions,
    factions,
    trust,
    treaties,
    routes: [],
    offers: [],
    pending: [],
    commander: { name: cleanCommander(p.commander), xp: 0, points: 0, perks: {} },
    heroes,
    nextId: 1,
    journal: [],
    result: null,
  };
  note(s, `The war for ${m.name} begins. ${listNames(factions.map(f => f.name))} hold their capitals under an opening truce of ${options.openingTruce} turns.`);
  return s;
}

/** Only for a seed whose every geometry retry failed the spacing check: the most spread regions. */
function fallbackCapitals(m: PlanetMap, F: number): RegionId[] {
  const out: RegionId[] = [];
  for (let i = 0; i < F; i++) out.push(Math.floor((i * m.regions.length) / F));
  return out;
}
