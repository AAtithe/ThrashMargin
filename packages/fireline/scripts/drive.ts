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
 * The freeplay sections cover the advanced tech (every new unit and structure: stats, requirements
 * and behaviour), standard tech refusing it, skirmish support powers granted and lost with their
 * structures, the missile, the setup options, every map type over many seeds (symmetry,
 * reachability, buildable bases, ore fields, a second route), and battles on every map type.
 *
 * What it proves: the reducer never mutates its input, an illegal action returns the same state
 * object, a seed replays byte-identically, and the economy, combat and AI produce a finished
 * battle rather than a stalemate.
 */
import { processAction } from '../src/sim/actions';
import { canQueue, placementProblem } from '../src/sim/commands';
import { dist, distToBuilding, occupancy, passable } from '../src/sim/grid';
import { generateMap, isWalkable, START_0, START_1 } from '../src/sim/map';
import { generateSkirmishMap, mapProblem, oreFields, randomMapType, secondRoute, shortestWalk } from '../src/sim/maps';
import { seedFromString } from '../src/sim/rng';
import {
  BUILD_MENU,
  DAMAGE_VS,
  DEFAULT_SETUP,
  INFANTRY_MENU,
  LEGACY_SETUP,
  MAP_TYPES,
  MEDIC_HEAL,
  MEDIC_HEAL_TICKS,
  MISSILE_DAMAGE,
  SETUP_CREDITS_MAX,
  SETUP_CREDITS_MIN,
  SKIRMISH_POWERS,
  STANDARD_TECH,
  VEHICLE_MENU,
  type MapType,
  type OreLevel,
  type SkirmishSetup,
  type SupportPower,
  type WeaponKind,
} from '../src/sim/rules';
import { normaliseSetup, setupOf, startOf, techAllowed } from '../src/sim/state';
import { abilityProblem, createMissionState, doPower, isDetected, missionOutcome, objectiveLabel, powerProblem } from '../src/sim/mission';
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
import type { AiMode, Building, GameAction, GameState, MissionContext, MissionSpec, ObjectiveSpec, Perks, Unit } from '../src/sim/types';

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

