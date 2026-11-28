/**
 * Grand War, G1 (fireline-grand-war-design.md): cities that grow, independent towns, founding, and
 * dominion. Pure, like the rest of src/sim/: no clock, no unseeded dice. Every function here is a
 * no-op outside a Grand War battle (`grandOn`), so skirmishes, missions and planet battles run
 * exactly as before.
 *
 * Cities. Each Command Yard starts a city of CITY_START_POP. Every CITY_BEAT a city's population
 * moves one toward the housing round it (its own yard and the Quarters nearer it than any other of
 * its side's cities; a hungry Quarters houses half, so food keeps a city growing), never under its
 * floor, its own yard's housing. Workers are the economy's own (territory.ts); the population is what
 * levels a city, and what it gives up to found another.
 *
 * Founding. A Forward Base Truck deploys into a new city only on ground at least CITY_GAP from every
 * city and town, and only while one of its side's cities can spare CITY_FOUNDING_COST people.
 *
 * Towns. An independent town's militia fires at every unit in reach (any side's while it is
 * independent, its holder's enemies once held) and is worn down by the fire of the units round it,
 * worked out as a siege rather than shot by shot. Broken, it is taken by infantry as a neutral site
 * is (sites.ts). Held, its militia regrows to TOWN_HELD_SHARE, it pays TOWN_INCOME, houses workers,
 * claims ground and counts as a city.
 *
 * Dominion. A team holding dominionShare of all cities (towns included) for dominionMinutes without a
 * break wins. With a time limit, the team holding most cities when it runs out wins (level teams play
 * on). Conquest still wins outright (checkVictory).
 */
import {
  BUILDINGS,
  CITY_BEAT,
  CITY_FOUNDED_POP,
  CITY_FOUNDING_COST,
  CITY_GAP,
  CITY_MIN_POP,
  CITY_START_POP,
  DERRICK_TICKS,
  HOUSING,
  PREFAB_HOUSING,
  SITES,
  TOWN_DAMAGE,
  TOWN_FIRE_TICKS,
  TOWN_GAP,
  TOWN_GARRISON,
  TOWN_HELD_SHARE,
  TOWN_INCOME,
  TOWN_RANGE,
  TOWN_REGROW,
  TOWN_SIZE,
  TOWN_YARD_GAP,
  UNITS,
  hitsGround,
  type Owner,
} from './rules';
import { isWalkable } from './map';
import { next, seedFromString } from './rng';
import { allCities, centreOf, cityLevel, citiesOf, grandOn, isCity, nearestCity, townCentre, townsOf } from './cities';
import { isAlly, isEnemy, sidesOf } from './sides';
import type { Building, GameState, Site, Unit } from './types';

export { grandOn } from './cities';

/** A distance from its two legs: a square root, never Math.hypot, whose last digit may differ by engine. */
const len = (dx: number, dy: number): number => Math.sqrt(dx * dx + dy * dy);

type Say = (s: GameState, text: string, tone: 'info' | 'good' | 'bad') => void;

/** A town's full militia in this battle. */
export const townGarrisonMax = (s: GameState): number => Math.round(TOWN_GARRISON * (s.setup?.grand?.townStrength ?? 1));

// ---------------------------------------------------------------------------------------------
// The start

/** A new Grand War battle: each Command Yard a city, the towns placed, the dominion clock clear. */
export function startGrand(s: GameState): void {
  if (!grandOn(s)) return;
  for (const b of s.buildings) if (b.kind === 'hq') b.pop = CITY_START_POP;
  placeTowns(s);
  s.grand = { dominion: null };
}

const TOWN_SALT = 'grand-towns';
const ROT_C = -0.5;
const ROT_S = 0.8660254037844386;
const NUDGE = 3;

function townLegal(s: GameState, x: number, y: number, placed: { x: number; y: number }[]): boolean {
  const n = TOWN_SIZE;
  if (x < 1 || y < 1 || x + n + 1 > s.mapW || y + n + 1 > s.mapH) return false;
  for (let ty = y - 1; ty <= y + n; ty++) for (let tx = x - 1; tx <= x + n; tx++) if (!isWalkable(s.tiles[ty * s.mapW + tx] as never)) return false;
  for (let ty = Math.max(0, y - 2); ty <= Math.min(s.mapH - 1, y + n + 1); ty++)
    for (let tx = Math.max(0, x - 2); tx <= Math.min(s.mapW - 1, x + n + 1); tx++) if (s.ore[ty * s.mapW + tx] > 0) return false;
  const cx = x + n / 2;
  const cy = y + n / 2;
  for (const st of s.starts ?? []) if (len(st.x + 1.5 - cx, st.y + 1.5 - cy) < TOWN_YARD_GAP) return false;
  for (const site of s.sites ?? []) {
    const spec = SITES[site.kind];
    if (len(site.x + spec.w / 2 - cx, site.y + spec.h / 2 - cy) < TOWN_GAP) return false;
  }
  for (const p of placed) if (len(p.x + n / 2 - cx, p.y + n / 2 - cy) < TOWN_GAP) return false;
  return true;
}

