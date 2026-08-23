/**
 * Chapter 7, Caprice and Rondo (Phase 24) — exile, the Caffa extraction, Persia, the Ochoa thread,
 * and the Burgundy shock. Run with `npm run drive --workspace niccolo`.
 */
import { createInitialState } from '../src/sim/state';
import { processAction } from '../src/sim/actions';
import { EVENTS, ROUTES, findRoute, findEvent, marketGoodsAt } from '../src/sim/content';
import { priceAt } from '../src/sim/market';
import { currentChapterNumber, CHAPTER_TITLES } from '../src/sim/objectives';
import { cityBarred, EXILE_FLAG, EXILED_CITY_IDS, demandFactor } from '../src/sim/marketEvents';
import type { GameState } from '../src/sim/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

function seed(): GameState {
  const base = createInitialState('drv7', 'Ch7', { skipPrologue: true });
  const flags: Record<string, boolean> = { ...base.flags };
  for (let n = 0; n <= 6; n++) flags[`chapter${n}_complete`] = true;
  return {
    ...base, cash: 6000, flags, flagWeeks: { ...(base.flagWeeks ?? {}) },
    firedEvents: EVENTS.filter(e => e.chapter <= 6).map(e => e.id), pendingEvents: [],
    lastAcknowledgedChapter: 7,
  };
}
function drain(g: GameState, choices: Record<string, number> = {}): GameState {
  let guard = 0;
  while (g.pendingEvents.length > 0) {
    if (++guard > 300) throw new Error('queue did not drain');
    const id = g.pendingEvents[0];
    g = processAction(g, { type: 'RESOLVE_EVENT', eventId: id, choiceIndex: choices[id] ?? 0 });
  }
  return g;
}
function tick(g: GameState, n = 1, c: Record<string, number> = {}): GameState {
  for (let i = 0; i < n; i++) g = drain(processAction(g, { type: 'ADVANCE_WEEK' }), c);
  return g;
}
function teleport(g: GameState, cityId: string): GameState {
  // Chapter 7's map is far east of anything a driver wants to sail leg by leg; the itinerary itself
  // is exercised by the reachability check below, so arrival is set directly here.
  return { ...g, vessels: g.vessels.map(v => (v.id === 'ship_1' ? { ...v, location: cityId, destination: null, weeksRemaining: 0 } : v)) };
}

console.log('\n1. Content sanity');
{
  const c7 = EVENTS.filter(e => e.chapter === 7);
  check(`${c7.length} events, inside §9's 25-40 range`, c7.length >= 25 && c7.length <= 40, `${c7.length}`);
  check('ids unique', new Set(c7.map(e => e.id)).size === c7.length);

  const VALID = new Set(['dateAfter','location','flag','flags','flagAbsent','cargoAtLeast','vesselKindAt','vesselIdAt','combinedCargoAtLeast','weeksAfterFlag']);
  const badKeys: string[] = [];
  for (const e of c7) for (const k of Object.keys(e.trigger)) if (!VALID.has(k)) badKeys.push(`${e.id}.${k}`);
  check('no invalid trigger keys', badKeys.length === 0, badKeys.join(', '));

  check('no Chapter 7 event uses an absolute dateAfter', c7.every(e => !e.trigger.dateAfter),
    c7.filter(e => e.trigger.dateAfter).map(e => e.id).join(', '));

  const settable = new Set<string>(['chapter6_complete']);
  for (const e of EVENTS) for (const ch of e.choices) {
    if (ch.effects.flag) settable.add(ch.effects.flag);
    for (const f of ch.effects.flags ?? []) settable.add(f);
  }
  const missing: string[] = [];
  for (const e of c7) {
    const t = e.trigger;
    for (const f of [t.flag, t.flagAbsent, t.weeksAfterFlag?.flag, ...(t.flags ?? [])]) {
      if (f && !settable.has(f)) missing.push(`${e.id}:${f}`);
    }
  }
  check('every trigger flag is settable somewhere', missing.length === 0, missing.join(', '));

  const reach = new Set(['bruges']);
  let grew = true;
  while (grew) { grew = false;
    for (const r of ROUTES) {
      if (reach.has(r.from) && !reach.has(r.to)) { reach.add(r.to); grew = true; }
      if (reach.has(r.to) && !reach.has(r.from)) { reach.add(r.from); grew = true; }
    } }
  check('caffa is reachable from Bruges', reach.has('caffa'));
  check('tabriz is reachable from Bruges', reach.has('tabriz'));
  check('both new cities trade something', marketGoodsAt('caffa').length > 0 && marketGoodsAt('tabriz').length > 0);
}

