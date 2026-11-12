/**
 * War for the Planet: the actions and the reducer (fireline-planet-design.md, sections 2, 6.6,
 * 9.6 and 10). W1.
 *
 * `applyPlanetAction(s, a, actor)` returns a new state for a legal action and the very same
 * object for an illegal one; it never mutates its input (it copies once and edits the copy).
 * `planetActionProblem` gives the reason for a refusal in plain English. The computer factions
 * use the same checks and the same execution through `endTurn`. Pure: no clock and no global random source.
 */
import { HERO_KINDS, UNITS, UPGRADES, type HeroKind, type LineId, type ModuleId, type UnitKind, type UpgradeId } from '../sim/rules';
import { buyPerk, newCampaign, perkProblem, RANKS, XP_PER_KILL } from '../campaign/progression';
import type { PerkId } from '../campaign/types';
import { planAiActions } from './ai';
import { addToGarrison, capGarrison, disbandForShortfall, retreatArmy, settleCity, transferRegion } from './army';
import { attackCost, battleSetupFor, heroesProblem, targetProblem } from './battleSetup';
import { buildBlock, buildCost, buildingName, damageCity, growCost, isCityBuilding, unlockHeroes } from './cities';
import { draftProblem, endTreaty, enactTreaty, expireTreaties, proposalVerdict, shiftTrust, termValue, TREATY_NAMES, trustDrift } from './diplomacy';
import { addStock, armyCapOf, canAfford, costText, garrisonCap, pay, recruitCost, regionIncome, routeIncome, shortfallText, upkeepOf } from './economy';
import { note } from './journal';
import { planetMapOf } from './map';
import { quickResolve } from './resolve';
import { doctrineProblem, loadoutProblem, researchProblem, scienceCost } from './research';
import {
  ATTACK_CREDITS,
  GIFT_MAX,
  HEAL_FOOD,
  OFFERS_MAX,
  PLANET_EXTRA_RANKS,
  REPORT_SURVIVORS_MAX,
  XP_LOST_BATTLE,
  XP_WON_ATTACK_BASE,
  XP_WON_ATTACK_PER_LEVEL,
  XP_WON_DEFENCE,
  isVehicle,
} from './rules';
import { aliveFaction, allied, atWar, deepClone, garrisonTotal, isArmyKind, isInt, kindIndex, regionsOf } from './state';
import { suppliedRegions, armyPath } from './supply';
import { exchangeFlows, pruneRoutes, routeCost, routeProblem } from './trade';
import { eliminate, victoryCheck } from './victory';
import {
  ARMY_KINDS,
  NEUTRAL,
  RESOURCES,
  type ArmyKind,
  type BattleReport,
  type BattleSetup,
  type CityBuildingId,
  type FactionId,
  type PendingBattle,
  type PlanetState,
  type RegionId,
  type Resource,
  type TreatyDraft,
} from './types';

export type PlanetAction =
  // Cities
  | { type: 'build'; region: RegionId; building: CityBuildingId }
  | { type: 'growCity'; region: RegionId }
  // Armies
  | { type: 'recruit'; region: RegionId; kind: ArmyKind; to: 'army' | 'garrison' }
  | { type: 'disband'; from: 'army'; slot: number }
  | { type: 'disband'; from: 'garrison'; region: RegionId; kind: ArmyKind }
  | { type: 'muster'; region: RegionId; kind: ArmyKind }
  | { type: 'station'; slot: number }
  | { type: 'moveArmy'; to: RegionId }
  | { type: 'attack'; target: RegionId; credits: 0 | 1000 | 2000 | 3000; heroes: HeroKind[] }
  // Battles (the player only)
  | { type: 'fight' }
  | { type: 'autoResolve' }
  | { type: 'battleResult'; report: BattleReport }
  | { type: 'healHero'; hero: HeroKind }
  // Research and Commander
  | { type: 'research'; upgrade: UpgradeId }
  | { type: 'doctrine'; line: LineId; branch: UpgradeId }
  | { type: 'loadout'; kind: UnitKind; modules: ModuleId[] }
  | { type: 'perk'; perk: PerkId }
  // Trade
  | { type: 'openRoute'; from: RegionId; to: RegionId }
  | { type: 'closeRoute'; id: number }
  // Diplomacy
  | { type: 'propose'; to: FactionId; draft: TreatyDraft }
  | { type: 'answerOffer'; id: number; accept: boolean }
  | { type: 'declareWar'; on: FactionId }
  | { type: 'cancelTreaty'; with: FactionId }
  | { type: 'gift'; to: FactionId; res: Resource; amount: number }
  // Turn (the player only)
  | { type: 'endTurn' };

export type PlanetActionType = PlanetAction['type'];

export const PLANET_ACTION_TYPES: PlanetActionType[] = [
  'build', 'growCity', 'recruit', 'disband', 'muster', 'station', 'moveArmy', 'attack', 'fight', 'autoResolve', 'battleResult', 'healHero',
  'research', 'doctrine', 'loadout', 'perk', 'openRoute', 'closeRoute', 'propose', 'answerOffer', 'declareWar', 'cancelTreaty', 'gift', 'endTurn',
];

