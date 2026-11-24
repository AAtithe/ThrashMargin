/**
 * Round 7: the computer and structure upgrades and strategic structures (fireline-round7-structures.md).
 *
 * Easy does none of it. Normal and Hard:
 *  - upgrade when rich: a Generator first while power is tight, then the turret nearest the enemy,
 *    then (Hard) a Refinery and a War Factory; never a structure that was hit in the last few
 *    seconds (an upgrade under way takes more damage), and never into the credits a wave needs;
 *  - under artillery pressure, build a Fortified Bunker toward the enemy and man it with idle infantry
 *    from home, letting them out again once it has been quiet for a minute;
 *  - on a large or huge map, set a Supply Cache down beside a wave that is out in the field.
 * Hard also:
 *  - builds an Intelligence Centre at the Long and Epic paces;
 *  - places two Decoys a few tiles from its costliest structures, passing for a Tech Centre or a
 *    Research Lab, so the opponent's strikes go astray.
 *
 * With both toggles off every function here returns at once (and nothing in ai.ts calls the rest),
 * so the commander plays exactly as before. Pure: no clock, no dice.
 */
import { buildingCentre, dist } from './grid';
import { doDisguise, doGarrison, doUngarrison, doUpgrade, garrisonCount, garrisonProblem, levelOf, nextLevelOf, strategicOn, ungarrisonProblem, upgradePrice, upgradeProblem, upgradesOn } from './structures';
import { BUNKER_SLOTS, UNITS, type BuildingKind, type Difficulty, type Owner } from './rules';
import { countBuildings, paceOf, powerOf, techAllowed } from './state';
import { isEnemy } from './sides';
import { unitSpecOf } from './specs';
import type { Building, GameState, Unit } from './types';

interface Pt {
  x: number;
  y: number;
}

/** Enemy guns that outrange a base's defences (artillery, missile carriers) count as pressure within this of home. */
const PRESSURE_RANGE = 18;
/** Range from which a weapon counts as artillery for the Bunker. */
const LONG_RANGE = 7;
/** The Bunker is let out once there has been no pressure for this long. */
const CALM_TICKS = 600;
/** An upgrade is not started on a structure hit within this many ticks. */
const HURT_GAP = 150;
/** Credits kept back before an upgrade is paid for. */
const UPGRADE_RESERVE: Record<Difficulty, number> = { easy: Infinity, normal: 1400, hard: 1000 };
/** Upgrades under way at once. */
const UPGRADES_AT_ONCE: Record<Difficulty, number> = { easy: 0, normal: 1, hard: 2 };
/** The kinds a Decoy passes for, in turn. */
const DECOY_LOOKS: BuildingKind[] = ['techcentre', 'researchlab', 'power'];
/** Structures worth a Decoy beside them. */
const KEY_KINDS: BuildingKind[] = ['strikecommand', 'techcentre', 'protoworks', 'factory', 'researchlab'];

/** Enemy long guns near home, by the commander's whole-map sight. */
function underPressure(s: GameState, owner: Owner, home: Pt, foes: Unit[]): boolean {
  for (const f of foes) {
    const w = unitSpecOf(s, f).weapon;
    if (!w || w.range < LONG_RANGE || UNITS[f.kind].category === 'air') continue;
    if (dist(f.x, f.y, home.x, home.y) <= PRESSURE_RANGE) return true;
  }
  return false;
}

/** True while the Bunker is wanted: pressure now, or within the last CALM_TICKS. */
const pressed = (s: GameState, owner: Owner): boolean => s.ai[owner].pressureAt !== undefined && s.tick - s.ai[owner].pressureAt! < CALM_TICKS;

/**
 * Structures the plan (nextStructure in ai.ts) adds. 'early' sits after the first turrets (the
 * Bunker, under pressure); 'late' at the end of the advanced plan. Empty with strategic structures
 * off, on Easy, and whenever nothing is wanted, so the plan is otherwise unchanged.
 */
