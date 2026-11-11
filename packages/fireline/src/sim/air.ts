import { buildingCentre, dist, distToTarget, targetPoint, type Target } from './grid';
import {
  AIR_AMMO,
  AIR_EDGE,
  BOMB_GAP,
  BOMB_PATCH,
  FLIGHT_TICKS,
  FUEL_RESERVE,
  FUEL_TICKS,
  HELIPAD_SLOTS,
  ORBIT_COS,
  ORBIT_SIN,
  REARM_TICKS,
  SCRAMBLE_LEASH,
  SCRAMBLE_RANGE,
  UNITS,
  VET_DAMAGE,
  airSlotsOf,
  hitsAir,
  hitsGround,
  type AirRole,
  type Owner,
  type UnitKind,
  type Weapon,
} from './rules';
import { damageMulOf, migrateResearch, rearmMulOf } from './research';
import { isEnemy } from './sides';
import type { Building, GameState, Unit } from './types';
import { unitSpecOf } from './specs';

/**
 * Aircraft (fireline-round4-design.md, workstream A): Gunships and Bombers. They fly in straight
 * lines, ignoring tiles, occupancy and structures, kept a little inside the map's edge. They are
 * never pushed by crowding (`separate` in tick.ts skips them) and never block a ground unit, since
 * ground movement only asks the tiles and the structures. Sight and the fog treat them like
 * anything else.
 *
 * Every aircraft carries AIR_AMMO loads (`u.ammo`) and belongs to a Helipad (`u.pad`), which serves
 * HELIPAD_SLOTS of them. Out of ammunition, it flies back to its Helipad (or, with that gone, to
 * another with room) and takes on a load every REARM_TICKS; with no Helipad anywhere it waits where
 * it is. Full again, it stays parked on the pad until ordered, or runs its next queued order; a
 * parked Gunship fires at ground targets in reach of its pad without leaving it.
 *
 * A Gunship fires rockets at ground targets, one load a shot, like a ground unit: it holds its
 * position while guarding, chases when aggressive or ordered, and fires from a hover. A Bomber
 * sent to attack flies at the target and, close enough and lined up, starts a run: one bomb every
 * BOMB_GAP ticks along its heading until all are gone. A run once begun is always finished; then it
 * goes home to rearm. Bombs never hit aircraft, and flak never hits the ground (tick.ts `hit`).
 *
 * The air war (2026-11-10) adds two more. The Recon Plane is unarmed: its loads are fuel, burnt one
 * every FUEL_TICKS while it is off its pad, and it turns for home at FUEL_RESERVE. Sent to a point it
 * circles there; its waypoint queue makes a patrol. It sees far and, as a detector, uncovers Stealth
 * Tanks and Spies (sites.ts, mission.ts). The Interceptor fires anti-air missiles at aircraft only,
 * fights like a Gunship, and parked full on its pad (not on hold) scrambles at enemy aircraft within
 * SCRAMBLE_RANGE of the pad, breaks off beyond SCRAMBLE_LEASH, and lands again when the sky is clear.
 */

/** What the air layer borrows from tick.ts, which owns targeting and firing for everything. */
export interface AirHooks {
  lookup(id: number): Target | null;
  acquire(owner: Owner, x: number, y: number, range: number, w: Weapon): number;
  fire(owner: Owner, sx: number, sy: number, w: Weapon, t: Target, shooter: number, damageMul: number): void;
  nextOrder(u: Unit): void;
}

/** True for an aircraft. */
export const isAir = (u: Unit): boolean => UNITS[u.kind].category === 'air';

/**
 * How this aircraft fights (UnitSpec.airRole, round 6): 'strafe' (Gunship, Kestrel), 'bomb' (Bomber,
 * Heavy Bomber, Firebrand), 'scout' (Recon Plane), 'intercept' (Interceptor), 'transport' (Troop
 * Carrier); undefined off aircraft. A role is part of a kind's identity, the same for every army.
 */
export const airRoleOf = (u: Unit): AirRole | undefined => UNITS[u.kind].airRole;

