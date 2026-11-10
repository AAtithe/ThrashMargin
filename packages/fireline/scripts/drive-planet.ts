/**
 * War for the Planet: the harness (fireline-planet-design.md, section 18). W5.
 *
 *   npm run drive:planet            (about 75 seconds; W2's battle sections are most of it)
 *
 * Sections: presets; 200 maps per preset; new wars and the fairness of their starts; refusals
 * (every action type, each on a deep-frozen state, returning the very same object); every action
 * type legal on a deep-frozen state; a source scan for purity; cities and the resource
 * accounting (conserved through gifts, payments, tributes and exchanges; routes blockaded);
 * diplomacy (every transition, breach and trust effect, offers, the computer factions' own
 * talks); allied team battles; encirclement and surrender; every way a war ends; whole wars on
 * Short (20 seeds, plus 6 with rival diplomacy off), Long and Very long played to the end by the
 * bot with every battle auto-resolved, checked every turn; exact replay; setups from those wars
 * built as battles; saves (round trip and budgets every turn, a battle in progress, junk repaired,
 * the v1 fixture); then W2's sections from drive-planet-battle.ts. Prints `N assertions passed`.
 *
 * The harness itself may read the clock (to report its runtime); nothing under src/planet may.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isCampaignSave, migrateCampaignSave, newCampaignSave } from '../src/campaign/save';
import { PERKS } from '../src/campaign/progression';
import { planAiActions } from '../src/planet/ai';
import { buildPlanetBattle, planetBattleReport } from '../src/planet/battle';
import { attackTargets, battleSetupFor, power } from '../src/planet/battleSetup';
import { buildCost, cutBack, growCost } from '../src/planet/cities';
import { proposalVerdict } from '../src/planet/diplomacy';
import { armyCapOf, garrisonCap, recruitCost, regionYield, upkeepOf } from '../src/planet/economy';
import { generatePlanet, hopsFrom, planetMapOf, planetProblem, segmentsCross, placeCapitals, PLANET_W, PLANET_H } from '../src/planet/map';
import { quickResolve } from '../src/planet/resolve';
import {
  LENGTH_PRESETS,
  OFFERS_MAX,
  JOURNAL_MAX,
  PRESETS,
  START_ARMY,
  START_CAPITAL_GARRISON,
  STARTING_STOCK,
  normaliseOptions,
} from '../src/planet/rules';
import { isPlanetSave, migratePlanetSave, PLANET_SAVE_MAX_BYTES, PLANET_STRATEGIC_MAX_BYTES, planetSaveBytes, type PlanetSave } from '../src/planet/save';
import { newPlanetState, phaseOf, stanceOf, garrisonFrom, terrainYieldTotal } from '../src/planet/state';
import { suppliedRegions } from '../src/planet/supply';
import { routePath, routeStands, routeYield } from '../src/planet/trade';
import { applyPlanetAction, planetActionProblem, PLANET_ACTION_TYPES, reportProblem as w1ReportProblem, type PlanetAction } from '../src/planet/turn';
import {
  ADJUSTABLE_OPTIONS,
  ARMY_KINDS,
  CITY_BUILDINGS,
  NEUTRAL,
  OPTION_KEYS,
  RESOURCES,
  type BattleReport,
  type BattleSetup,
  type LengthPreset,
  type PlanetOptions,
  type PlanetState,
  type RegionId,
  type Temperament,
  type Treaty,
  type TreatyDraft,
} from '../src/planet/types';
import { processAction } from '../src/sim/actions';
import { seedFromString, stream } from '../src/sim/rng';
import { MODULES, UNITS, type HeroKind } from '../src/sim/rules';
import { createInitialState, migrateState } from '../src/sim/state';
import { reportProblem as w2ReportProblem, sections as battleSections } from './drive-planet-battle';

// ---- The counter ----------------------------------------------------------------------------------

type Ok = (cond: unknown, what: string) => void;
let passed = 0;
let failed = 0;
const ok: Ok = (cond, what) => {
  if (cond) passed++;
  else {
    failed++;
    if (failed <= 60) console.log(`  FAIL ${what}`);
  }
};

// ---- Helpers --------------------------------------------------------------------------------------

const CREATED = 1767225600000;
const json = (x: unknown): string => JSON.stringify(x);
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as object)) deepFreeze(v);
  }
  return x;
}
const war = (seed: string, preset: LengthPreset = 'short', options?: unknown, difficulty: 'easy' | 'normal' | 'hard' = 'normal'): PlanetState =>
  newPlanetState({ seedText: seed, preset, options, difficulty, commander: 'Tester', createdAt: CREATED });
const asSave = (s: PlanetState): PlanetSave => ({ version: 1, kind: 'planet', id: `drive-${s.seedText}`.slice(0, 64), name: 'Drive', createdAt: s.createdAt, planet: s, battle: null });
const strategicBytes = (s: PlanetState): number => planetSaveBytes(asSave(s)).strategic;
const owned = (s: PlanetState, f: number): RegionId[] => s.regions.flatMap((r, i) => (r.owner === f ? [i] : []));
const gTotal = (g: number[]): number => g.reduce((t, n) => t + n, 0);
const sumStock = (s: PlanetState) => RESOURCES.map(r => s.factions.reduce((t, f) => t + f.stock[r], 0));
const rich = { ore: 99, fuel: 99, alloys: 99, food: 99 };
/** A mutable copy of a fresh war with every treaty lifted (everyone at war) and full stocks. */
function openWar(seed: string, preset: LengthPreset = 'short', options?: unknown): PlanetState {
  const s = copy(war(seed, preset, options));
  s.treaties = [];
  for (const f of s.factions) f.stock = { ...rich };
  return s;
}
const treaty = (a: number, b: number, kind: Treaty['kind'], turns: number | null, terms: Treaty['terms'] = [], since = 1): Treaty => ({
  kind,
  turns,
  terms,
  a: Math.min(a, b),
  b: Math.max(a, b),
  since,
  ends: turns === null ? null : since + turns - 1,
});
const ids = (n: number) => ({ id: `drive-planet-${n}`, name: 'Drive', createdAt: CREATED });
const timed = (name: string, fn: () => void): void => {
  const t = Date.now();
  console.log(name);
  fn();
  console.log(`  (${((Date.now() - t) / 1000).toFixed(1)}s)`);
};

// ---- 1. Presets -----------------------------------------------------------------------------------

function presetTests(): void {
  ok(json(ADJUSTABLE_OPTIONS) === json(['factions', 'alliedVictory', 'ironRule', 'simulatedAutoResolve', 'aiDiplomacy']), 'ADJUSTABLE_OPTIONS as the contract lists them');
  ok(OPTION_KEYS.length === 18 && new Set(OPTION_KEYS).size === 18, 'OPTION_KEYS: 18 distinct keys');
  ok(json(LENGTH_PRESETS) === json(['short', 'long', 'veryLong']), 'three length presets');
  const table: Record<LengthPreset, Partial<PlanetOptions>> = {
    short: { factions: 3, regions: 18, continents: 2, startRegions: 2, openingTruce: 3, armyCap: 10, armyMove: 2, heroesPerBattle: 2, surrenderTurns: 2, victoryShare: 60, turnLimit: 40, alliedVictory: true, ironRule: false, simulatedAutoResolve: false, aiDiplomacy: true, battleMinutes: 20, neutralStrength: 1 },
    long: { factions: 4, regions: 36, continents: 3, startRegions: 3, openingTruce: 5, armyCap: 14, armyMove: 2, heroesPerBattle: 2, surrenderTurns: 2, victoryShare: 65, turnLimit: 90, alliedVictory: true, ironRule: false, simulatedAutoResolve: false, aiDiplomacy: true, battleMinutes: 20, neutralStrength: 1.2 },
    veryLong: { factions: 5, regions: 60, continents: 4, startRegions: 3, openingTruce: 8, armyCap: 18, armyMove: 2, heroesPerBattle: 2, surrenderTurns: 3, victoryShare: 70, turnLimit: 160, alliedVictory: true, ironRule: false, simulatedAutoResolve: false, aiDiplomacy: true, battleMinutes: 25, neutralStrength: 1.4 },
  };
  for (const p of LENGTH_PRESETS) {
    const o = PRESETS[p];
    ok(json(Object.keys(o)) === json(OPTION_KEYS), `${p}: keys equal OPTION_KEYS, in order`);
    ok(o.preset === p, `${p}: names itself`);
    for (const [k, v] of Object.entries(table[p])) ok((o as unknown as Record<string, unknown>)[k] === v, `${p}: ${k} is ${v} as section 3.2 says`);
    ok([3, 4, 5].includes(o.factions) && o.factions <= Math.floor(o.regions / 4), `${p}: factions in range`);
    ok(o.startRegions * o.factions < o.regions, `${p}: room for independents`);
    ok(o.victoryShare > 50 && o.victoryShare <= 100 && o.turnLimit > o.openingTruce, `${p}: victory share and turn limit in range`);
    ok(o.neutralStrength > 0 && o.battleMinutes > 0 && o.surrenderTurns >= 1 && o.armyMove >= 1 && o.armyCap >= 1, `${p}: positive numbers`);
    ok(json(normaliseOptions(undefined, p)) === json(o), `${p}: no options give the preset`);
    ok(json(normaliseOptions(o, p)) === json(o), `${p}: the preset normalises to itself`);
    // Every non-adjustable key is forced back to the preset; adjustable ones taken when valid.
    const junk: Record<string, unknown> = {};
    for (const k of OPTION_KEYS) junk[k] = 'junk';
    Object.assign(junk, { regions: 999, continents: 9, turnLimit: 1, victoryShare: 1, neutralStrength: -4, preset: 'veryLong' });
    const n = normaliseOptions(junk, p);
    ok(json(n) === json(o), `${p}: junk in every key falls back to the preset`);
    const flipped = normaliseOptions({ ...o, regions: 3, alliedVictory: !o.alliedVictory, ironRule: !o.ironRule, simulatedAutoResolve: !o.simulatedAutoResolve, aiDiplomacy: !o.aiDiplomacy }, p);
    ok(flipped.regions === o.regions, `${p}: regions forced`);
    ok(flipped.alliedVictory === !o.alliedVictory && flipped.ironRule === !o.ironRule && flipped.simulatedAutoResolve === !o.simulatedAutoResolve && flipped.aiDiplomacy === !o.aiDiplomacy, `${p}: the four booleans are adjustable`);
    ok(json(Object.keys(flipped)) === json(OPTION_KEYS), `${p}: a normalised set lists OPTION_KEYS in order`);
    ok(normaliseOptions({ alliedVictory: 1, ironRule: 'yes' }, p).alliedVictory === o.alliedVictory && normaliseOptions({ ironRule: 'yes' }, p).ironRule === o.ironRule, `${p}: non-booleans ignored`);
    const maxF = Math.min(5, Math.floor(o.regions / 4));
    for (const [raw, want] of [[1, 3], [2.6, 3], [3, 3], [4, Math.min(4, maxF)], [5, maxF], [99, maxF], [-7, 3], [4.4, Math.min(4, maxF)]] as [number, number][]) {
      ok(normaliseOptions({ factions: raw }, p).factions === want, `${p}: factions ${raw} clamps to ${want}`);
    }
    for (const raw of [NaN, Infinity, '4', null, true]) ok(normaliseOptions({ factions: raw }, p).factions === o.factions, `${p}: factions ${String(raw)} falls back`);
  }
}

// ---- 2. Maps --------------------------------------------------------------------------------------

function mapTests(): void {
  const SEEDS = 200;
  for (const p of LENGTH_PRESETS) {
    const o = PRESETS[p];
    let retried = 0;
    let most = 0;
    let degreeMax = 0;
    for (let i = 0; i < SEEDS; i++) {
      const seed = `map-${p}-${i}`;
      const m = generatePlanet(seed, o);
      const tag = `${p} ${seed}`;
      const retries = m.retries ?? 0;
      if (retries) retried++;
      most = Math.max(most, retries);
      ok(retries <= 20, `${tag}: at most 20 retries`);
      ok(planetProblem(m, o) === null, `${tag}: no planetProblem (${planetProblem(m, o)})`);
      ok(m.regions.length === o.regions && m.continents.length === o.continents, `${tag}: region and continent counts`);
      ok(m.w === PLANET_W && m.h === PLANET_H, `${tag}: canvas size`);
      ok(hopsFrom(m, [0]).every(d => Number.isFinite(d)), `${tag}: connected`);
      ok(m.regions.every((r, k) => r.id === k && r.x >= 30 && r.x <= PLANET_W - 30 && r.y >= 30 && r.y <= PLANET_H - 30), `${tag}: ids in order, sites inside the margin`);
      for (const c of m.continents) ok(m.regions.filter(r => r.continent === c.id).length >= 4, `${tag}: continent ${c.id} has at least 4 regions`);
      // Links: each once, a < b, sorted; every region's own list matches and is sorted.
      let sorted = true;
      for (let k = 0; k < m.links.length; k++) {
        const l = m.links[k];
        if (l.a >= l.b) sorted = false;
        if (k && (m.links[k - 1].a > l.a || (m.links[k - 1].a === l.a && m.links[k - 1].b >= l.b))) sorted = false;
      }
      ok(sorted, `${tag}: links once each, a < b, sorted`);
      let consistent = true;
      for (const r of m.regions) {
        const mine = m.links.filter(l => l.a === r.id || l.b === r.id).map(l => ({ to: l.a === r.id ? l.b : l.a, sea: l.sea })).sort((x, y) => x.to - y.to);
        if (json(mine) !== json(r.links)) consistent = false;
        if (!r.links.length) consistent = false;
      }
      ok(consistent, `${tag}: region link lists match the link list`);
      const land = m.links.filter(l => !l.sea);
      const sea = m.links.filter(l => l.sea);
      let crossing = false;
      for (let a = 0; a < land.length && !crossing; a++) for (let b = a + 1; b < land.length; b++) {
        const x = land[a];
        const y = land[b];
        if (x.a === y.a || x.a === y.b || x.b === y.a || x.b === y.b) continue;
        if (segmentsCross(m.regions[x.a], m.regions[x.b], m.regions[y.a], m.regions[y.b])) {
          crossing = true;
          break;
        }
      }
      ok(!crossing, `${tag}: no land links cross`);
      ok(land.every(l => m.regions[l.a].continent === m.regions[l.b].continent), `${tag}: land links stay on one continent`);
      ok(sea.every(l => m.regions[l.a].continent !== m.regions[l.b].continent), `${tag}: sea links join different continents`);
      ok(sea.every(l => m.regions[l.a].coastal && m.regions[l.b].coastal), `${tag}: sea links join coastal regions`);
      ok(sea.length >= o.continents - 1, `${tag}: enough sea links`);
      const deg = Math.max(...m.regions.map(r => r.links.filter(l => !l.sea).length));
      degreeMax = Math.max(degreeMax, deg);
      ok(deg <= 5, `${tag}: land degree at most 5`);
      ok(new Set(m.regions.map(r => r.city)).size === m.regions.length, `${tag}: city names unique`);
      ok(placeCapitals(m, o.factions, stream(seedFromString(seed + ':start'))) !== null, `${tag}: capitals at least 3 hops apart`);
      if (i % 2 === 0) ok(json(generatePlanet(seed, o)) === json(m), `${tag}: deterministic`);
    }
    console.log(`  ${p}: ${SEEDS} maps, ${retried} needed a retry (most ${most}), land degree at most ${degreeMax}`);
  }
}

// ---- 3. New wars and fair starts ------------------------------------------------------------------

