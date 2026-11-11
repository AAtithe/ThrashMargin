import { canQueue, doAttack, doCancel, doHarvest, doMove, doPlace, doQueue, doRally, doRepair, doSell, placementProblem } from './commands';
import { buildingCentre, dist, distToBuilding, doorTile, dockTile, frontDir, nearestPassable, occupancy, onMap, passable, laneRow, tileAt } from './grid';
import { airPlan } from './aiAir';
import { engineeringPlan, expansionSpot } from './aiEngineering';
import { doPower, powerProblem } from './mission';
import { next } from './rng';
import { reserveRadius, scaledFor, stageDistance } from './aiScale';
import {
  BARRAGE_DAMAGE,
  BUILDINGS,
  DAMAGE_VS,
  DIFFICULTIES,
  MISSILE_DAMAGE,
  POWERS,
  SELL_RETURN,
  UNITS,
  type BuildingKind,
  type Difficulty,
  type DifficultySpec,
  type Owner,
  type SupportPower,
  type UnitKind,
} from './rules';
import { countBuildings, isStructure, powerOf, readyStructure, techAllowed, unlocked } from './state';
import { isAlly, isEnemy } from './sides';
import { alliedPlan, chooseEnemy, enemyLists } from './aiSides';
import type { AiMemory, AiMode, Building, GameState, Unit } from './types';
import { buildingSpec, buildingSpecOf, factionOf, unitSpec, unitSpecOf } from './specs';
// round5:D. Neutral sites and tier three (fireline-round5-design.md, workstream D).
import { sitesPlan } from './aiSites';
// round6:B. Heroes in free play (fireline-round6-design.md, workstream B).
import { heroKeptBack, heroPlan } from './aiHeroes';
// round6:C. Generals (fireline-round6-design.md, workstream C).
import { generalPlan } from './aiGenerals';

/**
 * The computer commander. It plays by the same rules and the same orders as the player: it pays
 * for everything, places structures through the same placement check, and its units fight with
 * the same code. Two things differ, both stated in the lobby: it sees the whole map, and on Hard
 * its refineries pay a quarter more.
 *
 * Runs every `period` ticks (Easy is slowest to react). Everything it remembers lives in
 * `s.ai[owner]`, so a replay makes the same decisions. Its arrays are only ever replaced, never
 * changed in place, because `cloneState` copies the memory shallowly.
 *
 * Each decision, in order:
 *  1. Economy first: no refinery or no hauler outranks everything, with queued units cancelled
 *     and spare structures sold to pay for it if need be. A generator goes up before power would
 *     run short, not after.
 *  2. Damaged structures are repaired while credits allow.
 *  3. Units, in a mix that answers what the opponent is fielding.
 *  4. The army: badly hurt units pull back, the base and the haulers are defended, buggies raid
 *     the opponent's haulers (Normal and Hard), and attack waves gather at a staging point, go
 *     in together, regroup when strung out, pick off haulers, artillery and turrets first, and
 *     fall back when broken.
 *
 * In a skirmish on advanced tech (techAllowed: never in a mission, never on standard tech, where
 * all of this is skipped and the commander plays exactly as before) it also:
 *  - builds through the Tech Centre, a Repair Bay, Rocket Turrets, a short sandbag screen in front
 *    of its forward turrets (Normal and Hard, and only where it leaves every route open), and on
 *    Hard a Strike Command;
 *  - trains grenadiers, medics, flame tanks, missile carriers and Bastions, weighted against what
 *    the opponent fields;
 *  - sends hurt vehicles to its Repair Bay, keeps medics with the wave's infantry, and pulls its
 *    units out from under an incoming missile;
 *  - calls its support powers: a recon sweep as a wave sets off, the barrage on the densest knot of
 *    defences or troops it can find, the missile on the opponent's most valuable ground.
 */

/** How each difficulty fights, beyond the numbers in rules.ts that the lobby describes. */
interface Tactics {
  /** Haulers wanted beyond one per refinery (at most four in all). */
  extraHaulers: number;
  /** Buggies in a hauler raid; 0 for none. */
  raidSize: number;
  firstRaid: number;
  raidInterval: number;
  /** Units under this share of health, outside a wave, pull back home. 0 for never. */
  retreatBelow: number;
  /** Structures under this share of health are repaired. */
  repairBelow: number;
  /** Credits kept back before paying for repairs. */
  repairReserve: number;
  /** Explicit attack orders on haulers, artillery and turrets in reach. */
  focus: boolean;
  /** Wave pulls together when strung out. */
  regroup: boolean;
  /** Unit mix follows what the opponent fields. */
  counter: boolean;
  /** Share of a wave that must reach the staging point before it sets off. */
  gatherShare: number;
  // ---- Advanced tech only ----
  /** Rocket Turrets wanted. */
  rocketTurrets: number;
  /** Sandbag walls in the screen in front of the forward turrets. */
  walls: number;
  /** Builds a Strike Command. */
  strike: boolean;
  /** Refineries wanted once the Tech Centre stands (more income for the heavy units). */
  lateRefineries: number;
  /** Aims its barrage and missile at the best target in sight; otherwise at the nearest structure. */
  aimPowers: boolean;
  /** Smallest value (credits' worth of the opponent's things) the barrage is spent on. */
  barrageWorth: number;
  /** Moves its units out from under an enemy missile. */
  dodge: boolean;
  /** Vehicles under this share of health go to the Repair Bay (0 for never). */
  bayBelow: number;
}

const TACTICS: Record<Difficulty, Tactics> = {
  easy: {
    extraHaulers: 0,
    raidSize: 0,
    firstRaid: 0,
    raidInterval: 0,
    retreatBelow: 0,
    repairBelow: 0.4,
    repairReserve: 900,
    focus: false,
    regroup: false,
    counter: false,
    gatherShare: 0.6,
    rocketTurrets: 0,
    walls: 0,
    strike: false,
    lateRefineries: 1,
    aimPowers: false,
    barrageWorth: 0,
    dodge: false,
    bayBelow: 0,
  },
  normal: {
    extraHaulers: 1,
    raidSize: 2,
    firstRaid: 4200,
    raidInterval: 2400,
    retreatBelow: 0.3,
    repairBelow: 0.6,
    repairReserve: 600,
    focus: true,
    regroup: true,
    counter: true,
    gatherShare: 0.75,
    rocketTurrets: 1,
    walls: 3,
    strike: false,
    lateRefineries: 3,
    aimPowers: true,
    barrageWorth: 1500,
    dodge: true,
    bayBelow: 0.4,
  },
  hard: {
    extraHaulers: 2,
    raidSize: 3,
    firstRaid: 3000,
    raidInterval: 1800,
    retreatBelow: 0.3,
    repairBelow: 0.7,
    repairReserve: 400,
    focus: true,
    regroup: true,
    counter: true,
    gatherShare: 0.8,
    rocketTurrets: 2,
    walls: 5,
    strike: true,
    lateRefineries: 3,
    aimPowers: true,
    barrageWorth: 1200,
    dodge: true,
    bayBelow: 0.5,
  },
};

export type AiFn = (s: GameState, owner: Owner) => void;

/**
 * Test hook for scripts/ai-ladder.ts only: play one side with a different commander (the frozen
 * first-build AI), to measure this one against it. Nothing in the game calls it, and with no
 * hook set (the default) both sides run the commander below.
 */
const hooks: (AiFn | null)[] = [null, null, null, null];
export function setAutopilotAi(fn: AiFn | null, owner: Owner = 0): void {
  hooks[owner] = fn;
}

/** The difficulty a side plays at: side 0 only plays at all in the harness (autopilot). */
export function aiDifficulty(s: GameState, owner: Owner): Difficulty {
  return owner === 0 && s.autopilotDifficulty ? s.autopilotDifficulty : s.difficulty;
}

export function runAi(s: GameState, owner: Owner): void {
  // A passive mission enemy makes no decisions at all: its outpost and scripted units still fight
  // whatever comes in range, through the engine's own targeting.
  if (missionMode(s, owner) === 'passive') return;
  const hook = hooks[owner];
  if (hook) hook(s, owner);
  else commander(s, owner);
}

