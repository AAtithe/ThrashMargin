/**
 * War for the Planet, battle rules 3 (round 7, fireline-round7-planet.md): the links between the
 * war and its battles, both ways. Every link has a measured case and a refusal case (the rule not
 * firing where it should not, or a report claiming more than it may refused); wars on battle rules
 * 1 and 2 give the hashes recorded from the build before battle rules 3; a war on battle rules 3
 * replays exactly; a save holding a battle rules 3 setup migrates to itself. scripts/drive-planet.ts
 * runs these sections and counts them in its totals; the whole-war checks there (every turn, the
 * 48 KB budget, all three presets) play new wars, which are on battle rules 3.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { planAiActions } from '../src/planet/ai';
import { buildPlanetBattle, planetBattleReport, simulateBattle } from '../src/planet/battle';
import { attackCost, attackTargets, battleSetupFor, defenceEstimate } from '../src/planet/battleSetup';
import { attackEdge, isShaken, supplyOf, supportFor } from '../src/planet/links';
import { hopsFrom, planetMapOf } from '../src/planet/map';
import { quickResolve, sideStrength } from '../src/planet/resolve';
import {
  BATTLE_RULES,
  DECISIVE_TRUST,
  REINFORCE_MAX,
  REPAIR_COST,
  RETURN_CREDITS_PER_ORE,
  RETURN_MAX,
  SUPPLY_EFFECT,
  TIME_BASE,
  TIME_PER_LEVEL,
  WALLS_PER_FORT_MK,
  WOUNDED_HP,
} from '../src/planet/rules';
import { migratePlanetSave, newPlanetSave } from '../src/planet/save';
import { newPlanetState } from '../src/planet/state';
import { applyPlanetAction, planetActionProblem } from '../src/planet/turn';
import { ARMY_KINDS, NEUTRAL, type BattleReport, type BattleSetup, type BattleUnit, type PlanetState, type RegionId, type ReportLinks } from '../src/planet/types';
import { processAction } from '../src/sim/actions';
import { placeNear } from '../src/sim/mission';
import { TICKS_PER_SECOND } from '../src/sim/rules';
import { maxHpOf } from '../src/sim/state';
import type { GameState } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const json = (x: unknown) => JSON.stringify(x);
const hash = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const ids = (i: number) => ({ id: `links-${i}`, name: `Links ${i}`, createdAt: 1700000000000 + i });
const rich = () => ({ ore: 99, fuel: 99, alloys: 99, food: 99 });

function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}

// ---- The scenario ---------------------------------------------------------------------------------

/**
 * A Long war on battle rules 3, everyone at war, full stocks, every city building of faction f's
 * regions removed, and a chain on land: f's capital C, then Y and X given to f, then the target T
 * (independent, three riflemen and a rocketeer). X and T are not next to C; f's field army (four
 * riflemen, two tanks) stands at X. So the attack from X is supplied, with no depot and no support,
 * until a test adds one.
 */
interface Scene {
  w: PlanetState;
  f: number;
  C: RegionId;
  Y: RegionId;
  X: RegionId;
  T: RegionId;
}

function scene(seed: string, f = 0): Scene | null {
  const w: PlanetState = copy(newPlanetState({ seedText: seed, preset: 'long', difficulty: 'normal', commander: 'Tester', createdAt: 0 }));
  w.treaties = [];
  for (const x of w.factions) x.stock = rich();
  const m = planetMapOf(w);
  const capitals = new Set(w.factions.map(x => x.capital));
  const land = (r: RegionId) => m.regions[r].links.filter(l => !l.sea).map(l => l.to);
  const C = w.factions[f].capital;
  const nearC = new Set([C, ...m.regions[C].links.map(l => l.to)]);
  for (const Y of land(C)) {
    if (capitals.has(Y)) continue;
    for (const X of land(Y)) {
      if (nearC.has(X) || capitals.has(X)) continue;
      for (const T of land(X)) {
        if (nearC.has(T) || capitals.has(T) || T === Y) continue;
        const give = (r: RegionId, o: number) => {
          w.regions[r].owner = o;
          w.regions[r].city = { level: 1, b: {}, built: -1 };
          w.regions[r].garrison = ARMY_KINDS.map(() => 0);
          w.regions[r].cut = 0;
        };
        give(Y, f);
        give(X, f);
        give(T, NEUTRAL);
        w.regions[T].garrison[0] = 3;
        w.regions[T].garrison[1] = 1;
        for (const r of w.regions) if (r.owner === f) r.city.b = {};
        w.factions[f].army = { region: X, units: [...Array.from({ length: 4 }, () => ({ kind: 'rifleman' as const, kills: 0 })), { kind: 'tank', kills: 0 }, { kind: 'tank', kills: 0 }], moved: 0, attacked: false };
        return { w, f, C, Y, X, T };
      }
    }
  }
  return null;
}

function firstScene(prefix: string, f = 0): Scene {
  for (let k = 0; k < 60; k++) {
    const sc = scene(`${prefix}-${k}`, f);
    if (sc) return sc;
  }
  throw new Error(`no scene for ${prefix}`);
}

const setupOf = (sc: Scene, w: PlanetState = sc.w, credits = 1000) => battleSetupFor(w, sc.f, sc.T, credits, [], 50);

/** A report for a setup: the given winner, everyone surviving unless told otherwise, links as given. */
function report(setup: BattleSetup, winner: 'attacker' | 'defender', links: Partial<ReportLinks> = {}, survivors?: (BattleUnit[] | undefined)[], how: BattleReport['how'] = 'fought'): BattleReport {
  return {
    battleId: setup.battleId,
    winner,
    how,
    ticks: setup.timeLimit,
    sides: setup.sides.map((side, i) => ({ faction: side.faction, survivors: survivors?.[i] ?? side.units.map(u => ({ kind: u.kind, kills: u.kills, core: u.core })), heroes: [] })),
    cityDamage: {},
    cityLevelLost: winner === 'attacker' ? 1 : 0,
    links: { built: [], credits: setup.sides.map(() => 0), harvested: setup.sides.map(() => 0), wounded: setup.sides.map(() => []), ...links },
  };
}

/** The scene's attack made and being fought, ready for a report. */
function fighting(sc: Scene, w: PlanetState = sc.w): PlanetState {
  const a = applyPlanetAction(w, { type: 'attack', target: sc.T, credits: 1000, heroes: [] });
  if (a === w) throw new Error(`attack refused: ${planetActionProblem(w, { type: 'attack', target: sc.T, credits: 1000, heroes: [] })}`);
  return applyPlanetAction(a, { type: 'fight' });
}

// ---- Link 1: supply and logistics ------------------------------------------------------------------

