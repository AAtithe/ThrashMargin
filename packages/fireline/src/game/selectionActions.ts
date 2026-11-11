import { deployProblem, undeployProblem } from '../sim/engineering';
import { unloadProblem } from '../sim/transport';
import { BUILDINGS, UNITS } from '../sim/rules';
import type { Building, GameAction, GameState, Unit } from '../sim/types';

/**
 * Round 5, workstream C: the Forward Base Truck a Deploy acts on: the first selected that can deploy
 * now, else the first selected at all (so its button shows, greyed with the reason).
 */
function deployingTruck(state: GameState, sel: Selection): Unit | null {
  const trucks = sel.units.filter(u => UNITS[u.kind].deploysTo);
  return trucks.find(u => deployProblem(state, 0, u.id) === null) ?? trucks[0] ?? null;
}

/**
 * Commands a selection offers besides Stop and the stances: a button in the selection panel, and
 * the F key in a skirmish (in a campaign battle F stays the selected hero's ability). The panel and
 * the key read this list and nothing else, so a workstream adds a command here, as data, without
 * touching the panel (fireline-round5-design.md). Empty until round 5's workstream C adds Deploy
 * and Pack up.
 */
export interface Selection {
  /** Side 0's own selected units (empty when a structure is selected). */
  units: Unit[];
  /** Side 0's own selected structure, or null. */
  building: Building | null;
}

export interface SelectionAction {
  /** Stable id, also the button's data-action attribute (for the tours and tests). */
  id: string;
  /** Button text, e.g. 'Deploy'. */
  label: string;
  /** Tooltip: what it does. */
  title: string;
  /** The action for this selection, or null when the command does not apply to it at all (no button). */
  action: (state: GameState, sel: Selection) => GameAction | null;
  /** Why it cannot go just now (the button shows greyed, with this as its tooltip), or null. */
  problem?: (state: GameState, sel: Selection) => string | null;
}

export const SELECTION_ACTIONS: SelectionAction[] = [
  // round5:C begin. Engineering vehicles: Deploy (a Forward Base truck) and Pack up (a Field Yard).
  {
    id: 'deploy',
    label: 'Deploy',
    title: 'Deploy the Forward Base Truck where it stands into a Field Yard, which builds structures near itself.',
    action: (state, sel) => {
      const truck = deployingTruck(state, sel);
      return truck ? { type: 'deploy', id: truck.id } : null;
    },
    problem: (state, sel) => {
      const truck = deployingTruck(state, sel);
      return truck ? deployProblem(state, 0, truck.id) : null;
    },
  },
  {
    id: 'undeploy',
    label: 'Pack up',
    title: 'Pack the Field Yard up into a Forward Base Truck, to move it somewhere else.',
    action: (_state, sel) => (sel.building && BUILDINGS[sel.building.kind].undeploysTo ? { type: 'undeploy', id: sel.building.id } : null),
    problem: (state, sel) => (sel.building ? undeployProblem(state, 0, sel.building.id) : null),
  },
  // Repair Trucks have no weapon, so the stance buttons leave them out: these two set Hold (stay
  // where it is put) or Guard (drive to damaged vehicles nearby) on the selection's trucks.
  {
    id: 'mender-hold',
    label: 'Stay put',
    title: 'The selected Repair Trucks stay where they are put, mending what comes beside them.',
    action: (_state, sel) => {
      const trucks = sel.units.filter(u => UNITS[u.kind].mender);
      return trucks.some(u => u.stance !== 'hold') ? { type: 'stance', ids: trucks.map(u => u.id), stance: 'hold' } : null;
    },
  },
  {
    id: 'mender-roam',
    label: 'Roam',
    title: 'The selected Repair Trucks drive to damaged vehicles nearby when idle.',
    action: (_state, sel) => {
      const trucks = sel.units.filter(u => UNITS[u.kind].mender);
      return trucks.length && trucks.every(u => u.stance === 'hold') ? { type: 'stance', ids: trucks.map(u => u.id), stance: 'guard' } : null;
    },
  },
  // round5:C end.
  // The air war: a Troop Carrier sets its infantry down (now if it is still, else where it stops).
  {
    id: 'unload',
    label: 'Unload',
    title: 'Set the infantry aboard down: here if the Troop Carrier is hovering or parked, otherwise where it next stops.',
    action: (_state, sel) => {
      const c = sel.units.find(u => UNITS[u.kind].carries && (u.carried?.length ?? 0) > 0);
      return c ? { type: 'unload', id: c.id } : null;
    },
    problem: (state, sel) => {
      const c = sel.units.find(u => UNITS[u.kind].carries && (u.carried?.length ?? 0) > 0);
      return c ? unloadProblem(state, 0, c.id) : null;
    },
  },
];

/** The commands that apply to this selection, in list order, each with its action and any problem. */
export function selectionActions(state: GameState, sel: Selection): { spec: SelectionAction; action: GameAction; problem: string | null }[] {
  const out: { spec: SelectionAction; action: GameAction; problem: string | null }[] = [];
  if (!sel.units.length && !sel.building) return out;
  for (const spec of SELECTION_ACTIONS) {
    const action = spec.action(state, sel);
    if (action) out.push({ spec, action, problem: spec.problem ? spec.problem(state, sel) : null });
  }
  return out;
}
