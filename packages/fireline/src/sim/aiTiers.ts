import { canQueue, doMove, doQueue } from './commands';
import { refundGoods } from './industry';
import { airRoom } from './air';
import { DIFFICULTIES, TIER3_HIGH_AI_TICKS, TIER4_AI_TICKS, TIER5_AI_TICKS, UNITS, type BuildingKind, type Difficulty, type Owner, type UnitKind } from './rules';
import { costFor, countBuildings, highTiersOn, lineCount, powerOf, queueCap, researchShort, unlocked } from './state';
import { buildingSpec, unitSpec, unitSpecOf } from './specs';
import type { GameState, Unit } from './types';

/**
 * The computer commander's high tiers (2026-11-28; setup.highTiers, hightiers.ts). Called once a
 * decision from the commander in ai.ts, after the tier three plan in aiSites.ts (which raises the
 * Prototype Works). A no-op without high tiers, and never in a mission.
 *
 *  - Tier three, Normal and Hard, from TIER3_HIGH_AI_TICKS: a Research Lab, Tech Centre and
 *    Prototype Works if missing (aiSites.ts would otherwise wait for TIER3_AI_TICKS). Its additions,
 *    with a Prototype Works standing (Easy from TIER3_HIGH_AI_TICKS too, once aiSites.ts builds one): Outriders and
 *    Mechanised Infantry join the vehicle mix, and a Scout Drone (Normal, Hard).
 *  - Tier four, Normal and Hard, from TIER4_AI_TICKS: a Strike Command and a Helipad if missing,
 *    then Battlefield Command once three upgrades are done (its research order gets there); then
 *    Rotary Cannons, Strike Drones (which its gunship strikes fly, aiAir.ts) and on Hard a Pathfinder.
 *  - Tier five, Normal and Hard, from TIER5_AI_TICKS: the Reactor Complex once five upgrades are
 *    done, then Atomic Tanks and a Stratos, flown over the thickest knot of the enemy's army so its
 *    mark helps the waves.
 *
 * Structures wait, as tier three's do, for the army at home to be up to the next wave and to the
 * opponent's, and are paid for by taking back units queued but not yet started.
 */

interface TierTactics {
  outriders: number;
  mech: number;
  scoutDrones: number;
  tier4: boolean;
  rotary: number;
  strikeDrones: number;
  pathfinders: number;
  tier5: boolean;
  atomic: number;
  stratos: number;
  vanguards: number;
  seaCommandos: number;
  shadowBombers: number;
}

const TIER_TACTICS: Record<Difficulty, TierTactics> = {
  easy: { outriders: 1, mech: 1, scoutDrones: 0, tier4: false, rotary: 0, strikeDrones: 0, pathfinders: 0, tier5: false, atomic: 0, stratos: 0, vanguards: 2, seaCommandos: 0, shadowBombers: 0 },
  normal: { outriders: 2, mech: 2, scoutDrones: 1, tier4: true, rotary: 2, strikeDrones: 2, pathfinders: 0, tier5: true, atomic: 1, stratos: 1, vanguards: 3, seaCommandos: 1, shadowBombers: 0 },
  hard: { outriders: 2, mech: 3, scoutDrones: 1, tier4: true, rotary: 3, strikeDrones: 3, pathfinders: 1, tier5: true, atomic: 2, stratos: 1, vanguards: 4, seaCommandos: 2, shadowBombers: 1 },
};

/** Ticks between two sorties of a Stratos or a scout over the enemy's army. */
const SORTIE_TICKS = 300;

type Pt = { x: number; y: number };