const PLAYER_ONLY: PlanetActionType[] = ['fight', 'autoResolve', 'battleResult', 'healHero', 'perk', 'answerOffer', 'endTurn'];
const DURING_BATTLE: PlanetActionType[] = ['fight', 'autoResolve', 'battleResult'];

/** An attack by a computer faction on the player, made during the end of a turn (section 2). */
interface Intent { attacker: FactionId; target: RegionId; credits: number }
interface Ctx { intents: Intent[] | null }

// ---- Ranks (section 6.4) ----------------------------------------------------------------------

export const PLANET_RANKS: { name: string; xp: number }[] = [...RANKS, ...PLANET_EXTRA_RANKS];

export function planetRankFor(xp: number): number {
  let r = 0;
  while (r + 1 < PLANET_RANKS.length && xp >= PLANET_RANKS[r + 1].xp) r++;
  return r;
}

function addCommanderXp(d: PlanetState, xp: number): void {
  if (xp <= 0) return;
  const before = planetRankFor(d.commander.xp);
  d.commander.xp += xp;
  const after = planetRankFor(d.commander.xp);
  if (after > before) {
    d.commander.points += after - before;
    note(d, `Promoted to ${PLANET_RANKS[after].name}. A skill point to spend.`, 'good', 0);
  }
}

// ---- Report validation (section 9.6) ----------------------------------------------------------

export function reportProblem(s: PlanetState, pb: PendingBattle, rep: unknown, how: 'any' | 'player'): string | null {
  const bad = 'That battle report does not fit the battle.';
  if (!rep || typeof rep !== 'object') return bad;
  const r = rep as BattleReport;
  const setup = pb.setup;
  if (r.battleId !== pb.id || r.battleId !== setup.battleId) return 'That report is for another battle.';
  if (r.winner !== 'attacker' && r.winner !== 'defender') return bad;
  if (!['fought', 'quick', 'simulated', 'retreat'].includes(r.how)) return bad;
  if (how === 'player') {
    if ((r.how === 'fought' || r.how === 'retreat') && !pb.fighting) return 'That battle is not being fought.';
    if (r.how === 'simulated' && (!s.options.simulatedAutoResolve || pb.fighting)) return 'Simulated battles are off in this war.';
    if (r.how === 'quick') return 'Use auto-resolve for a quick result.';
    if (r.how === 'retreat') {
      const human = setup.sides.find(x => x.human);
      const humanTeamWon = human ? (human.team === 0) === (r.winner === 'attacker') : false;
      if (!human || humanTeamWon) return bad;
    }
  }
  if (!isInt(r.ticks, 0, 1e9)) return bad;
  if (!Array.isArray(r.sides) || r.sides.length !== setup.sides.length) return bad;
  for (let i = 0; i < setup.sides.length; i++) {
    const side = setup.sides[i];
    const out = r.sides[i];
    if (!out || out.faction !== side.faction) return bad;
    if (!Array.isArray(out.survivors) || out.survivors.length > REPORT_SURVIVORS_MAX) return bad;
    const cores = new Set<number>();
    for (const u of out.survivors) {
      if (!u || !isArmyKind(u.kind) || !isInt(u.kills, 0, 999)) return bad;
      if (u.core !== null) {
        if (!isInt(u.core, 0, 999) || cores.has(u.core)) return bad;
        const was = side.units.find(x => x.core === u.core);
        if (!was || was.kind !== u.kind) return 'A unit in the report never joined the battle.';
        cores.add(u.core);
      }
    }
    if (!Array.isArray(out.heroes)) return bad;
    const seen = new Set<string>();
    for (const h of out.heroes) {
      if (!h || seen.has(h.kind) || typeof h.alive !== 'boolean') return bad;
      const was = side.heroes.find(x => x.kind === h.kind);
      if (!was) return 'A hero in the report never joined the battle.';
      if (!isInt(h.xp, was.xp, 1e7)) return bad;
      seen.add(h.kind);
    }
  }
  if (!r.cityDamage || typeof r.cityDamage !== 'object') return bad;
  for (const [k, v] of Object.entries(r.cityDamage)) if (!isCityBuilding(k) || !isInt(v, 0, 3)) return bad;
  if (r.cityLevelLost !== 0 && r.cityLevelLost !== 1) return bad;
  return null;
}

// ---- Problems (section 10) --------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

/** Why `actor` cannot do this now, or null if it can. Plain English for the interface. */
export function planetActionProblem(s: PlanetState, a: PlanetAction, actor: FactionId = 0): string | null {
  return problem(s, a, actor);
}

