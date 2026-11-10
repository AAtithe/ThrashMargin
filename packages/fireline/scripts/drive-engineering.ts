/**
 * Engineering vehicles (fireline-round5-design.md, workstream C): the harness sections. The Repair
 * Truck, the Forward Base Truck and its Field Yard, each rule proved by what happens in the
 * simulation rather than by what the data says. Imported by drive.ts, so its assertions count in the
 * main totals.
 */
import { processAction } from '../src/sim/actions';
import { setAutopilotAi } from '../src/sim/ai';
import { ACT_TWO } from '../src/campaign/act2';
import { MISSIONS } from '../src/campaign/missions';
import { canQueue, placementProblem } from '../src/sim/commands';
import { deployProblem, deploySpot, doUndeploy, undeployProblem } from '../src/sim/engineering';
import { buildingCentre, dist, distToBuilding, dockTile } from '../src/sim/grid';
import {
  ALSO_PRODUCES,
  BUILD_MENU,
  BUILD_RADIUS,
  BUILDINGS,
  MAX_FIELD_YARDS,
  REPAIR_TRUCK_HP,
  REPAIR_TRUCK_RANGE,
  REPAIR_TRUCK_TICKS,
  STANDARD_TECH,
  UNITS,
  VEHICLE_MENU,
  type BuildingKind,
  type Owner,
  type SkirmishSetup,
  type UnitKind,
} from '../src/sim/rules';
import { addBuilding, addUnit, createInitialState, hasProducer, maxHpOf, migrateState, techAllowed } from '../src/sim/state';
import type { Building, GameAction, GameState, Unit } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

const NEW_UNITS: UnitKind[] = ['repairtruck', 'basetruck'];

const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
/** Runs n ticks, in actions of at most 500 (the reducer takes no more than 600 at once). */
function tick(s: GameState, n = 1): GameState {
  for (let left = n; left > 0; left -= 500) s = processAction(s, { type: 'tick', n: Math.min(500, left) });
  return s;
}
const unitIn = (s: GameState, id: number) => s.units.find(u => u.id === id);
const buildingIn = (s: GameState, id: number) => s.buildings.find(b => b.id === id);

/** Every side's commander switched off: these sections test the rules, not the commander. */
function quietCommander(fn: (ok: Ok) => void): (ok: Ok) => void {
  return ok => {
    for (const o of [0, 1] as Owner[]) setAutopilotAi(() => {}, o);
    try {
      fn(ok);
    } finally {
      for (const o of [0, 1] as Owner[]) setAutopilotAi(null, o);
    }
  };
}

/**
 * An advanced skirmish on open plains with everyone's units gone, nothing attacking, and a (cx, cy)
 * with 17 by 17 tiles of clear grass round it, far from both bases.
 */
function arena(seed = 'eng-arena', setup: Partial<SkirmishSetup> = { map: 'plains', tech: 'advanced', credits: 20000 }) {
  const s = copy(createInitialState(seed, seed, { seed, createdAt: 0, setup }));
  s.units = [];
  for (const m of s.ai) {
    m.nextAttack = 1e9;
    m.nextRaid = 1e9;
  }
  const cx = Math.floor(s.mapW / 2);
  const cy = Math.floor(s.mapH / 2);
  const tiles = s.tiles.split('');
  for (let y = cy - 8; y <= cy + 8; y++)
    for (let x = cx - 8; x <= cx + 8; x++) {
      tiles[y * s.mapW + x] = 'g';
      s.ore[y * s.mapW + x] = 0;
    }
  s.tiles = tiles.join('');
  return { s, cx, cy };
}

function put(s: GameState, owner: Owner, kind: UnitKind, x: number, y: number, extra: Partial<Unit> = {}): Unit {
  const u = addUnit(s, owner, kind, x, y);
  Object.assign(u, extra);
  return u;
}

/** The reducer's answer, with its input checked untouched. */
function act(ok: Ok, s: GameState, a: GameAction, what: string): GameState {
  const snap = JSON.stringify(s);
  const out = processAction(s, a);
  ok(JSON.stringify(s) === snap, `${what}: input untouched`);
  return out;
}

// ---------------------------------------------------------------------------------------------

