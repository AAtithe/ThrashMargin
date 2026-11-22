/**
 * The after-action review, part two: reading the history (fireline-round7-review.md).
 *
 * turningPoints reads a battle's history (src/sim/history.ts) and finds the moments that decided
 * it, each phrased in plain words with its time, its cause where the events show one, and one line
 * on what a stronger commander would have done. A short headline says who led at each stage.
 *
 * Pure: no clock, no dice, nothing read but its arguments. The review is always told from side 0's
 * seat ("you"); an ally is neither for nor against, and "the enemy" at any moment is the enemy side
 * leading on the measure in question.
 */
import { BUILDINGS, POWERS, SITES, TICKS_PER_SECOND, UNITS, UPGRADES, type BuildingKind } from './rules';
import { HISTORY_CATS, decodeHistory, type DecodedHistory, type HistoryEvent, type SideSeries } from './history';
import type { BattleHistory, GameState } from './types';

export interface ReviewContext {
  /** Each side's name; side 0 is "you" whatever its name. */
  names: string[];
  /** Each side's team (s.teams). */
  teams: number[];
  /** The tick the battle ended, or the tick now for a review so far. */
  endTick: number;
  /** The winning side, or null while the battle goes on. */
  winner: number | null;
}

export interface Finding {
  /** Which rule found it: income, army, research, tech, float, power, raid, commander, earned. */
  rule: string;
  /** When it happened (the start of it). */
  tick: number;
  /** When it ended, for a stretch of time. */
  until?: number;
  tone: 'bad' | 'good' | 'info';
  /** A few words. */
  title: string;
  /** What happened, with the time and the cause. */
  text: string;
  /** What a stronger commander would have done. */
  advice: string;
  /** Importance; findings are listed highest first. */
  score: number;
}

export interface Review {
  headline: string;
  /** Who led on strength (army plus structures) and from when. */
  leads: { tick: number; side: number }[];
  findings: Finding[];
}

/** Most findings listed. */
export const MAX_FINDINGS = 6;

// ---- Words ---------------------------------------------------------------------------------------

