import type { Building, GameAction, GameState, Unit } from '../sim/types';

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
  // round5:C end.
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
