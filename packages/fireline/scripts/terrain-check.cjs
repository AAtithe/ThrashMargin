/**
 * The ground held in chunks (src/game/terrainStore.ts, 2026-11-22), checked in a real browser.
 *
 *   node scripts/terrain-check.cjs                 starts Vite on port 5433, checks, stops it
 *   TERRAIN_BASE=http://localhost:5192 node scripts/terrain-check.cjs   against a server already running
 *
 * 1. Painting by region gives the whole map's picture: on a standard, a large and a huge map, and a
 *    2048-pixel square of a vast one, chunks painted on their own and laid side by side match the
 *    picture painted in one go to within TOLERANCE levels on any pixel, and differ by more than 2
 *    levels on under 0.25% of pixels. (Chrome's antialiased edges move by a level or two when the
 *    same drawing is shifted by whole pixels, so exact equality is not to be had; a missing or
 *    misplaced decoration would differ by far more.)
 * 2. No seams: the store draws a loaded region under a zoom that puts chunk edges between screen
 *    pixels, over a magenta background, and no pixel shows magenta through. (Chrome draws images
 *    edge to edge without a seam anyway; the overlap is for browsers that soften image edges. The
 *    same chunks drawn a pixel apart do show the background, so the test can see a seam.)
 * 3. A chunk dropped and painted again comes back the same, permanent marks included; a fading
 *    mark does not come back.
 * 4. Water animates from the clean copy: frame after frame never builds up, and the same moment of
 *    the loop gives the same pixels.
 * 5. A vast battle opens with the worker, and with no Worker at all (the page paints), without page
 *    errors; panning across the map keeps the ground held under the budget plus what the view needs.
 * Needs Playwright, so like check:ui it is not part of npm run check.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 5433;
const BASE = process.env.TERRAIN_BASE || `http://localhost:${PORT}`;
const ROOT = path.join(__dirname, '..');
const TOLERANCE = 32;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
let passes = 0;
const ok = (cond, what) => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}`);
};

async function waitFor(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  return false;
}

/** Puts a battle in local saves (the documented local sign-in, client side only) and returns its id. */
async function seedBattle(page, setup, reveal) {
  await page.goto(`${BASE}/`);
  return page.evaluate(
    async ([setup, reveal]) => {
      const { createInitialState } = await import('/src/sim/state.ts');
      const { packState } = await import('/src/sim/pack.ts');
      const s = createInitialState('terrain-check', 'Terrain check', { seed: 'terrain-check', difficulty: 'normal', createdAt: 0, autopilot: true, setup });
      if (reveal) s.explored = '1'.repeat(s.tiles.length);
      localStorage.setItem('tm_user', JSON.stringify({ userId: 'local-dev', username: 'local-dev' }));
      localStorage.setItem('fireline_save_' + s.id, JSON.stringify(packState(s)));
      localStorage.setItem('fireline_saves', JSON.stringify([{ id: s.id, name: 'Terrain check', turn: 0, status: 'active', savedAt: Date.now() }]));
      return s.id;
    },
    [setup, reveal],
  );
}

