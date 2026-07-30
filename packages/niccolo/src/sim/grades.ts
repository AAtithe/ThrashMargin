import type { Cargo, GradeId, Vessel } from './types';

/**
 * Quality grades — the first deeper-trading feature after Phase 16's price causality (design
 * workflow's confirmed order: causality -> grades -> warehousing -> forwards). Piloted on cloth
 * and silk only, the game's two existing luxury goods.
 *
 * `common` is deliberately never stored — a lot's `common` quantity is always derived as
 * `cargo[goodId]` minus its `fine`/`excellent` units (see `Vessel.cargoGrades`'s own doc comment).
 * This means every non-pilot good, and every save from before this feature existed, is correctly
 * and automatically "entirely common" with zero migration and zero special-casing at read sites.
 *
 * The economics: buying a higher grade costs a modest premium at every city, and selling one back
 * at an ordinary city recovers exactly that same premium (a wash — grade alone is never a losing
 * trade, just not obviously winning either). A `qualityMarket` city (currently London for cloth,
 * Geneva for silk — already each good's single highest base-price city) pays a materially better
 * premium instead. The only real profit in grade comes from routing it to the city that actually
 * wants it, not from the grade itself.
 */
export const PILOT_GOODS = ['cloth', 'silk'];

export function isPilotGood(goodId: string): boolean {
  return PILOT_GOODS.includes(goodId);
}

const BUY_MULTIPLIER: Record<GradeId, number> = { common: 1, fine: 1.12, excellent: 1.28 };
const SELL_MULTIPLIER_ORDINARY: Record<GradeId, number> = BUY_MULTIPLIER;
const SELL_MULTIPLIER_QUALITY_MARKET: Record<GradeId, number> = { common: 1, fine: 1.35, excellent: 1.75 };

export function gradeBuyMultiplier(grade: GradeId): number {
  return BUY_MULTIPLIER[grade];
}

export function gradeSellMultiplier(grade: GradeId, qualityMarket: boolean): number {
  return (qualityMarket ? SELL_MULTIPLIER_QUALITY_MARKET : SELL_MULTIPLIER_ORDINARY)[grade];
}

/** Units of `goodId` held at the two explicitly-tracked grades (never includes `common`). */
function nonCommonHeld(cargoGrades: Vessel['cargoGrades'], goodId: string): number {
  const g = cargoGrades?.[goodId];
  return (g?.fine ?? 0) + (g?.excellent ?? 0);
}

/** Units of `goodId` held at a specific grade — `common` is derived, never stored. Safe to call
 * for any good, graded or not: a non-pilot good simply always resolves to `cargo[goodId]` common. */
export function gradeHeld(cargo: Cargo, cargoGrades: Vessel['cargoGrades'], goodId: string, grade: GradeId): number {
  const total = cargo[goodId] ?? 0;
  if (grade === 'common') return Math.max(0, total - nonCommonHeld(cargoGrades, goodId));
  return cargoGrades?.[goodId]?.[grade] ?? 0;
}

/** A pilot good's full held breakdown, `common` last-computed so it always reflects the true
 * remainder rather than trusting a stale stored value. Used by the UI to show "8 common, 3 fine". */
export function gradeBreakdown(cargo: Cargo, cargoGrades: Vessel['cargoGrades'], goodId: string): Record<GradeId, number> {
  return {
    fine: gradeHeld(cargo, cargoGrades, goodId, 'fine'),
    excellent: gradeHeld(cargo, cargoGrades, goodId, 'excellent'),
    common: gradeHeld(cargo, cargoGrades, goodId, 'common'),
  };
}

/** Records a purchase at a specific grade. A `common` purchase needs no bookkeeping at all — it's
 * absorbed entirely into the derived remainder the moment `cargo[goodId]` grows. */
export function addGrade(
  cargoGrades: Vessel['cargoGrades'],
  goodId: string,
  grade: GradeId,
  quantity: number,
): Vessel['cargoGrades'] {
  if (grade === 'common') return cargoGrades;
  const existing = cargoGrades?.[goodId] ?? {};
  return {
    ...cargoGrades,
    [goodId]: { ...existing, [grade]: (existing[grade] ?? 0) + quantity },
  };
}

/** Records a sale at a specific grade — the inverse of `addGrade`. Caller is responsible for
 * checking `gradeHeld` first; this never goes negative but silently floors at 0 rather than
 * throwing, since `reconcileVesselCargoGrades` (weekly loss events) is the only other writer and
 * could in principle race a hand-authored edge case. */
export function removeGrade(
  cargoGrades: Vessel['cargoGrades'],
  goodId: string,
  grade: GradeId,
  quantity: number,
): Vessel['cargoGrades'] {
  if (grade === 'common') return cargoGrades;
  const existing = cargoGrades?.[goodId] ?? {};
  return {
    ...cargoGrades,
    [goodId]: { ...existing, [grade]: Math.max(0, (existing[grade] ?? 0) - quantity) },
  };
}

/**
 * Safety net for the three *ambient, non-player* cargo reductions (storm/piracy loss in
 * `insurance.ts`, sabotage in `houses.ts`, forced liquidation in `credit.ts`) — none of them know
 * about grades, and none need to: they just remove `n` units of a good from `cargo` however they
 * always have. But if that good is a pilot good with a graded lot aboard, `cargoGrades` could then
 * claim more `fine`/`excellent` units than `cargo[goodId]` actually holds any more — which would
 * let `sellGood` oversell a grade that no longer physically exists. Called once, centrally, at the
 * end of `advanceWeek` (the only place all three run) rather than patched into each of those three
 * unrelated files: clamps each pilot good's `fine`+`excellent` total down to `cargo[goodId]` if it
 * would otherwise exceed it, scaled proportionally so no single tier is arbitrarily favored.
 */
export function reconcileVesselCargoGrades(vessel: Vessel): Vessel {
  if (!vessel.cargoGrades) return vessel;
  let cargoGrades = vessel.cargoGrades;
  let changed = false;
  for (const goodId of Object.keys(cargoGrades)) {
    const total = vessel.cargo[goodId] ?? 0;
    const held = nonCommonHeld(cargoGrades, goodId);
    if (held <= total) continue;
    changed = true;
    const scale = total / held;
    const fine = Math.floor((cargoGrades[goodId].fine ?? 0) * scale);
    const excellent = Math.floor((cargoGrades[goodId].excellent ?? 0) * scale);
    cargoGrades = { ...cargoGrades, [goodId]: { fine, excellent } };
  }
  return changed ? { ...vessel, cargoGrades } : vessel;
}