function rulesAndMenus(ok: Ok): void {
  const rt = UNITS.repairtruck;
  ok(
    rt.category === 'vehicle' && rt.mender && !rt.weapon && rt.cost === 900 && rt.buildTicks === 110 && rt.hp === 300 && rt.armor === 'light',
    'Repair Truck: an unarmed vehicle that mends, 900 credits, 300 health, light armour',
  );
  ok(rt.speed === 0.085 && rt.sight === 6 && rt.requires.join() === 'factory,repairbay', 'Repair Truck: speed, sight, needs a War Factory and a Repair Bay');
  const bt = UNITS.basetruck;
  ok(
    bt.category === 'vehicle' && bt.deploysTo === 'fieldyard' && !bt.weapon && bt.cost === 2500 && bt.buildTicks === 250 && bt.hp === 900 && bt.armor === 'heavy',
    'Forward Base Truck: an unarmed vehicle that deploys into a Field Yard, 2500 credits, 900 health, heavy armour',
  );
  ok(bt.speed === 0.055 && bt.sight === 5 && bt.requires.join() === 'factory,uplink', 'Forward Base Truck: speed, sight, needs a War Factory and a Comms Uplink');
  const fy = BUILDINGS.fieldyard;
  ok(fy.w === 2 && fy.h === 2 && fy.cost === 2500 && fy.hp === 1000 && fy.power === 0 && fy.sight === 5, 'Field Yard: 2x2, 2500, 1000 health, no power');
  ok(fy.buildRadius === 6 && fy.undeploysTo === 'basetruck' && fy.requires.length === 0, 'Field Yard: build radius 6, packs up into a Forward Base Truck');
  ok(ALSO_PRODUCES.fieldyard === 'building', 'Field Yard: works the Structures queue');
  ok(!BUILD_MENU.includes('fieldyard'), 'Field Yard: on no menu');
  const fi = VEHICLE_MENU.indexOf('flaktrack');
  ok(VEHICLE_MENU[fi + 1] === 'repairtruck' && VEHICLE_MENU[fi + 2] === 'basetruck', 'both trucks on the Vehicles list after the Flak Track, in that order');
  for (const k of [...NEW_UNITS, 'fieldyard'] as (BuildingKind | UnitKind)[]) ok(!STANDARD_TECH.includes(k), `${k}: advanced tech only`);
  ok(REPAIR_TRUCK_RANGE === 2 && REPAIR_TRUCK_HP === 8 && REPAIR_TRUCK_TICKS === 5 && MAX_FIELD_YARDS === 3, 'the engineering constants');
}

/** Standard tech, the original game and missions offer none of it; advanced tech offers both trucks. */
function techLevels(ok: Ok): void {
  const grantAll = (s: GameState) => {
    for (const o of [0, 1] as Owner[])
      for (const k of ['power', 'refinery', 'barracks', 'factory', 'uplink', 'repairbay', 'techcentre'] as BuildingKind[])
        addBuilding(s, o, k, o === 0 ? 1 : s.mapW - 4, o === 0 ? 1 : s.mapH - 4, -100);
    s.players[0].credits = s.players[1].credits = 50000;
    return s;
  };
  const cases: [string, GameState, boolean][] = [
    ['standard tech', grantAll(copy(createInitialState('std', 'std', { seed: 'std', createdAt: 0, setup: { map: 'classic', tech: 'standard' } }))), false],
    ['no setup (the original game)', grantAll(copy(createInitialState('leg', 'leg', { seed: 'leg', createdAt: 0 }))), false],
    ['advanced tech', grantAll(arena().s), true],
  ];
  for (const [label, s, allowed] of cases) {
    for (const k of NEW_UNITS) {
      ok(canQueue(s, 0, 'vehicle', k) === allowed && canQueue(s, 1, 'vehicle', k) === allowed, `${label}: ${k} ${allowed ? 'offered' : 'refused'} to both sides`);
      const r = processAction(s, { type: 'queue', category: 'vehicle', kind: k });
      ok((r !== s) === allowed, `${label}: queueing ${k} ${allowed ? 'legal' : 'refused'}`);
    }
    ok(!canQueue(s, 0, 'building', 'fieldyard') && processAction(s, { type: 'queue', category: 'building', kind: 'fieldyard' }) === s, `${label}: a Field Yard is never queued`);
  }
  for (const m of [...MISSIONS, ...ACT_TWO])
    for (const k of [...NEW_UNITS, 'fieldyard'] as (BuildingKind | UnitKind)[]) ok(!m.tech.includes(k), `mission ${m.id}: no ${k} on its tech list`);
  const { s } = arena();
  const mission = { ...s, mission: {} as GameState['mission'] };
  ok(!techAllowed(mission, 1, 'repairtruck') && !techAllowed(mission, 1, 'basetruck'), "a mission's enemy never gets the trucks");
}

