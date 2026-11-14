/**
 * The computer's heroes in free play (fireline-round6-design.md, workstream B): `heroPlan`, called
 * once per decision from the commander, and `heroKeptBack`, read by its `keptBack`. Both do nothing
 * unless heroes are in play (a skirmish with heroes on and advanced tech), so every other battle,
 * and every mission, plays exactly as before.
 *
 * - Recruiting: a Command Academy once a Tech Centre stands and there are credits to spare, then the
 *   heroes one at a time, Engineer, Ace, Commando, Spy, each only above a reserve that keeps the army
 *   coming (larger on Easy).
 * - The Engineer captures an enemy structure or a neutral site that nothing armed is guarding.
 * - The Commando, with a small escort from the reserve, goes for a lone enemy structure (none other
 *   close by, no gun covering it) and plants a charge on it.
 * - The Ace joins the main wave like any tank (it is not kept back), and opens Overdrive in a fight.
 * - The Spy waits at home until an attack is about to go, then infiltrates the chosen enemy's base
 *   ahead of it: its Generators first (their power fails), then a War Factory or Barracks.
 * - On Hard, while a wave is attacking, the Engineer, Commando and Spy go with it, a few tiles behind its
 *   middle, and use their abilities on what it has reached: the Engineer captures a structure no
 *   one is left guarding (and mends the wave's vehicles on the way), the Commando charges the
 *   nearest structure, the Spy slips into one. Waiting at home for a lone target, they used to see
 *   out a whole Hard battle without acting (fireline-improvements.md).
 *
 * Every choice is deterministic (distances, then ids); nothing draws from the battle's stream.
 * Errands live in `s.ai[owner]` as replaced arrays, never edited in place.
 */
import { canQueue, doMove, doQueue } from './commands';
import { buildingCentre, dist, distToBuilding } from './grid';
import { abilityProblem, doAbility } from './mission';
import { BUILDINGS, HERO_ACADEMY, SITE_CAPTURE_RANGE, SITES, UNITS, type Difficulty, type HeroKind, type Owner } from './rules';
import { isAlly, isEnemy } from './sides';
import { siteDist } from './sites';
import { buildingSpecOf, unitSpecOf } from './specs';
import { costFor, hasBuilding, isStructure, maxHpOf } from './state';
import { heroesInPlay, heroRecruitProblem, isHeroKind } from './heroes';
import type { AiMemory, Building, GameState, Site, Unit } from './types';

type Pt = { x: number; y: number };
type Errand = NonNullable<AiMemory['heroErrands']>[number];

/** The share of its credits the computer puts toward the next hero (or the Academy) each decision. */
const SAVE_SHARE: Record<Difficulty, number> = { easy: 0.15, normal: 0.25, hard: 0.35 };
/** The order heroes are recruited in. */
const RECRUIT_ORDER: HeroKind[] = ['engineer', 'ace', 'commando', 'spy'];
/** An errand given up after this long, and its target left alone for as long again. */
const ERRAND_TICKS = 1800;
/** Nothing armed within this many tiles: the target is undefended. */
const GUARD_RANGE = 7;
/** The Commando's escort. */
const ESCORT_SIZE = 3;
/** The Spy sets out this many ticks before the next attack is due. */
const SPY_LEAD = 300;
/** Going with a wave: targets within this many tiles of its middle, and kept this far behind it. */
const WAVE_REACH = 10;
const WAVE_TRAIL = 3;

/** True for a unit the hero plan commands, which the wave, raid and retreat code leave alone. */
export function heroKeptBack(s: GameState, u: Unit): boolean {
  if (!heroesInPlay(s)) return false;
  if (isHeroKind(u.kind)) return u.kind !== 'ace';
  const escort = s.ai[u.owner]?.heroEscort;
  return Array.isArray(escort) && escort.includes(u.id);
}

/**
 * True when the commander should build its Tech Centre in its turn in the plan rather than hold it
 * back, as an extra, until the army at home is up to strength: with heroes in play on Hard, where it
 * is the way to the Command Academy. Held back, it came at about minute 16 of a Hard battle that
 * lasted about 21, and in a third of them not at all, so the heroes came too late to act
 * (fireline-improvements.md). Normal and Easy battles run long enough, and keep the hold.
 */
export function heroesNeedTechCentre(s: GameState, diff: Difficulty): boolean {
  return diff === 'hard' && heroesInPlay(s);
}

