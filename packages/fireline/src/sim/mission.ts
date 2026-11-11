import { buildingCentre, dist, distToBuilding, dockTile, frontRow, laneRow, occupancy, onMap, passable, tileAt } from './grid';
import { generateMap, isWalkable } from './map';
import { next, seedFromString } from './rng';
import {
  BARRAGE_DAMAGE,
  BARRAGE_GAP,
  BARRAGE_SHELLS,
  BARRAGE_SPLASH,
  BUILDINGS,
  DIFFICULTIES,
  FLIGHT_TICKS,
  HERO_ABILITY,
  HERO_COOLDOWN_PER_LEVEL,
  HERO_DAMAGE_PER_LEVEL,
  HERO_HP_PER_LEVEL,
  HERO_XP_ABILITY,
  HERO_XP_STRUCTURE,
  OVERDRIVE_TICKS,
  POWERS,
  MISSILE_DAMAGE,
  RECON_TICKS,
  REINFORCEMENTS,
  SIDE_NAMES,
  SKIRMISH_POWERS,
  SPY_BLACKOUT_TICKS,
  DETECTOR_RANGE,
  SPY_DETECT_RANGE,
  SPY_SABOTAGE_TICKS,
  SPY_STEAL_MAX,
  SPY_STEAL_SHARE,
  UNITS,
  ORDER_QUEUE_MAX,
  heroLevelFor,
  CHARGE_FUSE,
  type BuildingKind,
  type HeroKind,
  type Owner,
  type SupportPower,
  type UnitKind,
} from './rules';
import { computerSides, isAlly, isEnemy, sidesOf, startOf } from './sides';
import { addBuilding, addUnit, isStructure, log, newAiMemory, updateExplored } from './state';
import type {
  Building,
  GameState,
  MissionContext,
  MissionOutcome,
  MissionSpec,
  ObjectiveRuntime,
  ObjectiveSpec,
  PlayerState,
  SpawnSpec,
  Unit,
} from './types';

/**
 * Missions, heroes, stealth and support powers in the simulation. Pure, like the rest of sim/:
 * no Math.random, no clock. The query functions (`*Problem`, `isDetected`, `heroUnit`,
 * `missionOutcome`, `objectiveLabel`) never change the state; the `do*` and `note*` functions
 * work in place on a state the reducer has already cloned.
 */

// ---------------------------------------------------------------------------------------------
// Setting a mission up

const newPlayer = (owner: Owner, credits: number): PlayerState => ({
  owner,
  name: SIDE_NAMES[owner],
  credits,
  queues: { building: [], infantry: [], vehicle: [], air: [], naval: [] },
  stats: { built: 0, trained: 0, lost: 0, killed: 0, harvested: 0 },
});

/** The centre of a side's Command Yard site: a skirmish's own (s.starts), else the original sites missions use. */
export const startCentre = (s: GameState, owner: Owner) => {
  const st = startOf(s, owner);
  return { x: st.x + 1.5, y: st.y + 1.5 };
};

export function toward(a: { x: number; y: number }, b: { x: number; y: number }, by: number): { x: number; y: number } {
  const d = dist(a.x, a.y, b.x, b.y) || 1;
  return { x: a.x + ((b.x - a.x) / d) * by, y: a.y + ((b.y - a.y) / d) * by };
}

/**
 * Whether a structure fits at (x, y) for a mission's opening layout: the same ground rules as
 * placing one in play (clear walkable ground, no ore, nobody standing there, refinery docks kept
 * free), without the "near your base" rule, and with a one-tile lane kept all round so a base
 * never walls itself in, as the computer's own builder does.
 */
function siteOk(s: GameState, occ: Int32Array, owner: Owner, kind: BuildingKind, x: number, y: number): boolean {
  const spec = BUILDINGS[kind];
  const lane = laneRow(s, owner, y, spec.h);
  if (!onMap(s, x - 1, y - 1) || !onMap(s, x + spec.w, y + spec.h) || !onMap(s, x, lane)) return false;
  for (let ty = y - 1; ty <= y + spec.h; ty++)
    for (let tx = x - 1; tx <= x + spec.w; tx++) {
      const k = tileAt(s, tx, ty);
      if (occ[k]) return false;
      const inside = tx >= x && tx < x + spec.w && ty >= y && ty < y + spec.h;
      if (inside && (!isWalkable(s.tiles[k]) || s.ore[k] > 0)) return false;
    }
  // The lane in front stays clear too: units leave barracks and factories there.
  for (let tx = x - 1; tx <= x + spec.w; tx++) if (onMap(s, tx, lane) && occ[tileAt(s, tx, lane)]) return false;
  for (const u of s.units) if (u.x >= x - 0.2 && u.x < x + spec.w + 0.2 && u.y >= y - 0.2 && u.y < y + spec.h + 0.2) return false;
  for (const b of s.buildings) {
    if (b.kind !== 'refinery') continue;
    const d = dockTile(s, b);
    if (d.x >= x && d.x < x + spec.w && d.y >= y && d.y < y + spec.h) return false;
  }
  if (kind === 'refinery') {
    const fy = frontRow(s, owner, y, spec.h);
    if (!onMap(s, x + 1, fy) || !isWalkable(s.tiles[tileAt(s, x + 1, fy)])) return false;
  }
  return true;
}

/** Puts a structure as near `focus` as the ground allows. Null if there is nowhere within reach. */
export function placeNear(s: GameState, owner: Owner, kind: BuildingKind, focus: { x: number; y: number }): Building | null {
  const spec = BUILDINGS[kind];
  const occ = occupancy(s);
  const fx = Math.round(focus.x);
  const fy = Math.round(focus.y);
  const cands: [number, number, number][] = [];
  for (let y = fy - 16; y <= fy + 16; y++)
    for (let x = fx - 16; x <= fx + 16; x++) {
      if (!onMap(s, x, y)) continue;
      cands.push([x, y, (x + spec.w / 2 - focus.x) ** 2 + (y + spec.h / 2 - focus.y) ** 2]);
    }
  cands.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  for (const [x, y] of cands) {
    if (!siteOk(s, occ, owner, kind, x, y)) continue;
    const b = addBuilding(s, owner, kind, x, y, -100);
    if (kind === 'refinery') {
      const d = dockTile(s, b);
      const h = addUnit(s, owner, 'hauler', d.x + 0.5, d.y + 0.5);
      h.order = { type: 'harvest', phase: 'seek', tile: -1, refinery: b.id };
    }
    return b;
  }
  return null;
}

