/**
 * Grand War, G2 (fireline-grand-war-design.md): diplomacy in real time. Pure, like the rest of
 * src/sim/: no clock, no unseeded dice. Every function is a no-op without `setup.grand.diplomacy` in a
 * free-for-all Grand War, so every other battle is untouched.
 *
 * The planet war's rules, read in minutes instead of turns, with its numbers (rules.ts):
 *
 *  - Stance per pair: war, ceasefire, trade pact, alliance. Every side starts at war with every other.
 *    Sides not at war never fire on each other (sides.ts isEnemy); allies also share sight and win
 *    together (isAlly). A treaty runs TREATY_MINUTES and must be renewed: one that runs out is war
 *    again, and each side's trust in the other rises a little for a treaty kept.
 *  - Trust, 0 to 100, side a's in side b. Each beat it drifts with the stance (a pact +1, an
 *    alliance +2, war -1, a shared enemy +1), within TRUST_FLOOR and TRUST_CEILING. Declaring war
 *    through a treaty still running is a breach: the victim's trust falls BREACH_VICTIM, everyone
 *    else's BREACH_OTHERS.
 *  - The computer judges a proposal on strength, fronts, its temperament, its interest in war and its
 *    trust (`proposalScore`), and accepts at TREATY_ACCEPT; an alliance also needs its allianceTrust.
 *  - Every beat each computer side makes at most one move: war through a treaty if its temperament
 *    breaks treaties and its interest is high enough, otherwise a proposal (renewal first). A
 *    proposal to another computer side is judged at once; one to the player waits as an offer.
 *
 * Changing stance also drops any attack the two sides had under way on each other.
 */
import {
  BREACH_OTHERS,
  BREACH_VICTIM,
  DIPLO_BEAT,
  GRAND_TEMPERS,
  SIDE_NAMES,
  MAX_SIDES,
  OFFER_TICKS,
  PROPOSAL_COOL,
  TREATY_ACCEPT,
  TREATY_KEPT,
  TREATY_MINUTES,
  TREATY_NAME,
  TRUST_CEILING,
  TRUST_FLOOR,
  TRUST_START,
  UNITS,
  type GrandTemperSpec,
  type Owner,
} from './rules';
import { cityCounts, citiesOf, grandOn, townsHeld, townsOf } from './cities';
import { next, seedFromString } from './rng';
import { enemiesOf, isAlly, isEnemy, sidesOf, stanceOf } from './sides';
import type { GameState, GrandTemper, TreatyKind } from './types';

type Say = (s: GameState, text: string, tone: 'info' | 'good' | 'bad') => void;

const TEMPERS: GrandTemper[] = ['expansionist', 'mercantile', 'defensive'];
/** Minutes before a treaty with the player runs out that the player is warned, and the computer renews its own. */
const RENEW_TICKS = 1200;
/** War interest above which a side wants war on someone it is at peace with. */
const WAR_WANT = 25;
/** War interest a power gains with no independent town left and no more cities than a neighbour (an expansionist, and the rest). */
const ROOM_EXPANSIONIST = 25;
const ROOM_OTHERS = 10;
/** War interest against a power within DOMINION_NEAR points of the dominion share. */
const DOMINION_THREAT = 40;
const DOMINION_NEAR = 10;
/** A breaker breaks a dated treaty only while its trust in the other is at most this. */
const BREACH_TRUST_MAX = 60;

export const idx = (a: Owner, b: Owner): number => a * MAX_SIDES + b;

/** The list turned by `by` places: [a, b, c] by 1 is [b, c, a]. */
const rotate = <T>(xs: readonly T[], by: number): T[] => (xs.length ? [...xs.slice(by % xs.length), ...xs.slice(0, by % xs.length)] : []);

/** True in a Grand War with diplomacy (free-for-all, the stance table present). */
export const diplomacyOn = (s: GameState): boolean => grandOn(s) && s.setup!.grand!.diplomacy && s.setup!.mode === 'ffa' && typeof s.grand?.stance === 'string';

