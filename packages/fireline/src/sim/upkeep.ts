/**
 * Army upkeep (2026-11-27, `setup.upkeep` with advanced production; the first step of the long-game
 * plan in fireline-design.md). Pure, like the rest of src/sim/.
 *
 * Before this, food and fuel were paid once, when a unit was trained, so an army cost nothing to keep
 * and whoever got ahead snowballed. Now an army is paid for every minute it stands:
 *
 * - Every UPKEEP_TICKS each side's soldiers (the infantry that eat: not heroes, not the General) eat
 *   INFANTRY_UPKEEP food each, and its armed vehicles, ships and aircraft burn VEHICLE_UPKEEP fuel
 *   each. A side pays what it holds.
 * - A side that cannot pay in full is short of that good. While short, the units that use it reload
 *   SHORT_RELOAD times slower. After UPKEEP_GRACE short minutes in a row, DESERT_SHARE of the unpaid
 *   units desert each further short minute (the newest first: the last recruited are the first to go).
 *   Paying in full clears the count.
 *
 * So the army a side can keep is the army its Farms and Fuel Wells can feed, and growing it means
 * taking and holding the land that feeds it. Off (absent) in every battle that does not ask for it.
 */
import { UNITS, type Owner, type UnitKind } from './rules';
import { productionOn } from './production';
import { unitSpecOf } from './specs';
import type { GameState, Unit } from './types';

/** True in a skirmish with advanced production and army upkeep on. */
export const upkeepOn = (s: GameState): boolean => productionOn(s) && s.setup?.upkeep === true;

/** Upkeep is paid once a minute. */
export const UPKEEP_TICKS = 600;
/** Food each soldier eats a minute. A Farm grows 30 a minute: fifteen soldiers, less its Quarters. */
export const INFANTRY_UPKEEP = 2;
/** Fuel each armed vehicle, ship or aircraft burns a minute. A Fuel Well pumps 40: twenty machines, less its Foundry. */
export const VEHICLE_UPKEEP = 2;
/** Reload multiplier for a unit whose side is short of what it uses. */
export const SHORT_RELOAD = 1.5;
/** Short minutes in a row before anyone deserts. */
export const UPKEEP_GRACE = 2;
/** Of the unpaid units, the share that desert each further short minute (at least one). */
export const DESERT_SHARE = 0.25;

/** A soldier that eats: infantry bar the heroes and the General (as training's food cost). */
export const eatsUpkeep = (kind: UnitKind): boolean => UNITS[kind].category === 'infantry' && !UNITS[kind].hero && kind !== 'general';

/** An armed machine that burns fuel: anything armed that is not infantry and not a hero. */
export function burnsUpkeep(s: GameState, u: Unit): boolean {
  const spec = UNITS[u.kind];
  // High tiers: a nuclear machine (the Atomic Tank) burns no fuel.
  return spec.category !== 'infantry' && !spec.hero && !spec.nuclear && !!unitSpecOf(s, u).weapon;
}

/** How many minutes in a row a side has been short of each good. Absent: never. */
export type UpkeepShort = { food: number; fuel: number };

/** True when this unit's side is short of what it uses: it reloads slower. */
export function shortOfUpkeep(s: GameState, u: Unit): boolean {
  if (!upkeepOn(s)) return false;
  const short = s.players[u.owner]?.upkeepShort;
  if (!short) return false;
  if (short.food > 0 && eatsUpkeep(u.kind)) return true;
  return short.fuel > 0 && burnsUpkeep(s, u);
}

/** What a side's army asks each minute: food for its soldiers and fuel for its machines. */
export function upkeepDue(s: GameState, owner: Owner): { food: number; fuel: number; soldiers: number; machines: number } {
  let soldiers = 0;
  let machines = 0;
  for (const u of s.units) {
    if (u.owner !== owner || u.hp <= 0) continue;
    if (eatsUpkeep(u.kind)) soldiers++;
    else if (burnsUpkeep(s, u)) machines++;
  }
  return { food: soldiers * INFANTRY_UPKEEP, fuel: machines * VEHICLE_UPKEEP, soldiers, machines };
}

