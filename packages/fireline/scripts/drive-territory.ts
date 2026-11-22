/**
 * Territory and workforce (2026-11-21, setup.territory; src/sim/territory.ts, fireline-design.md).
 * Its sections run inside scripts/drive.ts and count in its totals.
 */
import { createHash } from 'node:crypto';
import { processAction } from '../src/sim/actions';
import { setAutopilotAi } from '../src/sim/ai';
import { placementProblem } from '../src/sim/commands';
import { createMissionState } from '../src/sim/mission';
import { missionContext, newCampaign } from '../src/campaign/progression';
import { MISSIONS } from '../src/campaign/missions';
import { CLAIM_RADIUS, DEFAULT_SETUP, HOUSING, LEGACY_SETUP, type Owner, type SkirmishSetup } from '../src/sim/rules';
import { addBuilding, addUnit, createInitialState, migrateState, normaliseSetup, techAllowed } from '../src/sim/state';
import { unitSpecOf } from '../src/sim/specs';
import { NO_OWNER, crewed, housed, staffed, territoryGrid, territoryOn, unstaffed } from '../src/sim/territory';
import type { GameState } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
const hash = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const ALL: Partial<SkirmishSetup> = { map: 'plains', tech: 'advanced', industry: true, supply: true, territory: true, credits: 20000 };
const fresh = (setup: Partial<SkirmishSetup> = ALL, seed = 'territory'): GameState => createInitialState(seed, seed, { seed, createdAt: 0, setup });

function quiet(fn: (ok: Ok) => void): (ok: Ok) => void {
  return ok => {
    for (const o of [1, 2, 3] as Owner[]) setAutopilotAi(() => {}, o);
    try {
      fn(ok);
    } finally {
      for (const o of [1, 2, 3] as Owner[]) setAutopilotAi(null, o);
    }
  };
}

/** Side 0's yard, and a tile `dx` tiles from its centre toward the middle of the map. */
function arena(seed = 'territory') {
  const s = fresh(ALL, seed);
  const hq = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
  const cx = hq.x + 1.5;
  const cy = hq.y + 1.5;
  const dir = hq.x < s.mapW / 2 ? 1 : -1;
  return { s, hq, cx, cy, dir, tile: (dx: number, dy = 0) => ({ x: Math.floor(cx + dir * dx), y: Math.floor(cy + dy) }) };
}

function setup(ok: Ok): void {
  ok(DEFAULT_SETUP.territory === false && LEGACY_SETUP.territory === false, 'both presets state territory: off');
  ok(normaliseSetup({}).territory === false, 'a setup saved before territory reads as off');
  ok(normaliseSetup({ industry: true, supply: true, territory: true }).territory === true, 'with industry and supply lines, territory: true is kept');
  ok(normaliseSetup({ industry: true, territory: true }).territory === false, 'without supply lines, territory is off whatever the setup says');
  const sup = fresh({ ...ALL, territory: false });
  ok(!territoryOn(sup) && !techAllowed(sup, 0, 'quarters') && !techAllowed(sup, 0, 'watchtower'), 'supply lines alone: no Quarters, no Watchtower');
  ok(sup.buildings.every(b => staffed(sup, b)) && unstaffed(sup, 0).length === 0, 'supply lines alone: everything works');
  const on = fresh();
  ok(territoryOn(on) && techAllowed(on, 0, 'quarters') && techAllowed(on, 1, 'watchtower'), 'territory on: Quarters and Watchtowers for every side');
  const c = newCampaign('T');
  const ms = createMissionState(MISSIONS[0], missionContext(c, MISSIONS[0], 'terr', 0));
  ms.setup = { ...normaliseSetup({}), industry: true, supply: true, territory: true };
  ok(!territoryOn(ms) && !techAllowed(ms, 0, 'quarters'), 'never in a mission, even with the flag forced on');
}

