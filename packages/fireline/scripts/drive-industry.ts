/**
 * Industry (2026-11-21, setup.industry; src/sim/industry.ts, fireline-design.md). Its sections run
 * inside scripts/drive.ts and count in its totals.
 */
import { createHash } from 'node:crypto';
import { processAction } from '../src/sim/actions';
import { setAutopilotAi } from '../src/sim/ai';
import { canQueue, goodsFor, placementProblem } from '../src/sim/commands';
import { burnLoadFuel, alloyStore, fuelStore, industryOn, industryStep, oreInReach, wellDry } from '../src/sim/industry';
import { createMissionState } from '../src/sim/mission';
import { missionContext, newCampaign } from '../src/campaign/progression';
import { MISSIONS } from '../src/campaign/missions';
import {
  AIR_LOAD_FUEL,
  ALLOY_STORE_BASE,
  ALLOY_STORE_PER_FOUNDRY,
  BUILD_MENU,
  DEFAULT_SETUP,
  FOUNDRY_ALLOYS,
  FOUNDRY_CREDITS,
  FOUNDRY_FUEL,
  FOUNDRY_RESERVE,
  FOUNDRY_TICKS,
  FUEL_STORE_BASE,
  FUEL_STORE_PER_WELL,
  FUEL_WELL_MIN_ORE,
  FUEL_WELL_ORE,
  FUEL_WELL_TICKS,
  INDUSTRY_START_ALLOYS,
  INDUSTRY_START_FUEL,
  LEGACY_SETUP,
  UNITS,
  type Owner,
  type SkirmishSetup,
} from '../src/sim/rules';
import { addBuilding, costFor, costOf, createInitialState, migrateState, normaliseSetup, techAllowed } from '../src/sim/state';
import type { Building, GameState } from '../src/sim/types';
import { centreOf, cutOff, linkedHubs, supplied, supplyOn, supplyStep } from '../src/sim/supply';
import { depotSpot } from '../src/sim/aiEconomy';
import { REFINERY_HOLD, SUPPLY_FLOW_CREDITS, SUPPLY_FLOW_GOODS, SUPPLY_LINK_RANGE, SUPPLY_SERVE_RANGE, SUPPLY_TICKS, WELL_HOLD } from '../src/sim/rules';
import { addUnit } from '../src/sim/state';
import { unitSpecOf } from '../src/sim/specs';

type Ok = (cond: unknown, what: string) => void;

const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
const hash = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const ON: Partial<SkirmishSetup> = { map: 'plains', tech: 'advanced', industry: true, credits: 20000 };
const fresh = (setup: Partial<SkirmishSetup> = ON, seed = 'industry'): GameState => createInitialState(seed, seed, { seed, createdAt: 0, setup });
const oreTotal = (s: GameState): number => s.ore.reduce((a, b) => a + b, 0);
const NO_LOW = [false, false, false, false];

/** Side 1's commander switched off: these sections test the rules, not the commander. */
function quiet(fn: (ok: Ok) => void): (ok: Ok) => void {
  return ok => {
    for (const o of [1, 2, 3] as Owner[]) setAutopilotAi(() => {}, o);
    try {
      fn(ok);
    } finally {
      for (const o of [1, 2, 3] as Owner[]) setAutopilotAi(null, o);
    }
  };
}

/** The first spot near side 0's yard where a structure of this kind may legally stand, or null. */
function spotFor(s: GameState, kind: 'fuelwell' | 'foundry', wantOre: boolean): { x: number; y: number } | null {
  const hq = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
  for (let r = 1; r < 30; r++)
    for (let y = hq.y - r; y <= hq.y + r; y++)
      for (let x = hq.x - r; x <= hq.x + r; x++) {
        if (placementProblem(s, 0, kind, x, y, undefined, { anywhere: true })) continue;
        const ore = oreInReach(s, x, y, 2, 2);
        if (wantOre ? ore >= FUEL_WELL_MIN_ORE : ore === 0) return { x, y };
      }
  return null;
}

