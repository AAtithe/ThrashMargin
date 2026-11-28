/**
 * Grand War, phase G0 (fireline-grand-war-design.md): the foundations a multi-hour four-sided
 * Continental game needs. Its sections run inside scripts/drive.ts; the long-battle save is deep-only
 * (DEEP_SECTIONS).
 *
 *  - Saves as tables (src/sim/pack.ts, `packRows`): units, structures and the adaptive commanders'
 *    memory, exact both ways, malformed tables refused, older packed saves still loading.
 */
import { processAction } from '../src/sim/actions';
import { packRows, packState, TABLES_V1, unpackRows } from '../src/sim/pack';
import { createInitialState, migrateState } from '../src/sim/state';
import type { GameState } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;
const json = (x: unknown): string => JSON.stringify(x);
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** A four-sided Continental battle with the full economy: what a Grand War will be built on. */
export const grandBattle = (seed: string, sides: 2 | 3 | 4 = 4): GameState =>
  createInitialState(`grand-${seed}`, seed, {
    seed,
    difficulty: 'normal',
    createdAt: 0,
    autopilot: true,
    setup: {
      map: 'random', tech: 'advanced', sides, mode: 'ffa', size: 'continental', research: 'lines', pace: 'long',
      sites: true, industry: true, supply: true, territory: true, production: true, upkeep: true, seasons: true,
    },
  });

function rowsTests(ok: Ok): void {
  const objs = [
    { id: 1, order: { type: 'idle' }, path: [], hp: 60 },
    { id: 2, order: { type: 'idle' }, path: [], hp: 60 },
    { id: 3, order: { type: 'move', x: 4 }, path: [5, 6], hp: 12.345678901234567 },
    { id: 4, hp: 60, order: { type: 'idle' }, path: [] },
    { id: 5, order: { type: 'idle' }, gone: undefined, path: [], hp: 60 },
    { id: 6, order: null, path: [], hp: -0.5, ty: 1e-323 },
  ];
  const t = packRows(objs);
  const back = unpackRows(copy(t));
  ok(back !== null && json(back) === json(objs), 'a table gives back every object, every value and the key order');
  ok(t.k.length === 3, `one shape per distinct key order (${t.k.length})`);
  ok(back !== null && !('gone' in back[4]), 'a key holding undefined is left out, as JSON leaves it out');
  ok(back !== null && back[0].order !== back[1].order && back[0].path !== back[1].path, 'defaults come back as fresh copies, never shared between rows');
  ok(json(t).length < json(objs).length, `smaller than the list (${json(t).length} against ${json(objs).length} bytes)`);
  ok(json(unpackRows(packRows([]))) === '[]', 'an empty list round-trips');
  const wide = [Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, i]))];
  ok(json(unpackRows(copy(packRows(wide)))) === json(wide), 'an object wider than a mask holds is kept whole');
  const good = copy(t);
  ok(unpackRows(null) === null && unpackRows({ k: [], r: [] }) === null, 'a table without its parts is refused');
  ok(unpackRows({ ...good, r: [[9, 0]] }) === null, 'a row naming no shape is refused');
  ok(unpackRows({ ...good, r: [[0, 1]] }) === null, 'a row with fewer values than its mask is refused');
  ok(unpackRows({ ...good, r: [[0, 0, 7]] }) === null, 'a row with more values than its mask is refused');
  ok(unpackRows({ ...good, r: [[0, 2 ** 20]] }) === null, 'a mask beyond its shape is refused');
  ok(unpackRows({ ...good, k: [[1]] }) === null, 'a key that is not text is refused');
}

function saveTests(ok: Ok): void {
  let s = grandBattle('g0-save');
  while (s.tick < 600 * 4) s = processAction(s, { type: 'tick', n: 50 });
  const packed = copy(packState(s)) as Record<string, unknown>;
  ok(packed.tables === TABLES_V1 && !Array.isArray(packed.units) && !Array.isArray(packed.buildings), 'a packed save keeps units and structures as tables');
  const back = migrateState(copy(packed));
  ok(back !== null && json(back) === json(migrateState(copy(s))), 'it loads to exactly the battle');
  const old = { ...copy(packed), units: copy(s.units), buildings: copy(s.buildings), ai: copy(s.ai) } as Record<string, unknown>;
  delete old.tables;
  const oldBack = migrateState(old);
  ok(oldBack !== null && json(oldBack) === json(migrateState(copy(s))), 'a packed save from before tables loads exactly as it did');
  ok(migrateState({ ...copy(packed), tables: 2 }) === null, 'a tables version this build does not know is refused');
  ok(migrateState({ ...copy(packed), units: { k: [], d: [], r: [[0, 0]] } }) === null, 'a save whose unit table is malformed is refused, not loaded half-made');
  let a = migrateState(copy(s))!;
  let b = back!;
  for (let i = 0; i < 24; i++) {
    a = processAction(a, { type: 'tick', n: 50 });
    b = processAction(b, { type: 'tick', n: 50 });
  }
  ok(json(a) === json(b), 'two minutes on, the battle loaded from tables is the battle itself');
}

/** Deep: thirty minutes of a four-sided Continental battle with the full economy. */
function longSaveTests(ok: Ok): void {
  let s = grandBattle('g0-long');
  let worst = 0;
  let worstAt = 0;
  while (s.winner === null && s.tick < 600 * 30) {
    s = processAction(s, { type: 'tick', n: 50 });
    if (s.tick % 3000 === 0) {
      const p = json(packState(s));
      if (p.length > worst) {
        worst = p.length;
        worstAt = s.tick;
      }
      const back = migrateState(JSON.parse(p));
      ok(back !== null && json(back) === json(migrateState(copy(s))), `minute ${s.tick / 600}: the packed save loads to exactly the battle`);
    }
  }
  const raw = json(s).length;
  ok(worst < 150 * 1024, `the largest save in thirty minutes is ${(worst / 1024).toFixed(0)} KB (minute ${worstAt / 600}); the battle unpacked is ${(raw / 1024).toFixed(0)} KB at the end`);
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Grand War G0: tables', rowsTests],
  ['Grand War G0: saves as tables', saveTests],
  ['Grand War G0: a long battle saved', longSaveTests],
];
