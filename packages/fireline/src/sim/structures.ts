/**
 * Round 7: structure upgrades and strategic structures (fireline-round7-structures.md).
 *
 * Two setup toggles, both advanced tech only, both absent-reads-off, both never in a mission:
 *
 *  - `setup.structureUpgrades`: a structure listed in STRUCTURE_LEVELS may be raised a level at a
 *    time (`upgradeStructure`). The work is paid for at once, takes time (half speed short of
 *    power), can be cancelled for a full refund, and leaves the structure working at its current
 *    level until it is done, but taking UPGRADE_DAMAGE_TAKEN times the damage meanwhile. A level's
 *    numbers are read through buildingSpecOf (specs.ts, levelledSpec); its production rate, unloading
 *    and income here.
 *  - `setup.strategicBuildings`: the Fortified Bunker (infantry garrison, sheltered and firing out),
 *    the Supply Cache (mends nearby, placed by your troops, taken by enemy infantry), the
 *    Intelligence Centre (enemy queues and research, structures revealed, decoys seen through) and
 *    the Decoy (seen by enemies as a structure of the owner's choice).
 *
 * Pure, like the rest of src/sim/: no clock, no dice. Everything that changes a state works in place
 * on one the reducer has already cloned; the `*Problem` checks only read.
 */
import { buildingCentre, dist, distToBuilding, nearestPassable, occupancy } from './grid';
import { doMove } from './commands';
import { isAir } from './air';
import { industryOn } from './industry';
import {
  ALLOY_VALUE,
  BUILDINGS,
  BUNKER_BAIL_HP,
  BUNKER_ENTER_RANGE,
  BUNKER_SLOTS,
  CACHE_CAPTURE_RANGE,
  CACHE_CAPTURE_TICKS,
  CACHE_HEAL,
  CACHE_MAX,
  CACHE_PLACE_RANGE,
  CACHE_RADIUS,
  CACHE_REPAIR,
  CACHE_TICKS,
  DECOY_DEFAULT,
  INTEL_RADIUS,
  MEDIC_HEAL,
  MEDIC_HEAL_TICKS,
  OUTPOSTS,
  STRUCTURE_LEVELS,
  UNITS,
  UPGRADE_ALLOY_SHARE,
  UPGRADE_DAMAGE_TAKEN,
  maxLevelOf,
  vetFor,
  type BuildingKind,
  type BuildingSpec,
  type LevelSpec,
  type Owner,
} from './rules';
import { isAlly, isEnemy, isSide, sidesOf, teamOf } from './sides';
import { buildingSpec, buildingSpecOf } from './specs';
import { log, maxHpOf, powerOf, techAllowed } from './state';
import type { Building, GameState, Unit } from './types';

/** The structures that exist only with strategic structures on. */
export const STRATEGIC_BUILDINGS: BuildingKind[] = ['bunker', 'supplycache', 'intelcentre', 'decoy'];

/** True in a skirmish set up with structure upgrades on (advanced tech). Never in a mission. */
export const upgradesOn = (s: GameState): boolean => !s.mission && s.setup?.tech === 'advanced' && s.setup.structureUpgrades === true;
/** True in a skirmish set up with strategic structures on (advanced tech). Never in a mission. */
export const strategicOn = (s: GameState): boolean => !s.mission && s.setup?.tech === 'advanced' && s.setup.strategicBuildings === true;

/** Structures that send out no crew when they go: the outposts, and the Bunker (its garrison walks out instead). */
export const noCrew = (kind: BuildingKind): boolean => OUTPOSTS.includes(kind) || kind === 'bunker';
/** Structures that keep no side in the battle and extend no base (OUTPOSTS). */
export const isOutpost = (b: Building): boolean => OUTPOSTS.includes(b.kind);

// ---------------------------------------------------------------------------------------------
// Upgrades

