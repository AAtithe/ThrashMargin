/**
 * The Tea Race: plays the guided tour (packages/tea-race/src/components/GuidedTour.tsx) end to end
 * in a real browser, clicking whatever control the card names in `data-tour-target`.
 *
 *   npm run tours -- tea-race            # full matrix: 32 runs
 *   npm run tours -- tea-race --quick    # 4 runs: desktop + phone, hot-seat, one perturbation
 *
 * Covers: eight seeds across the board / merchant / full presets on desktop (1400x900) and phone
 * (390x844); hot-seat games with two humans (the handover card between every human turn, and the
 * second human's turn played by hand); and three perturbations — clearing the drawn course with
 * "Not yet" at a cast-off step, buying and selecting a second ship mid-run, and losing the race
 * by waiting at the quay until rivals have filled the commission.
 *
 * Checks, per run:
 *  - a tour is offered on a fresh game, and it reaches Finish without being skipped by hand;
 *  - no step completes itself: when a new step appears the driver does nothing for HOLD_MS and
 *    asserts the card is still on that step (intro and outro are exempt; they are manual). An
 *    in-page recorder also logs every step index the card shows, so a step that flashes past
 *    between two probes is caught too;
 *  - every real step is shown at least once, and the step index never goes backwards. The one
 *    exception is a step the card lists in data-tour-passed (already done when reached), allowed
 *    only straight after a cast-off (and the save must show she arrived on that turn) or after
 *    the first load;
 *  - a finished step, during its pause before the next, keeps the target it had while live;
 *  - the tour never restarts after a handover, never shows or advances on the other human's turn,
 *    and is never visible over the handover card;
 *  - geometry: the target exists, is on screen, is ringed, is not covered by the card, and is what
 *    a click at its centre actually hits; the card itself stays on screen;
 *  - after "Not yet" the card asks for the course again; after selecting a second ship it asks for
 *    the run's ship back;
 *  - the save in localStorage shows the run really happened: cargo loaded, the tour's commission
 *    landed by this captain with the tour's good, and more shares of her own company than she
 *    began with. The one accepted exception is the "lose" perturbation, where she sits at the
 *    quay until rivals take both berths: the card must stop at "Land the cargo", say so, and
 *    wait for "Carry on";
 *  - no console error or page error (React Router "future flag" warnings excepted).
 *
 * Games are seeded through the real sim (Vite serves source modules) into browser saves. Only the
 * client-side `tm_user` is set; the sign-in gate and the server's auth are untouched.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.TOUR_BASE || 'http://localhost:5302';
const OUT = process.env.TOUR_OUT || path.join(require('os').tmpdir(), 'tours', 'tea-race');
const QUICK = process.env.TOUR_QUICK === '1';
fs.mkdirSync(OUT, { recursive: true });

const HOLD_MS = 1500;          // the self-completion window; the tour's own auto-advance is 650ms
const CONCURRENCY = 4;         // runs in parallel, each in its own browser context
const MAX_ITER = 320;

const VIEWPORTS = { desktop: { width: 1400, height: 900 }, phone: { width: 390, height: 844 } };
const PRESETS = ['board', 'merchant', 'full'];

function matrix() {
  if (QUICK) {
    return [
      { seed: 'alpha', preset: 'board', vp: 'desktop', humans: 1 },
      { seed: 'bravo', preset: 'merchant', vp: 'phone', humans: 1 },
      { seed: 'india', preset: 'board', vp: 'phone', humans: 2 },
      { seed: 'lima', preset: 'board', vp: 'desktop', humans: 1, perturb: 'notyet' },
    ];
  }
  const c = [];
  ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'].forEach((seed, i) => {
    for (const vp of Object.keys(VIEWPORTS)) c.push({ seed, preset: PRESETS[i % PRESETS.length], vp, humans: 1 });
  });
  for (const seed of ['india', 'juliet', 'kilo']) {
    for (const vp of Object.keys(VIEWPORTS)) c.push({ seed, preset: 'board', vp, humans: 2 });
  }
  for (const seed of ['lima', 'mike']) {
    for (const vp of Object.keys(VIEWPORTS)) {
      c.push({ seed, preset: 'board', vp, humans: 1, perturb: 'notyet' });
      c.push({ seed: seed + 's', preset: 'board', vp, humans: 1, perturb: 'ship' });
    }
  }
  // Losing the race: she dawdles at the quay until rivals take both berths, so the run reaches
  // "Land the cargo" with nothing to land on and the card must stop and say so.
  for (const vp of Object.keys(VIEWPORTS)) c.push({ seed: 'golf', preset: 'board', vp, humans: 1, perturb: 'lose' });
  return c;
}

const labelOf = cfg => `${cfg.seed}/${cfg.preset}/${cfg.vp}/h${cfg.humans}${cfg.perturb ? '/' + cfg.perturb : ''}`;

async function newGame(page, cfg) {
  return page.evaluate(async cfg => {
    const { createInitialState } = await import('/src/sim/state.ts');
    const { PRESETS } = await import('/src/sim/rules.ts');
    const id = 'tour-' + cfg.seed + '-' + cfg.humans + '-' + cfg.vp;
    const s = createInitialState(id, 'Tour ' + cfg.seed, {
      seed: cfg.seed,
      humanNames: cfg.humans === 2 ? ['Ann', 'Bea'] : ['You'],
      aiCount: cfg.humans === 2 ? 2 : 3,
      hazards: PRESETS[cfg.preset].hazards,
      createdAt: 1700000000000,
    });
    localStorage.setItem('tearace_save_' + id, JSON.stringify(s));
    localStorage.setItem('tearace_saves', JSON.stringify([{ id, name: s.name, turn: 1, status: 'active', savedAt: 1, rules: s.rules }]));
    localStorage.removeItem('tea_race_tour_seen');
    const me = s.captains.find(c => c.kind === 'human');
    return { id, captainId: me.id, shares: me.shares };
  }, cfg);
}

// Geometry of card, ring and target, and what is actually under the target's centre.
async function probe(page) {
  return page.evaluate(() => {
    const handover = [...document.querySelectorAll('button')].some(b => /take the wheel/.test(b.textContent));
    const over = /carries the company|finishes richest/.test(document.body.textContent);
    const card = document.querySelector('[data-tour-step]');
    if (!card) return { none: true, handover, over };
    const r = el => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
    };
    const target = card.getAttribute('data-tour-target') || null;
    const tEl = target ? document.getElementById(target) : null;
    const ringEl = card.previousElementSibling;
    const ring = ringEl && ringEl.style.border ? r(ringEl) : null;
    let hit = null;
    if (tEl) {
      const b = tEl.getBoundingClientRect();
      const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      hit = h ? (tEl.contains(h) ? 'target' : card.contains(h) ? 'card' : (h.id || h.tagName + '.' + (h.textContent || '').slice(0, 30))) : 'offscreen';
    }
    const m = /(\d+) of (\d+)/.exec(card.querySelector('p')?.textContent || '');
    return {
      step: Number(card.getAttribute('data-tour-step')),
      total: m ? Number(m[2]) : null,
      target, title: card.querySelector('h3')?.textContent,
      body: card.querySelectorAll('p')[1]?.textContent || '',
      done: card.hasAttribute('data-tour-done'),
      passed: (card.getAttribute('data-tour-passed') || '').split(',').filter(Boolean).map(Number),
      buttons: [...card.querySelectorAll('button')].map(b => b.textContent),
      card: r(card), ring, tgt: r(tEl), tgtExists: !!tEl, tgtDisabled: tEl ? !!tEl.disabled : null,
      hit, vw: innerWidth, vh: innerHeight, handover, over,
    };
  });
}

// Everything the driver waits on after acting: a change in what the card shows or in the modal.
const keyOf = p => (p.none ? `none|${p.handover}` : `${p.step}|${p.target}|${p.tgtDisabled}|${p.done}|${p.handover}`);
async function waitForChange(page, key, ms) {
  try {
    await page.waitForFunction(key => {
      const handover = [...document.querySelectorAll('button')].some(b => /take the wheel/.test(b.textContent));
      const card = document.querySelector('[data-tour-step]');
      if (!card) return key !== `none|${handover}`;
      const t = card.getAttribute('data-tour-target') || null;
      const el = t ? document.getElementById(t) : null;
      return key !== `${card.getAttribute('data-tour-step')}|${t}|${el ? !!el.disabled : null}|${card.hasAttribute('data-tour-done')}|${handover}`;
    }, key, { timeout: ms, polling: 50 });
    return true;
  } catch { return false; }
}

// Wait until the ring, the target and the card stop moving: unchanged across 450ms, which is
// longer than the tour's 250ms re-measure plus its 0.2s ease, so a ring still on its way to the
// target cannot read as settled.
async function settle(page) {
  const sample = () => page.evaluate(() => {
    const card = document.querySelector('[data-tour-step]');
    const ring = card && card.previousElementSibling;
    const t = card && card.getAttribute('data-tour-target');
    const el = t && document.getElementById(t);
    const r = e => (e ? [...Object.values(e.getBoundingClientRect().toJSON())].map(Math.round).join(',') : '');
    return r(ring) + '|' + r(el) + '|' + r(card);
  });
  let prev = await sample(), same = 0;
  for (let i = 0; i < 30 && same < 3; i++) {
    await page.waitForTimeout(150);
    const cur = await sample();
    same = cur === prev ? same + 1 : 0;
    prev = cur;
  }
}

const box = b => '[' + [b.left, b.top, b.right, b.bottom].map(Math.round).join(',') + ']';
const overlap = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

async function runOne(browser, cfg) {
  const label = labelOf(cfg);
  const ctx = await browser.newContext({ viewport: VIEWPORTS[cfg.vp], deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    localStorage.setItem('tm_user', JSON.stringify({ userId: 'local-dev', username: 'local-dev' }));
    // Record every step index the card ever shows, with when, so a step that flashes past between
    // two of the driver's probes is still seen.
    window.__tourSteps = [];
    const record = () => {
      const card = document.querySelector('[data-tour-step]');
      const s = card ? Number(card.getAttribute('data-tour-step')) : null;
      const last = window.__tourSteps[window.__tourSteps.length - 1];
      if (s !== null && (!last || last.step !== s)) window.__tourSteps.push({ step: s, at: performance.now() });
    };
    new MutationObserver(record).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tour-step'] });
  });
  const page = await ctx.newPage();
  const problems = [];
  const note = msg => { if (!problems.includes(msg)) problems.push(msg); };
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/React Router Future Flag|future flag/i.test(m.text())) return;
    note('console: ' + m.text().slice(0, 200));
  });
  page.on('pageerror', e => note('pageerror: ' + e.message.slice(0, 200)));

  let finished = false, lostAtSea = false;
  try {
    await page.goto(BASE + '/');
    const game = await newGame(page, cfg);
    await page.goto(BASE + '/game/' + game.id);
    try { await page.waitForSelector('[data-tour-step]', { timeout: 15000 }); }
    catch { note('no tour offered on a fresh game'); throw new Error('abort'); }

    const held = new Set();          // step indices already held for
    let total = null, maxStep = -1, lastKey = '', sameCount = 0, perturbed = false;
    let preModalStep = null, lastSeenStep = null, handovers = 0;
    let contractId = null, good = null, passed = [], acknowledged = null, ackBody = '';
    const checked = new Set();       // step|target pairs whose geometry has been checked
    const liveTarget = {};           // step -> the target it last named while still live
    const titles = {};               // step -> title, for every step shown
    let iter;

    for (iter = 0; iter < MAX_ITER; iter++) {
      const p = await probe(page);
      if (!p.handover && preModalStep !== null) {
        if (!p.none && p.step < preModalStep) note(`restarted after handover: step ${preModalStep} -> ${p.step}`);
        preModalStep = null;
      }
      if (p.handover) {
        if (preModalStep === null) preModalStep = lastSeenStep;
        handovers++;
        if (!p.none) note('tour card visible while the handover card is open');
        const btn = page.locator('button', { hasText: 'take the wheel' });
        const who = (await btn.textContent()) || '';
        await btn.click();
        await waitForChange(page, keyOf(p), 3000);
        if (/Bea/.test(who)) {
          // The other human's turn, played by hand: the tour must stand aside and not advance.
          const q = await probe(page);
          if (!q.none) note(`tour card shown on the other human's turn (step ${q.step})`);
          const roll = page.locator('#roll-button');
          if (await roll.count()) { await roll.click(); await page.waitForSelector('#end-turn-button', { timeout: 3000 }).catch(() => {}); }
          const q2 = await probe(page);
          if (!q2.none) note(`tour card shown on the other human's turn after her roll (step ${q2.step})`);
          for (let k = 0; k < 2; k++) {
            const end = page.locator('#end-turn-button');
            if (await end.count()) { await end.click(); await page.waitForTimeout(150); }
          }
          await waitForChange(page, keyOf(await probe(page)), 5000);
        }
        continue;
      }
      if (p.over) { note('game over during the tour'); break; }
      if (p.none) {
        const seen = await page.evaluate(() => !!localStorage.getItem('tea_race_tour_seen'));
        if (seen) { note('tour closed without Finish being clicked'); break; }
        // A rival is taking a turn (the card stands aside): wait for it to come back.
        if (!(await waitForChange(page, keyOf(p), 20000))) { note('tour card did not come back after a rival turn'); break; }
        continue;
      }

      total = p.total;
      titles[p.step] = p.title;
      lastSeenStep = p.step;
      if (p.step < maxStep) note(`step went backwards ${maxStep} -> ${p.step} (${p.title})`);
      maxStep = Math.max(maxStep, p.step);
      const manual = p.buttons.includes('Start') || p.buttons.includes('Finish');

      // The self-completion check: a new step gets no action at all for HOLD_MS.
      if (!manual && !held.has(p.step)) {
        held.add(p.step);
        await page.waitForTimeout(HOLD_MS);
        const q = await probe(page);
        if (q.none ? !q.handover : q.step !== p.step) {
          note(`step ${p.step} "${p.title}" completed itself: untouched for ${HOLD_MS}ms, card moved to ${q.none ? '(none)' : `${q.step} "${q.title}"`}`);
        }
        continue; // re-probe: geometry is checked on the settled card
      }

      passed = p.passed;
      // A finished step, in its 650ms pause, must go on pointing where it pointed while live: the
      // state that completes a step can re-aim a live target (the roll that brings her in turns
      // the roll button into End the turn), and a player obeying that would waste the turn. The
      // driver, like a careful player, does nothing to a finished step but wait for the next one.
      if (p.done) {
        if (p.step in liveTarget && liveTarget[p.step] !== p.target)
          note(`step ${p.step} "${p.title}": once done, card re-aimed from #${liveTarget[p.step]} to #${p.target}`);
        await waitForChange(page, keyOf(p), 3000);
        continue;
      }
      liveTarget[p.step] = p.target;
      if (p.target && /^contract-card-/.test(p.target)) contractId = p.target.slice('contract-card-'.length);
      if (p.target && /^load-cargo-/.test(p.target)) good = p.target.slice('load-cargo-'.length);

      // A target can vanish legitimately during the tour's 650ms pause after a step completes (the
      // roll button turns into the end-turn button). Missing is a problem only if nothing follows.
      if (p.target && !p.tgtExists) {
        if (await waitForChange(page, keyOf(p), 2000)) continue;
        note(`step ${p.step} "${p.title}": target #${p.target} not in DOM`);
      }
      // Geometry, once per step and target, on a settled ring (it eases for 0.2s and the tour
      // re-measures every 250ms, so a probe taken mid-move is not what the player sees).
      const gkey = `${p.step}|${p.target}`;
      if (p.tgt && !checked.has(gkey)) {
        checked.add(gkey);
        await settle(page);
        const s2 = await probe(page);
        if (keyOf(s2) !== keyOf(p)) continue;
        Object.assign(p, s2);
      } else if (p.tgt) {
        p.tgt = null; // already checked
      }
      if (p.tgt && p.ring) {
        const R = p.ring, T = p.tgt;
        if (R.left < -1 || R.top < -1 || R.right > p.vw + 1 || R.bottom > p.vh + 1) note(`step ${p.step} "${p.title}": ring off screen`);
        // The tour keeps its ring 2px inside the window by design, so a target touching an edge (the
        // phone's turn bar sits on the bottom one) is measured against the same 2px inset.
        const vis = { left: Math.max(T.left, 2), top: Math.max(T.top, 2), right: Math.min(T.right, p.vw - 2), bottom: Math.min(T.bottom, p.vh - 2) };
        if (vis.right > vis.left && vis.bottom > vis.top &&
          !(R.left <= vis.left + 1 && R.top <= vis.top + 1 && R.right >= vis.right - 1 && R.bottom >= vis.bottom - 1))
          note(`step ${p.step} "${p.title}": ring ${box(R)} does not enclose #${p.target} ${box(vis)}`);
      }
      if (p.tgt && !p.ring) note(`step ${p.step} "${p.title}": #${p.target} is not ringed`);
      if (p.tgt && overlap(p.card, p.tgt)) note(`step ${p.step} "${p.title}": card covers #${p.target}`);
      if (p.tgt && p.hit && p.hit !== 'target') note(`step ${p.step} "${p.title}": a click on #${p.target} hits ${p.hit}`);
      if (p.tgt && (p.tgt.bottom < 0 || p.tgt.top > p.vh)) note(`step ${p.step} "${p.title}": #${p.target} off screen`);
      if (p.card && (p.card.bottom > p.vh + 1 || p.card.right > p.vw + 1 || p.card.top < -1 || p.card.left < -1))
        note(`step ${p.step} "${p.title}": card off screen`);

      const key = keyOf(p);
      sameCount = key === lastKey ? sameCount + 1 : 0;
      lastKey = key;

      // Perturbations.
      if (cfg.perturb === 'notyet' && !perturbed && p.target === 'cast-off-button') {
        perturbed = true;
        await page.locator('button', { hasText: 'Not yet' }).click();
        await waitForChange(page, key, 3000);
        const q = await probe(page);
        if (q.none || !q.target || !q.tgtExists || !/^ledger-port-/.test(q.target))
          note(`after "Not yet": card points at ${q.target} (exists=${q.tgtExists}), no way forward`);
        continue;
      }
      if (cfg.perturb === 'ship' && !perturbed && /Lay off a course for the (cargo|buyer)/.test(p.title)) {
        perturbed = true;
        const before = await page.evaluate(() => [...document.querySelectorAll('[id^=ship-button-]')].map(e => e.id));
        const buy = page.locator('button', { hasText: /Buy a clipper|Buy .* — £/ }).first();
        // The counting house is in Fleet and orders. Where only one panel fits (a phone), the
        // step's own target keeps the exchange open, so open the other panel the way a player
        // would, from its launcher at the edge of the chart.
        if ((await buy.count()) && !(await buy.isVisible())) {
          const launcher = page.locator('button.tr-launcher', { hasText: 'Your fleet and orders' });
          if (await launcher.count()) await launcher.click();
          await buy.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
        }
        if ((await buy.count()) && !(await buy.isDisabled())) {
          await buy.click();
          await page.waitForFunction(n => document.querySelectorAll('[id^=ship-button-]').length > n, before.length, { timeout: 3000 }).catch(() => {});
          const after = await page.evaluate(() => [...document.querySelectorAll('[id^=ship-button-]')].map(e => e.id));
          const fresh = after.find(id => !before.includes(id));
          if (fresh) {
            await page.locator('#' + fresh).click();
            await waitForChange(page, key, 3000);
            const q = await probe(page);
            if (q.target !== before[0]) note(`after selecting a second ship: card points at ${q.target}, expected ${before[0]}`);
          } else note('second ship bought but no new ship button appeared');
        } else note('perturbation not exercised: could not afford a second ship');
        continue;
      }

      if (cfg.perturb === 'lose' && !perturbed && /Lay off a course for the buyer/.test(p.title) && contractId) {
        perturbed = true;
        const closed = () => page.evaluate(([id, cid]) => {
          const s = JSON.parse(localStorage.getItem('tearace_save_' + id) || 'null');
          const c = s && s.contracts.find(x => x.id === cid);
          return !c || c.fills.length >= 2;
        }, [game.id, contractId]);
        let turns = 0;
        for (; turns < 25 && !(await closed()); turns++) {
          await page.waitForSelector('#roll-button, #end-turn-button', { timeout: 20000 });
          if (await page.locator('#roll-button').count()) {
            await page.locator('#roll-button').click();
            await page.waitForSelector('#end-turn-button', { timeout: 3000 });
          }
          const q = await probe(page);
          if (!q.none && q.step !== p.step) note(`step ${p.step} "${p.title}" moved to ${q.step} while she sat at the quay`);
          await page.locator('#end-turn-button').click();
          const again = page.locator('#end-turn-button', { hasText: 'End it anyway' });
          if (await again.waitFor({ timeout: 300 }).then(() => true, () => false)) await again.click();
          await page.waitForSelector('#roll-button', { timeout: 20000 }); // her next turn
        }
        if (!(await closed())) note(`perturbation not exercised: commission ${contractId} still open after ${turns} turns at the quay`);
        continue;
      }
      if (p.buttons.includes('Start')) {
        await page.locator('[data-tour-step] button', { hasText: 'Start' }).click();
        await waitForChange(page, key, 3000);
        continue;
      }
      // A step the game has taken out of the player's hands (the commission lost at sea) waits to
      // be read and acknowledged with the card's own button.
      if (p.buttons.includes('Carry on')) {
        acknowledged = p.title;
        ackBody = p.body;
        await page.locator('[data-tour-step] button', { hasText: 'Carry on' }).click();
        await waitForChange(page, key, 3000);
        continue;
      }
      if (p.buttons.includes('Finish')) {
        await page.locator('[data-tour-step] button', { hasText: 'Finish' }).click();
        finished = true;
        break;
      }

      if (sameCount > 6) {
        note(`stuck at step ${p.step} "${p.title}" (target ${p.target}, disabled=${p.tgtDisabled}); skipped by hand`);
        await page.locator('[data-tour-step] button', { hasText: 'Skip this' }).click();
        await waitForChange(page, key, 3000);
        sameCount = 0;
        continue;
      }

      if (p.target && p.tgtExists && !p.tgtDisabled) {
        try {
          await page.locator('#' + p.target).click({ timeout: 2500 });
        } catch (e) {
          note(`step ${p.step} "${p.title}": could not click #${p.target} (${e.message.split('\n')[0]})`);
          await page.evaluate(t => document.getElementById(t)?.click(), p.target);
        }
        if (p.target === 'end-turn-button') {
          const again = page.locator('#end-turn-button', { hasText: 'End it anyway' });
          if (await again.waitFor({ timeout: 300 }).then(() => true, () => false)) await again.click();
        }
      }
      // Wait for the game to answer: a new step, a new target, a modal, or the card standing aside.
      await waitForChange(page, key, 3000);
    }
    if (iter >= MAX_ITER) note('iteration cap hit');
    if (cfg.humans === 2 && handovers === 0) note('hot-seat game but no handover card was seen');

    // Every real step (not the intro at 0 or the outro at total-1) was on screen at least once.
    const shown = await page.evaluate(() => window.__tourSteps);
    if (total) {
      const indices = new Set(shown.map(s => s.step));
      const missing = [];
      // Waiting steps already satisfied when reached are passed over by design (the card lists them
      // in data-tour-passed); anything else missing was skipped.
      for (let i = 1; i < total - 1; i++) if (!indices.has(i) && !passed.includes(i)) missing.push(i);
      if (missing.length) note(`steps never shown: ${missing.join(', ')} of ${total}`);
      // A step may be passed over only straight after the step that can satisfy it on the spot:
      // a sail step after its cast-off (the leg was short enough to finish on the click), the
      // fill step after the first load (that lot filled the hold or spent the cash).
      for (const i of passed) {
        const before = titles[i - 1];
        if (!/^Cast off|^Load her hold$/.test(before || '')) note(`step ${i} passed over after "${before}", which cannot satisfy it`);
      }
    }

    // The save shows the run's real effects.
    if (finished) {
      const s = await page.evaluate(id => JSON.parse(localStorage.getItem('tearace_save_' + id) || 'null'), game.id);
      const me = s && s.captains.find(c => c.id === game.captainId);
      if (!me) note('save missing or captain not found');
      else {
        const mine = s.log.filter(e => e.captainId === me.id);
        const landed = contractId && mine.find(e => e.kind === 'deliver' && e.data && String(e.data.contractId) === contractId);
        if (!mine.some(e => e.kind === 'buy')) note('save: this captain never loaded any cargo');
        if (!contractId || !good) note(`never saw the commission card (${contractId}) or the load button (${good})`);
        else if (!landed) {
          // Legitimate only if rivals took both berths (or the card was withdrawn) and the tour said
          // so and waited for the player to acknowledge it.
          const others = s.log.filter(e => e.kind === 'deliver' && e.data && String(e.data.contractId) === contractId && e.captainId !== me.id);
          const live = s.contracts.find(c => c.id === contractId);
          const lost = others.length >= 2 || !live;
          if (!lost) note(`save: commission ${contractId} was not landed by this captain, and it was still open to her`);
          else if (cfg.perturb !== 'lose') note(`save: commission ${contractId} lost to rivals without the "lose" perturbation (unexpected in this seed)`);
          else if (acknowledged !== 'Land the cargo') note(`save: commission ${contractId} was lost at sea but the tour never stopped to say so`);
          else if (others.length >= 2 && !/Both berths/.test(ackBody)) note(`rivals filled ${contractId} but the card said: "${ackBody.slice(0, 80)}"`);
          else lostAtSea = true;
        }
        else if (landed.data.good !== good || !(Number(landed.data.units) >= 1)) note(`save: landing on ${contractId} carried ${landed.data.units} x ${landed.data.good}, expected ${good}`);
        // A sail step passed over must mean she really arrived on the cast-off itself, which the
        // sim logs as "<ship> runs to <port> and ties up." (a ship at sea logs "ties up at").
        const sailPassed = passed.filter(i => /^Cast off/.test(titles[i - 1] || '')).length;
        const onClick = mine.filter(e => e.kind === 'arrive' && /runs to .* and ties up/.test(e.text)).length;
        if (sailPassed > onClick) note(`save: ${sailPassed} sail step(s) passed over but she arrived on the cast-off ${onClick} time(s)`);
        if (!(me.shares > game.shares)) note(`save: shares ${game.shares} -> ${me.shares}, none bought`);
      }
    }
  } catch (e) {
    if (e.message !== 'abort') note('harness error: ' + e.message.split('\n')[0]);
  }

  if (!finished && !problems.length) note('tour did not finish');
  if (problems.length) {
    await page.screenshot({ path: path.join(OUT, label.replace(/\//g, '_') + '.png') }).catch(() => {});
  }
  await ctx.close();
  return { label, problems, lostAtSea };
}

(async () => {
  // TOUR_ONLY=<regex> runs only the matching labels (for chasing one failure).
  const only = process.env.TOUR_ONLY ? new RegExp(process.env.TOUR_ONLY) : null;
  const configs = matrix().filter(c => !only || only.test(labelOf(c)));
  const started = Date.now();
  const browser = await chromium.launch();
  const results = [];
  let next = 0;
  async function worker() {
    while (next < configs.length) {
      const cfg = configs[next++];
      const t0 = Date.now();
      // runOne records its own errors; this catches anything outside its try (a context that
      // would not open or close), so one bad run is a problem, not the end of the matrix.
      const r = await runOne(browser, cfg).catch(e => ({ label: labelOf(cfg), problems: ['harness error: ' + String(e && e.message || e).split('\n')[0]], lostAtSea: false }));
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      const extra = r.lostAtSea ? ' [commission lost to rivals; card waited for Carry on]' : '';
      console.log(r.problems.length ? `${r.label} FAIL (${secs}s) ${r.problems.join(' | ')}` : `${r.label} ok (${secs}s)${extra}`);
      results.push(r);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, configs.length) }, worker));
  await browser.close();
  const all = results.flatMap(r => r.problems.map(p => `${r.label}: ${p}`));
  console.log(`\n${results.length} runs in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  console.log(`PROBLEMS (${all.length})`);
  all.forEach(p => console.log('  ' + p));
  process.exit(all.length ? 1 : 0);
})();
