// Planet battles in the engine (fireline-planet-design.md, sections 9.5 and 14.6). W2.
//
// A planet battle is a skirmish (createInitialState, which already does 2 to 4 sides, teams,
// starts and map types) with the planet's forces laid over it: each side's structures, units,
// heroes, research, doctrines and loadouts, plus `s.planet` for the Command Yard and time-limit
// victory rule. Story missions and MissionSpec are not involved at all.
//
// Pure: no unseeded dice, no clock. The same setup and ids always give the same GameState.

import { processAction } from '../sim/actions';
import { fitModules } from '../sim/loadout';
import { focusFor, placeHeroes, placeNear, placeUnits, startCentre, toward } from '../sim/mission';
import { upgradeNewUnit } from '../sim/research';
import { BUILDINGS, MODULES, MODULE_SLOTS, POWERS, UNITS, vetFor, type ModuleId, type Owner, type SupportPower, type UnitKind } from '../sim/rules';
import { teamOf } from '../sim/sides';
import { createInitialState, syncSkirmishPowers, updateExplored } from '../sim/state';
import type { GameState } from '../sim/types';
import { ARMY_KINDS, type ArmyKind, type BattleReport, type BattleSetup, type BattleUnit, type CityBuildingId } from './types';

/** Most survivors a report carries per side (section 4). */
export const REPORT_SURVIVORS_MAX = 60;
/** Kills are reported as integers 0..999 (section 9.6). */
const KILLS_MAX = 999;
/** How far in front of its Command Yard a side's troops muster, in tiles. */
const MUSTER_DISTANCE = 4;

const isArmyKind = (k: string): k is ArmyKind => (ARMY_KINDS as string[]).includes(k);

/** The modules of a loadout that exist, fit this kind and fit its slots, in order. */
function cleanLoadout(kind: UnitKind, mods: ModuleId[] | undefined): ModuleId[] {
  if (!mods || UNITS[kind].category !== 'vehicle') return [];
  const slots = MODULE_SLOTS[kind] ?? 0;
  const out: ModuleId[] = [];
  for (const m of mods) {
    if (out.length >= slots) break;
    if (m in MODULES && MODULES[m].fits.includes(kind) && !out.includes(m)) out.push(m);
  }
  return out;
}

/**
 * The battle a setup describes, ready to play. `autopilot` (the computer also plays side 0) is set
 * when no side is human or when asked for (Simulate, the harness).
 */