/** A structure's level: 1 until raised. */
export const levelOf = (b: Building): number => b.level ?? 1;
/** The level a structure stands at, as its spec (null at level 1). */
export const levelSpecOf = (b: Building): LevelSpec | null => (b.level && b.level > 1 ? (STRUCTURE_LEVELS[b.kind]?.[b.level - 2] ?? null) : null);
/** The next level up, or null at the top (or for a kind with none). */
export const nextLevelOf = (b: Building): LevelSpec | null => STRUCTURE_LEVELS[b.kind]?.[levelOf(b) - 1] ?? null;

/** What the next level costs this side: credits, and with industry a share in alloys. */
export function upgradePrice(s: GameState, b: Building): { credits: number; alloys: number } {
  const lv = nextLevelOf(b);
  if (!lv) return { credits: 0, alloys: 0 };
  if (!industryOn(s)) return { credits: lv.cost, alloys: 0 };
  const alloys = Math.round((lv.cost * UPGRADE_ALLOY_SHARE) / ALLOY_VALUE);
  return { credits: lv.cost - alloys * ALLOY_VALUE, alloys };
}

/** Why this structure cannot start its next level now, or null if it can. */
export function upgradeProblem(s: GameState, owner: Owner, id: number): string | null {
  if (!upgradesOn(s)) return 'Structure upgrades are off';
  const b = s.buildings.find(x => x.id === id);
  if (!b || b.owner !== owner || b.hp <= 0) return 'No such structure';
  if (!STRUCTURE_LEVELS[b.kind]) return 'This structure has no upgrades';
  if (b.upgrade) return 'Already upgrading';
  if (!nextLevelOf(b)) return 'Fully upgraded';
  const price = upgradePrice(s, b);
  const p = s.players[owner];
  if (p.credits < price.credits) return `Needs ${price.credits} credits`;
  if (price.alloys && (p.alloys ?? 0) < price.alloys) return `Needs ${price.alloys} alloys`;
  return null;
}

export function doUpgrade(s: GameState, owner: Owner, id: number): void {
  const b = s.buildings.find(x => x.id === id)!;
  const price = upgradePrice(s, b);
  const p = s.players[owner];
  p.credits -= price.credits;
  if (price.alloys) p.alloys = (p.alloys ?? 0) - price.alloys;
  b.upgrade = { progress: 0, credits: price.credits, ...(price.alloys ? { alloys: price.alloys } : {}) };
  if (owner === 0) log(s, `${buildingSpec(s, owner, b.kind).name}: upgrade to ${nextLevelOf(b)!.name} begun.`);
}

export function cancelUpgradeProblem(s: GameState, owner: Owner, id: number): string | null {
  const b = s.buildings.find(x => x.id === id);
  if (!b || b.owner !== owner || b.hp <= 0) return 'No such structure';
  if (!b.upgrade) return 'No upgrade under way';
  return null;
}

/** Stops the work and pays back everything it cost. */
export function doCancelUpgrade(s: GameState, owner: Owner, id: number): void {
  const b = s.buildings.find(x => x.id === id)!;
  const u = b.upgrade!;
  const p = s.players[owner];
  p.credits += u.credits;
  if (u.alloys) p.alloys = (p.alloys ?? 0) + u.alloys;
  delete b.upgrade;
  if (owner === 0) log(s, `${buildingSpec(s, owner, b.kind).name}: upgrade cancelled.`);
}

/** Ticks of work the upgrade under way needs in all. */
export const upgradeTicksOf = (b: Building): number => nextLevelOf(b)?.ticks ?? 0;

/** Production speed at this structure's level (1 at level 1 or for a kind without `rate`). */
export const levelRateOf = (b: Building): number => levelSpecOf(b)?.rate ?? 1;
/** A Refinery's unloading speed at its level. */
export const unloadMulOf = (b: Building): number => levelSpecOf(b)?.unload ?? 1;
/** A Refinery's income per load at its level. */
export const loadIncomeMulOf = (b: Building): number => levelSpecOf(b)?.income ?? 1;
/** Damage taken, as a multiple: more while an upgrade is under way. */
export const upgradeTakenOf = (b: Building): number => (b.upgrade ? UPGRADE_DAMAGE_TAKEN : 1);

