/**
 * Fireline's test harness: whole battles, computer against computer, over many seeds, with the
 * invariants checked as they play, plus every order the player can give, legal and illegal.
 *
 *   npm run drive                 20 seeds on Normal, plus Easy and Hard samples
 *   npm run drive -- --seeds 60   a wider sweep
 *
 * What it proves: the reducer never mutates its input, an illegal action returns the same state
 * object, a seed replays byte-identically, and the economy, combat and AI produce a finished
 * battle rather than a stalemate.
 */
import { processAction } from '../src/sim/actions';
import { placementProblem } from '../src/sim/commands';
import { occupancy } from '../src/sim/grid';
import { isWalkable } from '../src/sim/map';
import {
  BUILDINGS,
  MAP_H,
  MAP_W,
  ORDER_QUEUE_MAX,
  UNITS,
  VET_KILLS,
  survivorsFor,
  vetFor,
  type BuildingKind,
  type Difficulty,
  type Owner,
  type UnitKind,
} from '../src/sim/rules';
import { addBuilding, addUnit, createInitialState, migrateState, powerOf, readyStructure } from '../src/sim/state';
import type { GameAction, GameState, Unit } from '../src/sim/types';

let assertions = 0;
let failures = 0;
function ok(cond: unknown, what: string): void {
  assertions++;
  if (!cond) {
    failures++;
    if (failures <= 40) console.error(`  FAIL: ${what}`);
  }
}

const args = process.argv.slice(2);
const seedArg = args.indexOf('--seeds');
const SEEDS = seedArg >= 0 ? Number(args[seedArg + 1]) : 20;
const TICK_CAP = 45000;

function invariants(s: GameState, label: string): void {
  const ids = new Set<number>();
  for (const u of s.units) {
    ok(!ids.has(u.id), `${label}: unit id ${u.id} unique`);
    ids.add(u.id);
    ok(u.hp > 0 && u.hp <= UNITS[u.kind].hp, `${label}: unit ${u.id} hp in range (${u.hp})`);
    ok(u.x >= 0 && u.y >= 0 && u.x < MAP_W && u.y < MAP_H, `${label}: unit ${u.id} on the map`);
    const k = Math.floor(u.y) * MAP_W + Math.floor(u.x);
    ok(isWalkable(s.tiles[k]), `${label}: unit ${u.id} on walkable ground`);
    ok(u.cargo >= 0 && u.cargo <= 600, `${label}: cargo in range`);
    ok(Number.isFinite(u.fx) && Number.isFinite(u.tx), `${label}: facings finite`);
    ok(u.vet === vetFor(u.kills), `${label}: unit ${u.id} rank matches its ${u.kills} kills (${u.vet})`);
    ok(Array.isArray(u.queue) && u.queue.length <= ORDER_QUEUE_MAX, `${label}: unit ${u.id} order queue capped`);
    ok(u.stance === 'guard' || u.stance === 'aggressive' || u.stance === 'hold', `${label}: unit ${u.id} stance valid`);
  }
  const occ = occupancy(s);
  for (const u of s.units) {
    const k = Math.floor(u.y) * MAP_W + Math.floor(u.x);
    ok(occ[k] === 0, `${label}: unit ${u.id} (${u.kind}) not inside a structure`);
  }
  for (const b of s.buildings) {
    ok(!ids.has(b.id), `${label}: building id ${b.id} unique`);
    ids.add(b.id);
    ok(b.hp > 0 && b.hp <= BUILDINGS[b.kind].hp, `${label}: building ${b.id} hp in range`);
  }
  for (const p of s.players) {
    ok(p.credits >= 0, `${label}: ${p.name} credits never negative (${p.credits})`);
    ok(p.queues.building.length <= 1, `${label}: one structure at a time`);
    ok(p.queues.infantry.length <= 5 && p.queues.vehicle.length <= 5, `${label}: queues capped`);
  }
  ok(s.ore.every(o => o >= 0 && o <= 500), `${label}: ore in range`);
  ok(s.explored.length === MAP_W * MAP_H, `${label}: explored map intact`);
  ok(ids.size < s.nextId, `${label}: ids below nextId`);
}

/** Point symmetry: tile k and its partner are the same terrain with the same ore. */
function symmetric(s: GameState): boolean {
  const n = MAP_W * MAP_H;
  for (let k = 0; k < n; k++) if (s.tiles[k] !== s.tiles[n - 1 - k] || s.ore[k] !== s.ore[n - 1 - k]) return false;
  return true;
}

/** Across all battles: ranks standing at the end, and riflemen that walked out of fallen structures. */
const seen = { veterans: 0, elites: 0, survivors: 0 };

