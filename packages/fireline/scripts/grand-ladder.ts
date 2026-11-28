/**
 * The Grand War ladder (fireline-grand-war-design.md, G5): whole wars, every power played by the
 * computer at one difficulty (side 0 under the autopilot, which answers offers as a defensive power),
 * over many seeds, in parallel. It prints how each war ended and what happened in it.
 *
 *   tsx scripts/grand-ladder.ts                                  Frontier, Normal, 150 seeds, 4 jobs
 *   tsx scripts/grand-ladder.ts --preset grand --diff hard --seeds 40 --jobs 4
 *   tsx scripts/grand-ladder.ts --cap 120                        stop each war at minute 120 (default: the
 *                                                                preset's time limit plus ten, or 180)
 *   tsx scripts/grand-ladder.ts --prefix holdout                 a different seed set
 *   tsx scripts/grand-ladder.ts --diff hard --player normal      the rivals at Hard, side 0 (the player's
 *                                                                seat, under the autopilot) at Normal: the
 *                                                                difficulty order is side 0's win rate falling
 *                                                                as the rivals' difficulty rises
 *
 * Per war: how it ended (conquest, dominion, time, or unfinished at the cap), the minute, the winning
 * seat, treaties signed, wars declared (breaches counted apart), cities founded by trucks, towns held at
 * the end, trade trips made. The summary gives the ending mix, median and quartile length, the seat
 * spread, and the means of the rest. CLAUDE.md: win-rate comparisons need 150+ seeds.
 */
import { fork } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { processAction } from '../src/sim/actions';
import { townsOf } from '../src/sim/cities';
import { GRAND_PRESETS, type Difficulty, type GrandPreset } from '../src/sim/rules';
import { createInitialState } from '../src/sim/state';
import { isAlly, sidesOf } from '../src/sim/sides';
import type { GameState } from '../src/sim/types';

const args = process.argv.slice(2);
const arg = (name: string, def: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PRESET = arg('preset', 'frontier') as GrandPreset;
const DIFF = arg('diff', 'normal') as Difficulty;
/** Side 0's difficulty (the autopilot's); the rivals' is DIFF. Default: the same. */
const PLAYER = arg('player', DIFF) as Difficulty;
const SEEDS = Number(arg('seeds', '150'));
const JOBS = Number(arg('jobs', '4'));
const PREFIX = arg('prefix', 'gl');
const limit = GRAND_PRESETS[PRESET].grand!.timeLimit;
const CAP = Number(arg('cap', String(limit ? limit + 10 : 180)));
/** Every war as a JSON line, when given. */
const OUT = args.includes('--out') ? arg('out', 'grand-ladder.jsonl') : null;

export interface WarResult {
  seed: string;
  /** 'eliminated': side 0 lost its last structure, which ends a war for the player (the engine then names the lowest surviving seat the winner, so such a war says nothing about the other seats). */
  end: 'conquest' | 'dominion' | 'time' | 'eliminated' | 'unfinished';
  minute: number;
  winner: number | null;
  /** Every side on the winning side at the end: the winner and its allies (an alliance wins together). */
  winners: number[];
  treaties: number;
  wars: number;
  breaches: number;
  founded: number;
  towns: number;
  trips: number;
}

export function playWar(preset: GrandPreset, diff: Difficulty, seed: string, capMinutes: number, player: Difficulty = diff): WarResult {
  let s: GameState = createInitialState(`gl-${seed}`, seed, { seed, difficulty: diff, createdAt: 0, autopilot: true, setup: GRAND_PRESETS[preset] });
  if (player !== diff) s = { ...s, autopilotDifficulty: player };
  let treaties = 0;
  let wars = 0;
  let breaches = 0;
  let stance = s.grand?.stance ?? '';
  let ends = s.grand?.ends ?? [];
  while (s.winner === null && s.tick < capMinutes * 600) {
    const before = s.tick;
    s = processAction(s, { type: 'tick', n: 50 });
    const now = s.grand?.stance ?? '';
    for (let k = 0; k < now.length; k++) {
      if (now[k] === stance[k]) continue;
      if (now[k] === 'w') {
        wars++;
        // War through a treaty that still ran: a breach (counted for each direction, halved below).
        if ((ends[k] ?? 0) > before + 50) breaches++;
      } else if (stance[k] === 'w' || 'cpa'.indexOf(now[k]) > 'cpa'.indexOf(stance[k])) treaties++;
    }
    stance = now;
    ends = s.grand?.ends ?? [];
  }
  const lastLog = s.log[s.log.length - 1]?.text ?? '';
  const out = s.winner !== null && s.winner !== 0 && !s.buildings.some(b => b.owner === 0 && b.hp > 0);
  const end: WarResult['end'] = s.winner === null ? 'unfinished' : /dominion|rules the cities/i.test(lastLog) ? 'dominion' : /^Time\./.test(lastLog) ? 'time' : out ? 'eliminated' : 'conquest';
  return {
    seed,
    end,
    minute: Math.round(s.tick / 60) / 10,
    winner: s.winner,
    winners: s.winner === null ? [] : sidesOf(s).filter(o => isAlly(s, o, s.winner!)),
    treaties: treaties / 2,
    wars: wars / 2,
    breaches: breaches / 2,
    founded: s.buildings.filter(b => b.kind === 'fieldyard' && b.pop !== undefined).length,
    towns: townsOf(s).filter(t => t.owner !== null).length,
    trips: (s.grand?.routes ?? []).reduce((n, r) => n + r.trips, 0),
  };
}

const pct = (n: number, d: number): string => `${d ? Math.round((100 * n) / d) : 0}%`;
const quart = (xs: number[], q: number): number => {
  const v = xs.slice().sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.floor((v.length - 1) * q))] : 0;
};

