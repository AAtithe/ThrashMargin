// Auto-resolve for War for the Planet (fireline-planet-design.md, sections 9.4 and 9.5). W2.
//
// Pure: no unseeded dice, no clock. The only dice are a stream seeded from the setup's own seed
// text, so the same setup always resolves the same way. Imports only src/planet/types.ts,
// src/planet/rules.ts, src/sim/rng.ts and src/sim/rules.ts (section 13).

import { seedFromString, stream } from '../sim/rng';
import { heroLevelFor } from '../sim/rules';
import { DEFENCE_TERRAIN, QUICK_DIFFICULTY, STRUCTURE_VALUE, unitValue, vetMul } from './rules';
import type { BattleReport, BattleSetup, BattleUnit, CityBuildingId } from './types';

/** Strength each hero level is worth. */
const HERO_LEVEL_VALUE = 6;
/** Credits worth one point of strength. */
const CREDITS_PER_POINT = 200;
/** Strength added per upgrade researched, as a share. */
const UPGRADE_SHARE = 0.03;
/** Most survivors a report carries per side. */
const SURVIVORS_MAX = 60;

/**
 * One side's strength: units by value and rank, heroes by level, credits, structures, raised by its
 * research and, for a computer side in a battle with a human side, by the difficulty.
 */
export function sideStrength(setup: BattleSetup, seat: number): number {
  const side = setup.sides[seat];
  if (!side) return 0;
  let v = 0;
  for (const u of side.units) v += unitValue(u.kind) * vetMul(u.kills);
  for (const h of side.heroes) v += HERO_LEVEL_VALUE * heroLevelFor(Math.max(0, h.xp));
  v += Math.max(0, side.credits) / CREDITS_PER_POINT;
  for (const b of side.structures) v += STRUCTURE_VALUE[b] ?? 1;
  const anyHuman = setup.sides.some(x => x.human);
  const diff = anyHuman && !side.human ? QUICK_DIFFICULTY[setup.difficulty] ?? 1 : 1;
  return v * (1 + UPGRADE_SHARE * side.upgrades.length) * diff;
}

/** Team strengths: A the attacking coalition (team 0), D the defending one (team 1) with its terrain. */
function teamStrengths(setup: BattleSetup): { A: number; D: number } {
  let A = 0;
  let D = 0;
  setup.sides.forEach((x, i) => {
    if (x.team === 0) A += sideStrength(setup, i);
    else D += sideStrength(setup, i);
  });
  return { A, D: D * (DEFENCE_TERRAIN[setup.mapType] ?? 1) };
}

/** The attackers' chance of winning an auto-resolve: A^2 / (A^2 + D^2). */
export function attackOdds(setup: BattleSetup): number {
  const { A, D } = teamStrengths(setup);
  const a2 = A * A;
  const d2 = D * D;
  return a2 + d2 > 0 ? a2 / (a2 + d2) : 0.5;
}

/** The instant auto-resolve (section 9.5). */
export function quickResolve(setup: BattleSetup): BattleReport {
  const rng = stream(seedFromString(setup.seedText + ':quick'));
  const { A, D } = teamStrengths(setup);
  const p = attackOdds(setup);
  const attackersWon = rng.float() < p;
  const hi = Math.max(A, D);
  const q = hi > 0 ? Math.min(A, D) / hi : 1;
  const winTeam = attackersWon ? 0 : 1;
  const lossShare = (team: number) => (team === winTeam ? 0.1 + 0.4 * q : 0.55 + 0.35 * q);

  // Losses, side by side in seat order: a seeded shuffle of the unit indices, the first ones lost.
  const lostBy = setup.sides.map(side => {
    const share = lossShare(side.team);
    const idx = side.units.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      const t = idx[i];
      idx[i] = idx[j];
      idx[j] = t;
    }
    const lost = new Set(idx.slice(0, Math.round(share * side.units.length)));
    const gain = side.team === winTeam ? 40 : 10;
    const heroes = side.heroes.map(h => ({ kind: h.kind, xp: Math.max(0, h.xp) + gain, alive: !(rng.float() < share / 2) }));
    return { lost, heroes };
  });

  // Survivors keep their order; kills go round-robin over each team's survivors, one per unit the
  // other team lost.
  const survivors: BattleUnit[][] = setup.sides.map((side, i) =>
    side.units.filter((_, k) => !lostBy[i].lost.has(k)).map(u => ({ kind: u.kind, kills: u.kills, core: u.core })),
  );
  const lostOnTeam = (team: number) => setup.sides.reduce((n, x, i) => n + (x.team === team ? lostBy[i].lost.size : 0), 0);
  for (const team of [0, 1]) {
    const pool: BattleUnit[] = [];
    setup.sides.forEach((x, i) => {
      if (x.team === team) pool.push(...survivors[i]);
    });
    const kills = lostOnTeam(1 - team);
    if (!pool.length) continue;
    for (let k = 0; k < kills; k++) pool[k % pool.length].kills = Math.min(999, pool[k % pool.length].kills + 1);
  }

  const cityDamage: Partial<Record<CityBuildingId, number>> = {};
  for (const [b, L] of Object.entries(setup.cityBuildings) as [CityBuildingId, number][]) {
    if (!L) continue;
    const lost = Math.round(attackersWon ? (L * q) / 2 : (L * q) / 4);
    if (lost > 0) cityDamage[b] = Math.min(L, lost);
  }

  return {
    battleId: setup.battleId,
    winner: attackersWon ? 'attacker' : 'defender',
    how: 'quick',
    ticks: 0,
    sides: setup.sides.map((side, i) => ({
      faction: side.faction,
      survivors: survivors[i].slice(0, SURVIVORS_MAX),
      heroes: lostBy[i].heroes,
    })),
    cityDamage,
    cityLevelLost: attackersWon ? 1 : 0,
  };
}
