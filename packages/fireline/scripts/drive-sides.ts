/**
 * Bigger battles (fireline-round4-design.md, workstream B): the setup, the teams, the maps of three
 * and four sides, the commanders' choice of enemy and help for allies, and whole battles of three
 * and four sides, computer against computer. Its sections run inside scripts/drive.ts and count
 * in its totals.
 */
import { processAction } from '../src/sim/actions';
import { alliedPlan, chooseEnemy, FOCUS_TICKS } from '../src/sim/aiSides';
import { occupancy } from '../src/sim/grid';
import { isWalkable } from '../src/sim/map';
import { fieldsOf, generateSkirmishMap, HOME_FIELD_RANGE, mapProblem, SIDES_TOLERANCE, sidesFairness, spreadOf } from '../src/sim/maps';
import {
  BUILDINGS,
  DEFAULT_SETUP,
  LEGACY_SETUP,
  LONE_SIDE_CREDITS,
  MAP_SIZE_FOR,
  MAP_TYPES,
  ORDER_QUEUE_MAX,
  UNITS,
  type MapType,
  type Owner,
  type SideMode,
  type SkirmishSetup,
} from '../src/sim/rules';
import { alliesOf, enemiesOf, frontDir, isAlly, isEnemy, teamsFor, wonBy } from '../src/sim/sides';
import { addUnit, createInitialState, isStructure, maxHpOf, migrateState, normaliseSetup } from '../src/sim/state';
import type { GameState } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

const TICK_CAP = 60000;
const standing = (s: GameState, o: number) => s.buildings.some(b => b.owner === o && isStructure(b));
const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

function newBattle(seed: string, sides: 3 | 4, mode: SideMode, map: MapType, tech: 'standard' | 'advanced' = 'standard', autopilot = true): GameState {
  return createInitialState(`sides-${seed}`, seed, { seed, difficulty: 'normal', createdAt: 0, autopilot, setup: { map, tech, sides, mode, credits: 3000, ore: 'normal' } });
}

// ---- Setup and teams ----------------------------------------------------------------------------

