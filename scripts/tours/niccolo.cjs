/**
 * Banco di Niccolò: the How to play overlay (both variants) and the guided tour, played in a browser.
 *
 *   npm run tours -- niccolo            # full matrix
 *   npm run tours -- niccolo --quick    # what CI runs
 *
 * The tour is driven by clicking whatever its card names (`data-tour-target`), never by reading the
 * copy. On every step it checks:
 *   - the step does not complete itself: no action is taken for 1.5s after a real step appears, and
 *     its index must not move (Thrash Margin's attack step once read as done on arrival and the card
 *     flashed past it). The welcome and closing cards advance on a button and are exempt;
 *   - the target is on screen, enabled (or the card says why not), and is what a click at its centre
 *     actually hits; the ring stays inside the window and the card does not cover the target;
 *   - the run never goes backwards across a modal, and no tour card shows over one;
 *   - the step's real effect lands in the save (localStorage) once it completes.
 * At the end: every real step was shown (Select your ship may be passed over by Start only when the
 * ship is already selected), and the save shows cloth bought and sold at Antwerp, the week advanced,
 * Julius posted, London's courier line invested in and a new bill on the ladder.
 *
 * Also: the How to play cards fit the screen; Start, Back, Skip tour and reopening behave; the
 * Chronicle hides the tour and gives it back on the same step; a guild closure (forced at Antwerp,
 * and at Bruges) leaves Buy or Sell disabled with an explanation and Skip this as the way on;
 * reopening the tour after finishing it (ship docked at Antwerp, London's courier already at its
 * fastest) passes over the voyage steps instead of flashing through them and explains the disabled
 * Invest. Niccolò's sim rolls closures and losses at sea with Math.random, so the driver accepts a
 * natural closure (with its note) or a recorded loss of the bale in any run, and adjusts what it
 * expects of the save; it never accepts cargo that vanished with no loss on record.
 *
 * TOUR_VERBOSE=1 prints every step and modal; TOUR_ONLY=<regex> narrows the matrix by run label.
 *
 * Campaigns are seeded with the real sim through Vite and kept in browser saves; only the
 * client-side `tm_user` is set. See scripts/tours/run.mjs.
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.TOUR_BASE || 'http://localhost:5304';
const OUT = process.env.TOUR_OUT || path.join(require('os').tmpdir(), 'tours', 'niccolo');
const QUICK = process.env.TOUR_QUICK === '1';
const VERBOSE = process.env.TOUR_VERBOSE === '1';
const IDLE_MS = 1500;
const VIEWPORTS = { desktop: { width: 1400, height: 900 }, phone: { width: 390, height: 844 }, landscape: { width: 844, height: 390 } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
require('fs').mkdirSync(OUT, { recursive: true });

// What each real step must leave behind in the save, keyed by its title. `before` is the save when
// the step appeared, `after` the save once it moved on.
const EFFECTS = {
  'Select your ship': null,
  'Buy some cloth': (b, a) => cloth(a) > cloth(b) && a.cash < b.cash,
  'Look at Antwerp': null,
  'Confirm the voyage': (b, a) => ship(a).destination === 'antwerp' || ship(a).location === 'antwerp',
  'Advance the clock': (b, a) => a.week > b.week && ship(a).location === 'antwerp' && !ship(a).destination,
  'Sell it at a profit': (b, a) => cloth(a) === 0 && cloth(b) > 0 && a.cash > b.cash,
  'Assign an officer': (b, a) => JSON.stringify(julius(a).assignment) !== JSON.stringify(julius(b).assignment),
  'Invest in a courier line': (b, a) => (a.courierInvestment.london ?? 0) > (b.courierInvestment.london ?? 0),
  'Write a bill of exchange': (b, a) => a.obligations.some(o => !b.obligations.some(p => p.id === o.id)),
};
const ship = g => g.vessels.find(v => v.id === 'ship_1') || {};
const cloth = g => ship(g).cargo?.cloth ?? 0;
const julius = g => g.characters.find(c => c.id === 'julius') || {};

// scenario: skip = skip-prologue campaign; ch0 = prologue played through the reducer; ch0tut = a
// fresh prologue (Chapter 0's own How to play); hot = skip-prologue with a hotseat house.
const runs = [];
if (QUICK) {
  runs.push({ scenario: 'ch0', vp: 'desktop', expectTourOffer: true, ch0TutorialSeen: true });
  runs.push({ scenario: 'skip', vp: 'desktop', controls: true });
  runs.push({ scenario: 'hot', vp: 'phone', tutorialSeen: true, hotseat: 'medici', chronicleAt: 7 });
  runs.push({ scenario: 'skip', vp: 'phone', label: 'closed', tutorialSeen: true, closeAntwerpCloth: true });
} else {
  for (const vp of ['desktop', 'phone']) {
    runs.push({ scenario: 'skip', vp, expectTourOffer: true });
    runs.push({ scenario: 'skip', vp, label: 'courier', tutorialSeen: true, selectCourier: true });
    runs.push({ scenario: 'skip', vp, controls: true });
    runs.push({ scenario: 'ch0', vp, expectTourOffer: true, ch0TutorialSeen: true });
    runs.push({ scenario: 'ch0', vp, label: 'choice1', choice: 1, ch0TutorialSeen: true, tutorialSeen: true });
    runs.push({ scenario: 'hot', vp, tutorialSeen: true, hotseat: 'medici', chronicleAt: 7 });
    runs.push({ scenario: 'skip', vp, label: 'closed', tutorialSeen: true, closeAntwerpCloth: true });
    runs.push({ scenario: 'ch0', vp, label: 'closed-bruges', tutorialSeen: true, ch0TutorialSeen: true, closeBrugesCloth: true });
    runs.push({ scenario: 'skip', vp, label: 'again', tutorialSeen: true, again: true });
    runs.push({ scenario: 'ch0tut', vp, tutorialOnly: true });
  }
  runs.push({ scenario: 'skip', vp: 'desktop', label: 'dark', theme: 'dark', expectTourOffer: true });
  runs.push({ scenario: 'skip', vp: 'landscape', tutorialOnly: true });
  runs.push({ scenario: 'skip', vp: 'landscape', label: 'tour', tutorialSeen: true });
}

const problems = [];
const labelOf = o => `${o.scenario}/${o.vp}${o.label ? '/' + o.label : ''}${o.controls ? '/controls' : ''}`;

async function seed(page, opts) {
  return page.evaluate(async opts => {
    const { createInitialState } = await import('/src/sim/state.ts');
    const { processAction } = await import('/src/sim/actions.ts');
    const { findEvent } = await import('/src/sim/content.ts');
    const id = 'tour-' + opts.scenario + '-' + Math.random().toString(36).slice(2, 8);
    let g;
    if (opts.scenario === 'skip' || opts.scenario === 'hot') {
      g = createInitialState(id, 'Tour ' + opts.scenario, { skipPrologue: true, hotseatHouseId: opts.hotseat ?? null });
      if (opts.controls) { g.pendingEvents = []; g.firedEvents = [...g.firedEvents, 'ev_c1_001']; }
    } else if (opts.scenario === 'ch0tut') {
      g = createInitialState(id, 'Tour ' + opts.scenario);
    } else {
      // The prologue through the real reducer: resolve events with the chosen option, send the
      // handcart to Ghent when the story asks, otherwise advance the week.
      g = createInitialState(id, 'Tour ' + opts.scenario);
      for (let guard = 0; guard < 200 && !g.flags.chapter0_complete; guard++) {
        if (g.pendingEvents.length) {
          const ev = findEvent(g.pendingEvents[0]);
          const choiceIndex = Math.min(opts.choice ?? 0, (ev?.choices?.length ?? 1) - 1);
          g = processAction(g, { type: 'RESOLVE_EVENT', eventId: g.pendingEvents[0], choiceIndex });
          continue;
        }
        const cart = g.vessels.find(v => v.id === 'handcart_1');
        if (cart && g.flags.sent_to_ghent && !g.flags.learned_the_roads && !cart.destination && cart.location !== 'ghent') {
          g = processAction(g, { type: 'DISPATCH_VESSEL', vesselId: 'handcart_1', destinationId: 'ghent', insure: false });
          continue;
        }
        g = processAction(g, { type: 'ADVANCE_WEEK' });
      }
      if (!g.flags.chapter0_complete) throw new Error('prologue did not complete');
    }
    // A guild closure of cloth for ten weeks, at Antwerp (Sell) or at Bruges (Buy): the seeded RNG
    // produces both in some campaigns and not others.
    const closeAt = opts.closeAntwerpCloth ? 'antwerp' : opts.closeBrugesCloth ? 'bruges' : null;
    if (closeAt) {
      g = { ...g, marketEvents: [{ id: 'mev_test', templateId: 'guild_closure', kind: 'embargo', cityId: closeAt, goodId: 'cloth', multiplier: 1, blocksTrade: true, startedWeek: g.week, endsWeek: g.week + 10, headline: 'The guild has closed Flemish Cloth to foreign houses (test).' }] };
    }
    localStorage.setItem('niccolo_save_' + id, JSON.stringify(g));
    if (opts.tutorialSeen || opts.controls) localStorage.setItem('niccolo_tutorial_seen', '1');
    if (opts.ch0TutorialSeen) localStorage.setItem('niccolo_chapter0_tutorial_seen', '1');
    return { id, firstVessel: g.vessels[0]?.id };
  }, opts);
}

const readSave = (page, id) => page.evaluate(id => JSON.parse(localStorage.getItem('niccolo_save_' + id) || 'null'), id);

// Any centred modal at z-index 100 (event, chapter card, How to play, hotseat, Chronicle).
const MODAL_FN = () => {
  for (const el of document.querySelectorAll('div')) {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' && cs.zIndex === '100') {
      return { text: el.innerText.slice(0, 160).replace(/\n/g, ' | '), buttons: [...el.querySelectorAll('button')].map(b => b.innerText.trim()) };
    }
  }
  return null;
};
const modalInfo = page => page.evaluate(MODAL_FN);
const stepNow = page => page.evaluate(() => {
  const c = document.querySelector('[data-tour-step]');
  return c ? Number(c.getAttribute('data-tour-step')) : null;
});

async function tourInfo(page) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-tour-step]');
    if (!card) return null;
    const target = card.getAttribute('data-tour-target') || '';
    const cr = card.getBoundingClientRect();
    const label = card.querySelector('p')?.innerText || '';
    const m = /(\d+)\s+of\s+(\d+)/.exec(label);
    const out = {
      step: Number(card.getAttribute('data-tour-step')),
      total: m ? Number(m[2]) : null,
      title: card.querySelector('h3')?.innerText,
      body: card.innerText,
      note: card.querySelector('[data-tour-note]')?.innerText || '',
      target,
      card: { l: cr.left, t: cr.top, r: cr.right, b: cr.bottom },
      buttons: [...card.querySelectorAll('button')].map(b => b.innerText.trim()),
      vw: innerWidth, vh: innerHeight,
    };
    const ring = [...document.querySelectorAll('div')].find(d => d.style.boxShadow.includes('9999px'));
    if (ring) { const r = ring.getBoundingClientRect(); out.ring = { l: r.left, t: r.top, r: r.right, b: r.bottom }; }
    if (target) {
      const el = document.getElementById(target);
      if (el) {
        const r = el.getBoundingClientRect();
        out.el = { l: r.left, t: r.top, r: r.right, b: r.bottom, disabled: !!el.disabled, tag: el.tagName };
        const cx = (Math.max(r.left, 0) + Math.min(r.right, innerWidth)) / 2;
        const cy = (Math.max(r.top, 0) + Math.min(r.bottom, innerHeight)) / 2;
        const hit = document.elementFromPoint(cx, cy);
        out.hitOk = !!hit && (hit === el || el.contains(hit));
        out.hitWhat = hit ? (hit.id || hit.tagName + ':' + (hit.innerText || '').slice(0, 30)) : null;
      }
    }
    return out;
  });
}

function overlap(a, b) {
  const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
  const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
  return w > 2 && h > 2;
}

/** Wait until the tour card shows a step other than `step`, or disappears, or a modal opens. */
async function waitForMove(page, step, ms) {
  try {
    await page.waitForFunction(s => {
      const c = document.querySelector('[data-tour-step]');
      if (!c || Number(c.getAttribute('data-tour-step')) !== s) return true;
      return !!window.__tourModal();
    }, step, { timeout: ms, polling: 100 });
    return true;
  } catch { return false; }
}

