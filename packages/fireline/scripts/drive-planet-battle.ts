/**
 * War for the Planet, W2's sections (fireline-planet-design.md, section 18, items 11 and 12):
 * planet battles built from setups, the engine hooks (Command Yard and time-limit victory, teams,
 * heroes, core tags, saves), whole battles simulated to a report, the instant auto-resolve, save
 * size, and proof that story missions and skirmishes are byte-identical to the build before the
 * hooks. scripts/drive-planet.ts (W5) runs these sections and counts them in its totals; run on
 * its own (`npx tsx scripts/drive-planet-battle.ts`) it prints its own count.
 *
 * Setups here are crafted to cover every map type, 2, 3 and 4 sides, a human attacker, a human
 * defender and no human side, independents and allies, perks and powers; drive-planet.ts adds the
 * setups taken from whole wars through W1's battleSetupFor.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MISSIONS } from '../src/campaign/missions';
import { missionContext, newCampaign } from '../src/campaign/progression';
import { buildPlanetBattle, planetBattleReport, simulateBattle } from '../src/planet/battle';
import { attackTargets, battleSetupFor } from '../src/planet/battleSetup';
import { planetMapOf } from '../src/planet/map';
import { attackOdds, quickResolve, sideStrength } from '../src/planet/resolve';
import { newPlanetState } from '../src/planet/state';
import { applyPlanetAction, planetActionProblem } from '../src/planet/turn';
import { ARMY_KINDS, type ArmyKind, type BattleReport, type BattleSetup, type BattleSide, type CityBuildingId, type PlanetState, type Treaty } from '../src/planet/types';
import { processAction } from '../src/sim/actions';
import { missionMode } from '../src/sim/ai';
import { createMissionState } from '../src/sim/mission';
import { seedFromString, stream } from '../src/sim/rng';
import {
  HERO_KINDS,
  MAP_TYPES,
  MODULES,
  MODULE_SLOTS,
  TICKS_PER_SECOND,
  UNITS,
  type BuildingKind,
  type HeroKind,
  type MapType,
  type ModuleId,
  type UnitKind,
  type UpgradeId,
} from '../src/sim/rules';
import { cloneState, createInitialState, migrateState } from '../src/sim/state';
import type { GameState } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const hash = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
/**
 * A skirmish state as hashed before round 6 added the game size (now `setup.pace`) and before the
 * merge with main added `setup.size` (the map size) and `setup.sites`. A setup that leaves them out
 * records Quick, a standard map and no sites, which mean the earlier battle exactly, so the three
 * fields are checked and then left out of the hash.
 */
const preSize = (s: GameState): unknown => {
  if (!s.setup) return s;
  const { pace, size, sites, ...rest } = s.setup;
  if (pace !== 'quick') throw new Error(`skirmish recorded pace ${pace}, expected quick`);
  if (size !== 'standard') throw new Error(`skirmish recorded map size ${size}, expected standard`);
  if (sites !== false) throw new Error(`skirmish recorded sites ${sites}, expected false`);
  return { ...s, setup: rest };
};
const tick = (s: GameState, n: number): GameState => {
  for (let i = 0; i < n; i += 600) s = processAction(s, { type: 'tick', n: Math.min(600, n - i) });
  return s;
};
function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as object)) deepFreeze(v);
  }
  return x;
}

// ---- Crafted setups -----------------------------------------------------------------------------

const ATTACK_STRUCTURES: BuildingKind[] = ['hq', 'power', 'power', 'refinery', 'barracks', 'factory'];
const ALLY_STRUCTURES: BuildingKind[] = ['hq', 'power', 'refinery', 'barracks'];
const UPGRADE_SETS: UpgradeId[][] = [[], ['plating'], ['plating', 'calibration', 'engines'], ['plating', 'plating2', 'calibration', 'refining']];
const LOADOUT_SETS: Partial<Record<UnitKind, ModuleId[]>>[] = [
  {},
  { tank: ['smoke'] },
  { tank: ['longbarrel', 'fueltank'], buggy: ['fueltank'] },
  { tank: ['longbarrel', 'tracks'], bastion: ['longbarrel', 'tracks'], flametank: ['tracks', 'smoke'], buggy: ['fueltank'] },
];

/** A defender's city as structures and tags, the way section 9.3 lays it out. */
function defenderBase(levels: Partial<Record<CityBuildingId, 1 | 2 | 3>>, cityLevel: number): { structures: BuildingKind[]; cityTags: (CityBuildingId | null)[] } {
  const city: [BuildingKind, CityBuildingId][] = [];
  for (let i = 0; i < (levels.refinery ?? 0); i++) city.push(['refinery', 'refinery']);
  if (levels.factory) city.push(['factory', 'factory']);
  if ((levels.factory ?? 0) >= 2) city.push(['repairbay', 'factory']);
  if (levels.institute) city.push(['researchlab', 'institute']);
  if ((levels.institute ?? 0) >= 2) city.push(['techcentre', 'institute']);
  for (let i = 0; i < (levels.fortifications ?? 0); i++) city.push(['turret', 'fortifications'], ['turret', 'fortifications'], ['rocketturret', 'fortifications']);
  if ((levels.fortifications ?? 0) >= 3) city.push(['strikecommand', 'fortifications']);
  if (levels.airfield) city.push(['helipad', 'airfield']);
  for (let i = 0; i < (levels.airfield ?? 0); i++) city.push(['flakcannon', 'airfield']);
  const others = city.length + 1 + (cityLevel >= 3 ? 1 : 0);
  const structures: BuildingKind[] = ['hq'];
  const cityTags: (CityBuildingId | null)[] = [null];
  for (let i = 0; i < 1 + Math.ceil(others / 3); i++) {
    structures.push('power');
    cityTags.push(null);
  }
  structures.push('barracks');
  cityTags.push(null);
  for (const [b, tag] of city) {
    structures.push(b);
    cityTags.push(tag);
  }
  if (cityLevel >= 3) {
    structures.push('uplink');
    cityTags.push(null);
  }
  return { structures, cityTags };
}

/**
 * Setup number i: every map type, 2, 3 and 4 sides, and (by i mod 3) a human attacker, a human
 * defender or no human side; every fifth an independent defender.
 */