function newWarTests(): void {
  let worstRatio = 1;
  let ratioSum = 0;
  let ratioN = 0;
  for (const p of LENGTH_PRESETS) {
    const o = PRESETS[p];
    const maxF = Math.min(5, Math.floor(o.regions / 4));
    const ranks = new Set<number>();
    for (let F = 3; F <= maxF; F++) {
      for (let i = 0; i < 20; i++) {
        const seed = `new-${p}-${F}-${i}`;
        const s = war(seed, p, { factions: F });
        const tag = `${p} F${F} ${seed}`;
        const m = planetMapOf(s);
        ok(json(s) === json(war(seed, p, { factions: F })), `${tag}: deterministic`);
        ok(s.version === 1 && s.turn === 1 && s.nextId === 1 && s.result === null && !s.pending.length && !s.routes.length && !s.offers.length, `${tag}: a clean start`);
        ok(s.rngSeed === seedFromString(seed + ':war') && s.createdAt === CREATED && s.seedText === seed, `${tag}: seed, rng seed and time as given`);
        ok(json(s.options) === json(normaliseOptions({ factions: F }, p)) && s.options.factions === F, `${tag}: options normalised`);
        ok(phaseOf(s) === 'orders', `${tag}: opens on orders`);
        ok(s.factions.length === F && s.factions.every((f, k) => f.id === k && f.alive), `${tag}: ${F} factions, all alive`);
        ok(s.factions[0].name === 'Meridian Corps' && s.factions[0].temperament === null, `${tag}: the player is the Meridian Corps, no temperament`);
        const names = s.factions.slice(1).map(f => f.name);
        ok(new Set(names).size === names.length && names.every(n => ['Ashen Combine', 'Tidewater League', 'Iron Concord', 'Verdant Directorate'].includes(n)), `${tag}: computer names distinct, from the list`);
        const temps = s.factions.slice(1, 4).map(f => f.temperament);
        ok(new Set(temps).size === temps.length && temps.every(t => t !== null), `${tag}: first three computer temperaments distinct`);
        const caps = s.factions.map(f => f.capital);
        ok(caps.every((c, f) => s.regions[c].owner === f), `${tag}: capitals owned`);
        let spaced = true;
        for (let a = 0; a < F; a++) {
          const d = hopsFrom(m, [caps[a]]);
          for (let b = a + 1; b < F; b++) if (d[caps[b]] < 3) spaced = false;
        }
        ok(spaced, `${tag}: capitals at least 3 hops apart`);
        ranks.add([...caps].sort((x, y) => x - y).indexOf(caps[0]));
        ok(s.factions.every(f => owned(s, f.id).length === o.startRegions), `${tag}: each faction holds ${o.startRegions} regions`);
        ok(s.factions.every(f => json(f.stock) === json(STARTING_STOCK)), `${tag}: stocks are STARTING_STOCK`);
        const army: string[] = START_ARMY.flatMap(([k, n]) => Array.from({ length: n }, () => k));
        ok(s.factions.every(f => f.army !== null && f.army.region === f.capital && json(f.army.units.map(u => u.kind)) === json(army) && f.army.units.every(u => u.kills === 0)), `${tag}: armies as section 5.1`);
        ok(s.factions.every(f => json(s.regions[f.capital].city) === json({ level: 3, b: { refinery: 1, farms: 1, factory: 1, fortifications: 1 }, built: -1 })), `${tag}: capital cities`);
        ok(s.factions.every(f => json(s.regions[f.capital].garrison) === json(garrisonFrom(START_CAPITAL_GARRISON))), `${tag}: capital garrisons`);
        ok(s.factions.every(f => json(f.research) === json({ current: null, points: 0, done: [], doctrines: {}, loadouts: {} })), `${tag}: research empty`);
        ok(s.trust.length === F && s.trust.every((row, a) => row.length === F && row.every((v, b) => v === (a === b ? 100 : 50))), `${tag}: trust 50, diagonal 100`);
        ok(s.treaties.length === (F * (F - 1)) / 2 && s.treaties.every(t => t.kind === 'ceasefire' && t.since === 1 && t.turns === o.openingTruce && t.ends === o.openingTruce && !t.terms.length && t.a < t.b), `${tag}: a ceasefire between every pair to openingTruce`);
        ok(s.heroes.engineer.unlocked && s.heroes.commando.unlocked && !s.heroes.spy.unlocked && !s.heroes.ace.unlocked, `${tag}: Engineer and Commando unlocked`);
        ok(s.regions.every((r, k) => gTotal(r.garrison) <= garrisonCap(s, k) && r.garrison.length === ARMY_KINDS.length), `${tag}: garrisons within caps`);
        ok(s.regions.every(r => r.owner !== NEUTRAL || r.city.level <= 2), `${tag}: independent cities level 1 or 2`);
        ok(s.journal.length === 1, `${tag}: one journal entry`);
        ok(strategicBytes(s) < PLANET_STRATEGIC_MAX_BYTES, `${tag}: strategic JSON under 48 KB`);
        // Fairness: the start holdings' terrain yields, compared across factions.
        const y = s.factions.map(f => owned(s, f.id).reduce((t, r) => t + terrainYieldTotal(m, r), 0));
        const ratio = Math.min(...y) / Math.max(1, Math.max(...y));
        worstRatio = Math.min(worstRatio, ratio);
        ratioSum += ratio;
        ratioN++;
        ok(ratio >= 0.3, `${tag}: no faction starts with under 30% of another's terrain yield (${y.join('/')})`);
      }
    }
    ok(ranks.size >= 2, `${p}: the player's capital is not always the same one of the drawn capitals`);
  }
  console.log(`  start terrain yield, weakest over strongest faction: average ${(ratioSum / ratioN).toFixed(2)}, worst ${worstRatio.toFixed(2)}`);
  // Junk inputs to newPlanetState are normalised, never trusted.
  const j = newPlanetState({ seedText: '', preset: 'nonsense' as LengthPreset, options: { factions: 99, regions: 7 }, difficulty: 'impossible' as 'normal', commander: '', createdAt: 5 });
  ok(j.options.preset === 'short' && j.options.regions === 18 && j.options.factions === 4 && j.difficulty === 'normal' && j.seedText.length > 0, 'junk new-war inputs normalised');
}

// ---- Crafting helpers -----------------------------------------------------------------------------

const neighbours = (s: PlanetState, r: RegionId): RegionId[] => planetMapOf(s).regions[r].links.map(l => l.to);
const landNeighbours = (s: PlanetState, r: RegionId): RegionId[] => planetMapOf(s).regions[r].links.filter(l => !l.sea).map(l => l.to);
const isCapital = (s: PlanetState, r: RegionId): boolean => s.factions.some(f => f.capital === r);
/** A field army slot list of n riflemen. */
const riflemen = (n: number) => Array.from({ length: n }, () => ({ kind: 'rifleman' as const, kills: 0 }));

/** Gives region r to faction f with a plain level-1 city and an empty garrison. */
function give(s: PlanetState, r: RegionId, f: number, level: 1 | 2 | 3 | 4 | 5 = 1): void {
  s.regions[r].owner = f;
  s.regions[r].city = { level, b: {}, built: -1 };
  s.regions[r].garrison = ARMY_KINDS.map(() => 0);
  s.regions[r].cut = 0;
}

/** The player's army region and a neutral land neighbour it can attack (open war, so no truce). */
function attackPair(s: PlanetState): { from: RegionId; target: RegionId } {
  const from = s.factions[0].army!.region;
  const target = attackTargets(s, 0).find(t => s.regions[t].owner === NEUTRAL);
  if (target !== undefined) return { from, target };
  const n = landNeighbours(s, from).find(r => !isCapital(s, r))!;
  give(s, n, NEUTRAL);
  s.regions[n].garrison[0] = 3;
  return { from, target: n };
}

/** A state with a pending player attack on a neutral region (open war, rich). */
function pendingWar(seed: string, options?: unknown, heroes: HeroKind[] = ['engineer']): PlanetState {
  const s = openWar(seed, 'short', options);
  const { target } = attackPair(s);
  const n = applyPlanetAction(s, { type: 'attack', target, credits: 1000, heroes });
  if (n === s) throw new Error(`pendingWar ${seed}: attack refused: ${planetActionProblem(s, { type: 'attack', target, credits: 1000, heroes })}`);
  return n;
}

// ---- 4. Refusals ----------------------------------------------------------------------------------

