/**
 * Grand War, phase G0 (fireline-grand-war-design.md): the foundations a multi-hour four-sided
 * Continental game needs. Its sections run inside scripts/drive.ts; the long-battle save is deep-only
 * (DEEP_SECTIONS).
 *
 *  - Saves as tables (src/sim/pack.ts, `packRows`): units, structures and the adaptive commanders'
 *    memory, exact both ways, malformed tables refused, older packed saves still loading.
 */
import { processAction } from '../src/sim/actions';
import { allCities, cityLevel, citiesOf, districtCap, districtsOf, grandOn, isDistrict, townCentre, townsOf } from '../src/sim/cities';
import { placementProblem } from '../src/sim/commands';
import { deployProblem } from '../src/sim/engineering';
import { cityCounts, cityHousing, foundingProblem, townGarrisonMax } from '../src/sim/grand';
import { isWalkable } from '../src/sim/map';
import { packRows, packState, TABLES_V1, unpackRows } from '../src/sim/pack';
import {
  BUILDINGS,
  CITY_BEAT,
  CITY_FOUNDED_POP,
  CITY_FOUNDING_COST,
  CITY_GAP,
  CITY_START_POP,
  DEFAULT_SETUP,
  GRAND_OPTION_KEYS,
  GRAND_PRESET_ORDER,
  GRAND_PRESETS,
  HOUSING,
  TOWN_INCOME,
  TOWN_SIZE,
  type BuildingKind,
  type Owner,
} from '../src/sim/rules';
import { addBuilding, addUnit, createInitialState, migrateState, normaliseGrand, normaliseSetup } from '../src/sim/state';
import { territoryGrid } from '../src/sim/territory';
import type { Building, GameState } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;
const json = (x: unknown): string => JSON.stringify(x);
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** A four-sided Continental battle with the full economy: what a Grand War will be built on. */
export const grandBattle = (seed: string, sides: 2 | 3 | 4 = 4): GameState =>
  createInitialState(`grand-${seed}`, seed, {
    seed,
    difficulty: 'normal',
    createdAt: 0,
    autopilot: true,
    setup: {
      map: 'random', tech: 'advanced', sides, mode: 'ffa', size: 'continental', research: 'lines', pace: 'long',
      sites: true, industry: true, supply: true, territory: true, production: true, upkeep: true, seasons: true,
    },
  });

function rowsTests(ok: Ok): void {
  const objs = [
    { id: 1, order: { type: 'idle' }, path: [], hp: 60 },
    { id: 2, order: { type: 'idle' }, path: [], hp: 60 },
    { id: 3, order: { type: 'move', x: 4 }, path: [5, 6], hp: 12.345678901234567 },
    { id: 4, hp: 60, order: { type: 'idle' }, path: [] },
    { id: 5, order: { type: 'idle' }, gone: undefined, path: [], hp: 60 },
    { id: 6, order: null, path: [], hp: -0.5, ty: 1e-323 },
  ];
  const t = packRows(objs);
  const back = unpackRows(copy(t));
  ok(back !== null && json(back) === json(objs), 'a table gives back every object, every value and the key order');
  ok(t.k.length === 3, `one shape per distinct key order (${t.k.length})`);
  ok(back !== null && !('gone' in back[4]), 'a key holding undefined is left out, as JSON leaves it out');
  ok(back !== null && back[0].order !== back[1].order && back[0].path !== back[1].path, 'defaults come back as fresh copies, never shared between rows');
  ok(json(t).length < json(objs).length, `smaller than the list (${json(t).length} against ${json(objs).length} bytes)`);
  ok(json(unpackRows(packRows([]))) === '[]', 'an empty list round-trips');
  const wide = [Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, i]))];
  ok(json(unpackRows(copy(packRows(wide)))) === json(wide), 'an object wider than a mask holds is kept whole');
  const good = copy(t);
  ok(unpackRows(null) === null && unpackRows({ k: [], r: [] }) === null, 'a table without its parts is refused');
  ok(unpackRows({ ...good, r: [[9, 0]] }) === null, 'a row naming no shape is refused');
  ok(unpackRows({ ...good, r: [[0, 1]] }) === null, 'a row with fewer values than its mask is refused');
  ok(unpackRows({ ...good, r: [[0, 0, 7]] }) === null, 'a row with more values than its mask is refused');
  ok(unpackRows({ ...good, r: [[0, 2 ** 20]] }) === null, 'a mask beyond its shape is refused');
  ok(unpackRows({ ...good, k: [[1]] }) === null, 'a key that is not text is refused');
}