function supplyTests(ok: Ok): void {
  const sc = firstScene('links-supply');
  const { w, X, C, Y } = sc;
  ok(BATTLE_RULES === 3 && newPlanetState({ seedText: 'links-new', preset: 'short', difficulty: 'normal', commander: 'T', createdAt: 0 }).battleRules === 3, 'a new war is on battle rules 3');
  const base = setupOf(sc)!;
  ok(base.links?.supply === 'supplied' && base.links.creditsLost === 0 && base.links.trickle === 100 && base.links.reinforce === null, `supplied: no change (${json(base.links)})`);
  const atk = base.sides.find(x => x.role === 'attacker')!;
  ok(atk.credits === 2500 + 1000 && atk.units.every(u => u.hp === undefined), `supplied: credits ${atk.credits}, every unit at full health`);

  // Short: fuel left below 2 once the attack is paid.
  const short = copy(w);
  short.factions[0].stock.fuel = attackCost(short, 0, 1000).fuel + 1;
  const ss = setupOf(sc, short)!;
  const sAtk = ss.sides.find(x => x.role === 'attacker')!;
  ok(ss.links?.supply === 'short' && sAtk.credits === Math.round(3500 * SUPPLY_EFFECT.short.credits) && ss.links.trickle === 75, `short of fuel: ${sAtk.credits} credits, harvest ${ss.links?.trickle}%`);
  const sFood = copy(w);
  sFood.factions[0].stock.food = 1;
  ok(setupOf(sc, sFood)!.links?.supply === 'short', 'short of food too');

  // Cut: Y goes to faction 1, so X has no route home.
  const cut = copy(w);
  cut.regions[Y].owner = 1;
  for (const l of planetMapOf(cut).regions[X].links) if (cut.regions[l.to].owner === 0 && l.to !== C) cut.regions[l.to].owner = NEUTRAL;
  const cs = setupOf(sc, cut)!;
  const cAtk = cs.sides.find(x => x.role === 'attacker')!;
  ok(cs.links?.supply === 'cut' && cAtk.credits === Math.round(3500 * SUPPLY_EFFECT.cut.credits) && cs.links.creditsLost === 3500 - cAtk.credits, `cut off: ${cAtk.credits} credits (${cs.links?.creditsLost} lost)`);
  ok(cAtk.units.filter(u => u.kind === 'tank').every(u => u.hp === SUPPLY_EFFECT.cut.vehicleHp) && cAtk.units.filter(u => u.kind === 'rifleman').every(u => u.hp === undefined), 'cut off: tanks arrive at 60%, infantry whole');
  ok(sideStrength(cs, cs.sides.indexOf(cAtk)) < sideStrength(base, base.sides.indexOf(atk)), `cut off: auto-resolve strength falls (${sideStrength(cs, cs.sides.indexOf(cAtk)).toFixed(1)} against ${sideStrength(base, base.sides.indexOf(atk)).toFixed(1)})`);
  const g = buildPlanetBattle(cs, ids(1), { autopilot: true });
  const seat = cs.sides.indexOf(cAtk);
  const tanks = g.units.filter(u => u.owner === seat && u.kind === 'tank');
  ok(tanks.length === 2 && tanks.every(u => Math.abs(u.hp / maxHpOf(u) - 0.6) < 0.02), `cut off: tanks placed at ${tanks.map(u => Math.round((100 * u.hp) / maxHpOf(u))).join(', ')}% health`);
  const mul = seat === 0 ? g.perks?.harvestMul : g.sidePerks?.[seat as 1]?.harvestMul;
  ok(mul === 0.5, `cut off: the attacker harvests at half (${mul})`);
  const perks = seat === 0 ? g.perks : g.sidePerks?.[seat as 1];
  ok(!!perks && perks.buildSpeedMul === 1 && perks.costMul === 1 && perks.unitHpMul === 1 && perks.powerCooldownMul === 1 && perks.extraStartCredits === 0, 'cut off: the harvest rate is the only perk it touches');
  const gs = buildPlanetBattle(base, ids(3), { autopilot: true });
  ok(gs.sidePerks === undefined && json(gs.perks ?? null) === json(base.perks ?? null), 'refused: a supplied attack changes no perks (the commander\'s own stand)');

  // Depot: the capital next door (Y is next to C, so attacking from Y is a depot), or a port at X.
  const port = copy(w);
  port.regions[X].city.b.port = 1;
  port.regions[X].garrison[5] = 2; // two tanks
  port.regions[X].garrison[0] = 4; // and four riflemen: the cap of a level 1 city
  const ps = setupOf(sc, port)!;
  ok(ps.links?.supply === 'depot', 'a port where the army stands is a depot');
  const wave = ps.links!.reinforce!;
  ok(wave && wave.units.length === Math.min(REINFORCE_MAX, 3) && wave.units[0] === 'tank' && wave.units[1] === 'tank' && wave.units[2] === 'rifleman', `the wave: ${wave?.units.join(', ')} (half the garrison of 6, most valuable first)`);
  ok(wave.at === Math.round(ps.timeLimit * 0.25), `the wave arrives at a quarter of the time limit (${wave.at} of ${ps.timeLimit})`);
  const viaCap = copy(w);
  viaCap.factions[0].army!.region = Y;
  ok(supplyOf(viaCap, 0, Y, attackCost(viaCap, 0, 0)) === 'depot', 'a staging region next to the capital is a depot');
  ok(supplyOf(viaCap, 0, X, attackCost(viaCap, 0, 0)) === 'supplied', 'one further out is not');
  // The wave leaves the garrison when the battle is made, arrives in the battle, and comes home if it never arrived.
  const made = applyPlanetAction(port, { type: 'attack', target: sc.T, credits: 1000, heroes: [] });
  ok(made !== port && made.regions[X].garrison[5] === 0 && made.regions[X].garrison[0] === 3, `the wave leaves the staging garrison (tanks ${made.regions[X].garrison[5]}, riflemen ${made.regions[X].garrison[0]})`);
  let gb = buildPlanetBattle(ps, ids(2), { autopilot: true });
  const pseat = ps.sides.findIndex(x => x.role === 'attacker');
  const count = (s: GameState) => s.units.filter(u => u.owner === pseat && u.kind !== 'hauler' && !u.hero).length;
  const before = count(gb);
  for (let left = wave.at - 1; left > 0; left -= Math.min(600, left)) gb = processAction(gb, { type: 'tick', n: Math.min(600, left) });
  const justBefore = count(gb);
  gb = processAction(gb, { type: 'tick', n: 2 });
  ok(gb.planet?.reinforce?.length === 0 && count(gb) >= justBefore + wave.units.length - 1, `the wave marches in at tick ${wave.at} (${before} at the start, ${justBefore} just before, ${count(gb)} after)`);
  const f = applyPlanetAction(made, { type: 'fight' });
  const early = { ...report(made.pending[0].setup, 'defender'), ticks: wave.at - 1 };
  const back = applyPlanetAction(f, { type: 'battleResult', report: early });
  ok(back !== f && back.regions[X].garrison[5] === 2 && back.regions[X].garrison[0] === 4, 'a battle over before the wave arrives sends it home');
  const quick = applyPlanetAction(made, { type: 'autoResolve' });
  ok(quick !== made && quick.regions[X].garrison[5] === 0, 'an auto-resolved battle counts the wave as arrived');
  // Called off: the wave goes home. Faction 1 takes the target first.
  const off = copy(made);
  off.regions[sc.T].owner = 1;
  off.pending[0].defender = NEUTRAL;
  ok(off.regions[X].garrison[5] === 0, 'the wave is out while the battle waits');

  // Refusals: an older war has none of it.
  for (const rules of [undefined, 2] as const) {
    const old = copy(cut);
    if (rules === undefined) delete old.battleRules;
    else old.battleRules = rules;
    const os = setupOf(sc, old)!;
    ok(!('links' in os) && os.sides.find(x => x.role === 'attacker')!.credits === 3500 && os.timeLimit === old.options.battleMinutes * 60 * TICKS_PER_SECOND, `battle rules ${rules ?? 1}: no links, full credits and the plain time limit, cut off or not`);
    const om = applyPlanetAction({ ...copy(port), battleRules: rules }, { type: 'attack', target: sc.T, credits: 1000, heroes: [] });
    ok(om.regions[X].garrison[5] === 2, `battle rules ${rules ?? 1}: no wave leaves the garrison`);
  }
}

