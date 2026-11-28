/**
 * High tiers (2026-11-28; setup.highTiers, src/sim/hightiers.ts, src/sim/aiTiers.ts): the harness
 * sections. Each rule is proved by what happens in the simulation. Imported by drive.ts, so its
 * assertions count in the main totals.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { processAction } from '../src/sim/actions';
import { setAutopilotAi } from '../src/sim/ai';
import { launchAircraft } from '../src/sim/air';
import { canAttack, canQueue } from '../src/sim/commands';
import { designateMul, isDismounted } from '../src/sim/hightiers';
import { weaponOf } from '../src/sim/loadout';
import {
  AIR_MENU,
  BREACH_DAMAGE,
  BREACH_RADIUS,
  BUILD_MENU,
  BUILDINGS,
  DEFAULT_SETUP,
  DESIGNATE_DAMAGE,
  DISMOUNT_TAKEN,
  DISMOUNT_TICKS,
  HIGH_TIER_KINDS,
  LEGACY_SETUP,
  MELTDOWN_RADIUS,
  SPIN_MAX,
  STRATOS_MAX,
  UNITS,
  VEHICLE_MENU,
  type BuildingKind,
  type Owner,
  type SkirmishSetup,
  type UnitKind,
} from '../src/sim/rules';
import { addBuilding, addUnit, createInitialState, highTiersOn, migrateState, normaliseSetup, powerOf, researchShort, techAllowed, unlocked } from '../src/sim/state';
import { burnsUpkeep } from '../src/sim/upkeep';
import type { GameState, Unit } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

const ON: Partial<SkirmishSetup> = { map: 'plains', tech: 'advanced', credits: 20000, highTiers: true };
const hash = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
const fresh = (setup: Partial<SkirmishSetup> = ON, seed = 'tiers', autopilot = false, difficulty: 'easy' | 'normal' | 'hard' = 'normal'): GameState =>
  createInitialState(seed, seed, { seed, createdAt: 0, setup, autopilot, difficulty });
function tick(s: GameState, n = 1): GameState {
  for (let left = n; left > 0; left -= 500) s = processAction(s, { type: 'tick', n: Math.min(500, left) });
  return s;
}
const unitIn = (s: GameState, id: number) => s.units.find(u => u.id === id);
const buildingIn = (s: GameState, id: number) => s.buildings.find(b => b.id === id);

/** Every computer commander switched off: these sections test the rules, not the commander. */
function quiet(fn: (ok: Ok) => void): (ok: Ok) => void {
  return ok => {
    for (const o of [0, 1, 2, 3] as Owner[]) setAutopilotAi(() => {}, o);
    try {
      fn(ok);
    } finally {
      for (const o of [0, 1, 2, 3] as Owner[]) setAutopilotAi(null, o);
    }
  };
}

/** A clear arena in the middle of a plains map: no starting units, both yards kept far off. */
function arena(setup: Partial<SkirmishSetup> = ON): GameState {
  const s = fresh(setup, 'tiers-arena');
  s.units = [];
  return s;
}
const mid = (s: GameState) => ({ x: Math.floor(s.mapW / 2), y: Math.floor(s.mapH / 2) });
const ALL_STRUCTURES: BuildingKind[] = ['power', 'refinery', 'barracks', 'factory', 'uplink', 'techcentre', 'strikecommand', 'helipad', 'researchlab', 'protoworks', 'battlecommand', 'reactor'];

