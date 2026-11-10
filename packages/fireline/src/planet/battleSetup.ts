/**
 * War for the Planet: who fights and what each side brings (fireline-planet-design.md, sections
 * 9.2 to 9.4). W1. The setup is frozen into the pending battle; W2 builds and judges the battle
 * from it alone. Pure.
 */
import { HERO_KINDS, TICKS_PER_SECOND, type BuildingKind, type HeroKind } from '../sim/rules';
import { newCampaign, perkModifiers, POWER_PERKS } from '../campaign/progression';
import { cityStructures } from './cities';
import { armyCounts } from './economy';
import { hopsFrom, planetMapOf } from './map';
import { ATTACK_CREDITS, DEFENCE_TERRAIN, SIDE_UNITS_MAX, structureValue, unitValue, vetMul } from './rules';
import { aliveFaction, allied, atWar, garrisonUnits } from './state';
import { hasPort } from './supply';
import {
  ARMY_KINDS,
  NEUTRAL,
  type BattleSetup,
  type BattleSide,
  type BattleUnit,
  type CityBuildingId,
  type CoreUnit,
  type FactionId,
  type PlanetState,
  type RegionId,
  type RegionOwner,
  type Stock,
} from './types';

// ---- Strength (section 9.4) -------------------------------------------------------------------

export function strengthOf(units: BattleUnit[] | CoreUnit[]): number {
  let t = 0;
  for (const u of units as { kind: CoreUnit['kind']; kills: number }[]) t += unitValue(u.kind) * vetMul(u.kills);
  return t;
}

export function garrisonStrength(g: number[]): number {
  let t = 0;
  g.forEach((n, i) => (t += n * unitValue(ARMY_KINDS[i])));
  return t;
}

/** P(f): all f's garrisons plus its field army, without modifiers. */
export function power(s: PlanetState, f: FactionId): number {
  let t = 0;
  for (const r of s.regions) if (r.owner === f) t += garrisonStrength(r.garrison);
  const army = s.factions[f]?.army;
  if (army) t += strengthOf(army.units);
  return t;
}

// ---- Legality (section 9.2) -------------------------------------------------------------------

/** Fuel and alloys an attack costs: fuel 2 + ceil(vehicles / 4), alloys credits / 250. */
export function attackCost(s: PlanetState, f: FactionId, credits: number): Stock {
  const army = s.factions[f]?.army;
  const v = army ? armyCounts(army.units).vehicles : 0;
  return { ore: 0, fuel: 2 + Math.ceil(v / 4), alloys: Math.floor(credits / 250), food: 0 };
}

/** True when a split term of a treaty of f's assigns r to f's partner. */
export function splitProtected(s: PlanetState, f: FactionId, r: RegionId): boolean {
  return s.treaties.some(t => (t.a === f || t.b === f) && t.terms.some(x => x.k === 'split' && x.regions.some(([reg, to]) => reg === r && to !== f && (to === t.a || to === t.b))));
}

/** Why f's army cannot attack target from region `from` (the army's region unless given), or null. Stock not checked. */
export function targetProblem(s: PlanetState, f: FactionId, target: RegionId, from?: RegionId): string | null {
  const fac = s.factions[f];
  if (!fac || !fac.alive) return 'That faction is out of the war.';
  const army = fac.army;
  if (!army) return 'There is no field army.';
  if (army.attacked) return 'The field army has already attacked this turn.';
  if (!army.units.length) return 'The field army has no units.';
  const reg = s.regions[target];
  if (!reg) return 'There is no such region.';
  const owner = reg.owner;
  if (owner === f) return 'You hold that region.';
  if (owner !== NEUTRAL && !atWar(s, f, owner)) return `You are not at war with ${s.factions[owner].name}.`;
  const at = from ?? army.region;
  if (s.regions[at]?.owner !== f) return 'The field army must stand in a region you hold.';
  const link = planetMapOf(s).regions[at].links.find(l => l.to === target);
  if (!link) return 'The field army is not next to that region.';
  if (link.sea && !hasPort(s, at)) return 'Attacking across the sea needs a port where the army stands.';
  if (splitProtected(s, f, target)) return 'A treaty assigns that region to your partner. Cancel the treaty first.';
  if (s.pending.length) return 'Resolve the pending battle first.';
  return null;
}