export function craftSetup(i: number): BattleSetup {
  const r = stream(seedFromString(`planet-battle-craft:${i}`));
  const n = (2 + (i % 3)) as 2 | 3 | 4;
  const who = Math.floor(i / 3) % 3; // 0 human attacker, 1 human defender, 2 none
  const mapType = MAP_TYPES[i % MAP_TYPES.length];
  const independent = who !== 1 && i % 5 === 4;
  const cityLevel = 1 + r.int(0, 4);
  const lv = () => (1 + r.int(0, Math.min(2, cityLevel - 1))) as 1 | 2 | 3;
  const levels: Partial<Record<CityBuildingId, 1 | 2 | 3>> = {};
  for (const b of ['refinery', 'farms', 'factory', 'institute', 'fortifications', 'port', 'airfield'] as CityBuildingId[]) if (r.float() < 0.5) levels[b] = lv();
  const army = (count: number, core: boolean): BattleSide['units'] =>
    Array.from({ length: count }, (_, k) => ({ kind: ARMY_KINDS[r.int(0, ARMY_KINDS.length - 1)], kills: r.float() < 0.3 ? r.int(0, 12) : 0, core: core ? k : null }));
  const research = () => {
    const k = r.int(0, UPGRADE_SETS.length - 1);
    return { upgrades: UPGRADE_SETS[k].slice(), doctrines: k === 3 ? { armour: 'composite' as UpgradeId } : {}, loadouts: copy(LOADOUT_SETS[k]) };
  };
  const heroes = (): BattleSide['heroes'] =>
    HERO_KINDS.filter(() => r.float() < 0.5)
      .slice(0, 2)
      .map(kind => ({ kind, xp: r.int(0, 900), wounded: r.float() < 0.3 }));
  const attacker = (faction: number, human: boolean): BattleSide => ({
    faction,
    role: 'attacker',
    team: 0,
    human,
    structures: ATTACK_STRUCTURES.slice(),
    cityTags: ATTACK_STRUCTURES.map(() => null),
    credits: 2500 + 1000 * r.int(0, 3),
    units: army(4 + r.int(0, 14), true),
    heroes: human ? heroes() : [],
    ...research(),
    ai: 'normal',
    fromRegion: null,
  });
  const base = defenderBase(levels, cityLevel);
  const defender = (faction: number, human: boolean): BattleSide =>
    independent
      ? {
          faction: -1,
          role: 'defender',
          team: 1,
          human: false,
          structures: ['hq', 'power', 'barracks', 'refinery', ...Array<BuildingKind>(cityLevel).fill('turret')],
          cityTags: Array(4 + cityLevel).fill(null),
          credits: 1000,
          units: army(3 + r.int(0, 5), false),
          heroes: [],
          upgrades: [],
          doctrines: {},
          loadouts: {},
          ai: 'defend',
          fromRegion: null,
        }
      : {
          faction,
          role: 'defender',
          team: 1,
          human,
          structures: base.structures,
          cityTags: base.cityTags,
          credits: 1500 + 500 * (levels.refinery ?? 0) + 250 * cityLevel,
          units: [...army(2 + r.int(0, 10), false), ...(r.float() < 0.4 ? army(3 + r.int(0, 8), true) : [])],
          heroes: human ? heroes() : [],
          ...research(),
          ai: 'defend',
          fromRegion: null,
        };
  const ally = (faction: number, team: 0 | 1): BattleSide => ({
    faction,
    role: 'ally',
    team,
    human: false,
    structures: ALLY_STRUCTURES.slice(),
    cityTags: ALLY_STRUCTURES.map(() => null),
    credits: 1500,
    units: army(1 + r.int(0, 6), false),
    heroes: [],
    ...research(),
    ai: 'normal',
    fromRegion: r.int(0, 30),
  });
  // Seats (section 9.2): a human principal is seat 0 and the other principal seat 1; otherwise the
  // attacker is seat 0. Allies follow: the attacker's, then the defender's.
  const sides: BattleSide[] = who === 1 ? [defender(0, true), attacker(1, false)] : [attacker(who === 0 ? 0 : 1, who === 0), defender(2, false)];
  const defenderSeat = who === 1 ? 0 : 1;
  if (n === 3) sides.push(ally(3, r.float() < 0.5 ? 0 : 1));
  if (n === 4) sides.push(ally(3, 0), ally(4, 1));
  const human = sides[0].human;
  return {
    battleId: 100 + i,
    turn: 1 + r.int(0, 30),
    region: r.int(0, 59),
    regionName: `Crafted ${i}`,
    seedText: `craft${i}:t${i}:r${i}:b${100 + i}`,
    mapType,
    ore: (['poor', 'normal', 'rich'] as const)[r.int(0, 2)],
    difficulty: (['easy', 'normal', 'hard'] as const)[i % 3],
    sides,
    defenderSeat,
    timeLimit: 20 * 60 * TICKS_PER_SECOND,
    cityLevel,
    cityBuildings: independent ? {} : levels,
    perks: human ? { harvestMul: 1.1, buildSpeedMul: 1, costMul: 0.9, unitHpMul: 1.1, powerCooldownMul: 0.9, extraStartCredits: 250 } : null,
    powers: human ? (['recon', 'barrage', 'reinforce'] as const).filter(() => r.float() < 0.6) : [],
  };
}

/** The same partition of sides into teams (labels aside: two sides are always [0, 1] in the engine). */
function sameTeams(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < a.length; j++) if ((a[i] === a[j]) !== (b[i] === b[j])) return false;
  return true;
}

const tally = (xs: string[]) => xs.slice().sort().join(',');

/**
 * Section 9.6's validation of a report against its setup, as the reducer applies it (W1's
 * battleResult checks the same; this copy lets W2's sections stand alone).
 */
export function reportProblem(setup: BattleSetup, r: BattleReport): string | null {
  if (r.battleId !== setup.battleId) return 'battle id';
  if (r.winner !== 'attacker' && r.winner !== 'defender') return 'winner';
  if (r.sides.length !== setup.sides.length) return 'side count';
  for (let i = 0; i < r.sides.length; i++) {
    const rs = r.sides[i];
    const ss = setup.sides[i];
    if (rs.faction !== ss.faction) return `faction of side ${i}`;
    if (rs.survivors.length > 60) return `too many survivors on side ${i}`;
    const slots = new Set<number>();
    for (const u of rs.survivors) {
      if (!ARMY_KINDS.includes(u.kind)) return `kind ${u.kind}`;
      if (!Number.isInteger(u.kills) || u.kills < 0 || u.kills > 999) return 'kills';
      if (u.core !== null) {
        if (slots.has(u.core)) return 'core slot twice';
        slots.add(u.core);
        const was = ss.units.find(x => x.core === u.core);
        if (!was || was.kind !== u.kind) return `invented core slot ${u.core}`;
      }
    }
    for (const h of rs.heroes) {
      const was = ss.heroes.find(x => x.kind === h.kind);
      if (!was) return `hero ${h.kind} not in the setup`;
      if (!(h.xp >= was.xp)) return `hero ${h.kind} lost xp`;
    }
  }
  for (const [b, v] of Object.entries(r.cityDamage)) if (!Number.isInteger(v) || v! < 0 || v! > (setup.cityBuildings[b as CityBuildingId] ?? 0)) return `city damage ${b}`;
  if (r.cityLevelLost !== (r.winner === 'attacker' ? 1 : 0)) return 'city level lost';
  return null;
}

const SETUPS = 60;
const ids = (i: number) => ({ id: `pb-${i}`, name: `Planet battle ${i}`, createdAt: 1700000000000 + i });

// ---- Building a battle --------------------------------------------------------------------------

