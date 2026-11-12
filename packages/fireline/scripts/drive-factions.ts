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
import { setAutopilotAi } from '../src/sim/ai';
import { launchAircraft } from '../src/sim/air';
import { canQueue, doAttack, doMove, doQueue } from '../src/sim/commands';
import { occupancy } from '../src/sim/grid';
import { layoutTree, rulesCatalogue } from '../src/game/techTree';
import { missionContext, newCampaign } from '../src/campaign/progression';
import { MISSIONS } from '../src/campaign/missions';
import { createMissionState } from '../src/sim/mission';
import {
  AIR_AMMO,
  AIR_MENU,
  BOMB_PATCH,
  BUILD_MENU,
  BUILDINGS,
  DEFAULT_SETUP,
  FACTIONS,
  FACTION_DOCTRINES,
  FACTION_MENUS,
  FACTION_NAMES,
  FACTION_OVERLAY,
  INFANTRY_MENU,
  LEGACY_SETUP,
  MENUS,
  REARM_TICKS,
  STANDARD_TECH,
  UNITS,
  VEHICLE_MENU,
  type BuildingKind,
  type BuildingSpec,
  HERO_KINDS,
  type Category,
  type Faction,
  type Owner,
  type SkirmishSetup,
  type UnitKind,
  type UnitSpec,
} from '../src/sim/rules';
import { buildingSpecFor, factionAllows, factionOf, menuOf, unitSpecFor } from '../src/sim/specs';
import { addBuilding, addUnit, costFor, costOf, buildTicksFor, buildTicksOf, createInitialState, maxHpOf, migrateState, normaliseSetup, techAllowed } from '../src/sim/state';
import type { GameState, Unit } from '../src/sim/types';

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

