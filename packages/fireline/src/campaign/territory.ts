import type { BuildingKind, Difficulty, UnitKind } from '../sim/rules';
import { seedFromString, stream } from '../sim/rng';
import type { MissionOutcome, MissionSpec, ObjectiveSpec } from '../sim/types';
import { ACT_TWO } from './act2';
import { MISSIONS, missionById } from './missions';
import { missionsWon, missionUnlocked, outcomeXp, POINTS_PER_RANK, rankFor } from './progression';
import { regionById, theatreRegions, type RegionControl, type TheatreRegion, type TheatreView } from './theatre';
import type { CampaignState, MissionRecord } from './types';

/**
 * Territory and engagements: who holds each region of the theatre, and the side battles fought for
 * the regions no story mission is set in. Pure: no DOM, no clock, no Math.random. Every roll that
 * shapes an engagement comes from a stream seeded on the region's id, so a region offers the same
 * battle every time it is opened at the same point of the campaign.
 *
 * A region is held when it is home ground, when its story mission is won, or when its engagement is
 * won. It is open (enemy ground with a battle the player can fight now) when it is not held, has no
 * story mission, its act's front is reachable, and it borders a held region. Everything else is
 * enemy ground. See fireline-campaign-design.md section 11.
 *
 * Engagements never unlock tech or heroes, and never count as missions won: the campaign's length,
 * its "N of 14" and its victory are the story missions alone.
 */

const MIN = 600;

/** Prefix that marks a battle's mission id as an engagement: `eng:<regionId>`. */
export const ENGAGEMENT_PREFIX = 'eng:';

export const engagementId = (regionId: string): string => `${ENGAGEMENT_PREFIX}${regionId}`;
export const isEngagementId = (id: string | null | undefined): boolean => typeof id === 'string' && id.startsWith(ENGAGEMENT_PREFIX);
/** The region an engagement's mission id names, or undefined for anything else. */
export function regionOfEngagement(id: string | null | undefined): TheatreRegion | undefined {
  if (!isEngagementId(id)) return undefined;
  const r = regionById(id!.slice(ENGAGEMENT_PREFIX.length));
  return r && isEngagementRegion(r) ? r : undefined;
}

/** A region that holds an engagement: not home, no story mission. */
export const isEngagementRegion = (r: TheatreRegion): boolean => !r.home && !r.missionId;

/** True once this act's front can be fought on: act one always, act two once its first mission opens. */
export function actReachable(c: CampaignState, act: 0 | 1): boolean {
  if (act === 0) return true;
  const first = ACT_TWO[0];
  return !!first && missionUnlocked(c, first.id);
}

function heldRegion(c: CampaignState, r: TheatreRegion): boolean {
  if (r.home) return true;
  if (r.missionId) return !!c.missions[r.missionId]?.won;
  return !!c.engagements?.[r.id]?.won;
}

/** Who holds this region now. Unknown ids read as enemy ground. */
export function regionControl(c: CampaignState, regionId: string): RegionControl {
  const r = regionById(regionId);
  if (!r) return 'enemy';
  if (heldRegion(c, r)) return 'held';
  if (r.missionId || !actReachable(c, r.act)) return 'enemy';
  return r.neighbours.some(n => {
    const nr = regionById(n);
    return !!nr && heldRegion(c, nr);
  })
    ? 'open'
    : 'enemy';
}

/** Regions held, of all regions in the theatre. */
export function territoryHeld(c: CampaignState): { held: number; total: number } {
  const all = theatreRegions();
  return { held: all.filter(r => heldRegion(c, r)).length, total: all.length };
}

/** Engagement regions the player can fight now, in theatre order; one act's only when `act` is given. */
export function openEngagements(c: CampaignState, act?: 0 | 1): TheatreRegion[] {
  return theatreRegions().filter(r => isEngagementRegion(r) && (act === undefined || r.act === act) && regionControl(c, r.id) === 'open');
}