function problem(s: PlanetState, a: PlanetAction, actor: FactionId): string | null {
  if (!isObj(a) || !PLANET_ACTION_TYPES.includes(a.type as PlanetActionType)) return 'Unknown order.';
  if (s.result) return 'The war is over.';
  if (!aliveFaction(s, actor)) return 'That faction is out of the war.';
  if (actor !== 0 && PLAYER_ONLY.includes(a.type)) return 'Only the player may do that.';
  if (s.pending.length && !DURING_BATTLE.includes(a.type)) return 'Resolve the pending battle first.';
  const fac = s.factions[actor];
  const n = s.regions.length;
  const owned = (r: unknown): r is RegionId => isInt(r, 0, n - 1) && s.regions[r].owner === actor;
  const ownErr = (r: unknown) => (!isInt(r, 0, n - 1) ? 'There is no such region.' : 'You do not hold that region.');
  switch (a.type) {
    case 'build': {
      if (!owned(a.region)) return ownErr(a.region);
      if (!isCityBuilding(a.building)) return 'There is no such building.';
      if (s.regions[a.region].city.built === s.turn) return 'This city has already built or grown this turn.';
      const block = buildBlock(s, a.region, a.building);
      if (block) return block;
      const cost = buildCost(s, a.region, a.building)!;
      return canAfford(fac.stock, cost) ? null : shortfallText(fac.stock, cost);
    }
    case 'growCity': {
      if (!owned(a.region)) return ownErr(a.region);
      const c = s.regions[a.region].city;
      if (c.level >= 5) return 'The city is at its largest.';
      if (c.built === s.turn) return 'This city has already built or grown this turn.';
      const cost = growCost(c.level);
      return canAfford(fac.stock, cost) ? null : shortfallText(fac.stock, cost);
    }
    case 'recruit': {
      if (!owned(a.region)) return ownErr(a.region);
      if (!isArmyKind(a.kind)) return 'There is no such unit.';
      if (a.to !== 'army' && a.to !== 'garrison') return 'Unknown order.';
      if (isVehicle(a.kind) && !(s.regions[a.region].city.b.factory ?? 0)) return 'Vehicles need a factory in that region.';
      if (a.to === 'army') {
        if (!fac.army || fac.army.region !== a.region) return 'The field army is not in that region.';
        if (fac.army.units.length >= armyCapOf(s, actor)) return `The field army is full (${armyCapOf(s, actor)} units).`;
      } else if (garrisonTotal(s.regions[a.region].garrison) >= garrisonCap(s, a.region)) return 'The garrison is full.';
      const cost = recruitCost(a.kind);
      return canAfford(fac.stock, cost) ? null : shortfallText(fac.stock, cost);
    }
    case 'disband': {
      if (a.from === 'army') {
        if (!fac.army || !isInt(a.slot, 0, fac.army.units.length - 1)) return 'There is no such unit.';
        return null;
      }
      if (a.from === 'garrison') {
        if (!owned(a.region)) return ownErr(a.region);
        if (!isArmyKind(a.kind) || s.regions[a.region].garrison[kindIndex(a.kind)] <= 0) return 'There is no such unit in the garrison.';
        return null;
      }
      return 'Unknown order.';
    }
    case 'muster': {
      if (!owned(a.region)) return ownErr(a.region);
      if (!fac.army || fac.army.region !== a.region) return 'The field army is not in that region.';
      if (!isArmyKind(a.kind) || s.regions[a.region].garrison[kindIndex(a.kind)] <= 0) return 'There is no such unit in the garrison.';
      if (fac.army.units.length >= armyCapOf(s, actor)) return 'The field army is full.';
      return null;
    }
    case 'station': {
      if (!fac.army || !isInt(a.slot, 0, fac.army.units.length - 1)) return 'There is no such unit.';
      const r = fac.army.region;
      if (s.regions[r].owner !== actor) return 'The field army must stand in a region you hold.';
      if (garrisonTotal(s.regions[r].garrison) >= garrisonCap(s, r)) return 'The garrison is full.';
      return null;
    }
    case 'moveArmy': {
      if (!fac.army) return 'There is no field army.';
      if (!isInt(a.to, 0, n - 1)) return 'There is no such region.';
      if (a.to === fac.army.region) return 'The field army is already there.';
      if (fac.army.moved >= s.options.armyMove) return 'The field army has moved as far as it can this turn.';
      return armyPath(s, actor, a.to) ? null : `No path of ${s.options.armyMove - fac.army.moved} hops or fewer through regions you may pass.`;
    }
    case 'attack': {
      if (!(ATTACK_CREDITS as readonly number[]).includes(a.credits)) return 'Choose 0, 1000, 2000 or 3000 credits.';
      if (!isInt(a.target, 0, n - 1)) return 'There is no such region.';
      const tp = targetProblem(s, actor, a.target);
      if (tp) return tp;
      const hp = heroesProblem(s, actor, a.heroes);
      if (hp) return hp;
      const cost = attackCost(s, actor, a.credits);
      if (!canAfford(fac.stock, cost)) return `The attack costs ${costText(cost)}. ${shortfallText(fac.stock, cost)}`;
      return battleSetupFor(s, actor, a.target, a.credits, a.heroes, s.nextId) ? null : 'That attack cannot be made now.';
    }
    case 'fight': {
      if (!s.pending.length) return 'There is no battle to fight.';
      if (s.pending[0].fighting) return 'The battle is already being fought.';
      if (!s.pending[0].setup.sides.some(x => x.human)) return 'You have no side in this battle.';
      return null;
    }
    case 'autoResolve': {
      if (!s.pending.length) return 'There is no battle to resolve.';
      if (s.pending[0].fighting) return 'The battle is being fought.';
      return null;
    }
    case 'battleResult': {
      if (!s.pending.length) return 'There is no battle to resolve.';
      return reportProblem(s, s.pending[0], a.report, 'player');
    }
    case 'healHero': {
      if (!HERO_KINDS.includes(a.hero)) return 'There is no such hero.';
      const h = s.heroes[a.hero];
      if (!h.unlocked || h.lost) return 'That hero is not with you.';
      if (!h.wounded) return 'That hero is not wounded.';
      return fac.stock.food >= HEAL_FOOD ? null : `Healing costs ${HEAL_FOOD} food.`;
    }
    case 'research':
      return researchProblem(fac.research, a.upgrade);
    case 'doctrine':
      return doctrineProblem(fac.research, a.line, a.branch);
    case 'loadout':
      return loadoutProblem(fac.research, a.kind, a.modules);
    case 'perk': {
      const c = { ...newCampaign(s.commander.name), commander: s.commander };
      return perkProblem(c, a.perk);
    }
    case 'openRoute': {
      const rp = routeProblem(s, actor, a.from, a.to);
      if (rp) return rp;
      return canAfford(fac.stock, routeCost()) ? null : `A route costs ${costText(routeCost())}.`;
    }
    case 'closeRoute':
      return s.routes.some(r => r.id === a.id && r.owner === actor) ? null : 'There is no such route of yours.';
    case 'propose': {
      if (!aliveFaction(s, a.to) || a.to === actor) return 'There is no such faction.';
      const dp = draftProblem(s, actor, a.to, a.draft);
      if (dp) return dp;
      if (a.to === 0) {
        if (s.offers.some(o => o.from === actor)) return 'An offer from that faction is already waiting.';
        if (s.offers.length >= OFFERS_MAX) return 'Too many offers are waiting.';
        return null;
      }
      if (actor !== 0 && !s.options.aiDiplomacy) return 'Computer factions do not negotiate with each other in this war.';
      const v = proposalVerdict(s, a.to, actor, a.draft);
      return v.accept ? null : `${s.factions[a.to].name} refuses. ${v.reasons.join(' ')}`.trim();
    }
    case 'answerOffer': {
      const o = s.offers.find(x => x.id === a.id);
      if (!o || typeof a.accept !== 'boolean') return 'There is no such offer.';
      if (o.expires < s.turn) return 'That offer has expired.';
      if (a.accept) return draftProblem(s, o.from, 0, o.draft);
      return null;
    }
    case 'declareWar': {
      if (!aliveFaction(s, a.on) || a.on === actor) return 'There is no such faction.';
      return s.treaties.some(t => (t.a === actor && t.b === a.on) || (t.b === actor && t.a === a.on)) ? null : 'You are already at war.';
    }
    case 'cancelTreaty': {
      if (!aliveFaction(s, a.with) || a.with === actor) return 'There is no such faction.';
      return s.treaties.some(t => (t.a === actor && t.b === a.with) || (t.b === actor && t.a === a.with)) ? null : 'There is no treaty to cancel.';
    }
    case 'gift': {
      if (!aliveFaction(s, a.to) || a.to === actor) return 'There is no such faction.';
      if (!RESOURCES.includes(a.res)) return 'There is no such resource.';
      if (!isInt(a.amount, 1, GIFT_MAX)) return `A gift is 1 to ${GIFT_MAX}.`;
      return fac.stock[a.res] >= a.amount ? null : `You hold only ${fac.stock[a.res]} ${a.res}.`;
    }
    case 'endTurn':
      return null;
  }
  return 'Unknown order.';
}

