/**
 * The AI ladder: whole battles, computer against computer, with each side's commander and
 * difficulty chosen separately, over many seeds. It prints win rates and game lengths.
 *
 *   tsx scripts/ai-ladder.ts                        the standard card, 150 seeds per match
 *   tsx scripts/ai-ladder.ts --seeds 40             fewer seeds (noisy: see below)
 *   tsx scripts/ai-ladder.ts --match new:hard,new:normal --match old:normal,new:normal
 *   tsx scripts/ai-ladder.ts --jobs 4 --cap 60000
 *   tsx scripts/ai-ladder.ts --map random              a skirmish setup: advanced tech, map drawn per seed
 *   tsx scripts/ai-ladder.ts --map mix                 every map type in turn (seed 1 classic, 2 river, ...)
 *   tsx scripts/ai-ladder.ts --map river,canyon --tech standard --credits 5000 --ore rich
 *   tsx scripts/ai-ladder.ts --map legacy              no setup at all: the original game (the default)
 *   tsx scripts/ai-ladder.ts --map random --size large a larger map (round 5): large or huge; the cap
 *                                                      defaults to 72000 ticks on large, 108000 on huge
 *
 * A match is `side0,side1`, each side `commander:difficulty`, where the commander is `new` (the
 * AI in src/sim/ai.ts), `prev` (the frozen commander from before it learned the advanced tech, in
 * scripts/ai-prev.ts) or `old` (the frozen first build in scripts/ai-baseline.ts). Side 1 plays
 * at `s.difficulty`; side 0 at `s.autopilotDifficulty`. The frozen commanders are swapped in
 * through ai.ts's setAutopilotAi hook, which nothing outside this script uses.
 *
 * With --map other than legacy every battle gets a skirmish setup (tech advanced unless --tech
 * says otherwise), the card pits `new` against `prev` rather than `old`, and every match is also
 * broken down by the map type actually drawn. For the mirror on every map type at 150 seeds
 * each: `--map mix --seeds 900 --match new:normal,new:normal`.
 *
 * Two things to know when reading the numbers:
 * - Only side 1 gets its difficulty's income multiplier (the engine pays the computer side, and
 *   side 1 is the computer in a real game): Hard on side 1 earns 25% more, Easy on side 1 20%
 *   less, while side 0 always earns the base rate. So every pairing is played both ways round,
 *   and the summary averages the two orientations.
 * - The seat itself is worth a lot: in the Normal mirror side 1 wins about three games in four
 *   (where structures open their doors, which way ties break in the engine). The card plays the
 *   mirror so the other rows can be read against it. The cleanest difficulty comparison is the
 *   same seat against the same opponent: side 0 `new normal` against side 1 at each difficulty
 *   (rows "new normal v new easy", the mirror, and "new normal v new hard").
 * - CLAUDE.md: win-rate comparisons need 150+ seeds. At 40 the noise is about +-8 points.
 *
 * The same seed names (`ladder-1` ...) are used for every match, so two matches differ only in
 * who is playing.
 */
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { processAction } from '../src/sim/actions';
import { setAutopilotAi } from '../src/sim/ai';
import { scaledFor } from '../src/sim/aiScale';
import { DIFFICULTIES, MAP_SIZES, MAP_TYPES, type Difficulty, type MapSize, type MapType, type Owner, type SkirmishSetup } from '../src/sim/rules';
import { createInitialState } from '../src/sim/state';
import { baselineAi } from './ai-baseline';
import { prevAi } from './ai-prev';

type Commander = 'new' | 'prev' | 'old';
const COMMANDERS: Commander[] = ['new', 'prev', 'old'];
interface Side {
  ai: Commander;
  difficulty: Difficulty;
}
interface Match {
  sides: [Side, Side];
}
interface Result {
  match: number;
  seed: number;
  winner: Owner | null;
  tick: number;
  /** The map type drawn ('legacy' for the original map). */
  map: string;
}

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const SEEDS = Number(arg('--seeds', '150'));
const SIZE = arg('--size', 'standard') as MapSize;
if (!MAP_SIZES.includes(SIZE)) throw new Error(`bad size "${SIZE}"`);
const CAP = Number(arg('--cap', SIZE === 'huge' ? '108000' : SIZE === 'large' ? '72000' : '60000'));
const JOBS = Math.max(1, Number(arg('--jobs', String(cpus().length))));
const MAP = arg('--map', 'legacy');
const TECH = arg('--tech', 'advanced');
const CREDITS = Number(arg('--credits', '3000'));
const ORE = arg('--ore', 'normal');
const LEGACY = MAP === 'legacy';
/** The map each seed plays on: 'random' (drawn from the seed), or a list cycled through by seed. */
const MAP_LIST: (MapType | 'random')[] = LEGACY ? [] : MAP === 'mix' ? [...MAP_TYPES] : (MAP.split(',') as (MapType | 'random')[]);
for (const m of MAP_LIST) if (m !== 'random' && !MAP_TYPES.includes(m)) throw new Error(`bad map "${m}"`);
if (TECH !== 'standard' && TECH !== 'advanced') throw new Error(`bad tech "${TECH}"`);
function setupFor(seed: number): Partial<SkirmishSetup> | undefined {
  if (LEGACY) return undefined;
  return {
    map: MAP_LIST[(seed - 1) % MAP_LIST.length],
    tech: TECH as SkirmishSetup['tech'],
    credits: CREDITS,
    ore: ORE as SkirmishSetup['ore'],
    ...(SIZE !== 'standard' ? { size: SIZE } : {}),
  };
}
const AIS = { new: null, prev: prevAi, old: baselineAi } as const;

