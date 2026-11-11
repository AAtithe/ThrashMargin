/**
 * Generals (fireline-round6-design.md, workstream C), and the round 6 groundwork it stands on: perks
 * for every side, read through perksFor. Its sections run inside scripts/drive.ts and count in its
 * totals. Workstream C adds its own sections after the groundwork's and keeps it.
 */
import { GENERAL_FACTION, GENERAL_IDS, UNITS } from '../src/sim/rules';
import { perksFor } from '../src/sim/specs';
import { addUnit, costFor, costOf, createInitialState, migrateState } from '../src/sim/state';
import type { GameState, Perks } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
const NONE: Perks = { harvestMul: 1, buildSpeedMul: 1, costMul: 1, unitHpMul: 1, powerCooldownMul: 1, extraStartCredits: 0 };

function perks(ok: Ok): void {
  ok(GENERAL_IDS.length === 4, 'four doctrine Generals');
  ok(GENERAL_IDS.filter(g => GENERAL_FACTION[g] === 'meridian').length === 2 && GENERAL_IDS.filter(g => GENERAL_FACTION[g] === 'ashen').length === 2, 'two to each army');
  const s = createInitialState('p', 'p', { seed: 'perks', createdAt: 0, setup: { tech: 'advanced', sides: 4 } });
  ok([0, 1, 2, 3].every(o => perksFor(s, o as 0) === undefined), 'a skirmish: no side has perks');
  // Side 0's perks are s.perks, exactly as the campaign has always set them.
  const withPerks = copy(s);
  withPerks.perks = { ...NONE, costMul: 0.9, unitHpMul: 1.16 };
  ok(perksFor(withPerks, 0) === withPerks.perks, "side 0's perks are s.perks");
  ok([1, 2, 3].every(o => perksFor(withPerks, o as 1) === undefined), 's.perks is side 0\'s alone');
  ok(costFor(withPerks, 0, 'tank') === Math.round(costOf('tank') * 0.9) && costFor(withPerks, 1, 'tank') === costOf('tank'), 'Procurement takes its share off side 0 only');
  const tank = addUnit(withPerks, 0, 'tank', 10.5, 10.5);
  ok(tank.maxHp === Math.max(1, Math.round(UNITS.tank.hp * 1.16)) && tank.hp === tank.maxHp, "Armour raises side 0's units");
  ok(addUnit(withPerks, 1, 'tank', 12.5, 10.5).maxHp === undefined, "and nobody else's");
  // Sides 1 to 3: s.sidePerks, read the same way.
  const side = copy(s);
  side.sidePerks = { 2: { ...NONE, costMul: 0.8 } };
  ok(perksFor(side, 2)?.costMul === 0.8 && perksFor(side, 1) === undefined && perksFor(side, 0) === undefined, 'sidePerks reach their own side alone');
  ok(costFor(side, 2, 'factory') === Math.round(costOf('factory') * 0.8) && costFor(side, 3, 'factory') === costOf('factory'), "a side's perks price its own queue");
  // Saves: well-formed perks kept for sides 1 to n - 1; side 0, junk and unknown sides dropped.
  const raw = copy(s) as unknown as Record<string, unknown>;
  raw.sidePerks = { 0: { ...NONE }, 1: { ...NONE, harvestMul: 1.1 }, 2: { harvestMul: 'x' }, 3: null, 7: { ...NONE } };
  const m = migrateState(raw)!;
  ok(!!m.sidePerks && Object.keys(m.sidePerks).join() === '1' && m.sidePerks[1]!.harvestMul === 1.1, 'migrateState keeps well-formed perks for sides 1 to 3 only');
  const empty = copy(s) as unknown as Record<string, unknown>;
  empty.sidePerks = 'junk';
  ok(migrateState(empty)!.sidePerks === undefined, 'junk side perks are dropped');
  ok(migrateState(copy(s))!.sidePerks === undefined, 'a state without side perks has none');
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Round 6 groundwork: perks for every side', perks],
  // round6:C begin. Generals: its sections, appended here.
  // round6:C end.
];