function saveTests(ok: Ok): void {
  let s = grandBattle('g0-save');
  while (s.tick < 600 * 4) s = processAction(s, { type: 'tick', n: 50 });
  const packed = copy(packState(s)) as Record<string, unknown>;
  ok(packed.tables === TABLES_V1 && !Array.isArray(packed.units) && !Array.isArray(packed.buildings), 'a packed save keeps units and structures as tables');
  const back = migrateState(copy(packed));
  ok(back !== null && json(back) === json(migrateState(copy(s))), 'it loads to exactly the battle');
  const old = { ...copy(packed), units: copy(s.units), buildings: copy(s.buildings), ai: copy(s.ai) } as Record<string, unknown>;
  delete old.tables;
  const oldBack = migrateState(old);
  ok(oldBack !== null && json(oldBack) === json(migrateState(copy(s))), 'a packed save from before tables loads exactly as it did');
  ok(migrateState({ ...copy(packed), tables: 2 }) === null, 'a tables version this build does not know is refused');
  ok(migrateState({ ...copy(packed), units: { k: [], d: [], r: [[0, 0]] } }) === null, 'a save whose unit table is malformed is refused, not loaded half-made');
  let a = migrateState(copy(s))!;
  let b = back!;
  for (let i = 0; i < 24; i++) {
    a = processAction(a, { type: 'tick', n: 50 });
    b = processAction(b, { type: 'tick', n: 50 });
  }
  ok(json(a) === json(b), 'two minutes on, the battle loaded from tables is the battle itself');
}

/** Deep: thirty minutes of a four-sided Continental battle with the full economy. */
function longSaveTests(ok: Ok): void {
  let s = grandBattle('g0-long');
  let worst = 0;
  let worstAt = 0;
  while (s.winner === null && s.tick < 600 * 30) {
    s = processAction(s, { type: 'tick', n: 50 });
    if (s.tick % 3000 === 0) {
      const p = json(packState(s));
      if (p.length > worst) {
        worst = p.length;
        worstAt = s.tick;
      }
      const back = migrateState(JSON.parse(p));
      ok(back !== null && json(back) === json(migrateState(copy(s))), `minute ${s.tick / 600}: the packed save loads to exactly the battle`);
    }
  }
  const raw = json(s).length;
  ok(worst < 150 * 1024, `the largest save in thirty minutes is ${(worst / 1024).toFixed(0)} KB (minute ${worstAt / 600}); the battle unpacked is ${(raw / 1024).toFixed(0)} KB at the end`);
}

// ---------------------------------------------------------------------------------------------
// G1: presets, cities, founding, towns, dominion

/** A Grand War battle of a preset, the player's side under the harness's hand (no autopilot). */
export const presetBattle = (preset: 'frontier' | 'grand' | 'epic', seed: string, autopilot = false): GameState =>
  createInitialState(`gw-${seed}`, seed, { seed, difficulty: 'normal', createdAt: 0, autopilot, setup: GRAND_PRESETS[preset] });

/** A frontier battle, cleared of every unit, the computer sides left with nothing to spend: for staging by hand. */
function staged(seed: string, preset: 'frontier' | 'grand' = 'frontier'): GameState {
  const s = copy(presetBattle(preset, seed));
  s.units = [];
  for (const p of s.players.slice(1)) {
    p.credits = 0;
    p.fuel = 0;
    p.alloys = 0;
    p.food = 0;
  }
  return s;
}

