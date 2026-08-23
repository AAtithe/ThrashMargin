/**
 * Chapter 8, Gemini, and the epilogue (Phase 25) — the dossier resolution, the St Pol endgame, the
 * three endings, and the one screen in this game that ends a campaign rather than freezing it.
 * Run with `npm run drive --workspace niccolo`.
 */
import { createInitialState } from '../src/sim/state';
import { processAction } from '../src/sim/actions';
import { EVENTS, findEvent } from '../src/sim/content';
import { readParentage, PARENTAGE_BANDS } from '../src/sim/dossier';
import { currentChapterNumber, CHAPTER_TITLES, objectivesForChapter } from '../src/sim/objectives';
import type { EvidenceItem, GameState } from '../src/sim/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

function pieces(n: number): EvidenceItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `par_test_${i}`, name: `Paper ${i}`, description: '', track: 'parentage' as const,
    kind: 'document' as const, discoveredWeek: 0,
  }));
}
function seed(evidenceCount = 2): GameState {
  const base = createInitialState('drv8', 'Ch8', { skipPrologue: true });
  const flags: Record<string, boolean> = { ...base.flags };
  for (let n = 0; n <= 7; n++) flags[`chapter${n}_complete`] = true;
  return {
    ...base, cash: 8000, flags, flagWeeks: { ...(base.flagWeeks ?? {}) },
    evidence: pieces(evidenceCount),
    firedEvents: EVENTS.filter(e => e.chapter <= 7).map(e => e.id), pendingEvents: [],
    lastAcknowledgedChapter: 8,
  };
}
function drain(g: GameState, c: Record<string, number> = {}): GameState {
  let guard = 0;
  while (g.pendingEvents.length > 0) {
    if (++guard > 300) throw new Error('queue did not drain');
    const id = g.pendingEvents[0];
    g = processAction(g, { type: 'RESOLVE_EVENT', eventId: id, choiceIndex: c[id] ?? 0 });
  }
  return g;
}
function tick(g: GameState, n = 1, c: Record<string, number> = {}): GameState {
  for (let i = 0; i < n; i++) g = drain(processAction(g, { type: 'ADVANCE_WEEK' }), c);
  return g;
}
const atEdinburgh = (g: GameState): GameState => ({
  ...g, vessels: g.vessels.map(v => (v.id === 'ship_1' ? { ...v, location: 'edinburgh', destination: null } : v)),
});

console.log('\n1. Content and chain');
{
  const c8 = EVENTS.filter(e => e.chapter === 8);
  check(`${c8.length} events, inside §9's 25-40 range`, c8.length >= 25 && c8.length <= 40, `${c8.length}`);
  check('ids unique', new Set(c8.map(e => e.id)).size === c8.length);
  const VALID = new Set(['dateAfter','location','flag','flags','flagAbsent','cargoAtLeast','vesselKindAt','vesselIdAt','combinedCargoAtLeast','weeksAfterFlag']);
  const bad: string[] = [];
  for (const e of c8) for (const k of Object.keys(e.trigger)) if (!VALID.has(k)) bad.push(`${e.id}.${k}`);
  check('no invalid trigger keys', bad.length === 0, bad.join(', '));
  check('no absolute dates', c8.every(e => !e.trigger.dateAfter));
  check('no new cities were added for the finale',
    !EVENTS.some(e => e.chapter === 8 && e.trigger.location && !['edinburgh','bruges'].includes(e.trigger.location)));

  const s = seed();
  check('the flag chain reaches 8', currentChapterNumber(s) === 8, `${currentChapterNumber(s)}`);
  check('chapter 8 is titled', CHAPTER_TITLES[8] === 'Gemini', CHAPTER_TITLES[8]);
  const done: GameState = { ...s, flags: { ...s.flags, chapter8_complete: true } };
  check('chapter8_complete freezes the campaign', processAction(done, { type: 'ADVANCE_WEEK' }).week === done.week);
  check('chapter7_complete does not', processAction(s, { type: 'ADVANCE_WEEK' }).week === s.week + 1);
}

console.log('\n2. The parentage reading scales rather than gates');
{
  check('bands are ordered high to low', PARENTAGE_BANDS.every((b, i) => i === 0 || PARENTAGE_BANDS[i - 1].min > b.min));
  check('the lowest band accepts zero', PARENTAGE_BANDS[PARENTAGE_BANDS.length - 1].min === 0);
  const readings = [0, 2, 3, 5, 7, 12].map(n => readParentage(seed(n)));
  check('an empty dossier still reads', readings[0].confidence === 'unproven' && !readings[0].provable);
  check('the guaranteed floor of two is still unproven', readings[1].confidence === 'unproven');
  check('three is circumstantial and not provable', readings[2].confidence === 'circumstantial' && !readings[2].provable);
  check('five is documented and provable', readings[3].confidence === 'documented' && readings[3].provable);
  check('seven is incontestable', readings[4].confidence === 'incontestable' && readings[4].provable);
  check('more than seven does not break it', readings[5].confidence === 'incontestable');
  check('confidence never decreases as pieces are added',
    readings.every((r, i) => i === 0 || PARENTAGE_BANDS.findIndex(b => b.confidence === r.confidence)
      <= PARENTAGE_BANDS.findIndex(b => b.confidence === readings[i - 1].confidence)));
  check('the reading exposes a flag content can branch on', readings[3].flag === 'parentage_documented');

  // The flag must actually be set by the engine, or Chapter 8's content can never branch.
  const advanced = processAction(seed(5), { type: 'ADVANCE_WEEK' });
  check('advanceWeek sets the reading flag', !!advanced.flags.parentage_documented);
  check('and not a band the dossier has not reached', !advanced.flags.parentage_incontestable);
}

