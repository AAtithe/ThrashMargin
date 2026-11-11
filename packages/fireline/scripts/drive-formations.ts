/**
 * Formations and squads (fireline-round6-design.md, workstream D). Its sections run inside
 * scripts/drive.ts and count in its totals. The groundwork's section covers what is declared before
 * D builds anything: squads in saves, and the reducer refusing what nothing handles yet. Workstream D
 * replaces the refusal assertions marked below once it handles them, and adds its own sections.
 */
import { createAsWritten } from './drive-factions';
import { processAction } from '../src/sim/actions';
import { FORMATION_SHAPES, SLOT_SPACING_DIAGONAL, type FormationShape, type UnitKind } from '../src/sim/rules';
import { addUnit, createInitialState, migrateState } from '../src/sim/state';
import type { GameAction, GameState, Squad, Unit } from '../src/sim/types';
import { facingOf, roleOf, slotsFor } from '../src/sim/formations';
import { nearestPassable, occupancy, passable } from '../src/sim/grid';

type Ok = (cond: unknown, what: string) => void;

const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

function groundwork(ok: Ok): void {
  ok(FORMATION_SHAPES.join() === 'line,column,wedge,box', 'four formation shapes');
  const s = createAsWritten('f', 'f', { seed: 'formations', createdAt: 0, setup: { tech: 'advanced' } });
  ok(s.squads === undefined && s.units.every(u => u.squad === undefined), 'a fresh battle has no squads');
  const ids = s.units.filter(u => u.owner === 0).map(u => u.id);
  const c = s.units.find(u => u.owner === 0)!;
  // A plain move is exactly as before.
  ok(processAction(s, { type: 'move', ids, x: c.x + 3, y: c.y }) !== s, 'a move without a formation is legal');
  // round6:D begin. Formations and squads: D replaces the two refusals below with its own tests.
  for (const shape of FORMATION_SHAPES) {
    const moved = processAction(s, { type: 'move', ids, x: c.x + 3, y: c.y, formation: shape });
    ok(moved !== s && moved.squads?.length === 1 && moved.squads[0].shape === shape, `a move in a ${shape} is legal and forms a squad`);
    const formed = processAction(s, { type: 'formation', ids, shape });
    ok(formed !== s && formed.squads?.length === 1 && formed.squads[0].shape === shape, `forming a ${shape} where they stand is legal and forms a squad`);
  }
  ok(processAction(s, { type: 'formation', ids, shape: 'none' }) === s, "'none' with no squad to leave is refused");
  // round6:D end.
  ok(processAction(s, { type: 'formation', ids, shape: 'moon' } as unknown as GameAction) === s, 'an unknown shape is refused');
  // Saves: well-formed squads kept, junk dropped, a unit's squad kept only when it names a kept squad.
  const raw = copy(s);
  const good: Squad = { id: 9001, leader: ids[0], shape: 'wedge', members: ids.slice() };
  raw.squads = [
    good,
    { id: 9002, leader: ids[1], shape: 'moon' as never, members: [ids[1]] },
    { id: 9003, leader: 77777, shape: 'box', members: [ids[1]] },
    { id: 9001, leader: ids[0], shape: 'line', members: [ids[0]] },
    null as never,
    { id: 'x' as never, leader: ids[0], shape: 'line', members: [ids[0]] },
  ];
  raw.units[0].squad = 9001;
  raw.units[1].squad = 9002;
  raw.units[2].squad = 'x' as never;
  const m = migrateState(raw)!;
  ok(!!m.squads && m.squads.length === 1 && JSON.stringify(m.squads[0]) === JSON.stringify(good), 'migrateState keeps the well-formed squad alone');
  ok(m.units[0].squad === 9001 && m.units[1].squad === undefined && m.units[2].squad === undefined, "a unit's squad is kept only when it names a kept squad");
  const junk = copy(s) as unknown as Record<string, unknown>;
  junk.squads = { a: 1 };
  ok(migrateState(junk)!.squads === undefined, 'squads that are not a list are dropped');
  ok(JSON.stringify(migrateState(copy(m))) === JSON.stringify(m), 'a state with squads passes migrateState unchanged');
  // The one copy an action makes copies the squads' member lists too.
  const withSquad = copy(m);
  const after = processAction(withSquad, { type: 'tick' });
  ok(after.squads !== withSquad.squads && after.squads![0].members !== withSquad.squads![0].members, 'cloneState copies squads one level deep');
  ok(JSON.stringify(after.squads) === JSON.stringify(withSquad.squads), 'and nothing changes them yet');
}

