/**
 * Round 7: structure upgrades and strategic structures (setup.structureUpgrades, setup.strategicBuildings;
 * src/sim/structures.ts, src/sim/aiStructures.ts, fireline-round7-structures.md). Its sections run inside
 * scripts/drive.ts and count in its totals.
 */
import { createHash } from 'node:crypto';
import { MAX_SAVE_BYTES } from '../api/_lib/saves';
import { processAction } from '../src/sim/actions';
import { aimStrike, runAi, setAutopilotAi } from '../src/sim/ai';
import { placementProblem } from '../src/sim/commands';
import { buildingCentre, dist } from '../src/sim/grid';
import { createMissionState, doPower } from '../src/sim/mission';
import { missionContext, newCampaign } from '../src/campaign/progression';
import { MISSIONS } from '../src/campaign/missions';
import { buildPlanetBattle } from '../src/planet/battle';
import {
  BUILDINGS,
  BUNKER_BAIL_HP,
  BUNKER_DAMAGE,
  BUNKER_SLOTS,
  CACHE_CAPTURE_TICKS,
  CACHE_HEAL,
  CACHE_MAX,
  CACHE_RADIUS,
  CACHE_REPAIR,
  CACHE_TICKS,
  DEFAULT_SETUP,
  INTEL_RADIUS,
  LEGACY_SETUP,
  STRUCTURE_LEVELS,
  UNITS,
  UNLOAD_PER_TICK,
  UPGRADE_DAMAGE_TAKEN,
  maxLevelOf,
  type BuildingKind,
  type Owner,
  type SkirmishSetup,
  type UnitKind,
} from '../src/sim/rules';
import { addBuilding, addUnit, createInitialState, migrateState, normaliseSetup, powerOf, techAllowed, visibility } from '../src/sim/state';
import { buildingSpecOf, levelledSpec } from '../src/sim/specs';
import {
  DISGUISES,
  apparentKind,
  apparentSpecOf,
  intelActive,
  levelRateOf,
  strategicOn,
  upgradePrice,
  upgradesOn,
} from '../src/sim/structures';
import type { Building, GameAction, GameState } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
const hash = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const ON: Partial<SkirmishSetup> = { map: 'plains', tech: 'advanced', credits: 20000, structureUpgrades: true, strategicBuildings: true };
const fresh = (setup: Partial<SkirmishSetup> = ON, seed = 'structures'): GameState => createInitialState(seed, seed, { seed, createdAt: 0, setup });
const act = (s: GameState, a: GameAction) => processAction(s, a);
const tick = (s: GameState, n: number) => {
  let x = s;
  for (let left = n; left > 0 && x.winner === null; left -= 100) x = processAction(x, { type: 'tick', n: Math.min(100, left) });
  return x;
};
const bOf = (s: GameState, id: number) => s.buildings.find(b => b.id === id);
const uOf = (s: GameState, id: number) => s.units.find(u => u.id === id);
const R7_FIELDS = ['level', 'upgrade', 'garrison', 'disguise', 'capture', 'entering'];

/** Every computer side does nothing: the sections that stage a scene play it out alone. */
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

/** Side 0's yard, and tiles measured from its centre toward the middle of the map. Starting riflemen cleared. */
function arena(setup: Partial<SkirmishSetup> = ON, seed = 'structures') {
  const s = fresh(setup, seed);
  s.units = [];
  const hq = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
  const cx = hq.x + 1.5;
  const cy = hq.y + 1.5;
  const dir = hq.x < s.mapW / 2 ? 1 : -1;
  const tile = (dx: number, dy = 0) => ({ x: Math.floor(cx + dir * dx), y: Math.floor(cy + dy) });
  const put = (owner: Owner, kind: BuildingKind, dx: number, dy = 0): Building => {
    const p = tile(dx, dy);
    for (let y = p.y - 1; y <= p.y + BUILDINGS[kind].h; y++) for (let x = p.x - 1; x <= p.x + BUILDINGS[kind].w; x++) s.ore[y * s.mapW + x] = 0;
    return addBuilding(s, owner, kind, p.x, p.y, -100);
  };
  // A Generator, so side 0 has power to spare (a Command Yard alone makes 20).
  put(0, 'power', -10, -8);
  const unit = (owner: Owner, kind: UnitKind, x: number, y: number) => {
    const u = addUnit(s, owner, kind, x, y);
    u.stance = 'hold';
    return u;
  };
  return { s, hq, cx, cy, dir, tile, put, unit };
}

// ---------------------------------------------------------------------------------------------

function setup(ok: Ok): void {
  ok(DEFAULT_SETUP.structureUpgrades === true && DEFAULT_SETUP.strategicBuildings === true, 'a new skirmish has both structure options on');
  ok(LEGACY_SETUP.structureUpgrades === false && LEGACY_SETUP.strategicBuildings === false, 'the legacy setup states both off');
  ok(normaliseSetup({}).structureUpgrades === false && normaliseSetup({}).strategicBuildings === false, 'a setup saved before them reads as off');
  ok(normaliseSetup({ tech: 'advanced' }, { ...DEFAULT_SETUP }).structureUpgrades === false, 'absent reads as off whatever the base says');
  ok(normaliseSetup(DEFAULT_SETUP).structureUpgrades === true && normaliseSetup(DEFAULT_SETUP).strategicBuildings === true, 'the default setup keeps them on');
  ok(normaliseSetup({ ...DEFAULT_SETUP, tech: 'standard' }).structureUpgrades === false && normaliseSetup({ ...DEFAULT_SETUP, tech: 'standard' }).strategicBuildings === false, 'standard tech turns both off');
  ok(normaliseSetup({ tech: 'advanced', structureUpgrades: 'yes' as never, strategicBuildings: 1 as never }).structureUpgrades === false, 'anything but true reads as off');
  const on = fresh();
  ok(upgradesOn(on) && strategicOn(on), 'on in a skirmish set up with them');
  for (const k of ['bunker', 'supplycache', 'intelcentre', 'decoy'] as BuildingKind[]) {
    ok(techAllowed(on, 0, k) && techAllowed(on, 1, k), `${BUILDINGS[k].name}: every side may build it with strategic structures on`);
    ok(!techAllowed(fresh({ ...ON, strategicBuildings: false }), 0, k), `${BUILDINGS[k].name}: not with them off`);
  }
  const c = newCampaign('S');
  const ms = createMissionState(MISSIONS[0], missionContext(c, MISSIONS[0], 'st', 0));
  ok(!ms.setup || ms.setup.structureUpgrades === undefined, 'a mission has no structure options');
  ms.setup = { ...normaliseSetup({ tech: 'advanced' }), structureUpgrades: true, strategicBuildings: true };
  ok(!upgradesOn(ms) && !strategicOn(ms) && !techAllowed(ms, 0, 'bunker'), 'never in a mission, even with the flags forced on');
  const planet = buildPlanetBattle(
    {
      seedText: 'pl',
      difficulty: 'normal',
      mapType: 'plains',
      ore: 'normal',
      sides: [0, 1].map(team => ({ human: false, team, credits: 3000, upgrades: [], doctrines: {}, loadouts: {}, structures: [], units: [], heroes: [], cityTags: [], ai: 'normal' })),
      powers: [],
      battleId: 1,
      defenderSeat: 1,
      timeLimit: 60000,
    } as never,
    { id: 'pl', name: 'pl', createdAt: 0 },
  );
  ok(planet.setup!.structureUpgrades === false && planet.setup!.strategicBuildings === false, 'a planet battle states both off');
}

