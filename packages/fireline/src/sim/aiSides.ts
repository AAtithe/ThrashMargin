import { doMove } from './commands';
import { buildingCentre, dist } from './grid';
import { isWalkable } from './map';
import { UNITS, type Owner } from './rules';
import { alliesOf, enemiesOf } from './sides';
import { isStructure } from './state';
import type { Building, GameState, Unit } from './types';

/**
 * The computer commander in a battle of three or four sides (fireline-round4-design.md, workstream
 * B): which enemy to attack, and how to fight beside an ally. With one enemy and no ally (every
 * two-sided battle) nothing here changes the state or draws from the random stream, so two-sided
 * battles play exactly as before.
 */

declare module './types' {
  interface AiMemory {
    /** The enemy side this commander's waves are aimed at; written only when it has several enemies. */
    focus?: Owner;
    /** The tick before which it keeps that focus, so its waves do not swing between bases. */
    focusUntil?: number;
  }
}

/** Ticks a commander keeps aiming at the enemy it chose (two minutes), unless that enemy falls. */
export const FOCUS_TICKS = 1200;
/** An ally's base counts as under attack for this long after a structure of its was hit (20 seconds). */
export const ALLY_HELP_TICKS = 200;
/** Share of the idle reserve sent to an ally under attack. */
const HELP_SHARE = 0.5;
/** Within this many tiles of home, a unit counts as at home. */
const HOME_RANGE = 30;

/** A side's standing structures, in id order. */
const structuresOf = (s: GameState, owner: Owner): Building[] => s.buildings.filter(b => b.owner === owner && isStructure(b));

/** Where a side's base is: its Command Yard, else its first structure. */
export function baseOf(s: GameState, owner: Owner): { x: number; y: number } | null {
  const mine = structuresOf(s, owner);
  if (!mine.length) return null;
  return buildingCentre(mine.find(b => b.kind === 'hq') ?? mine[0]);
}

/** What a side fields: the cost of its armed units, plus a quarter of the cost of its structures' worth in health. */
function strengthOf(s: GameState, owner: Owner): number {
  let v = 0;
  for (const u of s.units) if (u.owner === owner && UNITS[u.kind].weapon) v += UNITS[u.kind].cost;
  return v + structuresOf(s, owner).length * 150;
}

/** Walking distance (four ways, open ground, structures ignored) from one point to several, in tiles; Infinity where none. */
function walkFrom(s: GameState, from: { x: number; y: number }, to: { x: number; y: number }[]): number[] {
  const W = s.mapW;
  const H = s.mapH;
  const start = Math.floor(from.y) * W + Math.floor(from.x);
  const want = new Map<number, number[]>();
  to.forEach((p, i) => {
    const k = Math.floor(p.y) * W + Math.floor(p.x);
    want.set(k, [...(want.get(k) ?? []), i]);
  });
  const out = to.map(() => Infinity);
  const seen = new Int32Array(W * H).fill(-1);
  seen[start] = 0;
  let q = [start];
  let left = to.length;
  for (let steps = 0; q.length && left > 0; steps++) {
    const nq: number[] = [];
    for (const k of q) {
      const hit = want.get(k);
      if (hit) {
        for (const i of hit) out[i] = steps;
        left -= hit.length;
        want.delete(k);
      }
      const x = k % W;
      const y = (k / W) | 0;
      for (const n of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, y > 0 ? k - W : -1, y < H - 1 ? k + W : -1]) {
        if (n < 0 || seen[n] >= 0) continue;
        // A base's own tiles are covered by its structures: let the walk end on any tile it aims at.
        if (!isWalkable(s.tiles[n]) && !want.has(n)) continue;
        seen[n] = steps + 1;
        nq.push(n);
      }
    }
    q = nq;
  }
  return out;
}

/**
 * Which enemy `owner` attacks: with one enemy standing, that one (and its memory is left alone).
 * With several, the nearest standing enemy base by walking distance, weighted by that side's
 * strength (a weaker enemy counts as nearer), with a quarter off for the enemy an ally is already
 * aiming at, so allies tend to strike together, and a twentieth off for the enemy the next way round
 * the map, so near ties break the same way for every seat. Kept for FOCUS_TICKS once chosen, unless that enemy
 * falls. Null when no enemy has a structure standing.
 */
