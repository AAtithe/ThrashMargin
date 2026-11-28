/**
 * Grand War, G1 and later (fireline-grand-war-design.md): the computer commander's grand strategy.
 * Pure. Called from ai.ts; every function is a no-op outside a Grand War battle.
 *
 *  - Towns: every other wave, or any wave for which a town not held by its team is nearer than the
 *    enemy it was aimed at, goes for that town instead. A wave standing round a town wears its
 *    militia down (grand.ts); its infantry then take it, as a neutral site is taken.
 *  - Founding cities rides on the commander's expansions (aiEngineering.ts), which in a Grand War
 *    look only for ground a city may stand on, and from minute eight go ahead whenever the commander
 *    wants another city (grandWantsCity), without waiting for a second Refinery.
 */
import { citiesOf, grandOn, townCentre, townsOf } from './cities';
import { canSpareSettlers } from './grand';
import { doRoute, endOf, routeCap, routeProblem, routesOf, tripValue } from './grandTrade';
import { ROUTE_COST } from './rules';
import { sidesOf, stanceOf } from './sides';
import { dist } from './grid';
import { isAlly } from './sides';
import type { Owner } from './rules';
import type { GameState, Site } from './types';

type Pt = { x: number; y: number };

/** A wave setting off: the town it should take instead of `aim`, remembered in the memory; null to keep `aim`. */
export function grandWaveTarget(s: GameState, owner: Owner, from: Pt, aim: Pt | null, wave: number): Pt | null {
  const mem = s.ai[owner];
  if (mem.grandTown !== undefined) delete mem.grandTown;
  if (!grandOn(s)) return null;
  let best: Site | null = null;
  let bestD = Infinity;
  for (const t of townsOf(s)) {
    if (t.owner !== null && isAlly(s, t.owner, owner)) continue;
    const c = townCentre(t);
    const d = dist(from.x, from.y, c.x, c.y);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  if (!best) return null;
  if (aim && wave % 2 === 0 && bestD >= dist(from.x, from.y, aim.x, aim.y)) return null;
  mem.grandTown = best.id;
  return townCentre(best);
}

/** The wave out now: the town it is taking while its team does not hold it yet; null otherwise (and the memory cleared). */
export function grandWaveHeld(s: GameState, owner: Owner): Pt | null {
  const mem = s.ai[owner];
  if (mem.grandTown === undefined) return null;
  const t = grandOn(s) ? townsOf(s).find(x => x.id === mem.grandTown) : undefined;
  if (!t || (t.owner !== null && isAlly(s, t.owner, owner)) || mem.wavePhase !== 2) {
    delete mem.grandTown;
    return null;
  }
  return townCentre(t);
}

/** From this tick (eight minutes) the commander founds cities, one more every GRAND_FOUND_EVERY ticks, up to GRAND_CITIES. */
const GRAND_FOUND_FROM = 4800;
const GRAND_FOUND_EVERY = 9000;
const GRAND_CITIES = 4;

/** True when the commander wants another city now: an expansion goes ahead without the second Refinery it otherwise waits for. */
export function grandWantsCity(s: GameState, owner: Owner): boolean {
  if (!grandOn(s) || s.tick < GRAND_FOUND_FROM) return false;
  const want = Math.min(GRAND_CITIES, 1 + Math.floor((s.tick - GRAND_FOUND_FROM) / GRAND_FOUND_EVERY) + 1);
  return citiesOf(s, owner).length < want && canSpareSettlers(s, owner);
}

/** Credits the commander keeps beyond a route's price before it opens one. */
const ROUTE_SPARE = 1500;

/**
 * Trade: once a minute, while it has a route to spare and the credits, the commander opens the route
 * that pays most a trip: a foreign one to a partner's city first (it pays both), else between its own
 * cities and towns.
 */
export function grandTradePlan(s: GameState, owner: Owner): void {
  if (!grandOn(s) || !s.setup!.grand!.trade || s.tick % 600 >= 30) return;
  if (routesOf(s, owner).length >= routeCap(s, owner) || s.players[owner].credits < ROUTE_COST + ROUTE_SPARE) return;
  const mine = [...citiesOf(s, owner).map(b => b.id), ...townsOf(s).filter(t => t.owner === owner).map(t => t.id)];
  const ends: number[] = [...mine];
  for (const o of sidesOf(s)) if (o !== owner && (stanceOf(s, owner, o) === 'p' || stanceOf(s, owner, o) === 'a')) ends.push(...citiesOf(s, o).map(b => b.id));
  let best: [number, number] | null = null;
  let bestV = 0;
  for (const from of mine)
    for (const to of ends) {
      if (routeProblem(s, owner, from, to) !== null) continue;
      const v = tripValue(s, { owner, from, to });
      const worth = v.credits + v.food * 10;
      if (worth > bestV) {
        bestV = worth;
        best = [from, to];
      }
    }
  if (best && endOf(s, best[0])) doRoute(s, owner, best[0], best[1]);
}