const tick = (s: GameState, n: number): GameState => {
  let out = s;
  for (let left = n; left > 0 && out.winner === null; left -= 50) out = processAction(out, { type: 'tick', n: Math.min(50, left) });
  return out;
};

function presetTests(ok: Ok): void {
  const setupKeys = [...Object.keys(DEFAULT_SETUP), 'grand'].sort().join(',');
  for (const p of GRAND_PRESET_ORDER) {
    const setup = GRAND_PRESETS[p];
    ok(Object.keys(setup).sort().join(',') === setupKeys, `${p}: the preset states every setup key`);
    ok(json(Object.keys(setup.grand!)) === json(GRAND_OPTION_KEYS), `${p}: the preset states every Grand War option, in order`);
    ok(json(normaliseSetup(setup)) === json(setup), `${p}: the preset is its own normal form`);
  }
  ok(normaliseSetup(DEFAULT_SETUP).grand === undefined && !('grand' in normaliseSetup(DEFAULT_SETUP)), 'the Battle preset (an ordinary skirmish) has no grand block at all');
  ok(normaliseSetup({ ...GRAND_PRESETS.grand, sites: false }).grand === undefined, 'Grand War needs neutral sites');
  ok(normaliseSetup({ ...GRAND_PRESETS.grand, production: false }).grand === undefined, 'and advanced production');
  ok(normaliseSetup({ ...GRAND_PRESETS.grand, tech: 'standard' }).grand === undefined, 'and advanced tech');
  ok(normaliseGrand({ preset: 'nonsense' }) === null && normaliseGrand(7) === null, 'an unknown preset is no block');
  const junk = normaliseGrand({ preset: 'epic', townsPerSide: 99, townStrength: -1, diplomacy: 'yes', dominionShare: 10, dominionMinutes: 1.5, timeLimit: -3 })!;
  ok(json(junk) === json(GRAND_PRESETS.epic.grand), 'every bad value takes its preset\'s');
  const plain = createInitialState('plain', 'plain', { seed: 'plain', difficulty: 'normal', createdAt: 0, setup: { ...DEFAULT_SETUP, sites: true } });
  ok(!grandOn(plain) && !plain.grand && plain.buildings.every(b => b.pop === undefined) && !townsOf(plain).length, 'a skirmish has no cities, no towns and no grand state');
}

function startTests(ok: Ok): void {
  for (const p of GRAND_PRESET_ORDER)
    for (const seed of ['st-a', 'st-b', 'st-c']) {
      const s = presetBattle(p, seed);
      const sides = s.players.length;
      const towns = townsOf(s);
      ok(grandOn(s) && s.grand?.dominion === null, `${p} ${seed}: a Grand War battle, dominion clock clear`);
      ok(s.buildings.filter(b => b.kind === 'hq').every(b => b.pop === CITY_START_POP), `${p} ${seed}: every Command Yard is a city of ${CITY_START_POP}`);
      ok(towns.length === sides * s.setup!.grand!.townsPerSide, `${p} ${seed}: ${towns.length} towns, ${s.setup!.grand!.townsPerSide} per side`);
      ok(towns.every(t => t.owner === null && t.garrison === townGarrisonMax(s)), `${p} ${seed}: every town independent, its militia full`);
      let sound = true;
      for (const t of towns)
        for (let y = t.y; y < t.y + TOWN_SIZE; y++) for (let x = t.x; x < t.x + TOWN_SIZE; x++) if (!isWalkable(s.tiles[y * s.mapW + x] as never) || s.ore[y * s.mapW + x] > 0) sound = false;
      ok(sound, `${p} ${seed}: every town on clear ground`);
      // Fair: each side's distances to the towns, sorted, are the same (within the nudge for three sides).
      const yards = s.buildings.filter(b => b.kind === 'hq').sort((a, b) => a.owner - b.owner).map(b => ({ x: b.x + 1.5, y: b.y + 1.5 }));
      const nearest = yards.map(y => Math.min(...towns.map(t => Math.hypot(townCentre(t).x - y.x, townCentre(t).y - y.y))));
      const spread = Math.max(...nearest) - Math.min(...nearest);
      ok(spread <= (sides === 3 ? 6 : 1.5), `${p} ${seed}: every side's nearest town is as far (spread ${spread.toFixed(1)} tiles)`);
      const again = presetBattle(p, seed);
      ok(json(townsOf(again)) === json(towns), `${p} ${seed}: the towns are placed the same every time`);
    }
}