/** Battle time as the clock shows it: "22:30", minutes past sixty kept as minutes ("85:00"). */
export function clockOf(tick: number): string {
  const secs = Math.max(0, Math.floor(tick / TICKS_PER_SECOND));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

const minutes = (ticks: number): number => Math.max(1, Math.round(ticks / (60 * TICKS_PER_SECOND)));
const minutesText = (ticks: number): string => {
  const m = minutes(ticks);
  return `${m} ${m === 1 ? 'minute' : 'minutes'}`;
};
const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const ordinal = (n: number) => ORDINAL[n - 1] ?? `${n}th`;
const thousands = (n: number) => Math.round(n).toLocaleString('en-GB');

/** A kind's name: units and structures as the game names them, "The Spy" as "Spy". */
export function kindName(kind: string): string {
  if (kind === 'defences') return 'defences';
  const n = (UNITS as Record<string, { name: string } | undefined>)[kind]?.name ?? (BUILDINGS as Record<string, { name: string } | undefined>)[kind]?.name;
  if (n) return n.replace(/^The /, '');
  const u = (UPGRADES as Record<string, { name: string } | undefined>)[kind]?.name;
  if (u) return u;
  const p = (POWERS as Record<string, { name: string } | undefined>)[kind]?.name;
  if (p) return p;
  const st = (SITES as Record<string, { name: string } | undefined>)[kind]?.name;
  return st ?? kind;
}

/** Names that read the same for many: "9 Artillery". */
const UNCOUNTED = new Set(['Artillery']);

export function plural(name: string, n: number): string {
  if (n === 1 || name === 'defences') return name;
  if (UNCOUNTED.has(name) || /s$/.test(name)) return name;
  if (/man$/.test(name)) return `${name.slice(0, -3)}men`;
  if (/[^aeiou]y$/.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

const aOrAn = (name: string) => `${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}`;

// ---- Reading the series ------------------------------------------------------------------------

interface Ctx {
  d: DecodedHistory;
  c: ReviewContext;
  enemies: number[];
  n: number;
  you: SideSeries;
  name: (o: number) => string;
  possessive: (o: number) => string;
}

/** The enemy leading on `pick` at sample i, and its value. */
function topEnemy(x: Ctx, i: number, pick: (s: SideSeries) => number[]): { side: number; v: number } {
  let best = { side: x.enemies[0], v: -Infinity };
  for (const o of x.enemies) {
    const v = pick(x.d.sides[o])[i] ?? 0;
    if (v > best.v) best = { side: o, v };
  }
  return best;
}

const sum = (a: number[]) => a.reduce((p, q) => p + q, 0);
const lostAt = (s: SideSeries, i: number) => sum(HISTORY_CATS.map((_, c) => s.lost[c][i] ?? 0));
const yourEvents = (x: Ctx, kind: HistoryEvent['kind']) => x.d.events.filter(e => e.side === 0 && e.kind === kind);

// ---- The rules -----------------------------------------------------------------------------------

/**
 * Income per minute at sample i, averaged over the two minutes to it: a Hauler's trip lands in one
 * sample or the next, so a single sample swings far more than the economy does.
 */
const perMinute = (s: SideSeries, i: number, every: number) => {
  const span = Math.max(1, Math.round((2 * 60 * TICKS_PER_SECOND) / every));
  let total = 0;
  let n = 0;
  for (let k = Math.max(0, i - span + 1); k <= i; k++) {
    total += s.income[k] ?? 0;
    n++;
  }
  return (total / n) * ((60 * TICKS_PER_SECOND) / every);
};

function incomeRule(x: Ctx): Finding | null {
  const { d } = x;
  const N = d.ticks.length;
  if (N < 6) return null;
  const mine = (i: number) => perMinute(x.you, i, d.every);
  const theirs = (i: number) => {
    let best = { side: x.enemies[0], v: -1 };
    for (const o of x.enemies) {
      const v = perMinute(d.sides[o], i, d.every);
      if (v > best.v) best = { side: o, v };
    }
    return best;
  };
  let level = false;
  for (let i = 1; i < N - 2; i++) {
    const e = theirs(i);
    if (mine(i) >= e.v * 0.9) {
      level = true;
      continue;
    }
    if (!level || mine(i) >= e.v * 0.75 || e.v < 200) continue;
    // Behind by a quarter or more, and still behind for the next two samples.
    if (!(mine(i + 1) < theirs(i + 1).v && mine(i + 2) < theirs(i + 2).v)) continue;
    const t = d.ticks[i];
    let back = -1;
    for (let j = i + 1; j < N; j++)
      if (mine(j) >= theirs(j).v) {
        back = j;
        break;
      }
    const refineriesLost = yourEvents(x, 'lost').filter(ev => ev.what === 'refinery');
    const recent = refineriesLost.filter(ev => ev.tick <= t && ev.tick > t - 4 * 60 * TICKS_PER_SECOND);
    const haulers = x.d.events.filter(ev => ev.side === 0 && ev.kind === 'losses' && ev.what === 'hauler' && ev.tick <= t && ev.tick > t - 3 * 60 * TICKS_PER_SECOND);
    // (A window's costliest losses being Haulers is what counts: one Hauler outweighs five riflemen.)
    const deficit = 1 - mine(i) / Math.max(1, e.v);
    let cause = '';
    let advice = 'Build a second and third Refinery early and keep two Haulers on each; income compounds, so a lead there becomes a lead everywhere.';
    if (recent.length) {
      const loss = recent[recent.length - 1];
      const nth = refineriesLost.indexOf(loss) + 1;
      const rebuilt = yourEvents(x, 'built').find(ev => ev.what === 'refinery' && ev.tick > loss.tick);
      cause = ` after you lost your ${ordinal(nth)} Refinery at ${clockOf(loss.tick)}; ${
        rebuilt ? `it was ${minutesText(rebuilt.tick - loss.tick)} before you rebuilt` : 'you never rebuilt it'
      }`;
      advice = 'Put a turret beside every Refinery and rebuild a lost one before anything else: every minute without it is income the enemy keeps and you do not.';
    } else if (haulers.length) {
      const n = haulers.reduce((a, ev) => a + (ev.n ?? 0), 0);
      cause = ` after you lost ${n} Ore Haulers`;
      advice = 'Escort your Haulers, or mine the fields nearest home while the enemy is about; a Hauler lost is a trip lost and 1,400 credits to replace.';
    } else {
      const theirRefineries = x.d.events.filter(ev => x.enemies.includes(ev.side) && ev.kind === 'built' && ev.what === 'refinery' && ev.tick <= t).length;
      const yours = yourEvents(x, 'built').filter(ev => ev.what === 'refinery' && ev.tick <= t).length;
      if (theirRefineries > yours) cause = `: by then the enemy had built ${theirRefineries} Refineries to your ${yours}`;
    }
    const text = `Your income fell behind ${x.name(e.side)} at ${clockOf(t)}${cause}. You were earning ${thousands(mine(i))} a minute to their ${thousands(e.v)}${
      back >= 0 ? `, and did not catch up until ${clockOf(d.ticks[back])}.` : ', and never caught up.'
    }`;
    const until = back >= 0 ? d.ticks[back] : d.ticks[N - 1];
    return { rule: 'income', tick: t, until, tone: 'bad', title: 'Income fell behind', text, advice, score: 55 + deficit * 40 + Math.min(30, minutes(until - t) * 1.5) };
  }
  return null;
}

/** The share of the two armies' value that must change hands, within two minutes, to count. */
export const SWING = 0.2;
/** Army value (credits) below which a fight is too small to be a turning point. */
export const ARMY_FLOOR = 1500;

/** Advice on a fight lost to `by`. */
function counterTo(by: string): string {
  const air = (UNITS as Record<string, { category: string } | undefined>)[by]?.category === 'air';
  if (by === 'artillery' || by === 'missilecarrier' || by === 'railtank')
    return `${kindName(by)} out-ranges a column that stands still: close the distance fast with Buggies or Rocketeers, or come at it from the flank, and never trade at its range.`;
  if (air) return 'Their aircraft did the damage: build Flak Tracks and a Flak Cannon before you need them, and keep the anti-air with the army.';
  if (by === 'defences' || (BUILDINGS as Record<string, unknown>)[by])
    return 'You attacked into fixed defences: break turrets with Artillery from outside their range before the army goes in.';
  if (by === 'rocketeer' || by === 'skyhunter') return 'Rocketeers shred armour: lead with Grenadiers or Flame Tanks against massed infantry, and keep the tanks behind them.';
  return 'Fight beside your repairs and turrets, and pull a losing fight back before it costs the whole army.';
}

function armyRule(x: Ctx): Finding[] {
  const { d } = x;
  const N = d.ticks.length;
  const combined = (i: number) => (x.you.army[i] ?? 0) + topEnemy(x, i, s => s.army).v;
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, combined(i));
  // Skirmishes between a few riflemen are not turning points: both armies together must be a
  // quarter of the battle's largest, and the swing must move real money.
  const floor = Math.max(ARMY_FLOOR, peak / 4);
  // The floor applies where the swing starts; where it ends, one army may be all but gone.
  const share = (i: number, start: boolean): number | null => {
    const mine = x.you.army[i] ?? 0;
    const e = topEnemy(x, i, s => s.army).v;
    return mine + e >= (start ? floor : 1) ? mine / (mine + e) : null;
  };
  const moved = (a: number, b: number) =>
    Math.max(Math.abs((x.you.army[b] ?? 0) - (x.you.army[a] ?? 0)), Math.abs(topEnemy(x, b, s => s.army).v - topEnemy(x, a, s => s.army).v)) >= ARMY_FLOOR;
  let worst = { d: 0, a: -1, b: -1 };
  let best = { d: 0, a: -1, b: -1 };
  for (let b = 1; b < N; b++) {
    const sb = share(b, false);
    if (sb === null) continue;
    for (let k = 1; k <= 4 && b - k >= 0; k++) {
      const sa = share(b - k, true);
      if (sa === null || !moved(b - k, b)) continue;
      const delta = sb - sa;
      if (delta < worst.d) worst = { d: delta, a: b - k, b };
      if (delta > best.d) best = { d: delta, a: b - k, b };
    }
  }
  const weight = (a: number) => Math.min(1, combined(a) / Math.max(1, peak / 2));
  const out: Finding[] = [];
  const window = (a: number, b: number) => ({ from: d.ticks[a], to: d.ticks[b] });
  if (worst.d <= -SWING) {
    const { from, to } = window(worst.a, worst.b);
    const pts = Math.round(-worst.d * 100);
    const e = topEnemy(x, worst.b, s => s.army).side;
    let lost = 0;
    for (let i = worst.a + 1; i <= worst.b; i++) lost += lostAt(x.you, i);
    const heavy = d.events.filter(ev => ev.side === 0 && ev.kind === 'losses' && ev.tick > from && ev.tick <= to).sort((p, q) => (q.total ?? 0) - (p.total ?? 0))[0];
    const to_ = (by?: string) => (by === 'defences' ? 'their defences' : plural(kindName(by ?? ''), 2));
    const cause = heavy
      ? heavy.n === heavy.total
        ? `: you lost ${heavy.n} ${plural(kindName(heavy.what), heavy.n ?? 0)} to ${to_(heavy.by)}`
        : `: you lost ${lost} units, ${heavy.n} of them ${plural(kindName(heavy.what), heavy.n ?? 0)}, most to ${to_(heavy.by)}`
      : lost
        ? `: you lost ${lost} units`
        : ': they built faster than you';
    out.push({
      rule: 'army',
      tick: from,
      until: to,
      tone: 'bad',
      title: 'The army balance swung against you',
      text: `Army value swung ${pts} points to ${x.name(e)} between ${clockOf(from)} and ${clockOf(to)}, from ${Math.round(share(worst.a, true)! * 100)}% yours to ${Math.round(share(worst.b, false)! * 100)}%${cause}.`,
      advice: heavy ? counterTo(heavy.by ?? '') : counterTo(''),
      score: 40 + pts * weight(worst.a),
    });
  }
  if (best.d >= SWING) {
    const { from, to } = window(best.a, best.b);
    const pts = Math.round(best.d * 100);
    let killed = 0;
    for (let i = best.a + 1; i <= best.b; i++) killed += sum(HISTORY_CATS.map((_, c) => x.you.killed[c][i] ?? 0));
    out.push({
      rule: 'army',
      tick: from,
      until: to,
      tone: 'good',
      title: 'Your strongest fight',
      text: `Between ${clockOf(from)} and ${clockOf(to)} army value swung ${pts} points your way${killed ? `: you destroyed ${killed} enemy units and structures` : ''}.`,
      advice: 'That is the moment to press: follow a won fight straight into their Refineries and factories before they rebuild.',
      score: 20 + (pts / 2) * weight(best.a),
    });
  }
  return out;
}

function researchRule(x: Ctx): Finding | null {
  const { d, c } = x;
  const all = d.events.filter(e => e.kind === 'research');
  const theirs = (a: number, b: number) => all.filter(e => x.enemies.includes(e.side) && e.tick > a && e.tick <= b);
  if (theirs(-1, c.endTick).length < 2) return null;
  const lab = d.events.find(e => e.side === 0 && e.kind === 'built' && e.what === 'researchlab');
  const mine = all.filter(e => e.side === 0).map(e => e.tick);
  const advice = 'Keep the Research Lab working all battle: queue the next upgrade the moment one finishes. Each one is a permanent edge on every unit you own.';
  if (!lab && !mine.length) {
    const t = theirs(-1, c.endTick);
    const top = mode(t.map(e => e.side));
    return {
      rule: 'research',
      tick: t[0].tick,
      tone: 'bad',
      title: 'No research',
      text: `You never built a Research Lab. ${x.name(top)} finished ${t.filter(e => e.side === top).length} upgrades, the first at ${clockOf(t.filter(e => e.side === top)[0].tick)}.`,
      advice,
      score: 45 + t.length * 2,
    };
  }
  const start = lab ? lab.tick : mine[0];
  const marks = [start, ...mine.filter(t => t > start), c.endTick];
  let gap = { a: 0, b: 0 };
  for (let i = 1; i < marks.length; i++) if (marks[i] - marks[i - 1] > gap.b - gap.a) gap = { a: marks[i - 1], b: marks[i] };
  const len = gap.b - gap.a;
  if (len < 8 * 60 * TICKS_PER_SECOND) return null;
  const during = theirs(gap.a, gap.b);
  if (during.length < 2) return null;
  const top = mode(during.map(e => e.side));
  const ongoing = gap.b === c.endTick;
  return {
    rule: 'research',
    tick: gap.a,
    until: gap.b,
    tone: 'bad',
    title: 'Research stood idle',
    text: `You researched nothing between ${clockOf(gap.a)} and ${ongoing ? (c.winner === null ? 'now' : 'the end') : clockOf(gap.b)}, while ${x.name(top)} finished ${during.filter(e => e.side === top).length} upgrades.`,
    advice,
    score: 35 + Math.min(30, minutes(len)),
  };
}

const mode = (a: number[]): number => {
  const n = new Map<number, number>();
  for (const v of a) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0])[0][0];
};

