import { airRoom, ammoMax, isAir, parkAircraft } from './air';
import { canQueue, doAttack, doQueue, doSell } from './commands';
import { buildingCentre, dist, distToBuilding } from './grid';
import { canResearch, doResearch } from './research';
import { BUILDINGS, DIFFICULTIES, MAX_QUEUE, UNITS, UPGRADES, type BuildingKind, type Difficulty, type Owner, type UnitKind, type UpgradeId } from './rules';
import { costFor, countBuildings, powerOf, techAllowed, unlocked } from './state';
import { isEnemy } from './sides';
import type { Building, GameState, Unit } from './types';

/**
 * The computer commander's air power, anti-air and research (fireline-round4-design.md, workstream
 * A). Called once a decision from the commander in ai.ts, after its own structures and units, and
 * only on advanced tech (never in a mission, never on standard tech, where it returns at once).
 *
 *  - Anti-air in proportion to the opponent's aircraft: Skyhunters, Flak Tracks and Flak Cannons,
 *    and none at all while the opponent has no aircraft.
 *  - Once its economy and the plan's turrets stand, and out of credits to spare: a Research Lab, then
 *    a Helipad (two on Hard).
 *  - Research in a fixed order by difficulty, while credits allow.
 *  - Aircraft up to its plan and its Helipads' room.
 *  - Strikes: Gunships at the opponent's haulers and artillery, where the fewest anti-air guns
 *    cover them; Bombers at the thickest cluster of its structures. Aircraft not on a strike are
 *    kept parked on their pads (a rearm order), so the ground army's waves never take them along.
 */

interface AirTactics {
  helipads: number;
  gunships: number;
  bombers: number;
  research: UpgradeId[];
  /** Gunships that go together on a strike. */
  gunshipGroup: number;
  /** Ticks between strikes. */
  strikeInterval: number;
  /** Anti-air wanted per enemy aircraft: Skyhunters, Flak Tracks; Flak Cannons per two aircraft. */
  skyhuntersPer: number;
  flaktracksPer: number;
  flakCannons: number;
}

/**
 * Ore left on the map (credits' worth) below which nothing new goes on air or research. Maps start
 * with 50,000 to 75,000 and are mostly mined out between the 20th and 30th minute.
 */
const AIR_ORE_FLOOR = 20000;

const AIR_TACTICS: Record<Difficulty, AirTactics> = {
  easy: {
    helipads: 1,
    gunships: 1,
    bombers: 0,
    research: ['refining'],
    gunshipGroup: 1,
    strikeInterval: 3000,
    skyhuntersPer: 1,
    flaktracksPer: 0,
    flakCannons: 1,
  },
  normal: {
    helipads: 1,
    gunships: 1,
    bombers: 1,
    research: ['refining', 'plating', 'calibration', 'airframes', 'engines'],
    gunshipGroup: 1,
    strikeInterval: 1500,
    skyhuntersPer: 2,
    flaktracksPer: 0.5,
    flakCannons: 2,
  },
  hard: {
    helipads: 2,
    gunships: 2,
    bombers: 2,
    research: ['refining', 'calibration', 'plating', 'engines', 'airframes'],
    gunshipGroup: 2,
    strikeInterval: 1200,
    skyhuntersPer: 2,
    flaktracksPer: 1,
    flakCannons: 3,
  },
};

/** The structures and anti-air units that count as anti-air cover, and how far each reaches. */
function coverOf(enemy: Building[], foes: Unit[]): { x: number; y: number; r: number; b?: Building }[] {
  const out: { x: number; y: number; r: number; b?: Building }[] = [];
  for (const b of enemy) if (b.kind === 'flakcannon') out.push({ x: b.x + 0.5, y: b.y + 0.5, r: (BUILDINGS.flakcannon.weapon?.range ?? 7) + 1, b });
  for (const u of foes) {
    if (u.kind !== 'flaktrack' && u.kind !== 'skyhunter') continue;
    out.push({ x: u.x, y: u.y, r: (UNITS[u.kind].weapon?.range ?? 6) + 1 });
  }
  return out;
}

/** How many anti-air guns cover the point (x, y). */
function danger(cover: { x: number; y: number; r: number; b?: Building }[], x: number, y: number): number {
  let n = 0;
  for (const c of cover) if ((c.b ? distToBuilding(x, y, c.b) : dist(x, y, c.x, c.y)) <= c.r) n++;
  return n;
}

