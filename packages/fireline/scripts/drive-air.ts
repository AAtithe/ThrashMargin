/**
 * Air power and research (fireline-round4-design.md, workstream A): the harness sections. Each one
 * proves a rule by what happens in the simulation, not by what the data says. Imported by drive.ts,
 * so its assertions count in the main totals.
 */
import { processAction } from '../src/sim/actions';
import { setAutopilotAi } from '../src/sim/ai';
import { airRoom, homePad, isAir, launchAircraft, padSpot } from '../src/sim/air';
import { canAttack, canQueue } from '../src/sim/commands';
import { dist, distToBuilding, occupancy } from '../src/sim/grid';
import { isWalkable } from '../src/sim/map';
import { hasUpgrade } from '../src/sim/research';
import {
  AIR_AMMO,
  AIR_MENU,
  AIRFRAMES_HP,
  AIRFRAMES_REARM,
  BUILD_MENU,
  BUILDINGS,
  CALIBRATION_DAMAGE,
  DAMAGE_VS,
  ENGINES_SPEED,
  FLIGHT_TICKS,
  HELIPAD_SLOTS,
  INFANTRY_MENU,
  PLATING_HP,
  PRODUCER,
  REARM_TICKS,
  REFINING_INCOME,
  STANDARD_TECH,
  UNITS,
  UPGRADE_ORDER,
  UPGRADES,
  VEHICLE_MENU,
  hitsAir,
  hitsGround,
  type BuildingKind,
  type Category,
  type Owner,
  type SkirmishSetup,
  type UnitKind,
  type UpgradeId,
} from '../src/sim/rules';
import { addBuilding, addUnit, createInitialState, migrateState } from '../src/sim/state';
import type { Building, GameState, Unit } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

const AIRCRAFT: UnitKind[] = ['gunship', 'bomber'];
const ANTI_AIR_UNITS: UnitKind[] = ['flaktrack', 'skyhunter'];
const NEW_KINDS: (BuildingKind | UnitKind)[] = ['helipad', 'flakcannon', 'researchlab', 'gunship', 'bomber', 'flaktrack', 'skyhunter'];

export const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
/** Runs n ticks, in actions of at most 500 (the reducer takes no more than 600 at once). */
export function tick(s: GameState, n = 1): GameState {
  for (let left = n; left > 0; left -= 500) s = processAction(s, { type: 'tick', n: Math.min(500, left) });
  return s;
}
export const unitIn = (s: GameState, id: number) => s.units.find(u => u.id === id);
const buildingIn = (s: GameState, id: number) => s.buildings.find(b => b.id === id);
const categoryOfKind = (k: BuildingKind | UnitKind): Category => (k in BUILDINGS ? 'building' : UNITS[k as UnitKind].category);

export function tickUntil(s: GameState, done: (s: GameState) => boolean, max: number): GameState {
  for (let i = 0; i < max && !done(s); i++) s = processAction(s, { type: 'tick' });
  return s;
}

/** Side 1's commander switched off: these sections test the rules, not the commander. */
export function quietCommander(fn: (ok: Ok) => void): (ok: Ok) => void {
  return ok => {
    setAutopilotAi(() => {}, 1);
    try {
      fn(ok);
    } finally {
      setAutopilotAi(null, 1);
    }
  };
}

/**
 * An advanced skirmish on open plains with everyone's units gone, nothing attacking, and a
 * (cx, cy) with 17 by 17 tiles of clear ground round it. Classic research by default: these
 * sections test the round 4 rules exactly (drive-lines.ts tests development lines).
 */
export function airArena(seed = 'air-arena', setup: Partial<SkirmishSetup> = { map: 'plains', tech: 'advanced', credits: 20000, research: 'classic' }) {
  const s = copy(createInitialState(seed, seed, { seed, createdAt: 0, setup }));
  s.units = [];
  for (const m of s.ai) m.nextAttack = 1e9;
  // The middle of the map, made open grass with no ore (no structure stands there at the start).
  const occ = occupancy(s);
  const cx = Math.floor(s.mapW / 2);
  const cy = Math.floor(s.mapH / 2);
  const tiles = s.tiles.split('');
  for (let y = cy - 8; y <= cy + 8; y++)
    for (let x = cx - 8; x <= cx + 8; x++) {
      const k = y * s.mapW + x;
      if (occ[k]) throw new Error('a structure in the middle of the air arena');
      tiles[k] = 'g';
      s.ore[k] = 0;
    }
  s.tiles = tiles.join('');
  return { s, cx, cy };
}

export function put(s: GameState, owner: Owner, kind: UnitKind, x: number, y: number, extra: Partial<Unit> = {}): Unit {
  const u = addUnit(s, owner, kind, x, y);
  if (isAir(u)) u.ammo = AIR_AMMO[kind];
  Object.assign(u, extra);
  return u;
}

/** A Helipad for a side, and aircraft launched from it, parked on its pad. */
export function padWith(s: GameState, owner: Owner, x: number, y: number, kinds: UnitKind[]): { pad: Building; craft: Unit[] } {
  const pad = addBuilding(s, owner, 'helipad', x, y, -100);
  const craft = kinds.map(k => {
    const u = addUnit(s, owner, k, x + 1, y + 1);
    launchAircraft(s, u, pad);
    return u;
  });
  return { pad, craft };
}

// ---------------------------------------------------------------------------------------------

