/**
 * The after-action review (fireline-round7-review.md): the harness sections. Imported by drive.ts,
 * so its assertions count in the main totals.
 *
 * What is proved here: every new battle records a history and an old save never gains one; the
 * samples come every 30 seconds and match the battle recomputed independently at each sample;
 * recording never changes play (the same battles with and without it, compared whole); the history
 * replays exactly and does not depend on how the ticks are batched; each turning-point rule fires on
 * a history built to trip it and stays quiet on one built just short of it; and the history stays
 * small on a long battle on a huge map.
 *
 *   npm run drive -- --deep    also plays an Epic battle (huge map, four sides) to 85 minutes and
 *                              measures its history (about five minutes on one core)
 */
import { MISSIONS } from '../src/campaign/missions';
import { missionContext, newCampaign } from '../src/campaign/progression';
import { buildPlanetBattle } from '../src/planet/battle';
import { processAction } from '../src/sim/actions';
import {
  HISTORY_CATS,
  HISTORY_FIELDS,
  HISTORY_SAMPLE_TICKS,
  appendSample,
  decodeHistory,
  decodeInts,
  encodeInt,
  historyBytes,
  historyEvents,
  newHistory,
  pushEvent,
  sampleRows,
  type DecodedHistory,
  type HistoryEvent,
  type SideSeries,
} from '../src/sim/history';
import { FLOAT_CREDITS, MAX_FINDINGS, clockOf, plural, reviewLines, reviewOf, turningPoints, type ReviewContext } from '../src/sim/review';
import { BUILDINGS, DERRICK_INCOME, DERRICK_TICKS, TICKS_PER_SECOND, UNITS, type Owner, type SkirmishSetup } from '../src/sim/rules';
import { createMissionState } from '../src/sim/mission';
import { buildingSpecOf, unitSpecOf } from '../src/sim/specs';
import { createInitialState, migrateState, powerOf } from '../src/sim/state';
import type { GameState } from '../src/sim/types';
import { craftSetup } from './drive-planet-battle';

type Ok = (cond: unknown, what: string) => void;

const DEEP = process.argv.includes('--deep');
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
/** A state as JSON without its history: what play is. */
const play = (s: GameState): string => JSON.stringify(s, (k, v) => (k === 'history' ? undefined : v));
const tickBy = (s: GameState, n: number): GameState => processAction(s, { type: 'tick', n });
const minute = 60 * TICKS_PER_SECOND;

function skirmish(seed: string, setup?: Partial<SkirmishSetup>, autopilot = true): GameState {
  return createInitialState(`rv-${seed}`, seed, { seed, createdAt: 0, autopilot, ...(setup ? { setup } : {}) });
}

// ---- History on new battles, none on old saves ------------------------------------------------

function presence(ok: Ok): void {
  const plain = skirmish('presence');
  ok(!!plain.history && plain.history.n === 0 && plain.history.ev === '' && plain.history.s.length === 2, 'a new battle (no setup) starts an empty history');
  const four = skirmish('presence-4', { map: 'plains', sides: 4, mode: 'ffa' });
  ok(four.history?.s.length === 4 && four.history.acc.length === 4, 'a battle of four sides records four');
  const spec = MISSIONS[0];
  const c = newCampaign('Tester');
  const m = createMissionState(spec, missionContext(c, spec, 'rv-mission', 0));
  ok(!!m.history && m.history.s.length === m.players.length, 'a new mission records a history');
  const pb = buildPlanetBattle(craftSetup(3), { id: 'rv-planet', name: 'Planet', createdAt: 0 });
  ok(!!pb.history && pb.history.s.length === pb.players.length && !!pb.planet, 'a new planet battle records a history');
  // Planet battles start with structures and upgrades laid out: none of it is an event.
  const pt = tickBy(pb, 1);
  ok(pt.history!.ev === '', 'a planet battle opens with no events: its starting layout is not "built"');
  const mt = tickBy(m, 1);
  ok(mt.history!.ev === '' && !!mt.history!.seen, 'a mission opens with no events, and has taken its first look');

  // An old save: no history, and it never gains one. It plays exactly as the same battle recorded.
  let s = tickBy(skirmish('old-save', { map: 'plains' }), 900);
  const old = copy(s);
  delete old.history;
  const m2 = migrateState(old)!;
  ok(m2 && m2.history === undefined, 'a save from before the review loads with no history');
  let a = m2;
  let b = s;
  for (let i = 0; i < 6; i++) {
    a = tickBy(a, 300);
    b = tickBy(b, 300);
  }
  ok(a.history === undefined, 'and is not given one as it plays on');
  ok(play(a) === play(b), 'and plays on exactly as the same battle recording its history');
  ok(JSON.stringify(a) === JSON.stringify(copy(a)), 'an old save replays byte-identically through a save round trip');
  // A save with a history: kept whole by migration, and plays on byte-identically.
  const kept = migrateState(copy(s))!;
  ok(JSON.stringify(kept) === JSON.stringify(s), 'a save with a history migrates to itself');
  ok(JSON.stringify(tickBy(kept, 600)) === JSON.stringify(tickBy(s, 600)), 'and plays on byte-identically');
  // Junk is dropped, never trusted.
  for (const [junk, what] of [
    [{ v: 2 }, 'a newer version'],
    [{ ...copy(s.history!), s: 'x' }, 'series that are not lists'],
    [{ ...copy(s.history!), n: s.history!.n + 1 }, 'a sample count that does not match'],
    [{ ...copy(s.history!), s: s.history!.s.map(r => r.map(c => `${c}!`)) }, 'characters outside the alphabet'],
    [{ ...copy(s.history!), ev: 3 }, 'events that are not a string'],
    [{ ...copy(s.history!), acc: [[1]] }, 'tallies of the wrong shape'],
    ['history', 'a string'],
  ] as [unknown, string][]) {
    const j = migrateState({ ...copy(s), history: junk });
    ok(j !== null && j.history === undefined, `a junk history (${what}) is dropped and the battle still loads`);
  }
  const badSeen = migrateState({ ...copy(s), history: { ...copy(s.history!), seen: { up: 'x' } } });
  ok(badSeen?.history && badSeen.history.seen === undefined && badSeen.history.n === s.history!.n, 'a junk first look is dropped, the samples kept');
  s = tickBy(badSeen!, 300);
  ok(!!s.history?.seen && s.history.n === badSeen!.history!.n + 1, 'and is taken afresh on the next tick');
  // The input to a tick is never touched, history included.
  const before = JSON.stringify(s);
  tickBy(s, 300);
  ok(JSON.stringify(s) === before, 'a tick leaves its input, and its input history, untouched');
}

