/**
 * Generals (fireline-round6-design.md, workstream C), and the round 6 groundwork it stands on: perks
 * for every side, read through perksFor. Its sections run inside scripts/drive.ts and count in its
 * totals. Workstream C adds its own sections after the groundwork's and keeps it.
 */
import { GENERAL_FACTION, GENERAL_IDS, UNITS } from '../src/sim/rules';
import { perksFor } from '../src/sim/specs';
import { addUnit, costFor, costOf, createInitialState, migrateState } from '../src/sim/state';
import type { GameState, Perks } from '../src/sim/types';
// round6:C. Generals: what its own sections use.
import { processAction } from '../src/sim/actions';
import { setAutopilotAi } from '../src/sim/ai';
import { generalPlan, generalPost } from '../src/sim/aiGenerals';
import { canQueue } from '../src/sim/commands';
import { applyDoctrines, doctrinePerks, generalCooldown, generalOf } from '../src/sim/generals';
import { dist, occupancy } from '../src/sim/grid';
import { createMissionState } from '../src/sim/mission';
import { missionContext, newCampaign } from '../src/campaign/progression';
import { MISSIONS } from '../src/campaign/missions';
import {
  AIR_AMMO,
  GENERAL_AURA_RANGE,
  GENERAL_AURA_TICKS,
  GENERAL_REPLACE_TICKS,
  GENERALS,
  INFANTRY_MENU,
  STANDARD_TECH,
  type BuildingKind,
  type Faction,
  type GeneralId,
  type Owner,
  type SkirmishSetup,
  type UnitKind,
} from '../src/sim/rules';
import { addBuilding, maxHpOf, normaliseSetup, techAllowed } from '../src/sim/state';

type Ok = (cond: unknown, what: string) => void;

const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
const NONE: Perks = { harvestMul: 1, buildSpeedMul: 1, costMul: 1, unitHpMul: 1, powerCooldownMul: 1, extraStartCredits: 0 };

function perks(ok: Ok): void {
  ok(GENERAL_IDS.length === 4, 'four doctrine Generals');
  ok(GENERAL_IDS.filter(g => GENERAL_FACTION[g] === 'meridian').length === 2 && GENERAL_IDS.filter(g => GENERAL_FACTION[g] === 'ashen').length === 2, 'two to each army');
  const s = createInitialState('p', 'p', { seed: 'perks', createdAt: 0, setup: { tech: 'advanced', sides: 4 } });
  ok([0, 1, 2, 3].every(o => perksFor(s, o as 0) === undefined), 'a skirmish: no side has perks');
  // Side 0's perks are s.perks, exactly as the campaign has always set them.
  const withPerks = copy(s);
  withPerks.perks = { ...NONE, costMul: 0.9, unitHpMul: 1.16 };
  ok(perksFor(withPerks, 0) === withPerks.perks, "side 0's perks are s.perks");
  ok([1, 2, 3].every(o => perksFor(withPerks, o as 1) === undefined), 's.perks is side 0\'s alone');
  ok(costFor(withPerks, 0, 'tank') === Math.round(costOf('tank') * 0.9) && costFor(withPerks, 1, 'tank') === costOf('tank'), 'Procurement takes its share off side 0 only');
  const tank = addUnit(withPerks, 0, 'tank', 10.5, 10.5);
  ok(tank.maxHp === Math.max(1, Math.round(UNITS.tank.hp * 1.16)) && tank.hp === tank.maxHp, "Armour raises side 0's units");
  ok(addUnit(withPerks, 1, 'tank', 12.5, 10.5).maxHp === undefined, "and nobody else's");
  // Sides 1 to 3: s.sidePerks, read the same way.
  const side = copy(s);
  side.sidePerks = { 2: { ...NONE, costMul: 0.8 } };
  ok(perksFor(side, 2)?.costMul === 0.8 && perksFor(side, 1) === undefined && perksFor(side, 0) === undefined, 'sidePerks reach their own side alone');
  ok(costFor(side, 2, 'factory') === Math.round(costOf('factory') * 0.8) && costFor(side, 3, 'factory') === costOf('factory'), "a side's perks price its own queue");
  // Saves: well-formed perks kept for sides 1 to n - 1; side 0, junk and unknown sides dropped.
  const raw = copy(s) as unknown as Record<string, unknown>;
  raw.sidePerks = { 0: { ...NONE }, 1: { ...NONE, harvestMul: 1.1 }, 2: { harvestMul: 'x' }, 3: null, 7: { ...NONE } };
  const m = migrateState(raw)!;
  ok(!!m.sidePerks && Object.keys(m.sidePerks).join() === '1' && m.sidePerks[1]!.harvestMul === 1.1, 'migrateState keeps well-formed perks for sides 1 to 3 only');
  const empty = copy(s) as unknown as Record<string, unknown>;
  empty.sidePerks = 'junk';
  ok(migrateState(empty)!.sidePerks === undefined, 'junk side perks are dropped');
  ok(migrateState(copy(s))!.sidePerks === undefined, 'a state without side perks has none');
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Round 6 groundwork: perks for every side', perks],
  // round6:C begin. Generals: its sections, appended here.
  ['Generals: doctrines, side by side', doctrines],
  ['Generals: the field General and its rules', fieldRules],
  ['Generals: the command aura, measured', quiet(aura)],
  ['Generals: a fallen General, halved doctrine and replacement', quiet(death)],
  ['Generals: the computer keeps its General back and retreats it', retreat],
  ['Generals: saves, missions and replays', saves],
  ['Generals: whole battles with Generals on', battles],
  // round6:C end.
  // round6:integration begin. The seams section 7 leaves to the integrator.
  ['Integration: a General leads a formation', quiet(generalLeadsSquad)],
  ['Integration: Generals and the two armies', generalsAndArmies],
  ['Integration: the computer never recruits its General with its economy broken', quiet(brokeNoGeneral)],
  // round6:integration end.
];