export const temperOf = (s: GameState, o: Owner): GrandTemperSpec | null => {
  const t = s.grand?.temper?.[o];
  return t ? GRAND_TEMPERS[t] : null;
};
export const trustOf = (s: GameState, a: Owner, b: Owner): number => s.grand?.trust?.[idx(a, b)] ?? TRUST_START;
export const endsOf = (s: GameState, a: Owner, b: Owner): number => s.grand?.ends?.[idx(a, b)] ?? 0;

/** The powers by name in the war's news: the battle's own side names (SIDE_NAMES), with "the". */
export const SIDE_NAMES_GRAND = ['We', ...[1, 2, 3].map(o => `the ${SIDE_NAMES[o as Owner]}`)];

// ---------------------------------------------------------------------------------------------
// The start

/** A new Grand War with diplomacy: every pair at war, trust at its start, each computer side a temperament. */
export function startDiplomacy(s: GameState): void {
  const g = s.setup?.grand;
  if (!g || !g.diplomacy || s.setup!.mode !== 'ffa' || !s.grand) return;
  const n = MAX_SIDES * MAX_SIDES;
  let seed = seedFromString(`${s.seedText}|grand-temper`);
  const temper = sidesOf(s).map(o => {
    if (o === 0) return null;
    const r = next(seed);
    seed = r.seed;
    return TEMPERS[Math.floor(r.value * TEMPERS.length)];
  });
  s.grand = { ...s.grand, stance: 'w'.repeat(n), ends: new Array(n).fill(0), trust: new Array(n).fill(TRUST_START), cool: new Array(n).fill(0), temper, offers: [] };
}

// ---------------------------------------------------------------------------------------------
// Changing stance (on a cloned state)

function setPair(s: GameState, a: Owner, b: Owner, stance: 'w' | TreatyKind, ends: number): void {
  const g = s.grand!;
  const chars = g.stance!.split('');
  chars[idx(a, b)] = stance;
  chars[idx(b, a)] = stance;
  const e = g.ends!.slice();
  e[idx(a, b)] = ends;
  e[idx(b, a)] = ends;
  s.grand = { ...g, stance: chars.join(''), ends: e };
  if (stance !== 'w') standDown(s, a, b);
}

/** Two sides now at peace: attacks either had under way on the other are dropped. */
function standDown(s: GameState, a: Owner, b: Owner): void {
  const ownerOf = new Map<number, Owner>();
  for (const u of s.units) ownerOf.set(u.id, u.owner);
  for (const x of s.buildings) ownerOf.set(x.id, x.owner);
  const other = (o: Owner): Owner | null => (o === a ? b : o === b ? a : null);
  for (const u of s.units) {
    const them = other(u.owner);
    if (them === null) continue;
    if (u.engage && ownerOf.get(u.engage) === them) u.engage = 0;
    if (u.order.type === 'attack' && ownerOf.get(u.order.target) === them) u.order = { type: 'idle' };
    if (u.queue.some(q => q.type === 'attack' && ownerOf.get(q.target) === them)) u.queue = u.queue.filter(q => !(q.type === 'attack' && ownerOf.get(q.target) === them));
  }
  for (const x of s.buildings) {
    const them = other(x.owner);
    if (them !== null && x.engage && ownerOf.get(x.engage) === them) x.engage = 0;
  }
}

function shiftTrust(s: GameState, a: Owner, b: Owner, by: number): void {
  const t = s.grand!.trust!.slice();
  t[idx(a, b)] = Math.max(0, Math.min(100, t[idx(a, b)] + by));
  s.grand = { ...s.grand!, trust: t };
}

const name = (o: Owner): string => SIDE_NAMES_GRAND[o];
/** A name at the start of a sentence. */
const Name = (o: Owner): string => name(o).charAt(0).toUpperCase() + name(o).slice(1);
/** "a ceasefire", "a trade pact", "an alliance". */
const aTreaty = (k: TreatyKind): string => `${k === 'a' ? 'an' : 'a'} ${TREATY_NAME[k]}`;
/** Side 0 under the harness's autopilot answers and moves as a defensive computer side would. */
const bot = (s: GameState, o: Owner): boolean => o !== 0 || !!s.autopilot;
const temperFor = (s: GameState, o: Owner): GrandTemperSpec | null => temperOf(s, o) ?? (o === 0 && s.autopilot ? GRAND_TEMPERS.defensive : null);