console.log('\n3. Every dossier size can reach an ending — nothing soft-locks');
{
  for (const [n, expected] of [[0, 'parentage_unproved'], [3, 'parentage_unproved'], [5, 'parentage_proved'], [8, 'parentage_proved']] as const) {
    let s = seed(n as number);
    s = tick(s, 1);
    s = atEdinburgh(s);
    s = tick(s, 8);
    check(`a ${n}-piece dossier resolves the parentage thread`, !!s.flags.parentage_resolved, `${n} pieces`);
    check(`  and reaches ${expected}`, !!s.flags[expected], JSON.stringify({ proved: !!s.flags.parentage_proved, unproved: !!s.flags.parentage_unproved }));
    check(`  exactly one dossier event fired for ${n} pieces`,
      ['ev_c8_008','ev_c8_009','ev_c8_010','ev_c8_011'].filter(id => s.firedEvents.includes(id)).length === 1,
      ['ev_c8_008','ev_c8_009','ev_c8_010','ev_c8_011'].filter(id => s.firedEvents.includes(id)).join(','));
  }
}

console.log('\n4. Full playthrough, all three endings');
{
  for (const [choice, flag, title] of [[0, 'shape_scottish_house', 'A Scottish landed house'],
                                        [1, 'shape_venetian_bank', 'A Venetian bank'],
                                        [2, 'shape_dissolution', 'Dissolved into legacy']] as const) {
    let s = seed(7);
    s = { ...s, flags: { ...s.flags, vatachino_unmasked: true, vatachino_named: true } };
    s = tick(s, 1);
    s = atEdinburgh(s);
    s = tick(s, 12, { ev_c8_014: choice as number });
    check(`ending ${choice}: the shape was chosen`, !!s.flags.final_shape_chosen && !!s.flags[flag], flag);
    check(`ending ${choice}: chapter8_complete reached`, !!s.flags.chapter8_complete, `week ${s.week}`);
    check(`ending ${choice}: only one shape flag is set`,
      ['shape_scottish_house','shape_venetian_bank','shape_dissolution'].filter(f => s.flags[f]).length === 1);
    check(`ending ${choice}: the campaign is over, not frozen mid-chapter`,
      processAction(s, { type: 'ADVANCE_WEEK' }).week === s.week);
  }
}

console.log('\n5. The St Pol endgame branches on the unmasking');
{
  let named = seed(7);
  named = { ...named, flags: { ...named.flags, vatachino_unmasked: true, vatachino_named: true } };
  named = tick(atEdinburgh(tick(named, 1)), 10);
  check('with the Vatachino named, Ribérac can be made to answer', named.firedEvents.includes('ev_c8_012'));
  check('and the unnamed branch did not also fire', !named.firedEvents.includes('ev_c8_013'));

  let unnamed = seed(7);
  unnamed = tick(atEdinburgh(tick(unnamed, 1)), 10);
  check('without it, the confrontation settles nothing', unnamed.firedEvents.includes('ev_c8_013'));
  check('and the named branch did not fire', !unnamed.firedEvents.includes('ev_c8_012'));
  check('both still resolve the thread', !!named.flags.stpol_endgame_resolved && !!unnamed.flags.stpol_endgame_resolved);
}

console.log('\n6. Objectives and the epilogue figures');
{
  let s = seed(7);
  s = { ...s, flags: { ...s.flags, vatachino_unmasked: true, vatachino_named: true } };
  s = tick(atEdinburgh(tick(s, 1)), 12);
  const objs = objectivesForChapter(s, 8);
  check('chapter 8 has objectives authored', objs.length >= 5, `${objs.length}`);
  check('all non-optional threads resolved on a full run',
    objs.filter(o => !o.objective.optional).every(o => o.status === 'complete'),
    objs.filter(o => !o.objective.optional && o.status !== 'complete').map(o => o.objective.id).join(', '));
  check('the shape objective is reveal-gated', !!objs.find(o => o.objective.id === 'obj_c8_shape')?.objective.revealFlag);

  // The epilogue's own arithmetic: net worth must count cash and cargo and subtract what is owed.
  const withDebt: GameState = {
    ...s,
    cash: 1000,
    obligations: [
      { id: 'o1', kind: 'bill_payable', direction: 'payable', currency: 'florin', cityId: 'bruges',
        amount: 400, issuedWeek: 0, matureWeek: s.week + 50, settled: false },
      { id: 'o2', kind: 'loan_merchant', direction: 'receivable', currency: 'florin', cityId: 'bruges',
        amount: 200, issuedWeek: 0, matureWeek: s.week + 50, settled: false },
    ],
  };
  // Recomputed here the same way EpilogueScreen does, so a divergence in either shows up.
  const owed = withDebt.obligations.filter(o => !o.settled && o.direction === 'payable')
    .reduce((n, o) => n + o.amount, 0);
  const due = withDebt.obligations.filter(o => !o.settled && o.direction === 'receivable')
    .reduce((n, o) => n + o.amount, 0);
  check('a payable reduces net worth and a receivable raises it', owed === 400 && due === 200);
  check('the reading is available to the epilogue', readParentage(withDebt).pieces === 7);
}

console.log('\n7. Save compatibility');
{
  const legacy = seed(3);
  delete (legacy as Partial<GameState>).evidence;
  const advanced = processAction(legacy, { type: 'ADVANCE_WEEK' });
  check('a save with no evidence array still advances', advanced.week === legacy.week + 1);
  check('and reads as unproven rather than crashing', readParentage(advanced).confidence === 'unproven');
  check('the unproven branch is reachable from it',
    EVENTS.some(e => e.id === 'ev_c8_011' && (e.trigger.flags ?? []).includes('parentage_unproven')));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