export function tiersPlan(s: GameState, owner: Owner, home: Pt, enemyHome: Pt, units: Unit[], foes: Unit[]): void {
  if (!highTiersOn(s)) return;
  const diff: Difficulty = owner === 0 && s.autopilotDifficulty ? s.autopilotDifficulty : s.difficulty;
  const t = TIER_TACTICS[diff];
  const p = s.players[owner];
  const count = (k: BuildingKind) => countBuildings(s, owner, k);
  const queued = (kind: UnitKind) =>
    units.filter(u => u.kind === kind).length + (p.queues[UNITS[kind].category]?.filter(i => i.kind === kind).length ?? 0);

  // The eyes in the sky fly whatever else happens (the structures that made them may be gone).
  sorties(s, owner, units, foes, enemyHome);

  if (s.tick < TIER3_HIGH_AI_TICKS) return;
  const economy = units.some(u => u.kind === 'hauler') && count('refinery') > 0 && count('factory') > 0;
  if (!economy) return;

  // Units, one a decision: the heaviest first. Vehicles while the War Factories' lines have room.
  const vq = p.queues.vehicle;
  if (vq.length <= lineCount(s, owner, 'vehicle')) {
    const order: [UnitKind, number][] = [
      ['atomictank', t.atomic],
      ['rotarygun', t.rotary],
      ['mechinf', t.mech],
      ['outrider', t.outriders],
    ];
    const want = order.find(([k, n]) => queued(k) < n && unlocked(s, owner, k));
    if (want && fund(s, owner, unitSpec(s, owner, want[0]).cost) && canQueue(s, owner, 'vehicle', want[0])) doQueue(s, owner, 'vehicle', want[0]);
  }
  // Infantry: the Vanguard and the Sea Commando. The commander keeps its Barracks' queue full of
  // line infantry, so one not yet started gives way (refunded) when the queue has no room.
  {
    const order: [UnitKind, number][] = [
      ['seacommando', t.seaCommandos],
      ['vanguard', t.vanguards],
    ];
    const want = order.find(([k, n]) => queued(k) < n && unlocked(s, owner, k));
    if (want) {
      const q = p.queues.infantry;
      if (q.length >= queueCap(s, owner, 'infantry')) {
        for (let i = q.length - 1; i >= 0; i--) {
          if (q[i].progress !== 0 || UNITS[q[i].kind as UnitKind]?.tier) continue;
          const [item] = q.splice(i, 1);
          p.credits += costFor(s, owner, item.kind);
          refundGoods(p, item);
          break;
        }
      }
      if (fund(s, owner, unitSpec(s, owner, want[0]).cost) && canQueue(s, owner, 'infantry', want[0])) doQueue(s, owner, 'infantry', want[0]);
    }
  }
  if (airRoom(s, owner) > 0 && p.queues.air.length === 0) {
    const order: [UnitKind, number][] = [
      ['shadowbomber', t.shadowBombers],
      ['stratos', t.stratos],
      ['strikedrone', t.strikeDrones],
      ['pathfinder', t.pathfinders],
      ['scoutdrone', t.scoutDrones],
    ];
    const want = order.find(([k, n]) => queued(k) < n && unlocked(s, owner, k));
    if (want && fund(s, owner, unitSpec(s, owner, want[0]).cost) && canQueue(s, owner, 'air', want[0])) doQueue(s, owner, 'air', want[0]);
  }

  // Structures: only once the army at home is up to strength, and one at a time.
  const d = DIFFICULTIES[diff];
  const mem = s.ai[owner];
  const armed = units.filter(u => unitSpecOf(s, u).weapon && UNITS[u.kind].category !== 'air').length;
  const foeArmy = foes.filter(u => unitSpecOf(s, u).weapon && UNITS[u.kind].category !== 'air').length;
  if (armed < Math.max(Math.min(d.waveCap, d.firstWave + mem.wave * d.waveGrowth), foeArmy * 0.9)) return;
  if (p.queues.building.length) return;
  // Tier three first, as aiSites.ts would raise it from TIER3_AI_TICKS (Easy keeps that later start).
  if (diff === 'easy') return;
  if (count('researchlab') < 1) queueStructure(s, owner, 'researchlab');
  else if (count('techcentre') < 1) queueStructure(s, owner, 'techcentre');
  else if (count('protoworks') < 1) queueStructure(s, owner, 'protoworks');
  else if (!t.tier4 || s.tick < TIER4_AI_TICKS) return;
  else if (count('strikecommand') < 1) queueStructure(s, owner, 'strikecommand');
  else if (count('helipad') < 1) queueStructure(s, owner, 'helipad');
  else if (count('battlecommand') < 1) {
    if (researchShort(s, owner, 'battlecommand') === 0) queueStructure(s, owner, 'battlecommand');
  } else if (t.tier5 && s.tick >= TIER5_AI_TICKS && count('reactor') < 1 && researchShort(s, owner, 'reactor') === 0) {
    if (count('techcentre') < 1) queueStructure(s, owner, 'techcentre');
    else if (count('uplink') < 1) queueStructure(s, owner, 'uplink');
    else queueStructure(s, owner, 'reactor');
  }
}

/**
 * The Stratos, Pathfinders and Scout Drones: parked full, each goes up every SORTIE_TICKS over the
 * middle of the enemy's armed units (its base when none are out), where it circles until its fuel
 * brings it home. The Stratos's mark makes everything under it easier to kill; the scouts find
 * the Stealth Tanks and Spies its guns could not otherwise see.
 */
function sorties(s: GameState, owner: Owner, units: Unit[], foes: Unit[], enemyHome: Pt): void {
  if ((s.tick + owner * 37) % SORTIE_TICKS !== 0) return;
  const eyes = units.filter(u => (u.kind === 'stratos' || u.kind === 'pathfinder' || u.kind === 'scoutdrone') && u.order.type === 'rearm' && (u.ammo ?? 0) >= 6);
  if (!eyes.length) return;
  const army = foes.filter(f => unitSpecOf(s, f).weapon && UNITS[f.kind].category !== 'air');
  const at = army.length
    ? { x: army.reduce((a, f) => a + f.x, 0) / army.length, y: army.reduce((a, f) => a + f.y, 0) / army.length }
    : enemyHome;
  const x = Math.max(1, Math.min(s.mapW - 1, at.x));
  const y = Math.max(1, Math.min(s.mapH - 1, at.y));
  doMove(s, owner, eyes.map(u => u.id), x, y, false);
}

/** Takes back units queued but not yet started (never a hauler or anti-air), latest first, until `need` is in hand. */
function fund(s: GameState, owner: Owner, need: number): boolean {
  const p = s.players[owner];
  const spare = (k: string) => k !== 'hauler' && k !== 'skyhunter' && k !== 'flaktrack' && !(UNITS[k as UnitKind]?.tier);
  for (const cat of ['vehicle', 'infantry'] as const) {
    const q = p.queues[cat];
    for (let i = q.length - 1; i >= 0 && p.credits < need; i--) {
      if (q[i].progress !== 0 || !spare(q[i].kind)) continue;
      const kind = q[i].kind;
      const [item] = q.splice(i, 1);
      p.credits += costFor(s, owner, kind);
      refundGoods(p, item);
    }
  }
  return p.credits >= need;
}

/** Queues a structure, a Generator first when it would take power too low (the Reactor makes power, so never). */
function queueStructure(s: GameState, owner: Owner, kind: BuildingKind): void {
  const p = s.players[owner];
  if (p.queues.building.length) return;
  const pw = powerOf(s, owner);
  const want: BuildingKind = pw.made - pw.used + buildingSpec(s, owner, kind).power < 10 ? 'power' : kind;
  if (!unlocked(s, owner, want) || !fund(s, owner, buildingSpec(s, owner, want).cost)) return;
  if (canQueue(s, owner, 'building', want)) doQueue(s, owner, 'building', want);
}