export function airPlan(s: GameState, owner: Owner, home: { x: number; y: number }, enemy: Building[], foes: Unit[]): void {
  if (s.mission || !techAllowed(s, owner, 'helipad')) return;
  const diff: Difficulty = owner === 0 && s.autopilotDifficulty ? s.autopilotDifficulty : s.difficulty;
  const d = DIFFICULTIES[diff];
  const t = AIR_TACTICS[diff];
  const p = s.players[owner];
  const count = (k: BuildingKind) => countBuildings(s, owner, k);
  const mine = s.units.filter(u => u.owner === owner);
  const queued = (kind: UnitKind) => mine.filter(u => u.kind === kind).length + Object.values(p.queues).reduce((a, q) => a + (q ?? []).filter(i => i.kind === kind).length, 0);

  // With no refinery or no hauler the economy comes first: strikes only.
  const crisis = count('refinery') === 0 || !mine.some(u => u.kind === 'hauler');
  // The commander spends every credit on units as it comes in. Anything here is paid for by taking
  // back units queued but not yet started, and (but for anti-air) only once the army at home is up
  // to the next wave's size and to the opponent's army, as the commander's own extras are.
  const mem = s.ai[owner];
  const armed = mine.filter(u => UNITS[u.kind].weapon && !isAir(u)).length;
  const foeArmy = foes.filter(u => UNITS[u.kind].weapon && !isAir(u)).length;
  const armyReady = armed >= Math.max(Math.min(d.waveCap, d.firstWave + mem.wave * d.waveGrowth), foeArmy * 0.9);

  // 1. Anti-air, in proportion to what the opponent flies.
  const foeAir = foes.filter(isAir).length;
  if (foeAir > 0 && !crisis) {
    if (queued('skyhunter') < Math.min(8, Math.ceil(foeAir * t.skyhuntersPer)) && p.queues.infantry.length < MAX_QUEUE && fund(s, owner, UNITS.skyhunter.cost))
      if (canQueue(s, owner, 'infantry', 'skyhunter')) doQueue(s, owner, 'infantry', 'skyhunter');
    if (queued('flaktrack') < Math.min(4, Math.ceil(foeAir * t.flaktracksPer)) && p.queues.vehicle.length < MAX_QUEUE && fund(s, owner, UNITS.flaktrack.cost))
      if (canQueue(s, owner, 'vehicle', 'flaktrack')) doQueue(s, owner, 'vehicle', 'flaktrack');
    const cannons = count('flakcannon') + (p.queues.building.some(q => q.kind === 'flakcannon') ? 1 : 0);
    if (cannons < Math.min(t.flakCannons, Math.ceil(foeAir / 2))) queueStructure(s, owner, 'flakcannon');
  }
  // With the map's ore running low, what credits are left go on the army, not on structures,
  // aircraft or research that pay back only over time; with it all gone, the last stand below.
  let ore = 0;
  for (const o of s.ore) ore += o;
  if (ore <= 0) lastStand(s, owner, armed);
  if (crisis || !armyReady || ore < AIR_ORE_FLOOR) {
    strikes(s, owner, t, home, enemy, foes, mine.filter(isAir));
    return;
  }

  // 2. A Research Lab and Helipads, once the economy and the turrets stand.
  const based = count('factory') > 0 && count('uplink') > 0 && count('refinery') >= d.refineries && count('turret') >= d.turrets;
  if (based) {
    if (count('researchlab') < 1) queueStructure(s, owner, 'researchlab');
    else if (count('helipad') < t.helipads) queueStructure(s, owner, 'helipad');
  }

  // 3. Aircraft, up to the plan and the Helipads' room.
  let saving = based && (count('researchlab') < 1 || count('helipad') < t.helipads);
  if (airRoom(s, owner) > 0) {
    const want: UnitKind | null = queued('gunship') < t.gunships ? 'gunship' : queued('bomber') < t.bombers ? 'bomber' : null;
    if (want && unlocked(s, owner, want)) {
      saving = true;
      if (p.queues.air.length === 0 && fund(s, owner, UNITS[want].cost) && canQueue(s, owner, 'air', want)) doQueue(s, owner, 'air', want);
    }
  }

  // 4. Research, in the difficulty's order, once the Helipads stand and the aircraft are on their way.
  if (!saving && !p.research && count('researchlab') > 0) {
    const next = t.research.find(id => !(p.upgrades ?? []).includes(id) && UPGRADES[id].requires.every(k => count(k) > 0));
    if (next && fund(s, owner, UPGRADES[next].cost) && canResearch(s, owner, next)) doResearch(s, owner, next);
  }

  // 5. Strikes.
  strikes(s, owner, t, home, enemy, foes, mine.filter(isAir));
}

/**
 * The ore is gone and the army with it: the air structures are sold (the Lab first, a Helipad only
 * with no aircraft left to serve) and whatever credits remain become infantry, which the commander's
 * waves send in as a last push. Without this a side can sit for the rest of the battle on a few
 * hundred credits, saving for a structure it will never afford, while its opponent does the same.
 */
function lastStand(s: GameState, owner: Owner, armed: number): void {
  const p = s.players[owner];
  if (armed > 0 || p.queues.building.length) return;
  if (p.credits < 300) {
    const flying = s.units.some(u => u.owner === owner && isAir(u));
    const spare = s.buildings.find(b => b.owner === owner && (b.kind === 'researchlab' || b.kind === 'flakcannon' || (b.kind === 'helipad' && !flying)));
    if (spare) {
      doSell(s, owner, spare.id);
      return;
    }
  }
  const kind: UnitKind = p.credits >= UNITS.grenadier.cost && unlocked(s, owner, 'grenadier') ? 'grenadier' : 'rifleman';
  if (p.queues.infantry.length < MAX_QUEUE && canQueue(s, owner, 'infantry', kind)) doQueue(s, owner, 'infantry', kind);
}

