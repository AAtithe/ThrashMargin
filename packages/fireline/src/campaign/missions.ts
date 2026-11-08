import type { MissionSpec } from '../sim/types';

/**
 * The campaign, in order. CONTRACT STUB: written by the campaign workstream.
 * See fireline-campaign-design.md for the arc and each mission's intent.
 */
export const MISSIONS: MissionSpec[] = [];

export function missionById(id: string): MissionSpec | undefined {
  return MISSIONS.find(m => m.id === id);
}