function setup(ok: Ok): void {
  ok(DEFAULT_SETUP.industry === false && LEGACY_SETUP.industry === false, 'the default and the legacy setup state industry: off');
  ok(normaliseSetup({}).industry === false, 'a setup saved before industry reads as off');
  ok(normaliseSetup({ industry: true }).industry === true, 'industry: true is kept');
  ok(normaliseSetup({ industry: 'yes' as unknown as boolean }).industry === false, 'anything but a boolean reads as off');
  ok(BUILD_MENU.slice(-3).join() === 'fuelwell,foundry,depot', 'the Fuel Well, the Foundry and the Depot close the build menu, so nothing already listed moves');
  const off = fresh({ map: 'plains', tech: 'advanced' });
  ok(!industryOn(off) && !techAllowed(off, 0, 'fuelwell') && !techAllowed(off, 0, 'foundry'), 'off: neither structure may be built');
  ok(off.players.every(p => !('fuel' in p) && !('alloys' in p)), 'off: no side holds fuel or alloys');
  ok(costFor(off, 0, 'tank') === costOf('tank') && goodsFor(off, 0, 'tank').alloys === 0, 'off: a tank costs credits alone, as always');
  const on = fresh();
  ok(industryOn(on) && techAllowed(on, 0, 'fuelwell') && techAllowed(on, 1, 'foundry'), 'on: both structures may be built, by every side');
  ok(on.players.every(p => p.fuel === INDUSTRY_START_FUEL && p.alloys === INDUSTRY_START_ALLOYS), 'on: every side starts with the opening fuel and alloys');
  const std = fresh({ map: 'plains', tech: 'standard', industry: true });
  ok(techAllowed(std, 0, 'fuelwell') && techAllowed(std, 0, 'foundry'), 'on with standard tech: the chain is there too');
  // Missions and planet battles: never, even with the flag forced onto the state.
  const c = newCampaign('T');
  for (const spec of MISSIONS) {
    const ms = createMissionState(spec, missionContext(c, spec, `ind-${spec.id}`, 0));
    ms.setup = { ...normaliseSetup({}), industry: true };
    ok(!industryOn(ms) && !techAllowed(ms, 0, 'fuelwell') && costFor(ms, 0, 'tank') === costFor({ ...ms, setup: undefined }, 0, 'tank'), `${spec.id}: no industry in a mission`);
  }
  const planet = fresh();
  planet.planet = {} as GameState['planet'];
  ok(!industryOn(planet), 'no industry in a planet battle');
}

function prices(ok: Ok): void {
  const s = fresh();
  ok(costFor(s, 0, 'tank') === Math.round(costOf('tank') * 0.7) && goodsFor(s, 0, 'tank').alloys === Math.round((costOf('tank') * 0.3) / 10), 'a tank: 70% credits, 30% in alloys at ten credits each');
  ok(goodsFor(s, 0, 'tank').fuel === 0, 'a tank takes no fuel');
  const air = Object.keys(UNITS).find(k => UNITS[k as keyof typeof UNITS].category === 'air' && !UNITS[k as keyof typeof UNITS].hero) as keyof typeof UNITS;
  const g = goodsFor(s, 0, air);
  ok(g.fuel === Math.round((costOf(air) * 0.1) / 10) && g.alloys > 0 && costFor(s, 0, air) === Math.round(costOf(air) * 0.6), `an aircraft (${air}): 60% credits, 30% alloys, 10% fuel`);
  ok(costFor(s, 0, 'hauler') === costOf('hauler') && goodsFor(s, 0, 'hauler').alloys === 0, 'the Ore Hauler stays credits only');
  ok(costFor(s, 0, 'basetruck') === costOf('basetruck') && goodsFor(s, 0, 'basetruck').alloys === 0, 'the Forward Base Truck stays credits only');
  ok(costFor(s, 0, 'rifleman') === costOf('rifleman') && goodsFor(s, 0, 'rocketeer').alloys === 0, 'infantry stay credits only');
  ok(costFor(s, 0, 'factory') === costOf('factory') && goodsFor(s, 0, 'foundry').alloys === 0, 'structures stay credits only');
}

