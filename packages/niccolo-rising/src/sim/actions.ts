/**
 * The reducer. Pure: no Math.random (dice come from `rng.ts` against `rngSeed`) and no clock (every
 * action carries `at`). The same save and the same action list always produce the same state, byte
 * for byte, which is what lets `scripts/drive.ts` replay a month of play and compare.
 *
 * Every action first advances the world to `at` (bars refill, journeys end, courses finish, paydays
 * fall, deposits mature, markets restock) and then applies its verb to the advanced state.
 *
 * **An illegal action returns the same state object** (reference equality), with the advance
 * discarded as well; the next accepted action or TICK will perform it. The save hooks rely on this
 * to skip a pointless write. A TICK that finds nothing to advance also returns the same object, so
 * the client can tick on a timer without writing on a timer.
 */
import {
  CONFIG,
  COURSE,
  DAY,
  DESTINATION,
  HONOUR,
  ITEM,
  JOB,
  LODGING,
  MINUTE,
  OPPONENT,
  SCHEME,
  YARD,
  abroadStock,
  barMax,
  barTick,
  bribeCost,
  carryCapacity,
  journeyMs,
  perks,
  saleValue,
  schemeChance,
  trainGain,
  xpToNext,
} from './content';
import { simulateDuel } from './combat';
import { next, nextInt } from './rng';
import { BAR_IDS, BATTLE_STATS, WORK_STATS } from './types';
import type { BarId, GameAction, GameState, LogEntry } from './types';

const LOG_CAP = 200;
const MAX_QTY = 500;

/** A rejection. Thrown inside the verb and caught in processAction, which returns the input state. */
class Illegal extends Error {}

function reject(why: string): never {
  throw new Illegal(why);
}

function clone(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s)) as GameState;
}

function log(d: GameState, at: number, text: string, tone: LogEntry['tone'] = 'neutral') {
  d.log.push({ seq: d.nextLogSeq++, at, text, tone });
  if (d.log.length > LOG_CAP) d.log.splice(0, d.log.length - LOG_CAP);
}

function award(d: GameState, at: number, id: string) {
  if (d.honours.includes(id) || !HONOUR[id]) return;
  d.honours.push(id);
  log(d, at, `Honour: ${HONOUR[id].name}. ${HONOUR[id].text}`, 'honour');
}

function roll(d: GameState): number {
  const r = next(d.rngSeed);
  d.rngSeed = r.seed;
  return r.value;
}

function rollInt(d: GameState, min: number, max: number): number {
  const r = nextInt(d.rngSeed, min, max);
  d.rngSeed = r.seed;
  return r.value;
}

// ---------------------------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------------------------

/**
 * A bar at or above its maximum does not tick, so its anchor goes stale. Call this before anything
 * that takes a full bar below its maximum, or raises the maximum, so the first tick afterwards is
 * one full period from now rather than paying out for the whole time the bar sat full.
 */
function rebaseIfFull(d: GameState, bar: BarId, at: number) {
  if (d.bars[bar].cur >= barMax(d, bar)) d.bars[bar].anchor = at;
}

function spend(d: GameState, bar: BarId, amount: number, at: number) {
  if (d.bars[bar].cur < amount) reject(`Not enough ${bar}.`);
  rebaseIfFull(d, bar, at);
  d.bars[bar].cur -= amount;
}

/** Items may push energy, nerve and spirits past their maximum (and they stay there until spent). */
function add(d: GameState, bar: BarId, amount: number, at: number) {
  rebaseIfFull(d, bar, at);
  const cur = d.bars[bar].cur + amount;
  d.bars[bar].cur = bar === 'health' ? Math.min(barMax(d, 'health'), cur) : cur;
}

function setHealth(d: GameState, hp: number, at: number) {
  rebaseIfFull(d, 'health', at);
  d.bars.health.cur = Math.max(1, Math.min(barMax(d, 'health'), Math.round(hp)));
}

// ---------------------------------------------------------------------------------------------
// Advance: everything time does on its own
// ---------------------------------------------------------------------------------------------

