/**
 * Steady Eddie: plays the guided run end to end in a real browser.
 *
 *   npm run tours -- steady-eddie            # full matrix (17 runs)
 *   npm run tours -- steady-eddie --quick    # 3 runs: desktop solo, phone hotseat, perturbations
 *
 * Covers: every rules preset, 1–4 rivals, desktop (1400x900) and phone (390x844), light and dark,
 * hotseat games of two and three humans (handover cards between seats), the run asked for from the
 * header part-way through a game, and two perturbations: "Not yet" at Set off (clears the course)
 * and buying and selecting a second vehicle mid-run.
 *
 * Games are seeded through the real sim (Vite serves `/src/sim/*.ts`) into a browser save, and the
 * client-side `tm_user` is set the way CLAUDE.md describes for local UI checks. The sign-in gate and
 * the server's auth are untouched; this never talks to the API.
 *
 * Checks, per run:
 * - The run opens, and reaches the closing card. The driver acts only on the control the card names
 *   (`data-tour-target`), so a step pointing at a missing, disabled or covered control is a failure.
 * - **No step completes itself.** When a real step first appears the driver does nothing for 1.5 s
 *   and asserts it is still showing; only then does it act. (Thrash Margin once had a step that was
 *   already "done" when reached and flashed past in 650 ms; fast clicking hid it.) The welcome and
 *   closing cards are manual and exempt. A step the run passes over on purpose because it is
 *   already satisfied must say so in `data-tour-skipped`, and the driver checks the reason against
 *   the save.
 * - Every real step was shown at least once (or skipped with a verified reason), and the run never
 *   goes backwards.
 * - Geometry once settled: the ring is on the target and on screen, the target is on screen, and the
 *   card neither covers the target nor leaves the screen.
 * - Hotseat: the card is never shown over a handover card or on another seat's turn.
 * - At the end, from the save in localStorage: the commission was really landed by the run's
 *   haulier, with the run's good, after cargo was really bought; a share was really bought; and
 *   finishing marks the run as seen.
 * - No console errors or page errors (React Router "future flag" warnings aside).
 *
 * Output: one line per run, then PROBLEMS (n). Screenshots only on failure, into $TOUR_OUT.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.TOUR_BASE || 'http://localhost:5303';
const OUT = process.env.TOUR_OUT || path.join(require('os').tmpdir(), 'tours', 'steady-eddie');
const QUICK = process.env.TOUR_QUICK === '1';
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = { desktop: { width: 1400, height: 900 }, phone: { width: 390, height: 844 } };
const PRESETS = ['core', 'haulier', 'openRoad', 'full'];
/** How long a freshly shown step is left alone. The run's own advance pause is 650 ms. */
const HANDS_OFF_MS = 1500;

function fullMatrix() {
  const out = [];
  ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'].forEach((seed, i) => {
    out.push({ seed, preset: PRESETS[i % PRESETS.length], humans: 1, ai: 2 + (i % 3), vp: i % 2 ? 'phone' : 'desktop' });
  });
  out.push({ seed: 'hot1', preset: 'core', humans: 2, ai: 1, vp: 'desktop' });
  out.push({ seed: 'hot2', preset: 'full', humans: 2, ai: 0, vp: 'phone' });
  out.push({ seed: 'india', preset: 'full', humans: 1, ai: 3, vp: 'desktop' });
  out.push({ seed: 'juliet', preset: 'haulier', humans: 1, ai: 1, vp: 'phone' });
  out.push({ seed: 'kilo', preset: 'core', humans: 1, ai: 2, vp: 'desktop', perturb: true });
  out.push({ seed: 'lima', preset: 'full', humans: 1, ai: 3, vp: 'phone', perturb: true, dark: true });
  out.push({ seed: 'hot3', preset: 'haulier', humans: 3, ai: 0, vp: 'desktop', perturb: true });
  out.push({ seed: 'mike', preset: 'openRoad', humans: 1, ai: 2, vp: 'desktop', midgame: 3 });
  out.push({ seed: 'november', preset: 'core', humans: 1, ai: 3, vp: 'phone', midgame: 2, dark: true });
  return out;
}

