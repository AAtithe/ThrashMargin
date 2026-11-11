import { buildingCentre, dist, distToBuilding } from './grid';
import { isWalkable } from './map';
import { isDetected } from './mission';
import { next } from './rng';
import {
  DERRICK_INCOME,
  DERRICK_TICKS,
  HOSPITAL_HEAL,
  HOSPITAL_RANGE,
  HOSPITAL_TICKS,
  SITE_CAPTURE_RANGE,
  SITE_CAPTURE_TICKS,
  SITE_GAP,
  SITE_KINDS,
  SITE_YARD_GAP,
  SITES,
  SITES_PER_SIDE,
  DETECTOR_RANGE,
  STEALTH_DETECT_RANGE,
  STEALTH_REVEAL_TICKS,
  UNITS,
  type MapSize,
  type Owner,
  type SiteKind,
  type SkirmishSetup,
} from './rules';
import { isAlly, isEnemy, isSide, sidesOf, teamOf } from './sides';
import { isStructure, log, maxHpOf } from './state';
import type { GameState, Site, Unit } from './types';

/**
 * Neutral sites and stealth (fireline-round5-design.md, workstream D). Pure: no Math.random, no
 * clock. Everything here works in place on a state the reducer has already cloned, except the
 * placement helpers, which only read.
 *
 *  - Placement: siteSpots picks spots in side 0's share of the map with its own random stream and
 *    maps each one through the map's own symmetry, so every side gets the same set at the same
 *    distances. placeSites writes them into a new battle; sitesProblem checks the rules.
 *  - Each tick (sitesStep): capture by infantry, Oil Derrick income, Field Hospital healing, and
 *    the Stealth Tank's bookkeeping (its last shot; enemies dropping it once it slips from sight).
 *  - Comms Relays reveal their area through visibility (state.ts), which calls relaysSeenBy.
 *
 * A site is never a structure: not a target, never in victory, not in sides.ts. It blocks its
 * tiles (occupancy) with its own id, which nothing dereferences.
 */

// ---------------------------------------------------------------------------------------------
// Placement

/** What siteSpots needs of a map: the generator's output, or a battle's own fields. */
export interface SiteMap {
  w: number;
  h: number;
  tiles: string;
  ore: number[];
  /** Top-left tile of each side's Command Yard (3 by 3). */
  starts: { x: number; y: number }[];
}

export interface SiteSpot {
  kind: SiteKind;
  x: number;
  y: number;
}

/** A constant mixed into the placement stream, so it never follows the battle's own. */
const SITE_SALT = 0x51735173;
/** Placement keeps a little further from the yards than the rule (bases need room to grow). */
const YARD_PREFERRED = 13;
/** And a little further from other sites. */
const GAP_PREFERRED = 8;
/** Three sides: a turned copy is rounded to tiles, then nudged at most this far to a legal spot. */
const NUDGE = 3;

/**
 * Where in side 0's share each site of a kind goes, as a band of distances from side 0's yard: a
 * share of the distance from that yard to the middle of the map. The first Oil Derrick is near
 * home, the second further out, Comms Relays toward the middle where seeing matters most.
 */
const BANDS: Record<SiteKind, [number, number][]> = {
  derrick: [
    [0.4, 0.65],
    [0.65, 0.9],
    [0.5, 0.8],
  ],
  hospital: [[0.45, 0.75]],
  relay: [
    [0.75, 1.05],
    [0.5, 0.8],
  ],
};

const ROT_C = -0.5;
const ROT_S = 0.8660254037844386;

const yardCentre = (st: { x: number; y: number }) => ({ x: st.x + 1.5, y: st.y + 1.5 });
const spotCentre = (p: { kind: SiteKind; x: number; y: number }) => ({ x: p.x + SITES[p.kind].w / 2, y: p.y + SITES[p.kind].h / 2 });

