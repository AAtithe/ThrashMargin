/**
 * Grand War, G3 (fireline-grand-war-design.md): trade convoys. Pure, like the rest of src/sim/. Every
 * function is a no-op without `setup.grand.trade`, so every other battle is untouched.
 *
 * A route joins two of a side's cities (Command Yards, founded Field Yards, held towns), or one of its
 * cities to a city of a power it has a trade pact or an alliance with. Opening one costs ROUTE_COST and
 * sends out a convoy: a Supply Truck that drives to the far city, is paid on arrival, and drives home to
 * go again. A home route pays its owner TRADE_HOME_RATE credits a tile and a food every
 * TRADE_FOOD_TILES; a foreign one TRADE_FOREIGN_RATE a tile, and the partner TRADE_PARTNER_RATE; each
 * with a bonus for length (rules.ts). The planet war's trade arithmetic, made into a unit: the further
 * the route, the more it pays a minute and the more ground a raider has to catch it on. A lost convoy is replaced after CONVOY_RESPAWN if the side can pay
 * CONVOY_COST; a route whose end is lost, or whose partner is no longer at peace, is closed. A convoy given
 * another order goes where it is told and picks its route up again once idle.
 *
 * A side may run as many routes as it holds cities and towns.
 */
import {
  CONVOY_COST,
  CONVOY_RESPAWN,
  ROUTE_COST,
  TRADE_FOOD_TILES,
  TRADE_FOREIGN_RATE,
  TRADE_HOME_RATE,
  TRADE_LENGTH_BONUS,
  TRADE_MAX,
  TRADE_MIN,
  TRADE_PARTNER_RATE,
  TRADE_REACH,
  type Owner,
} from './rules';
import { centreOf, citiesOf, grandOn, isCity, townCentre, townsHeld, townsOf } from './cities';
import { doMove } from './commands';
import { dist, nearestPassable, occupancy } from './grid';
import { foodStore } from './production';
import { sidesOf, stanceOf } from './sides';
import { addUnit, log } from './state';
import type { GameState, TradeRoute, Unit } from './types';

type Pt = { x: number; y: number };

/** True in a Grand War with trade. */
export const tradeOn = (s: GameState): boolean => grandOn(s) && s.setup!.grand!.trade && Array.isArray(s.grand?.routes);

/** A route end: its holder and its centre, or null when it is no city or town any more. */
export function endOf(s: GameState, id: number): { owner: Owner; at: Pt } | null {
  const b = s.buildings.find(x => x.id === id);
  if (b && isCity(s, b)) return { owner: b.owner, at: centreOf(b) };
  const t = townsOf(s).find(x => x.id === id);
  if (t && t.owner !== null) return { owner: t.owner, at: townCentre(t) };
  return null;
}

/** Routes a side may run: one per city or town it holds. */
export const routeCap = (s: GameState, owner: Owner): number => citiesOf(s, owner).length + townsHeld(s, owner).length;

export const routesOf = (s: GameState, owner: Owner): TradeRoute[] => (s.grand?.routes ?? []).filter(r => r.owner === owner);

/** True for a partner a side may trade with: a trade pact or an alliance. */
const partners = (s: GameState, a: Owner, b: Owner): boolean => a === b || stanceOf(s, a, b) === 'p' || stanceOf(s, a, b) === 'a';

/** What one arrival pays: the owner's credits and food, and the partner's credits (0 on a home route). */
export function tripValue(s: GameState, r: Pick<TradeRoute, 'owner' | 'from' | 'to'>): { credits: number; food: number; partner: number } {
  const a = endOf(s, r.from);
  const b = endOf(s, r.to);
  if (!a || !b) return { credits: 0, food: 0, partner: 0 };
  const d = Math.min(TRADE_MAX, Math.round(dist(a.at.x, a.at.y, b.at.x, b.at.y)));
  const len = 1 + (TRADE_LENGTH_BONUS * d) / 100;
  if (b.owner === r.owner) return { credits: Math.round(TRADE_HOME_RATE * d * len), food: Math.floor(d / TRADE_FOOD_TILES), partner: 0 };
  return { credits: Math.round(TRADE_FOREIGN_RATE * d * len), food: 0, partner: Math.round(TRADE_PARTNER_RATE * d * len) };
}