function offIsBefore(ok: Ok): void {
  // Both off, or absent, or asked for on standard tech: the same battle exactly, and no round-7 field ever.
  for (const [i, seed] of ['off-a', 'off-b'].entries()) {
    const second = i > 0;
    const base: Partial<SkirmishSetup> = { map: i ? 'classic' : 'random', tech: 'advanced', research: i ? 'classic' : 'lines' };
    const run = (setup: Partial<SkirmishSetup>) => {
      let s = createInitialState(seed, seed, { seed, createdAt: 0, autopilot: true, difficulty: 'hard', setup });
      let leaked = false;
      for (let k = 0; k < 40 && s.winner === null; k++) {
        s = processAction(s, { type: 'tick', n: 150 });
        if (s.buildings.some(b => R7_FIELDS.some(f => f in b)) || s.units.some(u => 'entering' in u)) leaked = true;
      }
      return { h: hash(s), leaked, s };
    };
    const absent = run(base);
    const off = run({ ...base, structureUpgrades: false, strategicBuildings: false });
    ok(absent.h === off.h, `${seed}: both off plays exactly as both absent`);
    ok(!absent.leaked && !absent.s.buildings.some(b => ['bunker', 'supplycache', 'intelcentre', 'decoy'].includes(b.kind)), `${seed}: off, no round-7 field and no strategic structure ever appears`);
    if (second) continue;
    const std = run({ map: 'classic', tech: 'standard', structureUpgrades: true, strategicBuildings: true });
    const stdOff = run({ map: 'classic', tech: 'standard' });
    ok(std.h === stdOff.h, `${seed}: on standard tech the options do nothing`);
  }
}

const upgrades = quiet((ok: Ok): void => {
  const { s, put } = arena();
  const t = put(0, 'turret', 5, 0);
  const id = t.id;
  const credits = s.players[0].credits;
  const a = act(s, { type: 'upgradeStructure', id });
  const lv = STRUCTURE_LEVELS.turret![0];
  ok(a !== s && a.players[0].credits === credits - lv.cost && bOf(a, id)!.upgrade?.progress === 0, `Upgrade: ${lv.cost} credits paid at once, the work begun`);
  ok(act(a, { type: 'upgradeStructure', id }) === a, 'a second upgrade on the same structure is refused (the same state)');
  const done = tick(a, lv.ticks);
  ok(bOf(done, id)!.level === 2 && !bOf(done, id)!.upgrade, `done in ${lv.ticks} ticks at full power: Mk II`);
  ok(bOf(tick(a, lv.ticks - 1), id)!.level === undefined, 'and not a tick before');
  ok(bOf(done, id)!.hp === Math.round(BUILDINGS.turret.hp * lv.hpMul!), `the new health comes with it (${bOf(done, id)!.hp})`);
  // Cancelled: everything back.
  const c = act(tick(a, 40), { type: 'cancelUpgrade', id });
  ok(c.players[0].credits === credits && !bOf(c, id)!.upgrade && !bOf(c, id)!.level, 'cancelled: every credit back, no level');
  ok(act(c, { type: 'cancelUpgrade', id }) === c, 'cancelling with nothing under way is refused');
  // Short of power: half speed.
  const lowS = copy(s);
  for (let i = 0; i < 3; i++) addBuilding(lowS, 0, 'strikecommand', 2 + i * 4, 2, -100);
  ok(powerOf(lowS, 0).low, '(power made short)');
  const lowA = act(lowS, { type: 'upgradeStructure', id });
  ok(!bOf(tick(lowA, lv.ticks), id)!.level && bOf(tick(lowA, lv.ticks * 2), id)!.level === 2, 'short of power the work goes at half speed');
  // Industry on: a quarter of the price in alloys, and both back on a cancel.
  const ind = arena({ ...ON, industry: true });
  const it = ind.put(0, 'turret', 5);
  const price = upgradePrice(ind.s, it);
  ok(price.alloys === Math.round((lv.cost * 0.25) / 10) && price.credits === lv.cost - price.alloys * 10, `industry: ${price.credits} credits and ${price.alloys} alloys`);
  const ia = act(ind.s, { type: 'upgradeStructure', id: it.id });
  ok(ia.players[0].alloys === ind.s.players[0].alloys! - price.alloys, 'the alloys are taken');
  const ic = act(ia, { type: 'cancelUpgrade', id: it.id });
  ok(ic.players[0].alloys === ind.s.players[0].alloys && ic.players[0].credits === ind.s.players[0].credits, 'and both come back on a cancel');
  // Refusals.
  const poor = copy(s);
  poor.players[0].credits = lv.cost - 1;
  ok(act(poor, { type: 'upgradeStructure', id }) === poor, 'refused without the credits');
  const bunker = put(0, 'bunker', -6, 4);
  ok(act(s, { type: 'upgradeStructure', id: bunker.id }) === s, 'refused for a structure with no levels');
  const enemyT = put(1, 'turret', 5, 6);
  ok(act(s, { type: 'upgradeStructure', id: enemyT.id }) === s, "refused for the enemy's structure");
  ok(act(s, { type: 'upgradeStructure', id: 99999 }) === s && act(s, { type: 'upgradeStructure', id: 1.5 } as never) === s, 'refused for no such structure, or a junk id');
  const max = copy(done);
  bOf(max, id)!.level = maxLevelOf('turret');
  ok(act(max, { type: 'upgradeStructure', id }) === max, 'refused at the top level');
  const off = arena({ ...ON, structureUpgrades: false });
  const ot = off.put(0, 'turret', 5);
  ok(act(off.s, { type: 'upgradeStructure', id: ot.id }) === off.s, 'refused with structure upgrades off');
  // Sold while upgrading: the upgrade is paid back too.
  const sold = act(a, { type: 'sell', id });
  ok(sold.players[0].credits > a.players[0].credits + lv.cost - 1, 'selling mid-upgrade pays the upgrade back as well');
  // Two levels of a Gun Turret.
  const second = act(done, { type: 'upgradeStructure', id });
  ok(bOf(tick(second, STRUCTURE_LEVELS.turret![1].ticks), id)!.level === 3, 'a Gun Turret rises to Mk III');
});

