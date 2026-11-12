/**
 * War for the Planet: the balance ladder (fireline-planet-design.md, section 18.1).
 *
 * Plays whole wars from newPlanetState: every computer faction is driven by planAiActions inside
 * End turn, the player seat by planAiActions(s, 0, 'expansionist') (the drive-planet bot), and
 * every battle is auto-resolved. It reads the state and the journal entries each step adds, and
 * changes no rule. Not part of npm run check.
 *
 *   npm run ladder:planet                                  every preset at the target seed counts
 *   npm run ladder:planet -- --preset short                one preset (short, long, veryLong or all)
 *   npm run ladder:planet -- --seeds 40                    seeds per difficulty (overrides the defaults)
 *   npm run ladder:planet -- --difficulty hard             one difficulty (easy, normal, hard or all)
 *   npm run ladder:planet -- --json                        the summary as JSON instead of the table
 *   npm run ladder:planet -- --strict                      exit 1 when any target fails
 *   npm run ladder:planet -- --prefix holdout              another seed set (default 'ladder'), to check
 *                                                          the targets on seeds they were not tuned on
 *
 * Seeds: Short 150 per difficulty, Long 50, Very long 50 (section 18.1 says why).
 *
 * The journal is capped at 40 entries and one End turn can add more than that, so each step is
 * applied to the state with an empty journal and the real journal is rebuilt by appending the new
 * entries and keeping the last 40, which is exactly what note() does. Nothing in src/planet/ reads
 * the journal; the determinism target replays wars without this and compares the final states.
 */
import { performance } from 'node:perf_hooks';
import { planAiActions } from '../src/planet/ai';
import { JOURNAL_MAX, LENGTH_PRESETS } from '../src/planet/rules';
import { atWar, newPlanetState } from '../src/planet/state';
import { applyPlanetAction, type PlanetAction } from '../src/planet/turn';
import type { JournalEntry, LengthPreset, PlanetState, TreatyKind } from '../src/planet/types';
import type { Difficulty } from '../src/sim/rules';

const CREATED = 1767225600000;
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
const DEFAULT_SEEDS: Record<LengthPreset, number> = { short: 150, long: 50, veryLong: 50 };
const REPLAYS = 3;

// ---- Flags -----------------------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);
const presetArg = flag('preset') ?? 'all';
const diffArg = flag('difficulty') ?? 'all';
const seedsArg = flag('seeds');
const prefix = flag('prefix') ?? 'ladder';
if (presetArg !== 'all' && !(LENGTH_PRESETS as string[]).includes(presetArg)) throw new Error(`--preset ${presetArg}: short, long, veryLong or all`);
if (diffArg !== 'all' && !(DIFFS as string[]).includes(diffArg)) throw new Error(`--difficulty ${diffArg}: easy, normal, hard or all`);
if (seedsArg !== undefined && !(Number(seedsArg) >= 1)) throw new Error(`--seeds ${seedsArg}: a whole number of at least 1`);
const presets: LengthPreset[] = presetArg === 'all' ? LENGTH_PRESETS : [presetArg as LengthPreset];
const diffs: Difficulty[] = diffArg === 'all' ? DIFFS : [diffArg as Difficulty];
const asJson = has('json');

// ---- One war -----------------------------------------------------------------------------------------

const KIND_OF: Record<string, TreatyKind> = { ceasefire: 'ceasefire', 'trade pact': 'trade', alliance: 'alliance' };
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface WarStats {
  seed: string;
  preset: LengthPreset;
  difficulty: Difficulty;
  how: string;
  won: boolean;
  turn: number;
  limit: number;
  ended: boolean;
  battles: number;
  factionBattles: number;
  defence: number;
  factionTurns: number;
  pairs: number;
  pairsAtWar: number;
  pairsFought: number;
  signed: Record<TreatyKind, number>;
  broken: number;
  /** Treaties broken by a computer faction (the player seat's bot left out). */
  aiBroken: number;
  breaches: number;
  breachesBy: Record<string, number>;
  expired: number;
  unpaid: number;
  eliminations: number;
  trust: number[];
  final: string;
}

function newWar(seed: string, preset: LengthPreset, difficulty: Difficulty): PlanetState {
  return newPlanetState({ seedText: seed, preset, difficulty, commander: 'Ladder', createdAt: CREATED });
}

