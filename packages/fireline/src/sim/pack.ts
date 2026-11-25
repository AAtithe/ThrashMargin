import { MAP_TILES_MAX_BALANCED } from './rules';
import type { GameState } from './types';

/**
 * Packing a battle's per-tile fields for saving (2026-11-22). A vast map has up to 102,400 tiles,
 * and a save carries three fields per tile (the ground, the ore and the explored map): about 440 KB
 * of a four-sided vast battle's save before a single unit, against the portal's 512 KB limit. Run
 * lengths shrink them to a few tens of KB, since ore is mostly nought and the explored map mostly
 * one long run either way.
 *
 * Only battles wider than the balanced sizes are packed (MAP_TILES_MAX_BALANCED, huge with four
 * sides): every save a build before vast maps could make or open stays exactly as it was, and
 * migrateState unpacks before anything else reads the state. Pure, and the round trip is exact.
 */

/** The marker a packed save carries, and the format's version. */
export const PACKED_V1 = 1;

export interface PackedFields {
  packed: typeof PACKED_V1;
  tiles: string;
  ore: string;
  explored: string;
}

/** Whether a battle's save is packed: its map is wider than any balanced size. */
export const packsState = (s: Pick<GameState, 'mapW'>): boolean => s.mapW > MAP_TILES_MAX_BALANCED;

/** Runs of one character: the character, then the run's length in base 36, each run ended by a comma. */
export function packText(text: string): string {
  const out: string[] = [];
  for (let i = 0; i < text.length; ) {
    let j = i + 1;
    while (j < text.length && text[j] === text[i]) j++;
    out.push(text[i] + (j - i).toString(36));
    i = j;
  }
  return out.join(',');
}

export function unpackText(packed: string): string | null {
  if (packed === '') return '';
  const out: string[] = [];
  for (const run of packed.split(',')) {
    const n = parseInt(run.slice(1), 36);
    if (run.length < 2 || !Number.isInteger(n) || n <= 0 || n > 1 << 20) return null;
    out.push(run[0].repeat(n));
  }
  return out.join('');
}

/** Runs of one whole number: the value in base 36, then `*` and the run's length in base 36 where it is longer than one. */
export function packNumbers(xs: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < xs.length; ) {
    let j = i + 1;
    while (j < xs.length && xs[j] === xs[i]) j++;
    const v = Math.round(xs[i]).toString(36);
    out.push(j - i > 1 ? `${v}*${(j - i).toString(36)}` : v);
    i = j;
  }
  return out.join(',');
}

export function unpackNumbers(packed: string): number[] | null {
  if (packed === '') return [];
  const out: number[] = [];
  for (const run of packed.split(',')) {
    const [v, n] = run.split('*');
    const value = parseInt(v, 36);
    const count = n === undefined ? 1 : parseInt(n, 36);
    if (!Number.isFinite(value) || !Number.isInteger(count) || count <= 0 || count > 1 << 20) return null;
    for (let i = 0; i < count; i++) out.push(value);
  }
  return out;
}

/**
 * The battle as it is saved: packed if its map is wider than the balanced sizes, otherwise the
 * state itself. Ore is whole credits on every tile (it is mined and regrown in whole amounts), so
 * packing it as whole numbers loses nothing; anything else is left unpacked to be safe.
 */
export function packState(s: GameState): GameState | (Omit<GameState, 'tiles' | 'ore' | 'explored'> & PackedFields) {
  if (!packsState(s) || !s.ore.every(Number.isInteger)) return s;
  return { ...s, packed: PACKED_V1, tiles: packText(s.tiles), ore: packNumbers(s.ore), explored: packText(s.explored) };
}

/**
 * A saved battle with its per-tile fields as the game reads them: unpacked if it was packed, the
 * input itself if it was not, null if it claims to be packed and does not unpack to its own map.
 */
export function unpackState(raw: unknown): unknown {
  const r = raw as Partial<PackedFields> & { mapW?: unknown; mapH?: unknown } | null;
  if (!r || typeof r !== 'object' || r.packed === undefined) return raw;
  if (r.packed !== PACKED_V1 || typeof r.tiles !== 'string' || typeof r.ore !== 'string' || typeof r.explored !== 'string') return null;
  const w = r.mapW;
  const h = r.mapH;
  if (!Number.isInteger(w) || !Number.isInteger(h)) return null;
  const n = (w as number) * (h as number);
  const tiles = unpackText(r.tiles);
  const ore = unpackNumbers(r.ore);
  const explored = unpackText(r.explored);
  if (tiles === null || ore === null || explored === null || tiles.length !== n || ore.length !== n || explored.length !== n) return null;
  const { packed: _packed, ...rest } = r as PackedFields & Record<string, unknown>;
  return { ...rest, tiles, ore, explored };
}
