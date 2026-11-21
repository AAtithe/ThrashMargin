/**
 * Fireline's guided first battle, played with a finger on emulated phones.
 *
 * The desktop driver (fireline.cjs) plays with a mouse. This one uses only taps and touch
 * gestures: every card's `data-tour-target` is tapped, structures are placed by tapping the
 * battlefield until one fits, the riflemen are selected with the command bar's Army button and
 * ordered with a tap on open ground. It then checks that a one-finger drag moves the view and that
 * the save holds the Generator, Refinery and Barracks the run built.
 *
 * Quick mode (CI) plays an upright iPhone; the full run adds the iPhone on its side, where the
 * card has to move out of the battlefield's way, and an Android phone. TOUR_DEVICE plays one
 * Playwright device by name.
 *
 * On each of those phones (and, in the full run, both iPhone SEs, 320 and 375px wide) it then opens
 * advanced-tech skirmishes with heroes and Generals on, a campaign mission with four heroes and four
 * powers, and a War for the Planet battle, all built in the page from the game's own modules. On a
 * phone the bar row (heroes, powers, the General) is one line, with a Heroes button whose cards open
 * in a drawer; the check fails if the row is more than one line, if the battle feed meets the row,
 * the low-power banner, the header or the command bar, if the row meets the command bar or leaves
 * the map, or the page scrolls sideways; and it opens the drawer, fires an ability from it and closes
 * it. A three-panel row once wrapped over the feed and pushed it under the header. In the mission it
 * also opens the objectives panel and fails if it meets the feed, the strip, a banner (a targeting
 * hint included), the header or the command bar, if an objective row cannot be tapped, if it lies
 * over the hero drawer, if the hidden pill meets any of them, or if a button in the panel or the
 * pill is under 40px either way. It repeats all of that in a second mission with five objectives,
 * four of which can be shown on the map, where tapping one must also move the view. In every case,
 * running and paused, and once more in the mission with the save warning showing, it fails if a
 * header control leaves the window, overlaps another, is under 40px or cuts off its label.
 * TOUR_SKIP_TOUR=1 runs those checks alone.
 *
 * On tablets (four, both ways up, in the full run; the iPad mini upright in quick mode) it opens both
 * missions and runs the same objectives checks against the panel in its desktop place at the top
 * right: every control and the pill 40px both ways, clear of the feed, the bar row and its bars, the
 * banners (a targeting hint, panel open and hidden), the header and the command bar, and a tap on a
 * showable row moves the view. TOUR_TABLET names one tablet, or "all", and runs those checks alone.
 */
const { chromium, devices } = require('playwright');
const path = require('path');

