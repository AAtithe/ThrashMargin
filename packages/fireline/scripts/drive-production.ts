/**
 * Advanced production (2026-11-22, setup.production; src/sim/production.ts, fireline-design.md).
 * Its sections run inside scripts/drive.ts and count in its totals.
 */
import { createHash } from 'node:crypto';
import { processAction } from '../src/sim/actions';
import { setAutopilotAi } from '../src/sim/ai';
import { createMissionState } from '../src/sim/mission';
import { missionContext, newCampaign } from '../src/campaign/progression';
import { MISSIONS } from '../src/campaign/missions';
import {
  DEFAULT_SETUP,
  FARM_TICKS,
  FOOD_TICKS,
  HOUSING,
  LEGACY_SETUP,
  MUNITIONS_ALLOYS,
  MUNITIONS_FUEL,
  MUNITIONS_MADE,
  MUNITIONS_TICKS,
  START_FOOD,
  START_MUNITIONS,
  type Owner,
  type SkirmishSetup,
} from '../src/sim/rules';
import { addBuilding, addUnit, createInitialState, migrateState, normaliseSetup, techAllowed } from '../src/sim/state';
import { productionOn, productionStep, spendMunition, truckStep } from '../src/sim/production';
import { cutOff, supplied } from '../src/sim/supply';
import { crewNeed, housed, staffed, technicians as techCount } from '../src/sim/territory';
import { projectProblem } from '../src/sim/production';
import { linkRangeOf, serveRangeOf } from '../src/sim/supply';
import { INFANTRY_FOOD, PREFAB_HOUSING, PROJECTS, SUPPLY_LINK_RANGE, SUPPLY_SERVE_RANGE, TECHNICIANS_PER_CENTRE } from '../src/sim/rules';
import { goodsFor } from '../src/sim/commands';
import { unitSpecOf } from '../src/sim/specs';
import type { GameState } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
const hash = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const ALL: Partial<SkirmishSetup> = { map: 'plains', tech: 'advanced', industry: true, supply: true, territory: true, production: true, credits: 20000 };
const fresh = (setup: Partial<SkirmishSetup> = ALL, seed = 'production'): GameState => createInitialState(seed, seed, { seed, createdAt: 0, setup });
const NONE = new Set<number>();
const NO_LOW = [false, false, false, false];

function quiet(fn: (ok: Ok) => void): (ok: Ok) => void {
  return ok => {
    for (const o of [1, 2, 3] as Owner[]) setAutopilotAi(() => {}, o);
    try {
      fn(ok);
    } finally {
      for (const o of [1, 2, 3] as Owner[]) setAutopilotAi(null, o);
    }
  };
}

function arena(seed = 'production') {
  const s = fresh(ALL, seed);
  const hq = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
  const dir = hq.x < s.mapW / 2 ? 1 : -1;
  return { s, hq, dir, at: (dx: number, dy = 0) => ({ x: Math.floor(hq.x + 1.5 + dir * dx), y: Math.floor(hq.y + 1.5 + dy) }) };
}

function setup(ok: Ok): void {
  ok(DEFAULT_SETUP.production === false && LEGACY_SETUP.production === false, 'both presets state advanced production: off');
  ok(normaliseSetup({}).production === false, 'a setup saved before it reads as off');
  ok(normaliseSetup({ industry: true, supply: true, territory: true, production: true }).production === true, 'with territory, production: true is kept');
  ok(normaliseSetup({ industry: true, supply: true, production: true }).production === false, 'without territory it is off whatever the setup says');
  const terr = fresh({ ...ALL, production: false });
  ok(!productionOn(terr) && !techAllowed(terr, 0, 'farm') && !techAllowed(terr, 0, 'munitions') && !techAllowed(terr, 0, 'supplytruck'), 'territory alone: no Farm, Works or Supply Truck');
  ok(terr.players.every(p => !('food' in p) && !('munitions' in p)), 'territory alone: no food or munitions held');
  const on = fresh();
  ok(productionOn(on) && techAllowed(on, 0, 'farm') && techAllowed(on, 1, 'munitions') && techAllowed(on, 0, 'supplytruck'), 'on: all three, for every side');
  ok(on.players.every(p => p.food === START_FOOD && p.munitions === START_MUNITIONS), 'on: every side starts with the opening food and munitions');
  const c = newCampaign('T');
  const ms = createMissionState(MISSIONS[0], missionContext(c, MISSIONS[0], 'prod', 0));
  ms.setup = { ...normaliseSetup({}), industry: true, supply: true, territory: true, production: true };
  ok(!productionOn(ms) && !techAllowed(ms, 0, 'farm'), 'never in a mission, even with the flag forced on');
}

