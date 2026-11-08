/**
 * Fireline: the guided first battle, played in a real browser the way a person plays it.
 *
 *   npm run tours -- fireline           # the run, plus pause, reload and replay checks
 *   npm run tours -- fireline --quick   # the same (it is already short); what CI runs
 *
 * The run starts at the sign-in gate, sets the client-side `tm_user` only, begins a battle from the
 * lobby (a local save: there is no token), and walks every step by doing what the card's
 * `data-tour-target` names: clicking the build button or tab it rings, placing a structure where
 * the placement preview says it fits (`data-placement="ok"` on the battlefield), dragging a box,
 * right-clicking an order. For every step that waits on the player it first waits 1.5s and fails if
 * the step moved on by itself, which is the bug that hides from a fast script.
 *
 * Also checked: the ringed control is on screen, not under the card, not covered by anything else
 * and not disabled; pausing hides the card and resuming brings it back on the same step; after the
 * run the save holds the real effects (a Generator, a Refinery, a Barracks, a hauler, a soldier
 * trained or queued, riflemen moved from where they started); finishing marks the run seen, so a
 * reload does not offer it again, and the Tour button reopens it on the welcome card. No page or
 * console errors. Desktop only: the game asks for a mouse and keyboard.
 *
 * Screenshots only on failure, into TOUR_OUT. See scripts/tours/run.mjs.
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.TOUR_BASE || 'http://localhost:5306';
const OUT = process.env.TOUR_OUT || path.join(require('os').tmpdir(), 'tours', 'fireline');
const IDLE_MS = 1500;
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

/** The ringed control must be visible, uncovered and usable. The battlefield is checked separately. */
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
    const overlap = !(c.right <= a.left || a.right <= c.left || c.bottom <= a.top || a.bottom <= c.top);
    const off = a.top < 0 || a.left < 0 || a.bottom > innerHeight + 1 || a.right > innerWidth + 1;
    const cardOff = c.top < 0 || c.left < 0 || c.bottom > innerHeight + 1 || c.right > innerWidth + 1;
    const e = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2);
    return { overlap, off, cardOff, covered: !(e && (el === e || el.contains(e))), disabled: !!el.disabled };
  }, cs.target);
  const where = `step ${cs.step} "${cs.title}"`;
  if (r.missing) problems.push(`${where} names ${cs.target}, which is not on the page`);
  if (r.overlap) problems.push(`${where}: the card covers ${cs.target}`);
  if (r.off) problems.push(`${where}: ${cs.target} is off screen`);
  if (r.cardOff) problems.push(`${where}: the card is off screen`);
  if (r.covered) problems.push(`${where}: something is on top of ${cs.target}`);
  if (r.disabled) problems.push(`${where}: ${cs.target} is disabled`);
}

async function field(page) {
  return page.locator('#fl-battlefield').boundingBox();
}

/** Points on the battlefield that are not under the card, centre outward. */
async function openPoints(page) {
  const b = await field(page);
  const pts = [];
  for (let y = b.y + 60; y < b.y + b.height - 60; y += 32)
    for (let x = b.x + 60; x < b.x + b.width - 60; x += 32) pts.push([x, y]);
  const cx = b.x + b.width * 0.4;
  const cy = b.y + b.height * 0.45;
  pts.sort((p, q) => (p[0] - cx) ** 2 + (p[1] - cy) ** 2 - ((q[0] - cx) ** 2 + (q[1] - cy) ** 2));
  return page.evaluate(list => list.filter(([x, y]) => document.elementFromPoint(x, y)?.id === 'fl-battlefield'), pts);
}

