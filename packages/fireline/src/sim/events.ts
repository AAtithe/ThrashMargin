/**
 * Battlefield events (2026-11-28, `setup.events`). Before this a skirmish had one shape: build, mass,
 * attack a base, with nothing on the map ever changing. Events give the middle of a battle decisions
 * that were not there at the start, at times and places drawn from the seed text, so no two seeds play
 * alike and a plan made in the first minute has to bend.
 *
 *  - Supply drop: one crate per side comes down near the middle of the map. The first ground unit to
 *    reach a crate takes its credits. Contested by design: the crates land close together.
 *  - Ore strike: a fresh ore field opens in each side's forward ground. Worth an expansion, and worth
 *    denying the enemy his.
 *  - Relief column: a signal beacon at the middle of the map (or near it, one per side, where the
 *    middle is water or rock). A team whose armed units hold it alone for RELIEF_HOLD_TICKS calls in
 *    a relief column there.
 *
 * Every event is placed through the map's own symmetry (two sides the point mirror, four the quarter
 * turn, three the third of a turn), so no seat is favoured. Never in a mission or a War for the Planet
 * battle; never with the setup's `events` off or absent, when `s.events` is never created and nothing
 * here runs, so every older save plays exactly as before.
 *
 * Pure: no Math.random, no clock. The schedule, the kinds and the places come from a stream of their
 * own (the seed text and a salt, kept in `s.events.seed`), never from the battle's stream.
 */
import { mapScale } from './aiScale';
import { dist, occupancy } from './grid';
import { isWalkable } from './map';
import { isShip } from './naval';
import { next, seedFromString } from './rng';
import { SIDE_NAMES, UNITS, type Owner, type UnitKind } from './rules';
import { isAlly, startOf, teamOf } from './sides';
import { factionAllows, factionOf, unitSpecOf } from './specs';
import { addUnit, log } from './state';
import type { GameState, Unit } from './types';

export type FieldEventKind = 'drop' | 'ore' | 'relief';

/** One thing on the map an event put there: a crate, a beacon, or an ore strike's marker. */
export interface FieldEvent {
  /** From s.nextId, like units and structures. */
  id: number;
  kind: FieldEventKind;
  /** The tile it stands on (a crate's or beacon's tile; an ore strike's centre). */
  x: number;
  y: number;
  /** A crate's credits. 0 for the others. */
  value: number;
  /** The tick it goes: a crate or beacon unclaimed, or an ore strike's marker fading. */
  until: number;
  /** A beacon being held: the team and its progress in ticks. Absent while nobody holds it. */
  hold?: { team: number; ticks: number };
}

export interface BattleEvents {
  /** Events fired so far. */
  n: number;
  /** The tick the next event fires. */
  next: number;
  /** The events' own random stream. */
  seed: number;
  live: FieldEvent[];
}

// ---- Numbers ---------------------------------------------------------------------------------

/** The first event: between EVENT_FIRST and EVENT_FIRST + EVENT_SPREAD ticks (five to seven minutes). */
export const EVENT_FIRST = 3000;
/** Between events: EVENT_GAP to EVENT_GAP + EVENT_SPREAD ticks (six to eight minutes). */
export const EVENT_GAP = 3600;
export const EVENT_SPREAD = 1200;
/** A crate's credits: DROP_VALUE, and DROP_STEP more for each event before it, at most DROP_MAX. */
export const DROP_VALUE = 1000;
export const DROP_STEP = 250;
export const DROP_MAX = 2500;
/** A crate is taken by a ground unit within this many tiles of its centre. */
export const DROP_REACH = 1.2;
/** A crate waits this long (three minutes on a standard map, more on a larger one). */
export const DROP_LIFE = 1800;
/** Ore strike: the field's radius in tiles, and the ore on a tile at its heart and at its edge. */
export const ORE_STRIKE_RADIUS = 2.6;
export const ORE_STRIKE_HEART = 500;
export const ORE_STRIKE_EDGE = 220;
/** How long an ore strike's marker shows (one minute). */
export const ORE_MARK_LIFE = 600;
/** Relief: armed units within this many tiles hold the beacon. */
export const RELIEF_RANGE = 3;
/** Ticks a team must hold the beacon alone (thirty seconds). */
export const RELIEF_HOLD_TICKS = 300;
/** A beacon waits this long for someone to hold it (four minutes, more on a larger map). */
export const RELIEF_LIFE = 2400;
/** Ticks between the beacon's checks. */
const RELIEF_CHECK = 10;

