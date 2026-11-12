/**
 * Fireline: War for the Planet's guided first turn, played in a real browser the way a person plays it.
 *
 *   npm run tours -- fireline-planet           # the run, plus reload, reopen and dialog checks
 *   npm run tours -- fireline-planet --quick   # the same (it is already short); what CI runs
 *
 * The run starts at the sign-in gate, sets the client-side `tm_user` only, begins a Short war from
 * the lobby's War for the Planet panel on a fixed seed with "Guided first turn" ticked (a local
 * save: there is no token), and walks every step by doing what the card's `data-tour-target`
 * names: clicking the tab, button or region it rings, or, when it rings the region list, choosing
 * the option the card names in `data-tour-pick`. For every step that waits on the player it first
 * waits 1.5s and fails if the step moved on by itself, which is the bug that hides from a fast
 * script.
 *
 * Also checked: the ringed control is on screen, not under the card, not covered by anything else
 * and not disabled; Back onto a step just acted on opens it fresh rather than marked done (and it
 * does not move on again by itself); the card stays up over the propose dialog and rings its Send
 * button; a reload mid-run reopens the run on the first step not yet finished (the screen owns
 * where it resumes);
 * after the run the save holds the real effects (a city built up, a garrison recruited, the field
 * army moved, a treaty signed on turn 1, the turn ended) and nothing of the tour itself; finishing
 * closes the run for this war, so a reload does not offer it again, and the Tour button reopens it
 * on the welcome card. No page or console errors.
 *
 * Screenshots only on failure, into TOUR_OUT. See scripts/tours/run.mjs.
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.TOUR_BASE || 'http://localhost:5308';
const OUT = process.env.TOUR_OUT || path.join(require('os').tmpdir(), 'tours', 'fireline-planet');
const IDLE_MS = 1500;
const SEED = 'tour';
const USER = JSON.stringify({ userId: 'local-dev', username: 'local-dev' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const problems = [];

async function cardState(page) {
  return page.evaluate(() => {
    const c = document.querySelector('[data-tour-step]');
    if (!c) return null;
    return {
      step: Number(c.getAttribute('data-tour-step')),
      target: c.getAttribute('data-tour-target') || '',
      pick: c.getAttribute('data-tour-pick'),
      manual: c.getAttribute('data-tour-manual') === '1',
      title: c.querySelector('h3')?.textContent || '',
      done: c.hasAttribute('data-tour-done'),
    };
  });
}

async function waitChange(page, cs, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const now = await cardState(page);
    if (!now || now.step !== cs.step) return now;
    if (now.target !== cs.target && !now.done) return now;
    await sleep(100);
  }
  return cardState(page);
}

/** The ringed control must be visible, uncovered and usable. */
async function checkTarget(page, cs) {
  await sleep(300);
  const now = await cardState(page);
  if (!now || now.step !== cs.step || now.target !== cs.target) return;
  const r = await page.evaluate(t => {
    const el = document.getElementById(t);
    const card = document.querySelector('[data-tour-step]');
    if (!el || !card) return { missing: true };
    const a = el.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const big = a.width * a.height > innerWidth * innerHeight * 0.2;
    const overlap = !big && !(c.right <= a.left || a.right <= c.left || c.bottom <= a.top || a.bottom <= c.top);
    const off = a.top < 0 || a.left < 0 || a.bottom > innerHeight + 1 || a.right > innerWidth + 1;
    const cardOff = c.top < 0 || c.left < 0 || c.bottom > innerHeight + 1 || c.right > innerWidth + 1;
    const e = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2);
    return { overlap, off: !big && off, cardOff, covered: !(e && (el === e || el.contains(e))), disabled: !!el.disabled };
  }, cs.target);
  const where = `step ${cs.step} "${cs.title}"`;
  if (r.missing) problems.push(`${where} names ${cs.target}, which is not on the page`);
  if (r.overlap) problems.push(`${where}: the card covers ${cs.target}`);
  if (r.off) problems.push(`${where}: ${cs.target} is off screen`);
  if (r.cardOff) problems.push(`${where}: the card is off screen`);
  if (r.covered) problems.push(`${where}: something is on top of ${cs.target}`);
  if (r.disabled) problems.push(`${where}: ${cs.target} is disabled`);
}

const readSave = (page, id) => page.evaluate(k => JSON.parse(localStorage.getItem(k)), `fireline_save_${id}`);

