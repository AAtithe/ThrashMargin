import type { HeroKind, Owner, SupportPower } from './rules';
import type { GameState, MissionContext, MissionOutcome, MissionSpec, ObjectiveSpec, Unit } from './types';

/**
 * Missions, heroes, stealth and support powers in the simulation.
 * CONTRACT STUBS: implemented by the simulation workstream. Pure, like the rest of sim/.
 */

const todo = (name: string): never => {
  throw new Error(`Not implemented yet: sim/mission.ts ${name}`);
};

/** A fresh battle set up from a mission spec and the campaign's context. */
export function createMissionState(_spec: MissionSpec, _ctx: MissionContext): GameState {
  return todo('createMissionState');
}
/** The outcome once s.mission.result is set; null while the mission is still running. */
export function missionOutcome(_s: GameState): MissionOutcome | null {
  return todo('missionOutcome');
}
/** Player-facing words for an objective, e.g. "Destroy 2 enemy Gun Turrets". */
export function objectiveLabel(_o: ObjectiveSpec): string {
  return todo('objectiveLabel');
}
/** Whether side `by` can currently see this unit (Spies are hidden unless detected). */
export function isDetected(_s: GameState, _u: Unit, _by: Owner): boolean {
  return todo('isDetected');
}
/** Why this hero cannot use its ability on that target now, or null if it can. */
export function abilityProblem(_s: GameState, _owner: Owner, _heroId: number, _target?: number): string | null {
  return todo('abilityProblem');
}
/** Why side `owner` cannot call this power at (x, y) now, or null if it can. */
export function powerProblem(_s: GameState, _owner: Owner, _power: SupportPower, _x: number, _y: number): string | null {
  return todo('powerProblem');
}
/** The hero of this kind on side `owner`, if alive. */
export function heroUnit(_s: GameState, _owner: Owner, _kind: HeroKind): Unit | undefined {
  return todo('heroUnit');
}