function quickMatrix() {
  const all = fullMatrix();
  // charlie: desktop, rivals take both berths (the "Carry on" card); hot2: phone hotseat;
  // kilo: both perturbations, and a leg covered on the day she sets off (a skipped step).
  return ['charlie', 'hot2', 'kilo'].map(seed => all.find(c => c.seed === seed));
}

const labelOf = c =>
  `${c.seed}-${c.preset}-${c.humans}h${c.ai}a-${c.vp}${c.dark ? '-dark' : ''}${c.perturb ? '-perturb' : ''}${c.midgame ? `-midgame${c.midgame}` : ''}`;

/** In-page helpers, installed before the app loads on every navigation. */
function installHelpers(saveId) {
  const save = () => {
    try { return JSON.parse(localStorage.getItem('steadyeddie_save_' + saveId) || 'null'); } catch { return null; }
  };
  const box = r => (r ? { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) } : null);
  const snap = () => {
    const card = document.querySelector('[data-tour-step]');
    if (!card) return null;
    const ring = card.previousElementSibling;
    const ringBox = ring && ring.style && ring.style.border ? ring.getBoundingClientRect() : null;
    const target = card.getAttribute('data-tour-target') || null;
    const el = target ? document.getElementById(target) : null;
    const of = /of (\d+)/.exec(card.querySelector('p')?.textContent || '');
    return {
      step: Number(card.getAttribute('data-tour-step')),
      total: of ? Number(of[1]) : null,
      skipped: (card.getAttribute('data-tour-skipped') || '').split(',').filter(Boolean).map(Number),
      manual: card.getAttribute('data-tour-manual') === '1',
      target,
      title: card.querySelector('h3')?.textContent || '',
      body: card.querySelector('p:nth-of-type(2)')?.textContent || '',
      targetExists: !!el,
      targetDisabled: el ? !!el.disabled : null,
      targetText: el ? (el.textContent || '').trim().slice(0, 60) : null,
      ring: box(ringBox),
      tBox: box(el && el.getBoundingClientRect()),
      card: box(card.getBoundingClientRect()),
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  };
  const overlap = (a, b) =>
    a && b ? Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t)) : 0;
  const geom = () => {
    const s = snap();
    const out = [];
    if (!s || !s.target || !s.targetExists || !s.tBox) return out;
    if (!s.ring) return [`step ${s.step} (${s.target}): no ring drawn`];
    const tArea = Math.max(1, (s.tBox.r - s.tBox.l) * (s.tBox.b - s.tBox.t));
    const vis = { l: Math.max(0, s.tBox.l), t: Math.max(0, s.tBox.t), r: Math.min(s.vw, s.tBox.r), b: Math.min(s.vh, s.tBox.b) };
    const visArea = Math.max(0, vis.r - vis.l) * Math.max(0, vis.b - vis.t);
    if (overlap(s.ring, vis) < 0.5 * Math.max(1, visArea)) out.push(`step ${s.step} (${s.target}) ring off target ${JSON.stringify(s.ring)} vs ${JSON.stringify(s.tBox)}`);
    if (s.ring.l < -2 || s.ring.t < -2 || s.ring.r > s.vw + 2 || s.ring.b > s.vh + 2) out.push(`step ${s.step} (${s.target}) ring off screen ${JSON.stringify(s.ring)}`);
    if (overlap(s.card, vis) > 0.15 * tArea) out.push(`step ${s.step} (${s.target}) card covers target card=${JSON.stringify(s.card)} target=${JSON.stringify(s.tBox)}`);
    if (visArea / tArea < 0.9) out.push(`step ${s.step} (${s.target}) target only ${Math.round((100 * visArea) / tArea)}% on screen ${JSON.stringify(s.tBox)}`);
    if (s.card.l < -1 || s.card.r > s.vw + 1 || s.card.b > s.vh + 1 || s.card.t < -1) out.push(`step ${s.step} card off screen ${JSON.stringify(s.card)}`);
    return out;
  };
  const handover = () => !!document.querySelector('div[style*="z-index: 40"] button');
  /** Anything that moves when the player does something: the card, the control it names, the game. */
  const sig = () => {
    const s = snap();
    const g = save();
    return JSON.stringify([s && s.step, s && s.target, s && s.targetText, handover(), g && g.nextLogSeq, g && g.phase, g && g.activeIndex]);
  };
  window.__se = { save, snap, geom, handover, sig };
}

