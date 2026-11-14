/**
 * The naval war (2026-11-11): the Coast map, the Naval Yard, ships, torpedoes, Submarines, the
 * Landing Craft and the computer's navy. Each section proves a rule by what happens in the
 * simulation. Imported by drive.ts, so its assertions count in the main totals.
 */
import { processAction } from '../src/sim/actions';
import { setAutopilotAi } from '../src/sim/ai';
import { canAttack, canQueue, placementProblem } from '../src/sim/commands';
import { dist, occupancy } from '../src/sim/grid';
import { generateSkirmishMap, mapProblem } from '../src/sim/maps';
import { isShip, shoreProblem } from '../src/sim/naval';
import {
  BUILDINGS,
  DAMAGE_VS,
  DETECTOR_RANGE,
  MAP_SIZES,
  MAP_TYPES,
  NAVAL_MENU,
  SHIPYARD_MEND_HP,
  SHIPYARD_MEND_RANGE,
  SHIPYARD_MEND_TICKS,
  STANDARD_TECH,
  STEALTH_DETECT_RANGE,
  UNITS,
  hitsAir,
  hitsGround,
  hitsNaval,
  type BuildingKind,
  type SkirmishSetup,
  type UnitKind,
} from '../src/sim/rules';
import { stealthSeen } from '../src/sim/sites';
import { addBuilding, createInitialState, migrateState } from '../src/sim/state';
import { unloadProblem } from '../src/sim/transport';
import type { GameState, Unit } from '../src/sim/types';
import { copy, put, tick, tickUntil, unitIn } from './drive-air';

type Ok = (cond: unknown, what: string) => void;

const SHIPS: UnitKind[] = ['gunboat', 'destroyer', 'submarine', 'battleship', 'landingcraft'];
const water = (s: GameState, x: number, y: number) => s.tiles[Math.floor(y) * s.mapW + Math.floor(x)] === 'w';

/** Side 1's commander switched off: these sections test the rules, not the commander. */
function quiet(fn: (ok: Ok) => void): (ok: Ok) => void {
  return ok => {
    setAutopilotAi(() => {}, 1);
    try {
      fn(ok);
    } finally {
      setAutopilotAi(null, 1);
    }
  };
}

/**
 * An advanced Coast skirmish with every unit gone and nothing attacking, plus: the open-water tile
 * nearest the middle (`mid`), a shore spot for side 0's Naval Yard (`shore`), and helpers.
 */
export function coastArena(seed = 'naval-arena', extra: Partial<SkirmishSetup> = {}) {
  const s = copy(createInitialState(seed, seed, { seed, createdAt: 0, setup: { map: 'coast', tech: 'advanced', credits: 30000, ...extra } }));
  s.units = [];
  for (const m of s.ai) m.nextAttack = 1e9;
  const occ = occupancy(s);
  let shore: { x: number; y: number } | null = null;
  for (let y = Math.floor(s.mapH / 2); y < s.mapH && !shore; y++)
    for (let x = 0; x < s.mapW && !shore; x++) if (placementProblem(s, 0, 'shipyard', x, y, occ, { anywhere: true }) === null) shore = { x, y };
  let mid = { x: 0, y: 0 };
  let best = Infinity;
  for (let k = 0; k < s.tiles.length; k++) {
    if (s.tiles[k] !== 'w') continue;
    const x = (k % s.mapW) + 0.5;
    const y = ((k / s.mapW) | 0) + 0.5;
    const d = dist(x, y, s.mapW / 2, s.mapH / 2);
    if (d < best) {
      best = d;
      mid = { x, y };
    }
  }
  return { s, shore: shore!, mid };
}

/** The open water tile nearest (x, y). */
export function seaNear(s: GameState, x: number, y: number): { x: number; y: number } {
  let best = { x: 0, y: 0 };
  let bestD = Infinity;
  for (let k = 0; k < s.tiles.length; k++) {
    if (s.tiles[k] !== 'w') continue;
    const px = (k % s.mapW) + 0.5;
    const py = ((k / s.mapW) | 0) + 0.5;
    const d = dist(px, py, x, y);
    if (d < bestD) {
      bestD = d;
      best = { x: px, y: py };
    }
  }
  return best;
}