function parseSide(text: string): Side {
  const [ai, difficulty] = text.split(':');
  if (!COMMANDERS.includes(ai as Commander) || !(difficulty in DIFFICULTIES)) throw new Error(`bad side "${text}"`);
  return { ai: ai as Commander, difficulty: difficulty as Difficulty };
}

function standardCard(): Match[] {
  const base = LEGACY ? 'old' : 'prev';
  const pair = (a: string, b: string): Match[] => [
    { sides: [parseSide(a), parseSide(b)] },
    { sides: [parseSide(b), parseSide(a)] },
  ];
  return [
    ...pair('new:hard', 'new:normal'),
    ...pair('new:normal', 'new:easy'),
    // Against the frozen commander: the first build on the original game, the commander from
    // before the advanced tech on a skirmish setup.
    ...pair('new:normal', `${base}:normal`),
    ...pair('new:hard', `${base}:hard`),
    // Hard on side 1 earns a quarter more, which swamps everything else in a Hard pairing played
    // both ways round. So each Hard commander also plays from side 0 (base income) against the
    // same Normal opponent on side 1: the same seat against the same opponent.
    ...(LEGACY
      ? []
      : [
          { sides: [parseSide('new:hard'), parseSide('prev:normal')] } as Match,
          { sides: [parseSide('prev:hard'), parseSide('prev:normal')] } as Match,
        ]),
    // The mirror: how much the seat alone is worth, to read the rows above against.
    { sides: [parseSide('new:normal'), parseSide('new:normal')] },
  ];
}

function matchesFromArgs(): Match[] {
  const out: Match[] = [];
  args.forEach((a, i) => {
    if (a !== '--match') return;
    const [x, y] = args[i + 1].split(',');
    out.push({ sides: [parseSide(x), parseSide(y)] });
  });
  return out.length ? out : standardCard();
}

function play(m: Match, seed: number): Result & { match: number } {
  setAutopilotAi(AIS[m.sides[0].ai], 0);
  setAutopilotAi(AIS[m.sides[1].ai], 1);
  const name = `ladder-${seed}`;
  const setup = setupFor(seed);
  let s = createInitialState(name, name, { seed: name, difficulty: m.sides[1].difficulty, createdAt: 0, autopilot: true, ...(setup ? { setup } : {}) });
  s.autopilotDifficulty = m.sides[0].difficulty;
  // Side 0's first attack at its own difficulty, scaled for the map's size as side 1's already is.
  s.ai[0].nextAttack = scaledFor(s, DIFFICULTIES[m.sides[0].difficulty]).firstAttack;
  while (s.winner === null && s.tick < CAP) s = processAction(s, { type: 'tick', n: 50 });
  setAutopilotAi(null, 0);
  setAutopilotAi(null, 1);
  return { match: -1, seed, winner: s.winner, tick: s.tick, map: s.mapType ?? 'legacy' };
}

const label = (sd: Side) => `${sd.ai} ${sd.difficulty}`;
const minutes = (ticks: number) => (ticks / 600).toFixed(1);

