/**
 * Round 6, workstream D (fireline-round6-design.md): formations and squads.
 *
 * - `slotsFor(shape, n, facing)`: integer offset tables for the line, column, wedge and box, turned
 *   to one of eight facings without trigonometry, so a replay places every unit exactly.
 * - `facingOf(dx, dy)`: a direction snapped to eight, by integer comparisons against tan 22.5°.
 * - Slot order by role, then id: armour in front, infantry behind, artillery and support at the rear,
 *   Medics and Repair Trucks in the middle (inside, in a box).
 * - Squads: the leader paths; every SQUAD_REFRESH_TICKS it aims the others at their slots beside it,
 *   and every member keeps to the slowest member's pace (`squadPace`, called from stepAlong).
 *
 * Pure: no clock, no randomness. Imports rules, specs and grid only, so tick.ts and commands.ts can
 * both use it without a cycle.
 */
import { nearestPassable } from './grid';
import {
  FORMATION_SHAPES,
  GENERAL_SQUAD_HOLD,
  GENERAL_SQUAD_REFRESH_TICKS,
  GENERAL_SQUAD_SLACK,
  hitsGround,
  LINE_RANK_MAX,
  SLOT_SPACING,
  SLOT_SPACING_DIAGONAL,
  SQUAD_FINAL,
  SQUAD_LEAD,
  SQUAD_REFRESH_TICKS,
  SQUAD_SLACK,
  UNITS,
  type FormationShape,
} from './rules';
import { unitSpecOf } from './specs';
import type { GameState, Squad, Unit } from './types';

export const isFormationShape = (v: unknown): v is FormationShape => FORMATION_SHAPES.includes(v as FormationShape);