/** Puts a structure of `kind` for side 0 at the first spot round (cx, cy) its placement allows, ignoring the queue. */
function build(s: GameState, kind: BuildingKind, cx: number, cy: number, owner: Owner = 0): Building | null {
  for (let r = 0; r < 18; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = Math.floor(cx) + dx;
        const y = Math.floor(cy) + dy;
        if (placementProblem(s, owner, kind, x, y) === null) return addBuilding(s, owner, kind, x, y);
      }
  return null;
}

function cityTests(ok: Ok): void {
  let s = staged('city-a');
  const hq = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
  const c = { x: hq.x + 1.5, y: hq.y + 1.5 };
  ok(cityHousing(s, hq) === HOUSING.hq, `a bare city's housing is its yard's (${HOUSING.hq})`);
  const gridBefore = territoryGrid(s).reduce((n, o) => n + (o === 0 ? 1 : 0), 0);
  for (let i = 0; i < 6; i++) build(s, 'quarters', c.x + 4, c.y + 4);
  const housing = cityHousing(s, hq);
  ok(housing > HOUSING.hq, `Quarters round it raise its housing to ${housing}`);
  s.players[0].food = 400;
  const pop0 = hq.pop!;
  s = tick(s, CITY_BEAT);
  const city1 = s.buildings.find(b => b.id === hq.id)!;
  ok(city1.pop === pop0 + 1, `one beat: the city grows by one (${pop0} to ${city1.pop})`);
  s = tick(s, CITY_BEAT * 60);
  const grown = s.buildings.find(b => b.id === hq.id)!;
  ok(grown.pop === cityHousing(s, grown), `thirty minutes on: the city has filled its housing (${grown.pop} of ${cityHousing(s, grown)})`);
  ok(cityLevel(grown.pop!) > 1, `and risen to level ${cityLevel(grown.pop!)}`);
  const gridAfter = territoryGrid(s).reduce((n, o) => n + (o === 0 ? 1 : 0), 0);
  ok(gridAfter > gridBefore, `a bigger city claims more ground (${gridBefore} to ${gridAfter} tiles)`);
  // Lose the Quarters: it shrinks, a person a beat, to its floor.
  const lost = copy(s);
  lost.buildings = lost.buildings.filter(b => b.kind !== 'quarters' || b.owner !== 0);
  const after = tick(lost, CITY_BEAT * 80);
  ok(after.buildings.find(b => b.id === hq.id)!.pop === HOUSING.hq, 'its Quarters lost, a city shrinks back to its floor, never below');
  // Districts: as many as its level allows.
  const d = copy(after);
  const city = d.buildings.find(b => b.id === hq.id)!;
  const cap = districtCap(cityLevel(city.pop!));
  let placed = districtsOf(d, city).length;
  for (let i = 0; i < 30 && placed < cap; i++) {
    if (!build(d, 'farm', c.x - 5, c.y - 5)) break;
    placed = districtsOf(d, city).length;
  }
  ok(placed === cap, `a level ${cityLevel(city.pop!)} city holds ${cap} districts (${placed} built)`);
  let refusal: string | null = null;
  for (let y = city.y - 12; y < city.y + 12 && !refusal; y++)
    for (let x = city.x - 12; x < city.x + 12 && !refusal; x++) {
      const why = placementProblem(d, 0, 'farm', x, y);
      if (why && /districts/.test(why)) refusal = why;
    }
  ok(refusal !== null, `one more is refused: "${refusal}"`);
  ok(isDistrict('farm') && !isDistrict('quarters') && !isDistrict('turret'), 'housing and defences are never districts');
}