/** Why this region's engagement cannot be deployed now, or null. A won engagement may be fought again. */
export function engagementProblem(c: CampaignState, regionId: string): string | null {
  const r = regionById(regionId);
  if (!r) return 'There is no such region.';
  if (r.home) return 'Home ground: there is no one here to fight.';
  if (r.missionId) return 'A story mission is fought here.';
  if (c.engagements?.[r.id]?.won) return null;
  if (!actReachable(c, r.act)) return 'This front opens with act two.';
  if (regionControl(c, r.id) !== 'open') return 'Take a neighbouring region first.';
  return null;
}

/** Everything the theatre map draws. Missions and engagements of both acts; `act` is the one in focus. */
export function theatreView(c: CampaignState, act: 0 | 1, selected?: string): TheatreView {
  const regions = theatreRegions();
  const control: Record<string, RegionControl> = {};
  for (const r of regions) control[r.id] = regionControl(c, r.id);
  const missions: TheatreView['missions'] = [];
  for (const m of [...MISSIONS].sort((a, b) => a.order - b.order)) {
    const r = regions.find(x => x.missionId === m.id);
    if (!r) continue;
    const rec = c.missions[m.id];
    missions.push({
      id: m.id,
      order: m.order,
      title: m.title,
      regionId: r.id,
      state: rec?.won ? 'won' : missionUnlocked(c, m.id) ? 'open' : 'locked',
      stars: rec?.stars ?? 0,
      maxStars: 1 + m.bonus.length,
    });
  }
  const engagements: TheatreView['engagements'] = regions.filter(isEngagementRegion).map(r => {
    const rec = c.engagements?.[r.id];
    return { regionId: r.id, state: rec?.won ? 'won' : control[r.id] === 'open' ? 'open' : 'locked', stars: rec?.stars ?? 0 };
  });
  return { act, control, missions, engagements, ...(selected && regionById(selected) ? { selected } : {}) };
}

// ---- Engagement battles -------------------------------------------------------------------------

/** What every base engagement of an act offers, on top of whatever the campaign has unlocked. */
export const ACT_BASICS: Record<0 | 1, (BuildingKind | UnitKind)[]> = {
  // First Light's list: the campaign's opening tech.
  0: ['power', 'refinery', 'barracks', 'turret', 'rifleman', 'rocketeer'],
  // What every base mission of act two offers.
  1: ['power', 'refinery', 'barracks', 'factory', 'turret', 'uplink', 'rifleman', 'rocketeer', 'hauler', 'buggy', 'tank', 'artillery'],
};

/** Enemy troops an engagement may field, if the campaign has met them. No air: outposts have no Helipad. */
const ENEMY_INFANTRY: UnitKind[] = ['rifleman', 'rifleman', 'rocketeer', 'grenadier'];
const ENEMY_VEHICLES: UnitKind[] = ['buggy', 'tank', 'tank', 'artillery', 'flametank', 'missilecarrier'];

const round = (v: number, to: number) => Math.round(v / to) * to;

/**
 * The side battle for an engagement region: a skirmish-sized base battle, rolled from the region's
 * id and scaled by its act and by the story missions won so far. Undefined for home ground, a story
 * mission's region, or an unknown id. Build it as a mission: campaignMission(c, spec) for the
 * campaign difficulty, then createMissionState with missionContext.
 *
 * Rolled: the map (from the seed), the garrison's size and mix, the outpost's layout (or a whole
 * Combine base later on), how the enemy commander behaves, both sides' credits and one or two bonus
 * objectives. Fixed: destroy everything to win, no time limit, no heroes, no scripted waves, and no
 * point on the map named by hand, so nothing depends on where the generator put the ground.
 */