export function strategicPlanFor(s: GameState, owner: Owner, diff: Difficulty | null, phase: 'early' | 'late'): [BuildingKind, number][] {
  if (!diff || diff === 'easy' || !strategicOn(s)) return [];
  if (phase === 'early') return pressed(s, owner) ? [['bunker', 1]] : [];
  const out: [BuildingKind, number][] = [];
  const mem = s.ai[owner];
  const size = s.setup?.size ?? 'standard';
  if (size !== 'standard' && mem.wavePhase >= 1 && mem.waveIds.length >= 4) out.push(['supplycache', size === 'huge' ? 2 : 1]);
  if (diff === 'hard') {
    const pace = paceOf(s);
    if (pace === 'long' || pace === 'epic') out.push(['intelcentre', 1]);
    if (s.buildings.some(b => b.owner === owner && (b.kind === 'strikecommand' || b.kind === 'techcentre'))) out.push(['decoy', 2]);
  }
  return out;
}

/** Whether a strategic structure waits for the army at home (ai.ts, isExtra). Null for any other kind. */
export function strategicExtra(s: GameState, owner: Owner, kind: BuildingKind): boolean | null {
  if (kind === 'bunker') return !pressed(s, owner);
  if (kind === 'supplycache') return false;
  if (kind === 'intelcentre' || kind === 'decoy') return true;
  return null;
}

/** Where a strategic structure goes (ai.ts, findSpot), as a point to build nearest; null for any other kind. */
export function strategicFocus(s: GameState, owner: Owner, kind: BuildingKind, home: Pt, enemyHome: Pt): Pt | null {
  const toward = (by: number): Pt => {
    const d = dist(home.x, home.y, enemyHome.x, enemyHome.y) || 1;
    return { x: home.x + ((enemyHome.x - home.x) / d) * by, y: home.y + ((enemyHome.y - home.y) / d) * by };
  };
  if (kind === 'bunker') return toward(6);
  if (kind === 'intelcentre') return toward(-4);
  if (kind === 'supplycache') {
    const mem = s.ai[owner];
    const wave = s.units.filter(u => mem.waveIds.includes(u.id));
    if (!wave.length) return toward(10);
    let x = 0;
    let y = 0;
    for (const u of wave) {
      x += u.x;
      y += u.y;
    }
    return { x: x / wave.length, y: y / wave.length };
  }
  if (kind === 'decoy') {
    // Beside the key structure with the fewest Decoys near it, six tiles off to its side, away from
    // the enemy: far enough that one blast does not take both.
    const mine = s.buildings.filter(b => b.owner === owner);
    const keys = mine.filter(b => KEY_KINDS.includes(b.kind));
    if (!keys.length) return null;
    const decoys = mine.filter(b => b.kind === 'decoy');
    let best: Building = keys[0];
    let fewest = Infinity;
    for (const k of KEY_KINDS)
      for (const b of keys) {
        if (b.kind !== k) continue;
        const c = buildingCentre(b);
        const n = decoys.filter(d => dist(buildingCentre(d).x, buildingCentre(d).y, c.x, c.y) < 9).length;
        if (n < fewest) {
          fewest = n;
          best = b;
        }
      }
    const c = buildingCentre(best);
    const d = dist(home.x, home.y, enemyHome.x, enemyHome.y) || 1;
    const px = -(enemyHome.y - home.y) / d;
    const py = (enemyHome.x - home.x) / d;
    const side = decoys.length % 2 ? -1 : 1;
    return { x: c.x + px * 6 * side, y: c.y + py * 6 * side };
  }
  return null;
}

/**
 * The commander's round-7 decisions each turn: upgrades, the Bunker's garrison and the Decoys'
 * looks. Runs after the rest of its plan (ai.ts). Returns at once with both toggles off or on Easy.
 */
