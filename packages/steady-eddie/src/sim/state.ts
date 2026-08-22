/**
 * Game setup. `createInitialState` is the only place a game is born — the lobby, the API's POST
 * handler and scripts/drive.ts all go through it, so a cloud campaign and a headless one are the
 * same object.
 */
import { HOME_DEPOT, depotName } from './content';
import { dealOpeningContracts, shuffledDeck } from './contracts';
import { seedFromString } from './rng';
import {
  HAULIER_COLOURS,
  HAULIER_NAMES,
  MAX_HAULIERS,
  MIN_HAULIERS,
  VEHICLE_NAMES,
  STARTING_CASH,
  TOTAL_SHARES,
} from './rules';
import type { AiProfile, Haulier, GameState, Hazards, Vehicle } from './types';
import { DEFAULT_DIFFICULTY } from './rules';
import type { Difficulty } from './rules';

export interface NewGameOptions {
  /** Seat names for the human hauliers. One entry per human; empty means a pure AI game. */
  humanNames?: string[];
  /** How many computer hauliers to add after the humans. */
  aiCount?: number;
  /** A memorable seed string. Omitted means the game id is used, which is already unique. */
  seed?: string;
  /** ms epoch. Passed in rather than read here so the sim never touches a clock. */
  createdAt?: number;
  /**
   * Which hazards to play with. Defaults to both on for a new game; a save written before hazards
   * existed has no field at all, which reads as off and keeps the pure core rules.
   */
  hazards?: Hazards;
  /** How well the computer hauliers play. Defaults to 'steady'. */
  difficulty?: Difficulty;
}

/** Profiles are handed out in rotation so a three-rival game always sees all three temperaments. */
const AI_PROFILES: AiProfile[] = ['racer', 'speculator', 'financier'];

export function createInitialState(id: string, name: string, opts: NewGameOptions = {}): GameState {
  const humanNames = (opts.humanNames ?? ['You']).filter(n => n.trim().length > 0);
  const requestedAi = Math.max(0, opts.aiCount ?? 3);

  const total = Math.min(MAX_HAULIERS, Math.max(MIN_HAULIERS, humanNames.length + requestedAi));
  const humans = Math.min(humanNames.length, total);
  const ais = total - humans;

  const hauliers: Haulier[] = [];
  for (let i = 0; i < humans; i++) {
    hauliers.push({
      id: `p${i + 1}`,
      name: humanNames[i].trim(),
      kind: 'human',
      colour: HAULIER_COLOURS[i % HAULIER_COLOURS.length],
      cash: STARTING_CASH,
      shares: 0,
    });
  }
  for (let i = 0; i < ais; i++) {
    const seat = humans + i;
    hauliers.push({
      id: `p${seat + 1}`,
      name: HAULIER_NAMES[seat % HAULIER_NAMES.length],
      kind: 'ai',
      colour: HAULIER_COLOURS[seat % HAULIER_COLOURS.length],
      cash: STARTING_CASH,
      shares: 0,
      aiProfile: AI_PROFILES[i % AI_PROFILES.length],
    });
  }

  const vehicles: Vehicle[] = hauliers.map((c, i) => ({
    id: `s${i + 1}`,
    ownerId: c.id,
    name: VEHICLE_NAMES[i % VEHICLE_NAMES.length],
    location: HOME_DEPOT,
    run: null,
    hold: [],
  }));

  const seed0 = seedFromString(opts.seed?.trim() || id);
  const shuffled = shuffledDeck(seed0);
  const dealt = dealOpeningContracts(shuffled.seed, shuffled.deck, 1);

  return {
    id,
    name: name.trim() || 'Run',
    rules: 'standard',
    hazards: opts.hazards ?? {
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
    difficulty: opts.difficulty ?? DEFAULT_DIFFICULTY,
    createdAt: opts.createdAt ?? 0,
    rngSeed: dealt.seed,

    round: 1,
    turn: 0,
    activeIndex: 0,
    phase: 'roll',

    hauliers,
    vehicles,

    contracts: dealt.contracts,
    deck: dealt.deck,
    nextContractSeq: dealt.seq,
    nextVehicleSeq: vehicles.length + 1,
    nextLogSeq: 1,

    sharesRemaining: TOTAL_SHARES,
    declaration: null,
    winnerId: null,

    miles: {},
    dice: {},

    log: [
      {
        seq: 0,
        turn: 0,
        round: 1,
        haulierId: null,
        kind: 'contract',
        text: `${hauliers.length} hauliers lie at ${depotName(HOME_DEPOT)}. Five commissions are posted on the exchange.`,
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
  const s = raw as (GameState & { vehicles?: (Vehicle & { cargo?: unknown })[] }) | null;
  if (!s || typeof s !== 'object' || !Array.isArray(s.vehicles)) return null;
  return {
    ...s,
    vehicles: s.vehicles.map(vehicle => {
      if (Array.isArray(vehicle.hold)) return vehicle;
      const legacy = (vehicle as { cargo?: GameState['vehicles'][number]['hold'][number] | null }).cargo;
      const { cargo: _dropped, ...rest } = vehicle as Vehicle & { cargo?: unknown };
      return { ...rest, hold: legacy ? [legacy] : [] };
    }),
  };
}

/** True when at least two seats are human, which is the only case needing a handover card. */
export const isHotseat = (s: GameState): boolean =>
  s.hauliers.filter(c => c.kind === 'human').length > 1;

export const haulierById = (s: GameState, id: string): Haulier | undefined =>
  s.hauliers.find(c => c.id === id);

export const activeHaulier = (s: GameState): Haulier => s.hauliers[s.activeIndex];

export const vehiclesOf = (s: GameState, haulierId: string): Vehicle[] =>
  s.vehicles.filter(sh => sh.ownerId === haulierId);
