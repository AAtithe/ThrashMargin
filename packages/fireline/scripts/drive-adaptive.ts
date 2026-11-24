/**
 * Round 7: the adaptive commander (src/sim/aiAdapt.ts, fireline-round7-adaptive.md). Its sections
 * run inside scripts/drive.ts and count in its totals.
 *
 * - The setup field: stated in both presets, absent reads false on a save, junk falls back.
 * - Off is off: with the toggle off (or on Easy, or in a mission) nothing in the state differs from a
 *   battle where the hooks are forced off, the memory is never written, and every hook returns its input.
 * - Sight: the memory holds only what the side's team could see (units out of sight, and a Stealth
 *   Tank it has not detected, are ignored), fades with age and forgets.
 * - The mix: bounded (no kind beyond its cap, no weight beyond its factors, never one kind), and moving
 *   toward the counter in scripted battles where side 0 builds only one category.
 * - Plans: a flank after two breaks in one place, a raid after the flank breaks (Hard only), a siege
 *   against a turtle, expansions hunted (Hard only).
 * - Replay exactness, saves mid-battle, junk memory, whole battles, and the log line to side 0.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { processAction } from '../src/sim/actions';
import { setAutopilotAi, type AiFn } from '../src/sim/ai';
import {
  ADAPT_CLASSES,
  ADAPT_FORGET,
  ADAPT_HALF_LIFE,
  ADAPT_MAX_FACTOR,
  ADAPT_MAX_SHARE,
  ADAPT_MIN_FACTOR,
  ADAPT_SAMPLE,
  ADAPT_TUNING,
  TURTLE_DEFENCES,
  adaptMix,
  adaptObserve,
  adaptStage,
  adaptTarget,
  adaptWaveSize,
  adaptiveOn,
  classScores,
  mixFor,
  observe,
  setAdaptiveOverride,
  summarise,
} from '../src/sim/aiAdapt';
import { canQueue, doMove, doQueue } from '../src/sim/commands';
import { occupancy, passable } from '../src/sim/grid';
import { createMissionState } from '../src/sim/mission';
import { missionContext, newCampaign } from '../src/campaign/progression';
import { MISSIONS } from '../src/campaign/missions';
import { next } from '../src/sim/rng';
import { DEFAULT_SETUP, LEGACY_SETUP, type BuildingKind, type Difficulty, type Owner, type SkirmishSetup, type UnitKind } from '../src/sim/rules';
import { addBuilding, addUnit, createInitialState, migrateState, normaliseSetup, teamVisibility } from '../src/sim/state';
import { startOf } from '../src/sim/sides';
import type { AdaptMemory, GameState } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

function newBattle(seed: string, difficulty: Difficulty, setup: Partial<SkirmishSetup>): GameState {
  return createInitialState(seed, seed, { seed, difficulty, createdAt: 0, autopilot: true, setup });
}

function run(s: GameState, ticks: number): GameState {
  const end = s.tick + ticks;
  while (s.winner === null && s.tick < end) s = processAction(s, { type: 'tick', n: 50 });
  return s;
}

/** The same battle, with the hooks' memory and the setup's toggle stripped: for comparing two runs. */
const bare = (s: GameState): string => {
  const j = copy(s);
  if (j.setup) delete j.setup.adaptive;
  return JSON.stringify(j);
};

function withOverrides<T>(o0: boolean | null, o1: boolean | null, fn: () => T): T {
  setAdaptiveOverride(0, o0);
  setAdaptiveOverride(1, o1);
  try {
    return fn();
  } finally {
    setAdaptiveOverride(0, null);
    setAdaptiveOverride(1, null);
  }
}

// ---- The setup field --------------------------------------------------------------------------