/** Mixed into the seed for the events' stream ("EVNT"), so the battle's own stream is never touched. */
const EVENT_SALT = 0x45564e54;

/** Events are in play: a skirmish set up with them, never a mission or a planet battle. */
export function eventsOn(s: GameState): boolean {
  return !s.mission && !s.planet && s.setup?.events === true;
}

/** A new battle's events: none yet, the first scheduled. Called by createInitialState. */
export function startEvents(s: GameState): void {
  if (!eventsOn(s)) return;
  let seed = (seedFromString(s.seedText) ^ EVENT_SALT) >>> 0;
  const r = next(seed);
  seed = r.seed;
  s.events = { n: 0, next: EVENT_FIRST + Math.floor(r.value * EVENT_SPREAD), seed, live: [] };
}

// ---- Placement -------------------------------------------------------------------------------

/** Each side's copy of a tile in side 0's share: the map's own symmetry, as the neutral sites use it. */
export function eventCopies(s: GameState, x: number, y: number): { x: number; y: number }[] | null {
  const n = s.players.length;
  const W = s.mapW;
  const H = s.mapH;
  let out: { x: number; y: number }[];
  if (n === 2) out = [{ x, y }, { x: W - 1 - x, y: H - 1 - y }];
  else if (n === 4) {
    out = [{ x, y }];
    let p = { x, y };
    for (let k = 1; k < 4; k++) {
      p = { x: W - 1 - p.y, y: p.x };
      out.push(p);
    }
  } else {
    // Three sides: a third of a turn about the middle, rounded, nudged to the nearest walkable tile.
    const C = (W - 1) / 2;
    const ROT_C = -0.5;
    const ROT_S = 0.8660254037844386;
    out = [{ x, y }];
    let v = { dx: x - C, dy: y - C };
    for (let k = 1; k < 3; k++) {
      v = { dx: ROT_C * v.dx - ROT_S * v.dy, dy: ROT_S * v.dx + ROT_C * v.dy };
      const rx = Math.round(C + v.dx);
      const ry = Math.round(C + v.dy);
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const d = dx * dx + dy * dy;
          if (d >= bestD) continue;
          const tx = rx + dx;
          const ty = ry + dy;
          if (tx < 0 || ty < 0 || tx >= W || ty >= H || !isWalkable(s.tiles[ty * W + tx])) continue;
          best = { x: tx, y: ty };
          bestD = d;
        }
      if (!best) return null;
      out.push(best);
    }
  }
  for (const p of out) if (p.x < 1 || p.y < 1 || p.x >= W - 1 || p.y >= H - 1 || !isWalkable(s.tiles[p.y * W + p.x])) return null;
  return out;
}

/** Every walkable tile reachable on foot from side 0's yard (water and rock close it). */
function reachableFromHome(s: GameState): Uint8Array {
  const W = s.mapW;
  const H = s.mapH;
  const seen = new Uint8Array(W * H);
  const st = startOf(s, 0);
  const queue: number[] = [];
  for (let ty = st.y - 1; ty <= st.y + 3; ty++)
    for (let tx = st.x - 1; tx <= st.x + 3; tx++) {
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      const k = ty * W + tx;
      if (seen[k] || !isWalkable(s.tiles[k])) continue;
      seen[k] = 1;
      queue.push(k);
    }
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head];
    const x = k % W;
    const y = (k / W) | 0;
    if (x > 0 && !seen[k - 1] && isWalkable(s.tiles[k - 1])) (seen[k - 1] = 1), queue.push(k - 1);
    if (x < W - 1 && !seen[k + 1] && isWalkable(s.tiles[k + 1])) (seen[k + 1] = 1), queue.push(k + 1);
    if (y > 0 && !seen[k - W] && isWalkable(s.tiles[k - W])) (seen[k - W] = 1), queue.push(k - W);
    if (y < H - 1 && !seen[k + W] && isWalkable(s.tiles[k + W])) (seen[k + W] = 1), queue.push(k + W);
  }
  return seen;
}