function food(ok: Ok): void {
  const { s, at } = arena();
  const f = at(-6, 4);
  addBuilding(s, 0, 'farm', f.x, f.y);
  s.players[0].food = 0;
  for (let i = 0; i < FARM_TICKS * 10; i++) {
    s.tick++;
    productionStep(s, NO_LOW, NONE);
  }
  // A meal or two may have come round, but there are no Quarters to eat.
  ok(s.players[0].food === 10, `a Farm grows one food every ${FARM_TICKS} ticks (${s.players[0].food} in ${FARM_TICKS * 10})`);
  const q1 = at(4, -6);
  const q2 = at(4, 6);
  const a = addBuilding(s, 0, 'quarters', q1.x, q1.y);
  const b = addBuilding(s, 0, 'quarters', q2.x, q2.y);
  s.players[0].food = 1;
  s.buildings = s.buildings.filter(x => x.kind !== 'farm');
  while (s.tick % FOOD_TICKS !== FOOD_TICKS - 1) s.tick++;
  s.tick++;
  productionStep(s, NO_LOW, NONE);
  ok(!a.hungry && b.hungry === true && s.players[0].food === 0, 'at a meal with one food for two Quarters, the older eats and the younger goes hungry');
  ok(housed(s, 0) === HOUSING.hq! + HOUSING.quarters! + HOUSING.quarters! / 2, 'a hungry Quarters houses half');
  s.players[0].food = 5;
  for (let i = 0; i < FOOD_TICKS; i++) {
    s.tick++;
    productionStep(s, NO_LOW, NONE);
  }
  ok(!b.hungry && housed(s, 0) === HOUSING.hq! + 2 * HOUSING.quarters!, 'fed at its next meal, it houses in full again');
  // A Farm without its crew grows nothing.
  const farm = addBuilding(s, 0, 'farm', f.x, f.y);
  const f0 = s.players[0].food!;
  for (let i = 0; i < FARM_TICKS * 3; i++) {
    s.tick++;
    productionStep(s, NO_LOW, new Set([farm.id]));
  }
  ok(s.players[0].food! <= f0, 'a Farm without its crew grows nothing');
}

function munitions(ok: Ok): void {
  const { s, at } = arena('munitions');
  const w = at(-6, 4);
  addBuilding(s, 0, 'munitions', w.x, w.y);
  const p = s.players[0];
  p.munitions = 0;
  p.alloys = 100;
  p.fuel = 100;
  for (let i = 0; i < MUNITIONS_TICKS * 2; i++) {
    s.tick++;
    productionStep(s, NO_LOW, NONE);
  }
  ok(p.munitions === 2 * MUNITIONS_MADE && p.alloys === 100 - 2 * MUNITIONS_ALLOYS && p.fuel === 100 - 2 * MUNITIONS_FUEL, 'two cycles: 20 munitions for 10 alloys and 4 fuel');
  const art = addUnit(s, 0, 'artillery', 10.5, 10.5);
  const tank = addUnit(s, 0, 'tank', 12.5, 10.5);
  ok(spendMunition(s, art) && p.munitions === 2 * MUNITIONS_MADE - 1, 'an artillery shot spends one');
  ok(spendMunition(s, tank) && p.munitions === 2 * MUNITIONS_MADE - 1, 'a tank shot spends none');
  p.munitions = 0;
  ok(!spendMunition(s, art) && p.munitions === 0, 'with none left, the artillery holds fire');
  const off = fresh({ ...ALL, production: false }, 'munitions');
  ok(spendMunition(off, addUnit(off, 0, 'artillery', 10.5, 10.5)), 'without advanced production every gun fires freely');
}