/** Each level's effect, measured in play wherever it can be. */
const effects = quiet((ok: Ok): void => {
  // Numbers: every level of every kind reads through buildingSpecOf.
  for (const [k, levels] of Object.entries(STRUCTURE_LEVELS) as [BuildingKind, NonNullable<(typeof STRUCTURE_LEVELS)[BuildingKind]>][]) {
    levels.forEach((lv, i) => {
      const spec = levelledSpec('meridian', k, i + 2);
      const base = BUILDINGS[k];
      ok(spec.hp === Math.round(base.hp * (lv.hpMul ?? 1)) && spec.power === base.power + (lv.power ?? 0) && spec.sight === base.sight + (lv.sight ?? 0), `${base.name} ${lv.name}: health, power and sight`);
      if (base.weapon) ok(spec.weapon!.range === base.weapon.range + (lv.range ?? 0), `${base.name} ${lv.name}: range ${spec.weapon!.range}`);
      ok(spec.cost === base.cost + levels.slice(0, i + 1).reduce((n, l) => n + l.cost, 0), `${base.name} ${lv.name}: worth what was paid for it (${spec.cost})`);
    });
  }
  // Gun Turret Mk II reaches a tank its Mk I cannot.
  {
    const { s, put, unit } = arena(ON, 'range');
    const t = put(0, 'turret', 6, 0);
    const c = buildingCentre(t);
    const tank = unit(1, 'tank', c.x + 6, c.y);
    const one = tick(s, 60);
    ok(uOf(one, tank.id)!.hp === UNITS.tank.hp, 'Gun Turret Mk I: a tank 6 tiles out is out of range');
    const s2 = copy(s);
    bOf(s2, t.id)!.level = 2;
    ok(uOf(tick(s2, 60), tank.id)!.hp < UNITS.tank.hp, 'Gun Turret Mk II: the same tank is hit');
  }
  // Rocket Turret Mk II fires a third faster; Flak Mk II reaches further.
  ok(levelledSpec('meridian', 'rocketturret', 2).weapon!.cooldown === Math.round(BUILDINGS.rocketturret.weapon!.cooldown * 0.75), 'Rocket Turret Mk II: reload a quarter shorter');
  ok(levelledSpec('meridian', 'flakcannon', 2).weapon!.range === BUILDINGS.flakcannon.weapon!.range + 1.5, 'Flak Cannon Mk II: +1.5 range');
  // An Advanced Generator makes 70 more power on the same ground.
  {
    const { s, put } = arena(ON, 'power');
    const g = put(0, 'power', -6, 0);
    const before = powerOf(s, 0).made;
    bOf(s, g.id)!.level = 2;
    bOf(s, g.id)!.hp = levelledSpec('meridian', 'power', 2).hp;
    ok(powerOf(s, 0).made === before + 70, `Advanced Generator: power made ${before} to ${powerOf(s, 0).made}`);
  }
  // An Expanded Refinery unloads faster and makes more of each load.
  for (const level of [1, 2]) {
    const { s, put } = arena(ON, 'refinery');
    const r = put(0, 'refinery', -6, -5);
    if (level === 2) r.level = 2;
    s.units = [];
    const h = addUnit(s, 0, 'hauler', 0, 0);
    const d = { x: r.x + 1, y: r.y + (s.buildings[0].y < s.mapH / 2 ? 2 : -1) };
    h.x = d.x + 0.5;
    h.y = d.y + 0.5;
    h.cargo = 600;
    h.order = { type: 'harvest', phase: 'unload', tile: -1, refinery: r.id };
    const c0 = s.players[0].credits;
    let x = s;
    let ticks = 0;
    while (uOf(x, h.id)!.cargo > 0 && ticks < 40) {
      x = processAction(x, { type: 'tick', n: 1 });
      ticks++;
    }
    const got = x.players[0].credits - c0;
    if (level === 1) ok(ticks === Math.ceil(600 / UNLOAD_PER_TICK) && got === 600, `Refinery: a full load unloads in ${ticks} ticks for ${got} credits`);
    else ok(ticks === Math.ceil(600 / (UNLOAD_PER_TICK * 1.5)) && got >= 655 && got <= 665, `Expanded Refinery: in ${ticks} ticks for ${got} credits (10% more, rounded each tick)`);
  }
  // Barracks, War Factory and Command Yard: production speed.
  const rate = (kind: BuildingKind, cat: 'infantry' | 'vehicle' | 'building', item: string, level: number) => {
    const { s, put, hq } = arena(ON, 'rate');
    const b = kind === 'hq' ? hq : put(0, kind, -7, 0);
    if (kind === 'factory') put(0, 'refinery', 7, -6);
    if (level > 1) b.level = level;
    s.players[0].queues[cat].push({ kind: item as never, progress: 0 });
    return tick(s, 10).players[0].queues[cat][0]?.progress ?? -1;
  };
  for (const [kind, cat, item] of [
    ['barracks', 'infantry', 'rocketeer'],
    ['factory', 'vehicle', 'tank'],
    ['hq', 'building', 'factory'],
  ] as const) {
    const one = rate(kind, cat, item, 1);
    for (let lv = 2; lv <= maxLevelOf(kind); lv++) {
      const at = rate(kind, cat, item, lv);
      const want = STRUCTURE_LEVELS[kind]![lv - 2].rate!;
      ok(Math.abs(at / one - want) < 1e-9, `${BUILDINGS[kind].name} level ${lv}: works ${want} times as fast (${one} to ${at} in 10 ticks)`);
    }
  }
  ok(levelRateOf({ kind: 'turret' } as Building) === 1, 'a structure at level 1 works at its usual speed');
  // Comms Uplink level 2: sees further.
  {
    const { s, put } = arena(ON, 'sight');
    const u = put(0, 'uplink', -6, 4);
    const count = (x: GameState) => visibility(x, 0).reduce((n, v) => n + v, 0);
    const before = count(s);
    u.level = 2;
    ok(count(s) > before, `Comms Uplink level 2: ${count(s) - before} more tiles in sight`);
  }
  // While upgrading, a structure takes a quarter more damage; and keeps working.
  {
    const losses: number[] = [];
    for (const upgrading of [false, true]) {
      const { s, hq, unit } = arena(ON, 'risk');
      const c = buildingCentre(hq);
      const tank = unit(1, 'tank', c.x + 3.5, c.y);
      tank.order = { type: 'attack', target: hq.id };
      tank.engage = hq.id;
      let x = s;
      if (upgrading) x = act(x, { type: 'upgradeStructure', id: hq.id });
      const hp0 = bOf(x, hq.id)!.hp;
      x = tick(x, 200);
      losses.push(hp0 - bOf(x, hq.id)!.hp);
    }
    const r = losses[1] / losses[0];
    ok(losses[0] > 0 && r > UPGRADE_DAMAGE_TAKEN - 0.08 && r < UPGRADE_DAMAGE_TAKEN + 0.08, `a Command Yard under upgrade loses ${losses[1]} to ${losses[0]} (x${r.toFixed(2)}, about ${UPGRADE_DAMAGE_TAKEN})`);
    const { s, put, unit } = arena(ON, 'working');
    const t = put(0, 'turret', 5);
    const c = buildingCentre(t);
    const foe = unit(1, 'rifleman', c.x + 3, c.y);
    const x = tick(act(s, { type: 'upgradeStructure', id: t.id }), 40);
    ok((uOf(x, foe.id)?.hp ?? 0) < UNITS.rifleman.hp, 'a turret under upgrade keeps firing');
    // Destroyed mid-upgrade: what was paid is lost.
    const y = act(s, { type: 'upgradeStructure', id: t.id });
    bOf(y, t.id)!.hp = 0;
    const z = tick(y, 1);
    ok(!bOf(z, t.id) && z.players[0].credits === y.players[0].credits, 'lost mid-upgrade: the price is gone with it');
  }
});