/** Why this side may not open a route between these two ends now, or null. */
export function routeProblem(s: GameState, owner: Owner, from: unknown, to: unknown): string | null {
  if (!tradeOn(s)) return 'No trade in this battle';
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return 'Choose two cities';
  const a = endOf(s, from as number);
  const b = endOf(s, to as number);
  if (!a || a.owner !== owner) return 'A route starts at one of your cities';
  if (!b) return 'A route ends at a city';
  if (!partners(s, owner, b.owner)) return 'Foreign trade needs a trade pact or an alliance';
  const d = dist(a.at.x, a.at.y, b.at.x, b.at.y);
  if (d < TRADE_MIN) return 'Too close to be worth a convoy';
  if (d > TRADE_MAX) return 'Too far for a convoy';
  if (routesOf(s, owner).some(r => (r.from === from && r.to === to) || (r.from === to && r.to === from))) return 'That route is already running';
  if (routesOf(s, owner).length >= routeCap(s, owner)) return `Your ${routeCap(s, owner)} cities run as many routes as they can`;
  if (s.players[owner].credits < ROUTE_COST) return `Opening a route costs ${ROUTE_COST}`;
  return null;
}

/** Opens the route (routeProblem was null): paid for, and its first convoy sets out. */
export function doRoute(s: GameState, owner: Owner, from: number, to: number): TradeRoute {
  s.players[owner].credits -= ROUTE_COST;
  const r: TradeRoute = { id: s.nextId++, owner, from, to, convoy: 0, wait: 0, trips: 0, paid: 0 };
  s.grand = { ...s.grand!, routes: [...s.grand!.routes!, r] };
  launch(s, r);
  if (owner === 0) log(s, `A trade route is open: ${tripValue(s, r).credits} credits a trip.`, 'good');
  return r;
}

export function unrouteProblem(s: GameState, owner: Owner, id: unknown): string | null {
  if (!tradeOn(s)) return 'No trade in this battle';
  return routesOf(s, owner).some(r => r.id === id) ? null : 'No such route';
}

/** Closes a route; its convoy is left where it stands, an ordinary Supply Truck again. */
export function doUnroute(s: GameState, id: number): void {
  const r = s.grand!.routes!.find(x => x.id === id)!;
  s.grand = { ...s.grand!, routes: s.grand!.routes!.filter(x => x.id !== id) };
  const u = s.units.find(x => x.id === r.convoy);
  if (u?.convoy) delete u.convoy;
}

/** A convoy sets out from the route's first city (the route is a fresh copy in s.grand.routes). */
function launch(s: GameState, r: TradeRoute): void {
  const a = endOf(s, r.from);
  if (!a) return;
  const occ = occupancy(s);
  const k = nearestPassable(s, occ, a.at.x, a.at.y + 2.5);
  if (k < 0) return;
  const u = addUnit(s, r.owner, 'supplytruck', (k % s.mapW) + 0.5, ((k / s.mapW) | 0) + 0.5);
  u.convoy = { route: r.id, leg: 0 };
  setRoute(s, { ...r, convoy: u.id });
  head(s, u);
}

function setRoute(s: GameState, r: TradeRoute): void {
  s.grand = { ...s.grand!, routes: s.grand!.routes!.map(x => (x.id === r.id ? r : x)) };
}

/** Sends a convoy to the end its leg names. */
function head(s: GameState, u: Unit): void {
  const r = s.grand!.routes!.find(x => x.id === u.convoy!.route);
  const end = r ? endOf(s, u.convoy!.leg === 0 ? r.to : r.from) : null;
  if (end) doMove(s, u.owner, [u.id], end.at.x, end.at.y, false);
}