function buildTests(ok: Ok): void {
  const seen = { maps: new Set<MapType>(), sides: new Set<number>(), who: new Set<string>() };
  for (let i = 0; i < SETUPS; i++) {
    const setup = deepFreeze(craftSetup(i));
    const s = buildPlanetBattle(setup, ids(i));
    const t = `setup ${i}`;
    const n = setup.sides.length;
    seen.maps.add(setup.mapType);
    seen.sides.add(n);
    seen.who.add(setup.sides[0].human ? (setup.defenderSeat === 0 ? 'defender' : 'attacker') : 'none');
    ok(s.players.length === n && s.ai.length === n, `${t}: ${n} sides`);
    ok(sameTeams(s.teams, setup.sides.map(x => x.team)), `${t}: teams match the setup`);
    if (n > 2) ok(JSON.stringify(s.teams) === JSON.stringify(setup.sides.map(x => x.team)), `${t}: teams equal the setup's`);
    ok(s.mapType === setup.mapType && s.setup?.ore === setup.ore && s.setup?.research === 'lines' && s.setup?.tech === 'advanced', `${t}: map, ore, lines`);
    ok(s.difficulty === setup.difficulty, `${t}: difficulty`);
    ok(s.autopilot === !setup.sides.some(x => x.human), `${t}: autopilot only without a human side`);
    ok(!s.mission && (s.allowed === undefined || s.allowed === null), `${t}: no mission, full tech`);
    ok(!!s.planet && s.planet.battleId === setup.battleId && s.planet.timeLimit === setup.timeLimit && s.planet.defenderSeat === setup.defenderSeat, `${t}: planet runtime`);
    ok(JSON.stringify(s.planet!.ai) === JSON.stringify(setup.sides.map(x => x.ai)), `${t}: AI modes per seat`);
    for (let o = 0; o < n; o++) ok(missionMode(s, o as 0) === setup.sides[o].ai, `${t}: missionMode of seat ${o}`);
    setup.sides.forEach((side, o) => {
      const p = s.players[o];
      const extra = o === 0 && setup.perks ? setup.perks.extraStartCredits : 0;
      ok(p.credits === side.credits + extra, `${t}: side ${o} credits`);
      ok(JSON.stringify(p.upgrades) === JSON.stringify(side.upgrades), `${t}: side ${o} upgrades`);
      ok(JSON.stringify(p.doctrines ?? {}) === JSON.stringify(side.doctrines), `${t}: side ${o} doctrines`);
      ok(s.buildings.filter(b => b.owner === o && b.kind === 'hq').length === 1, `${t}: side ${o} keeps one Command Yard`);
      const units = s.units.filter(u => u.owner === o && !u.hero && u.kind !== 'hauler');
      ok(units.length === side.units.length, `${t}: side ${o} units placed (${units.length} of ${side.units.length})`);
      ok(tally(units.map(u => `${u.kind}:${u.kills}:${u.core ?? '-'}`)) === tally(side.units.map(u => `${u.kind}:${u.kills}:${u.core ?? '-'}`)), `${t}: side ${o} kinds, kills and core tags kept`);
      ok(units.every(u => u.vet === (u.kills >= 7 ? 2 : u.kills >= 3 ? 1 : 0)), `${t}: side ${o} ranks from kills`);
      ok(units.every(u => UNITS[u.kind].category !== 'vehicle' || JSON.stringify(u.modules ?? []) === JSON.stringify((side.loadouts[u.kind] ?? []).filter(m => MODULES[m].fits.includes(u.kind)).slice(0, MODULE_SLOTS[u.kind] ?? 0))), `${t}: side ${o} loadouts fitted`);
      ok(units.every(u => UNITS[u.kind].category === 'vehicle' || !u.modules), `${t}: side ${o} infantry carry no modules`);
      const plated = side.upgrades.includes('plating');
      const tank = units.find(u => u.kind === 'tank' && !(u.modules ?? []).includes('tracks'));
      if (tank && o !== 0) ok(plated ? (tank.maxHp ?? 0) > UNITS.tank.hp : tank.maxHp === undefined, `${t}: side ${o} research raises new units`);
      const heroes = s.units.filter(u => u.owner === o && u.hero);
      ok(tally(heroes.map(u => `${u.kind}:${u.hero!.xp}`)) === tally(side.heroes.map(h => `${h.kind}:${h.xp}`)), `${t}: side ${o} heroes placed with their xp`);
      for (const h of side.heroes) {
        const u = heroes.find(x => x.kind === h.kind);
        if (u) ok(h.wounded ? u.hp < (u.maxHp ?? UNITS[u.kind].hp) : u.hp === (u.maxHp ?? UNITS[u.kind].hp), `${t}: ${h.kind} health (wounded ${h.wounded})`);
      }
      const want = side.structures.filter(k => k !== 'hq' && k !== 'wall').length;
      const got = s.buildings.filter(b => b.owner === o && b.kind !== 'hq').length;
      ok(got >= want - 1 && got <= want, `${t}: side ${o} structures placed (${got} of ${want})`);
      ok(s.units.filter(u => u.owner === o && u.kind === 'hauler').length === s.buildings.filter(b => b.owner === o && b.kind === 'refinery').length, `${t}: side ${o} a hauler per refinery`);
    });
    const tagged = setup.sides[setup.defenderSeat].cityTags.filter(Boolean).length;
    ok(s.planet!.city.length >= tagged - 1 && s.planet!.city.length <= tagged, `${t}: city structures recorded (${s.planet!.city.length} of ${tagged})`);
    ok(s.planet!.city.every(([id, tag]) => s.buildings.some(b => b.id === id && b.owner === setup.defenderSeat) && (tag as string) in setup.cityBuildings), `${t}: every city tag names a defender structure`);
    if (setup.perks) {
      ok(JSON.stringify(s.perks) === JSON.stringify(setup.perks), `${t}: perks on side 0`);
      for (const p of setup.powers) ok(s.powers?.[0]?.[p] !== undefined, `${t}: power ${p} on side 0`);
    } else ok(s.perks === undefined, `${t}: no perks without a human side`);
    const again = buildPlanetBattle(setup, ids(i));
    ok(JSON.stringify(again) === JSON.stringify(s), `${t}: deterministic`);
    ok(JSON.stringify(migrateState(copy(s))) === JSON.stringify(s), `${t}: survives migrateState unchanged`);
    const c = cloneState(s);
    c.planet!.city.push([999999, 'port']);
    c.planet!.ai[0] = 'passive';
    c.units[0].core = 77;
    ok(s.planet!.city.length !== c.planet!.city.length && s.planet!.ai[0] !== 'passive' && s.units[0].core !== 77, `${t}: cloneState copies the planet runtime`);
  }
  ok(seen.maps.size === MAP_TYPES.length, 'every map type covered');
  ok(seen.sides.size === 3, '2, 3 and 4 sides covered');
  ok(seen.who.size === 3, 'human attacker, human defender and no human side covered');
}

// ---- Engine hooks -------------------------------------------------------------------------------

