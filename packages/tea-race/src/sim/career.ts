/**
 * Captain careers: experience, levels and a skill tree. Pure.
 *
 * The RPG layer. A captain earns experience from doing the game well, each level brings a skill
 * point, and the skills change how she plays: a trading captain and a racing captain end the game
 * as different people. Experience is recorded by the reducer at the moment it is earned.
 *
 * Every skill is a modest, legible edge — a point of speed, a few percent off the quay, a cheaper
 * repair — never a new way to win. The comeback term (`XP_CATCH_UP`) exists because levelling is
 * the textbook snowball: the captain trading best earns most experience and so trades better still.
 */
import type { Captain, GameState } from './types';

export type SkillId =
  | 'weatherEye'
  | 'driver'
  | 'navigator'
  | 'haggler'
  | 'factor'
  | 'merchantPrince'
  | 'bosun'
  | 'gunner'
  | 'commodore';

export type Branch = 'seamanship' | 'trade' | 'command';

export interface Skill {
  id: SkillId;
  branch: Branch;
  /** 1 to 3: a skill needs the one before it in its branch. */
  tier: 1 | 2 | 3;
  name: string;
  blurb: string;
}

export const BRANCH_NAMES: Record<Branch, string> = {
  seamanship: 'Seamanship',
  trade: 'Trade',
  command: 'Command',
};

/** AUTHORED — the tree. Three branches of three; each skill needs the one above it. */
export const SKILLS: Skill[] = [
  { id: 'weatherEye', branch: 'seamanship', tier: 1, name: 'Weather eye', blurb: 'Storms set your ships back half as far.' },
  { id: 'driver', branch: 'seamanship', tier: 2, name: 'Driver', blurb: 'Cracking on runs one point further, and no cape adds to the risk.' },
  { id: 'navigator', branch: 'seamanship', tier: 3, name: 'Navigator', blurb: 'Every ship of yours makes a point more on every roll.' },
  { id: 'haggler', branch: 'trade', tier: 1, name: 'Haggler', blurb: 'Every lot you lade costs 4% less.' },
  { id: 'factor', branch: 'trade', tier: 2, name: 'Factor', blurb: 'Owners pay £20 more for every charter you complete.' },
  { id: 'merchantPrince', branch: 'trade', tier: 3, name: 'Merchant prince', blurb: 'First home on a card pays £8 more for every lot landed.' },
  { id: 'bosun', branch: 'command', tier: 1, name: 'Bosun', blurb: 'Repairs cost half, and each ship’s wages £1 less a round.' },
  { id: 'gunner', branch: 'command', tier: 2, name: 'Gunner', blurb: 'Every ship sails as if she carried guns.' },
  { id: 'commodore', branch: 'command', tier: 3, name: 'Commodore', blurb: 'Your owners trust you with a third charter.' },
];

export const SKILL_BY_ID: Record<SkillId, Skill> = Object.fromEntries(SKILLS.map(s => [s.id, s])) as Record<SkillId, Skill>;

/**
 * AUTHORED — experience for what a captain does. Sized so a captain trading steadily reaches about
 * level five or six by the end of a typical game, so the last skills are a late-game prize rather
 * than an opening move.
 */
export const XP_FOR = {
  lotLanded: 2,
  firstHome: 3,
  raceWin: 10,
  raceSecond: 5,
  charter: 6,
  encounter: 2,
  weathered: 1,
} as const;

/**
 * AUTHORED — experience to reach each level; level 1 is where everyone starts.
 *
 * Measured, then doubled. The first table had captains averaging level 3.5 by round 30 and 6.2 by
 * the close, so most owned the whole Seamanship branch — a point of speed on every ship on every
 * roll — long before the late game, and the merchant's game shortened from 90 rounds to 78. A ramp
 * needs the top of the tree to be a late-game prize.
 */
export const LEVEL_XP = [0, 25, 60, 110, 175, 255, 350, 460, 590];
export const MAX_LEVEL = LEVEL_XP.length;

/**
 * AUTHORED — the comeback term: experience is worth this fraction more for every share a captain
 * trails the share leader by. Measured, not guessed; see the design log.
 */
export const XP_CATCH_UP = 0.15;

export const careerOn = (s: GameState): boolean => Boolean(s.hazards?.career) && s.rules === 'classic';

export function levelFor(xp: number | undefined): number {
  let level = 1;
  for (let i = 1; i < LEVEL_XP.length; i++) if ((xp ?? 0) >= LEVEL_XP[i]) level = i + 1;
  return level;
}

/** Experience still needed for the next level, and the span of this one, for a progress bar. */
export function levelProgress(xp: number | undefined): { level: number; into: number; span: number } {
  const level = levelFor(xp);
  if (level >= MAX_LEVEL) return { level, into: 1, span: 1 };
  const floor = LEVEL_XP[level - 1];
  return { level, into: (xp ?? 0) - floor, span: LEVEL_XP[level] - floor };
}

export const hasSkill = (c: Captain | undefined, id: SkillId): boolean => Boolean(c?.skills?.includes(id));

/** Points to spend: one per level above the first, less those already spent. */
export const skillPoints = (c: Captain): number => levelFor(c.xp) - 1 - (c.skills?.length ?? 0);

export function canLearn(c: Captain, id: SkillId): boolean {
  const skill = SKILL_BY_ID[id];
  if (!skill || hasSkill(c, id) || skillPoints(c) <= 0) return false;
  if (skill.tier === 1) return true;
  const prior = SKILLS.find(s => s.branch === skill.branch && s.tier === skill.tier - 1)!;
  return hasSkill(c, prior.id);
}

/** Experience actually earned, with the comeback term for a captain behind on shares. */
export function xpEarned(base: number, shares: number, leaderShares: number): number {
  return Math.round(base * (1 + XP_CATCH_UP * Math.max(0, leaderShares - shares)));
}

/** AUTHORED — the numbers behind the skills, kept here so the blurbs and the rules cannot drift. */
export const SKILL_EFFECT = {
  weatherEyeStorm: 0.5,
  driverBonus: 1,
  navigatorBonus: 1,
  hagglerDiscount: 0.04,
  factorBonus: 20,
  merchantPrincePerLot: 8,
  bosunRepair: 0.5,
  bosunWagesPerShip: 1,
} as const;

/** What a repair costs this captain. */
export const repairPriceFor = (c: Captain | undefined, base: number): number =>
  hasSkill(c, 'bosun') ? Math.round(base * SKILL_EFFECT.bosunRepair) : base;
