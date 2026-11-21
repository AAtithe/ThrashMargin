import { runAi } from './ai';
// round6:B. Heroes in free play: the hero tick in a skirmish with heroes on.
import { enlistHeroes, heroesInPlay } from './heroes';
import { spreadOre } from './maps';
import {
  dist,
  distToTarget,
  dockTile,
  findPath,
  nearestPassable,
  occupancy,
  passable,
  targetPoint,
  tileOf,
  type Target,
  doorTile,
  frontDir,
} from './grid';
import { next } from './rng';
import {
  BUILDINGS,
  DAMAGE_VS,
  DIFFICULTIES,
  FLIGHT_TICKS,
  HARVEST_PER_SCOOP,
  ORE_REGROW_AMOUNT,
  ORE_REGROW_TICKS,
  ORE_SPREAD_TICKS,
  exploreTicksFor,
  pathBudgetFor,
  ORE_TILE_MAX,
  REPAIR_COST_SHARE,
  SCOOP_TICKS,
  UNITS,
  UNLOAD_PER_TICK,
  VET_DAMAGE,
  VET_NAMES,
  VET_RELOAD,
  VET_REPAIR_SHARE,
  VET_REPAIR_TICKS,
  vetFor,
  CHARGE_HQ_SHARE,
  ENGINEER_REPAIR_PER_TICK,
  ENGINEER_REPAIR_RANGE,
  CAPTURE_TICKS,
  HERO_ABILITY,
  OVERDRIVE_RELOAD,
  OVERDRIVE_SPEED,
  MEDIC_HEAL,
  MEDIC_HEAL_TICKS,
  MEDIC_RANGE,
  MEDIC_SEEK,
  REPAIR_BAY_HP,
  REPAIR_BAY_RANGE,
  REPAIR_BAY_TICKS,
  SALVAGE_SHARE,
  SELF_REPAIR_TICKS,
  hitsAir,
  hitsGround,
  hitsNaval,
  type Category,
  type BuildingKind,
  type Owner,
  type UnitKind,
  type Weapon,
} from './rules';
import { canHit, isAir, launchAircraft, updateAircraft, type AirHooks } from './air';
import {
  antiAirTakenMulOf,
  buildRateOf,
  damageMulOf,
  damageTakenMul,
  fieldRepairOf,
  incomeMulOf,
  infantrySpeedOf,
  kindDamageMulOf,
  reloadMulOf,
  researchStep,
  salvageOf,
  splashMulOf,
  upgradeNewUnit,
  vehicleSpeedOf,
} from './research';
import { cargoMaxOf, fitModules, moduleSpeedOf, weaponOf } from './loadout';
import { spawnSurvivors } from './commands';
import { menderStep } from './engineering';
import {
  completeCapture,
  evaluateMission,
  gainHeroXp,
  heroDamageMul,
  isDetected,
  killXp,
  noteDestroyed,
  noteFallen,
} from './mission';
import {
  addUnit,
  alarm,
  buildTicksFor,
  isStructure,
  log,
  maxHpOf,
  powerOf,
  producerFor,
  productionLines,
  sabotaged,
  syncSkirmishPowers,
  updateExplored,
} from './state';
import { computerSides, enemiesOf, isAlly, isEnemy, sidesOf, teamOf } from './sides';
import type { Building, GameState, Projectile, QueueItem, Unit } from './types';
// round5:D. Neutral sites and tier three (fireline-round5-design.md, workstream D).
import { seenBy, sitesStep } from './sites';
// Round 6 groundwork: per-side specs and perks (fireline-round6-design.md).
import { buildingSpec, buildingSpecOf, perksFor, unitSpec, unitSpecOf } from './specs';
// round6:C. Generals (fireline-round6-design.md, workstream C).
import { auraWeapon, generalsStep, inAura } from './generals';
import { lostAboard, transportStep } from './transport';
import { canReach, isShip, launchTile, navalStep } from './naval';

/** A ship after something on land, or anything on land after a ship (aircraft aside): the naval war's give-up rules apply. */
function crossDomain(u: Unit, t: Target): boolean {
  if (t.unit && isAir(t.unit)) return false;
  return isShip(u) !== !!(t.unit && isShip(t.unit));
}


/**
 * One tick of the battle, applied in place to a state the caller has already cloned.
 *
 * Order within a tick: production, the computer's decisions, every unit, every structure, shells
 * landing, units nudged apart, the dead removed, ore regrowth, fog, victory. Units are processed in
 * id order, always, so a replay makes the same choices.
 */

interface Ctx {
  occ: Int32Array;
  units: Map<number, Unit>;
  buildings: Map<number, Building>;
  /** Path searches still allowed this tick. Spreads the cost of a big group order over ticks. */
  pathBudget: number;
  /** Per side: true while its power is short. */
  power: boolean[];
  /** Dock pads and factory doors, which idle units step off. */
  keepClear: Set<number>;
  /** Per side: its vehicles' speed multiplier (Engine tuning), 1 without. */
  vehicleSpeed: number[];
  /** Per side: its infantry's speed multiplier (Motorised infantry), 1 without. */
  infantrySpeed: number[];
  /** What the aircraft borrow from here (air.ts). */
  air: AirHooks;
}

const CATEGORIES: Category[] = ['building', 'infantry', 'vehicle', 'air', 'naval'];

export function step(s: GameState): void {
  if (s.winner !== null) return;
  s.tick++;
  const ctx: Ctx = {
    occ: occupancy(s),
    units: new Map(s.units.map(u => [u.id, u])),
    buildings: new Map(s.buildings.map(b => [b.id, b])),
    pathBudget: pathBudgetFor(s.setup?.size ?? 'standard'),
    power: sidesOf(s).map(o => powerOf(s, o).low),
    keepClear: new Set(),
    vehicleSpeed: sidesOf(s).map(o => vehicleSpeedOf(s, o)),
    infantrySpeed: sidesOf(s).map(o => infantrySpeedOf(s, o)),
    air: null as unknown as AirHooks,
  };
  ctx.air = {
    lookup: id => lookup(ctx, id),
    acquire: (owner, x, y, range, w) => acquire(s, owner, x, y, range, false, w),
    fire: (owner, sx, sy, w, t, shooter, mul) => fire(s, owner, sx, sy, w, t, shooter, mul),
    nextOrder,
  };

  campaignTimers(s);
  production(s, ctx);

  // Each computer side decides every `period` ticks: side 1 on the period, sides 2 and 3 a quarter
  // and three quarters of the way through it, and side 0 (the harness's autopilot) half way.
  const d = DIFFICULTIES[s.difficulty];
  for (const o of computerSides(s)) if (s.tick % d.period === (o === 1 ? 0 : Math.floor((d.period * (o === 2 ? 1 : 3)) / 4))) runAi(s, o);
  if (s.autopilot && s.tick % DIFFICULTIES[s.autopilotDifficulty ?? s.difficulty].period === Math.floor(DIFFICULTIES[s.autopilotDifficulty ?? s.difficulty].period / 2)) runAi(s, 0);
  // The AI may have placed a structure or ordered units; refresh what it could have changed.
  ctx.occ = occupancy(s);
  ctx.buildings = new Map(s.buildings.map(b => [b.id, b]));
  ctx.units = new Map(s.units.map(u => [u.id, u]));
  const MAP_W = s.mapW;
  for (const b of s.buildings) {
    if (b.kind === 'refinery') {
      const d = dockTile(s, b);
      ctx.keepClear.add(d.x + d.y * MAP_W);
    } else if (b.kind === 'barracks' || b.kind === 'factory') {
      const door = doorTile(s, b);
      ctx.keepClear.add(door.x + door.y * MAP_W);
    }
  }

  // round6:C begin. Generals (fireline-round6-design.md): the command aura scan, one call under this line.
  generalsStep(s);
  // round6:C end.
  for (const u of s.units) if (u.hp > 0) updateUnit(s, ctx, u);
  // The air war: infantry climbing into Troop Carriers, and carriers setting them down.
  transportStep(s);
  // The naval war: Naval Yards mending the ships beside them.
  navalStep(s);
  // round6:B begin. Heroes in free play: the hero tick also runs in a skirmish with setup.heroes
  // (this condition may widen; nothing else here changes). A mission and a planet battle run it as
  // main built them; a planet battle states heroes: false, so it never enlists.
  if (s.mission || s.planet) heroes(s, ctx);
  else if (heroesInPlay(s)) {
    enlistHeroes(s);
    heroes(s, ctx);
  }
  // round6:B end.
  for (const b of s.buildings) if (b.hp > 0) updateBuilding(s, ctx, b);
  // round5:D begin. Neutral sites (fireline-round5-design.md): one call into sites.ts (capture,
  // derrick income, hospital healing), under this line. A no-op without s.sites.
  sitesStep(s);
  // round5:D end.
  charges(s);
  landProjectiles(s, ctx);
  separate(s, ctx);
  removeDead(s);
  // Skirmish powers go with the last of their structures, at once.
  syncSkirmishPowers(s);

  if (s.tick % ORE_REGROW_TICKS === 0) {
    for (let k = 0; k < s.ore.length; k++) {
      const o = s.ore[k];
      if (o > 0 && o < ORE_TILE_MAX) s.ore[k] = Math.min(ORE_TILE_MAX, o + ORE_REGROW_AMOUNT);
    }
  }
  // Round 5: on large and huge maps a worked-out field spreads back from its edges (rules.ts).
  if (s.tick % ORE_SPREAD_TICKS === 0 && (s.setup?.size ?? 'standard') !== 'standard') spreadOre(s, ctx.occ);
  if (s.tick % exploreTicksFor(s.setup?.size ?? 'standard') === 0) updateExplored(s);
  if (s.effects.length && s.effects[0].at < s.tick - 40) s.effects = s.effects.filter(e => e.at >= s.tick - 40);

  // A mission is decided by its objectives; a skirmish by who still has structures.
  if (s.mission) evaluateMission(s);
  else checkVictory(s);
}