/** Where a structure of this kind goes in an opening layout: turrets out front, refineries toward ore. */
export function focusFor(s: GameState, kind: BuildingKind, home: { x: number; y: number }, enemy: { x: number; y: number }) {
  if (kind === 'turret' || kind === 'rocketturret') return toward(home, enemy, 6);
  // Sandbags in a band ahead of the turrets: the base's outer line.
  if (kind === 'wall') return toward(home, enemy, 8);
  if (kind === 'refinery') {
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < s.ore.length; k++) {
      if (s.ore[k] <= 0) continue;
      const d = dist(home.x, home.y, (k % s.mapW) + 0.5, ((k / s.mapW) | 0) + 0.5);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best >= 0) return toward(home, { x: (best % s.mapW) + 0.5, y: ((best / s.mapW) | 0) + 0.5 }, Math.min(bestD * 0.6, 7));
  }
  return home;
}

/** The free tile nearest (x, y): passable, not in `taken`. Searched ring by ring, in a fixed order. */
function freeTile(s: GameState, occ: Int32Array, taken: Set<number>, x: number, y: number, maxR = 10): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  for (let r = 0; r <= maxR; r++) {
    let best = -1;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!passable(s, occ, nx, ny)) continue;
        const k = tileAt(s, nx, ny);
        if (taken.has(k)) continue;
        const d = (nx + 0.5 - x) ** 2 + (ny + 0.5 - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
    if (best >= 0) return best;
  }
  return -1;
}

/** Adds units one to a tile around (x, y). Returns those that found room. */
export function placeUnits(s: GameState, owner: Owner, kinds: UnitKind[], x: number, y: number): Unit[] {
  const occ = occupancy(s);
  const taken = new Set<number>();
  for (const u of s.units) taken.add(tileAt(s, Math.floor(u.x), Math.floor(u.y)));
  const out: Unit[] = [];
  for (const kind of kinds) {
    if (!(kind in UNITS)) continue;
    const k = freeTile(s, occ, taken, x, y);
    if (k < 0) continue;
    taken.add(k);
    out.push(addUnit(s, owner, kind, (k % s.mapW) + 0.5, ((k / s.mapW) | 0) + 0.5));
  }
  return out;
}

/** Full health of a hero at a level, with side 0's Armour perk. */
function heroMaxHp(s: GameState, u: Unit, level: number): number {
  const perk = u.owner === 0 && s.perks ? s.perks.unitHpMul : 1;
  return Math.max(1, Math.round(UNITS[u.kind].hp * perk * (1 + HERO_HP_PER_LEVEL * (level - 1))));
}

function setMaxHp(u: Unit, v: number): void {
  if (v === UNITS[u.kind].hp) delete u.maxHp;
  else u.maxHp = v;
}

/**
 * Heroes placed around (x, y) with their carried xp: level from xp, full health from the level (and
 * side 0's Armour perk), half of it for a wounded hero. Unknown kinds and repeats are skipped.
 * Returns the heroes that found room. Used by missions and planet battles alike.
 */
export function placeHeroes(s: GameState, owner: Owner, heroes: { kind: HeroKind; xp: number; wounded: boolean }[], x: number, y: number): Unit[] {
  const list = heroes.filter((h, i, all) => UNITS[h.kind]?.hero && all.findIndex(o => o.kind === h.kind) === i);
  const placed = placeUnits(s, owner, list.map(h => h.kind), x, y);
  for (const u of placed) {
    const carried = list.find(h => h.kind === u.kind)!;
    const xp = Math.max(0, Math.floor(carried.xp || 0));
    const level = heroLevelFor(xp);
    u.hero = { level, xp, abilityCd: 0 };
    const max = heroMaxHp(s, u, level);
    setMaxHp(u, max);
    u.hp = carried.wounded ? Math.max(1, Math.round(max / 2)) : max;
  }
  return placed;
}

/** A fresh battle set up from a mission spec and the campaign's context. Deterministic. */
export function createMissionState(spec: MissionSpec, ctx: MissionContext): GameState {
  const seedText = spec.seed.trim().slice(0, 64) || spec.id;
  const rngSeed = seedFromString(seedText);
  const map = generateMap(rngSeed);
  const difficulty = spec.difficulty in DIFFICULTIES ? spec.difficulty : 'normal';
  const d = DIFFICULTIES[difficulty];
  const perks = { ...ctx.perks };
  const powers0: Partial<Record<SupportPower, number>> = {};
  for (const p of [...spec.powers, ...ctx.extraPowers]) if (p in POWERS) powers0[p] = 0;
  const allowed: (BuildingKind | UnitKind)[] = [];
  for (const k of [...spec.tech, ...ctx.extraTech]) if (!allowed.includes(k)) allowed.push(k);

  const s: GameState = {
    version: 1,
    id: ctx.id,
    name: ctx.name || spec.title,
    createdAt: ctx.createdAt,
    seedText,
    rngSeed,
    difficulty,
    tick: 0,
    tiles: map.tiles,
    ore: map.ore,
    mapW: map.w,
    mapH: map.h,
    explored: '0'.repeat(map.w * map.h),
    units: [],
    buildings: [],
    players: [newPlayer(0, Math.max(0, spec.player.credits + perks.extraStartCredits)), newPlayer(1, Math.max(0, spec.enemy.credits))],
    teams: [0, 1],
    projectiles: [],
    effects: [],
    ai: [newAiMemory(d.firstAttack), newAiMemory(d.firstAttack)],
    autopilot: false,
    nextId: 1,
    winner: null,
    log: [{ tick: 0, text: `${spec.title}. ${spec.summary}`, tone: 'info' }],
    alarms: {},
    mission: {
      id: spec.id,
      ai: spec.enemy.ai,
      objectives: spec.objectives.map(newObjective),
      bonus: spec.bonus.map(newObjective),
      timeLimit: spec.timeLimit ?? null,
      fired: [],
      result: null,
      triggers: spec.triggers.map(t => ({ ...t, ...('spawn' in t && t.spawn ? { spawn: { ...t.spawn } } : {}) })),
      ...(spec.structurePowers ? { structurePowers: [[], []] } : {}),
      ...(ctx.level && ctx.level !== 'normal' ? { level: ctx.level } : {}),
    },
    perks,
    powers: [powers0, {}],
    allowed,
    blackoutUntil: [0, 0],
    recon: [],
  };

  const home0 = startCentre(s, 0);
  const home1 = startCentre(s, 1);
  const site0 = startOf(s, 0);
  const site1 = startOf(s, 1);
  // Side 0: a Command Yard only if the spec asks for one.
  if (spec.player.structures.includes('hq')) addBuilding(s, 0, 'hq', site0.x, site0.y, -100);
  for (const k of spec.player.structures) if (k !== 'hq' && k in BUILDINGS) placeNear(s, 0, k, focusFor(s, k, home0, home1));
  // Side 1: a full base has a Command Yard; an outpost is its structures alone, laid out the same way.
  if (spec.enemy.base === 'full') addBuilding(s, 1, 'hq', site1.x, site1.y, -100);
  for (const k of spec.enemy.structures) if (k !== 'hq' && k in BUILDINGS) placeNear(s, 1, k, focusFor(s, k, home1, home0));

  // Troops stand on the side of their base that faces the middle of the map.
  const muster0 = toward(home0, home1, spec.player.structures.length ? 4 : 0);
  const muster1 = toward(home1, home0, spec.enemy.base === 'full' || spec.enemy.structures.length ? 4 : 0);
  placeUnits(s, 0, spec.player.units, muster0.x, muster0.y);
  const heroes = spec.player.heroes.filter((h, i, all) => all.indexOf(h) === i && ctx.heroes[h] && UNITS[h]?.hero);
  placeHeroes(
    s,
    0,
    heroes.map(kind => ({ kind, xp: ctx.heroes[kind]!.xp, wounded: ctx.heroes[kind]!.wounded })),
    muster0.x,
    muster0.y,
  );
  placeUnits(s, 1, spec.enemy.units, muster1.x, muster1.y);
  if (spec.convoy) placeConvoy(s, spec.convoy);
  if (spec.structurePowers) syncStructurePowers(s);
  updateExplored(s);
  return s;
}

