/**
 * The attack probe (2026-11-27): how often the computer attacks a player who never attacks.
 *
 * Side 0 is played by the Normal commander with its waves and raids held back for the whole battle,
 * standing in for a player who builds up at home; the other sides are computers at Normal. Reports,
 * per seed and on average, how many waves the computers sent, when the first came, and the share of
 * the time the old whole-map "outmatched" test would have held them at home.
 *
 *   tsx scripts/attack-probe.ts                          Standard size, 6 seeds, 40 minutes
 *   tsx scripts/attack-probe.ts --pace long --seeds 8    a game size (its preset credits, ore and map size)
 *   tsx scripts/attack-probe.ts --sides 4                three computers and the stand-in, free for all
 *   tsx scripts/attack-probe.ts --econ                   every economy toggle on (Full economy)
 *   tsx scripts/attack-probe.ts --minutes 60
 *
 * Measured with it (fireline-design.md, 2026-11-27): the commander had grown passive in long and
 * many-sided games. Not in `npm run check`: a few minutes a run.
 */
import { processAction } from '../src/sim/actions';
import { scaledFor } from '../src/sim/aiScale';
import { OUTMATCH_WAVE, outmatched } from '../src/sim/aiStrength';
import { GAME_PACES, difficultyForPace, type GamePace, type Owner, type SkirmishSetup } from '../src/sim/rules';
import { createInitialState } from '../src/sim/state';

const args = process.argv.slice(2);
const arg = (n: string, d: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const PACE = arg('--pace', 'standard') as GamePace;
const SEEDS = Number(arg('--seeds', '6'));
const MINUTES = Number(arg('--minutes', '40'));
const ECON = args.includes('--econ');
const SIDES = Number(arg('--sides', '2')) as 2 | 3 | 4;

let waves = 0;
let firstSum = 0;
let firstN = 0;
let held = 0;
let samples = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
  const name = `probe-${seed}`;
  const preset = GAME_PACES[PACE].preset;
  const setup: Partial<SkirmishSetup> = {
    map: 'random', tech: 'advanced', credits: preset.credits, ore: preset.ore, research: 'lines', pace: PACE,
    adaptive: true, fortification: true, structureUpgrades: true, strategicBuildings: true,
    ...(preset.size !== 'standard' ? { size: preset.size } : {}),
    ...(SIDES > 2 ? { sides: SIDES } : {}),
    ...(ECON ? { industry: true, supply: true, territory: true, production: true } : {}),
  };
  let s = createInitialState(name, name, { seed: name, difficulty: 'normal', createdAt: 0, autopilot: true, setup });
  s.autopilotDifficulty = 'normal';
  s.ai[0].nextAttack = scaledFor(s, difficultyForPace('normal', PACE)).firstAttack;
  let first = -1;
  let h = 0;
  let n = 0;
  const computers = s.ai.map((_, i) => i).filter(i => i > 0) as Owner[];
  while (s.winner === null && s.tick < MINUTES * 600) {
    s.ai[0].nextAttack = s.tick + 100000;
    s.ai[0].nextRaid = s.tick + 100000;
    s = processAction(s, { type: 'tick', n: 50 });
    if (first < 0 && computers.some(o => s.ai[o].wave > 0)) first = s.tick;
    if (outmatched(s, 1, OUTMATCH_WAVE)) h++;
    n++;
  }
  const w = computers.reduce((a, o) => a + s.ai[o].wave, 0) / computers.length;
  waves += w;
  held += h;
  samples += n;
  if (first >= 0) {
    firstSum += first;
    firstN++;
  }
  console.log(`seed ${seed}: ${s.winner === null ? 'unfinished' : `side ${s.winner} won`} at ${(s.tick / 600).toFixed(1)} min; waves a computer ${w.toFixed(1)}; first ${first < 0 ? 'never' : (first / 600).toFixed(1)} min; outmatched by the whole map ${((100 * h) / n).toFixed(0)}% of the time`);
}
console.log(`${PACE}, ${SIDES} sides${ECON ? ', full economy' : ''}: waves a computer ${(waves / SEEDS).toFixed(1)} in up to ${MINUTES} min; first wave ${firstN ? (firstSum / firstN / 600).toFixed(1) : '-'} min (${firstN} of ${SEEDS}); outmatched by the whole map ${((100 * held) / samples).toFixed(0)}% of the time`);