/** A stable number from a map's ground and ore, for a placement made with no seed given. */
function mapHash(m: SiteMap): number {
  let h = 2166136261;
  for (let i = 0; i < m.tiles.length; i++) {
    h ^= m.tiles.charCodeAt(i) + (m.ore[i] | 0) * 31;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Whether a site's footprint may go with its top-left at (x, y): clear walkable ground all round, no ore near, away from every yard. */
function spotLegal(m: SiteMap, x: number, y: number, yardGap: number): boolean {
  const W = m.w;
  const H = m.h;
  // Footprint 2 by 2 and a ring of walkable ground round it, all on the map.
  if (x < 1 || y < 1 || x + 3 > W || y + 3 > H) return false;
  for (let ty = y - 1; ty <= y + 2; ty++)
    for (let tx = x - 1; tx <= x + 2; tx++) if (!isWalkable(m.tiles[ty * W + tx])) return false;
  // No ore under it or within two tiles: haulers keep their fields and a site never sits in one.
  for (let ty = Math.max(0, y - 2); ty <= Math.min(H - 1, y + 3); ty++)
    for (let tx = Math.max(0, x - 2); tx <= Math.min(W - 1, x + 3); tx++) if (m.ore[ty * W + tx] > 0) return false;
  const c = { x: x + 1, y: y + 1 };
  for (const st of m.starts) if (dist(c.x, c.y, yardCentre(st).x, yardCentre(st).y) < yardGap) return false;
  return true;
}

/**
 * The top-left of each side's copy of a spot in side 0's share, turn by turn round the map: two
 * sides the point mirror, four the exact quarter turn, three the third of a turn rounded to tiles
 * and nudged to the nearest legal spot. Null when a copy has nowhere legal to go.
 */
function copiesOf(m: SiteMap, x: number, y: number, yardGap: number): { x: number; y: number }[] | null {
  const n = m.starts.length;
  if (n === 2) return [{ x, y }, { x: m.w - 2 - x, y: m.h - 2 - y }];
  if (n === 4) {
    const out = [{ x, y }];
    let p = { x, y };
    for (let k = 1; k < 4; k++) {
      p = { x: m.w - 2 - p.y, y: p.x };
      out.push(p);
    }
    return out;
  }
  const C = m.w / 2;
  const out = [{ x, y }];
  let v = { dx: x + 1 - C, dy: y + 1 - C };
  for (let k = 1; k < 3; k++) {
    v = { dx: ROT_C * v.dx - ROT_S * v.dy, dy: ROT_S * v.dx + ROT_C * v.dy };
    const rx = Math.round(C + v.dx - 1);
    const ry = Math.round(C + v.dy - 1);
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let dy = -NUDGE; dy <= NUDGE; dy++)
      for (let dx = -NUDGE; dx <= NUDGE; dx++) {
        const d = dx * dx + dy * dy;
        if (d >= bestD || d > NUDGE * NUDGE) continue;
        if (!spotLegal(m, rx + dx, ry + dy, yardGap)) continue;
        best = { x: rx + dx, y: ry + dy };
        bestD = d;
      }
    if (!best) return null;
    out.push(best);
  }
  return out;
}

/** Whether a site's centre lies in side 0's share: the bottom half (two sides) or side 0's wedge. */
function inShare0(m: SiteMap, cx: number, cy: number): boolean {
  const n = m.starts.length;
  const dx = cx - m.w / 2;
  const dy = cy - m.h / 2;
  if (n === 2) return dy >= 3;
  if (n === 4) return dx <= -2 && dy >= 2;
  return dy > 2 && dx * dx <= 3 * dy * dy;
}

/** Every tile reachable on foot from side 0's yard, with the yards and these footprints closed. */
function reachable(m: SiteMap, spots: SiteSpot[]): Uint8Array {
  const W = m.w;
  const H = m.h;
  const closed = new Uint8Array(W * H);
  const close = (x: number, y: number, w: number, h: number) => {
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) if (tx >= 0 && ty >= 0 && tx < W && ty < H) closed[ty * W + tx] = 1;
  };
  for (const st of m.starts) close(st.x, st.y, 3, 3);
  for (const p of spots) close(p.x, p.y, SITES[p.kind].w, SITES[p.kind].h);
  const seen = new Uint8Array(W * H);
  const st = m.starts[0];
  const queue: number[] = [];
  for (let ty = st.y - 1; ty <= st.y + 3; ty++)
    for (let tx = st.x - 1; tx <= st.x + 3; tx++) {
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      const k = ty * W + tx;
      if (closed[k] || seen[k] || !isWalkable(m.tiles[k])) continue;
      seen[k] = 1;
      queue.push(k);
    }
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head];
    const x = k % W;
    const y = (k / W) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const nk = ny * W + nx;
      if (seen[nk] || closed[nk] || !isWalkable(m.tiles[nk])) continue;
      seen[nk] = 1;
      queue.push(nk);
    }
  }
  return seen;
}