function hookTests(ok: Ok): void {
  // The time limit: the defending team wins at that tick.
  for (const i of [0, 4, 5, 3]) {
    const setup = { ...craftSetup(i), timeLimit: 50 };
    let s = buildPlanetBattle(setup, ids(i));
    s = processAction(s, { type: 'tick', n: 49 });
    ok(s.winner === null, `setup ${i}: running at tick 49`);
    s = processAction(s, { type: 'tick', n: 5 });
    ok(s.tick === 50 && s.winner !== null, `setup ${i}: decided at tick 50 (tick ${s.tick})`);
    const r = planetBattleReport(setup, s)!;
    ok(r && r.winner === 'defender' && r.how === 'fought' && r.ticks === 50, `setup ${i}: the defenders win on time`);
    ok(s.teams[s.winner!] === s.teams[setup.defenderSeat], `setup ${i}: winner on the defending team`);
    ok(s.winner === Math.min(...setup.sides.map((x, k) => (x.team === setup.sides[setup.defenderSeat].team ? k : 99))), `setup ${i}: winner is the defending team's lowest seat`);
    const humanDefends = setup.sides[0].team === setup.sides[setup.defenderSeat].team;
    ok(s.log[s.log.length - 1].text === (humanDefends ? 'Victory. The defenders held.' : 'Defeat. The defenders held.'), `setup ${i}: time-limit message`);
    ok(reportProblem(setup, r) === null, `setup ${i}: time-limit report valid (${reportProblem(setup, r)})`);
  }
  // The Command Yard: when the principal defender's falls, the attacking team wins.
  for (const i of [0, 4, 5, 2]) {
    const setup = craftSetup(i);
    let s = buildPlanetBattle(setup, ids(i));
    s = processAction(s, { type: 'tick', n: 10 });
    const c = cloneState(s);
    for (const b of c.buildings) if (b.owner === setup.defenderSeat && b.kind === 'hq') b.hp = 0;
    s = processAction(c, { type: 'tick', n: 1 });
    const r = planetBattleReport(setup, s);
    ok(s.winner !== null && r?.winner === 'attacker', `setup ${i}: the attackers win when the Command Yard falls`);
    ok(r?.cityLevelLost === 1, `setup ${i}: the city level is lost`);
    const humanDefends = setup.sides[0].team === setup.sides[setup.defenderSeat].team;
    ok(s.log.some(e => e.text === (humanDefends ? 'Defeat. Our Command Yard has fallen.' : 'Victory. The Command Yard has fallen.')), `setup ${i}: Command Yard message`);
    ok(processAction(s, { type: 'tick', n: 10 }) === s, `setup ${i}: nothing runs after the end`);
  }
  // Another side losing its Command Yard decides nothing.
  {
    const setup = craftSetup(2);
    let s = buildPlanetBattle(setup, ids(2));
    const c = cloneState(s);
    for (const b of c.buildings) if (b.owner === 2 && b.kind === 'hq') b.hp = 0;
    s = processAction(c, { type: 'tick', n: 5 });
    ok(s.winner === null, 'an ally losing its Command Yard does not end the battle');
  }
  // A fallen hero is recorded and reported.
  for (let i = 0; i < SETUPS; i++) {
    const setup = craftSetup(i);
    if (!setup.sides[0].human || !setup.sides[0].heroes.length) continue;
    const s0 = buildPlanetBattle(setup, ids(i));
    const c = cloneState(s0);
    const hero = c.units.find(u => u.owner === 0 && u.hero)!;
    const xp = hero.hero!.xp;
    hero.hp = 0;
    const s = processAction(c, { type: 'tick', n: 2 });
    ok(s.planet!.fallen?.[hero.kind as HeroKind] === xp, `setup ${i}: a fallen hero is recorded with its xp`);
    const r = planetBattleReport(setup, s, { retreat: true })!;
    ok(r.how === 'retreat', `setup ${i}: retreat report`);
    const h = r.sides[0].heroes.find(x => x.kind === hero.kind)!;
    ok(h && !h.alive && h.xp === xp, `setup ${i}: the fallen hero is reported fallen`);
    ok(r.winner === (setup.defenderSeat === 0 ? 'attacker' : 'defender'), `setup ${i}: a retreat loses for the player's team`);
    ok(r.cityLevelLost === (r.winner === 'attacker' ? 1 : 0), `setup ${i}: retreat city level`);
    ok(reportProblem(setup, r) === null, `setup ${i}: retreat report valid (${reportProblem(setup, r)})`);
    ok(planetBattleReport(setup, s) === null, `setup ${i}: no report while running`);
    break;
  }
  // Heroes act in planet battles (abilities cool down only through the hero tick).
  {
    const i = [...Array(SETUPS).keys()].find(k => craftSetup(k).sides[0].heroes.length)!;
    const setup = craftSetup(i);
    const c = cloneState(buildPlanetBattle(setup, ids(i)));
    const hero = c.units.find(u => u.owner === 0 && u.hero)!;
    hero.hero!.abilityCd = 20;
    const s = processAction(c, { type: 'tick', n: 5 });
    ok(s.units.find(u => u.id === hero.id)!.hero!.abilityCd === 15, 'hero ticks run in a planet battle');
  }
  // City damage: of S structures placed for a building, D gone, L - floor(L * (S - D) / S) levels.
  {
    const i = [...Array(SETUPS).keys()].find(k => {
      const st = craftSetup(k);
      return st.sides[st.defenderSeat].cityTags.filter(t => t === 'fortifications').length >= 3;
    })!;
    const setup = craftSetup(i);
    const s0 = buildPlanetBattle(setup, ids(i));
    const forts = s0.planet!.city.filter(([, t]) => t === 'fortifications').map(([id]) => id);
    const L = setup.cityBuildings.fortifications!;
    for (let d = 0; d <= forts.length; d++) {
      const c = cloneState(s0);
      c.buildings = c.buildings.filter(b => !forts.slice(0, d).includes(b.id));
      c.winner = 1;
      const r = planetBattleReport(setup, c)!;
      const want = L - Math.floor((L * (forts.length - d)) / forts.length);
      ok((r.cityDamage.fortifications ?? 0) === want, `city damage with ${d} of ${forts.length} fortifications gone: ${want}`);
    }
    const c = cloneState(s0);
    const eng = c.buildings.find(b => b.id === forts[0])!;
    eng.owner = setup.defenderSeat === 0 ? 1 : 0;
    c.winner = 1;
    ok((planetBattleReport(setup, c)!.cityDamage.fortifications ?? 0) === 0, 'a captured structure still standing counts as intact');
  }
  // Saves: the planet runtime and core tags survive; a malformed runtime is dropped.
  {
    const setup = craftSetup(1);
    const s = tick(buildPlanetBattle(setup, ids(1)), 300);
    const back = migrateState(copy(s));
    ok(JSON.stringify(back) === JSON.stringify(s), 'a planet battle save loads unchanged');
    ok(back && JSON.stringify(tick(back, 300)) === JSON.stringify(tick(s, 300)), 'a planet battle save plays on exactly');
    const bad = copy(s) as GameState;
    (bad.planet as unknown as { ai: string[] }).ai = ['normal'];
    ok(migrateState(bad)?.planet === undefined, 'a planet runtime with the wrong seat count is dropped');
    const bad2 = copy(s) as GameState;
    (bad2.planet as unknown as { timeLimit: string }).timeLimit = 'soon';
    ok(migrateState(bad2)?.planet === undefined, 'a planet runtime with a bad time limit is dropped');
    const bad3 = copy(s) as GameState;
    (bad3.units[0] as unknown as { core: string }).core = 'x';
    ok(migrateState(bad3)?.units[0].core === undefined, 'a bad core tag is dropped');
    const plain = createInitialState('plain', 'P', { seed: 'plain', createdAt: 0, setup: { sides: 3, mode: 'teams' } });
    ok(plain.planet === undefined && plain.units.every(u => u.core === undefined), 'a skirmish has no planet runtime and no core tags');
    ok(JSON.stringify(plain.teams) === '[0,1,0]', 'a skirmish without teams keeps teamsFor');
    const teamed = createInitialState('t', 'T', { seed: 'plain', createdAt: 0, setup: { sides: 3, mode: 'teams' }, teams: [0, 1, 1] });
    ok(JSON.stringify(teamed.teams) === '[0,1,1]', 'NewGameOptions.teams replaces teamsFor with 3 sides');
    const two = createInitialState('t', 'T', { seed: 'plain', createdAt: 0, setup: { sides: 2 }, teams: [1, 0] });
    ok(JSON.stringify(two.teams) === '[0,1]', 'NewGameOptions.teams is ignored with 2 sides');
    const junk = createInitialState('t', 'T', { seed: 'plain', createdAt: 0, setup: { sides: 4, mode: 'teams' }, teams: [0, 0, 0, 0] });
    ok(JSON.stringify(junk.teams) === '[0,1,2,3]', 'a teams list with one team falls back to free-for-all (normaliseTeams)');
  }
  // Perk powers stay without their structures; others follow them as in a skirmish.
  {
    const i = [...Array(SETUPS).keys()].find(k => craftSetup(k).powers.includes('recon'))!;
    const setup = craftSetup(i);
    const s = tick(buildPlanetBattle(setup, ids(i)), 60);
    ok(s.powers?.[0]?.recon !== undefined, 'a perk power stays with no Uplink');
  }
}

