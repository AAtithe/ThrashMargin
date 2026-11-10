/**
 * How long one tick of the simulation takes late in a big battle (fireline-round5-design.md,
 * workstream B). Headless: a computer battle, advanced tech, played in 50-tick steps up to the
 * start of the window, then one tick per processAction call through the window, each call timed.
 * Prints the median, the 95th and 99th percentiles and the worst, plus what was on the field.
 *
 *   tsx scripts/perf-fire.ts                         four sides on huge, minutes 20 to 30, then the same at standard size
 *   tsx scripts/perf-fire.ts --size large --sides 2  one size and side count only
 *   tsx scripts/perf-fire.ts --from 20 --to 30 --seed perf-1 --mode teams
 *   tsx scripts/perf-fire.ts --dump late.json --to 25  a late-game huge battle saved as JSON (perf-render.cjs loads it)
 *
 * The client runs ten ticks a second, so a median under 4 ms and a 99th percentile under 25 ms
 * leave the frame its budget. Times are wall-clock on this machine: compare runs on one machine.
 */
import { writeFileSync } from 'node:fs';
import { processAction } from '../src/sim/actions';
import { MAP_SIZES, type MapSize, type SideMode } from '../src/sim/rules';
import { createInitialState } from '../src/sim/state';
import type { GameState } from '../src/sim/types';

const args = process.argv.slice(2);
const arg = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const FROM = Number(arg('from', '20'));
const TO = Number(arg('to', '30'));
const SEED = arg('seed', 'perf-1');
const MODE = arg('mode', 'teams') as SideMode;

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

export function measure(size: MapSize, sides: 2 | 3 | 4, from = FROM, to = TO, seed = SEED): boolean {
  let s: GameState = createInitialState(`perf-${seed}`, seed, {
    seed,
    difficulty: 'normal',
    createdAt: 0,
    autopilot: true,
    setup: { map: 'random', tech: 'advanced', sides, mode: sides > 2 ? MODE : 'ffa', size },
  });
  const start = from * 600;
  const end = to * 600;
  const t0 = performance.now();
  while (s.winner === null && s.tick < start) s = processAction(s, { type: 'tick', n: 50 });
  const warm = performance.now() - t0;
  const times: number[] = [];
  let peakUnits = 0;
  if (s.winner !== null) {
    console.log(`${size}, ${sides} sides, seed ${seed}: the battle ended at minute ${(s.tick / 600).toFixed(1)}, before the window`);
    return false;
  }
  while (s.winner === null && s.tick < end) {
    const a = performance.now();
    s = processAction(s, { type: 'tick', n: 1 });
    times.push(performance.now() - a);
    peakUnits = Math.max(peakUnits, s.units.length);
  }
  times.sort((a, b) => a - b);
  const label = `${size}, ${sides} sides, seed ${seed} (${s.mapW} tiles, ${s.mapType})`;
  console.log(
    `${label}: ${times.length} ticks from minute ${from}; median ${percentile(times, 0.5).toFixed(2)} ms, ` +
      `p95 ${percentile(times, 0.95).toFixed(2)} ms, p99 ${percentile(times, 0.99).toFixed(2)} ms, worst ${times[times.length - 1].toFixed(1)} ms; ` +
      `up to ${peakUnits} units, ${s.buildings.length} structures at the end; first ${from} minutes took ${(warm / 1000).toFixed(1)} s`,
  );
  return true;
}

/** The first of a few seeds whose battle lasts into the window. */
function measureSome(size: MapSize, sides: 2 | 3 | 4): void {
  for (let i = 1; i <= 8; i++) if (measure(size, sides, FROM, TO, i === 1 ? SEED : `${SEED}-${i}`)) return;
}

/** Plays a four-sided huge battle (teams) to minute `to` and writes the state, for the browser measurement. */
function dump(file: string): void {
  for (let i = 1; i <= 8; i++) {
    const seed = i === 1 ? SEED : `${SEED}-${i}`;
    let s: GameState = createInitialState('perf-render', 'Late huge battle', {
      seed,
      difficulty: 'normal',
      createdAt: 0,
      autopilot: true,
      setup: { map: 'random', tech: 'advanced', sides: 4, mode: MODE, size: (arg('size', 'huge') as MapSize) },
    });
    while (s.winner === null && s.tick < TO * 600) s = processAction(s, { type: 'tick', n: 50 });
    if (s.winner !== null) continue;
    // The player takes over side 0 in the browser.
    s = { ...s, autopilot: false };
    writeFileSync(file, JSON.stringify(s));
    console.log(`wrote ${file}: minute ${(s.tick / 600).toFixed(1)}, ${s.units.length} units, ${s.buildings.length} structures, ${s.mapW} tiles`);
    return;
  }
  throw new Error('no seed lasted long enough');
}

const isMain = process.argv[1] && /perf-fire\.(ts|js|cjs)$/.test(process.argv[1]);
if (isMain && args.includes('--dump')) dump(arg('dump', 'late.json'));
else if (isMain) {
  const only = args.includes('--size') || args.includes('--sides');
  if (only) {
    const size = arg('size', 'huge') as MapSize;
    if (!MAP_SIZES.includes(size)) throw new Error(`unknown size ${size}`);
    measureSome(size, Number(arg('sides', '4')) as 2 | 3 | 4);
  } else {
    measureSome('huge', 4);
    measureSome('standard', 4);
  }
}