/** Whether a tile is in side 0's share of the map (where a spot is drawn before its copies are made). */
function inShare0(s: GameState, x: number, y: number): boolean {
  const n = s.players.length;
  const dx = x - (s.mapW - 1) / 2;
  const dy = y - (s.mapH - 1) / 2;
  const st = startOf(s, 0);
  // Side 0's share is its own half (two), quarter (four) or third (three), whichever way its yard faces.
  const hx = st.x + 1.5 - (s.mapW - 1) / 2;
  const hy = st.y + 1.5 - (s.mapH - 1) / 2;
  const len = Math.hypot(hx, hy) || 1;
  const along = (dx * hx + dy * hy) / len;
  const across = Math.abs(dx * hy - dy * hx) / len;
  if (n === 2) return along > 0.5;
  if (n === 4) return along > 0.5 && across <= along;
  return along > 0.5 && across * across <= 3 * along * along;
}

/**
 * Spots for an event, one per side, at a band of side 0's distance from its yard to the middle (0 its
 * yard, 1 the middle) and no further from the middle than 1.1 - lo of that distance, drawn with `roll`. Every copy on open, reachable ground with no structure on
 * it. Null when the map has none.
 */
function spotsInBand(s: GameState, lo: number, hi: number, roll: () => number): { x: number; y: number }[] | null {
  const W = s.mapW;
  const H = s.mapH;
  const reach = reachableFromHome(s);
  const occ = occupancy(s);
  const st = startOf(s, 0);
  const home = { x: st.x + 1.5, y: st.y + 1.5 };
  const span = dist(home.x, home.y, (W - 1) / 2, (H - 1) / 2);
  const pool: { x: number; y: number }[][] = [];
  // A coarse grid keeps the search quick on the largest maps; the draw is still over the whole band.
  const step = Math.max(1, Math.round(W / 96));
  for (let y = 1; y < H - 1; y += step)
    for (let x = 1; x < W - 1; x += step) {
      if (!inShare0(s, x, y)) continue;
      const d = dist(x + 0.5, y + 0.5, home.x, home.y) / span;
      if (d < lo || d > hi) continue;
      // Toward the middle, not along the edge at the same distance from home.
      if (dist(x + 0.5, y + 0.5, (W - 1) / 2, (H - 1) / 2) / span > 1.1 - lo) continue;
      const copies = eventCopies(s, x, y);
      if (!copies) continue;
      if (copies.some(c => !reach[c.y * W + c.x] || occ[c.y * W + c.x] !== 0)) continue;
      pool.push(copies);
    }
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(roll() * pool.length))];
}

/** The middle of the map, when it is open, reachable ground: the one spot every side is equally far from. */
function middleSpot(s: GameState): { x: number; y: number } | null {
  const W = s.mapW;
  const H = s.mapH;
  // An even map's middle is a corner shared by four tiles; all four must be open for the beacon to be fair.
  const xs = W % 2 === 0 ? [W / 2 - 1, W / 2] : [(W - 1) / 2];
  const ys = H % 2 === 0 ? [H / 2 - 1, H / 2] : [(H - 1) / 2];
  const reach = reachableFromHome(s);
  const occ = occupancy(s);
  for (const y of ys) for (const x of xs) if (!reach[y * W + x] || occ[y * W + x] !== 0) return null;
  return { x: xs[0], y: ys[0] };
}

// ---- The step --------------------------------------------------------------------------------