function battle(seed: string, difficulty: Difficulty, setup?: Partial<SkirmishSetup>): GameState {
  let s = createInitialState(`drive-${seed}`, seed, { seed, difficulty, createdAt: 0, autopilot: true, ...(setup ? { setup } : {}) });
  ok(symmetric(s), `${seed}: map is point-symmetric`);
  ok(s.buildings.length === 2 && s.units.length === 6, `${seed}: each side starts with a yard and three riflemen`);
  invariants(s, `${seed}@0`);
  let n = 0;
  // A hauler carrying ore home to a standing refinery must keep moving. One once froze for good
  // against the corner of a lake: its smoothed path clipped a blocked tile from where it stood.
  const still = new Map<number, { x: number; y: number; since: number }>();
  let frozen = '';
  while (s.winner === null && s.tick < TICK_CAP) {
    if (!frozen) {
      for (const u of s.units) {
        const homeward = u.kind === 'hauler' && u.order.type === 'harvest' && u.order.phase === 'return';
        const refinery = homeward && s.buildings.some(b => b.owner === u.owner && b.kind === 'refinery' && b.hp > 0);
        if (!refinery) {
          still.delete(u.id);
          continue;
        }
        const p = still.get(u.id);
        if (!p || Math.hypot(p.x - u.x, p.y - u.y) > 0.25) still.set(u.id, { x: u.x, y: u.y, since: s.tick });
        else if (s.tick - p.since >= 1200) frozen = `hauler #${u.id} at ${u.x.toFixed(2)},${u.y.toFixed(2)} since tick ${p.since}`;
      }
    }
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
  ok(!frozen, `${seed}: no hauler stands still on its way home${frozen ? ` (${frozen})` : ''}`);
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


/**
 * Mission AI modes, judged by what the enemy actually does over twelve minutes against a base that
 * sits still: passive queues nothing and sends nobody; defend never comes near our base; raid
 * arrives sooner than the same commander in normal mode; an outpost with no Command Yard never
 * spends credits on a structure it could not build.
 */
function missionAiModes(): void {
  const base = (ai: AiMode, enemyBase: 'full' | 'outpost' = 'full') =>
    createMissionState(
      mspec({
        id: `ai-${ai}-${enemyBase}`,
        seed: 'ai-modes',
        player: { credits: 0, structures: ['hq', 'power'], units: [], heroes: [] },
        enemy: {
          credits: 8000,
          base: enemyBase,
          structures: ['power', 'power', 'refinery', 'barracks', 'factory'],
          units: ['tank', 'tank', 'rifleman', 'rifleman', 'rifleman', 'rifleman'],
          ai,
        },
        objectives: [{ kind: 'survive', ticks: 100000 }],
      }),
      mctx(),
    );
  /** Ticks until an enemy unit first comes within 15 tiles of our Command Yard, or null. */
  const watch = (s0: GameState, ticks: number) => {
    let s = s0;
    let arrived: number | null = null;
    let queued = false;
    let attackMoves = 0;
    const yard = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
    for (let t = 0; t < ticks && s.winner === null; t += 50) {
      s = processAction(s, { type: 'tick', n: 50 });
      const q = s.players[1].queues;
      if (q.building.length || q.infantry.length || q.vehicle.length) queued = true;
      attackMoves += s.units.filter(u => u.owner === 1 && u.order.type === 'attackMove').length;
      if (arrived === null && s.units.some(u => u.owner === 1 && dist(u.x, u.y, yard.x + 1.5, yard.y + 1.5) < 15)) arrived = s.tick;
    }
    return { s, arrived, queued, attackMoves };
  };
  const passive = watch(base('passive'), 7200);
  ok(!passive.queued, 'passive: the enemy queues nothing');
  ok(passive.attackMoves === 0 && passive.arrived === null, 'passive: and sends nobody');
  const defend = watch(base('defend'), 7200);
  ok(defend.queued, 'defend: the enemy still builds and trains');
  ok(defend.arrived === null, `defend: but never comes near our base (${defend.arrived})`);
  const normal = watch(base('normal'), 7200);
  const raid = watch(base('raid'), 7200);
  ok(raid.arrived !== null, `raid: the enemy comes for us (${raid.arrived})`);
  ok(normal.arrived === null || (raid.arrived !== null && raid.arrived < normal.arrived), `raid: sooner than normal mode (${raid.arrived} against ${normal.arrived})`);
  let everQueuedStructure = false;
  {
    let s = base('normal', 'outpost');
    for (let t = 0; t < 7200 && s.winner === null; t += 50) {
      s = processAction(s, { type: 'tick', n: 50 });
      if (s.players[1].queues.building.length) everQueuedStructure = true;
    }
  }
  ok(!everQueuedStructure, 'outpost: its credits never go into a structure it cannot build');
}

// ---------------------------------------------------------------------------------------------
// Freeplay depth: new tech, skirmish powers, the missile, setup options and the map types.

const NEW_STRUCTURES: BuildingKind[] = ['techcentre', 'repairbay', 'wall', 'rocketturret', 'strikecommand'];
const NEW_UNITS: UnitKind[] = ['grenadier', 'medic', 'flametank', 'missilecarrier', 'bastion'];
const ADVANCED: Partial<SkirmishSetup> = { map: 'plains', tech: 'advanced', credits: 20000 };

/** A skirmish with every option given, the computer quiet, the opening riflemen gone. */
function advanced(seed = 'adv', setup: Partial<SkirmishSetup> = ADVANCED): GameState {
  const s = quiet(copy(createInitialState(seed, seed, { seed, createdAt: 0, setup })));
  s.units = [];
  return s;
}

/** An advanced skirmish with an 11 by 11 patch of open ground, for unit behaviour. */
function advArena(): { s: GameState; cx: number; cy: number } {
  const s = advanced('adv-arena');
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
  throw new Error('no open ground for the advanced arena');
}

const hqOf = (s: GameState, owner: Owner) => s.buildings.find(b => b.owner === owner && b.kind === 'hq')!;

/** Adds every structure named for a side, far from anything (requirements only look for them). */
function grant(s: GameState, owner: Owner, kinds: BuildingKind[]): void {
  for (const k of kinds) addBuilding(s, owner, k, owner === 0 ? 1 : MAP_W - 4, owner === 0 ? 1 : MAP_H - 4, -100);
}

function newTech(): void {
  for (const k of NEW_STRUCTURES) {
    ok(k in BUILDINGS && BUILD_MENU.includes(k), `${k}: a structure, in the build menu`);
    ok(!STANDARD_TECH.includes(k), `${k}: not part of the standard game`);
  }
  for (const k of NEW_UNITS) {
    const menu = UNITS[k].category === 'infantry' ? INFANTRY_MENU : VEHICLE_MENU;
    ok(k in UNITS && menu.includes(k) && !UNITS[k].hero, `${k}: a unit, in its menu`);
    ok(!STANDARD_TECH.includes(k), `${k}: not part of the standard game`);
  }
  ok(STANDARD_TECH.length === 12, 'the standard game is six structures and six units');
  for (const k of STANDARD_TECH) ok(BUILD_MENU.includes(k as BuildingKind) || INFANTRY_MENU.includes(k as UnitKind) || VEHICLE_MENU.includes(k as UnitKind), `${k} still on a menu`);
  for (const w of Object.keys(DAMAGE_VS) as WeaponKind[]) ok(w in FLIGHT_TICKS, `${w}: has a flight time`);
  for (const u of Object.values(UNITS)) if (u.weapon) ok(u.weapon.kind in DAMAGE_VS, `${u.name}: its weapon has a damage table`);

  // Stats: the shapes and roles the design asks for.
  const B = BUILDINGS;
  ok(B.techcentre.w === 2 && B.techcentre.h === 2 && B.techcentre.cost >= 1500, 'Tech Centre: 2x2, about 2000');
  ok(B.repairbay.w === 2 && B.repairbay.h === 2 && B.repairbay.cost <= 1000, 'Repair Bay: 2x2, about 800');
  ok(B.wall.w === 1 && B.wall.h === 1 && B.wall.cost <= 100 && B.wall.power === 0 && !!B.wall.wall, 'Sandbag Wall: 1x1, cheap, no power, a wall');
  ok(B.rocketturret.w === 1 && B.rocketturret.weapon?.kind === 'rocket' && B.rocketturret.weapon.range > B.turret.weapon!.range, 'Rocket Turret: 1x1, rockets, outranges the Gun Turret');
  ok(B.strikecommand.w === 3 && B.strikecommand.h === 3 && B.strikecommand.power <= -100 && B.strikecommand.cost >= 3000, 'Strike Command: 3x3, heavy power draw, costly');
  const req = (k: BuildingKind | UnitKind) => (k in BUILDINGS ? BUILDINGS[k as BuildingKind].requires : UNITS[k as UnitKind].requires);
  const same = (a: BuildingKind[], b: BuildingKind[]) => a.length === b.length && a.every(x => b.includes(x));
  ok(same(req('techcentre'), ['factory', 'uplink']), 'Tech Centre needs a War Factory and a Comms Uplink');
  ok(same(req('repairbay'), ['factory']), 'Repair Bay needs a War Factory');
  ok(same(req('wall'), ['barracks']), 'Sandbag Wall needs a Barracks');
  ok(same(req('rocketturret'), ['uplink']), 'Rocket Turret needs a Comms Uplink');
  ok(same(req('strikecommand'), ['techcentre']), 'Strike Command needs a Tech Centre');
  ok(same(req('grenadier'), ['barracks']) && same(req('medic'), ['barracks']), 'Grenadier and Medic need a Barracks');
  ok(req('flametank').includes('techcentre') && req('bastion').includes('techcentre'), 'Flame Tank and Bastion need a Tech Centre');
  ok(req('missilecarrier').includes('uplink'), 'Missile Carrier needs a Comms Uplink');
  const U = UNITS;
  ok(U.grenadier.category === 'infantry' && (U.grenadier.weapon?.splash ?? 0) > 0, 'Grenadier: infantry with splash');
  ok(DAMAGE_VS[U.grenadier.weapon!.kind].infantry >= 1 && DAMAGE_VS[U.grenadier.weapon!.kind].building >= 1, 'grenades: good against infantry and structures');
  ok(U.medic.category === 'infantry' && !U.medic.weapon && !!U.medic.medic, 'Medic: unarmed infantry that heals');
  ok(U.flametank.weapon?.kind === 'flame' && U.flametank.weapon.range < 3.5 && (U.flametank.weapon.splash ?? 0) > 0, 'Flame Tank: short range, splash');
  ok(DAMAGE_VS.flame.infantry > 1 && DAMAGE_VS.flame.building > 1 && DAMAGE_VS.flame.heavy < 0.5, 'flame: deadly to infantry and structures, poor against armour');
  ok((U.missilecarrier.weapon?.minRange ?? 0) > 0 && U.missilecarrier.weapon!.range >= 8 && U.missilecarrier.weapon!.kind === 'rocket', 'Missile Carrier: long-range rockets with a minimum range');
  ok(U.bastion.hp >= 2 * U.tank.hp && U.bastion.speed < U.tank.speed && U.bastion.weapon!.damage > U.tank.weapon!.damage && (U.bastion.selfRepair ?? 0) > 0, 'Bastion: tough, slow, strong cannon, self-repair');

  // Requirements, as the queue sees them.
  const s = advanced();
  const can = (st: GameState, k: BuildingKind | UnitKind, owner: Owner = 0) => canQueue(st, owner, categoryOfKind(k), k);
  for (const k of [...NEW_STRUCTURES, ...NEW_UNITS]) ok(!can(s, k), `${k}: refused with only a Command Yard`);
  const a = copy(s);
  grant(a, 0, ['power', 'barracks']);
  ok(can(a, 'wall') && can(a, 'grenadier') && can(a, 'medic'), 'a Barracks unlocks walls, grenadiers and medics');
  ok(!can(a, 'repairbay') && !can(a, 'rocketturret'), 'but not the Repair Bay or Rocket Turret');
  grant(a, 0, ['refinery', 'factory']);
  ok(can(a, 'repairbay') && !can(a, 'techcentre') && !can(a, 'missilecarrier'), 'a War Factory unlocks the Repair Bay, not the Tech Centre');
  grant(a, 0, ['uplink']);
  ok(can(a, 'techcentre') && can(a, 'rocketturret') && can(a, 'missilecarrier'), 'an Uplink as well: Tech Centre, Rocket Turret, Missile Carrier');
  ok(!can(a, 'strikecommand') && !can(a, 'flametank') && !can(a, 'bastion'), 'tier three waits for the Tech Centre');
  grant(a, 0, ['techcentre']);
  ok(can(a, 'strikecommand') && can(a, 'flametank') && can(a, 'bastion'), 'the Tech Centre unlocks tier three');
  const q = act(a, { type: 'queue', category: 'building', kind: 'techcentre' }, 'queue a Tech Centre');
  ok(q.players[0].credits === a.players[0].credits - BUILDINGS.techcentre.cost, 'a Tech Centre is paid for when queued');
  const v = act(a, { type: 'queue', category: 'vehicle', kind: 'bastion' }, 'queue a Bastion');
  ok(v.players[0].queues.vehicle.length === 1 && v.players[0].queues.vehicle[0].kind === 'bastion', 'a Bastion is queued');
  grant(a, 1, ['power', 'barracks', 'refinery', 'factory', 'uplink', 'techcentre']);
  a.players[1].credits = 50000;
  ok(NEW_UNITS.every(k => can(a, k, 1)) && NEW_STRUCTURES.every(k => can(a, k, 1)), 'the computer side may build all of it too');
}

const categoryOfKind = (k: BuildingKind | UnitKind) => (k in BUILDINGS ? 'building' : UNITS[k as UnitKind].category);

function standardTech(): void {
  const all: BuildingKind[] = ['power', 'refinery', 'barracks', 'factory', 'uplink', 'techcentre'];
  const check = (s: GameState, label: string, allowNew: boolean) => {
    const c = copy(s);
    c.players[0].credits = c.players[1].credits = 50000;
    grant(c, 0, all);
    grant(c, 1, all);
    for (const k of [...NEW_STRUCTURES, ...NEW_UNITS]) {
      const cat = categoryOfKind(k);
      ok(canQueue(c, 0, cat, k) === allowNew && canQueue(c, 1, cat, k) === allowNew, `${label}: ${k} ${allowNew ? 'allowed' : 'refused'} for both sides`);
      if (!allowNew) refused(c, { type: 'queue', category: cat, kind: k }, `${label}: queueing ${k}`);
    }
    for (const k of STANDARD_TECH) ok(canQueue(c, 0, categoryOfKind(k), k), `${label}: ${k} still allowed`);
  };
  const std = createInitialState('std', 'std', { seed: 'std', createdAt: 0, setup: { map: 'classic', tech: 'standard' } });
  check(std, 'standard tech', false);
  const legacy = createInitialState('leg', 'leg', { seed: 'leg', createdAt: 0 });
  check(legacy, 'no setup (the original game)', false);
  ok(setupOf(legacy) === LEGACY_SETUP && LEGACY_SETUP.tech === 'standard' && LEGACY_SETUP.map === 'classic', 'no setup reads as the original game');
  check(advanced(), 'advanced tech', true);
  ok(DEFAULT_SETUP.tech === 'advanced' && DEFAULT_SETUP.map === 'random', 'a new game defaults to advanced tech on a random map');

  // Standard tech has no support powers, whatever stands.
  {
    const c = quiet(copy(std));
    addBuilding(c, 0, 'uplink', 1, 1, -100);
    const t = processAction(c, { type: 'tick' });
    ok(!t.powers, 'standard tech: an Uplink grants no recon');
  }
  // A mission: side 0 by its tech list, side 1 by the original game's.
  {
    const m = copy(createMissionState(mspec({ tech: ['power', 'barracks', 'rifleman', 'grenadier'] }), mctx()));
    m.players[0].credits = m.players[1].credits = 5000;
    grant(m, 0, ['power', 'barracks']);
    grant(m, 1, ['power', 'barracks']);
    ok(canQueue(m, 0, 'infantry', 'grenadier'), 'a mission whose tech list has it: side 0 may train grenadiers');
    ok(!canQueue(m, 0, 'infantry', 'medic') && !canQueue(m, 0, 'building', 'wall'), 'but nothing the list leaves out');
    ok(!canQueue(m, 1, 'infantry', 'grenadier') && !techAllowed(m, 1, 'bastion'), "the mission's enemy keeps to the original game");
    ok(canQueue(m, 1, 'infantry', 'rifleman'), 'and may still train riflemen');
  }
}

function wallTests(): void {
  const s = advanced('walls');
  const hq = hqOf(s, 0);
  refused(s, { type: 'queue', category: 'building', kind: 'wall' }, 'a wall with no Barracks');
  const a = copy(s);
  grant(a, 0, ['barracks']);
  // Build one through the queue and place it against the yard's corner, then another beside it.
  let w = act(a, { type: 'queue', category: 'building', kind: 'wall' }, 'queue a wall');
  w = tickUntil(w, x => readyStructure(x, 0) === 'wall', 100);
  ok(readyStructure(w, 0) === 'wall', 'the wall is ready');
  const row = hq.y - 2;
  const x0 = hq.x;
  ok(placementProblem(w, 0, 'wall', x0, row) === null, 'a wall goes down near the yard');
  w = act(w, { type: 'place', kind: 'wall', x: x0, y: row }, 'place a wall');
  ok(w.buildings.some(b => b.kind === 'wall' && b.x === x0 && b.y === row), 'the wall stands');
  w = act(w, { type: 'queue', category: 'building', kind: 'wall' }, 'queue a second wall');
  w = tickUntil(w, x => readyStructure(x, 0) === 'wall', 100);
  ok(placementProblem(w, 0, 'wall', x0 + 1, row) === null, 'a wall may stand right against another');
  w = act(w, { type: 'place', kind: 'wall', x: x0 + 1, y: row }, 'place it against the first');
  // Walls do not extend the build radius.
  const c = copy(w);
  // A line of walls running up from the first, away from the yard.
  for (let y = row - 1; y >= hq.y - 6; y--) addBuilding(c, 0, 'wall', x0, y, c.tick);
  const far = { x: x0 + 1, y: hq.y - 6 };
  ok(hq.y - far.y > 4, `test spot is beyond the build radius of the yard (${hq.y - far.y})`);
  ok(placementProblem(c, 0, 'wall', far.x, far.y) === 'Too far from your base', 'a wall beside a far wall is still too far from the base');
  ok(placementProblem(c, 0, 'power', far.x, far.y) === 'Too far from your base', 'so is a Generator');
  ok(placementProblem(c, 0, 'wall', x0 + 1, hq.y - 4) === null, 'within the radius of the yard itself, fine');
  // Selling a wall: a little back, nobody walks out.
  const wall = w.buildings.find(b => b.kind === 'wall')!;
  const sold = act(w, { type: 'sell', id: wall.id }, 'sell a wall');
  ok(sold.units.length === w.units.length, 'nobody walks out of a sold wall');
  ok(sold.players[0].credits === w.players[0].credits + Math.floor((BUILDINGS.wall.cost * 0.5) / 10) * 10, 'a sold wall returns half its cost');
  // Destroyed: no crew either.
  {
    const d = copy(w);
    d.buildings.find(b => b.id === wall.id)!.hp = 0;
    const t = processAction(d, { type: 'tick' });
    ok(!t.buildings.some(b => b.id === wall.id) && t.units.length === d.units.length, 'a destroyed wall leaves no survivors');
  }
  // Walls are not structures for victory.
  {
    const v = copy(s);
    v.buildings = v.buildings.filter(b => b.owner === 0);
    addBuilding(v, 1, 'wall', 40, 10, -100);
    const t = processAction(v, { type: 'tick' });
    ok(t.winner === 0, 'a side with only walls left has lost');
    const v0 = copy(s);
    v0.buildings = v0.buildings.filter(b => b.owner === 1);
    addBuilding(v0, 0, 'wall', 20, 50, -100);
    ok(processAction(v0, { type: 'tick' }).winner === 1, 'for either side');
  }

  // Blocking: a line of walls with open ends; a soldier sent across walks round it.
  {
    const { s: ar, cx, cy } = advArena();
    for (let y = cy - 4; y <= cy + 4; y++) addBuilding(ar, 0, 'wall', cx, y, -100);
    const r = put(ar, 0, 'rifleman', cx - 2.5, cy + 0.5, { stance: 'hold' });
    let m = act(ar, { type: 'move', ids: [r.id], x: cx + 3.5, y: cy + 0.5 }, 'move across a wall');
    let detour = 0;
    let onWall = false;
    for (let i = 0; i < 400; i++) {
      m = processAction(m, { type: 'tick' });
      const u = unitIn(m, r.id)!;
      detour = Math.max(detour, Math.abs(u.y - (cy + 0.5)));
      if (Math.floor(u.x) === cx && Math.floor(u.y) >= cy - 4 && Math.floor(u.y) <= cy + 4) onWall = true;
      if (u.order.type === 'idle') break;
    }
    const u = unitIn(m, r.id)!;
    ok(dist(u.x, u.y, cx + 3.5, cy + 0.5) < 1, `the soldier gets across (${u.x.toFixed(1)}, ${u.y.toFixed(1)})`);
    ok(!onWall, 'never through a wall tile');
    ok(detour >= 4.5, `he walks round the end of the line (${detour.toFixed(1)} tiles off the straight line)`);
    // Walled in on every side: he cannot leave.
    const box = copy(ar);
    box.buildings = box.buildings.filter(b => b.kind !== 'wall');
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) addBuilding(box, 0, 'wall', cx + dx, cy + dy, -100);
    const p = put(box, 0, 'rifleman', cx + 0.5, cy + 0.5, { stance: 'hold' });
    let b2 = act(box, { type: 'move', ids: [p.id], x: cx + 4.5, y: cy + 0.5 }, 'move out of a walled box');
    b2 = processAction(b2, { type: 'tick', n: 200 });
    const pu = unitIn(b2, p.id)!;
    ok(Math.floor(pu.x) === cx && Math.floor(pu.y) === cy, 'walled in on all sides, he stays inside');
    ok(occupancy(box)[cy * MAP_W + cx + 1] !== 0, 'a wall tile is blocked ground');
  }
}

function medicTests(): void {
  const { s, cx, cy } = advArena();
  const med = put(s, 0, 'medic', cx + 0.5, cy + 0.5);
  const hurt = put(s, 0, 'rifleman', cx + 1.5, cy + 0.5, { hp: 20, stance: 'hold' });
  const tank = put(s, 0, 'tank', cx + 0.5, cy + 2, { hp: 100, stance: 'hold' });
  const foe = put(s, 1, 'rifleman', cx - 1, cy + 0.5, { hp: 20, stance: 'hold' });
  refused(s, { type: 'attack', ids: [med.id], target: foe.id }, 'an attack order to an unarmed Medic');
  const t = processAction(s, { type: 'tick', n: 25 });
  const healed = unitIn(t, hurt.id)!.hp;
  ok(healed > 20 && healed <= 20 + MEDIC_HEAL * Math.ceil(25 / MEDIC_HEAL_TICKS), `a Medic heals wounded infantry beside him (20 to ${healed})`);
  ok(unitIn(t, tank.id)!.hp === 100, 'but not vehicles');
  ok(unitIn(t, foe.id)!.hp === 20, 'nor the enemy');
  ok(t.effects.some(e => e.kind === 'heal'), 'a heal effect is shown');
  // Not himself.
  {
    const c = copy(s);
    c.units = [];
    const m2 = put(c, 0, 'medic', cx + 0.5, cy + 0.5, { hp: 30 });
    ok(unitIn(processAction(c, { type: 'tick', n: 50 }), m2.id)!.hp === 30, 'a Medic does not heal himself');
  }
  // Idle, he walks to the wounded.
  {
    const c = copy(s);
    c.units = [];
    const m3 = put(c, 0, 'medic', cx - 3.5, cy + 0.5);
    const w = put(c, 0, 'rifleman', cx + 1.5, cy + 0.5, { hp: 10, stance: 'hold' });
    const after = processAction(c, { type: 'tick', n: 200 });
    const m = unitIn(after, m3.id)!;
    const wu = unitIn(after, w.id)!;
    ok(dist(m.x, m.y, wu.x, wu.y) <= 2, `an idle Medic goes to a wounded soldier (${dist(m.x, m.y, wu.x, wu.y).toFixed(1)} tiles)`);
    ok(wu.hp > 10, `and patches him up (${wu.hp})`);
  }
}

function repairBayTests(): void {
  const { s, cx, cy } = advArena();
  const bay = addBuilding(s, 0, 'repairbay', cx, cy, -100);
  s.players[0].credits = 1000;
  const spot = beside(s, bay);
  const tank = put(s, 0, 'tank', spot.x, spot.y, { hp: 200, stance: 'hold' });
  const away = put(s, 0, 'tank', cx + 0.5, cy + 5.5, { hp: 200, stance: 'hold' });
  const rif = put(s, 0, 'rifleman', bay.x - 0.5, bay.y + 0.5, { hp: 20, stance: 'hold' });
  const t = processAction(s, { type: 'tick', n: 100 });
  const got = unitIn(t, tank.id)!.hp - 200;
  ok(got > 0, `a vehicle beside the Repair Bay is mended (+${got})`);
  const spent = s.players[0].credits - t.players[0].credits;
  const want = (got * UNITS.tank.cost * 0.4) / UNITS.tank.hp;
  ok(Math.abs(spent - want) < 1, `and paid for as it goes (${spent.toFixed(2)} credits for ${got} hp)`);
  ok(unitIn(t, away.id)!.hp === 200, 'a vehicle away from it is not');
  ok(unitIn(t, rif.id)!.hp === 20, 'nor is infantry');
  ok(t.effects.some(e => e.kind === 'repair'), 'a repair effect is shown');
  const broke = copy(s);
  broke.players[0].credits = 0;
  ok(unitIn(processAction(broke, { type: 'tick', n: 100 }), tank.id)!.hp === 200, 'no credits, no repairs');
  // Short of power it works half as fast: with a Generator, twice the work in the same time.
  const powered = copy(s);
  addBuilding(powered, 0, 'power', cx - 6, cy - 5, -100);
  const got2 = unitIn(processAction(powered, { type: 'tick', n: 100 }), tank.id)!.hp - 200;
  ok(powerOf(s, 0).low && !powerOf(powered, 0).low, 'the test bases: one short of power, one not');
  ok(got2 >= got * 2 - 6 && got2 <= got * 2 + 6, `powered, it mends twice as fast (${got2} against ${got})`);
}

function weaponTests(): void {
  // Grenades: arcing splash breaks up a clump.
  {
    const { s, cx, cy } = advArena();
    const g = put(s, 0, 'grenadier', cx + 0.5, cy + 0.5);
    const foes = [0, 1, 2].map(i => put(s, 1, 'rifleman', cx + 4 + (i % 2) * 0.4, cy + 0.2 + i * 0.3, { stance: 'hold' }));
    const t = processAction(s, { type: 'tick', n: 60 });
    const thrown = tickUntil(s, st => st.projectiles.some(p => p.shooter === g.id), 40);
    ok(thrown.projectiles.some(p => p.shooter === g.id && p.weapon === 'artillery' && p.splash > 0), 'the Grenadier lobs a grenade');
    const hurt = foes.filter(f => (unitIn(t, f.id)?.hp ?? 0) < UNITS.rifleman.hp).length;
    ok(hurt >= 2, `one grenade hurts several soldiers (${hurt} of 3)`);
  }
  // Flame: deadly to infantry, with splash; far harder on a structure than a tank's shell is.
  {
    const { s, cx, cy } = advArena();
    put(s, 0, 'flametank', cx + 0.5, cy + 0.5);
    const foes = [put(s, 1, 'rifleman', cx + 2.5, cy + 0.5, { stance: 'hold' }), put(s, 1, 'rifleman', cx + 2.7, cy + 1.1, { stance: 'hold' })];
    const t = processAction(s, { type: 'tick', n: 40 });
    const hurt = foes.filter(f => (unitIn(t, f.id)?.hp ?? 0) < UNITS.rifleman.hp).length;
    ok(hurt === 2, `the Flame Tank burns both soldiers (${hurt})`);
    ok(foes.some(f => !unitIn(t, f.id)), 'and kills at least one within four seconds');
    const vsBuilding = (kind: UnitKind) => {
      const { s: a, cx: x, cy: y } = advArena();
      const gen = addBuilding(a, 1, 'power', x + 3, y, -100);
      const u = put(a, 0, kind, x + 1.5, y + 1);
      const r = processAction(processAction(a, { type: 'attack', ids: [u.id], target: gen.id }), { type: 'tick', n: 80 });
      return BUILDINGS.power.hp - (r.buildings.find(b => b.id === gen.id)?.hp ?? 0);
    };
    const flame = vsBuilding('flametank');
    const shell = vsBuilding('tank');
    ok(flame > shell * 1.5, `flame wrecks a structure faster than a tank's shells (${flame} against ${shell})`);
  }
  // The Missile Carrier: will not fire inside its minimum range, backs off, and fires from afar.
  {
    const { s, cx, cy } = advArena();
    const mc = put(s, 0, 'missilecarrier', cx + 0.5, cy + 0.5);
    const close = put(s, 1, 'tank', cx + 2, cy + 0.5, { stance: 'hold' });
    let t = act(s, { type: 'attack', ids: [mc.id], target: close.id }, 'carrier attacks a tank too close');
    t = processAction(t, { type: 'tick', n: 8 });
    ok(!t.projectiles.some(p => p.shooter === mc.id) && !t.effects.some(e => e.kind === 'muzzle' && e.weapon === 'rocket'), 'no rocket inside the minimum range');
    const m = unitIn(t, mc.id)!;
    ok(dist(m.x, m.y, cx + 2, cy + 0.5) > 1.5, `it backs away from the target (${dist(m.x, m.y, cx + 2, cy + 0.5).toFixed(2)})`);
    const { s: f, cx: x2, cy: y2 } = advArena();
    const mc2 = put(f, 0, 'missilecarrier', x2 - 3.5, y2 + 0.5);
    put(f, 1, 'tank', x2 + 3.5, y2 + 0.5, { stance: 'hold' });
    const shot = tickUntil(f, st => st.projectiles.some(p => p.shooter === mc2.id), 80);
    ok(shot.projectiles.some(p => p.shooter === mc2.id && p.weapon === 'rocket'), 'at seven tiles it fires a rocket');
  }
  // The Rocket Turret reaches what a Gun Turret cannot.
  {
    const { s, cx, cy } = advArena();
    addBuilding(s, 0, 'rocketturret', cx, cy, -100);
    put(s, 1, 'tank', cx + 7.3, cy + 0.5, { stance: 'hold' });
    const t = processAction(s, { type: 'tick', n: 30 });
    ok(t.effects.some(e => e.kind === 'muzzle' && e.weapon === 'rocket'), 'the Rocket Turret fires at a tank seven tiles off');
    const g = copy(s);
    g.buildings = g.buildings.map(b => (b.kind === 'rocketturret' ? { ...b, kind: 'turret' as BuildingKind } : b));
    ok(!processAction(g, { type: 'tick', n: 30 }).effects.some(e => e.kind === 'muzzle'), 'a Gun Turret in the same place cannot reach');
  }
  // The Bastion mends itself out of combat, and not under fire.
  {
    const { s, cx, cy } = advArena();
    const b = put(s, 0, 'bastion', cx + 0.5, cy + 0.5, { hp: 500 });
    const tk = put(s, 0, 'tank', cx + 3.5, cy + 0.5, { hp: 200 });
    const t = processAction(s, { type: 'tick', n: 100 });
    ok(unitIn(t, b.id)!.hp === 500 + (UNITS.bastion.selfRepair ?? 0) * 10, `the Bastion regains ${UNITS.bastion.selfRepair} hp a second at rest (${unitIn(t, b.id)!.hp})`);
    ok(unitIn(t, tk.id)!.hp === 200, 'a Battle Tank does not');
    // Fighting a rocketeer that shoots back: never a hit point regained while engaged.
    let f = copy(s);
    put(f, 1, 'rocketeer', cx + 4.5, cy + 2.5);
    let mended = false;
    let fought = false;
    for (let i = 0; i < 40; i++) {
      const before = unitIn(f, b.id)!;
      f = processAction(f, { type: 'tick' });
      const after = unitIn(f, b.id);
      if (!after) break;
      if (before.engage) fought = true;
      if (before.engage && after.engage && after.hp > before.hp) mended = true;
    }
    ok(fought && !mended, 'fighting, it does not mend');
  }
}

function skirmishPowerTests(): void {
  const s = advanced('powers');
  ok(Array.isArray(s.powers) && Object.keys(s.powers![0]).length === 0 && Object.keys(s.powers![1]).length === 0, 'an advanced skirmish starts with no powers');
  refused(s, { type: 'power', power: 'recon', x: 30, y: 30 }, 'recon with no Uplink');
  for (const [power, kind] of Object.entries(SKIRMISH_POWERS) as [SupportPower, BuildingKind][]) {
    for (const owner of [0, 1] as Owner[]) {
      const c = copy(s);
      const b = addBuilding(c, owner, kind, owner === 0 ? 2 : MAP_W - 5, owner === 0 ? 2 : MAP_H - 5, -100);
      const t = processAction(c, { type: 'tick' });
      ok(t.powers![owner][power] === POWERS[power].cooldown, `${BUILDINGS[kind].name} grants side ${owner} the ${POWERS[power].name}, charging`);
      ok(t.powers![1 - owner][power] === undefined, `but not the other side`);
      const gone = copy(t);
      gone.buildings.find(v => v.id === b.id)!.hp = 0;
      ok(processAction(gone, { type: 'tick' }).powers![owner][power] === undefined, `losing the ${BUILDINGS[kind].name} loses the ${POWERS[power].name}`);
    }
  }
  // Through a real build: placing an Uplink grants recon at once; selling it takes it away.
  {
    const c = copy(s);
    grant(c, 0, ['power', 'refinery']);
    let t = act(c, { type: 'queue', category: 'building', kind: 'uplink' }, 'queue an uplink');
    t = tickUntil(t, x => readyStructure(x, 0) === 'uplink', 300);
    const spot = findSpot(t, 'uplink')!;
    t = act(t, { type: 'place', kind: 'uplink', x: spot.x, y: spot.y }, 'place the uplink');
    ok(t.powers![0].recon === POWERS.recon.cooldown, 'placing an Uplink grants recon, charging');
    refused(t, { type: 'power', power: 'recon', x: 30, y: 30 }, 'recon while charging');
    const ready = processAction(processAction(t, { type: 'tick', n: POWERS.recon.cooldown / 2 }), { type: 'tick', n: POWERS.recon.cooldown / 2 });
    ok(ready.powers![0].recon === 0 && powerProblem(ready, 0, 'recon', 30, 30) === null, 'charged, it is ready');
    const used = act(ready, { type: 'power', power: 'recon', x: 30.5, y: 12.5 }, 'recon in a skirmish');
    ok(used.recon!.length === 1 && used.powers![0].recon === POWERS.recon.cooldown, 'the sweep is under way and recharging');
    const up = used.buildings.find(b => b.kind === 'uplink' && b.owner === 0)!;
    const sold = act(used, { type: 'sell', id: up.id }, 'sell the uplink');
    ok(sold.powers![0].recon === undefined, 'selling the last Uplink loses recon at once');
  }
  // The computer's recon reveals nothing to the player; mission powers are left alone.
  {
    const c = copy(s);
    c.powers = [{}, { recon: 0, missile: 0 }];
    addBuilding(c, 1, 'uplink', MAP_W - 5, MAP_H - 5, -100);
    addBuilding(c, 1, 'strikecommand', MAP_W - 9, MAP_H - 9, -100);
    ok(powerProblem(c, 1, 'recon', 10, 50) === null, 'side 1 may call its powers');
    doPowerOn(c, 1, 'recon', 10.5, 50.5);
    ok((c.recon ?? []).length === 0 && c.powers![1].recon === POWERS.recon.cooldown, "side 1's sweep reveals nothing to the player, and recharges");
    doPowerOn(c, 1, 'missile', 10.5, 50.5);
    ok(c.effects.some(e => e.kind === 'missile') && c.log.some(l => l.tone === 'bad' && /missile/i.test(l.text)), 'an enemy missile is marked and announced');
    const m = createMissionState(mspec({ powers: ['recon'], player: { credits: 1000, structures: ['hq', 'power', 'refinery', 'uplink'], units: [], heroes: [] } }), mctx());
    const mt = processAction(m, { type: 'tick', n: 5 });
    ok(JSON.stringify(Object.keys(mt.powers![0])) === '["recon"]' && Object.keys(mt.powers![1]).length === 0, 'a mission keeps its own powers whatever stands');
  }
}

/** Calls a power for either side on a harness copy (the reducer only takes side 0's orders). */
function doPowerOn(s: GameState, owner: Owner, power: SupportPower, x: number, y: number): void {
  ok(powerProblem(s, owner, power, x, y) === null, `side ${owner} may call ${power}`);
  doPower(s, owner, power, x, y);
}

function missileTests(): void {
  const { s, cx, cy } = advArena();
  addBuilding(s, 0, 'strikecommand', 2, 2, -100);
  let a = processAction(s, { type: 'tick' });
  ok(a.powers![0].missile === POWERS.missile.cooldown, 'Strike Command: the missile charges');
  ok(POWERS.missile.cooldown >= 4200 && POWERS.missile.radius >= 3.5, 'about eight minutes between strikes, a radius of about four tiles');
  a = copy(a);
  a.powers![0].missile = 0;
  const c = { x: cx + 0.5, y: cy + 0.5 };
  const centre = put(a, 1, 'rifleman', c.x, c.y, { stance: 'hold' });
  const tank = put(a, 1, 'tank', c.x + 2, c.y, { stance: 'hold' });
  const gen = addBuilding(a, 1, 'power', cx - 2, cy - 2, -100);
  const outside = put(a, 1, 'rifleman', c.x + 5.5, c.y, { stance: 'hold' });
  const ours = put(a, 0, 'rifleman', c.x - 1, c.y + 1, { stance: 'hold' });
  const fired = act(a, { type: 'power', power: 'missile', ...c }, 'missile strike');
  const p = fired.projectiles.find(q => q.weapon === 'missile');
  ok(!!p && p.hitAt === fired.tick + FLIGHT_TICKS.missile && p.splash === POWERS.missile.radius, 'one missile, landing a few seconds later, with a wide blast');
  ok(fired.effects.some(e => e.kind === 'missile' && e.x === c.x && e.y === c.y && e.size === POWERS.missile.radius), 'the target is marked from the moment it is called');
  ok(fired.powers![0].missile === POWERS.missile.cooldown, 'and the missile goes back to charging');
  refused(fired, { type: 'power', power: 'missile', ...c }, 'a second missile at once');
  const before = processAction(fired, { type: 'tick', n: FLIGHT_TICKS.missile - 1 });
  ok(unitIn(before, centre.id)?.hp === UNITS.rifleman.hp && before.projectiles.some(q => q.weapon === 'missile'), 'nothing is hit before it lands');
  ok(before.effects.some(e => e.kind === 'missile'), 'the marker is still shown just before impact');
  const after = processAction(before, { type: 'tick', n: 2 });
  ok(!after.projectiles.some(q => q.weapon === 'missile'), 'the missile has landed');
  ok(!unitIn(after, centre.id), 'a soldier at the centre is killed');
  const th = unitIn(after, tank.id)?.hp ?? 0;
  ok(th < UNITS.tank.hp - MISSILE_DAMAGE * 0.5 * DAMAGE_VS.missile.heavy, `a tank two tiles off is badly hurt or worse (${th})`);
  ok(!after.buildings.some(b => b.id === gen.id), 'a Generator in the blast is destroyed');
  ok(unitIn(after, outside.id)?.hp === UNITS.rifleman.hp, 'outside the radius, untouched');
  ok(unitIn(after, ours.id)?.hp === UNITS.rifleman.hp, 'our own troops are spared');
  ok(after.effects.some(e => e.kind === 'boom' && e.weapon === 'missile' && e.size === 2), 'a big explosion is shown');
  invariants(after, 'after the missile');
}

function setupTests(): void {
  ok(JSON.stringify(normaliseSetup({})) === JSON.stringify(DEFAULT_SETUP), 'an empty setup is the default');
  const junk = normaliseSetup({ map: 'moon' as never, tech: 'x' as never, ore: 'y' as never, credits: 999999 });
  ok(junk.map === DEFAULT_SETUP.map && junk.tech === DEFAULT_SETUP.tech && junk.ore === DEFAULT_SETUP.ore, 'unknown choices fall back to the default');
  ok(junk.credits === SETUP_CREDITS_MAX && normaliseSetup({ credits: 5 }).credits === SETUP_CREDITS_MIN, 'credits are clamped');
  ok(normaliseSetup({ credits: 1234 }).credits === 1200 && normaliseSetup({ credits: NaN }).credits === DEFAULT_SETUP.credits, 'credits round to hundreds; NaN is the default');

  const s = createInitialState('st', 'st', { seed: 'setup-1', createdAt: 0, setup: { map: 'river', credits: 10000, ore: 'rich' } });
  ok(s.setup!.map === 'river' && s.mapType === 'river' && s.setup!.tech === 'advanced' && s.setup!.ore === 'rich', 'the setup is stored, unspecified fields from the default');
  ok(s.players[0].credits === 10000 && s.players[1].credits === 10000, 'both sides start with the chosen credits');
  ok(s.tiles === generateSkirmishMap(seedFromString('setup-1'), 'river', 'rich').tiles, 'the map is the skirmish generator\'s for that seed and type');
  for (const owner of [0, 1] as Owner[]) {
    const hq = hqOf(s, owner);
    ok(hq.x === s.starts![owner].x && hq.y === s.starts![owner].y && startOf(s, owner) === s.starts![owner], `side ${owner}'s yard sits on its start`);
  }
  ok(s.buildings.length === 2 && s.units.length === 6, 'a yard and three riflemen each');
  invariants(s, 'setup start');

  const seen = new Set<MapType>();
  for (let i = 0; i < 40; i++) {
    const r = createInitialState('r', 'r', { seed: `rnd-${i}`, createdAt: 0, setup: { map: 'random' } });
    ok(r.setup!.map === 'random' && MAP_TYPES.includes(r.mapType!), `random setup resolves to a type (${r.mapType})`);
    ok(r.mapType === randomMapType(seedFromString(`rnd-${i}`)), 'from the seed');
    seen.add(r.mapType!);
  }
  ok(seen.size >= 5, `random maps cover the types (${seen.size} of ${MAP_TYPES.length} in 40 games)`);
  const counts = new Map<MapType, number>();
  for (let i = 0; i < 1200; i++) {
    const t = randomMapType(seedFromString(`r${i}`));
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  ok(MAP_TYPES.every(t => (counts.get(t) ?? 0) >= 120), `every type comes up often (${MAP_TYPES.map(t => counts.get(t) ?? 0).join(', ')} in 1200)`);

  // Ore settings.
  const total = (o: OreLevel) => generateSkirmishMap(seedFromString('ore'), 'plains', o).ore.reduce((a, b) => a + b, 0);
  ok(total('poor') < total('normal') && total('normal') < total('rich'), `poor < normal < rich (${total('poor')}, ${total('normal')}, ${total('rich')})`);

  // No setup: the original game on the original map.
  const legacy = createInitialState('l', 'l', { seed: 'legacy-map', createdAt: 0 });
  ok(!legacy.setup && !legacy.mapType && !legacy.starts, 'no setup: none recorded');
  ok(legacy.tiles === generateMap(seedFromString('legacy-map')).tiles, 'no setup: the original generator');
  ok(startOf(legacy, 0) === START_0 && startOf(legacy, 1) === START_1, 'no setup: the original start sites');
  ok(legacy.players[0].credits === 3000, 'no setup: 3000 credits');

  // Saves.
  const round = migrateState(JSON.parse(JSON.stringify(s)));
  ok(!!round && JSON.stringify(round) === JSON.stringify(s), 'a set-up skirmish survives a save and load unchanged');
  const bad = migrateState({ ...JSON.parse(JSON.stringify(s)), setup: { map: 'moon', tech: 'standard', credits: 'lots', ore: 'rich' }, starts: 'here', mapType: 'moon' });
  ok(!!bad && bad.setup!.map === 'classic' && bad.setup!.tech === 'standard' && bad.setup!.credits === 3000, 'a damaged setup is repaired from the original game');
  ok(!!bad && bad.starts === undefined && bad.mapType === undefined, 'damaged starts and map type are dropped');
  const old = migrateState(JSON.parse(JSON.stringify(legacy)));
  ok(!!old && !old.setup && setupOf(old) === LEGACY_SETUP, 'an old save plays as the original game');

  // A set-up battle replays exactly, through a save in the middle.
  const go = (st: GameState, n: number) => {
    for (let i = 0; i < n; i++) st = processAction(st, { type: 'tick', n: 100 });
    return st;
  };
  const base = createInitialState('rp', 'rp', { seed: 'replay-adv', createdAt: 0, autopilot: true, setup: { map: 'canyon' } });
  const one = go(base, 30);
  const two = go(migrateState(JSON.parse(JSON.stringify(go(base, 15))))!, 15);
  ok(JSON.stringify(one) === JSON.stringify(two), 'an advanced battle replays byte-identically through a save');
}

/** Every map type over many seeds: the rules every skirmish map must meet. */
function mapTests(): void {
  const per = Math.max(24, SEEDS + 10);
  const ores: OreLevel[] = ['poor', 'normal', 'rich'];
  const N = MAP_W * MAP_H;
  for (const type of MAP_TYPES) {
    const xs = new Set<number>();
    let fieldsMin = 99;
    let fieldsMax = 0;
    let problems = 0;
    for (let i = 0; i < per; i++) {
      const ore = ores[i % 3];
      const seed = `${type}-map-${i}`;
      const m = generateSkirmishMap(seedFromString(seed), type, ore);
      const label = `${type} ${seed}`;
      const problem = mapProblem(m);
      if (problem) problems++;
      ok(problem === null, `${label}: ${problem}`);
      // Independent checks, not trusting mapProblem.
      let sym = true;
      for (let k = 0; k < N; k++) if (m.tiles[k] !== m.tiles[N - 1 - k] || m.ore[k] !== m.ore[N - 1 - k]) sym = false;
      ok(sym, `${label}: point-symmetric`);
      const [s0, s1] = m.starts;
      ok(s0.y >= MAP_H / 2 && s1.y + 3 <= MAP_H / 2, `${label}: side 0 starts in the bottom half, side 1 in the top`);
      ok(s1.x === MAP_W - 3 - s0.x && s1.y === MAP_H - 3 - s0.y, `${label}: the starts mirror each other`);
      xs.add(s0.x);
      const a = (s0.y + 1) * MAP_W + s0.x + 1;
      const b = (s1.y + 1) * MAP_W + s1.x + 1;
      const walk = shortestWalk(m.tiles, a, b);
      ok(walk.length > 0, `${label}: the bases are connected`);
      // Everything walkable is reachable from side 0's base.
      const reach = new Uint8Array(N);
      const q = [a];
      reach[a] = 1;
      while (q.length) {
        const k = q.pop()!;
        const x = k % MAP_W;
        const y = (k / MAP_W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
          const n = ny * MAP_W + nx;
          if (reach[n] || !isWalkable(m.tiles[n])) continue;
          reach[n] = 1;
          q.push(n);
        }
      }
      let stray = 0;
      for (let k = 0; k < N; k++) if (isWalkable(m.tiles[k]) && !reach[k]) stray++;
      ok(stray === 0, `${label}: all walkable ground reachable (${stray} stray tiles)`);
      // Ore: four to eight fields, one near each base, one contested between them.
      const fields = oreFields(m.ore).filter(f => f.length >= 5);
      fieldsMin = Math.min(fieldsMin, fields.length);
      fieldsMax = Math.max(fieldsMax, fields.length);
      ok(fields.length >= 4 && fields.length <= 8, `${label}: ${fields.length} ore fields`);
      const c0 = { x: s0.x + 1.5, y: s0.y + 1.5 };
      const c1 = { x: s1.x + 1.5, y: s1.y + 1.5 };
      const centroids = fields.map(f => {
        let x = 0;
        let y = 0;
        for (const k of f) {
          x += (k % MAP_W) + 0.5;
          y += ((k / MAP_W) | 0) + 0.5;
        }
        return { x: x / f.length, y: y / f.length };
      });
      ok(centroids.some(p => dist(p.x, p.y, c0.x, c0.y) < 16), `${label}: an ore field near side 0's base`);
      ok(centroids.some(p => Math.abs(dist(p.x, p.y, c0.x, c0.y) - dist(p.x, p.y, c1.x, c1.y)) < 3), `${label}: a contested field, as far from one base as the other`);
      ok(centroids.filter(p => dist(p.x, p.y, c0.x, c0.y) < dist(p.x, p.y, c1.x, c1.y) - 3).length >= 2, `${label}: side 0 has its own field and an expansion`);
      // Two routes: cut a band round the shortest walk and another way through remains.
      const second = secondRoute(m);
      ok(second.length > 0, `${label}: a second route when the shortest is cut`);
      if (second.length) {
        const first = new Set(walk);
        const shared = second.filter(k => first.has(k)).length;
        ok(shared < second.length * 0.6, `${label}: and it is a different way (${shared} of ${second.length} tiles shared)`);
      }
    }
    // Both bases buildable, in a real battle on this map type.
    for (let i = 0; i < 6; i++) {
      const st = createInitialState('b', 'b', { seed: `${type}-base-${i}`, createdAt: 0, setup: { map: type, ore: ores[i % 3] } });
      ok(st.mapType === type, `${type}: the setup's type is the one generated`);
      const occ = occupancy(st);
      for (const owner of [0, 1] as Owner[]) {
        const hq = hqOf(st, owner);
        let gens = 0;
        let refineries = 0;
        let factories = 0;
        for (let y = hq.y - 7; y <= hq.y + 7; y++)
          for (let x = hq.x - 7; x <= hq.x + 7; x++) {
            if (placementProblem(st, owner, 'power', x, y, occ) === null) gens++;
            if (placementProblem(st, owner, 'refinery', x, y, occ) === null) refineries++;
            if (placementProblem(st, owner, 'factory', x, y, occ) === null) factories++;
          }
        ok(gens >= 40 && refineries >= 10 && factories >= 10, `${type} base ${i}, side ${owner}: room to build (${gens} Generator, ${refineries} Refinery, ${factories} War Factory sites)`);
      }
      invariants(st, `${type} base ${i}`);
    }
    ok(xs.size >= Math.min(8, per / 3), `${type}: the bases' position varies with the seed (${xs.size} different x positions)`);
    console.log(`  ${type}: ${per} maps, ${problems} problems, ore fields ${fieldsMin}-${fieldsMax}, ${xs.size} base positions`);
  }
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
  ['Mission AI modes', missionAiModes],
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
  const freeplay: [string, () => void][] = [
    ['New tech: stats, menus and requirements', newTech],
    ['Standard tech and mission tech lists', standardTech],
    ['Sandbag walls', noCommander(wallTests)],
    ['The Medic', noCommander(medicTests)],
    ['The Repair Bay', noCommander(repairBayTests)],
    ['New weapons: splash, flame, minimum range, rocket turret, self-repair', noCommander(weaponTests)],
    ['Skirmish support powers', noCommander(skirmishPowerTests)],
    ['The missile strike', noCommander(missileTests)],
    ['Skirmish setup options', setupTests],
    ['Map types', mapTests],
  ];
  for (const [name, fn] of freeplay) {
    const t0 = Date.now();
    console.log(name);
    fn();
    if (Date.now() - t0 > 2000) console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
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

// Every map type, advanced tech, computer against computer: both commanders build the new tech,
// so every battle runs the new rules, maps and powers.
const mapRuns: { seed: string; map: MapType; winner: number | null; tick: number }[] = [];
const perMap = Math.max(2, Math.round(SEEDS / 10));
console.log(`Battles: ${perMap} on each map type, advanced tech`);
for (const map of MAP_TYPES) {
  for (let i = 1; i <= perMap; i++) {
    const seed = `map-${map}-${i}`;
    const s = battle(seed, 'normal', { map, tech: 'advanced' });
    ok(s.mapType === map && s.setup?.tech === 'advanced', `${seed}: played on its map type`);
    mapRuns.push({ seed, map, winner: s.winner, tick: s.tick });
    ok(s.players[0].stats.harvested > 0 && s.players[1].stats.harvested > 0, `${seed}: both sides harvested ore`);
    ok(s.players[0].stats.killed + s.players[1].stats.killed > 0, `${seed}: there was fighting`);
  }
}
{
  const done = mapRuns.filter(r => r.winner !== null);
  ok(done.length >= Math.ceil(mapRuns.length * 0.85), `at least 85% of map-type battles finish (${done.length}/${mapRuns.length})`);
  const avgM = done.reduce((a, r) => a + r.tick / 600, 0) / Math.max(1, done.length);
  const w0 = done.filter(r => r.winner === 0).length;
  console.log(`  ${done.length}/${mapRuns.length} finished, average ${avgM.toFixed(1)} game minutes; side 0 won ${w0}, side 1 won ${done.length - w0}`);
  for (const map of MAP_TYPES) {
    const rs = mapRuns.filter(r => r.map === map);
    console.log(`    ${map}: ${rs.map(r => (r.winner === null ? 'unfinished' : `side ${r.winner} in ${Math.round(r.tick / 600)} min`)).join(', ')}`);
  }
}

console.log(`  units standing at the end with rank: ${seen.veterans} veterans, ${seen.elites} elites; at least ${seen.survivors} survivors walked out of fallen structures`);
ok(seen.veterans + seen.elites > 0, 'units earn rank in real battles');
ok(seen.survivors > 0, 'crews walk out of fallen structures in real battles');

console.log(`\n${assertions} assertions, ${failures} failed, ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (failures) process.exit(1);
console.log('All checks passed');