/** True when the sites close off no walkable ground and every site has open ground beside it. */
function connected(m: SiteMap, spots: SiteSpot[]): boolean {
  const W = m.w;
  const seen = reachable(m, spots);
  const closed = new Uint8Array(m.w * m.h);
  for (const st of m.starts) for (let ty = st.y; ty < st.y + 3; ty++) for (let tx = st.x; tx < st.x + 3; tx++) closed[ty * W + tx] = 1;
  for (const p of spots) for (let ty = p.y; ty < p.y + 2; ty++) for (let tx = p.x; tx < p.x + 2; tx++) closed[ty * W + tx] = 1;
  for (let k = 0; k < m.tiles.length; k++) if (!closed[k] && isWalkable(m.tiles[k]) && !seen[k]) return false;
  return true;
}

/**
 * Where the neutral sites go on this map: SITES_PER_SIDE for the setup's size, in every side's
 * share. Pure, and the same for the same map, setup and seed, so the lobby's preview and the
 * battle agree when both pass the battle's seed (`rngSeed`, which is seedFromString of the seed
 * text). With no seed it draws from the map itself. Its own random stream: placing sites never
 * moves the battle's stream.
 */
export function siteSpots(map: SiteMap, setup: Pick<SkirmishSetup, 'size'>, seed?: number): SiteSpot[] {
  const size: MapSize = setup.size ?? 'standard';
  const n = map.starts.length;
  if (n < 2 || n > 4) return [];
  const wanted: { kind: SiteKind; band: [number, number] }[] = [];
  for (const kind of SITE_KINDS) for (let i = 0; i < SITES_PER_SIDE[size][kind]; i++) wanted.push({ kind, band: BANDS[kind][i % BANDS[kind].length] });
  // Roomy first; on a crowded map, again with only the rules' own gaps.
  const roomy = placeAll(map, wanted, seed, YARD_PREFERRED, GAP_PREFERRED);
  if (roomy.length === wanted.length * n) return roomy;
  const tight = placeAll(map, wanted, seed, SITE_YARD_GAP, SITE_GAP);
  return tight.length > roomy.length ? tight : roomy;
}