/** The Repair Truck: whom it mends, how fast, and when it drives to them. */
function repairTruck(ok: Ok): void {
  const { s, cx, cy } = arena();
  const truck = put(s, 0, 'repairtruck', cx + 0.5, cy + 0.5, { stance: 'hold' });
  const worse = put(s, 0, 'tank', cx + 1.5, cy + 0.5, { hp: 100, stance: 'hold' }); // 100 of 400
  const better = put(s, 0, 'tank', cx + 0.5, cy + 1.5, { hp: 300, stance: 'hold' });
  const far = put(s, 0, 'tank', cx + 4.5, cy + 0.5, { hp: 100, stance: 'hold' });
  const foe = put(s, 1, 'tank', cx - 0.5, cy + 0.5, { hp: 100, stance: 'hold' });
  const rifle = put(s, 0, 'rifleman', cx + 0.5, cy - 0.5, { hp: 20, stance: 'hold' });
  const gunship = put(s, 0, 'gunship', cx - 0.5, cy - 0.5, { hp: 50, stance: 'hold' });
  ok(processAction(s, { type: 'attack', ids: [truck.id], target: foe.id }) === s, 'rejected: an attack order to an unarmed Repair Truck');
  ok(processAction(s, { type: 'stance', ids: [truck.id], stance: 'guard' }) !== s, 'a Repair Truck takes a stance (Hold keeps it where it is put)');
  // The foe would shoot; keep the test to mending.
  s.units = s.units.filter(u => u.id !== foe.id);
  const enemy = put(s, 1, 'tank', cx - 0.5, cy + 0.5, { hp: 100, stance: 'hold' });
  s.players[1].credits = 0;
  // One mend: the most damaged (by share) in range, only it.
  const one = tick(s, REPAIR_TRUCK_TICKS);
  ok(unitIn(one, worse.id)!.hp === 100 + REPAIR_TRUCK_HP, `the most damaged vehicle in range is mended first (100 to ${unitIn(one, worse.id)!.hp})`);
  ok(unitIn(one, better.id)!.hp === 300, 'and only it');
  ok(one.effects.some(e => e.kind === 'repair'), 'with the repair spark');
  // The rate: one mend every REPAIR_TRUCK_TICKS, whichever is worst at the time.
  const t = tick(s, 100);
  const got = unitIn(t, worse.id)!.hp - 100 + (unitIn(t, better.id)!.hp - 300);
  ok(got === (100 / REPAIR_TRUCK_TICKS) * REPAIR_TRUCK_HP, `${got} health in 100 ticks (${(got * 10) / 100} a second)`);
  ok(unitIn(t, far.id)!.hp === 100, 'a vehicle out of range is not mended');
  ok(unitIn(t, enemy.id)!.hp === 100, 'nor an enemy vehicle');
  ok(unitIn(t, rifle.id)!.hp === 20, 'nor infantry');
  ok(unitIn(t, gunship.id)!.hp === 50, 'nor an aircraft');
  ok(unitIn(t, truck.id)!.x === truck.x && unitIn(t, truck.id)!.y === truck.y, 'on hold, it stays where it is put');
  // Not itself, and not another truck's patient beyond full health.
  {
    const c = copy(s);
    c.units = [];
    const lone = put(c, 0, 'repairtruck', cx + 0.5, cy + 0.5, { hp: 100 });
    ok(unitIn(tick(c, 50), lone.id)!.hp === 100, 'a Repair Truck does not mend itself');
    const two = put(c, 0, 'repairtruck', cx + 1.5, cy + 0.5, { hp: UNITS.repairtruck.hp });
    const a = tick(c, 50);
    ok(unitIn(a, lone.id)!.hp > 100, 'but another truck mends it');
    ok(unitIn(a, two.id)!.hp === UNITS.repairtruck.hp, 'and nothing goes over full health');
  }
  // Idle, it seeks; on hold, it does not; given an order, it follows the order.
  {
    const c = copy(s);
    c.units = [];
    const idle = put(c, 0, 'repairtruck', cx - 4.5, cy + 0.5);
    const hurt = put(c, 0, 'tank', cx + 2.5, cy + 0.5, { hp: 100, stance: 'hold' });
    const a = tick(c, 300);
    const d = dist(unitIn(a, idle.id)!.x, unitIn(a, idle.id)!.y, unitIn(a, hurt.id)!.x, unitIn(a, hurt.id)!.y);
    ok(d <= REPAIR_TRUCK_RANGE, `an idle Repair Truck drives to a damaged vehicle (${d.toFixed(1)} tiles)`);
    ok(unitIn(a, hurt.id)!.hp > 100, `and mends it (${unitIn(a, hurt.id)!.hp})`);
    const h = copy(c);
    unitIn(h, idle.id)!.stance = 'hold';
    const b = tick(h, 300);
    ok(unitIn(b, idle.id)!.x === idle.x, 'on hold, it does not go looking');
    const o = processAction(c, { type: 'move', ids: [idle.id], x: cx - 6.5, y: cy + 0.5 });
    const m = tick(o, 300);
    ok(Math.abs(unitIn(m, idle.id)!.x - (cx - 6.5)) < 1, 'given an order, it follows the order');
    const farOff = copy(c);
    unitIn(farOff, hurt.id)!.x = cx + 8.5;
    unitIn(farOff, idle.id)!.x = cx - 8.5;
    ok(unitIn(tick(farOff, 100), idle.id)!.x === cx - 8.5, 'a damaged vehicle beyond its search is left alone');
  }
}