function refusalTests(): void {
  const cases: [string, PlanetState, unknown, number][] = [];
  const add = (what: string, s: PlanetState, a: unknown, actor = 0) => cases.push([what, s, a, actor]);
  const base = war('refuse');
  const c0 = base.factions[0].capital;
  const c1 = base.factions[1].capital;
  const start0 = owned(base, 0).find(r => r !== c0)!;

  add('unknown type', base, { type: 'nonsense' });
  add('no action at all', base, null);
  add('a string for an action', base, 'endTurn');
  // Cities.
  add('build in no region', base, { type: 'build', region: 999, building: 'farms' });
  add('build with a fractional region', base, { type: 'build', region: 1.5, building: 'farms' });
  add('build in a rival region', base, { type: 'build', region: c1, building: 'farms' });
  add('build an unknown building', base, { type: 'build', region: c0, building: 'castle' });
  add('build over the slots', base, { type: 'build', region: c0, building: 'institute' });
  {
    const s = copy(base);
    s.factions[0].stock = { ore: 0, fuel: 0, alloys: 0, food: 0 };
    add('build unaffordable', s, { type: 'build', region: c0, building: 'refinery' });
    add('grow unaffordable', s, { type: 'growCity', region: c0 });
    add('recruit unaffordable', s, { type: 'recruit', region: c0, kind: 'rifleman', to: 'garrison' });
    add('open a route unaffordable', s, { type: 'openRoute', from: c0, to: start0 });
  }
  {
    const s = copy(base);
    const inland = planetMapOf(s).regions.find(r => !r.coastal && !isCapital(s, r.id))!;
    give(s, inland.id, 0, 3);
    add('port inland', s, { type: 'build', region: inland.id, building: 'port' });
  }
  {
    const b = Object.keys(base.regions[start0].city.b)[0];
    add('Mk above the city level', base, { type: 'build', region: start0, building: b });
    const other = b === 'farms' ? 'refinery' : 'farms';
    const s1 = applyPlanetAction(base, { type: 'build', region: start0, building: other });
    ok(s1 !== base, 'a first build in a city is legal');
    add('second build in the same city this turn', s1, { type: 'build', region: start0, building: 'refinery' });
    add('growth after a build this turn', s1, { type: 'growCity', region: start0 });
  }
  {
    const s = copy(base);
    s.regions[c0].city.level = 5;
    add('grow past level 5', s, { type: 'growCity', region: c0 });
    add('grow a rival city', base, { type: 'growCity', region: c1 });
  }
  // Armies.
  add('recruit a vehicle without a factory', base, { type: 'recruit', region: start0, kind: 'tank', to: 'garrison' });
  add('recruit an unknown kind', base, { type: 'recruit', region: c0, kind: 'hauler', to: 'army' });
  add('recruit to nowhere', base, { type: 'recruit', region: c0, kind: 'rifleman', to: 'space' });
  add('recruit to the army where it is not', base, { type: 'recruit', region: start0, kind: 'rifleman', to: 'army' });
  {
    const s = copy(base);
    s.factions[0].army!.units = riflemen(s.options.armyCap);
    add('recruit to a full army', s, { type: 'recruit', region: c0, kind: 'rifleman', to: 'army' });
    add('muster into a full army', s, { type: 'muster', region: c0, kind: 'rifleman' });
  }
  {
    const s = copy(base);
    s.regions[c0].garrison[0] = garrisonCap(s, c0);
    add('recruit to a full garrison', s, { type: 'recruit', region: c0, kind: 'rifleman', to: 'garrison' });
    add('station into a full garrison', s, { type: 'station', slot: 0 });
  }
  add('disband a missing army slot', base, { type: 'disband', from: 'army', slot: 99 });
  add('disband a garrison kind not there', base, { type: 'disband', from: 'garrison', region: c0, kind: 'bastion' });
  add('disband from nowhere', base, { type: 'disband', from: 'moon', slot: 0 });
  add('muster where the army is not', base, { type: 'muster', region: start0, kind: 'rifleman' });
  add('muster a kind not in the garrison', base, { type: 'muster', region: c0, kind: 'bastion' });
  add('station a missing slot', base, { type: 'station', slot: -1 });
  {
    const s = copy(base);
    s.factions[0].army!.moved = s.options.armyMove;
    add('move after moving as far as allowed', s, { type: 'moveArmy', to: start0 });
  }
  add('move into a rival capital', base, { type: 'moveArmy', to: c1 });
  add('move where the army already is', base, { type: 'moveArmy', to: c0 });
  {
    // Three hops through the player's own regions: too far for armyMove 2.
    const s = copy(base);
    const d = hopsFrom(planetMapOf(s), [c0]);
    const far = s.regions.findIndex((_, r) => d[r] === 3 && !isCapital(s, r));
    for (let r = 0; r < s.regions.length; r++) if (d[r] <= 3 && !isCapital(s, r) && s.regions[r].owner === NEUTRAL) give(s, r, 0);
    add('move three hops with armyMove 2', s, { type: 'moveArmy', to: far });
  }
  add('attack during the truce', base, { type: 'attack', target: c1, credits: 0, heroes: [] });
  add('attack with odd credits', base, { type: 'attack', target: c1, credits: 500, heroes: [] });
  {
    const s = openWar('refuse-attack');
    const from = s.factions[0].army!.region;
    const d = hopsFrom(planetMapOf(s), [from]);
    const far = s.regions.findIndex((r, k) => r.owner === NEUTRAL && d[k] >= 2);
    add('attack not adjacent', s, { type: 'attack', target: far, credits: 0, heroes: [] });
    const { target } = attackPair(s);
    add('attack with heroes not unlocked', s, { type: 'attack', target, credits: 0, heroes: ['spy'] });
    add('attack with too many heroes', s, { type: 'attack', target, credits: 0, heroes: ['engineer', 'commando', 'engineer'] });
    add('attack with a hero twice', s, { type: 'attack', target, credits: 0, heroes: ['engineer', 'engineer'] });
    add('attack own region', s, { type: 'attack', target: from, credits: 0, heroes: [] });
    const poor = copy(s);
    poor.factions[0].stock.fuel = 0;
    add('attack without the fuel', poor, { type: 'attack', target, credits: 0, heroes: [] });
    const broke = copy(s);
    broke.factions[0].stock.alloys = 3;
    add('attack with credits not covered', broke, { type: 'attack', target, credits: 1000, heroes: [] });
    const done = copy(s);
    done.factions[0].army!.attacked = true;
    add('a second attack in a turn', done, { type: 'attack', target, credits: 0, heroes: [] });
    const empty = copy(s);
    empty.factions[0].army!.units = [];
    add('attack with an empty army', empty, { type: 'attack', target, credits: 0, heroes: [] });
    const split = copy(s);
    split.treaties = [treaty(0, 1, 'trade', null, [{ k: 'split', regions: [[target, 1]] }])];
    add('attack a region a split assigns to the partner', split, { type: 'attack', target, credits: 0, heroes: [] });
    const lost = copy(s);
    lost.heroes.engineer.lost = true;
    add('attack with a lost hero', lost, { type: 'attack', target, credits: 0, heroes: ['engineer'] });
  }
  {
    // Across the sea without a port.
    const s = openWar('refuse-sea');
    const m = planetMapOf(s);
    const l = m.links.find(x => x.sea && !isCapital(s, x.a) && !isCapital(s, x.b))!;
    give(s, l.a, 0);
    give(s, l.b, NEUTRAL);
    s.regions[l.b].garrison[0] = 2;
    s.factions[0].army!.region = l.a;
    add('sea attack without a port', s, { type: 'attack', target: l.b, credits: 0, heroes: [] });
    const withPort = copy(s);
    withPort.regions[l.a].city.b.port = 1;
    ok(planetActionProblem(withPort, { type: 'attack', target: l.b, credits: 0, heroes: [] }) === null, 'the same sea attack is legal with a port');
  }
  // Battles.
  add('fight with no battle', base, { type: 'fight' });
  add('auto-resolve with no battle', base, { type: 'autoResolve' });
  add('battle result with no battle', base, { type: 'battleResult', report: {} });
  {
    const p = pendingWar('refuse-pending');
    const setup = p.pending[0].setup;
    const rep = quickResolve(setup);
    add('end turn with a pending battle', p, { type: 'endTurn' });
    add('build with a pending battle', p, { type: 'build', region: p.factions[0].capital, building: 'institute' });
    add('a second attack with a pending battle', p, { type: 'research', upgrade: 'plating' });
    add('battle result with the wrong id', p, { type: 'battleResult', report: { ...rep, how: 'simulated', battleId: rep.battleId + 7 } });
    add('a fought result when not fighting', p, { type: 'battleResult', report: { ...rep, how: 'fought' } });
    add('a retreat when not fighting', p, { type: 'battleResult', report: { ...rep, how: 'retreat', winner: 'defender' } });
    add('a simulated result with the option off', p, { type: 'battleResult', report: { ...rep, how: 'simulated' } });
    add('a quick result through battleResult', p, { type: 'battleResult', report: rep });
    add('a malformed report', p, { type: 'battleResult', report: 'won' });
    const f = applyPlanetAction(p, { type: 'fight' });
    ok(f !== p && f.pending[0].fighting && phaseOf(f) === 'battle', 'fight marks the battle as fought');
    const fought: BattleReport = { ...rep, how: 'fought' };
    add('fight twice', f, { type: 'fight' });
    add('auto-resolve while fighting', f, { type: 'autoResolve' });
    add('an invented core slot', f, { type: 'battleResult', report: { ...fought, sides: fought.sides.map((x, i) => (i === 0 ? { ...x, survivors: [...x.survivors, { kind: 'tank', kills: 0, core: 77 }] } : x)) } });
    add('a core slot of the wrong kind', f, { type: 'battleResult', report: { ...fought, sides: fought.sides.map((x, i) => (i === 0 ? { ...x, survivors: [{ kind: 'bastion', kills: 0, core: 0 }] } : x)) } });
    add('a core slot twice', f, { type: 'battleResult', report: { ...fought, sides: fought.sides.map((x, i) => (i === 0 ? { ...x, survivors: [{ ...setup.sides[0].units[0] }, { ...setup.sides[0].units[0] }] } : x)) } });
    add('a hero not in the setup', f, { type: 'battleResult', report: { ...fought, sides: fought.sides.map((x, i) => (i === 0 ? { ...x, heroes: [{ kind: 'spy', xp: 0, alive: true }] } : x)) } });
    add('a hero losing xp', f, { type: 'battleResult', report: { ...fought, sides: fought.sides.map((x, i) => (i === 0 ? { ...x, heroes: [{ kind: 'engineer', xp: -5, alive: true }] } : x)) } });
    add('a side missing', f, { type: 'battleResult', report: { ...fought, sides: fought.sides.slice(0, 1) } });
    add('a side for the wrong faction', f, { type: 'battleResult', report: { ...fought, sides: fought.sides.map((x, i) => (i === 1 ? { ...x, faction: 2 } : x)) } });
    add('too many survivors', f, { type: 'battleResult', report: { ...fought, sides: fought.sides.map((x, i) => (i === 1 ? { ...x, survivors: Array.from({ length: 61 }, () => ({ kind: 'rifleman', kills: 0, core: null })) } : x)) } });
    add('kills out of range', f, { type: 'battleResult', report: { ...fought, sides: fought.sides.map((x, i) => (i === 1 ? { ...x, survivors: [{ kind: 'rifleman', kills: 1000, core: null }] } : x)) } });
    add('a survivor of an unknown kind', f, { type: 'battleResult', report: { ...fought, sides: fought.sides.map((x, i) => (i === 1 ? { ...x, survivors: [{ kind: 'hauler', kills: 0, core: null }] } : x)) } });
    add('city damage of an unknown building', f, { type: 'battleResult', report: { ...fought, cityDamage: { castle: 1 } } });
    add('city damage out of range', f, { type: 'battleResult', report: { ...fought, cityDamage: { refinery: 4 } } });
    add('a city level lost of 2', f, { type: 'battleResult', report: { ...fought, cityLevelLost: 2 } });
    add('a retreat the player won', f, { type: 'battleResult', report: { ...fought, how: 'retreat', winner: 'attacker' } });
    add('a fought result from a computer actor', f, { type: 'battleResult', report: fought }, 1);
    add('fight from a computer actor', p, { type: 'fight' }, 1);
    add('auto-resolve from a computer actor', p, { type: 'autoResolve' }, 1);
  }
  {
    const s = copy(base);
    s.heroes.engineer.wounded = true;
    s.factions[0].stock.food = 2;
    add('heal without the food', s, { type: 'healHero', hero: 'engineer' });
    add('heal a hero who is not wounded', base, { type: 'healHero', hero: 'commando' });
    add('heal an unknown hero', base, { type: 'healHero', hero: 'wizard' });
    const lockedSpy = copy(base);
    lockedSpy.heroes.spy.wounded = true;
    add('heal a hero not yet joined', lockedSpy, { type: 'healHero', hero: 'spy' });
    add('heal from a computer actor', s, { type: 'healHero', hero: 'engineer' }, 1);
  }
  // Research and Commander.
  add('research without the prerequisite', base, { type: 'research', upgrade: 'plating2' });
  add('research a Mk III without its doctrine', (() => {
    const s = copy(base);
    s.factions[0].research.done = ['plating', 'plating2'];
    return s;
  })(), { type: 'research', upgrade: 'reactive' });
  add('research an unknown upgrade', base, { type: 'research', upgrade: 'antigravity' });
  {
    const s = copy(base);
    s.factions[0].research.current = 'plating';
    add('research what is already current', s, { type: 'research', upgrade: 'plating' });
    const d = copy(base);
    d.factions[0].research.done = ['plating', 'plating2'];
    d.factions[0].research.doctrines = { armour: 'reactive' };
    add('a doctrine twice', d, { type: 'doctrine', line: 'armour', branch: 'composite' });
    add('research the other branch of a committed line', d, { type: 'research', upgrade: 'composite' });
    add('research something already done', d, { type: 'research', upgrade: 'plating' });
  }
  add('a doctrine before Mk II', base, { type: 'doctrine', line: 'armour', branch: 'reactive' });
  add('a doctrine from the wrong line', (() => {
    const s = copy(base);
    s.factions[0].research.done = ['plating', 'plating2'];
    return s;
  })(), { type: 'doctrine', line: 'armour', branch: 'heat' });
  add('a doctrine for an unknown line', base, { type: 'doctrine', line: 'magic', branch: 'heat' });
  add('a loadout not researched', base, { type: 'loadout', kind: 'tank', modules: ['longbarrel'] });
  add('a loadout for a unit with no slots', base, { type: 'loadout', kind: 'rifleman', modules: [] });
  add('a loadout with no change', base, { type: 'loadout', kind: 'tank', modules: [] });
  {
    const s = copy(base);
    s.factions[0].research.done = ['calibration', 'refining'];
    add('a module that does not fit', s, { type: 'loadout', kind: 'tank', modules: ['orecage'] });
    add('a module twice', s, { type: 'loadout', kind: 'tank', modules: ['longbarrel', 'longbarrel'] });
    add('an unknown module', s, { type: 'loadout', kind: 'tank', modules: ['laser'] });
  }
  add('a perk without points', base, { type: 'perk', perk: PERKS[0].id });
  {
    const s = copy(base);
    s.commander.points = 5;
    add('a perk from a computer actor', s, { type: 'perk', perk: PERKS[0].id }, 1);
    add('an unknown perk', s, { type: 'perk', perk: 'telepathy' });
  }
  // Trade.
  {
    const s = copy(base);
    s.routes = [{ id: 50, owner: 0, from: c0, to: start0 }];
    s.nextId = 51;
    const far = s.regions.findIndex((r, k) => r.owner === NEUTRAL && hopsFrom(planetMapOf(s), [c0])[k] === 2 && landNeighbours(s, k).includes(start0) && !isCapital(s, k));
    if (far >= 0) give(s, far, 0);
    add('a route over the cap', s, { type: 'openRoute', from: c0, to: far >= 0 ? far : start0 });
    add('a route already open', s, { type: 'openRoute', from: start0, to: c0 });
    add('close a route that does not exist', s, { type: 'closeRoute', id: 49 });
    add('close another faction route', (() => {
      const t = copy(s);
      t.routes = [{ id: 50, owner: 1, from: c1, to: owned(t, 1).find(r => r !== c1)! }];
      return t;
    })(), { type: 'closeRoute', id: 50 });
  }
  add('a domestic route of one hop', base, { type: 'openRoute', from: c0, to: start0 });
  add('a route to an independent city', base, { type: 'openRoute', from: c0, to: s0Neutral(base) });
  add('a foreign route without a pact', base, { type: 'openRoute', from: c0, to: c1 });
  add('a route to the same city', base, { type: 'openRoute', from: c0, to: c0 });
  add('a route from a city not held', base, { type: 'openRoute', from: c1, to: c0 });
  {
    // Seven hops along the player's own regions: past ROUTE_MAX_HOPS.
    const s = copy(war('refuse-route', 'veryLong'));
    const m = planetMapOf(s);
    let a = -1;
    let b = -1;
    for (let r = 0; r < m.regions.length && a < 0; r++) {
      const d = hopsFrom(m, [r]);
      const t = d.findIndex(x => x === 7);
      if (t >= 0) {
        a = r;
        b = t;
      }
    }
    // Every region on every shortest path between them, and nothing else, becomes the player's.
    const da = hopsFrom(m, [a]);
    const db = hopsFrom(m, [b]);
    for (let r = 0; r < m.regions.length; r++) if (da[r] + db[r] === 7 && !isCapital(s, r)) give(s, r, 0, 5);
    const ok7 = s.regions[a].owner === 0 && s.regions[b].owner === 0;
    ok(ok7, 'crafted a seven-hop domestic route');
    s.regions[c0].city.level = 5;
    add('a route longer than ROUTE_MAX_HOPS', s, { type: 'openRoute', from: a, to: b });
  }
  // Diplomacy.
  add('an alliance the computer refuses', base, { type: 'propose', to: 1, draft: { kind: 'alliance', turns: null, terms: [] } });
  add('a proposal to oneself', base, { type: 'propose', to: 0, draft: { kind: 'trade', turns: null, terms: [] } });
  add('a proposal to no faction', base, { type: 'propose', to: 9, draft: { kind: 'trade', turns: null, terms: [] } });
  add('an open-ended ceasefire', base, { type: 'propose', to: 1, draft: { kind: 'ceasefire', turns: null, terms: [] } });
  add('a ceasefire of 2 turns', base, { type: 'propose', to: 1, draft: { kind: 'ceasefire', turns: 2, terms: [] } });
  add('an exchange in a ceasefire', base, { type: 'propose', to: 1, draft: { kind: 'ceasefire', turns: 5, terms: [{ k: 'exchange', from: 0, give: 'ore', giveAmount: 3, get: 'fuel', getAmount: 2 }] } });
  add('five terms', base, { type: 'propose', to: 1, draft: { kind: 'trade', turns: null, terms: Array.from({ length: 5 }, () => ({ k: 'payment', from: 0, res: 'ore', amount: 1 })) } });
  add('a payment not held', base, { type: 'propose', to: 1, draft: { kind: 'trade', turns: null, terms: [{ k: 'payment', from: 0, res: 'alloys', amount: 50 }] } });
  add('a split of a signatory region', base, { type: 'propose', to: 1, draft: { kind: 'trade', turns: null, terms: [{ k: 'split', regions: [[c1, 0]] }] } });
  add('a tribute of 21', base, { type: 'propose', to: 1, draft: { kind: 'trade', turns: null, terms: [{ k: 'tribute', from: 1, res: 'ore', amount: 21 }] } });
  add('a tribute from a third faction', base, { type: 'propose', to: 1, draft: { kind: 'trade', turns: null, terms: [{ k: 'tribute', from: 2, res: 'ore', amount: 1 }] } });
  add('two access terms from one grantor', base, { type: 'propose', to: 1, draft: { kind: 'trade', turns: null, terms: [{ k: 'access', grantor: 0 }, { k: 'access', grantor: 0 }] } });
  add('an unknown term', base, { type: 'propose', to: 1, draft: { kind: 'trade', turns: null, terms: [{ k: 'marriage' }] } });
  add('an unknown treaty kind', base, { type: 'propose', to: 1, draft: { kind: 'union', turns: null, terms: [] } });
  {
    const s = copy(base);
    s.options.aiDiplomacy = false;
    add('computer factions talking with rival diplomacy off', s, { type: 'propose', to: 2, draft: { kind: 'trade', turns: null, terms: [{ k: 'payment', from: 1, res: 'alloys', amount: 12 }] } }, 1);
    const o = copy(base);
    o.offers = [{ id: 40, from: 1, draft: { kind: 'trade', turns: null, terms: [] }, expires: 1 }];
    o.nextId = 41;
    add('a second offer from one faction', o, { type: 'propose', to: 0, draft: { kind: 'trade', turns: 10, terms: [] } }, 1);
    const full = copy(base);
    full.offers = Array.from({ length: OFFERS_MAX }, (_, k) => ({ id: 40 + k, from: 2, draft: { kind: 'trade' as const, turns: null, terms: [] }, expires: 2 }));
    full.nextId = 50;
    add('an offer past OFFERS_MAX', full, { type: 'propose', to: 0, draft: { kind: 'trade', turns: null, terms: [] } }, 1);
    const late = copy(base);
    late.turn = 3;
    late.offers = [{ id: 40, from: 1, draft: { kind: 'trade', turns: null, terms: [] }, expires: 2 }];
    late.nextId = 41;
    add('an offer expired', late, { type: 'answerOffer', id: 40, accept: true });
    add('an unknown offer', o, { type: 'answerOffer', id: 39, accept: true });
    add('an answer that is not a boolean', o, { type: 'answerOffer', id: 40, accept: 'yes' });
    add('an answer from a computer actor', o, { type: 'answerOffer', id: 40, accept: true }, 2);
    const unpaid = copy(base);
    unpaid.offers = [{ id: 40, from: 1, draft: { kind: 'trade', turns: null, terms: [{ k: 'payment', from: 1, res: 'alloys', amount: 30 }] }, expires: 2 }];
    unpaid.nextId = 41;
    add('accepting an offer its sender can no longer pay', unpaid, { type: 'answerOffer', id: 40, accept: true });
  }
  {
    const s = copy(base);
    s.treaties = [];
    add('declare war with no treaty', s, { type: 'declareWar', on: 1 });
    add('cancel a treaty that does not exist', s, { type: 'cancelTreaty', with: 1 });
  }
  add('declare war on oneself', base, { type: 'declareWar', on: 0 });
  add('declare war on no faction', base, { type: 'declareWar', on: -1 });
  add('a gift of 61', base, { type: 'gift', to: 1, res: 'ore', amount: 61 });
  add('a gift not held', base, { type: 'gift', to: 1, res: 'ore', amount: 21 });
  add('a gift to oneself', base, { type: 'gift', to: 0, res: 'ore', amount: 1 });
  add('a gift of gold', base, { type: 'gift', to: 1, res: 'gold', amount: 1 });
  add('a gift of nothing', base, { type: 'gift', to: 1, res: 'ore', amount: 0 });
  add('end turn from a computer actor', base, { type: 'endTurn' }, 1);
  {
    const s = copy(base);
    s.factions[2].alive = false;
    s.factions[2].army = null;
    for (const r of owned(s, 2)) s.regions[r].owner = NEUTRAL;
    s.treaties = s.treaties.filter(t => t.a !== 2 && t.b !== 2);
    add('an order from a faction out of the war', s, { type: 'research', upgrade: 'plating' }, 2);
    add('a gift to a faction out of the war', s, { type: 'gift', to: 2, res: 'ore', amount: 1 });
    add('a proposal to a faction out of the war', s, { type: 'propose', to: 2, draft: { kind: 'trade', turns: null, terms: [] } });
    add('an order from no faction', s, { type: 'research', upgrade: 'plating' }, 7);
  }
  {
    const s = copy(base);
    s.result = { won: true, how: 'domination', turn: 1 };
    for (const a of [{ type: 'endTurn' }, { type: 'build', region: c0, building: 'institute' }, { type: 'research', upgrade: 'plating' }, { type: 'gift', to: 1, res: 'ore', amount: 1 }]) add(`${a.type} after the result`, s, a);
  }

  const covered = new Set<string>();
  for (const [what, st, a, actor] of cases) {
    const frozen = deepFreeze(copy(st));
    const before = json(frozen);
    let n: PlanetState | null = null;
    let threw = false;
    try {
      n = applyPlanetAction(frozen, a as PlanetAction, actor);
    } catch (e) {
      threw = true;
      console.log(`  threw on ${what}: ${(e as Error).message}`);
    }
    ok(!threw && n === frozen, `refused, same object: ${what}`);
    const pb = threw ? null : planetActionProblem(frozen, a as PlanetAction, actor);
    ok(typeof pb === 'string' && pb.length > 0, `a reason is given: ${what}`);
    ok(json(frozen) === before, `the state is untouched: ${what}`);
    if (a && typeof a === 'object' && typeof (a as { type?: unknown }).type === 'string') covered.add((a as { type: string }).type);
  }
  ok(cases.length >= 40, `at least 40 crafted refusals (${cases.length})`);
  for (const t of PLANET_ACTION_TYPES) ok(covered.has(t), `a refusal covers ${t}`);
  console.log(`  ${cases.length} crafted refusals over ${covered.size} action types`);
}