/** Structures whose timing decides what a side can field, and what to say about being late. */
const KEY_STRUCTURES: [BuildingKind, string][] = [
  ['factory', 'Get the War Factory up straight after your second Refinery: vehicles decide the middle game.'],
  ['researchlab', 'A Research Lab early pays for itself many times over: upgrades are permanent and every unit after them carries them.'],
  ['techcentre', 'Tech up sooner: a Tech Centre unlocks the units that break a stalemate, and the side that gets there first sets the terms.'],
  ['helipad', 'Air power arrives fast and unseen: a Helipad on time forces the enemy to spend on anti-air instead of tanks.'],
  ['strikecommand', 'Strike Command brings the heaviest support powers: the earlier it stands, the more times you fire them.'],
  ['protoworks', 'Prototype Works fields tier three: plan the economy for it and it comes while it can still decide the battle.'],
];

function techRule(x: Ctx): Finding | null {
  const { d, c } = x;
  const first = (side: number, kind: string) => d.events.find(e => e.side === side && e.kind === 'built' && e.what === kind)?.tick;
  let worst: { lag: number; kind: BuildingKind; advice: string; e: number; theirs: number; mine?: number } | null = null;
  for (const [kind, advice] of KEY_STRUCTURES) {
    let e = -1;
    let theirs = Infinity;
    for (const o of x.enemies) {
      const t = first(o, kind);
      if (t !== undefined && t < theirs) {
        theirs = t;
        e = o;
      }
    }
    if (e < 0) continue;
    const mine = first(0, kind);
    // Never built counts only for the War Factory and the Research Lab: the rest are choices.
    if (mine === undefined && kind !== 'factory' && kind !== 'researchlab') continue;
    const lag = (mine ?? c.endTick) - theirs;
    if (lag >= 3 * 60 * TICKS_PER_SECOND && (!worst || lag > worst.lag)) worst = { lag, kind, advice, e, theirs, mine };
  }
  if (!worst) return null;
  const name = kindName(worst.kind);
  const text =
    worst.mine !== undefined
      ? `Your ${name} went up ${minutesText(worst.lag)} after ${x.possessive(worst.e)} (${clockOf(worst.mine)} against ${clockOf(worst.theirs)}).`
      : `${x.name(worst.e)} had ${aOrAn(name)} at ${clockOf(worst.theirs)}; you never built one.`;
  return { rule: 'tech', tick: worst.theirs, until: worst.mine, tone: 'bad', title: `A late ${name}`, text, advice: worst.advice, score: 30 + Math.min(35, minutes(worst.lag) * 3) };
}

