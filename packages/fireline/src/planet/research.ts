/**
 * War for the Planet: research, doctrines and loadouts (fireline-planet-design.md, section 6.4).
 * W1. The tree is round 5's development lines; the checks mirror src/sim/loadout.ts against the
 * same tables, since the GameState version cannot be called here. Pure.
 */
import { LINES, LINE_ORDER, MODULES, MODULE_SLOTS, UNITS, UPGRADES, UPGRADE_LINE, type LineId, type ModuleId, type UnitKind, type UpgradeId } from '../sim/rules';
import { AI_LOADOUTS } from './rules';
import type { FactionResearch } from './types';

export const isUpgrade = (v: unknown): v is UpgradeId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(UPGRADES, v);
export const isLine = (v: unknown): v is LineId => typeof v === 'string' && (LINE_ORDER as string[]).includes(v);
const isModule = (v: unknown): v is ModuleId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(MODULES, v);
const isUnitKind = (v: unknown): v is UnitKind => typeof v === 'string' && Object.prototype.hasOwnProperty.call(UNITS, v);

/** Science an upgrade costs: ceil(cost / 250). */
export const scienceCost = (id: UpgradeId): number => Math.ceil(UPGRADES[id].cost / 250);

/** Why this upgrade's prerequisites do not hold (ignoring whether it is current), or null. */
export function prerequisiteProblem(r: FactionResearch, id: UpgradeId, assumeDoctrine = false): string | null {
  const { line, mark } = UPGRADE_LINE[id]!;
  const l = LINES[line];
  if (mark >= 2 && !r.done.includes(l.marks[0])) return `Needs ${UPGRADES[l.marks[0]].name} first.`;
  if (mark === 3) {
    if (!r.done.includes(l.marks[1])) return `Needs ${UPGRADES[l.marks[1]].name} first.`;
    const doc = r.doctrines[line];
    if (doc !== id && !(assumeDoctrine && doc === undefined)) return doc ? `The ${l.name} line is committed to ${UPGRADES[doc].name}.` : `Choose the ${l.name} doctrine first.`;
  }
  return null;
}

export function researchProblem(r: FactionResearch, id: unknown): string | null {
  if (!isUpgrade(id) || !UPGRADE_LINE[id]) return 'There is no such research.';
  if (r.done.includes(id)) return `${UPGRADES[id].name} is already researched.`;
  if (r.current === id) return `${UPGRADES[id].name} is already being researched.`;
  return prerequisiteProblem(r, id);
}

export function doctrineProblem(r: FactionResearch, line: unknown, branch: unknown): string | null {
  if (!isLine(line)) return 'There is no such line.';
  const l = LINES[line];
  if (!isUpgrade(branch) || !l.fork.includes(branch)) return 'That is not a branch of this line.';
  if (r.doctrines[line]) return `The ${l.name} doctrine is already chosen.`;
  if (!r.done.includes(l.marks[1])) return `Research ${UPGRADES[l.marks[1]].name} before choosing a doctrine.`;
  return null;
}

const sameList = (a: readonly ModuleId[], b: readonly ModuleId[]): boolean => a.length === b.length && a.every((m, i) => m === b[i]);

/** The same rules as loadoutProblem in src/sim/loadout.ts, against the faction's research. */
export function loadoutProblem(r: FactionResearch, kind: unknown, modules: unknown): string | null {
  if (!isUnitKind(kind)) return 'There is no such unit.';
  const slots = MODULE_SLOTS[kind];
  if (!slots || UNITS[kind].hero) return 'That unit takes no modules.';
  if (!Array.isArray(modules) || modules.length > slots) return 'Bad loadout.';
  for (let i = 0; i < modules.length; i++) if (!isModule(modules[i]) || modules.indexOf(modules[i]) !== i) return 'Bad loadout.';
  const mods = modules as ModuleId[];
  if (mods.some(m => !MODULES[m].fits.includes(kind))) return 'A module does not fit that unit.';
  if (mods.some(m => !r.done.includes(MODULES[m].unlock))) return 'A module is not researched yet.';
  if (sameList(mods, r.loadouts[kind] ?? [])) return 'No change.';
  return null;
}

/** The computer loadouts (round 5's Hard table) filtered to modules unlocked, in table order. */
export function aiLoadouts(r: FactionResearch): [UnitKind, ModuleId[]][] {
  return AI_LOADOUTS.map(([k, mods]) => [k, mods.filter(m => r.done.includes(MODULES[m].unlock))] as [UnitKind, ModuleId[]]);
}
