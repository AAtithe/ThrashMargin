/**
 * War for the Planet: the computer factions (fireline-planet-design.md, section 12). W1.
 *
 * `planAiActions(s, f)` returns an ordered list of actions; the end-turn loop applies them one at
 * a time through the same reducer checks, skipping any that are refused. Pure and deterministic:
 * the same state gives the same list. Every tie is broken by the lowest id, so no dice are drawn.
 * It keeps a running budget of its own so later orders in the list are mostly affordable.
 */
import { UPGRADE_LINE } from '../sim/rules';
import { attackTargetsFrom, defenceEstimate, garrisonStrength, strengthOf } from './battleSetup';
import { buildBlock, buildCost, growCost } from './cities';
import { aiTreatyTurns, borders, needsTrade, proposalScore, proposalVerdict, specOf, threatOf, tradeValue, warInterest } from './diplomacy';
import { armyCapOf, armyCounts, factionIncome, garrisonCap, recruitCost, regionYield, yieldTotal } from './economy';
import { planetMapOf } from './map';
import { prerequisiteProblem, aiLoadouts } from './research';
import {
  ACCEPT_AT,
  AI_BOLD_LATE,
  AI_BOLD_LEAD,
  AI_CREDITS_PER_POINT,
  AI_GARRISON_BORDER,
  AI_GARRISON_THREATENED,
  AI_LEADER_TARGET,
  AI_MAX_BUILDS,
  AI_MAX_PROPOSALS,
  AI_REFIT_GAIN,
  AI_RESERVE,
  AI_RIVAL_TARGET,
  AI_UPKEEP_TURNS,
  ATTACK_CREDITS,
  BREACH_TRUST_MAX,
  BREAK_SHORT_BY,
  BREAK_SHORT_TURNS,
  CANCEL_AT,
  RENEW_BELOW,
  TEMPERAMENTS,
  VALUE,
  isVehicle,
  unitValue,
  vetMul,
  type AiBuild,
  type TemperamentSpec,
} from './rules';
import { atWar, garrisonTotal, stanceOf, treatyBetween } from './state';
import { armyPath, suppliedRegions } from './supply';
import { hopsBetween, routeCap, routeCost, routeProblem } from './trade';
import type { PlanetAction } from './turn';
import { NEUTRAL, RESOURCES, type ArmyKind, type CoreUnit, type FactionId, type PlanetState, type RegionId, type Stock, type Temperament, type TreatyDraft } from './types';

const sameMods = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((m, i) => m === b[i]);

/** Strength of every at-war faction (and, with `neutrals`, independents) next to region r. */
function adjacentEnemy(s: PlanetState, f: FactionId, r: RegionId, neutrals: boolean): number {
  let t = 0;
  for (const l of planetMapOf(s).regions[r].links) {
    const o = s.regions[l.to].owner;
    if (o === f) continue;
    if (o === NEUTRAL ? !neutrals : !atWar(s, f, o)) continue;
    t += garrisonStrength(s.regions[l.to].garrison);
    if (o !== NEUTRAL) {
      const army = s.factions[o].army;
      if (army && army.region === l.to) t += strengthOf(army.units);
    }
  }
  return t;
}