/** The same war with no journal tricks: the reference for the determinism target. */
function plainWar(seed: string, preset: LengthPreset, difficulty: Difficulty): string {
  let s = newWar(seed, preset, difficulty);
  const resolve = () => {
    while (s.pending.length) {
      const n = applyPlanetAction(s, { type: 'autoResolve' });
      if (n === s) return;
      s = n;
    }
  };
  for (let guard = 0; guard < s.options.turnLimit + 2 && !s.result; guard++) {
    resolve();
    if (s.result) break;
    for (const a of planAiActions(s, 0, 'expansionist')) {
      s = applyPlanetAction(s, a);
      resolve();
    }
    const n = applyPlanetAction(s, { type: 'endTurn' });
    if (n === s) break;
    s = n;
  }
  resolve();
  return JSON.stringify(s);
}

function playWar(seed: string, preset: LengthPreset, difficulty: Difficulty): WarStats {
  let s = newWar(seed, preset, difficulty);
  const names = s.factions.map(f => f.name);
  const idOf = new Map(names.map((n, i) => [n, i]));
  const N = `(${names.map(esc).join('|')})`;
  const K = '(ceasefire|trade pact|alliance)';
  const RX = {
    takes: new RegExp(`^${N} takes .+ from (the independents|${names.map(esc).join('|')})( after a retreat| \\(auto-resolved\\)| \\(simulated\\))?\\.$`),
    holds: new RegExp(`^(The independents|${names.map(esc).join('|')}) holds? .+ against ${N}( after a retreat| \\(auto-resolved\\)| \\(simulated\\))?\\.$`),
    sign: new RegExp(`^${N} and ${N} sign an? ${K}, `),
    declare: new RegExp(`^${N} declares war on ${N}(, breaking their ${K})?\\.$`),
    cancel: new RegExp(`^${N} cancels its ${K} with ${N}(, breaking its word)?\\.$`),
    expire: new RegExp(`^The ${K} between ${N} and ${N} runs out\\.`),
    unpaid: /cannot meet its terms; the /,
    wiped: / is wiped from the map\.$/,
  };
  const ai = s.factions.filter(f => f.id !== 0).map(f => f.id);
  const pairKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
  const pairs: string[] = [];
  for (let i = 0; i < ai.length; i++) for (let j = i + 1; j < ai.length; j++) pairs.push(pairKey(ai[i], ai[j]));
  const atWarPairs = new Set<string>();
  const foughtPairs = new Set<string>();
  const st: WarStats = {
    seed,
    preset,
    difficulty,
    how: '',
    won: false,
    turn: 0,
    limit: s.options.turnLimit,
    ended: false,
    battles: 0,
    factionBattles: 0,
    defence: 0,
    factionTurns: 0,
    pairs: pairs.length,
    pairsAtWar: 0,
    pairsFought: 0,
    signed: { ceasefire: 0, trade: 0, alliance: 0 },
    broken: 0,
    aiBroken: 0,
    breaches: 0,
    breachesBy: {},
    expired: 0,
    unpaid: 0,
    eliminations: 0,
    trust: [],
    final: '',
  };
  const truce = s.options.openingTruce;

  const read = (entries: JournalEntry[]) => {
    for (const e of entries) {
      const t = e.text;
      let m: RegExpExecArray | null;
      if ((m = RX.takes.exec(t)) || (m = RX.holds.exec(t))) {
        const takes = t.includes(' takes ');
        const atk = idOf.get(takes ? m[1] : m[2])!;
        const defName = takes ? m[2] : m[1];
        st.battles++;
        if (defName !== 'the independents' && defName !== 'The independents') {
          st.factionBattles++;
          const def = idOf.get(defName)!;
          if (atk !== 0 && def !== 0) foughtPairs.add(pairKey(atk, def));
        }
      } else if ((m = RX.sign.exec(t))) {
        st.signed[KIND_OF[m[3]]]++;
      } else if ((m = RX.declare.exec(t))) {
        st.broken++;
        if (idOf.get(m[1]) !== 0) st.aiBroken++;
        if (m[3]) {
          st.breaches++;
          const by = s.factions[idOf.get(m[1])!].temperament ?? 'player';
          st.breachesBy[by] = (st.breachesBy[by] ?? 0) + 1;
        }
      } else if ((m = RX.cancel.exec(t))) {
        st.broken++;
        if (idOf.get(m[1]) !== 0) st.aiBroken++;
        if (m[4]) {
          st.breaches++;
          const by = s.factions[idOf.get(m[1])!].temperament ?? 'player';
          st.breachesBy[by] = (st.breachesBy[by] ?? 0) + 1;
        }
      } else if ((m = RX.expire.exec(t))) {
        // The opening truce runs out at the end of turn openingTruce; no later ceasefire can end then.
        if (!(m[1] === 'ceasefire' && e.turn === truce)) st.expired++;
      } else if (RX.unpaid.test(t)) st.unpaid++;
      else if (RX.wiped.test(t)) st.eliminations++;
    }
  };

  /** Applies one action with an empty journal, reads the new entries, rebuilds the journal. */
  const step = (a: PlanetAction): boolean => {
    const old = s.journal;
    const probe = { ...s, journal: [] as JournalEntry[] };
    const n = applyPlanetAction(probe, a);
    if (n === probe) return false;
    read(n.journal);
    const journal = [...old, ...n.journal];
    if (journal.length > JOURNAL_MAX) journal.splice(0, journal.length - JOURNAL_MAX);
    s = { ...n, journal };
    return true;
  };
  const resolve = () => {
    while (s.pending.length) {
      if (s.pending[0].kind === 'defence') st.defence++;
      if (!step({ type: 'autoResolve' })) return;
    }
  };

  for (let guard = 0; guard < s.options.turnLimit + 2 && !s.result; guard++) {
    resolve();
    if (s.result) break;
    for (const a of planAiActions(s, 0, 'expansionist')) {
      step(a);
      resolve();
    }
    st.factionTurns += s.factions.filter(f => f.alive).length;
    if (!step({ type: 'endTurn' })) break;
    if (s.turn > truce) for (const k of pairs) {
      const [a, b] = k.split('-').map(Number);
      if (s.factions[a].alive && s.factions[b].alive && atWar(s, a, b)) atWarPairs.add(k);
    }
  }
  resolve();
  st.pairsAtWar = atWarPairs.size;
  st.pairsFought = foughtPairs.size;
  st.ended = s.result !== null && s.result.turn <= s.options.turnLimit && s.turn <= s.options.turnLimit;
  st.how = s.result?.how ?? 'none';
  st.won = !!s.result?.won;
  st.turn = s.result?.turn ?? s.turn;
  const alive = s.factions.filter(f => f.alive).map(f => f.id);
  for (const a of alive) for (const b of alive) if (a !== b) st.trust.push(s.trust[a][b]);
  st.final = JSON.stringify(s);
  return st;
}