const BASE = process.env.TOUR_BASE || 'http://localhost:5307';
const OUT = process.env.TOUR_OUT || path.join(require('os').tmpdir(), 'tours', 'fireline-touch');
const USER = JSON.stringify({ userId: 'local-dev', username: 'local-dev' });
const DEVICES = process.env.TOUR_DEVICE ? [process.env.TOUR_DEVICE] : process.env.TOUR_QUICK ? ['iPhone 13'] : ['iPhone 13', 'iPhone 13 landscape', 'Pixel 7'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const problems = [];

const cardState = page =>
  page.evaluate(() => {
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

const onField = (page, x, y) => page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id === 'fl-battlefield', [x, y]);

async function play(browser, name) {
  const tag = name.replace(/ /g, '-');
  const ctx = await browser.newContext({ ...devices[name] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('page error: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().includes('React Router Future Flag')) errors.push('console.error: ' + m.text());
  });
  const fail = async msg => {
    problems.push(`${name}: ${msg}`);
    await page.screenshot({ path: path.join(OUT, `${tag}-${problems.length}.png`) }).catch(() => {});
  };
  try {
    await page.goto(BASE + '/');
    await page.evaluate(u => localStorage.setItem('tm_user', u), USER);
    await page.reload();
    await page.getByRole('button', { name: /Begin the battle/ }).tap();
    await page.waitForURL(/\/game\//);
    if (!(await page.getByTestId('command-bar').isVisible())) await fail('no command bar on a touch screen');
    // The tour must step aside for the menu, or the menu cannot be used.
    await page.getByTestId('menu-button').tap();
    await page.getByRole('button', { name: 'Fast' }).tap({ timeout: 3000 });
    await page.getByRole('button', { name: 'Close', exact: true }).tap({ timeout: 3000 });

    let cs = await cardState(page);
    if (!cs || cs.step !== 0) return await fail(`the run did not open on the welcome card: ${JSON.stringify(cs)}`);
    let last = -1;
    let since = Date.now();
    for (let guard = 0; guard < 200 && cs; guard++) {
      if (cs.step !== last) {
        last = cs.step;
        since = Date.now();
        if (process.env.TOUR_DEBUG) console.log(`  ${name} step ${cs.step} ${cs.title} -> ${cs.target}`);
      }
      if (Date.now() - since > 60000) return await fail(`stuck on step ${cs.step} "${cs.title}"`);
      if (cs.done) {
        await sleep(300);
      } else if (cs.manual) {
        if (cs.step === 11) break;
        await page.getByRole('button', { name: cs.step === 0 ? 'Start' : 'Next' }).tap();
      } else if (cs.target === 'fl-battlefield') {
        const b = await page.locator('#fl-battlefield').boundingBox();
        if (/^(Place|Build)/.test(cs.title)) {
          let placed = false;
          for (let r = 60; r < 280 && !placed; r += 30) {
            for (let a = 0; a < 6.28 && !placed; a += 0.6) {
              const x = b.x + b.width / 2 + r * Math.cos(a);
              const y = b.y + b.height / 2 + r * Math.sin(a);
              // Keep clear of the command bar: a phone snaps a tap near a button onto the button.
              if (y > b.y + b.height - 80 || !(await onField(page, x, y))) continue;
              await page.touchscreen.tap(x, y);
              await sleep(150);
              placed = !(await page.locator('#fl-battlefield').getAttribute('data-placing'));
            }
          }
          if (!placed) return await fail(`step ${cs.step}: no tap placed the structure`);
        } else if (/^Give/.test(cs.title)) {
          const tries = [[0.15, 0.3], [0.2, 0.15], [0.1, 0.5], [0.4, 0.1], [0.3, 0.6]];
          const [fx, fy] = tries[guard % tries.length];
          const x = b.x + b.width * fx;
          const y = b.y + b.height * fy;
          if (y < b.y + b.height - 80 && (await onField(page, x, y))) await page.touchscreen.tap(x, y);
        } else {
          return await fail(`step ${cs.step} "${cs.title}": the driver does not know how to act on the battlefield here`);
        }
      } else if (cs.target) {
        const el = page.locator('#' + cs.target);
        if (!(await el.isDisabled().catch(() => true))) {
          await el.tap({ timeout: 3000 }).catch(e => fail(`tapping ${cs.target}: ${e.message.split('\n')[0]}`));
        }
      } else {
        return await fail(`step ${cs.step} "${cs.title}" points at nothing`);
      }
      await sleep(700);
      cs = await cardState(page);
    }
    if (!cs || cs.step !== 11) return await fail(`the run ended on ${JSON.stringify(cs)}, not the last card`);
    await page.locator('[data-tour-step]').getByRole('button', { name: 'Close', exact: true }).tap();
    // The run ends with the build window open (its last cards ring its close button): close it.
    if (await page.locator('#fl-build-window').count()) await page.locator('#fl-build-close').tap();

    // A one-finger drag pans: the paused battlefield must look different afterwards.
    await page.getByTestId('pause').tap();
    await page.getByRole('button', { name: 'Resume' }).last().tap();
    const b = await page.locator('#fl-battlefield').boundingBox();
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
    const before = await page.locator('#fl-battlefield').screenshot();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 3;
    await touch('touchStart', [[cx, cy]]);
    for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx - i * 15, cy - i * 10]]);
    await touch('touchEnd', []);
    await sleep(200);
    if (before.equals(await page.locator('#fl-battlefield').screenshot())) await fail('a one-finger drag did not move the view');

    await page.getByTestId('pause').tap();
    const save = await page.evaluate(() => {
      const k = Object.keys(localStorage).find(k => k.startsWith('fireline_save_'));
      return k ? JSON.parse(localStorage.getItem(k)) : null;
    });
    const mine = new Set((save?.buildings || []).filter(x => x.owner === 0).map(x => x.kind));
    for (const k of ['power', 'refinery', 'barracks']) if (!mine.has(k)) await fail(`the save has no ${k} after the run`);
    for (const e of errors) await fail(e);
    console.log(`  ${name}: ok through all 12 cards`);
  } catch (e) {
    await fail(e.message.split('\n')[0]);
  } finally {
    await ctx.close();
  }
}

/**
 * A skirmish save built in the page from the game's own modules (Vite serves them): advanced tech,
 * Generals on, and for every case but 'bare' heroes on with the Academy, the power structures, the
 * heroes and a General standing. 'revive' has the Ace fallen, which adds the recruit-again note.
 * Five feed lines are written so the feed is at its tallest.
 */
const buildSkirmish = (page, kind) =>
  page.evaluate(async kind => {
    const st = await import('/src/sim/state.ts');
    const hs = await import('/src/sim/heroes.ts');
    const sides = await import('/src/sim/sides.ts');
    const id = `bar-row-${kind}`;
    const s = st.createInitialState(id, 'Bar row check', { seed: 'bar-row', createdAt: 0, setup: { tech: 'advanced', heroes: kind !== 'bare', generals: true } });
    const o = sides.startOf(s, 0);
    if (kind !== 'bare') {
      const dx = o.x < s.mapW / 2 ? 1 : -1;
      ['barracks', 'factory', 'uplink', 'techcentre', 'strikecommand', 'academy', 'power', 'power', 'power'].forEach((k, i) =>
        st.addBuilding(s, 0, k, Math.round(o.x + dx * (4 + 4 * (i % 3))), Math.round(o.y + 4 + 4 * Math.floor(i / 3)), -100));
      const heroes = kind === 'revive' ? ['spy', 'commando', 'engineer'] : ['spy', 'commando', 'engineer', 'ace'];
      heroes.forEach((k, i) => st.addUnit(s, 0, k, o.x + 0.5 + i, o.y - 2.5));
      hs.enlistHeroes(s);
      if (kind === 'revive') s.players[0].heroFallen = { ace: { at: s.tick + 900, xp: 40 } };
      st.addUnit(s, 0, 'general', o.x - 1.5, o.y - 2.5);
      s.powers = { ...(s.powers || {}), 0: { recon: 0, barrage: 300, missile: 0 } };
    }
    for (let i = 1; i <= 5; i++) s.log.push({ tick: s.tick, text: `Bar row check ${i}: a line of the battle feed.` });
    localStorage.setItem('fireline_save_' + id, JSON.stringify(s));
    localStorage.setItem('fireline_saves', JSON.stringify([{ id, name: 'Bar row check', turn: 0, status: 'active', savedAt: Date.now() }]));
    return id;
  }, kind);

/**
 * A campaign mission ("fireline", the eighth) with all four heroes and all four support powers: the
 * widest strip a mission can show. Five feed lines again.
 */
const buildMission = page =>
  page.evaluate(async () => {
    const cs = await import('/src/campaign/save.ts');
    const pr = await import('/src/campaign/progression.ts');
    const ms = await import('/src/campaign/missions.ts');
    const mi = await import('/src/sim/mission.ts');
    const st = await import('/src/sim/state.ts');
    const hs = await import('/src/sim/heroes.ts');
    const id = 'bar-row-mission';
    const sv = cs.newCampaignSave(id, 'Bar row campaign', 'Me', 0);
    const spec = ms.MISSIONS.find(m => m.id === 'fireline');
    const battle = mi.createMissionState(pr.campaignMission(sv.campaign, spec), pr.missionContext(sv.campaign, spec, id, 0));
    const c = mi.baseCentre(battle, 0);
    const have = new Set(battle.units.filter(u => u.owner === 0).map(u => u.kind));
    ['spy', 'commando', 'engineer', 'ace'].filter(k => !have.has(k)).forEach((k, i) => st.addUnit(battle, 0, k, c.x + 0.5 + i, c.y - 2.5));
    hs.enlistHeroes(battle);
    battle.powers[0] = { recon: 0, barrage: 300, reinforce: 0, missile: 600 };
    for (let i = 1; i <= 5; i++) battle.log.push({ tick: battle.tick, text: `Bar row check ${i}: a line of the battle feed.` });
    localStorage.setItem('fireline_save_' + id, JSON.stringify({ ...sv, campaign: { ...sv.campaign, lastMission: spec.id }, battle }));
    localStorage.setItem('fireline_saves', JSON.stringify([{ id, name: 'Bar row campaign', turn: 0, status: 'active', savedAt: Date.now(), kind: 'campaign' }]));
    return id;
  });

/**
 * The busiest objectives panel: "The Quiet Man", three objectives, two bonus and the mission clock,
 * with the whole map explored so that four of the five rows can show their target on the map. The
 * "fireline" mission above starts with none to show.
 */
const buildLocatedMission = page =>
  page.evaluate(async () => {
    const cs = await import('/src/campaign/save.ts');
    const pr = await import('/src/campaign/progression.ts');
    const ms = await import('/src/campaign/missions.ts');
    const mi = await import('/src/sim/mission.ts');
    const id = 'bar-row-located';
    const sv = cs.newCampaignSave(id, 'Objectives campaign', 'Me', 0);
    const spec = ms.MISSIONS.find(m => m.id === 'quiet-man');
    const battle = mi.createMissionState(pr.campaignMission(sv.campaign, spec), pr.missionContext(sv.campaign, spec, id, 0));
    battle.explored = '1'.repeat(battle.explored.length);
    for (let i = 1; i <= 5; i++) battle.log.push({ tick: battle.tick, text: `Objectives check ${i}: a line of the battle feed.` });
    localStorage.setItem('fireline_save_' + id, JSON.stringify({ ...sv, campaign: { ...sv.campaign, lastMission: spec.id }, battle }));
    localStorage.setItem('fireline_saves', JSON.stringify([{ id, name: 'Objectives campaign', turn: 0, status: 'active', savedAt: Date.now(), kind: 'campaign' }]));
    return id;
  });

/** A War for the Planet battle: a short war played to its first attack, with the heroes it allows. */
const buildPlanet = page =>
  page.evaluate(async () => {
    const save = await import('/src/planet/save.ts');
    const bs = await import('/src/planet/battleSetup.ts');
    const tu = await import('/src/planet/turn.ts');
    const pb = await import('/src/planet/battle.ts');
    const id = 'bar-row-planet';
    const sv = save.newPlanetSave(id, 'Bar row war', { seedText: 'a', preset: 'short', difficulty: 'normal', commander: 'Me', createdAt: 0 });
    let p = sv.planet;
    for (let turn = 0; turn < 12 && !p.pending.length; turn++) {
      if (!bs.attackTargets(p, 0).length)
        for (let to = 0; to < p.regions.length; to++) {
          const q = tu.applyPlanetAction(p, { type: 'moveArmy', to });
          if (q !== p && bs.attackTargets(q, 0).length) {
            p = q;
            break;
          }
        }
      const targets = bs.attackTargets(p, 0);
      if (targets.length) {
        const heroes = Object.entries(p.heroes).filter(([, v]) => v.unlocked && !v.lost).map(([k]) => k).slice(0, p.options.heroesPerBattle);
        const q = tu.applyPlanetAction(p, { type: 'attack', target: targets[0], credits: 0, heroes });
        if (q !== p) {
          p = q;
          break;
        }
      }
      p = tu.applyPlanetAction(p, { type: 'endTurn' });
    }
    p = tu.applyPlanetAction(p, { type: 'fight' });
    const battle = pb.buildPlanetBattle(p.pending[0].setup, { id, name: 'Bar row war', createdAt: 0 });
    for (let i = 1; i <= 5; i++) battle.log.push({ tick: battle.tick, text: `Bar row check ${i}: a line of the battle feed.` });
    localStorage.setItem('fireline_save_' + id, JSON.stringify({ ...sv, planet: p, battle }));
    localStorage.setItem('fireline_saves', JSON.stringify([{ id, name: 'Bar row war', turn: 1, status: 'active', savedAt: Date.now(), kind: 'planet', preset: 'short' }]));
    return id;
  });

/** The feed's box, the bar row's (its own box joined with every bar in it) and the command bar's. */
const barRowBoxes = page =>
  page.evaluate(() => {
    const box = el => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    };
    const join = bs => bs.reduce((a, b) => ({ left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) }));
    // Found by its text, so the check reads the same on a layout without test ids.
    const feed = [...document.querySelectorAll('[aria-live="polite"]')].find(e => e.textContent.includes('Bar row check'));
    const row = document.querySelector('.fl-cbar');
    const bars = row ? [...row.querySelectorAll('.fl-herobar, .fl-powerbar, .fl-genbtn, .fl-hero-revive')] : [];
    const cmd = document.querySelector('[data-testid="command-bar"]');
    const low = document.querySelector('[data-testid="low-power"]');
    const header = document.querySelector('header');
    // The row's controls, by the top of each: more than one distinct top is more than one line.
    const tops = row ? [...new Set([...row.querySelectorAll('button')].filter(b => b.offsetParent).map(b => Math.round(b.getBoundingClientRect().top)))] : [];
    return {
      feed: feed ? box(feed) : null,
      lines: feed ? feed.children.length : 0,
      row: row ? join([row, ...bars].map(box)) : null,
      bars: bars.length,
      tops,
      buttons: row ? row.querySelectorAll('button').length : 0,
      low: low ? box(low) : null,
      header: header ? box(header) : null,
      command: cmd ? box(cmd) : null,
      field: box(document.getElementById('fl-battlefield')),
      pageWidth: document.documentElement.scrollWidth,
      width: innerWidth,
    };
  });

