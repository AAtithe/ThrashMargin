/**
 * The Founder's Ledger's rules, checked without a page: scoring, streaks, levels, hours bought back,
 * the practice round and the letter checks. `npm run drive --workspace=packages/founders-ledger`,
 * and part of `npm run check`.
 *
 * Every number here is something the player is told on screen ("Stop scores 20", "the streak breaks
 * after ten days"), so a change that moves one should fail here first.
 */
import { createLedger } from '../src/ledger/engine.js';

const DAY = 86_400_000;
let passed = 0;
const failures: string[] = [];
function ok(cond: unknown, msg: string) {
  if (cond) passed++;
  else failures.push(msg);
}

const NOW = Date.now();
const fresh = () => createLedger(null);

// --- A new ledger ----------------------------------------------------------------------------------
{
  const l = fresh();
  ok(l.state.v === 2, 'new: shape version 2');
  ok(l.points() === 0, 'new: no points');
  ok(l.streak() === 0, 'new: no streak');
  ok(l.levels().L[l.levels().cur].name === 'Operator', 'new: starts at Operator');
  ok(l.reviewDue() === true, 'new: a review is due');
  ok(l.ceoIndex() === null, 'new: no index before an opening position');
  ok(l.FOUNDING.length === 10 && l.LETTER_Q.length === 11, 'content: ten founding calls, eleven letter questions');
  for (const c of [...l.FOUNDING, ...l.BANK]) {
    ok(c.opts.length === 3 && c.opts.filter((o: { v: string }) => o.v === 'best').length === 1, `content: ${c.id} has three options and one world-class call`);
    ok(c.todo && c.todo.text && ['Start', 'Stop', 'Keep'].includes(c.todo.type), `content: ${c.id} puts a real action on the list`);
  }
  for (const q of l.LETTER_Q) ok((l.LETTER_PICKS[q.id] || []).length >= 3, `tap-first: letter question ${q.id} offers at least three lines to pick`);
  for (const k of ['hours', 'oneThing', 'protect', 'good', 'space', 'inSystem', 'change', 'decline', 'score']) ok(l.PICK[k].length >= 3, `tap-first: ${k} offers at least three answers`);
  for (const k of Object.keys(l.state.future.pillars)) ok((l.PICK.pillars[k] || []).length >= 3, `tap-first: pillar ${k} offers at least three answers`);
  const text = JSON.stringify([l.FOUNDING, l.BANK, l.WILD, l.LETTER_Q, l.GAMES, l.PICK, l.LETTER_PICKS]);
  ok(!/[—–]/.test(text), 'content: no em or en dashes in the coaching copy');
}

// --- Points come only from doing --------------------------------------------------------------------
{
  const l = fresh();
  l.addTodo({ text: 'a', type: 'Start', h: 'week' });
  l.addTodo({ text: 'b', type: 'Stop', h: 'week' });
  l.addTodo({ text: 'c', type: 'Keep', h: 'week' });
  l.addTodo({ text: 'd', type: 'Start', h: 'week', source: 'w4day' });
  ok(l.points() === 0, 'points: actions on the list score nothing until done');
  for (const t of l.state.todos) { t.done = true; t.doneAt = NOW; }
  ok(l.points() === 10 + 20 + 5 + 10 + 20, `points: Start 10, Stop 20, Keep 5, wildcard +20 (got ${l.points()})`);
  // Answering calls scores nothing.
  const a = fresh();
  for (const c of a.FOUNDING) a.state.answers[c.id] = c.opts.findIndex((o: { v: string }) => o.v === 'best');
  ok(a.points() === 0, 'points: ten world-class answers score nothing');
  ok(a.practice().judgement === 100 && a.practice().best.length === 10, 'practice: ten world-class answers is a judgement score of 100');
}

// --- Friday reviews and the streak ------------------------------------------------------------------
{
  const l = fresh();
  const review = (daysAgo: number, extra: Record<string, unknown> = {}) =>
    l.state.reviews.push({ ts: NOW - daysAgo * DAY, happiness: 6, earnings: 6, time: 6, focus: 6, hours: 50, ...extra });
  review(21); review(14); review(7); review(0);
  ok(l.streak() === 4, `streak: four weekly reviews (got ${l.streak()})`);
  ok(l.points() === 15 + 20 + 25 + 30, `points: 15 a review plus 5 per week of streak (got ${l.points()})`);
  ok(l.reviewDue() === false, 'review: not due the day after one');
  const gap = fresh();
  gap.state.reviews.push({ ts: NOW - 30 * DAY }, { ts: NOW - 11 * DAY });
  ok(gap.streak() === 0, 'streak: broken when the last review is more than ten days old');
  const capped = fresh();
  for (let i = 12; i >= 0; i--) capped.state.reviews.push({ ts: NOW - i * 7 * DAY });
  ok(capped.streak() === 13, 'streak: thirteen weeks running');
  const perReview = capped.points() - capped.state.reviews.slice(0, -1).reduce((p: number, _r: unknown, i: number) => p + 15 + Math.min(5 * i, 25), 0);
  ok(perReview === 40, `points: the streak bonus stops at 25 (last review scored ${perReview})`);
}

