/**
 * Round 6, workstream D (fireline-round6-design.md): the formation buttons and control-group chips
 * in the selection panel, the period key's cycle, and control groups kept per save.
 *
 * Control groups live in this browser's storage, one entry per battle (keyed by the save's id), so
 * a battle reopened later has its groups back; they never travel with the save. The battle screen
 * still owns the groups while it runs (Ctrl + 1 to 9 and 1 to 9, in GameScreen.tsx): this module
 * fills them in from storage the first time a key goes down, records each Ctrl + digit, and the
 * chips press the same keys the keyboard does, so touch and keys share one set of groups.
 */
import { useEffect } from 'react';
import { wholeSquad } from '../sim/formations';
import { FORMATION_BLURBS, FORMATION_NAMES, FORMATION_SHAPES, UNITS, type FormationShape } from '../sim/rules';
import type { GameAction, GameState, Unit } from '../sim/types';

// ---- Control groups in client storage ------------------------------------------------------

const GROUPS_KEY = (id: string) => `fireline_groups:${id}`;
/** The `code` of the made-up key a chip row sends when it appears, so the battle screen fills its groups in. */
export const GROUPS_SYNC_CODE = 'FirelineGroupsSync';
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** This battle's groups as stored, digit to unit ids; nothing when storage is empty, blocked or junk. */
function readGroups(id: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  try {
    const raw = JSON.parse(localStorage.getItem(GROUPS_KEY(id)) ?? '{}') as Record<string, unknown>;
    if (raw && typeof raw === 'object')
      for (const d of DIGITS) {
        const v = raw[d];
        if (Array.isArray(v)) {
          const ids = v.filter(n => Number.isInteger(n) && n > 0) as number[];
          if (ids.length) out.set(d, ids);
        }
      }
  } catch {
    // Storage blocked or junk: no remembered groups.
  }
  return out;
}

const cache = new Map<string, Map<string, number[]>>();
const groupsOf = (id: string): Map<string, number[]> => {
  let g = cache.get(id);
  if (!g) {
    g = readGroups(id);
    cache.set(id, g);
  }
  return g;
};

/** Records group `digit` for this battle (an empty list forgets it). */
export function rememberGroup(id: string, digit: string, ids: number[]): void {
  const g = groupsOf(id);
  if (ids.length) g.set(digit, ids.slice());
  else g.delete(digit);
  try {
    localStorage.setItem(GROUPS_KEY(id), JSON.stringify(Object.fromEntries(g)));
  } catch {
    // Storage full or blocked: the group still works until the page closes.
  }
}

const filled = new WeakSet<Map<string, number[]>>();
/**
 * Fills the battle screen's group map from storage, once per map: a digit the screen already has
 * (set since the battle opened) wins. Returns true when it added anything.
 */
export function restoreGroups(groups: Map<string, number[]>, id: string): boolean {
  if (filled.has(groups)) return false;
  filled.add(groups);
  let any = false;
  for (const [d, ids] of groupsOf(id))
    if (!groups.has(d)) {
      groups.set(d, ids.slice());
      any = true;
    }
  return any;
}

/** Presses a key on the battle screen, as the keyboard would (the chips' way in). */
function press(key: string, ctrl = false, code = ''): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, code, ctrlKey: ctrl }));
  window.dispatchEvent(new KeyboardEvent('keyup', { key, code, ctrlKey: ctrl }));
}

// ---- The formation of a selection ----------------------------------------------------------

const ground = (units: Unit[]) => units.filter(u => u.owner === 0 && UNITS[u.kind].category !== 'air');

/** The shape these units move in: their squad's when they are exactly one squad, else none. */
export function formationOf(state: GameState, units: Unit[]): FormationShape | 'none' {
  return wholeSquad(state, ground(units))?.shape ?? 'none';
}

const CYCLE: (FormationShape | 'none')[] = [...FORMATION_SHAPES, 'none'];

/**
 * The period key: the next formation in the cycle (line, column, wedge, box, none; back with
 * Shift) as an action for the selection, or null when there is nothing to form.
 */
