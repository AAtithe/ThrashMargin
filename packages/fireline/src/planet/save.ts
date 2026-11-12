/**
 * War for the Planet: the save (fireline-planet-design.md, section 15.1). W3.
 *
 * A whole war in one row of the shared `games` table, beside skirmishes and campaigns, told apart by
 * `kind: 'planet'`. Pure: no clock, no dice, no DOM (the server imports this file too).
 *
 * `migratePlanetSave` follows `migrateCampaignSave`: every field read defensively, unknown values
 * dropped, defaults for anything missing. The geometry is never saved; it is regenerated from the
 * seed text and the options, and a save whose region or faction count disagrees with them is
 * refused (null) rather than silently reshaped. A save this build wrote comes back unchanged, key
 * order included, so a round trip through the server never moves a byte.
 */
import { PERKS, cleanCommander } from '../campaign/progression';
import type { PerkId } from '../campaign/types';
import { migrateState } from '../sim/state';
import {
  BUILDINGS,
  HERO_KINDS,
  LINES,
  MODULES,
  MODULE_SLOTS,
  ORE_LEVELS,
  POWERS,
  UNITS,
  UPGRADE_LINE,
  type BuildingKind,
  type Difficulty,
  type HeroKind,
  type LineId,
  type ModuleId,
  type OreLevel,
  type SupportPower,
  type UnitKind,
  type UpgradeId,
} from '../sim/rules';
import { seedFromString } from '../sim/rng';
import type { AiMode, GameState, Perks } from '../sim/types';
import { planetMapOf } from './map';
import { isUpgrade, isLine } from './research';
import { JOURNAL_MAX, OFFERS_MAX, PAYMENT_MAX, TEMPERAMENT_LIST, TERM_AMOUNT_MAX, TREATY_TERMS_MAX, TREATY_TURNS, isLengthPreset, isPlanetTerrain, normaliseOptions } from './rules';
import { isArmyKind, isInt, newPlanetState, sortTreaties } from './state';
import {
  ARMY_KINDS,
  CITY_BUILDINGS,
  NEUTRAL,
  RESOURCES,
  type BattleSetup,
  type BattleSide,
  type BattleUnit,
  type BuildingLevel,
  type CityBuildingId,
  type CityState,
  type CoreUnit,
  type FactionResearch,
  type FactionState,
  type FieldArmy,
  type JournalEntry,
  type LengthPreset,
  type Offer,
  type PendingBattle,
  type PlanetHero,
  type PlanetResult,
  type PlanetState,
  type RegionState,
  type Resource,
  type Stock,
  type Temperament,
  type TradeRoute,
  type Treaty,
  type TreatyDraft,
  type TreatyKind,
  type TreatyTerm,
} from './types';

export interface PlanetSave {
  version: 1;
  kind: 'planet';
  id: string;
  name: string;            // at most 40 characters
  createdAt: number;
  planet: PlanetState;
  battle: GameState | null; // the battle in progress, when pending[0].fighting
}

/** JSON of the save with `battle: null`. */
export const PLANET_STRATEGIC_MAX_BYTES = 48 * 1024;
/** JSON of the whole save: half the portal's 512 KB. */
export const PLANET_SAVE_MAX_BYTES = 256 * 1024;

/** Longest journal line kept from a save; anything longer is cut. */
const JOURNAL_TEXT_MAX = 400;
/** Most units a field army may hold in any save (the largest preset cap plus Hard's bonus, with room). */
const ARMY_UNITS_MAX = 64;
/** Most units one battle side may list (W1 caps a side at 40; this only guards against junk). */
const SETUP_UNITS_MAX = 120;
const SETUP_STRUCTURES_MAX = 40;

export function isPlanetSave(raw: unknown): raw is PlanetSave {
  return !!raw && typeof raw === 'object' && (raw as { kind?: unknown }).kind === 'planet';
}

// ---- Small readers -----------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o: object, k: unknown): boolean => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
/** A non-negative integer, clamped to max; anything else is the fallback. */
const count = (v: unknown, fallback: number, max = 1e9) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : fallback);
const intIn = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fallback;