function diplomacy(s: PlanetState, f: FactionId, T: TemperamentSpec, out: PlanetAction[]): void {
  const others = s.factions.filter(b => b.alive && b.id !== f);
  // Toward computer factions only with aiDiplomacy; the player (or the bot playing it) always negotiates.
  const talks = (b: FactionId) => s.options.aiDiplomacy || b === 0 || f === 0;
  const fac = s.factions[f];
  const net = factionIncome(s, f).net;
  let proposals = 0;
  // A short war leaves little time for a broken word to cost anything.
  const breakAt = T.breakAt === null ? null : T.breakAt - (s.options.turnLimit <= BREAK_SHORT_TURNS ? BREAK_SHORT_BY : 0);
  // Would b sign it? A computer faction is asked only when it would accept; the player always may be asked.
  const wouldSign = (b: FactionId, dr: TreatyDraft) => b === 0 || proposalVerdict(s, b, f, dr).accept;
  // Would f itself sign it, judged by the same logic it applies to anyone's proposal?
  const wants = (b: FactionId, dr: TreatyDraft) => proposalScore(s, f, b, dr).score >= ACCEPT_AT[dr.kind] && (dr.kind !== 'alliance' || s.trust[f][b] >= T.allianceTrust);
  for (const b of others) {
    if (!talks(b.id)) continue;
    const st = stanceOf(s, f, b.id);
    const t = treatyBetween(s, f, b.id);
    const interest = warInterest(s, f, b.id, T).value;
    // War through a treaty: a breach of a dated one (only temperaments that break), or ending an open-ended one.
    if (t && st !== 'war') {
      const dated = t.ends !== null && t.ends > s.turn;
      // A breach is weighed against the trust built up: a long friendship is not thrown away.
      const breach = dated && breakAt !== null && interest >= breakAt + (st === 'alliance' ? 10 : 0) && s.trust[f][b.id] <= BREACH_TRUST_MAX;
      if (breach || (t.ends === null && interest >= CANCEL_AT)) {
        out.push({ type: 'declareWar', on: b.id });
        continue;
      }
    }
    if (proposals >= AI_MAX_PROPOSALS) continue;
    let draft: TreatyDraft | null = null;
    // Treaties run out unless renewed: a faction renews (or upgrades) only while peace pays.
    const due = !t || t.ends === null || t.ends - s.turn <= 1;
    // Peace is worth seeking with a neighbour, or with a faction the routes already trade with.
    const matters = borders(s, f, b.id) > 0 || tradeValue(s, f, b.id) > 0 || needsTrade(s, f, b.id);
    if (st === 'war') {
      const dr: TreatyDraft = { kind: 'ceasefire', turns: aiTreatyTurns(s, 'ceasefire'), terms: [] };
      if (matters && interest < RENEW_BELOW && wouldSign(b.id, dr)) draft = dr;
    } else if (t && st === 'trade' && !due && s.turn - t.since >= 3 && matters && interest < RENEW_BELOW) {
      // A trade partner that shares a rival or an enemy is offered an alliance without waiting for the pact to run out.
      const ally: TreatyDraft = { kind: 'alliance', turns: aiTreatyTurns(s, 'alliance'), terms: t.terms.filter(x => x.k !== 'payment') };
      if (wants(b.id, ally) && wouldSign(b.id, ally)) draft = ally;
    }
    if (!draft && t && t.ends !== null && due && matters && interest < RENEW_BELOW) {
      const ally: TreatyDraft = { kind: 'alliance', turns: aiTreatyTurns(s, 'alliance'), terms: [] };
      const trade: TreatyDraft = { kind: 'trade', turns: aiTreatyTurns(s, 'trade'), terms: t.kind === 'ceasefire' ? [] : t.terms.filter(x => x.k !== 'payment') };
      if (st !== 'ceasefire' && wants(b.id, ally) && wouldSign(b.id, ally)) draft = ally;
      else if (st === 'alliance') {
        const again: TreatyDraft = { ...ally, terms: t.terms.filter(x => x.k !== 'payment') };
        if (wants(b.id, again) && wouldSign(b.id, again)) draft = again;
        else if (wants(b.id, trade) && wouldSign(b.id, trade)) draft = trade;
      } else if (wants(b.id, trade) && wouldSign(b.id, trade)) draft = trade;
    }
    if (!draft && t && (st === 'trade' || st === 'alliance') && !t.terms.some(x => x.k === 'exchange') && t.terms.length < 4) {
      const deficit = RESOURCES.find(r => fac.stock[r] < 10 && net[r] <= 0);
      const surplus = [...RESOURCES].filter(r => fac.stock[r] > 30 && r !== deficit).sort((p, q) => fac.stock[q] - fac.stock[p])[0];
      if (deficit && surplus) {
        const get = Math.max(1, Math.floor((3 * VALUE[surplus]) / VALUE[deficit] / T.exchangeMargin));
        const dr: TreatyDraft = {
          kind: t.kind,
          turns: t.ends === null ? null : Math.max(t.kind === 'trade' ? 5 : 10, t.ends - s.turn + 1),
          terms: [...t.terms.filter(x => x.k !== 'payment'), { k: 'exchange', from: f, give: surplus, giveAmount: 3, get: deficit, getAmount: Math.min(20, get) }],
        };
        if (wouldSign(b.id, dr)) draft = dr;
      }
    }
    if (draft) {
      out.push({ type: 'propose', to: b.id, draft });
      proposals++;
    }
  }
}