const CATEGORIES: Category[] = ['building', 'infantry', 'vehicle', 'air', 'naval'];
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
  // Meridian's lists are MENUS, in order (every kind of today keeps its place and hotkey), with its
  // one signature item, the Sapper, after Infantry's own (workstream A, section 3 of the contract).
  // Integration: this round's recruits (the General and the heroes) close each list, after the
  // signature items, so a key in use never moves when Heroes or Generals are on (menuOf).
  const everyday = (c: Category) => MENUS[c].filter(k => !RECRUITS.includes(k));
  const recruitsOf = (c: Category) => MENUS[c].filter(k => RECRUITS.includes(k)).sort((a, b) => (a === 'general' ? 0 : 1) - (b === 'general' ? 0 : 1));
  ok(
    CATEGORIES.every(c => JSON.stringify(menuOf('meridian', c).slice(0, everyday(c).length)) === JSON.stringify(everyday(c))),
    "Meridian: every build list is MENUS, in order (today's items keep their places)",
  );
  ok(
    CATEGORIES.every(
      c => JSON.stringify(menuOf('meridian', c).slice(everyday(c).length)) === JSON.stringify([...(FACTION_MENUS.meridian.add?.[c] ?? []), ...recruitsOf(c)]),
    ),
    'Meridian: then its own signature items, then the recruits (the General, then the heroes), nothing else',
  );
  for (const c of CATEGORIES) ok(MENUS[c].every(k => factionAllows('meridian', k)), `Meridian fields everything on ${c}`);
  // An army changes numbers, never a kind's identity.
  for (const f of FACTIONS) {
    for (const k of unitKinds) {
      const a = unitSpecFor(f, k);
      const b = UNITS[k];
      ok(
        a.category === b.category && a.hero === b.hero && a.medic === b.medic && a.mender === b.mender && a.deploysTo === b.deploysTo && a.stealth === b.stealth && a.airRole === b.airRole && a.detector === b.detector && a.carries === b.carries,
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
  const s = createAsWritten('f', 'f', { seed: 'factions', createdAt: 0, setup: { tech: 'advanced', sides: 3, factions: ['meridian', 'ashen', 'meridian'] } });
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
    const s = createAsWritten(`r6-${label}`, label, { seed: `r6-${label}`, createdAt: 0, autopilot: true, setup });
    ok(JSON.stringify(migrateState(copy(s))) === JSON.stringify(s), `${label}: a fresh state passes migrateState unchanged`);
    const later = run(s, 1200);
    ok(JSON.stringify(migrateState(copy(later))) === JSON.stringify(later), `${label}: two minutes in, unchanged by migrateState`);
  }
  // A save from before round 6 loads, reads Meridian, and plays exactly as the same battle saved now.
  for (const [i, setup] of ([{ map: 'canyon', tech: 'advanced' }, { map: 'highlands', tech: 'advanced', sides: 4, mode: 'teams' }, undefined] as (Partial<SkirmishSetup> | undefined)[]).entries()) {
    const now = run(createAsWritten(`old-${i}`, 'old', { seed: `old-save-${i}`, createdAt: 0, autopilot: true, setup }), 600);
    const old = migrateState(preRound6(now));
    ok(!!old, `old save ${i}: loads`);
    if (!old) continue;
    ok(old.players.every(p => p.faction === undefined) && old.players.every((_, o) => factionOf(old, o as 0) === 'meridian'), `old save ${i}: every side reads Meridian`);
    ok(old.sidePerks === undefined && old.squads === undefined, `old save ${i}: no side perks, no squads`);
    if (old.setup) ok(old.setup.factions!.every(f => f === 'meridian') && old.setup.heroes === false && old.setup.generals === false, `old save ${i}: its setup reads Meridian, no heroes, no Generals`);
    ok(played(run(old, 3000)) === played(run(now, 3000)), `old save ${i}: plays byte-identically to the same battle saved now`);
  }
  // Junk on a player is dropped, never trusted.
  const s = createAsWritten('j', 'j', { seed: 'junk', createdAt: 0, setup: { tech: 'advanced', factions: ['ashen', 'meridian'] } });
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
  ['Two armies: the Ashen overlay, the new kinds and the menus', overlayAndMenus],
  ['Two armies: signature items belong to their army', signatureItems],
  ['Two armies: aircraft fight by role', aircraftByRole],
  ['Two armies: an Ashen side measured', ashenMeasured],
  ['Two armies: whole battles, Ashen against Meridian from each seat', twoArmyBattles],
  // round6:A end.
  // round6:integration begin. Build keys over every army's lists, with Heroes and Generals on.
  ['Integration: build keys for every army, heroes and Generals on', buildKeys],
  ['Integration: stat cards and the setup text', cardsAndSetupText],
  // round6:integration end.
  ['Merge: the air war for both armies', airWarBothArmies],
  ['Merge: the naval war for both armies', navalWarBothArmies],
];

// ---- Workstream A: two armies ----------------------------------------------------------------

/** This round's recruits, which close every list (integration): the field General and the heroes. */
const RECRUITS: (BuildingKind | UnitKind)[] = ['general', ...HERO_KINDS];

/** The four kinds workstream A adds: each army's signature unit and Ashen's two aircraft. */
const NEW_KINDS: UnitKind[] = ['sapper', 'raider', 'kestrel', 'firebrand'];
const OWN_ARMY: Record<string, Faction> = { sapper: 'meridian', raider: 'ashen', kestrel: 'ashen', firebrand: 'ashen' };
const categoryOfKind = (k: BuildingKind | UnitKind): Category => (k in BUILDINGS ? 'building' : UNITS[k as UnitKind].category);

function overlayAndMenus(ok: Ok): void {
  // Every Ashen number is the overlay's where it gives one, else the catalogue's (the very value).
  for (const k of Object.keys(UNITS) as UnitKind[]) {
    const a = unitSpecFor('ashen', k) as unknown as Record<string, unknown>;
    const over = (FACTION_OVERLAY.ashen.units?.[k] ?? {}) as Record<string, unknown>;
    const base = UNITS[k] as unknown as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(base)]);
    ok([...keys].every(key => a[key] === (key in over ? over[key] : base[key])), `ashen ${k}: every number is the overlay's or the catalogue's`);
  }
  for (const k of Object.keys(BUILDINGS) as BuildingKind[]) {
    const a = buildingSpecFor('ashen', k) as unknown as Record<string, unknown>;
    const over = (FACTION_OVERLAY.ashen.buildings?.[k] ?? {}) as Record<string, unknown>;
    const base = BUILDINGS[k] as unknown as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(base)]);
    ok([...keys].every(key => a[key] === (key in over ? over[key] : base[key])), `ashen ${k}: every number is the overlay's or the catalogue's`);
  }
  ok(Object.keys(FACTION_OVERLAY.meridian).length === 0, "Meridian's overlay is empty");
  // "Slightly different": every change within about 15% of the catalogue: lighter, faster or cheaper.
  const within = (a: number, b: number, lo: number, hi: number) => a / b >= lo && a / b <= hi;
  for (const [k, o] of Object.entries(FACTION_OVERLAY.ashen.units ?? {}) as [UnitKind, Partial<UnitSpec>][]) {
    const b = UNITS[k];
    if (o.hp !== undefined) ok(within(o.hp, b.hp, 0.85, 0.95), `ashen ${k}: about 10% less health (${o.hp} for ${b.hp})`);
    if (o.speed !== undefined) ok(within(o.speed, b.speed, 1.05, 1.16), `ashen ${k}: 5 to 15% faster`);
    if (o.cost !== undefined) ok(within(o.cost, b.cost, 0.88, 0.97), `ashen ${k}: up to about 10% cheaper`);
    if (o.weapon) {
      const { range, ...rest } = o.weapon;
      const { range: r0, ...rest0 } = b.weapon!;
      ok(JSON.stringify(rest) === JSON.stringify(rest0) && range < r0 && range >= r0 - 0.75, `ashen ${k}: the same gun, slightly shorter (${range} for ${r0})`);
    }
  }
  for (const [k, o] of Object.entries(FACTION_OVERLAY.ashen.buildings ?? {}) as [BuildingKind, Partial<BuildingSpec>][]) {
    const b = BUILDINGS[k];
    if (o.hp !== undefined) ok(within(o.hp, b.hp, 0.85, 0.95), `ashen ${k}: about 10% less health`);
    if (o.cost !== undefined) ok(within(o.cost, b.cost, 0.88, 0.97), `ashen ${k}: up to about 10% cheaper`);
  }
  // The new kinds: advanced tech, each army's own, aircraft by role.
  for (const k of NEW_KINDS) {
    ok(!STANDARD_TECH.includes(k), `${k}: advanced tech only`);
    ok(!Object.values(MENUS).some(list => list.includes(k)), `${k}: on no shared list (an army's own lists only)`);
    ok(FACTIONS.every(f => factionAllows(f, k) === (f === OWN_ARMY[k])), `${k}: fielded by ${FACTION_NAMES[OWN_ARMY[k]]} alone`);
    ok(menuOf(OWN_ARMY[k], categoryOfKind(k)).includes(k), `${k}: on its army's ${categoryOfKind(k)} list`);
  }
  ok(UNITS.kestrel.airRole === 'strafe' && UNITS.firebrand.airRole === 'bomb', 'the Kestrel strafes, the Firebrand bombs');
  ok(JSON.stringify(UNITS.kestrel.requires) === JSON.stringify(UNITS.gunship.requires), 'the Kestrel needs what the Gunship needs');
  ok(JSON.stringify(UNITS.firebrand.requires) === JSON.stringify(UNITS.bomber.requires), 'the Firebrand needs what the Bomber needs');
  ok(UNITS.kestrel.hp < UNITS.gunship.hp && UNITS.kestrel.speed > UNITS.gunship.speed && UNITS.kestrel.cost < UNITS.gunship.cost, 'the Kestrel: lighter, faster, cheaper than the Gunship');
  ok((AIR_AMMO.kestrel ?? 0) > (AIR_AMMO.gunship ?? 0) && (REARM_TICKS.kestrel ?? 99) < (REARM_TICKS.gunship ?? 0), 'the Kestrel: more loads, quicker rearm');
  ok((AIR_AMMO.firebrand ?? 0) > 0 && (REARM_TICKS.firebrand ?? 0) > 0, 'the Firebrand carries and rearms its bombs');
  const fw = UNITS.firebrand.weapon!;
  ok(!!BOMB_PATCH[fw.kind] && fw.kind !== 'bomb' && (fw.splash ?? 0) < (UNITS.bomber.weapon!.splash ?? 0), 'the Firebrand: a smaller blast than the Bomber, and a patch that burns on');
  ok(!BOMB_PATCH.bomb, "the Bomber's bombs leave no patch");
  ok(UNITS.raider.speed > UNITS.buggy.speed && UNITS.raider.hp < UNITS.buggy.hp, 'the Raider Bike: faster and frailer than the buggy');
  ok(UNITS.sapper.requires.includes('barracks') && UNITS.sapper.category === 'infantry', 'the Sapper: infantry, from the Barracks');
  // Menus per army.
  // Merged with the air war: its four aircraft on both armies' lists, then Ashen's own two.
  ok(menuOf('ashen', 'air').join() === 'reconplane,interceptor,carrier,heavybomber,kestrel,firebrand', "Ashen's Air list: the air war's four, then Kestrel, Firebrand");
  const today = (l: readonly (BuildingKind | UnitKind)[]) => l.filter(k => !RECRUITS.includes(k));
  const recruits = (l: readonly (BuildingKind | UnitKind)[]) => l.filter(k => RECRUITS.includes(k)).sort((a, b) => (a === 'general' ? 0 : 1) - (b === 'general' ? 0 : 1));
  ok(menuOf('ashen', 'vehicle').join() === [...today(VEHICLE_MENU), 'raider', ...recruits(VEHICLE_MENU)].join(), "Ashen's Vehicles: today's, then the Raider Bike, then the Ace");
  ok(menuOf('ashen', 'infantry').join() === [...today(INFANTRY_MENU), ...recruits(INFANTRY_MENU)].join() && menuOf('ashen', 'building').join() === BUILD_MENU.join(), "Ashen's Infantry and Structures: today's");
  ok(menuOf('meridian', 'infantry').join() === [...today(INFANTRY_MENU), 'sapper', ...recruits(INFANTRY_MENU)].join(), "Meridian's Infantry: today's, then the Sapper, then the General and the heroes");
  ok(menuOf('meridian', 'air') === MENUS.air && menuOf('meridian', 'vehicle').join() === [...today(VEHICLE_MENU), ...recruits(VEHICLE_MENU)].join(), "Meridian's Air and Vehicles: today's");
  ok(!factionAllows('ashen', 'gunship') && !factionAllows('ashen', 'bomber'), 'Ashen never flies the Gunship or the Bomber');
  ok(FACTIONS.every(f => FACTION_DOCTRINES[f].length > 20), 'each army has its one-line doctrine');
  // The build window's catalogue, per army: lists, numbers, and a tree that lays out the new kinds.
  for (const f of FACTIONS) {
    const cat = rulesCatalogue(f);
    ok(cat === rulesCatalogue(f), `${f}: one catalogue object`);
    ok(CATEGORIES.every(c => cat.menus[c].join() === menuOf(f, c).join()), `${f}: the build window's lists are the army's`);
    ok(cat.spec('tank')!.cost === unitSpecFor(f, 'tank').cost && cat.spec('turret')!.cost === buildingSpecFor(f, 'turret').cost, `${f}: the build window's prices are the army's`);
    for (const c of CATEGORIES) {
      const tree = layoutTree(cat, cat.menus[c]);
      const placed = tree.columns.flatMap(col => col.items);
      ok(placed.length === cat.menus[c].length && cat.menus[c].every(k => placed.includes(k)), `${f} ${c}: every item laid out once`);
    }
  }
  const ar = unitSpecFor('ashen', 'rifleman').cost;
  ok(ar < 100 && rulesCatalogue('ashen').spec('rifleman')!.cost === ar && rulesCatalogue('meridian').spec('rifleman')!.cost === 100, `a rifleman costs ${ar} for Ashen, 100 for Meridian`);
}