async function clickModal(page, which) {
  await page.evaluate(which => {
    for (const el of document.querySelectorAll('div')) {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' && cs.zIndex === '100') {
        const bs = [...el.querySelectorAll('button')];
        (which === 'last' ? bs[bs.length - 1] : bs[0]).click();
        return;
      }
    }
  }, which);
}

async function waitModalChanged(page, prevText) {
  try {
    await page.waitForFunction(prev => {
      const m = window.__tourModal();
      return !m || m.text !== prev;
    }, prevText, { timeout: 5000, polling: 100 });
    return true;
  } catch { return false; }
}

async function run(browser, opts) {
  const label = labelOf(opts);
  const mine = [];
  const problem = msg => { mine.push(msg); if (VERBOSE) console.log('    PROBLEM ' + msg); };
  const log = msg => { if (VERBOSE) console.log('    ' + msg); };
  const shot = async name => { await page.screenshot({ path: path.join(OUT, `${label.replace(/\//g, '-')}-${name}.png`) }).catch(() => {}); };
  const started = Date.now();

  const context = await browser.newContext({ viewport: VIEWPORTS[opts.vp], deviceScaleFactor: 1 });
  await context.addInitScript(theme => {
    localStorage.setItem('tm_user', JSON.stringify({ userId: 'local-dev', username: 'local-dev' }));
    if (theme) localStorage.setItem('tm_theme', theme);
  }, opts.theme || null);
  await context.addInitScript(`window.__tourModal = ${MODAL_FN.toString()};`);
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => {
    if (/React Router Future Flag/i.test(m.text())) return;
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`console ${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', e => errors.push('page error: ' + e.message));

  try {
    await page.goto(BASE + '/');
    const info = await seed(page, opts);
    await page.goto(BASE + '/game/' + info.id);
    await page.waitForSelector('#advance-week-button', { timeout: 15000 });
    const seeded = await readSave(page, info.id);

    if (opts.controls) await controls(page, problem, log);
    else {
      const r1 = await playTour(page, opts, info, problem, log, shot);
      if (r1 && r1.finished && !opts.tutorialOnly) {
        // The run's net effect, against the save as seeded.
        const fin = await readSave(page, info.id);
        const want = [
          ['week advanced', fin.week > seeded.week],
          ['Julius posted', JSON.stringify(julius(fin).assignment) !== JSON.stringify(julius(seeded).assignment)],
          ["London's courier line invested in", (fin.courierInvestment.london ?? 0) > (seeded.courierInvestment.london ?? 0)],
          ['a new bill written', fin.obligations.some(o => !seeded.obligations.some(p => p.id === o.id))],
          ['ship docked at Antwerp', ship(fin).location === 'antwerp' && !ship(fin).destination],
        ];
        if (r1.skipped.has('Buy some cloth')) want.push(['an empty hold (Buy was closed)', cloth(fin) === 0]);
        else if (r1.lostAtSea) want.push(['an empty hold (the bale was lost at sea)', cloth(fin) === 0 && r1.effects.has('Buy some cloth')]);
        else if (r1.skipped.has('Sell it at a profit')) want.push(['the bale still aboard (Sell was closed)', cloth(fin) > 0 && r1.effects.has('Buy some cloth')]);
        else want.push(['cloth bought and sold (hold empty)', cloth(fin) === 0 && r1.effects.has('Buy some cloth') && r1.effects.has('Sell it at a profit')]);
        const detail = `(week ${seeded.week}->${fin.week}, ship ${ship(fin).location}${ship(fin).destination ? '->' + ship(fin).destination : ''}, cargo ${JSON.stringify(ship(fin).cargo)}, effects seen: ${[...r1.effects].join('; ')}; skipped: ${[...r1.skipped].join('; ') || 'none'})`;
        for (const [what, ok] of want) if (!ok) problem(`final save: expected ${what} ${detail}`);
      }
      if (opts.again && !mine.length) {
        // Reopen after finishing: the ship now sits at Antwerp with an empty hold, Antwerp may still
        // be the previewed city. The second run must still never complete a step by itself.
        const btn = page.getByRole('button', { name: 'Guided tour' });
        if (!(await btn.count())) problem('no Guided tour button after finishing the tour');
        else {
          await btn.click();
          await playTour(page, { ...opts, reopened: true }, info, problem, log, shot);
        }
      }
    }
  } catch (e) {
    problem('driver error: ' + e.message.split('\n')[0]);
  }
  for (const e of errors) problem(e);
  if (mine.length) await shot('fail');
  await context.close();
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (mine.length) {
    console.log(`${label} FAIL (${secs}s) ${mine[0]}${mine.length > 1 ? ` (+${mine.length - 1} more)` : ''}`);
    for (const m of mine) problems.push(`[${label}] ${m}`);
  } else console.log(`${label} ok (${secs}s)`);
}

/** Start, Back, Skip tour and reopening, each followed by an idle hold. */
async function controls(page, problem, log) {
  const expectStep = async (what, want) => {
    const s = await stepNow(page);
    if (s !== want) problem(`${what}: tour on step ${s === null ? 'none' : s + 1}, expected ${want === null ? 'none' : want + 1}`);
    if (s !== null) {
      await sleep(IDLE_MS);
      const s2 = await stepNow(page);
      if (s2 !== s) problem(`${what}: step ${s + 1} moved to ${s2 === null ? 'none' : s2 + 1} with no action`);
    }
    log(`${what}: ${s}`);
  };
  const click = async name => { await page.getByRole('button', { name, exact: true }).click(); };
  await click('Guided tour');
  await expectStep('open', 0);
  // The ship is selected by default here, so Start passes over Select your ship.
  await click('Start');
  await expectStep('Start', 2);
  await click('Back');
  await expectStep('Back', 0);
  await click('Start');
  await expectStep('Start again', 2);
  // Do the step, then Back: done steps are passed over in reverse, and wherever it lands must hold.
  await page.click('#market-buy-cloth');
  if (!(await waitForMove(page, 2, 4000))) problem('buying cloth did not complete Buy some cloth');
  await expectStep('after buying', 3);
  await click('Back');
  const s = await stepNow(page);
  if (s === null || s > 2) problem(`Back from Look at Antwerp went to ${s === null ? 'none' : s + 1}`);
  await expectStep('Back after buying', s);
  await click('Skip tour');
  await expectStep('Skip tour', null);
  await click('Guided tour');
  await expectStep('reopened', 0);
  await click('Start');
  // A fresh run: the bale already aboard is the baseline, so Buy some cloth asks again.
  await expectStep('Start after reopening', 2);
}

async function playTour(page, opts, info, problem, log, shot) {
  const { vp } = opts;
  const innerW = VIEWPORTS[vp].width, innerH = VIEWPORTS[vp].height;
  const shown = new Set();
  const effects = new Set();
  const skipped = new Set();
  let lostAtSea = false;
  let total = null;
  let lastStep = null, actedStep = null, before = null, stepBeforeModal = null;
  let tourStarted = !!opts.reopened, finished = false, tutorialCards = 0, offeredTour = false;
  for (let iter = 0; iter < 120 && !finished; iter++) {
    const modal = await modalInfo(page);
    if (modal) {
      if (await page.$('[data-tour-step]')) problem(`tour card visible over modal "${modal.text.slice(0, 40)}"`);
      if (/How to play/i.test(modal.text)) {
        tutorialCards++;
        const geo = await page.evaluate(() => {
          for (const el of document.querySelectorAll('div')) {
            const cs = getComputedStyle(el);
            if (cs.position === 'fixed' && cs.zIndex === '100') {
              const card = el.firstElementChild.getBoundingClientRect();
              const btns = [...el.querySelectorAll('button')].map(b => { const r = b.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right }; });
              return { card: { t: card.top, b: card.bottom, l: card.left, r: card.right }, btns, title: el.querySelector('h2')?.innerText };
            }
          }
        });
        if (geo && (geo.btns.some(b => b.t < 0 || b.b > innerH || b.l < 0 || b.r > innerW) || geo.card.t < 0 || geo.card.b > innerH)) {
          problem(`How to play card "${geo.title}" runs off screen ${JSON.stringify(geo.card)}`);
        }
        const btns = modal.buttons;
        if (btns.includes('Walk me through the first move')) {
          offeredTour = true;
          await page.getByRole('button', { name: 'Walk me through the first move' }).click();
          tourStarted = true;
        } else if (btns.includes('Begin')) {
          if (opts.expectTourOffer) problem('last How to play card offered no guided tour');
          await page.getByRole('button', { name: 'Begin' }).click();
          if (opts.tutorialOnly || opts.expectTourOffer) {
            if (tutorialCards < 2) problem(`How to play closed after only ${tutorialCards} card(s)`);
            finished = true; break;
          }
        } else {
          await page.getByRole('button', { name: 'Next' }).click();
        }
      } else {
        log(`modal: ${modal.text.slice(0, 60)} -> ${modal.buttons.includes('Not yet') ? 'last' : 'first'}`);
        if (lastStep !== null) stepBeforeModal = Math.max(stepBeforeModal ?? -1, lastStep);
        await clickModal(page, modal.buttons.includes('Not yet') ? 'last' : 'first');
      }
      if (!(await waitModalChanged(page, modal.text))) { problem(`modal "${modal.text.slice(0, 40)}" did not respond to a click`); break; }
      continue;
    }

    const t = await tourInfo(page);
    if (!t) {
      if (opts.tutorialOnly) { finished = true; break; }
      if (!tourStarted) {
        const btn = page.getByRole('button', { name: 'Guided tour' });
        if (await btn.count()) {
          if (opts.selectCourier) {
            // Select the other vessel first, so Select your ship has something to ask for. The fleet
            // list lives in the Fleet & orders panel, which starts closed: open it the way a player
            // would, pick the courier, then put the panel away again, so the tour itself has to
            // bring the panel back to point at the ship.
            await page.getByRole('button', { name: 'Fleet & orders', exact: true }).click({ timeout: 5000 });
            await page.waitForSelector('#game-sidebar.open', { timeout: 3000 });
            await page.click('#vessel-button-courier_1', { timeout: 5000 });
            await page.waitForFunction(() => document.getElementById('vessel-button-courier_1')?.style.background !== 'transparent', null, { timeout: 3000 })
              .catch(() => problem('selecting the courier did not take'));
            await page.getByRole('button', { name: 'Close fleet and orders (Esc)' }).click({ timeout: 5000 });
            await page.waitForFunction(() => {
              const p = document.getElementById('game-sidebar');
              return p && !p.classList.contains('open') && getComputedStyle(p).visibility === 'hidden';
            }, null, { timeout: 3000 });
          }
          await btn.click(); tourStarted = true; await page.waitForSelector('[data-tour-step]', { timeout: 3000 }).catch(() => {}); continue; }
        problem('no tour card and no Guided tour button');
        break;
      }
      problem(`tour disappeared on step ${lastStep === null ? '-' : lastStep + 1} without Finish`);
      break;
    }
    total = t.total;
    if (stepBeforeModal !== null) {
      if (t.step < stepBeforeModal) problem(`tour went back from step ${stepBeforeModal + 1} to ${t.step + 1} after a modal`);
      stepBeforeModal = null;
    }
    const manual = t.buttons.includes('Start') || t.buttons.includes('Finish');

    if (t.step !== lastStep) {
      if (lastStep === null && t.step !== 0) problem(`tour opened on step ${t.step + 1} ("${t.title}"), not the welcome card`);
      if (lastStep !== null && t.step < lastStep) problem(`tour went back from step ${lastStep + 1} to ${t.step + 1}`);
      // The effect of the step just left, read from the save.
      if (lastStep !== null && actedStep === lastStep && before) await checkEffect(before, lastStep);
      lastStep = t.step; actedStep = null;
      log(`step ${t.step + 1} "${t.title}"${manual ? ' (manual)' : ''}`);
      if (!manual) {
        if (!(t.title in EFFECTS)) problem(`unknown step title "${t.title}" (update EFFECTS in this driver)`);
        before = { title: t.title, save: await readSave(page, info.id) };
        // THE check: a person reads the card before acting. Take no action and the step must hold.
        await sleep(IDLE_MS);
        const s2 = await stepNow(page);
        const m2 = await modalInfo(page);
        if (s2 !== t.step) {
          problem(`step ${t.step + 1} "${t.title}" completed itself: moved to ${s2 === null ? 'nothing' : s2 + 1} within ${IDLE_MS}ms with no action${m2 ? ` (modal: ${m2.text.slice(0, 40)})` : ''}`);
          continue;
        }
        if (m2) problem(`a modal opened on its own during step ${t.step + 1}: ${m2.text.slice(0, 40)}`);
        shown.add(t.step);
      }
    }

    if (manual) {
      if (t.buttons.includes('Finish')) { await page.getByRole('button', { name: 'Finish', exact: true }).click(); finished = true; break; }
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      if (!(await waitForMove(page, t.step, 3000))) { problem(`Start did not leave step ${t.step + 1}`); break; }
      continue;
    }

    if (actedStep === t.step) {
      // Already acted (a modal intervened); the advance comes once the screen is the tour's again.
      if (await waitForMove(page, t.step, 3000)) continue;
      problem(`step ${t.step + 1} "${t.title}" did not complete after clicking ${t.target || 'its target'}`);
      break;
    }

    // The target can take a moment to exist (a popup section opening): wait for the card to name it.
    // Re-measured now, after the hold: the first reading was taken while the card was still sliding
    // into place (it transitions top/left over 0.2s).
    let cur = await tourInfo(page);
    if (!cur || cur.step !== t.step) continue;
    if (!cur.target || !cur.el) {
      try {
        await page.waitForFunction(() => {
          const c = document.querySelector('[data-tour-step]');
          const id = c && c.getAttribute('data-tour-target');
          return !c || (id && document.getElementById(id));
        }, null, { timeout: 4000, polling: 100 });
      } catch { /* reported below */ }
      cur = await tourInfo(page);
      if (!cur || cur.step !== t.step) continue;
      if (!cur.target || !cur.el) { problem(`step ${t.step + 1} "${t.title}" never ringed a target on screen`); break; }
    }
    // Geometry, measured after the hold so the layout and any instant scroll have settled.
    if (cur.ring) {
      const vis = { l: Math.max(cur.el.l, 0), t: Math.max(cur.el.t, 0), r: Math.min(cur.el.r, cur.vw), b: Math.min(cur.el.b, cur.vh) };
      if (cur.ring.l < -1 || cur.ring.t < -1 || cur.ring.r > cur.vw + 1 || cur.ring.b > cur.vh + 1) problem(`step ${t.step + 1} ring off screen ${JSON.stringify(cur.ring)}`);
      if (overlap(cur.card, vis)) problem(`step ${t.step + 1} card covers its target`);
    } else problem(`step ${t.step + 1} has a target but no spotlight ring`);
    if (cur.card.l < -1 || cur.card.r > cur.vw + 1 || cur.card.t < -1 || cur.card.b > cur.vh + 1) problem(`step ${t.step + 1} card off screen ${JSON.stringify(cur.card)}`);
    if (!cur.hitOk) problem(`step ${t.step + 1} target ${cur.target} not clickable at its centre (hit ${cur.hitWhat})`);
    // The driver put Fleet & orders away after picking the courier: the tour must have brought it back.
    if (opts.selectCourier && t.title === 'Select your ship' && !(await page.$('#game-sidebar.open'))) {
      problem('Select your ship did not open the Fleet & orders panel');
    }

    if (cur.el.disabled) {
      // Only the closure (Sell at Antwerp) and a second run (London already at its fastest) may
      // leave a step's control disabled, and the card must then say why.
      if (!cur.note) { problem(`step ${t.step + 1} "${t.title}" points at disabled ${cur.target} with no explanation`); break; }
      // Niccolò's sim rolls market events with Math.random, so a closure can turn up in any run, not
      // only the forced ones; a closed Buy or Sell with its note is the game working.
      const expected = (/^(Buy some cloth|Sell it at a profit)$/.test(t.title) && /closed/.test(cur.note))
        || (opts.reopened && t.title === 'Invest in a courier line');
      if (!expected) problem(`step ${t.step + 1} "${t.title}" target disabled: ${cur.note.slice(0, 80)}`);
      skipped.add(t.title);
      if (!cur.buttons.includes('Skip this')) { problem(`step ${t.step + 1} "${t.title}" disabled with no way forward`); break; }
      await page.getByRole('button', { name: 'Skip this', exact: true }).click();
      if (!(await waitForMove(page, t.step, 3000))) { problem('Skip this did not move on'); break; }
      before = null;
      continue;
    }

    if (opts.chronicleAt === t.step && !opts._chronDone) {
      opts._chronDone = true;
      await page.getByRole('button', { name: 'Chronicle' }).click();
      await page.waitForFunction(() => !document.querySelector('[data-tour-step]'), null, { timeout: 3000 })
        .catch(() => problem('tour card shown over the Chronicle'));
      await page.keyboard.press('Escape');
      if (await modalInfo(page)) await clickModal(page, 'last');
      await page.waitForSelector('[data-tour-step]', { timeout: 3000 }).catch(() => {});
      const back = await stepNow(page);
      if (back !== t.step) problem(`after the Chronicle the tour is on ${back === null ? 'nothing' : back + 1}, was ${t.step + 1}`);
      if (back === null) break;
    }

    actedStep = t.step;
    if (cur.el.tag === 'SELECT') {
      const val = await page.evaluate(id => {
        const s = document.getElementById(id);
        return [...s.options].map(o => o.value).find((v, i) => i >= 2 && v !== s.value);
      }, cur.target);
      await page.selectOption('#' + cur.target, val).catch(e => problem('selectOption failed: ' + e.message.split('\n')[0]));
    } else {
      await page.click('#' + cur.target, { timeout: 3000 }).catch(e => problem(`real click on ${cur.target} failed: ${e.message.split('\n')[0]}`));
    }
    if (!(await waitForMove(page, t.step, 4000))) { problem(`step ${t.step + 1} "${t.title}" did not complete after clicking ${cur.target}`); break; }
  }
  if (!finished) problem(`run did not finish (last step ${lastStep === null ? '-' : lastStep + 1})`);
  if (opts.expectTourOffer && !offeredTour && !opts.tutorialOnly) problem('How to play never offered the guided tour');
  // A bale lost at sea (the sim rolls it with Math.random) leaves nothing to sell, so Sell is rightly
  // passed over and the closure never shows; that run is checked for the loss instead.
  if (opts.closeAntwerpCloth && !skipped.has('Sell it at a profit') && !lostAtSea) problem('the closure never disabled Sell at Antwerp');
  if (opts.closeBrugesCloth && !skipped.has('Buy some cloth')) problem('the closure never disabled Buy at Bruges');

  if (finished && tourStarted && total) {
    // Every real step shown. Select your ship (index 1) may be passed over by Start only when the
    // ship was already the selection.
    const preselected = !opts.selectCourier && (opts.reopened || info.firstVessel === 'ship_1');
    for (let i = 1; i < total - 1; i++) {
      if (shown.has(i)) continue;
      if (i === 1 && preselected) continue;
      // Reopened with the ship already at Antwerp, the voyage steps are done before they begin and
      // must be passed over, not shown and auto-completed.
      if (opts.reopened && [3, 4, 5].includes(i)) continue;
      // With Buy closed there is nothing aboard to sell, so Sell is done before it begins.
      if (i === 6 && (skipped.has('Buy some cloth') || lostAtSea)) continue;
      problem(`real step ${i + 1} was never shown`);
    }
    if (preselected && shown.has(1) && !opts.reopened) problem('Select your ship shown although the ship was already selected');
    if (opts.reopened) for (const i of [3, 4, 5]) if (shown.has(i)) problem(`reopened at Antwerp, yet voyage step ${i + 1} was shown`);
  }
  return { finished, effects, skipped, lostAtSea };

  async function checkEffect(b, stepIdx) {
    const fn = EFFECTS[b.title];
    if (!fn) { effects.add(b.title); return; }
    let ok = false, after = null;
    for (let i = 0; i < 20 && !ok; i++) {
      after = await readSave(page, info.id);
      ok = !!after && fn(b.save, after);
      if (!ok) await sleep(100);
    }
    if (ok) effects.add(b.title);
    else problem(`step ${stepIdx + 1} "${b.title}" moved on but its effect is not in the save`);
    if (b.title === 'Advance the clock' && after && cloth(b.save) > 0 && cloth(after) === 0) {
      // The bale went down at sea or to a rival's sabotage (both rolled with Math.random). Sell then
      // has nothing to do and is passed over; the loss itself must be on record, not just vanish.
      const loss = [after.lastVoyageEvent, after.lastSabotageEvent].find(e => e && e.vesselId === 'ship_1' && e.goodId === 'cloth' && e.week >= b.save.week);
      if (loss) lostAtSea = true;
      else problem('the cloth vanished on the voyage with no voyage loss or sabotage on record');
    }
  }
}

(async () => {
  const browser = await chromium.launch();
  const t0 = Date.now();
  // TOUR_ONLY=<regex> narrows the matrix to matching labels while debugging.
  const only = process.env.TOUR_ONLY ? new RegExp(process.env.TOUR_ONLY) : null;
  const picked = only ? runs.filter(o => only.test(labelOf(o))) : runs;
  // run() records its own driver errors as problems; this catches anything thrown outside that
  // (opening the context, say), so one broken run never stops the rest of the matrix.
  for (const opts of picked) {
    try { await run(browser, opts); } catch (e) {
      console.log(`${labelOf(opts)} FAIL driver error outside the run: ${e.message.split('\n')[0]}`);
      problems.push(`[${labelOf(opts)}] driver error outside the run: ${e.message.split('\n')[0]}`);
    }
  }
  await browser.close();
  console.log(`${picked.length} runs in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`PROBLEMS (${problems.length})`);
  for (const p of problems) console.log(' - ' + p);
  process.exit(problems.length ? 1 : 0);
})();