function setup(ok: Ok): void {
  ok(DEFAULT_SETUP.highTiers === true, 'a new skirmish has high tiers on');
  ok(LEGACY_SETUP.highTiers === false, 'the legacy setup has them off');
  ok(normaliseSetup({ map: 'plains', tech: 'advanced' }).highTiers === false, 'a setup without the key reads as off, whatever the base');
  ok(normaliseSetup({ ...DEFAULT_SETUP }).highTiers === true, 'the default setup keeps them on');
  ok(normaliseSetup({ ...DEFAULT_SETUP, highTiers: 'yes' as never }).highTiers === false, 'anything but true reads as off');
  ok(normaliseSetup({ ...DEFAULT_SETUP, tech: 'standard' }).highTiers === false, 'standard tech never has them');
  const s = fresh();
  ok(highTiersOn(s), 'on in a skirmish set up with them');
  for (const k of HIGH_TIER_KINDS) {
    ok(techAllowed(s, 0, k), `${k}: allowed with high tiers`);
    ok(!techAllowed(fresh({ ...ON, highTiers: false }), 0, k), `${k}: refused without them`);
  }
  const m = fresh();
  m.mission = {} as GameState['mission'];
  ok(!highTiersOn(m), 'never in a mission');
  const p = fresh();
  p.planet = {} as GameState['planet'];
  ok(!highTiersOn(p), 'never in a planet battle');
  // An older save loads with them off.
  const raw = copy(s) as unknown as { setup: Record<string, unknown> };
  delete raw.setup.highTiers;
  const back = migrateState(raw)!;
  ok(back && back.setup!.highTiers === false && !highTiersOn(back), 'an older save loads with them off');
  // The new items close every list, so no older item moves or loses its hotkey.
  ok(JSON.stringify(BUILD_MENU.slice(-2)) === JSON.stringify(['battlecommand', 'reactor']), 'the two structures close the Structures list');
  ok(JSON.stringify(VEHICLE_MENU.slice(-4)) === JSON.stringify(['outrider', 'mechinf', 'rotarygun', 'atomictank']), 'the four vehicles close the Vehicles list');
  ok(JSON.stringify(AIR_MENU.slice(0, 6)) === JSON.stringify(['reconplane', 'gunship', 'interceptor', 'carrier', 'bomber', 'heavybomber']), 'the Air list keeps its first six');
  ok(JSON.stringify(AIR_MENU.slice(-4)) === JSON.stringify(['scoutdrone', 'strikedrone', 'pathfinder', 'stratos']), 'the drone section and high planes close it');
  for (const k of HIGH_TIER_KINDS) {
    const spec = k in BUILDINGS ? BUILDINGS[k as BuildingKind] : UNITS[k as UnitKind];
    ok(spec.tier === 3 || spec.tier === 4 || spec.tier === 5, `${k}: states its tier`);
  }
}

const requirementsSection = quiet((ok: Ok) => {
  const s = arena();
  const p = s.players[0];
  ok(!unlocked(s, 0, 'battlecommand'), 'Battlefield Command: locked at the start');
  const placed: BuildingKind[] = [];
  let x = 4;
  for (const k of ALL_STRUCTURES.filter(k => k !== 'battlecommand' && k !== 'reactor')) {
    addBuilding(s, 0, k, x, 4);
    placed.push(k);
    x += BUILDINGS[k].w + 1;
  }
  p.upgrades = [];
  ok(!unlocked(s, 0, 'battlecommand') && researchShort(s, 0, 'battlecommand') === 3, 'every structure but no research: still locked, three upgrades short');
  p.upgrades = ['refining', 'plating'];
  ok(!unlocked(s, 0, 'battlecommand') && researchShort(s, 0, 'battlecommand') === 1, 'two upgrades: one short');
  p.upgrades = ['refining', 'plating', 'engines'];
  ok(unlocked(s, 0, 'battlecommand') && researchShort(s, 0, 'battlecommand') === 0, 'three upgrades: open');
  ok(canQueue(s, 0, 'building', 'battlecommand'), 'and it can be queued');
  ok(!unlocked(s, 0, 'reactor'), 'the Reactor Complex needs Battlefield Command standing');
  for (const k of ['rotarygun', 'atomictank'] as UnitKind[]) ok(!unlocked(s, 0, k), `${k}: locked without its structure`);
  for (const k of ['outrider', 'mechinf', 'scoutdrone'] as UnitKind[]) ok(unlocked(s, 0, k), `${k}: open with a Prototype Works`);
  addBuilding(s, 0, 'battlecommand', 4, 10);
  ok(unlocked(s, 0, 'rotarygun') && unlocked(s, 0, 'strikedrone') && unlocked(s, 0, 'pathfinder'), 'Battlefield Command opens tier four');
  ok(!unlocked(s, 0, 'reactor') && researchShort(s, 0, 'reactor') === 2, 'the Reactor Complex is two upgrades short at three');
  p.upgrades = ['refining', 'plating', 'engines', 'calibration', 'airframes'];
  ok(unlocked(s, 0, 'reactor'), 'five upgrades: the Reactor Complex is open');
  const before = powerOf(s, 0);
  addBuilding(s, 0, 'reactor', 8, 10);
  const after = powerOf(s, 0);
  ok(after.made - before.made === BUILDINGS.reactor.power, `the Reactor Complex makes ${BUILDINGS.reactor.power} power`);
  ok(unlocked(s, 0, 'atomictank') && unlocked(s, 0, 'stratos'), 'the Reactor Complex opens tier five');
  // One Stratos at a time.
  ok(canQueue(s, 0, 'air', 'stratos'), 'a Stratos can be queued');
  const q = processAction(s, { type: 'queue', category: 'air', kind: 'stratos' } as never);
  ok(q !== s && q.players[0].queues.air.filter(i => i.kind === 'stratos').length === 1, 'one queued');
  ok(!canQueue(q, 0, 'air', 'stratos') && STRATOS_MAX === 1, 'a second is refused while the first is queued');
  ok(processAction(q, { type: 'queue', category: 'air', kind: 'stratos' } as never) === q, 'the illegal queue returns the same state');
});

