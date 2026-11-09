import { HERO_KINDS, type HeroKind, type SupportPower } from '../sim/rules';
import type { MissionContext, MissionOutcome, MissionSpec, Perks } from '../sim/types';
import { MISSIONS } from './missions';
import type { CampaignState, HeroRecord, PerkId, PerkSpec } from './types';

/**
 * Commander career, skill tree and hero roster: pure functions over CampaignState.
 * Nothing here mutates its input: every change returns a new object, and a refused change
 * (a perk that cannot be bought) returns the very same object, as the simulation does.
 * See fireline-campaign-design.md section 2.
 */

/** Rank names, lowest first, and the total xp each needs. */
export const RANKS: { name: string; xp: number }[] = [
  { name: 'Lieutenant', xp: 0 },
  { name: 'Captain', xp: 300 },
  { name: 'Major', xp: 800 },
  { name: 'Colonel', xp: 1600 },
  { name: 'Brigadier', xp: 2800 },
  { name: 'General', xp: 4500 },
];

/** Skill points for each rank gained. */
export const POINTS_PER_RANK = 1;
/** Skill points for each mission's first three-star finish. */
export const POINTS_PER_THREE_STARS = 1;
/** Stars that count as a three-star finish. */
export const THREE_STARS = 3;
/** Each star beyond the first adds this share of the mission's reward xp. */
export const XP_PER_EXTRA_STAR = 0.25;
/** Commander xp per enemy unit or structure destroyed in the mission. */
export const XP_PER_KILL = 2;
/** A lost mission still pays this share of its reward xp. */
export const XP_LOSS_SHARE = 0.25;

export const PERKS: PerkSpec[] = [
  { id: 'logistics', branch: 'economy', name: 'Logistics', blurb: '+10% harvest income per level', maxLevel: 3, cost: [1, 1, 2] },
  { id: 'surveyors', branch: 'economy', name: 'Surveyors', blurb: '+500 starting credits per level', maxLevel: 2, cost: [1, 1] },
  { id: 'assembly', branch: 'industry', name: 'Assembly', blurb: '+10% production speed per level', maxLevel: 3, cost: [1, 1, 2] },
  {
    id: 'procurement',
    branch: 'industry',
    name: 'Procurement',
    blurb: '-5% cost of everything per level',
    maxLevel: 2,
    cost: [1, 2],
    requires: { perk: 'assembly', level: 1 },
  },
  { id: 'armour', branch: 'command', name: 'Armour', blurb: '+8% unit health per level', maxLevel: 3, cost: [1, 1, 2] },
  { id: 'recon', branch: 'command', name: 'Recon sweep', blurb: 'Unlocks the Recon sweep support power', maxLevel: 1, cost: [1] },
  {
    id: 'barrage',
    branch: 'command',
    name: 'Artillery barrage',
    blurb: 'Unlocks the Artillery barrage support power',
    maxLevel: 1,
    cost: [2],
    requires: { perk: 'recon', level: 1 },
  },
  {
    id: 'reinforce',
    branch: 'command',
    name: 'Reinforcements',
    blurb: 'Unlocks the Reinforcements support power',
    maxLevel: 1,
    cost: [2],
    requires: { perk: 'barrage', level: 1 },
  },
  {
    id: 'staff',
    branch: 'command',
    name: 'Staff work',
    blurb: '-15% support power cooldowns per level',
    maxLevel: 2,
    cost: [1, 2],
    requires: { perk: 'recon', level: 1 },
  },
];

/** Neutral perks: what a skirmish or a fresh campaign applies. */
export const NO_PERKS: Perks = { harvestMul: 1, buildSpeedMul: 1, costMul: 1, unitHpMul: 1, powerCooldownMul: 1, extraStartCredits: 0 };

/** Which perk unlocks which support power. */
export const POWER_PERKS: { perk: PerkId; power: SupportPower }[] = [
  { perk: 'recon', power: 'recon' },
  { perk: 'barrage', power: 'barrage' },
  { perk: 'reinforce', power: 'reinforce' },
];

export function perkSpec(id: PerkId): PerkSpec {
  const p = PERKS.find(q => q.id === id);
  if (!p) throw new Error(`Unknown perk ${id}`);
  return p;
}

