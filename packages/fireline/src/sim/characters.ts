/**
 * Commander characters (2026-11-28, `setup.characters`). Before this, every computer commander at a
 * difficulty was the same commander: the same build order, its first wave on the same minute, the same
 * unit mix, every battle. A player learned one answer and every battle after it played the same way.
 *
 * With characters on, each computer seat fights in one of five ways, drawn from the battle's seed text
 * (so the same seed always meets the same commander, and a replay is exact):
 *
 *  - Steady: the commander as it always was.
 *  - Striker: attacks early and often with smaller, lighter waves, and spends little on defence.
 *  - Bulwark: digs in behind extra turrets and walls, and comes late with large, heavy siege waves.
 *  - Hunter: raids the enemy's haulers early and constantly with fast units; smaller main waves.
 *  - Builder: extra Refineries and haulers first, then late, large waves that grow quickly.
 *
 * Each character is a set of adjustments to the difficulty's own numbers, applied after the map's
 * scaling and the patience cap, so a Striker is early and a Bulwark late on every map and pace. The
 * difficulty still sets the commander's quality (decision speed, income, focus, retreat); the character
 * sets its plan. The adaptive commander (aiAdapt.ts) still answers what it sees, starting from the
 * character's mix rather than the plain one.
 *
 * Never in a mission or a War for the Planet battle, whose balance is their own; never with the setup's
 * `characters` off or absent, so every older save plays exactly as before. Pure: no Math.random, no
 * clock, and no draw from the battle's own stream (the pick comes from the seed text and a salt).
 */
import { next, seedFromString } from './rng';
import { SIDE_NAMES, type DifficultySpec, type Owner, type UnitKind } from './rules';
import type { GameState } from './types';

export type CharacterId = 'steady' | 'striker' | 'bulwark' | 'hunter' | 'builder';
export const CHARACTER_IDS: CharacterId[] = ['steady', 'striker', 'bulwark', 'hunter', 'builder'];

export interface CharacterSpec {
  name: string;
  /** One line for the log and the review: what the player is facing. */
  line: string;
  /** What beats it, for the after-action review. */
  answer: string;
}

export const CHARACTERS: Record<CharacterId, CharacterSpec> = {
  steady: {
    name: 'Steady',
    line: 'a balanced commander: a sound economy, a measured defence and waves that grow on a steady clock.',
    answer: 'Steady has no single weakness; out-earn it and meet each wave with the counter to what it fields.',
  },
  striker: {
    name: 'Striker',
    line: 'an early aggressor: small, fast waves from the first minutes and little spent on defence.',
    answer: 'Turrets and infantry early blunt a Striker; once its first waves break, its thin defences fall to a counter-attack.',
  },
  bulwark: {
    name: 'Bulwark',
    line: 'a fortress builder: extra turrets and walls, then late, heavy siege waves of artillery and armour.',
    answer: 'A Bulwark gives you time: take the map and the ore early, then crack its defences with artillery or air before its siege is ready.',
  },
  hunter: {
    name: 'Hunter',
    line: 'a raider: fast units hunting your haulers and outlying structures from early on, with smaller main waves.',
    answer: 'Guard the ore line with a turret and a few anti-vehicle units; a Hunter that cannot raid has a weak main army.',
  },
  builder: {
    name: 'Builder',
    line: 'an economist: more Refineries and haulers first, then large waves that grow quickly.',
    answer: 'A Builder is weakest early; pressure it before its economy pays, or match its expansion and out-fight it later.',
  },
};

/** The earliest a Striker's first attack comes (three and a half minutes). */
export const STRIKER_FIRST_FLOOR = 2100;

/** Mixed into the seed for the pick ("CHAR"), so the battle's own stream is never touched. */
const CHARACTER_SALT = 0x43484152;

/** Characters are in play: a skirmish set up with them, never a mission or a planet battle. */
export function charactersOn(s: GameState): boolean {
  return !s.mission && !s.planet && s.setup?.characters === true;
}

/** The character a seat would draw in a battle with this seed text. Pure: the same seed, the same commander. */
export function characterForSeed(seedText: string, owner: Owner): CharacterId {
  let r = (seedFromString(seedText) ^ CHARACTER_SALT) >>> 0;
  // A short walk per seat, so neighbouring seats do not move in step.
  let v = 0;
  for (let i = 0; i <= owner * 3 + 1; i++) {
    const n = next(r);
    r = n.seed;
    v = n.value;
  }
  return CHARACTER_IDS[Math.min(CHARACTER_IDS.length - 1, Math.floor(v * CHARACTER_IDS.length))];
}

/** This side's character, or null when characters are not in play. Side 0 has one only under the harness's autopilot. */
export function characterOf(s: GameState, owner: Owner): CharacterId | null {
  if (!charactersOn(s)) return null;
  if (owner === 0 && !s.autopilot) return null;
  return characterForSeed(s.seedText, owner);
}

