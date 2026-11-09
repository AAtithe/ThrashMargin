/**
 * Campaign act two in the drive harness (fireline-round4-design.md, workstream C): the new
 * objective kinds (escort, destroyWithin, holdZone with reset), the convoy, and structure powers in
 * a mission, each proved by what happens in the simulation. The missions here are built by hand,
 * as the harness's other campaign sections build theirs; the real act-two missions are checked
 * against their maps in scripts/campaign-check.ts.
 *
 * drive.ts imports `sections` and runs them among its campaign sections, so these assertions count
 * in its totals and run under `--campaign` too.
 */
import { processAction } from '../src/sim/actions';
import { setAutopilotAi } from '../src/sim/ai';
import { buildingCentre, occupancy, passable } from '../src/sim/grid';
import { createMissionState, missionOutcome, objectiveLabel } from '../src/sim/mission';
import { POWERS, type Owner, type UnitKind } from '../src/sim/rules';
import { addBuilding, addUnit, migrateState } from '../src/sim/state';
import type { GameState, MissionContext, MissionSpec, ObjectiveSpec, Unit } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

// ---- A few helpers, copied from drive.ts rather than exported from it ---------------------------

function mspec(over: Partial<MissionSpec> = {}): MissionSpec {
  return {
    id: 'act2-test',
    order: 9,
    title: 'Act Two Test',
    briefing: ['A test.'],
    summary: 'A mission built by the harness.',
    seed: 'mission-test',
    difficulty: 'normal',
    player: { credits: 2000, structures: [], units: ['rifleman'], heroes: [] },
    enemy: { credits: 0, base: 'outpost', structures: ['power'], units: [], ai: 'passive' },
    tech: ['power', 'barracks', 'rifleman'],
    powers: [],
    objectives: [{ kind: 'destroyAll' }],
    bonus: [],
    triggers: [],
    rewards: { xp: 100 },
    ...over,
  };
}

const mctx = (over: Partial<MissionContext> = {}): MissionContext => ({
  id: 'a2',
  name: 'Mission',
  createdAt: 0,
  perks: { harvestMul: 1, buildSpeedMul: 1, costMul: 1, unitHpMul: 1, powerCooldownMul: 1, extraStartCredits: 0 },
  heroes: {},
  extraTech: [],
  extraPowers: [],
  ...over,
});

const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

function quiet(s: GameState): GameState {
  for (const m of s.ai) m.nextAttack = 1e9;
  s.players[1].credits = 0;
  s.units = s.units.filter(u => !(u.owner === 1 && u.kind === 'hauler'));
  return s;
}

function put(s: GameState, owner: Owner, kind: UnitKind, x: number, y: number, extra: Partial<Unit> = {}): Unit {
  const u = addUnit(s, owner, kind, x, y);
  Object.assign(u, extra);
  return u;
}

function tickUntil(s: GameState, done: (s: GameState) => boolean, max: number): GameState {
  for (let i = 0; i < max && !done(s); i++) s = processAction(s, { type: 'tick' });
  return s;
}

/** The computer's commander switched off for side 1 while fn runs, as drive.ts's noCommander does. */
function noCommander(fn: (ok: Ok) => void): (ok: Ok) => void {
  return ok => {
    setAutopilotAi(() => {}, 1);
    try {
      fn(ok);
    } finally {
      setAutopilotAi(null, 1);
    }
  };
}

