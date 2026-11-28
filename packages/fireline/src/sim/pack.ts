import { MAP_TILES_MAX_BALANCED, type MapType, type OreLevel } from './rules';
import { generateSkirmishMap } from './maps';
import { seedFromString } from './rng';
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
  /**
   * Continental maps (2026-11-27): the ground is not saved at all (`tiles` is empty) but built again
   * from the battle's seed and setup, as it was at the start (it never changes in a battle); this is
   * the ground's checksum, and a save whose rebuilt ground does not match it is refused.
   */
  tilesSum?: number;
  /**
   * Grand War G0 (2026-11-28, fireline-grand-war-design.md): the battle's long lists of objects are
   * saved as tables (`packRows`): units, structures, and each adaptive commander's memory of what it
   * has seen. Absent on a save made before; such a save loads exactly as it did.
   */
  tables?: typeof TABLES_V1;
}

/** The marker of a packed save whose long lists are tables, and that format's version. */
export const TABLES_V1 = 1;

/**
 * A list of objects as a table. Each distinct ordered key list (a shape) is kept once in `k`, with
 * the value each of its keys most often holds in `d`. A row is the shape's index, then a mask whose
 * bit j is set when key j differs from that default, then only those values, in key order. The key
 * names and the idle defaults (no order, an empty path, nought kills) were most of a unit's 360
 * bytes. Exact: key order and every value come back as they went in; a key whose value is undefined
 * is left out, as JSON leaves it out. Defaults come back as fresh copies, never shared between rows.
 */
export interface Rows {
  k: string[][];
  d: unknown[][];
  r: unknown[][];
}

/** Bits a mask may use and still be an exact whole number. */
const MASK_BITS = 52;

export function packRows(objs: readonly object[]): Rows {
  const k: string[][] = [];
  const index = new Map<string, number>();
  const members: { shape: number; values: unknown[]; texts: string[] }[] = [];
  for (const o of objs) {
    const rec = o as Record<string, unknown>;
    const keys = Object.keys(rec).filter(key => rec[key] !== undefined);
    const name = keys.join('\u0000');
    let shape = index.get(name);
    if (shape === undefined) {
      shape = k.length;
      k.push(keys);
      index.set(name, shape);
    }
    const values = keys.map(key => rec[key]);
    members.push({ shape, values, texts: values.map(v => JSON.stringify(v)) });
  }
  // Each column's most common value (by its JSON text; the first seen wins a tie).
  const defaultText: (string | null)[][] = k.map(keys => keys.map(() => null));
  const d: unknown[][] = k.map(() => []);
  k.forEach((keys, shape) => {
    if (keys.length > MASK_BITS) return;
    const rows = members.filter(m => m.shape === shape);
    keys.forEach((_, j) => {
      const counts = new Map<string, number>();
      let best: string | null = null;
      let bestN = 0;
      for (const m of rows) {
        const n = (counts.get(m.texts[j]) ?? 0) + 1;
        counts.set(m.texts[j], n);
        if (n > bestN) {
          best = m.texts[j];
          bestN = n;
        }
      }
      defaultText[shape][j] = best;
      d[shape].push(best === null ? null : JSON.parse(best));
    });
  });
  const r: unknown[][] = members.map(m => {
    const defs = defaultText[m.shape];
    if (k[m.shape].length > MASK_BITS) return [m.shape, -1, ...m.values];
    let mask = 0;
    const row: unknown[] = [m.shape, 0];
    m.values.forEach((v, j) => {
      if (m.texts[j] === defs[j]) return;
      mask += 2 ** j;
      row.push(v);
    });
    row[1] = mask;
    return row;
  });
  return { k, d, r };
}

/** The objects a table was made from, or null if it is not a well-formed table. */
export function unpackRows(raw: unknown): Record<string, unknown>[] | null {
  const t = raw as Partial<Rows> | null;
  if (!t || typeof t !== 'object' || !Array.isArray(t.k) || !Array.isArray(t.d) || !Array.isArray(t.r) || t.d.length !== t.k.length) return null;
  if (!t.k.every(keys => Array.isArray(keys) && keys.every(key => typeof key === 'string'))) return null;
  if (!t.d.every((defs, i) => Array.isArray(defs) && (defs.length === t.k![i].length || defs.length === 0))) return null;
  const out: Record<string, unknown>[] = [];
  for (const row of t.r) {
    if (!Array.isArray(row) || !Number.isInteger(row[0]) || !Number.isInteger(row[1])) return null;
    const keys = t.k[row[0] as number];
    const defs = t.d[row[0] as number];
    const mask = row[1] as number;
    if (!keys) return null;
    const o: Record<string, unknown> = {};
    if (mask === -1) {
      if (row.length !== keys.length + 2) return null;
      for (let j = 0; j < keys.length; j++) o[keys[j]] = row[j + 2];
    } else {
      if (mask < 0 || mask >= 2 ** keys.length || defs.length !== keys.length) return null;
      let at = 2;
      for (let j = 0; j < keys.length; j++) {
        if (Math.floor(mask / 2 ** j) % 2 === 1) {
          if (at >= row.length) return null;
          o[keys[j]] = row[at++];
        } else {
          const def = defs[j];
          o[keys[j]] = def !== null && typeof def === 'object' ? JSON.parse(JSON.stringify(def)) : def;
        }
      }
      if (at !== row.length) return null;
    }
    out.push(o);
  }
  return out;
}