export function heroPlan(s: GameState, owner: Owner, home: Pt, enemy: Building[], units: Unit[], foes: Unit[]): void {
  if (!heroesInPlay(s)) return;
  const mem = s.ai[owner];
  const diff: Difficulty = owner === 0 && s.autopilotDifficulty ? s.autopilotDifficulty : s.difficulty;
  recruit(s, owner, diff, units);

  const alive = new Map(units.map(u => [u.id, u]));
  let errands: Errand[] = Array.isArray(mem.heroErrands) ? mem.heroErrands.filter(e => alive.has(e.hero)) : [];
  let escort: number[] = Array.isArray(mem.heroEscort) ? mem.heroEscort.filter(id => alive.has(id)) : [];
  let retry: [number, number][] = Array.isArray(mem.heroRetry) ? mem.heroRetry.filter(([, until]) => until > s.tick) : [];
  const skip = new Set(retry.map(([id]) => id));
  const armedFoes = foes.filter(f => f.hp > 0 && unitSpecOf(s, f).weapon);
  const guarded = (p: Pt, r = GUARD_RANGE) =>
    armedFoes.some(f => dist(f.x, f.y, p.x, p.y) < r) ||
    s.buildings.some(b => b.hp > 0 && isEnemy(s, owner, b.owner) && !!buildingSpecOf(s, b).weapon && distToBuilding(p.x, p.y, b) < r);

  // The wave on the attack, if one is out: its middle, where the heroes go with it. Hard only:
  // Normal and Easy battles run long enough for heroes kept at home to act, and play as before.
  const front = diff === 'hard' ? waveFront(s, mem, alive) : null;
  const nearFront = (p: Pt) => !!front && dist(p.x, p.y, front.x, front.y) < WAVE_REACH;
  const follow = (u: Unit) => {
    if (!front) return;
    const at = toward(front, home, WAVE_TRAIL);
    const going = u.order.type === 'move' ? dist(u.order.x, u.order.y, at.x, at.y) < 3 : false;
    if (!going && !u.engage && dist(u.x, u.y, at.x, at.y) > 4) doMove(s, owner, [u.id], at.x, at.y, false);
  };

  const drop = (e: Errand, again: boolean) => {
    errands = errands.filter(x => x !== e);
    if (again) retry = retry.filter(([id]) => id !== e.target).concat([[e.target, s.tick + ERRAND_TICKS]]);
  };
  const goHome = (u: Unit) => {
    if (dist(u.x, u.y, home.x, home.y) > 6) doMove(s, owner, [u.id], home.x, home.y, false);
  };

  for (const u of units) {
    if (!u.hero || u.hp <= 0) continue;
    const kind = u.kind as HeroKind;
    const e = errands.find(x => x.hero === u.id);

    if (kind === 'ace') {
      if (u.engage && abilityProblem(s, owner, u.id) === null) doAbility(s, owner, u.id);
      continue;
    }

    if (kind === 'engineer') {
      if (u.hero.active?.kind === 'capture') continue;
      if (e && s.tick - e.since > ERRAND_TICKS) {
        drop(e, true);
        goHome(u);
        continue;
      }
      if (e && e.site) {
        const site = s.sites?.find(x => x.id === e.target);
        if (!site || (site.owner !== null && isAlly(s, owner, site.owner))) {
          drop(e, false);
          continue;
        }
        if (siteDist(u.x, u.y, site) > SITE_CAPTURE_RANGE && u.order.type === 'idle') goBeside(s, owner, u, siteBox(site));
        continue;
      }
      if (e) {
        const b = s.buildings.find(x => x.id === e.target);
        if (!b || b.hp <= 0 || !isEnemy(s, owner, b.owner)) {
          drop(e, false);
          continue;
        }
        if (guarded(buildingCentre(b), 5)) {
          drop(e, true);
          goHome(u);
          continue;
        }
        if (abilityProblem(s, owner, u.id, b.id) === null) doAbility(s, owner, u.id, b.id);
        else if (u.order.type === 'idle') goBeside(s, owner, u, b);
        continue;
      }
      if (front) {
        // With the wave: a structure it has reached that no one is left guarding, else keep up.
        const b = u.hero.abilityCd > 0 ? null : nearestEnemy(s, owner, u, skip, b => b.kind !== 'hq' && nearFront(buildingCentre(b)) && !guarded(buildingCentre(b), 5));
        if (b) {
          errands = errands.concat([{ hero: u.id, target: b.id, site: false, since: s.tick }]);
          goBeside(s, owner, u, b);
        } else follow(u);
        continue;
      }
      if (u.hero.abilityCd > 0) continue;
      const pick = engineerTarget(s, owner, u, skip, guarded);
      if (pick) {
        errands = errands.concat([{ hero: u.id, target: pick.id, site: pick.site, since: s.tick }]);
        goBeside(s, owner, u, pick.site ? siteBox(s.sites!.find(x => x.id === pick.id)!) : s.buildings.find(x => x.id === pick.id)!);
      } else if (u.order.type === 'idle') goHome(u);
      continue;
    }

    if (kind === 'commando') {
      if (e) {
        const b = s.buildings.find(x => x.id === e.target);
        const over = !b || b.hp <= 0 || !isEnemy(s, owner, b.owner) || b.chargeAt !== undefined;
        if (over || s.tick - e.since > ERRAND_TICKS || u.hp < maxHpOf(u) * 0.35) {
          drop(e, !over);
          if (escort.length) doMove(s, owner, escort, home.x, home.y, true);
          escort = [];
          goHome(u);
          continue;
        }
        if (abilityProblem(s, owner, u.id, b.id) === null) {
          doAbility(s, owner, u.id, b.id);
          continue;
        }
        if (u.order.type === 'idle' && !u.engage) goBeside(s, owner, u, b);
        const c = buildingCentre(b);
        const idle = escort.filter(id => alive.get(id)!.order.type === 'idle' && !alive.get(id)!.engage);
        if (idle.length) doMove(s, owner, idle, c.x, c.y, true);
        continue;
      }
      if (front && u.hp >= maxHpOf(u) * 0.45) {
        // With the wave: the nearest structure it has reached, unless their troops crowd it.
        const crowded = (p: Pt) => armedFoes.filter(f => dist(f.x, f.y, p.x, p.y) < 4).length > 2;
        const b =
          u.hero.abilityCd > 0
            ? null
            : nearestEnemy(s, owner, u, skip, b => b.chargeAt === undefined && nearFront(buildingCentre(b)) && !crowded(buildingCentre(b)));
        if (b) {
          errands = errands.concat([{ hero: u.id, target: b.id, site: false, since: s.tick }]);
          goBeside(s, owner, u, b);
        } else follow(u);
        continue;
      }
      if (u.hero.abilityCd > 0 || u.hp < maxHpOf(u) * 0.7 || dist(u.x, u.y, home.x, home.y) > 20) {
        if (u.order.type === 'idle') goHome(u);
        continue;
      }
      const target = loneStructure(s, owner, home, skip, armedFoes);
      if (!target) continue;
      const busy = new Set<number>([...mem.waveIds, ...mem.raidIds, ...(mem.siteParties ?? []).flatMap(p => p.ids)]);
      const guards = units
        .filter(
          v =>
            v.id !== u.id &&
            !v.hero &&
            !busy.has(v.id) &&
            !!unitSpecOf(s, v).weapon &&
            UNITS[v.kind].category !== 'air' &&
            !UNITS[v.kind].deploysTo &&
            (v.order.type === 'idle' || v.order.type === 'move') &&
            v.hp >= maxHpOf(v) * 0.7 &&
            dist(v.x, v.y, home.x, home.y) < 18,
        )
        .sort((a, b) => dist(a.x, a.y, u.x, u.y) - dist(b.x, b.y, u.x, u.y) || a.id - b.id)
        .slice(0, ESCORT_SIZE);
      if (!guards.length) continue;
      escort = guards.map(v => v.id);
      // Out of the wave the commander may have drafted them into.
      if (mem.waveIds.some(id => escort.includes(id))) mem.waveIds = mem.waveIds.filter(id => !escort.includes(id));
      errands = errands.concat([{ hero: u.id, target: target.id, site: false, since: s.tick }]);
      const c = buildingCentre(target);
      doMove(s, owner, escort, c.x, c.y, true);
      goBeside(s, owner, u, target);
      continue;
    }

    // The Spy.
    if (e) {
      const b = s.buildings.find(x => x.id === e.target);
      if (!b || b.hp <= 0 || !isEnemy(s, owner, b.owner) || s.tick - e.since > ERRAND_TICKS) {
        drop(e, !!b && b.hp > 0);
        goHome(u);
        continue;
      }
      if (abilityProblem(s, owner, u.id, b.id) === null) {
        doAbility(s, owner, u.id, b.id);
        drop(e, false);
        goHome(u);
      } else if (u.order.type === 'idle') goBeside(s, owner, u, b);
      continue;
    }
    const attackSoon = mem.wavePhase === 1 || s.tick >= mem.nextAttack - SPY_LEAD;
    if (u.hero.abilityCd === 0 && attackSoon && enemy.length) {
      const b = spyTarget(s, enemy, u, skip);
      if (b) {
        errands = errands.concat([{ hero: u.id, target: b.id, site: false, since: s.tick }]);
        goBeside(s, owner, u, b);
        continue;
      }
    }
    if (front) {
      // With the wave: its guns are busy with the wave, so a structure it has reached will do.
      const b = u.hero.abilityCd > 0 ? null : spyTarget(s, enemy.filter(x => nearFront(buildingCentre(x))), u, skip, false);
      if (b) {
        errands = errands.concat([{ hero: u.id, target: b.id, site: false, since: s.tick }]);
        goBeside(s, owner, u, b);
      } else follow(u);
      continue;
    }
    if (u.order.type === 'idle') goHome(u);
  }

  mem.heroErrands = errands;
  mem.heroEscort = escort;
  mem.heroRetry = retry;
  if (!errands.length) delete mem.heroErrands;
  if (!escort.length) delete mem.heroEscort;
  if (!retry.length) delete mem.heroRetry;
}