// ---------------------------------------------------------------------------------------------
// Campaign: cooldowns, recon sweeps, heroes and demolition charges

function campaignTimers(s: GameState): void {
  if (s.powers) {
    for (const side of s.powers) {
      for (const k of Object.keys(side) as (keyof typeof side)[]) {
        const v = side[k]!;
        if (v > 0) side[k] = v - 1;
      }
    }
  }
  if (s.recon && s.recon.length && s.recon.some(r => r[3] <= s.tick)) s.recon = s.recon.filter(r => r[3] > s.tick);
}

const overdrive = (u: Unit) => u.hero?.active?.kind === 'overdrive';

function heroes(s: GameState, ctx: Ctx): void {
  for (const u of s.units) {
    const h = u.hero;
    if (!h || u.hp <= 0) continue;
    if (h.abilityCd > 0) h.abilityCd--;
    const a = h.active;
    if (a?.kind === 'overdrive' && s.tick >= a.until) delete h.active;
    else if (a?.kind === 'capture') {
      const b = ctx.buildings.get(a.target);
      const moved = u.order.type !== 'idle' || u.path.length > 0;
      if (!b || b.hp <= 0 || isAlly(s, b.owner, u.owner) || moved || distToTarget(u.x, u.y, { building: b }) > HERO_ABILITY.engineer.range + 0.6) {
        delete h.active;
        if (u.owner === 0) log(s, 'Capture interrupted.', 'bad');
      } else {
        const n = Math.round(a.progress * CAPTURE_TICKS) + 1;
        a.progress = Math.min(1, n / CAPTURE_TICKS);
        if (n >= CAPTURE_TICKS) completeCapture(s, u, b);
      }
    }
    // The Engineer patches up friendly vehicles beside him.
    if (u.kind === 'engineer') {
      for (const v of s.units) {
        if (v.owner !== u.owner || v.hp <= 0 || UNITS[v.kind].category !== 'vehicle') continue;
        const max = maxHpOf(v);
        if (v.hp >= max || dist(u.x, u.y, v.x, v.y) > ENGINEER_REPAIR_RANGE) continue;
        v.hp = Math.min(max, v.hp + ENGINEER_REPAIR_PER_TICK);
      }
    }
  }
}

/** Demolition charges whose fuse has run out. */
function charges(s: GameState): void {
  for (const b of s.buildings) {
    if (b.chargeAt === undefined || b.hp <= 0 || s.tick < b.chargeAt) continue;
    const by = b.chargedBy ?? 0;
    delete b.chargeAt;
    delete b.chargedBy;
    const spec = buildingSpecOf(s, b);
    const damage = b.kind === 'hq' ? Math.round(spec.hp * CHARGE_HQ_SHARE) : b.hp;
    b.hp -= damage;
    s.effects.push({ id: s.nextId++, kind: 'boom', x: b.x + spec.w / 2, y: b.y + spec.h / 2, at: s.tick, size: 2 });
    const commando = s.units.find(v => v.id === by);
    if (b.hp <= 0) {
      b.hp = 0;
      // The Commando's side takes the kill; if he has fallen since, the first enemy of the owner.
      const side: Owner = commando && isEnemy(s, commando.owner, b.owner) ? commando.owner : (enemiesOf(s, b.owner)[0] ?? b.owner);
      credit(s, side, b.owner, commando && commando.owner === side ? commando : undefined, { building: b });
    } else if (b.owner === 0) alarm(s, 'base', 'Our base is under attack.', 300);
  }
}

/** A kill: the sides' tallies, and the killer's rank and (for a hero) experience. */
function credit(s: GameState, by: Owner, victimOwner: Owner, killer: Unit | undefined, t: Target): void {
  s.players[by].stats.killed++;
  s.players[victimOwner].stats.lost++;
  // Salvage crews (development lines): paid for every enemy vehicle or aircraft destroyed.
  if (t.unit && salvageOf(s, by)) {
    const cat = UNITS[t.unit.kind].category;
    if (cat === 'vehicle' || cat === 'air') s.players[by].credits += Math.floor(SALVAGE_SHARE * unitSpecOf(s, t.unit).cost);
  }
  if (!killer) return;
  killer.kills++;
  const rank = vetFor(killer.kills);
  if (rank > killer.vet) {
    killer.vet = rank;
    if (killer.owner === 0) log(s, `${unitSpecOf(s, killer).name} promoted to ${VET_NAMES[rank]}.`, 'good');
  }
  if (killer.hero) gainHeroXp(s, killer, t.building ? killXp(t.building, true) : killXp(t.unit!, false));
}

// ---------------------------------------------------------------------------------------------
// Production