function placeAll(map: SiteMap, wanted: { kind: SiteKind; band: [number, number] }[], seed: number | undefined, yardGap: number, gap: number): SiteSpot[] {
  let rs = ((seed ?? mapHash(map)) ^ SITE_SALT) >>> 0;
  const roll = () => {
    const r = next(rs);
    rs = r.seed;
    return r.value;
  };
  const home = yardCentre(map.starts[0]);
  const reach = dist(home.x, home.y, map.w / 2, map.h / 2);

  // Every legal spot in side 0's share whose copies are legal too, with its distance from home.
  const pool: { x: number; y: number; d: number; copies: { x: number; y: number }[] }[] = [];
  for (let y = 1; y < map.h - 2; y++)
    for (let x = 1; x < map.w - 2; x++) {
      if (!inShare0(map, x + 1, y + 1) || !spotLegal(map, x, y, yardGap)) continue;
      const copies = copiesOf(map, x, y, yardGap);
      if (!copies) continue;
      // The copies apart from one another (a spot by the edge of the share would crowd its own turn).
      let apart = true;
      for (let a = 0; a < copies.length && apart; a++)
        for (let b = a + 1; b < copies.length; b++) if (dist(copies[a].x, copies[a].y, copies[b].x, copies[b].y) < gap) apart = false;
      if (!apart) continue;
      pool.push({ x, y, d: dist(x + 1, y + 1, home.x, home.y), copies });
    }

  const placed: SiteSpot[] = [];
  for (const w of wanted) {
    const clear = (c: { x: number; y: number }) => placed.every(p => dist(c.x, c.y, p.x, p.y) >= gap);
    const fits = pool.filter(p => p.copies.every(clear));
    const lo = Math.max(yardGap, w.band[0] * reach);
    const hi = Math.max(lo + 4, w.band[1] * reach);
    let options = fits.filter(p => p.d >= lo && p.d <= hi);
    if (!options.length) options = fits;
    // Draw until one keeps the map connected (a few tries; a spot that seals a pocket is dropped).
    for (let tries = 0; tries < 12 && options.length; tries++) {
      const i = Math.min(options.length - 1, Math.floor(roll() * options.length));
      const pick = options[i];
      const set = pick.copies.map(c => ({ kind: w.kind, x: c.x, y: c.y }));
      if (connected(map, placed.concat(set))) {
        placed.push(...set);
        break;
      }
      options = options.slice(0, i).concat(options.slice(i + 1));
    }
  }
  return placed;
}

/**
 * Fills s.sites for a new skirmish set up with neutral sites (never a mission). Ids come from
 * s.nextId, as units' and structures' do. Called by createInitialState before the yards go down.
 */
export function placeSites(s: GameState): void {
  const setup = s.setup;
  if (!setup || !setup.sites || s.mission || !s.starts) return;
  const spots = siteSpots({ w: s.mapW, h: s.mapH, tiles: s.tiles, ore: s.ore, starts: s.starts }, setup, s.rngSeed);
  s.sites = spots.map(p => ({ id: s.nextId++, kind: p.kind, x: p.x, y: p.y, owner: null, capture: null }));
}

/** The point of a site's footprint nearest (px, py), as a distance. */
export function siteDist(px: number, py: number, site: { kind: SiteKind; x: number; y: number }): number {
  const spec = SITES[site.kind];
  const cx = Math.max(site.x, Math.min(px, site.x + spec.w));
  const cy = Math.max(site.y, Math.min(py, site.y + spec.h));
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}

export const siteCentre = spotCentre;

/** The site covering tile (x, y), or null. For the selection panel and the renderer. */
export function siteAt(s: GameState, x: number, y: number): Site | null {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  for (const site of s.sites ?? []) {
    const spec = SITES[site.kind];
    if (tx >= site.x && tx < site.x + spec.w && ty >= site.y && ty < site.y + spec.h) return site;
  }
  return null;
}

/** Writes every site's id onto its tiles in an occupancy grid (grid.ts), so units walk round it and nothing is built there. */
export function occupySites(s: GameState, occ: Int32Array): void {
  if (!s.sites) return;
  for (const site of s.sites) {
    const spec = SITES[site.kind];
    for (let y = site.y; y < site.y + spec.h; y++) for (let x = site.x; x < site.x + spec.w; x++) occ[y * s.mapW + x] = site.id;
  }
}

/** Comms Relays this side holds: their centres and radius, for visibility (state.ts). */
export function relaysOf(s: GameState, owner: Owner): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const site of s.sites ?? []) if (site.kind === 'relay' && site.owner === owner) out.push(spotCentre(site));
  return out;
}

/**
 * What is wrong with a battle's sites, or null if they keep every rule: known kinds on the map, on
 * clear walkable ground with no ore, at least SITE_YARD_GAP from every yard and SITE_GAP from one
 * another, the right number of each for the size and sides, the map's symmetry (each site's turned
 * copy is a site of the same kind: exact for two and four sides, within the nudge for three), and
 * every walkable tile still reachable from every yard.
 */