function battle(seed: string, difficulty: Difficulty): GameState {
  let s = createInitialState(`drive-${seed}`, seed, { seed, difficulty, createdAt: 0, autopilot: true });
  ok(symmetric(s), `${seed}: map is point-symmetric`);
  ok(s.buildings.length === 2 && s.units.length === 6, `${seed}: each side starts with a yard and three riflemen`);
  invariants(s, `${seed}@0`);
  let n = 0;
  while (s.winner === null && s.tick < TICK_CAP) {
    const before = n % 15 === 0 ? JSON.stringify(s) : null;
    const nextS = processAction(s, { type: 'tick', n: 50 });
    if (before) ok(JSON.stringify(s) === before, `${seed}: tick did not mutate its input`);
    ok(nextS !== s, `${seed}: a legal tick returns a new state`);
    // New riflemen that no barracks trained are survivors.
    const trained = s.players[0].stats.trained + s.players[1].stats.trained;
    const trainedNext = nextS.players[0].stats.trained + nextS.players[1].stats.trained;
    const known = new Set(s.units.map(u => u.id));
    const fresh = nextS.units.filter(u => !known.has(u.id)).length;
    const haulers = nextS.units.filter(u => !known.has(u.id) && u.kind === 'hauler').length;
    if (fresh > trainedNext - trained + haulers) seen.survivors += fresh - (trainedNext - trained) - haulers;
    s = nextS;
    n++;
    if (s.tick % 1000 === 0) invariants(s, `${seed}@${s.tick}`);
  }
  invariants(s, `${seed}@end`);
  return s;
}

function orders(): void {
  let s = createInitialState('orders', 'orders', { seed: 'orders', createdAt: 0 });
  const same = (a: GameAction, what: string) => ok(processAction(s, a) === s, `rejected: ${what}`);

  // Illegal orders all return the same object.
  same({ type: 'queue', category: 'building', kind: 'factory' }, 'factory before a refinery');
  same({ type: 'queue', category: 'building', kind: 'hq' }, 'a second Command Yard');
  same({ type: 'queue', category: 'infantry', kind: 'rifleman' }, 'infantry with no barracks');
  same({ type: 'queue', category: 'vehicle', kind: 'power' as never }, 'a structure in the vehicle queue');
  same({ type: 'queue', category: 'building', kind: 'nonsense' as never }, 'an unknown kind');
  same({ type: 'place', kind: 'power', x: 10, y: 50 }, 'placing something not yet built');
  same({ type: 'cancel', category: 'building', kind: 'power' }, 'cancelling an empty queue');
  const enemyUnit = s.units.find(u => u.owner === 1)!;
  const myUnit = s.units.find(u => u.owner === 0)!;
  same({ type: 'move', ids: [enemyUnit.id], x: 30, y: 30 }, 'moving an enemy unit');
  same({ type: 'move', ids: [myUnit.id], x: -4, y: 30 }, 'moving off the map');
  same({ type: 'move', ids: [myUnit.id], x: NaN, y: 30 }, 'moving to NaN');
  same({ type: 'attack', ids: [myUnit.id], target: myUnit.id }, 'attacking your own unit');
  same({ type: 'harvest', ids: [myUnit.id] }, 'harvesting with a rifleman');
  same({ type: 'sell', id: s.buildings.find(b => b.owner === 1)!.id }, 'selling an enemy structure');
  same({ type: 'rally', id: s.buildings.find(b => b.owner === 0)!.id, x: 20, y: 20 }, 'rallying a Command Yard');
  same({ type: 'tick', n: 0 }, 'a zero tick');
  same({ type: 'tick', n: 100000 }, 'an enormous tick');
  same({ type: 'nope' } as never, 'an unknown action');

  // Queue and cancel: paid up front, refunded in full.
  const credits = s.players[0].credits;
  const queued = processAction(s, { type: 'queue', category: 'building', kind: 'power' });
  ok(queued !== s && queued.players[0].credits === credits - 300, 'queueing a Generator charges 300');
  ok(s.players[0].credits === credits, 'the input state kept its credits');
  const cancelled = processAction(queued, { type: 'cancel', category: 'building', kind: 'power' });
  ok(cancelled.players[0].credits === credits && cancelled.players[0].queues.building.length === 0, 'cancelling refunds it');
  ok(processAction(queued, { type: 'queue', category: 'building', kind: 'power' }) === queued, 'one structure at a time');

  // Build it, then place it next to the yard.
  s = queued;
  while (!readyStructure(s, 0)) s = processAction(s, { type: 'tick', n: 10 });
  ok(readyStructure(s, 0) === 'power', 'the Generator finishes');
  const spot = findSpot(s, 'power');
  ok(!!spot, 'somewhere to put it');
  ok(processAction(s, { type: 'place', kind: 'power', x: 60, y: 60 }) === s, 'rejected: placing far from the base');
  const water = s.tiles.indexOf('w');
  if (water >= 0) ok(placementProblem(s, 0, 'power', water % MAP_W, (water / MAP_W) | 0) !== null, 'water is not buildable');
  const before = powerOf(s, 0).made;
  s = processAction(s, { type: 'place', kind: 'power', x: spot!.x, y: spot!.y });
  ok(powerOf(s, 0).made === before + 100, 'the Generator adds 100 power');
  ok(s.players[0].queues.building.length === 0, 'placing empties the structure queue');

  // A refinery arrives with a hauler that starts work on its own.
  s = processAction(s, { type: 'queue', category: 'building', kind: 'refinery' });
  while (!readyStructure(s, 0)) s = processAction(s, { type: 'tick', n: 10 });
  const rspot = findSpot(s, 'refinery');
  ok(!!rspot, 'somewhere for the refinery');
  const units = s.units.length;
  s = processAction(s, { type: 'place', kind: 'refinery', x: rspot!.x, y: rspot!.y });
  const hauler = s.units.find(u => u.kind === 'hauler' && u.owner === 0);
  ok(s.units.length === units + 1 && !!hauler, 'a free hauler comes with the refinery');
  const c0 = s.players[0].credits;
  for (let i = 0; i < 60 && s.players[0].credits <= c0; i++) s = processAction(s, { type: 'tick', n: 20 });
  ok(s.players[0].credits > c0, 'the hauler brings ore home and credits rise');

  // Orders on units.
  const r = s.units.find(u => u.owner === 0 && u.kind === 'rifleman')!;
  const moved = processAction(s, { type: 'move', ids: [r.id], x: 20.5, y: 40.5 });
  ok(moved.units.find(u => u.id === r.id)!.order.type === 'move', 'a move order is taken');
  const am = processAction(s, { type: 'move', ids: [r.id], x: 20.5, y: 40.5, attackMove: true });
  ok(am.units.find(u => u.id === r.id)!.order.type === 'attackMove', 'an attack-move order is taken');
  const stopped = processAction(moved, { type: 'stop', ids: [r.id] });
  ok(stopped.units.find(u => u.id === r.id)!.order.type === 'idle', 'stop clears the order');
  let walk = moved;
  for (let i = 0; i < 80; i++) walk = processAction(walk, { type: 'tick', n: 10 });
  const w = walk.units.find(u => u.id === r.id);
  ok(!!w && Math.abs(w.x - 20.5) < 1.5 && Math.abs(w.y - 40.5) < 1.5, 'the rifleman walks to where he was sent');
  const attacked = processAction(s, { type: 'attack', ids: [r.id], target: enemyUnit.id });
  ok(attacked.units.find(u => u.id === r.id)!.order.type === 'attack', 'an attack order is taken');

  // Sell and repair.
  const gen = s.buildings.find(b => b.owner === 0 && b.kind === 'power')!;
  const sold = processAction(s, { type: 'sell', id: gen.id });
  ok(sold.players[0].credits === s.players[0].credits + 150, 'selling a whole Generator returns half its cost');
  ok(!sold.buildings.some(b => b.id === gen.id), 'the sold Generator is gone');
  const rep = processAction(s, { type: 'repair', id: gen.id });
  ok(rep.buildings.find(b => b.id === gen.id)!.repairing === true, 'repair toggles on');

  // Determinism and purity under orders.
  const snap = JSON.stringify(s);
  processAction(s, { type: 'move', ids: [r.id], x: 30, y: 30 });
  processAction(s, { type: 'tick', n: 30 });
  ok(JSON.stringify(s) === snap, 'orders and ticks leave their input untouched');
}