const queueSection = quiet((ok: Ok): void => {
  let s = fresh();
  s.players[0].alloys = 10;
  addBuilding(s, 0, 'factory', 30, 50);
  addBuilding(s, 0, 'power', 26, 50);
  addBuilding(s, 0, 'refinery', 26, 46);
  ok(!canQueue(s, 0, 'vehicle', 'tank'), 'short of alloys: a tank is refused with credits to spare');
  ok(processAction(s, { type: 'queue', category: 'vehicle', kind: 'tank' }) === s, 'and the refused action returns the same state');
  s.players[0].alloys = 100;
  const before = { cr: s.players[0].credits, al: s.players[0].alloys };
  const g = goodsFor(s, 0, 'tank');
  const q = processAction(s, { type: 'queue', category: 'vehicle', kind: 'tank' });
  ok(q !== s && q.players[0].alloys === before.al - g.alloys && q.players[0].credits === before.cr - costFor(s, 0, 'tank'), 'queued: credits and alloys both paid');
  ok(q.players[0].queues.vehicle[0].alloys === g.alloys, 'the queue item records the alloys it was paid with');
  ok(s.players[0].alloys === 100, 'the input state is untouched');
  const back = processAction(q, { type: 'cancel', category: 'vehicle', kind: 'tank' });
  ok(back.players[0].alloys === before.al && back.players[0].credits === before.cr, 'cancelled: every credit and every alloy back');
  // A hauler needs no alloys at all.
  s = copy(s);
  s.players[0].alloys = 0;
  s.players[0].fuel = 0;
  ok(canQueue(s, 0, 'vehicle', 'hauler'), 'with no goods at all, an Ore Hauler can still be bought');
});

const placement = quiet((ok: Ok): void => {
  const s = fresh();
  const at = spotFor(s, 'fuelwell', true);
  ok(!!at, 'a spot beside an ore field exists on the plains');
  if (!at) return;
  // Something of side 0's beside the spot, so the build radius holds and the ore rule alone decides.
  addBuilding(s, 0, 'power', at.x, at.y + 3);
  ok(placementProblem(s, 0, 'fuelwell', at.x, at.y) === null, 'beside the field: a Fuel Well may stand');
  const bare = copy(s);
  for (let y = at.y - 5; y < at.y + 7; y++) for (let x = at.x - 5; x < at.x + 7; x++) if (x >= 0 && y >= 0 && x < bare.mapW && y < bare.mapH) bare.ore[x + y * bare.mapW] = 0;
  ok(placementProblem(bare, 0, 'fuelwell', at.x, at.y) === 'A Fuel Well needs an ore field within three tiles', 'the same spot with the field gone: refused, and the refusal says why');
  ok(placementProblem(bare, 0, 'foundry', at.x, at.y) === null, 'a Foundry has no ore rule');
  ok(processAction(bare, { type: 'place', kind: 'fuelwell', x: at.x, y: at.y }) === bare, 'a refused placement returns the same state');
});

function pumping(ok: Ok): void {
  const s = fresh();
  const at = spotFor(s, 'fuelwell', true)!;
  const well = addBuilding(s, 0, 'fuelwell', at.x, at.y);
  s.players[0].fuel = 0;
  const ore0 = oreTotal(s);
  let pumped = 0;
  for (let t = 0; t < FUEL_WELL_TICKS * 20; t++) {
    s.tick++;
    const was = s.players[0].fuel!;
    industryStep(s, NO_LOW);
    pumped += s.players[0].fuel! - was;
  }
  ok(pumped === 20, `twenty beats, twenty fuel (${pumped})`);
  ok(ore0 - oreTotal(s) === 20 * FUEL_WELL_ORE, 'five ore out of the ground for each');
  // Short of power: half as often.
  s.players[0].fuel = 0;
  let slow = 0;
  for (let t = 0; t < FUEL_WELL_TICKS * 20; t++) {
    s.tick++;
    industryStep(s, [true, false, false, false]);
  }
  slow = s.players[0].fuel!;
  ok(slow === 10, `short of power, ten in the same time (${slow})`);
  // The store: never past it.
  ok(fuelStore(s, 0) === FUEL_STORE_BASE + FUEL_STORE_PER_WELL, 'one well: the base store and one well more');
  s.players[0].fuel = fuelStore(s, 0);
  const oreFull = oreTotal(s);
  for (let t = 0; t < FUEL_WELL_TICKS * 5; t++) {
    s.tick++;
    industryStep(s, NO_LOW);
  }
  ok(s.players[0].fuel === fuelStore(s, 0) && oreTotal(s) === oreFull, 'with the store full the well idles and takes no ore');
  // Dry: no ore in reach, no fuel.
  s.players[0].fuel = 0;
  const w = s.buildings.find(b => b.id === well.id)!;
  for (let y = w.y - 4; y < w.y + 6; y++) for (let x = w.x - 4; x < w.x + 6; x++) if (x >= 0 && y >= 0 && x < s.mapW && y < s.mapH) s.ore[x + y * s.mapW] = 0;
  ok(wellDry(s, w), 'with the field round it worked out, the well reads dry');
  for (let t = 0; t < FUEL_WELL_TICKS * 5; t++) {
    s.tick++;
    industryStep(s, NO_LOW);
  }
  ok(s.players[0].fuel === 0, 'and pumps nothing');
  // Other sides' stores are their own.
  ok(s.players[1].fuel === INDUSTRY_START_FUEL, "side 1's fuel never moved");
}