export function buildPlanetBattle(setup: BattleSetup, ids: { id: string; name: string; createdAt: number }, opts?: { autopilot?: boolean }): GameState {
  const n = setup.sides.length;
  const human = setup.sides.some(x => x.human);
  const s = createInitialState(ids.id, ids.name, {
    seed: setup.seedText,
    difficulty: setup.difficulty,
    createdAt: ids.createdAt,
    autopilot: !human || !!opts?.autopilot,
    setup: { map: setup.mapType, tech: 'advanced', credits: 3000, ore: setup.ore, sides: n as 2 | 3 | 4, mode: n > 2 ? 'teams' : 'ffa', research: 'lines', pace: 'quick', size: 'standard', sites: false },
    teams: setup.sides.map(x => x.team),
  });
  // Only the three riflemen per side stand at the start: every unit goes; the Command Yards stay.
  s.units = [];
  // Perks first, so side 0's Armour perk reaches every unit placed below (addUnit reads it).
  const humanFirst = setup.sides[0]?.human === true;
  if (humanFirst && setup.perks) s.perks = { ...setup.perks };
  const perkPowers: SupportPower[] = humanFirst ? setup.powers.filter((p, i, all) => p in POWERS && all.indexOf(p) === i) : [];

  const centre = { x: s.mapW / 2, y: s.mapH / 2 };
  const city: [number, string][] = [];
  setup.sides.forEach((side, i) => {
    const owner = i as Owner;
    const p = s.players[owner];
    p.credits = Math.max(0, Math.round(side.credits + (owner === 0 && s.perks ? s.perks.extraStartCredits : 0)));
    p.upgrades = side.upgrades.slice();
    // Doctrines only when one is chosen: the shape migrateState gives a lines battle's player.
    if (Object.keys(side.doctrines).length) p.doctrines = { ...side.doctrines };
    const loadouts: Partial<Record<UnitKind, ModuleId[]>> = {};
    for (const [kind, mods] of Object.entries(side.loadouts) as [UnitKind, ModuleId[]][]) {
      if (!(kind in UNITS)) continue;
      const clean = cleanLoadout(kind, mods);
      if (clean.length) loadouts[kind] = clean;
    }
    p.loadouts = loadouts;

    const home = startCentre(s, owner);
    // Structures after the Command Yard (structures[0] is always 'hq'), each as near its spot as
    // the ground allows; a Refinery brings its hauler (placeNear).
    side.structures.forEach((kind, k) => {
      if (k === 0 && kind === 'hq') return;
      if (!(kind in BUILDINGS) || kind === 'hq') return;
      const b = placeNear(s, owner, kind, focusFor(s, kind, home, centre));
      const tag = side.cityTags[k];
      if (b && tag) city.push([b.id, tag]);
    });

    // Units on the muster point, one at a time so each placed unit is matched to its setup entry.
    const muster = toward(home, centre, MUSTER_DISTANCE);
    for (const bu of side.units) {
      if (!isArmyKind(bu.kind)) continue;
      const [u] = placeUnits(s, owner, [bu.kind], muster.x, muster.y);
      if (!u) continue;
      const kills = Number.isInteger(bu.kills) && bu.kills > 0 ? Math.min(KILLS_MAX, bu.kills) : 0;
      u.kills = kills;
      u.vet = vetFor(kills);
      if (bu.core !== null && Number.isInteger(bu.core) && bu.core >= 0) u.core = bu.core;
      upgradeNewUnit(s, u);
      if (UNITS[u.kind].category === 'vehicle') fitModules(u, loadouts[u.kind]);
    }
    placeHeroes(s, owner, side.heroes.map(h => ({ kind: h.kind, xp: h.xp, wounded: h.wounded })), muster.x, muster.y);
  });

  if (perkPowers.length) {
    const powers: NonNullable<GameState['powers']> = s.powers ?? s.players.map(() => ({}));
    powers[0] = { ...powers[0] };
    for (const pw of perkPowers) powers[0][pw] = 0;
    s.powers = powers;
  }
  s.planet = {
    battleId: setup.battleId,
    timeLimit: setup.timeLimit,
    defenderSeat: setup.defenderSeat as Owner,
    ai: setup.sides.map(x => x.ai),
    city,
    ...(perkPowers.length ? { perkPowers } : {}),
  };
  syncSkirmishPowers(s);
  updateExplored(s);
  return s;
}

/**
 * Survivors of one seat: infantry and vehicles of ARMY_KINDS alive now, core units first, at most 60.
 * Infantry aboard a living Troop Carrier (the air war) are off the map but alive, so they count.
 */
function survivorsOf(s: GameState, seat: number): BattleUnit[] {
  const living = s.units.flatMap(u => (u.hp > 0 && u.carried ? [u, ...u.carried] : [u]));
  const mine = living.filter(u => u.owner === seat && u.hp > 0 && isArmyKind(u.kind) && !u.hero);
  const core = mine.filter(u => u.core !== undefined).sort((a, b) => a.core! - b.core! || a.id - b.id);
  const rest = mine.filter(u => u.core === undefined);
  const out: BattleUnit[] = [];
  const seen = new Set<number>();
  for (const u of [...core, ...rest]) {
    if (out.length >= REPORT_SURVIVORS_MAX) break;
    const slot = u.core !== undefined && !seen.has(u.core) ? u.core : null;
    if (slot !== null) seen.add(slot);
    out.push({ kind: u.kind as ArmyKind, kills: Math.max(0, Math.min(KILLS_MAX, Math.floor(u.kills))), core: slot });
  }
  return out;
}