function findSpot(s: GameState, kind: BuildingKind): { x: number; y: number } | null {
  const hq = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
  for (let r = 1; r < 12; r++)
    for (let y = hq.y - r; y <= hq.y + r; y++)
      for (let x = hq.x - r; x <= hq.x + r; x++) if (placementProblem(s, 0, kind, x, y) === null) return { x, y };
  return null;
}

// ---------------------------------------------------------------------------------------------
// Veterancy, waypoint queues, stances, survivors, and loading older saves.

/** A quiet battlefield: no units, no attacks, no money for the computer to build with. */
function arena(): { s: GameState; cx: number; cy: number } {
  const s = createInitialState('arena', 'arena', { seed: 'open', createdAt: 0 });
  s.units = [];
  for (const m of s.ai) m.nextAttack = 1e9;
  s.players[1].credits = 0;
  const occ = occupancy(s);
  const clear = (cx: number, cy: number) => {
    for (let y = cy - 5; y <= cy + 5; y++)
      for (let x = cx - 5; x <= cx + 5; x++) {
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
        const k = y * MAP_W + x;
        if (!isWalkable(s.tiles[k]) || s.ore[k] > 0 || occ[k]) return false;
      }
    return true;
  };
  for (let r = 0; r < 30; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) if (clear(32 + dx, 32 + dy)) return { s, cx: 32 + dx, cy: 32 + dy };
  throw new Error('no open ground for the arena');
}

function put(s: GameState, owner: Owner, kind: UnitKind, x: number, y: number, extra: Partial<Unit> = {}): Unit {
  const u = addUnit(s, owner, kind, x, y);
  Object.assign(u, extra);
  return u;
}

const unitIn = (s: GameState, id: number) => s.units.find(u => u.id === id);

function tickUntil(s: GameState, done: (s: GameState) => boolean, max: number): GameState {
  for (let i = 0; i < max && !done(s); i++) s = processAction(s, { type: 'tick' });
  return s;
}