(async () => {
  let server = null;
  if (!process.env.TERRAIN_BASE) {
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
    if (!(await waitFor(BASE, 60000))) throw new Error('Vite did not start');
  }
  const browser = await chromium.launch();
  try {
    // ---- 1. Regions against the whole ----------------------------------------------------------
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(`${BASE}/`);
      const rows = await page.evaluate(async () => {
        const maps = await import('/src/sim/maps.ts');
        const terrain = await import('/src/game/terrain.ts');
        const { CHUNK } = await import('/src/game/terrainStore.ts');
        const out = [];
        const compare = (label, p, X, Y, W, H) => {
          const whole = p.paint(X, Y, W, H).getContext('2d').getImageData(0, 0, W, H).data;
          const c = document.createElement('canvas');
          c.width = W;
          c.height = H;
          const g = c.getContext('2d');
          const PAD = 2;
          for (let y = Y; y < Y + H; y += CHUNK)
            for (let x = X; x < X + W; x += CHUNK) {
              const rx = Math.max(0, x - PAD);
              const ry = Math.max(0, y - PAD);
              const rw = Math.min(p.worldW, x + CHUNK + PAD) - rx;
              const rh = Math.min(p.worldH, y + CHUNK + PAD) - ry;
              const w = Math.min(CHUNK, X + W - x);
              const h = Math.min(CHUNK, Y + H - y);
              g.drawImage(p.paint(rx, ry, rw, rh), x - rx, y - ry, w, h, x - X, y - Y, w, h);
            }
          const st = g.getImageData(0, 0, W, H).data;
          let max = 0;
          let over = 0;
          for (let i = 0; i < st.length; i += 4) {
            let d = 0;
            for (let j = 0; j < 4; j++) d = Math.max(d, Math.abs(st[i + j] - whole[i + j]));
            if (d > max) max = d;
            if (d > 2) over++;
          }
          out.push({ label, max, share: over / (W * H) });
        };
        for (const [type, n, size, seed] of [
          ['river', 2, 'standard', 5],
          ['lakes', 4, 'large', 9],
          ['coast', 2, 'huge', 4],
        ]) {
          const m = maps.generateSkirmishMap(seed, type, 'normal', n, size);
          const p = terrain.createTerrainPainter(m.tiles, type, m.w, m.h);
          compare(`${type}, ${n} sides, ${size}`, p, 0, 0, p.worldW, p.worldH);
        }
        // Vast: a 2048-pixel square holding a ruined city, ravine or bridge, painted whole and in chunks.
        const m = maps.generateSkirmishMap(21, 'classic', 'normal', 2, 'vast');
        const p = terrain.createTerrainPainter(m.tiles, 'classic', m.w, m.h);
        let best = 0;
        let at = [0, 0];
        for (let ty = 0; ty + 64 <= m.w; ty += 16)
          for (let tx = 0; tx + 64 <= m.w; tx += 16) {
            let n = 0;
            for (let y = ty; y < ty + 64; y++) for (let x = tx; x < tx + 64; x++) if ('vbxp'.includes(m.tiles[y * m.w + x])) n++;
            if (n > best) (best = n), (at = [tx, ty]);
          }
        compare(`vast, a 2048-pixel square at tile ${at[0]},${at[1]} (${best} ravine, bridge, ruin and street tiles)`, p, at[0] * 32, at[1] * 32, 2048, 2048);
        return out;
      });
      for (const r of rows) ok(r.max <= TOLERANCE && r.share < 0.0025, `${r.label}: chunks match the whole (worst pixel ${r.max} levels, ${(r.share * 100).toFixed(3)}% over 2)`);
      ok(errors.length === 0, `painting by region: no page errors ${errors.slice(0, 2).join(' ')}`);
      await page.close();
    }

    // ---- 2 to 4. The store itself ----------------------------------------------------------------
    {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(`${BASE}/`);
      const r = await page.evaluate(async () => {
        const maps = await import('/src/sim/maps.ts');
        const { TerrainStore, CHUNK } = await import('/src/game/terrainStore.ts');
        const { Water } = await import('/src/game/fx/water.ts');
        const m = maps.generateSkirmishMap(33, 'lakes', 'normal', 2, 'vast');
        const store = new TerrainStore(m.tiles, 'lakes', m.w, m.h, 12 * 1024 * 1024);
        const water = new Water(store, m.tiles, m.w, m.h);
        store.needsPristine = (x, y, w, h) => water.animatedIn(x, y, w, h);
        store.onChunkReady = (x, y, w, h) => water.invalidate(x, y, w, h);
        const settle = async (x0, y0, x1, y1) => {
          for (let i = 0; i < 400; i++) {
            store.view(x0, y0, x1, y1);
            let all = true;
            for (let y = y0; y < y1; y += 64) for (let x = x0; x < x1; x += 64) if (!store.loadedAt(x, y)) all = false;
            if (all) return true;
            await new Promise(r => setTimeout(r, 25));
          }
          return false;
        };
        const out = {};
        // A region where four chunks meet.
        const X = 3 * CHUNK - 300;
        const Y = 3 * CHUNK - 200;
        out.loaded = await settle(X, Y, X + 600, Y + 400);
        // 2. Seams: drawn at a zoom that puts the chunk edges between pixels, over magenta.
        const magenta = draw => {
          const c = document.createElement('canvas');
          c.width = 900;
          c.height = 620;
          const g = c.getContext('2d');
          g.fillStyle = '#ff00ff';
          g.fillRect(0, 0, c.width, c.height);
          g.setTransform(1.37, 0, 0, 1.37, -X * 1.37 + 0.43, -Y * 1.37 + 0.29);
          g.imageSmoothingEnabled = true;
          draw(g);
          const d = g.getImageData(10, 10, 800, 520).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) if ((d[i] + d[i + 2]) / 2 - d[i + 1] > 70) n++;
          return n;
        };
        out.seamStore = magenta(g => store.draw(g, X, Y, 600, 400, null));
        const chunks = store.chunks;
        out.seamNaive = magenta(g => {
          for (const ch of chunks) if (ch.live) g.drawImage(ch.live, ch.cx0 - ch.x, ch.cy0 - ch.y, ch.cx1 - ch.cx0 - 1, ch.cy1 - ch.cy0 - 1, ch.cx0, ch.cy0, ch.cx1 - ch.cx0 - 1, ch.cy1 - ch.cy0 - 1);
        });
        // 3. A permanent mark and a fading one, then the chunk dropped and painted again.
        const PX = 3 * CHUNK - 40;
        const PY = 3 * CHUNK - 40;
        const pixels = () => {
          const c = document.createElement('canvas');
          c.width = 160;
          c.height = 160;
          const g = c.getContext('2d');
          g.translate(-(PX - 80), -(PY - 80));
          store.draw(g, PX - 80, PY - 80, 160, 160, null);
          return Array.from(g.getImageData(0, 0, 160, 160).data);
        };
        const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
        const clean = pixels();
        store.permanent({ x: PX - 30, y: PY - 30, w: 60, h: 60, seed: 12345, draw: (g, rand) => {
          for (let i = 0; i < 30; i++) {
            g.fillStyle = `rgba(${Math.floor(rand() * 255)},20,20,0.8)`;
            g.beginPath();
            g.arc(PX - 25 + rand() * 50, PY - 25 + rand() * 50, 2 + rand() * 4, 0, 6.283);
            g.fill();
          }
        } });
        const marked = pixels();
        store.paintLive(PX + 20, PY + 20, 30, 30, g => { g.fillStyle = 'rgb(0,0,255)'; g.fillRect(PX + 25, PY + 25, 20, 20); }, true);
        const withFading = pixels();
        out.markChanged = !same(clean, marked);
        out.fadingChanged = !same(marked, withFading);
        // Far away, until the marked chunks are dropped (the budget is 12 MB here).
        for (let i = 0; i < 20 && store.loadedAt(PX, PY); i++) await settle(11 * CHUNK, 11 * CHUNK, 11 * CHUNK + 1200, 11 * CHUNK + 900);
        out.dropped = !store.loadedAt(PX, PY) && !store.loadedAt(PX - 30, PY - 30);
        out.heldAfterDrop = store.heldBytes;
        await settle(X, Y, X + 600, Y + 400);
        const back = pixels();
        out.markBack = same(back, marked);
        // 4. Water: a tile animated over a full loop never builds up.
        let wk = -1;
        for (let k = 0; k < m.tiles.length && wk < 0; k++) if (water.animatedIn((k % m.w) * 32, Math.floor(k / m.w) * 32, 32, 32) && m.tiles[k] === 'w') wk = k;
        const wx = (wk % m.w) * 32;
        const wy = Math.floor(wk / m.w) * 32;
        await settle(wx - 100, wy - 100, wx + 100, wy + 100);
        const tile = () => {
          const c = document.createElement('canvas');
          c.width = 32;
          c.height = 32;
          const g = c.getContext('2d');
          g.translate(-wx, -wy);
          store.draw(g, wx, wy, 32, 32, null);
          return Array.from(g.getImageData(0, 0, 32, 32).data);
        };
        const tx = wk % m.w;
        const ty = Math.floor(wk / m.w);
        water.update(1.0, tx, ty, tx, ty);
        const f1 = tile();
        const frames = new Set([f1.join()]);
        for (let t = 1.0; t < 9.0; t += 0.1) {
          water.update(t, tx, ty, tx, ty);
          frames.add(tile().join());
        }
        water.invalidate(wx, wy, 32, 32);
        water.update(5.0, tx, ty, tx, ty);
        out.waterFrames = frames.size;
        out.waterRepeat = same(f1, tile());
        out.peak = store.peakBytes;
        store.dispose();
        return out;
      });
      ok(r.loaded, 'the store paints the chunks a view needs');
      ok(r.seamNaive > 0, `the seam test can see a seam: chunks drawn a pixel apart show the background through ${r.seamNaive} pixels`);
      ok(r.seamStore === 0, `no seams: the store's chunks drawn zoomed show no background (${r.seamStore} pixels)`);
      ok(r.markChanged && r.fadingChanged, 'a permanent mark and a fading mark both draw into the ground');
      ok(r.dropped, `chunks far from the view are dropped over the budget (${(r.heldAfterDrop / 1048576).toFixed(1)} MB held after)`);
      ok(r.markBack, 'a dropped chunk painted again is the same as before, its permanent mark drawn back and its fading mark gone');
      ok(r.waterFrames > 4, `water animates (${r.waterFrames} different frames over a loop)`);
      ok(r.waterRepeat, 'water never builds up: the same moment of its loop gives the same pixels after two loops');
      ok(errors.length === 0, `the store: no page errors ${errors.slice(0, 2).join(' ')}`);
      await page.close();
    }

    // ---- 5. Vast battles, with the worker and without -------------------------------------------
    for (const noWorker of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', m => m.type() === 'error' && errors.push(m.text()));
      if (noWorker) await page.addInitScript(() => delete window.Worker);
      const label = noWorker ? 'without workers' : 'with the worker';
      const id = await seedBattle(page, { map: 'classic', tech: 'advanced', sides: 4, mode: 'teams', size: 'vast' }, true);
      await page.goto(`${BASE}/game/${id}`);
      await page.waitForSelector('[data-testid=battlefield]', { timeout: 60000 });
      const stats = () => page.evaluate(() => globalThis.__flRenderer?.terrainStats() ?? null);
      let first = null;
      for (let i = 0; i < 100 && !(first && first.painted >= 6); i++) {
        await sleep(100);
        first = await stats();
      }
      ok(first && first.painted >= 6, `vast, four sides, ${label}: the ground near the camera is painted (${first?.painted} chunks)`);
      // Pan across the map for twelve seconds, both ways.
      await page.mouse.move(600, 450);
      for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
        await page.keyboard.down(key);
        await sleep(3000);
        await page.keyboard.up(key);
      }
      await sleep(1500);
      const s = await stats();
      const budget = 96 * 1024 * 1024;
      ok(s && s.painted > first.painted, `${label}: panning paints new ground (${s?.painted} chunks painted in all)`);
      ok(s && s.peak <= budget + 40 * 1024 * 1024, `${label}: ground held at most ${(s.peak / 1048576).toFixed(0)} MB (budget 96 MB, plus what one view needs); a whole-map picture and its copy would be 800 MB`);
      ok(errors.length === 0, `${label}: no page errors ${errors.slice(0, 3).join(' ')}`);
      await page.close();
    }
  } finally {
    await browser.close();
    server?.kill();
  }
  console.log(`\n${passes}/${passes + failures} terrain checks passed`);
  process.exit(failures ? 1 : 0);
})();
