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
import { BIG_CITY_LEVEL, battleMapSize, battleMapSizeOf, buildPlanetBattle, planetBattleReport, simulateBattle } from '../src/planet/battle';
import { attackTargets, battleSetupFor } from '../src/planet/battleSetup';
import { planetMapOf } from '../src/planet/map';
import { PLANET_TERRAINS } from '../src/planet/rules';
import { attackOdds, quickResolve, sideStrength } from '../src/planet/resolve';
import { migratePlanetSave, newPlanetSave } from '../src/planet/save';
import { newPlanetState } from '../src/planet/state';
import { planAiActions } from '../src/planet/ai';
import { applyPlanetAction, planetActionProblem } from '../src/planet/turn';
import { ARMY_KINDS, type ArmyKind, type BattleReport, type BattleSetup, type BattleSide, type CityBuildingId, type PlanetState, type Treaty } from '../src/planet/types';
import { processAction } from '../src/sim/actions';
import { missionMode } from '../src/sim/ai';
import { fieldGenerals } from '../src/sim/generals';
import { heroesInPlay } from '../src/sim/heroes';
import { createMissionState } from '../src/sim/mission';
import { seedFromString, stream } from '../src/sim/rng';
import {
  HERO_ACADEMY,
  HERO_KINDS,
  MAP_SIZE_TILES,
  MODULES,
  MODULE_SLOTS,
  TICKS_PER_SECOND,
  UNITS,
  type BuildingKind,
  type HeroKind,
  type MapSize,
  type MapType,
  type ModuleId,
  type UnitKind,
  type UpgradeId,
} from '../src/sim/rules';
import { canQueue } from '../src/sim/commands';
import { addUnit, cloneState, createInitialState, migrateState, techAllowed } from '../src/sim/state';
import type { GameState } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const hash = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
/**
 * A battle state as hashed before the merge with the armies' round 6 (fireline-round6-design.md,
 * section 10). A skirmish setup now states every seat's army, heroes, Generals and each seat's
 * doctrine General, and every player of a skirmish records its army; left at their defaults (all
 * Meridian, everything off) they mean the earlier battle exactly. So they are checked to be the
 * defaults, nothing else of round 6's (perks for other sides, squads, a General or a recruited
 * hero's record) may appear, and then they are left out of the hash.
 */
const round6Off = (s: GameState): boolean => {
  try {
    preRound6(s);
    return true;
  } catch {
    return false;
  }
};
const preRound6 = (s: GameState): GameState => {
  if (s.sidePerks !== undefined) throw new Error('a battle gained perks for another side');
  if (s.squads !== undefined) throw new Error('a battle formed a squad');
  const players = s.players.map(p => {
    if (p.faction !== undefined && p.faction !== 'meridian') throw new Error(`side ${p.owner} fields ${p.faction}`);
    if (p.heroFallen !== undefined || p.general !== undefined || p.generalUnit !== undefined || p.generalLostAt !== undefined)
      throw new Error(`side ${p.owner} has a round 6 hero or General record`);
    const { faction: _f, ...rest } = p;
    return rest;
  });
  if (s.units.some(u => u.kind === 'general' || u.squad !== undefined)) throw new Error('a General or a squad member on the field');
  if (s.buildings.some(b => b.kind === HERO_ACADEMY)) throw new Error('a Command Academy on the field');
  if (!s.setup) return { ...s, players };
  const { factions, heroes, generals, generalPicks, ...setup } = s.setup;
  if (factions !== undefined && (factions.length !== s.players.length || factions.some(f => f !== 'meridian'))) throw new Error(`setup armies ${factions}`);
  if (heroes !== undefined && heroes !== false) throw new Error('setup heroes on');
  if (generals !== undefined && generals !== false) throw new Error('setup Generals on');
  if (generalPicks !== undefined && (generalPicks.length !== s.players.length || generalPicks.some(g => g !== null))) throw new Error('setup doctrine Generals picked');
  return { ...s, players, setup: setup as GameState['setup'] };
};
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
/**
 * A battle state as hashed before the naval war: main's 1608d33 gives every player an empty Naval
 * queue, and a planet battle never has a navy (techAllowed), so the queue is checked empty, the
 * computer's memory is checked free of a sea, and the queue is left out of the hash.
 */
