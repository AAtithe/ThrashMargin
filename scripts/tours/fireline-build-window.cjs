/**
 * Fireline's build window (fireline-round5-design.md, section 3), checked in a real browser.
 *
 * Run after the guided tour by scripts/tours/fireline.cjs, or alone:
 *   TOUR_BASE=http://localhost:5306 node scripts/tours/fireline-build-window.cjs   (with Vite running)
 *
 * On a fresh advanced-tech skirmish it checks that:
 * - every kind in the rules' MENUS is on its tab, greyed (locked) exactly when a structure it needs
 *   is missing, with the lines and tiers the rules give; the round 6 recruits (the Academy, the
 *   heroes, the field General) are absent, since this battle has Heroes and Generals off;
 * - the window opens and closes by the Build button, the backquote key and Esc, focus moving into it
 *   and back to the Build button, and Tab cycles the lists with it open or closed;
 * - a hotkey queues with the window closed (Q, Generator) and with it open (W, Refinery);
 * - picking up a ready structure closes the window; placing it reopens the window on the same tab,
 *   and so does cancelling placement;
 * - a kind the rules have never heard of (`window.__flExtraMenuItem`, a development-only hook) is
 *   laid out at the tier its requirements give, with a line to each structure it needs.
 * No page or console errors.
 */
const path = require('path');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const USER = JSON.stringify({ userId: 'local-dev', username: 'local-dev' });

