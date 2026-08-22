import templateData from '../content/marketEvents/events.json';
import { CITIES, findCity, findGood, marketGoodsAt } from './content';
import type { ActiveMarketEvent, MarketEventKind, PriceCauseNote } from './types';

/**
 * Cycling market events (Phase 23) — which cities want which goods, changing over the campaign.
 *
 * **Why this is a separate layer and not scarcity.** `priceAt` computes `base × scarcity × demand`.
 * Writing a demand shift into `MarketScarcity` instead would have `driftScarcity` mean-revert it
 * toward 1.0 by 30% a week, so a "spices are dear at Venice for two months" event would be almost
 * entirely gone inside four weeks and could never last a season. The two layers also mean different
 * things: scarcity is what trade has done to a market, demand is what the world wants from it.
 *
 * **Why an embargo is a flag and not a multiplier of zero.** `blocksTrade` is separate from
 * `multiplier` because a zero multiplier means a price of zero, and every display, valuation and
 * insurance path in the game would read that as "free" rather than "closed". An embargoed good keeps
 * its price and simply cannot be bought or sold there.
 *
 * Content is authored (`content/marketEvents/events.json`) with thematic text per §0, not generated
 * — a procedural demand curve would move numbers without ever explaining itself, and the whole point
 * of Phase 16's causality work was that the player should be told why.
 */

interface MarketEventTemplate {
  id: string;
  kind: MarketEventKind;
  /** `good`: one good at one city. `city`: every good that city trades (a war scare). */
  scope: 'good' | 'city';
  multiplier: number;
  blocksTrade?: boolean;
  durationWeeks: [number, number];
  /** Restricts where this can land. Absent means anywhere with a market. */
  cityIds?: string[];
  goodIds?: string[];
  headline: string;
}

const TEMPLATES = templateData as unknown as MarketEventTemplate[];

/** At most this many run at once. Above about this the map stops reading as a world with weather and
 * starts reading as noise, and the player can no longer tell a real opportunity from churn. */
export const MAX_CONCURRENT_EVENTS = 3;
/** Chance per week that a new event begins, when there is room for one. Tuned so a campaign sees
 * them regularly without any single week feeling scripted. */
export const NEW_EVENT_CHANCE_PER_WEEK = 0.14;

/** Every event affecting this exact city+good: the good's own, plus any whole-city event. */
export function eventsAffecting(
  events: ActiveMarketEvent[] | undefined,
  cityId: string,
  goodId: string,
): ActiveMarketEvent[] {
  if (!events?.length) return [];
  return events.filter(e => e.cityId === cityId && (e.goodId === null || e.goodId === goodId));
}

/**
 * The demand multiplier for one city-good — the third term in `base × scarcity × demand`. Returns 1
 * when nothing is running, which is the overwhelmingly common case and the reason every existing
 * price path could take this as an optional argument without changing behaviour.
 */
export function demandFactor(
  events: ActiveMarketEvent[] | undefined,
  cityId: string,
  goodId: string,
): number {
  let factor = 1;
  for (const e of eventsAffecting(events, cityId, goodId)) factor *= e.multiplier;
  return factor;
}

/** True when a good simply cannot be traded at that city right now. */
export function tradeBlockedAt(
  events: ActiveMarketEvent[] | undefined,
  cityId: string,
  goodId: string,
): ActiveMarketEvent | null {
  return eventsAffecting(events, cityId, goodId).find(e => e.blocksTrade) ?? null;
}

function fill(template: string, cityId: string, goodId: string | null): string {
  return template
    .replace(/\{city\}/g, findCity(cityId)?.name ?? cityId)
    .replace(/\{good\}/g, goodId ? findGood(goodId)?.name ?? goodId : 'everything');
}

