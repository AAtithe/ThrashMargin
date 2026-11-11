/**
 * War for the Planet: treaties, trust and how a computer faction judges a proposal
 * (fireline-planet-design.md, section 8). W1. Pure.
 */
import { defenceEstimate, power, strengthOf } from './battleSetup';
import { factionIncome } from './economy';
import { listNames, note } from './journal';
import { planetMapOf } from './map';
import {
  ACCEPT_AT,
  AI_CREDITS_PER_POINT,
  AI_RESERVE,
  AI_TREATY_SHARE,
  ATTACK_CREDITS,
  COALITION_ALLIANCE,
  LEADER_BAND,
  PAYMENT_MAX,
  ROUTE_MAX_HOPS,
  TEMPERAMENTS,
  TERM_AMOUNT_MAX,
  TREATY_TERMS_MAX,
  TREATY_TURNS,
  TRUST_DRIFT_MAX,
  TRUST_DRIFT_MIN,
  VALUE,
  WAR_INTEREST,
  type TemperamentSpec,
} from './rules';
import { aliveFaction, atWar, isInt, sortTreaties, stanceOf, treatyBetween } from './state';
import { pruneRoutes, routePartner, routeYield } from './trade';
import { regionShare } from './victory';
import { NEUTRAL, RESOURCES, type FactionId, type PlanetState, type Resource, type Treaty, type TreatyDraft, type TreatyKind, type TreatyTerm } from './types';

export { stanceOf };

const isResource = (v: unknown): v is Resource => typeof v === 'string' && (RESOURCES as string[]).includes(v);
const isKind = (v: unknown): v is TreatyKind => v === 'ceasefire' || v === 'trade' || v === 'alliance';

export const TREATY_NAMES: Record<TreatyKind, string> = { ceasefire: 'ceasefire', trade: 'trade pact', alliance: 'alliance' };

/** A faction's temperament spec; the player (who has none) is judged as an expansionist. */
export const specOf = (s: PlanetState, f: FactionId): TemperamentSpec => TEMPERAMENTS[s.factions[f]?.temperament ?? 'expansionist'];