const isResource = (v: unknown): v is Resource => typeof v === 'string' && (RESOURCES as string[]).includes(v);
const isCityBuilding = (v: unknown): v is CityBuildingId => typeof v === 'string' && (CITY_BUILDINGS as string[]).includes(v);
const isHero = (v: unknown): v is HeroKind => typeof v === 'string' && (HERO_KINDS as string[]).includes(v);
const isOre = (v: unknown): v is OreLevel => own(ORE_LEVELS, v);
const isBuilding = (v: unknown): v is BuildingKind => own(BUILDINGS, v);
const isPower = (v: unknown): v is SupportPower => own(POWERS, v);
const isModule = (v: unknown): v is ModuleId => own(MODULES, v);
const isUnitKind = (v: unknown): v is UnitKind => own(UNITS, v);
const isDifficulty = (v: unknown): v is Difficulty => v === 'easy' || v === 'normal' || v === 'hard';
const isAiMode = (v: unknown): v is AiMode => v === 'normal' || v === 'defend' || v === 'raid' || v === 'passive';
const isTemperament = (v: unknown): v is Temperament => typeof v === 'string' && (TEMPERAMENT_LIST as string[]).includes(v);
const isTreatyKind = (v: unknown): v is TreatyKind => v === 'ceasefire' || v === 'trade' || v === 'alliance';

function cleanStock(raw: unknown): Stock {
  const r = isObj(raw) ? raw : {};
  return { ore: count(r.ore, 0), fuel: count(r.fuel, 0), alloys: count(r.alloys, 0), food: count(r.food, 0) };
}

function cleanBuildings(raw: unknown): Partial<Record<CityBuildingId, BuildingLevel>> {
  const out: Partial<Record<CityBuildingId, BuildingLevel>> = {};
  if (!isObj(raw)) return out;
  for (const k of Object.keys(raw)) {
    if (!isCityBuilding(k)) continue;
    const v = raw[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const l = Math.round(v);
    if (l >= 1) out[k] = Math.min(3, l) as BuildingLevel;
  }
  return out;
}

function cleanUpgrades(raw: unknown): UpgradeId[] {
  if (!Array.isArray(raw)) return [];
  const out: UpgradeId[] = [];
  for (const u of raw) if (isUpgrade(u) && !out.includes(u)) out.push(u);
  return out;
}

function cleanDoctrines(raw: unknown): Partial<Record<LineId, UpgradeId>> {
  const out: Partial<Record<LineId, UpgradeId>> = {};
  if (!isObj(raw)) return out;
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (isLine(k) && isUpgrade(v) && LINES[k].fork.includes(v)) out[k] = v;
  }
  return out;
}

function cleanLoadouts(raw: unknown): Partial<Record<UnitKind, ModuleId[]>> {
  const out: Partial<Record<UnitKind, ModuleId[]>> = {};
  if (!isObj(raw)) return out;
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (!isUnitKind(k) || !Array.isArray(v)) continue;
    const slots = MODULE_SLOTS[k];
    if (!slots || UNITS[k].hero) continue;
    const mods: ModuleId[] = [];
    for (const m of v) if (isModule(m) && !mods.includes(m) && MODULES[m].fits.includes(k)) mods.push(m);
    out[k] = mods.slice(0, slots);
  }
  return out;
}

// ---- Regions and factions ----------------------------------------------------------------------

function cleanRegion(raw: unknown, factions: number): RegionState {
  const r = isObj(raw) ? raw : {};
  const owner = isInt(r.owner, NEUTRAL, factions - 1) ? r.owner : NEUTRAL;
  const c = isObj(r.city) ? r.city : {};
  const city: CityState = {
    level: intIn(c.level, 1, 5, 1) as CityState['level'],
    b: cleanBuildings(c.b),
    built: typeof c.built === 'number' && Number.isFinite(c.built) ? Math.max(-1, Math.floor(c.built)) : -1,
  };
  const g = Array.isArray(r.garrison) ? r.garrison : [];
  const garrison = ARMY_KINDS.map((_, i) => count(g[i], 0, 999));
  return { owner, city, garrison, cut: count(r.cut, 0, 999) };
}

