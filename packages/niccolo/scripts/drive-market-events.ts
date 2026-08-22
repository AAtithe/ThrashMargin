/**
 * Market events (Phase 23) — demand layer, embargoes, cycling, narration.
 *
 * Lives in the repo rather than a scratch directory on purpose: three earlier phases' drivers were
 * written to a temp folder and lost to its cleanup, so a regression could not be re-run a week
 * later. `packages/tea-race/scripts/drive.ts` had already established the committed-driver pattern
 * in this repo; this follows it. Run with `npm run drive --workspace niccolo`.
 */
import { createInitialState } from '../src/sim/state';
import { processAction } from '../src/sim/actions';
import { priceAt, driftScarcity } from '../src/sim/market';
import {
  demandFactor, eventsAffecting, tradeBlockedAt, resolveWeeklyMarketEvents,
  marketEventTag, MAX_CONCURRENT_EVENTS,
} from '../src/sim/marketEvents';
import { generateNews } from '../src/sim/news';
import { cargoValue } from '../src/sim/insurance';
import { adviceFor } from '../src/sim/advisors';
import { EVENTS } from '../src/sim/content';
import templates from '../src/content/marketEvents/events.json';
import type { ActiveMarketEvent, GameState } from '../src/sim/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

function seed(): GameState {
  const base = createInitialState('drv23', 'Demand', { skipPrologue: true });
  return { ...base, cash: 4000, firedEvents: EVENTS.map(e => e.id), pendingEvents: [] };
}
const festival = (cityId: string, goodId: string, mult = 1.5, endsWeek = 40): ActiveMarketEvent => ({
  id: 'test_fest', templateId: 'me_doge_wedding', kind: 'festival_demand',
  cityId, goodId, multiplier: mult, blocksTrade: false, startedWeek: 0, endsWeek,
  headline: 'A wedding nobody can ignore.',
});
const embargo = (cityId: string, goodId: string): ActiveMarketEvent => ({
  id: 'test_emb', templateId: 'me_guild_embargo', kind: 'guild_embargo',
  cityId, goodId, multiplier: 1, blocksTrade: true, startedWeek: 0, endsWeek: 40,
  headline: 'The guild has closed the trade.',
});
const cityWide = (cityId: string, mult = 1.5): ActiveMarketEvent => ({
  id: 'test_war', templateId: 'me_war_scare', kind: 'war_scare',
  cityId, goodId: null, multiplier: mult, blocksTrade: false, startedWeek: 0, endsWeek: 40,
  headline: 'An army on the move and nobody will say whose.',
});

// ---------------------------------------------------------------------------
console.log('\n1. Content and the demand layer itself');
// ---------------------------------------------------------------------------
{
  const t = templates as { id: string; kind: string; scope: string; multiplier: number; durationWeeks: [number, number]; headline: string; blocksTrade?: boolean }[];
  check(`${t.length} templates authored`, t.length >= 6, `${t.length}`);
  check('every template has a headline with a {city} slot', t.every(x => x.headline.includes('{city}')));
  check('good-scoped templates name a {good}', t.filter(x => x.scope === 'good').every(x => x.headline.includes('{good}')));
  check('city-scoped templates do not', t.filter(x => x.scope === 'city').every(x => !x.headline.includes('{good}')));
  check('durations are sane ranges', t.every(x => x.durationWeeks[0] >= 1 && x.durationWeeks[1] >= x.durationWeeks[0]));
  check('every embargo template leaves its multiplier at 1 (blocksTrade carries the whole effect)',
    t.filter(x => x.blocksTrade).every(x => x.multiplier === 1));
  check('no template uses a multiplier of 0', t.every(x => x.multiplier > 0));
  check('all four kinds are represented',
    new Set(t.map(x => x.kind)).size === 4, [...new Set(t.map(x => x.kind))].join(','));

  check('no events means a demand factor of exactly 1', demandFactor(undefined, 'bruges', 'cloth') === 1);
  check('a festival multiplies', demandFactor([festival('bruges', 'cloth', 1.5)], 'bruges', 'cloth') === 1.5);
  check('and only at its own city+good',
    demandFactor([festival('bruges', 'cloth', 1.5)], 'ghent', 'cloth') === 1 &&
    demandFactor([festival('bruges', 'cloth', 1.5)], 'bruges', 'wool') === 1);
  check('a whole-city event covers every good',
    demandFactor([cityWide('bruges', 1.5)], 'bruges', 'wool') === 1.5 &&
    demandFactor([cityWide('bruges', 1.5)], 'bruges', 'cloth') === 1.5);
  check('tags read correctly', marketEventTag(festival('bruges','cloth',1.5)) === 'in demand'
    && marketEventTag(festival('bruges','cloth',0.6)) === 'glut'
    && marketEventTag(embargo('bruges','cloth')) === 'closed');
}

