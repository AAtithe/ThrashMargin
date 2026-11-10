/**
 * Frame times late in a huge battle, in a real browser (fireline-round5-design.md, workstream B).
 *
 *   node scripts/perf-render.cjs                   starts Vite on port 5431, measures, stops it
 *   node scripts/perf-render.cjs --port 5432 --size huge --theme dark --shot .shots/late.png
 *   PERF_BASE=http://localhost:5178 node scripts/perf-render.cjs   against a server already running
 *
 * It plays a four-sided battle (teams, advanced tech) headless to minute 25 with perf-fire.ts
 * --dump, puts it in this browser's local saves (no token: the local path, client side only; the
 * sign-in gate is satisfied the documented way, with `tm_user`), opens it at 1280 by 800, zoom 1,
 * and for ten seconds pans the camera with the arrow keys while the battle runs. Every
 * requestAnimationFrame callback is timed (the work of a frame: simulation ticks due, then the
 * draw), and so is the gap between frames. Prints the median, 95th and 99th percentiles of both.
 * Target: a median frame under 16 ms. Fails on any page error.
 */
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PORT = Number(arg('port', '5431'));
const SIZE = arg('size', 'huge');
const THEME = arg('theme', 'light');
const SHOT = arg('shot', '');
const SECONDS = Number(arg('seconds', '10'));
const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  return false;
}

const pct = (xs, p) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))] : 0;
};

(async () => {
  const file = path.join(os.tmpdir(), `fireline-late-${SIZE}.json`);
  if (!fs.existsSync(file) || args.includes('--fresh')) {
    console.log('Playing the battle to minute 25 (headless)...');
    execFileSync('npx', ['tsx', 'scripts/perf-fire.ts', '--dump', file, '--to', '25', '--size', SIZE], { cwd: ROOT, stdio: 'inherit' });
  }
  const json = fs.readFileSync(file, 'utf8');
  const state = JSON.parse(json);

  let server = null;
  let base = process.env.PERF_BASE;
  if (!base) {
    base = `http://localhost:${PORT}`;
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
    if (!(await waitFor(base, 30000))) throw new Error('Vite did not start');
  }
  const errors = [];
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await context.addInitScript(
      ([json, id, theme]) => {
        if (sessionStorage.getItem('perf-seeded')) return;
        sessionStorage.setItem('perf-seeded', '1');
        localStorage.setItem('tm_user', JSON.stringify({ userId: 'local-dev', username: 'local-dev' }));
        localStorage.setItem('fireline_tour_seen', '1');
        localStorage.setItem('tm_theme', theme);
        localStorage.setItem(`fireline_save_${id}`, json);
        localStorage.setItem('fireline_saves', JSON.stringify([{ id, name: 'Late huge battle', turn: 25, status: 'active', savedAt: Date.now() }]));
        // Time every animation-frame callback: the work each frame does.
        const raf = window.requestAnimationFrame.bind(window);
        window.__frames = [];
        window.__gaps = [];
        let last = 0;
        // The battle's own loop is GameScreen.tsx's `frame` (the one that sizes the battlefield
        // from wrapRef); other callbacks (the minimap, the sidebar, motion) are not counted.
        const seen = new WeakMap();
        const isGame = cb => {
          let v = seen.get(cb);
          if (v === undefined) seen.set(cb, (v = cb.name === 'frame' && String(cb).includes('wrapRef')));
          return v;
        };
        window.requestAnimationFrame = cb =>
          raf(ts => {
            const a = performance.now();
            cb(ts);
            if (!isGame(cb)) return;
            // The first frame paints the terrain: kept apart, it is the cost of opening the battle.
            if (window.__first === undefined) window.__first = performance.now() - a;
            if (window.__measure) {
              window.__frames.push(performance.now() - a);
              if (last) window.__gaps.push(a - last);
            }
            last = a;
          });
      },
      [json, state.id, THEME],
    );
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`${base}/game/${state.id}`);
    await page.locator('[data-testid=battlefield]').waitFor({ timeout: 30000 });
    await sleep(2500);
    const canvas = page.locator('[data-testid=battlefield] canvas').first();
    await canvas.click({ position: { x: 640, y: 400 } }).catch(() => {});
    await page.evaluate(() => {
      window.__frames.length = 0;
      window.__gaps.length = 0;
      window.__measure = true;
    });
    // Pan: right, down, left, up, a quarter of the time each.
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    for (const k of keys) {
      await page.keyboard.down(k);
      await sleep((SECONDS * 1000) / keys.length);
      await page.keyboard.up(k);
    }
    const { frames, gaps, first } = await page.evaluate(() => {
      window.__measure = false;
      return { frames: window.__frames.slice(), gaps: window.__gaps.slice(), first: window.__first };
    });
    if (SHOT) {
      fs.mkdirSync(path.dirname(path.resolve(SHOT)), { recursive: true });
      await page.screenshot({ path: SHOT });
    }
    const f = n => n.toFixed(2);
    console.log(
      `${SIZE}, ${state.mapW} tiles, minute ${(state.tick / 600).toFixed(0)}, ${state.units.length} units, ${THEME}: ${frames.length} frames in ${SECONDS} s; ` +
        `frame work median ${f(pct(frames, 0.5))} ms, p95 ${f(pct(frames, 0.95))} ms, p99 ${f(pct(frames, 0.99))} ms; ` +
        `gap between frames median ${f(pct(gaps, 0.5))} ms, p95 ${f(pct(gaps, 0.95))} ms; first frame (painting the terrain) ${f(first ?? 0)} ms`,
    );
    if (errors.length) {
      console.log('Page errors:\n  ' + errors.join('\n  '));
      process.exitCode = 1;
    }
    if (pct(frames, 0.5) >= 16) {
      console.log('FAIL: median frame work is 16 ms or more');
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    if (server) {
      try {
        process.kill(-server.pid);
      } catch {
        /* already gone */
      }
    }
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