function research(s: PlanetState, f: FactionId, T: TemperamentSpec, out: PlanetAction[]): void {
  const r = s.factions[f].research;
  if (!r.current) {
    for (const id of T.research) {
      if (r.done.includes(id)) continue;
      const { line, mark } = UPGRADE_LINE[id];
      const assume = mark === 3 && r.doctrines[line] === undefined && T.doctrines[line] === id;
      if (prerequisiteProblem(r, id, assume)) continue;
      if (assume) out.push({ type: 'doctrine', line, branch: id });
      out.push({ type: 'research', upgrade: id });
      break;
    }
  }
  for (const [kind, mods] of aiLoadouts(r)) {
    if (!sameMods(mods, r.loadouts[kind] ?? []) && (mods.length || r.loadouts[kind])) out.push({ type: 'loadout', kind, modules: mods });
  }
}

/** Affordable keeping the reserve of every resource the cost uses. */
const above = (budget: Stock, cost: Stock): boolean => RESOURCES.every(k => cost[k] <= 0 || budget[k] - cost[k] >= AI_RESERVE[k]);
const spend = (budget: Stock, cost: Stock) => RESOURCES.forEach(k => (budget[k] -= cost[k]));

/**
 * Trade routes (section 12, step 3a): while there is room and money above the reserve, open the
 * best-paying route, a foreign one to a trading partner's city first (fuel and alloys to both), else
 * one between two of its own cities (ore and food). Ties lowest ids.
 */
function routes(s: PlanetState, f: FactionId, budget: Stock, out: PlanetAction[]): void {
  if (s.routes.filter(r => r.owner === f).length >= routeCap(s, f)) return;
  const cost = routeCost();
  if (!above(budget, cost)) return;
  let best: { from: RegionId; to: RegionId; value: number } | null = null;
  const mine = s.regions.map((reg, i) => ({ reg, i })).filter(x => x.reg.owner === f).map(x => x.i);
  for (const from of mine) {
    for (let to = 0; to < s.regions.length; to++) {
      const o = s.regions[to].owner;
      if (o === NEUTRAL || to === from) continue;
      const level = s.regions[from].city.level + s.regions[to].city.level;
      const y = 1 + Math.floor(level / 4);
      const value = o === f ? y * (VALUE.ore + VALUE.food) : y * (VALUE.fuel + VALUE.alloys);
      if (best && value <= best.value) continue;
      if (routeProblem(s, f, from, to)) continue;
      best = { from, to, value };
    }
  }
  if (!best) return;
  spend(budget, cost);
  out.push({ type: 'openRoute', from: best.from, to: best.to });
}

function builds(s: PlanetState, f: FactionId, T: TemperamentSpec, budget: Stock, out: PlanetAction[]): void {
  const net = factionIncome(s, f).net;
  let list: AiBuild[] = T.build;
  if (net.food < 0) list = ['farms', ...T.build.filter(b => b !== 'farms')];
  // Idle ore is turned into alloys.
  else if (s.factions[f].stock.ore > 40) list = ['factory', ...T.build.filter(b => b !== 'factory')];
  const regions = s.regions
    .map((reg, i) => ({ reg, i }))
    .filter(x => x.reg.owner === f && x.reg.city.built !== s.turn)
    .map(x => ({ i: x.i, y: yieldTotal(regionYield(s, x.i)) }))
    .sort((p, q) => q.y - p.y || p.i - q.i);
  let n = 0;
  // A foe across the sea and no port facing any: a port on that coast comes first, so the army can
  // cross (a foe is an independent or a faction at war).
  const m = planetMapOf(s);
  const foe = (r: RegionId) => s.regions[r].owner !== f && (s.regions[r].owner === NEUTRAL || atWar(s, f, s.regions[r].owner));
  const mine = s.regions.map((reg, i) => ({ reg, i })).filter(x => x.reg.owner === f).map(x => x.i);
  if (!mine.some(i => (s.regions[i].city.b.port ?? 0) > 0 && m.regions[i].links.some(l => l.sea && foe(l.to)))) {
    for (const i of mine) {
      if (s.regions[i].city.built === s.turn || !m.regions[i].links.some(l => l.sea && foe(l.to)) || !m.regions[i].coastal) continue;
      // No room for a port yet: grow the city first.
      const grow = buildBlock(s, i, 'port') !== null;
      if (grow && s.regions[i].city.level >= 5) continue;
      const cost = grow ? growCost(s.regions[i].city.level) : buildCost(s, i, 'port');
      if (!cost || !above(budget, cost)) continue;
      spend(budget, cost);
      out.push(grow ? { type: 'growCity', region: i } : { type: 'build', region: i, building: 'port' });
      n++;
      break;
    }
  }
  // Where the field army stands, a factory first, so the army can refit there.
  const army = s.factions[f].army;
  const base = army && s.regions[army.region].owner === f && army.units.some(u => !isVehicle(u.kind)) ? army.region : -1;
  for (const { i } of regions) {
    if (n >= AI_MAX_BUILDS) break;
    if (out.some(a => (a.type === 'build' || a.type === 'growCity') && a.region === i)) continue;
    for (const item of i === base ? ['factory' as AiBuild, ...list.filter(b => b !== 'factory')] : list) {
      let cost: Stock | null;
      if (item === 'grow') cost = s.regions[i].city.level < 5 ? growCost(s.regions[i].city.level) : null;
      else cost = buildBlock(s, i, item) ? null : buildCost(s, i, item);
      if (!cost || !above(budget, cost)) continue;
      spend(budget, cost);
      out.push(item === 'grow' ? { type: 'growCity', region: i } : { type: 'build', region: i, building: item });
      n++;
      break;
    }
  }
}