// ---- Whole battles ------------------------------------------------------------------------------

function autopilotTests(ok: Ok): void {
  // 2,000 ticks with the computer on every side: every map type, 2, 3 and 4 sides, each human role.
  for (let i = 0; i < 12; i++) {
    const setup = craftSetup(i);
    let s = buildPlanetBattle(setup, ids(i), { autopilot: true });
    s = tick(s, 2000);
    ok(s.tick === 2000 || s.winner !== null, `setup ${i}: 2,000 ticks run`);
    ok(s.units.every(u => Number.isFinite(u.x) && Number.isFinite(u.y) && Number.isFinite(u.hp)), `setup ${i}: positions and health finite`);
    ok(s.players.every(p => Number.isFinite(p.credits) && p.credits >= 0), `setup ${i}: credits finite`);
    ok(s.units.some(u => u.core !== undefined) || !setup.sides.some(x => x.units.some(u => u.core !== null)) || s.tick > 0, `setup ${i}: core tags kept`);
    if (s.winner === null) ok(planetBattleReport(setup, s) === null, `setup ${i}: no report while running`);
  }
}

function simulateTests(ok: Ok): void {
  // Six battles played to the end: two-sided, three-sided and four-sided, human and not.
  const outcomes: string[] = [];
  for (const i of [0, 1, 2, 3, 4, 5]) {
    // Ten-minute battles keep the section quick; the full-length ones run in the war section.
    const setup = deepFreeze({ ...craftSetup(i), timeLimit: 10 * 60 * TICKS_PER_SECOND });
    const r = simulateBattle(setup, 0);
    outcomes.push(`${setup.sides.length} sides ${r.winner} at ${Math.round(r.ticks / 600)} min`);
    ok(r.how === 'simulated', `setup ${i}: simulated`);
    ok(r.ticks > 0 && r.ticks <= setup.timeLimit, `setup ${i}: ends by the time limit (${r.ticks})`);
    ok(reportProblem(setup, r) === null, `setup ${i}: the report passes validation (${reportProblem(setup, r)})`);
    // Twice for the shorter ones: the same setup simulates to the same report.
    if (r.ticks < setup.timeLimit) ok(JSON.stringify(simulateBattle(setup, 0)) === JSON.stringify(r), `setup ${i}: simulation deterministic`);
  }
  console.log(`  simulated: ${outcomes.join('; ')}`);
}

// ---- Auto-resolve -------------------------------------------------------------------------------

function quickTests(ok: Ok): void {
  let attackerWins = 0;
  for (let i = 0; i < SETUPS; i++) {
    const setup = deepFreeze(craftSetup(i));
    const r = quickResolve(setup);
    const t = `setup ${i}`;
    ok(JSON.stringify(quickResolve(setup)) === JSON.stringify(r), `${t}: deterministic`);
    ok(r.how === 'quick' && r.ticks === 0 && r.battleId === setup.battleId, `${t}: quick report`);
    ok(reportProblem(setup, r) === null, `${t}: valid (${reportProblem(setup, r)})`);
    const p = attackOdds(setup);
    ok(p > 0 && p < 1, `${t}: odds inside 0..1`);
    setup.sides.forEach((side, o) => {
      const sv = r.sides[o].survivors;
      ok(sv.length <= side.units.length, `${t}: side ${o} survivors no more than it brought`);
      // A subset: each survivor matched to a distinct setup unit of its kind, core tags kept.
      const pool = side.units.map(u => `${u.kind}:${u.core ?? '-'}`);
      ok(sv.every(u => {
        const k = pool.indexOf(`${u.kind}:${u.core ?? '-'}`);
        if (k < 0) return false;
        pool.splice(k, 1);
        return true;
      }), `${t}: side ${o} survivors a subset of the setup`);
      ok(sv.every(u => u.kills >= (side.units.find(x => x.core !== null && x.core === u.core)?.kills ?? 0)), `${t}: side ${o} kills never fall`);
      ok(sideStrength(setup, o) > 0, `${t}: side ${o} strength positive`);
    });
    // Kills: with every unit starting at 0, each team's survivors hold one kill per enemy lost.
    const fresh = { ...copy(setup), sides: setup.sides.map(x => ({ ...copy(x), units: x.units.map(u => ({ ...u, kills: 0 })) })) };
    const rf = quickResolve(fresh);
    for (const team of [0, 1]) {
      const mine = fresh.sides.map((x, o) => (x.team === team ? rf.sides[o].survivors : [])).flat();
      const enemyLost = fresh.sides.reduce((n, x, o) => n + (x.team !== team ? x.units.length - rf.sides[o].survivors.length : 0), 0);
      if (mine.length) ok(mine.reduce((a, u) => a + u.kills, 0) === enemyLost, `${t}: team ${team} credited one kill per enemy lost`);
      if (mine.length) ok(Math.max(...mine.map(u => u.kills)) - Math.min(...mine.map(u => u.kills)) <= 1, `${t}: team ${team} kills shared round-robin`);
    }
    if (r.winner === 'attacker') attackerWins++;
    ok(Object.entries(r.cityDamage).every(([b, v]) => v! <= (setup.cityBuildings[b as CityBuildingId] ?? 0)), `${t}: city damage within the building levels`);
  }
  ok(attackerWins > 0 && attackerWins < SETUPS, `both teams win some auto-resolves (${attackerWins} of ${SETUPS} to the attackers)`);
  // Odds rise with the attacker's strength and fall with the defender's terrain.
  const base = craftSetup(1);
  const more = copy(base);
  more.sides[0].units.push(...Array.from({ length: 10 }, () => ({ kind: 'tank' as ArmyKind, kills: 0, core: null })));
  ok(attackOdds(more) > attackOdds(base), 'more attacking tanks raise the odds');
  const high = { ...copy(base), mapType: 'highlands' as MapType };
  const flat = { ...copy(base), mapType: 'plains' as MapType };
  ok(attackOdds(high) < attackOdds(flat), 'highlands defend better than plains');
  const vet = copy(base);
  for (const u of vet.sides[0].units) u.kills = 9;
  ok(attackOdds(vet) > attackOdds({ ...copy(base), sides: base.sides.map(x => ({ ...x, units: x.units.map(u => ({ ...u, kills: x === base.sides[0] ? 0 : u.kills })) })) }), 'elite attackers raise the odds');
  // The stronger team wins most auto-resolves across seeds.
  let strongWins = 0;
  for (let k = 0; k < 200; k++) {
    const st = copy(more);
    st.seedText = `odds:${k}`;
    if (quickResolve(st).winner === (attackOdds(st) >= 0.5 ? 'attacker' : 'defender')) strongWins++;
  }
  ok(strongWins > 120, `the favoured team wins most of 200 auto-resolves (${strongWins})`);
  // Difficulty: computer sides are stronger on hard when a human side is present.
  const human = craftSetup(0);
  ok(sideStrength({ ...human, difficulty: 'hard' }, 1) > sideStrength({ ...human, difficulty: 'easy' }, 1), 'QUICK_DIFFICULTY scales computer sides');
  ok(sideStrength({ ...human, difficulty: 'hard' }, 0) === sideStrength({ ...human, difficulty: 'easy' }, 0), 'the human side is not scaled');
}