// ---- Summaries and targets ----------------------------------------------------------------------

const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
const pct = (n: number, d: number) => (d ? (100 * n) / d : 0);
function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const a = [...xs].sort((p, r) => p - r);
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1) + 0.5)))];
}

interface Target {
  id: string;
  name: string;
  value: string;
  goal: string;
  pass: boolean | null; // null: reported only
}

type Bound = { min?: number; max?: number };
const B: Record<LengthPreset, Record<string, Bound>> = {
  short: { T1: { min: 70 }, T2: { min: 0.2, max: 0.8 }, T3: { min: 40 }, T4: { min: 1 }, T5: { min: 60 }, T6: { min: 40 }, T7: { min: 1, max: 12 }, T8: { min: 25 }, T9: { min: 15, max: 75 }, T10: { max: 2 }, T11: { min: 0.3 }, T13: { min: 25, max: 85 }, T15: { min: 20, max: 60 } },
  long: { T1: { min: 65 }, T2: { min: 0.2, max: 0.8 }, T3: { min: 40 }, T4: { min: 2 }, T5: { min: 60 }, T6: { min: 50 }, T7: { min: 2, max: 25 }, T8: { min: 30 }, T9: { min: 20, max: 85 }, T10: { max: 4 }, T11: { min: 0.5 }, T13: { min: 25, max: 85 }, T15: { min: 15 } },
  veryLong: { T1: { min: 60 }, T2: { min: 0.2, max: 0.8 }, T3: { min: 40 }, T4: { min: 3 }, T5: { min: 60 }, T6: { min: 50 }, T7: { min: 3, max: 40 }, T8: { min: 30 }, T9: { min: 20, max: 90 }, T10: { max: 6 }, T11: { min: 0.5 }, T13: { min: 25, max: 85 }, T15: { min: 8 } },
};
const within = (v: number, b: Bound) => (b.min === undefined || v >= b.min) && (b.max === undefined || v <= b.max);
const goalText = (b: Bound, unit = '') =>
  b.min !== undefined && b.max !== undefined ? `${b.min}${unit} to ${b.max}${unit}` : b.min !== undefined ? `>= ${b.min}${unit}` : `<= ${b.max}${unit}`;

