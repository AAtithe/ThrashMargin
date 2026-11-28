/**
 * Round 7: the Fortification line in the simulation (fireline-round7-fortification.md): Point
 * Defence intercepts, counter-battery reveals and the return fire they allow, and the shelling
 * counts the computer reads. Pure like the rest of src/sim/: no clock, no Math.random; the one dice
 * roll (an intercept) is drawn from the battle's seed.
 *
 * Called from tick.ts once a tick (fortificationStep, after units and structures have fired and
 * before shells land) and from hurt() (notePressure). Both return at once in a battle that does not
 * play the line, so such a battle is byte-identical to one from before round 7.
 */
import { dist } from './grid';
import { next } from './rng';
import {
  COUNTER_BATTERY_KINDS,
  COUNTER_BATTERY_RADIUS,
  COUNTER_BATTERY_TICKS,
  POINT_DEFENCE_CHANCE,
  POINT_DEFENCE_COOLDOWN,
  POINT_DEFENCE_RADIUS,
  UNITS,
  type Owner,
} from './rules';
import { fortificationOn } from './fortify';
import { weaponOf } from './loadout';
import { isAlly, isEnemy, sidesOf } from './sides';
import { alarm, paceOf, powerOf, teamVisibility } from './state';
import { buildingSpecOf } from './specs';
import type { Building, GameState, Projectile, Unit } from './types';

const hasUp = (s: GameState, owner: Owner, id: string): boolean => !!s.players[owner]?.upgrades?.includes(id as never);

/** Whose shot this is: the unit that fired it, if it still stands (support powers and structures have none). */
const shooterOf = (units: Map<number, Unit>, p: Projectile): Unit | undefined => (p.shooter ? units.get(p.shooter) : undefined);

/**
 * True for a projectile Point Defence will shoot at: an artillery shell (a gun's or the barrage's,
 * never a Grenadier's grenade), a Missile Carrier's missile, a bomb (a Firebrand's incendiary as it
 * falls, not the fire it leaves), the missile strike and the cruise missile. Never a bullet, tank shell, rocket from
 * anything else, flak or anti-air missile.
 */
export function interceptable(units: Map<number, Unit>, p: Projectile): boolean {
  if (p.weapon === 'missile' || p.weapon === 'cruise' || p.weapon === 'bomb') return true;
  if (p.weapon === 'flame') return p.fromX !== p.toX || p.fromY !== p.toY; // a burning patch's pulses start where they land
  const u = shooterOf(units, p);
  if (p.weapon === 'artillery') return !u || UNITS[u.kind].category !== 'infantry';
  if (p.weapon === 'rocket') return !!u && u.kind === 'missilecarrier';
  return false;
}

/** The firing position counter-battery traces, or null when this shot is not one it traces. */
function batteryOf(units: Map<number, Unit>, p: Projectile): { x: number; y: number; shooter: number } | null {
  if (!p.shooter) {
    // The barrage and the missile strike (shooter 0, splash): traced to where they were called from.
    if ((p.weapon === 'artillery' || p.weapon === 'missile' || p.weapon === 'cruise') && p.splash > 0) return { x: p.fromX, y: p.fromY, shooter: 0 };
    return null;
  }
  const u = units.get(p.shooter);
  if (!u || !COUNTER_BATTERY_KINDS.includes(u.kind)) return null;
  if (p.weapon !== 'artillery' && p.weapon !== 'rocket') return null;
  return { x: u.x, y: u.y, shooter: u.id };
}

/**
 * The commander's shelling counts (aiFortification.ts reads them): a structure of `owner` hurt by
 * indirect fire, from the ground (artillery, a Missile Carrier, a Battleship) or from above (a bomb,
 * the barrage, the missile strike). Only while the line is in play on a Long or Epic pace; a grenade
 * or a direct shot counts for nothing.
 */