// --- Notice log: three a week score ------------------------------------------------------------------
{
  const l = fresh();
  for (let i = 0; i < 6; i++) l.state.notes.push({ ts: NOW, kind: 'good', text: String(i) });
  ok(l.points() === 9, `notice: only three a week score, 3 points each (got ${l.points()})`);
}

// --- Hours bought back ---------------------------------------------------------------------------------
{
  const l = fresh();
  l.addTodo({ text: 'meetings', type: 'Stop', h: 'week', hours: 5 });
  l.state.todos[0].done = true;
  l.state.todos[0].doneAt = NOW - 2 * 7 * DAY;
  const bb = l.boughtBack();
  ok(bb.perWeek === 5, 'hours: five hours a week once done');
  ok(Math.abs(bb.total - 10) < 0.01, `hours: two weeks banks ten hours (got ${bb.total})`);
  ok(Math.abs(bb.value - 2000) < 1, `hours: valued at the hourly rate, 200 by default (got ${bb.value})`);
}

// --- Levels follow behaviour ---------------------------------------------------------------------------
{
  const l = fresh();
  for (let i = 3; i >= 0; i--) l.state.reviews.push({ ts: NOW - i * 7 * DAY, focus: 6, hours: 50 });
  for (const type of ['Stop', 'Stop', 'Start', 'Start', 'Start']) {
    const t = l.addTodo({ text: type, type, h: 'week' });
    t.done = true; t.doneAt = NOW;
  }
  ok(l.levels().L[l.levels().cur].name === 'Leader', 'levels: four reviews, five actions, two Stops is Leader');
  l.state.reviews.shift();
  l.state.reviews[0].ts = NOW - 40 * DAY;
  ok(l.levels().L[l.levels().cur].name === 'Operator', 'levels: a broken streak drops the level');
}

// --- Migration from the first version --------------------------------------------------------------------
{
  const v1 = {
    audit: { happiness: 6, earnings: 5, time: 3, focus: 4, hours: 62, protect: '', oneThing: 'x' }, auditDone: true,
    answers: { inbox: 2 }, todos: [{ id: 'a', text: 'grid', type: 'Start', h: 'week', done: true, source: 'inbox' }],
    reviews: [], wild: { drawn: [], kept: ['wcfo'], redraws: 2 }, updatedAt: 5,
  };
  const l = createLedger(v1);
  ok(l.state.v === 2 && l.state.baseline.time === 3, 'migrate: opening position kept');
  ok(l.state.todos[0].hours === 3 && l.state.todos[0].doneAt > 0, 'migrate: actions get their hours and a done date');
  ok(l.state.wildLog.some((w: { id: string }) => w.id === 'wcfo'), 'migrate: kept wildcards recorded');
  const again = createLedger(JSON.parse(JSON.stringify(l.state)));
  ok(JSON.stringify(again.state) === JSON.stringify(l.state), 'migrate: a v2 ledger loads unchanged');
}

// --- Letter checks -----------------------------------------------------------------------------------
{
  const l = fresh();
  const vague = l.letterChecks('Dear Tom, I will be happy and I hope the firm will grow.');
  ok(vague.every((c: { ok: boolean }) => !c.ok), 'letter: a short, vague letter fails every check');
  const words = Array(260).fill('detail').join(' ');
  const good = l.letterChecks(
    `Dear Tom, I train four mornings a week. My family and friends come first. I earn £400k. The firm has 150 clients and 30 staff. I read and learn every week. We sailed on holiday. I have not reviewed a month end since 2027. ${words}`,
  );
  ok(good.every((c: { ok: boolean }) => c.ok), `letter: a specific, whole-life letter passes (failed: ${good.filter((c: { ok: boolean }) => !c.ok).map((c: { label: string }) => c.label).join(', ')})`);
}

console.log(`\n${passed + failures.length} assertions, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error('  FAIL ' + f);
  process.exit(1);
}