function cleanCoreUnits(raw: unknown, max: number): CoreUnit[] {
  if (!Array.isArray(raw)) return [];
  const out: CoreUnit[] = [];
  for (const u of raw) {
    if (out.length >= max) break;
    if (isObj(u) && isArmyKind(u.kind)) out.push({ kind: u.kind, kills: count(u.kills, 0, 999) });
  }
  return out;
}

function cleanArmy(raw: unknown, regions: number): FieldArmy | null {
  if (!isObj(raw) || !isInt(raw.region, 0, regions - 1)) return null;
  return {
    region: raw.region,
    units: cleanCoreUnits(raw.units, ARMY_UNITS_MAX),
    moved: count(raw.moved, 0, 99),
    attacked: raw.attacked === true,
  };
}

function cleanResearch(raw: unknown): FactionResearch {
  const r = isObj(raw) ? raw : {};
  const done = cleanUpgrades(r.done).filter(u => UPGRADE_LINE[u]);
  const current = isUpgrade(r.current) && UPGRADE_LINE[r.current] && !done.includes(r.current) ? r.current : null;
  return {
    current,
    points: current === null ? 0 : count(r.points, 0),
    done,
    doctrines: cleanDoctrines(r.doctrines),
    loadouts: cleanLoadouts(r.loadouts),
  };
}

function cleanFaction(raw: unknown, f: number, regions: number, fallback: FactionState): FactionState {
  const r = isObj(raw) ? raw : {};
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : fallback.name;
  const temperament: Temperament | null = f === 0 ? null : isTemperament(r.temperament) ? r.temperament : fallback.temperament;
  return {
    id: f,
    name,
    temperament,
    alive: typeof r.alive === 'boolean' ? r.alive : true,
    capital: isInt(r.capital, 0, regions - 1) ? r.capital : fallback.capital,
    stock: cleanStock(r.stock),
    research: cleanResearch(r.research),
    army: cleanArmy(r.army, regions),
  };
}

function cleanTrust(raw: unknown, F: number): number[][] {
  const rows = Array.isArray(raw) ? raw : [];
  const out: number[][] = [];
  for (let a = 0; a < F; a++) {
    const row = Array.isArray(rows[a]) ? (rows[a] as unknown[]) : [];
    out.push(Array.from({ length: F }, (_, b) => (a === b ? 100 : intIn(row[b], 0, 100, 50))));
  }
  return out;
}

// ---- Treaties, routes and offers ---------------------------------------------------------------

/**
 * A term, structurally checked against the two signatories. Live conditions (a payment being
 * affordable, a split naming a third party's region) are checked when a draft is offered or
 * accepted, not here: a treaty in force has already been paid and split.
 */
function cleanTerm(raw: unknown, a: number, b: number, kind: TreatyKind, regions: number): TreatyTerm | null {
  if (!isObj(raw)) return null;
  const sig = (f: unknown): f is number => f === a || f === b;
  switch (raw.k) {
    case 'tribute':
      return sig(raw.from) && isResource(raw.res) && isInt(raw.amount, 1, TERM_AMOUNT_MAX)
        ? { k: 'tribute', from: raw.from, res: raw.res, amount: raw.amount }
        : null;
    case 'exchange':
      if (kind === 'ceasefire' || !sig(raw.from) || !isResource(raw.give) || !isResource(raw.get) || raw.give === raw.get) return null;
      if (!isInt(raw.giveAmount, 1, TERM_AMOUNT_MAX) || !isInt(raw.getAmount, 1, TERM_AMOUNT_MAX)) return null;
      return { k: 'exchange', from: raw.from, give: raw.give, giveAmount: raw.giveAmount, get: raw.get, getAmount: raw.getAmount };
    case 'access':
      return sig(raw.grantor) ? { k: 'access', grantor: raw.grantor } : null;
    case 'split': {
      if (!Array.isArray(raw.regions) || raw.regions.length < 1 || raw.regions.length > 4) return null;
      const out: [number, number][] = [];
      for (const e of raw.regions) {
        if (!Array.isArray(e) || e.length !== 2) return null;
        const [r, to] = e as unknown[];
        if (!isInt(r, 0, regions - 1) || !sig(to) || out.some(x => x[0] === r)) return null;
        out.push([r, to]);
      }
      return { k: 'split', regions: out };
    }
    case 'payment':
      return sig(raw.from) && isResource(raw.res) && isInt(raw.amount, 1, PAYMENT_MAX)
        ? { k: 'payment', from: raw.from, res: raw.res, amount: raw.amount }
        : null;
    default:
      return null;
  }
}

