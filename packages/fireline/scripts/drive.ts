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
import { BUILDINGS, MAP_H, MAP_W, UNITS, type BuildingKind, type Difficulty } from '../src/sim/rules';
import { createInitialState, powerOf, readyStructure } from '../src/sim/state';
import type { GameAction, GameState } from '../src/sim/types';

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

const started = Date.now();
console.log('Orders and rejections');
orders();

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

console.log(`\n${assertions} assertions, ${failures} failed, ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (failures) process.exit(1);
console.log('All checks passed');
