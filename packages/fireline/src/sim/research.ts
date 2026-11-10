import {
  AIRFRAMES_HP,
  AIRFRAMES_REARM,
  COUNTERMEASURES_DAMAGE,
  CALIBRATION_DAMAGE,
  ENGINES_SPEED,
  PLATING_HP,
  REFINING_INCOME,
  UNITS,
  UPGRADES,
  type Owner,
  type UpgradeId,
} from './rules';
import { hasBuilding, log, maxHpOf, techAllowed } from './state';
import type { GameState, Unit } from './types';

/**
 * Research (fireline-round4-design.md, workstream A). A side with a Research Lab researches one
 * upgrade at a time: paid in full when started, refunded in full when cancelled, and making progress
 * like any queue (half speed while power is short, none while no Lab stands). A finished upgrade lasts
 * the rest of the battle. Its effect is applied where the number is read, never by rewriting a spec:
 *
 *  - plating: vehicles' full health (PLATING_HP), on every vehicle the side has and every new one;
 *  - calibration: every weapon's damage (CALIBRATION_DAMAGE), in `fire` (tick.ts) and the bombs (air.ts);
 *  - engines: vehicles' speed (ENGINES_SPEED), in the movement step (tick.ts);
 *  - refining: what each load of ore pays (REFINING_INCOME), at the refinery (tick.ts);
 *  - airframes: aircraft's full health (AIRFRAMES_HP) and their rearming time (AIRFRAMES_REARM, air.ts).
 *  - countermeasures: what flak and anti-air missiles do to the side's aircraft (COUNTERMEASURES_DAMAGE, tick.ts hurt).
 *
 * The query functions never change the state; the `do*` functions and `researchStep` work in place
 * on a state the reducer has already cloned.
 */

const isUpgrade = (v: unknown): v is UpgradeId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(UPGRADES, v);

/** True once this side has finished researching this upgrade. */
export function hasUpgrade(s: GameState, owner: Owner, id: UpgradeId): boolean {
  const u = s.players[owner]?.upgrades;
  return !!u && u.includes(id);
}

/** Why this side cannot start this upgrade now, or null if it can. Shared with the Research block. */
export function researchProblem(s: GameState, owner: Owner, id: UpgradeId): string | null {
  if (!isUpgrade(id)) return 'No such upgrade';
  const spec = UPGRADES[id];
  if (!techAllowed(s, owner, 'researchlab')) return 'Not in this battle';
  if (hasUpgrade(s, owner, id)) return 'Already researched';
  const p = s.players[owner];
  if (p.research) return p.research.id === id ? 'Researching' : 'Already researching';
  const missing = spec.requires.find(k => !hasBuilding(s, owner, k));
  if (missing) return missing === 'researchlab' ? 'Needs a Research Lab' : `Needs: ${missing}`;
  if (p.credits < spec.cost) return 'Not enough credits';
  return null;
}

export function canResearch(s: GameState, owner: Owner, id: UpgradeId): boolean {
  return researchProblem(s, owner, id) === null;
}

export function doResearch(s: GameState, owner: Owner, id: UpgradeId): void {
  const p = s.players[owner];
  p.credits -= UPGRADES[id].cost;
  p.research = { id, progress: 0 };
  if (owner === 0) log(s, `Researching ${UPGRADES[id].name}.`);
}

export function canCancelResearch(s: GameState, owner: Owner): boolean {
  return !!s.players[owner]?.research;
}

/** Stops the research under way and refunds it in full. */
export function doCancelResearch(s: GameState, owner: Owner): void {
  const p = s.players[owner];
  const r = p.research!;
  p.credits += UPGRADES[r.id].cost;
  p.research = null;
  if (owner === 0) log(s, `${UPGRADES[r.id].name} cancelled.`);
}

