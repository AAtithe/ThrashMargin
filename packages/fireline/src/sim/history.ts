/**
 * The after-action review, part one: recording (fireline-round7-review.md).
 *
 * A battle keeps a compact history in `s.history`: every side sampled every HISTORY_SAMPLE_TICKS
 * (30 seconds of game time), and the key events with their tick. It is written at the end of each
 * tick (recordHistory, one call at the foot of step in tick.ts) and by three one-line hooks where
 * things die or are killed (noteUnitDeath, noteBuildingDeath, noteKill). Nothing in the battle
 * reads it, so recording never changes play: the harness plays every battle with and without it and
 * compares units, structures and winner.
 *
 * Pure, like the rest of src/sim: no clock, no dice. Works in place on a state the reducer has
 * cloned (cloneState copies the history, see cloneHistory).
 *
 * Compact: each series is a string of small integers, five bits a character with a continuation
 * bit (encodeInts). Income is stored in tens of credits and other money in fifties; credits held, army value, structure value,
 * power and ore control are stored as the change since the last sample (zigzag), which is mostly one
 * or two characters. An Epic battle (huge map, four sides as teams) that ran 74 minutes kept 15.7 KB,
 * about 18 KB projected to 85 minutes; an event budget (EVENTS_SOFT) bounds the rest.
 */
import { BUILDINGS, DERRICK_INCOME, DERRICK_TICKS, SALVAGE_SHARE, TICKS_PER_SECOND, UNITS, type Category, type Owner } from './rules';
import { salvageOf } from './research';
import { buildingSpecOf, unitSpecOf } from './specs';
import { powerOf } from './state';
import type { BattleHistory, Building, GameState, Unit } from './types';

/** 30 seconds of game time. */
export const HISTORY_SAMPLE_TICKS = 30 * TICKS_PER_SECOND;

/** The categories losses and kills are counted by, in stored order. */
export const HISTORY_CATS: Category[] = ['infantry', 'vehicle', 'air', 'naval', 'building'];

/** The fields of each sample, in stored order. */
export const HISTORY_FIELDS = [
  'credits',
  'income',
  'army',
  'structures',
  'lostInfantry',
  'lostVehicle',
  'lostAir',
  'lostNaval',
  'lostBuilding',
  'killedInfantry',
  'killedVehicle',
  'killedAir',
  'killedNaval',
  'killedBuilding',
  'powerMade',
  'powerUsed',
  'ore',
] as const;
export type HistoryField = (typeof HISTORY_FIELDS)[number];
const F = HISTORY_FIELDS.length;
/** Fields stored as the change from the previous sample. */
const DELTA = new Set<number>([0, 2, 3, 14, 15, 16]);
/** Money fields and the credits each stored unit stands for: income in tens, the rest in fifties. */
const MONEY: Record<number, number> = { 0: 50, 1: 10, 2: 50, 3: 50 };
/** The ten loss and kill fields (4 to 13), stored together in one column. */
const PACKED0 = 4;
const PACKED = 10;
/** Stored columns: each field alone, except the ten loss and kill fields, packed into column 4. */
const COLUMNS = F - PACKED + 1;
const columnOf = (f: number) => (f < PACKED0 ? f : f < PACKED0 + PACKED ? PACKED0 : f - PACKED + 1);
/** acc layout: [harvested at the last sample, other income, lost x5, killed x5]. */
const ACC = 12;
const LOST = 2;
const KILLED = 7;
/** Losses in one sample window that make a "heavy losses" event. */
export const HEAVY_LOSSES = 5;
/** Ore control: a tile counts for the side whose structure is nearest, within this many tiles. */
export const ORE_REACH = 12;

// ---- Encoding ---------------------------------------------------------------------------------

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
const INDEX: Record<string, number> = Object.fromEntries([...ALPHABET].map((c, i) => [c, i]));

/** A whole number of 0 or more, five bits a character, low bits first; bit six says more follow. */
export function encodeInt(v: number): string {
  let n = Math.max(0, Math.floor(v));
  let out = '';
  do {
    const d = n % 32;
    n = Math.floor(n / 32);
    out += ALPHABET[d + (n > 0 ? 32 : 0)];
  } while (n > 0);
  return out;
}