// round6:C begin. Generals (fireline-round6-design.md, workstream C): its sections.

/** Runs n ticks, in actions of at most 500. */
function run(s: GameState, n = 1): GameState {
  for (let left = n; left > 0; left -= 500) s = processAction(s, { type: 'tick', n: Math.min(500, left) });
  return s;
}

/** Every computer commander switched off: these sections test the rules, not the commander. */
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

/** An advanced skirmish with every unit gone, nothing attacking, and 17 by 17 tiles of clear grass round (cx, cy). */
function arena(setup: Partial<SkirmishSetup> = {}, seed = 'generals-arena') {
  const s = copy(createInitialState(seed, seed, { seed, createdAt: 0, setup: { map: 'plains', tech: 'advanced', credits: 20000, generals: true, ...setup } }));
  s.units = [];
  for (const m of s.ai) m.nextAttack = 1e9;
  const occ = occupancy(s);
  const cx = Math.floor(s.mapW / 2);
  const cy = Math.floor(s.mapH / 2);
  const tiles = s.tiles.split('');
  for (let y = cy - 8; y <= cy + 8; y++)
    for (let x = cx - 8; x <= cx + 8; x++) {
      const k = y * s.mapW + x;
      if (occ[k]) throw new Error('a structure in the middle of the generals arena');
      tiles[k] = 'g';
      s.ore[k] = 0;
    }
  s.tiles = tiles.join('');
  return { s, cx, cy };
}

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const samePerks = (a: Perks | undefined, b: Perks) =>
  !!a && (['harvestMul', 'buildSpeedMul', 'costMul', 'unitHpMul', 'powerCooldownMul', 'extraStartCredits'] as const).every(k => near(a[k], b[k]));

function doctrines(ok: Ok): void {
  ok(GENERAL_IDS.every(g => GENERALS[g].faction === GENERAL_FACTION[g]), 'every General serves the army GENERAL_FACTION names');
  // Each General on one side of a two-sided battle, the other side with none: perks on its side alone.
  for (const g of GENERAL_IDS) {
    for (const seat of [0, 1] as Owner[]) {
      const mine = GENERAL_FACTION[g];
      const factions: Faction[] = seat === 0 ? [mine, 'meridian'] : ['meridian', mine];
      const picks: (GeneralId | null)[] = seat === 0 ? [g, null] : [null, g];
      const s = createInitialState(`d-${g}`, 'd', { seed: `d-${g}`, createdAt: 0, setup: { tech: 'advanced', factions, generalPicks: picks } });
      const other = (1 - seat) as Owner;
      const label = `${GENERALS[g].name} at seat ${seat}`;
      ok(s.players[seat].general === g && s.players[other].general === undefined, `${label}: the doctrine is on its side`);
      ok(samePerks(perksFor(s, seat), doctrinePerks(GENERALS[g])) && perksFor(s, other) === undefined, `${label}: its perks reach its side alone`);
      ok(seat === 0 ? s.sidePerks === undefined : s.perks === undefined, `${label}: stored where perksFor reads it`);
      for (const [kind, mul] of Object.entries(GENERALS[g].costs) as [BuildingKind | UnitKind, number][]) {
        ok(costFor(s, seat, kind) === Math.round(costOf(kind) * mul) && costFor(s, other, kind) === costOf(kind), `${label}: ${kind} at ${mul} of the price, its side only`);
      }
      const air = GENERALS[g].airCostMul;
      ok(costFor(s, seat, 'gunship') === (air === 1 ? costOf('gunship') : Math.round(costOf('gunship') * air)), `${label}: aircraft at ${air} of the price`);
      // Integration: "full price" is the side's own army's price (Ashen's infantry is 5% cheaper).
      const bare = createInitialState(`d-${g}`, 'd', { seed: `d-${g}`, createdAt: 0, setup: { tech: 'advanced', factions } });
      ok(costFor(s, seat, 'rifleman') === costFor(bare, seat, 'rifleman') && costFor(s, seat, 'power') === costFor(bare, seat, 'power'), `${label}: other kinds at full price`);
    }
  }
  ok(
    GENERALS.hale.costs.turret === 0.8 && GENERALS.voss.costs.tank === 0.85 && GENERALS.voss.harvestMul === 0.9 && GENERALS.kade.buildSpeedMul === 1.1 && GENERALS.ilse.costs.helipad === 0.75,
    'the four doctrines carry their numbers',
  );
  // A pick from the other army reads as none, at setup and if forced onto a battle.
  const wrong = normaliseSetup({ tech: 'advanced', factions: ['meridian', 'meridian'], generalPicks: ['kade', 'ilse'] });
  ok(wrong.generalPicks!.every(p => p === null), 'a pick from another army reads as none in the setup');
  const forced = copy(createInitialState('wrong', 'w', { seed: 'wrong', createdAt: 0, setup: { tech: 'advanced' } }));
  applyDoctrines(forced, { ...forced.setup!, generalPicks: ['kade', 'ilse'] });
  ok(forced.players.every(p => p.general === undefined) && forced.perks === undefined && forced.sidePerks === undefined, 'and is refused if forced onto a battle');
  // Defaults: nothing written at all.
  const plain = createInitialState('plain', 'p', { seed: 'plain', createdAt: 0, setup: { tech: 'advanced', sides: 4 } });
  ok(plain.perks === undefined && plain.sidePerks === undefined && plain.players.every(p => !('general' in p)), 'no picks and Generals off: no doctrine, no perks, no new fields');
  // Kade measured: every queue works 10% faster.
  const race = (picks: (GeneralId | null)[]) => {
    let s = copy(createInitialState('kade', 'k', { seed: 'kade', createdAt: 0, setup: { tech: 'advanced', factions: ['ashen', 'ashen'], generalPicks: picks, credits: 10000 } }));
    for (const m of s.ai) m.nextAttack = 1e9;
    s.players[0].queues.building.push({ kind: 'power', progress: 0 });
    s = run(s, 40);
    return s.players[0].queues.building[0]?.progress ?? -1;
  };
  setAutopilotAi(() => {}, 1);
  const fast = race(['kade', null]);
  const slow = race([null, null]);
  setAutopilotAi(null, 1);
  ok(near(fast, slow * 1.1, 1e-6), `Kade: a queue 10% faster (${fast.toFixed(1)} against ${slow.toFixed(1)} ticks of work)`);
  // Ilse measured: a Gunship rearms about 20% faster at a Helipad.
  const rearm = (ilse: boolean) => {
    const { s: s0, cx, cy } = arena({ factions: ['ashen', 'ashen'], generals: false }, 'ilse');
    let s = s0;
    if (ilse) s.players[0].general = 'ilse';
    const pad = addBuilding(s, 0, 'helipad', cx, cy, -100);
    const u = addUnit(s, 0, 'gunship', cx + 1, cy + 1);
    u.ammo = 0;
    u.pad = pad.id;
    u.order = { type: 'rearm', pad: pad.id };
    const full = AIR_AMMO.gunship!;
    let ticks = 0;
    while (ticks < 2000 && (s.units.find(v => v.id === u.id)?.ammo ?? 0) < full) {
      s = run(s, 1);
      ticks++;
    }
    return ticks;
  };
  setAutopilotAi(() => {}, 1);
  const quick = rearm(true);
  const normal = rearm(false);
  setAutopilotAi(null, 1);
  ok(quick < normal && quick >= normal * 0.7 && quick <= normal * 0.88, `Ilse: a Gunship rearms in ${quick} ticks against ${normal}`);
  // The computer's doctrine, with Generals on and none picked: seeded, its own army's, the battle's stream untouched.
  const seen = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const setup: Partial<SkirmishSetup> = { tech: 'advanced', sides: 3, factions: ['meridian', 'ashen', 'meridian'], generals: true };
    const a = createInitialState(`cp-${i}`, 'c', { seed: `cp-${i}`, createdAt: 0, setup });
    const b = createInitialState(`cp-${i}`, 'c', { seed: `cp-${i}`, createdAt: 0, setup });
    const off = createInitialState(`cp-${i}`, 'c', { seed: `cp-${i}`, createdAt: 0, setup: { ...setup, generals: false } });
    ok(a.players[0].general === undefined && a.perks === undefined, `seed ${i}: your seat keeps the doctrine you chose (none)`);
    ok([1, 2].every(o => !!a.players[o].general && GENERAL_FACTION[a.players[o].general!] === (a.players[o].faction ?? 'meridian')), `seed ${i}: each computer seat fights under one of its army's Generals`);
    ok(JSON.stringify(a) === JSON.stringify(b), `seed ${i}: the same choice every time`);
    ok(a.rngSeed === off.rngSeed && a.tiles === off.tiles, `seed ${i}: the battle's own stream and map are untouched`);
    for (const o of [1, 2]) seen.add(a.players[o].general!);
  }
  ok(GENERAL_IDS.every(g => seen.has(g)), `all four Generals are chosen across seeds (${[...seen].join(', ')})`);
}