// ---- Encoding ----------------------------------------------------------------------------------

function encoding(ok: Ok): void {
  const values = [0, 1, 31, 32, 33, 1023, 1024, 99999, 3e6];
  const enc = values.map(encodeInt).join('');
  ok(JSON.stringify(decodeInts(enc)) === JSON.stringify(values), 'small integers round trip through the encoding');
  ok(encodeInt(5).length === 1 && encodeInt(500).length === 2 && encodeInt(20000).length === 3, 'one character below 32, two below 1024, three below 32,768');
  ok(decodeInts('W') === null && decodeInts('?') === null, 'an unfinished number or a stray character does not read');
  // Rows in, rows out, deltas and the packed losses included.
  const h = newHistory(2, 100);
  const rows: number[][][] = [];
  let seed = 7;
  const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  for (let i = 0; i < 40; i++) {
    const r = [0, 1].map(() => HISTORY_FIELDS.map((_, f) => (f >= 4 && f <= 13 ? (rnd(3) ? 0 : rnd(40)) : rnd(f === 16 ? 1001 : 5000))));
    rows.push(r);
    appendSample(h, r);
  }
  ok(JSON.stringify(sampleRows(h)) === JSON.stringify(rows), 'forty random samples read back exactly, field by field');
  pushEvent(h, 4321, 1, 'built', 'factory');
  pushEvent(h, 99, 0, 'losses', 'tank', 9, 'artillery', 12);
  pushEvent(h, 5000, 1, 'built', 'factory');
  const ev = historyEvents(h);
  ok(
    ev.length === 3 &&
      ev[0].tick === 4321 && ev[0].side === 1 && ev[0].kind === 'built' && ev[0].what === 'factory' &&
      ev[1].what === 'tank' && ev[1].n === 9 && ev[1].total === 12 && ev[1].by === 'artillery' &&
      h.dict.filter(w => w === 'factory').length === 1,
    'events read back, with each kind name stored once in the dictionary',
  );
  const d = decodeHistory(h)!;
  ok(d.events.map(e => e.tick).join() === '99,4321,5000', 'decoded events are in time order');
  ok(d.sides[0].credits[0] === rows[0][0][0] * 50 && d.sides[0].income[0] === rows[0][0][1] * 10, 'money reads back in credits: held in fifties, income in tens');
}

// ---- Cadence and values against independent recomputation ---------------------------------------

/** Ore control the slow way: every ore tile against every structure. */
function oreBrute(s: GameState): number[] {
  const mine = s.players.map(() => 0);
  let total = 0;
  for (let k = 0; k < s.ore.length; k++) {
    if (!(s.ore[k] > 0)) continue;
    total++;
    const x = (k % s.mapW) + 0.5;
    const y = Math.floor(k / s.mapW) + 0.5;
    let best = Infinity;
    let who = -1;
    for (const b of s.buildings) {
      const spec = BUILDINGS[b.kind];
      if (b.hp <= 0 || spec.wall) continue;
      const d2 = (x - (b.x + spec.w / 2)) ** 2 + (y - (b.y + spec.h / 2)) ** 2;
      if (d2 > 144) continue;
      if (d2 < best || (d2 === best && b.owner < who)) {
        best = d2;
        who = b.owner;
      }
    }
    if (who >= 0) mine[who]++;
  }
  return mine.map(m => (total ? Math.round((m * 1000) / total) : 0));
}