function setupTests(ok: Ok): void {
  ok(DEFAULT_SETUP.sides === 2 && DEFAULT_SETUP.mode === 'ffa', 'the default setup is two sides, free for all');
  ok(LEGACY_SETUP.sides === 2 && LEGACY_SETUP.mode === 'ffa', 'the legacy setup is two sides, free for all');
  ok(MAP_SIZE_FOR[2] === 64 && MAP_SIZE_FOR[3] === 80 && MAP_SIZE_FOR[4] === 96, 'map sizes 64, 80 and 96');
  for (const n of [2, 3, 4] as const)
    for (const mode of ['ffa', 'teams'] as const) {
      const r = normaliseSetup({ ...DEFAULT_SETUP, sides: n, mode });
      ok(r.sides === n, `normaliseSetup keeps ${n} sides`);
      ok(r.mode === (n === 2 ? 'ffa' : mode), `normaliseSetup: ${n} sides, ${mode} reads as ${n === 2 ? 'ffa' : mode}`);
    }
  for (const junk of [0, 1, 5, -3, 2.5, '3', null, undefined, NaN, {}, [3]]) {
    const r = normaliseSetup({ ...DEFAULT_SETUP, sides: junk as never, mode: 'teams' });
    ok(r.sides === 2 && r.mode === 'ffa', `normaliseSetup: sides ${JSON.stringify(junk)} falls back to 2, free for all`);
  }
  for (const junk of ['team', 'FFA', 1, null, undefined, {}]) {
    const r = normaliseSetup({ ...DEFAULT_SETUP, sides: 4, mode: junk as never });
    ok(r.sides === 4 && r.mode === 'ffa', `normaliseSetup: mode ${JSON.stringify(junk)} falls back to free for all`);
  }
  ok(normaliseSetup({ sides: 3 }, { ...DEFAULT_SETUP, sides: 4, mode: 'teams' }).mode === 'ffa', 'a mode left out is free for all');
  ok(normaliseSetup({ sides: 9 as never }, { ...DEFAULT_SETUP, sides: 4, mode: 'ffa' }).sides === 4, "junk sides fall back to the base's");
  ok(normaliseSetup(null).sides === 2, 'no setup at all: two sides');
  ok(teamsFor(2, 'ffa').join() === '0,1' && teamsFor(2, 'teams').join() === '0,1', 'teamsFor: two sides are [0, 1] either way');
  ok(teamsFor(3, 'ffa').join() === '0,1,2', 'teamsFor: three sides free for all, each its own team');
  ok(teamsFor(4, 'ffa').join() === '0,1,2,3', 'teamsFor: four sides free for all, each its own team');
  ok(teamsFor(3, 'teams').join() === '0,1,0', 'teamsFor: three sides as teams, sides 0 and 2 against side 1');
  ok(teamsFor(4, 'teams').join() === '0,1,0,1', 'teamsFor: four sides as teams, 0 and 2 against 1 and 3');

  // A battle of each kind, as created.
  for (const [n, mode] of [[3, 'ffa'], [3, 'teams'], [4, 'ffa'], [4, 'teams']] as [3 | 4, SideMode][]) {
    for (const tech of ['standard', 'advanced'] as const) {
      const s = newBattle(`setup-${n}-${mode}-${tech}`, n, mode, 'classic', tech, false);
      const label = `${n} sides, ${mode}, ${tech}`;
      ok(s.players.length === n && s.ai.length === n && s.starts?.length === n, `${label}: one player, memory and start per side`);
      ok(s.teams.join() === teamsFor(n, mode).join(), `${label}: teams from teamsFor`);
      ok(s.mapW === MAP_SIZE_FOR[n] && s.mapH === MAP_SIZE_FOR[n] && s.tiles.length === s.mapW * s.mapH, `${label}: a ${MAP_SIZE_FOR[n]}-tile square map`);
      ok(s.explored.length === s.tiles.length && s.ore.length === s.tiles.length, `${label}: explored and ore sized to the map`);
      ok(s.setup?.sides === n && s.setup.mode === mode, `${label}: the setup is stored`);
      ok(tech === 'advanced' ? s.powers?.length === n : s.powers === undefined, `${label}: powers per side on advanced tech only`);
      for (let o = 0; o < n; o++) {
        const yard = s.buildings.filter(b => b.owner === o);
        ok(yard.length === 1 && yard[0].kind === 'hq' && yard[0].x === s.starts![o].x && yard[0].y === s.starts![o].y, `${label}: side ${o} has its yard on its site`);
        ok(s.units.filter(u => u.owner === o && u.kind === 'rifleman').length === 3, `${label}: side ${o} has three riflemen`);
        const lone = n === 3 && mode === 'teams' && o === 1;
        ok(s.players[o].credits === (lone ? 3000 * LONE_SIDE_CREDITS : 3000), `${label}: side ${o} starts with ${lone ? 'the lone side' : 'the setup'}'s credits`);
        const st = s.starts![o];
        ok(frontDir(s, o as Owner) === (st.y + 1.5 >= s.mapH / 2 ? 1 : -1), `${label}: side ${o} faces away from the middle`);
      }
      ok(frontDir(s, 0) === 1, `${label}: side 0 starts in the bottom half`);
      const m = migrateState(copy(s));
      ok(m !== null && JSON.stringify(m) === JSON.stringify(s), `${label}: the new state passes migrateState unchanged`);
    }
  }
  // Two sides are exactly as before: the same map, starts, players and teams with or without the new fields.
  const a = createInitialState('two', 'two', { seed: 'two-sides', createdAt: 0, setup: { map: 'river', tech: 'advanced', credits: 3000, ore: 'normal' } });
  const b = createInitialState('two', 'two', { seed: 'two-sides', createdAt: 0, setup: { map: 'river', tech: 'advanced', credits: 3000, ore: 'normal', sides: 2, mode: 'teams' } });
  ok(JSON.stringify(a) === JSON.stringify(b), 'two sides: the state is the same whether or not sides and mode are given');
  ok(a.mapW === 64 && a.players.length === 2 && a.teams.join() === '0,1' && a.setup?.mode === 'ffa', 'two sides: 64 tiles, two players, [0, 1], free for all');
  // An old save's setup (no sides, no mode) loads as two sides.
  const old = copy(a);
  delete (old.setup as Partial<SkirmishSetup>).sides;
  delete (old.setup as Partial<SkirmishSetup>).mode;
  const om = migrateState(old);
  ok(om !== null && om.setup?.sides === 2 && om.setup.mode === 'ffa', 'a save from before sides loads as two sides, free for all');
}