const meets = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
const fmt = b => `${Math.round(b.top)}..${Math.round(b.bottom)}`;

/**
 * The Heroes button and its drawer: it opens over the map without moving it, an ability fires from
 * it (the Ace's Overdrive at once, or a targeted one, which puts the drawer away and asks for a
 * target), and Close puts it away and gives focus back to the button.
 */
async function heroDrawer(page, kind, fail) {
  const button = page.getByTestId('heroes-button');
  if (!(await button.count())) return await fail(kind, 'no Heroes button in the bar row');
  const field = () => page.locator('#fl-battlefield').boundingBox();
  const before = await field();
  const open = async () => {
    await button.tap();
    const drawer = page.getByTestId('hero-drawer');
    await drawer.waitFor({ timeout: 3000 });
    if ((await button.getAttribute('aria-expanded')) !== 'true') await fail(kind, 'the Heroes button does not say the drawer is open');
    return drawer;
  };
  let drawer = await open();
  const after = await field();
  if (JSON.stringify(before) !== JSON.stringify(after)) await fail(kind, 'opening the hero drawer moved the map');
  const d = await drawer.boundingBox();
  if (d.y < after.y - 0.5 || d.y + d.height > after.y + after.height + 0.5) await fail(kind, `the hero drawer (${Math.round(d.y)}..${Math.round(d.y + d.height)}) leaves the map`);
  // The first ready ability: one that needs no target fires at once; one that does asks for a target.
  const ready = drawer.locator('.fl-ability[data-ready="1"]');
  if (!(await ready.count())) return await fail(kind, 'no ready ability in the hero drawer');
  const instant = drawer.locator('[data-testid="ability-ace"][data-ready="1"]');
  const ability = (await instant.count()) ? instant : ready.first();
  const which = await ability.getAttribute('data-testid');
  if (process.env.TOUR_DEBUG) console.log(`    ${kind}: firing ${which} from the hero drawer`);
  await ability.scrollIntoViewIfNeeded();
  await ability.tap();
  await sleep(300);
  if (await page.getByTestId('hero-drawer').count()) await fail(kind, `tapping ${which} left the drawer open over the map`);
  if (which === 'ability-ace') {
    drawer = await open();
    if ((await drawer.getByTestId('ability-ace').getAttribute('data-ready')) !== '0') await fail(kind, 'the Ace\'s Overdrive did not fire from the drawer');
  } else {
    const hint = page.getByTestId('hint');
    if (!(await hint.count()) || !/tap an enemy structure/.test(await hint.textContent())) await fail(kind, `tapping ${which} did not ask for a target`);
    await page.getByRole('button', { name: 'Cancel' }).tap();
    drawer = await open();
  }
  await drawer.getByTestId('hero-drawer-close').tap();
  await sleep(200);
  if (await page.getByTestId('hero-drawer').count()) await fail(kind, 'Close did not put the hero drawer away');
  if (!(await button.evaluate(b => b === document.activeElement))) await fail(kind, 'focus did not return to the Heroes button');
}