const truck = quiet((ok: Ok): void => {
  const { s, at } = arena('truck');
  // A Refinery out past every hub's reach, cut off and holding 300.
  const f = at(26, 0);
  const ref = addBuilding(s, 0, 'refinery', f.x, f.y);
  ok(!supplied(s, ref), 'the far Refinery is cut off');
  ref.held = 300;
  const t0 = at(4, 4);
  const tr = addUnit(s, 0, 'supplytruck', t0.x + 0.5, t0.y + 0.5);
  const cr0 = s.players[0].credits;
  let x = s;
  let loaded = false;
  for (let i = 0; i < 400 && x.players[0].credits < cr0 + 300; i++) {
    x = processAction(x, { type: 'tick', n: 10 });
    const u = x.units.find(v => v.id === tr.id);
    if (u?.truck && u.truck.credits > 0) loaded = true;
  }
  ok(loaded, 'the idle truck drives to the cut-off Refinery and loads what it holds');
  ok(x.players[0].credits === cr0 + 300, `and brings it home: credits up by 300 (${x.players[0].credits - cr0})`);
  ok(!('held' in x.buildings.find(b => b.id === ref.id)!), 'the Refinery holds nothing now');
  // Any order takes it over.
  const y = copy(s);
  y.buildings.find(b => b.id === ref.id)!.held = 300;
  let z = processAction(y, { type: 'tick', n: 10 });
  ok(!!z.units.find(u => u.id === tr.id)?.truck, 'idle, it sets out on its own');
  z = processAction(z, { type: 'move', ids: [tr.id], x: t0.x - 3.5, y: t0.y + 0.5, attackMove: false });
  truckStep(z);
  const zu = z.units.find(u => u.id === tr.id)!;
  ok(zu.order.type === 'move' && !zu.truck, "given an order, it is the player's");
  ok(cutOff(z, 0).some(b => b.id === ref.id), 'the Refinery is still cut off, its goods still there');
});

function battles(ok: Ok): void {
  const seeds = ['prod-a', 'prod-b', 'prod-c', 'prod-d'];
  let ended = 0;
  let farms = 0;
  let wasted = 0;
  for (const [i, seed] of seeds.entries()) {
    let s = createInitialState(seed, seed, { seed, createdAt: 0, autopilot: true, difficulty: i % 2 ? 'hard' : 'normal', setup: { tech: 'advanced', industry: true, supply: true, territory: true, production: true, map: i < 2 ? 'classic' : 'plains' } });
    s.autopilotDifficulty = 'normal';
    let farmed = false;
    while (s.winner === null && s.tick < 30000) {
      s = processAction(s, { type: 'tick', n: 50 });
      if (s.buildings.some(b => b.kind === 'farm')) farmed = true;
      for (const o of [0, 1] as Owner[]) {
        const works = s.buildings.some(b => b.owner === o && b.kind === 'munitions');
        const users = s.units.some(u => u.owner === o && (['artillery', 'missilecarrier', 'battleship', 'railtank'].includes(u.kind) || unitSpecOf(s, u).category === 'air'));
        if (works && !users && s.tick > 18000) wasted++;
      }
    }
    // Decided, or mined out (under 1% of the map's ore left): with no income left, two bases behind
    // turrets can hold each other off with what infantry remains, as in the classic game.
    if (s.winner !== null || s.ore.reduce((a, b) => a + b, 0) < 1000) ended++;
    if (farmed) farms++;
  }
  ok(farms === seeds.length, `the commanders build Farms in every battle (${farms} of ${seeds.length})`);
  ok(ended === seeds.length, `every battle is decided inside 50 minutes, or the map is mined out (${ended} of ${seeds.length})`);
  void wasted;
}

