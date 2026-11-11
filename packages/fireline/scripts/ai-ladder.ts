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
 *   tsx scripts/ai-ladder.ts --map random --research classic   the five flat upgrades (default: lines)
 *     (--research needs a --map other than legacy: a legacy battle has no setup, so it is always classic
 *     and never plays development lines. Use --map random or --map mix to ladder lines.)
 *   tsx scripts/ai-ladder.ts --map random --pace long  a game pace (fireline-round6-design.md; "game size" on the cards): quick (the
 *     default, the game before round 6), standard, long or epic. The setup gets the pace and, unless
 *     --credits or --ore is given, the pace's preset credits and ore; side 0's first attack is the
 *     pace's; the default --cap is the pace's (quick and standard 60000, long 90000, epic 150000).
 *     Refused with --map legacy (no setup, so no pace). --pace and --size combine; the cap is the
 *     larger of the two defaults.
 *
 * In a development-lines battle the report adds two Depth tables after the main one: the share of
 * sides that finished at least one Mk II and at least one Mk III, and the median minute the first
 * was finished, by difficulty. Only sides played by the `new` commander count (the frozen ones never
 * run paced research), each side of each battle once (the Normal mirror counts twice for Normal).
 * The second table, "Normal and Hard only", counts only battles between two `new` sides with no Easy
 * side (the Normal mirror and Hard against Normal both ways round), since Normal against Easy ends
 * early by design. A third gives each match's share per side.
 *   tsx scripts/ai-ladder.ts ... --out results.jsonl   also writes every battle as one JSON line
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
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { processAction } from '../src/sim/actions';
import { setAutopilotAi } from '../src/sim/ai';
import { scaledFor } from '../src/sim/aiScale';
import { DIFFICULTIES, GAME_PACES, GAME_PACE_ORDER, MAP_SIZES, MAP_TYPES, UPGRADE_LINE, difficultyForPace, type Difficulty, type GamePace, type MapSize, type MapType, type Owner, type SkirmishSetup } from '../src/sim/rules';
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
  /** Development lines only: per side, the tick its first Mk II and first Mk III finished, or null. */
  mk2?: (number | null)[];
  mk3?: (number | null)[];
}

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const SEEDS = Number(arg('--seeds', '150'));
const SIZE = arg('--size', 'standard') as MapSize;
if (!MAP_SIZES.includes(SIZE)) throw new Error(`bad size "${SIZE}"`);
const MAP = arg('--map', 'legacy');
const LEGACY = MAP === 'legacy';
/** Game pace (fireline-round6-design.md): 'quick' (the default) is the game before round 6. */
const PACE = arg('--pace', 'quick') as GamePace;
if (!GAME_PACE_ORDER.includes(PACE)) throw new Error(`bad pace "${PACE}"`);
if (LEGACY && args.includes('--pace')) throw new Error('--pace needs a --map other than legacy: a legacy battle has no setup, so no pace');
const PACE_CAP: Record<GamePace, number> = { quick: 60000, standard: 60000, long: 90000, epic: 150000 };
const SIZE_CAP: Record<MapSize, number> = { standard: 60000, large: 72000, huge: 108000 };
const CAP = Number(arg('--cap', String(Math.max(PACE_CAP[PACE], SIZE_CAP[SIZE]))));
const JOBS = Math.max(1, Number(arg('--jobs', String(cpus().length))));
const TECH = arg('--tech', 'advanced');
const CREDITS = Number(arg('--credits', String(GAME_PACES[PACE].preset.credits)));
const ORE = arg('--ore', GAME_PACES[PACE].preset.ore);
/** Research mode for a skirmish setup (fireline-round5b-design.md): 'lines' (the default setup's) or 'classic'. */
const RESEARCH = arg('--research', 'lines');
/** Depth is recorded in development-lines battles only. */
const LINES_BATTLES = !LEGACY && TECH === 'advanced' && RESEARCH === 'lines';
/** The map each seed plays on: 'random' (drawn from the seed), or a list cycled through by seed. */
const MAP_LIST: (MapType | 'random')[] = LEGACY ? [] : MAP === 'mix' ? [...MAP_TYPES] : (MAP.split(',') as (MapType | 'random')[]);
for (const m of MAP_LIST) if (m !== 'random' && !MAP_TYPES.includes(m)) throw new Error(`bad map "${m}"`);
if (TECH !== 'standard' && TECH !== 'advanced') throw new Error(`bad tech "${TECH}"`);
if (RESEARCH !== 'classic' && RESEARCH !== 'lines') throw new Error(`bad research "${RESEARCH}"`);
function setupFor(seed: number): Partial<SkirmishSetup> | undefined {
  if (LEGACY) return undefined;
  return {
    map: MAP_LIST[(seed - 1) % MAP_LIST.length],
    tech: TECH as SkirmishSetup['tech'],
    credits: CREDITS,
    ore: ORE as SkirmishSetup['ore'],
    research: RESEARCH as SkirmishSetup['research'],
    pace: PACE,
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
  // Side 0's first attack at its own difficulty and the pace, scaled for the map's size as side 1's already is.
  s.ai[0].nextAttack = scaledFor(s, difficultyForPace(m.sides[0].difficulty, PACE)).firstAttack;
  const mk2: (number | null)[] = [null, null];
  const mk3: (number | null)[] = [null, null];
  while (s.winner === null && s.tick < CAP) {
    s = processAction(s, { type: 'tick', n: 50 });
    if (!LINES_BATTLES) continue;
    for (const o of [0, 1] as Owner[]) {
      const ups = s.players[o].upgrades ?? [];
      if (mk2[o] === null && ups.some(id => UPGRADE_LINE[id].mark === 2)) mk2[o] = s.tick;
      if (mk3[o] === null && ups.some(id => UPGRADE_LINE[id].mark === 3)) mk3[o] = s.tick;
    }
  }
  setAutopilotAi(null, 0);
  setAutopilotAi(null, 1);
  return { match: -1, seed, winner: s.winner, tick: s.tick, map: s.mapType ?? 'legacy', ...(LINES_BATTLES ? { mk2, mk3 } : {}) };
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
  console.log(LEGACY ? 'Setup: none (the original game)' : `Setup: map ${MAP}, tech ${TECH}, ${CREDITS} credits, ${ORE} ore, research ${RESEARCH}, pace ${PACE}, ${SIZE} size`);
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
          ...['--map', MAP, '--tech', TECH, '--credits', String(CREDITS), '--ore', ORE, '--research', RESEARCH, '--size', SIZE],
          ...(LEGACY ? [] : ['--pace', PACE]),
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
    if (LINES_BATTLES) {
      // Depth: each `new` side of each battle once, for its difficulty.
      const depth = (title: string, keep: (m: Match) => boolean) => {
        console.log(`\n${title}`);
        console.log('difficulty'.padEnd(13) + 'sides'.padEnd(10) + 'Mk II'.padEnd(20) + 'Mk III');
        for (const diff of Object.keys(DIFFICULTIES) as Difficulty[]) {
          let sides = 0;
          const at2: number[] = [];
          const at3: number[] = [];
          for (const r of results) {
            const m = matches[r.match];
            if (!keep(m)) continue;
            for (const o of [0, 1] as const) {
              if (m.sides[o].ai !== 'new' || m.sides[o].difficulty !== diff) continue;
              sides++;
              if (r.mk2?.[o] != null) at2.push(r.mk2[o]!);
              if (r.mk3?.[o] != null) at3.push(r.mk3[o]!);
            }
          }
          if (!sides) continue;
          const cell = (ts: number[]) => {
            const sorted = [...ts].sort((a, b) => a - b);
            return `${Math.round((100 * ts.length) / sides)}%${sorted.length ? `, ${minutes(sorted[sorted.length >> 1])} min` : ''}`;
          };
          console.log(diff.padEnd(13) + String(sides).padEnd(10) + cell(at2).padEnd(20) + cell(at3));
        }
      };
      depth('Depth (share of new sides reaching each, median minute when reached):', () => true);
      depth('Depth, Normal and Hard only (new against new, no Easy side):', m => m.sides.every(sd => sd.ai === 'new' && sd.difficulty !== 'easy'));
      // Per match: Mk II and Mk III shares, side 0 / side 1.
      console.log('\nDepth by match (share of battles, side 0 / side 1):');
      console.log(''.padEnd(28) + 'Mk II'.padEnd(14) + 'Mk III');
      matches.forEach((m, mi) => {
        const rs = results.filter(r => r.match === mi);
        const share = (key: 'mk2' | 'mk3', o: 0 | 1) => Math.round((100 * rs.filter(r => r[key]?.[o] != null).length) / Math.max(1, rs.length));
        console.log(`${label(m.sides[0])} v ${label(m.sides[1])}`.padEnd(28) + `${share('mk2', 0)}/${share('mk2', 1)}`.padEnd(14) + `${share('mk3', 0)}/${share('mk3', 1)}`);
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
    const out = arg('--out', '');
    if (out) writeFileSync(out, results.map(r => JSON.stringify({ ...r, sides: matches[r.match].sides })).join('\n') + '\n');
    console.log(`\n${results.length} battles in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }, err => {
    for (const c of children) c.kill();
    console.error(err);
    process.exit(1);
  });
}
