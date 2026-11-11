/**
 * Two armies (fireline-round6-design.md, workstream A), and the round 6 groundwork every workstream
 * stands on: setups with the new fields, the per-side spec lookup, and saves from before round 6.
 * Its sections run inside scripts/drive.ts and count in its totals.
 *
 * The groundwork sections below state rules that hold for the whole round (Meridian is today's army
 * exactly; an army changes numbers, never a kind's identity; old saves and missions play as before).
 * Workstream A adds its own sections after them and keeps these.
 */
import { processAction } from '../src/sim/actions';
import { missionContext, newCampaign } from '../src/campaign/progression';
import { MISSIONS } from '../src/campaign/missions';
import { createMissionState } from '../src/sim/mission';
import {
  BUILDINGS,
  DEFAULT_SETUP,
  FACTIONS,
  FACTION_NAMES,
  LEGACY_SETUP,
  MENUS,
  UNITS,
  type BuildingKind,
  type Category,
  type SkirmishSetup,
  type UnitKind,
} from '../src/sim/rules';
import { buildingSpecFor, factionAllows, factionOf, menuOf, unitSpecFor } from '../src/sim/specs';
import { addUnit, costFor, costOf, buildTicksFor, buildTicksOf, createInitialState, migrateState, normaliseSetup } from '../src/sim/state';
import type { GameState } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
/** Plays n ticks, in actions of at most 600 (MAX_TICKS_PER_ACTION). */
function run(s: GameState, n: number): GameState {
  while (n > 0 && s.winner === null) {
    const k = Math.min(600, n);
    s = processAction(s, { type: 'tick', n: k });
    n -= k;
  }
  return s;
}
/** What a battle is, for comparing two runs: everything that plays, nothing that only describes. */
const played = (s: GameState): string =>
  JSON.stringify({ tick: s.tick, rng: s.rngSeed, winner: s.winner, units: s.units, buildings: s.buildings, ore: s.ore, credits: s.players.map(p => [p.credits, p.stats]) });

const CATEGORIES: Category[] = ['building', 'infantry', 'vehicle', 'air'];
const ROUND6_SETUP_KEYS = ['factions', 'heroes', 'generals', 'generalPicks'] as const;

/** A save as a build before round 6 wrote it: no army on any player, none of the setup's new fields. */
function preRound6(s: GameState): GameState {
  const old = copy(s);
  for (const p of old.players) delete p.faction;
  if (old.setup) for (const k of ROUND6_SETUP_KEYS) delete (old.setup as Partial<SkirmishSetup>)[k];
  delete old.sidePerks;
  delete old.squads;
  return old;
}

function setups(ok: Ok): void {
  for (const [name, base] of [['DEFAULT_SETUP', DEFAULT_SETUP], ['LEGACY_SETUP', LEGACY_SETUP]] as const) {
    ok(JSON.stringify(base.factions) === '["meridian","meridian"]', `${name} states every seat's army: Meridian`);
    ok(base.heroes === false && base.generals === false, `${name} states heroes and Generals: off`);
    ok(JSON.stringify(base.generalPicks) === '[null,null]', `${name} states every seat's doctrine General: none`);
  }
  ok(JSON.stringify(normaliseSetup({})) === JSON.stringify(DEFAULT_SETUP), 'an empty setup is still exactly the default');
  const n4 = normaliseSetup({ sides: 4 });
  ok(n4.factions!.length === 4 && n4.factions!.every(f => f === 'meridian'), 'four sides: four armies, all Meridian by default');
  ok(n4.generalPicks!.length === 4 && n4.generalPicks!.every(g => g === null), 'four sides: four doctrine picks, all none by default');
  ok(normaliseSetup({ sides: 3, factions: ['ashen', 'meridian', 'ashen', 'ashen'] }).factions!.join() === 'ashen,meridian,ashen', 'one army per seat: extra entries dropped');
  for (const junk of ['moon', 3, null, {}, 'Meridian', '']) {
    const r = normaliseSetup({ factions: [junk as never, 'ashen'] });
    ok(r.factions![0] === 'meridian' && r.factions![1] === 'ashen', `army ${JSON.stringify(junk)} falls back to Meridian`);
    const b = normaliseSetup({ factions: [junk as never, junk as never] }, { ...DEFAULT_SETUP, factions: ['ashen', 'ashen'] });
    ok(b.factions!.join() === 'ashen,ashen', `army ${JSON.stringify(junk)} falls back to the base's`);
  }
  ok(normaliseSetup({ factions: 'ashen' as never }).factions!.join() === 'meridian,meridian', 'armies that are not a list fall back');
  for (const key of ['heroes', 'generals'] as const) {
    ok(normaliseSetup({ [key]: true })[key] === true, `${key}: on when exactly true`);
    ok(normaliseSetup({ [key]: false }, { ...DEFAULT_SETUP, [key]: true })[key] === false, `${key}: off when exactly false`);
    for (const junk of ['yes', 1, null, 'true', {}]) {
      ok(normaliseSetup({ [key]: junk as never })[key] === false, `${key} ${JSON.stringify(junk)} falls back to off`);
      ok(normaliseSetup({ [key]: junk as never }, { ...DEFAULT_SETUP, [key]: true })[key] === true, `${key} ${JSON.stringify(junk)} falls back to the base's`);
    }
  }
  // Doctrine Generals: one per seat, from its own army only.
  const g = normaliseSetup({ sides: 4, factions: ['meridian', 'ashen', 'meridian', 'ashen'], generalPicks: ['hale', 'kade', 'kade', null] });
  ok(g.generalPicks!.join() === 'hale,kade,,', "a General from the seat's own army is kept; another army's reads as none");
  ok(normaliseSetup({ generalPicks: ['bogus' as never, 7 as never] }).generalPicks!.join() === ',', 'unknown Generals read as none');
  ok(
    normaliseSetup({ generalPicks: ['bogus' as never, null] }, { ...DEFAULT_SETUP, generalPicks: ['voss', 'hale'] }).generalPicks!.join() === 'voss,',
    "an unknown General falls back to the base's; an explicit none stays none",
  );
  // A setup saved before round 6, run through the server's normaliser and migrateState's.
  const old: Partial<SkirmishSetup> = { map: 'lakes', tech: 'advanced', credits: 5000, ore: 'rich', sides: 3, mode: 'teams', size: 'large', sites: true };
  for (const base of [DEFAULT_SETUP, LEGACY_SETUP]) {
    const r = normaliseSetup(old, base);
    ok(r.factions!.join() === 'meridian,meridian,meridian' && !r.heroes && !r.generals && r.generalPicks!.every(x => x === null), 'a pre-round-6 setup reads as Meridian, no heroes, no Generals');
    ok(r.map === 'lakes' && r.size === 'large' && r.sites === true && r.mode === 'teams', 'and keeps everything it had');
  }
}