/** Full ammunition for this aircraft (0 for anything else). */
export const ammoMax = (u: Unit): number => AIR_AMMO[u.kind] ?? 0;

/** True for a standing Helipad of this side. */
const isPad = (s: GameState, b: Building | undefined, owner: Owner): b is Building =>
  !!b && b.kind === 'helipad' && b.owner === owner && b.hp > 0;

/** How many of this Helipad's places its aircraft take (a Heavy Bomber takes two), leaving out `except`. */
export function padLoad(s: GameState, padId: number, except = 0): number {
  let n = 0;
  for (const u of s.units) if (u.pad === padId && u.id !== except && u.hp > 0 && isAir(u)) n += airSlotsOf(u.kind);
  return n;
}

/**
 * The Helipad this aircraft should land on: its own while it stands, else the nearest of its side's
 * with room (which it then belongs to), else 0 (it waits).
 */
export function homePad(s: GameState, u: Unit): number {
  if (u.pad) {
    const own = s.buildings.find(b => b.id === u.pad);
    if (isPad(s, own, u.owner)) return own.id;
  }
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of s.buildings) {
    if (!isPad(s, b, u.owner) || padLoad(s, b.id, u.id) + airSlotsOf(u.kind) > HELIPAD_SLOTS) continue;
    const c = buildingCentre(b);
    const d = dist(u.x, u.y, c.x, c.y);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  u.pad = best ? best.id : 0;
  return u.pad;
}

/** Where this aircraft sits on its pad: the left or right half, by its place among the pad's aircraft. */
export function padSpot(s: GameState, pad: Building, u: Unit): { x: number; y: number } {
  // A Heavy Bomber, taking the whole pad, sits in its middle.
  if (airSlotsOf(u.kind) >= HELIPAD_SLOTS) return { x: pad.x + HELIPAD_SLOTS / 2, y: pad.y + 1 };
  let place = 0;
  for (const v of s.units) if (v.pad === pad.id && v.id < u.id && v.hp > 0 && isAir(v)) place += airSlotsOf(v.kind);
  return { x: pad.x + 0.5 + (place % HELIPAD_SLOTS), y: pad.y + 1 };
}

/** Flies straight toward (x, y), kept inside the map. True once there. */
function fly(s: GameState, u: Unit, x: number, y: number): boolean {
  const tx = Math.max(AIR_EDGE, Math.min(s.mapW - AIR_EDGE, x));
  const ty = Math.max(AIR_EDGE, Math.min(s.mapH - AIR_EDGE, y));
  const sp = unitSpecOf(s, u).speed;
  const dx = tx - u.x;
  const dy = ty - u.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= sp) {
    u.x = tx;
    u.y = ty;
    return true;
  }
  u.x += (dx / d) * sp;
  u.y += (dy / d) * sp;
  u.fx = dx / d;
  u.fy = dy / d;
  return false;
}

function aimAt(u: Unit, x: number, y: number): void {
  const dx = x - u.x;
  const dy = y - u.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.0001) return;
  u.tx = dx / d;
  u.ty = dy / d;
}

/** Heads for a Helipad to rearm, keeping the waypoint queue for afterwards. */
function goRearm(s: GameState, u: Unit): void {
  u.order = { type: 'rearm', pad: homePad(s, u) };
  u.engage = 0;
  if (u.scramble) delete u.scramble;
}

/**
 * Sends an aircraft home to its pad to rearm and stay parked: what the computer does with aircraft
 * it has no strike for. Works in place on a cloned state.
 */
export function parkAircraft(s: GameState, u: Unit): void {
  goRearm(s, u);
  u.path = [];
  u.pathGoal = -1;
}

/** True when this weapon can fire at this target, by whether it is in the air. */
export function canHit(w: Weapon, t: Target): boolean {
  return t.unit && isAir(t.unit) ? hitsAir(w) : hitsGround(w);
}

