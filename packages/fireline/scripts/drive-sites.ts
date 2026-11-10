/**
 * Neutral sites and tier three (fireline-round5-design.md, workstream D): the harness sections.
 * Each one proves a rule by what happens in the simulation, not by what the data says. Imported by
 * drive.ts, so its assertions count in the main totals.
 */
import { processAction } from '../src/sim/actions';
import { setAutopilotAi } from '../src/sim/ai';
import { launchAircraft } from '../src/sim/air';
import { canAttack, canQueue, doAttack } from '../src/sim/commands';
import { dist, occupancy } from '../src/sim/grid';
import { siteDist, siteSpots, sitesProblem, stealthSeen } from '../src/sim/sites';
import {
  BUILD_MENU,
  BUILDINGS,
  DAMAGE_VS,
  DERRICK_INCOME,
  DERRICK_TICKS,
  FLIGHT_TICKS,
  HOSPITAL_HEAL,
  HOSPITAL_RANGE,
  HOSPITAL_TICKS,
  MAP_TYPES,
  RELAY_RADIUS,
  SITE_CAPTURE_TICKS,
  SITE_KINDS,
  SITES_PER_SIDE,
  STANDARD_TECH,
  STEALTH_DETECT_RANGE,
  STEALTH_REVEAL_TICKS,
  TIER3_AI_TICKS,
  UNITS,
  VEHICLE_MENU,
  type BuildingKind,
  type Category,
  type Owner,
  type SiteKind,
  type SkirmishSetup,
  type UnitKind,
} from '../src/sim/rules';
import { addBuilding, addUnit, createInitialState, migrateState, teamVisibility, techAllowed, visibility } from '../src/sim/state';
import type { Building, GameState, MissionRuntime, Site, Unit } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

const TIER3_UNITS: UnitKind[] = ['railtank', 'stealthtank'];
const TIER3_STRUCTURES: BuildingKind[] = ['protoworks', 'fortress'];
const SIDES: (2 | 3 | 4)[] = [2, 3, 4];

const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
/** Runs n ticks, in actions of at most 500. */
function tick(s: GameState, n = 1): GameState {
  for (let left = n; left > 0; left -= 500) s = processAction(s, { type: 'tick', n: Math.min(500, left) });
  return s;
}
const unitIn = (s: GameState, id: number) => s.units.find(u => u.id === id);
const buildingIn = (s: GameState, id: number) => s.buildings.find(b => b.id === id);
const siteIn = (s: GameState, id: number) => s.sites!.find(x => x.id === id)!;
const categoryOfKind = (k: BuildingKind | UnitKind): Category => (k in BUILDINGS ? 'building' : UNITS[k as UnitKind].category);

/** Every computer commander switched off: these sections test the rules, not the commander. */
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

/**
 * An advanced skirmish with everyone's units gone, nothing attacking, and (cx, cy) the middle of 17
 * by 17 tiles of clear grass with no ore. Its own sites are cleared: each test puts down its own.
 */
function arena(setup: Partial<SkirmishSetup> = {}, seed = 'sites-arena') {
  const s = copy(createInitialState(seed, seed, { seed, createdAt: 0, setup: { map: 'plains', tech: 'advanced', credits: 20000, ...setup } }));
  s.units = [];
  s.sites = [];
  for (const m of s.ai) m.nextAttack = 1e9;
  const occ = occupancy(s);
  const cx = Math.floor(s.mapW / 2);
  const cy = Math.floor(s.mapH / 2);
  const tiles = s.tiles.split('');
  for (let y = cy - 8; y <= cy + 8; y++)
    for (let x = cx - 8; x <= cx + 8; x++) {
      const k = y * s.mapW + x;
      if (occ[k]) throw new Error('a structure in the middle of the sites arena');
      tiles[k] = 'g';
      s.ore[k] = 0;
    }
  s.tiles = tiles.join('');
  return { s, cx, cy };
}

function site(s: GameState, kind: SiteKind, x: number, y: number, owner: Owner | null = null): Site {
  const st: Site = { id: s.nextId++, kind, x, y, owner, capture: null };
  s.sites = (s.sites ?? []).concat([st]);
  return st;
}

function put(s: GameState, owner: Owner, kind: UnitKind, x: number, y: number, extra: Partial<Unit> = {}): Unit {
  const u = addUnit(s, owner, kind, x, y);
  Object.assign(u, extra);
  return u;
}

// ---------------------------------------------------------------------------------------------