function setupField(ok: Ok): void {
  ok(DEFAULT_SETUP.adaptive === true, 'DEFAULT_SETUP turns the adaptive commander on');
  ok(LEGACY_SETUP.adaptive === false, 'LEGACY_SETUP states it off');
  ok(normaliseSetup({}).adaptive === true, 'a new skirmish without the field: on (the default)');
  ok(normaliseSetup({ map: 'river' }, LEGACY_SETUP).adaptive === false, 'a saved setup without the field reads off');
  ok(normaliseSetup({ adaptive: false }).adaptive === false && normaliseSetup({ adaptive: true }, LEGACY_SETUP).adaptive === true, 'exactly true or false is kept');
  for (const junk of ['yes', 1, null, {}, 'true']) {
    ok(normaliseSetup({ adaptive: junk as never }, LEGACY_SETUP).adaptive === false, `adaptive ${JSON.stringify(junk)} falls back to the base's (off)`);
    ok(normaliseSetup({ adaptive: junk as never }).adaptive === true, `adaptive ${JSON.stringify(junk)} falls back to the base's (on)`);
  }
  const keys = Object.keys(normaliseSetup({}));
  ok(keys[keys.length - 1] === 'adaptive', 'adaptive is the last field of a normalised setup');
  // A save from before round 7: its setup has no field, and it loads off.
  const s = newBattle('adapt-old-save', 'hard', { map: 'random' });
  const raw = copy(s);
  delete raw.setup!.adaptive;
  const m = migrateState(raw)!;
  ok(m.setup!.adaptive === false && !adaptiveOn(m, 1), 'a save from before round 7 loads with the commander not adapting');
  // War for the Planet states it in its own setup (src/planet/battle.ts states every field): on in a
  // war on battle rules 3, off in an older war. drive-planet-links.ts checks both on real battles.
  const planetSrc = readFileSync(fileURLToPath(new URL('../src/planet/battle.ts', import.meta.url)), 'utf8');
  ok(/adaptive: rules3,/.test(planetSrc), 'buildPlanetBattle states adaptive from the war\'s battle rules');
  // Missions: no setup, never adaptive, the campaign untouched.
  const c = newCampaign();
  for (const spec of MISSIONS.slice(0, 3)) {
    const ms = createMissionState(spec, missionContext(c, spec, `adapt-${spec.id}`, 0));
    ok(!adaptiveOn(ms, 1), `mission ${spec.id}: the commander does not adapt`);
  }
  // Easy keeps its simple play.
  ok(!adaptiveOn(newBattle('adapt-easy', 'easy', { map: 'random' }), 1), 'Easy does not adapt, setup or not');
  ok(adaptiveOn(newBattle('adapt-normal', 'normal', { map: 'random' }), 1) && adaptiveOn(newBattle('adapt-hard', 'hard', { map: 'random' }), 1), 'Normal and Hard adapt with the setup on');
}

// ---- Off is off ----------------------------------------------------------------------------------

function offIsOff(ok: Ok): void {
  for (const [diff, setup] of [
    ['hard', { map: 'random', adaptive: false }],
    ['normal', { map: 'river', tech: 'standard', adaptive: false }],
    ['hard', { map: 'random', pace: 'long', adaptive: false }],
  ] as [Difficulty, Partial<SkirmishSetup>][]) {
    const seed = `adapt-off-${diff}-${setup.map}-${setup.tech ?? 'adv'}`;
    const a = run(newBattle(seed, diff, setup), 6000);
    ok(a.ai.every(m => m.adapt === undefined), `${seed}: toggle off, the memory is never written`);
    ok(!Object.keys(a.alarms).some(k => k.startsWith('adapt')), `${seed}: toggle off, no line in the log`);
    // The same battle with the toggle on but every side forced off: identical, so the toggle gates every hook.
    const b = withOverrides(false, false, () => run(newBattle(seed, diff, { ...setup, adaptive: true }), 6000));
    ok(bare(a) === bare(b), `${seed}: toggle off plays exactly as the hooks forced off`);
  }
  // Easy with the toggle on: as off.
  const e1 = run(newBattle('adapt-off-easy', 'easy', { map: 'random', adaptive: true }), 6000);
  const e2 = run(newBattle('adapt-off-easy', 'easy', { map: 'random', adaptive: false }), 6000);
  ok(bare(e1) === bare(e2) && e1.ai.every(m => m.adapt === undefined), 'Easy with the toggle on plays exactly as with it off');
  // Every hook hands back its input when off.
  const s = newBattle('adapt-off-hooks', 'hard', { map: 'random', adaptive: false });
  const list: [UnitKind, number][] = [['tank', 5], ['buggy', 1]];
  const stage = { x: 10.5, y: 10.5 };
  const target = { x: 30, y: 30 };
  ok(adaptMix(s, 1, list, 'vehicle') === list, 'off: adaptMix returns the very list');
  ok(adaptStage(s, 1, stage, stage, target) === stage, 'off: adaptStage returns the staging point');
  ok(adaptTarget(s, 1, target, stage) === target, 'off: adaptTarget returns the ordinary target');
  ok(adaptWaveSize(s, 1, 9, 22) === 9, 'off: adaptWaveSize returns the ordinary size');
  adaptObserve(s, 1);
  ok(s.ai[1].adapt === undefined, 'off: adaptObserve writes nothing');
}

// ---- Sight, decay, forgetting --------------------------------------------------------------------

/** A quiet arena: side 1 adapts (Hard), nobody commands, both yards standing. */
function arena(seed: string, difficulty: Difficulty = 'hard'): GameState {
  const s = newBattle(seed, difficulty, { map: 'plains', tech: 'advanced', adaptive: true });
  s.units = [];
  return s;
}

/** A tile no unit or structure of `owner`'s team can see, near (x, y), or null. */
function unseenNear(s: GameState, owner: Owner, x: number, y: number): { x: number; y: number } | null {
  const vis = teamVisibility(s, owner);
  const occ = occupancy(s);
  for (let r = 0; r < 20; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const tx = Math.floor(x) + dx;
        const ty = Math.floor(y) + dy;
        if (!passable(s, occ, tx, ty) || vis[ty * s.mapW + tx]) continue;
        return { x: tx + 0.5, y: ty + 0.5 };
      }
  return null;
}