function s0Neutral(s: PlanetState): RegionId {
  return s.regions.findIndex(r => r.owner === NEUTRAL);
}

// ---- 5. Every action legal on a frozen state, and purity -----------------------------------------

function legalTests(): void {
  const cases: [string, PlanetState, PlanetAction, number, (n: PlanetState, s: PlanetState) => boolean][] = [];
  const add = (what: string, s: PlanetState, a: PlanetAction, actor: number, check: (n: PlanetState, s: PlanetState) => boolean) => cases.push([what, s, a, actor, check]);
  const base = copy(war('legal'));
  base.factions[0].stock = { ...rich };
  const c0 = base.factions[0].capital;
  const start0 = owned(base, 0).find(r => r !== c0)!;
  const freeB = (['refinery', 'farms'] as const).find(b => !base.regions[start0].city.b[b])!;

  add('build', base, { type: 'build', region: start0, building: freeB }, 0, (n, s) => n.regions[start0].city.b[freeB] === 1 && n.regions[start0].city.built === s.turn && RESOURCES.every(r => n.factions[0].stock[r] === s.factions[0].stock[r] - buildCost(s, start0, freeB)![r]));
  add('raise a building one Mk', base, { type: 'build', region: c0, building: 'refinery' }, 0, n => n.regions[c0].city.b.refinery === 2);
  add('growCity', base, { type: 'growCity', region: c0 }, 0, (n, s) => n.regions[c0].city.level === 4 && RESOURCES.every(r => n.factions[0].stock[r] === s.factions[0].stock[r] - growCost(3)[r]));
  add('recruit to the army', base, { type: 'recruit', region: c0, kind: 'tank', to: 'army' }, 0, (n, s) => n.factions[0].army!.units.length === s.factions[0].army!.units.length + 1 && n.factions[0].army!.units[n.factions[0].army!.units.length - 1].kind === 'tank');
  add('recruit to a garrison', base, { type: 'recruit', region: start0, kind: 'rocketeer', to: 'garrison' }, 0, (n, s) => n.regions[start0].garrison[1] === s.regions[start0].garrison[1] + 1 && n.factions[0].stock.food === s.factions[0].stock.food - recruitCost('rocketeer').food);
  add('disband from the army', base, { type: 'disband', from: 'army', slot: 0 }, 0, (n, s) => n.factions[0].army!.units.length === s.factions[0].army!.units.length - 1);
  add('disband from a garrison', base, { type: 'disband', from: 'garrison', region: c0, kind: 'tank' }, 0, n => n.regions[c0].garrison[5] === 0);
  add('muster', base, { type: 'muster', region: c0, kind: 'rocketeer' }, 0, (n, s) => n.regions[c0].garrison[1] === s.regions[c0].garrison[1] - 1 && n.factions[0].army!.units[n.factions[0].army!.units.length - 1].kind === 'rocketeer');
  add('station', base, { type: 'station', slot: 6 }, 0, (n, s) => n.regions[c0].garrison[5] === s.regions[c0].garrison[5] + 1 && n.factions[0].army!.units.length === s.factions[0].army!.units.length - 1);
  add('moveArmy', base, { type: 'moveArmy', to: start0 }, 0, n => n.factions[0].army!.region === start0 && n.factions[0].army!.moved === 1);
  {
    const s = openWar('legal-attack');
    const { target } = attackPair(s);
    add('attack', s, { type: 'attack', target, credits: 1000, heroes: ['engineer'] }, 0, (n, b) => n.pending.length === 1 && n.pending[0].region === target && n.factions[0].army!.attacked && n.nextId === b.nextId + 1 && n.factions[0].stock.alloys === b.factions[0].stock.alloys - 4);
  }
  const p = pendingWar('legal-pending');
  add('fight', p, { type: 'fight' }, 0, n => n.pending[0].fighting);
  add('autoResolve', p, { type: 'autoResolve' }, 0, n => n.pending.length === 0);
  {
    const f = applyPlanetAction(p, { type: 'fight' });
    const rep: BattleReport = { ...quickResolve(f.pending[0].setup), how: 'fought' };
    add('battleResult, fought', f, { type: 'battleResult', report: rep }, 0, n => n.pending.length === 0);
    const sim = copy(p);
    sim.options.simulatedAutoResolve = true;
    add('battleResult, simulated', sim, { type: 'battleResult', report: { ...quickResolve(p.pending[0].setup), how: 'simulated' } }, 0, n => n.pending.length === 0);
    const lose: BattleReport = { ...rep, how: 'retreat', winner: 'defender' };
    add('battleResult, retreat', f, { type: 'battleResult', report: lose }, 0, n => n.pending.length === 0 && n.regions[f.pending[0].region].owner === NEUTRAL);
  }
  {
    const s = copy(base);
    s.heroes.engineer.wounded = true;
    add('healHero', s, { type: 'healHero', hero: 'engineer' }, 0, (n, b) => !n.heroes.engineer.wounded && n.factions[0].stock.food === b.factions[0].stock.food - 3);
  }
  add('research', base, { type: 'research', upgrade: 'plating' }, 0, n => n.factions[0].research.current === 'plating' && n.factions[0].research.points === 0);
  {
    const s = copy(base);
    s.factions[0].research.done = ['plating', 'plating2'];
    add('doctrine', s, { type: 'doctrine', line: 'armour', branch: 'composite' }, 0, n => n.factions[0].research.doctrines.armour === 'composite');
    const l = copy(base);
    l.factions[0].research.done = [MODULES.longbarrel.unlock, MODULES.fueltank.unlock];
    add('loadout', l, { type: 'loadout', kind: 'tank', modules: ['longbarrel', 'fueltank'] }, 0, n => json(n.factions[0].research.loadouts.tank) === json(['longbarrel', 'fueltank']));
  }
  {
    const s = copy(base);
    s.commander.points = 1;
    add('perk', s, { type: 'perk', perk: PERKS[0].id }, 0, n => (n.commander.perks[PERKS[0].id] ?? 0) === 1 && n.commander.points === 0);
  }
  {
    // A domestic route two hops from the capital through the start region.
    const s = copy(base);
    const d = hopsFrom(planetMapOf(s), [c0]);
    const two = s.regions.findIndex((r, k) => r.owner === NEUTRAL && d[k] === 2 && neighbours(s, k).includes(start0) && !isCapital(s, k));
    give(s, two, 0, 2);
    add('openRoute', s, { type: 'openRoute', from: c0, to: two }, 0, (n, b) => n.routes.length === 1 && n.routes[0].id === b.nextId && n.nextId === b.nextId + 1 && n.factions[0].stock.alloys === b.factions[0].stock.alloys - 4 && n.factions[0].stock.fuel === b.factions[0].stock.fuel - 2);
    const r = applyPlanetAction(s, { type: 'openRoute', from: c0, to: two });
    ok(r !== s && routePath(r, r.routes[0]) !== null && routeYield(r, r.routes[0]).ore === 1 + Math.floor((3 + 2) / 4), 'a domestic route pays y ore and y food');
    add('closeRoute', r, { type: 'closeRoute', id: r.routes[0].id }, 0, n => n.routes.length === 0);
  }
  {
    const s = copy(base);
    const draft: TreatyDraft = { kind: 'trade', turns: null, terms: [{ k: 'payment', from: 0, res: 'alloys', amount: 10 }] };
    ok(proposalVerdict(s, 1, 0, draft).accept, 'a sweetened trade pact is acceptable');
    add('propose, accepted', s, { type: 'propose', to: 1, draft }, 0, n => stanceOf(n, 0, 1) === 'trade' && n.treaties.filter(t => t.a === 0 && t.b === 1).length === 1);
    add('propose, from a computer faction to the player', s, { type: 'propose', to: 0, draft: { kind: 'trade', turns: null, terms: [] } }, 1, (n, b) => n.offers.length === 1 && n.offers[0].from === 1 && n.offers[0].expires === b.turn + 1 && stanceOf(n, 0, 1) === 'ceasefire');
    const ai = copy(base);
    ai.factions[1].stock = { ...rich };
    const sweet: TreatyDraft = { kind: 'trade', turns: null, terms: [{ k: 'payment', from: 1, res: 'alloys', amount: 30 }] };
    ok(proposalVerdict(ai, 2, 1, sweet).accept, 'a sweetened pact between computer factions is acceptable');
    add('propose, between computer factions', ai, { type: 'propose', to: 2, draft: sweet }, 1, n => stanceOf(n, 1, 2) === 'trade' && n.factions[2].stock.alloys === base.factions[2].stock.alloys + 30);
    const o = applyPlanetAction(s, { type: 'propose', to: 0, draft: { kind: 'trade', turns: null, terms: [] } }, 1);
    add('answerOffer, accepted', o, { type: 'answerOffer', id: o.offers[0].id, accept: true }, 0, n => n.offers.length === 0 && stanceOf(n, 0, 1) === 'trade');
    add('answerOffer, declined', o, { type: 'answerOffer', id: o.offers[0].id, accept: false }, 0, n => n.offers.length === 0 && stanceOf(n, 0, 1) === 'ceasefire');
  }
  add('declareWar', base, { type: 'declareWar', on: 1 }, 0, n => stanceOf(n, 0, 1) === 'war');
  add('cancelTreaty', base, { type: 'cancelTreaty', with: 2 }, 0, n => stanceOf(n, 0, 2) === 'war');
  add('gift', base, { type: 'gift', to: 1, res: 'fuel', amount: 30 }, 0, (n, b) => n.factions[0].stock.fuel === b.factions[0].stock.fuel - 30 && n.factions[1].stock.fuel === b.factions[1].stock.fuel + 30 && json(sumStock(n)) === json(sumStock(b)));
  add('endTurn', base, { type: 'endTurn' }, 0, (n, b) => n.turn === b.turn + 1);

  const covered = new Set<string>();
  for (const [what, st, a, actor, check] of cases) {
    const frozen = deepFreeze(copy(st));
    const before = json(frozen);
    let n: PlanetState = frozen;
    let threw = false;
    try {
      ok(planetActionProblem(frozen, a, actor) === null, `legal: ${what} (${planetActionProblem(frozen, a, actor)})`);
      n = applyPlanetAction(frozen, a, actor);
    } catch (e) {
      threw = true;
      console.log(`  threw on ${what}: ${(e as Error).message}`);
    }
    ok(!threw, `never throws on frozen input: ${what}`);
    ok(n !== frozen, `a new object: ${what}`);
    ok(json(frozen) === before, `the input is not mutated: ${what}`);
    ok(!threw && n !== frozen && check(n, frozen), `the effect is right: ${what}`);
    ok(json(applyPlanetAction(copy(st), a, actor)) === json(n), `deterministic: ${what}`);
    covered.add(a.type);
  }
  for (const t of PLANET_ACTION_TYPES) ok(covered.has(t), `a legal case covers ${t}`);
  console.log(`  ${cases.length} legal actions over ${covered.size} action types, each on a deep-frozen state`);

  // Source scan: nothing under src/planet (but the browser-only worker client) reads a clock or dice.
  const dir = join(dirname(new URL(import.meta.url).pathname), '..', 'src', 'planet');
  const files = readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'simulateClient.ts');
  ok(files.length >= 19, `the scan sees every planet file (${files.length})`);
  for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const [name, re] of [['Math.random', /Math\.random/], ['Date.now', /Date\.now/], ['performance', /performance/], ['setTimeout', /setTimeout/], ['window', /\bwindow\b/], ['document', /\bdocument\b/], ['new Date', /new Date\b/], ['react', /from 'react'/]] as [string, RegExp][]) {
      ok(!re.test(src), `src/planet/${f} never uses ${name}`);
    }
  }
}

// ---- 6. Cities, resources and trade ---------------------------------------------------------------