function cadence(ok: Ok): void {
  // Ticked one at a time, so every death and every Derrick payday is seen as it happens.
  let s = skirmish('cadence', { map: 'plains', sites: true, credits: 6000 });
  s = copy(s);
  // A Derrick held by each side from the start, so its income is in play at once.
  const derricks = s.sites!.filter(x => x.kind === 'derrick');
  ok(derricks.length >= 2, 'the cadence battle has Derricks to pay');
  derricks[0].owner = 0;
  derricks[1].owner = 1;
  s = migrateState(s)!;
  const n = s.players.length;
  const lost = s.players.map(() => HISTORY_CATS.map(() => 0));
  let harvested = s.players.map(p => p.stats.harvested);
  let derrickPay = s.players.map(() => 0);
  let samples = 0;
  let cadenceOk = true;
  let valuesOk = true;
  let lostOk = true;
  let incomeOk = true;
  let oreOk = true;
  const END = 18 * minute;
  while (s.tick < END && s.winner === null) {
    const prev = s;
    s = tickBy(s, 1);
    // Units that are gone died, unless they climbed into a carrier or a Base Truck became a Field
    // Yard; riders aboard a carrier that is gone died with it.
    const now = new Set(s.units.map(u => u.id));
    const aboard = new Set(s.units.flatMap(u => (u.carried ?? []).map(r => r.id)));
    const had = new Set(prev.buildings.map(b => b.id));
    const yards = s.buildings.filter(b => b.kind === 'fieldyard' && !had.has(b.id)).map(b => b.owner as number);
    for (const u of prev.units) {
      if (now.has(u.id) || aboard.has(u.id)) continue;
      const y = u.kind === 'basetruck' ? yards.indexOf(u.owner) : -1;
      if (y >= 0) {
        yards.splice(y, 1);
        continue;
      }
      for (const v of [u, ...(u.carried ?? [])]) lost[v.owner][HISTORY_CATS.indexOf(UNITS[v.kind].category)]++;
    }
    if (s.sites && s.tick % DERRICK_TICKS === 0) for (const x of s.sites) if (x.owner !== null && x.kind === 'derrick') derrickPay[x.owner] += DERRICK_INCOME;
    const h = s.history!;
    if (h.n !== Math.floor(s.tick / HISTORY_SAMPLE_TICKS)) cadenceOk = false;
    if (s.tick % HISTORY_SAMPLE_TICKS !== 0) continue;
    samples++;
    const d = decodeHistory(h)!;
    const i = h.n - 1;
    if (d.ticks[i] !== s.tick) cadenceOk = false;
    const ore = oreBrute(s);
    for (let o = 0; o < n; o++) {
      const side = d.sides[o];
      let army = 0;
      let structures = 0;
      for (const u of s.units) if (u.owner === o && u.kind !== 'hauler') army += unitSpecOf(s, u).cost;
      for (const b of s.buildings) if (b.owner === o) structures += buildingSpecOf(s, b).cost;
      const pw = powerOf(s, o as Owner);
      if (
        side.credits[i] !== Math.round(s.players[o].credits / 50) * 50 ||
        side.army[i] !== Math.round(army / 50) * 50 ||
        side.structures[i] !== Math.round(structures / 50) * 50 ||
        side.powerMade[i] !== pw.made ||
        side.powerUsed[i] !== pw.used
      )
        valuesOk = false;
      if (side.ore[i] !== ore[o]) oreOk = false;
      // Salvage needs a research this battle never reaches in eighteen minutes on Normal.
      const income = s.players[o].stats.harvested - harvested[o] + derrickPay[o];
      if (side.income[i] !== Math.round(income / 10) * 10) incomeOk = false;
      for (let c = 0; c < 4; c++) if (side.lost[c][i] !== lost[o][c]) lostOk = false;
    }
    harvested = s.players.map(p => p.stats.harvested);
    derrickPay = s.players.map(() => 0);
    for (const l of lost) l.fill(0);
  }
  ok(samples >= 30, `the cadence battle took ${samples} samples`);
  ok(cadenceOk, 'one sample every 30 seconds of game time, at exactly that tick, never more, never fewer');
  ok(valuesOk, 'credits, army value, structure value and power match the battle recomputed at every sample');
  ok(incomeOk, 'income matches harvested credits plus Derrick pay, recomputed tick by tick');
  ok(lostOk, 'units lost by category match the units that vanished, counted tick by tick');
  ok(oreOk, 'ore control matches a brute-force count of every ore tile against every structure');
  const d = decodeHistory(s.history!, s)!;
  const totalLost = d.sides.map(x => x.lost.reduce((a, c) => a + c.reduce((p, q) => p + q, 0), 0));
  const totalKilled = d.sides.map(x => x.killed.reduce((a, c) => a + c.reduce((p, q) => p + q, 0), 0));
  ok(totalLost.every(v => v > 0) && totalKilled.every(v => v > 0), 'both sides lost and killed things in the cadence battle');
  ok(totalKilled[0] <= totalLost[1] + 0 && totalKilled[1] <= totalLost[0], 'kills credited never exceed what the other side lost');
  // Events: research, first structures and Refineries, sites.
  const ev = d.events;
  ok(ev.some(e => e.kind === 'built' && e.what === 'refinery'), 'a Refinery built is an event');
  ok(['power', 'barracks'].every(k => ev.filter(e => e.side === 0 && e.kind === 'built' && e.what === k).length === 1), 'only the first of an ordinary kind is an event');
  const firstOf = (side: number, k: string) => s.buildings.filter(b => b.owner === side && b.kind === k).sort((a, b) => a.placedAt - b.placedAt)[0];
  const fac = firstOf(0, 'factory');
  if (fac) ok(ev.some(e => e.side === 0 && e.kind === 'built' && e.what === 'factory' && e.tick <= fac.placedAt), 'the first War Factory is dated by when it was placed');
  ok(ev.every((e, i) => i === 0 || e.tick >= ev[i - 1].tick), 'events read back in time order');
  const sitesN = s.sites?.length ?? 0;
  ok(s.players.every((_, o) => ev.filter(e => e.side === o && e.kind === 'site').length <= sitesN), "a side's captures are events only the first time it takes each site");
  ok(!ev.some(e => e.kind === 'site' && e.tick <= 1 && (e.side === 0 || e.side === 1) && e.what === 'derrick'), 'Derricks held from the start are not captures');
  // The battle so far adds a last sample at the tick now.
  const mid = tickBy(s, 37);
  const dm = decodeHistory(mid.history!, mid)!;
  ok(dm.ticks[dm.ticks.length - 1] === mid.tick && dm.ticks.length === mid.history!.n + 1, 'a review so far ends with a sample at the tick now');
}

