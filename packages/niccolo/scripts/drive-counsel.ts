/**
 * Counsel and the household's own losses (Phases 21-22).
 *
 * Lives in the repo rather than a scratch directory on purpose: three earlier phases' drivers were
 * written to a temp folder and lost to its cleanup, so a regression could not be re-run a week
 * later. `packages/tea-race/scripts/drive.ts` had already established the committed-driver pattern
 * here; this follows it. These are the invariants worth keeping runnable, reconstructed rather than
 * a verbatim copy of the originals. Run with `npm run drive --workspace niccolo`.
 */
import { createInitialState } from '../src/sim/state';
import { processAction } from '../src/sim/actions';
import { adviceFor, urgentAdvice, MAX_ADVICE_SHOWN } from '../src/sim/advisors';
import { objectivesForChapter } from '../src/sim/objectives';
import { EVENTS, findEvent } from '../src/sim/content';
import advisorContent from '../src/content/advisors/officers.json';
import type { GameState } from '../src/sim/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

function seed(): GameState {
  const base = createInitialState('drv-counsel', 'Counsel', { skipPrologue: true });
  return { ...base, cash: 500, firedEvents: EVENTS.map(e => e.id), pendingEvents: [] };
}
const marian = (s: GameState) => s.characters.find(c => c.id === 'marian')!;
function drain(g: GameState, choices: Record<string, number> = {}): GameState {
  let guard = 0;
  while (g.pendingEvents.length > 0) {
    if (++guard > 200) throw new Error('queue did not drain');
    const id = g.pendingEvents[0];
    g = processAction(g, { type: 'RESOLVE_EVENT', eventId: id, choiceIndex: choices[id] ?? 0 });
  }
  return g;
}
function tick(g: GameState, n: number, c: Record<string, number> = {}): GameState {
  for (let i = 0; i < n; i++) g = drain(processAction(g, { type: 'ADVANCE_WEEK' }), c);
  return g;
}