// ---- Maps ---------------------------------------------------------------------------------------

function mapTests(ok: Ok): void {
  const PER = 20;
  for (const n of [3, 4] as const) {
    const S = MAP_SIZE_FOR[n];
    for (const type of MAP_TYPES) {
      let problems = 0;
      const worst = { ground: 0, ore: 0, walk: 0 };
      for (let i = 0; i < PER; i++) {
        const seed = 7000 + i * 104729 + n;
        const m = generateSkirmishMap(seed, type, i % 3 === 0 ? 'rich' : i % 3 === 1 ? 'poor' : 'normal', n);
        const label = `${n} sides, ${type}, seed ${i}`;
        const p = mapProblem(m);
        if (p !== null) problems++;
        ok(p === null, `${label}: passes mapProblem (${p})`);
        ok(m.w === S && m.h === S && m.starts.length === n, `${label}: ${S} tiles square, one start per side`);
        if (n === 4) {
          let same = true;
          for (let y = 0; y < S && same; y++)
            for (let x = 0; x < S; x++) {
              const k = y * S + x;
              const r = x * S + (S - 1 - y);
              if (m.tiles[k] !== m.tiles[r] || m.ore[k] !== m.ore[r]) {
                same = false;
                break;
              }
            }
          ok(same, `${label}: a quarter turn maps the map onto itself, tile for tile and ore for ore`);
          const [s0, s1, s2, s3] = m.starts;
          ok(s0.x < S / 2 && s0.y > S / 2 && s1.x > S / 2 && s1.y < S / 2 && s2.x > S / 2 && s2.y > S / 2 && s3.x < S / 2 && s3.y < S / 2, `${label}: sides 0 to 3 bottom left, top right, bottom right, top left`);
        } else {
          const [s0, s1, s2] = m.starts;
          ok(s0.y > S / 2 && Math.abs(s0.x + 1.5 - S / 2) <= 1, `${label}: side 0 at the bottom centre`);
          ok(s1.y < S / 2 && s1.x > S / 2 && s2.y < S / 2 && s2.x < S / 2, `${label}: side 1 upper right, side 2 upper left`);
        }
        for (const st of m.starts) ok(Math.abs(st.y + 1.5 - S / 2) >= 4, `${label}: every site clearly in one half`);
        const fields = fieldsOf(m.ore, S).filter(f => f.size >= 5);
        for (const st of m.starts) ok(fields.some(f => Math.hypot(f.x - st.x - 1.5, f.y - st.y - 1.5) < HOME_FIELD_RANGE), `${label}: a home field by every site`);
        const f = sidesFairness(m);
        const pairs: number[] = [];
        for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (n === 3) pairs.push(f.walk[a][b]);
        worst.ground = Math.max(worst.ground, spreadOf(f.ground));
        worst.ore = Math.max(worst.ore, spreadOf(f.homeOre));
        worst.walk = Math.max(worst.walk, pairs.length ? spreadOf(pairs) : 0);
        if (n === 4) ok(spreadOf(f.ground) === 0 && spreadOf(f.homeOre) === 0, `${label}: every site has exactly the same ground and home ore`);
        // Same map from the same seed: generation is pure.
        if (i === 0) ok(JSON.stringify(generateSkirmishMap(seed, type, 'rich', n)) === JSON.stringify(m), `${label}: the same seed draws the same map`);
      }
      ok(worst.ground <= SIDES_TOLERANCE && worst.ore <= SIDES_TOLERANCE && worst.walk <= SIDES_TOLERANCE, `${n} sides, ${type}: every site within ${SIDES_TOLERANCE * 100}% of the others`);
      console.log(
        `  ${n} sides, ${type}: ${PER} maps, ${problems} problems; largest spread between sites: ground ${(worst.ground * 100).toFixed(1)}%, home ore ${(worst.ore * 100).toFixed(1)}%, walk ${(worst.walk * 100).toFixed(1)}%`,
      );
    }
  }
  // A two-sided map is unchanged by the new parameter.
  ok(JSON.stringify(generateSkirmishMap(99, 'canyon', 'normal', 2)) === JSON.stringify(generateSkirmishMap(99, 'canyon', 'normal')), 'two sides: the generator is untouched');
}

