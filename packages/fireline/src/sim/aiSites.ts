import { canQueue, doAttack, doMove, doQueue } from './commands';
import { dist, occupancy, passable, tileAt } from './grid';
import {
  BUILDINGS,
  DIFFICULTIES,
  SITE_CAPTURE_RANGE,
  SITES,
  TIER3_AI_TICKS,
  UNITS,
  type BuildingKind,
  type Difficulty,
  type Owner,
  type UnitKind,
} from './rules';
import { siteCentre, siteDist } from './sites';
import { costFor, countBuildings, lineCount, maxHpOf, powerOf, techAllowed, unlocked } from './state';
import { isAlly, isEnemy } from './sides';
import type { GameState, Site, Unit } from './types';
import { buildingSpec, buildingSpecOf, unitSpec, unitSpecOf } from './specs';

/**
 * The computer commander's neutral sites and tier three (fireline-round5-design.md, workstream D).
 * Called once a decision from the commander in ai.ts, after airPlan and before the army moves.
 * Never in a mission (a mission has no sites and no tier three).
 *
 *  - Sites, whenever the battle has them (either tech level): small infantry parties to the
 *    nearest sites its team does not hold, nearest first, with a lost site near home first of
 *    all. A party stands beside its site until it is taken, shuffling between two tiles beside it
 *    so no other part of the commander takes it for an idle reserve; it gives up after four
 *    minutes and leaves that site alone for six.
 *  - Tier three, advanced tech only: from TIER3_AI_TICKS (25 minutes), with its economy standing
 *    and its army at home up to strength, a Research Lab and a Tech Centre if it has none, then a Prototype Works,
 *    then (Normal and Hard) a Fortress, which the commander's own placement puts by its yard.
 *    Railgun Tanks join the vehicle mix in proportion to its vehicles, and Stealth Tanks (Normal
 *    and Hard) hunt the opponent's haulers, out of the waves.
 */

interface SiteTactics {
  /** Ticks after TIER3_AI_TICKS before it starts on tier three. */
  delay: number;
  /** Railgun Tanks at most, and one per this many of its armed vehicles. */
  railMax: number;
  railPer: number;
  fortresses: number;
  stealth: number;
  /** Ticks between Stealth Tank hunts. */
  huntInterval: number;
  /** Capture parties out at once, and the infantry in each. */
  parties: number;
  partySize: number;
}

const SITE_TACTICS: Record<Difficulty, SiteTactics> = {
  easy: { delay: 3000, railMax: 2, railPer: 4, fortresses: 0, stealth: 0, huntInterval: 0, parties: 1, partySize: 2 },
  normal: { delay: 0, railMax: 4, railPer: 3, fortresses: 1, stealth: 1, huntInterval: 1800, parties: 2, partySize: 3 },
  hard: { delay: 0, railMax: 6, railPer: 2, fortresses: 1, stealth: 2, huntInterval: 1200, parties: 3, partySize: 3 },
};

/** A party that has not taken its site in this long gives up on it, and leaves it alone for SITE_RETRY_TICKS. */
const PARTY_TICKS = 2400;
const SITE_RETRY_TICKS = 3600;
/** Infantry this far from home or further are left where they are. */
const PARTY_REACH = 30;
/** A Stealth Tank under this share of health comes home; a hunt gives up after HUNT_TICKS. */
const HUNT_RETREAT = 0.4;
const HUNT_TICKS = 2400;

type Pt = { x: number; y: number };

export function sitesPlan(s: GameState, owner: Owner, home: Pt, _enemyHome: Pt, units: Unit[], foes: Unit[]): void {
  if (s.mission) return;
  const diff: Difficulty = owner === 0 && s.autopilotDifficulty ? s.autopilotDifficulty : s.difficulty;
  const t = SITE_TACTICS[diff];
  if (s.sites && s.sites.length) captureParties(s, owner, t, home, units, foes);
  if (techAllowed(s, owner, 'protoworks')) tierThree(s, owner, diff, t, home, units, foes);
}

// ---------------------------------------------------------------------------------------------
// Neutral sites

/** Open tiles beside a site, where infantry stand to take it. */
function standsBy(s: GameState, site: Site): number[] {
  const occ = occupancy(s);
  const spec = SITES[site.kind];
  const out: number[] = [];
  for (let y = site.y - 1; y <= site.y + spec.h; y++)
    for (let x = site.x - 1; x <= site.x + spec.w; x++) {
      if (x >= site.x && x < site.x + spec.w && y >= site.y && y < site.y + spec.h) continue;
      if (passable(s, occ, x, y) && siteDist(x + 0.5, y + 0.5, site) <= SITE_CAPTURE_RANGE - 0.3) out.push(tileAt(s, x, y));
    }
  return out;
}