/** Every number in an encoded string, or null when it is not one. */
export function decodeInts(str: string): number[] | null {
  const out: number[] = [];
  let v = 0;
  let scale = 1;
  for (const c of str) {
    const d = INDEX[c];
    if (d === undefined) return null;
    v += (d % 32) * scale;
    if (d >= 32) scale *= 32;
    else {
      out.push(v);
      v = 0;
      scale = 1;
    }
  }
  return scale === 1 ? out : null;
}

const zig = (n: number) => (n >= 0 ? n * 2 : -n * 2 - 1);
const unzig = (z: number) => (z % 2 === 0 ? z / 2 : -(z + 1) / 2);

// ---- The record --------------------------------------------------------------------------------

/** An empty history for a battle of `sides` sides. createInitialState and createMissionState call it. */
export function newHistory(sides: number, every = HISTORY_SAMPLE_TICKS): BattleHistory {
  return {
    v: 1,
    every,
    n: 0,
    s: Array.from({ length: sides }, () => Array.from({ length: COLUMNS }, () => '')),
    last: Array.from({ length: sides }, () => new Array(F).fill(0)),
    ev: '',
    dict: [],
    acc: Array.from({ length: sides }, () => new Array(ACC).fill(0)),
    win: Array.from({ length: sides }, () => [{}, {}] as [Record<string, number>, Record<string, number>]),
  };
}

/** The copy cloneState makes: everything recordHistory may change in place. */
export function cloneHistory(h: BattleHistory): BattleHistory {
  return {
    ...h,
    s: h.s.map(a => a.slice()),
    last: h.last.map(a => a.slice()),
    dict: h.dict.slice(),
    acc: h.acc.map(a => a.slice()),
    win: h.win.map(([a, b]) => [{ ...a }, { ...b }] as [Record<string, number>, Record<string, number>]),
    ...(h.seen
      ? {
          seen: {
            up: h.seen.up.slice(),
            pw: h.seen.pw.map(p => ({ ...p })),
            site: h.seen.site.slice(),
            ...(h.seen.held ? { held: h.seen.held.slice() } : {}),
            kinds: h.seen.kinds.map(k => k.slice()),
            scan: h.seen.scan,
          },
        }
      : {}),
  };
}

/**
 * Appends one sample: `rows[side]` holds a value per field, already in stored units. The ten loss
 * and kill counts go in one column: a mask of those that are not 0, then each of them less one.
 */
export function appendSample(h: BattleHistory, rows: number[][]): void {
  for (let o = 0; o < h.s.length; o++) {
    const row = rows[o];
    let mask = 0;
    let packed = '';
    for (let f = 0; f < F; f++) {
      const v = Math.max(DELTA.has(f) ? -Infinity : 0, Math.round(row[f] ?? 0));
      if (f >= PACKED0 && f < PACKED0 + PACKED) {
        if (v > 0) {
          mask += 2 ** (f - PACKED0);
          packed += encodeInt(v - 1);
        }
      } else h.s[o][columnOf(f)] += encodeInt(DELTA.has(f) ? zig(v - h.last[o][f]) : v);
      h.last[o][f] = v;
    }
    h.s[o][PACKED0] += encodeInt(mask) + packed;
  }
  h.n++;
}

/** Event codes: one capital letter each. */
export type HistoryEventKind = 'built' | 'lost' | 'research' | 'power' | 'hero' | 'general' | 'site' | 'losses';
const CODE: Record<HistoryEventKind, string> = { built: 'B', lost: 'X', research: 'U', power: 'P', hero: 'H', general: 'G', site: 'S', losses: 'L' };
const KIND_OF: Record<string, HistoryEventKind> = Object.fromEntries(Object.entries(CODE).map(([k, c]) => [c, k as HistoryEventKind]));

export interface HistoryEvent {
  tick: number;
  side: Owner;
  kind: HistoryEventKind;
  /** The building, unit, upgrade, power or site kind. For 'losses', the kind whose losses cost most. */
  what: string;
  /**
   * 'losses' only: how many of `what` were lost, how many units were lost in all, and the kind that
   * killed the most ('defences' for structures).
   */
  n?: number;
  total?: number;
  by?: string;
}

