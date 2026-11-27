/**
 * Army upkeep (2026-11-27, setup.upkeep; src/sim/upkeep.ts, fireline-design.md) and the patient
 * commander's limits (src/sim/aiStrength.ts holdWave, src/sim/aiScale.ts patience cap).
 * Its sections run inside scripts/drive.ts and count in its totals.
 */
import { createHash } from 'node:crypto';
import { processAction } from '../src/sim/actions';
import { setAutopilotAi } from '../src/sim/ai';
import { ATTACK_INTERVAL_CAP, FIRST_ATTACK_CAP, scaledFor } from '../src/sim/aiScale';
import { OUTMATCH_FLOOR, WAVE_NERVE, holdWave } from '../src/sim/aiStrength';
import { createMissionState } from '../src/sim/mission';
import { missionContext, newCampaign } from '../src/campaign/progression';
import { MISSIONS } from '../src/campaign/missions';
import { DEFAULT_SETUP, DIFFICULTIES, GAME_PACES, LEGACY_SETUP, UNITS, difficultyForPace, type Owner, type SkirmishSetup } from '../src/sim/rules';
import { addUnit, createInitialState, migrateState, normaliseSetup } from '../src/sim/state';
import { DESERT_SHARE, INFANTRY_UPKEEP, SHORT_RELOAD, VEHICLE_UPKEEP, UPKEEP_GRACE, UPKEEP_TICKS, shortOfUpkeep, upkeepAllows, upkeepDue, upkeepOn, upkeepStep } from '../src/sim/upkeep';
import type { GameState } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
const hash = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const ALL: Partial<SkirmishSetup> = { map: 'plains', tech: 'advanced', industry: true, supply: true, territory: true, production: true, upkeep: true, credits: 20000 };
const fresh = (setup: Partial<SkirmishSetup> = ALL, seed = 'upkeep'): GameState => createInitialState(seed, seed, { seed, createdAt: 0, setup });
const say = (s: GameState, text: string, tone: 'info' | 'good' | 'bad') => s.log.push({ tick: s.tick, text, tone });

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

/** A side's units cleared, then `n` riflemen and `m` tanks for side 0 beside its yard. */
function army(s: GameState, n: number, m: number): void {
  s.units = s.units.filter(u => u.owner !== 0 || u.kind === 'hauler');
  const hq = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
  for (let i = 0; i < n; i++) addUnit(s, 0, 'rifleman', hq.x + 4 + (i % 6) * 0.8, hq.y + 4 + Math.floor(i / 6) * 0.8);
  for (let i = 0; i < m; i++) addUnit(s, 0, 'tank', hq.x - 3 - (i % 4), hq.y + 4 + Math.floor(i / 4));
  if (!s.units.some(u => u.owner === 0 && u.kind === 'hauler')) addUnit(s, 0, 'hauler', hq.x + 1, hq.y + 5);
}

/** Steps the upkeep minute alone, `minutes` times, at the next minute boundaries. */
function minutes(s: GameState, minutes: number): void {
  for (let i = 0; i < minutes; i++) {
    s.tick = (Math.floor(s.tick / UPKEEP_TICKS) + 1) * UPKEEP_TICKS;
    upkeepStep(s, say);
    s.units = s.units.filter(u => u.hp > 0);
  }
}

function setup(ok: Ok): void {
  ok(DEFAULT_SETUP.upkeep === false && LEGACY_SETUP.upkeep === false, 'both presets state army upkeep: off');
  ok(normaliseSetup({}).upkeep === false, 'a setup saved before it reads as off');
  ok(normaliseSetup({ industry: true, supply: true, territory: true, production: true, upkeep: true }).upkeep === true, 'with advanced production, upkeep: true is kept');
  ok(normaliseSetup({ industry: true, supply: true, territory: true, upkeep: true }).upkeep === false, 'without advanced production it is off whatever the setup says');
  ok(!upkeepOn(fresh({ ...ALL, upkeep: false })), 'production alone: no upkeep');
  ok(upkeepOn(fresh()), 'on with every economy toggle and upkeep');
  const c = newCampaign('T');
  const ms = createMissionState(MISSIONS[0], missionContext(c, MISSIONS[0], 'upkeep', 0));
  ms.setup = { ...normaliseSetup({}), industry: true, supply: true, territory: true, production: true, upkeep: true };
  ok(!upkeepOn(ms), 'never in a mission, even with the flag forced on');
}