const bunker = quiet((ok: Ok): void => {
  const { s, put, unit } = arena(ON, 'bunker');
  const b = put(0, 'bunker', 6, 0);
  const c = buildingCentre(b);
  const riflemen = Array.from({ length: 7 }, (_, i) => unit(0, 'rifleman', c.x - 3 - (i % 3), c.y + 3 + Math.floor(i / 3)));
  const tank = unit(0, 'tank', c.x - 4, c.y - 3);
  const ids = riflemen.map(u => u.id);
  ok(act(s, { type: 'garrison', ids: [tank.id], bunker: b.id }) === s, 'a tank cannot garrison a Bunker (the same state)');
  const enemyB = put(1, 'bunker', 6, 8);
  ok(act(s, { type: 'garrison', ids, bunker: enemyB.id }) === s, "nor can anyone garrison the enemy's");
  ok(act(s, { type: 'garrison', ids, bunker: 4.5 } as never) === s, 'nor a junk id');
  const a = act(s, { type: 'garrison', ids: [...ids, tank.id], bunker: b.id });
  ok(a !== s && a.units.filter(u => u.entering === b.id).length === BUNKER_SLOTS, `ordered in: the ${BUNKER_SLOTS} nearest set off, the seventh and the tank do not`);
  const inside = tick(a, 120);
  ok(bOf(inside, b.id)!.garrison?.length === BUNKER_SLOTS, `after the walk: ${bOf(inside, b.id)!.garrison?.length} inside`);
  const goneIds = bOf(inside, b.id)!.garrison!.map(g => g.id);
  ok(goneIds.every(id => !uOf(inside, id)), 'those inside are off the field');
  ok(act(inside, { type: 'move', ids: goneIds, x: 5, y: 5 }) === inside, 'and cannot be ordered anywhere (the same state)');
  ok(act(inside, { type: 'garrison', ids: [riflemen[6].id], bunker: b.id }) === inside, 'a full Bunker takes no more');
  // Shelter: a barrage on six inside against the same six in the open.
  const barrage = (x: GameState, at: { x: number; y: number }) => {
    const y = copy(x);
    y.powers = [{}, { barrage: 0 }];
    doPower(y, 1, 'barrage', at.x, at.y);
    return tick(y, 80);
  };
  const hit = barrage(inside, c);
  const hpIn = (x: GameState) => bOf(x, b.id)!.garrison!.reduce((n, g) => n + g.hp, 0);
  ok(hpIn(hit) === hpIn(inside), 'inside a Bunker a barrage hurts nobody');
  ok(bOf(hit, b.id)!.hp < bOf(inside, b.id)!.hp, `the Bunker takes it (${bOf(inside, b.id)!.hp - bOf(hit, b.id)!.hp} damage)`);
  const open = copy(inside);
  open.buildings = open.buildings.filter(x => x.id !== b.id);
  open.units = open.units.concat(bOf(inside, b.id)!.garrison!.map((g, i) => ({ ...g, x: c.x - 0.5 + (i % 2), y: c.y - 1 + Math.floor(i / 2) * 0.8 })));
  const openHit = barrage(open, c);
  const lost = goneIds.reduce((n, id) => n + (UNITS.rifleman.hp - (uOf(openHit, id)?.hp ?? 0)), 0);
  ok(lost > 100, `the same six in the open lose ${lost} health`);
  // Firing out, at two thirds strength.
  const out = copy(inside);
  const foe = addUnit(out, 1, 'rifleman', c.x + 4, c.y);
  foe.stance = 'hold';
  const x = tick(out, 30);
  const dealt = UNITS.rifleman.hp - (uOf(x, foe.id)?.hp ?? 0);
  ok(dealt > 0, `the garrison fires out: ${dealt} damage in 3 seconds`);
  const one = Math.max(1, Math.round(UNITS.rifleman.weapon!.damage * BUNKER_DAMAGE));
  ok(dealt % one === 0 || uOf(x, foe.id) === undefined, `each shot at ${Math.round(BUNKER_DAMAGE * 100)}% strength (${one} a bullet)`);
  // Unloaded: out, unhurt, beside it.
  const un = act(inside, { type: 'ungarrison', id: b.id });
  ok(!bOf(un, b.id)!.garrison && goneIds.every(id => uOf(un, id) && dist(uOf(un, id)!.x, uOf(un, id)!.y, c.x, c.y) < 4), 'unloaded: everyone out, round the Bunker');
  ok(act(un, { type: 'ungarrison', id: b.id }) === un, 'unloading an empty Bunker is refused');
  // Falls: they stagger out at half health. Sold: out unhurt.
  const fall = copy(inside);
  bOf(fall, b.id)!.hp = 0;
  const fallen = tick(fall, 1);
  ok(goneIds.every(id => uOf(fallen, id)?.hp === Math.max(1, Math.round(UNITS.rifleman.hp * BUNKER_BAIL_HP))), `when it falls they come out at ${BUNKER_BAIL_HP * 100}% of their health`);
  const sold = act(inside, { type: 'sell', id: b.id });
  ok(goneIds.every(id => uOf(sold, id)?.hp === UNITS.rifleman.hp), 'sold: they walk out unhurt');
  // Taken by the enemy (an Engineer): its old garrison is put out.
  const taken = copy(inside);
  bOf(taken, b.id)!.owner = 1;
  const after = tick(taken, 1);
  ok(!bOf(after, b.id)!.garrison && goneIds.every(id => uOf(after, id)?.owner === 0), 'a Bunker taken over puts its old garrison out');
  const off = arena({ ...ON, strategicBuildings: false }, 'bunker');
  const ob = off.put(0, 'bunker', 6);
  const r = off.unit(0, 'rifleman', ob.x - 1, ob.y);
  ok(act(off.s, { type: 'garrison', ids: [r.id], bunker: ob.id }) === off.s, 'refused with strategic structures off');
});