/**
 * The convoy: side 0's units at (x, y), sent along the route as one move order and the rest
 * queued, so the player may take over at any point. Its ids and its way are kept on the mission.
 */
function placeConvoy(s: GameState, c: NonNullable<MissionSpec['convoy']>): void {
  const route = c.route.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).slice(0, 1 + ORDER_QUEUE_MAX);
  const units = placeUnits(s, 0, c.kinds, c.x, c.y);
  if (route.length) {
    for (const u of units) {
      u.order = { type: 'move', x: route[0].x, y: route[0].y };
      u.queue = route.slice(1).map(p => ({ type: 'move', x: p.x, y: p.y }));
    }
  }
  s.mission!.convoy = units.map(u => u.id);
  s.mission!.convoyRoute = [{ x: c.x, y: c.y }, ...route.map(p => ({ x: p.x, y: p.y }))];
}

function newObjective(spec: ObjectiveSpec): ObjectiveRuntime {
  // A hero to keep alive starts the battle alive: that objective reads full from the outset.
  return { spec: { ...spec }, label: objectiveLabel(spec), done: false, failed: false, progress: spec.kind === 'keepAlive' ? 1 : 0 };
}

// ---------------------------------------------------------------------------------------------
// Words

const plural = (name: string) => (/[^aeiou]y$/.test(name) ? `${name.slice(0, -1)}ies` : `${name}s`);
const article = (name: string) => (/^[aeiou]/i.test(name) ? 'an' : 'a');
/** "The Spy" in the middle of a sentence. */
const heroName = (kind: HeroKind) => UNITS[kind].name.replace(/^The /, 'the ');
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function duration(ticks: number): string {
  const secs = Math.round(ticks / 10);
  if (secs >= 60 && secs % 60 === 0) {
    const m = secs / 60;
    return `${m} minute${m === 1 ? '' : 's'}`;
  }
  if (secs > 60) {
    const m = Math.floor(secs / 60);
    return `${m} minute${m === 1 ? '' : 's'} ${secs % 60} seconds`;
  }
  return `${secs} second${secs === 1 ? '' : 's'}`;
}