// ---- Workstream D: formations and squads ------------------------------------------------------

/** Forward, one step, for each facing (formations.ts's table, restated so the test checks it). */
const FWD: [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];
const dot = (a: [number, number], b: [number, number]) => a[0] * b[0] + a[1] * b[1];

function slotTables(ok: Ok): void {
  let bad = 0;
  let badWhat = '';
  const fail = (what: string) => {
    bad++;
    if (!badWhat) badWhat = what;
  };
  for (const shape of FORMATION_SHAPES)
    for (let n = 1; n <= 40; n++)
      for (let f = 0; f < 8; f++) {
        const a = slotsFor(shape, n, f);
        const b = slotsFor(shape, n, f);
        const tag = `${shape} of ${n} facing ${f}`;
        if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${tag}: not deterministic`);
        if (a.length !== n) fail(`${tag}: ${a.length} slots`);
        if (!a.every(([x, y]) => Number.isInteger(x) && Number.isInteger(y))) fail(`${tag}: not integers`);
        if (new Set(a.map(p => p.join())).size !== n) fail(`${tag}: a slot repeated`);
        // Slot 0 (the leader's) is in the front rank.
        const front = Math.max(...a.map(p => dot(p, FWD[f])));
        if (dot(a[0], FWD[f]) !== front) fail(`${tag}: slot 0 not at the front`);
        // A quarter turn of the facing is a quarter turn of the table: (x, y) to (-y, x).
        const turned = slotsFor(shape, n, (f + 2) % 8);
        if (JSON.stringify(turned) !== JSON.stringify(a.map(([x, y]) => [-y + 0, x + 0]))) fail(`${tag}: not turned with the facing`);
        // Centred: the middle of the table is within a tile of the anchor, across and along.
        const mx = a.reduce((s, p) => s + p[0], 0) / n;
        const my = a.reduce((s, p) => s + p[1], 0) / n;
        const lim = f % 2 ? 1.01 : 0.51;
        if (Math.abs(mx) > lim + 0.5 || Math.abs(my) > lim + 0.5) fail(`${tag}: not centred (${mx}, ${my})`);
      }
  ok(bad === 0, `every slot table deterministic, whole, unrepeated, led from the front, turned and centred${bad ? `: ${bad} failures, first ${badWhat}` : ''}`);
  // The shapes themselves, facing north.
  const line = slotsFor('line', 7, 0);
  ok(line.every(p => p[1] === 0), 'a line of seven is one rank');
  ok(new Set(slotsFor('line', 25, 0).map(p => p[1])).size === 3, 'a line of 25 is three ranks');
  ok(new Set(slotsFor('column', 9, 0).map(p => p[0])).size === 2 && new Set(slotsFor('column', 4, 0).map(p => p[0])).size === 1, 'a column is one file up to four, then two');
  const wedge = slotsFor('wedge', 6, 0);
  ok(wedge.slice(1).every(p => p[1] > wedge[0][1]) && wedge[1][1] === wedge[2][1] && wedge[1][0] === -wedge[2][0], 'a wedge has one tip and its arms behind it, either side');
  const box = slotsFor('box', 9, 0);
  ok(box[8][0] === 0 && box[8][1] === 0 && box.slice(0, 8).every(p => p[0] !== 0 || p[1] !== 0), 'a box of nine keeps its middle slot for last');
  // Facing: eight directions, by integer comparison, whatever the length.
  for (let d = 0; d < 8; d++)
    for (const k of [0.25, 1, 7, 33.5]) ok(facingOf(FWD[d][0] * k, FWD[d][1] * k) === d, `facing ${d} at length ${k}`);
  // Twenty degrees either side of each of the eight still reads as it (rotations of (10, 3.6)).
  for (let d = 0; d < 8; d++) {
    const [fx, fy] = FWD[d];
    const len = Math.hypot(fx, fy);
    const ux = fx / len;
    const uy = fy / len;
    const off = 0.364; // tan 20 degrees
    ok(facingOf(ux - uy * off, uy + ux * off) === d && facingOf(ux + uy * off, uy - ux * off) === d, `facing ${d} within 20 degrees`);
  }
  ok(facingOf(10, 4) === 2 && facingOf(10, 5) === 3 && facingOf(-4, -10) === 0 && facingOf(-5, -10) === 7, 'the 22.5 degree boundaries');
  ok(facingOf(0, 0, 5) === 5 && facingOf(0.01, -0.01, 6) === 6, 'no direction: the fallback');
}

/** A fresh advanced battle with a mixed group of ours on open ground near the Command Yard. */
function squadBattle(kinds: UnitKind[] = ['buggy', 'buggy', 'tank', 'tank', 'artillery', 'rifleman', 'rifleman', 'rifleman', 'medic', 'repairtruck']): { s: GameState; ids: number[] } {
  const s = createAsWritten('formations', 'formations', { seed: 'formations', createdAt: 0, setup: { tech: 'advanced' } });
  // Near the middle of the map, each on the nearest open tile not already taken.
  const occ = occupancy(s);
  const W = s.mapW;
  const ids = kinds.map((k, i) => {
    const t = nearestPassable(s, occ, W / 2 - 1.5 + (i % 4), s.mapH / 2 - 1 + Math.floor(i / 4), 8);
    occ[t] = -1;
    return addUnit(s, 0, k, (t % W) + 0.5, Math.floor(t / W) + 0.5).id;
  });
  return { s, ids };
}

const ours = (s: GameState, ids: number[]): Unit[] => s.units.filter(u => ids.includes(u.id));
const goalOf = (u: Unit): [number, number] => (u.order.type === 'move' || u.order.type === 'attackMove' ? [u.order.x, u.order.y] : [u.x, u.y]);

function shapedMoves(ok: Ok): void {
  const { s, ids } = squadBattle();
  const start = ours(s, ids);
  const cx = start.reduce((a, u) => a + u.x, 0) / start.length;
  const cy = start.reduce((a, u) => a + u.y, 0) / start.length;
  for (const shape of FORMATION_SHAPES)
    for (let d = 0; d < 8; d++) {
      const x = cx + FWD[d][0] * 14;
      const y = cy + FWD[d][1] * 14;
      const t = processAction(s, { type: 'move', ids, x, y, formation: shape, attackMove: true });
      const tag = `${shape} toward ${d}`;
      const us = ours(t, ids);
      const occ = occupancy(t);
      const goals = us.map(goalOf);
      ok(goals.every(([gx, gy]) => passable(t, occ, Math.floor(gx), Math.floor(gy))), `${tag}: every slot on passable ground`);
      ok(new Set(goals.map(([gx, gy]) => `${Math.floor(gx)},${Math.floor(gy)}`)).size === goals.length, `${tag}: no two units sent to one tile`);
      const q = t.squads?.[0];
      ok(t.squads?.length === 1 && q!.shape === shape && q!.members.length === ids.length && us.every(u => u.squad === q!.id), `${tag}: one squad of all ten`);
      ok(q?.facing === d, `${tag}: the squad faces the way it was sent`);
      // The role order: armour before infantry before the Medic and Repair Truck before artillery
      // (in a box, the Medic and Repair Truck last, so inside).
      const rank = (u: Unit) => (shape === 'box' ? [0, 1, 3, 2] : [0, 1, 2, 3])[roleOf(t, u)];
      const byRole = us.slice().sort((a, b) => rank(a) - rank(b) || a.id - b.id);
      const order = q!.members;
      ok(JSON.stringify(order) === JSON.stringify(byRole.map(u => u.id)), `${tag}: slots handed out by role, then id`);
      ok(q!.leader === order[0] && ['tank', 'buggy'].includes(t.units.find(u => u.id === q!.leader)!.kind), `${tag}: an armoured leader`);
      const fwd = (u: Unit) => dot([u.slotX!, u.slotY!], FWD[d]);
      const tank = Math.max(...us.filter(u => u.kind === 'tank').map(fwd));
      const art = Math.min(...us.filter(u => u.kind === 'artillery').map(fwd));
      if (shape !== 'line') ok(tank > art, `${tag}: armour ahead of the artillery`);
      if (shape === 'box') {
        const medic = us.find(u => u.kind === 'medic')!;
        const xs = us.map(u => u.slotX!);
        const ys = us.map(u => u.slotY!);
        ok(medic.slotX! > Math.min(...xs) && medic.slotX! < Math.max(...xs) && medic.slotY! > Math.min(...ys) && medic.slotY! < Math.max(...ys), `${tag}: the Medic inside the box`);
      }
      const scale = d % 2 ? SLOT_SPACING_DIAGONAL : 1;
      ok(us.every(u => Math.abs(u.slotX! / scale - Math.round(u.slotX! / scale)) < 1e-9), `${tag}: slots are the integer table, scaled`);
    }
  // Forming up where they stand: around their middle, every unit in the squad.
  const f = processAction(s, { type: 'formation', ids, shape: 'box' });
  const q = f.squads![0];
  ok(Math.abs(q.x! - cx) < 1e-9 && Math.abs(q.y! - cy) < 1e-9 && q.attack === false, "forming up anchors the squad at the group's middle");
  ok(ours(f, ids).every(u => u.order.type === 'move'), 'and walks each unit to its slot');
}

/** Ticks until each of these units first stands within 0.6 tiles of where it was sent. */
function arrivals(s0: GameState, ids: number[], limit = 3000): Map<number, number> {
  let s = s0;
  const goal = new Map(ours(s, ids).map(u => [u.id, goalOf(u)]));
  const at = new Map<number, number>();
  for (let t = 0; t < limit && at.size < ids.length; t++) {
    s = processAction(s, { type: 'tick' });
    for (const u of ours(s, ids)) {
      const g = goal.get(u.id)!;
      if (!at.has(u.id) && Math.hypot(u.x - g[0], u.y - g[1]) < 0.6) at.set(u.id, s.tick);
    }
  }
  return at;
}

function keepingPace(ok: Ok): void {
  const { s, ids } = squadBattle();
  // Toward our Command Yard, about 25 tiles from the middle.
  const hq = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
  const x = hq.x + 6;
  const y = hq.y - 6;
  const spiral = arrivals(processAction(s, { type: 'move', ids, x, y }), ids);
  const sv = [...spiral.values()];
  const spiralSpread = Math.max(...sv) - Math.min(...sv);
  ok(spiral.size === ids.length, 'the plain move: all ten arrive');
  for (const shape of FORMATION_SHAPES) {
    const t = processAction(s, { type: 'move', ids, x, y, formation: shape });
    ok(t.squads![0].pace === 0.065, `${shape}: the squad's pace is its slowest member's (the infantry, 0.065)`);
    const at = arrivals(t, ids);
    const v = [...at.values()];
    const spread = Math.max(...v) - Math.min(...v);
    const slowest = Math.max(...ours(s, ids).filter(u => u.kind === 'rifleman').map(u => at.get(u.id) ?? Infinity));
    // A line is ten wide: its flanks walk round more of the ground, so it gets longer.
    const n = shape === 'line' ? 120 : 50;
    ok(at.size === ids.length, `${shape}: all ten arrive`);
    ok(spread <= n, `${shape}: every member arrives within ${n} ticks of the others (${spread}; the plain move spreads ${spiralSpread})`);
    ok(Math.max(...v) - slowest <= n && slowest - Math.min(...v) <= n, `${shape}: and within ${n} of its slowest member`);
    const buggy = Math.min(...ours(s, ids).filter(u => u.kind === 'buggy').map(u => at.get(u.id)!));
    const lone = Math.min(...ours(s, ids).filter(u => u.kind === 'buggy').map(u => spiral.get(u.id)!));
    ok(buggy > lone + 100, `${shape}: the buggies keep to the squad's pace (${buggy} against ${lone} alone)`);
  }
  ok(spiralSpread > 100, `without a formation the buggies run ahead (${spiralSpread} ticks between first and last)`);
}

