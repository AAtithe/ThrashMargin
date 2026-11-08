/**
 * Thrash Margin: the guided turn (any map) and the tutorial map's coach, played in a browser.
 *
 *   npm run tours -- thrash-margin            # full matrix
 *   npm run tours -- thrash-margin --quick    # what CI runs
 *   TOUR_FILTER=heartlands npm run tours -- thrash-margin   # only runs whose label contains it
 *
 * The guided turn is driven by clicking whatever its card names (`data-tour-target`), never by
 * reading the copy. On every step it checks:
 *   - the step does not complete itself: no action is taken for 1.5s after it appears, and the
 *     index must not move (an attack step once read as done on arrival and was skipped);
 *   - the target is on screen, enabled, and is what a click at that point actually hits;
 *   - the card, once settled, does not cover the target;
 *   - the run never goes backwards, including across modals (the dispatch after End turn once
 *     sent it back to the welcome card).
 * At the end: every real step was shown, a building was raised, troops were recruited, a battle was
 * fought and the turn advanced, read from the save.
 *
 * Perturbations a player can cause: clicking the capital again (deselecting it) at Build,
 * opening How to play mid-step, and cancelling the attack orders.
 *
 * Games are seeded with the real engine through Vite and kept in browser saves; only the
 * client-side `tm_user` is set. See scripts/tours/run.mjs.
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.TOUR_BASE || 'http://localhost:5301';
const OUT = process.env.TOUR_OUT || path.join(require('os').tmpdir(), 'tours', 'thrash-margin');
const QUICK = process.env.TOUR_QUICK === '1';
const SIM = '/@fs' + path.resolve(__dirname, '../../packages/thrash-margin/shared/sim/index.ts');
const VIEWPORTS = { desktop: { width: 1400, height: 900 }, phone: { width: 390, height: 844 } };
const MAPS = ['tutorial', 'heartlands', 'narrows', 'crossroads', 'frontier', 'grand_continent', 'random'];
const MANUAL = new Set([0, 7]); // the welcome card and the closing card advance on a button
const IDLE_MS = 1500;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const runs = [];
if (QUICK) {
  for (const vp of ['desktop', 'phone']) for (const mapId of ['tutorial', 'heartlands', 'random']) runs.push({ mapId, diff: 'normal', seed: 1, vp });
  runs.push({ mapId: 'heartlands', diff: 'easy', seed: 2, vp: 'desktop', perturb: true });
  runs.push({ mapId: 'narrows', diff: 'hard', seed: 3, vp: 'phone', perturb: true });
} else {
  for (const vp of ['desktop', 'phone']) for (const mapId of MAPS) for (const diff of ['easy', 'normal', 'hard']) for (const seed of [1, 2]) runs.push({ mapId, diff, seed, vp });
  for (const vp of ['desktop', 'phone']) for (const mapId of ['heartlands', 'frontier', 'random']) runs.push({ mapId, diff: 'normal', seed: 3, vp, perturb: true });
}
const coachRuns = QUICK ? [{ diff: 'easy', vp: 'desktop' }] : ['easy', 'normal', 'hard'].flatMap(diff => [{ diff, vp: 'desktop' }, { diff, vp: 'phone' }]);

// TOUR_FILTER=heartlands runs only the runs whose label contains it.
const FILTER = process.env.TOUR_FILTER || '';
const problems = [];

async function openPage(browser, vp) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[vp] });
  await ctx.addInitScript(() => localStorage.setItem('tm_user', JSON.stringify({ userId: 'local-dev', username: 'local-dev' })));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('page error: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('React Router Future')) errors.push('console: ' + m.text()); });
  await page.goto(BASE + '/');
  return { ctx, page, errors };
}

async function seed(page, { mapId, diff, seed }, tourSeen) {
  return page.evaluate(async ({ SIM, mapId, diff, seed, tourSeen }) => {
    const sim = await import(SIM);
    const id = `tour-${mapId}-${diff}-${seed}`;
    const s = sim.createInitialState(id, sim.presetConfig(diff, { mapId }), { seed: seed * 7919, createdAt: 1, name: 'Tour' });
    localStorage.setItem('tm_save_' + id, JSON.stringify(s));
    localStorage.setItem('tm_saves', JSON.stringify([{ id, name: 'Tour', status: 'active' }]));
    if (tourSeen) localStorage.setItem('tm_guided_tour_seen', '1'); else localStorage.removeItem('tm_guided_tour_seen');
    return id;
  }, { SIM, mapId, diff, seed, tourSeen });
}

const save = (page, id) => page.evaluate(id => JSON.parse(localStorage.getItem('tm_save_' + id)), id);

/** Where to click a territory: its troop badge if that is on screen and on top, else the middle
 *  of the part of it that is visible (what a player would tap). */
