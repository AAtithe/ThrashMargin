import { canQueue, doCancel, doMove, doPlace, doQueue, doRally, placementProblem } from '../src/sim/commands';
import { buildingCentre, dist, occupancy, passable } from '../src/sim/grid';
import { idx, inBounds } from '../src/sim/map';
import { aiDifficulty } from '../src/sim/ai';
import { next } from '../src/sim/rng';
import {
  BUILDINGS,
  DIFFICULTIES,
  MAP_H,
  MAP_W,
  UNITS,
  type BuildingKind,
  type DifficultySpec,
  type Owner,
  type UnitKind,
} from '../src/sim/rules';
import { countBuildings, powerOf, readyStructure, unlocked } from '../src/sim/state';
import type { Building, GameState } from '../src/sim/types';

/**
 * FROZEN COPY of the computer opponent as first shipped (src/sim/ai.ts at the first playable
 * build), kept so scripts/ai-ladder.ts can measure the current AI against it. Do not improve it:
 * its only edits are the import paths and reading its difficulty per side (aiDifficulty), so it
 * can play side 0 at a different difficulty from side 1.
 *
 * The computer commander. It plays by the same rules and the same orders as the player: it pays
 * for everything, places structures through the same placement check, and its units fight with
 * the same code. Two things differ, both stated in the lobby: it sees the whole map, and on Hard
 * its refineries pay a quarter more.
 *
 * Runs every `period` ticks (Easy is slowest to react). Everything it remembers lives in
 * `s.ai[owner]`, so a replay makes the same decisions.
 */
export function baselineAi(s: GameState, owner: Owner): void {
  const diff = aiDifficulty(s, owner);
  const d = DIFFICULTIES[diff];
  const mine = s.buildings.filter(b => b.owner === owner);
  if (!mine.length) return;
  const anchor = mine.find(b => b.kind === 'hq') ?? mine[0];
  const home = buildingCentre(anchor);
  const enemy = s.buildings.filter(b => b.owner !== owner);
  const enemyHome = enemy.length ? buildingCentre(enemy.find(b => b.kind === 'hq') ?? enemy[0]) : { x: MAP_W / 2, y: MAP_H / 2 };

  // 1. Structures.
  let saving = false;
  const ready = readyStructure(s, owner);
  if (ready) {
    const spot = findSpot(s, owner, ready, home, enemyHome);
    if (spot) doPlace(s, owner, ready, spot.x, spot.y);
    else doCancel(s, owner, 'building', ready);
  } else if (s.players[owner].queues.building.length === 0) {
    const want = nextStructure(s, owner, d);
    if (want) {
      if (canQueue(s, owner, 'building', want)) {
        doQueue(s, owner, 'building', want);
      } else if (unlocked(s, owner, want)) saving = true;
    }
  }

  // 2. Units.
  const units = s.units.filter(u => u.owner === owner);
  const haulers = units.filter(u => u.kind === 'hauler').length;
  const refineries = countBuildings(s, owner, 'refinery');
  const vq = s.players[owner].queues.vehicle;
  const iq = s.players[owner].queues.infantry;
  const wantHaulers = Math.min(4, refineries + (diff === 'hard' ? 1 : 0));
  if (haulers < wantHaulers && !vq.some(q => q.kind === 'hauler') && canQueue(s, owner, 'vehicle', 'hauler')) {
    queueUnit(s, owner, 'vehicle', 'hauler');
  }
  if (!saving) {
    if (iq.length < 2) {
      const roll = draw(s);
      const kind: UnitKind = roll < 0.6 ? 'rifleman' : 'rocketeer';
      if (canQueue(s, owner, 'infantry', kind)) queueUnit(s, owner, 'infantry', kind);
    }
    if (vq.length < 1) {
      const roll = draw(s);
      let kind: UnitKind = roll < 0.55 ? 'tank' : roll < 0.78 ? 'buggy' : 'artillery';
      if (!unlocked(s, owner, kind)) kind = 'tank';
      if (canQueue(s, owner, 'vehicle', kind)) queueUnit(s, owner, 'vehicle', kind);
    }
  }

  // Producers send new units to a staging point on the side facing the enemy.
  const stage = openGround(s, toward(home, enemyHome, 10));
  for (const b of mine) {
    if ((b.kind === 'barracks' || b.kind === 'factory') && !b.rally) doRally(s, b.id, stage.x, stage.y);
  }

  // 3. The army.
  const mem = s.ai[owner];
  const army = units.filter(u => UNITS[u.kind].weapon);
  const idle = army.filter(u => u.order.type === 'idle');

  // Defend: anything idle near home answers an attack on the base.
  if (s.tick - mem.hurtTick < 40) {
    const defenders = idle.filter(u => dist(u.x, u.y, home.x, home.y) < 22).map(u => u.id);
    if (defenders.length) doMove(s, owner, defenders, mem.hurtX, mem.hurtY, true);
    return;
  }

  if (s.tick >= mem.nextAttack && enemy.length) {
    const wave = Math.min(d.waveCap, d.firstWave + mem.wave * d.waveGrowth);
    // A wave that has waited a whole extra interval goes with what it has.
    const overdue = s.tick >= mem.nextAttack + d.attackInterval && idle.length >= d.firstWave;
    if (idle.length >= wave || overdue) {
      const target = nearestBuilding(enemy, home.x, home.y);
      const c = buildingCentre(target);
      doMove(
        s,
        owner,
        idle.map(u => u.id),
        c.x,
        c.y,
        true,
      );
      mem.wave++;
      mem.nextAttack = s.tick + d.attackInterval;
    }
  }
}

