/**
 * War for the Planet: the planet's geometry (fireline-planet-design.md, section 5). W1.
 * Regenerated from the seed whenever it is needed and never saved. Pure: every draw comes from
 * `stream(seedFromString(seedText + ':planet'))` (or the retry seed text), never the global random source.
 */
import { type OreLevel } from '../sim/rules';
import { seedFromString, stream } from '../sim/rng';
import { ORE_K, ORE_WEIGHTS, PLANET_TERRAINS, TERRAIN_YIELD, type PlanetTerrain } from './rules';
import { NEUTRAL, type ContinentGeo, PlanetLink, PlanetMap, PlanetOptions, PlanetState, RegionGeo, RegionId } from './types';

export const PLANET_W = 1200;
export const PLANET_H = 600;
/** Most geometry retries before a seed gives up and returns its last attempt. */
export const PLANET_RETRIES = 20;

export const CITY_START = ['Ar', 'Bel', 'Cor', 'Dun', 'Esk', 'Fal', 'Gar', 'Hol', 'Ist', 'Jor', 'Kel', 'Lun', 'Mar', 'Nor', 'Ost', 'Pell', 'Quar', 'Ros', 'Sel', 'Tor', 'Ulm', 'Var', 'Wen', 'Yar'];
export const CITY_END = ['ford', 'haven', 'mere', 'gate', 'wick', 'holm', 'stead', 'ton', 'by', 'mouth', 'crest', 'fall', 'reach', 'port', 'field', 'moor'];
export const TERRAIN_NOUN: Record<PlanetTerrain, string> = { classic: 'Marches', river: 'Valley', highlands: 'Highlands', lakes: 'Lakes', plains: 'Plains', canyon: 'Canyons' };
export const PLANET_NAMES = ['Meridian', 'Kessa', 'Orrin', 'Tavor', 'Halcyon', 'Brume'];

type Rng = ReturnType<typeof stream>;
interface Pt { x: number; y: number }

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** True when segments p1-p2 and p3-p4 cross at a point that is not a shared endpoint. */
export function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y;
  if (same(p1, p3) || same(p1, p4) || same(p2, p3) || same(p2, p4)) return false;
  const o = (a: Pt, b: Pt, c: Pt) => {
    const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    return v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0;
  };
  const d1 = o(p3, p4, p1);
  const d2 = o(p3, p4, p2);
  const d3 = o(p1, p2, p3);
  const d4 = o(p1, p2, p4);
  return d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

