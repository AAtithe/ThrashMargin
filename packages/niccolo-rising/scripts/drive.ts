/**
 * The driver. Plays many characters through weeks of compressed real time, asserting invariants
 * after every action, then checks the properties the save hooks and the UI depend on:
 *
 *  - an illegal action returns the same state object, and so does a TICK that changes nothing;
 *  - a whole game replays byte-identically from its seed and its action list;
 *  - advancing time in many small steps and in one large step reach the same state (log aside),
 *    which is what makes a bar or a payday independent of how often the player looks;
 *  - fuzzed garbage actions never corrupt a state, never throw.
 *
 * Then prints a progress report for a few session rhythms so balance can be tuned from evidence.
 *
 *   npm run drive --workspace=packages/niccolo-rising            # 20 seeds
 *   SEEDS=150 npm run drive --workspace=packages/niccolo-rising  # wider
 */
import { advance, processAction, whyIllegal } from '../src/sim/actions';
import {
  CONFIG,
  COURSES,
  DAY,
  DESTINATIONS,
  HOUR,
  ITEM,
  ITEMS,
  JOB,
  JOBS,
  LODGINGS,
  MINUTE,
  OPPONENTS,
  SCHEMES,
  YARDS,
  abroadStock,
  barMax,
  carryCapacity,
  saleValue,
  schemeChance,
  xpToNext,
} from '../src/sim/content';
import { createInitialState, isCurrentShape } from '../src/sim/state';
import { next } from '../src/sim/rng';
import { BAR_IDS, BATTLE_STATS, WORK_STATS } from '../src/sim/types';
import type { BattleStat, GameAction, GameState } from '../src/sim/types';

let assertions = 0;
/** Net groats moved by each action type, across every game: where the money actually comes from. */
const income: Record<string, number> = {};
let failures = 0;
const failureSamples: string[] = [];

function check(cond: boolean, msg: string) {
  assertions++;
  if (!cond) {
    failures++;
    if (failureSamples.length < 25) failureSamples.push(msg);
  }
}

// ---------------------------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------------------------