/**
 * The events' budget, in characters. Past EVENTS_SOFT only the events the turning points read
 * (structures and units lost, research, commanders falling) are kept; past EVENTS_MAX none. A long
 * battle on a huge map comes to about 5,000; the budget keeps the whole history under 20 KB in a
 * battle far busier than any measured.
 */
export const EVENTS_SOFT = 4000;
export const EVENTS_MAX = 5500;
const ESSENTIAL = new Set<HistoryEventKind>(['lost', 'losses', 'research', 'hero', 'general']);

/** A kind name's index in the history's dictionary, in base 36, added when new. */
function word(h: BattleHistory, what: string): string {
  let i = h.dict.indexOf(what);
  if (i < 0) i = h.dict.push(what) - 1;
  return i.toString(36);
}

/**
 * Appends an event: "tick.side code word", the tick and the word's dictionary index in base 36.
 * For 'losses', `n`, `total` and `by` are given too: "tick.sideLword*n+total<word".
 */
export function pushEvent(h: BattleHistory, tick: number, side: Owner, kind: HistoryEventKind, what: string, n?: number, by?: string, total?: number): void {
  if (h.ev.length >= EVENTS_MAX || (h.ev.length >= EVENTS_SOFT && !ESSENTIAL.has(kind))) {
    if (h.capped === undefined) h.capped = tick;
    return;
  }
  const arg = kind === 'losses' ? `${word(h, what)}*${n ?? 0}+${total ?? n ?? 0}<${word(h, by ?? 'defences')}` : word(h, what);
  h.ev += `${h.ev ? ',' : ''}${tick.toString(36)}.${side}${CODE[kind]}${arg}`;
}

function parseEvent(e: string, dict: string[]): HistoryEvent | null {
  const dot = e.indexOf('.');
  if (dot < 1 || e.length < dot + 4) return null;
  const tick = parseInt(e.slice(0, dot), 36);
  const side = Number(e[dot + 1]);
  const kind = KIND_OF[e[dot + 2]];
  const rest = e.slice(dot + 3);
  if (!Number.isFinite(tick) || !(side >= 0 && side <= 3) || !kind) return null;
  const look = (w: string) => dict[parseInt(w, 36)];
  if (kind !== 'losses') {
    const what = look(rest);
    return what === undefined ? null : { tick, side: side as Owner, kind, what };
  }
  const m = /^([a-z0-9]+)\*(\d+)\+(\d+)<([a-z0-9]+)$/.exec(rest);
  if (!m || look(m[1]) === undefined || look(m[4]) === undefined) return null;
  return { tick, side: side as Owner, kind, what: look(m[1]), n: Number(m[2]), total: Number(m[3]), by: look(m[4]) };
}

/** Every event in the history, in the order recorded. */
export const historyEvents = (h: BattleHistory): HistoryEvent[] =>
  h.ev ? h.ev.split(',').map(e => parseEvent(e, h.dict)).filter((e): e is HistoryEvent => !!e) : [];

// ---- Measuring a side --------------------------------------------------------------------------

/** Unit prices alive (aircraft and ships included; Ore Haulers are the economy, not the army). */
export function armyValue(s: GameState, o: Owner): number {
  let v = 0;
  for (const u of s.units) if (u.owner === o && u.hp > 0 && u.kind !== 'hauler') v += unitSpecOf(s, u).cost;
  return v;
}

/** Structure prices standing (walls included). */
export function structureValue(s: GameState, o: Owner): number {
  let v = 0;
  for (const b of s.buildings) if (b.owner === o && b.hp > 0) v += buildingSpecOf(s, b).cost;
  return v;
}

/**
 * Ore control, in thousandths, per side: of every tile holding ore now, the share whose nearest
 * structure (not a wall) within ORE_REACH tiles is this side's. Ties go to the lower side. One
 * honest measure of the map: the ore a side can mine without marching for it.
 */