// ---- The commanders -----------------------------------------------------------------------------

function commanderTests(ok: Ok): void {
  // Two sides: the choice is the one enemy, and the memory is left exactly as it was.
  const two = createInitialState('two-ai', 'two', { seed: 'two-ai', createdAt: 0, setup: { map: 'plains', tech: 'standard', credits: 3000, ore: 'normal' } });
  const c2 = copy(two);
  ok(chooseEnemy(c2, 1) === 0 && chooseEnemy(c2, 0) === 1, 'two sides: each chooses the other');
  ok(JSON.stringify(c2) === JSON.stringify(two), 'two sides: choosing writes nothing');

  // Four sides, free for all: a neighbour, never the side across the map, kept for FOCUS_TICKS.
  const s = newBattle('ai-choice', 4, 'ffa', 'plains', 'standard', false);
  const neighbours: Record<number, number[]> = { 0: [2, 3], 1: [2, 3], 2: [0, 1], 3: [0, 1] };
  const first: number[] = [];
  for (const o of [0, 1, 2, 3] as Owner[]) {
    const f = chooseEnemy(s, o);
    first.push(f!);
    ok(f !== null && neighbours[o].includes(f), `four sides: side ${o} first aims at a neighbour (${f})`);
    ok(s.ai[o].focus === f && s.ai[o].focusUntil === s.tick + FOCUS_TICKS, `four sides: side ${o} remembers its choice for ${FOCUS_TICKS} ticks`);
  }
  ok(new Set(first).size === 4, `four sides: on a symmetric map no side is everyone's first choice (${first.join(', ')})`);
  // Sticky while the focus stands, even when another enemy looks better.
  const sticky = copy(s);
  sticky.units = sticky.units.filter(u => u.owner !== first[0] && u.owner !== 0);
  const other = neighbours[0].find(o => o !== first[0])!;
  for (let i = 0; i < 12; i++) addUnit(sticky, first[0] as Owner, 'tank', sticky.starts![first[0]].x + 1, sticky.starts![first[0]].y + 4);
  sticky.tick = s.tick + FOCUS_TICKS - 1;
  ok(chooseEnemy(sticky, 0) === first[0], 'the focus holds until FOCUS_TICKS run out');
  sticky.tick = s.tick + FOCUS_TICKS;
  ok(chooseEnemy(sticky, 0) === other, 'when the focus runs out, the weaker of two equally near enemies is chosen');
  // A focus that falls is dropped at once.
  const fallen = copy(s);
  fallen.buildings = fallen.buildings.filter(b => b.owner !== first[0]);
  ok(chooseEnemy(fallen, 0) === other, 'a focus with no structure left is dropped at once');
  const alone = copy(s);
  alone.buildings = alone.buildings.filter(b => b.owner === 0 || b.owner === 1);
  delete alone.ai[0].focus;
  delete alone.ai[0].focusUntil;
  ok(chooseEnemy(alone, 0) === 1, 'with one enemy standing, that one');
  ok(alone.ai[0].focus === undefined, 'with one enemy standing, nothing is written');
  const none = copy(alone);
  none.buildings = none.buildings.filter(b => b.owner === 0);
  ok(chooseEnemy(none, 0) === null, 'no enemy standing: null');

  // Teams: never an ally; an ally's focus is preferred.
  const t = newBattle('ai-teams', 4, 'teams', 'plains', 'standard', false);
  for (const o of [0, 1, 2, 3] as Owner[]) {
    const f = chooseEnemy(t, o)!;
    ok(isEnemy(t, o, f), `two against two: side ${o} aims at an enemy (${f})`);
  }
  // Side 0's enemies are side 3 (beside it) and side 1 (across the map, twice as far). Make side 3
  // strong and side 1 weak: alone, side 0 still goes for the near one; once its ally is attacking
  // side 1, it joins in.
  const t2 = newBattle('ai-teams-2', 4, 'teams', 'plains', 'standard', false);
  for (let i = 0; i < 12; i++) addUnit(t2, 3, 'tank', t2.starts![3].x + 1 + (i % 4), t2.starts![3].y + 5 + Math.floor(i / 4));
  const t3 = copy(t2);
  ok(chooseEnemy(t2, 0) === 3, 'two against two: alone, side 0 aims at the enemy beside it');
  t3.ai[2].focus = 1;
  t3.ai[2].focusUntil = 99999;
  ok(chooseEnemy(t3, 0) === 1, "two against two: with its ally attacking the weak enemy, side 0 joins it");

  // Help for an ally under attack.
  const h = newBattle('ai-help', 4, 'teams', 'plains', 'standard', false);
  const hc = copy(h);
  const home = { x: hc.starts![0].x + 1.5, y: hc.starts![0].y + 1.5 };
  for (let i = 0; i < 6; i++) addUnit(hc, 0, 'tank', home.x + (i % 3) - 1, home.y - 4 - Math.floor(i / 3));
  hc.ai[2].hurtTick = hc.tick;
  hc.ai[2].hurtX = hc.starts![2].x + 1;
  hc.ai[2].hurtY = hc.starts![2].y + 1;
  const quiet = copy(hc);
  alliedPlan(hc, 0, home, home, [], false);
  const sent = hc.units.filter(u => u.owner === 0 && u.order.type === 'attackMove' && Math.abs(u.order.x - hc.ai[2].hurtX) < 2);
  ok(sent.length >= 3 && sent.length <= 4, `an ally hit within 20 seconds: half the idle reserve goes to help (${sent.length} of 9)`);
  const busy = copy(quiet);
  alliedPlan(busy, 0, home, home, [], true);
  ok(JSON.stringify(busy) === JSON.stringify(quiet), 'with its own base threatened, a commander sends no help');
  const stale = copy(quiet);
  stale.tick += 300;
  const staleBefore = JSON.stringify(stale);
  alliedPlan(stale, 0, home, home, [], false);
  ok(JSON.stringify(stale) === staleBefore, 'an ally hit more than 20 seconds ago gets no help');
  const ffa = newBattle('ai-help-ffa', 4, 'ffa', 'plains', 'standard', false);
  ffa.ai[2].hurtTick = ffa.tick;
  const ffaBefore = JSON.stringify(ffa);
  alliedPlan(ffa, 0, home, home, [], false);
  ok(JSON.stringify(ffa) === ffaBefore && alliesOf(ffa, 0).length === 0, 'free for all: no ally, nothing done');
}

