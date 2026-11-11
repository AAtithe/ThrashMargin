/**
 * Game size and paced research (fireline-round6-design.md, section 9.1): the harness sections.
 * Quick must be the game before round 6 to the byte; the larger sizes scale research price and time
 * in development lines only, scale the commander's attack timing at any tech, and give the
 * commander its paced research list. Imported by drive.ts, so its assertions count in the main
 * totals. About 3 to 4 minutes on one core: the thirty pre-round-6 battles, eighteen Long battles
 * for the commander's lists and nine Epic battles for the tick cap are most of it.
 */
import { createHash } from 'node:crypto';
import { MISSIONS } from '../src/campaign/missions';
import { ACT_TWO } from '../src/campaign/act2';
import { processAction } from '../src/sim/actions';
import { setAutopilotAi } from '../src/sim/ai';
import { occupancy } from '../src/sim/grid';
import { createMissionState } from '../src/sim/mission';
import { hasUpgrade, researchCostOf, researchTicksOf } from '../src/sim/research';
import {
  DEFAULT_SETUP,
  DIFFICULTIES,
  GAME_PACES,
  GAME_PACE_ORDER,
  LEGACY_SETUP,
  LINES,
  LOBBY_DEFAULT_PACE,
  RESEARCH_COST_STEP,
  SETUP_CREDIT_CHOICES,
  UNITS,
  UPGRADES,
  UPGRADE_LINE,
  applyPace,
  difficultyForPace,
  isClassicUpgrade,
  isPresetSetup,
  MAP_SIZES,
  researchPaceText,
  type BuildingKind,
  type Difficulty,
  type GamePace,
  type Owner,
  type ResearchMode,
  type SkirmishSetup,
  type UpgradeId,
} from '../src/sim/rules';
import { addBuilding, createInitialState, migrateState, normaliseSetup, pacedResearch, powerOf, researchModeOf, paceOf } from '../src/sim/state';
import type { GameState, MissionContext, Unit } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
const ALL_UPGRADES = Object.keys(UPGRADES) as UpgradeId[];
const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

/** `--deep` runs the full sweeps (npm run drive:fire -- --deep); without it, npm run check runs a
 * lighter sample of each so the CI job stays inside its time limit. The 150-seed ladder measures depth. */
const DEEP = process.argv.includes('--deep');

/** Runs n ticks, in actions of at most 500. */
function tick(s: GameState, n = 1): GameState {
  for (let left = n; left > 0; left -= 500) s = processAction(s, { type: 'tick', n: Math.min(500, left) });
  return s;
}
/** Autopilots in 50-tick steps until a winner or the tick given, calling `each` after every step. */
function play(s: GameState, until: number, each?: (s: GameState) => void): GameState {
  while (s.winner === null && s.tick < until) {
    s = processAction(s, { type: 'tick', n: 50 });
    if (each) each(s);
  }
  return s;
}
/**
 * The hash a pre-round-6 state is compared by: sha256 of its JSON, first 16 hex characters, with
 * the setup's string `pace` key left out (the one key a quick state gains in round 6), and the
 * setup's `size` (map size) and boolean `sites` keys that the merge with main added.
 */
const strip = (k: string, v: unknown) =>
  (k === 'pace' || k === 'size') && typeof v === 'string' ? undefined : k === 'sites' && typeof v === 'boolean' ? undefined : v;
const hashOf = (s: GameState) => createHash('sha256').update(JSON.stringify(s, strip)).digest('hex').slice(0, 16);

const PERKS0 = { harvestMul: 1, buildSpeedMul: 1, costMul: 1, unitHpMul: 1, powerCooldownMul: 1, extraStartCredits: 0 };
const mctx = (id: string): MissionContext => ({ id, name: 'Mission', createdAt: 0, perks: { ...PERKS0 }, heroes: {}, extraTech: [], extraPowers: [] });

/** Side 1's commander switched off: these sections test the rules, not the commander. */
function quietCommander(fn: (ok: Ok) => void): (ok: Ok) => void {
  return ok => {
    setAutopilotAi(() => {}, 1);
    try {
      fn(ok);
    } finally {
      setAutopilotAi(null, 1);
    }
  };
}

/**
 * An advanced skirmish on open plains, everyone's units gone and nothing attacking, side 0 given a
 * Research Lab, a Tech Centre, a Refinery, a War Factory and power.
 */
function lab(seed: string, research: ResearchMode, size: GamePace | undefined, tech: SkirmishSetup['tech'] = 'advanced'): GameState {
  const setup: Partial<SkirmishSetup> = { map: 'plains', tech, credits: 20000, research, ...(size ? { pace: size } : {}) };
  const s = copy(createInitialState(seed, seed, { seed, createdAt: 0, setup }));
  s.units = [];
  for (const m of s.ai) m.nextAttack = 1e9;
  const occ = occupancy(s);
  const cx = Math.floor(s.mapW / 2);
  const cy = Math.floor(s.mapH / 2);
  const tiles = s.tiles.split('');
  for (let y = cy - 8; y <= cy + 8; y++)
    for (let x = cx - 8; x <= cx + 8; x++) {
      const k = y * s.mapW + x;
      if (occ[k]) throw new Error('a structure in the middle of the size arena');
      tiles[k] = 'g';
      s.ore[k] = 0;
    }
  s.tiles = tiles.join('');
  addBuilding(s, 0, 'researchlab', cx - 6, cy - 6, -100);
  const kinds: BuildingKind[] = ['techcentre', 'refinery', 'factory', 'power', 'power', 'power'];
  kinds.forEach((k, i) => addBuilding(s, 0, k, 1 + i * 4, 1, -100));
  return s;
}