/** Credits held over this, for two minutes or more, is money doing nothing. */
export const FLOAT_CREDITS = 3000;

function floatRule(x: Ctx): Finding | null {
  const { d } = x;
  let run = { a: -1, b: -1 };
  let a = -1;
  for (let i = 0; i <= d.ticks.length; i++) {
    const over = i < d.ticks.length && (x.you.credits[i] ?? 0) >= FLOAT_CREDITS;
    if (over && a < 0) a = i;
    if (!over && a >= 0) {
      if (i - 1 - a > run.b - run.a) run = { a, b: i - 1 };
      a = -1;
    }
  }
  if (run.a < 0 || run.b - run.a + 1 < 4) return null;
  const peak = Math.max(...x.you.credits.slice(run.a, run.b + 1));
  const from = d.ticks[run.a];
  const to = d.ticks[run.b];
  return {
    rule: 'float',
    tick: from,
    until: to,
    tone: 'bad',
    title: 'Money left in the bank',
    text: `You held more than ${thousands(FLOAT_CREDITS)} credits from ${clockOf(from)} to ${clockOf(to)}, peaking at ${thousands(peak)}.`,
    advice: 'Money in the bank fights nobody: add another factory or Barracks and keep every queue busy, or spend it on research.',
    score: 25 + Math.min(30, minutes(to - from) * 3),
  };
}

