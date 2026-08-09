/**
 * Game setup. `createInitialState` is the only place a game is born — the lobby, the API's POST
 * handler and scripts/drive.ts all go through it, so a cloud campaign and a headless one are the
 * same object.
 */
import { HOME_PORT } from './content';
import { dealOpeningContracts, shuffledDeck } from './contracts';
import { seedFromString } from './rng';
import {
  CAPTAIN_COLOURS,
  CAPTAIN_NAMES,
  MAX_CAPTAINS,
  MIN_CAPTAINS,
  SHIP_NAMES,
  STARTING_CASH,
  TOTAL_SHARES,
} from './rules';
import type { AiProfile, Captain, GameState, Hazards, Ship } from './types';

export interface NewGameOptions {
  /** Seat names for the human captains. One entry per human; empty means a pure AI game. */
  humanNames?: string[];
  /** How many computer captains to add after the humans. */
  aiCount?: number;
  /** A memorable seed string. Omitted means the game id is used, which is already unique. */
  seed?: string;
  /** ms epoch. Passed in rather than read here so the sim never touches a clock. */
  createdAt?: number;
  /**
   * Which hazards to play with. Defaults to both on for a new game; a save written before hazards
   * existed has no field at all, which reads as off and keeps the pure 1988 rules.
   */
  hazards?: Hazards;
}

/** Profiles are handed out in rotation so a three-rival game always sees all three temperaments. */
const AI_PROFILES: AiProfile[] = ['racer', 'speculator', 'financier'];

export function createInitialState(id: string, name: string, opts: NewGameOptions = {}): GameState {
  const humanNames = (opts.humanNames ?? ['You']).filter(n => n.trim().length > 0);
  const requestedAi = Math.max(0, opts.aiCount ?? 3);

  const total = Math.min(MAX_CAPTAINS, Math.max(MIN_CAPTAINS, humanNames.length + requestedAi));
  const humans = Math.min(humanNames.length, total);
  const ais = total - humans;

  const captains: Captain[] = [];
  for (let i = 0; i < humans; i++) {
    captains.push({
      id: `p${i + 1}`,
      name: humanNames[i].trim(),
      kind: 'human',
      colour: CAPTAIN_COLOURS[i % CAPTAIN_COLOURS.length],
      cash: STARTING_CASH,
      shares: 0,
    });
  }
  for (let i = 0; i < ais; i++) {
    const seat = humans + i;
    captains.push({
      id: `p${seat + 1}`,
      name: `Capt. ${CAPTAIN_NAMES[seat % CAPTAIN_NAMES.length]}`,
      kind: 'ai',
      colour: CAPTAIN_COLOURS[seat % CAPTAIN_COLOURS.length],
      cash: STARTING_CASH,
      shares: 0,
      aiProfile: AI_PROFILES[i % AI_PROFILES.length],
    });
  }

  const ships: Ship[] = captains.map((c, i) => ({
    id: `s${i + 1}`,
    ownerId: c.id,
    name: SHIP_NAMES[i % SHIP_NAMES.length],
    location: HOME_PORT,
    voyage: null,
    hold: [],
  }));

  const seed0 = seedFromString(opts.seed?.trim() || id);
  const shuffled = shuffledDeck(seed0);
  const dealt = dealOpeningContracts(shuffled.seed, shuffled.deck, 1);

  return {
    id,
    name: name.trim() || 'Voyage',
    rules: 'classic',
    hazards: opts.hazards ?? { weather: true, piracy: true },
    createdAt: opts.createdAt ?? 0,
    rngSeed: dealt.seed,

    round: 1,
    turn: 0,
    activeIndex: 0,
    phase: 'roll',

    captains,
    ships,

    contracts: dealt.contracts,
    deck: dealt.deck,
    nextContractSeq: dealt.seq,
    nextShipSeq: ships.length + 1,
    nextLogSeq: 1,

    sharesRemaining: TOTAL_SHARES,
    declaration: null,
    winnerId: null,

    sailPoints: {},
    dice: {},

    log: [
      {
        seq: 0,
        turn: 0,
        round: 1,
        captainId: null,
        kind: 'contract',
        text: `${captains.length} captains lie at ${
          HOME_PORT === 'liverpool' ? 'Liverpool' : HOME_PORT
        }. Five commissions are posted on the exchange.`,
      },
    ],
  };
}

/**
 * Brings an older save up to the current shape.
 *
 * The only breaking change so far is single-cargo to three-slot holds. A save from before that
 * carries `cargo: CargoLot | null`, which migrates cleanly to a one-slot hold — discarding those
 * saves would have been the lazy option and would have thrown away real games.
 */
export function migrateState(raw: unknown): GameState | null {
  const s = raw as (GameState & { ships?: (Ship & { cargo?: unknown })[] }) | null;
  if (!s || typeof s !== 'object' || !Array.isArray(s.ships)) return null;
  return {
    ...s,
    ships: s.ships.map(ship => {
      if (Array.isArray(ship.hold)) return ship;
      const legacy = (ship as { cargo?: GameState['ships'][number]['hold'][number] | null }).cargo;
      const { cargo: _dropped, ...rest } = ship as Ship & { cargo?: unknown };
      return { ...rest, hold: legacy ? [legacy] : [] };
    }),
  };
}

/** True when at least two seats are human, which is the only case needing a handover card. */
export const isHotseat = (s: GameState): boolean =>
  s.captains.filter(c => c.kind === 'human').length > 1;

export const captainById = (s: GameState, id: string): Captain | undefined =>
  s.captains.find(c => c.id === id);

export const activeCaptain = (s: GameState): Captain => s.captains[s.activeIndex];

export const shipsOf = (s: GameState, captainId: string): Ship[] =>
  s.ships.filter(sh => sh.ownerId === captainId);