/** Player-facing words for an objective, e.g. "Destroy 2 enemy Gun Turrets". */
export function objectiveLabel(o: ObjectiveSpec): string {
  switch (o.kind) {
    case 'destroyAll':
      return 'Destroy every enemy unit and structure';
    case 'destroy': {
      const name = BUILDINGS[o.building]?.name ?? o.building;
      return o.count === 1 ? `Destroy the enemy ${name}` : `Destroy ${o.count} enemy ${plural(name)}`;
    }
    case 'survive':
      return `Survive for ${duration(o.ticks)}`;
    case 'keepAlive':
      return `${capital(heroName(o.hero))} must survive`;
    case 'infiltrate':
      return `Infiltrate the enemy ${BUILDINGS[o.building]?.name ?? o.building}`;
    case 'capture':
      return `Capture the enemy ${BUILDINGS[o.building]?.name ?? o.building}`;
    case 'reach':
      return o.who === 'any' ? 'Reach the marked point' : `Get ${heroName(o.who)} to the marked point`;
    case 'holdZone':
      return o.reset
        ? `Hold the marked area for ${duration(o.ticks)} without losing it`
        : `Hold the marked area for ${duration(o.ticks)}`;
    case 'harvest':
      return `Harvest ${o.credits} credits of ore`;
    case 'build': {
      const name = BUILDINGS[o.building]?.name ?? o.building;
      return o.count === 1 ? `Build ${article(name)} ${name}` : `Build ${o.count} ${plural(name)}`;
    }
    case 'escort':
      return o.count === 1 ? 'Bring a convoy vehicle to the marked point' : `Bring ${o.count} convoy vehicles to the marked point`;
    case 'destroyWithin': {
      const name = BUILDINGS[o.building]?.name ?? o.building;
      const what = o.count === 1 ? `the enemy ${name}` : `${o.count} enemy ${plural(name)}`;
      return `Destroy ${what} within ${duration(o.ticks)}`;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Queries

/** The hero of this kind on side `owner`, if alive. */
export function heroUnit(s: GameState, owner: Owner, kind: HeroKind): Unit | undefined {
  return s.units.find(u => u.owner === owner && u.kind === kind && u.hp > 0 && !!u.hero);
}

/**
 * Whether side `by` can currently see this unit (Spies are hidden unless detected). Allies share
 * what they detect: a Spy within range of any unit or structure of `by`'s team is seen by all of it,
 * and side 0's recon sweeps show Spies to side 0's team.
 */
export function isDetected(s: GameState, u: Unit, by: Owner): boolean {
  if (u.kind !== 'spy' || isAlly(s, u.owner, by)) return true;
  const r = SPY_DETECT_RANGE;
  for (const e of s.units) {
    if (e.hp <= 0 || !isAlly(s, e.owner, by)) continue;
    // A detector (the Recon Plane) spots Spies from further off; never nearer than anyone else.
    const rr = UNITS[e.kind].detector ? Math.max(r, DETECTOR_RANGE) : r;
    if (Math.abs(e.x - u.x) <= rr && Math.abs(e.y - u.y) <= rr && dist(e.x, e.y, u.x, u.y) <= rr) return true;
  }
  for (const b of s.buildings) if (b.hp > 0 && isAlly(s, b.owner, by) && distToBuilding(u.x, u.y, b) <= r) return true;
  if (isAlly(s, by, 0) && s.recon) for (const a of s.recon) if (s.tick < a[3] && dist(a[0], a[1], u.x, u.y) <= a[2]) return true;
  return false;
}

const over = (s: GameState) => s.winner !== null || !!s.mission?.result;

/** Why this hero cannot use its ability on that target now, or null if it can. */
export function abilityProblem(s: GameState, owner: Owner, heroId: number, target?: number): string | null {
  if (over(s)) return 'The battle is over';
  const u = s.units.find(v => v.id === heroId);
  if (!u || u.owner !== owner || u.hp <= 0 || !u.hero) return 'No such hero';
  const kind = u.kind as HeroKind;
  const spec = HERO_ABILITY[kind];
  if (u.hero.active?.kind === 'capture') return 'Already capturing';
  if (u.hero.abilityCd > 0) return `${spec.name} is not ready`;
  if (spec.target === 'none') return null;
  const b = Number.isInteger(target) ? s.buildings.find(v => v.id === target && v.hp > 0) : undefined;
  if (!b || !isEnemy(s, owner, b.owner)) return 'Choose an enemy structure';
  if (kind === 'engineer' && b.kind === 'hq') return 'A Command Yard cannot be captured';
  if (kind === 'spy' && b.kind === 'turret') return 'Nothing to learn in a Gun Turret';
  if (kind === 'commando' && b.chargeAt !== undefined) return 'A charge is already set there';
  if (distToBuilding(u.x, u.y, b) > spec.range) return 'Move closer first';
  return null;
}

/** Why side `owner` cannot call this power at (x, y) now, or null if it can. */
export function powerProblem(s: GameState, owner: Owner, power: SupportPower, x: number, y: number): string | null {
  if (over(s)) return 'The battle is over';
  if (!(power in POWERS)) return 'No such power';
  const cd = s.powers?.[owner]?.[power];
  if (cd === undefined) return `${POWERS[power].name} is not available`;
  if (cd > 0) return `${POWERS[power].name} is not ready`;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !onMap(s, Math.floor(x), Math.floor(y))) return 'Choose a point on the map';
  return null;
}

/** The outcome once s.mission.result is set; null while the mission is still running. */
export function missionOutcome(s: GameState): MissionOutcome | null {
  const m = s.mission;
  if (!m || !m.result) return null;
  const won = m.result === 'won';
  const heroes: MissionOutcome['heroes'] = {};
  for (const [kind, xp] of Object.entries(m.fallen ?? {})) heroes[kind as HeroKind] = { xp: xp ?? 0, alive: false };
  for (const u of s.units) if (u.owner === 0 && u.hero && u.hp > 0) heroes[u.kind as HeroKind] = { xp: u.hero.xp, alive: true };
  return {
    missionId: m.id,
    won,
    stars: won ? 1 + m.bonus.filter(o => o.done).length : 0,
    ticks: s.tick,
    kills: s.players[0].stats.killed,
    losses: s.players[0].stats.lost,
    heroes,
  };
}

// ---------------------------------------------------------------------------------------------
// Heroes

export const heroDamageMul = (u: Unit): number => (u.hero ? 1 + HERO_DAMAGE_PER_LEVEL * (u.hero.level - 1) : 1);

export function abilityCooldown(kind: HeroKind, level: number): number {
  return Math.round(HERO_ABILITY[kind].cooldown * (1 - HERO_COOLDOWN_PER_LEVEL * (level - 1)));
}

/** Xp for a hero; a level gained raises its health and damage, shows an effect and is logged. */
export function gainHeroXp(s: GameState, u: Unit, amount: number): void {
  if (!u.hero || amount <= 0) return;
  u.hero.xp += amount;
  const level = heroLevelFor(u.hero.xp);
  if (level <= u.hero.level) return;
  const before = heroMaxHp(s, u, u.hero.level);
  u.hero.level = level;
  const after = heroMaxHp(s, u, level);
  setMaxHp(u, after);
  u.hp = Math.min(after, u.hp + (after - before));
  s.effects.push({ id: s.nextId++, kind: 'levelup', x: u.x, y: u.y, at: s.tick, size: level });
  if (u.owner === 0) log(s, `${UNITS[u.kind].name} reached level ${level}.`, 'good');
}

/** Xp a hero earns for destroying this. */
export const killXp = (victim: { kind: string }, isBuilding: boolean): number =>
  isBuilding ? HERO_XP_STRUCTURE : Math.max(5, Math.floor(UNITS[victim.kind as UnitKind].cost / 20));

function revealArea(s: GameState, cx: number, cy: number, r: number): void {
  const chars = s.explored.split('');
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(s.mapH - 1, Math.ceil(cy + r)); y++)
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(s.mapW - 1, Math.ceil(cx + r)); x++)
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) chars[tileAt(s, x, y)] = '1';
  s.explored = chars.join('');
}