export function notePressure(s: GameState, b: Building, p: Projectile): void {
  // Counted only where the commander can use the count (Long and Epic paces: aiFortification.ts).
  if (!fortificationOn(s)) return;
  const pace = paceOf(s);
  if (pace !== 'long' && pace !== 'epic') return;
  const u = p.shooter ? s.units.find(v => v.id === p.shooter) : undefined;
  let air = false;
  if (p.weapon === 'bomb' || p.weapon === 'missile' || p.weapon === 'cruise') air = true;
  else if (p.weapon === 'flame') air = !!u && UNITS[u.kind].category === 'air';
  else if (p.weapon === 'artillery') air = !p.shooter;
  else if (p.weapon !== 'rocket') return;
  if (!air && (!u || !COUNTER_BATTERY_KINDS.includes(u.kind))) return;
  const mem = s.ai[b.owner];
  if (!mem) return;
  if (air) mem.shellAir = (mem.shellAir ?? 0) + 1;
  else mem.shellGround = (mem.shellGround ?? 0) + 1;
  const spec = buildingSpecOf(s, b);
  mem.shellTick = s.tick;
  mem.shellX = b.x + spec.w / 2;
  mem.shellY = b.y + spec.h / 2;
}

/** One tick of the line: counter-battery, Point Defence, then the reveals' expiry and return fire. */
export function fortificationStep(s: GameState): void {
  if (!fortificationOn(s)) return;
  const units = new Map(s.units.map(u => [u.id, u]));
  counterBattery(s, units);
  pointDefence(s, units);
  if (s.reveals && s.reveals.some(r => r[3] <= s.tick)) s.reveals = s.reveals.filter(r => r[3] > s.tick);
  if (s.reveals && s.reveals.length && s.tick % 4 === 0) returnFire(s, units);
}

/**
 * Counter-battery: every shot fired this tick by a battery (Artillery, a Missile Carrier, a
 * Battleship, the barrage, the missile strike) landing where a side with Counter-battery can see
 * (its structures always can) reveals the battery's position to that side for COUNTER_BATTERY_TICKS.
 * One reveal per battery per side, moved and renewed by each new shot.
 */
function counterBattery(s: GameState, units: Map<number, Unit>): void {
  let sides: Owner[] | null = null;
  const vis = new Map<Owner, Uint8Array>();
  for (const p of s.projectiles) {
    if (p.firedAt !== s.tick) continue;
    const bat = batteryOf(units, p);
    if (!bat) continue;
    sides ??= sidesOf(s).filter(o => hasUp(s, o, 'counterbattery'));
    if (!sides.length) return;
    for (const o of sides) {
      if (!isEnemy(s, p.owner, o)) continue;
      let v = vis.get(o);
      if (!v) {
        v = teamVisibility(s, o);
        vis.set(o, v);
      }
      const tx = Math.floor(p.toX);
      const ty = Math.floor(p.toY);
      const seen = tx >= 0 && ty >= 0 && tx < s.mapW && ty < s.mapH && v[ty * s.mapW + tx] === 1;
      if (!seen) continue;
      const until = s.tick + COUNTER_BATTERY_TICKS;
      const list = s.reveals ?? [];
      const at = list.findIndex(r => r[4] === o && (bat.shooter ? r[5] === bat.shooter : r[5] === 0 && dist(r[0], r[1], bat.x, bat.y) < 1.5));
      const entry: [number, number, number, number, number, number] = [bat.x, bat.y, COUNTER_BATTERY_RADIUS, until, o, bat.shooter];
      s.reveals = at >= 0 ? list.map((r, i) => (i === at ? entry : r)) : [...list, entry];
      if (o === 0 || isAlly(s, o, 0)) alarm(s, 'counterbattery', 'Counter-battery: enemy guns located and marked.', 150, 'info');
    }
  }
}