/**
 * Recruitment (section 12, step 4). Returns the field army as it will stand after these orders,
 * for the attack estimate. A full army is refitted: its weakest unit is stationed in the garrison
 * where it stands (or disbanded when that is full) to make room for a markedly stronger one.
 */
function recruitment(s: PlanetState, f: FactionId, T: TemperamentSpec, budget: Stock, out: PlanetAction[]): CoreUnit[] {
  const fac = s.factions[f];
  const net = factionIncome(s, f).net;
  // A stockpile carries upkeep for a while: a deficit is sustainable while the stock covers AI_UPKEEP_TURNS of it.
  let food = net.food + Math.floor(fac.stock.food / AI_UPKEEP_TURNS);
  // One fuel a turn is kept back for attacks.
  let fuel = net.fuel - 1 + Math.floor(fac.stock.fuel / AI_UPKEEP_TURNS);
  const counts = fac.army ? armyCounts(fac.army.units) : { infantry: 0, vehicles: 0 };
  let inf = counts.infantry;
  let veh = counts.vehicles;
  let gar = s.regions.reduce((t, reg) => t + (reg.owner === f ? garrisonTotal(reg.garrison) : 0), 0);
  const avail: Stock = { ore: 0, fuel: 0, alloys: 0, food: 0 };
  for (const k of RESOURCES) avail[k] = Math.max(0, budget[k] - AI_RESERVE[k]);
  const garrisonBudget: Stock = { ore: 0, fuel: 0, alloys: 0, food: 0 };
  for (const k of RESOURCES) garrisonBudget[k] = Math.floor(avail[k] * T.garrisonShare);
  const armyBudget: Stock = { ore: 0, fuel: 0, alloys: 0, food: 0 };
  for (const k of RESOURCES) armyBudget[k] = avail[k] - garrisonBudget[k];
  const fits = (b: Stock, c: Stock) => RESOURCES.every(k => b[k] >= c[k]);
  // Upkeep steps: army infantry 1 food per 3, vehicles 1 fuel per 2, garrisons 1 food per 5.
  const sustainable = (kind: ArmyKind, to: 'army' | 'garrison') =>
    to === 'garrison' ? food - (gar % 5 === 0 ? 1 : 0) >= 0 : isVehicle(kind) ? fuel - (veh % 2 === 0 ? 1 : 0) >= 0 : food - (inf % 3 === 0 ? 1 : 0) >= 0;
  const take = (b: Stock, kind: ArmyKind, to: 'army' | 'garrison') => {
    const c = recruitCost(kind);
    for (const k of RESOURCES) {
      b[k] -= c[k];
      budget[k] -= c[k];
    }
    if (to === 'garrison') {
      if (gar % 5 === 0) food--;
      gar++;
    } else if (isVehicle(kind)) {
      if (veh % 2 === 0) fuel--;
      veh++;
    } else {
      if (inf % 3 === 0) food--;
      inf++;
    }
  };
  let orders = 0;
  const MAX = 12;
  // Garrisons of border regions facing a faction at war, most threatened first.
  const borderRegions = s.regions
    .map((reg, i) => ({ reg, i }))
    .filter(x => x.reg.owner === f)
    .map(x => ({ i: x.i, e: adjacentEnemy(s, f, x.i, false) }))
    .filter(x => x.e > 0)
    .sort((p, q) => q.e - p.e || p.i - q.i);
  // Only field armies attack: a border region within reach of an enemy army is filled further.
  const near = s.regions.map(() => false);
  const m = planetMapOf(s);
  for (const o of s.factions) {
    if (!o.alive || o.id === f || !o.army || !o.army.units.length || !atWar(s, f, o.id)) continue;
    const dist = new Map<RegionId, number>([[o.army.region, 0]]);
    const q = [o.army.region];
    for (let h = 0; h < q.length; h++) {
      const d = dist.get(q[h])!;
      near[q[h]] = true;
      if (d >= s.options.armyMove + 1) continue;
      for (const l of m.regions[q[h]].links) if (!dist.has(l.to)) {
        dist.set(l.to, d + 1);
        q.push(l.to);
      }
    }
  }
  for (const { i } of borderRegions) {
    const cap = Math.floor((near[i] ? AI_GARRISON_THREATENED : AI_GARRISON_BORDER) * garrisonCap(s, i));
    let count = garrisonTotal(s.regions[i].garrison);
    let k = 0;
    while (count < cap && orders < MAX) {
      let picked: ArmyKind | null = null;
      for (let j = 0; j < T.recruit.length; j++) {
        const kind = T.recruit[(k + j) % T.recruit.length];
        if (isVehicle(kind) && !(s.regions[i].city.b.factory ?? 0)) continue;
        if (!fits(garrisonBudget, recruitCost(kind)) || !sustainable(kind, 'garrison')) continue;
        picked = kind;
        k = (k + j + 1) % T.recruit.length;
        break;
      }
      if (!picked) break;
      take(garrisonBudget, picked, 'garrison');
      out.push({ type: 'recruit', region: i, kind: picked, to: 'garrison' });
      count++;
      orders++;
    }
  }
  // The field army, in the temperament's cycle.
  const army = fac.army;
  const units: CoreUnit[] = army ? army.units.map(u => ({ ...u })) : [];
  if (army && s.regions[army.region].owner === f) {
    for (const k of RESOURCES) armyBudget[k] += garrisonBudget[k];
    const factory = (s.regions[army.region].city.b.factory ?? 0) > 0;
    const cap = armyCapOf(s, f);
    let k = s.turn % T.recruit.length;
    const pick = (better: number): ArmyKind | null => {
      for (let j = 0; j < T.recruit.length; j++) {
        const kind = T.recruit[(k + j) % T.recruit.length];
        if (isVehicle(kind) && !factory) continue;
        if (unitValue(kind) < better || !fits(armyBudget, recruitCost(kind)) || !sustainable(kind, 'army')) continue;
        k = (k + j + 1) % T.recruit.length;
        return kind;
      }
      return null;
    };
    while (units.length < cap && orders < MAX) {
      const kind = pick(0);
      if (!kind) break;
      take(armyBudget, kind, 'army');
      out.push({ type: 'recruit', region: army.region, kind, to: 'army' });
      units.push({ kind, kills: 0 });
      orders++;
    }
    // Refit a full army. Room in the garrison counts the garrison recruits already ordered there
    // this turn: a station order that finds the garrison full fails, and every slot index after it
    // would then name a different unit.
    const queued = out.filter(a => a.type === 'recruit' && a.to === 'garrison' && a.region === army.region).length;
    let room = garrisonCap(s, army.region) - garrisonTotal(s.regions[army.region].garrison) - queued;
    while (units.length >= cap && orders < MAX - 1) {
      let slot = -1;
      for (let i = 0; i < units.length; i++) if (slot < 0 || unitValue(units[i].kind) * vetMul(units[i].kills) < unitValue(units[slot].kind) * vetMul(units[slot].kills)) slot = i;
      if (slot < 0) break;
      const weak = units[slot];
      const kind = pick(unitValue(weak.kind) * vetMul(weak.kills) + AI_REFIT_GAIN);
      if (!kind) break;
      if (room > 0) {
        out.push({ type: 'station', slot });
        room--;
      } else out.push({ type: 'disband', from: 'army', slot });
      if (isVehicle(weak.kind)) veh--;
      else inf--;
      units.splice(slot, 1);
      take(armyBudget, kind, 'army');
      out.push({ type: 'recruit', region: army.region, kind, to: 'army' });
      units.push({ kind, kills: 0 });
      orders += 2;
    }
  }
  return units;
}