function sight(ok: Ok): void {
  const s = arena('adapt-sight');
  const home1 = startOf(s, 1);
  const home0 = startOf(s, 0);
  // Side 1 keeps a scout near the middle; side 0's tanks sit out of all side 1's sight, its riflemen in it.
  const scout = addUnit(s, 1, 'buggy', (home0.x + home1.x) / 2, (home0.y + home1.y) / 2);
  const hidden = unseenNear(s, 1, home0.x + 1, home0.y - 3)!;
  ok(!!hidden, 'there is ground side 1 cannot see');
  const tanks = [0, 1, 2].map(i => addUnit(s, 0, 'tank', hidden.x + i * 0.3, hidden.y));
  ok(tanks.every(t => !teamVisibility(s, 1)[Math.floor(t.y) * s.mapW + Math.floor(t.x)]), 'the tanks are out of side 1 sight');
  const riflemen = [0, 1, 2, 3].map(i => addUnit(s, 0, 'rifleman', scout.x + 1 + i * 0.4, scout.y + 1));
  // A Stealth Tank right beside the scout but not detected: not written down.
  const ghost = addUnit(s, 0, 'stealthtank', scout.x + 3.5, scout.y - 1.5);
  const mem = observe(s, 1);
  const ids = new Set(mem.seen.map(r => r.id));
  ok(riflemen.every(r => ids.has(r.id)), 'units in sight are written down');
  ok(tanks.every(t => !ids.has(t.id)), 'units out of sight are not: the memory ignores them though the commander sees the whole map');
  ok(!ids.has(ghost.id), 'an undetected Stealth Tank is not written down');
  ok(mem.seen.every(r => r.o === 0), 'only enemies are written down');
  const sum = summarise(s, 1, mem);
  ok(sum.worth[ADAPT_CLASSES.indexOf('heavy')] === 0 && sum.worth[ADAPT_CLASSES.indexOf('infantry')] > 0, 'the summary counts infantry and no armour');
  // Side 0's own memory (it is not adapting) is untouched by side 1's look.
  ok(s.ai[0].adapt === undefined, "looking writes only the looker's memory");

  // Decay: half the weight after one half-life, and forgotten after ADAPT_FORGET once out of sight.
  const t0 = s.tick;
  const w0 = sum.worth[ADAPT_CLASSES.indexOf('infantry')];
  // Move the scout away so the riflemen are out of sight; the memory keeps them, fading.
  scout.x = home1.x + 0.5;
  scout.y = home1.y + 4.5;
  for (const r of riflemen) {
    r.x = hidden.x;
    r.y = hidden.y + 0.5;
  }
  s.tick = t0 + ADAPT_HALF_LIFE;
  const m2 = observe(s, 1);
  const w1 = summarise(s, 1, m2).worth[ADAPT_CLASSES.indexOf('infantry')];
  ok(Math.abs(w1 - w0 / 2) < 1, `a sighting out of view fades: half its weight after ${ADAPT_HALF_LIFE} ticks (${w0.toFixed(0)} to ${w1.toFixed(0)})`);
  s.tick = t0 + ADAPT_FORGET + 1;
  const m3 = observe(s, 1);
  ok(!m3.seen.some(r => riflemen.some(u => u.id === r.id)), 'and is forgotten when old');
  // A unit seen, then killed where the commander can see the spot: gone at once.
  s.tick = t0;
  const s2 = arena('adapt-sight-2');
  const sc2 = addUnit(s2, 1, 'buggy', s2.mapW / 2, s2.mapH / 2);
  const victim = addUnit(s2, 0, 'rifleman', sc2.x + 1, sc2.y);
  ok(observe(s2, 1).seen.some(r => r.id === victim.id), 'a rifleman in sight is written down');
  s2.units = s2.units.filter(u => u.id !== victim.id);
  s2.tick += ADAPT_SAMPLE;
  ok(!observe(s2, 1).seen.some(r => r.id === victim.id), 'gone from a spot in view: forgotten at once');
  // The memory is replaced, never changed in place.
  const before = s2.ai[1].adapt!;
  const frozen = JSON.stringify(before);
  s2.tick += ADAPT_SAMPLE;
  addUnit(s2, 0, 'tank', sc2.x + 2, sc2.y);
  observe(s2, 1);
  ok(JSON.stringify(before) === frozen && s2.ai[1].adapt !== before, 'a look replaces the memory and leaves the old one as it was');
}

// ---- The mix --------------------------------------------------------------------------------------

/** Deterministic numbers in [0, 1) for the property tests. */
function dice(seed: number): () => number {
  let x = seed;
  return () => {
    const r = next(x);
    x = r.seed;
    return r.value;
  };
}

const VEHICLES: [UnitKind, number][] = [
  ['tank', 5],
  ['buggy', 1],
  ['artillery', 0.8],
  ['missilecarrier', 0.5],
  ['flametank', 3],
  ['bastion', 0.5],
];
const INFANTRY: [UnitKind, number][] = [
  ['rifleman', 2],
  ['rocketeer', 1.5],
  ['grenadier', 4],
];