function production(s: GameState, ctx: Ctx): void {
  for (const owner of sidesOf(s)) {
    const p = s.players[owner];
    const perks = perksFor(s, owner);
    // round6:C begin. Generals: a doctrine's build speed on some kinds alone (Hale's turrets) may refine this.
    const perk = perks ? perks.buildSpeedMul : 1;
    // round6:C end.
    const rate = (ctx.power[owner] ? 0.5 : 1) * perk;
    if (p.research) researchStep(s, owner, ctx.power[owner]);
    for (const cat of CATEGORIES) {
      // Units: one line per producer, each working its own item (productionLines, state.ts).
      if (cat !== 'building') {
        const q = p.queues[cat];
        if (!q?.length) continue;
        const lines = productionLines(s, owner, cat);
        if (!lines.length) continue;
        const assembly = buildRateOf(s, owner, cat);
        // The items on the lines this tick, taken before any comes out (the next starts next tick).
        const active = q.slice(0, lines.length);
        active.forEach((item, i) => {
          const producer = lines[i];
          const total = buildTicksFor(s, owner, item.kind);
          if (item.progress >= total) {
            spawnFromQueue(s, ctx, owner, cat, item, producer);
            return;
          }
          if (sabotaged(s, producer)) return;
          item.progress = Math.min(total, item.progress + (assembly !== 1 ? rate * assembly : rate));
          if (item.progress >= total) spawnFromQueue(s, ctx, owner, cat, item, producer);
        });
        continue;
      }
      // A mission's players have no air queue.
      const head = p.queues[cat]?.[0];
      if (!head) continue;
      const total = buildTicksFor(s, owner, head.kind);
      // Structures: one at a time, finished and waiting to be placed.
      if (head.progress >= total) continue;
      const producer = producerFor(s, owner, cat);
      if (!producer || sabotaged(s, producer)) continue;
      // Assembly lines (development lines): every queue but the building one.
      const assembly = buildRateOf(s, owner, cat);
      head.progress = Math.min(total, head.progress + (assembly !== 1 ? rate * assembly : rate));
      if (head.progress >= total && owner === 0) log(s, `${nameOf(s, owner, head.kind)} ready. Choose where to place it.`, 'good');
    }
  }
}

const nameOf = (s: GameState, owner: Owner, kind: BuildingKind | UnitKind): string =>
  kind in UNITS ? unitSpec(s, owner, kind as UnitKind).name : buildingSpec(s, owner, kind as BuildingKind).name;

/** Takes a finished item off its queue (wherever it stands in it now). */
function takeItem(s: GameState, owner: Owner, cat: Category, item: QueueItem): QueueItem {
  const q = s.players[owner].queues[cat];
  q.splice(q.indexOf(item), 1);
  return item;
}

/** A finished item comes out of the structure whose line built it. */
function spawnFromQueue(s: GameState, ctx: Ctx, owner: Owner, cat: Category, item: QueueItem, producer: Building): void {
  if (cat === 'air') {
    // Aircraft lift off the Helipad itself: no door, no ground to clear.
    const head = takeItem(s, owner, cat, item);
    const a = addUnit(s, owner, head.kind as UnitKind, producer.x + 1, producer.y + 1);
    launchAircraft(s, a, producer);
    upgradeNewUnit(s, a);
    ctx.units.set(a.id, a);
    s.players[owner].stats.trained++;
    if (producer.rally) a.order = { type: 'move', x: producer.rally.x, y: producer.rally.y };
    if (owner === 0) log(s, `${unitSpecOf(s, a).name} ready.`);
    return;
  }
  // Ships come out on the open water nearest the Naval Yard; everything else at the door.
  const door = doorTile(s, producer);
  const ex = door.x + 0.5;
  const ey = door.y + 0.5;
  const k = cat === 'naval' ? launchTile(s, ctx.occ, producer) : nearestPassable(s, ctx.occ, ex, ey, 5);
  if (k < 0) return; // Exit blocked: stays finished on its line and tries next tick.
  const head = takeItem(s, owner, cat, item);
  const kind = head.kind as UnitKind;
  const MAP_W = s.mapW;
  const u = addUnit(s, owner, kind, (k % MAP_W) + 0.5, ((k / MAP_W) | 0) + 0.5);
  u.fx = 0;
  u.fy = frontDir(s, owner);
  upgradeNewUnit(s, u);
  fitModules(u, head.modules);
  ctx.units.set(u.id, u);
  s.players[owner].stats.trained++;
  if (kind === 'hauler') {
    u.order = { type: 'harvest', phase: 'seek', tile: -1, refinery: 0 };
  } else if (producer.rally) {
    u.order = { type: 'move', x: producer.rally.x, y: producer.rally.y };
  } else {
    // Step clear of the door.
    u.order = { type: 'move', x: u.x, y: Math.max(0.5, Math.min(u.y + 1.5 * frontDir(s, owner), s.mapH - 0.5)) };
  }
  if (owner === 0) log(s, `${unitSpec(s, owner, kind).name} ready.`);
}

// ---------------------------------------------------------------------------------------------
// Movement

// round6:D. Formations and squads: keep pace (fireline-round6-design.md).
import { squadPace } from './formations';

function stepAlong(s: GameState, ctx: Ctx, u: Unit, tx: number, ty: number, popOnArrive: boolean): boolean {
  const speed = unitSpecOf(s, u).speed;
  let sp = overdrive(u) ? speed * OVERDRIVE_SPEED : speed;
  // Engine tuning (research): vehicles only.
  const tuned = ctx.vehicleSpeed[u.owner];
  if (tuned !== 1 && UNITS[u.kind].category === 'vehicle') sp *= tuned;
  // Motorised infantry (research) and the Extra fuel tank (a module).
  const marched = ctx.infantrySpeed[u.owner];
  if (marched !== 1 && UNITS[u.kind].category === 'infantry') sp *= marched;
  if (u.modules) {
    const fuel = moduleSpeedOf(u);
    if (fuel !== 1) sp *= fuel;
  }
  // round6:D begin. Formations and squads: a squad member's speed capped at its squad's slowest
  // (one lookup; no pathing change). After every other speed, so the cap is the last word; the
  // squad's pace counts the same research and modules (formations.ts, paceOf). Nothing else in
  // stepAlong changes.
  if (u.squad !== undefined) sp = squadPace(s, ctx.units, ctx.occ, u, sp, tuned);
  // round6:D end.
  // Ships keep to open water (the naval layer); everything else to land.
  const sea = isShip(u);
  const dx = tx - u.x;
  const dy = ty - u.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  let nx: number;
  let ny: number;
  let arrived = false;
  if (d <= sp) {
    nx = tx;
    ny = ty;
    arrived = true;
  } else {
    nx = u.x + (dx / d) * sp;
    ny = u.y + (dy / d) * sp;
  }
  // Look a little further than one step as well: a unit creeping toward a tile that has been
  // blocked since its path was planned would otherwise keep taking clean steps inside its own tile
  // and never notice.
  const look = Math.min(d, Math.max(sp, 0.45));
  const lx = d > 0.0001 ? u.x + (dx / d) * look : nx;
  const ly = d > 0.0001 ? u.y + (dy / d) * look : ny;
  if (!passable(s, ctx.occ, Math.floor(nx), Math.floor(ny), sea) || !passable(s, ctx.occ, Math.floor(lx), Math.floor(ly), sea)) {
    // Paths are smoothed between tile centres, so a unit standing off-centre can clip the corner
    // of a blocked tile on a straight run. Slide along whichever axis is open; failing that, step
    // back toward the centre of the tile it stands on, from where the smoothed line is clear.
    // Without this a hauler could re-path to the same line forever and never move. The stuck
    // count still rises while it slides, so a path that a new structure has cut is re-planned:
    // only a clean step along the path clears it.
    const cx = Math.floor(u.x) + 0.5;
    const cy = Math.floor(u.y) + 0.5;
    const minSlide = sp * 0.25;
    if (Math.abs(nx - u.x) >= minSlide && passable(s, ctx.occ, Math.floor(nx), Math.floor(u.y), sea)) u.x = nx;
    else if (Math.abs(ny - u.y) >= minSlide && passable(s, ctx.occ, Math.floor(u.x), Math.floor(ny), sea)) u.y = ny;
    else {
      const cd = dist(u.x, u.y, cx, cy);
      if (cd > 0.01) {
        const m = Math.min(sp, cd);
        u.x += ((cx - u.x) / cd) * m;
        u.y += ((cy - u.y) / cd) * m;
      }
    }
    u.stuck++;
    if (u.stuck > 8) {
      u.path = [];
      u.pathGoal = -1;
      u.stuck = 0;
    }
    return false;
  }
  u.x = nx;
  u.y = ny;
  u.stuck = 0;
  if (d > 0.0001) {
    u.fx = dx / d;
    u.fy = dy / d;
  }
  if (arrived && popOnArrive) u.path.shift();
  return arrived;
}