interface Pt {
  x: number;
  y: number;
}

/** How the computer behaves on this side: a mission's mode for every computer side, 'normal' otherwise. */
export function missionMode(s: GameState, owner: Owner): AiMode {
  return owner !== 0 && s.mission ? s.mission.ai : 'normal';
}

/**
 * The difficulty's numbers, adjusted for a mission mode. Raid: small waves twice as often. The
 * other modes use the numbers as they are; defend is handled by never letting a wave or raid fall due.
 */
function tuned(d: DifficultySpec, mode: AiMode): DifficultySpec {
  if (mode !== 'raid') return d;
  return {
    ...d,
    firstAttack: Math.round(d.firstAttack / 2),
    attackInterval: Math.round(d.attackInterval / 2),
    firstWave: 3,
    waveGrowth: 1,
    waveCap: Math.min(6, d.waveCap),
  };
}

function commander(s: GameState, owner: Owner): void {
  const diff = aiDifficulty(s, owner);
  const mode = missionMode(s, owner);
  // round5:B begin. Larger maps (fireline-round5-design.md): B may replace the line below with one
  // that scales the numbers for the map's size (a function in aiScale.ts); 'standard' maps unchanged.
  const d = scaledFor(s, tuned(DIFFICULTIES[diff], mode));
  // round5:B end.
  const t = TACTICS[diff];
  const mem = s.ai[owner];
  normalise(mem);
  // Defend: build, repair and fight off attackers, but never send a wave or a raid. Pushed back at
  // every decision, so nothing can fall due in between.
  if (mode === 'defend') {
    mem.nextAttack = Math.max(mem.nextAttack, s.tick + 100000);
    mem.nextRaid = Math.max(mem.nextRaid, s.tick + 100000);
  }
  // Raid: the first wave comes at the raid timing, not the skirmish one the memory started with.
  if (mode === 'raid' && mem.wave === 0) mem.nextAttack = Math.min(mem.nextAttack, d.firstAttack);
  // The advanced tech: a skirmish set up with it. Never a mission, never standard tech, where none
  // of the advanced play below runs and the commander plays exactly as it always has.
  const adv = !s.mission && techAllowed(s, owner, 'techcentre');
  const mine = s.buildings.filter(b => b.owner === owner);
  if (!mine.length) return;
  // Walls are not structures: never the anchor, never a wave's target.
  const anchor = mine.find(b => b.kind === 'hq') ?? mine.find(isStructure) ?? mine[0];
  const home = buildingCentre(anchor);
  // Everything on another team is the enemy. With several enemies the lists hold all of them and
  // the first enemy Command Yard stands for "their base".
  // round4:B begin. Choosing among several enemies (fireline-round4-design.md, workstream B) replaces
  // the lines from here to "round4:B end", keeping the names enemy, enemyHome, units and foes.
  // With several enemies, `enemy` and `enemyHome` are the chosen enemy's (chooseEnemy, aiSides.ts);
  // `foes` is every enemy's units, so defence still answers anyone. One enemy: as before.
  const { enemy, enemyHome } = enemyLists(s, owner, chooseEnemy(s, owner));
  const units = s.units.filter(u => u.owner === owner);
  const foes = s.units.filter(u => isEnemy(s, owner, u.owner));
  // round4:B end.
  const p = s.players[owner];
  const vq = p.queues.vehicle;
  const iq = p.queues.infantry;

  // 1. Economy and structures.
  const haulers = units.filter(u => u.kind === 'hauler');
  const refineries = countBuildings(s, owner, 'refinery');
  const noRefinery = refineries === 0;
  const noHauler = haulers.length === 0 && !vq.some(q => q.kind === 'hauler');
  const canBuildHauler = unlocked(s, owner, 'hauler');
  const crisis = noRefinery || (noHauler && !p.queues.building.some(q => q.kind === 'refinery'));

  let saving = false;
  const ready = readyStructure(s, owner);
  if (ready) {
    const spot = ready === 'wall' ? wallSpot(s, owner, home, enemyHome) : (expansionSpot(s, owner, ready, enemyHome) ?? findSpot(s, owner, ready, home, enemyHome));
    if (spot) doPlace(s, owner, ready, spot.x, spot.y);
    else doCancel(s, owner, 'building', ready);
  } else if (p.queues.building.length === 0 && mine.some(b => b.kind === 'hq' || b.kind === 'fieldyard')) {
    // Only with a Command Yard: a mission outpost has none, and a structure it queued could never
    // be built, leaving its credits stuck in the queue.
    let want = nextStructure(s, owner, d, noHauler && !canBuildHauler, adv ? diff : null);
    // With the advanced tech, the costly extras wait until the army at home is up to the next
    // wave's size and to the opponent's army: until then the credits go on units, and the extra
    // is bought out of the surplus.
    let held = false;
    if (want && adv && isExtra(s, owner, want, d)) {
      const armed = units.filter(u => unitSpecOf(s, u).weapon).length;
      const foeArmy = s.units.filter(u => isEnemy(s, owner, u.owner) && unitSpecOf(s, u).weapon).length;
      if (armed < Math.max(Math.min(d.waveCap, d.firstWave + mem.wave * d.waveGrowth), foeArmy * 0.9)) {
        want = null;
        held = true;
      }
    }
    // Once the turrets stand (the plan done, or only an extra left), a sandbag screen in front of
    // them, a wall at a time, only where one fits without closing a route, and tried every few
    // seconds rather than every decision.
    if ((!want || held) && adv && t.walls && !crisis && p.credits > 500 && s.tick % 240 < d.period) {
      if (countBuildings(s, owner, 'wall') < t.walls && countBuildings(s, owner, 'turret') >= d.turrets && wallSpot(s, owner, home, enemyHome))
        want = 'wall';
    }
    if (want) {
      if (canQueue(s, owner, 'building', want)) doQueue(s, owner, 'building', want);
      else if (unlocked(s, owner, want)) {
        saving = true;
        if (crisis && (want === 'refinery' || want === 'power')) raiseFunds(s, owner, buildingSpec(s, owner, want).cost);
      }
    }
  }

  // Haulers beyond one per refinery: a refinery unloads far faster than one hauler can fill.
  const wantHaulers = Math.min(4, refineries + t.extraHaulers);
  if (haulers.length < wantHaulers && !vq.some(q => q.kind === 'hauler') && canBuildHauler) {
    if (canQueue(s, owner, 'vehicle', 'hauler')) doQueue(s, owner, 'vehicle', 'hauler');
    else if (haulers.length === 0) {
      // No hauler at all: nothing else matters until one is on its way.
      saving = true;
      raiseFunds(s, owner, unitSpec(s, owner, 'hauler').cost);
    }
  }

  // Broke: no hauler, none queued, no refinery on the way and not enough to buy one.
  // With the advanced tech, also broke when the map's ore is all gone: no income can come, so
  // waiting only lets the army waste away (and the extras are sold off below for one last push).
  const dry = adv && !s.ore.some(o => o > 0);
  const broke =
    (dry && p.credits < 1000) ||
    (!s.units.some(u => u.owner === owner && u.kind === 'hauler') &&
      !vq.some(q => q.kind === 'hauler') &&
      !p.queues.building.some(q => q.kind === 'refinery') &&
      p.credits < unitSpec(s, owner, 'hauler').cost);
  if (dry && p.credits < 300 && !p.queues.building.length && standingProducer(s, owner)) {
    const extra = (['strikecommand', 'repairbay', 'techcentre', 'uplink', 'wall'] as BuildingKind[])
      .map(k => s.buildings.find(b => b.owner === owner && b.kind === k))
      .find(b => !!b);
    if (extra) doSell(s, owner, extra.id);
  }

  // 2. Repairs, most important structures first, two at a time, while credits allow.
  const repairOrder: BuildingKind[] = [
    'hq',
    'refinery',
    'factory',
    'turret',
    'rocketturret',
    'power',
    'techcentre',
    'strikecommand',
    'barracks',
    'repairbay',
    'uplink',
  ];
  // raiseFunds may have sold one. Walls are never repaired: a new one costs less.
  const standing = s.buildings.filter(b => b.owner === owner && isStructure(b));
  let repairing = standing.filter(b => b.repairing).length;
  if ((saving || crisis) && repairing) {
    for (const b of standing) if (b.repairing) doRepair(s, b.id);
    repairing = 0;
  } else {
    const hurt = standing
      .filter(b => !b.repairing && b.hp < buildingSpecOf(s, b).hp * t.repairBelow && repairOrder.includes(b.kind))
      .sort((a, b) => repairOrder.indexOf(a.kind) - repairOrder.indexOf(b.kind) || a.id - b.id);
    for (const b of hurt) {
      if (repairing >= 2 || p.credits < t.repairReserve) break;
      doRepair(s, b.id);
      repairing++;
    }
  }

  // 3. Units. A defending mission enemy only replaces losses up to the garrison it started with: with
  // a refinery and no cap, the outpost in Demolition trained a rifleman every five seconds and had
  // over fifty by the time the Commando arrived.
  if (mode === 'defend') {
    const armed = units.filter(u => unitSpecOf(s, u).weapon && !u.hero).length;
    if (mem.garrison === undefined) mem.garrison = armed;
    if (armed >= mem.garrison) saving = true;
  }
  const foeArmed = foes.filter(u => unitSpecOf(s, u).weapon);
  const foeInfantry = foeArmed.filter(u => unitSpecOf(s, u).armor === 'infantry').length;
  const foeArmour = foeArmed.length - foeInfantry;
  const foeTurrets = enemy.filter(b => b.kind === 'turret' || b.kind === 'rocketturret').length;
  const raidBuggies = units.filter(u => u.kind === 'buggy').length;
  // round6:A begin. Two armies (fireline-round6-design.md): A may change the unit choices from here
  // to "round6:A end" (and the lists in advancedUnits and nextStructure) by the side's army;
  // Meridian's choices stay exactly as they are.
  if (!saving && adv) {
    const nextRaid = mem.raidIds.length > 0 ? Infinity : Math.max(mem.nextRaid, t.firstRaid);
    advancedUnits(s, owner, t, units, foeInfantry, foeArmour, foeTurrets, raidBuggies, nextRaid);
  } else if (!saving) {
    if (iq.length < 2) {
      let riflemen = 0.6;
      if (t.counter && foeArmed.length >= 4) riflemen = foeInfantry > foeArmour * 1.5 ? 0.8 : foeArmour > foeInfantry * 1.5 ? 0.35 : 0.6;
      const kind: UnitKind = draw(s) < riflemen ? 'rifleman' : 'rocketeer';
      if (canQueue(s, owner, 'infantry', kind)) doQueue(s, owner, 'infantry', kind);
    }
    if (vq.length < 1) {
      const roll = draw(s);
      let tank = 0.55;
      let buggy = 0.23;
      if (t.counter) {
        if (foeInfantry > foeArmour * 1.5 && foeArmed.length >= 4) buggy = 0.33;
        if (foeTurrets >= 3) {
          tank = 0.5;
          buggy = 0.15;
        }
      }
      let kind: UnitKind = roll < tank ? 'tank' : roll < tank + buggy ? 'buggy' : 'artillery';
      // Keep the raiding party up to strength once raids are due.
      if (t.raidSize && raidBuggies < t.raidSize && s.tick >= t.firstRaid - 900) kind = 'buggy';
      if (!unlocked(s, owner, kind)) kind = 'tank';
      if (canQueue(s, owner, 'vehicle', kind)) doQueue(s, owner, 'vehicle', kind);
    }
  }
  // round6:A end.

  // round4:A. Air units, anti-air and research (fireline-round4-design.md, workstream A): one call
  // into aiAir.ts goes on the line below this comment, and nothing else in this function changes.
  airPlan(s, owner, home, enemy, foes);

  // round5:C begin. Engineering vehicles (fireline-round5-design.md): one call into aiEngineering.ts
  // goes on the line below this comment, and nothing else in this function changes.
  engineeringPlan(s, owner, home, enemyHome, units, foes);
  // round5:C end.
  // round5:D begin. Neutral sites and tier three (fireline-round5-design.md): one call into
  // aiSites.ts goes on the line below this comment, and nothing else in this function changes.
  sitesPlan(s, owner, home, enemyHome, units, foes);
  // round5:D end.
  // round6:B begin. Heroes in free play (fireline-round6-design.md): one call into aiHeroes.ts goes
  // on the line below this comment (recruiting and errands), and nothing else in this function changes.
  heroPlan(s, owner, home, enemy, units, foes);
  // round6:B end.
  // round6:C begin. Generals (fireline-round6-design.md): one call into aiGenerals.ts goes on the
  // line below this comment (recruiting, keeping with the wave, retreating), and nothing else here.
  generalPlan(s, owner, home, enemyHome, units);
  // round6:C end.

  // Producers send new units to a staging point on the side facing the enemy.
  const stage = openGround(s, owner, toward(home, enemyHome, stageDistance(s)));
  for (const b of standing) {
    if ((b.kind === 'barracks' || b.kind === 'factory') && !b.rally) doRally(s, b.id, stage.x, stage.y);
  }

  // 4. The army.
  const alive = new Map(units.map(u => [u.id, u]));
  let waveIds = mem.waveIds.filter(id => alive.has(id));
  let raidIds = mem.raidIds.filter(id => alive.has(id));
  const army = units.filter(u => unitSpecOf(s, u).weapon && !keptBack(s, u));
  const inWave = new Set(waveIds);
  const inRaid = new Set(raidIds);
  const retreatTo = openGround(s, owner, toward(home, enemyHome, 4));
  // Advanced tech: hurt vehicles go to the Repair Bay instead, to the free tiles round it.
  const bay = adv && t.bayBelow > 0 ? nearestOwn(standing, 'repairbay', home.x, home.y) : null;
  const bayTiles = bay ? bayStands(s, bay) : [];
  const bayC = bay ? buildingCentre(bay) : null;
  const atBay = (x: number, y: number) => !!bay && distToBuilding(x, y, bay) < 2.5;
  const retreating = (u: Unit) =>
    u.order.type === 'move' && (dist(u.order.x, u.order.y, retreatTo.x, retreatTo.y) < 3 || (!!bayC && atBay(u.order.x, u.order.y)));
  const toBay = (u: Unit) => !!bayTiles.length && UNITS[u.kind].category === 'vehicle';
  const maxHp = (u: Unit) => u.maxHp ?? unitSpecOf(s, u).hp;

  // Badly hurt units outside a wave come home rather than die for nothing.
  if (t.retreatBelow > 0) {
    const back: number[] = [];
    const mend: Unit[] = [];
    for (const u of army) {
      if (toBay(u)) {
        // A vehicle outside a wave, or one in a wave that is out of the fight and nearly done for.
        const share = inWave.has(u.id) ? t.bayBelow * 0.5 : t.bayBelow;
        if (u.hp >= maxHp(u) * share || (inWave.has(u.id) && u.engage) || atBay(u.x, u.y) || retreating(u)) continue;
        mend.push(u);
        if (inRaid.has(u.id)) inRaid.delete(u.id);
        if (inWave.has(u.id)) inWave.delete(u.id);
        continue;
      }
      if (inWave.has(u.id) || u.hp >= unitSpecOf(s, u).hp * t.retreatBelow) continue;
      if (dist(u.x, u.y, home.x, home.y) < 9 || retreating(u)) continue;
      back.push(u.id);
      if (inRaid.has(u.id)) inRaid.delete(u.id);
    }
    if (back.length) doMove(s, owner, back, retreatTo.x, retreatTo.y, false);
    mend.forEach((u, i) => {
      const k = bayTiles[(u.id + i) % bayTiles.length];
      doMove(s, owner, [u.id], (k % s.mapW) + 0.5, ((k / s.mapW) | 0) + 0.5, false);
    });
    raidIds = raidIds.filter(id => inRaid.has(id));
    if (mend.length) waveIds = waveIds.filter(id => inWave.has(id));
  }

  // Advanced tech: get out from under an enemy missile while it is in the air.
  if (adv && t.dodge) dodgeMissiles(s, owner, units);

  const reserve = army.filter(u => !inWave.has(u.id) && !inRaid.has(u.id) && !retreating(u));
  const free = (u: Unit) => u.order.type === 'idle' || (u.order.type === 'move' && dist(u.order.x, u.order.y, stage.x, stage.y) < 4);

  // Defend the base: a structure hit lately, or armed enemies close to the yard.
  let threat: Pt | null = s.tick - mem.hurtTick < 40 ? { x: mem.hurtX, y: mem.hurtY } : null;
  if (!threat) {
    let best = 15;
    for (const f of foeArmed) {
      const fd = dist(f.x, f.y, home.x, home.y);
      if (fd < best) {
        best = fd;
        threat = { x: f.x, y: f.y };
      }
    }
  }
  if (threat) {
    const defenders = reserve.filter(u => free(u) && dist(u.x, u.y, home.x, home.y) < 22).map(u => u.id);
    // A wave still gathering at home turns round to help.
    if (mem.wavePhase === 1) for (const id of waveIds) if (alive.get(id)!.order.type !== 'attack') defenders.push(id);
    if (defenders.length) doMove(s, owner, defenders, threat.x, threat.y, true);
  }

  // Defend the haulers: nearby reserves answer anything armed close to one, and a badly hurt
  // hauler runs for its refinery.
  if (t.retreatBelow > 0) {
    for (const h of haulers) {
      const near = foeArmed.find(f => dist(f.x, f.y, h.x, h.y) < 5);
      if (!near) continue;
      const helpers = reserve
        .filter(u => free(u) && dist(u.x, u.y, h.x, h.y) < 16)
        .slice(0, 4)
        .map(u => u.id);
      if (helpers.length) doMove(s, owner, helpers, near.x, near.y, true);
      if (h.hp < unitSpec(s, owner, 'hauler').hp * 0.5 && h.order.type === 'harvest' && h.order.phase !== 'return' && h.order.phase !== 'unload') {
        const ref = nearestOwn(standing, 'refinery', h.x, h.y);
        if (ref) doHarvest(s, owner, [h.id], undefined, ref.id);
      }
    }
  }

  // Raids: a few buggies hunt the opponent's haulers away from its turrets, and leave when they
  // run into a turret or have taken too much.
  if (t.raidSize > 0 && enemy.length) {
    const foeHaulers = foes.filter(u => u.kind === 'hauler');
    const turrets = enemy.filter(b => b.kind === 'turret');
    const turretNear = (x: number, y: number, r: number) => turrets.some(b => distToBuilding(x, y, b) < r);
    const safest = (from: Pt): Unit | null => {
      let best: Unit | null = null;
      let bestScore = -Infinity;
      for (const h of foeHaulers) {
        let safety = 20;
        for (const b of turrets) safety = Math.min(safety, distToBuilding(h.x, h.y, b));
        if (safety < 7) continue;
        const score = safety - dist(from.x, from.y, h.x, h.y) * 0.3;
        if (score > bestScore) {
          bestScore = score;
          best = h;
        }
      }
      return best;
    };
    if (raidIds.length === 0) {
      if (s.tick >= Math.max(mem.nextRaid, t.firstRaid)) {
        const buggies = reserve.filter(u => u.kind === 'buggy' && free(u) && u.hp >= unitSpec(s, owner, 'buggy').hp * 0.6);
        const target = buggies.length >= t.raidSize ? safest(stage) : null;
        if (target) {
          raidIds = buggies.slice(0, t.raidSize).map(u => u.id);
          mem.raidTarget = target.id;
          mem.nextRaid = s.tick; // While a raid is out, nextRaid holds the tick it set out.
          doAttack(s, owner, raidIds, target.id);
        }
      }
    } else {
      const raiders = raidIds.map(id => alive.get(id)!);
      const hp = raiders.reduce((a, u) => a + u.hp, 0);
      const full = raiders.length * unitSpec(s, owner, 'buggy').hp;
      const lead = raiders[0];
      const danger = raiders.some(u => turretNear(u.x, u.y, 7)) || hp < full * 0.45 || s.tick - mem.nextRaid > 1500;
      let target = foeHaulers.find(h => h.id === mem.raidTarget) ?? null;
      if (!danger && !target) {
        target = safest(lead);
        if (target) mem.raidTarget = target.id;
      }
      if (danger || !target) {
        doMove(s, owner, raidIds, stage.x, stage.y, false);
        raidIds = [];
        mem.raidTarget = 0;
        mem.nextRaid = s.tick + t.raidInterval;
      } else {
        const strays = raiders.filter(u => !(u.order.type === 'attack' && u.order.target === target!.id)).map(u => u.id);
        if (strays.length) doAttack(s, owner, strays, target.id);
      }
    }
  }

  // Attack waves.
  const waveUnits = () => waveIds.map(id => alive.get(id)!);
  const size = Math.min(d.waveCap, d.firstWave + mem.wave * d.waveGrowth);
  const recruits = (): Unit[] => {
    // Leave the raiders' buggies at home for the next raid.
    let keep = broke ? 0 : t.raidSize;
    return reserve.filter(u => {
      if (!broke && (u.hp < unitSpecOf(s, u).hp * 0.45 || dist(u.x, u.y, home.x, home.y) > reserveRadius(s))) return false;
      if (u.order.type !== 'idle' && u.order.type !== 'move' && u.order.type !== 'attackMove') return false;
      if (u.kind === 'buggy' && keep > 0) {
        keep--;
        return false;
      }
      return true;
    });
  };
  if (mem.wavePhase === 0) {
    if (!threat && s.tick >= mem.nextAttack && enemy.length) {
      const fit = recruits();
      // A wave that has waited a whole extra interval goes with what it has; with no income left
      // and none coming, everything goes now, since waiting can only make it weaker.
      const overdue = (s.tick >= mem.nextAttack + d.attackInterval && fit.length >= d.firstWave) || (broke && fit.length > 0);
      if (fit.length >= size || overdue) {
        waveIds = fit.map(u => u.id);
        mem.wavePhase = 1;
        mem.waveTick = s.tick;
        // round6:D begin. Formations: the wave gathers (a shape may be passed to doMove here).
        doMove(s, owner, waveIds, stage.x, stage.y, true);
        // round6:D end.
        mem.wave++;
        mem.nextAttack = s.tick + d.attackInterval;
      }
    }
  } else if (waveIds.length === 0) {
    mem.wavePhase = 0;
  } else if (mem.wavePhase === 1) {
    const members = waveUnits();
    const gathered = members.filter(u => dist(u.x, u.y, stage.x, stage.y) < 6).length;
    if (!threat && (gathered >= members.length * t.gatherShare || s.tick - mem.waveTick > 450)) {
      mem.wavePhase = 2;
      mem.waveTick = s.tick;
      mem.waveSize = members.length;
      const target = pickTarget(enemy, foes, stage, t.focus, home);
      // round6:D begin. Formations: the wave sets off to attack (a wedge, in D's plan).
      doMove(s, owner, waveIds, target.x, target.y, true);
      // round6:D end.
      // A recon sweep over where the wave is going, as it sets off.
      if (adv && powerProblem(s, owner, 'recon', target.x, target.y) === null) doPower(s, owner, 'recon', target.x, target.y);
    } else if (!threat) {
      const lost = members.filter(u => u.order.type === 'idle' && dist(u.x, u.y, stage.x, stage.y) >= 6).map(u => u.id);
      if (lost.length) doMove(s, owner, lost, stage.x, stage.y, true);
    }
  } else {
    const members = waveUnits();
    if (!broke && mem.waveSize >= 3 && members.length < Math.max(2, Math.ceil(mem.waveSize * 0.35))) {
      // Broken: survivors fall back to the staging point and join the next wave.
      doMove(s, owner, waveIds, stage.x, stage.y, false);
      waveIds = [];
      mem.wavePhase = 0;
      mem.nextAttack = Math.min(mem.nextAttack, s.tick + Math.round(d.attackInterval / 2));
    } else if (enemy.length) {
      // The body of the wave: members near the middle. Stragglers far behind (stuck, or
      // still walking from home) are not waited for.
      let core = members;
      let centre = middle(members);
      const near = members.filter(u => dist(u.x, u.y, centre.x, centre.y) < 12);
      if (near.length >= members.length / 2) {
        core = near;
        centre = middle(near);
      }
      const target = pickTarget(enemy, foes, centre, t.focus, home);
      let spread = 0;
      for (const u of core) spread = Math.max(spread, dist(u.x, u.y, centre.x, centre.y));
      const fighting = members.some(u => u.engage);
      if (t.regroup && !fighting && core.length >= 4 && spread > 7 && s.tick - mem.waveTick > 150) {
        // Strung out on the march: pull together a little short of the centre, toward the target.
        const meet = openGround(s, owner, toward(centre, target, 2));
        // round6:D begin. Formations: the wave regroups (a box, in D's plan).
        doMove(s, owner, core.map(u => u.id), meet.x, meet.y, true);
        // round6:D end.
        mem.waveTick = s.tick;
      } else {
        const idle = members.filter(u => u.order.type === 'idle' && !u.engage).map(u => u.id);
        if (idle.length) doMove(s, owner, idle, target.x, target.y, true);
      }
      if (t.focus) focusFire(s, owner, members, foes, enemy);
      // Reinforcements: when the next wave is due, what has gathered at home joins this one.
      if (!threat && s.tick >= mem.nextAttack) {
        const fit = recruits();
        if (fit.length >= Math.min(size, d.firstWave) || (broke && fit.length > 0)) {
          const ids = fit.map(u => u.id);
          doMove(s, owner, ids, target.x, target.y, true);
          waveIds = waveIds.concat(ids);
          mem.waveSize = waveIds.length;
          mem.wave++;
          mem.nextAttack = s.tick + d.attackInterval;
        }
      }
    }
  }

  if (adv) {
    // Medics keep with the wave's infantry while it is out, and wait at the staging point otherwise.
    const waveInf = mem.wavePhase === 2 ? waveIds.map(id => alive.get(id)!).filter(u => UNITS[u.kind].category === 'infantry') : [];
    const meet = waveInf.length >= 2 ? middle(waveInf) : stage;
    const near = waveInf.length >= 2 ? 3 : 6;
    const follow = units.filter(u => UNITS[u.kind].medic && u.order.type === 'idle' && dist(u.x, u.y, meet.x, meet.y) > near).map(u => u.id);
    if (follow.length) doMove(s, owner, follow, meet.x, meet.y, false);
    useStrikes(s, owner, t, home, enemy, foes, mem.wavePhase === 2 ? waveIds.map(id => alive.get(id)!) : []);
  }

  // round4:B. Allies (fireline-round4-design.md, workstream B): one call into aiSides.ts goes on the
  // line below this comment.
  alliedPlan(s, owner, home, stage, waveIds.concat(raidIds), !!threat);

  mem.waveIds = waveIds;
  mem.raidIds = raidIds;
}

