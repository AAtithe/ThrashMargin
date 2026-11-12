/**
 * War for the Planet: passing, supply, encirclement and paths (fireline-planet-design.md,
 * section 6.5). W1. Pure.
 */
import { planetMapOf } from './map';
import { allied, treatyBetween } from './state';
import { NEUTRAL, type FactionId, type PlanetState, type RegionId } from './types';

/** f may pass r: its own, an ally's, or one whose owner granted f access by treaty. */
export function mayPass(s: PlanetState, f: FactionId, r: RegionId): boolean {
  const owner = s.regions[r]?.owner;
  if (owner === undefined || owner === NEUTRAL) return false;
  if (owner === f) return true;
  if (allied(s, f, owner)) return true;
  const t = treatyBetween(s, f, owner);
  return !!t && t.terms.some(x => x.k === 'access' && x.grantor === owner);
}

export const hasPort = (s: PlanetState, r: RegionId): boolean => (s.regions[r]?.city.b.port ?? 0) > 0;

/**
 * Shortest path by BFS (neighbours in id order, so ties go to the lowest id) from `from` to `to`
 * through regions `pass` allows; a sea link only from a passable region with a port. Both ends must
 * be passable. Returns the regions from `from` to `to` inclusive, or null.
 */
export function bfsPath(s: PlanetState, from: RegionId, to: RegionId, pass: (r: RegionId) => boolean, maxHops = Infinity): RegionId[] | null {
  if (!pass(from) || !pass(to)) return null;
  if (from === to) return [from];
  const m = planetMapOf(s);
  const prev = new Array(m.regions.length).fill(-1);
  const hops = new Array(m.regions.length).fill(-1);
  hops[from] = 0;
  const q = [from];
  for (let h = 0; h < q.length; h++) {
    const r = q[h];
    if (hops[r] >= maxHops) continue;
    const port = hasPort(s, r);
    for (const l of m.regions[r].links) {
      if (hops[l.to] >= 0 || (l.sea && !port) || !pass(l.to)) continue;
      hops[l.to] = hops[r] + 1;
      prev[l.to] = r;
      if (l.to === to) {
        const path = [to];
        let c = to;
        while (c !== from) {
          c = prev[c];
          path.push(c);
        }
        return path.reverse();
      }
      q.push(l.to);
    }
  }
  return null;
}

/** Per region: true when f owns it and it is linked to f's capital through regions f may pass. */
export function suppliedRegions(s: PlanetState, f: FactionId): boolean[] {
  const out = s.regions.map(() => false);
  const fac = s.factions[f];
  if (!fac || !fac.alive || s.regions[fac.capital]?.owner !== f) return out;
  const m = planetMapOf(s);
  const seen = s.regions.map(() => false);
  seen[fac.capital] = true;
  const q = [fac.capital];
  for (let h = 0; h < q.length; h++) {
    const r = q[h];
    const port = hasPort(s, r);
    for (const l of m.regions[r].links) {
      if (seen[l.to] || (l.sea && !port) || !mayPass(s, f, l.to)) continue;
      seen[l.to] = true;
      q.push(l.to);
    }
  }
  s.regions.forEach((r, i) => (out[i] = seen[i] && r.owner === f));
  return out;
}

/** The field army's path to `to` within the hops it has left this turn, or null. */
export function armyPath(s: PlanetState, f: FactionId, to: RegionId): RegionId[] | null {
  const fac = s.factions[f];
  if (!fac?.army || !s.regions[to]) return null;
  const left = s.options.armyMove - fac.army.moved;
  if (left <= 0 && to !== fac.army.region) return null;
  return bfsPath(s, fac.army.region, to, r => mayPass(s, f, r), left);
}

/** The nearest region f owns from r by hops over every link (ties lowest id), or null. */
export function nearestOwned(s: PlanetState, f: FactionId, r: RegionId): RegionId | null {
  const m = planetMapOf(s);
  const seen = s.regions.map(() => false);
  seen[r] = true;
  let frontier = [r];
  while (frontier.length) {
    const next: RegionId[] = [];
    for (const x of frontier) for (const l of m.regions[x].links) {
      if (seen[l.to]) continue;
      seen[l.to] = true;
      next.push(l.to);
    }
    next.sort((a, b) => a - b);
    const hit = next.find(x => s.regions[x].owner === f);
    if (hit !== undefined) return hit;
    frontier = next;
  }
  return null;
}