/** Applies a hero's ability that abilityProblem has passed, on a cloned state. */
export function doAbility(s: GameState, owner: Owner, heroId: number, target?: number): void {
  const u = s.units.find(v => v.id === heroId)!;
  const h = u.hero!;
  const kind = u.kind as HeroKind;
  const say = (text: string, tone: 'info' | 'good' | 'bad' = 'good') => owner === 0 && log(s, text, tone);
  if (kind === 'ace') {
    h.active = { kind: 'overdrive', until: s.tick + OVERDRIVE_TICKS };
    h.abilityCd = abilityCooldown(kind, h.level);
    say('The Ace: overdrive.');
    return;
  }
  const b = s.buildings.find(v => v.id === target)!;
  const c = buildingCentre(b);
  const name = BUILDINGS[b.kind].name;
  if (kind === 'engineer') {
    // The cooldown starts when the capture succeeds; an interrupted one can be tried again at once.
    h.active = { kind: 'capture', target: b.id, progress: 0 };
    u.order = { type: 'idle' };
    u.engage = 0;
    u.path = [];
    u.pathGoal = -1;
    u.queue = [];
    say(`The Engineer is taking over the enemy ${name}.`, 'info');
    return;
  }
  h.abilityCd = abilityCooldown(kind, h.level);
  if (kind === 'commando') {
    b.chargeAt = s.tick + CHARGE_FUSE;
    b.chargedBy = u.id;
    s.effects.push({ id: s.nextId++, kind: 'charge', x: c.x, y: c.y, at: s.tick, size: 0 });
    say(`Charge set on the enemy ${name}.`);
    return;
  }
  // The Spy.
  const enemy = b.owner;
  s.effects.push({ id: s.nextId++, kind: 'infiltrate', x: c.x, y: c.y, at: s.tick, size: 0 });
  switch (b.kind) {
    case 'refinery': {
      const take = Math.min(SPY_STEAL_MAX, Math.floor(s.players[enemy].credits * SPY_STEAL_SHARE));
      s.players[enemy].credits -= take;
      s.players[owner].credits += take;
      say(`The Spy stole ${take} credits from the enemy Refinery.`);
      break;
    }
    case 'power': {
      const until = sidesOf(s).map(o => s.blackoutUntil?.[o] ?? 0);
      until[enemy] = Math.max(until[enemy], s.tick + SPY_BLACKOUT_TICKS);
      s.blackoutUntil = until;
      say('The Spy cut the enemy power for 60 seconds.');
      break;
    }
    case 'uplink':
      if (owner === 0) s.explored = '1'.repeat(s.mapW * s.mapH);
      say('The Spy tapped the enemy Uplink: the whole map is revealed.');
      break;
    case 'factory':
    case 'barracks':
      b.sabotagedUntil = s.tick + SPY_SABOTAGE_TICKS;
      say(`The Spy sabotaged the enemy ${name}: production stopped for 45 seconds.`);
      break;
    case 'hq': {
      if (owner === 0) for (const e of s.buildings) if (e.owner === enemy) {
        const ec = buildingCentre(e);
        revealArea(s, ec.x, ec.y, BUILDINGS[e.kind].sight + 2);
      }
      // Their next wave: half the growth it has built up, and later.
      const mem = s.ai[enemy];
      const d = DIFFICULTIES[s.difficulty];
      mem.wave = Math.floor(mem.wave / 2);
      mem.nextAttack = Math.max(mem.nextAttack, s.tick) + Math.floor(d.attackInterval / 2);
      say('The Spy read the enemy plans: their base is revealed and their next attack weakened.');
      break;
    }
    default:
      break;
  }
  noteEvent(s, 'infiltrate', b.kind, owner);
  gainHeroXp(s, u, HERO_XP_ABILITY);
}

/** Finishes an Engineer's capture: the structure changes sides. */
export function completeCapture(s: GameState, u: Unit, b: Building): void {
  const from = b.owner;
  b.owner = u.owner;
  b.engage = 0;
  b.rally = null;
  b.repairing = false;
  b.tx = -b.tx;
  b.ty = -b.ty;
  delete b.sabotagedUntil;
  const c = buildingCentre(b);
  s.effects.push({ id: s.nextId++, kind: 'captured', x: c.x, y: c.y, at: s.tick, size: Math.max(BUILDINGS[b.kind].w, BUILDINGS[b.kind].h) });
  if (u.owner === 0) log(s, `The Engineer captured the enemy ${BUILDINGS[b.kind].name}.`, 'good');
  else if (from === 0) log(s, `Our ${BUILDINGS[b.kind].name} has been captured.`, 'bad');
  noteEvent(s, 'capture', b.kind, u.owner);
  const h = u.hero!;
  delete h.active;
  h.abilityCd = abilityCooldown(u.kind as HeroKind, h.level);
  gainHeroXp(s, u, HERO_XP_ABILITY);
}

// ---------------------------------------------------------------------------------------------
// Support powers

/** The middle of a side's base: its Command Yard, else its first structure, else its troops. */
export function baseCentre(s: GameState, owner: Owner): { x: number; y: number } {
  let first: Building | undefined;
  for (const b of s.buildings) {
    if (b.owner !== owner) continue;
    if (b.kind === 'hq') return buildingCentre(b);
    if (!first || b.id < first.id) first = b;
  }
  if (first) return buildingCentre(first);
  let n = 0;
  let x = 0;
  let y = 0;
  for (const u of s.units)
    if (u.owner === owner) {
      n++;
      x += u.x;
      y += u.y;
    }
  return n ? { x: x / n, y: y / n } : startCentre(s, owner);
}

/** The passable tile on the edge of the map nearest a point. -1 if the whole edge is blocked. */
function edgeTileNear(s: GameState, occ: Int32Array, p: { x: number; y: number }): number {
  let best = -1;
  let bestD = Infinity;
  const consider = (x: number, y: number) => {
    if (!passable(s, occ, x, y)) return;
    const d = (x + 0.5 - p.x) ** 2 + (y + 0.5 - p.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = tileAt(s, x, y);
    }
  };
  for (let x = 0; x < s.mapW; x++) {
    consider(x, 0);
    consider(x, s.mapH - 1);
  }
  for (let y = 1; y < s.mapH - 1; y++) {
    consider(0, y);
    consider(s.mapW - 1, y);
  }
  return best;
}

function draw(s: GameState): number {
  const r = next(s.rngSeed);
  s.rngSeed = r.seed;
  return r.value;
}