// ---- Whole battles ------------------------------------------------------------------------------

function invariants(ok: Ok, s: GameState, label: string): void {
  const ids = new Set<number>();
  const occ = occupancy(s);
  for (const u of s.units) {
    ok(!ids.has(u.id), `${label}: unit id unique`);
    ids.add(u.id);
    ok(u.hp > 0 && u.hp <= maxHpOf(u), `${label}: unit ${u.id} hp in range`);
    ok(u.x >= 0 && u.y >= 0 && u.x < s.mapW && u.y < s.mapH, `${label}: unit ${u.id} on the map`);
    const k = Math.floor(u.y) * s.mapW + Math.floor(u.x);
    // Aircraft fly over water, rock and structures.
    const air = UNITS[u.kind].category === 'air';
    ok(air || isWalkable(s.tiles[k]), `${label}: unit ${u.id} on walkable ground`);
    ok(air || occ[k] === 0, `${label}: unit ${u.id} (${u.kind}) not inside a structure`);
    ok(u.queue.length <= ORDER_QUEUE_MAX, `${label}: order queue capped`);
    ok(u.owner >= 0 && u.owner < s.players.length, `${label}: unit owner is a side`);
  }
  for (const b of s.buildings) {
    ok(!ids.has(b.id), `${label}: building id unique`);
    ids.add(b.id);
    ok(b.hp > 0 && b.hp <= BUILDINGS[b.kind].hp, `${label}: building ${b.id} hp in range`);
    ok(b.x >= 0 && b.y >= 0 && b.x + BUILDINGS[b.kind].w <= s.mapW && b.y + BUILDINGS[b.kind].h <= s.mapH, `${label}: building on the map`);
  }
  for (const p of s.players) {
    ok(p.credits >= 0, `${label}: ${p.name} credits never negative`);
    ok(p.queues.building.length <= 1 && p.queues.infantry.length <= 5 && p.queues.vehicle.length <= 5, `${label}: queues capped`);
  }
  for (let o = 0; o < s.players.length; o++) {
    const f = s.ai[o].focus;
    if (f !== undefined) ok(isEnemy(s, o as Owner, f), `${label}: side ${o}'s focus is an enemy`);
  }
  ok(s.ore.every(v => v >= 0 && v <= 500), `${label}: ore in range`);
  ok(s.explored.length === s.mapW * s.mapH, `${label}: explored map intact`);
  ok(ids.size < s.nextId, `${label}: ids below nextId`);
}

