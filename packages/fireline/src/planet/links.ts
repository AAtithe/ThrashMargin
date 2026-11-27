/**
 * War for the Planet, battle rules 3 (round 7, fireline-round7-planet.md): the links between the
 * war and its battles, both ways. What the war brings into a battle is decided here and frozen into
 * the setup's `links`; what the battle sends back is read from the report's `links` by turn.ts.
 * Every function here is pure and reads only the planet state; none of it runs on an older war.
 */
import { UNITS, type BuildingKind, type SupportPower } from '../sim/rules';
import { hopsFrom, planetMapOf } from './map';
import {
  DECISIVE_LOSS,
  REINFORCE_AT,
  REINFORCE_MAX,
  REINFORCE_VALUE,
  SHAKEN_SHARE,
  SUPPLY_EFFECT,
  SUPPLY_SHORT_STOCK,
  SUPPORT_ARTILLERY_MAX,
  SUPPORT_FORT_MK,
  SUPPORT_HOPS,
  SUPPORT_INSTITUTE_MK,
  SUPPORT_VALUE,
  TIME_BASE,
  TIME_PER_LEVEL,
  WALLS_PER_FORT_MK,
  isVehicle,
  unitValue,
  vetMul,
} from './rules';
import { garrisonTotal, kindIndex } from './state';
import { hasPort, suppliedRegions } from './supply';
import {
  ARMY_KINDS,
  NEUTRAL,
  type ArmyKind,
  type BattleSetup,
  type BattleUnit,
  type FactionId,
  type PlanetState,
  type RegionId,
  type RegionOwner,
  type Stock,
  type SupplyState,
  type SupportGrant,
} from './types';

/** True on a war whose battles are built to rules 3. */
export const linksOn = (s: Pick<PlanetState, 'battleRules'>): boolean => s.battleRules === 3 || s.battleRules === 4;
/** Battle rules 4 (2026-11-27): neutral sites in the war's battles. */
export const sitesOn = (s: Pick<PlanetState, 'battleRules'>): boolean => s.battleRules === 4;

// ---- Link 1: supply and logistics ---------------------------------------------------------------

/**
 * The supply of f's army attacking from `from`, once `cost` is paid: cut when `from` is cut off
 * from the capital; short when fuel or food left would fall below SUPPLY_SHORT_STOCK; depot when
 * supplied with a port at `from`, or `from` is the capital, or a supplied region of f linked to
 * `from` is the capital or has a port; otherwise supplied.
 */
export function supplyOf(s: PlanetState, f: FactionId, from: RegionId, cost: Stock): SupplyState {
  const sup = suppliedRegions(s, f);
  if (!sup[from]) return 'cut';
  const st = s.factions[f].stock;
  if (st.fuel - cost.fuel < SUPPLY_SHORT_STOCK || st.food - cost.food < SUPPLY_SHORT_STOCK) return 'short';
  const cap = s.factions[f].capital;
  if (from === cap || hasPort(s, from)) return 'depot';
  for (const l of planetMapOf(s).regions[from].links) if (s.regions[l.to].owner === f && sup[l.to] && (l.to === cap || hasPort(s, l.to))) return 'depot';
  return 'supplied';
}

/** The reinforcement wave a depot sends: the staging garrison's most valuable units, at most half of it and REINFORCE_MAX. */
export function reinforceWave(s: PlanetState, from: RegionId, timeLimit: number): { at: number; units: ArmyKind[] } | null {
  const g = s.regions[from].garrison;
  const n = Math.min(REINFORCE_MAX, Math.floor(garrisonTotal(g) / 2));
  if (n < 1) return null;
  const order = ARMY_KINDS.map((k, i) => ({ k, i })).sort((a, b) => unitValue(b.k) - unitValue(a.k) || a.i - b.i);
  const units: ArmyKind[] = [];
  for (const { k, i } of order) for (let j = 0; j < g[i] && units.length < n; j++) units.push(k);
  return { at: Math.max(1, Math.round(timeLimit * REINFORCE_AT)), units };
}