/** Every route, every half second: closed when an end is lost, a convoy replaced, a convoy paid on arrival. */
export function tradeStep(s: GameState): void {
  if (!tradeOn(s) || s.tick % 5 !== 0 || !s.grand!.routes!.length) return;
  const units = new Map(s.units.map(u => [u.id, u]));
  for (const r0 of s.grand!.routes!.slice()) {
    let r = r0;
    const a = endOf(s, r.from);
    const b = endOf(s, r.to);
    if (!a || a.owner !== r.owner || !b || !partners(s, r.owner, b.owner)) {
      doUnroute(s, r.id);
      if (r.owner === 0) log(s, 'A trade route has closed: one of its cities is lost, or the partner no longer trades with us.', 'bad');
      continue;
    }
    const u = r.convoy ? units.get(r.convoy) : undefined;
    if (!u || u.hp <= 0 || u.convoy?.route !== r.id) {
      if (r.convoy) {
        r = { ...r, convoy: 0, wait: s.tick + CONVOY_RESPAWN };
        setRoute(s, r);
        if (r.owner === 0) log(s, 'A convoy has been lost.', 'bad');
      }
      if (s.tick >= r.wait && s.players[r.owner].credits >= CONVOY_COST) {
        s.players[r.owner].credits -= CONVOY_COST;
        launch(s, r);
      }
      continue;
    }
    if (u.order.type !== 'idle') continue;
    const end = u.convoy!.leg === 0 ? b : a;
    if (dist(u.x, u.y, end.at.x, end.at.y) <= TRADE_REACH) {
      if (u.convoy!.leg === 0) {
        const v = tripValue(s, r);
        const p = s.players[r.owner];
        p.credits += v.credits;
        if (v.food && p.food !== undefined) p.food = Math.min(foodStore(s, r.owner), p.food + v.food);
        if (v.partner && b.owner !== r.owner) s.players[b.owner].credits += v.partner;
        setRoute(s, { ...r, trips: r.trips + 1, paid: r.paid + v.credits });
        u.convoy = { route: r.id, leg: 1 };
      } else u.convoy = { route: r.id, leg: 0 };
    }
    head(s, u);
  }
}

/** A side's trade, repaired for a save: routes kept only when sound; convoys keep their route only while it stands. */
export function migrateTrade(s: GameState): void {
  const g = s.grand;
  if (!g) return;
  const want = !!s.setup?.grand?.trade;
  if (!want) {
    if (g.routes !== undefined) {
      const { routes: _r, ...rest } = g;
      s.grand = rest;
    }
  } else {
    const ids = new Set<number>();
    const routes = Array.isArray(g.routes)
      ? g.routes.filter(r => {
          const ok =
            r &&
            typeof r === 'object' &&
            [r.id, r.from, r.to, r.convoy, r.wait, r.trips, r.paid].every(Number.isInteger) &&
            sidesOf(s).includes(r.owner) &&
            !ids.has(r.id) &&
            r.trips >= 0 &&
            r.paid >= 0;
          if (ok) ids.add(r.id);
          return ok;
        })
      : [];
    s.grand = { ...g, routes };
  }
  const live = new Set((s.grand?.routes ?? []).map(r => r.id));
  s.units = s.units.map(u => {
    if (!u || typeof u !== 'object' || !('convoy' in u)) return u;
    const c = u.convoy as Unit['convoy'];
    if (u.kind === 'supplytruck' && c && typeof c === 'object' && live.has(c.route) && (c.leg === 0 || c.leg === 1)) return { ...u, convoy: { route: c.route, leg: c.leg } };
    const { convoy: _c, ...rest } = u;
    return rest as Unit;
  });
}

/** A new Grand War with trade: no routes yet. */
export function startTrade(s: GameState): void {
  if (s.setup?.grand?.trade && s.grand) s.grand = { ...s.grand, routes: [] };
}
