#!/usr/bin/env node
// Drives every game's loading states in a real browser. The standard it checks is in
// loading-animations-plan.md; the component is shared/portal/client/Loading.tsx.
//
//   npm run check:loading                 all five games
//   npm run check:loading -- tea-race     one game
//
// Starts each game's Vite dev server itself and stops it afterwards. Every API call is
// intercepted, so no database or server is needed, and nothing here touches the sign-in gate:
// the stored user and token are set in localStorage exactly as a signed-in browser would hold
// them, and the server (which this never reaches) would still refuse the fake token.
//
// Needs Playwright with Chromium (require('playwright')). Not part of `npm run check`, because
// that runs on Vercel and in CI without a browser. Run it after changing anything a loading state
// touches: Loading.tsx, a game screen's load branch, a lobby's saves list, or an index.html.
//
// Why a browser at all: every bug this work has turned up (a loader that blinked between two
// stages, a caption off the edge of the screen, "Campaign not found." for one frame) passed tsc
// and every game's test suite, because none of them render anything.
'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('This check needs Playwright with Chromium: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..');
const GAMES = [
  { key: 'thrash-margin', dir: 'packages/thrash-margin/client', port: 5173, begin: 'Start campaign', accentVar: '--ui-accent' },
  { key: 'niccolo', dir: 'packages/niccolo', port: 5174, begin: 'Begin →', accentVar: '--ui-brass' },
  { key: 'tea-race', dir: 'packages/tea-race', port: 5175, begin: /Begin with/, accentVar: '--ui-brass' },
  { key: 'steady-eddie', dir: 'packages/steady-eddie', port: 5176, begin: /Begin with/, accentVar: '--ui-brass' },
  { key: 'niccolo-rising', dir: 'packages/niccolo-rising', port: 5177, begin: 'Begin →', accentVar: '--ui-brass' },
  { key: 'fireline', dir: 'packages/fireline', port: 5178, begin: /Begin the battle/, accentVar: '--ui-accent' },
  // No lobby or Begin: it opens the account's one ledger directly, so checkLedger runs it.
  { key: 'founders-ledger', dir: 'packages/founders-ledger', port: 5179, ledger: true },
];
const SIGN_IN_AGAIN = 'Your sign-in has expired. Sign in again to open this game.';
const only = process.argv[2];

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
// Shaped like the server's token so lib/session.ts treats the session as live. Signed with
// nothing: no request carrying it ever leaves the browser, and the real API would 401 it.
const FAKE_JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'local-dev', exp: 4102444800 })}.unsigned`;
const USER = JSON.stringify({ userId: 'local-dev', username: 'local-dev', isAdmin: false });
const wait = ms => new Promise(r => setTimeout(r, ms));

const results = [];
function ok(game, what, pass, extra = '') {
  results.push({ game, what, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${game.padEnd(15)} ${what}${extra ? `  (${extra})` : ''}`);
}

function startServer(g) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['vite', '--strictPort', '--port', String(g.port)], {
      cwd: path.join(ROOT, g.dir),
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own process group, so stopping it stops Vite too and not only the npx wrapper; a
      // leftover Vite holds the port and the next run cannot start.
      detached: true,
    });
    let out = '';
    const timer = setTimeout(() => reject(new Error(`${g.key}: dev server did not start\n${out}`)), 60000);
    const onData = d => {
      out += d;
      if (out.includes('Local:')) { clearTimeout(timer); resolve(child); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`${g.key}: dev server exited (${code})\n${out}`)); });
  });
}