function rulesAndMenus(ok: Ok): void {
  for (const k of AIRCRAFT) {
    ok(UNITS[k].category === 'air' && UNITS[k].armor === 'aircraft', `${k}: an aircraft`);
    ok(AIR_MENU.includes(k) && !STANDARD_TECH.includes(k), `${k}: on the Air tab, advanced tech only`);
    ok((AIR_AMMO[k] ?? 0) > 0 && (REARM_TICKS[k] ?? 0) > 0, `${k}: carries ammunition and rearms`);
    ok(!hitsAir(UNITS[k].weapon!) && hitsGround(UNITS[k].weapon!), `${k}: attacks the ground only`);
  }
  for (const k of ANTI_AIR_UNITS) {
    ok(hitsAir(UNITS[k].weapon!) && !hitsGround(UNITS[k].weapon!), `${k}: anti-air only`);
    ok((UNITS[k].category === 'infantry' ? INFANTRY_MENU : VEHICLE_MENU).includes(k), `${k}: on its menu`);
  }
  ok(hitsAir(BUILDINGS.flakcannon.weapon!) && !hitsGround(BUILDINGS.flakcannon.weapon!), 'Flak Cannon: anti-air only');
  for (const k of ['helipad', 'flakcannon', 'researchlab'] as BuildingKind[]) ok(BUILD_MENU.includes(k) && !STANDARD_TECH.includes(k), `${k}: on the build menu, advanced tech only`);
  ok(PRODUCER.air === 'helipad', 'the air queue is the Helipad\'s');
  for (const u of Object.values(UNITS)) {
    const w = u.weapon;
    // The torpedo (the naval war) hits ships alone, by design: drive-naval.ts checks it.
    if (!w || u.category === 'air' || w.kind === 'flak' || w.kind === 'aamissile' || w.kind === 'torpedo') continue;
    ok(hitsAir(w) === (w.kind === 'bullet'), `${u.name}: ${w.kind === 'bullet' ? 'bullets reach the air' : 'cannot reach the air'}`);
    ok(hitsGround(w), `${u.name}: still hits the ground`);
  }
  ok(DAMAGE_VS.bullet.aircraft > 0.2 && DAMAGE_VS.bullet.aircraft < 0.5, 'bullets hurt aircraft at a reduced effect');
  for (const w of ['flak', 'aamissile', 'bomb'] as const) ok(FLIGHT_TICKS[w] > 0, `${w}: has a flight time`);
  for (const id of UPGRADE_ORDER) ok(UPGRADES[id].requires.includes('researchlab') && UPGRADES[id].cost > 0 && UPGRADES[id].ticks > 0, `${id}: needs a Lab, costs and takes time`);
  // Round 5 widened UPGRADES with development lines; UPGRADE_ORDER stays the classic ones (six since the air war's Countermeasures).
  ok(new Set(UPGRADE_ORDER).size === UPGRADE_ORDER.length && UPGRADE_ORDER.length === 6 && UPGRADE_ORDER.every(id => id in UPGRADES), 'every classic upgrade listed once');
}

/** Standard tech, the original game and missions offer none of it; advanced tech offers all of it. */
function techLevels(ok: Ok): void {
  const grantAll = (s: GameState) => {
    for (const o of [0, 1] as Owner[])
      for (const k of ['power', 'refinery', 'barracks', 'factory', 'uplink', 'techcentre', 'helipad', 'researchlab'] as BuildingKind[])
        addBuilding(s, o, k, o === 0 ? 1 : s.mapW - 4, o === 0 ? 1 : s.mapH - 4, -100);
    s.players[0].credits = s.players[1].credits = 50000;
    return s;
  };
  const cases: [string, GameState, boolean][] = [
    ['standard tech', grantAll(copy(createInitialState('std', 'std', { seed: 'std', createdAt: 0, setup: { map: 'classic', tech: 'standard' } }))), false],
    ['no setup (the original game)', grantAll(copy(createInitialState('leg', 'leg', { seed: 'leg', createdAt: 0 }))), false],
    ['advanced tech', grantAll(airArena().s), true],
  ];
  for (const [label, s, allowed] of cases) {
    for (const k of NEW_KINDS) {
      const cat = categoryOfKind(k);
      ok(canQueue(s, 0, cat, k) === allowed && canQueue(s, 1, cat, k) === allowed, `${label}: ${k} ${allowed ? 'offered' : 'refused'} to both sides`);
    }
    const r = processAction(s, { type: 'research', upgrade: 'refining' });
    ok((r !== s) === allowed, `${label}: research ${allowed ? 'offered' : 'refused'}`);
    ok(s.players.every(p => Array.isArray(p.queues.air) && p.queues.air.length === 0), `${label}: every player has an (empty) air queue`);
  }
}

