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
  // Meridian's lists are MENUS, in order (every kind of today keeps its place and hotkey), with its
  // one signature item, the Sapper, after Infantry's own (workstream A, section 3 of the contract).
  ok(
    CATEGORIES.every(c => JSON.stringify(menuOf('meridian', c).slice(0, MENUS[c].length)) === JSON.stringify(MENUS[c])),
    'Meridian: every build list is MENUS, in order',
  );
  ok(
    CATEGORIES.every(c => JSON.stringify(menuOf('meridian', c).slice(MENUS[c].length)) === JSON.stringify(FACTION_MENUS.meridian.add?.[c] ?? [])),
    'Meridian: and its own signature items after them, nothing else',
  );
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
  ['Two armies: the Ashen overlay, the new kinds and the menus', overlayAndMenus],
  ['Two armies: signature items belong to their army', signatureItems],
  ['Two armies: aircraft fight by role', aircraftByRole],
  ['Two armies: an Ashen side measured', ashenMeasured],
  ['Two armies: whole battles, Ashen against Meridian from each seat', twoArmyBattles],
  // round6:A end.
];

// ---- Workstream A: two armies ----------------------------------------------------------------

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
  ok(menuOf('ashen', 'air').join() === 'kestrel,firebrand', "Ashen's Air list: Kestrel, Firebrand");
  ok(menuOf('ashen', 'vehicle').join() === [...VEHICLE_MENU, 'raider'].join(), "Ashen's Vehicles: today's, then the Raider Bike");
  ok(menuOf('ashen', 'infantry').join() === INFANTRY_MENU.join() && menuOf('ashen', 'building').join() === BUILD_MENU.join(), "Ashen's Infantry and Structures: today's");
  ok(menuOf('meridian', 'infantry').join() === [...INFANTRY_MENU, 'sapper'].join(), "Meridian's Infantry: today's, then the Sapper");
  ok(menuOf('meridian', 'air').join() === AIR_MENU.join() && menuOf('meridian', 'vehicle') === MENUS.vehicle, "Meridian's Air and Vehicles: today's, the very lists");
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