/**
 * The objectives panel's box, and the boxes it must keep clear of: the feed, the strip, every banner,
 * the header, the command bar and the hero drawer, with the map it must stay inside.
 */
const objectiveBoxes = page =>
  page.evaluate(() => {
    const box = el => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    };
    const panel = document.querySelector('[data-testid="objectives"]') || document.querySelector('[data-testid="objectives-show"]');
    const feed = document.querySelector('[data-testid="battle-feed"]');
    const strip = document.querySelector('.fl-barstrip') || document.querySelector('.fl-cbar');
    const drawer = document.querySelector('[data-testid="hero-drawer"]');
    return {
      open: !!document.querySelector('[data-testid="objectives"]'),
      panel: panel ? box(panel) : null,
      others: [
        ['battle feed', feed],
        ['bar strip', strip],
        ['header', document.querySelector('header')],
        ['command bar', document.querySelector('[data-testid="command-bar"]')],
        ['alert chip', document.querySelector('.fl-alert-chip')],
        ...[...document.querySelectorAll('.fl-cbar .fl-herobar, .fl-cbar .fl-powerbar')].map(b => [b.classList.contains('fl-herobar') ? 'hero bar' : 'power bar', b]),
        ...[...document.querySelectorAll('.fl-banners > *')].map(b => [`banner "${b.textContent.trim().slice(0, 24)}"`, b]),
      ]
        .filter(([, el]) => el && el.getClientRects().length)
        .map(([what, el]) => [what, box(el)]),
      drawer: drawer ? box(drawer) : null,
      field: box(document.getElementById('fl-battlefield')),
    };
  });