function veterancy(): void {
  ok(VET_KILLS[0] < VET_KILLS[1], 'veteran comes before elite');
  ok(vetFor(0) === 0 && vetFor(VET_KILLS[0] - 1) === 0, 'below the first threshold: rookie');
  ok(vetFor(VET_KILLS[0]) === 1 && vetFor(VET_KILLS[1] - 1) === 1, 'at the first threshold: veteran');
  ok(vetFor(VET_KILLS[1]) === 2 && vetFor(99) === 2, 'at the second threshold: elite, and no higher');

  // Promotion through a real kill, by a shell that lands two ticks after it is fired: the kill
  // has to be credited to the tank that fired it.
  {
    const { s: a, cx, cy } = arena();
    const tank = put(a, 0, 'tank', cx + 0.5, cy + 0.5, { kills: VET_KILLS[0] - 1 });
    put(a, 1, 'rifleman', cx + 3.5, cy + 0.5, { hp: 1, stance: 'hold' });
    const s = tickUntil(a, s => !s.units.some(u => u.owner === 1), 60);
    const t = unitIn(s, tank.id)!;
    ok(!s.units.some(u => u.owner === 1), 'the tank kills the rifleman');
    ok(t.kills === VET_KILLS[0] && t.vet === 1, `the kill promotes the tank to veteran (${t.kills} kills, rank ${t.vet})`);
    ok(s.log.some(l => l.text === 'Battle Tank promoted to Veteran.'), 'the promotion is logged for the player');
    const s2 = { ...s, units: s.units.map(u => (u.id === tank.id ? { ...u, kills: VET_KILLS[1] - 1 } : u)) };
    put(s2, 1, 'rifleman', cx + 3.5, cy + 1.5, { hp: 1, stance: 'hold' });
    const after = tickUntil(s2, s => !s.units.some(u => u.owner === 1), 60);
    ok(unitIn(after, tank.id)!.vet === 2, 'more kills make it elite');
    ok(after.log.some(l => l.text === 'Battle Tank promoted to Elite.'), 'and that is logged too');
  }
  // The computer's promotions are not announced to the player.
  {
    const { s: a, cx, cy } = arena();
    const tank = put(a, 1, 'tank', cx + 0.5, cy + 0.5, { kills: VET_KILLS[0] - 1 });
    put(a, 0, 'rifleman', cx + 3.5, cy + 0.5, { hp: 1, stance: 'hold' });
    const s = tickUntil(a, s => !s.units.some(u => u.owner === 0), 60);
    ok(unitIn(s, tank.id)!.vet === 1, 'enemy units are promoted too');
    ok(!s.log.some(l => l.text.includes('promoted')), 'but the player is not told');
  }

  // Effects: one shot from a rifleman of each rank at a target that does not fire back.
  const shot = (vet: number) => {
    const { s: a, cx, cy } = arena();
    const r = put(a, 0, 'rifleman', cx + 0.5, cy + 0.5, { vet, kills: vet ? VET_KILLS[vet - 1] : 0 });
    const target = put(a, 1, 'rifleman', cx + 2.5, cy + 0.5, { stance: 'hold' });
    const s = tickUntil(a, s => unitIn(s, target.id)!.hp < UNITS.rifleman.hp, 40);
    return { damage: UNITS.rifleman.hp - unitIn(s, target.id)!.hp, cooldown: unitIn(s, r.id)!.cooldown };
  };
  const rookie = shot(0);
  const veteran = shot(1);
  const elite = shot(2);
  const base = UNITS.rifleman.weapon!;
  ok(
    rookie.damage === base.damage && rookie.cooldown === base.cooldown,
    `a rookie hits for ${base.damage} and reloads in ${base.cooldown} (${rookie.damage}, ${rookie.cooldown})`,
  );
  ok(veteran.damage === Math.round(base.damage * 1.15), `a veteran hits 15% harder (${veteran.damage})`);
  ok(elite.damage === Math.round(base.damage * 1.3), `an elite hits 30% harder (${elite.damage})`);
  ok(
    veteran.cooldown < rookie.cooldown && elite.cooldown < veteran.cooldown,
    `reload gets faster with rank (${rookie.cooldown}, ${veteran.cooldown}, ${elite.cooldown})`,
  );

  // Elite self-repair, out of combat; veterans do not repair.
  {
    const { s: a, cx, cy } = arena();
    const e = put(a, 0, 'rifleman', cx + 0.5, cy + 0.5, { vet: 2, kills: VET_KILLS[1], hp: 30 });
    const v = put(a, 0, 'rifleman', cx + 4.5, cy + 4.5, { vet: 1, kills: VET_KILLS[0], hp: 30 });
    const s = processAction(a, { type: 'tick', n: 100 });
    const eh = unitIn(s, e.id)!.hp;
    ok(eh === 35, `an elite rifleman regains 1 hp every 2 seconds (30 -> ${eh} in 10s)`);
    ok(unitIn(s, v.id)!.hp === 30, 'a veteran does not repair itself');
    const full = processAction(s, { type: 'tick', n: 600 });
    ok(unitIn(full, e.id)!.hp === UNITS.rifleman.hp, 'self-repair stops at full health');
    // In a fight it does not repair: an enemy tank (holding fire) is in range, so it is engaged.
    const fight = { ...a, units: a.units.slice() };
    put(fight, 1, 'tank', cx + 2.5, cy + 0.5, { stance: 'hold' });
    const f = processAction(fight, { type: 'tick', n: 100 });
    ok(unitIn(f, e.id)!.hp === 30, 'an elite in a fight does not repair');
  }
}

