#!/usr/bin/env node
/**
 * Plays every game's tutorial end to end in a real browser.
 *
 *   npm run tours                      # every game, full matrix (several minutes)
 *   npm run tours -- --quick           # a reduced matrix per game (what CI runs)
 *   npm run tours -- tea-race niccolo  # just those games
 *
 * Why this exists: `npm run check` and the `drive` harnesses never render anything, and every
 * tutorial bug found in November 2026 was invisible to them: a step that completed itself the
 * moment it was reached, a tour that restarted after every modal, a spotlight drawn off screen, a
 * card covering the button it pointed at, a step left pointing at a control that had gone. The
 * only test that catches those is one that plays the tutorial the way a person does.
 *
 * For each game this starts its Vite dev server on its own port, waits for it, runs the game's
 * driver (`scripts/tours/<game>.cjs`) against it, and stops the server by PID. Drivers seed games
 * through the real sim (Vite serves source modules) and use browser saves; they set the
 * client-side `tm_user` only. The sign-in gate and the server's auth are untouched.
 *
 * Playwright is not a dependency of the repo. Locally it is resolved from the global install;
 * CI installs it globally before running this (.github/workflows/ci.yml).
 */
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const GAMES = {
  'thrash-margin':  { dir: 'packages/thrash-margin/client', port: 5301 },
  'tea-race':       { dir: 'packages/tea-race',             port: 5302 },
  'steady-eddie':   { dir: 'packages/steady-eddie',         port: 5303 },
  'niccolo':        { dir: 'packages/niccolo',              port: 5304 },
  'niccolo-rising': { dir: 'packages/niccolo-rising',       port: 5305 },
  'fireline':       { dir: 'packages/fireline',             port: 5306 },
  'fireline-touch': { dir: 'packages/fireline',             port: 5307 },
};

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const picked = args.filter(a => !a.startsWith('--'));
for (const g of picked) if (!GAMES[g]) { console.error(`Unknown game "${g}". Known: ${Object.keys(GAMES).join(', ')}`); process.exit(2); }
const games = picked.length ? picked : Object.keys(GAMES);

let globalRoot = '';
try { globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim(); } catch { /* fall through */ }
const NODE_PATH = [process.env.NODE_PATH, globalRoot].filter(Boolean).join(path.delimiter);
const OUT = process.env.TOUR_OUT || path.join(tmpdir(), 'tours');

async function waitFor(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

function run(cmd, argv, opts) {
  return new Promise(resolve => {
    const p = spawn(cmd, argv, { stdio: 'inherit', ...opts });
    p.on('exit', code => resolve(code ?? 1));
  });
}

const summary = [];
for (const game of games) {
  const { dir, port } = GAMES[game];
  const base = `http://localhost:${port}`;
  console.log(`\n==> ${game} (${quick ? 'quick' : 'full'}) on ${base}`);
  // Thrash Margin's client is its own npm project with its own Vite; the rest use the root's.
  const own = path.join(ROOT, dir, 'node_modules/.bin/vite');
  const viteBin = existsSync(own) ? own : path.join(ROOT, 'node_modules/.bin/vite');
  const vite = spawn(viteBin, ['--port', String(port), '--strictPort'], {
    cwd: path.join(ROOT, dir), stdio: ['ignore', 'ignore', 'inherit'], detached: false,
  });
  let code = 1;
  try {
    if (!(await waitFor(base + '/', 30_000))) {
      console.error(`${game}: dev server did not come up on ${base}`);
    } else {
      // Warm the module graph once, so the first test does not race Vite's initial compile.
      await fetch(base + '/src/main.tsx').catch(() => {});
      const out = path.join(OUT, game);
      mkdirSync(out, { recursive: true });
      code = await run(process.execPath, [path.join(ROOT, 'scripts/tours', `${game}.cjs`)], {
        env: { ...process.env, NODE_PATH, TOUR_BASE: base, TOUR_QUICK: quick ? '1' : '', TOUR_OUT: out },
      });
    }
  } finally {
    vite.kill('SIGTERM');
  }
  summary.push([game, code]);
}

console.log('\n==> Tours');
for (const [game, code] of summary) console.log(`  ${code === 0 ? 'ok  ' : 'FAIL'} ${game}`);
console.log(`  Screenshots of failures: ${OUT}`);
process.exit(summary.every(([, c]) => c === 0) ? 0 : 1);