/**
 * The campaign's objectives panel on a phone: open, it must meet none of the feed, the strip, a
 * banner, the header or the command bar, and stay on the map; every objective row must be the top
 * thing where it is drawn (scrolled to inside the panel if need be), so a tap on it reaches it; the
 * hero drawer, when open, lies over it rather than under it; and hidden, the pill keeps clear too.
 * It used to sit top right at 46% of the map's width and run down over the feed and the strip.
 */
/**
 * Every button in the objectives panel (Hide, and each objective's way to show it on the map) and
 * the hidden pill must be a 40px tap target both ways. Hide was 57 by 17px, each Show 44 by 18px and
 * the pill 26 or 28px tall. `locate` asks for at least one objective that can be shown, so the check
 * cannot pass by finding none.
 */
async function objectiveTapTargets(page, kind, fail, when, locate = false) {
  const bs = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="objectives"]');
    const pill = document.querySelector('[data-testid="objectives-show"]');
    return [...(panel ? panel.querySelectorAll('button') : []), ...(pill ? [pill] : [])]
      .filter(b => b.getClientRects().length)
      .map(b => {
        const r = b.getBoundingClientRect();
        return { name: b.getAttribute('data-testid') || b.getAttribute('aria-label') || b.textContent.trim().slice(0, 30), hide: b.getAttribute('data-testid') === 'objectives-hide', w: r.width, h: r.height };
      });
  });
  if (!bs.length) await fail(kind, `the objectives offer no button ${when}`);
  if (locate && bs.filter(b => !b.hide).length === 0) await fail(kind, `no objective offers a way to show it on the map ${when}`);
  for (const b of bs)
    if (b.w < 39.5 || b.h < 39.5) await fail(kind, `the objectives' "${b.name}" is a ${Math.round(b.w)}x${Math.round(b.h)} tap target, under 40px, ${when}`);
}