/** The copies of a spot in side 0's share for every side: the map's own symmetry, as the sites use. */
function townCopies(s: GameState, x: number, y: number, placed: { x: number; y: number }[]): { x: number; y: number }[] | null {
  const sides = s.starts?.length ?? 2;
  const n = TOWN_SIZE;
  const W = s.mapW;
  const H = s.mapH;
  const out = [{ x, y }];
  if (sides === 2) out.push({ x: W - n - x, y: H - n - y });
  else if (sides === 4) {
    let p = { x, y };
    for (let k = 1; k < 4; k++) {
      p = { x: W - n - p.y, y: p.x };
      out.push(p);
    }
  } else {
    const mx = W / 2;
    const my = H / 2;
    let px = x + n / 2 - mx;
    let py = y + n / 2 - my;
    for (let k = 1; k < sides; k++) {
      const rx = px * ROT_C - py * ROT_S;
      const ry = px * ROT_S + py * ROT_C;
      px = rx;
      py = ry;
      const bx = Math.round(mx + px - n / 2);
      const by = Math.round(my + py - n / 2);
      let found: { x: number; y: number } | null = null;
      for (let r = 0; r <= NUDGE && !found; r++)
        for (let dy = -r; dy <= r && !found; dy++)
          for (let dx = -r; dx <= r && !found; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (townLegal(s, bx + dx, by + dy, [...placed, ...out])) found = { x: bx + dx, y: by + dy };
          }
      if (!found) return null;
      out.push(found);
    }
    return out;
  }
  const taken: { x: number; y: number }[] = [...placed];
  for (const p of out) {
    if (!townLegal(s, p.x, p.y, taken)) return null;
    taken.push(p);
  }
  return out;
}

/**
 * Places townsPerSide towns for every side, with the map's symmetry. Candidates are every legal spot
 * (on a two-tile grid) in side 0's share of the map, nearer its yard than any other, between
 * TOWN_YARD_GAP and the middle; each town takes one at random from the seeded stream, and its copies
 * for the other sides must be legal too.
 */
function placeTowns(s: GameState): void {
  const per = s.setup?.grand?.townsPerSide ?? 0;
  const starts = s.starts;
  if (!per || !starts?.length) return;
  let seed = seedFromString(`${s.seedText}|${TOWN_SALT}`);
  const rand = (): number => {
    const r = next(seed);
    seed = r.seed;
    return r.value;
  };
  const yard = starts.map(st => ({ x: st.x + 1.5, y: st.y + 1.5 }));
  const reachMid = len(s.mapW / 2 - yard[0].x, s.mapH / 2 - yard[0].y);
  const cands: { x: number; y: number }[] = [];
  for (let y = 1; y < s.mapH - TOWN_SIZE - 1; y += 2)
    for (let x = 1; x < s.mapW - TOWN_SIZE - 1; x += 2) {
      const cx = x + TOWN_SIZE / 2;
      const cy = y + TOWN_SIZE / 2;
      const d0 = len(cx - yard[0].x, cy - yard[0].y);
      if (d0 > reachMid || yard.some((p, i) => i > 0 && len(cx - p.x, cy - p.y) <= d0)) continue;
      if (townLegal(s, x, y, [])) cands.push({ x, y });
    }
  const placed: { x: number; y: number }[] = [];
  const towns: Site[] = [];
  for (let i = 0; i < per && cands.length; i++) {
    for (let tries = 0; tries < 200 && cands.length; tries++) {
      const k = Math.floor(rand() * cands.length);
      const c = cands[k];
      cands.splice(k, 1);
      if (!townLegal(s, c.x, c.y, placed)) continue;
      const copies = townCopies(s, c.x, c.y, placed);
      if (!copies) continue;
      for (const p of copies) {
        placed.push(p);
        towns.push({ id: s.nextId++, kind: 'town', x: p.x, y: p.y, owner: null, capture: null, garrison: townGarrisonMax(s) });
      }
      break;
    }
  }
  s.sites = [...(s.sites ?? []), ...towns];
}

// ---------------------------------------------------------------------------------------------
// Founding

/** Why a new city may not stand with its centre here for this side, or null. Grand War only. */
export function foundingProblem(s: GameState, owner: Owner, cx: number, cy: number): string | null {
  if (!grandOn(s)) return null;
  for (const b of allCities(s)) {
    const c = centreOf(b);
    if (len(c.x - cx, c.y - cy) < CITY_GAP) return 'Too close to a city';
  }
  for (const t of townsOf(s)) {
    const c = townCentre(t);
    if (len(c.x - cx, c.y - cy) < CITY_GAP) return 'Too close to a town';
  }
  if (!donorCity(s, owner)) return `No city can spare ${CITY_FOUNDING_COST} settlers`;
  return null;
}