// ---- Link 2: support from neighbouring regions -----------------------------------------------------

function supportTests(ok: Ok): void {
  const sc = firstScene('links-support');
  const { w, X, Y, T } = sc;
  const d = hopsFrom(planetMapOf(w), [T]);
  ok(d[X] === 1 && d[Y] === 2, `the scene: X ${d[X]} hop, Y ${d[Y]} hops from the target`);
  ok(setupOf(sc)!.links!.support.length === 0, 'no support without buildings near');
  const grants = (mut: (x: PlanetState) => void) => {
    const x = copy(w);
    mut(x);
    return setupOf(sc, x)!.links!.support;
  };
  let g = grants(x => (x.regions[Y].city = { level: 2, b: { institute: 2 }, built: -1 }));
  ok(g.length === 1 && g[0].power === 'recon' && g[0].uses === undefined && g[0].from === Y && g[0].why === 'institute', `an institute Mk 2 two hops away gives the recon sweep (${json(g)})`);
  ok(grants(x => (x.regions[Y].city = { level: 2, b: { institute: 1 }, built: -1 })).length === 0, 'refused: an institute Mk 1 gives nothing');
  g = grants(x => (x.regions[Y].city = { level: 3, b: { fortifications: 3 }, built: -1 }));
  ok(g.length === 1 && g[0].power === 'barrage' && g[0].uses === undefined && g[0].why === 'fortifications', 'a citadel (fortifications Mk 3) gives the barrage, unlimited');
  ok(grants(x => (x.regions[Y].city = { level: 2, b: { fortifications: 2 }, built: -1 })).length === 0, 'refused: fortifications Mk 2 give nothing');
  g = grants(x => (x.regions[X].garrison[6] = 2));
  ok(g.length === 1 && g[0].power === 'barrage' && g[0].uses === 2 && g[0].from === X && g[0].why === 'artillery', 'two artillery pieces in an adjacent garrison: an off-map barrage with two uses');
  g = grants(x => (x.regions[X].garrison[6] = 9));
  ok(g[0].uses === 3, 'at most three uses');
  ok(grants(x => (x.regions[Y].garrison[6] = 4)).length === 0, 'refused: artillery two hops away fires no barrage');
  g = grants(x => (x.regions[Y].city = { level: 2, b: { airfield: 2 }, built: -1 }));
  ok(g.length === 1 && g[0].power === 'missile' && g[0].uses === 2, 'an airfield Mk 2 within two hops: two air strikes');
  ok(setupOf(sc, (() => { const x = copy(w); x.regions[Y].city.b = { airfield: 1 }; return x; })())!.sides.find(s => s.role === 'attacker')!.structures.includes('helipad'), 'the airfield still gives the helipad');
  // Further than two hops: nothing. The defender's own city is never its own neighbour.
  const far = copy(w);
  const r3 = far.regions.findIndex((r, i) => r.owner === 0 && d[i] >= 3);
  if (r3 >= 0) {
    far.regions[r3].city = { level: 3, b: { institute: 3, fortifications: 3, airfield: 3 }, built: -1 };
    ok(setupOf(sc, far)!.links!.support.length === 0, 'refused: buildings three hops away give nothing');
  }
  ok(supportFor(w, 0, X, 0, []).every(x => x.from !== X), 'a target never supports itself');
  // A power the side's own structures give is not granted twice.
  ok(supportFor({ ...copy(w), regions: grantsRegions(w, Y) }, 0, T, 0, ['uplink']).every(x => x.power !== 'recon'), 'refused: no recon support for a side that has an uplink');

  // In the engine: granted, kept without a structure, and a limited one spent by use.
  const x = copy(w);
  x.regions[X].garrison[6] = 1;
  x.regions[Y].city = { level: 2, b: { institute: 2 }, built: -1 };
  const st = setupOf(sc, x)!;
  const seat = st.sides.findIndex(s => s.role === 'attacker');
  ok(seat === 0 && st.sides[0].human, 'the player attacks from seat 0');
  let gb = buildPlanetBattle(st, ids(10));
  ok(gb.powers?.[0]?.recon !== undefined && gb.powers?.[0]?.barrage !== undefined && json(gb.planet?.support) === json([{ seat: 0, power: 'recon' }, { seat: 0, power: 'barrage', uses: 1 }]), `support powers granted (${json(gb.powers?.[0])})`);
  gb = processAction(gb, { type: 'tick', n: 60 });
  ok(gb.powers?.[0]?.recon !== undefined && gb.powers?.[0]?.barrage !== undefined, 'kept after 60 ticks without an uplink or a tech centre');
  const ready: GameState = copy(gb);
  ready.powers![0] = { ...ready.powers![0], barrage: 0 };
  const fired = processAction(ready, { type: 'power', power: 'barrage', x: ready.mapW / 2, y: ready.mapH / 2 });
  ok(fired !== ready && fired.powers?.[0]?.barrage === undefined && !fired.planet!.support!.some(s => s.power === 'barrage'), 'the one-use barrage is spent');
  const again = processAction(fired, { type: 'power', power: 'barrage', x: 5, y: 5 });
  ok(again === fired, 'refused: a spent barrage cannot be called again');
  const twice: GameState = copy(gb);
  twice.planet!.support = [{ seat: 0, power: 'barrage', uses: 2 }];
  twice.powers![0] = { ...twice.powers![0], barrage: 0 };
  const once = processAction(twice, { type: 'power', power: 'barrage', x: 10, y: 10 });
  ok(once.planet!.support![0].uses === 1 && (once.powers?.[0]?.barrage ?? 0) > 0, 'a two-use barrage keeps one use, on cooldown');
  ok(sideStrength(st, 0) > sideStrength(setupOf(sc)!, 0), 'support adds to the auto-resolve strength');
}