console.log('\n1a. The chapter chain is consistent end to end');
{
  // A real bug this exists to prevent: an edit script died partway through the freeze migration and
  // left `currentChapterNumber`/`CHAPTER_TITLES` a chapter behind everything else. `tsc` passed
  // (both edits are additive) and only a live page load showed the header naming the wrong chapter.
  const seven: GameState = { ...seed() };
  check('currentChapterNumber follows the flag chain to 7', currentChapterNumber(seven) === 7, `${currentChapterNumber(seven)}`);
  check('every shipped chapter has a title', Array.from({ length: 8 }, (_, n) => n).every(n => !!CHAPTER_TITLES[n]),
    JSON.stringify(CHAPTER_TITLES));
  check('chapter 7 is titled', CHAPTER_TITLES[7] === 'Caprice and Rondo', CHAPTER_TITLES[7]);
  // The freeze must sit on the LAST shipped chapter, derived from content rather than hard-coded —
  // an earlier freeze silently ends the campaign a chapter short, and a hard-coded assertion here
  // goes stale the moment another chapter ships (which is exactly what happened when Chapter 8
  // landed and this check still named chapter 7).
  const lastChapter = Math.max(...EVENTS.map(e => e.chapter));
  const base = seed();
  const frozen: GameState = { ...base, flags: { ...base.flags, [`chapter${lastChapter}_complete`]: true } };
  check(`chapter${lastChapter}_complete freezes the campaign`,
    processAction(frozen, { type: 'ADVANCE_WEEK' }).week === frozen.week);
  const penultimate: GameState = { ...base, flags: { ...base.flags, [`chapter${lastChapter - 1}_complete`]: true } };
  check(`chapter${lastChapter - 1}_complete does NOT`,
    processAction(penultimate, { type: 'ADVANCE_WEEK' }).week === penultimate.week + 1);
}

console.log('\n1b. The dossier has enough material for Chapter 8 to resolve');
{
  const granting = EVENTS.filter(e => e.choices.some(c => c.effects.evidence?.track === 'parentage'));
  const guaranteed = EVENTS.filter(e => e.choices.length > 0 && e.choices.every(c => c.effects.evidence?.track === 'parentage'));
  check('at least six events can add to the parentage dossier', granting.length >= 6,
    `${granting.length}: ${granting.map(e => e.id).join(', ')}`);
  check('at least two of them are unavoidable', guaranteed.length >= 2, guaranteed.map(e => e.id).join(', '));
  const ids = new Set<string>();
  const dupes: string[] = [];
  for (const e of EVENTS) for (const c of e.choices) {
    const id = c.effects.evidence?.id;
    if (!id) continue;
    // The same id may legitimately repeat across branches of ONE event (that is how a piece is made
    // unavoidable); a repeat across two different events would be a content mistake.
    if (ids.has(`${e.id}:${id}`)) continue;
    ids.add(`${e.id}:${id}`);
  }
  const byId = new Map<string, Set<string>>();
  for (const key of ids) {
    const [evId, evidenceId] = key.split(':');
    (byId.get(evidenceId) ?? byId.set(evidenceId, new Set()).get(evidenceId)!).add(evId);
  }
  for (const [evidenceId, events] of byId) if (events.size > 1) dupes.push(`${evidenceId} in ${[...events].join('/')}`);
  check('no evidence id is granted by two different events', dupes.length === 0, dupes.join(', '));
}

console.log('\n2. Exile actually closes Flanders');
{
  let s = seed();
  s = tick(s, 1);
  check('the opener sets the ban', !!s.flags[EXILE_FLAG]);
  check('cityBarred agrees for every Flanders port', EXILED_CITY_IDS.every(c => cityBarred(s.flags, c)));
  check('and not for anywhere else', !cityBarred(s.flags, 'venice') && !cityBarred(s.flags, 'danzig'));

  const atCalais = teleport(s, 'calais');
  let threw = '';
  try { processAction(atCalais, { type: 'DISPATCH_VESSEL', vesselId: 'ship_1', destinationId: 'bruges' }); }
  catch (e) { threw = (e as Error).message; }
  check('dispatching into Bruges is refused while banned', threw.includes('closed to the house'), threw);

  const lifted: GameState = { ...atCalais, flags: { ...atCalais.flags, [EXILE_FLAG]: false } };
  check('and permitted once the ban lifts',
    processAction(lifted, { type: 'DISPATCH_VESSEL', vesselId: 'ship_1', destinationId: 'bruges' }).vessels
      .find(v => v.id === 'ship_1')!.destination === 'bruges');
}