export function clampTrust(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Changes how far `who` trusts `toward` (draft state, in place). */
export function shiftTrust(d: PlanetState, who: number, toward: number, by: number): void {
  if (who === toward || who < 0 || toward < 0 || !d.trust[who]) return;
  d.trust[who][toward] = clampTrust(d.trust[who][toward] + by);
}

export const termValue = (res: Resource, amount: number): number => amount * VALUE[res];

// ---- Validation (section 8.2) -----------------------------------------------------------------

/** Why this draft between a and b is invalid now, or null. Every field is checked. */
export function draftProblem(s: PlanetState, a: unknown, b: unknown, draft: unknown): string | null {
  if (!aliveFaction(s, a) || !aliveFaction(s, b)) return 'That faction is out of the war.';
  if (a === b) return 'A treaty needs two factions.';
  if (!draft || typeof draft !== 'object') return 'Bad treaty.';
  const dr = draft as TreatyDraft;
  if (!isKind(dr.kind)) return 'Bad treaty.';
  const lim = TREATY_TURNS[dr.kind];
  if (dr.turns === null) {
    if (!lim.open) return 'A ceasefire needs a length.';
  } else if (!isInt(dr.turns, lim.min, lim.max)) return `A ${TREATY_NAMES[dr.kind]} lasts ${lim.min} to ${lim.max} turns${lim.open ? ', or open-ended' : ''}.`;
  if (!Array.isArray(dr.terms) || dr.terms.length > TREATY_TERMS_MAX) return `At most ${TREATY_TERMS_MAX} terms.`;
  const sig = (f: unknown) => f === a || f === b;
  const grantors: number[] = [];
  for (const t of dr.terms as TreatyTerm[]) {
    if (!t || typeof t !== 'object') return 'Bad term.';
    switch (t.k) {
      case 'tribute':
        if (!sig(t.from) || !isResource(t.res) || !isInt(t.amount, 1, TERM_AMOUNT_MAX)) return 'Bad tribute term.';
        break;
      case 'exchange':
        if (dr.kind === 'ceasefire') return 'Exchanges need a trade pact or an alliance.';
        if (!sig(t.from) || !isResource(t.give) || !isResource(t.get) || t.give === t.get) return 'Bad exchange term.';
        if (!isInt(t.giveAmount, 1, TERM_AMOUNT_MAX) || !isInt(t.getAmount, 1, TERM_AMOUNT_MAX)) return 'Bad exchange term.';
        break;
      case 'access':
        if (!sig(t.grantor) || grantors.includes(t.grantor)) return 'Bad access term.';
        grantors.push(t.grantor);
        break;
      case 'split': {
        if (!Array.isArray(t.regions) || t.regions.length < 1 || t.regions.length > 4) return 'A split names 1 to 4 regions.';
        const seen: number[] = [];
        for (const e of t.regions) {
          if (!Array.isArray(e) || e.length !== 2) return 'Bad split term.';
          const [r, to] = e;
          if (!isInt(r, 0, s.regions.length - 1) || seen.includes(r) || !sig(to)) return 'Bad split term.';
          const o = s.regions[r].owner;
          if (o === a || o === b) return 'A split may only name regions held by a third faction or independents.';
          seen.push(r);
        }
        break;
      }
      case 'payment':
        if (!sig(t.from) || !isResource(t.res) || !isInt(t.amount, 1, PAYMENT_MAX)) return 'Bad payment term.';
        if (s.factions[t.from].stock[t.res] < t.amount) return `${s.factions[t.from].name} cannot pay ${t.amount} ${t.res} now.`;
        break;
      default:
        return 'Bad term.';
    }
  }
  // Two payments from one payer in one resource must be covered together.
  const owed = new Map<string, number>();
  for (const t of dr.terms as TreatyTerm[]) if (t.k === 'payment') owed.set(`${t.from}:${t.res}`, (owed.get(`${t.from}:${t.res}`) ?? 0) + t.amount);
  for (const [k, n] of owed) {
    const [f, res] = k.split(':');
    if (s.factions[Number(f)].stock[res as Resource] < n) return 'The payments cannot be covered.';
  }
  return null;
}

/** A clean copy of a valid draft (drops anything unexpected on the objects). */
export function cleanDraft(dr: TreatyDraft): TreatyDraft {
  const terms: TreatyTerm[] = dr.terms.map(t => {
    switch (t.k) {
      case 'tribute':
        return { k: 'tribute', from: t.from, res: t.res, amount: t.amount };
      case 'exchange':
        return { k: 'exchange', from: t.from, give: t.give, giveAmount: t.giveAmount, get: t.get, getAmount: t.getAmount };
      case 'access':
        return { k: 'access', grantor: t.grantor };
      case 'split':
        return { k: 'split', regions: t.regions.map(([r, f]) => [r, f] as [number, number]) };
      case 'payment':
        return { k: 'payment', from: t.from, res: t.res, amount: t.amount };
    }
  });
  return { kind: dr.kind, turns: dr.turns, terms };
}

/** Puts a valid draft into force between a and b (draft state, in place). */
export function enactTreaty(d: PlanetState, a: FactionId, b: FactionId, draft: TreatyDraft): void {
  const dr = cleanDraft(draft);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const t: Treaty = { ...dr, a: lo, b: hi, since: d.turn, ends: dr.turns === null ? null : d.turn + dr.turns - 1 };
  d.treaties = sortTreaties([...d.treaties.filter(x => !(x.a === lo && x.b === hi)), t]);
  for (const term of dr.terms) {
    if (term.k !== 'payment') continue;
    const to = term.from === a ? b : a;
    d.factions[term.from].stock[term.res] -= term.amount;
    d.factions[to].stock[term.res] += term.amount;
    shiftTrust(d, to, term.from, Math.min(15, Math.floor(termValue(term.res, term.amount) / 5)));
  }
  pruneRoutes(d);
  const len = dr.turns === null ? 'open-ended' : `for ${dr.turns} turns`;
  note(d, `${d.factions[a].name} and ${d.factions[b].name} sign a ${TREATY_NAMES[dr.kind]}, ${len}.`, 'info', a === 0 || b === 0 ? 0 : undefined);
}

/** True when ending this treaty now breaks a dated promise. */
export const isBreach = (s: PlanetState, t: Treaty): boolean => t.ends !== null && t.ends >= s.turn;

/** Ends the treaty between breaker and victim, with the breach or cancellation penalties (draft, in place). */
export function endTreaty(d: PlanetState, breaker: FactionId, victim: FactionId, why: 'war' | 'cancel'): void {
  const t = treatyBetween(d, breaker, victim);
  if (!t) return;
  const breach = isBreach(d, t);
  d.treaties = d.treaties.filter(x => x !== t);
  if (breach) {
    shiftTrust(d, victim, breaker, -30);
    for (const f of d.factions) if (f.alive && f.id !== breaker && f.id !== victim) shiftTrust(d, f.id, breaker, -10);
  } else if (t.turns === null) {
    shiftTrust(d, victim, breaker, -5);
  }
  pruneRoutes(d);
  const bn = d.factions[breaker].name;
  const vn = d.factions[victim].name;
  const text =
    why === 'war'
      ? `${bn} declares war on ${vn}${breach ? `, breaking their ${TREATY_NAMES[t.kind]}` : ''}.`
      : `${bn} cancels its ${TREATY_NAMES[t.kind]} with ${vn}${breach ? ', breaking its word' : ''}.`;
  note(d, text, 'bad', breaker === 0 || victim === 0 ? 0 : undefined);
}

// ---- Judging (section 8.5) --------------------------------------------------------------------

/** Links between a region of a and a region of b. */
export function borders(s: PlanetState, a: number, b: number): number {
  let n = 0;
  for (const l of planetMapOf(s).links) {
    const oa = s.regions[l.a].owner;
    const ob = s.regions[l.b].owner;
    if ((oa === a && ob === b) || (oa === b && ob === a)) n++;
  }
  return n;
}

const enemiesOf = (s: PlanetState, f: FactionId): FactionId[] => s.factions.filter(x => x.alive && x.id !== f && atWar(s, f, x.id)).map(x => x.id);

// ---- War and peace (section 12.1) -------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** How close f is to winning outright, 0..1: 0 below victoryShare - LEADER_BAND, 1 at victoryShare. */
export function threatOf(s: PlanetState, f: FactionId): number {
  if (!s.factions[f]?.alive) return 0;
  const share = 100 * regionShare(s, f);
  return clamp((share - (s.options.victoryShare - LEADER_BAND)) / LEADER_BAND, 0, 1);
}

/** Strength f could bring to an attack now: its field army plus the most credits its alloys buy above the reserve. */
export function strikeStrength(s: PlanetState, f: FactionId): number {
  const fac = s.factions[f];
  if (!fac?.army || !fac.army.units.length) return 0;
  const spare = fac.stock.alloys - AI_RESERVE.alloys;
  const credits = [...ATTACK_CREDITS].reverse().find(c => c / 250 <= spare) ?? 0;
  return strengthOf(fac.army.units) + credits / AI_CREDITS_PER_POINT;
}

/** Regions of b next to a region of f that f's strike strength would dare attack (temperament's attackRatio). */
export function softTargets(s: PlanetState, f: FactionId, b: FactionId, T: TemperamentSpec = specOf(s, f)): number {
  const A = strikeStrength(s, f);
  if (A <= 0) return 0;
  const m = planetMapOf(s);
  let n = 0;
  s.regions.forEach((reg, r) => {
    if (reg.owner !== b) return;
    if (!m.regions[r].links.some(l => s.regions[l.to].owner === f)) return;
    if (A / defenceEstimate(s, r) >= T.attackRatio) n++;
  });
  return n;
}

/** True when f borders at least one independent region. */
export function bordersIndependents(s: PlanetState, f: FactionId): boolean {
  for (const l of planetMapOf(s).links) {
    const oa = s.regions[l.a].owner;
    const ob = s.regions[l.b].owner;
    if ((oa === f && ob === NEUTRAL) || (oa === NEUTRAL && ob === f)) return true;
  }
  return false;
}

/**
 * How much f would rather fight b than keep the peace (section 12.1), with the reasons. Positive:
 * war pays; negative: peace pays. Weighs a weak or exposed neighbour, a rival nearing a win and
 * running out of independents against fear of a stronger side, other fronts, the pact in force
 * and trust. Pure and deterministic.
 */
export function warInterest(s: PlanetState, f: FactionId, b: FactionId, T: TemperamentSpec = specOf(s, f)): { value: number; reasons: string[]; forWar: string[] } {
  const W = WAR_INTEREST;
  const reasons: string[] = [];
  // The reasons that push toward war, the only ones a refusal driven by war interest may give.
  const forWar: string[] = [];
  const pro = (t: string) => {
    reasons.push(t);
    forWar.push(t);
  };
  const pf = Math.max(1, power(s, f));
  const pb = Math.max(1, power(s, b));
  const border = borders(s, f, b) > 0;
  let v = T.warBias;
  const rel = W.strength * clamp((pf - pb) / pb, -1, 1);
  v += rel;
  if (rel >= 8) pro('They think you weak.');
  else if (rel <= -8) reasons.push('They fear your strength.');
  if (!border) v += W.noBorder;
  else {
    const soft = Math.min(W.softMax, softTargets(s, f, b, T));
    v += W.soft * soft;
    if (soft) pro('Your border regions are poorly held.');
    if (!bordersIndependents(s, f)) v += W.noIndependents;
    // Close to winning: finish it.
    v += W.nearWin * threatOf(s, f);
    // Envy: a neighbour holding more of the planet.
    v += W.envy * Math.max(0, regionsOfCount(s, b) - regionsOfCount(s, f));
  }
  const lead = W.rivalNearWin * threatOf(s, b);
  v += lead;
  if (lead >= 10) pro('You are close to winning the war.');
  // A third faction close to winning worries f more than b does: keep b quiet.
  const third = s.factions.filter(x => x.alive && x.id !== f && x.id !== b);
  v += W.otherLeader * Math.max(0, ...third.map(x => threatOf(s, x.id)));
  const fronts = third.filter(x => atWar(s, f, x.id) && borders(s, f, x.id) > 0).length;
  v += W.otherFront * fronts;
  if (fronts) reasons.push('They are busy on other fronts.');
  v += W.theirFront * third.filter(x => atWar(s, b, x.id)).length;
  const st = stanceOf(s, f, b);
  v += st === 'trade' ? W.trade : st === 'alliance' ? W.alliance : 0;
  // What the routes between them pay f each turn, lost in a war.
  const trade = tradeValue(s, f, b);
  v += Math.max(-W.routeMax, W.route * trade);
  if (trade >= 4) reasons.push('Your trade is worth keeping.');
  else if (needsTrade(s, f, b)) {
    // Short of fuel and nothing flowing yet: a pact with a faction in route range is worth having.
    v += W.needsTrade;
    reasons.push('They need what trade with you would bring.');
  }
  v += (50 - s.trust[f][b]) / W.trust;
  return { value: Math.round(v * 100) / 100, reasons, forWar };
}

const regionsOfCount = (s: PlanetState, f: FactionId): number => s.regions.reduce((n, r) => n + (r.owner === f ? 1 : 0), 0);

/** Value per turn (VALUE-weighted) that the routes between f and b pay f. */
export function tradeValue(s: PlanetState, f: FactionId, b: FactionId): number {
  let v = 0;
  for (const r of s.routes) {
    const p = routePartner(s, r);
    if (!((r.owner === f && p === b) || (r.owner === b && p === f))) continue;
    const y = routeYield(s, r);
    v += y.fuel * VALUE.fuel + y.alloys * VALUE.alloys;
  }
  return v;
}

/** True when f makes no fuel (net at most 0) and some city of b lies within route range of one of f's. */
export function needsTrade(s: PlanetState, f: FactionId, b: FactionId): boolean {
  if (tradeValue(s, f, b) > 0 || factionIncome(s, f).net.fuel > 0) return false;
  const m = planetMapOf(s);
  // Hops over every link from f's regions, up to ROUTE_MAX_HOPS.
  const dist = s.regions.map(r => (r.owner === f ? 0 : Infinity));
  let frontier = s.regions.map((r, i) => (r.owner === f ? i : -1)).filter(i => i >= 0);
  for (let h = 1; h <= ROUTE_MAX_HOPS && frontier.length; h++) {
    const next: number[] = [];
    for (const x of frontier) for (const l of m.regions[x].links) {
      if (dist[l.to] !== Infinity) continue;
      dist[l.to] = h;
      if (s.regions[l.to].owner === b) return true;
      next.push(l.to);
    }
    frontier = next;
  }
  return false;
}

/** The length of a treaty a computer faction proposes. */
export function aiTreatyTurns(s: PlanetState, kind: TreatyKind): number {
  const lim = TREATY_TURNS[kind];
  return clamp(Math.round(s.options.turnLimit * AI_TREATY_SHARE[kind]), lim.min, lim.max);
}

export function proposalScore(s: PlanetState, judge: FactionId, other: FactionId, draft: TreatyDraft): { score: number; reasons: string[] } {
  const T = specOf(s, judge);
  const reasons: string[] = [];
  const pj = power(s, judge);
  const po = power(s, other);
  let base = 0;
  if (draft.kind === 'ceasefire') {
    const war = atWar(s, judge, other) ? 10 : 0;
    const rel = 25 * Math.max(-1, Math.min(1, (po - pj) / Math.max(pj, 1)));
    const fronts = 10 * (enemiesOf(s, judge).length - 1);
    base = war + rel + fronts + T.ceasefireBias;
    if (rel > 5) reasons.push('They fear your strength.');
    else if (rel < -5) reasons.push('They feel the stronger side.');
    if (fronts > 0) reasons.push('They are fighting on several fronts.');
  } else if (draft.kind === 'trade') {
    const b = borders(s, judge, other) > 0 ? 5 : 0;
    base = 5 + T.tradeBias + b;
    if (T.tradeBias >= 20) reasons.push('They value trade.');
  } else {
    const common = enemiesOf(s, judge).filter(e => atWar(s, other, e)).length;
    const partners = s.treaties.filter(t => t.a === judge || t.b === judge).map(t => (t.a === judge ? t.b : t.a));
    const clash = partners.some(p => p !== other && atWar(s, other, p)) ? 1 : 0;
    base = T.allianceBias + 20 * common - 25 * clash;
    if (common) reasons.push('You share an enemy.');
    if (clash) reasons.push('You are at war with one of their partners.');
  }
  // Interest (section 12.1): a faction that would rather fight will not sign; one that fears war signs more readily.
  const wi = warInterest(s, judge, other);
  const pull = draft.kind === 'ceasefire' ? 0.8 : 1;
  base += wi.value > 0 ? -pull * wi.value : -0.2 * wi.value;
  // Only the reasons that push toward war explain a refusal; the pro-peace ones would argue the other way.
  if (wi.value > 5) reasons.push(...wi.forWar);
  if (draft.kind === 'alliance') {
    const rival = Math.max(0, ...s.factions.filter(x => x.alive && x.id !== judge && x.id !== other).map(x => threatOf(s, x.id)));
    if (rival > 0) {
      base += COALITION_ALLIANCE * rival;
      reasons.push('You share a rival close to winning.');
    }
    if (other === 0 && handsAlliedVictory(s, judge)) {
      base -= 100;
      reasons.push('An alliance would hand you the war.');
    }
  }
  let terms = 0;
  const left = Math.min(draft.turns ?? 10, 10);
  for (const t of draft.terms) {
    switch (t.k) {
      case 'tribute': {
        const v = (termValue(t.res, t.amount) * left) / 4;
        terms += t.from === judge ? -1.5 * v : v;
        break;
      }
      case 'exchange': {
        const gave = t.from === judge ? termValue(t.give, t.giveAmount) : termValue(t.get, t.getAmount);
        const got = t.from === judge ? termValue(t.get, t.getAmount) : termValue(t.give, t.giveAmount);
        terms += 3 * (got - T.exchangeMargin * gave);
        break;
      }
      case 'payment':
        terms += t.from === judge ? -termValue(t.res, t.amount) : termValue(t.res, t.amount) / 2;
        break;
      case 'access':
        terms += t.grantor === judge ? (s.factions[judge].temperament === 'defensive' ? -20 : -10) : 8;
        break;
      case 'split':
        for (const [, to] of t.regions) terms += to === judge ? 12 : -6;
        break;
    }
  }
  if (terms > 5) reasons.push('The terms favour them.');
  else if (terms < -5) reasons.push('The terms cost them too much.');
  const trust = (s.trust[judge][other] - 50) / 2;
  if (trust >= 5) reasons.push('They trust you.');
  else if (trust <= -5) reasons.push('They do not trust you.');
  return { score: Math.round((base + terms + trust) * 100) / 100, reasons };
}

/** True when an alliance between the player and computer faction j would complete an allied victory for the player. */
export function handsAlliedVictory(s: PlanetState, j: FactionId): boolean {
  if (!s.options.alliedVictory) return false;
  const ai = s.factions.filter(x => x.id !== 0 && x.alive);
  if (!ai.every(x => x.id === j || stanceOf(s, 0, x.id) === 'alliance')) return false;
  const count = (f: FactionId) => s.regions.filter(r => r.owner === f).length;
  const mine = count(0);
  const counts = ai.map(x => count(x.id));
  return (100 * (mine + counts.reduce((t, n) => t + n, 0))) / s.regions.length >= s.options.victoryShare && counts.every(n => mine > n);
}

export function proposalVerdict(s: PlanetState, judge: FactionId, other: FactionId, draft: TreatyDraft): { accept: boolean; score: number; reasons: string[] } {
  const { score, reasons } = proposalScore(s, judge, other, draft);
  let accept = score >= ACCEPT_AT[draft.kind];
  if (draft.kind === 'alliance' && s.trust[judge][other] < specOf(s, judge).allianceTrust) {
    accept = false;
    reasons.push('They do not trust you enough for an alliance.');
  }
  return { accept, score, reasons };
}

// ---- Turn upkeep of diplomacy -----------------------------------------------------------------

/** Trust drift for one turn (section 8.3), on a draft. */
export function trustDrift(d: PlanetState): void {
  const alive = d.factions.filter(f => f.alive).map(f => f.id);
  for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
    const a = alive[i];
    const b = alive[j];
    const st = stanceOf(d, a, b);
    let by = st === 'trade' ? 1 : st === 'alliance' ? 2 : st === 'war' ? -1 : 0;
    if (alive.some(c => c !== a && c !== b && atWar(d, a, c) && atWar(d, b, c))) by += 1;
    if (!by) continue;
    // Drift wears trust toward a floor or a ceiling, never past it; events still move it all the way.
    for (const [x, y] of [[a, b], [b, a]]) {
      const t = d.trust[x][y];
      if (by > 0 && t < TRUST_DRIFT_MAX) shiftTrust(d, x, y, Math.min(by, TRUST_DRIFT_MAX - t));
      else if (by < 0 && t > TRUST_DRIFT_MIN) shiftTrust(d, x, y, Math.max(by, TRUST_DRIFT_MIN - t));
    }
  }
}