/** Forward, one step, for each facing: 0 north (up the screen), then clockwise. */
const FWD: readonly [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/**
 * The facing of a direction, snapped to eight. Integer maths only: the direction is rounded to
 * eighths of a tile, and a component counts as nothing when it is at most 0.414 (tan 22.5°) of the
 * other, so the boundary between "east" and "south-east" is the same on every machine. `fallback`
 * when the direction is (nearly) nothing.
 */
export function facingOf(dx: number, dy: number, fallback = 0): number {
  const ix = Math.round(dx * 8);
  const iy = Math.round(dy * 8);
  const ax = Math.abs(ix);
  const ay = Math.abs(iy);
  if (ax === 0 && ay === 0) return fallback;
  if (ay * 1000 <= ax * 414) return ix > 0 ? 2 : 6;
  if (ax * 1000 <= ay * 414) return iy > 0 ? 4 : 0;
  if (ix > 0) return iy > 0 ? 3 : 1;
  return iy > 0 ? 5 : 7;
}

/** Offsets across a rank, centre first: 0, 1, -1, 2, -2, ... `w` of them. */
function across(w: number): number[] {
  const out: number[] = [];
  for (let i = 0; out.length < w; i++) {
    if (i === 0) out.push(0);
    else {
      out.push(i);
      if (out.length < w) out.push(-i);
    }
  }
  return out;
}

/**
 * The shape facing north, as [across, forward] pairs (forward negative: behind), front first. In the
 * box the edge comes first and the inside last, so the inside is what the role order fills last.
 */
function canonical(shape: FormationShape, n: number): [number, number][] {
  const out: [number, number][] = [];
  if (shape === 'line') {
    const ranks = Math.ceil(n / LINE_RANK_MAX);
    const per = Math.ceil(n / ranks);
    for (let k = 0; out.length < n; k++) for (const r of across(Math.min(per, n - out.length))) out.push([r, -k]);
  } else if (shape === 'column') {
    const files = n <= 4 ? [0] : [0, 1];
    for (let k = 0; out.length < n; k++) for (const r of files) if (out.length < n) out.push([r, -k]);
  } else if (shape === 'wedge') {
    // Row k is k + 1 slots two tiles apart, so the arms run back at 45 degrees from the tip.
    for (let k = 0; out.length < n; k++) {
      const row: number[] = [];
      for (let r = -k; r <= k; r += 2) row.push(r);
      row.sort((a, b) => Math.abs(a) - Math.abs(b) || b - a);
      for (const r of row) if (out.length < n) out.push([r, -k]);
    }
  } else {
    let w = 1;
    while (w * w < n) w++;
    const rows = Math.ceil(n / w);
    const cols = across(w);
    const edge: [number, number][] = [];
    const inside: [number, number][] = [];
    const lo = Math.min(...cols);
    const hi = Math.max(...cols);
    for (let k = 0; k < rows; k++)
      for (const r of cols) (k === 0 || k === rows - 1 || r === lo || r === hi ? edge : inside).push([r, -k]);
    // Short of a full rectangle, the back row gives up its outer slots rather than the inside.
    out.push(...edge.slice(0, Math.max(0, n - inside.length)), ...inside);
    out.length = n;
  }
  // Centred on the group's middle (rounded to whole tiles, so the table stays in integers).
  let sr = 0;
  let sf = 0;
  for (const [r, f] of out) {
    sr += r;
    sf += f;
  }
  const mr = Math.round(sr / n);
  const mf = Math.round(sf / n);
  return out.map(([r, f]) => [r - mr, f - mf]);
}

/**
 * Integer slot offsets for `n` units in `shape`, facing `facing` (0 to 7, as facingOf). Slot 0 is the
 * front (the leader's); later slots run toward the rear. Facing a diagonal, a step is one tile across
 * and one down, so callers scale diagonal tables by SLOT_SPACING_DIAGONAL (slotScale).
 */
export function slotsFor(shape: FormationShape, n: number, facing: number): [number, number][] {
  if (n <= 0) return [];
  const f = ((facing % 8) + 8) % 8;
  const [fx, fy] = FWD[f];
  const [rx, ry] = FWD[(f + 2) % 8];
  // `+ 0` turns a negative zero into zero, so tables compare equal however they were made.
  return canonical(shape, n).map(([r, fw]) => [r * rx + fw * fx + 0, r * ry + fw * fy + 0]);
}

/** Tiles per step of a slot table at this facing. */
export const slotScale = (facing: number): number => (facing % 2 ? SLOT_SPACING_DIAGONAL : SLOT_SPACING);

/**
 * A unit's place in the order: 0 armour (armed vehicles), 1 infantry, 2 Medics and Repair Trucks,
 * 3 artillery and support (a minimum range, no ground weapon, or no weapon at all; aircraft). Read
 * from the category and the spec, never the kind's name, so a new kind finds its own place.
 */
export function roleOf(s: GameState, u: Unit): number {
  const cat = UNITS[u.kind].category;
  if (cat === 'air') return 3;
  const spec = unitSpecOf(s, u);
  if (spec.medic || spec.mender) return 2;
  const w = spec.weapon;
  if (!w || w.minRange || !hitsGround(w)) return 3;
  return cat === 'vehicle' ? 0 : 1;
}

/** The order slots are handed out in: by role (Medics last in a box, so they take its inside), then id. */
export function slotOrder(s: GameState, units: Unit[], shape: FormationShape): Unit[] {
  const rank = (u: Unit) => {
    const r = roleOf(s, u);
    return shape === 'box' ? [0, 1, 3, 2][r] : [0, 1, 2, 3][r];
  };
  return units
    .map(u => ({ u, r: rank(u) }))
    .sort((a, b) => a.r - b.r || a.u.id - b.u.id)
    .map(x => x.u);
}

// ---------------------------------------------------------------------------------------------
// Squads

/** The squad with this id, or undefined. */
export const squadById = (s: GameState, id: number | undefined): Squad | undefined =>
  id === undefined ? undefined : s.squads?.find(q => q.id === id);

function clearMember(u: Unit): void {
  delete u.squad;
  delete u.slotX;
  delete u.slotY;
}

function removeSquad(s: GameState, q: Squad): void {
  if (!s.squads) return;
  s.squads = s.squads.filter(x => x !== q);
  if (!s.squads.length) delete s.squads;
}

/**
 * Takes these units out of their squads. A squad left with one member or none is dissolved; one
 * whose leader left gets the first of the rest.
 */
export function leaveSquads(s: GameState, units: Unit[]): void {
  if (!s.squads) return;
  for (const u of units) {
    const q = squadById(s, u.squad);
    clearMember(u);
    if (!q) continue;
    q.members = q.members.filter(id => id !== u.id);
    if (q.leader === u.id && q.members.length) q.leader = q.members[0];
    if (q.members.length < 2) {
      for (const id of q.members) {
        const v = s.units.find(x => x.id === id);
        if (v && v.squad === q.id) clearMember(v);
      }
      removeSquad(s, q);
    }
  }
}

/** Drops squads with fewer than two living members still in them (fallen, or ordered elsewhere). */
export function pruneSquads(s: GameState): void {
  if (!s.squads) return;
  const byId = new Map(s.units.map(u => [u.id, u]));
  for (const q of s.squads.slice()) {
    const live = q.members.filter(id => {
      const v = byId.get(id);
      return !!v && v.hp > 0 && v.squad === q.id;
    });
    if (live.length >= 2) {
      if (live.length !== q.members.length) q.members = live;
      if (!live.includes(q.leader)) q.leader = live[0];
      continue;
    }
    for (const id of live) clearMember(byId.get(id)!);
    removeSquad(s, q);
  }
}

/** A unit's speed for keeping pace: its spec's, times its side's Engine tuning for vehicles. */
const paceOf = (s: GameState, u: Unit, tuned: number): number =>
  unitSpecOf(s, u).speed * (tuned !== 1 && UNITS[u.kind].category === 'vehicle' ? tuned : 1);

/** The slowest member's pace, over these units. */
export function slowest(s: GameState, units: Unit[], tuned = 1): number {
  let p = Infinity;
  for (const u of units) p = Math.min(p, paceOf(s, u, tuned));
  return p;
}

const marching = (u: Unit): boolean => u.order.type === 'move' || u.order.type === 'attackMove' || u.order.type === 'idle';

/**
 * The leader's work, every SQUAD_REFRESH_TICKS while it walks: members that fell or took other
 * orders leave; the pace is re-measured; and each member is aimed at its slot beside the leader, a
 * little ahead so it keeps walking, or at its own final slot once the leader is nearly there.
 */
function refreshSquad(s: GameState, units: Map<number, Unit>, occ: Int32Array, q: Squad, tuned: number): void {
  const kept: Unit[] = [];
  for (const id of q.members) {
    const v = units.get(id);
    if (!v || v.hp <= 0 || v.squad !== q.id) continue;
    if (!marching(v)) {
      clearMember(v);
      continue;
    }
    kept.push(v);
  }
  if (kept.length < 2) {
    for (const v of kept) clearMember(v);
    removeSquad(s, q);
    return;
  }
  if (kept.length !== q.members.length) q.members = kept.map(v => v.id);
  const leader = kept.find(v => v.id === q.leader) ?? kept[0];
  q.leader = leader.id;
  q.pace = slowest(s, kept, tuned);
  const o = leader.order;
  if (o.type !== 'move' && o.type !== 'attackMove') return;
  const gx = o.x;
  const gy = o.y;
  const ddx = gx - leader.x;
  const ddy = gy - leader.y;
  const d = Math.sqrt(ddx * ddx + ddy * ddy);
  const near = d <= SQUAD_FINAL || q.x === undefined || q.y === undefined;
  const lx = d > 0.0001 ? (ddx / d) * SQUAD_LEAD : 0;
  const ly = d > 0.0001 ? (ddy / d) * SQUAD_LEAD : 0;
  const bx = leader.x - (leader.slotX ?? 0);
  const by = leader.y - (leader.slotY ?? 0);
  const W = s.mapW;
  for (const m of kept) {
    if (m === leader || m.engage || m.slotX === undefined || m.slotY === undefined) continue;
    const tx = near ? q.x! + m.slotX : bx + m.slotX + lx;
    const ty = near ? q.y! + m.slotY : by + m.slotY + ly;
    const k = nearestPassable(s, occ, tx, ty, 4);
    if (k < 0) continue;
    const inTile = Math.floor(tx) + Math.floor(ty) * W === k;
    const px = inTile ? tx : (k % W) + 0.5;
    const py = inTile ? ty : ((k / W) | 0) + 0.5;
    const attack = !!q.attack && !!unitSpecOf(s, m).weapon;
    if (m.order.type === 'idle') {
      m.path = [];
      m.pathGoal = -1;
    }
    m.order = attack ? { type: 'attackMove', x: px, y: py } : { type: 'move', x: px, y: py };
  }
}

/**
 * Keep pace (stepAlong's one lookup): the speed a squad member may walk at this step. Every member is
 * capped at the slowest's pace, except one that has fallen more than SQUAD_SLACK behind its slot
 * beside the leader, which may catch up at its own speed. The leader's step also runs the squad's
 * refresh on its tick.
 */
export function squadPace(s: GameState, units: Map<number, Unit>, occ: Int32Array, u: Unit, sp: number, tuned: number): number {
  const q = squadById(s, u.squad);
  if (!q) {
    clearMember(u);
    return sp;
  }
  let leader = units.get(q.leader);
  if (!leader || leader.hp <= 0 || leader.squad !== q.id) {
    // A fallen leader: the first member still standing paths from now on.
    leader = undefined;
    for (const id of q.members) {
      const v = units.get(id);
      if (v && v.hp > 0 && v.squad === q.id) {
        leader = v;
        break;
      }
    }
    if (!leader) return sp;
    q.leader = leader.id;
  }
  // Integration (section 7): a squad led by a field General keeps tighter. It re-aims twice as
  // often; a member out of its slot catches up sooner, but one ahead of its slot waits for the
  // squad instead of running on; and the General holds to half pace while any member has fallen
  // well behind, so nobody straggles.
  const led = isGeneralUnit(leader);
  if (u === leader && (s.tick + q.id) % (led ? GENERAL_SQUAD_REFRESH_TICKS : SQUAD_REFRESH_TICKS) === 0) {
    refreshSquad(s, units, occ, q, tuned);
    if (u.squad === undefined) return sp;
  }
  const pace = q.pace ?? sp;
  if (u !== leader && u.slotX !== undefined && u.slotY !== undefined) {
    const ex = leader.x - (leader.slotX ?? 0) + u.slotX;
    const ey = leader.y - (leader.slotY ?? 0) + u.slotY;
    const dx = ex - u.x;
    const dy = ey - u.y;
    if (!led) {
      if (dx * dx + dy * dy > SQUAD_SLACK * SQUAD_SLACK) return sp;
    } else if (dx * dx + dy * dy > GENERAL_SQUAD_SLACK * GENERAL_SQUAD_SLACK) {
      const [hx, hy] = heading(leader);
      return dx * hx + dy * hy >= 0 ? sp : Math.min(sp, pace / 2);
    }
  }
  if (led && u === leader && straggler(units, q, leader)) return Math.min(sp, pace / 4);
  return Math.min(sp, pace);
}

/** A field General (C's unit): the one unit that leads a squad by rank rather than from the front slot. */
export const isGeneralUnit = (u: Unit): boolean => u.kind === 'general';

/** The unit's direction of march (toward its order's point), unnormalised; nothing when it has none. */
function heading(u: Unit): [number, number] {
  const o = u.order;
  return o.type === 'move' || o.type === 'attackMove' ? [o.x - u.x, o.y - u.y] : [0, 0];
}

/**
 * Whether any member of a General's squad is more than GENERAL_SQUAD_HOLD from its slot beside it
 * and not ahead of it (behind, or out to one side): the General waits for it.
 */
function straggler(units: Map<number, Unit>, q: Squad, leader: Unit): boolean {
  const [hx, hy] = heading(leader);
  const bx = leader.x - (leader.slotX ?? 0);
  const by = leader.y - (leader.slotY ?? 0);
  for (const id of q.members) {
    const m = units.get(id);
    if (!m || m === leader || m.hp <= 0 || m.squad !== q.id || m.engage || m.slotX === undefined || m.slotY === undefined) continue;
    const dx = bx + m.slotX - m.x;
    const dy = by + m.slotY - m.y;
    if (dx * dx + dy * dy > GENERAL_SQUAD_HOLD * GENERAL_SQUAD_HOLD && dx * hx + dy * hy >= 0) return true;
  }
  return false;
}

/** The member a new squad is led by: its field General when it has one, otherwise the front slot's. */
export const squadLeader = (ground: Unit[]): Unit => ground.find(isGeneralUnit) ?? ground[0];

/** The shape the selection moves in: its squad's, when the units are exactly one squad's members. */
export function wholeSquad(s: GameState, units: Unit[]): Squad | undefined {
  if (!s.squads || units.length < 2) return undefined;
  const q = squadById(s, units[0].squad);
  if (!q || q.members.length !== units.length) return undefined;
  for (const u of units) if (u.squad !== q.id || !q.members.includes(u.id)) return undefined;
  return q;
}