/** A treaty signed: the stance, its end, and the news. */
function enact(s: GameState, a: Owner, b: Owner, kind: TreatyKind, say: Say): void {
  const renewal = stanceOf(s, a, b) === kind;
  setPair(s, a, b, kind, s.tick + TREATY_MINUTES[kind] * 600);
  const offers = s.grand!.offers?.filter(o => !(o.from === a && b === 0) && !(o.from === b && a === 0));
  if (offers) s.grand = { ...s.grand!, offers };
  const who = a === 0 ? Name(b) : b === 0 ? Name(a) : null;
  const what = TREATY_NAME[kind];
  const other = a === 0 ? b : a;
  if (who) say(s, renewal ? `The ${what} with ${name(other)} is renewed for ${TREATY_MINUTES[kind]} minutes.` : `${who}: ${aTreaty(kind)} is signed, for ${TREATY_MINUTES[kind]} minutes.`, 'good');
  else if (!renewal) say(s, `${Name(a)} and ${name(b)} sign ${aTreaty(kind)}.`, 'info');
}

/** War declared by `a` on `b`; a breach when a treaty between them is still running. */
function declare(s: GameState, a: Owner, b: Owner, say: Say): void {
  const breach = stanceOf(s, a, b) !== 'w' && endsOf(s, a, b) > s.tick;
  setPair(s, a, b, 'w', 0);
  if (breach) {
    shiftTrust(s, b, a, -BREACH_VICTIM);
    for (const o of sidesOf(s)) if (o !== a && o !== b) shiftTrust(s, o, a, -BREACH_OTHERS);
  }
  const offers = s.grand!.offers?.filter(o => !((o.from === a || o.from === b) && (a === 0 || b === 0)));
  if (offers) s.grand = { ...s.grand!, offers };
  if (a === 0) say(s, breach ? `We have broken our treaty with ${name(b)}. Every power will remember it.` : `We are at war with ${name(b)}.`, 'bad');
  else if (b === 0) say(s, breach ? `${Name(a)} has broken its treaty with us and declared war.` : `${Name(a)} has declared war on us.`, 'bad');
  else say(s, breach ? `${Name(a)} has broken its treaty with ${name(b)}.` : `${Name(a)} is at war with ${name(b)}.`, 'info');
}

// ---------------------------------------------------------------------------------------------
// Judging