interface Played {
  s: GameState;
  allyShots: number;
  shots: number;
}

function play(ok: Ok, seed: string, sides: 3 | 4, mode: SideMode, map: MapType, tech: 'standard' | 'advanced', cap = TICK_CAP): Played {
  let s = newBattle(seed, sides, mode, map, tech);
  invariants(ok, s, `${seed}@0`);
  let allyShots = 0;
  let shots = 0;
  const seen = new Set<number>();
  let n = 0;
  while (s.winner === null && s.tick < cap) {
    const before = n % 20 === 0 ? JSON.stringify(s) : null;
    const next = processAction(s, { type: 'tick', n: 40 });
    if (before) ok(JSON.stringify(s) === before, `${seed}: a tick does not change its input`);
    s = next;
    n++;
    // Every shot in the air is aimed at an enemy of whoever fired it.
    const byId = new Map<number, number>();
    for (const u of s.units) byId.set(u.id, u.owner);
    for (const b of s.buildings) byId.set(b.id, b.owner);
    for (const p of s.projectiles) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const target = byId.get(p.target);
      if (target === undefined) continue;
      shots++;
      if (isAlly(s, p.owner, target as Owner)) allyShots++;
    }
    if (s.tick % 2000 === 0) invariants(ok, s, `${seed}@${s.tick}`);
  }
  invariants(ok, s, `${seed}@end`);
  return { s, allyShots, shots };
}