/** Aircraft fly straight over water, rock and structures; the ground never sees them. */
function flight(ok: Ok): void {
  const { s: s0, cx, cy } = airArena();
  const s = s0;
  // Water and rock across the line of flight, and a structure on it.
  const tiles = s.tiles.split('');
  for (let y = cy - 3; y <= cy + 3; y++) {
    tiles[y * s.mapW + cx - 2] = 'w';
    tiles[y * s.mapW + cx + 2] = 'r';
  }
  s.tiles = tiles.join('');
  const wall = addBuilding(s, 1, 'power', cx - 1, cy - 1, -100);
  const g = put(s, 0, 'gunship', cx - 6.5, cy + 0.5, { stance: 'hold' });
  const before = { x: g.x, y: g.y };
  let t = processAction(s, { type: 'move', ids: [g.id], x: cx + 6.5, y: cy + 0.5 });
  ok(t !== s, 'an aircraft may be ordered across water, rock and a structure');
  const over = { water: false, rock: false, structure: false };
  let ticks = 0;
  const occ = occupancy(t);
  while (ticks < 400) {
    t = tick(t);
    ticks++;
    const u = unitIn(t, g.id)!;
    const k = Math.floor(u.y) * t.mapW + Math.floor(u.x);
    if (t.tiles[k] === 'w') over.water = true;
    if (t.tiles[k] === 'r') over.rock = true;
    if (occ[k] === wall.id) over.structure = true;
    ok(Math.abs(u.y - before.y) < 1e-9, 'the flight is a straight line');
    if (u.order.type === 'idle') break;
  }
  const end = unitIn(t, g.id)!;
  ok(over.water && over.rock && over.structure, `it flew over water, rock and a structure (${JSON.stringify(over)})`);
  ok(Math.abs(end.x - (cx + 6.5)) < 1e-6, 'and arrived where it was sent');
  ok(ticks <= Math.ceil(13 / UNITS.gunship.speed) + 1, `straight there, no detour (${ticks} ticks)`);

  // Kept on the map: an order past the edge stops short of it.
  let e = processAction(t, { type: 'move', ids: [g.id], x: 0.1, y: cy + 0.5 });
  e = tick(e, 400);
  const at = unitIn(e, g.id)!;
  ok(at.x >= 0.5 - 1e-9 && at.x < 1, `an aircraft keeps inside the map (${at.x.toFixed(2)})`);

  // Ground units never path round an aircraft, and an aircraft is never pushed.
  {
    const { s: base, cx: x0, cy: y0 } = airArena('air-ground');
    const tank = put(base, 0, 'tank', x0 - 5.5, y0 + 0.5);
    const lone = processAction(base, { type: 'move', ids: [tank.id], x: x0 + 5.5, y: y0 + 0.5 });
    const crowded = copy(lone);
    const hover = put(crowded, 0, 'gunship', x0 + 0.5, y0 + 0.5, { stance: 'hold' });
    const a = tick(lone, 150);
    const b = tick(crowded, 150);
    const ta = unitIn(a, tank.id)!;
    const tb = unitIn(b, tank.id)!;
    ok(ta.x === tb.x && ta.y === tb.y, 'a tank drives through the tile under a hovering gunship exactly as through an empty one');
    const h = unitIn(b, hover.id)!;
    ok(h.x === x0 + 0.5 && h.y === y0 + 0.5, 'and the gunship was never pushed');
  }
  // A structure may go up under an aircraft.
  {
    const { s: base, cx: x0, cy: y0 } = airArena('air-place');
    addBuilding(base, 0, 'hq', x0 - 4, y0 - 1, -100);
    put(base, 0, 'gunship', x0 + 0.5, y0 + 0.5, { stance: 'hold' });
    base.players[0].queues.building = [{ kind: 'power', progress: BUILDINGS.power.buildTicks }];
    const placed = processAction(base, { type: 'place', kind: 'power', x: x0, y: y0 });
    ok(placed !== base, 'a Generator can be placed under a hovering aircraft');
  }
}