let nextSeq = 0;
function instanceId(): string {
  nextSeq += 1;
  return `me_${nextSeq}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Cities that trade anything at all — the only places an event can land. */
function eligibleCities(template: MarketEventTemplate): string[] {
  return CITIES.filter(c => {
    if (!c.market) return false;
    if (template.cityIds && !template.cityIds.includes(c.id)) return false;
    if (template.scope === 'city') return true;
    const goods = Object.keys(c.market);
    return template.goodIds ? goods.some(g => template.goodIds!.includes(g)) : goods.length > 0;
  }).map(c => c.id);
}

function pick<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

/** Build one event from a template at a legal place, or null if nowhere is legal/free. */
function instantiate(
  template: MarketEventTemplate,
  week: number,
  running: ActiveMarketEvent[],
): ActiveMarketEvent | null {
  const taken = new Set(running.map(e => `${e.cityId}:${e.goodId ?? '*'}`));
  const cities = eligibleCities(template).filter(cityId =>
    // Never stack two events on the same target, and never put a good-scoped event in a city that
    // already has a whole-city one running — the multipliers would compound into nonsense.
    !taken.has(`${cityId}:*`) && !running.some(e => e.cityId === cityId && template.scope === 'city'),
  );
  const cityId = pick(cities);
  if (!cityId) return null;

  let goodId: string | null = null;
  if (template.scope === 'good') {
    const candidates = marketGoodsAt(cityId).filter(
      g => (!template.goodIds || template.goodIds.includes(g)) && !taken.has(`${cityId}:${g}`),
    );
    goodId = pick(candidates);
    if (!goodId) return null;
  }

  const [minWeeks, maxWeeks] = template.durationWeeks;
  const duration = minWeeks + Math.floor(Math.random() * (maxWeeks - minWeeks + 1));
  return {
    id: instanceId(),
    templateId: template.id,
    kind: template.kind,
    cityId,
    goodId,
    multiplier: template.multiplier,
    blocksTrade: template.blocksTrade ?? false,
    startedWeek: week,
    endsWeek: week + duration,
    headline: fill(template.headline, cityId, goodId),
  };
}

export interface MarketEventResolution {
  events: ActiveMarketEvent[];
  /** Events that began this week — the UI announces these. */
  started: ActiveMarketEvent[];
  /** Events that ended this week. */
  ended: ActiveMarketEvent[];
  /** `demand_shift` notes for the cities whose prices visibly moved because an event began or ended,
   * merged into `deriveMarketCauses`'s own output so Phase 16's narration explains this for free. */
  causes: Record<string, PriceCauseNote[]>;
}

/**
 * Runs every ADVANCE_WEEK: retire what has expired, then perhaps begin something new.
 *
 * A started or ended event is the one price move `deriveMarketCauses` structurally cannot see — it
 * compares scarcity stages, and demand is not scarcity. So the notes come from here instead, which
 * is why `PriceCauseKind` needed a fourth member rather than reusing `unknown_flows`.
 */
export function resolveWeeklyMarketEvents(
  events: ActiveMarketEvent[] | undefined,
  week: number,
): MarketEventResolution {
  const running = events ?? [];
  const ended = running.filter(e => week >= e.endsWeek);
  let kept = running.filter(e => week < e.endsWeek);

  const started: ActiveMarketEvent[] = [];
  if (kept.length < MAX_CONCURRENT_EVENTS && Math.random() < NEW_EVENT_CHANCE_PER_WEEK) {
    const template = pick(TEMPLATES);
    const fresh = template ? instantiate(template, week, kept) : null;
    if (fresh) {
      kept = [...kept, fresh];
      started.push(fresh);
    }
  }

  const causes: Record<string, PriceCauseNote[]> = {};
  const note = (e: ActiveMarketEvent, direction: 1 | -1) => {
    // A whole-city event names every good the city trades, so no row is left with a moved price and
    // no explanation — the same one-note-per-good discipline `corruptNews` had to adopt.
    const goodIds = e.goodId ? [e.goodId] : marketGoodsAt(e.cityId);
    for (const goodId of goodIds) {
      (causes[e.cityId] ??= []).push({ goodId, kind: 'demand_shift', direction });
    }
  };
  // Starting a dear event pushes prices up; ending one lets them back down, and vice versa.
  for (const e of started) if (e.multiplier !== 1) note(e, e.multiplier > 1 ? 1 : -1);
  for (const e of ended) if (e.multiplier !== 1) note(e, e.multiplier > 1 ? -1 : 1);

  return { events: kept, started, ended, causes };
}

/** Short tag for a market row — the "marker on the affected row" the design called for. */
export function marketEventTag(event: ActiveMarketEvent): string {
  if (event.blocksTrade) return 'closed';
  if (event.multiplier > 1) return 'in demand';
  return 'glut';
}