async function seed(page, cfg, saveId) {
  await page.goto(BASE + '/');
  await page.evaluate(async ({ cfg, saveId }) => {
    localStorage.clear();
    localStorage.setItem('tm_user', JSON.stringify({ userId: 'local-dev', username: 'local-dev' }));
    const { createInitialState } = await import('/src/sim/state.ts');
    const { PRESETS } = await import('/src/sim/rules.ts');
    const humanNames = Array.from({ length: cfg.humans }, (_, i) => `Human ${i + 1}`);
    const s = createInitialState(saveId, 'Tour ' + cfg.seed, {
      humanNames, aiCount: cfg.ai, seed: cfg.seed, hazards: PRESETS[cfg.preset].hazards, createdAt: 1700000000000,
    });
    localStorage.setItem('steadyeddie_save_' + saveId, JSON.stringify(s));
    localStorage.setItem('steadyeddie_saves', JSON.stringify([{ id: saveId, name: s.name, turn: 1, status: 'active', savedAt: 0 }]));
    if (cfg.midgame) localStorage.setItem('steady_eddie_tour_seen', '1');
    if (cfg.dark) localStorage.setItem('tm_theme', 'dark');
  }, { cfg, saveId });
  await page.goto(BASE + '/game/' + saveId);
  await page.waitForSelector('#roll-button');
}

const waitSigChange = (page, prev, timeout) =>
  page.waitForFunction(p => window.__se.sig() !== p, prev, { timeout, polling: 50 }).then(() => true, () => false);

/**
 * The rivals' turns replay on the board after End turn (lib/motion.ts; on unless the pace is off).
 * While the replay bar is up the run is hidden on purpose and the handover card waits, so a driver
 * that read the screen then would see the run "disappear". Watch it to the end, as a player would,
 * and check the run is never drawn over it. Returns a problem string, or null.
 */
async function settleReplay(page) {
  // One snapshot per look: two separate queries would race the replay's end and report an overlap
  // that never reached the screen.
  const look = () => page.evaluate(() => ({
    replay: !!document.querySelector('[data-replay-bar]'),
    card: !!document.querySelector('[data-tour-step]'),
  }));
  if (!(await look()).replay) return null;
  for (let i = 0; i < 120; i++) {
    const l = await look();
    if (!l.replay) return null;
    if (l.card) return 'tour card shown over the rivals\' replay';
    await page.waitForTimeout(50);
  }
  return 'rivals\' replay still on screen after 6s';
}

/** Play whole days with the run declined, then ask for it from the header. */
async function playIntoGame(page, days) {
  if (await page.locator('[data-tour-step]').count()) throw new Error('run opened although already seen');
  for (let d = 0; d < days; d++) {
    const turn = await page.evaluate(() => window.__se.save().turn);
    await page.click('#roll-button');
    await page.waitForSelector('#end-turn-button');
    await page.click('#end-turn-button');
    // A parked vehicle with miles asks for one confirming click.
    await page.waitForFunction(t => window.__se.save().turn !== t || /anyway/.test(document.getElementById('end-turn-button')?.textContent || ''), turn);
    if (await page.evaluate(t => window.__se.save().turn === t, turn)) await page.click('#end-turn-button');
    await page.waitForFunction(t => window.__se.save().turn !== t && !!document.getElementById('roll-button'), turn);
  }
  if (await page.locator('[data-tour-step]').count()) throw new Error('run opened by itself mid-game');
  await page.getByRole('button', { name: 'Guided run' }).click();
  await page.waitForSelector('[data-tour-step]');
}