/** The passable tile nearest (x, y), as a tile centre. */
function open(s: GameState, x: number, y: number): { x: number; y: number } {
  const occ = occupancy(s);
  for (let r = 0; r < 12; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) if (passable(s, occ, Math.floor(x) + dx, Math.floor(y) + dy)) return { x: Math.floor(x) + dx + 0.5, y: Math.floor(y) + dy + 0.5 };
  throw new Error(`no open ground near ${x}, ${y}`);
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// ---- Labels -----------------------------------------------------------------------------------

function labels(ok: Ok): void {
  const want: [ObjectiveSpec, string][] = [
    [{ kind: 'destroyWithin', building: 'techcentre', count: 1, ticks: 4800 }, 'Destroy the enemy Tech Centre within 8 minutes'],
    [{ kind: 'destroyWithin', building: 'rocketturret', count: 2, ticks: 900 }, 'Destroy 2 enemy Rocket Turrets within 1 minute 30 seconds'],
    [{ kind: 'destroyWithin', building: 'strikecommand', count: 1, ticks: 450 }, 'Destroy the enemy Strike Command within 45 seconds'],
    [{ kind: 'escort', x: 3, y: 3, r: 2, count: 3 }, 'Bring 3 convoy vehicles to the marked point'],
    [{ kind: 'escort', x: 3, y: 3, r: 2, count: 1 }, 'Bring a convoy vehicle to the marked point'],
    [{ kind: 'holdZone', x: 3, y: 3, r: 2, ticks: 2400, reset: true }, 'Hold the marked area for 4 minutes without losing it'],
    [{ kind: 'holdZone', x: 3, y: 3, r: 2, ticks: 1800, reset: false }, 'Hold the marked area for 3 minutes'],
    [{ kind: 'holdZone', x: 3, y: 3, r: 2, ticks: 1800 }, 'Hold the marked area for 3 minutes'],
  ];
  for (const [o, text] of want) ok(objectiveLabel(o) === text, `label: "${objectiveLabel(o)}" is "${text}"`);
  for (const [o] of want) ok(!/—/.test(objectiveLabel(o)), 'labels carry no em dash');
  // The label is also what the runtime objective carries.
  const s = createMissionState(mspec({ objectives: [want[0][0]], bonus: [want[5][0]] }), mctx());
  ok(s.mission!.objectives[0].label === want[0][1] && s.mission!.bonus[0].label === want[5][1], 'the runtime objectives carry the labels');
}

// ---- holdZone, with and without reset ---------------------------------------------------------

function holdZone(ok: Ok): void {
  for (const reset of [false, true]) {
    const tag = reset ? 'with reset' : 'without reset';
    const base = quiet(copy(createMissionState(mspec({ objectives: [{ kind: 'holdZone', x: 30, y: 30, r: 3, ticks: 40, reset }] }), mctx())));
    const k = open(base, 30, 30);
    base.mission!.objectives[0].spec = { kind: 'holdZone', x: k.x, y: k.y, r: 3, ticks: 40, reset };
    const me = base.units.find(u => u.owner === 0)!;
    me.x = k.x;
    me.y = k.y;
    me.stance = 'hold';
    // Half held, alone.
    const half = processAction(base, { type: 'tick', n: 20 });
    ok(near(half.mission!.objectives[0].progress, 0.5), `${tag}: holding alone counts (${half.mission!.objectives[0].progress})`);
    // Contested: an enemy in the zone with ours still there. Paused either way, never reset.
    const c0 = copy(half);
    const foe = put(c0, 1, 'rifleman', k.x + 1, k.y, { stance: 'hold' });
    const contested = processAction(c0, { type: 'tick', n: 15 });
    ok(near(contested.mission!.objectives[0].progress, 0.5), `${tag}: contested, the count pauses (${contested.mission!.objectives[0].progress})`);
    // Lost: ours gone from the zone, the enemy alone in it.
    const l0 = copy(contested);
    const mine = l0.units.find(u => u.id === me.id)!;
    const away = open(l0, k.x - 8, k.y + 6);
    mine.x = away.x;
    mine.y = away.y;
    const lost = processAction(l0, { type: 'tick', n: 3 });
    ok(lost.units.some(u => u.id === foe.id), `${tag}: the enemy is still standing in the zone`);
    if (reset) ok(lost.mission!.objectives[0].progress === 0, `${tag}: the enemy holding it alone drops the count to nothing`);
    else ok(near(lost.mission!.objectives[0].progress, 0.5), `${tag}: the enemy holding it alone only pauses the count (${lost.mission!.objectives[0].progress})`);
    // Retaken: the enemy gone, ours back. Counting resumes from where it stands.
    const r0 = copy(lost);
    r0.units = r0.units.filter(u => u.id !== foe.id);
    const back = r0.units.find(u => u.id === me.id)!;
    back.x = k.x;
    back.y = k.y;
    back.order = { type: 'idle' };
    back.path = [];
    const again = processAction(r0, { type: 'tick', n: 20 });
    ok(near(again.mission!.objectives[0].progress, reset ? 0.5 : 1), `${tag}: counting resumes (${again.mission!.objectives[0].progress})`);
    const end = tickUntil(again, q => q.mission!.result !== null, 60);
    ok(end.mission!.result === 'won' && end.mission!.objectives[0].done, `${tag}: held for the whole time, the mission is won`);
    ok(end.tick === (reset ? 18 + 20 + 20 + 20 : 18 + 20 + 20), `${tag}: won on the tick the count completed (${end.tick})`);
    // An empty zone neither counts nor resets.
    const e0 = copy(half);
    const gone = e0.units.find(u => u.id === me.id)!;
    gone.x = away.x;
    gone.y = away.y;
    const empty = processAction(e0, { type: 'tick', n: 10 });
    ok(near(empty.mission!.objectives[0].progress, 0.5), `${tag}: an empty zone keeps its count`);
  }
}

// ---- destroyWithin ----------------------------------------------------------------------------

function destroyWithin(ok: Ok): void {
  const spec = (ticks: number, count = 1, asBonus = false): MissionSpec =>
    mspec({
      enemy: { credits: 0, base: 'outpost', structures: ['power', 'power', 'barracks'], units: [], ai: 'passive' },
      objectives: asBonus ? [{ kind: 'survive', ticks: 400 }] : [{ kind: 'destroyWithin', building: 'power', count, ticks }],
      bonus: asBonus ? [{ kind: 'destroyWithin', building: 'power', count, ticks }] : [],
    });
  const kill = (s: GameState, id: number) => {
    const c = copy(s);
    const b = c.buildings.find(x => x.id === id)!;
    b.hp = 1;
    const at = buildingCentre(b);
    const p = open(c, at.x, at.y + 2);
    put(c, 0, 'rocketeer', p.x, p.y);
    return tickUntil(c, q => !q.buildings.some(x => x.id === id), 200);
  };
  // Done in time.
  {
    const s = quiet(copy(createMissionState(spec(300, 2), mctx())));
    const gens = s.buildings.filter(b => b.owner === 1 && b.kind === 'power');
    const a = kill(s, gens[0].id);
    ok(near(a.mission!.objectives[0].progress, 0.5) && !a.mission!.objectives[0].done && !a.mission!.objectives[0].failed, 'one of two destroyed: half way');
    const b = kill(a, gens[1].id);
    const w = tickUntil(b, q => q.mission!.result !== null, 5);
    ok(w.mission!.objectives[0].done && w.mission!.result === 'won', `both destroyed inside the time: done and won (tick ${w.tick})`);
    ok(w.tick <= 300, 'and inside the time');
  }
  // Too late: failed on the tick after the limit, the mission lost with the reason.
  {
    const s = quiet(copy(createMissionState(spec(30), mctx())));
    const at30 = processAction(s, { type: 'tick', n: 30 });
    ok(!at30.mission!.objectives[0].failed && at30.mission!.result === null, 'at the limit itself, still open');
    const at31 = processAction(at30, { type: 'tick' });
    ok(at31.mission!.objectives[0].failed && at31.mission!.result === 'lost', 'one tick past the limit: failed, and the mission lost');
    ok(at31.mission!.lostBecause === 'Destroy the enemy Generator within 3 seconds: time ran out.', `lost because: ${at31.mission!.lostBecause}`);
    ok(at31.winner === 1 && missionOutcome(at31)!.won === false, 'the outcome is a defeat');
  }
  // A failed one stays failed: destroying the structure afterwards counts for nothing.
  {
    const s = quiet(copy(createMissionState(spec(20, 1, true), mctx())));
    const late = processAction(s, { type: 'tick', n: 25 });
    ok(late.mission!.bonus[0].failed && late.mission!.result === null, 'a late bonus fails; the mission goes on');
    const gen = late.buildings.find(b => b.owner === 1 && b.kind === 'power')!;
    const after = kill(late, gen.id);
    ok(after.mission!.bonus[0].failed && !after.mission!.bonus[0].done && after.mission!.bonus[0].progress === 0, 'destroyed afterwards: still failed, no progress');
    const end = tickUntil(after, q => q.mission!.result !== null, 500);
    ok(end.mission!.result === 'won' && missionOutcome(end)!.stars === 1, 'the mission is won without the star');
  }
  // A bonus done in time earns its star.
  {
    const s = quiet(copy(createMissionState(spec(200, 1, true), mctx())));
    const gen = s.buildings.find(b => b.owner === 1 && b.kind === 'power')!;
    const a = kill(s, gen.id);
    ok(a.mission!.bonus[0].done, 'a bonus destroyed in time is done');
    const end = tickUntil(processAction(a, { type: 'tick', n: 250 }), q => q.mission!.result !== null, 300);
    ok(end.mission!.bonus[0].done && !end.mission!.bonus[0].failed && missionOutcome(end)!.stars === 2, 'and stays done past its time: two stars');
  }
}

// ---- Escort and the convoy --------------------------------------------------------------------

const ROUTE = [
  { x: 13.5, y: 52.5 },
  { x: 21.5, y: 55.5 },
  { x: 28.5, y: 50.5 },
];

function convoySpec(over: Partial<MissionSpec> = {}): MissionSpec {
  return mspec({
    player: { credits: 0, structures: [], units: [], heroes: [] },
    convoy: { kinds: ['hauler', 'hauler', 'hauler'], x: 12.5, y: 58.5, route: ROUTE },
    objectives: [{ kind: 'escort', x: 28.5, y: 50.5, r: 2, count: 2 }],
    bonus: [{ kind: 'escort', x: 28.5, y: 50.5, r: 2, count: 3 }],
    timeLimit: 6000,
    ...over,
  });
}

function escort(ok: Ok): void {
  const s0 = quiet(copy(createMissionState(convoySpec(), mctx())));
  const ids = s0.mission!.convoy!;
  const convoy = s0.units.filter(u => ids.includes(u.id));
  ok(ids.length === 3 && convoy.length === 3 && convoy.every(u => u.owner === 0 && u.kind === 'hauler'), 'the convoy is side 0, three haulers');
  ok(convoy.every(u => Math.hypot(u.x - 12.5, u.y - 58.5) < 3), 'placed at its start');
  ok(
    convoy.every(u => u.order.type === 'move' && u.order.x === ROUTE[0].x && u.queue.length === 2 && u.queue[1].type === 'move' && u.queue[1].x === ROUTE[2].x),
    'ordered along its route: the first leg, the rest queued',
  );
  ok(JSON.stringify(s0.mission!.convoyRoute) === JSON.stringify([{ x: 12.5, y: 58.5 }, ...ROUTE]), 'the route is kept on the mission, from its start');
  ok(s0.mission!.objectives[0].progress === 0, 'no progress before it moves');
  // It drives itself there: progress rises and it arrives.
  let s = s0;
  let last = 0;
  let rising = true;
  for (let i = 0; i < 80 && !s.mission!.result; i++) {
    s = processAction(s, { type: 'tick', n: 25 });
    const p = s.mission!.objectives[0].progress;
    if (p + 0.02 < last) rising = false;
    last = Math.max(last, p);
  }
  ok(rising && last > 0.5, `escort progress rises with the leading vehicle (${last.toFixed(2)})`);
  ok(s.mission!.result === 'won' && s.mission!.objectives[0].done && s.mission!.objectives[0].progress === 1, `the convoy arrives and the mission is won (tick ${s.tick})`);
  const there = s.units.filter(u => ids.includes(u.id) && Math.hypot(u.x - 28.5, u.y - 50.5) <= 2).length;
  ok(there >= 2, `at least two of the convoy at the point (${there})`);
  // Half way, the progress is near the share of the route covered by the leader.
  {
    let h = s0;
    while (h.mission!.objectives[0].progress < 0.45 && h.tick < 3000) h = processAction(h, { type: 'tick', n: 5 });
    ok(h.mission!.objectives[0].progress >= 0.45 && h.mission!.objectives[0].progress < 0.6 && !h.mission!.objectives[0].done, 'progress passes half way before it is done');
  }
  // The player may take the convoy over: a stop is obeyed, and the convoy then waits.
  {
    const st = processAction(s0, { type: 'stop', ids });
    ok(st !== s0 && st.units.filter(u => ids.includes(u.id)).every(u => u.order.type === 'idle' && u.queue.length === 0), 'the player can stop the convoy');
    const later = processAction(st, { type: 'tick', n: 400 });
    ok(later.mission!.result === null && later.mission!.objectives[0].progress < 0.1, 'stopped, it waits: no arrival, no progress');
    const sent = processAction(later, { type: 'move', ids, x: 28.5, y: 50.5 });
    const end = tickUntil(sent, q => q.mission!.result !== null, 2000);
    ok(end.mission!.result === 'won', 'sent on by the player, it arrives and wins');
  }
  // Losses: one down, the all-of-them bonus fails, the mission does not; two down, it is lost.
  {
    const one = copy(s0);
    one.units = one.units.filter(u => u.id !== ids[0]);
    const a = processAction(one, { type: 'tick' });
    ok(a.mission!.bonus[0].failed && !a.mission!.objectives[0].failed && a.mission!.result === null, 'one lost: the bonus for all three fails, the mission goes on');
    const two = copy(a);
    two.units = two.units.filter(u => u.id !== ids[1]);
    const b = processAction(two, { type: 'tick' });
    ok(b.mission!.objectives[0].failed && b.mission!.result === 'lost', 'two lost, one left of the two needed: failed, mission lost');
    ok(b.mission!.lostBecause === 'Too much of the convoy was lost.', `lost because: ${b.mission!.lostBecause}`);
  }
  // Killed in the battle itself, by enemy fire: the convoy's losses count the same way.
  {
    const f = copy(processAction(s0, { type: 'stop', ids }));
    const lead = f.units.find(u => u.id === ids[0])!;
    lead.hp = 5;
    for (let i = 0; i < 3; i++) {
      const p = open(f, lead.x + 2 + i, lead.y - 2);
      put(f, 1, 'rocketeer', p.x, p.y);
    }
    const k = tickUntil(f, q => !q.units.some(u => u.id === ids[0]), 300);
    ok(!k.units.some(u => u.id === ids[0]), 'enemy fire destroys a convoy vehicle');
    ok(k.mission!.bonus[0].failed, 'and that loss fails the all-of-them bonus');
  }
  // Escort units that are not the convoy do not count, however many reach the point.
  {
    const o = copy(s0);
    o.units = o.units.filter(u => !ids.includes(u.id) || u.id === ids[0]);
    for (let i = 0; i < 3; i++) put(o, 0, 'tank', 28.5 + (i - 1) * 0.6, 50.5);
    const a = processAction(o, { type: 'tick' });
    ok(a.mission!.objectives[0].failed && !a.mission!.objectives[0].done, 'tanks at the point are not the convoy');
  }
  // Saves: the convoy's ids and route survive JSON and migrateState, and a replay is identical.
  {
    const mid = processAction(s0, { type: 'tick', n: 300 });
    const loaded = migrateState(JSON.parse(JSON.stringify(mid)));
    ok(!!loaded && JSON.stringify(loaded.mission!.convoy) === JSON.stringify(ids) && JSON.stringify(loaded.mission!.convoyRoute) === JSON.stringify(mid.mission!.convoyRoute), 'a saved convoy loads with its ids and route');
    const a = processAction(loaded!, { type: 'tick', n: 500 });
    const b = processAction(mid, { type: 'tick', n: 500 });
    ok(JSON.stringify(a) === JSON.stringify(b), 'and plays on exactly as before the save');
    const r1 = processAction(createMissionState(convoySpec(), mctx()), { type: 'tick', n: 700 });
    const r2 = processAction(createMissionState(convoySpec(), mctx()), { type: 'tick', n: 700 });
    ok(JSON.stringify(r1) === JSON.stringify(r2), 'a convoy mission replays byte-identically');
  }
  // A mission without the new fields carries none of them.
  {
    const plain = createMissionState(mspec(), mctx());
    ok(!('convoy' in plain.mission!) && !('convoyRoute' in plain.mission!) && !('structurePowers' in plain.mission!), 'a mission without a convoy or structure powers has neither');
  }
}

// ---- Structure powers in a mission ------------------------------------------------------------

function structurePowers(ok: Ok): void {
  const spec = (over: Partial<MissionSpec> = {}) =>
    mspec({
      player: { credits: 5000, structures: ['hq', 'power', 'power', 'refinery', 'barracks'], units: ['tank', 'tank', 'tank', 'tank'], heroes: [] },
      enemy: { credits: 0, base: 'full', structures: ['power', 'power', 'power', 'power', 'techcentre', 'strikecommand'], units: [], ai: 'defend' },
      tech: ['power', 'barracks', 'rifleman'],
      powers: ['recon'],
      structurePowers: true,
      objectives: [{ kind: 'survive', ticks: 20000 }],
      ...over,
    });
  const s0 = quiet(copy(createMissionState(spec(), mctx())));
  ok(s0.powers![1].barrage === POWERS.barrage.cooldown && s0.powers![1].missile === POWERS.missile.cooldown, 'the enemy holds the barrage and the missile its structures grant, charging');
  ok(JSON.stringify(s0.mission!.structurePowers) === JSON.stringify([[], ['barrage', 'missile']]), 'the mission notes which powers came from structures');
  ok(s0.powers![0].recon === 0 && !('barrage' in s0.powers![0]), "side 0 keeps the mission's recon and has no barrage without a Tech Centre");
  // The barrage fires when charged, at our troops.
  {
    const s = copy(s0);
    s.powers![1] = { ...s.powers![1], barrage: 1 };
    const a = processAction(s, { type: 'tick', n: 2 });
    const shells = a.projectiles.filter(p => p.owner === 1 && p.weapon === 'artillery');
    ok(shells.length === 8, `the enemy's barrage fires once charged (${shells.length} shells)`);
    ok(a.powers![1].barrage! > POWERS.barrage.cooldown - 5, 'and starts charging again');
    const tanks = a.units.filter(u => u.owner === 0 && u.kind === 'tank');
    const aim = { x: shells.reduce((t, p) => t + p.toX, 0) / 8, y: shells.reduce((t, p) => t + p.toY, 0) / 8 };
    ok(tanks.some(u => Math.hypot(u.x - aim.x, u.y - aim.y) < POWERS.barrage.radius + 1.5), 'aimed at the knot of our tanks');
    const hp0 = tanks.reduce((t, u) => t + u.hp, 0);
    const later = processAction(a, { type: 'tick', n: 60 });
    const hp1 = later.units.filter(u => u.owner === 0 && u.kind === 'tank').reduce((t, u) => t + u.hp, 0);
    ok(hp1 < hp0, `and the shells hurt them (${hp0} to ${hp1})`);
  }
  // The missile fires when charged, at our densest structures, and does real damage.
  {
    const s = copy(s0);
    s.powers![1] = { ...s.powers![1], missile: 1, barrage: 5000 };
    const a = processAction(s, { type: 'tick', n: 2 });
    const m = a.projectiles.find(p => p.owner === 1 && p.weapon === 'missile');
    ok(!!m, 'the enemy missile launches once charged');
    ok(a.log.some(l => l.text.startsWith('Enemy missile launch detected')), 'and side 0 is warned');
    if (m) {
      const hit = a.buildings.filter(b => b.owner === 0 && Math.hypot(buildingCentre(b).x - m.toX, buildingCentre(b).y - m.toY) <= POWERS.missile.radius);
      ok(hit.length >= 2, `aimed where it catches several of our structures (${hit.length})`);
      const before = a.buildings.filter(b => b.owner === 0).reduce((t, b) => t + b.hp, 0);
      const after = processAction(a, { type: 'tick', n: 60 });
      const left = after.buildings.filter(b => b.owner === 0).reduce((t, b) => t + b.hp, 0);
      ok(left < before - 500, `the blast lands (${before} to ${left} structure health)`);
    }
  }
  // Destroying the Strike Command takes the missile away; the Tech Centre, the barrage.
  {
    const s = copy(s0);
    s.buildings = s.buildings.filter(b => b.kind !== 'strikecommand');
    const a = processAction(s, { type: 'tick' });
    ok(a.powers![1].missile === undefined && a.powers![1].barrage !== undefined, 'without its Strike Command the enemy has no missile');
    ok(JSON.stringify(a.mission!.structurePowers![1]) === '["barrage"]', 'and the note says so');
    const b0 = copy(a);
    b0.buildings = b0.buildings.filter(b => b.kind !== 'techcentre');
    const b = processAction(b0, { type: 'tick' });
    ok(JSON.stringify(b.powers![1]) === '{}', 'without its Tech Centre, no barrage either');
    const quietLater = processAction(b, { type: 'tick', n: 2000 });
    ok(!quietLater.projectiles.some(p => p.owner === 1 && (p.weapon === 'missile' || p.weapon === 'artillery')), 'and nothing more is fired');
  }
  // Side 0 gets the barrage when its own Tech Centre stands, and loses it with it.
  {
    const s = copy(s0);
    const hq = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
    const site = open(s, hq.x - 4, hq.y - 4);
    const tc = addBuilding(s, 0, 'techcentre', Math.floor(site.x), Math.floor(site.y), -100);
    const a = processAction(s, { type: 'tick' });
    ok(a.powers![0].barrage === POWERS.barrage.cooldown - 0 || a.powers![0].barrage === POWERS.barrage.cooldown - 1, `our Tech Centre grants us the barrage, charging (${a.powers![0].barrage})`);
    const b0 = copy(a);
    b0.buildings = b0.buildings.filter(b => b.id !== tc.id);
    const b = processAction(b0, { type: 'tick' });
    ok(b.powers![0].barrage === undefined && b.powers![0].recon !== undefined, "lost with it; the mission's own recon stays");
  }
  // A power the mission gave at the start is never taken away, Tech Centre or not.
  {
    const s = quiet(copy(createMissionState(spec({ powers: ['barrage'] }), mctx())));
    ok(s.powers![0].barrage === 0 && JSON.stringify(s.mission!.structurePowers![0]) === '[]', "the mission's own barrage is not a structure's");
    const a = processAction(s, { type: 'tick', n: 5 });
    ok(a.powers![0].barrage === 0, 'and it stays, ready');
  }
  // A passive enemy never fires; a mission without structure powers gives the enemy none.
  {
    const p = quiet(copy(createMissionState(spec({ enemy: { credits: 0, base: 'full', structures: ['power', 'techcentre', 'strikecommand'], units: [], ai: 'passive' } }), mctx())));
    p.powers![1] = { ...p.powers![1], missile: 1, barrage: 1 };
    const a = processAction(p, { type: 'tick', n: 3 });
    ok(!a.projectiles.some(x => x.owner === 1), 'a passive enemy never calls its powers');
    const none = createMissionState(spec({ structurePowers: undefined }), mctx());
    ok(JSON.stringify(none.powers![1]) === '{}' && !none.mission!.structurePowers, 'without structurePowers the enemy has no powers at all');
    const later = processAction(quiet(copy(none)), { type: 'tick', n: 5000 });
    ok(!later.projectiles.some(x => x.owner === 1 && x.weapon === 'missile'), 'and never fires a missile, Strike Command or not');
  }
  // Pure: the reducer does not touch its input, and two runs match.
  {
    const s = copy(s0);
    s.powers![1] = { ...s.powers![1], missile: 3, barrage: 3 };
    const snap = JSON.stringify(s);
    const a = processAction(s, { type: 'tick', n: 100 });
    const b = processAction(s, { type: 'tick', n: 100 });
    ok(JSON.stringify(s) === snap, 'firing powers leaves the input state untouched');
    ok(JSON.stringify(a) === JSON.stringify(b), 'and replays identically');
  }
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Act two: objective labels', labels],
  ['Act two: holding a zone, with and without reset', noCommander(holdZone)],
  ['Act two: destroy within a time', noCommander(destroyWithin)],
  ['Act two: escort and the convoy', noCommander(escort)],
  ['Act two: structure powers in a mission', noCommander(structurePowers)],
];