/** Mutates `d` forward to `now`. Returns whether anything changed. */
function advanceDraft(d: GameState, now: number): boolean {
  let changed = false;

  // Status timers.
  const st = d.status;
  if (st.kind === 'travelling' && now >= st.arrives) {
    if (st.to === 'bruges') {
      d.status = { kind: 'free' };
      log(d, st.arrives, 'Home through the Ezelpoort, with the smell of the Reie to tell you so.');
    } else {
      d.status = { kind: 'abroad', city: st.to };
      d.counters.voyages++;
      log(d, st.arrives, `Arrived in ${DESTINATION[st.to]?.name ?? st.to}.`);
      award(d, st.arrives, 'first_voyage');
    }
    changed = true;
  } else if ((st.kind === 'infirmary' || st.kind === 'steen') && now >= st.until) {
    d.status = { kind: 'free' };
    log(d, st.until, st.kind === 'steen' ? 'Released from the Steen.' : 'Discharged from the Infirmary.');
    changed = true;
  }

  // A course finishing.
  if (d.course && now >= d.course.ends) {
    const course = COURSE[d.course.id];
    const ends = d.course.ends;
    d.course = null;
    if (course && !d.coursesDone.includes(course.id)) {
      d.coursesDone.push(course.id);
      for (const stat of WORK_STATS) d.work[stat] += course.perks.workGains?.[stat] ?? 0;
      for (const stat of BATTLE_STATS) d.battle[stat] += course.perks.battle?.[stat] ?? 0;
      log(d, ends, `Course completed: ${course.name}.`, 'good');
      award(d, ends, 'first_course');
    }
    changed = true;
  }

  // A deposit maturing.
  if (d.deposit && now >= d.deposit.matures) {
    const dep = d.deposit;
    const payout = Math.round(dep.amount * (1 + dep.pct / 100));
    d.groats += payout;
    d.deposit = null;
    log(d, dep.matures, `Your Medici deposit matured: ${payout.toLocaleString('en-GB')} gr returned, ${(payout - dep.amount).toLocaleString('en-GB')} of it interest.`, 'good');
    changed = true;
  }

  // Paydays.
  if (d.job) {
    const job = JOB[d.job.id];
    const days = Math.floor((now - d.job.since) / DAY);
    if (job && days > d.job.paidDays) {
      const rank = job.ranks[d.job.rank];
      const due = days - d.job.paidDays;
      const pay = Math.round(rank.pay * (1 + perks(d).payPct / 100));
      d.groats += pay * due;
      for (const stat of WORK_STATS) d.work[stat] += rank.gains[stat] * due;
      d.job.paidDays = days;
      log(d, d.job.since + days * DAY, `${due === 1 ? 'A day' : `${due} days`} at ${job.name} as ${rank.name}: ${(pay * due).toLocaleString('en-GB')} gr.`);
      changed = true;
    }
  }

  // Bars.
  for (const bar of BAR_IDS) {
    const b = d.bars[bar];
    const max = barMax(d, bar);
    if (b.cur >= max) continue;
    const tick = barTick(d, bar);
    const ticks = Math.floor((now - b.anchor) / tick.ms);
    if (ticks <= 0) continue;
    // Stop counting at the tick that fills the bar, so the anchor a full bar is left with does not
    // depend on how long after filling somebody happened to look.
    const toFill = Math.ceil((max - b.cur) / tick.amount);
    const used = Math.min(ticks, toFill);
    b.cur = Math.min(max, b.cur + used * tick.amount);
    b.anchor += used * tick.ms;
    changed = true;
  }

  // Restocks. A market restocks in full one period after it was first bought from.
  const restockMs = CONFIG.restockMinutes * MINUTE;
  for (const city of Object.keys(d.abroad)) {
    if (now - d.abroad[city].since >= restockMs) {
      delete d.abroad[city];
      changed = true;
    }
  }

  return changed;
}

/**
 * The state as it stands at `now`, without an action. The UI renders through this every second so
 * bars and timers move between ticks. Returns the same object when nothing has changed.
 */
export function advance(s: GameState, now: number): GameState {
  const at = Math.max(now, s.clock);
  const d = clone(s);
  return advanceDraft(d, at) ? d : s;
}

// ---------------------------------------------------------------------------------------------
// Levels and honours
// ---------------------------------------------------------------------------------------------

function gainXp(d: GameState, xp: number, at: number) {
  d.xp += xp;
  while (d.level < CONFIG.levels.maxLevel && d.xp >= xpToNext(d.level)) {
    d.xp -= xpToNext(d.level);
    for (const bar of ['nerve', 'health'] as const) rebaseIfFull(d, bar, at);
    d.level++;
    log(d, at, `Level ${d.level}.`, 'good');
    if (d.level === 5) award(d, at, 'level_5');
    if (d.level === 10) award(d, at, 'level_10');
    if (d.level === 20) award(d, at, 'level_20');
  }
}