const tileX = (s: GameState, k: number) => (k % s.mapW) + 0.5;
const tileY = (s: GameState, k: number) => ((k / s.mapW) | 0) + 0.5;

/** Each member to its own stand beside the site, nearest first. */
function approach(s: GameState, owner: Owner, members: Unit[], site: Site): void {
  const stands = standsBy(s, site);
  if (!stands.length) return;
  const free = stands.slice();
  for (const u of members) {
    if (!free.length) free.push(...stands);
    let best = 0;
    for (let i = 1; i < free.length; i++) if (dist(u.x, u.y, tileX(s, free[i]), tileY(s, free[i])) < dist(u.x, u.y, tileX(s, free[best]), tileY(s, free[best]))) best = i;
    const k = free.splice(best, 1)[0];
    doMove(s, owner, [u.id], tileX(s, k), tileY(s, k), true);
  }
}

/**
 * Stands a member beside its site with a short queue of steps between two stands there, so it is
 * never idle (an idle soldier is anyone's reserve: the waves, the defence, an ally's call) while
 * the capture runs. It still fights whatever comes, on attack-move.
 */
function holdBeside(s: GameState, owner: Owner, u: Unit, site: Site): void {
  const stands = standsBy(s, site);
  if (stands.length < 2) return;
  const byDist = stands.slice().sort((a, b) => dist(u.x, u.y, tileX(s, a), tileY(s, a)) - dist(u.x, u.y, tileX(s, b), tileY(s, b)) || a - b);
  const a = byDist[0];
  const b = byDist[1];
  doMove(s, owner, [u.id], tileX(s, a), tileY(s, a), true);
  for (let i = 0; i < 8; i++) {
    const k = i % 2 === 0 ? b : a;
    doMove(s, owner, [u.id], tileX(s, k), tileY(s, k), true, true);
  }
}

function captureParties(s: GameState, owner: Owner, t: SiteTactics, home: Pt, units: Unit[], foes: Unit[]): void {
  const mem = s.ai[owner];
  const alive = new Map(units.map(u => [u.id, u]));
  const sites = s.sites!;
  const ours = (site: Site) => site.owner !== null && isAlly(s, site.owner, owner);
  let retry = (mem.siteRetry ?? []).filter(([, at]) => at > s.tick);
  const parties: NonNullable<typeof mem.siteParties> = [];
  for (const p of mem.siteParties ?? []) {
    const ids = p.ids.filter(id => alive.has(id));
    const site = sites.find(x => x.id === p.site);
    if (!ids.length || !site || ours(site)) continue;
    if (s.tick - p.since > PARTY_TICKS) {
      retry = retry.concat([[p.site, s.tick + SITE_RETRY_TICKS]]);
      continue;
    }
    // Members drawn off (a wave, the defence, a retreat) or done with their steps are put back.
    for (const id of ids) {
      const u = alive.get(id)!;
      if (u.engage) continue;
      const near = siteDist(u.x, u.y, site) <= SITE_CAPTURE_RANGE;
      const toSite = (u.order.type === 'move' || u.order.type === 'attackMove') && siteDist(u.order.x, u.order.y, site) <= SITE_CAPTURE_RANGE;
      if (near && u.order.type === 'idle') holdBeside(s, owner, u, site);
      else if (!near && !toSite) approach(s, owner, [u], site);
    }
    parties.push({ site: p.site, ids, since: p.since });
  }

  // A new party when there is room for one and soldiers to spare.
  if (parties.length < t.parties) {
    const busy = new Set<number>([...mem.waveIds, ...mem.raidIds, ...parties.flatMap(p => p.ids)]);
    const pool = units.filter(
      u =>
        UNITS[u.kind].category === 'infantry' &&
        unitSpecOf(s, u).weapon &&
        u.kind !== 'skyhunter' &&
        !UNITS[u.kind].hero &&
        !busy.has(u.id) &&
        u.order.type !== 'attack' &&
        u.hp >= maxHpOf(u) * 0.7 &&
        dist(u.x, u.y, home.x, home.y) < PARTY_REACH,
    );
    if (pool.length >= t.partySize) {
      const targeted = new Set(parties.map(p => p.site));
      const skip = new Set(retry.map(([id]) => id));
      let best: Site | null = null;
      let bestScore = Infinity;
      for (const site of sites) {
        if (ours(site) || targeted.has(site.id) || skip.has(site.id)) continue;
        const c = siteCentre(site);
        const guard = foes.filter(f => unitSpecOf(s, f).weapon && dist(f.x, f.y, c.x, c.y) < 7).length;
        if (guard > t.partySize) continue;
        const d = dist(home.x, home.y, c.x, c.y);
        // A site lost to an enemy close to home is taken back first.
        const score = d - (site.owner !== null && isEnemy(s, owner, site.owner) && d < 25 ? 12 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = site;
        }
      }
      if (best) {
        const c = siteCentre(best);
        const members = pool.sort((a, b) => dist(a.x, a.y, c.x, c.y) - dist(b.x, b.y, c.x, c.y) || a.id - b.id).slice(0, t.partySize);
        approach(s, owner, members, best);
        parties.push({ site: best.id, ids: members.map(u => u.id), since: s.tick });
      }
    }
  }

  // Party members belong to no wave and no raid.
  const inParty = new Set(parties.flatMap(p => p.ids));
  if (inParty.size) {
    if (mem.waveIds.some(id => inParty.has(id))) mem.waveIds = mem.waveIds.filter(id => !inParty.has(id));
    if (mem.raidIds.some(id => inParty.has(id))) mem.raidIds = mem.raidIds.filter(id => !inParty.has(id));
  }
  mem.siteParties = parties;
  mem.siteRetry = retry;
}