/** Who can shoot at what. */
function targeting(ok: Ok): void {
  // Every ground weapon but bullets ignores an enemy gunship hovering in its reach.
  const shooters: UnitKind[] = (Object.keys(UNITS) as UnitKind[]).filter(k => {
    const w = UNITS[k].weapon;
    return w && UNITS[k].category !== 'air' && !UNITS[k].hero && !hitsAir(w);
  });
  for (const k of shooters) {
    const { s, cx, cy } = airArena(`aa-${k}`);
    const w = UNITS[k].weapon!;
    const g = put(s, 1, 'gunship', cx + 0.5, cy + 0.5, { stance: 'hold', ammo: 0, order: { type: 'idle' } });
    const shooter = put(s, 0, k, cx + 0.5 + Math.max(w.minRange ?? 0, Math.min(2, w.range - 0.5)), cy + 0.5, { stance: 'aggressive' });
    ok(!canAttack(s, 0, [shooter.id], g.id), `${k}: may not be ordered to attack a gunship`);
    ok(processAction(s, { type: 'attack', ids: [shooter.id], target: g.id }) === s, `${k}: the order is refused`);
    let t = s;
    let engaged = false;
    for (let i = 0; i < 120; i++) {
      t = tick(t);
      if (unitIn(t, shooter.id)?.engage === g.id) engaged = true;
    }
    ok(!engaged, `${k}: never takes the gunship as a target`);
    ok(unitIn(t, g.id)?.hp === UNITS.gunship.hp, `${k}: never damages it`);
  }
  // Structures with guns: the turrets ignore it too.
  for (const k of ['turret', 'rocketturret'] as BuildingKind[]) {
    const { s, cx, cy } = airArena(`aa-${k}`);
    addBuilding(s, 0, k, cx, cy, -100);
    const g = put(s, 1, 'gunship', cx + 2.5, cy + 0.5, { stance: 'hold', ammo: 0 });
    const t = tick(s, 120);
    ok(unitIn(t, g.id)?.hp === UNITS.gunship.hp, `${k}: never fires at an aircraft`);
  }
  // Bullets do, at the reduced effect.
  {
    const { s, cx, cy } = airArena('aa-bullet');
    const g = put(s, 1, 'gunship', cx + 0.5, cy + 0.5, { stance: 'hold', ammo: 0 });
    const r = put(s, 0, 'rifleman', cx + 2.5, cy + 0.5);
    ok(canAttack(s, 0, [r.id], g.id), 'a rifleman may be ordered to attack a gunship');
    const t = tickUntil(s, x => (unitIn(x, g.id)?.hp ?? 0) < UNITS.gunship.hp, 60);
    const hit = UNITS.gunship.hp - unitIn(t, g.id)!.hp;
    const want = Math.max(1, Math.round(UNITS.rifleman.weapon!.damage * DAMAGE_VS.bullet.aircraft));
    ok(hit === want, `a rifleman's bullet takes ${want} from a gunship, the reduced effect (took ${hit})`);
    ok(want < UNITS.rifleman.weapon!.damage * DAMAGE_VS.bullet.light, 'less than it would take from a light vehicle');
  }
  // Flak and anti-air missiles never target the ground.
  for (const k of ANTI_AIR_UNITS) {
    const { s, cx, cy } = airArena(`aa-ground-${k}`);
    const tank = put(s, 1, 'tank', cx + 0.5, cy + 0.5, { stance: 'hold' });
    const hq = s.buildings.find(b => b.owner === 1 && b.kind === 'hq')!;
    const a = put(s, 0, k, cx + 2.5, cy + 0.5, { stance: 'aggressive' });
    ok(!canAttack(s, 0, [a.id], tank.id) && !canAttack(s, 0, [a.id], hq.id), `${k}: may not be ordered at a tank or a structure`);
    let t = s;
    let engaged = false;
    for (let i = 0; i < 120; i++) {
      t = tick(t);
      if (unitIn(t, a.id)?.engage) engaged = true;
    }
    ok(!engaged && unitIn(t, tank.id)?.hp === UNITS.tank.hp, `${k}: never takes or hurts a ground target`);
    // And brings down an aircraft.
    const g = put(t, 1, 'gunship', cx + 4.5, cy + 0.5, { stance: 'hold', ammo: 0 });
    const t2 = tickUntil(t, x => !unitIn(x, g.id), 1500);
    ok(!unitIn(t2, g.id), `${k}: shoots down a gunship`);
  }
  {
    const { s, cx, cy } = airArena('aa-cannon');
    addBuilding(s, 0, 'flakcannon', cx, cy, -100);
    const tank = put(s, 1, 'tank', cx + 2.5, cy + 0.5, { stance: 'hold' });
    const g = put(s, 1, 'gunship', cx + 3.5, cy + 0.5, { stance: 'hold', ammo: 0 });
    const t = tickUntil(s, x => !unitIn(x, g.id), 1500);
    ok(!unitIn(t, g.id), 'a Flak Cannon brings down a gunship');
    ok(unitIn(t, tank.id)?.hp === UNITS.tank.hp, 'and never touches the tank under it (flak splash stays in the air)');
  }
  // Ground splash never reaches an aircraft over its target; bombs never hit aircraft.
  {
    const { s, cx, cy } = airArena('aa-splash');
    const tank = put(s, 1, 'tank', cx + 0.5, cy + 0.5, { stance: 'hold' });
    const g = put(s, 1, 'gunship', cx + 0.5, cy + 0.5, { stance: 'hold', ammo: 0 });
    const art = put(s, 0, 'artillery', cx + 6.5, cy + 0.5);
    let t = processAction(s, { type: 'attack', ids: [art.id], target: tank.id });
    t = tickUntil(t, x => (unitIn(x, tank.id)?.hp ?? 0) < UNITS.tank.hp - 100, 600);
    ok((unitIn(t, tank.id)?.hp ?? 0) < UNITS.tank.hp, 'artillery hits the tank');
    ok(unitIn(t, g.id)?.hp === UNITS.gunship.hp, 'its splash never reaches the gunship over it');
  }
  // A gunship on a ground unit: an idle tank cannot answer and does not try.
  {
    const { s, cx, cy } = airArena('aa-answer');
    const tank = put(s, 1, 'tank', cx + 0.5, cy + 0.5);
    const g = put(s, 0, 'gunship', cx + 3.5, cy + 0.5);
    let t = processAction(s, { type: 'attack', ids: [g.id], target: tank.id });
    t = tickUntil(t, x => (unitIn(x, tank.id)?.hp ?? 0) < UNITS.tank.hp, 200);
    t = tick(t, 30);
    ok((unitIn(t, tank.id)?.hp ?? 0) < UNITS.tank.hp, 'a gunship rockets a tank');
    ok(unitIn(t, tank.id)?.engage !== g.id, 'the tank does not turn on a gunship it cannot hit');
    ok(unitIn(t, tank.id)!.x === cx + 0.5, 'nor chase it');
  }
}

