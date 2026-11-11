/**
 * Heroes in free play (fireline-round6-design.md, workstream B). Its sections run inside
 * scripts/drive.ts and count in its totals. The groundwork's section states the rule B keeps: with
 * heroes off (every setup before round 6, and the default), no hero can be queued in a skirmish.
 * Workstream B adds its own sections after it and keeps it.
 */
import { canQueue } from '../src/sim/commands';
import { HERO_KINDS, UNITS } from '../src/sim/rules';
import { addBuilding, createInitialState } from '../src/sim/state';
// round6:B. Heroes in free play: its sections' imports.
import { processAction } from '../src/sim/actions';
import { missionContext, newCampaign } from '../src/campaign/progression';
import { MISSIONS } from '../src/campaign/missions';
import { createMissionState, heroUnit } from '../src/sim/mission';
import {
  BUILD_MENU,
  HERO_ACADEMY,
  HERO_RECRUIT_COST,
  HERO_RECRUIT_TICKS,
  HERO_REVIVE_TICKS,
  INFANTRY_MENU,
  VEHICLE_MENU,
  type HeroKind,
  type Owner,
} from '../src/sim/rules';
import { addUnit, buildTicksFor, costFor, maxHpOf, migrateState, techAllowed } from '../src/sim/state';
import { startOf } from '../src/sim/sides';
import type { GameAction, GameState } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

function heroesOff(ok: Ok): void {
  for (const setup of [{ tech: 'advanced' as const }, { tech: 'advanced' as const, heroes: false }, { tech: 'standard' as const, heroes: true }]) {
    const s = createInitialState('h', 'h', { seed: 'heroes-off', createdAt: 0, setup });
    ok(s.setup!.heroes === (setup.heroes ?? false), `setup ${JSON.stringify(setup)}: heroes recorded as ${setup.heroes ?? false}`);
    s.players[0].credits = 100000;
    for (const k of ['barracks', 'factory', 'techcentre'] as const) addBuilding(s, 0, k, 2 + 4 * ['barracks', 'factory', 'techcentre'].indexOf(k), 2);
    const off = !s.setup!.heroes || s.setup!.tech !== 'advanced';
    if (off) for (const h of HERO_KINDS) ok(!canQueue(s, 0, UNITS[h].category, h), `setup ${JSON.stringify(setup)}: ${h} cannot be queued`);
  }
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Round 6 groundwork: heroes stay out of a skirmish with heroes off', heroesOff],
  // round6:B begin. Heroes in free play: its sections, appended here.
  ['Heroes in free play: recruiting, limits and prices', recruiting],
  ['Heroes in free play: the revive timer and half price', revive],
  ['Heroes in free play: levels and abilities in a skirmish', abilities],
  ['Heroes in free play: saves, replays and missions', savesAndMissions],
  ['Heroes in free play: the computer recruits and uses heroes', computer],
  // round6:B end.
];

// round6:B begin. Heroes in free play (fireline-round6-design.md, workstream B).
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const cat = (k: HeroKind) => UNITS[k].category;
const q = (k: HeroKind): GameAction => ({ type: 'queue', category: cat(k), kind: k });

/** A skirmish with heroes on, side 0 holding a Barracks, War Factory and Tech Centre and plenty of credits. */
function heroBattle(seed: string, academy = true): GameState {
  const s = createInitialState('hf', 'hf', { seed, createdAt: 0, setup: { tech: 'advanced', heroes: true } });
  const st = startOf(s, 0);
  const dx = st.x < s.mapW / 2 ? 1 : -1;
  const kinds = ['barracks', 'factory', 'techcentre', ...(academy ? [HERO_ACADEMY] : [])] as const;
  kinds.forEach((k, i) => addBuilding(s, 0, k, Math.round(st.x + dx * (5 + 4 * i)), Math.round(st.y + 5), -100));
  s.players[0].credits = 100000;
  return s;
}

/** Ticks until no side-0 unit queue holds anything (or the limit). */
function drain(s: GameState, limit = 3000): GameState {
  let n = 0;
  while (n < limit && (s.players[0].queues.infantry.length || s.players[0].queues.vehicle.length)) {
    s = processAction(s, { type: 'tick', n: 10 });
    n += 10;
  }
  return s;
}