function targets(preset: LengthPreset, wars: WarStats[], replayOk: boolean | null): Target[] {
  const b = B[preset];
  const out: Target[] = [];
  const add = (id: string, name: string, v: number, digits: number, unit = '') => {
    const bound = b[id];
    out.push({ id, name, value: `${v.toFixed(digits)}${unit}`, goal: bound ? goalText(bound, unit) : '-', pass: bound ? within(Number(v.toFixed(digits)), bound) : null });
  };
  const n = wars.length;
  add('T1', 'Decisive endings, share of wars', pct(wars.filter(w => w.how !== 'turnLimit' && w.how !== 'none').length, n), 1, '%');
  add('T2', 'Battles per faction-turn', sum(wars.map(w => w.battles)) / Math.max(1, sum(wars.map(w => w.factionTurns))), 3);
  add('T3', 'Faction battles, share of battles', pct(sum(wars.map(w => w.factionBattles)), sum(wars.map(w => w.battles))), 1, '%');
  add('T4', 'Defence battles per war', mean(wars.map(w => w.defence)), 2);
  add('T5', 'Pairs at war after the truce', pct(sum(wars.map(w => w.pairsAtWar)), sum(wars.map(w => w.pairs))), 1, '%');
  add('T6', 'Pairs that fought each other', pct(sum(wars.map(w => w.pairsFought)), sum(wars.map(w => w.pairs))), 1, '%');
  add('T7', 'Treaties signed per war', mean(wars.map(w => w.signed.ceasefire + w.signed.trade + w.signed.alliance)), 2);
  add('T8', 'Wars with an alliance signed', pct(wars.filter(w => w.signed.alliance > 0).length, n), 1, '%');
  // T9 and T10 count the computer factions' breaks only: the player seat's bot is expansionist and
  // breaks treaties itself, and its breaks say nothing about the computer diplomacy. The counts with
  // the bot are reported beside them.
  add('T9', 'Wars with a treaty broken by a computer', pct(wars.filter(w => w.aiBroken > 0).length, n), 1, '%');
  add('T9b', 'Wars with a treaty broken, bot included', pct(wars.filter(w => w.broken > 0).length, n), 1, '%');
  add('T10', 'Treaties broken by computers per war', mean(wars.map(w => w.aiBroken)), 2);
  add('T10b', 'Treaties broken per war, bot included', mean(wars.map(w => w.broken)), 2);
  add('T11', 'Treaties expired per war', mean(wars.map(w => w.expired)), 2);
  const trust = wars.flatMap(w => w.trust);
  const p10 = quantile(trust, 0.1);
  const p90 = quantile(trust, 0.9);
  const clamped = pct(trust.filter(t => t === 0 || t === 100).length, trust.length);
  out.push({ id: 'T12', name: 'End trust p10 / p90 / at 0 or 100', value: `${p10} / ${p90} / ${clamped.toFixed(1)}%`, goal: '<= 40 / >= 65 / <= 50%', pass: p10 <= 40 && p90 >= 65 && clamped <= 50 });
  const lim = wars[0]?.limit ?? 1;
  const med = quantile(wars.map(w => w.turn), 0.5);
  add('T13', `Median length (turns ${med} of ${lim})`, pct(med, lim), 1, '%');
  const rate = (d: Difficulty) => {
    const ws = wars.filter(w => w.difficulty === d);
    return ws.length ? pct(ws.filter(w => w.won).length, ws.length) : NaN;
  };
  const [e, nm, h] = DIFFS.map(rate);
  const ordered = e > nm && nm > h && e - h >= 10;
  const allThree = DIFFS.every(d => wars.some(w => w.difficulty === d));
  out.push({
    id: 'T14',
    name: 'Bot win rate easy / normal / hard',
    value: DIFFS.map(rate).map(x => (Number.isNaN(x) ? '-' : `${x.toFixed(1)}%`)).join(' / '),
    goal: 'E > N > H, E - H >= 10',
    pass: preset === 'short' && allThree ? ordered : null,
  });
  if (!Number.isNaN(nm)) add('T15', 'Bot win rate on normal', nm, 1, '%');
  out.push({ id: 'T16', name: 'Wars ended within the limit', value: `${wars.filter(w => w.ended).length} of ${n}`, goal: 'all', pass: wars.every(w => w.ended) });
  out.push({ id: 'T17', name: 'Replays byte-identical', value: replayOk === null ? 'not run' : replayOk ? 'yes' : 'NO', goal: 'yes', pass: replayOk });
  return out;
}

