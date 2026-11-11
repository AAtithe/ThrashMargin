/**
 * The computer's field General (fireline-round6-design.md, workstream C): `generalPlan`, called once
 * per decision from the commander in ai.ts. Does nothing unless Generals are on (fieldGenerals).
 *
 * - Recruits one once its first wave has gone, or after GENERAL_AI_AFTER ticks, saving for it in a
 *   fund in its memory (`generalFund`, the way aiEngineering.ts saves for an expansion).
 * - Keeps it with the main wave, a little behind the wave's centre on the side away from the enemy
 *   (behind the front rank, inside its aura's reach), and at the gathering point otherwise.
 * - Pulls it back home below GENERAL_RETREAT_BELOW of its health, and sends it out again only once
 *   it is back above GENERAL_RETURN_AT (a Medic or a Field Hospital may see to that).
 *
 * The wave, raid and retreat code in ai.ts leaves the General alone (keptBack). Deterministic: no
 * draws at all.
 */
import { stageDistance } from './aiScale';
import { canQueue, doMove, doQueue } from './commands';
import { squadById } from './formations';
import { fieldGenerals, generalOf, generalQueueable } from './generals';
import { dist, nearestPassable, occupancy } from './grid';
import { GENERAL_RETREAT_BELOW, GENERAL_RETURN_AT, UNITS, type Owner } from './rules';
import { costFor, maxHpOf, unlocked } from './state';
import type { GameState, Unit } from './types';

interface Pt {
  x: number;
  y: number;
}

/** The computer waits this long for its first General unless its first wave goes sooner (8 minutes). */
export const GENERAL_AI_AFTER = 4800;
/** The share of its credits the computer puts by for its General at each decision until it can pay. */
export const GENERAL_AI_SAVE = 0.35;
/** How far behind the wave's centre the General keeps, in tiles. */
export const GENERAL_AI_BEHIND = 2.5;

const toward = (a: Pt, b: Pt, by: number): Pt => {
  const d = dist(a.x, a.y, b.x, b.y) || 1;
  return { x: a.x + ((b.x - a.x) / d) * by, y: a.y + ((b.y - a.y) / d) * by };
};

/** Where the computer's General should stand now, and whether it is pulling back. Exported for the harness. */
export function generalPost(s: GameState, owner: Owner, g: Unit, home: Pt, enemyHome: Pt): { at: Pt; back: boolean } {
  const mem = s.ai[owner];
  const share = g.hp / maxHpOf(g);
  const back = share < GENERAL_RETREAT_BELOW || (!!mem.generalBack && share < GENERAL_RETURN_AT);
  if (back) return { at: toward(home, enemyHome, 3), back };
  const alive = new Map(s.units.filter(u => u.owner === owner && u.hp > 0).map(u => [u.id, u]));
  const wave = (mem.waveIds ?? []).map(id => alive.get(id)).filter((u): u is Unit => !!u && UNITS[u.kind].category !== 'air');
  if (wave.length >= 2) {
    let x = 0;
    let y = 0;
    for (const u of wave) {
      x += u.x;
      y += u.y;
    }
    const centre = { x: x / wave.length, y: y / wave.length };
    // Out on the attack: behind the centre, away from the enemy. Gathering: at the centre.
    return { at: mem.wavePhase === 2 ? toward(centre, enemyHome, -GENERAL_AI_BEHIND) : centre, back };
  }
  return { at: toward(home, enemyHome, stageDistance(s)), back };
}

export function generalPlan(s: GameState, owner: Owner, home: Pt, enemyHome: Pt, units: Unit[]): void {
  if (!fieldGenerals(s)) return;
  const mem = s.ai[owner];
  const g = units.find(u => u.kind === 'general' && u.hp > 0);
  if (!g) {
    if (mem.generalBack !== undefined) delete mem.generalBack;
    const p = s.players[owner];
    const due = mem.wave >= 1 || s.tick >= GENERAL_AI_AFTER;
    const queued = p.queues.infantry.some(q => q.kind === 'general');
    if (!due || queued || !generalQueueable(s, owner) || !unlocked(s, owner, 'general')) {
      // Not wanted now (or already queued): any savings go back.
      if (mem.generalFund) {
        p.credits += mem.generalFund;
        delete mem.generalFund;
      }
      return;
    }
    // The commander spends whatever it holds on units, so the General is saved for: at each
    // decision a share of the credits goes into a fund in its memory until the price is there.
    const price = costFor(s, owner, 'general');
    const fund = mem.generalFund ?? 0;
    if (fund + p.credits < price) {
      const take = Math.floor(p.credits * GENERAL_AI_SAVE);
      p.credits -= take;
      mem.generalFund = fund + take;
      return;
    }
    p.credits += fund;
    delete mem.generalFund;
    if (canQueue(s, owner, 'infantry', 'general')) doQueue(s, owner, 'infantry', 'general');
    return;
  }
  const post = generalPost(s, owner, g, home, enemyHome);
  if (post.back) mem.generalBack = true;
  else if (mem.generalBack !== undefined) delete mem.generalBack;
  // Integration (section 7): leading its wave's squad, the General goes where the squad goes. Pulling
  // back still takes it out (a plain move of one member leaves the squad).
  if (!post.back && squadById(s, g.squad)) return;
  const far = post.back ? 2 : 3;
  if (dist(g.x, g.y, post.at.x, post.at.y) <= far) return;
  // Already on its way there: leave the path alone.
  if (g.order.type === 'move' && dist(g.order.x, g.order.y, post.at.x, post.at.y) <= 1.5) return;
  const occ = occupancy(s);
  const k = nearestPassable(s, occ, post.at.x, post.at.y, 6);
  if (k < 0) return;
  doMove(s, owner, [g.id], (k % s.mapW) + 0.5, Math.floor(k / s.mapW) + 0.5, false);
}

/** How near the wave's middle the General must be to lead it (tiles). */
export const GENERAL_AI_LEAD_WITHIN = 12;

/**
 * Integration (fireline-round6-design.md section 7): the General's id when it should lead this wave's
 * formation move (Generals on, standing, not pulling back, and near the wave), otherwise none. The
 * commander adds it to the ids of its formation moves, so the squad is formed with the General at
 * its head (squadLeader) and keeps tighter.
 */
export function generalLeads(s: GameState, owner: Owner, waveIds: number[]): number[] {
  if (!fieldGenerals(s) || s.ai[owner].generalBack) return [];
  const g = generalOf(s, owner);
  if (!g) return [];
  const ids = new Set(waveIds);
  const wave = s.units.filter(u => ids.has(u.id) && u.hp > 0 && UNITS[u.kind].category !== 'air');
  if (wave.length < 2) return [];
  let x = 0;
  let y = 0;
  for (const u of wave) {
    x += u.x;
    y += u.y;
  }
  return dist(g.x, g.y, x / wave.length, y / wave.length) <= GENERAL_AI_LEAD_WITHIN ? [g.id] : [];
}
