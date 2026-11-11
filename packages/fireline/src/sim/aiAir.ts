import { airRoom, ammoMax, isAir, parkAircraft } from './air';
import { isShip } from './naval';
import { canQueue, doAttack, doMove, doQueue, doSell } from './commands';
import { canRide, doBoard, doUnload, isStill } from './transport';
import { buildingCentre, dist, distToBuilding } from './grid';
import { canResearch, doResearch } from './research';
import { BUILDINGS, DIFFICULTIES, MAX_QUEUE, UNITS, UPGRADES, hitsGround, type BuildingKind, type Difficulty, type Owner, type UnitKind, type UpgradeId } from './rules';
import { costFor, countBuildings, isStructure, powerOf, techAllowed, unlocked } from './state';
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
 *  - The air war (2026-11-10): Interceptors in proportion to the opponent's aircraft (Normal and
 *    Hard), bought as anti-air is (before the army is ready, once a Research Lab stands), with a
 *    Helipad more to hold them. Parked, they scramble by themselves (air.ts); an enemy aircraft over
 *    its haulers or structures, out of scramble range, draws one sent by the commander. A Recon
 *    Plane (Normal and Hard) once the opponent fields a Stealth Tank, bought the same way, sent over
 *    the one nearest its base and kept on it so its guns can see it. A Heavy Bomber on Hard, flown
 *    with the Bombers. Airlift raids with a Troop Carrier (Normal and Hard): see airlift() below.
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
  /** Interceptors wanted per enemy aircraft, and at most. */
  interceptorsPer: number;
  interceptorsMax: number;
  /** A Recon Plane against Stealth Tanks. */
  recon: boolean;
  /** Heavy Bombers, once a Tech Centre and a Research Lab stand. */
  heavyBombers: number;
  /** Troop Carriers for airlift raids, and how many infantry it sends in one. */
  carriers: number;
  airliftSize: number;
}

/**
 * Ore left on the map (credits' worth) below which nothing new goes on air or research. Maps start
 * with 50,000 to 75,000 and are mostly mined out between the 20th and 30th minute.
 */
const AIR_ORE_FLOOR = 20000;
/** Tiles from its haulers or structures within which an enemy aircraft draws one of its Interceptors. */
const DEFEND_RANGE = 8;

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
    interceptorsPer: 0,
    interceptorsMax: 0,
    recon: false,
    heavyBombers: 0,
    carriers: 0,
    airliftSize: 0,
  },
  normal: {
    helipads: 1,
    gunships: 1,
    bombers: 1,
    research: ['refining', 'plating', 'calibration', 'airframes', 'engines', 'countermeasures'],
    gunshipGroup: 1,
    strikeInterval: 1500,
    skyhuntersPer: 2,
    flaktracksPer: 0.5,
    flakCannons: 2,
    interceptorsPer: 0.5,
    interceptorsMax: 1,
    recon: true,
    heavyBombers: 0,
    carriers: 1,
    airliftSize: 5,
  },
  hard: {
    helipads: 2,
    gunships: 2,
    bombers: 2,
    research: ['refining', 'calibration', 'plating', 'engines', 'airframes', 'countermeasures'],
    gunshipGroup: 2,
    strikeInterval: 1200,
    skyhuntersPer: 2,
    flaktracksPer: 1,
    flakCannons: 3,
    interceptorsPer: 0.5,
    interceptorsMax: 2,
    recon: true,
    heavyBombers: 1,
    carriers: 1,
    airliftSize: 6,
  },
};