function waypoints(): void {
  const { s: a, cx, cy } = arena();
  const r = put(a, 0, 'rifleman', cx + 0.5, cy + 0.5);
  const foe = put(a, 1, 'rifleman', cx - 4.5, cy - 4.5, { hp: 1, stance: 'hold' });
  const A = { x: cx + 3.5, y: cy + 0.5 };
  const B = { x: cx + 3.5, y: cy + 3.5 };
  const C = { x: cx + 0.5, y: cy + 3.5 };
  const same = (s: GameState, act: GameAction, what: string) => ok(processAction(s, act) === s, `rejected: ${what}`);

  // Queued on an idle unit: starts at once.
  let s = processAction(a, { type: 'move', ids: [r.id], ...A, queue: true });
  let u = unitIn(s, r.id)!;
  ok(u.order.type === 'move' && u.order.x === A.x && u.queue.length === 0, 'a queued order on an idle unit starts at once');
  s = processAction(s, { type: 'move', ids: [r.id], ...B, queue: true });
  s = processAction(s, { type: 'move', ids: [r.id], ...C, queue: true, attackMove: true });
  u = unitIn(s, r.id)!;
  ok(
    u.order.type === 'move' && u.queue.length === 2 && u.queue[0].type === 'move' && u.queue[1].type === 'attackMove',
    'shift-orders queue up behind the current one, in order',
  );
  const snap = JSON.stringify(s);
  const s2 = processAction(s, { type: 'attack', ids: [r.id], target: foe.id, queue: true });
  ok(JSON.stringify(s) === snap, 'a queued order leaves its input untouched');
  s = s2;
  u = unitIn(s, r.id)!;
  ok(u.queue.length === 3 && u.queue[2].type === 'attack', 'an attack can be queued too');
  ok(u.order.type === 'move' && u.engage === 0, 'queueing an attack does not interrupt the current move');

  // Walk the queue: A, then B, then C (attack-move), then the attack, then idle.
  const at = (s: GameState, p: { x: number; y: number }) => {
    const v = unitIn(s, r.id)!;
    return Math.abs(v.x - p.x) < 0.1 && Math.abs(v.y - p.y) < 0.1;
  };
  s = tickUntil(s, s => unitIn(s, r.id)!.queue.length < 3, 300);
  u = unitIn(s, r.id)!;
  ok(at(s, A), 'the first waypoint is reached before the next starts');
  ok(u.order.type === 'move' && u.order.x === B.x && u.order.y === B.y && u.queue.length === 2, 'reaching a waypoint pops the next');
  s = tickUntil(s, s => unitIn(s, r.id)!.queue.length < 2, 300);
  ok(at(s, B) && unitIn(s, r.id)!.order.type === 'attackMove', 'then the second, then the queued attack-move');
  s = tickUntil(s, s => unitIn(s, r.id)!.queue.length < 1, 300);
  ok(at(s, C) && unitIn(s, r.id)!.order.type === 'attack', 'then the queued attack');
  s = tickUntil(s, s => !s.units.some(v => v.id === foe.id), 400);
  ok(!s.units.some(v => v.id === foe.id), 'the queued attack is carried out');
  s = processAction(s, { type: 'tick', n: 2 });
  u = unitIn(s, r.id)!;
  ok(u.order.type === 'idle' && u.queue.length === 0, 'an emptied queue leaves the unit idle');

  // A plain order replaces the queue; stop clears it.
  let q = processAction(a, { type: 'move', ids: [r.id], ...A });
  q = processAction(q, { type: 'move', ids: [r.id], ...B, queue: true });
  q = processAction(q, { type: 'move', ids: [r.id], ...C, queue: true });
  ok(unitIn(q, r.id)!.queue.length === 2, 'two orders queued');
  const plain = processAction(q, { type: 'move', ids: [r.id], ...C });
  const pu = unitIn(plain, r.id)!;
  ok(pu.queue.length === 0 && pu.order.type === 'move' && pu.order.x === C.x, 'a plain order replaces the queue');
  const stopped = processAction(q, { type: 'stop', ids: [r.id] });
  ok(unitIn(stopped, r.id)!.queue.length === 0 && unitIn(stopped, r.id)!.order.type === 'idle', 'stop clears the queue');
  const attackNow = processAction(q, { type: 'attack', ids: [r.id], target: foe.id });
  ok(unitIn(attackNow, r.id)!.queue.length === 0 && unitIn(attackNow, r.id)!.order.type === 'attack', 'a plain attack replaces the queue');
  ok(unitIn(q, r.id)!.queue.length === 2, 'and none of that touched the state it was given');

  // The queue has a cap; a queued order nobody can take is refused.
  let full = processAction(a, { type: 'move', ids: [r.id], ...A });
  for (let i = 0; i < ORDER_QUEUE_MAX; i++) full = processAction(full, { type: 'move', ids: [r.id], x: B.x, y: B.y - (i % 3), queue: true });
  ok(unitIn(full, r.id)!.queue.length === ORDER_QUEUE_MAX, `the queue holds ${ORDER_QUEUE_MAX}`);
  same(full, { type: 'move', ids: [r.id], ...C, queue: true }, 'queueing onto a full queue');
  same(full, { type: 'attack', ids: [r.id], target: foe.id, queue: true }, 'queueing an attack onto a full queue');
  ok(processAction(full, { type: 'move', ids: [r.id], ...C }) !== full, 'a plain order still works on a full queue');
  same(a, { type: 'move', ids: [foe.id], ...A, queue: true }, 'queueing a move for an enemy unit');
  same(a, { type: 'move', ids: [r.id], x: -3, y: 4, queue: true }, 'queueing a move off the map');
  same(a, { type: 'attack', ids: [r.id], target: r.id, queue: true }, 'queueing an attack on your own unit');
  const h = put(a, 0, 'hauler', cx - 2.5, cy + 2.5);
  same(a, { type: 'attack', ids: [h.id], target: foe.id, queue: true }, 'queueing an attack with an unarmed hauler');
}

