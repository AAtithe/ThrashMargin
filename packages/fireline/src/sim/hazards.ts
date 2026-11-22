import type { stream } from './rng';

/**
 * Vast maps' hazards (2026-11-22): ravines and ruined cities, laid by both skirmish generators
 * (maps.ts) between the ground noise and the map type's own features, through the generator's
 * symmetric brush, so every side still starts with the same ground.
 *
 *  - A ravine ('v') is a winding gorge two to four tiles wide that nothing on the ground crosses
 *    except by a bridge ('b'). Ravines are laid after the generator's tracks (layRavines): where a
 *    ravine crosses a track the track becomes a bridge, a ravine that would run along a track is
 *    cut short there, and every ravine is bridged at intervals along its length, so a ravine
 *    lengthens and narrows the routes rather than closing them.
 *  - A ruined city is a grid of streets ('p', open, buildable) between blocks of rubble and
 *    gutted buildings ('x', impassable). Some blocks have collapsed into open squares with only
 *    heaps left; the edge of the city is ragged. The streets make chokepoints and the blocks hide
 *    nothing (there is no line of sight in Fireline) but bend every route through it.
 *  - A ruined hamlet is a single gutted building or two on a paved yard, out in the country.
 *
 * Ruins are laid before the type's features and the tracks (layRuins), so a track through a city
 * runs down a street (carveTile) and a river or a canyon wall still has its way.
 *
 * Nothing here reads a clock or Math.random: every choice is drawn from the generator's own
 * stream, so a map is the same for the same seed.
 */

type Rng = ReturnType<typeof stream>;

interface Pt {
  x: number;
  y: number;
}

export interface HazardBrush {
  rng: Rng;
  /** The tile at (x, y) as it stands; off the map reads as water, which nothing is laid over. */
  at(x: number, y: number): string;
  /** The generator's symmetric brush. */
  paint(x: number, y: number, c: string): void;
  /** Whether a point is in the part of the map the generator draws (side 0's half or wedge). */
  inRegion(p: Pt): boolean;
  /** Places nothing is laid within `r` tiles of: the bases' clearings, the contested centre. */
  keepOut: { p: Pt; r: number }[];
  /** A random point in the drawn region (the caller's own distribution). */
  pick(): Pt;
  /** Whether a track was carved through (x, y): ravines bridge it rather than cut it. */
  track?(x: number, y: number): boolean;
}

export interface HazardCounts {
  ravines: number;
  cities: number;
  hamlets: number;
  /** A city's radius in tiles: from `cityR`, up to cityR + cityRSpread. */
  cityR: number;
  cityRSpread: number;
}

/** Tiles between the bridges a ravine is given along its length. */
export const RAVINE_BRIDGE_GAP = 22;

const dist = (a: Pt, b: Pt) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

/** What a track leaves on a tile it passes over: grass stays grass, a ravine is bridged, ruins become street, anything else dirt. */
export function carveTile(c: string): string {
  if (c === 'g') return 'g';
  if (c === 'v' || c === 'b') return 'b';
  if (c === 'x' || c === 'p') return 'p';
  return 'd';
}

const clearOf = (h: HazardBrush) => (p: Pt, margin: number) => h.keepOut.every(k => dist(p, k.p) > k.r + margin);

/** Ruined cities and hamlets. Adds each to h.keepOut, so the ravines laid later stay clear of them. */
export function layRuins(h: HazardBrush, n: HazardCounts): void {
  const clear = clearOf(h);
  for (let i = 0, tries = 0; i < n.cities && tries < 60; tries++) {
    const r = n.cityR + h.rng.float() * n.cityRSpread;
    const c = h.pick();
    if (!h.inRegion(c) || !clear(c, r + 2) || !landShare(h, c, r, 0.7)) continue;
    city(h, c, r);
    h.keepOut.push({ p: c, r: r + 4 });
    i++;
  }
  for (let i = 0, tries = 0; i < n.hamlets && tries < 60; tries++) {
    const c = h.pick();
    if (!h.inRegion(c) || !clear(c, 5) || !landShare(h, c, 3, 0.9)) continue;
    hamlet(h, c);
    h.keepOut.push({ p: c, r: 5 });
    i++;
  }
}

/** Ravines, after the tracks (see the file's comment). */
export function layRavines(h: HazardBrush, n: HazardCounts): void {
  const clear = clearOf(h);
  for (let i = 0, tries = 0; i < n.ravines && tries < 100; tries++) {
    const a = h.pick();
    if (!h.inRegion(a) || !clear(a, 6)) continue;
    if (ravine(h, a, clear)) i++;
  }
}