/** Deploying a Forward Base Truck, and every way it is refused. */
function deploying(ok: Ok): void {
  const { s, cx, cy } = arena();
  const truck = put(s, 0, 'basetruck', cx + 0.5, cy + 0.5, { hp: 450 });
  const at = deploySpot(truck);
  ok(at.x === cx && at.y === cy, 'the yard stands with the truck at its centre');
  ok(placementProblem(s, 0, 'fieldyard', at.x, at.y, undefined, { ignoreUnit: truck.id }) === 'Too far from your base', 'far from any base, an ordinary structure could not go there');
  ok(deployProblem(s, 0, truck.id) === null, 'but the truck can deploy there');
  const d = act(ok, s, { type: 'deploy', id: truck.id }, 'deploy');
  ok(d !== s, 'deploying is legal on clear ground far from any base');
  const yard = d.buildings.find(b => b.kind === 'fieldyard' && b.owner === 0)!;
  ok(!!yard && !unitIn(d, truck.id), 'the truck is gone and a Field Yard stands');
  ok(yard.x === at.x && yard.y === at.y, `on the truck's tiles (${yard.x}, ${yard.y})`);
  ok(yard.hp === 500, `with the truck's share of health (450 of 900 gives ${yard.hp} of 1000)`);
  ok(yard.placedAt === d.tick, 'rising as any new structure does');
  ok(d.log.some(m => m.text.includes('Field Yard deployed')), 'and the log says so');
  // A moving truck may deploy where it is; one on another errand may not.
  {
    const c = copy(s);
    unitIn(c, truck.id)!.order = { type: 'move', x: cx + 5, y: cy };
    ok(deployProblem(c, 0, truck.id) === null, 'a moving truck deploys where it is');
    unitIn(c, truck.id)!.order = { type: 'attack', target: 1 };
    ok(deployProblem(c, 0, truck.id) === 'Busy' && processAction(c, { type: 'deploy', id: truck.id }) === c, 'rejected: a truck that is neither idle nor moving');
  }
  // Ground: water, ore, rock.
  for (const [label, tile, ore] of [
    ['water', 'w', 0],
    ['rock', 'r', 0],
    ['ore', 'g', 500],
  ] as [string, string, number][]) {
    const c = copy(s);
    const k = (at.y + 1) * c.mapW + at.x + 1;
    c.tiles = c.tiles.slice(0, k) + tile + c.tiles.slice(k + 1);
    c.ore[k] = ore;
    ok(processAction(c, { type: 'deploy', id: truck.id }) === c, `rejected: deploying over ${label}`);
  }
  // A structure, a refinery's dock, another unit.
  {
    const c = copy(s);
    addBuilding(c, 0, 'power', at.x + 1, at.y - 1, -100);
    ok(processAction(c, { type: 'deploy', id: truck.id }) === c, 'rejected: deploying over a structure');
  }
  {
    const c = copy(s);
    const ref = addBuilding(c, 1, 'refinery', at.x - 6, at.y - 6, -100);
    const dock = dockTile(c, ref);
    const u = unitIn(c, truck.id)!;
    u.x = dock.x + 0.5;
    u.y = dock.y + 0.5;
    const spot = deploySpot(u);
    ok(dock.x >= spot.x && dock.x < spot.x + 2 && dock.y >= spot.y && dock.y < spot.y + 2, "the truck stands on a refinery's dock");
    ok(processAction(c, { type: 'deploy', id: truck.id }) === c, "rejected: deploying over a refinery's dock");
  }
  {
    const c = copy(s);
    put(c, 0, 'rifleman', at.x + 0.5, at.y + 0.5, { stance: 'hold' });
    ok(processAction(c, { type: 'deploy', id: truck.id }) === c, "rejected: deploying over another unit's tile");
  }
  {
    const c = copy(s);
    const theirs = put(c, 1, 'basetruck', cx - 4.5, cy + 0.5);
    ok(deployProblem(c, 1, theirs.id) === null, 'their truck could deploy for them');
    ok(processAction(c, { type: 'deploy', id: theirs.id }) === c, "rejected: deploying an enemy's truck");
    const tank = put(c, 0, 'tank', cx - 4.5, cy - 3.5);
    ok(processAction(c, { type: 'deploy', id: tank.id }) === c, 'rejected: deploying a tank');
  }
  ok(processAction(s, { type: 'deploy', id: 999999 }) === s, 'rejected: deploying a unit that does not exist');
  ok(processAction(s, { type: 'deploy', id: truck.id + 0.5 }) === s, 'rejected: a fractional id');
  ok(processAction(s, { type: 'deploy', id: 'x' as never }) === s, 'rejected: a bad id');
  ok(processAction(d, { type: 'deploy', id: truck.id }) === d, 'rejected: deploying a truck already deployed');

  // Packing up.
  const u = act(ok, d, { type: 'undeploy', id: yard.id }, 'pack up');
  ok(u !== d && !buildingIn(u, yard.id), 'packing up is legal; the yard is gone');
  const back = u.units.find(v => v.kind === 'basetruck' && v.owner === 0)!;
  const c = buildingCentre(yard);
  ok(!!back && back.x === c.x && back.y === c.y, `a Forward Base Truck stands at its centre (${back?.x}, ${back?.y})`);
  ok(back.hp === Math.round(UNITS.basetruck.hp * (500 / 1000)), `with the yard's share of health (${back.hp})`);
  ok(deployProblem(u, 0, back.id) === null, 'and can deploy again where it stands');
  const again = processAction(u, { type: 'deploy', id: back.id });
  ok(again.buildings.some(b => b.kind === 'fieldyard' && b.x === yard.x && b.y === yard.y && b.hp === 500), 'back on the same tiles with the same health');
  ok(processAction(d, { type: 'undeploy', id: d.buildings.find(b => b.kind === 'hq' && b.owner === 0)!.id }) === d, 'rejected: packing up a Command Yard');
  {
    const c = copy(d);
    const theirYard = addBuilding(c, 1, 'fieldyard', cx + 4, cy - 6, -100);
    ok(undeployProblem(c, 1, theirYard.id) === null, 'their Field Yard could pack up for them');
    ok(processAction(c, { type: 'undeploy', id: theirYard.id }) === c, "rejected: packing up an enemy's Field Yard");
  }
  {
    const lone = copy(d);
    lone.buildings = lone.buildings.filter(b => b.owner !== 0 || b.id === yard.id);
    ok(undeployProblem(lone, 0, yard.id) === 'Your last structure' && processAction(lone, { type: 'undeploy', id: yard.id }) === lone, 'rejected: packing up the last structure');
  }
}

