/**
 * Fireline campaign check: the Commander's career maths, the save helpers, and every mission spec
 * validated against the map its seed generates. Once the simulation builds missions, each one is
 * started and run for 2,000 ticks.
 *
 *   npx tsx scripts/campaign-check.ts
 *
 * Exits non-zero on any failure. See fireline-campaign-design.md section 8.
 */
import {
  applyOutcome,
  buyPerk,
  campaignComplete,
  heroesFor,
  missionContext,
  missionsWon,
  missionUnlocked,
  newCampaign,
  NO_PERKS,
  outcomeXp,
  campaignMission,
  perkModifiers,
  perkProblem,
  setCampaignLevel,
  PERKS,
  POINTS_PER_RANK,
  rankFor,
  rankProgress,
  RANKS,
} from '../src/campaign/progression';
import { CAMPAIGN_LEVEL, CAMPAIGN_LEVELS, scaleMission } from '../src/campaign/difficulty';
import { missionById, MISSIONS } from '../src/campaign/missions';
import {
  campaignSaveStatus,
  campaignSaveTurn,
  CAMPAIGN_LENGTH,
  isCampaignSave,
  migrateCampaignSave,
  newCampaignSave,
} from '../src/campaign/save';
import type { CampaignState, PerkId, PerkSpec } from '../src/campaign/types';
import { processAction } from '../src/sim/actions';
import { generateMap, isWalkable } from '../src/sim/map';
import { abilityProblem, createMissionState } from '../src/sim/mission';
import { BASE_PLANS, campaignAt, planName, playAceOfSpades, playBase, playEngagement, playQuietMan } from './campaign-player';
import { regionById, theatreRegions } from '../src/campaign/theatre';
import {
  ACT_BASICS,
  actReachable,
  applyEngagementOutcome,
  battleSpec,
  engagementProblem,
  engagementSpec,
  isEngagementId,
  isEngagementRegion,
  openEngagements,
  regionControl,
  regionOfEngagement,
  territoryHeld,
  theatreView,
} from '../src/campaign/territory';
import { distToBuilding } from '../src/sim/grid';
import { seedFromString } from '../src/sim/rng';
import {
  BUILDINGS,
  DIFFICULTIES,
  HERO_ABILITY,
  HERO_KINDS,
  MAP_H,
  MAP_W,
  POWERS,
  UNITS,
  type BuildingKind,
  type HeroKind,
  type UnitKind,
} from '../src/sim/rules';
import { createInitialState } from '../src/sim/state';
import type { GameState, MissionOutcome, MissionSpec, ObjectiveSpec } from '../src/sim/types';

const MIN = 600;

