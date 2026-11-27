/**
 * Vast maps (2026-11-22): the size, the ravines and ruined cities the generators lay on it, the new
 * ground's rules (streets and bridges walkable, nothing built on a bridge), packed saves, the
 * computer's damped numbers, and a vast battle replayed and carried through a save. Its sections run
 * inside scripts/drive.ts and count in its totals. Whole vast battles to the finish are long (an
 * hour of game time or more); scripts/long-games.ts plays them.
 */
import { processAction } from '../src/sim/actions';
import { ATTACK_INTERVAL_CAP, FIRST_ATTACK_CAP, mapScale, scaledFor, SURPLUS_BARRACKS, SURPLUS_CREDITS, SURPLUS_FACTORIES, surplusOn, VAST_SCALE_RATE } from '../src/sim/aiScale';
import { placementProblem } from '../src/sim/commands';
import { findPath, occupancy, passable } from '../src/sim/grid';
import { RAVINE_BRIDGE_GAP, carveTile } from '../src/sim/hazards';
import { isWalkable } from '../src/sim/map';
import { generateSkirmishMap, mapProblem, sidesProblem, MAX_ORE_FIELDS_VAST } from '../src/sim/maps';
import { packNumbers, packState, packText, packsState, unpackNumbers, unpackText } from '../src/sim/pack';
import { seedFromString } from '../src/sim/rng';
import {
  DIFFICULTIES,
  MAP_SIZE_BLURBS,
  MAP_SIZE_FOR,
  MAP_SIZE_NAMES,
  MAP_SIZE_TILES,
  MAP_SIZES,
  MAP_TILES_MAX,
  MAP_TILES_MAX_BALANCED,
  MAP_TYPES,
  SITES_PER_SIDE,
  UNITS,
  sizeHasHazards,
  type MapSize,
  type SideMode,
} from '../src/sim/rules';
import { countBuildings, createInitialState, migrateState, normaliseSetup } from '../src/sim/state';
import type { GameState } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

/** The portal's limit on one save (shared/portal/server/saves.ts, MAX_SAVE_BYTES). */
const MAX_SAVE_BYTES = 512 * 1024;
const HAZARD_TILES = ['v', 'b', 'x', 'p'];
const KNOWN_TILES = new Set(['g', 'd', 'w', 'r', 't', ...HAZARD_TILES]);

const copy = (s: unknown): GameState => JSON.parse(JSON.stringify(s));
function run(s: GameState, n: number): GameState {
  while (n > 0 && s.winner === null) {
    const k = Math.min(600, n);
    s = processAction(s, { type: 'tick', n: k });
    n -= k;
  }
  return s;
}
function newBattle(seed: string, size: MapSize, sides: 2 | 3 | 4 = 2, mode: SideMode = 'ffa', map: (typeof MAP_TYPES)[number] | 'random' = 'random', autopilot = true): GameState {
  return createInitialState(`vast-${seed}`, seed, { seed, difficulty: 'normal', createdAt: 0, autopilot, setup: { map, tech: 'advanced', sides, mode, size, sites: true } });
}

// ---- The size ------------------------------------------------------------------------------------

function sizeTests(ok: Ok): void {
  // 2026-11-27: Continental follows vast as the largest (drive-continental.ts).
  ok(MAP_SIZES[MAP_SIZES.length - 2] === 'vast' && MAP_SIZES[MAP_SIZES.length - 1] === 'continental' && MAP_SIZE_NAMES.vast === 'Vast' && MAP_SIZE_BLURBS.vast.length > 0, 'vast: the size before Continental, named and described');
  for (const n of [2, 3, 4] as const) {
    ok(MAP_SIZE_TILES.vast[n] === 2 * MAP_SIZE_TILES.huge[n], `vast, ${n} sides: twice as wide as huge, four times the ground (${MAP_SIZE_TILES.vast[n]} tiles)`);
    ok(MAP_SIZE_TILES.vast[n] <= MAP_TILES_MAX, `vast, ${n} sides: within MAP_TILES_MAX`);
    ok(MAP_SIZE_TILES.huge[n] <= MAP_TILES_MAX_BALANCED && MAP_SIZE_TILES.vast[n] > MAP_TILES_MAX_BALANCED, `${n} sides: huge is a balanced size, vast is beyond it`);
  }
  ok(MAP_SIZES.every(z => sizeHasHazards(z) === (z === 'vast' || z === 'continental')), 'only vast and Continental maps carry ravines and ruined cities');
  ok(normaliseSetup({ size: 'vast' }).size === 'vast' && normaliseSetup({ size: 'Vast' as MapSize }).size === 'standard', 'normaliseSetup keeps vast and refuses anything like it');
  for (const kind of ['derrick', 'hospital', 'relay'] as const) ok(SITES_PER_SIDE.vast[kind] >= SITES_PER_SIDE.huge[kind], `vast: at least as many ${kind} sites a side as huge`);
}