// ---- Recording never changes play ----------------------------------------------------------------

function sameGame(ok: Ok): void {
  const setups: [string, Partial<SkirmishSetup> | undefined][] = [
    ['legacy', undefined],
    ['plains', { map: 'plains' }],
    ['islands', { map: 'random' }],
    ['sites', { map: 'random', sites: true }],
    ['three', { map: 'random', sides: 3, mode: 'ffa' }],
    ['four', { map: 'random', sides: 4, mode: 'teams' }],
    ['heroes', { map: 'random', heroes: true, generals: true }],
    ['lines', { map: 'random', research: 'lines', credits: 8000 }],
    ['coast', { map: 'random', tech: 'standard' }],
    ['rich', { map: 'random', ore: 'rich', credits: 10000, pace: 'long' }],
  ];
  let same = 0;
  // Seven minutes each: the opening, the first raids and the first research. The real-battle
  // section below plays battles to their winner with and without the history as well.
  for (const [tag, setup] of setups) {
    let a = skirmish(`same-${tag}`, setup);
    const plain = copy(a);
    delete plain.history;
    let b = migrateState(plain)!;
    const cap = 7 * minute;
    while (a.tick < cap && a.winner === null) {
      a = tickBy(a, 600);
      b = tickBy(b, 600);
    }
    ok(b.history === undefined && !!a.history && a.history.n > 0, `${tag}: one run recorded, the other did not`);
    const eq = play(a) === play(b);
    ok(eq, `${tag}: units, structures, credits and winner identical with and without the history`);
    ok(a.winner === b.winner && a.tick === b.tick, `${tag}: same winner at the same tick`);
    if (eq) same++;
  }
  ok(same === setups.length, `recording never changes play: ${same} of ${setups.length} battles identical`);
}

// ---- Replay -------------------------------------------------------------------------------------

function replay(ok: Ok): void {
  let a = skirmish('replay-rv', { map: 'random', sites: true });
  let b = skirmish('replay-rv', { map: 'random', sites: true });
  let c = skirmish('replay-rv', { map: 'random', sites: true });
  while (a.tick < 6000 && a.winner === null) {
    a = tickBy(a, 600);
    for (let i = 0; i < 4; i++) b = tickBy(b, 150);
  }
  while (c.tick < a.tick && c.winner === null) c = tickBy(c, Math.min(37, a.tick - c.tick));
  ok(JSON.stringify(a.history) === JSON.stringify(b.history), 'the same seed records the same history byte for byte');
  ok(JSON.stringify(a.history) === JSON.stringify(c.history), 'however the ticks are batched');
  const r1 = reviewOf(a);
  const r2 = reviewOf(copy(a));
  ok(!!r1 && JSON.stringify(r1) === JSON.stringify(r2), 'the review of a battle is the same read twice, and from a save round trip');
}

// ---- Turning points on constructed histories -----------------------------------------------------

const EVERY = HISTORY_SAMPLE_TICKS;