/** The regions of w with an institute Mk 3 at r. */
function grantsRegions(w: PlanetState, r: RegionId) {
  const regs = copy(w.regions);
  regs[r].city = { level: 3, b: { institute: 3 }, built: -1 };
  return regs;
}

// ---- Links 3 and 4: the city, the defences and the attacker's base ----------------------------------

function cityTests(ok: Ok): void {
  const sc = firstScene('links-city');
  const { w, X, T } = sc;
  const base = setupOf(sc)!;
  const limit = w.options.battleMinutes * 60 * TICKS_PER_SECOND;
  ok(base.timeLimit === Math.round(limit * (TIME_BASE + TIME_PER_LEVEL)), `a level 1 city: ${base.timeLimit / 600} minutes`);
  const big = copy(w);
  big.regions[T].city.level = 4;
  ok(setupOf(sc, big)!.timeLimit === Math.round(limit * (TIME_BASE + 4 * TIME_PER_LEVEL)) && setupOf(sc, big)!.timeLimit > base.timeLimit, `a level 4 city: ${setupOf(sc, big)!.timeLimit / 600} minutes`);
  // Prepared defences.
  ok(base.links!.walls === 0, 'no fortifications, no walls');
  const fort = copy(w);
  fort.regions[T].city = { level: 2, b: { fortifications: 2 }, built: -1 };
  const fs = setupOf(sc, fort)!;
  ok(fs.links!.walls === 2 * WALLS_PER_FORT_MK, `fortifications Mk 2: ${fs.links!.walls} sandbag posts`);
  const g = buildPlanetBattle(fs, ids(20));
  const ds = fs.defenderSeat;
  const walls = g.buildings.filter(b => b.owner === ds && b.kind === 'wall');
  const hq = g.buildings.find(b => b.owner === ds && b.kind === 'hq')!;
  const centre = { x: g.mapW / 2, y: g.mapH / 2 };
  const toCentre = (b: { x: number; y: number }) => Math.hypot(b.x - centre.x, b.y - centre.y);
  ok(walls.length >= fs.links!.walls - 2, `${walls.length} of ${fs.links!.walls} sandbag posts placed`);
  ok(walls.every(b => toCentre(b) < toCentre(hq)), 'every post stands in front of the Command Yard, toward the field');
  const g0 = buildPlanetBattle(base, ids(21));
  ok(!g0.buildings.some(b => b.owner === base.defenderSeat && b.kind === 'wall'), 'refused: no posts without fortifications');
  ok(defenceEstimate(fort, T) > defenceEstimate({ ...fort, battleRules: 2 }, T), 'the computer factions count the posts');
  // Shaken garrison.
  const sh = copy(w);
  sh.regions[T].garrison[0] = 8;
  const full = setupOf(sc, sh)!.sides[1].units.length;
  sh.regions[T].shaken = sh.turn;
  ok(isShaken(sh, T) && setupOf(sc, sh)!.sides[1].units.length === Math.floor(full * 0.75), `a shaken garrison brings ${setupOf(sc, sh)!.sides[1].units.length} of ${full}`);
  sh.regions[T].shaken = sh.turn - 1;
  ok(!isShaken(sh, T) && setupOf(sc, sh)!.sides[1].units.length === full, 'refused: no longer shaken after its turn');
  // The defender's research applies (as before): a faction defender brings its upgrades.
  // The attacker's base reflects the staging region (link 4).
  const atk = base.sides.find(x => x.role === 'attacker')!;
  ok(json(atk.structures) === json(['hq', 'power', 'power', 'barracks']), `an empty staging city: no refinery and no War Factory (${atk.structures.join(', ')})`);
  const rich2 = copy(w);
  rich2.regions[X].city = { level: 3, b: { refinery: 3, factory: 2 }, built: -1 };
  const rs = setupOf(sc, rich2)!.sides.find(x => x.role === 'attacker')!;
  ok(json(rs.structures) === json(['hq', 'power', 'power', 'barracks', 'refinery', 'refinery', 'factory', 'repairbay']) && rs.cityTags.every(t => t === null), `refinery Mk 3 and factory Mk 2: ${rs.structures.join(', ')}`);
  const old = copy(w);
  old.battleRules = 2;
  ok(json(setupOf(sc, old)!.sides.find(x => x.role === 'attacker')!.structures) === json(['hq', 'power', 'power', 'refinery', 'barracks', 'factory']), 'refused on battle rules 2: the fixed base');
  // The defender cut off from its capital fights with less.
  const dsc = firstScene('links-defcut', 1);
  const dw = copy(dsc.w);
  // The player attacks faction 1's X from T, which the player is given.
  dw.regions[dsc.T].owner = 0;
  dw.factions[0].army!.region = dsc.T;
  const ok1 = battleSetupFor(dw, 0, dsc.X, 0, [], 60)!;
  dw.regions[dsc.Y].owner = 2;
  const cut1 = battleSetupFor(dw, 0, dsc.X, 0, [], 60)!;
  ok(!ok1.links!.defCut && cut1.links!.defCut && cut1.sides[cut1.defenderSeat].credits === Math.round(ok1.sides[ok1.defenderSeat].credits * 0.75), `a defender cut off from its capital: ${cut1.sides[cut1.defenderSeat].credits} credits against ${ok1.sides[ok1.defenderSeat].credits}`);
}

// ---- Links 5 to 8: the battle into the war ------------------------------------------------------------