/** The city that gives the settlers: the most populous that can spare them (lowest id on a tie). */
function donorCity(s: GameState, owner: Owner): Building | null {
  let best: Building | null = null;
  for (const b of citiesOf(s, owner)) if ((b.pop ?? 0) >= CITY_FOUNDING_COST + cityFloor(b) && (!best || b.pop! > best.pop!)) best = b;
  return best;
}

/** True when one of this side's cities can spare the settlers for another. */
export const canSpareSettlers = (s: GameState, owner: Owner): boolean => donorCity(s, owner) !== null;

/** A truck has deployed into this Field Yard: it is a new city, and its settlers leave their old one. */
export function foundCity(s: GameState, yard: Building): void {
  if (!grandOn(s)) return;
  const donor = donorCity(s, yard.owner);
  if (donor) donor.pop = donor.pop! - CITY_FOUNDING_COST;
  yard.pop = CITY_FOUNDED_POP;
}

// ---------------------------------------------------------------------------------------------
// Each tick

export function grandStep(s: GameState, say: Say): void {
  if (!grandOn(s) || s.winner !== null) return;
  if (s.tick % CITY_BEAT === 0) cityBeat(s, say);
  if (s.tick % TOWN_FIRE_TICKS === 0) townsFight(s);
  if (s.tick % DERRICK_TICKS === 0) townIncome(s);
  if (s.tick % TOWN_FIRE_TICKS === 0) dominionStep(s, say);
}

/** Housing that counts toward this city: housing structures of its side nearer it than any other of its cities. */
export function cityHousing(s: GameState, city: Building): number {
  const prefab = !!s.players[city.owner]?.projects?.includes('prefab');
  let n = 0;
  for (const b of s.buildings) {
    if (b.owner !== city.owner || b.hp <= 0) continue;
    const full = b.kind === 'quarters' && prefab ? PREFAB_HOUSING : (HOUSING[b.kind] ?? 0);
    if (!full) continue;
    if (b !== city) {
      const c = centreOf(b);
      if (nearestCity(s, city.owner, c.x, c.y) !== city) continue;
    }
    n += b.hungry ? Math.floor(full / 2) : full;
  }
  return n;
}

/** The people a city keeps whatever happens: its own yard's housing. */
export const cityFloor = (b: Building): number => HOUSING[b.kind] ?? CITY_MIN_POP;

/**
 * Every beat each city moves one person toward the housing round it: it grows as Quarters are built
 * and fed (a hungry Quarters houses half, production.ts), and shrinks as they are lost or go hungry,
 * never under its floor.
 */
function cityBeat(s: GameState, say: Say): void {
  for (const o of sidesOf(s)) {
    for (const city of citiesOf(s, o)) {
      const pop = city.pop!;
      const room = Math.max(cityFloor(city), cityHousing(s, city));
      const before = cityLevel(pop);
      if (pop < room) city.pop = pop + 1;
      else if (pop > room) city.pop = pop - 1;
      const after = cityLevel(city.pop!);
      if (o === 0 && after !== before) say(s, after > before ? `A city has grown to level ${after}.` : `A city has fallen to level ${after}: it has lost housing, or its Quarters are hungry.`, after > before ? 'good' : 'bad');
    }
  }
}

/** Fire a unit puts into a town's militia every TOWN_FIRE_TICKS: its weapon's damage at its rate. */
function siegeFire(s: GameState, u: Unit): number {
  const w = UNITS[u.kind].weapon;
  if (!w || !hitsGround(w) || w.cooldown <= 0) return 0;
  return (w.damage * TOWN_FIRE_TICKS) / w.cooldown;
}

const hostileToTown = (s: GameState, t: Site, owner: Owner): boolean => (t.owner === null ? true : isEnemy(s, t.owner, owner));

function townsFight(s: GameState): void {
  const towns = townsOf(s);
  if (!towns.length) return;
  const max = townGarrisonMax(s);
  const ground = s.units.filter(u => u.hp > 0 && UNITS[u.kind].category !== 'air');
  s.sites = s.sites!.map(t => {
    if (t.kind !== 'town') return t;
    const c = townCentre(t);
    const reach = TOWN_RANGE + TOWN_SIZE / 2;
    let garrison = t.garrison ?? 0;
    let target: Unit | null = null;
    let targetD = Infinity;
    let siege = 0;
    for (const u of ground) {
      const d = len(u.x - c.x, u.y - c.y);
      if (d > reach || !hostileToTown(s, t, u.owner)) continue;
      siege += siegeFire(s, u);
      if (d < targetD) {
        targetD = d;
        target = u;
      }
    }
    if (garrison > 0 && target) {
      target.hp -= TOWN_DAMAGE;
      s.effects.push({ id: s.nextId++, kind: 'muzzle', x: c.x, y: c.y, at: s.tick, size: 1 });
    }
    if (siege > 0) garrison = Math.max(0, Math.round(garrison - siege));
    else {
      // Nobody hostile in reach: the militia regrows, fully while independent, partly once held.
      const cap = t.owner === null ? max : Math.round(max * TOWN_HELD_SHARE);
      if (garrison < cap) garrison = Math.min(cap, garrison + TOWN_REGROW);
    }
    // Taken this tick (sites.ts set a new holder): the militia starts again from nothing for it.
    return garrison === t.garrison ? t : { ...t, garrison };
  });
}