/** The lab with everything an upgrade needs already done: its line's earlier marks, and its doctrine for a Mk III. */
function readyFor(s: GameState, id: UpgradeId): GameState {
  const t = copy(s);
  const { line, mark } = UPGRADE_LINE[id];
  const p = t.players[0];
  p.upgrades = LINES[line].marks.slice(0, Math.min(mark - 1, 2));
  if (mark === 3) p.doctrines = { [line]: id };
  return t;
}

/** Section 5.1's paced lists, as built (the build log's tuned Normal and Hard lists). */
const AI_PACED: Record<Difficulty, UpgradeId[]> = {
  easy: ['refining', 'plating', 'refining2', 'plating2'],
  normal: ['refining', 'engines', 'engines2', 'fieldrepair', 'refining2', 'plating', 'plating2', 'reactive', 'calibration', 'autoloaders', 'airframes'],
  hard: ['refining', 'engines', 'engines2', 'fieldrepair', 'refining2', 'calibration', 'autoloaders', 'heat', 'plating', 'plating2', 'composite', 'airframes'],
};
/** Round 5's classic lists (unchanged). */
const AI_CLASSIC: Record<Difficulty, UpgradeId[]> = {
  easy: ['refining'],
  normal: ['refining', 'plating', 'calibration', 'airframes', 'engines'],
  hard: ['refining', 'calibration', 'plating', 'engines', 'airframes'],
};