function geometry(text: string, options: PlanetOptions): PlanetMap {
  const rnd = stream(seedFromString(text + ':planet'));
  const C = Math.max(1, Math.floor(options.continents));
  const N = Math.max(4 * C, Math.floor(options.regions));

  // 1. Continents.
  const centres: Pt[] = [];
  let minGap = 320;
  let fails = 0;
  while (centres.length < C) {
    const p = { x: 150 + rnd.float() * 900, y: 130 + rnd.float() * 340 };
    if (centres.every(c => dist(c, p) >= minGap)) {
      centres.push(p);
      fails = 0;
    } else if (++fails >= 200) {
      minGap *= 0.9;
      fails = 0;
    }
  }
  centres.sort((a, b) => a.x - b.x || a.y - b.y);
  const weights = centres.map(() => 0.7 + 0.6 * rnd.float());
  const wsum = weights.reduce((t, w) => t + w, 0);
  const counts = weights.map(w => Math.max(4, Math.round((N * w) / wsum)));
  let heaviest = 0;
  for (let i = 1; i < C; i++) if (weights[i] > weights[heaviest]) heaviest = i;
  counts[heaviest] += N - counts.reduce((t, n) => t + n, 0);
  const continents: ContinentGeo[] = centres.map((c, i) => {
    const rx = 75 * Math.sqrt(counts[i]);
    return { id: i, x: Math.round(c.x), y: Math.round(c.y), rx: Math.round(rx), ry: Math.round(0.65 * rx), terrain: 'classic' as PlanetTerrain };
  });
  for (const c of continents) c.terrain = PLANET_TERRAINS[rnd.int(0, 5)];

  // 2. Sites. A site also has to lie nearer (in ellipse terms) its own continent's centre than any
  // other's, so overlapping ellipses do not interleave their regions (see the W1 build log).
  const norm = (p: Pt, c: ContinentGeo) => ((p.x - c.x) / c.rx) ** 2 + ((p.y - c.y) / c.ry) ** 2;
  const sites: { x: number; y: number; continent: number }[] = [];
  for (const c of continents) {
    let gap = 46;
    let miss = 0;
    let placed = 0;
    while (placed < counts[c.id]) {
      const u = rnd.float() * 2 - 1;
      const v = rnd.float() * 2 - 1;
      let ok = u * u + v * v <= 1;
      let p: Pt = { x: 0, y: 0 };
      if (ok) {
        p = {
          x: Math.round(Math.min(PLANET_W - 30, Math.max(30, c.x + u * c.rx))),
          y: Math.round(Math.min(PLANET_H - 30, Math.max(30, c.y + v * c.ry))),
        };
        const own = norm(p, c);
        ok = continents.every(o => o.id === c.id || own < norm(p, o)) && sites.every(q => dist(q, p) >= gap);
      }
      if (ok) {
        sites.push({ x: p.x, y: p.y, continent: c.id });
        placed++;
        miss = 0;
      } else if (++miss >= 100) {
        gap *= 0.95;
        miss = 0;
      }
    }
  }

  // 3. Ids.
  sites.sort((a, b) => a.continent - b.continent || a.x - b.x || a.y - b.y);
  const byCont: number[][] = continents.map(() => []);
  sites.forEach((s, i) => byCont[s.continent].push(i));

  // 4. Land links.
  const links: PlanetLink[] = [];
  const deg = new Array(sites.length).fill(0);
  const has = new Set<string>();
  const addLink = (a: number, b: number, sea: boolean) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    has.add(`${lo},${hi}`);
    links.push({ a: lo, b: hi, sea });
    if (!sea) {
      deg[lo]++;
      deg[hi]++;
    }
  };
  const crossesLand = (a: number, b: number) =>
    links.some(l => !l.sea && segmentsCross(sites[a], sites[b], sites[l.a], sites[l.b]));
  for (const ids of byCont) {
    // Prim from the lowest id.
    const inTree = new Set<number>([ids[0]]);
    while (inTree.size < ids.length) {
      let best: [number, number, number] | null = null;
      for (const a of ids) {
        if (!inTree.has(a)) continue;
        for (const b of ids) {
          if (inTree.has(b)) continue;
          const d = dist(sites[a], sites[b]);
          if (!best || d < best[2] - 1e-9 || (Math.abs(d - best[2]) <= 1e-9 && (Math.min(a, b) < Math.min(best[0], best[1]) || (Math.min(a, b) === Math.min(best[0], best[1]) && Math.max(a, b) < Math.max(best[0], best[1]))))) best = [a, b, d];
        }
      }
      if (!best) break;
      addLink(best[0], best[1], false);
      inTree.add(best[1]);
    }
    const nn = new Map<number, number>();
    for (const a of ids) {
      let m = Infinity;
      for (const b of ids) if (a !== b) m = Math.min(m, dist(sites[a], sites[b]));
      nn.set(a, m);
    }
    const pairs: [number, number, number][] = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i], ids[j], dist(sites[ids[i]], sites[ids[j]])]);
    pairs.sort((p, q) => p[2] - q[2] || p[0] - q[0] || p[1] - q[1]);
    for (const [a, b, d] of pairs) {
      if (has.has(`${a},${b}`)) continue;
      if (d > 1.6 * Math.max(nn.get(a)!, nn.get(b)!)) continue;
      if (deg[a] >= 5 || deg[b] >= 5) continue;
      if (crossesLand(a, b)) continue;
      addLink(a, b, false);
    }
  }

  // 5. Sea links.
  if (C > 1) {
    const closest = (ci: number, cj: number): [number, number, number][] => {
      const out: [number, number, number][] = [];
      for (const a of byCont[ci]) for (const b of byCont[cj]) out.push([a, b, dist(sites[a], sites[b])]);
      out.sort((p, q) => p[2] - q[2] || Math.min(p[0], p[1]) - Math.min(q[0], q[1]) || Math.max(p[0], p[1]) - Math.max(q[0], q[1]));
      return out;
    };
    const pairLists = new Map<string, [number, number, number][]>();
    for (let i = 0; i < C; i++) for (let j = i + 1; j < C; j++) pairLists.set(`${i},${j}`, closest(i, j));
    const cd = (i: number, j: number) => pairLists.get(`${Math.min(i, j)},${Math.max(i, j)}`)![0][2];
    const tree = new Set<string>();
    const inT = new Set<number>([0]);
    while (inT.size < C) {
      let best: [number, number, number] | null = null;
      for (const i of inT) for (let j = 0; j < C; j++) {
        if (inT.has(j)) continue;
        const d = cd(i, j);
        if (!best || d < best[2]) best = [i, j, d];
      }
      if (!best) break;
      tree.add(`${Math.min(best[0], best[1])},${Math.max(best[0], best[1])}`);
      inT.add(best[1]);
    }
    for (let i = 0; i < C; i++) for (let j = i + 1; j < C; j++) {
      const list = pairLists.get(`${i},${j}`)!;
      const first = list[0];
      if (tree.has(`${i},${j}`)) {
        addLink(first[0], first[1], true);
        const second = list.find(p => p[0] !== first[0] && p[0] !== first[1] && p[1] !== first[0] && p[1] !== first[1]);
        if (second && second[2] <= 1.3 * first[2]) addLink(second[0], second[1], true);
      } else if (first[2] <= 420) {
        addLink(first[0], first[1], true);
      }
    }
  }
  links.sort((p, q) => p.a - q.a || p.b - q.b);

  // 6. Coastal.
  const furthest = continents.map(c => Math.max(...byCont[c.id].map(i => dist(sites[i], c))));
  const seaEnd = new Set<number>();
  for (const l of links) if (l.sea) {
    seaEnd.add(l.a);
    seaEnd.add(l.b);
  }

  // 7 and 8. Terrain, ore, names.
  const regions: RegionGeo[] = [];
  const used = new Set<string>();
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    const c = continents[s.continent];
    const terrain: PlanetTerrain = rnd.float() < 0.5 ? c.terrain : PLANET_TERRAINS[rnd.int(0, 5)];
    const w = ORE_WEIGHTS[terrain];
    const roll = rnd.float() * (w[0] + w[1] + w[2]);
    const ore: OreLevel = roll < w[0] ? 'poor' : roll < w[0] + w[1] ? 'normal' : 'rich';
    let city = '';
    for (let k = 0; k <= 50; k++) {
      city = CITY_START[rnd.int(0, CITY_START.length - 1)] + CITY_END[rnd.int(0, CITY_END.length - 1)];
      if (!used.has(city)) break;
    }
    while (used.has(city)) city += ' II';
    used.add(city);
    const ls = links.filter(l => l.a === i || l.b === i).map(l => ({ to: l.a === i ? l.b : l.a, sea: l.sea })).sort((p, q) => p.to - q.to);
    regions.push({
      id: i,
      name: `${city} ${TERRAIN_NOUN[terrain]}`,
      city,
      x: s.x,
      y: s.y,
      continent: s.continent,
      terrain,
      ore,
      coastal: seaEnd.has(i) || dist(s, c) >= 0.55 * furthest[s.continent],
      links: ls,
    });
  }
  const name = PLANET_NAMES[rnd.int(0, PLANET_NAMES.length - 1)];
  return { w: PLANET_W, h: PLANET_H, name, continents, regions, links };
}

