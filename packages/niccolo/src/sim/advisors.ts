import advisorData from '../content/advisors/officers.json';
import { activeCharacters } from './characters';
import { CITIES, findCity, findGood, findHouse, findRouteById, marketGoodsAt } from './content';
import { convoyEligible } from './convoy';
import { HOUSES } from './content';
import { canInsureAt } from './insurance';
import { cargoTotal, priceAt } from './market';
import { currentLatencyFor, courierInvestmentCost, canInvestFurther } from './news';
import { currentChapterNumber, objectivesForChapter } from './objectives';
import { EXPEDITION_ZONE_CITIES } from './expedition';
import type { GameState } from './types';

/**
 * The household's counsel (Phase 21). Officers of the house surface recommendations — a trade the
 * player's own reports support, an obligation about to bite, a hold sitting empty, a port where
 * cargo has a habit of spoiling.
 *
 * Four rules this module holds to, each of which is the whole reason it is trustworthy:
 *
 * 1. **Advice only.** Nothing here acts. `adviceFor` is a pure, read-only projection over state —
 *    the same discipline `sim/objectives.ts` uses, and for the same reason: the moment counsel can
 *    execute, it stops being counsel and becomes a partial autopilot with the player's cash.
 *
 * 2. **An advisor may only read what the player can read.** Trade tips are computed from
 *    `state.knownPrices` — the reports that have actually arrived — never from live `scarcity`.
 *    An officer who quoted the true current price would be handing the player omniscience through
 *    the back door, which is precisely the cheat `sim/aiTrader.ts` was built to forbid in its own
 *    opponent. The one exception is a city the player has a vessel docked at, where prices are
 *    first-hand and already shown live everywhere else in the UI.
 *
 * 3. **Only active officers speak, and only about their own domain.** A departed Godscalc gives no
 *    counsel — which is a real consequence of Chapter 6 rather than a special case. Crackbene has
 *    nothing to say about credit and Julius nothing about fever.
 *
 * 4. **Prose is content, not code** (§0). Every line lives in `content/advisors/officers.json` with
 *    `{placeholder}` slots; this file only decides *whether* a thing is worth saying.
 */

export type AdviceKind =
  | 'trade'
  | 'credit'
  | 'idle'
  | 'risk_sabotage'
  | 'risk_uninsured'
  | 'risk_health'
  | 'intel_stale'
  | 'intel_unknown'
  | 'household_wages'
  | 'household_idle'
  | 'convoy'
  | 'seasonal'
  | 'houses'
  | 'houses_unmasked'
  | 'chapter';

export type AdviceUrgency = 'urgent' | 'notable' | 'passing';

export interface Advice {
  /** Stable within a week, so the pop-up can tell "the same counsel" from "new counsel". */
  id: string;
  officerId: string;
  officerName: string;
  officerRole: string;
  kind: AdviceKind;
  urgency: AdviceUrgency;
  body: string;
}

interface AdvisorContent {
  id: string;
  domains: AdviceKind[];
  role: string;
  lines: Record<string, string[]>;
}

// `as unknown as` because each officer's `lines` object only carries the keys for their own
// domains, so TS infers a union of narrower shapes rather than the Record — the same cast every
// other content import in `sim/content.ts` uses for the same reason.
const ADVISORS = advisorData as unknown as AdvisorContent[];

/** Marian while she lives; Gregorio once she does not. Both are authored for these domains, and the
 * lines differ — Gregorio says the same things as a man reading a ledger rather than as the woman
 * whose house it was. */
const MARIAN_THEN = ['marian', 'gregorio'];
/** Gregorio keeps the chapter's own open business in view; Julius takes it over if he ever cannot.
 * Gregorio never departs in shipped content — this is insurance against a later chapter that removes
 * him, so the succession is authored before it is needed rather than after it is noticed missing. */
const GREGORIO_THEN = ['gregorio', 'julius'];

const URGENCY_ORDER: Record<AdviceUrgency, number> = { urgent: 0, notable: 1, passing: 2 };

/** How many pieces of counsel the *panel* shows at once. More than this and it stops being counsel
 * and becomes a wall of text nobody reads. Deliberately applied at the display edge, not in
 * `adviceFor`: a projection that silently truncated itself would make "this officer never speaks"
 * indistinguishable from "this officer was crowded out this week", which is exactly the confusion
 * that hid a dead advisor domain during this phase's own verification. */
export const MAX_ADVICE_SHOWN = 5;

/** Deterministic phrasing pick — the same situation in the same week always reads the same way, so
 * counsel doesn't visibly reshuffle its own wording on every re-render. Not `Math.random`: this is
 * called from render. */