function attackOrMove(s: PlanetState, f: FactionId, T: TemperamentSpec, temperament: Temperament, budget: Stock, units: CoreUnit[], out: PlanetAction[]): void {
  const fac = s.factions[f];
  const army = fac.army;
  if (!army || army.attacked) return;
  const m = planetMapOf(s);
  const supplied = suppliedRegions(s, f);
  // Credits: the most the alloys allow above the reserve, counted in the strength it brings.
  const spare = budget.alloys - AI_RESERVE.alloys;
  const credits = [...ATTACK_CREDITS].reverse().find(c => c / 250 <= spare) ?? 0;
  const A = units.length ? strengthOf(units) + credits / AI_CREDITS_PER_POINT : 0;
  const valueOf = (target: RegionId) => {
    const owner = s.regions[target].owner;
    const capital = owner !== NEUTRAL && s.factions[owner].capital === target;
    const cut = owner !== NEUTRAL && !suppliedRegions(s, owner)[target];
    // Taking a region from a rival weakens it as well; a rival close to winning is worth stopping.
    const lead = owner !== NEUTRAL ? AI_RIVAL_TARGET + AI_LEADER_TARGET * threatOf(s, owner) : 0;
    return yieldTotal(regionYield(s, target)) + 3 * s.regions[target].city.level + (capital ? 10 : 0) + (cut ? 5 : 0) + lead;
  };
  // Near a win, or late in the war, a faction takes longer odds.
  const late = Math.max(0, Math.min(1, (s.turn / s.options.turnLimit - 0.5) / 0.5));
  const boldness = (1 - AI_BOLD_LEAD * threatOf(s, f)) * (1 - AI_BOLD_LATE * late);
  const ratioOf = (target: RegionId) => (s.regions[target].owner === NEUTRAL ? T.neutralRatio : T.attackRatio) * boldness;
  // Where the army could stand this turn: its region and every owned region within its moves.
  const stands: RegionId[] = [];
  s.regions.forEach((reg, i) => {
    if (reg.owner !== f) return;
    if (i === army.region || armyPath(s, f, i)) stands.push(i);
  });
  let best: { target: RegionId; from: RegionId; value: number } | null = null;
  if (A > 0) {
    for (const from of stands) {
      for (const target of attackTargetsFrom(s, f, from)) {
        if (A / defenceEstimate(s, target) < ratioOf(target)) continue;
        const value = valueOf(target);
        if (!best || value > best.value || (value === best.value && (target < best.target || (target === best.target && from === army.region)))) best = { target, from, value };
      }
    }
  }
  if (best) {
    const vehicles = armyCounts(units).vehicles;
    const fuel = 2 + Math.ceil(vehicles / 4);
    if (budget.fuel >= fuel && budget.alloys >= credits / 250) {
      if (best.from !== army.region) out.push({ type: 'moveArmy', to: best.from });
      out.push({ type: 'attack', target: best.target, credits: credits as 0 | 1000 | 2000 | 3000, heroes: [] });
      return;
    }
  }
  // Otherwise march toward the most promising target anywhere on the front: value scaled by how
  // near the army is to the strength it needs (section 12, step 6).
  const cap = fac.capital;
  let goal: RegionId | null = null;
  if (temperament === 'defensive' && s.regions[cap].owner === f && adjacentEnemy(s, f, cap, false) > garrisonStrength(s.regions[cap].garrison)) goal = cap;
  else if (A > 0) {
    let top = 0;
    s.regions.forEach((reg, i) => {
      if (reg.owner !== f || !supplied[i]) return;
      for (const target of attackTargetsFrom(s, f, i)) {
        const score = valueOf(target) * Math.min(1.5, A / (defenceEstimate(s, target) * ratioOf(target)));
        if (score > top) {
          top = score;
          goal = i;
        }
      }
    });
  }
  // A full army with weak units and nothing it dares attack goes to refit where vehicles are built.
  if (goal !== null && !(s.regions[army.region].city.b.factory ?? 0) && units.some(u => !isVehicle(u.kind)) && fac.stock.alloys >= AI_RESERVE.alloys + 6 && fac.stock.fuel >= AI_RESERVE.fuel + 4) {
    const reach = A > 0 && attackTargetsFrom(s, f, goal).some(t => A / defenceEstimate(s, t) >= ratioOf(t));
    if (!reach) {
      let near = Infinity;
      s.regions.forEach((reg, i) => {
        if (reg.owner !== f || !supplied[i] || !(reg.city.b.factory ?? 0)) return;
        const d = hopsBetween(s, army.region, i);
        if (d < near) {
          near = d;
          goal = i;
        }
      });
    }
  }
  if (goal === null) {
    let most = 0;
    s.regions.forEach((reg, i) => {
      if (reg.owner !== f || !supplied[i]) return;
      const e = adjacentEnemy(s, f, i, true);
      if (e > most) {
        most = e;
        goal = i;
      }
    });
  }
  if (goal === null || goal === army.region || army.moved >= s.options.armyMove) return;
  const pass = (r: RegionId) => s.regions[r].owner === f || stanceOf(s, f, s.regions[r].owner) === 'alliance';
  // The shortest path, without the move limit; the army goes as far along it as it may this turn.
  const prev = new Map<RegionId, RegionId>();
  const q = [army.region];
  prev.set(army.region, army.region);
  for (let h = 0; h < q.length && !prev.has(goal); h++) {
    const r = q[h];
    const port = (s.regions[r].city.b.port ?? 0) > 0;
    for (const l of m.regions[r].links) {
      if (prev.has(l.to) || (l.sea && !port) || !pass(l.to)) continue;
      prev.set(l.to, r);
      q.push(l.to);
    }
  }
  if (!prev.has(goal)) return;
  const path: RegionId[] = [goal];
  while (path[0] !== army.region) path.unshift(prev.get(path[0])!);
  for (let k = Math.min(path.length - 1, s.options.armyMove - army.moved); k >= 1; k--) {
    if (s.regions[path[k]].owner === f && armyPath(s, f, path[k])) {
      out.push({ type: 'moveArmy', to: path[k] });
      return;
    }
  }
}