/** One tick of research for one side. `lowPower` halves the rate. */
export function researchStep(s: GameState, owner: Owner, lowPower: boolean): void {
  const p = s.players[owner];
  const r = p.research;
  if (!r) return;
  if (!hasBuilding(s, owner, 'researchlab')) return; // Paused until a Lab stands again.
  const total = UPGRADES[r.id].ticks;
  r.progress = Math.min(total, r.progress + (lowPower ? 0.5 : 1));
  if (r.progress < total) return;
  p.upgrades = [...(p.upgrades ?? []), r.id];
  p.research = null;
  // Health upgrades reach every unit the side already has, keeping the damage each has taken.
  for (const u of s.units) if (u.owner === owner && u.hp > 0) raiseHealth(u, hpMulFor(r.id, u));
  if (owner === 0) log(s, `${UPGRADES[r.id].name} researched.`, 'good');
}

/** What one upgrade does to this unit's full health (1 for none). */
function hpMulFor(id: UpgradeId, u: Unit): number {
  const cat = UNITS[u.kind].category;
  if (id === 'plating' && cat === 'vehicle') return PLATING_HP;
  if (id === 'airframes' && cat === 'air') return AIRFRAMES_HP;
  return 1;
}

function raiseHealth(u: Unit, mul: number): void {
  if (mul === 1) return;
  const before = maxHpOf(u);
  const after = Math.max(1, Math.round(before * mul));
  u.maxHp = after;
  u.hp = Math.min(after, u.hp + (after - before));
}

/** A unit just made: full health raised by whatever its side has researched. */
export function upgradeNewUnit(s: GameState, u: Unit): void {
  const ups = s.players[u.owner]?.upgrades;
  if (!ups || !ups.length) return;
  for (const id of ups) {
    const mul = hpMulFor(id, u);
    if (mul === 1) continue;
    u.maxHp = Math.max(1, Math.round(maxHpOf(u) * mul));
    u.hp = u.maxHp;
  }
}

/** Multiplier on every weapon this side fires. */
export const damageMulOf = (s: GameState, owner: Owner): number => (hasUpgrade(s, owner, 'calibration') ? CALIBRATION_DAMAGE : 1);
/** Multiplier on this side's vehicles' speed. */
export const vehicleSpeedOf = (s: GameState, owner: Owner): number => (hasUpgrade(s, owner, 'engines') ? ENGINES_SPEED : 1);
/** Multiplier on what this side's ore pays. */
export const incomeMulOf = (s: GameState, owner: Owner): number => (hasUpgrade(s, owner, 'refining') ? REFINING_INCOME : 1);
/** Multiplier on what anti-air weapons (flak, anti-air missiles) do to this side's aircraft (Countermeasures). */
export const antiAirTakenMulOf = (s: GameState, owner: Owner): number => (hasUpgrade(s, owner, 'countermeasures') ? COUNTERMEASURES_DAMAGE : 1);
/** Multiplier on this side's aircraft's rearming time. */
export const rearmMulOf = (s: GameState, owner: Owner): number => (hasUpgrade(s, owner, 'airframes') ? AIRFRAMES_REARM : 1);

/** Repairs a player's research fields from a save: unknown upgrades dropped, junk research cleared. */
export function migrateResearch(p: { upgrades?: unknown; research?: unknown }): { upgrades?: UpgradeId[]; research?: { id: UpgradeId; progress: number } | null } {
  const out: { upgrades?: UpgradeId[]; research?: { id: UpgradeId; progress: number } | null } = {};
  if (p.upgrades !== undefined) {
    const list = Array.isArray(p.upgrades) ? p.upgrades.filter(isUpgrade) : [];
    out.upgrades = list.filter((id, i) => list.indexOf(id) === i);
  }
  if (p.research !== undefined) {
    const r = p.research as { id?: unknown; progress?: unknown } | null;
    out.research =
      r && typeof r === 'object' && isUpgrade(r.id) && Number.isFinite(r.progress) && (r.progress as number) >= 0
        ? { id: r.id, progress: Math.min(UPGRADES[r.id].ticks, r.progress as number) }
        : null;
  }
  return out;
}