function stances(): void {
  // Each stance against an enemy rifleman 2 tiles away (in range) or 4.6 away (in sight, out of range).
  const setup = (stance: 'aggressive' | 'guard' | 'hold', gap: number, foeShoots: boolean) => {
    const { s: a, cx, cy } = arena();
    const r = put(a, 0, 'rifleman', cx + 0.5, cy + 0.5);
    const foe = put(a, 1, 'rifleman', cx + 0.5 + gap, cy + 0.5, { stance: foeShoots ? 'guard' : 'hold' });
    const s = stance === 'guard' ? a : processAction(a, { type: 'stance', ids: [r.id], stance });
    ok(unitIn(s, r.id)!.stance === stance, `the stance is set to ${stance}`);
    return { s, r, foe, x0: cx + 0.5 };
  };

  ok(createInitialState('st', 'st', { seed: 'st', createdAt: 0 }).units.every(u => u.stance === 'guard'), 'units start on guard');
  // Guard: fires at anything in range, but does not chase what is only in sight.
  {
    const { s, foe } = setup('guard', 2, false);
    const after = processAction(s, { type: 'tick', n: 40 });
    ok((unitIn(after, foe.id)?.hp ?? 0) < UNITS.rifleman.hp, 'guard fires at an enemy in range');
  }
  {
    const { s, r, foe, x0 } = setup('guard', 4.6, false);
    const after = processAction(s, { type: 'tick', n: 80 });
    ok(unitIn(after, foe.id)!.hp === UNITS.rifleman.hp, 'guard does not chase an enemy that is only in sight');
    ok(Math.abs(unitIn(after, r.id)!.x - x0) < 0.2, 'and stays where it was');
  }
  // Aggressive: chases anything in sight.
  {
    const { s, r, foe, x0 } = setup('aggressive', 4.6, false);
    const after = processAction(s, { type: 'tick', n: 80 });
    ok((unitIn(after, foe.id)?.hp ?? 0) < UNITS.rifleman.hp, 'aggressive chases and fires at an enemy in sight');
    ok(unitIn(after, r.id)!.x > x0 + 0.3, 'it moved to close the range');
  }
  // Hold fire: never shoots unprompted, even when shot at; never chases.
  {
    const { s, r, foe, x0 } = setup('hold', 2, true);
    let t = s;
    let engaged = false;
    for (let i = 0; i < 50; i++) {
      t = processAction(t, { type: 'tick' });
      if (unitIn(t, r.id)?.engage) engaged = true;
    }
    ok(unitIn(t, foe.id)!.hp === UNITS.rifleman.hp, 'hold fire does not shoot back');
    ok(!engaged, 'and never picks a target');
    ok((unitIn(t, r.id)?.hp ?? 0) < UNITS.rifleman.hp, '(it was being shot at)');
    ok(Math.abs((unitIn(t, r.id)?.x ?? x0) - x0) < 0.2, 'nor does it move');
    // An explicit order still works under hold fire.
    const ordered = processAction(processAction(s, { type: 'attack', ids: [r.id], target: foe.id }), { type: 'tick', n: 40 });
    ok((unitIn(ordered, foe.id)?.hp ?? 0) < UNITS.rifleman.hp, 'an attack order is obeyed under hold fire');
  }
  // Going to hold fire drops a target an idle unit had.
  {
    const { s, r } = setup('guard', 2, false);
    const engaged = tickUntil(s, s => unitIn(s, r.id)!.engage !== 0, 10);
    ok(unitIn(engaged, r.id)!.engage !== 0, 'a guard unit engages');
    const held = processAction(engaged, { type: 'stance', ids: [r.id], stance: 'hold' });
    ok(unitIn(held, r.id)!.engage === 0, 'switching to hold fire disengages it');
  }
  // Illegal stance orders return the same object; legal ones leave their input alone.
  {
    const { s, r, foe } = setup('guard', 2, false);
    const same = (act: GameAction, what: string) => ok(processAction(s, act) === s, `rejected: ${what}`);
    same({ type: 'stance', ids: [r.id], stance: 'guard' }, 'the stance it already has');
    same({ type: 'stance', ids: [r.id], stance: 'berserk' as never }, 'an unknown stance');
    same({ type: 'stance', ids: [foe.id], stance: 'hold' }, 'a stance for an enemy unit');
    same({ type: 'stance', ids: [], stance: 'hold' }, 'a stance for nobody');
    const h = put(s, 0, 'hauler', r.x - 3, r.y + 3);
    same({ type: 'stance', ids: [h.id], stance: 'hold' }, 'a stance for an unarmed hauler');
    const snap = JSON.stringify(s);
    const both = processAction(s, { type: 'stance', ids: [r.id, h.id], stance: 'aggressive' });
    ok(both !== s && unitIn(both, r.id)!.stance === 'aggressive' && unitIn(both, h.id)!.stance === 'guard', 'stance applies to the armed units named');
    ok(JSON.stringify(s) === snap, 'a stance order leaves its input untouched');
  }
}