async function objectivesClear(page, kind, fail, locate = false) {
  const check = async when => {
    const m = await objectiveBoxes(page);
    if (!m.panel) return await fail(kind, `no objectives panel or pill ${when}`);
    const what = m.open ? 'objectives panel' : 'objectives pill';
    for (const [name, b] of m.others)
      if (meets(m.panel, b)) await fail(kind, `the ${what} (${fmt(m.panel)}) covers the ${name} (${fmt(b)}) ${when}`);
    if (m.panel.top < m.field.top - 0.5 || m.panel.bottom > m.field.bottom + 0.5 || m.panel.left < m.field.left - 0.5 || m.panel.right > m.field.right + 0.5)
      await fail(kind, `the ${what} (${fmt(m.panel)}) runs off the map (${fmt(m.field)}) ${when}`);
    return m;
  };
  if (!(await page.getByTestId('objectives').count())) await page.getByTestId('objectives-show').tap();
  await page.getByTestId('objectives').waitFor({ timeout: 3000 });
  await sleep(200);
  const m = await check('with the panel open');
  await objectiveTapTargets(page, kind, fail, 'with the panel open', locate);
  if (m && m.panel && m.panel.bottom - m.panel.top < 40) await fail(kind, `the objectives panel is only ${Math.round(m.panel.bottom - m.panel.top)}px tall`);
  // Every row can be reached: scrolled into the panel's view, the row is what a tap at its centre hits.
  const rows = await page.locator('[data-testid="objectives"] .fl-objective').count();
  if (!rows) await fail(kind, 'the objectives panel lists no objectives');
  for (let i = 0; i < rows; i++) {
    const row = page.locator('[data-testid="objectives"] .fl-objective').nth(i);
    await row.evaluate(r => r.scrollIntoView({ block: 'nearest' }));
    const hit = await row.evaluate(r => {
      const b = r.getBoundingClientRect();
      return r.contains(document.elementFromPoint(b.left + Math.min(20, b.width / 2), b.top + Math.min(8, b.height / 2)));
    });
    if (!hit) await fail(kind, `objective row ${i + 1} cannot be tapped: something lies over it`);
  }
  // Tapping an objective that can be shown moves the view: a grid of the battlefield's pixels, before
  // and after each tap, must change for at least one of them (one target may already be in view).
  if (locate) {
    const sample = () =>
      page.evaluate(() => {
        const c = document.getElementById('fl-battlefield');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const out = [];
        for (let gy = 1; gy < 16; gy++)
          for (let gx = 1; gx < 16; gx++) {
            const i = (Math.floor((c.height * gy) / 16) * c.width + Math.floor((c.width * gx) / 16)) * 4;
            out.push(d[i] + d[i + 1] + d[i + 2]);
          }
        return out;
      });
    const targets = page.locator('[data-testid="objectives"] .fl-objective button');
    let moved = 0;
    for (let i = 0; i < (await targets.count()); i++) {
      const before = await sample();
      await targets.nth(i).evaluate(b => b.scrollIntoView({ block: 'nearest' }));
      await targets.nth(i).tap();
      await sleep(250);
      const after = await sample();
      if (before.filter((v, k) => Math.abs(v - after[k]) > 30).length > before.length / 3) moved++;
    }
    if (!moved) await fail(kind, 'tapping an objective that can be shown never moved the view');
  }
  // A power that needs a target puts its hint in the banners: the panel and the pill keep clear of
  // that too. (A power button, not the bar: the bar's own test id also starts "power-".)
  const hint = async when => {
    const power = page.locator('.fl-cbar button[data-testid^="power-"]:not([disabled])').first();
    if (!(await power.count())) return;
    await power.tap();
    if (await page.getByTestId('hint').count()) {
      await check(`with a targeting hint showing ${when}`);
      await page.getByRole('button', { name: 'Cancel' }).tap();
    }
  };
  await hint('and the panel open');
  // The hero drawer opens over the panel, never under it.
  if (await page.getByTestId('heroes-button').count()) {
    await page.getByTestId('heroes-button').tap();
    await page.getByTestId('hero-drawer').waitFor({ timeout: 3000 });
    const d = await objectiveBoxes(page);
    if (d.panel && d.drawer && meets(d.panel, d.drawer)) {
      const x = (Math.max(d.panel.left, d.drawer.left) + Math.min(d.panel.right, d.drawer.right)) / 2;
      const y = (Math.max(d.panel.top, d.drawer.top) + Math.min(d.panel.bottom, d.drawer.bottom)) / 2;
      const onTop = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-testid="hero-drawer"]'), [x, y]);
      if (!onTop) await fail(kind, 'the objectives panel lies over the hero drawer');
    }
    await page.getByTestId('hero-drawer-close').tap();
    await sleep(200);
  }
  await page.getByTestId('objectives-hide').tap();
  await page.getByTestId('objectives-show').waitFor({ timeout: 3000 });
  await check('with the panel hidden');
  await objectiveTapTargets(page, kind, fail, 'with the panel hidden');
  await hint('and the panel hidden');
  await page.getByTestId('objectives-show').tap();
}

/**
 * The battle header's controls (the back button, the clock, a save warning, Pause and Menu): each
 * box must lie wholly inside the window and the header, none may overlap another, every button must
 * be a 40px tap target with its label unclipped, and the page must not scroll sideways. Checked
 * running and paused in every case, and once more with the save warning showing. On the 320px
 * iPhone SE the Menu button once ran 42px off the right edge in a campaign mission.
 */
const headerBoxes = page =>
  page.evaluate(() => {
    const header = document.querySelector('header.fl-d-top');
    if (!header) return null;
    const box = el => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    };
    const items = [...header.querySelectorAll('button, .fl-d-clock, .fl-d-save')]
      .filter(el => el.getClientRects().length && !el.parentElement.closest('button'))
      .map(el => ({
        name: el.getAttribute('data-testid') || el.getAttribute('aria-label') || el.className.split(' ').pop(),
        button: el.tagName === 'BUTTON',
        clipped: el.scrollWidth > el.clientWidth + 1,
        ...box(el),
      }));
    return { header: box(header), items, width: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth };
  });

async function headerFits(page, kind, fail, when = 'running') {
  const h = await headerBoxes(page);
  if (!h) return await fail(kind, `no battle header (${when})`);
  kind = `${kind}, ${when}`;
  if (h.items.length < 4) await fail(kind, `the header holds ${h.items.length} controls, not 4 or more`);
  const px = n => Math.round(n);
  for (const it of h.items) {
    if (it.left < -0.5 || it.right > h.width + 0.5 || it.top < -0.5 || it.bottom > h.height + 0.5)
      await fail(kind, `the header's ${it.name} (${px(it.left)}..${px(it.right)}) runs off the ${h.width}px window by ${px(Math.max(it.right - h.width, -it.left))}px`);
    else if (it.left < h.header.left - 0.5 || it.right > h.header.right + 0.5 || it.top < h.header.top - 0.5 || it.bottom > h.header.bottom + 0.5)
      await fail(kind, `the header's ${it.name} sticks out of the header`);
    if (it.button && (it.right - it.left < 39.5 || it.bottom - it.top < 39.5))
      await fail(kind, `the header's ${it.name} is a ${px(it.right - it.left)}x${px(it.bottom - it.top)} tap target, under 40px`);
    if (it.clipped) await fail(kind, `the header's ${it.name} cuts off its own label`);
  }
  for (let i = 0; i < h.items.length; i++)
    for (let j = i + 1; j < h.items.length; j++)
      if (meets(h.items[i], h.items[j])) await fail(kind, `the header's ${h.items[i].name} and ${h.items[j].name} overlap`);
  if (h.pageWidth > h.width) await fail(kind, `the page scrolls sideways (${h.pageWidth}px in ${h.width}px)`);
}