function returnTests(ok: Ok): void {
  const sc = firstScene('links-return');
  const { X, T } = sc;
  const w = copy(sc.w);
  w.regions[T].city.level = 2;
  const f = fighting(sc, w);
  const setup = f.pending[0].setup;
  const atkSeat = setup.sides.findIndex(x => x.role === 'attacker');
  const apply = (r: BattleReport) => applyPlanetAction(f, { type: 'battleResult', report: r });

  // Link 5: structures built in the battle seed the captured city.
  let a = apply(report(setup, 'attacker', { built: ['refinery', 'factory'] }));
  ok(a !== f && a.regions[T].owner === 0 && a.regions[T].city.b.refinery === 1 && a.regions[T].city.b.factory === 1, `won with a refinery and a War Factory standing: ${json(a.regions[T].city.b)}`);
  ok(a.journal.some(e => /stands: Refinery district Mk 1, Factory Mk 1/.test(e.text)), 'the journal records the seeded buildings');
  a = apply(report(setup, 'defender', { built: ['refinery'] }));
  ok(a.regions[T].owner === NEUTRAL && !a.regions[T].city.b.refinery, 'refused: a lost battle seeds nothing');
  ok(apply(report(setup, 'attacker', { built: ['farms' as never] })) === f, 'refused: a report seeding farms');
  ok(apply(report(setup, 'attacker', { built: ['refinery', 'refinery'] })) === f, 'refused: a report seeding one building twice');
  const full = copy(f);
  full.regions[T].city = { level: 1, b: { farms: 1, port: 1 }, built: -1 };
  full.pending[0].setup.cityBuildings = { farms: 1, port: 1 };
  const fa = applyPlanetAction(full, { type: 'battleResult', report: report(full.pending[0].setup, 'attacker', { built: ['refinery'] }) });
  ok(fa !== full && !fa.regions[T].city.b.refinery, 'refused: no room in the city, no seed (bounded by the city)');
  // In the engine: a refinery the attacker builds and keeps is reported.
  let g = buildPlanetBattle(setup, ids(30), { autopilot: true });
  const home = g.buildings.find(b => b.owner === atkSeat && b.kind === 'hq')!;
  const extra = placeNear(g, atkSeat as 0, 'refinery', { x: home.x, y: home.y });
  g.winner = atkSeat as 0;
  let rep = planetBattleReport(setup, g)!;
  ok(!!extra && rep.links?.built.includes('refinery') && !rep.links.built.includes('factory'), `a battle where the attacker built a refinery reports it (${json(rep.links?.built)})`);
  g = buildPlanetBattle(setup, ids(31), { autopilot: true });
  g.winner = atkSeat as 0;
  rep = planetBattleReport(setup, g)!;
  ok(rep.links?.built.length === 0, 'refused: the structures it brought are not reported as built');

  // Link 6: the winners' credits and harvest come home as ore.
  const credits = setup.sides.map(() => 0);
  const harvested = setup.sides.map(() => 0);
  credits[atkSeat] = 2000;
  harvested[atkSeat] = 1200;
  const ore0 = f.factions[0].stock.ore;
  a = apply(report(setup, 'attacker', { credits, harvested }));
  const want = Math.floor(2000 / RETURN_CREDITS_PER_ORE) + Math.floor(1200 / RETURN_CREDITS_PER_ORE);
  ok(a.factions[0].stock.ore === ore0 + want, `won with 2,000 credits unspent and 1,200 harvested: +${a.factions[0].stock.ore - ore0} ore (want ${want})`);
  credits[atkSeat] = 1e6;
  ok(apply(report(setup, 'attacker', { credits })).factions[0].stock.ore === ore0 + RETURN_MAX, `capped at ${RETURN_MAX}`);
  ok(apply(report(setup, 'defender', { credits, harvested })).factions[0].stock.ore === ore0, 'refused: the loser keeps nothing');
  const retreat = { ...report(setup, 'defender', { credits, harvested }), how: 'retreat' as const, ticks: 100 };
  ok(applyPlanetAction(f, { type: 'battleResult', report: retreat }).factions[0].stock.ore === ore0, 'refused: nothing from a retreat');
  ok(apply(report(setup, 'attacker', { credits: [1.5, 0] as number[] })) === f, 'refused: a report with credits that are not whole numbers');
  const q = applyPlanetAction(applyPlanetAction(w, { type: 'attack', target: T, credits: 1000, heroes: [] }), { type: 'autoResolve' });
  ok(q.factions[0].stock.ore === w.factions[0].stock.ore, 'refused: an auto-resolve spends every credit');

  // Link 7: troops raised in the battle.
  const raised = (n: number) => Array.from({ length: n }, () => ({ kind: 'rifleman' as const, kills: 0, core: null }));
  const surv = setup.sides.map(() => undefined as BattleUnit[] | undefined);
  const core = setup.sides[atkSeat].units.map(u => ({ kind: u.kind, kills: u.kills, core: u.core }));
  surv[atkSeat] = [...core, ...raised(30)];
  surv[setup.defenderSeat] = [];
  a = apply(report(setup, 'attacker', {}, surv));
  const cap = a.options.armyCap;
  ok(a.regions[T].garrison[0] === 4 + 2 * a.regions[T].city.level && a.factions[0].army!.units.length === cap, `won with 30 riflemen raised: ${a.regions[T].garrison[0]} garrison the city (its cap), the army fills to ${a.factions[0].army!.units.length} of ${cap}`);
  surv[atkSeat] = [...core, ...raised(3)];
  surv[setup.defenderSeat] = undefined;
  a = apply(report(setup, 'defender', {}, surv));
  ok(a.factions[0].army!.units.length === core.length + 3 && a.regions[X].garrison[0] === 0, 'lost with 3 raised: they fall back with the army');
  surv[atkSeat] = [...core, ...raised(20)];
  a = apply(report(setup, 'defender', {}, surv));
  ok(a.factions[0].army!.units.length === cap && a.regions[X].garrison[0] === Math.min(20 - (cap - core.length), 4 + 2 * a.regions[X].city.level), `lost with 20 raised: the army fills, ${a.regions[X].garrison[0]} into the staging garrison`);
  const old = copy(f);
  old.battleRules = 2;
  delete old.pending[0].setup.links;
  const lostOld = applyPlanetAction(old, { type: 'battleResult', report: { ...report(old.pending[0].setup, 'defender', {}, surv), links: undefined } });
  ok(lostOld !== old && lostOld.factions[0].army!.units.length === core.length, 'refused on battle rules 2: raised troops of a beaten attacker are lost, as before');
  ok(applyPlanetAction(old, { type: 'battleResult', report: report(old.pending[0].setup, 'defender') }) === old, 'refused: a report with links for a setup without them');

  // Link 7: wounds and repairs.
  const tankSlot = setup.sides[atkSeat].units.find(u => u.kind === 'tank')!.core!;
  const rifleSlot = setup.sides[atkSeat].units.find(u => u.kind === 'rifleman')!.core!;
  const wounded = setup.sides.map(() => [] as number[]);
  wounded[atkSeat] = [tankSlot];
  a = apply(report(setup, 'attacker', { wounded }));
  ok(a.factions[0].army!.units[tankSlot].w === 1 && a.factions[0].army!.units.filter(u => u.w).length === 1, 'a tank that ends below half health comes back wounded');
  wounded[atkSeat] = [rifleSlot];
  ok(apply(report(setup, 'attacker', { wounded })) === f, 'refused: a wounded rifleman (only vehicles are wounded)');
  wounded[atkSeat] = [tankSlot];
  const gone = report(setup, 'attacker', { wounded }, surv.map((x, i) => (i === atkSeat ? core.filter(u => u.core !== tankSlot) : undefined)));
  ok(apply(gone) === f, 'refused: a wounded unit that did not survive');
  // Next battle: the wounded tank arrives at half; End turn repairs it for ore and alloys.
  const w2 = copy(a);
  w2.factions[0].army!.attacked = false;
  const nb = planetMapOf(w2).regions[T].links.map(l => l.to).find(r => w2.regions[r].owner !== 0 && !w2.factions.some(x => x.capital === r));
  if (nb !== undefined) {
    const st2 = battleSetupFor(w2, 0, nb, 0, [], 70);
    const u = st2?.sides.find(x => x.role === 'attacker')!.units.find(x => x.core === tankSlot);
    ok(!!u && u.hp === WOUNDED_HP, `the wounded tank arrives at ${u?.hp}% in the next battle`);
  }
  const stock0 = { ...a.factions[0].stock };
  const e = applyPlanetAction(a, { type: 'endTurn' });
  ok(!e.factions[0].army!.units.some(x => x.w) && e.journal.some(j => /Workshops repair 1 wounded vehicle/.test(j.text)), 'End turn repairs it');
  const poor = copy(a);
  poor.factions[0].stock = { ...poor.factions[0].stock, ore: 0, alloys: 0 };
  for (const u of poor.factions[0].army!.units) if (u.kind === 'tank') u.w = 1;
  const ep = applyPlanetAction(poor, { type: 'endTurn' });
  const waiting = ep.factions[0].army!.units.filter(u => u.w).length;
  ok(waiting >= 1 && ep.journal.some(j => /wait/.test(j.text)), `refused: with an empty stock, ${waiting} of 2 wounded tanks wait for ore and alloys`);
  ok(REPAIR_COST.alloys === 1 && REPAIR_COST.ore === 2 && stock0.alloys >= 1, 'a repair costs 2 ore and 1 alloys');

  // Link 8: morale and diplomacy. Faction 1 holds the target, allied with 2; the player allied with 3.
  const ms = copy(w);
  ms.regions[T].owner = 1;
  ms.regions[T].garrison = ARMY_KINDS.map((_, i) => (i === 0 ? 6 : 0));
  ms.treaties = [
    { a: 0, b: 3, kind: 'alliance', turns: null, terms: [], since: 1, ends: null },
    { a: 1, b: 2, kind: 'alliance', turns: null, terms: [], since: 1, ends: null },
  ];
  const near1 = planetMapOf(ms).regions[T].links.map(l => l.to).filter(r => r !== X);
  for (const r of near1.slice(0, 1)) ms.regions[r].owner = 1;
  const mf = applyPlanetAction(applyPlanetAction(ms, { type: 'attack', target: T, credits: 1000, heroes: [] }), { type: 'fight' });
  ok(mf.pending.length === 1, 'the decisive scene: an attack on faction 1');
  const ms2 = mf.pending[0].setup;
  const t31 = mf.trust[3][0];
  const t21 = mf.trust[2][1];
  const ds = ms2.sides.map(() => undefined as BattleUnit[] | undefined);
  ds[ms2.defenderSeat] = [];
  const dec = applyPlanetAction(mf, { type: 'battleResult', report: report(ms2, 'attacker', {}, ds) });
  const shaken = dec.regions.flatMap((r, i) => (r.shaken !== undefined ? [i] : []));
  ok(dec.trust[3][0] === Math.min(100, t31 + DECISIVE_TRUST) && dec.trust[2][1] === Math.max(0, t21 - DECISIVE_TRUST), `a decisive win: the winner's ally +${dec.trust[3][0] - t31}, the loser's ally ${dec.trust[2][1] - t21}`);
  ok(shaken.length > 0 && shaken.every(r => dec.regions[r].owner === 1 && dec.regions[r].shaken === dec.turn + 1), `faction 1's regions next door are shaken (${shaken.join(', ')})`);
  const e1 = applyPlanetAction(dec, { type: 'endTurn' });
  ok(shaken.every(r => e1.regions[r].owner !== 1 || isShaken(e1, r)), 'still shaken through the next turn');
  const e2 = applyPlanetAction(e1, { type: 'endTurn' });
  ok(shaken.every(r => e2.regions[r].shaken === undefined), 'and no longer after it');
  const mild = applyPlanetAction(mf, { type: 'battleResult', report: report(ms2, 'attacker') });
  ok(mild.trust[3][0] === t31 && mild.trust[2][1] === t21 && !mild.regions.some(r => r.shaken !== undefined), 'refused: a close result moves no trust and shakes nothing');
}