/** Hop distances from a set of regions over every link (land and sea). */
export function hopsFrom(m: PlanetMap, from: RegionId[]): number[] {
  const d = new Array(m.regions.length).fill(Infinity);
  const q: number[] = [];
  for (const r of from) {
    d[r] = 0;
    q.push(r);
  }
  for (let h = 0; h < q.length; h++) {
    const r = q[h];
    for (const l of m.regions[r].links) if (d[l.to] === Infinity) {
      d[l.to] = d[r] + 1;
      q.push(l.to);
    }
  }
  return d;
}

/**
 * Capitals (section 5.1, step 1), drawn from the start stream. Returns null when two end up fewer
 * than 3 hops apart, which sends the geometry to its next retry.
 */
export function placeCapitals(m: PlanetMap, factions: number, rnd: Rng): RegionId[] | null {
  const cand = m.regions.filter(r => r.links.length >= 2).map(r => r.id);
  if (!cand.length) return null;
  const caps: RegionId[] = [cand[rnd.int(0, cand.length - 1)]];
  while (caps.length < factions) {
    const d = hopsFrom(m, caps);
    let best = -1;
    for (const r of m.regions) {
      if (caps.includes(r.id)) continue;
      if (best < 0 || d[r.id] > d[best] || (d[r.id] === d[best] && r.links.length > m.regions[best].links.length)) best = r.id;
    }
    if (best < 0) return null;
    caps.push(best);
  }
  for (let i = 0; i < caps.length; i++) {
    const d = hopsFrom(m, [caps[i]]);
    for (let j = i + 1; j < caps.length; j++) if (d[caps[j]] < 3) return null;
  }
  return caps;
}