/** The difficulty's numbers, adjusted for the side's character. Steady, or no character: `d` itself. */
export function characterSpec(s: GameState, owner: Owner, d: DifficultySpec): DifficultySpec {
  const c = characterOf(s, owner);
  if (!c || c === 'steady') return d;
  return characterAdjust(c, d);
}

/** The adjustment itself, for a known character (the lobby and the tests read it too). */
export function characterAdjust(c: CharacterId, d: DifficultySpec): DifficultySpec {
  const r = Math.round;
  switch (c) {
    case 'striker':
      return {
        ...d,
        // Never before STRIKER_FIRST_FLOOR (or the difficulty's own, if sooner): the guided first battle
        // takes about three minutes on the live battle, and must finish before any first attack.
        firstAttack: Math.min(d.firstAttack, Math.max(STRIKER_FIRST_FLOOR, r(d.firstAttack * 0.6))),
        attackInterval: r(d.attackInterval * 0.75),
        firstWave: Math.max(3, d.firstWave - 2),
        waveGrowth: 1,
        waveCap: Math.max(6, r(d.waveCap * 0.75)),
        turrets: Math.max(1, d.turrets - 1),
      };
    case 'bulwark':
      return {
        ...d,
        firstAttack: r(d.firstAttack * 1.6),
        attackInterval: r(d.attackInterval * 1.25),
        firstWave: d.firstWave + 3,
        waveGrowth: d.waveGrowth + 1,
        waveCap: r(d.waveCap * 1.3),
        turrets: d.turrets + 3,
      };
    case 'hunter':
      return {
        ...d,
        firstAttack: r(d.firstAttack * 0.9),
        waveCap: Math.max(6, r(d.waveCap * 0.85)),
      };
    case 'builder':
      return {
        ...d,
        firstAttack: r(d.firstAttack * 1.35),
        waveGrowth: d.waveGrowth + 1,
        waveCap: r(d.waveCap * 1.3),
        refineries: d.refineries + 1,
      };
    default:
      return d;
  }
}

/** The commander's tactics this file adjusts (a subset of ai.ts's Tactics). */
export interface CharacterTactics {
  extraHaulers: number;
  raidSize: number;
  firstRaid: number;
  raidInterval: number;
  rocketTurrets: number;
  walls: number;
  lateRefineries: number;
}

/** The difficulty's tactics, adjusted for the side's character. Steady, or no character: `t` itself. */
export function characterTactics<T extends CharacterTactics>(s: GameState, owner: Owner, t: T): T {
  const c = characterOf(s, owner);
  if (!c || c === 'steady') return t;
  switch (c) {
    case 'striker':
      return { ...t, walls: 0, rocketTurrets: Math.max(0, t.rocketTurrets - 1), lateRefineries: Math.max(1, t.lateRefineries - 1) };
    case 'bulwark':
      return { ...t, walls: t.walls + 4, rocketTurrets: t.rocketTurrets + 2 };
    case 'hunter': {
      // Easy has no raids of its own: a Hunter at Easy raids with two, on Normal's clock.
      const size = t.raidSize > 0 ? t.raidSize + 2 : 2;
      const first = t.firstRaid > 0 ? t.firstRaid : 4200;
      const every = t.raidInterval > 0 ? t.raidInterval : 2400;
      return { ...t, raidSize: size, firstRaid: Math.round(first * 0.6), raidInterval: Math.round(every * 0.55) };
    }
    case 'builder':
      return { ...t, extraHaulers: t.extraHaulers + 1, lateRefineries: t.lateRefineries + 1 };
    default:
      return t;
  }
}

/** How much each character favours a kind, against the plain mix (1: unchanged). */
const TASTE: Record<Exclude<CharacterId, 'steady'>, Partial<Record<UnitKind, number>>> = {
  striker: { rifleman: 1.5, grenadier: 1.2, buggy: 1.6, raider: 1.4, flametank: 1.2, artillery: 0.5, missilecarrier: 0.6, bastion: 0.3 },
  bulwark: { rocketeer: 1.3, artillery: 2, missilecarrier: 1.5, bastion: 2, buggy: 0.4, raider: 0.5 },
  hunter: { buggy: 2, raider: 2, flametank: 1.2, artillery: 0.7, bastion: 0.5 },
  builder: {},
};

/** Unit weights with the side's taste applied. Steady, or no character: the same array. */
export function characterMix(s: GameState, owner: Owner, choices: [UnitKind, number][]): [UnitKind, number][] {
  const c = characterOf(s, owner);
  if (!c || c === 'steady') return choices;
  const taste = TASTE[c];
  return choices.map(([k, w]) => [k, w * (taste[k] ?? 1)]);
}

/** The log line telling the player what a commander is, once they have met it. */
export function characterNews(s: GameState, owner: Owner): string | null {
  const c = characterOf(s, owner);
  if (!c) return null;
  return `Intelligence: the ${SIDE_NAMES[owner]} commander is a ${CHARACTERS[c].name}, ${CHARACTERS[c].line}`;
}