function specs(ok: Ok): void {
  ok(FACTIONS.length === 2 && FACTIONS.every(f => typeof FACTION_NAMES[f] === 'string'), 'two armies, each named');
  const unitKinds = Object.keys(UNITS) as UnitKind[];
  const buildingKinds = Object.keys(BUILDINGS) as BuildingKind[];
  // Meridian is the catalogue exactly: the very same objects.
  ok(unitKinds.every(k => unitSpecFor('meridian', k) === UNITS[k]), 'Meridian: every unit spec is the catalogue\'s own');
  ok(buildingKinds.every(k => buildingSpecFor('meridian', k) === BUILDINGS[k]), 'Meridian: every structure spec is the catalogue\'s own');
  ok(CATEGORIES.every(c => JSON.stringify(menuOf('meridian', c)) === JSON.stringify(MENUS[c])), 'Meridian: every build list is MENUS');
  for (const c of CATEGORIES) ok(MENUS[c].every(k => factionAllows('meridian', k)), `Meridian fields everything on ${c}`);
  // An army changes numbers, never a kind's identity.
  for (const f of FACTIONS) {
    for (const k of unitKinds) {
      const a = unitSpecFor(f, k);
      const b = UNITS[k];
      ok(
        a.category === b.category && a.hero === b.hero && a.medic === b.medic && a.mender === b.mender && a.deploysTo === b.deploysTo && a.stealth === b.stealth && a.airRole === b.airRole,
        `${f} ${k}: the same kind of unit as the catalogue's`,
      );
      ok(unitSpecFor(f, k) === a, `${f} ${k}: one spec object, every time`);
    }
    for (const k of buildingKinds) {
      const a = buildingSpecFor(f, k);
      const b = BUILDINGS[k];
      ok(a.w === b.w && a.h === b.h && a.wall === b.wall && a.undeploysTo === b.undeploysTo, `${f} ${k}: the same footprint and kind of structure`);
    }
  }
  // Aircraft fight by role, never by name.
  ok(UNITS.gunship.airRole === 'strafe' && UNITS.bomber.airRole === 'bomb', 'the Gunship strafes, the Bomber bombs');
  ok(unitKinds.every(k => (UNITS[k].category === 'air') === (UNITS[k].airRole !== undefined)), 'every aircraft has an air role, and nothing else does');
  // A side's army reaches its specs.
  const s = createInitialState('f', 'f', { seed: 'factions', createdAt: 0, setup: { tech: 'advanced', sides: 3, factions: ['meridian', 'ashen', 'meridian'] } });
  ok(s.players.map(p => p.faction).join() === 'meridian,ashen,meridian', 'a skirmish records each side\'s army from its setup');
  ok(factionOf(s, 1) === 'ashen' && factionOf(s, 0) === 'meridian', 'factionOf reads the player');
  const legacy = createInitialState('l', 'l', { seed: 'legacy', createdAt: 0 });
  ok(legacy.players.every(p => p.faction === undefined) && factionOf(legacy, 1) === 'meridian', 'a battle with no setup has no army recorded: Meridian');
  // Prices, build times and health through the per-side lookup read today's numbers for Meridian.
  for (const k of [...unitKinds, ...buildingKinds]) {
    ok(costFor(s, 0, k) === costOf(k) && buildTicksFor(s, 0, k) === buildTicksOf(k), `${k}: Meridian's price and build time are the catalogue's`);
  }
  const u = addUnit(copy(s), 0, 'tank', 10.5, 10.5);
  ok(u.hp === UNITS.tank.hp && u.maxHp === undefined, 'a Meridian tank: catalogue health, no maxHp stored');
}