/** An advanced skirmish, Meridian against Ashen unless told otherwise, with structures added for both. */
function equipped(factions: Faction[] = ['meridian', 'ashen'], tech: 'advanced' | 'standard' = 'advanced'): GameState {
  const s = copy(createInitialState('fa', 'fa', { seed: 'factions-equipped', createdAt: 0, setup: { map: 'plains', tech, credits: 20000, factions } }));
  for (const owner of [0, 1] as Owner[]) {
    let x = 2;
    for (const k of ['barracks', 'factory', 'techcentre', 'helipad', 'uplink', 'refinery', 'power'] as BuildingKind[]) {
      addBuilding(s, owner, k, x, owner === 0 ? 2 : 50, -100);
      x += 5;
    }
    s.players[owner].credits = 20000;
  }
  return s;
}

function signatureItems(ok: Ok): void {
  const s = equipped();
  ok(canQueue(s, 0, 'infantry', 'sapper') && !canQueue(s, 1, 'infantry', 'sapper'), 'the Sapper: Meridian may train it, Ashen may not');
  ok(canQueue(s, 1, 'vehicle', 'raider') && !canQueue(s, 0, 'vehicle', 'raider'), 'the Raider Bike: Ashen may build it, Meridian may not');
  for (const k of ['kestrel', 'firebrand'] as UnitKind[]) ok(canQueue(s, 1, 'air', k) && !canQueue(s, 0, 'air', k), `${k}: Ashen only`);
  for (const k of ['gunship', 'bomber'] as UnitKind[]) ok(canQueue(s, 0, 'air', k) && !canQueue(s, 1, 'air', k), `${k}: Meridian only`);
  // Through the reducer, as the player: a refused queue is the same state back.
  const asAshen = equipped(['ashen', 'meridian']);
  for (const k of ['sapper', 'gunship', 'bomber'] as UnitKind[])
    ok(processAction(asAshen, { type: 'queue', category: categoryOfKind(k), kind: k }) === asAshen, `the player as Ashen: ${k} refused, the same state back`);
  for (const k of ['raider', 'kestrel', 'firebrand'] as UnitKind[]) {
    const next = processAction(asAshen, { type: 'queue', category: categoryOfKind(k), kind: k });
    ok(next !== asAshen && next.players[0].queues[categoryOfKind(k)].some(q => q.kind === k), `the player as Ashen: ${k} queued`);
  }
  const asMeridian = equipped(['meridian', 'ashen']);
  for (const k of ['raider', 'kestrel', 'firebrand'] as UnitKind[])
    ok(processAction(asMeridian, { type: 'queue', category: categoryOfKind(k), kind: k }) === asMeridian, `the player as Meridian: ${k} refused, the same state back`);
  ok(processAction(asMeridian, { type: 'queue', category: 'infantry', kind: 'sapper' }) !== asMeridian, 'the player as Meridian: the Sapper queued');
  // Standard tech: none of them, for either army, whatever stands.
  const std = equipped(['meridian', 'ashen'], 'standard');
  for (const k of NEW_KINDS) ok(!canQueue(std, 0, categoryOfKind(k), k) && !canQueue(std, 1, categoryOfKind(k), k), `standard tech: no ${k} for anyone`);
  // Missions: none of the new kinds, for any side, in any mission.
  const c = newCampaign('T');
  for (const spec of MISSIONS) {
    const ms = createMissionState(spec, missionContext(c, spec, `r6a-${spec.id}`, 0));
    ok(NEW_KINDS.every(k => ms.players.every((_, o) => !techAllowed(ms, o as Owner, k))), `${spec.id}: none of the new kinds allowed to any side`);
  }
}

/** Open plains, nobody's units, nothing attacking, and 17 by 17 clear tiles round (cx, cy). */
function arena(factions: Faction[] = ['meridian', 'ashen']) {
  const s = copy(createInitialState('fa-arena', 'fa-arena', { seed: 'factions-arena', createdAt: 0, setup: { map: 'plains', tech: 'advanced', credits: 20000, factions } }));
  s.units = [];
  for (const m of s.ai) m.nextAttack = 1e9;
  const occ = occupancy(s);
  const cx = Math.floor(s.mapW / 2);
  const cy = Math.floor(s.mapH / 2);
  const tiles = s.tiles.split('');
  for (let y = cy - 8; y <= cy + 8; y++)
    for (let x = cx - 8; x <= cx + 8; x++) {
      const k = y * s.mapW + x;
      if (occ[k]) throw new Error('a structure in the middle of the arena');
      tiles[k] = 'g';
      s.ore[k] = 0;
    }
  s.tiles = tiles.join('');
  return { s, cx, cy };
}

/** Both commanders switched off: these sections test the rules, not the computer. */
function quietly(fn: () => void): void {
  setAutopilotAi(() => {}, 0);
  setAutopilotAi(() => {}, 1);
  try {
    fn();
  } finally {
    setAutopilotAi(null, 0);
    setAutopilotAi(null, 1);
  }
}