/** A side's strength: what its armed units cost, and 400 a city or town. */
export function strengthOf(s: GameState, o: Owner): number {
  let n = 0;
  for (const u of s.units) if (u.owner === o && u.hp > 0 && UNITS[u.kind].weapon) n += UNITS[u.kind].cost;
  return n + 400 * (citiesOf(s, o).length + townsHeld(s, o).length);
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** How much `j` wants war on `b` (positive: wants it), and the reasons that argue for it. */
export function warInterest(s: GameState, j: Owner, b: Owner): { value: number; forWar: string[] } {
  const T = temperFor(s, j) ?? GRAND_TEMPERS.defensive;
  const pj = strengthOf(s, j);
  const pb = Math.max(1, strengthOf(s, b));
  const forWar: string[] = [];
  let v = 25 * clamp(pj / pb - T.attackRatio, -1, 1) + T.warBias;
  if (pj / pb > T.attackRatio) forWar.push('They think you weak.');
  // The power holding most cities is everyone's concern.
  const { byTeam } = cityCounts(s);
  const mine = byTeam.get(b) ?? 0;
  const most = Math.max(0, ...[...byTeam.entries()].filter(([k]) => k !== b).map(([, n]) => n));
  if (mine >= most + 2) {
    v += 15;
    forWar.push('You hold too many cities.');
  }
  // Close to dominion: every other power's concern above all else.
  const g = s.setup?.grand;
  const { total } = cityCounts(s);
  if (g && total && mine * 100 >= (g.dominionShare - DOMINION_NEAR) * total) {
    v += DOMINION_THREAT;
    forWar.push('You are close to ruling the cities.');
  }
  // No room to grow: every town taken and no more cities than this neighbour. Peace then only freezes
  // the map, and a power that means to grow must take from someone (an expansionist most of all).
  if (!townsOf(s).some(t => t.owner === null) && (byTeam.get(j) ?? 0) <= mine) {
    v += T.warBias >= 10 ? ROOM_EXPANSIONIST : ROOM_OTHERS;
    forWar.push('They have no room left to grow.');
  }
  const fronts = enemiesOf(s, j).length - (isEnemy(s, j, b) ? 1 : 0);
  v -= 10 * fronts;
  return { value: Math.round(v * 100) / 100, forWar };
}

/** How `judge` scores a treaty of this kind with `other`, and why. */
export function proposalScore(s: GameState, judge: Owner, other: Owner, kind: TreatyKind): { score: number; reasons: string[]; against: string[] } {
  const T = temperFor(s, judge) ?? GRAND_TEMPERS.defensive;
  const reasons: string[] = [];
  /** The reasons that argue against signing: what a refusal names. */
  const against: string[] = [];
  const con = (r: string): void => {
    reasons.push(r);
    against.push(r);
  };
  const pj = Math.max(1, strengthOf(s, judge));
  const po = strengthOf(s, other);
  const wars = enemiesOf(s, judge);
  let base = 0;
  if (kind === 'c') {
    const war = isEnemy(s, judge, other) ? 10 : 0;
    const rel = 25 * clamp((po - pj) / pj, -1, 1);
    const fronts = 10 * (wars.length - 1);
    base = war + rel + fronts + T.ceasefireBias;
    if (rel > 5) reasons.push('They fear your strength.');
    else if (rel < -5) con('They feel the stronger side.');
    if (fronts > 0) reasons.push('They are fighting on several fronts.');
  } else if (kind === 'p') {
    base = 5 + T.tradeBias;
    if (T.tradeBias >= 20) reasons.push('They value trade.');
  } else {
    const common = wars.filter(e => e !== other && isEnemy(s, other, e)).length;
    const clash = sidesOf(s).some(p => p !== judge && p !== other && stanceOf(s, judge, p) === 'a' && isEnemy(s, other, p)) ? 1 : 0;
    base = T.allianceBias + 20 * common - 25 * clash;
    if (common) reasons.push('You share an enemy.');
    if (clash) con('You are at war with one of their allies.');
    if (other === 0 && handsDominion(s, judge)) {
      base -= 100;
      con('An alliance would hand you the war.');
    }
  }
  const wi = warInterest(s, judge, other);
  const pull = kind === 'c' ? 0.8 : 1;
  base += wi.value > 0 ? -pull * wi.value : -0.2 * wi.value;
  if (wi.value > 5) for (const r of wi.forWar) con(r);
  const trust = (trustOf(s, judge, other) - 50) / 2;
  if (trust >= 5) reasons.push('They trust you.');
  else if (trust <= -5) con('They do not trust you.');
  if (kind === 'p' && T.tradeBias < 10 && !against.length) con('They see little in trade.');
  return { score: Math.round((base + trust) * 100) / 100, reasons, against };
}

/** True when allying the player with `j` would put the player's side over the dominion share. */
function handsDominion(s: GameState, j: Owner): boolean {
  const g = s.setup!.grand!;
  const { total } = cityCounts(s);
  if (!total) return false;
  let ours = 0;
  for (const o of sidesOf(s)) if (o === 0 || o === j || stanceOf(s, 0, o) === 'a') ours += citiesOf(s, o).length + townsHeld(s, o).length;
  return ours * 100 >= g.dominionShare * total;
}

export function verdict(s: GameState, judge: Owner, other: Owner, kind: TreatyKind): { accept: boolean; score: number; reasons: string[]; against: string[] } {
  const { score, reasons, against } = proposalScore(s, judge, other, kind);
  let accept = score >= TREATY_ACCEPT[kind];
  const T = temperFor(s, judge) ?? GRAND_TEMPERS.defensive;
  if (kind === 'a' && trustOf(s, judge, other) < T.allianceTrust) {
    accept = false;
    reasons.push('They do not trust you enough for an alliance.');
    against.push('They do not trust you enough for an alliance.');
  }
  return { accept, score, reasons, against };
}

// ---------------------------------------------------------------------------------------------
// The player's actions

export type DiplomacyAct = 'ceasefire' | 'pact' | 'alliance' | 'war';
const KIND_OF: Record<Exclude<DiplomacyAct, 'war'>, TreatyKind> = { ceasefire: 'c', pact: 'p', alliance: 'a' };

/** What a proposal of this kind needs the stance to be now (a renewal of the same kind is always open). */
const FROM: Record<TreatyKind, string> = { c: 'wc', p: 'cp', a: 'cpa' };

/** Why `a` may not take this step toward `b` now, or null. */
export function diplomacyProblem(s: GameState, a: Owner, b: unknown, act: unknown): string | null {
  if (!diplomacyOn(s)) return 'No diplomacy in this battle';
  if (!Number.isInteger(b) || b === a || !sidesOf(s).includes(b as Owner)) return 'Not a power in this war';
  if (!s.buildings.some(x => x.owner === b && x.hp > 0)) return 'That power is out of the war';
  const st = stanceOf(s, a, b as Owner)!;
  if (act === 'war') return st === 'w' ? 'Already at war' : null;
  if (act !== 'ceasefire' && act !== 'pact' && act !== 'alliance') return 'Not a diplomatic step';
  const kind = KIND_OF[act];
  if (!FROM[kind].includes(st)) return kind === 'p' ? 'A trade pact needs a ceasefire first' : kind === 'a' ? 'An alliance needs a ceasefire first' : 'Already at peace';
  if (st === kind && endsOf(s, a, b as Owner) - s.tick > RENEW_TICKS) return `The ${TREATY_NAME[kind]} runs ${Math.ceil((endsOf(s, a, b as Owner) - s.tick) / 600)} minutes more`;
  if ((s.grand!.cool![idx(a, b as Owner)] ?? 0) > s.tick) return `Wait ${Math.ceil((s.grand!.cool![idx(a, b as Owner)] - s.tick) / 10)} seconds before proposing again`;
  return null;
}

/** The step taken (diplomacyProblem was null). A proposal to a computer side is judged at once. */
export function doDiplomacy(s: GameState, a: Owner, b: Owner, act: DiplomacyAct, say: Say): void {
  if (act === 'war') {
    declare(s, a, b, say);
    return;
  }
  const kind = KIND_OF[act];
  const cool = s.grand!.cool!.slice();
  cool[idx(a, b)] = s.tick + PROPOSAL_COOL;
  s.grand = { ...s.grand!, cool };
  const v = verdict(s, b, a, kind);
  if (v.accept) enact(s, a, b, kind, say);
  else if (a === 0) say(s, `${Name(b)} declines ${aTreaty(kind)}. ${(v.against.length ? v.against : ['The terms do not suit them.']).slice(0, 2).join(' ')}`, 'bad');
}

/** Why the player may not answer this offer now, or null. */
export function answerProblem(s: GameState, offer: unknown): string | null {
  if (!diplomacyOn(s)) return 'No diplomacy in this battle';
  const o = s.grand!.offers!.find(x => x.id === offer);
  if (!o) return 'No such offer';
  if (o.expires <= s.tick) return 'The offer has lapsed';
  if (!FROM[o.kind].includes(stanceOf(s, 0, o.from)!)) return 'The offer no longer fits';
  return null;
}

export function doAnswer(s: GameState, offer: number, accept: boolean, say: Say): void {
  const o = s.grand!.offers!.find(x => x.id === offer)!;
  s.grand = { ...s.grand!, offers: s.grand!.offers!.filter(x => x.id !== offer) };
  if (accept) enact(s, o.from, 0, o.kind, say);
  else {
    shiftTrust(s, o.from, 0, -2);
    say(s, `We decline the ${TREATY_NAME[o.kind]} ${name(o.from)} offered.`, 'info');
  }
}

// ---------------------------------------------------------------------------------------------
// The beat

export function diplomacyStep(s: GameState, say: Say): void {
  if (!diplomacyOn(s) || s.winner !== null || s.tick === 0 || s.tick % DIPLO_BEAT !== 0) return;
  const alive = sidesOf(s).filter(o => s.buildings.some(b => b.owner === o && b.hp > 0));
  // 1. Treaties that run out: kept to the end, trust rises; a ceasefire's end is war again, a pact's or
  //    an alliance's a ceasefire's end, so each lapses a step at a time.
  for (let i = 0; i < alive.length; i++)
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      const st = stanceOf(s, a, b)!;
      const ends = endsOf(s, a, b);
      if (st === 'w') continue;
      if (ends <= s.tick) {
        shiftTrust(s, a, b, TREATY_KEPT);
        shiftTrust(s, b, a, TREATY_KEPT);
        const down = st === 'c' ? 'w' : 'c';
        setPair(s, a, b, down, down === 'w' ? 0 : s.tick + TREATY_MINUTES.c * 600);
        if (a === 0 || b === 0) say(s, `The ${TREATY_NAME[st as TreatyKind]} with ${name(a === 0 ? b : a)} has run out.${down === 'w' ? ' We are at war again.' : ' A ceasefire holds for now.'}`, down === 'w' ? 'bad' : 'info');
      } else if ((a === 0 || b === 0) && ends - s.tick <= RENEW_TICKS && ends - s.tick > RENEW_TICKS - DIPLO_BEAT) {
        say(s, `The ${TREATY_NAME[st as TreatyKind]} with ${name(a === 0 ? b : a)} runs out in ${Math.round((ends - s.tick) / 600)} minutes. Renew it on the Diplomacy panel.`, 'info');
      }
    }
  // 2. Trust drift.
  for (let i = 0; i < alive.length; i++)
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i];
      const b = alive[j];
      const st = stanceOf(s, a, b);
      let by = st === 'p' ? 1 : st === 'a' ? 2 : st === 'w' ? -1 : 0;
      if (alive.some(c => c !== a && c !== b && isEnemy(s, a, c) && isEnemy(s, b, c))) by += 1;
      if (!by) continue;
      for (const [x, y] of [[a, b], [b, a]] as [Owner, Owner][]) {
        const t = trustOf(s, x, y);
        if (by > 0 && t < TRUST_CEILING) shiftTrust(s, x, y, Math.min(by, TRUST_CEILING - t));
        else if (by < 0 && t > TRUST_FLOOR) shiftTrust(s, x, y, Math.max(by, TRUST_FLOOR - t));
      }
    }
  // 3. Lapsed offers.
  if (s.grand!.offers!.some(o => o.expires <= s.tick)) s.grand = { ...s.grand!, offers: s.grand!.offers!.filter(o => o.expires > s.tick) };
  // 4. Each computer side's move.
  // In turn, and the turn rotates each beat: moving in seat order gave seat 1 first pick of every
  // partner every beat, and left the last seat the odd one out of every alliance.
  const beat = Math.floor(s.tick / DIPLO_BEAT);
  for (const j of rotate(alive, beat)) if (bot(s, j)) computerMove(s, j, alive, say);
}

