#!/usr/bin/env node
// Guards the round-one UI polish in a real browser: no sideways scroll, AA text contrast and
// 40px phone tap targets, on every game's lobby and main screen and on the landing page, at phone
// and desktop widths, in light and dark.
//
//   npm run check:ui                              everything
//   npm run check:ui -- tea-race                  one game (or several: tea-race niccolo)
//   npm run check:ui -- landing                   the landing page alone
//   npm run check:ui -- --report out.json         also write every offender as JSON, by game
//
// Built on scripts/loading-check.cjs: it starts each game's Vite dev server itself (on its own
// ports, 5401-5408, clear of loading-check's 5173-5179 and the tours' 5301-5308), intercepts every
// API call, and sets the stored user, token and theme with addInitScript exactly as a signed-in
// browser holds them. Nothing here touches the sign-in gate, and the fake token never leaves the
// browser. A game to show is made the way loading-check makes one (the lobby's Begin, signed out,
// so it saves locally), then served back through the intercepted API as the account's one save:
// the lobby shows it in its saves list and /game/:id opens it as a cloud game.
//
// What is measured, and every exclusion with its reason, is in scripts/ui-check/audit.cjs.
// Screenshots of every failing screen, offenders outlined in red, go to $UI_OUT (default
// <tmpdir>/ui-check).
//
// Needs Playwright with Chromium. Not part of `npm run check` (no browser on Vercel); CI runs it as
// its own job (.github/workflows/ci.yml).
'use strict';
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { audit } = require('./ui-check/audit.cjs');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  // CI and some machines install Playwright globally (as scripts/tours/run.mjs expects).
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    ({ chromium } = require(path.join(root, 'playwright')));
  } catch {
    console.error('This check needs Playwright with Chromium: npm i -g playwright && npx playwright install chromium');
    process.exit(2);
  }
}

const ROOT = path.resolve(__dirname, '..');
// `begin` is the lobby button loading-check presses to make a game (scripts/loading-check.cjs).
const GAMES = [
  { key: 'thrash-margin', dir: 'packages/thrash-margin/client', port: 5401, begin: 'Start campaign' },
  { key: 'niccolo', dir: 'packages/niccolo', port: 5402, begin: 'Begin →' },
  { key: 'niccolo-rising', dir: 'packages/niccolo-rising', port: 5403, begin: 'Begin →' },
  { key: 'tea-race', dir: 'packages/tea-race', port: 5404, begin: /Begin with/ },
  { key: 'steady-eddie', dir: 'packages/steady-eddie', port: 5405, begin: /Begin with/ },
  { key: 'fireline', dir: 'packages/fireline', port: 5406, begin: /Begin the battle/ },
  // No lobby: it opens the account's one ledger directly (as in loading-check's checkLedger).
  { key: 'founders-ledger', dir: 'packages/founders-ledger', port: 5407, ledger: true },
  // landing/ is static HTML; served by a tiny file server here.
  { key: 'landing', dir: 'landing', port: 5408, landing: true },
];
const VIEWPORTS = [{ width: 375, height: 812 }, { width: 1440, height: 900 }];
const THEMES = ['light', 'dark'];
const MIN_TARGET = 40;

const argv = process.argv.slice(2);
let reportFile = null;
const picked = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--report') reportFile = argv[++i];
  else if (argv[i].startsWith('--report=')) reportFile = argv[i].slice(9);
  else picked.push(argv[i]);
}
for (const k of picked) if (!GAMES.some(g => g.key === k)) { console.error(`Unknown game "${k}". One of: ${GAMES.map(g => g.key).join(', ')}`); process.exit(2); }
const OUT = process.env.UI_OUT || path.join(os.tmpdir(), 'ui-check');

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const FAKE_JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'local-dev', exp: 4102444800 })}.unsigned`;
const USER = JSON.stringify({ userId: 'local-dev', username: 'local-dev', isAdmin: false });
const wait = ms => new Promise(r => setTimeout(r, ms));

const results = [];
const offenders = {}; // game -> { scroll: [], contrast: [], targets: [] }
const pageErrorsFor = {};
function ok(game, what, pass, extra = '') {
  results.push({ game, what, pass, extra });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${game.padEnd(15)} ${what}${extra ? `  (${extra})` : ''}`);
}

function startVite(g) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['vite', '--strictPort', '--port', String(g.port)], {
      cwd: path.join(ROOT, g.dir),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // its own process group, so stopping it stops Vite and not only npx
    });
    let out = '';
    const timer = setTimeout(() => {
      // Stop it before giving up, or it holds the port and the next run cannot start.
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
      reject(new Error(`${g.key}: dev server did not start\n${out}`));
    }, 60000);
    const onData = d => {
      // Vite colours its output where colour is supported (GitHub Actions is), which puts an escape
      // code between "Local" and ":"; strip colour before looking for the ready line.
      out += String(d).replace(/\x1b\[[0-9;]*m/g, '');
      if (out.includes('Local:')) { clearTimeout(timer); resolve({ stop: () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ } } }); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`${g.key}: dev server exited (${code})\n${out}`)); });
  });
}