const unitIn = (s: GameState, id: number) => s.units.find(u => u.id === id);
function put(s: GameState, owner: Owner, kind: UnitKind, x: number, y: number, extra: Partial<Unit> = {}): Unit {
  const u = addUnit(s, owner, kind, x, y);
  if (UNITS[kind].category === 'air') u.ammo = AIR_AMMO[kind];
  Object.assign(u, extra);
  return u;
}

/** Plays `n` single ticks, calling `each` after every one with the state. */
function watch(s: GameState, n: number, each: (t: GameState) => void): GameState {
  for (let i = 0; i < n; i++) {
    s = processAction(s, { type: 'tick' });
    each(s);
  }
  return s;
}

function aircraftByRole(ok: Ok): void {
  quietly(() => {
    // A Firebrand on a structure: a bomb run of incendiaries, each burning on where it lands.
    {
      const { s, cx, cy } = arena();
      const target = addBuilding(s, 0, 'barracks', cx, cy, -100);
      const fb = put(s, 1, 'firebrand', cx - 7.5, cy + 1, { stance: 'hold' });
      doAttack(s, 1, [fb.id], target.id);
      let run = false;
      let bombs = 0;
      let patchDamage = true;
      const drops = new Set<number>();
      const burns = new Set<number>();
      const t = watch(s, 260, x => {
        if (unitIn(x, fb.id)?.bombRun) run = true;
        for (const p of x.projectiles) {
          if (p.shooter !== fb.id) continue;
          if (p.weapon === 'bomb') bombs++;
          if (p.fromX === p.toX && p.fromY === p.toY) {
            burns.add(p.id);
            if (Math.abs(p.damage - UNITS.firebrand.weapon!.damage * BOMB_PATCH.flame!.share) > 1e-9) patchDamage = false;
          } else drops.add(p.id);
        }
      });
      const b = t.buildings.find(x => x.id === target.id);
      ok(run, 'a Firebrand sent at a structure starts a bomb run (its role)');
      ok(bombs === 0, 'it drops no Bomber bombs');
      ok(drops.size > 0 && burns.size === drops.size * BOMB_PATCH.flame!.pulses, `each incendiary leaves a patch that burns ${BOMB_PATCH.flame!.pulses} more times (${drops.size} dropped, ${burns.size} burns)`);
      ok(patchDamage, `each burn deals ${BOMB_PATCH.flame!.share * 100}% of the bomb's damage`);
      ok(!b || b.hp < BUILDINGS.barracks.hp, 'the structure is hurt');
      ok(drops.size <= (AIR_AMMO.firebrand ?? 0), 'no more incendiaries than its bay holds');
    }
    // A Bomber in the same place: bombs, and no burning patch (as before).
    {
      const { s, cx, cy } = arena();
      const target = addBuilding(s, 1, 'barracks', cx, cy, -100);
      const bm = put(s, 0, 'bomber', cx - 7.5, cy + 1, { stance: 'hold' });
      doAttack(s, 0, [bm.id], target.id);
      let still = 0;
      let bombs = 0;
      watch(s, 200, x => {
        for (const p of x.projectiles) {
          if (p.shooter !== bm.id) continue;
          if (p.fromX === p.toX && p.fromY === p.toY) still++;
          if (p.weapon === 'bomb') bombs++;
        }
      });
      ok(bombs > 0 && still === 0, 'a Bomber drops bombs and leaves no burning patch');
    }
    // A Kestrel on a vehicle: rockets from a hover, never a bomb run.
    {
      const { s, cx, cy } = arena();
      const target = put(s, 0, 'hauler', cx + 0.5, cy + 0.5, { stance: 'hold' });
      const k = put(s, 1, 'kestrel', cx - 6.5, cy + 0.5, { stance: 'hold' });
      doAttack(s, 1, [k.id], target.id);
      let run = false;
      const rockets = new Set<number>();
      let least = AIR_AMMO.kestrel ?? 0;
      const t = watch(s, 150, x => {
        const u = unitIn(x, k.id);
        if (u?.bombRun) run = true;
        if (u) least = Math.min(least, u.ammo ?? 0);
        for (const p of x.projectiles) if (p.shooter === k.id && p.weapon === 'rocket') rockets.add(p.id);
      });
      ok(rockets.size > 0 && !run, `a Kestrel strafes: ${rockets.size} rockets, no bomb run`);
      ok(least < (AIR_AMMO.kestrel ?? 0), 'each rocket spends a load');
      ok((unitIn(t, target.id)?.hp ?? 0) < UNITS.hauler.hp, 'the target is hurt');
    }
    // Rearming from empty on its pad, a load every REARM_TICKS: the Kestrel sooner than the Gunship.
    const rearmTicks = (kind: UnitKind, owner: Owner): number => {
      const { s, cx, cy } = arena();
      const pad = addBuilding(s, owner, 'helipad', cx - 1, cy - 1, -100);
      const u = addUnit(s, owner, kind, cx, cy);
      launchAircraft(s, u, pad);
      u.ammo = 0;
      let t = s;
      for (let i = 1; i <= 400; i++) {
        t = processAction(t, { type: 'tick' });
        if ((unitIn(t, u.id)?.ammo ?? 0) >= (AIR_AMMO[kind] ?? 0)) return i;
      }
      return Infinity;
    };
    const kr = rearmTicks('kestrel', 1);
    const gr = rearmTicks('gunship', 0);
    const want = (AIR_AMMO.kestrel ?? 0) * (REARM_TICKS.kestrel ?? 0);
    ok(Math.abs(kr - want) <= (REARM_TICKS.kestrel ?? 0) + 1, `a Kestrel rearms from empty in about ${want} ticks (${kr})`);
    ok(kr < gr, `sooner than a Gunship (${kr} ticks against ${gr})`);
  });
}