/** One tick of one aircraft, on a state the reducer has already cloned. */
export function updateAircraft(s: GameState, u: Unit, h: AirHooks): void {
  const spec = unitSpecOf(s, u);
  const role = airRoleOf(u);
  const max = ammoMax(u);
  if (u.ammo === undefined) u.ammo = max;
  if (u.cooldown > 0) u.cooldown--;
  // Unarmed roles (air war): the Troop Carrier ('transport') and the Recon Plane ('scout').
  const w = spec.weapon;
  if (!w || role === 'transport' || role === 'scout') {
    if (role === 'transport') carrierStep(s, u, h, max);
    else reconStep(s, u, h, max);
    return;
  }
  // A fighter guards and hunts: the ground for a 'strafe' aircraft, the air for an 'intercept' one.
  const fighter = role === 'strafe' || role === 'intercept';

  // A Bomber's run, once begun, is always finished: straight on, a bomb every BOMB_GAP ticks.
  if (u.bombRun) {
    fly(s, u, u.x + u.fx, u.y + u.fy);
    if (u.cooldown === 0 && u.ammo > 0) dropBomb(s, u, w);
    if (u.ammo <= 0) {
      delete u.bombRun;
      goRearm(s, u);
    }
    return;
  }

  // Empty: home to rearm, unless flying somewhere it was sent.
  if (u.ammo <= 0 && u.order.type !== 'rearm' && u.order.type !== 'move') goRearm(s, u);

  const o = u.order;
  switch (o.type) {
    case 'rearm': {
      rearm(s, u, h, max);
      break;
    }
    case 'move': {
      u.engage = 0;
      if (fly(s, u, o.x, o.y)) h.nextOrder(u);
      break;
    }
    case 'attack': {
      const t = h.lookup(o.target);
      if (!t || !canHit(w, t)) {
        h.nextOrder(u);
        break;
      }
      // A scrambled Interceptor chases no further than its leash from the pad.
      if (u.scramble && !onLeash(s, u)) {
        goRearm(s, u);
        break;
      }
      u.engage = o.target;
      if (role === 'bomb') bomberAttack(s, u, w, t);
      else gunshipFight(s, u, h, w, t, true);
      break;
    }
    case 'attackMove': {
      if (fighter && engaged(s, u, h, w, spec.sight + 1)) break;
      // A Bomber on attack-move bombs the first enemy structure it comes near, then goes home to
      // rearm: sent along a line it would otherwise fly to the point and hover with a full bay.
      if (role === 'bomb' && u.ammo > 0) {
        const t = bomberMark(s, u, h, spec.sight + 2);
        if (t) {
          bomberAttack(s, u, w, t);
          break;
        }
      }
      if (fly(s, u, o.x, o.y)) h.nextOrder(u);
      break;
    }
    default: {
      // Back from a scramble with the target gone: the next intruder near the pad, else home.
      if (u.scramble) {
        if (!(u.ammo > 0 && scramble(s, u, h, w, true))) goRearm(s, u);
        break;
      }
      // Idle: hovering. A Gunship with rockets guards the ground it holds, an Interceptor the air,
      // or hunts when aggressive.
      if (fighter && u.ammo > 0 && u.stance !== 'hold') {
        engaged(s, u, h, w, u.stance === 'aggressive' ? spec.sight + 1 : w.range + 0.5);
      } else u.engage = 0;
      break;
    }
  }
  // A turret, if any, drifts back to the heading when not shooting.
  if (!u.engage) {
    u.tx += (u.fx - u.tx) * 0.2;
    u.ty += (u.fy - u.ty) * 0.2;
    const d = Math.sqrt(u.tx * u.tx + u.ty * u.ty);
    if (d < 0.0001) {
      u.tx = u.fx;
      u.ty = u.fy;
    } else {
      u.tx /= d;
      u.ty /= d;
    }
  }
}

/**
 * A Gunship keeping or finding a target within `range` and fighting it. True while it has one, so
 * an attack-move holds its course until the target is dealt with.
 */