export function chooseEnemy(s: GameState, owner: Owner): Owner | null {
  const standing = enemiesOf(s, owner).filter(o => s.buildings.some(b => b.owner === o && isStructure(b)));
  if (standing.length <= 1) return standing[0] ?? null;
  const mem = s.ai[owner];
  if (mem.focus !== undefined && standing.includes(mem.focus) && s.tick < (mem.focusUntil ?? 0)) return mem.focus;
  const home = baseOf(s, owner);
  const bases = standing.map(o => baseOf(s, o)!);
  const walks = home ? walkFrom(s, home, bases) : bases.map(() => 0);
  const strengths = standing.map(o => strengthOf(s, o));
  const strongest = Math.max(1, ...strengths);
  const allyFocus = new Set(
    alliesOf(s, owner)
      .map(a => s.ai[a]?.focus)
      .filter((f): f is Owner => f !== undefined),
  );
  let best = standing[0];
  let bestScore = Infinity;
  standing.forEach((o, i) => {
    const walk = Number.isFinite(walks[i]) ? walks[i] : home ? dist(home.x, home.y, bases[i].x, bases[i].y) * 1.5 : 0;
    let score = walk * (0.6 + 0.4 * (strengths[i] / strongest));
    if (allyFocus.has(o)) score *= 0.75;
    // Ties (and near ties: on a symmetric map every side starts as far from each neighbour) go the
    // same way round the map for every side, so no seat is everyone's first choice.
    if (home && turnsAhead(s, home, bases[i])) score *= 0.95;
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  });
  mem.focus = best;
  mem.focusUntil = s.tick + FOCUS_TICKS;
  return best;
}

/** True when `to` lies the next way round the centre of the map from `from` (clockwise on screen). */
function turnsAhead(s: GameState, from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  const cx = s.mapW / 2;
  const cy = s.mapH / 2;
  return (from.x - cx) * (to.y - cy) - (from.y - cy) * (to.x - cx) > 0;
}

/** The enemy lists the commander works from (the lines between the round4:B markers in ai.ts). */
export function enemyLists(s: GameState, owner: Owner, focus: Owner | null): { enemy: Building[]; enemyHome: { x: number; y: number } } {
  const enemy = focus === null ? [] : s.buildings.filter(b => b.owner === focus && isStructure(b));
  const enemyHome = enemy.length ? buildingCentre(enemy.find(b => b.kind === 'hq') ?? enemy[0]) : { x: s.mapW / 2, y: s.mapH / 2 };
  return { enemy, enemyHome };
}

/**
 * Fighting beside allies. When an ally's base was hit within ALLY_HELP_TICKS and this side's own
 * base is not under threat, half its idle reserve (not in a wave or raid) attack-moves to where the
 * ally was hit. Units that went to help and are left idle far from home walk back to the staging
 * point, so they join the next wave. Aiming at an ally's focus is in chooseEnemy. No ally: nothing.
 */
export function alliedPlan(s: GameState, owner: Owner, home: { x: number; y: number }, stage: { x: number; y: number }, busy: number[], threatened: boolean): void {
  const allies = alliesOf(s, owner).filter(a => s.buildings.some(b => b.owner === a && isStructure(b)));
  if (!allies.length) return;
  const inUse = new Set(busy);
  const reserve = s.units.filter(u => u.owner === owner && UNITS[u.kind].weapon && !inUse.has(u.id));
  const idle = (u: Unit) => u.order.type === 'idle' && !u.engage;
  // Strays from an earlier rescue come back once there is nothing left to fight.
  const strays = reserve.filter(u => idle(u) && dist(u.x, u.y, home.x, home.y) > HOME_RANGE).map(u => u.id);
  if (strays.length) doMove(s, owner, strays, stage.x, stage.y, true);
  if (threatened) return;
  const hit = allies
    .filter(a => s.tick - s.ai[a].hurtTick < ALLY_HELP_TICKS)
    .sort((a, b) => s.ai[b].hurtTick - s.ai[a].hurtTick || a - b)[0];
  if (hit === undefined) return;
  const mem = s.ai[hit];
  const ready = reserve.filter(u => idle(u) && dist(u.x, u.y, home.x, home.y) <= HOME_RANGE);
  const send = ready.slice(0, Math.floor(ready.length * HELP_SHARE)).map(u => u.id);
  if (send.length) doMove(s, owner, send, mem.hurtX, mem.hurtY, true);
}