/** Where on the map a tile lies, in words for the log: the middle, or a compass direction from it. */
export function bearingOf(s: GameState, x: number, y: number): string {
  const dx = x - (s.mapW - 1) / 2;
  const dy = y - (s.mapH - 1) / 2;
  if (Math.hypot(dx, dy) < s.mapW * 0.12) return 'the middle of the map';
  const ns = dy < -Math.abs(dx) * 0.5 ? 'north' : dy > Math.abs(dx) * 0.5 ? 'south' : '';
  const ew = dx < -Math.abs(dy) * 0.5 ? 'west' : dx > Math.abs(dy) * 0.5 ? 'east' : '';
  return `the ${ns}${ew} of the map`;
}

/** Can this unit take a crate or hold a beacon: on the ground (no aircraft, no ships), alive. */
function onTheGround(u: Unit): boolean {
  return u.hp > 0 && UNITS[u.kind].category !== 'air' && !isShip(u);
}

/** Each tick: fire the next event when due, crates taken, beacons held, and what has waited too long gone. */
export function eventsStep(s: GameState): void {
  const ev = s.events;
  if (!ev || !eventsOn(s) || s.winner !== null) return;
  if (s.tick >= ev.next) fireEvent(s);
  if (!ev.live.length) return;
  let changed = false;
  const kept: FieldEvent[] = [];
  for (const e of ev.live) {
    if (s.tick >= e.until) {
      if (e.kind !== 'ore') log(s, e.kind === 'drop' ? 'The supply crate went unclaimed and was lost.' : 'The relief column turned back: nobody held the beacon.', 'info');
      changed = true;
      continue;
    }
    if (e.kind === 'drop') {
      const taker = crateTaker(s, e);
      if (taker !== null) {
        s.players[taker].credits += e.value;
        if (isAlly(s, taker, 0)) log(s, `${taker === 0 ? 'Supply crate taken' : `${SIDE_NAMES[taker]} took a supply crate`}: ${e.value.toLocaleString('en-GB')} credits.`, 'good');
        else log(s, `The ${SIDE_NAMES[taker]} took a supply crate.`, 'bad');
        changed = true;
        continue;
      }
    } else if (e.kind === 'relief' && s.tick % RELIEF_CHECK === 0) {
      const claimed = holdBeacon(s, e);
      if (claimed) {
        changed = true;
        continue;
      }
    }
    kept.push(e);
  }
  if (changed) ev.live = kept;
}

/**
 * Fires the next event now and schedules the one after. `force` picks its kind (the tests only; the
 * battle draws it). Nothing without events.
 */
export function fireEvent(s: GameState, force?: FieldEventKind): void {
  const ev = s.events;
  if (!ev || !eventsOn(s)) return;
  const roll = () => {
    const r = next(ev.seed);
    ev.seed = r.seed;
    return r.value;
  };
  ev.next = s.tick + EVENT_GAP + Math.floor(roll() * EVENT_SPREAD);
  const k = roll();
  // A drop is the commonest; the first event is never the relief column (armies are still small).
  const kind: FieldEventKind = force ?? (k < 0.4 ? 'drop' : k < 0.7 || ev.n === 0 ? 'ore' : 'relief');
  const life = Math.round(mapScale(s) * (kind === 'relief' ? RELIEF_LIFE : DROP_LIFE));
  ev.n++;
  if (kind === 'drop') {
    // Close to the middle, so the crates land near one another and are raced for, not each side's own.
    const spots = spotsInBand(s, 0.86, 1.0, roll) ?? spotsInBand(s, 0.7, 1.0, roll);
    if (!spots) return;
    const value = Math.min(DROP_MAX, DROP_VALUE + DROP_STEP * (ev.n - 1));
    for (const p of spots) ev.live.push({ id: s.nextId++, kind, x: p.x, y: p.y, value, until: s.tick + life });
    log(s, `Supply drop: ${spots.length} crates are coming down near ${bearingOf(s, spots[0].x, spots[0].y)}, ${value.toLocaleString('en-GB')} credits each to the first unit there.`, 'info');
  } else if (kind === 'ore') {
    const spots = spotsInBand(s, 0.4, 0.8, roll);
    if (!spots) return;
    for (const p of spots) {
      oreStrike(s, p.x, p.y);
      ev.live.push({ id: s.nextId++, kind, x: p.x, y: p.y, value: 0, until: s.tick + ORE_MARK_LIFE });
    }
    // Side 0 hears about its own copy: the field in its own forward ground.
    log(s, `Ore strike: surveyors report a fresh ore field toward ${bearingOf(s, spots[0].x, spots[0].y)}, and one in each enemy's ground.`, 'info');
  } else {
    const middle = middleSpot(s);
    const spots = middle ? [middle] : spotsInBand(s, 0.88, 1.0, roll);
    if (!spots) return;
    for (const p of spots) ev.live.push({ id: s.nextId++, kind, x: p.x, y: p.y, value: 0, until: s.tick + life });
    log(s, `Relief column: hold the signal beacon at ${bearingOf(s, spots[0].x, spots[0].y)} with armed units, unopposed, for ${RELIEF_HOLD_TICKS / 10} seconds and it joins you.`, 'info');
  }
}

