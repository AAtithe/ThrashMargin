/**
 * Fireline campaign sweep: can each mission be won, at each campaign difficulty, and by how many
 * different plans? Every mission a scripted player can play, at Easy, Normal and Hard, by every
 * plan in campaign-player.ts (twelve for a base mission). Prints wins per mission and level.
 *
 *   npm run sweep:fire                       every mission, every level
 *   npm run sweep:fire -- blackout fireline  only these
 *
 * Several minutes, so not part of `npm run check`; campaign-check plays one winning plan for each.
 * Use it after any change to a mission, the campaign difficulty, the AI or the balance. One plan
 * per mission is noise: a single run once read a mission as unwinnable at 8000 enemy credits and
 * winnable at 6000 and at 2000 alike. Missions 4, 5, 10, 11 and 13 have their own players in
 * campaign-check and are not repeated here.
 *
 * Bar used when the campaign difficulty settings were added: Easy wins with every plan, Normal with
 * most, Hard with some. A scripted player that loses proves little; see campaign-player.ts.
 */
import { fork } from 'node:child_process';
import { cpus } from 'node:os';
import type { Difficulty } from '../src/sim/rules';
import { BASE_PLANS, playAceOfSpades, playBase, playQuietMan, type PlayResult } from './campaign-player';

const BASE_MISSIONS = ['first-light', 'hold-the-ford', 'blackout', 'fireline', 'iron-coast', 'firestorm', 'last-light'];
const LEVELS: Difficulty[] = ['easy', 'normal', 'hard'];

type Job = { mission: string; level: Difficulty; plan: number };

function jobsFor(mission: string): Omit<Job, 'level'>[] {
  if (mission === 'quiet-man') return Array.from({ length: 6 }, (_, plan) => ({ mission, plan }));
  if (mission === 'ace-of-spades') return Array.from({ length: 3 }, (_, plan) => ({ mission, plan }));
  return BASE_PLANS.map((_, plan) => ({ mission, plan }));
}

function run(job: Job): PlayResult {
  if (job.mission === 'quiet-man') {
    const ways = ['north', 'middle', 'east'] as const;
    return playQuietMan(job.level, ways[job.plan % 3], job.plan < 3 ? 'extraction' : 'spy');
  }
  if (job.mission === 'ace-of-spades') return playAceOfSpades(job.level, (['gather', 'sweep', 'turrets'] as const)[job.plan]);
  return playBase(job.mission, job.level, BASE_PLANS[job.plan]);
}

if (process.argv[2] === '--job') {
  const job = JSON.parse(process.argv[3]) as Job;
  process.send!(run(job));
} else void main();

async function main(): Promise<void> {
  const wanted = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const missions = wanted.length ? wanted : ['first-light', 'quiet-man', 'hold-the-ford', 'ace-of-spades', ...BASE_MISSIONS.slice(2)];
  const jobs: Job[] = missions.flatMap(m => LEVELS.flatMap(level => jobsFor(m).map(j => ({ ...j, level }))));
  const results: PlayResult[] = [];
  const self = __filename;
  const width = Math.max(1, cpus().length);
  const t0 = Date.now();
  let next = 0;
  await new Promise<void>(resolveAll => {
    let running = 0;
    const launch = () => {
      if (next >= jobs.length && running === 0) return resolveAll();
      while (running < width && next < jobs.length) {
        const job = jobs[next++];
        running++;
        const child = fork(self, ['--job', JSON.stringify(job)], { execArgv: process.execArgv });
        child.on('message', r => results.push(r as PlayResult));
        child.on('exit', () => {
          running--;
          launch();
        });
      }
    };
    launch();
  });
  console.log(`Fireline campaign sweep: ${jobs.length} battles in ${Math.round((Date.now() - t0) / 1000)}s\n`);
  console.log(`  ${'mission'.padEnd(16)}${LEVELS.map(l => l.padStart(10)).join('')}`);
  for (const m of missions) {
    const cells = LEVELS.map(l => {
      const rs = results.filter(r => r.mission === m && r.level === l);
      return `${rs.filter(r => r.result === 'won').length}/${rs.length}`.padStart(10);
    });
    console.log(`  ${m.padEnd(16)}${cells.join('')}`);
  }
  if (process.argv.includes('--why')) {
    console.log('');
    for (const r of results.filter(x => x.result !== 'won').sort((a, b) => a.mission.localeCompare(b.mission)))
      console.log(`  ${r.mission} ${r.level}, ${r.plan}: ${r.result} at ${Math.round(r.ticks / 60) / 10} min${r.lostBecause ? ` (${r.lostBecause})` : ''}`);
  }
}