function engaged(s: GameState, u: Unit, h: AirHooks, w: Weapon, range: number): boolean {
  let t = u.engage ? h.lookup(u.engage) : null;
  if (t && (!canHit(w, t) || distToTarget(u.x, u.y, t) > range + 2)) t = null;
  if (!t && (s.tick + u.id) % 4 === 0) {
    const found = h.acquire(u.owner, u.x, u.y, range, w);
    t = found ? h.lookup(found) : null;
  }
  u.engage = t ? (t.unit ? t.unit.id : t.building!.id) : 0;
  if (!t) return false;
  // Guarding: shoot only what is in reach, never leave the spot. Otherwise close in.
  const chase = u.order.type === 'attackMove' || (u.stance === 'aggressive' && u.order.type === 'idle');
  gunshipFight(s, u, h, w, t, chase);
  return true;
}

/** Closes to within range (when allowed to move) and fires a rocket a load. */
function gunshipFight(s: GameState, u: Unit, h: AirHooks, w: Weapon, t: Target, move: boolean): void {
  const tp = targetPoint(t);
  const d = distToTarget(u.x, u.y, t);
  aimAt(u, tp.x, tp.y);
  if (d > w.range) {
    if (move) {
      // Close to a little inside range, then hover.
      const k = (d - w.range * 0.85) / Math.max(d, 0.0001);
      fly(s, u, u.x + (tp.x - u.x) * k, u.y + (tp.y - u.y) * k);
    } else u.engage = 0;
    return;
  }
  if (u.cooldown === 0 && (u.ammo ?? 0) > 0) {
    h.fire(u.owner, u.x + u.tx * 0.3, u.y + u.ty * 0.3, w, t, u.id, vetMul(u));
    u.cooldown = w.cooldown;
    u.ammo = (u.ammo ?? 0) - 1;
    if (u.ammo <= 0) goRearm(s, u);
  }
}

const vetMul = (u: Unit) => VET_DAMAGE[u.vet] ?? 1;