function mixBounds(ok: Ok): void {
  const roll = dice(424242);
  let worst = 0;
  let badFactor = 0;
  let single = 0;
  let cases = 0;
  for (let i = 0; i < 2000; i++) {
    const lean = ADAPT_CLASSES.map(() => (roll() < 0.4 ? 0 : roll()));
    const strength = roll() < 0.5 ? ADAPT_TUNING.normal.strength : ADAPT_TUNING.hard.strength;
    const slot = roll() < 0.5 ? 'vehicle' : 'infantry';
    const base = (slot === 'vehicle' ? VEHICLES : INFANTRY).map(([k, w]): [UnitKind, number] => [k, w * (0.2 + roll() * 2)]);
    const closed = new Set<UnitKind>(roll() < 0.3 ? [base[Math.floor(roll() * base.length)][0]] : []);
    const open = (k: UnitKind) => !closed.has(k);
    const out = mixFor(base, lean, strength, slot, open);
    const openOut = out.filter(([k, w]) => w > 0 && open(k));
    const total = openOut.reduce((a, [, w]) => a + w, 0);
    const baseOpen = base.filter(([k]) => open(k));
    const baseTotal = baseOpen.reduce((a, [, w]) => a + w, 0);
    cases++;
    for (const [k, w] of openOut) {
      const b = base.find(([q]) => q === k);
      const capShare = Math.max(ADAPT_MAX_SHARE, b ? b[1] / baseTotal : 0);
      worst = Math.max(worst, w / total - capShare);
      if (b && w / b[1] > ADAPT_MAX_FACTOR + 1e-9) badFactor++;
      // A weight is lowered below its floor only by the cap, which only ever touches a kind above its share.
      if (b && w / b[1] < ADAPT_MIN_FACTOR - 1e-9 && w / total < capShare - 1e-6) badFactor++;
    }
    if (openOut.length < 2 && baseOpen.length >= 2) single++;
    // Every kind open before is open after: none drops out of the mix.
    for (const [k, w] of baseOpen) if (w > 0 && !openOut.some(([q]) => q === k)) single++;
  }
  ok(worst <= 1e-6, `no kind goes beyond its share cap (${ADAPT_MAX_SHARE}, or its share before) in ${cases} random mixes (worst excess ${worst.toExponential(1)})`);
  ok(badFactor === 0, `no weight leaves [${ADAPT_MIN_FACTOR}, ${ADAPT_MAX_FACTOR}] times what it was, but by the cap (${badFactor} cases)`);
  ok(single === 0, 'the mix never narrows to one kind, and no kind drops out');
  // Nothing seen: the very list.
  ok(mixFor(VEHICLES, ADAPT_CLASSES.map(() => 0), 1, 'vehicle', () => true) === VEHICLES, 'a lean of nothing returns the list itself');
  // The counters, by class: each one's own shares rise.
  const share = (list: [UnitKind, number][], k: UnitKind) => (list.find(([q]) => q === k)?.[1] ?? 0) / list.reduce((a, [, w]) => a + w, 0);
  const only = (cls: string) => ADAPT_CLASSES.map(c => (c === cls ? 1 : 0));
  // More of the answer, and (where named) less of what it would lose with.
  const cases2: [string, 'vehicle' | 'infantry', UnitKind[], UnitKind[]][] = [
    ['infantry', 'vehicle', ['flametank', 'artillery'], ['tank', 'missilecarrier']],
    ['infantry', 'infantry', [], ['rocketeer']],
    ['heavy', 'infantry', ['rocketeer'], ['grenadier']],
    ['heavy', 'vehicle', ['tank', 'bastion'], ['artillery']],
    ['light', 'vehicle', ['tank'], ['artillery']],
    ['air', 'vehicle', ['flaktrack'], []],
    ['air', 'infantry', ['skyhunter'], []],
    ['artillery', 'vehicle', ['buggy'], []],
    ['static', 'vehicle', ['missilecarrier', 'artillery'], ['flametank']],
  ];
  for (const [cls, slot, more, less] of cases2) {
    const base = slot === 'vehicle' ? VEHICLES : INFANTRY;
    for (const [tier, t] of Object.entries(ADAPT_TUNING)) {
      const out = mixFor(base, only(cls), t.strength, slot, () => true);
      for (const k of more) ok(share(out, k) > share(base, k), `${tier}, against ${cls}: more ${k} (${(100 * share(base, k)).toFixed(0)}% to ${(100 * share(out, k)).toFixed(0)}%)`);
      for (const k of less) ok(share(out, k) < share(base, k), `${tier}, against ${cls}: fewer ${k} (${(100 * share(base, k)).toFixed(0)}% to ${(100 * share(out, k)).toFixed(0)}%)`);
    }
    // Hard moves at least as far as Normal (both may reach a cap).
    const h = mixFor(base, only(cls), ADAPT_TUNING.hard.strength, slot, () => true);
    const n = mixFor(base, only(cls), ADAPT_TUNING.normal.strength, slot, () => true);
    const k0 = more[0] ?? less[0];
    const sign = more.length ? 1 : -1;
    ok(sign * (share(h, k0) - share(n, k0)) >= -0.01, `against ${cls}: Hard leans at least as far as Normal (${k0})`);
  }
  // The scores the mix reads: the anti-air is useless on the ground and best against aircraft.
  ok(classScores('flaktrack')[ADAPT_CLASSES.indexOf('air')] > 0 && classScores('flaktrack')[ADAPT_CLASSES.indexOf('heavy')] < 0, 'Flak Tracks score against aircraft only');
}