function borders(ok: Ok): void {
  const { s, cx, cy, tile } = arena();
  const grid = territoryGrid(s);
  const at = (p: { x: number; y: number }, g = grid) => g[p.x + p.y * s.mapW];
  const r = CLAIM_RADIUS.hq!;
  ok(at({ x: Math.floor(cx), y: Math.floor(cy) }) === 0, 'the yard stands on its own ground');
  ok(at(tile(r - 2)) === 0, `${r - 2} tiles out is still yours`);
  ok(at(tile(r + 2)) === NO_OWNER, `${r + 2} tiles out is nobody's`);
  // A Watchtower pushes the border out.
  const w = tile(r - 2);
  addBuilding(s, 0, 'watchtower', w.x, w.y);
  const g2 = territoryGrid(s);
  ok(g2 !== grid && at(tile(r + 4), g2) === 0, 'a Watchtower near the edge claims the ground beyond it');
  // Two sides' claims meeting: the nearer wins, a tie is nobody's.
  const t = copy(s);
  const far = tile(r + CLAIM_RADIUS.watchtower! + 6);
  addBuilding(t, 1, 'watchtower', far.x, far.y);
  const g3 = territoryGrid(t);
  const mid = { x: Math.floor((w.x + far.x) / 2), y: w.y };
  const dW = Math.abs(mid.x + 0.5 - (w.x + 0.5));
  const dF = Math.abs(mid.x + 0.5 - (far.x + 0.5));
  const expect = dW < dF ? 0 : dF < dW ? 1 : NO_OWNER;
  ok(g3[mid.x + mid.y * t.mapW] === expect, `where two Watchtowers' claims meet, the nearer wins (${g3[mid.x + mid.y * t.mapW]}, expected ${expect})`);
  ok(g3[far.x + far.y * t.mapW] === 1 && g3[w.x + w.y * t.mapW] === 0, "each tower's own tile is its side's");
  // A claim lost gives the ground up again.
  t.buildings = t.buildings.filter(b => !(b.owner === 0 && b.kind === 'watchtower'));
  ok(territoryGrid(t)[tile(r + 4).x + tile(r + 4).y * t.mapW] !== 0, 'with the Watchtower gone, the ground beyond the yard is no longer yours');
}

function placement(ok: Ok): void {
  const { s, tile } = arena('placing');
  const r = CLAIM_RADIUS.hq!;
  // Find a spot 7 to 9 tiles out (beyond the old build radius from the yard, inside the claim).
  let inside: { x: number; y: number } | null = null;
  for (let dx = 6; dx <= r - 3 && !inside; dx++)
    for (let dy = -3; dy <= 3 && !inside; dy++) {
      const p = tile(dx, dy);
      if (placementProblem(s, 0, 'quarters', p.x, p.y) === null) inside = p;
    }
  ok(!!inside, 'a spot well inside the borders, past the old build radius, is legal');
  let outside: { x: number; y: number } | null = null;
  for (let dx = r + 2; dx <= r + 8 && !outside; dx++) {
    const p = tile(dx);
    if (placementProblem(s, 0, 'quarters', p.x, p.y, undefined, { anywhere: true }) === null) outside = p;
  }
  ok(!!outside && placementProblem(s, 0, 'quarters', outside!.x, outside!.y) === 'Outside your territory', 'outside the borders: refused, and the refusal says why');
  const off = fresh({ ...ALL, territory: false }, 'placing');
  if (inside) ok(placementProblem(off, 0, 'quarters', inside.x, inside.y) !== null, 'without territory the same spot is outside the build radius, as before');
}