export function oreControl(s: GameState): number[] {
  const n = s.players.length;
  const W = s.mapW;
  const H = s.mapH;
  const best = new Float64Array(W * H).fill(Infinity);
  const who = new Int8Array(W * H).fill(-1);
  const R2 = ORE_REACH * ORE_REACH;
  for (const b of s.buildings) {
    if (b.hp <= 0 || BUILDINGS[b.kind].wall) continue;
    const spec = BUILDINGS[b.kind];
    const cx = b.x + spec.w / 2;
    const cy = b.y + spec.h / 2;
    const x0 = Math.max(0, Math.floor(cx - ORE_REACH));
    const x1 = Math.min(W - 1, Math.ceil(cx + ORE_REACH));
    const y0 = Math.max(0, Math.floor(cy - ORE_REACH));
    const y1 = Math.min(H - 1, Math.ceil(cy + ORE_REACH));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = y * W + x;
        if (!(s.ore[k] > 0)) continue;
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > R2) continue;
        if (d2 < best[k] || (d2 === best[k] && b.owner < who[k])) {
          best[k] = d2;
          who[k] = b.owner;
        }
      }
    }
  }
  let total = 0;
  const mine = new Array(n).fill(0);
  for (let k = 0; k < s.ore.length; k++) {
    if (!(s.ore[k] > 0)) continue;
    total++;
    if (who[k] >= 0) mine[who[k]]++;
  }
  return mine.map(m => (total ? Math.round((m * 1000) / total) : 0));
}

/** The sample `recordHistory` would take now, per side, in stored units. Reads only. */
export function sampleNow(s: GameState, h: BattleHistory): number[][] {
  const ore = oreControl(s);
  return s.players.map((p, o) => {
    const acc = h.acc[o] ?? new Array(ACC).fill(0);
    const pw = powerOf(s, o as Owner);
    const row = [
      p.credits / MONEY[0],
      (p.stats.harvested - acc[0] + acc[1]) / MONEY[1],
      armyValue(s, o as Owner) / MONEY[2],
      structureValue(s, o as Owner) / MONEY[3],
      ...acc.slice(LOST, LOST + 5),
      ...acc.slice(KILLED, KILLED + 5),
      pw.made,
      pw.used,
      ore[o] ?? 0,
    ];
    return row.map(v => Math.round(v));
  });
}

// ---- Recording ---------------------------------------------------------------------------------

function firstSeen(s: GameState, h: BattleHistory): NonNullable<BattleHistory['seen']> {
  const seen = {
    up: s.players.map(p => p.upgrades?.length ?? 0),
    pw: s.players.map((_, o) => ({ ...(s.powers?.[o] ?? {}) }) as Record<string, number>),
    site: (s.sites ?? []).map(x => x.owner),
    held: (s.sites ?? []).map(x => (x.owner === null ? 0 : 2 ** x.owner)),
    // Structures standing before the first tick (start, mission or planet layout) are not "built".
    kinds: s.players.map((_, o) => [...new Set(s.buildings.filter(b => b.owner === o && b.placedAt <= 0).map(b => b.kind))] as string[]),
    scan: 0,
  };
  for (let o = 0; o < s.players.length; o++) if (h.acc[o]) h.acc[o][0] = s.players[o].stats.harvested;
  return seen;
}

/** A structure finished: the first of its kind for its side, and every Refinery, are events. */
function noteBuilt(h: BattleHistory, b: Building): void {
  const seen = h.seen!;
  const kinds = seen.kinds[b.owner];
  if (!kinds || BUILDINGS[b.kind].wall) return;
  const first = !kinds.includes(b.kind);
  if (first) kinds.push(b.kind);
  if (first || b.kind === 'refinery') pushEvent(h, Math.max(0, b.placedAt), b.owner, 'built', b.kind);
}

/** Built events for structures placed since the last scan. Reads only. */
export function pendingBuilt(s: GameState, h: BattleHistory): Building[] {
  const scan = h.seen?.scan ?? 0;
  return s.buildings.filter(b => b.placedAt > scan && b.placedAt <= s.tick).sort((a, b) => a.placedAt - b.placedAt || a.id - b.id);
}

/**
 * Called once at the end of every tick (tick.ts, step). Notices research finished, support powers
 * used, sites changing hands and Derrick income each tick; every HISTORY_SAMPLE_TICKS it scans for
 * new structures, writes heavy-loss events and takes the sample.
 */