let assertions = 0;
let failures = 0;
const sections: { name: string; assertions: number; failures: number; note?: string }[] = [];
function ok(cond: unknown, what: string): void {
  assertions++;
  if (!cond) {
    failures++;
    if (failures <= 60) console.error(`  FAIL: ${what}`);
  }
}
function section(name: string, body: () => string | void): void {
  const a0 = assertions;
  const f0 = failures;
  let note: string | void = undefined;
  try {
    note = body();
  } catch (err) {
    failures++;
    console.error(`  FAIL: ${name} threw: ${(err as Error).stack ?? err}`);
  }
  sections.push({ name, assertions: assertions - a0, failures: failures - f0, note: note || undefined });
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

const outcome = (spec: MissionSpec, o: Partial<MissionOutcome>): MissionOutcome => ({
  missionId: spec.id,
  won: true,
  stars: 1,
  ticks: 6000,
  kills: 0,
  losses: 0,
  heroes: {},
  ...o,
});

/** A campaign with this many points to spend and nothing else changed. */
const withPoints = (c: CampaignState, points: number): CampaignState => ({ ...c, commander: { ...c.commander, points } });

// ---- Ranks -----------------------------------------------------------------------------------
section('ranks', () => {
  const want = [
    ['Lieutenant', 0],
    ['Captain', 300],
    ['Major', 800],
    ['Colonel', 1600],
    ['Brigadier', 2800],
    ['General', 4500],
  ] as const;
  ok(RANKS.length === want.length, 'six ranks');
  want.forEach(([name, xp], i) => {
    ok(RANKS[i]?.name === name && RANKS[i]?.xp === xp, `rank ${i} is ${name} at ${xp}`);
    ok(rankFor(xp) === i, `rankFor(${xp}) = ${i}`);
    if (xp > 0) ok(rankFor(xp - 1) === i - 1, `rankFor(${xp - 1}) = ${i - 1}`);
  });
  ok(rankFor(999999) === RANKS.length - 1, 'rank caps at General');
  ok(rankFor(-5) === 0, 'negative xp is a Lieutenant');
  const p = rankProgress(550);
  ok(p.rank === 1 && p.next === 250 && near(p.fraction, 0.5), 'halfway from Captain to Major');
  ok(rankProgress(5000).next === null && rankProgress(5000).fraction === 1, 'General has no next rank');
});

// ---- New campaign ----------------------------------------------------------------------------
section('new campaign', () => {
  const c = newCampaign('  Ada Vance  ');
  ok(c.version === 1, 'version 1');
  ok(c.commander.name === 'Ada Vance', 'commander name trimmed');
  ok(newCampaign('').commander.name === 'Commander', 'empty name falls back');
  ok(newCampaign('x'.repeat(80)).commander.name.length === 40, 'name capped at 40');
  ok(c.commander.xp === 0 && c.commander.points === 0 && Object.keys(c.commander.perks).length === 0, 'fresh commander');
  for (const h of HERO_KINDS) ok(c.heroes[h] && !c.heroes[h].unlocked && c.heroes[h].xp === 0 && !c.heroes[h].wounded, `${h} locked`);
  ok(Object.keys(c.missions).length === 0 && c.tech.length === 0 && c.lastMission === null, 'no missions, tech or last mission');
  const m = perkModifiers(c);
  ok(JSON.stringify(m) === JSON.stringify(NO_PERKS), 'a fresh campaign applies neutral perks');
});

// ---- Perks -----------------------------------------------------------------------------------
section('perks', () => {
  const want: Record<PerkId, { branch: string; max: number; req?: [PerkId, number] }> = {
    logistics: { branch: 'economy', max: 3 },
    surveyors: { branch: 'economy', max: 2 },
    assembly: { branch: 'industry', max: 3 },
    procurement: { branch: 'industry', max: 2, req: ['assembly', 1] },
    armour: { branch: 'command', max: 3 },
    recon: { branch: 'command', max: 1 },
    barrage: { branch: 'command', max: 1, req: ['recon', 1] },
    reinforce: { branch: 'command', max: 1, req: ['barrage', 1] },
    staff: { branch: 'command', max: 2, req: ['recon', 1] },
  };
  ok(PERKS.length === Object.keys(want).length, 'nine perks');
  ok(new Set(PERKS.map(p => p.id)).size === PERKS.length, 'perk ids unique');
  for (const p of PERKS) {
    const w = want[p.id];
    ok(!!w, `${p.id} expected`);
    if (!w) continue;
    ok(p.branch === w.branch, `${p.id} in ${w.branch}`);
    ok(p.maxLevel === w.max, `${p.id} has ${w.max} levels`);
    ok(p.cost.length === p.maxLevel && p.cost.every(n => Number.isInteger(n) && n > 0), `${p.id} has a positive cost per level`);
    ok(p.name.length > 0 && p.blurb.length > 0, `${p.id} has a name and blurb`);
    if (w.req) ok(p.requires?.perk === w.req[0] && p.requires.level === w.req[1], `${p.id} needs ${w.req[0]} ${w.req[1]}`);
    else ok(!p.requires, `${p.id} has no requirement`);
  }

  // Each perk on its own: requirements, points and the level cap, refusals returning the same object.
  for (const p of PERKS) {
    let c = withPoints(newCampaign('T'), 0);
    if (p.requires) {
      const rich = withPoints(c, 99);
      const refused = deepFreeze(rich);
      ok(perkProblem(refused, p.id)?.startsWith('Needs'), `${p.id}: refused without ${p.requires.perk}`);
      ok(buyPerk(refused, p.id) === refused, `${p.id}: refusal returns the same object (requirement)`);
      // Meet the chain of requirements.
      c = rich;
      const chain: PerkId[] = [];
      for (let r: PerkSpec['requires'] = p.requires; r; r = PERKS.find(q => q.id === r!.perk)!.requires) chain.unshift(r.perk);
      for (const id of chain) c = buyPerk(c, id);
      c = withPoints(c, 0);
      ok(perkProblem(c, p.id) !== null, `${p.id}: requirement met but no points`);
    }
    const broke = deepFreeze(c);
    ok(buyPerk(broke, p.id) === broke, `${p.id}: refusal returns the same object (points)`);
    c = withPoints(c, p.cost.reduce((a, b) => a + b, 0));
    for (let level = 0; level < p.maxLevel; level++) {
      const before = deepFreeze(c);
      const snapshot = JSON.stringify(before);
      ok(perkProblem(before, p.id) === null, `${p.id}: level ${level + 1} can be bought`);
      const after = buyPerk(before, p.id);
      ok(after !== before, `${p.id}: buying returns a new object`);
      ok(JSON.stringify(before) === snapshot, `${p.id}: buying does not mutate its input`);
      ok(after.commander.perks[p.id] === level + 1, `${p.id}: now level ${level + 1}`);
      ok(after.commander.points === before.commander.points - p.cost[level], `${p.id}: level ${level + 1} costs ${p.cost[level]}`);
      c = after;
    }
    ok(c.commander.points === 0, `${p.id}: exactly the listed costs were spent`);
    const maxed = deepFreeze(withPoints(c, 99));
    ok(perkProblem(maxed, p.id)?.includes('highest'), `${p.id}: refused at the highest level`);
    ok(buyPerk(maxed, p.id) === maxed, `${p.id}: refusal returns the same object (max level)`);
  }
  ok(perkProblem(newCampaign('T'), 'nonsense' as PerkId) !== null, 'unknown perk refused');

  // Everything bought: the modifiers.
  let all = withPoints(newCampaign('T'), 999);
  for (let pass = 0; pass < 4; pass++) for (const p of PERKS) all = buyPerk(all, p.id);
  for (const p of PERKS) ok(all.commander.perks[p.id] === p.maxLevel, `${p.id} maxed in the full tree`);
  const total = PERKS.reduce((a, p) => a + p.cost.reduce((x, y) => x + y, 0), 0);
  ok(all.commander.points === 999 - total, `the full tree costs ${total}`);
  const m = perkModifiers(all);
  ok(near(m.harvestMul, 1.3), 'Logistics 3: +30% harvest');
  ok(near(m.buildSpeedMul, 1.3), 'Assembly 3: +30% production speed');
  ok(near(m.costMul, 0.9), 'Procurement 2: -10% cost');
  ok(near(m.unitHpMul, 1.24), 'Armour 3: +24% unit health');
  ok(near(m.powerCooldownMul, 0.7), 'Staff work 2: -30% power cooldowns');
  ok(m.extraStartCredits === 1000, 'Surveyors 2: +1000 credits');
  const one = perkModifiers({ ...newCampaign('T'), commander: { ...newCampaign('T').commander, perks: { logistics: 1, armour: 2 } } });
  ok(near(one.harvestMul, 1.1) && near(one.unitHpMul, 1.16) && near(one.costMul, 1), 'partial levels scale linearly');
  return `full tree ${total} points`;
});

// ---- Missions unlocking, heroes and context --------------------------------------------------
section('unlocks, heroes and mission context', () => {
  const c0 = newCampaign('T');
  ok(missionUnlocked(c0, MISSIONS[0].id), 'mission 1 is always open');
  for (const m of MISSIONS.slice(1)) ok(!missionUnlocked(c0, m.id), `${m.id} locked at the start`);
  ok(!missionUnlocked(c0, 'no-such-mission'), 'unknown mission locked');
  const lost = applyOutcome(c0, MISSIONS[0], outcome(MISSIONS[0], { won: false, stars: 0 }));
  ok(!missionUnlocked(lost, MISSIONS[1].id), 'a lost mission 1 does not open mission 2');
  const won = applyOutcome(c0, MISSIONS[0], outcome(MISSIONS[0], {}));
  ok(missionUnlocked(won, MISSIONS[1].id), 'winning mission 1 opens mission 2');
  ok(!missionUnlocked(won, MISSIONS[2].id), 'but not mission 3');

  const m2 = missionById('quiet-man')!;
  const m7 = missionById('blackout')!;
  ok(JSON.stringify(heroesFor(c0, m2)) === '["spy"]', 'The Quiet Man fields the Spy it introduces');
  ok(heroesFor(c0, m7).length === 0, 'Blackout fields no locked heroes');
  const spyOpen: CampaignState = { ...c0, heroes: { ...c0.heroes, spy: { unlocked: true, xp: 120, wounded: true } } };
  ok(JSON.stringify(heroesFor(spyOpen, m7)) === '["spy"]', 'Blackout fields the unlocked Spy only');

  let rich = withPoints({ ...spyOpen, tech: ['factory', 'tank'] }, 9);
  rich = buyPerk(buyPerk(buyPerk(rich, 'recon'), 'barrage'), 'surveyors');
  const frozen = deepFreeze(rich);
  const ctx = missionContext(frozen, m7, 'abc', 1234);
  ok(ctx.id === 'abc' && ctx.createdAt === 1234 && ctx.name === m7.title, 'context id, time and name');
  ok(ctx.perks.extraStartCredits === 500, 'context carries perks');
  ok(JSON.stringify(ctx.heroes) === JSON.stringify({ spy: { xp: 120, wounded: true } }), 'context carries hero xp and wounds');
  ok(JSON.stringify(ctx.extraTech) === '["factory","tank"]' && ctx.extraTech !== frozen.tech, 'context copies campaign tech');
  ok(JSON.stringify(ctx.extraPowers) === '["recon","barrage"]', 'context grants powers from perks');
  ok(missionContext(c0, MISSIONS[0], 'x', 0).extraPowers.length === 0, 'no powers without perks');
});

// ---- Outcomes --------------------------------------------------------------------------------
section('applying outcomes', () => {
  const m1 = MISSIONS[0];
  const m2 = missionById('quiet-man')!;
  const c0 = deepFreeze(newCampaign('T'));
  const snapshot = JSON.stringify(c0);

  const w1 = applyOutcome(c0, m1, outcome(m1, { stars: 1, kills: 10, ticks: 9000 }));
  ok(JSON.stringify(c0) === snapshot, 'applyOutcome does not mutate its input');
  ok(w1.commander.xp === m1.rewards.xp + 20, 'win, one star: reward plus 2 per kill');
  ok(w1.missions[m1.id].won && w1.missions[m1.id].stars === 1 && w1.missions[m1.id].bestTicks === 9000, 'mission recorded');
  ok(w1.lastMission === m1.id, 'last mission recorded');
  for (const t of m1.rewards.unlockTech ?? []) ok(w1.tech.includes(t), `first win unlocks ${t}`);

  const w3 = applyOutcome(c0, m1, outcome(m1, { stars: 3, kills: 0, ticks: 8000 }));
  ok(w3.commander.xp === Math.round(m1.rewards.xp * 1.5), 'three stars: +25% per star beyond the first');
  ok(outcomeXp(m1, outcome(m1, { stars: 2 })) === Math.round(m1.rewards.xp * 1.25), 'two stars: +25%');
  ok(w3.commander.points === 1, 'first three-star finish: one point (no rank yet)');
  const again = applyOutcome(w3, m1, outcome(m1, { stars: 3, ticks: 7000 }));
  ok(again.commander.points === w3.commander.points + (rankFor(again.commander.xp) - rankFor(w3.commander.xp)), 'second three-star finish: no extra point');
  ok(again.missions[m1.id].bestTicks === 7000, 'faster win improves best time');
  const slower = applyOutcome(again, m1, outcome(m1, { stars: 1, ticks: 9999 }));
  ok(slower.missions[m1.id].bestTicks === 7000 && slower.missions[m1.id].stars === 3, 'worse replay keeps best stars and time');
  ok(slower.tech.length === again.tech.length, 'replay does not unlock tech twice');

  const l = applyOutcome(c0, m1, outcome(m1, { won: false, stars: 0, kills: 4 }));
  ok(l.commander.xp === Math.floor(m1.rewards.xp / 4) + 8, 'loss: a quarter of the reward plus kills');
  ok(!l.missions[m1.id].won && l.missions[m1.id].stars === 0 && l.missions[m1.id].bestTicks === null, 'loss recorded, no time');
  ok(l.tech.length === 0, 'loss unlocks nothing');
  const lostAfterWin = applyOutcome(w1, m1, outcome(m1, { won: false, stars: 2 }));
  ok(lostAfterWin.missions[m1.id].won && lostAfterWin.missions[m1.id].stars === 1, 'a later loss keeps the earlier win');

  // Rank-ups give points.
  const nearCaptain = { ...c0, commander: { ...c0.commander, xp: 290 } };
  const up = applyOutcome(nearCaptain, m1, outcome(m1, { stars: 1 }));
  ok(rankFor(up.commander.xp) === 1 && up.commander.points === POINTS_PER_RANK, 'rank-up to Captain gives a point');
  const big = { ...c0, commander: { ...c0.commander, xp: 0 } };
  const jump = applyOutcome(big, { ...m1, rewards: { xp: 1700 } }, outcome(m1, { stars: 1 }));
  ok(rankFor(jump.commander.xp) === 3 && jump.commander.points === 3, 'three ranks at once give three points');

  // Heroes.
  const withSpy = applyOutcome(c0, m2, outcome(m2, { heroes: { spy: { xp: 140, alive: true } } }));
  ok(withSpy.heroes.spy.unlocked && withSpy.heroes.spy.xp === 140 && !withSpy.heroes.spy.wounded, 'Spy unlocked with his xp');
  ok(!withSpy.heroes.commando.unlocked, 'other heroes stay locked');
  const fell = applyOutcome(withSpy, m2, outcome(m2, { won: false, stars: 0, heroes: { spy: { xp: 160, alive: false } } }));
  ok(fell.heroes.spy.wounded && fell.heroes.spy.xp === 160 && fell.heroes.spy.unlocked, 'a fallen hero is wounded and keeps xp');
  const rested = applyOutcome(fell, m1, outcome(m1, {}));
  ok(!rested.heroes.spy.wounded && rested.heroes.spy.xp === 160, 'a hero who sits a mission out recovers');
  const lostSpyFirst = applyOutcome(c0, m2, outcome(m2, { won: false, stars: 0, heroes: { spy: { xp: 30, alive: false } } }));
  ok(!lostSpyFirst.heroes.spy.unlocked, 'losing the introducing mission does not unlock the hero');
  const noShrink = applyOutcome(withSpy, m2, outcome(m2, { heroes: { spy: { xp: 10, alive: true } } }));
  ok(noShrink.heroes.spy.xp === 140, 'hero xp never goes down');

  // A perfect campaign.
  let c: CampaignState = newCampaign('T');
  let ticks = 0;
  for (const m of MISSIONS) {
    ok(missionUnlocked(c, m.id), `${m.id} open in a perfect run`);
    const heroes: MissionOutcome['heroes'] = {};
    for (const h of heroesFor(c, m)) heroes[h] = { xp: c.heroes[h].xp + 50, alive: true };
    c = applyOutcome(c, m, outcome(m, { stars: 1 + m.bonus.length, heroes, ticks: (ticks += 100) }));
  }
  const sum = MISSIONS.reduce((a, m) => a + Math.round(m.rewards.xp * (1 + 0.25 * m.bonus.length)), 0);
  ok(c.commander.xp === sum, `perfect run earns ${sum} xp`);
  ok(c.commander.points === rankFor(sum) + MISSIONS.length, 'perfect run: a point per rank and per three-star mission');
  ok(campaignComplete(c) && missionsWon(c) === MISSIONS.length, 'campaign complete');
  for (const h of HERO_KINDS) ok(c.heroes[h].unlocked, `${h} unlocked by the end`);
  return `perfect run: ${sum} xp, ${RANKS[rankFor(sum)].name}, ${c.commander.points} points`;
});

// ---- Saves -----------------------------------------------------------------------------------
section('save helpers', () => {
  const s = newCampaignSave('id-1', '  Northern Front ', ' Ada ', 42);
  ok(s.kind === 'campaign' && s.version === 1 && s.id === 'id-1' && s.createdAt === 42, 'new save shape');
  ok(s.name === 'Northern Front' && s.campaign.commander.name === 'Ada', 'names trimmed');
  ok(s.battle === null, 'no battle in progress');
  ok(newCampaignSave('x', '', '', 0).name === 'Campaign', 'empty name falls back');
  ok(isCampaignSave(s) && !isCampaignSave(null) && !isCampaignSave({}), 'isCampaignSave');
  ok(JSON.stringify(migrateCampaignSave(clone(s))) === JSON.stringify(s), 'a current save migrates unchanged');
  const skirmish = createInitialState('sk', 'Battle', { createdAt: 0, seed: 'x' });
  ok(migrateCampaignSave(skirmish) === null, 'a skirmish is not a campaign');
  ok(!isCampaignSave(skirmish), 'a skirmish is not a campaign save');
  ok(migrateCampaignSave(null) === null && migrateCampaignSave('junk') === null, 'junk is not a campaign');
  ok(migrateCampaignSave({ kind: 'campaign' }) === null, 'a campaign without an id is refused');
  const partial = migrateCampaignSave({
    kind: 'campaign',
    id: 'p',
    name: 'Old',
    campaign: { commander: { name: 'Old Hand', xp: 900, perks: { logistics: 7, bogus: 2 } }, missions: { 'first-light': { won: true, stars: 2 } } },
  });
  ok(!!partial, 'a partial campaign is repaired');
  if (partial) {
    ok(partial.campaign.commander.xp === 900 && partial.campaign.commander.points === 0, 'xp kept, points default');
    ok(partial.campaign.commander.perks.logistics === 3, 'perk level clamped to its maximum');
    ok(!('bogus' in partial.campaign.commander.perks), 'unknown perks dropped');
    for (const h of HERO_KINDS) ok(partial.campaign.heroes[h]?.unlocked === false, `${h} filled in`);
    ok(partial.campaign.missions['first-light'].bestTicks === null, 'missing best time is null');
    ok(partial.battle === null && Array.isArray(partial.campaign.tech), 'battle and tech defaulted');
  }
  const withBattle = migrateCampaignSave({ ...clone(s), battle: clone(skirmish) });
  ok(withBattle?.battle?.id === 'sk', 'a battle in progress survives migration');
  ok(campaignSaveStatus(s) === 'active' && campaignSaveTurn(s) === 0, 'fresh save: active, turn 0');
  let c = s.campaign;
  for (const m of MISSIONS) c = applyOutcome(c, m, outcome(m, {}));
  ok(campaignSaveStatus({ ...s, campaign: c }) === 'victory' && campaignSaveTurn({ ...s, campaign: c }) === MISSIONS.length, 'finished save: victory');
  ok(CAMPAIGN_LENGTH === 14, 'fourteen missions');
});

// ---- Mission specs against their maps --------------------------------------------------------

/** Steps on the shortest walk between two points over walkable tiles (structures ignored), or -1. */
function walkSteps(tiles: string, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const start = Math.floor(a.y) * MAP_W + Math.floor(a.x);
  const goal = Math.floor(b.y) * MAP_W + Math.floor(b.x);
  const seen = new Int32Array(MAP_W * MAP_H).fill(-1);
  seen[start] = 0;
  const queue = [start];
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q];
    if (k === goal) return seen[k];
    const x = k % MAP_W;
    const y = (k / MAP_W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const X = x + dx;
      const Y = y + dy;
      if (X < 0 || Y < 0 || X >= MAP_W || Y >= MAP_H) continue;
      const j = Y * MAP_W + X;
      if (seen[j] >= 0 || !isWalkable(tiles[j])) continue;
      seen[j] = seen[k] + 1;
      queue.push(j);
    }
  }
  return -1;
}
const isBuilding = (k: string): k is BuildingKind => k in BUILDINGS;
const isUnit = (k: string): k is UnitKind => k in UNITS && !UNITS[k as UnitKind].hero;
const isHero = (k: string): k is HeroKind => (HERO_KINDS as string[]).includes(k);