function recruiting(ok: Ok): void {
  for (const k of HERO_KINDS) ok((cat(k) === 'infantry' ? INFANTRY_MENU : VEHICLE_MENU).includes(k), `${k}: on its build list`);
  ok(BUILD_MENU.includes(HERO_ACADEMY), 'the Command Academy is on the Structures list');
  const pre = heroBattle('hf-pre', false);
  ok(techAllowed(pre, 0, HERO_ACADEMY), 'heroes on: the Academy may be built');
  for (const k of HERO_KINDS) ok(!techAllowed(pre, 0, k) && processAction(pre, q(k)) === pre, `${k}: refused until an Academy stands`);
  const off = createInitialState('hf', 'hf', { seed: 'hf-off', createdAt: 0, setup: { tech: 'advanced' } });
  ok(!techAllowed(off, 0, HERO_ACADEMY), 'heroes off: no Academy');
  const std = createInitialState('hf', 'hf', { seed: 'hf-std', createdAt: 0, setup: { tech: 'standard', heroes: true } });
  ok(!techAllowed(std, 0, HERO_ACADEMY) && HERO_KINDS.every(k => !techAllowed(std, 0, k)), 'standard tech with heroes on: no Academy, no heroes');

  let s = heroBattle('hf-acc');
  for (const k of HERO_KINDS) {
    ok(costFor(s, 0, k) === HERO_RECRUIT_COST[k] && buildTicksFor(s, 0, k) === HERO_RECRUIT_TICKS[k], `${k}: costs ${HERO_RECRUIT_COST[k]}, trains in ${HERO_RECRUIT_TICKS[k]} ticks`);
    const before = s.players[0].credits;
    const next = processAction(s, q(k));
    ok(next !== s && next.players[0].credits === before - HERO_RECRUIT_COST[k], `${k}: accepted with heroes on, and paid for`);
    ok(processAction(next, q(k)) === next, `${k}: a second one is refused while the first is queued`);
    s = next;
  }
  const cancelled = processAction(s, { type: 'cancel', category: 'vehicle', kind: 'ace' });
  ok(cancelled.players[0].credits === s.players[0].credits + HERO_RECRUIT_COST.ace, 'cancelling a hero refunds it in full');
  ok(processAction(cancelled, q('ace')) !== cancelled, 'and it may be queued again');
  s = drain(s);
  for (const k of HERO_KINDS) {
    const u = heroUnit(s, 0, k);
    ok(!!u && u.hero!.level === 1 && u.hero!.xp === 0 && u.hero!.abilityCd === 0, `${k}: trained, a level 1 hero with its ability ready`);
    ok(!!u && u.hp === maxHpOf(u), `${k}: at full health`);
    ok(processAction(s, q(k)) === s, `${k}: refused while one stands`);
  }
  // The computer is held to the same: one of each, its own.
  const e = heroBattle('hf-e');
  addBuilding(e, 1, 'barracks', 3, e.mapH - 8, -100);
  addBuilding(e, 1, 'techcentre', 7, e.mapH - 8, -100);
  addBuilding(e, 1, HERO_ACADEMY, 11, e.mapH - 8, -100);
  e.players[1].credits = 100000;
  ok(canQueue(e, 1, 'infantry', 'spy'), 'the computer may recruit too');
  e.players[1].queues.infantry.push({ kind: 'spy', progress: 0 });
  ok(!canQueue(e, 1, 'infantry', 'spy') && canQueue(e, 0, 'infantry', 'spy'), 'its limit is its own');
}

function revive(ok: Ok): void {
  let s = drain(processAction(heroBattle('hf-rv'), q('commando')));
  const u = heroUnit(s, 0, 'commando')!;
  ok(!!u, 'a Commando to lose');
  const c = copy(s);
  const h = c.units.find(v => v.id === u.id)!;
  h.hero!.xp = 130;
  h.hero!.level = 2;
  h.hp = 0;
  const t0 = c.tick;
  s = processAction(c, { type: 'tick', n: 1 });
  const f = s.players[0].heroFallen?.commando;
  ok(!!f && f.at === s.tick + HERO_REVIVE_TICKS && s.tick === t0 + 1 && f.xp === 130, `the fall is remembered: back at tick ${f?.at}, keeping 130 xp`);
  ok(processAction(s, q('commando')) === s, 'refused during the cooldown');
  ok(costFor(s, 0, 'commando') === HERO_RECRUIT_COST.commando / 2, 'its price is halved');
  while (s.tick < f!.at - 1) s = processAction(s, { type: 'tick', n: Math.min(50, f!.at - 1 - s.tick) });
  ok(processAction(s, q('commando')) === s, 'still refused a tick before the cooldown ends');
  s = processAction(s, { type: 'tick', n: 1 });
  const before = s.players[0].credits;
  const queued = processAction(s, q('commando'));
  ok(queued !== s && queued.players[0].credits === before - HERO_RECRUIT_COST.commando / 2, 'accepted once the cooldown ends, at half price');
  const back = processAction(queued, { type: 'cancel', category: 'infantry', kind: 'commando' });
  ok(back.players[0].credits === before, 'cancelling refunds the half price paid');
  s = drain(queued);
  const r = heroUnit(s, 0, 'commando');
  ok(!!r && r.hero!.xp === 130 && r.hero!.level === 2, 'the Commando comes back with its experience and level');
  ok(!!r && r.hp === Math.round(maxHpOf(r) / 2), `wounded: half health (${r?.hp}/${r && maxHpOf(r)})`);
  ok(s.players[0].heroFallen === undefined, 'the fall is forgotten once it stands again');
  ok(costFor(s, 0, 'commando') === HERO_RECRUIT_COST.commando, 'and the price is full again');
}

