/**
 * Niccolò Rising: the Missions chain and the guided first hour, played in a browser with
 * Playwright's clock standing in for real hours.
 *
 *   npm run tours -- niccolo-rising            # six missions on desktop and phone, every edge flow
 *   npm run tours -- niccolo-rising --quick    # two missions on each, abandon + level gate (CI)
 *
 * Mission runs start at the sign-in gate (no stored user: no character creation offered), set the
 * client-side `tm_user`, create a character through the lobby and play the chain through the UI only.
 * For each mission:
 *   - before Accept, where cheap, the bot first does the very thing the mission will ask for (a prank
 *     before the goose and the snow, a training session before the drill, a fight with a Scots archer
 *     before the Scots), so a count that leaked in
 *     from before acceptance would show;
 *   - right after Accept, every counting objective (scheme, duel, train, arrive) is 0 in the save and
 *     reads 0/N on the page, and Report back is disabled. Holding objectives (post, goods, groats,
 *     course, level, working stat such as wit) are read live by design (niccolo-rising-design.md
 *     §3.12), so one already met at Accept is allowed and only logged;
 *   - after Report back, the save has the mission in `missions.done`, nothing active, and the reward
 *     applied exactly: groats (less goods/groats handed over; paydays in the same advance allowed for),
 *     experience, standing, items, goods removed, the Infirmary for the snow; and the chronicle shows it.
 * Throughout: no horizontal page scroll and no button off screen at each new screen, and no console
 * error or page error (React Router "future flag" warnings are ignored).
 *
 * Edge flows (characters seeded through the real sim, which Vite serves): a bad game id shows an
 * error; the rail shows the active mission and its deadline; Report back is disabled with nothing done;
 * a reload keeps the mission; the deadline fails it (save, re-offer, chronicle line); Abandon asks
 * first, No keeps the mission, Yes drops it, and the question does not carry over; the ready-but-abroad
 * reason is on the page; a level-gated Accept is disabled with its reason on the page; dark mode.
 * Quick mode runs only the abandon and level-gate flows.
 *
 * The guided first hour (`components/GuidedTour.tsx`), driven by clicking whatever the card names
 * (`data-tour-target`; `data-tour-manual` steps are read and dismissed): offered unasked to a fresh
 * character on both viewports, and in full mode started from the header after the first mission and
 * tried on a character with no Energy. Each new step is left alone for 1.5s and must not move on its
 * own; the target must be on screen, enabled, not under the card and what a click actually hits; a
 * spell in the Steen or the infirmary after a failed scheme hides the card, and the run must come
 * back on the same step; at the end every step was shown and the save shows a mission accepted, a
 * stat trained and a scheme attempted, and Finish marks the tour seen.
 *
 * Screenshots only on failure, into TOUR_OUT. Only the client-side `tm_user` is set; the sign-in gate
 * and server auth are untouched. See scripts/tours/run.mjs.
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.TOUR_BASE || 'http://localhost:5305';
const OUT = process.env.TOUR_OUT || path.join(require('os').tmpdir(), 'tours', 'niccolo-rising');
const QUICK = process.env.TOUR_QUICK === '1';
const VIEWPORTS = { desktop: { width: 1400, height: 900 }, phone: { width: 390, height: 844 } };
const START = new Date('2026-03-02T09:00:00Z').getTime();
const MIN = 60_000;
const USER = JSON.stringify({ userId: 'local-dev', username: 'local-dev' });
const COUNTING = new Set(['scheme', 'duel', 'train', 'arrive']);
// Missions whose counted action the bot performs once before accepting (Woad and Geneva's journeys are too slow).
const PRE_ACT = new Set(['goose', 'drill', 'scots', 'snow']);

const runs = [];
for (const vp of ['desktop', 'phone']) runs.push({ kind: 'missions', vp, max: QUICK ? 2 : 6 });
for (const vp of ['desktop', 'phone']) runs.push({ kind: 'edges', vp, full: !QUICK });
// The guided first hour: offered unasked to a fresh character made in the lobby, on both viewports;
// in full mode also started from the header after the first mission (the mission step must still
// wait for a new Accept) and on a character with no Energy left (the train step must not point at
// a control the sim refuses).
for (const vp of ['desktop', 'phone']) runs.push({ kind: 'tour', vp, variant: 'fresh' });
if (!QUICK) {
  runs.push({ kind: 'tour', vp: 'desktop', variant: 'after-mission' });
  runs.push({ kind: 'tour', vp: 'phone', variant: 'tired' });
}

const problems = [];

async function openPage(browser, vp) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[vp], deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('page error: ' + e.message));
  page.on('console', m => {
    if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('React Router Future Flag')) errors.push(`console.${m.type()}: ${m.text()}`);
  });
  await page.clock.install({ time: START });
  return { ctx, page, errors };
}

/** Helpers bound to one page and one run's problem list. */
function kit(page, label, local) {
  let shots = 0;
  const fail = async msg => {
    local.push(msg);
    if (shots++ < 3) await page.screenshot({ path: path.join(OUT, `${label.replace(/\W+/g, '-')}-${shots}.png`) }).catch(() => {});
  };
  const ff = async mins => { await page.clock.fastForward(mins * MIN); await page.waitForTimeout(30); };
  const goPlace = async name => {
    await page.locator('main nav button', { hasText: new RegExp(`^${name}$`) }).first().click();
    await page.waitForTimeout(20);
  };
  /** Clicks a button in the last element under `scope` containing `rowText`. 'clicked' | 'disabled:<why>' | 'missing'. */
  const press = async (rowText, buttonText, scope = 'main div') => {
    const rows = page.locator(scope).filter({ hasText: rowText }).filter({ has: page.locator('button', { hasText: buttonText }) });
    if (!(await rows.count())) return 'missing';
    const btn = rows.last().locator('button', { hasText: buttonText }).first();
    if (await btn.isDisabled()) return `disabled:${await btn.getAttribute('title')}`;
    await btn.click();
    await page.waitForTimeout(20);
    return 'clicked';
  };
  const layoutCheck = async tag => {
    const r = await page.evaluate(() => {
      const out = [];
      const vw = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls horizontally: ${document.documentElement.scrollWidth} > ${vw}`);
      for (const b of document.querySelectorAll('main button')) {
        const rc = b.getBoundingClientRect();
        if (rc.width && (rc.right > vw + 1 || rc.left < -1)) out.push(`button "${b.textContent}" off screen (${Math.round(rc.left)}..${Math.round(rc.right)} of ${vw})`);
      }
      return out;
    });
    for (const x of r) await fail(`[${tag}] ${x}`);
  };
  return { fail, ff, goPlace, press, layoutCheck };
}

const saveOf = (page, id) => page.evaluate(k => JSON.parse(localStorage.getItem(k)), `nrising_save_${id}`);

/** Waits (by polling the save) until `pred` holds, or ~2s; returns the last save read. */
async function saveWhen(page, id, pred) {
  let s;
  for (let i = 0; i < 40; i++) {
    s = await saveOf(page, id);
    if (pred(s)) return s;
    await page.waitForTimeout(50);
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
// The mission chain, through the UI
// ---------------------------------------------------------------------------------------------

async function missionsRun(page, { vp, max }, local) {
  const label = `${vp} missions(${max})`;
  const { fail, ff, goPlace, press, layoutCheck } = kit(page, label, local);

  // The gate with no stored user.
  await page.goto(BASE + '/');
  await page.waitForSelector('text=Sign in / Register');
  if (await page.locator('text=A new character').count()) await fail('lobby offered character creation with no stored user');

  await page.evaluate(u => localStorage.setItem('tm_user', u), USER);
  await page.reload();
  await page.waitForSelector('text=A new character');
  await page.fill('input[placeholder="Claes"]', 'Claes');
  await page.click('button:has-text("Begin")');
  await page.waitForURL(/\/game\//);
  await page.waitForSelector('text=Where things stand');
  const id = page.url().split('/game/')[1];
  await layoutCheck('home');

  // The real content and xp curve, from the sim Vite serves.
  const { missions, xpTable } = await page.evaluate(async () => {
    const m = await import('/src/sim/missions.ts');
    const c = await import('/src/sim/content.ts');
    return { missions: m.MISSION, xpTable: Array.from({ length: 40 }, (_, i) => c.xpToNext(i + 1)) };
  });
  const totalXp = s => xpTable.slice(0, s.level - 1).reduce((a, b) => a + b, 0) + s.xp;

  await goPlace('Missions');
  await layoutCheck('missions');
  const first = (await page.locator('main h2').first().textContent()) || '';
  if (!first.includes(missions.goose.title)) await fail(`first mission panel is "${first}", not the goose`);

  let completed = 0;
  let steps = 0;
  let idle = 0;
  const seen = new Set();
  const preDone = new Set();
  const preActed = [];
  const preTries = {};
  while (completed < max && steps < 4000 && local.length < 20) {
    steps++;
    const s = await saveOf(page, id);
    const st = s.status.kind;
    const active = s.missions.active;
    if (st === 'infirmary' || st === 'steen') {
      if (!seen.has(st)) { seen.add(st); await layoutCheck(st); }
      await ff(10);
      continue;
    }
    if (st === 'travelling') { await ff(10); continue; }

    await goPlace('Missions');
    if (!active) {
      const next = Object.values(missions).find(m => !s.missions.done.includes(m.id) && (!m.after || s.missions.done.includes(m.after)));
      if (!next) break;
      // First, do the thing the mission will count, so a leak from before acceptance would show.
      // Waits (up to five game hours) for the nerve, energy or health it needs.
      if (PRE_ACT.has(next.id) && !preDone.has(next.id) && s.level >= next.minLevel) {
        let r = 'n/a';
        if (next.id === 'goose' || next.id === 'snow') { await goPlace('Schemes'); r = await press('A practical joke', 'Attempt'); }
        else if (next.id === 'drill') { await goPlace('Training yard'); r = await press(/strength/i, /Train ×/, 'main section > div'); if (r !== 'clicked') r = await press(/strength/i, /^Train$/, 'main section > div'); }
        else if (next.id === 'scots' && s.bars.health.cur >= 60) { await goPlace('Duels'); r = await press('A drunk Scots archer', 'Fight', 'main section > div'); }
        preTries[next.id] = (preTries[next.id] || 0) + 1;
        if (r === 'clicked') { preDone.add(next.id); preActed.push(next.id); }
        else if (preTries[next.id] >= 30) preDone.add(next.id);
        else await ff(10);
        continue;
      }
      const r = await press(/Accept/, 'Accept', 'main section');
      if (r === 'clicked') {
        const after = await saveWhen(page, id, x => !!x.missions.active);
        const a = after.missions.active;
        if (!a) { await fail(`Accept clicked for ${next.id} but no mission active`); continue; }
        if (a.id !== next.id) await fail(`accepted ${a.id}, expected ${next.id}`);
        // Nothing counted before the player does it.
        const panel = await page.locator('main section').first().innerText();
        const shown = [...panel.matchAll(/([\d,]+)\/([\d,]+)/g)].map(x => Number(x[1].replace(/,/g, '')));
        const held = [];
        for (const [i, o] of missions[a.id].objectives.entries()) {
          if (COUNTING.has(o.kind)) {
            if ((a.progress[i] ?? 0) !== 0) await fail(`${a.id}: counting objective ${i} (${o.kind}) is ${a.progress[i]} straight after Accept`);
            if (shown[i] !== 0) await fail(`${a.id}: counting objective ${i} (${o.kind}) reads ${shown[i]} on the page straight after Accept`);
          } else if (shown[i] !== undefined && shown[i] > 0) held.push(`${o.kind} ${shown[i]}`);
        }
        if (missions[a.id].objectives.some(o => COUNTING.has(o.kind))) {
          const rb = page.locator('main section').first().locator('button', { hasText: 'Report back' });
          if (!(await rb.isDisabled())) await fail(`${a.id}: Report back enabled straight after Accept`);
        }
        if (held.length) console.log(`  ${label}: ${a.id} accepted with holding objectives already partly met (allowed): ${held.join(', ')}`);
        await layoutCheck(`accepted ${a.id}`);
        continue;
      }
      if (r === 'missing') { await fail(`no Accept button for ${next.id}`); break; }
      // Level-gated: grind schemes.
      await goPlace('Schemes');
      if ((await press('A practical joke', 'Attempt')) !== 'clicked') await ff(10);
      continue;
    }

    // Report back when ready.
    const rb = await press(/Report back/, 'Report back', 'main section');
    if (rb === 'clicked') {
      const after = await saveWhen(page, id, x => x.missions.done.length > s.missions.done.length);
      const m = missions[active.id];
      if (!after.missions.done.includes(m.id)) { await fail(`Report back clicked for ${m.id} but it is not in missions.done`); continue; }
      completed++;
      const r = m.reward;
      if (after.missions.active) await fail(`${m.id}: a mission is still active after reporting back`);
      let expectGr = (r.groats || 0);
      const inv = {};
      for (const o of m.objectives) {
        if (o.kind === 'pay') expectGr -= o.groats;
        if (o.kind === 'deliver') inv[o.itemId] = (inv[o.itemId] || 0) - o.qty;
      }
      for (const [it, q] of Object.entries(r.items || {})) inv[it] = (inv[it] || 0) + q;
      const dGr = after.groats - s.groats;
      const payday = after.job && (!s.job || after.job.paidDays > s.job.paidDays);
      if (payday ? dGr < expectGr : dGr !== expectGr) await fail(`${m.id}: groats moved ${dGr}, reward says ${expectGr}`);
      if (r.xp && totalXp(after) - totalXp(s) !== r.xp) await fail(`${m.id}: experience moved ${totalXp(after) - totalXp(s)}, reward says ${r.xp}`);
      if ((after.standing - s.standing) !== (r.standing || 0)) await fail(`${m.id}: standing moved ${after.standing - s.standing}, reward says ${r.standing || 0}`);
      for (const [it, q] of Object.entries(inv)) {
        const d = (after.inventory[it] || 0) - (s.inventory[it] || 0);
        if (d !== q) await fail(`${m.id}: ${it} moved ${d}, expected ${q}`);
      }
      if (r.infirmaryMinutes && after.status.kind !== 'infirmary') await fail(`${m.id}: should put the player in the Infirmary, status is ${after.status.kind}`);
      const chron = await page.locator('main').innerText();
      if (!chron.includes(m.done.slice(0, 40))) await fail(`${m.id}: the chronicle does not show it`);
      continue;
    }

    const mid = active.id;
    if (st === 'abroad') {
      const city = s.status.city;
      await goPlace('Travel');
      const want = mid === 'woad' && city === 'ghent' ? ['Woad', 2, 'woad'] : mid === 'geneva' && city === 'geneva' ? ['kermes', 1, 'kermes'] : null;
      if (want && (s.inventory[want[2]] ?? 0) < want[1]) {
        if (!seen.has('abroad')) { seen.add('abroad'); await layoutCheck('abroad'); }
        const r = await press(new RegExp(want[0], 'i'), 'Buy 1', 'main section > div');
        if (r !== 'clicked') await fail(`could not buy ${want[0]} in ${city}: ${r}`);
        continue;
      }
      await press(/Sail for Bruges/, 'Sail for Bruges', 'main section > div');
      continue;
    }

    let r = 'none';
    switch (mid) {
      case 'goose':
      case 'snow':
        await goPlace('Schemes');
        r = await press('A practical joke', 'Attempt');
        break;
      case 'drill':
        await goPlace('Training yard');
        r = await press(/strength/i, /Train ×/, 'main section > div');
        if (r !== 'clicked') r = await press(/strength/i, /^Train$/, 'main section > div');
        break;
      case 'scots':
        if (s.bars.health.cur < 60) { r = 'wait-health'; break; }
        if (s.inventory.cudgel && !s.equipped.weapon) {
          await goPlace('Waterhalle');
          r = await press(/cudgel/i, /Equip/, 'main section > div');
          if (r === 'clicked') break;
        }
        await goPlace('Duels');
        r = await press('A drunk Scots archer', 'Fight', 'main section > div');
        break;
      case 'woad':
        if (s.job?.id !== 'charetty') { await goPlace('Work'); r = await press(/Charetty/, 'Take a post', 'main section > div'); break; }
        if (!active.progress[1]) { await goPlace('Travel'); r = await press(/^Ghent/, 'Set out', 'main section > div'); break; }
        r = 'nothing-to-do';
        break;
      case 'geneva':
        if (!active.progress[0]) { await goPlace('Travel'); r = await press(/^Geneva/, 'Set out', 'main section > div'); break; }
        r = 'nothing-to-do';
        break;
      default:
        await fail(`the driver does not play ${mid}`);
        return;
    }
    if (r !== 'clicked') {
      await ff(10);
      if (++idle > 400) { await fail(`stuck on ${mid}: last result ${r}, progress ${JSON.stringify(active.progress)}`); break; }
    } else idle = 0;
  }
  if (completed < max && local.length === 0) await fail(`completed ${completed} of ${max} missions in ${steps} steps`);
  return `${completed} missions, ${steps} steps, acted before accepting: ${preActed.join(' ') || 'none'}`;
}

// ---------------------------------------------------------------------------------------------
// Edge flows, on seeded characters
// ---------------------------------------------------------------------------------------------

async function edgesRun(page, { vp, full }, local) {
  const label = `${vp} edges${full ? '' : '(quick)'}`;
  const { fail, ff, goPlace } = kit(page, label, local);
  const key = 'nrising_save_edge-geneva';
  const saved = async () => (await page.evaluate(k => JSON.parse(localStorage.getItem(k)), key)).missions.active?.id ?? null;
  const mutate = async fn => page.evaluate(([k, src]) => {
    const s = JSON.parse(localStorage.getItem(k));
    new Function('s', src)(s);
    localStorage.setItem(k, JSON.stringify(s));
  }, [key, fn]);
  const reloadTo = async place => {
    await page.reload();
    await page.waitForSelector('text=Where things stand');
    await goPlace(place);
  };
  const mainText = () => page.locator('main').innerText();
  const flows = [];

  await page.goto(BASE + '/');
  await page.evaluate(u => localStorage.setItem('tm_user', u), USER);

  if (full) {
    await page.goto(BASE + '/game/does-not-exist');
    await page.waitForTimeout(300);
    const t = await page.locator('body').innerText();
    if (!/not found|Could not load/i.test(t)) await fail('bad id: no error message shown: ' + t.slice(0, 120));
    flows.push('bad-id');
  }

  // A character at the Geneva mission, built with the sim (pure; the caller supplies time).
  await page.evaluate(async start => {
    const { createInitialState } = await import('/src/sim/state.ts');
    const { processAction } = await import('/src/sim/actions.ts');
    let s = JSON.parse(JSON.stringify(createInitialState('edge-geneva', 'Edge', { seed: 'edge', createdAt: start })));
    s.level = 3;
    s.groats = 1000;
    s.missions.done = ['goose', 'drill', 'scots', 'woad', 'snow'];
    const t = processAction(s, { type: 'ACCEPT_MISSION', missionId: 'geneva', at: start + 1000 });
    if (t === s) throw new Error('accept refused');
    localStorage.setItem('nrising_save_edge-geneva', JSON.stringify(t));
    localStorage.setItem('nrising_saves', JSON.stringify([{ id: 'edge-geneva', name: 'Edge', turn: 3, status: 'active', savedAt: start }]));
  }, START);
  await page.goto(BASE + '/game/edge-geneva');
  await page.waitForSelector('text=Where things stand');
  await goPlace('Missions');

  if (full) {
    const rail = await page.locator('aside').first().innerText();
    if (!/Courier to Geneva/.test(rail)) await fail('rail does not show the active mission');
    if (!/2d 0h|4\dh/.test(rail)) await fail('rail deadline text unexpected: ' + rail.split('\n').slice(-2).join(' | '));
    const report = page.locator('button', { hasText: 'Report back' });
    if (!(await report.isDisabled())) await fail('Report back enabled with nothing done');
    await reloadTo('Missions');
    if (!(await page.locator('main h2', { hasText: 'Courier to Geneva' }).count())) await fail('mission lost on reload');
    flows.push('rail', 'report-disabled', 'reload');

    // The deadline passes.
    await ff(48 * 60 + 2);
    await page.waitForTimeout(200);
    if (await saved()) await fail('mission still active in the save after its deadline');
    if (!/Accept/.test(await mainText())) await fail('after a failed deadline the mission is not offered again');
    if (!/Mission failed/.test(await page.locator('aside').last().innerText())) await fail('no failure line in the chronicle');
    await page.locator('button', { hasText: 'Accept' }).click();
    await page.waitForTimeout(50);
    if ((await saved()) !== 'geneva') await fail('could not accept Geneva again after it failed');
    flows.push('deadline');
  }

  // Abandon: one click only asks; No keeps it; Yes abandons; the question does not carry over.
  await page.locator('button', { hasText: 'Abandon' }).click();
  await page.waitForTimeout(50);
  if ((await saved()) !== 'geneva') await fail('one click on Abandon threw the mission away');
  if (!(await page.locator('text=Abandon, and lose the progress?').count())) await fail('Abandon did not ask');
  await page.locator('button', { hasText: /^No$/ }).click();
  await page.waitForTimeout(50);
  if ((await saved()) !== 'geneva') await fail('No on the abandon question abandoned anyway');
  if (!(await page.locator('button', { hasText: 'Report back' }).count())) await fail('Report back gone after declining to abandon');
  await page.locator('button', { hasText: 'Abandon' }).click();
  await page.locator('button', { hasText: /^Yes$/ }).click();
  await page.waitForTimeout(50);
  if ((await saved()) !== null) await fail('Yes on the abandon question did not abandon');
  await page.locator('button', { hasText: 'Accept' }).click();
  await page.waitForTimeout(50);
  if ((await saved()) !== 'geneva') await fail('could not accept Geneva again after abandoning');
  if (await page.locator('text=Abandon, and lose the progress?').count()) await fail('abandon question carried over to a fresh mission');
  flows.push('abandon');

  if (full) {
    // Ready to report while abroad: the reason is on the page, not only in a tooltip.
    await mutate("s.missions.active.progress = [1, 0]; s.inventory.kermes = 1; s.status = { kind: 'abroad', city: 'geneva' };");
    await reloadTo('Missions');
    const t = await mainText();
    if (!/cannot report back while abroad/.test(t)) await fail('ready-but-abroad reason not visible');
    if (/Not every objective/.test(t)) await fail('unmet-objectives reason shown although all are met');
    flows.push('ready-abroad');
  }

  // Level gate: level 3 on Cipher (needs 4).
  await mutate("s.status = { kind: 'free' }; s.level = 3; s.missions = { active: null, done: ['goose', 'drill', 'scots', 'woad', 'snow', 'geneva'] };");
  await reloadTo('Missions');
  const acc = page.locator('button', { hasText: 'Accept' });
  if (!(await acc.count())) await fail('no Accept button on the level-gated mission');
  else if (!(await acc.isDisabled())) await fail('level-gated Accept enabled');
  if (!/Level 4 required/.test(await mainText())) await fail('level-gate reason not visible on the page');
  flows.push('level-gate');

  if (full) {
    const before = await page.evaluate(() => document.documentElement.dataset.theme || '');
    await page.locator('button', { hasText: /Dark mode|Light mode/ }).first().click();
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => document.documentElement.dataset.theme || '');
    if (before === after) await fail(`theme toggle did not change the theme (${before || 'unset'})`);
    flows.push('dark');
  }
  return flows.join(', ');
}

// ---------------------------------------------------------------------------------------------
// The guided first hour, driven by clicking whatever the card names
// ---------------------------------------------------------------------------------------------

const IDLE_MS = 1500;
const cardOf = page => page.evaluate(() => {
  const c = document.querySelector('[data-tour-step]');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return {
    step: Number(c.getAttribute('data-tour-step')),
    target: c.getAttribute('data-tour-target') || '',
    manual: c.getAttribute('data-tour-manual') === '1',
    title: c.querySelector('h3')?.textContent || '',
    label: c.querySelector('p')?.textContent || '',
    buttons: [...c.querySelectorAll('button')].map(b => b.textContent.trim()),
    card: { l: r.left, t: r.top, r: r.right, b: r.bottom },
  };
});

/** Seeds a character with the real sim, so a run can start from a particular state. */
async function seedCharacter(page, id, mutate) {
  await page.evaluate(async ({ id, start, mutate }) => {
    const { createInitialState } = await import('/src/sim/state.ts');
    const s = JSON.parse(JSON.stringify(createInitialState(id, 'Tour', { seed: id, createdAt: start })));
    // eslint-disable-next-line no-new-func
    new Function('s', mutate)(s);
    localStorage.setItem('nrising_save_' + id, JSON.stringify(s));
    localStorage.setItem('nrising_saves', JSON.stringify([{ id, name: 'Tour', turn: 1, status: 'active', savedAt: start }]));
  }, { id, start: START, mutate });
}

async function tourRun(page, { vp, variant }, local) {
  const label = `${vp} tour(${variant})`;
  const { fail, ff } = kit(page, label, local);
  await page.goto(BASE + '/');
  await page.evaluate(u => { localStorage.setItem('tm_user', u); localStorage.removeItem('niccolo_rising_tour_seen'); }, USER);

  let id;
  if (variant === 'fresh') {
    await page.reload();
    await page.waitForSelector('text=A new character');
    await page.fill('input[placeholder="Claes"]', 'Claes');
    await page.click('button:has-text("Begin")');
    await page.waitForURL(/\/game\//);
    id = page.url().split('/game/')[1];
  } else {
    id = 'tour-' + variant;
    // after-mission: the first mission already done, so "has any mission ever been finished" is true
    // before the run begins. tired: no Energy left to train with.
    await seedCharacter(page, id, variant === 'after-mission'
      ? "s.missions.done = ['goose']; s.counters.schemes = 3;"
      : "s.bars.energy.cur = 0;");
    await page.goto(`${BASE}/game/${id}`);
    await page.waitForSelector('text=Where things stand');
    await page.waitForTimeout(500);
    const offered = (await page.locator('[data-tour-step]').count()) > 0;
    // A tired character has still never played, so the unasked offer is right; one who has
    // finished a mission must not get it unasked, and starts it from the header.
    if (variant === 'tired' && !offered) await fail('the tour was not offered to a character who has never played');
    if (variant === 'after-mission') {
      if (offered) await fail('the tour was offered unasked to a character who has already played');
      const start = page.locator('button', { hasText: 'Guided first hour' });
      if (!(await start.count())) { await fail('the header offers no Guided first hour'); return ''; }
      await start.click();
    }
  }
  try { await page.waitForSelector('[data-tour-step]', { timeout: 6000 }); } catch { await fail('the guided first hour was not offered'); return ''; }

  const before = await saveOf(page, id);
  const total = Number((/of (\d+)/.exec((await cardOf(page)).label) || [])[1]);
  const shown = new Set();
  const titles = new Set();
  let last = -1, finished = false;
  for (let guard = 0; guard < 60 && !finished; guard++) {
    let c = await cardOf(page);
    if (!c) {
      // Hidden: the Steen or the infirmary after a failed scheme. Let the clock run it out; the
      // run must come back on the step it left.
      const s = await saveOf(page, id);
      if (s.status.kind === 'free') { await fail(`the card vanished on step ${last + 1} with the character free`); break; }
      await ff(30);
      await page.waitForTimeout(300);
      c = await cardOf(page);
      if (!c) continue;
      if (c.step !== last) await fail(`after the ${s.status.kind} the run is on step ${c.step + 1}, was ${last + 1}`);
    }
    if (c.step < last) await fail(`went back from step ${last + 1} to ${c.step + 1}`);
    const fresh = c.step !== last;
    last = c.step;
    shown.add(c.step);
    titles.add(c.title);

    if (c.buttons.includes('Finish')) { await page.locator('[data-tour-step] button', { hasText: 'Finish' }).click(); finished = true; break; }
    if (c.manual) {
      const next = c.buttons.find(b => b === 'Start' || b === 'Next');
      await page.locator('[data-tour-step] button', { hasText: next }).click();
      await page.waitForTimeout(250);
      continue;
    }
    if (fresh) {
      // The step must wait for the player.
      await page.waitForTimeout(IDLE_MS);
      const now = await cardOf(page);
      if (now && now.step !== c.step) { await fail(`step ${c.step + 1} "${c.title}" completed itself with no action`); continue; }
      if (now) c = now;
    }
    if (!c.target) { await fail(`step ${c.step + 1} "${c.title}" points at nothing`); break; }
    // Geometry, once the card has settled.
    await page.waitForTimeout(300);
    const geo = await page.evaluate(t => {
      const el = document.getElementById(t), card = document.querySelector('[data-tour-step]');
      if (!el || !card) return null;
      const r = el.getBoundingClientRect(), k = card.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        off: r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth,
        cardOff: k.top < 0 || k.left < 0 || k.bottom > innerHeight + 1 || k.right > innerWidth + 1,
        covers: !(k.right <= r.left || r.right <= k.left || k.bottom <= r.top || r.bottom <= k.top),
        hit: !!hit && (hit === el || el.contains(hit)),
        disabled: !!el.disabled, why: el.getAttribute('title') || '',
      };
    }, c.target);
    if (!geo) { await fail(`step ${c.step + 1} names ${c.target}, which is not on the page`); break; }
    if (geo.off) await fail(`step ${c.step + 1} target ${c.target} is off screen`);
    if (geo.cardOff) await fail(`step ${c.step + 1} card is off screen`);
    if (geo.covers) await fail(`step ${c.step + 1} card covers ${c.target}`);
    if (!geo.hit) await fail(`step ${c.step + 1} something else is on top of ${c.target}`);
    if (geo.disabled) { await fail(`step ${c.step + 1} "${c.title}" points at disabled ${c.target}: ${geo.why}`); break; }
    await page.locator('#' + c.target).click();
    // Wait for the step or its target to move on.
    let moved = false;
    for (let i = 0; i < 40 && !moved; i++) {
      await page.waitForTimeout(100);
      const n = await cardOf(page);
      moved = !n || n.step !== c.step || n.target !== c.target;
    }
    if (!moved) { await fail(`stuck on step ${c.step + 1} "${c.title}" after clicking ${c.target}`); break; }
  }

  if (!finished) await fail(`the run did not finish (last step ${last + 1} of ${total})`);
  for (let i = 0; i < total; i++) if (!shown.has(i)) await fail(`step ${i + 1} of ${total} was never shown`);
  const after = await saveOf(page, id);
  const did = [];
  if (after.missions.active || after.missions.done.length > before.missions.done.length) did.push('mission');
  else if (!before.missions.active) await fail('no mission was accepted');
  const stats = ['strength', 'speed', 'defence', 'dexterity'];
  const trained = stats.some(k => after.battle[k] > before.battle[k]);
  if (trained) did.push('train');
  else if (titles.has('Spend Energy on a stat') || variant !== 'tired') await fail('no stat was trained');
  if (variant === 'tired' && titles.has('Spend Energy on a stat')) await fail('a character with no Energy was walked to the yard');
  if (after.counters.schemes > before.counters.schemes) did.push('scheme'); else await fail('no scheme was attempted');
  if (after.job && !before.job) did.push('post');
  if (finished && !(await page.evaluate(() => localStorage.getItem('niccolo_rising_tour_seen')))) await fail('Finish did not mark the tour seen');
  return `${shown.size}/${total} steps; ${did.join(', ')}`;
}

(async () => {
  const browser = await chromium.launch();
  for (const run of runs) {
    const label = run.kind === 'missions' ? `${run.vp} missions(${run.max})` : run.kind === 'tour' ? `${run.vp} tour(${run.variant})` : `${run.vp} edges${run.full ? '' : '(quick)'}`;
    const t0 = Date.now();
    const { ctx, page, errors } = await openPage(browser, run.vp);
    const local = [];
    let info = '';
    try {
      info = await (run.kind === 'missions' ? missionsRun(page, run, local) : run.kind === 'tour' ? tourRun(page, run, local) : edgesRun(page, run, local));
    } catch (e) {
      local.push('threw: ' + String(e.message || e).split('\n')[0]);
      await page.screenshot({ path: path.join(OUT, `${label.replace(/\W+/g, '-')}-threw.png`) }).catch(() => {});
    }
    for (const e of [...new Set(errors)]) local.push(e);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(local.length ? `${label} FAIL (${secs}s) ${local[0]}` : `${label} ok (${secs}s; ${info})`);
    for (const p of local) problems.push(`${label}: ${p}`);
    await ctx.close();
  }
  await browser.close();
  console.log(`PROBLEMS (${problems.length})`);
  for (const p of problems) console.log('  ' + p);
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