/** Whether at least `share` of the disc round c is land (not water, rock or a hazard already laid). */
function landShare(h: HazardBrush, c: Pt, r: number, share: number): boolean {
  let land = 0;
  let all = 0;
  for (let y = Math.floor(c.y - r); y <= Math.ceil(c.y + r); y++)
    for (let x = Math.floor(c.x - r); x <= Math.ceil(c.x + r); x++) {
      if ((x + 0.5 - c.x) ** 2 + (y + 0.5 - c.y) ** 2 > r * r) continue;
      all++;
      const t = h.at(x, y);
      if (t === 'g' || t === 'd' || t === 't') land++;
    }
  return all > 0 && land >= all * share;
}

/**
 * One ravine from `a`: a heading that wanders, a width that swells and narrows, stopping short of
 * anything kept clear, of water and of the drawn region's edge. Bridged every RAVINE_BRIDGE_GAP
 * tiles. False (and nothing painted) if it would be too short to matter.
 */
function ravine(h: HazardBrush, a: Pt, clear: (p: Pt, margin: number) => boolean): boolean {
  const len = 40 + h.rng.float() * 50;
  let heading = h.rng.float() * Math.PI * 2;
  let turn = 0;
  const line: { p: Pt; heading: number; w: number }[] = [];
  let p = { ...a };
  const w0 = 1.1 + h.rng.float() * 0.6;
  /** Steps in a row whose disc touches a track: a ravine running along one stops. */
  let alongTrack = 0;
  const onTrack = (q: Pt, w: number) => {
    if (!h.track) return false;
    for (let y = Math.floor(q.y - w); y <= Math.ceil(q.y + w); y++)
      for (let x = Math.floor(q.x - w); x <= Math.ceil(q.x + w); x++) if (h.track(x, y)) return true;
    return false;
  };
  for (let s = 0; s < len; s++) {
    // The bend wanders gently and is pulled back towards straight, so a ravine winds rather than curls.
    turn = Math.max(-0.07, Math.min(0.07, turn * 0.9 + (h.rng.float() - 0.5) * 0.04));
    heading += turn;
    const w = w0 + Math.sin(s / 7 + w0 * 3) * 0.45;
    if (!h.inRegion(p) || !clear(p, w + 3) || h.at(Math.floor(p.x), Math.floor(p.y)) === 'w') break;
    alongTrack = onTrack(p, w + 1) ? alongTrack + 1 : 0;
    if (alongTrack > 5) {
      line.splice(line.length - 5);
      break;
    }
    line.push({ p: { ...p }, heading, w });
    p = { x: p.x + Math.cos(heading), y: p.y + Math.sin(heading) };
  }
  if (line.length < 20) return false;
  for (const { p: q, w } of line)
    for (let y = Math.floor(q.y - w - 1); y <= Math.ceil(q.y + w + 1); y++)
      for (let x = Math.floor(q.x - w - 1); x <= Math.ceil(q.x + w + 1); x++) {
        if ((x + 0.5 - q.x) ** 2 + (y + 0.5 - q.y) ** 2 > w * w) continue;
        const t = h.at(x, y);
        if (t === 'w' || t === 'r' || t === 'b' || t === 'x' || t === 'p') continue;
        h.paint(x, y, h.track?.(x, y) ? 'b' : 'v');
      }
  // Bridges: across the line at right angles, three tiles wide, wherever there is ravine to cross.
  const first = 6 + Math.floor(h.rng.float() * 8);
  for (let s = first; s < line.length - 4; s += RAVINE_BRIDGE_GAP) bridge(h, line[s].p, line[s].heading, line[s].w);
  return true;
}

/** A bridge across a ravine at q, at right angles to its heading: every ravine tile on the way becomes deck. */
function bridge(h: HazardBrush, q: Pt, heading: number, w: number) {
  // Bridges run straight across the grid, so they read as bridges: along whichever axis is closer
  // to the ravine's normal.
  const nx = -Math.sin(heading);
  const ny = Math.cos(heading);
  const across = Math.abs(nx) >= Math.abs(ny) ? { x: Math.sign(nx), y: 0 } : { x: 0, y: Math.sign(ny) };
  const side = { x: across.y, y: across.x };
  const reach = Math.ceil(w) + 3;
  const cx = Math.floor(q.x);
  const cy = Math.floor(q.y);
  for (let o = -1; o <= 1; o++)
    for (let d = -reach; d <= reach; d++) {
      const x = cx + across.x * d + side.x * o;
      const y = cy + across.y * d + side.y * o;
      if (h.at(x, y) === 'v') h.paint(x, y, 'b');
    }
}

/**
 * A ruined city round c, radius r: streets two tiles wide on a grid (one avenue three wide each
 * way through the middle), blocks of three or four tiles between them. Each block is whole
 * (ruins), collapsed (an open square with a heap or two), or gone at the ragged edge.
 */