const dismount = quiet((ok: Ok) => {
  const s0 = arena();
  const c = mid(s0);
  const m = addUnit(s0, 0, 'mechinf', c.x + 0.5, c.y + 0.5);
  const base = UNITS.mechinf.weapon!;
  let s = tick(s0, DISMOUNT_TICKS - 2);
  ok(!isDismounted(unitIn(s, m.id)!), `still aboard after ${DISMOUNT_TICKS - 2} ticks`);
  ok(weaponOf(s, unitIn(s, m.id)!) === base, 'aboard, it fights with the carrier gun');
  s = tick(s, 3);
  const u = unitIn(s, m.id)!;
  ok(isDismounted(u), `out after ${DISMOUNT_TICKS} ticks still`);
  const w = weaponOf(s, u)!;
  ok(w.damage > base.damage && w.range === base.range + 1, `dismounted: ${w.damage} damage at ${w.range} (aboard ${base.damage} at ${base.range})`);
  ok(weaponOf(s, u) === w, 'the dismounted weapon is one stable object');
  // A move puts the squad back aboard.
  const moved = tick(processAction(s, { type: 'move', ids: [m.id], x: c.x + 5.5, y: c.y + 0.5 } as never), 3);
  ok(!isDismounted(unitIn(moved, m.id)!), 'moving, the squad is back aboard');
  // Takes a quarter less while out: two copies shot by the same rifleman.
  const shoot = (st: GameState): number => {
    const t = copy(st);
    const r = addUnit(t, 1, 'tank', c.x + 3.5, c.y + 0.5);
    const victim = unitIn(t, m.id)!;
    const hp0 = victim.hp;
    let x = processAction(t, { type: 'stance', ids: [m.id], stance: 'hold' } as never);
    x = processAction(x, { type: 'attack', ids: [r.id], target: m.id } as never);
    x = tick(x, 30);
    return hp0 - unitIn(x, m.id)!.hp;
  };
  const out = shoot(s);
  const aboard = (() => {
    const t = copy(s);
    unitIn(t, m.id)!.settled = 0;
    return shoot(t);
  })();
  ok(out > 0 && aboard > 0 && out < aboard, `out, it takes less (${out} against ${aboard} aboard)`);
  ok(Math.abs(out / aboard - DISMOUNT_TAKEN) < 0.12, `about ${DISMOUNT_TAKEN} of the damage (${(out / aboard).toFixed(2)})`);
});

const spin = quiet((ok: Ok) => {
  const s0 = arena();
  const c = mid(s0);
  const g = addUnit(s0, 0, 'rotarygun', c.x + 0.5, c.y + 0.5);
  const target = addUnit(s0, 1, 'bastion', c.x + 4.5, c.y + 0.5);
  unitIn(s0, target.id)!.hp = 99999;
  unitIn(s0, target.id)!.stance = 'hold';
  let s = processAction(s0, { type: 'attack', ids: [g.id], target: target.id } as never);
  const gaps: number[] = [];
  let last = -1;
  let prevSpin = 0;
  for (let i = 0; i < 160; i++) {
    s = tick(s, 1);
    const u = unitIn(s, g.id)!;
    if ((u.spin ?? 0) !== prevSpin) {
      if (last >= 0) gaps.push(s.tick - last);
      last = s.tick;
      prevSpin = u.spin ?? 0;
    }
    if ((u.spin ?? 0) >= SPIN_MAX) break;
  }
  ok(prevSpin === SPIN_MAX, `spun up to ${SPIN_MAX} shots`);
  ok(gaps.length >= 3 && gaps[gaps.length - 1] < gaps[0], `each shot comes sooner (${gaps.join(', ')} ticks)`);
  // Out of the fight it spins down.
  let d = processAction(s, { type: 'stop', ids: [g.id] } as never);
  d = processAction(d, { type: 'stance', ids: [g.id], stance: 'hold' } as never);
  d = tick(d, 200);
  ok((unitIn(d, g.id)!.spin ?? 0) === 0, 'holding fire, it spins down to nothing');
});