// ---- Size ---------------------------------------------------------------------------------------

function sizeTests(ok: Ok): void {
  const i = [...Array(SETUPS).keys()].find(k => craftSetup(k).sides.length === 4 && craftSetup(k).sides[0].human)!;
  const setup = craftSetup(i);
  let s = buildPlanetBattle(setup, ids(i));
  const setupBytes = JSON.stringify(setup).length;
  // The whole save: the strategic part at its 48 KB budget plus the battle in progress.
  const STRATEGIC = 48 * 1024;
  const at0 = JSON.stringify(s).length;
  s = tick({ ...s, autopilot: true }, 3000);
  const at3000 = JSON.stringify(s).length;
  console.log(`  four-sided battle: ${Math.round(at0 / 1024)} KB at tick 0, ${Math.round(at3000 / 1024)} KB at tick 3,000; setup ${Math.round(setupBytes / 1024)} KB`);
  ok(STRATEGIC + at0 < 256 * 1024, 'whole save with a four-sided battle at tick 0 under 256 KB');
  ok(STRATEGIC + at3000 < 256 * 1024, 'whole save with a four-sided battle at tick 3,000 under 256 KB');
  ok(setupBytes < 8 * 1024, 'a pending setup under 8 KB');
}

// ---- Story missions and skirmishes untouched -----------------------------------------------------

/**
 * Hashes of every story mission's state at tick 0 and after 600 ticks, with the default context and
 * with every hero brought (one wounded), and of skirmishes of 2, 3 and 4 sides at tick 0 and after
 * 1,500 autopilot ticks: recorded from the build before the planet hooks (git archive of HEAD
 * 7814d9c), so any change to an existing battle fails here. At the merge with main (2026-11-11)
 * 22 story hashes were regenerated from origin/main's own code (b302d1e), because main changed
 * those missions: Demolition and the Commando (ce964a2: the mission itself, the Commando's health
 * at tick 0 wherever he is brought, and a defending enemy's `garrison` written at its first
 * decision in Ace of Spades, Convoy North, Bastion Line and Borrowed Steel) and Borrowed Steel
 * (cb7044c). The merged tree gives exactly origin/main's hash for every mission; the skirmish
 * hashes are unchanged (fireline-design.md, build log of the merge).
 */
const STORY_HASHES: Record<string, string> = {
  'first-light:default:0': '811641bc63b24a6a',
  'first-light:default:600': '812bea5ba6994cd9',
  'first-light:heroes:0': '811641bc63b24a6a',
  'first-light:heroes:600': '812bea5ba6994cd9',
  'quiet-man:default:0': '40dcd4cad0eabf4a',
  'quiet-man:default:600': 'b98f819ead65ea7b',
  'quiet-man:heroes:0': '40dcd4cad0eabf4a',
  'quiet-man:heroes:600': 'b98f819ead65ea7b',
  'hold-the-ford:default:0': '031181a70b4b863b',
  'hold-the-ford:default:600': 'a9ed3f9e51b44186',
  'hold-the-ford:heroes:0': '031181a70b4b863b',
  'hold-the-ford:heroes:600': 'a9ed3f9e51b44186',
  'demolition:default:0': 'e41665273b3d27fc',
  'demolition:default:600': '5fd55f4cf9b83a12',
  'demolition:heroes:0': 'be8caa56d99469ab',
  'demolition:heroes:600': 'c9e80d75400dd433',
  'borrowed-steel:default:0': '20947df3c8ebf600',
  'borrowed-steel:default:600': '61f555a4f2e13952',
  'borrowed-steel:heroes:0': 'ae813d3601895ad1',
  'borrowed-steel:heroes:600': '999b2ec9c36886e8',
  'ace-of-spades:default:0': 'e04947e732c29147',
  'ace-of-spades:default:600': '82adff56777123ed',
  'ace-of-spades:heroes:0': '72fb3a5f7b1909fa',
  'ace-of-spades:heroes:600': '1a663addd7df8707',
  'blackout:default:0': '6b2339c402655984',
  'blackout:default:600': '668a7d5dd2de50c0',
  'blackout:heroes:0': '30408d634d10e8b5',
  'blackout:heroes:600': '9e22c9a0d7093dc6',
  'fireline:default:0': 'a04ea7c2fa164106',
  'fireline:default:600': '7c8a9ff590ef1bb7',
  'fireline:heroes:0': 'bc0eb59bb276b49f',
  'fireline:heroes:600': '67242d31f60fe5b2',
  'iron-coast:default:0': 'd9384af9038661e7',
  'iron-coast:default:600': '5d49032094e8d299',
  'iron-coast:heroes:0': 'd9384af9038661e7',
  'iron-coast:heroes:600': '5d49032094e8d299',
  'convoy-north:default:0': 'b1559d2a62d27df0',
  'convoy-north:default:600': 'a09668530d69f963',
  'convoy-north:heroes:0': 'b2e676465dfae66c',
  'convoy-north:heroes:600': 'f1d6b1fd1a7d3314',
  'the-long-hold:default:0': '970a2f907d138a47',
  'the-long-hold:default:600': 'e793302eb80e3773',
  'the-long-hold:heroes:0': '970a2f907d138a47',
  'the-long-hold:heroes:600': 'e793302eb80e3773',
  'firestorm:default:0': '9288c0f66ac19950',
  'firestorm:default:600': 'a1a8412e66a3f670',
  'firestorm:heroes:0': 'd32b9abaebaf09dd',
  'firestorm:heroes:600': 'de23351541a8713e',
  'bastion-line:default:0': 'd287e1928e60a48d',
  'bastion-line:default:600': '341446e0d3fbefa3',
  'bastion-line:heroes:0': '754b11f3a56ee6bc',
  'bastion-line:heroes:600': 'e4a98f826ac1301a',
  'last-light:default:0': '6844b11db528fe62',
  'last-light:default:600': 'adc2d84a50b46c68',
  'last-light:heroes:0': 'c8f19bca3b4b56e3',
  'last-light:heroes:600': 'c99531bb6add4939',
};