function fieldRules(ok: Ok): void {
  ok(INFANTRY_MENU.includes('general') && !STANDARD_TECH.includes('general'), 'the General is trained at the Barracks, advanced tech only');
  const off = createInitialState('f', 'f', { seed: 'f', createdAt: 0, setup: { tech: 'advanced' } });
  const std = createInitialState('f', 'f', { seed: 'f', createdAt: 0, setup: { tech: 'standard', generals: true } });
  const on = createInitialState('f', 'f', { seed: 'f', createdAt: 0, setup: { tech: 'advanced', generals: true } });
  ok(!techAllowed(off, 0, 'general') && !techAllowed(off, 1, 'general'), 'Generals off: nobody may train one');
  ok(!techAllowed(std, 0, 'general'), 'standard tech: nobody may train one');
  ok(techAllowed(on, 0, 'general') && techAllowed(on, 1, 'general'), 'Generals on, advanced tech: every side may');
  const { s } = arena();
  addBuilding(s, 0, 'barracks', 3, 3, -100);
  addBuilding(s, 0, 'uplink', 7, 3, -100);
  ok(canQueue(s, 0, 'infantry', 'general'), 'with a Barracks and a Comms Uplink, a General may be queued');
  const q = processAction(s, { type: 'queue', category: 'infantry', kind: 'general' });
  ok(q !== s && q.players[0].queues.infantry.some(x => x.kind === 'general'), 'and is');
  ok(processAction(q, { type: 'queue', category: 'infantry', kind: 'general' }) === q, 'a second, while one is queued: refused (the same state back)');
  const stood = copy(s);
  addUnit(stood, 0, 'general', 20.5, 20.5);
  ok(!canQueue(stood, 0, 'infantry', 'general'), 'a second, while one stands: refused');
  const noUplink = copy(s);
  noUplink.buildings = noUplink.buildings.filter(b => b.kind !== 'uplink');
  ok(!canQueue(noUplink, 0, 'infantry', 'general'), 'no Comms Uplink: refused');
}

/**
 * Hit points a rifleman takes off an enemy General (infantry, so every point of a bullet counts, and
 * held so it never fires back) in `ticks`, with Generals of its own side at these offsets.
 */