export function cycleFormation(state: GameState, units: Unit[], back: boolean): GameAction | null {
  const g = ground(units);
  const now = formationOf(state, g);
  let i = CYCLE.indexOf(now);
  for (let n = 0; n < CYCLE.length; n++) {
    i = (i + (back ? CYCLE.length - 1 : 1)) % CYCLE.length;
    const shape = CYCLE[i];
    if (shape === 'none' && !g.some(u => u.squad !== undefined)) continue;
    if (shape !== 'none' && g.length < 2) return null;
    return { type: 'formation', ids: g.map(u => u.id), shape };
  }
  return null;
}

// ---- The panel's rows ----------------------------------------------------------------------


/**
 * Beside Stance: Line, Column, Wedge, Box and None for the selected units, the current one pressed.
 * A shape forms them up where they stand; after that, any move of exactly those units keeps it.
 * On a touch screen the control-group chips follow.
 */
export function FormationControls({
  state,
  units,
  dispatch,
  touch,
}: {
  state: GameState;
  units: Unit[];
  dispatch: (a: GameAction) => boolean;
  touch: boolean;
}) {
  const g = ground(units);
  const now = formationOf(state, g);
  const inSquad = g.some(u => u.squad !== undefined);
  return (
    <>
      {g.length >= 2 && (
        <div className="fl-d-seg fl-d-formation" role="group" aria-label="Formation" data-formation={now}>
          {FORMATION_SHAPES.map(shape => (
            <button
              key={shape}
              data-formation-shape={shape}
              aria-pressed={now === shape}
              className="fl-d-sbtn"
              title={`${FORMATION_NAMES[shape]}: ${FORMATION_BLURBS[shape]}${touch ? '' : ' (. cycles)'}`}
              onClick={() => dispatch({ type: 'formation', ids: g.map(u => u.id), shape })}
            >
              {FORMATION_NAMES[shape]}
            </button>
          ))}
          <button
            data-formation-shape="none"
            aria-pressed={now === 'none'}
            className="fl-d-sbtn"
            title="No formation: each unit makes its own way"
            disabled={!inSquad}
            onClick={() => dispatch({ type: 'formation', ids: g.map(u => u.id), shape: 'none' })}
          >
            None
          </button>
        </div>
      )}
      {touch && <GroupChips state={state} selected={units} />}
    </>
  );
}

/**
 * Control groups on a touch screen: a chip per group with units still standing (tap to select it,
 * tap again to jump to it), and "+ Group" to make the selection the next free group.
 */
function GroupChips({ state, selected }: { state: GameState; selected: Unit[] }) {
  // Fill the battle screen's groups in from storage as soon as the row first shows.
  useEffect(() => press('', false, GROUPS_SYNC_CODE), []);
  const live = new Set(state.units.filter(u => u.owner === 0).map(u => u.id));
  const groups = groupsOf(state.id);
  const shown = DIGITS.map(d => [d, (groups.get(d) ?? []).filter(id => live.has(id))] as const).filter(([, ids]) => ids.length > 0);
  const mine = selected.filter(u => u.owner === 0).map(u => u.id);
  const already = shown.some(([, ids]) => ids.length === mine.length && mine.every(id => ids.includes(id)));
  const free = DIGITS.find(d => !shown.some(([x]) => x === d));
  return (
    <div className="fl-d-groupchips" role="group" aria-label="Control groups" data-testid="group-chips">
      {shown.map(([d, ids]) => (
        <button key={d} data-group={d} className="fl-d-sbtn fl-d-groupchip" title={`Group ${d}: ${ids.length} ${ids.length === 1 ? 'unit' : 'units'}. Tap again to jump to it.`} onClick={() => press(d)}>
          {d} <span className="fl-d-groupchip-n">×{ids.length}</span>
        </button>
      ))}
      {mine.length > 0 && !already && free && (
        <button data-group-new={free} className="fl-d-sbtn fl-d-groupchip" title={`Make these ${mine.length} units group ${free}`} onClick={() => press(free, true)}>
          + Group
        </button>
      )}
    </div>
  );
}