const SKIRMISH_HASHES: Record<string, string> = {
  'sk:2:ffa:classic:0': '97337cf4047551e0',
  'sk:2:ffa:classic:1500': '5b3a1bbcbf8eb038',
  'sk:2:ffa:river:0': '9bec0d5611bbd47e',
  'sk:2:ffa:river:1500': '89f8f055d566065a',
  'sk:2:ffa:highlands:0': 'a3eb01caff3fbfc6',
  'sk:2:ffa:highlands:1500': '86eecf3056b665f2',
  'sk:2:ffa:lakes:0': '06aff79aa4fe5666',
  'sk:2:ffa:lakes:1500': '007537c5c25a8bed',
  'sk:2:ffa:plains:0': 'fb98001ef546cfd9',
  'sk:2:ffa:plains:1500': '30ac4e8a9a713f33',
  'sk:2:ffa:canyon:0': '9452aeac25b18321',
  'sk:2:ffa:canyon:1500': '4f93349979304eeb',
  'sk:3:ffa:classic:0': 'd75d5d530f068f4e',
  'sk:3:ffa:classic:1500': '35c53a7098e0b7d1',
  'sk:3:ffa:river:0': '16efc223c49b5e4d',
  'sk:3:ffa:river:1500': '52ef3193d767c32f',
  'sk:3:ffa:highlands:0': '747bc8149c51fcfb',
  'sk:3:ffa:highlands:1500': '080213b7e093c5a1',
  'sk:3:ffa:lakes:0': '8c160f9be7c82e8e',
  'sk:3:ffa:lakes:1500': 'f1b11135d35c1ab8',
  'sk:3:ffa:plains:0': '43a1a4df6bae0622',
  'sk:3:ffa:plains:1500': 'e989e34b2b013693',
  'sk:3:ffa:canyon:0': 'e2caa0272a727823',
  'sk:3:ffa:canyon:1500': 'de814beef1491921',
  'sk:3:teams:classic:0': '75cbc3a3b079a09f',
  'sk:3:teams:classic:1500': 'ccf6c6edfa073b66',
  'sk:3:teams:river:0': '7f7cc053922a1e2f',
  'sk:3:teams:river:1500': '9eaad321baff4f3b',
  'sk:3:teams:highlands:0': 'e89da7a26a7c4c3a',
  'sk:3:teams:highlands:1500': '9ad4a9ecdac2eac4',
  'sk:3:teams:lakes:0': 'cc41dac10e94d847',
  'sk:3:teams:lakes:1500': '0af9799174e99023',
  'sk:3:teams:plains:0': '464414d15cf93acc',
  'sk:3:teams:plains:1500': '5a9f94a9997fb6a2',
  'sk:3:teams:canyon:0': '76d50a19f9c748bf',
  'sk:3:teams:canyon:1500': '1c56330aa5c7b0e9',
  'sk:4:ffa:classic:0': 'c43500976b850c84',
  'sk:4:ffa:classic:1500': 'd65ddafc893d0fad',
  'sk:4:ffa:river:0': '65f6cd0d4d167772',
  'sk:4:ffa:river:1500': '917b2bd840d2b310',
  'sk:4:ffa:highlands:0': 'c06efea1ed1bca31',
  'sk:4:ffa:highlands:1500': 'd3b2316667cfb65f',
  'sk:4:ffa:lakes:0': 'b2244eecfa329590',
  'sk:4:ffa:lakes:1500': '6f59cd4a67bad44f',
  'sk:4:ffa:plains:0': '1ffddb27ca7654d1',
  'sk:4:ffa:plains:1500': '7681ad6fda27a5f4',
  'sk:4:ffa:canyon:0': '86c6cdd1253243f7',
  'sk:4:ffa:canyon:1500': '234a2eb61e22972f',
  'sk:4:teams:classic:0': '6f33760676a3666d',
  'sk:4:teams:classic:1500': 'a6e0fe2c0fdd433e',
  'sk:4:teams:river:0': '0f0c3fd18a0b942f',
  'sk:4:teams:river:1500': 'beb72d066e375818',
  'sk:4:teams:highlands:0': 'd5ef3bb17cac6143',
  'sk:4:teams:highlands:1500': '5cbd1e0813231774',
  'sk:4:teams:lakes:0': 'ff4393040e5201b6',
  'sk:4:teams:lakes:1500': '6388956b53f040d5',
  'sk:4:teams:plains:0': 'f764abf874a36500',
  'sk:4:teams:plains:1500': '061b66be16d2aa64',
  'sk:4:teams:canyon:0': '52d040ed0ff673f1',
  'sk:4:teams:canyon:1500': '230d7a0cbef55f34',
  'legacy:0': '53a4065f35605e52',
  'legacy:1500': 'a81831e5a5b59b38',
};

function storyTests(ok: Ok): void {
  const c0 = newCampaign('T');
  const all = { ...c0, heroes: Object.fromEntries(HERO_KINDS.map((k, i) => [k, { unlocked: true, xp: 300 * ['spy', 'commando', 'engineer', 'ace'].indexOf(k), wounded: k === 'commando', lost: false }])) } as unknown as typeof c0;
  ok(MISSIONS.length === 14, 'all 14 story missions');
  for (const m of MISSIONS) {
    for (const [tag, c] of [['default', c0], ['heroes', all]] as const) {
      let s = createMissionState(m, missionContext(c, m, 'x', 0));
      ok(hash(s) === STORY_HASHES[`${m.id}:${tag}:0`], `${m.id} (${tag}) byte-identical at tick 0`);
      s = tick(s, 600);
      ok(hash(s) === STORY_HASHES[`${m.id}:${tag}:600`], `${m.id} (${tag}) byte-identical after 600 ticks`);
    }
  }
  let k = 0;
  for (const sides of [2, 3, 4] as const)
    for (const mode of ['ffa', 'teams'] as const)
      for (const map of MAP_TYPES) {
        if (sides === 2 && mode === 'teams') continue;
        k++;
        let s = createInitialState('sk', 'Sk', { seed: `hash${k}`, createdAt: 0, autopilot: true, setup: { map, tech: k % 2 ? 'advanced' : 'standard', credits: 5000, ore: 'normal', sides, mode, research: k % 3 ? 'lines' : 'classic' } });
        ok(hash(preSize(s)) === SKIRMISH_HASHES[`sk:${sides}:${mode}:${map}:0`], `skirmish ${sides} ${mode} ${map} byte-identical at tick 0`);
        s = tick(s, 1500);
        ok(hash(preSize(s)) === SKIRMISH_HASHES[`sk:${sides}:${mode}:${map}:1500`], `skirmish ${sides} ${mode} ${map} byte-identical after 1,500 ticks`);
      }
  let s = createInitialState('legacy', 'L', { seed: 'legacy', createdAt: 0, autopilot: true });
  ok(hash(s) === SKIRMISH_HASHES['legacy:0'], 'the original game byte-identical at tick 0');
  s = tick(s, 1500);
  ok(hash(s) === SKIRMISH_HASHES['legacy:1500'], 'the original game byte-identical after 1,500 ticks');
}

// ---- Purity ---------------------------------------------------------------------------------------

function purityTests(ok: Ok): void {
  const dir = join(dirname(new URL(import.meta.url).pathname), '..', 'src', 'planet');
  for (const f of ['resolve.ts', 'battle.ts']) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const bad of ['Math.random', 'Date.now', 'performance', 'setTimeout', 'window', 'document']) ok(!src.includes(bad), `${f} never uses ${bad}`);
  }
  const setup = deepFreeze(craftSetup(7));
  let threw = false;
  try {
    quickResolve(setup);
    attackOdds(setup);
    buildPlanetBattle(setup, ids(7));
  } catch {
    threw = true;
  }
  ok(!threw, 'resolve and build never write to a frozen setup');
}

// ---- Setups from a war (W1's battleSetupFor) and reports through W1's reducer ------------------------