/** Regions f's field army may attack from where it stands (ignoring stock). */
export function attackTargets(s: PlanetState, f: FactionId): RegionId[] {
  const army = s.factions[f]?.army;
  if (!army) return [];
  return attackTargetsFrom(s, f, army.region);
}

export function attackTargetsFrom(s: PlanetState, f: FactionId, from: RegionId): RegionId[] {
  const g = planetMapOf(s).regions[from];
  if (!g) return [];
  return g.links.map(l => l.to).filter(t => targetProblem(s, f, t, from) === null);
}

export function heroesProblem(s: PlanetState, attacker: FactionId, heroes: unknown): string | null {
  if (!Array.isArray(heroes)) return 'Bad hero list.';
  if (attacker !== 0 && heroes.length) return 'Only the player has heroes.';
  if (heroes.length > s.options.heroesPerBattle) return `At most ${s.options.heroesPerBattle} heroes may join one battle.`;
  for (let i = 0; i < heroes.length; i++) {
    const h = heroes[i] as HeroKind;
    if (!HERO_KINDS.includes(h) || heroes.indexOf(h) !== i) return 'Bad hero list.';
    if (!s.heroes[h].unlocked) return 'That hero has not joined you yet.';
    if (s.heroes[h].lost) return 'That hero is lost.';
  }
  return null;
}

// ---- Sides (section 9.3) ----------------------------------------------------------------------

const research = (s: PlanetState, f: RegionOwner) =>
  f === NEUTRAL
    ? { upgrades: [], doctrines: {}, loadouts: {} }
    : {
        upgrades: [...s.factions[f].research.done],
        doctrines: { ...s.factions[f].research.doctrines },
        loadouts: Object.fromEntries(Object.entries(s.factions[f].research.loadouts).map(([k, v]) => [k, [...(v ?? [])]])),
      };

const garrisonBattleUnits = (g: number[]): BattleUnit[] => garrisonUnits(g).map(kind => ({ kind, kills: 0, core: null }));
const coreBattleUnits = (units: CoreUnit[]): BattleUnit[] => units.map((u, i) => ({ kind: u.kind, kills: u.kills, core: i }));

/** At most SIDE_UNITS_MAX: garrison units are dropped before core units. */
function capUnits(garrison: BattleUnit[], core: BattleUnit[]): BattleUnit[] {
  const room = Math.max(0, SIDE_UNITS_MAX - core.length);
  return [...garrison.slice(0, room), ...core.slice(0, SIDE_UNITS_MAX)];
}

/** The ally contingent: half (at least 1) of its linked region with most units, taken alternately in ARMY_KINDS order. */
export function contingentOf(s: PlanetState, ally: FactionId, target: RegionId): { region: RegionId; units: BattleUnit[] } | null {
  let best = -1;
  let most = 0;
  for (const l of planetMapOf(s).regions[target].links) {
    const reg = s.regions[l.to];
    if (reg.owner !== ally) continue;
    const n = reg.garrison.reduce((t, x) => t + x, 0);
    if (n > most) {
      most = n;
      best = l.to;
    }
  }
  if (best < 0) return null;
  const all = garrisonUnits(s.regions[best].garrison);
  const n = Math.max(1, Math.floor(all.length / 2));
  const picked: BattleUnit[] = [];
  for (let i = 0; i < all.length && picked.length < n; i += 2) picked.push({ kind: all[i], kills: 0, core: null });
  for (let i = 1; i < all.length && picked.length < n; i += 2) picked.push({ kind: all[i], kills: 0, core: null });
  return { region: best, units: picked };
}