/** Ammunition, rearming, the bomber's run, losing a pad. */
function rearming(ok: Ok): void {
  // A gunship fires one rocket a load, goes home when empty and comes back full.
  {
    const { s, cx, cy } = airArena('rearm-gunship');
    const { pad, craft } = padWith(s, 0, cx - 6, cy - 1, ['gunship']);
    const g = craft[0];
    ok(g.ammo === AIR_AMMO.gunship && g.order.type === 'rearm' && g.pad === pad.id, 'a new gunship starts full, parked on its pad');
    const target = addBuilding(s, 1, 'power', cx + 3, cy, -100);
    let t = processAction(s, { type: 'attack', ids: [g.id], target: target.id });
    let fired = 0;
    let last = AIR_AMMO.gunship!;
    for (let i = 0; i < 1500; i++) {
      t = tick(t);
      const u = unitIn(t, g.id)!;
      if ((u.ammo ?? 0) < last) fired += last - (u.ammo ?? 0);
      last = u.ammo ?? 0;
      if (u.ammo === 0) break;
    }
    ok(fired === AIR_AMMO.gunship, `it fired its ${AIR_AMMO.gunship} loads (${fired})`);
    const dmg = BUILDINGS.power.hp - (buildingIn(t, target.id)?.hp ?? 0);
    ok(dmg > 0, 'and they hit');
    ok(unitIn(t, g.id)!.order.type === 'rearm', 'empty, it heads home to rearm');
    const spot = padSpot(t, pad, unitIn(t, g.id)!);
    t = tickUntil(t, x => (unitIn(x, g.id)!.ammo ?? 0) === AIR_AMMO.gunship, 2000);
    const back = unitIn(t, g.id)!;
    ok(back.ammo === AIR_AMMO.gunship && back.x === spot.x && back.y === spot.y, 'it lands on its pad and rearms in full');
    const tickAt = t.tick;
    t = tick(t, 30);
    ok(unitIn(t, g.id)!.x === spot.x && unitIn(t, g.id)!.order.type === 'rearm', `and stays parked, ready again (tick ${tickAt})`);
  }
  // A parked gunship guards the ground in reach of its pad, without leaving it.
  {
    const { s, cx, cy } = airArena('parked-guard');
    const { craft } = padWith(s, 0, cx - 1, cy - 1, ['gunship']);
    const g = craft[0];
    const tank = put(s, 1, 'tank', cx + 3.5, cy + 0.5, { stance: 'hold' });
    const far = put(s, 1, 'tank', cx + 9.5, cy + 0.5, { stance: 'hold' });
    const at = { x: g.x, y: g.y };
    const t = tick(s, 200);
    ok((unitIn(t, tank.id)?.hp ?? 0) < UNITS.tank.hp, 'a parked gunship rockets an enemy in reach of its pad');
    ok(unitIn(t, far.id)?.hp === UNITS.tank.hp, 'but not one beyond it');
    ok(unitIn(t, g.id)!.x === at.x && unitIn(t, g.id)!.y === at.y && unitIn(t, g.id)!.order.type === 'rearm', 'and never leaves its pad');
  }
  // A bomber flies over its target dropping a line of bombs, then goes home and rearms.
  {
    const { s, cx, cy } = airArena('rearm-bomber');
    const { pad, craft } = padWith(s, 0, cx - 7, cy + 4, ['bomber']);
    const b = craft[0];
    const targets = [addBuilding(s, 1, 'power', cx + 2, cy - 1, -100), addBuilding(s, 1, 'barracks', cx + 2, cy + 1, -100)];
    const aim = targets[0];
    // An enemy gunship hovering right over the target: bombs never touch an aircraft.
    const over = put(s, 1, 'gunship', aim.x + 1, aim.y + 1, { stance: 'hold', ammo: 0, order: { type: 'idle' } });
    let t = processAction(s, { type: 'attack', ids: [b.id], target: aim.id });
    ok(t !== s, 'a bomber may be ordered to attack a structure');
    const bombs: { x: number; y: number; at: number }[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < 600; i++) {
      t = tick(t);
      for (const e of t.effects) if (e.kind === 'bomb' && !seen.has(e.id)) {
        seen.add(e.id);
        bombs.push({ x: e.x, y: e.y, at: e.at });
      }
      if (unitIn(t, b.id)!.ammo === 0 && bombs.length >= AIR_AMMO.bomber! && !t.projectiles.length) break;
    }
    ok(bombs.length === AIR_AMMO.bomber, `a run drops all ${AIR_AMMO.bomber} bombs (${bombs.length})`);
    if (bombs.length >= 3) {
      const a = bombs[0];
      const z = bombs[bombs.length - 1];
      const len = dist(a.x, a.y, z.x, z.y);
      let off = 0;
      for (const p of bombs) off = Math.max(off, Math.abs(((z.x - a.x) * (a.y - p.y) - (a.x - p.x) * (z.y - a.y)) / Math.max(len, 1e-9)));
      ok(off < 0.05, `the bombs fall in a straight line (${off.toFixed(3)} off it)`);
      ok(len > 3 && len < 6, `a line ${len.toFixed(1)} tiles long`);
      const c = { x: aim.x + 1, y: aim.y + 1 };
      ok(bombs.some(p => distToBuilding(p.x, p.y, aim) < 0.5), 'across its target');
      ok(Math.min(...bombs.map(p => dist(p.x, p.y, c.x, c.y))) < 1.5, 'near its middle');
    }
    ok(targets.some(x => (buildingIn(t, x.id)?.hp ?? 0) < BUILDINGS[x.kind].hp), 'the bombs hurt the structures under them');
    ok(unitIn(t, over.id)?.hp === UNITS.gunship.hp, 'and never the aircraft hovering over them');
    ok(unitIn(t, b.id)!.order.type === 'rearm', 'then it heads home');
    t = tickUntil(t, x => unitIn(x, b.id)!.ammo === AIR_AMMO.bomber, 3000);
    const back = unitIn(t, b.id)!;
    const spot = padSpot(t, pad, back);
    ok(back.ammo === AIR_AMMO.bomber && back.x === spot.x && back.y === spot.y, 'lands on its pad and rearms: ready again');
    // A second run is possible.
    const again = processAction(t, { type: 'attack', ids: [b.id], target: targets[1].id });
    ok(again !== t, 'and may be sent again');

    // Its pad gone, it lands at another with room; with none, it waits where it is.
    const other = addBuilding(t, 0, 'helipad', cx - 7, cy - 6, -100);
    let r = copy(t);
    r.buildings = r.buildings.filter(x => x.id !== pad.id);
    const u = unitIn(r, b.id)!;
    u.ammo = 0;
    u.order = { type: 'idle' };
    r = tick(r, 5);
    ok(unitIn(r, b.id)!.order.type === 'rearm' && unitIn(r, b.id)!.pad === other.id, 'its Helipad gone, it belongs to another with room');
    r = tickUntil(r, x => unitIn(x, b.id)!.ammo === AIR_AMMO.bomber, 3000);
    const there = unitIn(r, b.id)!;
    ok(there.ammo === AIR_AMMO.bomber && distToBuilding(there.x, there.y, other) === 0, 'and rearms there');
    let n = copy(t);
    n.buildings = n.buildings.filter(x => x.kind !== 'helipad');
    const nu = unitIn(n, b.id)!;
    nu.ammo = 0;
    nu.order = { type: 'idle' };
    n = tick(n, 10);
    const p0 = { x: unitIn(n, b.id)!.x, y: unitIn(n, b.id)!.y };
    n = tick(n, 100);
    const w = unitIn(n, b.id)!;
    ok(w.order.type === 'rearm' && w.pad === 0 && w.x === p0.x && w.y === p0.y && w.ammo === 0, 'with no Helipad at all, it waits where it is');
    ok(homePad(n, w) === 0, 'and has no pad to go to');
  }
  // A Helipad serves HELIPAD_SLOTS aircraft: the air queue stops there.
  {
    const { s, cx, cy } = airArena('slots');
    addBuilding(s, 0, 'techcentre', cx + 4, cy + 4, -100);
    padWith(s, 0, cx - 6, cy - 1, []);
    let t = s;
    for (let i = 0; i < HELIPAD_SLOTS; i++) t = processAction(t, { type: 'queue', category: 'air', kind: 'gunship' });
    ok(t.players[0].queues.air.length === HELIPAD_SLOTS && airRoom(t, 0) === 0, `one Helipad takes ${HELIPAD_SLOTS} aircraft`);
    ok(processAction(t, { type: 'queue', category: 'air', kind: 'bomber' }) === t, 'and no more');
    t = tickUntil(t, x => x.units.filter(isAir).length === HELIPAD_SLOTS, 1000);
    const craft = t.units.filter(isAir);
    ok(craft.length === HELIPAD_SLOTS, 'both are built');
    ok(new Set(craft.map(u => `${u.x},${u.y}`)).size === HELIPAD_SLOTS, 'and park side by side on the pad');
  }
}