const alliance = (a: number, b: number): Treaty => ({ a: Math.min(a, b), b: Math.max(a, b), kind: 'alliance', turns: null, terms: [], since: 1, ends: null });

/** A fresh Long war with the opening truce lifted, the given alliances, and stocks to pay for attacks. */
function openWar(seed: string, alliances: [number, number][]): PlanetState {
  const w: PlanetState = copy(newPlanetState({ seedText: seed, preset: 'long', difficulty: 'normal', commander: 'Tester', createdAt: 0 }));
  w.treaties = alliances.map(([a, b]) => alliance(a, b)).sort((x, y) => x.a - y.a || x.b - y.b);
  for (const f of w.factions) f.stock = { ore: 99, fuel: 99, alloys: 99, food: 99 };
  return w;
}

function warTests(ok: Ok): void {
  // Every attack open at the start of a dozen wars: built, placed, auto-resolved to a valid report.
  let built = 0;
  for (let k = 0; k < 12; k++) {
    const w = openWar(`w2-war-${k}`, k % 2 ? [[0, 2]] : []);
    for (const f of w.factions)
      for (const r of attackTargets(w, f.id)) {
        const st = battleSetupFor(w, f.id, r, 1000, f.id === 0 ? ['engineer'] : [], 1);
        if (!st) continue;
        built++;
        const s = buildPlanetBattle(st, ids(built));
        st.sides.forEach((side, o) => ok(s.units.filter(u => u.owner === o && !u.hero && u.kind !== 'hauler').length === side.units.length, `war setup ${built}: side ${o} units placed`));
        ok(s.planet!.city.length <= st.sides[st.defenderSeat].cityTags.filter(Boolean).length, `war setup ${built}: city tags`);
        ok(reportProblem(st, quickResolve(st)) === null, `war setup ${built}: auto-resolve report valid`);
      }
  }
  ok(built >= 40, `setups from wars built (${built})`);
  // Allied teams from a war: three sides (the player's ally joins) and four (a defender's ally too,
  // the player defending its capital).
  for (let k = 0; k < 30; k++) {
    const w = openWar(`w2-allies-${k}`, [[0, 2], [1, 3]]);
    const m = planetMapOf(w);
    const cap = w.factions[0].capital;
    const nb = m.regions[cap].links.map(l => l.to).filter(r => w.regions[r].owner !== 0 && !w.factions.some(f => f.capital === r));
    if (nb.length < 3) continue;
    w.regions[nb[0]].owner = 1;
    w.factions[1].army!.region = nb[0];
    w.regions[nb[1]].owner = 3;
    w.regions[nb[1]].garrison = [4, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0];
    w.regions[nb[2]].owner = 2;
    w.regions[nb[2]].garrison = [4, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0];
    const four = battleSetupFor(w, 1, cap, 2000, [], 5);
    if (!four) continue;
    ok(four.sides.length === 4 && four.sides[0].human && four.defenderSeat === 0, 'a four-sided defence of the capital, the player at seat 0');
    const s = buildPlanetBattle(four, ids(500));
    ok(JSON.stringify(s.teams) === JSON.stringify(four.sides.map(x => x.team)), `four-sided teams ${s.teams} equal the setup's`);
    ok(!s.autopilot && s.units.some(u => u.owner === 0 && u.hero), 'the human defends with its heroes');
    const r = simulateBattle(four, 0);
    ok(reportProblem(four, r) === null, `four-sided allied battle simulated to a valid report (${r.winner} at tick ${r.ticks})`);
    console.log(`  four-sided allied defence on ${four.mapType}: ${r.winner} at tick ${r.ticks}`);
    break;
  }
  // The reducer accepts each kind of report: fought, retreat, simulated and the instant auto-resolve.
  const kinds = new Set<string>();
  for (let k = 0; k < 20 && kinds.size < 4; k++) {
    const w = openWar(`w2-reducer-${k}`, []);
    w.options = { ...w.options, simulatedAutoResolve: true };
    const t = attackTargets(w, 0)[0];
    if (t === undefined) continue;
    const atk = { type: 'attack' as const, target: t, credits: 1000 as const, heroes: ['engineer' as const] };
    const a = applyPlanetAction(w, atk);
    if (a === w) continue;
    const setup = a.pending[0].setup;
    const f = applyPlanetAction(a, { type: 'fight' });
    ok(f !== a && f.pending[0].fighting, 'fight accepted');
    if (!kinds.has('fought')) {
      let g = buildPlanetBattle(setup, ids(600 + k), { autopilot: true });
      while (g.winner === null) g = processAction(g, { type: 'tick', n: 600 });
      const r = planetBattleReport(setup, g)!;
      const after = applyPlanetAction(f, { type: 'battleResult', report: r });
      ok(after !== f && after.pending.length === 0, `a fought report is accepted (${planetActionProblem(f, { type: 'battleResult', report: r })})`);
      ok(applyPlanetAction(a, { type: 'battleResult', report: r }) === a, 'a fought report is refused when not fighting');
      kinds.add('fought');
    }
    const g2 = processAction(buildPlanetBattle(setup, ids(700 + k)), { type: 'tick', n: 300 });
    const rr = planetBattleReport(setup, g2, { retreat: true })!;
    ok(applyPlanetAction(f, { type: 'battleResult', report: rr }) !== f, `a retreat report is accepted (${planetActionProblem(f, { type: 'battleResult', report: rr })})`);
    kinds.add('retreat');
    if (!kinds.has('simulated')) {
      const r = simulateBattle(setup, 0);
      ok(applyPlanetAction(a, { type: 'battleResult', report: r }) !== a, `a simulated report is accepted (${planetActionProblem(a, { type: 'battleResult', report: r })})`);
      const off = { ...a, options: { ...a.options, simulatedAutoResolve: false } };
      ok(applyPlanetAction(off, { type: 'battleResult', report: r }) === off, 'a simulated report is refused with the option off');
      kinds.add('simulated');
    }
    const q = applyPlanetAction(a, { type: 'autoResolve' });
    ok(q !== a && q.pending.length === 0, 'auto-resolve accepted');
    kinds.add('quick');
  }
  ok(kinds.size === 4, `every kind of report applied (${[...kinds].join(', ')})`);
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Planet battles: building from a setup', buildTests],
  ['Planet battles: engine hooks (victory, heroes, city damage, saves)', hookTests],
  ['Planet battles: 2,000 autopilot ticks', autopilotTests],
  ['Planet battles: simulated to the end', simulateTests],
  ['Planet battles: auto-resolve', quickTests],
  ['Planet battles: save size', sizeTests],
  ['Planet battles: story missions and skirmishes byte-identical', storyTests],
  ['Planet battles: purity', purityTests],
  ['Planet battles: setups from a war, reports through the reducer', warTests],
];

// Run on its own: every section, with its own count.
if (process.argv[1] && /drive-planet-battle\.ts$/.test(process.argv[1])) {
  let passed = 0;
  let failed = 0;
  const ok: Ok = (cond, what) => {
    if (cond) passed++;
    else {
      failed++;
      if (failed <= 40) console.log(`  FAIL ${what}`);
    }
  };
  const t0 = Date.now();
  for (const [name, fn] of sections) {
    const t = Date.now();
    console.log(name);
    fn(ok);
    console.log(`  (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  }
  console.log(`\n${passed} assertions passed, ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (failed) process.exit(1);
}