// ---- Link 2: support from neighbouring regions ------------------------------------------------

/** Structures that already give a side a power in battle (SKIRMISH_POWERS): no support needed for it. */
const POWER_STRUCTURE: Record<'recon' | 'barrage' | 'missile', BuildingKind> = { recon: 'uplink', barrage: 'techcentre', missile: 'strikecommand' };

/**
 * The support f's regions near `target` give the side at `seat` (never the target itself): the
 * recon sweep from an institute of Mk 2 or more within 2 hops; the barrage from fortifications of
 * Mk 3 within 2 hops, or else one barrage per artillery piece (at most 3) in f's garrisons next to
 * the target; an air strike per Mk of the best airfield within 2 hops. A power the side's own
 * structures already give is left out. Each grant names the lowest region id that gives it.
 */
export function supportFor(s: PlanetState, f: FactionId, target: RegionId, seat: number, structures: BuildingKind[]): SupportGrant[] {
  const m = planetMapOf(s);
  const d = hopsFrom(m, [target]);
  const near = s.regions.flatMap((r, i) => (r.owner === f && i !== target && d[i] <= SUPPORT_HOPS ? [i] : []));
  const out: SupportGrant[] = [];
  const has = (p: 'recon' | 'barrage' | 'missile') => structures.includes(POWER_STRUCTURE[p]);
  const inst = near.find(i => (s.regions[i].city.b.institute ?? 0) >= SUPPORT_INSTITUTE_MK);
  if (inst !== undefined && !has('recon')) out.push({ seat, power: 'recon', from: inst, why: 'institute' });
  if (!has('barrage')) {
    const fort = near.find(i => (s.regions[i].city.b.fortifications ?? 0) >= SUPPORT_FORT_MK);
    if (fort !== undefined) out.push({ seat, power: 'barrage', from: fort, why: 'fortifications' });
    else {
      const art = kindIndex('artillery');
      const adj = near.filter(i => d[i] === 1 && s.regions[i].garrison[art] > 0);
      const guns = adj.reduce((t, i) => t + s.regions[i].garrison[art], 0);
      if (adj.length) out.push({ seat, power: 'barrage', uses: Math.min(SUPPORT_ARTILLERY_MAX, guns), from: adj[0], why: 'artillery' });
    }
  }
  if (!has('missile')) {
    let best = -1;
    let mk = 0;
    for (const i of near) {
      const a = s.regions[i].city.b.airfield ?? 0;
      if (a > mk) {
        mk = a;
        best = i;
      }
    }
    if (best >= 0) out.push({ seat, power: 'missile', uses: mk, from: best, why: 'airfield' });
  }
  return out;
}

export const SUPPORT_NAMES: Record<SupportGrant['power'], string> = { recon: 'Recon sweep', barrage: 'Artillery barrage', missile: 'Air strike' };
export const isSupportPower = (p: unknown): p is SupportGrant['power'] => p === 'recon' || p === 'barrage' || p === 'missile';
export const supportPowerOf = (g: SupportGrant): SupportPower => g.power;

// ---- Link 3: terrain and city ------------------------------------------------------------------

/** The battle's time limit: battleMinutes scaled by the city's level (a bigger city takes longer to storm). */
export function timeLimitFor(base: number, cityLevel: number): number {
  return Math.max(1, Math.round(base * (TIME_BASE + TIME_PER_LEVEL * cityLevel)));
}

/** Sandbag walls the defender's fortifications put in front of its city. */
export const wallsFor = (fortMk: number): number => WALLS_PER_FORT_MK * Math.max(0, fortMk);

/** A shaken garrison's units in battle: the first SHAKEN_SHARE of them (rounded down). */
export function shakenUnits<T>(units: T[]): T[] {
  return units.slice(0, Math.floor(units.length * SHAKEN_SHARE));
}

export const isShaken = (s: PlanetState, r: RegionId): boolean => (s.regions[r]?.shaken ?? -1) >= s.turn;