function extras(wars: WarStats[]) {
  const how: Record<string, number> = {};
  for (const w of wars) how[w.how] = (how[w.how] ?? 0) + 1;
  const breachesBy: Record<string, number> = {};
  for (const w of wars) for (const [k, v] of Object.entries(w.breachesBy)) breachesBy[k] = (breachesBy[k] ?? 0) + v;
  return {
    wars: wars.length,
    endings: how,
    battlesPerWar: Number(mean(wars.map(w => w.battles)).toFixed(2)),
    eliminationsPerWar: Number(mean(wars.map(w => w.eliminations)).toFixed(2)),
    signedPerWar: {
      ceasefire: Number(mean(wars.map(w => w.signed.ceasefire)).toFixed(2)),
      trade: Number(mean(wars.map(w => w.signed.trade)).toFixed(2)),
      alliance: Number(mean(wars.map(w => w.signed.alliance)).toFixed(2)),
    },
    breaches: sum(wars.map(w => w.breaches)),
    breachesBy,
    unpaid: sum(wars.map(w => w.unpaid)),
    meanTurns: Number(mean(wars.map(w => w.turn)).toFixed(1)),
  };
}

// ---- Run -----------------------------------------------------------------------------------------

const report: Record<string, unknown> = {};
let anyFail = false;
const t0 = performance.now();
for (const preset of presets) {
  const seeds = seedsArg ? Math.floor(Number(seedsArg)) : DEFAULT_SEEDS[preset];
  const p0 = performance.now();
  const wars: WarStats[] = [];
  let replayOk: boolean | null = null;
  for (const d of diffs) {
    for (let i = 0; i < seeds; i++) {
      const w = playWar(`${prefix}-${preset}-${i}`, preset, d);
      wars.push(w);
      if (i < REPLAYS) {
        const again = plainWar(w.seed, preset, d);
        replayOk = (replayOk ?? true) && again === w.final;
      }
    }
  }
  const secs = (performance.now() - p0) / 1000;
  const ts = targets(preset, wars, replayOk);
  const ex = extras(wars);
  const byDiff = Object.fromEntries(diffs.map(d => [d, extras(wars.filter(w => w.difficulty === d))]));
  if (ts.some(t => t.pass === false)) anyFail = true;
  report[preset] = { seedsPerDifficulty: seeds, difficulties: diffs, seconds: Number(secs.toFixed(1)), targets: ts, ...ex, byDifficulty: byDiff };
  if (!asJson) {
    console.log(`\n${preset}: ${seeds} seeds x ${diffs.join(', ')} = ${wars.length} wars in ${secs.toFixed(1)} s`);
    console.log(`  endings: ${Object.entries(ex.endings).map(([k, v]) => `${k} ${v}`).join(', ')}; mean ${ex.meanTurns} turns`);
    console.log(`  battles ${ex.battlesPerWar} per war, eliminations ${ex.eliminationsPerWar} per war`);
    console.log(`  signed per war: ceasefire ${ex.signedPerWar.ceasefire}, trade ${ex.signedPerWar.trade}, alliance ${ex.signedPerWar.alliance}; breaches ${ex.breaches} (${Object.entries(ex.breachesBy).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}); unpaid ${ex.unpaid}`);
    for (const d of diffs) {
      const x = byDiff[d];
      console.log(`  ${d}: ${Object.entries(x.endings).map(([k, v]) => `${k} ${v}`).join(', ')}; mean ${x.meanTurns} turns`);
    }
    const w1 = Math.max(...ts.map(t => t.name.length));
    const w2 = Math.max(...ts.map(t => t.value.length));
    const w3 = Math.max(...ts.map(t => t.goal.length));
    for (const t of ts) {
      const mark = t.pass === null ? 'info' : t.pass ? 'PASS' : 'FAIL';
      console.log(`  ${t.id.padEnd(4)} ${t.name.padEnd(w1)}  ${t.value.padStart(w2)}  ${t.goal.padEnd(w3)}  ${mark}`);
    }
  }
}
const total = (performance.now() - t0) / 1000;
if (asJson) console.log(JSON.stringify({ seconds: Number(total.toFixed(1)), ...report }, null, 2));
else console.log(`\n${anyFail ? 'Some targets fail' : 'Every target passes'}; ${total.toFixed(1)} s in all.`);
if (anyFail && has('strict')) process.exit(1);