function walkNumbers(v: unknown, path: string, out: string[]) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) out.push(path);
  } else if (Array.isArray(v)) v.forEach((x, i) => walkNumbers(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walkNumbers(x, `${path}.${k}`, out);
}

function invariants(s: GameState, tag: string) {
  check(isCurrentShape(s), `${tag}: shape`);
  const bad: string[] = [];
  walkNumbers(s, 's', bad);
  check(bad.length === 0, `${tag}: non-finite numbers at ${bad.join(', ')}`);
  check(Number.isInteger(s.groats) && s.groats >= 0, `${tag}: groats ${s.groats}`);
  check(s.level >= 1 && s.level <= CONFIG.levels.maxLevel, `${tag}: level ${s.level}`);
  check(s.xp >= 0 && (s.level === CONFIG.levels.maxLevel || s.xp < xpToNext(s.level)), `${tag}: xp ${s.xp} at level ${s.level}`);
  for (const bar of BAR_IDS) {
    check(s.bars[bar].cur >= 0, `${tag}: ${bar} negative`);
    check(Number.isInteger(s.bars[bar].cur), `${tag}: ${bar} fractional ${s.bars[bar].cur}`);
  }
  check(s.bars.health.cur <= barMax(s, 'health'), `${tag}: health over max`);
  check(s.bars.health.cur >= 1, `${tag}: health below 1`);
  for (const stat of BATTLE_STATS) check(s.battle[stat] >= 10, `${tag}: ${stat} ${s.battle[stat]}`);
  for (const stat of WORK_STATS) check(s.work[stat] >= 5, `${tag}: ${stat} ${s.work[stat]}`);
  for (const [id, qty] of Object.entries(s.inventory)) {
    check(!!ITEM[id], `${tag}: unknown item ${id}`);
    check(Number.isInteger(qty) && qty > 0, `${tag}: inventory ${id}=${qty}`);
  }
  for (const slot of ['weapon', 'armour'] as const) {
    const id = s.equipped[slot];
    if (id) check(ITEM[id]?.kind === slot, `${tag}: ${slot} slot holds ${id}`);
  }
  if (s.job) check(!!JOB[s.job.id] && s.job.rank >= 0 && s.job.rank < JOB[s.job.id].ranks.length, `${tag}: job`);
  check(new Set(s.honours).size === s.honours.length, `${tag}: duplicate honours`);
  check(new Set(s.coursesDone).size === s.coursesDone.length, `${tag}: duplicate courses`);
  check(s.tripBought >= 0 && s.tripBought <= carryCapacity(s), `${tag}: tripBought ${s.tripBought}`);
  for (const city of Object.keys(s.abroad))
    for (const m of DESTINATIONS.find(d => d.id === city)?.market ?? [])
      check(abroadStock(s, city, m.item) >= 0, `${tag}: stock`);
  for (let i = 1; i < s.log.length; i++) check(s.log[i].seq > s.log[i - 1].seq, `${tag}: log seq`);
  check(s.log.length <= 200, `${tag}: log cap`);
  const st = s.status;
  if (st.kind === 'travelling') check(st.arrives > st.departs, `${tag}: journey`);
}

// ---------------------------------------------------------------------------------------------
// A recorded game
// ---------------------------------------------------------------------------------------------

class Game {
  s: GameState;
  actions: GameAction[] = [];
  constructor(public id: string, public seed: string, public createdAt: number) {
    this.s = createInitialState(id, 'Claes', { seed, createdAt });
    invariants(this.s, `${seed}:init`);
  }

  /** Dispatch, asserting the reducer's contract either way. Returns whether it was accepted. */
  act(a: GameAction): boolean {
    const prev = this.s;
    const why = whyIllegal(prev, a);
    const next = processAction(prev, a);
    this.actions.push(a);
    if (a.type === 'TICK') {
      check(why === null, `${this.seed}: TICK judged illegal`);
    } else {
      check((next === prev) === (why !== null), `${this.seed}: whyIllegal disagrees with processAction on ${a.type} (${why})`);
    }
    if (next !== prev) {
      const key = a.type === 'SELL' ? `SELL ${ITEM[(a as { itemId: string }).itemId]?.kind}` : a.type;
      income[key] = (income[key] ?? 0) + (next.groats - prev.groats);
      check(next.clock >= prev.clock, `${this.seed}: clock went backwards`);
      invariants(next, `${this.seed}:${a.type}`);
    }
    this.s = next;
    return next !== prev || a.type === 'TICK';
  }
}

// ---------------------------------------------------------------------------------------------
// A competent but unsubtle player
// ---------------------------------------------------------------------------------------------

function bestYard(s: GameState) {
  return YARDS.filter(y => s.yards.includes(y.id)).sort((a, b) => b.dots - a.dots)[0];
}

function weakestStat(s: GameState): BattleStat {
  return [...BATTLE_STATS].sort((a, b) => s.battle[a] - s.battle[b])[0];
}

function session(g: Game, at: number) {
  g.act({ type: 'TICK', at });
  let s = g.s;

  // Out of action: the most a session can do is wait it out, bribe, or use an item.
  if (s.status.kind === 'steen' && s.groats > 5000) g.act({ type: 'BRIBE', at });
  if (g.s.status.kind === 'infirmary' && (g.s.inventory.bandage ?? 0) > 0) g.act({ type: 'USE_ITEM', at, itemId: 'bandage' });
  if (g.s.status.kind === 'abroad') {
    const city = g.s.status.city;
    const dest = DESTINATIONS.find(d => d.id === city)!;
    // Fill the pack with whatever sells best per item at home.
    const lines = [...dest.market].sort((a, b) => ITEM[b.item].value - b.cost - (ITEM[a.item].value - a.cost));
    for (const line of lines) {
      const room = carryCapacity(g.s) - g.s.tripBought;
      const afford = Math.floor(g.s.groats / line.cost);
      const qty = Math.min(room, afford, abroadStock(g.s, city, line.item));
      if (qty > 0 && ITEM[line.item].value > line.cost) g.act({ type: 'BUY_ABROAD', at, itemId: line.item, qty });
    }
    g.act({ type: 'TRAVEL', at, to: 'bruges' });
    return;
  }
  if (g.s.status.kind !== 'free') return;

  // Sell trade goods.
  for (const item of ITEMS.filter(i => i.kind === 'trade')) {
    const qty = g.s.inventory[item.id] ?? 0;
    if (qty > 0) g.act({ type: 'SELL', at, itemId: item.id, qty });
  }

  // Work: take the best post available, then promote whenever possible.
  if (!g.s.job) {
    for (const job of [...JOBS].reverse()) if (g.act({ type: 'JOIN_JOB', at, jobId: job.id })) break;
  }
  while (g.act({ type: 'PROMOTE', at })) { /* climb */ }

  // Study.
  if (!g.s.course) for (const c of COURSES) if (g.act({ type: 'ENROL', at, courseId: c.id })) break;

  // Yards, lodging and kit, when there is a comfortable surplus.
  for (const y of YARDS) if (g.s.groats > y.cost * 2) g.act({ type: 'BUY_YARD', at, yardId: y.id });
  for (const l of LODGINGS) if (g.s.groats > l.cost * 2) g.act({ type: 'BUY_LODGING', at, lodgingId: l.id });
  for (const kind of ['weapon', 'armour'] as const) {
    const current = g.s.equipped[kind] ? ITEM[g.s.equipped[kind]!] : null;
    const better = ITEMS.filter(i => i.kind === kind && i.price > 0 && i.price * 3 < g.s.groats)
      .sort((a, b) => b.price - a.price)[0];
    if (better && (!current || better.price > current.price)) {
      if (g.act({ type: 'BUY', at, itemId: better.id, qty: 1 })) g.act({ type: 'EQUIP', at, itemId: better.id });
    }
  }
  for (const kit of ['satchel', 'mule']) if (!g.s.inventory[kit] && g.s.groats > ITEM[kit].price * 3) g.act({ type: 'BUY', at, itemId: kit, qty: 1 });

  // Spirits before training.
  s = g.s;
  if (s.bars.spirits.cur < barMax(s, 'spirits') / 2 && s.groats > 2000) g.act({ type: 'BUY', at, itemId: 'marchpane', qty: 1 }) && g.act({ type: 'USE_ITEM', at, itemId: 'marchpane' });

  // Fight the strongest opponent the bot expects to beat, if healthy.
  s = g.s;
  if (s.bars.health.cur > barMax(s, 'health') * 0.7 && s.bars.energy.cur >= CONFIG.duel.energyCost) {
    const total = BATTLE_STATS.reduce((n, k) => n + s.battle[k], 0);
    const target = [...OPPONENTS].reverse().find(o => BATTLE_STATS.reduce((n, k) => n + o.stats[k], 0) * 1.3 < total && (s.opponents[o.id] ?? 0) <= at);
    if (target) g.act({ type: 'DUEL', at, opponentId: target.id });
  }

  // Train with whatever energy is left.
  s = g.s;
  if (s.status.kind === 'free') {
    const yard = bestYard(s);
    const times = Math.floor(s.bars.energy.cur / yard.energy);
    if (times > 0) g.act({ type: 'TRAIN', at, yardId: yard.id, stat: weakestStat(s), times });
  }

  // Nerve on the best scheme with even odds or better.
  for (let guard = 0; guard < 30 && g.s.status.kind === 'free'; guard++) {
    s = g.s;
    const scheme = [...SCHEMES].reverse().find(x =>
      (!x.requiresCourse || s.coursesDone.includes(x.requiresCourse)) && schemeChance(s, x) >= 0.5 && s.bars.nerve.cur >= x.nerve);
    if (!scheme || !g.act({ type: 'SCHEME', at, schemeId: scheme.id })) break;
  }

  // Bank a surplus.
  if (g.s.status.kind === 'free' && !g.s.deposit && g.s.groats > 20_000) {
    g.act({ type: 'DEPOSIT', at, amount: Math.floor(g.s.groats / 2), days: 3 });
  }

  // Then fly while the bars refill: the furthest destination the purse and the courses allow.
  if (g.s.status.kind === 'free') {
    const dest = [...DESTINATIONS].reverse().find(d =>
      (!d.requiresCourse || g.s.coursesDone.includes(d.requiresCourse)) && g.s.groats > d.fare * 4);
    if (dest) g.act({ type: 'TRAVEL', at, to: dest.id });
  }
}

// ---------------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------------

function strip(s: GameState) {
  const { log: _log, nextLogSeq: _n, ...rest } = s;
  return JSON.stringify(rest);
}

function checkReplay(g: Game) {
  let s = createInitialState(g.id, 'Claes', { seed: g.seed, createdAt: g.createdAt });
  for (const a of g.actions) s = processAction(s, a);
  check(JSON.stringify(s) === JSON.stringify(g.s), `${g.seed}: replay diverged`);
}

function checkTickIdempotent(g: Game, at: number) {
  const a = processAction(g.s, { type: 'TICK', at });
  const b = processAction(a, { type: 'TICK', at });
  check(a === b, `${g.seed}: second TICK at the same time changed the state`);
  check(JSON.stringify(advance(g.s, at)) === JSON.stringify(a), `${g.seed}: advance() and TICK disagree`);
}

function checkPathIndependence(g: Game, from: number, span: number) {
  const big = processAction(g.s, { type: 'TICK', at: from + span });
  let small = g.s;
  for (let t = from + 7 * MINUTE; t < from + span; t += 7 * MINUTE) small = processAction(small, { type: 'TICK', at: t });
  small = processAction(small, { type: 'TICK', at: from + span });
  check(strip(big) === strip(small), `${g.seed}: advancing in small steps differs from one large step`);
}

function fuzz(g: Game, at: number, rngSeed: number) {
  const ids = [
    ...ITEMS.map(i => i.id), ...SCHEMES.map(x => x.id), ...JOBS.map(x => x.id), ...COURSES.map(x => x.id),
    ...DESTINATIONS.map(x => x.id), ...LODGINGS.map(x => x.id), ...OPPONENTS.map(x => x.id), ...YARDS.map(x => x.id),
    'bruges', 'nonsense', '', '__proto__',
  ];
  const nums = [0, -1, 1, 2, 3, 7, 50, 1.5, 1e9, NaN];
  let seed = rngSeed;
  const pick = <T,>(xs: T[]): T => {
    const r = next(seed);
    seed = r.seed;
    return xs[Math.floor(r.value * xs.length)];
  };
  const types: GameAction['type'][] = [
    'BUY_YARD', 'TRAIN', 'SCHEME', 'JOIN_JOB', 'LEAVE_JOB', 'PROMOTE', 'ENROL', 'TRAVEL', 'BUY_ABROAD',
    'BUY', 'SELL', 'USE_ITEM', 'EQUIP', 'UNEQUIP', 'BUY_LODGING', 'DUEL', 'DEPOSIT', 'BRIBE',
  ];
  for (let i = 0; i < 60; i++) {
    const a = {
      type: pick(types), at,
      yardId: pick(ids), stat: pick([...BATTLE_STATS, 'luck']), times: pick(nums), schemeId: pick(ids),
      jobId: pick(ids), courseId: pick(ids), to: pick(ids), itemId: pick(ids), qty: pick(nums),
      slot: pick(['weapon', 'armour']), lodgingId: pick(ids), opponentId: pick(ids), amount: pick(nums), days: pick(nums),
    } as unknown as GameAction;
    let threw = false;
    try {
      g.act(a);
    } catch (e) {
      threw = true;
      if (failureSamples.length < 25) failureSamples.push(`fuzz threw on ${a.type}: ${String(e)}`);
    }
    check(!threw, `${g.seed}: fuzz threw`);
  }
}

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------

interface Rhythm {
  name: string;
  /** Session times within each day, in hours after the day starts. */
  hours: number[];
}

const RHYTHMS: Rhythm[] = [
  { name: 'keen (every 2h, 16h awake)', hours: [0, 2, 4, 6, 8, 10, 12, 14, 16] },
  { name: 'steady (4 a day)', hours: [0, 5, 10, 15] },
  { name: 'casual (twice a day)', hours: [0, 12] },
];

const SEEDS = Number(process.env.SEEDS ?? 20);
const DAYS = Number(process.env.DAYS ?? 30);
const T0 = Date.UTC(2026, 0, 5, 7, 0, 0);

const report: Record<string, { day: number; level: number[]; stats: number[]; groats: number[]; schemeSkill: number[]; courses: number[]; duels: number[]; honours: number[] }[]> = {};

const started = Date.now();
for (const rhythm of RHYTHMS) {
  const snaps = [7, 14, DAYS].map(day => ({ day, level: [] as number[], stats: [] as number[], groats: [] as number[], schemeSkill: [] as number[], courses: [] as number[], duels: [] as number[], honours: [] as number[] }));
  for (let i = 0; i < SEEDS; i++) {
    const seed = `seed-${i}`;
    const g = new Game(`game-${rhythm.name}-${i}`, seed, T0);
    for (let day = 0; day < DAYS; day++) {
      for (const h of rhythm.hours) {
        const at = T0 + day * DAY + h * HOUR;
        session(g, at);
        if (h === rhythm.hours[0] && day % 5 === 2) {
          checkTickIdempotent(g, at + 13 * MINUTE);
          checkPathIndependence(g, g.s.clock, 9 * HOUR + 17 * MINUTE);
        }
      }
      const snap = snaps.find(x => x.day === day + 1);
      if (snap) {
        const s = g.s;
        snap.level.push(s.level);
        snap.stats.push(BATTLE_STATS.reduce((n, k) => n + s.battle[k], 0));
        // Net worth: purse, deposit, and what the inventory would fetch today.
        const inv = Object.entries(s.inventory).reduce((n, [id, q]) => n + saleValue(s, id, s.clock) * q, 0);
        snap.groats.push(s.groats + (s.deposit?.amount ?? 0) + inv);
        snap.schemeSkill.push(s.schemeSkill);
        snap.courses.push(s.coursesDone.length);
        snap.duels.push(s.counters.duelsWon);
        snap.honours.push(s.honours.length);
      }
    }
    checkReplay(g);
    // Fuzz a copy so the replayed history above stays a real game.
    const f = new Game(`fuzz-${i}`, `fuzz-${i}`, T0);
    f.s = g.s;
    fuzz(f, g.s.clock + HOUR, i + 1);
  }
  report[rhythm.name] = snaps;
}

const median = (xs: number[]) => {
  const ys = [...xs].sort((a, b) => a - b);
  return ys.length ? ys[Math.floor(ys.length / 2)] : 0;
};

console.log(`Niccolò Rising driver: ${SEEDS} seeds × ${RHYTHMS.length} rhythms × ${DAYS} days, ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log('');
console.log('Medians                          day  level  battle-stats    net-worth  scheme-skill  courses  duels-won  honours');
for (const [name, snaps] of Object.entries(report)) {
  for (const sn of snaps) {
    console.log(
      `${name.padEnd(32)} ${String(sn.day).padStart(3)}  ${String(median(sn.level)).padStart(5)}  ${median(sn.stats).toFixed(0).padStart(12)}  ${median(sn.groats).toLocaleString('en-GB').padStart(11)}  ${median(sn.schemeSkill).toFixed(0).padStart(12)}  ${String(median(sn.courses)).padStart(7)}  ${String(median(sn.duels)).padStart(9)}  ${String(median(sn.honours)).padStart(7)}`,
    );
  }
}
console.log('');
console.log('Net groats by action, all games:');
for (const [k, v] of Object.entries(income).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(16)} ${Math.round(v).toLocaleString('en-GB').padStart(14)}`);
console.log('');
console.log(`${assertions.toLocaleString('en-GB')} assertions, ${failures} failed`);
if (failures) {
  for (const f of failureSamples) console.log('  FAIL', f);
  process.exit(1);
}