function battleTests(ok: Ok): void {
  // Each map type once at three sides and once at four; every kind of battle at least twice.
  const plan: [3 | 4, SideMode][] = [
    [3, 'ffa'],
    [4, 'teams'],
    [3, 'teams'],
    [4, 'ffa'],
  ];
  const runs: { label: string; winner: number | null; tick: number }[] = [];
  MAP_TYPES.forEach((map, i) => {
    for (const k of [0, 1]) {
      const [sides, mode] = plan[(i * 2 + k) % plan.length];
      const tech = i % 2 === 0 ? 'standard' : 'advanced';
      const seed = `sides-${sides}-${mode}-${map}`;
      const { s, allyShots, shots } = play(ok, seed, sides, mode, map, tech);
      const label = `${sides} sides ${mode === 'ffa' ? 'free for all' : 'teams'}, ${map}, ${tech}`;
      runs.push({ label, winner: s.winner, tick: s.tick });
      for (let o = 0; o < sides; o++) ok(s.players[o].stats.harvested > 0, `${label}: side ${o} harvested ore`);
      ok(shots > 50, `${label}: there was fighting (${shots} shots seen)`);
      ok(allyShots === 0, `${label}: no shot at an ally (${allyShots} of ${shots})`);
      if (s.winner !== null) {
        const up = s.players.map((_, o) => o).filter(o => standing(s, o));
        if (s.winner === 0) {
          ok(up.every(o => isAlly(s, 0, o as Owner)), `${label}: a victory leaves only side 0's team with structures`);
          ok(wonBy(s, 0) && (mode === 'ffa' || alliesOf(s, 0).every(a => wonBy(s, a))), `${label}: side 0's team won`);
        } else {
          ok(!up.some(o => isAlly(s, 0, o as Owner)), `${label}: a defeat leaves side 0's team without a structure`);
          ok(isEnemy(s, 0, s.winner), `${label}: the winner is an enemy of side 0`);
          if (up.length) ok(standing(s, s.winner), `${label}: the winner still has a structure`);
          if (mode === 'teams') ok(up.every(o => isAlly(s, s.winner!, o as Owner)), `${label}: the winning team is the last with structures`);
          const foesUp = enemiesOf(s, 0).filter(o => standing(s, o));
          if (foesUp.length) ok(s.winner === foesUp[0], `${label}: the winner is the lowest-numbered enemy still standing`);
        }
      }
    }
  });
  const done = runs.filter(r => r.winner !== null);
  ok(done.length >= Math.ceil(runs.length * 0.85), `at least 85% of battles of three and four sides finish (${done.length}/${runs.length})`);
  const avg = done.reduce((a, r) => a + r.tick / 600, 0) / Math.max(1, done.length);
  console.log(`  ${done.length}/${runs.length} finished, average ${avg.toFixed(1)} game minutes`);
  for (const r of runs) console.log(`    ${r.label}: ${r.winner === null ? 'unfinished' : `side ${r.winner} in ${Math.round(r.tick / 600)} min`}`);
}

function replayTests(ok: Ok): void {
  const run = () => {
    let s = newBattle('sides-replay', 4, 'ffa', 'highlands', 'advanced');
    while (s.winner === null && s.tick < 6000) s = processAction(s, { type: 'tick', n: 50 });
    return JSON.stringify(s);
  };
  const a = run();
  ok(a === run(), 'a four-sided battle played twice is byte-identical');
  const t = () => {
    let s = newBattle('sides-replay-t', 3, 'teams', 'river', 'standard');
    while (s.winner === null && s.tick < 6000) s = processAction(s, { type: 'tick', n: 50 });
    return JSON.stringify(s);
  };
  ok(t() === t(), 'a three-sided battle of teams played twice is byte-identical');
  // A save mid-battle loads and plays on exactly.
  let s = newBattle('sides-save', 4, 'teams', 'lakes', 'advanced');
  s = processAction(s, { type: 'tick', n: 3000 });
  const loaded = migrateState(copy(s));
  ok(loaded !== null, 'a four-sided save loads');
  if (loaded) ok(JSON.stringify(processAction(loaded, { type: 'tick', n: 500 })) === JSON.stringify(processAction(s, { type: 'tick', n: 500 })), 'a four-sided save plays on exactly');
  ok(UNITS.rifleman.cost > 0, 'rules loaded');
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Bigger battles: setup and teams', setupTests],
  ['Bigger battles: maps of three and four sides', mapTests],
  ['Bigger battles: choosing an enemy, helping an ally', commanderTests],
  ['Bigger battles: replay and saves', replayTests],
  ['Bigger battles: whole battles of three and four sides', battleTests],
];
