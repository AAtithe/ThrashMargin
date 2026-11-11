import {
  canAttack,
  canCancel,
  canHarvest,
  canMove,
  canPlace,
  canQueue,
  canRally,
  canRepair,
  canSell,
  canStance,
  canStop,
  doAttack,
  doCancel,
  doHarvest,
  doMove,
  doPlace,
  doQueue,
  doRally,
  doRepair,
  doSell,
  doStance,
  doStop,
} from './commands';
import { deployProblem, doDeploy, doUndeploy, undeployProblem } from './engineering';
import { abilityProblem, doAbility, doPower, powerProblem } from './mission';
import { canCancelResearch, canResearch, doCancelResearch, doResearch } from './research';
import { cloneState } from './state';
import { step } from './tick';
import type { GameAction, GameState } from './types';

/** Most ticks one action may advance. The client sends one or two at a time. */
export const MAX_TICKS_PER_ACTION = 600;

const ids = (v: unknown): number[] => (Array.isArray(v) ? v.filter(n => Number.isInteger(n)) : []);

// round6:D. Formations and squads: the move-in-formation and 'formation' cases' imports (fireline-round6-design.md).
import { canFormation, canFormationMove, doFormation, doFormationMove } from './commands';

/**
 * The reducer. Orders are always side 0's (the player's); the computer gives its orders from
 * inside the tick. An illegal action returns the very same state object, which the client uses to
 * skip a pointless save and the harness uses to assert a rejection. The state passed in is never
 * modified: a legal action clones it once and works on the clone.
 */
export function processAction(s: GameState, a: GameAction): GameState {
  if (s.winner !== null) return s;
  switch (a.type) {
    case 'tick': {
      const n = a.n ?? 1;
      if (!Number.isInteger(n) || n < 1 || n > MAX_TICKS_PER_ACTION) return s;
      const c = cloneState(s);
      for (let i = 0; i < n && c.winner === null; i++) step(c);
      return c;
    }
    case 'move': {
      // round6:D begin. Formations and squads: a move carrying a formation is refused until D
      // validates the shape (FORMATION_SHAPES) and passes it to doMove. Without one: exactly as before.
      if (a.formation !== undefined) {
        if (!canFormationMove(s, 0, ids(a.ids), a.x, a.y, !!a.queue, a.formation)) return s;
        const c = cloneState(s);
        doFormationMove(c, 0, ids(a.ids), a.x, a.y, !!a.attackMove, a.formation, !!a.queue);
        return c;
      }
      // round6:D end.
      if (!canMove(s, 0, ids(a.ids), a.x, a.y, !!a.queue)) return s;
      const c = cloneState(s);
      doMove(c, 0, ids(a.ids), a.x, a.y, !!a.attackMove, !!a.queue);
      return c;
    }
    case 'attack': {
      if (!canAttack(s, 0, ids(a.ids), a.target, !!a.queue)) return s;
      const c = cloneState(s);
      doAttack(c, 0, ids(a.ids), a.target, !!a.queue);
      return c;
    }
    case 'stance': {
      if (!canStance(s, 0, ids(a.ids), a.stance)) return s;
      const c = cloneState(s);
      doStance(c, 0, ids(a.ids), a.stance);
      return c;
    }
    case 'stop': {
      if (!canStop(s, 0, ids(a.ids))) return s;
      const c = cloneState(s);
      doStop(c, 0, ids(a.ids));
      return c;
    }
    case 'harvest': {
      if (!canHarvest(s, 0, ids(a.ids), a.tile, a.refinery)) return s;
      const c = cloneState(s);
      doHarvest(c, 0, ids(a.ids), a.tile, a.refinery);
      return c;
    }
    case 'queue': {
      if (!canQueue(s, 0, a.category, a.kind)) return s;
      const c = cloneState(s);
      doQueue(c, 0, a.category, a.kind);
      return c;
    }
    case 'cancel': {
      if (!canCancel(s, 0, a.category, a.kind)) return s;
      const c = cloneState(s);
      doCancel(c, 0, a.category, a.kind);
      return c;
    }
    case 'place': {
      if (!canPlace(s, 0, a.kind, a.x, a.y)) return s;
      const c = cloneState(s);
      doPlace(c, 0, a.kind, a.x, a.y);
      return c;
    }
    case 'sell': {
      if (!canSell(s, 0, a.id)) return s;
      const c = cloneState(s);
      doSell(c, 0, a.id);
      return c;
    }
    case 'repair': {
      if (!canRepair(s, 0, a.id)) return s;
      const c = cloneState(s);
      doRepair(c, a.id);
      return c;
    }
    case 'rally': {
      if (!canRally(s, 0, a.id, a.x, a.y)) return s;
      const c = cloneState(s);
      doRally(c, a.id, a.x, a.y);
      return c;
    }
    case 'ability': {
      const target = a.target === undefined ? undefined : a.target;
      if (!Number.isInteger(a.id) || (target !== undefined && !Number.isInteger(target))) return s;
      if (abilityProblem(s, 0, a.id, target) !== null) return s;
      const c = cloneState(s);
      doAbility(c, 0, a.id, target);
      return c;
    }
    case 'power': {
      if (typeof a.power !== 'string' || powerProblem(s, 0, a.power, a.x, a.y) !== null) return s;
      const c = cloneState(s);
      doPower(c, 0, a.power, a.x, a.y);
      return c;
    }
    case 'research': {
      if (!canResearch(s, 0, a.upgrade)) return s;
      const c = cloneState(s);
      doResearch(c, 0, a.upgrade);
      return c;
    }
    case 'cancelResearch': {
      if (!canCancelResearch(s, 0)) return s;
      const c = cloneState(s);
      doCancelResearch(c, 0);
      return c;
    }
    // round5:C begin. Engineering vehicles: the 'deploy' and 'undeploy' cases (until then both are
    // refused by the default: the same state back).
    case 'deploy': {
      if (!Number.isInteger(a.id) || deployProblem(s, 0, a.id) !== null) return s;
      const c = cloneState(s);
      doDeploy(c, 0, a.id);
      return c;
    }
    case 'undeploy': {
      if (!Number.isInteger(a.id) || undeployProblem(s, 0, a.id) !== null) return s;
      const c = cloneState(s);
      doUndeploy(c, 0, a.id);
      return c;
    }
    // round5:C end.
    // round6:B begin. Heroes in free play: any case of its own (recruiting goes through 'queue').
    // round6:B end.
    // round6:C begin. Generals: any case of its own (recruiting goes through 'queue').
    // round6:C end.
    // round6:D begin. Formations and squads: the 'formation' case (until then refused by the
    // default below: the same state back).
    case 'formation': {
      if (!canFormation(s, 0, ids(a.ids), a.shape)) return s;
      const c = cloneState(s);
      doFormation(c, 0, ids(a.ids), a.shape);
      return c;
    }
    // round6:D end.
    default:
      return s;
  }
}