export function sitesProblem(s: GameState): string | null {
  const sites = s.sites ?? [];
  const setup = s.setup;
  if (!setup || !setup.sites) return sites.length ? 'sites in a battle set up without them' : null;
  if (s.mission) return 'sites in a mission';
  const starts = s.starts;
  if (!starts) return 'no starts';
  const n = starts.length;
  const m: SiteMap = { w: s.mapW, h: s.mapH, tiles: s.tiles, ore: s.ore, starts };
  for (const site of sites) {
    if (!SITES[site.kind]) return `unknown kind ${site.kind}`;
    if (!spotLegal(m, site.x, site.y, SITE_YARD_GAP)) return `${site.kind} at ${site.x},${site.y} not on clear ground away from the yards`;
  }
  for (let a = 0; a < sites.length; a++)
    for (let b = a + 1; b < sites.length; b++) if (dist(sites[a].x, sites[a].y, sites[b].x, sites[b].y) < SITE_GAP) return 'two sites too close';
  for (const kind of SITE_KINDS) {
    const want = SITES_PER_SIDE[setup.size ?? 'standard'][kind] * n;
    const got = sites.filter(x => x.kind === kind).length;
    if (got !== want) return `${got} ${kind}s, not ${want}`;
  }
  // Symmetry: every site's next turn round the map holds a site of the same kind.
  const C = s.mapW / 2;
  for (const site of sites) {
    let tx: number;
    let ty: number;
    if (n === 2) {
      tx = s.mapW - 2 - site.x;
      ty = s.mapH - 2 - site.y;
    } else if (n === 4) {
      tx = s.mapW - 2 - site.y;
      ty = site.x;
    } else {
      const v = { dx: site.x + 1 - C, dy: site.y + 1 - C };
      tx = Math.round(C + ROT_C * v.dx - ROT_S * v.dy - 1);
      ty = Math.round(C + ROT_S * v.dx + ROT_C * v.dy - 1);
    }
    const slack = n === 3 ? 2 * NUDGE + 1 : 0;
    if (!sites.some(o => o.kind === site.kind && Math.abs(o.x - tx) <= slack && Math.abs(o.y - ty) <= slack)) return `${site.kind} at ${site.x},${site.y} has no turned copy`;
  }
  if (!connected(m, sites)) return 'a site closes off ground';
  return null;
}

/** A battle's sites, repaired for a save: known kinds on the map, sound owners and progress, ids unique. Null: none worth keeping. */
export function migrateSites(raw: unknown, s: GameState): Site[] | null {
  if (!Array.isArray(raw) || s.mission) return null;
  const taken = new Set<number>();
  for (const u of s.units) taken.add(u.id);
  for (const b of s.buildings) taken.add(b.id);
  const out: Site[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const v = r as Partial<Site>;
    if (typeof v.kind !== 'string' || !SITE_KINDS.includes(v.kind as SiteKind)) continue;
    const spec = SITES[v.kind as SiteKind];
    if (!Number.isInteger(v.id) || v.id! <= 0 || taken.has(v.id!) || (Number.isInteger(s.nextId) && v.id! >= s.nextId)) continue;
    if (!Number.isInteger(v.x) || !Number.isInteger(v.y) || v.x! < 0 || v.y! < 0 || v.x! + spec.w > s.mapW || v.y! + spec.h > s.mapH) continue;
    const owner = v.owner === null || v.owner === undefined ? null : isSide(s, v.owner) ? v.owner : null;
    let capture: Site['capture'] = null;
    const c = v.capture as Partial<NonNullable<Site['capture']>> | null | undefined;
    if (c && typeof c === 'object' && isSide(s, c.by) && Number.isFinite(c.progress) && c.progress! > 0) {
      capture = { by: c.by as Owner, progress: Math.min(1, Math.round(c.progress! * SITE_CAPTURE_TICKS) / SITE_CAPTURE_TICKS) };
    }
    taken.add(v.id!);
    out.push({ id: v.id!, kind: v.kind as SiteKind, x: v.x!, y: v.y!, owner, capture });
  }
  return out.length ? out : null;
}