// ---------------------------------------------------------------------------------------------
// Tier three

function tierThree(s: GameState, owner: Owner, diff: Difficulty, t: SiteTactics, home: Pt, units: Unit[], foes: Unit[]): void {
  const p = s.players[owner];
  const d = DIFFICULTIES[diff];
  const mem = s.ai[owner];
  const count = (k: BuildingKind) => countBuildings(s, owner, k);
  const queued = (kind: UnitKind) => units.filter(u => u.kind === kind).length + p.queues.vehicle.filter(i => i.kind === kind).length;
  const vq = p.queues.vehicle;

  // Stealth Tanks hunt even once tier three is behind it (the Works may have fallen).
  if (t.stealth) hunt(s, owner, t, home, units, foes);
  if (s.tick < TIER3_AI_TICKS + t.delay) return;
  const haulers = units.some(u => u.kind === 'hauler');
  const economy = haulers && count('refinery') > 0 && count('factory') > 0;
  if (!economy) return;

  // Units from the Prototype Works: they are the army, so no waiting on its size.
  // Room for one beyond the vehicles the commander keeps queued (one line per War Factory).
  if (count('protoworks') > 0 && vq.length <= lineCount(s, owner, 'vehicle')) {
    const vehicles = units.filter(u => UNITS[u.kind].category === 'vehicle' && unitSpecOf(s, u).weapon).length;
    const rails = Math.min(t.railMax, 1 + Math.floor(vehicles / t.railPer));
    // Saved for out of units not yet started, as the structures below are: a cheaper unit would
    // otherwise always take the credits first.
    const want: UnitKind | null = queued('stealthtank') < t.stealth ? 'stealthtank' : queued('railtank') < rails ? 'railtank' : null;
    if (want && unlocked(s, owner, want) && fund(s, owner, unitSpec(s, owner, want).cost) && canQueue(s, owner, 'vehicle', want)) doQueue(s, owner, 'vehicle', want);
  }

  // Structures wait for the army at home to be up to the next wave and to the opponent's army,
  // as the commander's own extras do, and then are paid for by taking back units not yet started.
  const armed = units.filter(u => unitSpecOf(s, u).weapon && UNITS[u.kind].category !== 'air').length;
  const foeArmy = foes.filter(u => unitSpecOf(s, u).weapon && UNITS[u.kind].category !== 'air').length;
  if (armed < Math.max(Math.min(d.waveCap, d.firstWave + mem.wave * d.waveGrowth), foeArmy * 0.9)) return;
  if (p.queues.building.length) return;
  if (count('researchlab') < 1) queueStructure(s, owner, 'researchlab');
  else if (count('techcentre') < 1) queueStructure(s, owner, 'techcentre');
  else if (count('protoworks') < 1) queueStructure(s, owner, 'protoworks');
  else if (count('fortress') < t.fortresses) queueStructure(s, owner, 'fortress');
}

