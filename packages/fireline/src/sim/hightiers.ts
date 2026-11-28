/**
 * High tiers (2026-11-28; setup.highTiers, fireline-design.md build log). The rules of the eight
 * units and two structures that tier three's additions, tier four and tier five bring:
 *
 *  - Mechanised Infantry: the squad climbs out once the carrier has stood still DISMOUNT_TICKS
 *    (`Unit.settled`, counted in the units step and cleared by any step it takes), and then fights
 *    with the dismounted weapon (harder, a tile further) and takes DISMOUNT_TAKEN.
 *  - Rotary Cannon: every shot in a run cuts the next reload by SPIN_STEP, to SPIN_MAX shots
 *    (`Unit.spin`); out of a fight it loses a shot of spin every SPIN_DECAY_TICKS.
 *  - Atomic Tank: no fuel upkeep (upkeep.ts); destroyed, its reactor breaches (tick.ts, breaches).
 *  - Reactor Complex: destroyed, it melts down (the same pass, wider and harder).
 *  - Strike Drone: dives into its target, so its one shot destroys it (air.ts).
 *  - Stratos: untouchable (never targeted, hit or splashed), and enemies within DESIGNATE_RADIUS of
 *    one take DESIGNATE_DAMAGE from its side's weapons. One at a time (STRATOS_MAX).
 *  - Battlefield Command: every unit its side's producers turn out arrives a Veteran.
 *
 * Pure: no dice, no clock. Every rule here reads only the state it is given; nothing is cached
 * across battles except the dismounted weapons, which are constant data.
 */
import {
  DESIGNATE_DAMAGE,
  DESIGNATE_RADIUS,
  DISMOUNT_DAMAGE,
  DISMOUNT_RANGE,
  DISMOUNT_TICKS,
  FIELD_PROMOTION_VET,
  STRATOS_MAX,
  UNITS,
  type Owner,
  type UnitKind,
  type Weapon,
} from './rules';
import type { GameState, Unit } from './types';

/** True for a unit nothing can reach (the Stratos). */
export const isUntouchable = (u: Unit): boolean => UNITS[u.kind].untouchable === true;

/** True once a Mechanised Infantry squad is out of its carrier. */
export const isDismounted = (u: Unit): boolean => UNITS[u.kind].dismount === true && (u.settled ?? 0) >= DISMOUNT_TICKS;

const dismounted = new Map<Weapon, Weapon>();
/** The weapon a dismounted squad fights with: built once per weapon object, so a unit's weapon is stable tick to tick. */
export function dismountedWeapon(w: Weapon): Weapon {
  let d = dismounted.get(w);
  if (!d) {
    d = { ...w, damage: Math.round(w.damage * DISMOUNT_DAMAGE), range: w.range + DISMOUNT_RANGE };
    dismounted.set(w, d);
  }
  return d;
}

/**
 * What `attacker`'s weapons do to something standing at (x, y): DESIGNATE_DAMAGE when one of its
 * Stratos is within DESIGNATE_RADIUS, else 1. Two never stack.
 */
export function designateMul(s: GameState, attacker: Owner, x: number, y: number): number {
  if (!s.setup?.highTiers) return 1;
  const r2 = DESIGNATE_RADIUS * DESIGNATE_RADIUS;
  for (const u of s.units) {
    if (u.owner !== attacker || u.hp <= 0 || !UNITS[u.kind].designator) continue;
    const dx = u.x - x;
    const dy = u.y - y;
    if (dx * dx + dy * dy <= r2) return DESIGNATE_DAMAGE;
  }
  return 1;
}

/** Stratos this side has aloft and queued. */
export function stratosCount(s: GameState, owner: Owner): number {
  let n = 0;
  for (const u of s.units) if (u.owner === owner && u.kind === 'stratos' && u.hp > 0) n++;
  for (const q of s.players[owner].queues.air ?? []) if (q.kind === 'stratos') n++;
  return n;
}

/** True while this side may queue another of this kind (only the Stratos is capped). */
export const highTierQueueable = (s: GameState, owner: Owner, kind: UnitKind): boolean => kind !== 'stratos' || stratosCount(s, owner) < STRATOS_MAX;

/** Battlefield Command's field promotion: the rank a new unit of this side starts at. */
export function promotionFor(s: GameState, owner: Owner): number {
  if (!s.setup?.highTiers) return 0;
  return s.buildings.some(b => b.owner === owner && b.kind === 'battlecommand' && b.hp > 0) ? FIELD_PROMOTION_VET : 0;
}
