/**
 * Larger maps and long games (fireline-round5-design.md, workstream B): the size option, the
 * generator at large and huge for two to four sides, ore that spreads back, the computer's numbers
 * for the map's size, saves, and whole computer battles on the larger maps. Its sections run inside
 * scripts/drive.ts and count in its totals; the longer sweep is scripts/long-games.ts.
 */
import { processAction } from '../src/sim/actions';
import { mapScale, reserveRadius, scaledFor, stageDistance } from '../src/sim/aiScale';
import { findPath, occupancy } from '../src/sim/grid';
import { isWalkable } from '../src/sim/map';
import { fieldsOf, generateSkirmishMap, mapProblem, oreBed, SIDES_TOLERANCE, sidesFairness, spreadOf } from '../src/sim/maps';
import { seedFromString } from '../src/sim/rng';
import {
  DEFAULT_SETUP,
  DIFFICULTIES,
  LEGACY_SETUP,
  MAP_SIZE_FOR,
  MAP_SIZE_TILES,
  MAP_SIZES,
  MAP_TILES_MAX,
  MAP_TYPES,
  ORE_SPREAD_AMOUNT,
  ORE_SPREAD_TICKS,
  UNITS,
  mapTilesFor,
  pathBudgetFor,
  pathExpandLimitFor,
  exploreTicksFor,
  type MapSize,
  type MapType,
  type SideMode,
  type SkirmishSetup,
} from '../src/sim/rules';
import { addBuilding, createInitialState, isStructure, maxHpOf, migrateState, normaliseSetup } from '../src/sim/state';
import type { GameState } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

/** The harness's tick cap for a battle (as in drive.ts): 45000 standard, 72000 large, 108000 huge. */
const capFor = (setup?: Partial<SkirmishSetup>): number => (setup?.size === 'huge' ? 108000 : setup?.size === 'large' ? 72000 : 45000);
const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
/** Plays n ticks, in actions of at most 600 (MAX_TICKS_PER_ACTION). */
function run(s: GameState, n: number): GameState {
  while (n > 0 && s.winner === null) {
    const k = Math.min(600, n);
    s = processAction(s, { type: 'tick', n: k });
    n -= k;
  }
  return s;
}

function newBattle(seed: string, size: MapSize, sides: 2 | 3 | 4 = 2, mode: SideMode = 'ffa', map: MapType | 'random' = 'random', autopilot = true): GameState {
  return createInitialState(`maps-${seed}`, seed, { seed, difficulty: 'normal', createdAt: 0, autopilot, setup: { map, tech: 'advanced', sides, mode, size } });
}

/** The invariants every battle keeps, at any size (a copy of drive.ts's, reading the state's own size). */
function invariants(ok: Ok, s: GameState, label: string): void {
  const W = s.mapW;
  const ids = new Set<number>();
  for (const u of s.units) {
    ok(!ids.has(u.id), `${label}: unit id ${u.id} unique`);
    ids.add(u.id);
    ok(u.hp > 0 && u.hp <= maxHpOf(u), `${label}: unit ${u.id} hp in range`);
    ok(u.x >= 0 && u.y >= 0 && u.x < W && u.y < s.mapH, `${label}: unit ${u.id} on the map`);
    ok(UNITS[u.kind].category === 'air' || isWalkable(s.tiles[Math.floor(u.y) * W + Math.floor(u.x)]), `${label}: unit ${u.id} on walkable ground`);
  }
  for (const b of s.buildings) {
    ok(!ids.has(b.id), `${label}: building id ${b.id} unique`);
    ids.add(b.id);
  }
  for (const p of s.players) ok(p.credits >= 0, `${label}: ${p.name} credits never negative`);
  ok(s.ore.every(o => o >= 0 && o <= 500), `${label}: ore in range`);
  ok(s.explored.length === W * s.mapH && s.ore.length === W * s.mapH, `${label}: explored and ore sized to the map`);
}

// ---- The size option --------------------------------------------------------------------------