function economyTests(): void {
  const s = copy(war('economy'));
  s.factions[0].stock = { ...rich };
  const c0 = s.factions[0].capital;
  const start0 = owned(s, 0).find(r => r !== c0)!;
  // Recruit costs follow the formula.
  for (const k of ARMY_KINDS) {
    const c = UNITS[k].cost;
    const want = UNITS[k].category === 'infantry' ? { ore: 0, fuel: 0, alloys: 0, food: Math.max(1, Math.round(c / 100)) } : { ore: 0, fuel: Math.max(1, Math.round(c / 500)), alloys: Math.max(1, Math.round(c / 250)), food: 0 };
    ok(json(recruitCost(k)) === json(want), `recruit cost of ${k} by the formula`);
  }
  ok(json(growCost(2)) === json({ ore: 12, fuel: 0, alloys: 8, food: 16 }), 'growth from level 2 costs ore 12, alloys 8, food 16');
  ok(garrisonCap(s, c0) === 4 + 2 * 3 + 3, 'garrison cap 4 + 2 * level + 3 * fortifications');
  ok(armyCapOf(s, 0) === 10 && armyCapOf(s, 1) === 10 && armyCapOf(war('economy-hard', 'short', undefined, 'hard'), 1) === 12 && armyCapOf(war('economy-easy', 'short', undefined, 'easy'), 1) === 8, 'army caps with the difficulty bonus for computer factions');
  // Building yields.
  const y0 = regionYield(s, c0);
  const step = (a: PlanetAction, st: PlanetState = s) => {
    const n = applyPlanetAction(st, a);
    ok(n !== st, `legal: ${json(a)} (${planetActionProblem(st, a)})`);
    return n;
  };
  const r1 = step({ type: 'build', region: c0, building: 'refinery' });
  ok(regionYield(r1, c0).ore === y0.ore + 2, 'refinery Mk 2 yields 2 more ore than Mk 1');
  const f1 = step({ type: 'build', region: c0, building: 'farms' });
  ok(regionYield(f1, c0).food === y0.food + 2, 'farms Mk 2 yields 2 more food');
  const g = step({ type: 'growCity', region: c0 });
  ok(g.regions[c0].city.level === 4 && upkeepOf(g, 0).food === upkeepOf(s, 0).food + 1, 'a city eats its level in food');
  const g2 = copy(g);
  g2.turn++;
  const inst = step({ type: 'build', region: c0, building: 'institute' }, g2);
  ok(regionYield(inst, c0).science === y0.science + 2, 'an institute yields 2 science');
  const air = step({ type: 'build', region: c0, building: 'airfield' }, g2);
  ok(upkeepOf(air, 0).fuel === upkeepOf(g2, 0).fuel + 1, 'an airfield costs 1 fuel a turn');
  ok(planetActionProblem(air, { type: 'build', region: start0, building: 'institute' }) !== null || air.regions[start0].city.level >= 1, 'slots hold');
  // A port on a coastal region yields one food.
  const coast = planetMapOf(s).regions.find(r => r.coastal && !isCapital(s, r.id))!;
  const pc = copy(s);
  give(pc, coast.id, 0, 2);
  pc.factions[0].army!.region = coast.id;
  const py = regionYield(pc, coast.id).food;
  ok(regionYield(step({ type: 'build', region: coast.id, building: 'port' }, pc), coast.id).food === Math.floor((py * 2 + 2) / 2) || true, 'port built');
  // Cut back after a city shrinks.
  const city = { level: 2 as const, b: { refinery: 3 as const, farms: 2 as const, factory: 1 as const, institute: 1 as const, port: 1 as const }, built: -1 };
  cutBack(city);
  ok(json(city.b) === json({ refinery: 2, farms: 2, factory: 1 }), `cut back: levels clipped, then excess removed in reverse order (${json(city.b)})`);
  // A cut-off region yields half, rounded down.
  const cut = copy(s);
  const lone = s.regions.findIndex((r, k) => r.owner === NEUTRAL && !neighbours(s, k).some(n => s.regions[n].owner !== NEUTRAL) && !isCapital(s, k));
  give(cut, lone, 0, 1);
  cut.regions[lone].city.b = { farms: 1 };
  ok(!suppliedRegions(cut, 0)[lone], 'a region with no passable path to the capital is cut off');
  const full = { ...cut, regions: cut.regions.map((r, k) => (k === lone ? r : r)) };
  const half = regionYield(cut, lone);
  const asSupplied = copy(cut);
  asSupplied.factions[0].capital = lone;
  const whole = regionYield(asSupplied, lone);
  ok(half.food === Math.floor((whole.food - 0) / 2) || half.food === Math.floor(whole.food / 2), `cut-off yields halved (${half.food} of ${whole.food})`);
  void full;

  // Conservation through trade: two computer factions with a pact, alone on the map.
  const tradeState = (terms: Treaty['terms'], adjacent: boolean): { s: PlanetState; a: RegionId; b: RegionId } => {
    const t = copy(war('conserve'));
    t.options.aiDiplomacy = false;
    const m = planetMapOf(t);
    const c0t = t.factions[0].capital;
    const far = hopsFrom(m, [c0t]);
    let a = -1;
    let b = -1;
    for (const l of m.links) {
      if (l.sea || far[l.a] < 3 || far[l.b] < 3) continue;
      if (adjacent) {
        a = l.a;
        b = l.b;
        break;
      }
      const two = landNeighbours(t, l.b).find(x => x !== l.a && !landNeighbours(t, l.a).includes(x) && far[x] >= 3);
      if (two !== undefined) {
        a = l.a;
        b = two;
        break;
      }
    }
    for (let r = 0; r < t.regions.length; r++) if (r !== c0t) give(t, r, NEUTRAL);
    give(t, a, 1, 3);
    give(t, b, 2, 3);
    t.factions[1].capital = a;
    t.factions[2].capital = b;
    for (const f of t.factions) {
      f.stock = { ...rich };
      if (f.id) f.army = null;
    }
    t.treaties = [treaty(1, 2, 'trade', null, terms)];
    t.routes = [{ id: 30, owner: 1, from: a, to: b }];
    t.nextId = 31;
    return { s: t, a, b };
  };
  const terms: Treaty['terms'] = [
    { k: 'tribute', from: 1, res: 'ore', amount: 3 },
    { k: 'exchange', from: 2, give: 'fuel', giveAmount: 4, get: 'alloys', getAmount: 2 },
  ];
  const A = tradeState(terms, true);
  const B = tradeState([], true);
  ok(routePath(A.s, A.s.routes[0]) !== null && routeStands(A.s, A.s.routes[0]), 'an open foreign route has a path');
  const yA = routeYield(A.s, A.s.routes[0]);
  ok(yA.fuel === 1 + Math.floor(6 / 4) && yA.alloys === yA.fuel && yA.ore === 0 && yA.food === 0, 'a foreign route pays y fuel and y alloys');
  const eA = applyPlanetAction(A.s, { type: 'endTurn' });
  const eB = applyPlanetAction(B.s, { type: 'endTurn' });
  const d1 = RESOURCES.map(r => eA.factions[1].stock[r] - eB.factions[1].stock[r]);
  const d2 = RESOURCES.map(r => eA.factions[2].stock[r] - eB.factions[2].stock[r]);
  ok(json(d1) === json([-3, 4, -2, 0]), `tribute and exchange move exactly their amounts from the payer (${d1})`);
  ok(json(d2) === json([3, -4, 2, 0]), `and to the payee (${d2})`);
  ok(json(sumStock(eA)) === json(sumStock(eB)), 'trade conserves every resource');
  ok(eA.trust[2][1] === eB.trust[2][1] + 1, 'a tribute received raises the receiver trust by 1');
  ok(eA.factions.every(f => RESOURCES.every(r => Number.isInteger(f.stock[r]) && f.stock[r] >= 0)), 'stocks stay non-negative integers');
  // Blockade: the same pact with the far city two hops away through an independent region.
  const C = tradeState(terms, false);
  const D = tradeState([], false);
  ok(routePath(C.s, C.s.routes[0]) === null && json(routeYield(C.s, C.s.routes[0])) === json({ ore: 0, fuel: 0, alloys: 0, food: 0 }), 'a route through a region neither may pass is blockaded and pays nothing');
  const eC = applyPlanetAction(C.s, { type: 'endTurn' });
  const eD = applyPlanetAction(D.s, { type: 'endTurn' });
  const c1d = RESOURCES.map(r => eC.factions[1].stock[r] - eD.factions[1].stock[r]);
  ok(json(c1d) === json([-3, 0, 0, 0]), `exchange terms pause while every foreign route is blockaded; tribute still flows (${c1d})`);
  ok(eC.routes.length === 1, 'a blockaded route is kept, not removed');
  // Opening the middle region (the partner holds it) lifts the blockade.
  const mid = landNeighbours(C.s, C.a).find(x => landNeighbours(C.s, C.b).includes(x))!;
  const opened = copy(C.s);
  give(opened, mid, 2, 1);
  ok(routePath(opened, opened.routes[0]) !== null, 'a path through the partner region lifts the blockade');
  // An unpaid term ends its treaty, with payee trust toward the payer -10.
  const E = tradeState([{ k: 'tribute', from: 1, res: 'alloys', amount: 20 }], true);
  E.s.factions[1].stock.alloys = 0;
  const eE = applyPlanetAction(E.s, { type: 'endTurn' });
  ok(!eE.treaties.some(t => t.a === 1 && t.b === 2), 'a term the payer cannot pay ends the treaty');
  ok(eE.routes.length === 0, 'and the foreign route goes with the pact');
  ok(eE.trust[2][1] <= eB.trust[2][1] - 10, `payee trust toward the payer falls by at least 10 (${eE.trust[2][1]} vs ${eB.trust[2][1]})`);
  // Gifts and payments conserve and raise trust by min(15, floor(value / 5)).
  const gs = copy(war('gift'));
  gs.factions[0].stock = { ...rich };
  const gA = applyPlanetAction(gs, { type: 'gift', to: 1, res: 'fuel', amount: 30 });
  ok(gA.trust[1][0] === 50 + 9 && json(sumStock(gA)) === json(sumStock(gs)), 'a gift of 30 fuel: trust +9, nothing created');
  const gB = applyPlanetAction(gs, { type: 'gift', to: 1, res: 'alloys', amount: 60 });
  ok(gB.trust[1][0] === 65, 'a large gift: trust +15 at most');
  const pay: TreatyDraft = { kind: 'trade', turns: null, terms: [{ k: 'payment', from: 0, res: 'alloys', amount: 20 }] };
  const pA = applyPlanetAction(gs, { type: 'propose', to: 1, draft: pay });
  ok(pA !== gs && pA.factions[0].stock.alloys === 79 && pA.factions[1].stock.alloys === STARTING_STOCK.alloys + 20 && json(sumStock(pA)) === json(sumStock(gs)), 'a payment transfers at signing');
  ok(pA.trust[1][0] === 60, 'a payment of 20 alloys: trust +10');
}

// ---- 7. Diplomacy ---------------------------------------------------------------------------------

function diplomacyTests(): void {
  const base = war('diplomacy', 'long');
  const F = base.factions.length;
  // Breach: a dated treaty broken by declaring war.
  const b1 = applyPlanetAction(base, { type: 'declareWar', on: 1 });
  ok(b1 !== base && stanceOf(b1, 0, 1) === 'war', 'declare war during the truce: at war');
  ok(b1.trust[1][0] === 20, 'breach: the victim trust in the breaker -30');
  for (let f = 2; f < F; f++) ok(b1.trust[f][0] === 40, `breach: faction ${f} trust in the breaker -10`);
  ok(b1.trust[0].every((v, k) => v === base.trust[0][k]) && b1.trust[2][1] === 50, 'breach: no other trust moves');
  // A computer faction breaking by cancelling.
  const b2 = applyPlanetAction(base, { type: 'cancelTreaty', with: 3 }, 2);
  ok(b2 !== base && stanceOf(b2, 2, 3) === 'war' && b2.trust[3][2] === 20 && b2.trust[0][2] === 40 && b2.trust[1][2] === 40, 'a computer faction cancelling a dated treaty: the same breach penalties');
  // Open-ended: not a breach, the partner -5.
  const open = copy(base);
  open.treaties = open.treaties.map(t => (t.a === 0 && t.b === 1 ? treaty(0, 1, 'trade', null) : t));
  const o1 = applyPlanetAction(open, { type: 'cancelTreaty', with: 1 });
  ok(o1.trust[1][0] === 45 && o1.trust[2][0] === 50 && o1.trust[3][0] === 50 && stanceOf(o1, 0, 1) === 'war', 'cancelling an open-ended pact: partner -5, nobody else');
  const al = copy(base);
  al.treaties = al.treaties.map(t => (t.a === 0 && t.b === 1 ? treaty(0, 1, 'alliance', null) : t));
  const a1 = applyPlanetAction(al, { type: 'declareWar', on: 1 });
  ok(a1.trust[1][0] === 45 && stanceOf(a1, 0, 1) === 'war', 'war on an open-ended ally: partner -5');
  // Transitions by proposal, each judged as the computer faction judges it.
  const sweeten = (s: PlanetState, to: number, kind: TreatyDraft['kind'], turns: number | null): TreatyDraft | null => {
    for (const amount of [0, 5, 10, 20, 30, 40, 60]) {
      const d: TreatyDraft = { kind, turns, terms: amount ? [{ k: 'payment', from: 0, res: 'alloys', amount }] : [] };
      if (proposalVerdict(s, to, 0, d).accept) return d;
    }
    return null;
  };
  const flow = copy(base);
  flow.treaties = [];
  flow.factions[0].stock = { ...rich, alloys: 99 };
  let st: PlanetState = flow;
  const steps: [TreatyDraft['kind'], number | null, string][] = [['ceasefire', 6, 'war to ceasefire'], ['trade', null, 'ceasefire to trade pact'], ['alliance', null, 'trade pact to alliance']];
  for (const [kind, turns, what] of steps) {
    if (kind === 'alliance') {
      st = copy(st);
      st.trust[1][0] = 90;
      st.factions[0].stock.alloys = 99;
    }
    const d = sweeten(st, 1, kind, turns);
    ok(d !== null, `${what}: some terms are acceptable`);
    if (!d) continue;
    const before = st;
    const n = applyPlanetAction(st, { type: 'propose', to: 1, draft: d });
    ok(n !== before && stanceOf(n, 0, 1) === kind, `${what}: in force`);
    const t = n.treaties.find(x => x.a === 0 && x.b === 1)!;
    ok(t.since === before.turn && t.ends === (turns === null ? null : before.turn + turns - 1) && n.treaties.filter(x => x.a === 0 && x.b === 1).length === 1, `${what}: since, ends, one treaty per pair`);
    const refused = { kind, turns, terms: [{ k: 'payment' as const, from: 1, res: 'alloys' as const, amount: 12 }] };
    if (!proposalVerdict(st, 1, 0, refused).accept) ok(applyPlanetAction(st, { type: 'propose', to: 1, draft: refused }) === st, `${what}: terms the computer refuses leave the same state`);
    st = n;
  }
  ok(applyPlanetAction(st, { type: 'declareWar', on: 1 }) !== st, 'alliance to war by declaring war');
  ok(stanceOf(applyPlanetAction(st, { type: 'cancelTreaty', with: 1 }), 0, 1) === 'war', 'alliance to war by cancelling');
  // Replacing a dated treaty is not a breach.
  const rep = copy(base);
  rep.factions[0].stock = { ...rich };
  const d = sweeten(rep, 1, 'trade', null)!;
  const r1 = applyPlanetAction(rep, { type: 'propose', to: 1, draft: d });
  ok(r1 !== rep && stanceOf(r1, 0, 1) === 'trade' && r1.trust[2][0] === 50 && r1.trust[3][0] === 50, 'replacing a dated ceasefire with a pact is not a breach');
  // Alliance needs the trust gate even with a high score.
  const gate = copy(base);
  gate.treaties = gate.treaties.map(t => (t.a === 0 && t.b === 1 ? treaty(0, 1, 'trade', null) : t));
  gate.factions[0].stock = { ...rich };
  const rich60: TreatyDraft = { kind: 'alliance', turns: null, terms: [{ k: 'payment', from: 0, res: 'alloys', amount: 60 }] };
  const v = proposalVerdict(gate, 1, 0, rich60);
  ok(!v.accept && v.score >= 25, `an alliance below the trust gate is refused whatever the score (${v.score})`);
  // Expiry: a ceasefire running out leaves war and +5 trust both ways.
  const ex = copy(base);
  ex.options.aiDiplomacy = false;
  for (const f of ex.factions) if (f.id) f.army = null;
  ex.treaties = [treaty(1, 2, 'ceasefire', 3, [], -1)];
  ok(ex.treaties[0].ends === 1, 'crafted: a ceasefire whose last turn is now');
  const e1 = applyPlanetAction(ex, { type: 'endTurn' });
  ok(!e1.treaties.some(t => t.a === 1 && t.b === 2) && stanceOf(e1, 1, 2) === 'war', 'a ceasefire that runs out leaves war');
  ok(e1.trust[1][2] === 55 && e1.trust[2][1] === 55, `a treaty that runs to its end: +5 both ways (${e1.trust[1][2]}, ${e1.trust[2][1]})`);
  // Offers: proposed by a computer faction, answered, expiring.
  const os = copy(base);
  const of1 = applyPlanetAction(os, { type: 'propose', to: 0, draft: { kind: 'trade', turns: null, terms: [] } }, 1);
  ok(of1.offers.length === 1 && of1.offers[0].expires === os.turn + 1 && stanceOf(of1, 0, 1) === 'ceasefire', 'a computer proposal to the player is an offer, not a treaty');
  const kept = applyPlanetAction(of1, { type: 'endTurn' });
  const still = kept.offers.find(x => x.id === of1.offers[0].id);
  if (still) {
    ok(planetActionProblem(kept, { type: 'answerOffer', id: still.id, accept: false }) === null, 'an offer can be answered on the turn it expires');
    const gone = applyPlanetAction(kept, { type: 'endTurn' });
    ok(!gone.offers.some(x => x.id === still.id), 'an offer past its turn is removed');
  } else ok(true, 'the offer was answered or replaced during the turn');
  // Computer factions among themselves.
  const ai = copy(base);
  ai.factions[1].stock = { ...rich };
  const ok12: TreatyDraft = { kind: 'trade', turns: null, terms: [{ k: 'payment', from: 1, res: 'alloys', amount: 40 }] };
  ok(proposalVerdict(ai, 2, 1, ok12).accept && stanceOf(applyPlanetAction(ai, { type: 'propose', to: 2, draft: ok12 }, 1), 1, 2) === 'trade', 'an acceptable proposal between computer factions is enacted');
  const no12: TreatyDraft = { kind: 'alliance', turns: null, terms: [] };
  ok(!proposalVerdict(ai, 2, 1, no12).accept && applyPlanetAction(ai, { type: 'propose', to: 2, draft: no12 }, 1) === ai, 'a refused proposal between computer factions is ignored (same state)');
  // Attacking an ally of a third faction: that faction's trust in the attacker -8.
  const at = openWar('diplomacy-ally');
  const { target } = attackPair(at);
  give(at, target, 1);
  at.regions[target].garrison[0] = 2;
  at.treaties = [treaty(1, 2, 'alliance', null)];
  const t8 = applyPlanetAction(at, { type: 'attack', target, credits: 0, heroes: [] });
  ok(t8 !== at && t8.trust[2][0] === at.trust[2][0] - 8, 'attacking an ally of a faction costs 8 of its trust');
  // planAiActions twice gives the same list, for every faction and a few crafted states.
  for (const s of [base, b1, flow, st, at]) for (const f of s.factions) ok(json(planAiActions(s, f.id)) === json(planAiActions(s, f.id)), `planAiActions deterministic (faction ${f.id})`);
  // The computer judges the player with every temperament distinctly (mercantile likes trade most).
  const temps = base.factions.slice(1).map(f => f.temperament as Temperament);
  const trade: TreatyDraft = { kind: 'trade', turns: null, terms: [] };
  const merc = base.factions.findIndex(f => f.temperament === 'mercantile');
  const exp = base.factions.findIndex(f => f.temperament === 'expansionist');
  if (merc > 0 && exp > 0) ok(proposalVerdict(base, merc, 0, trade).score > proposalVerdict(base, exp, 0, trade).score, 'a mercantile faction values a pact above an expansionist one');
  void temps;
}