function allyFor(s: PlanetState, principal: FactionId, enemy: RegionOwner, target: RegionId, exclude: number[]): FactionId | null {
  const links = planetMapOf(s).regions[target].links;
  let best: FactionId | null = null;
  for (const f of s.factions) {
    if (!f.alive || exclude.includes(f.id)) continue;
    if (!allied(s, f.id, principal)) continue;
    if (enemy !== NEUTRAL && !atWar(s, f.id, enemy)) continue;
    if (!links.some(l => s.regions[l.to].owner === f.id)) continue;
    if (!contingentOf(s, f.id, target)) continue;
    if (best === null || s.trust[f.id][principal] > s.trust[best][principal]) best = f.id;
  }
  return best;
}

function perksFor(s: PlanetState): Pick<BattleSetup, 'perks' | 'powers'> {
  const c = { ...newCampaign(s.commander.name), commander: { ...s.commander, perks: { ...s.commander.perks } } };
  return { perks: perkModifiers(c), powers: POWER_PERKS.filter(p => (s.commander.perks[p.perk] ?? 0) > 0).map(p => p.power) };
}

function ownsAirfieldNear(s: PlanetState, f: FactionId, target: RegionId): boolean {
  const d = hopsFrom(planetMapOf(s), [target]);
  return s.regions.some((r, i) => r.owner === f && (r.city.b.airfield ?? 0) > 0 && d[i] <= 2);
}

/**
 * The setup of f attacking target, or null when the attack is not legal now (stock included).
 * `credits` is one of 0, 1000, 2000, 3000; `heroes` the player's chosen heroes (empty for others).
 */