// ---- Link 9: the spot for round 7's other battle features ----------------------------------------------

function flagTests(ok: Ok): void {
  // Round 7's battle-side features are on in a war on battle rules 3 and off in an older war's battles.
  const sc = firstScene('flags');
  const on = setupOf(sc)!;
  const r7 = (g: GameState) => [g.setup?.fortification, g.setup?.structureUpgrades, g.setup?.strategicBuildings, g.setup?.adaptive];
  const gOn = buildPlanetBattle(on, ids(7), { autopilot: true });
  ok(on.links !== undefined && r7(gOn).every(v => v === true), `battle rules 3: the Fortification line, structure upgrades, strategic structures and the adaptive commander on (${r7(gOn).join()})`);
  const { links: _links, ...older } = on;
  const gOff = buildPlanetBattle(older as BattleSetup, ids(8), { autopilot: true });
  ok(r7(gOff).every(v => v === false), `an older war's battle: all four off (${r7(gOff).join()})`);
  for (const f of ['../src/sim/state.ts', '../src/sim/mission.ts', '../src/sim/tick.ts', '../src/sim/types.ts']) {
    const t = readFileSync(join(dirname(new URL(import.meta.url).pathname), f), 'utf8');
    const begins = (t.match(/round7:planet begin/g) ?? []).length;
    const ends = (t.match(/round7:planet end/g) ?? []).length;
    ok(begins > 0 && begins === ends, `${f}: round 7 additions wrapped (${begins})`);
  }
  const pure = readFileSync(join(dirname(new URL(import.meta.url).pathname), '..', 'src', 'sim', 'planetLinks.ts'), 'utf8');
  ok(!/Math\.random|Date\.now|performance\.now|setTimeout|setInterval/.test(pure), 'src/sim/planetLinks.ts has no clock and no dice');
}

// ---- Link 11: the computer factions --------------------------------------------------------------------