/** A level battle of `n` samples between two sides: every number the same on both. */
function level(n = 80, sides = 2): DecodedHistory {
  const series = (): SideSeries => ({
    credits: new Array(n).fill(800),
    income: new Array(n).fill(700),
    army: Array.from({ length: n }, (_, i) => Math.min(9000, 1000 + i * 300)),
    structures: Array.from({ length: n }, (_, i) => Math.min(15000, 5000 + i * 400)),
    lost: HISTORY_CATS.map(() => new Array(n).fill(1)),
    killed: HISTORY_CATS.map(() => new Array(n).fill(1)),
    powerMade: new Array(n).fill(200),
    powerUsed: new Array(n).fill(150),
    ore: new Array(n).fill(300),
  });
  return { every: EVERY, ticks: Array.from({ length: n }, (_, i) => (i + 1) * EVERY), sides: Array.from({ length: sides }, series), events: [] };
}
const ctx = (d: DecodedHistory, winner: number | null = null): ReviewContext => ({
  names: d.sides.map((_, o) => (o === 0 ? 'Meridian Corps' : ['', 'Ashen Combine', 'Verdant Front', 'Ochre Legion'][o])),
  teams: d.sides.map((_, o) => o),
  endTick: d.ticks[d.ticks.length - 1],
  winner,
});
const at = (min: number) => min * minute;
const idx = (min: number) => Math.round(at(min) / EVERY) - 1;
const ev = (tick: number, side: number, kind: HistoryEvent['kind'], what: string, extra: Partial<HistoryEvent> = {}): HistoryEvent => ({ tick, side: side as Owner, kind, what, ...extra });
const rules = (d: DecodedHistory, winner: number | null = null) => turningPoints(d, ctx(d, winner)).findings.map(f => f.rule);
const finding = (d: DecodedHistory, rule: string) => turningPoints(d, ctx(d)).findings.find(f => f.rule === rule);
function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object') {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}