// Worker: plays every (match, seed) job whose index is k mod n, one JSON line per battle.
const workerAt = args.indexOf('--worker');
if (workerAt >= 0) {
  const [k, n] = args[workerAt + 1].split('/').map(Number);
  const matches = JSON.parse(arg('--spec', '[]')) as Match[];
  let job = 0;
  for (let mi = 0; mi < matches.length; mi++)
    for (let seed = 1; seed <= SEEDS; seed++, job++) {
      if (job % n !== k) continue;
      const r = play(matches[mi], seed);
      process.stdout.write(JSON.stringify({ ...r, match: mi }) + '\n');
    }
} else {
  const matches = matchesFromArgs();
  const total = matches.length * SEEDS;
  console.log(`Fireline AI ladder: ${matches.length} matches x ${SEEDS} seeds = ${total} battles, ${JOBS} jobs, cap ${CAP} ticks`);
  console.log(LEGACY ? 'Setup: none (the original game)' : `Setup: map ${MAP}, tech ${TECH}, ${CREDITS} credits, ${ORE} ore, ${SIZE} size`);
  const started = Date.now();
  const results: Result[] = [];
  const script = fileURLToPath(import.meta.url);
  const spec = JSON.stringify(matches);
  const children: ReturnType<typeof spawn>[] = [];
  const workers = Array.from({ length: JOBS }, (_, k) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          ...process.execArgv,
          script,
          ...['--worker', `${k}/${JOBS}`, '--spec', spec, '--seeds', String(SEEDS), '--cap', String(CAP)],
          ...['--map', MAP, '--tech', TECH, '--credits', String(CREDITS), '--ore', ORE, '--size', SIZE],
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      children.push(child);
      let buf = '';
      child.stdout!.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          results.push(JSON.parse(line) as Result);
          if (results.length % 50 === 0) process.stderr.write(`  ${results.length}/${total}\r`);
        }
      });
      child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`worker ${k} exited ${code}`))));
    }),
  );
  Promise.all(workers).then(() => {
    console.log('');
    const row = (mi: number) => {
      const rs = results.filter(r => r.match === mi);
      const w0 = rs.filter(r => r.winner === 0).length;
      const w1 = rs.filter(r => r.winner === 1).length;
      const done = rs.filter(r => r.winner !== null);
      const avg = done.length ? done.reduce((a, r) => a + r.tick, 0) / done.length : 0;
      const sorted = done.map(r => r.tick).sort((a, b) => a - b);
      const median = sorted.length ? sorted[sorted.length >> 1] : 0;
      return { rs, w0, w1, draws: rs.length - done.length, avg, median };
    };
    console.log('side 0'.padEnd(14) + 'side 1'.padEnd(14) + 'side 0 wins'.padEnd(14) + 'side 1 wins'.padEnd(14) + 'unfinished'.padEnd(12) + 'avg min  median min');
    matches.forEach((m, mi) => {
      const r = row(mi);
      const pct = (w: number) => `${w} (${Math.round((100 * w) / r.rs.length)}%)`;
      console.log(
        label(m.sides[0]).padEnd(14) +
          label(m.sides[1]).padEnd(14) +
          pct(r.w0).padEnd(14) +
          pct(r.w1).padEnd(14) +
          String(r.draws).padEnd(12) +
          minutes(r.avg).padEnd(9) +
          minutes(r.median),
      );
    });
    const stuck = matches
      .map((m, mi) => [mi, results.filter(r => r.match === mi && r.winner === null).map(r => r.seed).sort((a, b) => a - b)] as const)
      .filter(([, seeds]) => seeds.length);
    // By map type, where more than one was played: side 0's wins, side 1's, and unfinished.
    const types = [...new Set(results.map(r => r.map))].sort();
    if (types.length > 1) {
      console.log('\nBy map type (side 0 wins / side 1 wins / unfinished):');
      console.log(''.padEnd(28) + types.map(t => t.padEnd(13)).join(''));
      matches.forEach((m, mi) => {
        const cells = types.map(t => {
          const rs = results.filter(r => r.match === mi && r.map === t);
          const w0 = rs.filter(r => r.winner === 0).length;
          const w1 = rs.filter(r => r.winner === 1).length;
          return `${w0}/${w1}/${rs.length - w0 - w1}`.padEnd(13);
        });
        console.log(`${label(m.sides[0])} v ${label(m.sides[1])}`.padEnd(28) + cells.join(''));
      });
    }
    for (const [mi, seeds] of stuck) console.log(`  unfinished, ${label(matches[mi].sides[0])} v ${label(matches[mi].sides[1])}: seeds ${seeds.join(', ')}`);
    // Pairings played both ways round: the first-named side's wins over both orientations.
    const seen = new Set<number>();
    const lines: string[] = [];
    matches.forEach((m, mi) => {
      if (seen.has(mi)) return;
      const mj = matches.findIndex(
        (o, j) => j !== mi && !seen.has(j) && label(o.sides[0]) === label(m.sides[1]) && label(o.sides[1]) === label(m.sides[0]),
      );
      if (mj < 0) return;
      seen.add(mi);
      seen.add(mj);
      const a = row(mi);
      const b = row(mj);
      const wins = a.w0 + b.w1;
      const games = a.rs.length + b.rs.length;
      const rate = wins / games;
      const half = 1.96 * Math.sqrt((rate * (1 - rate)) / games);
      const lo = Math.max(0, rate - half);
      const hi = Math.min(1, rate + half);
      lines.push(
        `${label(m.sides[0])} beats ${label(m.sides[1])} in ${wins} of ${games} (${((100 * wins) / games).toFixed(1)}%, ` +
          `95% interval ${(100 * lo).toFixed(0)}-${(100 * hi).toFixed(0)}%), both ways round`,
      );
    });
    if (lines.length) {
      console.log('');
      for (const l of lines) console.log(l);
    }
    console.log(`\n${results.length} battles in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }, err => {
    for (const c of children) c.kill();
    console.error(err);
    process.exit(1);
  });
}