function saves(ok: Ok): void {
  const setups: Partial<SkirmishSetup>[] = [
    { map: 'classic', tech: 'standard' },
    { map: 'river', tech: 'advanced' },
    { map: 'lakes', tech: 'advanced', sides: 3, mode: 'teams', sites: true },
    { map: 'plains', tech: 'advanced', sides: 4, factions: ['ashen', 'meridian', 'ashen', 'meridian'], generals: true, heroes: true },
  ];
  for (const setup of setups) {
    const label = `${setup.sides ?? 2} sides, ${setup.map}, ${setup.tech}`;
    const s = createInitialState(`r6-${label}`, label, { seed: `r6-${label}`, createdAt: 0, autopilot: true, setup });
    ok(JSON.stringify(migrateState(copy(s))) === JSON.stringify(s), `${label}: a fresh state passes migrateState unchanged`);
    const later = run(s, 1200);
    ok(JSON.stringify(migrateState(copy(later))) === JSON.stringify(later), `${label}: two minutes in, unchanged by migrateState`);
  }
  // A save from before round 6 loads, reads Meridian, and plays exactly as the same battle saved now.
  for (const [i, setup] of ([{ map: 'canyon', tech: 'advanced' }, { map: 'highlands', tech: 'advanced', sides: 4, mode: 'teams' }, undefined] as (Partial<SkirmishSetup> | undefined)[]).entries()) {
    const now = run(createInitialState(`old-${i}`, 'old', { seed: `old-save-${i}`, createdAt: 0, autopilot: true, setup }), 600);
    const old = migrateState(preRound6(now));
    ok(!!old, `old save ${i}: loads`);
    if (!old) continue;
    ok(old.players.every(p => p.faction === undefined) && old.players.every((_, o) => factionOf(old, o as 0) === 'meridian'), `old save ${i}: every side reads Meridian`);
    ok(old.sidePerks === undefined && old.squads === undefined, `old save ${i}: no side perks, no squads`);
    if (old.setup) ok(old.setup.factions!.every(f => f === 'meridian') && old.setup.heroes === false && old.setup.generals === false, `old save ${i}: its setup reads Meridian, no heroes, no Generals`);
    ok(played(run(old, 3000)) === played(run(now, 3000)), `old save ${i}: plays byte-identically to the same battle saved now`);
  }
  // Junk on a player is dropped, never trusted.
  const s = createInitialState('j', 'j', { seed: 'junk', createdAt: 0, setup: { tech: 'advanced', factions: ['ashen', 'meridian'] } });
  const junk = copy(s);
  (junk.players[0] as { faction?: unknown }).faction = 'moon';
  const m = migrateState(junk)!;
  ok(m.players[0].faction === undefined && factionOf(m, 0) === 'meridian', 'an unknown army on a player is dropped: Meridian');
  ok(m.players[1].faction === 'meridian' && migrateState(copy(s))!.players[0].faction === 'ashen', 'a known army is kept');
  // Missions: nothing of round 6 appears.
  const c = newCampaign('T');
  for (const spec of MISSIONS) {
    const ms = createMissionState(spec, missionContext(c, spec, `r6-${spec.id}`, 0));
    ok(ms.players.every(p => p.faction === undefined) && ms.sidePerks === undefined && ms.squads === undefined, `${spec.id}: no army, side perks or squads in a mission`);
    const back = migrateState(copy(ms))!;
    ok(back.players.every(p => p.faction === undefined) && back.sidePerks === undefined && back.squads === undefined, `${spec.id}: nor after a save and load`);
  }
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Round 6 groundwork: setups', setups],
  ['Round 6 groundwork: armies and per-side specs', specs],
  ['Round 6 groundwork: saves from before round 6, and missions', saves],
  // round6:A begin. Two armies: its sections, appended here.
  // round6:A end.
];