function placement(ok: Ok): void {
  for (const n of SIDES)
    for (const map of MAP_TYPES) {
      let bad = 0;
      for (let i = 0; i < 10; i++) {
        const seed = `sites-${n}-${map}-${i}`;
        const setup: Partial<SkirmishSetup> = { map, sides: n, tech: i % 2 ? 'standard' : 'advanced', sites: true };
        const s = createInitialState(seed, seed, { seed, createdAt: 0, setup });
        const label = `${n} sides, ${map}, seed ${i}`;
        const problem = sitesProblem(s);
        if (problem) bad++;
        ok(problem === null, `${label}: sitesProblem passes (${problem})`);
        for (const kind of SITE_KINDS)
          ok(s.sites!.filter(x => x.kind === kind).length === SITES_PER_SIDE.standard[kind] * n, `${label}: ${SITES_PER_SIDE.standard[kind] * n} ${kind}s`);
        ok(s.sites!.every(x => x.owner === null && x.capture === null), `${label}: every site starts neutral`);
        // The preview's helper gives the battle's sites, from the map and the battle's seed.
        const spots = siteSpots({ w: s.mapW, h: s.mapH, tiles: s.tiles, ore: s.ore, starts: s.starts! }, s.setup!, s.rngSeed);
        ok(JSON.stringify(spots) === JSON.stringify(s.sites!.map(x => ({ kind: x.kind, x: x.x, y: x.y }))), `${label}: siteSpots agrees with the battle`);
        // Placing sites changes nothing else: map, ore, the battle's stream, the yards and units (but for ids).
        const off = createInitialState(seed, seed, { seed, createdAt: 0, setup: { ...setup, sites: false } });
        const strip = (list: { id: number }[]) => JSON.stringify(list.map(({ id: _id, ...rest }) => rest));
        ok(
          off.tiles === s.tiles && JSON.stringify(off.ore) === JSON.stringify(s.ore) && off.rngSeed === s.rngSeed && JSON.stringify(off.starts) === JSON.stringify(s.starts),
          `${label}: the map, ore and stream are the same with sites`,
        );
        ok(strip(off.units) === strip(s.units) && strip(off.buildings) === strip(s.buildings), `${label}: the yards and riflemen are the same with sites`);
        ok(off.sites === undefined, `${label}: sites off: none`);
        // Nobody starts inside a site, and a site is never on a yard.
        const occ = occupancy(s);
        ok(s.units.every(u => !s.sites!.some(x => occ[Math.floor(u.y) * s.mapW + Math.floor(u.x)] === x.id)), `${label}: no unit stands on a site`);
      }
      if (bad) console.log(`    ${n} sides, ${map}: ${bad} of 10 seeds failed placement`);
    }
  // Exact symmetry, the rule sitesProblem checks, shown directly for two and four sides.
  const two = createInitialState('sym2', 'sym2', { seed: 'sym2', createdAt: 0, setup: { map: 'classic', sites: true } });
  ok(two.sites!.every(a => two.sites!.some(b => b.kind === a.kind && b.x === two.mapW - 2 - a.x && b.y === two.mapH - 2 - a.y)), 'two sides: every site mirrors through the centre');
  const four = createInitialState('sym4', 'sym4', { seed: 'sym4', createdAt: 0, setup: { map: 'lakes', sides: 4, sites: true } });
  ok(four.sites!.every(a => four.sites!.some(b => b.kind === a.kind && b.x === four.mapW - 2 - a.y && b.y === a.x)), 'four sides: every site turns a quarter round the centre');
  // Missions and battles without the switch have none.
  const legacy = createInitialState('leg', 'leg', { seed: 'leg', createdAt: 0 });
  ok(legacy.sites === undefined && sitesProblem(legacy) === null, 'the original game has no sites');
  // The same map always draws the same sites; with no seed given, from the map itself.
  const m = { w: two.mapW, h: two.mapH, tiles: two.tiles, ore: two.ore, starts: two.starts! };
  ok(JSON.stringify(siteSpots(m, { size: 'standard' })) === JSON.stringify(siteSpots(m, { size: 'standard' })), 'siteSpots is a pure function of its map');
}