/** Ore on every open tile within the radius, richest at the heart; never under a structure or on water. */
function oreStrike(s: GameState, cx: number, cy: number): void {
  const W = s.mapW;
  const occ = occupancy(s);
  const r = Math.ceil(ORE_STRIKE_RADIUS);
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= W || y >= s.mapH) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > ORE_STRIKE_RADIUS) continue;
      const k = y * W + x;
      const c = s.tiles[k];
      if ((c !== 'g' && c !== 'd') || occ[k] > 0) continue;
      const amount = Math.round(ORE_STRIKE_HEART - (ORE_STRIKE_HEART - ORE_STRIKE_EDGE) * (d / ORE_STRIKE_RADIUS));
      s.ore[k] = Math.max(s.ore[k], amount);
    }
}

/** The side whose ground unit is nearest a crate and within reach, or null. Ties go to the lower side. */
function crateTaker(s: GameState, e: FieldEvent): Owner | null {
  const cx = e.x + 0.5;
  const cy = e.y + 0.5;
  let best: Owner | null = null;
  let bestD = DROP_REACH;
  for (const u of s.units) {
    if (u.x < cx - DROP_REACH || u.x > cx + DROP_REACH || u.y < cy - DROP_REACH || u.y > cy + DROP_REACH) continue;
    if (!onTheGround(u)) continue;
    const d = dist(u.x, u.y, cx, cy);
    if (d < bestD || (d === bestD && best !== null && u.owner < best)) {
      best = u.owner;
      bestD = d;
    }
  }
  return best;
}

/** The units that can hold a beacon: armed, on the ground, within RELIEF_RANGE of it. */
export function beaconHolders(s: GameState, e: FieldEvent): Unit[] {
  const cx = e.x + 0.5;
  const cy = e.y + 0.5;
  return s.units.filter(u => onTheGround(u) && !!unitSpecOf(s, u).weapon && dist(u.x, u.y, cx, cy) <= RELIEF_RANGE);
}

/** One check of a beacon. True when it was claimed this check (the relief is on the map and the beacon gone). */
function holdBeacon(s: GameState, e: FieldEvent): boolean {
  const here = beaconHolders(s, e);
  const teams = new Set(here.map(u => teamOf(s, u.owner)));
  if (teams.size === 1) {
    const team = [...teams][0];
    const ticks = e.hold && e.hold.team === team ? e.hold.ticks + RELIEF_CHECK : RELIEF_CHECK;
    if (ticks >= RELIEF_HOLD_TICKS) {
      // The side of that team with the most units on the beacon takes the column; ties to the lower side.
      const counts = new Map<Owner, number>();
      for (const u of here) counts.set(u.owner, (counts.get(u.owner) ?? 0) + 1);
      let owner = here[0].owner;
      for (const [o, c] of counts) if (c > (counts.get(owner) ?? 0) || (c === counts.get(owner) && o < owner)) owner = o;
      reliefArrives(s, owner, e);
      return true;
    }
    e.hold = { team, ticks };
  } else if (teams.size === 0 && e.hold) {
    // Left alone, a hold slips back at half the rate it was built.
    const ticks = e.hold.ticks - RELIEF_CHECK / 2;
    if (ticks <= 0) delete e.hold;
    else e.hold = { team: e.hold.team, ticks };
  }
  // Contested: the hold stands still.
  return false;
}