async function territoryPoint(page, domId) {
  return page.evaluate(domId => {
    const g = document.getElementById(domId);
    if (!g) return null;
    const hits = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && g.contains(e); };
    const b = g.querySelector('circle').getBoundingClientRect();
    const bx = b.x + b.width / 2, by = b.y + b.height / 2;
    if (hits(bx, by)) return { x: bx, y: by };
    const r = g.getBoundingClientRect();
    const L = Math.max(r.left, 0), T = Math.max(r.top, 0), R = Math.min(r.right, innerWidth), B = Math.min(r.bottom, innerHeight);
    for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) {
      const x = L + ((R - L) * i) / 8, y = T + ((B - T) * j) / 8;
      if (hits(x, y)) return { x, y };
    }
    return null;
  }, domId);
}

async function cardState(page) {
  return page.evaluate(() => {
    const c = document.querySelector('[data-tour-step]');
    if (!c) return null;
    return { step: Number(c.getAttribute('data-tour-step')), target: c.getAttribute('data-tour-target') || '', title: c.querySelector('h3')?.textContent || '', done: c.hasAttribute('data-tour-done') };
  });
}

/** Checks made once the card and ring have settled on a target. */
async function checkPlacement(page, label, cs) {
  await sleep(400); // the card moves over 0.2s
  const now = await cardState(page);
  if (!now || now.step !== cs.step || now.target !== cs.target) return; // moved on meanwhile
  const res = await page.evaluate(t => {
    const el = document.getElementById(t);
    const card = document.querySelector('[data-tour-step]');
    if (!el || !card) return { missing: true };
    const r = el.getBoundingClientRect(), c = card.getBoundingClientRect();
    const svg = el instanceof SVGElement;
    const overlap = !svg && !(c.right <= r.left || r.right <= c.left || c.bottom <= r.top || r.bottom <= c.top);
    const off = !svg && (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth);
    const cardOff = c.top < 0 || c.left < 0 || c.bottom > innerHeight + 1 || c.right > innerWidth + 1;
    let covered = false;
    if (!svg) { const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); covered = !(e && (el === e || el.contains(e))); }
    return { overlap, off, cardOff, covered, disabled: !!el.disabled };
  }, cs.target);
  if (res.missing) problems.push(`${label}: step ${cs.step} names ${cs.target}, which is not on the page`);
  if (res.overlap) problems.push(`${label}: step ${cs.step} card covers ${cs.target}`);
  if (res.off) problems.push(`${label}: step ${cs.step} target ${cs.target} is off screen`);
  if (res.cardOff) problems.push(`${label}: step ${cs.step} card is off screen`);
  if (res.covered) problems.push(`${label}: step ${cs.step} something else is on top of ${cs.target}`);
  if (res.disabled) problems.push(`${label}: step ${cs.step} target ${cs.target} is disabled`);
}

async function act(page, label, target) {
  if (target.startsWith('tm-territory-')) {
    const pt = await territoryPoint(page, target);
    if (!pt) { problems.push(`${label}: no visible, clickable part of ${target}`); return false; }
    await page.mouse.click(pt.x, pt.y);
    return true;
  }
  try { await page.locator('#' + target).click({ timeout: 2000 }); return true; } catch (e) {
    problems.push(`${label}: clicking ${target} failed: ${e.message.split('\n')[0]}`);
    return false;
  }
}

/** Waits for the card to change (step or target) or vanish, up to `ms`. */
async function waitChange(page, cs, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const now = await cardState(page);
    if (!now || now.step !== cs.step) return now;
    if (now.target !== cs.target && !now.done) return now;
    await sleep(100);
  }
  return cs;
}

/** A modal owns the screen: close it, the way a player would. */
async function closeModal(page) {
  await page.keyboard.press('Escape');
  await sleep(300);
  for (let k = 0; k < 3 && !(await cardState(page)); k++) {
    const b = page.locator('[role=dialog] button').first();
    if (await b.count()) await b.click().catch(() => {});
    await sleep(300);
  }
}

