/**
 * War for the Planet: eliminations, victory and defeat (fireline-planet-design.md, section 11).
 * W1. Pure; the end-turn step edits its own draft.
 */
import { note } from './journal';
import { allied, regionsOf } from './state';
import type { FactionId, PlanetResult, PlanetState } from './types';

/** Share of all regions f holds, 0..1. */
export function regionShare(s: PlanetState, f: FactionId): number {
  return s.regions.length ? regionsOf(s, f).length / s.regions.length : 0;
}

const atShare = (s: PlanetState, n: number): boolean => (100 * n) / s.regions.length >= s.options.victoryShare;

/** Factions with no regions are eliminated: alive false, army null, treaties, routes and offers removed. */
export function eliminate(d: PlanetState): void {
  for (const f of d.factions) {
    if (!f.alive || regionsOf(d, f.id).length) continue;
    f.alive = false;
    f.army = null;
    d.treaties = d.treaties.filter(t => t.a !== f.id && t.b !== f.id);
    d.routes = d.routes.filter(r => r.owner !== f.id && d.regions[r.to].owner !== f.id);
    d.offers = d.offers.filter(o => o.from !== f.id);
    note(d, f.id === 0 ? 'The Meridian Corps holds no region. The war is lost.' : `${f.name} is wiped from the map.`, f.id === 0 ? 'bad' : 'good', f.id);
  }
}

/** The result of the war after this turn's production, or null while it goes on (section 11, steps 2 to 7). */
export function victoryCheck(s: PlanetState): PlanetResult | null {
  const turn = s.turn;
  if (!s.factions[0].alive) return { won: false, how: 'fallen', turn };
  const ai = s.factions.filter(f => f.id !== 0);
  if (ai.some(f => f.alive && atShare(s, regionsOf(s, f.id).length))) return { won: false, how: 'rival', turn };
  const mine = regionsOf(s, 0).length;
  if (atShare(s, mine)) return { won: true, how: 'domination', turn };
  if (ai.every(f => !f.alive)) return { won: true, how: 'elimination', turn };
  const aliveAi = ai.filter(f => f.alive);
  if (s.options.alliedVictory && aliveAi.length && aliveAi.every(f => allied(s, 0, f.id))) {
    const counts = aliveAi.map(f => regionsOf(s, f.id).length);
    if (atShare(s, mine + counts.reduce((t, n) => t + n, 0)) && counts.every(n => mine > n)) return { won: true, how: 'alliance', turn };
  }
  if (turn >= s.options.turnLimit) {
    const best = Math.max(0, ...ai.map(f => regionsOf(s, f.id).length));
    return { won: mine > best, how: 'turnLimit', turn };
  }
  return null;
}