const workforce = quiet((ok: Ok): void => {
  const { s, tile } = arena('crew');
  ok(housed(s, 0) === HOUSING.hq, `the yard houses ${HOUSING.hq}`);
  const put = (kind: Parameters<typeof addBuilding>[2], dx: number, dy: number) => {
    const p = tile(dx, dy);
    return addBuilding(s, 0, kind, p.x, p.y);
  };
  const ref = put('refinery', 4, -6);
  const well = put('fuelwell', 4, 4);
  const foundry = put('foundry', -6, 4);
  const factory = put('factory', -6, -6);
  const barracks = put('barracks', 8, 0);
  // 3 + 2 + 3 + 4 = 12: everything up to the factory; the Barracks waits.
  const ok1 = crewed(s, 0);
  ok([ref, well, foundry, factory].every(b => ok1.has(b.id)) && !ok1.has(barracks.id), 'crews go out economy first: the Barracks is the one left without');
  ok(unstaffed(s, 0).map(b => b.id).join() === String(barracks.id), 'and it is the only one');
  // Production stops without a crew.
  s.players[0].queues.infantry.push({ kind: 'rifleman', progress: 0 });
  let x = s;
  for (let i = 0; i < 20; i++) x = processAction(x, { type: 'tick', n: 1 });
  ok(x.players[0].queues.infantry[0]?.progress === 0, 'a Barracks without its crew trains nothing');
  // Quarters house the rest.
  put('quarters', -2, 9);
  ok(housed(s, 0) === HOUSING.hq! + HOUSING.quarters! && unstaffed(s, 0).length === 0, 'Quarters: everything crewed');
  let y = s;
  for (let i = 0; i < 20; i++) y = processAction(y, { type: 'tick', n: 1 });
  ok((y.players[0].queues.infantry[0]?.progress ?? 1) > 0 || y.units.filter(u => u.owner === 0 && u.kind === 'rifleman').length > 3, 'and with its crew the Barracks trains again');
  // A refinery without its crew takes no ore: the hauler looks elsewhere. The Refinery is crewed
  // first, so to leave it without, take every house away (the yard and the Quarters).
  const t2 = copy(s);
  t2.buildings = t2.buildings.filter(b => !(b.owner === 0 && (b.kind === 'hq' || b.kind === 'quarters')));
  const r2 = t2.buildings.find(b => b.id === ref.id)!;
  ok(housed(t2, 0) === 0 && !staffed(t2, r2), 'with no housing at all, the Refinery has no crew');
  const h = addUnit(t2, 0, 'hauler', r2.x + 1.5, r2.y + 2.5);
  h.cargo = 200;
  h.order = { type: 'harvest', phase: 'unload', tile: -1, refinery: r2.id };
  const cr0 = t2.players[0].credits;
  let z = t2;
  for (let i = 0; i < 5; i++) z = processAction(z, { type: 'tick', n: 1 });
  const zh = z.units.find(u => u.id === h.id)!;
  ok(zh.cargo === 200 && z.players[0].credits <= cr0 && !(zh.order.type === 'harvest' && zh.order.phase === 'unload'), 'a Refinery without its crew takes no ore, and the hauler stops unloading there');
});

function battles(ok: Ok): void {
  const seeds = ['terr-a', 'terr-b', 'terr-c', 'terr-d'];
  let ended = 0;
  let quarters = 0;
  let idle = 0;
  let samples = 0;
  for (const [i, seed] of seeds.entries()) {
    let s = createInitialState(seed, seed, { seed, createdAt: 0, autopilot: true, difficulty: i % 2 ? 'hard' : 'normal', setup: { tech: 'advanced', industry: true, supply: true, territory: true, map: i < 2 ? 'classic' : 'plains' } });
    s.autopilotDifficulty = 'normal';
    let built = false;
    while (s.winner === null && s.tick < 30000) {
      s = processAction(s, { type: 'tick', n: 50 });
      if (s.buildings.some(b => b.kind === 'quarters')) built = true;
      for (const o of [0, 1] as Owner[]) {
        samples++;
        if (unstaffed(s, o).length) idle++;
      }
    }
    if (s.winner !== null || (!s.ore.some(o => o > 0) && !s.units.some(u => u.kind !== 'hauler' && unitSpecOf(s, u).weapon))) ended++;
    if (built) quarters++;
  }
  ok(quarters === seeds.length, `the commanders build Quarters in every battle (${quarters} of ${seeds.length})`);
  ok(idle / samples < 0.1, `they keep their structures crewed: something idle ${((100 * idle) / samples).toFixed(1)}% of the time, under 10%`);
  ok(ended === seeds.length, `every battle is decided inside 50 minutes, or ends mined out with no army left (${ended} of ${seeds.length})`);
}

function saves(ok: Ok): void {
  const play = (saveAt = -1) => {
    let s = createInitialState('tp', 'tp', { seed: 'tp', createdAt: 0, autopilot: true, setup: { tech: 'advanced', industry: true, supply: true, territory: true, map: 'classic' } });
    for (let i = 0; i < 120; i++) {
      s = processAction(s, { type: 'tick', n: 50 });
      if (i === saveAt) s = migrateState(JSON.parse(JSON.stringify(s)))!;
    }
    return s;
  };
  const a = play();
  ok(hash(a) === hash(play()) && hash(a) === hash(play(60)), 'a battle with territory replays byte-identically, and through a save mid-battle');
  ok(migrateState(copy(a))!.setup!.territory === true, 'a save keeps its territory setting');
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Territory: the setup', setup],
  ['Territory: borders, claims and where they meet', borders],
  ['Territory: building inside your borders', placement],
  ['Territory: workers, crews and what stops without one', workforce],
  ['Territory: whole computer battles', battles],
  ['Territory: replays and saves', saves],
];