function aiTests(ok: Ok): void {
  let met = 0;
  for (let k = 0; k < 40 && met < 2; k++) {
    const sc = scene(`links-ai-${k}`, 1);
    if (!sc) continue;
    const { X, Y, T } = sc;
    const w = copy(sc.w);
    w.factions[1].army!.units = Array.from({ length: 8 }, () => ({ kind: 'tank' as const, kills: 0 }));
    // Cut X off: Y to faction 2, and any other of faction 1's regions beside X to the independents.
    w.regions[Y].owner = 2;
    for (const l of planetMapOf(w).regions[X].links) if (w.regions[l.to].owner === 1) w.regions[l.to].owner = NEUTRAL;
    if (supplyOf(w, 1, X, attackCost(w, 1, 0)) !== 'cut') continue;
    const attacks = (s: PlanetState) => planAiActions(s, 1).filter(a => a.type === 'attack');
    const owned = w.regions.filter(r => r.owner === 1).length;
    if (owned <= 2) continue;
    const old = { ...copy(w), battleRules: 2 as const };
    const oldAttacks = attacks(old);
    if (!oldAttacks.length) continue;
    met++;
    ok(attacks(w).length === 0, `seed ${k}: a computer faction with ${owned} regions does not attack from a cut-off region (battle rules 2 would: ${json(oldAttacks[0])})`);
    const desperate = copy(w);
    desperate.regions.forEach((r, i) => {
      if (r.owner === 1 && i !== X && i !== desperate.factions[1].capital) r.owner = NEUTRAL;
    });
    ok(attacks(desperate).length > 0, `seed ${k}: down to two regions it does (desperate)`);
    ok(attackEdge(w, 1, X, T, attackCost(w, 1, 0)).creditShare === 0.5, 'the edge of a cut-off attack halves its credits');
  }
  ok(met >= 2, `cut-off scenes met (${met})`);
  // Support and a depot add to what an attack is worth.
  const sc = firstScene('links-ai-edge');
  const w = copy(sc.w);
  const e0 = attackEdge(w, 0, sc.X, sc.T, attackCost(w, 0, 0));
  w.regions[sc.Y].city = { level: 2, b: { institute: 2 }, built: -1 };
  w.regions[sc.X].city.b.port = 1;
  w.regions[sc.X].garrison[5] = 4;
  const e1 = attackEdge(w, 0, sc.X, sc.T, attackCost(w, 0, 0));
  ok(e0.bonus === 0 && e1.supply === 'depot' && e1.bonus > e0.bonus, `support and a depot's wave add strength (${e0.bonus} to ${e1.bonus.toFixed(1)})`);
}

// ---- Link 12: older wars unchanged, replay, saves ------------------------------------------------------

/**
 * Hashes from the build before battle rules 3 (this branch's base, f0c993e): a war on battle rules 2
 * on each preset played 25 bot turns with every attack open each turn set up at 1,000 credits
 * (count:hash) and the war at the end, and another played to its end on Hard (turn:hash).
 */
const V2_HASHES: Record<string, string> = {
  shortSetups: '79:82dc7fa6d7d1263b',
  shortWar: '762f01bf0b6a8bfe',
  shortWhole: '25:23d6c1255c8ec68a',
  longSetups: '102:67aec7a5bb312794',
  longWar: '23f1665c16e13d10',
  longWhole: '21:296a69e522d5dd74',
  veryLongSetups: '203:99b4fd4f990bb5af',
  veryLongWar: 'daa6e94651ca5eeb',
  veryLongWhole: '160:21220efa3a396559',
};

function botTurn(w: PlanetState): PlanetState {
  for (const a of planAiActions(w, 0, 'expansionist')) {
    w = applyPlanetAction(w, a);
    while (w.pending.length) w = applyPlanetAction(w, { type: 'autoResolve' });
  }
  w = applyPlanetAction(w, { type: 'endTurn' });
  while (w.pending.length) w = applyPlanetAction(w, { type: 'autoResolve' });
  return w;
}