/** Each upgrade: refused, charged, refunded, measured, kept. */
function research(ok: Ok): void {
  const lab = (seed: string) => {
    const a = airArena(seed);
    addBuilding(a.s, 0, 'researchlab', a.cx - 6, a.cy - 6, -100);
    const kinds: BuildingKind[] = ['techcentre', 'helipad', 'refinery', 'factory', 'power', 'power', 'power'];
    kinds.forEach((k, i) => addBuilding(a.s, 0, k, 1 + i * 4, 1, -100));
    return a;
  };
  const finish = (s: GameState, id: UpgradeId): GameState => {
    let t = processAction(s, { type: 'research', upgrade: id });
    t = tickUntil(t, x => hasUpgrade(x, 0, id), UPGRADES[id].ticks * 3);
    return t;
  };
  for (const id of UPGRADE_ORDER) {
    const { s } = lab(`res-${id}`);
    const spec = UPGRADES[id];
    // Refused without a Lab, and without the credits.
    const noLab = copy(s);
    noLab.buildings = noLab.buildings.filter(b => b.kind !== 'researchlab');
    ok(processAction(noLab, { type: 'research', upgrade: id }) === noLab, `${id}: refused without a Research Lab`);
    const poor = copy(s);
    poor.players[0].credits = spec.cost - 1;
    ok(processAction(poor, { type: 'research', upgrade: id }) === poor, `${id}: refused without the credits`);
    // Charged in full when started; refunded in full when cancelled.
    const before = s.players[0].credits;
    const started = processAction(s, { type: 'research', upgrade: id });
    ok(started !== s && started.players[0].credits === before - spec.cost && started.players[0].research?.id === id, `${id}: paid in full when started`);
    ok(processAction(started, { type: 'research', upgrade: UPGRADE_ORDER.find(x => x !== id)! }) === started, `${id}: one at a time`);
    const cancelled = processAction(tick(started, 50), { type: 'cancelResearch' });
    ok(cancelled.players[0].credits === before && !cancelled.players[0].research, `${id}: refunded in full when cancelled`);
    ok(processAction(cancelled, { type: 'cancelResearch' }) === cancelled, `${id}: nothing left to cancel`);
    // Time: full speed, and paused without a Lab.
    const run = tick(started, spec.ticks - 1);
    ok(!hasUpgrade(run, 0, id) && hasUpgrade(tick(run, 1), 0, id), `${id}: done in exactly ${spec.ticks} ticks with power`);
    const paused = copy(started);
    paused.buildings = paused.buildings.filter(b => b.kind !== 'researchlab');
    const p2 = tick(paused, 100);
    ok(p2.players[0].research?.progress === 0, `${id}: no progress while no Lab stands`);
    const done = tick(run, 1);
    ok(processAction(done, { type: 'research', upgrade: id }) === done, `${id}: cannot be researched twice`);
    // Kept through a save and migrateState, and plays on identically.
    const saved = migrateState(JSON.parse(JSON.stringify(done)));
    ok(!!saved && hasUpgrade(saved, 0, id), `${id}: kept through a save`);
    const mid = migrateState(JSON.parse(JSON.stringify(tick(started, 77))));
    ok(!!mid && mid.players[0].research?.id === id && mid.players[0].research?.progress === 77, `${id}: research under way kept through a save`);
    if (saved) ok(JSON.stringify(tick(saved, 200)) === JSON.stringify(tick(done, 200)), `${id}: a saved battle plays on exactly`);
  }
  // Half speed on low power.
  {
    const { s } = lab('res-power');
    s.buildings = s.buildings.filter(b => b.kind !== 'power');
    const started = processAction(s, { type: 'research', upgrade: 'engines' });
    const t = tick(started, 100);
    ok(t.players[0].research?.progress === 50, `half speed while power is short (${t.players[0].research?.progress})`);
  }

  // The effects, each measured on the number it changes.
  // Plating: vehicles' full health, on those standing and those to come.
  {
    const { s, cx, cy } = lab('fx-plating');
    const tank = put(s, 0, 'tank', cx + 0.5, cy + 0.5);
    tank.hp = 300;
    const rifle = put(s, 0, 'rifleman', cx + 2.5, cy + 0.5);
    const t = finish(s, 'plating');
    const tk = unitIn(t, tank.id)!;
    ok(tk.maxHp === Math.round(UNITS.tank.hp * PLATING_HP) && tk.hp === 300 + (tk.maxHp! - UNITS.tank.hp), `plating: a tank's full health ${UNITS.tank.hp} -> ${tk.maxHp}, damage kept`);
    ok(unitIn(t, rifle.id)!.maxHp === undefined, 'plating: infantry unchanged');
    const f = copy(t);
    addBuilding(f, 0, 'barracks', cx + 4, cy - 6, -100);
    const fac = f.buildings.find(b => b.owner === 0 && b.kind === 'factory')!;
    void fac;
    f.players[0].queues.vehicle = [{ kind: 'buggy', progress: UNITS.buggy.buildTicks }];
    const g = tick(f, 3);
    const buggy = g.units.find(u => u.kind === 'buggy' && u.owner === 0);
    ok(!!buggy && buggy.maxHp === Math.round(UNITS.buggy.hp * PLATING_HP) && buggy.hp === buggy.maxHp, 'plating: a new vehicle comes out with it');
  }
  // Calibration: what each shot takes.
  {
    const shot = (calibrated: boolean): number => {
      const { s, cx, cy } = lab('fx-calibration');
      if (calibrated) s.players[0].upgrades = ['calibration'];
      const target = addBuilding(s, 1, 'barracks', cx + 3, cy, -100);
      const tank = put(s, 0, 'tank', cx + 0.5, cy + 0.5);
      let t = processAction(s, { type: 'attack', ids: [tank.id], target: target.id });
      t = tickUntil(t, x => (buildingIn(x, target.id)?.hp ?? 0) < BUILDINGS.barracks.hp, 200);
      return BUILDINGS.barracks.hp - buildingIn(t, target.id)!.hp;
    };
    const plain = shot(false);
    const cal = shot(true);
    ok(cal === Math.round(UNITS.tank.weapon!.damage * CALIBRATION_DAMAGE * DAMAGE_VS.shell.building) && cal > plain, `calibration: a tank shell takes ${cal} from a Barracks, not ${plain}`);
    const { s } = lab('fx-calibration-real');
    const t = finish(s, 'calibration');
    ok(hasUpgrade(t, 0, 'calibration'), 'calibration: researched in the Lab');
  }
  // Engines: how far a vehicle gets in the same time; infantry unchanged.
  {
    const run = (tuned: boolean, kind: UnitKind): number => {
      const { s, cx, cy } = lab('fx-engines');
      if (tuned) s.players[0].upgrades = ['engines'];
      const u = put(s, 0, kind, cx - 6.5, cy + 0.5);
      let t = processAction(s, { type: 'move', ids: [u.id], x: cx + 6.5, y: cy + 0.5 });
      t = tick(t, 40);
      return unitIn(t, u.id)!.x - (cx - 6.5);
    };
    const a = run(false, 'tank');
    const b = run(true, 'tank');
    ok(Math.abs(b / a - ENGINES_SPEED) < 0.02, `engines: a tank covers ${(b / a).toFixed(3)} times the ground`);
    ok(run(false, 'rifleman') === run(true, 'rifleman'), 'engines: infantry unchanged');
    const { s } = lab('fx-engines-real');
    ok(hasUpgrade(finish(s, 'engines'), 0, 'engines'), 'engines: researched in the Lab');
  }
  // Refining: what a load pays.
  {
    const pay = (refined: boolean): number => {
      const { s } = lab('fx-refining');
      if (refined) s.players[0].upgrades = ['refining'];
      const ref = s.buildings.find(b => b.owner === 0 && b.kind === 'refinery')!;
      const h = put(s, 0, 'hauler', 0.5, 0.5, { cargo: 600, order: { type: 'harvest', phase: 'unload', tile: -1, refinery: ref.id } });
      void h;
      const before = s.players[0].credits;
      const t = tick(s, 1);
      return t.players[0].credits - before;
    };
    ok(pay(true) === Math.round(50 * REFINING_INCOME) && pay(false) === 50, `refining: a tick of unloading pays ${Math.round(50 * REFINING_INCOME)}, not 50`);
    const { s } = lab('fx-refining-real');
    ok(hasUpgrade(finish(s, 'refining'), 0, 'refining'), 'refining: researched in the Lab');
  }
  // Air frames: aircraft health and rearming time.
  {
    const { s, cx, cy } = lab('fx-airframes');
    const { craft } = padWith(s, 0, cx + 2, cy + 2, ['gunship']);
    const t = finish(s, 'airframes');
    const g = unitIn(t, craft[0].id)!;
    ok(g.maxHp === Math.round(UNITS.gunship.hp * AIRFRAMES_HP) && g.hp === g.maxHp, `airframes: a gunship's health ${UNITS.gunship.hp} -> ${g.maxHp}`);
    const reload = (st: GameState): number => {
      const r = copy(st);
      const u = unitIn(r, craft[0].id)!;
      u.ammo = 0;
      u.cooldown = 0;
      let x = tick(r, 1);
      const start = x.tick;
      x = tickUntil(x, y => (unitIn(y, craft[0].id)!.ammo ?? 0) >= 2, 200);
      return x.tick - start;
    };
    const plain = copy(t);
    plain.players[0].upgrades = [];
    const slow = reload(plain);
    const fast = reload(t);
    ok(slow === REARM_TICKS.gunship && fast === Math.round(REARM_TICKS.gunship! * AIRFRAMES_REARM), `airframes: a load in ${fast} ticks, not ${slow}`);
  }
}