/**
 * The computer's check before it trains a unit: false while its side is short of what that unit
 * would use, since another mouth only deepens the shortage. Always true without upkeep.
 */
export function upkeepAllows(s: GameState, owner: Owner, kind: UnitKind): boolean {
  if (!upkeepOn(s)) return true;
  const short = s.players[owner]?.upkeepShort;
  if (!short) return true;
  const spec = UNITS[kind];
  if (eatsUpkeep(kind)) return short.food === 0;
  if (spec.category !== 'infantry' && !spec.hero && !spec.nuclear && spec.weapon) return short.fuel === 0;
  return true;
}

/** One tick: on the minute, every side pays its army's upkeep; a side short too long loses deserters. */
export function upkeepStep(s: GameState, say: (s: GameState, text: string, tone: 'info' | 'good' | 'bad') => void): void {
  if (!upkeepOn(s) || s.tick === 0 || s.tick % UPKEEP_TICKS !== 0) return;
  for (const p of s.players) {
    const owner = p.owner;
    const due = upkeepDue(s, owner);
    const short = p.upkeepShort ?? { food: 0, fuel: 0 };
    const foodPaid = Math.min(due.food, Math.max(0, Math.floor(p.food ?? 0)));
    const fuelPaid = Math.min(due.fuel, Math.max(0, Math.floor(p.fuel ?? 0)));
    p.food = (p.food ?? 0) - foodPaid;
    p.fuel = (p.fuel ?? 0) - fuelPaid;
    const unfed = Math.ceil((due.food - foodPaid) / INFANTRY_UPKEEP);
    const dry = Math.ceil((due.fuel - fuelPaid) / VEHICLE_UPKEEP);
    const was = { ...short };
    short.food = unfed > 0 ? short.food + 1 : 0;
    short.fuel = dry > 0 ? short.fuel + 1 : 0;
    if (short.food === 0 && short.fuel === 0) delete p.upkeepShort;
    else p.upkeepShort = short;
    const lostSoldiers = short.food > UPKEEP_GRACE ? desert(s, owner, unfed, u => eatsUpkeep(u.kind)) : 0;
    const lostMachines = short.fuel > UPKEEP_GRACE ? desert(s, owner, dry, u => burnsUpkeep(s, u)) : 0;
    if (owner !== 0) continue;
    // The player hears about it: when a shortage starts, when men leave, and when it ends.
    if (unfed > 0 && was.food === 0)
      say(s, `${unfed} soldier${unfed === 1 ? '' : 's'} unfed: they fire slower, and desert after ${UPKEEP_GRACE} more minutes without food. Build Farms.`, 'bad');
    if (dry > 0 && was.fuel === 0)
      say(s, `${dry} machine${dry === 1 ? '' : 's'} without fuel: they fire slower, and are abandoned after ${UPKEEP_GRACE} more minutes. Build Fuel Wells.`, 'bad');
    if (lostSoldiers) say(s, `${lostSoldiers} soldier${lostSoldiers === 1 ? '' : 's'} deserted for want of food.`, 'bad');
    if (lostMachines) say(s, `${lostMachines} machine${lostMachines === 1 ? '' : 's'} abandoned for want of fuel.`, 'bad');
    if (was.food > 0 && short.food === 0) say(s, 'The army is fed again.', 'good');
    if (was.fuel > 0 && short.fuel === 0) say(s, 'The army is fuelled again.', 'good');
  }
}

/** Removes DESERT_SHARE of `unpaid` (at least one) of a side's units matching `pick`, newest first. Returns how many. */
function desert(s: GameState, owner: Owner, unpaid: number, pick: (u: Unit) => boolean): number {
  if (unpaid <= 0) return 0;
  const want = Math.max(1, Math.ceil(unpaid * DESERT_SHARE));
  const candidates = s.units.filter(u => u.owner === owner && u.hp > 0 && pick(u)).sort((a, b) => b.id - a.id);
  // Never a transport with troops aboard: abandoning it would take its riders with it.
  const gone = candidates.filter(u => !u.carried?.length).slice(0, want);
  for (const u of gone) {
    u.hp = 0;
    u.deserted = true;
  }
  return gone.length;
}