function sizeTests(ok: Ok): void {
  ok(MAP_SIZES.join() === 'standard,large,huge', 'three sizes, smallest first');
  ok(DEFAULT_SETUP.size === 'standard' && LEGACY_SETUP.size === 'standard', 'the default and legacy setups are standard size');
  for (const n of [2, 3, 4] as const) {
    ok(mapTilesFor({ sides: n, size: 'standard' }) === MAP_SIZE_FOR[n], `standard, ${n} sides: ${MAP_SIZE_FOR[n]} tiles, as before`);
    ok(mapTilesFor({ sides: n }) === MAP_SIZE_FOR[n], `no size, ${n} sides: standard`);
    for (const size of MAP_SIZES) {
      const t = mapTilesFor({ sides: n, size });
      ok(t === MAP_SIZE_TILES[size][n] && t <= MAP_TILES_MAX, `${size}, ${n} sides: ${t} tiles, at most ${MAP_TILES_MAX}`);
    }
    ok(MAP_SIZE_TILES.standard[n] < MAP_SIZE_TILES.large[n] && MAP_SIZE_TILES.large[n] < MAP_SIZE_TILES.huge[n], `${n} sides: each size larger than the last`);
  }
  for (const size of MAP_SIZES) ok(normaliseSetup({ size }).size === size, `normaliseSetup keeps ${size}`);
  for (const junk of ['Large', 'giant', 3, null, undefined, {}, ['huge'], true]) {
    ok(normaliseSetup({ size: junk as never }).size === 'standard', `normaliseSetup: size ${JSON.stringify(junk)} falls back to standard`);
    ok(normaliseSetup({ size: junk as never }, { ...DEFAULT_SETUP, size: 'huge' }).size === 'huge', `normaliseSetup: size ${JSON.stringify(junk)} falls back to the base's`);
  }
  // Rules gated on size: standard is what it always was.
  ok(pathBudgetFor('standard') === 24 && pathExpandLimitFor('standard', 9216) === 6000 && exploreTicksFor('standard') === 5, 'standard size: 24 path searches a tick, 6000 tiles each, fog every 5 ticks');
  ok(pathBudgetFor('huge') < 24 && pathExpandLimitFor('huge', 160 * 160) > 6000 && exploreTicksFor('huge') === 10, 'larger maps: fewer, longer path searches; fog every 10 ticks');

  // A battle of each size, as created, and through a save.
  for (const size of MAP_SIZES)
    for (const n of [2, 4] as const) {
      const s = newBattle(`setup-${size}-${n}`, size, n, n === 4 ? 'teams' : 'ffa', 'classic', false);
      const label = `${size}, ${n} sides`;
      const t = MAP_SIZE_TILES[size][n];
      ok(s.mapW === t && s.mapH === t && s.tiles.length === t * t, `${label}: a ${t}-tile square map`);
      ok(s.setup?.size === size, `${label}: the size is stored on the setup`);
      ok(s.buildings.length === n && s.units.length === 3 * n, `${label}: a yard and three riflemen a side`);
      const first = scaledFor(s, DIFFICULTIES.normal).firstAttack;
      ok(s.ai.every(a => a.nextAttack === first), `${label}: every commander's first attack set for the size (${first})`);
      ok(size === 'standard' ? first === DIFFICULTIES.normal.firstAttack : first > DIFFICULTIES.normal.firstAttack, `${label}: ${size === 'standard' ? 'the difficulty\'s own first attack' : 'a later first attack'}`);
      const m = migrateState(copy(s));
      ok(m !== null && JSON.stringify(m) === JSON.stringify(s), `${label}: the new state passes migrateState unchanged`);
    }
  // A standard-size setup makes exactly the state it made before round 5 (no size given at all).
  const a = createInitialState('std', 'std', { seed: 'std-size', createdAt: 0, setup: { map: 'lakes', tech: 'advanced' } });
  const b = createInitialState('std', 'std', { seed: 'std-size', createdAt: 0, setup: { map: 'lakes', tech: 'advanced', size: 'standard' } });
  ok(JSON.stringify(a) === JSON.stringify(b), 'standard size: the same state whether or not the size is given');
  // An old save's setup (no size) loads as standard.
  const old = copy(a);
  delete (old.setup as Partial<SkirmishSetup>).size;
  const om = migrateState(old);
  ok(om !== null && om.setup?.size === 'standard', 'a save from before round 5 loads as standard size');
}

// ---- Maps ---------------------------------------------------------------------------------------