function foundingTests(ok: Ok): void {
  const s = staged('found-a');
  const hq = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
  const near = addUnit(s, 0, 'basetruck', hq.x + 1.5 + 8, hq.y + 1.5);
  ok(deployProblem(s, 0, near.id) === 'Too close to a city', 'a truck cannot found a city beside another');
  const town = townsOf(s)[0];
  const tc = townCentre(town);
  const byTown = addUnit(s, 0, 'basetruck', tc.x + 6, tc.y + 0.5);
  ok(/Too close/.test(deployProblem(s, 0, byTown.id) ?? ''), 'nor beside a town');
  // Far from everything: legal while a city can spare settlers, refused once none can.
  hq.pop = HOUSING.hq + CITY_FOUNDING_COST + 2;
  let truck: ReturnType<typeof addUnit> | null = null;
  for (let y = 4; y < s.mapH - 4 && !truck; y += 3)
    for (let x = 4; x < s.mapW - 4 && !truck; x += 3) {
      if (foundingProblem(s, 0, x + 0.5, y + 0.5) !== null) continue;
      const u = addUnit(s, 0, 'basetruck', x + 0.5, y + 0.5);
      if (deployProblem(s, 0, u.id) === null) truck = u;
      else s.units = s.units.filter(v => v.id !== u.id);
    }
  ok(truck !== null, 'far from every city and town, with settlers to spare, a truck may found a city');
  if (!truck) return;
  const poor = copy(s);
  poor.buildings.find(b => b.id === hq.id)!.pop = HOUSING.hq + CITY_FOUNDING_COST - 1;
  ok(deployProblem(poor, 0, truck.id) === `No city can spare ${CITY_FOUNDING_COST} settlers`, `but not while no city can spare ${CITY_FOUNDING_COST} settlers above its floor`);
  const before = copy(s);
  const after = processAction(s, { type: 'deploy', id: truck.id });
  const yard = after.buildings.find(b => b.kind === 'fieldyard' && b.owner === 0);
  ok(!!yard && yard.pop === CITY_FOUNDED_POP, `the Field Yard is a new city of ${CITY_FOUNDED_POP}`);
  ok(after.buildings.find(b => b.id === hq.id)!.pop === hq.pop! - CITY_FOUNDING_COST, `its settlers left the Command Yard's city (${hq.pop} to ${after.buildings.find(b => b.id === hq.id)!.pop})`);
  ok(json(s) === json(before), 'the action left its input untouched');
  ok(citiesOf(after, 0).length === 2 && allCities(after).length === citiesOf(after, 0).length + after.players.length - 1, 'side 0 now has two cities');
  const refusedMove = processAction(after, { type: 'undeploy', id: yard!.id });
  ok(refusedMove === after, 'a city does not pack up: the action is refused (the same state)');
  const tooClose = processAction(before, { type: 'deploy', id: near.id });
  ok(tooClose === before, 'a refused founding returns the same state');
}