function paying(ok: Ok): void {
  const s = fresh();
  army(s, 10, 4);
  const due = upkeepDue(s, 0);
  ok(due.soldiers === 10 && due.machines === 4 && due.food === 10 * INFANTRY_UPKEEP && due.fuel === 4 * VEHICLE_UPKEEP, `10 riflemen and 4 tanks ask ${10 * INFANTRY_UPKEEP} food and ${4 * VEHICLE_UPKEEP} fuel a minute (${JSON.stringify(due)})`);
  ok(s.units.some(u => u.owner === 0 && u.kind === 'hauler'), 'an unarmed hauler is in the field and is not counted');
  s.players[0].food = 10 * INFANTRY_UPKEEP + 5;
  s.players[0].fuel = 4 * VEHICLE_UPKEEP + 5;
  s.tick = UPKEEP_TICKS - 1;
  const before = copy(s);
  upkeepStep(s, say);
  ok(s.players[0].food === 10 * INFANTRY_UPKEEP + 5 && s.players[0].fuel === 4 * VEHICLE_UPKEEP + 5, 'nothing is paid off the minute');
  ok(JSON.stringify(before) === JSON.stringify(s), 'off the minute the state is untouched');
  minutes(s, 1);
  ok(s.players[0].food === 5 && s.players[0].fuel === 5, `on the minute each side pays (food ${s.players[0].food}, fuel ${s.players[0].fuel})`);
  ok(!s.players[0].upkeepShort, 'paid in full: not short');
  const off = fresh({ ...ALL, upkeep: false });
  army(off, 10, 4);
  off.players[0].food = 25;
  minutes(off, 3);
  ok(off.players[0].food === 25 && off.units.filter(u => u.owner === 0 && u.kind === 'rifleman').length === 10, 'without upkeep, nothing is eaten and nobody leaves');
}

function shortage(ok: Ok): void {
  const s = fresh();
  army(s, 20, 0);
  s.players[0].food = 8;
  minutes(s, 1);
  s.players[0].food = 0;
  ok(s.players[0].upkeepShort?.food === 1, 'short: what is held is paid, and the side is a minute short');
  ok(s.log.some(e => /unfed/.test(e.text)), 'the player is told when the shortage starts');
  const rifle = s.units.find(u => u.owner === 0 && u.kind === 'rifleman')!;
  ok(shortOfUpkeep(s, rifle), 'an unfed soldier is short');
  ok(!upkeepAllows(s, 0, 'rifleman') && upkeepAllows(s, 0, 'tank'), 'the computer trains no soldier while short of food, but may train a machine');
  minutes(s, UPKEEP_GRACE - 1);
  ok(s.units.filter(u => u.owner === 0 && u.kind === 'rifleman').length === 20, `nobody deserts within the grace (${UPKEEP_GRACE} short minutes)`);
  const newest = Math.max(...s.units.filter(u => u.owner === 0 && u.kind === 'rifleman').map(u => u.id));
  minutes(s, 1);
  const left = s.units.filter(u => u.owner === 0 && u.kind === 'rifleman');
  const want = Math.ceil(20 * DESERT_SHARE);
  ok(left.length === 20 - want, `past the grace, ${want} of 20 unfed soldiers desert (${20 - left.length})`);
  ok(!left.some(u => u.id === newest), 'the newest recruit is the first to go');
  ok(s.log.some(e => /deserted/.test(e.text)), 'the player is told');
  s.players[0].food = 1000;
  minutes(s, 1);
  ok(!s.players[0].upkeepShort && s.log.some(e => /fed again/.test(e.text)), 'paid in full again: the shortage ends and the player hears it');
  ok(!shortOfUpkeep(s, left[0]), 'fed again: no longer short');
  // Fuel, likewise.
  const f = fresh();
  army(f, 0, 8);
  f.players[0].fuel = 0;
  minutes(f, UPKEEP_GRACE + 1);
  ok(f.units.filter(u => u.owner === 0 && u.kind === 'tank').length === 8 - Math.ceil(8 * DESERT_SHARE), 'unfuelled tanks are abandoned past the grace');
  ok(f.log.some(e => /abandoned/.test(e.text)), 'and the player is told');
  // An abandoned machine leaves no explosion: the dead are removed by the tick without a boom.
  const g = fresh();
  army(g, 0, 4);
  g.players[0].fuel = 0;
  for (const o of [0, 1] as Owner[]) g.players[o].credits = 0;
  g.tick = UPKEEP_TICKS * (UPKEEP_GRACE + 1) - 1;
  g.players[0].upkeepShort = { food: 0, fuel: UPKEEP_GRACE };
  const lastTank = Math.max(...g.units.filter(u => u.owner === 0 && u.kind === 'tank').map(u => u.id));
  const where = g.units.find(u => u.id === lastTank)!;
  const after = processAction(g, { type: 'tick' });
  ok(after.units.filter(u => u.owner === 0 && u.kind === 'tank').length === 3 && !after.units.some(u => u.id === lastTank), 'through the tick, the newest of four unfuelled tanks is abandoned');
  ok(!after.effects.some(e => e.kind === 'boom' && Math.abs(e.x - where.x) < 0.5 && Math.abs(e.y - where.y) < 0.5), 'the abandoned tank does not explode');
}