const cache = quiet((ok: Ok): void => {
  const { s, put, unit, tile } = arena(ON, 'cache');
  // Placement: far from the base, beside your troops only.
  const far = tile(20, 0);
  for (let y = far.y - 2; y <= far.y + 2; y++) for (let x = far.x - 2; x <= far.x + 2; x++) s.ore[y * s.mapW + x] = 0;
  ok(placementProblem(s, 0, 'supplycache', far.x, far.y) !== null, 'twenty tiles from the base, alone: not allowed');
  const scout = unit(0, 'rifleman', far.x + 2.5, far.y + 0.5);
  ok(placementProblem(s, 0, 'supplycache', far.x, far.y) === null, 'with a soldier of yours beside the spot: allowed');
  ok(placementProblem(s, 0, 'turret', far.x, far.y) !== null, 'but nothing else may go there');
  s.units = s.units.filter(u => u.id !== scout.id);
  // Mending.
  const cc = put(0, 'supplycache', -6, 4);
  const cp = buildingCentre(cc);
  const inf = unit(0, 'rifleman', cp.x + 2, cp.y);
  const veh = unit(0, 'tank', cp.x - 2.5, cp.y + 1);
  const outside = unit(0, 'rifleman', cp.x + CACHE_RADIUS + 2, cp.y);
  const foe = unit(1, 'rifleman', cp.x, cp.y - 3);
  foe.stance = 'hold';
  for (const u of [inf, veh, outside, foe]) u.hp = 20;
  inf.stance = veh.stance = outside.stance = 'hold';
  const pulses = 3;
  const x = tick(s, CACHE_TICKS * pulses);
  ok(uOf(x, inf.id)!.hp === 20 + CACHE_HEAL * pulses, `infantry within reach: +${CACHE_HEAL} every ${CACHE_TICKS} ticks`);
  ok(uOf(x, veh.id)!.hp === 20 + CACHE_REPAIR * pulses, `vehicles within reach: +${CACHE_REPAIR}`);
  ok(uOf(x, outside.id)!.hp === 20 && uOf(x, foe.id)!.hp === 20, 'nothing for troops out of reach, or for the enemy');
  // Capture: enemy infantry beside it with none of ours.
  const cap = copy(s);
  cap.units = cap.units.filter(u => u.owner === 1);
  const raider = cap.units.find(u => u.id === foe.id)!;
  raider.x = cp.x + 1;
  raider.y = cp.y;
  const half = tick(cap, CACHE_CAPTURE_TICKS / 2);
  ok(bOf(half, cc.id)!.owner === 0 && (bOf(half, cc.id)!.capture?.progress ?? 0) > 0.4, 'half way: still ours, being taken');
  const won = tick(half, CACHE_CAPTURE_TICKS / 2);
  ok(bOf(won, cc.id)!.owner === 1 && !bOf(won, cc.id)!.capture, `taken in ${CACHE_CAPTURE_TICKS} ticks by one enemy soldier beside it`);
  const held = copy(cap);
  const guard = addUnit(held, 0, 'rifleman', cp.x - 1, cp.y);
  guard.stance = 'hold';
  ok(bOf(tick(held, CACHE_CAPTURE_TICKS + 10), cc.id)!.owner === 0, 'with one of ours beside it, it holds');
  // The limit.
  const lim = copy(s);
  for (let i = 0; i < CACHE_MAX - 1; i++) addBuilding(lim, 0, 'supplycache', 2 + i * 2, 2, -100);
  ok(act(lim, { type: 'queue', category: 'building', kind: 'supplycache' }) === lim, `at most ${CACHE_MAX} Supply Caches`);
  // An outpost keeps no side alive.
  const last = copy(s);
  last.buildings = last.buildings.filter(b => b.owner !== 1);
  addBuilding(last, 1, 'supplycache', 4, 4, -100);
  addBuilding(last, 1, 'decoy', 8, 4, -100);
  ok(tick(last, 1).winner === 0, 'a side left with only a Supply Cache and a Decoy has lost');
});