// ---- The reducer ------------------------------------------------------------------------------

/** The reducer. actor defaults to 0. Illegal: returns s itself. */
export function applyPlanetAction(s: PlanetState, a: PlanetAction, actor: FactionId = 0): PlanetState {
  if (problem(s, a, actor)) return s;
  const d = deepClone(s);
  execute(d, a, actor, { intents: null });
  return d;
}

const regionCity = (d: PlanetState, r: RegionId) => planetMapOf(d).regions[r].city;

function execute(d: PlanetState, a: PlanetAction, actor: FactionId, ctx: Ctx): void {
  const fac = d.factions[actor];
  switch (a.type) {
    case 'build': {
      pay(fac.stock, buildCost(d, a.region, a.building)!);
      const c = d.regions[a.region].city;
      const mk = (c.b[a.building] ?? 0) + 1;
      c.b[a.building] = mk as 1 | 2 | 3;
      c.built = d.turn;
      if (actor === 0) {
        note(d, `${regionCity(d, a.region)}: ${buildingName(a.building, mk)} raised to Mk ${mk}.`, 'info', 0);
        unlockHeroes(d);
      }
      return;
    }
    case 'growCity': {
      const c = d.regions[a.region].city;
      pay(fac.stock, growCost(c.level));
      c.level = (c.level + 1) as 1 | 2 | 3 | 4 | 5;
      c.built = d.turn;
      if (actor === 0) note(d, `${regionCity(d, a.region)} grows to level ${c.level}.`, 'good', 0);
      return;
    }
    case 'recruit': {
      pay(fac.stock, recruitCost(a.kind));
      if (a.to === 'army') fac.army!.units.push({ kind: a.kind, kills: 0 });
      else d.regions[a.region].garrison[kindIndex(a.kind)]++;
      return;
    }
    case 'disband': {
      if (a.from === 'army') fac.army!.units.splice(a.slot, 1);
      else d.regions[a.region].garrison[kindIndex(a.kind)]--;
      return;
    }
    case 'muster': {
      d.regions[a.region].garrison[kindIndex(a.kind)]--;
      fac.army!.units.push({ kind: a.kind, kills: 0 });
      return;
    }
    case 'station': {
      const [u] = fac.army!.units.splice(a.slot, 1);
      d.regions[fac.army!.region].garrison[kindIndex(u.kind)]++;
      return;
    }
    case 'moveArmy': {
      const path = armyPath(d, actor, a.to)!;
      fac.army!.region = a.to;
      fac.army!.moved += path.length - 1;
      return;
    }
    case 'attack':
      return attack(d, actor, a.target, a.credits, a.heroes, ctx);
    case 'fight':
      d.pending[0].fighting = true;
      return;
    case 'autoResolve':
      applyReport(d, d.pending[0], quickResolve(d.pending[0].setup));
      return;
    case 'battleResult':
      applyReport(d, d.pending[0], a.report);
      return;
    case 'healHero':
      fac.stock.food -= HEAL_FOOD;
      d.heroes[a.hero].wounded = false;
      return;
    case 'research':
      fac.research.current = a.upgrade;
      fac.research.points = 0;
      return;
    case 'doctrine':
      fac.research.doctrines[a.line] = a.branch;
      return;
    case 'loadout':
      fac.research.loadouts[a.kind] = [...a.modules];
      return;
    case 'perk': {
      const c = buyPerk({ ...newCampaign(d.commander.name), commander: d.commander }, a.perk);
      d.commander = { ...c.commander, perks: { ...c.commander.perks } };
      return;
    }
    case 'openRoute':
      pay(fac.stock, routeCost());
      d.routes.push({ id: d.nextId++, owner: actor, from: a.from, to: a.to });
      if (actor === 0) note(d, `A trade route opens between ${regionCity(d, a.from)} and ${regionCity(d, a.to)}.`, 'info', 0);
      return;
    case 'closeRoute':
      d.routes = d.routes.filter(r => r.id !== a.id);
      return;
    case 'propose':
      if (a.to === 0) {
        d.offers.push({ id: d.nextId++, from: actor, draft: deepClone(a.draft), expires: d.turn + 1 });
        note(d, `${fac.name} proposes a ${TREATY_NAMES[a.draft.kind]}.`, 'info', actor);
      } else enactTreaty(d, actor, a.to, a.draft);
      return;
    case 'answerOffer': {
      const o = d.offers.find(x => x.id === a.id)!;
      d.offers = d.offers.filter(x => x.id !== a.id);
      if (a.accept) enactTreaty(d, o.from, 0, o.draft);
      else note(d, `You decline the ${TREATY_NAMES[o.draft.kind]} offered by ${d.factions[o.from].name}.`, 'info', 0);
      return;
    }
    case 'declareWar':
      endTreaty(d, actor, a.on, 'war');
      return;
    case 'cancelTreaty':
      endTreaty(d, actor, a.with, 'cancel');
      return;
    case 'gift':
      fac.stock[a.res] -= a.amount;
      d.factions[a.to].stock[a.res] += a.amount;
      shiftTrust(d, a.to, actor, Math.min(15, Math.floor(termValue(a.res, a.amount) / 5)));
      note(d, `${fac.name} sends ${d.factions[a.to].name} ${a.amount} ${a.res}.`, 'info', actor === 0 || a.to === 0 ? 0 : undefined);
      return;
    case 'endTurn':
      endTurn(d);
      return;
  }
}