/** One tick of every upgrade under way: half speed short of power; a finished one raises the level. */
function upgradeStep(s: GameState, power: boolean[]): void {
  for (const b of s.buildings) {
    if (!b.upgrade || b.hp <= 0) continue;
    const lv = nextLevelOf(b);
    if (!lv) {
      delete b.upgrade;
      continue;
    }
    b.upgrade.progress = Math.min(lv.ticks, b.upgrade.progress + (power[b.owner] ? 0.5 : 1));
    if (b.upgrade.progress < lv.ticks) continue;
    const before = buildingSpecOf(s, b).hp;
    b.level = levelOf(b) + 1;
    delete b.upgrade;
    const after = buildingSpecOf(s, b).hp;
    // The new health comes with the work: what was lost before stays lost.
    b.hp = Math.min(after, b.hp + Math.max(0, after - before));
    const c = buildingCentre(b);
    s.effects.push({ id: s.nextId++, kind: 'levelup', x: c.x, y: c.y, at: s.tick, size: 1 });
    if (b.owner === 0) log(s, `${buildingSpec(s, b.owner, b.kind).name} upgraded: ${lv.name}.`, 'good');
  }
}

// ---------------------------------------------------------------------------------------------
// The Fortified Bunker

/** Infantry that may garrison a Bunker: any but the heroes and the field General. */
export const canGarrison = (u: Unit): boolean => UNITS[u.kind].category === 'infantry' && !UNITS[u.kind].hero && u.kind !== 'general';
/** Places taken in a Bunker. */
export const garrisonCount = (b: Building): number => b.garrison?.length ?? 0;

function bunkerOf(s: GameState, owner: Owner, id: number): Building | null {
  const b = s.buildings.find(x => x.id === id);
  return b && b.kind === 'bunker' && b.owner === owner && b.hp > 0 ? b : null;
}

/** Why these units cannot be sent into that Bunker, or null if (some of) they can. */
export function garrisonProblem(s: GameState, owner: Owner, ids: number[], bunker: number): string | null {
  if (!strategicOn(s)) return 'Strategic structures are off';
  const b = bunkerOf(s, owner, bunker);
  if (!b) return 'No such Bunker';
  const want = new Set(ids);
  const going = s.units.filter(u => u.entering === b.id && !want.has(u.id)).length;
  const riders = s.units.filter(u => want.has(u.id) && u.owner === owner && u.hp > 0 && canGarrison(u));
  if (!riders.length) return 'Only infantry can garrison a Bunker';
  if (garrisonCount(b) + going >= BUNKER_SLOTS) return 'The Bunker is full';
  return null;
}

/** Sends the infantry among `ids` to the Bunker, as many as there is room for, nearest first. */
export function doGarrison(s: GameState, owner: Owner, ids: number[], bunker: number): void {
  const b = bunkerOf(s, owner, bunker)!;
  const want = new Set(ids);
  const going = s.units.filter(u => u.entering === b.id && !want.has(u.id)).length;
  const room = BUNKER_SLOTS - garrisonCount(b) - going;
  const c = buildingCentre(b);
  const riders = s.units
    .filter(u => want.has(u.id) && u.owner === owner && u.hp > 0 && canGarrison(u))
    .sort((a, z) => dist(a.x, a.y, c.x, c.y) - dist(z.x, z.y, c.x, c.y) || a.id - z.id)
    .slice(0, room);
  // To the open ground beside the footprint nearest each one.
  const occ = occupancy(s);
  for (const u of riders) {
    const tx = Math.max(b.x - 0.5, Math.min(b.x + BUILDINGS.bunker.w + 0.5, u.x));
    const ty = Math.max(b.y - 0.5, Math.min(b.y + BUILDINGS.bunker.h + 0.5, u.y));
    const k = nearestPassable(s, occ, tx, ty, 3);
    const x = k >= 0 ? (k % s.mapW) + 0.5 : c.x;
    const y = k >= 0 ? Math.floor(k / s.mapW) + 0.5 : c.y;
    doMove(s, owner, [u.id], x, y, false);
    u.entering = b.id;
  }
}