section('mission specs', () => {
  ok(MISSIONS.length === 14, 'fourteen missions: act one and act two');
  ok(new Set(MISSIONS.map(m => m.id)).size === MISSIONS.length, 'mission ids unique');
  ok(new Set(MISSIONS.map(m => m.seed)).size === MISSIONS.length, 'mission seeds unique');
  MISSIONS.forEach((m, i) => ok(m.order === i + 1, `${m.id} is mission ${i + 1}`));
  ok(MISSIONS[0].id === 'first-light' && MISSIONS[7].id === 'fireline', 'act one: First Light to Fireline');
  ok(
    JSON.stringify(MISSIONS.slice(8).map(m => m.id)) === JSON.stringify(['iron-coast', 'convoy-north', 'the-long-hold', 'firestorm', 'bastion-line', 'last-light']),
    'act two, in order: Iron Coast to Last Light',
  );

  // Tech and heroes available so far, along the arc.
  const tech = new Set<string>(MISSIONS[0].tech);
  const heroes = new Set<HeroKind>();
  let points = 0;

  for (const m of MISSIONS) {
    const L = m.id;
    const map = generateMap(seedFromString(m.seed));
    const passable = (x: number, y: number, r = 1) => {
      const cx = Math.floor(x);
      const cy = Math.floor(y);
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const X = cx + dx;
          const Y = cy + dy;
          if (X < 0 || Y < 0 || X >= MAP_W || Y >= MAP_H) return false;
          if (!isWalkable(map.tiles[Y * MAP_W + X])) return false;
        }
      return true;
    };
    const point = (x: number | undefined, y: number | undefined, what: string, r = 1) => {
      points++;
      ok(typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y), `${L}: ${what} has coordinates`);
      if (typeof x !== 'number' || typeof y !== 'number') return;
      ok(x >= 0 && y >= 0 && x < MAP_W && y < MAP_H, `${L}: ${what} (${x}, ${y}) in bounds`);
      ok(passable(x, y, r), `${L}: ${what} (${x}, ${y}) passable with the ground around it`);
    };

    ok(m.title.length > 0 && m.summary.length > 0 && m.summary.length <= 80, `${L}: title and a one-line summary`);
    ok(m.briefing.length >= 2 && m.briefing.length <= 4 && m.briefing.every(p => p.length > 20 && p.length < 400), `${L}: 2 to 4 briefing paragraphs`);
    ok(m.seed.length > 0 && m.seed.length <= 64, `${L}: seed`);
    ok(m.difficulty in DIFFICULTIES, `${L}: difficulty`);
    ok(m.rewards.xp > 0, `${L}: reward xp`);

    // Forces.
    ok(m.player.credits >= 0 && m.enemy.credits >= 0, `${L}: credits non-negative`);
    for (const b of m.player.structures) ok(isBuilding(b), `${L}: player structure ${b}`);
    for (const b of m.enemy.structures) ok(isBuilding(b) && b !== 'hq', `${L}: enemy structure ${b} (the Command Yard is implied by a full base)`);
    for (const u of [...m.player.units, ...m.enemy.units]) ok(isUnit(u), `${L}: unit ${u} is a real, non-hero kind`);
    for (const h of m.player.heroes) ok(isHero(h), `${L}: hero ${h}`);
    ok(new Set(m.player.heroes).size === m.player.heroes.length, `${L}: heroes listed once`);
    ok(m.player.units.length + m.player.heroes.length + m.player.structures.length > 0, `${L}: the player has something`);
    ok(m.enemy.structures.length > 0 || m.enemy.base === 'full', `${L}: the enemy has a base`);
    ok(['normal', 'defend', 'raid', 'passive'].includes(m.enemy.ai), `${L}: enemy AI mode`);
    if (m.enemy.base === 'outpost') ok(m.enemy.ai !== 'normal' && m.enemy.ai !== 'raid' || m.enemy.structures.some(b => b === 'factory' || b === 'barracks'), `${L}: an attacking outpost can train`);
    const hasBase = m.player.structures.includes('hq');
    ok(hasBase || !m.tech.some(isBuilding), `${L}: building tech only with a Command Yard`);

    // Tech and powers, and the unlock arc.
    for (const t of m.tech) ok(isBuilding(t) || isUnit(t), `${L}: tech ${t} is a real, buildable kind`);
    // A mission may offer what it introduces (its rewards unlock it), as it may field the hero it introduces.
    for (const t of m.tech) ok(tech.has(t) || (m.rewards.unlockTech ?? []).includes(t), `${L}: tech ${t} is unlocked by this point in the campaign, or introduced here`);
    for (const p of m.powers) ok(p in POWERS, `${L}: power ${p}`);
    for (const h of m.player.heroes) ok(heroes.has(h) || (m.rewards.unlockHeroes ?? []).includes(h), `${L}: hero ${h} unlocked or introduced here`);
    for (const h of m.rewards.unlockHeroes ?? []) {
      ok(isHero(h) && m.player.heroes.includes(h), `${L}: unlocks ${h}, whom it fields`);
      ok(!heroes.has(h), `${L}: ${h} not already unlocked`);
    }
    for (const t of m.rewards.unlockTech ?? []) {
      ok(isBuilding(t) || isUnit(t), `${L}: unlocks real tech ${t}`);
      ok(!tech.has(t), `${L}: ${t} not already unlocked`);
    }

    // Objectives.
    const enemyHas = (b: BuildingKind) => m.enemy.structures.filter(x => x === b).length + (b === 'hq' && m.enemy.base === 'full' ? 1 : 0);
    const objective = (o: ObjectiveSpec, what: string) => {
      switch (o.kind) {
        case 'destroyAll':
          break;
        case 'destroy':
          ok(isBuilding(o.building) && Number.isInteger(o.count) && o.count > 0, `${what}: destroy count`);
          ok(enemyHas(o.building) >= o.count, `${what}: the enemy starts with ${o.count} ${o.building}`);
          break;
        case 'survive':
          ok(Number.isInteger(o.ticks) && o.ticks > 0, `${what}: survive ticks`);
          ok(!m.timeLimit || o.ticks < m.timeLimit, `${what}: survivable inside the time limit`);
          break;
        case 'keepAlive':
          ok(m.player.heroes.includes(o.hero), `${what}: keeps alive a hero who is fielded`);
          break;
        case 'infiltrate':
          ok(m.player.heroes.includes('spy'), `${what}: infiltrating needs the Spy`);
          ok(enemyHas(o.building) > 0, `${what}: the enemy has a ${o.building}`);
          break;
        case 'capture':
          ok(m.player.heroes.includes('engineer'), `${what}: capturing needs the Engineer`);
          ok(o.building !== 'hq' && enemyHas(o.building) > 0, `${what}: the enemy has a capturable ${o.building}`);
          break;
        case 'reach':
          ok(o.who === 'any' || m.player.heroes.includes(o.who), `${what}: reach by a fielded hero`);
          ok(o.r > 0 && o.r <= 6, `${what}: reach radius`);
          point(o.x, o.y, `${what} point`, 1);
          break;
        case 'holdZone':
          ok(o.r > 0 && o.r <= 8 && Number.isInteger(o.ticks) && o.ticks > 0, `${what}: hold radius and time`);
          point(o.x, o.y, `${what} zone`, Math.min(2, Math.floor(o.r)));
          break;
        case 'harvest':
          ok(o.credits > 0 && (m.player.structures.includes('refinery') || m.tech.includes('refinery')), `${what}: harvest needs a refinery`);
          break;
        case 'build':
          ok(isBuilding(o.building) && o.count > 0 && hasBase && m.tech.includes(o.building), `${what}: build something buildable`);
          break;
        case 'escort':
          ok(!!m.convoy, `${what}: an escort needs a convoy`);
          ok(Number.isInteger(o.count) && o.count > 0 && o.count <= (m.convoy?.kinds.length ?? 0), `${what}: count within the convoy's size`);
          ok(o.r > 0 && o.r <= 6, `${what}: escort radius`);
          point(o.x, o.y, `${what} point`, 1);
          if (m.convoy?.route.length) {
            const end = m.convoy.route[m.convoy.route.length - 1];
            ok(Math.hypot(end.x - o.x, end.y - o.y) <= o.r, `${what}: the convoy's route ends inside the escort point`);
          }
          break;
        case 'destroyWithin':
          ok(isBuilding(o.building) && Number.isInteger(o.count) && o.count > 0, `${what}: destroy count`);
          ok(enemyHas(o.building) >= o.count, `${what}: the enemy starts with ${o.count} ${o.building}`);
          ok(Number.isInteger(o.ticks) && o.ticks >= 600, `${what}: at least a minute to do it`);
          ok(!m.timeLimit || o.ticks <= m.timeLimit, `${what}: inside the time limit`);
          break;
        default:
          ok(false, `${what}: unknown objective ${(o as { kind: string }).kind}`);
      }
    };
    ok(m.objectives.length > 0, `${L}: has objectives`);
    ok(m.objectives.some(o => o.kind !== 'keepAlive'), `${L}: has an objective that can be completed`);
    m.objectives.forEach((o, i) => objective(o, `${L} objective ${i}`));
    ok(m.bonus.length === 2, `${L}: two bonus objectives (three stars at most)`);
    m.bonus.forEach((o, i) => objective(o, `${L} bonus ${i}`));
    if (m.timeLimit !== undefined) ok(Number.isInteger(m.timeLimit) && m.timeLimit > 0, `${L}: time limit`);

    // The convoy: real units on open ground, a route every leg of which can be walked.
    if (m.convoy) {
      const c = m.convoy;
      ok(c.kinds.length > 0 && c.kinds.length <= 8 && c.kinds.every(isUnit), `${L}: convoy of 1 to 8 real, non-hero units`);
      ok(c.route.length > 0 && c.route.length <= 13, `${L}: convoy route of 1 to 13 points (a move and a full waypoint queue)`);
      ok([...m.objectives, ...m.bonus].some(o => o.kind === 'escort'), `${L}: a convoy is there to be escorted`);
      point(c.x, c.y, `${L} convoy start`);
      c.route.forEach((p, i) => point(p.x, p.y, `${L} convoy route ${i}`));
      const legs = [{ x: c.x, y: c.y }, ...c.route];
      for (let i = 1; i < legs.length; i++) {
        const steps = walkSteps(map.tiles, legs[i - 1], legs[i]);
        ok(steps >= 0, `${L}: convoy leg ${i} walkable, (${legs[i - 1].x}, ${legs[i - 1].y}) to (${legs[i].x}, ${legs[i].y})`);
      }
    }
    if (m.order >= 9) {
      ok(m.player.structures.length === 0 || m.player.structures.includes('hq'), `${L}: a base mission has a Command Yard`);
      ok(!m.timeLimit || m.timeLimit >= 10 * 600, `${L}: at least ten minutes on the clock`);
    }

    // Triggers.
    m.triggers.forEach((t, i) => {
      const what = `${L} trigger ${i}`;
      if ('at' in t) {
        ok(Number.isInteger(t.at) && t.at > 0, `${what}: fires at a positive tick`);
        ok(!m.timeLimit || t.at < m.timeLimit, `${what}: fires inside the time limit`);
        ok(!!t.spawn, `${what}: a timed trigger spawns`);
      } else {
        ok(Number.isInteger(t.afterObjective) && t.afterObjective >= 0 && t.afterObjective < m.objectives.length, `${what}: names a real objective`);
        ok(m.objectives[t.afterObjective]?.kind !== 'keepAlive', `${what}: follows an objective that completes`);
        ok(!!t.spawn || !!t.say, `${what}: does something`);
      }
      if (t.say !== undefined) ok(t.say.length > 0 && t.say.length < 200, `${what}: a short line`);
      if (t.spawn) {
        const s = t.spawn;
        ok(isUnit(s.kind), `${what}: spawns a real, non-hero kind`);
        ok(Number.isInteger(s.count) && s.count > 0 && s.count <= 8, `${what}: spawn count`);
        ok(s.owner === 0 || s.owner === 1, `${what}: spawn owner`);
        point(s.x, s.y, `${what} spawn`);
        if (s.order === 'attackMove') point(s.tx, s.ty, `${what} target`);
        else ok(s.order === 'guard' && s.tx === undefined, `${what}: guards in place`);
      }
    });

    for (const t of m.rewards.unlockTech ?? []) tech.add(t);
    for (const h of m.rewards.unlockHeroes ?? []) heroes.add(h);
  }
  return `${points} map points checked`;
});