/** Calls a support power that powerProblem has passed, on a cloned state. */
export function doPower(s: GameState, owner: Owner, power: SupportPower, x: number, y: number): void {
  const mul = owner === 0 && s.perks ? s.perks.powerCooldownMul : 1;
  const powers: NonNullable<GameState['powers']> = s.powers ? s.powers : sidesOf(s).map(() => ({}));
  powers[owner] = { ...powers[owner], [power]: Math.max(1, Math.round(POWERS[power].cooldown * mul)) };
  s.powers = powers;
  const say = (text: string) => owner === 0 && log(s, text, 'good');
  if (power === 'recon') {
    // s.recon is what side 0 sees. The computer (side 1 in a skirmish) already sees the whole
    // map, so its sweep reveals nothing to anyone and leaves no mark.
    if (owner !== 0) return;
    const r = POWERS.recon.radius;
    s.recon = [...(s.recon ?? []), [x, y, r, s.tick + RECON_TICKS]];
    s.effects.push({ id: s.nextId++, kind: 'recon', x, y, at: s.tick, size: r });
    updateExplored(s);
    say('Recon sweep under way.');
    return;
  }
  if (power === 'missile') {
    // One missile from the base, landing FLIGHT_TICKS.missile later. The marker at the target is
    // drawn for both sides from the moment it is called, so the target has a few seconds to scatter.
    const r = POWERS.missile.radius;
    const from = baseCentre(s, owner);
    s.projectiles.push({
      id: s.nextId++,
      owner,
      weapon: 'missile',
      fromX: from.x,
      fromY: from.y,
      toX: x,
      toY: y,
      firedAt: s.tick,
      hitAt: s.tick + FLIGHT_TICKS.missile,
      target: 0,
      damage: MISSILE_DAMAGE,
      splash: r,
      shooter: 0,
    });
    s.effects.push({ id: s.nextId++, kind: 'missile', x, y, at: s.tick, size: r });
    if (owner === 0) say('Missile launched.');
    else if (isEnemy(s, 0, owner)) log(s, 'Enemy missile launch detected. Clear the marked area.', 'bad');
    else log(s, 'Allied missile launched.', 'info');
    return;
  }
  if (power === 'barrage') {
    const r = POWERS.barrage.radius;
    const from = baseCentre(s, owner);
    for (let i = 0; i < BARRAGE_SHELLS; i++) {
      // A point in the disc, by rejection: no trigonometry in the simulation.
      let dx = 0;
      let dy = 0;
      for (let tries = 0; tries < 8; tries++) {
        dx = draw(s) * 2 - 1;
        dy = draw(s) * 2 - 1;
        if (dx * dx + dy * dy <= 1) break;
      }
      const toX = Math.max(0, Math.min(s.mapW - 0.01, x + dx * r));
      const toY = Math.max(0, Math.min(s.mapH - 0.01, y + dy * r));
      s.projectiles.push({
        id: s.nextId++,
        owner,
        weapon: 'artillery',
        fromX: from.x,
        fromY: from.y,
        toX,
        toY,
        firedAt: s.tick,
        hitAt: s.tick + FLIGHT_TICKS.artillery + i * BARRAGE_GAP,
        target: 0,
        damage: BARRAGE_DAMAGE,
        splash: BARRAGE_SPLASH,
        shooter: 0,
      });
    }
    s.effects.push({ id: s.nextId++, kind: 'barrage', x, y, at: s.tick, size: r });
    say('Artillery barrage on its way.');
    return;
  }
  // Reinforcements, at the edge of the map nearest the base, walking in toward it.
  const home = baseCentre(s, owner);
  const occ = occupancy(s);
  const edge = edgeTileNear(s, occ, home);
  if (edge < 0) return;
  const ex = (edge % s.mapW) + 0.5;
  const ey = ((edge / s.mapW) | 0) + 0.5;
  const units = placeUnits(s, owner, REINFORCEMENTS, ex, ey);
  const goal = toward({ x: ex, y: ey }, home, Math.min(6, dist(ex, ey, home.x, home.y)));
  for (const u of units) u.order = { type: 'move', x: goal.x, y: goal.y };
  s.effects.push({ id: s.nextId++, kind: 'reinforce', x: ex, y: ey, at: s.tick, size: units.length });
  say('Reinforcements have arrived.');
}

// ---------------------------------------------------------------------------------------------
// The mission as it plays

/** An infiltration or capture just happened: objectives that wanted it are done. */
export function noteEvent(s: GameState, kind: 'infiltrate' | 'capture', building: BuildingKind, by: Owner): void {
  if (!s.mission || by !== 0) return;
  for (const o of [...s.mission.objectives, ...s.mission.bonus])
    if (o.spec.kind === kind && o.spec.building === building && !o.done) {
      o.done = true;
      o.progress = 1;
    }
}

/** An enemy structure has been destroyed: counts toward "destroy" objectives. */
export function noteDestroyed(s: GameState, b: Building): void {
  if (!s.mission || !isEnemy(s, 0, b.owner)) return;
  for (const o of [...s.mission.objectives, ...s.mission.bonus]) {
    const sp = o.spec;
    if ((sp.kind !== 'destroy' && sp.kind !== 'destroyWithin') || sp.building !== b.kind || o.done || o.failed) continue;
    const count = Math.max(1, sp.count);
    const n = Math.round(o.progress * count) + 1;
    o.progress = Math.min(1, n / count);
    if (n >= count) o.done = true;
  }
}

/** A hero has fallen: out for the rest of the battle, remembered for the debrief. */
export function noteFallen(s: GameState, u: Unit): void {
  if (!u.hero || u.owner !== 0) return;
  if (s.mission) s.mission.fallen = { ...s.mission.fallen, [u.kind]: u.hero.xp };
  if (s.planet) s.planet.fallen = { ...s.planet.fallen, [u.kind]: u.hero.xp };
  log(s, `${UNITS[u.kind].name} has fallen.`, 'bad');
}

/** Units arriving by a trigger. */
export function spawnGroup(s: GameState, sp: SpawnSpec): Unit[] {
  if (!(sp.kind in UNITS) || UNITS[sp.kind].hero || !Number.isFinite(sp.x) || !Number.isFinite(sp.y)) return [];
  const kinds: UnitKind[] = new Array(Math.max(0, Math.min(40, Math.floor(sp.count)))).fill(sp.kind);
  const units = placeUnits(s, sp.owner, kinds, sp.x, sp.y);
  if (sp.order === 'attackMove') {
    const tx = Number.isFinite(sp.tx) ? sp.tx! : sp.x;
    const ty = Number.isFinite(sp.ty) ? sp.ty! : sp.y;
    for (const u of units) u.order = UNITS[u.kind].weapon ? { type: 'attackMove', x: tx, y: ty } : { type: 'move', x: tx, y: ty };
  }
  return units;
}