/** True when `got` is `list` in order with some items left out. */
function isSubsequence(got: readonly UpgradeId[], list: readonly UpgradeId[]): boolean {
  let i = 0;
  for (const id of got) {
    while (i < list.length && list[i] !== id) i++;
    if (i >= list.length) return false;
    i++;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------

/** The field, the presets, the size table and the pure helpers. */
function rulesAndPresets(ok: Ok): void {
  const diffsBefore = JSON.stringify(DIFFICULTIES);
  ok(DEFAULT_SETUP.pace === 'quick' && LEGACY_SETUP.pace === 'quick', 'both presets are Quick');
  ok(DEFAULT_SETUP.size === 'standard' && LEGACY_SETUP.size === 'standard', 'both presets state the standard map size');
  const keys = Object.keys(normaliseSetup({}));
  ok(keys[keys.length - 1] === 'pace', 'pace is the last field of a normalised setup');
  for (const [name, preset] of [['DEFAULT_SETUP', DEFAULT_SETUP], ['LEGACY_SETUP', LEGACY_SETUP]] as const) {
    const pk = Object.keys(preset);
    ok(JSON.stringify(pk) === JSON.stringify(keys), `${name} states every setup field, in order, pace last`);
    for (const k of keys) ok((preset as unknown as Record<string, unknown>)[k] !== undefined, `${name}.${k} is stated`);
  }
  ok(JSON.stringify(normaliseSetup({})) === JSON.stringify(DEFAULT_SETUP), 'an empty setup normalises to the default, Quick included');
  ok(normaliseSetup({ pace: 'junk' as never }).pace === DEFAULT_SETUP.pace, 'a junk pace takes the base\'s');
  ok(normaliseSetup({ pace: 'junk' as never }, { ...LEGACY_SETUP, pace: 'epic' }).pace === 'epic', 'a junk pace takes the base\'s, whatever the base says');
  ok(normaliseSetup({ pace: 7 as never }).pace === 'quick' && normaliseSetup({ pace: null as never }).pace === 'quick', 'a pace that is not a string reads Quick');
  ok(normaliseSetup({ map: 'river' }, LEGACY_SETUP).pace === 'quick', 'a saved setup without a pace reads Quick');
  // A setup saved by this branch before the merge with main kept the pace as `size`.
  for (const k of ['quick', 'long', 'epic'] as const) {
    const n = normaliseSetup({ map: 'river', size: k as never }, LEGACY_SETUP);
    ok(n.pace === k && n.size === 'standard', `a pre-merge setup with size '${k}' reads as pace ${k} on a standard map`);
  }
  // 'standard' is both a pace and a map size. This branch's pre-merge setups carried `research` and
  // never `sites`; main's always carry `sites` and never `research`.
  const pre = normaliseSetup({ map: 'river', tech: 'advanced', credits: 3000, ore: 'normal', sides: 2, mode: 'ffa', research: 'lines', size: 'standard' as never }, LEGACY_SETUP);
  ok(pre.pace === 'standard' && pre.size === 'standard' && pre.research === 'lines', `a pre-merge setup with size 'standard' reads as pace Standard on a standard map (${pre.pace})`);
  ok(normaliseSetup({ map: 'river', tech: 'standard', research: 'classic', size: 'standard' as never }, LEGACY_SETUP).pace === 'standard', 'a pre-merge standard-tech setup with size \'standard\' reads as pace Standard');
  ok(normaliseSetup({ map: 'river', size: 'standard', sites: false }, LEGACY_SETUP).pace === 'quick', 'a main setup with size \'standard\' and sites reads Quick (a map size, not a pace)');
  ok(normaliseSetup({ map: 'river', size: 'standard' }, LEGACY_SETUP).pace === 'quick', 'size \'standard\' with neither research nor sites reads Quick');
  ok(normaliseSetup({ map: 'river', size: 'standard', research: 'lines', pace: 'long' }, LEGACY_SETUP).pace === 'long', 'an explicit pace wins over a pre-merge \'standard\'');
  {
    const s = tick(createInitialState('size-pre', 'size-pre', { seed: 'size-pre', difficulty: 'normal', createdAt: 0, autopilot: true, setup: { map: 'river', tech: 'advanced', research: 'lines', pace: 'standard' } }), 600);
    const old = JSON.parse(JSON.stringify(s));
    old.setup = { map: old.setup.map, tech: old.setup.tech, credits: old.setup.credits, ore: old.setup.ore, sides: old.setup.sides, mode: old.setup.mode, research: 'lines', size: 'standard' };
    const m = migrateState(old);
    ok(!!m && paceOf(m) === 'standard' && pacedResearch(m), 'a pre-merge Standard save migrates to Standard pace with paced research kept');
  }
  ok(normaliseSetup({ map: 'river', size: 'large' }, LEGACY_SETUP).pace === 'quick', 'a map size is never read as a pace');
  ok(normaliseSetup({ size: 'epic' as never, pace: 'standard' }).pace === 'standard', 'an explicit pace wins over a pre-merge size');
  ok(normaliseSetup({ tech: 'standard', pace: 'long' }).pace === 'long', 'standard tech keeps its pace (attack timing applies to any tech)');
  for (const k of GAME_PACE_ORDER) ok(normaliseSetup({ pace: k }).pace === k, `${k} survives normalising`);
  ok(LOBBY_DEFAULT_PACE === 'standard', 'the lobby offers Standard to a player who has never chosen');

  // The table.
  const tableKeys = Object.keys(GAME_PACES).sort();
  ok(GAME_PACE_ORDER.length === tableKeys.length && new Set(GAME_PACE_ORDER).size === GAME_PACE_ORDER.length && JSON.stringify([...GAME_PACE_ORDER].sort()) === JSON.stringify(tableKeys), 'GAME_PACE_ORDER lists every size once');
  ok(GAME_PACE_ORDER[0] === 'quick', 'Quick is the first card');
  const q = GAME_PACES.quick;
  ok(q.attackMul === 1 && [...q.researchCost, ...q.researchTicks].every(m => m === 1) && q.paced === false, 'Quick changes nothing: attack 1, research 1, not paced');
  ok(q.preset.credits === LEGACY_SETUP.credits && q.preset.ore === LEGACY_SETUP.ore, 'Quick\'s preset is today\'s credits and ore');
  for (const k of GAME_PACE_ORDER) {
    const g = GAME_PACES[k];
    if (k !== 'quick') ok(g.paced, `${k} is paced`);
    ok(SETUP_CREDIT_CHOICES.includes(g.preset.credits), `${k}: preset credits ${g.preset.credits} is a lobby choice`);
    ok(g.preset.ore === 'normal' || g.preset.ore === 'rich' || g.preset.ore === 'poor', `${k}: preset ore is a level (${g.preset.ore})`);
    ok(g.minutes[0] < g.minutes[1], `${k}: minutes ${g.minutes[0]} to ${g.minutes[1]}`);
    ok(g.attackMul >= 1, `${k}: attackMul ${g.attackMul} is at least 1`);
    ok([...g.researchCost, ...g.researchTicks].every(m => m > 0 && m <= 1), `${k}: every research multiplier is in (0, 1]`);
    ok(g.name.length > 0 && g.tagline.length > 0 && g.reach.length > 0, `${k}: name, tagline and reach are written`);
    ok(!/\u2014/.test(g.name + g.tagline + g.reach), `${k}: no em dash in the card copy`);
  }
  ok(researchPaceText('quick') === 'Full price and time', 'Quick\'s research line reads "Full price and time"');
  ok(researchPaceText('standard') === '50% price, 60% time', `Standard's research line reads "50% price, 60% time" (${researchPaceText('standard')})`);
  ok(GAME_PACES.quick.preset.size === 'standard' && GAME_PACES.standard.preset.size === 'standard', 'Quick and Standard play on the standard map');
  ok(GAME_PACES.long.preset.size === 'large' && GAME_PACES.epic.preset.size === 'huge', 'Long plays on a large map, Epic on a huge one');
  for (const k of GAME_PACE_ORDER) ok(MAP_SIZES.includes(GAME_PACES[k].preset.size), `${k}: preset map size is a map size`);

  // applyPace and isPresetSetup.
  const bases: SkirmishSetup[] = [DEFAULT_SETUP, LEGACY_SETUP, { ...DEFAULT_SETUP, map: 'river', sides: 3, mode: 'teams', credits: 2000, ore: 'poor', pace: 'epic', size: 'large' }];
  for (const base of bases)
    for (const k of GAME_PACE_ORDER) {
      const a = applyPace(base, k);
      const others = (x: SkirmishSetup) => JSON.stringify({ ...x, pace: 0, size: 0, credits: 0, ore: 0 });
      ok(a.pace === k && a.credits === GAME_PACES[k].preset.credits && a.ore === GAME_PACES[k].preset.ore && a.size === GAME_PACES[k].preset.size && others(a) === others(base), `applyPace(${base.map}/${base.pace}, ${k}) writes pace, credits, ore and map size only`);
      ok(isPresetSetup(a), `isPresetSetup(applyPace(${base.map}/${base.pace}, ${k}))`);
      ok(JSON.stringify(Object.keys(a)) === JSON.stringify(keys), `applyPace(${base.map}/${base.pace}, ${k}) keeps the key order`);
      const other = SETUP_CREDIT_CHOICES.find(c => c !== a.credits)!;
      ok(!isPresetSetup({ ...a, credits: other }) && !isPresetSetup({ ...a, ore: a.ore === 'rich' ? 'normal' : 'rich' }) && !isPresetSetup({ ...a, size: a.size === 'huge' ? 'standard' : 'huge' }), `${k}: other credits, ore or map size is not the preset`);
    }

  // difficultyForPace.
  for (const d of DIFFS) {
    ok(difficultyForPace(d, 'quick') === DIFFICULTIES[d], `${d}: Quick returns the DIFFICULTIES entry itself`);
    for (const k of GAME_PACE_ORDER.filter(x => x !== 'quick')) {
      const m = GAME_PACES[k].attackMul;
      const got = difficultyForPace(d, k) as unknown as Record<string, unknown>;
      const orig = DIFFICULTIES[d] as unknown as Record<string, unknown>;
      ok(got !== orig || m === 1, `${d}, ${k}: a copy, not the shared entry`);
      ok(got.firstAttack === Math.round(DIFFICULTIES[d].firstAttack * m) && got.attackInterval === Math.round(DIFFICULTIES[d].attackInterval * m), `${d}, ${k}: first attack ${got.firstAttack} and interval ${got.attackInterval} are x${m}`);
      const rest = Object.keys(orig).filter(f => f !== 'firstAttack' && f !== 'attackInterval');
      ok(Object.keys(got).length === Object.keys(orig).length && rest.every(f => got[f] === orig[f]), `${d}, ${k}: every other field unchanged`);
    }
  }
  ok(JSON.stringify(DIFFICULTIES) === diffsBefore, 'the shared DIFFICULTIES table is never written');
}

/**
 * Pre-round-6 final-state hashes (HEAD before round 6, tick 18,000 or the end, pace key stripped).
 * At the merge with main (2026-11-11) the twelve Normal and Hard advanced battles (lines, classic,
 * three) were regenerated: main's computer fields Repair Trucks on advanced tech (round 5, workstream
 * C), its first engineering decision coming at ticks 4,200 to 8,100 in these battles, and every one
 * of them first differs from the pre-merge build in the 1,000-tick snapshot right after that. The
 * classic ones equal origin/main's own battles exactly; no setup, standard tech and Easy (which
 * fields no Repair Truck in these battles) are unchanged. See fireline-design.md, the merge's entry.
 */
const PRE_ROUND6: Record<string, string> = {
  'nosetup|easy|size-a': '3425e6edb280df2e',
  'nosetup|easy|size-b': 'd79837ed09c9f522',
  'nosetup|normal|size-a': '3e97d14ebb56e1bf',
  'nosetup|normal|size-b': 'ee788c01da261681',
  'nosetup|hard|size-a': '061e68bb7dd33891',
  'nosetup|hard|size-b': '6120a39f5cd1b61e',
  'lines|easy|size-a': '0e91c303dadc56ed',
  'lines|easy|size-b': '3cb51545efc7366e',
  'lines|normal|size-a': '423c38464f674a76',
  'lines|normal|size-b': '3362db2ff7075bc9',
  'lines|hard|size-a': '98fded49018c3f28',
  'lines|hard|size-b': '4316e82ab77e5ed5',
  'classic|easy|size-a': '8a3c91f43715c066',
  'classic|easy|size-b': 'f04dbb216ac6e271',
  'classic|normal|size-a': '69bf80151a0163e7',
  'classic|normal|size-b': '330093a29f257be9',
  'classic|hard|size-a': '2b9e0982d3668c66',
  'classic|hard|size-b': 'c2a91da6f94d1338',
  'standard|easy|size-a': '256a982f346e5325',
  'standard|easy|size-b': '5b09efed4e05974d',
  'standard|normal|size-a': '945c815278f9f157',
  'standard|normal|size-b': '6adbae3f6bdebac5',
  'standard|hard|size-a': 'a440960b79649ce6',
  'standard|hard|size-b': '75cbe17795d793cb',
  'three|easy|size-a': '3f031b9ca10714c1',
  'three|easy|size-b': '266380752d290d23',
  'three|normal|size-a': '7cfc8da182a0401c',
  'three|normal|size-b': '074cc74587cfb3fe',
  'three|hard|size-a': 'a6c0538d5c9b5acf',
  'three|hard|size-b': '33e13265ad7cc08a',
};
const KINDS: Record<string, Partial<SkirmishSetup> | undefined> = {
  nosetup: undefined,
  lines: { map: 'random', tech: 'advanced', research: 'lines' },
  classic: { map: 'random', tech: 'advanced', research: 'classic' },
  standard: { map: 'random', tech: 'standard' },
  three: { map: 'random', tech: 'advanced', research: 'lines', sides: 3 },
};
/** A battle as the pre-round-6 constants were made: autopiloted, side 0 at the default difficulty. */
const hashBattle = (seed: string, d: Difficulty, setup: Partial<SkirmishSetup> | undefined): GameState =>
  play(createInitialState(seed, seed, { seed, difficulty: d, createdAt: 0, autopilot: true, ...(setup ? { setup } : {}) }), 18000);

/** Quick, a mission, a battle without a setup and a save without the field: the game before round 6. */
function quickIsToday(ok: Ok): void {
  const quickLines = lab('size-quick', 'lines', 'quick');
  const noSize = lab('size-quick', 'lines', undefined);
  for (const id of ALL_UPGRADES) {
    ok(researchCostOf(quickLines, id) === UPGRADES[id].cost && researchTicksOf(quickLines, id) === UPGRADES[id].ticks, `quick lines: ${id} at ${UPGRADES[id].cost} credits, ${UPGRADES[id].ticks} ticks`);
    ok(researchCostOf(noSize, id) === UPGRADES[id].cost && researchTicksOf(noSize, id) === UPGRADES[id].ticks, `lines with no size given: ${id} at full price and time`);
  }
  for (const k of GAME_PACE_ORDER) {
    const classic = lab(`size-classic-${k}`, 'classic', k);
    const std = lab(`size-std-${k}`, 'classic', k, 'standard');
    for (const id of ALL_UPGRADES.filter(isClassicUpgrade)) {
      ok(researchCostOf(classic, id) === UPGRADES[id].cost && researchTicksOf(classic, id) === UPGRADES[id].ticks, `${k} classic: ${id} at full price and time`);
      ok(researchCostOf(std, id) === UPGRADES[id].cost && researchTicksOf(std, id) === UPGRADES[id].ticks, `${k} standard tech: ${id} at full price and time`);
    }
    ok(!pacedResearch(classic) && !pacedResearch(std), `${k} classic and standard tech: no paced research`);
    ok(paceOf(classic) === k && paceOf(std) === k, `${k} classic and standard tech: the size is kept (${paceOf(classic)}, ${paceOf(std)})`);
  }

  // A mission, a battle without a setup, a save without the field.
  const all = [...MISSIONS, ...ACT_TWO.filter(m => !MISSIONS.includes(m))];
  for (const m of all) {
    const s = createMissionState(m, mctx(m.id));
    ok(paceOf(s) === 'quick' && !pacedResearch(s), `${m.id}: plays at Quick, no paced research`);
  }
  const none = createInitialState('size-none', 'size-none', { seed: 'size-none', createdAt: 0 });
  ok(!none.setup && paceOf(none) === 'quick' && !pacedResearch(none), 'no setup (the original game): Quick');
  for (const k of GAME_PACE_ORDER) {
    const s = tick(createInitialState('size-old', 'size-old', { seed: 'size-old', difficulty: 'normal', createdAt: 0, autopilot: true, setup: { map: 'river', tech: 'advanced', research: 'lines', pace: k } }), 1200);
    const old = JSON.parse(JSON.stringify(s));
    delete old.setup.pace;
    for (const m of old.ai) delete m.researchFor;
    const text = JSON.stringify(old);
    const m = migrateState(old);
    ok(!!m && JSON.stringify(old) === text, `a ${k} save stripped of its size loads, its input untouched`);
    if (!m) continue;
    ok(m.setup?.pace === 'quick' && paceOf(m) === 'quick' && !pacedResearch(m), `a ${k} save stripped of its size reads Quick`);
    ok(researchCostOf(m, 'refining') === UPGRADES.refining.cost, `a ${k} save stripped of its size: full research price`);
  }
  // A save from round 5 (no size) loads and plays on exactly as the battle never saved.
  {
    const s = tick(createInitialState('size-r5', 'size-r5', { seed: 'size-r5', difficulty: 'hard', createdAt: 0, autopilot: true, setup: { map: 'canyon', tech: 'advanced', research: 'lines' } }), 6000);
    const old = JSON.parse(JSON.stringify(s));
    delete old.setup.pace;
    const m = migrateState(old);
    ok(!!m && JSON.stringify(m) === JSON.stringify(s), 'a round 5 lines save loads as the same battle at Quick');
    if (m) ok(JSON.stringify(tick(m, 3000)) === JSON.stringify(tick(s, 3000)), 'and plays the next 3000 ticks exactly as the battle never saved');
  }

  // Byte identity: the same battles before round 6 (the constants) and now, with no size and with Quick given.
  let matched = 0;
  for (const [kind, setup] of Object.entries(KINDS))
    for (const d of DIFFS)
      for (const seed of DEEP ? ['size-a', 'size-b'] : ['size-a']) {
        const key = `${kind}|${d}|${seed}`;
        const a = hashBattle(seed, d, setup);
        const h = hashOf(a);
        if (h === PRE_ROUND6[key]) matched++;
        ok(h === PRE_ROUND6[key], `${key}: final state matches the build before round 6 (${h}, tick ${a.tick})`);
        // Quick given explicitly: one battle per kind, Normal on seed size-a (the others are the same code path).
        if (setup && seed === 'size-a' && d === 'normal') {
          const b = hashBattle(seed, d, { ...setup, pace: 'quick' });
          ok(b.setup?.pace === 'quick' && JSON.stringify(a) === JSON.stringify(b), `${key}: Quick given explicitly plays the same battle as no size`);
        }
      }
  console.log(`  ${matched}/${DEEP ? Object.keys(PRE_ROUND6).length : Object.keys(PRE_ROUND6).length / 2} battles match the build before round 6${DEEP ? '' : ' (seed size-a; --deep for both seeds)'}`);
}

/** Price and time scaled by mark in development lines; classic and standard tech untouched. */
function researchScaling(ok: Ok): void {
  const s = lab('size-scale', 'lines', 'standard');
  ok(researchModeOf(s) === 'lines' && paceOf(s) === 'standard' && pacedResearch(s), 'a Standard lines battle is paced');
  const want: [UpgradeId, number, number | null][] = [
    ['refining', 1000, 420],
    ['refining2', 1200, null],
    ['heat', 1400, 600],
    ['engines', 600, null],
  ];
  for (const [id, cost, ticks] of want) {
    ok(researchCostOf(s, id) === cost, `Standard: ${id} costs ${cost} (${researchCostOf(s, id)})`);
    if (ticks !== null) ok(researchTicksOf(s, id) === ticks, `Standard: ${id} takes ${ticks} ticks (${researchTicksOf(s, id)})`);
  }
  // The formula, for every upgrade at every size.
  for (const k of GAME_PACE_ORDER) {
    const t = lab(`size-formula-${k}`, 'lines', k);
    for (const id of ALL_UPGRADES) {
      const mi = UPGRADE_LINE[id].mark - 1;
      const cm = GAME_PACES[k].researchCost[mi];
      const tm = GAME_PACES[k].researchTicks[mi];
      const c = cm === 1 ? UPGRADES[id].cost : Math.max(RESEARCH_COST_STEP, Math.round((UPGRADES[id].cost * cm) / RESEARCH_COST_STEP) * RESEARCH_COST_STEP);
      const n = tm === 1 ? UPGRADES[id].ticks : Math.max(1, Math.round(UPGRADES[id].ticks * tm));
      ok(researchCostOf(t, id) === c && researchTicksOf(t, id) === n, `${k}: ${id} at ${c} credits, ${n} ticks`);
      ok(researchCostOf(t, id) % RESEARCH_COST_STEP === 0, `${k}: ${id}'s price is a multiple of ${RESEARCH_COST_STEP}`);
    }
  }
  // Paid, refunded and finished at exactly the scaled numbers, through the reducer.
  for (const id of ['refining', 'refining2', 'heat', 'engines'] as UpgradeId[]) {
    const r = readyFor(s, id);
    const cost = researchCostOf(r, id);
    const total = researchTicksOf(r, id);
    const before = r.players[0].credits;
    const started = processAction(r, { type: 'research', upgrade: id });
    ok(started !== r && started.players[0].credits === before - cost && started.players[0].research?.id === id, `${id}: ${cost} charged when started`);
    const cancelled = processAction(tick(started, 50), { type: 'cancelResearch' });
    ok(cancelled.players[0].credits === before && !cancelled.players[0].research, `${id}: ${cost} refunded when cancelled`);
    const run = tick(started, total - 1);
    ok(!hasUpgrade(run, 0, id) && hasUpgrade(tick(run, 1), 0, id), `${id}: done in exactly ${total} ticks with power`);
    const low = copy(started);
    low.buildings = low.buildings.filter(b => b.owner !== 0 || b.kind !== 'power');
    const lrun = tick(low, 2 * total - 1);
    ok(powerOf(low, 0).low && !hasUpgrade(lrun, 0, id) && hasUpgrade(tick(lrun, 1), 0, id), `${id}: done in exactly ${2 * total} ticks on low power`);
    // Illegal: one credit short of the scaled price returns the same object.
    const poor = copy(r);
    poor.players[0].credits = cost - 1;
    ok(processAction(poor, { type: 'research', upgrade: id }) === poor, `${id}: refused, same object, at ${cost - 1} credits`);
    const enough = copy(r);
    enough.players[0].credits = cost;
    ok(processAction(enough, { type: 'research', upgrade: id }) !== enough, `${id}: accepted at exactly ${cost} credits`);
  }
  // Classic and standard tech at Standard: full price, paid in full.
  for (const [label, t] of [['classic', lab('size-scale-c', 'classic', 'standard')], ['standard tech', lab('size-scale-t', 'classic', 'standard', 'standard')]] as const) {
    for (const id of ALL_UPGRADES.filter(isClassicUpgrade)) ok(researchCostOf(t, id) === UPGRADES[id].cost && researchTicksOf(t, id) === UPGRADES[id].ticks, `Standard ${label}: ${id} at UPGRADES' price and time`);
    const before = t.players[0].credits;
    const started = processAction(t, { type: 'research', upgrade: 'refining' });
    if (started !== t) ok(started.players[0].credits === before - UPGRADES.refining.cost, `Standard ${label}: refining charged ${UPGRADES.refining.cost}`);
    else ok(label === 'standard tech', `Standard ${label}: refining can be started`);
  }

  // Research under way and researchFor survive a save; progress above the scaled ticks is clamped.
  {
    const r = processAction(readyFor(s, 'heat'), { type: 'research', upgrade: 'heat' });
    const t = tick(r, 123);
    t.ai[1].researchFor = 700;
    const m = migrateState(JSON.parse(JSON.stringify(t)));
    ok(!!m && m.players[0].research?.id === 'heat' && m.players[0].research?.progress === 123 && m.ai[1].researchFor === 700, 'Standard: research under way and researchFor kept through a save');
    ok(!!m && JSON.stringify(m) === JSON.stringify(t), 'Standard: a save loads as the same battle');
    if (m) ok(JSON.stringify(tick(m, 600)) === JSON.stringify(tick(t, 600)), 'Standard: a saved battle plays on exactly');
    const over = JSON.parse(JSON.stringify(t));
    over.players[0].research.progress = 900; // above Standard's 600, below the full 1000
    const mo = migrateState(over);
    ok(mo?.players[0].research?.progress === researchTicksOf(t, 'heat'), `Standard: progress 900 is clamped to ${researchTicksOf(t, 'heat')} (${mo?.players[0].research?.progress})`);
    const quick = processAction(readyFor(lab('size-scale-q', 'lines', 'quick'), 'heat'), { type: 'research', upgrade: 'heat' });
    const oq = JSON.parse(JSON.stringify(quick));
    oq.players[0].research.progress = 900;
    oq.ai[1].researchFor = 700;
    const mq = migrateState(oq);
    ok(mq?.players[0].research?.progress === 900, `Quick: progress 900 stays 900 (${mq?.players[0].research?.progress})`);
    ok(!!mq && !('researchFor' in mq.ai[1]), 'Quick: a researchFor in the save is dropped (not a paced battle)');
    const oc = JSON.parse(JSON.stringify(lab('size-scale-c2', 'classic', 'long')));
    oc.ai[1].researchFor = 700;
    const mc = migrateState(oc);
    ok(!!mc && !('researchFor' in mc.ai[1]), 'Long classic: a researchFor in the save is dropped');
    for (const bad of [0, -5, 'x', null, Number.NaN]) {
      const ob = JSON.parse(JSON.stringify(t));
      ob.ai[1].researchFor = bad;
      const mb = migrateState(ob);
      ok(!!mb && !('researchFor' in mb.ai[1]), `Standard: researchFor ${String(bad)} in a save is dropped`);
    }
  }
}

/** The commander: paced lists in Long lines battles, the classic list in Long classic, attack timing scaled. */
function computer(ok: Ok): void {
  // First attack, every size and difficulty, any tech.
  for (const k of GAME_PACE_ORDER)
    for (const d of DIFFS)
      for (const tech of ['advanced', 'standard'] as const) {
        const s = createInitialState('size-first', 'size-first', { seed: 'size-first', difficulty: d, createdAt: 0, setup: { map: 'plains', tech, pace: k } });
        const want = Math.round(DIFFICULTIES[d].firstAttack * GAME_PACES[k].attackMul);
        ok(s.ai[1].nextAttack === want, `${k}, ${d}, ${tech} tech: side 1's first attack at tick ${want} (${s.ai[1].nextAttack})`);
      }

  /** Side 1 at d, side 0 at d0 (default d), side 0's first attack scaled as the ladder does. */
  const battle = (seed: string, d: Difficulty, setup: Partial<SkirmishSetup>, d0: Difficulty = d): GameState => {
    const s = createInitialState(seed, seed, { seed, difficulty: d, createdAt: 0, autopilot: true, setup: { map: 'random', tech: 'advanced', ...setup } });
    s.autopilotDifficulty = d0;
    s.ai[0].nextAttack = difficultyForPace(d0, s.setup!.pace).firstAttack;
    return s;
  };

  // Long lines: the paced list, doctrines with their branches, researchFor the next item's price.
  // Four seeds per difficulty, not section 9.1's six: a deviation logged in the round 6 build log,
  // to keep npm run check quick. The 150-seed ladder is where the depth shares are measured.
  const SEEDS = DEEP ? 4 : 2;
  const summary: string[] = [];
  for (const d of DIFFS) {
    const list = AI_PACED[d];
    let mk2 = 0;
    let mk3 = 0;
    let saving = 0;
    let exact = 0;
    let finished = 0;
    for (let i = 1; i <= SEEDS; i++) {
      const seed = `size-long-${d}-${i}`;
      let problem = '';
      let prev = battle(seed, d, { research: 'lines', pace: 'long', credits: 5000, ore: 'rich' });
      const stands = (st: GameState, o: Owner, id: UpgradeId) => UPGRADES[id].requires.every(k => st.buildings.some(b => b.owner === o && b.kind === k));
      const s = play(prev, 24000, st => {
        for (const o of [0, 1] as Owner[]) {
          const p = st.players[o];
          const ups = p.upgrades ?? [];
          let why = '';
          const off = [...ups, ...(p.research ? [p.research.id] : [])].find(id => !list.includes(id));
          if (off) why = `${off} is not on its list`;
          // A research just started is the first open item on the list whose structures stand: an
          // earlier one is skipped only when its structures were missing (at either end of the step).
          const r = p.research;
          const was = prev.players[o].research;
          if (!why && r && (!was || was.id !== r.id)) {
            const done = ups; // includes one that finished in this same step
            const closed = (id: UpgradeId) => UPGRADE_LINE[id].mark === 3 && !!p.doctrines?.[UPGRADE_LINE[id].line] && p.doctrines[UPGRADE_LINE[id].line] !== id;
            const jumped = list.slice(0, list.indexOf(r.id)).find(id => !done.includes(id) && !closed(id) && stands(prev, o, id) && stands(st, o, id));
            if (jumped) why = `started ${r.id} with ${jumped} open and its structures standing`;
          }
          for (const id of ups) {
            const { line, mark } = UPGRADE_LINE[id];
            if (mark === 3 && p.doctrines?.[line] !== id) why ||= `${id} held without its doctrine`;
          }
          for (const [line, branch] of Object.entries(p.doctrines ?? {})) if (!list.includes(branch as UpgradeId)) why ||= `doctrine ${line}/${branch} not on its list`;
          const rf = st.ai[o].researchFor;
          if (rf !== undefined) {
            saving++;
            const open = list.filter(id => !ups.includes(id) && !(UPGRADE_LINE[id].mark === 3 && p.doctrines?.[UPGRADE_LINE[id].line] && p.doctrines[UPGRADE_LINE[id].line] !== id));
            const next = open.find(id => UPGRADES[id].requires.every(k => st.buildings.some(b => b.owner === o && b.kind === k)));
            if (p.research) why ||= `researchFor ${rf} while researching ${p.research.id}`;
            else if (!open.some(id => researchCostOf(st, id) === rf)) why ||= `researchFor ${rf} is the price of nothing left on its list`;
            if (next && researchCostOf(st, next) === rf) exact++;
          }
          if (why && !problem) problem = `side ${o} at tick ${st.tick}: ${why}`;
        }
        prev = st;
      });
      ok(!problem, `${seed}: the commander researches its paced list in order, skipping only for missing structures${problem ? ` (${problem})` : ''}`);
      if (s.winner !== null) finished++;
      for (const p of s.players) {
        const ups = p.upgrades ?? [];
        if (ups.some(id => UPGRADE_LINE[id].mark === 2)) mk2++;
        if (ups.some(id => UPGRADE_LINE[id].mark === 3)) mk3++;
      }
    }
    if (saving) ok(exact >= 0.9 * saving, `${d}: researchFor is the price of the next item on the list (${exact} of ${saving} samples exactly; the rest one decision stale)`);
    if (d !== 'easy') ok(mk2 >= SEEDS, `${d}: Long lines battles reach Mk II (${mk2} of ${2 * SEEDS} sides)`);
    if (d === 'easy') ok(mk3 === 0, 'easy: never takes a doctrine');
    summary.push(`${d}: ${finished}/${SEEDS} finished by tick 24,000, Mk II ${mk2}/${2 * SEEDS} sides, Mk III ${mk3}/${2 * SEEDS}, saving samples ${saving}`);
  }
  for (const l of summary) console.log(`  Long lines, ${l}`);

  // Long classic: the classic list, no researchFor ever, the first attack doubled.
  for (const d of DIFFS) {
    const seed = `size-long-classic-${d}`;
    let problem = '';
    const s0 = battle(seed, d, { research: 'classic', pace: 'long', credits: 5000, ore: 'rich' });
    ok(s0.ai[1].nextAttack === Math.round(DIFFICULTIES[d].firstAttack * 2), `Long classic, ${d}: side 1's first attack doubled (${s0.ai[1].nextAttack})`);
    const s = play(s0, 24000, st => {
      for (const o of [0, 1] as Owner[]) {
        const ups = st.players[o].upgrades ?? [];
        if (!isSubsequence(ups, AI_CLASSIC[d]) && !problem) problem = `side ${o}: ${ups.join('/')}`;
        if (st.ai[o].researchFor !== undefined && !problem) problem = `side ${o} wrote researchFor at tick ${st.tick}`;
      }
    });
    ok(!problem, `Long classic, ${d}: the classic list only, no researchFor${problem ? ` (${problem})` : ''}`);
    ok(s.players.every(p => p.doctrines === undefined && p.loadouts === undefined), `Long classic, ${d}: no doctrines or loadouts written`);
  }

  // The starvation guard: armed ground units at tick 12,000, Standard against Quick, same seed and credits.
  const armed = (u: Unit) => !!UNITS[u.kind].weapon && UNITS[u.kind].category !== 'air' && !UNITS[u.kind].hero;
  // Side 1 at Normal and at Hard, side 0 at Normal (a Hard mirror is mostly over by tick 12,000).
  // Summed over the first three seeds on which both battles last to tick 12,000 (fourteen tried at most;
  // about half of these battles are over by then). Three, not four, to keep npm run check quick.
  // Not per seed: the attack timing differs, so by tick 12,000 the two battles have had different
  // fights and one seed's count says more about who is winning than about what research costs.
  const NEED = DEEP ? 3 : 2;
  for (const d of ['normal', 'hard'] as Difficulty[]) {
    let sumStd = 0;
    let sumQuick = 0;
    let n = 0;
    const per: string[] = [];
    for (let i = 1; i <= 14 && n < NEED; i++) {
      const seed = `size-starve-${d}-${i}`;
      const std = play(battle(seed, d, { research: 'lines', pace: 'standard' }, 'normal'), 12000);
      const quick = play(battle(seed, d, { research: 'lines', pace: 'quick' }, 'normal'), 12000);
      if (std.tick !== 12000 || quick.tick !== 12000) continue;
      n++;
      const a = std.units.filter(armed).length;
      const b = quick.units.filter(armed).length;
      sumStd += a;
      sumQuick += b;
      per.push(`${a}/${b}`);
    }
    ok(n >= NEED, `${d}: at least ${NEED} seeds last to tick 12,000 at both sizes (${n})`);
    ok(sumStd >= 0.7 * sumQuick, `${d}: armed ground units at tick 12,000 over ${n} seeds, Standard ${sumStd} against Quick ${sumQuick} (at least 70%; per seed ${per.join(', ')})`);
  }

  // A Standard lines battle replays exactly, and through a save.
  {
    // To tick 18,000 or the end, whichever comes first.
    const a = play(battle('size-replay', 'normal', { research: 'lines', pace: 'standard' }), 18000);
    const b = play(battle('size-replay', 'normal', { research: 'lines', pace: 'standard' }), 18000);
    ok(JSON.stringify(a) === JSON.stringify(b), `a Standard lines battle replays byte-identically (to tick ${a.tick})`);
    let c = play(battle('size-replay', 'normal', { research: 'lines', pace: 'standard' }), 6000);
    const saved = JSON.stringify(c);
    const m = migrateState(JSON.parse(saved));
    ok(!!m && JSON.stringify(m) === saved, 'a Standard battle saved at tick 6,000 loads unchanged');
    if (m) {
      c = play(m, 18000);
      ok(JSON.stringify(c) === JSON.stringify(a), 'and plays on to the same end as the battle never saved');
    }
    ok(a.players.some(p => (p.upgrades ?? []).some(id => UPGRADE_LINE[id].mark === 2)), `the replayed Standard battle reaches a Mk II (${a.players.map(p => (p.upgrades ?? []).join('/')).join(' and ')})`);
  }
}

/** Epic battles finish well inside the ladder's cap. */
function tickCap(ok: Ok): void {
  // Without --deep, one Epic battle (the cap itself is measured over 150 seeds by ladder:fire -- --pace epic).
  const pairs: [Difficulty, Difficulty][] = DEEP ? [['hard', 'normal'], ['normal', 'easy'], ['normal', 'normal']] : [['normal', 'easy']];
  const lines: string[] = [];
  for (const [d0, d1] of pairs)
    for (let i = 1; i <= (DEEP ? 3 : 1); i++) {
      const seed = `size-epic-${d0}-${d1}-${i}`;
      const s0 = createInitialState(seed, seed, { seed, difficulty: d1, createdAt: 0, autopilot: true, setup: applyPace({ ...DEFAULT_SETUP }, 'epic') });
      s0.autopilotDifficulty = d0;
      s0.ai[0].nextAttack = difficultyForPace(d0, 'epic').firstAttack;
      const s = play(s0, 150000);
      ok(s.winner !== null, `${seed}: an Epic battle finishes before 150,000 ticks (${s.winner === null ? 'unfinished' : `side ${s.winner} at ${(s.tick / 600).toFixed(1)} min`})`);
      lines.push(`${d0} v ${d1} ${i}: ${s.winner === null ? 'unfinished' : `${(s.tick / 600).toFixed(1)} min`}`);
    }
  console.log(`  Epic: ${lines.join('; ')}`);
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Size: rules and presets', rulesAndPresets],
  ['Size: quick is today', quickIsToday],
  ['Size: research scaling', quietCommander(researchScaling)],
  ['Size: the computer', computer],
  ['Size: tick cap', tickCap],
];