/** Saves from before air power load and play on exactly. */
function oldSaves(ok: Ok): void {
  for (const [label, setup] of [
    ['the original game', undefined],
    ['advanced tech', { map: 'river', tech: 'advanced', research: 'classic' }],
  ] as [string, Partial<SkirmishSetup> | undefined][]) {
    let s = createInitialState('old-air', 'old-air', { seed: 'old-air', createdAt: 0, autopilot: true, ...(setup ? { setup } : {}) });
    s = tick(s, 400);
    s = tick(s, 400);
    const old = JSON.parse(JSON.stringify(s));
    for (const p of old.players) {
      delete p.queues.air;
      delete p.upgrades;
      delete p.research;
    }
    const text = JSON.stringify(old);
    const m = migrateState(old);
    ok(!!m && JSON.stringify(old) === text, `${label}: a save without an air queue loads, untouched`);
    if (!m) continue;
    ok(m.players.every(p => Array.isArray(p.queues.air) && p.queues.air.length === 0), `${label}: every player gets an empty air queue`);
    ok(JSON.stringify(tick(m, 300)) === JSON.stringify(tick(s, 300)), `${label}: and plays on exactly`);
  }
  // Junk in a save is tidied.
  const { s } = airArena('junk');
  const g = put(s, 0, 'gunship', 10.5, 10.5);
  const junk = JSON.parse(JSON.stringify(s));
  junk.players[0].upgrades = ['plating', 'warp drive', 'plating'];
  junk.players[0].research = { id: 'nonsense', progress: 5 };
  junk.units.find((u: Unit) => u.id === g.id).ammo = 'lots';
  const m = migrateState(junk);
  ok(!!m && m.players[0].upgrades?.join() === 'plating' && m.players[0].research === null, 'unknown upgrades and research are dropped');
  ok(!!m && unitIn(m, g.id)!.ammo === AIR_AMMO.gunship, 'nonsense ammunition becomes a full load');
}