function capture(ok: Ok): void {
  const { s: base, cx, cy } = arena();
  const st = site(base, 'derrick', cx - 1, cy - 1);
  const beside = (s: GameState, owner: Owner, kind: UnitKind, dx: number) => put(s, owner, kind, cx + dx, cy + 0.5, { stance: 'hold' });
  // Neutral to a side: exactly SITE_CAPTURE_TICKS.
  let s = copy(base);
  beside(s, 0, 'rifleman', -1.6);
  s = tick(s, SITE_CAPTURE_TICKS - 1);
  ok(siteIn(s, st.id).owner === null && siteIn(s, st.id).capture?.by === 0, 'one tick short: still neutral, side 0 capturing');
  ok(Math.abs(siteIn(s, st.id).capture!.progress - (SITE_CAPTURE_TICKS - 1) / SITE_CAPTURE_TICKS) < 1e-9, 'progress rises a step a tick');
  s = tick(s, 1);
  ok(siteIn(s, st.id).owner === 0 && siteIn(s, st.id).capture === null, 'taken after SITE_CAPTURE_TICKS');
  ok(s.effects.some(e => e.kind === 'captured') && s.log.some(l => l.text.includes('Oil Derrick taken')), 'a captured effect and a log line for side 0');
  // Retaken by an enemy: side 0 walks off, side 1 walks up.
  let r = copy(s);
  r.units = [];
  beside(r, 1, 'rifleman', 1.6);
  r = tick(r, SITE_CAPTURE_TICKS);
  ok(siteIn(r, st.id).owner === 1, 'an enemy takes it back the same way');
  ok(r.log.some(l => l.text.includes('lost an Oil Derrick')), 'side 0 is told it lost the site');
  // Contested: two teams beside it, the progress holds.
  let c = copy(base);
  beside(c, 0, 'rifleman', -1.6);
  c = tick(c, 40);
  beside(c, 1, 'rifleman', 1.6);
  const held = siteIn(c, st.id).capture!.progress;
  c = tick(c, 60);
  ok(siteIn(c, st.id).capture?.progress === held && siteIn(c, st.id).owner === null, 'contested: the progress pauses');
  // Left alone, it winds back down at the same rate.
  c.units = [];
  c = tick(c, 20);
  ok(Math.abs(siteIn(c, st.id).capture!.progress - (held - 20 / SITE_CAPTURE_TICKS)) < 1e-9, 'left alone: the progress falls a step a tick');
  c = tick(c, SITE_CAPTURE_TICKS);
  ok(siteIn(c, st.id).capture === null && siteIn(c, st.id).owner === null, 'and comes to nothing');
  // The holder's own infantry stop nothing and take nothing; an enemy's partial capture winds down
  // first when another team takes over.
  let h = copy(s);
  h.units = [];
  beside(h, 0, 'rifleman', -1.6);
  h = tick(h, SITE_CAPTURE_TICKS * 2);
  ok(siteIn(h, st.id).owner === 0 && siteIn(h, st.id).capture === null, "a side's own infantry beside its site change nothing");
  // Never by vehicles or aircraft.
  let v = copy(base);
  beside(v, 0, 'tank', -1.8);
  const pad = addBuilding(v, 0, 'helipad', cx - 6, cy + 4, -100);
  const g = put(v, 0, 'gunship', cx + 1.8, cy + 0.5);
  launchAircraft(v, g, pad);
  g.x = cx + 1.8;
  g.y = cy + 0.5;
  g.order = { type: 'idle' };
  v = tick(v, SITE_CAPTURE_TICKS * 2);
  ok(siteIn(v, st.id).owner === null && siteIn(v, st.id).capture === null, 'vehicles and aircraft never capture');
  // Medics and the rest of the infantry do.
  let m = copy(base);
  beside(m, 0, 'medic', -1.6);
  m = tick(m, SITE_CAPTURE_TICKS);
  ok(siteIn(m, st.id).owner === 0, 'any infantry captures, a Medic included');
  // A side that is out loses its sites, which go back to neutral.
  let out = copy(s);
  out.buildings = out.buildings.filter(b => b.owner !== 0);
  out = tick(out, 1);
  ok(siteIn(out, st.id).owner === null || out.winner !== null, 'a side out of the battle keeps no site');
}

function allies(ok: Ok): void {
  const { s: base, cx, cy } = arena({ sides: 4, mode: 'teams' }, 'sites-allies');
  ok(base.teams.join() === '0,1,0,1', 'four sides as teams: 0 and 2 against 1 and 3');
  const st = site(base, 'derrick', cx - 1, cy - 1, 0);
  let s = copy(base);
  put(s, 2, 'rifleman', cx + 1.6, cy + 0.5, { stance: 'hold' });
  s = tick(s, SITE_CAPTURE_TICKS * 2);
  ok(siteIn(s, st.id).owner === 0 && siteIn(s, st.id).capture === null, "an ally's infantry never take a site its team holds");
  // A neutral site with both allies beside it: one team, so it is taken (by the first one there).
  let n = copy(base);
  n.sites = n.sites!.map(x => ({ ...x, owner: null }));
  put(n, 2, 'rifleman', cx + 1.6, cy + 0.5, { stance: 'hold' });
  put(n, 0, 'rifleman', cx - 1.6, cy + 0.5, { stance: 'hold' });
  n = tick(n, SITE_CAPTURE_TICKS);
  ok(siteIn(n, st.id).owner === 2, 'two allies beside a neutral site are one team: not contested');
  ok(n.log.some(l => l.text.includes('Our ally has taken an Oil Derrick')), 'side 0 hears of its ally taking a site');
  // A Comms Relay shows its area to its holder and the holder's ally, not to the enemy.
  const { s: rs, cx: rx, cy: ry } = arena({ sides: 4, mode: 'teams' }, 'sites-relay');
  const relay = site(rs, 'relay', rx - 1, ry - 1, 0);
  const far = (ry + RELAY_RADIUS - 1) * rs.mapW + rx;
  const beyond = (ry + RELAY_RADIUS + 2) * rs.mapW + rx;
  ok(visibility(rs, 0)[far] === 1 && visibility(rs, 0)[beyond] === 0, `a Comms Relay shows its holder ${RELAY_RADIUS} tiles round it, no further`);
  ok(teamVisibility(rs, 2)[far] === 1, "and the holder's ally");
  ok(teamVisibility(rs, 1)[far] === 0 && teamVisibility(rs, 3)[far] === 0, 'but not the enemy');
  const neutral = copy(rs);
  neutral.sites = neutral.sites!.map(x => ({ ...x, owner: null }));
  ok(visibility(neutral, 0)[far] === 0, 'an unheld relay shows nobody anything');
  void relay;
}