/**
 * Units the wave, raid and retreat code leaves alone because a plan of their own commands them
 * (round 6). None before round 6, so `army` is every armed unit, as it always was.
 */
function keptBack(s: GameState, u: Unit): boolean {
  // round6:B begin. Heroes in free play: true for a skirmish hero its own plan commands (aiHeroes.ts).
  if (heroKeptBack(s, u)) return true;
  // round6:B end.
  // round6:C begin. Generals: true for the field General, which its own plan keeps behind the wave.
  if (u.kind === 'general') return true;
  // round6:C end.
  return false;
}

/** Memory from a save made before these fields existed. */
function normalise(mem: AiMemory): void {
  if (!Array.isArray(mem.waveIds)) mem.waveIds = [];
  if (!Array.isArray(mem.raidIds)) mem.raidIds = [];
  if (typeof mem.wavePhase !== 'number') mem.wavePhase = 0;
  if (typeof mem.waveTick !== 'number') mem.waveTick = 0;
  if (typeof mem.waveSize !== 'number') mem.waveSize = 0;
  if (typeof mem.raidTarget !== 'number') mem.raidTarget = 0;
  if (typeof mem.nextRaid !== 'number') mem.nextRaid = 0;
}

/**
 * Credits for the one thing the economy cannot do without: cancel queued units (refunded in
 * full), then sell what can be spared, least useful first. Never the yard, a generator, a
 * refinery or a factory.
 */