function evalObjective(s: GameState, o: ObjectiveRuntime): void {
  const sp = o.spec;
  if (sp.kind === 'keepAlive') {
    const fell = s.mission!.fallen?.[sp.hero] !== undefined;
    o.failed = fell;
    o.progress = fell ? 0 : 1;
    return;
  }
  if (o.done || o.failed) return;
  switch (sp.kind) {
    case 'destroyAll': {
      let left = 0;
      for (const b of s.buildings) if (isEnemy(s, 0, b.owner)) left++;
      for (const u of s.units) if (isEnemy(s, 0, u.owner)) left++;
      const killed = s.players[0].stats.killed;
      o.progress = left === 0 ? 1 : killed / (killed + left);
      if (left === 0) o.done = true;
      return;
    }
    case 'survive':
      o.progress = Math.min(1, s.tick / Math.max(1, sp.ticks));
      if (s.tick >= sp.ticks) o.done = true;
      return;
    case 'reach':
      for (const u of s.units) {
        if (u.owner !== 0 || (sp.who !== 'any' && u.kind !== sp.who)) continue;
        if (dist(u.x, u.y, sp.x, sp.y) <= sp.r) {
          o.done = true;
          o.progress = 1;
          return;
        }
      }
      return;
    case 'holdZone': {
      let mine = false;
      let theirs = false;
      for (const u of s.units) {
        if (dist(u.x, u.y, sp.x, sp.y) > sp.r) continue;
        if (u.owner === 0) mine = true;
        else if (isEnemy(s, 0, u.owner)) theirs = true;
      }
      if (mine && !theirs) {
        const total = Math.max(1, sp.ticks);
        const n = Math.round(o.progress * total) + 1;
        o.progress = Math.min(1, n / total);
        if (n >= total) o.done = true;
      } else if (sp.reset && theirs && !mine) o.progress = 0;
      return;
    }
    case 'escort': {
      const ids = s.mission!.convoy ?? [];
      const need = Math.max(1, sp.count);
      let alive = 0;
      let there = 0;
      let lead = 0;
      const route = s.mission!.convoyRoute ?? [];
      for (const u of s.units) {
        if (u.owner !== 0 || u.hp <= 0 || !ids.includes(u.id)) continue;
        alive++;
        if (dist(u.x, u.y, sp.x, sp.y) <= sp.r) there++;
        lead = Math.max(lead, alongRoute(route, u.x, u.y));
      }
      if (there >= need) {
        o.done = true;
        o.progress = 1;
      } else if (alive < need) o.failed = true;
      else o.progress = Math.min(1, lead);
      return;
    }
    case 'destroyWithin':
      // The count moves in noteDestroyed; the clock is checked here.
      if (s.tick > sp.ticks) o.failed = true;
      return;
    case 'harvest':
      o.progress = Math.min(1, s.players[0].stats.harvested / Math.max(1, sp.credits));
      if (s.players[0].stats.harvested >= sp.credits) o.done = true;
      return;
    case 'build': {
      let n = 0;
      for (const b of s.buildings) if (b.owner === 0 && b.kind === sp.building) n++;
      o.progress = Math.min(1, n / Math.max(1, sp.count));
      if (n >= sp.count) o.done = true;
      return;
    }
    case 'infiltrate':
    case 'capture':
      // These move when the event happens (noteEvent). With no enemy structure of the kind left,
      // one never can: fail it rather than leave the mission open with nothing to do.
      if (!s.buildings.some(b => b.kind === sp.building && b.hp > 0 && isEnemy(s, 0, b.owner))) o.failed = true;
      return;
    // destroy moves when the event happens (noteDestroyed).
    default:
      return;
  }
}

/** How far along a route (0 at its start, 1 at its end) the point of it nearest (x, y) lies. */
function alongRoute(route: { x: number; y: number }[], x: number, y: number): number {
  if (route.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < route.length; i++) total += dist(route[i - 1].x, route[i - 1].y, route[i].x, route[i].y);
  if (total <= 0) return 1;
  let best = Infinity;
  let at = 0;
  let acc = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const len = dist(a.x, a.y, b.x, b.y);
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / (len * len))) : 0;
    const d = dist(x, y, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    if (d < best) {
      best = d;
      at = acc + t * len;
    }
    acc += len;
  }
  return at / total;
}

/**
 * A mission with structurePowers: each side holds the support power its structures grant
 * (SKIRMISH_POWERS), granted on full cooldown when the first stands and lost with the last. A power
 * the mission gave at the start is never touched. Works in place; the lists are replaced, not edited.
 */
function syncStructurePowers(s: GameState): void {
  const m = s.mission;
  if (!m || !m.structurePowers) return;
  const powers: NonNullable<GameState['powers']> = s.powers ?? sidesOf(s).map(() => ({}));
  const held = sidesOf(s).map(o => m.structurePowers![o] ?? []);
  let changed = false;
  for (const o of sidesOf(s)) {
    for (const [power, kind] of Object.entries(SKIRMISH_POWERS) as [SupportPower, BuildingKind][]) {
      const has = s.buildings.some(b => b.owner === o && b.kind === kind && b.hp > 0);
      const mine = held[o].includes(power);
      if (has && !mine && powers[o]?.[power] === undefined) {
        powers[o] = { ...powers[o], [power]: POWERS[power].cooldown };
        held[o] = [...held[o], power];
        changed = true;
      } else if (!has && mine) {
        const next = { ...powers[o] };
        delete next[power];
        powers[o] = next;
        held[o] = held[o].filter(p => p !== power);
        changed = true;
      }
    }
  }
  if (!changed) return;
  s.powers = powers;
  m.structurePowers = held;
}