function reload(ok: Ok): void {
  // Two identical duels, one with the attacker's side unfed: the unfed one fires fewer shots.
  const duel = (short: boolean): number => {
    const s = fresh(ALL, 'upkeep-duel');
    s.units = [];
    const hq = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
    const a = addUnit(s, 0, 'rifleman', hq.x + 6, hq.y + 6);
    const t = addUnit(s, 0, 'tank', hq.x + 8, hq.y + 6);
    t.owner = 1 as Owner;
    t.hp = 100000;
    a.engage = t.id;
    if (short) s.players[0].upkeepShort = { food: 1, fuel: 0 };
    s.players[0].food = 0;
    let shots = 0;
    let st = s;
    for (let i = 0; i < 300; i++) {
      // The target never answers, so the duel is the shooter's reload alone.
      for (const u of st.units) if (u.id === t.id) {
        u.cooldown = 999;
        u.engage = 0;
        u.hp = 100000;
      }
      const shooter = st.units.find(u => u.id === a.id);
      if (!shooter) break;
      const cd = shooter.cooldown;
      st = processAction(st, { type: 'tick' });
      const now = st.units.find(u => u.id === a.id);
      if (now && now.cooldown > cd) shots++;
      // Keep the upkeep minute away from the test.
      if (st.tick % UPKEEP_TICKS === UPKEEP_TICKS - 1) st.tick++;
    }
    return shots;
  };
  const fed = duel(false);
  const unfed = duel(true);
  ok(fed > 0 && unfed > 0 && unfed < fed, `an unfed soldier fires fewer shots in 30 seconds (${unfed} against ${fed}; reload x${SHORT_RELOAD})`);
}

function patience(ok: Ok): void {
  // The cap on the combined slowdown.
  for (const pace of ['standard', 'long', 'epic'] as const) {
    const s = createInitialState('p', 'p', { seed: 'p', createdAt: 0, setup: { map: 'plains', tech: 'advanced', pace, size: GAME_PACES[pace].preset.size } });
    const base = DIFFICULTIES.normal;
    const mul = GAME_PACES[pace].attackMul;
    const d = scaledFor(s, difficultyForPace('normal', pace));
    ok(d.firstAttack <= Math.round(base.firstAttack * Math.max(mul, FIRST_ATTACK_CAP)), `${pace}: Normal's first attack at most ${Math.max(mul, FIRST_ATTACK_CAP)} times its own (${(d.firstAttack / 600).toFixed(1)} min)`);
    ok(d.attackInterval <= Math.round(base.attackInterval * ATTACK_INTERVAL_CAP), `${pace}: waves at most ${ATTACK_INTERVAL_CAP} times as far apart (${(d.attackInterval / 600).toFixed(1)} min)`);
    ok(s.ai[1].nextAttack === d.firstAttack, `${pace}: the battle opens with the capped first attack`);
  }
  const quick = createInitialState('q', 'q', { seed: 'q', createdAt: 0, setup: { map: 'plains', tech: 'advanced', pace: 'quick' } });
  ok(scaledFor(quick, DIFFICULTIES.hard) === DIFFICULTIES.hard, 'Quick on a standard map: the difficulty itself, unchanged');
  const c = newCampaign('T');
  const ms = createMissionState(MISSIONS[0], missionContext(c, MISSIONS[0], 'patience', 0));
  ok(scaledFor(ms, DIFFICULTIES.normal) === DIFFICULTIES.normal, 'a mission: unchanged');
  // The wave hold: against the side aimed at, and for a limited time.
  const s = fresh({ map: 'plains', tech: 'advanced', sides: 3, mode: 'ffa' } as Partial<SkirmishSetup>, 'hold');
  s.units = s.units.filter(u => u.kind === 'hauler');
  const at = (o: Owner, kind: 'rifleman' | 'tank', n: number) => {
    const hq = s.buildings.find(b => b.owner === o && b.kind === 'hq')!;
    for (let i = 0; i < n; i++) addUnit(s, o, kind, hq.x + 4 + (i % 5), hq.y + 4 + Math.floor(i / 5));
  };
  at(1, 'tank', 10);
  at(0, 'tank', 8);
  at(2, 'tank', 8);
  ok(holdWave(s, 1, null, 0, 1000), 'weighed against every enemy (16 tanks to 10), the wave would wait');
  ok(!holdWave(s, 1, 0, 0, 1000), 'weighed against the side it is aimed at (8 tanks to 10), it goes');
  at(0, 'tank', 8);
  ok(holdWave(s, 1, 0, 0, 1000), 'outmatched by the side aimed at (16 to 10), it waits while within its patience');
  ok(10 >= 16 * WAVE_NERVE && !holdWave(s, 1, 0, 2000, 1000), `past its patience it goes if worth ${WAVE_NERVE} of the enemy (10 against 16)`);
  at(0, 'tank', 10);
  ok(holdWave(s, 1, 0, 2000, 1000), 'and still waits against a far stronger enemy (10 against 26)');
  const small = fresh({ map: 'plains', tech: 'advanced' }, 'floor');
  small.units = small.units.filter(u => u.kind === 'hauler');
  ok(!holdWave(small, 1, 0, 0, 1000) && OUTMATCH_FLOOR > 0, 'below the floor nothing is outmatched');
  void UNITS;
}