function city(h: HazardBrush, c: Pt, r: number) {
  const block = h.rng.float() < 0.5 ? 3 : 4;
  const period = block + 2;
  const ox = Math.floor(c.x) - Math.floor(period / 2);
  const oy = Math.floor(c.y) - Math.floor(period / 2);
  const span = Math.ceil(r / period) + 2;
  // One draw per block, in a fixed order, so the city is the same for the same seed.
  const kinds = new Map<string, number>();
  for (let by = -span; by <= span; by++) for (let bx = -span; bx <= span; bx++) kinds.set(`${bx},${by}`, h.rng.float());
  const rough: number[] = [];
  for (let i = 0; i < 24; i++) rough.push(h.rng.float());
  const edge = (x: number, y: number) => {
    const a = Math.atan2(y - c.y, x - c.x);
    const f = ((a + Math.PI) / (Math.PI * 2)) * 24;
    const i = Math.floor(f) % 24;
    const t = f - Math.floor(f);
    return r * (0.82 + 0.18 * (rough[i] * (1 - t) + rough[(i + 1) % 24] * t));
  };
  for (let y = Math.floor(c.y - r - 1); y <= Math.ceil(c.y + r + 1); y++)
    for (let x = Math.floor(c.x - r - 1); x <= Math.ceil(c.x + r + 1); x++) {
      const d = Math.sqrt((x + 0.5 - c.x) ** 2 + (y + 0.5 - c.y) ** 2);
      if (d > edge(x + 0.5, y + 0.5)) continue;
      const t = h.at(x, y);
      if (t === 'w' || t === 'r' || t === 'v' || t === 'b') continue;
      const lx = x - ox;
      const ly = y - oy;
      const bx = Math.floor(lx / period);
      const by = Math.floor(ly / period);
      const mx = ((lx % period) + period) % period;
      const my = ((ly % period) + period) % period;
      // The avenues: the street through the centre each way is a tile wider.
      const avenue = (bx === 0 && mx === period - 1) || (by === 0 && my === period - 1);
      if (mx < 2 || my < 2 || avenue) {
        h.paint(x, y, 'p');
        continue;
      }
      const k = kinds.get(`${bx},${by}`) ?? 0.5;
      const outer = d > r * 0.7;
      if (outer && k < 0.35) {
        // Gone: the city's edge frays into the country, with a heap here and there.
        if (k < 0.08 && (mx + my) % 3 === 0) h.paint(x, y, 'x');
        else h.paint(x, y, 'p');
      } else if (k < 0.2) {
        // Collapsed into a square: open paving, a heap in one corner.
        h.paint(x, y, mx === 2 && my === 2 ? 'x' : 'p');
      } else h.paint(x, y, 'x');
    }
}

/** A ruined farmstead or two: a paved yard five tiles across with a gutted building on it. */
function hamlet(h: HazardBrush, c: Pt) {
  const cx = Math.floor(c.x);
  const cy = Math.floor(c.y);
  const wide = h.rng.float() < 0.5;
  for (let y = cy - 2; y <= cy + 2; y++)
    for (let x = cx - 2; x <= cx + 2; x++) {
      const t = h.at(x, y);
      if (t === 'w' || t === 'r' || t === 'v' || t === 'b') continue;
      const ruin = wide ? x >= cx - 1 && x <= cx + 1 && y >= cy - 1 && y <= cy : x >= cx - 1 && x <= cx && y >= cy - 1 && y <= cy + 1;
      h.paint(x, y, ruin ? 'x' : 'p');
    }
}

/**
 * The last word on bridges, on the finished map: a group of bridge tiles (four ways) that touches
 * no ravine (four ways) becomes dirt. It happens where a track grazed a ravine's edge, met rock
 * the ravine was not laid over, or where turning a wedge by a third rounded a bridge apart. The
 * rule reads only a tile's neighbours, so a symmetric map stays symmetric.
 */
export function settleBridges(t: string[], w: number, h = w): void {
  const seen = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) {
    if (t[k] !== 'b' || seen[k]) continue;
    const group = [k];
    seen[k] = 1;
    let ravine = false;
    for (let i = 0; i < group.length; i++) {
      const c = group[i];
      const x = c % w;
      const y = (c / w) | 0;
      const ns = [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, y > 0 ? c - w : -1, y < h - 1 ? c + w : -1];
      for (const n of ns) {
        if (n < 0) continue;
        if (t[n] === 'v') ravine = true;
        else if (t[n] === 'b' && !seen[n]) {
          seen[n] = 1;
          group.push(n);
        }
      }
    }
    if (!ravine) for (const c of group) t[c] = 'd';
  }
}
