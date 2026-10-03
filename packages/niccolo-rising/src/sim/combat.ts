/**
 * A duel, simulated to a conclusion. Pure: takes a seed, returns the advanced seed.
 *
 * Each round both fighters strike once, the faster first. To hit is the attacker's speed against
 * the defender's dexterity, plus the weapon's accuracy. Damage is a strength-driven base, scaled by
 * strength against the defender's defence and by the weapon, then cut by armour. The player fights
 * with whatever health they walked in with, which is why a beaten player should heal before going
 * again.
 */
import { next } from './rng';
import type { BattleStat } from './types';

export interface Fighter {
  name: string;
  stats: Record<BattleStat, number>;
  hp: number;
  weapon: number;
  accuracy: number;
  armour: number;
}

export interface DuelResult {
  seed: number;
  outcome: 'won' | 'lost' | 'stalemate';
  /** Health the player has left (never below zero). */
  playerHp: number;
  opponentHp: number;
  rounds: number;
  lines: string[];
}

function hitChance(att: Fighter, def: Fighter): number {
  const ratio = att.stats.speed / (att.stats.speed + def.stats.dexterity);
  return Math.max(0.1, Math.min(0.95, 0.25 + ratio * 0.8 + att.accuracy / 100));
}

function baseDamage(att: Fighter, def: Fighter): number {
  const ratio = att.stats.strength / (att.stats.strength + def.stats.defence);
  return (8 + Math.pow(att.stats.strength, 0.6)) * att.weapon * ratio * 2 * (1 - def.armour);
}

export function simulateDuel(seed: number, player: Fighter, opponent: Fighter, maxRounds: number): DuelResult {
  let s = seed;
  let pHp = player.hp;
  let oHp = opponent.hp;
  const lines: string[] = [];
  const playerFirst = player.stats.speed >= opponent.stats.speed;

  const strike = (att: Fighter, def: Fighter, attIsPlayer: boolean): number => {
    const r1 = next(s);
    s = r1.seed;
    if (r1.value >= hitChance(att, def)) {
      lines.push(attIsPlayer ? `You swing at ${def.name} and miss.` : `${att.name} misses you.`);
      return 0;
    }
    const r2 = next(s);
    s = r2.seed;
    const dmg = Math.max(1, Math.round(baseDamage(att, def) * (0.8 + r2.value * 0.4)));
    lines.push(attIsPlayer ? `You hit ${def.name} for ${dmg}.` : `${att.name} hits you for ${dmg}.`);
    return dmg;
  };

  let round = 0;
  for (round = 1; round <= maxRounds; round++) {
    if (playerFirst) {
      oHp -= strike(player, opponent, true);
      if (oHp <= 0) break;
      pHp -= strike(opponent, player, false);
      if (pHp <= 0) break;
    } else {
      pHp -= strike(opponent, player, false);
      if (pHp <= 0) break;
      oHp -= strike(player, opponent, true);
      if (oHp <= 0) break;
    }
  }

  const outcome: DuelResult['outcome'] = oHp <= 0 ? 'won' : pHp <= 0 ? 'lost' : 'stalemate';
  if (outcome === 'won') lines.push(`${opponent.name} goes down and stays down.`);
  else if (outcome === 'lost') lines.push('The cobbles come up to meet you.');
  else lines.push('Neither of you can finish it. The Watch arrives, and you both walk away.');

  return {
    seed: s,
    outcome,
    playerHp: Math.max(0, pHp),
    opponentHp: Math.max(0, oHp),
    rounds: Math.min(round, maxRounds),
    lines,
  };
}
