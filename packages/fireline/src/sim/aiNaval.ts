import { fund, queueStructure } from './aiAir';
import { canQueue, doAttack, doMove, doQueue, placementProblem } from './commands';
import { buildingCentre, dist, occupancy } from './grid';
import { isShip } from './naval';
import { BUILDINGS, DIFFICULTIES, NAVAL_MIN_SEA, UNITS, hitsGround, type Difficulty, type Owner, type UnitKind } from './rules';
import { isEnemy } from './sides';
import { countBuildings, maxHpOf, techAllowed, unlocked } from './state';
import { canRide, doBoard, doUnload } from './transport';
import type { Building, GameState, Unit } from './types';

/**
 * The computer commander's navy (the naval war, 2026-11-11). Called once a decision from the
 * commander in ai.ts, after the air plan; advanced tech only, never in a mission, and only where its
 * base has a sea within reach that the opponent's base also borders (worked out once, kept in
 * `AiMemory.navalShore`). On any map without one it returns at once and nothing changes.
 *
 *  - A Naval Yard on the shore, once the economy stands. If the shore is beyond building range it
 *    builds Generators toward the sea first (`navalCreep`, read by findSpot in ai.ts), at most three.
 *  - Ships to the difficulty's plan, while credits allow.
 *  - Defence: enemy ships near its shore draw every warship.
 *  - Strikes: a fleet sails at the opponent's Naval Yard, or else the structure nearest the sea; the
 *    Battleship shells it from range; Submarines hunt the nearest enemy ship.
 *  - Landings (Normal and Hard): the Landing Craft takes idle troops from home to the opponent's
 *    refinery nearest the sea, sets them down and sends them in.
 *  - Damaged ships go home to be mended beside the Naval Yard.
 */

interface NavalTactics {
  gunboats: number;
  destroyers: number;
  submarines: number;
  battleships: number;
  landingcraft: number;
  /** Warships that sail together on a strike. */
  fleet: number;
  /** Ticks between strikes. */
  strikeInterval: number;
  /** Places of troops a landing takes (a vehicle two), and the least it goes with. */
  landing: number;
}

const NAVAL_TACTICS: Record<Difficulty, NavalTactics> = {
  easy: { gunboats: 2, destroyers: 0, submarines: 0, battleships: 0, landingcraft: 0, fleet: 2, strikeInterval: 3000, landing: 0 },
  normal: { gunboats: 2, destroyers: 2, submarines: 1, battleships: 0, landingcraft: 1, fleet: 3, strikeInterval: 1800, landing: 5 },
  hard: { gunboats: 2, destroyers: 3, submarines: 2, battleships: 1, landingcraft: 1, fleet: 4, strikeInterval: 1500, landing: 6 },
};

/** How far from home the commander looks for a sea, and how near the opponent's base it must come. */
const SEA_FROM_HOME = 20;
const SEA_FROM_ENEMY = 20;
/** Generators it may build toward the shore before giving up on a Naval Yard. */
const MAX_CREEP = 3;
/** A ship this hurt goes home to be mended. */
const MEND_BELOW = 0.4;
/** Ticks a landing may spend boarding, and sailing, before it gives up. */
const LANDING_BOARD_TICKS = 900;
const LANDING_SAIL_TICKS = 2400;

/**
 * The water tile of a sea near home that also reaches the opponent's base, or null for none. A sea
 * is a body of open water of at least twice NAVAL_MIN_SEA tiles.
 */