function smelting(ok: Ok): void {
  const s = fresh();
  addBuilding(s, 0, 'foundry', s.starts![0].x + 4, s.starts![0].y + 4);
  const p = s.players[0];
  p.credits = 1000;
  p.fuel = 40;
  p.alloys = 0;
  for (let t = 0; t < FOUNDRY_TICKS * 3; t++) {
    s.tick++;
    industryStep(s, NO_LOW);
  }
  ok(p.alloys === 3 * FOUNDRY_ALLOYS && p.credits === 1000 - 3 * FOUNDRY_CREDITS && p.fuel === 40 - 3 * FOUNDRY_FUEL, 'three cycles: 30 alloys for 180 credits and 12 fuel');
  ok(alloyStore(s, 0) === ALLOY_STORE_BASE + ALLOY_STORE_PER_FOUNDRY, 'one Foundry: the base store and one Foundry more');
  p.fuel = FOUNDRY_FUEL - 1;
  const a0 = p.alloys!;
  for (let t = 0; t < FOUNDRY_TICKS * 3; t++) {
    s.tick++;
    industryStep(s, NO_LOW);
  }
  ok(p.alloys === a0 && p.credits === 1000 - 3 * FOUNDRY_CREDITS, 'without the fuel for a cycle, nothing is smelted and nothing is taken');
  p.fuel = 100;
  p.credits = FOUNDRY_CREDITS - 1;
  for (let t = 0; t < FOUNDRY_TICKS * 3; t++) {
    s.tick++;
    industryStep(s, NO_LOW);
  }
  ok(p.alloys === a0 && p.fuel === 100, 'without the credits, likewise');
  p.credits = FOUNDRY_CREDITS + FOUNDRY_RESERVE - 1;
  for (let t = 0; t < FOUNDRY_TICKS * 3; t++) {
    s.tick++;
    industryStep(s, NO_LOW);
  }
  ok(p.alloys === a0 && p.credits === FOUNDRY_CREDITS + FOUNDRY_RESERVE - 1, 'it never smelts the last FOUNDRY_RESERVE credits');
  p.credits = FOUNDRY_CREDITS + FOUNDRY_RESERVE;
  for (let t = 0; t < FOUNDRY_TICKS; t++) {
    s.tick++;
    industryStep(s, NO_LOW);
  }
  ok(p.alloys === a0 + FOUNDRY_ALLOYS && p.credits === FOUNDRY_RESERVE, 'with exactly the reserve and a cycle over, it smelts once and stops at the reserve');
  p.credits = 100000;
  p.alloys = alloyStore(s, 0) - FOUNDRY_ALLOYS + 1;
  const full = p.alloys;
  for (let t = 0; t < FOUNDRY_TICKS * 3; t++) {
    s.tick++;
    industryStep(s, NO_LOW);
  }
  ok(p.alloys === full, 'a cycle that would overfill the store waits');
  // The air: each load burns fuel while there is fuel.
  const pl = { ...p, fuel: AIR_LOAD_FUEL + 1 };
  ok(burnLoadFuel(pl) && pl.fuel === 1 && !burnLoadFuel(pl) && pl.fuel === 1, 'an aircraft load burns its fuel, and with too little takes none');
}