function townTests(ok: Ok): void {
  const s = staged('town-a');
  const town = townsOf(s)[0];
  const c = townCentre(town);
  const max = townGarrisonMax(s);
  // A lone rifleman beside it is shot.
  const lone = addUnit(s, 0, 'rifleman', c.x + 3, c.y + 0.5);
  const hp0 = lone.hp;
  let a = tick(s, 30);
  const hit = a.units.find(u => u.id === lone.id);
  ok(!hit || hit.hp < hp0, 'an independent town fires on a soldier in reach');
  ok(townsOf(a)[0].garrison! < max, 'and the soldier wears its militia down a little');
  // A column: the militia breaks, then infantry take it.
  const b = staged('town-a');
  const t2 = townsOf(b)[0];
  const c2 = townCentre(t2);
  for (let i = 0; i < 10; i++) addUnit(b, 0, 'tank', c2.x - 4 + (i % 5) * 1.5, c2.y + 3.5 + Math.floor(i / 5));
  for (let i = 0; i < 6; i++) addUnit(b, 0, 'rifleman', c2.x - 3 + i, c2.y - 3);
  let broken = b;
  let at = -1;
  for (let i = 0; i < 200 && at < 0; i++) {
    broken = tick(broken, 10);
    if (townsOf(broken).find(x => x.id === t2.id)!.garrison === 0) at = broken.tick;
  }
  ok(at > 0, `ten tanks break its militia (${at > 0 ? ((at - b.tick) / 10).toFixed(0) : '-'} seconds)`);
  const capBefore = townsOf(broken).find(x => x.id === t2.id)!;
  ok(capBefore.owner === null, 'broken, it is not yet taken');
  let taken = broken;
  for (let i = 0; i < 30 && townsOf(taken).find(x => x.id === t2.id)!.owner === null; i++) taken = tick(taken, 10);
  const held = townsOf(taken).find(x => x.id === t2.id)!;
  ok(held.owner === 0, 'its militia broken, infantry take it');
  const credits = taken.players[0].credits;
  const later = tick(taken, 600);
  ok(later.players[0].credits >= credits + TOWN_INCOME * 10, `a held town pays (${Math.round(later.players[0].credits - credits)} in a minute)`);
  ok(cityCounts(later).byTeam.get(0) === 2, 'and counts as a city for its holder');
  const grid = territoryGrid(later);
  const tc = townCentre(held);
  ok(grid[Math.floor(tc.x) + Math.floor(tc.y) * later.mapW + 4] === 0 || grid[Math.floor(tc.x) + 4 + Math.floor(tc.y) * later.mapW] === 0, 'it claims the ground round it');
  // Held and left alone, its militia regrows to half.
  const calm = copy(later);
  calm.units = calm.units.filter(u => u.owner !== 0 || u.kind === 'basetruck');
  const regrown = tick(calm, 6000);
  const g = townsOf(regrown).find(x => x.id === t2.id)!.garrison!;
  ok(g === Math.round(max / 2), `held and left alone, its militia regrows to half (${g})`);
  // Garrisoned, infantry beside it cannot take it.
  const c3 = staged('town-b');
  const t3 = townsOf(c3)[0];
  const cc = townCentre(t3);
  for (let i = 0; i < 4; i++) addUnit(c3, 0, 'rifleman', cc.x - 2 + i, cc.y - 2.5);
  const tried = tick(c3, 120);
  const still = townsOf(tried).find(x => x.id === t3.id)!;
  ok(still.owner === null && still.capture === null, 'while its militia stands, infantry beside a town cannot take it');
}

function dominionTests(ok: Ok): void {
  const s = staged('dom-a');
  const g = s.setup!.grand!;
  const towns = townsOf(s);
  // Hand side 0 every town: it holds 3 + 1 of 6 cities, 67% against 60%.
  s.sites = s.sites!.map(t => (t.kind === 'town' ? { ...t, owner: 0 as Owner, garrison: 0 } : t));
  const { total, byTeam } = cityCounts(s);
  ok(total === towns.length + 3 && byTeam.get(0) === towns.length + 1, `side 0 holds ${byTeam.get(0)} of ${total} cities`);
  let a = tick(s, 20);
  ok(a.grand?.dominion?.team === 0, 'dominion starts its clock');
  const since = a.grand!.dominion!.since;
  a = tick(a, g.dominionMinutes * 600 - (a.tick - since) - 20);
  ok(a.winner === null, 'just short of the time, no winner yet');
  // Break it: one town lost, the clock stops and starts again from nothing.
  const broken = copy(a);
  broken.sites = broken.sites!.map(t => (t.id === towns[0].id ? { ...t, owner: null, garrison: 100 } : t));
  const b = tick(broken, 20);
  ok(b.grand?.dominion === null && b.winner === null, 'a town lost breaks the hold, and the clock stops');
  const won = tick(a, 60);
  ok(won.winner === 0, `held ${g.dominionMinutes} minutes without a break: victory`);
  // Time limit: the team with most cities wins when it runs out; level teams play on.
  const lim = staged('dom-b', 'grand');
  lim.setup = { ...lim.setup!, grand: { ...lim.setup!.grand!, timeLimit: 1, dominionShare: 100 } };
  const level = tick(lim, 700);
  ok(level.winner === null, 'at the time limit, level teams play on');
  const ahead = copy(lim);
  ahead.sites = ahead.sites!.map(t => (t.id === townsOf(ahead)[0].id ? { ...t, owner: 2 as Owner, garrison: 0 } : t));
  const timed = tick(ahead, 700);
  ok(timed.winner === 2, 'at the time limit, the team holding most cities wins');
}