/** The lean moves gradually: a fixed sighting, looked at again and again. */
function gradual(ok: Ok): void {
  for (const diff of ['normal', 'hard'] as const) {
    const s = arena(`adapt-gradual-${diff}`, diff);
    const scout = addUnit(s, 1, 'buggy', s.mapW / 2, s.mapH / 2);
    for (let i = 0; i < 8; i++) addUnit(s, 0, 'tank', scout.x + 1 + (i % 4) * 0.6, scout.y + 1 + Math.floor(i / 4) * 0.6);
    const heavy = ADAPT_CLASSES.indexOf('heavy');
    const track: number[] = [];
    for (let k = 0; k < 40; k++) {
      s.tick += ADAPT_SAMPLE;
      adaptObserve(s, 1);
      track.push(s.ai[1].adapt!.lean[heavy]);
    }
    const steps = track.slice(1).map((v, i) => v - track[i]);
    ok(steps.every(d => d >= -1e-9) && Math.max(...steps) <= ADAPT_TUNING[diff].rate + 1e-9, `${diff}: the lean rises gradually, never more than ${ADAPT_TUNING[diff].rate} a look`);
    const reach = track.findIndex(v => v >= 0.5);
    ok(reach >= 0, `${diff}: and reaches half within ${track.length * ADAPT_SAMPLE / 10} seconds (look ${reach + 1})`);
    if (diff === 'hard') ok(reach <= 4, 'hard: within 25 seconds');
    if (diff === 'normal') ok(reach >= 4, 'normal: more slowly than Hard');
  }
}

/**
 * Side 0 builds only one category and walks it at side 1's base; side 1 is the real commander, at
 * Hard, adaptive or not. The adaptive one's trained mix moves toward the counter.
 */
function scriptedCategory(kinds: UnitKind[], cat: 'infantry' | 'vehicle'): AiFn {
  return (s, owner) => {
    const p = s.players[owner];
    p.credits = Math.max(p.credits, 4000);
    if (p.queues[cat].length < 2) {
      const k = kinds[Math.floor(s.tick / 37) % kinds.length];
      if (canQueue(s, owner, cat, k)) doQueue(s, owner, cat, k);
    }
    if (s.tick % 300 === 0) {
      const ids = s.units.filter(u => u.owner === owner && u.order.type === 'idle' && u.kind !== 'hauler').map(u => u.id);
      const target = startOf(s, 1);
      if (ids.length >= 4) doMove(s, owner, ids, target.x + 1.5, target.y + 1.5, true);
    }
  };
}

function scriptedBase(s: GameState): void {
  const h = startOf(s, 0);
  const dir = h.y > s.mapH / 2 ? -1 : 1;
  const put = (kind: BuildingKind, dx: number, dy: number) => addBuilding(s, 0, kind, h.x + dx, h.y + dy * dir, -100);
  put('power', -6, 0);
  put('power', -6, 3);
  put('power', 5, 0);
  put('barracks', 5, 3);
  put('factory', -3, 4);
  put('uplink', 1, 5);
  put('techcentre', -7, 6);
}

function counterBattles(ok: Ok): void {
  // The answers (the best of MATCHUPS against the class) and what loses to it (the worst).
  const scenarios: [string, UnitKind[], 'infantry' | 'vehicle', UnitKind[], UnitKind[], string][] = [
    ['infantry', ['rifleman', 'grenadier'], 'infantry', ['flametank', 'artillery', 'grenadier'], ['rocketeer', 'missilecarrier', 'tank'], 'infantry'],
    ['heavy armour', ['tank', 'flametank'], 'vehicle', ['rocketeer', 'tank', 'bastion'], ['flametank', 'artillery', 'missilecarrier', 'grenadier'], 'heavy'],
  ];
  for (const [name, kinds, cat, counters, losers, cls] of scenarios) {
    const shares: number[] = [];
    let lean = 0;
    for (const adaptive of [false, true]) {
      let total = 0;
      let counter = 0;
      for (const seed of ['a', 'b']) {
        setAutopilotAi(scriptedCategory(kinds, cat), 0);
        try {
          let s = newBattle(`adapt-counter-${name}-${seed}`, 'hard', { map: 'plains', tech: 'advanced', credits: 10000, adaptive });
          scriptedBase(s);
          const known = new Set(s.units.map(u => u.id));
          while (s.tick < 9000 && s.winner === null) {
            s = processAction(s, { type: 'tick', n: 50 });
            for (const u of s.units) {
              if (known.has(u.id)) continue;
              known.add(u.id);
              if (u.owner !== 1 || u.kind === 'hauler' || u.kind === 'medic') continue;
              if (s.tick < 3000) continue;
              if (counters.includes(u.kind)) counter++;
              if (counters.includes(u.kind) || losers.includes(u.kind)) total++;
            }
          }
          if (adaptive) lean = Math.max(lean, s.ai[1].adapt?.lean[ADAPT_CLASSES.indexOf(cls as never)] ?? 0);
        } finally {
          setAutopilotAi(null, 0);
        }
      }
      shares.push(total ? counter / total : 0);
    }
    ok(lean >= 0.4, `side 0 fields only ${name}: within fifteen minutes the adaptive commander leans toward answering it (${lean.toFixed(2)})`);
    ok(shares[1] > shares[0], `side 0 fields only ${name}: adaptive trains more of the answers (${counters.join(', ')}) against what loses (${losers.join(', ')}): ${(100 * shares[1]).toFixed(0)}% against ${(100 * shares[0]).toFixed(0)}% fixed`);
  }
}

