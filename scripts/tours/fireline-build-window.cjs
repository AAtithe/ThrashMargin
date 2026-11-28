/**
 * Fireline's build window (fireline-round5-design.md section 3, rebuilt in round 8:
 * fireline-round8-build-window.md), checked in a real browser.
 *
 * Run after the guided tour by scripts/tours/fireline.cjs, or alone:
 *   TOUR_BASE=http://localhost:5306 node scripts/tours/fireline-build-window.cjs   (with Vite running)
 *
 * On a fresh advanced-tech skirmish on a fixed Coast map (so the Naval tab is always there) it checks that:
 * - Build view: every kind in the rules' MENUS is on its tab, greyed (locked) exactly when a structure
 *   it needs is missing; a buildable one is a card under its group, a locked one is on the Coming next
 *   row naming exactly what it lacks (each of those buildable now) or in Later; the round 6 recruits and
 *   the economy's toggled structures are absent, as Heroes, Generals and those toggles are off;
 * - every structure has a hotkey when its group is active, no two alike; Tab walks the groups and then
 *   the other lists, the Build button naming the group, with the window open or closed;
 * - Tech tree view: every kind in the tier column the rules give, no lines until an item is pointed
 *   at, then exactly the lines of its chain; a kind the rules have never heard of
 *   (`window.__flExtraMenuItem`, development only) laid out at its tier with its lines;
 * - the build rail down the battlefield's left edge: one button per list, each opening the window
 *   docked against it on that list and closing it when pressed again; Structures pops out a column of
 *   its groups and only the chosen group's items beside it;
 * - the window opens and closes by the Build button, the backquote key and Esc, focus moving in and back;
 * - a hotkey queues with the window closed (Q, Generator) and open (W, Refinery);
 * - picking up a ready structure closes the window; placing it reopens it on the same tab, and so does
 *   cancelling placement; placing the Generator raises the unlock message and the Refinery's glow;
 * - pointing at a structure previews its power on the meter and the stat card gives what buying it
 *   leaves; the stat card never covers the sidebar;
 * - the advisor rings an item, with its reason on the card; unit roles and counters read the rules;
 * - pinning puts an item on the quick bar, F1 queues it, unpinning removes it;
 * - the window is docked against the rail, full height, never over the sidebar;
 * - no sideways scroll in the window at 1280 by 720, in either view.
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
    // The lobby opens on the game size cards (round 6, pace); the tech level is under Customise.
    await page.getByTestId('setup-customise').click();
    // A fixed battlefield. The lobby draws a fresh seed each visit and its default map type is
    // "let the seed choose", and about 38% of those maps (most Canyon, Plains and Highlands draws)
    // have no open sea, so no Naval tab: the run then waited on #fl-tab-naval until Playwright
    // timed out. The Coast always has sea (clicked below), so every MENUS tab, Naval included, is
    // checked every run.
    await page.getByTestId('seed').fill('tour-build-window');
    await page.getByTestId('tech-advanced').click();
    // The Coast map (the naval war): its open sea is what offers the Naval tab, checked below too.
    await page.getByTestId('map-coast').click();
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
      // Generals on; this battle has both off, so they must be absent. Likewise the economy's
      // structures (2026-11-21): the Fuel Well and Foundry need Industry, the Depot Supply lines,
      // the Quarters and Watchtower Territory, all off here.
      const economy = ['fuelwell', 'foundry', 'depot', 'quarters', 'watchtower', 'farm', 'munitions', 'trainingcentre', 'supplytruck'];
      const optional = k => k === r.HERO_ACADEMY || k === 'general' || economy.includes(k) || (k in r.UNITS && !!r.UNITS[k].hero);
      const menus = {};
      const absent = {};
      for (const [tab, list] of Object.entries(r.MENUS)) {
        menus[tab] = list.filter(k => !optional(k)).map(k => ({ kind: k, needs: req(k), tier: tier(k) }));
        absent[tab] = list.filter(optional);
      }
      const needsOf = {};
      for (const k of [...Object.keys(r.BUILDINGS), ...Object.keys(r.UNITS)]) needsOf[k] = req(k);
      // Docked, Structures shows one group at a time: each structure's group, to pop it out first.
      const bp = await import('/src/game/buildPlan.ts');
      const groupOf = Object.fromEntries(r.MENUS.building.map(k => [k, bp.groupOf(k)]));
      return { menus, absent, needsOf, groupOf, tier: Object.fromEntries(Object.keys(memo).map(k => [k, memo[k]])) };
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
    // ---- The rail: docked, a button per list, pressing the open list closes it -------------------
    const rail = await page.getByTestId('build-rail').boundingBox();
    const field0 = await page.locator('#fl-battlefield').boundingBox();
    if (!rail) await fail('no build rail on a desktop battle');
    else {
      if (Math.abs(rail.x - field0.x) > 2) await fail(`the build rail is not on the battlefield's left edge (${rail.x} against ${field0.x})`);
      const win = await page.locator('#fl-build-window').boundingBox();
      if (Math.abs(win.x - (rail.x + rail.width)) > 2) await fail(`the window is not docked against the rail (${win.x} against ${rail.x + rail.width})`);
      if (Math.abs(win.y - field0.y) > 2 || Math.abs(win.y + win.height - (field0.y + field0.height)) > 2) await fail('the docked window does not run the battlefield\'s full height');
      await page.locator('#fl-tab-building').click();
      if (!(await until(async () => !(await isOpen()), 2000))) await fail('pressing the open list on the rail did not close the window');
      await page.locator('#fl-tab-infantry').click();
      if (!(await until(isOpen, 2000))) await fail('a rail button did not open the window');
      else if ((await page.locator('#fl-tab-infantry').getAttribute('aria-expanded')) !== 'true') await fail('the rail button does not say its list is open');
      await page.locator('#fl-tab-building').click();
      await sleep(200);
      if (!(await isOpen())) await fail('moving to another list on the rail closed the window');
      if ((await page.getByTestId('build-groups').count()) !== 1) await fail('Structures did not pop out its group column');
    }
    const missingOf = item => item.needs.filter(n => !has.has(n));
    let seen = 0;
    for (const [tab, list] of Object.entries(rules.menus)) {
      if (!(await page.locator(`#fl-tab-${tab}`).count())) {
        await fail(`the window has no ${tab} tab on an advanced-tech Coast battle`);
        continue;
      }
      await page.locator(`#fl-tab-${tab}`).click();
      await sleep(250);
      for (const item of list) {
        if (tab === 'building') {
          const g = rules.groupOf[item.kind];
          if ((await page.locator(`#fl-group-${g}`).getAttribute('aria-pressed')) !== 'true') {
            await page.locator(`#fl-group-${g}`).click();
            await sleep(150);
          }
          const others = await page.locator('#fl-build-window button.fl-build[id^=fl-build-]').evaluateAll(els => els.map(e => e.id.replace('fl-build-', '')));
          const strays = others.filter(k => rules.groupOf[k] && rules.groupOf[k] !== g);
          if (strays.length) await fail(`the ${g} group also shows ${strays.join(', ')}`);
        }
        const el = page.locator(`#fl-build-${item.kind}`);
        if (!(await el.count())) {
          await fail(`${item.kind} is not on the ${tab} tab`);
          continue;
        }
        seen++;
        const locked = (await el.getAttribute('data-state')) === 'locked';
        const missing = missingOf(item);
        const should = missing.length > 0 || item.kind === 'pointdefence';
        if (locked !== should) await fail(`${item.kind}: ${locked ? 'greyed' : 'not greyed'} at the start, should ${should ? '' : 'not '}be`);
        const place = await el.evaluate(e => {
          const cell = e.closest('[data-variant]');
          const row = e.closest('.fl-bl-row');
          return { variant: cell?.getAttribute('data-variant'), row: row ? row.getAttribute('data-needs') : null, later: !!e.closest('[data-testid=later]') };
        });
        if (!locked && place.variant !== 'card') await fail(`${item.kind} can be built but is not a full card (${place.variant})`);
        if (locked) {
          const step = missing.length > 0 && missing.every(n => {
            const spec = rules.needsOf[n] || [];
            return spec.every(x => has.has(x));
          });
          if (step && place.row !== missing.join('+')) await fail(`${item.kind} should sit on the Coming next row for ${missing.join('+')}, sits on ${place.row ?? (place.later ? 'Later' : place.variant)}`);
          if (!step && !place.later) await fail(`${item.kind} is more than one step away but is not in Later`);
        }
      }
    }
    for (const [tab, list] of Object.entries(rules.absent)) {
      if (!list.length || !(await page.locator(`#fl-tab-${tab}`).count())) continue;
      await page.locator(`#fl-tab-${tab}`).click();
      await sleep(150);
      for (const k of list) if (await page.locator(`#fl-build-${k}`).count()) await fail(`${k} is on the ${tab} tab with Heroes, Generals and the economy toggles off`);
    }
    console.log(`  build window: ${seen} menu items checked, ${Object.values(rules.absent).flat().length} kept off with Heroes, Generals and the economy toggles off`);

    // ---- Every structure has a key within its group -------------------------------------------------
    await page.locator('#fl-tab-building').click();
    await sleep(150);
    const groups = await page.locator('#fl-build-window .fl-bw-grp').evaluateAll(els => els.map(e => e.id.replace('fl-group-', '')));
    if (groups.length < 3) await fail(`Structures shows ${groups.length} groups`);
    const keyed = new Set();
    for (const g of groups) {
      await page.locator(`#fl-group-${g}`).click();
      await sleep(120);
      const keys = await page.locator('#fl-build-window button.fl-build[aria-keyshortcuts]').evaluateAll(els => els.map(e => [e.id.replace('fl-build-', ''), e.getAttribute('aria-keyshortcuts')]));
      const letters = keys.map(k => k[1]);
      if (new Set(letters).size !== letters.length) await fail(`group ${g} gives two items one key: ${letters.join(' ')}`);
      for (const [k] of keys) keyed.add(k);
    }
    const unkeyed = rules.menus.building.map(i => i.kind).filter(k => !keyed.has(k));
    if (unkeyed.length) await fail(`structures with no hotkey in any group: ${unkeyed.join(', ')}`);
    await page.locator(`#fl-group-${groups[0]}`).click();
    await sleep(120);

    // ---- Tab walks the groups, then the lists ---------------------------------------------------------
    for (let i = 1; i < groups.length; i++) {
      await page.keyboard.press('Tab');
      await sleep(120);
      if ((await page.locator(`#fl-group-${groups[i]}`).getAttribute('aria-pressed')) !== 'true') await fail(`Tab did not move to the ${groups[i]} group`);
    }
    await page.keyboard.press('Tab');
    await sleep(150);
    if (!(await page.locator('#fl-tab-infantry').getAttribute('aria-selected'))?.includes('true')) await fail('Tab after the last group did not move to Infantry');
    await page.keyboard.press('Shift+Tab');
    await sleep(150);
    if ((await page.locator(`#fl-group-${groups[groups.length - 1]}`).getAttribute('aria-pressed')) !== 'true') await fail('Shift+Tab from Infantry did not come back to the last group');
    await page.locator(`#fl-group-${groups[0]}`).click();
    await sleep(120);

    // ---- The stat card stays off the sidebar; the planning numbers ----------------------------------
    await page.locator('#fl-build-power').hover();
    await sleep(250);
    const tipBox = await page.locator('[data-testid=stat-tip]').boundingBox();
    const asideBox = await page.locator('aside').boundingBox();
    if (!tipBox) await fail('no stat card on pointing at the Generator');
    else if (tipBox.x + tipBox.width > asideBox.x + 1) await fail('the stat card covers the sidebar');
    if ((await page.locator('[data-testid=power-sub]').getAttribute('data-preview')) !== '1') await fail('pointing at the Generator did not preview its power');
    if (!(await page.locator('[data-testid=tip-after]').count())) await fail('the stat card does not say what buying the Generator leaves');
    await page.mouse.move(5, 300);
    await sleep(150);
    if ((await page.locator('[data-testid=power-sub]').getAttribute('data-preview')) !== '0') await fail('the power preview stayed after the pointer left');

    // ---- The advisor -------------------------------------------------------------------------------
    const advisorWas = (await page.getByTestId('advisor-toggle').getAttribute('aria-pressed')) === 'true';
    if (!advisorWas) await page.getByTestId('advisor-toggle').click();
    await sleep(200);
    // An item in another group rings that group's button: pop it out to see the item's ring.
    if (await page.locator('.fl-bw-grp[data-advice="1"]').count()) {
      await page.locator('.fl-bw-grp[data-advice="1"]').first().click();
      await sleep(150);
    }
    const advised = await page.locator('#fl-build-window .fl-tree-cell[data-advice="1"]').evaluateAll(els => els.map(e => e.getAttribute('data-node')));
    if (advised.length !== 1) await fail(`the advisor rings ${advised.length} items`);
    else {
      await page.locator(`#fl-build-${advised[0]}`).hover();
      await sleep(200);
      if (!(await page.locator('[data-testid=tip-advice]').count())) await fail('the advised item\'s card gives no reason');
    }
    await page.getByTestId('advisor-toggle').click();
    await sleep(150);
    if (await page.locator('#fl-build-window .fl-tree-cell[data-advice="1"]').count()) await fail('switching the advisor off left a ring');
    await page.mouse.move(5, 300);
    await page.locator(`#fl-group-${groups[0]}`).click();
    await sleep(120);

    // ---- Roles and counters, from the rules -----------------------------------------------------------
    const roles = await page.evaluate(async () => {
      const bp = await import('/src/game/buildPlan.ts');
      const k = Object.keys(localStorage).find(x => x.startsWith('fireline_save_'));
      const st = JSON.parse(localStorage.getItem(k));
      return {
        rifleman: bp.rolesOf(st, 'rifleman'),
        rocketeer: bp.rolesOf(st, 'rocketeer'),
        hauler: bp.rolesOf(st, 'hauler'),
        rocketVsHeavy: bp.counters(st, 'rocketeer', 'heavy'),
        rifleVsHeavy: bp.counters(st, 'rifleman', 'heavy'),
        rifleVsInf: bp.counters(st, 'rifleman', 'infantry'),
        scouted: bp.scoutedArmor({ tank: 3, rifleman: 1 }),
      };
    });
    if (!roles.rifleman.includes('infantry')) await fail(`the Rifleman's roles are ${roles.rifleman}`);
    if (!roles.rocketeer.includes('armour')) await fail(`the Rocketeer's roles are ${roles.rocketeer}`);
    if (roles.hauler.join() !== 'support') await fail(`the Ore Hauler's roles are ${roles.hauler}`);
    if (!roles.rocketVsHeavy || roles.rifleVsHeavy || !roles.rifleVsInf) await fail(`counters read wrong: ${JSON.stringify(roles)}`);
    if (roles.scouted !== 'heavy') await fail(`three tanks and a rifleman scout as ${roles.scouted}`);

    // ---- Tech tree view: tiers, and lines only for the chain pointed at -------------------------------
    await page.locator('#fl-view-tree').click();
    await sleep(250);
    for (const [tab, list] of Object.entries(rules.menus)) {
      await page.locator(`#fl-tab-${tab}`).click();
      await sleep(200);
      for (const item of list) {
        const col = await page.locator(`#fl-build-${item.kind}`).evaluate(e => e.closest('[data-tier]')?.getAttribute('data-tier')).catch(() => null);
        if (col !== String(item.tier)) await fail(`${item.kind} sits in tier column ${col}, the rules give ${item.tier}`);
      }
      if (await page.locator('#fl-build-window path.fl-tree-line').count()) await fail(`the ${tab} tree draws lines with nothing pointed at`);
    }
    await page.locator('#fl-tab-building').click();
    await sleep(200);
    const chainItem = rules.menus.building.find(i => i.kind === 'techcentre') || rules.menus.building[rules.menus.building.length - 1];
    await page.locator(`#fl-build-${chainItem.kind}`).hover();
    await sleep(300);
    const chainOf = k => {
      const out = new Set([k]);
      const walk = x => (rules.needsOf[x] || []).forEach(r => { if (!out.has(r)) { out.add(r); walk(r); } });
      walk(k);
      return out;
    };
    const chain = chainOf(chainItem.kind);
    const want = [];
    for (const i of rules.menus.building) if (chain.has(i.kind)) for (const n of i.needs) if (chain.has(n)) want.push(`${i.kind}>${n}`);
    const drawn = await page.locator('#fl-build-window path.fl-tree-line').evaluateAll(els => els.map(e => `${e.getAttribute('data-from')}>${e.getAttribute('data-to')}`));
    if (want.sort().join() !== drawn.sort().join()) await fail(`pointing at ${chainItem.kind} drew ${drawn.join(' ')}, its chain is ${want.join(' ')}`);
    await page.mouse.move(5, 300);
    await sleep(200);
    if (await page.locator('#fl-build-window path.fl-tree-line').count()) await fail('the lines stayed after the pointer left the tree');

    // ---- A kind the window has never seen (Tech tree view) -------------------------------------------
    const extra = { tab: 'vehicle', kind: 'testwalker', name: 'Test Walker', cost: 1234, requires: ['techcentre', 'researchlab'] };
    const wantTier = 1 + Math.max(...extra.requires.map(k => rules.tier[k] ?? 0));
    await page.evaluate(x => {
      window.__flExtraMenuItem = x;
    }, extra);
    await page.locator('#fl-tab-vehicle').click();
    const ok = await until(async () => (await page.locator('#fl-build-testwalker').count()) > 0);
    if (!ok) await fail('the extra item was not laid out');
    else {
      const col = await page.locator('#fl-build-testwalker').evaluate(e => e.closest('[data-tier]')?.getAttribute('data-tier'));
      if (col !== String(wantTier)) await fail(`the extra item sits in tier ${col}, its requirements give ${wantTier}`);
      await page.locator('#fl-build-testwalker').hover({ force: true });
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
    await page.mouse.move(5, 300);
    await page.locator('#fl-view-build').click();
    await page.locator('#fl-tab-building').click();
    await sleep(150);

    // ---- Open and close: button, key, Esc ---------------------------------------------------------
    await page.locator('#fl-build-close').click();
    if (!(await until(async () => !(await isOpen())))) await fail('the close button did not close the window');
    await sleep(100);
    if ((await page.evaluate(() => document.activeElement?.id)) !== 'fl-build-open') await fail('focus did not return to the Build button on close');
    await page.keyboard.press('Tab');
    await sleep(150);
    if (!(await label()).includes('Production')) await fail(`Tab with the window closed: the Build button reads "${await label()}"`);
    await page.keyboard.press('Shift+Tab');
    await sleep(150);
    if (!(await label()).includes('Economy')) await fail(`Shift+Tab: the Build button reads "${await label()}"`);
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
    // The window closes in the render after placement starts (an effect on placing in GameScreen), so
    // wait for it as every other open and close here does; reading it once raced that render on CI.
    if (!(await until(async () => !(await isOpen()), 2000))) await fail('the window stayed open while placing');
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
    // Round 8: the unlock moment. The Generator opens the Refinery, Barracks and Decoy.
    if (!(await until(async () => /Generator ready: .*Refinery.* unlocked/.test((await page.locator('[data-testid=toast]').textContent().catch(() => '')) || ''), 3000)))
      await fail(`placing the Generator raised no unlock message (toast: "${await page.locator('[data-testid=toast]').textContent().catch(() => '')}")`);
    if (!(await until(isOpen))) await fail('the window did not reopen after placing');
    else if ((await page.locator('[data-node="refinery"]').first().getAttribute('data-fresh')) !== '1') await fail('the newly unlocked Refinery does not glow');
    else if ((await page.locator('#fl-tab-building').getAttribute('aria-selected')) !== 'true') await fail('the window reopened on another tab');

    await page.keyboard.press('w');
    if (!(await until(async () => (await page.locator('#fl-build-refinery').getAttribute('data-state')) === 'building'))) await fail('W with the window open did not queue a Refinery');
    if (!(await until(async () => (await page.locator('#fl-build-refinery').getAttribute('data-state')) === 'ready', 60000))) await fail('the Refinery never became ready');
    await page.locator('#fl-build-refinery').click();
    if (!(await until(async () => !(await isOpen())))) await fail('picking up the Refinery did not close the window');
    await page.keyboard.press('Escape');
    if (!(await until(isOpen))) await fail('the window did not reopen when placement was cancelled');
    if ((await page.locator('#fl-battlefield').getAttribute('data-placing')) !== '') await fail('Esc did not cancel placement');

    // ---- The quick bar: pin, F1, unpin -----------------------------------------------------------------
    await page.locator('#fl-group-production').click();
    await sleep(150);
    await page.locator('#fl-build-barracks').hover();
    await sleep(150);
    await page.getByTestId('pin-barracks').click();
    if (!(await until(async () => (await page.getByTestId('quick-barracks').count()) > 0, 2000))) await fail('pinning the Barracks put nothing on the quick bar');
    else {
      const qbox = await page.getByTestId('quick-bar').boundingBox();
      const field = await page.locator('#fl-battlefield').boundingBox();
      if (qbox.x < field.x || qbox.x + qbox.width > field.x + field.width) await fail('the quick bar is not on the battlefield');
      // The ready Refinery holds the structure line: cancel it (a full refund), then F1.
      if (await page.getByTestId('cancel-refinery').count()) await page.getByTestId('cancel-refinery').click();
      await until(async () => (await page.locator('[data-testid=strip-building]').count()) === 0, 5000);
      await page.keyboard.press('F1');
      if (!(await until(async () => ['building', 'ready'].includes(await page.getByTestId('quick-barracks').getAttribute('data-state')), 3000))) await fail('F1 did not queue the pinned Barracks');
      await page.getByTestId('unpin-barracks').click({ force: true });
      if (!(await until(async () => (await page.getByTestId('quick-barracks').count()) === 0, 2000))) await fail('unpinning left the Barracks on the quick bar');
    }

    // ---- Docked: never over the sidebar ------------------------------------------------------------
    {
      if (!(await isOpen())) await page.locator('#fl-build-open').click();
      await until(isOpen);
      const after = await page.locator('#fl-build-window').boundingBox();
      const aside = await page.locator('aside').boundingBox();
      if (after.x + after.width > aside.x + 1) await fail('the window reaches over the sidebar');
    }

    // ---- No sideways scroll at 1280 by 720, in either view ---------------------------------------------
    await page.setViewportSize({ width: 1280, height: 720 });
    await sleep(400);
    if (!(await isOpen())) await page.locator('#fl-build-open').click();
    await until(isOpen);
    for (const v of ['build', 'tree']) {
      await page.locator(`#fl-view-${v}`).click();
      await page.locator('#fl-tab-building').click();
      await sleep(300);
      const [sw, cw] = await page.getByTestId('build-window-body').evaluate(e => [e.scrollWidth, e.clientWidth]);
      if (sw > cw + 1) await fail(`the ${v} view scrolls sideways at 1280 by 720 (${sw} in ${cw})`);
    }
    await page.locator('#fl-view-build').click();

    for (const e of errors) await fail(e);
  } catch (e) {
    // Playwright's first line says only what timed out; the call log names the locator.
    const lines = String(e.stack || e.message).split('\n');
    const what = lines.find(l => /waiting for /.test(l));
    await fail('driver crashed: ' + lines[0] + (what ? ` (${what.trim()})` : ''));
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