function olderTests(ok: Ok): void {
  for (const preset of ['short', 'long', 'veryLong'] as const) {
    let w = newPlanetState({ seedText: `v2hash-${preset}`, preset, difficulty: 'normal', commander: 'Tester', createdAt: 0 });
    w.battleRules = 2;
    const setups: BattleSetup[] = [];
    for (let turn = 0; turn < 25 && !w.result; turn++) {
      for (const f of w.factions) {
        if (!f.alive) continue;
        for (const r of attackTargets(w, f.id)) {
          const st = battleSetupFor(w, f.id, r, 1000, [], 9000 + setups.length);
          if (st) setups.push(st);
        }
      }
      w = botTurn(w);
    }
    ok(`${setups.length}:${hash(setups)}` === V2_HASHES[`${preset}Setups`], `${preset} war on battle rules 2: every setup byte-identical to before battle rules 3`);
    ok(hash(w) === V2_HASHES[`${preset}War`] && w.battleRules === 2, `${preset} war on battle rules 2: the war byte-identical after 25 turns, still on 2`);
    let x = newPlanetState({ seedText: `v2whole-${preset}`, preset, difficulty: 'hard', commander: 'Tester', createdAt: 0 });
    x.battleRules = 2;
    for (let i = 0; i < x.options.turnLimit + 2 && !x.result; i++) x = botTurn(x);
    ok(`${x.turn}:${hash(x)}` === V2_HASHES[`${preset}Whole`], `${preset} war on battle rules 2 played to its end: byte-identical`);
    ok(!json(x).includes('"shaken"') && !json(x).includes('"w":1') && !json(setups).includes('"links"'), `${preset} war on battle rules 2: no shaken region, wounded unit or links anywhere`);
  }

  // Battle rules 3: replays exactly; links in play over a war.
  for (const preset of ['short', 'long'] as const) {
    const play = () => {
      let w = newPlanetState({ seedText: `v3-${preset}`, preset, difficulty: 'normal', commander: 'Tester', createdAt: 0 });
      const seen = { setups: 0, cut: 0, short: 0, depot: 0, support: 0, walls: 0, shaken: 0, wounded: 0 };
      for (let i = 0; i < w.options.turnLimit + 2 && !w.result; i++) {
        for (const f of w.factions)
          if (f.alive)
            for (const r of attackTargets(w, f.id)) {
              const st = battleSetupFor(w, f.id, r, 0, [], 1);
              if (!st?.links) continue;
              seen.setups++;
              if (st.links.supply === 'cut') seen.cut++;
              if (st.links.supply === 'short') seen.short++;
              if (st.links.supply === 'depot') seen.depot++;
              if (st.links.support.length) seen.support++;
              if (st.links.walls) seen.walls++;
            }
        w = botTurn(w);
        if (w.regions.some(r => r.shaken !== undefined)) seen.shaken++;
        if (w.factions.some(f => f.army?.units.some(u => u.w))) seen.wounded++;
      }
      return { w, seen };
    };
    const a = play();
    const b = play();
    ok(json(a.w) === json(b.w), `${preset} war on battle rules 3 played twice: byte-identical`);
    ok(a.w.result !== null && a.w.battleRules === 3, `${preset} war on battle rules 3 ends (${json(a.w.result)})`);
    console.log(`  ${preset} war on battle rules 3: ${a.w.result?.how} at turn ${a.w.turn}; open attacks ${a.seen.setups}: cut ${a.seen.cut}, short ${a.seen.short}, depot ${a.seen.depot}, with support ${a.seen.support}, with walls ${a.seen.walls}; turns with a shaken region ${a.seen.shaken}, with a wounded vehicle ${a.seen.wounded}`);
    ok(a.seen.depot > 0 && a.seen.support > 0 && a.seen.walls > 0 && a.seen.shaken > 0 && a.seen.wounded > 0, `${preset}: depots, support, walls, shaken regions and wounds all arise in a war`);
  }

  // Saves: a pending battle rules 3 setup, a shaken region and a wounded vehicle migrate to themselves.
  const sc = firstScene('links-save');
  const w = copy(sc.w);
  w.regions[sc.X].city.b.port = 1;
  w.regions[sc.X].garrison[5] = 2;
  w.regions[sc.Y].city = { level: 2, b: { institute: 2 }, built: -1 };
  w.factions[0].army!.units[4].w = 1;
  w.regions[sc.Y].shaken = w.turn;
  const a = applyPlanetAction(w, { type: 'attack', target: sc.T, credits: 1000, heroes: [] });
  const st = a.pending[0].setup;
  ok(!!st.links?.reinforce && st.links.support.length > 0 && st.sides.find(x => x.role === 'attacker')!.units.some(u => u.hp === WOUNDED_HP), 'the save scene: a wave, support and a wounded tank');
  const save = { ...newPlanetSave('links-save', 'Links', { seedText: w.seedText, preset: w.options.preset, difficulty: w.difficulty, commander: 'Tester', createdAt: 0 }), planet: a };
  const raw = JSON.parse(json(save));
  ok(json(migratePlanetSave(raw)) === json(save), 'a save holding a battle rules 3 setup, a shaken region and a wounded tank migrates to itself');
  const junk = JSON.parse(json(save));
  junk.planet.pending[0].setup.links.support[0].power = 'nuke';
  ok(migratePlanetSave(junk)!.planet.pending.length === 0, 'refused: a setup with malformed links is dropped');
  const junk2 = JSON.parse(json(save));
  junk2.planet.factions[0].army.units[4].w = 2;
  junk2.planet.regions[sc.Y].shaken = 'yes';
  const m2 = migratePlanetSave(junk2)!;
  ok(m2.planet.factions[0].army!.units[4].w === undefined && m2.planet.regions[sc.Y].shaken === undefined, 'refused: a junk wound and a junk shaken are dropped');
  const v2 = JSON.parse(json(save));
  v2.planet.battleRules = 2;
  ok(migratePlanetSave(v2)!.planet.battleRules === 2, 'a war on battle rules 2 stays on 2');
  // A battle in progress with links migrates to itself (the engine's fields).
  const g = processAction(buildPlanetBattle(st, ids(90)), { type: 'tick', n: 30 });
  const gs = JSON.parse(json(g));
  const withBattle = JSON.parse(json({ ...save, planet: applyPlanetAction(a, { type: 'fight' }), battle: gs }));
  const back = migratePlanetSave(withBattle);
  ok(back !== null && json(back.battle?.planet?.support) === json(g.planet?.support) && json(back.battle?.planet?.reinforce) === json(g.planet?.reinforce), 'a battle in progress keeps its support and its wave through a save');
  // The whole battle played out by the engine (Simulate): a valid report with links, accepted by the reducer.
  const simOn = { ...a, options: { ...a.options, simulatedAutoResolve: true } };
  const sim = simulateBattle(st, 0);
  const simApplied = applyPlanetAction(simOn, { type: 'battleResult', report: sim });
  ok(!!sim.links && simApplied !== simOn, `a battle rules 3 battle simulated to the end (${sim.winner} at ${Math.round(sim.ticks / 600)} min; built ${json(sim.links?.built)}, credits ${json(sim.links?.credits)}, harvested ${json(sim.links?.harvested)}, wounded ${json(sim.links?.wounded)}) is accepted: ${planetActionProblem(simOn, { type: 'battleResult', report: sim })}`);
  console.log(`  simulated battle rules 3 battle: ${sim.winner} at ${Math.round(sim.ticks / 600)} min; ore ${a.factions[0].stock.ore} to ${simApplied.factions[0].stock.ore}`);
  // Purity of the setup: the same state gives the same setup, and the input is never touched.
  const frozen = deepFreeze(copy(w));
  const s1 = battleSetupFor(frozen, 0, sc.T, 1000, [], 5);
  ok(json(s1) === json(battleSetupFor(frozen, 0, sc.T, 1000, [], 5)), 'a battle rules 3 setup is the same twice from a frozen state');
  const r1 = quickResolve(s1!);
  ok(json(r1) === json(quickResolve(s1!)) && !!r1.links, 'its auto-resolve is the same twice and carries links');
}

export const linkSections: [string, (ok: Ok) => void][] = [
  ['Battle rules 3: supply and logistics (link 1)', supplyTests],
  ['Battle rules 3: support from neighbouring regions (link 2)', supportTests],
  ['Battle rules 3: the city, prepared defences, the attacker base (links 3 and 4)', cityTests],
  ['Battle rules 3: the battle into the war (links 5 to 8)', returnTests],
  ['Battle rules 3: the other features flag spot; sim additions wrapped (link 9)', flagTests],
  ['Battle rules 3: the computer factions (link 11)', aiTests],
  ['Battle rules 3: older wars byte-identical, replay, saves (link 12)', olderTests],
];

// Run on its own: every section, with its own count.
if (process.argv[1] && /drive-planet-links\.ts$/.test(process.argv[1])) {
  let passed = 0;
  let failed = 0;
  const ok: Ok = (cond, what) => {
    if (cond) passed++;
    else {
      failed++;
      if (failed <= 60) console.log(`  FAIL ${what}`);
    }
  };
  const t0 = Date.now();
  for (const [name, fn] of linkSections) {
    const t = Date.now();
    console.log(name);
    fn(ok);
    console.log(`  (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  }
  console.log(`\n${passed} assertions passed, ${failed} failed, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (failed) process.exit(1);
}