// ---- Plans -------------------------------------------------------------------------------------------

function plans(ok: Ok): void {
  for (const diff of ['normal', 'hard'] as const) {
    const s = newBattle(`adapt-plan-${diff}`, diff, { map: 'plains', tech: 'advanced', adaptive: true });
    const home = startOf(s, 1);
    const enemyHome = startOf(s, 0);
    const stage = { x: home.x + 1.5, y: home.y + (enemyHome.y > home.y ? 10 : -10) };
    const hold = ADAPT_TUNING[diff].hold;
    // Two waves broken in the same place, recently.
    s.tick = 6000;
    adaptObserve(s, 1);
    const mid = { x: (home.x + enemyHome.x) / 2, y: (home.y + enemyHome.y) / 2 };
    s.ai[1].adapt = { ...s.ai[1].adapt!, breaks: [[mid.x, mid.y, 5000], [mid.x + 2, mid.y + 1, 5900]], planAt: 0 };
    s.tick += ADAPT_SAMPLE;
    adaptObserve(s, 1);
    ok(s.ai[1].adapt!.plan === 'flank', `${diff}: two waves broken in one place: the plan turns to a flank`);
    const at = adaptStage(s, 1, stage, { x: home.x + 1.5, y: home.y + 1.5 }, { x: enemyHome.x + 1.5, y: enemyHome.y + 1.5 });
    const occ = occupancy(s);
    ok(at !== stage && passable(s, occ, Math.floor(at.x), Math.floor(at.y)), `${diff}: a second staging point on open ground (${at.x}, ${at.y})`);
    const offLine = Math.abs((at.x - stage.x) * (enemyHome.y - home.y) - (at.y - stage.y) * (enemyHome.x - home.x)) / Math.hypot(enemyHome.x - home.x, enemyHome.y - home.y);
    ok(offLine >= 6, `${diff}: off to one side of the direct line (${offLine.toFixed(1)} tiles)`);
    ok(JSON.stringify(adaptStage(s, 1, stage, home, enemyHome)) === JSON.stringify(at), `${diff}: the flank is kept in memory, the same each decision`);
    // Broken twice again on the flank.
    const fx = s.ai[1].adapt!.flank!;
    const t1 = s.tick;
    s.ai[1].adapt = { ...s.ai[1].adapt!, breaks: [...s.ai[1].adapt!.breaks, [fx[0], fx[1], t1 + 10], [fx[0] + 1, fx[1], t1 + 20]] };
    s.tick = t1 + 30;
    adaptObserve(s, 1);
    ok(s.ai[1].adapt!.plan === 'flank', `${diff}: the plan is held for at least ${hold} ticks`);
    s.tick = t1 + hold + ADAPT_SAMPLE;
    adaptObserve(s, 1);
    const p2 = s.ai[1].adapt!.plan;
    if (diff === 'hard') ok(p2 === 'raid', 'hard: broken on the flank too: raids on the economy');
    else ok(p2 === 'flank' && s.ai[1].adapt!.flank === null, 'normal: broken on the flank too: a fresh flank (Normal never raids the economy)');
  }

  // Turtling: more defences than an ordinary base and little else seen. An ordinary base's few: no siege.
  for (const diff of ['normal', 'hard'] as const) {
    const ordinary = newBattle(`adapt-turtle-${diff}`, diff, { map: 'plains', tech: 'advanced', adaptive: true });
    const g0 = startOf(ordinary, 0);
    addUnit(ordinary, 1, 'buggy', g0.x + 1.5, g0.y + (g0.y > ordinary.mapH / 2 ? -7 : 9));
    for (let i = 0; i < TURTLE_DEFENCES - 2; i++) addBuilding(ordinary, 0, 'turret', g0.x - 4 + i * 2, g0.y + (g0.y > ordinary.mapH / 2 ? -4 : 5), -100);
    ordinary.tick = 3000;
    adaptObserve(ordinary, 1);
    ok(ordinary.ai[1].adapt!.plan === 'direct' && ordinary.ai[1].adapt!.lean[ADAPT_CLASSES.indexOf('static')] === 0, `${diff}: an ordinary base's ${TURTLE_DEFENCES - 2} defences are not a turtle, and not answered`);
    const s = newBattle(`adapt-turtle-${diff}`, diff, { map: 'plains', tech: 'advanced', adaptive: true });
    const h0 = startOf(s, 0);
    const scout = addUnit(s, 1, 'buggy', h0.x + 1.5, h0.y + (h0.y > s.mapH / 2 ? -7 : 9));
    const dy = h0.y > s.mapH / 2 ? -1 : 1;
    for (let i = 0; i < 10; i++) addBuilding(s, 0, 'turret', h0.x - 4 + (i % 5) * 2, h0.y + dy * (4 + Math.floor(i / 5) * 2) + (dy > 0 ? 1 : 0), -100);
    s.tick = 3000;
    adaptObserve(s, 1);
    ok(s.ai[1].adapt!.plan === 'siege', `${diff}: a ring of defences and little else: the plan is a siege`);
    ok(adaptWaveSize(s, 1, 10, 22) === 10 + ADAPT_TUNING[diff].siegeWave, `${diff}: a siege waits for ${ADAPT_TUNING[diff].siegeWave} more in the wave`);
    const v = mixFor(VEHICLES, s.ai[1].adapt!.lean, ADAPT_TUNING[diff].strength, 'vehicle', () => true);
    const share = (list: [UnitKind, number][], k: UnitKind) => (list.find(([q]) => q === k)?.[1] ?? 0) / list.reduce((a, [, w]) => a + w, 0);
    ok(share(v, 'missilecarrier') > share(VEHICLES, 'missilecarrier'), `${diff}: and masses siege (missile carriers ${(100 * share(VEHICLES, 'missilecarrier')).toFixed(0)}% to ${(100 * share(v, 'missilecarrier')).toFixed(0)}%)`);
    void scout;
  }

  // Expansions (Hard only): a refinery seen far from the enemy's yard.
  for (const diff of ['normal', 'hard'] as const) {
    const s = newBattle(`adapt-expand-${diff}`, diff, { map: 'plains', tech: 'advanced', adaptive: true });
    const h0 = startOf(s, 0);
    const far = { x: h0.x + (h0.x > s.mapW / 2 ? -20 : 20), y: s.mapH / 2 - 1 };
    addBuilding(s, 0, 'refinery', Math.floor(far.x), Math.floor(far.y), -100);
    addUnit(s, 1, 'buggy', far.x + 1, far.y + 4);
    s.tick = 3000;
    adaptObserve(s, 1);
    const plan = s.ai[1].adapt!.plan;
    if (diff === 'hard') {
      ok(plan === 'expand', 'hard: an expansion seen: the plan is to hit it');
      const tgt = adaptTarget(s, 1, { x: h0.x, y: h0.y }, startOf(s, 1));
      ok(Math.hypot(tgt.x - far.x, tgt.y - far.y) < 4, 'hard: the wave is sent at the expansion');
    } else ok(plan === 'direct', 'normal: does not hunt expansions');
  }
}