// ---- Battles ----------------------------------------------------------------------------------

/** Ally contingents leave their garrisons when the battle is made (section 9.3). */
function takeContingents(d: PlanetState, setup: BattleSetup): void {
  for (const side of setup.sides) {
    if (side.role !== 'ally' || side.fromRegion === null) continue;
    const g = d.regions[side.fromRegion].garrison;
    for (const u of side.units) {
      const i = kindIndex(u.kind);
      if (g[i] > 0) g[i]--;
    }
  }
}

/** A faction allied with the defender loses trust in the attacker (section 8.3). */
function attackTrust(d: PlanetState, attacker: FactionId, defender: number): void {
  if (defender === NEUTRAL) return;
  for (const f of d.factions) if (f.alive && f.id !== attacker && allied(d, f.id, defender)) shiftTrust(d, f.id, attacker, -8);
}

function makeBattle(d: PlanetState, attacker: FactionId, target: RegionId, credits: number, heroes: HeroKind[], kind: 'attack' | 'defence'): PendingBattle | null {
  const view = d.pending.length ? { ...d, pending: [] } : d;
  const setup = battleSetupFor(view, attacker, target, credits, heroes, d.nextId);
  if (!setup) return null;
  pay(d.factions[attacker].stock, attackCost(d, attacker, credits));
  d.nextId++;
  takeContingents(d, setup);
  attackTrust(d, attacker, setup.sides[setup.defenderSeat].faction);
  return { id: setup.battleId, kind, region: target, attacker, defender: d.regions[target].owner, setup, fighting: false };
}