function startStatic(g) {
  const dir = path.join(ROOT, g.dir);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(dir, path.normalize(p));
    if (!file.startsWith(dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(g.port, () => resolve({ stop: () => server.close() }));
  });
}

async function context(browser, { viewport = VIEWPORTS[1], theme = 'light', signedIn = true } = {}) {
  // The phone width is a phone: touch and a coarse pointer, so `@media (pointer: coarse)` rules
  // (where most of the 40px tap-target work lives) apply as they do on a real one.
  const phone = viewport.width < 600;
  const c = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
  await c.addInitScript(([user, jwt, theme, signedIn]) => {
    localStorage.setItem('tm_user', user);
    localStorage.setItem('tm_theme', theme);
    if (signedIn) {
      localStorage.setItem('tm_token', jwt);
      localStorage.setItem('tm_last_active', String(Date.now()));
    } else {
      localStorage.removeItem('tm_token');
    }
  }, [USER, FAKE_JWT, theme, signedIn]);
  return c;
}

/** Every /api call answered here. `saves` is the list, `state` the one game behind it. */
function serveApi(page, { saves = [], state = null } = {}) {
  return page.route('**/api/**', route => {
    const req = route.request();
    const url = new URL(req.url());
    if (!url.pathname.startsWith('/api/play/')) {
      if (url.pathname.startsWith('/api/profile')) return route.fulfill({ status: 200, json: { username: 'local-dev', isAdmin: false } });
      return route.fulfill({ status: 200, json: {} });
    }
    if (req.method() !== 'GET') return route.fulfill({ status: 200, json: { ok: true, success: true, version: 2 } });
    if (!url.searchParams.get('id')) return route.fulfill({ status: 200, json: { saves } });
    return route.fulfill({ status: 200, json: { state, version: 1 } });
  });
}

/** The save list row the server would send for this state (see each game's api/game/index.ts). */
function summary(state) {
  return {
    id: state.id,
    name: state.name || 'UI check',
    turn: Number(state.turn) || 1,
    status: 'active',
    savedAt: Date.now() - 3600_000,
    diff: (state.config && state.config.diff) || 'normal',
    ...(state.config && state.config.mapId ? { mapId: state.config.mapId } : {}),
    rules: state.rules === 'voyage' ? 'voyage' : 'classic',
    ...(state.kind === 'campaign' || state.kind === 'planet' ? { kind: state.kind } : {}),
    ...(typeof state.mapType === 'string' ? { mapType: state.mapType } : {}),
  };
}