function shoot(generals: [number, number][], ticks: number, enemyGeneral = false): { lost: number; marked: boolean } {
  const { s, cx, cy } = arena({}, 'aura');
  const target = addUnit(s, 1, 'general', cx + 3.5, cy + 0.5);
  target.stance = 'hold';
  const r = addUnit(s, 0, 'rifleman', cx + 0.5, cy + 0.5);
  r.order = { type: 'attack', target: target.id };
  r.stance = 'hold';
  for (const [dx, dy] of generals) addUnit(s, 0, 'general', cx + 0.5 + dx, cy + 0.5 + dy).stance = 'hold';
  if (enemyGeneral) addUnit(s, 1, 'general', cx - 2.5, cy + 3.5).stance = 'hold';
  const hp0 = target.hp;
  const out = run(s, ticks);
  const marked = (out.units.find(u => u.id === r.id)?.aura ?? 0) > out.tick;
  return { lost: hp0 - Math.max(0, out.units.find(x => x.id === target.id)?.hp ?? 0), marked };
}

function aura(ok: Ok): void {
  const T = 250;
  const alone = shoot([], T);
  const one = shoot([[-5, 0]], T);
  const two = shoot([[-5, 0], [0, -5]], T);
  const far = shoot([[-(GENERAL_AURA_RANGE + 1), 0]], T);
  const enemy = shoot([], T, true);
  ok(alone.lost > 0 && !alone.marked, `without a General: ${alone.lost} damage, no aura`);
  const ratio = one.lost / alone.lost;
  ok(one.marked && ratio > 1.15 && ratio < 1.3, `inside the aura (5 tiles): ${one.lost} damage, ${ratio.toFixed(3)} times (1.1 damage, 10% faster fire)`);
  ok(two.lost === one.lost, `two Generals' auras do not stack (${two.lost} against ${one.lost})`);
  ok(far.lost === alone.lost && !far.marked, `outside the aura (${GENERAL_AURA_RANGE + 1} tiles): unchanged (${far.lost})`);
  ok(enemy.lost === alone.lost && !enemy.marked, "an enemy General's aura does nothing for you");
  // The scan runs every GENERAL_AURA_TICKS and marks for exactly that long.
  const { s, cx, cy } = arena({}, 'aura-scan');
  addUnit(s, 0, 'general', cx + 0.5, cy + 0.5).stance = 'hold';
  const r = addUnit(s, 0, 'rifleman', cx + 3.5, cy + 0.5);
  r.stance = 'hold';
  let t = run(s, GENERAL_AURA_TICKS + 1);
  const m = t.units.find(u => u.id === r.id)!;
  ok(m.aura !== undefined && m.aura > t.tick && m.aura - t.tick <= GENERAL_AURA_TICKS, 'a unit in reach is marked until the next scan');
  t = copy(t);
  t.units = t.units.filter(u => u.kind !== 'general');
  t = run(t, GENERAL_AURA_TICKS + 1);
  ok(t.units.find(u => u.id === r.id)!.aura === undefined, 'with the General gone the mark is cleared at the next scan');
}

function death(ok: Ok): void {
  const { s: s0 } = arena({ generalPicks: ['hale', null] }, 'death');
  ok(s0.players[0].general === 'hale', 'side 0 fights under Hale');
  const full = doctrinePerks(GENERALS.hale);
  const half = doctrinePerks(GENERALS.hale, 0.5);
  ok(near(half.powerCooldownMul, 0.95) && near(full.powerCooldownMul, 0.9), "halved, Hale's power tweak is 0.95");
  let s = copy(s0);
  addBuilding(s, 0, 'barracks', 3, 3, -100);
  addBuilding(s, 0, 'uplink', 7, 3, -100);
  const g = addUnit(s, 0, 'general', 20.5, 20.5);
  s = run(s, 2);
  ok(s.players[0].generalUnit === g.id && samePerks(perksFor(s, 0), full), 'a standing General: the doctrine at full strength');
  ok(costFor(s, 0, 'turret') === Math.round(costOf('turret') * 0.8), 'Defences at 0.8 of the price');
  s = copy(s);
  s.units.find(u => u.id === g.id)!.hp = 0;
  s = run(s, 2);
  const fell = s.players[0].generalLostAt!;
  ok(fell !== undefined && s.players[0].generalUnit === undefined, 'the General falls: noted');
  ok(samePerks(perksFor(s, 0), half), 'the doctrine counts at half: perks replaced');
  ok(costFor(s, 0, 'turret') === Math.round(costOf('turret') * 0.9), 'and Defences at 0.9 of the price');
  ok(s.log.some(l => l.text.startsWith('Your General has fallen')), 'the player is told');
  ok(!canQueue(s, 0, 'infantry', 'general') && generalCooldown(s, 0) > 0, 'a replacement may not be queued at once');
  s = run(s, GENERAL_REPLACE_TICKS - (s.tick - fell) - 1);
  ok(!canQueue(s, 0, 'infantry', 'general') && generalCooldown(s, 0) === 1, 'nor a tick before the cooldown ends');
  s = run(s, 1);
  ok(canQueue(s, 0, 'infantry', 'general'), `a replacement may be queued ${GENERAL_REPLACE_TICKS / 10} seconds after the fall`);
  s = processAction(s, { type: 'queue', category: 'infantry', kind: 'general' });
  ok(samePerks(perksFor(s, 0), half), 'queued is not arrived: still at half');
  let n = 0;
  while (!generalOf(s, 0) && n < 3000) {
    s = run(s, 10);
    n += 10;
  }
  s = run(s, 1);
  ok(!!generalOf(s, 0) && s.players[0].generalLostAt === undefined && samePerks(perksFor(s, 0), full), `the replacement arrives (${n} ticks of training): full strength again`);
  // Side 1's General, in sidePerks, the same.
  const { s: e0 } = arena({ factions: ['meridian', 'ashen'], generalPicks: [null, 'kade'] }, 'death-1');
  let e = copy(e0);
  const eg = addUnit(e, 1, 'general', 30.5, 10.5);
  e = run(e, 2);
  e = copy(e);
  e.units.find(u => u.id === eg.id)!.hp = 0;
  e = run(e, 2);
  ok(samePerks(perksFor(e, 1), doctrinePerks(GENERALS.kade, 0.5)) && perksFor(e, 0) === undefined, "side 1's General falls: its sidePerks halve, nobody else's");
  ok(e.log.some(l => l.text === 'An enemy General has fallen.'), 'and the player hears of it');
  // No doctrine: the fall still costs the aura and starts the cooldown, and no perks appear.
  const { s: n0 } = arena({}, 'death-none');
  let nd = copy(n0);
  const ng = addUnit(nd, 0, 'general', 20.5, 20.5);
  nd = run(nd, 2);
  nd = copy(nd);
  nd.units.find(u => u.id === ng.id)!.hp = 0;
  nd = run(nd, 2);
  ok(nd.perks === undefined && nd.players[0].generalLostAt !== undefined, 'no doctrine: no perks, but the cooldown runs');
}