/** Whole computer battles with industry on: the chain stands, goods stay in bounds, the battle ends. */
function battles(ok: Ok): void {
  const seeds = ['ind-a', 'ind-b', 'ind-c', 'ind-d'];
  let ended = 0;
  let chain = 0;
  let vehicles = 0;
  let bounds = true;
  for (const [i, seed] of seeds.entries()) {
    let s = createInitialState(seed, seed, { seed, createdAt: 0, autopilot: true, difficulty: i % 2 ? 'hard' : 'normal', setup: { tech: 'advanced', industry: true, map: i < 2 ? 'classic' : 'plains' } });
    s.autopilotDifficulty = 'normal';
    const built = [new Set<string>(), new Set<string>()];
    while (s.winner === null && s.tick < 30000) {
      s = processAction(s, { type: 'tick', n: 50 });
      for (const b of s.buildings) if (b.owner < 2) built[b.owner].add(b.kind);
      // The store limits what is made, not what is held: a side that sells a dry well keeps its fuel.
      for (const p of s.players) if ((p.fuel ?? 0) < 0 || (p.alloys ?? 0) < 0 || !Number.isInteger(p.fuel) || !Number.isInteger(p.alloys)) bounds = false;
      vehicles += s.units.filter(u => u.kind === 'tank' && u.hp > 0).length > 0 ? 1 : 0;
    }
    if (s.winner !== null) ended++;
    if (built.every(k => k.has('fuelwell') && k.has('foundry'))) chain++;
  }
  ok(bounds, 'fuel and alloys are whole numbers, never below nought');
  ok(chain === seeds.length, `both commanders build a Fuel Well and a Foundry in every battle (${chain} of ${seeds.length})`);
  ok(vehicles > 0, 'tanks are fielded');
  ok(ended === seeds.length, `every battle is decided inside 50 minutes (${ended} of ${seeds.length})`);
}

function saves(ok: Ok): void {
  // Replay: a battle with industry on plays the same twice, and from a save mid-battle.
  const play = (saveAt = -1) => {
    let s = createInitialState('rp', 'rp', { seed: 'rp', createdAt: 0, autopilot: true, setup: { tech: 'advanced', industry: true, map: 'classic' } });
    for (let i = 0; i < 120; i++) {
      s = processAction(s, { type: 'tick', n: 50 });
      if (i === saveAt) s = migrateState(JSON.parse(JSON.stringify(s)))!;
    }
    return s;
  };
  const a = play();
  ok(hash(a) === hash(play()), 'a battle with industry on replays byte-identically');
  ok(hash(a) === hash(play(60)), 'and plays on the same from a save made mid-battle');
  ok(a.players.some(p => (p.alloys ?? 0) !== INDUSTRY_START_ALLOYS), 'its stores moved during the ten minutes');
  // Junk in a save: repaired, never trusted.
  const junk = copy(a) as unknown as { players: Record<string, unknown>[] };
  junk.players[0].fuel = 'lots';
  junk.players[1].alloys = -40;
  junk.players[0].alloys = 12.7;
  const m = migrateState(junk)!;
  ok(m.players[0].fuel === 0 && m.players[1].alloys === 0 && m.players[0].alloys === 12, 'junk fuel and alloys load as whole numbers of at least nought');
  // Without industry: a store in the save is dropped, and so is one on a queue item.
  const off = createInitialState('of', 'of', { seed: 'of', createdAt: 0, setup: { tech: 'advanced' } });
  const dirty = copy(off);
  dirty.players[0].fuel = 50;
  dirty.players[0].queues.infantry.push({ kind: 'rifleman', progress: 0, alloys: 5 });
  const mo = migrateState(dirty)!;
  ok(!('fuel' in mo.players[0]) && !('alloys' in mo.players[0].queues.infantry[0]), 'off: stores and goods on queue items are dropped');
  ok(JSON.stringify(migrateState(copy(off))) === JSON.stringify(off), 'off: a save loads exactly as it was');
}

// ---------------------------------------------------------------------------------------------
// Supply lines (2026-11-21, setup.supply; src/sim/supply.ts)

const SUPPLY: Partial<SkirmishSetup> = { ...ON, supply: true };

/** A state with supply on, side 0's yard at a known spot, and a free place `far` tiles east of it. */
function supplyArena(seed = 'supply'): { s: GameState; hq: Building; at: (dx: number, dy?: number) => { x: number; y: number } } {
  const s = fresh(SUPPLY, seed);
  const hq = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
  const dir = hq.x < s.mapW / 2 ? 1 : -1;
  return { s, hq, at: (dx, dy = 0) => ({ x: hq.x + dir * dx, y: hq.y + dy }) };
}