async function run(browser, cfg) {
  const label = labelOf(cfg);
  const saveId = 'tour-' + cfg.seed;
  const ctx = await browser.newContext({ viewport: VIEWPORTS[cfg.vp], deviceScaleFactor: 1 });
  await ctx.addInitScript(installHelpers, saveId);
  const page = await ctx.newPage();
  const problems = [];
  let shots = 0;
  const fail = async msg => {
    problems.push(msg);
    if (shots < 3) {
      shots++;
      await page.screenshot({ path: path.join(OUT, `${label}-${shots}.png`) }).catch(() => {});
    }
  };
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/React Router Future Flag/i.test(t)) return;
    problems.push('console: ' + t.slice(0, 200));
  });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message.slice(0, 200)));

  const started = Date.now();
  let finished = false;
  let note = '';
  try {
    await seed(page, cfg, saveId);
    if (cfg.midgame) await playIntoGame(page, cfg.midgame);

    // The run's haulier and vehicle, read from the save as the run opens.
    const start = await page.evaluate(() => {
      const g = window.__se.save();
      const h = g.hauliers.find(x => x.name === 'Human 1');
      const vs = g.vehicles.filter(v => v.ownerId === h.id);
      return { haulierId: h.id, vehicleId: vs[0].id, vehicleCount: vs.length, shares: h.shares, logSeq: g.nextLogSeq };
    });
    if (start.vehicleCount !== 1) await fail(`expected one vehicle at the start, found ${start.vehicleCount}`);
    const plan = { vehicleId: start.vehicleId };

    let lastStep = -1;
    let total = null;
    const shown = new Set();
    const skipped = new Map(); // step -> what the save said when it was passed over
    const perturbed = { notYet: false, bought: false };
    /** Set when the run showed "beaten to both berths" and waited for Carry on. */
    let lostRace = null;
    /** The driver scrolled away to buy a vehicle; the run deliberately does not chase the page
     *  back, so the ring is not judged again until the step or its target changes. */
    let scrolledAway = '';
    let lastKey = '';
    let same = 0;
    let turnClicks = 0;
    let otherTurns = 0;

    for (let iter = 0; iter < 800; iter++) {
      const replayProblem = await settleReplay(page);
      if (replayProblem) { await fail(replayProblem); break; }
      if (await page.evaluate(() => window.__se.handover())) {
        if (await page.evaluate(() => !!window.__se.snap())) await fail('tour card shown over the handover card');
        const before = await page.evaluate(() => window.__se.sig());
        await page.locator('div[style*="z-index: 40"] button').first().click();
        if (!(await waitSigChange(page, before, 5000))) { await fail('handover card did not clear'); break; }
        continue;
      }

      const s = await page.evaluate(() => window.__se.snap());
      if (!s) {
        const g = await page.evaluate(() => window.__se.save());
        const active = g.hauliers[g.activeIndex];
        if (g.phase === 'over') { await fail(`game ended before the run did (last step ${lastStep})`); break; }
        if (cfg.humans > 1 && shown.size && active.id !== start.haulierId) {
          // Another seat's turn: the run stands aside. Play it plainly.
          if (++otherTurns > 200) { await fail('too many other-seat turns'); break; }
          const before = await page.evaluate(() => window.__se.sig());
          const btn = (await page.locator('#roll-button').count()) ? '#roll-button' : '#end-turn-button';
          await page.click(btn);
          if (btn === '#end-turn-button') {
            // A parked vehicle with miles left asks for one confirming click.
            await page.waitForFunction(
              p => window.__se.sig() !== p || /anyway/.test(document.getElementById('end-turn-button')?.textContent || ''),
              before, { timeout: 5000 },
            ).catch(() => {});
            if (await page.evaluate(p => window.__se.sig() === p, before)) await page.click(btn);
          }
          if (!(await waitSigChange(page, before, 5000))) { await fail(`other seat: ${btn} had no effect`); break; }
          continue;
        }
        await fail(shown.size ? `tour disappeared after step ${lastStep} (active: ${active.name})` : 'tour never opened');
        break;
      }
      total = s.total;
      const manual = s.step === 0 || s.step === total - 1;

      if (s.step < lastStep) await fail(`tour went back ${lastStep} -> ${s.step} (${s.title})`);
      if (s.step !== lastStep) {
        // Passed over without being shown: allowed only when the run says so, and checked below.
        for (let k = lastStep + 1; k < s.step; k++) {
          if (!s.skipped.includes(k)) await fail(`step ${k} was never shown (jumped ${lastStep} -> ${s.step})`);
          else if (!skipped.has(k)) {
            skipped.set(k, await page.evaluate(async vid => {
              const { slotsOf } = await import('/src/sim/rules.ts');
              const g = window.__se.save();
              const v = g.vehicles.find(x => x.id === vid);
              return { ...g, slots: v ? slotsOf(v.vehicleClass) : 0 };
            }, plan.vehicleId));
          }
        }
        shown.add(s.step);
        if (!manual) {
          // The check this driver exists for: leave the new step alone and see whether it moves.
          await page.waitForTimeout(HANDS_OFF_MS);
          const after = await page.evaluate(() => window.__se.snap());
          if (!after || after.step !== s.step) {
            await fail(`step ${s.step} "${s.title}" completed itself with no action (now ${after ? `step ${after.step} "${after.title}"` : 'gone'})`);
            lastStep = s.step;
            continue;
          }
        }
        lastStep = s.step;
      }
      if (cfg.humans > 1 && /taking their turns/.test(s.body)) await fail(`card visible on another seat's turn at step ${s.step}`);

      // What the run is teaching, harvested from the controls it names.
      let m;
      if ((m = /^contract-card-(.+)$/.exec(s.target || ''))) plan.contractId = m[1];
      if ((m = /^load-cargo-(.+)$/.exec(s.target || ''))) plan.good = m[1];
      if ((m = /^land-contract-(.+)$/.exec(s.target || ''))) plan.contractId = plan.contractId || m[1];
      if ((m = /^ledger-depot-(.+)$/.exec(s.target || ''))) {
        if (s.step <= 5) plan.loadDepot = m[1];
        else plan.destination = m[1];
      }

      // Perturbations, each once, and only after the hands-off check.
      if (cfg.perturb && !perturbed.notYet && s.title === 'Set off' && s.target === 'set-off-button') {
        perturbed.notYet = true;
        await page.getByRole('button', { name: 'Not yet' }).click();
        await page.waitForFunction(() => window.__se.snap()?.target !== 'set-off-button', null, { timeout: 3000 }).catch(() => {});
        const n = await page.evaluate(() => window.__se.snap());
        if (!n || !n.targetExists) await fail(`after "Not yet" the Set off step points at a missing control: ${n && n.target}`);
        continue;
      }
      if (cfg.perturb && !perturbed.bought && /^Run her/.test(s.title) && s.target === 'end-turn-button') {
        perturbed.bought = true;
        const buy = page.locator('button', { hasText: /^(Buy a vehicle|[\w.\- ]*(Tonner|Van|Rigid|Artic)[\w ]*) — £/ }).first();
        if ((await buy.count()) && (await buy.isEnabled())) {
          const n0 = await page.locator('[id^="vehicle-button-"]').count();
          await buy.click();
          await page.waitForFunction(n => document.querySelectorAll('[id^="vehicle-button-"]').length > n, n0, { timeout: 3000 }).catch(() => {});
          const ids = await page.evaluate(() => Array.from(document.querySelectorAll('[id^="vehicle-button-"]')).map(e => e.id));
          const other = ids.find(id => id !== `vehicle-button-${plan.vehicleId}`);
          if (other) {
            await page.click('#' + other);
            scrolledAway = `${s.step}|${s.target}`;
          } else await fail('bought a second vehicle but it did not appear in the fleet');
        } else perturbed.bought = 'unaffordable';
        continue;
      }

      const key = `${s.step}|${s.target}|${s.targetText}|${turnClicks}`;
      same = key === lastKey ? same + 1 : 0;
      lastKey = key;
      if (same > 6) { await fail(`stuck at step ${s.step} "${s.title}" target=${s.target} exists=${s.targetExists} disabled=${s.targetDisabled} body="${s.body.slice(0, 120)}"`); break; }

      if (s.target && s.targetExists && scrolledAway !== `${s.step}|${s.target}`) {
        scrolledAway = '';
        const settled = await page
          .waitForFunction(() => window.__se.geom().length === 0, null, { timeout: 1500, polling: 100 })
          .then(() => true, () => false);
        if (!settled) for (const g of await page.evaluate(() => window.__se.geom())) await fail(g);
      }

      if (s.step === total - 1) {
        // The closing card: check the run did what it said, then finish.
        const g = await page.evaluate(() => window.__se.save());
        const h = g.hauliers.find(x => x.id === start.haulierId);
        const mine = g.log.filter(e => e.seq >= start.logSeq && e.haulierId === start.haulierId);
        const buys = mine.filter(e => e.kind === 'buy');
        const landed = mine.find(e => e.kind === 'deliver' && e.data && e.data.contractId === plan.contractId);
        if (!plan.contractId || !plan.good || !plan.loadDepot || !plan.destination) await fail(`could not read the plan from the card targets: ${JSON.stringify(plan)}`);
        if (!buys.length) await fail('no cargo was bought during the run');
        if (lostRace) {
          // Rivals took both berths first. The run said so and waited; check the save agrees.
          const c = g.contracts.find(x => x.id === plan.contractId);
          if (landed) await fail('the run said the race was lost, but she landed the commission');
          if (c && c.fills.length < 2) await fail(`the run said the race was lost, but ${plan.contractId} still has a berth`);
          if (!(lostRace.lots > 0)) await fail('the run said the race was lost while she held none of its cargo');
        } else if (!landed) await fail(`commission ${plan.contractId} was not landed by the run's haulier`);
        else if (landed.data.good !== plan.good) await fail(`landed ${landed.data.good}, but the run loaded ${plan.good}`);
        if (!(h.shares > start.shares)) await fail(`no share bought: ${start.shares} -> ${h.shares}`);
        for (let k = 1; k < total - 1; k++) if (!shown.has(k) && !skipped.has(k)) await fail(`step ${k} was never shown`);
        for (const [k, at] of skipped) {
          const reason = skipReason(k, at, plan, start);
          if (!reason) await fail(`step ${k} was skipped and the save does not show it was already done`);
        }
        if (cfg.perturb && !(perturbed.notYet && perturbed.bought)) await fail(`perturbation not exercised: ${JSON.stringify(perturbed)}`);
        await page.locator('[data-tour-step] button', { hasText: 'Finish' }).click();
        await page.waitForSelector('[data-tour-step]', { state: 'detached', timeout: 3000 }).catch(() => {});
        if (await page.locator('[data-tour-step]').count()) await fail('Finish did not close the run');
        if (!(await page.evaluate(() => localStorage.getItem('steady_eddie_tour_seen')))) await fail('finishing did not mark the run as seen');
        finished = true;
        if (lostRace) note += ' [beaten to both berths: Carry on shown]';
        if (skipped.size) note += ` [skipped as already done: ${[...skipped.keys()].map(k => `${k} (${skipReason(k, skipped.get(k), plan, start)})`).join(', ')}]`;
        break;
      }
      if (s.manual && s.step !== 0) {
        // A mid-run card with nothing to do but read. In this run that is only "beaten to it".
        lostRace = await page.evaluate(({ vid, good }) => {
          const v = window.__se.save().vehicles.find(x => x.id === vid);
          return { lots: v ? v.hold.filter(l => l.good === good).length : 0 };
        }, { vid: plan.vehicleId, good: plan.good });
        if (!/Land the load/.test(s.title)) await fail(`unexpected manual card at step ${s.step} "${s.title}"`);
        await page.locator('[data-tour-step] button', { hasText: 'Carry on' }).click();
        await page.waitForFunction(st => window.__se.snap()?.step !== st, s.step, { timeout: 3000 }).catch(() => {});
        continue;
      }
      if (s.step === 0) {
        await page.locator('[data-tour-step] button', { hasText: 'Start' }).click();
        await page.waitForFunction(() => window.__se.snap()?.step !== 0, null, { timeout: 3000 }).catch(() => {});
        continue;
      }

      if (!s.target || !s.targetExists || s.targetDisabled) {
        // Nothing to press. Give the game a moment to move on its own; if it does not, the stuck
        // counter above reports it.
        await waitSigChange(page, await page.evaluate(() => window.__se.sig()), 1000);
        continue;
      }

      const turnBar = s.target === 'roll-button' || s.target === 'end-turn-button';
      const before = await page.evaluate(() => window.__se.sig());
      try {
        await page.locator('#' + s.target).click({ timeout: 3000 });
      } catch (e) {
        await fail(`step ${s.step}: click on ${s.target} failed: ${e.message.split('\n')[0]}`);
        continue;
      }
      if (turnBar) {
        if (++turnClicks > 150) { await fail('over 150 roll/end-turn clicks without finishing'); break; }
        if (!(await waitSigChange(page, before, 5000))) await fail(`step ${s.step}: ${s.target} had no effect`);
        // If that roll brought her in, the step is done: let it advance (650 ms) rather than end the
        // turn on top of it. Read from the save, so this is not a guess about timing.
        const arrived = await page.evaluate(
          ({ vid, depot }) => window.__se.save().vehicles.find(v => v.id === vid)?.location === depot,
          { vid: plan.vehicleId, depot: /home/.test(s.title) ? plan.destination : plan.loadDepot },
        );
        if (/^Run her/.test(s.title) && arrived) {
          const moved = await page
            .waitForFunction(st => window.__se.snap()?.step !== st, s.step, { timeout: 3000 })
            .then(() => true, () => false);
          if (!moved) await fail(`step ${s.step} "${s.title}": she arrived but the run did not move on`);
        }
      } else {
        // A depot-side control: wait for the card to answer before touching anything else. Loading
        // twice under "Load her up" would fill the bay before "Fill the bay" was ever shown.
        const answered = await page
          .waitForFunction(p => { const n = window.__se.snap(); return !n || n.step !== p.step || n.target !== p.target; }, { step: s.step, target: s.target }, { timeout: 5000, polling: 50 })
          .then(() => true, () => false);
        if (!answered) await fail(`step ${s.step} "${s.title}": clicking ${s.target} did not move the run on`);
      }
    }
    if (!finished && !problems.length) problems.push('run did not finish');
  } catch (e) {
    await fail('driver error: ' + e.message.split('\n')[0]);
  }
  await ctx.close();
  return { label, note, secs: Math.round((Date.now() - started) / 1000), problems: [...new Set(problems)] };
}