// ---------------------------------------------------------------------------
console.log('\n2. Demand survives drift — the whole reason it is not scarcity');
// ---------------------------------------------------------------------------
{
  const s = seed();
  const events = [festival('bruges', 'cloth', 1.5)];
  const plain = priceAt(s.scarcity, 'bruges', 'cloth')!;
  const dear = priceAt(s.scarcity, 'bruges', 'cloth', events)!;
  check('the event raises the price now', dear > plain, `${plain} -> ${dear}`);

  // Ten weeks of drift: if demand lived in scarcity, driftScarcity would have erased it.
  let scarcity = s.scarcity;
  for (let i = 0; i < 10; i++) scarcity = driftScarcity(scarcity);
  const stillDear = priceAt(scarcity, 'bruges', 'cloth', events)!;
  check('and still raises it after ten weeks of drift', stillDear === dear, `${dear} -> ${stillDear}`);

  // Contrast: the same size of move written into scarcity is almost entirely gone.
  let asScarcity = { ...s.scarcity, bruges: { ...s.scarcity.bruges, cloth: 1.5 } };
  for (let i = 0; i < 10; i++) asScarcity = driftScarcity(asScarcity);
  check('whereas a scarcity-based shift of the same size has decayed away',
    Math.abs((asScarcity.bruges.cloth ?? 1) - 1) < 0.05,
    `scarcity now ${(asScarcity.bruges.cloth ?? 1).toFixed(3)}`);
}

// ---------------------------------------------------------------------------
console.log('\n3. Every price the player sees or pays agrees');
// ---------------------------------------------------------------------------
{
  const events = [festival('bruges', 'cloth', 1.5)];
  const s: GameState = { ...seed(), marketEvents: events };
  const expected = priceAt(s.scarcity, 'bruges', 'cloth', events)!;

  // Buying: cash must move by the demand-affected price.
  const cashBefore = s.cash;
  const bought = processAction(s, { type: 'BUY_GOOD', vesselId: 'ship_1', goodId: 'cloth', quantity: 1 });
  check('buying charges the demand-affected price', Math.round(cashBefore - bought.cash) === expected,
    `charged ${Math.round(cashBefore - bought.cash)}, expected ${expected}`);
  check('and it is dearer than it would have been without the event',
    Math.round(cashBefore - bought.cash) > priceAt(s.scarcity, 'bruges', 'cloth')!);

  // Selling: revenue must use it too.
  const laden: GameState = { ...s, vessels: s.vessels.map(v => v.id === 'ship_1' ? { ...v, cargo: { cloth: 1 } } : v) };
  const sold = processAction(laden, { type: 'SELL_GOOD', vesselId: 'ship_1', goodId: 'cloth', quantity: 1 });
  check('selling realises the demand-affected price', Math.round(sold.cash - laden.cash) === expected,
    `${Math.round(sold.cash - laden.cash)} vs ${expected}`);

  // Reports must quote it, or the letter and the quay disagree.
  const news = generateNews(s.scarcity, s.week, {}, s.characters, undefined, events);
  const brugesReport = news.find(n => n.cityId === 'bruges')!;
  check('a report quotes the demand-affected price', brugesReport.prices.cloth === expected,
    `${brugesReport.prices.cloth} vs ${expected}`);

  // Insurance coverage values cargo at local prices.
  check('insurance coverage values cargo with demand',
    cargoValue(s.scarcity, { cloth: 2 }, 'bruges', events) === expected * 2);

  // Counsel standing on the quay must quote what the quay honours.
  const tip = adviceFor({ ...s, knownPrices: {} }).find(a => a.kind === 'trade');
  check('an advisor on the quay does not under-quote a festival',
    !tip || !tip.body.includes(`${priceAt(s.scarcity, 'bruges', 'cloth')}f in Bruges`),
    tip?.body);
}

