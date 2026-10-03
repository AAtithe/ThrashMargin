import { CONFIG, barMax } from './content';
import { seedFromString } from './rng';
import type { GameState } from './types';

export interface NewGameOptions {
  /** A memorable seed string. Omitted means one derived from the id. */
  seed?: string;
  /** Supplied by the caller: the sim never reads a clock. */
  createdAt: number;
}

/**
 * A new character: a dyeworks lad in Bruges with a pallet in the loft, the drill yard behind the
 * works, a few groats and every bar full.
 */
export function createInitialState(id: string, name: string, opts: NewGameOptions): GameState {
  const at = opts.createdAt;
  const rngSeed = seedFromString(opts.seed ?? id);
  const s: GameState = {
    rules: 'rising-1',
    id,
    name,
    createdAt: at,
    rngSeed,
    marketSeed: seedFromString(`market:${opts.seed ?? id}`),
    clock: at,
    level: 1,
    xp: 0,
    standing: 0,
    groats: CONFIG.startGroats,
    bars: {
      energy: { cur: 0, anchor: at },
      nerve: { cur: 0, anchor: at },
      spirits: { cur: 0, anchor: at },
      health: { cur: 0, anchor: at },
    },
    battle: { strength: 10, defence: 10, speed: 10, dexterity: 10 },
    work: { craft: 5, wit: 5, stamina: 5 },
    schemeSkill: 0,
    status: { kind: 'free' },
    job: null,
    course: null,
    coursesDone: [],
    deposit: null,
    inventory: { marchpane: 1, bandage: 1 },
    equipped: { weapon: null, armour: null },
    lodgings: ['loft'],
    yards: ['drill_yard'],
    tripBought: 0,
    abroad: {},
    opponents: {},
    honours: [],
    missions: { active: null, done: [] },
    house: null,
    houseLeftAt: null,
    counters: { schemes: 0, schemesWon: 0, duelsWon: 0, duelsLost: 0, voyages: 0 },
    lastFight: null,
    log: [],
    nextLogSeq: 1,
  };
  for (const bar of ['energy', 'nerve', 'spirits', 'health'] as const) s.bars[bar].cur = barMax(s, bar);
  s.log.push({
    seq: s.nextLogSeq++,
    at,
    tone: 'neutral',
    text: 'Bruges, the spring of 1460. You are a dyer\'s lad at the Charetty works with a loft to sleep in, a few groats, and a reputation for jokes. Everything else is to be made.',
  });
  return s;
}

/**
 * Brings an older save up to the current shape. The cloud and local loaders both call it before the
 * shape check, so every migration here runs for every save, every load.
 *
 * Phase 5 added `missions`. A character created before then has none, and would crash the first
 * time anything read `s.missions.active`. It gains an empty record: no mission in hand, none done,
 * so the chain starts at the beginning whatever level the character has reached.
 *
 * Phase 6 added `house` and `houseLeftAt`. A character from before then belongs to no house and has
 * never left one.
 *
 * Returns the same object when nothing needed adding, so a current save passes through untouched.
 */
export function migrateState(raw: unknown): GameState {
  if (!raw || typeof raw !== 'object') return raw as GameState;
  const s = raw as Partial<GameState> & { rules?: string };
  if (s.rules !== 'rising-1') return s as GameState;
  const patch: Partial<GameState> = {};
  if (!s.missions || typeof s.missions !== 'object') patch.missions = { active: null, done: [] };
  if (!('house' in s)) patch.house = null;
  if (!('houseLeftAt' in s)) patch.houseLeftAt = null;
  return Object.keys(patch).length ? ({ ...s, ...patch } as GameState) : (s as GameState);
}

/** Top-level shape check for the local loader. Also used by the driver. */
export function isCurrentShape(parsed: unknown): parsed is GameState {
  const s = parsed as Partial<GameState> | null;
  if (!s || typeof s !== 'object') return false;
  if (s.rules !== 'rising-1') return false;
  if (typeof s.rngSeed !== 'number' || typeof s.marketSeed !== 'number' || typeof s.clock !== 'number') return false;
  if (!s.bars || !s.battle || !s.work || !s.status || !s.inventory || !s.equipped) return false;
  if (!Array.isArray(s.log) || !Array.isArray(s.coursesDone) || !Array.isArray(s.lodgings) || !Array.isArray(s.yards)) return false;
  if (!s.abroad || !s.opponents || !s.counters || !Array.isArray(s.honours)) return false;
  if (!s.missions || !Array.isArray(s.missions.done) || !('active' in s.missions)) return false;
  if (!('house' in s) || !('houseLeftAt' in s)) return false;
  if (s.house && (typeof s.house.favour !== 'number' || !s.house.chain || !('contract' in s.house))) return false;
  return true;
}