/** The structures and anti-air units that count as anti-air cover, and how far each reaches. */
function coverOf(enemy: Building[], foes: Unit[]): { x: number; y: number; r: number; b?: Building }[] {
  const out: { x: number; y: number; r: number; b?: Building }[] = [];
  for (const b of enemy) if (b.kind === 'flakcannon') out.push({ x: b.x + 0.5, y: b.y + 0.5, r: (BUILDINGS.flakcannon.weapon?.range ?? 7) + 1, b });
  for (const u of foes) {
    if (u.kind !== 'flaktrack' && u.kind !== 'skyhunter' && u.kind !== 'interceptor') continue;
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
  // An army that can take ground: not aircraft, and not ships (the naval war), which cannot reach a
  // structure inland. The last stand and recovery read this.
  const landArmed = mine.filter(u => UNITS[u.kind].weapon && !isAir(u) && !isShip(u)).length;
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
  // Interceptors are anti-air too, so they come before the army is ready, as Skyhunters do: once a
  // Research Lab stands, one on the Helipads' room, or a Helipad more to hold them.
  const interceptors = foeAir > 0 && !crisis ? Math.min(t.interceptorsMax, Math.ceil(foeAir * t.interceptorsPer)) : 0;
  if (interceptors > 0 && count('researchlab') > 0 && queued('interceptor') < interceptors) {
    if (airRoom(s, owner) > 0) {
      if (p.queues.air.length === 0 && fund(s, owner, UNITS.interceptor.cost) && canQueue(s, owner, 'air', 'interceptor')) doQueue(s, owner, 'air', 'interceptor');
    } else if (count('helipad') < t.helipads + 1) queueStructure(s, owner, 'helipad');
  }
  // A Recon Plane against Stealth Tanks, likewise ahead of the army: its guns cannot hit what they cannot see.
  const stealthy = foes.filter(f => UNITS[f.kind].stealth && isEnemy(s, owner, f.owner));
  const recon = t.recon && stealthy.length > 0 && !crisis ? 1 : 0;
  if (recon && count('helipad') > 0 && queued('reconplane') < recon) {
    if (airRoom(s, owner) > 0) {
      if (p.queues.air.length === 0 && fund(s, owner, UNITS.reconplane.cost) && canQueue(s, owner, 'air', 'reconplane')) doQueue(s, owner, 'air', 'reconplane');
    } else if (count('helipad') < t.helipads + 1) queueStructure(s, owner, 'helipad');
  }
  // With the map's ore running low, what credits are left go on the army, not on structures,
  // aircraft or research that pay back only over time; with it all gone, the last stand below.
  let ore = 0;
  for (const o of s.ore) ore += o;
  if (ore <= 0) lastStand(s, owner, landArmed);
  // Broke with no income and no way to buy one back: sell what it can live without (recover).
  else if (crisis) recover(s, owner, landArmed);
  // An opponent with nothing left that shoots: everything idle goes in, wave or no wave.
  mopUp(s, owner, mine);
  if (crisis || !armyReady || ore < AIR_ORE_FLOOR) {
    strikes(s, owner, t, home, enemy, foes, mine.filter(isAir));
    return;
  }

  // 2. A Research Lab and Helipads, once the economy and the turrets stand.
  // Interceptors and a Recon Plane, when the opponent gives a reason, take a Helipad more.
  // A Troop Carrier takes a Helipad place, and a Heavy Bomber a whole pad more.
  const heavy = t.heavyBombers > 0 && unlocked(s, owner, 'heavybomber') ? t.heavyBombers : 0;
  const pads = t.helipads + (interceptors + recon + t.carriers > 0 ? 1 : 0) + heavy;
  const based = count('factory') > 0 && count('uplink') > 0 && count('refinery') >= d.refineries && count('turret') >= d.turrets;
  if (based) {
    if (count('researchlab') < 1) queueStructure(s, owner, 'researchlab');
    else if (count('helipad') < pads) queueStructure(s, owner, 'helipad');
  }

  // 3. Aircraft, up to the plan and the Helipads' room: Interceptors and the Recon Plane first.
  let saving = based && (count('researchlab') < 1 || count('helipad') < pads);
  if (airRoom(s, owner) > 0) {
    const want: UnitKind | null =
      queued('interceptor') < interceptors
        ? 'interceptor'
        : queued('reconplane') < recon
          ? 'reconplane'
          : queued('gunship') < t.gunships
            ? 'gunship'
            : queued('bomber') < t.bombers
              ? 'bomber'
              : queued('carrier') < t.carriers
                ? 'carrier'
                : queued('heavybomber') < heavy
                  ? 'heavybomber'
                  : null;
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
 * No income, and not the credits to restore it: no refinery and less than one costs, or a refinery
 * and no hauler and less than one costs. Without this both commanders of a long Coast battle once
 * sat for an hour on a few hundred credits each, saving for the one thing that would pay again,
 * with the map's ore still there. Units queued but not started are taken back first (fund); then,
 * one a decision, the structures it can live without are sold, the Research Lab first and Generators
 * never; with nothing left to sell, the last stand: whatever remains goes on infantry.
 */
function recover(s: GameState, owner: Owner, armed: number): void {
  const p = s.players[owner];
  if (p.queues.building.length) return;
  const has = (k: BuildingKind) => s.buildings.some(b => b.owner === owner && b.kind === k && b.hp > 0);
  const hauling = s.units.some(u => u.owner === owner && u.kind === 'hauler') || p.queues.vehicle.some(q => q.kind === 'hauler');
  const need = !has('refinery') ? costFor(s, owner, 'refinery') : !hauling ? costFor(s, owner, 'hauler') : 0;
  if (!need || p.credits >= need || fund(s, owner, need)) return;
  const flying = s.units.some(u => u.owner === owner && isAir(u));
  const sailing = s.units.some(u => u.owner === owner && isShip(u));
  const spare: [BuildingKind, boolean][] = [
    ['researchlab', true],
    ['helipad', !flying],
    ['shipyard', !sailing],
    ['flakcannon', true],
    ['techcentre', true],
    ['strikecommand', true],
    ['repairbay', true],
  ];
  for (const [kind, ok] of spare) {
    if (!ok) continue;
    const b = s.buildings.find(x => x.owner === owner && x.kind === kind && x.hp > 0);
    if (b) {
      doSell(s, owner, b.id);
      return;
    }
  }
  // No troops and not the price of one: the last resort, structures that cannot win the battle back
  // (a Naval Yard whose ships cannot reach the last enemy structures inland, a Helipad, the Uplink,
  // turrets), and then any Generator but the last: two broke sides once sat for the rest of the
  // battle on five Generators each, neither able to pay for a rifleman. Never the yard, a Barracks,
  // a Factory or a refinery.
  if (armed === 0 && p.credits < UNITS.rifleman.cost) {
    const last: BuildingKind[] = ['shipyard', 'helipad', 'uplink', 'rocketturret', 'turret'];
    for (const kind of last) {
      const b = s.buildings.find(x => x.owner === owner && x.kind === kind && x.hp > 0);
      if (b) {
        doSell(s, owner, b.id);
        return;
      }
    }
    const generators = s.buildings.filter(x => x.owner === owner && x.kind === 'power' && x.hp > 0);
    if (generators.length > 1) {
      doSell(s, owner, generators[generators.length - 1].id);
      return;
    }
  }
  // Nothing left to sell: train what the credits allow, and send everything that can take ground at
  // the opponent now, wave or no wave. Waiting cannot help a side with no income; two such sides
  // once faced each other for an hour, one with a Buggy and a Grenadier idle at home.
  lastStand(s, owner, armed);
  if (armed > 0 && s.tick >= s.ai[owner].nextAttack) allIn(s, owner, s.units.filter(u => u.owner === owner));
}

/**
 * The opponent has no armed unit left anywhere: every idle armed unit of ours goes at its structure
 * nearest it, attack-move, whatever the wave's size. Without this a winning side whose only armed
 * units were ships, or too few for its next wave, could sit for an hour beside an opponent reduced
 * to a Barracks and three Generators. Units already ordered somewhere are left alone.
 */
function mopUp(s: GameState, owner: Owner, mine: Unit[]): void {
  // An attack like any other: not before the commander's first attack is due (a scripted hold-off,
  // or a harness's quiet battle, sets that far off).
  if (s.tick < s.ai[owner].nextAttack) return;
  // Every enemy unit and structure on the map, seen or not: the commander already knows the map. A
  // side defending with turrets alone is not defenceless: the waves deal with it as ever.
  if (s.units.some(f => f.hp > 0 && UNITS[f.kind].weapon && isEnemy(s, owner, f.owner))) return;
  if (s.buildings.some(b => b.hp > 0 && BUILDINGS[b.kind].weapon && isEnemy(s, owner, b.owner))) return;
  allIn(s, owner, mine);
}

/**
 * Every idle armed unit that can take ground (not aircraft, not ships, which cannot reach a structure
 * inland), attack-move at the opponent's structure nearest it.
 */
function allIn(s: GameState, owner: Owner, mine: Unit[]): void {
  const targets = s.buildings.filter(b => b.hp > 0 && isStructure(b) && isEnemy(s, owner, b.owner));
  if (!targets.length) return;
  for (const u of mine) {
    if (!UNITS[u.kind].weapon || isAir(u) || isShip(u) || u.order.type !== 'idle' || u.engage) continue;
    let best = targets[0];
    let bestD = Infinity;
    for (const b of targets) {
      const c = buildingCentre(b);
      const d = dist(u.x, u.y, c.x, c.y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    const c = buildingCentre(best);
    doMove(s, owner, [u.id], c.x, c.y, true);
  }
}

/**
 * Saves up for something costing `need`: units queued but not yet started (never a hauler or
 * anti-air) are taken back, refunded in full, latest first, until the credits are there. When even
 * that is not enough it still takes them back, so the credits build up over the next decisions
 * instead of going straight into more units. True once `need` is in hand.
 */
export function fund(s: GameState, owner: Owner, need: number): boolean {
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
export function queueStructure(s: GameState, owner: Owner, kind: BuildingKind): void {
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
  // Anything else idle goes home to its pad; a Recon Plane circling keeps circling until its fuel says.
  for (const u of craft) if (u.order.type === 'idle' && u.kind !== 'reconplane') parkAircraft(s, u);
  out = out.filter(id => !parked(alive.get(id)!));

  const due = s.tick >= (mem.nextAirStrike ?? 0);
  // Gunships: a group of full ones parked at home, at the safest hauler or artillery piece.
  const ready = craft.filter(u => u.kind === 'gunship' && parked(u) && full(u) && !out.includes(u.id));
  // A group as large as the plan, or as all the Gunships it has: a lone survivor once sat parked
  // for fourteen minutes waiting for a partner that never came.
  const gunships = craft.filter(u => u.kind === 'gunship').length;
  if (due && enemy.length && ready.length > 0 && ready.length >= Math.min(t.gunshipGroup, gunships)) {
    const target = pickFor(home);
    if (target) {
      const ids = ready.map(u => u.id);
      doAttack(s, owner, ids, target.id);
      out = out.concat(ids);
      mem.nextAirStrike = s.tick + t.strikeInterval;
    }
  }
  // Bombers: each full one at the thickest knot of structures the fewest guns cover.
  const bombers = craft.filter(u => (u.kind === 'bomber' || u.kind === 'heavybomber') && parked(u) && full(u) && !out.includes(u.id));
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
  airlift(s, owner, t, home, enemy, craft, cover);

  // Interceptors: an enemy aircraft over its haulers or structures draws the nearest one fit to
  // fight (parked full, or aloft with half its missiles), one each. Enemy gunships hunt haulers out
  // at the ore, beyond any Helipad's scramble range, so the commander sends them itself.
  const fighters = craft.filter(u => u.kind === 'interceptor' && u.stance !== 'hold');
  if (fighters.length) {
    const guarded: { x: number; y: number }[] = s.units.filter(u => u.owner === owner && u.kind === 'hauler' && u.hp > 0);
    const mineB = s.buildings.filter(b => b.owner === owner && b.hp > 0);
    const near = (f: Unit) => guarded.some(g => dist(g.x, g.y, f.x, f.y) <= DEFEND_RANGE) || mineB.some(b => distToBuilding(f.x, f.y, b) <= DEFEND_RANGE);
    const chased = new Set(fighters.map(u => (u.order.type === 'attack' ? u.order.target : 0)));
    for (const f of foes) {
      if (!isAir(f) || !isEnemy(s, owner, f.owner) || chased.has(f.id) || !near(f)) continue;
      let best: Unit | null = null;
      let bestD = Infinity;
      for (const u of fighters) {
        const fit = parked(u) ? full(u) && u.order.type === 'rearm' : u.order.type !== 'attack' && (u.ammo ?? 0) * 2 >= ammoMax(u);
        if (!fit || chased.has(-u.id)) continue;
        const d = dist(u.x, u.y, f.x, f.y);
        if (d < bestD) {
          bestD = d;
          best = u;
        }
      }
      if (!best) break;
      doAttack(s, owner, [best.id], f.id);
      chased.add(f.id);
      chased.add(-best.id);
    }
  }

  // The Recon Plane, fuelled and parked, over the enemy Stealth Tank nearest home, so the guns there
  // can see it. Without one it stays parked.
  const stealthy = foes.filter(f => UNITS[f.kind].stealth && isEnemy(s, owner, f.owner));
  if (stealthy.length) {
    for (const u of craft) {
      // Parked, only once refuelled; aloft, it follows the tank as it moves.
      if (u.kind !== 'reconplane' || (parked(u) && !full(u))) continue;
      let best: Unit | null = null;
      let bestD = Infinity;
      for (const f of stealthy) {
        const d = dist(home.x, home.y, f.x, f.y);
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
      const o = u.order;
      const heading = o.type === 'move' ? { x: o.x, y: o.y } : o.type === 'idle' ? { x: u.x, y: u.y } : null;
      if (best && (!heading || dist(heading.x, heading.y, best.x, best.y) > 3)) doMove(s, owner, [u.id], best.x, best.y, false);
    }
  }
}

/** Ticks an airlift may spend boarding before it goes with whoever is aboard, or gives up. */
const AIRLIFT_BOARD_TICKS = 600;
/** Ticks it may spend flying before it gives up and comes home. */
const AIRLIFT_FLY_TICKS = 1800;

/**
 * Airlift raids (Normal and Hard): a parked Troop Carrier takes `airliftSize` idle infantry from home
 * to the opponent's refinery (any structure, without one) that the fewest anti-air guns cover, sets
 * them down three tiles short of it, and they attack-move on it while the carrier flies home. One at
 * a time, every two strike intervals (its own timer, not the strikes'); boarding gives up after a minute (going with whoever is aboard), the
 * flight after three.
 */
function airlift(s: GameState, owner: Owner, t: AirTactics, home: { x: number; y: number }, enemy: Building[], craft: Unit[], cover: { x: number; y: number; r: number; b?: Building }[]): void {
  if (!t.carriers) return;
  const mem = s.ai[owner];
  const lift = mem.airlift ?? null;
  if (lift) {
    const c = craft.find(u => u.id === lift.carrier);
    if (!c) {
      mem.airlift = null;
      return;
    }
    const aboard = c.carried?.length ?? 0;
    if (lift.phase === 'board') {
      const walking = s.units.filter(u => lift.ids.includes(u.id) && u.boarding === c.id).length;
      if ((walking === 0 && aboard > 0) || (s.tick - lift.since > AIRLIFT_BOARD_TICKS && aboard > 0)) {
        doMove(s, owner, [c.id], lift.x, lift.y, false);
        doUnload(s, owner, c.id);
        // Replaced, never changed in place: the memory is copied shallowly between states.
        mem.airlift = { ...lift, ids: lift.ids.slice(), phase: 'fly', since: s.tick };
      } else if (walking === 0 || s.tick - lift.since > AIRLIFT_BOARD_TICKS) {
        mem.airlift = null;
        if (aboard) doUnload(s, owner, c.id);
      }
      return;
    }
    // Flying: once they are out, they go in and the carrier goes home.
    if (aboard === 0) {
      const out = s.units.filter(u => lift.ids.includes(u.id) && u.owner === owner).map(u => u.id);
      const tgt = s.buildings.find(b => b.id === lift.target && b.hp > 0);
      if (out.length) {
        if (tgt) doAttack(s, owner, out, tgt.id);
        else doMove(s, owner, out, lift.x, lift.y, true);
      }
      parkAircraft(s, c);
      mem.airlift = null;
    } else if (s.tick - lift.since > AIRLIFT_FLY_TICKS) {
      parkAircraft(s, c);
      if (!c.drop) doUnload(s, owner, c.id);
      mem.airlift = null;
    }
    return;
  }
  // A new one: a parked carrier, enough idle infantry at home, a target, and the strike timer.
  if (s.tick < (mem.nextAirlift ?? 0) || !enemy.length) return;
  const c = craft.find(u => u.kind === 'carrier' && u.order.type === 'rearm' && !u.carried?.length && isStill(s, u));
  if (!c) return;
  const busy = new Set([...(mem.waveIds ?? []), ...(mem.raidIds ?? []), ...(mem.siteParties ?? []).flatMap(p => p.ids)]);
  const idle = s.units
    .filter(u => u.owner === owner && canRide(u) && UNITS[u.kind].weapon && hitsGround(UNITS[u.kind].weapon!) && u.order.type === 'idle' && !busy.has(u.id) && dist(u.x, u.y, home.x, home.y) < 14)
    .sort((a, b) => dist(a.x, a.y, c.x, c.y) - dist(b.x, b.y, c.x, c.y) || a.id - b.id)
    .slice(0, t.airliftSize);
  if (idle.length < Math.min(4, t.airliftSize)) return;
  const refineries = enemy.filter(b => b.kind === 'refinery');
  let best: Building | null = null;
  let bestScore = Infinity;
  for (const b of refineries.length ? refineries : enemy) {
    const ctr = buildingCentre(b);
    const score = danger(cover, ctr.x, ctr.y) * 10 + dist(home.x, home.y, ctr.x, ctr.y) * 0.05;
    if (score < bestScore) {
      bestScore = score;
      best = b;
    }
  }
  if (!best) return;
  const ctr = buildingCentre(best);
  const d = dist(home.x, home.y, ctr.x, ctr.y) || 1;
  const x = ctr.x + ((home.x - ctr.x) / d) * 3;
  const y = ctr.y + ((home.y - ctr.y) / d) * 3;
  doBoard(s, owner, idle.map(u => u.id), c.id);
  mem.airlift = { carrier: c.id, ids: idle.map(u => u.id), x, y, target: best.id, phase: 'board', since: s.tick };
  // Its own timer: sharing the strikes' once held the Bombers back for good.
  mem.nextAirlift = s.tick + t.strikeInterval * 2;
}