export function perkLevel(c: CampaignState, id: PerkId): number {
  return c.commander.perks[id] ?? 0;
}

const freshHero = (): HeroRecord => ({ unlocked: false, xp: 0, wounded: false });

export function newCampaign(commanderName: string): CampaignState {
  const heroes = {} as Record<HeroKind, HeroRecord>;
  for (const k of HERO_KINDS) heroes[k] = freshHero();
  return {
    version: 1,
    commander: { name: cleanCommander(commanderName), xp: 0, points: 0, perks: {} },
    heroes,
    missions: {},
    tech: [],
    lastMission: null,
  };
}

/** A commander's name as stored: trimmed, at most 40 characters, never empty. */
export function cleanCommander(raw: unknown): string {
  return (typeof raw === 'string' ? raw.trim().slice(0, 40) : '') || 'Commander';
}

/** Index into RANKS for this much xp. */
export function rankFor(xp: number): number {
  let r = 0;
  while (r + 1 < RANKS.length && xp >= RANKS[r + 1].xp) r++;
  return r;
}

/** Xp still needed for the next rank, and how far through this rank the commander is (0..1). */
export function rankProgress(xp: number): { rank: number; next: number | null; fraction: number } {
  const rank = rankFor(xp);
  if (rank + 1 >= RANKS.length) return { rank, next: null, fraction: 1 };
  const lo = RANKS[rank].xp;
  const hi = RANKS[rank + 1].xp;
  return { rank, next: hi - xp, fraction: (xp - lo) / (hi - lo) };
}

export function perkModifiers(c: CampaignState): Perks {
  const l = (id: PerkId) => perkLevel(c, id);
  return {
    harvestMul: 1 + 0.1 * l('logistics'),
    buildSpeedMul: 1 + 0.1 * l('assembly'),
    costMul: 1 - 0.05 * l('procurement'),
    unitHpMul: 1 + 0.08 * l('armour'),
    powerCooldownMul: 1 - 0.15 * l('staff'),
    extraStartCredits: 500 * l('surveyors'),
  };
}

/** Why this perk cannot be bought now, or null if it can. */
export function perkProblem(c: CampaignState, perk: PerkId): string | null {
  const spec = PERKS.find(p => p.id === perk);
  if (!spec) return 'There is no such skill.';
  const level = perkLevel(c, perk);
  if (level >= spec.maxLevel) return `${spec.name} is already at its highest level.`;
  if (spec.requires && perkLevel(c, spec.requires.perk) < spec.requires.level) {
    const req = perkSpec(spec.requires.perk);
    return req.maxLevel > 1 ? `Needs ${req.name} level ${spec.requires.level} first.` : `Needs ${req.name} first.`;
  }
  const cost = spec.cost[level];
  if (c.commander.points < cost) return `Needs ${cost} skill point${cost === 1 ? '' : 's'}; you have ${c.commander.points}.`;
  return null;
}

/** Skill points the next level of this perk costs, or null at its highest level. */
export function perkCost(c: CampaignState, perk: PerkId): number | null {
  const spec = perkSpec(perk);
  const level = perkLevel(c, perk);
  return level >= spec.maxLevel ? null : spec.cost[level];
}

/** Returns a new state with the perk bought; returns the same object if it cannot be bought. */
export function buyPerk(c: CampaignState, perk: PerkId): CampaignState {
  if (perkProblem(c, perk)) return c;
  const level = perkLevel(c, perk);
  const cost = perkSpec(perk).cost[level];
  return {
    ...c,
    commander: { ...c.commander, points: c.commander.points - cost, perks: { ...c.commander.perks, [perk]: level + 1 } },
  };
}

/** True when this mission can be played (the first, or one after a won mission). */
export function missionUnlocked(c: CampaignState, missionId: string): boolean {
  const spec = MISSIONS.find(m => m.id === missionId);
  if (!spec) return false;
  if (spec.order <= 1) return true;
  const prev = MISSIONS.find(m => m.order === spec.order - 1);
  return !!prev && !!c.missions[prev.id]?.won;
}

/** Number of missions won so far. */
export function missionsWon(c: CampaignState): number {
  return MISSIONS.filter(m => c.missions[m.id]?.won).length;
}