function propose(s: GameState, j: Owner, b: Owner, kind: TreatyKind, say: Say): void {
  const cool = s.grand!.cool!.slice();
  cool[idx(j, b)] = s.tick + PROPOSAL_COOL;
  s.grand = { ...s.grand!, cool };
  if (b === 0 && !s.autopilot) {
    if (s.grand!.offers!.some(o => o.from === j)) return;
    const offer = { id: s.nextId++, from: j, kind, expires: s.tick + OFFER_TICKS };
    s.grand = { ...s.grand!, offers: [...s.grand!.offers!, offer] };
    const renewal = stanceOf(s, j, 0) === kind;
    say(s, `${Name(j)} ${renewal ? 'offers to renew' : 'proposes'} ${aTreaty(kind)}. Answer on the Diplomacy panel.`, 'info');
    return;
  }
  if (verdict(s, b, j, kind).accept) enact(s, j, b, kind, say);
}

function computerMove(s: GameState, j: Owner, alive: Owner[], say: Say): void {
  const T = temperFor(s, j);
  if (!T) return;
  const ready = (b: Owner) => (s.grand!.cool![idx(j, b)] ?? 0) <= s.tick;
  // Partners in turn too, rotated by the beat and the side, for the same reason.
  const others = rotate(alive.filter(b => b !== j), Math.floor(s.tick / DIPLO_BEAT) + j);
  // War: through a running treaty only for a temperament that breaks them, and only while trust is low.
  for (const b of others) {
    const st = stanceOf(s, j, b);
    if (st === 'w' || st === 'a') continue;
    const wi = warInterest(s, j, b).value;
    if (wi <= WAR_WANT) continue;
    const dated = endsOf(s, j, b) > s.tick;
    // Once a power's dominion clock runs, any temperament breaks a treaty to stop it.
    const ruling = !!s.grand?.dominion && isAlly(s, s.grand.dominion.team, b);
    if (dated && !ruling && (T.breakAt === null || wi <= T.breakAt || trustOf(s, j, b) > BREACH_TRUST_MAX)) continue;
    declare(s, j, b, say);
    return;
  }
  // Renewal: a treaty it is glad of, about to run out.
  for (const b of others) {
    const st = stanceOf(s, j, b)!;
    if (st === 'w' || endsOf(s, j, b) - s.tick > RENEW_TICKS || !ready(b)) continue;
    // A power that wants war lets the treaty in its way run out rather than break it.
    if (warInterest(s, j, b).value > WAR_WANT) continue;
    if (verdict(s, j, b, st as TreatyKind).accept) {
      propose(s, j, b, st as TreatyKind, say);
      return;
    }
  }
  // A step up: peace, then a pact, then an alliance, where it would sign one itself.
  for (const kind of ['c', 'p', 'a'] as TreatyKind[])
    for (const b of others) {
      const st = stanceOf(s, j, b)!;
      if (!FROM[kind].includes(st) || st === kind || !ready(b)) continue;
      const v = verdict(s, j, b, kind);
      if (v.score < TREATY_ACCEPT[kind] + 5 || !v.accept) continue;
      propose(s, j, b, kind, say);
      return;
    }
}

