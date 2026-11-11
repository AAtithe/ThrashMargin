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

const T = new Date(new Date().setHours(12, 0, 0, 0)).getTime(); // noon today, so nothing crosses midnight
// --- The Reset ---------------------------------------------------------------------------------------
// Played as often as a hard day needs. It must end in a move, never take points away, never touch the
// streak, and never reward reaching for it: a move scores 5 when ticked, and only three a day score.
{
  const l = fresh();
  const keys = l.LOUD.map((x: { k: string }) => x.k);
  ok(keys.length >= 6, 'reset: at least six things can be loud');
  for (const k of keys) {
    ok((l.MOVES[k] || []).length >= 3, `reset: ${k} offers at least three moves`);
    ok(l.FIX[k] && l.FIX[k].text && ['Start', 'Stop', 'Keep'].includes(l.FIX[k].type), `reset: ${k} has a system fix for the Friday review`);
    ok(l.PRESSURE.filter((c: { k: string }) => c.k === k).length >= 3, `reset: ${k} has at least three pressure calls`);
  }
  ok(l.MOVES.not.length >= 3, 'reset: "not mine" has its own moves');
  ok(l.SORT.length === 3, 'reset: three ways to sort it');
  ok(new Set(l.PRESSURE.map((c: { id: string }) => c.id)).size === l.PRESSURE.length, 'reset: pressure call ids are unique');
  for (const c of l.PRESSURE) {
    ok(c.opts.length === 3 && c.opts.filter((o: { v: string }) => o.v === 'best').length === 1, `reset: ${c.id} has three options and one world-class call`);
    ok(c.coach.length >= 1 && keys.includes(c.k), `reset: ${c.id} has coaching and a known loud key`);
  }
  const text = JSON.stringify([l.LOUD, l.SORT, l.MOVES, l.FIX, l.PRESSURE, l.receiptFor(0)]);
  ok(!/[—–]/.test(text), 'reset: no em or en dashes in the copy');
  ok(l.state.resets.length === 0 && l.resetsToday() === 0, 'reset: a new ledger has none');
  ok(typeof l.receiptFor(0) === 'string' && l.receiptFor(0).length > 20, 'reset: a new ledger still gets an honest receipt');
}
{
  const l = fresh();
  for (let i = 3; i >= 0; i--) l.state.reviews.push({ ts: NOW - i * 7 * DAY, happiness: 6, earnings: 6, time: 6, focus: 6, hours: 50 });
  const before = l.points();
  const streakBefore = l.streak();
  const entries = [];
  for (let i = 0; i < 5; i++) entries.push(l.finishReset({ loud: 'cash', sort: 'decide', move: 'move ' + i, ts: T - 60_000 * (5 - i) }));
  ok(l.points() === before, 'reset: logging resets scores nothing and takes nothing away');
  ok(l.streak() === streakBefore, 'reset: resets never touch the streak');
  ok(l.resetsToday(T) === 5, `reset: five today (got ${l.resetsToday(T)})`);
  ok(l.state.todos.filter((t: { source: string }) => t.source && t.source.startsWith('reset-')).length === 5, 'reset: each move goes on the list');
  ok(entries.every((e: { todo: string }) => l.state.todos.some((t: { id: string }) => t.id === e.todo)), 'reset: each entry points at its move');
  for (const t of l.state.todos) { t.done = true; t.doneAt = T; }
  ok(l.points() === before + 3 * l.RESET_PTS, `reset: five moves done in one day score three times ${l.RESET_PTS} (got ${l.points() - before})`);
  const y = l.finishReset({ loud: 'load', sort: 'influence', move: 'yesterday', ts: T - DAY });
  const yt = l.state.todos.find((t: { id: string }) => t.id === y.todo);
  yt.done = true; yt.doneAt = T - DAY;
  ok(l.points() === before + 4 * l.RESET_PTS, 'reset: the three-a-day limit is per day');
  // Pointing at an action already on the list adds nothing new and scores it as normal.
  const a = fresh();
  const stop = a.addTodo({ text: 'cancel the meeting', type: 'Stop', h: 'week' });
  const e = a.finishReset({ loud: 'load', sort: 'decide', todoId: stop.id, ts: T });
  ok(a.state.todos.length === 1 && e.todo === stop.id && e.move === 'cancel the meeting', 'reset: an existing action can be the move');
  stop.done = true; stop.doneAt = T;
  ok(a.points() === 20, 'reset: an existing Stop picked as the move still scores 20');
  // Receipts come from the ledger itself, and rotate.
  const r = fresh();
  const d = r.addTodo({ text: 'x', type: 'Stop', h: 'week', hours: 3 }); d.done = true; d.doneAt = T - 7 * DAY;
  r.state.notes.push({ ts: T, kind: 'good', text: 'Someone solved it without me' });
  const rc = r.receipts();
  ok(rc.some((s: string) => s.includes('1 action')), 'receipts: counts actions done');
  ok(rc.some((s: string) => s.includes('was a Stop')), 'receipts: names the Stops');
  ok(rc.some((s: string) => s.includes('3.0 hours a week')), 'receipts: hours bought back');
  ok(rc.some((s: string) => s.includes('Someone solved it without me')), 'receipts: quotes a logged good thing');
  ok(rc.some((s: string) => s.startsWith('Once so far, someone solved it')), 'receipts: notices the firm working without you');
  ok(!rc.some((s: string) => /closed .* week/.test(s)), 'receipts: never claims a week that was not closed');
  ok(r.receiptFor(0) !== r.receiptFor(1), 'receipts: consecutive resets see different receipts');
  // The pressure call follows what is loud.
  ok(r.pressureFor('person').k === 'person', 'reset: the pressure call matches what is loud');
}
{
  // The Friday review reads the week's pattern.
  const l = fresh();
  for (let i = 0; i < 3; i++) l.finishReset({ loud: 'cash', sort: 'decide', move: 'c' + i, ts: T - i * DAY });
  l.finishReset({ loud: 'person', sort: 'not', move: 'p', ts: T });
  l.finishReset({ loud: 'cash', sort: 'decide', move: 'old', ts: T - 9 * DAY });
  const lw = l.loudWeek(T);
  ok(lw.count === 4, `loud week: only the last seven days (got ${lw.count})`);
  ok(lw.signals.length === 1 && lw.signals[0].k === 'cash' && lw.signals[0].days === 3, 'loud week: cash on three days is a signal');
  ok(lw.sorts.decide === 3 && lw.sorts.not === 1, 'loud week: sorted counts');
  ok(lw.moves === 4 && lw.movesDone === 0, 'loud week: moves and how many were done');
  ok(lw.capDays === 0, 'loud week: no day hit the cap');
  const c = fresh();
  for (let i = 0; i < c.RESET_CAP; i++) c.finishReset({ loud: 'heavy', sort: 'not', move: 'm' + i, ts: T - i * 60_000 });
  ok(c.resetsToday(T) === c.RESET_CAP && c.loudWeek(T).capDays === 1, 'loud week: a day at the cap is reported');
  // An older v2 save without resets loads with an empty list.
  const old = JSON.parse(JSON.stringify(fresh().state)); delete old.resets;
  ok(Array.isArray(createLedger(old).state.resets), 'migrate: a save from before the Reset loads with no resets');
}