/** True once the last mission of the campaign has been won. */
export function campaignComplete(c: CampaignState): boolean {
  const last = MISSIONS[MISSIONS.length - 1];
  return !!last && !!c.missions[last.id]?.won;
}

/**
 * Heroes this mission will field: wanted by the spec and unlocked in the campaign. A mission that
 * introduces a hero (its rewards unlock that hero) fields the hero even before the unlock, which
 * is how the Spy is met in The Quiet Man.
 */
export function heroesFor(c: CampaignState, spec: MissionSpec): HeroKind[] {
  const introduces = spec.rewards.unlockHeroes ?? [];
  return spec.player.heroes.filter(h => c.heroes[h]?.unlocked || introduces.includes(h));
}

export function missionContext(c: CampaignState, spec: MissionSpec, id: string, createdAt: number): MissionContext {
  const heroes: MissionContext['heroes'] = {};
  for (const h of heroesFor(c, spec)) {
    const rec = c.heroes[h] ?? freshHero();
    heroes[h] = { xp: rec.xp, wounded: rec.wounded };
  }
  const extraPowers: SupportPower[] = POWER_PERKS.filter(p => perkLevel(c, p.perk) > 0).map(p => p.power);
  return {
    id,
    name: spec.title,
    createdAt,
    perks: perkModifiers(c),
    heroes,
    extraTech: [...c.tech],
    extraPowers,
  };
}

/** Commander xp a mission outcome is worth (see the constants above). */
export function outcomeXp(spec: MissionSpec, outcome: MissionOutcome): number {
  const base = spec.rewards.xp;
  const kills = Math.max(0, Math.floor(outcome.kills || 0)) * XP_PER_KILL;
  if (!outcome.won) return Math.floor(base * XP_LOSS_SHARE) + kills;
  const extraStars = Math.max(0, outcome.stars - 1);
  return Math.round(base * (1 + XP_PER_EXTRA_STAR * extraStars)) + kills;
}

/** Folds a finished mission into the campaign: xp, rank-ups and skill points, stars, heroes, unlocks. */
export function applyOutcome(c: CampaignState, spec: MissionSpec, outcome: MissionOutcome): CampaignState {
  const gained = outcomeXp(spec, outcome);
  const xp = c.commander.xp + gained;
  const ranksGained = Math.max(0, rankFor(xp) - rankFor(c.commander.xp));

  const prev = c.missions[spec.id] ?? { won: false, stars: 0, bestTicks: null };
  const stars = outcome.won ? outcome.stars : 0;
  const firstThreeStars = outcome.won && stars >= THREE_STARS && prev.stars < THREE_STARS;
  const firstWin = outcome.won && !prev.won;
  const bestTicks = outcome.won
    ? prev.bestTicks === null
      ? outcome.ticks
      : Math.min(prev.bestTicks, outcome.ticks)
    : prev.bestTicks;

  const points = c.commander.points + ranksGained * POINTS_PER_RANK + (firstThreeStars ? POINTS_PER_THREE_STARS : 0);

  // Heroes who fought keep the xp they ended with and are wounded if they fell; the rest rested.
  const heroes = {} as Record<HeroKind, HeroRecord>;
  for (const k of HERO_KINDS) {
    const rec = c.heroes[k] ?? freshHero();
    const fought = outcome.heroes[k];
    heroes[k] = fought
      ? { ...rec, xp: Math.max(rec.xp, Math.floor(fought.xp || 0)), wounded: !fought.alive }
      : rec.wounded
        ? { ...rec, wounded: false }
        : rec;
  }
  if (firstWin) for (const h of spec.rewards.unlockHeroes ?? []) heroes[h] = { ...heroes[h], unlocked: true };

  const tech = [...c.tech];
  if (firstWin) for (const t of spec.rewards.unlockTech ?? []) if (!tech.includes(t)) tech.push(t);

  return {
    ...c,
    commander: { ...c.commander, xp, points },
    heroes,
    missions: {
      ...c.missions,
      [spec.id]: { won: prev.won || outcome.won, stars: Math.max(prev.stars, stars), bestTicks },
    },
    tech,
    lastMission: spec.id,
  };
}