export function recordHistory(s: GameState): void {
  const h = s.history;
  if (!h) return;
  if (!h.seen) h.seen = firstSeen(s, h);
  const seen = h.seen;
  const n = s.players.length;
  for (let o = 0; o < n; o++) {
    const ups = s.players[o].upgrades;
    const have = ups?.length ?? 0;
    if (have > seen.up[o]) for (let i = seen.up[o]; i < have; i++) pushEvent(h, s.tick, o as Owner, 'research', ups![i]);
    seen.up[o] = have;
  }
  if (s.powers) {
    for (let o = 0; o < n; o++) {
      const now = s.powers[o] ?? {};
      const was = seen.pw[o] ?? (seen.pw[o] = {});
      for (const k of Object.keys(was)) if (!(k in now)) delete was[k];
      for (const [k, v] of Object.entries(now)) {
        if (v === undefined) continue;
        if (was[k] !== undefined && v > was[k]) pushEvent(h, s.tick, o as Owner, 'power', k);
        was[k] = v;
      }
    }
  }
  if (s.sites) {
    // A side's first capture of each site is an event; sites changing hands back and forth are not.
    const held = seen.held ?? (seen.held = []);
    for (let i = 0; i < s.sites.length; i++) {
      const site = s.sites[i];
      if (site.owner !== (seen.site[i] ?? null) && site.owner !== null) {
        const bit = 2 ** site.owner;
        if (!(Math.floor((held[i] ?? 0) / bit) % 2)) {
          pushEvent(h, s.tick, site.owner, 'site', site.kind);
          held[i] = (held[i] ?? 0) + bit;
        }
      }
      seen.site[i] = site.owner;
    }
    // Derrick income, exactly as sites.ts pays it this tick (owners cannot change after it pays).
    if (s.sites.length && s.tick % DERRICK_TICKS === 0)
      for (const site of s.sites) if (site.owner !== null && site.kind === 'derrick' && h.acc[site.owner]) h.acc[site.owner][1] += DERRICK_INCOME;
  }
  if (s.tick % h.every !== 0) return;
  for (const b of pendingBuilt(s, h)) noteBuilt(h, b);
  seen.scan = s.tick;
  for (let o = 0; o < n; o++) {
    const w = h.win[o];
    if (!w) continue;
    const total = Object.values(w[0]).reduce((a, b) => a + b, 0);
    if (total >= HEAVY_LOSSES) {
      const top = (r: Record<string, number>, weigh: (k: string) => number) =>
        Object.entries(r).sort((a, b) => b[1] * weigh(b[0]) - a[1] * weigh(a[0]) || (a[0] < b[0] ? -1 : 1))[0];
      // The kind that cost the most (count times its list price), and what killed the most.
      const [kind, count] = top(w[0], k => (UNITS as Record<string, { cost: number } | undefined>)[k]?.cost ?? 1);
      const killer = top(w[1], () => 1)?.[0] ?? 'defences';
      pushEvent(h, s.tick, o as Owner, 'losses', kind, count, killer, total);
    }
    h.win[o] = [{}, {}];
  }
  appendSample(h, sampleNow(s, h));
  for (let o = 0; o < n; o++) {
    const acc = h.acc[o];
    if (!acc) continue;
    acc.fill(0);
    acc[0] = s.players[o].stats.harvested;
  }
}

/** A unit has died (tick.ts, removeDead): its category's loss, and a hero or General falling; riders aboard die with it. */
export function noteUnitDeath(s: GameState, u: Unit): void {
  const h = s.history;
  if (!h) return;
  for (const v of [u, ...(u.carried ?? [])]) {
    const c = HISTORY_CATS.indexOf(UNITS[v.kind].category);
    if (h.acc[v.owner] && c >= 0) h.acc[v.owner][LOST + c]++;
    if (v.hero) pushEvent(h, s.tick, v.owner, 'hero', v.kind);
    else if (v.kind === 'general') pushEvent(h, s.tick, v.owner, 'general', 'general');
  }
}

/** A structure has been destroyed (tick.ts, removeDead). Walls are not counted. */
export function noteBuildingDeath(s: GameState, b: Building): void {
  const h = s.history;
  if (!h || BUILDINGS[b.kind].wall) return;
  // Built and destroyed between two scans: its "built" event first.
  if (h.seen && b.placedAt > h.seen.scan) noteBuilt(h, b);
  if (h.acc[b.owner]) h.acc[b.owner][LOST + 4]++;
  pushEvent(h, s.tick, b.owner, 'lost', b.kind);
}