function moneyHonours(d: GameState, at: number) {
  if (d.groats >= 10_000) award(d, at, 'groats_10k');
  if (d.groats >= 100_000) award(d, at, 'groats_100k');
}

// ---------------------------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------------------------

function needFree(d: GameState, doing: string) {
  const st = d.status;
  if (st.kind === 'free') return;
  const where =
    st.kind === 'infirmary' ? 'in the Infirmary'
    : st.kind === 'steen' ? 'in the Steen'
    : st.kind === 'travelling' ? 'on the road'
    : 'abroad';
  reject(`You cannot ${doing} while ${where}.`);
}

function qtyOk(qty: number) {
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) reject('Bad quantity.');
}

function infirmaryMinutes(d: GameState, minutes: number): number {
  return Math.max(1, Math.round(minutes * (1 - Math.min(80, perks(d).infirmaryPct) / 100)));
}

function steenMinutes(d: GameState, minutes: number): number {
  return Math.max(1, Math.round(minutes * (1 - Math.min(80, perks(d).steenPct) / 100)));
}

function applyVerb(d: GameState, a: GameAction, at: number) {
  switch (a.type) {
    case 'TICK':
      return;

    case 'BUY_YARD': {
      needFree(d, 'join a yard');
      const yard = YARD[a.yardId] ?? reject('No such yard.');
      if (d.yards.includes(yard.id)) reject('Already a member.');
      if (d.level < yard.minLevel) reject(`Level ${yard.minLevel} required.`);
      if (d.groats < yard.cost) reject('Not enough groats.');
      d.groats -= yard.cost;
      d.yards.push(yard.id);
      log(d, at, `You pay ${yard.cost.toLocaleString('en-GB')} gr and are let into ${yard.name}.`);
      return;
    }

    case 'TRAIN': {
      needFree(d, 'train');
      const yard = YARD[a.yardId] ?? reject('No such yard.');
      if (!d.yards.includes(yard.id)) reject('Not a member of that yard.');
      if (!BATTLE_STATS.includes(a.stat)) reject('No such stat.');
      if (!Number.isInteger(a.times) || a.times < 1 || a.times > 200) reject('Bad number of trains.');
      spend(d, 'energy', yard.energy * a.times, at);
      const before = d.battle[a.stat];
      for (let i = 0; i < a.times; i++) {
        d.battle[a.stat] += trainGain(d, yard, d.battle[a.stat], d.bars.spirits.cur);
        const drain = Math.floor(yard.energy * CONFIG.spiritsDrainPerEnergy);
        if (d.bars.spirits.cur > 0) {
          rebaseIfFull(d, 'spirits', at);
          d.bars.spirits.cur = Math.max(0, d.bars.spirits.cur - drain);
        }
      }
      d.battle[a.stat] = Math.round(d.battle[a.stat] * 100) / 100;
      const gained = d.battle[a.stat] - before;
      log(d, at, `${a.times} × ${a.stat} at ${yard.name}: +${gained.toFixed(2)}.`);
      return;
    }

    case 'SCHEME': {
      needFree(d, 'scheme');
      const scheme = SCHEME[a.schemeId] ?? reject('No such scheme.');
      if (scheme.requiresCourse && !d.coursesDone.includes(scheme.requiresCourse))
        reject(`Requires ${COURSE[scheme.requiresCourse]?.name ?? scheme.requiresCourse}.`);
      spend(d, 'nerve', scheme.nerve, at);
      d.counters.schemes++;
      const chance = schemeChance(d, scheme);
      if (roll(d) < chance) {
        const gr = rollInt(d, scheme.groats[0], scheme.groats[1]);
        d.groats += gr;
        d.schemeSkill += 1 + scheme.difficulty / 20;
        d.counters.schemesWon++;
        d.standing += Math.floor(scheme.difficulty / 40);
        log(d, at, `${scheme.name}: it comes off. ${gr.toLocaleString('en-GB')} gr.`, 'good');
        award(d, at, 'first_prank');
        gainXp(d, scheme.xp, at);
        return;
      }
      d.schemeSkill += 0.5;
      if (roll(d) < scheme.caught.chance) {
        const mins = steenMinutes(d, scheme.caught.minutes);
        d.status = { kind: 'steen', until: at + mins * MINUTE, reason: scheme.name };
        log(d, at, `${scheme.name}: the Watch has you. ${mins} minutes in the Steen.`, 'bad');
        award(d, at, 'steen');
      } else if (roll(d) < scheme.hurt.chance) {
        const mins = infirmaryMinutes(d, scheme.hurt.minutes);
        setHealth(d, d.bars.health.cur - barMax(d, 'health') * 0.3, at);
        d.status = { kind: 'infirmary', until: at + mins * MINUTE, reason: scheme.name };
        log(d, at, `${scheme.name}: it goes badly wrong and you are carried off. ${mins} minutes in the Infirmary.`, 'bad');
      } else {
        log(d, at, `${scheme.name}: you lose your nerve at the last moment and walk away.`);
      }
      return;
    }

    case 'JOIN_JOB': {
      needFree(d, 'take a post');
      const job = JOB[a.jobId] ?? reject('No such employer.');
      if (d.job?.id === job.id) reject('You already work there.');
      const req = job.ranks[0].req;
      for (const stat of WORK_STATS) if (d.work[stat] < req[stat]) reject(`Needs ${stat} ${req[stat]}.`);
      d.job = { id: job.id, rank: 0, since: at, paidDays: 0 };
      log(d, at, `You take a post at ${job.name} as ${job.ranks[0].name}.`);
      return;
    }

    case 'LEAVE_JOB': {
      if (!d.job) reject('You have no post.');
      log(d, at, `You leave ${JOB[d.job.id]?.name ?? 'your post'}.`);
      d.job = null;
      return;
    }

    case 'PROMOTE': {
      needFree(d, 'seek promotion');
      if (!d.job) reject('You have no post.');
      const job = JOB[d.job.id] ?? reject('No such employer.');
      const nextRank = job.ranks[d.job.rank + 1] ?? reject('Already at the top.');
      for (const stat of WORK_STATS) if (d.work[stat] < nextRank.req[stat]) reject(`Needs ${stat} ${nextRank.req[stat]}.`);
      d.job.rank++;
      log(d, at, `Promoted to ${nextRank.name} at ${job.name}.`, 'good');
      award(d, at, 'first_promotion');
      return;
    }

    case 'ENROL': {
      needFree(d, 'enrol');
      const course = COURSE[a.courseId] ?? reject('No such course.');
      if (d.course) reject('Already studying.');
      if (d.coursesDone.includes(course.id)) reject('Already completed.');
      if (course.requires && !d.coursesDone.includes(course.requires))
        reject(`Requires ${COURSE[course.requires]?.name ?? course.requires}.`);
      if (d.groats < course.cost) reject('Not enough groats.');
      d.groats -= course.cost;
      d.course = { id: course.id, ends: at + course.hours * 60 * MINUTE };
      log(d, at, `Enrolled: ${course.name}. ${course.hours} hours.`);
      return;
    }

    case 'TRAVEL': {
      if (a.to === 'bruges') {
        if (d.status.kind !== 'abroad') reject('You are not abroad.');
        const from = d.status.city;
        d.status = { kind: 'travelling', to: 'bruges', departs: at, arrives: at + journeyMs(d, from) };
        log(d, at, `You leave ${DESTINATION[from]?.name ?? from} for home.`);
        return;
      }
      needFree(d, 'travel');
      const dest = DESTINATION[a.to] ?? reject('No such destination.');
      if (dest.requiresCourse && !d.coursesDone.includes(dest.requiresCourse))
        reject(`Requires ${COURSE[dest.requiresCourse]?.name ?? dest.requiresCourse}.`);
      if (d.groats < dest.fare) reject('Not enough groats for the passage.');
      d.groats -= dest.fare;
      d.tripBought = 0;
      d.status = { kind: 'travelling', to: dest.id, departs: at, arrives: at + journeyMs(d, dest.id) };
      log(d, at, `You set out for ${dest.name}. Passage ${dest.fare} gr.`);
      return;
    }

    case 'BUY_ABROAD': {
      qtyOk(a.qty);
      if (d.status.kind !== 'abroad') reject('You are not abroad.');
      const city = d.status.city;
      const line = DESTINATION[city]?.market.find(m => m.item === a.itemId) ?? reject('Not sold here.');
      if (abroadStock(d, city, a.itemId) < a.qty) reject('Not enough in stock.');
      if (d.tripBought + a.qty > carryCapacity(d)) reject('You cannot carry that much home.');
      const cost = line.cost * a.qty;
      if (d.groats < cost) reject('Not enough groats.');
      d.groats -= cost;
      d.tripBought += a.qty;
      d.inventory[a.itemId] = (d.inventory[a.itemId] ?? 0) + a.qty;
      if (!d.abroad[city]) d.abroad[city] = { since: at, sold: {} };
      d.abroad[city].sold[a.itemId] = (d.abroad[city].sold[a.itemId] ?? 0) + a.qty;
      log(d, at, `Bought ${a.qty} × ${ITEM[a.itemId]?.name ?? a.itemId} for ${cost.toLocaleString('en-GB')} gr.`);
      return;
    }

    case 'BUY': {
      qtyOk(a.qty);
      needFree(d, 'shop');
      const item = ITEM[a.itemId] ?? reject('No such item.');
      if (item.price <= 0) reject('Not sold in Bruges.');
      const cost = item.price * a.qty;
      if (d.groats < cost) reject('Not enough groats.');
      d.groats -= cost;
      d.inventory[item.id] = (d.inventory[item.id] ?? 0) + a.qty;
      log(d, at, `Bought ${a.qty} × ${item.name} for ${cost.toLocaleString('en-GB')} gr.`);
      return;
    }

    case 'SELL': {
      qtyOk(a.qty);
      needFree(d, 'sell');
      const item = ITEM[a.itemId] ?? reject('No such item.');
      if ((d.inventory[item.id] ?? 0) < a.qty) reject('You do not have that many.');
      const each = saleValue(d, item.id, at);
      d.inventory[item.id] -= a.qty;
      if (d.inventory[item.id] === 0) delete d.inventory[item.id];
      d.groats += each * a.qty;
      log(d, at, `Sold ${a.qty} × ${item.name} at the Waterhalle for ${(each * a.qty).toLocaleString('en-GB')} gr.`);
      return;
    }

    case 'USE_ITEM': {
      const item = ITEM[a.itemId] ?? reject('No such item.');
      if (item.kind !== 'consumable' || !item.effect) reject('That cannot be used.');
      if ((d.inventory[item.id] ?? 0) < 1) reject('You have none.');
      d.inventory[item.id] -= 1;
      if (d.inventory[item.id] === 0) delete d.inventory[item.id];
      const e = item.effect;
      if (e.energy) add(d, 'energy', e.energy, at);
      if (e.nerve) add(d, 'nerve', e.nerve, at);
      if (e.spirits) add(d, 'spirits', e.spirits, at);
      if (e.health) add(d, 'health', e.health, at);
      log(d, at, `You use the ${item.name.toLowerCase()}.`);
      if (e.infirmaryMinutes && d.status.kind === 'infirmary') {
        const until = d.status.until - e.infirmaryMinutes * MINUTE;
        if (until <= at) {
          d.status = { kind: 'free' };
          log(d, at, 'Discharged from the Infirmary.');
        } else {
          d.status = { ...d.status, until };
        }
      }
      return;
    }

    case 'EQUIP': {
      if (d.status.kind === 'travelling') reject('Not on the road.');
      const item = ITEM[a.itemId] ?? reject('No such item.');
      if (item.kind !== 'weapon' && item.kind !== 'armour') reject('That cannot be equipped.');
      if ((d.inventory[item.id] ?? 0) < 1) reject('You have none.');
      const slot = item.kind;
      const prev = d.equipped[slot];
      d.inventory[item.id] -= 1;
      if (d.inventory[item.id] === 0) delete d.inventory[item.id];
      if (prev) d.inventory[prev] = (d.inventory[prev] ?? 0) + 1;
      d.equipped[slot] = item.id;
      log(d, at, `You equip the ${item.name.toLowerCase()}.`);
      return;
    }

    case 'UNEQUIP': {
      const prev = d.equipped[a.slot] ?? reject('Nothing equipped there.');
      d.inventory[prev] = (d.inventory[prev] ?? 0) + 1;
      d.equipped[a.slot] = null;
      return;
    }

    case 'BUY_LODGING': {
      needFree(d, 'buy lodging');
      const lodging = LODGING[a.lodgingId] ?? reject('No such lodging.');
      if (d.lodgings.includes(lodging.id)) reject('Already yours.');
      if (d.groats < lodging.cost) reject('Not enough groats.');
      rebaseIfFull(d, 'spirits', at);
      d.groats -= lodging.cost;
      d.lodgings.push(lodging.id);
      log(d, at, `${lodging.name} is yours for ${lodging.cost.toLocaleString('en-GB')} gr.`, 'good');
      award(d, at, 'house_owner');
      return;
    }

    case 'DUEL': {
      needFree(d, 'fight');
      const opp = OPPONENT[a.opponentId] ?? reject('No such opponent.');
      if ((d.opponents[opp.id] ?? 0) > at) reject(`${opp.name} is still recovering.`);
      spend(d, 'energy', CONFIG.duel.energyCost, at);
      const weapon = d.equipped.weapon ? ITEM[d.equipped.weapon] : null;
      const armour = d.equipped.armour ? ITEM[d.equipped.armour] : null;
      const result = simulateDuel(
        d.rngSeed,
        {
          name: d.name,
          stats: d.battle,
          hp: d.bars.health.cur,
          weapon: weapon?.damage ?? 1,
          accuracy: weapon?.accuracy ?? 0,
          armour: armour?.armour ?? 0,
        },
        { name: opp.name, stats: opp.stats, hp: opp.health, weapon: opp.weapon, accuracy: 0, armour: opp.armour },
        CONFIG.duel.maxRounds,
      );
      d.rngSeed = result.seed;
      d.lastFight = { opponentId: opp.id, at, outcome: result.outcome, lines: result.lines.slice(-40) };
      if (result.outcome === 'won') {
        setHealth(d, result.playerHp, at);
        const gr = rollInt(d, opp.groats[0], opp.groats[1]);
        d.groats += gr;
        d.standing += opp.level;
        d.counters.duelsWon++;
        d.opponents[opp.id] = at + CONFIG.duel.opponentRecoveryMinutes * MINUTE;
        log(d, at, `You beat ${opp.name} in ${result.rounds} rounds and take ${gr.toLocaleString('en-GB')} gr from them.`, 'good');
        award(d, at, 'first_duel');
        if (opp.id === 'felix' || opp.id === 'simon' || opp.id === 'jordan') award(d, at, opp.id);
        gainXp(d, opp.xp, at);
      } else if (result.outcome === 'lost') {
        setHealth(d, 1, at);
        const mins = infirmaryMinutes(d, 15 + opp.level * 5);
        d.status = { kind: 'infirmary', until: at + mins * MINUTE, reason: `beaten by ${opp.name}` };
        d.counters.duelsLost++;
        log(d, at, `${opp.name} beats you senseless. ${mins} minutes in the Infirmary.`, 'bad');
      } else {
        setHealth(d, result.playerHp, at);
        log(d, at, `You and ${opp.name} fight to a standstill.`);
      }
      return;
    }

    case 'DEPOSIT': {
      needFree(d, 'bank');
      if (d.deposit) reject('You already have a deposit running.');
      const term = CONFIG.bank.terms.find(t => t.days === a.days) ?? reject('No such term.');
      if (!Number.isInteger(a.amount) || a.amount < CONFIG.bank.minDeposit) reject(`At least ${CONFIG.bank.minDeposit} gr.`);
      if (a.amount > d.groats) reject('Not enough groats.');
      d.groats -= a.amount;
      d.deposit = { amount: a.amount, pct: term.pct, matures: at + term.days * DAY };
      log(d, at, `Deposited ${a.amount.toLocaleString('en-GB')} gr with the Medici for ${term.days} day${term.days === 1 ? '' : 's'} at ${term.pct}%.`);
      return;
    }

    case 'BRIBE': {
      if (d.status.kind !== 'steen') reject('You are not in the Steen.');
      const cost = bribeCost(d);
      if (d.groats < cost) reject('Not enough groats for the gaoler.');
      d.groats -= cost;
      d.status = { kind: 'free' };
      log(d, at, `The gaoler finds a key for ${cost.toLocaleString('en-GB')} gr.`);
      return;
    }
  }
}

/** Why an action would be rejected, or null if it would be accepted. For the UI's disabled states. */
export function whyIllegal(s: GameState, a: GameAction): string | null {
  const at = Math.max(a.at, s.clock);
  const d = clone(s);
  advanceDraft(d, at);
  try {
    applyVerb(d, a, at);
    return null;
  } catch (e) {
    if (e instanceof Illegal) return e.message;
    throw e;
  }
}

export function processAction(s: GameState, a: GameAction): GameState {
  const at = Math.max(a.at, s.clock);
  const d = clone(s);
  const advanced = advanceDraft(d, at);
  if (a.type === 'TICK') {
    if (!advanced) return s;
    moneyHonours(d, at);
    return d;
  }
  try {
    applyVerb(d, a, at);
  } catch (e) {
    if (e instanceof Illegal) return s;
    throw e;
  }
  moneyHonours(d, at);
  d.clock = at;
  return d;
}