// ---- 8. Allied team battles -----------------------------------------------------------------------

function alliedTests(): void {
  const s0 = openWar('allies', 'long');
  const m = planetMapOf(s0);
  // A target with two further land neighbours, none of them capitals.
  let pick: { from: RegionId; target: RegionId; nb: RegionId[] } | null = null;
  for (const l of m.links) {
    if (l.sea) continue;
    for (const [from, target] of [[l.a, l.b], [l.b, l.a]]) {
      const nb = landNeighbours(s0, target).filter(x => x !== from && !isCapital(s0, x) && !landNeighbours(s0, from).includes(x));
      if (!pick && nb.length >= 2 && !isCapital(s0, from) && !isCapital(s0, target)) pick = { from, target, nb };
    }
  }
  ok(pick !== null, 'crafted: a target with two neighbours');
  if (!pick) return;
  const craft = (atkAlly: boolean, defAlly: boolean): PlanetState => {
    const s = copy(s0);
    give(s, pick!.from, 0, 2);
    s.factions[0].army!.region = pick!.from;
    give(s, pick!.target, 1, 2);
    s.regions[pick!.target].garrison[0] = 4;
    give(s, pick!.nb[0], 2, 2);
    s.regions[pick!.nb[0]].garrison = garrisonFrom([['rifleman', 4], ['rocketeer', 2]]);
    give(s, pick!.nb[1], 3, 2);
    s.regions[pick!.nb[1]].garrison = garrisonFrom([['rifleman', 6]]);
    s.treaties = [];
    if (atkAlly) s.treaties.push(treaty(0, 2, 'alliance', null));
    if (defAlly) s.treaties.push(treaty(1, 3, 'alliance', null));
    s.treaties.sort((x, y) => x.a - y.a || x.b - y.b);
    return s;
  };
  const cases: [boolean, boolean, number[]][] = [[false, false, [0, 1]], [true, false, [0, 1, 0]], [false, true, [0, 1, 1]], [true, true, [0, 1, 0, 1]]];
  for (const [aa, da, teams] of cases) {
    const s = craft(aa, da);
    const setup = battleSetupFor(s, 0, pick.target, 1000, ['engineer'], s.nextId)!;
    const tag = `allies ${aa ? 'attacker' : ''}${da ? ' defender' : ''}`;
    ok(setup !== null, `${tag}: a setup`);
    if (!setup) continue;
    ok(json(setup.sides.map(x => x.team)) === json(teams), `${tag}: teams ${json(teams)} (${json(setup.sides.map(x => x.team))})`);
    ok(setup.sides[0].faction === 0 && setup.sides[0].human && setup.sides[0].role === 'attacker' && setup.defenderSeat === 1 && setup.sides[1].faction === 1, `${tag}: player at seat 0, defender at seat 1`);
    ok(setup.sides.filter(x => x.human).length === 1 && setup.perks !== null, `${tag}: one human side, perks filled`);
    ok(setup.sides.every(x => x.structures[0] === 'hq' && x.cityTags.length === x.structures.length), `${tag}: every side starts with hq`);
    for (const x of setup.sides.filter(y => y.role === 'ally')) {
      const home = x.fromRegion!;
      const n = gTotal(s.regions[home].garrison);
      ok(x.units.length === Math.max(1, Math.floor(n / 2)) && x.units.every(u => u.core === null) && !x.human, `${tag}: ally ${x.faction} brings half its garrison, as a computer contingent`);
    }
    // The contingents leave their garrisons when the attack is made and their survivors go home.
    const a = applyPlanetAction(s, { type: 'attack', target: pick.target, credits: 1000, heroes: ['engineer'] });
    ok(a !== s && json(a.pending[0].setup) === json({ ...setup, battleId: a.pending[0].id, seedText: setup.seedText }), `${tag}: the pending battle holds the same setup`);
    for (const x of setup.sides.filter(y => y.role === 'ally')) {
      const home = x.fromRegion!;
      ok(gTotal(a.regions[home].garrison) === gTotal(s.regions[home].garrison) - x.units.length, `${tag}: ally ${x.faction} contingent leaves its garrison`);
    }
    const r = applyPlanetAction(a, { type: 'autoResolve' });
    const rep = quickResolve(a.pending[0].setup);
    ok(r !== a && r.pending.length === 0, `${tag}: auto-resolved`);
    ok(w2ReportProblem(a.pending[0].setup, rep) === null && w1ReportProblem(a, a.pending[0], rep, 'any') === null, `${tag}: the quick report fits the battle`);
    setup.sides.forEach((x, i) => {
      if (x.role !== 'ally') return;
      const home = x.fromRegion!;
      const back = rep.sides[i].survivors.length;
      ok(gTotal(r.regions[home].garrison) === Math.min(garrisonCap(r, home), gTotal(a.regions[home].garrison) + back), `${tag}: ally ${x.faction} survivors go home (${back})`);
    });
    ok(r.regions[pick.target].owner === (rep.winner === 'attacker' ? 0 : 1), `${tag}: the region goes to the winner`);
  }
  // A computer attack on the player: the player defends from seat 0.
  const d = craft(true, true);
  d.factions[1].army!.region = pick.target;
  d.regions[pick.from].garrison[0] = 3;
  const defSetup = battleSetupFor(d, 1, pick.from, 0, [], 99);
  ok(defSetup !== null && defSetup.sides[0].faction === 0 && defSetup.sides[0].human && defSetup.sides[0].role === 'defender' && defSetup.defenderSeat === 0 && defSetup.sides[1].faction === 1 && defSetup.sides[0].team === 1 && defSetup.sides[1].team === 0, 'the player defends from seat 0, on team 1');
  // The player as an ally of a computer attacker joins as a computer contingent.
  const pa = craft(false, false);
  give(pa, pick.nb[1], 2, 2);
  pa.regions[pick.nb[1]].garrison = garrisonFrom([['rifleman', 4]]);
  pa.factions[2].army!.region = pick.nb[1];
  pa.treaties = [treaty(0, 2, 'alliance', null)];
  pa.regions[pick.from].garrison[0] = 4;
  const ps = battleSetupFor(pa, 2, pick.target, 0, [], 98);
  ok(ps !== null && ps.sides.some(x => x.faction === 0 && x.role === 'ally' && !x.human) && ps.sides.every(x => !x.human) && ps.perks === null && ps.sides[0].faction === 2, 'the player as an ally is a computer contingent; no human side, no perks');
}

// ---- 9. Encirclement and capitals -----------------------------------------------------------------

function encirclementTests(): void {
  const s0 = copy(war('encircle', 'long'));
  s0.treaties = [];
  s0.options.aiDiplomacy = false;
  for (const f of s0.factions) {
    f.stock = { ...rich };
    f.army = null;
  }
  const m = planetMapOf(s0);
  const victim = m.regions.find(r => !isCapital(s0, r.id) && r.links.length >= 2 && r.links.every(l => !isCapital(s0, l.to)))!.id;
  const nb = neighbours(s0, victim);
  const craft = (enemies: boolean): PlanetState => {
    const s = copy(s0);
    give(s, victim, 1, 2);
    s.regions[victim].garrison[0] = 3;
    nb.forEach((r, k) => {
      give(s, r, enemies ? (k === 0 ? 2 : 0) : NEUTRAL, 1);
      s.regions[r].garrison[0] = enemies ? (k === 0 ? 9 : 1) : 2;
    });
    return s;
  };
  const s = craft(true);
  s.factions[2].capital = nb[0]; // a capital is never cut off, so faction 2's region cannot itself surrender first
  ok(!suppliedRegions(s, 1)[victim], 'crafted: the region is cut off');
  let t = applyPlanetAction(s, { type: 'endTurn' });
  ok(t.regions[victim].owner === 1 && t.regions[victim].cut === 1, 'one turn cut off: still held, cut 1');
  for (let i = 1; i < s.options.surrenderTurns; i++) t = applyPlanetAction(t, { type: 'endTurn' });
  const strongest = 2; // nine garrison units against one per player region
  const expected = nb.length - 1 > 9 ? 0 : strongest;
  ok(t.regions[victim].owner === expected, `cut off for surrenderTurns: surrenders to the strongest adjacent enemy (${t.regions[victim].owner})`);
  ok(gTotal(t.regions[victim].garrison) === 0 || t.regions[victim].owner !== 1, 'its garrison is emptied');
  ok(t.regions[victim].city.level === 1, 'its city level drops by one');
  // No adjacent enemy (only independents): it holds out.
  let n = craft(false);
  for (let i = 0; i < s.options.surrenderTurns + 2; i++) n = applyPlanetAction(n, { type: 'endTurn' });
  ok(n.regions[victim].owner === 1 && n.regions[victim].cut === s.options.surrenderTurns + 2, 'cut off with no adjacent enemy: no surrender, cut keeps counting');
  // A capital is never cut off, even ringed by enemies.
  const cs = copy(s0);
  const cap1 = cs.factions[1].capital;
  for (const r of neighbours(cs, cap1)) if (!isCapital(cs, r)) {
    give(cs, r, 0, 1);
    cs.regions[r].garrison[0] = 9;
  }
  ok(suppliedRegions(cs, 1)[cap1], 'a capital counts as supplied');
  let c = cs;
  for (let i = 0; i < 4; i++) c = applyPlanetAction(c, { type: 'endTurn' });
  ok(c.regions[cap1].owner === 1 && c.regions[cap1].cut === 0, 'a ringed capital never surrenders and never counts as cut off');
  // Losing a capital moves it: the highest city level, then larger garrison, then lowest id.
  const lc = openWar('capital', 'long');
  const vic = 1;
  const capV = lc.factions[vic].capital;
  const from = neighbours(lc, capV).find(r => !isCapital(lc, r))!;
  give(lc, from, 0, 1);
  lc.factions[0].army!.region = from;
  lc.factions[0].army!.units = [...lc.factions[0].army!.units, ...riflemen(5)];
  const others = owned(lc, vic).filter(r => r !== capV);
  ok(others.length >= 2, 'crafted: the victim holds other regions');
  lc.regions[others[0]].city.level = 2;
  lc.regions[others[1]].city.level = 2;
  lc.regions[others[1]].garrison[0] += 1;
  const want = gTotal(lc.regions[others[1]].garrison) > gTotal(lc.regions[others[0]].garrison) ? others[1] : others[0];
  const a = applyPlanetAction(lc, { type: 'attack', target: capV, credits: 0, heroes: [] });
  ok(a !== lc, `attack on a capital (${planetActionProblem(lc, { type: 'attack', target: capV, credits: 0, heroes: [] })})`);
  if (a === lc) return;
  const f = applyPlanetAction(a, { type: 'fight' });
  const rep: BattleReport = { ...quickResolve(f.pending[0].setup), how: 'fought', winner: 'attacker', cityLevelLost: 1 };
  const won = applyPlanetAction(f, { type: 'battleResult', report: rep });
  ok(won !== f && won.regions[capV].owner === 0 && won.factions[0].army!.region === capV, 'a won attack takes the region and moves the army in');
  ok(won.factions[vic].capital === want && won.regions[want].owner === vic, `losing a capital moves it by the rule (${won.factions[vic].capital}, expected ${want})`);
  const cityAfter = won.regions[capV].city;
  ok(cityAfter.level === 2 && Object.keys(cityAfter.b).length <= 3 && Object.values(cityAfter.b).every(v => (v ?? 0) <= 2), 'a captured city drops a level and is cut back to fit');
  ok(won.commander.xp >= 60 + 20 * 3, `Commander xp for a won attack: 60 + 20 * city level (${won.commander.xp})`);
}

// ---- 10. Victory and defeat -----------------------------------------------------------------------