function ashenMeasured(ok: Ok): void {
  quietly(() => {
    const s = equipped();
    // Prices and build times through the per-side lookup, for every kind.
    const kinds = [...(Object.keys(UNITS) as UnitKind[]), ...(Object.keys(BUILDINGS) as BuildingKind[])];
    for (const k of kinds) {
      const spec = k in BUILDINGS ? buildingSpecFor('ashen', k as BuildingKind) : unitSpecFor('ashen', k as UnitKind);
      ok(costFor(s, 1, k) === spec.cost && buildTicksFor(s, 1, k) === spec.buildTicks, `${k}: Ashen's price and build time are its spec's`);
      ok(costFor(s, 0, k) === costOf(k) && buildTicksFor(s, 0, k) === buildTicksOf(k), `${k}: Meridian's still the catalogue's`);
    }
    // Paid in a queue: the same rifleman, 100 credits from Meridian, less from Ashen.
    const q = copy(s);
    const before = q.players.map(p => p.credits);
    doQueue(q, 0, 'infantry', 'rifleman');
    doQueue(q, 1, 'infantry', 'rifleman');
    const ar = unitSpecFor('ashen', 'rifleman').cost;
    ok(ar < 100 && before[0] - q.players[0].credits === 100 && before[1] - q.players[1].credits === ar, `a rifleman: 100 credits from Meridian, ${ar} from Ashen`);
    // Trained: both on the same tick (an army changes the price here, not the build time).
    const old = new Set(s.units.map(u => u.id));
    const out: (number | null)[] = [null, null];
    let t = q;
    for (let i = 1; i <= 300 && (out[0] === null || out[1] === null); i++) {
      t = processAction(t, { type: 'tick' });
      for (const o of [0, 1] as Owner[]) if (out[o] === null && t.units.some(u => u.owner === o && u.kind === 'rifleman' && !old.has(u.id))) out[o] = i;
    }
    ok(out[0] !== null && out[0] === out[1], `both riflemen trained on the same tick (${out[0]}, ${out[1]})`);
    const trained = t.units.find(u => u.owner === 1 && u.kind === 'rifleman' && !old.has(u.id));
    const rh = unitSpecFor('ashen', 'rifleman').hp;
    ok(!!trained && trained.hp === rh && maxHpOf(trained) === rh, `Ashen's rifleman comes out at its army's full health, ${rh}`);
    // Health stored with the unit, and read back after a save.
    const a = arena();
    const tank = put(a.s, 1, 'tank', a.cx + 0.5, a.cy + 0.5);
    const th = unitSpecFor('ashen', 'tank').hp;
    ok(th !== UNITS.tank.hp && tank.hp === th && tank.maxHp === th && maxHpOf(tank) === th, `an Ashen tank: ${th} health, stored`);
    ok(maxHpOf(migrateState(copy(a.s))!.units.find(u => u.id === tank.id)!) === th, `and still ${th} after a save and load`);
    // Speed: two riflemen, one of each army, walk the same open ground.
    {
      const { s: w, cx, cy } = arena();
      const m = put(w, 0, 'rifleman', cx - 7.5, cy - 2.5);
      const ash = put(w, 1, 'rifleman', cx - 7.5, cy + 2.5);
      doMove(w, 0, [m.id], cx + 7.5, cy - 2.5, false);
      doMove(w, 1, [ash.id], cx + 7.5, cy + 2.5, false);
      let r = w;
      for (let i = 0; i < 100; i++) r = processAction(r, { type: 'tick' });
      const dm = unitIn(r, m.id)!.x - m.x;
      const da = unitIn(r, ash.id)!.x - ash.x;
      const ratio = unitSpecFor('ashen', 'rifleman').speed / UNITS.rifleman.speed;
      ok(dm > 3 && Math.abs(da / dm - ratio) < 0.03, `an Ashen rifleman walks ${(da / dm).toFixed(3)} times as far in the same time (its spec: ${ratio.toFixed(3)})`);
    }
    // Range: a tank of each army sent at a hauler seven tiles off closes to its own range and fires
    // from there: Meridian's from beyond four and a half tiles, Ashen's from within 4.25.
    for (const owner of [0, 1] as Owner[]) {
      const { s: w, cx, cy } = arena();
      const shooter = put(w, owner, 'tank', cx - 3.5, cy + 0.5);
      const mark = put(w, owner === 0 ? 1 : 0, 'hauler', cx + 3.5, cy + 0.5, { stance: 'hold' });
      doAttack(w, owner, [shooter.id], mark.id);
      let from = -1;
      watch(w, 120, x => {
        if (from >= 0 || !x.projectiles.some(p => p.shooter === shooter.id)) return;
        const u = unitIn(x, shooter.id)!;
        from = Math.hypot(u.x - mark.x, u.y - mark.y);
      });
      const range = unitSpecFor(factionOf(w, owner), 'tank').weapon!.range;
      ok(from > 0 && from <= range + 1e-9 && from > range - 0.3, `a ${FACTION_NAMES[factionOf(w, owner)]} tank fires from ${from.toFixed(2)} tiles (its range ${range})`);
    }
  });
}

function twoArmyBattles(ok: Ok): void {
  const ashenOwn = new Set<UnitKind>();
  for (const seat of [0, 1] as Owner[]) {
    const factions: Faction[] = seat === 0 ? ['ashen', 'meridian'] : ['meridian', 'ashen'];
    const name = `two-armies-${seat}`;
    const fresh = () => createInitialState(name, name, { seed: name, createdAt: 0, autopilot: true, setup: { map: 'river', tech: 'advanced', factions } });
    const seen: Set<UnitKind>[] = [new Set(), new Set()];
    let s = fresh();
    let loaded: GameState | null = null;
    while (s.winner === null && s.tick < 48000) {
      s = processAction(s, { type: 'tick', n: 300 });
      for (const u of s.units) if (u.owner <= 1) seen[u.owner].add(u.kind);
      // A save and load at ten minutes plays on exactly as the battle does.
      if (s.tick === 6000) loaded = migrateState(copy(s));
      if (s.tick === 9000 && loaded) {
        while (loaded.tick < 9000) loaded = processAction(loaded, { type: 'tick', n: 300 });
        ok(played(loaded) === played(s), `seat ${seat} Ashen: saved and loaded at ten minutes, it plays on byte-identically`);
      }
    }
    const ash = seat;
    const own = (o: number) => [...seen[o]].filter(k => NEW_KINDS.includes(k) || k === 'gunship' || k === 'bomber');
    ok(s.winner !== null, `seat ${seat} Ashen against Meridian: played to a finish (side ${s.winner} at ${Math.round(s.tick / 600)} min)`);
    ok(s.players[ash].faction === 'ashen' && s.players[1 - ash].faction === 'meridian', 'each side kept its army');
    ok(!own(ash).some(k => k === 'gunship' || k === 'bomber' || k === 'sapper'), `the Ashen side fielded only its own (${own(ash).join(', ') || 'none'})`);
    ok(!own(1 - ash).some(k => k === 'raider' || k === 'kestrel' || k === 'firebrand'), `the Meridian side fielded only its own (${own(1 - ash).join(', ') || 'none'})`);
    for (const k of own(ash)) ashenOwn.add(k);
    let again = fresh();
    while (again.winner === null && again.tick < 48000) again = processAction(again, { type: 'tick', n: 300 });
    ok(played(again) === played(s), `seat ${seat} Ashen: the same battle replays byte-identically`);
  }
  // Over the two battles the Ashen computer fields its own kinds (a single battle may end before it does).
  ok(ashenOwn.has('raider') || ashenOwn.has('kestrel') || ashenOwn.has('firebrand'), `the Ashen computer fields its own units (${[...ashenOwn].join(', ') || 'none'})`);
}

// round6:integration begin. Build keys (fireline-round6-design.md section 7): every list of every
// army, with Heroes and Generals on and an Academy standing, so every recruit is listed.
import { BUILD_KEYS, listedCost, menuFor, statsOf } from '../src/game/Sidebar';
import { techText } from '../src/components/SkirmishSetup';