/**
 * Moves a unit toward (gx, gy). Returns true once it has arrived, or once it has got as close as
 * the ground allows. Paths are computed lazily and re-computed when the goal moves.
 */
function travel(s: GameState, ctx: Ctx, u: Unit, gx: number, gy: number): boolean {
  const sea = isShip(u);
  // A ship sent inland goes to the nearest water within reach of the point.
  const goal = nearestPassable(s, ctx.occ, gx, gy, sea ? 10 : 6, sea);
  if (goal < 0) return true;
  const MAP_W = s.mapW;
  const here = tileOf(s, u);
  if (here === goal && u.path.length === 0) {
    // Last stretch inside the goal tile: walk straight to the point if it is in this tile.
    const inTile = Math.floor(gx) + Math.floor(gy) * MAP_W === goal;
    const px = inTile ? gx : (goal % MAP_W) + 0.5;
    const py = inTile ? gy : ((goal / MAP_W) | 0) + 0.5;
    if (dist(u.x, u.y, px, py) < 0.05) return true;
    stepAlong(s, ctx, u, px, py, false);
    return dist(u.x, u.y, px, py) < 0.05;
  }
  const goalMoved = u.pathGoal !== goal;
  if (goalMoved && (u.pathGoal === -1 || s.tick - u.pathTick >= 6 || u.path.length === 0)) {
    if (ctx.pathBudget <= 0) return false;
    ctx.pathBudget--;
    u.path = findPath(s, ctx.occ, here, goal, sea);
    u.pathGoal = goal;
    u.pathTick = s.tick;
    if (!u.path.length) return true;
  }
  if (!u.path.length) return true; // A partial path has run out: as close as we can get.
  const k = u.path[0];
  stepAlong(s, ctx, u, (k % MAP_W) + 0.5, ((k / MAP_W) | 0) + 0.5, true);
  return false;
}

function halt(u: Unit): void {
  u.path = [];
  u.pathGoal = -1;
}

/** The current order is done (arrived, or its target is gone): start the next queued one, or idle. */
function nextOrder(u: Unit): void {
  const q = u.queue.length ? u.queue[0] : null;
  if (q) {
    u.queue = u.queue.slice(1);
    u.order = { ...q };
    u.engage = q.type === 'attack' ? q.target : 0;
  } else {
    u.order = { type: 'idle' };
    u.engage = 0;
  }
  halt(u);
}

// ---------------------------------------------------------------------------------------------
// Targets

function lookup(ctx: Ctx, id: number): Target | null {
  const u = ctx.units.get(id);
  if (u && u.hp > 0) return { unit: u };
  const b = ctx.buildings.get(id);
  if (b && b.hp > 0) return { building: b };
  return null;
}

/**
 * Enemy structures side 0's units never pick for themselves: the kinds an unfinished primary capture or
 * infiltrate objective names. Attack-moving through Orlen Yard in Borrowed Steel shot the War Factory down
 * before the Engineer reached it, and with the factory gone the mission could never be won. An
 * explicit attack order on one still goes through.
 */
function sparedKinds(s: GameState): BuildingKind[] | null {
  const m = s.mission;
  if (!m) return null;
  let out: BuildingKind[] | null = null;
  for (const o of m.objectives) if ((o.spec.kind === 'capture' || o.spec.kind === 'infiltrate') && !o.done && !o.failed) (out ??= []).push(o.spec.building);
  return out;
}

/**
 * Nearest enemy within range, preferring things that shoot back over things that do not. Only what
 * the weapon can reach: aircraft when it hits the air (hitsAir), the ground when it hits the ground.
 */
function acquire(s: GameState, owner: Owner, x: number, y: number, range: number, unitsOnly: boolean, w: Weapon): number {
  const team = teamOf(s, owner);
  const air = hitsAir(w);
  const ground = hitsGround(w);
  const naval = hitsNaval(w);
  let best = 0;
  let bestScore = Infinity;
  for (const e of s.units) {
    if (e.hp <= 0 || teamOf(s, e.owner) === team) continue;
    const cat = UNITS[e.kind].category;
    if (cat === 'air' ? !air : cat === 'naval' ? !naval : !ground) continue;
    const d = dist(x, y, e.x, e.y);
    if (d > range) continue;
    // A Spy nobody has spotted is never picked as a target.
    if ((e.kind === 'spy' || UNITS[e.kind].stealth) && !seenBy(s, e, owner)) continue;
    const score = d + (unitSpecOf(s, e).weapon ? 0 : 1.5);
    if (score < bestScore) {
      bestScore = score;
      best = e.id;
    }
  }
  if (unitsOnly || !ground) return best;
  const spare = owner === 0 ? sparedKinds(s) : null;
  for (const b of s.buildings) {
    if (b.hp <= 0 || teamOf(s, b.owner) === team) continue;
    if (spare && spare.includes(b.kind)) continue;
    const d = distToTarget(x, y, { building: b });
    if (d > range) continue;
    const score = d + (buildingSpecOf(s, b).weapon ? 0.5 : 3);
    if (score < bestScore) {
      bestScore = score;
      best = b.id;
    }
  }
  return best;
}

function fire(s: GameState, owner: Owner, sx: number, sy: number, w: Weapon, t: Target, shooter: number, damageMul = 1): void {
  // Weapon calibration (research): every weapon of the side.
  const calibrated = damageMulOf(s, owner);
  if (calibrated !== 1) damageMul *= calibrated;
  // HEAT rounds (development lines): shells and rockets.
  const heat = kindDamageMulOf(s, owner, w.kind);
  if (heat !== 1) damageMul *= heat;
  const tp = targetPoint(t);
  let toX = tp.x;
  let toY = tp.y;
  let flight = FLIGHT_TICKS[w.kind];
  if (w.kind === 'artillery') {
    const d = dist(sx, sy, toX, toY);
    flight += Math.round(d * 0.5);
    // Shells scatter a little, and land where the target was, not where it has gone.
    const a = next(s.rngSeed);
    const b = next(a.seed);
    s.rngSeed = b.seed;
    toX += (a.value - 0.5) * 0.9;
    toY += (b.value - 0.5) * 0.9;
  }
  s.effects.push({ id: s.nextId++, kind: 'muzzle', x: sx, y: sy, x2: toX, y2: toY, at: s.tick, size: 0, weapon: w.kind });
  const p: Projectile = {
    id: s.nextId++,
    owner,
    weapon: w.kind,
    fromX: sx,
    fromY: sy,
    toX,
    toY,
    firedAt: s.tick,
    hitAt: s.tick + flight,
    target: t.unit ? t.unit.id : t.building!.id,
    damage: damageMul === 1 ? w.damage : w.damage * damageMul,
    splash: splashOf(s, owner, w),
    shooter,
  };
  if (flight === 0) hit(s, p, shooter);
  else s.projectiles.push(p);
}

/** A weapon's splash radius as this side fires it (High-explosive fill widens it). */
function splashOf(s: GameState, owner: Owner, w: Weapon): number {
  const r = w.splash ?? 0;
  if (!r) return r;
  const he = splashMulOf(s, owner);
  return he !== 1 ? r * he : r;
}

