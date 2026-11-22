// round7:planet. War for the Planet, battle rules 3 (fireline-round7-planet.md): the engine side of
// the links between the war and its battles. Support powers from neighbouring regions, kept without
// their structure and spent by use when limited; reinforcement waves that march in partway through.
// Every function here is a no-op without the matching `s.planet` field, which only a battle of a war
// on battle rules 3 has, so every skirmish, mission and older planet battle runs exactly as before.
//
// Pure: no clock, no unseeded dice.

import { fitModules } from './loadout';
import { placeUnits, startCentre, toward } from './mission';
import { upgradeNewUnit } from './research';
import { POWERS, UNITS, type Owner, type SupportPower, type UnitKind } from './rules';
import { log } from './state';
import type { GameState, PlanetBattle } from './types';

/** How far in front of its Command Yard a wave musters, in tiles (as the battle's own troops). */
const WAVE_MUSTER = 4;

/** True when a planet battle keeps this power for this seat without its structure. */
export function supportHeld(s: GameState, owner: Owner, power: SupportPower): boolean {
  return !!s.planet?.support?.some(x => x.seat === owner && x.power === power);
}

/**
 * After `owner` calls `power` (doPower has set its cooldown): a limited support power loses a use,
 * and with its last one the power goes unless a structure of the side still gives it. Works in
 * place on a cloned state; replaces arrays rather than editing them, since cloneState shares them.
 */
export function spendSupport(s: GameState, owner: Owner, power: SupportPower): void {
  const p = s.planet;
  if (!p?.support) return;
  const k = p.support.findIndex(x => x.seat === owner && x.power === power && x.uses !== undefined);
  if (k < 0) return;
  const g = p.support[k];
  const left = (g.uses ?? 1) - 1;
  if (left > 0) {
    p.support = p.support.map((x, i) => (i === k ? { ...x, uses: left } : x));
    return;
  }
  p.support = p.support.filter((_, i) => i !== k);
  // The structure rule (syncSkirmishPowers) grants it again if a structure still gives it.
  if (s.powers?.[owner]?.[power] !== undefined) {
    const powers = s.powers.slice();
    const side = { ...powers[owner] };
    delete side[power];
    powers[owner] = side;
    s.powers = powers;
  }
}

/** Grants each seat its support powers at the start, charging (half the cooldown); a power already held stays as it is. */
export function grantSupport(s: GameState, support: NonNullable<PlanetBattle['support']>): void {
  if (!support.length) return;
  const powers: NonNullable<GameState['powers']> = s.powers ? s.powers.slice() : s.players.map(() => ({}));
  for (const g of support) {
    if (!(g.power in POWERS) || !s.players[g.seat]) continue;
    if (powers[g.seat]?.[g.power] !== undefined) continue;
    powers[g.seat] = { ...powers[g.seat], [g.power]: Math.round(POWERS[g.power].cooldown / 2) };
  }
  s.powers = powers;
}

/** Each tick: a wave whose time has come musters in front of its seat's Command Yard. */
export function planetReinforce(s: GameState): void {
  const p = s.planet;
  if (!p?.reinforce?.length) return;
  if (!p.reinforce.some(w => s.tick >= w.at)) return;
  const centre = { x: s.mapW / 2, y: s.mapH / 2 };
  const due = p.reinforce.filter(w => s.tick >= w.at);
  p.reinforce = p.reinforce.filter(w => s.tick < w.at);
  for (const w of due) {
    const owner = w.seat;
    if (!s.players[owner]) continue;
    // A side whose Command Yard is gone has nowhere to send them.
    if (!s.buildings.some(b => b.owner === owner && b.kind === 'hq' && b.hp > 0)) continue;
    const muster = toward(startCentre(s, owner), centre, WAVE_MUSTER);
    const kinds = w.units.filter((k): k is UnitKind => k in UNITS);
    const placed = placeUnits(s, owner, kinds, muster.x, muster.y);
    const loadouts = s.players[owner].loadouts;
    for (const u of placed) {
      upgradeNewUnit(s, u);
      if (UNITS[u.kind].category === 'vehicle') fitModules(u, loadouts?.[u.kind]);
    }
    if (owner === 0 && placed.length) log(s, `Reinforcements from the garrison arrive: ${placed.length} unit${placed.length === 1 ? '' : 's'}.`, 'good');
  }
}

/** A planet battle's round 7 fields from a save, well formed or left out. */
export function migratePlanetLinks(raw: Partial<PlanetBattle>, out: PlanetBattle, n: number): void {
  const seatOk = (v: unknown): v is Owner => Number.isInteger(v) && (v as number) >= 0 && (v as number) < n;
  if (Array.isArray(raw.support)) {
    out.support = raw.support
      .filter(g => !!g && typeof g === 'object' && seatOk(g.seat) && typeof g.power === 'string' && g.power in POWERS && (g.uses === undefined || (Number.isInteger(g.uses) && g.uses > 0)))
      .map(g => ({ seat: g.seat, power: g.power, ...(g.uses !== undefined ? { uses: g.uses } : {}) }));
  }
  if (Array.isArray(raw.reinforce)) {
    out.reinforce = raw.reinforce
      .filter(w => !!w && typeof w === 'object' && seatOk(w.seat) && Number.isInteger(w.at) && Array.isArray(w.units) && w.units.every(k => typeof k === 'string' && k in UNITS))
      .map(w => ({ seat: w.seat, at: w.at, units: w.units.slice() }));
  }
}