/** A draft between a and b, or null if any part of it is malformed (a bad term spoils the treaty). */
function cleanDraftOf(raw: unknown, a: number, b: number, regions: number): TreatyDraft | null {
  if (!isObj(raw) || !isTreatyKind(raw.kind)) return null;
  const kind = raw.kind;
  const lim = TREATY_TURNS[kind];
  let turns: number | null;
  if (raw.turns === null) {
    if (!lim.open) return null;
    turns = null;
  } else if (isInt(raw.turns, 1, 999)) turns = raw.turns;
  else return null;
  if (!Array.isArray(raw.terms) || raw.terms.length > TREATY_TERMS_MAX) return null;
  const terms: TreatyTerm[] = [];
  const grantors: number[] = [];
  for (const t of raw.terms) {
    const c = cleanTerm(t, a, b, kind, regions);
    if (!c) return null;
    if (c.k === 'access') {
      if (grantors.includes(c.grantor)) return null;
      grantors.push(c.grantor);
    }
    terms.push(c);
  }
  return { kind, turns, terms };
}

function cleanTreaties(raw: unknown, F: number, regions: number): Treaty[] {
  if (!Array.isArray(raw)) return [];
  const out: Treaty[] = [];
  for (const t of raw) {
    if (!isObj(t) || !isInt(t.a, 0, F - 1) || !isInt(t.b, 0, F - 1) || t.a >= t.b) continue;
    if (out.some(x => x.a === t.a && x.b === t.b)) continue;
    const dr = cleanDraftOf(t, t.a, t.b, regions);
    if (!dr || !isInt(t.since, 0, 1e6)) continue;
    let ends: number | null;
    if (t.ends === null) ends = null;
    else if (isInt(t.ends, 0, 1e6)) ends = t.ends;
    else continue;
    out.push({ ...dr, a: t.a, b: t.b, since: t.since, ends });
  }
  return sortTreaties(out);
}

function cleanRoutes(raw: unknown, F: number, regions: number): TradeRoute[] {
  if (!Array.isArray(raw)) return [];
  const out: TradeRoute[] = [];
  for (const r of raw) {
    if (!isObj(r) || !isInt(r.id, 0, 1e9) || !isInt(r.owner, 0, F - 1)) continue;
    if (!isInt(r.from, 0, regions - 1) || !isInt(r.to, 0, regions - 1) || r.from === r.to) continue;
    if (out.some(x => x.id === r.id)) continue;
    out.push({ id: r.id, owner: r.owner, from: r.from, to: r.to });
  }
  return out;
}

function cleanOffers(raw: unknown, F: number, regions: number): Offer[] {
  if (!Array.isArray(raw)) return [];
  const out: Offer[] = [];
  for (const o of raw) {
    if (out.length >= OFFERS_MAX) break;
    if (!isObj(o) || !isInt(o.id, 0, 1e9) || !isInt(o.from, 1, F - 1) || !isInt(o.expires, 0, 1e6)) continue;
    if (out.some(x => x.id === o.id)) continue;
    const draft = cleanDraftOf(o.draft, o.from, 0, regions);
    if (!draft) continue;
    out.push({ id: o.id, from: o.from, draft, expires: o.expires });
  }
  return out;
}