function findSea(s: GameState, owner: Owner, home: { x: number; y: number }, enemy: Building[]): [number, number] | null {
  const W = s.mapW;
  const H = s.mapH;
  const comp = new Int32Array(W * H).fill(-1);
  const sizes: number[] = [];
  for (let k = 0; k < W * H; k++) {
    if (s.tiles.charCodeAt(k) !== 119 || comp[k] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    const stack = [k];
    comp[k] = id;
    while (stack.length) {
      const c = stack.pop()!;
      n++;
      const x = c % W;
      const y = (c / W) | 0;
      if (x > 0 && comp[c - 1] < 0 && s.tiles.charCodeAt(c - 1) === 119) (comp[c - 1] = id), stack.push(c - 1);
      if (x < W - 1 && comp[c + 1] < 0 && s.tiles.charCodeAt(c + 1) === 119) (comp[c + 1] = id), stack.push(c + 1);
      if (y > 0 && comp[c - W] < 0 && s.tiles.charCodeAt(c - W) === 119) (comp[c - W] = id), stack.push(c - W);
      if (y < H - 1 && comp[c + W] < 0 && s.tiles.charCodeAt(c + W) === 119) (comp[c + W] = id), stack.push(c + W);
    }
    sizes.push(n);
  }
  // Which seas come near the opponent's base: one pass over the water.
  const centres = enemy.map(buildingCentre);
  const reaches = new Uint8Array(sizes.length);
  for (let k = 0; k < W * H; k++) {
    const id = comp[k];
    if (id < 0 || reaches[id] || sizes[id] < NAVAL_MIN_SEA * 2) continue;
    const x = (k % W) + 0.5;
    const y = ((k / W) | 0) + 0.5;
    if (centres.some(c => dist(x, y, c.x, c.y) < SEA_FROM_ENEMY)) reaches[id] = 1;
  }
  let best: [number, number] | null = null;
  let bestD = SEA_FROM_HOME;
  for (let k = 0; k < W * H; k++) {
    const id = comp[k];
    if (id < 0 || !reaches[id]) continue;
    const x = (k % W) + 0.5;
    const y = ((k / W) | 0) + 0.5;
    const d = dist(x, y, home.x, home.y);
    if (d < bestD) {
      bestD = d;
      best = [x, y];
    }
  }
  return best;
}

/**
 * Where the commander puts a Naval Yard: the legal spot nearest its home within 14 tiles of its
 * shore point, or null. For findSpot in ai.ts.
 */
export function navalSpot(s: GameState, owner: Owner, home: { x: number; y: number }): { x: number; y: number } | null {
  const shore = s.ai[owner].navalShore;
  if (!shore) return null;
  const occ = occupancy(s);
  const spec = BUILDINGS.shipyard;
  const cands: [number, number, number][] = [];
  for (let y = Math.floor(shore[1]) - 14; y <= shore[1] + 14; y++)
    for (let x = Math.floor(shore[0]) - 14; x <= shore[0] + 14; x++) cands.push([x, y, dist(x + spec.w / 2, y + spec.h / 2, home.x, home.y)]);
  cands.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  for (const [x, y] of cands) if (placementProblem(s, owner, 'shipyard', x, y, occ) === null) return { x, y };
  return null;
}

/** Where findSpot in ai.ts aims a Generator while the commander builds toward the shore, or null. */
export function creepFocus(s: GameState, owner: Owner): { x: number; y: number } | null {
  const m = s.ai[owner];
  return m.navalCreep && m.navalShore ? { x: m.navalShore[0], y: m.navalShore[1] } : null;
}

export function navalPlan(s: GameState, owner: Owner, home: { x: number; y: number }, enemy: Building[], foes: Unit[], hold = false): void {
  if (s.mission || !techAllowed(s, owner, 'shipyard')) return;
  const mem = s.ai[owner];
  if (mem.navalShore === undefined) {
    // Measured against every enemy structure, seen or not: the map is the map. Not settled until
    // there is an enemy base to measure against.
    const theirs = s.buildings.filter(b => b.hp > 0 && isEnemy(s, owner, b.owner));
    if (!theirs.length) return;
    mem.navalShore = findSea(s, owner, home, theirs);
  }
  if (!mem.navalShore) return;
  const diff: Difficulty = owner === 0 && s.autopilotDifficulty ? s.autopilotDifficulty : s.difficulty;
  const d = DIFFICULTIES[diff];
  const t = NAVAL_TACTICS[diff];
  const p = s.players[owner];
  const count = (k: Parameters<typeof countBuildings>[2]) => countBuildings(s, owner, k);
  const mine = s.units.filter(u => u.owner === owner);
  const ships = mine.filter(isShip);
  const queued = (kind: UnitKind) => mine.filter(u => u.kind === kind).length + (p.queues.naval ?? []).filter(i => i.kind === kind).length;

  // With no refinery or no hauler the economy comes first: no yard and no ships are bought (their
  // funding would take back the last troops a broke side is training), only the fleet is fought.
  const crisis = count('refinery') === 0 || !mine.some(u => u.kind === 'hauler');
  // 1. The Naval Yard, once the economy stands; Generators toward the shore if it is out of reach.
  const based = count('factory') > 0 && count('refinery') >= Math.min(2, d.refineries);
  const yard = s.buildings.find(b => b.owner === owner && b.kind === 'shipyard' && b.hp > 0) ?? null;
  const building = p.queues.building.some(q => q.kind === 'shipyard');
  if (!yard && based && !crisis && !building && p.queues.building.length === 0) {
    if (navalSpot(s, owner, home)) {
      mem.navalCreep = false;
      queueStructure(s, owner, 'shipyard');
    } else if ((mem.navalCreepSteps ?? 0) < MAX_CREEP) {
      mem.navalCreep = true;
      mem.navalCreepSteps = (mem.navalCreepSteps ?? 0) + 1;
      queueStructure(s, owner, 'power');
    }
  }
  if (!yard) return;

  // 2. Ships, to the plan. Not while paced research holds unit purchases (`hold`, from ai.ts), nor
  // in an economic crisis.
  if (!hold && !crisis && (p.queues.naval ?? []).length === 0) {
    const plan: [UnitKind, number][] = [
      ['gunboat', t.gunboats],
      ['destroyer', t.destroyers],
      ['landingcraft', t.landingcraft],
      ['submarine', t.submarines],
      ['battleship', t.battleships],
    ];
    const want = plan.find(([k, n]) => queued(k) < n && unlocked(s, owner, k));
    if (want && fund(s, owner, UNITS[want[0]].cost) && canQueue(s, owner, 'naval', want[0])) doQueue(s, owner, 'naval', want[0]);
  }

  // 3. The fleet.
  const yc = buildingCentre(yard);
  const shore = { x: mem.navalShore[0], y: mem.navalShore[1] };
  const enemyShips = foes.filter(f => isShip(f) && isEnemy(s, owner, f.owner) && (!UNITS[f.kind].stealth || f.lastShot !== undefined));
  const warships = ships.filter(u => UNITS[u.kind].weapon);
  // Hurt ships home first.
  for (const u of warships) {
    if (u.hp < maxHpOf(u) * MEND_BELOW && dist(u.x, u.y, yc.x, yc.y) > 4 && u.order.type !== 'move') doMove(s, owner, [u.id], yc.x, yc.y, false);
  }
  const fit = warships.filter(u => u.hp >= maxHpOf(u) * MEND_BELOW);
  // Defence: enemy ships near our shore draw every fit warship.
  const raider = enemyShips.find(f => dist(f.x, f.y, shore.x, shore.y) < 16 || dist(f.x, f.y, yc.x, yc.y) < 16);
  if (raider) {
    const ids = fit.filter(u => u.order.type !== 'attack').map(u => u.id);
    if (ids.length) doMove(s, owner, ids, raider.x, raider.y, true);
  } else {
    // Submarines hunt the nearest enemy ship.
    for (const u of fit) {
      if (u.kind !== 'submarine' || u.order.type !== 'idle' || !enemyShips.length) continue;
      const prey = enemyShips.reduce((a, b) => (dist(u.x, u.y, a.x, a.y) <= dist(u.x, u.y, b.x, b.y) ? a : b));
      doAttack(s, owner, [u.id], prey.id);
    }
    // Strikes: the fleet at the opponent's Naval Yard, or the structure nearest the sea.
    const idle = fit.filter(u => u.order.type === 'idle' && u.kind !== 'submarine');
    if (s.tick >= (mem.nextNavalStrike ?? 0) && idle.length >= t.fleet) {
      const target = coastalTarget(s, enemy);
      if (target) {
        const c = buildingCentre(target);
        const guns = idle.filter(u => u.kind === 'battleship').map(u => u.id);
        const rest = idle.filter(u => u.kind !== 'battleship').map(u => u.id);
        if (rest.length) doMove(s, owner, rest, c.x, c.y, true);
        if (guns.length) doAttack(s, owner, guns, target.id);
        mem.nextNavalStrike = s.tick + t.strikeInterval;
      }
    }
  }

  // 4. Landings.
  if (t.landing) landing(s, owner, t, home, enemy, ships, yard);
}

/**
 * The opponent's Naval Yard, or else its structure nearest open water, within `reach` tiles of it:
 * where a fleet can shoot (8) or a landing can walk (14).
 */
function coastalTarget(s: GameState, enemy: Building[], reach = 8): Building | null {
  const yard = enemy.find(b => b.kind === 'shipyard');
  if (yard) return yard;
  let best: Building | null = null;
  let bestD = reach + 1;
  for (const b of enemy) {
    const spec = BUILDINGS[b.kind];
    for (let y = b.y - reach; y <= b.y + spec.h + reach; y++)
      for (let x = b.x - reach; x <= b.x + spec.w + reach; x++) {
        if (x < 0 || y < 0 || x >= s.mapW || y >= s.mapH || s.tiles.charCodeAt(y * s.mapW + x) !== 119) continue;
        const c = buildingCentre(b);
        const d = dist(x + 0.5, y + 0.5, c.x, c.y);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
  }
  return best;
}

/**
 * A landing: the Landing Craft, idle by its yard, takes idle armed troops from home (not in a wave,
 * a raid or a site party), sails at the opponent's refinery nearest the sea (or any coastal
 * structure), sets them down and sends them in. One at a time, every two strike intervals.
 */
function landing(s: GameState, owner: Owner, t: NavalTactics, home: { x: number; y: number }, enemy: Building[], ships: Unit[], yard: Building): void {
  const mem = s.ai[owner];
  const lift = mem.landing ?? null;
  if (lift) {
    const c = ships.find(u => u.id === lift.craft);
    if (!c) {
      mem.landing = null;
      return;
    }
    const aboard = c.carried?.length ?? 0;
    if (lift.phase === 'board') {
      const walking = s.units.filter(u => lift.ids.includes(u.id) && u.boarding === c.id).length;
      const late = s.tick - lift.since > LANDING_BOARD_TICKS;
      if (aboard > 0 && (walking === 0 || late)) {
        doMove(s, owner, [c.id], lift.x, lift.y, false);
        doUnload(s, owner, c.id);
        mem.landing = { ...lift, ids: lift.ids.slice(), phase: 'sail', since: s.tick };
      } else if (walking === 0 || late) mem.landing = null;
      return;
    }
    if (aboard === 0) {
      const out = s.units.filter(u => lift.ids.includes(u.id) && u.owner === owner).map(u => u.id);
      const tgt = s.buildings.find(b => b.id === lift.target && b.hp > 0);
      if (out.length) {
        if (tgt) doAttack(s, owner, out, tgt.id);
        else doMove(s, owner, out, lift.x, lift.y, true);
      }
      const yc = buildingCentre(yard);
      doMove(s, owner, [c.id], yc.x, yc.y, false);
      mem.landing = null;
    } else if (s.tick - lift.since > LANDING_SAIL_TICKS) {
      if (!c.drop) doUnload(s, owner, c.id);
      mem.landing = null;
    }
    return;
  }
  if (s.tick < (mem.nextLanding ?? 0) || !enemy.length) return;
  const yc = buildingCentre(yard);
  const c = ships.find(u => u.kind === 'landingcraft' && u.order.type === 'idle' && !u.carried?.length && dist(u.x, u.y, yc.x, yc.y) < 8);
  if (!c) return;
  const busy = new Set([...(mem.waveIds ?? []), ...(mem.raidIds ?? []), ...(mem.siteParties ?? []).flatMap(q => q.ids), ...(mem.airlift?.ids ?? [])]);
  const cap = UNITS[c.kind].carries ?? 0;
  const troops: Unit[] = [];
  let used = 0;
  const pool = s.units
    .filter(u => u.owner === owner && canRide(u, c) && UNITS[u.kind].weapon && hitsGround(UNITS[u.kind].weapon!) && u.order.type === 'idle' && !busy.has(u.id) && dist(u.x, u.y, home.x, home.y) < 16)
    .sort((a, b) => dist(a.x, a.y, c.x, c.y) - dist(b.x, b.y, c.x, c.y) || a.id - b.id);
  for (const u of pool) {
    const slots = UNITS[u.kind].category === 'vehicle' ? 2 : 1;
    if (used + slots > Math.min(cap, t.landing)) continue;
    troops.push(u);
    used += slots;
  }
  if (used < Math.min(4, t.landing)) return;
  const refineries = enemy.filter(b => b.kind === 'refinery');
  // A refinery the troops can walk to from a beach; else any structure they can.
  const target = (refineries.length ? coastalTarget(s, refineries, 14) : null) ?? coastalTarget(s, enemy, 14);
  if (!target) return;
  const tc = buildingCentre(target);
  doBoard(s, owner, troops.map(u => u.id), c.id);
  mem.landing = { craft: c.id, ids: troops.map(u => u.id), x: tc.x, y: tc.y, target: target.id, phase: 'board', since: s.tick };
  mem.nextLanding = s.tick + 2 * t.strikeInterval;
}