function saves(ok: Ok): void {
  const play = (saveAt = -1) => {
    let s = createInitialState('pp', 'pp', { seed: 'pp', createdAt: 0, autopilot: true, setup: { tech: 'advanced', industry: true, supply: true, territory: true, production: true, map: 'classic' } });
    for (let i = 0; i < 120; i++) {
      s = processAction(s, { type: 'tick', n: 50 });
      if (i === saveAt) s = migrateState(JSON.parse(JSON.stringify(s)))!;
    }
    return s;
  };
  const a = play();
  ok(hash(a) === hash(play()) && hash(a) === hash(play(60)), 'a battle with advanced production replays byte-identically, and through a save mid-battle');
  const junk = copy(a) as unknown as { players: Record<string, unknown>[]; buildings: Record<string, unknown>[]; units: Record<string, unknown>[] };
  junk.players[0].food = 'lots';
  junk.players[1].munitions = -3;
  junk.buildings[0].hungry = 'yes';
  junk.units[0].truck = { site: 'x' };
  const m = migrateState(junk)!;
  ok(m.players[0].food === 0 && m.players[1].munitions === 0, 'junk food and munitions load as whole numbers of at least nought');
  ok(!('hungry' in m.buildings[0]) && !('truck' in m.units[0]), 'junk hunger and a junk errand are dropped');
  const terr = createInitialState('tq', 'tq', { seed: 'tq', createdAt: 0, setup: { tech: 'advanced', industry: true, supply: true, territory: true } });
  const dirty = copy(terr);
  dirty.players[0].food = 40;
  ok(!('food' in migrateState(dirty)!.players[0]), 'without advanced production, food is dropped');
}

function technicians(ok: Ok): void {
  const { s, at } = arena('techs');
  const put = (kind: Parameters<typeof addBuilding>[2], dx: number, dy: number) => {
    const p = at(dx, dy);
    return addBuilding(s, 0, kind, p.x, p.y);
  };
  addQ(s, put);
  const works = put('munitions', -6, 4);
  const foundry = put('foundry', 6, -2);
  ok(!staffed(s, works) && staffed(s, foundry), 'a Munitions Works without a Technician has no crew, however many workers are housed; a Foundry needs none');
  const centre = put('trainingcentre', 6, 6);
  ok(staffed(s, centre) && staffed(s, works), 'a crewed Training Centre trains Technicians and the Works goes to work');
  ok(techCount(s, 0).have === TECHNICIANS_PER_CENTRE && techCount(s, 0).wanted === 1, 'six Technicians, one wanted');
  const off = fresh({ ...ALL, production: false }, 'techs');
  addQ(off, (k, dx, dy) => { const p = at(dx, dy); return addBuilding(off, 0, k, p.x, p.y); });
  const lab = addBuilding(off, 0, 'researchlab', works.x, works.y);
  ok(staffed(off, lab), 'with territory alone, a Research Lab needs no Technician');
}

function addQ(s: GameState, put: (kind: Parameters<typeof addBuilding>[2], dx: number, dy: number) => unknown): void {
  put('quarters', 4, -6);
  put('quarters', -4, -6);
  void s;
}