export function structuresPlan(s: GameState, owner: Owner, diff: Difficulty, home: Pt, units: Unit[], foes: Unit[], busy: Set<number>): void {
  if (diff === 'easy') return;
  const up = upgradesOn(s);
  const strat = strategicOn(s);
  if (!up && !strat) return;
  const mem = s.ai[owner];
  const mine = s.buildings.filter(b => b.owner === owner && b.hp > 0);
  if (strat) {
    if (underPressure(s, owner, home, foes)) mem.pressureAt = s.tick;
    manBunkers(s, owner, home, units, mine, busy);
    mine.forEach(b => {
      if (b.kind === 'decoy' && !b.disguise) {
        const n = mine.filter(d => d.kind === 'decoy' && d.disguise).length;
        const look = DECOY_LOOKS.slice(n % DECOY_LOOKS.length).concat(DECOY_LOOKS).find(k => techAllowed(s, owner, k)) ?? 'power';
        doDisguise(s, owner, b.id, look);
      }
    });
  }
  if (up) upgradeWhenRich(s, owner, diff, mine);
}

/** Men the Bunkers from idle infantry at home while under pressure; lets them out when it is quiet. */
function manBunkers(s: GameState, owner: Owner, home: Pt, units: Unit[], mine: Building[], busy: Set<number>): void {
  const bunkers = mine.filter(b => b.kind === 'bunker');
  if (!bunkers.length) return;
  if (pressed(s, owner)) {
    for (const b of bunkers) {
      const going = units.filter(u => u.entering === b.id).length;
      const room = BUNKER_SLOTS - garrisonCount(b) - going;
      if (room <= 0) continue;
      const c = buildingCentre(b);
      const idle = units
        .filter(u => !busy.has(u.id) && !u.entering && UNITS[u.kind].category === 'infantry' && !UNITS[u.kind].hero && u.kind !== 'general' && u.order.type === 'idle' && dist(u.x, u.y, home.x, home.y) < 16)
        .sort((a, z) => dist(a.x, a.y, c.x, c.y) - dist(z.x, z.y, c.x, c.y) || a.id - z.id)
        .slice(0, room)
        .map(u => u.id);
      if (idle.length && garrisonProblem(s, owner, idle, b.id) === null) doGarrison(s, owner, idle, b.id);
    }
  } else {
    for (const b of bunkers) if (garrisonCount(b) && ungarrisonProblem(s, owner, b.id) === null) doUngarrison(s, owner, b.id);
  }
}

/** One upgrade at a time on Normal (two on Hard), out of credits beyond the reserve. */
function upgradeWhenRich(s: GameState, owner: Owner, diff: Difficulty, mine: Building[]): void {
  const p = s.players[owner];
  const under = mine.filter(b => b.upgrade).length;
  if (under >= UPGRADES_AT_ONCE[diff]) return;
  const mem = s.ai[owner];
  const recentlyHit = (b: Building) => s.tick - mem.hurtTick < HURT_GAP && Math.abs(mem.hurtX - (b.x + 1)) < 2 && Math.abs(mem.hurtY - (b.y + 1)) < 2;
  const pw = powerOf(s, owner);
  const order: BuildingKind[] = [];
  if (pw.made - pw.used < 40 || pw.low) order.push('power');
  order.push('turret', 'rocketturret');
  if (diff === 'hard') order.push('refinery', 'factory', 'flakcannon');
  else order.push('refinery');
  if (diff === 'hard' && countBuildings(s, owner, 'factory') >= 1 && s.tick > 18000) order.push('hq');
  for (const kind of order) {
    // The lowest level of that kind first, then the oldest.
    const list = mine
      .filter(b => b.kind === kind && !b.upgrade && nextLevelOf(b) && !recentlyHit(b))
      .sort((a, z) => levelOf(a) - levelOf(z) || a.id - z.id);
    const b = list[0];
    if (!b) continue;
    // Turrets: none past Mk II on Normal.
    if (diff === 'normal' && levelOf(b) >= 2) continue;
    const price = upgradePrice(s, b);
    if (p.credits < UPGRADE_RESERVE[diff] + price.credits) return;
    if (upgradeProblem(s, owner, b.id) === null) doUpgrade(s, owner, b.id);
    return;
  }
}

/** Kept for the harness: whether this side's computer would count enemy guns near home as pressure now. */
export const artilleryPressure = (s: GameState, owner: Owner, home: Pt): boolean => underPressure(s, owner, home, s.units.filter(u => isEnemy(s, owner, u.owner)));