function battles(ok: Ok): void {
  // Whole computer battles with upkeep on: they run, the armies are paid for, and they replay.
  const UPK: Partial<SkirmishSetup> = { map: 'random', tech: 'advanced', credits: 5000, ore: 'rich', research: 'lines', pace: 'long', industry: true, supply: true, territory: true, production: true, upkeep: true };
  const play = (seed: string, ticks: number, saveAt = -1, watch?: (s: GameState) => void): GameState => {
    let s = createInitialState(seed, seed, { seed, difficulty: 'normal', createdAt: 0, autopilot: true, setup: UPK });
    s.autopilotDifficulty = 'normal';
    while (s.winner === null && s.tick < ticks) {
      s = processAction(s, { type: 'tick', n: 50 });
      if (s.tick === saveAt) s = migrateState(JSON.parse(JSON.stringify(s)))!;
      watch?.(s);
    }
    return s;
  };
  for (const seed of ['upk-a', 'upk-b']) {
    let fedMax = 0;
    let fuelled = 0;
    let negative = false;
    const s = play(seed, 600 * 30, -1, st => {
      if (st.tick % UPKEEP_TICKS === 0) {
        fedMax = Math.max(fedMax, upkeepDue(st, 1).soldiers);
        fuelled = Math.max(fuelled, upkeepDue(st, 1).machines);
      }
      if (st.players.some(p => (p.food ?? 0) < 0 || (p.fuel ?? 0) < 0)) negative = true;
    });
    ok(!negative, `${seed}: no store goes below nought`);
    ok(fedMax > 0 && fuelled > 0, `${seed}: the computer keeps soldiers (${fedMax}) and machines (${fuelled}) in the field`);
    const farms = s.buildings.filter(b => b.owner === 1 && b.kind === 'farm').length;
    ok(farms >= 1, `${seed}: the computer builds Farms for its army (${farms})`);
  }
  const a = play('upk-r', 600 * 16);
  ok(hash(a) === hash(play('upk-r', 600 * 16)) && hash(a) === hash(play('upk-r', 600 * 16, 600 * 8)), 'a battle with upkeep replays byte-identically, and through a save mid-battle');
  const short = copy(a);
  short.players[0].upkeepShort = { food: 2, fuel: 0 };
  ok(migrateState(JSON.parse(JSON.stringify(short)))!.players[0].upkeepShort?.food === 2, 'a shortage survives a save');
  const junk = copy(a) as unknown as { players: Record<string, unknown>[] };
  junk.players[0].upkeepShort = { food: 'lots', fuel: -3 };
  ok(!('upkeepShort' in migrateState(junk)!.players[0]), 'a junk shortage loads as none');
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Upkeep: the setup', setup],
  ['Upkeep: paying on the minute', quiet(paying)],
  ['Upkeep: shortage, desertion and recovery', quiet(shortage)],
  ['Upkeep: an unfed soldier fires slower', quiet(reload)],
  ['Upkeep: the commander attacks (patience cap and wave hold)', patience],
  ['Upkeep: whole computer battles', battles],
];