/** A seeded permutation of 0 to n - 1 (Fisher-Yates from the top). */
export function permutation(n: number, rnd: Rng): number[] {
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = rnd.int(0, i);
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

/** Total terrain yield of a region (ore after its ore level), for start claims and AI choices. */
export function terrainYieldTotal(m: PlanetMap, r: RegionId): number {
  const g = m.regions[r];
  const t = TERRAIN_YIELD[g.terrain];
  return Math.floor((t.ore * ORE_K[g.ore]) / 2) + t.fuel + t.food;
}

/**
 * Section 5.1 step 2: start regions claimed in rounds, faction 0 first, each the unowned region
 * of highest terrain yield linked to what the faction holds. Returns each region's owner (NEUTRAL
 * for unclaimed). A faction with nothing left to claim simply stops short; startDeal treats that
 * as a failed geometry attempt.
 */
export function claimStarts(m: PlanetMap, capitalOf: RegionId[], startRegions: number): number[] {
  const owner: number[] = m.regions.map(() => NEUTRAL);
  capitalOf.forEach((r, f) => (owner[r] = f));
  const held = (f: number) => owner.filter(o => o === f).length;
  for (let round = 1; round < startRegions; round++) {
    for (let f = 0; f < capitalOf.length; f++) {
      if (held(f) > round) continue;
      let best = -1;
      let bestY = -1;
      for (let r = 0; r < owner.length; r++) {
        if (owner[r] !== NEUTRAL) continue;
        if (!m.regions[r].links.some(l => owner[l.to] === f)) continue;
        const y = terrainYieldTotal(m, r);
        if (y > bestY) {
          best = r;
          bestY = y;
        }
      }
      if (best >= 0) owner[best] = f;
    }
  }
  return owner;
}

/**
 * Section 5.1 steps 1 and 2 on the start stream: capitals, their seeded deal to the factions, and
 * the start claims. Null when the capitals are not spaced or some faction cannot claim all of its
 * startRegions, either of which sends the geometry to its next retry.
 */
export function startDeal(m: PlanetMap, options: Pick<PlanetOptions, 'factions' | 'startRegions'>, rnd: Rng): { capitalOf: RegionId[]; owner: number[] } | null {
  const F = options.factions;
  const caps = placeCapitals(m, F, rnd);
  if (!caps) return null;
  const deal = permutation(F, rnd);
  const capitalOf: RegionId[] = new Array(F);
  deal.forEach((f, k) => (capitalOf[f] = caps[k]));
  const owner = claimStarts(m, capitalOf, options.startRegions);
  for (let f = 0; f < F; f++) if (owner.filter(o => o === f).length < options.startRegions) return null;
  return { capitalOf, owner };
}

/** The text a geometry attempt is drawn from: the seed itself, then seed#1 to seed#20. */
export const attemptText = (seedText: string, attempt: number): string => (attempt === 0 ? seedText : `${seedText}#${attempt}`);

/**
 * The planet for this seed: the first attempt with no planetProblem whose capitals are spaced
 * and whose every faction can claim its startRegions (section 5.1 steps 1 and 2, which need
 * options.factions and options.startRegions), or the last attempt if none is.
 */
export function generatePlanet(seedText: string, options: PlanetOptions): PlanetMap {
  let m: PlanetMap | null = null;
  for (let attempt = 0; attempt <= PLANET_RETRIES; attempt++) {
    m = geometry(attemptText(seedText, attempt), options);
    m.retries = attempt;
    if (planetProblem(m, options)) continue;
    if (!startDeal(m, options, stream(seedFromString(seedText + ':start')))) continue;
    return m;
  }
  return m!;
}

export function planetProblem(m: PlanetMap, options: PlanetOptions): string | null {
  const n = m.regions.length;
  if (n !== options.regions) return `Expected ${options.regions} regions, made ${n}.`;
  if (m.continents.length !== options.continents) return 'Wrong number of continents.';
  if (m.regions.some(r => r.links.length === 0)) return 'A region has no link.';
  const d = hopsFrom(m, [0]);
  if (d.some(x => x === Infinity)) return 'The planet is not connected.';
  for (const c of m.continents) if (m.regions.filter(r => r.continent === c.id).length < 4) return 'A continent has fewer than 4 regions.';
  const land = m.links.filter(l => !l.sea);
  for (let i = 0; i < land.length; i++) for (let j = i + 1; j < land.length; j++) {
    const a = land[i];
    const b = land[j];
    if (segmentsCross(m.regions[a.a], m.regions[a.b], m.regions[b.a], m.regions[b.b])) return 'Two land links cross.';
  }
  const sea = m.links.filter(l => l.sea);
  if (m.continents.length >= 2 && sea.length < m.continents.length - 1) return 'Too few sea links.';
  if (sea.some(l => m.regions[l.a].continent === m.regions[l.b].continent)) return 'A sea link joins one continent.';
  if (land.some(l => m.regions[l.a].continent !== m.regions[l.b].continent)) return 'A land link joins two continents.';
  return null;
}

const memo = new Map<string, PlanetMap>();
const MEMO_MAX = 16;

/**
 * Memoised generatePlanet, keyed on seedText, regions, continents, factions and startRegions (the
 * last two decide capital spacing and start claims, so they decide which geometry attempt is kept). Pure from the caller's view:
 * callers must not mutate the returned map.
 */
export function planetMapOf(s: Pick<PlanetState, 'seedText' | 'options'>): PlanetMap {
  const o = s.options;
  const key = `${o.regions}|${o.continents}|${o.factions}|${o.startRegions}|${s.seedText}`;
  let m = memo.get(key);
  if (!m) {
    m = generatePlanet(s.seedText, o);
    if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string);
    memo.set(key, m);
  }
  return m;
}