/** Side 0's structure with the most of side 0's structures within r of its centre: the costliest place for a blast. */
function densestStructure(s: GameState, r: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestN = -1;
  for (const b of s.buildings) {
    if (b.owner !== 0 || b.hp <= 0 || !isStructure(b)) continue;
    const c = buildingCentre(b);
    let n = 0;
    for (const e of s.buildings) if (e.owner === 0 && e.hp > 0 && isStructure(e) && distToBuilding(c.x, c.y, e) <= r) n++;
    if (n > bestN) {
      bestN = n;
      best = c;
    }
  }
  return best;
}

/**
 * The computer's barrage and missile in a mission with structurePowers, called once charged: the
 * missile at side 0's densest cluster of structures, the barrage at a knot of three or more of
 * side 0's units, else at side 0's structure nearest the caller's base. A passive enemy never fires.
 */
function missionStrikes(s: GameState): void {
  if (!s.powers || s.mission!.ai === 'passive') return;
  for (const o of computerSides(s)) {
    if (!isEnemy(s, 0, o)) continue;
    const pw = s.powers[o];
    if (!pw) continue;
    if (pw.missile === 0) {
      const at = densestStructure(s, POWERS.missile.radius);
      if (at && powerProblem(s, o, 'missile', at.x, at.y) === null) doPower(s, o, 'missile', at.x, at.y);
    }
    if (pw.barrage === 0) {
      const r = POWERS.barrage.radius;
      let at: { x: number; y: number } | null = null;
      let bestN = 2;
      // Only at troops it can see: a barrage aimed with the whole map in view found the player's
      // rally point deep in their own base every three minutes and killed half of everything there
      // (27 units with one barrage in Firestorm), with nothing a player could do about it. Out of
      // sight, the army is safe; in sight, near their units or structures, it is fair game.
      const watchers = [
        ...s.units.filter(v => v.hp > 0 && v.owner === o).map(v => ({ x: v.x, y: v.y, r: UNITS[v.kind].sight })),
        ...s.buildings.filter(b => b.hp > 0 && b.owner === o).map(b => ({ ...buildingCentre(b), r: BUILDINGS[b.kind].sight + Math.max(BUILDINGS[b.kind].w, BUILDINGS[b.kind].h) / 2 })),
      ];
      const seen = (u: { x: number; y: number }) => watchers.some(w => Math.abs(w.x - u.x) <= w.r && Math.abs(w.y - u.y) <= w.r && dist(w.x, w.y, u.x, u.y) <= w.r);
      for (const u of s.units) {
        if (u.owner !== 0 || u.hp <= 0 || !seen(u)) continue;
        let n = 0;
        for (const v of s.units) if (v.owner === 0 && v.hp > 0 && Math.abs(v.x - u.x) <= r && Math.abs(v.y - u.y) <= r && dist(v.x, v.y, u.x, u.y) <= r) n++;
        if (n > bestN) {
          bestN = n;
          at = { x: u.x, y: u.y };
        }
      }
      if (!at) {
        const home = baseCentre(s, o);
        let bestD = Infinity;
        for (const b of s.buildings) {
          if (b.owner !== 0 || b.hp <= 0 || !isStructure(b)) continue;
          const d = distToBuilding(home.x, home.y, b);
          if (d < bestD) {
            bestD = d;
            at = buildingCentre(b);
          }
        }
      }
      if (at && powerProblem(s, o, 'barrage', at.x, at.y) === null) doPower(s, o, 'barrage', at.x, at.y);
    }
  }
}

const satisfied = (o: ObjectiveRuntime) => o.done || (o.spec.kind === 'keepAlive' && !o.failed);

/**
 * Once a tick: objectives, triggers, then victory or defeat. In a mission this replaces the
 * skirmish rule, so a mission with no base is not lost merely for having no structures.
 */
export function evaluateMission(s: GameState): void {
  const m = s.mission;
  if (!m || m.result) return;
  for (const o of m.objectives) evalObjective(s, o);
  for (const o of m.bonus) evalObjective(s, o);
  if (m.structurePowers) {
    syncStructurePowers(s);
    missionStrikes(s);
  }

  let spawned = false;
  if (m.triggers)
    m.triggers.forEach((t, i) => {
      if (m.fired.includes(i)) return;
      const due = 'at' in t ? s.tick >= t.at : !!m.objectives[t.afterObjective]?.done;
      if (!due) return;
      m.fired.push(i);
      if (t.spawn) {
        spawnGroup(s, t.spawn);
        if (t.spawn.owner !== 0) spawned = true;
      }
      if (t.say) log(s, t.say, 'info');
    });
  // A group a trigger has just sent reopens "destroy everything": in Borrowed Steel, capturing the
  // factory last finished it on the same tick, and the counter-attack spawned into a won battle.
  if (spawned)
    for (const o of [...m.objectives, ...m.bonus])
      if (o.spec.kind === 'destroyAll' && o.done) {
        o.done = false;
        evalObjective(s, o);
      }

  const failed = m.objectives.find(o => o.failed);
  let lost: string | null = null;
  if (failed)
    lost =
      failed.spec.kind === 'keepAlive'
        ? `${UNITS[failed.spec.hero].name} fell.`
        : failed.spec.kind === 'escort'
          ? 'Too much of the convoy was lost.'
          : failed.spec.kind === 'destroyWithin'
            ? `${failed.label}: time ran out.`
            : failed.spec.kind === 'capture' || failed.spec.kind === 'infiltrate'
              ? `The enemy ${BUILDINGS[failed.spec.building].name} was destroyed before it could be ${failed.spec.kind === 'capture' ? 'captured' : 'infiltrated'}.`
            : `${failed.label}: failed.`;
  const won = !lost && m.objectives.some(o => o.spec.kind !== 'keepAlive') && m.objectives.every(satisfied);
  if (!won && !lost) {
    if (m.timeLimit !== null && s.tick >= m.timeLimit) lost = 'Time ran out.';
    else if (!s.buildings.some(b => b.owner === 0) && !s.units.some(u => u.owner === 0)) lost = 'All our forces were lost.';
  }
  if (won) {
    for (const o of [...m.objectives, ...m.bonus])
      if (o.spec.kind === 'keepAlive' && !o.failed) {
        o.done = true;
        o.progress = 1;
      }
    m.result = 'won';
    s.winner = 0;
    log(s, 'Mission accomplished.', 'good');
  } else if (lost) {
    m.result = 'lost';
    m.lostBecause = lost;
    s.winner = 1;
    log(s, `Mission failed. ${lost}`, 'bad');
  }
}