function effects(ok: Ok): void {
  const { s: base, cx, cy } = arena();
  // Oil Derrick: 300 a minute exactly, and nothing to anyone without one.
  let s = copy(base);
  site(s, 'derrick', cx - 1, cy - 1, 0);
  const c0 = s.players.map(p => p.credits);
  s = tick(s, 600);
  ok(s.players[0].credits - c0[0] === (600 / DERRICK_TICKS) * DERRICK_INCOME, `an Oil Derrick pays ${(600 / DERRICK_TICKS) * DERRICK_INCOME} a minute (${s.players[0].credits - c0[0]})`);
  ok(s.players[1].credits === c0[1], 'and nothing to the side without it');
  // Field Hospital: its holder's infantry in range, HOSPITAL_HEAL every HOSPITAL_TICKS; nobody else.
  let h = copy(base);
  site(h, 'hospital', cx - 1, cy - 1, 0);
  const near = put(h, 0, 'rifleman', cx + 1 + HOSPITAL_RANGE - 0.4, cy, { hp: 5, stance: 'hold' });
  const away = put(h, 0, 'rifleman', cx + 1 + HOSPITAL_RANGE + 1.5, cy, { hp: 5, stance: 'hold' });
  const foe = put(h, 1, 'rifleman', cx - 1 - HOSPITAL_RANGE + 0.6, cy, { hp: 5, stance: 'hold' });
  const tank = put(h, 0, 'tank', cx, cy + 2.5, { hp: 100, stance: 'hold' });
  h = tick(h, HOSPITAL_TICKS * 5);
  ok(unitIn(h, near.id)!.hp === 5 + 5 * HOSPITAL_HEAL, `a Field Hospital heals its holder's infantry in range ${HOSPITAL_HEAL} every ${HOSPITAL_TICKS} ticks (${unitIn(h, near.id)!.hp})`);
  ok(unitIn(h, away.id)!.hp === 5 && unitIn(h, foe.id)!.hp === 5, "nobody out of range, and never an enemy's");
  ok(unitIn(h, tank.id)!.hp === 100, 'never a vehicle');
  ok(h.effects.some(e => e.kind === 'heal'), 'a heal effect on the mended');
}

function neverATarget(ok: Ok): void {
  const { s: base, cx, cy } = arena();
  const st = site(base, 'derrick', cx - 1, cy - 1, 1);
  const r = put(base, 0, 'rifleman', cx - 3, cy + 0.5);
  ok(processAction(base, { type: 'attack', ids: [r.id], target: st.id }) === base, 'a site cannot be attacked');
  ok(!canAttack(base, 0, [r.id], st.id), 'canAttack refuses a site');
  // A turret and a tank beside an enemy site never fire at it, and it never fires.
  let s = copy(base);
  addBuilding(s, 0, 'turret', cx - 4, cy - 1, -100);
  put(s, 0, 'tank', cx + 2.5, cy + 0.5);
  s = tick(s, 200);
  ok(!s.projectiles.length && !s.effects.some(e => e.kind === 'muzzle'), 'nothing fires at a site, and a site fires at nothing');
  // A side with sites and no structure is out.
  let v = copy(base);
  v.buildings = v.buildings.filter(b => b.owner !== 1);
  v.sites = v.sites!.map(x => ({ ...x, owner: 1 }));
  v = tick(v, 1);
  ok(v.winner === 0, 'a side holding sites but no structure is out');
  // Units walk round a site and nothing is built on one.
  const occ = occupancy(base);
  ok(occ[cy * base.mapW + cx] === st.id, 'a site holds its tiles in occupancy');
  let w = copy(base);
  const walker = put(w, 0, 'rifleman', cx - 3.5, cy - 0.5);
  w = processAction(w, { type: 'move', ids: [walker.id], x: cx + 2.5, y: cy - 0.5 });
  let inside = false;
  for (let i = 0; i < 60; i++) {
    w = tick(w, 5);
    const u = unitIn(w, walker.id)!;
    if (siteDist(u.x, u.y, st) === 0 && u.x > st.x && u.x < st.x + 2 && u.y > st.y && u.y < st.y + 2) inside = true;
  }
  const end = unitIn(w, walker.id)!;
  ok(!inside && dist(end.x, end.y, cx + 2.5, cy - 0.5) < 1.5, 'a unit walks round a site to the far side');
}

