/**
 * Round 7, the adaptive commander: measures the matchup table in src/sim/aiAdapt.ts (MATCHUPS).
 *
 *   tsx scripts/adapt-matchups.ts
 *
 * Equal-credit fights in the open, in the real engine: about `BUDGET` credits of one kind against
 * the same of a class's representative kinds (or, for defences, a ring of turrets the group attacks),
 * no commander on either side, both groups ordered to attack-move at each other. A fight's score is
 * the log of the share of value each side has left (plus a little, so a wipe-out is finite), so 0
 * is an even trade and a positive score means a credit on the attacker beats a credit on the class.
 * Two budgets and three placements each, averaged. Prints the table as TypeScript to paste into
 * aiAdapt.ts. The air and navy columns are not measured here (aircraft need their pads, ships the
 * sea): aiAdapt.ts fills those from DAMAGE_VS.
 */
import { setAutopilotAi } from '../src/sim/ai';
import { processAction } from '../src/sim/actions';
import { doMove } from '../src/sim/commands';
import { addBuilding, addUnit, createInitialState } from '../src/sim/state';
import { UNITS, BUILDINGS, type BuildingKind, type Owner, type UnitKind } from '../src/sim/rules';
import { unitSpecOf, buildingSpecOf } from '../src/sim/specs';
import type { GameState } from '../src/sim/types';

const KINDS: UnitKind[] = ['rifleman', 'rocketeer', 'grenadier', 'sapper', 'buggy', 'raider', 'tank', 'artillery', 'flametank', 'missilecarrier', 'bastion', 'railtank', 'stealthtank'];
const REPS: (UnitKind | BuildingKind)[][] = [
  ['rifleman', 'grenadier', 'rocketeer'],
  ['buggy', 'raider'],
  ['tank', 'flametank', 'bastion'],
  ['artillery', 'missilecarrier'],
  [],
  [],
  ['turret', 'rocketturret'],
];
const BUDGETS = [2400, 4800];

setAutopilotAi(() => {}, 0);
setAutopilotAi(() => {}, 1);

function arena(): GameState {
  const s = createInitialState('m', 'm', { seed: 'matchups', difficulty: 'normal', createdAt: 0, setup: { map: 'plains', tech: 'advanced', sites: false, adaptive: false } });
  s.tiles = 'g'.repeat(s.mapW * s.mapH);
  s.ore = s.ore.map(() => 0);
  s.units = [];
  return s;
}

function place(s: GameState, owner: Owner, kind: UnitKind, n: number, cx: number, cy: number): number[] {
  const ids: number[] = [];
  const cols = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const u = addUnit(s, owner, kind, cx + (i % cols) * 0.9 - cols * 0.45, cy + Math.floor(i / cols) * 0.9 - cols * 0.45);
    ids.push(u.id);
  }
  return ids;
}

function value(s: GameState, owner: Owner): number {
  let v = 0;
  for (const u of s.units) if (u.owner === owner && u.hp > 0) v += unitSpecOf(s, u).cost * (u.hp / (u.maxHp ?? unitSpecOf(s, u).hp));
  for (const b of s.buildings) if (b.owner === owner && b.hp > 0 && b.kind !== 'hq') v += buildingSpecOf(s, b).cost * (b.hp / buildingSpecOf(s, b).hp);
  return v;
}

function fight(a: UnitKind, b: UnitKind | BuildingKind, budget: number, shift: number): number {
  let s = arena();
  const y = 32 + shift;
  const na = Math.max(1, Math.round(budget / UNITS[a].cost));
  const aIds = place(s, 0, a, na, 18, y);
  if (b in BUILDINGS) {
    const n = Math.max(1, Math.round(budget / BUILDINGS[b as BuildingKind].cost));
    for (let i = 0; i < n; i++) addBuilding(s, 1, b as BuildingKind, 42 + (i % 2) * 3, y - 3 + Math.floor(i / 2) * 3, -100);
    // Full power, well behind the fight, so the defences fire at their full rate.
    for (let i = 0; i < 4; i++) addBuilding(s, 1, 'power', 56 + (i % 2) * 3, 20 + Math.floor(i / 2) * 3 + (i > 1 ? 18 : 0), -100);
    doMove(s, 0, aIds, 43, y, true);
  } else {
    const nb = Math.max(1, Math.round(budget / UNITS[b as UnitKind].cost));
    const bIds = place(s, 1, b as UnitKind, nb, 46, y);
    doMove(s, 0, aIds, 46, y, true);
    doMove(s, 1, bIds, 18, y, true);
  }
  const startA = value(s, 0);
  const startB = value(s, 1);
  for (let t = 0; t < 2400; t += 10) {
    s = processAction(s, { type: 'tick', n: 10 });
    const va = value(s, 0);
    const vb = value(s, 1);
    if (va <= 0 || vb <= 0) break;
  }
  const left = (v: number, of: number) => Math.max(0, v) / of + 0.05;
  return Math.log(left(value(s, 0), startA) / left(value(s, 1), startB));
}

const rows: string[] = [];
for (const a of KINDS) {
  const cells = REPS.map(reps => {
    if (!reps.length) return null;
    let sum = 0;
    let n = 0;
    for (const b of reps)
      for (const budget of BUDGETS)
        for (const shift of [-6, 0, 6]) {
          sum += fight(a, b, budget, shift);
          n++;
        }
    return Math.round((sum / n) * 100) / 100;
  });
  rows.push(`  ${a}: [${cells.map(c => (c === null ? 'null' : c.toFixed(2))).join(', ')}],`);
  console.error(rows[rows.length - 1]);
}
console.log('export const MATCHUPS: Partial<Record<UnitKind, (number | null)[]>> = {');
for (const r of rows) console.log(r);
console.log('};');
