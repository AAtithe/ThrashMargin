/**
 * Supply lines (2026-11-21, `setup.supply` with `setup.industry`; phase 2 of the economy,
 * fireline-design.md). Pure, like the rest of src/sim/: geometry over the structures standing.
 *
 * - Roots: a side's Command Yard and Field Yards. Hubs: the roots and its Depots.
 * - Two hubs of a side link when their centres are within SUPPLY_LINK_RANGE. A hub is linked when
 *   a chain of links reaches it from a root.
 * - A producer (Refinery, Fuel Well, Foundry) is supplied when its centre is within
 *   SUPPLY_SERVE_RANGE of a linked hub.
 * - Cut off, a Refinery keeps what its haulers unload on site (up to REFINERY_HOLD; then they wait),
 *   a Fuel Well keeps what it pumps (up to WELL_HOLD; then it stops), and a Foundry stops. Supplied
 *   again, what is held goes home at a fixed rate. A structure destroyed with goods on site loses them.
 *
 * Imports rules.ts, industry.ts and types only, so state.ts and tick.ts can use it without a cycle.
 */
import { industryOn } from './industry';
import {
  BUILDINGS,
  SUPPLY_FLOW_CREDITS,
  SUPPLY_FLOW_GOODS,
  SUPPLY_LINK_RANGE,
  SUPPLY_SERVE_RANGE,
  SUPPLY_TICKS,
  RELAY_LINK_BONUS,
  RELAY_SERVE_BONUS,
  type BuildingKind,
  type Owner,
} from './rules';
import type { Building, GameState } from './types';

/** True in a skirmish with industry and supply lines on. */
export const supplyOn = (s: GameState): boolean => industryOn(s) && s.setup?.supply === true;

const HUBS: BuildingKind[] = ['hq', 'fieldyard', 'depot'];
const ROOTS: BuildingKind[] = ['hq', 'fieldyard'];
/** The structures that need supply to deliver. */
export const PRODUCERS: BuildingKind[] = ['refinery', 'fuelwell', 'foundry'];
export const isProducer = (k: BuildingKind): boolean => PRODUCERS.includes(k);
export const isHub = (k: BuildingKind): boolean => HUBS.includes(k);

/** A structure's centre, in tiles. */
export function centreOf(b: Pick<Building, 'kind' | 'x' | 'y'>): { x: number; y: number } {
  const spec = BUILDINGS[b.kind];
  return { x: b.x + spec.w / 2, y: b.y + spec.h / 2 };
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }, r: number): boolean => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= r * r;

/** Advanced production's Long relays: this side's link and serve ranges. */
const relays = (s: GameState, owner: Owner): boolean => s.setup?.production === true && s.setup.territory === true && !!s.players[owner]?.projects?.includes('relays');
export const linkRangeOf = (s: GameState, owner: Owner): number => SUPPLY_LINK_RANGE + (relays(s, owner) ? RELAY_LINK_BONUS : 0);
export const serveRangeOf = (s: GameState, owner: Owner): number => SUPPLY_SERVE_RANGE + (relays(s, owner) ? RELAY_SERVE_BONUS : 0);

/** This side's linked hubs: every hub a chain of links reaches from one of its yards. Lowest id first. */
export function linkedHubs(s: GameState, owner: Owner): Building[] {
  const link = linkRangeOf(s, owner);
  const hubs = s.buildings.filter(b => b.owner === owner && b.hp > 0 && isHub(b.kind)).sort((a, b) => a.id - b.id);
  const linked = hubs.filter(b => ROOTS.includes(b.kind));
  const seen = new Set(linked.map(b => b.id));
  for (let i = 0; i < linked.length; i++) {
    const c = centreOf(linked[i]);
    for (const h of hubs) {
      if (seen.has(h.id) || !near(c, centreOf(h), link)) continue;
      seen.add(h.id);
      linked.push(h);
    }
  }
  return linked.sort((a, b) => a.id - b.id);
}

/** True when a point is within SUPPLY_SERVE_RANGE of one of these hubs. */
export const servedBy = (hubs: Building[], p: { x: number; y: number }, range = SUPPLY_SERVE_RANGE): boolean => hubs.some(h => near(centreOf(h), p, range));

/** True when this structure can deliver: always without supply lines; with them, near a linked hub. */
export function supplied(s: GameState, b: Building): boolean {
  if (!supplyOn(s) || !isProducer(b.kind)) return true;
  return servedBy(linkedHubs(s, b.owner), centreOf(b), serveRangeOf(s, b.owner));
}

/** The ids of this side's producers that are cut off (empty without supply lines). */
export function cutOff(s: GameState, owner: Owner): Building[] {
  if (!supplyOn(s)) return [];
  const hubs = linkedHubs(s, owner);
  const range = serveRangeOf(s, owner);
  return s.buildings.filter(b => b.owner === owner && b.hp > 0 && isProducer(b.kind) && !servedBy(hubs, centreOf(b), range));
}

/** Every SUPPLY_TICKS: each supplied Refinery and Fuel Well sends home up to its flow of what it holds. */
export function supplyStep(s: GameState): void {
  if (!supplyOn(s) || s.tick % SUPPLY_TICKS !== 0) return;
  const hubsOf = new Map<Owner, Building[]>();
  for (const b of s.buildings) {
    if (!b.held || b.hp <= 0) continue;
    let hubs = hubsOf.get(b.owner);
    if (!hubs) hubsOf.set(b.owner, (hubs = linkedHubs(s, b.owner)));
    if (!servedBy(hubs, centreOf(b), serveRangeOf(s, b.owner))) continue;
    const p = s.players[b.owner];
    if (!p) continue;
    const flow = Math.min(b.held, b.kind === 'refinery' ? SUPPLY_FLOW_CREDITS : SUPPLY_FLOW_GOODS);
    if (b.kind === 'refinery') p.credits += flow;
    else if (b.kind === 'fuelwell') p.fuel = (p.fuel ?? 0) + flow;
    b.held -= flow;
    if (b.held <= 0) delete b.held;
  }
}
