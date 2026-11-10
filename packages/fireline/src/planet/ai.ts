/**
 * War for the Planet: the computer factions (fireline-planet-design.md, section 12). W1.
 *
 * `planAiActions(s, f)` returns an ordered list of actions; the end-turn loop applies them one at
 * a time through the same reducer checks, skipping any that are refused. Pure and deterministic:
 * the same state gives the same list. Every tie is broken by the lowest id, so no dice are drawn.
 * It keeps a running budget of its own so later orders in the list are mostly affordable.
 */
import { UPGRADE_LINE } from '../sim/rules';
import { attackCost, attackTargetsFrom, defenceEstimate, garrisonStrength, power, strengthOf } from './battleSetup';
import { buildBlock, buildCost, growCost } from './cities';
import { borders, proposalScore, proposalVerdict, specOf } from './diplomacy';
import { armyCapOf, armyCounts, factionIncome, garrisonCap, recruitCost, regionYield, yieldTotal } from './economy';
import { planetMapOf } from './map';
import { prerequisiteProblem, aiLoadouts } from './research';
import { AI_MAX_BUILDS, AI_MAX_PROPOSALS, AI_RESERVE, TEMPERAMENTS, VALUE, isVehicle, type AiBuild, type TemperamentSpec } from './rules';
import { atWar, garrisonTotal, stanceOf, treatyBetween } from './state';
import { armyPath, suppliedRegions } from './supply';
import type { PlanetAction } from './turn';
import { NEUTRAL, RESOURCES, type ArmyKind, type FactionId, type PlanetState, type RegionId, type Stock, type Temperament, type TreatyDraft } from './types';

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
  const pf = Math.max(1, power(s, f));
  const others = s.factions.filter(b => b.alive && b.id !== f);
  // Toward computer factions only with aiDiplomacy; the player (or the bot playing it) always negotiates.
  const talks = (b: FactionId) => s.options.aiDiplomacy || b === 0 || f === 0;
  let primary: FactionId | null = null;
  let low = Infinity;
  for (const b of others) {
    if (!talks(b.id) || borders(s, f, b.id) === 0 || s.trust[f][b.id] > 60) continue;
    const ratio = power(s, b.id) / pf;
    if (ratio < low) {
      low = ratio;
      primary = b.id;
    }
  }
  const fac = s.factions[f];
  const net = factionIncome(s, f).net;
  let proposals = 0;
  for (const b of others) {
    if (!talks(b.id) || proposals >= AI_MAX_PROPOSALS) continue;
    const st = stanceOf(s, f, b.id);
    const bonus = b.id === primary ? 0 : 10;
    const desire = (dr: TreatyDraft) => proposalScore(s, f, b.id, dr).score + bonus;
    const t = treatyBetween(s, f, b.id);
    // Break a truce with the weak primary target.
    if (T.mayBreak && st === 'ceasefire' && b.id === primary && pf >= 1.6 * power(s, b.id) && s.trust[f][b.id] <= 35) {
      out.push({ type: 'declareWar', on: b.id });
      continue;
    }
    let draft: TreatyDraft | null = null;
    if (st === 'war' && b.id !== primary) {
      const dr: TreatyDraft = { kind: 'ceasefire', turns: 6, terms: [] };
      if (desire(dr) >= 15) draft = dr;
    } else if (st === 'ceasefire') {
      const dr: TreatyDraft = { kind: 'trade', turns: null, terms: [] };
      if (desire(dr) >= 15 && s.trust[f][b.id] >= 45) draft = dr;
    } else if (st === 'trade' && t && s.turn - t.since >= 3) {
      const dr: TreatyDraft = { kind: 'alliance', turns: null, terms: [] };
      if (desire(dr) >= 30 && s.trust[f][b.id] >= T.allianceTrust) draft = dr;
    }
    if (!draft && t && (st === 'trade' || st === 'alliance') && !t.terms.some(x => x.k === 'exchange') && t.terms.length < 4) {
      const deficit = RESOURCES.find(r => fac.stock[r] < 10 && net[r] < 0);
      const surplus = [...RESOURCES].filter(r => fac.stock[r] > 30 && r !== deficit).sort((p, q) => fac.stock[q] - fac.stock[p])[0];
      if (deficit && surplus) {
        const get = Math.max(1, Math.floor((3 * VALUE[surplus]) / VALUE[deficit] / T.exchangeMargin));
        draft = {
          kind: t.kind,
          turns: t.ends === null ? null : Math.max(t.kind === 'trade' ? 5 : 10, t.ends - s.turn + 1),
          terms: [...t.terms.filter(x => x.k !== 'payment'), { k: 'exchange', from: f, give: surplus, giveAmount: 3, get: deficit, getAmount: Math.min(20, get) }],
        };
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

const above = (budget: Stock, cost: Stock): boolean => RESOURCES.every(k => budget[k] - cost[k] >= AI_RESERVE[k]);
const spend = (budget: Stock, cost: Stock) => RESOURCES.forEach(k => (budget[k] -= cost[k]));

function builds(s: PlanetState, f: FactionId, T: TemperamentSpec, budget: Stock, out: PlanetAction[]): void {
  const net = factionIncome(s, f).net;
  let list: AiBuild[] = T.build;
  if (net.food < 0) list = ['farms', ...T.build.filter(b => b !== 'farms')];
  const regions = s.regions
    .map((reg, i) => ({ reg, i }))
    .filter(x => x.reg.owner === f && x.reg.city.built !== s.turn)
    .map(x => ({ i: x.i, y: yieldTotal(regionYield(s, x.i)) }))
    .sort((p, q) => q.y - p.y || p.i - q.i);
  let n = 0;
  for (const { i } of regions) {
    if (n >= AI_MAX_BUILDS) break;
    for (const item of list) {
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

/** Recruitment (section 12, step 4). Returns the kinds added to the army, for the attack estimate. */
function recruitment(s: PlanetState, f: FactionId, T: TemperamentSpec, budget: Stock, out: PlanetAction[]): ArmyKind[] {
  const fac = s.factions[f];
  const net = factionIncome(s, f).net;
  let food = net.food;
  let fuel = net.fuel;
  let inf = 0;
  let veh = 0;
  const avail: Stock = { ore: 0, fuel: 0, alloys: 0, food: 0 };
  for (const k of RESOURCES) avail[k] = Math.max(0, budget[k] - AI_RESERVE[k]);
  const garrisonBudget: Stock = { ore: 0, fuel: 0, alloys: 0, food: 0 };
  for (const k of RESOURCES) garrisonBudget[k] = Math.floor(avail[k] * T.garrisonShare);
  const armyBudget: Stock = { ore: 0, fuel: 0, alloys: 0, food: 0 };
  for (const k of RESOURCES) armyBudget[k] = avail[k] - garrisonBudget[k];
  const fits = (b: Stock, c: Stock) => RESOURCES.every(k => b[k] >= c[k]);
  const sustainable = (kind: ArmyKind) => (isVehicle(kind) ? fuel - (veh % 2 === 0 ? 1 : 0) >= 0 : food - (inf % 3 === 0 ? 1 : 0) >= 0);
  const take = (b: Stock, kind: ArmyKind) => {
    const c = recruitCost(kind);
    for (const k of RESOURCES) {
      b[k] -= c[k];
      budget[k] -= c[k];
    }
    if (isVehicle(kind)) {
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
  for (const { i } of borderRegions) {
    const cap = Math.floor(0.6 * garrisonCap(s, i));
    let count = garrisonTotal(s.regions[i].garrison);
    let k = 0;
    while (count < cap && orders < MAX) {
      let picked: ArmyKind | null = null;
      for (let j = 0; j < T.recruit.length; j++) {
        const kind = T.recruit[(k + j) % T.recruit.length];
        if (isVehicle(kind) && (!(s.regions[i].city.b.factory ?? 0) || net.fuel < 0)) continue;
        if (!fits(garrisonBudget, recruitCost(kind)) || !sustainable(kind)) continue;
        picked = kind;
        k = (k + j + 1) % T.recruit.length;
        break;
      }
      if (!picked) break;
      take(garrisonBudget, picked);
      out.push({ type: 'recruit', region: i, kind: picked, to: 'garrison' });
      count++;
      orders++;
    }
  }
  // The field army, in the temperament's cycle.
  const added: ArmyKind[] = [];
  const army = fac.army;
  if (army && s.regions[army.region].owner === f) {
    for (const k of RESOURCES) armyBudget[k] += garrisonBudget[k];
    const factory = (s.regions[army.region].city.b.factory ?? 0) > 0;
    let size = army.units.length;
    let k = s.turn % T.recruit.length;
    while (size < armyCapOf(s, f) && orders < MAX) {
      let picked: ArmyKind | null = null;
      for (let j = 0; j < T.recruit.length; j++) {
        const kind = T.recruit[(k + j) % T.recruit.length];
        if (isVehicle(kind) && (!factory || net.fuel < 0)) continue;
        if (!fits(armyBudget, recruitCost(kind)) || !sustainable(kind)) continue;
        picked = kind;
        k = (k + j + 1) % T.recruit.length;
        break;
      }
      if (!picked) break;
      take(armyBudget, picked);
      out.push({ type: 'recruit', region: army.region, kind: picked, to: 'army' });
      added.push(picked);
      size++;
      orders++;
    }
  }
  return added;
}

function attackOrMove(s: PlanetState, f: FactionId, T: TemperamentSpec, temperament: Temperament, budget: Stock, added: ArmyKind[], out: PlanetAction[]): void {
  const fac = s.factions[f];
  const army = fac.army;
  if (!army || army.attacked) return;
  const units = [...army.units, ...added.map(kind => ({ kind, kills: 0 }))];
  const A = strengthOf(units);
  const m = planetMapOf(s);
  const supplied = suppliedRegions(s, f);
  // Where the army could stand this turn: its region and every owned region within its moves.
  const stands: RegionId[] = [];
  s.regions.forEach((reg, i) => {
    if (reg.owner !== f) return;
    if (i === army.region || armyPath(s, f, i)) stands.push(i);
  });
  let best: { target: RegionId; from: RegionId; value: number } | null = null;
  if (A > 0 && units.length) {
    for (const from of stands) {
      for (const target of attackTargetsFrom(s, f, from)) {
        const owner = s.regions[target].owner;
        const ratio = owner === NEUTRAL ? T.neutralRatio : T.attackRatio;
        if (A / defenceEstimate(s, target) < ratio) continue;
        const capital = owner !== NEUTRAL && s.factions[owner].capital === target;
        const cut = owner !== NEUTRAL && !suppliedRegions(s, owner)[target];
        const value = yieldTotal(regionYield(s, target)) + 3 * s.regions[target].city.level + (capital ? 10 : 0) + (cut ? 5 : 0);
        if (!best || value > best.value || (value === best.value && (target < best.target || (target === best.target && from === army.region)))) best = { target, from, value };
      }
    }
  }
  if (best) {
    const vehicles = armyCounts(units).vehicles;
    const credits = budget.alloys - 4 >= AI_RESERVE.alloys ? 1000 : 0;
    const cost = attackCost({ ...s, factions: s.factions.map(x => (x.id === f && x.army ? { ...x, army: { ...x.army, units } } : x)) }, f, credits);
    if (budget.fuel >= cost.fuel && budget.alloys >= cost.alloys && vehicles >= 0) {
      if (best.from !== army.region) out.push({ type: 'moveArmy', to: best.from });
      out.push({ type: 'attack', target: best.target, credits: credits as 0 | 1000, heroes: [] });
      return;
    }
  }
  // Otherwise move one step toward the most threatened own region.
  const cap = fac.capital;
  let goal: RegionId | null = null;
  if (temperament === 'defensive' && s.regions[cap].owner === f && adjacentEnemy(s, f, cap, false) > garrisonStrength(s.regions[cap].garrison)) goal = cap;
  else {
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
  // First step of the shortest path, without the move limit.
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
  let step: RegionId = goal;
  while (prev.get(step) !== army.region) step = prev.get(step)!;
  out.push({ type: 'moveArmy', to: step });
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
  builds(s, f, T, budget, out);
  const added = recruitment(s, f, T, budget, out);
  attackOrMove(s, f, T, temp, budget, added, out);
  return out;
}