/**
 * The Academy, then the heroes in RECRUIT_ORDER. The computer spends whatever it has as it comes in,
 * so a hero is saved for: each decision a share of its credits goes into a fund (mem.heroFund) until
 * the fund covers the price, and the fund is handed back the moment the economy needs it (no
 * refinery, or no hauler) or nothing is left to recruit.
 */
function recruit(s: GameState, owner: Owner, diff: Difficulty, units: Unit[]): void {
  const p = s.players[owner];
  const mem = s.ai[owner];
  const fund = Number.isFinite(mem.heroFund) && (mem.heroFund as number) > 0 ? (mem.heroFund as number) : 0;
  const giveBack = () => {
    if (fund) p.credits += fund;
    delete mem.heroFund;
  };
  const broke =
    !hasBuilding(s, owner, 'refinery') || (!units.some(u => u.kind === 'hauler') && !p.queues.vehicle.some(q => q.kind === 'hauler'));
  let want: HeroKind | typeof HERO_ACADEMY | null = null;
  if (hasBuilding(s, owner, 'techcentre') && !broke) {
    if (!hasBuilding(s, owner, HERO_ACADEMY)) want = p.queues.building.some(q => q.kind === HERO_ACADEMY) ? null : HERO_ACADEMY;
    else want = RECRUIT_ORDER.find(k => heroRecruitProblem(s, owner, k) === null) ?? null;
  }
  if (!want) return giveBack();
  const cat = want === HERO_ACADEMY ? 'building' : UNITS[want].category;
  const need = costFor(s, owner, want);
  const next = Math.min(need, fund + Math.floor(p.credits * SAVE_SHARE[diff]));
  if (next < need) {
    p.credits -= next - fund;
    mem.heroFund = next;
    return;
  }
  p.credits += fund;
  if (canQueue(s, owner, cat, want)) {
    doQueue(s, owner, cat, want);
    delete mem.heroFund;
  } else {
    p.credits -= fund;
    if (fund) mem.heroFund = fund;
  }
}