function powerRule(x: Ctx): Finding | null {
  const { d } = x;
  let run = { a: -1, b: -1 };
  let a = -1;
  for (let i = 0; i <= d.ticks.length; i++) {
    const low = i < d.ticks.length && (x.you.powerUsed[i] ?? 0) > (x.you.powerMade[i] ?? 0);
    if (low && a < 0) a = i;
    if (!low && a >= 0) {
      if (i - 1 - a > run.b - run.a) run = { a, b: i - 1 };
      a = -1;
    }
  }
  if (run.a < 0 || run.b - run.a + 1 < 2) return null;
  const from = d.ticks[run.a];
  const to = d.ticks[run.b];
  return {
    rule: 'power',
    tick: from,
    until: to,
    tone: 'bad',
    title: 'Power ran short',
    text: `Your power ran short from ${clockOf(from)} to ${clockOf(to)}: everything you built and trained in that time took longer, and powered defences fell silent.`,
    advice: 'Build a Generator ahead of each big structure, and a spare one away from the rest so a single raid cannot black you out.',
    score: 25 + Math.min(30, minutes(to - from) * 4),
  };
}

function raidRule(x: Ctx): Finding | null {
  const lost = yourEvents(x, 'lost');
  const span = 2 * 60 * TICKS_PER_SECOND;
  let best: HistoryEvent[] = [];
  for (let i = 0; i < lost.length; i++) {
    const group = lost.filter(e => e.tick >= lost[i].tick && e.tick < lost[i].tick + span);
    if (group.length > best.length) best = group;
  }
  if (best.length < 3) return null;
  const counts = new Map<string, number>();
  for (const e of best) counts.set(e.what, (counts.get(e.what) ?? 0) + 1);
  const list = [...counts.entries()].map(([k, n]) => (n === 1 ? aOrAn(kindName(k)) : `${n} ${plural(kindName(k), n)}`));
  const names = list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  const from = best[0].tick;
  const to = best[best.length - 1].tick;
  return {
    rule: 'raid',
    tick: from,
    until: to,
    tone: 'bad',
    title: 'Your base was broken into',
    text: `You lost ${best.length} structures between ${clockOf(from)} and ${clockOf(to)}: ${names}.`,
    advice: 'Keep a reserve at home and a turret on each approach; stopping a raid costs far less than rebuilding what it burns.',
    score: 35 + best.length * 5,
  };
}