function report(rs: WarResult[]): void {
  const n = rs.length;
  const by = (e: WarResult['end']) => rs.filter(r => r.end === e).length;
  const mean = (f: (r: WarResult) => number) => (rs.reduce((a, r) => a + f(r), 0) / Math.max(1, n)).toFixed(1);
  const mins = rs.map(r => r.minute);
  console.log(`\nGrand War ladder: ${PRESET}, rivals ${DIFF}, side 0 ${PLAYER}, ${n} wars (prefix ${PREFIX}), cap ${CAP} min`);
  console.log(`  ended by dominion ${pct(by('dominion'), n)}, time ${pct(by('time'), n)}, conquest ${pct(by('conquest'), n)}, side 0 eliminated ${pct(by('eliminated'), n)}, unfinished ${pct(by('unfinished'), n)}`);
  console.log(`  length (min): median ${quart(mins, 0.5)}, quartiles ${quart(mins, 0.25)} to ${quart(mins, 0.75)}`);
  console.log(`  side 0 (the player's seat) won ${pct(rs.filter(r => r.winner === 0).length, n)}`);
  // The seats' spread, from wars that name a real winner (not the player's elimination).
  const decided = rs.filter(r => r.end !== 'eliminated' && r.end !== 'unfinished');
  // An alliance's win is shared: each member gets its share of the war.
  const seats = [0, 1, 2, 3].map(o => decided.reduce((a, r) => a + (r.winners.includes(o) ? 1 / r.winners.length : 0), 0));
  const shared = decided.filter(r => r.winners.length > 1).length;
  console.log(`  won by seat, of ${decided.length} wars with a real winner (${shared} by an alliance, shared): ${seats.map((c, o) => `${o}: ${pct(c, decided.length)}`).join(', ')}`);
  if (OUT) writeFileSync(OUT, rs.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(`  per war: ${mean(r => r.treaties)} treaties signed, ${mean(r => r.wars)} wars declared or resumed (${mean(r => r.breaches)} breaches), ${mean(r => r.founded)} cities founded, ${mean(r => r.towns)} towns held at the end, ${mean(r => r.trips)} trade trips`);
}

if (process.env.GRAND_LADDER_CHILD) {
  const seeds: string[] = JSON.parse(process.env.GRAND_LADDER_CHILD);
  for (const seed of seeds) process.send!(playWar(PRESET, DIFF, seed, CAP, PLAYER));
  process.exit(0);
} else if (process.argv[1]?.endsWith('grand-ladder.ts')) {
  const seeds = Array.from({ length: SEEDS }, (_, i) => `${PREFIX}-${i + 1}`);
  const chunks: string[][] = Array.from({ length: JOBS }, () => []);
  seeds.forEach((sd, i) => chunks[i % JOBS].push(sd));
  const results: WarResult[] = [];
  const t0 = Date.now();
  let live = 0;
  for (const chunk of chunks) {
    if (!chunk.length) continue;
    live++;
    const child = fork(process.argv[1], args, { env: { ...process.env, GRAND_LADDER_CHILD: JSON.stringify(chunk) }, execArgv: process.execArgv });
    child.on('message', m => {
      results.push(m as WarResult);
      if (results.length % 10 === 0) console.log(`  ${results.length}/${SEEDS} wars, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
    });
    child.on('exit', () => {
      if (--live === 0) report(results);
    });
  }
}