export function engagementSpec(c: CampaignState, regionId: string): MissionSpec | undefined {
  const r = regionById(regionId);
  if (!r || !isEngagementRegion(r)) return undefined;
  const rng = stream(seedFromString(`engagement:${r.id}`));
  const roll = (p: number) => rng.float() < p;
  const pick = <T>(list: T[]): T => list[Math.floor(rng.float() * list.length)];

  // Progress: story missions won, but never less than where this act's front starts.
  const p = Math.max(missionsWon(c), r.act === 1 ? 8 : 0);
  const basics = ACT_BASICS[r.act];
  const allowed = new Set<BuildingKind | UnitKind>([...basics, ...c.tech]);
  const has = (k: BuildingKind | UnitKind) => allowed.has(k);

  // The enemy's base: an outpost, or from the fourth mission on, sometimes a whole Combine base.
  const full = p >= 3 && roll(Math.min(0.55, 0.25 + 0.03 * p));
  const structures: BuildingKind[] = full ? ['power', 'refinery', 'barracks'] : ['power', 'barracks'];
  if (full && has('factory')) structures.push('factory');
  if (full && p >= 6) structures.push('power');
  if (!full && roll(0.5)) structures.push('refinery');
  if (!full && has('factory') && p >= 2 && roll(0.45)) structures.push('factory');
  if (has('uplink') && roll(0.3)) structures.push('uplink');
  const turrets = Math.min(4, 1 + rng.int(0, 1 + Math.floor(p / 4)));
  for (let i = 0; i < turrets; i++) structures.push(has('rocketturret') && i === turrets - 1 && roll(0.5) ? 'rocketturret' : 'turret');
  if (has('wall') && roll(0.25)) structures.push('wall', 'wall');

  // How it fights: an outpost holds or sits still, or raids once it can train; a base defends or attacks.
  const trains = structures.includes('barracks') || structures.includes('factory');
  // (A whole base on the attack beat a player still raising one far too often, so a base only
  // defends, and an outpost raids on a small purse.)
  const ai: MissionSpec['enemy']['ai'] = full
    ? 'defend'
    : trains && p >= 3 && roll(0.25) ? 'raid' : roll(0.5) ? 'defend' : 'passive';
  const enemyCredits = full ? round(800 + 120 * p + rng.int(0, 2) * 250, 100) : ai === 'raid' ? round(400 + 100 * p, 100) : ai === 'defend' ? 500 : 0;

  // The garrison: more of it, and more of it armour, as the campaign goes on.
  const infantry = ENEMY_INFANTRY.filter(has);
  const vehicles = ENEMY_VEHICLES.filter(has);
  // A raiding outpost sends its garrison at us early, so it starts with fewer at home.
  const garrison = Math.min(18, 3 + Math.round(0.8 * p) + rng.int(0, 2) - (full ? 2 : 0) - (ai === 'raid' ? Math.round(p / 3) : 0));
  const armourShare = Math.min(0.6, 0.15 + 0.05 * p);
  const units: UnitKind[] = [];
  for (let i = 0; i < garrison; i++) units.push(vehicles.length && roll(armourShare) ? pick(vehicles) : pick(infantry.length ? infantry : ['rifleman']));

  // Our side: a Command Yard, a few troops and the credits to raise a base.
  const ours: UnitKind[] = Array.from({ length: 3 + rng.int(0, 2) }, () => 'rifleman' as UnitKind);
  if (p >= 1) ours.push('rocketeer');
  if (has('grenadier')) ours.push('grenadier', 'grenadier');
  if (has('tank')) for (let i = 0, n = rng.int(0, 1) + Math.floor(p / 3); i < n; i++) ours.push('tank');
  const credits = round(3500 + 200 * p + rng.int(0, 2) * 500, 100);

  // One or two bonus objectives, none of them done by winning alone.
  const turretCount = structures.filter(b => b === 'turret').length;
  const pool: ObjectiveSpec[] = [
    { kind: 'build', building: 'refinery', count: 2 },
    { kind: 'harvest', credits: round(2500 + 250 * p, 500) },
    { kind: 'build', building: 'turret', count: 2 },
  ];
  if (turretCount > 0) pool.push({ kind: 'destroyWithin', building: 'turret', count: turretCount, ticks: (full ? 14 : 9) * MIN });
  const bonus: ObjectiveSpec[] = [];
  for (let n = p >= 4 && roll(0.5) ? 2 : 1; bonus.length < n && pool.length; ) bonus.push(pool.splice(Math.floor(rng.float() * pool.length), 1)[0]);

  const what = full ? 'base' : 'outpost';
  const place = r.kind === 'city' ? 'the city' : 'the province';
  const held = [
    `The Combine holds ${r.name} with ${full ? 'a whole base: a Command Yard that builds and rebuilds' : `an outpost of ${structures.length} structures`}, and ${garrison} troops in ${place}.`,
    ai === 'raid'
      ? 'Patrols report raiding parties sent out from it on a timer. Expect company before you are ready.'
      : ai === 'defend'
        ? 'It is dug in and will fight for every structure, but it is not sending anyone out.'
        : 'It is quiet: the garrison stands its ground and makes no plans.',
  ];
  const tier: Difficulty = p < 2 ? 'easy' : 'normal';

  return {
    id: engagementId(r.id),
    order: 0,
    title: r.name,
    briefing: [
      ...held,
      full
        ? `Raise a base, bring down its Command Yard${structures.includes('factory') ? ' and its War Factory' : ''}, and ${r.name} flies Meridian colours.`
        : `Raise a base, clear every Combine unit and structure from ${r.name}, and the ${r.kind === 'city' ? 'city' : 'province'} flies Meridian colours.`,
    ],
    summary: `Clear the Combine ${what} from the ${r.kind === 'city' ? 'city' : 'province'}.`,
    seed: `eng-${r.id}`.slice(0, 64),
    difficulty: tier,
    player: { credits, structures: ['hq'], units: ours, heroes: [] },
    enemy: { credits: enemyCredits, base: full ? 'full' : 'outpost', structures, units, ai },
    tech: [...basics],
    powers: [],
    // An outpost is cleared to the last rifleman; a base is broken when its Command Yard and its
    // factories are down (it rebuilds everything else, and hunting its last harvester is no battle).
    objectives: full
      ? [
          { kind: 'destroy', building: 'hq', count: 1 },
          ...(structures.includes('factory') ? [{ kind: 'destroy', building: 'factory', count: 1 } as ObjectiveSpec] : []),
        ]
      : [{ kind: 'destroyAll' }],
    bonus,
    triggers: [],
    rewards: { xp: engagementXp(p) },
  };
}