/**
 * The report of a fought battle, or null while it is still running. With `retreat` (the player
 * leaves a battle still running) the player's team is reported beaten with the survivors present
 * now. City damage per building: of the S structures placed for it, D are gone (destroyed or sold;
 * one captured and still standing is intact), so it loses L - floor(L * (S - D) / S) levels.
 */
export function planetBattleReport(setup: BattleSetup, s: GameState, opts?: { retreat?: boolean }): BattleReport | null {
  const running = s.winner === null;
  const retreat = running && !!opts?.retreat;
  if (running && !retreat) return null;
  const defenderTeam = setup.sides[setup.defenderSeat]?.team ?? 1;
  let winner: 'attacker' | 'defender';
  if (retreat) {
    // The leaver is the human side (seat 0), or seat 0 when nobody is human.
    winner = (setup.sides[0]?.team ?? 0) === defenderTeam ? 'attacker' : 'defender';
  } else {
    winner = teamOf(s, s.winner!) === teamOf(s, setup.defenderSeat as Owner) ? 'defender' : 'attacker';
  }
  const fallen = s.planet?.fallen ?? {};
  const sides = setup.sides.map((side, i) => ({
    faction: side.faction,
    survivors: survivorsOf(s, i),
    heroes: side.heroes.map(h => {
      const u = s.units.find(v => v.owner === i && v.kind === h.kind && v.hero && v.hp > 0);
      if (u && u.hero) return { kind: h.kind, xp: Math.max(h.xp, u.hero.xp), alive: true };
      const fell = i === 0 ? fallen[h.kind] : undefined;
      return { kind: h.kind, xp: Math.max(h.xp, fell ?? h.xp), alive: false };
    }),
  }));
  const cityDamage: Partial<Record<CityBuildingId, number>> = {};
  const standing = new Set(s.buildings.filter(b => b.hp > 0).map(b => b.id));
  const placed = new Map<string, { S: number; D: number }>();
  for (const [id, tag] of s.planet?.city ?? []) {
    const e = placed.get(tag) ?? { S: 0, D: 0 };
    e.S++;
    if (!standing.has(id)) e.D++;
    placed.set(tag, e);
  }
  for (const [tag, L] of Object.entries(setup.cityBuildings) as [CityBuildingId, number][]) {
    const e = placed.get(tag);
    if (!e || !e.S || !L) continue;
    const lost = L - Math.floor((L * (e.S - e.D)) / e.S);
    if (lost > 0) cityDamage[tag] = lost;
  }
  return {
    battleId: setup.battleId,
    winner,
    how: retreat ? 'retreat' : 'fought',
    ticks: s.tick,
    sides,
    cityDamage,
    cityLevelLost: winner === 'attacker' ? 1 : 0,
  };
}

/** Ticks per step while simulating: the engine's own most per action. */
const SIM_STEP = 600;

/**
 * The battle played out by the computer on every side (Simulate), to its end. The time limit
 * guarantees an end; a hard stop at twice the limit (plus a margin) guards a malformed setup.
 */
export function simulateBattle(setup: BattleSetup, createdAt: number): BattleReport {
  let s = buildPlanetBattle(setup, { id: `planet-${setup.battleId}`, name: setup.regionName, createdAt }, { autopilot: true });
  const stop = Math.max(SIM_STEP, setup.timeLimit) * 2 + SIM_STEP;
  while (s.winner === null && s.tick < stop) s = processAction(s, { type: 'tick', n: SIM_STEP });
  const report = planetBattleReport(setup, s) ?? planetBattleReport(setup, s, { retreat: true })!;
  return { ...report, how: 'simulated' };
}