const intel = quiet((ok: Ok): void => {
  const { s, put, cx, cy } = arena(ON, 'intel');
  const enemyHq = s.buildings.find(b => b.owner === 1 && b.kind === 'hq')!;
  const tileK = enemyHq.y * s.mapW + enemyHq.x;
  ok(visibility(s, 0)[tileK] === 0, "the enemy's yard is out of sight");
  const ic = put(0, 'intelcentre', -6, 4);
  const ec = buildingCentre(enemyHq);
  const icc = buildingCentre(ic);
  const reach = dist(icc.x, icc.y, ec.x, ec.y) <= INTEL_RADIUS;
  if (reach) ok(visibility(s, 0)[tileK] === 1, 'an Intelligence Centre in reach reveals it');
  else {
    // A big map: put an enemy structure within reach to see it.
    const near = addBuilding(s, 1, 'power', Math.floor(icc.x + 10), Math.floor(icc.y - 10), -100);
    ok(visibility(s, 0)[near.y * s.mapW + near.x] === 1, 'an Intelligence Centre reveals an enemy structure in reach');
  }
  ok(intelActive(s, 0), 'and the Intelligence panel is open');
  // Beyond its reach, nothing.
  const far = copy(s);
  const fb = addBuilding(far, 1, 'power', Math.floor(icc.x + (icc.x < s.mapW / 2 ? 1 : -1) * (INTEL_RADIUS + 6)), Math.floor(icc.y), -100);
  ok(visibility(far, 0)[fb.y * far.mapW + fb.x] === 0 || dist(fb.x, fb.y, cx, cy) < 12, 'beyond its reach, nothing more');
  // Short of power: dark.
  const low = copy(s);
  for (let i = 0; i < 3; i++) addBuilding(low, 0, 'strikecommand', 2 + i * 4, 2, -100);
  ok(!intelActive(low, 0) && (reach ? visibility(low, 0)[tileK] === 0 : true), 'short of power it goes dark');
  // The enemy's queues are what the panel reads: they are in the state for it.
  const q = copy(s);
  q.players[1].queues.vehicle.push({ kind: 'tank', progress: 10 });
  ok(intelActive(q, 0) && q.players[1].queues.vehicle.length === 1, 'the panel has the enemy queues to show');
});

const decoy = quiet((ok: Ok): void => {
  const { s, put } = arena(ON, 'decoy');
  const d = put(0, 'decoy', -7, 5);
  ok(apparentKind(s, d, 1) === 'power' && apparentKind(s, d, 0) === 'decoy', 'a new Decoy passes for a Generator to the enemy; its owner knows it');
  const a = act(s, { type: 'disguise', id: d.id, as: 'techcentre' });
  ok(apparentKind(a, bOf(a, d.id)!, 1) === 'techcentre', 'made to look like a Tech Centre');
  ok(apparentSpecOf(a, bOf(a, d.id)!, 1).cost === BUILDINGS.techcentre.cost, 'and the enemy reckons it at a Tech Centre\'s worth');
  ok(act(a, { type: 'disguise', id: d.id, as: 'techcentre' }) === a, 'the same look again is refused');
  ok(act(s, { type: 'disguise', id: d.id, as: 'factory' }) === s, 'a 3 by 3 look is refused (the footprint would give it away)');
  ok(act(s, { type: 'disguise', id: d.id, as: 'nonsense' as never }) === s, 'a junk look is refused');
  ok(!DISGUISES.includes('decoy') && DISGUISES.every(k => BUILDINGS[k].w === 2 && BUILDINGS[k].h === 2), 'it may pass for any other 2 by 2 structure');
  const indOff = act(s, { type: 'disguise', id: d.id, as: 'fuelwell' });
  ok(indOff === s, 'but not one this battle does not have (a Fuel Well without industry)');
  const hqId = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!.id;
  ok(act(s, { type: 'disguise', id: hqId, as: 'power' }) === s, 'only a Decoy can be disguised');
  // The computer's missile and barrage go for it: side 0 has only a Command Yard, Generators and the Decoy (as a Tech Centre).
  const fool = (setLook: boolean, intelFor1: boolean) => {
    const { s: x, put: p } = arena(ON, 'fool');
    p(0, 'power', -7, -5);
    const dd = p(0, 'decoy', 14, 6);
    if (setLook) dd.disguise = 'techcentre';
    if (intelFor1) {
      addBuilding(x, 1, 'intelcentre', dd.x + 3, dd.y + 3, -100);
      addBuilding(x, 1, 'power', dd.x + 6, dd.y + 3, -100);
    }
    const m = aimStrike(x, 1, 'missile');
    const c = buildingCentre(dd);
    return { m, c, b: aimStrike(x, 1, 'barrage') };
  };
  const f = fool(true, false);
  ok(!!f.m && dist(f.m.x, f.m.y, f.c.x, f.c.y) < 1, `the computer aims its missile at a Decoy passing for a Tech Centre (${f.m?.x.toFixed(1)}, ${f.m?.y.toFixed(1)})`);
  ok(!!f.b && dist(f.b.x, f.b.y, f.c.x, f.c.y) < 1, 'and its barrage');
  const g = fool(true, true);
  ok(!!g.m && dist(g.m.x, g.m.y, g.c.x, g.c.y) >= 1, 'not with an Intelligence Centre of its own covering it');
  // Artillery and guns pick an armed-looking Decoy first.
  {
    const { s: x, put: p, unit, dir } = arena(ON, 'guns');
    const real = p(0, 'power', 8, -4);
    const dd = p(0, 'decoy', 8, 4);
    dd.disguise = 'fortress';
    const rc = buildingCentre(real);
    const dc = buildingCentre(dd);
    const art = unit(1, 'artillery', (rc.x + dc.x) / 2 + dir * 6, (rc.y + dc.y) / 2);
    art.stance = 'guard';
    const y = tick(x, 12);
    if (uOf(y, art.id)!.engage !== dd.id) console.log('    artillery engaged', uOf(y, art.id)!.engage, 'decoy', dd.id, 'real', real.id);
    ok(uOf(y, art.id)!.engage === dd.id, 'enemy artillery in range of a Generator and a Decoy passing for a Fortress fires at the Decoy');
    const z = copy(x);
    bOf(z, dd.id)!.disguise = 'power';
    ok(uOf(tick(z, 12), art.id)!.engage !== 0, '(and with two Generators in range it fires at one of them)');
  }
  // Worth nothing: no crew walks out of it.
  const pop = copy(s);
  bOf(pop, d.id)!.hp = 0;
  ok(tick(pop, 1).units.length === pop.units.length, 'a Decoy that bursts sends out no crew');
});

