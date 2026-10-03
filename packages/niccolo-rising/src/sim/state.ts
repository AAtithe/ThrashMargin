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
 * Brings an older save up to the current shape. Nothing has changed shape yet; this is where the
 * first migration goes, and the cloud and local loaders both call it already.
 */
export function migrateState(raw: unknown): GameState {
  return raw as GameState;
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
  return true;
}