/** A Grand War's diplomacy, repaired for a save; drops it when unsound. Works on the migrated state's grand block. */
export function migrateDiplomacy(s: GameState): void {
  const g = s.grand;
  if (!g) return;
  const n = MAX_SIDES * MAX_SIDES;
  const want = !!s.setup?.grand?.diplomacy && s.setup.mode === 'ffa';
  const nums = (v: unknown, lo: number, hi: number) => Array.isArray(v) && v.length === n && v.every(x => Number.isInteger(x) && x >= lo && x <= hi);
  const sound =
    want &&
    typeof g.stance === 'string' &&
    g.stance.length === n &&
    /^[wcpa]+$/.test(g.stance) &&
    nums(g.ends, 0, 1e9) &&
    nums(g.trust, 0, 100) &&
    nums(g.cool, 0, 1e9) &&
    Array.isArray(g.temper) &&
    g.temper.length === s.players.length &&
    g.temper.every((t, o) => (o === 0 ? t === null : TEMPERS.includes(t as GrandTemper))) &&
    Array.isArray(g.offers) &&
    g.offers.every(o => o && Number.isInteger(o.id) && sidesOf(s).includes(o.from) && o.from !== 0 && ['c', 'p', 'a'].includes(o.kind) && Number.isInteger(o.expires));
  if (sound) {
    // Symmetric, or not trusted.
    for (const a of sidesOf(s)) for (const b of sidesOf(s)) if (g.stance![idx(a, b)] !== g.stance![idx(b, a)] || g.ends![idx(a, b)] !== g.ends![idx(b, a)]) return dropDiplomacy(s, want);
    return;
  }
  dropDiplomacy(s, want);
}

/** An unsound table: everyone back at war, trust at its start (a save is never trusted blind). */
function dropDiplomacy(s: GameState, want: boolean): void {
  const { stance: _a, ends: _b, trust: _c, cool: _d, temper: _e, offers: _f, ...rest } = s.grand!;
  s.grand = rest;
  if (want) startDiplomacy(s);
}