// ---- Pending battles ---------------------------------------------------------------------------

function cleanBattleUnits(raw: unknown): BattleUnit[] | null {
  if (!Array.isArray(raw) || raw.length > SETUP_UNITS_MAX) return null;
  const out: BattleUnit[] = [];
  const cores = new Set<number>();
  for (const u of raw) {
    if (!isObj(u) || !isArmyKind(u.kind) || !isInt(u.kills, 0, 999)) return null;
    if (u.core !== null) {
      if (!isInt(u.core, 0, 999) || cores.has(u.core)) return null;
      cores.add(u.core);
    }
    out.push({ kind: u.kind, kills: u.kills, core: u.core as number | null });
  }
  return out;
}

function cleanSide(raw: unknown, F: number, regions: number): BattleSide | null {
  if (!isObj(raw)) return null;
  const r = raw;
  if (!isInt(r.faction, NEUTRAL, F - 1)) return null;
  if (r.role !== 'attacker' && r.role !== 'defender' && r.role !== 'ally') return null;
  if (r.team !== 0 && r.team !== 1) return null;
  if (typeof r.human !== 'boolean') return null;
  if (!Array.isArray(r.structures) || r.structures.length < 1 || r.structures.length > SETUP_STRUCTURES_MAX) return null;
  if (r.structures[0] !== 'hq' || !r.structures.every(isBuilding)) return null;
  if (!Array.isArray(r.cityTags) || r.cityTags.length !== r.structures.length) return null;
  if (!r.cityTags.every(t => t === null || isCityBuilding(t))) return null;
  if (!isInt(r.credits, 0, 1e6)) return null;
  const units = cleanBattleUnits(r.units);
  if (!units) return null;
  if (!Array.isArray(r.heroes) || r.heroes.length > HERO_KINDS.length) return null;
  const heroes: BattleSide['heroes'] = [];
  for (const h of r.heroes) {
    if (!isObj(h) || !isHero(h.kind) || heroes.some(x => x.kind === h.kind)) return null;
    if (!isInt(h.xp, 0, 1e7) || typeof h.wounded !== 'boolean') return null;
    heroes.push({ kind: h.kind, xp: h.xp, wounded: h.wounded });
  }
  if (!isAiMode(r.ai)) return null;
  if (r.fromRegion !== null && !isInt(r.fromRegion, 0, regions - 1)) return null;
  return {
    faction: r.faction,
    role: r.role,
    team: r.team,
    human: r.human,
    structures: (r.structures as BuildingKind[]).slice(),
    cityTags: (r.cityTags as (CityBuildingId | null)[]).slice(),
    credits: r.credits,
    units,
    heroes,
    upgrades: cleanUpgrades(r.upgrades),
    doctrines: cleanDoctrines(r.doctrines),
    loadouts: cleanLoadouts(r.loadouts),
    ai: r.ai,
    fromRegion: r.fromRegion as number | null,
  };
}

const PERK_KEYS: (keyof Perks)[] = ['harvestMul', 'buildSpeedMul', 'costMul', 'unitHpMul', 'powerCooldownMul', 'extraStartCredits'];

function cleanPerks(raw: unknown): Perks | null | undefined {
  if (raw === null) return null;
  if (!isObj(raw)) return undefined;
  const out = {} as Perks;
  for (const k of PERK_KEYS) {
    const v = raw[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10000) return undefined;
    out[k] = v;
  }
  return out;
}