/** Makes a game the way a player does (the local path), as loading-check does, and returns its state. */
async function makeGame(browser, g) {
  const c = await context(browser, { signedIn: false });
  const p = await c.newPage();
  p.on('pageerror', e => pageErrorsFor[g.key].push(`setup: ${e}`));
  await serveApi(p);
  await p.goto(`http://localhost:${g.port}/`);
  await p.getByRole('button', { name: g.begin }).first().click({ timeout: 30000 });
  await p.waitForURL(/\/game\//, { timeout: 15000 });
  const id = p.url().split('/game/')[1].split(/[?#]/)[0];
  // Banco di Niccolò opens on its first event; loading-check answers it the same way.
  if (g.key === 'niccolo') await p.getByRole('button', { name: 'Get to work' }).click({ timeout: 5000 }).catch(() => {});
  await wait(1500);
  const state = await p.evaluate(id => {
    let best = null;
    for (let i = 0; i < localStorage.length; i++) {
      const v = localStorage.getItem(localStorage.key(i));
      if (!v || !v.includes(id)) continue;
      try { const o = JSON.parse(v); if (o && o.id === id && (!best || v.length > JSON.stringify(best).length)) best = o; } catch { /* not JSON */ }
    }
    return best;
  }, id);
  await c.close();
  return state;
}

/** Waits for a screen to settle: no loader, no placeholder rows, fonts in, a beat for layout. */
async function settle(p) {
  await p.waitForFunction(() => !document.querySelector('[data-testid=loading-screen], [data-testid=loading-rows], [data-testid=boot-loader]'), null, { timeout: 15000 }).catch(() => {});
  await p.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await wait(1200);
}

const fmtContrast = o => `${o.selector} "${o.text}" ${o.ratio}:1 < ${o.need} (${o.fg} on ${o.bg}, ${o.fontSize}px/${o.fontWeight})`;
const fmtTarget = o => `${o.selector} "${o.text}" ${o.hit}px`;
const fmtScroll = o => `${o.selector} "${o.text}" right edge ${o.right}px`;
function worst(list, key, fmt, n = 3) {
  const seen = new Set();
  return [...list].sort((a, b) => a[key] - b[key]).filter(o => {
    const k = o.selector + '|' + o.text;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, n).map(fmt).join('; ');
}

const SKIP = Symbol('skip');
// The buttons that close a game's guided tour or first-run overlay, as the tours name them
// (components/GuidedTour.tsx in each game; Banco di Niccolò's TutorialOverlay.tsx).
const DISMISS = /^(Skip the tour|Skip the run|Explore on my own|Skip)$/;

/** Marks the open tour card (or first-run overlay card) as the scope; null when none is showing. */
async function markTourCard(p) {
  await p.waitForFunction(() => document.querySelector('[data-tour-step]') ||
    [...document.querySelectorAll('button')].some(b => /^(Skip the tour|Skip the run|Explore on my own|Skip)$/.test(b.textContent.trim())), null, { timeout: 8000 }).catch(() => {});
  return p.evaluate(() => {
    let card = document.querySelector('[data-tour-step]');
    if (!card) {
      const b = [...document.querySelectorAll('button')].find(x => /^(Skip the tour|Skip the run|Explore on my own|Skip)$/.test(x.textContent.trim()));
      // The card is the nearest ancestor that paints a background of its own.
      for (let e = b && b.parentElement; e && !card; e = e.parentElement) {
        const bg = getComputedStyle(e).backgroundColor;
        if (bg !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(bg)) card = e;
      }
    }
    if (!card) return null;
    card.setAttribute('data-ui-scope', '');
    return '[data-ui-scope]';
  });
}

/** Closes the tour and any first-run overlay, as a player who wants the board would. */
async function dismissTours(p) {
  await wait(800);
  for (let i = 0; i < 5; i++) {
    const b = p.getByRole('button', { name: DISMISS }).first();
    if (!(await b.isVisible().catch(() => false))) break;
    await b.click({ timeout: 3000 }).catch(() => {});
    await wait(600);
  }
}

async function auditScreen(browser, g, screen, open) {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      const tag = `${screen} ${viewport.width} ${theme}`;
      const c = await context(browser, { viewport, theme });
      const p = await c.newPage();
      p.on('pageerror', e => pageErrorsFor[g.key].push(`${tag}: ${e}`));
      try {
        const scope = await open(p);
        await settle(p);
        if (scope === SKIP) { console.log(`SKIP  ${g.key.padEnd(15)} ${tag}: nothing showing to measure`); await c.close(); continue; }
        const r = await p.evaluate(audit, { minTarget: MIN_TARGET, targets: viewport.width < 600, scope: scope || null });
        const where = { screen, viewport: viewport.width, theme };
        const bucket = offenders[g.key];
        bucket.scroll.push(...r.scroll.offenders.map(o => ({ ...where, scrollWidth: r.scroll.scrollWidth, ...o })));
        bucket.contrast.push(...r.contrast.map(o => ({ ...where, ...o })));
        bucket.targets.push(...r.targets.map(o => ({ ...where, ...o })));
        bucket.unmeasured.push(...r.unmeasuredItems.map(o => ({ ...where, ...o })));

        const scrollOk = r.scroll.scrollWidth <= r.scroll.innerWidth;
        ok(g.key, `${tag}: no sideways scroll`, scrollOk,
          scrollOk ? '' : `scrollWidth ${r.scroll.scrollWidth} > ${r.scroll.innerWidth}; ${worst(r.scroll.offenders.map(o => ({ ...o, neg: -o.right })), 'neg', fmtScroll)}`);
        ok(g.key, `${tag}: text contrast AA`, r.contrast.length === 0,
          r.contrast.length ? `${r.contrast.length} of ${r.measured}; worst: ${worst(r.contrast, 'ratio', fmtContrast)}` : `${r.measured} texts${r.unmeasured ? `; ${r.unmeasured} over images or canvas not measured` : ''}`);
        if (viewport.width < 600) {
          ok(g.key, `${tag}: tap targets ${MIN_TARGET}px`, r.targets.length === 0,
            r.targets.length ? `${r.targets.length} of ${r.targetCount}; worst: ${worst(r.targets, 'hit', fmtTarget)}` : `${r.targetCount} targets`);
        }
        if (!scrollOk || r.contrast.length || r.targets.length) {
          fs.mkdirSync(OUT, { recursive: true });
          await p.addStyleTag({ content: '[data-ui-offender]{outline:2px solid #e00000 !important;outline-offset:1px !important}' });
          await p.screenshot({ path: path.join(OUT, `${g.key}-${screen}-${viewport.width}-${theme}.png`), fullPage: true }).catch(() => {});
        }
      } catch (e) {
        ok(g.key, `${tag}: screen opened and measured`, false, String(e.message || e).split('\n')[0]);
      }
      await c.close();
    }
  }
}

async function checkGame(browser, g) {
  const base = `http://localhost:${g.port}`;
  if (g.landing) {
    for (const [screen, url] of [['home', '/'], ['privacy', '/privacy.html']]) {
      await auditScreen(browser, g, screen, async p => { await serveApi(p); await p.goto(base + url); });
    }
    return;
  }
  if (g.ledger) {
    // A null state is how the engine starts a fresh ledger, as on an account's first visit.
    const LEDGER_ID = 'ui-check-ledger';
    await auditScreen(browser, g, 'ledger', async p => {
      await serveApi(p, { saves: [{ id: LEDGER_ID }], state: null });
      await p.goto(base + '/');
      await p.waitForFunction(() => {
        const host = document.querySelector('.fl-host');
        return host && !host.hidden && host.childElementCount > 0;
      }, null, { timeout: 15000 });
    });
    return;
  }
  const state = await makeGame(browser, g);
  ok(g.key, 'made a game to show', !!state);
  if (!state) return;
  const saves = [summary(state)];
  await auditScreen(browser, g, 'lobby', async p => {
    await serveApi(p, { saves, state });
    await p.goto(base + '/');
  });
  const openGame = async p => {
    await serveApi(p, { saves, state });
    await p.goto(`${base}/game/${state.id}`);
    await p.waitForFunction(() => !document.querySelector('[data-testid=loading-screen]'), null, { timeout: 15000 }).catch(() => {});
  };
  // The tour card as the game opens: measured inside the card only, because the rest of the page
  // sits under the tour's dimming backdrop, a separate layer the ancestor chain cannot see.
  await auditScreen(browser, g, 'tour', async p => {
    await openGame(p);
    return (await markTourCard(p)) || SKIP;
  });
  await auditScreen(browser, g, 'game', async p => {
    await openGame(p);
    await dismissTours(p);
  });
}

(async () => {
  const t0 = Date.now();
  const games = GAMES.filter(g => !picked.length || picked.includes(g.key));
  for (const g of games) { offenders[g.key] = { scroll: [], contrast: [], targets: [], unmeasured: [] }; pageErrorsFor[g.key] = []; }
  const servers = [];
  const stop = () => servers.splice(0).forEach(s => s.stop());
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(130); });
  process.on('exit', stop);
  let browser;
  try {
    servers.push(...(await Promise.all(games.map(g => (g.landing ? startStatic(g) : startVite(g))))));
    browser = await chromium.launch();
    for (const g of games) {
      try {
        await checkGame(browser, g);
      } catch (e) {
        ok(g.key, 'ran', false, String(e.message || e).split('\n')[0]);
      }
      const errs = pageErrorsFor[g.key];
      ok(g.key, 'no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
    }
  } finally {
    if (browser) await browser.close();
    stop();
  }
  const seconds = Math.round((Date.now() - t0) / 1000);
  const failed = results.filter(r => !r.pass);
  if (reportFile) {
    const byGame = {};
    for (const g of games) {
      const rs = results.filter(r => r.game === g.key);
      byGame[g.key] = {
        checks: rs.length,
        failed: rs.filter(r => !r.pass).map(r => r.what),
        counts: {
          scroll: offenders[g.key].scroll.length,
          contrast: offenders[g.key].contrast.length,
          targets: offenders[g.key].targets.length,
          pageErrors: pageErrorsFor[g.key].length,
          unmeasured: offenders[g.key].unmeasured.length,
        },
        offenders: { scroll: offenders[g.key].scroll, contrast: offenders[g.key].contrast, targets: offenders[g.key].targets },
        // Not failures: text over pixels that cannot be read from the DOM (see audit.cjs).
        unmeasured: offenders[g.key].unmeasured,
        pageErrors: pageErrorsFor[g.key],
      };
    }
    fs.mkdirSync(path.dirname(path.resolve(reportFile)), { recursive: true });
    fs.writeFileSync(reportFile, JSON.stringify({ generatedAt: new Date().toISOString(), seconds, minTarget: MIN_TARGET, viewports: VIEWPORTS, themes: THEMES, games: byGame }, null, 2));
    console.log(`\nReport: ${path.resolve(reportFile)}`);
  }
  if (failed.length) console.log(`Screenshots of failing screens: ${OUT}`);
  console.log(`\n${results.length - failed.length}/${results.length} UI checks passed in ${seconds}s`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