export function battleSetupFor(s: PlanetState, attacker: FactionId, target: RegionId, credits: number, heroes: HeroKind[], battleId: number): BattleSetup | null {
  if (s.result || !aliveFaction(s, attacker)) return null;
  if (!(ATTACK_CREDITS as readonly number[]).includes(credits)) return null;
  if (typeof target !== 'number' || !s.regions[target]) return null;
  if (targetProblem(s, attacker, target)) return null;
  if (heroesProblem(s, attacker, heroes)) return null;
  const fac = s.factions[attacker];
  const cost = attackCost(s, attacker, credits);
  if (fac.stock.fuel < cost.fuel || fac.stock.alloys < cost.alloys) return null;

  const m = planetMapOf(s);
  const geo = m.regions[target];
  const reg = s.regions[target];
  const defender = reg.owner;
  const army = fac.army!;

  // Attacker principal.
  const atkStructures: BuildingKind[] = ['hq', 'power', 'power', 'refinery', 'barracks', 'factory'];
  if (ownsAirfieldNear(s, attacker, target)) atkStructures.push('helipad');
  const atk: BattleSide = {
    faction: attacker,
    role: 'attacker',
    team: 0,
    human: attacker === 0,
    structures: atkStructures,
    cityTags: atkStructures.map(() => null),
    credits: 2500 + credits + 300 * (s.regions[army.region].city.b.refinery ?? 0),
    units: coreBattleUnits(army.units).slice(0, SIDE_UNITS_MAX),
    heroes: heroes.map(h => ({ kind: h, xp: s.heroes[h].xp, wounded: s.heroes[h].wounded })),
    ...research(s, attacker),
    ai: 'normal',
    fromRegion: null,
  };

  // Defender principal.
  let def: BattleSide;
  if (defender === NEUTRAL) {
    const structures: BuildingKind[] = ['hq', 'power', 'barracks', 'refinery'];
    for (let i = 0; i < reg.city.level; i++) structures.push('turret');
    def = {
      faction: NEUTRAL,
      role: 'defender',
      team: 1,
      human: false,
      structures,
      cityTags: structures.map(() => null),
      credits: 1000,
      units: garrisonBattleUnits(reg.garrison).slice(0, SIDE_UNITS_MAX),
      heroes: [],
      ...research(s, NEUTRAL),
      ai: 'defend',
      fromRegion: null,
    };
  } else {
    const city = cityStructures(reg.city);
    const others = 1 + city.length + (reg.city.level >= 3 ? 1 : 0);
    const structures: BuildingKind[] = ['hq'];
    const tags: (CityBuildingId | null)[] = [null];
    for (let i = 0; i < 1 + Math.ceil(others / 3); i++) {
      structures.push('power');
      tags.push(null);
    }
    structures.push('barracks');
    tags.push(null);
    for (const c of city) {
      structures.push(c.kind);
      tags.push(c.tag);
    }
    if (reg.city.level >= 3) {
      structures.push('uplink');
      tags.push(null);
    }
    const dfac = s.factions[defender];
    const armyHere = dfac.army && dfac.army.region === target ? dfac.army : null;
    const heroesHere =
      defender === 0 && armyHere
        ? HERO_KINDS.filter(h => s.heroes[h].unlocked && !s.heroes[h].lost)
            .slice(0, s.options.heroesPerBattle)
            .map(h => ({ kind: h, xp: s.heroes[h].xp, wounded: s.heroes[h].wounded }))
        : [];
    def = {
      faction: defender,
      role: 'defender',
      team: 1,
      human: defender === 0,
      structures,
      cityTags: tags,
      credits: 1500 + 500 * (reg.city.b.refinery ?? 0) + 250 * reg.city.level,
      units: capUnits(garrisonBattleUnits(reg.garrison), armyHere ? coreBattleUnits(armyHere.units) : []),
      heroes: heroesHere,
      ...research(s, defender),
      ai: 'defend',
      fromRegion: null,
    };
  }

  // Allies, at most one per team.
  const allySide = (f: FactionId, team: 0 | 1): BattleSide => {
    const c = contingentOf(s, f, target)!;
    const structures: BuildingKind[] = ['hq', 'power', 'refinery', 'barracks'];
    return {
      faction: f,
      role: 'ally',
      team,
      human: false,
      structures,
      cityTags: structures.map(() => null),
      credits: 1500,
      units: c.units,
      heroes: [],
      ...research(s, f),
      ai: 'normal',
      fromRegion: c.region,
    };
  };
  const exclude = [attacker, defender];
  const atkAlly = allyFor(s, attacker, defender, target, exclude);
  if (atkAlly !== null) exclude.push(atkAlly);
  const defAlly = defender === NEUTRAL ? null : allyFor(s, defender, attacker, target, exclude);

  const sides: BattleSide[] = defender === 0 ? [def, atk] : [atk, def];
  if (atkAlly !== null) sides.push(allySide(atkAlly, 0));
  if (defAlly !== null) sides.push(allySide(defAlly, 1));
  const human = sides.some(x => x.human);

  return {
    battleId,
    turn: s.turn,
    region: target,
    regionName: geo.name,
    seedText: `${s.seedText}:t${s.turn}:r${target}:b${battleId}`,
    mapType: geo.terrain,
    ore: geo.ore,
    difficulty: s.difficulty,
    sides,
    defenderSeat: sides.indexOf(def),
    timeLimit: s.options.battleMinutes * 60 * TICKS_PER_SECOND,
    cityLevel: reg.city.level,
    cityBuildings: { ...reg.city.b },
    ...(human ? perksFor(s) : { perks: null, powers: [] }),
  };
}

/**
 * The defence as the computer factions estimate it (section 12, step 5): garrison, the city's
 * structures and any field army there, times the terrain.
 */
export function defenceEstimate(s: PlanetState, target: RegionId): number {
  const reg = s.regions[target];
  let d = garrisonStrength(reg.garrison);
  if (reg.owner === NEUTRAL) {
    d += structureValue('hq') + structureValue('power') + structureValue('barracks') + structureValue('refinery') + reg.city.level * structureValue('turret');
  } else {
    d += structureValue('hq') + structureValue('barracks');
    for (const c of cityStructures(reg.city)) d += structureValue(c.kind);
    const army = s.factions[reg.owner].army;
    if (army && army.region === target) d += strengthOf(army.units);
  }
  return Math.max(1, d * DEFENCE_TERRAIN[planetMapOf(s).regions[target].terrain]);
}