function grandSaveTests(ok: Ok): void {
  let s = presetBattle('grand', 'gsave', true);
  s = tick(s, 600 * 3);
  const packed = copy(packState(s));
  const back = migrateState(copy(packed));
  ok(back !== null && json(back) === json(migrateState(copy(s))), 'a Grand War battle saves and loads exactly (cities, towns, the clock)');
  const junk = copy(s) as GameState & Record<string, unknown>;
  junk.grand = { dominion: { team: 9, since: -4 } } as never;
  junk.buildings[0] = { ...junk.buildings[0], pop: -3 };
  const fixed = migrateState(junk)!;
  ok(fixed.grand?.dominion === null && fixed.buildings[0].pop === undefined, 'a bad clock and a bad population are repaired, not trusted');
  const plain = createInitialState('p', 'p', { seed: 'p', difficulty: 'normal', createdAt: 0, setup: DEFAULT_SETUP });
  const smuggled = { ...copy(plain), grand: { dominion: null } } as GameState;
  smuggled.buildings[0] = { ...smuggled.buildings[0], pop: 40 };
  const clean = migrateState(smuggled)!;
  ok(clean.grand === undefined && clean.buildings[0].pop === undefined, 'outside a Grand War, a save carrying its fields loses them');
}

/** Deep: computer-only Frontier battles, checked every minute; replay exact. */
function wholeGames(ok: Ok): void {
  let levels = 0;
  let takes = 0;
  let founded = 0;
  for (const seed of ['gw-1', 'gw-2', 'gw-3']) {
    let s = presetBattle('frontier', seed, true);
    let sane = true;
    while (s.winner === null && s.tick < 600 * 45) {
      s = tick(s, 600);
      for (const b of allCities(s)) if (!Number.isInteger(b.pop) || b.pop! < (HOUSING[b.kind] ?? 0) || b.pop! > 1000) sane = false;
      for (const t of townsOf(s)) if (!Number.isInteger(t.garrison) || t.garrison! < 0 || t.garrison! > townGarrisonMax(s)) sane = false;
      levels = Math.max(levels, ...allCities(s).map(b => cityLevel(b.pop!)));
    }
    takes += townsOf(s).filter(t => t.owner !== null).length;
    founded += s.buildings.filter(b => b.kind === 'fieldyard' && b.pop !== undefined).length;
    ok(sane, `${seed}: every city and town sound every minute; ended ${s.winner === null ? 'unfinished' : `side ${s.winner} won`} at minute ${(s.tick / 600).toFixed(0)}`);
  }
  ok(levels >= 3, `cities grow: the largest reached level ${levels}`);
  ok(takes > 0, `towns change hands (${takes} held at the ends)`);
  console.log(`  ${founded} cities founded by trucks standing at the ends`);
  const play = (): GameState => tick(presetBattle('frontier', 'gw-replay', true), 600 * 12);
  ok(json(play()) === json(play()), 'a Grand War battle replays byte-identically');
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Grand War G0: tables', rowsTests],
  ['Grand War G0: saves as tables', saveTests],
  ['Grand War G0: a long battle saved', longSaveTests],
  ['Grand War G1: presets', presetTests],
  ['Grand War G1: the start', startTests],
  ['Grand War G1: cities', cityTests],
  ['Grand War G1: founding', foundingTests],
  ['Grand War G1: towns', townTests],
  ['Grand War G1: dominion and the time limit', dominionTests],
  ['Grand War G1: saves', grandSaveTests],
  ['Grand War G1: whole computer battles', wholeGames],
];