/** A frozen battle setup, checked whole; null when any part of it is malformed. */
function cleanSetup(raw: unknown, F: number, regions: number): BattleSetup | null {
  if (!isObj(raw)) return null;
  const r = raw;
  if (!isInt(r.battleId, 0, 1e9) || !isInt(r.turn, 0, 1e6) || !isInt(r.region, 0, regions - 1)) return null;
  if (typeof r.regionName !== 'string' || typeof r.seedText !== 'string' || r.seedText.length > 200) return null;
  if (!isPlanetTerrain(r.mapType) || !isOre(r.ore) || !isDifficulty(r.difficulty)) return null;
  if (!Array.isArray(r.sides) || r.sides.length < 2 || r.sides.length > 4) return null;
  const sides: BattleSide[] = [];
  for (const x of r.sides) {
    const side = cleanSide(x, F, regions);
    if (!side) return null;
    sides.push(side);
  }
  // The shape battleSetupFor makes: one attacker (a faction, team 0), one defender (team 1, at the
  // defender seat), allies that are factions, every faction once. The player's side is human unless
  // it is an ally, and a human side sits at seat 0.
  const atk = sides.filter(x => x.role === 'attacker');
  const def = sides.filter(x => x.role === 'defender');
  if (atk.length !== 1 || def.length !== 1 || atk[0].faction === NEUTRAL || atk[0].team !== 0 || def[0].team !== 1) return null;
  if (!isInt(r.defenderSeat, 0, sides.length - 1) || sides[r.defenderSeat] !== def[0]) return null;
  if (sides.some(x => x.role === 'ally' && (x.faction === NEUTRAL || x.fromRegion === null))) return null;
  if (sides.some((x, i) => sides.findIndex(y => y.faction === x.faction) !== i)) return null;
  if (sides.some((x, i) => x.human !== (x.faction === 0 && x.role !== 'ally') || (x.human && i !== 0))) return null;
  if (!isInt(r.timeLimit, 1, 1e7) || !isInt(r.cityLevel, 1, 5)) return null;
  const perks = cleanPerks(r.perks);
  if (perks === undefined) return null;
  if (!Array.isArray(r.powers) || !r.powers.every(isPower)) return null;
  return {
    battleId: r.battleId,
    turn: r.turn,
    region: r.region,
    regionName: r.regionName.slice(0, 80),
    seedText: r.seedText,
    mapType: r.mapType,
    ore: r.ore,
    difficulty: r.difficulty,
    sides,
    defenderSeat: r.defenderSeat,
    timeLimit: r.timeLimit,
    cityLevel: r.cityLevel,
    cityBuildings: cleanBuildings(r.cityBuildings),
    perks,
    powers: (r.powers as SupportPower[]).filter((p, i, a) => a.indexOf(p) === i),
    // Section 9.7: absent (a standard map) on every setup made before larger maps, and kept so.
    ...(r.mapSize === 'large' || r.mapSize === 'huge' ? { mapSize: r.mapSize } : {}),
  };
}

function cleanPending(raw: unknown, F: number, regions: number): PendingBattle[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingBattle[] = [];
  for (const p of raw) {
    if (!isObj(p) || !isInt(p.id, 0, 1e9) || out.some(x => x.id === p.id)) continue;
    if (p.kind !== 'attack' && p.kind !== 'defence') continue;
    if (!isInt(p.region, 0, regions - 1) || !isInt(p.attacker, 0, F - 1) || !isInt(p.defender, NEUTRAL, F - 1)) continue;
    const setup = cleanSetup(p.setup, F, regions);
    if (!setup || setup.battleId !== p.id || setup.region !== p.region) continue;
    const atkFaction = setup.sides.find(x => x.role === 'attacker')!.faction;
    if (atkFaction !== p.attacker || setup.sides[setup.defenderSeat].faction !== p.defender) continue;
    // Only the first pending battle can be the one being fought.
    out.push({ id: p.id, kind: p.kind, region: p.region, attacker: p.attacker, defender: p.defender, setup, fighting: out.length === 0 && p.fighting === true });
  }
  return out;
}

// ---- The rest of the state ---------------------------------------------------------------------

function cleanJournal(raw: unknown, F: number): JournalEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: JournalEntry[] = [];
  for (const e of raw) {
    if (!isObj(e) || !isInt(e.turn, 0, 1e6) || typeof e.text !== 'string') continue;
    const tone: JournalEntry['tone'] = e.tone === 'good' || e.tone === 'bad' ? e.tone : 'info';
    const entry: JournalEntry = { turn: e.turn, text: e.text.slice(0, JOURNAL_TEXT_MAX), tone };
    if (isInt(e.f, 0, F - 1)) entry.f = e.f;
    out.push(entry);
  }
  return out.slice(-JOURNAL_MAX);
}