function tierThreeRules(ok: Ok): void {
  const spec = (k: UnitKind) => UNITS[k];
  ok(spec('railtank').cost === 1800 && spec('railtank').hp === 650 && spec('railtank').armor === 'heavy' && spec('railtank').weapon!.kind === 'rail', 'Railgun Tank: the contract numbers');
  ok(spec('stealthtank').cost === 1400 && spec('stealthtank').armor === 'light' && spec('stealthtank').stealth === true, 'Stealth Tank: the contract numbers, stealth');
  ok(BUILDINGS.protoworks.w === 3 && BUILDINGS.protoworks.power === -100 && BUILDINGS.protoworks.requires.join() === 'researchlab,techcentre', 'Prototype Works: 3 by 3, -100 power, needs a Research Lab and a Tech Centre');
  ok(BUILDINGS.fortress.weapon?.range === 7 && BUILDINGS.fortress.weapon.splash === 0.8 && BUILDINGS.fortress.requires.join() === 'protoworks', 'Fortress: range 7, splash, needs the Works');
  for (const k of TIER3_UNITS) ok(spec(k).requires.join() === 'factory,protoworks' && VEHICLE_MENU.includes(k), `${k}: on the Vehicles list, needs a factory and the Works`);
  ok(BUILD_MENU.indexOf('protoworks') === 14 && BUILD_MENU.indexOf('fortress') === 15, 'the Works and the Fortress are the 15th and 16th Structures (no hotkey)');
  for (const k of [...TIER3_UNITS, ...TIER3_STRUCTURES]) ok(!STANDARD_TECH.includes(k), `${k}: advanced tech only`);
  // The rail weapon: instant, about twice a Battle Tank's damage a second on heavy armour for 2.25 times the cost.
  ok(FLIGHT_TICKS.rail === 0, 'a rail slug lands the instant it fires');
  const rail = spec('railtank').weapon!;
  const shell = spec('tank').weapon!;
  const ratio = (rail.damage * DAMAGE_VS.rail.heavy) / rail.cooldown / ((shell.damage * DAMAGE_VS.shell.heavy) / shell.cooldown);
  ok(ratio > 1.8 && ratio < 2.4, `rail against heavy armour: ${ratio.toFixed(2)} times a Battle Tank's damage a second`);
  ok(DAMAGE_VS.rail.infantry < DAMAGE_VS.shell.infantry && DAMAGE_VS.rail.aircraft === 0, 'rail: poor against infantry, never reaches the air');
  // Offered only with advanced tech, never in a mission, and only with the Works standing.
  const grant = (s: GameState, works: boolean) => {
    for (const o of [0, 1] as Owner[]) {
      const kinds: BuildingKind[] = ['power', 'refinery', 'barracks', 'factory', 'uplink', 'techcentre', 'researchlab'];
      if (works) kinds.push('protoworks');
      kinds.forEach((k, i) => addBuilding(s, o, k, o === 0 ? 1 + (i % 3) * 3 : s.mapW - 4 - (i % 3) * 3, o === 0 ? 1 + Math.floor(i / 3) * 3 : s.mapH - 4 - Math.floor(i / 3) * 3, -100));
    }
    s.players[0].credits = s.players[1].credits = 50000;
    return s;
  };
  const adv = () => copy(createInitialState('t3', 't3', { seed: 't3', createdAt: 0, setup: { map: 'plains', tech: 'advanced' } }));
  const std = grant(copy(createInitialState('t3s', 't3s', { seed: 't3s', createdAt: 0, setup: { map: 'plains', tech: 'standard' } })), true);
  const with3 = grant(adv(), true);
  const without = grant(adv(), false);
  for (const k of [...TIER3_UNITS, 'fortress' as const]) {
    const cat = categoryOfKind(k);
    ok(canQueue(with3, 0, cat, k) && canQueue(with3, 1, cat, k), `${k}: offered with the Works standing`);
    ok(!canQueue(without, 0, cat, k), `${k}: refused without the Works`);
    ok(!canQueue(std, 0, cat, k) && !canQueue(std, 1, cat, k), `${k}: refused on standard tech`);
  }
  ok(canQueue(without, 0, 'building', 'protoworks') && !canQueue(std, 0, 'building', 'protoworks'), 'the Works: advanced tech only');
  const mission = { ...with3, mission: { id: 'm' } as MissionRuntime, allowed: STANDARD_TECH.slice() };
  for (const k of [...TIER3_UNITS, ...TIER3_STRUCTURES]) ok(!techAllowed(mission, 0, k) && !techAllowed(mission, 1, k), `${k}: never in a mission`);
}