/** Keys the battle screen gives other jobs (its key table): no build key may be one of them. */
const RESERVED_KEYS = ['o', 'p', 'a', 's', 'g', 'h', 'm', 'f', 'z', 'x', 'c', 'v', '0', '.', ' ', '`', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
/** The Structures past the fourteenth on advanced tech, clicked or tapped in the build window (the key table says so). */
const KEYLESS: (BuildingKind | UnitKind)[] = ['protoworks', 'fortress', 'shipyard', 'academy'];

function buildKeys(ok: Ok): void {
  ok(new Set(BUILD_KEYS).size === BUILD_KEYS.length, `the ${BUILD_KEYS.length} build keys are all different`);
  ok(BUILD_KEYS.every(k => !RESERVED_KEYS.includes(k)), 'and none is a key with another job');
  for (const f of FACTIONS) {
    const plain = createAsWritten(`keys-${f}`, 'k', { seed: `keys-${f}`, createdAt: 0, setup: { tech: 'advanced', factions: [f, f] } });
    const full = copy(createAsWritten(`keys-${f}`, 'k', { seed: `keys-${f}`, createdAt: 0, setup: { tech: 'advanced', factions: [f, f], heroes: true, generals: true } }));
    const st = full.starts![0];
    const dx = st.x < full.mapW / 2 ? 1 : -1;
    (['barracks', 'factory', 'techcentre', 'uplink', 'helipad', 'academy'] as BuildingKind[]).forEach((k, i) =>
      addBuilding(full, 0, k, Math.round(st.x + dx * (5 + 4 * (i % 3))), Math.round(st.y + 5 + 4 * Math.floor(i / 3)), -100),
    );
    for (const tab of CATEGORIES) {
      const list = menuFor(tab, full);
      const keyed = list.slice(0, BUILD_KEYS.length).map((k, i) => `${BUILD_KEYS[i]}:${k}`);
      const keys = keyed.map(x => x.split(':')[0]);
      ok(new Set(keys).size === keys.length && new Set(list).size === list.length, `${f}, ${tab}: no two items share a key (${keyed.join(' ')})`);
      const over = list.slice(BUILD_KEYS.length);
      ok(over.every(k => KEYLESS.includes(k)), `${f}, ${tab}: past the fourteenth only ${over.length ? over.join(', ') : 'nothing'}, which the key table names as clicked`);
      if (tab !== 'building') ok(list.length <= BUILD_KEYS.length, `${f}, ${tab}: every unit has a key (${list.length} items)`);
      // An everyday item keeps its key whether or not the recruits are listed.
      const before = menuFor(tab, plain);
      ok(before.every((k, i) => RECRUITS.includes(k) || list[i] === k), `${f}, ${tab}: turning Heroes and Generals on moves no key already in use`);
    }
    ok(RECRUITS.every(k => menuFor(UNITS[k as UnitKind].category, full).includes(k)), `${f}: the General and every hero are listed with Heroes and Generals on`);
  }
}

/** Stat cards price what a list charges (costFor and buildTicksFor), and the setup names recruits only when they are on. */
function cardsAndSetupText(ok: Ok): void {
  const row = (rows: { label: string; value: string }[], label: string) => rows.find(r => r.label === label)?.value ?? '';
  for (const f of FACTIONS) {
    const s = createAsWritten(`cards-${f}`, 'c', {
      seed: `cards-${f}`,
      createdAt: 0,
      setup: { tech: 'advanced', factions: [f, f], heroes: true, generals: true, generalPicks: [f === 'ashen' ? 'kade' : 'voss', null] },
    });
    for (const k of RECRUITS) {
      const card = statsOf(k, f, s, 0);
      ok(row(card, 'Cost') === `${costFor(s, 0, k).toLocaleString('en-GB')} credits` && costFor(s, 0, k) > 0, `${f}: the ${UNITS[k as UnitKind].name}'s card shows its price in the battle (${row(card, 'Cost')})`);
      ok(listedCost(k, f, s).ticks === buildTicksFor(s, 0, k) && buildTicksFor(s, 0, k) > 0, `${f}: and its training time (${row(card, 'Build time')})`);
      ok(listedCost(k, f).cost > 0 && listedCost(k, f).ticks > 0, `${f}: How to play lists the ${UNITS[k as UnitKind].name} at a price, not 0`);
    }
    // A doctrine's price reaches the card: Voss's tanks, Kade's queues are not prices.
    if (f === 'meridian') ok(row(statsOf('tank', f, s, 0), 'Cost') === `${costFor(s, 0, 'tank').toLocaleString('en-GB')} credits` && costFor(s, 0, 'tank') < costOf('tank'), "Voss's cheaper Tank shows on the card");
    ok(listedCost('rifleman', f).cost === costFor(createAsWritten('c', 'c', { seed: 'c', createdAt: 0, setup: { tech: 'advanced', factions: [f, f] } }), 0, 'rifleman'), `${f}: without a battle, the army's own price`);
  }
  const general = UNITS.general.name;
  const academy = BUILDINGS.academy.name;
  const plain = techText('advanced', { heroes: false, generals: false });
  ok(!plain.includes(general) && !plain.includes(academy) && HERO_KINDS.every(k => !plain.includes(UNITS[k].name)), 'advanced tech, Heroes and Generals off: no General, Academy or hero named');
  const heroes = techText('advanced', { heroes: true, generals: false });
  ok(heroes.includes(academy) && !heroes.includes(general), 'Heroes on: the Academy named, the General not');
  const generals = techText('advanced', { heroes: false, generals: true });
  ok(generals.includes(general) && !generals.includes(academy), 'Generals on: the General named, the Academy not');
  ok(techText('advanced', { heroes: true, generals: true }).includes(general) && techText('advanced', { heroes: true, generals: true }).includes(academy), 'both on: both named');
  ok(techText('standard', { heroes: true, generals: true }) === techText('standard'), 'standard tech: neither, whatever the options say');
}
// round6:integration end.

// ---- Merge: main's air war (2026-11-10) with round 6's two armies ----------------------------------
import { airArena, padWith, tick as ticks, tickUntil } from './drive-air';

/** The air war's aircraft: shared by both armies, unchanged, each with its role. */
const AIR_WAR: [UnitKind, string][] = [
  ['reconplane', 'scout'],
  ['interceptor', 'intercept'],
  ['carrier', 'transport'],
  ['heavybomber', 'bomb'],
];

function airWarBothArmies(ok: Ok): void {
  for (const [k, role] of AIR_WAR) {
    ok(UNITS[k].airRole === role, `${k}: air role ${role}`);
    ok(FACTIONS.every(f => factionAllows(f, k) && menuOf(f, 'air').includes(k)), `${k}: on both armies' Air lists`);
    ok(FACTIONS.every(f => unitSpecFor(f, k) === UNITS[k]), `${k}: the catalogue's exact numbers for both armies`);
    ok(!STANDARD_TECH.includes(k), `${k}: advanced tech only`);
  }
  ok(menuOf('meridian', 'air') === MENUS.air && MENUS.air.join() === AIR_MENU.join(), "Meridian's Air list is the catalogue's, in order");
  quietly(() => {
    // An Ashen Interceptor parked on its pad scrambles at a Meridian Gunship, and fires.
    {
      const { s, cx, cy } = airArena('fa-aw-scramble', { map: 'plains', tech: 'advanced', credits: 20000, factions: ['meridian', 'ashen'] });
      const { craft } = padWith(s, 1, cx + 3, cy, ['interceptor']);
      const g = put(s, 0, 'gunship', cx - 4.5, cy + 0.5, { stance: 'hold', order: { type: 'idle' } });
      let missiles = 0;
      const t = watch(s, 400, x => {
        for (const p of x.projectiles) if (p.shooter === craft[0].id && p.weapon === 'aamissile' && p.firedAt === x.tick - 1) missiles++;
      });
      ok(missiles > 0, `an Ashen Interceptor scrambles at a Meridian Gunship and fires (${missiles} missiles)`);
      ok(!unitIn(t, g.id) || unitIn(t, g.id)!.hp < UNITS.gunship.hp, 'and hurts it');
    }
    // A Meridian Interceptor at an Ashen Kestrel: the role, not the name, makes it a target.
    {
      const { s, cx, cy } = airArena('fa-aw-kestrel', { map: 'plains', tech: 'advanced', credits: 20000, factions: ['meridian', 'ashen'] });
      const { craft } = padWith(s, 0, cx + 3, cy, ['interceptor']);
      const k = put(s, 1, 'kestrel', cx - 4.5, cy + 0.5, { stance: 'hold', order: { type: 'idle' } });
      const t = tickUntil(s, x => unitIn(x, craft[0].id)?.scramble === true, 200);
      ok(unitIn(t, craft[0].id)?.scramble === true, 'a Meridian Interceptor scrambles at an Ashen Kestrel');
      ok(!!unitIn(t, k.id), 'which is there to be chased');
    }
    // An Ashen Heavy Bomber: a run of bombs, as the Bomber's.
    {
      const { s, cx, cy } = arena();
      const target = addBuilding(s, 0, 'barracks', cx, cy, -100);
      const hb = put(s, 1, 'heavybomber', cx - 7.5, cy + 1, { stance: 'hold' });
      doAttack(s, 1, [hb.id], target.id);
      let run = false;
      let bombs = 0;
      watch(s, 300, x => {
        if (unitIn(x, hb.id)?.bombRun) run = true;
        for (const p of x.projectiles) if (p.shooter === hb.id && p.weapon === 'bomb' && p.firedAt === x.tick - 1) bombs++;
      });
      ok(run && bombs > 0, `an Ashen Heavy Bomber makes a bomb run (${bombs} bombs)`);
    }
    // An Ashen Recon Plane sent to a point burns fuel and circles there.
    {
      const { s, cx, cy } = arena();
      const { craft } = padWith(s, 1, cx - 6, cy - 6, ['reconplane']);
      doMove(s, 1, [craft[0].id], cx + 4, cy + 4, false);
      const t = ticks(s, 300);
      const r = unitIn(t, craft[0].id)!;
      ok(r.order.type === 'idle' && (r.ammo ?? 0) < (AIR_AMMO.reconplane ?? 0), `an Ashen Recon Plane flies out, circles and burns fuel (${r.ammo} left)`);
    }
  });
  // The Ashen computer on Hard, faced with Gunships, answers with its own kinds for every role.
  {
    let s = copy(createInitialState('fa-aw-ai', 'fa-aw-ai', { seed: 'fa-aw-ai', createdAt: 0, difficulty: 'hard', setup: { map: 'plains', tech: 'advanced', credits: 10000, factions: ['meridian', 'ashen'] } }));
    s.units = s.units.filter(u => u.owner !== 0);
    for (const m of s.ai) {
      m.nextAttack = 1e9;
      m.nextRaid = 1e9;
    }
    const hq = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
    padWith(s, 0, hq.x + 4, hq.y, ['gunship', 'gunship']);
    const flown = new Set<UnitKind>();
    for (let k = 0; k < 150 && !flown.has('interceptor'); k++) {
      s = ticks(s, 100);
      for (const u of s.units) if (u.owner === 1 && UNITS[u.kind].category === 'air') flown.add(u.kind);
    }
    ok(flown.has('interceptor'), `the Ashen computer on Hard answers Gunships with an Interceptor (flew ${[...flown].join(', ') || 'nothing'} by minute ${(s.tick / 600).toFixed(1)})`);
    ok(!flown.has('gunship') && !flown.has('bomber'), 'and never a Gunship or a Bomber');
  }
}

// ---- Merge: main's naval war (2026-11-11) with round 6 ----------------------------------------------
import { coastArena, landNear, seaNear } from './drive-naval';
import { boardProblem, canRide } from '../src/sim/transport';
import { canFormation } from '../src/sim/commands';
import { NAVAL_MENU } from '../src/sim/rules';
import { isShip } from '../src/sim/naval';

/** The naval war's ships, in the Naval tab's order. */
const NAVY: UnitKind[] = ['gunboat', 'destroyer', 'landingcraft', 'submarine', 'battleship'];

/**
 * fireline-round6-design.md section 9: both armies sail the navy unchanged, the Naval Yard keeps its
 * own place in the Structures list (no key, ahead of the Academy), the field General and the heroes
 * never board a Landing Craft, formations are for land units, and the computer's ships stay out of
 * its waves and squads while its General and heroes stay ashore.
 */
function navalWarBothArmies(ok: Ok): void {
  // The catalogue's exact numbers and lists, for both armies.
  ok(NAVAL_MENU.join() === NAVY.join() && menuOf('meridian', 'naval') === MENUS.naval, "Meridian's Naval list is the catalogue's, in order");
  for (const f of FACTIONS) {
    ok(menuOf(f, 'naval').join() === NAVY.join(), `${f}: the Naval list is the five ships, in order, and nothing else`);
    ok(NAVY.every(k => factionAllows(f, k) && unitSpecFor(f, k) === UNITS[k]), `${f}: every ship at the catalogue's exact numbers`);
    ok(factionAllows(f, 'shipyard') && buildingSpecFor(f, 'shipyard') === BUILDINGS.shipyard, `${f}: the Naval Yard at the catalogue's exact numbers`);
    const list = menuOf(f, 'building');
    ok(list.indexOf('fortress') + 1 === list.indexOf('shipyard') && list.indexOf('shipyard') + 1 === list.indexOf('academy') && list[list.length - 1] === 'academy',
      `${f}: the Structures list ends Fortress, Naval Yard, Academy (${list.slice(-3).join(', ')})`);
  }
  ok(NAVY.every(k => !STANDARD_TECH.includes(k)) && !STANDARD_TECH.includes('shipyard'), 'the navy is advanced tech only');

  quietly(() => {
    for (const f of FACTIONS) {
      // An army on the Coast map builds a Naval Yard and queues ships at the catalogue's prices.
      const { s, shore } = coastArena(`fa-nv-${f}`, { factions: [f, f === 'ashen' ? 'meridian' : 'ashen'], heroes: true, generals: true });
      ok(factionOf(s, 0) === f, `${f}: side 0 is ${f}`);
      const st = s.starts![0];
      addBuilding(s, 0, 'factory', Math.round(st.x) + 3, Math.round(st.y) + 3, -100);
      ok(canQueue(s, 0, 'building', 'shipyard'), `${f}: may queue a Naval Yard`);
      const yard = addBuilding(s, 0, 'shipyard', shore.x, shore.y, -100);
      ok(canQueue(s, 0, 'naval', 'gunboat') && costFor(s, 0, 'gunboat') === UNITS.gunboat.cost, `${f}: and a Patrol Boat at ${UNITS.gunboat.cost}`);
      // The field General and the heroes stay ashore; a rifleman and a tank may board.
      const sea = seaNear(s, yard.x + 1.5, yard.y + 1.5);
      const craft = put(s, 0, 'landingcraft', sea.x, sea.y);
      const beach = landNear(s, sea.x, sea.y);
      const general = put(s, 0, 'general', beach.x, beach.y);
      const heroes = HERO_KINDS.map((k, i) => put(s, 0, k, beach.x + 1 + i, beach.y + 1));
      const man = put(s, 0, 'rifleman', beach.x - 1, beach.y);
      const tank = put(s, 0, 'tank', beach.x - 1, beach.y + 1);
      ok(!canRide(general, craft) && !canRide(general), `${f}: the field General never boards a Landing Craft (nor any carrier)`);
      ok(heroes.every(h => !canRide(h, craft)), `${f}: nor does a hero`);
      ok(boardProblem(s, 0, [general.id, ...heroes.map(h => h.id)], craft.id) !== null && processAction(s, { type: 'board', ids: [general.id], carrier: craft.id }) === s,
        `${f}: an order to board the General is refused, the same state back`);
      ok(canRide(man, craft) && canRide(tank, craft) && boardProblem(s, 0, [man.id, tank.id], craft.id) === null, `${f}: a rifleman and a tank may`);
      // Formations are for land units: ships take no part in a squad.
      const boats = [put(s, 0, 'gunboat', sea.x + 1, sea.y), put(s, 0, 'destroyer', sea.x - 1, sea.y)];
      ok(!canFormation(s, 0, boats.map(u => u.id), 'line') && processAction(s, { type: 'formation', ids: boats.map(u => u.id), shape: 'line' }) === s,
        `${f}: two ships cannot form up (the same state back)`);
      ok(!canFormation(s, 0, [boats[0].id, tank.id], 'wedge'), `${f}: nor can one ship and one tank`);
      const mixed = processAction(s, { type: 'move', ids: [man.id, tank.id, ...boats.map(u => u.id)], x: beach.x - 4, y: beach.y + 4, formation: 'box' });
      const squad = mixed.squads?.[mixed.squads.length - 1];
      ok(!!squad && squad.members.length === 2 && squad.members.includes(man.id) && squad.members.includes(tank.id), `${f}: a box of two land units and two ships is a squad of the two land units`);
      ok(boats.every(b => unitIn(mixed, b.id)!.squad === undefined && unitIn(mixed, b.id)!.order.type === 'move'), `${f}: the ships sail, in no squad`);
    }
  });

  // The computer, Ashen against Meridian on the Coast map at Hard with heroes and Generals on, from
  // each seat: its ships never join a wave or a squad, and its General and heroes never go aboard.
  // Whether a given commander gets its Naval Yard up depends on how its battle goes, so the check is
  // that each army's commander does in one of the two battles.
  const yards: Record<Faction, boolean> = { meridian: false, ashen: false };
  let ships = 0;
  let shipInWave = 0;
  let shipInSquad = 0;
  let recruitAboard = 0;
  let squads = 0;
  for (const factions of [['ashen', 'meridian'], ['meridian', 'ashen']] as Faction[][]) {
    const seed = 'fa-nv-ai';
    let s = createInitialState(seed, seed, {
      seed,
      createdAt: 0,
      difficulty: 'hard',
      autopilot: true,
      setup: { map: 'coast', tech: 'advanced', factions, heroes: true, generals: true },
    });
    s.autopilotDifficulty = 'hard';
    while (s.winner === null && s.tick < 18000) {
      s = ticks(s, 50);
      for (const b of s.buildings) if (b.kind === 'shipyard' && b.hp > 0) yards[factionOf(s, b.owner)] = true;
      const waves = new Set(s.ai.flatMap(m => m.waveIds ?? []));
      for (const u of s.units) {
        if (isShip(u)) {
          ships++;
          if (waves.has(u.id)) shipInWave++;
          if (u.squad !== undefined) shipInSquad++;
        }
        for (const r of u.carried ?? []) if (r.kind === 'general' || UNITS[r.kind].hero) recruitAboard++;
      }
      squads += s.squads?.length ?? 0;
    }
  }
  ok(yards.meridian && yards.ashen, `both armies' commanders build a Naval Yard on the Coast map (${FACTIONS.filter(f => yards[f]).join(', ')})`);
  ok(ships > 0 && shipInWave === 0 && shipInSquad === 0, `their ships never join a wave or a squad (${ships} ship-samples)`);
  ok(squads > 0, 'while their land waves do form up');
  ok(recruitAboard === 0, 'and no General or hero is ever aboard a ship or a carrier');
}

// ---- Merge: the naval war's seventh map type and round 6's harness seeds ---------------------------
import { stream, seedFromString } from '../src/sim/rng';
import type { NewGameOptions } from '../src/sim/state';

/** The six map types a 'random' map was drawn from when round 6's checks were written. */
const SIX_TYPES = ['classic', 'river', 'highlands', 'lakes', 'plains', 'canyon'] as const;

/**
 * createInitialState for round 6's checks: a setup with a 'random' (or no) map gets the map type the
 * same seed drew before the naval war added the Coast map to MAP_TYPES (randomMapType's draw over six
 * types), so each check keeps the battlefield it was written and measured on. Nothing else changes.
 */
export function createAsWritten(id: string, name: string, opts: NewGameOptions): GameState {
  if (!opts.setup || (opts.setup.map !== undefined && opts.setup.map !== 'random')) return createInitialState(id, name, opts);
  const seedText = opts.seed && opts.seed.trim() ? opts.seed.trim().slice(0, 64) : `${id}`;
  const r = stream((seedFromString(seedText) ^ 0x5bd1e995) >>> 0);
  r.float();
  const map = SIX_TYPES[Math.floor(r.float() * SIX_TYPES.length)];
  return createInitialState(id, name, { ...opts, setup: { ...opts.setup, map } });
}