/** The relief column a side receives: tanks and rocket troops, or what its army fields in their place. */
export function reliefKinds(s: GameState, owner: Owner): UnitKind[] {
  const army = factionOf(s, owner);
  const pick = (want: UnitKind, instead: UnitKind): UnitKind => (factionAllows(army, want) ? want : instead);
  const tank = pick('tank', 'rocketeer');
  return [tank, tank, pick('rocketeer', 'rifleman'), pick('rocketeer', 'rifleman'), 'rifleman', 'rifleman'];
}

function reliefArrives(s: GameState, owner: Owner, e: FieldEvent): void {
  const occ = occupancy(s);
  const kinds = reliefKinds(s, owner);
  let placed = 0;
  // Ring by ring round the beacon, on open ground.
  for (let r = 1; r <= 6 && placed < kinds.length; r++)
    for (let dy = -r; dy <= r && placed < kinds.length; dy++)
      for (let dx = -r; dx <= r && placed < kinds.length; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = e.x + dx;
        const y = e.y + dy;
        if (x < 0 || y < 0 || x >= s.mapW || y >= s.mapH) continue;
        const k = y * s.mapW + x;
        if (occ[k] !== 0 || !isWalkable(s.tiles[k])) continue;
        addUnit(s, owner, kinds[placed], x + 0.5, y + 0.5);
        occ[k] = -1;
        placed++;
      }
  if (isAlly(s, owner, 0)) log(s, `${owner === 0 ? 'The relief column has joined you' : `The relief column joined the ${SIDE_NAMES[owner]}`} at the beacon: ${placed} units.`, 'good');
  else log(s, `The ${SIDE_NAMES[owner]} held the beacon: a relief column has joined them.`, 'bad');
}

/** What is on the map now, for the commanders and the renderer: nothing without events. */
export function liveEvents(s: GameState): FieldEvent[] {
  return s.events && eventsOn(s) ? s.events.live : [];
}

/** A copy of the events for cloneState: the live list and each hold copied, never shared. */
export function cloneEvents(ev: BattleEvents): BattleEvents {
  return { ...ev, live: ev.live.map(e => (e.hold ? { ...e, hold: { ...e.hold } } : { ...e })) };
}

/** A save's events, repaired or dropped: kept only with events on, every field checked. */
export function migrateEvents(raw: unknown, s: GameState): BattleEvents | null {
  if (!eventsOn(s)) return null;
  const r = raw as Partial<BattleEvents> | null;
  const whole = (v: unknown, min = 0): v is number => Number.isInteger(v) && (v as number) >= min;
  if (!r || typeof r !== 'object' || !whole(r.n) || !whole(r.next) || !whole(r.seed) || !Array.isArray(r.live)) return null;
  const n = s.players.length;
  const live: FieldEvent[] = [];
  for (const x of r.live.slice(0, 16)) {
    const e = x as Partial<FieldEvent> | null;
    if (!e || typeof e !== 'object' || !whole(e.id, 1) || (e.kind !== 'drop' && e.kind !== 'ore' && e.kind !== 'relief')) continue;
    if (!whole(e.x) || !whole(e.y) || e.x! >= s.mapW || e.y! >= s.mapH || !whole(e.value) || !whole(e.until)) continue;
    const out: FieldEvent = { id: e.id!, kind: e.kind, x: e.x!, y: e.y!, value: Math.min(DROP_MAX, e.value!), until: e.until! };
    const h = e.hold as { team?: unknown; ticks?: unknown } | undefined;
    if (e.kind === 'relief' && h && typeof h === 'object' && whole(h.team) && (h.team as number) < n && whole(h.ticks, 1) && (h.ticks as number) < RELIEF_HOLD_TICKS)
      out.hold = { team: h.team as number, ticks: h.ticks as number };
    live.push(out);
  }
  return { n: r.n!, next: r.next!, seed: r.seed! >>> 0, live };
}