function tally(s) {
  const own = s.planet.regions.map((r, i) => (r.owner === 0 ? i : -1)).filter(i => i >= 0);
  let marks = 0;
  let garrison = 0;
  for (const i of own) {
    const c = s.planet.regions[i].city;
    marks += c.level + Object.values(c.b).reduce((n, x) => n + (x || 0), 0);
    garrison += s.planet.regions[i].garrison.reduce((n, x) => n + x, 0);
  }
  return { marks, garrison, armyRegion: s.planet.factions[0].army?.region ?? null };
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('page error: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().includes('React Router Future Flag')) errors.push('console.error: ' + m.text());
  });
  let shots = 0;
  const shot = async name => {
    if (shots++ < 4) await page.screenshot({ path: path.join(OUT, `${name}.png`) }).catch(() => {});
  };

  try {
    await page.goto(BASE + '/');
    await page.waitForSelector('text=Sign in / Register');
    await page.evaluate(u => localStorage.setItem('tm_user', u), USER);
    await page.reload();
    await page.locator('[data-testid=war-setup]').waitFor();
    if (!(await page.locator('[data-testid=war-guided]').isChecked())) problems.push('"Guided first turn" was not ticked for a browser that has never seen it');
    await page.locator('[data-testid=war-seed]').fill(SEED);
    await page.locator('[data-testid=begin-war]').click();
    await page.waitForURL(/\/game\//);
    const id = page.url().split('/game/')[1].split(/[?#]/)[0];
    await page.locator('[data-testid=planet-screen]').waitFor();
    const start = tally(await readSave(page, id));

    try {
      await page.locator('[data-tour-step]').waitFor({ timeout: 8000 });
    } catch {
      problems.push('the guided first turn was not offered on a new war with it ticked');
      await shot('not-offered');
      return;
    }

    let cs = await cardState(page);
    if (cs.step !== 0) problems.push(`the run opened on step ${cs.step}, not the welcome card`);
    let last = -1;
    let reloaded = false;
    let backChecked = false;
    let dialogSeen = false;
    let finished = false;
    for (let guard = 0; guard < 120 && cs; guard++) {
      if (cs.step < last) problems.push(`went back from step ${last} to ${cs.step}`);
      const fresh = cs.step !== last;
      last = cs.step;
      if (process.env.TOUR_DEBUG) console.log(`  step ${cs.step} ${cs.title} -> ${cs.target}${cs.pick ? ` (pick ${cs.pick})` : ''}${cs.manual ? ' [manual]' : ''}`);

      if (cs.done) {
        cs = await waitChange(page, cs, 3000);
        continue;
      }

      // Back onto a step that was just acted on opens it fresh: not marked done on arrival, ringing
      // its own control, and not moving forward again by itself. Checked once, from the step after
      // the region list (step 2, which the run has just acted on).
      if (!backChecked && fresh && cs.step === 3) {
        backChecked = true;
        const backBtn = page.locator('[data-tour-step] button', { hasText: 'Back' });
        if (!(await backBtn.count())) problems.push('step 3 offers no Back button');
        else {
          await backBtn.click();
          await sleep(100);
          const b = await cardState(page);
          if (!b || b.step !== 2 || b.done || b.target !== 'pl-region-select') {
            problems.push(`Back from step 3 shows ${JSON.stringify(b)}, not step 2 open on the region list`);
          } else {
            await sleep(IDLE_MS);
            const b2 = await cardState(page);
            if (!b2 || b2.step !== 2 || b2.done) problems.push(`after Back, step 2 moved on by itself (${JSON.stringify(b2)})`);
          }
          const now = await cardState(page);
          if (now && now.step === 2 && !now.done) await page.locator('[data-tour-step] button').last().click();
          cs = await waitChange(page, now || cs, 3000);
          if (!cs || cs.step !== 3) problems.push(`skipping step 2 again after Back landed on ${cs ? `step ${cs.step}` : 'nothing'}`);
          if (!cs) break;
          last = 2; // so step 3 still gets its idle check
          continue;
        }
      }

      // A reload mid-run reopens it on the first step not yet finished: this one.
      if (!reloaded && fresh && cs.step >= 4) {
        reloaded = true;
        await page.reload();
        await page.locator('[data-testid=planet-screen]').waitFor();
        try {
          await page.locator('[data-tour-step]').waitFor({ timeout: 5000 });
        } catch {
          /* Reported below. */
        }
        const back = await cardState(page);
        if (!back || back.step !== cs.step) problems.push(`after a reload the run is on step ${back ? back.step : 'none'}, not ${cs.step}`);
        cs = back;
        last = cs ? cs.step : last;
        if (!cs) break;
      }

      if (cs.manual) {
        if (cs.target) await checkTarget(page, cs);
        const btn = page.locator('[data-tour-step] button').last();
        const text = (await btn.textContent()) || '';
        await btn.click();
        if (text.includes('Finish')) {
          finished = true;
          break;
        }
        cs = await waitChange(page, cs, 3000);
        continue;
      }

      if (fresh) {
        await sleep(IDLE_MS);
        const now = await cardState(page);
        if (now && now.step !== cs.step) {
          problems.push(`step ${cs.step} "${cs.title}" completed itself with no action`);
          cs = now;
          continue;
        }
        cs = now;
        if (!cs) break;
        if (cs.manual) continue;
      }

      if (!cs.target) {
        problems.push(`step ${cs.step} "${cs.title}" points at nothing`);
        break;
      }

      await checkTarget(page, cs);
      if (cs.target === 'pl-send-proposal') {
        dialogSeen = true;
        if (!(await page.locator('[data-testid=propose-dialog]').isVisible())) problems.push('the card rings Send with no propose dialog open');
      }
      const still = await cardState(page);
      if (!still || still.step !== cs.step || still.target !== cs.target || still.done) {
        cs = still;
        continue;
      }
      try {
        const el = page.locator('#' + cs.target);
        if ((await el.evaluate(e => e.tagName)) === 'SELECT') {
          if (cs.pick === null) {
            problems.push(`step ${cs.step} "${cs.title}" rings a list but names no option to choose`);
            break;
          }
          await el.selectOption(cs.pick, { timeout: 3000 });
        } else {
          await el.click({ timeout: 3000 });
        }
      } catch (e) {
        problems.push(`step ${cs.step}: acting on ${cs.target} failed: ${e.message.split('\n')[0]}`);
        await shot(`act-${cs.step}`);
        break;
      }
      cs = await waitChange(page, cs, 3000);
    }
    if (!finished) {
      problems.push(`the run did not reach Finish (stopped on step ${last})`);
      await shot('unfinished');
    }
    if (!reloaded) problems.push('the run never reached the step where the reload check runs');
    if (!dialogSeen) problems.push('the card never rang Send in the propose dialog');

    // The real effects, from the save.
    await sleep(400);
    const s = await readSave(page, id);
    const end = tally(s);
    if (s.planet.turn < 2) problems.push(`save: still turn ${s.planet.turn} after the run ended the turn`);
    if (end.marks <= start.marks) problems.push('save: no city was built up');
    if (end.garrison <= start.garrison) problems.push('save: no unit was recruited into a garrison');
    if (end.armyRegion === start.armyRegion) problems.push('save: the field army did not move');
    if (!s.planet.treaties.some(t => (t.a === 0 || t.b === 0) && t.since === 1 && t.kind !== 'ceasefire')) problems.push('save: no treaty signed on turn 1');
    if ('tour' in s || JSON.stringify(s).includes('tour_')) problems.push('save: the tour wrote into the war save');
    const progress = await page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), `fireline_planet_tour_${id}`);
    if (!progress || progress.open !== false) problems.push(`tour progress after Finish is ${JSON.stringify(progress)}, not closed`);

    // Closed: a reload does not offer it again, and the Tour button reopens it on the welcome card.
    await page.reload();
    await page.locator('[data-testid=planet-screen]').waitFor();
    await sleep(800);
    if (await cardState(page)) problems.push('the run was offered again after it was finished');
    await page.locator('[data-testid=planet-tour-button]').click();
    await sleep(300);
    const again = await cardState(page);
    if (!again || again.step !== 0) problems.push(`the Tour button opened ${again ? `step ${again.step}` : 'nothing'}, not the welcome card`);

    // A new war in this browser now leaves the option unticked.
    await page.goto(BASE + '/');
    await page.locator('[data-testid=war-setup]').waitFor();
    if (await page.locator('[data-testid=war-guided]').isChecked()) problems.push('"Guided first turn" is still ticked after the run was finished');

    for (const e of errors) problems.push(e);
    if (problems.length) await shot('end');
  } finally {
    await browser.close();
  }
}

main()
  .catch(e => problems.push('driver crashed: ' + (e.stack || e.message)))
  .finally(() => {
    if (problems.length) {
      console.log(`fireline-planet tour: ${problems.length} problem(s)`);
      for (const p of problems) console.log('  - ' + p);
      process.exit(1);
    }
    console.log('fireline-planet tour: ok');
  });