/** About half a story mission's reward: half of the next mission's, at this much progress. */
function engagementXp(progress: number): number {
  const next = MISSIONS[Math.min(MISSIONS.length - 1, Math.max(0, progress))];
  return Math.max(25, round((next?.rewards.xp ?? 150) / 2, 5));
}

/** The spec a battle was built from: a story mission, or an engagement rebuilt from its region. */
export function battleSpec(c: CampaignState, missionId: string | null | undefined): MissionSpec | undefined {
  if (!missionId) return undefined;
  const r = regionOfEngagement(missionId);
  return r ? engagementSpec(c, r.id) : missionById(missionId);
}

/**
 * Folds a finished engagement into the campaign: xp (with rank-ups and their skill points) and the
 * region's record. No tech, no heroes, no three-star skill point, and the story missions untouched.
 * Returns the same object for a region that holds no engagement or could not have been fought.
 */
export function applyEngagementOutcome(c: CampaignState, regionId: string, outcome: MissionOutcome): CampaignState {
  if (engagementProblem(c, regionId)) return c;
  const spec = engagementSpec(c, regionId);
  if (!spec) return c;
  const xp = c.commander.xp + outcomeXp(spec, outcome);
  const ranksGained = Math.max(0, rankFor(xp) - rankFor(c.commander.xp));
  const prev: MissionRecord = c.engagements?.[regionId] ?? { won: false, stars: 0, bestTicks: null };
  const stars = outcome.won ? Math.max(0, Math.floor(outcome.stars)) : 0;
  const bestTicks = outcome.won ? (prev.bestTicks === null ? outcome.ticks : Math.min(prev.bestTicks, outcome.ticks)) : prev.bestTicks;
  return {
    ...c,
    commander: { ...c.commander, xp, points: c.commander.points + ranksGained * POINTS_PER_RANK },
    engagements: { ...(c.engagements ?? {}), [regionId]: { won: prev.won || outcome.won, stars: Math.max(prev.stars, stars), bestTicks } },
  };
}