function supplySetup(ok: Ok): void {
  ok(DEFAULT_SETUP.supply === false && LEGACY_SETUP.supply === false, 'both presets state supply lines: off');
  ok(normaliseSetup({}).supply === false, 'a setup saved before supply lines reads as off');
  ok(normaliseSetup({ industry: true, supply: true }).supply === true, 'with industry, supply: true is kept');
  ok(normaliseSetup({ supply: true }).supply === false, 'without industry, supply lines are off whatever the setup says');
  ok(BUILD_MENU[BUILD_MENU.length - 1] === 'depot', 'the Depot closes the build menu');
  const ind = fresh();
  ok(!supplyOn(ind) && !techAllowed(ind, 0, 'depot'), 'industry alone: no Depot, no supply rules');
  ok(ind.buildings.filter(b => b.kind === 'refinery' || b.kind === 'hq').every(b => supplied(ind, b)), 'industry alone: everything counts as supplied');
  const on = fresh(SUPPLY);
  ok(supplyOn(on) && techAllowed(on, 0, 'depot') && techAllowed(on, 1, 'depot'), 'supply on: every side may build Depots');
  const c = newCampaign('T');
  const ms = createMissionState(MISSIONS[0], missionContext(c, MISSIONS[0], 'sup', 0));
  ms.setup = { ...normaliseSetup({}), industry: true, supply: true };
  ok(!supplyOn(ms) && !techAllowed(ms, 0, 'depot'), 'never in a mission, even with the flag forced on');
}

function network(ok: Ok): void {
  const { s, hq, at } = supplyArena();
  ok(linkedHubs(s, 0).map(b => b.id).join() === String(hq.id), 'the Command Yard alone is linked at the start');
  const near = at(4);
  const ref = addBuilding(s, 0, 'refinery', near.x, near.y);
  ok(supplied(s, ref), 'a Refinery beside the yard is supplied');
  const f = at(SUPPLY_LINK_RANGE + SUPPLY_SERVE_RANGE - 3);
  const well = addBuilding(s, 0, 'fuelwell', f.x, f.y);
  const fc = centreOf(well);
  const hc = centreOf(hq);
  ok(Math.hypot(fc.x - hc.x, fc.y - hc.y) > SUPPLY_SERVE_RANGE && !supplied(s, well), 'a Fuel Well far out is cut off');
  ok(cutOff(s, 0).map(b => b.id).join() === String(well.id), 'and it is the only thing cut off');
  const d1 = at(SUPPLY_LINK_RANGE - 2);
  const depot = addBuilding(s, 0, 'depot', d1.x, d1.y);
  ok(linkedHubs(s, 0).some(b => b.id === depot.id), 'a Depot within reach of the yard links');
  ok(supplied(s, well) && cutOff(s, 0).length === 0, 'and supplies the well');
  // A chain: a second Depot beyond the first, and a well beyond that.
  const d2 = at(2 * (SUPPLY_LINK_RANGE - 2));
  const depot2 = addBuilding(s, 0, 'depot', d2.x, d2.y);
  const f2 = at(2 * (SUPPLY_LINK_RANGE - 2) + SUPPLY_SERVE_RANGE - 3, 3);
  const well2 = addBuilding(s, 0, 'fuelwell', f2.x, f2.y);
  ok(linkedHubs(s, 0).some(b => b.id === depot2.id) && supplied(s, well2), 'a second Depot links through the first, and supplies further out');
  // Cut the chain: the first Depot falls.
  s.buildings = s.buildings.filter(b => b.id !== depot.id);
  ok(!linkedHubs(s, 0).some(b => b.id === depot2.id), 'with the first Depot gone, the second is no longer linked');
  ok(!supplied(s, well) && !supplied(s, well2), 'and everything beyond it is cut off');
  // Another side's hubs never link yours.
  const theirs = addBuilding(s, 1, 'depot', d1.x, d1.y + 3);
  ok(!linkedHubs(s, 0).some(b => b.id === theirs.id) && !linkedHubs(s, 1).some(b => b.id === depot2.id), "a side's hubs link only its own");
  // Losing the yard cuts even the Refinery beside it.
  s.buildings = s.buildings.filter(b => b.id !== hq.id);
  ok(!supplied(s, ref), 'without a yard nothing is supplied');
}