// ---------------------------------------------------------------------------------------------
// Each tick

/** Capture, derrick income, hospital healing, and the Stealth Tank's bookkeeping. A no-op with no sites and no Stealth Tank. */
export function sitesStep(s: GameState): void {
  if (s.sites && s.sites.length) {
    captureStep(s);
    effectsStep(s);
  }
  stealthStep(s);
}

const SITE_NAME = (k: SiteKind) => SITES[k].name;
/** "an Oil Derrick", "a Field Hospital". */
const A_SITE = (k: SiteKind) => `${/^[AEIOU]/.test(SITES[k].name) ? 'an' : 'a'} ${SITES[k].name}`;

function captureStep(s: GameState): void {
  const T = SITE_CAPTURE_TICKS;
  // Infantry by tile, once: the sites are few and the infantry many.
  const infantry = s.units.filter(u => u.hp > 0 && UNITS[u.kind].category === 'infantry');
  // A side out of the battle (no structure left) loses its sites to no one: they go neutral.
  const standing = new Set<Owner>();
  for (const b of s.buildings) if (b.hp > 0 && isStructure(b)) standing.add(b.owner);
  s.sites = s.sites!.map(site => {
    let owner = site.owner;
    let cap = site.capture;
    if (owner !== null && !standing.has(owner)) owner = null;
    const holder = owner === null ? -1 : teamOf(s, owner);
    // Teams beside the site, each with the side of its first unit there (units are in id order).
    const present = new Map<number, Owner>();
    for (const u of infantry) {
      if (siteDist(u.x, u.y, site) > SITE_CAPTURE_RANGE) continue;
      const team = teamOf(s, u.owner);
      if (!present.has(team)) present.set(team, u.owner);
    }
    const defended = present.has(holder);
    const capturers = [...present.entries()].filter(([team]) => team !== holder);
    const steps = cap ? Math.round(cap.progress * T) : 0;
    const wind = () => (steps > 1 ? { by: cap!.by, progress: (steps - 1) / T } : null);
    if (capturers.length === 1 && !defended) {
      const [team, side] = capturers[0];
      if (cap && teamOf(s, cap.by) !== team) cap = wind();
      else if (steps + 1 >= T) {
        const by = cap ? cap.by : side;
        const before = owner;
        owner = by;
        cap = null;
        const c = spotCentre(site);
        s.effects.push({ id: s.nextId++, kind: 'captured', x: c.x, y: c.y, at: s.tick, size: 0 });
        if (isAlly(s, by, 0)) log(s, by === 0 ? `${SITE_NAME(site.kind)} taken.` : `Our ally has taken ${A_SITE(site.kind)}.`, 'good');
        else if (before !== null && isAlly(s, before, 0)) log(s, `We have lost ${A_SITE(site.kind)}.`, 'bad');
      } else cap = { by: cap ? cap.by : side, progress: (steps + 1) / T };
    } else if (capturers.length === 0) {
      if (cap) cap = wind();
    }
    // Two teams or more at it (or the holder standing guard against one): paused.
    if (owner === site.owner && cap === site.capture) return site;
    return { ...site, owner, capture: cap };
  });
}