function run(s0: GameState, actions: GameAction[]): GameState {
  let s = s0;
  for (const a of actions) s = processAction(s, a);
  return s;
}

function squadLife(ok: Ok): void {
  const { s, ids } = squadBattle();
  const hq = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
  const x = hq.x + 6;
  const y = hq.y - 6;
  const plan: GameAction[] = [{ type: 'move', ids, x, y, formation: 'wedge', attackMove: true }];
  for (let i = 0; i < 12; i++) plan.push({ type: 'tick', n: 25 });
  const a = run(s, plan);
  const b = run(s, plan);
  ok(JSON.stringify(a) === JSON.stringify(b), 'a squad on the march replays byte-identically');
  // Saved half way and loaded, it carries on exactly as if never saved.
  const half = run(s, plan.slice(0, 7));
  const resumed = run(migrateState(copy(half))!, plan.slice(7));
  ok(JSON.stringify(resumed) === JSON.stringify(a), 'saved and loaded on the march, it carries on exactly');
  ok(JSON.stringify(migrateState(copy(a))) === JSON.stringify(a), 'a state with a marching squad passes migrateState unchanged');
  const q = a.squads![0];
  ok(a.squads!.length === 1 && q.members.length === ids.length && q.pace === 0.065, 'the squad is whole after 300 ticks');
  // A plain move of exactly the squad keeps its shape.
  const again = processAction(a, { type: 'move', ids, x: x - 6, y });
  ok(again.squads?.length === 1 && again.squads[0].shape === 'wedge' && again.squads[0].members.length === ids.length, 'a plain move of the whole squad keeps the wedge');
  // A plain move of some of it takes those out; the rest stay a squad.
  const some = ids.slice(0, 3);
  const split = processAction(a, { type: 'move', ids: some, x: x - 6, y });
  ok(ours(split, some).every(u => u.squad === undefined && u.slotX === undefined) && split.squads?.[0].members.length === ids.length - 3, 'a plain move of three takes those three out');
  ok(split.squads?.[0].members.includes(split.squads[0].leader), 'and the rest keep a leader');
  // Down to one member, a squad is gone.
  const pair = ids.slice(5, 7);
  const two = processAction(s, { type: 'move', ids: pair, x, y, formation: 'column' });
  const one = processAction(two, { type: 'move', ids: [pair[0]], x: x - 3, y });
  ok(two.squads?.length === 1 && one.squads === undefined && ours(one, pair).every(u => u.squad === undefined), 'a squad down to one member is dissolved');
  // 'none' leaves the squad and keeps the orders.
  const none = processAction(a, { type: 'formation', ids, shape: 'none' });
  ok(none !== a && none.squads === undefined && ours(none, ids).every(u => u.squad === undefined && u.slotX === undefined), "'none' dissolves the squad");
  ok(JSON.stringify(ours(none, ids).map(u => u.order)) === JSON.stringify(ours(a, ids).map(u => u.order)), "'none' leaves every order as it was");
  // Another order (an attack, a stop) takes a member out at the leader's next refresh.
  const enemy = a.units.find(u => u.owner !== 0) ?? null;
  const target = enemy?.id ?? a.buildings.find(b => b.owner !== 0)!.id;
  const tankId = ours(a, ids).find(u => u.kind === 'tank' && u.id !== q.leader)!.id;
  const attacked = run(a, [{ type: 'attack', ids: [tankId], target }, { type: 'tick', n: 20 }]);
  ok(attacked.units.find(u => u.id === tankId)!.squad === undefined && !attacked.squads![0].members.includes(tankId), 'a member given an attack order leaves at the next refresh');
  // A fallen leader: the next member leads, at once on the march and when a save is loaded.
  const k = copy(a);
  const lead = k.squads![0].leader;
  k.units = k.units.filter(u => u.id !== lead);
  const m = migrateState(copy(k))!;
  ok(m.squads![0].leader !== lead && m.squads![0].members.length === ids.length - 1 && !m.squads![0].members.includes(lead), 'migrateState drops a fallen member and re-picks a fallen leader');
  const marched = run(k, [{ type: 'tick', n: 30 }]);
  ok(marched.squads?.[0].leader !== lead && marched.squads![0].members.length === ids.length - 1, 'on the march, a fallen leader is replaced');
  // Junk in the squad's own fields is dropped on load; a slot without a squad too.
  const junk = copy(a);
  Object.assign(junk.squads![0], { facing: 9, x: 'x', pace: -1, attack: 'yes' });
  junk.units.find(u => u.squad === undefined)!.slotX = 3;
  const jm = migrateState(junk)!;
  const jq = jm.squads![0];
  ok(jq.facing === undefined && jq.x === undefined && jq.pace === undefined && jq.attack === undefined && jq.y === q.y, "migrateState drops a squad's malformed fields only");
  ok(jm.units.every(u => u.slotX === undefined || u.squad !== undefined), 'and a slot outside any squad');
  const lone = copy(a);
  lone.units = lone.units.filter(u => u.id === q.leader || !q.members.includes(u.id));
  const lm = migrateState(lone)!;
  ok(lm.squads === undefined && lm.units.every(u => u.squad === undefined), 'a saved squad of one is dissolved on load');
  // A queued move in a formation queues each slot and leaves squads alone.
  const queued = processAction(a, { type: 'move', ids, x: x + 4, y, formation: 'line', queue: true });
  ok(queued !== a && JSON.stringify(queued.squads) === JSON.stringify(a.squads) && ours(queued, ids).some(u => u.queue.length === 1), 'a queued move in a line queues and keeps the squad');
}