function townIncome(s: GameState): void {
  for (const t of townsOf(s)) if (t.owner !== null && s.players[t.owner]) s.players[t.owner].credits += TOWN_INCOME;
}

/** Cities each team holds (its lowest side as the key), and the total on the map, towns included. */
export function cityCounts(s: GameState): { total: number; byTeam: Map<Owner, number> } {
  const byTeam = new Map<Owner, number>();
  const sides = sidesOf(s);
  const teamKey = (o: Owner): Owner => sides.find(a => isAlly(s, a, o)) ?? o;
  let total = 0;
  for (const b of s.buildings) {
    if (!isCity(s, b)) continue;
    total++;
    const k = teamKey(b.owner);
    byTeam.set(k, (byTeam.get(k) ?? 0) + 1);
  }
  for (const t of townsOf(s)) {
    total++;
    if (t.owner === null) continue;
    const k = teamKey(t.owner);
    byTeam.set(k, (byTeam.get(k) ?? 0) + 1);
  }
  return { total, byTeam };
}

/** The team holding the dominion share now (its lowest side), or null. */
export function dominantTeam(s: GameState): Owner | null {
  const g = s.setup?.grand;
  if (!g) return null;
  const { total, byTeam } = cityCounts(s);
  if (!total) return null;
  for (const [team, n] of byTeam) if (n * 100 >= g.dominionShare * total) return team;
  return null;
}

function dominionStep(s: GameState, say: Say): void {
  const g = s.setup!.grand!;
  const st = s.grand ?? { dominion: null };
  const team = dominantTeam(s);
  let dominion = st.dominion;
  if (team === null) {
    if (dominion && isAlly(s, 0, dominion.team)) say(s, 'Our dominion is broken: we hold too few cities.', 'bad');
    dominion = null;
  } else if (!dominion || dominion.team !== team) {
    dominion = { team, since: s.tick };
    say(s, isAlly(s, 0, team) ? `We hold ${g.dominionShare}% of the cities. Hold them ${g.dominionMinutes} minutes to win.` : `An enemy holds ${g.dominionShare}% of the cities. Break its hold within ${g.dominionMinutes} minutes.`, isAlly(s, 0, team) ? 'good' : 'bad');
  }
  if (dominion !== st.dominion) s.grand = { ...st, dominion };
  if (dominion && s.tick - dominion.since >= g.dominionMinutes * 600) {
    s.winner = isAlly(s, 0, dominion.team) ? 0 : dominion.team;
    say(s, s.winner === 0 ? 'Victory. Our dominion over the cities is complete.' : 'Defeat. The enemy rules the cities.', s.winner === 0 ? 'good' : 'bad');
    return;
  }
  if (g.timeLimit > 0 && s.tick >= g.timeLimit * 600) {
    const { byTeam } = cityCounts(s);
    let best: Owner | null = null;
    let bestN = -1;
    let level = false;
    for (const [team, n] of [...byTeam.entries()].sort((a, b) => a[0] - b[0])) {
      if (n > bestN) {
        best = team;
        bestN = n;
        level = false;
      } else if (n === bestN) level = true;
    }
    if (best === null || level) return;
    s.winner = isAlly(s, 0, best) ? 0 : best;
    say(s, s.winner === 0 ? `Time. We hold the most cities: ${bestN}. Victory.` : `Time. The enemy holds the most cities: ${bestN}. Defeat.`, s.winner === 0 ? 'good' : 'bad');
  }
}

/** A Grand War's state, repaired for a save; null drops it. */
export function migrateGrand(raw: unknown, s: GameState): GameState['grand'] | null {
  if (!s.setup?.grand || !raw || typeof raw !== 'object') return null;
  const d = (raw as { dominion?: unknown }).dominion as { team?: unknown; since?: unknown } | null | undefined;
  if (d && typeof d === 'object' && sidesOf(s).includes(d.team as Owner) && Number.isInteger(d.since) && (d.since as number) >= 0 && (d.since as number) <= s.tick) {
    return { dominion: { team: d.team as Owner, since: d.since as number } };
  }
  return { dominion: null };
}