function commanderRule(x: Ctx): Finding | null {
  const fell = x.d.events.filter(e => e.side === 0 && (e.kind === 'hero' || e.kind === 'general'));
  if (!fell.length) return null;
  const e = fell[0];
  const general = e.kind === 'general';
  return {
    rule: 'commander',
    tick: e.tick,
    tone: 'bad',
    title: general ? 'Your General fell' : `${kindName(e.what)} fell`,
    text: general
      ? `Your General fell at ${clockOf(e.tick)}${fell.length > 1 ? `, and ${fell.length - 1} more of your commanders after` : ''}; the doctrine ran at half strength until a replacement arrived.`
      : `${kindName(e.what)} fell at ${clockOf(e.tick)}${fell.length > 1 ? `, the first of ${fell.length} commanders you lost` : ''}.`,
    advice: general
      ? 'Keep the General one line behind the front: its aura reaches from there, and losing it halves the doctrine.'
      : 'A hero is worth an army when it is used and nothing when it is dead: send it in behind the tanks, not ahead of them.',
    score: 20 + fell.length * 4,
  };
}

function earnedRule(x: Ctx): Finding | null {
  const mine = sum(x.you.income);
  let top = { side: -1, v: 0 };
  for (const o of x.enemies) {
    const v = sum(x.d.sides[o].income);
    if (v > top.v) top = { side: o, v };
  }
  if (top.side < 0 || x.d.ticks.length < 6) return null;
  if (mine >= top.v * 1.2)
    return {
      rule: 'earned',
      tick: 0,
      tone: 'good',
      title: 'You out-earned them',
      text: `You earned ${thousands(mine)} credits over the battle to ${x.possessive(top.side)} ${thousands(top.v)}.`,
      advice: 'An economic lead only wins if it is spent: turn it into a second army before the enemy closes the gap.',
      score: 18,
    };
  if (top.v >= mine * 1.3)
    return {
      rule: 'earned',
      tick: 0,
      tone: 'bad',
      title: 'Out-earned',
      text: `${x.name(top.side)} earned ${thousands(top.v)} credits over the battle to your ${thousands(mine)}.`,
      advice: 'Expand sooner: a second ore field with its own Refinery by the tenth minute is the surest way to out-build an opponent.',
      score: 30,
    };
  return null;
}