function refusals(ok: Ok): void {
  const { s, ids } = squadBattle();
  const x = s.mapW / 2;
  const y = s.mapH / 2;
  const bad = (a: unknown, what: string) => ok(processAction(s, a as GameAction) === s, what);
  bad({ type: 'move', ids, x, y, formation: 'moon' }, 'a move in an unknown shape is refused (the same state)');
  bad({ type: 'move', ids, x, y, formation: 7 }, 'a move with a numeric shape is refused');
  bad({ type: 'move', ids, x, y, formation: null }, 'a move with a null shape is refused');
  bad({ type: 'move', ids, x: -5, y, formation: 'line' }, 'a move in a line off the map is refused');
  bad({ type: 'move', ids: [], x, y, formation: 'line' }, 'a move in a line with nobody is refused');
  bad({ type: 'formation', ids, shape: 'moon' }, 'forming an unknown shape is refused');
  bad({ type: 'formation', ids, shape: undefined }, 'forming no shape is refused');
  bad({ type: 'formation', ids: ids.slice(0, 1), shape: 'box' }, 'forming one unit is refused');
  const theirs = s.units.filter(u => u.owner !== 0).map(u => u.id);
  bad({ type: 'formation', ids: theirs, shape: 'box' }, "forming the enemy's units is refused");
  bad({ type: 'formation', ids, shape: 'none' }, "'none' with no squad is refused");
  bad({ type: 'formation', ids: 'all', shape: 'box' }, 'forming with junk ids is refused');
}