function mapTests(ok: Ok): void {
  const PER = 10;
  // Fields of five tiles or more, averaged per map, by size and side count: larger maps have more.
  const fieldsBy = new Map<string, number>();
  for (const n of [2, 3, 4] as const) {
    let std = 0;
    for (let i = 0; i < PER; i++) std += fieldsOf(generateSkirmishMap(seedFromString(`std-${n}-${i}`), MAP_TYPES[i % MAP_TYPES.length], 'normal', n).ore, MAP_SIZE_FOR[n]).filter(f => f.size >= 5).length;
    fieldsBy.set(`standard ${n}`, std / PER);
  }
  for (const size of ['large', 'huge'] as const)
    for (const n of [2, 3, 4] as const) {
      const S = MAP_SIZE_TILES[size][n];
      let fields = 0;
      let problems = 0;
      let worst = { ground: 0, ore: 0, walk: 0 };
      for (const type of MAP_TYPES) {
        for (let i = 0; i < PER; i++) {
          const seed = seedFromString(`${size}-${n}-${type}-${i}`);
          const m = generateSkirmishMap(seed, type, i % 3 === 0 ? 'rich' : i % 3 === 1 ? 'poor' : 'normal', n, size);
          const label = `${size}, ${n} sides, ${type} #${i}`;
          const p = mapProblem(m);
          if (p) problems++;
          ok(p === null, `${label}: passes mapProblem (${p})`);
          ok(m.w === S && m.h === S && m.tiles.length === S * S && m.ore.length === S * S, `${label}: ${S} tiles square`);
          ok(m.starts.length === n, `${label}: one start per side`);
          // Symmetry, checked here rather than trusted: two sides point-symmetric, four a quarter
          // turn exactly; three are within tolerance (sidesFairness, below).
          let sym = true;
          if (n === 2) {
            for (let k = 0; k < S * S && sym; k++) if (m.tiles[k] !== m.tiles[S * S - 1 - k] || m.ore[k] !== m.ore[S * S - 1 - k]) sym = false;
          } else if (n === 4) {
            for (let y = 0; y < S && sym; y++)
              for (let x = 0; x < S; x++) {
                const k = y * S + x;
                const r = x * S + (S - 1 - y);
                if (m.tiles[k] !== m.tiles[r] || m.ore[k] !== m.ore[r]) {
                  sym = false;
                  break;
                }
              }
          }
          ok(sym, `${label}: symmetric`);
          // The front rule: side 0 in the bottom half, every start clearly in one half.
          ok(m.starts[0].y + 1.5 > S / 2 + 4, `${label}: side 0 starts clearly in the bottom half`);
          ok(m.starts.every(st => Math.abs(st.y + 1.5 - S / 2) >= 4), `${label}: every start clearly in its half`);
          // mapProblem holds every map to the tolerance; the spreads are measured again here on the
          // first two seeds of each type, for the report (the full sweep is scripts/long-games.ts --maps).
          if (n > 2 && i < 2) {
            const f = sidesFairness(m);
            const g = spreadOf(f.ground);
            const o = spreadOf(f.homeOre);
            const pairs: number[] = [];
            for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) pairs.push(f.walk[a][b]);
            const w = n === 3 ? spreadOf(pairs) : 0;
            ok(g <= SIDES_TOLERANCE && o <= SIDES_TOLERANCE && w <= SIDES_TOLERANCE, `${label}: fair within ${SIDES_TOLERANCE} (${g.toFixed(3)}, ${o.toFixed(3)}, ${w.toFixed(3)})`);
            worst = { ground: Math.max(worst.ground, g), ore: Math.max(worst.ore, o), walk: Math.max(worst.walk, w) };
          }
          fields += fieldsOf(m.ore, S).filter(f => f.size >= 5).length;
          if (i === 0 && type === 'canyon') ok(JSON.stringify(generateSkirmishMap(seed, type, 'rich', n, size)) === JSON.stringify(m), `${label}: the same seed draws the same map`);
        }
      }
      const avg = fields / (PER * MAP_TYPES.length);
      fieldsBy.set(`${size} ${n}`, avg);
      console.log(
        `    ${size}, ${n} sides: ${PER * MAP_TYPES.length} maps, ${problems} problems; ${avg.toFixed(1)} ore fields a map (standard ${fieldsBy.get(`standard ${n}`)!.toFixed(1)})` +
          (n > 2 ? `; largest spread between sites (two seeds a type): ground ${(worst.ground * 100).toFixed(1)}%, home ore ${(worst.ore * 100).toFixed(1)}%, walk ${(worst.walk * 100).toFixed(1)}%` : ''),
      );
    }
  for (const n of [2, 3, 4] as const) {
    ok(fieldsBy.get(`large ${n}`)! > fieldsBy.get(`standard ${n}`)!, `${n} sides: large maps have more ore fields than standard`);
    ok(fieldsBy.get(`huge ${n}`)! > fieldsBy.get(`standard ${n}`)!, `${n} sides: huge maps have more ore fields than standard`);
  }
  // Standard size draws exactly the old maps: the size argument changes nothing there.
  for (const n of [2, 3, 4] as const)
    ok(JSON.stringify(generateSkirmishMap(77, 'river', 'normal', n, 'standard')) === JSON.stringify(generateSkirmishMap(77, 'river', 'normal', n)), `${n} sides: standard size is the old generator`);
  // A bad size is standard.
  ok(JSON.stringify(generateSkirmishMap(5, 'plains', 'normal', 2, 'giant' as MapSize)) === JSON.stringify(generateSkirmishMap(5, 'plains', 'normal', 2)), 'an unknown size draws a standard map');
  // Paths reach across the largest map: a search from one base to the far one arrives.
  const s = newBattle('reach', 'huge', 4, 'teams', 'plains', false);
  const occ = occupancy(s);
  const a = s.starts![0];
  const b = s.starts![1];
  const path = findPath(s, occ, (a.y + 4) * s.mapW + a.x + 1, (b.y - 2) * s.mapW + b.x + 1);
  const end = path[path.length - 1];
  ok(path.length > 0 && Math.hypot((end % s.mapW) - (b.x + 1), ((end / s.mapW) | 0) - (b.y - 2)) < 3, 'a 160-tile map: a path from one corner base reaches the opposite one');
}

