/**
 * War for the Planet: field armies, garrisons and regions changing hands
 * (fireline-planet-design.md, sections 6.3, 6.5 and 9.6). W1. Every function here edits a draft
 * state in place; the reducer in turn.ts owns the draft. Pure.
 */
import { cutBack } from './cities';
import { garrisonCap } from './economy';
import { note } from './journal';
import { planetMapOf } from './map';
import { isInfantry, isVehicle } from './rules';
import { allied, garrisonTotal, kindIndex } from './state';
import { nearestOwned } from './supply';
import { pruneRoutes } from './trade';
import { ARMY_KINDS, NEUTRAL, type ArmyKind, type FactionId, type PlanetState, type RegionId, type RegionOwner } from './types';

/** The new capital after f loses its old one: highest city level, then larger garrison, then lowest id. */
export function pickCapital(d: PlanetState, f: FactionId): RegionId | null {
  let best: RegionId | null = null;
  d.regions.forEach((r, i) => {
    if (r.owner !== f) return;
    if (best === null) {
      best = i;
      return;
    }
    const b = d.regions[best];
    if (r.city.level > b.city.level || (r.city.level === b.city.level && garrisonTotal(r.garrison) > garrisonTotal(b.garrison))) best = i;
  });
  return best;
}

/**
 * Moves a beaten field army to the nearest region its faction owns; with none, the army is
 * destroyed and rebuilds at the capital (section 9.6).
 */
export function retreatArmy(d: PlanetState, f: FactionId): void {
  const fac = d.factions[f];
  const army = fac?.army;
  if (!army) return;
  if (d.regions[army.region]?.owner === f) return;
  const to = nearestOwned(d, f, army.region);
  if (to === null) {
    army.units = [];
    army.region = fac.capital;
    note(d, `The ${fac.name} field army is cut off and destroyed.`, 'bad', f);
  } else {
    army.region = to;
    note(d, `The ${fac.name} field army falls back to ${planetMapOf(d).regions[to].city}.`, f === 0 ? 'bad' : 'info', f);
  }
}

/**
 * Region r passes to `to`: routes touching it are removed, the old owner picks a new capital if
 * it was the capital, a field army of anyone else standing there retreats. The garrison and city
 * are the caller's business.
 */
export function transferRegion(d: PlanetState, r: RegionId, to: RegionOwner): void {
  const reg = d.regions[r];
  const from = reg.owner;
  reg.owner = to;
  reg.cut = 0;
  d.routes = d.routes.filter(x => x.from !== r && x.to !== r);
  pruneRoutes(d);
  if (from !== NEUTRAL && d.factions[from].capital === r) {
    const cap = pickCapital(d, from);
    if (cap !== null) {
      d.factions[from].capital = cap;
      note(d, `${d.factions[from].name} moves its capital to ${planetMapOf(d).regions[cap].city}.`, from === 0 ? 'bad' : 'info', from);
    }
  }
  for (const f of d.factions) if (f.alive && f.id !== to && !allied(d, f.id, to) && f.army && f.army.region === r) retreatArmy(d, f.id);
}

/** Trims a garrison to its region's cap, dropping from the last kind. */
export function capGarrison(d: PlanetState, r: RegionId): void {
  const g = d.regions[r].garrison;
  let over = garrisonTotal(g) - garrisonCap(d, r);
  for (let i = g.length - 1; i >= 0 && over > 0; i--) {
    const n = Math.min(g[i], over);
    g[i] -= n;
    over -= n;
  }
}

/** Adds units of these kinds to a garrison, up to its cap. */
export function addToGarrison(d: PlanetState, r: RegionId, kinds: ArmyKind[]): void {
  const g = d.regions[r].garrison;
  for (const k of kinds) g[kindIndex(k)]++;
  capGarrison(d, r);
}

/** After a city shrinks, the cut-back and the garrison cap. */
export function settleCity(d: PlanetState, r: RegionId): void {
  cutBack(d.regions[r].city);
  capGarrison(d, r);
}

/**
 * Disbands one unit of f for an upkeep shortfall (section 6.6, step 5). `res` food takes
 * garrison infantry first (the region with most units), then the army's last infantry; fuel takes
 * the army's last vehicle, then garrison vehicles. Returns false when nothing could be disbanded.
 */
export function disbandForShortfall(d: PlanetState, f: FactionId, res: 'food' | 'fuel'): boolean {
  const army = d.factions[f].army;
  const fromGarrison = (want: (k: ArmyKind) => boolean): boolean => {
    let best = -1;
    let most = 0;
    d.regions.forEach((r, i) => {
      if (r.owner !== f) return;
      const n = r.garrison.reduce((t, x, k) => t + (want(ARMY_KINDS[k]) ? x : 0), 0);
      if (n > most) {
        most = n;
        best = i;
      }
    });
    if (best < 0) return false;
    const g = d.regions[best].garrison;
    for (let k = g.length - 1; k >= 0; k--) if (g[k] > 0 && want(ARMY_KINDS[k])) {
      g[k]--;
      return true;
    }
    return false;
  };
  const fromArmy = (want: (k: ArmyKind) => boolean): boolean => {
    if (!army) return false;
    for (let i = army.units.length - 1; i >= 0; i--) if (want(army.units[i].kind)) {
      army.units.splice(i, 1);
      return true;
    }
    return false;
  };
  if (res === 'food') return fromGarrison(isInfantry) || fromArmy(isInfantry) || fromGarrison(() => true);
  return fromArmy(isVehicle) || fromGarrison(isVehicle);
}