// ---- Missions in the simulation --------------------------------------------------------------
section('missions in the simulation', () => {
  let campaign = newCampaign('Check');
  let skipped = false;
  let ran = 0;
  for (const m of MISSIONS) {
    const ctx = missionContext(campaign, m, `check-${m.id}`, 1000);
    let s: GameState;
    try {
      s = createMissionState(m, ctx);
    } catch (err) {
      if (/Not implemented yet/.test((err as Error).message)) {
        skipped = true;
        break;
      }
      ok(false, `${m.id}: createMissionState threw ${(err as Error).message}`);
      continue;
    }
    ok(!!s.mission && s.mission.id === m.id, `${m.id}: state carries the mission`);
    ok(s.mission?.objectives.length === m.objectives.length && s.mission?.bonus.length === m.bonus.length, `${m.id}: objectives built`);
    ok(s.seedText === m.seed || s.rngSeed === seedFromString(m.seed), `${m.id}: map from the mission seed`);
    ok(s.tiles === generateMap(seedFromString(m.seed)).tiles, `${m.id}: tiles match the generated map`);
    for (const h of heroesFor(campaign, m)) ok(s.units.some(u => u.owner === 0 && u.kind === h), `${m.id}: ${h} on the field`);
    for (const b of s.buildings) {
      for (const o of [...m.objectives, ...m.bonus]) {
        if (o.kind !== 'reach' && o.kind !== 'holdZone') continue;
        const w = BUILDINGS[b.kind];
        const inside = o.x >= b.x && o.x < b.x + w.w && o.y >= b.y && o.y < b.y + w.h;
        ok(!inside, `${m.id}: ${o.kind} point not under a ${b.kind}`);
      }
    }
    const before = JSON.stringify(s);
    let cur = s;
    try {
      const over = (g: GameState) => !!g.mission?.result || g.winner !== null;
      for (let i = 0; i < 200 && !over(cur); i++) cur = processAction(cur, { type: 'tick', n: 10 });
      ok(JSON.stringify(s) === before, `${m.id}: ticking does not mutate the starting state`);
      ok(cur.tick >= 2000 || over(cur), `${m.id}: ran 2000 ticks (reached ${cur.tick})`);
      ok(cur.tick >= 600, `${m.id}: did not end inside its first minute (ended at tick ${cur.tick})`);
      ok(cur.units.every(u => Number.isFinite(u.x) && Number.isFinite(u.y) && u.hp > 0), `${m.id}: units sane after ${cur.tick} ticks`);
      ran++;
    } catch (err) {
      ok(false, `${m.id}: ticking threw ${(err as Error).message}`);
    }
    // Unlock as if won, so later missions see the heroes and tech they expect.
    const heroes: MissionOutcome['heroes'] = {};
    for (const h of heroesFor(campaign, m)) heroes[h] = { xp: campaign.heroes[h].xp, alive: true };
    campaign = applyOutcome(campaign, m, outcome(m, { heroes }));
  }
  if (skipped) return 'SKIPPED: createMissionState is not implemented yet in this build';
  return `${ran} missions built and run`;
});

// ---- Act two ---------------------------------------------------------------------------------
section('act two: progression and old saves', () => {
  const act2 = MISSIONS.filter(m => m.order >= 9);
  ok(act2.length === 6 && act2.every((m, i) => m.order === 9 + i), 'six act-two missions, orders 9 to 14');
  // A campaign with act one won: what a save from before act two holds.
  let c: CampaignState = newCampaign('Veteran');
  for (const m of MISSIONS.slice(0, 8)) {
    const heroes: MissionOutcome['heroes'] = {};
    for (const h of heroesFor(c, m)) heroes[h] = { xp: c.heroes[h].xp + 40, alive: true };
    c = applyOutcome(c, m, outcome(m, { heroes }));
  }
  const m9 = missionById('iron-coast')!;
  ok(missionUnlocked(c, m9.id), 'winning mission 8 opens mission 9');
  ok(!campaignComplete(c), 'act one won is no longer the end of the campaign');
  for (const m of act2.slice(1)) ok(!missionUnlocked(c, m.id), `${m.id} still locked after act one`);
  const lost8 = { ...c, missions: { ...c.missions, fireline: { won: false, stars: 0, bestTicks: null } } };
  ok(!missionUnlocked(lost8, m9.id), 'mission 9 stays shut until mission 8 is won');

  // The save as it was written before act two existed: it loads, keeps everything, and goes on.
  const old = {
    version: 1,
    kind: 'campaign',
    id: 'old-1',
    name: 'Before act two',
    createdAt: 5,
    campaign: clone(c),
    battle: null,
  };
  const loaded = migrateCampaignSave(clone(old));
  ok(!!loaded && JSON.stringify(loaded.campaign) === JSON.stringify(c), 'a save from before act two loads unchanged');
  if (loaded) {
    ok(campaignSaveStatus(loaded) === 'active' && campaignSaveTurn(loaded) === 8, 'it reads as active, 8 of 14 won');
    ok(missionUnlocked(loaded.campaign, m9.id), 'and offers mission 9');
  }
  // One with a battle of act one still in progress also loads, the battle intact.
  const m8 = missionById('fireline')!;
  const battle = createMissionState(m8, missionContext(c, m8, 'old-1', 5));
  const withBattle = migrateCampaignSave({ ...clone(old), battle: clone(battle) });
  ok(withBattle?.battle?.mission?.id === 'fireline' && withBattle.battle.tick === 0, 'with an act-one battle in progress, too');

  // On through act two: each win opens the next, tech arrives as the arc says, the last win ends it.
  const arc: Record<string, string[]> = {
    'iron-coast': ['wall', 'grenadier'],
    'convoy-north': ['medic', 'repairbay'],
    'the-long-hold': ['rocketturret', 'missilecarrier'],
    firestorm: ['techcentre', 'flametank'],
    'bastion-line': ['bastion', 'strikecommand'],
    'last-light': [],
  };
  for (const m of act2) {
    ok(missionUnlocked(c, m.id), `${m.id} open after the mission before it`);
    for (const t of arc[m.id]) ok(!c.tech.includes(t as never), `${m.id}: ${t} not unlocked before it`);
    const heroes: MissionOutcome['heroes'] = {};
    for (const h of heroesFor(c, m)) heroes[h] = { xp: c.heroes[h].xp + 40, alive: true };
    ok(heroesFor(c, m).length === m.player.heroes.length, `${m.id}: every hero it asks for is unlocked by now`);
    const before = c;
    c = applyOutcome(c, m, outcome(m, { heroes }));
    for (const t of arc[m.id]) ok(c.tech.includes(t as never), `${m.id}: winning it unlocks ${t}`);
    ok(campaignComplete(c) === (m.order === 14), `${m.id}: campaign complete only after mission 14`);
    ok(c.commander.xp > before.commander.xp, `${m.id}: pays xp`);
  }
  ok(campaignSaveStatus({ ...old, kind: 'campaign', campaign: c } as never) === 'victory', 'winning mission 14 is victory in the saves list');
  // Every advanced structure and unit has arrived by the final assault.
  const adv = ['wall', 'grenadier', 'medic', 'repairbay', 'rocketturret', 'missilecarrier', 'techcentre', 'flametank', 'bastion', 'strikecommand'];
  const last = missionById('last-light')!;
  for (const t of adv) ok(last.tech.includes(t as never), `Last Light offers ${t}`);
  // Normal tier since the campaign difficulty settings: Hard gives the Hard tier back (difficulty.ts).
  ok(last.difficulty === 'normal' && scaleMission(last, 'hard').difficulty === 'hard' && last.enemy.ai === 'normal' && last.enemy.base === 'full', 'Last Light: a normal commander, hard at campaign Hard, with a full base');
  const kinds = new Set<string>(['hq', ...last.enemy.structures]);
  // Skirmish-only structures (round 5): a Field Yard is never built, only deployed from a truck, and
  // the tier-three structures are in no mission.
  const skirmishOnly = new Set<string>(['protoworks', 'fortress']);
  for (const b of Object.keys(BUILDINGS) as (keyof typeof BUILDINGS)[]) {
    if (BUILDINGS[b].undeploysTo || skirmishOnly.has(b)) continue;
    if (b !== 'hq' || last.enemy.base === 'full') ok(kinds.has(b), `Last Light: the enemy has a ${b}`);
  }
  // The new objective kinds are used across the act.
  const used = new Set(act2.flatMap(m => [...m.objectives, ...m.bonus].map(o => (o.kind === 'holdZone' && o.reset ? 'holdZone reset' : o.kind))));
  for (const k of ['escort', 'destroyWithin', 'holdZone reset']) ok(used.has(k), `act two uses ${k}`);
  for (const m of act2) ok(m.bonus.length === 2 && m.rewards.xp > 0, `${m.id}: two bonus objectives and a reward`);
  return `act two: ${c.commander.xp} xp after a clean run`;
});