function survivors(): void {
  ok(
    survivorsFor(1, 1) === 1 && survivorsFor(2, 2) === 1 && survivorsFor(3, 2) === 2 && survivorsFor(3, 3) === 3,
    'crew size goes 1, 1, 2, 3 by footprint',
  );
  const riflemen = (s: GameState, owner: Owner) => s.units.filter(u => u.owner === owner && u.kind === 'rifleman').length;

  // Sold, on open ground: the full crew, where it stood, one to a tile.
  for (const kind of ['power', 'refinery', 'factory', 'turret'] as BuildingKind[]) {
    const { s: a, cx, cy } = arena();
    const b = addBuilding(a, 0, kind, cx - 1, cy - 1);
    const sold = processAction(a, { type: 'sell', id: b.id });
    const spec = BUILDINGS[kind];
    const want = survivorsFor(spec.w, spec.h);
    ok(riflemen(sold, 0) === want, `selling a ${spec.name} lets ${want} out (${riflemen(sold, 0)})`);
    const crew = sold.units.filter(u => u.owner === 0);
    ok(
      crew.every(u => u.x >= b.x - 1 && u.x < b.x + spec.w + 1 && u.y >= b.y - 1 && u.y < b.y + spec.h + 1),
      `${spec.name}: they come out where it stood`,
    );
    ok(new Set(crew.map(u => Math.floor(u.x) + Math.floor(u.y) * MAP_W)).size === crew.length, `${spec.name}: one to a tile`);
    invariants(sold, `survivors ${kind}`);
  }
  // No room, no survivors; a little room, fewer. Units standing on the footprint are placed
  // directly (as though they stood there the moment it went), which the harness may do.
  {
    const { s: a, cx, cy } = arena();
    const b = addBuilding(a, 0, 'factory', cx - 1, cy - 1);
    for (let y = b.y - 1; y < b.y + 4; y++)
      for (let x = b.x - 1; x < b.x + 4; x++) {
        const inside = x >= b.x && x < b.x + 3 && y >= b.y && y < b.y + 3;
        if (!inside) put(a, 0, 'tank', x + 0.5, y + 0.5);
        else if (x !== b.x || y !== b.y) put(a, 0, 'buggy', x + 0.5, y + 0.5);
      }
    const sold = processAction(a, { type: 'sell', id: b.id });
    ok(riflemen(sold, 0) === 1, `with one free tile, one rifleman comes out (${riflemen(sold, 0)})`);
    put(a, 0, 'buggy', b.x + 0.5, b.y + 0.5);
    const packed = processAction(a, { type: 'sell', id: b.id });
    ok(riflemen(packed, 0) === 0, 'with no free tile, nobody comes out');
  }
  // Destroyed in battle: the enemy's crew comes out, for the enemy.
  {
    const { s: a, cx, cy } = arena();
    const b = addBuilding(a, 1, 'refinery', cx + 1, cy - 1);
    b.hp = 1;
    put(a, 0, 'rifleman', cx - 1.5, cy + 0.5);
    const s = tickUntil(a, s => !s.buildings.some(v => v.id === b.id), 80);
    ok(!s.buildings.some(v => v.id === b.id), 'the rifleman destroys the refinery');
    ok(riflemen(s, 1) === 2, `two of its crew escape, on the enemy's side (${riflemen(s, 1)})`);
  }
  // The last structure: the battle is over, nobody walks out.
  {
    const { s: a } = arena();
    const hq = a.buildings.find(b => b.owner === 0)!;
    const sold = processAction(a, { type: 'sell', id: hq.id });
    ok(riflemen(sold, 0) === 0, 'selling your last structure lets nobody out');
  }
}