function hit(s: GameState, p: Projectile, shooter = 0): void {
  if (p.splash > 0) {
    // Splash spares the firing side and its allies. Anti-air splash reaches only aircraft; every
    // other splash (bombs included) only the ground.
    const team = teamOf(s, p.owner);
    const antiAir = p.weapon === 'flak' || p.weapon === 'aamissile';
    for (const u of s.units) {
      if (u.hp <= 0 || teamOf(s, u.owner) === team) continue;
      if ((UNITS[u.kind].category === 'air') !== antiAir) continue;
      const d = dist(p.toX, p.toY, u.x, u.y);
      if (d > p.splash) continue;
      hurt(s, { unit: u }, p.damage * (1 - (0.5 * d) / p.splash), p, shooter);
    }
    for (const b of s.buildings) {
      if (antiAir) break;
      if (b.hp <= 0 || teamOf(s, b.owner) === team) continue;
      const d = distToTarget(p.toX, p.toY, { building: b });
      if (d > p.splash) continue;
      hurt(s, { building: b }, p.damage * (1 - (0.5 * d) / p.splash), p, shooter);
    }
  } else {
    const u = s.units.find(v => v.id === p.target && v.hp > 0);
    const b = u ? undefined : s.buildings.find(v => v.id === p.target && v.hp > 0);
    // Only bullets and anti-air reach an aircraft; anti-air reaches nothing else.
    const airShot = p.weapon === 'flak' || p.weapon === 'aamissile';
    const torpedo = p.weapon === 'torpedo';
    const cat = u ? UNITS[u.kind].category : null;
    if (u && (cat === 'air' ? !airShot && p.weapon !== 'bullet' : cat === 'naval' ? airShot : airShot || torpedo)) {
      // Missed: it cannot touch that (a torpedo touches ships alone).
    } else if (b && (airShot || torpedo)) {
      // Nor a structure.
    } else if (u) hurt(s, { unit: u }, p.damage, p, shooter);
    else if (b) hurt(s, { building: b }, p.damage, p, shooter);
  }
  if (p.weapon === 'bomb') s.effects.push({ id: s.nextId++, kind: 'bomb', x: p.toX, y: p.toY, at: s.tick, size: p.splash, weapon: p.weapon });
  else if (p.weapon !== 'bullet')
    s.effects.push({ id: s.nextId++, kind: 'boom', x: p.toX, y: p.toY, at: s.tick, size: p.weapon === 'missile' ? 2 : 0, weapon: p.weapon });
}

function hurt(s: GameState, t: Target, raw: number, p: Projectile, shooter: number): void {
  const armor = t.unit ? unitSpecOf(s, t.unit).armor : 'building';
  // Armour forks, armoured cockpits and smoke (development lines).
  if (t.unit) {
    const taken = damageTakenMul(s, t.unit, p.weapon);
    if (taken !== 1) raw *= taken;
  }
  // Countermeasures (research): anti-air does less to the side's aircraft.
  if (armor === 'aircraft' && (p.weapon === 'flak' || p.weapon === 'aamissile')) raw *= antiAirTakenMulOf(s, t.unit!.owner);
  const amount = Math.max(1, Math.round(raw * DAMAGE_VS[p.weapon][armor]));
  const victim = t.unit ?? t.building!;
  if (victim.hp <= 0) return;
  victim.hp -= amount;
  if (t.building) {
    const mem = s.ai[victim.owner];
    mem.hurtTick = s.tick;
    mem.hurtX = t.building.x + 1;
    mem.hurtY = t.building.y + 1;
    if (victim.owner === 0) alarm(s, 'base', 'Our base is under attack.', 300);
  } else if (victim.owner === 0 && t.unit!.kind === 'hauler') {
    alarm(s, 'hauler', 'A hauler is under attack.', 300);
  } else {
    // Units under fire defend themselves: an idle unit turns on its attacker (unless that is a
    // Spy it cannot see, or it is itself a Spy, which never picks fights).
    const vu = t.unit!;
    // Aircraft pick their own targets (air.ts), and nobody turns on what its weapon cannot reach.
    if (vu.order.type === 'idle' && vu.stance !== 'hold' && unitSpecOf(s, vu).weapon && !vu.engage && shooter && vu.kind !== 'spy' && !isAir(vu)) {
      const from = s.units.find(v => v.id === shooter);
      if (from && !canHit(unitSpecOf(s, vu).weapon!, { unit: from })) {
        // Out of its reach: it cannot answer.
      } else if (!from || (from.kind !== 'spy' && !UNITS[from.kind].stealth) || seenBy(s, from, vu.owner)) vu.engage = shooter;
    }
  }
  // An Engineer under fire loses his grip on a capture.
  if (t.unit && t.unit.hero?.active?.kind === 'capture') {
    delete t.unit.hero.active;
    if (t.unit.owner === 0) log(s, 'Capture interrupted.', 'bad');
  }
  if (victim.hp <= 0) {
    victim.hp = 0;
    credit(s, p.owner, victim.owner, s.units.find(v => v.id === shooter), t);
  }
}

// ---------------------------------------------------------------------------------------------
// Units