section('act two in the simulation', () => {
  let c: CampaignState = newCampaign('Check');
  for (const m of MISSIONS) {
    const heroes: MissionOutcome['heroes'] = {};
    for (const h of heroesFor(c, m)) heroes[h] = { xp: c.heroes[h].xp, alive: true };
    if (m.order >= 9) {
      const s = createMissionState(m, missionContext(c, m, `act2-${m.id}`, 1000));
      // Every structure in the spec stands: none left out for want of room.
      for (const [owner, list] of [[0, m.player.structures], [1, [...(m.enemy.base === 'full' ? ['hq'] : []), ...m.enemy.structures]]] as [number, string[]][]) {
        const want = new Map<string, number>();
        for (const k of list) want.set(k, (want.get(k) ?? 0) + 1);
        for (const [k, nWant] of want) {
          const have = s.buildings.filter(b => b.owner === owner && b.kind === k).length;
          ok(have === nWant, `${m.id}: side ${owner} starts with ${nWant} ${k} (has ${have})`);
        }
      }
      ok(JSON.stringify(s.teams) === '[0,1]' && s.players.length === 2, `${m.id}: two sides, the enemy is side 1`);
      // Structure powers: the enemy holds what its structures grant, charging.
      if (m.structurePowers) {
        const enemy = new Set(m.enemy.structures);
        ok(!!s.mission!.structurePowers, `${m.id}: structure powers switched on`);
        if (enemy.has('strikecommand')) ok(s.powers?.[1]?.missile === POWERS.missile.cooldown, `${m.id}: the enemy Strike Command's missile is charging`);
        if (enemy.has('techcentre')) ok(s.powers?.[1]?.barrage === POWERS.barrage.cooldown, `${m.id}: the enemy Tech Centre's barrage is charging`);
      } else ok(!s.mission!.structurePowers && JSON.stringify(s.powers?.[1]) === '{}', `${m.id}: no powers for the enemy`);
      // The convoy: on the field, under orders along its route.
      if (m.convoy) {
        const ids = s.mission!.convoy ?? [];
        ok(ids.length === m.convoy.kinds.length, `${m.id}: the whole convoy is placed`);
        const units = s.units.filter(u => ids.includes(u.id));
        ok(units.every(u => u.owner === 0 && u.order.type === 'move' && u.queue.length === m.convoy!.route.length - 1), `${m.id}: the convoy is under way along its route`);
        // With every enemy gone, the convoy drives itself to the point: the route really is drivable.
        let q = clone(s);
        q.units = q.units.filter(u => u.owner === 0 && ids.includes(u.id));
        q.buildings = q.buildings.filter(b => b.owner !== 1 || b.kind === 'power');
        q.mission!.triggers = [];
        let n = 0;
        const esc = q.mission!.objectives.findIndex(o => o.spec.kind === 'escort');
        let last = 0;
        let rising = true;
        while (!q.mission!.objectives[esc].done && n < 6000) {
          q = processAction(q, { type: 'tick', n: 50 });
          n += 50;
          const p = q.mission!.objectives[esc].progress;
          if (p + 0.02 < last) rising = false;
          last = Math.max(last, p);
        }
        ok(q.mission!.objectives[esc].done, `${m.id}: the convoy reaches its point unaided (${n} ticks)`);
        ok(rising, `${m.id}: escort progress rises as the convoy drives`);
        ok(q.mission!.result === 'won', `${m.id}: and the escort wins the mission`);
      }
      // Run it for 2,000 ticks untouched, but for the convoy, which is held back as a player would
      // hold it while the road is cleared (left alone it drives into the Combine posts: see below).
      let cur = m.convoy ? processAction(s, { type: 'stop', ids: s.mission!.convoy ?? [] }) : s;
      for (let i = 0; i < 200 && !cur.mission!.result; i++) cur = processAction(cur, { type: 'tick', n: 10 });
      ok(cur.tick >= 2000, `${m.id}: runs 2000 ticks (${cur.tick})`);
    }
    c = applyOutcome(c, m, outcome(m, { heroes }));
  }
});

// ---- Act two, played ---------------------------------------------------------------------------
const clockText = (ticks: number) => {
  const secs = Math.round(ticks / 10);
  return `${Math.floor(secs / 60)} min ${secs % 60} s`;
};

/** The campaign as it stands on reaching this mission, every mission before it won. */
function campaignBefore(id: string): CampaignState {
  let c: CampaignState = newCampaign('Check');
  for (const m of MISSIONS) {
    if (m.id === id) break;
    const heroes: MissionOutcome['heroes'] = {};
    for (const h of heroesFor(c, m)) heroes[h] = { xp: c.heroes[h].xp, alive: true };
    c = applyOutcome(c, m, outcome(m, { heroes }));
  }
  return c;
}
const startOf = (id: string): GameState => {
  const m = missionById(id)!;
  return createMissionState(m, missionContext(campaignBefore(id), m, `played-${id}`, 1000));
};
const centreOf = (b: { x: number; y: number; kind: BuildingKind }) => ({ x: b.x + BUILDINGS[b.kind].w / 2, y: b.y + BUILDINGS[b.kind].h / 2 });

section('Demolition, played', () => {
  // Mission 4 could not be won: its outpost ran a refinery on 'defend' and trained a rifleman every
  // five seconds, its turrets outranged the Commando, and the buggies sent after the extraction
  // spawned on top of him. Played by script both ways in: straight at the base, and round its flank.
  const plans: Record<string, { x: number; y: number }[]> = {
    straight: [{ x: 45, y: 20 }, { x: 54, y: 10 }],
    flank: [{ x: 40, y: 40 }, { x: 61, y: 20 }, { x: 61, y: 6 }],
  };
  for (const [plan, way] of Object.entries(plans)) {
    let s = startOf('demolition');
    const mine = () => s.units.filter(u => u.owner === 0);
    let wi = 0;
    while (!s.mission!.result && s.tick < 20 * 600) {
      const c = mine().find(u => u.kind === 'commando');
      if (!c) break;
      const gens = s.buildings.filter(b => b.owner === 1 && b.kind === 'power');
      if (!gens.length) {
        if (s.tick % 50 === 0) s = processAction(s, { type: 'move', ids: mine().map(u => u.id), x: 58.5, y: 56.5 });
      } else if (wi < way.length) {
        const p = way[wi];
        if (s.tick % 50 === 0) s = processAction(s, { type: 'move', ids: mine().map(u => u.id), x: p.x, y: p.y, attackMove: true });
        if (Math.hypot(c.x - p.x, c.y - p.y) < 2.5) wi++;
      } else {
        const g = gens.map(b => ({ b, d: Math.hypot(b.x + 1 - c.x, b.y + 1 - c.y) })).sort((a, b) => a.d - b.d)[0].b;
        if (c.hero!.abilityCd === 0) s = processAction(s, { type: 'ability', id: c.id, target: g.id });
        if (s.tick % 50 === 0) s = processAction(s, { type: 'move', ids: mine().filter(u => u.kind !== 'commando').map(u => u.id), x: g.x + 1, y: g.y + 1, attackMove: true });
      }
      s = processAction(s, { type: 'tick', n: 10 });
    }
    ok(s.mission!.result === 'won', `demolition: won ${plan === 'straight' ? 'straight at the outpost' : 'round its flank'} (${s.mission!.result} at ${s.tick})`);
    ok(s.players[1].stats.trained === 0, `demolition: the outpost trains nothing (${s.players[1].stats.trained})`);
  }
});

section('Borrowed Steel, played', () => {
  // Mission 5 could not be won: three Gun Turrets, two tanks and five riflemen on 'defend' against six
  // infantry and an unarmed Engineer, and units attack-moving through the yard shot the War Factory
  // down before he reached it. Played by script three ways in, at every campaign difficulty: the squad
  // clears what guards the factory while the Engineer waits out of range, he captures it, the factory
  // builds tanks and everything turns on what is left and on the counter-attack.
  const plans: Record<string, { way: { x: number; y: number }[]; hold: { x: number; y: number } }> = {
    straight: { way: [{ x: 50, y: 17 }], hold: { x: 40, y: 26 } },
    north: { way: [{ x: 40, y: 4 }, { x: 52, y: 3 }], hold: { x: 36, y: 4 } },
    east: { way: [{ x: 61, y: 30 }, { x: 61, y: 12 }], hold: { x: 61, y: 26 } },
  };
  const near = <T extends { x: number; y: number }>(list: T[], p: { x: number; y: number }) =>
    list.map(t => ({ t, d: Math.hypot(t.x - p.x, t.y - p.y) })).sort((a, b) => a.d - b.d)[0]?.t;
  const wins: Record<string, number> = {};
  const notes: string[] = [];
  for (const level of CAMPAIGN_LEVELS) {
    wins[level] = 0;
    for (const [plan, { way, hold }] of Object.entries(plans)) {
      const m = missionById('borrowed-steel')!;
      const c = { ...campaignBefore(m.id), difficulty: level };
      let s = createMissionState(campaignMission(c, m), missionContext(c, m, `bs-${level}-${plan}`, 1000));
      const mine = () => s.units.filter(u => u.owner === 0);
      let wi = 0;
      while (!s.mission!.result && s.tick < 30 * MIN) {
        const e = mine().find(u => u.kind === 'engineer');
        const fac = s.buildings.find(b => b.kind === 'factory');
        if (!e || !fac) break;
        const army = mine().filter(u => u.kind !== 'engineer');
        const every = (n: number) => s.tick % n === 0;
        if (fac.owner === 1) {
          const fc = centreOf(fac);
          const threats = [
            ...s.units.filter(u => u.owner === 1 && u.kind !== 'hauler' && Math.hypot(u.x - fc.x, u.y - fc.y) < 9),
            ...s.buildings.filter(b => b.owner === 1 && b.kind === 'turret'),
          ];
          if (wi < way.length) {
            const p = way[wi];
            if (every(50)) s = processAction(s, { type: 'move', ids: army.map(u => u.id), x: p.x, y: p.y, attackMove: true });
            if (every(50) && wi > 0) s = processAction(s, { type: 'move', ids: [e.id], x: way[wi - 1].x, y: way[wi - 1].y });
            if (Math.hypot((army[0] ?? e).x - p.x, (army[0] ?? e).y - p.y) < 3) wi++;
          } else if (threats.length && army.length) {
            // Armour and rockets on the turrets and anything heavy, rifles on their infantry.
            const lead = army[0];
            const heavyFoe = near(threats.filter(t => !('kind' in t && t.kind === 'rifleman')), lead) ?? near(threats, lead)!;
            const rifleFoe = near(s.units.filter(u => u.owner === 1 && u.kind === 'rifleman'), lead) ?? heavyFoe;
            const heavy = army.filter(u => u.kind !== 'rifleman');
            const rifles = army.filter(u => u.kind === 'rifleman');
            if (every(50) && heavy.length) s = processAction(s, { type: 'attack', ids: heavy.map(u => u.id), target: heavyFoe.id });
            if (every(50) && rifles.length) s = processAction(s, { type: 'attack', ids: rifles.map(u => u.id), target: rifleFoe.id });
            if (every(20)) s = processAction(s, { type: 'move', ids: [e.id], x: hold.x, y: hold.y });
          } else {
            if (every(50)) s = processAction(s, { type: 'move', ids: army.map(u => u.id), x: fc.x, y: fc.y, attackMove: true });
            if (distToBuilding(e.x, e.y, fac) <= HERO_ABILITY.engineer.range) {
              if (e.hero!.active?.kind !== 'capture' && !abilityProblem(s, 0, e.id, fac.id)) s = processAction(s, { type: 'ability', id: e.id, target: fac.id });
            } else if (every(30)) s = processAction(s, { type: 'move', ids: [e.id], x: fc.x, y: fac.y + 3.5 });
          }
        } else {
          // The factory is ours: tanks while the credits last, everything at the nearest enemy.
          if (s.players[0].credits >= UNITS.tank.cost && every(20)) s = processAction(s, { type: 'queue', category: 'vehicle', kind: 'tank' });
          const lead = army[0] ?? e;
          const foe = near(s.units.filter(u => u.owner === 1), lead) ?? near(s.buildings.filter(b => b.owner === 1).map(b => ({ ...centreOf(b), id: b.id })), lead);
          if (foe && every(50)) s = processAction(s, { type: 'move', ids: army.map(u => u.id), x: foe.x, y: foe.y, attackMove: true });
          if (every(50)) s = processAction(s, { type: 'move', ids: [e.id], x: centreOf(fac).x, y: fac.y - 1 });
        }
        s = processAction(s, { type: 'tick', n: 10 });
      }
      if (s.mission!.result === 'won') wins[level]++;
      ok(s.players[1].stats.trained === 0, `borrowed-steel ${level}, ${plan}: the outpost trains nothing (${s.players[1].stats.trained})`);
      if (level !== 'hard') ok(s.mission!.result === 'won', `borrowed-steel ${level}: won ${plan} (${s.mission!.result ?? 'unfinished'} at ${s.tick}${s.mission!.lostBecause ? `: ${s.mission!.lostBecause}` : ''})`);
      notes.push(`${level} ${plan} ${s.mission!.result ?? 'unfinished'} ${clockText(s.tick)}`);
    }
  }
  // Hard is meant to be hard: the scripted player need not win every way in, but must win some.
  ok(wins.hard >= 1, `borrowed-steel hard: won at least one way in (${wins.hard} of 3)`);
  return notes.join('; ');
});