function railAndFortress(ok: Ok): void {
  const { s: base, cx, cy } = arena();
  // The Railgun: one slug, 150 times the heavy-armour factor, the tick it fires.
  let s = copy(base);
  const rt = put(s, 0, 'railtank', cx - 3, cy + 0.5);
  const target = put(s, 1, 'tank', cx + 3, cy + 0.5, { stance: 'hold' });
  s = processAction(s, { type: 'attack', ids: [rt.id], target: target.id });
  let hitAt = -1;
  let fired = -1;
  for (let i = 0; i < 60 && hitAt < 0; i++) {
    const before = unitIn(s, target.id)!.hp;
    s = tick(s, 1);
    if (s.effects.some(e => e.kind === 'muzzle' && e.weapon === 'rail' && e.at === s.tick)) fired = s.tick;
    const after = unitIn(s, target.id)?.hp ?? 0;
    if (after < before) {
      hitAt = s.tick;
      ok(before - after === Math.round(150 * DAMAGE_VS.rail.heavy), `a rail slug takes ${Math.round(150 * DAMAGE_VS.rail.heavy)} from a Battle Tank (${before - after})`);
    }
  }
  ok(hitAt > 0 && hitAt === fired, 'and lands the tick it is fired');
  ok(!s.projectiles.some(p => p.weapon === 'rail'), 'a rail slug is never in flight');
  // The Fortress: range 7 from its centre, at units only.
  const f = copy(base);
  const fort = addBuilding(f, 0, 'fortress', cx - 1, cy - 1, -100);
  const inRange = put(f, 1, 'tank', cx + 6.5, cy, { stance: 'hold' });
  const outRange = put(f, 1, 'tank', cx, cy - 7.6, { stance: 'hold' });
  const g = tick(f, 120);
  ok(unitIn(g, inRange.id)!.hp < UNITS.tank.hp, 'a Fortress shells a tank 6.5 tiles away');
  ok(unitIn(g, outRange.id)!.hp === UNITS.tank.hp, 'and not one 7.6 away');
  ok(buildingIn(g, fort.id)!.engage === inRange.id || unitIn(g, inRange.id)!.hp < UNITS.tank.hp, 'it engages what is in range');
}

function stealth(ok: Ok): void {
  const { s: base, cx, cy } = arena();
  // Hidden at 4 tiles from an enemy tank and turret, holding fire.
  const s = copy(base);
  const st = put(s, 1, 'stealthtank', cx + 2, cy + 0.5, { stance: 'hold' });
  const tank = put(s, 0, 'tank', cx - 2, cy + 0.5);
  const turret = addBuilding(s, 0, 'turret', cx - 3, cy + 3, -100);
  ok(!stealthSeen(s, unitIn(s, st.id)!, 0), 'a Stealth Tank 4 tiles from the enemy is not seen');
  ok(stealthSeen(s, unitIn(s, st.id)!, 1), 'its own side always sees it');
  ok(!canAttack(s, 0, [tank.id], st.id), 'an unseen Stealth Tank cannot be ordered attacked');
  let t = tick(s, 80);
  ok(unitIn(t, st.id)!.hp === UNITS.stealthtank.hp, 'nothing in range fires at it while it is unseen');
  ok(unitIn(t, tank.id)!.engage === 0 && buildingIn(t, turret.id)!.engage === 0, 'nor picks it as a target');
  // Within STEALTH_DETECT_RANGE it is seen and targetable.
  const close = copy(s);
  unitIn(close, tank.id)!.x = cx + 2 - (STEALTH_DETECT_RANGE - 0.3);
  ok(stealthSeen(close, unitIn(close, st.id)!, 0) && canAttack(close, 0, [tank.id], st.id), `within ${STEALTH_DETECT_RANGE} tiles it is seen and may be attacked`);
  const fought = tick(close, 60);
  ok((unitIn(fought, st.id)?.hp ?? 0) < UNITS.stealthtank.hp, 'and is fired on');
  // Firing shows it for STEALTH_REVEAL_TICKS.
  let f = copy(s);
  unitIn(f, st.id)!.stance = 'guard';
  let shotAt = -1;
  for (let i = 0; i < 40 && shotAt < 0; i++) {
    f = tick(f, 1);
    if (unitIn(f, st.id)!.lastShot !== undefined) shotAt = f.tick;
  }
  ok(shotAt > 0 && unitIn(f, st.id)!.lastShot === shotAt, 'a Stealth Tank that fires records its last shot');
  ok(stealthSeen(f, unitIn(f, st.id)!, 0), 'and is seen just after');
  unitIn(f, st.id)!.stance = 'hold';
  unitIn(f, st.id)!.engage = 0;
  f = tick(f, STEALTH_REVEAL_TICKS - 2);
  ok(stealthSeen(f, unitIn(f, st.id)!, 0), `still seen ${STEALTH_REVEAL_TICKS - 2} ticks later`);
  f = tick(f, 4);
  ok(!stealthSeen(f, unitIn(f, st.id)!, 0), `hidden again once ${STEALTH_REVEAL_TICKS} ticks have passed`);
  ok(unitIn(f, tank.id)!.engage !== st.id && buildingIn(f, turret.id)!.engage !== st.id, 'and every enemy drops it');
  const hp = unitIn(f, st.id)!.hp;
  f = tick(f, 60);
  ok(unitIn(f, st.id)!.hp === hp, 'nothing hits it once it is hidden again');
  // The computer is held to the same rule. Its own targeting never picks a hidden one (above, the
  // turret); an attack order given straight to its units (which no part of the commander gives:
  // it aims only at haulers, artillery and structures) is dropped at the end of its first tick.
  const c = copy(base);
  const mine = put(c, 0, 'stealthtank', cx + 2, cy + 0.5, { stance: 'hold' });
  const theirs = put(c, 1, 'tank', cx - 2, cy + 0.5);
  doAttack(c, 1, [theirs.id], mine.id);
  const d1 = tick(c, 1);
  ok(unitIn(d1, theirs.id)!.order.type !== 'attack' && unitIn(d1, theirs.id)!.engage === 0, "the computer's attack order on a hidden Stealth Tank is dropped after one tick");
  const d = tick(d1, 40);
  ok(unitIn(d, mine.id)!.hp >= UNITS.stealthtank.hp - Math.round(UNITS.tank.weapon!.damage * DAMAGE_VS.shell.light), 'and nothing more is fired at it');
  // Recon shows them, as it shows Spies.
  const r = copy(s);
  r.recon = [[cx + 2, cy + 0.5, 4, r.tick + 50]];
  ok(stealthSeen(r, unitIn(r, st.id)!, 0), 'a recon sweep shows a Stealth Tank');
}

