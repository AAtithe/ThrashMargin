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
  perkModifiers,
  perkProblem,
  PERKS,
  POINTS_PER_RANK,
  rankFor,
  rankProgress,
  RANKS,
} from '../src/campaign/progression';
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
import { createMissionState } from '../src/sim/mission';
import { seedFromString } from '../src/sim/rng';
import {
  BUILDINGS,
  DIFFICULTIES,
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
  ok(CAMPAIGN_LENGTH === 8, 'eight missions');
});

// ---- Mission specs against their maps --------------------------------------------------------
const isBuilding = (k: string): k is BuildingKind => k in BUILDINGS;
const isUnit = (k: string): k is UnitKind => k in UNITS && !UNITS[k as UnitKind].hero;
const isHero = (k: string): k is HeroKind => (HERO_KINDS as string[]).includes(k);

section('mission specs', () => {
  ok(MISSIONS.length === 8, 'eight missions');
  ok(new Set(MISSIONS.map(m => m.id)).size === MISSIONS.length, 'mission ids unique');
  ok(new Set(MISSIONS.map(m => m.seed)).size === MISSIONS.length, 'mission seeds unique');
  MISSIONS.forEach((m, i) => ok(m.order === i + 1, `${m.id} is mission ${i + 1}`));
  ok(MISSIONS[MISSIONS.length - 1].id === 'fireline' && MISSIONS[0].id === 'first-light', 'starts with First Light, ends with Fireline');

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
    for (const t of m.tech) ok(tech.has(t), `${L}: tech ${t} is unlocked by this point in the campaign`);
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

// ---- Summary ---------------------------------------------------------------------------------
console.log('\nFireline campaign check');
for (const s of sections) {
  const mark = s.failures ? 'FAIL' : 'ok  ';
  console.log(`  ${mark} ${s.name.padEnd(36)} ${String(s.assertions).padStart(5)} checks${s.failures ? `, ${s.failures} failed` : ''}${s.note ? `  (${s.note})` : ''}`);
}
console.log(`\n${assertions} assertions, ${failures} failures`);
process.exit(failures ? 1 : 0);