/** The header running and paused: "Resume" is a longer word than "Pause". */
async function headerBothWays(page, kind, fail) {
  await headerFits(page, kind, fail);
  await page.getByTestId('pause').tap();
  await sleep(150);
  await headerFits(page, kind, fail, 'paused');
  await page.getByTestId('pause').tap();
}

/**
 * The widest header there is: the mission again, signed in to an account whose saves fail, so the
 * header carries "Not saving" too. The API is answered in the page: the battle loads, every save gets
 * a 500. The first save goes out after 15 seconds of play.
 */
async function headerWithSaveWarning(page, fail) {
  const id = await buildMission(page);
  const state = await page.evaluate(id => JSON.parse(localStorage.getItem('fireline_save_' + id)), id);
  await page.evaluate(() => {
    // A token the session code accepts (unexpired, with a user that says whether it is an admin).
    localStorage.setItem('tm_token', 'e30.' + btoa(JSON.stringify({ exp: 9999999999 })) + '.x');
    localStorage.setItem('tm_last_active', String(Date.now()));
    localStorage.setItem('tm_user', JSON.stringify({ userId: 'local-dev', username: 'local-dev', isAdmin: false }));
  });
  await page.route('**/api/play/fireline**', r => {
    const q = r.request();
    if (q.method() !== 'GET') return r.fulfill({ status: 500, json: { message: 'Header check: saves fail.' } });
    return r.fulfill({ json: q.url().includes('id=') ? { state, version: 1 } : { saves: [] } });
  });
  await page.goto(`${BASE}/game/${id}`);
  await page.locator('.fl-d-top .fl-d-save[data-state="error"]').waitFor({ timeout: 40000 });
  await headerBothWays(page, 'mission, not saving', fail);
}

/** The bar row against the battle feed (and the command bar), on one phone. */
async function barRow(browser, name) {
  const tag = name.replace(/ /g, '-');
  const ctx = await browser.newContext({ ...devices[name] });
  const page = await ctx.newPage();
  const before = problems.length;
  const fail = async (kind, msg) => {
    problems.push(`${name}, bar row (${kind}): ${msg}`);
    await page.screenshot({ path: path.join(OUT, `${tag}-bar-row-${kind}.png`) }).catch(() => {});
  };
  try {
    await page.goto(BASE + '/');
    await page.evaluate(u => {
      localStorage.setItem('tm_user', u);
      localStorage.setItem('fireline_tour_seen', '1');
    }, USER);
    const cases = { heroes: buildSkirmish, revive: buildSkirmish, bare: buildSkirmish, mission: buildMission, planet: buildPlanet };
    for (const [kind, build] of Object.entries(cases)) {
      const id = await build(page, kind);
      await page.goto(`${BASE}/game/${id}`);
      await page.locator('.fl-cbar').waitFor({ timeout: 15000 });
      await sleep(600);
      const m = await barRowBoxes(page);
      if (!m.feed || m.lines === 0) {
        await fail(kind, 'no battle feed on screen');
        continue;
      }
      // Heroes (a button, or the old hero bar), powers and, in a skirmish, the General.
      const want = { heroes: 5, revive: 5, bare: 4, mission: 5, planet: 1 }[kind];
      if (m.buttons < want) await fail(kind, `the bar row holds ${m.buttons} controls, not ${want} or more`);
      if (m.tops.length > 1 || m.row.bottom - m.row.top > 64)
        await fail(kind, `the bar row is not one line: ${m.tops.length} lines of controls, ${Math.round(m.row.bottom - m.row.top)}px tall`);
      if (meets(m.feed, m.row)) await fail(kind, `the bar row (${fmt(m.row)}) covers the battle feed (${fmt(m.feed)}) by ${Math.round(m.feed.bottom - m.row.top)}px`);
      if (m.low && meets(m.feed, m.low)) await fail(kind, `the battle feed (${fmt(m.feed)}) lies over the low-power banner (${fmt(m.low)})`);
      if ((m.header && meets(m.feed, m.header)) || m.feed.top < m.field.top - 0.5)
        await fail(kind, `the battle feed (${fmt(m.feed)}) runs above the map (${fmt(m.field)}), under the header`);
      if (m.command && meets(m.row, m.command)) await fail(kind, `the bar row (${fmt(m.row)}) covers the command bar (${fmt(m.command)})`);
      if (m.command && meets(m.feed, m.command)) await fail(kind, `the battle feed (${fmt(m.feed)}) covers the command bar (${fmt(m.command)})`);
      if (m.feed.bottom <= m.field.top) await fail(kind, 'the newest feed line is above the battlefield');
      if (m.row.left < m.field.left - 0.5 || m.row.right > m.field.right + 0.5) await fail(kind, `the bar row (${Math.round(m.row.left)}..${Math.round(m.row.right)}) runs off the battlefield`);
      if (m.pageWidth > m.width) await fail(kind, `the page scrolls sideways (${m.pageWidth}px in ${m.width}px)`);
      await headerBothWays(page, kind, fail);
      if (kind !== 'bare') await heroDrawer(page, kind, fail);
      if (kind === 'mission') await objectivesClear(page, kind, fail);
    }
    // The busiest objectives panel, with targets to show: the same checks, and every row's target.
    const located = await buildLocatedMission(page);
    await page.goto(`${BASE}/game/${located}`);
    await page.locator('.fl-cbar').waitFor({ timeout: 15000 });
    await sleep(600);
    await objectivesClear(page, 'mission, objectives to show', fail, true);
    await headerWithSaveWarning(page, fail);
    if (problems.length === before) console.log(`  ${name}: every header control fits the window; the bar row is one line and clears the battle feed; the hero drawer works; the objectives clear the feed, strip, banners and header`);
  } catch (e) {
    await fail('run', e.message.split('\n')[0]);
  } finally {
    await ctx.close();
  }
}

