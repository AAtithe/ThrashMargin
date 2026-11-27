/**
 * Two-level route finding (2026-11-27) for maps wider than the balanced sizes (vast and continental).
 * Pure: worked out from the ground alone, which never changes in a battle, and cached by it.
 *
 * Plain A* over a 320-tile map can expand most of its 102,400 tiles for one long route, and the
 * search's limit (pathExpandLimitFor) then cuts it short, so a unit sent across the map walked to the
 * nearest point it had found and stopped. Here the map is cut into REGION-tile squares; each square's
 * walkable tiles are split into the pieces that join inside it (a ravine or a river can split one); a
 * piece links to a piece of the next square when two of their tiles touch across the edge. A long route
 * is first found over the pieces, then the tile search runs only as far as the piece LEG_REGIONS along
 * it; the unit walks that leg and asks again (`Unit.pathLeg`), so a route across the map is a chain of
 * short, cheap searches that never runs into a dead end the coarse route already knew about.
 *
 * Structures are not in the coarse map (they change): the tile search still steers round them.
 */

/** Tiles on a side of a region. */
export const REGION = 16;
/** Pieces along the coarse route to the end of one leg. */
export const LEG_REGIONS = 4;
/** Routes shorter than this (Chebyshev, tiles) use the plain search. */
export const LONG_ROUTE = 48;

interface Coarse {
  tiles: string;
  sea: boolean;
  w: number;
  h: number;
  /** Per tile: its piece, or -1 where it cannot be walked. */
  piece: Int32Array;
  /** Per piece: a walkable tile nearest its middle, and its middle (x, y). */
  rep: Int32Array;
  cx: Float64Array;
  cy: Float64Array;
  /** Per piece: its neighbours. */
  links: number[][];
}

const cache: Coarse[] = [];

/** The coarse map for a ground and a walkable mask (1 where a unit, or a ship with `sea`, may go). */
export function coarseFor(tiles: string, w: number, h: number, mask: Uint8Array, sea: boolean): Coarse {
  for (const c of cache) if (c.sea === sea && c.tiles === tiles) return c;
  const piece = new Int32Array(w * h).fill(-1);
  const reps: number[] = [];
  const cxs: number[] = [];
  const cys: number[] = [];
  const stack: number[] = [];
  // Pieces: flood fill within each region, four ways (as the tile search's no-corner-cutting rule
  // means a diagonal step needs a side tile open anyway).
  for (let ry = 0; ry < h; ry += REGION)
    for (let rx = 0; rx < w; rx += REGION) {
      const x1 = Math.min(w, rx + REGION);
      const y1 = Math.min(h, ry + REGION);
      for (let y = ry; y < y1; y++)
        for (let x = rx; x < x1; x++) {
          const k = y * w + x;
          if (!mask[k] || piece[k] !== -1) continue;
          const id = reps.length;
          const members: number[] = [];
          piece[k] = id;
          stack.push(k);
          while (stack.length) {
            const t = stack.pop()!;
            members.push(t);
            const tx = t % w;
            const ty = (t / w) | 0;
            const tryAt = (nx: number, ny: number) => {
              if (nx < rx || ny < ry || nx >= x1 || ny >= y1) return;
              const n = ny * w + nx;
              if (mask[n] && piece[n] === -1) {
                piece[n] = id;
                stack.push(n);
              }
            };
            tryAt(tx + 1, ty);
            tryAt(tx - 1, ty);
            tryAt(tx, ty + 1);
            tryAt(tx, ty - 1);
          }
          let sx = 0;
          let sy = 0;
          for (const t of members) {
            sx += t % w;
            sy += (t / w) | 0;
          }
          const mx = sx / members.length;
          const my = sy / members.length;
          let best = members[0];
          let bestD = Infinity;
          for (const t of members) {
            const d = (t % w - mx) ** 2 + (((t / w) | 0) - my) ** 2;
            if (d < bestD || (d === bestD && t < best)) {
              bestD = d;
              best = t;
            }
          }
          reps.push(best);
          cxs.push(mx);
          cys.push(my);
        }
    }
  const links: Set<number>[] = reps.map(() => new Set<number>());
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = piece[y * w + x];
      if (a < 0) continue;
      if (x + 1 < w) {
        const b = piece[y * w + x + 1];
        if (b >= 0 && b !== a) {
          links[a].add(b);
          links[b].add(a);
        }
      }
      if (y + 1 < h) {
        const b = piece[(y + 1) * w + x];
        if (b >= 0 && b !== a) {
          links[a].add(b);
          links[b].add(a);
        }
      }
    }
  const c: Coarse = {
    tiles,
    sea,
    w,
    h,
    piece,
    rep: Int32Array.from(reps),
    cx: Float64Array.from(cxs),
    cy: Float64Array.from(cys),
    links: links.map(l => [...l].sort((p, q) => p - q)),
  };
  cache.push(c);
  if (cache.length > 4) cache.shift();
  return c;
}

/**
 * The tile a long route's first leg aims for: the representative tile of the piece LEG_REGIONS along
 * the coarse route from `start` to `goal`, or null when the route is short, the goal's piece is the
 * start's or a neighbour's, or no coarse route joins them (the plain search then does as it always did).
 */
export function legTarget(c: Coarse, start: number, goal: number): number | null {
  const w = c.w;
  if (Math.max(Math.abs((start % w) - (goal % w)), Math.abs(((start / w) | 0) - ((goal / w) | 0))) < LONG_ROUTE) return null;
  const a = c.piece[start];
  const b = c.piece[goal];
  if (a < 0 || b < 0 || a === b) return null;
  // A* over the pieces, distance between middles; ties broken by piece number, so it is deterministic.
  const n = c.rep.length;
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const hx = c.cx[b];
  const hy = c.cy[b];
  const h = (p: number) => Math.hypot(c.cx[p] - hx, c.cy[p] - hy);
  const open: { f: number; p: number }[] = [{ f: h(a), p: a }];
  g[a] = 0;
  let found = false;
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f || (open[i].f === open[bi].f && open[i].p < open[bi].p)) bi = i;
    const { p } = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (closed[p]) continue;
    closed[p] = 1;
    if (p === b) {
      found = true;
      break;
    }
    for (const q of c.links[p]) {
      if (closed[q]) continue;
      const gq = g[p] + Math.hypot(c.cx[q] - c.cx[p], c.cy[q] - c.cy[p]);
      if (gq < g[q]) {
        g[q] = gq;
        came[q] = p;
        open.push({ f: gq + h(q), p: q });
      }
    }
  }
  if (!found) return null;
  const route: number[] = [];
  for (let p = b; p !== -1; p = came[p]) route.push(p);
  route.reverse();
  if (route.length <= LEG_REGIONS + 1) return null;
  return c.rep[route[LEG_REGIONS]];
}