const RESULT_HOWS: PlanetResult['how'][] = ['domination', 'elimination', 'alliance', 'turnLimit', 'fallen', 'rival'];

function cleanResult(raw: unknown): PlanetResult | null {
  if (!isObj(raw) || typeof raw.won !== 'boolean' || !RESULT_HOWS.includes(raw.how as PlanetResult['how'])) return null;
  if (!isInt(raw.turn, 1, 1e6)) return null;
  return { won: raw.won, how: raw.how as PlanetResult['how'], turn: raw.turn };
}

function cleanHeroes(raw: unknown, fallback: Record<HeroKind, PlanetHero>): Record<HeroKind, PlanetHero> {
  const r = isObj(raw) ? raw : {};
  const out = {} as Record<HeroKind, PlanetHero>;
  for (const k of HERO_KINDS) {
    const h = isObj(r[k]) ? (r[k] as Obj) : null;
    out[k] = h
      ? { unlocked: h.unlocked === true, xp: count(h.xp, 0, 1e7), wounded: h.wounded === true, lost: h.lost === true }
      : { ...fallback[k] };
  }
  return out;
}

function cleanCommanderRecord(raw: unknown, fallbackName: string): PlanetState['commander'] {
  const c = isObj(raw) ? raw : {};
  const perks: Partial<Record<PerkId, number>> = {};
  const rawPerks = isObj(c.perks) ? c.perks : {};
  for (const p of PERKS) {
    const l = count(rawPerks[p.id], 0);
    if (l > 0) perks[p.id] = Math.min(l, p.maxLevel);
  }
  return {
    name: cleanCommander(typeof c.name === 'string' ? c.name : fallbackName),
    xp: count(c.xp, 0, 1e9),
    points: count(c.points, 0, 999),
    perks,
  };
}

/**
 * A planet state from a save, made current; null when it cannot be trusted at all (no seed text,
 * or region and faction counts that disagree with the regenerated map).
 */
export function migratePlanetState(raw: unknown): PlanetState | null {
  if (!isObj(raw)) return null;
  const r = raw;
  if (r.version !== undefined && r.version !== 1) return null;
  if (typeof r.seedText !== 'string' || !r.seedText || r.seedText.length > 64) return null;
  const seedText = r.seedText;
  const rawOptions = isObj(r.options) ? r.options : {};
  const preset: LengthPreset = isLengthPreset(rawOptions.preset) ? rawOptions.preset : 'short';
  const options = normaliseOptions(rawOptions, preset);
  const m = planetMapOf({ seedText, options });
  const R = m.regions.length;
  const F = options.factions;
  if (R !== options.regions) return null;
  if (!Array.isArray(r.regions) || r.regions.length !== R) return null;
  if (!Array.isArray(r.factions) || r.factions.length !== F) return null;
  const difficulty: Difficulty = isDifficulty(r.difficulty) ? r.difficulty : 'normal';
  const createdAt = num(r.createdAt, 0);

  // Defaults for anything missing come from the war this seed would have started.
  const fresh = newPlanetState({ seedText, preset, options, difficulty, commander: 'Commander', createdAt });

  const rawRegions = r.regions;
  const rawFactions = r.factions;
  // Array.from, not map: map skips holes in a sparse array and would leave them in the state.
  const regions = Array.from({ length: R }, (_, i) => cleanRegion(rawRegions[i], F));
  const factions = Array.from({ length: F }, (_, f) => cleanFaction(rawFactions[f], f, R, fresh.factions[f]));

  const routes = cleanRoutes(r.routes, F, R);
  const offers = cleanOffers(r.offers, F, R);
  const pending = cleanPending(r.pending, F, R);
  let nextId = count(r.nextId, 1);
  for (const x of [...routes, ...offers, ...pending]) nextId = Math.max(nextId, x.id + 1);
  nextId = Math.max(1, nextId);

  const turn = count(r.turn, 1, 1e6) || 1;
  const result = cleanResult(r.result);

  return {
    version: 1,
    seedText,
    rngSeed: isInt(r.rngSeed, 0, 0xffffffff) ? r.rngSeed : seedFromString(seedText + ':war'),
    createdAt,
    options,
    difficulty,
    turn,
    regions,
    factions,
    trust: cleanTrust(r.trust, F),
    treaties: cleanTreaties(r.treaties, F, R),
    routes,
    offers,
    pending: result ? [] : pending,
    commander: cleanCommanderRecord(r.commander, 'Commander'),
    heroes: cleanHeroes(r.heroes, fresh.heroes),
    nextId,
    journal: cleanJournal(r.journal, F),
    result,
    // Section 9.7: a war saved without it is on battle rules 1 (standard maps) for good.
    ...(r.battleRules === 2 ? { battleRules: 2 as const } : {}),
  };
}