section('campaign difficulty', () => {
  const notes: string[] = [];
  // A new campaign plays at Normal; an old save without the field reads as Normal.
  ok(newCampaign('X').difficulty === 'normal', 'a new campaign starts at Normal');
  const old = newCampaignSave('id-old', 'Old', 'Cmdr', 0) as unknown as { campaign: Record<string, unknown> };
  delete old.campaign.difficulty;
  ok(migrateCampaignSave(old)!.campaign.difficulty === 'normal', 'a campaign saved before difficulty settings loads at Normal');
  const hardSave = newCampaignSave('id-hard', 'Hard', 'Cmdr', 0);
  hardSave.campaign.difficulty = 'hard';
  ok(migrateCampaignSave(JSON.parse(JSON.stringify(hardSave)))!.campaign.difficulty === 'hard', 'the setting survives a save');
  const junk = JSON.parse(JSON.stringify(hardSave));
  junk.campaign.difficulty = 'brutal';
  ok(migrateCampaignSave(junk)!.campaign.difficulty === 'normal', 'an unknown setting loads as Normal');
  const c0 = newCampaign('X');
  ok(setCampaignLevel(c0, 'normal') === c0, 'setting the same difficulty changes nothing');
  ok(setCampaignLevel(c0, 'easy').difficulty === 'easy' && c0.difficulty === 'normal', 'changing it returns a new campaign');
  ok(setCampaignLevel(c0, 'brutal' as never) === c0, 'an unknown difficulty is refused');

  const tierOf: Record<string, number> = { easy: 0, normal: 1, hard: 2 };
  const count = (kinds: string[]) => kinds.length;
  for (const m of MISSIONS) {
    ok(scaleMission(m, 'normal') === m, `${m.id}: Normal is the mission as written`);
    const easy = scaleMission(m, 'easy');
    const hard = scaleMission(m, 'hard');
    ok(tierOf[easy.difficulty] === Math.max(0, tierOf[m.difficulty] - 1) && tierOf[hard.difficulty] === Math.min(2, tierOf[m.difficulty] + 1), `${m.id}: the commander is a step easier on Easy and harder on Hard`);
    ok(count(easy.enemy.units) <= count(m.enemy.units) && count(hard.enemy.units) >= count(m.enemy.units), `${m.id}: fewer enemy troops on Easy, more on Hard (${count(easy.enemy.units)} / ${count(m.enemy.units)} / ${count(hard.enemy.units)})`);
    ok(new Set(easy.enemy.units).size === new Set(m.enemy.units).size, `${m.id}: Easy keeps every kind of enemy troop`);
    ok(JSON.stringify(easy.enemy.structures) === JSON.stringify(m.enemy.structures) && JSON.stringify(hard.enemy.structures) === JSON.stringify(m.enemy.structures), `${m.id}: structures are never changed`);
    ok(JSON.stringify(easy.objectives) === JSON.stringify(m.objectives) && JSON.stringify(hard.bonus) === JSON.stringify(m.bonus), `${m.id}: objectives are never changed`);
    ok(easy.player.credits >= m.player.credits && hard.player.credits === m.player.credits, `${m.id}: more credits on Easy`);
    ok(JSON.stringify(easy.player.units) === JSON.stringify(m.player.units) && JSON.stringify(hard.player.units) === JSON.stringify(m.player.units), `${m.id}: the player's own troops are the same at every difficulty`);
    m.triggers.forEach((t, i) => {
      if (!t.spawn) return;
      const e = easy.triggers[i].spawn!.count;
      const h = hard.triggers[i].spawn!.count;
      if (t.spawn.owner === 0) ok(e === t.spawn.count && h === t.spawn.count, `${m.id}: our own reinforcements (trigger ${i}) are never scaled`);
      else ok(e >= 1 && e <= t.spawn.count && h >= t.spawn.count, `${m.id}: trigger ${i} sends ${e} / ${t.spawn.count} / ${h}`);
    });
    if (m.timeLimit) ok(easy.timeLimit! > m.timeLimit && hard.timeLimit === m.timeLimit, `${m.id}: a longer time limit on Easy`);
    // The scaled spec still passes every map check: same seed, same points.
    ok(easy.seed === m.seed && hard.seed === m.seed, `${m.id}: same map at every difficulty`);
  }
  ok(MISSIONS.every(m => missionById(m.id) === m), 'scaling never touches the mission list');

  // Every mission builds and runs at Easy and Hard, and the battle remembers its difficulty.
  for (const level of ['easy', 'hard'] as const) {
    let c: CampaignState = { ...newCampaign('Check'), difficulty: level };
    for (const m of MISSIONS) {
      const ctx = missionContext(c, m, `lvl-${level}-${m.id}`, 1000);
      const s = createMissionState(campaignMission(c, m), ctx);
      ok(s.mission!.level === level, `${m.id} ${level}: the battle records its difficulty`);
      ok(s.difficulty === campaignMission(c, m).difficulty, `${m.id} ${level}: the commander plays at the scaled tier`);
      const want = campaignMission(c, m).enemy.units.length;
      const have = s.units.filter(u => u.owner === 1 && u.kind !== 'hauler').length;
      ok(have === want, `${m.id} ${level}: the enemy starts with ${want} troops (has ${have})`);
      if (level === 'easy') ok(ctx.perks.unitHpMul === perkModifiers(c).unitHpMul * CAMPAIGN_LEVEL.easy.playerHp, `${m.id} easy: our troops are tougher`);
      else ok(ctx.perks.unitHpMul === perkModifiers(c).unitHpMul, `${m.id} hard: our troops as the perks leave them`);
      let cur = m.convoy ? processAction(s, { type: 'stop', ids: s.mission!.convoy ?? [] }) : s;
      for (let i = 0; i < 200 && !cur.mission!.result; i++) cur = processAction(cur, { type: 'tick', n: 10 });
      ok(cur.tick >= 2000 || !!cur.mission!.result, `${m.id} ${level}: runs 2000 ticks (${cur.tick})`);
      const heroes: MissionOutcome['heroes'] = {};
      for (const h of heroesFor(c, m)) heroes[h] = { xp: c.heroes[h].xp, alive: true };
      c = applyOutcome(c, m, outcome(m, { heroes }));
    }
    ok(c.difficulty === level, `${level}: the setting is kept through a whole campaign`);
    notes.push(`${level}: all ${MISSIONS.length} missions build and run`);
  }
  // A Normal battle carries no level, exactly as battles saved before the setting.
  const n0 = createMissionState(MISSIONS[0], missionContext(newCampaign('X'), MISSIONS[0], 'n0', 0));
  ok(n0.mission!.level === undefined, 'a Normal battle carries no level field');
  return notes.join('; ');
});

section('every mission, played', () => {
  // Each mission no other section plays is played here by a scripted player (campaign-player.ts),
  // and must be won. Base missions: the skirmish commander runs the base, held at home and sent at
  // the mission's target at eight minutes, with the heroes and powers scripted. The full set of plans
  // at every difficulty is `npm run sweep:fire`. Hard is checked there, not here: a scripted player
  // that loses proves little, and Hard is meant to be lost sometimes.
  const notes: string[] = [];
  const plan = BASE_PLANS.find(p => p.commander === 'normal' && p.attackAt === 8)!;
  for (const id of ['first-light', 'hold-the-ford', 'blackout', 'fireline', 'iron-coast', 'firestorm', 'last-light'])
    for (const level of ['easy', 'normal'] as const) {
      const r = playBase(id, level, plan);
      ok(r.result === 'won', `${id} ${level}: won by ${planName(plan)} (${r.result} at ${clockText(r.ticks)}${r.lostBecause ? `: ${r.lostBecause}` : ''})`);
      if (level === 'normal') notes.push(`${id} ${clockText(r.ticks)}`);
    }
  // The Quiet Man: the Spy round the north to the Uplink, the riflemen holding the extraction point.
  // Ace of Spades: the ridge held, the two tanks it brings waited for, then the sweep. Every level.
  for (const level of CAMPAIGN_LEVELS) {
    const q = playQuietMan(level, 'north', 'extraction');
    ok(q.result === 'won', `quiet-man ${level}: won (${q.result} at ${clockText(q.ticks)}${q.lostBecause ? `: ${q.lostBecause}` : ''})`);
    const a = playAceOfSpades(level, 'gather');
    ok(a.result === 'won', `ace-of-spades ${level}: won (${a.result} at ${clockText(a.ticks)}${a.lostBecause ? `: ${a.lostBecause}` : ''})`);
  }
  return `at Normal: ${notes.join(', ')}`;
});

