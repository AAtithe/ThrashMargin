import { DIFFICULTIES, type Difficulty, type UnitKind } from '../sim/rules';
import type { MissionSpec, TriggerSpec } from '../sim/types';

/**
 * Campaign difficulty: one setting for the whole campaign, chosen on the briefing and changeable
 * between missions. Normal is every mission as written. Easy and Hard adjust a mission's spec before
 * the battle is built, so the briefing, the battle and the checks all read the same numbers, and the
 * written missions stay the single source of truth. Pure.
 *
 * What it changes: the enemy's starting troops and every enemy group a trigger sends, the enemy's
 * credits, the commander's tier (one step down on Easy, one up on Hard, from the mission's own),
 * the player's credits and a mission's overall time limit. A mission may set its own Hard
 * (MissionSpec.hard: the commander's tier, the enemy's credits) where the general one is more than
 * it can bear; four do, each measured by `npm run sweep:fire`. Easy also makes the player's units a
 * quarter tougher (applied with the perks, in missionContext).
 *
 * What it never changes: structures (a bonus such as "destroy 2 Gun Turrets" must stay possible),
 * objective timings and hold or survive durations (the briefings name them in prose), and rewards.
 */

export const CAMPAIGN_LEVELS: Difficulty[] = ['easy', 'normal', 'hard'];

export interface CampaignLevelSpec {
  label: string;
  blurb: string;
  /** Enemy starting troops and triggered groups. */
  enemyUnits: number;
  enemyCredits: number;
  playerCredits: number;
  /** Side 0's unit health, multiplied into the Armour perk. */
  playerHp: number;
  timeLimit: number;
  /** Steps of commander tier from the mission's own: -1, 0 or +1. */
  tier: -1 | 0 | 1;
}

export const CAMPAIGN_LEVEL: Record<Difficulty, CampaignLevelSpec> = {
  easy: {
    label: 'Easy',
    blurb: 'For the story. Smaller garrisons and counter-attacks, more credits, tougher troops, a slower enemy commander.',
    enemyUnits: 0.6,
    enemyCredits: 0.5,
    playerCredits: 1.5,
    playerHp: 1.25,
    timeLimit: 1.5,
    tier: -1,
  },
  normal: {
    label: 'Normal',
    blurb: 'Every mission as written.',
    enemyUnits: 1,
    enemyCredits: 1,
    playerCredits: 1,
    playerHp: 1,
    timeLimit: 1,
    tier: 0,
  },
  hard: {
    label: 'Hard',
    blurb: 'Larger garrisons and counter-attacks, a richer and quicker enemy commander.',
    enemyUnits: 1.15,
    enemyCredits: 1.25,
    playerCredits: 1,
    playerHp: 1,
    timeLimit: 1,
    tier: 1,
  },
};

export function isCampaignLevel(v: unknown): v is Difficulty {
  return typeof v === 'string' && (CAMPAIGN_LEVELS as string[]).includes(v);
}

const TIERS: Difficulty[] = ['easy', 'normal', 'hard'];

/** A count scaled by a level: never below one where there was one, never zero made into more. */
function scaleCount(count: number, f: number): number {
  if (count <= 0) return count;
  return Math.max(1, Math.round(count * f));
}

/** A list like ['rifleman', 'rifleman', 'tank'] with each kind's count scaled, first-seen order kept. */
function scaleUnits(kinds: UnitKind[], f: number): UnitKind[] {
  if (f === 1) return kinds;
  const counts = new Map<UnitKind, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  const out: UnitKind[] = [];
  for (const [k, n] of counts) for (let i = 0; i < scaleCount(n, f); i++) out.push(k);
  return out;
}

function scaleTrigger(t: TriggerSpec, f: number): TriggerSpec {
  if (!t.spawn || t.spawn.owner === 0 || f === 1) return t;
  return { ...t, spawn: { ...t.spawn, count: scaleCount(t.spawn.count, f) } } as TriggerSpec;
}

/** The mission as it is fought at this campaign difficulty. Normal returns the spec itself. */
export function scaleMission(spec: MissionSpec, level: Difficulty): MissionSpec {
  const L = CAMPAIGN_LEVEL[isCampaignLevel(level) ? level : 'normal'];
  if (level === 'normal' || !isCampaignLevel(level)) return spec;
  const stepped = TIERS[Math.max(0, Math.min(TIERS.length - 1, TIERS.indexOf(spec.difficulty in DIFFICULTIES ? spec.difficulty : 'normal') + L.tier))];
  // A mission may set its own Hard (MissionSpec.hard): the commander's tier, the enemy's credits.
  const own = level === 'hard' ? spec.hard : undefined;
  const tier = own?.tier && own.tier in DIFFICULTIES ? own.tier : stepped;
  const enemyCredits = own?.enemyCredits !== undefined && Number.isFinite(own.enemyCredits) && own.enemyCredits > 0 ? own.enemyCredits : L.enemyCredits;
  return {
    ...spec,
    difficulty: tier,
    player: { ...spec.player, credits: Math.round(spec.player.credits * L.playerCredits) },
    enemy: {
      ...spec.enemy,
      credits: Math.round(spec.enemy.credits * enemyCredits),
      units: scaleUnits(spec.enemy.units, L.enemyUnits),
    },
    triggers: spec.triggers.map(t => scaleTrigger(t, L.enemyUnits)),
    ...(spec.timeLimit !== undefined ? { timeLimit: Math.round(spec.timeLimit * L.timeLimit) } : {}),
  };
}