// ---- The maps ------------------------------------------------------------------------------------

function mapTests(ok: Ok): void {
  const PER = 2;
  const totals: Record<string, number> = { v: 0, b: 0, x: 0, p: 0, all: 0 };
  let maps = 0;
  for (const n of [2, 3, 4] as const)
    for (const type of MAP_TYPES)
      for (let i = 0; i < PER; i++) {
        const seed = seedFromString(`vast-${n}-${type}-${i}`);
        const m = generateSkirmishMap(seed, type, i === 0 ? 'normal' : 'rich', n, 'vast');
        const S = MAP_SIZE_TILES.vast[n];
        const label = `vast, ${n} sides, ${type} #${i}`;
        maps++;
        const p = n === 2 ? mapProblem(m) : sidesProblem(m);
        ok(p === null, `${label}: passes the generator's checks (${p})`);
        ok(m.w === S && m.h === S && m.tiles.length === S * S, `${label}: ${S} tiles square`);
        const count: Record<string, number> = { v: 0, b: 0, x: 0, p: 0 };
        let unknown = 0;
        let oreOnHazard = 0;
        for (let k = 0; k < m.tiles.length; k++) {
          const c = m.tiles[k];
          if (!KNOWN_TILES.has(c)) unknown++;
          if (c in count) count[c]++;
          if (m.ore[k] > 0 && c !== 'g' && c !== 'd') oreOnHazard++;
        }
        for (const c of HAZARD_TILES) totals[c] += count[c];
        totals.all += m.tiles.length;
        ok(unknown === 0, `${label}: every tile is a known ground`);
        ok(oreOnHazard === 0, `${label}: ore only on grass and dirt`);
        ok(count.x > 0 && count.p > 0, `${label}: ruins and streets (${count.x}, ${count.p})`);
        // Every bridge is over a ravine and joins ground: each group of bridge tiles touches a
        // ravine and touches walkable ground that is not a bridge.
        const seen = new Uint8Array(S * S);
        let dangling = 0;
        let groups = 0;
        for (let k = 0; k < S * S; k++) {
          if (m.tiles[k] !== 'b' || seen[k]) continue;
          groups++;
          let ravine = false;
          let land = 0;
          const q = [k];
          seen[k] = 1;
          while (q.length) {
            const c = q.pop()!;
            const x = c % S;
            const y = (c / S) | 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
              const nk = ny * S + nx;
              const t = m.tiles[nk];
              if (t === 'v') ravine = true;
              else if (t === 'b' && !seen[nk]) {
                seen[nk] = 1;
                q.push(nk);
              } else if (t !== 'b' && isWalkable(t)) land++;
            }
          }
          if (!ravine || land === 0) dangling++;
        }
        ok(dangling === 0, `${label}: every bridge (${groups}) spans a ravine and joins ground`);
        // The bases' ground is clear of hazards: nothing but open ground within 8 tiles of a yard.
        let near = 0;
        for (const st of m.starts)
          for (let y = st.y - 7; y <= st.y + 9; y++)
            for (let x = st.x - 7; x <= st.x + 9; x++) if (x >= 0 && y >= 0 && x < S && y < S && (m.tiles[y * S + x] === 'v' || m.tiles[y * S + x] === 'x')) near++;
        ok(near === 0, `${label}: no ravine or ruin by a base`);
        if (i === 0 && (type === 'classic' || type === 'canyon')) ok(JSON.stringify(generateSkirmishMap(seed, type, 'normal', n, 'vast')) === JSON.stringify(m), `${label}: the same seed draws the same map`);
      }
  const share = (c: string) => (100 * totals[c]) / totals.all;
  ok(totals.v > 0 && totals.b > 0, `vast maps have ravines and bridges (${share('v').toFixed(1)}% and ${share('b').toFixed(1)}% of the ground)`);
  console.log(`    ${maps} vast maps: ravine ${share('v').toFixed(1)}%, bridge ${share('b').toFixed(2)}%, ruins ${share('x').toFixed(1)}%, streets ${share('p').toFixed(1)}% of all tiles; at most ${MAX_ORE_FIELDS_VAST} ore fields a two-sided map`);
  // The balanced sizes never see the new ground.
  for (const size of ['standard', 'large', 'huge'] as const)
    for (const n of [2, 4] as const) {
      const m = generateSkirmishMap(seedFromString(`plain-${size}-${n}`), 'classic', 'normal', n, size);
      ok(![...m.tiles].some(c => HAZARD_TILES.includes(c)), `${size}, ${n} sides: no ravines, ruins, streets or bridges`);
    }
  // A track keeps what it crosses passable.
  ok(carveTile('g') === 'g' && carveTile('t') === 'd' && carveTile('w') === 'd' && carveTile('r') === 'd', 'a track: grass stays, anything else is dirt, as before');
  ok(carveTile('v') === 'b' && carveTile('b') === 'b' && carveTile('x') === 'p' && carveTile('p') === 'p', 'a track over a ravine is a bridge, through ruins a street');
  ok(RAVINE_BRIDGE_GAP > 0 && RAVINE_BRIDGE_GAP < 40, `ravines are bridged every ${RAVINE_BRIDGE_GAP} tiles along their length`);
}