async function checkBuildWindow(browser, base, problems, out) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('page error: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().includes('React Router Future Flag')) errors.push('console.error: ' + m.text());
  });
  const fail = async msg => {
    problems.push(`build window: ${msg}`);
    if (out) await page.screenshot({ path: path.join(out, `build-window-${problems.length}.png`) }).catch(() => {});
  };
  const isOpen = () => page.locator('#fl-build-window').count().then(n => n > 0);
  const label = () => page.locator('#fl-build-open').textContent();
  const until = async (fn, ms = 5000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await sleep(100);
    }
    return false;
  };

  try {
    await page.goto(base + '/');
    await page.evaluate(u => {
      localStorage.setItem('tm_user', u);
      localStorage.setItem('fireline_tour_seen', '1');
      localStorage.removeItem('fl_build_window');
    }, USER);
    await page.reload();
    await page.getByTestId('tech-advanced').click();
    await page.getByRole('button', { name: /Begin the battle/ }).click();
    await page.waitForURL(/\/game\//);
    await page.locator('#fl-build-open').waitFor();
    // Fast, so the Generator and Refinery the checks build are ready in seconds.
    await page.getByRole('button', { name: 'Fast' }).click();

    // ---- Every menu kind, its greyed state, its tier and its lines -------------------------------
    const rules = await page.evaluate(async () => {
      const r = await import('/src/sim/rules.ts');
      const req = k => (k in r.BUILDINGS ? r.BUILDINGS[k].requires : r.UNITS[k].requires).filter(x => x !== 'hq');
      const memo = {};
      const tier = k => {
        if (k in memo) return memo[k];
        const need = req(k);
        memo[k] = need.length ? 1 + Math.max(...need.map(tier)) : 0;
        return memo[k];
      };
      // Round 6: the Academy, the heroes and the field General are listed only with Heroes or
      // Generals on; this battle has both off, so they must be absent.
      const optional = k => k === r.HERO_ACADEMY || k === 'general' || (k in r.UNITS && !!r.UNITS[k].hero);
      const menus = {};
      const absent = {};
      for (const [tab, list] of Object.entries(r.MENUS)) {
        menus[tab] = list.filter(k => !optional(k)).map(k => ({ kind: k, needs: req(k), tier: tier(k) }));
        absent[tab] = list.filter(optional);
      }
      return { menus, absent, tier: Object.fromEntries(Object.keys(memo).map(k => [k, memo[k]])) };
    });
    const owned = await page.evaluate(() => {
      const k = Object.keys(localStorage).find(x => x.startsWith('fireline_save_'));
      const s = k ? JSON.parse(localStorage.getItem(k)) : null;
      return s ? [...new Set(s.buildings.filter(b => b.owner === 0).map(b => b.kind))] : null;
    });
    if (!owned) await fail('no local save to read the starting base from');
    const has = new Set(owned || ['hq']);

    await page.locator('#fl-build-open').click();
    if (!(await until(isOpen))) await fail('the Build button did not open the window');
    await sleep(200);
    const focusIn = await page.evaluate(() => !!document.getElementById('fl-build-window')?.contains(document.activeElement));
    if (!focusIn) console.log('active:', await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
    if (!focusIn) await fail('focus did not move into the window on open');
    let seen = 0;
    for (const [tab, list] of Object.entries(rules.menus)) {
      await page.locator(`#fl-tab-${tab}`).click();
      await sleep(250);
      for (const item of list) {
        const el = page.locator(`#fl-build-${item.kind}`);
        if (!(await el.count())) {
          await fail(`${item.kind} is not on the ${tab} tab`);
          continue;
        }
        seen++;
        const locked = (await el.getAttribute('data-state')) === 'locked';
        const should = item.needs.some(n => !has.has(n));
        if (locked !== should) await fail(`${item.kind}: ${locked ? 'greyed' : 'not greyed'} at the start, should ${should ? '' : 'not '}be`);
        const col = await el.evaluate(e => e.closest('[data-tier]')?.getAttribute('data-tier'));
        if (col !== String(item.tier)) await fail(`${item.kind} sits in tier column ${col}, the rules give ${item.tier}`);
        for (const n of item.needs) {
          const line = page.locator(`#fl-build-window path[data-from="${item.kind}"][data-to="${n}"]`);
          if (!(await line.count())) await fail(`no line from ${item.kind} to ${n}`);
          else if (!(await line.getAttribute('d'))) await fail(`the line from ${item.kind} to ${n} is empty`);
          if (!(await page.locator(`#fl-build-window [data-node="${n}"]`).count())) await fail(`${item.kind} needs ${n}, which is neither on its tab nor a ghost`);
        }
      }
    }
    for (const [tab, list] of Object.entries(rules.absent)) {
      await page.locator(`#fl-tab-${tab}`).click();
      await sleep(150);
      for (const k of list) if (await page.locator(`#fl-build-${k}`).count()) await fail(`${k} is on the ${tab} tab with Heroes and Generals off`);
    }
    console.log(`  build window: ${seen} menu items checked, ${Object.values(rules.absent).flat().length} kept off with Heroes and Generals off`);

    // ---- Tab cycles, open and closed --------------------------------------------------------------
    await page.locator('#fl-tab-building').click();
    await page.keyboard.press('Tab');
    await sleep(150);
    if (!(await page.locator('#fl-tab-infantry').getAttribute('aria-selected'))?.includes('true')) await fail('Tab with the window open did not move to Infantry');
    await page.keyboard.press('Shift+Tab');
    await sleep(150);

    // ---- Open and close: button, key, Esc ---------------------------------------------------------
    await page.locator('#fl-build-close').click();
    if (!(await until(async () => !(await isOpen())))) await fail('the close button did not close the window');
    await sleep(100);
    if ((await page.evaluate(() => document.activeElement?.id)) !== 'fl-build-open') await fail('focus did not return to the Build button on close');
    await page.keyboard.press('Tab');
    await sleep(150);
    if (!(await label()).includes('Infantry')) await fail(`Tab with the window closed: the Build button reads "${await label()}"`);
    await page.keyboard.press('Shift+Tab');
    await sleep(150);
    if (!(await label()).includes('Structures')) await fail(`Shift+Tab: the Build button reads "${await label()}"`);
    await page.keyboard.press('Backquote');
    if (!(await until(isOpen))) await fail('the backquote key did not open the window');
    await page.keyboard.press('Backquote');
    if (!(await until(async () => !(await isOpen())))) await fail('the backquote key did not close the window');
    await page.locator('#fl-build-open').click();
    await until(isOpen);
    await page.keyboard.press('Escape');
    if (!(await until(async () => !(await isOpen())))) await fail('Esc did not close the window');

    // ---- Hotkeys, window closed then open --------------------------------------------------------
    await page.keyboard.press('q');
    if (!(await until(async () => (await page.locator('[data-testid=strip-building]').count()) > 0))) await fail('Q with the window closed queued nothing');
    else if (!(await page.locator('[data-testid=strip-building] img').count())) await fail('the production strip shows no icon');
    // A ready Generator: Q again picks it up; placing it is the next check.
    if (!(await until(async () => (await page.locator('[data-testid=strip-building]').getAttribute('data-state')) === 'ready', 40000)))
      await fail('the Generator never became ready');

    // ---- Placing from the open window closes it; placing reopens it on the same tab --------------
    await page.locator('#fl-build-open').click();
    await until(isOpen);
    await page.locator('#fl-build-power').click();
    if (!(await until(async () => (await page.locator('#fl-battlefield').getAttribute('data-placing')) === 'power'))) await fail('clicking the ready Generator did not start placement');
    if (await isOpen()) await fail('the window stayed open while placing');
    const field = await page.locator('#fl-battlefield').boundingBox();
    let placed = false;
    for (let r = 40; r < 360 && !placed; r += 24)
      for (let a = 0; a < 6.28 && !placed; a += 0.5) {
        const x = field.x + field.width / 2 + r * Math.cos(a);
        const y = field.y + field.height / 2 + r * Math.sin(a);
        if ((await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [x, y])) !== 'fl-battlefield') continue;
        await page.mouse.move(x, y);
        await sleep(60);
        if ((await page.locator('#fl-battlefield').getAttribute('data-placement')) === 'ok') {
          await page.mouse.click(x, y);
          placed = true;
        }
      }
    if (!placed) await fail('found nowhere to place the Generator');
    if (!(await until(isOpen))) await fail('the window did not reopen after placing');
    else if ((await page.locator('#fl-tab-building').getAttribute('aria-selected')) !== 'true') await fail('the window reopened on another tab');

    await page.keyboard.press('w');
    if (!(await until(async () => (await page.locator('#fl-build-refinery').getAttribute('data-state')) === 'building'))) await fail('W with the window open did not queue a Refinery');
    if (!(await until(async () => (await page.locator('#fl-build-refinery').getAttribute('data-state')) === 'ready', 60000))) await fail('the Refinery never became ready');
    await page.locator('#fl-build-refinery').click();
    if (!(await until(async () => !(await isOpen())))) await fail('picking up the Refinery did not close the window');
    await page.keyboard.press('Escape');
    if (!(await until(isOpen))) await fail('the window did not reopen when placement was cancelled');
    if ((await page.locator('#fl-battlefield').getAttribute('data-placing')) !== '') await fail('Esc did not cancel placement');

    // ---- A kind the window has never seen ---------------------------------------------------------
    const extra = { tab: 'vehicle', kind: 'testwalker', name: 'Test Walker', cost: 1234, requires: ['techcentre', 'researchlab'] };
    const want = 1 + Math.max(...extra.requires.map(k => rules.tier[k] ?? 0));
    await page.evaluate(x => {
      window.__flExtraMenuItem = x;
    }, extra);
    await page.locator('#fl-tab-vehicle').click();
    const ok = await until(async () => (await page.locator('#fl-build-testwalker').count()) > 0);
    if (!ok) await fail('the extra item was not laid out');
    else {
      const col = await page.locator('#fl-build-testwalker').evaluate(e => e.closest('[data-tier]')?.getAttribute('data-tier'));
      if (col !== String(want)) await fail(`the extra item sits in tier ${col}, its requirements give ${want}`);
      for (const n of extra.requires) {
        if (!(await until(async () => (await page.locator(`path[data-from="testwalker"][data-to="${n}"]`).count()) > 0, 2000))) await fail(`no line from the extra item to ${n}`);
        if (!(await page.locator(`#fl-ghost-${n}`).count())) await fail(`no ghost node for ${n} on the Vehicles tab`);
      }
      if ((await page.locator('#fl-build-testwalker').getAttribute('data-state')) !== 'locked') await fail('the extra item is not greyed while its needs are missing');
      if (!(await page.getByText('Needs Tech Centre, Research Lab').count())) await fail('the extra item does not name what it needs');
    }
    await page.evaluate(() => {
      delete window.__flExtraMenuItem;
    });

    // ---- Dragging moves the window and the place is remembered ------------------------------------
    const head = await page.locator('[data-testid=build-window-head]').boundingBox();
    const before = await page.locator('#fl-build-window').boundingBox();
    await page.mouse.move(head.x + 60, head.y + head.height / 2);
    await page.mouse.down();
    await page.mouse.move(head.x - 40, head.y + head.height / 2 + 50, { steps: 6 });
    await page.mouse.up();
    const after = await page.locator('#fl-build-window').boundingBox();
    if (Math.abs(after.x - before.x) < 20 && Math.abs(after.y - before.y) < 20) await fail('dragging the title bar did not move the window');
    const stored = await page.evaluate(() => localStorage.getItem('fl_build_window'));
    if (!stored) await fail('the window place was not remembered');
    const aside = await page.locator('aside').boundingBox();
    if (after.x + after.width > aside.x + 1) await fail('the window reaches over the sidebar');

    for (const e of errors) await fail(e);
  } catch (e) {
    await fail('driver crashed: ' + (e.stack || e.message).split('\n')[0]);
  } finally {
    await ctx.close();
  }
}

module.exports = { checkBuildWindow };

if (require.main === module) {
  const { chromium } = require('playwright');
  const problems = [];
  (async () => {
    const browser = await chromium.launch();
    try {
      await checkBuildWindow(browser, process.env.TOUR_BASE || 'http://localhost:5306', problems, process.env.TOUR_OUT);
    } finally {
      await browser.close();
    }
    if (problems.length) {
      console.log(`fireline build window: ${problems.length} problem(s)`);
      for (const p of problems) console.log('  - ' + p);
      process.exit(1);
    }
    console.log('fireline build window: ok');
  })();
}