function retreat(ok: Ok): void {
  const { s, cx, cy } = arena({}, 'retreat');
  const home = { x: 5, y: s.mapH - 5 };
  const enemyHome = { x: s.mapW - 5, y: 5 };
  const g = addUnit(s, 1, 'general', cx + 0.5, cy + 0.5);
  const mem = s.ai[1];
  // A wave out on the attack: the General stands behind its centre, away from the enemy.
  const wave = [addUnit(s, 1, 'tank', cx + 4.5, cy - 3.5), addUnit(s, 1, 'tank', cx + 5.5, cy - 2.5), addUnit(s, 1, 'rifleman', cx + 4.5, cy - 2.5)];
  mem.waveIds = wave.map(u => u.id);
  mem.wavePhase = 2;
  const centre = { x: wave.reduce((a, u) => a + u.x, 0) / 3, y: wave.reduce((a, u) => a + u.y, 0) / 3 };
  const post = generalPost(s, 1, g, home, enemyHome);
  ok(!post.back && dist(post.at.x, post.at.y, enemyHome.x, enemyHome.y) > dist(centre.x, centre.y, enemyHome.x, enemyHome.y), 'with the wave out: behind its centre, away from the enemy');
  ok(dist(post.at.x, post.at.y, centre.x, centre.y) < GENERAL_AURA_RANGE, "and close enough for the aura to reach the wave's centre");
  // Health: below 40% it goes home; it stays back until 75%.
  const at = (share: number, back: boolean) => {
    g.hp = Math.round(maxHpOf(g) * share);
    if (back) mem.generalBack = true;
    else delete mem.generalBack;
    return generalPost(s, 1, g, home, enemyHome);
  };
  const low = at(0.39, false);
  ok(low.back && dist(low.at.x, low.at.y, home.x, home.y) <= 3.01, 'below 40% of its health: pulled back home');
  ok(!at(0.41, false).back, 'at 41%, not yet');
  ok(at(0.6, true).back && !at(0.8, true).back, 'once back, it waits until 75% before going out again');
  // The plan itself: a hurt General is ordered home, and a healthy one far off is sent behind its wave.
  const t = copy(s);
  const tg = t.units.find(u => u.id === g.id)!;
  tg.hp = Math.round(maxHpOf(tg) * 0.3);
  delete t.ai[1].generalBack;
  generalPlan(t, 1, home, enemyHome, t.units.filter(u => u.owner === 1));
  ok(t.ai[1].generalBack === true && tg.order.type === 'move' && dist(tg.order.x, tg.order.y, home.x, home.y) < 6, 'generalPlan orders a hurt General home');
  const h = copy(s);
  const hg = h.units.find(u => u.id === g.id)!;
  hg.hp = maxHpOf(hg);
  hg.x = cx - 7.5;
  hg.y = cy + 7.5;
  delete h.ai[1].generalBack;
  generalPlan(h, 1, home, enemyHome, h.units.filter(u => u.owner === 1));
  ok(hg.order.type === 'move' && dist(hg.order.x, hg.order.y, centre.x, centre.y) < 5, 'a healthy General away from its wave is sent back behind it');
}