export function ungarrisonProblem(s: GameState, owner: Owner, id: number): string | null {
  const b = bunkerOf(s, owner, id);
  if (!b) return 'No such Bunker';
  if (!garrisonCount(b)) return 'Nobody inside';
  if (!exitTiles(s, b, 1).length) return 'No ground round it to come out on';
  return null;
}

export function doUngarrison(s: GameState, owner: Owner, id: number): void {
  const b = bunkerOf(s, owner, id)!;
  const n = setOut(s, b, 1, occupancy(s));
  if (owner === 0 && n) log(s, `${n} infantry out of the Bunker.`);
}

/** Up to n free tiles round a structure to stand on, nearest the footprint first, in a fixed order. */
function exitTiles(s: GameState, b: Building, n: number, occ = occupancy(s)): number[] {
  const spec = BUILDINGS[b.kind];
  const taken = new Set<number>();
  for (const u of s.units) if (u.hp > 0 && !isAir(u)) taken.add(Math.floor(u.y) * s.mapW + Math.floor(u.x));
  const out: number[] = [];
  for (let ring = 1; ring <= 3 && out.length < n; ring++)
    for (let y = b.y - ring; y < b.y + spec.h + ring && out.length < n; y++)
      for (let x = b.x - ring; x < b.x + spec.w + ring && out.length < n; x++) {
        if (x > b.x - ring && x < b.x + spec.w + ring - 1 && y > b.y - ring && y < b.y + spec.h + ring - 1) continue;
        if (x < 0 || y < 0 || x >= s.mapW || y >= s.mapH) continue;
        const k = y * s.mapW + x;
        if (taken.has(k) || occ[k] !== 0) continue;
        const c = s.tiles.charCodeAt(k);
        if (c !== 103 && c !== 100) continue;
        taken.add(k);
        out.push(k);
      }
  return out;
}

/**
 * Everyone inside comes out onto the ground round the Bunker, each with `hpShare` of the health it
 * had (at least 1), as many as there is ground for; the rest stay inside. Returns how many came out.
 */
function setOut(s: GameState, b: Building, hpShare: number, occ: Int32Array): number {
  const inside = b.garrison ?? [];
  if (!inside.length) return 0;
  const tiles = exitTiles(s, b, inside.length, occ);
  const out = inside.slice(0, tiles.length).map(
    (r, i): Unit => ({
      ...r,
      x: (tiles[i] % s.mapW) + 0.5,
      y: Math.floor(tiles[i] / s.mapW) + 0.5,
      hp: hpShare === 1 ? r.hp : Math.max(1, Math.round(r.hp * hpShare)),
      order: { type: 'idle' },
      engage: 0,
      path: [],
      pathGoal: -1,
      queue: [],
      stuck: 0,
      cooldown: 0,
    }),
  );
  s.units = s.units.concat(out);
  const left = inside.slice(out.length);
  if (left.length) b.garrison = left;
  else delete b.garrison;
  return out.length;
}

/** A Bunker just sold: its garrison walks out unhurt. Called before it is removed. */
export function bunkerSold(s: GameState, b: Building): void {
  if (b.garrison?.length) setOut(s, b, 1, occupancy(s));
}

/**
 * Bunkers that have just fallen (already removed from s.buildings): those inside stagger out hurt,
 * BUNKER_BAIL_HP of the health they had. Anyone with no ground to stand on is lost with it.
 */
export function bunkersFallen(s: GameState, fallen: Building[], occ: Int32Array): void {
  for (const b of fallen) {
    if (!b.garrison?.length) continue;
    const n = b.garrison.length;
    const out = setOut(s, b, BUNKER_BAIL_HP, occ);
    if (out < n) s.players[b.owner].stats.lost += n - out;
    if (b.owner === 0) log(s, `Bunker lost: ${out} of its garrison got out.`, 'bad');
  }
}

/**
 * One tick of going in and coming out, after every unit has moved (tick.ts). Infantry walking to a
 * Bunker go in once within BUNKER_ENTER_RANGE of it, while there is room; a soldier whose Bunker has
 * gone, or that has stopped short, gives up. A Bunker that has changed hands (an Engineer's capture)
 * puts out anyone inside who is not its owner's.
 */