/** The cap on Field Yards, counting trucks standing and queued. */
function cap(ok: Ok): void {
  const { s, cx, cy } = arena();
  for (const k of ['power', 'refinery', 'factory', 'uplink'] as BuildingKind[]) addBuilding(s, 0, k, 2 + 3 * ['power', 'refinery', 'factory', 'uplink'].indexOf(k), 2, -100);
  s.players[0].credits = 50000;
  ok(canQueue(s, 0, 'vehicle', 'basetruck'), 'a Forward Base Truck may be queued');
  addBuilding(s, 0, 'fieldyard', cx - 6, cy - 6, -100);
  put(s, 0, 'basetruck', cx + 4.5, cy + 4.5);
  let q = act(ok, s, { type: 'queue', category: 'vehicle', kind: 'basetruck' }, 'queue a third');
  ok(q !== s, `with one yard and one truck, a third may be queued (cap ${MAX_FIELD_YARDS})`);
  ok(processAction(q, { type: 'queue', category: 'vehicle', kind: 'basetruck' }) === q, 'rejected: a fourth, counting the one queued');
  q = processAction(q, { type: 'cancel', category: 'vehicle', kind: 'basetruck' });
  ok(canQueue(q, 0, 'vehicle', 'basetruck'), 'cancelled, the room is back');
}