/** The computer: upgrades when rich, the Bunker under pressure, Decoys' looks, Easy doing none of it. */
function aiDecisions(ok: Ok): void {
  for (const diff of ['easy', 'normal', 'hard'] as const) {
    const { s, put } = arena(ON, `ai-${diff}`);
    s.difficulty = diff;
    const hq1 = s.buildings.find(b => b.owner === 1 && b.kind === 'hq')!;
    const t = addBuilding(s, 1, 'turret', hq1.x + 4, hq1.y + 4, -100);
    addBuilding(s, 1, 'power', hq1.x - 4, hq1.y + 4, -100);
    addBuilding(s, 1, 'barracks', hq1.x + 4, hq1.y - 3, -100);
    s.players[1].credits = 10000;
    runAi(s, 1);
    const upgrading = s.buildings.filter(b => b.owner === 1 && b.upgrade).length;
    if (diff === 'easy') ok(upgrading === 0, 'Easy never upgrades');
    else ok(upgrading === 1, `${diff}: rich, it starts an upgrade (${s.buildings.filter(b => b.owner === 1 && b.upgrade).map(b => b.kind).join()})`);
    void t;
    void put;
  }
  // The Bunker under artillery pressure.
  {
    const { s } = arena(ON, 'ai-bunker');
    s.difficulty = 'normal';
    const hq1 = s.buildings.find(b => b.owner === 1 && b.kind === 'hq')!;
    const b = addBuilding(s, 1, 'bunker', hq1.x + 4, hq1.y + (hq1.y < s.mapH / 2 ? 4 : -4), -100);
    const c = buildingCentre(hq1);
    const men = Array.from({ length: 4 }, (_, i) => addUnit(s, 1, 'rifleman', c.x + i - 1.5, c.y + (hq1.y < s.mapH / 2 ? 3 : -3)));
    const arty = addUnit(s, 0, 'artillery', c.x, c.y + (hq1.y < s.mapH / 2 ? 14 : -14));
    arty.stance = 'hold';
    runAi(s, 1);
    ok(men.every(u => s.units.find(v => v.id === u.id)?.entering === b.id), 'under artillery pressure (Normal), idle infantry at home are sent into its Bunker');
    let x = tick(s, 150);
    ok((bOf(x, b.id)!.garrison?.length ?? 0) === men.length, `and go in (${bOf(x, b.id)!.garrison?.length ?? 0})`);
    x = copy(x);
    x.units = x.units.filter(u => u.id !== arty.id);
    x.ai[1].pressureAt = x.tick - 1000;
    runAi(x, 1);
    ok(!bOf(x, b.id)!.garrison, 'once it has been quiet a minute, they come out');
  }
  // Decoys get a look.
  {
    const { s } = arena(ON, 'ai-decoy');
    s.difficulty = 'hard';
    const hq1 = s.buildings.find(b => b.owner === 1 && b.kind === 'hq')!;
    const d = addBuilding(s, 1, 'decoy', hq1.x - 5, hq1.y, -100);
    runAi(s, 1);
    ok(!!d.disguise && d.disguise !== 'decoy', `the computer gives its Decoy a look (${d.disguise})`);
  }
}