/**
 * Saves up for something costing `need` by taking back units queued but not yet started (never a
 * hauler or anti-air), latest first. True once `need` is in hand. (The same rule as aiAir.ts.)
 */
function fund(s: GameState, owner: Owner, need: number): boolean {
  const p = s.players[owner];
  const spare = (k: string) => k !== 'hauler' && k !== 'skyhunter' && k !== 'flaktrack';
  for (const cat of ['vehicle', 'infantry'] as const) {
    const q = p.queues[cat];
    for (let i = q.length - 1; i >= 0 && p.credits < need; i--) {
      if (q[i].progress !== 0 || !spare(q[i].kind)) continue;
      const kind = q[i].kind;
      q.splice(i, 1);
      p.credits += costFor(s, owner, kind);
    }
  }
  return p.credits >= need;
}

/** Queues a structure when nothing else is building; a Generator first when it would take power too low. */
function queueStructure(s: GameState, owner: Owner, kind: BuildingKind): void {
  const p = s.players[owner];
  if (p.queues.building.length) return;
  const pw = powerOf(s, owner);
  const want: BuildingKind = pw.made - pw.used + buildingSpec(s, owner, kind).power < 10 ? 'power' : kind;
  if (!unlocked(s, owner, want) || !fund(s, owner, buildingSpec(s, owner, want).cost)) return;
  if (canQueue(s, owner, 'building', want)) doQueue(s, owner, 'building', want);
}

/**
 * Stealth Tanks hunt the opponent's haulers: out together when the hunt is due, on to the next
 * hauler near them when one falls, home when hurt, when none is left, or after HUNT_TICKS. Out of
 * every wave throughout.
 */
function hunt(s: GameState, owner: Owner, t: SiteTactics, home: Pt, units: Unit[], foes: Unit[]): void {
  const mem = s.ai[owner];
  const tanks = units.filter(u => u.kind === 'stealthtank');
  const ids = new Set(tanks.map(u => u.id));
  if (mem.waveIds.some(id => ids.has(id))) mem.waveIds = mem.waveIds.filter(id => !ids.has(id));
  if (!tanks.length && !(mem.stealthIds ?? []).length) return;
  const alive = new Map(tanks.map(u => [u.id, u]));
  let out = (mem.stealthIds ?? []).filter(id => alive.has(id));
  const haulers = foes.filter(f => f.kind === 'hauler');
  const nearest = (from: Pt): Unit | null => {
    let best: Unit | null = null;
    for (const h of haulers) if (!best || dist(from.x, from.y, h.x, h.y) < dist(from.x, from.y, best.x, best.y)) best = h;
    return best;
  };
  const goHome = (list: number[]) => {
    if (list.length) doMove(s, owner, list, home.x, home.y, false);
  };
  if (out.length) {
    const hurt = out.filter(id => alive.get(id)!.hp < maxHpOf(alive.get(id)!) * HUNT_RETREAT);
    goHome(hurt);
    out = out.filter(id => !hurt.includes(id));
    let target = haulers.find(h => h.id === mem.stealthTarget) ?? null;
    if (!target && out.length) {
      target = nearest(alive.get(out[0])!);
      mem.stealthTarget = target ? target.id : 0;
    }
    if (!target || s.tick - (mem.nextStealthRaid ?? 0) > HUNT_TICKS) {
      goHome(out);
      out = [];
      mem.stealthTarget = 0;
      mem.nextStealthRaid = s.tick + t.huntInterval;
    } else {
      const strays = out.filter(id => {
        const o = alive.get(id)!.order;
        return !(o.type === 'attack' && o.target === target!.id);
      });
      if (strays.length) doAttack(s, owner, strays, target.id);
    }
  } else if (s.tick >= (mem.nextStealthRaid ?? 0)) {
    const ready = tanks.filter(u => u.hp >= maxHpOf(u) * 0.7 && (u.order.type === 'idle' || u.order.type === 'move' || u.order.type === 'attackMove'));
    const target = ready.length ? nearest(ready[0]) : null;
    if (target) {
      out = ready.map(u => u.id);
      mem.stealthTarget = target.id;
      // While a hunt is out, nextStealthRaid holds the tick it set out (as the buggies' raid does).
      mem.nextStealthRaid = s.tick;
      doAttack(s, owner, out, target.id);
    }
  }
  mem.stealthIds = out;
}