/**
 * The objectives on a tablet: a touch screen that `layout.phone` does not count as a phone, so the
 * panel keeps the desktop's place at the map's top right (the Galaxy Tab S4 upright, 712px wide, is
 * a phone by width and takes the dock). Both missions, panel open and hidden: every control in the
 * panel and the pill must be 40px both ways, the panel must clear the feed, the bar row and its hero
 * and power bars, the banners (a targeting hint included), the header and the command bar, every row
 * must be tappable, and tapping a showable row must move the view. The header's touch sizing is
 * checked too (`touchHeader`). Hide was 57 by 17px and each Show 44 by 18px on every tablet.
 */
async function tabletObjectives(browser, name) {
  const tag = name.replace(/[ ()]/g, '-');
  const ctx = await browser.newContext({ ...devices[name] });
  const page = await ctx.newPage();
  const before = problems.length;
  const fail = async (kind, msg) => {
    problems.push(`${name}, tablet (${kind}): ${msg}`);
    await page.screenshot({ path: path.join(OUT, `${tag}-tablet-${kind.replace(/[ ,]+/g, '-')}.png`) }).catch(() => {});
  };
  try {
    await page.goto(BASE + '/');
    await page.evaluate(u => {
      localStorage.setItem('tm_user', u);
      localStorage.setItem('fireline_tour_seen', '1');
    }, USER);
    for (const [kind, build, locate] of [['mission', buildMission, false], ['mission, objectives to show', buildLocatedMission, true]]) {
      const id = await build(page);
      await page.goto(`${BASE}/game/${id}`);
      await page.locator('.fl-cbar').waitFor({ timeout: 15000 });
      await sleep(600);
      if (!(await page.getByTestId('command-bar').isVisible())) await fail(kind, 'no command bar on a touch screen');
      await touchHeader(page, kind, fail);
      await objectivesClear(page, kind, fail, locate);
    }
    if (problems.length === before) console.log(`  ${name}: every objectives control and the pill are 40px both ways; the panel clears the feed, bar row, banners and header; Show moves the view`);
  } catch (e) {
    await fail('run', e.message.split('\n')[0]);
  } finally {
    await ctx.close();
  }
}

/**
 * The header's touch sizing (the back button, Pause and Menu, 40px tall) is keyed on `layout.touch`,
 * so it applies on a tablet as on a phone. The full header of a window 1100px or wider carries other
 * controls (speed, sound, the Controls sheet, motion, theme, fullscreen) that are not touch sized;
 * that is logged in fireline-improvements.md, and only the three touch-sized buttons are held here.
 */
async function touchHeader(page, kind, fail) {
  const bs = await page.evaluate(() =>
    [...document.querySelectorAll('header.fl-d-top .fl-d-back, header.fl-d-top .fl-d-pause, header.fl-d-top .fl-d-menu')]
      .filter(b => b.getClientRects().length)
      .map(b => {
        const r = b.getBoundingClientRect();
        return { name: b.className.split(' ').pop(), w: r.width, h: r.height };
      }),
  );
  if (bs.length < 2) await fail(kind, `the header shows ${bs.length} of its touch-sized buttons, not 2 or more`);
  for (const b of bs) if (b.w < 39.5 || b.h < 39.5) await fail(kind, `the header's ${b.name} is a ${Math.round(b.w)}x${Math.round(b.h)} tap target, under 40px`);
}

const ALL_TABLETS = ['iPad Mini', 'iPad Mini landscape', 'iPad (gen 7)', 'iPad (gen 7) landscape', 'iPad Pro 11', 'iPad Pro 11 landscape', 'Galaxy Tab S4', 'Galaxy Tab S4 landscape'];

module.exports = { buildSkirmish, buildMission, buildLocatedMission, buildPlanet, headerBoxes };

if (require.main === module) (async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    // TOUR_TABLET names one tablet (or "all") and runs the tablet check alone.
    const tabletOnly = process.env.TOUR_TABLET;
    if (!tabletOnly) {
      if (!process.env.TOUR_SKIP_TOUR) for (const d of DEVICES) await play(browser, d);
      const rowDevices = process.env.TOUR_DEVICE || process.env.TOUR_QUICK ? DEVICES : [...DEVICES, 'iPhone SE', 'iPhone SE (3rd gen)'];
      for (const d of rowDevices) await barRow(browser, d);
    }
    const tablets = tabletOnly ? (tabletOnly === 'all' ? ALL_TABLETS : [tabletOnly]) : process.env.TOUR_DEVICE ? [] : process.env.TOUR_QUICK ? ['iPad Mini'] : ALL_TABLETS;
    for (const d of tablets) await tabletObjectives(browser, d);
  } finally {
    await browser.close();
  }
  if (problems.length) {
    console.error('Fireline touch tour problems:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log('Fireline touch tour: ok');
})();