// ---- The new ground in play ----------------------------------------------------------------------

function groundTests(ok: Ok): void {
  ok(isWalkable('p') && isWalkable('b') && !isWalkable('v') && !isWalkable('x'), 'streets and bridges are walkable; ravines and ruins are not');
  const s = newBattle('ground', 'vast', 2, 'ffa', 'plains', false);
  const occ = occupancy(s);
  const W = s.mapW;
  const first = (c: string) => s.tiles.indexOf(c);
  for (const [c, want] of [['p', true], ['b', true], ['v', false], ['x', false]] as const) {
    const k = first(c);
    ok(k >= 0, `the vast map has a '${c}' tile`);
    if (k >= 0) {
      ok(passable(s, occ, k % W, (k / W) | 0) === want, `'${c}': ${want ? 'passable' : 'impassable'} to ground units`);
      ok(!passable(s, occ, k % W, (k / W) | 0, true), `'${c}': no ship sails it`);
    }
  }
  const bk = first('b');
  if (bk >= 0) ok(placementProblem(s, 0, 'wall', bk % W, (bk / W) | 0, occ) === 'Cannot build on a bridge', 'nothing is built on a bridge');
  const pk = first('p');
  if (pk >= 0) {
    const why = placementProblem(s, 0, 'wall', pk % W, (pk / W) | 0, occ);
    ok(why !== 'Ground is not clear' && why !== 'Cannot build on a bridge', `a street is ground to build on (${why ?? 'buildable'})`);
  }
  // Across a ravine by its bridge: from the ground at one end of a bridge to the other.
  let crossed = false;
  for (let k = 0; k < s.tiles.length && !crossed; k++) {
    if (s.tiles[k] !== 'b') continue;
    const x = k % W;
    const y = (k / W) | 0;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      // Walk along the bridge both ways to the ground at its ends.
      let a = 0;
      while (s.tiles[(y - dy * (a + 1)) * W + x - dx * (a + 1)] === 'b') a++;
      let b = 0;
      while (s.tiles[(y + dy * (b + 1)) * W + x + dx * (b + 1)] === 'b') b++;
      const from = (y - dy * (a + 1)) * W + x - dx * (a + 1);
      const to = (y + dy * (b + 1)) * W + x + dx * (b + 1);
      const sideA = s.tiles[(y + dx) * W + x + dy];
      if (a + b < 1 || sideA !== 'v' || !isWalkable(s.tiles[from]) || !isWalkable(s.tiles[to]) || s.tiles[from] === 'b' || s.tiles[to] === 'b') continue;
      const path = findPath(s, occ, from, to);
      crossed = path.length > 0 && path[path.length - 1] === to;
    }
  }
  ok(crossed, 'a unit walks across a ravine by its bridge');
  // Paths reach across the largest map.
  const big = newBattle('reach', 'vast', 4, 'teams', 'plains', false);
  const occ4 = occupancy(big);
  const a = big.starts![0];
  const b = big.starts![1];
  const goal = (b.y - 2) * big.mapW + b.x + 1;
  const path = findPath(big, occ4, (a.y + 4) * big.mapW + a.x + 1, goal);
  const end = path[path.length - 1];
  ok(path.length > 0 && Math.hypot((end % big.mapW) - (b.x + 1), ((end / big.mapW) | 0) - (b.y - 2)) < 3, `a ${big.mapW}-tile map: a path from one corner base reaches the opposite one`);
}

