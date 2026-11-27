/**
 * Bigger maps (2026-11-27): the Continental size, two-level routes over regions (src/sim/regions.ts)
 * and saves that keep a Continental map's ground as its seed (src/sim/pack.ts). Its sections run
 * inside scripts/drive.ts; the replay is deep-only (DEEP_SECTIONS).
 */
import { createHash } from 'node:crypto';
import { processAction } from '../src/sim/actions';
import { findRoute, occupancy } from '../src/sim/grid';
import { isWalkable } from '../src/sim/map';
import { generateSkirmishMap, mapProblem, sidesProblem } from '../src/sim/maps';
import { packState, textSum } from '../src/sim/pack';
import { LONG_ROUTE, REGION, coarseFor } from '../src/sim/regions';
import { seedFromString } from '../src/sim/rng';
import { MAP_SIZE_TILES, MAP_SIZES, MAP_TILES_MAX, MAP_TYPES, sizeHasHazards, type SkirmishSetup } from '../src/sim/rules';
import { createInitialState, migrateState, normaliseSetup } from '../src/sim/state';
import type { GameState } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;
const hash = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const battle = (seed: string, sides: 2 | 3 | 4, size: SkirmishSetup['size'] = 'continental'): GameState =>
  createInitialState(seed, seed, { seed, createdAt: 0, autopilot: true, difficulty: 'normal', setup: { map: 'random', tech: 'advanced', size, sides, mode: 'ffa', credits: 10000, ore: 'rich' } });

function sizeTests(ok: Ok): void {
  ok(MAP_SIZES.includes('continental') && normaliseSetup({ size: 'continental' }).size === 'continental', 'Continental is a size the setup keeps');
  for (const n of [2, 3, 4] as const) ok(MAP_SIZE_TILES.continental[n] > MAP_SIZE_TILES.vast[n] && MAP_SIZE_TILES.continental[n] <= MAP_TILES_MAX, `${n} sides: ${MAP_SIZE_TILES.continental[n]} tiles, wider than vast and within MAP_TILES_MAX`);
  ok(sizeHasHazards('continental'), 'Continental has ravines and ruined cities');
}

function mapTests(ok: Ok): void {
  let built = 0;
  for (const n of [2, 3, 4] as const)
    for (const type of n === 2 ? MAP_TYPES : (['classic', 'plains', 'canyon'] as const))
      for (const seed of ['c1']) {
        const m = generateSkirmishMap(seedFromString(`${seed}-${type}-${n}`), type, 'normal', n, 'continental');
        const problem = n === 2 ? mapProblem(m) : sidesProblem(m);
        ok(problem === null, `continental ${type}, ${n} sides: a legal map (${problem ?? 'ok'})`);
        ok(m.w === MAP_SIZE_TILES.continental[n] && m.tiles.includes('v') && m.tiles.includes('x'), `continental ${type}, ${n} sides: ${m.w} tiles, with ravines and ruins`);
        built++;
      }
  ok(built > 0, `${built} Continental maps built`);
}

function routeTests(ok: Ok): void {
  for (const [size, n] of [['vast', 4], ['continental', 2], ['continental', 4]] as const) {
    const s = battle(`route-${size}-${n}`, n, size);
    const occ = occupancy(s);
    const a = s.starts![0];
    const b = s.starts![n === 2 ? 1 : 2];
    const w = s.mapW;
    let here = (a.y + 4) * w + a.x + 4;
    const goal = (b.y + 4) * w + b.x + 4;
    let legs = 0;
    let leggy = false;
    for (; legs < 80 && here !== goal; legs++) {
      const r = findRoute(s, occ, here, goal);
      if (!r.path.length) break;
      leggy ||= r.leg;
      for (const k of r.path) if (!isWalkable(s.tiles[k])) leggy = false;
      here = r.path[r.path.length - 1];
      if (!r.leg) {
        legs++;
        break;
      }
    }
    ok(here === goal, `${size}, ${n} sides: base to base across ${w} tiles in ${legs} legs, arriving`);
    ok(leggy, `${size}, ${n} sides: the long route went over regions, every waypoint on open ground`);
    const c = coarseFor(s.tiles, s.mapW, s.mapH, Uint8Array.from(s.tiles, ch => (isWalkable(ch) ? 1 : 0)), false);
    ok(c.rep.length >= Math.ceil(w / REGION) ** 2 * 0.5, `${size}, ${n} sides: ${c.rep.length} pieces of ${REGION}-tile regions`);
  }
  // A balanced size never takes a leg: every battle there routes exactly as before.
  const huge = battle('route-huge', 4, 'huge');
  const occ = occupancy(huge);
  const a = huge.starts![0];
  const b = huge.starts![2];
  const r = findRoute(huge, occ, (a.y + 4) * huge.mapW + a.x + 4, (b.y + 4) * huge.mapW + b.x + 4);
  ok(!r.leg && r.path.length > 0, `huge: one search, as before (${r.path.length} waypoints over ${LONG_ROUTE}+ tiles)`);
}

function saveTests(ok: Ok): void {
  const s = battle('cont-save', 4);
  const packed = packState(s) as unknown as { tiles: string; tilesSum?: number; packed?: number };
  ok(packed.packed !== undefined && packed.tiles === '' && packed.tilesSum === textSum(s.tiles), 'a Continental save keeps the ground as its seed and a checksum');
  const kb = JSON.stringify(packed).length / 1024;
  ok(kb < 120, `a new four-sided Continental save is ${kb.toFixed(0)} KB`);
  const back = migrateState(JSON.parse(JSON.stringify(packed)));
  ok(!!back && back.tiles === s.tiles && JSON.stringify(back.ore) === JSON.stringify(s.ore) && back.explored === s.explored, 'it loads with the very ground, ore and explored map');
  const wrong = { ...JSON.parse(JSON.stringify(packed)), tilesSum: (packed.tilesSum! + 1) >>> 0 };
  ok(migrateState(wrong) === null, 'a save whose rebuilt ground does not match its checksum is refused');
  const seedless = { ...JSON.parse(JSON.stringify(packed)), seedText: 7 };
  ok(migrateState(seedless) === null, 'and one with no seed to rebuild from');
  const vast = battle('vast-save', 4, 'vast');
  const vp = packState(vast) as unknown as { tiles: string; tilesSum?: number };
  ok(vp.tiles.length > 0 && vp.tilesSum === undefined, 'a vast save packs its ground as before');
}

function replayTests(ok: Ok): void {
  const play = (saveAt = -1): GameState => {
    let s = battle('cont-replay', 2);
    while (s.tick < 600 * 6) {
      s = processAction(s, { type: 'tick', n: 50 });
      if (s.tick === saveAt) s = migrateState(JSON.parse(JSON.stringify(packState(s))))!;
    }
    return s;
  };
  const a = play();
  ok(a.units.some(u => u.pathLeg) || a.units.length > 0, `six minutes of a Continental battle: ${a.units.length} units`);
  ok(hash(a) === hash(play()) && hash(a) === hash(play(600 * 3)), 'a Continental battle replays byte-identically, and through a packed save');
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Continental: the size', sizeTests],
  ['Continental: maps of every type and side count', mapTests],
  ['Continental: routes over regions', routeTests],
  ['Continental: saves keep the ground as its seed', saveTests],
  ['Continental: replay through a save', replayTests],
];