function garrisonStep(s: GameState): void {
  let walking = false;
  for (const u of s.units) if (u.entering) walking = true;
  if (walking) {
    const gone = new Set<number>();
    for (const u of s.units) {
      if (!u.entering || u.hp <= 0) continue;
      const b = s.buildings.find(x => x.id === u.entering);
      if (!b || b.kind !== 'bunker' || b.hp <= 0 || b.owner !== u.owner || !canGarrison(u)) {
        delete u.entering;
        continue;
      }
      if (distToBuilding(u.x, u.y, b) <= BUNKER_ENTER_RANGE && garrisonCount(b) < BUNKER_SLOTS) {
        const g: Unit = { ...u, order: { type: 'idle' }, engage: 0, path: [], pathGoal: -1, queue: [], cooldown: 0 };
        delete g.entering;
        delete g.squad;
        delete g.slotX;
        delete g.slotY;
        b.garrison = [...(b.garrison ?? []), g];
        gone.add(u.id);
        if (b.owner === 0 && garrisonCount(b) === BUNKER_SLOTS) log(s, 'Bunker full.');
      } else if (u.order.type === 'idle') delete u.entering;
    }
    if (gone.size) s.units = s.units.filter(u => !gone.has(u.id));
  }
  for (const b of s.buildings) {
    if (!b.garrison?.length || b.hp <= 0) continue;
    if (b.garrison.some(g => g.owner !== b.owner)) {
      // Taken by the enemy: its old garrison is put out, whole, as its own side's units.
      const own = b.garrison.filter(g => g.owner === b.owner);
      const out = b.garrison.filter(g => g.owner !== b.owner);
      b.garrison = out;
      setOut(s, b, 1, occupancy(s));
      if (b.garrison?.length) {
        // No ground for some of them: they are lost.
        for (const g of b.garrison) s.players[g.owner].stats.lost++;
      }
      if (own.length) b.garrison = own;
      else delete b.garrison;
      continue;
    }
    // A Medic inside tends the others.
    if ((s.tick + b.id) % MEDIC_HEAL_TICKS === 0 && b.garrison.some(g => UNITS[g.kind].medic)) {
      let worst: Unit | null = null;
      for (const g of b.garrison) if (!UNITS[g.kind].medic && g.hp < maxHpOf(g) && (!worst || g.hp / maxHpOf(g) < worst.hp / maxHpOf(worst))) worst = g;
      if (worst) {
        const i = b.garrison.indexOf(worst);
        b.garrison = b.garrison.map((g, k) => (k === i ? { ...g, hp: Math.min(maxHpOf(g), g.hp + MEDIC_HEAL) } : g));
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The Supply Cache

/** Supply Caches this side holds and has queued. */
export function cachesOf(s: GameState, owner: Owner): number {
  let n = 0;
  for (const b of s.buildings) if (b.owner === owner && b.kind === 'supplycache') n++;
  for (const q of s.players[owner].queues.building) if (q.kind === 'supplycache') n++;
  return n;
}

/** True when a Supply Cache with its top-left at (x, y) stands within CACHE_PLACE_RANGE of one of the side's ground units. */
export function cacheNearTroops(s: GameState, owner: Owner, x: number, y: number): boolean {
  for (const u of s.units) {
    if (u.owner !== owner || u.hp <= 0 || isAir(u) || UNITS[u.kind].category === 'naval') continue;
    if (dist(u.x, u.y, x + 0.5, y + 0.5) <= CACHE_PLACE_RANGE) return true;
  }
  return false;
}

/** Supply Caches mend round them, and change hands to enemy infantry standing beside them unopposed. */
function cacheStep(s: GameState): void {
  const pulse = s.tick % CACHE_TICKS === 0;
  let any = false;
  for (const b of s.buildings) if (b.kind === 'supplycache' && b.hp > 0) any = true;
  if (!any) return;
  const infantry = s.units.filter(u => u.hp > 0 && UNITS[u.kind].category === 'infantry');
  for (const b of s.buildings) {
    if (b.kind !== 'supplycache' || b.hp <= 0) continue;
    if (pulse) {
      for (const u of s.units) {
        if (u.hp <= 0 || !isAlly(s, u.owner, b.owner)) continue;
        const cat = UNITS[u.kind].category;
        if (cat !== 'infantry' && cat !== 'vehicle') continue;
        const max = maxHpOf(u);
        if (u.hp >= max || distToBuilding(u.x, u.y, b) > CACHE_RADIUS) continue;
        u.hp = Math.min(max, u.hp + (cat === 'infantry' ? CACHE_HEAL : CACHE_REPAIR));
        if (Math.floor(s.tick / CACHE_TICKS) % 3 === 0) s.effects.push({ id: s.nextId++, kind: cat === 'infantry' ? 'heal' : 'repair', x: u.x, y: u.y, at: s.tick, size: 0 });
      }
    }
    // Capture: as a neutral site is taken, but by enemies of the holder only.
    const holder = teamOf(s, b.owner);
    const present = new Map<number, Owner>();
    for (const u of infantry) {
      if (distToBuilding(u.x, u.y, b) > CACHE_CAPTURE_RANGE) continue;
      const team = teamOf(s, u.owner);
      if (!present.has(team)) present.set(team, u.owner);
    }
    const defended = present.has(holder);
    const capturers = [...present.entries()].filter(([team]) => team !== holder);
    const T = CACHE_CAPTURE_TICKS;
    const steps = b.capture ? Math.round(b.capture.progress * T) : 0;
    if (capturers.length === 1 && !defended) {
      const [team, side] = capturers[0];
      if (b.capture && teamOf(s, b.capture.by) !== team) {
        if (steps > 1) b.capture = { by: b.capture.by, progress: (steps - 1) / T };
        else delete b.capture;
      } else if (steps + 1 >= T) {
        const by = b.capture ? b.capture.by : side;
        const before = b.owner;
        b.owner = by;
        delete b.capture;
        b.repairing = false;
        const c = buildingCentre(b);
        s.effects.push({ id: s.nextId++, kind: 'captured', x: c.x, y: c.y, at: s.tick, size: 1 });
        if (by === 0) log(s, 'Supply Cache taken.', 'good');
        else if (before === 0) log(s, 'We have lost a Supply Cache.', 'bad');
      } else b.capture = { by: b.capture ? b.capture.by : side, progress: (steps + 1) / T };
    } else if (capturers.length === 0 && b.capture) {
      if (steps > 1) b.capture = { by: b.capture.by, progress: (steps - 1) / T };
      else delete b.capture;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The Intelligence Centre

/** This side's Intelligence Centres that are working: standing, and the side not short of power. */
export function workingIntel(s: GameState, owner: Owner): Building[] {
  if (!strategicOn(s)) return [];
  const list = s.buildings.filter(b => b.owner === owner && b.kind === 'intelcentre' && b.hp > 0);
  if (!list.length || powerOf(s, owner).low) return [];
  return list;
}

/** True while this side has a working Intelligence Centre (the panel of enemy queues and research). */
export const intelActive = (s: GameState, owner: Owner): boolean => workingIntel(s, owner).length > 0;

/** True when one of `viewer`'s team's working Intelligence Centres has this structure within INTEL_RADIUS. */
export function intelCovers(s: GameState, viewer: Owner, b: Building): boolean {
  if (!strategicOn(s)) return false;
  const c = buildingCentre(b);
  for (const o of sidesOf(s)) {
    if (!isAlly(s, viewer, o)) continue;
    for (const i of workingIntel(s, o)) {
      const ic = buildingCentre(i);
      if (dist(ic.x, ic.y, c.x, c.y) <= INTEL_RADIUS) return true;
    }
  }
  return false;
}

/** Marks for `owner`'s visibility every tile of each enemy structure within reach of its working Intelligence Centres. */
export function markIntel(s: GameState, owner: Owner, set: (k: number) => void): void {
  const centres = workingIntel(s, owner);
  if (!centres.length) return;
  for (const b of s.buildings) {
    if (b.hp <= 0 || !isEnemy(s, owner, b.owner)) continue;
    const c = buildingCentre(b);
    if (!centres.some(i => dist(buildingCentre(i).x, buildingCentre(i).y, c.x, c.y) <= INTEL_RADIUS)) continue;
    const spec = BUILDINGS[b.kind];
    for (let y = b.y; y < b.y + spec.h; y++) for (let x = b.x; x < b.x + spec.w; x++) set(y * s.mapW + x);
  }
}

// ---------------------------------------------------------------------------------------------
// The Decoy

/** Kinds a Decoy may pass for: every other structure on its 2 by 2 footprint, bar the Field Yard (a deployed truck). */
export const DISGUISES: BuildingKind[] = (Object.keys(BUILDINGS) as BuildingKind[]).filter(
  k => k !== 'decoy' && k !== 'fieldyard' && BUILDINGS[k].w === BUILDINGS.decoy.w && BUILDINGS[k].h === BUILDINGS.decoy.h && !BUILDINGS[k].wall,
);

/** Why this Decoy cannot be made to look like that, or null. Only a kind its owner could build in this battle. */
export function disguiseProblem(s: GameState, owner: Owner, id: number, as: unknown): string | null {
  if (!strategicOn(s)) return 'Strategic structures are off';
  const b = s.buildings.find(x => x.id === id);
  if (!b || b.owner !== owner || b.kind !== 'decoy' || b.hp <= 0) return 'No such Decoy';
  if (typeof as !== 'string' || !DISGUISES.includes(as as BuildingKind)) return 'A Decoy cannot look like that';
  if (!techAllowed(s, owner, as as BuildingKind)) return 'Not a structure this battle has';
  if ((b.disguise ?? DECOY_DEFAULT) === as) return 'It already looks like that';
  return null;
}

export function doDisguise(s: GameState, _owner: Owner, id: number, as: BuildingKind): void {
  const b = s.buildings.find(x => x.id === id)!;
  b.disguise = as;
}

/**
 * The kind `viewer` takes this structure for. A Decoy passes for its disguise to anyone not on its
 * owner's team, unless their Intelligence Centre covers it; everything else is what it is.
 */
export function apparentKind(s: GameState, b: Building, viewer: Owner): BuildingKind {
  if (b.kind !== 'decoy') return b.kind;
  if (isAlly(s, viewer, b.owner) || intelCovers(s, viewer, b)) return 'decoy';
  return b.disguise ?? DECOY_DEFAULT;
}

/** The spec `viewer` takes this structure to have (a Decoy's disguise at level 1, to its enemies). */
export function apparentSpecOf(s: GameState, b: Building, viewer: Owner): BuildingSpec {
  if (b.kind !== 'decoy') return buildingSpecOf(s, b);
  const k = apparentKind(s, b, viewer);
  return k === 'decoy' ? buildingSpecOf(s, b) : buildingSpec(s, b.owner, k);
}

/** The health `viewer` takes this structure to have: a Decoy's own share of its health, of its disguise's. */
export function apparentHp(s: GameState, b: Building, viewer: Owner): number {
  if (b.kind !== 'decoy') return b.hp;
  const shown = apparentSpecOf(s, b, viewer);
  const own = buildingSpecOf(s, b);
  return shown === own ? b.hp : Math.max(1, Math.round((b.hp / own.hp) * shown.hp));
}

// ---------------------------------------------------------------------------------------------
// The tick, cloning and saves

/** One tick of upgrades and Supply Caches (tick.ts, after production). A no-op with both toggles off. */
export function structuresStep(s: GameState, power: boolean[]): void {
  if (upgradesOn(s)) upgradeStep(s, power);
  if (strategicOn(s)) cacheStep(s);
}

/** One tick of Bunkers being entered (tick.ts, after the units move). A no-op with strategic structures off. */
export function bunkersStep(s: GameState): void {
  if (strategicOn(s)) garrisonStep(s);
}

/** cloneState's copy of a structure's round-7 fields that the tick changes in place. */
export function cloneStructureFields(b: Building): Building {
  if (b.upgrade) b.upgrade = { ...b.upgrade };
  if (b.garrison) b.garrison = b.garrison.map(g => ({ ...g }));
  return b;
}

/**
 * A save's round-7 fields, kept only where they may be and well formed: levels and upgrades with
 * upgrades on, a Bunker's garrison, a Decoy's disguise and a Cache's capture with strategic
 * structures on, a soldier's walk to a Bunker likewise. Anything else is dropped. A save without any
 * of these fields is untouched.
 */
export function migrateStructures(out: GameState): void {
  const up = upgradesOn(out);
  const strat = strategicOn(out);
  const fields = ['level', 'upgrade', 'garrison', 'disguise', 'capture'];
  out.buildings = out.buildings.map(raw => {
    if (!raw || typeof raw !== 'object' || !fields.some(f => f in raw)) return raw;
    const { level, upgrade, garrison, disguise, capture, ...b } = raw as Building;
    const out2 = b as Building;
    const max = BUILDINGS[b.kind] ? maxLevelOf(b.kind) : 1;
    if (up && Number.isInteger(level) && level! >= 2 && level! <= max) out2.level = level;
    if (up && upgrade && typeof upgrade === 'object' && levelOf(out2) < max) {
      const progress = Number.isFinite(upgrade.progress) && upgrade.progress >= 0 ? upgrade.progress : 0;
      const credits = Number.isFinite(upgrade.credits) && upgrade.credits >= 0 ? Math.round(upgrade.credits) : 0;
      const alloys = Number.isFinite(upgrade.alloys) && upgrade.alloys! > 0 ? Math.floor(upgrade.alloys!) : 0;
      out2.upgrade = { progress: Math.min(progress, upgradeTicksOf(out2)), credits, ...(alloys ? { alloys } : {}) };
    }
    if (strat && b.kind === 'bunker' && Array.isArray(garrison)) {
      const kept = garrison
        .filter(g => !!g && typeof g === 'object' && g.kind in UNITS && canGarrison(g) && g.owner === b.owner && Number.isFinite(g.hp) && g.hp > 0 && Number.isInteger(g.id))
        .slice(0, BUNKER_SLOTS)
        .map((g): Unit => {
          const kills = Number.isFinite(g.kills) ? g.kills : 0;
          return {
            ...g,
            x: Number.isFinite(g.x) ? g.x : b.x,
            y: Number.isFinite(g.y) ? g.y : b.y,
            order: { type: 'idle' },
            engage: 0,
            path: [],
            pathGoal: -1,
            queue: [],
            cooldown: Number.isFinite(g.cooldown) && g.cooldown >= 0 ? g.cooldown : 0,
            kills,
            vet: g.vet === 0 || g.vet === 1 || g.vet === 2 ? g.vet : vetFor(kills),
            stance: g.stance === 'aggressive' || g.stance === 'hold' ? g.stance : 'guard',
          };
        });
      if (kept.length) out2.garrison = kept;
    }
    if (strat && b.kind === 'decoy' && typeof disguise === 'string' && DISGUISES.includes(disguise)) out2.disguise = disguise;
    if (strat && b.kind === 'supplycache' && capture && typeof capture === 'object' && isSide(out, capture.by) && Number.isFinite(capture.progress) && capture.progress > 0 && capture.progress < 1)
      out2.capture = { by: capture.by, progress: capture.progress };
    return out2;
  });
  out.units = out.units.map(u => {
    if (!u || typeof u !== 'object' || !('entering' in u)) return u;
    const { entering, ...rest } = u;
    return strat && Number.isInteger(entering) ? ({ ...rest, entering } as Unit) : (rest as Unit);
  });
}

/** Kinds still allowed in this queue for a side at the Cache limit: why a Supply Cache cannot be queued, or null. */
export function strategicQueueProblem(s: GameState, owner: Owner, kind: BuildingKind): string | null {
  if (kind === 'supplycache' && cachesOf(s, owner) >= CACHE_MAX) return `At most ${CACHE_MAX} Supply Caches`;
  return null;
}