/** A fresh browser context, seeded once (sessionStorage survives reloads, so a reload keeps state). */
async function context(browser, { theme = 'light', signedIn = false, reduced = false, pace = null } = {}) {
  const c = await browser.newContext({ viewport: { width: 1100, height: 760 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await c.addInitScript(([user, jwt, theme, signedIn, pace]) => {
    if (sessionStorage.getItem('loading-check')) return;
    sessionStorage.setItem('loading-check', '1');
    localStorage.setItem('tm_user', user);
    localStorage.setItem('tm_theme', theme);
    // The portal's own animation pace (lib/motion.ts); null leaves it unset, as a new browser has it.
    if (pace) localStorage.setItem('tm_motion', pace);
    if (signedIn) {
      localStorage.setItem('tm_token', jwt);
      localStorage.setItem('tm_last_active', String(Date.now()));
    }
  }, [USER, FAKE_JWT, theme, signedIn, pace]);
  return c;
}

/** Serves saves: the list (empty) and one game, each after `delay`; `game` decides the reply. */
function serve(page, { delay = 0, game }) {
  return page.route('**/api/play/**', async route => {
    const req = route.request();
    if (delay) await wait(delay);
    if (req.method() !== 'GET') return route.fulfill({ status: 200, json: { ok: true, version: 2 } });
    if (!new URL(req.url()).searchParams.get('id')) return route.fulfill({ status: 200, json: { saves: [] } });
    return route.fulfill(game());
  });
}

const opacity = (page, sel) => page.locator(sel).first().evaluate(e => Number(getComputedStyle(e).opacity)).catch(() => null);

async function checkGame(browser, g) {
  const base = `http://localhost:${g.port}`;
  const pageErrors = [];
  const track = p => p.on('pageerror', e => pageErrors.push(String(e)));

  // A real state to serve, made the way a player makes one (the local path, no token).
  let c = await context(browser);
  let p = await c.newPage();
  track(p);
  await p.goto(base + '/');
  await p.getByRole('button', { name: g.begin }).first().click();
  await p.waitForURL(/\/game\//, { timeout: 15000 });
  const id = p.url().split('/game/')[1].split(/[?#]/)[0];
  if (g.key === 'niccolo') await p.getByRole('button', { name: 'Get to work' }).click({ timeout: 5000 }).catch(() => {});
  const tourSel = g.key === 'niccolo' ? 'button:has-text("Skip"), button:has-text("Explore on my own")' : '[data-tour-target], [data-tour-manual]';
  if (g.tour !== false) ok(g.key, 'guided tour still offered once the game opens', await p.locator(tourSel).first().waitFor({ timeout: 5000 }).then(() => true, () => false));
  else await p.locator('[data-testid=battlefield]').waitFor({ timeout: 10000 }).catch(() => {});
  const state = await p.evaluate(id => {
    let best = null;
    for (let i = 0; i < localStorage.length; i++) {
      const v = localStorage.getItem(localStorage.key(i));
      if (!v || !v.includes(id)) continue;
      try { const o = JSON.parse(v); if (o && o.id === id && (!best || v.length > JSON.stringify(best).length)) best = o; } catch { /* not JSON */ }
    }
    return best;
  }, id);
  ok(g.key, 'captured a state to serve', !!state);
  await c.close();
  const served = () => ({ status: 200, json: { state, version: 1 } });

  // Slow load, both modes: hidden for 300ms, visible after; the game opens when the save lands.
  // The saves list on the lobby: placeholder rows, then gone.
  for (const theme of ['light', 'dark']) {
    c = await context(browser, { theme, signedIn: true });
    p = await c.newPage();
    track(p);
    await serve(p, { delay: 2500, game: served });
    await p.goto(`${base}/game/${id}`);
    await wait(120);
    const early = await opacity(p, '[data-testid=loading-screen] .wsl-loader');
    ok(g.key, `[${theme}] loader hidden for the first 300ms`, early !== null && early < 0.2, `opacity ${early}`);
    await wait(900);
    const late = await opacity(p, '[data-testid=loading-screen] .wsl-loader');
    ok(g.key, `[${theme}] loader visible after the delay`, late !== null && late > 0.9, `opacity ${late}`);
    const opened = await p.locator('[data-testid=loading-screen]').waitFor({ state: 'detached', timeout: 8000 }).then(() => true, () => false);
    ok(g.key, `[${theme}] game opens when the save arrives`, opened);

    await p.goto(base + '/');
    await wait(900);
    ok(g.key, `[${theme}] lobby shows placeholder rows while saves load`, (await p.locator('[data-testid=loading-rows]').count()) > 0);
    // Wait for none at all: a lobby may hold several lists (Fireline lists campaigns and battles), and
    // locator.waitFor demands exactly one match, so it errors, rather than waits, when there are two.
    const gone = await p.waitForFunction(() => !document.querySelector('[data-testid=loading-rows]'), null, { timeout: 8000 }).then(() => true, () => false);
    ok(g.key, `[${theme}] placeholder rows go once the list answers`, gone);
    await c.close();
  }

  // A load that hangs: after 8 seconds the loader offers a way out, and Try again works.
  c = await context(browser, { signedIn: true });
  p = await c.newPage();
  track(p);
  let hang = true;
  await p.route('**/api/play/**', async route => {
    const req = route.request();
    if (!new URL(req.url()).searchParams.get('id')) return route.fulfill({ status: 200, json: { saves: [] } });
    if (hang) return; // never answered
    return route.fulfill(served());
  });
  await p.goto(`${base}/game/${id}`);
  await wait(2000);
  const hiddenEarly = await p.locator('[data-testid=loading-slow]').evaluate(e => getComputedStyle(e).visibility).catch(() => 'missing');
  ok(g.key, 'slow-load actions hidden (and unfocusable) at 2s', hiddenEarly === 'hidden', hiddenEarly);
  await wait(7000);
  const shownLate = await p.locator('[data-testid=loading-slow]').evaluate(e => getComputedStyle(e).visibility).catch(() => 'missing');
  ok(g.key, 'slow-load actions offered after 8s', shownLate === 'visible', shownLate);
  hang = false;
  await p.locator('[data-testid=loading-slow]').getByRole('button', { name: 'Try again' }).click({ timeout: 3000 }).catch(() => {});
  ok(g.key, 'Try again on a hung load opens the game',
    await p.locator('[data-testid=loading-screen]').waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false));
  await c.close();

  // A failed load: error view at once, Try again re-fetches. Dev mode's StrictMode loads twice, so
  // the server keeps failing until Try again is pressed.
  c = await context(browser, { signedIn: true });
  p = await c.newPage();
  track(p);
  let fail = true;
  let calls = 0;
  await serve(p, { game: () => { calls++; return fail ? { status: 500, json: { message: 'The server could not load this game (test).' } } : served(); } });
  await p.goto(`${base}/game/${id}`);
  const errShown = await p.locator('[data-testid=loading-error]').waitFor({ timeout: 5000 }).then(() => true, () => false);
  ok(g.key, 'failed load shows the error view, role=alert', errShown && (await p.locator('[data-testid=loading-error]').getAttribute('role')) === 'alert');
  const before = calls;
  fail = false;
  await p.getByRole('button', { name: 'Try again' }).click({ timeout: 5000 }).catch(() => {});
  const recovered = await p.locator('[data-testid=loading-error]').waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false);
  ok(g.key, 'Try again re-fetches and opens the game', recovered && calls > before, `requests ${before} -> ${calls}`);
  await c.close();

  // An expired sign-in: say so plainly, no Try again, and Sign in again lands on the sign-in panel.
  c = await context(browser, { signedIn: true });
  p = await c.newPage();
  track(p);
  await serve(p, { game: () => ({ status: 401, json: { message: 'Unauthorized' } }) });
  await p.goto(`${base}/game/${id}`);
  await p.locator('[data-testid=loading-error]').waitFor({ timeout: 5000 }).catch(() => {});
  const text = (await p.locator('[data-testid=loading-error]').innerText().catch(() => '')).trim();
  const retry = await p.locator('[data-testid=loading-error]').getByRole('button', { name: 'Try again' }).count();
  ok(g.key, 'expired sign-in: plain message, no Try again', text.includes(SIGN_IN_AGAIN) && retry === 0, text.split('\n')[0]);
  await p.getByRole('button', { name: 'Sign in again' }).click({ timeout: 3000 }).catch(() => {});
  await wait(800);
  const after = await p.evaluate(() => ({ path: location.pathname, token: localStorage.getItem('tm_token'), user: localStorage.getItem('tm_user') }));
  ok(g.key, 'Sign in again clears the session and returns to the lobby',
    !after.path.includes('/game/') && after.token === null && after.user === null, JSON.stringify(after));
  await c.close();

  // Reduced motion: the loader appears, after its delay, and nothing in it moves.
  c = await context(browser, { signedIn: true, reduced: true });
  p = await c.newPage();
  await serve(p, { delay: 3000, game: served });
  await p.goto(`${base}/game/${id}`);
  await wait(120);
  const rmEarly = await opacity(p, '.wsl-loader');
  await wait(700);
  const rm = await p.evaluate(() => {
    const els = [...document.querySelectorAll('[data-testid=loading-screen] svg *')];
    const l = document.querySelector('.wsl-loader');
    return { parts: els.length, moving: els.filter(e => getComputedStyle(e).animationName !== 'none').length, opacity: l ? Number(getComputedStyle(l).opacity) : null };
  });
  ok(g.key, 'reduced motion: still delayed, then shown, nothing moving',
    rmEarly !== null && rmEarly < 0.2 && rm.parts > 0 && rm.moving === 0 && rm.opacity > 0.9, JSON.stringify({ early: rmEarly, ...rm }));
  await c.close();

  // Motion: off (the portal's own setting, lib/motion.ts) stills the loader the same way, with no
  // OS reduced-motion preference set.
  c = await context(browser, { signedIn: true, pace: 'off' });
  p = await c.newPage();
  await serve(p, { delay: 3000, game: served });
  await p.goto(`${base}/game/${id}`);
  await wait(820);
  const mo = await p.evaluate(() => {
    const els = [...document.querySelectorAll('[data-testid=loading-screen] svg *')];
    const l = document.querySelector('.wsl-loader');
    return { parts: els.length, moving: els.filter(e => getComputedStyle(e).animationName !== 'none').length, opacity: l ? Number(getComputedStyle(l).opacity) : null };
  });
  ok(g.key, 'Motion: off: loader shown, nothing moving', mo.parts > 0 && mo.moving === 0 && mo.opacity > 0.9, JSON.stringify(mo));
  await c.close();

  // The CSS-only loader in index.html while the bundle is held back, both modes; then its
  // colours checked against the game's real tokens, which it copies by hand.
  for (const theme of ['light', 'dark']) {
    c = await context(browser, { theme });
    p = await c.newPage();
    let release;
    const held = new Promise(r => { release = r; });
    await p.route(/\/src\/main\.tsx/, async route => { await held; route.continue(); });
    await p.goto(base + '/', { waitUntil: 'commit' });
    await wait(1000);
    const boot = await opacity(p, '[data-testid=boot-loader]');
    ok(g.key, `[${theme}] static loader covers the bundle download`, boot !== null && boot > 0.9, `opacity ${boot}`);
    release();
    await p.waitForFunction(() => !document.querySelector('[data-testid=boot-loader]'), null, { timeout: 15000 }).catch(() => {});
    await wait(300);
    const drift = await p.evaluate(accentVar => {
      const cs = getComputedStyle(document.documentElement);
      const v = n => cs.getPropertyValue(n).trim().toLowerCase();
      return [['--boot-ground', '--ui-ground'], ['--boot-soft', '--ui-text-soft'], ['--boot-accent', accentVar]]
        .filter(([a, b]) => v(a) !== v(b)).map(([a, b]) => `${a} ${v(a)} != ${b} ${v(b)}`);
    }, g.accentVar);
    ok(g.key, `[${theme}] static loader colours match the game's tokens`, drift.length === 0, drift.join('; '));
    await c.close();
  }

  // Begin: one busy ring, on the button pressed.
  c = await context(browser, { signedIn: true });
  p = await c.newPage();
  await p.route('**/api/play/**', async route => {
    if (route.request().method() === 'POST') { await wait(3000); return route.fulfill({ status: 500, json: { message: 'test' } }); }
    return route.fulfill({ status: 200, json: { saves: [] } });
  });
  await p.goto(base + '/');
  await p.getByRole('button', { name: g.begin }).first().click();
  await wait(400);
  ok(g.key, 'Begin shows one busy ring while the game is created', (await p.locator('button .wsl-busy').count()) === 1);
  await c.close();

  // Banco di Niccolò loads in two stages (code chunk, then save): one fade-in, no blink between.
  if (g.key === 'niccolo') {
    c = await context(browser, { signedIn: true });
    p = await c.newPage();
    await p.route(/\/src\/pages\/GameScreen\.tsx/, async route => { await wait(1000); route.continue(); });
    await serve(p, { delay: 1500, game: served });
    const t0 = Date.now();
    await p.goto(`${base}/game/${id}`, { waitUntil: 'commit' });
    let seen = false;
    let blinks = 0;
    while (Date.now() - t0 < 3500) {
      const o = await opacity(p, '.wsl-loader');
      if (o !== null && o > 0.9) seen = true;
      else if (seen && o !== null && o < 0.5) blinks++;
      await wait(50);
    }
    ok(g.key, 'two-stage load: no blink at the handover', seen && blinks === 0, `blink samples ${blinks}`);
    await c.close();
  }

  ok(g.key, 'no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
}

/**
 * The Founder's Ledger has no lobby, no Begin and no /game/:id: the app opens the account's one
 * ledger straight away (list, create if none, then load by id; pages/LedgerScreen.tsx). So it gets
 * its own run of the same standard, plus a colour check: it names its palette differently and hands
 * it to the shared loader through --ui-* aliases in styles.css, which were once missing (the words
 * and the error glyph came out in the portal's greys and red around a green motif).
 */
async function checkLedger(browser, g) {
  const base = `http://localhost:${g.port}`;
  const pageErrors = [];
  const track = p => p.on('pageerror', e => pageErrors.push(String(e)));
  const LEDGER_ID = 'ledger-check-1';
  // The engine starts a fresh ledger from a null state, as it does on an account's first visit.
  const opened = () => ({ status: 200, json: { state: null, version: 1 } });
  const route = (page, { delay = 0, one }) =>
    page.route('**/api/play/**', async r => {
      const req = r.request();
      if (delay) await wait(delay);
      if (req.method() !== 'GET') return r.fulfill({ status: 200, json: { ok: true, version: 2 } });
      if (!new URL(req.url()).searchParams.get('id')) return r.fulfill({ status: 200, json: { saves: [{ id: LEDGER_ID }] } });
      return r.fulfill(one());
    });
  const ready = p => p.waitForFunction(() => {
    const host = document.querySelector('.fl-host');
    return !document.querySelector('[data-testid=loading-screen]') && host && !host.hidden && host.childElementCount > 0;
  }, null, { timeout: 8000 }).then(() => true, () => false);
  // The colour a token resolves to here, as the browser would paint it.
  const resolve = (p, token) => p.evaluate(t => {
    const s = document.createElement('span');
    s.style.color = `var(${t})`;
    document.body.appendChild(s);
    const c = getComputedStyle(s).color;
    s.remove();
    return c;
  }, token);

  for (const theme of ['light', 'dark']) {
    const c = await context(browser, { theme, signedIn: true });
    const p = await c.newPage();
    track(p);
    await route(p, { delay: 2500, one: opened });
    await p.goto(base + '/');
    await wait(120);
    const early = await opacity(p, '[data-testid=loading-screen] .wsl-loader');
    ok(g.key, `[${theme}] loader hidden for the first 300ms`, early !== null && early < 0.2, `opacity ${early}`);
    await wait(900);
    const late = await opacity(p, '[data-testid=loading-screen] .wsl-loader');
    ok(g.key, `[${theme}] loader visible after the delay`, late !== null && late > 0.9, `opacity ${late}`);
    const caption = await p.locator('[data-testid=loading-screen] p').first().evaluate(e => getComputedStyle(e).color).catch(() => null);
    const muted = await resolve(p, '--muted');
    ok(g.key, `[${theme}] loader caption in the game's own --muted`, caption === muted, `${caption} vs ${muted}`);
    ok(g.key, `[${theme}] ledger opens when the save arrives`, await ready(p));
    await c.close();
  }

  // A load that hangs: after 8 seconds Try again is offered, and it works.
  {
    const c = await context(browser, { signedIn: true });
    const p = await c.newPage();
    track(p);
    let hang = true;
    await p.route('**/api/play/**', async r => {
      if (hang) return; // never answered
      const req = r.request();
      if (!new URL(req.url()).searchParams.get('id')) return r.fulfill({ status: 200, json: { saves: [{ id: LEDGER_ID }] } });
      return r.fulfill(opened());
    });
    await p.goto(base + '/');
    await wait(2000);
    const hiddenEarly = await p.locator('[data-testid=loading-slow]').evaluate(e => getComputedStyle(e).visibility).catch(() => 'missing');
    ok(g.key, 'slow-load actions hidden (and unfocusable) at 2s', hiddenEarly === 'hidden', hiddenEarly);
    await wait(7000);
    const shownLate = await p.locator('[data-testid=loading-slow]').evaluate(e => getComputedStyle(e).visibility).catch(() => 'missing');
    ok(g.key, 'slow-load actions offered after 8s', shownLate === 'visible', shownLate);
    hang = false;
    await p.locator('[data-testid=loading-slow]').getByRole('button', { name: 'Try again' }).click({ timeout: 3000 }).catch(() => {});
    ok(g.key, 'Try again on a hung load opens the ledger', await ready(p));
    await c.close();
  }

  // A failed load: error view at once, in the game's own --bad, and Try again recovers.
  {
    const c = await context(browser, { signedIn: true });
    const p = await c.newPage();
    track(p);
    let fail = true;
    let calls = 0;
    await route(p, { one: () => { calls++; return fail ? { status: 500, json: { message: 'The server could not open this ledger (test).' } } : opened(); } });
    await p.goto(base + '/');
    const shown = await p.locator('[data-testid=loading-error]').waitFor({ timeout: 5000 }).then(() => true, () => false);
    ok(g.key, 'failed load shows the error view, role=alert', shown && (await p.locator('[data-testid=loading-error]').getAttribute('role')) === 'alert');
    const glyph = await p.locator('[data-testid=loading-error] svg circle').first().evaluate(e => getComputedStyle(e).stroke).catch(() => null);
    const bad = await resolve(p, '--bad');
    ok(g.key, "error glyph in the game's own --bad", glyph === bad, `${glyph} vs ${bad}`);
    const before = calls;
    fail = false;
    await p.getByRole('button', { name: 'Try again' }).click({ timeout: 5000 }).catch(() => {});
    ok(g.key, 'Try again re-fetches and opens the ledger', (await ready(p)) && calls > before, `requests ${before} -> ${calls}`);
    await c.close();
  }

  // An expired sign-in: plain message, no Try again, a link to sign in that comes back here.
  {
    const c = await context(browser, { signedIn: true });
    const p = await c.newPage();
    track(p);
    await p.route('**/api/play/**', r => r.fulfill({ status: 401, json: { message: 'Unauthorized' } }));
    await p.goto(base + '/');
    await p.locator('[data-testid=loading-error]').waitFor({ timeout: 5000 }).catch(() => {});
    const text = (await p.locator('[data-testid=loading-error]').innerText().catch(() => '')).trim();
    const retry = await p.locator('[data-testid=loading-error]').getByRole('button', { name: 'Try again' }).count();
    const href = await p.getByRole('link', { name: 'Sign in again' }).getAttribute('href').catch(() => null);
    ok(g.key, 'expired sign-in: plain message, no Try again, Sign in again link',
      text.includes(SIGN_IN_AGAIN) && retry === 0 && !!href && href.includes('/login') && href.includes('founders-ledger'), `${href}`);
    await c.close();
  }

  // Reduced motion: still delayed, then shown, nothing moving.
  {
    const c = await context(browser, { signedIn: true, reduced: true });
    const p = await c.newPage();
    await route(p, { delay: 3000, one: opened });
    await p.goto(base + '/');
    await wait(120);
    const rmEarly = await opacity(p, '.wsl-loader');
    await wait(700);
    const rm = await p.evaluate(() => {
      const els = [...document.querySelectorAll('[data-testid=loading-screen] svg *')];
      const l = document.querySelector('.wsl-loader');
      return { parts: els.length, moving: els.filter(e => getComputedStyle(e).animationName !== 'none').length, opacity: l ? Number(getComputedStyle(l).opacity) : null };
    });
    ok(g.key, 'reduced motion: still delayed, then shown, nothing moving',
      rmEarly !== null && rmEarly < 0.2 && rm.parts > 0 && rm.moving === 0 && rm.opacity > 0.9, JSON.stringify({ early: rmEarly, ...rm }));
    await c.close();
  }

  // The CSS-only loader in index.html while the bundle is held back, and its hand-copied colours.
  for (const theme of ['light', 'dark']) {
    const c = await context(browser, { theme });
    const p = await c.newPage();
    let release;
    const held = new Promise(r => { release = r; });
    await p.route(/\/src\/main\.tsx/, async r => { await held; r.continue(); });
    await p.goto(base + '/', { waitUntil: 'commit' });
    await wait(1000);
    const boot = await opacity(p, '[data-testid=boot-loader]');
    ok(g.key, `[${theme}] static loader covers the bundle download`, boot !== null && boot > 0.9, `opacity ${boot}`);
    release();
    await p.waitForFunction(() => !document.querySelector('[data-testid=boot-loader]'), null, { timeout: 15000 }).catch(() => {});
    await wait(300);
    const drift = await p.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const v = n => cs.getPropertyValue(n).trim().toLowerCase();
      return [['--boot-ground', '--bg'], ['--boot-soft', '--muted'], ['--boot-accent', '--accent']]
        .filter(([a, b]) => v(a) !== v(b)).map(([a, b]) => `${a} ${v(a)} != ${b} ${v(b)}`);
    });
    ok(g.key, `[${theme}] static loader colours match the game's tokens`, drift.length === 0, drift.join('; '));
    await c.close();
  }

  ok(g.key, 'no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
}

(async () => {
  const games = GAMES.filter(g => !only || g.key === only);
  if (!games.length) { console.error(`Unknown game "${only}". One of: ${GAMES.map(g => g.key).join(', ')}`); process.exit(2); }
  const servers = [];
  const stop = () => servers.splice(0).forEach(s => { try { process.kill(-s.pid, 'SIGTERM'); } catch { /* already gone */ } });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(130); });
  process.on('exit', stop);
  let browser;
  try {
    servers.push(...(await Promise.all(games.map(startServer))));
    browser = await chromium.launch();
    for (const g of games) await (g.ledger ? checkLedger(browser, g) : checkGame(browser, g));
  } finally {
    if (browser) await browser.close();
    stop();
  }
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} loading checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