// ---- Packed saves --------------------------------------------------------------------------------

function packTests(ok: Ok): void {
  for (const t of ['', 'g', 'gggdddw', '0000111110', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'.repeat(50)]) ok(unpackText(packText(t)) === t, `packText round trip (${t.length} characters)`);
  for (const xs of [[], [0], [0, 0, 0, 500, 500, 30, 0], [7, 7, 7, 7, 1234567, 0]]) ok(JSON.stringify(unpackNumbers(packNumbers(xs))) === JSON.stringify(xs), `packNumbers round trip (${xs.length} numbers)`);
  ok(unpackText('g0') === null && unpackText('g') === null && unpackNumbers('1*0') === null && unpackNumbers('z*') === null, 'junk runs are refused');
  // A huge battle is never packed: its save is exactly what it was.
  const huge = newBattle('pack-huge', 'huge', 4, 'teams', 'classic', false);
  ok(!packsState(huge) && packState(huge) === huge, 'a huge battle is saved as it is, unpacked');
  for (const n of [2, 3, 4] as const) {
    const s = newBattle(`pack-${n}`, 'vast', n, n === 4 ? 'teams' : 'ffa', 'classic', false);
    const raw = JSON.stringify(s).length;
    const packed = JSON.stringify(packState(s));
    ok(packsState(s) && JSON.parse(packed).packed === 1, `vast, ${n} sides: packed`);
    ok(packed.length < raw / 3 && packed.length < MAX_SAVE_BYTES / 4, `vast, ${n} sides: the save is ${(packed.length / 1024).toFixed(0)} KB packed, ${(raw / 1024).toFixed(0)} KB raw`);
    const back = migrateState(JSON.parse(packed));
    ok(back !== null && JSON.stringify(back) === JSON.stringify(migrateState(copy(s))), `vast, ${n} sides: a packed save loads to exactly the battle`);
  }
  // A packed save that does not unpack to its own map is refused, not loaded half-made.
  const s = newBattle('pack-junk', 'vast', 2, 'ffa', 'plains', false);
  const good = JSON.parse(JSON.stringify(packState(s)));
  ok(migrateState({ ...good, tiles: good.tiles + ',g5' }) === null, 'a packed save with too many tiles is refused');
  ok(migrateState({ ...good, ore: '0*3' }) === null, 'a packed save with too little ore is refused');
  ok(migrateState({ ...good, packed: 2 }) === null, 'a packed save of an unknown format is refused');
  ok(migrateState({ ...good, explored: 7 }) === null, 'a packed save with a junk field is refused');
}

// ---- The computer's numbers ----------------------------------------------------------------------

function aiTests(ok: Ok): void {
  for (const n of [2, 4] as const) {
    const huge = newBattle(`ai-huge-${n}`, 'huge', n, n === 4 ? 'teams' : 'ffa', 'classic', false);
    const vast = newBattle(`ai-vast-${n}`, 'vast', n, n === 4 ? 'teams' : 'ffa', 'classic', false);
    const knee = MAP_SIZE_TILES.huge[n] / MAP_SIZE_FOR[n];
    const raw = MAP_SIZE_TILES.vast[n] / MAP_SIZE_FOR[n];
    ok(Math.abs(mapScale(huge) - knee) < 1e-9, `huge, ${n} sides: scale ${knee.toFixed(2)}, unchanged`);
    ok(Math.abs(mapScale(vast) - (knee + (raw - knee) * VAST_SCALE_RATE)) < 1e-9, `vast, ${n} sides: scale ${mapScale(vast).toFixed(2)}, damped from ${raw.toFixed(2)}`);
    const h = scaledFor(huge, DIFFICULTIES.normal);
    const v = scaledFor(vast, DIFFICULTIES.normal);
    // 2026-11-27: the patience cap (aiScale.ts) holds the first attack to FIRST_ATTACK_CAP times the
    // difficulty's own and the interval to ATTACK_INTERVAL_CAP, so vast is no later than that.
    ok(
      v.firstAttack >= h.firstAttack && v.firstAttack <= Math.round(DIFFICULTIES.normal.firstAttack * FIRST_ATTACK_CAP) && v.attackInterval <= Math.round(DIFFICULTIES.normal.attackInterval * ATTACK_INTERVAL_CAP) && v.turrets >= h.turrets && v.waveCap >= h.waveCap,
      `vast, ${n} sides: a first attack no earlier than huge's and within the patience cap, and at least huge's forces`,
    );
    ok(vast.ai.every(a => a.nextAttack === v.firstAttack), `vast, ${n} sides: every commander's first attack set for the size (${v.firstAttack})`);
  }
}

// ---- Surplus production ----------------------------------------------------------------------------

function surplusTests(ok: Ok): void {
  const std = newBattle('surplus-std', 'standard', 2, 'ffa', 'plains');
  const large = newBattle('surplus-large', 'large', 2, 'ffa', 'plains');
  ok(!surplusOn(std, 1e6), 'standard maps: no surplus production, however rich (balanced as they are)');
  ok(surplusOn(large, SURPLUS_CREDITS) && !surplusOn(large, SURPLUS_CREDITS - 1), `larger maps: surplus production from ${SURPLUS_CREDITS} credits banked`);
  ok(!surplusOn({ ...large, mission: {} as GameState['mission'] }, 1e6), 'never in a campaign mission');
  // A commander handed a fortune builds more producers on a large map, and not on a standard one.
  const rich = (s: GameState) => {
    s = run(s, 6000);
    s = copy(s);
    s.players[1].credits = 60000;
    return run(s, 3600);
  };
  const plan = DIFFICULTIES.normal.factories;
  const a = rich(large);
  ok(countBuildings(a, 1, 'factory') > plan, `large map, 60,000 credits banked: ${countBuildings(a, 1, 'factory')} factories, past the plan's ${plan}`);
  ok(countBuildings(a, 1, 'factory') <= Math.max(1, plan) + SURPLUS_FACTORIES && countBuildings(a, 1, 'barracks') <= 1 + SURPLUS_BARRACKS, 'and never more than the surplus allows');
  const b = rich(std);
  ok(countBuildings(b, 1, 'factory') <= plan, `standard map, 60,000 credits banked: ${countBuildings(b, 1, 'factory')} factory, the plan's own`);
}

// ---- Replay and saves ----------------------------------------------------------------------------

function replayTests(ok: Ok): void {
  const t = () => run(newBattle('replay-vast', 'vast', 2), 6000);
  const a = t();
  ok(a.tick === 6000 && a.units.length > 6, 'a vast battle: ten minutes played');
  ok(a.players.every(p => p.stats.harvested > 0), 'a vast battle: every side harvesting');
  ok(JSON.stringify(a) === JSON.stringify(t()), 'a vast battle played twice is byte-identical (ten minutes)');
  const saved = JSON.stringify(packState(a));
  ok(saved.length < MAX_SAVE_BYTES, `a vast battle ten minutes in saves in ${(saved.length / 1024).toFixed(0)} KB`);
  const loaded = migrateState(JSON.parse(saved));
  ok(loaded !== null && loaded.setup?.size === 'vast' && loaded.tiles === a.tiles, 'a packed vast save loads, still vast, the same ground');
  if (loaded) ok(JSON.stringify(run(loaded, 1200)) === JSON.stringify(run(a, 1200)), 'a packed vast save plays on exactly');
  // Units walk the new ground: somebody stands on a street or a bridge at some point.
  let s = newBattle('walkers', 'vast', 2, 'ffa', 'plains');
  let onNew = false;
  for (let i = 0; i < 40 && !onNew && s.winner === null; i++) {
    s = processAction(s, { type: 'tick', n: 300 });
    onNew = s.units.some(u => {
      const c = s.tiles[Math.floor(u.y) * s.mapW + Math.floor(u.x)];
      return c === 'p' || c === 'b';
    });
  }
  ok(onNew, 'in a vast battle, units walk the streets or cross the bridges');
  let stuck = 0;
  for (const u of s.units) {
    const c = s.tiles[Math.floor(u.y) * s.mapW + Math.floor(u.x)];
    const cat = UNITS[u.kind].category;
    if (cat !== 'air' && cat !== 'naval' && (c === 'v' || c === 'x')) stuck++;
  }
  ok(stuck === 0, `no ground unit stands in a ravine or a ruin (${stuck})`);
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Vast maps: the size', sizeTests],
  ['Vast maps: ravines and ruined cities', mapTests],
  ['Vast maps: the new ground in play', groundTests],
  ['Vast maps: packed saves', packTests],
  ['Vast maps: the computer\'s numbers', aiTests],
  ['Larger maps: surplus production', surplusTests],
  ['Vast maps: replay and saves', replayTests],
];