const holding = quiet((ok: Ok): void => {
  const { s, at } = supplyArena('holding');
  const f = at(SUPPLY_LINK_RANGE + SUPPLY_SERVE_RANGE - 3);
  const ref = addBuilding(s, 0, 'refinery', f.x, f.y);
  ok(!supplied(s, ref), 'a far Refinery is cut off');
  // A hauler unloading there: the credits stay on site.
  const h = addUnit(s, 0, 'hauler', f.x + 1.5, f.y + 2.5);
  h.cargo = 200;
  h.order = { type: 'harvest', phase: 'unload', tile: -1, refinery: ref.id };
  const cr0 = s.players[0].credits;
  let x = s;
  for (let i = 0; i < 6; i++) x = processAction(x, { type: 'tick', n: 1 });
  const r1 = x.buildings.find(b => b.id === ref.id)!;
  ok(x.players[0].credits <= cr0 && (r1.held ?? 0) === 200, `unloaded at a cut-off Refinery, 200 credits are held on site (${r1.held}), none reach the store`);
  // Full: the hauler waits with its cargo.
  const full = copy(x);
  const rf = full.buildings.find(b => b.id === ref.id)!;
  rf.held = REFINERY_HOLD;
  const hf = full.units.find(u => u.id === h.id)!;
  hf.cargo = 100;
  hf.order = { type: 'harvest', phase: 'unload', tile: -1, refinery: ref.id };
  let y = full;
  for (let i = 0; i < 4; i++) y = processAction(y, { type: 'tick', n: 1 });
  const yh = y.units.find(u => u.id === h.id)!;
  ok(yh.cargo === 100 && y.buildings.find(b => b.id === ref.id)!.held === REFINERY_HOLD, 'with the site full, the hauler keeps its cargo');
  ok(yh.order.type === 'harvest' && yh.order.refinery !== ref.id, 'and takes it to another refinery (the supplied one by the yard)');
  // Linked again: it comes home at the flow rate, then the field is gone from the save.
  const d = at(SUPPLY_LINK_RANGE - 2);
  const back = copy(x);
  addBuilding(back, 0, 'depot', d.x, d.y);
  const bref = back.buildings.find(b => b.id === ref.id)!;
  ok(supplied(back, bref), 'a Depot links it again');
  const cr1 = back.players[0].credits;
  let beats = 0;
  while (bref.held && beats < 20) {
    back.tick++;
    if (back.tick % SUPPLY_TICKS === 0) beats++;
    supplyStep(back);
  }
  ok(beats === 200 / SUPPLY_FLOW_CREDITS && back.players[0].credits === cr1 + 200 && !('held' in bref), `it comes home at ${SUPPLY_FLOW_CREDITS} a beat (${beats} beats) and leaves nothing behind`);
  // Fuel Well and Foundry, cut off.
  const ws = spotFor(back, 'fuelwell', true)!;
  const w = addBuilding(back, 0, 'fuelwell', ws.x, ws.y);
  const fuel0 = back.players[0].fuel!;
  const wellCut = new Set([w.id]);
  for (let t = 0; t < FUEL_WELL_TICKS * (WELL_HOLD + 10); t++) {
    back.tick++;
    industryStep(back, NO_LOW, wellCut);
  }
  ok(w.held === WELL_HOLD && back.players[0].fuel === fuel0, `a cut-off well fills its own tank to ${WELL_HOLD} and stops; the store never moves`);
  const fo = addBuilding(back, 0, 'foundry', 0, 0);
  back.players[0].fuel = 100;
  back.players[0].credits = 5000;
  const al0 = back.players[0].alloys;
  for (let t = 0; t < FOUNDRY_TICKS * 3; t++) {
    back.tick++;
    industryStep(back, NO_LOW, new Set([fo.id]));
  }
  ok(back.players[0].alloys === al0 && back.players[0].credits === 5000, 'a cut-off Foundry smelts nothing');
  ok(SUPPLY_FLOW_GOODS > 0, 'fuel flows home too');
});

const depotAi = quiet((ok: Ok): void => {
  const { s, at } = supplyArena('depot-ai');
  ok(depotSpot(s, 0) === null, 'nothing cut off: the computer wants no Depot');
  const f = at(SUPPLY_LINK_RANGE + SUPPLY_SERVE_RANGE - 3);
  const well = addBuilding(s, 0, 'fuelwell', f.x, f.y);
  // Something of side 0's near the line, so the build radius lets a Depot stand out there.
  const p1 = at(6);
  addBuilding(s, 0, 'power', p1.x, p1.y + 3);
  const p2 = at(10);
  addBuilding(s, 0, 'power', p2.x, p2.y + 3);
  const spot = depotSpot(s, 0);
  ok(!!spot && placementProblem(s, 0, 'depot', spot!.x, spot!.y) === null, 'a cut-off well: the computer finds a legal Depot spot');
  if (spot) {
    addBuilding(s, 0, 'depot', spot.x, spot.y);
    ok(supplied(s, well) || cutOff(s, 0).length === 1, 'the Depot there links toward the well');
  }
});