// ---- The headline --------------------------------------------------------------------------------

function leadsOf(x: Ctx): { tick: number; side: number }[] {
  const { d } = x;
  const strength = (o: number, i: number) => (d.sides[o].army[i] ?? 0) + (d.sides[o].structures[i] ?? 0);
  const leaderAt = (i: number) => {
    let best = 0;
    for (let o = 1; o < x.n; o++) if (strength(o, i) > strength(best, i)) best = o;
    return best;
  };
  const leads: { tick: number; side: number }[] = [];
  // The opening skirmishes of riflemen are not a lead: the reading starts at three minutes.
  const from = d.ticks.findIndex(t => t >= 3 * 60 * TICKS_PER_SECOND);
  for (let i = Math.max(0, from); i < d.ticks.length; i++) {
    const l = leaderAt(i);
    if (leads.length && leads[leads.length - 1].side === l) continue;
    // A lead counts once it holds for three samples, a minute and a half (or to the last sample).
    if (leads.length && [1, 2].some(k => i + k < d.ticks.length && leaderAt(i + k) !== l)) continue;
    leads.push({ tick: leads.length ? d.ticks[i] : 0, side: l });
  }
  return leads;
}

function headlineOf(x: Ctx, leads: { tick: number; side: number }[]): string {
  if (!leads.length) return 'The battle was too short to read.';
  const Who = (o: number) => (o === 0 ? 'You' : x.name(o));
  const who = (o: number) => (o === 0 ? 'you' : x.name(o));
  const going = x.c.winner === null;
  const kept = going ? 'still leads' : 'held it to the end';
  const keptYou = going ? 'still lead' : 'held it to the end';
  const holds = (o: number) => (o === 0 ? keptYou : kept);
  const first = leads[0];
  const last = leads[leads.length - 1];
  let s: string;
  if (leads.length === 1) s = `${Who(first.side)} led on army and structures from the start and ${holds(first.side)}.`;
  else if (leads.length === 2) s = `${Who(first.side)} led on army and structures until ${clockOf(last.tick)}, when ${who(last.side)} took the lead and ${holds(last.side)}.`;
  else
    s = `${Who(first.side)} led on army and structures until ${clockOf(leads[1].tick)}. The lead changed hands ${leads.length - 1} times; from ${clockOf(last.tick)} ${who(last.side)} ${holds(last.side)}.`;
  const { winner } = x.c;
  if (winner !== null) {
    const ours = x.c.teams[winner] === x.c.teams[0];
    s += ours ? (winner === 0 ? ' You won.' : ` Your side won, with ${x.name(winner)}.`) : ` ${x.name(winner)} won.`;
  }
  return s;
}

