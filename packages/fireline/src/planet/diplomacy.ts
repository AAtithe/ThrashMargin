/**
 * War for the Planet: treaties, trust and how a computer faction judges a proposal
 * (fireline-planet-design.md, section 8). W1. Pure.
 */
import { power } from './battleSetup';
import { listNames, note } from './journal';
import { planetMapOf } from './map';
import { ACCEPT_AT, PAYMENT_MAX, TEMPERAMENTS, TERM_AMOUNT_MAX, TREATY_TERMS_MAX, TREATY_TURNS, VALUE, type TemperamentSpec } from './rules';
import { aliveFaction, atWar, isInt, sortTreaties, stanceOf, treatyBetween } from './state';
import { pruneRoutes } from './trade';
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
    if (by) {
      shiftTrust(d, a, b, by);
      shiftTrust(d, b, a, by);
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