function raiseFunds(s: GameState, owner: Owner, need: number): void {
  const p = s.players[owner];
  if (p.credits >= need) return;
  for (const cat of ['vehicle', 'infantry'] as const) {
    const q = p.queues[cat];
    while (q.length && p.credits < need) {
      const last = q[q.length - 1];
      if (last.kind === 'hauler') break;
      doCancel(s, owner, cat, last.kind);
    }
  }
  if (p.credits >= need) return;
  // Selling only helps if there is no income coming: with a hauler working, wait for it.
  if (s.units.some(u => u.owner === owner && u.kind === 'hauler') && countBuildings(s, owner, 'refinery') > 0) return;
  // And only if selling everything spare would actually reach the sum: otherwise keep it all.
  // With the advanced tech, the expensive extras go first: the economy comes before all of them.
  const order: BuildingKind[] = !s.mission && techAllowed(s, owner, 'techcentre')
    ? ['strikecommand', 'repairbay', 'uplink', 'rocketturret', 'turret', 'techcentre', 'barracks']
    : ['uplink', 'turret', 'barracks'];
  const spare = s.buildings.filter(v => v.owner === owner && order.includes(v.kind));
  const refund = (b: Building) => Math.floor((buildingSpecOf(s, b).cost * SELL_RETURN * (b.hp / buildingSpecOf(s, b).hp)) / 10) * 10;
  if (p.credits + spare.reduce((a, b) => a + refund(b), 0) < need) return;
  for (const kind of order) {
    const b = spare.find(v => v.kind === kind);
    if (b) {
      doSell(s, owner, b.id);
      return;
    }
  }
}

