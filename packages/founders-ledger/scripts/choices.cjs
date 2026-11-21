/**
 * Every choice in The Founder's Ledger, tapped in a real browser: `npm run choices --workspace=packages/founders-ledger`.
 *
 * Builds the app, serves it under the production security headers (vercel.json) with an in-memory
 * saves API, and on a phone-sized screen visits every page and checks four things about the tap
 * targets the game is built on:
 *
 *   1. One-answer rows select exactly one choice; many-answer rows respect their limit.
 *   2. "Something else" in a one-answer row replaces the tapped choice, so the typed words are used.
 *   3. A choice tapped but not yet saved survives the page redrawing (a tap elsewhere on the page,
 *      a quick button, a late reply from the coach). This was the bug: it lived only on screen.
 *   4. Each card filled by taps alone and submitted actually saves, with no "Pick ..." complaint.
 *
 * Needs Playwright (preinstalled in CI's browser jobs), so it is not part of `npm run check`.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { chromium, devices } = require('playwright');

const PKG = path.join(__dirname, '..');
const REPO = path.join(PKG, '..', '..');
const DIST = path.join(PKG, 'dist');
const PORT = 5411;

if (!process.argv.includes('--no-build')) execSync('npx vite build --base=/founders-ledger/ --logLevel error', { cwd: PKG, stdio: 'inherit' });

const headerRules = JSON.parse(fs.readFileSync(path.join(REPO, 'vercel.json'), 'utf8')).headers;
const headersFor = p => headerRules.filter(r => new RegExp('^' + r.source.replace(/\(\.\*\)/g, '(.*)') + '$').test(p)).flatMap(r => r.headers);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

let ledger = null;
let version = 0;
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  for (const h of headersFor(u.pathname)) res.setHeader(h.key, h.value);
  if (u.pathname === '/api/play/founders-ledger') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      const id = u.searchParams.get('id');
      const coach = u.searchParams.get('coach');
      if (coach === 'status') return res.end(JSON.stringify({ ai: false }));
      if (coach) { res.statusCode = 503; return res.end('{}'); }
      if (!id && req.method === 'GET') return res.end(JSON.stringify(Object.assign({ saves: ledger ? [{ id: ID }] : [] }, ledger && u.searchParams.get('open') === '1' ? { state: ledger, version } : {})));
      if (!id && req.method === 'POST') { ledger = { v: 2 }; res.statusCode = 201; return res.end(JSON.stringify({ gameId: ID, state: ledger, version: 0 })); }
      if (req.method === 'GET') return res.end(JSON.stringify({ state: ledger, version }));
      if (req.method === 'PUT') { const b = JSON.parse(body); if (b.version !== version) { res.statusCode = 409; return res.end('{}'); } ledger = b.state; version++; return res.end(JSON.stringify({ version })); }
      res.statusCode = 405; res.end();
    });
    return;
  }
  const p = u.pathname.replace(/^\/founders-ledger/, '');
  let file = path.join(DIST, p);
  if (!p || p === '/' || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

const PAGES = [
  ['today', 'today'], ['today', 'reset'], ['week', 'actions'], ['week', 'systems'], ['week', 'review'], ['week', 'off'],
  ['numbers', 'deli'], ['numbers', 'stats'], ['numbers', 'month'], ['coach', 'journal'], ['coach', 'line'], ['coach', 'coach'], ['coach', 'calls'], ['future', 'future'],
];
// Steps that are complaints, not confirmations.
const COMPLAINT = /^(Pick|Fill|Write|Say|Choose|Add at least|Give)/;

let passed = 0;
const failures = [];
const ok = (c, m) => { if (c) passed++; else failures.push(m); };

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  // A Wednesday morning, so the morning card and the week's due items are all on show.
  await page.clock.install({ time: new Date('2026-11-18T08:30:00') });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/503|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const wait = ms => page.waitForTimeout(ms);
  const status = async () => ((await page.textContent('#status').catch(() => '')) || '').trim();

  await page.goto(`http://localhost:${PORT}/founders-ledger/`);
  const token = 'h.' + Buffer.from(JSON.stringify({ rem: 1, exp: Math.floor(Date.now() / 1000) + 30 * 86400 })).toString('base64') + '.s';
  await page.evaluate(t => {
    localStorage.setItem('tm_token', t);
    localStorage.setItem('tm_last_active', String(Date.now()));
    localStorage.setItem('tm_user', JSON.stringify({ userId: 'u1', username: 'tom', isAdmin: true, games: ['founders_ledger'] }));
  }, token);
  await page.reload();
  await page.waitForSelector('#board');
  await page.tap('[data-act=saveBaseline]');
  await wait(1000);
  const snapshot = JSON.parse(JSON.stringify(ledger));

  // A fresh ledger for each page, so one page's taps cannot hide another's problem.
  const fresh = async (group, view) => {
    ledger = Object.assign(JSON.parse(JSON.stringify(snapshot)), { view, lastPage: { [group]: view }, reminderDay: '2026-11-18' });
    version++;
    await page.reload();
    await page.waitForSelector('#board');
    await wait(200);
  };
  const rowsOnPage = () => page.$$eval('#view .chips-row', rows => rows.map(r => ({
    group: r.dataset.group, multi: r.dataset.multi === '1', max: Number(r.dataset.max) || 0,
    act: !!r.querySelector('[data-pact]'), other: !!r.querySelector('[data-other]'),
    n: r.querySelectorAll('.pick:not(.other)').length, visible: r.offsetParent !== null,
  })).filter(r => r.visible && r.n && r.group));
  const selIn = g => page.$$eval(`.chips-row[data-group="${g}"] .pick.sel`, xs => xs.map(x => x.dataset.val || '(something else)'));
  const chip = (g, i) => page.locator(`.chips-row[data-group="${g}"] .pick:not(.other)`).nth(i);

  for (const [group, view] of PAGES) {
    const where = `${view}`;
    await fresh(group, view);
    const rows = await rowsOnPage();

    // 1 and 2: selection rules, row by row.
    for (const r of rows.filter(x => !x.act)) {
      if (!r.multi) {
        await chip(r.group, 0).tap();
        if (r.n > 1) await chip(r.group, 1).tap();
        const s = await selIn(r.group);
        ok(s.length === 1, `${where} ${r.group}: one-answer row has ${s.length} selected`);
        if (r.other) {
          await page.tap(`[data-other="${r.group}"]`);
          await page.fill(`#other-${r.group}`, 'In my own words');
          const after = await selIn(r.group);
          ok(after.length === 1 && after[0] === '(something else)', `${where} ${r.group}: Something else leaves [${after.join(', ')}] selected, so the typed words are not used`);
          await page.tap(`[data-other="${r.group}"]`); // close it again
        }
      } else if (r.max && r.n > r.max) {
        for (let i = 0; i <= r.max; i++) await chip(r.group, i).tap();
        const s = await selIn(r.group);
        ok(s.length === r.max, `${where} ${r.group}: limit ${r.max}, ${s.length} selected`);
      }
    }

    // 3: unsaved choices survive a redraw of the same page.
    await fresh(group, view);
    const plain = (await rowsOnPage()).filter(x => !x.act);
    const redraws = [];
    if ((await rowsOnPage()).some(x => x.act)) redraws.push('act');
    if (await page.isVisible('[data-act=quick][data-k=good]')) redraws.push('quick');
    if (plain.length && redraws.length) {
      for (const r of plain) await chip(r.group, r.n > 1 ? 1 : 0).tap();
      const before = {};
      for (const r of plain) before[r.group] = await selIn(r.group);
      for (const how of redraws) {
        if (how === 'quick') { await page.tap('[data-act=quick][data-k=good]'); await wait(150); }
        else {
          // Tap a choice that acts at once (and redraws) in a row other than the ones being checked.
          const actRow = (await rowsOnPage()).find(x => x.act && !/^(reset-|rs-|lq-|away-plan|habit-add|session-take)/.test(x.group));
          if (!actRow) continue;
          await chip(actRow.group, 0).tap();
          await wait(250);
        }
        for (const r of plain) {
          if (!(await page.isVisible(`.chips-row[data-group="${r.group}"]`))) continue;
          const now = await selIn(r.group);
          ok(JSON.stringify(now) === JSON.stringify(before[r.group]), `${where} ${r.group}: choice [${before[r.group].join(', ')}] lost when the page redrew (${how}); now [${now.join(', ')}]`);
        }
      }
    }

    // 4: each card filled by taps alone saves when submitted.
    await fresh(group, view);
    const cards = await page.$$eval('#view .card', cs => cs.map((c, i) => ({
      i,
      rows: [...c.querySelectorAll('.chips-row[data-group]')].filter(r => r.offsetParent !== null && !r.querySelector('[data-pact]') && r.querySelector('.pick')).map(r => r.dataset.group),
      submit: (c.querySelector('.btn[data-act]:not(.ghost)') || {}).dataset?.act || null,
    })).filter(c => c.rows.length && c.submit));
    for (const c of cards) {
      await fresh(group, view);
      const card = page.locator('#view .card').nth(c.i);
      for (const g of c.rows) if (await page.isVisible(`.chips-row[data-group="${g}"]`)) await chip(g, 0).tap();
      for (const inp of await card.locator('input[type=number]:visible').all()) await inp.fill('100');
      for (const ta of await card.locator('textarea:visible').all()) if (!(await ta.inputValue())) await ta.fill('A line in my own words');
      const v0 = version;
      await card.locator(`.btn[data-act="${c.submit}"]:not(.ghost)`).first().tap();
      await wait(1100);
      const st = await status();
      ok(!COMPLAINT.test(st), `${where} card with [${c.rows.join(', ')}]: ${c.submit} complained "${st}" after every row was answered`);
      ok(version > v0 || /Copied|calendar/i.test(st), `${where} card with [${c.rows.join(', ')}]: ${c.submit} saved nothing`);
    }

    // Every act-at-once choice on the page runs without an error.
    for (const r of (await rowsOnPage()).filter(x => x.act)) {
      await fresh(group, view);
      if (!(await page.isVisible(`.chips-row[data-group="${r.group}"]`))) continue;
      const before = errors.length;
      await chip(r.group, 0).tap();
      await wait(300);
      ok(errors.length === before, `${where} ${r.group}: tapping a choice raised ${errors.slice(before).join(' | ')}`);
    }
  }

  // The flows people use most, end to end by taps.
  await fresh('today', 'today');
  await page.tap('#resetTop');
  await chip('rs-loud', 0).tap();
  await chip('rs-sort', 0).tap();
  await wait(200);
  await chip('reset-rule', 0).tap().catch(() => {});
  await page.locator('[data-act=resetNext]').tap().catch(() => {});
  await wait(200);
  await page.locator('[data-pact="reset-move"]').first().tap();
  await wait(1100);
  ok((ledger.resets || []).length === 1, 'flow: a reset by taps alone is saved');

  // Above the line: below, name it, pick a shift, back above.
  await fresh('coach', 'line');
  await page.tap('[data-act=lineBelowStart]');
  await chip('ln-signs', 0).tap(); await chip('ln-signs', 3).tap();
  await chip('ln-trigger', 1).tap();
  await page.tap('[data-act=lineBelow]');
  await wait(300);
  await chip('ln-shift', 0).tap();
  await wait(300);
  await page.tap('[data-act=lineResult][data-k=yes]');
  await wait(1100);
  const L = ledger.line || [];
  ok(L.length === 1 && L[0].signs.length === 2 && L[0].trigger === 'The deli' && L[0].shift && L[0].worked === 'yes', 'flow: below the line, named, shifted, back above, saved');
  // Below, typing your own shift.
  await page.tap('[data-act=lineBelowStart]'); await page.tap('[data-act=lineBelow]'); await wait(300);
  await page.tap('[data-other="ln-shift"]'); await page.fill('#other-ln-shift', 'Ten minutes in the park');
  await page.tap('[data-act=lineOther]'); await wait(1100);
  ok((ledger.line || []).slice(-1)[0].shift === 'Ten minutes in the park' && ledger.shifts.includes('Ten minutes in the park'), 'flow: a shift in his own words is used and kept');

  ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`\n${passed + failures.length} checks, ${failures.length} failed`);
  for (const f of failures) console.log('  FAIL ' + f);
  await browser.close();
  server.close();
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