/**
 * Why a step the run passed over was already done, from the save at the moment it was passed.
 * Null if the save does not bear it out — a step that skipped itself for no reason.
 */
function skipReason(step, g, plan, start) {
  const v = g.vehicles.find(x => x.id === plan.vehicleId);
  if (!v) return null;
  // "Run her up there" / "Run her home": she covered the whole leg on the day she set off.
  if (step === 5 && v.location === plan.loadDepot) return 'arrived on setting off';
  if (step === 10 && v.location === plan.destination) return 'arrived on setting off';
  // "Fill the bay": the first lot filled the bay, or there is no money for a second.
  if (step === 7) {
    const h = g.hauliers.find(x => x.id === start.haulierId);
    const lots = v.hold.filter(l => l.good === plan.good).length;
    const last = [...v.hold].reverse().find(l => l.good === plan.good);
    if (lots >= 1 && last && h.cash < last.paid) return 'cannot afford a second lot';
    if (v.hold.length >= g.slots) return 'bay full';
  }
  return null;
}

(async () => {
  const configs = QUICK ? quickMatrix() : fullMatrix();
  const t0 = Date.now();
  const browser = await chromium.launch();
  const all = [];
  for (const cfg of configs) {
    const r = await run(browser, cfg);
    console.log(r.problems.length ? `${r.label} FAIL (${r.secs}s) ${r.problems[0]}` : `${r.label} ok (${r.secs}s)${r.note}`);
    for (const p of r.problems) all.push(`${r.label}: ${p}`);
  }
  await browser.close();
  console.log(`\n${configs.length} runs in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`PROBLEMS (${all.length})`);
  for (const p of all) console.log('  ' + p);
  process.exit(all.length ? 1 : 0);
})();