async function guidedTurn(browser, run) {
  const label = `${run.mapId}/${run.diff}/seed${run.seed}/${run.vp}${run.perturb ? '/perturbed' : ''}`;
  const before = problems.length;
  const { ctx, page, errors } = await openPage(browser, run.vp);
  try {
    const id = await seed(page, run, false);
    const start = await save(page, id);
    const homeId = start.nodes.findIndex(n => n.owner === 1);
    await page.goto(`${BASE}/game/${id}`);
    try { await page.locator('[data-tour-step]').waitFor({ timeout: 8000 }); } catch {
      problems.push(`${label}: the guided turn was not offered`); return;
    }
    const seen = new Set();
    const done = { deselect: false, help: false, cancel: false };
    let cs = await cardState(page);
    let last = -1;
    try {
    for (let guard = 0; guard < 80; guard++) {
      if (!cs) {
        await closeModal(page);
        cs = await cardState(page);
        if (!cs) { problems.push(`${label}: the card did not come back after a modal (was on step ${last})`); break; }
        if (cs.step < last) problems.push(`${label}: went back from step ${last} to ${cs.step} after a modal`);
        continue;
      }
      if (cs.step < last) problems.push(`${label}: went back from step ${last} to ${cs.step}`);
      if (process.env.TOUR_DEBUG) console.log(`  [${label}] step ${cs.step} target=${cs.target}`);
      const fresh = cs.step !== last;
      last = cs.step;
      seen.add(cs.step);

      if (cs.step === 7) {
        // A modal can still arrive over the closing card; close it and try again rather than hang.
        let ok = false;
        for (let k = 0; k < 3 && !ok; k++) {
          ok = await page.locator('[data-tour-step] button', { hasText: 'Finish' }).click({ timeout: 3000 }).then(() => true, () => false);
          if (!ok) await closeModal(page);
        }
        if (!ok) problems.push(`${label}: could not press Finish on the closing card`);
        break;
      }
      if (MANUAL.has(cs.step)) { await page.getByRole('button', { name: 'Start' }).click(); cs = await waitChange(page, cs, 3000); continue; }

      if (fresh) {
        // The step must wait for the player.
        await sleep(IDLE_MS);
        const now = await cardState(page);
        if (now && now.step !== cs.step) { problems.push(`${label}: step ${cs.step} "${cs.title}" completed itself with no action`); cs = now; continue; }
        if (now) cs = now;
      }
      for (let k = 0; k < 10 && cs && !cs.target && !cs.done; k++) { await sleep(100); cs = await cardState(page); }
      if (!cs) continue;
      if (cs.done) { cs = await waitChange(page, cs, 3000); continue; }
      if (!cs.target) {
        problems.push(`${label}: step ${cs.step} "${cs.title}" points at nothing`);
        break;
      }

      // Things a player does that the run has to survive.
      if (run.perturb && cs.step === 2 && !done.deselect) {
        done.deselect = true;
        await act(page, label, `tm-territory-${homeId}`); // deselects the capital
        const after = await waitChange(page, cs, 2000);
        if (!after || after.target !== `tm-territory-${homeId}`) problems.push(`${label}: after deselecting the capital, Build points at ${after?.target ?? 'nothing'}, not the capital`);
        cs = after; continue;
      }
      if (run.perturb && cs.step === 3 && !done.help) {
        done.help = true;
        await page.keyboard.press('?');
        await sleep(300);
        if (await cardState(page)) problems.push(`${label}: the card stayed up over How to play`);
        await closeModal(page);
        const back = await cardState(page);
        if (!back || back.step !== 3) problems.push(`${label}: after How to play the run is on step ${back?.step ?? 'none'}, not 3`);
        cs = back; continue;
      }
      if (run.perturb && cs.step === 5 && !done.cancel) {
        const cancel = page.locator('#tm-attack-cancel');
        if (await cancel.count()) {
          done.cancel = true;
          await sleep(400); // let the card settle before judging what it covers
          // Covered means the tour card is what sits on top of it. Cancel scrolled out of the
          // panel's view (on a phone the orders scroll to the Attack button) is not the tour's
          // doing: a player scrolls up to it, and so does this.
          await cancel.scrollIntoViewIfNeeded().catch(() => {});
          await sleep(300);
          const covered = await page.evaluate(() => {
            const b = document.getElementById('tm-attack-cancel').getBoundingClientRect();
            const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            return !!e && !!e.closest('[data-tour-step]');
          });
          if (covered) { problems.push(`${label}: the card covers the attack's Cancel`); await page.screenshot({ path: path.join(OUT, label.replace(/\//g, '_') + '-cancel.png') }).catch(() => {}); await page.keyboard.press('Escape'); }
          else await cancel.click();
          const after = await waitChange(page, cs, 2000);
          if (!after || !after.target.startsWith('tm-territory-')) problems.push(`${label}: after cancelling the attack, the card points at ${after?.target ?? 'nothing'}`);
          cs = after; continue;
        }
      }

      await checkPlacement(page, label, cs);
      if (!(await act(page, label, cs.target))) break;
      const next = await waitChange(page, cs, 4000);
      if (next && next.step === cs.step && next.target === cs.target) {
        problems.push(`${label}: stuck on step ${cs.step} "${cs.title}" after clicking ${cs.target}`);
        break;
      }
      cs = next;
    }
    } catch (e) {
      // One run's failure is a problem to report, never a reason to skip the runs after it.
      problems.push(`${label}: driver error: ${String(e.message || e).split('\n')[0]}`);
    }

    if (await cardState(page)) problems.push(`${label}: the run did not finish`);
    for (let n = 1; n <= 6; n++) if (!seen.has(n)) problems.push(`${label}: step ${n} was never shown`);
    const end = await save(page, id);
    const me = end.factions[1].stats;
    if (!(end.nodes[homeId].buildings.length > start.nodes[homeId].buildings.length)) problems.push(`${label}: nothing was built at the capital`);
    if (me.battlesWon + me.battlesLost === 0) problems.push(`${label}: no battle was fought`);
    if (end.turn <= start.turn) problems.push(`${label}: the turn did not advance`);
    if (run.perturb) for (const [k, v] of Object.entries(done)) if (!v) problems.push(`${label}: perturbation "${k}" never ran`);
  } finally {
    for (const e of new Set(errors)) problems.push(`${label}: ${e}`);
    if (problems.length > before) await page.screenshot({ path: path.join(OUT, label.replace(/\//g, '_') + '.png') }).catch(() => {});
    console.log(`${label} ${problems.length > before ? 'FAIL' : 'ok'}`);
    await ctx.close();
  }
}

/** The tutorial map's coach panel, walked from the first click to the post-turn step. */
async function coach(browser, run) {
  const label = `coach/${run.diff}/${run.vp}`;
  const before = problems.length;
  const { ctx, page, errors } = await openPage(browser, run.vp);
  try {
    const id = await seed(page, { mapId: 'tutorial', diff: run.diff, seed: 4 }, true);
    await page.goto(`${BASE}/game/${id}`);
    await sleep(500);
    const title = () => page.evaluate(() => {
      const l = [...document.querySelectorAll('div')].find(d => d.textContent?.trim().toLowerCase() === 'tutorial' && d.children.length === 0);
      return l ? l.parentElement.children[1]?.textContent ?? null : null;
    });
    const expect = async want => { const t = await title(); if (t !== want) problems.push(`${label}: coach says "${t}", expected "${want}"`); };
    const click = async n => { const pt = await territoryPoint(page, 'tm-territory-' + n); if (pt) await page.mouse.click(pt.x, pt.y); await sleep(300); };
    await expect('Select your capital');
    await click(0); await expect('Pick a target');
    await click(1); await expect('Read the forecast');
    await page.locator('#tm-attack').click(); await sleep(300);
    await expect('Build for the future');
    await page.keyboard.press('Escape'); await click(0);
    await page.locator('#tm-build-open').click();
    await page.locator('[id^=tm-build-]:not(#tm-build-open):not([disabled])').first().click();
    await sleep(300);
    await expect('End the turn');
    await page.locator('#tm-end-turn').click(); await sleep(600);
    await closeModal(page);
    await expect('Expand');
  } catch (e) {
    problems.push(`${label}: ${e.message.split('\n')[0]}`);
  } finally {
    for (const e of new Set(errors)) problems.push(`${label}: ${e}`);
    if (problems.length > before) await page.screenshot({ path: path.join(OUT, label.replace(/\//g, '_') + '.png') }).catch(() => {});
    console.log(`${label} ${problems.length > before ? 'FAIL' : 'ok'}`);
    await ctx.close();
  }
}

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const t0 = Date.now();
  const want = label => !FILTER || label.includes(FILTER);
  let ran = 0;
  for (const run of runs) if (want(`${run.mapId}/${run.diff}/seed${run.seed}/${run.vp}${run.perturb ? '/perturbed' : ''}`)) { ran++; await guidedTurn(browser, run).catch(e => problems.push(`run crashed: ${String(e.message || e).split('\n')[0]}`)); }
  for (const run of coachRuns) if (want(`coach/${run.diff}/${run.vp}`)) { ran++; await coach(browser, run).catch(e => problems.push(`coach crashed: ${String(e.message || e).split('\n')[0]}`)); }
  await browser.close();
  console.log(`\n${ran} runs in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`PROBLEMS (${problems.length})`);
  for (const p of problems) console.log(' - ' + p);
  process.exit(problems.length ? 1 : 0);
})();