function queueUnit(s: GameState, owner: Owner, cat: 'infantry' | 'vehicle', kind: UnitKind): void {
  doQueue(s, owner, cat, kind);
}

function draw(s: GameState): number {
  const r = next(s.rngSeed);
  s.rngSeed = r.seed;
  return r.value;
}

function toward(a: { x: number; y: number }, b: { x: number; y: number }, by: number): { x: number; y: number } {
  const d = dist(a.x, a.y, b.x, b.y) || 1;
  return { x: a.x + ((b.x - a.x) / d) * by, y: a.y + ((b.y - a.y) / d) * by };
}

/** The nearest point to `p` with clear ground two tiles all round: somewhere an army can wait. */
function openGround(s: GameState, p: { x: number; y: number }): { x: number; y: number } {
  const occ = occupancy(s);
  const cx = Math.round(p.x);
  const cy = Math.round(p.y);
  for (let r = 0; r <= 10; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
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

function nextStructure(s: GameState, owner: Owner, d: DifficultySpec): BuildingKind | null {
  const pw = powerOf(s, owner);
  const count = (k: BuildingKind) => countBuildings(s, owner, k);
  if (pw.made - pw.used < 25 && count('power') < 9) return 'power';
  const plan: [BuildingKind, number][] = [
    ['refinery', 1],
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
    // Keep power ahead of what this structure will draw.
    if (pw.made - pw.used + BUILDINGS[k].power < 0) return 'power';
    return k;
  }
  return null;
}

/**
 * Somewhere legal to put a structure, nearest a focus point, keeping a one-tile lane free all
 * round so the base never walls itself in. Turrets go out toward the enemy; refineries toward ore.
 */
function findSpot(
  s: GameState,
  owner: Owner,
  kind: BuildingKind,
  home: { x: number; y: number },
  enemyHome: { x: number; y: number },
): { x: number; y: number } | null {
  const spec = BUILDINGS[kind];
  let focus = home;
  if (kind === 'turret') focus = toward(home, enemyHome, 7);
  if (kind === 'refinery') {
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < s.ore.length; k++) {
      if (s.ore[k] <= 0) continue;
      const d = dist(home.x, home.y, (k % MAP_W) + 0.5, ((k / MAP_W) | 0) + 0.5);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best >= 0) focus = toward(home, { x: (best % MAP_W) + 0.5, y: ((best / MAP_W) | 0) + 0.5 }, Math.min(bestD * 0.6, 7));
  }
  const occ = occupancy(s);
  const candidates: [number, number, number][] = [];
  const fx = Math.round(focus.x);
  const fy = Math.round(focus.y);
  for (let y = fy - 12; y <= fy + 12; y++)
    for (let x = fx - 12; x <= fx + 12; x++) {
      if (!inBounds(x, y)) continue;
      const cx = x + spec.w / 2;
      const cy = y + spec.h / 2;
      candidates.push([x, y, (cx - focus.x) ** 2 + (cy - focus.y) ** 2]);
    }
  candidates.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  for (const [x, y] of candidates) {
    if (placementProblem(s, owner, kind, x, y, occ)) continue;
    let clear = true;
    for (let ty = y - 1; ty <= y + spec.h && clear; ty++)
      for (let tx = x - 1; tx <= x + spec.w; tx++) {
        if (inBounds(tx, ty) && occ[idx(tx, ty)]) {
          clear = false;
          break;
        }
      }
    // Leave the row below clear as well, where units come out of barracks and factories.
    if (clear && inBounds(x, y + spec.h + 1)) {
      for (let tx = x - 1; tx <= x + spec.w; tx++) if (inBounds(tx, y + spec.h + 1) && occ[idx(tx, y + spec.h + 1)]) clear = false;
    }
    if (clear) return { x, y };
  }
  return null;
}