/**
 * A kill credited to side `by` (tick.ts, credit): its category, Salvage crews' pay (the same sum
 * credit pays), and for the victim's side what was lost and to what.
 */
export function noteKill(s: GameState, by: Owner, victimOwner: Owner, killer: Unit | undefined, t: { unit?: Unit; building?: Building }): void {
  const h = s.history;
  if (!h) return;
  const acc = h.acc[by];
  if (t.unit) {
    const cat = UNITS[t.unit.kind].category;
    const c = HISTORY_CATS.indexOf(cat);
    if (acc && c >= 0) acc[KILLED + c]++;
    if (acc && salvageOf(s, by) && (cat === 'vehicle' || cat === 'air')) acc[1] += Math.floor(SALVAGE_SHARE * unitSpecOf(s, t.unit).cost);
    const w = h.win[victimOwner];
    if (w) {
      w[0][t.unit.kind] = (w[0][t.unit.kind] ?? 0) + 1;
      const k = killer ? killer.kind : 'defences';
      w[1][k] = (w[1][k] ?? 0) + 1;
    }
  } else if (t.building && !BUILDINGS[t.building.kind].wall && acc) acc[KILLED + 4]++;
}

// ---- Reading -----------------------------------------------------------------------------------

export interface SideSeries {
  /** Credits held. */
  credits: number[];
  /** Credits earned in the interval ending at the sample (harvest, Derricks, salvage). */
  income: number[];
  army: number[];
  structures: number[];
  /** By HISTORY_CATS, in the interval. */
  lost: number[][];
  killed: number[][];
  powerMade: number[];
  powerUsed: number[];
  /** Thousandths of the ore on the map. */
  ore: number[];
}

export interface DecodedHistory {
  every: number;
  /** The tick of each sample. The last may be a partial interval: the state now (decodeHistory with s). */
  ticks: number[];
  sides: SideSeries[];
  /** Sorted by tick. */
  events: HistoryEvent[];
}

/** Rows (stored units) back into per-side series, in credits. */
function seriesFrom(rows: number[][][], sides: number): SideSeries[] {
  return Array.from({ length: sides }, (_, o) => {
    const col = (f: number) => rows.map(r => r[o][f] * (MONEY[f] ?? 1));
    return {
      credits: col(0),
      income: col(1),
      army: col(2),
      structures: col(3),
      lost: HISTORY_CATS.map((_, c) => col(LOST + 2 + c)),
      killed: HISTORY_CATS.map((_, c) => col(KILLED + 2 + c)),
      powerMade: col(14),
      powerUsed: col(15),
      ore: col(16),
    };
  });
}

/** The packed loss and kill column back into its ten series, or null when it does not read. */
function unpack(str: string, n: number): number[][] | null {
  const raw = decodeInts(str);
  if (!raw) return null;
  const out = Array.from({ length: PACKED }, () => new Array<number>(n).fill(0));
  let k = 0;
  for (let i = 0; i < n; i++) {
    const mask = raw[k++];
    if (mask === undefined || mask >= 2 ** PACKED) return null;
    for (let b = 0; b < PACKED; b++) {
      if (!(Math.floor(mask / 2 ** b) % 2)) continue;
      const v = raw[k++];
      if (v === undefined) return null;
      out[b][i] = v + 1;
    }
  }
  return k === raw.length ? out : null;
}

/** The stored samples as rows: rows[sample][side][field], in stored units. Null when corrupt. */
export function sampleRows(h: BattleHistory): number[][][] | null {
  const sides = h.s.length;
  const cols: number[][][] = [];
  for (let o = 0; o < sides; o++) {
    const fields: number[][] = [];
    for (let f = 0; f < F; f++) {
      if (f >= PACKED0 && f < PACKED0 + PACKED) {
        if (f === PACKED0) {
          const unpacked = unpack(h.s[o][PACKED0] ?? '', h.n);
          if (!unpacked) return null;
          fields.push(...unpacked);
        }
        continue;
      }
      const raw = decodeInts(h.s[o][columnOf(f)] ?? '');
      if (!raw || raw.length !== h.n) return null;
      if (DELTA.has(f)) {
        let v = 0;
        fields.push(raw.map(z => (v += unzig(z))));
      } else fields.push(raw);
    }
    cols.push(fields);
  }
  return Array.from({ length: h.n }, (_, i) => cols.map(fields => fields.map(series => series[i])));
}