// ---- Ore spreading back -------------------------------------------------------------------------

function oreTests(ok: Ok): void {
  ok(ORE_SPREAD_TICKS > 0 && ORE_SPREAD_AMOUNT > 0, `ore spreads back every ${ORE_SPREAD_TICKS} ticks, ${ORE_SPREAD_AMOUNT} at a time`);
  for (const size of ['standard', 'large'] as const) {
    let s = newBattle(`ore-${size}`, size, 2, 'ffa', 'plains', false);
    const bed = oreBed(s)!;
    ok(!!bed && bed.length > 0, `${size}: the ore bed is known`);
    let same = bed.length === s.ore.filter(o => o > 0).length;
    for (const k of bed) if (s.ore[k] <= 0) same = false;
    ok(same, `${size}: the ore bed is exactly where the ore lay at the start`);
    // Work out the middle row of a field: its tiles keep their neighbours' ore either side.
    const field = fieldsOf(s.ore, s.mapW).find(f => f.size >= 12)!;
    const cx = Math.floor(field.x);
    const cy = Math.floor(field.y);
    const k0 = cy * s.mapW + cx;
    ok(s.ore[k0] > 0, `${size}: the field's middle tile holds ore`);
    s = copy(s);
    s.ore[k0] = 0;
    // Somewhere to check a structure stops it: a tile beside it, emptied, with a wall built on it.
    const k1 = bed.find(k => k !== k0 && Math.abs((k % s.mapW) - cx) + Math.abs(((k / s.mapW) | 0) - cy) > 3 && s.ore[k + 1] > 0)!;
    s.ore[k1] = 0;
    addBuilding(s, 0, 'wall', k1 % s.mapW, (k1 / s.mapW) | 0, -100);
    // A tile that never had ore, beside the field, stays empty.
    let outside = -1;
    for (let d = 1; d < 12 && outside < 0; d++) {
      const k = cy * s.mapW + cx + d;
      if (!bed.includes(k) && isWalkable(s.tiles[k])) outside = k;
    }
    const before = s.ore.slice();
    const t0 = s.tick;
    // Up to the next spread pass, then just past it.
    const due = Math.ceil((t0 + 1) / ORE_SPREAD_TICKS) * ORE_SPREAD_TICKS;
    s = run(s, due - t0 - 1);
    ok(s.ore[k0] === 0, `${size}: the worked-out tile is still empty before the pass`);
    s = processAction(s, { type: 'tick', n: 1 });
    if (size === 'standard') {
      ok(s.ore[k0] === 0, 'standard: a worked-out tile never comes back (as before round 5)');
    } else {
      ok(s.ore[k0] === ORE_SPREAD_AMOUNT, `large: the worked-out tile beside ore regains ${ORE_SPREAD_AMOUNT} (${s.ore[k0]})`);
      ok(s.ore[k1] === 0, 'large: never under a structure');
      if (outside >= 0) ok(s.ore[outside] === 0 && before[outside] === 0, 'large: never on ground that held no ore');
      // Then it grows like any ore tile.
      s = processAction(s, { type: 'tick', n: 120 });
      ok(s.ore[k0] > ORE_SPREAD_AMOUNT, 'large: then it grows back like any ore');
    }
  }
  // A whole field worked out but one tile: it spreads back across the field, ring by ring.
  let s = newBattle('ore-field', 'huge', 2, 'ffa', 'plains', false);
  const field = fieldsOf(s.ore, s.mapW).find(f => f.size >= 12)!;
  const tiles: number[] = [];
  const bed = new Set(oreBed(s)!);
  for (const k of bed) if (Math.hypot((k % s.mapW) + 0.5 - field.x, ((k / s.mapW) | 0) + 0.5 - field.y) < 6) tiles.push(k);
  s = copy(s);
  const keep = tiles.reduce((a, k) => (Math.hypot((k % s.mapW) + 0.5 - field.x, ((k / s.mapW) | 0) + 0.5 - field.y) < Math.hypot((a % s.mapW) + 0.5 - field.x, ((a / s.mapW) | 0) + 0.5 - field.y) ? k : a), tiles[0]);
  for (const k of tiles) if (k !== keep) s.ore[k] = 0;
  const count = () => tiles.filter(k => s.ore[k] > 0).length;
  ok(count() === 1, 'huge: a field worked out to its last tile');
  s = run(s, ORE_SPREAD_TICKS * 6);
  ok(count() > tiles.length / 2, `huge: six passes later the field is back over most of its ground (${count()}/${tiles.length})`);
}