function updateUnit(s: GameState, ctx: Ctx, u: Unit): void {
  const spec = unitSpecOf(s, u);
  if (spec.category === 'air') {
    updateAircraft(s, u, ctx.air);
    return;
  }
  const w = weaponOf(s, u);
  if (u.cooldown > 0) u.cooldown--;

  if (u.order.type === 'harvest') {
    harvestStep(s, ctx, u);
    return;
  }

  // Elite units patch themselves up between fights.
  const max = u.maxHp ?? spec.hp;
  // Field workshops (development lines) give every vehicle the same repair, never twice.
  if ((u.vet >= 2 || (spec.category === 'vehicle' && fieldRepairOf(s, u.owner))) && !u.engage && u.hp < max && (s.tick + u.id) % VET_REPAIR_TICKS === 0) {
    u.hp = Math.min(max, u.hp + Math.max(1, Math.round(max * VET_REPAIR_SHARE)));
  }
  // The Bastion mends its own armour, slowly, while not fighting.
  if (spec.selfRepair && !u.engage && u.hp < max && (s.tick + u.id) % SELF_REPAIR_TICKS === 0) {
    u.hp = Math.min(max, u.hp + spec.selfRepair);
  }
  if (spec.medic) medic(s, u);
  // round5:C begin. Engineering vehicles (fireline-round5-design.md): one call into engineering.ts
  // for a unit whose spec has `mender`, under this line.
  if (spec.mender) menderStep(s, u);
  // round5:C end.

  const order = u.order;
  if (order.type === 'attack') {
    const t = lookup(ctx, order.target);
    if (!t || (w && !canHit(w, t))) nextOrder(u);
    else u.engage = order.target;
  }
  if (u.order.type === 'move') u.engage = 0;

  const stance = u.stance;
  if (w && u.order.type === 'idle' && stance === 'hold') {
    // Holding fire: an idle unit neither picks targets nor keeps one.
    u.engage = 0;
  } else if (w && (u.order.type === 'idle' || u.order.type === 'attackMove')) {
    let current = u.engage ? lookup(ctx, u.engage) : null;
    // A Spy that has slipped out of sight is dropped as a target.
    if (current?.unit && (current.unit.kind === 'spy' || UNITS[current.unit.kind].stealth) && !seenBy(s, current.unit, u.owner)) current = null;
    if (!current) u.engage = 0;
    // The Spy never picks targets of its own: it fires only when ordered to.
    if (u.kind !== 'spy' && (s.tick + u.id) % 4 === 0 && (!current || u.order.type === 'idle')) {
      const range = u.order.type === 'idle' && stance !== 'aggressive' ? w.range + 0.5 : spec.sight + 1;
      const found = acquire(s, u.owner, u.x, u.y, range, false, w);
      if (found && (!current || u.order.type === 'attackMove')) u.engage = found;
    }
  }

  let firing = false;
  if (u.engage && w) {
    const t = lookup(ctx, u.engage);
    if (!t || !canHit(w, t)) {
      u.engage = 0;
    } else {
      const d = distToTarget(u.x, u.y, t);
      const tp = targetPoint(t);
      if (d <= w.range && d >= (w.minRange ?? 0)) {
        firing = true;
        halt(u);
        aim(u, tp.x, tp.y);
        if (u.cooldown === 0) {
          const vet = u.vet;
          // round6:C begin. Generals: the aura's damage and reload multipliers, applied here beside
          // veterancy's, only when the unit is inside an aura (so every number is unchanged without one).
          // Inside an aura the shot (fire, then the reload below) uses the aura's copy of the weapon:
          // this block-scoped `w` stands for the unit's own weapon for the rest of this block.
          // Since the merge with development lines the unit's own weapon is weaponOf's (a long barrel
          // counts), as main fires it; without a module it is spec.weapon, as before.
          const w = inAura(s, u) ? auraWeapon(weaponOf(s, u)!) : weaponOf(s, u)!;
          // round6:C end.
          fire(s, u.owner, u.x + u.tx * 0.35, u.y + u.ty * 0.35, w, t, u.id, (VET_DAMAGE[vet] ?? 1) * (u.hero ? heroDamageMul(u) : 1));
          u.cooldown = vet ? Math.round(w.cooldown * (VET_RELOAD[vet] ?? 1)) : w.cooldown;
          if (u.hero && overdrive(u)) u.cooldown = Math.max(1, Math.round(u.cooldown * OVERDRIVE_RELOAD));
          // Autoloaders (development lines): ground vehicles.
          const reload = reloadMulOf(s, u);
          if (reload !== 1) u.cooldown = Math.max(1, Math.round(u.cooldown * reload));
        }
      } else if (
        u.order.type === 'attack' ||
        // Aircraft are shot at when they come in range but never chased unless ordered: a ground
        // army on attack-move once followed two fleeing gunships across a river into the enemy
        // base and was lost to its defences.
        ((u.order.type === 'attackMove' || (u.order.type === 'idle' && stance === 'aggressive')) && d <= spec.sight + 3 && !(t.unit && isAir(t.unit)))
      ) {
        firing = true;
        let near = false;
        // The naval war: a ship never chases a land target it could not shoot from any water, nor a
        // soldier a ship it could not shoot from any shore.
        if (crossDomain(u, t) && !canReach(s, ctx.occ, u, t, w.range)) {
          firing = false;
          u.engage = 0;
          if (u.order.type === 'attack') nextOrder(u);
        } else if (d < (w.minRange ?? 0)) {
          // Too close for artillery: back away from the target.
          travel(s, ctx, u, u.x + (u.x - tp.x), u.y + (u.y - tp.y));
        } else near = travel(s, ctx, u, tp.x, tp.y);
        aim(u, tp.x, tp.y);
        // The naval war: a ship as close as the water allows to a target still out of range (or
        // a soldier as close as the shore allows to a ship) gives it up rather than wait forever.
        if (near && d > w.range && (isShip(u) || (t.unit && isShip(t.unit)))) {
          firing = false;
          u.engage = 0;
          if (u.order.type === 'attack') nextOrder(u);
        }
      } else if (u.order.type === 'idle' && d <= spec.sight + 1 && u.engage) {
        // Shot at from out of range while idle: close in, but give up beyond sight (or, the naval
        // war, when it could never get in range from where it can go).
        firing = true;
        const near = crossDomain(u, t) && !canReach(s, ctx.occ, u, t, w.range) ? true : travel(s, ctx, u, tp.x, tp.y);
        aim(u, tp.x, tp.y);
        if (near && d > w.range && (isShip(u) || (t.unit && isShip(t.unit)))) {
          firing = false;
          u.engage = 0;
        }
      } else {
        u.engage = 0;
      }
    }
  }

  if (!firing) {
    const o = u.order;
    if (o.type === 'move' || o.type === 'attackMove') {
      if (travel(s, ctx, u, o.x, o.y)) nextOrder(u);
    }
    // Idle on a dock pad or in a factory door: step aside.
    if (u.order.type === 'idle' && (s.tick + u.id) % 10 === 0 && ctx.keepClear.has(tileOf(s, u))) {
      const k = clearSpot(s, ctx, u.x, u.y);
      if (k >= 0) u.order = { type: 'move', x: (k % s.mapW) + 0.5, y: ((k / s.mapW) | 0) + 0.5 };
    }
    // Turret drifts back to the hull's heading.
    u.tx += (u.fx - u.tx) * 0.2;
    u.ty += (u.fy - u.ty) * 0.2;
    normaliseTurret(u);
  }
}

/**
 * A Medic at work: every MEDIC_HEAL_TICKS the most hurt of its own side's infantry within
 * MEDIC_RANGE (never itself) gets MEDIC_HEAL back. Idle and not holding, it walks to the nearest
 * wounded soldier it can see within MEDIC_SEEK; given an order, it follows the order.
 */
function medic(s: GameState, u: Unit): void {
  if ((s.tick + u.id) % MEDIC_HEAL_TICKS === 0) {
    let best: Unit | null = null;
    let bestShare = 1;
    for (const v of s.units) {
      if (v === u || v.owner !== u.owner || v.hp <= 0 || UNITS[v.kind].category !== 'infantry') continue;
      const max = maxHpOf(v);
      if (v.hp >= max || Math.abs(v.x - u.x) > MEDIC_RANGE || Math.abs(v.y - u.y) > MEDIC_RANGE) continue;
      if (dist(u.x, u.y, v.x, v.y) > MEDIC_RANGE) continue;
      const share = v.hp / max;
      if (share < bestShare) {
        bestShare = share;
        best = v;
      }
    }
    if (best) {
      best.hp = Math.min(maxHpOf(best), best.hp + MEDIC_HEAL);
      s.effects.push({ id: s.nextId++, kind: 'heal', x: best.x, y: best.y, at: s.tick, size: 0 });
    }
  }
  if (u.order.type !== 'idle' || u.stance === 'hold' || (s.tick + u.id) % 10 !== 0) return;
  let target: Unit | null = null;
  let bestD = MEDIC_SEEK;
  for (const v of s.units) {
    if (v === u || v.owner !== u.owner || v.hp <= 0 || UNITS[v.kind].category !== 'infantry' || v.hp >= maxHpOf(v)) continue;
    const d = dist(u.x, u.y, v.x, v.y);
    if (d < bestD) {
      bestD = d;
      target = v;
    }
  }
  // Close enough already: stay put and keep healing.
  if (target && bestD > MEDIC_RANGE * 0.6) u.order = { type: 'move', x: target.x, y: target.y };
}

/** The nearest passable tile that is not a dock or a door, within a few tiles. */
function clearSpot(s: GameState, ctx: Ctx, x: number, y: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  for (let r = 1; r <= 4; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!passable(s, ctx.occ, cx + dx, cy + dy)) continue;
        const k = (cy + dy) * s.mapW + cx + dx;
        if (!ctx.keepClear.has(k)) return k;
      }
  return -1;
}

function aim(o: { x: number; y: number; tx: number; ty: number }, x: number, y: number): void {
  const dx = x - o.x;
  const dy = y - o.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.0001) return;
  o.tx = dx / d;
  o.ty = dy / d;
}

function normaliseTurret(u: Unit): void {
  const d = Math.sqrt(u.tx * u.tx + u.ty * u.ty);
  if (d < 0.0001) {
    u.tx = u.fx;
    u.ty = u.fy;
  } else {
    u.tx /= d;
    u.ty /= d;
  }
}

// ---------------------------------------------------------------------------------------------
// Harvesting