// ---- Link 4: the attacker's base reflects its region --------------------------------------------

/**
 * The attacker principal's structures: hq, two power plants and barracks always; a refinery for a
 * refinery district in the staging region (two at Mk 3); a War Factory for a factory there (and a
 * repair bay from Mk 2); a helipad as before for an airfield within 2 hops (the caller adds it).
 */
export function attackerBase(s: PlanetState, from: RegionId): BuildingKind[] {
  const b = s.regions[from].city.b;
  const out: BuildingKind[] = ['hq', 'power', 'power', 'barracks'];
  const ref = b.refinery ?? 0;
  if (ref >= 1) out.push('refinery');
  if (ref >= 3) out.push('refinery');
  const fac = b.factory ?? 0;
  if (fac >= 1) out.push('factory');
  if (fac >= 2) out.push('repairbay');
  return out;
}

/** A unit's health on arrival: wounded vehicles at WOUNDED_HP, vehicles of a cut-off army at its supply's share. */
export function arrivalHp(u: { kind: ArmyKind; w?: 1 }, supplyHp: number, woundedHp: number): number | undefined {
  if (!isVehicle(u.kind)) return undefined;
  const hp = Math.min(supplyHp, u.w ? woundedHp : 100);
  return hp < 100 ? hp : undefined;
}

// ---- Battle into war --------------------------------------------------------------------------

/** Strength of a list of battle units, by value and rank (as strengthOf, without wounds). */
const valueOf = (units: { kind: ArmyKind; kills: number }[]): number => units.reduce((t, u) => t + unitValue(u.kind) * vetMul(u.kills), 0);

/**
 * The share of its army value a side lost, 0..1: what it brought (its units and, for the attacker,
 * a wave that arrived) against what survived.
 */
export function lossShare(setup: BattleSetup, seat: number, survivors: BattleUnit[], waveArrived: boolean): number {
  const side = setup.sides[seat];
  let brought = valueOf(side.units);
  if (waveArrived && side.role === 'attacker' && setup.links?.reinforce) brought += valueOf(setup.links.reinforce.units.map(k => ({ kind: k, kills: 0 })));
  if (brought <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - valueOf(survivors) / brought));
}

export const isDecisive = (share: number): boolean => share > DECISIVE_LOSS;

/** The other regions owned by `owner` linked to r. */
export function ownedNeighbours(s: PlanetState, owner: RegionOwner, r: RegionId): RegionId[] {
  if (owner === NEUTRAL) return [];
  return planetMapOf(s).regions[r].links.map(l => l.to).filter(i => s.regions[i].owner === owner);
}

/** Effective credits a supply leaves. */
export const suppliedCredits = (credits: number, supply: SupplyState): number => Math.round(credits * SUPPLY_EFFECT[supply].credits);

/** Unit cost in credits (for the setup card's wave value). */
export const unitCost = (k: ArmyKind): number => UNITS[k].cost;

// ---- Link 11: how the computer factions weigh an attack ------------------------------------------

/**
 * What attacking `target` from `from` is worth to f's army beyond its own strength: the share of
 * its credits the supply leaves, and the strength its neighbours' support and a depot's wave add
 * (as the auto-resolve counts them). Reads the state only; the AI's budget is the caller's business.
 */
export function attackEdge(s: PlanetState, f: FactionId, from: RegionId, target: RegionId, cost: Stock): { supply: SupplyState; creditShare: number; bonus: number } {
  const supply = supplyOf(s, f, from, cost);
  let bonus = 0;
  for (const g of supportFor(s, f, target, 0, [])) bonus += g.uses === undefined ? SUPPORT_VALUE[g.power].unlimited : SUPPORT_VALUE[g.power].perUse * g.uses;
  if (supply === 'depot') {
    const w = reinforceWave(s, from, 1);
    if (w) for (const k of w.units) bonus += unitValue(k) * REINFORCE_VALUE;
  }
  return { supply, creditShare: SUPPLY_EFFECT[supply].credits, bonus };
}