console.log('\n— Counsel structure');
{
  const s = seed();
  const before = JSON.stringify(s);
  adviceFor(s); urgentAdvice(s);
  check('adviceFor mutates nothing', JSON.stringify(s) === before);
  check('stable across repeat calls in one week', JSON.stringify(adviceFor(s)) === JSON.stringify(adviceFor(s)));
  check('sorted most urgent first', (() => {
    const rank = { urgent: 0, notable: 1, passing: 2 } as const;
    const a = adviceFor(s);
    return a.every((x, i) => i === 0 || rank[a[i - 1].urgency] <= rank[x.urgency]);
  })());
  check('no unfilled placeholder ever reaches the screen', adviceFor(s).every(a => !/\{\w+\}/.test(a.body)));
  check(`the panel's cap is a positive number (${MAX_ADVICE_SHOWN})`, MAX_ADVICE_SHOWN > 0);

  type Officer = { id: string; domains: string[]; lines: Record<string, string[]> };
  const officers = advisorContent as unknown as Officer[];
  const mixed: string[] = [];
  for (const o of officers) for (const [kind, lines] of Object.entries(o.lines)) {
    const sets = lines.map(l => [...l.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(','));
    if (new Set(sets).size > 1) mixed.push(`${o.id}.${kind}`);
  }
  check('no kind mixes phrasings with different placeholders', mixed.length === 0, mixed.join(', '));
  const mismatch: string[] = [];
  for (const o of officers) {
    for (const k of Object.keys(o.lines)) if (!o.domains.includes(k)) mismatch.push(`${o.id}.${k} unlisted`);
    for (const d of o.domains) if (!o.lines[d]) mismatch.push(`${o.id}.${d} has no lines`);
  }
  check('declared domains and authored lines agree', mismatch.length === 0, mismatch.join(', '));
}

console.log('\n— An advisor only reads what the player can read');
{
  const base = seed();
  const hidden: GameState = {
    ...base, knownPrices: {},
    scarcity: { ...base.scarcity, london: { ...(base.scarcity.london ?? {}), cloth: 4.0 } },
  };
  check('a true spread at an unreported city is not quoted',
    adviceFor(hidden).filter(a => a.kind === 'trade').every(t => !t.body.includes('London')));
  const reported: GameState = {
    ...hidden,
    knownPrices: {
      london: { cityId: 'london', trueAsOfWeek: 0, receivedOnWeek: 0, prices: { cloth: 180 } },
      bruges: { cityId: 'bruges', trueAsOfWeek: 0, receivedOnWeek: 0, prices: { cloth: 24 } },
    },
  };
  const tip = adviceFor(reported).find(a => a.kind === 'trade');
  check('once a report arrives it is quoted at the reported price', !!tip && tip.body.includes('180'), tip?.body);
}

console.log('\n— Marian dies, and cannot be saved');
{
  const ev = findEvent('ev_c2_024')!;
  check('both choices depart her', ev.choices.every(c => c.effects.characterDeparts === 'marian'));
  check('both pin the same parentage evidence',
    ev.choices.every(c => c.effects.evidence?.id === 'par_charetty_indenture'));
  check('on a relative clock, not a calendar date', !!ev.trigger.weeksAfterFlag && !ev.trigger.dateAfter);
  check("Chapter 2's finale gate is untouched",
    JSON.stringify(findEvent('ev_c2_022')!.trigger.flags) === JSON.stringify(['trebizond_extraction_resolved', 'trebizond_epilogue']));
  check("both branches of Godscalc's death pin his letter",
    findEvent('ev_c6_003')!.choices.every(c => c.effects.evidence?.id === 'par_godscalc_letter'));
  const guaranteed = EVENTS.filter(e => e.choices.length > 0 && e.choices.every(c => c.effects.evidence?.track === 'parentage'));
  check('at least two parentage pieces sit on unavoidable events', guaranteed.length >= 2, guaranteed.map(e => e.id).join(', '));

  let s: GameState = { ...seed(), firedEvents: EVENTS.filter(e => e.chapter <= 1).map(e => e.id) };
  s = { ...s, flags: { ...s.flags, chapter1_complete: true, chapter2_started: true, reached_trebizond: true } };
  const ill = tick(s, 1, { ev_c2_023: 0 });
  check('the illness letter arrives and she is still alive', !!ill.flags.marian_failing && marian(ill).status === 'active');
  check('she does not die before six weeks are up', !tick(ill, 4).flags.marian_lost);
  const dead = tick(ill, 8, { ev_c2_024: 1 });
  check('she dies even on the ungenerous branch', marian(dead).status === 'departed' && !!dead.flags.marian_lost);
  check('the indenture is on the board regardless', (dead.evidence ?? []).some(e => e.id === 'par_charetty_indenture'));
  const obj = objectivesForChapter(dead, 2).find(o => o.objective.id === 'obj_c2_marian');
  check('her loss reads as an inevitable, resolved objective', !!obj?.objective.inevitable && obj?.status === 'complete');
}

console.log('\n— The house keeps a voice after its officers are gone');
{
  const broke: GameState = { ...seed(), cash: 1 };
  check('Marian gives the wage counsel while she lives',
    adviceFor(broke).find(a => a.kind === 'household_wages')?.officerId === 'marian');
  const after: GameState = {
    ...broke, characters: broke.characters.map(c => (c.id === 'marian' ? { ...c, status: 'departed' as const } : c)),
  };
  check("it survives her, in Gregorio's voice",
    adviceFor(after).find(a => a.kind === 'household_wages')?.officerId === 'gregorio');
  check('Marian is entirely silent', adviceFor(after).every(a => a.officerId !== 'marian'));
  const withPrices = (g: GameState): GameState => ({
    ...g, knownPrices: {
      london: { cityId: 'london', trueAsOfWeek: 0, receivedOnWeek: 0, prices: { cloth: 90 } },
      bruges: { cityId: 'bruges', trueAsOfWeek: 0, receivedOnWeek: 0, prices: { cloth: 24 } },
    },
  });
  check('the trade tip survives her too',
    adviceFor(withPrices(after)).find(a => a.kind === 'trade')?.officerId === 'gregorio');
  const bothGone: GameState = {
    ...after, cash: 800,
    characters: after.characters.map(c => (c.id === 'gregorio' ? { ...c, status: 'departed' as const } : c)),
  };
  check('with both gone that counsel is dropped, not crashed',
    adviceFor(bothGone).every(a => a.kind !== 'household_wages' && a.kind !== 'trade'));
  check('the rest of the household still speaks', adviceFor(bothGone).length > 0);
  check('and Julius inherits the chapter nudge',
    adviceFor(bothGone).find(a => a.kind === 'chapter')?.officerId === 'julius');
}

console.log('\n— The Vatachino unmasking is read downstream');
{
  const base = seed();
  const withGelis: GameState = {
    ...base, characters: base.characters.map(c => (c.id === 'gelis' ? { ...c, status: 'active' as const } : c)),
  };
  check('nothing while masked', adviceFor(withGelis).every(a => a.kind !== 'houses_unmasked'));
  const named: GameState = { ...withGelis, flags: { ...withGelis.flags, vatachino_unmasked: true } };
  const said = adviceFor(named).find(a => a.kind === 'houses_unmasked');
  check('Gelis says so once named', !!said && said.body.includes('Vatachino'), said?.body);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