function battles(ok: Ok): void {
  const runs: { seed: string; size: 'standard' | 'large'; pace: 'quick' | 'long'; d0: 'normal' | 'hard'; d1: 'normal' | 'hard' }[] = [
    { seed: 'r7-a', size: 'standard', pace: 'quick', d0: 'normal', d1: 'hard' },
    { seed: 'r7-b', size: 'standard', pace: 'quick', d0: 'hard', d1: 'normal' },
    { seed: 'r7-c', size: 'large', pace: 'long', d0: 'normal', d1: 'hard' },
    // 2026-11-27: since the patience cap the Long commander attacks sooner, and r7-c ends at 14
    // minutes, before the late items of Hard's plan. A second Long battle that runs to them (23.7 min).
    { seed: 'r7-d', size: 'large', pace: 'long', d0: 'normal', d1: 'hard' },
  ];
  let decided = 0;
  let upgraded = 0;
  let caches = 0;
  let hardStrategic = 0;
  let badCredits = false;
  let overfull = false;
  for (const r of runs) {
    let s = createInitialState(r.seed, r.seed, { seed: r.seed, createdAt: 0, autopilot: true, difficulty: r.d1, setup: { ...ON, credits: 3000, map: 'random', size: r.size, pace: r.pace } });
    s.autopilotDifficulty = r.d0;
    const cap = r.size === 'large' ? 72000 : 60000;
    let up = false;
    let cache = false;
    let hardS = false;
    while (s.winner === null && s.tick < cap) {
      s = processAction(s, { type: 'tick', n: 100 });
      for (const b of s.buildings) {
        if (b.level || b.upgrade) up = true;
        if (b.kind === 'supplycache') cache = true;
        if ((b.kind === 'intelcentre' || b.kind === 'decoy') && b.owner === (r.d1 === 'hard' ? 1 : 0)) hardS = true;
        if ((b.garrison?.length ?? 0) > BUNKER_SLOTS) overfull = true;
      }
      if (s.players.some(p => p.credits < 0)) badCredits = true;
    }
    if (s.winner !== null) decided++;
    if (up) upgraded++;
    if (cache) caches++;
    if (hardS) hardStrategic++;
  }
  ok(decided === runs.length, `every battle with both options on is decided (${decided} of ${runs.length})`);
  ok(upgraded === runs.length, `the computer upgrades in every one (${upgraded})`);
  ok(caches >= 1, `a Supply Cache goes out with a wave on the large map (${caches} battles)`);
  ok(hardStrategic >= 1, `Hard builds an Intelligence Centre or Decoys at the Long pace (${hardStrategic} battles)`);
  ok(!badCredits && !overfull, 'credits never below nought; no Bunker over-full');
}

function saves(ok: Ok): void {
  const play = (saveAt = -1) => {
    let s = createInitialState('sv', 'sv', { seed: 'sv', createdAt: 0, autopilot: true, difficulty: 'hard', setup: { ...ON, credits: 5000, map: 'classic' } });
    for (let i = 0; i < 160; i++) {
      s = processAction(s, { type: 'tick', n: 50 });
      if (i === saveAt) s = migrateState(JSON.parse(JSON.stringify(s)))!;
    }
    return s;
  };
  const a = play();
  ok(hash(a) === hash(play()) && hash(a) === hash(play(80)), 'a battle with both options replays byte-identically, and through a save mid-battle');
  ok(migrateState(copy(a))!.setup!.structureUpgrades === true && migrateState(copy(a))!.setup!.strategicBuildings === true, 'a save keeps both settings');
  // An old save, from before round 7: loads byte for byte as it was.
  const old = copy(fresh({ map: 'classic', tech: 'advanced' }));
  delete (old.setup as Partial<SkirmishSetup>).structureUpgrades;
  delete (old.setup as Partial<SkirmishSetup>).strategicBuildings;
  const back = migrateState(copy(old))!;
  ok(back.setup!.structureUpgrades === false && back.setup!.strategicBuildings === false, 'an old save reads both as off');
  const { structureUpgrades: _u, strategicBuildings: _s, ...rest } = back.setup!;
  ok(JSON.stringify({ ...back, setup: rest }) === JSON.stringify(old), 'and is otherwise the save it was, byte for byte');
  // Junk repaired or dropped.
  const junk = copy(a);
  const t = junk.buildings.find(b => b.kind === 'turret') ?? junk.buildings[0];
  t.level = 9;
  t.upgrade = { progress: -4, credits: NaN } as never;
  const hq = junk.buildings.find(b => b.kind === 'hq')!;
  hq.garrison = [{ junk: true }] as never;
  hq.disguise = 'power';
  hq.capture = { by: 7, progress: 2 } as never;
  junk.units[0] && ((junk.units[0] as { entering?: unknown }).entering = 'x');
  const fixed = migrateState(junk)!;
  const ft = fixed.buildings.find(b => b.id === t.id)!;
  const fh = fixed.buildings.find(b => b.id === hq.id)!;
  ok(ft.level === undefined && (!ft.upgrade || (ft.upgrade.progress === 0 && ft.upgrade.credits === 0)), 'a junk level is dropped, a junk upgrade repaired');
  ok(!fh.garrison && !fh.disguise && !fh.capture, 'a garrison, look or capture on the wrong structure is dropped');
  ok(!fixed.units[0] || !('entering' in fixed.units[0]), 'a junk walk to a Bunker is dropped');
  const offSave = copy(a);
  offSave.setup = { ...offSave.setup!, structureUpgrades: false, strategicBuildings: false };
  const offed = migrateState(offSave)!;
  ok(!offed.buildings.some(b => R7_FIELDS.some(f => f in b)), 'with the options off a save keeps none of their fields');
}

function saveSize(ok: Ok): void {
  // A huge map, four sides, both options on, twenty minutes: the save stays well inside the 512 KB a save may be.
  let s = createInitialState('huge7', 'huge7', { seed: 'huge7', createdAt: 0, autopilot: true, difficulty: 'hard', setup: { ...ON, credits: 5000, map: 'plains', size: 'huge', sides: 4, mode: 'ffa', pace: 'long' } });
  s.autopilotDifficulty = 'hard';
  let most = 0;
  while (s.winner === null && s.tick < 12000) {
    s = processAction(s, { type: 'tick', n: 200 });
    most = Math.max(most, JSON.stringify(s).length);
  }
  ok(most < MAX_SAVE_BYTES * 0.75, `a huge four-sided battle's save peaks at ${Math.round(most / 1024)} KB (limit ${MAX_SAVE_BYTES / 1024} KB)`);
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Structures: the setup', setup],
  ['Structures: off is the battle as before', offIsBefore],
  ['Structures: upgrading, cancelling and refusals', upgrades],
  ['Structures: what each level gives', effects],
  ['Structures: the Fortified Bunker', bunker],
  ['Structures: the Supply Cache', cache],
  ['Structures: the Intelligence Centre', intel],
  ['Structures: the Decoy', decoy],
  ['Structures: the computer', aiDecisions],
  ['Structures: whole computer battles', battles],
  ['Structures: replays and saves', saves],
  ['Structures: save size on a huge map', saveSize],
];