function computerFormations(ok: Ok): void {
  // Two computer sides for 30 game minutes; whether squads ever appear, whose, and in what shape.
  const watch = (tech: 'advanced' | 'standard') => {
    let s = createAsWritten(`f-${tech}`, 'f', { seed: 'formations-ai', difficulty: 'normal', createdAt: 0, autopilot: true, setup: { tech } });
    const shapes = new Set<FormationShape>();
    let wrong = 0;
    for (let i = 0; i < 180 && s.winner === null; i++) {
      s = processAction(s, { type: 'tick', n: 100 });
      for (const q of s.squads ?? []) {
        shapes.add(q.shape);
        const owners = new Set(q.members.map(id => s.units.find(u => u.id === id)?.owner));
        if (owners.size > 1) wrong++;
      }
    }
    return { shapes, wrong };
  };
  const adv = watch('advanced');
  ok(adv.shapes.has('wedge'), `on advanced tech the computer's waves attack in a wedge (seen: ${[...adv.shapes].join(', ') || 'none'})`);
  ok(adv.wrong === 0, "every computer squad is one side's");
  const std = watch('standard');
  ok(std.shapes.size === 0, 'on standard tech the computer never forms up');
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Round 6 groundwork: squads and formation orders', groundwork],
  // round6:D begin. Formations and squads: its sections, appended here.
  ['Formations: slot tables and facing', slotTables],
  ['Formations: moving in a shape', shapedMoves],
  ['Formations: keeping pace', keepingPace],
  ['Formations: squads, saves and replays', squadLife],
  ['Formations: refusals', refusals],
  ['Formations: the computer forms up on advanced tech only', computerFormations],
  // round6:D end.
];