/** Offers waiting for the player, answered as a computer faction would judge them (the bot only). */
function answerOffers(s: PlanetState, out: PlanetAction[]): void {
  for (const o of s.offers) out.push({ type: 'answerOffer', id: o.id, accept: proposalVerdict(s, 0, o.from, o.draft).accept });
}

/**
 * The ordered orders of faction f this turn (section 12). With f = 0 and a temperament, the same
 * rules play the player (the harness and the ladder use it); the bot also answers offers.
 */
export function planAiActions(s: PlanetState, f: FactionId, temperament?: Temperament): PlanetAction[] {
  const out: PlanetAction[] = [];
  const fac = s.factions[f];
  if (!fac || !fac.alive || s.result) return out;
  if (s.pending.length) return out;
  const temp: Temperament = temperament ?? fac.temperament ?? 'expansionist';
  const T = temperament ? TEMPERAMENTS[temperament] : specOf(s, f);
  if (f === 0) answerOffers(s, out);
  diplomacy(s, f, T, out);
  research(s, f, T, out);
  const budget: Stock = { ...fac.stock };
  // Fuel for this turn's attack is set aside before anything else spends it.
  const attackFuel = fac.army ? 2 + Math.ceil(armyCounts(fac.army.units).vehicles / 4) : 0;
  budget.fuel -= attackFuel;
  // A faction at war with a neighbour arms before it builds.
  const front = s.factions.some(b => b.alive && b.id !== f && atWar(s, f, b.id) && borders(s, f, b.id) > 0);
  let units: CoreUnit[];
  if (front) {
    units = recruitment(s, f, T, budget, out);
    builds(s, f, T, budget, out);
    routes(s, f, budget, out);
  } else {
    builds(s, f, T, budget, out);
    routes(s, f, budget, out);
    units = recruitment(s, f, T, budget, out);
  }
  budget.fuel += attackFuel;
  attackOrMove(s, f, T, temp, budget, units, out);
  return out;
}