// --- Daily system calls ----------------------------------------------------------------------------
// One a day, operations and sales alternating; answering scores nothing; a call missed comes back round.
{
  const l = fresh();
  for (const t of ['ops', 'sales']) ok(l.SYSTEM.filter((c: { theme: string }) => c.theme === t).length >= 12, `system: at least twelve ${t} calls`);
  ok(new Set(l.SYSTEM.map((c: { id: string }) => c.id)).size === l.SYSTEM.length, 'system: ids are unique');
  for (const c of l.SYSTEM) {
    ok(c.opts.length === 3 && c.opts.filter((o: { v: string }) => o.v === 'best').length === 1, `system: ${c.id} has three options and one world-class call`);
    ok(c.todo && c.todo.text && ['Start', 'Stop', 'Keep'].includes(c.todo.type), `system: ${c.id} offers a real action`);
  }
  ok(!/[—–]/.test(JSON.stringify([l.SYSTEM, l.OFF, l.FEARS, l.OUTCOMES])), 'system: no em or en dashes in the copy');
  const day0 = T, day1 = T + DAY;
  const a = l.sysToday(day0), b = l.sysToday(day1);
  ok(a.call && b.call && a.call.theme !== b.call.theme, 'system: themes alternate by day');
  ok(a.played === null, 'system: today starts unplayed');
  const worst = a.call.opts.findIndex((o: { v: string }) => o.v === 'trap');
  ok(l.playSys(a.call.id, worst, day0) === true, 'system: first call of the day plays');
  ok(l.playSys(a.call.id, 0, day0 + 60_000) === false, 'system: only one a day');
  ok(l.sysToday(day0).played && l.sysToday(day0).call.id === a.call.id, 'system: today shows the call already played');
  ok(l.points() === 0, 'system: answering scores nothing');
  ok(l.sysMastered().size === 0, 'system: a trap is not mastery');
  // Play the rest of that theme on its days; the missed one comes back once the unplayed ones run out.
  const theme = a.call.theme; let d = day0; const seen: string[] = [a.call.id];
  for (let i = 0; i < 60; i++) {
    d += DAY; const t = l.sysToday(d); if (!t.call || t.call.theme !== theme) continue;
    if (t.call.id === a.call.id) break;
    seen.push(t.call.id); l.playSys(t.call.id, t.call.opts.findIndex((o: { v: string }) => o.v === 'best'), d);
  }
  ok(seen.length === l.SYSTEM.filter((c: { theme: string }) => c.theme === theme).length, `system: every ${theme} call dealt before a repeat (dealt ${seen.length})`);
  ok(l.sysToday(d).call.id === a.call.id, 'system: the missed call comes back round');
  ok(l.sysProgress().find((x: { theme: string }) => x.theme === theme).done === seen.length - 1, 'system: progress counts world-class calls');
  ok(l.sysRhythm(d) >= 1 && l.sysRhythm(d) <= 7, 'system: rhythm counts days in the last seven');
}