function phrase(lines: string[], seed: string, vars: Record<string, string | number>): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const line = lines[Math.abs(h) % lines.length];
  return line.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`));
}

function advisor(id: string): AdvisorContent | undefined {
  return ADVISORS.find(a => a.id === id);
}

/** Build one piece of counsel, but only if that officer is actually with the house and owns that
 * domain. Returns null otherwise, so every call site reads as a plain "say this if there's anyone
 * to say it". */
function speak(
  state: GameState,
  /**
   * Who says it — in order of preference. The first officer on the list who is *active* and owns
   * the domain speaks; if nobody does, the counsel simply isn't given.
   *
   * The fallback exists because officers die. Marian founded the house and is its natural voice on
   * wages and on a trade worth making — and she dies in Chapter 2, six chapters before the campaign
   * ends. Without a successor the player would lose the house's own counsel for three quarters of
   * the game, which would punish them for a death §7 says they cannot prevent. So the house keeps
   * speaking; it just speaks in a different officer's voice, which is what actually happens when a
   * household loses the person who used to say these things.
   */
  officerIds: string | string[],
  kind: AdviceKind,
  urgency: AdviceUrgency,
  seed: string,
  vars: Record<string, string | number>,
): Advice | null {
  const candidates = typeof officerIds === 'string' ? [officerIds] : officerIds;
  const active = activeCharacters(state.characters);
  const officerId = candidates.find(id => {
    const content = advisor(id);
    return content?.domains.includes(kind) && active.some(c => c.id === id);
  });
  if (!officerId) return null;
  const officer = active.find(c => c.id === officerId)!;
  const content = advisor(officerId);
  if (!content || !content.domains.includes(kind)) return null;
  const lines = content.lines[kind];
  if (!lines?.length) return null;
  return {
    id: `${officerId}:${kind}:${seed}`,
    officerId,
    officerName: officer.name,
    officerRole: content.role,
    kind,
    urgency,
    body: phrase(lines, `${seed}:${state.week}`, vars),
  };
}

/** The prices an advisor is allowed to quote for a city: first-hand if a vessel is docked there,
 * otherwise the newest report that has actually arrived — and nothing at all if none has. */
function readablePrices(state: GameState, cityId: string): { prices: Record<string, number>; ageWeeks: number } | null {
  const docked = state.vessels.some(v => !v.destination && v.location === cityId);
  if (docked) {
    const prices: Record<string, number> = {};
    for (const goodId of marketGoodsAt(cityId)) {
      // Through `priceAt` with the market events, not a hand-rolled `base * scarcity`: an officer
      // standing on the quay must quote the number the quay will actually honour, demand layer and
      // all. An earlier version recomputed it by hand and would have under-quoted a festival.
      const price = priceAt(state.scarcity, cityId, goodId, state.marketEvents);
      if (price !== null) prices[goodId] = price;
    }
    return { prices, ageWeeks: 0 };
  }
  const report = state.knownPrices[cityId];
  if (!report) return null;
  return { prices: report.prices, ageWeeks: state.week - report.trueAsOfWeek };
}

/**
 * The single best spread the player's own paperwork supports. Deliberately one tip, not a table:
 * the officer's job is to point at something, and a ranked list of every pair on the map would be a
 * spreadsheet the design doc's information pillar exists to withhold.
 */
function bestKnownSpread(state: GameState): Advice | null {
  let best: { good: string; buyCity: string; sellCity: string; buy: number; sell: number } | null = null;

  const readable = new Map<string, { prices: Record<string, number>; ageWeeks: number }>();
  for (const city of CITIES) {
    const r = readablePrices(state, city.id);
    if (r) readable.set(city.id, r);
  }

  for (const [buyCity, from] of readable) {
    for (const [sellCity, to] of readable) {
      if (buyCity === sellCity) continue;
      for (const [goodId, buyPrice] of Object.entries(from.prices)) {
        const sellPrice = to.prices[goodId];
        if (sellPrice == null || buyPrice <= 0) continue;
        const margin = sellPrice - buyPrice;
        if (margin <= 0) continue;
        if (!best || margin > best.sell - best.buy) {
          best = { good: goodId, buyCity, sellCity, buy: buyPrice, sell: sellPrice };
        }
      }
    }
  }
  if (!best) return null;

  return speak(state, MARIAN_THEN, 'trade', 'passing', `trade:${best.good}:${best.buyCity}:${best.sellCity}`, {
    good: findGood(best.good)?.name ?? best.good,
    buyCity: findCity(best.buyCity)?.name ?? best.buyCity,
    sellCity: findCity(best.sellCity)?.name ?? best.sellCity,
    buyPrice: best.buy,
    sellPrice: best.sell,
    margin: best.sell - best.buy,
  });
}

/**
 * Everything the household has to say this week, most urgent first, capped for readability.
 * Pure: takes state, returns text. Nothing here writes.
 */
export function adviceFor(state: GameState): Advice[] {
  const out: (Advice | null)[] = [];
  const cash = Math.round(state.cash);

  // --- Credit: the maturity ladder about to bite.
  const dueSoon = state.obligations
    .filter(o => !o.settled && o.direction === 'payable' && o.matureWeek - state.week <= 6)
    .sort((a, b) => a.matureWeek - b.matureWeek);
  if (dueSoon.length > 0) {
    const next = dueSoon[0];
    const owed = Math.round(next.amount * (state.exchangeRates[next.currency] ?? 1));
    const weeks = Math.max(0, next.matureWeek - state.week);
    if (owed > state.cash) {
      const vars = { amount: owed, weeks, s: weeks === 1 ? '' : 's', cash };
      out.push(speak(state, 'julius', 'credit', 'urgent', `credit:${next.id}`, vars));
      out.push(speak(state, 'gregorio', 'credit', 'notable', `credit2:${next.id}`, vars));
    }
  }

  // --- Household: wages the account cannot meet next week.
  const roster = activeCharacters(state.characters);
  const wages = roster.reduce((sum, c) => sum + c.salary, 0);
  if (state.flags.chapter0_complete && wages > state.cash) {
    out.push(speak(state, MARIAN_THEN, 'household_wages', 'urgent', 'wages', { wages, cash }));
  }
  const idleOfficer = roster.find(c => c.assignment.type === 'idle' && c.id !== 'marian');
  if (idleOfficer) {
    out.push(speak(state, MARIAN_THEN, 'household_idle', 'passing', `idle:${idleOfficer.id}`, { name: idleOfficer.name }));
  }

  // --- Risk: cargo docked where a hostile house keeps its own people.
  const hostileHomes = new Map(HOUSES.filter(h => h.disposition === 'hostile').map(h => [h.homeCity, h]));
  const exposed = state.vessels.find(v => !v.destination && hostileHomes.has(v.location) && cargoTotal(v.cargo) > 0);
  if (exposed) {
    const house = hostileHomes.get(exposed.location)!;
    out.push(speak(state, 'astorre', 'risk_sabotage', 'notable', `sabotage:${exposed.id}`, {
      vessel: exposed.name,
      city: findCity(exposed.location)?.name ?? exposed.location,
      house: house.name,
    }));
  }

  // --- Risk: laden and under way from a port that would have underwritten it, with no policy.
  const uninsured = state.vessels.find(
    v => v.destination && cargoTotal(v.cargo) > 0 && !(state.insurance ?? []).some(i => i.vesselId === v.id),
  );
  if (uninsured) {
    const route = uninsured.routeId ? findRouteById(uninsured.routeId) : undefined;
    if (route && canInsureAt(route.from === uninsured.destination ? route.to : route.from)) {
      out.push(speak(state, 'astorre', 'risk_uninsured', 'notable', `uninsured:${uninsured.id}`, {
        vessel: uninsured.name,
      }));
    }
    if (route?.seasonal && !state.convoy?.escorted) {
      out.push(speak(state, 'crackbene', 'seasonal', 'notable', `seasonal:${route.id}`, {
        route: `${findCity(route.from)?.name ?? route.from} to ${findCity(route.to)?.name ?? route.to}`,
      }));
    }
  }

  // --- Risk: the fever zone, with the physician left at home.
  const inZone = state.vessels.find(
    v => !v.destination && EXPEDITION_ZONE_CITIES.includes(v.location),
  );
  if (inZone) {
    const tobieAboard = roster.some(
      c => c.id === 'tobie' && c.assignment.type === 'aboard' && c.assignment.vesselId === inZone.id,
    );
    if (!tobieAboard) {
      out.push(speak(state, 'tobie', 'risk_health', 'urgent', `fever:${inZone.id}`, {
        vessel: inZone.name,
        health: state.expedition?.healthStatus ?? 'not yet sick',
      }));
    }
  }

  // --- Convoy: hulls enough to sail together, sitting apart.
  if (!state.convoy) {
    const byPort = new Map<string, number>();
    for (const v of convoyEligible(state.vessels)) {
      if (v.destination) continue;
      byPort.set(v.location, (byPort.get(v.location) ?? 0) + 1);
    }
    for (const [city, count] of byPort) {
      if (count >= 2) {
        out.push(speak(state, 'crackbene', 'convoy', 'notable', `convoy:${city}`, {
          count,
          city: findCity(city)?.name ?? city,
        }));
        break;
      }
    }
  }

  // --- Idle capital: a hold sitting empty with money in the account.
  const idleHull = state.vessels.find(v => !v.destination && v.capacity > 0 && cargoTotal(v.cargo) === 0);
  if (idleHull && state.cash > 50) {
    out.push(speak(state, 'julius', 'idle', 'passing', `idlehull:${idleHull.id}`, {
      vessel: idleHull.name,
      city: findCity(idleHull.location)?.name ?? idleHull.location,
      cash,
    }));
  }

  // --- Intelligence: the stalest report worth paying to shorten, or a city never heard from.
  const unknown = CITIES.find(
    c => c.market && !state.knownPrices[c.id] && !state.vessels.some(v => v.location === c.id),
  );
  const stalest = CITIES.filter(c => c.market && state.knownPrices[c.id])
    .map(c => ({ c, age: state.week - state.knownPrices[c.id].trueAsOfWeek }))
    .sort((a, b) => b.age - a.age)[0];
  // Staleness first, "never heard from" only as a fallback. The other order reads more naturally but
  // is effectively dead: a real campaign nearly always has *some* city it holds no report for (a far
  // corner of the map it has no route to), so the unknown branch would win every week and the
  // actionable advice — a report going stale on a line the player can actually pay to shorten —
  // would never be given at all. Caught by this phase's own reachability check.
  if (stalest && stalest.age >= 6 && canInvestFurther(stalest.c.id, state.courierInvestment)) {
    out.push(speak(state, 'kathi', 'intel_stale', 'passing', `stale:${stalest.c.id}`, {
      city: stalest.c.name,
      age: stalest.age,
      latency: currentLatencyFor(stalest.c.id, state.courierInvestment, state.characters),
      cost: courierInvestmentCost(stalest.c.id, state.courierInvestment),
    }));
  } else if (unknown) {
    out.push(speak(state, 'kathi', 'intel_unknown', 'notable', `unknown:${unknown.id}`, {
      city: unknown.name,
    }));
  }

  // --- Rival houses: a hostile house with nobody of ours inside it.
  // A masked house whose backers the player has actually named is a different piece of counsel from
  // one nobody has looked into — the intelligence work done in Chapter 5 should still be worth
  // something in Chapter 6 and beyond, rather than being a fact the UI records and no one mentions
  // again. (The endgame branching on it is Chapter 8's own business.)
  const unmasked = HOUSES.find(h => h.hiddenBackers && state.flags[h.hiddenBackers.revealedByFlag]);
  if (unmasked) {
    out.push(speak(state, 'gelis', 'houses_unmasked', 'passing', `unmasked:${unmasked.id}`, {
      house: unmasked.name,
      relation: Math.round(state.houseRelations[unmasked.id] ?? unmasked.baselineRelation),
    }));
  }

  const unwatched = HOUSES.filter(h => h.disposition === 'hostile').find(
    h => !state.agents.some(a => a.placement.type === 'house' && a.placement.houseId === h.id),
  );
  if (unwatched) {
    out.push(speak(state, 'gelis', 'houses', 'passing', `house:${unwatched.id}`, {
      house: unwatched.name,
      relation: Math.round(state.houseRelations[unwatched.id] ?? unwatched.baselineRelation),
    }));
  }

  // --- The chapter's own open business, in the lawyer's voice. Reuses the objectives projection
  //     rather than restating any chapter's content here.
  const chapter = currentChapterNumber(state);
  const openObjective = objectivesForChapter(state, chapter).find(
    p => p.status === 'pending' && !p.objective.optional && !p.objective.inevitable,
  );
  if (openObjective) {
    out.push(speak(state, GREGORIO_THEN, 'chapter', 'passing', `obj:${openObjective.objective.id}`, {
      objective: openObjective.objective.label,
      amount: 0,
      weeks: 0,
      s: 's',
    }));
  }

  // --- A trade the paperwork supports.
  out.push(bestKnownSpread(state));

  const advice = out.filter((a): a is Advice => a !== null);
  advice.sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]);
  return advice;
}

/** The one piece worth interrupting for — the most urgent counsel, and only if it is genuinely
 * urgent. Everything else waits for the player to open the panel. */
export function urgentAdvice(state: GameState): Advice | null {
  return adviceFor(state).find(a => a.urgency === 'urgent') ?? null;
}