section('act two, played', () => {
  const notes: string[] = [];
  // Convoy North: left alone, the convoy drives into the Combine posts and is lost; escorted (the
  // escort clears each post with the convoy held back, then the convoy goes on), it gets through.
  {
    let s = startOf('convoy-north');
    while (!s.mission!.result && s.tick < 8400) s = processAction(s, { type: 'tick', n: 50 });
    ok(s.mission!.result === 'lost' && s.mission!.lostBecause === 'Too much of the convoy was lost.', `convoy-north: an unescorted convoy is lost (${s.mission!.result} at ${s.tick})`);
    s = startOf('convoy-north');
    const convoy = s.mission!.convoy!;
    s = processAction(s, { type: 'stop', ids: convoy });
    const escort = () => s.units.filter(u => u.owner === 0 && !convoy.includes(u.id)).map(u => u.id);
    for (const p of [{ x: 16.5, y: 40.5 }, { x: 8.5, y: 23.5 }, { x: 17.5, y: 9.5 }, { x: 22.5, y: 4.5 }]) {
      s = processAction(s, { type: 'move', ids: escort(), x: p.x, y: p.y, attackMove: true });
      for (let i = 0; i < 40 && !s.mission!.result; i++) {
        s = processAction(s, { type: 'tick', n: 50 });
        const foes = s.units.filter(u => u.owner === 1 && Math.hypot(u.x - p.x, u.y - p.y) < 8).length;
        const ours = s.units.filter(u => u.owner === 0 && !convoy.includes(u.id) && Math.hypot(u.x - p.x, u.y - p.y) < 4).length;
        if (!foes && ours) break;
      }
    }
    const route = missionById('convoy-north')!.convoy!.route;
    s = processAction(s, { type: 'move', ids: convoy, x: route[0].x, y: route[0].y });
    for (const p of route.slice(1)) s = processAction(s, { type: 'move', ids: convoy, x: p.x, y: p.y, queue: true });
    while (!s.mission!.result && s.tick < 8400) s = processAction(s, { type: 'tick', n: 50 });
    ok(s.mission!.result === 'won', `convoy-north: an escorted convoy gets through and wins (${s.mission!.result} at ${s.tick})`);
    notes.push(`convoy escorted in ${clockText(s.tick)}`);
  }
  // The Long Hold: troops sent to the ford and kept coming hold it; the count resets when the
  // Combine has it alone. Starting troops with no reinforcement lose it.
  {
    const play = (build: boolean) => {
      let s = startOf('the-long-hold');
      let reset = false;
      let best = 0;
      for (let i = 0; i < 300 && !s.mission!.result; i++) {
        const army = s.units.filter(u => u.owner === 0 && u.kind !== 'hauler').map(u => u.id);
        if (i % 4 === 0) {
          s = processAction(s, { type: 'move', ids: army, x: 31.5, y: 32.5, attackMove: true });
          if (build) {
            for (const k of ['tank', 'tank', 'missilecarrier'] as const) s = processAction(s, { type: 'queue', category: 'vehicle', kind: k });
            s = processAction(s, { type: 'queue', category: 'infantry', kind: 'rocketeer' });
            // Gunships raid the ford: a garrison kept supplied keeps Skyhunters with it.
            if (s.units.filter(u => u.owner === 0 && u.kind === 'skyhunter').length < 4) s = processAction(s, { type: 'queue', category: 'infantry', kind: 'skyhunter' });
          }
        }
        s = processAction(s, { type: 'tick', n: 50 });
        const p = s.mission!.objectives[0].progress;
        if (p === 0 && best > 0.2) reset = true;
        best = Math.max(best, p);
      }
      return { s, reset, best };
    };
    const held = play(true);
    ok(held.s.mission!.result === 'won', `the-long-hold: a supplied garrison holds the ford (${held.s.mission!.result} at ${held.s.tick})`);
    const thin = play(false);
    ok(thin.s.mission!.result !== 'won' && thin.reset && thin.best > 0.2, `the-long-hold: starting troops alone are overrun and the count resets (best ${thin.best.toFixed(2)})`);
    notes.push(`ford held in ${clockText(held.s.tick)}`);
  }
  // Iron Coast: the skirmish commander, playing side 0 with what the mission gives, clears the shore.
  {
    let s = startOf('iron-coast');
    s.autopilot = true;
    while (!s.mission!.result && s.tick < 18000) s = processAction(s, { type: 'tick', n: 100 });
    ok(s.mission!.result === 'won', `iron-coast: won by the skirmish commander playing side 0 (${s.mission!.result} at ${s.tick})`);
    notes.push(`shore cleared in ${clockText(s.tick)}`);
  }
  // Bastion Line: the skirmish commander runs the base; from six minutes the army is sent at each
  // Rocket Turret in turn, then onto the ground to hold. The line breaks and the ground is held.
  {
    let s = startOf('bastion-line');
    s.autopilot = true;
    for (let i = 0; i < 1200 && !s.mission!.result; i++) {
      if (i % 8 === 0 && s.tick > 3600) {
        const army = s.units.filter(u => u.owner === 0 && u.kind !== 'hauler' && !u.hero).map(u => u.id);
        const turret = s.buildings.find(b => b.owner === 1 && b.kind === 'rocketturret');
        const goal = turret ? centreOf(turret) : { x: 42.5, y: 24.5 };
        if (army.length >= 10) s = processAction(s, { type: 'move', ids: army, x: goal.x, y: goal.y, attackMove: true });
      }
      s = processAction(s, { type: 'tick', n: 25 });
    }
    ok(s.mission!.result === 'won', `bastion-line: the line is broken and the ground held (${s.mission!.result} at ${s.tick})`);
    notes.push(`line broken in ${clockText(s.tick)}`);
  }
  // Firestorm: the Commando at the Strike Command inside eight minutes stops the first missile.
  {
    let s = clone(startOf('firestorm'));
    const sc = s.buildings.find(b => b.owner === 1 && b.kind === 'strikecommand')!;
    ok(s.powers![1].missile === POWERS.missile.cooldown, 'firestorm: the Strike Command is charging its first missile');
    const cmd = s.units.find(u => u.owner === 0 && u.kind === 'commando')!;
    // The harness walks him to its door; everything that would shoot him first is cleared away.
    s.units = s.units.filter(u => u.owner === 0);
    s.buildings = s.buildings.filter(b => b.owner === 0 || !BUILDINGS[b.kind].weapon);
    const c = centreOf(sc);
    cmd.x = c.x;
    cmd.y = sc.y + BUILDINGS.strikecommand.h + 0.5;
    s = processAction(s, { type: 'ability', id: cmd.id, target: sc.id });
    for (let i = 0; i < 10; i++) s = processAction(s, { type: 'tick', n: 10 });
    ok(!s.buildings.some(b => b.id === sc.id), 'firestorm: one charge brings the Strike Command down');
    ok(s.mission!.objectives[0].done && s.mission!.bonus[0].done, 'firestorm: its objective and the eight-minute bonus are done');
    ok(s.powers![1].missile === undefined, 'firestorm: the enemy has no missile left');
    s = processAction(s, { type: 'tick', n: 5000 });
    ok(!s.projectiles.some(p => p.owner === 1 && p.weapon === 'missile') && !s.log.some(l => l.text.startsWith('Enemy missile')), 'firestorm: and none is ever launched');
  }
  // Last Light: both sides' structure powers, the enemy's on hard.
  {
    const s = startOf('last-light');
    ok(s.difficulty === 'normal' && s.powers![1].missile !== undefined && s.powers![1].barrage !== undefined, 'last-light: the enemy holds the missile and the barrage');
    ok(s.powers![0].recon === 0 && s.powers![0].barrage === 0 && s.powers![0].reinforce === 0, 'last-light: our three powers are ready at the start');
    ok(s.powers![0].missile === undefined, 'last-light: no missile for us until we build a Strike Command');
  }
  return notes.join('; ');
});


// ---- Territory and engagements ---------------------------------------------------------------

const REGIONS = theatreRegions();
/** The placeholder theatre (two boxes) stands in until the real country lands; mission placement is then skipped. */
const PLACEHOLDER = REGIONS.every(r => r.id.startsWith('placeholder-'));
const ENGAGEMENT_REGIONS = REGIONS.filter(isEngagementRegion);
const engOutcome = (regionId: string, o: Partial<MissionOutcome>): MissionOutcome => ({
  missionId: `eng:${regionId}`,
  won: true,
  stars: 1,
  ticks: 6000,
  kills: 0,
  losses: 0,
  heroes: {},
  ...o,
});
/** Every story mission won up to (not including) this order: the campaign as it stands then. */
const campaignBeforeOrder = (order: number): CampaignState => (order > MISSIONS.length ? applyOutcome(campaignAt(MISSIONS[MISSIONS.length - 1].id, 'normal'), MISSIONS[MISSIONS.length - 1], outcome(MISSIONS[MISSIONS.length - 1], {})) : campaignAt(MISSIONS[order - 1].id, 'normal'));
const actOfMission = (m: MissionSpec) => (m.order <= 8 ? 0 : 1);

section('theatre geometry', () => {
  const ids = new Set(REGIONS.map(r => r.id));
  ok(ids.size === REGIONS.length, 'region ids unique');
  ok(PLACEHOLDER || (REGIONS.length >= 20 && REGIONS.length <= 40), `a country of 20 to 40 regions (${REGIONS.length})`);
  const inUnit = (p: [number, number]) => p.length === 2 && p.every(v => Number.isFinite(v) && v >= 0 && v <= 1);
  for (const r of REGIONS) {
    ok(/^[a-z0-9-]{1,40}$/.test(r.id), `${r.id}: id is short, lower case and dashed`);
    ok(r.name.trim().length > 0 && r.name.length <= 32, `${r.id}: a name`);
    ok(r.act === 0 || r.act === 1, `${r.id}: act 0 or 1`);
    ok(r.kind === 'province' || r.kind === 'city', `${r.id}: province or city`);
    ok(inUnit(r.site), `${r.id}: site in map space`);
    ok(r.polygon.length >= 3 && r.polygon.every(inUnit), `${r.id}: an outline of 3 or more points in map space`);
    ok(r.neighbours.length > 0, `${r.id}: borders something`);
    ok(new Set(r.neighbours).size === r.neighbours.length && !r.neighbours.includes(r.id), `${r.id}: neighbours listed once, never itself`);
    for (const n of r.neighbours) {
      const nr = regionById(n);
      ok(!!nr, `${r.id}: neighbour ${n} exists`);
      ok(!!nr && nr.neighbours.includes(r.id), `${r.id} and ${n}: neighbours both ways`);
    }
    if (r.missionId) ok(!!missionById(r.missionId), `${r.id}: mission ${r.missionId} exists`);
    if (r.home) ok(!r.missionId && r.act === 0, `${r.id}: home ground is act one and holds no mission`);
  }
  const homes = REGIONS.filter(r => r.home);
  ok(homes.length >= 1, `home ground exists (${homes.map(r => r.id).join(', ')})`);
  // Connected: every region reached from home through borders.
  const seen = new Set<string>(homes.map(r => r.id));
  for (const q = [...seen]; q.length; ) for (const n of regionById(q.shift()!)?.neighbours ?? []) if (!seen.has(n)) (seen.add(n), q.push(n));
  ok(seen.size === REGIONS.length, `the theatre is connected (${seen.size} of ${REGIONS.length} reached from home)`);
  if (PLACEHOLDER) return 'SKIPPED mission placement: the placeholder theatre is still in place';
  for (const m of MISSIONS) {
    const holders = REGIONS.filter(r => r.missionId === m.id);
    ok(holders.length === 1, `${m.id}: fought in exactly one region (${holders.length})`);
    if (holders[0]) ok(holders[0].act === actOfMission(m), `${m.id}: its region is on its act's front`);
  }
  // Every engagement region can be taken: with the whole story won, keep taking what is open.
  let c = campaignBeforeOrder(MISSIONS.length + 1);
  for (let guard = 0; guard < REGIONS.length; guard++) {
    const open = openEngagements(c);
    if (!open.length) break;
    for (const r of open) c = applyEngagementOutcome(c, r.id, engOutcome(r.id, {}));
  }
  const untaken = ENGAGEMENT_REGIONS.filter(r => !c.engagements[r.id]?.won).map(r => r.id);
  ok(untaken.length === 0, `every engagement region can be reached and taken (not: ${untaken.join(', ')})`);
  ok(territoryHeld(c).held === REGIONS.length, 'the whole country held at the end');
  return `${REGIONS.length} regions: ${REGIONS.filter(r => r.missionId).length} missions, ${ENGAGEMENT_REGIONS.length} engagements`;
});

