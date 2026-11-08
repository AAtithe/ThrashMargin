import type { HeroKind } from '../sim/rules';
import type { MissionContext, MissionOutcome, MissionSpec, Perks } from '../sim/types';
import type { CampaignState, PerkId, PerkSpec } from './types';

/**
 * Commander career, skill tree and hero roster: pure functions over CampaignState.
 * CONTRACT STUBS: implemented by the campaign workstream. See fireline-campaign-design.md.
 */

const todo = (name: string): never => {
  throw new Error(`Not implemented yet: campaign/progression.ts ${name}`);
};

/** Rank names, lowest first, and the total xp each needs. */
export const RANKS: { name: string; xp: number }[] = [];
export const PERKS: PerkSpec[] = [];
/** Neutral perks: what a skirmish or a fresh campaign applies. */
export const NO_PERKS: Perks = { harvestMul: 1, buildSpeedMul: 1, costMul: 1, unitHpMul: 1, powerCooldownMul: 1, extraStartCredits: 0 };

export function newCampaign(_commanderName: string): CampaignState {
  return todo('newCampaign');
}
/** Index into RANKS for this much xp. */
export function rankFor(_xp: number): number {
  return todo('rankFor');
}
export function perkModifiers(_c: CampaignState): Perks {
  return todo('perkModifiers');
}
/** Why this perk cannot be bought now, or null if it can. */
export function perkProblem(_c: CampaignState, _perk: PerkId): string | null {
  return todo('perkProblem');
}
/** Returns a new state with the perk bought; returns the same object if it cannot be bought. */
export function buyPerk(_c: CampaignState, _perk: PerkId): CampaignState {
  return todo('buyPerk');
}
/** True when this mission can be played (the first, or one after a won mission). */
export function missionUnlocked(_c: CampaignState, _missionId: string): boolean {
  return todo('missionUnlocked');
}
/** Heroes this mission will field: wanted by the spec and unlocked in the campaign. */
export function heroesFor(_c: CampaignState, _spec: MissionSpec): HeroKind[] {
  return todo('heroesFor');
}
export function missionContext(_c: CampaignState, _spec: MissionSpec, _id: string, _createdAt: number): MissionContext {
  return todo('missionContext');
}
/** Folds a finished mission into the campaign: xp, rank-ups and skill points, stars, heroes, unlocks. */
export function applyOutcome(_c: CampaignState, _spec: MissionSpec, _outcome: MissionOutcome): CampaignState {
  return todo('applyOutcome');
}