function saves(ok: Ok): void {
  const s = createInitialState('sv', 'sv', { seed: 'sv', createdAt: 0, setup: { tech: 'advanced', generals: true, factions: ['meridian', 'ashen'], generalPicks: ['voss', null] } });
  const back = migrateState(copy(s))!;
  ok(back.players[0].general === 'voss' && !!back.players[1].general && JSON.stringify(back.sidePerks) === JSON.stringify(s.sidePerks), 'a save keeps every doctrine and its perks');
  const junk = copy(s);
  (junk.players[0] as { general?: unknown }).general = 'kade';
  (junk.players[1] as { generalLostAt?: unknown }).generalLostAt = 'soon';
  (junk.players[1] as { generalUnit?: unknown }).generalUnit = -3;
  (junk.ai[1] as { generalBack?: unknown }).generalBack = 'yes';
  const m = migrateState(junk)!;
  ok(m.players[0].general === undefined, 'a General of another army is dropped from a save');
  ok(m.players[1].generalLostAt === undefined && m.players[1].generalUnit === undefined && !!m.players[1].general, 'malformed ticks and ids are dropped, the rest kept');
  ok(m.ai[1].generalBack === undefined, 'malformed memory is dropped');
  const plain = createInitialState('sv0', 'sv', { seed: 'sv0', createdAt: 0, setup: { tech: 'advanced' } });
  ok(JSON.stringify(migrateState(copy(plain))) === JSON.stringify(plain) || migrateState(copy(plain))!.players.every(p => !('general' in p)), 'a battle without Generals loads without any');
  // Missions: nothing of Generals appears, and the General is out of reach.
  const c = newCampaign('T');
  for (const spec of MISSIONS) {
    const ms = createMissionState(spec, missionContext(c, spec, `gen-${spec.id}`, 0));
    ok(ms.players.every(p => p.general === undefined && p.generalUnit === undefined) && !techAllowed(ms, 0, 'general') && !techAllowed(ms, 1, 'general'), `${spec.id}: no Generals in a mission`);
  }
  // A battle with Generals on replays byte-identically, and a save mid-battle plays on the same.
  const setup: Partial<SkirmishSetup> = { map: 'classic', tech: 'advanced', generals: true, factions: ['meridian', 'ashen'], generalPicks: ['hale', 'ilse'], credits: 10000 };
  const play = (n: number, saveAt = -1) => {
    let x = createInitialState('rp', 'rp', { seed: 'rp', createdAt: 0, autopilot: true, setup });
    for (let done = 0; done < n; done += 500) {
      if (done === saveAt) x = migrateState(copy(x))!;
      x = run(x, 500);
    }
    return x;
  };
  const a = play(9000);
  const b = play(9000);
  const c2 = play(9000, 4500);
  ok(JSON.stringify(a) === JSON.stringify(b), 'a battle with Generals on replays byte-identically');
  ok(JSON.stringify(a) === JSON.stringify(c2), 'and a save and load halfway changes nothing');
  ok(a.units.some(u => u.kind === 'general') || a.players.some(p => p.generalLostAt !== undefined), 'and Generals took the field in it');
}

/** The computer with Generals on: both sides recruit one, keep it out of the wave, and battles finish. */
function battles(ok: Ok): void {
  let recruited = 0;
  let inWave = 0;
  let finished = 0;
  let wins0 = 0;
  let minutes = 0;
  let falls = 0;
  let led = 0;
  const seeds = 6;
  for (let i = 0; i < seeds; i++) {
    const seed = `gen-battle-${i}`;
    let s = createInitialState(seed, seed, { seed, createdAt: 0, autopilot: true, setup: { map: i % 2 ? 'plains' : 'classic', tech: 'advanced', generals: true } });
    const had = [false, false];
    while (s.winner === null && s.tick < 30000) {
      s = run(s, 250);
      for (const o of [0, 1] as Owner[]) {
        const g = generalOf(s, o);
        if (g) {
          had[o] = true;
          if (s.ai[o].waveIds.includes(g.id)) inWave++;
          // Integration: the General leads its wave's squad (generalLeads).
          const q = s.squads?.find(x => x.id === g.squad);
          if (q && q.leader === g.id) led++;
        }
      }
    }
    falls += s.log.filter(l => l.text.startsWith('Your General has fallen') || l.text === 'An enemy General has fallen.').length;
    recruited += had.filter(Boolean).length;
    if (s.winner !== null) {
      finished++;
      minutes += s.tick / 600;
      if (s.winner === 0) wins0++;
    }
  }
  ok(recruited >= seeds * 2 - 1, `the computer recruits its General (${recruited} of ${seeds * 2} sides)`);
  ok(inWave === 0, 'and never hands it to the wave');
  ok(led >= seeds, `but its General leads the wave's squad in formation (${led} samples of 250 ticks)`);
  ok(finished >= seeds - 1, `battles with Generals on finish (${finished} of ${seeds})`);
  console.log(`generals battles: ${finished}/${seeds} finished, average ${(minutes / Math.max(1, finished)).toFixed(1)} game minutes; side 0 won ${wins0}; ${recruited} Generals fielded`);
}
// round6:C end.

// round6:integration begin. The General leads a formation (C and D), and Generals keep to their
// seat's army (A and C), from fireline-round6-design.md section 7.
import { generalLeads } from '../src/sim/aiGenerals';
import { isGeneralUnit, squadById } from '../src/sim/formations';
import { FACTIONS, GENERAL_SQUAD_HOLD } from '../src/sim/rules';

/**
 * A General, two buggies, two tanks and three riflemen in the middle of an advanced battle with
 * Generals on, the whole map turned to open grass so the march measures the formation, not the ground.
 */
function ledGroup(withGeneral: boolean): { s: GameState; ids: number[] } {
  const { s, cx, cy } = arena({}, 'general-leads');
  s.tiles = 'g'.repeat(s.tiles.length);
  s.ore = s.ore.map(() => 0);
  const kinds: UnitKind[] = ['buggy', 'buggy', 'tank', 'tank', 'rifleman', 'rifleman', 'rifleman', withGeneral ? 'general' : 'rifleman'];
  const ids = kinds.map((k, i) => addUnit(s, 0, k, cx - 1.5 + (i % 4) + 0.5, cy - 1 + Math.floor(i / 4) + 0.5).id);
  return { s, ids };
}

/**
 * Marches a squad until every member has arrived or `limit` ticks pass. Returns the worst distance
 * any member stood from its slot beside the leader once formed (after FORMED ticks) and while the
 * leader was more than SQUAD_FINAL from its goal, the mean of that worst distance tick by tick, and
 * the arrival spread.
 */