// ---- Entry points --------------------------------------------------------------------------------

/**
 * The review of a history: a headline and the turning points, most important first (at most
 * MAX_FINDINGS). Accepts the history itself or its decoded form.
 */
export function turningPoints(h: BattleHistory | DecodedHistory, c: ReviewContext): Review {
  const d = 'ev' in h ? decodeHistory(h) : h;
  if (!d || !d.ticks.length) return { headline: 'Nothing has been recorded yet: the first sample is taken at 0:30.', leads: [], findings: [] };
  const n = d.sides.length;
  const enemies = Array.from({ length: n }, (_, o) => o).filter(o => c.teams[o] !== c.teams[0]);
  if (!enemies.length) return { headline: 'There is no enemy to compare with.', leads: [], findings: [] };
  const name = (o: number) => (o === 0 ? 'you' : (c.names[o] ?? `Side ${o}`));
  const x: Ctx = { d, c, enemies, n, you: d.sides[0], name, possessive: o => (o === 0 ? 'yours' : `${name(o)}'s`) };
  const leads = leadsOf(x);
  const findings = [incomeRule(x), ...armyRule(x), researchRule(x), techRule(x), floatRule(x), powerRule(x), raidRule(x), commanderRule(x), earnedRule(x)]
    .filter((f): f is Finding => !!f)
    .sort((a, b) => b.score - a.score || a.tick - b.tick)
    .slice(0, MAX_FINDINGS);
  return { headline: headlineOf(x, leads), leads, findings };
}

/** The context a battle gives its review. */
export function reviewContext(s: GameState): ReviewContext {
  return { names: s.players.map(p => p.name), teams: s.teams.slice(), endTick: s.tick, winner: s.winner };
}

/** A battle's history (with the battle so far) and its review, or null when it kept none. */
export function reviewOf(s: GameState): { data: DecodedHistory; review: Review } | null {
  if (!s.history) return null;
  const data = decodeHistory(s.history, s);
  if (!data) return null;
  return { data, review: turningPoints(data, reviewContext(s)) };
}

/** The turning points as short lines (a few hundred bytes), for the planet's journal. */
export function reviewLines(r: Review, max = 3, chars = 140): string[] {
  return r.findings.slice(0, max).map(f => (f.text.length > chars ? `${f.text.slice(0, chars - 1).trimEnd()}…` : f.text));
}