function abilities(ok: Ok): void {
  let s = drain(processAction(processAction(heroBattle('hf-ab'), q('ace')), q('commando')));
  const ace = heroUnit(s, 0, 'ace')!;
  const used = processAction(s, { type: 'ability', id: ace.id });
  ok(used !== s && heroUnit(used, 0, 'ace')!.hero!.active?.kind === 'overdrive', 'the Ace opens Overdrive in a skirmish');
  const later = processAction(used, { type: 'tick', n: 20 });
  const cd = heroUnit(later, 0, 'ace')!.hero!.abilityCd;
  ok(cd > 0 && cd < heroUnit(used, 0, 'ace')!.hero!.abilityCd, 'its cooldown runs down with the hero tick');
  // The Commando earns xp for kills and levels.
  const c = copy(s);
  const com = c.units.find(v => v.owner === 0 && v.kind === 'commando')!;
  com.hero!.xp = 95;
  for (let i = 0; i < 3; i++) addUnit(c, 1, 'rifleman', com.x + 2 + i * 0.6, com.y);
  s = c;
  for (let i = 0; i < 60 && heroUnit(s, 0, 'commando') && heroUnit(s, 0, 'commando')!.hero!.level < 2; i++) s = processAction(s, { type: 'tick', n: 10 });
  const after = heroUnit(s, 0, 'commando');
  ok(!!after && after.hero!.xp > 95 && after.hero!.level === 2, `the Commando levels from kills (xp ${after?.hero!.xp}, level ${after?.hero!.level})`);
}

function savesAndMissions(ok: Ok): void {
  // Byte-identical replay, and through a save, with the computer playing heroes.
  const start = createInitialState('hr', 'hr', { seed: 'hf-replay', createdAt: 0, autopilot: true, setup: { tech: 'advanced', heroes: true } });
  start.players.forEach(p => (p.credits = 20000));
  const run = (from: GameState, ticks: number) => {
    let x = from;
    for (let n = 0; n < ticks; n += 50) x = processAction(x, { type: 'tick', n: 50 });
    return x;
  };
  const a = run(start, 6000);
  const b = run(copy(start), 6000);
  ok(JSON.stringify(a) === JSON.stringify(b), 'a battle with heroes on replays byte-identically');
  ok(a.units.some(u => u.hero), 'and fields heroes by ten minutes with credits to spare');
  ok(JSON.stringify(migrateState(copy(a))) === JSON.stringify(a), 'a state with heroes passes migrateState unchanged');
  ok(JSON.stringify(run(a, 1200)) === JSON.stringify(run(migrateState(copy(a))!, 1200)), 'and plays on identically after a save and load');
  // Junk in the fallen record is repaired.
  const junk = copy(a) as unknown as { players: Record<string, unknown>[] };
  junk.players[0].heroFallen = { spy: { at: 5, xp: -3 }, wizard: { at: 1, xp: 1 }, ace: { at: 'x' } };
  junk.players[1].heroFallen = 'nonsense';
  const m = migrateState(junk)!;
  ok(JSON.stringify(m.players[0].heroFallen) === JSON.stringify({ spy: { at: 5, xp: 0 } }), 'a fallen record keeps known heroes with a whole-tick time');
  ok(m.players[1].heroFallen === undefined, 'and is dropped when nothing in it is sound');
  // Missions: nothing of this reaches them.
  const camp = newCampaign('T');
  for (const spec of MISSIONS) {
    const ms = createMissionState(spec, missionContext(camp, spec, `r6b-${spec.id}`, 0));
    ok(!techAllowed(ms, 0, HERO_ACADEMY) && HERO_KINDS.every(k => !techAllowed(ms, 0, k) && !canQueue(ms, 0, cat(k), k)), `${spec.id}: no Academy, no hero recruiting`);
    ok(ms.players.every(p => p.heroFallen === undefined), `${spec.id}: no fallen record`);
  }
}

function computer(ok: Ok): void {
  let s = createInitialState('hc', 'hc', { seed: 'a', difficulty: 'hard', createdAt: 0, autopilot: true, setup: { tech: 'advanced', heroes: true } });
  const kinds = new Set<string>();
  let used = 0;
  let twice = '';
  while (s.winner === null && s.tick < 36000) {
    const before = s;
    s = processAction(s, { type: 'tick', n: 10 });
    for (const o of [0, 1] as Owner[])
      for (const k of HERO_KINDS) {
        const n = s.units.filter(u => u.owner === o && u.kind === k && u.hp > 0).length + s.players[o].queues[cat(k)].filter(x => x.kind === k).length;
        if (n > 1 && !twice) twice = `side ${o} ${k} at ${s.tick}`;
      }
    for (const u of s.units) {
      if (!u.hero) continue;
      kinds.add(`${u.owner}:${u.kind}`);
      const was = before.units.find(v => v.id === u.id)?.hero;
      if ((was && u.hero.abilityCd > was.abilityCd) || (u.hero.active?.kind === 'capture' && was?.active?.kind !== 'capture')) used++;
    }
  }
  ok(s.winner !== null, `the battle with heroes on finishes (${(s.tick / 600).toFixed(1)} min)`);
  ok(kinds.size >= 3, `the computer recruits heroes (${[...kinds].join(', ')})`);
  ok(used >= 3, `and uses their abilities (${used} times)`);
  ok(!twice, `never more than one of each hero per side${twice ? `: ${twice}` : ''}`);
}
// round6:B end.
