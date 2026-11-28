/**
 * Tick time with a Grand War's crowd (G0, fireline-grand-war-design.md). Headless: a four-sided
 * Continental battle with the full economy, played to --from minutes, then each side is given extra
 * fighting units in front of its Command Yard until the field holds --units, and attack-moves half of
 * them at the map's middle. Times one tick per call for --ticks ticks.
 *
 *   tsx scripts/perf-crowd.ts --units 700 --ticks 1200
 *   tsx scripts/perf-crowd.ts --profile crowd.cpuprofile   the timed window only, as a CPU profile
 */
import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { processAction } from '../src/sim/actions';
import { isWalkable } from '../src/sim/map';
import type { Owner, UnitKind } from '../src/sim/rules';
import { addUnit } from '../src/sim/state';
import { grandBattle } from './drive-grand';

const args = process.argv.slice(2);
const arg = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const UNITS_WANTED = Number(arg('units', '700'));
const TICKS = Number(arg('ticks', '1200'));
const FROM = Number(arg('from', '12'));
const KINDS: UnitKind[] = ['rifleman', 'rocketeer', 'tank', 'rifleman', 'buggy', 'artillery'];

async function main(): Promise<void> {
let s = grandBattle(arg('seed', 'crowd-1'));
while (s.winner === null && s.tick < FROM * 600) s = processAction(s, { type: 'tick', n: 50 });
s = JSON.parse(JSON.stringify(s));
const yards = s.buildings.filter(b => b.kind === 'hq');
let k = 0;
outer: for (let ring = 6; ring < 40; ring++)
  for (const y of yards)
    for (let a = 0; a < 16; a++) {
      if (s.units.length >= UNITS_WANTED) break outer;
      const dx = [-1, 0, 1, 1, 1, 0, -1, -1][a % 8] * ring + (a >= 8 ? 2 : 0);
      const dy = [-1, -1, -1, 0, 1, 1, 1, 0][a % 8] * ring;
      const x = Math.floor(y.x + 1 + dx);
      const yy = Math.floor(y.y + 1 + dy);
      if (x < 0 || yy < 0 || x >= s.mapW || yy >= s.mapH || !isWalkable(s.tiles[x + yy * s.mapW] as never)) continue;
      const u = addUnit(s, y.owner as Owner, KINDS[k++ % KINDS.length], x + 0.5, yy + 0.5);
      if (u.id % 2 === 0) u.order = { type: 'attackMove', x: s.mapW / 2, y: s.mapH / 2 } as never;
    }
const PROFILE = args.includes('--profile') ? arg('profile', 'crowd.cpuprofile') : null;
const session = PROFILE ? new Session() : null;
if (session) {
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.start');
}
const times: number[] = [];
let peak = 0;
for (let i = 0; i < TICKS && s.winner === null; i++) {
  const t0 = performance.now();
  s = processAction(s, { type: 'tick', n: 1 });
  times.push(performance.now() - t0);
  peak = Math.max(peak, s.units.length);
}
times.sort((a, b) => a - b);
const p = (q: number) => times[Math.min(times.length - 1, Math.floor((times.length - 1) * q))].toFixed(2);
console.log(`${times.length} ticks, up to ${peak} units: median ${p(0.5)} ms, p95 ${p(0.95)} ms, p99 ${p(0.99)} ms, worst ${times[times.length - 1].toFixed(1)} ms`);
if (session && PROFILE) {
  const { profile } = await session.post('Profiler.stop');
  writeFileSync(PROFILE, JSON.stringify(profile));
  console.log(`profile written to ${PROFILE}`);
}
}

void main();