/** The Field Yard's build radius, and building on with the Command Yard gone. */
function fieldYard(ok: Ok): void {
  const { s, cx, cy } = arena();
  const yard = addBuilding(s, 0, 'fieldyard', cx - 8, cy, -100);
  ok(placementProblem(s, 0, 'power', cx - 8 + 1 + 6, cy) === null, 'a structure 6 tiles from a Field Yard, far from home, can go down');
  ok(placementProblem(s, 0, 'power', cx - 8 + 1 + 7, cy) === 'Too far from your base', 'but not 7');
  {
    const c = copy(s);
    c.buildings = c.buildings.filter(b => b.id !== yard.id);
    addBuilding(c, 0, 'power', cx - 8, cy, -100);
    ok(placementProblem(c, 0, 'power', cx - 8 + 1 + BUILD_RADIUS + 1, cy) === 'Too far from your base', `any other structure reaches only ${BUILD_RADIUS}`);
  }
  // The Command Yard falls; the Field Yard keeps the Structures queue going.
  const c = copy(s);
  c.buildings = c.buildings.filter(b => b.owner !== 0 || b.id === yard.id);
  c.players[0].credits = 5000;
  ok(hasProducer(c, 0, 'building'), 'with only a Field Yard, something works the Structures queue');
  let q = act(ok, c, { type: 'queue', category: 'building', kind: 'power' }, 'queue a Generator');
  ok(q !== c, 'a Generator may be queued with only a Field Yard');
  q = tick(q, 40);
  ok(q.players[0].queues.building[0]?.progress > 0, `and it progresses (${q.players[0].queues.building[0]?.progress})`);
  ok(q.winner === null, 'and the side is not out');
  q = tick(q, 200);
  ok(q.players[0].queues.building[0]?.progress >= BUILDINGS.power.buildTicks, 'the Generator is ready');
  const placed = act(ok, q, { type: 'place', kind: 'power', x: cx - 8 + 3, y: cy }, 'place it');
  ok(placed.buildings.some(b => b.owner === 0 && b.kind === 'power'), 'and goes down beside the Field Yard');
  {
    const w = copy(q);
    addBuilding(w, 0, 'power', cx - 8 + 3, cy + 3, -100);
    ok(undeployProblem(w, 0, yard.id) === 'Place the ready structure first', 'a yard working a ready structure, the only producer, stays put');
    ok(processAction(w, { type: 'undeploy', id: yard.id }) === w, 'rejected: packing it up then');
  }
  // Packed up into a truck as its only asset, the side is out (the reducer refuses it; the computer
  // path or a destroyed yard reaches it).
  const lone = copy(c);
  ok(processAction(lone, { type: 'undeploy', id: yard.id }) === lone, 'rejected: packing up the only structure');
  doUndeploy(lone, 0, yard.id);
  ok(lone.units.some(u => u.owner === 0 && u.kind === 'basetruck'), 'packed up by force, a truck stands');
  const end = tick(lone, 5);
  ok(end.winner === 1, 'and with no structure left the side is out');
}

