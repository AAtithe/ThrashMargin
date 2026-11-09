import { START_0, START_1 } from './map';
import { MAX_SIDES, type Owner } from './rules';
import type { GameState } from './types';

/**
 * Who is who in a battle of 2, 3 or 4 sides. Every question of the form "is that the enemy?" goes
 * through here, never through `1 - owner` or `owner === 1`. Side 0 is always the human player.
 *
 * A side's team is `s.teams[owner]`. Allies (same team) never target or splash each other, share
 * what they see with side 0 when side 0 is one of them, and win or lose together. In a two-sided
 * battle teams are [0, 1], so isEnemy(s, a, b) is exactly a !== b and every two-sided battle plays
 * as it did before sides were generalised.
 */

const LISTS: Owner[][] = [[], [0], [0, 1], [0, 1, 2], [0, 1, 2, 3]];

/** How many sides this battle has: 2, 3 or 4. */
export const sideCount = (s: GameState): number => s.players.length;

/** Every side in the battle, in order. The array is shared: do not change it. */
export const sidesOf = (s: GameState): readonly Owner[] => LISTS[s.players.length] ?? LISTS[2];

/** Every computer side (all but side 0), in order. */
export const computerSides = (s: GameState): Owner[] => LISTS[s.players.length].slice(1);

/** A side's team. Without a teams list every side is its own team. */
export const teamOf = (s: GameState, owner: Owner): number => s.teams?.[owner] ?? owner;

/** True for a side and itself, and for two sides on the same team. */
export const isAlly = (s: GameState, a: Owner, b: Owner): boolean => a === b || teamOf(s, a) === teamOf(s, b);

/** True for two sides on different teams: they fight. */
export const isEnemy = (s: GameState, a: Owner, b: Owner): boolean => a !== b && teamOf(s, a) !== teamOf(s, b);

/** Every side `owner` fights, in order. */
export const enemiesOf = (s: GameState, owner: Owner): Owner[] => sidesOf(s).filter(o => isEnemy(s, owner, o));

/** Every side on `owner`'s team other than itself, in order. */
export const alliesOf = (s: GameState, owner: Owner): Owner[] => sidesOf(s).filter(o => o !== owner && isAlly(s, owner, o));

/** True once the battle is over and `owner`'s team won it. */
export const wonBy = (s: GameState, owner: Owner): boolean => s.winner !== null && isAlly(s, s.winner, owner);

/** Free-for-all teams for n sides: side i on team i. */
export const defaultTeams = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/**
 * The teams for a battle of n sides played as 'ffa' (every side for itself) or 'teams'. Two sides
 * are always [0, 1]. Teams with three sides: side 0 and side 2 against side 1, [0, 1, 0]. Teams with
 * four sides: side 0 and side 2 against side 1 and side 3, [0, 1, 0, 1]. Workstream B's setup
 * (fireline-round4-design.md) builds a battle's teams with this and nothing else.
 */
export function teamsFor(n: number, mode: 'ffa' | 'teams'): number[] {
  if (n <= 2 || mode === 'ffa') return defaultTeams(Math.max(2, n));
  return Array.from({ length: n }, (_, i) => i % 2);
}

/** True for a usable side number in this battle. */
export const isSide = (s: GameState, v: unknown): v is Owner => Number.isInteger(v) && (v as number) >= 0 && (v as number) < s.players.length;

/**
 * A teams list that fits n sides: one integer per side, each 0 to MAX_SIDES - 1, and at least two
 * different teams (a battle with one team has no enemy). Anything else falls back to free-for-all.
 */
export function normaliseTeams(raw: unknown, n: number): number[] {
  if (!Array.isArray(raw) || raw.length !== n) return defaultTeams(n);
  if (!raw.every(t => Number.isInteger(t) && t >= 0 && t < MAX_SIDES)) return defaultTeams(n);
  if (new Set(raw).size < 2) return defaultTeams(n);
  return raw.slice() as number[];
}

/** Top-left tile of a side's starting Command Yard: the state's own, else the original two sites. */
export function startOf(s: GameState, owner: Owner): { x: number; y: number } {
  const st = s.starts?.[owner];
  return st ?? (owner === 0 ? START_0 : START_1);
}

/**
 * Which way a side's structures face (+1 south, -1 north): away from the middle of the map, so the
 * door and dock open on the side of the base away from the fighting. Decided by where the side's
 * Command Yard site is: in the bottom half, south; in the top half, north. Side 0 starts in the
 * bottom half and side 1 in the top half on every two-sided map, which gives the original rule
 * (side 0 south, side 1 north) exactly. A map with more sides must put every site clearly in one
 * half or the other.
 */
export function frontDir(s: GameState, owner: Owner): 1 | -1 {
  const st = startOf(s, owner);
  return st.y + 1.5 >= s.mapH / 2 ? 1 : -1;
}

/**
 * The diagonal a new structure's turret first faces (no trigonometry in the simulation). Two sides:
 * up and right for side 0, down and left for side 1, exactly as before sides were generalised.
 * More sides: towards the middle of the map from the side's site.
 */
export function inwardDiagonal(s: GameState, owner: Owner): { x: number; y: number } {
  const y = frontDir(s, owner) === 1 ? -0.7071 : 0.7071;
  if (s.players.length <= 2) return { x: -y, y };
  const st = startOf(s, owner);
  return { x: st.x + 1.5 <= s.mapW / 2 ? 0.7071 : -0.7071, y };
}