const projects = quiet((ok: Ok): void => {
  const { s, at } = arena('projects');
  const c = at(6, 6);
  ok(projectProblem(s, 0, 'prefab') === 'Needs a Training Centre', 'a project needs a Training Centre');
  addBuilding(s, 0, 'trainingcentre', c.x, c.y);
  const cr0 = s.players[0].credits;
  let x = processAction(s, { type: 'project', id: 'prefab' });
  ok(x !== s && x.players[0].credits === cr0 - PROJECTS.prefab.cost && x.players[0].project?.id === 'prefab', 'started: paid up front');
  ok(processAction(x, { type: 'project', id: 'deepwells' }) === x, 'a second at once is refused, the same state back');
  const back = processAction(x, { type: 'cancelProject' });
  ok(back.players[0].credits === cr0 && !back.players[0].project, 'cancelled: every credit back');
  for (let i = 0; i < PROJECTS.prefab.ticks / 10 + 5; i++) x = processAction(x, { type: 'tick', n: 10 });
  ok(x.players[0].projects?.includes('prefab') && !x.players[0].project, 'run to the end, it is done');
  const q = at(-4, -6);
  addBuilding(x, 0, 'quarters', q.x, q.y);
  ok(housed(x, 0) === HOUSING.hq! + PREFAB_HOUSING, `Prefab housing: a Quarters houses ${PREFAB_HOUSING}`);
  ok(processAction(x, { type: 'project', id: 'prefab' }) === x, 'a project done cannot be bought again');
  // Mechanised crews take one off every crew; Long relays stretch the network.
  const m = copy(x);
  m.players[0].projects = ['mechanised', 'relays'];
  ok(crewNeed(m, 0, 'factory') === 3 && crewNeed(m, 0, 'fuelwell') === 1 && crewNeed(m, 1, 'factory') === 4, 'Mechanised crews: one fewer for its owner alone');
  ok(linkRangeOf(m, 0) === SUPPLY_LINK_RANGE + 3 && serveRangeOf(m, 0) === SUPPLY_SERVE_RANGE + 2 && linkRangeOf(m, 1) === SUPPLY_LINK_RANGE, 'Long relays: further links and supply, its owner alone');
});

const soldiersEat = quiet((ok: Ok): void => {
  const { s, at } = arena('eat');
  const b = at(5, 4);
  addBuilding(s, 0, 'barracks', b.x, b.y);
  ok(goodsFor(s, 0, 'rifleman').food === INFANTRY_FOOD && goodsFor(s, 0, 'grenadier').food === INFANTRY_FOOD, `a soldier costs ${INFANTRY_FOOD} food`);
  ok(!goodsFor(s, 0, 'tank').food && !goodsFor(s, 0, 'hauler').food, 'vehicles eat nothing');
  const terr = fresh({ ...ALL, production: false }, 'eat');
  ok(!goodsFor(terr, 0, 'rifleman').food, 'without advanced production soldiers cost no food');
  s.players[0].food = INFANTRY_FOOD - 1;
  ok(processAction(s, { type: 'queue', category: 'infantry', kind: 'rifleman' }) === s, 'short of food: no soldier, the same state back');
  s.players[0].food = 10;
  const q = processAction(s, { type: 'queue', category: 'infantry', kind: 'rifleman' });
  ok(q.players[0].food === 10 - INFANTRY_FOOD && q.players[0].queues.infantry[0].food === INFANTRY_FOOD, 'queued: the food is paid and recorded on the item');
  const back = processAction(q, { type: 'cancel', category: 'infantry', kind: 'rifleman' });
  ok(back.players[0].food === 10, 'cancelled: the food comes back');
  const saved = migrateState(JSON.parse(JSON.stringify(q)))!;
  ok(saved.players[0].queues.infantry[0].food === INFANTRY_FOOD, 'a save keeps the food on the queue item');
});

export const sections: [string, (ok: Ok) => void][] = [
  ['Production: the setup', setup],
  ['Production: food, meals and hunger', food],
  ['Production: munitions, made and spent', munitions],
  ['Production: soldiers eat', soldiersEat],
  ['Production: the Supply Truck fetches stranded goods', truck],
  ['Production: Technicians and the Training Centre', technicians],
  ['Production: Industry projects', projects],
  ['Production: whole computer battles', battles],
  ['Production: replays and saves', saves],
];