const strikeDrone = quiet((ok: Ok) => {
  const s0 = arena();
  const c = mid(s0);
  const pad = addBuilding(s0, 0, 'helipad', c.x - 8, c.y);
  const dr = addUnit(s0, 0, 'strikedrone', c.x - 7, c.y + 1);
  launchAircraft(s0, dr, pad);
  const tank = addUnit(s0, 1, 'tank', c.x + 4.5, c.y + 0.5);
  const hp0 = tank.hp;
  ok(canAttack(s0, 0, [dr.id], tank.id), 'a Strike Drone can be sent at a tank');
  let s = processAction(s0, { type: 'attack', ids: [dr.id], target: tank.id } as never);
  for (let i = 0; i < 400 && unitIn(s, dr.id); i++) s = tick(s, 1);
  s = tick(s, 10);
  ok(!unitIn(s, dr.id), 'the drone is spent in its dive');
  const left = unitIn(s, tank.id);
  ok(!left || hp0 - left.hp >= 200, `the tank took a heavy blow (${left ? hp0 - left.hp : 'destroyed'})`);
});

const stratos = quiet((ok: Ok) => {
  const s0 = arena();
  const c = mid(s0);
  const pad = addBuilding(s0, 0, 'helipad', c.x - 10, c.y);
  const st = addUnit(s0, 0, 'stratos', c.x - 9, c.y + 1);
  launchAircraft(s0, st, pad);
  unitIn(s0, st.id)!.x = c.x + 0.5;
  unitIn(s0, st.id)!.y = c.y + 0.5;
  unitIn(s0, st.id)!.order = { type: 'idle' };
  const flak = addBuilding(s0, 1, 'flakcannon', c.x + 2, c.y);
  const sky = addUnit(s0, 1, 'skyhunter', c.x - 2.5, c.y + 0.5);
  const fighterPad = addBuilding(s0, 1, 'helipad', c.x + 4, c.y + 4);
  const fighter = addUnit(s0, 1, 'interceptor', c.x + 5, c.y + 5);
  launchAircraft(s0, fighter, fighterPad);
  ok(!canAttack(s0, 1, [sky.id], st.id), 'nothing may be ordered to attack a Stratos');
  const s = tick(s0, 200);
  const u = unitIn(s, st.id);
  ok(u && u.hp === UNITS.stratos.hp, 'two hundred ticks over a Flak Cannon, a Skyhunter and an Interceptor: not a scratch');
  ok(unitIn(s, sky.id)!.engage !== st.id && unitIn(s, fighter.id)!.engage !== st.id && buildingIn(s, flak.id), 'none of them even took aim');
  // The mark: everything within the radius takes a fifth more from its side.
  const s1 = copy(s);
  const near = addBuilding(s1, 1, 'barracks', c.x + 1, c.y + 2);
  ok(designateMul(s1, 0, near.x + 1, near.y + 1) === DESIGNATE_DAMAGE, 'under the Stratos: marked');
  ok(designateMul(s1, 1, near.x + 1, near.y + 1) === 1, 'the mark helps only its own side');
  ok(designateMul(s1, 0, 2, 2) === 1, 'far off: unmarked');
  const shotAt = (st2: GameState, bx: number, by: number): number => {
    const t = copy(st2);
    const b = addBuilding(t, 1, 'barracks', bx, by);
    const tk = addUnit(t, 0, 'tank', bx - 2.5, by + 1);
    const hp0 = b.hp;
    let x = processAction(t, { type: 'attack', ids: [tk.id], target: b.id } as never);
    x = tick(x, 60);
    return hp0 - (buildingIn(x, b.id)?.hp ?? 0);
  };
  const marked = shotAt(s, c.x + 3, c.y - 3);
  const without = copy(s);
  without.units = without.units.filter(v => v.id !== st.id);
  const plain = shotAt(without, c.x + 3, c.y - 3);
  ok(marked > plain && Math.abs(marked / plain - DESIGNATE_DAMAGE) < 0.08, `a marked Barracks takes about a fifth more (${marked} against ${plain})`);
});