/** Saves, migration and replay with trucks and yards. */
function saves(ok: Ok): void {
  const { s, cx, cy } = arena();
  put(s, 0, 'repairtruck', cx + 0.5, cy + 0.5);
  put(s, 0, 'tank', cx + 1.5, cy + 0.5, { hp: 150 });
  const bt = put(s, 0, 'basetruck', cx - 4.5, cy - 4.5);
  addBuilding(s, 1, 'fieldyard', cx + 4, cy + 4, -100);
  put(s, 1, 'repairtruck', cx + 6.5, cy + 6.5);
  let a = processAction(s, { type: 'deploy', id: bt.id });
  a = tick(a, 300);
  const m = migrateState(JSON.parse(JSON.stringify(a)));
  ok(!!m && JSON.stringify(m) === JSON.stringify(a), 'a save with trucks and yards migrates unchanged');
  const r1 = tick(processAction(s, { type: 'deploy', id: bt.id }), 600);
  const r2 = tick(processAction(copy(s), { type: 'deploy', id: bt.id }), 600);
  ok(JSON.stringify(r1) === JSON.stringify(r2), 'and replays byte-identically');
  const old = JSON.parse(JSON.stringify(createInitialState('old', 'old', { seed: 'old', createdAt: 0, setup: { map: 'plains', tech: 'advanced' } })));
  for (const mem of old.ai) {
    delete mem.expansion;
    delete mem.expandAfter;
    delete mem.engineeringFund;
  }
  const om = migrateState(old);
  ok(!!om && tick(om, 200).winner === null, 'a save from before the trucks loads and plays');
}

/** The computer: Repair Trucks in a long advanced battle; on a large map, a Forward Base. */
function computer(ok: Ok): void {
  // Side 1 builds on its own; side 0 is a Command Yard that never moves. No attacks.
  const quiet = (seed: string, setup: Partial<SkirmishSetup>, ticks: number, watch: (s: GameState) => void): GameState => {
    let s = copy(createInitialState(seed, seed, { seed, createdAt: 0, setup: { map: 'plains', tech: 'advanced', credits: 10000, ...setup } }));
    s.units = s.units.filter(u => u.owner !== 0);
    for (const m of s.ai) {
      m.nextAttack = 1e9;
      m.nextRaid = 1e9;
    }
    for (let i = 0; i < ticks / 100 && s.winner === null; i++) {
      s = tick(s, 100);
      watch(s);
    }
    return s;
  };
  // Standard size: Repair Trucks, no expansion.
  let trucks = 0;
  let mended = false;
  const std = quiet('eng-ai-std', {}, 9000, s => {
    trucks = Math.max(trucks, s.units.filter(u => u.owner === 1 && u.kind === 'repairtruck').length);
    mended ||= s.effects.some(e => e.kind === 'repair' && s.units.some(u => u.owner === 1 && UNITS[u.kind].mender && dist(u.x, u.y, e.x, e.y) <= REPAIR_TRUCK_RANGE + 0.01));
  });
  ok(trucks >= 1 && trucks <= 3, `the computer fields Repair Trucks in a long advanced battle (${trucks}, at most 3)`);
  ok(!std.buildings.some(b => b.kind === 'fieldyard') && !std.units.some(u => u.kind === 'basetruck'), 'and on a standard map builds no Forward Base');
  ok(!std.ai[1].expansion, 'nor plans one');
  // Large: until larger maps are generated (workstream B) the map is standard-sized but the setup
  // says large, which is what the computer reads.
  let truckAt = -1;
  let yardAt = -1;
  let yard: Building | undefined;
  let refineryAt = -1;
  let turretAt = -1;
  const large = quiet('eng-ai-large', { size: 'large' }, 9000, s => {
    if (truckAt < 0 && s.units.some(u => u.owner === 1 && u.kind === 'basetruck')) truckAt = s.tick;
    yard ??= s.buildings.find(b => b.owner === 1 && b.kind === 'fieldyard');
    if (yard && yardAt < 0) yardAt = s.tick;
    if (!yard) return;
    for (const b of s.buildings) {
      if (b.owner !== 1 || b.id === yard.id) continue;
      const c = buildingCentre(b);
      if (distToBuilding(c.x, c.y, yard) > 8) continue;
      if (b.kind === 'refinery' && refineryAt < 0) refineryAt = s.tick;
      if (b.kind === 'turret' && turretAt < 0) turretAt = s.tick;
    }
  });
  ok(truckAt > 0, `on a large map the computer builds a Forward Base Truck (tick ${truckAt})`);
  ok(yardAt > truckAt, `drives it out and deploys it (tick ${yardAt})`);
  if (yard) {
    const hq = large.buildings.find(b => b.owner === 1 && b.kind === 'hq');
    const away = hq ? distToBuilding(buildingCentre(yard).x, buildingCentre(yard).y, hq) : 99;
    ok(away >= 15, `well away from its Command Yard (${away.toFixed(1)} tiles)`);
  }
  ok(refineryAt > yardAt, `builds a Refinery there (tick ${refineryAt})`);
  ok(turretAt > yardAt, `and a Gun Turret (tick ${turretAt})`);
  ok((large.ai[1].engineeringFund ?? 0) >= 0 && large.players[1].credits >= 0, 'its savings never go negative');
}