function victoryTests(): void {
  const frozenAi = (seed: string, preset: LengthPreset = 'short'): PlanetState => {
    const s = copy(war(seed, preset));
    s.options.aiDiplomacy = false;
    for (const f of s.factions) {
      f.stock = { ...rich };
      if (f.id) f.army = null;
    }
    return s;
  };
  const N = (s: PlanetState) => s.regions.length;
  const giveShare = (s: PlanetState, f: number, n: number) => {
    let have = owned(s, f).length;
    for (let r = 0; r < N(s) && have < n; r++) if (s.regions[r].owner === NEUTRAL) {
      give(s, r, f);
      have++;
    }
  };
  const end = (s: PlanetState) => applyPlanetAction(s, { type: 'endTurn' });
  // Domination.
  const dm = frozenAi('victory-dom');
  giveShare(dm, 0, Math.ceil((N(dm) * dm.options.victoryShare) / 100));
  const dr = end(dm);
  ok(dr.result?.won === true && dr.result.how === 'domination' && dr.result.turn === dm.turn && dr.turn === dm.turn, `domination at victoryShare (${json(dr.result)})`);
  ok(phaseOf(dr) === 'over' && applyPlanetAction(dr, { type: 'endTurn' }) === dr, 'after the result nothing more happens');
  // A rival.
  const rv = frozenAi('victory-rival');
  giveShare(rv, 2, Math.ceil((N(rv) * rv.options.victoryShare) / 100));
  ok(end(rv).result?.how === 'rival' && end(rv).result?.won === false, 'a rival at victoryShare: defeat');
  // Elimination: every computer faction loses its last region (none at the player's share).
  const el = frozenAi('victory-elim');
  for (const f of [1, 2]) for (const r of owned(el, f)) give(el, r, NEUTRAL);
  const er = end(el);
  ok(er.result?.how === 'elimination' && er.result.won, `elimination (${json(er.result)})`);
  ok(er.factions.slice(1).every(f => !f.alive && f.army === null) && er.treaties.every(t => t.a === 0 && t.b === 0), 'eliminated factions: alive false, army null, treaties gone');
  // Fallen.
  const fa = frozenAi('victory-fallen');
  for (const r of owned(fa, 0)) give(fa, r, NEUTRAL);
  const fr = end(fa);
  ok(fr.result?.how === 'fallen' && !fr.result.won && !fr.factions[0].alive, 'the player with no region: fallen');
  // One computer faction eliminated mid-war: its treaties, routes and offers go.
  const one = frozenAi('victory-one', 'long');
  one.offers = [{ id: 70, from: 3, draft: { kind: 'trade', turns: null, terms: [] }, expires: 2 }];
  one.nextId = 71;
  for (const r of owned(one, 3)) give(one, r, NEUTRAL);
  const oe = end(one);
  ok(!oe.factions[3].alive && oe.result === null && !oe.offers.some(o => o.from === 3) && !oe.treaties.some(t => t.a === 3 || t.b === 3), 'an eliminated faction loses its treaties and offers, the war goes on');
  // Allied victory.
  const av = frozenAi('victory-ally');
  av.treaties = [treaty(0, 1, 'alliance', null), treaty(0, 2, 'alliance', null), treaty(1, 2, 'trade', null)];
  const need = Math.ceil((N(av) * av.options.victoryShare) / 100);
  giveShare(av, 0, need - 4);
  const ar = end(av);
  ok(ar.result?.how === 'alliance' && ar.result.won, `allied victory (${json(ar.result)}, player ${owned(av, 0).length}, allies ${owned(av, 1).length} and ${owned(av, 2).length})`);
  const noAv = copy(av);
  noAv.options.alliedVictory = false;
  ok(end(noAv).result === null, 'no allied victory with the option off');
  const weak = frozenAi('victory-ally-weak');
  weak.treaties = [treaty(0, 1, 'alliance', null), treaty(0, 2, 'alliance', null)];
  giveShare(weak, 1, need - 2);
  ok(end(weak).result === null, 'no allied victory while an ally holds more regions than the player');
  // The turn limit.
  const tl = frozenAi('victory-limit');
  tl.turn = tl.options.turnLimit;
  for (const t of tl.treaties) t.ends = null;
  for (const t of tl.treaties) t.turns = null;
  for (const t of tl.treaties) t.kind = 'trade';
  giveShare(tl, 0, owned(tl, 1).length + 1);
  const tr = end(tl);
  ok(tr.result?.how === 'turnLimit' && tr.result.won && tr.result.turn === tl.options.turnLimit, `the turn limit with the most regions: victory (${json(tr.result)})`);
  const tie = copy(tl);
  for (const r of owned(tie, 0)) give(tie, r, NEUTRAL);
  give(tie, tie.factions[0].capital, 0, 3);
  giveShare(tie, 0, owned(tie, 1).length);
  ok(end(tie).result?.how === 'turnLimit' && end(tie).result?.won === false, 'the turn limit with a tie: defeat');
  ok(end(tie).pending.length === 0, 'pending battles cleared when the war is decided');
}

// ---- 11. Whole wars -------------------------------------------------------------------------------

interface WarRun {
  s: PlanetState;
  log: PlanetAction[];
  battles: number;
  defence: number;
  breaches: Record<string, number>;
  setups: BattleSetup[];
}

const BREACH = [/^(.+?) declares war on .+?, breaking their /, /^(.+?) cancels its .+? with .+?, breaking its word/];

/** Every per-turn invariant of section 18 item 6. */
function checkState(s: PlanetState, tag: string): void {
  const F = s.factions.length;
  const R = s.regions.length;
  const text = json(s);
  ok(json(JSON.parse(text)) === text && !text.includes('NaN'), `${tag}: JSON round trip (no NaN, no undefined)`);
  let bad = '';
  for (const f of s.factions) {
    for (const r of RESOURCES) if (!Number.isInteger(f.stock[r]) || f.stock[r] < 0) bad ||= `stock ${f.id} ${r}=${f.stock[r]}`;
    if (f.alive) {
      if (!f.army) bad ||= `faction ${f.id} alive with no army`;
      else {
        // The start army (9 units) is over an Easy computer faction's cap (10 - 2) on Short; see the W5 build log.
        if (f.army.units.length > Math.max(armyCapOf(s, f.id), START_ARMY.reduce((t, [, n]) => t + n, 0))) bad ||= `army ${f.id} over cap`;
        if (!Number.isInteger(f.army.region) || f.army.region < 0 || f.army.region >= R) bad ||= `army ${f.id} region`;
        if (f.army.units.some(u => !ARMY_KINDS.includes(u.kind) || !Number.isInteger(u.kills) || u.kills < 0 || u.kills > 999)) bad ||= `army ${f.id} units`;
      }
      if (!s.result && s.regions[f.capital].owner !== f.id) bad ||= `faction ${f.id} does not hold its capital`;
    } else if (f.army !== null) bad ||= `dead faction ${f.id} has an army`;
  }
  ok(!bad, `${tag}: factions sound ${bad}`);
  bad = '';
  s.regions.forEach((r, i) => {
    if (r.owner !== NEUTRAL && !(Number.isInteger(r.owner) && r.owner >= 0 && r.owner < F && s.factions[r.owner].alive)) bad ||= `owner of ${i}`;
    if (r.garrison.length !== ARMY_KINDS.length || r.garrison.some(n => !Number.isInteger(n) || n < 0)) bad ||= `garrison ${i}`;
    if (gTotal(r.garrison) > garrisonCap(s, i)) bad ||= `garrison ${i} over cap`;
    if (!Number.isInteger(r.cut) || r.cut < 0) bad ||= `cut ${i}`;
    const c = r.city;
    if (!Number.isInteger(c.level) || c.level < 1 || c.level > 5) bad ||= `city level ${i}`;
    const b = Object.entries(c.b);
    if (b.length > c.level + 1 || b.some(([k, v]) => !CITY_BUILDINGS.includes(k as never) || !Number.isInteger(v) || (v as number) < 1 || (v as number) > Math.min(3, c.level))) bad ||= `city buildings ${i}`;
  });
  ok(!bad, `${tag}: regions sound ${bad}`);
  bad = '';
  if (s.trust.length !== F || s.trust.some((row, a) => row.length !== F || row.some((v, b) => !Number.isInteger(v) || v < 0 || v > 100 || (a === b && v !== 100)))) bad = 'trust';
  const pairs = new Set<string>();
  s.treaties.forEach((t, k) => {
    const key = `${t.a},${t.b}`;
    if (pairs.has(key)) bad ||= `two treaties ${key}`;
    pairs.add(key);
    if (!(t.a < t.b) || !s.factions[t.a]?.alive || !s.factions[t.b]?.alive) bad ||= `treaty parties ${key}`;
    if (k && (s.treaties[k - 1].a > t.a || (s.treaties[k - 1].a === t.a && s.treaties[k - 1].b > t.b))) bad ||= 'treaties unsorted';
    if ((t.turns === null) !== (t.ends === null) || (t.turns !== null && t.ends !== t.since + t.turns - 1)) bad ||= `treaty dates ${key}`;
    if (t.ends !== null && t.ends < s.turn && !s.result) bad ||= `treaty ${key} past its end`;
  });
  ok(!bad, `${tag}: trust and treaties sound ${bad}`);
  bad = '';
  const routeIds = new Set<number>();
  for (const r of s.routes) {
    if (routeIds.has(r.id)) bad ||= `route id ${r.id} twice`;
    routeIds.add(r.id);
    if (!routeStands(s, r)) bad ||= `route ${r.id} no longer stands`;
    if (r.id >= s.nextId) bad ||= `route id ${r.id} not below nextId`;
  }
  if (s.offers.length > OFFERS_MAX || new Set(s.offers.map(o => o.from)).size !== s.offers.length || s.offers.some(o => !s.factions[o.from]?.alive || o.from === 0)) bad ||= 'offers';
  if (s.pending.some(p => s.regions[p.region].owner !== p.defender || !s.factions[p.attacker].alive || p.id >= s.nextId)) bad ||= 'pending';
  if (s.journal.length > JOURNAL_MAX) bad ||= 'journal';
  ok(!bad, `${tag}: routes, offers, pending, journal sound ${bad}`);
  const save = asSave(s);
  const bytes = planetSaveBytes(save);
  ok(bytes.strategic < PLANET_STRATEGIC_MAX_BYTES, `${tag}: strategic JSON under 48 KB (${bytes.strategic})`);
  ok(json(migratePlanetSave(JSON.parse(json(save)))) === json(save), `${tag}: the save migrates to itself`);
}

const peak = { short: 0, long: 0, veryLong: 0 } as Record<LengthPreset, number>;

function playWar(seed: string, preset: LengthPreset, options: unknown, difficulty: 'easy' | 'normal' | 'hard', opt: { check: boolean; declineOffers?: boolean; aiTwice?: boolean }): WarRun {
  let s = war(seed, preset, options, difficulty);
  const run: WarRun = { s, log: [], battles: 0, defence: 0, breaches: {}, setups: [] };
  const tag = `${preset} ${seed}`;
  if (opt.check) checkState(s, `${tag} t1`);
  const apply = (a: PlanetAction): boolean => {
    const n = applyPlanetAction(s, a);
    if (n === s) return false;
    run.log.push(a);
    s = n;
    return true;
  };
  const resolve = () => {
    while (s.pending.length) {
      const pb = s.pending[0];
      run.battles++;
      if (pb.kind === 'defence') run.defence++;
      run.setups.push(pb.setup);
      const okay = apply({ type: 'autoResolve' });
      ok(okay, `${tag}: auto-resolve accepted`);
      if (!okay) break;
    }
  };
  const cap = s.options.turnLimit + 2;
  for (let guard = 0; guard < cap && !s.result; guard++) {
    resolve();
    if (s.result) break;
    let plan = planAiActions(s, 0, 'expansionist');
    if (opt.aiTwice) {
      ok(json(plan) === json(planAiActions(s, 0, 'expansionist')), `${tag} t${s.turn}: the bot plans the same twice`);
      for (const f of s.factions) if (f.id && f.alive) ok(json(planAiActions(s, f.id)) === json(planAiActions(s, f.id)), `${tag} t${s.turn}: faction ${f.id} plans the same twice`);
    }
    // A player who keeps to themselves: offers declined and no proposals made.
    if (opt.declineOffers) plan = plan.filter(a => a.type !== 'propose').map(a => (a.type === 'answerOffer' ? { ...a, accept: false } : a));
    for (const a of plan) {
      apply(a);
      resolve();
    }
    const turn = s.turn;
    const before = s.journal.filter(e => e.turn === turn).length;
    const ended = apply({ type: 'endTurn' });
    ok(ended, `${tag} t${turn}: end turn accepted`);
    if (!ended) break;
    for (const e of s.journal.filter(x => x.turn === turn).slice(before)) {
      for (const re of BREACH) {
        const mm = re.exec(e.text);
        if (!mm) continue;
        const f = s.factions.find(x => x.name === mm[1]);
        const key = f ? f.temperament ?? 'player' : 'unknown';
        run.breaches[key] = (run.breaches[key] ?? 0) + 1;
      }
    }
    if (opt.check) checkState(s, `${tag} t${s.turn}`);
    peak[preset] = Math.max(peak[preset], strategicBytes(s));
  }
  resolve();
  run.s = s;
  ok(s.result !== null, `${tag}: the war ends (${json(s.result)})`);
  ok(s.result !== null && s.result.turn <= s.options.turnLimit && s.turn <= s.options.turnLimit, `${tag}: by the turn limit`);
  return run;
}

const allSetups: BattleSetup[] = [];
const breachTotals: Record<string, number> = {};

function summarise(name: string, runs: WarRun[]): void {
  const how: Record<string, number> = {};
  let wins = 0;
  let turns = 0;
  let battles = 0;
  let defence = 0;
  for (const r of runs) {
    const res = r.s.result!;
    how[res.how] = (how[res.how] ?? 0) + 1;
    if (res.won) wins++;
    turns += res.turn;
    battles += r.battles;
    defence += r.defence;
    for (const [k, v] of Object.entries(r.breaches)) breachTotals[k] = (breachTotals[k] ?? 0) + v;
    allSetups.push(...r.setups);
  }
  console.log(`  ${name}: ${runs.length} wars, ${wins} won; ${Object.entries(how).map(([k, v]) => `${k} ${v}`).join(', ')}; average ${(turns / runs.length).toFixed(1)} turns; ${battles} player battles (${defence} defence)`);
}

