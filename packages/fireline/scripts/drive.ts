import { setAutopilotAi } from '../src/sim/ai';
/**
 * Fireline's test harness: whole battles, computer against computer, over many seeds, with the
 * invariants checked as they play, plus every order the player can give, legal and illegal.
 *
 *   npm run drive                 20 seeds on Normal, plus Easy and Hard samples
 *   npm run drive -- --seeds 60   a wider sweep
 *   npm run drive -- --campaign   only the campaign sections (missions, heroes, powers, perks)
 *
 * The campaign sections build their own test missions inline (the real mission list belongs to
 * the campaign layer) and cover every ability, stealth, every power, every objective and trigger
 * kind, each way to win and lose, perks, allowed tech, blackout, sabotage and mission saves.
 *
 * What it proves: the reducer never mutates its input, an illegal action returns the same state
 * object, a seed replays byte-identically, and the economy, combat and AI produce a finished
 * battle rather than a stalemate.
 */
import { processAction } from '../src/sim/actions';
import { canQueue, placementProblem } from '../src/sim/commands';
import { dist, distToBuilding, occupancy, passable } from '../src/sim/grid';
import { isWalkable, START_0, START_1 } from '../src/sim/map';
import { abilityProblem, createMissionState, isDetected, missionOutcome, objectiveLabel, powerProblem } from '../src/sim/mission';
import {
  BARRAGE_SHELLS,
  BUILDINGS,
  CAPTURE_TICKS,
  CHARGE_FUSE,
  DIFFICULTIES,
  FLIGHT_TICKS,
  HERO_ABILITY,
  HERO_COOLDOWN_PER_LEVEL,
  HERO_HP_PER_LEVEL,
  HERO_KINDS,
  HERO_XP_ABILITY,
  HERO_XP_STRUCTURE,
  OVERDRIVE_TICKS,
  POWERS,
  RECON_TICKS,
  SPY_SABOTAGE_TICKS,
  SPY_STEAL_MAX,
  heroLevelFor,
  type HeroKind,
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
import { addBuilding, addUnit, costFor, createInitialState, maxHpOf, migrateState, powerOf, readyStructure, visibility } from '../src/sim/state';
import type { Building, GameAction, GameState, MissionContext, MissionSpec, ObjectiveSpec, Perks, Unit } from '../src/sim/types';

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
/** `--campaign` runs only the campaign sections (missions, heroes, powers, perks). */
const CAMPAIGN_ONLY = args.includes('--campaign');
const TICK_CAP = 45000;

function invariants(s: GameState, label: string): void {
  const ids = new Set<number>();
  for (const u of s.units) {
    ok(!ids.has(u.id), `${label}: unit id ${u.id} unique`);
    ids.add(u.id);
    ok(u.hp > 0 && u.hp <= maxHpOf(u), `${label}: unit ${u.id} hp in range (${u.hp})`);
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
  // Above the 30% the computer treats as 'badly hurt': at less it pulls a unit home to repair,
  // and the queued attack would be chasing a retreating target.
  const foe = put(a, 1, 'rifleman', cx - 4.5, cy - 4.5, { hp: 20, stance: 'hold' });
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

// ---------------------------------------------------------------------------------------------
// Campaign: missions, heroes, stealth, support powers, perks. Test missions are built here; the
// real mission list belongs to the campaign layer.

const PERKS0: Perks = { harvestMul: 1, buildSpeedMul: 1, costMul: 1, unitHpMul: 1, powerCooldownMul: 1, extraStartCredits: 0 };

function mspec(over: Partial<MissionSpec> = {}): MissionSpec {
  return {
    id: 'test',
    order: 1,
    title: 'Test Mission',
    briefing: ['A test.'],
    summary: 'A mission built by the harness.',
    seed: 'mission-test',
    difficulty: 'normal',
    player: { credits: 2000, structures: [], units: ['rifleman'], heroes: [] },
    enemy: { credits: 0, base: 'outpost', structures: ['power'], units: [], ai: 'passive' },
    tech: ['power', 'barracks', 'rifleman'],
    powers: [],
    objectives: [{ kind: 'destroyAll' }],
    bonus: [],
    triggers: [],
    rewards: { xp: 100 },
    ...over,
  };
}

function mctx(over: Partial<MissionContext> = {}): MissionContext {
  return { id: 'm1', name: 'Mission', createdAt: 0, perks: { ...PERKS0 }, heroes: {}, extraTech: [], extraPowers: [], ...over };
}

const ALL_HEROES: MissionContext['heroes'] = {
  spy: { xp: 0, wounded: false },
  commando: { xp: 0, wounded: false },
  engineer: { xp: 0, wounded: false },
  ace: { xp: 0, wounded: false },
};

/** A copy the harness may edit freely: the reducer's own states are never touched. */
const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

/** No attacks, no money, no haulers: the computer side stands still. */
function quiet(s: GameState): GameState {
  for (const m of s.ai) m.nextAttack = 1e9;
  s.players[1].credits = 0;
  s.units = s.units.filter(u => !(u.owner === 1 && u.kind === 'hauler'));
  return s;
}

/** Runs an action, checking it left its input alone. */
function act(s: GameState, a: GameAction, what: string): GameState {
  const snap = JSON.stringify(s);
  const out = processAction(s, a);
  ok(JSON.stringify(s) === snap, `${what}: input untouched`);
  return out;
}

const refused = (s: GameState, a: GameAction, what: string) => ok(processAction(s, a) === s, `rejected: ${what}`);

/** A clear tile beside a structure's footprint, as a point. */
function beside(s: GameState, b: Building): { x: number; y: number } {
  const spec = BUILDINGS[b.kind];
  const occ = occupancy(s);
  const taken = new Set(s.units.map(u => Math.floor(u.x) + Math.floor(u.y) * MAP_W));
  for (let y = b.y - 1; y <= b.y + spec.h; y++)
    for (let x = b.x - 1; x <= b.x + spec.w; x++) {
      const inside = x >= b.x && x < b.x + spec.w && y >= b.y && y < b.y + spec.h;
      if (inside || !passable(s, occ, x, y) || taken.has(x + y * MAP_W)) continue;
      return { x: x + 0.5, y: y + 0.5 };
    }
  throw new Error(`nowhere beside ${b.kind}`);
}

const heroOf = (s: GameState, kind: HeroKind) => s.units.find(u => u.owner === 0 && u.kind === kind)!;
const enemyB = (s: GameState, kind: BuildingKind) => s.buildings.find(b => b.owner === 1 && b.kind === kind)!;

/** Heroes against an outpost of every infiltratable kind, nothing armed on the enemy side. */
function heroArena(enemyCredits = 1000): GameState {
  const s = quiet(
    copy(
      createMissionState(
        mspec({
          player: { credits: 500, structures: [], units: [], heroes: ['spy', 'commando', 'engineer', 'ace'] },
          enemy: { credits: 0, base: 'outpost', structures: ['power', 'refinery', 'barracks', 'factory', 'uplink'], units: [], ai: 'passive' },
          objectives: [{ kind: 'destroyAll' }],
          bonus: [
            { kind: 'infiltrate', building: 'refinery' },
            { kind: 'capture', building: 'factory' },
            { kind: 'destroy', building: 'power', count: 1 },
          ],
        }),
        mctx({ heroes: ALL_HEROES }),
      ),
    ),
  );
  s.players[1].credits = enemyCredits;
  return s;
}

/** Moves a hero beside a structure (harness only) and returns the edited copy. */
function standBy(s: GameState, kind: HeroKind, b: Building): GameState {
  const c = copy(s);
  const p = beside(c, b);
  const u = heroOf(c, kind);
  u.x = p.x;
  u.y = p.y;
  u.order = { type: 'idle' };
  u.path = [];
  u.pathGoal = -1;
  return c;
}

function missionSetup(): void {
  const spec = mspec({
    player: { credits: 2500, structures: ['hq', 'power', 'barracks'], units: ['rifleman', 'rifleman', 'tank'], heroes: ['spy', 'ace', 'spy'] },
    enemy: { credits: 4000, base: 'full', structures: ['power', 'power', 'refinery', 'barracks', 'factory', 'turret', 'turret', 'uplink'], units: ['rifleman', 'tank'], ai: 'normal' },
    tech: ['power', 'refinery'],
    powers: ['recon'],
    objectives: [{ kind: 'destroy', building: 'factory', count: 1 }, { kind: 'keepAlive', hero: 'spy' }],
    bonus: [{ kind: 'build', building: 'refinery', count: 2 }],
    timeLimit: 30000,
  });
  const ctx = mctx({
    perks: { ...PERKS0, extraStartCredits: 500, unitHpMul: 1.16 },
    heroes: { spy: { xp: 260, wounded: true }, commando: { xp: 50, wounded: false } },
    extraTech: ['barracks', 'rifleman', 'power'],
    extraPowers: ['barrage'],
  });
  const snapSpec = JSON.stringify(spec);
  const snapCtx = JSON.stringify(ctx);
  const a = createMissionState(spec, ctx);
  const b = createMissionState(spec, ctx);
  ok(JSON.stringify(spec) === snapSpec && JSON.stringify(ctx) === snapCtx, 'createMissionState leaves the spec and context alone');
  ok(JSON.stringify(a) === JSON.stringify(b), 'the same spec and context build the same battle');
  ok(a.seedText === 'mission-test' && a.id === 'm1' && a.createdAt === 0 && a.difficulty === 'normal', 'id, seed and difficulty come from the spec and context');
  ok(a.tiles === createInitialState('x', 'x', { seed: 'mission-test', createdAt: 0 }).tiles, 'the map is the one the seed generates');
  const hq0 = a.buildings.find(v => v.owner === 0 && v.kind === 'hq');
  ok(!!hq0 && hq0.x === START_0.x && hq0.y === START_0.y, 'a base mission puts side 0 on its Command Yard site');
  const hq1 = a.buildings.find(v => v.owner === 1 && v.kind === 'hq');
  ok(!!hq1 && hq1.x === START_1.x && hq1.y === START_1.y, "a full enemy base has its Command Yard on side 1's site");
  ok(a.buildings.filter(v => v.owner === 0).length === 3, 'side 0 gets every structure it was given');
  ok(a.buildings.filter(v => v.owner === 1).length === 9, 'side 1 gets its Command Yard and every structure');
  ok(a.units.filter(u => u.owner === 0 && !u.hero && u.kind !== 'hauler').length === 3, 'side 0 gets its troops');
  ok(a.units.filter(u => u.owner === 1 && u.kind !== 'hauler').length === 2, 'side 1 gets its troops');
  ok(a.units.filter(u => u.owner === 1 && u.kind === 'hauler').length === 1, "the enemy refinery comes with its hauler");
  const heroes = a.units.filter(u => u.hero);
  ok(heroes.length === 1 && heroes[0].kind === 'spy', 'only heroes both wanted and brought are fielded, once each');
  const spy = heroes[0];
  ok(spy.hero!.xp === 260 && spy.hero!.level === heroLevelFor(260) && spy.hero!.level === 3, `the Spy carries his xp and level (${spy.hero!.level})`);
  const spyMax = Math.round(UNITS.spy.hp * 1.16 * (1 + 2 * HERO_HP_PER_LEVEL));
  ok(maxHpOf(spy) === spyMax && spy.hp === Math.round(spyMax / 2), `a wounded hero starts at half health (${spy.hp}/${maxHpOf(spy)})`);
  const rifle = a.units.find(u => u.owner === 0 && u.kind === 'rifleman')!;
  ok(maxHpOf(rifle) === Math.round(60 * 1.16) && rifle.hp === maxHpOf(rifle), `Armour raises side 0's health (${rifle.hp})`);
  ok(a.units.filter(u => u.owner === 1).every(u => maxHpOf(u) === UNITS[u.kind].hp), "but never the enemy's");
  ok(a.players[0].credits === 3000 && a.players[1].credits === 4000, 'credits from the spec, plus Surveyors for side 0');
  ok(
    JSON.stringify(a.allowed) === JSON.stringify(['power', 'refinery', 'barracks', 'rifleman']),
    `allowed is the mission's tech plus the campaign's, once each (${a.allowed})`,
  );
  ok(a.powers![0].recon === 0 && a.powers![0].barrage === 0 && a.powers![0].reinforce === undefined, 'powers from the spec and the campaign, ready');
  ok(Object.keys(a.powers![1]).length === 0, 'the enemy has no powers');
  ok(a.perks!.unitHpMul === 1.16 && a.perks!.extraStartCredits === 500, 'perks are kept in the state');
  const m = a.mission!;
  ok(m.id === 'test' && m.ai === 'normal' && m.result === null && m.timeLimit === 30000 && m.fired.length === 0, 'the mission runtime starts clean');
  ok(m.objectives.length === 2 && m.bonus.length === 1, 'objectives and bonus objectives are all there');
  ok(m.objectives[0].label === objectiveLabel(spec.objectives[0]) && m.bonus[0].label === 'Build 2 Refineries', 'labels come from objectiveLabel');
  ok(a.blackoutUntil![0] === 0 && a.recon!.length === 0, 'no blackout and no recon yet');
  ok(a.explored.includes('1'), 'side 0 sees around its start');
  invariants(a, 'mission setup');
  const occ = occupancy(a);
  let area = 0;
  for (const v of a.buildings) area += BUILDINGS[v.kind].w * BUILDINGS[v.kind].h;
  ok(occ.filter(k => k !== 0).length === area, 'no two structures overlap');

  // No base: no Command Yard; an outpost: no enemy Command Yard, its structures near side 1's site.
  for (let i = 1; i <= 8; i++) {
    const kinds: BuildingKind[] = ['power', 'power', 'refinery', 'barracks', 'factory', 'turret', 'turret', 'uplink'];
    const o = createMissionState(
      mspec({ seed: `outpost-${i}`, enemy: { credits: 0, base: 'outpost', structures: kinds, units: ['rifleman', 'rocketeer'], ai: 'defend' } }),
      mctx(),
    );
    ok(!o.buildings.some(v => v.owner === 0), `outpost-${i}: a no-base mission gives side 0 no structures`);
    ok(!o.buildings.some(v => v.kind === 'hq'), `outpost-${i}: an outpost has no Command Yard`);
    ok(o.buildings.filter(v => v.owner === 1).length === kinds.length, `outpost-${i}: every outpost structure finds a place`);
    const c1 = { x: START_1.x + 1.5, y: START_1.y + 1.5 };
    ok(
      o.buildings.every(v => Math.abs(v.x - c1.x) < 16 && Math.abs(v.y - c1.y) < 16),
      `outpost-${i}: the outpost is laid out around side 1's site`,
    );
    const p0 = o.units.find(u => u.owner === 0)!;
    ok(!!p0 && dist(p0.x, p0.y, START_0.x + 1.5, START_0.y + 1.5) < 3, `outpost-${i}: side 0's troops start at side 0's site`);
    invariants(o, `outpost-${i}`);
    const o2 = processAction(o, { type: 'tick', n: 200 });
    ok(o2.winner === null && o2.mission!.result === null, `outpost-${i}: a no-base mission is not lost for having no structures`);
    invariants(o2, `outpost-${i}@200`);
  }
}

function labels(): void {
  const want: [ObjectiveSpec, string][] = [
    [{ kind: 'destroyAll' }, 'Destroy every enemy unit and structure'],
    [{ kind: 'destroy', building: 'factory', count: 1 }, 'Destroy the enemy War Factory'],
    [{ kind: 'destroy', building: 'turret', count: 2 }, 'Destroy 2 enemy Gun Turrets'],
    [{ kind: 'destroy', building: 'refinery', count: 3 }, 'Destroy 3 enemy Refineries'],
    [{ kind: 'survive', ticks: 4800 }, 'Survive for 8 minutes'],
    [{ kind: 'survive', ticks: 900 }, 'Survive for 1 minute 30 seconds'],
    [{ kind: 'keepAlive', hero: 'spy' }, 'The Spy must survive'],
    [{ kind: 'infiltrate', building: 'uplink' }, 'Infiltrate the enemy Comms Uplink'],
    [{ kind: 'capture', building: 'factory' }, 'Capture the enemy War Factory'],
    [{ kind: 'reach', who: 'commando', x: 3, y: 3, r: 2 }, 'Get the Commando to the marked point'],
    [{ kind: 'reach', who: 'any', x: 3, y: 3, r: 2 }, 'Reach the marked point'],
    [{ kind: 'holdZone', x: 3, y: 3, r: 2, ticks: 1800 }, 'Hold the marked area for 3 minutes'],
    [{ kind: 'harvest', credits: 3000 }, 'Harvest 3000 credits of ore'],
    [{ kind: 'build', building: 'uplink', count: 1 }, 'Build a Comms Uplink'],
    [{ kind: 'build', building: 'turret', count: 3 }, 'Build 3 Gun Turrets'],
  ];
  for (const [o, text] of want) ok(objectiveLabel(o) === text, `label: ${text} (${objectiveLabel(o)})`);
}

function buildRules(): void {
  // Base mission with a barracks: heroes are never queueable; allowed limits side 0 only.
  const s = createMissionState(
    mspec({ player: { credits: 5000, structures: ['hq', 'power', 'barracks'], units: [], heroes: [] }, tech: ['power', 'rifleman'] }),
    mctx(),
  );
  for (const h of HERO_KINDS) refused(s, { type: 'queue', category: UNITS[h].category, kind: h }, `queueing hero ${h}`);
  const sk = createInitialState('h', 'h', { seed: 'h', createdAt: 0 });
  for (const h of HERO_KINDS) refused(sk, { type: 'queue', category: UNITS[h].category, kind: h }, `queueing hero ${h} in a skirmish`);
  ok(processAction(s, { type: 'queue', category: 'infantry', kind: 'rifleman' }) !== s, 'an allowed unit can be queued');
  refused(s, { type: 'queue', category: 'infantry', kind: 'rocketeer' }, 'a unit the mission does not allow');
  refused(s, { type: 'queue', category: 'building', kind: 'barracks' }, 'a structure the mission does not allow');
  const e = copy(s);
  e.players[1].credits = 5000;
  addBuilding(e, 1, 'power', START_1.x - 4, START_1.y + 4);
  addBuilding(e, 1, 'barracks', START_1.x - 4, START_1.y + 7);
  ok(canQueue(e, 1, 'infantry', 'rocketeer'), 'the enemy is not bound by allowed');

  // Perks: cost, refund, build speed, unit health, harvest income.
  const perked = (p: Partial<Perks>) =>
    createMissionState(
      mspec({ player: { credits: 5000, structures: ['hq', 'power', 'barracks', 'refinery'], units: [], heroes: [] }, tech: ['power', 'rifleman', 'turret'] }),
      mctx({ perks: { ...PERKS0, ...p } }),
    );
  const cheap = perked({ costMul: 0.9 });
  const q = act(cheap, { type: 'queue', category: 'building', kind: 'power' }, 'queue with Procurement');
  ok(q.players[0].credits === 5000 - 270, `Procurement takes 10% off (${5000 - q.players[0].credits})`);
  const cq = act(q, { type: 'cancel', category: 'building', kind: 'power' }, 'cancel with Procurement');
  ok(cq.players[0].credits === 5000, 'cancelling refunds what was paid');
  ok(costFor(cheap, 0, 'turret') === 540 && costFor(cheap, 1, 'turret') === 600, 'costFor applies Procurement to side 0 only');
  const fast = (mul: number) => {
    let t = processAction(perked({ buildSpeedMul: mul }), { type: 'queue', category: 'building', kind: 'power' });
    let n = 0;
    while (!readyStructure(t, 0) && n < 500) {
      t = processAction(t, { type: 'tick' });
      n++;
    }
    return n;
  };
  const slow = fast(1);
  const quick = fast(1.25);
  ok(slow === 100 && quick === 80, `Assembly speeds production (${slow} ticks, then ${quick})`);
  const tough = perked({ unitHpMul: 1.24 });
  let tr = processAction(tough, { type: 'queue', category: 'infantry', kind: 'rifleman' });
  tr = tickUntil(tr, t => t.units.some(u => u.owner === 0 && u.kind === 'rifleman'), 200);
  const nr = tr.units.find(u => u.owner === 0 && u.kind === 'rifleman')!;
  ok(!!nr && nr.maxHp === Math.round(60 * 1.24) && nr.hp === nr.maxHp, `new units get Armour's health (${nr?.hp})`);
  invariants(tr, 'armour');
  const income = (mul: number) => {
    const t = copy(perked({ harvestMul: mul }));
    const h = t.units.find(u => u.owner === 0 && u.kind === 'hauler')!;
    const ref = t.buildings.find(b => b.owner === 0 && b.kind === 'refinery')!;
    h.order = { type: 'harvest', phase: 'unload', tile: -1, refinery: ref.id };
    h.cargo = 100;
    const c0 = t.players[0].credits;
    const after = processAction(t, { type: 'tick', n: 3 });
    return after.players[0].credits - c0;
  };
  ok(income(1) === 100 && income(1.2) === 120, `Logistics raises harvest income (${income(1)}, ${income(1.2)})`);
}

function blackoutAndSabotage(): void {
  const s = heroArena();
  ok(powerOf(s, 1).made === 100, 'the outpost makes power');
  const b = copy(s);
  b.blackoutUntil = [0, 40];
  ok(powerOf(b, 1).low && powerOf(b, 1).made === 0, 'a blackout cuts the power');
  ok(powerOf(b, 0).made === powerOf(s, 0).made, 'only for that side');
  const later = processAction(b, { type: 'tick', n: 40 });
  ok(powerOf(later, 1).made === 100, 'and it ends on time');

  // Sabotage stops a producer's queue until it runs out.
  const base = copy(
    createMissionState(mspec({ player: { credits: 5000, structures: ['hq', 'power', 'barracks'], units: [], heroes: [] }, tech: ['rifleman'] }), mctx()),
  );
  const bar = base.buildings.find(v => v.owner === 0 && v.kind === 'barracks')!;
  bar.sabotagedUntil = 30;
  let t = processAction(base, { type: 'queue', category: 'infantry', kind: 'rifleman' });
  t = processAction(t, { type: 'tick', n: 29 });
  ok(t.players[0].queues.infantry[0].progress === 0, 'a sabotaged barracks makes no progress');
  t = processAction(t, { type: 'tick', n: 10 });
  ok(t.players[0].queues.infantry[0].progress > 0, 'and starts again when the sabotage ends');
}

/**
 * Hero ability, sabotage and power tests run with side 1's computer commander switched off: they
 * test the rules, not the commander. With it on, the commander answers a Commando standing by its
 * base by sending defenders (an extra kill for him), and cancels queued units for a refund when its
 * economy is empty, as it is in these setups.
 */
function noCommander(fn: () => void): () => void {
  return () => {
    setAutopilotAi(() => {}, 1);
    try {
      fn();
    } finally {
      setAutopilotAi(null, 1);
    }
  };
}

function spyTests(): void {
  const s = heroArena(1000);
  const spy = heroOf(s, 'spy');
  const ref = enemyB(s, 'refinery');
  refused(s, { type: 'ability', id: spy.id, target: ref.id }, 'infiltrating from across the map');
  refused(s, { type: 'ability', id: spy.id }, 'infiltrating nothing');
  refused(s, { type: 'ability', id: spy.id, target: 999999 }, 'infiltrating a structure that does not exist');
  refused(s, { type: 'ability', id: heroOf(s, 'commando').id + 1000, target: ref.id }, 'an ability for a unit that does not exist');
  refused(s, { type: 'ability', id: 'x' as never, target: ref.id }, 'an ability with a bad id');
  const at = standBy(s, 'spy', ref);
  ok(abilityProblem(at, 0, spy.id, ref.id) === null, 'beside the refinery, the Spy can infiltrate');
  refused(at, { type: 'ability', id: spy.id, target: ref.id + 0.5 }, 'a fractional target');
  const r1 = act(at, { type: 'ability', id: spy.id, target: ref.id }, 'infiltrate refinery');
  ok(r1 !== at, 'infiltrating is legal');
  ok(r1.players[1].credits === 500 && r1.players[0].credits === 1000, 'a refinery: half their credits stolen');
  ok(r1.effects.some(e => e.kind === 'infiltrate'), 'an infiltrate effect is shown');
  ok(heroOf(r1, 'spy').hero!.abilityCd === HERO_ABILITY.spy.cooldown, 'the ability goes on cooldown');
  ok(heroOf(r1, 'spy').hero!.xp === HERO_XP_ABILITY, 'an infiltration earns xp');
  ok(r1.mission!.bonus[0].done, 'the infiltrate objective is done');
  ok(r1.units.some(u => u.id === spy.id), 'the Spy is not lost');
  refused(r1, { type: 'ability', id: spy.id, target: ref.id }, 'infiltrating again before the cooldown');
  const ready = processAction(r1, { type: 'tick', n: HERO_ABILITY.spy.cooldown });
  ok(heroOf(ready, 'spy').hero!.abilityCd === 0, 'the cooldown runs out');
  ok(abilityProblem(ready, 0, spy.id, ref.id) === null, 'and the ability is ready again');
  {
    const rich = copy(at);
    rich.players[1].credits = 9000;
    const r = processAction(rich, { type: 'ability', id: spy.id, target: ref.id });
    ok(r.players[1].credits === 9000 - SPY_STEAL_MAX, 'at most 1500 credits are stolen');
  }
  // Generator: blackout.
  {
    const g = enemyB(s, 'power');
    const t = act(standBy(s, 'spy', g), { type: 'ability', id: spy.id, target: g.id }, 'infiltrate generator');
    ok(t.blackoutUntil![1] === t.tick + 600 && powerOf(t, 1).low, 'a generator: their power fails for 60 seconds');
    const fac = copy(t);
    fac.players[1].credits = 2000;
    let q = fac;
    q.players[1].queues.vehicle.push({ kind: 'tank', progress: 0 });
    q = processAction(q, { type: 'tick', n: 20 });
    ok(q.players[1].queues.vehicle[0].progress === 10, `without power their production halves (${q.players[1].queues.vehicle[0].progress})`);
  }
  // Uplink: the whole map.
  {
    const u = enemyB(s, 'uplink');
    ok(s.explored.includes('0'), 'most of the map starts unexplored');
    const t = act(standBy(s, 'spy', u), { type: 'ability', id: spy.id, target: u.id }, 'infiltrate uplink');
    ok(!t.explored.includes('0'), 'an uplink: the whole map is revealed');
  }
  // Factory and barracks: production stops.
  for (const kind of ['factory', 'barracks'] as BuildingKind[]) {
    const b = enemyB(s, kind);
    const t = copy(act(standBy(s, 'spy', b), { type: 'ability', id: spy.id, target: b.id }, `infiltrate ${kind}`));
    ok(t.buildings.find(v => v.id === b.id)!.sabotagedUntil === t.tick + SPY_SABOTAGE_TICKS, `a ${kind}: production stopped for 45 seconds`);
    const cat = kind === 'factory' ? 'vehicle' : 'infantry';
    t.players[1].queues[cat].push({ kind: kind === 'factory' ? 'tank' : 'rifleman', progress: 0 });
    const after = processAction(t, { type: 'tick', n: 50 });
    ok(after.players[1].queues[cat][0].progress === 0, `the sabotaged ${kind} makes no progress`);
  }
  // A turret has nothing to give.
  {
    const t = copy(s);
    const tur = addBuilding(t, 1, 'turret', 40, 20);
    t.buildings = t.buildings.filter(v => v.id !== tur.id);
    const occ = occupancy(t);
    let site: { x: number; y: number } | null = null;
    for (let y = 4; y < 30 && !site; y++)
      for (let x = 30; x < 60 && !site; x++) if (passable(t, occ, x, y) && passable(t, occ, x + 1, y) && !t.units.some(u => dist(u.x, u.y, x, y) < 3)) site = { x, y };
    const tt = addBuilding(t, 1, 'turret', site!.x, site!.y);
    const sp = heroOf(t, 'spy');
    sp.x = site!.x + 1.5;
    sp.y = site!.y + 0.5;
    ok(abilityProblem(t, 0, sp.id, tt.id) !== null, 'the Spy cannot infiltrate a turret');
  }
  // Command Yard: base revealed, next wave weakened.
  {
    const f = quiet(copy(createMissionState(mspec({ player: { credits: 0, structures: [], units: [], heroes: ['spy'] }, enemy: { credits: 0, base: 'full', structures: ['power'], units: [], ai: 'normal' } }), mctx({ heroes: ALL_HEROES }))));
    f.ai[1].wave = 4;
    f.ai[1].nextAttack = 5000;
    const hq = enemyB(f, 'hq');
    const t = act(standBy(f, 'spy', hq), { type: 'ability', id: heroOf(f, 'spy').id, target: hq.id }, 'infiltrate command yard');
    ok(t.ai[1].wave === 2 && t.ai[1].nextAttack === 5000 + DIFFICULTIES.normal.attackInterval / 2, `a Command Yard: their next wave is weakened and later (${t.ai[1].wave}, ${t.ai[1].nextAttack})`);
    const g = enemyB(t, 'power');
    ok(t.explored[g.y * MAP_W + g.x] === '1' && t.explored[hq.y * MAP_W + hq.x] === '1', 'and their base is revealed');
  }
}

function stealthTests(): void {
  const s = heroArena();
  const spy = heroOf(s, 'spy');
  // Put the Spy in open ground with an enemy rifleman 3.5 tiles off, in range but too far to see him.
  const field = copy(s);
  field.units = field.units.filter(u => u.owner !== 0 || u.kind === 'spy');
  const sp = heroOf(field, 'spy');
  const occ = occupancy(field);
  let spot: { x: number; y: number } | null = null;
  for (let y = 25; y < 45 && !spot; y++)
    for (let x = 20; x < 44 && !spot; x++) {
      let clear = true;
      for (let dx = -1; dx <= 6 && clear; dx++) if (!passable(field, occ, x + dx, y)) clear = false;
      if (clear && field.buildings.every(b => distToBuilding(x, y, b) > 8)) spot = { x, y };
    }
  sp.x = spot!.x + 0.5;
  sp.y = spot!.y + 0.5;
  const foe = put(field, 1, 'rifleman', spot!.x + 3.5 + 0.5, spot!.y + 0.5);
  ok(!isDetected(field, sp, 1), 'a Spy 3.5 tiles from the enemy is not seen');
  ok(isDetected(field, sp, 0), 'his own side always sees him');
  ok(isDetected(field, foe, 0) && isDetected(field, foe, 1), 'anyone but a Spy is always detected');
  let t = processAction(field, { type: 'tick', n: 60 });
  ok(unitIn(t, sp.id)!.hp === sp.hp, 'an enemy in range does not shoot an unseen Spy');
  ok(unitIn(t, foe.id)!.engage === 0, 'nor pick him as a target');
  ok(unitIn(t, sp.id)!.engage === 0 && unitIn(t, foe.id)!.hp === UNITS.rifleman.hp, 'and the Spy never picks a fight himself');
  // Closer than two tiles: seen, and shot.
  const near = copy(field);
  unitIn(near, foe.id)!.x = sp.x + 1.8;
  ok(isDetected(near, unitIn(near, sp.id)!, 1), 'within two tiles the Spy is seen');
  t = processAction(near, { type: 'tick', n: 30 });
  ok((unitIn(t, sp.id)?.hp ?? 0) < sp.hp, 'and shot at');
  // Structures see him too; a turret ignores him until then.
  {
    const tf = copy(field);
    tf.units = tf.units.filter(u => u.id !== foe.id);
    const tur = addBuilding(tf, 1, 'turret', spot!.x + 4, spot!.y, -100);
    ok(!isDetected(tf, unitIn(tf, sp.id)!, 1), 'a turret four tiles off does not see the Spy');
    const tt = processAction(tf, { type: 'tick', n: 40 });
    ok(unitIn(tt, sp.id)!.hp === sp.hp && tt.buildings.find(b => b.id === tur.id)!.engage === 0, 'and does not fire on him');
    const tn = copy(tf);
    unitIn(tn, sp.id)!.x = spot!.x + 2.5;
    ok(isDetected(tn, unitIn(tn, sp.id)!, 1), 'a structure within two tiles sees him');
  }
  // Ordered to attack, he fires.
  {
    const o = copy(near);
    unitIn(o, foe.id)!.stance = 'hold';
    const a = processAction(processAction(o, { type: 'attack', ids: [sp.id], target: foe.id }), { type: 'tick', n: 30 });
    ok((unitIn(a, foe.id)?.hp ?? 0) < UNITS.rifleman.hp, 'an ordered Spy fires');
  }
  // Recon shows a hidden Spy (an enemy one here, as side 0 owns the sweep).
  {
    const r = copy(field);
    r.units = r.units.filter(u => u.owner === 1);
    const es = put(r, 1, 'spy', spot!.x + 0.5, spot!.y + 0.5);
    put(r, 0, 'rifleman', spot!.x + 4.5, spot!.y + 0.5);
    ok(!isDetected(r, es, 0), 'an enemy Spy is hidden from side 0');
    r.recon = [[spot!.x, spot!.y, 9, r.tick + 50]];
    ok(isDetected(r, es, 0), 'a recon sweep over him gives him away');
    r.recon = [[spot!.x, spot!.y, 9, r.tick]];
    ok(!isDetected(r, es, 0), 'but not once the sweep has ended');
  }
  void spy;
}

function commandoTests(): void {
  const s = heroArena();
  const c = heroOf(s, 'commando');
  const g = enemyB(s, 'power');
  refused(s, { type: 'ability', id: c.id, target: g.id }, 'a charge from across the map');
  const at = standBy(s, 'commando', g);
  refused(at, { type: 'ability', id: c.id, target: heroOf(at, 'spy').id }, 'a charge on a unit');
  const t = act(at, { type: 'ability', id: c.id, target: g.id }, 'plant charge');
  const gb = t.buildings.find(b => b.id === g.id)!;
  ok(gb.chargeAt === t.tick + CHARGE_FUSE && gb.chargedBy === c.id, 'the charge is set with a three-second fuse');
  ok(t.effects.some(e => e.kind === 'charge'), 'a charge effect is shown');
  ok(heroOf(t, 'commando').hero!.abilityCd === HERO_ABILITY.commando.cooldown, 'the charge goes on cooldown');
  const again = copy(t);
  heroOf(again, 'commando').hero!.abilityCd = 0;
  refused(again, { type: 'ability', id: c.id, target: g.id }, 'a second charge on the same structure');
  const before = processAction(t, { type: 'tick', n: CHARGE_FUSE - 1 });
  ok(before.buildings.some(b => b.id === g.id), 'nothing happens before the fuse runs out');
  const boom = processAction(before, { type: 'tick', n: 1 });
  ok(!boom.buildings.some(b => b.id === g.id), 'then the generator is destroyed');
  const k = heroOf(boom, 'commando');
  ok(k.kills === 1 && k.hero!.xp === HERO_XP_STRUCTURE, `the Commando is credited (${k.kills} kill, ${k.hero!.xp} xp)`);
  ok(boom.players[0].stats.killed === 1 && boom.players[1].stats.lost === 1, 'the tallies count it');
  ok(boom.mission!.bonus[2].done, 'the destroy objective is done');
  // Command Yard: loses 60%.
  {
    const f = quiet(copy(createMissionState(mspec({ player: { credits: 0, structures: [], units: [], heroes: ['commando'] }, enemy: { credits: 0, base: 'full', structures: [], units: [], ai: 'normal' } }), mctx({ heroes: ALL_HEROES }))));
    const hq = enemyB(f, 'hq');
    const st = standBy(f, 'commando', hq);
    heroOf(st, 'commando').stance = 'hold';
    let x = act(st, { type: 'ability', id: heroOf(f, 'commando').id, target: hq.id }, 'charge command yard');
    x = processAction(x, { type: 'tick', n: CHARGE_FUSE });
    const left = x.buildings.find(b => b.id === hq.id)!;
    ok(!!left && left.hp === BUILDINGS.hq.hp - Math.round(BUILDINGS.hq.hp * 0.6), `a Command Yard loses 60% (${left?.hp})`);
  }
  // Levels: a kill that crosses a threshold.
  {
    const l = copy(at);
    heroOf(l, 'commando').hero!.xp = 90;
    let x = processAction(l, { type: 'ability', id: c.id, target: g.id });
    x = processAction(x, { type: 'tick', n: CHARGE_FUSE });
    const h = heroOf(x, 'commando');
    ok(h.hero!.level === 2 && h.hero!.xp === 130, `the Commando reaches level 2 (${h.hero!.level})`);
    ok(maxHpOf(h) === Math.round(160 * (1 + HERO_HP_PER_LEVEL)) && h.hp === maxHpOf(h), `and his health rises with it (${h.hp}/${maxHpOf(h)})`);
    ok(x.effects.some(e => e.kind === 'levelup'), 'a level-up effect is shown');
    ok(x.log.some(l => l.text === 'The Commando reached level 2.'), 'and logged');
    invariants(x, 'level up');
  }
}

function engineerTests(): void {
  const s = heroArena();
  const e = heroOf(s, 'engineer');
  const f = enemyB(s, 'factory');
  refused(s, { type: 'ability', id: e.id, target: f.id }, 'capturing from across the map');
  const at = standBy(s, 'engineer', f);
  const t = act(at, { type: 'ability', id: e.id, target: f.id }, 'start capture');
  const h = heroOf(t, 'engineer').hero!;
  ok(h.active?.kind === 'capture' && h.active.target === f.id && h.active.progress === 0, 'the capture begins');
  refused(t, { type: 'ability', id: e.id, target: f.id }, 'starting a second capture');
  const half = processAction(t, { type: 'tick', n: CAPTURE_TICKS / 2 });
  const hh = heroOf(half, 'engineer').hero!;
  ok(hh.active?.kind === 'capture' && Math.abs(hh.active.progress - 0.5) < 1e-9, `progress runs from 0 to 1 (${hh.active?.kind === 'capture' ? hh.active.progress : '-'})`);
  const done = processAction(half, { type: 'tick', n: CAPTURE_TICKS / 2 });
  const fb = done.buildings.find(b => b.id === f.id)!;
  ok(fb.owner === 0, 'after five seconds the factory is ours');
  ok(done.effects.some(x => x.kind === 'captured'), 'a captured effect is shown');
  ok(done.mission!.bonus[1].done, 'the capture objective is done');
  const eh = heroOf(done, 'engineer').hero!;
  ok(!eh.active && eh.abilityCd === HERO_ABILITY.engineer.cooldown && eh.xp === HERO_XP_ABILITY, 'the capture ends, the cooldown starts, xp is earned');
  // Moving breaks it.
  {
    const m = act(t, { type: 'move', ids: [e.id], x: e.x, y: e.y }, 'move during capture');
    const x = processAction(m, { type: 'tick', n: 2 });
    ok(!heroOf(x, 'engineer').hero!.active, 'moving breaks a capture');
    ok(x.buildings.find(b => b.id === f.id)!.owner === 1, 'and the structure stays theirs');
    ok(x.log.some(l => l.text === 'Capture interrupted.'), 'which is logged');
    ok(heroOf(x, 'engineer').hero!.abilityCd === 0, 'an interrupted capture can be tried again at once');
  }
  // Being hurt breaks it.
  {
    const hurtS = copy(t);
    const en = heroOf(hurtS, 'engineer');
    put(hurtS, 1, 'rifleman', en.x + 2, en.y);
    const x = tickUntil(hurtS, q => (unitIn(q, en.id)?.hp ?? 0) < en.hp, 40);
    ok(!heroOf(x, 'engineer')?.hero!.active, 'being shot breaks a capture');
  }
  // Not a Command Yard.
  {
    const fs = quiet(copy(createMissionState(mspec({ player: { credits: 0, structures: [], units: [], heroes: ['engineer'] }, enemy: { credits: 0, base: 'full', structures: [], units: [], ai: 'normal' } }), mctx({ heroes: ALL_HEROES }))));
    const hq = enemyB(fs, 'hq');
    const x = standBy(fs, 'engineer', hq);
    ok(abilityProblem(x, 0, heroOf(x, 'engineer').id, hq.id) === 'A Command Yard cannot be captured', 'a Command Yard cannot be captured');
  }
  // Repairs own vehicles beside him.
  {
    const r = copy(s);
    const en = heroOf(r, 'engineer');
    const ace = heroOf(r, 'ace');
    ace.hp = 300;
    ace.x = en.x + 1;
    ace.y = en.y;
    const tank = put(r, 0, 'tank', en.x, en.y + 1, { hp: 200 });
    const far = put(r, 0, 'tank', en.x + 5, en.y, { hp: 200 });
    const rr = processAction(r, { type: 'tick', n: 10 });
    ok(unitIn(rr, tank.id)!.hp === 220, `the Engineer repairs a tank beside him, 2 hp a tick (${unitIn(rr, tank.id)!.hp})`);
    ok(unitIn(rr, far.id)!.hp === 200, 'but not one further off');
    const full = processAction(rr, { type: 'tick', n: 300 });
    ok(unitIn(full, tank.id)!.hp === UNITS.tank.hp, 'and stops at full health');
    ok(unitIn(full, ace.id)!.hp === maxHpOf(unitIn(full, ace.id)!), 'heroes in vehicles are repaired too');
  }
}

function aceTests(): void {
  const s = heroArena();
  const ace = heroOf(s, 'ace');
  const t = act(s, { type: 'ability', id: ace.id }, 'overdrive');
  const h = heroOf(t, 'ace').hero!;
  ok(h.active?.kind === 'overdrive' && h.active.until === t.tick + OVERDRIVE_TICKS, 'overdrive runs for ten seconds');
  ok(h.abilityCd === HERO_ABILITY.ace.cooldown, 'and goes on cooldown');
  refused(t, { type: 'ability', id: ace.id }, 'overdrive while it is cooling down');
  ok(processAction(s, { type: 'ability', id: ace.id, target: enemyB(s, 'power').id }) !== s, 'a target given to overdrive is ignored');
  // Speed: compare ten ticks of travel.
  const go = (st: GameState) => {
    const a = heroOf(st, 'ace');
    const m = processAction(st, { type: 'move', ids: [a.id], x: a.x + 8, y: a.y - 8 });
    const after = processAction(m, { type: 'tick', n: 12 });
    const b = heroOf(after, 'ace');
    return dist(a.x, a.y, b.x, b.y);
  };
  const plain = go(s);
  const fast = go(t);
  ok(fast > plain * 1.35 && fast < plain * 1.65, `overdrive: half again as fast (${plain.toFixed(2)} -> ${fast.toFixed(2)} tiles)`);
  // Reload.
  const shoot = (st: GameState) => {
    const c = copy(st);
    const a = heroOf(c, 'ace');
    c.units = c.units.filter(u => u.id === a.id);
    const foe = put(c, 1, 'tank', a.x + 3, a.y, { stance: 'hold' });
    const after = tickUntil(c, q => unitIn(q, foe.id)!.hp < UNITS.tank.hp || false, 30);
    return { cd: heroOf(after, 'ace').cooldown, dmg: UNITS.tank.hp - unitIn(after, foe.id)!.hp };
  };
  const p = shoot(s);
  const o = shoot(t);
  // Measured when the shell lands, FLIGHT_TICKS after it was fired.
  const fl = FLIGHT_TICKS.shell;
  ok(
    p.cd === UNITS.ace.weapon!.cooldown - fl && o.cd === Math.round(UNITS.ace.weapon!.cooldown * (2 / 3)) - fl,
    `overdrive reloads in two thirds of the time (${p.cd + fl}, ${o.cd + fl})`,
  );
  const ended = processAction(t, { type: 'tick', n: OVERDRIVE_TICKS });
  ok(!heroOf(ended, 'ace').hero!.active, 'overdrive ends on time');
  // Levels scale damage and cooldowns.
  const vet = copy(s);
  const va = heroOf(vet, 'ace');
  va.hero = { level: 3, xp: 250, abilityCd: 0 };
  const lv = shoot(vet);
  ok(lv.dmg > p.dmg, `a level-3 Ace hits harder (${p.dmg} -> ${lv.dmg})`);
  const vt = processAction(vet, { type: 'ability', id: va.id });
  ok(heroOf(vt, 'ace').hero!.abilityCd === Math.round(450 * (1 - 2 * HERO_COOLDOWN_PER_LEVEL)), `and cools down faster (${heroOf(vt, 'ace').hero!.abilityCd})`);
  // Kills earn xp: a unit is worth cost/20, at least 5.
  {
    const k = copy(s);
    const a = heroOf(k, 'ace');
    k.units = k.units.filter(u => u.id === a.id);
    put(k, 1, 'rifleman', a.x + 3, a.y, { hp: 1, stance: 'hold' });
    put(k, 1, 'rocketeer', a.x + 3, a.y + 1, { hp: 1, stance: 'hold' });
    const after = tickUntil(k, q => !q.units.some(u => u.owner === 1 && u.kind !== 'hauler'), 120);
    ok(heroOf(after, 'ace').hero!.xp === 5 + 15, `kills earn xp by cost (${heroOf(after, 'ace').hero!.xp})`);
  }
}

function powerTests(): void {
  const s = quiet(
    copy(
      createMissionState(
        mspec({
          player: { credits: 1000, structures: ['hq', 'power'], units: ['rifleman'], heroes: [] },
          enemy: { credits: 0, base: 'outpost', structures: ['power', 'barracks'], units: [], ai: 'passive' },
          powers: ['recon', 'barrage', 'reinforce'],
        }),
        mctx({ perks: { ...PERKS0, powerCooldownMul: 0.85 } }),
      ),
    ),
  );
  const none = createMissionState(mspec(), mctx());
  refused(none, { type: 'power', power: 'recon', x: 30, y: 30 }, 'a power the mission does not have');
  refused(createInitialState('p', 'p', { seed: 'p', createdAt: 0 }), { type: 'power', power: 'recon', x: 30, y: 30 }, 'a power in a skirmish');
  refused(s, { type: 'power', power: 'recon', x: -3, y: 30 }, 'a power off the map');
  refused(s, { type: 'power', power: 'recon', x: NaN, y: 30 }, 'a power at NaN');
  refused(s, { type: 'power', power: 'nuke' as never, x: 30, y: 30 }, 'an unknown power');

  // Recon.
  const target = { x: 50.5, y: 12.5 };
  ok(s.explored[12 * MAP_W + 50] === '0', 'the target area starts unexplored');
  const r = act(s, { type: 'power', power: 'recon', ...target }, 'recon');
  ok(r.powers![0].recon === Math.round(1200 * 0.85), `recon goes on cooldown, shortened by Staff work (${r.powers![0].recon})`);
  ok(r.recon!.length === 1 && r.recon![0][3] === r.tick + RECON_TICKS, 'a recon area is recorded');
  ok(r.explored[12 * MAP_W + 50] === '1', 'the area is revealed at once');
  ok(visibility(r, 0)[12 * MAP_W + 50] === 1 && visibility(s, 0)[12 * MAP_W + 50] === 0, 'and visible while the sweep lasts');
  ok(r.effects.some(e => e.kind === 'recon'), 'a recon effect is shown');
  refused(r, { type: 'power', power: 'recon', ...target }, 'recon while cooling down');
  const r2 = processAction(r, { type: 'tick', n: RECON_TICKS });
  ok(r2.recon!.length === 0 && visibility(r2, 0)[12 * MAP_W + 50] === 0, 'the sweep ends after 15 seconds');
  ok(r2.powers![0].recon === Math.round(1200 * 0.85) - RECON_TICKS, 'cooldowns count down every tick');
  let r3 = r2;
  while (r3.powers![0].recon! > 0) r3 = processAction(r3, { type: 'tick', n: Math.min(600, r3.powers![0].recon!) });
  ok(r3.powers![0].recon === 0 && powerProblem(r3, 0, 'recon', 3, 3) === null, 'and the power is ready again');

  // Barrage: eight shells, inside the radius, over four seconds, enemies only.
  const g = enemyB(s, 'barracks');
  const c = { x: g.x + 1, y: g.y + 1 };
  const bs = copy(s);
  // The barracks is taken away here so no crew walks out of it to muddle who hurt whom.
  bs.buildings = bs.buildings.filter(v => v.id !== g.id);
  const foes = [put(bs, 1, 'rifleman', c.x + 1.5, c.y + 1.5, { stance: 'hold' }), put(bs, 1, 'rifleman', c.x - 1.5, c.y - 1.2, { stance: 'hold' })];
  const mine = put(bs, 0, 'rifleman', c.x, c.y + 2.2, { stance: 'hold' });
  const b = act(bs, { type: 'power', power: 'barrage', ...c }, 'barrage');
  const shells = b.projectiles.filter(p => p.weapon === 'artillery' && p.shooter === 0);
  ok(shells.length === BARRAGE_SHELLS, `eight shells (${shells.length})`);
  ok(shells.every(p => dist(p.toX, p.toY, c.x, c.y) <= POWERS.barrage.radius + 1e-9), 'every shell lands inside the radius');
  const span = Math.max(...shells.map(p => p.hitAt)) - Math.min(...shells.map(p => p.hitAt));
  ok(span >= 30 && span <= 40, `they land over about four seconds (${span} ticks)`);
  ok(b.rngSeed !== bs.rngSeed, 'the shells are placed with the seeded rng');
  ok(JSON.stringify(processAction(bs, { type: 'power', power: 'barrage', ...c })) === JSON.stringify(b), 'and land in the same places on a replay');
  ok(b.effects.some(e => e.kind === 'barrage'), 'a barrage effect is shown');
  const landed = processAction(b, { type: 'tick', n: 60 });
  ok(landed.projectiles.filter(p => p.weapon === 'artillery').length === 0, 'every shell has landed after six seconds');
  const hurtFoes = foes.filter(f => (unitIn(landed, f.id)?.hp ?? 0) < UNITS.rifleman.hp).length;
  ok(hurtFoes >= 1, `the barrage hurts the enemy (${hurtFoes} of 2 hit)`);
  ok(unitIn(landed, mine.id)?.hp === UNITS.rifleman.hp, 'but not our own troops');
  {
    const gs = processAction(processAction(s, { type: 'power', power: 'barrage', ...c }), { type: 'tick', n: 60 });
    const gb = gs.buildings.find(v => v.id === g.id);
    ok(!gb || gb.hp < BUILDINGS.barracks.hp, 'a barrage damages the structure under it');
  }
  ok(landed.powers![0].barrage === Math.round(1800 * 0.85) - 60, 'barrage cooldown, shortened by Staff work');

  // Reinforcements: four riflemen and a tank at the map edge nearest the base.
  const rf = act(s, { type: 'power', power: 'reinforce', x: 30, y: 30 }, 'reinforce');
  const fresh = rf.units.filter(u => !s.units.some(v => v.id === u.id));
  ok(fresh.length === 5 && fresh.filter(u => u.kind === 'rifleman').length === 4 && fresh.filter(u => u.kind === 'tank').length === 1, 'four riflemen and a tank arrive');
  ok(fresh.every(u => u.owner === 0 && u.order.type === 'move'), "they are ours, and walk in toward the base");
  const edgeD = (u: Unit) => Math.min(u.x, u.y, MAP_W - u.x, MAP_H - u.y);
  ok(fresh.every(u => edgeD(u) < 4), `they arrive at the edge of the map (${fresh.map(u => edgeD(u).toFixed(1)).join(', ')})`);
  const home = { x: START_0.x + 1.5, y: START_0.y + 1.5 };
  ok(fresh.every(u => dist(u.x, u.y, home.x, home.y) < 16), 'the edge nearest the base');
  ok(rf.effects.some(e => e.kind === 'reinforce'), 'a reinforce effect is shown');
  ok(rf.powers![0].reinforce === Math.round(2400 * 0.85), 'reinforcements go on cooldown');
  invariants(processAction(rf, { type: 'tick', n: 100 }), 'reinforcements');
}

/** Ticks a mission until its result is set, up to a cap. */
function playOut(s: GameState, max: number): GameState {
  let n = 0;
  while (s.mission!.result === null && n < max) {
    s = processAction(s, { type: 'tick', n: 10 });
    n += 10;
  }
  return s;
}

function objectiveTests(): void {
  // destroyAll, and a win with a bonus star.
  {
    const s = quiet(
      copy(
        createMissionState(
          mspec({
            player: { credits: 0, structures: [], units: ['tank', 'tank'], heroes: [] },
            enemy: { credits: 0, base: 'outpost', structures: ['power'], units: [], ai: 'passive' },
            bonus: [{ kind: 'reach', who: 'any', x: 1, y: 1, r: 1 }, { kind: 'destroy', building: 'power', count: 1 }],
          }),
          mctx(),
        ),
      ),
    );
    const g = enemyB(s, 'power');
    for (const u of s.units.filter(u => u.owner === 0)) {
      const p = beside(s, g);
      u.x = p.x;
      u.y = p.y;
    }
    ok(s.mission!.objectives[0].progress === 0 && missionOutcome(s) === null, 'no outcome while the mission runs');
    const w = playOut(s, 600);
    ok(w.mission!.result === 'won' && w.winner === 0, 'destroying everything wins');
    ok(w.mission!.objectives[0].done && w.mission!.objectives[0].progress === 1, 'the objective is ticked');
    const out = missionOutcome(w)!;
    ok(out.won && out.stars === 2 && out.missionId === 'test' && out.kills === 1 && out.ticks === w.tick, `the outcome: won, two stars (${out.stars})`);
    ok(w.log.some(l => l.text === 'Mission accomplished.'), 'victory is logged');
    ok(processAction(w, { type: 'tick' }) === w, 'a finished mission does not advance');
    refused(w, { type: 'move', ids: [w.units[0].id], x: 10, y: 10 }, 'orders after the mission ends');
  }
  // destroy with a count, progress counted per structure.
  {
    const s = quiet(copy(createMissionState(mspec({ enemy: { credits: 0, base: 'outpost', structures: ['power', 'power', 'barracks'], units: [], ai: 'passive' }, objectives: [{ kind: 'destroy', building: 'power', count: 2 }] }), mctx())));
    const gens = s.buildings.filter(b => b.owner === 1 && b.kind === 'power');
    const one = copy(s);
    one.buildings.find(b => b.id === gens[0].id)!.hp = 1;
    put(one, 0, 'rocketeer', beside(one, gens[0]).x, beside(one, gens[0]).y);
    const a = tickUntil(one, q => !q.buildings.some(b => b.id === gens[0].id), 200);
    ok(a.mission!.objectives[0].progress === 0.5 && !a.mission!.objectives[0].done, 'one of two destroyed: half way');
    ok(a.mission!.result === null, 'and not won yet');
    const two = copy(a);
    two.buildings.find(b => b.id === gens[1].id)!.hp = 1;
    put(two, 0, 'rocketeer', beside(two, gens[1]).x, beside(two, gens[1]).y);
    const b = tickUntil(two, q => q.mission!.result !== null, 300);
    ok(b.mission!.objectives[0].done && b.mission!.result === 'won', 'both destroyed: done, and the mission is won with a barracks still standing');
  }
  // survive, with a trigger at a tick and one after an objective.
  {
    const s = quiet(
      copy(
        createMissionState(
          mspec({
            objectives: [{ kind: 'survive', ticks: 60 }, { kind: 'survive', ticks: 200 }],
            triggers: [
              { at: 20, spawn: { owner: 1, kind: 'rifleman', count: 3, x: 50, y: 12, order: 'attackMove', tx: 40, ty: 20 }, say: 'Enemy patrol sighted.' },
              { afterObjective: 0, spawn: { owner: 0, kind: 'tank', count: 1, x: 10, y: 54, order: 'guard' }, say: 'A tank joins you.' },
              { afterObjective: 1, say: 'Hold on.' },
            ],
          }),
          mctx(),
        ),
      ),
    );
    const t19 = processAction(s, { type: 'tick', n: 19 });
    ok(t19.mission!.fired.length === 0, 'no trigger before its time');
    const t20 = processAction(t19, { type: 'tick' });
    const pat = t20.units.filter(u => u.owner === 1 && u.kind === 'rifleman');
    ok(t20.mission!.fired.length === 1 && t20.mission!.fired[0] === 0, 'the timed trigger fires at its tick');
    ok(pat.length === 3 && pat.every(u => u.order.type === 'attackMove' && u.order.x === 40 && u.order.y === 20), 'its units arrive with their orders');
    ok(t20.log.some(l => l.text === 'Enemy patrol sighted.'), 'and its line is logged');
    const t59 = processAction(t20, { type: 'tick', n: 39 });
    ok(!t59.mission!.objectives[0].done && Math.abs(t59.mission!.objectives[0].progress - 59 / 60) < 1e-9, 'survive shows its progress');
    ok(!t59.units.some(u => u.owner === 0 && u.kind === 'tank'), 'the second trigger waits for its objective');
    const t60 = processAction(t59, { type: 'tick' });
    ok(t60.mission!.objectives[0].done, 'survive is done at its tick');
    const tank = t60.units.find(u => u.owner === 0 && u.kind === 'tank');
    ok(!!tank && tank.order.type === 'idle', 'the objective trigger fires, its units standing guard');
    ok(t60.log.some(l => l.text === 'A tank joins you.') && t60.mission!.result === null, 'and logs; the mission goes on');
    const end = processAction(t60, { type: 'tick', n: 140 });
    ok(end.mission!.result === 'won' && end.log.some(l => l.text === 'Hold on.'), 'surviving wins; a say-only trigger logs');
  }
  // keepAlive and reach: the Spy reaches extraction; or falls.
  {
    const base = quiet(
      copy(
        createMissionState(
          mspec({
            player: { credits: 0, structures: [], units: ['rifleman'], heroes: ['spy'] },
            objectives: [{ kind: 'reach', who: 'spy', x: 20.5, y: 50.5, r: 1.5 }, { kind: 'keepAlive', hero: 'spy' }],
            bonus: [{ kind: 'keepAlive', hero: 'spy' }],
          }),
          mctx({ heroes: { spy: { xp: 120, wounded: false } } }),
        ),
      ),
    );
    const spy = heroOf(base, 'spy');
    ok(base.mission!.objectives[1].progress === 1 && !base.mission!.objectives[1].failed, 'keepAlive holds while the hero lives');
    // A rifleman reaching it does not count; the Spy does.
    const rif = base.units.find(u => u.owner === 0 && u.kind === 'rifleman')!;
    const rr = processAction(processAction(base, { type: 'move', ids: [rif.id], x: 20.5, y: 50.5 }), { type: 'tick', n: 300 });
    ok(!rr.mission!.objectives[0].done, 'reach for the Spy ignores anyone else');
    const go = processAction(base, { type: 'move', ids: [spy.id], x: 20.5, y: 50.5 });
    const w = playOut(go, 600);
    ok(w.mission!.result === 'won', 'the Spy reaching the point wins');
    ok(w.mission!.objectives[1].done && w.mission!.bonus[0].done, 'keepAlive is ticked at the end');
    const o = missionOutcome(w)!;
    ok(o.stars === 2 && o.heroes.spy?.alive === true && o.heroes.spy.xp === 120, 'the outcome carries the living hero');
    // He falls.
    const doom = copy(base);
    heroOf(doom, 'spy').hp = 1;
    put(doom, 1, 'tank', spy.x + 1.5, spy.y);
    const l = tickUntil(doom, q => q.mission!.result !== null, 200);
    ok(l.mission!.result === 'lost' && l.winner === 1, 'losing the hero loses the mission');
    ok(l.mission!.lostBecause === 'The Spy fell.' && l.mission!.objectives[1].failed, `and says why (${l.mission!.lostBecause})`);
    ok(l.mission!.fallen?.spy === 120, 'the fallen hero is remembered with his xp');
    const lo = missionOutcome(l)!;
    ok(!lo.won && lo.stars === 0 && lo.heroes.spy?.alive === false && lo.heroes.spy.xp === 120, 'the outcome: lost, no stars, the hero fallen');
    ok(l.log.some(x => x.text === 'The Spy has fallen.'), 'the fall is logged');
  }
  // A bonus keepAlive failing costs a star, not the mission.
  {
    const s = quiet(
      copy(
        createMissionState(
          mspec({ player: { credits: 0, structures: [], units: ['rifleman'], heroes: ['commando'] }, objectives: [{ kind: 'survive', ticks: 100 }], bonus: [{ kind: 'keepAlive', hero: 'commando' }] }),
          mctx({ heroes: ALL_HEROES }),
        ),
      ),
    );
    // The harness strikes him down directly: the tick removes the fallen and notes it.
    heroOf(s, 'commando').hp = 0;
    const w = playOut(s, 300);
    ok(w.mission!.bonus[0].failed && w.mission!.result === 'won', 'a hero falling under a bonus keepAlive does not lose the mission');
    ok(missionOutcome(w)!.stars === 1, 'but the star is lost');
  }
  // holdZone: progress only while we hold it alone.
  {
    const s = quiet(copy(createMissionState(mspec({ objectives: [{ kind: 'holdZone', x: 30, y: 30, r: 3, ticks: 40 }] }), mctx())));
    const occ = occupancy(s);
    const k = (() => {
      for (let r = 0; r < 10; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) if (passable(s, occ, 30 + dx, 30 + dy)) return { x: 30 + dx, y: 30 + dy };
      return null;
    })()!;
    const zs = copy(s);
    zs.mission!.objectives[0].spec = { kind: 'holdZone', x: k.x + 0.5, y: k.y + 0.5, r: 3, ticks: 40 };
    const me = zs.units.find(u => u.owner === 0)!;
    me.x = k.x + 0.5;
    me.y = k.y + 0.5;
    const contested = copy(zs);
    put(contested, 1, 'rifleman', k.x + 1.5, k.y + 0.5, { stance: 'hold' });
    unitIn(contested, me.id)!.stance = 'hold';
    const c = processAction(contested, { type: 'tick', n: 20 });
    ok(c.mission!.objectives[0].progress === 0, 'a contested zone does not count');
    const h = processAction(zs, { type: 'tick', n: 20 });
    ok(Math.abs(h.mission!.objectives[0].progress - 0.5) < 1e-9, `holding it alone counts (${h.mission!.objectives[0].progress})`);
    const w = processAction(h, { type: 'tick', n: 20 });
    ok(w.mission!.objectives[0].done && w.mission!.result === 'won', 'held long enough: done');
  }
  // harvest and build, in a base mission.
  {
    const s = quiet(
      copy(
        createMissionState(
          mspec({
            player: { credits: 3000, structures: ['hq', 'power', 'refinery'], units: [], heroes: [] },
            tech: ['power', 'barracks'],
            objectives: [{ kind: 'harvest', credits: 150 }, { kind: 'build', building: 'barracks', count: 1 }],
          }),
          mctx(),
        ),
      ),
    );
    const hl = s.units.find(u => u.owner === 0 && u.kind === 'hauler')!;
    hl.order = { type: 'harvest', phase: 'unload', tile: -1, refinery: s.buildings.find(b => b.owner === 0 && b.kind === 'refinery')!.id };
    hl.cargo = 100;
    const a = processAction(s, { type: 'tick', n: 3 });
    ok(Math.abs(a.mission!.objectives[0].progress - 100 / 150) < 1e-9 && !a.mission!.objectives[0].done, 'harvest shows its progress');
    let b = processAction(a, { type: 'queue', category: 'building', kind: 'barracks' });
    b = tickUntil(b, q => readyStructure(q, 0) === 'barracks', 200);
    const spot = findSpot(b, 'barracks')!;
    b = processAction(b, { type: 'place', kind: 'barracks', x: spot.x, y: spot.y });
    b = processAction(b, { type: 'tick' });
    ok(b.mission!.objectives[1].done, 'build is done once the structure stands');
    const w = playOut(b, 3000);
    ok(w.mission!.objectives[0].done && w.mission!.result === 'won', 'harvesting enough completes the mission');
  }
  // Time limit.
  {
    const s = quiet(copy(createMissionState(mspec({ timeLimit: 50 }), mctx())));
    const a = processAction(s, { type: 'tick', n: 49 });
    ok(a.mission!.result === null, 'nothing before the limit');
    const b = processAction(a, { type: 'tick' });
    ok(b.mission!.result === 'lost' && b.mission!.lostBecause === 'Time ran out.' && b.winner === 1, 'the time limit loses the mission');
    ok(missionOutcome(b)!.stars === 0, 'with no stars');
  }
  // Wiped out, with no base.
  {
    const s = quiet(copy(createMissionState(mspec(), mctx())));
    const me = s.units.find(u => u.owner === 0)!;
    me.hp = 1;
    put(s, 1, 'tank', me.x + 1.5, me.y);
    const l = tickUntil(s, q => q.mission!.result !== null, 200);
    ok(l.mission!.result === 'lost' && l.mission!.lostBecause === 'All our forces were lost.', `losing everything loses the mission (${l.mission!.lostBecause})`);
  }
  // A base mission with the base gone but troops alive goes on.
  {
    const s = quiet(copy(createMissionState(mspec({ player: { credits: 0, structures: ['hq'], units: ['rifleman'], heroes: [] } }), mctx())));
    const sold = processAction(s, { type: 'sell', id: s.buildings.find(b => b.owner === 0)!.id });
    const a = processAction(sold, { type: 'tick', n: 30 });
    ok(a.mission!.result === null && a.winner === null, 'troops alive with no structures: the mission goes on');
  }
}

function missionReplay(): void {
  const spec = mspec({
    seed: 'replay-mission',
    player: { credits: 3000, structures: ['hq', 'power', 'refinery', 'barracks'], units: ['rifleman', 'rifleman', 'tank'], heroes: ['spy', 'commando', 'engineer', 'ace'] },
    enemy: { credits: 3000, base: 'full', structures: ['power', 'refinery', 'barracks', 'turret'], units: ['rifleman', 'rifleman'], ai: 'normal' },
    tech: ['power', 'refinery', 'barracks', 'factory', 'turret', 'rifleman', 'rocketeer', 'tank', 'hauler'],
    powers: ['recon', 'barrage', 'reinforce'],
    objectives: [{ kind: 'destroyAll' }],
    bonus: [{ kind: 'keepAlive', hero: 'ace' }],
    triggers: [{ at: 300, spawn: { owner: 1, kind: 'tank', count: 2, x: 50, y: 14, order: 'attackMove', tx: 12, ty: 50 }, say: 'Tanks inbound.' }],
  });
  const ctx = mctx({ heroes: { ...ALL_HEROES, ace: { xp: 300, wounded: true } }, perks: { ...PERKS0, unitHpMul: 1.08, harvestMul: 1.1, buildSpeedMul: 1.1, costMul: 0.95, powerCooldownMul: 0.85 } });
  const run = (): GameState => {
    let s = createMissionState(spec, ctx);
    s.autopilot = true;
    const hq1 = s.buildings.find(b => b.owner === 1 && b.kind === 'hq')!;
    const script: GameAction[] = [
      { type: 'tick', n: 50 },
      { type: 'power', power: 'recon', x: hq1.x + 1.5, y: hq1.y + 1.5 },
      { type: 'ability', id: heroOf(s, 'ace').id },
      { type: 'move', ids: s.units.filter(u => u.owner === 0 && u.hero).map(u => u.id), x: 32, y: 32, attackMove: true },
      { type: 'tick', n: 200 },
      { type: 'power', power: 'barrage', x: hq1.x + 1.5, y: hq1.y + 1.5 },
      { type: 'power', power: 'reinforce', x: 0, y: 0 },
      { type: 'tick', n: 600 },
    ];
    for (const a of script) s = act(s, a, `replay ${a.type}`);
    for (let i = 0; i < 40 && s.winner === null; i++) {
      s = act(s, { type: 'tick', n: 100 }, 'replay tick');
      if (i % 10 === 0) invariants(s, `mission replay@${s.tick}`);
    }
    return s;
  };
  const a = run();
  const b = run();
  ok(JSON.stringify(a) === JSON.stringify(b), 'a mission with heroes, powers and triggers replays byte-identically');
  ok(a.mission!.fired.includes(0) && a.log.some(l => l.text === 'Tanks inbound.') || a.mission!.result !== null, 'its trigger fired');
  invariants(a, 'mission replay end');

  // Saving and loading a mission mid-battle.
  const json = JSON.parse(JSON.stringify(a));
  const m = migrateState(json);
  ok(m !== null && !!m.mission && m.mission.objectives.length === 1, 'a mission save loads with its mission');
  if (m && a.winner === null) {
    ok(JSON.stringify(processAction(m, { type: 'tick', n: 200 })) === JSON.stringify(processAction(a, { type: 'tick', n: 200 })), 'and plays on exactly as before');
  }
  const broken = JSON.parse(JSON.stringify(a));
  broken.mission.objectives = 'nope';
  ok(migrateState(broken) === null, 'a mission save with broken objectives is refused');
  const odd = JSON.parse(JSON.stringify(a));
  const hu = odd.units.find((u: Unit) => u.hero);
  if (hu) {
    hu.hero.level = 9;
    hu.hero.abilityCd = -5;
    const om = migrateState(odd)!;
    const h2 = om.units.find(u => u.id === hu.id)!;
    ok(h2.hero!.level === heroLevelFor(h2.hero!.xp) && h2.hero!.abilityCd === 0, 'bad hero levels and cooldowns are repaired');
  }
  const rifleHero = JSON.parse(JSON.stringify(a));
  const ru = rifleHero.units.find((u: Unit) => u.kind === 'rifleman');
  if (ru) {
    ru.hero = { level: 1, xp: 0, abilityCd: 0 };
    ok(!migrateState(rifleHero)!.units.find(u => u.id === ru.id)!.hero, 'a hero record on an ordinary unit is dropped');
  }
}

/** A whole mission, computer against computer, to make sure missions finish and stay sound. */
function missionBattles(): void {
  let finished = 0;
  const n = 3;
  for (let i = 1; i <= n; i++) {
    let s = createMissionState(
      mspec({
        seed: `mission-battle-${i}`,
        player: { credits: 3000, structures: ['hq'], units: ['rifleman', 'rifleman'], heroes: ['commando', 'ace'] },
        enemy: { credits: 3000, base: 'full', structures: [], units: [], ai: 'normal' },
        tech: ['power', 'refinery', 'barracks', 'factory', 'turret', 'uplink', 'rifleman', 'rocketeer', 'hauler', 'buggy', 'tank', 'artillery'],
        objectives: [{ kind: 'destroyAll' }],
        timeLimit: 20000,
      }),
      mctx({ heroes: ALL_HEROES }),
    );
    s.autopilot = true;
    while (s.winner === null) {
      s = processAction(s, { type: 'tick', n: 100 });
      if (s.tick % 2000 === 0) invariants(s, `mission battle ${i}@${s.tick}`);
    }
    invariants(s, `mission battle ${i} end`);
    ok(s.mission!.result !== null && s.winner === (s.mission!.result === 'won' ? 0 : 1), `mission battle ${i}: result and winner agree`);
    if (s.mission!.lostBecause !== 'Time ran out.') finished++;
    const o = missionOutcome(s)!;
    ok(!!o && o.ticks === s.tick, `mission battle ${i}: an outcome is reported`);
    console.log(`  mission battle ${i}: ${s.mission!.result}${s.mission!.lostBecause ? ` (${s.mission!.lostBecause})` : ''} at tick ${s.tick} (${(s.tick / 600).toFixed(1)} min), ${s.players[0].stats.killed} kills, ${s.players[0].stats.lost} losses`);
  }
  ok(finished >= 2, `mission battles end in a decision, not the clock (${finished}/${n})`);
}

const started = Date.now();
const sections: [string, () => void][] = [
  ['Mission setup', missionSetup],
  ['Objective labels', labels],
  ['Build rules and perks', buildRules],
  ['Blackout and sabotage', noCommander(blackoutAndSabotage)],
  ['The Spy', noCommander(spyTests)],
  ['Stealth and detection', noCommander(stealthTests)],
  ['The Commando', noCommander(commandoTests)],
  ['The Engineer', noCommander(engineerTests)],
  ['The Ace', noCommander(aceTests)],
  ['Support powers', noCommander(powerTests)],
  ['Objectives, triggers, victory and defeat', objectiveTests],
  ['Mission replay and saves', missionReplay],
  ['Mission battles', missionBattles],
];
if (!CAMPAIGN_ONLY) {
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
}
for (const [name, fn] of sections) {
  console.log(name);
  fn();
}
if (CAMPAIGN_ONLY) {
  console.log(`\n${assertions} assertions, ${failures} failed, ${((Date.now() - started) / 1000).toFixed(1)}s`);
  process.exit(failures ? 1 : 0);
}

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
