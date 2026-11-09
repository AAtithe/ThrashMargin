/**
 * Seat fairness in battles of three and four sides (fireline-round4-design.md, workstream B):
 * whole computer-against-computer battles, each played to the last side standing, counting how
 * often each seat wins. On a fair map every seat of a free-for-all wins about equally often.
 *
 *   npx tsx packages/fireline/scripts/sides-fairness.ts                       4 sides, free for all, 120 seeds
 *   npx tsx packages/fireline/scripts/sides-fairness.ts --sides 3 --seeds 150
 *   npx tsx packages/fireline/scripts/sides-fairness.ts --mode teams --tech standard
 *
 * The game itself ends a free-for-all as soon as side 0 (the human's seat) is out, because the
 * player has lost. To measure every seat alike this script plays on past that: when side 0 is out
 * and several sides still stand, side 0's leftover units are removed and side 0 is put on a
 * surviving side's team, purely so the victory rule lets the battle continue; side 0 has nothing on
 * the field by then, so this changes no fight. Not in `npm run check` (it takes a few minutes).
 */
import { processAction } from '../src/sim/actions';
import { MAP_TYPES, type MapType, type Owner, type SideMode } from '../src/sim/rules';
import { createInitialState, isStructure } from '../src/sim/state';
import type { GameState } from '../src/sim/types';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const SIDES = Number(arg('sides', '4')) as 3 | 4;
const MODE = arg('mode', 'ffa') as SideMode;
const SEEDS = Number(arg('seeds', '120'));
const TECH = arg('tech', 'advanced') as 'standard' | 'advanced';
const CAP = 60000;

const standing = (s: GameState): Owner[] =>
  s.players.map((_, o) => o as Owner).filter(o => s.buildings.some(b => b.owner === o && isStructure(b)));

function playToTheEnd(seed: string, map: MapType): { last: Owner | null; tick: number; out: Owner[] } {
  let s = createInitialState(seed, seed, { seed, difficulty: 'normal', createdAt: 0, autopilot: true, setup: { map, tech: TECH, sides: SIDES, mode: MODE, credits: 3000, ore: 'normal' } });
  const out: Owner[] = [];
  const note = () => {
    const up = standing(s);
    for (const o of s.players.map((_, i) => i as Owner)) if (!up.includes(o) && !out.includes(o)) out.push(o);
  };
  while (s.tick < CAP) {
    s = processAction(s, { type: 'tick', n: 50 });
    note();
    if (s.winner === null) continue;
    const up = standing(s);
    if (MODE === 'teams' || up.length <= 1 || new Set(up.map(o => s.teams[o])).size <= 1) break;
    // Side 0 is out: play on (see the note at the top). Side 0 joins the first survivor's team.
    const c = JSON.parse(JSON.stringify(s)) as GameState;
    c.units = c.units.filter(u => u.owner !== 0);
    c.teams = c.teams.slice();
    c.teams[0] = c.teams[up[0]];
    c.winner = null;
    s = c;
  }
  const up = standing(s);
  return { last: up.length === 1 ? up[0] : MODE === 'teams' ? s.winner : null, tick: s.tick, out };
}

const wins = new Array(SIDES).fill(0);
const firstOut = new Array(SIDES).fill(0);
let unfinished = 0;
let ticks = 0;
const started = Date.now();
console.log(`${SIDES} sides, ${MODE === 'ffa' ? 'free for all' : 'teams'}, ${TECH} tech, ${SEEDS} seeds, map types in turn`);
for (let i = 1; i <= SEEDS; i++) {
  const map = MAP_TYPES[i % MAP_TYPES.length];
  const r = playToTheEnd(`fair-${SIDES}-${MODE}-${i}`, map);
  if (r.last === null) unfinished++;
  else {
    wins[r.last]++;
    ticks += r.tick;
  }
  if (r.out.length) firstOut[r.out[0]]++;
  if (i % 10 === 0) console.log(`  ${i} battles, ${((Date.now() - started) / 1000).toFixed(0)}s: wins by seat ${wins.join(', ')}`);
}
const done = SEEDS - unfinished;
console.log(`\n${done}/${SEEDS} finished, average ${(ticks / Math.max(1, done) / 600).toFixed(1)} game minutes`);
for (let o = 0; o < SIDES; o++)
  console.log(`  side ${o}: won ${wins[o]} (${((100 * wins[o]) / Math.max(1, done)).toFixed(1)}%), out first ${firstOut[o]} times`);
if (MODE === 'ffa') {
  // Two standard errors of a share near 1 / sides over this many battles.
  const p = 1 / SIDES;
  const se = Math.sqrt((p * (1 - p)) / Math.max(1, done));
  console.log(`  a fair seat wins ${(100 * p).toFixed(1)}%, give or take ${(200 * se).toFixed(1)} points (two standard errors)`);
}