/**
 * The history as series and events. Given the battle's state, adds the battle so far: a last
 * sample at s.tick (when it is past the last one) and structures built since the last scan.
 */
export function decodeHistory(h: BattleHistory, s?: GameState): DecodedHistory | null {
  const rows = sampleRows(h);
  if (!rows) return null;
  const ticks = rows.map((_, i) => (i + 1) * h.every);
  const events = historyEvents(h);
  if (s && s.tick > h.n * h.every) {
    rows.push(sampleNow(s, h));
    ticks.push(s.tick);
    const kinds = h.seen ? h.seen.kinds.map(k => k.slice()) : s.players.map(() => [] as string[]);
    for (const b of pendingBuilt(s, h)) {
      if (BUILDINGS[b.kind].wall || !kinds[b.owner]) continue;
      const first = !kinds[b.owner].includes(b.kind);
      if (first) kinds[b.owner].push(b.kind);
      if (first || b.kind === 'refinery') events.push({ tick: Math.max(0, b.placedAt), side: b.owner, kind: 'built', what: b.kind });
    }
  }
  events.sort((a, b) => a.tick - b.tick || a.side - b.side);
  return { every: h.every, ticks, sides: seriesFrom(rows, h.s.length), events };
}

/** A history from a save: kept only when well formed for `sides` sides, copied; else null. */
export function migrateHistory(raw: unknown, sides: number): BattleHistory | null {
  const h = raw as Partial<BattleHistory> | null;
  if (!h || typeof h !== 'object' || h.v !== 1) return null;
  if (!Number.isInteger(h.every) || h.every! < 1 || !Number.isInteger(h.n) || h.n! < 0) return null;
  const grid = (a: unknown, ok: (v: unknown) => boolean, w: number) =>
    Array.isArray(a) && a.length === sides && a.every(r => Array.isArray(r) && r.length === w && r.every(ok));
  if (!grid(h.s, v => typeof v === 'string', COLUMNS) || !grid(h.last, v => Number.isFinite(v), F) || !grid(h.acc, v => Number.isFinite(v), ACC)) return null;
  if (typeof h.ev !== 'string' || !Array.isArray(h.dict) || !h.dict.every(e => typeof e === 'string')) return null;
  if (h.capped !== undefined && !Number.isInteger(h.capped)) return null;
  const isTally = (r: unknown) => !!r && typeof r === 'object' && Object.values(r).every(v => Number.isFinite(v));
  if (!Array.isArray(h.win) || h.win.length !== sides || !h.win.every(w => Array.isArray(w) && w.length === 2 && isTally(w[0]) && isTally(w[1]))) return null;
  let seenOk = h.seen === undefined;
  if (!seenOk) {
    const sn = h.seen as Partial<NonNullable<BattleHistory['seen']>> | null;
    seenOk =
      !!sn &&
      typeof sn === 'object' &&
      Array.isArray(sn.up) &&
      sn.up.length === sides &&
      sn.up.every(v => Number.isInteger(v)) &&
      Array.isArray(sn.pw) &&
      sn.pw.length === sides &&
      sn.pw.every(isTally) &&
      Array.isArray(sn.site) &&
      Array.isArray(sn.kinds) &&
      sn.kinds.length === sides &&
      sn.kinds.every(k => Array.isArray(k) && k.every(x => typeof x === 'string')) &&
      Number.isInteger(sn.scan) &&
      (sn.held === undefined || (Array.isArray(sn.held) && sn.held.every(v => Number.isInteger(v) && v >= 0 && v < 16)));
  }
  const { seen: _seen, ...rest } = h as BattleHistory;
  // A junk first look is dropped and taken afresh on the next tick; the samples are kept.
  const out = cloneHistory(seenOk ? (h as BattleHistory) : (rest as BattleHistory));
  if (!sampleRows(out)) return null;
  return out;
}

/** Bytes the history adds to a save. */
export const historyBytes = (h: BattleHistory | undefined): number => (h ? JSON.stringify(h).length : 0);