function attack(d: PlanetState, actor: FactionId, target: RegionId, credits: number, heroes: HeroKind[], ctx: Ctx): void {
  const defender = d.regions[target].owner;
  const army = d.factions[actor].army!;
  if (actor !== 0 && defender === 0 && ctx.intents) {
    // Recorded now, fought by the player at the start of the next turn.
    ctx.intents.push({ attacker: actor, target, credits });
    army.attacked = true;
    return;
  }
  const pb = makeBattle(d, actor, target, credits, heroes, actor === 0 ? 'attack' : 'defence');
  if (!pb) return;
  army.attacked = true;
  if (actor === 0 || defender === 0) {
    d.pending.push(pb);
    if (actor === 0) note(d, `The field army marches on ${pb.setup.regionName}.`, 'info', 0);
    else note(d, `${d.factions[actor].name} attacks ${pb.setup.regionName}.`, 'bad', 0);
    return;
  }
  applyReport(d, pb, quickResolve(pb.setup));
}

/**
 * Applies a battle report (section 9.6) to a draft. `pb` is d.pending[0] for the player's battles
 * (shifted off here), or a battle between computer factions resolved at once.
 */
function applyReport(d: PlanetState, pb: PendingBattle, rep: BattleReport): void {
  const setup = pb.setup;
  const r = setup.region;
  const reg = d.regions[r];
  const attackerWon = rep.winner === 'attacker';
  const atkSide = setup.sides.find(x => x.role === 'attacker')!;
  const defSide = setup.sides[setup.defenderSeat];
  const attacker = atkSide.faction as FactionId;
  const defender = defSide.faction;
  const nonCore: ArmyKind[][] = setup.sides.map(() => []);

  // Core survivors return to their field armies in slot order; the rest of the slots that fought are gone.
  setup.sides.forEach((side, i) => {
    const out = rep.sides[i];
    for (const u of out?.survivors ?? []) if (u.core === null && isArmyKind(u.kind)) nonCore[i].push(u.kind);
    if (side.faction === NEUTRAL) return;
    const army = d.factions[side.faction].army;
    const fought = new Set(side.units.filter(u => u.core !== null).map(u => u.core as number));
    if (!army || !fought.size) return;
    const back = new Map<number, number>();
    for (const u of out?.survivors ?? []) if (u.core !== null) back.set(u.core, u.kills);
    army.units = army.units.flatMap((u, slot) => {
      if (!fought.has(slot)) return [u];
      const kills = back.get(slot);
      return kills === undefined ? [] : [{ kind: u.kind, kills: Math.max(u.kills, Math.min(999, Math.floor(kills))) }];
    });
  });

  // The garrison units that stayed out of the battle (beyond the 40 a side may bring).
  const stayed = [...reg.garrison];
  for (const u of defSide.units) if (u.core === null) {
    const i = kindIndex(u.kind);
    if (stayed[i] > 0) stayed[i]--;
  }
  const atkSeat = setup.sides.indexOf(atkSide);
  const defSeat = setup.defenderSeat;

  // Ally survivors go home if the ally still holds its region.
  setup.sides.forEach((side, i) => {
    if (side.role !== 'ally' || side.fromRegion === null) return;
    if (d.regions[side.fromRegion].owner === side.faction) addToGarrison(d, side.fromRegion, nonCore[i]);
  });

  damageCity(reg.city, rep.cityDamage ?? {}, 0);
  if (attackerWon) {
    reg.garrison = ARMY_KINDS.map(() => 0);
    transferRegion(d, r, attacker);
    if (rep.cityLevelLost) damageCity(reg.city, {}, 1);
    addToGarrison(d, r, nonCore[atkSeat]);
    const army = d.factions[attacker].army;
    if (army) army.region = r;
  } else {
    reg.garrison = stayed;
    addToGarrison(d, r, nonCore[defSeat]);
  }
  settleCity(d, r);

  // Heroes (the player's only).
  const human = setup.sides.findIndex(x => x.faction === 0 && x.role !== 'ally');
  if (human >= 0) {
    for (const h of rep.sides[human]?.heroes ?? []) {
      const hero = d.heroes[h.kind];
      if (!hero) continue;
      hero.xp = Math.max(hero.xp, Math.floor(h.xp));
      if (!h.alive) {
        hero.wounded = true;
        if (d.options.ironRule) {
          hero.lost = true;
          note(d, `${UNITS[h.kind].name} falls and is lost for the rest of the war.`, 'bad', 0);
        }
      }
    }
    const side = setup.sides[human];
    const won = side.role === 'attacker' ? attackerWon : !attackerWon;
    let xp = won ? (side.role === 'attacker' ? XP_WON_ATTACK_BASE + XP_WON_ATTACK_PER_LEVEL * setup.cityLevel : XP_WON_DEFENCE) : XP_LOST_BATTLE;
    if (rep.how === 'fought' || rep.how === 'retreat') {
      let kills = 0;
      for (const u of rep.sides[human]?.survivors ?? []) {
        const was = u.core === null ? undefined : side.units.find(x => x.core === u.core);
        kills += Math.max(0, u.kills - (was?.kills ?? 0));
      }
      xp += XP_PER_KILL * kills;
    }
    addCommanderXp(d, xp);
  }

  const an = d.factions[attacker].name;
  const dn = defender === NEUTRAL ? 'the independents' : d.factions[defender].name;
  const how = rep.how === 'retreat' ? ' after a retreat' : rep.how === 'fought' ? '' : rep.how === 'simulated' ? ' (simulated)' : ' (auto-resolved)';
  const involved = setup.sides.some(x => x.faction === 0);
  const tone = !involved ? 'info' : (attacker === 0) === attackerWon ? 'good' : 'bad';
  note(
    d,
    attackerWon ? `${an} takes ${setup.regionName} from ${dn}${how}.` : `${dn[0].toUpperCase()}${dn.slice(1)} hold${defender === NEUTRAL ? '' : 's'} ${setup.regionName} against ${an}${how}.`,
    tone,
    involved ? 0 : attacker,
  );

  if (d.pending[0] === pb) d.pending.shift();
  unlockHeroes(d);
  // A later pending battle whose region changed hands, or whose attacker is gone, no longer stands.
  d.pending = d.pending.filter(p => {
    const ok = d.regions[p.region].owner === p.defender && d.factions[p.attacker].alive;
    if (!ok) note(d, `The attack on ${p.setup.regionName} is called off.`, 'info', 0);
    return ok;
  });
}