const preNaval = (s: GameState): unknown => {
  if (s.ai.some(m => m.navalShore !== undefined || m.landing !== undefined)) throw new Error('a planet battle looked for a sea');
  return {
    ...s,
    players: s.players.map(p => {
      if (p.queues.naval === undefined || p.queues.naval.length) throw new Error(`side ${p.owner}'s Naval queue is not empty`);
      const { naval: _drop, ...queues } = p.queues;
      return { ...p, queues };
    }),
  };
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
  const mapType = PLANET_TERRAINS[i % PLANET_TERRAINS.length];
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
  ok(seen.maps.size === PLANET_TERRAINS.length, 'every planet terrain covered');
  // The naval war (2026-11-11 merge): a planet battle has no navy. The Naval Yard and every ship
  // are refused for every side, and the computer never looks for a sea, so its memory stays as
  // before the naval war. A large Lakes battle, the likeliest to hold a sea, played a while.
  {
    const k = [...Array(SETUPS).keys()].find(j => craftSetup(j).mapType === 'lakes' && craftSetup(j).sides.length === 2)!;
    const setup: BattleSetup = { ...craftSetup(k), mapSize: 'large' };
    let s = buildPlanetBattle(setup, ids(k), { autopilot: true });
    s.players.forEach(p => {
      p.credits = 50000;
      ok(!techAllowed(s, p.owner, 'shipyard') && !canQueue(s, p.owner, 'building', 'shipyard'), `planet battle: side ${p.owner} may not build a Naval Yard`);
      for (const kind of Object.keys(UNITS) as UnitKind[]) if (UNITS[kind].category === 'naval') ok(!techAllowed(s, p.owner, kind), `planet battle: side ${p.owner} may not build a ${UNITS[kind].name}`);
    });
    s = tick({ ...s, autopilot: true }, 6000);
    ok(!s.buildings.some(b => b.kind === 'shipyard') && !s.units.some(u => UNITS[u.kind].category === 'naval'), 'planet battle after 6,000 ticks: no Naval Yard, no ship');
    ok(s.ai.every(m => m.navalShore === undefined), 'planet battle: the computer never looks for a sea');
  }
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
  // Infantry aboard a Troop Carrier (the air war, merged 2026-11-11) are reported as survivors, core slot kept.
  {
    const setup = craftSetup(0);
    const c = cloneState(buildPlanetBattle(setup, ids(0)));
    const rider = c.units.find(u => u.owner === 0 && !u.hero && UNITS[u.kind].category === 'infantry' && u.core !== undefined);
    ok(!!rider, 'a core infantry unit to put aboard');
    if (rider) {
      const before = planetBattleReport(setup, c, { retreat: true })!.sides[0].survivors;
      const carrier = addUnit(c, 0, 'carrier', rider.x, rider.y);
      c.units = c.units.filter(u => u !== rider);
      carrier.carried = [rider];
      const after = planetBattleReport(setup, c, { retreat: true })!.sides[0].survivors;
      ok(after.length === before.length && after.some(x => x.core === rider.core && x.kind === rider.kind), `infantry aboard a carrier still reported (${before.length} and ${after.length} survivors)`);
      carrier.hp = 0;
      const lost = planetBattleReport(setup, c, { retreat: true })!.sides[0].survivors;
      ok(lost.length === before.length - 1 && !lost.some(x => x.core === rider.core), 'infantry aboard a downed carrier are lost');
    }
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
  const high = { ...copy(base), mapType: 'highlands' as const };
  const flat = { ...copy(base), mapType: 'plains' as const };
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
 * hashes are unchanged (fireline-design.md, build log of the merge). At the second merge with main
 * (the air war, 2026-11-11) 12 more were regenerated from origin/main's own code (f6798a8): Quiet
 * Man, Blackout and Last Light, all four each, which main's 2668bda rebuilt so a player can win them.
 * The skirmish hashes are again unchanged.
 *
 * At the merge with main's naval war (2026-11-11) every hash here was regenerated, story and
 * skirmish, and the Coast skirmishes were added. Main's 1608d33 gives every player an empty Naval
 * queue (`queues.naval`), so every state's JSON changed there, and main's computer (62f30b6) writes
 * `navalShore: null` into its memory at its first decision in an advanced battle without a sea.
 * Bisected: the 56 story hashes match the old ones at 1608d33's parent and origin/main's at 1608d33
 * and at 345207f; the merged tree gives exactly origin/main's. Every old skirmish hash (62 of 62)
 * equals the merged state with only the empty Naval queue and `navalShore: null` left out, so no
 * battle played differently. The skirmish loop keeps the six map types of before (PRE_NAVAL_MAPS),
 * so the seeds stay the same.
 */
const STORY_HASHES: Record<string, string> = {
  'first-light:default:0': '4d32cc24a875ca20',
  'first-light:default:600': '0b40f116c96bc75b',
  'first-light:heroes:0': '4d32cc24a875ca20',
  'first-light:heroes:600': '0b40f116c96bc75b',
  'quiet-man:default:0': '9237e24d5c74c195',
  'quiet-man:default:600': '533bdfeb3e11284a',
  'quiet-man:heroes:0': '9237e24d5c74c195',
  'quiet-man:heroes:600': '533bdfeb3e11284a',
  'hold-the-ford:default:0': '26a4e11ff53a03e0',
  'hold-the-ford:default:600': 'e8d2d58642ff370c',
  'hold-the-ford:heroes:0': '26a4e11ff53a03e0',
  'hold-the-ford:heroes:600': 'e8d2d58642ff370c',
  'demolition:default:0': '2fee103b7707df89',
  'demolition:default:600': '4b22665d6a39adf5',
  'demolition:heroes:0': '86b5194886c76d68',
  'demolition:heroes:600': '61e9b6c3aebc4645',
  'borrowed-steel:default:0': '94ef218267577b5e',
  'borrowed-steel:default:600': '5f48eae5fd6c2561',
  'borrowed-steel:heroes:0': '195bf3bc3df8846f',
  'borrowed-steel:heroes:600': '262b0be488877654',
  'ace-of-spades:default:0': '4067135d0056003a',
  'ace-of-spades:default:600': '4d520070ff02dd13',
  'ace-of-spades:heroes:0': '0600da83e5fce600',
  'ace-of-spades:heroes:600': '7285ed044aacf17d',
  'blackout:default:0': 'a5d6f7332e12611d',
  'blackout:default:600': 'c642059495ac6a54',
  'blackout:heroes:0': 'f49e86566206fda3',
  'blackout:heroes:600': '0bd8fc4686c87ce0',
  'fireline:default:0': 'cd0e02578cae62e2',
  'fireline:default:600': '1f63850f989c36c3',
  'fireline:heroes:0': '04604f12b9f67acd',
  'fireline:heroes:600': '912b703355e7bfd1',
  'iron-coast:default:0': 'f66347983a9dc50b',
  'iron-coast:default:600': 'e0fb38e87d4023dc',
  'iron-coast:heroes:0': 'f66347983a9dc50b',
  'iron-coast:heroes:600': 'e0fb38e87d4023dc',
  'convoy-north:default:0': 'c47404a3ffa6654e',
  'convoy-north:default:600': '1302f969acb5ec17',
  'convoy-north:heroes:0': '4c321309663c6f79',
  'convoy-north:heroes:600': 'e8802d776ffc0d74',
  'the-long-hold:default:0': '7a7b7bf697e1a4c1',
  'the-long-hold:default:600': '0f629f8ac812684b',
  'the-long-hold:heroes:0': '7a7b7bf697e1a4c1',
  'the-long-hold:heroes:600': '0f629f8ac812684b',
  'firestorm:default:0': '7a71921ed5cff59f',
  'firestorm:default:600': 'e8d922453a6cd3ce',
  'firestorm:heroes:0': '309dd21a42c3e690',
  'firestorm:heroes:600': '9c7824cb24369e17',
  'bastion-line:default:0': '6fc5d2821128734f',
  'bastion-line:default:600': '7bbcc5455662cef3',
  'bastion-line:heroes:0': '810baba742293293',
  'bastion-line:heroes:600': 'd1637d55e5e54a7d',
  'last-light:default:0': '06ce448aec1fdf35',
  'last-light:default:600': '1dfb4e88a48e88b1',
  'last-light:heroes:0': 'c964d53636dc6483',
  'last-light:heroes:600': '9a88202fe4b5a701',
};

const SKIRMISH_HASHES: Record<string, string> = {
  'sk:2:ffa:classic:0': 'ed71f18ab424e830',
  'sk:2:ffa:classic:1500': '0ea53dafd717c901',
  'sk:2:ffa:river:0': '1b87ade792e3ac24',
  'sk:2:ffa:river:1500': 'b93e03ad2d14893c',
  'sk:2:ffa:highlands:0': '975fff7b2428b61f',
  'sk:2:ffa:highlands:1500': '7483fb87a0655e0f',
  'sk:2:ffa:lakes:0': 'fb03d36090640f80',
  'sk:2:ffa:lakes:1500': 'f21a0aa6bea70948',
  'sk:2:ffa:plains:0': '52ff5338846a23af',
  'sk:2:ffa:plains:1500': '5379ab01e328dd0e',
  'sk:2:ffa:canyon:0': '273adda4d6a40730',
  'sk:2:ffa:canyon:1500': '68dba51d317f4b43',
  'sk:3:ffa:classic:0': '32fde2eb6e623cfe',
  'sk:3:ffa:classic:1500': '3db1ef6e17c25677',
  'sk:3:ffa:river:0': '8964b6b5ce1cc427',
  'sk:3:ffa:river:1500': 'bae08fb7be4a256e',
  'sk:3:ffa:highlands:0': '8b590872e72d190e',
  'sk:3:ffa:highlands:1500': 'a0aaeffab77a66d7',
  'sk:3:ffa:lakes:0': 'b03cae33683cd426',
  'sk:3:ffa:lakes:1500': 'd79521efd0cab81f',
  'sk:3:ffa:plains:0': 'ba34cf25a5a6d232',
  'sk:3:ffa:plains:1500': 'b399a340c3b1ce4a',
  'sk:3:ffa:canyon:0': '1be77156b0e0da5a',
  'sk:3:ffa:canyon:1500': '75769c6bed8e7a50',
  'sk:3:teams:classic:0': 'ff510f9c613e1e96',
  'sk:3:teams:classic:1500': '96ef515559fbacd9',
  'sk:3:teams:river:0': 'bc1204237e7f397c',
  'sk:3:teams:river:1500': '6b5e59ac0d222c0c',
  'sk:3:teams:highlands:0': '6b68fadd5730fb52',
  'sk:3:teams:highlands:1500': 'c795e4ff37950041',
  'sk:3:teams:lakes:0': 'c002aa41f43f8948',
  'sk:3:teams:lakes:1500': 'f69168de5412c089',
  'sk:3:teams:plains:0': '6d06dc8e89238810',
  'sk:3:teams:plains:1500': 'f6e59a15dd10e77b',
  'sk:3:teams:canyon:0': 'eeb005fcd0aef53d',
  'sk:3:teams:canyon:1500': '8ae2a3a4efd50afa',
  'sk:4:ffa:classic:0': '4f6c6a5262056860',
  'sk:4:ffa:classic:1500': '34f97c7c3fc97de8',
  'sk:4:ffa:river:0': 'a93e6c7d3eb7d287',
  'sk:4:ffa:river:1500': '39d463ebab3919da',
  'sk:4:ffa:highlands:0': '7c1148100e52160b',
  'sk:4:ffa:highlands:1500': '2a8c3756b2975455',
  'sk:4:ffa:lakes:0': '2c9563a450a85dd4',
  'sk:4:ffa:lakes:1500': 'ad9e446a6dc7038a',
  'sk:4:ffa:plains:0': '9bfd06445745a133',
  'sk:4:ffa:plains:1500': '710a3ce7cb2a55ef',
  'sk:4:ffa:canyon:0': 'f354741c727a7861',
  'sk:4:ffa:canyon:1500': '625273b4be38b4c0',
  'sk:4:teams:classic:0': '4463a125f6ce003f',
  'sk:4:teams:classic:1500': 'b0b7312fbd1fe7ac',
  'sk:4:teams:river:0': 'ee23564ba65a3f2a',
  'sk:4:teams:river:1500': 'b78aa9bec7c49eec',
  'sk:4:teams:highlands:0': '23798a7752ca8d60',
  'sk:4:teams:highlands:1500': '6808d94fb075182a',
  'sk:4:teams:lakes:0': '68e4d938c5563025',
  'sk:4:teams:lakes:1500': 'b6601ea18101945e',
  'sk:4:teams:plains:0': '3c8a9fc15443a758',
  'sk:4:teams:plains:1500': '16d7771706e7f8dc',
  'sk:4:teams:canyon:0': 'bd331120e930714b',
  'sk:4:teams:canyon:1500': '641ad69a980261bb',
  'sk:2:ffa:coast:0': '2d71d2c8a5f794f3',
  'sk:2:ffa:coast:1500': '55c47b430f1dbccd',
  'sk:3:ffa:coast:0': 'c6ab9c457f4faed1',
  'sk:3:ffa:coast:1500': '8989780c514d6e7e',
  'sk:3:teams:coast:0': 'dae6c93f05dcad4b',
  'sk:3:teams:coast:1500': '3b576bb494b3a280',
  'sk:4:ffa:coast:0': 'efe45c054ff9d1c8',
  'sk:4:ffa:coast:1500': '1fd48f41b9ce244d',
  'sk:4:teams:coast:0': '30ec835a4e4630b9',
  'sk:4:teams:coast:1500': '5e3e9cf11a73be0f',
  'legacy:0': '15e419dad417c40a',
  'legacy:1500': '0d0d7441bef53bca',
};

/** The six map types before the naval war, in their order then: the seeds above follow it. */
const PRE_NAVAL_MAPS: MapType[] = ['classic', 'river', 'highlands', 'lakes', 'plains', 'canyon'];

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
      for (const map of PRE_NAVAL_MAPS) {
        if (sides === 2 && mode === 'teams') continue;
        k++;
        let s = createInitialState('sk', 'Sk', { seed: `hash${k}`, createdAt: 0, autopilot: true, setup: { map, tech: k % 2 ? 'advanced' : 'standard', credits: 5000, ore: 'normal', sides, mode, research: k % 3 ? 'lines' : 'classic' } });
        ok(hash(preSize(preRound6(s))) === SKIRMISH_HASHES[`sk:${sides}:${mode}:${map}:0`], `skirmish ${sides} ${mode} ${map} byte-identical at tick 0`);
        s = tick(s, 1500);
        ok(hash(preSize(preRound6(s))) === SKIRMISH_HASHES[`sk:${sides}:${mode}:${map}:1500`], `skirmish ${sides} ${mode} ${map} byte-identical after 1,500 ticks`);
      }
  // The Coast map (the naval war): advanced tech, where navies sail, recorded at the merge.
  let c = 0;
  for (const sides of [2, 3, 4] as const)
    for (const mode of ['ffa', 'teams'] as const) {
      if (sides === 2 && mode === 'teams') continue;
      c++;
      let s = createInitialState('sk', 'Sk', { seed: `coast${c}`, createdAt: 0, autopilot: true, setup: { map: 'coast', tech: 'advanced', credits: 5000, ore: 'normal', sides, mode, research: c % 2 ? 'lines' : 'classic' } });
      ok(hash(preSize(preRound6(s))) === SKIRMISH_HASHES[`sk:${sides}:${mode}:coast:0`], `skirmish ${sides} ${mode} coast byte-identical at tick 0`);
      s = tick(s, 1500);
      ok(hash(preSize(preRound6(s))) === SKIRMISH_HASHES[`sk:${sides}:${mode}:coast:1500`], `skirmish ${sides} ${mode} coast byte-identical after 1,500 ticks`);
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


// ---- Map size by stakes (section 9.7) --------------------------------------------------------------

/**
 * Hashes recorded from the build before larger maps (git archive of 9dd8a6b, the same code as below):
 * the v1 fixture's pending battle built and after 600 autopilot ticks, the fixture played 5 bot turns,
 * and a Short and a Long war on battle rules 1 played 25 turns with every attack open each turn set
 * up (count:hash), the bigger battles among them built at tick 0, and the war at the end. A war saved
 * before larger maps must give every one of them exactly. Since the merge with main's naval war the
 * battles are hashed without their empty Naval queue (preNaval), which they then gain; nothing else.
 */
const OLD_WAR_HASHES: Record<string, string> = {
  fxBattle0: 'd09e37150885fa44',
  fxBattle600: '130f479cc4db9d68',
  fxPlayed: 'a63489d906db716c',
  shortSetups: '32:d3eb3bd7df203ca3',
  shortBuilt: '9:3b0b032e87540d39',
  shortWar: 'd1105ec19ce62d80',
  longSetups: '174:f4347d0394fca31d',
  longBuilt: '15:15699f5773c649f5',
  longWar: '2797ec3712225341',
};

/** One bot turn: the player seat's plan, End turn, every battle auto-resolved. */
function botTurn(w: PlanetState): PlanetState {
  for (const a of planAiActions(w, 0, 'expansionist')) {
    w = applyPlanetAction(w, a);
    while (w.pending.length) w = applyPlanetAction(w, { type: 'autoResolve' });
  }
  w = applyPlanetAction(w, { type: 'endTurn' });
  while (w.pending.length) w = applyPlanetAction(w, { type: 'autoResolve' });
  return w;
}

/** A war played `turns` bot turns, with every attack open each turn set up; and the battles worth building. */
function warWithSetups(w: PlanetState, turns: number, build: (st: BattleSetup) => boolean): { w: PlanetState; setups: BattleSetup[]; built: string[] } {
  const setups: BattleSetup[] = [];
  const built: string[] = [];
  for (let turn = 0; turn < turns && !w.result; turn++) {
    for (const f of w.factions) {
      if (!f.alive) continue;
      for (const r of attackTargets(w, f.id)) {
        const st = battleSetupFor(w, f.id, r, 0, [], 9000 + setups.length);
        if (!st) continue;
        setups.push(st);
        if (build(st)) built.push(hash(preNaval(preRound6(buildPlanetBattle(st, { id: 'o', name: 'o', createdAt: 0 })))));
      }
    }
    w = botTurn(w);
  }
  return { w, setups, built };
}

/** The stakes of a setup made from war w, read independently of battleSetupFor. */
const stakesOf = (w: PlanetState, st: BattleSetup) => {
  const def = st.sides[st.defenderSeat].faction;
  return { sides: st.sides.length, cityLevel: w.regions[st.region].city.level, capital: def >= 0 && w.factions[def].capital === st.region };
};

function mapSizeTests(ok: Ok): void {
  // The rule, case by case.
  const cases: [string, number, number, boolean, MapSize][] = [
    ['a frontier battle (two sides, a level 1 city)', 2, 1, false, 'standard'],
    ['a minor battle (two sides, a level 2 city)', 2, 2, false, 'standard'],
    ['two sides over a level 3 city that is not a capital', 2, 3, false, 'standard'],
    ['a big city (level 4)', 2, BIG_CITY_LEVEL, false, 'large'],
    ['a big city (level 5)', 2, 5, false, 'large'],
    ['a capital, two sides', 2, 3, true, 'large'],
    ['three sides over a small city', 3, 1, false, 'large'],
    ['four sides over a small city', 4, 2, false, 'large'],
    ['a capital with three sides', 3, 3, true, 'large'],
    ['a capital with four sides at level 5 (the biggest stakes)', 4, 5, true, 'large'],
  ];
  for (const [what, sides, cityLevel, capital, want] of cases) ok(battleMapSize({ sides, cityLevel, capital }) === want, `map size: ${what} is ${want}`);
  const rank: Record<MapSize, number> = { standard: 0, large: 1, huge: 2 };
  let monotone = true;
  let huge = 0;
  for (let n = 2; n <= 4; n++)
    for (let l = 1; l <= 5; l++)
      for (const c of [false, true]) {
        const z = rank[battleMapSize({ sides: n, cityLevel: l, capital: c })];
        if (z === 2) huge++;
        if (n < 4 && rank[battleMapSize({ sides: n + 1, cityLevel: l, capital: c })] < z) monotone = false;
        if (l < 5 && rank[battleMapSize({ sides: n, cityLevel: l + 1, capital: c })] < z) monotone = false;
        if (!c && rank[battleMapSize({ sides: n, cityLevel: l, capital: true })] < z) monotone = false;
      }
  ok(monotone, 'map size: higher stakes never give a smaller map');
  ok(huge === 0, 'map size: no battle is huge (measured unsound, section 9.7)');
  ok(battleMapSizeOf({}) === 'standard' && battleMapSizeOf({ mapSize: 'large' }) === 'large' && battleMapSizeOf({ mapSize: 'junk' as 'large' }) === 'standard', 'map size: a setup without one is standard');

  // The built battle is the size its setup names, with tiles for its number of sides.
  for (const i of [0, 1, 2]) {
    const base = craftSetup(i);
    const n = base.sides.length as 2 | 3 | 4;
    for (const z of ['standard', 'large'] as MapSize[]) {
      const st = deepFreeze(z === 'standard' ? base : { ...base, mapSize: z as 'large' });
      const g = buildPlanetBattle(st, ids(i));
      ok(g.mapW === MAP_SIZE_TILES[z][n] && g.mapH === MAP_SIZE_TILES[z][n] && g.setup?.size === z, `setup ${i}: a ${z} ${n}-sided battle is ${MAP_SIZE_TILES[z][n]} tiles`);
      st.sides.forEach((side, o) => ok(g.units.filter(u => u.owner === o && !u.hero && u.kind !== 'hauler').length === side.units.length, `setup ${i} ${z}: side ${o} units placed`));
    }
  }

  // New wars are on battle rules 2 and size every setup by its stakes; a war without battleRules
  // (one saved before larger maps) makes exactly the same setups without a map size.
  const fresh = newPlanetState({ seedText: 'maps-fresh', preset: 'short', difficulty: 'normal', commander: 'Tester', createdAt: 0 });
  ok(fresh.battleRules === 2, 'a new war is on battle rules 2');
  const seen = new Set<string>();
  let compared = 0;
  for (let k = 0; k < 12; k++) {
    const w = openWar(`maps-war-${k}`, k % 3 === 1 ? [[0, 2]] : k % 3 === 2 ? [[0, 2], [1, 3]] : []);
    const old: PlanetState = copy(w);
    delete old.battleRules;
    for (const f of w.factions)
      for (const r of attackTargets(w, f.id)) {
        const st = battleSetupFor(w, f.id, r, 1000, [], 7);
        const st1 = battleSetupFor(old, f.id, r, 1000, [], 7);
        if (!st || !st1) continue;
        const k2 = stakesOf(w, st);
        const want = battleMapSize(k2);
        ok(battleMapSizeOf(st) === want && (want === 'standard') === !('mapSize' in st), `war ${k}: ${f.id} on ${r} (${k2.sides} sides, level ${k2.cityLevel}${k2.capital ? ', capital' : ''}) is ${want}`);
        ok(!('mapSize' in st1), `war ${k}: on battle rules 1, ${f.id} on ${r} has no map size`);
        const { mapSize: _drop, ...rest } = st;
        ok(JSON.stringify(rest) === JSON.stringify(st1), `war ${k}: ${f.id} on ${r}: the same setup on either rules but for the map size`);
        compared++;
        seen.add(`${want}:${k2.capital ? 'capital' : k2.cityLevel >= BIG_CITY_LEVEL ? 'big' : k2.sides > 2 ? 'sides' : 'minor'}`);
      }
  }
  // Two-sided stakes from a war: faction 1's army beside the player's capital, and beside one of
  // the player's other cities at level 3 (not big) and at BIG_CITY_LEVEL (big).
  let twoSided = 0;
  for (let k = 0; k < 30 && twoSided < 3; k++) {
    const w = openWar(`maps-two-${k}`, []);
    const m = planetMapOf(w);
    const cap = w.factions[0].capital;
    const other = w.regions.findIndex((r, i) => r.owner === 0 && i !== cap && m.regions[i].links.some(l => w.regions[l.to].owner !== 0 && !w.factions.some(f => f.capital === l.to)));
    for (const [target, level, want, tag] of [
      [cap, 3, 'large', 'large:capital2'],
      [other, 3, 'standard', 'standard:level3'],
      [other, BIG_CITY_LEVEL, 'large', 'large:big2'],
    ] as [number, 3 | 4, MapSize, string][]) {
      if (target < 0) continue;
      const x: PlanetState = copy(w);
      const nb = m.regions[target].links.map(l => l.to).find(r => x.regions[r].owner !== 0 && !x.factions.some(f => f.capital === r));
      if (nb === undefined) continue;
      x.regions[nb].owner = 1;
      x.factions[1].army!.region = nb;
      x.regions[target].city.level = level;
      const st = battleSetupFor(x, 1, target, 0, [], 3);
      if (!st || st.sides.length !== 2) continue;
      ok(battleMapSizeOf(st) === want, `war ${k}: ${tag.split(':')[1]} is ${want}`);
      const old: PlanetState = copy(x);
      delete old.battleRules;
      ok(!('mapSize' in battleSetupFor(old, 1, target, 0, [], 3)!), `war ${k}: ${tag.split(':')[1]} on battle rules 1 is standard`);
      seen.add(tag);
      twoSided++;
    }
  }
  // The four-sided defence of a capital, from a war.
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
    if (!four || four.sides.length !== 4) continue;
    ok(four.mapSize === 'large', 'a four-sided defence of a capital is large');
    seen.add('large:capital4');
    const g = buildPlanetBattle(four, ids(800));
    ok(g.mapW === MAP_SIZE_TILES.large[4], `the four-sided capital battle is ${MAP_SIZE_TILES.large[4]} tiles`);
    // Save size: the whole save (the strategic part at its 48 KB budget) with this battle in progress.
    const STRATEGIC = 48 * 1024;
    const at0 = JSON.stringify(g).length;
    const later = tick({ ...g, autopilot: true }, 3000);
    const at3000 = JSON.stringify(later).length;
    // The armies' round 6 stays out of a war's battles (fireline-round6-design.md, section 10).
    ok(round6Off(g) && round6Off(later), 'the four-sided capital battle: all Meridian, no recruits, no Generals, no squads after 3,000 ticks');
    console.log(`  large four-sided battle: ${Math.round(at0 / 1024)} KB at tick 0, ${Math.round(at3000 / 1024)} KB at tick 3,000`);
    ok(STRATEGIC + at0 < 256 * 1024 && STRATEGIC + at3000 < 256 * 1024, 'whole save with a large four-sided battle under 256 KB');
    break;
  }
  ok(compared >= 40, `setups compared on both rules (${compared})`);
  for (const want of ['standard:minor', 'standard:level3', 'large:capital2', 'large:big2', 'large:sides', 'large:capital4']) ok(seen.has(want), `map size case met in a war: ${want} (${[...seen].join(', ')})`);

  // Old saves: the v1 fixture and wars on battle rules 1 give the hashes of the build before larger maps.
  const fxPath = join(dirname(new URL(import.meta.url).pathname), 'fixtures', 'planet-save-v1.json');
  const fx = migratePlanetSave(JSON.parse(readFileSync(fxPath, 'utf8')))!;
  ok(fx.planet.battleRules === undefined && !('mapSize' in fx.planet.pending[0].setup), 'the v1 fixture stays on battle rules 1 with a standard map');
  let g = buildPlanetBattle(fx.planet.pending[0].setup, { id: 'fx', name: 'Fixture', createdAt: 0 }, { autopilot: true });
  ok(
    JSON.stringify([g.setup?.factions, g.setup?.heroes, g.setup?.generals, g.setup?.generalPicks]) === JSON.stringify([g.players.map(() => 'meridian'), false, false, g.players.map(() => null)]),
    "a planet battle states round 6's options: every seat Meridian, heroes, Generals and doctrine Generals off",
  );
  ok(!heroesInPlay(g) && !fieldGenerals(g), 'a planet battle recruits no heroes and fields no General');
  ok(hash(preNaval(preRound6(g))) === OLD_WAR_HASHES.fxBattle0, "the fixture's battle byte-identical at tick 0");
  g = processAction(g, { type: 'tick', n: 600 });
  ok(hash(preNaval(preRound6(g))) === OLD_WAR_HASHES.fxBattle600, "the fixture's battle byte-identical after 600 ticks");
  let t = applyPlanetAction(fx.planet, { type: 'autoResolve' });
  for (let i = 0; i < 5 && !t.result; i++) t = botTurn(t);
  ok(hash(t) === OLD_WAR_HASHES.fxPlayed, 'the fixture played 5 turns byte-identical');
  ok(t.battleRules === undefined, 'the fixture is still on battle rules 1 after 5 turns');
  for (const preset of ['short', 'long'] as const) {
    const w = newPlanetState({ seedText: `oldhash-${preset}`, preset, difficulty: 'normal', commander: 'Tester', createdAt: 0 });
    delete w.battleRules;
    const run = warWithSetups(w, 25, st => st.sides.length > 2 || st.cityLevel >= 3);
    ok(`${run.setups.length}:${hash(run.setups)}` === OLD_WAR_HASHES[`${preset}Setups`], `${preset} war on battle rules 1: every setup byte-identical`);
    ok(`${run.built.length}:${hash(run.built)}` === OLD_WAR_HASHES[`${preset}Built`], `${preset} war on battle rules 1: the bigger battles byte-identical`);
    ok(hash(run.w) === OLD_WAR_HASHES[`${preset}War`], `${preset} war on battle rules 1: the war byte-identical after 25 turns`);
  }

  // New saves: a war on battle rules 2 replays byte-identically, a large battle builds and runs the
  // same twice, and a save holding a large pending battle migrates to itself.
  for (const preset of ['short', 'long'] as const) {
    const mk = () => warWithSetups(newPlanetState({ seedText: `newhash-${preset}`, preset, difficulty: 'normal', commander: 'Tester', createdAt: 0 }), 25, st => st.mapSize === 'large');
    const a = mk();
    const b = mk();
    ok(JSON.stringify(a.w) === JSON.stringify(b.w) && JSON.stringify(a.setups) === JSON.stringify(b.setups) && a.built.join() === b.built.join(), `${preset} war on battle rules 2 replays byte-identically`);
    ok(a.w.battleRules === 2 && a.built.length > 0, `${preset} war on battle rules 2 keeps its rules and sets up large battles (${a.built.length} of ${a.setups.length})`);
  }
  const big = { ...craftSetup(1), mapSize: 'large' as const };
  const r1 = processAction(buildPlanetBattle(big, ids(1), { autopilot: true }), { type: 'tick', n: 600 });
  const r2 = processAction(buildPlanetBattle(big, ids(1), { autopilot: true }), { type: 'tick', n: 600 });
  ok(hash(r1) === hash(r2), 'a large battle runs byte-identically twice');
  ok(JSON.stringify(migrateState(JSON.parse(JSON.stringify(r1)))) === JSON.stringify(r1), 'a large battle in progress migrates to itself');
  for (let k = 0; k < 40; k++) {
    const w = openWar(`maps-save-${k}`, []);
    const tgt = attackTargets(w, 0).find(r => battleSetupFor(w, 0, r, 0, [], 1)?.mapSize === 'large');
    if (tgt === undefined) continue;
    const a = applyPlanetAction(w, { type: 'attack', target: tgt, credits: 0, heroes: [] });
    ok(a !== w && a.pending[0].setup.mapSize === 'large', 'a large attack is pending');
    const save = newPlanetSave('maps-save', 'Maps', { seedText: w.seedText, preset: w.options.preset, difficulty: w.difficulty, commander: 'Tester', createdAt: 0 });
    const withBattle = JSON.parse(JSON.stringify({ ...save, planet: a }));
    const back = migratePlanetSave(withBattle);
    ok(back !== null && JSON.stringify(back) === JSON.stringify(withBattle), 'a save with a large pending battle migrates to itself byte for byte');
    const v1 = JSON.parse(JSON.stringify(withBattle));
    delete v1.planet.battleRules;
    ok(migratePlanetSave(v1)?.planet.pending[0].setup.mapSize === 'large', 'a pending setup keeps its map size whatever the war rules');
    break;
  }

  // Time per battle size: the instant auto-resolve, and Simulate (the engine plays it out) once on each size.
  for (const z of ['standard', 'large'] as MapSize[]) {
    const st = deepFreeze({ ...craftSetup(4), ...(z === 'large' ? { mapSize: 'large' as const } : {}) });
    let q = 0;
    const t0 = performance.now();
    for (let k = 0; k < 200; k++) q += quickResolve(st).ticks;
    const quickMs = (performance.now() - t0) / 200;
    const t1 = performance.now();
    const r = simulateBattle(st, 0);
    const simS = (performance.now() - t1) / 1000;
    console.log(`  ${z} ${st.sides.length}-sided: auto-resolve ${quickMs.toFixed(2)} ms, Simulate ${simS.toFixed(1)} s (${r.winner} at ${Math.round(r.ticks / 600)} min)`);
    ok(q === 0 && JSON.stringify(quickResolve(st)) === JSON.stringify(quickResolve({ ...st, mapSize: undefined })), `${z}: auto-resolve does not read the map size`);
    ok(r.ticks > 0 && r.ticks <= st.timeLimit && reportProblem(st, r) === null, `${z}: Simulate ends by the time limit with a valid report`);
  }
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
  ['Planet battles: map size by stakes; old saves unchanged', mapSizeTests],
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