// ---- The computer's numbers ---------------------------------------------------------------------

function aiTests(ok: Ok): void {
  const std = newBattle('ai-std', 'standard', 2, 'ffa', 'classic', false);
  for (const d of Object.values(DIFFICULTIES)) ok(scaledFor(std, d) === d, `standard: ${d.label} is the difficulty itself`);
  ok(mapScale(std) === 1 && reserveRadius(std) === 30 && stageDistance(std) === 10, 'standard: the reserve within 30 tiles, the staging point 10 out, as always');
  // Missions never scale: no setup.
  const legacy = createInitialState('ai-legacy', 'x', { seed: 'ai-legacy', createdAt: 0 });
  ok(scaledFor(legacy, DIFFICULTIES.hard) === DIFFICULTIES.hard && reserveRadius(legacy) === 30, 'no setup (missions, old saves): unscaled');
  let prevFirst = DIFFICULTIES.normal.firstAttack;
  for (const size of ['large', 'huge'] as const) {
    const s = newBattle(`ai-${size}`, size, 2, 'ffa', 'classic', false);
    const d = scaledFor(s, DIFFICULTIES.normal);
    ok(mapScale(s) > 1, `${size}: the map is ${mapScale(s)} times a standard one`);
    ok(d.firstAttack > prevFirst, `${size}: the first attack later (${d.firstAttack} ticks)`);
    ok(d.attackInterval > DIFFICULTIES.normal.attackInterval && d.waveCap > DIFFICULTIES.normal.waveCap && d.firstWave > DIFFICULTIES.normal.firstWave, `${size}: waves larger and further apart`);
    ok(d.turrets > DIFFICULTIES.normal.turrets && d.refineries > DIFFICULTIES.normal.refineries, `${size}: more turrets and refineries`);
    ok(reserveRadius(s) > 30 && stageDistance(s) > 10, `${size}: the reserve recruited from further out, the staging point further forward`);
    prevFirst = d.firstAttack;
  }
}

// ---- Whole battles ------------------------------------------------------------------------------

interface Played {
  s: GameState;
  harvested: boolean;
}

function play(ok: Ok, s: GameState, label: string): Played {
  invariants(ok, s, `${label}@0`);
  const cap = capFor(s.setup);
  let n = 0;
  while (s.winner === null && s.tick < cap) {
    const before = n % 100 === 0 ? JSON.stringify(s) : null;
    const next = processAction(s, { type: 'tick', n: 100 });
    if (before) ok(JSON.stringify(s) === before, `${label}: a tick does not change its input`);
    s = next;
    n++;
    if (s.tick % 6000 === 0) invariants(ok, s, `${label}@${s.tick}`);
  }
  invariants(ok, s, `${label}@end`);
  return { s, harvested: s.players.every(p => p.stats.harvested > 0) };
}