/**
 * Saves up for something costing `need`: units queued but not yet started (never a hauler or
 * anti-air) are taken back, refunded in full, latest first, until the credits are there. When even
 * that is not enough it still takes them back, so the credits build up over the next decisions
 * instead of going straight into more units. True once `need` is in hand.
 */
function fund(s: GameState, owner: Owner, need: number): boolean {
  const p = s.players[owner];
  const spare = (k: string) => k !== 'hauler' && k !== 'skyhunter' && k !== 'flaktrack';
  for (const cat of ['vehicle', 'infantry'] as const) {
    const q = p.queues[cat];
    for (let i = q.length - 1; i >= 0 && p.credits < need; i--) {
      if (q[i].progress !== 0 || !spare(q[i].kind)) continue;
      const kind = q[i].kind;
      q.splice(i, 1);
      p.credits += costFor(s, owner, kind);
    }
  }
  return p.credits >= need;
}

/**
 * Queues a structure when nothing else is building; a Generator first when it would take power too
 * low (as the commander's own plan does).
 */
function queueStructure(s: GameState, owner: Owner, kind: BuildingKind): void {
  const p = s.players[owner];
  if (p.queues.building.length) return;
  const pw = powerOf(s, owner);
  const want: BuildingKind = pw.made - pw.used + BUILDINGS[kind].power < 10 ? 'power' : kind;
  if (!unlocked(s, owner, want) || !fund(s, owner, BUILDINGS[want].cost)) return;
  if (canQueue(s, owner, 'building', want)) doQueue(s, owner, 'building', want);
}

function strikes(
  s: GameState,
  owner: Owner,
  t: AirTactics,
  home: { x: number; y: number },
  enemy: Building[],
  foes: Unit[],
  craft: Unit[],
): void {
  const mem = s.ai[owner];
  const alive = new Map(craft.map(u => [u.id, u]));
  let out = (mem.airIds ?? []).filter(id => alive.has(id));
  const cover = coverOf(enemy, foes);
  const parked = (u: Unit) => u.order.type === 'rearm';
  const full = (u: Unit) => (u.ammo ?? 0) >= ammoMax(u);

  // Back from a strike (rearming or parked): no longer out.
  out = out.filter(id => !parked(alive.get(id)!));

  // Gunships still out whose target has gone: the next target near them, or home.
  const targets = foes.filter(f => (f.kind === 'hauler' || f.kind === 'artillery' || f.kind === 'missilecarrier') && isEnemy(s, owner, f.owner));
  const pickFor = (from: { x: number; y: number }): Unit | null => {
    let best: Unit | null = null;
    let bestScore = Infinity;
    for (const f of targets) {
      const risk = danger(cover, f.x, f.y);
      if (risk > 1) continue;
      const score = dist(from.x, from.y, f.x, f.y) + risk * 12 + (f.kind === 'hauler' ? 0 : 4);
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    return best;
  };

  // A Gunship out on a strike whose target has gone (now idle): on to the next, or home.
  for (const id of out) {
    const u = alive.get(id)!;
    if (u.kind !== 'gunship' || u.order.type !== 'idle') continue;
    const next = (u.ammo ?? 0) > 0 ? pickFor(u) : null;
    if (next) doAttack(s, owner, [u.id], next.id);
  }
  // Anything else idle goes home to its pad.
  for (const u of craft) if (u.order.type === 'idle') parkAircraft(s, u);
  out = out.filter(id => !parked(alive.get(id)!));

  const due = s.tick >= (mem.nextAirStrike ?? 0);
  // Gunships: a group of full ones parked at home, at the safest hauler or artillery piece.
  const ready = craft.filter(u => u.kind === 'gunship' && parked(u) && full(u) && !out.includes(u.id));
  if (due && enemy.length && ready.length >= t.gunshipGroup) {
    const target = pickFor(home);
    if (target) {
      const ids = ready.map(u => u.id);
      doAttack(s, owner, ids, target.id);
      out = out.concat(ids);
      mem.nextAirStrike = s.tick + t.strikeInterval;
    }
  }
  // Bombers: each full one at the thickest knot of structures the fewest guns cover.
  const bombers = craft.filter(u => u.kind === 'bomber' && parked(u) && full(u) && !out.includes(u.id));
  if (due && bombers.length && enemy.length) {
    let best: Building | null = null;
    let bestScore = -Infinity;
    for (const b of enemy) {
      const c = buildingCentre(b);
      let near = 0;
      for (const o of enemy) if (distToBuilding(c.x, c.y, o) <= 2.5) near += BUILDINGS[o.kind].weapon ? 1.5 : 1;
      const score = near - danger(cover, c.x, c.y) - dist(home.x, home.y, c.x, c.y) * 0.02;
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
    if (best && bestScore > 0.5) {
      const ids = bombers.map(u => u.id);
      doAttack(s, owner, ids, best.id);
      out = out.concat(ids);
      mem.nextAirStrike = s.tick + t.strikeInterval;
    }
  }
  mem.airIds = out;
}