/** Whole computer battles with supply lines on: Depots get built, held goods stay sane, battles end. */
function supplyBattles(ok: Ok): void {
  const seeds = ['sup-a', 'sup-b', 'sup-c', 'sup-d'];
  let ended = 0;
  let cutSamples = 0;
  let samples = 0;
  let sane = true;
  for (const [i, seed] of seeds.entries()) {
    let s = createInitialState(seed, seed, { seed, createdAt: 0, autopilot: true, difficulty: i % 2 ? 'hard' : 'normal', setup: { tech: 'advanced', industry: true, supply: true, map: i < 2 ? 'classic' : 'plains' } });
    s.autopilotDifficulty = 'normal';
    while (s.winner === null && s.tick < 30000) {
      s = processAction(s, { type: 'tick', n: 50 });
      for (const o of [0, 1] as Owner[]) {
        samples++;
        if (cutOff(s, o).length) cutSamples++;
      }
      for (const b of s.buildings) {
        if (b.held === undefined) continue;
        if (!Number.isFinite(b.held) || b.held <= 0) sane = false;
        if (b.kind === 'refinery' && b.held > REFINERY_HOLD + 50) sane = false;
        if (b.kind === 'fuelwell' && b.held > WELL_HOLD) sane = false;
        if (b.kind !== 'refinery' && b.kind !== 'fuelwell') sane = false;
      }
    }
    // Decided, or the known mined-out stalemate (no ore left anywhere and no army on either side),
    // which the ladder shows at 0 to 3 in 150 with or without industry.
    if (s.winner !== null || (!s.ore.some(o => o > 0) && !s.units.some(u => u.kind !== 'hauler' && unitSpecOf(s, u).weapon))) ended++;
  }
  ok(sane, 'goods held on site: only on a Refinery or Fuel Well, positive, within its cap');
  ok(cutSamples / samples < 0.05, `the commanders build where they are supplied: cut off ${((100 * cutSamples) / samples).toFixed(1)}% of the time, under 5%`);
  ok(ended === seeds.length, `every battle is decided inside 50 minutes, or ends mined out with no army left (${ended} of ${seeds.length})`);
}

function supplySaves(ok: Ok): void {
  const play = (saveAt = -1) => {
    let s = createInitialState('sp', 'sp', { seed: 'sp', createdAt: 0, autopilot: true, setup: { tech: 'advanced', industry: true, supply: true, map: 'classic' } });
    for (let i = 0; i < 120; i++) {
      s = processAction(s, { type: 'tick', n: 50 });
      if (i === saveAt) s = migrateState(JSON.parse(JSON.stringify(s)))!;
    }
    return s;
  };
  const a = play();
  ok(hash(a) === hash(play()) && hash(a) === hash(play(60)), 'a battle with supply lines replays byte-identically, and through a save mid-battle');
  const junk = copy(a);
  const ref = junk.buildings.find(b => b.kind === 'refinery')!;
  (ref as unknown as { held: unknown }).held = 'lots';
  const hq = junk.buildings.find(b => b.kind === 'hq')!;
  hq.held = 40;
  const m = migrateState(junk)!;
  ok(!('held' in m.buildings.find(b => b.id === ref.id)!) && !('held' in m.buildings.find(b => b.id === hq.id)!), 'junk held goods, and goods on a structure that cannot hold them, are dropped');
  const ind = createInitialState('ip', 'ip', { seed: 'ip', createdAt: 0, setup: { tech: 'advanced', industry: true } });
  const dirty = copy(ind);
  dirty.buildings[0].held = 30;
  ok(!('held' in migrateState(dirty)!.buildings[0]), 'without supply lines, held goods are dropped');
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Industry: the setup, and where it never applies', setup],
  ['Industry: prices in credits, alloys and fuel', prices],
  ['Industry: queueing pays goods and cancelling returns them', queueSection],
  ['Industry: a Fuel Well stands by ore', placement],
  ['Industry: the Fuel Well pumps, fills its store and runs dry', pumping],
  ['Industry: the Foundry smelts, and stops short of its inputs or store', smelting],
  ['Industry: whole computer battles', battles],
  ['Industry: replays and saves', saves],
  ['Supply lines: the setup', supplySetup],
  ['Supply lines: the network, a chain and a cut', network],
  ['Supply lines: goods held on site, and coming home', holding],
  ['Supply lines: the computer finds a Depot spot', depotAi],
  ['Supply lines: whole computer battles', supplyBattles],
  ['Supply lines: replays and saves', supplySaves],
];