const atomic = quiet((ok: Ok) => {
  const s0 = arena();
  const c = mid(s0);
  const a = addUnit(s0, 0, 'atomictank', c.x + 0.5, c.y + 0.5);
  ok(!burnsUpkeep(s0, a), 'the Atomic Tank burns no fuel');
  ok(burnsUpkeep(s0, addUnit(copy(s0), 0, 'tank', 3, 3)), 'a Battle Tank does');
  const near = addUnit(s0, 1, 'tank', c.x + 1.5, c.y + 0.5);
  const far = addUnit(s0, 1, 'tank', c.x + BREACH_RADIUS + 2.5, c.y + 0.5);
  const own = addUnit(s0, 0, 'tank', c.x - 1.5, c.y + 0.5);
  const hpNear = near.hp;
  const hpOwn = own.hp;
  // Hold everyone's fire so only the breach does damage.
  let s = copy(s0);
  for (const u of s.units) u.stance = 'hold';
  unitIn(s, a.id)!.hp = 0;
  s = tick(s, 1);
  ok(!unitIn(s, a.id), 'the Atomic Tank is destroyed');
  const n = unitIn(s, near.id);
  ok(!n || hpNear - n.hp >= BREACH_DAMAGE * 0.4, `an enemy beside it takes the breach (${n ? hpNear - n.hp : 'destroyed'})`);
  ok(unitIn(s, far.id)!.hp === UNITS.tank.hp, 'an enemy beyond the radius is untouched');
  ok(unitIn(s, own.id)!.hp === hpOwn, 'its own side is spared');
  ok(s.log.some(l => l.text.includes('breached')), 'the breach is logged');
  // Abandoned for want of fuel (deserted), it is cold.
  const cold = copy(s0);
  for (const u of cold.units) u.stance = 'hold';
  const ca = unitIn(cold, a.id)!;
  ca.hp = 0;
  ca.deserted = true;
  const after = tick(cold, 1);
  ok(unitIn(after, near.id)!.hp === hpNear, 'an abandoned Atomic Tank does not breach');
});

const meltdown = quiet((ok: Ok) => {
  const s0 = arena();
  const c = mid(s0);
  const r = addBuilding(s0, 0, 'reactor', c.x, c.y);
  const near = addUnit(s0, 1, 'tank', c.x + 4, c.y + 1.5);
  const far = addUnit(s0, 1, 'tank', c.x + 3 + MELTDOWN_RADIUS + 3, c.y + 1.5);
  for (const u of s0.units) u.stance = 'hold';
  const hpNear = near.hp;
  buildingIn(s0, r.id)!.hp = 0;
  const s = tick(s0, 1);
  ok(!buildingIn(s, r.id), 'the Reactor Complex is gone');
  const n = unitIn(s, near.id);
  ok(!n || n.hp < hpNear, `an enemy beside it is caught in the meltdown (${n ? hpNear - n.hp : 'destroyed'})`);
  ok(unitIn(s, far.id)!.hp === UNITS.tank.hp, 'one beyond the radius is untouched');
  ok(s.effects.some(e => e.kind === 'boom' && e.size === 3), 'a great blast is drawn');
});

const promotion = quiet((ok: Ok) => {
  const make = (withCommand: boolean): number => {
    const s0 = arena();
    addBuilding(s0, 0, 'power', 4, 4);
    addBuilding(s0, 0, 'power', 7, 4);
    addBuilding(s0, 0, 'barracks', 10, 4);
    if (withCommand) addBuilding(s0, 0, 'battlecommand', 14, 4);
    let s = processAction(s0, { type: 'queue', category: 'infantry', kind: 'rifleman' } as never);
    s = tick(s, 200);
    const r = s.units.find(u => u.owner === 0 && u.kind === 'rifleman');
    return r ? r.vet : -1;
  };
  ok(make(false) === 0, 'a rifleman without Battlefield Command starts a Rookie');
  ok(make(true) === 1, 'with it standing he arrives a Veteran');
});

