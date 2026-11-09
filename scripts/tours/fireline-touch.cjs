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
    await page.getByRole('button', { name: 'Close' }).tap({ timeout: 3000 });

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
    await page.getByRole('button', { name: 'Close' }).tap();

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

(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const d of DEVICES) await play(browser, d);
  } finally {
    await browser.close();
  }
  if (problems.length) {
    console.error('Fireline touch tour problems:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log('Fireline touch tour: ok');
})();