/** The enemy structure a Bomber on attack-move goes for: the one it has, else the nearest in reach. */
function bomberMark(s: GameState, u: Unit, h: AirHooks, range: number): Target | null {
  const held = u.engage ? h.lookup(u.engage) : null;
  if (held && held.building) return held;
  let best: Building | null = null;
  let bestD = range;
  for (const b of s.buildings) {
    if (b.hp <= 0 || !isEnemy(s, u.owner, b.owner)) continue;
    const c = buildingCentre(b);
    const d = dist(u.x, u.y, c.x, c.y);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  u.engage = best ? best.id : 0;
  return best ? { building: best } : null;
}

/**
 * A Bomber on an attack order: flies at the target and, within the weapon's range and lined up on it
 * (its heading within about 18 degrees of the target), drops the first bomb of its run.
 */
function bomberAttack(s: GameState, u: Unit, w: Weapon, t: Target): void {
  const tp = targetPoint(t);
  const d = dist(u.x, u.y, tp.x, tp.y);
  const lined = d > 0.0001 && ((tp.x - u.x) * u.fx + (tp.y - u.y) * u.fy) / d >= 0.95;
  if (d <= w.range && lined && (u.ammo ?? 0) > 0 && u.cooldown === 0) {
    u.bombRun = true;
    dropBomb(s, u, w);
    return;
  }
  // Too close to line up: carry on past and come round.
  if (d <= w.range && !lined && d < 1.5) fly(s, u, u.x + u.fx, u.y + u.fy);
  else fly(s, u, tp.x, tp.y);
}

/**
 * One bomb, falling ahead of the aircraft along its heading. It lands as its weapon's kind: the
 * Bomber's 'bomb', or (round 6) a Firebrand's incendiary, whose weapon kind is in BOMB_PATCH and so
 * keeps burning where it lands: more blasts on the same spot, `gap` ticks apart, drawn and dealt as
 * that weapon's own (tick.ts lands them as it does every projectile).
 */
function dropBomb(s: GameState, u: Unit, w: Weapon): void {
  const flight = FLIGHT_TICKS.bomb;
  const ahead = unitSpecOf(s, u).speed * flight;
  const toX = Math.max(0, Math.min(s.mapW, u.x + u.fx * ahead));
  const toY = Math.max(0, Math.min(s.mapH, u.y + u.fy * ahead));
  const mul = vetMul(u) * damageMulOf(s, u.owner);
  const damage = mul === 1 ? w.damage : w.damage * mul;
  const splash = w.splash ?? 1;
  s.projectiles.push({
    id: s.nextId++,
    owner: u.owner,
    weapon: w.kind,
    fromX: u.x,
    fromY: u.y,
    toX,
    toY,
    firedAt: s.tick,
    hitAt: s.tick + flight,
    target: 0,
    damage,
    splash,
    shooter: u.id,
  });
  const patch = BOMB_PATCH[w.kind];
  if (patch) {
    for (let i = 1; i <= patch.pulses; i++)
      s.projectiles.push({
        id: s.nextId++,
        owner: u.owner,
        weapon: w.kind,
        fromX: toX,
        fromY: toY,
        toX,
        toY,
        firedAt: s.tick + flight,
        hitAt: s.tick + flight + i * patch.gap,
        target: 0,
        damage: damage * patch.share,
        splash,
        shooter: u.id,
      });
  }
  u.ammo = (u.ammo ?? 0) - 1;
  u.cooldown = BOMB_GAP;
}

/** Home to the Helipad, land, and take on a load every REARM_TICKS until full. */
function rearm(s: GameState, u: Unit, h: AirHooks, max: number): void {
  const o = u.order;
  if (o.type !== 'rearm') return;
  let pad = s.buildings.find(b => b.id === o.pad);
  if (!isPad(s, pad, u.owner) || u.pad !== o.pad) {
    // The pad has gone (or was never ours): another with room, or wait where we are.
    u.order = { type: 'rearm', pad: homePad(s, u) };
    pad = s.buildings.find(b => b.id === u.pad);
    if (!isPad(s, pad, u.owner)) {
      u.engage = 0;
      return;
    }
  }
  const spot = padSpot(s, pad, u);
  if (!fly(s, u, spot.x, spot.y)) {
    u.engage = 0;
    return;
  }
  if ((u.ammo ?? 0) < max) {
    u.engage = 0;
    if (u.cooldown === 0) {
      u.ammo = (u.ammo ?? 0) + 1;
      u.cooldown = Math.max(1, Math.round((REARM_TICKS[u.kind] ?? 20) * rearmMulOf(s, u.owner)));
    }
    return;
  }
  // Full: on with the queue, or stay parked; a parked Gunship guards the ground in reach of its pad,
  // and a parked Interceptor scrambles at enemy aircraft near it.
  if (u.queue.length) h.nextOrder(u);
  else if (airRoleOf(u) === 'strafe' && u.stance !== 'hold') {
    const w = unitSpecOf(s, u).weapon!;
    engaged(s, u, h, w, w.range + 0.5);
  } else if (airRoleOf(u) === 'intercept' && u.stance !== 'hold') scramble(s, u, h, unitSpecOf(s, u).weapon!, false);
  else u.engage = 0;
}

/** The centre of this aircraft's own standing Helipad, or null. */
function padCentre(s: GameState, u: Unit): { x: number; y: number } | null {
  const pad = u.pad ? s.buildings.find(b => b.id === u.pad) : undefined;
  return isPad(s, pad, u.owner) ? buildingCentre(pad) : null;
}

/** True while a scrambled Interceptor is within SCRAMBLE_LEASH of its pad (false with no pad). */
function onLeash(s: GameState, u: Unit): boolean {
  const c = padCentre(s, u);
  return !!c && dist(u.x, u.y, c.x, c.y) <= SCRAMBLE_LEASH;
}

/**
 * An Interceptor at (or back from) its pad looks for an enemy aircraft within SCRAMBLE_RANGE of the
 * pad and, finding one, goes up after it. Parked, it looks every fourth tick; back from a chase
 * (`now`) it looks at once, so it never lands between two intruders. True when it went up.
 */
function scramble(s: GameState, u: Unit, h: AirHooks, w: Weapon, now: boolean): boolean {
  u.engage = 0;
  if (!now && (s.tick + u.id) % 4 !== 0) return false;
  const c = padCentre(s, u);
  if (!c) return false;
  const found = h.acquire(u.owner, c.x, c.y, SCRAMBLE_RANGE, w);
  if (!found) return false;
  u.order = { type: 'attack', target: found };
  u.engage = found;
  u.scramble = true;
  return true;
}

/**
 * One tick of a Troop Carrier: unarmed and unfuelled, it flies where it is sent and hovers there;
 * sent home (a rearm order) it lands on its pad and stays. Boarding and setting down are in
 * transport.ts, which runs after every unit has moved.
 */
function carrierStep(s: GameState, u: Unit, h: AirHooks, max: number): void {
  u.engage = 0;
  const o = u.order;
  if (o.type === 'rearm') rearm(s, u, h, max);
  else if (o.type === 'move' || o.type === 'attackMove') {
    if (fly(s, u, o.x, o.y)) h.nextOrder(u);
  }
  u.tx = u.fx;
  u.ty = u.fy;
}

/**
 * One tick of a Recon Plane: unarmed, it burns a load of fuel every FUEL_TICKS while off its pad and
 * turns for home at FUEL_RESERVE. Sent somewhere (move or attack-move alike) it flies there, and with
 * nothing more queued circles the spot until its fuel runs low. Landed, it refuels like a rearm.
 */
function reconStep(s: GameState, u: Unit, h: AirHooks, max: number): void {
  u.engage = 0;
  if (u.order.type === 'rearm') {
    rearm(s, u, h, max);
    return;
  }
  if (u.cooldown === 0) {
    u.ammo = Math.max(0, (u.ammo ?? 0) - 1);
    u.cooldown = FUEL_TICKS;
  }
  if ((u.ammo ?? 0) <= FUEL_RESERVE) {
    goRearm(s, u);
    // Its timer was the fuel's; refuelling starts the moment it lands.
    u.cooldown = 0;
    return;
  }
  const o = u.order;
  if (o.type === 'move' || o.type === 'attackMove') {
    if (fly(s, u, o.x, o.y)) h.nextOrder(u);
    return;
  }
  // Circling: the heading turns a fixed angle each tick and the plane flies along it.
  const fx = u.fx * ORBIT_COS - u.fy * ORBIT_SIN;
  const fy = u.fx * ORBIT_SIN + u.fy * ORBIT_COS;
  const d = Math.sqrt(fx * fx + fy * fy) || 1;
  u.fx = fx / d;
  u.fy = fy / d;
  fly(s, u, u.x + u.fx, u.y + u.fy);
  u.tx = u.fx;
  u.ty = u.fy;
}

/**
 * A new aircraft from the Helipad `pad`: it belongs to that pad if there is room on it, else to
 * another of its side's with room. It starts full, parked on its pad.
 */
export function launchAircraft(s: GameState, u: Unit, pad: Building): void {
  u.ammo = ammoMax(u);
  u.pad = padLoad(s, pad.id, u.id) + airSlotsOf(u.kind) <= HELIPAD_SLOTS ? pad.id : 0;
  if (!u.pad) homePad(s, u);
  const home = s.buildings.find(b => b.id === u.pad) ?? pad;
  const spot = padSpot(s, home, u);
  u.x = spot.x;
  u.y = spot.y;
  u.order = { type: 'rearm', pad: u.pad };
}

/** How many Helipad places this side's aircraft take, built or queued (a Heavy Bomber takes two): the Helipads cap it. */
export function airCount(s: GameState, owner: Owner): number {
  let n = 0;
  for (const q of s.players[owner].queues.air ?? []) n += airSlotsOf(q.kind as UnitKind);
  for (const u of s.units) if (u.owner === owner && u.hp > 0 && isAir(u)) n += airSlotsOf(u.kind);
  return n;
}

/** Helipad places still free for more aircraft: every Helipad serves HELIPAD_SLOTS. */
export function airRoom(s: GameState, owner: Owner): number {
  let pads = 0;
  for (const b of s.buildings) if (isPad(s, b, owner)) pads++;
  return pads * HELIPAD_SLOTS - airCount(s, owner);
}

/**
 * A save from before air power: every player gets an empty air queue, research fields are checked,
 * and any aircraft's ammunition and pad are made sane. Works on the copy migrateState builds (its
 * players are replaced, never changed in place).
 */
export function migrateAir(s: GameState): void {
  s.players = s.players.map(p => {
    const fixed = migrateResearch(p);
    const queues = p.queues && typeof p.queues === 'object' ? p.queues : ({} as GameState['players'][number]['queues']);
    const out = {
      ...p,
      queues: {
        building: Array.isArray(queues.building) ? queues.building : [],
        infantry: Array.isArray(queues.infantry) ? queues.infantry : [],
        vehicle: Array.isArray(queues.vehicle) ? queues.vehicle : [],
        air: Array.isArray(queues.air) ? queues.air : [],
      },
    };
    if (fixed.upgrades !== undefined) out.upgrades = fixed.upgrades;
    if (fixed.research !== undefined) out.research = fixed.research;
    return out;
  });
  // A commander's airlift in a save: kept only when it is well formed.
  s.ai = s.ai.map(m => {
    const l = m.airlift as unknown;
    if (l === undefined) return m;
    const a = l as Partial<NonNullable<typeof m.airlift>> | null;
    const ok =
      !!a &&
      typeof a === 'object' &&
      Number.isInteger(a.carrier) &&
      Array.isArray(a.ids) &&
      a.ids.every(Number.isInteger) &&
      Number.isFinite(a.x) &&
      Number.isFinite(a.y) &&
      Number.isInteger(a.target) &&
      (a.phase === 'board' || a.phase === 'fly') &&
      Number.isFinite(a.since);
    return ok ? m : { ...m, airlift: null };
  });
  for (const u of s.units) {
    if (!UNITS[u.kind]) continue;
    if (isAir(u)) {
      const max = ammoMax(u);
      u.ammo = Number.isFinite(u.ammo) ? Math.max(0, Math.min(max, Math.round(u.ammo!))) : max;
      u.pad = Number.isInteger(u.pad) && u.pad! > 0 ? u.pad : 0;
      if (u.bombRun !== undefined && (u.bombRun !== true || airRoleOf(u) !== 'bomb' || !u.ammo)) delete u.bombRun;
      if (u.scramble !== undefined && (u.scramble !== true || airRoleOf(u) !== 'intercept')) delete u.scramble;
      // A Troop Carrier's passengers: kept if they are infantry that may ride, up to its room.
      if (u.carried !== undefined) {
        const cap = UNITS[u.kind].carries ?? 0;
        const ok = Array.isArray(u.carried)
          ? u.carried.filter(r => r && typeof r === 'object' && UNITS[r.kind]?.category === 'infantry' && !UNITS[r.kind].hero && r.kind !== 'general' && Number.isFinite(r.hp) && r.hp > 0 && Number.isInteger(r.id)).slice(0, cap)
          : [];
        if (ok.length) u.carried = ok.map(r => ({ ...r, order: { type: 'idle' }, path: [], queue: [], engage: 0 }));
        else delete u.carried;
      }
      if (u.drop !== undefined && (u.drop !== true || !u.carried)) delete u.drop;
      delete u.boarding;
    } else {
      delete u.carried;
      delete u.drop;
      if (u.boarding !== undefined && (!Number.isInteger(u.boarding) || UNITS[u.kind].category !== 'infantry')) delete u.boarding;
      delete u.ammo;
      delete u.pad;
      delete u.bombRun;
      delete u.scramble;
      if (u.order && u.order.type === 'rearm') u.order = { type: 'idle' };
    }
    if (u.order && u.order.type === 'rearm' && !Number.isInteger(u.order.pad)) u.order = { type: 'rearm', pad: 0 };
  }
}