/** A site as a footprint, for goBeside. */
function siteBox(site: Site): { x: number; y: number; w: number; h: number } {
  return { x: site.x, y: site.y, w: SITES[site.kind].w, h: SITES[site.kind].h };
}

/** Moves a unit to the edge of a footprint, on its own side of it. */
function goBeside(s: GameState, owner: Owner, u: Unit, t: Building | { x: number; y: number; w: number; h: number }): void {
  const w = 'kind' in t ? BUILDINGS[t.kind].w : t.w;
  const h = 'kind' in t ? BUILDINGS[t.kind].h : t.h;
  const x = Math.max(t.x - 0.5, Math.min(u.x, t.x + w + 0.5));
  const y = Math.max(t.y - 0.5, Math.min(u.y, t.y + h + 0.5));
  doMove(s, owner, [u.id], x, y, false);
}

/** The nearest undefended enemy structure (not a Command Yard) or site not held by this team. */
function engineerTarget(
  s: GameState,
  owner: Owner,
  u: Unit,
  skip: Set<number>,
  guarded: (p: Pt, r?: number) => boolean,
): { id: number; site: boolean } | null {
  let best: { id: number; site: boolean } | null = null;
  let bestScore = Infinity;
  for (const b of s.buildings) {
    if (b.hp <= 0 || b.kind === 'hq' || !isStructure(b) || !isEnemy(s, owner, b.owner) || skip.has(b.id)) continue;
    const c = buildingCentre(b);
    if (guarded(c)) continue;
    // A structure is worth more than a site: counted as if eight tiles nearer.
    const score = dist(u.x, u.y, c.x, c.y) - 8;
    if (score < bestScore || (score === bestScore && best && b.id < best.id)) {
      bestScore = score;
      best = { id: b.id, site: false };
    }
  }
  for (const site of s.sites ?? []) {
    if (skip.has(site.id) || (site.owner !== null && isAlly(s, owner, site.owner))) continue;
    const c = { x: site.x + SITES[site.kind].w / 2, y: site.y + SITES[site.kind].h / 2 };
    if (guarded(c, 6)) continue;
    const score = dist(u.x, u.y, c.x, c.y);
    if (score < bestScore) {
      bestScore = score;
      best = { id: site.id, site: true };
    }
  }
  return best;
}