function march(s0: GameState, ids: number[], limit = 2400): { worst: number; mean: number; spread: number; arrived: number } {
  let s = s0;
  const goal = new Map(s.units.filter(u => ids.includes(u.id)).map(u => [u.id, u.order.type === 'move' || u.order.type === 'attackMove' ? [u.order.x, u.order.y] : [u.x, u.y]]));
  const at = new Map<number, number>();
  let worst = 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < limit && at.size < ids.length; i++) {
    s = processAction(s, { type: 'tick' });
    const us = s.units.filter(u => ids.includes(u.id));
    for (const u of us) {
      const g = goal.get(u.id)!;
      if (!at.has(u.id) && Math.hypot(u.x - g[0], u.y - g[1]) < 0.6) at.set(u.id, s.tick);
    }
    const q = s.squads?.[0];
    const lead = q && us.find(u => u.id === q.leader);
    if (!q || !lead || i < FORMED) continue;
    const [gx, gy] = goal.get(lead.id)!;
    if (Math.hypot(lead.x - gx, lead.y - gy) <= 4) continue;
    const bx = lead.x - (lead.slotX ?? 0);
    const by = lead.y - (lead.slotY ?? 0);
    let w = 0;
    for (const m of us) if (m !== lead && m.slotX !== undefined) w = Math.max(w, Math.hypot(bx + m.slotX - m.x, by + m.slotY! - m.y));
    worst = Math.max(worst, w);
    sum += w;
    n++;
  }
  const v = [...at.values()];
  return { worst, mean: n ? sum / n : 0, spread: v.length ? Math.max(...v) - Math.min(...v) : Infinity, arrived: at.size };
}

/** Ticks a squad is given to form up before its shape is measured. */
const FORMED = 100;

function generalLeadsSquad(ok: Ok): void {
  const { s, ids } = ledGroup(true);
  const general = s.units.find(u => u.kind === 'general')!;
  const tx = s.units.find(u => u.id === ids[0])!.x - 20;
  const ty = s.units.find(u => u.id === ids[0])!.y;
  for (const shape of ['line', 'column', 'wedge', 'box'] as const) {
    const t = processAction(s, { type: 'move', ids, x: tx, y: ty, formation: shape });
    const q = t.squads?.[0];
    ok(q && q.leader === general.id && q.members.length === ids.length, `${shape}: a squad with the General in it is led by the General`);
    const g = t.units.find(u => u.id === general.id)!;
    const ahead = t.units.filter(u => u.kind === 'tank').every(u => (u.slotX ?? 0) < (g.slotX ?? 0));
    if (shape !== 'line' && shape !== 'box') ok(ahead, `${shape}: the General leads from behind the armour (its slot by role, not the front)`);
  }
  const plain = ledGroup(false);
  const p = processAction(plain.s, { type: 'move', ids: plain.ids, x: tx, y: ty, formation: 'wedge' });
  ok(p.squads?.[0].leader === p.squads?.[0].members[0] && !isGeneralUnit(p.units.find(u => u.id === p.squads![0].leader)!), 'without a General, the front slot leads as before');
  // Tighter: the same squad marched eight ways with the General leading, and with the lead handed to
  // its front slot (as a squad without a General is led).
  let ledMean = 0;
  let unledMean = 0;
  let ledWorst = 0;
  let tighter = 0;
  let spread = 0;
  for (let d = 0; d < 8; d++) {
    const ax = [0, 1, 1, 1, 0, -1, -1, -1][d];
    const ay = [-1, -1, 0, 1, 1, 1, 0, -1][d];
    const start = s.units.find(u => u.id === ids[0])!;
    const lm = processAction(s, { type: 'move', ids, x: start.x + ax * 12, y: start.y + ay * 12, formation: 'wedge' });
    const um = copy(lm);
    um.squads![0].leader = um.squads![0].members[0];
    const a = march(lm, ids);
    const b = march(um, ids);
    ok(a.arrived === ids.length && b.arrived === ids.length, `toward ${d}: both marches arrive (${a.arrived} and ${b.arrived} of ${ids.length})`);
    ledMean += a.mean / 8;
    unledMean += b.mean / 8;
    ledWorst = Math.max(ledWorst, a.worst);
    spread = Math.max(spread, a.spread);
    if (a.mean <= b.mean) tighter++;
  }
  ok(ledMean < unledMean * 0.9, `led by its General, a squad keeps tighter once formed (mean worst distance from a slot ${ledMean.toFixed(2)} against ${unledMean.toFixed(2)} tiles)`);
  ok(tighter >= 5, `in most directions (${tighter} of 8)`);
  ok(ledWorst <= GENERAL_SQUAD_HOLD + 1, `and nobody straggles (worst ${ledWorst.toFixed(2)} tiles from a slot)`);
  ok(spread <= 50, `the General's squad arrives within 50 ticks of itself (${spread} at most)`);
  const led = processAction(s, { type: 'move', ids, x: tx, y: ty, formation: 'wedge' });
  // Pace: the General is the slowest, and the squad keeps to it.
  ok(led.squads![0].pace === UNITS.general.speed, `the squad's pace is its slowest member's, the General's (${led.squads![0].pace})`);
  // Pulled out: the squad goes on under its front slot, and the General is its own again.
  const out = processAction(run(copy(led), 40), { type: 'move', ids: [general.id], x: tx + 10, y: ty });
  const q2 = out.squads?.[0];
  ok(q2 && q2.leader !== general.id && !q2.members.includes(general.id) && out.units.find(u => u.id === general.id)!.squad === undefined, 'a General ordered elsewhere leaves, and the squad goes on under another');
  // Replay and save mid-march.
  const mid = run(copy(led), 120);
  const whole = run(copy(mid), 200);
  const loaded = run(migrateState(JSON.parse(JSON.stringify(mid)))!, 200);
  ok(JSON.stringify(whole) === JSON.stringify(loaded), "a General's squad saved and loaded mid-march plays on byte-identically");
  // The computer: generalLeads offers the General only with Generals on, near the wave, not pulling back.
  const wave = ids.filter(id => id !== general.id);
  const mine = copy(s);
  for (const u of mine.units) if (ids.includes(u.id)) u.owner = 1;
  ok(JSON.stringify(generalLeads(mine, 1, wave)) === JSON.stringify([general.id]), 'the computer offers its General to lead a wave beside it');
  mine.ai[1].generalBack = true;
  ok(generalLeads(mine, 1, wave).length === 0, 'but not while it is pulling back');
  delete mine.ai[1].generalBack;
  mine.setup = { ...mine.setup!, generals: false };
  ok(generalLeads(mine, 1, wave).length === 0, 'and never with Generals off');
  ok(s.squads === undefined && s.units.every(u => u.squad === undefined), 'the state the moves started from is untouched');
  ok(squadById(led, led.units.find(u => u.id === general.id)!.squad)?.leader === general.id, "the General's own squad names it as leader");
}