function battleTests(ok: Ok): void {
  // Kept short for the 60 seconds: four large two-sided battles and a huge four-sided one. The
  // length comparison needs the four: single battles vary from 18 to 84 game minutes, and two seeds
  // once read as shorter than standard. Huge two-sided battles run 30 to 85 game minutes; the
  // replay section plays one for ten minutes, and scripts/long-games.ts plays many.
  const plan: [string, MapSize, 2 | 4, SideMode][] = [
    ['big-1', 'large', 2, 'ffa'],
    ['big-2', 'large', 2, 'ffa'],
    ['big-3', 'large', 2, 'ffa'],
    ['big-4', 'large', 2, 'ffa'],
    ['big-4', 'huge', 4, 'teams'],
  ];
  const runs: { size: MapSize; sides: number; minutes: number; done: boolean }[] = [];
  const lines: string[] = [];
  for (const [seed, size, sides, mode] of plan) {
    const label = `${size}, ${sides} sides ${mode === 'teams' ? 'teams' : 'free for all'}`;
    const { s, harvested } = play(ok, newBattle(seed, size, sides, mode), `${seed} ${label}`);
    ok(harvested, `${label}: every side harvested ore`);
    ok(s.players.some(p => p.stats.killed > 0), `${label}: there was fighting`);
    if (s.winner !== null) ok(s.buildings.some(b => isStructure(b) && s.teams[b.owner] === s.teams[s.winner!]), `${label}: the winning team still has a structure`);
    runs.push({ size, sides, minutes: s.tick / 600, done: s.winner !== null });
    lines.push(`    ${label}, ${s.mapType}: ${s.winner === null ? 'unfinished' : `side ${s.winner} in ${Math.round(s.tick / 600)} min`}`);
  }
  // The same seeds at standard size, for the comparison.
  let std = 0;
  for (const [seed] of plan.filter(p => p[2] === 2)) {
    const { s } = play(ok, newBattle(seed, 'standard', 2, 'ffa'), `${seed} standard`);
    std += s.tick / 600;
  }
  std /= plan.filter(p => p[2] === 2).length;
  const two = runs.filter(r => r.sides === 2);
  const big = two.reduce((a, r) => a + r.minutes, 0) / two.length;
  const finished = runs.filter(r => r.done).length;
  ok(finished >= Math.ceil(runs.length * 0.8), `at least 80% of battles on larger maps finish within the cap (${finished}/${runs.length})`);
  ok(big > std, `two-sided battles on larger maps run longer than at standard size (${big.toFixed(1)} against ${std.toFixed(1)} minutes)`);
  console.log(`  ${finished}/${runs.length} finished; two sides average ${big.toFixed(1)} game minutes on larger maps, ${std.toFixed(1)} on standard with the same seeds`);
  for (const l of lines) console.log(l);
}

function replayTests(ok: Ok): void {
  // A huge battle played twice is byte-identical, and a save of it plays on exactly.
  const t = () => {
    const s = newBattle('replay-huge', 'huge', 2);
    return run(s, 6000);
  };
  const a = t();
  ok(a.tick === 6000 && a.units.length > 6, 'a huge battle: ten minutes played');
  ok(JSON.stringify(a) === JSON.stringify(t()), 'a huge battle played twice is byte-identical (ten minutes)');
  const loaded = migrateState(copy(a));
  ok(loaded !== null && loaded.setup?.size === 'huge', 'a huge save loads, still huge');
  if (loaded) ok(JSON.stringify(run(loaded, ORE_SPREAD_TICKS * 2)) === JSON.stringify(run(a, ORE_SPREAD_TICKS * 2)), 'a huge save plays on exactly, ore spreading included');
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Larger maps: the size option', sizeTests],
  ['Larger maps: maps at large and huge', mapTests],
  ['Larger maps: ore spreading back', oreTests],
  ['Larger maps: the computer\'s numbers', aiTests],
  ['Larger maps: replay and saves', replayTests],
  ['Larger maps: whole battles', battleTests],
];
