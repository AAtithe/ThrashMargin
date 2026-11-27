/**
 * Victory by holding ground (2026-11-27, `setup.victory: 'hold'` with neutral sites on; the third step
 * of the long-game plan in fireline-design.md). Pure, like the rest of src/sim/.
 *
 * Until now a skirmish ended only when a side lost its last structure, so it was decided by the one
 * wave that broke a base. With hold victory on, each neutral site a side holds scores it a point every
 * HOLD_TICKS; the first team to HOLD_POINTS_PER_SITE points for every site on the map wins. A side
 * holding all the sites wins in that many minutes; one holding a bare majority takes far longer, so the
 * fight is over the map, not only the bases. Destroying every enemy structure still wins outright.
 *
 * The scores live on the state (`holdScore`, one per side); a team's score is its sides' sum.
 */
import { isAlly, sidesOf } from './sides';
import type { Owner } from './rules';
import type { GameState } from './types';

/** True in a skirmish with hold victory and at least one neutral site. Never a mission or a planet battle. */
export const holdOn = (s: GameState): boolean => !s.mission && !s.planet && s.setup?.victory === 'hold' && s.setup.sites === true && (s.sites?.length ?? 0) > 0;

/** Points are scored once a minute. */
export const HOLD_TICKS = 600;
/** Points to win, per site on the map: holding every site wins in this many minutes. */
export const HOLD_POINTS_PER_SITE = 60;

/** The points a team needs to win. */
export const holdTarget = (s: GameState): number => HOLD_POINTS_PER_SITE * (s.sites?.length ?? 0);

/** A team's points: the sum of its sides'. */
export function teamScore(s: GameState, owner: Owner): number {
  let n = 0;
  for (const o of sidesOf(s)) if (isAlly(s, owner, o)) n += s.holdScore?.[o] ?? 0;
  return n;
}

/** Sites a side's team holds now. */
export function teamSites(s: GameState, owner: Owner): number {
  return (s.sites ?? []).filter(x => x.owner !== null && isAlly(s, owner, x.owner)).length;
}

/** One tick: on the minute, every held site scores its holder a point; a team at the target wins. */
export function holdStep(s: GameState, say: (s: GameState, text: string, tone: 'info' | 'good' | 'bad') => void): void {
  if (!holdOn(s) || s.winner !== null || s.tick === 0 || s.tick % HOLD_TICKS !== 0) return;
  const score = s.holdScore ?? sidesOf(s).map(() => 0);
  for (const site of s.sites ?? []) if (site.owner !== null && site.owner < score.length) score[site.owner]++;
  s.holdScore = score;
  const target = holdTarget(s);
  // The leading team, if any has reached the target; level teams at the target play on.
  let best: Owner | null = null;
  let bestScore = -1;
  let level = false;
  for (const o of sidesOf(s)) {
    if (sidesOf(s).some(a => a < o && isAlly(s, a, o))) continue; // one entry per team, its lowest side
    const t = teamScore(s, o);
    if (t > bestScore) {
      best = o;
      bestScore = t;
      level = false;
    } else if (t === bestScore) level = true;
  }
  const near = Math.floor(target * 0.8);
  if (best !== null && bestScore >= near && bestScore - 1 < near && !level) {
    say(s, isAlly(s, 0, best) ? `Our hold on the map nears victory: ${bestScore} of ${target} points.` : `The enemy's hold on the map nears victory: ${bestScore} of ${target} points.`, isAlly(s, 0, best) ? 'good' : 'bad');
  }
  if (best === null || bestScore < target || level) return;
  // The winner is the lowest side of the winning team: side 0 for a victory, as checkVictory does.
  s.winner = isAlly(s, 0, best) ? 0 : best;
  say(s, s.winner === 0 ? `Victory. We held the ground: ${bestScore} points of ${target}.` : `Defeat. The enemy held the ground: ${bestScore} points of ${target}.`, s.winner === 0 ? 'good' : 'bad');
}