/** The commander climbs: given the ground and the research, it raises tiers four and five and fields them. */
function commander(ok: Ok): void {
  const s0 = fresh({ ...ON, credits: 60000 }, 'tiers-ai', false, 'hard');
  const p = s0.players[1];
  p.upgrades = ['refining', 'plating', 'engines', 'calibration', 'airframes'];
  s0.tick = 16200;
  // Side 0 gets nothing to do; side 1 is the commander under test.
  setAutopilotAi(() => {}, 0);
  try {
    let s = s0;
    const seen = new Set<string>();
    for (let i = 0; i < 120 && s.winner === null; i++) {
      s.players[1].credits = Math.max(s.players[1].credits, 30000);
      // Side 0 does nothing and must not fall, or the battle ends before the commander gets there.
      for (const b of s.buildings) if (b.owner === 0) b.hp = 1e6;
      s = tick(s, 100);
      for (const b of s.buildings) if (b.owner === 1) seen.add(b.kind);
      for (const u of s.units) if (u.owner === 1) seen.add(u.kind);
      if (seen.has('reactor') && seen.has('atomictank') && seen.has('stratos')) break;
    }
    for (const k of ['protoworks', 'battlecommand', 'reactor', 'rotarygun', 'atomictank'] as const) ok(seen.has(k), `the Hard commander fields a ${k}`);
    ok(seen.has('stratos') || seen.has('strikedrone'), 'and high-tier aircraft');
  } finally {
    setAutopilotAi(null, 0);
  }
}

/** Whole computer battles with high tiers on: they finish, and replay byte-identically. */
function battles(ok: Ok): void {
  const run = (seed: string): GameState => {
    let s = fresh({ ...DEFAULT_SETUP, map: 'plains', size: 'large', pace: 'long' }, seed, true, 'normal');
    while (s.winner === null && s.tick < 36000) s = tick(s, 500);
    return s;
  };
  for (const seed of ['ht-1']) {
    const a = run(seed);
    const b = run(seed);
    ok(a.winner !== null, `${seed}: finished at ${(a.tick / 600).toFixed(1)} min`);
    ok(hash(a) === hash(b), `${seed}: replays byte-identically`);
  }
  // Off and absent play the same battle, tick for tick.
  const base = { map: 'plains' as const, tech: 'advanced' as const };
  let x = fresh({ ...base, highTiers: false }, 'ht-off', true);
  let y = fresh(base, 'ht-off', true);
  for (let i = 0; i < 12; i++) {
    x = tick(x, 500);
    y = tick(y, 500);
  }
  ok(hash({ ...x, setup: null }) === hash({ ...y, setup: null }), 'off and absent: the same battle for six minutes');
}

function purity(ok: Ok): void {
  for (const f of ['../src/sim/hightiers.ts', '../src/sim/aiTiers.ts']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    ok(!/Math\.random|Date\.now|new Date|performance\.now/.test(src), `${f.split('/').pop()}: no dice and no clock`);
  }
  const s = arena();
  ok(processAction(s, { type: 'queue', category: 'building', kind: 'reactor' } as never) === s, 'an illegal queue returns the same state');
}

export const sections: [string, (ok: Ok) => void][] = [
  ['High tiers: the setup', setup],
  ['High tiers: requirements and research', requirementsSection],
  ['High tiers: Mechanised Infantry dismounts', dismount],
  ['High tiers: the Rotary Cannon spins up', spin],
  ['High tiers: the Strike Drone', strikeDrone],
  ['High tiers: the Stratos', stratos],
  ['High tiers: the Atomic Tank', atomic],
  ['High tiers: the Reactor Complex', meltdown],
  ['High tiers: field promotion', promotion],
  ['High tiers: the commander climbs', commander],
  ['High tiers: whole computer battles', battles],
  ['High tiers: purity', purity],
];

/** Run on its own: npx tsx scripts/drive-hightiers.ts */
if (process.argv[1] && process.argv[1].endsWith('drive-hightiers.ts')) {
  let pass = 0;
  let fail = 0;
  for (const [name, fn] of sections) {
    const t0 = Date.now();
    fn((cond, what) => {
      if (cond) pass++;
      else {
        fail++;
        console.log(`  FAIL ${name}: ${what}`);
      }
    });
    console.log(`${name} (${Date.now() - t0}ms)`);
  }
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