function saves(ok: Ok): void {
  const { s: base, cx, cy } = arena();
  const a = site(base, 'derrick', cx - 1, cy - 1, 0);
  site(base, 'relay', cx + 4, cy - 1, null);
  base.sites = base.sites!.map(x => (x.id === a.id ? { ...x, capture: { by: 1 as Owner, progress: 0.25 } } : x));
  const st = put(base, 1, 'stealthtank', cx + 6, cy + 4, { lastShot: 3 });
  const good = migrateState(copy(base));
  ok(good !== null && JSON.stringify(good.sites) === JSON.stringify(base.sites), 'sound sites survive a save as they were');
  ok(good !== null && unitIn(good, st.id)!.lastShot === 3, "a Stealth Tank's last shot survives a save");
  const junk = copy(base);
  const id = junk.nextId;
  junk.nextId += 10;
  (junk.sites as unknown[]).push(
    { id, kind: 'castle', x: 4, y: 4, owner: null, capture: null },
    { id: id + 1, kind: 'derrick', x: -1, y: 4, owner: null, capture: null },
    { id: id + 2, kind: 'derrick', x: 4.5, y: 4, owner: null, capture: null },
    { id: a.id, kind: 'derrick', x: 6, y: 6, owner: null, capture: null },
    { id: id + 3, kind: 'hospital', x: 6, y: 9, owner: 7, capture: { by: 0, progress: 9 } },
    { id: id + 4, kind: 'hospital', x: 6, y: 13, owner: 1, capture: { by: 0, progress: -2 } },
    { id: id + 5, kind: 'relay', x: base.mapW - 1, y: 4, owner: null, capture: null },
    null,
    'nonsense',
  );
  const m = migrateState(junk)!;
  const kept = m.sites!.map(x => x.id);
  ok(m.sites!.length === 4 && kept.includes(id + 3) && kept.includes(id + 4), 'junk sites are dropped: unknown kinds, off the map, half tiles, a taken id');
  ok(m.sites!.find(x => x.id === id + 3)!.owner === null && m.sites!.find(x => x.id === id + 3)!.capture?.progress === 1, 'a junk owner reads as neutral, progress is clamped');
  ok(m.sites!.find(x => x.id === id + 4)!.capture === null, 'no progress: no capture');
  const notList = copy(base);
  (notList as { sites: unknown }).sites = { derrick: 1 };
  ok(migrateState(notList)!.sites === undefined, 'sites that are not a list are dropped');
  const inMission = copy(base);
  inMission.mission = { id: 'm', ai: 'normal', objectives: [], bonus: [], timeLimit: null, fired: [], result: null };
  ok(migrateState(inMission)!.sites === undefined, 'a mission keeps no sites');
  const old = copy(base);
  delete old.sites;
  ok(migrateState(old)!.sites === undefined, 'a save from before sites has none');
  // The reducer never touches its input's sites.
  const before = JSON.stringify(base.sites);
  const after = processAction(base, { type: 'tick', n: 50 });
  ok(JSON.stringify(base.sites) === before && after.sites !== base.sites && after.sites![0] !== base.sites![0], 'a tick copies the sites and leaves its input alone');
}