// ---- End of turn (sections 2 and 6.6) ---------------------------------------------------------

/** Regions a signatory captured that a split term assigns to its partner are handed over (section 8.2). */
function splitHandover(d: PlanetState): void {
  for (const t of [...d.treaties]) for (const term of t.terms) {
    if (term.k !== 'split') continue;
    for (const [r, to] of term.regions) {
      const holder = d.regions[r].owner;
      const other = to === t.a ? t.b : t.a;
      if (holder !== other || !d.factions[to].alive) continue;
      d.regions[r].garrison = ARMY_KINDS.map(() => 0);
      transferRegion(d, r, to);
      const army = d.factions[other].army;
      if (army && army.region === r) retreatArmy(d, other);
      note(d, `${d.factions[other].name} hands ${planetMapOf(d).regions[r].city} to ${d.factions[to].name} as agreed.`, 'info', other === 0 || to === 0 ? 0 : undefined);
    }
  }
}

function production(d: PlanetState): void {
  const alive = d.factions.filter(f => f.alive).map(f => f.id);
  const science = new Map<FactionId, number>();
  // 1 to 3: yields, routes, factories.
  for (const f of alive) {
    const sup = suppliedRegions(d, f);
    const inc = regionIncome(d, f, sup);
    addStock(d.factions[f].stock, inc);
    science.set(f, inc.science);
  }
  const routes = alive.map(f => routeIncome(d, f));
  alive.forEach((f, i) => addStock(d.factions[f].stock, routes[i]));
  for (const f of alive) {
    const sup = suppliedRegions(d, f);
    const st = d.factions[f].stock;
    d.regions.forEach((reg, r) => {
      const mk = reg.owner === f && sup[r] ? reg.city.b.factory ?? 0 : 0;
      if (!mk) return;
      const n = Math.min(2 * mk, st.ore);
      st.ore -= n;
      st.alloys += n;
    });
  }
  // 4: treaty flows, in treaty order.
  for (const t of [...d.treaties]) {
    if (!d.treaties.includes(t)) continue;
    for (const term of t.terms) {
      if (term.k === 'tribute') {
        const to = term.from === t.a ? t.b : t.a;
        const st = d.factions[term.from].stock;
        if (st[term.res] < term.amount) {
          unpaid(d, t, term.from, to);
          break;
        }
        st[term.res] -= term.amount;
        d.factions[to].stock[term.res] += term.amount;
        shiftTrust(d, to, term.from, 1);
      } else if (term.k === 'exchange') {
        const other = term.from === t.a ? t.b : t.a;
        if (!exchangeFlows(d, t.a, t.b)) continue;
        const a = d.factions[term.from].stock;
        const b = d.factions[other].stock;
        if (a[term.give] < term.giveAmount) {
          unpaid(d, t, term.from, other);
          break;
        }
        if (b[term.get] < term.getAmount) {
          unpaid(d, t, other, term.from);
          break;
        }
        a[term.give] -= term.giveAmount;
        b[term.give] += term.giveAmount;
        b[term.get] -= term.getAmount;
        a[term.get] += term.getAmount;
      }
    }
  }
  // 5: upkeep, with shortfalls disbanding units.
  for (const f of alive) {
    const st = d.factions[f].stock;
    const up = upkeepOf(d, f);
    for (const res of ['food', 'fuel'] as const) {
      if (st[res] >= up[res]) st[res] -= up[res];
      else {
        const short = up[res] - st[res];
        st[res] = 0;
        let lost = 0;
        for (let i = 0; i < short; i++) if (disbandForShortfall(d, f, res)) lost++;
        if (lost) note(d, `${d.factions[f].name} runs short of ${res}: ${lost} unit${lost === 1 ? '' : 's'} disband.`, 'bad', f);
      }
    }
  }
  // 6: research.
  for (const f of alive) {
    const r = d.factions[f].research;
    if (!r.current) continue;
    r.points += science.get(f) ?? 0;
    if (r.points >= scienceCost(r.current)) {
      const done = r.current;
      r.done.push(done);
      r.current = null;
      r.points = 0;
      if (f === 0) note(d, `Research complete: ${UPGRADE_NAME(done)}.`, 'good', 0);
    }
  }
  // 7: militia.
  for (const f of alive) {
    const cap = d.factions[f].capital;
    if (d.regions[cap].owner === f && garrisonTotal(d.regions[cap].garrison) < garrisonCap(d, cap) / 2) d.regions[cap].garrison[0]++;
  }
  // 8: supply and surrender.
  for (const f of alive) {
    const sup = suppliedRegions(d, f);
    d.regions.forEach((reg, r) => {
      if (reg.owner !== f) return;
      reg.cut = sup[r] || d.factions[f].capital === r ? 0 : reg.cut + 1;
    });
  }
  const m = planetMapOf(d);
  for (let r = 0; r < d.regions.length; r++) {
    const reg = d.regions[r];
    const f = reg.owner;
    if (f === NEUTRAL || reg.cut < d.options.surrenderTurns || d.factions[f].capital === r) continue;
    const weight = new Map<FactionId, number>();
    for (const l of m.regions[r].links) {
      const o = d.regions[l.to].owner;
      if (o === NEUTRAL || o === f || !d.factions[o].alive || !atWar(d, f, o)) continue;
      weight.set(o, (weight.get(o) ?? 0) + garrisonTotal(d.regions[l.to].garrison));
    }
    if (!weight.size) continue;
    let to = -1;
    let most = -1;
    for (const [o, w] of [...weight.entries()].sort((p, q) => p[0] - q[0])) if (w > most) {
      to = o;
      most = w;
    }
    reg.garrison = ARMY_KINDS.map(() => 0);
    transferRegion(d, r, to);
    reg.city.level = Math.max(1, reg.city.level - 1) as 1 | 2 | 3 | 4 | 5;
    settleCity(d, r);
    note(d, `${m.regions[r].city}, cut off for ${d.options.surrenderTurns} turns, surrenders to ${d.factions[to].name}.`, f === 0 ? 'bad' : to === 0 ? 'good' : 'info', f === 0 || to === 0 ? 0 : f);
  }
  // 9: treaty expiry. 10: trust drift and offers.
  expireTreaties(d);
  trustDrift(d);
  d.offers = d.offers.filter(o => o.expires > d.turn);
  // 11: heroes heal, armies rest.
  const army = d.factions[0].army;
  if (!army || !army.attacked) for (const k of HERO_KINDS) if (d.heroes[k].wounded && !d.heroes[k].lost) d.heroes[k].wounded = false;
  for (const f of d.factions) if (f.army) {
    f.army.moved = 0;
    f.army.attacked = false;
  }
}

