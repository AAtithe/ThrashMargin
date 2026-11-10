/**
 * Long games on larger maps (fireline-round5-design.md, workstream B): the sweep that is too long
 * for npm run drive:fire. Whole computer battles (Normal against Normal, advanced tech, map drawn
 * by the seed) at every size, two sides and four as teams, with how many finish within the
 * harness's cap, how long they run and whether every side harvested; and, with --maps, the
 * fairness of the larger maps over 20 seeds of every type.
 *
 *   tsx scripts/long-games.ts                     8 seeds of each kind of battle
 *   tsx scripts/long-games.ts --seeds 20
 *   tsx scripts/long-games.ts --maps              the map sweep only
 *
 * Standard size is played too, with the same seeds, for the comparison.
 */
import { processAction } from '../src/sim/actions';
import { fieldsOf, generateSkirmishMap, mapProblem, sidesFairness, spreadOf } from '../src/sim/maps';
import { seedFromString } from '../src/sim/rng';
import { MAP_SIZE_TILES, MAP_SIZES, MAP_TYPES, type MapSize, type SideMode, type SkirmishSetup } from '../src/sim/rules';
import { createInitialState } from '../src/sim/state';
import type { GameState } from '../src/sim/types';

const args = process.argv.slice(2);
const arg = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const SEEDS = Number(arg('seeds', '8'));

/** The harness's tick cap (as in drive.ts): 45000 standard, 72000 large, 108000 huge. */
const capFor = (setup?: Partial<SkirmishSetup>): number => (setup?.size === 'huge' ? 108000 : setup?.size === 'large' ? 72000 : 45000);

function battle(seed: string, size: MapSize, sides: 2 | 4, mode: SideMode): GameState {
  const setup: Partial<SkirmishSetup> = { map: 'random', tech: 'advanced', sides, mode, size };
  let s = createInitialState(`long-${seed}`, seed, { seed, difficulty: 'normal', createdAt: 0, autopilot: true, setup });
  const cap = capFor(setup);
  while (s.winner === null && s.tick < cap) s = processAction(s, { type: 'tick', n: 200 });
  return s;
}

function battles(): void {
  console.log(`Whole battles, Normal against Normal, advanced tech, ${SEEDS} seeds each`);
  for (const [sides, mode] of [
    [2, 'ffa'],
    [4, 'teams'],
  ] as [2 | 4, SideMode][]) {
    for (const size of MAP_SIZES) {
      const t0 = Date.now();
      const rows = Array.from({ length: SEEDS }, (_, i) => battle(`long-${sides}-${i + 1}`, size, sides, mode));
      const done = rows.filter(s => s.winner !== null);
      const mins = done.map(s => s.tick / 600).sort((a, b) => a - b);
      const avg = mins.reduce((a, b) => a + b, 0) / Math.max(1, mins.length);
      const median = mins.length ? mins[Math.floor(mins.length / 2)] : 0;
      const harvested = rows.filter(s => s.players.every(p => p.stats.harvested > 0)).length;
      console.log(
        `  ${sides === 2 ? 'two sides' : 'four sides, teams'}, ${size} (${MAP_SIZE_TILES[size][sides]} tiles): ${done.length}/${rows.length} finished within ${capFor({ size }) / 600} min; ` +
          `average ${avg.toFixed(1)} min, median ${median.toFixed(1)}, longest ${(mins[mins.length - 1] ?? 0).toFixed(1)}; every side harvested in ${harvested}/${rows.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
      );
    }
  }
}

function maps(): void {
  const PER = 20;
  console.log(`Maps, ${PER} seeds of every type`);
  for (const size of MAP_SIZES)
    for (const n of [2, 3, 4] as const) {
      let problems = 0;
      let fields = 0;
      const worst = { ground: 0, ore: 0, walk: 0 };
      const t0 = Date.now();
      for (const type of MAP_TYPES)
        for (let i = 0; i < PER; i++) {
          const m = generateSkirmishMap(seedFromString(`sweep-${size}-${n}-${type}-${i}`), type, 'normal', n, size);
          if (mapProblem(m)) problems++;
          fields += fieldsOf(m.ore, m.w).filter(f => f.size >= 5).length;
          if (n > 2) {
            const f = sidesFairness(m);
            const pairs: number[] = [];
            for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) pairs.push(f.walk[a][b]);
            worst.ground = Math.max(worst.ground, spreadOf(f.ground));
            worst.ore = Math.max(worst.ore, spreadOf(f.homeOre));
            // Four sides: neighbours and the side across the map are different walks by design.
            if (n === 3) worst.walk = Math.max(worst.walk, spreadOf(pairs));
          }
        }
      const total = PER * MAP_TYPES.length;
      console.log(
        `  ${size}, ${n} sides (${MAP_SIZE_TILES[size][n]} tiles): ${total} maps, ${problems} problems, ${(fields / total).toFixed(1)} ore fields a map` +
          (n === 2
            ? '; point-symmetric, so every difference is 0'
            : `; largest spread between sites: buildable ground ${(worst.ground * 100).toFixed(1)}%, home ore ${(worst.ore * 100).toFixed(1)}%, walking distance ${n === 3 ? `${(worst.walk * 100).toFixed(1)}%` : 'the same by the quarter turn'}`) +
          ` (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
      );
    }
}

if (args.includes('--maps')) maps();
else battles();