function legacySaves(): void {
  // A mid-battle state, saved by a build from before veterancy, queues and stances.
  let s = createInitialState('legacy', 'legacy', { seed: 'legacy', createdAt: 0, autopilot: true });
  while (s.tick < 7000 && s.winner === null) s = processAction(s, { type: 'tick', n: 100 });
  ok(s.units.some(u => u.kills > 0), 'the legacy battle has units with kills');
  const old = JSON.parse(JSON.stringify(s));
  for (const u of old.units) {
    delete u.vet;
    delete u.queue;
    delete u.stance;
  }
  const oldText = JSON.stringify(old);
  const m = migrateState(old);
  ok(m !== null, 'a save from before these fields still loads');
  ok(JSON.stringify(old) === oldText, 'migration does not modify what it was given');
  if (!m) return;
  ok(
    m.units.every(u => u.queue.length === 0 && u.stance === 'guard' && u.vet === vetFor(u.kills)),
    'units get an empty queue, guard, and the rank their kills earned',
  );
  invariants(m, 'migrated');
  const a = processAction(m, { type: 'tick', n: 300 });
  const b = processAction(s, { type: 'tick', n: 300 });
  ok(JSON.stringify(a) === JSON.stringify(b), 'a migrated save plays on exactly as the original would');
  // Projectiles from before the shooter field land without crediting anyone, and nothing breaks.
  const older = JSON.parse(JSON.stringify(s));
  for (const p of older.projectiles) delete p.shooter;
  const o2 = migrateState(older);
  ok(o2 !== null && processAction(o2, { type: 'tick', n: 50 }) !== o2, 'projectiles without a shooter still land');
  // Nonsense in a save is tidied, not trusted.
  const odd = JSON.parse(JSON.stringify(s));
  odd.units[0].stance = 'berserk';
  odd.units[0].queue = [{ type: 'harvest', phase: 'seek', tile: -1, refinery: 0 }, { type: 'move', x: 3.5, y: 3.5 }];
  odd.units[0].vet = 7;
  const o3 = migrateState(odd)!;
  ok(
    o3.units[0].stance === 'guard' && o3.units[0].queue.length === 1 && o3.units[0].vet === vetFor(o3.units[0].kills),
    'bad stances, queued orders and ranks are repaired',
  );
  ok(
    migrateState(null) === null && migrateState({ ...old, version: 2 }) === null && migrateState({ ...old, units: 3 }) === null,
    'things that are not a battle are refused',
  );
}

const started = Date.now();
console.log('Orders and rejections');
orders();
console.log('Veterancy');
veterancy();
console.log('Waypoint queues');
waypoints();
console.log('Stances');
stances();
console.log('Survivors');
survivors();
console.log('Older saves');
legacySaves();

console.log('Determinism');
{
  const a = battle('replay', 'normal');
  const b = battle('replay', 'normal');
  ok(JSON.stringify(a) === JSON.stringify(b), 'the same seed plays out byte-identically');
}

const runs: { seed: string; difficulty: Difficulty; winner: number | null; tick: number }[] = [];
const plan: [Difficulty, number][] = [
  ['normal', SEEDS],
  ['easy', Math.max(2, Math.round(SEEDS / 5))],
  ['hard', Math.max(2, Math.round(SEEDS / 5))],
];
for (const [difficulty, count] of plan) {
  console.log(`Battles: ${count} on ${difficulty}`);
  for (let i = 1; i <= count; i++) {
    const seed = `${difficulty}-${i}`;
    const s = battle(seed, difficulty);
    runs.push({ seed, difficulty, winner: s.winner, tick: s.tick });
    for (const u of s.units) {
      if (u.vet === 1) seen.veterans++;
      if (u.vet === 2) seen.elites++;
    }
    ok(s.players[0].stats.harvested > 0 && s.players[1].stats.harvested > 0, `${seed}: both sides harvested ore`);
    ok(s.players[0].stats.killed + s.players[1].stats.killed > 0, `${seed}: there was fighting`);
  }
}
const finished = runs.filter(r => r.winner !== null);
ok(finished.length >= Math.ceil(runs.length * 0.85), `at least 85% of battles finish (${finished.length}/${runs.length})`);
const minutes = finished.map(r => r.tick / 600);
const avg = minutes.reduce((a, b) => a + b, 0) / Math.max(1, minutes.length);
const wins0 = finished.filter(r => r.winner === 0).length;
console.log(
  `  ${finished.length}/${runs.length} battles finished, average ${avg.toFixed(1)} game minutes; side 0 won ${wins0}, side 1 won ${finished.length - wins0}`,
);

console.log(`  units standing at the end with rank: ${seen.veterans} veterans, ${seen.elites} elites; at least ${seen.survivors} survivors walked out of fallen structures`);
ok(seen.veterans + seen.elites > 0, 'units earn rank in real battles');
ok(seen.survivors > 0, 'crews walk out of fallen structures in real battles');

console.log(`\n${assertions} assertions, ${failures} failed, ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (failures) process.exit(1);
console.log('All checks passed');