// --- Phone-off day ------------------------------------------------------------------------------------
{
  const l = fresh();
  const plan = l.planOff({ day: T + DAY, decider: 'My managing director', route: 'call my second in command, who can reach me', threshold: ['staff safety', 'a client about to leave'], ts: T });
  ok(l.offCurrent() === plan, 'off: planned day is current');
  ok(l.state.todos.some((t: { source: string }) => t.source === 'off-brief-' + plan.id), 'off: the brief goes on the list');
  const brief = l.offBrief(plan);
  ok(brief.includes('My managing director decides') && brief.includes('staff safety or a client about to leave'), 'off: the brief names who decides and the emergencies');
  ok(!/[—–]/.test(brief), 'off: no dashes in the brief');
  ok(l.points() === 0, 'off: planning scores nothing');
  l.logOff({ waited: ['A client question', 'An approval', 'A deadline'], handled: ['A team question'], broke: ['A sales enquiry'] });
  ok(l.offCurrent() === null && l.state.offDays[0].status === 'back', 'off: logging closes the day');
  ok(l.points() === l.OFF_PTS + 10 + 3, `off: a logged day scores ${l.OFF_PTS}, plus the brief done and one noticed thing (got ${l.points()})`);
  ok(l.state.notes.some((n: { text: string }) => n.text === 'Handled without me: A team question'), 'off: handled items go in the notice log');
  ok(l.state.todos.some((t: { text: string; done: boolean }) => t.text.startsWith('Design out: A sales enquiry') && !t.done), 'off: stalled items become fixes');
  const tot = l.offTotals();
  ok(tot.days === 1 && tot.waited === 3 && tot.handled === 1 && tot.broke === 1, 'off: totals');
  ok(l.receipts().some((r: string) => r.includes('3 things waited fine')), 'off: waited-fine is a receipt');
  ok(l.receipts().some((r: string) => r.startsWith('Once so far, someone solved it')), 'off: handled-without-me feeds the receipts');
  // A second day in the same week does not score again; the next week does.
  const before = l.points();
  const p2 = l.planOff({ day: T + 2 * DAY }); l.state.todos = l.state.todos.filter((t: { source: string }) => t.source !== 'off-brief-' + p2.id);
  l.logOff({ waited: ['A deadline'] });
  const sameWeek = Math.floor(((T + DAY) / DAY + 3) / 7) === Math.floor(((T + 2 * DAY) / DAY + 3) / 7);
  ok(l.points() - before === (sameWeek ? 0 : l.OFF_PTS), `off: one phone-off day a week scores (same week ${sameWeek}, got ${l.points() - before})`);
  ok(l.offRecent(T + 3 * DAY) >= 1, 'off: weeks with a phone-off day are counted');
  // Logging without a plan still works.
  const u = fresh(); u.logOff({ waited: ['An approval'] }, T);
  ok(u.offTotals().days === 1, 'off: a day can be logged without planning it first');
}

// --- Fear and reality --------------------------------------------------------------------------------
{
  const l = fresh();
  l.state.reviews.push({ ts: T - 14 * DAY, fear: 'Cash running short', fearOutcome: 'never' });
  l.state.reviews.push({ ts: T - 7 * DAY, fear: 'Losing a big client', fearOutcome: 'worse' });
  l.state.reviews.push({ ts: T, fear: 'Nothing this week' });
  const g = l.fearGap();
  ok(g.logged === 2 && g.better === 1 && g.worse === 1, 'fear: counts named fears and how they turned out');
  ok(l.receipts().some((r: string) => r.includes('1 turned out better')), 'fear: the gap is a receipt');
  ok(l.FEARS.includes('Nothing this week') && l.OUTCOMES.length === 4, 'fear: options');
  const old = JSON.parse(JSON.stringify(fresh().state)); delete old.offDays; delete old.sysLog;
  const m = createLedger(old);
  ok(Array.isArray(m.state.offDays) && Array.isArray(m.state.sysLog), 'migrate: older saves load with no phone-off days or system calls');
}

console.log(`\n${passed + failures.length} assertions, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error('  FAIL ' + f);
  process.exit(1);
}
