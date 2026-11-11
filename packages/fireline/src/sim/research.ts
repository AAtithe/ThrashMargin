import {
  AIRFRAMES_HP,
  AIRFRAMES_REARM,
  ASSEMBLY_RATE,
  AUTOLOADER_RELOAD,
  AVIONICS_SPEED,
  CALIBRATION_DAMAGE,
  COMPOSITE_KINDS,
  COMPOSITE_TAKEN,
  ENGINES2_SPEED,
  ENGINES_SPEED,
  HARDENED_KINDS,
  HARDENED_TAKEN,
  HEAT_DAMAGE,
  HEAT_KINDS,
  HE_SPLASH,
  LINES,
  LINE_ORDER,
  MOTORISED_SPEED,
  MUNITIONS_DAMAGE,
  PLATING2_HP,
  PLATING_HP,
  REACTIVE_KINDS,
  REACTIVE_TAKEN,
  REFINING2_INCOME,
  REFINING_INCOME,
  RESEARCH_COST_STEP,
  GAME_PACES,
  SMOKE_TAKEN,
  UNITS,
  UPGRADES,
  UPGRADE_LINE,
  isClassicUpgrade,
  type Category,
  type LineId,
  type Owner,
  type ResearchMode,
  type UpgradeId,
  type WeaponKind,
} from './rules';
import { hasBuilding, log, maxHpOf, researchModeOf, paceOf, techAllowed } from './state';
import type { GameState, PlayerState, Unit } from './types';

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
 *
 * The query functions never change the state; the `do*` functions and `researchStep` work in place
 * on a state the reducer has already cloned.
 */

const isUpgrade = (v: unknown): v is UpgradeId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(UPGRADES, v);
const isLine = (v: unknown): v is LineId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(LINES, v);

/** True once this side has finished researching this upgrade. */
export function hasUpgrade(s: GameState, owner: Owner, id: UpgradeId): boolean {
  const u = s.players[owner]?.upgrades;
  return !!u && u.includes(id);
}

/**
 * What this upgrade costs this side in this battle (round 6). Classic research, and every battle
 * whose size leaves research at full price ('quick'): UPGRADES[id].cost exactly, with no arithmetic.
 */
export function researchCostOf(s: GameState, id: UpgradeId): number {
  const base = UPGRADES[id].cost;
  if (researchModeOf(s) !== 'lines') return base;
  const m = GAME_PACES[paceOf(s)].researchCost[UPGRADE_LINE[id].mark - 1];
  if (m === 1) return base;
  return Math.max(RESEARCH_COST_STEP, Math.round((base * m) / RESEARCH_COST_STEP) * RESEARCH_COST_STEP);
}

/** How many ticks of progress this upgrade takes in this battle (round 6). Classic and 'quick': UPGRADES[id].ticks exactly. */
export function researchTicksOf(s: GameState, id: UpgradeId): number {
  const base = UPGRADES[id].ticks;
  if (researchModeOf(s) !== 'lines') return base;
  const m = GAME_PACES[paceOf(s)].researchTicks[UPGRADE_LINE[id].mark - 1];
  if (m === 1) return base;
  return Math.max(1, Math.round(base * m));
}

/** Why this side cannot start this upgrade now, or null if it can. Shared with the Research block. */
export function researchProblem(s: GameState, owner: Owner, id: UpgradeId): string | null {
  if (!isUpgrade(id)) return 'No such upgrade';
  const spec = UPGRADES[id];
  const lines = researchModeOf(s) === 'lines';
  if (!techAllowed(s, owner, 'researchlab') || (!lines && !isClassicUpgrade(id))) return 'Not in this battle';
  if (hasUpgrade(s, owner, id)) return 'Already researched';
  const p = s.players[owner];
  if (lines) {
    // Development lines: marks in order; a Mk III branch only once its line's doctrine names it.
    const { line, mark } = UPGRADE_LINE[id];
    const l = LINES[line];
    if (mark === 2 && !hasUpgrade(s, owner, l.marks[0])) return 'Needs Mk I';
    if (mark === 3) {
      if (!hasUpgrade(s, owner, l.marks[1])) return 'Needs Mk II';
      const d = p.doctrines?.[line];
      if (!d) return 'Choose a doctrine first';
      if (d !== id) return 'Doctrine closed';
    }
  }
  if (p.research) return p.research.id === id ? 'Researching' : 'Already researching';
  const missing = spec.requires.find(k => !hasBuilding(s, owner, k));
  if (missing) return missing === 'researchlab' ? 'Needs a Research Lab' : `Needs: ${missing}`;
  if (p.credits < researchCostOf(s, id)) return 'Not enough credits';
  return null;
}