/**
 * Where a wave goes next. Haulers, artillery and turrets count as nearer than they are; other
 * structures by how much they matter. Easy just walks to the nearest structure from home.
 */
function pickTarget(enemy: Building[], foes: Unit[], from: Pt, focus: boolean, home: Pt): Pt {
  if (!focus) return buildingCentre(nearestBuilding(enemy, home.x, home.y));
  const bonus: Partial<Record<BuildingKind, number>> = {
    turret: 8,
    rocketturret: 8,
    refinery: 6,
    strikecommand: 6,
    techcentre: 5,
    factory: 4,
    uplink: 3,
    repairbay: 3,
    power: 2,
    barracks: 2,
    hq: 1,
  };
  let best: Pt = buildingCentre(enemy[0]);
  let bestScore = Infinity;
  for (const b of enemy) {
    const c = buildingCentre(b);
    const score = dist(from.x, from.y, c.x, c.y) - (bonus[b.kind] ?? 0);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  for (const u of foes) {
    if (u.kind !== 'hauler' && u.kind !== 'artillery' && u.kind !== 'missilecarrier') continue;
    const score = dist(from.x, from.y, u.x, u.y) - 9;
    if (score < bestScore) {
      bestScore = score;
      best = { x: u.x, y: u.y };
    }
  }
  return best;
}

/**
 * Explicit attack orders on the targets that matter most, for the wave members whose weapons
 * work on them: haulers, artillery and turrets almost in range, for units not already in a
 * firefight. Units already on such an order
 * keep it; when the target dies they go idle and the wave re-targets them.
 */
function focusFire(s: GameState, owner: Owner, members: Unit[], foes: Unit[], enemy: Building[]): void {
  const priority: { id: number; x: number; y: number; armor: 'heavy' | 'light' | 'building'; b?: Building }[] = [];
  for (const u of foes)
    if (u.kind === 'hauler' || u.kind === 'artillery' || u.kind === 'missilecarrier') priority.push({ id: u.id, x: u.x, y: u.y, armor: unitSpecOf(s, u).armor as 'heavy' | 'light' });
  for (const b of enemy) if (b.kind === 'turret' || b.kind === 'rocketturret') priority.push({ id: b.id, x: b.x + 0.5, y: b.y + 0.5, armor: 'building', b });
  if (!priority.length) return;
  const ids = new Set(priority.map(q => q.id));
  const armed = new Set(foes.filter(f => unitSpecOf(s, f).weapon && f.kind !== 'artillery' && f.kind !== 'missilecarrier').map(f => f.id));
  const orders = new Map<number, number[]>();
  for (const u of members) {
    if (u.order.type === 'attack' && ids.has(u.order.target)) continue;
    if (u.order.type !== 'attackMove' && u.order.type !== 'idle') continue;
    // Never turn away from something that is shooting back: that fight comes first.
    if (u.engage && armed.has(u.engage)) continue;
    const w = unitSpecOf(s, u).weapon;
    if (!w) continue;
    let best = 0;
    // Only targets about to come into range, so nobody chases across the map.
    let bestD = w.range + 1;
    for (const q of priority) {
      if (DAMAGE_VS[w.kind][q.armor] < 0.6) continue;
      const qd = q.b ? distToBuilding(u.x, u.y, q.b) : dist(u.x, u.y, q.x, q.y);
      if (qd < bestD) {
        bestD = qd;
        best = q.id;
      }
    }
    if (!best) continue;
    const list = orders.get(best);
    if (list) list.push(u.id);
    else orders.set(best, [u.id]);
  }
  for (const [target, list] of orders) doAttack(s, owner, list, target);
}

function nearestOwn(mine: Building[], kind: BuildingKind, x: number, y: number): Building | null {
  const list = mine.filter(b => b.kind === kind);
  return list.length ? nearestBuilding(list, x, y) : null;
}

function middle(list: Unit[]): Pt {
  let x = 0;
  let y = 0;
  for (const u of list) {
    x += u.x;
    y += u.y;
  }
  return { x: x / list.length, y: y / list.length };
}

function draw(s: GameState): number {
  const r = next(s.rngSeed);
  s.rngSeed = r.seed;
  return r.value;
}

function toward(a: Pt, b: Pt, by: number): Pt {
  const d = dist(a.x, a.y, b.x, b.y) || 1;
  return { x: a.x + ((b.x - a.x) / d) * by, y: a.y + ((b.y - a.y) / d) * by };
}

/**
 * The nearest point to `p` with clear ground two tiles all round: somewhere an army can wait.
 * A side in the top half (side 1) searches in the mirrored order, so on the point-symmetric map both sides choose the
 * mirror image of each other's spot rather than both leaning top-left.
 */
function openGround(s: GameState, owner: Owner, p: Pt): Pt {
  const occ = occupancy(s);
  const cx = Math.floor(p.x);
  const cy = Math.floor(p.y);
  const sign = frontDir(s, owner);
  for (let r = 0; r <= 10; r++)
    for (let iy = -r; iy <= r; iy++)
      for (let ix = -r; ix <= r; ix++) {
        if (Math.max(Math.abs(ix), Math.abs(iy)) !== r) continue;
        const dx = ix * sign;
        const dy = iy * sign;
        let ok = true;
        for (let ey = -2; ey <= 2 && ok; ey++)
          for (let ex = -2; ex <= 2; ex++)
            if (!passable(s, occ, cx + dx + ex, cy + dy + ey)) {
              ok = false;
              break;
            }
        if (ok) return { x: cx + dx + 0.5, y: cy + dy + 0.5 };
      }
  return p;
}

function nearestBuilding(list: Building[], x: number, y: number): Building {
  let best = list[0];
  let bestD = Infinity;
  for (const b of list) {
    const c = buildingCentre(b);
    const d = dist(x, y, c.x, c.y);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/** True while this side has a Barracks or a War Factory to spend credits in. */
function standingProducer(s: GameState, owner: Owner): boolean {
  return s.buildings.some(b => b.owner === owner && (b.kind === 'barracks' || b.kind === 'factory'));
}

/** A structure beyond what the economy and the basic defences need (advanced tech only). */
function isExtra(s: GameState, owner: Owner, kind: BuildingKind, d: DifficultySpec): boolean {
  if (kind === 'refinery') return countBuildings(s, owner, 'refinery') >= d.refineries;
  return kind === 'techcentre' || kind === 'strikecommand' || kind === 'repairbay' || kind === 'rocketturret';
}

/**
 * The next structure to build. A refinery comes first whenever there is none, and whenever there
 * is no hauler and no factory to build one (a refinery brings its own). A generator goes up
 * before a structure would take power below a safe margin, never after the lights dim.
 */
function nextStructure(
  s: GameState,
  owner: Owner,
  d: DifficultySpec,
  needRefineryForHauler: boolean,
  advanced: Difficulty | null,
): BuildingKind | null {
  const pw = powerOf(s, owner);
  const headroom = pw.made - pw.used;
  const count = (k: BuildingKind) => countBuildings(s, owner, k);
  const powerFor = (k: BuildingKind): BuildingKind => {
    if (!unlocked(s, owner, k)) return 'power';
    return headroom + buildingSpec(s, owner, k).power < 10 ? 'power' : k;
  };
  if (count('refinery') === 0) return powerFor('refinery');
  if (needRefineryForHauler && count('refinery') < 4) return powerFor('refinery');
  if (headroom < 25 && count('power') < 12) return 'power';
  const t = advanced ? TACTICS[advanced] : null;
  const plan: [BuildingKind, number][] = t
    ? [
        // Advanced tech: the original base first (the early army matters more than any tech),
        // then the Repair Bay, the Tech Centre, Rocket Turrets, a refinery more to pay for the
        // heavy units, and on Hard the Strike Command.
        ['barracks', 1],
        ['factory', 1],
        ['refinery', d.refineries],
        ['turret', 1],
        ['uplink', 1],
        ['turret', d.turrets],
        ['factory', d.factories],
        ['repairbay', t.bayBelow > 0 ? 1 : 0],
        ['techcentre', 1],
        ['rocketturret', t.rocketTurrets],
        ['refinery', Math.max(d.refineries, t.lateRefineries)],
        ['strikecommand', t.strike ? 1 : 0],
        ['repairbay', 1],
      ]
    : [
        ['barracks', 1],
        ['factory', 1],
        ['refinery', d.refineries],
        ['turret', 1],
        ['uplink', 1],
        ['turret', d.turrets],
        ['factory', d.factories],
      ];
  for (const [k, n] of plan) {
    if (count(k) >= n) continue;
    if (!unlocked(s, owner, k)) continue;
    return powerFor(k);
  }
  return null;
}

/**
 * Somewhere legal to put a structure, nearest a focus point, keeping a one-tile lane free all
 * round so the base never walls itself in. Turrets go out toward the enemy; refineries toward ore.
 */
function findSpot(s: GameState, owner: Owner, kind: BuildingKind, home: Pt, enemyHome: Pt): Pt | null {
  const spec = buildingSpec(s, owner, kind);
  let focus = home;
  if (kind === 'turret' || kind === 'rocketturret') focus = toward(home, enemyHome, 7);
  // The Repair Bay on the near side, where the army comes home; the costliest structures behind.
  if (kind === 'repairbay') focus = toward(home, enemyHome, 4);
  if (kind === 'techcentre' || kind === 'strikecommand') focus = toward(home, enemyHome, -4);
  if (kind === 'refinery') {
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < s.ore.length; k++) {
      if (s.ore[k] <= 0) continue;
      const d = dist(home.x, home.y, (k % s.mapW) + 0.5, ((k / s.mapW) | 0) + 0.5);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best >= 0) focus = toward(home, { x: (best % s.mapW) + 0.5, y: ((best / s.mapW) | 0) + 0.5 }, Math.min(bestD * 0.6, 7));
  }
  const occ = occupancy(s);
  const candidates: [number, number, number][] = [];
  const fx = Math.round(focus.x);
  const fy = Math.round(focus.y);
  for (let y = fy - 12; y <= fy + 12; y++)
    for (let x = fx - 12; x <= fx + 12; x++) {
      if (!onMap(s, x, y)) continue;
      const cx = x + spec.w / 2;
      const cy = y + spec.h / 2;
      candidates.push([x, y, (cx - focus.x) ** 2 + (cy - focus.y) ** 2]);
    }
  // Ties broken in mirrored order for side 1, so both sides build mirror-image bases.
  const sign = frontDir(s, owner);
  candidates.sort((a, b) => a[2] - b[2] || sign * (a[1] - b[1]) || sign * (a[0] - b[0]));
  for (const [x, y] of candidates) {
    if (placementProblem(s, owner, kind, x, y, occ)) continue;
    let clear = true;
    for (let ty = y - 1; ty <= y + spec.h && clear; ty++)
      for (let tx = x - 1; tx <= x + spec.w; tx++) {
        if (onMap(s, tx, ty) && occ[tileAt(s, tx, ty)]) {
          clear = false;
          break;
        }
      }
    // Leave the row below clear as well, where units come out of barracks and factories.
    const lane = laneRow(s, owner, y, spec.h);
    if (clear && onMap(s, x, lane)) {
      for (let tx = x - 1; tx <= x + spec.w; tx++) if (onMap(s, tx, lane) && occ[tileAt(s, tx, lane)]) clear = false;
    }
    if (clear) return { x, y };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Advanced tech (a skirmish set up with it): the new units, walls, the Repair Bay and the powers.

/**
 * One draw over weighted choices, leaving out what this side cannot train yet. Null when nothing
 * is left (the caller falls back to the basic unit). `fixed` is a roll to use instead of a draw.
 */
function weighted(s: GameState, owner: Owner, choices: [UnitKind, number][], fixed?: number): UnitKind | null {
  const open = choices.filter(([k, w]) => w > 0 && techAllowed(s, owner, k) && unlocked(s, owner, k));
  const total = open.reduce((a, [, w]) => a + w, 0);
  if (!total) return null;
  let roll = (fixed ?? draw(s)) * total;
  for (const [k, w] of open) {
    roll -= w;
    if (roll < 0) return k;
  }
  return open[open.length - 1][0];
}

/**
 * Units with the advanced tech: a medic for every six soldiers (one at most on Easy), grenadiers
 * as the backbone of the infantry, and tanks and flame tanks as the backbone of the vehicles,
 * with artillery, missile carriers and Bastions alongside. Normal and Hard weight it all against
 * what the opponent fields: grenades and flame against infantry, rockets, tanks, missiles and
 * Bastions against armour, artillery, missiles and Bastions (which outrange or outlast turrets)
 * against a ring of turrets. The weights come from equal-credit fights between the kinds in the
 * open: grenadiers beat riflemen and rocketeers outright, tanks and flame tanks beat everything on
 * foot, and missile carriers and Bastions lose a straight fight for their price.
 */
function advancedUnits(
  s: GameState,
  owner: Owner,
  t: Tactics,
  units: Unit[],
  foeInfantry: number,
  foeArmour: number,
  foeTurrets: number,
  raidBuggies: number,
  nextRaid: number,
): void {
  const p = s.players[owner];
  const iq = p.queues.infantry;
  const vq = p.queues.vehicle;
  const read = t.counter && foeInfantry + foeArmour >= 4;
  // Round 6, workstream A: this side's army, and whether any other side plays a different one.
  const army = factionOf(s, owner);
  const twoArmies = s.players.some((_, o) => factionOf(s, o as Owner) !== army);
  const infantryHeavy = read && foeInfantry > foeArmour * 1.5;
  const armourHeavy = read && foeArmour > foeInfantry * 1.5;
  const fortified = t.counter && foeTurrets >= 3;
  // Vehicles first. The choice is fixed until something more is trained (a roll from the count
  // trained, not a draw), so a dear vehicle is saved for rather than re-rolled into a cheap one;
  // while it is saved for, the infantry queue holds one at a time once there are a few soldiers.
  let waiting = 0;
  let waitingFor: UnitKind | null = null;
  const soldiers = units.filter(u => UNITS[u.kind].category === 'infantry' && unitSpecOf(s, u).weapon && !UNITS[u.kind].hero).length;
  if (vq.length < 1 && countBuildings(s, owner, 'factory') > 0) {
    const roll = next((p.stats.trained + 1) * 7919 + owner * 104729).value;
    const vehicles: [UnitKind, number][] = [
      ['tank', armourHeavy ? 6 : 5],
      ['buggy', (infantryHeavy ? 1.5 : armourHeavy ? 0.3 : 1) * (fortified ? 0.5 : 1)],
      ['artillery', 0.8 + (infantryHeavy ? 0.7 : 0) + (fortified ? 1.2 : 0)],
      ['missilecarrier', 0.5 + (armourHeavy ? 0.7 : 0) + (fortified ? 1.5 : 0)],
      ['flametank', infantryHeavy ? 5 : armourHeavy ? 1 : 3],
      ['bastion', 0.5 + (armourHeavy ? 0.5 : 0) + (fortified ? 1 : 0)],
    ];
    // Round 6, workstream A: Ashen's Raider Bikes against armour and haulers.
    if (army === 'ashen') vehicles.push(['raider', infantryHeavy ? 0.6 : armourHeavy ? 2 : 1.4]);
    let kind = weighted(s, owner, vehicles, roll) ?? 'tank';
    // Keep the raiding party up to strength in time for the next raid (not while one is out).
    if (t.raidSize && raidBuggies < t.raidSize && s.tick >= nextRaid - 900 && unlocked(s, owner, 'buggy')) kind = 'buggy';
    if (canQueue(s, owner, 'vehicle', kind)) doQueue(s, owner, 'vehicle', kind);
    else if (unlocked(s, owner, kind)) {
      waiting = unitSpec(s, owner, kind).cost;
      waitingFor = kind;
    }
  }
  // With ten soldiers, a vehicle being saved for holds the infantry back altogether; against
  // massed infantry it takes fourteen (grenadiers are worth more there than any vehicle short of
  // a flame tank).
  const holdInfantry = waiting > 0 && soldiers >= (infantryHeavy && waitingFor !== 'flametank' ? 14 : 10) && p.credits < waiting + 250;
  if (iq.length < (holdInfantry ? 0 : waiting ? 1 : 2)) {
    const medics = units.filter(u => UNITS[u.kind].medic).length + iq.filter(q => q.kind === 'medic').length;
    let kind: UnitKind | null = null;
    if (medics < Math.min(t.counter ? 3 : 1, Math.floor(soldiers / 6))) kind = 'medic';
    else {
      const infantry: [UnitKind, number][] = [
        ['rifleman', infantryHeavy ? 1 : armourHeavy ? 1 : 2],
        ['rocketeer', infantryHeavy ? 1 : armourHeavy ? 5 : 1.5],
        ['grenadier', (infantryHeavy ? 6 : armourHeavy ? 2 : 4) + (fortified ? 1 : 0)],
      ];
      // Round 6, workstream A: Meridian's Sappers against defences and armour, in a battle with two
      // armies only, so a battle of Meridian alone (every default battle) draws exactly as before.
      if (army === 'meridian' && twoArmies) infantry.push(['sapper', fortified ? 1.5 : armourHeavy ? 1 : 0.6]);
      kind = weighted(s, owner, infantry);
    }
    kind = kind ?? 'rifleman';
    if (canQueue(s, owner, 'infantry', kind)) doQueue(s, owner, 'infantry', kind);
  }
}

/** The free tiles beside a Repair Bay's footprint, where a vehicle is mended. */
function bayStands(s: GameState, bay: Building): number[] {
  const occ = occupancy(s);
  const spec = buildingSpecOf(s, bay);
  const out: number[] = [];
  for (let y = bay.y - 1; y <= bay.y + spec.h; y++)
    for (let x = bay.x - 1; x <= bay.x + spec.w; x++) {
      if (x >= bay.x && x < bay.x + spec.w && y >= bay.y && y < bay.y + spec.h) continue;
      if (passable(s, occ, x, y)) out.push(tileAt(s, x, y));
    }
  return out;
}

/** Units within reach of an enemy missile's blast walk out of it while it is in the air. */
function dodgeMissiles(s: GameState, owner: Owner, units: Unit[]): void {
  for (const m of s.projectiles) {
    if (m.weapon !== 'missile' || isAlly(s, m.owner, owner)) continue;
    const r = m.splash + 1;
    for (const u of units) {
      if (u.kind === 'hauler' || u.order.type === 'harvest') continue;
      const d = dist(u.x, u.y, m.toX, m.toY);
      if (d >= r) continue;
      if (u.order.type === 'move' && dist(u.order.x, u.order.y, m.toX, m.toY) >= r) continue;
      const away = d > 0.1 ? { x: m.toX + ((u.x - m.toX) / d) * (r + 1.5), y: m.toY + ((u.y - m.toY) / d) * (r + 1.5) } : { x: u.x + r + 1.5, y: u.y };
      const x = Math.max(0.5, Math.min(s.mapW - 0.5, away.x));
      const y = Math.max(0.5, Math.min(s.mapH - 0.5, away.y));
      doMove(s, owner, [u.id], x, y, false);
    }
  }
}

type ArmorClass = 'infantry' | 'light' | 'heavy' | 'building' | 'aircraft';

/**
 * The opponent's things a blast at (x, y) would hurt, in credits' worth destroyed: each one's cost
 * times the share of its hit points the blast would take (all of it at most). Structures count in
 * full and defences a little more; units count for less (`unitShare`), since they can move.
 */
function blastWorth(
  s: GameState,
  enemy: Building[],
  foes: Unit[],
  x: number,
  y: number,
  radius: number,
  damageAt: (d: number, armor: ArmorClass) => number,
  unitShare: number,
): number {
  let worth = 0;
  for (const b of enemy) {
    const d = distToBuilding(x, y, b);
    if (d > radius) continue;
    const spec = buildingSpecOf(s, b);
    worth += spec.cost * Math.min(1, damageAt(d, 'building') / Math.max(1, b.hp)) * (spec.weapon ? 1.25 : 1);
  }
  for (const u of foes) {
    const d = dist(x, y, u.x, u.y);
    if (d > radius) continue;
    const spec = unitSpecOf(s, u);
    worth += spec.cost * Math.min(1, damageAt(d, spec.armor) / Math.max(1, u.hp)) * unitShare;
  }
  return worth;
}

/** The point among the opponent's structures and units where a blast is worth most. */
function bestBlast(
  s: GameState,
  enemy: Building[],
  foes: Unit[],
  radius: number,
  damageAt: (d: number, armor: ArmorClass) => number,
  unitShare: number,
  bonus: (x: number, y: number) => number,
): { x: number; y: number; worth: number } | null {
  let best: { x: number; y: number; worth: number } | null = null;
  const candidates: Pt[] = [...enemy.map(b => buildingCentre(b)), ...foes.map(u => ({ x: u.x, y: u.y }))];
  for (const c of candidates) {
    const worth = blastWorth(s, enemy, foes, c.x, c.y, radius, damageAt, unitShare) * bonus(c.x, c.y);
    if (!best || worth > best.worth) best = { x: c.x, y: c.y, worth };
  }
  return best;
}

/**
 * The barrage and the missile, when charged. Normal and Hard aim: the barrage at the densest knot
 * of defences or troops (worth half as much again near its own attacking wave, which it softens up
 * the way in for), the missile at the opponent's most valuable ground. Easy simply fires at the
 * nearest of the opponent's structures.
 */
function useStrikes(s: GameState, owner: Owner, t: Tactics, home: Pt, enemy: Building[], foes: Unit[], wave: Unit[]): void {
  const pw = s.powers?.[owner];
  if (!pw || !enemy.length) return;
  const fire = (power: SupportPower, at: Pt) => {
    if (powerProblem(s, owner, power, at.x, at.y) === null) doPower(s, owner, power, at.x, at.y);
  };
  const crude = () => buildingCentre(nearestBuilding(enemy, home.x, home.y));
  const centre = wave.length >= 3 ? middle(wave) : null;
  if (pw.barrage === 0) {
    if (!t.aimPowers) fire('barrage', crude());
    else {
      // Eight shells over the area: a point inside it takes about two of them.
      const r = POWERS.barrage.radius;
      const at = bestBlast(
        s,
        enemy,
        foes,
        r,
        (_d, armor) => 2 * BARRAGE_DAMAGE * 0.75 * DAMAGE_VS.artillery[armor],
        0.6,
        (x, y) => (centre && dist(x, y, centre.x, centre.y) < 10 ? 1.5 : 1),
      );
      if (at && at.worth >= t.barrageWorth) fire('barrage', at);
    }
  }
  if (pw.missile === 0) {
    if (!t.aimPowers) fire('missile', crude());
    else {
      const r = POWERS.missile.radius;
      const at = bestBlast(s, enemy, foes, r, (d, armor) => MISSILE_DAMAGE * (1 - (0.5 * d) / r) * DAMAGE_VS.missile[armor], 0.4, () => 1);
      if (at && at.worth >= 1500) fire('missile', at);
    }
  }
}

/**
 * A tile for the next sandbag wall: a short line across the way in, two tiles in front of a
 * forward turret, facing the opponent. Only a tile clear of every structure, and only if, with
 * the wall in place, every door and dock in the base is still reachable from the staging ground
 * and the walk to the opponent's base is no more than two tiles longer.
 */
export function wallSpot(s: GameState, owner: Owner, home: Pt, enemyHome: Pt): Pt | null {
  const occ = occupancy(s);
  const own = s.buildings.filter(b => b.owner === owner);
  const towers = own.filter(b => (b.kind === 'turret' || b.kind === 'rocketturret') && dist(b.x, b.y, home.x, home.y) < 14);
  if (!towers.length) return null;
  const stage = openGround(s, owner, toward(home, enemyHome, 10));
  const start = nearestPassable(s, occ, stage.x, stage.y);
  const goal = nearestPassable(s, occ, enemyHome.x, enemyHome.y, 10);
  if (start < 0 || goal < 0) return null;
  const needed: number[] = [goal];
  for (const b of own) {
    const pad = b.kind === 'barracks' || b.kind === 'factory' ? doorTile(s, b) : b.kind === 'refinery' ? dockTile(s, b) : null;
    if (pad && passable(s, occ, pad.x, pad.y)) needed.push(tileAt(s, pad.x, pad.y));
  }
  const before = walk(s, occ, start, -1);
  if (before[goal] < 0) return null;
  for (const tw of towers) {
    const c = buildingCentre(tw);
    const f = toward(c, enemyHome, 2.5);
    const len = dist(c.x, c.y, enemyHome.x, enemyHome.y) || 1;
    const px = -(enemyHome.y - c.y) / len;
    const py = (enemyHome.x - c.x) / len;
    for (const k of [0, -1, 1, -2, 2]) {
      const x = Math.floor(f.x + px * k);
      const y = Math.floor(f.y + py * k);
      if (!onMap(s, x, y) || placementProblem(s, owner, 'wall', x, y, occ)) continue;
      // A tile clear of every structure (walls may touch walls).
      let clear = true;
      for (let ty = y - 1; ty <= y + 1 && clear; ty++)
        for (let tx = x - 1; tx <= x + 1; tx++) {
          const o = onMap(s, tx, ty) ? occ[tileAt(s, tx, ty)] : 0;
          if (o && !s.buildings.some(b => b.id === o && BUILDINGS[b.kind].wall)) {
            clear = false;
            break;
          }
        }
      if (!clear || needed.includes(tileAt(s, x, y))) continue;
      const after = walk(s, occ, start, tileAt(s, x, y));
      if (needed.every(n => after[n] >= 0) && after[goal] <= before[goal] + 2) return { x, y };
    }
  }
  return null;
}

const STEPS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Steps from `start` to every tile over open ground (4-way), with `blocked` also closed; -1 where unreachable. */
function walk(s: GameState, occ: Int32Array, start: number, blocked: number): Int32Array {
  const steps = new Int32Array(s.mapW * s.mapH).fill(-1);
  const queue = new Int32Array(s.mapW * s.mapH);
  let head = 0;
  let tail = 0;
  steps[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const k = queue[head++];
    const x = k % s.mapW;
    const y = (k / s.mapW) | 0;
    for (const [dx, dy] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!passable(s, occ, nx, ny)) continue;
      const n = tileAt(s, nx, ny);
      if (n === blocked || steps[n] >= 0) continue;
      steps[n] = steps[k] + 1;
      queue[tail++] = n;
    }
  }
  return steps;
}