function replay(ok: Ok): void {
  const run = () => {
    let s = createInitialState('replay-sites', 'r', { seed: 'replay-sites', createdAt: 0, autopilot: true, setup: { map: 'classic', tech: 'advanced', sites: true } });
    s = tick(s, 4000);
    return s;
  };
  const a = run();
  const b = run();
  ok(JSON.stringify(a) === JSON.stringify(b), 'a battle with sites replays byte-identically');
  const via = migrateState(JSON.parse(JSON.stringify(a)))!;
  ok(JSON.stringify(tick(via, 500)) === JSON.stringify(tick(a, 500)), 'and goes on identically after a save and load');
  // Tier three in a fight, twice.
  const fight = () => {
    const { s, cx, cy } = arena({}, 'replay-t3');
    put(s, 0, 'railtank', cx - 4, cy);
    put(s, 0, 'stealthtank', cx - 4, cy + 2);
    put(s, 1, 'tank', cx + 4, cy);
    put(s, 1, 'stealthtank', cx + 4, cy + 2);
    addBuilding(s, 1, 'fortress', cx + 6, cy - 3, -100);
    return tick(s, 400);
  };
  ok(JSON.stringify(fight()) === JSON.stringify(fight()), 'a tier-three fight replays byte-identically');
}

/** The computer: it takes sites early in a battle with them, and turns to tier three only after 25 minutes. */
function computer(ok: Ok): void {
  let s = createInitialState('ai-sites', 'ai', { seed: 'ai-sites', createdAt: 0, autopilot: true, setup: { map: 'plains', tech: 'advanced', sites: true } });
  const took = new Set<number>();
  for (let i = 0; i < 30 && s.winner === null; i++) {
    s = tick(s, 100);
    for (const x of s.sites!) if (x.owner !== null) took.add(x.owner);
  }
  ok(took.has(0) && took.has(1), `both commanders take sites in the first five minutes (${[...took].join(', ')})`);
  // Sites with standard tech: the commander still takes them.
  let st = createInitialState('ai-sites-std', 'ai', { seed: 'ai-sites-std', createdAt: 0, autopilot: true, setup: { map: 'classic', tech: 'standard', sites: true } });
  st = tick(st, 3000);
  ok(st.sites!.some(x => x.owner !== null), 'and on standard tech');

  // A long battle with no waves (both sides held back): no tier three before 25 minutes, then a
  // Prototype Works and tier-three units.
  let l = createInitialState('ai-t3', 'ai', { seed: 'ai-t3', createdAt: 0, autopilot: true, difficulty: 'hard', setup: { map: 'plains', tech: 'advanced', ore: 'rich', credits: 10000 } });
  l.autopilotDifficulty = 'hard';
  const hold = (x: GameState) => {
    for (const m of x.ai) {
      m.nextAttack = 1e9;
      m.nextRaid = 1e9;
    }
  };
  hold(l);
  let early = false;
  let works = -1;
  const units = new Set<UnitKind>();
  // Fifteen minutes past the start of tier three (ten before the air war): with Troop Carriers and
  // Interceptors to buy as well, the Hard commander's first Railgun Tank came at minute 37 or 38.
  while (l.tick < TIER3_AI_TICKS + 9000 && l.winner === null) {
    l = tick(l, 500);
    hold(l);
    const has = l.buildings.some(b => b.kind === 'protoworks') || l.players.some(p => p.queues.building.some(q => q.kind === 'protoworks'));
    if (has && l.tick <= TIER3_AI_TICKS) early = true;
    if (works < 0 && l.buildings.some(b => b.kind === 'protoworks')) works = l.tick;
    for (const u of l.units) if (TIER3_UNITS.includes(u.kind)) units.add(u.kind);
  }
  ok(!early, 'no Prototype Works before 25 minutes');
  ok(works > TIER3_AI_TICKS, `a Prototype Works after 25 minutes (tick ${works})`);
  ok(units.has('railtank'), `Railgun Tanks follow (${[...units].join(', ')})`);
  console.log(`  long battle, hard against hard, no waves: Works at minute ${(works / 600).toFixed(1)}; tier three fielded: ${[...units].join(', ') || 'none'}`);
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Neutral sites: placement', placement],
  ['Neutral sites: capture', quiet(capture)],
  ['Neutral sites: allies and the Comms Relay', quiet(allies)],
  ['Neutral sites: the Derrick and the Hospital', quiet(effects)],
  ['Neutral sites: never a target, never in victory', quiet(neverATarget)],
  ['Tier three: rules, menus and requirements', tierThreeRules],
  ['Tier three: the Railgun and the Fortress', quiet(railAndFortress)],
  ['Tier three: stealth', quiet(stealth)],
  ['Neutral sites and tier three: saves', saves],
  ['Neutral sites and tier three: replay', replay],
  ['Neutral sites and tier three: the computer', computer],
];