const UPGRADE_NAME = (id: UpgradeId): string => UPGRADES[id]?.name ?? id;

function unpaid(d: PlanetState, t: PlanetState['treaties'][number], payer: FactionId, payee: FactionId): void {
  d.treaties = d.treaties.filter(x => x !== t);
  shiftTrust(d, payee, payer, -10);
  note(d, `${d.factions[payer].name} cannot meet its terms; the ${TREATY_NAMES[t.kind]} with ${d.factions[payee].name} ends.`, 'bad', payer === 0 || payee === 0 ? 0 : payer);
  // Section 7: foreign routes between them stop standing with the pact, so they go at once.
  pruneRoutes(d);
}

function endTurn(d: PlanetState): void {
  const ctx: Ctx = { intents: [] };
  // 1. The computer factions, in id order, through the same checks and execution.
  for (const f of d.factions) {
    if (f.id === 0 || !f.alive) continue;
    for (const a of planAiActions(d, f.id)) {
      if (!d.factions[f.id].alive || d.result) break;
      if (!problem(d, a, f.id)) execute(d, a, f.id, ctx);
    }
  }
  splitHandover(d);
  // 2. Production.
  production(d);
  // 3. Eliminations and the victory check.
  eliminate(d);
  unlockHeroes(d);
  const result = victoryCheck(d);
  if (result) {
    d.result = result;
    d.pending = [];
    note(d, result.won ? `Victory (${result.how}).` : `Defeat (${result.how}).`, result.won ? 'good' : 'bad', 0);
    return;
  }
  // 4. The next turn.
  d.turn++;
  // 5. Intents against the player become defence battles (one per region; skipped if no longer legal).
  const taken = new Set<RegionId>();
  for (const it of ctx.intents ?? []) {
    if (taken.has(it.target) || !d.factions[it.attacker].alive || d.regions[it.target].owner !== 0) continue;
    const pb = makeBattle(d, it.attacker, it.target, it.credits, [], 'defence');
    if (!pb) continue;
    taken.add(it.target);
    d.pending.push(pb);
    note(d, `${d.factions[it.attacker].name} attacks ${pb.setup.regionName}.`, 'bad', 0);
  }
  for (const r of regionsOf(d, 0)) capGarrison(d, r);
}