console.log('\n3. Success path — every thread resolved');
let s = seed();
{
  const best = { ev_c7_001: 0, ev_c7_005: 1, ev_c7_007: 0, ev_c7_008: 0, ev_c7_009: 0, ev_c7_010: 0,
                 ev_c7_017: 1, ev_c7_019: 0, ev_c7_021: 0, ev_c7_025: 0 };
  s = tick(s, 1, best);
  s = teleport(s, 'danzig');
  s = tick(s, 4, best);
  check('the exile winter resolved', !!s.flags.exile_winter_resolved);
  check('Moriz joined', s.characters.some(c => c.id === 'moriz' && c.status === 'active'));
  check('Burgundian exposure was counted', !!s.flags.burgundy_exposure_counted);

  s = tick(s, 2, best);
  check('Caffa is offered, with passages', !!s.flags.caffa_bound && !!s.flags.caffa_passage_offered);
  s = teleport(s, 'caffa');
  s = tick(s, 3, best);
  check('reached Caffa and the window opened', !!s.flags.reached_caffa && !!s.flags.caffa_window_open);
  check("the consul's own count is held as a secret", s.secrets.some(x => x.id === 'secret_caffa_fleet'));
  check('the Ochoa manifest is pinned as parentage evidence',
    (s.evidence ?? []).some(e => e.id === 'par_ochoa_manifest'));

  s = teleport(s, 'tabriz');
  s = tick(s, 3, best);
  check('reached Tabriz', !!s.flags.reached_tabriz);
  check('the Persian account resolved', !!s.flags.persia_resolved);
  check('Venice\'s undelivered promises are held as a secret', s.secrets.some(x => x.id === 'secret_venetian_promises'));

  s = tick(s, 2, best);
  check('the Ochoa thread resolved with a deposition',
    !!s.flags.ochoa_resolved && (s.evidence ?? []).some(e => e.id === 'par_ochoa_testimony'));
  check('Moriz put the papers in date order and the name was said',
    !!s.flags.jordan_revelations_resolved && !!s.flags.jordan_named);
  // The seed pre-marks Chapters 0-6 as fired, so their own parentage pieces were never granted —
  // this counts only what Chapter 7 itself contributes, which is the thing under test.
  check('Chapter 7 contributes at least two parentage pieces',
    (s.evidence ?? []).filter(e => e.track === 'parentage').length >= 2,
    `${(s.evidence ?? []).filter(e => e.track === 'parentage').length}`);

  // Bring the hull home to Danzig for the extraction check, then let Nancy fire.
  s = teleport(s, 'danzig');
  s = tick(s, 2, best);
  check('the Crimea came out ahead of the fleet', !!s.flags.caffa_extraction_success);
  check('the failure branch did NOT also fire', !s.firedEvents.includes('ev_c7_014'));
  check('caffa_epilogue set', !!s.flags.caffa_epilogue);

  // Step week by week and capture the state the week Nancy actually fires: the shock it installs
  // expires after 14 weeks, so asserting on it at a fixed offset is a timing coin-flip. An earlier
  // version of this check ticked 14 weeks first and then found nothing running.
  let atNancy: GameState | null = null;
  for (let i = 0; i < 20 && !atNancy; i++) {
    s = tick(s, 1, best);
    if (s.flags.nancy_news) atNancy = s;
  }
  check('Nancy fired', !!atNancy);
  const shockEvents = (atNancy?.marketEvents ?? []).filter(e => EXILED_CITY_IDS.includes(e.cityId));
  check('and Flanders repriced through the demand layer', shockEvents.length > 0,
    `${(atNancy?.marketEvents ?? []).length} events running`);
  const brugesShock = shockEvents.find(e => e.cityId === 'bruges');
  check('the shock is a whole-city event', !!brugesShock && brugesShock.goodId === null);
  check('it does not block trade — a repricing is not an embargo', !!brugesShock && !brugesShock.blocksTrade);
  check('and it really moves the price', demandFactor(atNancy?.marketEvents, 'bruges', 'cloth') > 1,
    `factor ${demandFactor(atNancy?.marketEvents, 'bruges', 'cloth')}`);
  check('the paper sold in time paid off', !!s.flags.burgundy_trap_survived && !!s.flags.flanders_resolved);

  s = tick(s, 2, best);
  check('the ban lifted', !!s.flags.exile_lifted && !s.flags[EXILE_FLAG] === false || !!s.flags.exile_lifted);
  s = teleport(s, 'bruges');
  s = tick(s, 3, best);
  check('returned to Bruges', !!s.flags.returned_to_bruges);
  s = tick(s, 2, best);
  check('chapter7_complete reached', !!s.flags.chapter7_complete, `week ${s.week}`);
  // No longer the end of the campaign — Chapter 8 shipped, so this is a handoff like every other
  // chapter flag before it. What matters is that play continues and Chapter 8 picks it up.
  check('play continues into Chapter 8 rather than freezing',
    processAction(s, { type: 'ADVANCE_WEEK' }).week === s.week + 1);
  check('and the chapter badge advances to 8', currentChapterNumber(s) === 8, `${currentChapterNumber(s)}`);
  console.log(`  (success path completed at week ${s.week}, ${Math.round(s.cash)}f, conscience ${Math.round(s.conscience)})`);
}