/** Treaties whose last turn is now end; trust +5 each way (section 6.6, step 9). */
export function expireTreaties(d: PlanetState): void {
  const ending = d.treaties.filter(t => t.ends !== null && t.ends <= d.turn);
  if (!ending.length) return;
  d.treaties = d.treaties.filter(t => !ending.includes(t));
  for (const t of ending) {
    shiftTrust(d, t.a, t.b, 5);
    shiftTrust(d, t.b, t.a, 5);
    const after = t.kind === 'ceasefire' ? ' They are at war again.' : '';
    note(d, `The ${TREATY_NAMES[t.kind]} between ${d.factions[t.a].name} and ${d.factions[t.b].name} runs out.${after}`, 'info', t.a === 0 || t.b === 0 ? 0 : undefined);
  }
  pruneRoutes(d);
}

/** A short description of a treaty's terms for the journal and interface. */
export function describeTerms(s: PlanetState, terms: TreatyTerm[]): string {
  const n = (f: number) => (f === NEUTRAL ? 'independents' : s.factions[f].name);
  return listNames(
    terms.map(t => {
      switch (t.k) {
        case 'tribute':
          return `${n(t.from)} pays ${t.amount} ${t.res} a turn`;
        case 'exchange':
          return `${n(t.from)} trades ${t.giveAmount} ${t.give} for ${t.getAmount} ${t.get} a turn`;
        case 'access':
          return `${n(t.grantor)} opens its regions`;
        case 'split':
          return `a split of ${t.regions.length} region${t.regions.length === 1 ? '' : 's'}`;
        case 'payment':
          return `${n(t.from)} pays ${t.amount} ${t.res} at once`;
      }
    }),
  );
}