/** Real battles on advanced tech: both commanders with the trucks; a replay is exact. */
function battles(ok: Ok): void {
  const play = (seed: string, setup: Partial<SkirmishSetup>) => {
    let s = createInitialState(`eng-${seed}`, seed, { seed, difficulty: 'hard', createdAt: 0, autopilot: true, setup: { map: 'plains', tech: 'advanced', ...setup } });
    s.autopilotDifficulty = 'hard';
    let trucks = 0;
    let yards = 0;
    let mends = 0;
    const seen = new Set<number>();
    while (s.winner === null && s.tick < 30000) {
      s = tick(s, 50);
      for (const e of s.effects) {
        if (e.kind !== 'repair' || seen.has(e.id)) continue;
        seen.add(e.id);
        if (s.units.some(u => u.kind === 'repairtruck' && dist(u.x, u.y, e.x, e.y) <= REPAIR_TRUCK_RANGE + 0.01)) mends++;
      }
      trucks = Math.max(trucks, s.units.filter(u => u.kind === 'repairtruck').length);
      yards = Math.max(yards, s.buildings.filter(b => b.kind === 'fieldyard').length);
      for (const b of s.buildings) if (b.kind === 'fieldyard' && b.hp > BUILDINGS.fieldyard.hp) ok(false, 'a Field Yard over full health');
      for (const u of s.units) if (u.hp > maxHpOf(u)) ok(false, `${u.kind} over full health`);
    }
    return { s, trucks, yards, mends };
  };
  const a = play('battle', { size: 'large' });
  ok(a.s.winner !== null, `a hard advanced battle (setup large) finishes (side ${a.s.winner} at ${(a.s.tick / 600).toFixed(1)} min)`);
  ok(a.trucks > 0, `Repair Trucks take part (${a.trucks} at most)`);
  ok(a.mends > 0, `and mend in battle (${a.mends} sparks beside one)`);
  ok(a.yards > 0, `Field Yards go down (${a.yards} at most)`);
  console.log(`  battle with engineering: side ${a.s.winner} in ${Math.round(a.s.tick / 600)} min, ${a.trucks} Repair Trucks and ${a.yards} Field Yards at most, ${a.mends} mends seen`);
  // The same battle again: exactly the same.
  const b = play('battle', { size: 'large' });
  ok(JSON.stringify(a.s) === JSON.stringify(b.s), 'and replays byte-identically');
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Engineering: rules and menus', rulesAndMenus],
  ['Engineering: standard tech and missions offer none of it', techLevels],
  ['Engineering: the Repair Truck', quietCommander(repairTruck)],
  ['Engineering: deploying and packing up', quietCommander(deploying)],
  ['Engineering: no more than three Field Yards', quietCommander(cap)],
  ['Engineering: the Field Yard builds', quietCommander(fieldYard)],
  ['Engineering: saves and replay', quietCommander(saves)],
  ['Engineering: the computer', computer],
  ['Engineering: battles', battles],
];