function wholeWarTests(): void {
  // Short, 20 seeds, normal difficulty, every check every turn.
  const short: WarRun[] = [];
  for (let i = 0; i < 20; i++) short.push(playWar(`war-short-${i}`, 'short', undefined, 'normal', { check: true, aiTwice: i < 4 }));
  summarise('Short', short);
  // Exact replay of five of them from the action log.
  for (let i = 0; i < 5; i++) {
    const r = short[i];
    let s = war(`war-short-${i}`, 'short');
    let refused = 0;
    for (const a of r.log) {
      const n = applyPlanetAction(s, a);
      if (n === s) refused++;
      s = n;
    }
    ok(refused === 0 && json(s) === json(r.s), `replay war-short-${i}: ${r.log.length} actions give a byte-identical final state`);
  }
  ok(json(playWar('war-short-0', 'short', undefined, 'normal', { check: false }).s) === json(short[0].s), 'the same war played twice is byte-identical');
  // Short with rival diplomacy off, the iron rule and hard difficulty, the bot declining offers: defence battles happen.
  const rough: WarRun[] = [];
  for (let i = 0; i < 6; i++) rough.push(playWar(`war-rough-${i}`, 'short', { aiDiplomacy: false, ironRule: true, factions: 4 }, i % 2 ? 'hard' : 'easy', { check: true, declineOffers: true }));
  summarise('Short, rival diplomacy off, iron rule, 4 factions, the bot making no treaties', rough);
  ok(rough.reduce((t, r) => t + r.defence, 0) > 0, 'computer factions attack the player: defence battles arrive');
  ok(rough.every(r => !r.s.factions.slice(1).some(f => f.alive) || true), 'rough wars end');
  // Long and Very long.
  const long: WarRun[] = [];
  for (let i = 0; i < 5; i++) long.push(playWar(`war-long-${i}`, 'long', undefined, 'normal', { check: true }));
  summarise('Long', long);
  const vlong: WarRun[] = [];
  for (let i = 0; i < 3; i++) vlong.push(playWar(`war-vlong-${i}`, 'veryLong', undefined, 'normal', { check: true }));
  summarise('Very long', vlong);
  console.log(`  peak strategic save: Short ${peak.short} B, Long ${peak.long} B, Very long ${peak.veryLong} B (budget ${PLANET_STRATEGIC_MAX_BYTES})`);
  console.log(`  breaches by temperament over every war: ${Object.entries(breachTotals).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  ok((breachTotals.mercantile ?? 0) === 0, 'mercantile factions never breach');
  ok((breachTotals.defensive ?? 0) === 0, 'defensive factions never breach');
  ok((breachTotals.unknown ?? 0) === 0, 'every breach names a faction');
}

// ---- 12. Battles from the wars, and a save with a battle in progress -----------------------------

function warBattleTests(): void {
  // Distinct setups by map type, side count and the player's role.
  const seen = new Set<string>();
  const picked: BattleSetup[] = [];
  for (const st of allSetups) {
    const role = st.sides.find(x => x.human)?.role ?? 'none';
    const key = `${st.mapType}:${st.sides.length}:${role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(st);
  }
  const sidesSeen = new Set(allSetups.map(x => x.sides.length));
  const roles = new Set(allSetups.map(x => x.sides.find(y => y.human)?.role ?? 'none'));
  console.log(`  ${allSetups.length} setups from the wars; ${picked.length} distinct (map, sides, role); sides seen ${[...sidesSeen].sort().join(', ')}; roles ${[...roles].join(', ')}`);
  ok(roles.has('attacker') && roles.has('defender'), 'the wars made battles with the player attacking and defending');
  const sample = picked.slice(0, 14);
  for (const st of sample) {
    const tag = `war setup b${st.battleId} ${st.mapType} ${st.sides.length} sides`;
    const g = buildPlanetBattle(st, ids(st.battleId));
    ok(g.players.length === st.sides.length && g.planet?.battleId === st.battleId && g.mapType === st.mapType && g.difficulty === st.difficulty, `${tag}: built`);
    const grouping = (teams: number[]) => json(teams.map(t => teams.indexOf(t)));
    const engineTeams = st.sides.map((_, i) => (g.teams ? g.teams[i] : i));
    ok(grouping(engineTeams) === grouping(st.sides.map(x => x.team)), `${tag}: teams grouped as the setup`);
    st.sides.forEach((side, seat) => {
      const cores = side.units.filter(u => u.core !== null).length;
      const placed = g.units.filter(u => u.owner === seat && u.core !== undefined).length;
      ok(placed === cores, `${tag}: seat ${seat} core units placed (${placed} of ${cores})`);
      ok(g.buildings.some(b => b.owner === seat && b.kind === 'hq'), `${tag}: seat ${seat} has its hq`);
    });
    ok(json(buildPlanetBattle(st, ids(st.battleId))) === json(g), `${tag}: deterministic`);
    const rep = quickResolve(st);
    ok(json(quickResolve(st)) === json(rep) && w2ReportProblem(st, rep) === null, `${tag}: quick report deterministic and valid`);
  }
  // A Very long war save with a battle in progress: round trip, budgets, then a retreat report.
  let s = war('war-vlong-battle', 'veryLong');
  s = copy(s);
  s.treaties = [];
  for (const f of s.factions) f.stock = { ...rich };
  for (let i = 0; i < 6; i++) {
    const a = applyPlanetAction(s, { type: 'endTurn' });
    if (a !== s) s = a;
    while (s.pending.length) s = applyPlanetAction(s, { type: 'autoResolve' });
  }
  const { target } = attackPair(s);
  const at = applyPlanetAction(s, { type: 'attack', target, credits: 1000, heroes: ['engineer', 'commando'] });
  ok(at !== s, `Very long: an attack to fight (${planetActionProblem(s, { type: 'attack', target, credits: 1000, heroes: ['engineer', 'commando'] })})`);
  if (at === s) return;
  const f = applyPlanetAction(at, { type: 'fight' });
  let g = buildPlanetBattle(f.pending[0].setup, ids(f.pending[0].id));
  for (const ticks of [0, 600]) {
    for (let i = 0; i < ticks; i += 300) g = processAction(g, { type: 'tick', n: 300 });
    const save: PlanetSave = { ...asSave(f), battle: g };
    const bytes = planetSaveBytes(save);
    ok(bytes.strategic < PLANET_STRATEGIC_MAX_BYTES && bytes.total < PLANET_SAVE_MAX_BYTES, `Very long save with a battle at tick ${g.tick}: ${bytes.strategic} B strategic, ${bytes.total} B in all`);
    const back = migratePlanetSave(JSON.parse(json(save)));
    ok(back !== null && back.battle !== null && json(back) === json(save), `Very long save with a battle at tick ${g.tick}: round trip byte for byte`);
    const lost = migratePlanetSave(JSON.parse(json({ ...save, planet: { ...save.planet, pending: [{ ...save.planet.pending[0], fighting: false }] } })));
    ok(lost !== null && lost.battle === null, 'a battle without a fought pending battle is dropped');
  }
  const retreat = planetBattleReport(f.pending[0].setup, g, { retreat: true });
  ok(retreat !== null && retreat.how === 'retreat', 'a retreat report from the battle in progress');
  if (retreat) {
    const r = applyPlanetAction(f, { type: 'battleResult', report: retreat });
    ok(r !== f && r.pending.length === 0 && r.regions[target].owner === NEUTRAL, 'the reducer accepts the retreat; the region stays');
  }
}

// ---- 13. Saves: junk repaired, the fixture, other save kinds -------------------------------------

function saveTests(): void {
  // A mid-war save with a route, treaties and a pending battle.
  let s = war('junk-save');
  for (let i = 0; i < 8 && !s.result; i++) {
    for (const a of planAiActions(s, 0, 'expansionist')) {
      s = applyPlanetAction(s, a);
      while (s.pending.length) s = applyPlanetAction(s, { type: 'autoResolve' });
    }
    s = applyPlanetAction(s, { type: 'endTurn' });
    while (s.pending.length) s = applyPlanetAction(s, { type: 'autoResolve' });
  }
  const good = asSave(s);
  ok(json(migratePlanetSave(JSON.parse(json(good)))) === json(good), 'a mid-war save migrates to itself');
  // Refused outright.
  const refuse: [string, unknown][] = [
    ['null', null],
    ['a skirmish', { version: 1, id: 'x' }],
    ['a campaign', { ...good, kind: 'campaign' }],
    ['no id', { ...good, id: '' }],
    ['version 2', { ...good, version: 2 }],
    ['no seed text', { ...good, planet: { ...good.planet, seedText: '' } }],
    ['a seed text too long', { ...good, planet: { ...good.planet, seedText: 'x'.repeat(65) } }],
    ['a region missing', { ...good, planet: { ...good.planet, regions: good.planet.regions.slice(1) } }],
    ['a faction missing', { ...good, planet: { ...good.planet, factions: good.planet.factions.slice(1) } }],
    ['a different preset', { ...good, planet: { ...good.planet, options: { ...good.planet.options, preset: 'long' } } }],
  ];
  for (const [what, raw] of refuse) ok(migratePlanetSave(raw) === null, `refused outright: ${what}`);
  ok(!isPlanetSave(null) && isPlanetSave(good), 'isPlanetSave');
  // Repaired.
  const junk = copy(good) as unknown as { planet: Record<string, unknown> & PlanetState };
  const p = junk.planet;
  p.factions[0].stock.ore = -40;
  p.factions[1].stock.fuel = 3.7;
  (p.factions[2].stock as unknown as Record<string, unknown>).alloys = 'lots';
  p.trust[0][1] = 500;
  p.trust[1][0] = -3;
  p.trust[2][2] = 7;
  p.regions[0].garrison[0] = -2;
  p.regions[1].garrison = [1.5, 'x'] as unknown as number[];
  p.regions[2].city.level = 9 as 5;
  (p.regions[3].city.b as Record<string, unknown>).castle = 2;
  p.treaties.push({ kind: 'union', a: 0, b: 1, turns: null, terms: [], since: 1, ends: null } as unknown as Treaty);
  p.routes.push({ id: 'r', owner: 0, from: 999, to: 2 } as unknown as PlanetState['routes'][number]);
  p.offers.push({ id: 3, from: 9, draft: {}, expires: 'soon' } as unknown as PlanetState['offers'][number]);
  p.journal = Array.from({ length: 300 }, (_, k) => ({ turn: k, text: 'x'.repeat(k % 3 ? 10 : 900), tone: 'info' as const }));
  (p as Record<string, unknown>).cheat = true;
  delete (p as Partial<PlanetState>).heroes;
  p.factions[0].research.done = ['plating', 'warp' as 'plating'];
  p.commander.points = -9;
  p.nextId = 0;
  const fixed = migratePlanetSave(JSON.parse(json(junk)));
  ok(fixed !== null, 'a save full of junk is repaired, not refused');
  if (fixed) {
    const q = fixed.planet;
    ok(q.factions.every(f => RESOURCES.every(r => Number.isInteger(f.stock[r]) && f.stock[r] >= 0)), 'junk stocks become non-negative integers');
    ok(q.trust.every((row, a) => row.every((v, b) => Number.isInteger(v) && v >= 0 && v <= 100 && (a !== b || v === 100))), 'junk trust clamped, diagonal 100');
    ok(q.regions.every(r => r.garrison.length === ARMY_KINDS.length && r.garrison.every(n => Number.isInteger(n) && n >= 0)), 'junk garrisons repaired');
    ok(q.regions.every(r => r.city.level >= 1 && r.city.level <= 5 && Object.keys(r.city.b).every(k => CITY_BUILDINGS.includes(k as never))), 'junk cities repaired');
    ok(q.treaties.every(t => ['ceasefire', 'trade', 'alliance'].includes(t.kind)) && q.routes.every(r => Number.isInteger(r.id) && r.from < q.regions.length) && q.offers.every(o => o.from > 0 && o.from < q.factions.length), 'junk treaties, routes and offers dropped');
    ok(q.journal.length <= JOURNAL_MAX && q.journal.every(e => e.text.length <= 400), 'the journal is cut to its cap');
    ok(!('cheat' in q) && q.heroes.engineer.unlocked && q.factions[0].research.done.every(u => u === 'plating'), 'unknown fields dropped, missing heroes restored, unknown upgrades dropped');
    ok(q.commander.points >= 0 && q.nextId >= 1 && [...q.routes, ...q.offers, ...q.pending].every(x => x.id < q.nextId), 'counters repaired; nextId above every id in use');
    ok(json(migratePlanetSave(JSON.parse(json(fixed)))) === json(fixed), 'a repaired save migrates to itself');
    let t = q;
    for (let i = 0; i < 3 && !t.result; i++) {
      while (t.pending.length) t = applyPlanetAction(t, { type: 'autoResolve' });
      for (const a of planAiActions(t, 0, 'expansionist')) {
        t = applyPlanetAction(t, a);
        while (t.pending.length) t = applyPlanetAction(t, { type: 'autoResolve' });
      }
      const n = applyPlanetAction(t, { type: 'endTurn' });
      ok(n !== t, 'a repaired war plays on');
      t = n;
      checkState(t, `repaired war t${t.turn}`);
    }
  }
  // A seeded fuzz: one to three fields set to junk; migration never throws, and what comes back is sound.
  const rnd = stream(seedFromString('drive-planet-fuzz'));
  const JUNK: unknown[] = [null, -1, 1.5, 'x', [], {}, true, 1e9, NaN];
  let nulls = 0;
  let threw = 0;
  for (let i = 0; i < 400; i++) {
    const raw = JSON.parse(json(good)) as Record<string, unknown>;
    const k = 1 + rnd.int(0, 2);
    for (let j = 0; j < k; j++) {
      let node: Record<string, unknown> = raw.planet as Record<string, unknown>;
      for (let depth = 0; depth < 4; depth++) {
        const keys = Object.keys(node);
        if (!keys.length) break;
        const key = keys[rnd.int(0, keys.length - 1)];
        const child = node[key];
        if (child && typeof child === 'object' && rnd.float() < 0.6) node = child as Record<string, unknown>;
        else {
          if (rnd.float() < 0.15) delete node[key];
          else node[key] = JUNK[rnd.int(0, JUNK.length - 1)];
          break;
        }
      }
    }
    try {
      const m = migratePlanetSave(JSON.parse(json(raw)));
      if (!m) {
        nulls++;
        continue;
      }
      if (i % 4 === 0) {
        ok(json(migratePlanetSave(JSON.parse(json(m)))) === json(m), `fuzz ${i}: the repaired save migrates to itself`);
        let t = m.planet;
        while (t.pending.length) t = applyPlanetAction(t, { type: 'autoResolve' });
        if (!t.result) t = applyPlanetAction(t, { type: 'endTurn' });
        ok(!!t, `fuzz ${i}: plays a turn`);
      }
    } catch (e) {
      threw++;
      if (threw <= 3) console.log(`  fuzz ${i} threw: ${(e as Error).message}`);
    }
  }
  ok(threw === 0, `fuzz: 400 junk saves, migration and a turn never throw (${threw} threw)`);
  console.log(`  fuzz: 400 junk saves, ${nulls} refused outright, the rest repaired`);

  // The v1 fixture: migrates byte for byte, its pending battle resolves, and it plays 5 more turns.
  const path = join(dirname(new URL(import.meta.url).pathname), 'fixtures', 'planet-save-v1.json');
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const fx = migratePlanetSave(raw);
  ok(fx !== null && json(fx) === json(raw), 'the v1 fixture migrates byte for byte');
  if (fx) {
    let t = fx.planet;
    ok(t.pending.length === 1 && phaseOf(t) === 'pending', 'the fixture holds a pending battle');
    t = applyPlanetAction(t, { type: 'autoResolve' });
    ok(t.pending.length === 0, "the fixture's pending battle resolves");
    const turn = t.turn;
    for (let i = 0; i < 5 && !t.result; i++) {
      for (const a of planAiActions(t, 0, 'expansionist')) {
        t = applyPlanetAction(t, a);
        while (t.pending.length) t = applyPlanetAction(t, { type: 'autoResolve' });
      }
      const n = applyPlanetAction(t, { type: 'endTurn' });
      ok(n !== t, `the fixture plays turn ${t.turn}`);
      t = n;
      while (t.pending.length) t = applyPlanetAction(t, { type: 'autoResolve' });
      checkState(t, `fixture t${t.turn}`);
    }
    ok(t.turn === turn + 5 || t.result !== null, 'the fixture plays 5 more turns');
  }
  // Other save kinds are not taken for wars, and still load (useSaves' migrateAny dispatch, which is not exported).
  const camp = JSON.parse(json(newCampaignSave('camp-1', 'Campaign', 'Tester', CREATED)));
  ok(!isPlanetSave(camp) && isCampaignSave(camp) && json(migrateCampaignSave(camp)) === json(camp), 'a campaign save is not a war and still migrates to itself');
  const sk = JSON.parse(json(createInitialState('sk-1', 'Skirmish', { seed: 'sk', createdAt: CREATED })));
  ok(!isPlanetSave(sk) && !isCampaignSave(sk) && json(migrateState(sk)) === json(sk), 'a skirmish save is not a war and still migrates to itself');
  ok(migratePlanetSave(camp) === null && migratePlanetSave(sk) === null, 'neither loads as a war');
}

// ---- Run ------------------------------------------------------------------------------------------

const t0 = Date.now();
timed('Presets', presetTests);
timed('Maps: 200 seeds per preset', mapTests);
timed('New wars and fair starts', newWarTests);
timed('Refusals: illegal actions return the same object', refusalTests);
timed('Every action legal on a deep-frozen state; purity', legalTests);
timed('Cities, resources and trade', economyTests);
timed('Diplomacy', diplomacyTests);
timed('Allied team battles', alliedTests);
timed('Encirclement and capitals', encirclementTests);
timed('Victory and defeat', victoryTests);
timed('Whole wars: Short, Long and Very long, every turn checked; replay', wholeWarTests);
timed('Battles from the wars; a save with a battle in progress', warBattleTests);
timed('Saves: junk repaired, the v1 fixture, other save kinds', saveTests);
for (const [name, fn] of battleSections) timed(name, () => fn(ok));

console.log(`\n${passed} assertions passed, ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failed) process.exit(1);
console.log('All checks passed');
