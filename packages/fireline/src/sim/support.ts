/**
 * Support powers that stay on the field after they are called: the Iron Dome (POWERS.irondome).
 * Pure like the rest of src/sim/: no clock, no Math.random; each shot's roll is drawn from the battle's
 * seed. A no-op until a dome has been raised, so
 * a battle without one is byte-identical to one from before the dome existed.
 */
import { dist } from './grid';
import { IRON_DOME_CHANCE, IRON_DOME_LEAD, type Owner } from './rules';
import { next } from './rng';
import { interceptable } from './fortification';
import { isEnemy } from './sides';
import { alarm } from './state';
import type { GameState, Projectile } from './types';

/**
 * Each standing dome fires at the enemy shells, missiles and bombs about to land inside it (the ones
 * Point Defence would shoot at, and the cruise missile), one shot each, up to its shots, in the order
 * they would land; each shot brings its target down with IRON_DOME_CHANCE. Spent and expired domes
 * are cleared. Called once a tick, before projectiles land.
 */
export function domeStep(s: GameState): void {
  if (!s.domes) return;
  if (s.domes.some(d => d[3] <= s.tick || d[5] <= 0)) {
    s.domes = s.domes.filter(d => d[3] > s.tick && d[5] > 0);
    if (!s.domes.length) {
      delete s.domes;
      return;
    }
  }
  if (!s.projectiles.length) return;
  const units = new Map(s.units.map(u => [u.id, u]));
  let gone: Set<Projectile> | null = null;
  let missed: Set<Projectile> | null = null;
  let domes = s.domes;
  for (let i = 0; i < domes.length; i++) {
    const [cx, cy, r, , side] = domes[i];
    const owner = side as Owner;
    let left = domes[i][5];
    const due = s.projectiles
      .filter(
        p =>
          !gone?.has(p) &&
          !missed?.has(p) &&
          p.firedAt <= s.tick &&
          // Once, IRON_DOME_LEAD ticks before it lands (at launch, for a shorter flight).
          p.hitAt - s.tick === Math.min(IRON_DOME_LEAD, p.hitAt - p.firedAt) &&
          isEnemy(s, owner, p.owner) &&
          dist(cx, cy, p.toX, p.toY) <= r &&
          interceptable(units, p),
      )
      .sort((a, b) => a.hitAt - b.hitAt || a.id - b.id);
    for (const p of due) {
      if (left <= 0) break;
      left--;
      const roll = next(s.rngSeed);
      s.rngSeed = roll.seed;
      const hit = roll.value < IRON_DOME_CHANCE;
      if (hit) {
        gone ??= new Set();
        gone.add(p);
      } else {
        // Missed: it lands, and no later shot of any dome tries it again.
        missed ??= new Set();
        missed.add(p);
      }
      // Brought down in the air, a little short of where it was going.
      const span = Math.max(1, p.hitAt - p.firedAt);
      const f = Math.max(0, Math.min(1, (s.tick - p.firedAt) / span));
      const x = p.fromX + (p.toX - p.fromX) * f;
      const y = p.fromY + (p.toY - p.fromY) * f;
      s.effects.push({ id: s.nextId++, kind: 'intercept', x, y, x2: cx, y2: cy, at: s.tick, size: hit ? 1 : 0, weapon: p.weapon });
      if (hit && owner === 0) alarm(s, 'irondome', 'Iron Dome shot down incoming fire.', 300, 'good');
    }
    if (left !== domes[i][5]) {
      // Tuples are never edited in place (cloneState shares them).
      domes = domes.map((d, j) => (j === i ? [d[0], d[1], d[2], d[3], d[4], left] : d));
    }
  }
  s.domes = domes;
  if (!gone) return;
  const down = gone;
  // A Firebrand's incendiary takes the fire it would have left with it, as under Point Defence.
  const fires = [...down].filter(p => p.weapon === 'flame');
  s.projectiles = s.projectiles.filter(
    p =>
      !down.has(p) &&
      !fires.some(g => p.weapon === 'flame' && p.shooter === g.shooter && p.firedAt === g.hitAt && p.toX === g.toX && p.toY === g.toY),
  );
}