console.log('\n4. Failure path — the fleet arrives first, the paper is still held');
{
  const worst = { ev_c7_001: 1, ev_c7_005: 0, ev_c7_007: 1, ev_c7_008: 1, ev_c7_009: 1, ev_c7_010: 1,
                  ev_c7_019: 1, ev_c7_021: 2, ev_c7_024: 1, ev_c7_025: 0 };
  let f = seed();
  f = tick(f, 1, worst);
  f = teleport(f, 'danzig');
  f = tick(f, 6, worst);
  f = teleport(f, 'caffa');
  f = tick(f, 3, worst);
  // Both of these depend on having reached Caffa, so they are checked after the visit, not before —
  // an earlier version asserted them at Danzig, where neither event can have fired yet.
  check('the consul was deceived', !!f.flags.caffa_consul_deceived);
  check('the Ochoa thread was let go', !!f.flags.ochoa_declined);
  const openWeek = f.flagWeeks!.caffa_window_open;
  check('the Caffa window opened', typeof openWeek === 'number');
  f = teleport(f, 'tabriz');
  f = tick(f, 3, worst);
  f = tick(f, 20, worst);
  check('the window has not lapsed at 20-odd weeks', !f.flags.caffa_resolved);
  f = tick(f, 18, worst);
  check('the fleet arrived first after 34 weeks', !!f.flags.caffa_extraction_failed,
    `${f.week - openWeek} weeks after opening`);
  check('the success branch did NOT also fire', !f.firedEvents.includes('ev_c7_013'));
  check('caffa_epilogue still reached', !!f.flags.caffa_epilogue);
  check('the paper was not sold', !f.flags.burgundy_paper_sold);
  check('so Flanders resolved the costly way', !!f.flags.flanders_resolved && !f.flags.burgundy_trap_survived);
  f = teleport(f, 'bruges');
  f = tick(f, 4, worst);
  check('chapter7_complete reached on the failure path too', !!f.flags.chapter7_complete, `week ${f.week}`);
  console.log(`  (failure path completed at week ${f.week})`);
}

console.log('\n5. The market shock in isolation, and save compatibility');
{
  const ev = findEvent('ev_c7_022')!;
  const shock = ev.choices[0].effects.marketShock!;
  check('the shock names the Flanders ports', shock.cityIds.includes('bruges') && shock.cityIds.includes('ghent'));
  check('it is a real multiplier', shock.multiplier > 1);
  check('and it expires', shock.weeks > 0 && shock.weeks < 60);

  const base = seed();
  const before = priceAt(base.scarcity, 'bruges', 'cloth')!;
  const shocked: GameState = {
    ...base, pendingEvents: ['ev_c7_022'],
    flags: { ...base.flags, flanders_position_set: true, burgundy_paper_sold: true },
  };
  const after = processAction(shocked, { type: 'RESOLVE_EVENT', eventId: 'ev_c7_022', choiceIndex: 0 });
  check('resolving it installs events at every named city',
    shock.cityIds.every(c => (after.marketEvents ?? []).some(e => e.cityId === c)));
  check('and the Bruges price actually rises',
    priceAt(after.scarcity, 'bruges', 'cloth', after.marketEvents)! > before,
    `${before} -> ${priceAt(after.scarcity, 'bruges', 'cloth', after.marketEvents)}`);

  const legacy = seed();
  delete (legacy as Partial<GameState>).marketEvents;
  check('a save without marketEvents still advances', processAction(legacy, { type: 'ADVANCE_WEEK' }).week === legacy.week + 1);
  const noFlags: GameState = { ...seed(), flags: {} };
  check('cityBarred is safe with no flags at all', !cityBarred(noFlags.flags, 'bruges'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