// ---------------------------------------------------------------------------
console.log('\n4. An embargo closes trade without making anything free');
// ---------------------------------------------------------------------------
{
  const events = [embargo('bruges', 'cloth')];
  const s: GameState = { ...seed(), marketEvents: events };
  check('the embargo is detected', !!tradeBlockedAt(events, 'bruges', 'cloth'));
  check('and only for its own good', !tradeBlockedAt(events, 'bruges', 'wool'));
  check('the price is untouched, not zero', priceAt(s.scarcity, 'bruges', 'cloth', events) === priceAt(s.scarcity, 'bruges', 'cloth'));

  let threw = '';
  try { processAction(s, { type: 'BUY_GOOD', vesselId: 'ship_1', goodId: 'cloth', quantity: 1 }); }
  catch (e) { threw = (e as Error).message; }
  check('buying is refused', threw.includes('closed'), threw);
  check('and the refusal explains itself with the event\'s own words', threw.includes('guild'), threw);

  const laden: GameState = { ...s, vessels: s.vessels.map(v => v.id === 'ship_1' ? { ...v, cargo: { cloth: 2 } } : v) };
  threw = '';
  try { processAction(laden, { type: 'SELL_GOOD', vesselId: 'ship_1', goodId: 'cloth', quantity: 1 }); }
  catch (e) { threw = (e as Error).message; }
  check('selling is refused too', threw.includes('closed'), threw);

  // A good the embargo does not touch still trades normally.
  const wool = processAction(s, { type: 'BUY_GOOD', vesselId: 'ship_1', goodId: 'wool', quantity: 1 });
  check('an untouched good still trades', wool.cash < s.cash);
}

// ---------------------------------------------------------------------------
console.log('\n5. Weekly cycling, narration, and save compatibility');
// ---------------------------------------------------------------------------
{
  const real = Math.random;
  try {
    Math.random = () => 0.01; // always below NEW_EVENT_CHANCE_PER_WEEK
    let events: ActiveMarketEvent[] = [];
    for (let w = 1; w <= 20; w++) events = resolveWeeklyMarketEvents(events, w).events;
    check(`never exceeds ${MAX_CONCURRENT_EVENTS} concurrent events`, events.length <= MAX_CONCURRENT_EVENTS, `${events.length}`);
    check('no two events share the same city+good target',
      new Set(events.map(e => `${e.cityId}:${e.goodId ?? '*'}`)).size === events.length);
    check('no good-scoped event shares a city with a whole-city one', events.every(e =>
      e.goodId === null || !events.some(o => o.goodId === null && o.cityId === e.cityId)));
    check('every headline had its placeholders filled', events.every(e => !/\{\w+\}/.test(e.headline)),
      events.map(e => e.headline).join(' | ').slice(0, 160));

    // Starting one produces a demand_shift note; ending one produces the opposite direction.
    const started = resolveWeeklyMarketEvents([], 1);
    if (started.started.length > 0) {
      const e = started.started[0];
      const notes = started.causes[e.cityId] ?? [];
      check('a started event is narrated as demand_shift', notes.length > 0 && notes.every(n => n.kind === 'demand_shift'));
      check('a whole-city event names every good, leaving no unexplained row',
        e.goodId !== null || notes.length > 1, `${notes.length} notes for a ${e.goodId === null ? 'city' : 'good'} event`);
      // Suppress new spawns for this call: with the roll forced low, a fresh event starts every
      // week and would both keep the list non-empty and add its own notes at the same city, which
      // is what made an earlier version of these two checks read the wrong numbers.
      Math.random = () => 0.99;
      const expiring = resolveWeeklyMarketEvents([{ ...e, endsWeek: 2 }], 2);
      Math.random = () => 0.01;
      check('an expired event is retired', !expiring.events.some(x => x.id === e.id) && expiring.ended.length === 1,
        `kept=${expiring.events.length} ended=${expiring.ended.length}`);
      check('and nothing else was started in its place', expiring.started.length === 0);
      const startDir = (started.causes[e.cityId] ?? []).find(n => n.goodId === (e.goodId ?? (started.causes[e.cityId] ?? [])[0]?.goodId))?.direction;
      const endDir = (expiring.causes[e.cityId] ?? [])[0]?.direction;
      check('and its ending narrates the opposite direction', startDir !== undefined && endDir === -startDir,
        `${startDir} then ${endDir}`);
    } else {
      check('a started event is narrated as demand_shift', false, 'no event started with a forced roll');
    }

    Math.random = () => 0.99; // above the chance
    check('nothing starts when the roll misses', resolveWeeklyMarketEvents([], 5).started.length === 0);
  } finally { Math.random = real; }

  // Save compat: a save from before the field.
  const legacy = seed();
  delete (legacy as Partial<GameState>).marketEvents;
  const advanced = processAction(legacy, { type: 'ADVANCE_WEEK' });
  check('a pre-Phase-23 save advances without throwing', advanced.week === legacy.week + 1);
  check('and gains an events array', Array.isArray(advanced.marketEvents));
  check('prices are unchanged with no events running',
    priceAt(advanced.scarcity, 'bruges', 'cloth', []) === priceAt(advanced.scarcity, 'bruges', 'cloth'));
  check('eventsAffecting is safe on an absent list', eventsAffecting(undefined, 'bruges', 'cloth').length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