/** Point Defence: each emplacement off its cooldown shoots at the enemy projectile landing soonest within its radius. */
function pointDefence(s: GameState, units: Map<number, Unit>): void {
  let low: boolean[] | null = null;
  for (const b of s.buildings) {
    if (b.kind !== 'pointdefence' || b.hp <= 0) continue;
    low ??= sidesOf(s).map(o => powerOf(s, o).low);
    // Short of power, it recovers at half speed, as a turret's guns cycle.
    if (b.cooldown > 0 && (!low[b.owner] || s.tick % 2 === 0)) b.cooldown--;
    if (b.cooldown > 0 || s.tick - b.placedAt < 15 || !s.projectiles.length) continue;
    const spec = buildingSpecOf(s, b);
    const cx = b.x + spec.w / 2;
    const cy = b.y + spec.h / 2;
    let best: Projectile | null = null;
    for (const p of s.projectiles) {
      if (p.firedAt > s.tick || p.hitAt < s.tick || !isEnemy(s, b.owner, p.owner)) continue;
      if (dist(cx, cy, p.toX, p.toY) > POINT_DEFENCE_RADIUS || !interceptable(units, p)) continue;
      if (!best || p.hitAt < best.hitAt || (p.hitAt === best.hitAt && p.id < best.id)) best = p;
    }
    if (!best) continue;
    const r = next(s.rngSeed);
    s.rngSeed = r.seed;
    const down = r.value < POINT_DEFENCE_CHANCE;
    const span = Math.max(1, best.hitAt - best.firedAt);
    const f = Math.max(0, Math.min(1, (s.tick - best.firedAt) / span));
    const x = best.fromX + (best.toX - best.fromX) * f;
    const y = best.fromY + (best.toY - best.fromY) * f;
    const d = dist(cx, cy, x, y);
    if (d > 0.01) {
      b.tx = (x - cx) / d;
      b.ty = (y - cy) / d;
    }
    b.cooldown = POINT_DEFENCE_COOLDOWN;
    s.effects.push({ id: s.nextId++, kind: 'intercept', x, y, x2: cx, y2: cy, at: s.tick, size: down ? 1 : 0, weapon: best.weapon });
    if (!down) continue;
    const gone = best;
    // A Firebrand's incendiary takes the fire it would have left with it.
    s.projectiles = s.projectiles.filter(
      p => p !== gone && !(gone.weapon === 'flame' && p.weapon === 'flame' && p.shooter === gone.shooter && p.firedAt === gone.hitAt && p.toX === gone.toX && p.toY === gone.toY),
    );
    if (b.owner === 0) alarm(s, 'pointdefence', 'Point Defence shot down incoming fire.', 300, 'good');
  }
}

/**
 * Return fire: an idle Artillery (or Battleship) of a side with Counter-battery, on Guard, turns on a
 * battery revealed to its side within its reach, ahead of whatever else it was shooting at.
 */
function returnFire(s: GameState, units: Map<number, Unit>): void {
  const targets = new Map<Owner, Unit[]>();
  for (const r of s.reveals!) {
    if (!r[5]) continue;
    const t = units.get(r[5]);
    if (!t || t.hp <= 0 || !isEnemy(s, r[4] as Owner, t.owner)) continue;
    const list = targets.get(r[4] as Owner) ?? [];
    list.push(t);
    targets.set(r[4] as Owner, list);
  }
  if (!targets.size) return;
  const ids = new Set<number>();
  for (const list of targets.values()) for (const t of list) ids.add(t.id);
  for (const u of s.units) {
    const list = targets.get(u.owner);
    if (!list || u.hp <= 0 || u.stance !== 'guard' || u.order.type !== 'idle' || ids.has(u.engage)) continue;
    if (UNITS[u.kind].category === 'infantry' || UNITS[u.kind].category === 'air') continue;
    const w = weaponOf(s, u);
    if (!w || w.kind !== 'artillery') continue;
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const t of list) {
      const d = dist(u.x, u.y, t.x, t.y);
      if (d > w.range || d < (w.minRange ?? 0) || d >= bestD) continue;
      best = t;
      bestD = d;
    }
    if (best) u.engage = best.id;
  }
}