function findOre(s: GameState, u: Unit): number {
  const claimed = new Set<number>();
  for (const v of s.units)
    if (v.id !== u.id && v.owner === u.owner && v.order.type === 'harvest' && v.order.tile >= 0) claimed.add(v.order.tile);
  let best = -1;
  let bestD = Infinity;
  const MAP_W = s.mapW;
  for (let k = 0; k < s.ore.length; k++) {
    if (s.ore[k] <= 0) continue;
    const x = (k % MAP_W) + 0.5;
    const y = ((k / MAP_W) | 0) + 0.5;
    const d = dist(u.x, u.y, x, y) + (claimed.has(k) ? 4 : 0);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

function harvestStep(s: GameState, ctx: Ctx, u: Unit): void {
  const h = u.order;
  if (h.type !== 'harvest') return;
  const p = s.players[u.owner];
  const MAP_W = s.mapW;
  switch (h.phase) {
    case 'seek': {
      if (u.cargo >= cargoMaxOf(u)) {
        h.phase = 'return';
        halt(u);
        return;
      }
      if (h.tile < 0 || s.ore[h.tile] <= 0) {
        h.tile = findOre(s, u);
        halt(u);
        if (h.tile < 0) {
          if (u.cargo > 0) h.phase = 'return';
          return;
        }
      }
      const tx = (h.tile % MAP_W) + 0.5;
      const ty = ((h.tile / MAP_W) | 0) + 0.5;
      const arrived = travel(s, ctx, u, tx, ty);
      if (tileOf(s, u) === h.tile) {
        h.phase = 'gather';
        halt(u);
      } else if (arrived) {
        // Could not reach that tile; try another next tick.
        h.tile = -1;
      }
      return;
    }
    case 'gather': {
      if (tileOf(s, u) !== h.tile || s.ore[h.tile] <= 0) {
        h.phase = 'seek';
        if (s.ore[h.tile] <= 0) h.tile = -1;
        return;
      }
      if ((s.tick + u.id) % SCOOP_TICKS === 0) {
        const cap = cargoMaxOf(u);
        const take = Math.min(HARVEST_PER_SCOOP, s.ore[h.tile], cap - u.cargo);
        s.ore[h.tile] -= take;
        u.cargo += take;
        if (u.cargo >= cap) {
          h.phase = 'return';
          halt(u);
        } else if (s.ore[h.tile] <= 0) {
          h.tile = -1;
          h.phase = 'seek';
        }
      }
      return;
    }
    case 'return': {
      let ref = h.refinery ? ctx.buildings.get(h.refinery) : undefined;
      if (!ref || ref.hp <= 0 || ref.owner !== u.owner || ref.kind !== 'refinery') {
        ref = undefined;
        let bestD = Infinity;
        for (const b of s.buildings) {
          if (b.owner !== u.owner || b.kind !== 'refinery' || b.hp <= 0) continue;
          const dk = dockTile(s, b);
          const d = dist(u.x, u.y, dk.x + 0.5, dk.y + 0.5);
          if (d < bestD) {
            bestD = d;
            ref = b;
          }
        }
        h.refinery = ref ? ref.id : 0;
        halt(u);
      }
      if (!ref) return; // Nowhere to unload: wait.
      const dk = dockTile(s, ref);
      travel(s, ctx, u, dk.x + 0.5, dk.y + 0.5);
      if (dist(u.x, u.y, dk.x + 0.5, dk.y + 0.5) < 0.1) {
        h.phase = 'unload';
        u.fx = 0;
        u.fy = -1;
        halt(u);
      } else if (u.path.length === 0 && u.pathGoal !== -1 && tileOf(s, u) !== dk.x + dk.y * s.mapW && s.tick - u.pathTick > 40) {
        // Dock unreachable for a long while: forget this refinery and look again.
        h.refinery = 0;
      }
      return;
    }
    case 'unload': {
      const ref = ctx.buildings.get(h.refinery);
      if (!ref || ref.hp <= 0) {
        h.phase = 'return';
        h.refinery = 0;
        return;
      }
      const amount = Math.min(UNLOAD_PER_TICK, u.cargo);
      u.cargo -= amount;
      // Only the computer sides get the difficulty's income multiplier (1 on Normal).
      // A side's Logistics perk (side 0's in a campaign; any side's doctrine in round 6) raises its income.
      const perks = perksFor(s, u.owner);
      let mul = (u.owner !== 0 ? DIFFICULTIES[s.difficulty].income : 1) * (perks ? perks.harvestMul : 1);
      // Refinery efficiency (research).
      const refined = incomeMulOf(s, u.owner);
      if (refined !== 1) mul *= refined;
      const credits = Math.round(amount * mul);
      p.credits += credits;
      p.stats.harvested += credits;
      if (u.cargo <= 0) {
        u.cargo = 0;
        h.phase = 'seek';
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Structures

function updateBuilding(s: GameState, ctx: Ctx, b: Building): void {
  const spec = buildingSpecOf(s, b);
  if (b.repairing) {
    if (b.hp >= spec.hp) b.repairing = false;
    else {
      const amount = Math.max(1, Math.round(spec.hp / 200));
      const cost = (amount * spec.cost * REPAIR_COST_SHARE) / spec.hp;
      const p = s.players[b.owner];
      if (p.credits >= cost) {
        p.credits = Math.round((p.credits - cost) * 100) / 100;
        b.hp = Math.min(spec.hp, b.hp + amount);
      } else b.repairing = false;
    }
  }
  if (b.kind === 'repairbay') repairBay(s, ctx, b);
  const w = spec.weapon;
  if (!w || s.tick - b.placedAt < 15) return;
  // Short of power, a turret's guns cycle at half speed.
  if (b.cooldown > 0 && (!ctx.power[b.owner] || s.tick % 2 === 0)) b.cooldown--;
  const cx = b.x + spec.w / 2;
  const cy = b.y + spec.h / 2;
  let t = b.engage ? lookup(ctx, b.engage) : null;
  if (t && (distToTarget(cx, cy, t) > w.range || !canHit(w, t))) t = null;
  if (t?.unit && (t.unit.kind === 'spy' || UNITS[t.unit.kind].stealth) && !seenBy(s, t.unit, b.owner)) t = null;
  if (!t && (s.tick + b.id) % 4 === 0) {
    const found = acquire(s, b.owner, cx, cy, w.range, true, w);
    t = found ? lookup(ctx, found) : null;
  }
  b.engage = t ? (t.unit ? t.unit.id : t.building!.id) : 0;
  if (!t) return;
  const tp = targetPoint(t);
  aim(b, tp.x, tp.y);
  if (b.cooldown === 0) {
    fire(s, b.owner, cx + b.tx * 0.45, cy + b.ty * 0.45, w, t, 0);
    b.cooldown = w.cooldown;
  }
}

/**
 * A Repair Bay mends its side's vehicles standing on or beside it (within REPAIR_BAY_RANGE of its
 * footprint), REPAIR_BAY_HP each every REPAIR_BAY_TICKS (half as often short of power), paid as it
 * goes at REPAIR_COST_SHARE of the vehicle's cost per hit point. With no credits, nothing is mended.
 */
function repairBay(s: GameState, ctx: Ctx, b: Building): void {
  const period = ctx.power[b.owner] ? REPAIR_BAY_TICKS * 2 : REPAIR_BAY_TICKS;
  if ((s.tick + b.id) % period !== 0) return;
  const p = s.players[b.owner];
  for (const v of s.units) {
    if (v.owner !== b.owner || v.hp <= 0 || UNITS[v.kind].category !== 'vehicle') continue;
    const max = maxHpOf(v);
    if (v.hp >= max || distToTarget(v.x, v.y, { building: b }) > REPAIR_BAY_RANGE) continue;
    const amount = Math.min(REPAIR_BAY_HP, max - v.hp);
    const cost = (amount * unitSpecOf(s, v).cost * REPAIR_COST_SHARE) / max;
    if (p.credits < cost) continue;
    p.credits = Math.round((p.credits - cost) * 100) / 100;
    v.hp += amount;
    if (Math.floor(s.tick / period) % 4 === 0) s.effects.push({ id: s.nextId++, kind: 'repair', x: v.x, y: v.y, at: s.tick, size: 0 });
  }
}

function landProjectiles(s: GameState, _ctx: Ctx): void {
  if (!s.projectiles.length) return;
  const keep: Projectile[] = [];
  for (const p of s.projectiles) {
    if (p.hitAt <= s.tick) hit(s, p, p.shooter ?? 0);
    else keep.push(p);
  }
  s.projectiles = keep;
}

// ---------------------------------------------------------------------------------------------
// Crowding: overlapping units push each other apart, never into blocked ground.

function separate(s: GameState, ctx: Ctx): void {
  const buckets = new Map<number, Unit[]>();
  const MAP_W = s.mapW;
  for (const u of s.units) {
    // Aircraft are never pushed and never push: they are not in the crowd at all.
    if (u.hp <= 0 || UNITS[u.kind].category === 'air') continue;
    const k = tileOf(s, u);
    const list = buckets.get(k);
    if (list) list.push(u);
    else buckets.set(k, [u]);
  }
  const radius = (u: Unit) => (UNITS[u.kind].category === 'infantry' ? 0.2 : isShip(u) ? 0.45 : 0.38);
  // Whoever is standing still gives way to whoever is going somewhere, and everybody gives way
  // to a hauler: otherwise an idle crowd on a dock pad freezes the economy.
  const weight = (u: Unit) => (u.kind === 'hauler' ? 0.1 : u.path.length ? 0.25 : 1);
  const push = new Map<number, [number, number]>();
  const add = (u: Unit, x: number, y: number) => {
    const p = push.get(u.id);
    if (p) {
      p[0] += x;
      p[1] += y;
    } else push.set(u.id, [x, y]);
  };
  for (const u of s.units) {
    if (u.hp <= 0 || UNITS[u.kind].category === 'air') continue;
    const ux = Math.floor(u.x);
    const uy = Math.floor(u.y);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const list = buckets.get((uy + dy) * MAP_W + ux + dx);
        if (!list) continue;
        for (const v of list) {
          if (v.id <= u.id || v.hp <= 0) continue;
          // A ship and a soldier on the beach beside it never push each other.
          if (isShip(u) !== isShip(v)) continue;
          const min = radius(u) + radius(v);
          let ex = v.x - u.x;
          let ey = v.y - u.y;
          let d = Math.sqrt(ex * ex + ey * ey);
          if (d >= min) continue;
          if (d < 0.0001) {
            ex = ((v.id * 7) % 5) - 2 || 1;
            ey = ((v.id * 3) % 5) - 2;
            d = Math.sqrt(ex * ex + ey * ey);
          }
          const overlap = (min - d) * 0.5;
          const wu = weight(u);
          const wv = weight(v);
          const su = wu / (wu + wv);
          add(u, (-ex / d) * overlap * su, (-ey / d) * overlap * su);
          add(v, (ex / d) * overlap * (1 - su), (ey / d) * overlap * (1 - su));
        }
      }
  }
  for (const u of s.units) {
    const p = push.get(u.id);
    if (!p) continue;
    const m = Math.sqrt(p[0] * p[0] + p[1] * p[1]);
    const cap = 0.05;
    const k = m > cap ? cap / m : 1;
    nudge(s, ctx, u, p[0] * k, p[1] * k);
  }
}

function nudge(s: GameState, ctx: Ctx, u: Unit, dx: number, dy: number): void {
  const nx = u.x + dx;
  const ny = u.y + dy;
  if (passable(s, ctx.occ, Math.floor(nx), Math.floor(ny), isShip(u))) {
    u.x = nx;
    u.y = ny;
  }
}

// ---------------------------------------------------------------------------------------------

function removeDead(s: GameState): void {
  let fallen: Building[] | null = null;
  if (s.units.some(u => u.hp <= 0)) {
    for (const u of s.units) {
      if (u.hp > 0) continue;
      if (u.hero) noteFallen(s, u);
      if (u.carried) lostAboard(s, u);
      const size = UNITS[u.kind].category === 'infantry' ? 0 : 1;
      s.effects.push({ id: s.nextId++, kind: 'boom', x: u.x, y: u.y, at: s.tick, size: size === 0 ? 0.5 : 1 });
    }
    s.units = s.units.filter(u => u.hp > 0);
  }
  if (s.buildings.some(b => b.hp <= 0)) {
    for (const b of s.buildings) {
      if (b.hp > 0) continue;
      const spec = buildingSpecOf(s, b);
      s.effects.push({ id: s.nextId++, kind: 'boom', x: b.x + spec.w / 2, y: b.y + spec.h / 2, at: s.tick, size: 2 });
      if (b.owner === 0) log(s, `${spec.name} destroyed.`, 'bad');
      else if (isEnemy(s, 0, b.owner)) log(s, `Enemy ${spec.name} destroyed.`, 'good');
      else log(s, `Allied ${spec.name} destroyed.`, 'bad');
      noteDestroyed(s, b);
    }
    fallen = s.buildings.filter(b => b.hp <= 0);
    s.buildings = s.buildings.filter(b => b.hp > 0);
  }
  if (fallen) {
    // The crews walk out, unless that was the side's last structure and the battle is over.
    const occ = occupancy(s);
    for (const b of fallen) if (s.buildings.some(o => o.owner === b.owner && isStructure(o))) spawnSurvivors(s, b, occ);
  }
}

/**
 * A side is out when it has no structure left (walls are not structures, so a side with nothing but
 * sandbags left has lost); a team is out when all its sides are. The battle ends when the human's
 * team is out (defeat) or is the only team left (victory). `winner` is then the lowest-numbered
 * side of the winning team: side 0 for a victory; for a defeat, the first surviving enemy, or the
 * first enemy at all if nobody is left. Two sides: exactly the original rule (side 1 wins when both
 * fall together).
 */
function checkVictory(s: GameState): void {
  if (s.planet && planetVictory(s, s.planet)) return;
  const has: boolean[] = s.players.map(() => false);
  for (const b of s.buildings) if (isStructure(b)) has[b.owner] = true;
  const sides = sidesOf(s);
  const alive = (o: Owner) => has[o] || sides.some(a => has[a] && isAlly(s, a, o));
  const ours = alive(0);
  const foes = enemiesOf(s, 0);
  if (ours && foes.some(alive)) return;
  s.winner = ours ? 0 : (foes.find(o => has[o]) ?? foes.find(alive) ?? foes[0]);
  const won = s.winner === 0;
  const text = won
    ? sides.length === 2
      ? 'Victory. The Ashen Combine has been driven from the field.'
      : 'Victory. Every enemy has been driven from the field.'
    : sides.length === 2 || !has[0]
      ? 'Defeat. Our last structure has fallen.'
      : 'Defeat. Our last ally has fallen.';
  log(s, text, won ? 'good' : 'bad');
}

/**
 * War for the Planet (fireline-planet-design.md, section 14.3): the attacking team wins when the
 * principal defender has no Command Yard standing; the defending team wins when the time limit is
 * reached first. `winner` is the lowest seat of the winning team. Returns true when it decided the
 * battle; otherwise the ordinary rule above runs.
 */
function planetVictory(s: GameState, p: NonNullable<GameState['planet']>): boolean {
  const defTeam = teamOf(s, p.defenderSeat);
  const yardStands = s.buildings.some(b => b.owner === p.defenderSeat && b.kind === 'hq' && b.hp > 0);
  let attackersWon: boolean;
  if (!yardStands) attackersWon = true;
  else if (s.tick >= p.timeLimit) attackersWon = false;
  else return false;
  const sides = sidesOf(s);
  const winners = sides.filter(o => (teamOf(s, o) === defTeam) !== attackersWon);
  s.winner = winners[0] ?? (attackersWon ? sides.find(o => teamOf(s, o) !== defTeam)! : p.defenderSeat);
  const humanDefends = teamOf(s, 0) === defTeam;
  const won = isAlly(s, s.winner, 0);
  const text = attackersWon
    ? humanDefends
      ? 'Defeat. Our Command Yard has fallen.'
      : 'Victory. The Command Yard has fallen.'
    : humanDefends
      ? 'Victory. The defenders held.'
      : 'Defeat. The defenders held.';
  log(s, text, won ? 'good' : 'bad');
  return true;
}