// ---- Replay, saves, junk ----------------------------------------------------------------------------

function replay(ok: Ok): void {
  const a = run(newBattle('adapt-replay', 'hard', { map: 'random', adaptive: true }), 15000);
  const b = run(newBattle('adapt-replay', 'hard', { map: 'random', adaptive: true }), 15000);
  ok(JSON.stringify(a) === JSON.stringify(b), 'an adaptive battle replays byte-identically');
  ok(a.ai[1].adapt !== undefined && a.ai[0].adapt !== undefined, 'both commanders kept a memory (side 0 on autopilot)');
  // Saved mid-battle and loaded: the same as playing straight through.
  const mid = run(newBattle('adapt-save', 'normal', { map: 'random', adaptive: true }), 6000);
  const straight = run(mid, 6000);
  const loaded = run(migrateState(copy(mid))!, 6000);
  ok(JSON.stringify(straight) === JSON.stringify(loaded), 'saved and loaded mid-battle, it plays on exactly as straight through');
  ok(JSON.stringify(migrateState(copy(mid))) === JSON.stringify(migrateState(copy(migrateState(copy(mid))!))), 'the save migrates to itself');
  // Junk memory: refused and started afresh, never a crash.
  for (const junk of [{ a: 1 }, null, 7, { ...mid.ai[1].adapt!, seen: 'x' }, { ...mid.ai[1].adapt!, lean: [2, 0, 0, 0, 0, 0, 0] }, { ...mid.ai[1].adapt!, plan: 'moon' }]) {
    const j = copy(mid);
    j.ai[1].adapt = junk as unknown as AdaptMemory;
    const after = run(migrateState(j)!, 600);
    const m = after.ai[1].adapt!;
    ok(!!m && Array.isArray(m.seen) && m.lean.length === ADAPT_CLASSES.length && ['direct', 'flank', 'raid', 'expand', 'siege'].includes(m.plan), `junk memory ${JSON.stringify(junk).slice(0, 30)}: started afresh`);
  }
}