/** Land tile nearest (x, y) that is walkable and clear. */
export function landNear(s: GameState, x: number, y: number): { x: number; y: number } {
  const occ = occupancy(s);
  let best = { x: 0, y: 0 };
  let bestD = Infinity;
  for (let k = 0; k < s.tiles.length; k++) {
    const c = s.tiles[k];
    if ((c !== 'g' && c !== 'd') || occ[k]) continue;
    const px = (k % s.mapW) + 0.5;
    const py = ((k / s.mapW) | 0) + 0.5;
    const d = dist(px, py, x, y);
    if (d < bestD) {
      bestD = d;
      best = { x: px, y: py };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------

function rules(ok: Ok): void {
  for (const k of SHIPS) {
    ok(UNITS[k].category === 'naval' && UNITS[k].armor === 'ship', `${k}: a ship`);
    ok(NAVAL_MENU.includes(k) && !STANDARD_TECH.includes(k), `${k}: on the Naval tab, advanced tech only`);
    ok(UNITS[k].requires.includes('shipyard'), `${k}: built at a Naval Yard`);
  }
  ok(!STANDARD_TECH.includes('shipyard') && BUILDINGS.shipyard.w === 3, 'the Naval Yard: advanced tech only, three tiles square');
  const torp = UNITS.submarine.weapon!;
  ok(hitsNaval(torp) && !hitsGround(torp) && !hitsAir(torp), 'the torpedo hits ships and nothing else');
  ok(DAMAGE_VS.torpedo.ship === 1 && DAMAGE_VS.flak.ship === 0, 'torpedoes hurt ships; flak never does');
  for (const u of Object.values(UNITS)) {
    const w = u.weapon;
    if (!w || w.kind === 'torpedo' || w.kind === 'flak' || w.kind === 'aamissile') continue;
    ok(hitsNaval(w) === hitsGround(w), `${u.name}: hits ships exactly when it hits the ground`);
  }
  ok(UNITS.submarine.stealth === true && UNITS.destroyer.detector === true, 'the Submarine is stealthy; the Destroyer is a detector');
  ok(UNITS.landingcraft.carries === 6 && !UNITS.landingcraft.weapon, 'the Landing Craft: unarmed, six places');
  ok(UNITS.battleship.weapon!.range > UNITS.destroyer.weapon!.range + 3 && (UNITS.battleship.weapon!.minRange ?? 0) > 0, 'the Battleship outranges everything afloat and cannot fire close');
  // Standard tech offers none of it.
  const std = copy(createInitialState('nv-std', 'nv-std', { seed: 'nv-std', createdAt: 0, setup: { map: 'coast', tech: 'standard', credits: 30000 } }));
  for (const k of ['power', 'factory'] as BuildingKind[]) addBuilding(std, 0, k, 1 + std.buildings.length * 4, 1, -100);
  ok(!canQueue(std, 0, 'building', 'shipyard'), 'standard tech: no Naval Yard');
  const { s, shore } = coastArena('nv-tech');
  addBuilding(s, 0, 'factory', 1, 1, -100);
  ok(canQueue(s, 0, 'building', 'shipyard'), 'advanced tech: a Factory offers the Naval Yard');
  ok(!canQueue(s, 0, 'naval', 'gunboat'), 'no ships without a Naval Yard');
  addBuilding(s, 0, 'shipyard', shore.x, shore.y, -100);
  ok(canQueue(s, 0, 'naval', 'gunboat') && canQueue(s, 0, 'naval', 'destroyer') && !canQueue(s, 0, 'naval', 'submarine'), 'with one: Patrol Boats and Destroyers; Submarines need a Research Lab');
}

/** The Coast map: legal at every size and side count, with a real sea. */
function coastMaps(ok: Ok): void {
  ok(MAP_TYPES.includes('coast'), 'Coast is a map type');
  for (const sides of [2, 3, 4] as const)
    for (const size of MAP_SIZES) {
      let bad = 0;
      let seaMin = Infinity;
      const N = size === 'standard' ? 12 : 4;
      for (let seed = 1; seed <= N; seed++) {
        const m = generateSkirmishMap(seed * 104729 + sides, 'coast', 'normal', sides, size);
        if (mapProblem(m) !== null) bad++;
        let w = 0;
        for (const c of m.tiles) if (c === 'w') w++;
        seaMin = Math.min(seaMin, w);
      }
      ok(bad === 0, `${sides} sides, ${size}: ${N} Coast maps, every one legal (${bad} not)`);
      ok(seaMin >= 300, `${sides} sides, ${size}: every one has a sea (least water ${seaMin} tiles)`);
    }
}

/** The Naval Yard: on the shore of open sea only. */
function yards(ok: Ok): void {
  const { s, shore } = coastArena('nv-yard');
  ok(!!shore, `a shore spot exists (${shore?.x}, ${shore?.y})`);
  ok(shoreProblem(s, shore.x, shore.y) === null, 'on the shore: accepted');
  const hq = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
  ok(shoreProblem(s, hq.x, hq.y + 4) !== null, 'inland: refused (Must be built on the shore)');
  // A pond: a little water by itself.
  const p = copy(s);
  const land = landNear(p, 6, p.mapH - 6);
  const tl = p.tiles.split('');
  for (let y = 0; y < p.mapH; y++) for (let x = 0; x < p.mapW; x++) if (tl[y * p.mapW + x] === 'w') tl[y * p.mapW + x] = 'g';
  for (let y = Math.floor(land.y) - 1; y <= Math.floor(land.y) + 1; y++) for (let x = Math.floor(land.x) + 3; x <= Math.floor(land.x) + 5; x++) tl[y * p.mapW + x] = 'w';
  p.tiles = tl.join('');
  ok(shoreProblem(p, Math.floor(land.x), Math.floor(land.y) - 1) !== null, 'beside a pond: refused (Needs open sea)');
}

/** Ships come out on the water, sail it and never touch land; sent inland they stop at the shore. */
function sailing(ok: Ok): void {
  const { s, shore, mid } = coastArena('nv-sail');
  for (const k of ['factory', 'power', 'power', 'power'] as BuildingKind[]) addBuilding(s, 0, k, 1 + s.buildings.length * 3, 1, -100);
  const yard = addBuilding(s, 0, 'shipyard', shore.x, shore.y, -100);
  s.players[0].queues.naval = [{ kind: 'destroyer', progress: UNITS.destroyer.buildTicks }];
  let t = tick(s, 3);
  const ship = t.units.find(u => u.kind === 'destroyer');
  ok(!!ship && water(t, ship.x, ship.y), 'a finished ship comes out on the water');
  ok(!!ship && dist(ship.x, ship.y, yard.x + 1.5, yard.y + 1.5) < 6, 'beside its Naval Yard');
  t = processAction(t, { type: 'move', ids: [ship!.id], x: mid.x, y: mid.y });
  let dry = 0;
  for (let i = 0; i < 500 && unitIn(t, ship!.id)!.order.type !== 'idle'; i++) {
    t = tick(t);
    const u = unitIn(t, ship!.id)!;
    if (!water(t, u.x, u.y)) dry++;
  }
  const u = unitIn(t, ship!.id)!;
  ok(dist(u.x, u.y, mid.x, mid.y) < 1, 'it sails to the middle of the sea');
  ok(dry === 0, 'and never leaves the water on the way');
  // Sent to a point inland: to the nearest water, and no further.
  const hq = t.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
  let i2 = processAction(t, { type: 'move', ids: [ship!.id], x: hq.x + 1.5, y: hq.y + 1.5 });
  i2 = tickUntil(i2, x => unitIn(x, ship!.id)!.order.type === 'idle', 800);
  const v = unitIn(i2, ship!.id)!;
  ok(v.order.type === 'idle' && water(i2, v.x, v.y), 'sent inland, it stops on the water nearest the point');
  ok(JSON.stringify(tick(t, 400)) === JSON.stringify(tick(t, 400)), 'sailing replays byte-identically');
}

/** Who hits what: ships, torpedoes, flak, the shore. */
function combat(ok: Ok): void {
  const { s, mid } = coastArena('nv-fight');
  // A Destroyer sinks a Patrol Boat.
  {
    const t0 = copy(s);
    put(t0, 0, 'destroyer', mid.x, mid.y);
    const g = put(t0, 1, 'gunboat', mid.x + 3, mid.y, { stance: 'hold' });
    if (!water(t0, mid.x + 3, mid.y)) g.x = mid.x - 3;
    const t = tickUntil(t0, x => !unitIn(x, g.id), 1500);
    ok(!unitIn(t, g.id), 'a Destroyer sinks a Patrol Boat');
  }
  // A Submarine's torpedoes sink a Destroyer; a tank on the shore within reach is never touched.
  {
    const t0 = copy(s);
    const sub = put(t0, 0, 'submarine', mid.x, mid.y);
    const near = seaNear(t0, mid.x + 3, mid.y);
    const d = put(t0, 1, 'destroyer', near.x, near.y, { stance: 'hold' });
    const t = tickUntil(t0, x => !unitIn(x, d.id), 3000);
    ok(!unitIn(t, d.id), 'torpedoes sink a Destroyer');
    const beach = landNear(t0, mid.x, mid.y);
    const b0 = copy(t0);
    b0.units = b0.units.filter(u => u.id !== d.id);
    const sub2 = unitIn(b0, sub.id)!;
    const sea = seaNear(b0, beach.x, beach.y);
    sub2.x = sea.x;
    sub2.y = sea.y;
    const tank = put(b0, 1, 'tank', beach.x, beach.y, { stance: 'hold' });
    ok(!canAttack(b0, 0, [sub.id], tank.id), 'a Submarine may not be ordered at a tank');
    const after = tick(b0, 200);
    ok(unitIn(after, tank.id)!.hp === UNITS.tank.hp, 'and never fires at one on the beach');
  }
  // A tank on the shore shells a ship; a Flak Cannon never does.
  {
    const t0 = copy(s);
    const beach = landNear(t0, mid.x, mid.y);
    const sea = seaNear(t0, beach.x, beach.y);
    const g = put(t0, 1, 'gunboat', sea.x, sea.y, { stance: 'hold' });
    put(t0, 0, 'tank', beach.x, beach.y);
    const t = tickUntil(t0, x => (unitIn(x, g.id)?.hp ?? 0) < UNITS.gunboat.hp, 200);
    ok((unitIn(t, g.id)?.hp ?? 0) < UNITS.gunboat.hp, 'a tank on the beach shells a ship offshore');
    const f0 = copy(s);
    const g2 = put(f0, 1, 'gunboat', sea.x, sea.y, { stance: 'hold' });
    addBuilding(f0, 0, 'flakcannon', Math.floor(beach.x), Math.floor(beach.y), -100);
    const f = tick(f0, 200);
    ok(unitIn(f, g2.id)!.hp === UNITS.gunboat.hp, 'a Flak Cannon never fires at a ship');
  }
  // A Patrol Boat's machine guns reach an aircraft.
  {
    const t0 = copy(s);
    put(t0, 0, 'gunboat', mid.x, mid.y);
    const h = put(t0, 1, 'gunship', mid.x + 2, mid.y, { stance: 'hold', ammo: 0, order: { type: 'idle' } });
    const t = tickUntil(t0, x => (unitIn(x, h.id)?.hp ?? 0) < UNITS.gunship.hp, 200);
    ok((unitIn(t, h.id)?.hp ?? 0) < UNITS.gunship.hp, 'a Patrol Boat fires at an aircraft overhead');
  }
  // A ship sent at a structure it can never get in range of gives the order up instead of waiting.
  {
    const t0 = copy(s);
    const g = put(t0, 0, 'gunboat', mid.x, mid.y);
    const hq = t0.buildings.find(b => b.owner === 1 && b.kind === 'hq')!;
    let t = processAction(t0, { type: 'attack', ids: [g.id], target: hq.id });
    ok(t !== t0, 'a Patrol Boat may be ordered at an inland Command Yard');
    t = tickUntil(t, x => unitIn(x, g.id)!.order.type !== 'attack', 1500);
    ok(unitIn(t, g.id)!.order.type !== 'attack', 'and, at the nearest water and still out of range, gives it up');
  }
}

/** The Submarine: hidden except close up, near a Destroyer, or just after it fires. */
function submarines(ok: Ok): void {
  const { s, mid } = coastArena('nv-sub');
  const sub = put(s, 1, 'submarine', mid.x, mid.y, { stance: 'hold' });
  const boat = put(s, 0, 'gunboat', mid.x + STEALTH_DETECT_RANGE + 1.5, mid.y);
  if (!water(s, boat.x, boat.y)) boat.x = mid.x - STEALTH_DETECT_RANGE - 1.5;
  ok(!stealthSeen(s, sub, 0), 'a Submarine four tiles from a Patrol Boat is unseen');
  const quietT = tick(s, 100);
  ok(unitIn(quietT, sub.id)!.hp === UNITS.submarine.hp, 'and the boat leaves it alone');
  const d = copy(s);
  const dest = put(d, 0, 'destroyer', mid.x, mid.y + DETECTOR_RANGE - 1);
  if (!water(d, dest.x, dest.y)) dest.y = mid.y - DETECTOR_RANGE + 1;
  ok(stealthSeen(d, unitIn(d, sub.id)!, 0), `a Destroyer ${DETECTOR_RANGE - 1} tiles off finds it`);
  const hunted = tickUntil(d, x => (unitIn(x, sub.id)?.hp ?? 0) < UNITS.submarine.hp, 400);
  ok((unitIn(hunted, sub.id)?.hp ?? 0) < UNITS.submarine.hp, 'and the boats open fire');
}

/** Naval Yards mend their side's ships beside them, free. */
function mending(ok: Ok): void {
  const { s, shore } = coastArena('nv-mend');
  const yard = addBuilding(s, 0, 'shipyard', shore.x, shore.y, -100);
  const sea = seaNear(s, yard.x + 1.5, yard.y + 1.5);
  const g = put(s, 0, 'gunboat', sea.x, sea.y, { stance: 'hold', hp: 100 });
  const credits = s.players[0].credits;
  const t = tick(s, SHIPYARD_MEND_TICKS * 10);
  const hp = unitIn(t, g.id)!.hp;
  ok(hp >= 100 + SHIPYARD_MEND_HP * 9 && hp <= 100 + SHIPYARD_MEND_HP * 10, `a hurt ship beside the yard is mended (${hp})`);
  ok(t.players[0].credits === credits, 'for nothing');
  const far = copy(s);
  const m = seaNear(far, far.mapW / 2, far.mapH / 2);
  unitIn(far, g.id)!.x = m.x;
  unitIn(far, g.id)!.y = m.y;
  ok(unitIn(tick(far, SHIPYARD_MEND_TICKS * 10), g.id)!.hp === 100, 'out at sea, it is not');
  // Return to base: the ship sails back beside its Naval Yard and is mended there.
  let r = processAction(far, { type: 'home', ids: [g.id] });
  ok(r !== far && unitIn(r, g.id)!.order.type === 'move', 'Return to base sends a ship back toward its Naval Yard');
  r = tickUntil(r, x => unitIn(x, g.id)!.order.type === 'idle', 3000);
  const yardC = { x: yard.x + 1.5, y: yard.y + 1.5 };
  const home = unitIn(r, g.id)!;
  ok(dist(home.x, home.y, yardC.x, yardC.y) <= 1.5 + SHIPYARD_MEND_RANGE + 1, `it arrives beside the yard (${dist(home.x, home.y, yardC.x, yardC.y).toFixed(1)} tiles from its middle)`);
  r = tick(r, SHIPYARD_MEND_TICKS * 10);
  ok(unitIn(r, g.id)!.hp > home.hp, 'and is mended there');
  const noYard = copy(far);
  noYard.buildings = noYard.buildings.filter(b => b.kind !== 'shipyard');
  ok(processAction(noYard, { type: 'home', ids: [g.id] }) === noYard, 'with no Naval Yard, Return to base is refused');
}

/** The Landing Craft: boards from the shore, carries vehicles at two places, lands on a beach. */
function landings(ok: Ok): void {
  const { s, shore, mid } = coastArena('nv-land');
  const yard = addBuilding(s, 0, 'shipyard', shore.x, shore.y, -100);
  const sea = seaNear(s, yard.x + 1.5, yard.y + 1.5);
  const craft = put(s, 0, 'landingcraft', sea.x, sea.y);
  const beach = landNear(s, sea.x, sea.y);
  const tanks = [put(s, 0, 'tank', beach.x, beach.y + 1), put(s, 0, 'tank', beach.x + 1, beach.y + 1)];
  const men = [put(s, 0, 'rifleman', beach.x - 1, beach.y + 1), put(s, 0, 'rifleman', beach.x - 1, beach.y + 2), put(s, 0, 'rifleman', beach.x, beach.y + 2)];
  const hauler = put(s, 0, 'hauler', beach.x + 2, beach.y + 2);
  ok(processAction(s, { type: 'board', ids: [hauler.id], carrier: craft.id }) === s, 'a hauler may not board');
  let t = processAction(s, { type: 'board', ids: [...tanks, ...men].map(u => u.id), carrier: craft.id });
  t = tickUntil(t, x => !x.units.some(u => u.boarding), 900);
  const c = unitIn(t, craft.id)!;
  const aboard = c.carried ?? [];
  const places = aboard.reduce((n, r) => n + (UNITS[r.kind].category === 'vehicle' ? 2 : 1), 0);
  ok(aboard.length >= 3 && places <= 6, `it fills from the shore without overfilling (${aboard.length} aboard, ${places} of 6 places)`);
  ok(aboard.some(r => r.kind === 'tank'), 'tanks board it (two places each)');
  // Far out at sea: nowhere to land.
  let f = processAction(t, { type: 'move', ids: [craft.id], x: mid.x, y: mid.y });
  f = tickUntil(f, x => unitIn(x, craft.id)!.order.type === 'idle', 1200);
  const out = unitIn(f, craft.id)!;
  const landWithin3 = (() => {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (!water(f, out.x + dx, out.y + dy) && f.tiles[Math.floor(out.y + dy) * f.mapW + Math.floor(out.x + dx)] !== 'r') return true;
    return false;
  })();
  if (!landWithin3) ok(unloadProblem(f, 0, craft.id) !== null && processAction(f, { type: 'unload', id: craft.id }) === f, 'out at sea, it cannot unload');
  // The far shore: Unload in flight, they land where it stops.
  const far = landNear(t, t.mapW - beach.x, t.mapH - beach.y);
  const farSea = seaNear(t, far.x, far.y);
  let l = processAction(t, { type: 'move', ids: [craft.id], x: farSea.x, y: farSea.y });
  l = processAction(l, { type: 'unload', id: craft.id });
  l = tickUntil(l, x => !unitIn(x, craft.id)!.carried, 2500);
  const landed = aboard.map(r => unitIn(l, r.id));
  ok(!unitIn(l, craft.id)!.carried && landed.every(Boolean), 'sailed across and unloaded, everyone is ashore');
  ok(landed.every(u => u && !water(l, u.x, u.y) && dist(u.x, u.y, farSea.x, farSea.y) < 6), 'on dry land at the far beach');
  ok(JSON.stringify(tick(t, 300)) === JSON.stringify(tick(t, 300)), 'a landing replays byte-identically');
}

function oldSaves(ok: Ok): void {
  const { s, mid } = coastArena('nv-save');
  const c = put(s, 0, 'landingcraft', mid.x, mid.y, { order: { type: 'idle' } });
  const rider = (kind: UnitKind, id: number): Unit => ({ ...put(copy(s), 0, kind, 0.5, 0.5), id });
  c.carried = [rider('tank', 9001), rider('tank', 9002), rider('tank', 9003), rider('rifleman', 9004), rider('hauler', 9005)];
  const raw = JSON.parse(JSON.stringify(s));
  delete raw.players[0].queues.naval;
  raw.ai[1].landing = { craft: 'nonsense' };
  raw.ai[1].navalShore = 'nowhere';
  const m = migrateState(raw);
  ok(!!m && Array.isArray(m.players[0].queues.naval), 'a save from before the naval war gets an empty Naval queue');
  const kept = m ? unitIn(m, c.id)!.carried ?? [] : [];
  ok(kept.length === 3 && kept.every(r => r.kind === 'tank'), 'a Landing Craft keeps what fits (three tanks) and drops the rest and the hauler');
  ok(!!m && m.ai[1].landing === null && m.ai[1].navalShore === undefined, 'a malformed landing and sea are cleared');
}

/** The computer's navy on the Coast map, and none anywhere else. */
function computer(ok: Ok): void {
  const play = (seed: string, map: 'coast' | 'plains', cap: number) => {
    let s = createInitialState(seed, seed, { seed, difficulty: 'hard', createdAt: 0, autopilot: true, setup: { map, tech: 'advanced' } });
    s.autopilotDifficulty = 'hard';
    const kinds = new Set<string>();
    let yard = false;
    let landing = 0;
    const kills = new Map<number, number>();
    while (s.winner === null && s.tick < cap) {
      s = tick(s, 50);
      if (s.buildings.some(b => b.kind === 'shipyard')) yard = true;
      for (const u of s.units) if (isShip(u)) {
        kinds.add(u.kind);
        kills.set(u.id, u.kills);
      }
      for (const m of s.ai) if (m.landing?.phase === 'sail') landing = Math.max(landing, m.landing.ids.length);
    }
    return { s, kinds, yard, landing, kills: [...kills.values()].reduce((a, b) => a + b, 0) };
  };
  const a = play('nv-ai-1', 'coast', 24000);
  ok(a.yard, 'on the Coast map the computer builds a Naval Yard');
  ok(a.kinds.has('gunboat') && a.kinds.has('destroyer'), `and a fleet (${[...a.kinds].join(', ')})`);
  ok(a.kills > 0, `whose ships score kills (${a.kills})`);
  ok(a.landing > 0, `and makes a landing (${a.landing} troops)`);
  const b = play('nv-ai-1', 'coast', 24000);
  ok(JSON.stringify(a.s) === JSON.stringify(b.s), 'a naval battle replays byte-identically');
  const p = play('nv-ai-plains', 'plains', 9000);
  ok(!p.yard && p.kinds.size === 0, 'on Plains, with no sea, it builds no navy');
  console.log(`  naval battle on Hard (Coast): ${a.s.winner === null ? 'unfinished' : `side ${a.s.winner} won at ${Math.round(a.s.tick / 600)} min`}; ships ${[...a.kinds].join(', ')}; ${a.kills} kills by ships; landing of ${a.landing}`);
}


export const sections: [string, (ok: Ok) => void][] = [
  ['Naval war: rules', rules],
  ['Naval war: the Coast map', coastMaps],
  ['Naval war: the Naval Yard', quiet(yards)],
  ['Naval war: sailing', quiet(sailing)],
  ['Naval war: who hits what', quiet(combat)],
  ['Naval war: Submarines', quiet(submarines)],
  ['Naval war: mending', quiet(mending)],
  ['Naval war: landings', quiet(landings)],
  ['Naval war: older saves', oldSaves],
  ['Naval war: the computer', computer],
];