/** The battle in progress, kept only when it belongs to the first pending battle and is being fought. */
function cleanBattle(raw: unknown, p: PlanetState): GameState | null {
  const pb = p.pending[0];
  if (!pb || !pb.fighting || !raw) return null;
  const g = migrateState(raw);
  if (!g || !g.planet || g.planet.battleId !== pb.id || g.players.length !== pb.setup.sides.length) return null;
  return g;
}

/** A save from any build, made current; null if it is not a war or cannot be trusted. */
export function migratePlanetSave(raw: unknown): PlanetSave | null {
  if (!isPlanetSave(raw)) return null;
  const s = raw as unknown as Obj;
  if (s.version !== undefined && s.version !== 1) return null;
  if (typeof s.id !== 'string' || !s.id || s.id.length > 64) return null;
  const planet = migratePlanetState(s.planet);
  if (!planet) return null;
  const name = typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 40) : 'War';
  const battle = cleanBattle(s.battle, planet);
  // A battle that was being fought but whose state is gone or broken goes back to the choice.
  if (!battle && planet.pending[0]?.fighting) planet.pending[0] = { ...planet.pending[0], fighting: false };
  return {
    version: 1,
    kind: 'planet',
    id: s.id,
    name,
    createdAt: num(s.createdAt, planet.createdAt),
    planet,
    battle,
  };
}

export function newPlanetSave(id: string, name: string, p: Parameters<typeof newPlanetState>[0]): PlanetSave {
  const planet = newPlanetState(p);
  return {
    version: 1,
    kind: 'planet',
    id,
    name: (typeof name === 'string' ? name : '').trim().slice(0, 40) || 'War',
    createdAt: planet.createdAt,
    planet,
    battle: null,
  };
}

/** What the saves list shows: the war's state. */
export function planetSaveStatus(s: PlanetSave): 'active' | 'victory' | 'defeated' {
  const r = s.planet.result;
  return !r ? 'active' : r.won ? 'victory' : 'defeated';
}

/** The strategic turn, for the saves list's `turn` column. */
export function planetSaveTurn(s: PlanetSave): number {
  return s.planet.turn;
}

/** Sizes in characters of JSON: the strategic part (battle left out) and the whole save. */
export function planetSaveBytes(s: PlanetSave): { strategic: number; total: number } {
  const total = JSON.stringify(s).length;
  const strategic = s.battle ? JSON.stringify({ ...s, battle: null }).length : total;
  return { strategic, total };
}

/**
 * True when the whole save is over PLANET_SAVE_MAX_BYTES, the same test the server makes (413).
 * The client refuses such a save instead of sending it. The 48 KB strategic budget is a harness
 * assertion, not a refusal: refusing a save loses the player's progress, so only the limit the
 * server enforces is enforced here.
 */
export function planetSaveTooLarge(s: PlanetSave): boolean {
  return JSON.stringify(s).length > PLANET_SAVE_MAX_BYTES;
}

/** For the server's create call: a preset from untrusted input, else Short. */
export const readPreset = (v: unknown): LengthPreset => (isLengthPreset(v) ? v : 'short');