function effectsStep(s: GameState): void {
  const pay = s.tick % DERRICK_TICKS === 0;
  const heal = s.tick % HOSPITAL_TICKS === 0;
  if (!pay && !heal) return;
  for (const site of s.sites!) {
    if (site.owner === null) continue;
    if (pay && site.kind === 'derrick') s.players[site.owner].credits += DERRICK_INCOME;
    if (heal && site.kind === 'hospital') {
      for (const u of s.units) {
        if (u.owner !== site.owner || u.hp <= 0 || UNITS[u.kind].category !== 'infantry') continue;
        const max = maxHpOf(u);
        if (u.hp >= max || siteDist(u.x, u.y, site) > HOSPITAL_RANGE) continue;
        u.hp = Math.min(max, u.hp + HOSPITAL_HEAL);
        s.effects.push({ id: s.nextId++, kind: 'heal', x: u.x, y: u.y, at: s.tick, size: 0 });
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Stealth

/**
 * Whether side `by` can see (and so target) unit u. Anything but a Stealth Tank: always. A Stealth
 * Tank: by its own side and allies always; by an enemy only with one of that enemy's (or its
 * allies') units or structures within STEALTH_DETECT_RANGE, within STEALTH_REVEAL_TICKS of its
 * last shot, or inside a recon sweep of side 0's team. The Spy has its own rule (isDetected).
 */
export function stealthSeen(s: GameState, u: Unit, by: Owner): boolean {
  if (!UNITS[u.kind].stealth || isAlly(s, u.owner, by)) return true;
  if (u.lastShot !== undefined && s.tick - u.lastShot <= STEALTH_REVEAL_TICKS) return true;
  for (const e of s.units) {
    if (e.hp <= 0 || !isAlly(s, e.owner, by)) continue;
    // A detector (the Recon Plane) sees it from much further off.
    const r = UNITS[e.kind].detector ? DETECTOR_RANGE : STEALTH_DETECT_RANGE;
    if (Math.abs(e.x - u.x) <= r && Math.abs(e.y - u.y) <= r && dist(e.x, e.y, u.x, u.y) <= r) return true;
  }
  const r = STEALTH_DETECT_RANGE;
  for (const b of s.buildings) {
    if (b.hp <= 0 || !isStructure(b) || !isAlly(s, b.owner, by)) continue;
    const c = buildingCentre(b);
    if (Math.abs(c.x - u.x) > r + 2 || Math.abs(c.y - u.y) > r + 2) continue;
    if (distToBuilding(u.x, u.y, b) <= r) return true;
  }
  if (isAlly(s, by, 0) && s.recon) for (const a of s.recon) if (s.tick < a[3] && dist(a[0], a[1], u.x, u.y) <= a[2]) return true;
  return false;
}

/**
 * Whether side `by` can see unit u, for the targeting checks in tick.ts, commands.ts and the
 * renderer: the Spy by its own rule (isDetected, unchanged), a Stealth Tank by stealthSeen,
 * anything else always.
 */
export function seenBy(s: GameState, u: Unit, by: Owner): boolean {
  if (u.kind === 'spy') return isDetected(s, u, by);
  return stealthSeen(s, u, by);
}

/**
 * A Stealth Tank's last shot (it fired if a projectile of its left this tick), and every enemy
 * that has lost sight of one drops it: no engagement, no attack order on it.
 */
function stealthStep(s: GameState): void {
  let any = false;
  for (const u of s.units) if (u.hp > 0 && UNITS[u.kind].stealth) any = true;
  if (!any) return;
  for (const p of s.projectiles) {
    if (p.firedAt !== s.tick || !p.shooter) continue;
    const u = s.units.find(v => v.id === p.shooter);
    if (u && UNITS[u.kind].stealth) u.lastShot = s.tick;
  }
  for (const u of s.units) {
    if (u.hp <= 0 || !UNITS[u.kind].stealth) continue;
    for (const by of sidesOf(s)) {
      if (!isEnemy(s, u.owner, by) || stealthSeen(s, u, by)) continue;
      for (const v of s.units) {
        if (v.owner !== by) continue;
        if (v.engage === u.id) v.engage = 0;
        if (v.order.type === 'attack' && v.order.target === u.id) {
          const q = v.queue.length ? v.queue[0] : null;
          v.queue = v.queue.slice(1);
          v.order = q ? { ...q } : { type: 'idle' };
          v.engage = q && q.type === 'attack' ? q.target : 0;
          v.path = [];
          v.pathGoal = -1;
        }
      }
      for (const b of s.buildings) if (b.owner === by && b.engage === u.id) b.engage = 0;
    }
  }
}