function generalsAndArmies(ok: Ok): void {
  ok(
    FACTIONS.every(f => GENERAL_IDS.filter(g => GENERAL_FACTION[g] === f).length === 2) && GENERAL_IDS.every(g => FACTIONS.includes(GENERAL_FACTION[g])),
    "GENERAL_FACTION names A's armies: two Generals to each, none to anything else",
  );
  const pairs: [Faction, Faction][] = [];
  for (const a of FACTIONS) for (const b of FACTIONS) pairs.push([a, b]);
  let checked = 0;
  for (const factions of pairs) {
    const tag = factions.join(' against ');
    // A seat's own choice: only its army's two.
    for (const seat of [0, 1]) {
      for (const g of GENERAL_IDS) {
        const picks: (GeneralId | null)[] = [null, null];
        picks[seat] = g;
        const n = normaliseSetup({ tech: 'advanced', factions, generalPicks: picks });
        const mineOk = GENERAL_FACTION[g] === factions[seat];
        ok(n.generalPicks![seat] === (mineOk ? g : null), `${tag}: seat ${seat} choosing ${g} ${mineOk ? 'keeps it' : 'reads as none'}`);
      }
    }
    // The computer's seeded pick, with Generals on and its seat left on Any: its own army's, both seats.
    for (let i = 0; i < 8; i++) {
      const s = createInitialState(`ga-${tag}-${i}`, 'g', { seed: `ga-${tag}-${i}`, createdAt: 0, setup: { tech: 'advanced', factions, generals: true } });
      const g = s.players[1].general;
      ok(!!g && GENERAL_FACTION[g] === factions[1], `${tag}, seed ${i}: the computer's General (${g}) is from its own army`);
      const forced = createInitialState(`gb-${tag}-${i}`, 'g', { seed: `gb-${tag}-${i}`, createdAt: 0, setup: { tech: 'advanced', factions, generals: true, generalPicks: [factions[0] === 'ashen' ? 'kade' : 'hale', null] } });
      ok(GENERAL_FACTION[forced.players[0].general!] === factions[0] && GENERAL_FACTION[forced.players[1].general!] === factions[1], `${tag}, seed ${i}: each seat's doctrine matches its army`);
      checked++;
    }
  }
  // Ilse's air discount reaches Ashen's own aircraft, found by airRole (section 7).
  const s = createInitialState('ilse-air', 'i', { seed: 'ilse-air', createdAt: 0, setup: { tech: 'advanced', factions: ['ashen', 'ashen'], generalPicks: ['ilse', null] } });
  for (const k of ['kestrel', 'firebrand'] as UnitKind[]) {
    ok(costFor(s, 0, k) < costFor(s, 1, k), `Ilse: the ${UNITS[k].name} is cheaper on her side (${costFor(s, 0, k)} against ${costFor(s, 1, k)})`);
  }
  ok(checked === pairs.length * 8, 'every pairing of armies checked from both seats');
}

/**
 * Found at integration (a 100-minute battle with every option on): raiseFunds cancelled the queued
 * General to pay for a hauler, generalPlan queued it again at once, and the infantry queue never
 * moved. With no refinery, or no hauler standing or queued, the computer recruits no General.
 */
function brokeNoGeneral(ok: Ok): void {
  const { s } = arena({}, 'broke');
  const home = { x: 5, y: s.mapH - 5 };
  const enemyHome = { x: s.mapW - 5, y: 5 };
  const st = s.starts![1];
  const dx = st.x < s.mapW / 2 ? 1 : -1;
  for (const [i, k] of (['barracks', 'uplink', 'refinery'] as BuildingKind[]).entries()) addBuilding(s, 1, k, Math.round(st.x + dx * (5 + 4 * i)), Math.round(st.y + 5), -100);
  s.ai[1].wave = 1;
  const queued = (t: GameState) => t.players[1].queues.infantry.some(q => q.kind === 'general');
  const plan = (t: GameState) => {
    for (let i = 0; i < 6; i++) generalPlan(t, 1, home, enemyHome, t.units.filter(u => u.owner === 1));
    return t;
  };
  const rich = (t: GameState) => {
    t.players[1].credits = 5000;
    return t;
  };
  const noHauler = plan(rich(copy(s)));
  ok(!queued(noHauler) && !noHauler.ai[1].generalFund, 'no hauler: no General queued, nothing put by');
  const withHauler = copy(s);
  addUnit(withHauler, 1, 'hauler', st.x + 0.5, st.y + 6.5);
  ok(queued(plan(rich(copy(withHauler)))), 'with a refinery and a hauler: the General is queued');
  const noRefinery = copy(withHauler);
  noRefinery.buildings = noRefinery.buildings.filter(b => !(b.owner === 1 && b.kind === 'refinery'));
  ok(!queued(plan(rich(noRefinery))), 'no refinery: none');
}
// round6:integration end.