/** The computer: builds the Lab and a Helipad, researches, and answers aircraft with anti-air. */
function computer(ok: Ok): void {
  // Side 1 builds on its own; side 0 is a Command Yard that never moves. No attacks.
  const quietBattle = (seed: string, withAir: boolean): { aa: boolean; s: GameState; aaAt: number } => {
    let s = copy(createInitialState(seed, seed, { seed, createdAt: 0, setup: { map: 'plains', tech: 'advanced', credits: 10000, research: 'classic' } }));
    s.units = s.units.filter(u => u.owner !== 0);
    for (const m of s.ai) {
      m.nextAttack = 1e9;
      m.nextRaid = 1e9;
    }
    if (withAir) {
      const hq = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
      padWith(s, 0, hq.x + 4, hq.y, ['gunship', 'gunship']);
    }
    let aa = false;
    let aaAt = -1;
    for (let i = 0; i < 90 && s.winner === null; i++) {
      s = tick(s, 100);
      const has =
        s.units.some(u => u.owner === 1 && (u.kind === 'skyhunter' || u.kind === 'flaktrack')) ||
        s.buildings.some(b => b.owner === 1 && b.kind === 'flakcannon') ||
        Object.values(s.players[1].queues).some(q => q.some(x => x.kind === 'skyhunter' || x.kind === 'flaktrack' || x.kind === 'flakcannon'));
      if (has && !aa) aaAt = s.tick;
      aa = aa || has;
    }
    return { aa, s, aaAt };
  };
  const none = quietBattle('ai-air-none', false);
  ok(!none.aa, 'the computer builds no anti-air while its opponent has no aircraft (15 minutes)');
  const lab = none.s.buildings.some(b => b.owner === 1 && b.kind === 'researchlab');
  const pad = none.s.buildings.some(b => b.owner === 1 && b.kind === 'helipad');
  ok(lab && pad, `in a long battle it builds a Research Lab (${lab}) and a Helipad (${pad})`);
  ok((none.s.players[1].upgrades ?? []).length > 0, `and researches (${(none.s.players[1].upgrades ?? []).join(', ')})`);
  ok(none.s.units.some(u => u.owner === 1 && isAir(u)), 'and flies aircraft');
  const some = quietBattle('ai-air-none', true);
  ok(some.aa, `faced with two gunships, it builds anti-air (from tick ${some.aaAt})`);
}

/** Real battles: both commanders fly strikes; a battle with aircraft replays exactly. */
function battles(ok: Ok): void {
  const play = (seed: string): { s: GameState; bombs: number; rockets: number; air: number } => {
    let s = createInitialState(`air-${seed}`, seed, { seed, difficulty: 'hard', createdAt: 0, autopilot: true, setup: { map: 'plains', tech: 'advanced', research: 'classic' } });
    s.autopilotDifficulty = 'hard';
    let bombs = 0;
    let rockets = 0;
    let air = 0;
    const seen = new Set<number>();
    while (s.winner === null && s.tick < 30000) {
      s = tick(s, 20);
      for (const e of s.effects) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        if (e.kind === 'bomb') bombs++;
      }
      for (const p of s.projectiles) if (!seen.has(p.id) && p.shooter && isAir(unitIn(s, p.shooter) ?? ({ kind: 'rifleman' } as Unit))) {
        seen.add(p.id);
        rockets++;
      }
      air = Math.max(air, s.units.filter(isAir).length);
    }
    return { s, bombs, rockets, air };
  };
  const a = play('strike-1');
  ok(a.air > 0, `aircraft fly in a real battle on Hard (most at once: ${a.air})`);
  ok(a.bombs > 0, `bombers drop bombs in it (${a.bombs})`);
  ok(a.rockets > 0, `gunships fire in it (${a.rockets} rockets seen in flight)`);
  ok(a.s.winner !== null, `it finishes (tick ${a.s.tick})`);
  const b = play('strike-1');
  ok(JSON.stringify(a.s) === JSON.stringify(b.s), 'a battle with aircraft and research replays byte-identically');
  console.log(`  air battle on Hard: ${a.s.winner === null ? 'unfinished' : `side ${a.s.winner} won at ${Math.round(a.s.tick / 600)} min`}; ${a.bombs} bombs, ${a.rockets} gunship rockets, ${a.air} aircraft at most; upgrades ${a.s.players.map(p => (p.upgrades ?? []).length).join(' and ')}`);
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Air power: rules and menus', rulesAndMenus],
  ['Air power: standard tech offers none of it', techLevels],
  ['Air power: flight', quietCommander(flight)],
  ['Air power: who can hit what', quietCommander(targeting)],
  ['Air power: ammunition, rearming and bomb runs', quietCommander(rearming)],
  ['Research', quietCommander(research)],
  ['Air power and research: older saves', oldSaves],
  ['Air power: the computer', computer],
  ['Air power: battles', battles],
];