/**
 * An enemy structure out on its own: no gun of theirs within 7 tiles and no more than three armed
 * units near it; of those, the one with fewest neighbours within 6 tiles, then the nearest home.
 */
function loneStructure(s: GameState, owner: Owner, home: Pt, skip: Set<number>, armedFoes: Unit[]): Building | null {
  const theirs = s.buildings.filter(b => b.hp > 0 && isEnemy(s, owner, b.owner) && isStructure(b));
  let best: Building | null = null;
  let bestScore = Infinity;
  for (const b of theirs) {
    if (b.kind === 'hq' || skip.has(b.id) || buildingSpecOf(s, b).weapon) continue;
    const c = buildingCentre(b);
    if (theirs.some(o => !!buildingSpecOf(s, o).weapon && distToBuilding(c.x, c.y, o) < GUARD_RANGE)) continue;
    if (armedFoes.filter(f => dist(f.x, f.y, c.x, c.y) < GUARD_RANGE).length > 3) continue;
    const neighbours = theirs.filter(o => o !== b && distToBuilding(c.x, c.y, o) < 6).length;
    const score = neighbours * 6 + dist(home.x, home.y, c.x, c.y);
    if (score < bestScore || (score === bestScore && best && b.id < best.id)) {
      bestScore = score;
      best = b;
    }
  }
  return best;
}

/** What the Spy goes for ahead of an attack, most useful first; the nearest of that kind. */
const SPY_ORDER: Building['kind'][] = ['power', 'factory', 'barracks', 'refinery', 'uplink', 'hq'];

function spyTarget(s: GameState, enemy: Building[], u: Unit, skip: Set<number>, wary = true): Building | null {
  // A Spy is seen within two tiles of anything of theirs: a structure a gun covers is a lost Spy,
  // unless a wave is there to keep the guns busy (wary false).
  const guns = wary ? enemy.filter(b => b.hp > 0 && !!buildingSpecOf(s, b).weapon) : [];
  for (const kind of SPY_ORDER) {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of enemy) {
      if (b.kind !== kind || b.hp <= 0 || skip.has(b.id)) continue;
      const c = buildingCentre(b);
      if (guns.some(g => distToBuilding(c.x, c.y, g) < (buildingSpecOf(s, g).weapon!.range ?? 0) + 2)) continue;
      const d = distToBuilding(u.x, u.y, b);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * The middle of this side's wave while it is attacking (phase 2), from the members near the middle
 * as the commander reckons it; null with no wave out, or one down to a couple of units.
 */
function waveFront(s: GameState, mem: AiMemory, alive: Map<number, Unit>): Pt | null {
  if (mem.wavePhase !== 2 || !Array.isArray(mem.waveIds)) return null;
  const members = mem.waveIds.map(id => alive.get(id)).filter((u): u is Unit => !!u && u.hp > 0);
  if (members.length < 3) return null;
  let c = middle(members);
  const near = members.filter(u => dist(u.x, u.y, c.x, c.y) < 12);
  if (near.length >= members.length / 2) c = middle(near);
  return c;
}

/** The enemy structure nearest the unit that passes `ok`, not one being left alone for now. */
function nearestEnemy(s: GameState, owner: Owner, u: Unit, skip: Set<number>, ok: (b: Building) => boolean): Building | null {
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of s.buildings) {
    if (b.hp <= 0 || !isStructure(b) || !isEnemy(s, owner, b.owner) || skip.has(b.id) || !ok(b)) continue;
    const d = distToBuilding(u.x, u.y, b);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function middle(list: Unit[]): Pt {
  let x = 0;
  let y = 0;
  for (const u of list) {
    x += u.x;
    y += u.y;
  }
  return { x: x / list.length, y: y / list.length };
}

function toward(a: Pt, b: Pt, by: number): Pt {
  const d = dist(a.x, a.y, b.x, b.y) || 1;
  return { x: a.x + ((b.x - a.x) / d) * by, y: a.y + ((b.y - a.y) / d) * by };
}