function rulesTests(ok: Ok): void {
  const flat = level();
  const r0 = turningPoints(deepFreeze(flat), ctx(flat));
  ok(r0.findings.length === 0, `a level battle has no turning points (${r0.findings.map(f => f.rule).join()})`);
  ok(/led on army and structures from the start/.test(r0.headline), 'its headline says who led from the start');

  // Income: you fall a third behind from 22:00, after losing your second Refinery at 21:30.
  {
    const d = level();
    for (let i = idx(22); i < idx(28); i++) d.sides[0].income[i] = 300;
    d.events = [ev(at(12), 0, 'lost', 'refinery'), ev(at(21.5), 0, 'lost', 'refinery'), ev(at(27.5), 0, 'built', 'refinery')];
    const f = finding(d, 'income');
    ok(!!f && /second Refinery at 21:30/.test(f.text) && /6 minutes before you rebuilt/.test(f.text), `income: falls behind after the second Refinery, rebuilt 6 minutes later (${f?.text})`);
    ok(!!f && /behind Ashen Combine at 2[2-3]:/.test(f.text), 'income: dated when it fell behind, naming the enemy');
    ok(!!f && /turret beside every Refinery/.test(f.advice), 'income: advice on guarding Refineries');
    d.events = d.events.filter(e => e.kind !== 'built');
    ok(/never rebuilt it/.test(finding(d, 'income')?.text ?? ''), 'income: "never rebuilt" when no Refinery followed');
    const near = level();
    for (let i = idx(22); i < idx(28); i++) near.sides[0].income[i] = 600;
    ok(!rules(near).includes('income'), 'income: 15% behind is not a turning point');
    const brief = level();
    brief.sides[0].income[idx(22)] = 200;
    ok(!rules(brief).includes('income'), 'income: one poor sample is not a turning point');
    const always = level();
    for (let i = 0; i < 80; i++) always.sides[0].income[i] = 300;
    ok(!rules(always).includes('income'), 'income: behind from the very start never "fell" behind (the earned rule covers it)');
    ok(rules(always).includes('earned'), 'earned: out-earned over the battle is a finding');
  }

  // Army: 70% of the balance gone in a minute, nine tanks lost to artillery.
  {
    const d = level();
    for (let i = idx(31); i < 80; i++) d.sides[0].army[i] = 9000;
    for (let i = idx(32); i < 80; i++) d.sides[0].army[i] = 2500;
    d.events = [ev(at(32), 0, 'losses', 'tank', { n: 9, total: 9, by: 'artillery' })];
    const f = finding(d, 'army');
    ok(!!f && f.tone === 'bad' && /swung \d+ points to Ashen Combine between 3[01]:\d\d and 32:00/.test(f.text), `army: the swing, its size and when (${f?.text})`);
    ok(!!f && /you lost 9 Battle Tanks to Artillery/.test(f.text), 'army: the cause, from the heavy-loss event');
    ok(!!f && /out-ranges/.test(f.advice), 'army: advice that fits artillery');
    const small = level();
    for (let i = 0; i < 80; i++) for (const s of small.sides) s.army[i] = 600;
    small.sides[0].army[idx(10)] = 0;
    ok(!rules(small).includes('army'), 'army: a skirmish of a few riflemen is not a turning point');
    const mild = level();
    for (let i = idx(32); i < 80; i++) mild.sides[0].army[i] = 7000;
    ok(!rules(mild).includes('army'), 'army: a 7-point swing is not a turning point');
    const won = level();
    for (let i = idx(32); i < 80; i++) won.sides[1].army[i] = 2500;
    const g = finding(won, 'army');
    ok(!!g && g.tone === 'good' && /your way/.test(g.text), 'army: a swing your way is a good finding');
  }

  // Research: nothing from 12:00 to the end while the enemy finishes four.
  {
    const d = level();
    d.events = [
      ev(at(6), 0, 'built', 'researchlab'),
      ev(at(12), 0, 'research', 'plating'),
      ...[8, 14, 20, 26].map(m => ev(at(m), 1, 'research', 'engines')),
    ];
    const f = finding(d, 'research');
    ok(!!f && /researched nothing between 12:00 and now/.test(f.text) && /3 upgrades/.test(f.text), `research: the idle stretch and the enemy's count (${f?.text})`);
    d.events.push(...[18, 24].map(m => ev(at(m), 0, 'research', 'calibration')));
    ok(!rules(d).includes('research'), 'research: a lab kept busy is not a finding');
    const none = level();
    none.events = [8, 14, 20].map(m => ev(at(m), 1, 'research', 'engines'));
    ok(/never built a Research Lab/.test(finding(none, 'research')?.text ?? ''), 'research: no lab at all, against an enemy researching');
    const nobody = level();
    ok(!rules(nobody).includes('research'), 'research: nobody researching is not a finding');
  }

  // Tech: your Tech Centre seven minutes after theirs.
  {
    const d = level();
    d.events = [ev(at(6), 1, 'built', 'techcentre'), ev(at(13), 0, 'built', 'techcentre')];
    const f = finding(d, 'tech');
    ok(!!f && /Tech Centre went up 7 minutes after Ashen Combine's \(13:00 against 6:00\)/.test(f.text), `tech: seven minutes late (${f?.text})`);
    const close = level();
    close.events = [ev(at(6), 1, 'built', 'techcentre'), ev(at(8), 0, 'built', 'techcentre')];
    ok(!rules(close).includes('tech'), 'tech: two minutes behind is not a finding');
    const never = level();
    never.events = [ev(at(6), 1, 'built', 'helipad')];
    ok(!rules(never).includes('tech'), 'tech: a Helipad you chose not to build is a choice, not a finding');
    const nofactory = level();
    nofactory.events = [ev(at(5), 1, 'built', 'factory')];
    ok(/you never built one/.test(finding(nofactory, 'tech')?.text ?? ''), 'tech: no War Factory at all is a finding');
  }

  // Credits held, power, raids, commanders.
  {
    const d = level();
    for (let i = idx(14); i <= idx(16.5); i++) d.sides[0].credits[i] = FLOAT_CREDITS + 2000;
    const f = finding(d, 'float');
    ok(!!f && /from 14:00 to 16:30, peaking at 5,000/.test(f.text), `float: the stretch and the peak (${f?.text})`);
    const short = level();
    for (let i = idx(14); i <= idx(15); i++) short.sides[0].credits[i] = FLOAT_CREDITS + 2000;
    ok(!rules(short).includes('float'), 'float: a minute and a half of savings is not a finding');

    const p = level();
    for (let i = idx(20); i <= idx(21); i++) p.sides[0].powerUsed[i] = 300;
    ok(/from 20:00 to 21:00/.test(finding(p, 'power')?.text ?? ''), 'power: the stretch it ran short');
    const blip = level();
    blip.sides[0].powerUsed[idx(20)] = 300;
    ok(!rules(blip).includes('power'), 'power: one low sample is not a finding');

    const raid = level();
    raid.events = [ev(at(30), 0, 'lost', 'refinery'), ev(at(30.5), 0, 'lost', 'power'), ev(at(31.5), 0, 'lost', 'power')];
    ok(/3 structures between 30:00 and 31:30: a Refinery and 2 Generators/.test(finding(raid, 'raid')?.text ?? ''), 'raid: three structures in two minutes');
    const spread = level();
    spread.events = [ev(at(30), 0, 'lost', 'refinery'), ev(at(33), 0, 'lost', 'power'), ev(at(36), 0, 'lost', 'power')];
    ok(!rules(spread).includes('raid'), 'raid: three structures over six minutes is not a raid');
    const theirs = level();
    theirs.events = [ev(at(30), 1, 'lost', 'refinery'), ev(at(30.5), 1, 'lost', 'power'), ev(at(31), 1, 'lost', 'power')];
    ok(!rules(theirs).includes('raid'), 'raid: the enemy losing structures is not your raid');

    const gen = level();
    gen.events = [ev(at(18), 0, 'general', 'general')];
    ok(/General fell at 18:00/.test(finding(gen, 'commander')?.text ?? ''), 'commander: your General falling');
    const theirGen = level();
    theirGen.events = [ev(at(18), 1, 'general', 'general')];
    ok(!rules(theirGen).includes('commander'), "commander: the enemy's General is not yours");
  }

  // Allies are neither for nor against; the leading enemy is the one compared.
  {
    const d = level(80, 3);
    const c: ReviewContext = { ...ctx(d), teams: [0, 0, 1] };
    for (let i = idx(22); i < 80; i++) d.sides[1].income[i] = 5000;
    ok(!turningPoints(d, c).findings.some(f => f.rule === 'income'), 'an ally out-earning you is not your income falling behind');
    for (let i = idx(22); i < 80; i++) d.sides[2].income[i] = 5000;
    const f = turningPoints(d, c).findings.find(x => x.rule === 'income');
    ok(!!f && /behind Verdant Front/.test(f.text), 'the enemy named is the one leading on the measure');
  }

  // Everything at once: ordered by importance, at most six, the same every time, input untouched.
  {
    const d = level();
    for (let i = idx(22); i < idx(28); i++) d.sides[0].income[i] = 300;
    for (let i = idx(32); i < 80; i++) d.sides[0].army[i] = 500;
    for (let i = idx(14); i <= idx(17); i++) d.sides[0].credits[i] = 6000;
    for (let i = idx(20); i <= idx(22); i++) d.sides[0].powerUsed[i] = 300;
    d.events = [
      ev(at(6), 1, 'built', 'techcentre'),
      ev(at(14), 0, 'built', 'techcentre'),
      ev(at(18), 0, 'general', 'general'),
      ev(at(30), 0, 'lost', 'refinery'),
      ev(at(30.5), 0, 'lost', 'power'),
      ev(at(31), 0, 'lost', 'barracks'),
      ev(at(32), 0, 'losses', 'tank', { n: 9, total: 14, by: 'gunship' }),
    ];
    deepFreeze(d);
    const r = turningPoints(d, ctx(d, 1));
    ok(r.findings.length === MAX_FINDINGS, `at most ${MAX_FINDINGS} findings (${r.findings.length})`);
    ok(r.findings.every((f, i) => i === 0 || f.score <= r.findings[i - 1].score), 'most important first');
    ok(r.findings[0].rule === 'army', `the army collapse leads (${r.findings[0].rule})`);
    ok(/aircraft/.test(r.findings[0].advice), 'advice fits what killed the army (aircraft)');
    ok(JSON.stringify(turningPoints(d, ctx(d, 1))) === JSON.stringify(r), 'the same history reads the same every time');
    ok(/Ashen Combine won\.$/.test(r.headline), `the headline ends with the result (${r.headline})`);
    const text = [r.headline, ...r.findings.flatMap(f => [f.title, f.text, f.advice])].join(' ');
    ok(!/[–—]/.test(text), 'no en or em dashes in any line');
    const lines = reviewLines(r, 3, 160);
    ok(lines.length === 3 && lines.every(l => l.length <= 160) && JSON.stringify(lines).length < 600, `three journal lines, a few hundred bytes (${JSON.stringify(lines).length})`);
    // From the raw history the same as from its decoded form.
    const h = newHistory(2, EVERY);
    for (let i = 0; i < d.ticks.length; i++)
      appendSample(
        h,
        d.sides.map(x => [x.credits[i] / 50, x.income[i] / 10, x.army[i] / 50, x.structures[i] / 50, ...x.lost.map(c => c[i]), ...x.killed.map(c => c[i]), x.powerMade[i], x.powerUsed[i], x.ore[i]]),
      );
    for (const e of d.events) pushEvent(h, e.tick, e.side, e.kind, e.what, e.n, e.by, e.total);
    ok(JSON.stringify(turningPoints(h, ctx(d, 1))) === JSON.stringify(r), 'the stored history reads exactly as the series it was built from');
  }
  ok(plural('Rifleman', 4) === 'Riflemen' && plural('Raider Buggy', 2) === 'Raider Buggies' && plural('Artillery', 3) === 'Artillery' && plural('Refinery', 2) === 'Refineries' && plural('Battle Tank', 1) === 'Battle Tank', 'plurals');
  ok(clockOf(0) === '0:00' && clockOf(13500) === '22:30' && clockOf(51000) === '85:00', 'times read as the battle clock');
  const empty = turningPoints(newHistory(2), ctx(level(1)));
  ok(empty.findings.length === 0 && /0:30/.test(empty.headline), 'an empty history says when the first sample comes');
}

/** Real battles read sensibly: a few findings each, every one dated within the battle, plain words. */
function realReviews(ok: Ok): void {
  let some = 0;
  for (const seed of ['rv-real-1', 'rv-real-2', 'rv-real-3']) {
    let s = skirmish(seed, { map: 'random' });
    // The same battle without a history, to its end too: the same winner at the same tick.
    const plain = copy(s);
    delete plain.history;
    let b = migrateState(plain)!;
    while (s.tick < 30000 && s.winner === null) {
      s = tickBy(s, 600);
      b = tickBy(b, 600);
    }
    ok(s.winner !== null, `${seed}: fought to a winner`);
    ok(play(s) === play(b) && s.winner === b.winner && s.tick === b.tick, `${seed}: to the end, identical with and without the history (winner ${s.winner} at ${clockOf(s.tick)})`);
    const r = reviewOf(s)!;
    ok(!!r && r.review.findings.length <= MAX_FINDINGS, `${seed}: at most six findings`);
    ok(r.review.findings.every(f => f.tick >= 0 && f.tick <= s.tick && (f.until === undefined || f.until <= s.tick)), `${seed}: every finding dated within the battle`);
    const text = [r.review.headline, ...r.review.findings.flatMap(f => [f.text, f.advice])].join(' ');
    ok(!/[–—]/.test(text) && !/undefined|NaN/.test(text), `${seed}: plain words, nothing undefined`);
    if (r.review.findings.length) some++;
  }
  ok(some >= 2, `real battles find turning points (${some} of 3)`);
}

// ---- Size --------------------------------------------------------------------------------------

function size(ok: Ok): void {
  // A huge map, four sides, Epic. Six minutes here measure the samples; --deep plays all 85.
  const minutes = DEEP ? 85 : 6;
  let s = skirmish('rv-epic', { map: 'random', sides: 4, mode: 'ffa', size: 'huge', pace: 'epic', sites: true, credits: 5000 });
  while (s.tick < minutes * minute && s.winner === null) s = tickBy(s, 600);
  const h = s.history!;
  const bytes = historyBytes(h);
  const perSideSample = h.s.flat().reduce((a, c) => a + c.length, 0) / Math.max(1, h.n) / 4;
  console.log(`  history after ${(s.tick / minute).toFixed(1)} min on a huge four-sided map: ${bytes} B (${h.n} samples, ${historyEvents(h).length} events, ${perSideSample.toFixed(1)} B a side a sample)`);
  ok(bytes < 20000, `the history stays under 20 KB (${bytes} B)`);
  ok(perSideSample < 16, `a sample costs under 16 bytes a side (${perSideSample.toFixed(1)})`);

  // Busier than any battle measured: 85 minutes of four sides whose every number moves every sample
  // (about 18 bytes a side a sample, against 14 in the busiest real Epic battle measured), half
  // of the loss and kill counts busy, and three thousand events. Still under 20 KB.
  const busy = newHistory(4);
  let seed = 12345;
  const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  const walk = [0, 1, 2, 3].map(() => [100, 0, 100, 200]);
  for (let i = 0; i < 170; i++) {
    appendSample(
      busy,
      walk.map(w => {
        w[0] = Math.max(0, w[0] + rnd(41) - 20);
        w[2] = Math.max(0, w[2] + rnd(41) - 20);
        w[3] = Math.max(0, w[3] + rnd(11) - 5);
        return [w[0], 40 + rnd(80), w[2], w[3], ...Array.from({ length: 10 }, () => (rnd(3) ? 0 : 1 + rnd(12))), 300 + rnd(3) * 10, 280 + rnd(3) * 10, 100 + rnd(10)];
      }),
    );
  }
  const kinds: HistoryEvent['kind'][] = ['built', 'site', 'power', 'lost', 'research', 'losses'];
  const words = [...Object.keys(UNITS), ...Object.keys(BUILDINGS)];
  for (let i = 0; i < 3000; i++) {
    const k = kinds[i % kinds.length];
    pushEvent(busy, i * 17, (i % 4) as Owner, k, words[rnd(words.length)], k === 'losses' ? 9 : undefined, k === 'losses' ? 'artillery' : undefined, k === 'losses' ? 14 : undefined);
  }
  const busyBytes = historyBytes(busy);
  const busyPer = busy.s.flat().reduce((a, c) => a + c.length, 0) / 170 / 4;
  console.log(`  a busier 85 minutes: ${busyBytes} B (${busyPer.toFixed(1)} B a side a sample)`);
  ok(busyPer > 16, `the busy history is busier than any measured (${busyPer.toFixed(1)} B a side a sample)`);
  ok(busyBytes < 20000, `a busier 85-minute history stays under 20 KB (${busyBytes} B)`);
  const kept = historyEvents(busy);
  ok(busy.capped !== undefined && kept.length < 3000, 'past its budget the record keeps fewer events, and says from when');
  const late = kept.filter(e => e.tick > busy.capped!);
  ok(late.length > 0 && late.every(e => e.kind === 'lost' || e.kind === 'losses' || e.kind === 'research'), 'and what it keeps after that is what the turning points read');
  ok(decodeHistory(busy) !== null && migrateState({ ...copy(s), history: busy })?.history?.capped === busy.capped, 'the busy history reads back and survives a save');
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Review: a history on every new battle, none on old saves', presence],
  ['Review: the encoding', encoding],
  ['Review: samples every 30 seconds, matching the battle recomputed', cadence],
  ['Review: recording never changes play', sameGame],
  ['Review: replay', replay],
  ['Review: turning points on constructed histories', rulesTests],
  ['Review: real battles', realReviews],
  ['Review: size on a long huge battle', size],
];