/** The adaptive commanders' lists kept as tables. */
const ADAPT_TABLES = ['seen', 'sites'] as const;

function packAi(ai: GameState['ai']): unknown {
  return ai.map(a => {
    const adapt = (a as { adapt?: Record<string, unknown> }).adapt;
    if (!adapt) return a;
    const packed: Record<string, unknown> = { ...adapt };
    for (const key of ADAPT_TABLES) if (Array.isArray(adapt[key])) packed[key] = packRows(adapt[key] as object[]);
    return { ...a, adapt: packed };
  });
}

function unpackAi(raw: unknown): unknown[] | null {
  if (!Array.isArray(raw)) return null;
  const out: unknown[] = [];
  for (const a of raw) {
    const adapt = (a as { adapt?: Record<string, unknown> } | null)?.adapt;
    if (!adapt || typeof adapt !== 'object') {
      out.push(a);
      continue;
    }
    const back: Record<string, unknown> = { ...adapt };
    for (const key of ADAPT_TABLES) {
      if (adapt[key] === undefined) continue;
      const rows = unpackRows(adapt[key]);
      if (!rows) return null;
      back[key] = rows;
    }
    out.push({ ...(a as object), adapt: back });
  }
  return out;
}

/** A string's FNV-1a checksum, as a whole number. */
export function textSum(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Whether a battle's ground is saved as its seed: Continental skirmishes. */
const groundFromSeed = (s: Pick<GameState, 'setup' | 'mission' | 'planet' | 'mapType'>): boolean => s.setup?.size === 'continental' && !s.mission && !s.planet && !!s.mapType;

/** The ground a Continental battle started on, rebuilt from its seed and setup. */
function rebuiltGround(r: Record<string, unknown>): string | null {
  const setup = r.setup as { ore?: OreLevel; sides?: 2 | 3 | 4 } | undefined;
  if (typeof r.seedText !== 'string' || typeof r.mapType !== 'string' || !setup) return null;
  try {
    return generateSkirmishMap(seedFromString(r.seedText), r.mapType as MapType, setup.ore ?? 'normal', setup.sides ?? 2, 'continental').tiles;
  } catch {
    return null;
  }
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
  const tables = { tables: TABLES_V1, units: packRows(s.units), buildings: packRows(s.buildings), ai: packAi(s.ai) } as unknown as Partial<GameState>;
  if (groundFromSeed(s)) return { ...s, ...tables, packed: PACKED_V1, tiles: '', tilesSum: textSum(s.tiles), ore: packNumbers(s.ore), explored: packText(s.explored) };
  return { ...s, ...tables, packed: PACKED_V1, tiles: packText(s.tiles), ore: packNumbers(s.ore), explored: packText(s.explored) };
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
  const seeded = (r as { tilesSum?: unknown }).tilesSum;
  const tiles = seeded !== undefined ? (Number.isInteger(seeded) ? rebuiltGround(r as Record<string, unknown>) : null) : unpackText(r.tiles);
  if (seeded !== undefined && (tiles === null || textSum(tiles) !== seeded)) return null;
  const ore = unpackNumbers(r.ore);
  const explored = unpackText(r.explored);
  if (tiles === null || ore === null || explored === null || tiles.length !== n || ore.length !== n || explored.length !== n) return null;
  const { packed: _packed, tilesSum: _sum, tables, ...rest } = r as PackedFields & Record<string, unknown>;
  if (tables === undefined) return { ...rest, tiles, ore, explored };
  if (tables !== TABLES_V1) return null;
  const units = unpackRows(rest.units);
  const buildings = unpackRows(rest.buildings);
  const ai = unpackAi(rest.ai);
  if (!units || !buildings || !ai) return null;
  return { ...rest, units, buildings, ai, tiles, ore, explored };
}