async function place(page, cs) {
  for (const [x, y] of await openPoints(page)) {
    await page.mouse.move(x, y);
    await sleep(140);
    const ok = await page.locator('#fl-battlefield').getAttribute('data-placement');
    if (ok === 'ok') {
      await page.mouse.click(x, y);
      return true;
    }
  }
  problems.push(`step ${cs.step} "${cs.title}": found nowhere the preview said the structure fits`);
  return false;
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
    await page.getByRole('button', { name: /Begin the battle/ }).click();
    await page.waitForURL(/\/game\//);
    const id = page.url().split('/game/')[1].split(/[?#]/)[0];
    const startSave = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), `fireline_save_${id}`);
    const startRifles = new Map(startSave.units.filter(u => u.owner === 0 && u.kind === 'rifleman').map(u => [u.id, [u.x, u.y]]));
    await page.getByRole('button', { name: 'Fast' }).click();

    try {
      await page.locator('[data-tour-step]').waitFor({ timeout: 8000 });
    } catch {
      problems.push('the guided run was not offered on a fresh battle');
      return;
    }

    let cs = await cardState(page);
    if (cs.step !== 0) problems.push(`the run opened on step ${cs.step}, not the welcome card`);
    let last = -1;
    let pausedOnce = false;
    let finished = false;
    for (let guard = 0; guard < 120 && cs; guard++) {
      if (cs.step < last) problems.push(`went back from step ${last} to ${cs.step}`);
      const fresh = cs.step !== last;
      last = cs.step;
      if (process.env.TOUR_DEBUG) console.log(`  step ${cs.step} ${cs.title} -> ${cs.target}`);

      if (cs.done) {
        cs = await waitChange(page, cs, 3000);
        continue;
      }
      if (cs.manual) {
        if (cs.target && cs.target !== 'fl-battlefield') await checkTarget(page, cs);
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
      }

      // Pausing must hide the card and resuming must bring back the same step.
      if (!pausedOnce && cs.step >= 3) {
        pausedOnce = true;
        await page.locator('[data-testid=pause]').click();
        await sleep(300);
        if (await cardState(page)) problems.push('the card stayed up over the pause screen');
        await page.locator('[data-testid=pause]').click();
        await sleep(400);
        const back = await cardState(page);
        if (!back || back.step !== cs.step) problems.push(`after pausing the run is on step ${back?.step ?? 'none'}, not ${cs.step}`);
        cs = back;
        if (!cs) break;
        continue;
      }

      if (!cs.target) {
        problems.push(`step ${cs.step} "${cs.title}" points at nothing`);
        break;
      }

      if (cs.target === 'fl-battlefield') {
        const b = await field(page);
        if (cs.title.startsWith('Place') || cs.title.startsWith('Build')) {
          await place(page, cs);
        } else if (cs.title.startsWith('Select')) {
          await page.mouse.move(b.x + 20, b.y + 20);
          await page.mouse.down();
          await page.mouse.move(b.x + b.width - 20, b.y + b.height - 20, { steps: 8 });
          await page.mouse.up();
        } else if (cs.title.startsWith('Give')) {
          const pts = await openPoints(page);
          const [x, y] = pts[Math.min(pts.length - 1, 40)];
          await page.mouse.click(x, y, { button: 'right' });
        } else {
          problems.push(`step ${cs.step} "${cs.title}": the driver does not know how to act on the battlefield here`);
          break;
        }
        cs = await waitChange(page, cs, 8000);
        continue;
      }

      await checkTarget(page, cs);
      const el = page.locator('#' + cs.target);
      if (cs.target.startsWith('fl-build-') && (await el.getAttribute('data-state')) === 'building') {
        // Under construction: wait for Ready, then pick it up.
        try {
          await page.locator(`#${cs.target}[data-state=ready]`).waitFor({ timeout: 30000 });
        } catch {
          problems.push(`step ${cs.step} "${cs.title}": ${cs.target} never became Ready`);
          await shot(`never-ready-${cs.step}`);
          break;
        }
      }
      try {
        await el.click({ timeout: 3000 });
      } catch (e) {
        problems.push(`step ${cs.step}: clicking ${cs.target} failed: ${e.message.split('\n')[0]}`);
        await shot(`click-${cs.step}`);
        break;
      }
      // A click that started construction changes nothing on the card; the next pass waits for Ready.
      cs = await waitChange(page, cs, 1500);
    }
    if (!finished) {
      problems.push(`the run did not reach Finish (stopped on step ${last})`);
      await shot('unfinished');
    }

    // The real effects, from the save written on pause.
    await page.locator('[data-testid=pause]').click();
    await sleep(500);
    const s = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), `fireline_save_${id}`);
    const mine = k => s.buildings.filter(b => b.owner === 0 && b.kind === k).length;
    if (mine('power') < 1) problems.push('save: no Generator after the run');
    if (mine('refinery') < 1) problems.push('save: no Refinery after the run');
    if (mine('barracks') < 1) problems.push('save: no Barracks after the run');
    if (!s.units.some(u => u.owner === 0 && u.kind === 'hauler')) problems.push('save: no hauler after the run');
    if (s.players[0].stats.trained < 1 && s.players[0].queues.infantry.length < 1) problems.push('save: no soldier trained or queued');
    const moved = s.units.some(u => startRifles.has(u.id) && Math.hypot(u.x - startRifles.get(u.id)[0], u.y - startRifles.get(u.id)[1]) > 1);
    if (!moved) problems.push('save: no rifleman moved from where it started');

    // Seen: a reload does not offer it again, and the Tour button reopens it on the welcome card.
    await page.reload();
    await page.locator('[data-testid=battlefield]').waitFor();
    await sleep(800);
    if (await cardState(page)) problems.push('the run was offered again after it was finished');
    await page.locator('[data-testid=tour-button]').click();
    await sleep(300);
    const again = await cardState(page);
    if (!again || again.step !== 0) problems.push(`the Tour button opened ${again ? `step ${again.step}` : 'nothing'}, not the welcome card`);

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
      console.log(`fireline tour: ${problems.length} problem(s)`);
      for (const p of problems) console.log('  - ' + p);
      process.exit(1);
    }
    console.log('fireline tour: ok');
  });