section('territory rules', () => {
  const fresh = deepFreeze(newCampaign('T'));
  const homes = REGIONS.filter(r => r.home);
  const home = homes[0];
  ok(homes.every(h => regionControl(fresh, h.id) === 'held'), 'home ground is held');
  ok(REGIONS.filter(r => regionControl(fresh, r.id) === 'held').length === homes.length, 'a fresh campaign holds only home ground');
  const wantOpen = REGIONS.filter(r => isEngagementRegion(r) && r.act === 0 && homes.some(h => h.neighbours.includes(r.id))).map(r => r.id).sort();
  const isOpen = REGIONS.filter(r => regionControl(fresh, r.id) === 'open').map(r => r.id).sort();
  ok(JSON.stringify(isOpen) === JSON.stringify(wantOpen), `a fresh campaign opens exactly home's non-mission neighbours (${isOpen.join(', ')})`);
  ok(!actReachable(fresh, 1) && actReachable(fresh, 0), 'act two is shut at the start');
  ok(REGIONS.filter(r => r.act === 1).every(r => regionControl(fresh, r.id) === 'enemy'), 'no act two region is open at the start');
  for (const r of REGIONS.filter(x => x.missionId)) ok(regionControl(fresh, r.id) !== 'open', `${r.id}: a mission region is never "open"`);

  // The view says what the rules say.
  const view = theatreView(fresh, 0, home.id);
  ok(REGIONS.every(r => view.control[r.id] === regionControl(fresh, r.id)), 'the view carries every region\'s control');
  ok(view.engagements.length === ENGAGEMENT_REGIONS.length, 'one engagement per region without a mission, home aside');
  ok(view.engagements.every(e => e.state === (isOpen.includes(e.regionId) ? 'open' : 'locked')), 'engagement states match control');
  ok(PLACEHOLDER || view.missions.length === MISSIONS.length, 'every mission on the view');
  ok(view.missions.every(m => regionById(m.regionId)?.missionId === m.id), 'each mission on the view names its region');
  ok(view.selected === home.id && theatreView(fresh, 0, 'nowhere').selected === undefined, 'selected kept, an unknown one dropped');

  // Winning an engagement holds it and opens its act-one neighbours.
  const first = openEngagements(fresh)[0];
  ok(!!first, 'something is open at the start');
  if (first) {
    const lost = applyEngagementOutcome(fresh, first.id, engOutcome(first.id, { won: false, stars: 0, kills: 4 }));
    ok(lost !== fresh && lost.engagements[first.id]?.won === false && regionControl(lost, first.id) === 'open', 'a lost engagement is recorded and stays open');
    const spec = engagementSpec(fresh, first.id)!;
    ok(lost.commander.xp === Math.floor(spec.rewards.xp * 0.25) + 8, `a loss pays the loss share plus kills (${lost.commander.xp})`);
    const c1 = applyEngagementOutcome(fresh, first.id, engOutcome(first.id, { stars: 2, kills: 5 }));
    ok(regionControl(c1, first.id) === 'held', 'a won engagement holds its region');
    ok(c1.engagements[first.id].stars === 2 && c1.engagements[first.id].bestTicks === 6000, 'its stars and time are recorded');
    ok(c1.commander.xp === Math.round(spec.rewards.xp * 1.25) + 10, `xp: the reward, a quarter more for the extra star, and kills (${c1.commander.xp})`);
    const story = MISSIONS[0].rewards.xp;
    ok(spec.rewards.xp >= story * 0.4 && spec.rewards.xp <= story * 0.6, `about half a story mission's xp (${spec.rewards.xp} against ${story})`);
    for (const n of first.neighbours) {
      const nr = regionById(n)!;
      if (isEngagementRegion(nr) && nr.act === 0) ok(regionControl(c1, n) !== 'enemy', `${n}: opened by taking ${first.id}`);
    }
    ok(missionsWon(c1) === 0 && !campaignComplete(c1) && c1.tech.length === 0 && c1.lastMission === null, 'an engagement is never a mission won, and unlocks nothing');
    ok(JSON.stringify(c1.heroes) === JSON.stringify(fresh.heroes) && JSON.stringify(c1.missions) === JSON.stringify(fresh.missions), 'heroes and missions untouched');
    const again = applyEngagementOutcome(c1, first.id, engOutcome(first.id, { won: false, stars: 0 }));
    ok(again.engagements[first.id].won && again.engagements[first.id].stars === 2, 'losing a rematch keeps the region and the best stars');
    ok(engagementProblem(c1, first.id) === null, 'a won engagement may be fought again');
    ok(territoryHeld(c1).held === homes.length + 1 && territoryHeld(fresh).held === homes.length, 'territory counts held regions');
  }

  // Act two's regions stay shut until its first mission opens, then open from held ground.
  const beforeAct2 = campaignBeforeOrder(8);
  const atAct2 = campaignBeforeOrder(9);
  ok(!actReachable(beforeAct2, 1) && actReachable(atAct2, 1), 'act two opens with its first mission');
  ok(REGIONS.filter(r => r.act === 1).every(r => regionControl(beforeAct2, r.id) !== 'open'), 'no act two region opens before act two');
  if (!PLACEHOLDER) {
    // With everything in act one taken, act two's regions on the border open once act two begins.
    let all1 = campaignBeforeOrder(9);
    for (let g = 0; g < REGIONS.length; g++) for (const r of openEngagements(all1, 0)) all1 = applyEngagementOutcome(all1, r.id, engOutcome(r.id, {}));
    ok(openEngagements(all1, 1).length > 0 || REGIONS.some(r => r.act === 1 && regionControl(all1, r.id) === 'held'), 'act two has ground to fight for once it opens');
  }

  // Unknown, illegal and non-engagement ids are ignored, never thrown on.
  ok(regionControl(fresh, 'nowhere') === 'enemy' && regionControl(fresh, '') === 'enemy', 'an unknown region reads as enemy ground');
  ok(engagementSpec(fresh, 'nowhere') === undefined && engagementSpec(fresh, home.id) === undefined, 'no engagement for an unknown region or home');
  ok(applyEngagementOutcome(fresh, 'nowhere', engOutcome('nowhere', {})) === fresh, 'an unknown region changes nothing');
  ok(applyEngagementOutcome(fresh, home.id, engOutcome(home.id, {})) === fresh, 'home cannot be fought for');
  const missionRegion = REGIONS.find(r => r.missionId);
  if (missionRegion) ok(applyEngagementOutcome(fresh, missionRegion.id, engOutcome(missionRegion.id, {})) === fresh, 'a mission region has no engagement');
  const shut = REGIONS.find(r => isEngagementRegion(r) && regionControl(fresh, r.id) === 'enemy');
  if (shut) {
    ok(applyEngagementOutcome(fresh, shut.id, engOutcome(shut.id, {})) === fresh, `${shut.id}: an engagement out of reach cannot be won`);
    ok(!!engagementProblem(fresh, shut.id), `${shut.id}: and says why`);
  }
  ok(!isEngagementId('first-light') && isEngagementId('eng:x') && regionOfEngagement('eng:nowhere') === undefined, 'engagement ids told apart');
  ok(battleSpec(fresh, 'first-light') === missionById('first-light') && battleSpec(fresh, 'eng:nowhere') === undefined && battleSpec(fresh, null) === undefined, 'battleSpec finds missions and engagements');

  // Saves: an older campaign has no engagements; unknown regions are kept and ignored.
  const old = newCampaignSave('id-eng', 'Old', 'Cmdr', 0) as unknown as { campaign: Record<string, unknown> };
  delete old.campaign.engagements;
  ok(JSON.stringify(migrateCampaignSave(clone(old))!.campaign.engagements) === '{}', 'a campaign from before engagements loads with none');
  const withJunk = clone(old);
  withJunk.campaign.engagements = { gone: { won: true, stars: 2 }, [first?.id ?? 'x']: { won: 'yes', stars: -3 }, bad: 7 };
  const mj = migrateCampaignSave(withJunk)!.campaign;
  ok(mj.engagements.gone?.won === true && mj.engagements.gone.stars === 2 && mj.engagements.gone.bestTicks === null, 'a record for an unknown region is kept');
  ok(!('bad' in mj.engagements) && (!first || (mj.engagements[first.id].won === false && mj.engagements[first.id].stars === 0)), 'junk records repaired or dropped');
  ok(territoryHeld(mj).held === homes.length && openEngagements(mj).length === wantOpen.length, 'and ignored by the rules');
  const arr = clone(old);
  arr.campaign.engagements = [1, 2];
  ok(JSON.stringify(migrateCampaignSave(arr)!.campaign.engagements) === '{}', 'an array of engagements reads as none');
  const cur = newCampaignSave('id-cur', 'C', 'C', 0);
  if (first) cur.campaign = applyEngagementOutcome(cur.campaign, first.id, engOutcome(first.id, {}));
  ok(JSON.stringify(migrateCampaignSave(clone(cur))) === JSON.stringify(cur), 'a save with engagements migrates unchanged');
});

section('engagement specs', () => {
  // Each engagement at three points of its act, at every difficulty: valid, deterministic, built,
  // and (at the first point of its act) run for two minutes with the computer playing both sides.
  let built = 0;
  let ran = 0;
  for (const r of ENGAGEMENT_REGIONS) {
    const orders = r.act === 0 ? [1, 5, 9] : [9, 12, 15];
    orders.forEach((order, oi) => {
      const base = campaignBeforeOrder(order);
      for (const level of CAMPAIGN_LEVELS) {
        const c: CampaignState = { ...base, difficulty: level };
        const L = `${r.id} at mission ${order} ${level}`;
        const spec = engagementSpec(c, r.id)!;
        ok(!!spec, `${L}: has a spec`);
        if (!spec) continue;
        ok(JSON.stringify(engagementSpec(c, r.id)) === JSON.stringify(spec), `${L}: the same spec every time`);
        ok(spec.id === `eng:${r.id}` && spec.order === 0 && !missionById(spec.id), `${L}: an engagement id, order 0`);
        ok(spec.title === r.name && spec.summary.length > 0 && spec.summary.length <= 80, `${L}: title and summary`);
        ok(spec.briefing.length >= 2 && spec.briefing.length <= 4 && spec.briefing.every(p => p.length > 20 && p.length < 400), `${L}: 2 to 4 briefing paragraphs`);
        ok(spec.seed.length > 0 && spec.seed.length <= 64 && !MISSIONS.some(m => m.seed === spec.seed), `${L}: its own seed`);
        ok(spec.player.heroes.length === 0 && spec.player.structures.includes('hq'), `${L}: a base, no heroes`);
        ok([...spec.player.units, ...spec.enemy.units].every(isUnit), `${L}: real unit kinds`);
        ok(spec.enemy.structures.every(b => isBuilding(b) && b !== 'hq') && spec.enemy.structures.length > 0, `${L}: real enemy structures`);
        const allowed = new Set<string>([...ACT_BASICS[r.act], ...c.tech]);
        ok(spec.tech.every(k => allowed.has(k)), `${L}: only tech the campaign has`);
        ok([...spec.player.units, ...spec.enemy.units].every(k => allowed.has(k)), `${L}: only troops the campaign has met`);
        ok(spec.enemy.base === 'full' || spec.enemy.ai !== 'raid' || spec.enemy.structures.some(b => b === 'barracks' || b === 'factory'), `${L}: a raiding outpost can train`);
        ok(spec.triggers.length === 0 && !spec.convoy && spec.timeLimit === undefined, `${L}: no scripted waves, convoy or clock`);
        const coords = [...spec.objectives, ...spec.bonus].some(o => 'x' in o);
        ok(!coords, `${L}: no hand-picked points`);
        ok(spec.objectives.every(o => o.kind === 'destroyAll' || (o.kind === 'destroy' && spec.enemy.structures.concat(spec.enemy.base === 'full' ? ['hq'] : []).includes(o.building))), `${L}: objectives the enemy can lose`);
        for (const b of spec.bonus) if (b.kind === 'destroyWithin') ok(spec.enemy.structures.filter(x => x === b.building).length >= b.count, `${L}: bonus targets exist`);
        ok(spec.rewards.xp > 0 && !spec.rewards.unlockTech && !spec.rewards.unlockHeroes, `${L}: xp and nothing else`);
        const scaled = campaignMission(c, spec);
        const s = createMissionState(scaled, missionContext(c, scaled, `eng-${r.id}`, 1000));
        built++;
        ok(s.mission?.id === spec.id && (s.mission.level ?? 'normal') === level, `${L}: built at its difficulty`);
        ok(s.units.filter(u => u.owner === 1 && u.kind !== 'hauler').length === scaled.enemy.units.length, `${L}: the garrison is placed`);
        ok(s.buildings.some(b => b.owner === 0 && b.kind === 'hq'), `${L}: our Command Yard is placed`);
        if (oi === 0) {
          let cur = { ...s, autopilot: true };
          for (let i = 0; i < 12 && !cur.mission!.result; i++) cur = processAction(cur, { type: 'tick', n: 100 });
          ok(cur.tick >= 1200 || !!cur.mission!.result, `${L}: runs two minutes (${cur.tick})`);
          ok(cur.units.every(u => Number.isFinite(u.x) && Number.isFinite(u.y)), `${L}: units sane`);
          ran++;
        }
      }
    });
  }
  return `${built} engagement battles built, ${ran} run for two minutes`;
});

section('engagements, played', () => {
  // A seeded sample of engagements at Normal, each at the first point of its act, played by the
  // scripted base player (the commander held at home, the army sent at twelve minutes): every one
  // must be won. The whole set would cost a minute; the sample changes only with the theatre.
  const plan = BASE_PLANS.find(p => p.commander === 'normal' && p.attackAt === 12)!;
  const sample = [...ENGAGEMENT_REGIONS].sort((a, b) => seedFromString(`sample:${a.id}`) - seedFromString(`sample:${b.id}`)).slice(0, 6);
  const notes: string[] = [];
  for (const r of sample) {
    const c = campaignBeforeOrder(r.act === 0 ? 3 : 10);
    const res = playEngagement(c, r.id, plan, 40);
    ok(res.result === 'won', `${r.id}: won by ${planName(plan)} (${res.result} at ${clockText(res.ticks)}${res.lostBecause ? `: ${res.lostBecause}` : ''})`);
    notes.push(`${r.id} ${clockText(res.ticks)}`);
  }
  return `${sample.length} of ${ENGAGEMENT_REGIONS.length} won at Normal: ${notes.join(', ')}`;
});

// ---- Summary ---------------------------------------------------------------------------------
console.log('\nFireline campaign check');
for (const s of sections) {
  const mark = s.failures ? 'FAIL' : 'ok  ';
  console.log(`  ${mark} ${s.name.padEnd(36)} ${String(s.assertions).padStart(5)} checks${s.failures ? `, ${s.failures} failed` : ''}${s.note ? `  (${s.note})` : ''}`);
}
console.log(`\n${assertions} assertions, ${failures} failures`);
process.exit(failures ? 1 : 0);