export function canResearch(s: GameState, owner: Owner, id: UpgradeId): boolean {
  return researchProblem(s, owner, id) === null;
}

export function doResearch(s: GameState, owner: Owner, id: UpgradeId): void {
  const p = s.players[owner];
  p.credits -= researchCostOf(s, id);
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
  p.credits += researchCostOf(s, r.id);
  p.research = null;
  if (owner === 0) log(s, `${UPGRADES[r.id].name} cancelled.`);
}

/** One tick of research for one side. `lowPower` halves the rate. */
export function researchStep(s: GameState, owner: Owner, lowPower: boolean): void {
  const p = s.players[owner];
  const r = p.research;
  if (!r) return;
  if (!hasBuilding(s, owner, 'researchlab')) return; // Paused until a Lab stands again.
  const total = researchTicksOf(s, r.id);
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
  if (id === 'plating2' && cat === 'vehicle') return PLATING2_HP;
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
/** Multiplier on this side's vehicles' speed (Mk II replaces Mk I). */
export const vehicleSpeedOf = (s: GameState, owner: Owner): number =>
  hasUpgrade(s, owner, 'engines2') ? ENGINES2_SPEED : hasUpgrade(s, owner, 'engines') ? ENGINES_SPEED : 1;
/** Multiplier on what this side's ore pays (Mk II replaces Mk I). */
export const incomeMulOf = (s: GameState, owner: Owner): number =>
  hasUpgrade(s, owner, 'refining2') ? REFINING2_INCOME : hasUpgrade(s, owner, 'refining') ? REFINING_INCOME : 1;
/** Multiplier on this side's aircraft's rearming time. */
export const rearmMulOf = (s: GameState, owner: Owner): number => (hasUpgrade(s, owner, 'airframes') ? AIRFRAMES_REARM : 1);

// ---- Development lines (round 5; fireline-round5b-design.md) ----
// Every query below is 'classic'-safe: a classic side can never hold a non-classic id.

/** Multiplier on this side's infantry's speed (Motorised infantry). */
export const infantrySpeedOf = (s: GameState, owner: Owner): number => (hasUpgrade(s, owner, 'motorised') ? MOTORISED_SPEED : 1);
/** Multiplier on this side's queue progress for a category (Assembly lines: every queue but the building one). */
export const buildRateOf = (s: GameState, owner: Owner, cat: Category): number =>
  cat !== 'building' && hasUpgrade(s, owner, 'assembly') ? ASSEMBLY_RATE : 1;
/** Multiplier on this unit's reload after a shot (Autoloaders: ground vehicles only). */
export const reloadMulOf = (s: GameState, u: Unit): number =>
  UNITS[u.kind].category === 'vehicle' && hasUpgrade(s, u.owner, 'autoloaders') ? AUTOLOADER_RELOAD : 1;
/** Multiplier on this weapon kind's damage for this side (HEAT rounds), beside calibration. */
export const kindDamageMulOf = (s: GameState, owner: Owner, kind: WeaponKind): number =>
  HEAT_KINDS.includes(kind) && hasUpgrade(s, owner, 'heat') ? HEAT_DAMAGE : 1;
/** Multiplier on every splash radius this side fires (High-explosive fill). */
export const splashMulOf = (s: GameState, owner: Owner): number => (hasUpgrade(s, owner, 'highexplosive') ? HE_SPLASH : 1);
/** Multiplier on this side's aircraft's speed (Avionics). */
export const airSpeedOf = (s: GameState, owner: Owner): number => (hasUpgrade(s, owner, 'avionics') ? AVIONICS_SPEED : 1);
/** Multiplier on this side's aircraft weapons (Heavy munitions). */
export const airDamageMulOf = (s: GameState, owner: Owner): number => (hasUpgrade(s, owner, 'munitions') ? MUNITIONS_DAMAGE : 1);
/** True when every vehicle of this side repairs out of combat as an elite unit does (Field workshops). */
export const fieldRepairOf = (s: GameState, owner: Owner): boolean => hasUpgrade(s, owner, 'fieldrepair');
/** True when this side is paid for enemy vehicles and aircraft it destroys (Salvage crews). */
export const salvageOf = (s: GameState, owner: Owner): boolean => hasUpgrade(s, owner, 'salvage');

/** Damage taken by this unit from this weapon kind: armour forks, cockpits, smoke. Product of all that apply. */
export function damageTakenMul(s: GameState, u: Unit, kind: WeaponKind): number {
  let mul = 1;
  const cat = UNITS[u.kind].category;
  const ups = s.players[u.owner]?.upgrades;
  if (ups && ups.length) {
    if (cat === 'vehicle') {
      if (REACTIVE_KINDS.includes(kind) && ups.includes('reactive')) mul *= REACTIVE_TAKEN;
      if (COMPOSITE_KINDS.includes(kind) && ups.includes('composite')) mul *= COMPOSITE_TAKEN;
    } else if (cat === 'air') {
      if (HARDENED_KINDS.includes(kind) && ups.includes('hardened')) mul *= HARDENED_TAKEN;
    }
  }
  if (u.modules && u.modules.includes('smoke') && u.order.type === 'move') mul *= SMOKE_TAKEN;
  return mul;
}

/** The branch this side has committed this line to, or null. */
export const doctrineOf = (s: GameState, owner: Owner, line: LineId): UpgradeId | null => s.players[owner]?.doctrines?.[line] ?? null;

/** Why this side cannot commit this line to this branch, or null. No Lab needed: it is a decision, not work. */
export function doctrineProblem(s: GameState, owner: Owner, line: LineId, branch: UpgradeId): string | null {
  if (researchModeOf(s) !== 'lines' || !isLine(line) || !techAllowed(s, owner, 'researchlab')) return 'Not in this battle';
  const l = LINES[line];
  if (branch !== l.fork[0] && branch !== l.fork[1]) return 'No such doctrine';
  if (s.players[owner].doctrines?.[line]) return 'Already chosen';
  if (!hasUpgrade(s, owner, l.marks[1])) return 'Needs Mk II';
  return null;
}

/** Commits the line to the branch: free and permanent. */
export function doDoctrine(s: GameState, owner: Owner, line: LineId, branch: UpgradeId): void {
  const p = s.players[owner];
  p.doctrines = { ...(p.doctrines ?? {}), [line]: branch };
  if (owner === 0) log(s, `${LINES[line].name} doctrine: ${UPGRADES[branch].name}.`);
}

type ResearchFields = Pick<PlayerState, 'upgrades' | 'research' | 'doctrines'>;

/**
 * Repairs a player's research fields from a save: unknown upgrades dropped, junk research cleared.
 * In 'classic' every development-lines id is dropped too; in 'lines' doctrines are checked and a
 * branch that is not its line's doctrine is dropped. `doctrines: null` in the result means delete.
 */
export function migrateResearch(
  p: { upgrades?: unknown; research?: unknown; doctrines?: unknown },
  mode: ResearchMode = 'classic',
  ticksOf: (id: UpgradeId) => number = id => UPGRADES[id].ticks,
): { upgrades?: UpgradeId[]; research?: { id: UpgradeId; progress: number } | null; doctrines?: ResearchFields['doctrines'] | null } {
  const out: { upgrades?: UpgradeId[]; research?: { id: UpgradeId; progress: number } | null; doctrines?: ResearchFields['doctrines'] | null } = {};
  const doctrines: Partial<Record<LineId, UpgradeId>> = {};
  if (mode === 'lines' && p.doctrines && typeof p.doctrines === 'object') {
    const raw = p.doctrines as Record<string, unknown>;
    for (const line of LINE_ORDER) {
      const v = raw[line];
      if (isUpgrade(v) && (LINES[line].fork[0] === v || LINES[line].fork[1] === v)) doctrines[line] = v;
    }
  }
  // Allowed in this mode: classic ids only in 'classic'; in 'lines', a branch only when it is its line's doctrine.
  const allowed = (id: UpgradeId): boolean => {
    if (mode === 'classic') return isClassicUpgrade(id);
    const { line, mark } = UPGRADE_LINE[id];
    return mark !== 3 || doctrines[line] === id;
  };
  if (p.upgrades !== undefined) {
    const list = Array.isArray(p.upgrades) ? p.upgrades.filter(isUpgrade).filter(allowed) : [];
    out.upgrades = list.filter((id, i) => list.indexOf(id) === i);
  }
  if (p.research !== undefined) {
    const r = p.research as { id?: unknown; progress?: unknown } | null;
    out.research =
      r && typeof r === 'object' && isUpgrade(r.id) && allowed(r.id) && Number.isFinite(r.progress) && (r.progress as number) >= 0
        ? { id: r.id, progress: Math.min(ticksOf(r.id), r.progress as number) }
        : null;
  }
  if (p.doctrines !== undefined) out.doctrines = mode === 'lines' && Object.keys(doctrines).length ? doctrines : null;
  return out;
}