// ---- Whole battles, and the log ------------------------------------------------------------------

function battles(ok: Ok): void {
  let lines = 0;
  for (const [seed, diff, setup, cap] of [
    ['adapt-b1', 'hard', { map: 'random', adaptive: true }, 60000],
    ['adapt-b3', 'hard', { map: 'random', pace: 'long', adaptive: true }, 90000],
    ['adapt-b5', 'normal', { map: 'random', tech: 'standard', sides: 3, adaptive: true }, 60000],
  ] as [string, Difficulty, Partial<SkirmishSetup>, number][]) {
    let s = newBattle(seed, diff, setup);
    let maxSeen = 0;
    let maxSites = 0;
    let maxBreaks = 0;
    const plansSeen = new Set<string>();
    while (s.winner === null && s.tick < cap) {
      s = processAction(s, { type: 'tick', n: 50 });
      for (const m of s.ai) {
        if (!m.adapt) continue;
        maxSeen = Math.max(maxSeen, m.adapt.seen.length);
        maxSites = Math.max(maxSites, m.adapt.sites.length);
        maxBreaks = Math.max(maxBreaks, m.adapt.breaks.length);
        plansSeen.add(m.adapt.plan);
      }
    }
    ok(s.winner !== null, `${seed}: the battle finishes (${(s.tick / 600).toFixed(1)} min, plans ${[...plansSeen].join(', ')})`);
    ok(maxSeen <= 120 && maxSites <= 80 && maxBreaks <= 4, `${seed}: the memory stays bounded (${maxSeen} sightings, ${maxSites} structures, ${maxBreaks} breaks)`);
    const told = s.log.filter(l => /^(The enemy|Enemy raiders)/.test(l.text));
    lines += told.length;
    ok(told.every(l => !l.text.includes('—')), `${seed}: no em dash in the log`);
    ok(JSON.stringify(s).length < 2_000_000, `${seed}: the save stays a sensible size`);
  }
  console.log(`  ${lines} lines to side 0 about the commander changing its mix, over three battles`);

  // The log line: only when side 0 can see the change.
  for (const visible of [true, false]) {
    const s = arena(`adapt-tell-${visible}`);
    const home0 = startOf(s, 0);
    const home1 = startOf(s, 1);
    s.ai[1].adapt = {
      at: 0,
      seen: [],
      sites: [],
      lean: [0, 0, 0.9, 0, 0, 0, 0],
      plan: 'direct',
      planAt: 0,
      flank: null,
      breaks: [],
      phase: 0,
      waveAt: [0, 0],
      told: '',
    };
    // Two rocketeers of side 1's: beside side 0's yard (in its sight), or at side 1's own (out of it).
    const at = visible ? { x: home0.x + 1.5, y: home0.y + (home0.y > s.mapH / 2 ? -4 : 6) } : unseenNear(s, 0, home1.x + 1.5, home1.y + 1.5)!;
    addUnit(s, 1, 'rocketeer', at.x, at.y);
    addUnit(s, 1, 'rocketeer', at.x + 0.6, at.y);
    // Keep the lean where it is (no new sightings): the look runs, then the news.
    s.tick = ADAPT_SAMPLE * 2;
    const leanBefore = s.ai[1].adapt.lean.slice();
    s.ai[1].adapt = { ...s.ai[1].adapt, lean: leanBefore.map(v => (v ? 1 : 0)) };
    adaptObserve(s, 1);
    const said = s.log.some(l => l.text === 'The enemy is massing rocket infantry against your armour.');
    ok(said === visible, visible ? 'side 0 sees the rocket infantry massing: one line in its log' : 'side 0 cannot see them: nothing in its log');
    if (visible) {
      const n = s.log.length;
      s.tick += ADAPT_SAMPLE;
      adaptObserve(s, 1);
      ok(s.log.length === n, 'and the same news is not repeated');
    }
  }
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Adaptive commander: the setup field', setupField],
  ['Adaptive commander: off is off', offIsOff],
  ['Adaptive commander: sight, decay and forgetting', sight],
  ['Adaptive commander: the mix stays bounded and moves toward the counter', mixBounds],
  ['Adaptive commander: gradual change', gradual],
  ['Adaptive commander: side 0 fields one category', counterBattles],
  ['Adaptive commander: plans', plans],
  ['Adaptive commander: replay, saves and junk memory', replay],
  ['Adaptive commander: whole battles and the log', battles],
];

// Run on its own: tsx scripts/drive-adaptive.ts
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let n = 0;
  let failed = 0;
  const ok: Ok = (cond, what) => {
    n++;
    if (!cond) {
      failed++;
      console.log(`  FAIL: ${what}`);
    }
  };
  const t0 = Date.now();
  for (const [name, fn] of sections) {
    console.log(name);
    const t = Date.now();
    fn(ok);
    if (Date.now() - t > 2000) console.log(`  (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  }
  console.log(`\n${n} assertions, ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (failed) process.exit(1);
}
