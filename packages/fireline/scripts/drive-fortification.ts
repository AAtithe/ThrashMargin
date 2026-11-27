/**
 * Round 7: the Fortification line, counter-battery and Point Defence (fireline-round7-fortification.md).
 * The harness sections, imported by drive.ts so their assertions count in the main totals. Each mark is
 * proved by what happens in the simulation, measured against the same arena without it.
 */
import { MISSIONS } from '../src/campaign/missions';
import { ACT_TWO } from '../src/campaign/act2';
import { buildPlanetBattle } from '../src/planet/battle';
import { processAction } from '../src/sim/actions';
import { setAutopilotAi } from '../src/sim/ai';
import { FORT_PRESSURE_MIN, commanderFortifies, fortificationBranch, fortificationNext, pointDefenceFocus, wantsPointDefence } from '../src/sim/aiFortification';
import { canPlace, canQueue } from '../src/sim/commands';
import { interceptable } from '../src/sim/fortification';
import { fortificationOn, linesFor, shelterMul, structureMaxHp } from '../src/sim/fortify';
import { occupancy } from '../src/sim/grid';
import { doctrineProblem, hasUpgrade, researchCostOf, researchProblem, researchTicksOf } from '../src/sim/research';
import {
  BUILDINGS,
  BUILD_MENU,
  CONCRETE_HP,
  COUNTER_BATTERY_TICKS,
  DEFAULT_SETUP,
  FORTIFICATION_LINE,
  LEGACY_SETUP,
  LINE_ORDER,
  POINT_DEFENCE_CHANCE,
  POINT_DEFENCE_COOLDOWN,
  SELL_RETURN,
  SHELTERS_TAKEN,
  UPGRADES,
  applyPace,
  upgradeLineOf,
  type BuildingKind,
  type Owner,
  type SkirmishSetup,
  type UnitKind,
  type UpgradeId,
  type WeaponKind,
} from '../src/sim/rules';
import { addBuilding, addUnit, createInitialState, migrateState, normaliseSetup, powerOf, techAllowed, visibility } from '../src/sim/state';
import type { Building, GameState, Projectile, Unit } from '../src/sim/types';
import { craftSetup } from './drive-planet-battle';

type Ok = (cond: unknown, what: string) => void;

const copy = <T>(s: T): T => JSON.parse(JSON.stringify(s));
function tick(s: GameState, n = 1): GameState {
  for (let left = n; left > 0; left -= 500) s = processAction(s, { type: 'tick', n: Math.min(500, left) });
  return s;
}
function tickUntil(s: GameState, done: (s: GameState) => boolean, max: number): GameState {
  for (let i = 0; i < max && !done(s); i++) s = processAction(s, { type: 'tick' });
  return s;
}
const bIn = (s: GameState, id: number) => s.buildings.find(b => b.id === id)!;
const uIn = (s: GameState, id: number) => s.units.find(u => u.id === id);

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
 * An advanced development-lines skirmish on open plains with the Fortification line on (unless
 * `extra` says otherwise), every unit gone, nobody attacking, 17 by 17 tiles cleared round (cx, cy),
 * and side 0 given a Research Lab, a Tech Centre and power.
 */
function arena(seed: string, extra: Partial<SkirmishSetup> = {}) {
  const s = copy(createInitialState(seed, seed, { seed, createdAt: 0, setup: { map: 'plains', tech: 'advanced', credits: 20000, research: 'lines', fortification: true, ...extra } }));
  s.units = [];
  for (const m of s.ai) m.nextAttack = 1e9;
  const occ = occupancy(s);
  const cx = Math.floor(s.mapW / 2);
  const cy = Math.floor(s.mapH / 2);
  const tiles = s.tiles.split('');
  for (let y = cy - 8; y <= cy + 8; y++)
    for (let x = cx - 8; x <= cx + 8; x++) {
      const k = y * s.mapW + x;
      if (occ[k]) throw new Error('a structure in the middle of the fortification arena');
      tiles[k] = 'g';
      s.ore[k] = 0;
    }
  s.tiles = tiles.join('');
  addBuilding(s, 0, 'researchlab', cx - 6, cy - 7, -100);
  const kinds: BuildingKind[] = ['techcentre', 'power', 'power', 'power', 'power'];
  kinds.forEach((k, i) => addBuilding(s, 0, k, 1 + i * 4, 1, -100));
  return { s, cx, cy };
}

/** A projectile of `owner`'s, fired now from (fx, fy) to (tx, ty), landing `flight` ticks later. */
function shot(s: GameState, owner: Owner, weapon: WeaponKind, fx: number, fy: number, tx: number, ty: number, o: Partial<Projectile> = {}): Projectile {
  const p: Projectile = { id: s.nextId++, owner, weapon, fromX: fx, fromY: fy, toX: tx, toY: ty, firedAt: s.tick, hitAt: s.tick + 12, target: 0, damage: 200, splash: 1.2, shooter: 0, ...o };
  s.projectiles.push(p);
  return p;
}

/** Gives side `o` these upgrades (and the line's doctrine, for a Mk III), as if researched. */
function give(s: GameState, o: Owner, ids: UpgradeId[]): void {
  const p = s.players[o];
  p.upgrades = [...(p.upgrades ?? []), ...ids];
  for (const id of ids) if (upgradeLineOf(id)?.mark === 3) p.doctrines = { ...(p.doctrines ?? {}), fortification: id };
}

// ---- 1. The setup ---------------------------------------------------------------------------

function setups(ok: Ok): void {
  ok(DEFAULT_SETUP.fortification === true, 'a new advanced lines skirmish has the Fortification line (DEFAULT_SETUP)');
  ok(LEGACY_SETUP.fortification === false, 'the original game states it off (LEGACY_SETUP)');
  ok(normaliseSetup({}).fortification === true, 'an empty setup takes the default: on');
  ok(normaliseSetup({}, LEGACY_SETUP).fortification === false, 'a save without the field reads off (its base is LEGACY_SETUP)');
  ok(normaliseSetup({ tech: 'standard', fortification: true }).fortification === false, 'standard tech: off whatever is asked');
  ok(normaliseSetup({ tech: 'advanced', research: 'classic', fortification: true }).fortification === false, 'classic research: off whatever is asked');
  ok(normaliseSetup({ tech: 'advanced', research: 'lines', fortification: false }).fortification === false, 'turned off: off');
  ok(normaliseSetup({ fortification: 'yes' as never }, LEGACY_SETUP).fortification === false && normaliseSetup({ fortification: 1 as never }).fortification === true, 'junk takes the base\'s value');
  const keys = Object.keys(normaliseSetup({}));
  ok(keys.indexOf('fortification') === keys.indexOf('sites') + 1 && keys.indexOf('research') === keys.indexOf('fortification') + 1, 'a normalised setup states it, between sites and research');
  for (const [name, preset] of [['DEFAULT_SETUP', DEFAULT_SETUP], ['LEGACY_SETUP', LEGACY_SETUP]] as const)
    ok(JSON.stringify(Object.keys(preset)) === JSON.stringify(keys), `${name} states every field, the Fortification line included, in order`);
  for (const pace of ['quick', 'standard', 'long', 'epic'] as const) ok(applyPace(DEFAULT_SETUP, pace).fortification === true, `the ${pace} card keeps the line on`);
  // Every campaign mission states it off, and plays without it.
  const all = [...MISSIONS, ...ACT_TWO.filter(m => !MISSIONS.includes(m))];
  for (const m of all) ok(m.fortification === false, `${m.id}: states the Fortification line off`);
  // A planet battle states it off.
  for (let i = 0; i < 6; i++) {
    const b = buildPlanetBattle(craftSetup(i), { id: `fort-planet-${i}`, name: 'P', createdAt: 0 });
    ok(b.setup?.fortification === false && !fortificationOn(b) && linesFor(b).length === 5, `planet battle ${i}: the line is off, five lines`);
  }
  // A save from before round 7 (no field at all): off, five lines, and every fortification id dropped.
  const { s } = arena('fort-old-save');
  const old = copy(s);
  delete (old.setup as Partial<SkirmishSetup>).fortification;
  old.players[0].upgrades = ['refining', 'concrete', 'shelters'];
  old.players[0].doctrines = { logistics: 'assembly', fortification: 'pointdef' };
  old.reveals = [[1, 1, 3, 9999, 0, 0]];
  old.ai[1].shellAir = 4;
  const m = migrateState(old)!;
  ok(m.setup!.fortification === false && !fortificationOn(m) && linesFor(m).length === 5, 'an old save: the line is off');
  ok(JSON.stringify(m.players[0].upgrades) === '["refining"]' && JSON.stringify(m.players[0].doctrines) === '{"logistics":"assembly"}', 'an old save: Fortification upgrades and doctrine dropped, the rest kept');
  ok(m.reveals === undefined && m.ai[1].shellAir === undefined, 'an old save: no reveals, no shelling counts');
  // The same save with the line on keeps them; junk is dropped.
  const on = copy(s);
  on.players[0].upgrades = ['concrete', 'shelters', 'counterbattery'];
  on.players[0].doctrines = { fortification: 'counterbattery' };
  on.reveals = [[1, 1, 3, 9999, 0, 0], [1, 'x', 3, 9, 0, 0] as never, [1, 1, 3, 9, 7, 0]];
  on.ai[1].shellAir = 4;
  on.ai[1].shellGround = NaN;
  const n = migrateState(on)!;
  ok(n.setup!.fortification === true && JSON.stringify(n.players[0].upgrades) === '["concrete","shelters","counterbattery"]' && n.players[0].doctrines?.fortification === 'counterbattery', 'a save with the line on: its upgrades and doctrine kept');
  ok(n.reveals!.length === 1 && n.ai[1].shellAir === 4 && n.ai[1].shellGround === undefined, 'a save with the line on: well-formed reveals and counts kept, junk dropped');
  const closed = copy(s);
  closed.players[0].upgrades = ['concrete', 'shelters', 'pointdef'];
  closed.players[0].doctrines = { fortification: 'counterbattery' };
  ok(JSON.stringify(migrateState(closed)!.players[0].upgrades) === '["concrete","shelters"]', 'a save holding the branch its doctrine closed: that branch dropped');
}

// ---- 2. Off means off -----------------------------------------------------------------------

function offIsOff(ok: Ok): void {
  for (const [label, extra] of [
    ['toggle off', { fortification: false }],
    ['classic research', { research: 'classic' }],
    ['standard tech', { tech: 'standard' }],
  ] as [string, Partial<SkirmishSetup>][]) {
    const { s, cx, cy } = arena(`fort-off-${label}`, extra);
    ok(!fortificationOn(s) && linesFor(s).length === 5 && JSON.stringify(linesFor(s)) === JSON.stringify(LINE_ORDER), `${label}: five lines, no sixth`);
    for (const id of [...FORTIFICATION_LINE.marks, ...FORTIFICATION_LINE.fork]) {
      ok(processAction(s, { type: 'research', upgrade: id }) === s && researchProblem(s, 0, id) === 'Not in this battle', `${label}: ${id} refused, not in this battle`);
    }
    for (const b of FORTIFICATION_LINE.fork) ok(processAction(s, { type: 'doctrine', line: 'fortification', branch: b }) === s && doctrineProblem(s, 0, 'fortification', b) === 'Not in this battle', `${label}: doctrine ${b} refused`);
    give(s, 0, ['pointdef']);
    ok(!techAllowed(s, 0, 'pointdefence') && !canQueue(s, 0, 'building', 'pointdefence'), `${label}: Point Defence not offered, even holding the upgrade`);
    ok(processAction(s, { type: 'queue', category: 'building', kind: 'pointdefence' }) === s, `${label}: queueing Point Defence refused`);
    ok(processAction(s, { type: 'place', kind: 'pointdefence', x: cx, y: cy }) === s, `${label}: placing Point Defence refused`);
  }
  // Byte-identical play: the same Quick battle with the toggle on and off, the computer on both sides,
  // differs in the setup's field alone (nobody researches the line on Quick).
  const run = (fortification: boolean) => {
    let s = createInitialState('fort-same', 'S', { seed: 'fort-same', difficulty: 'normal', createdAt: 0, autopilot: true, setup: { map: 'random', tech: 'advanced', research: 'lines', credits: 5000, ore: 'rich', fortification } });
    s = tick(s, 6000);
    const c = copy(s);
    delete (c.setup as Partial<SkirmishSetup>).fortification;
    return JSON.stringify(c);
  };
  ok(run(true) === run(false), 'a Quick battle plays byte-identically with the toggle on and off (6,000 ticks, both sides the computer)');
}

// ---- 3. Mk I: Reinforced concrete -------------------------------------------------------------

function concrete(ok: Ok): void {
  const { s, cx, cy } = arena('fort-concrete');
  const gen = addBuilding(s, 0, 'power', cx + 3, cy + 3, -100);
  const spec = BUILDINGS.power;
  gen.hp = spec.hp - 100;
  ok(researchProblem(s, 0, 'concrete') === null, 'Reinforced concrete: legal with a Lab');
  ok(researchCostOf(s, 'concrete') === UPGRADES.concrete.cost && researchTicksOf(s, 'concrete') === UPGRADES.concrete.ticks, 'Quick: full price and time');
  const started = processAction(s, { type: 'research', upgrade: 'concrete' });
  ok(started !== s && started.players[0].credits === s.players[0].credits - UPGRADES.concrete.cost, 'Reinforced concrete: started and paid for');
  const done = tickUntil(started, x => hasUpgrade(x, 0, 'concrete'), UPGRADES.concrete.ticks + 5);
  ok(hasUpgrade(done, 0, 'concrete'), 'Reinforced concrete: researched');
  const raised = Math.round(spec.hp * CONCRETE_HP);
  const g = bIn(done, gen.id);
  ok(structureMaxHp(done, g) === raised && g.hp === raised - 100, `a standing structure's full health rises a fifth (${spec.hp} to ${raised}), keeping its damage (${g.hp})`);
  ok(done.buildings.filter(b => b.owner === 0).every(b => structureMaxHp(done, b) === Math.round(BUILDINGS[b.kind].hp * CONCRETE_HP)), 'every structure of the side, a fifth more');
  ok(done.buildings.filter(b => b.owner === 1).every(b => structureMaxHp(done, b) === BUILDINGS[b.kind].hp && b.hp <= BUILDINGS[b.kind].hp), 'the other side\'s structures unchanged');
  const t = copy(done);
  const fresh = addBuilding(t, 0, 'barracks', cx - 3, cy + 3);
  ok(fresh.hp === Math.round(BUILDINGS.barracks.hp * CONCRETE_HP), 'a new structure stands at the raised full health');
  // Measured: the shells it takes to bring down a Generator, with and without.
  const shellsToKill = (st: GameState, id: number) => {
    let x = copy(st);
    let n = 0;
    while (x.buildings.some(b => b.id === id) && n < 100) {
      const b = bIn(x, id);
      shot(x, 1, 'shell', b.x - 3, b.y, b.x + 0.5, b.y + 0.5, { target: id, splash: 0, damage: 100, hitAt: x.tick + 1 });
      x = tick(x, 1);
      n++;
    }
    return n;
  };
  const plain = arena('fort-concrete-plain');
  const pg = addBuilding(plain.s, 0, 'power', plain.cx + 3, plain.cy + 3, -100);
  const raisedG = addBuilding(t, 0, 'power', cx + 5, cy - 3, -100);
  const a = shellsToKill(plain.s, pg.id);
  const b = shellsToKill(t, raisedG.id);
  ok(b > a && b <= Math.ceil(a * CONCRETE_HP) + 1, `a Generator takes more tank shells to destroy (${a} without, ${b} with)`);
  // Repair stops at the raised full health; selling pays for health as a share of it; power is not raised.
  const rep = copy(t);
  const rb = bIn(rep, gen.id);
  let r = processAction(rep, { type: 'repair', id: rb.id });
  r = tickUntil(r, x => !bIn(x, gen.id).repairing, 2000);
  ok(bIn(r, gen.id).hp === raised, `repair mends it to the raised full health (${bIn(r, gen.id).hp})`);
  const full = bIn(r, gen.id);
  const sold = processAction(r, { type: 'sell', id: full.id });
  ok(sold.players[0].credits - r.players[0].credits === Math.floor((spec.cost * SELL_RETURN) / 10) * 10, 'a full-health structure sells for the usual share of its price');
  const made = r.buildings.filter(b2 => b2.owner === 0 && BUILDINGS[b2.kind].power > 0).reduce((n, b2) => n + BUILDINGS[b2.kind].power, 0);
  ok(powerOf(r, 0).made === made, `Generators at raised full health make their usual power, no more (${powerOf(r, 0).made} of ${made})`);
}

// ---- 4. Mk II: Hardened shelters --------------------------------------------------------------

function shelters(ok: Ok): void {
  const loss = (ups: UpgradeId[], weapon: WeaponKind, o: Partial<Projectile>, what: 'building' | 'unit' = 'building') => {
    const { s, cx, cy } = arena(`fort-shelters-${weapon}`);
    give(s, 0, ups);
    const b = addBuilding(s, 0, 'barracks', cx, cy, -100);
    const u = addUnit(s, 0, 'tank', cx + 3.5, cy + 1);
    const before = what === 'building' ? b.hp : u.hp;
    const tx = what === 'building' ? cx + 1 : cx + 3.5;
    const ty = what === 'building' ? cy + 1 : cy + 1;
    shot(s, 1, weapon, cx - 6, cy, tx, ty, { hitAt: s.tick + 1, ...o });
    const t = tick(s, 1);
    return before - (what === 'building' ? bIn(t, b.id).hp : uIn(t, u.id)!.hp);
  };
  for (const [weapon, label] of [
    ['artillery', 'an artillery shell (or a grenade, or a barrage shell)'],
    ['bomb', 'a bomb'],
    ['missile', 'a missile'],
  ] as [WeaponKind, string][]) {
    const a = loss([], weapon, {});
    const b = loss(['concrete', 'shelters'], weapon, {});
    ok(a > 0 && Math.abs(b / a - SHELTERS_TAKEN) < 0.01, `${label}'s blast on a structure: ${a} without shelters, ${b} with (${(b / a).toFixed(3)})`);
  }
  // Not splash, or not a sheltered kind: unchanged.
  const direct = (ups: UpgradeId[]) => {
    const { s, cx, cy } = arena('fort-shelters-direct');
    give(s, 0, ups);
    const b = addBuilding(s, 0, 'barracks', cx, cy, -100);
    shot(s, 1, 'artillery', cx - 6, cy, cx + 1, cy + 1, { hitAt: s.tick + 1, splash: 0, target: b.id });
    return b.hp - bIn(tick(s, 1), b.id).hp;
  };
  ok(direct([]) === direct(['concrete', 'shelters']) && direct([]) > 0, 'a direct hit (no splash) is not reduced');
  ok(loss([], 'flame', {}) === loss(['concrete', 'shelters'], 'flame', {}), 'a burning splash (flame) is not reduced');
  ok(loss([], 'shell', { splash: 0.8 }) === loss(['concrete', 'shelters'], 'shell', { splash: 0.8 }), 'a shell\'s splash (a Fortress, a Sapper) is not reduced');
  ok(loss([], 'artillery', {}, 'unit') === loss(['concrete', 'shelters'], 'artillery', {}, 'unit'), 'units in the blast take the same as ever');
  const { s, cx, cy } = arena('fort-shelters-mul');
  const b = addBuilding(s, 0, 'barracks', cx, cy, -100);
  ok(shelterMul(s, b, 'artillery') === 1, 'no shelters: the multiplier is exactly 1');
}

// ---- 5. Doctrine, legality, and Point Defence's build ------------------------------------------

function doctrine(ok: Ok): void {
  const { s, cx, cy } = arena('fort-doctrine');
  ok(linesFor(s).length === 6 && linesFor(s)[5] === 'fortification', 'the toggle on: six lines, Fortification last');
  ok(researchProblem(s, 0, 'shelters') === 'Needs Mk I' && processAction(s, { type: 'research', upgrade: 'shelters' }) === s, 'Mk II before Mk I: refused');
  give(s, 0, ['concrete']);
  ok(processAction(s, { type: 'doctrine', line: 'fortification', branch: 'pointdef' }) === s && doctrineProblem(s, 0, 'fortification', 'pointdef') === 'Needs Mk II', 'a doctrine before Mk II: refused');
  give(s, 0, ['shelters']);
  ok(researchProblem(s, 0, 'counterbattery') === 'Choose a doctrine first' && processAction(s, { type: 'research', upgrade: 'counterbattery' }) === s, 'Mk III before a doctrine: refused');
  ok(processAction(s, { type: 'doctrine', line: 'fortification', branch: 'heat' }) === s, 'a branch of another line: refused');
  const d = processAction(s, { type: 'doctrine', line: 'fortification', branch: 'counterbattery' });
  ok(d !== s && d.players[0].doctrines?.fortification === 'counterbattery' && d.players[0].credits === s.players[0].credits, 'the doctrine adopted, free');
  ok(processAction(d, { type: 'doctrine', line: 'fortification', branch: 'pointdef' }) === d && doctrineProblem(d, 0, 'fortification', 'pointdef') === 'Already chosen', 'the other doctrine refused: the choice is permanent');
  ok(processAction(d, { type: 'doctrine', line: 'fortification', branch: 'counterbattery' }) === d, 'the same doctrine again: refused');
  ok(researchProblem(d, 0, 'pointdef') === 'Doctrine closed' && processAction(d, { type: 'research', upgrade: 'pointdef' }) === d, 'the closed branch cannot be researched');
  ok(researchProblem(d, 0, 'counterbattery') === null, 'the adopted branch can');
  const kept = migrateState(copy(d))!;
  ok(kept.players[0].doctrines?.fortification === 'counterbattery' && doctrineProblem(kept, 0, 'fortification', 'pointdef') === 'Already chosen', 'saved and loaded: still committed');
  // Point Defence: a structure only with the Point Defence doctrine researched.
  const p = processAction(s, { type: 'doctrine', line: 'fortification', branch: 'pointdef' });
  ok(techAllowed(p, 0, 'pointdefence') && !canQueue(p, 0, 'building', 'pointdefence') && processAction(p, { type: 'queue', category: 'building', kind: 'pointdefence' }) === p, 'Point Defence offered but refused before its research');
  // Round 7 merged: the strategic four follow it, so it closes the items from before round 7.
  // Advanced production's three (2026-11-22) come after the strategic four.
  ok(BUILD_MENU.indexOf('pointdefence') === BUILD_MENU.indexOf('watchtower') + 1 && BUILD_MENU.slice(BUILD_MENU.indexOf('pointdefence') + 1).every(k => ['bunker', 'supplycache', 'decoy', 'intelcentre', 'farm', 'munitions', 'trainingcentre'].includes(k)), 'Point Defence follows every structure from before round 7, so none of their keys moves');
  give(p, 0, ['pointdef']);
  const q = processAction(p, { type: 'queue', category: 'building', kind: 'pointdefence' });
  ok(q !== p && q.players[0].credits === p.players[0].credits - BUILDINGS.pointdefence.cost, 'researched: Point Defence queued and paid for');
  const ready = tickUntil(q, x => x.players[0].queues.building[0]?.progress >= BUILDINGS.pointdefence.buildTicks, 400);
  const lab = ready.buildings.find(b => b.owner === 0 && b.kind === 'researchlab')!;
  let spot: { x: number; y: number } | null = null;
  for (let dy = -3; dy <= 4 && !spot; dy++) for (let dx = -3; dx <= 4 && !spot; dx++) if (canPlace(ready, 0, 'pointdefence', lab.x + dx, lab.y + dy)) spot = { x: lab.x + dx, y: lab.y + dy };
  const placed = spot ? processAction(ready, { type: 'place', kind: 'pointdefence', x: spot.x, y: spot.y }) : ready;
  ok(!!spot && placed !== ready && placed.buildings.some(b => b.kind === 'pointdefence' && b.owner === 0 && b.x === spot!.x && b.y === spot!.y), 'and placed beside the Lab');
  void cx;
  void cy;
  const noLab = copy(p);
  noLab.buildings = noLab.buildings.filter(b => b.kind !== 'researchlab');
  ok(!canQueue(noLab, 0, 'building', 'pointdefence'), 'Point Defence needs a Research Lab standing');
  ok(BUILDINGS.pointdefence.power <= -50 && BUILDINGS.pointdefence.w === 1 && BUILDINGS.pointdefence.h === 1 && !BUILDINGS.pointdefence.weapon, 'Point Defence: 1x1, a heavy power draw, no weapon (it never fires at units)');
}

// ---- 6. Point Defence ----------------------------------------------------------------------

/** The arena with a Point Defence of side 0's at (cx, cy), warmed up and charged. */
function pdArena(seed: string) {
  const a = arena(seed);
  give(a.s, 0, ['concrete', 'shelters', 'pointdef']);
  const pd = addBuilding(a.s, 0, 'pointdefence', a.cx, a.cy, -100);
  return { ...a, pd };
}

function pointDefence(ok: Ok): void {
  // The rate: many single shots, each the only one in the air, the emplacement charged for each.
  {
    let { s, cx, cy, pd } = pdArena('fort-pd-rate');
    let tries = 0;
    let downs = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      bIn(s, pd.id).cooldown = 0;
      const p = shot(s, 1, 'artillery', cx - 8, cy, cx + 2, cy + 1);
      const fx = s.tick;
      s = processAction(s, { type: 'tick' });
      const e = s.effects.filter(x0 => x0.at > fx).filter(x => x.kind === 'intercept');
      tries += e.length;
      const gone = !s.projectiles.some(x => x.id === p.id);
      if (e.length && e[0].size) downs++;
      if (e.length === 1 && e[0].size !== (gone ? 1 : 0)) ok(false, 'an intercept removes the projectile exactly when it brings it down');
      s.projectiles = [];
    }
    const rate = downs / tries;
    ok(tries === N, `one attempt for every shot (${tries} of ${N})`);
    ok(Math.abs(rate - POINT_DEFENCE_CHANCE) < 0.03, `intercept rate over ${N} shots: ${(100 * rate).toFixed(1)}% (${Math.round(POINT_DEFENCE_CHANCE * 100)}% intended)`);
  }
  // The cooldown: one attempt, then none for POINT_DEFENCE_COOLDOWN ticks; twice as long short of power.
  for (const low of [false, true]) {
    let { s, cx, cy, pd } = pdArena(`fort-pd-cool-${low}`);
    if (low) s.buildings = s.buildings.filter(b => b.kind !== 'power');
    ok(powerOf(s, 0).low === low, `power ${low ? 'short' : 'enough'}`);
    const at: number[] = [];
    for (let i = 0; i < 4 * POINT_DEFENCE_COOLDOWN; i++) {
      if (!s.projectiles.length) shot(s, 1, 'missile', cx - 8, cy, cx + 1, cy, { hitAt: s.tick + 200 });
      const fx = s.tick;
      s = processAction(s, { type: 'tick' });
      if (s.effects.filter(x0 => x0.at > fx).some(e => e.kind === 'intercept')) at.push(s.tick);
    }
    const gap = at.length > 1 ? at[1] - at[0] : 0;
    ok(gap === (low ? 2 * POINT_DEFENCE_COOLDOWN : POINT_DEFENCE_COOLDOWN) || (low && Math.abs(gap - 2 * POINT_DEFENCE_COOLDOWN) <= 1), `${low ? 'short of power' : 'powered'}: attempts ${gap} ticks apart`);
    void pd;
  }
  // What it shoots at, and what not; never at units.
  {
    const { s, cx, cy, pd } = pdArena('fort-pd-kinds');
    const units = new Map<number, Unit>();
    const mk = (kind: UnitKind) => {
      const u = addUnit(s, 1, kind, cx - 7, cy - 2);
      units.set(u.id, u);
      return u.id;
    };
    const p = (weapon: WeaponKind, shooter: number, o: Partial<Projectile> = {}) => ({ id: 1, owner: 1 as Owner, weapon, fromX: 0, fromY: 0, toX: 3, toY: 3, firedAt: 0, hitAt: 9, target: 0, damage: 1, splash: 1, shooter, ...o });
    ok(interceptable(units, p('artillery', mk('artillery'))), 'an Artillery shell: shot at');
    ok(interceptable(units, p('artillery', 0)), 'a barrage shell: shot at');
    ok(interceptable(units, p('artillery', mk('battleship'))), "a Battleship's shell: shot at");
    ok(!interceptable(units, p('artillery', mk('grenadier'))), "a Grenadier's grenade: not");
    ok(interceptable(units, p('rocket', mk('missilecarrier'))), "a Missile Carrier's missile: shot at");
    ok(!interceptable(units, p('rocket', mk('rocketeer'))) && !interceptable(units, p('rocket', 0)), 'any other rocket: not');
    ok(interceptable(units, p('bomb', mk('bomber'))) && interceptable(units, p('missile', 0)), 'a bomb and the missile strike: shot at');
    ok(interceptable(units, p('flame', mk('firebrand'))) && !interceptable(units, p('flame', 1, { fromX: 3, fromY: 3 })), "a Firebrand's incendiary as it falls: shot at; the fire it left: not");
    for (const w of ['bullet', 'shell', 'flak', 'aamissile', 'rail', 'torpedo'] as WeaponKind[]) ok(!interceptable(units, p(w, 0)), `${w}: not shot at`);
    // A tank driving past and a rifleman beside it: nothing happens to them.
    let t = copy(s);
    const tank = addUnit(t, 1, 'tank', cx + 1.5, cy + 0.5);
    tank.stance = 'hold';
    const rif = addUnit(t, 1, 'rifleman', cx - 1, cy + 0.5);
    rif.stance = 'hold';
    t = tick(t, 120);
    ok(uIn(t, tank.id)!.hp === tank.hp && uIn(t, rif.id)!.hp === rif.hp && !t.effects.some(e => e.kind === 'intercept') && bIn(t, pd.id).cooldown === 0, 'enemy units beside it: never fired at');
    // Out of its radius: not covered.
    let far = copy(s);
    shot(far, 1, 'artillery', cx - 9, cy, cx + 5.5, cy, { hitAt: far.tick + 15 });
    far = tick(far, 2);
    ok(!far.effects.some(e => e.kind === 'intercept'), 'a shell landing beyond four tiles: not covered');
    // Its own side's, and an ally's: never.
    let own = copy(s);
    shot(own, 0, 'artillery', cx - 8, cy, cx + 1, cy, { hitAt: own.tick + 15 });
    own = tick(own, 2);
    ok(!own.effects.some(e => e.kind === 'intercept'), 'its own side\'s shell: never');
  }
  // Volume beats it: an eight-shell barrage on a structure under one emplacement.
  {
    let { s, cx, cy } = pdArena('fort-pd-volume');
    const b = addBuilding(s, 0, 'barracks', cx + 2, cy, -100);
    for (let i = 0; i < 8; i++) shot(s, 1, 'artillery', cx - 9, cy, cx + 3, cy + 1, { hitAt: s.tick + 9 + 5 * i, damage: 40 });
    const fx = s.tick;
    s = tick(s, 60);
    const tried = s.effects.filter(x0 => x0.at > fx).filter(e => e.kind === 'intercept').length;
    const down = s.effects.filter(x0 => x0.at > fx).filter(e => e.kind === 'intercept' && e.size).length;
    ok(tried <= 2 && 8 - down >= 6 && bIn(s, b.id).hp < b.hp, `an eight-shell barrage: ${tried} attempts, ${down} down, ${8 - down} land`);
  }
  // A Firebrand's incendiary brought down takes its fire with it.
  {
    let found = false;
    for (let k = 0; k < 20 && !found; k++) {
      let { s, cx, cy } = pdArena(`fort-pd-fire-${k}`);
      const fb = addUnit(s, 1, 'firebrand', cx - 3, cy);
      const drop = shot(s, 1, 'flame', cx - 3, cy, cx + 1, cy, { shooter: fb.id, hitAt: s.tick + 6 });
      for (let i = 1; i <= 3; i++) shot(s, 1, 'flame', cx + 1, cy, cx + 1, cy, { shooter: fb.id, firedAt: drop.hitAt, hitAt: drop.hitAt + 10 * i });
      const fx = s.tick;
      s = processAction(s, { type: 'tick' });
      const e = s.effects.filter(x0 => x0.at > fx).find(x => x.kind === 'intercept');
      if (e?.size) {
        found = true;
        ok(!s.projectiles.some(p => p.weapon === 'flame'), 'an incendiary brought down: its burning patch never comes');
      }
    }
    ok(found, 'an incendiary was brought down within twenty tries');
  }
  // The missile strike, in flight for four seconds: up to two attempts from one emplacement.
  {
    let { s, cx, cy, pd } = pdArena('fort-pd-missile');
    const b = addBuilding(s, 0, 'barracks', cx + 2, cy, -100);
    shot(s, 1, 'missile', cx - 20, cy, cx + 2, cy, { hitAt: s.tick + 40, damage: 600, splash: 3 });
    const e: GameState['effects'] = [];
    for (let i = 0; i < 45; i++) {
      s = processAction(s, { type: 'tick' });
      e.push(...s.effects.filter(x => x.at === s.tick && x.kind === 'intercept'));
    }
    ok(e.length >= 1 && e.length <= 2, `the missile strike: ${e.length} attempts in its flight`);
    const downed = e.some(x => x.size);
    ok(downed ? bIn(s, b.id).hp === b.hp : bIn(s, b.id).hp < b.hp, downed ? 'brought down: the structure untouched' : 'missed: it lands');
    ok(e.every(x => x.x2 === pd.x + 0.5 && x.y2 === pd.y + 0.5), 'the effect is drawn from the emplacement');
  }
}

// ---- 7. Counter-battery ----------------------------------------------------------------------

function counterBattery(ok: Ok): void {
  const setup = (seed: string, ups: UpgradeId[]) => {
    const { s, cx, cy } = arena(seed);
    give(s, 0, ups);
    const gen = addBuilding(s, 0, 'power', cx, cy, -100);
    const art = addUnit(s, 1, 'artillery', cx - 7.5, cy + 0.5);
    art.order = { type: 'attack', target: gen.id };
    return { s, cx, cy, gen, art };
  };
  const tileOf = (s: GameState, x: number, y: number) => Math.floor(y) * s.mapW + Math.floor(x);
  {
    let { s, art } = setup('fort-cb', ['concrete', 'shelters', 'counterbattery']);
    const k = tileOf(s, art.x, art.y);
    ok(visibility(s, 0)[k] === 0, 'the enemy Artillery stands out of sight');
    s = tickUntil(s, x => x.projectiles.some(p => p.shooter === art.id), 200);
    const fired = s.projectiles.find(p => p.shooter === art.id)!;
    ok(!!fired && fired.firedAt === s.tick, 'it fires at the Generator');
    const r = s.reveals?.find(x => x[5] === art.id);
    ok(!!r && r[4] === 0 && r[3] === s.tick + COUNTER_BATTERY_TICKS, `the same tick its position is revealed to side 0, for ${COUNTER_BATTERY_TICKS} ticks`);
    ok(visibility(s, 0)[k] === 1, 'its tile is in sight now');
    ok(s.log.filter(l => l.text.startsWith('Counter-battery')).length === 1, 'one log line');
    // Silence it: hold fire, and the reveal runs out exactly on time.
    const firedAt = s.tick;
    const u = uIn(s, art.id)!;
    u.order = { type: 'idle' };
    u.engage = 0;
    u.stance = 'hold';
    s = tick(s, COUNTER_BATTERY_TICKS - 1);
    ok(s.reveals!.some(x => x[5] === art.id), `still revealed at ${s.tick - firedAt} ticks`);
    s = tick(s, 1);
    ok(!s.reveals!.some(x => x[5] === art.id) && visibility(s, 0)[k] === 0, `gone at ${s.tick - firedAt} ticks, out of sight again`);
  }
  {
    // Every shot renews the one reveal; the log line is rate-limited.
    let { s, art } = setup('fort-cb-renew', ['concrete', 'shelters', 'counterbattery']);
    s = tick(s, 400);
    const mine = s.reveals!.filter(x => x[5] === art.id);
    ok(mine.length === 1, 'one reveal per battery, however often it fires');
    ok(s.log.filter(l => l.text.startsWith('Counter-battery')).length <= 3, `the log line rate-limited (${s.log.filter(l => l.text.startsWith('Counter-battery')).length} in 40 seconds)`);
  }
  {
    // Without Counter-battery: nothing revealed.
    let { s, art } = setup('fort-cb-none', ['concrete', 'shelters', 'pointdef']);
    s = tick(s, 200);
    ok(s.projectiles.some(p => p.shooter === art.id) || s.effects.some(e => e.kind === 'muzzle'), 'it fires');
    ok(!(s.reveals ?? []).length, 'Point Defence instead: no reveal');
  }
  {
    // A barrage at ground side 0 can see is traced to where it was called from; at ground it cannot see, not.
    const { s, cx, cy } = arena('fort-cb-barrage');
    give(s, 0, ['concrete', 'shelters', 'counterbattery']);
    addBuilding(s, 0, 'power', cx, cy, -100);
    const seen = copy(s);
    shot(seen, 1, 'artillery', 5, 50, cx + 1, cy + 1, { firedAt: seen.tick + 1, hitAt: seen.tick + 20 });
    const a = tick(seen, 1);
    ok(a.reveals?.length === 1 && a.reveals[0][0] === 5 && a.reveals[0][1] === 50 && a.reveals[0][5] === 0, 'a barrage on what side 0 sees: traced to its launch point');
    const unseen = copy(s);
    shot(unseen, 1, 'artillery', 5, 50, s.mapW - 3, 3, { firedAt: unseen.tick + 1, hitAt: unseen.tick + 20 });
    ok(!(tick(unseen, 1).reveals ?? []).length, 'a barrage on ground side 0 cannot see: not traced');
    const tank = copy(s);
    shot(tank, 1, 'shell', 5, 50, cx + 1, cy + 1, { firedAt: tank.tick + 1, hitAt: tank.tick + 20, splash: 0 });
    ok(!(tick(tank, 1).reveals ?? []).length, 'a tank shell: not traced');
  }
  {
    // Return fire: side 0's Artillery on Guard turns on the revealed battery ahead of a nearer rifleman.
    const run = (ups: UpgradeId[]) => {
      let { s, cx, cy, art } = setup(`fort-cb-return-${ups.length}`, ups);
      const mine = addUnit(s, 0, 'artillery', cx + 0.5, cy + 3.5);
      const decoy = addUnit(s, 1, 'rifleman', cx + 0.5, cy + 7.5);
      decoy.stance = 'hold';
      s = tickUntil(s, x => (x.reveals ?? []).length > 0 && x.tick % 4 === 1, 300);
      s = tick(s, 8);
      return { target: uIn(s, mine.id)!.engage, art: art.id, decoy: decoy.id };
    };
    const withCb = run(['concrete', 'shelters', 'counterbattery']);
    ok(withCb.target === withCb.art, 'with Counter-battery: its Artillery on Guard turns on the revealed battery');
    const without = run(['concrete', 'shelters']);
    ok(without.target !== without.art, 'without: it keeps to the nearer target');
  }
}

// ---- 8. Replay, saves and the computer --------------------------------------------------------

function replayAndAi(ok: Ok): void {
  // An arena with everything at once (emplacements, a battery, a barrage), played twice, and through a save.
  const scene = () => {
    let { s, cx, cy } = pdArena('fort-replay');
    give(s, 0, []);
    s.players[0].doctrines = { fortification: 'pointdef' };
    addBuilding(s, 0, 'pointdefence', cx + 3, cy + 2, -100);
    const gen = addBuilding(s, 0, 'power', cx + 1, cy + 1, -100);
    for (let i = 0; i < 3; i++) {
      const a = addUnit(s, 1, 'artillery', cx - 7.5, cy - 2 + 2 * i);
      a.order = { type: 'attack', target: gen.id };
    }
    for (let i = 0; i < 8; i++) shot(s, 1, 'artillery', 3, 3, cx + 1 + (i % 3), cy + 1, { hitAt: s.tick + 30 + 5 * i });
    s = tick(s, 300);
    return s;
  };
  const a = scene();
  const b = scene();
  ok(JSON.stringify(a) === JSON.stringify(b), 'a battle with intercepts replays byte-identically');
  ok(a.effects.some(e => e.kind === 'intercept') || a.buildings.some(x => x.kind === 'pointdefence' && x.cooldown > 0), 'and intercepts happened in it');
  const cont = tick(a, 600);
  const loaded = tick(migrateState(copy(a))!, 600);
  ok(JSON.stringify(cont) === JSON.stringify(loaded), 'saved and loaded mid-battle, it plays on byte-identically');

  // The computer: Easy never; Normal and Hard only on Long and Epic, only under fire.
  const { s } = arena('fort-ai', { pace: 'long' });
  ok(commanderFortifies(s, 'normal') && commanderFortifies(s, 'hard') && !commanderFortifies(s, 'easy'), 'Long: Normal and Hard play the line, Easy never');
  const quick = arena('fort-ai-quick').s;
  ok(!commanderFortifies(quick, 'hard'), 'Quick: nobody does');
  addBuilding(s, 1, 'researchlab', 2, s.mapH - 6, -100);
  addBuilding(s, 1, 'techcentre', 6, s.mapH - 6, -100);
  ok(fortificationNext(s, 1, 'hard') === null, 'no fire on its structures yet: nothing from the line');
  s.ai[1].shellAir = FORT_PRESSURE_MIN;
  ok(fortificationNext(s, 1, 'easy') === null, 'Easy, under fire: still nothing');
  ok(fortificationNext(s, 1, 'normal') === 'concrete', 'under fire: Reinforced concrete first');
  give(s, 1, ['concrete']);
  ok(fortificationNext(s, 1, 'hard') === 'shelters', 'then Hardened shelters');
  give(s, 1, ['shelters']);
  const t = copy(s);
  t.ai[1].shellAir = 2;
  t.ai[1].shellGround = 30;
  ok(fortificationBranch(t, 1) === 'pointdef', 'shelled from the ground but no guns of its own: Point Defence');
  addUnit(t, 1, 'artillery', 10, 10);
  addUnit(t, 1, 'artillery', 11, 10);
  ok(fortificationBranch(t, 1) === 'counterbattery', 'shelled from the ground, with two Artillery: Counter-battery');
  ok(fortificationBranch(s, 1) === 'pointdef', 'bombed and struck from above: Point Defence');
  ok(fortificationNext(s, 1, 'hard') === 'pointdef' && s.players[1].doctrines?.fortification === 'pointdef', 'the doctrine adopted as it goes');
  give(s, 1, ['pointdef']);
  s.ai[1].shellTick = s.tick;
  s.ai[1].shellX = 20;
  s.ai[1].shellY = 20;
  ok(wantsPointDefence(s, 1, 'hard', 50000) && !wantsPointDefence(s, 1, 'easy', 50000), 'shelled, with the doctrine: wants an emplacement');
  ok(!wantsPointDefence(s, 1, 'hard', 1000), 'but not once the map\'s ore is running out');
  const f = pointDefenceFocus(s, 1);
  ok(!!f && f.x === 20 && f.y === 20, 'placed beside the structure last hit');
  for (let i = 0; i < 3; i++) addBuilding(s, 1, 'pointdefence', 30 + 3 * i, 30, -100);
  ok(!wantsPointDefence(s, 1, 'hard', 50000), 'Hard keeps three emplacements at most');
  const old = copy(s);
  old.tick += 2000;
  ok(!wantsPointDefence(old, 1, 'normal', 50000), 'no longer being shelled: no more');

  // Whole battles: Hard against Normal on Long with the line, the computer on both sides.
  let researched = 0;
  // 2026-11-27: since the patience cap the Long commander attacks sooner, and Hard wins the first two
  // seeds at 14 and 19 minutes before Normal ever shells it; fort-battle-3 runs to the line (17.8 min).
  for (const seed of ['fort-battle-1', 'fort-battle-2', 'fort-battle-3']) {
    let b2 = createInitialState(seed, seed, { seed, difficulty: 'hard', createdAt: 0, autopilot: true, setup: { ...applyPace({ ...DEFAULT_SETUP }, 'long') } });
    b2.autopilotDifficulty = 'normal';
    for (let i = 0; i < 48 && !b2.players.some(p => p.upgrades?.includes('concrete')) && b2.winner === null; i++) b2 = tick(b2, 500);
    ok(b2.buildings.every(x => Number.isFinite(x.hp) && x.hp <= structureMaxHp(b2, x)), `${seed}: every structure's health within its full health`);
    if (b2.players.some(p => p.upgrades?.includes('concrete'))) researched++;
    if (researched) break; // One battle that shows it is enough; the others are the fallbacks.
  }
  ok(researched >= 1, `a Long battle: the computer turns to the line under fire (within 40 minutes)`);
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Fortification: the setup, missions, planet battles and old saves', quiet(setups)],
  ['Fortification: off means off', quiet(offIsOff)],
  ['Fortification: Mk I, Reinforced concrete', quiet(concrete)],
  ['Fortification: Mk II, Hardened shelters', quiet(shelters)],
  ['Fortification: doctrine and Point Defence\'s build', quiet(doctrine)],
  ['Fortification: Point Defence', quiet(pointDefence)],
  ['Fortification: counter-battery', quiet(counterBattery)],
  ['Fortification: replay, saves and the computer', replayAndAi],
];

// Run on its own: npx tsx scripts/drive-fortification.ts [--verbose] [part of a section's name]
if (process.argv[1] && process.argv[1].endsWith('drive-fortification.ts')) {
  const verbose = process.argv.includes('--verbose');
  const only = process.argv.slice(2).find(a => !a.startsWith('--'));
  let n = 0;
  let failed = 0;
  const ok: Ok = (cond, what) => {
    n++;
    if (verbose && cond) console.log(`  ok ${what}`);
    if (!cond) {
      failed++;
      console.log(`  FAIL ${what}`);
    }
  };
  for (const [name, fn] of sections) {
    if (only && !name.includes(only)) continue;
    const t0 = Date.now();
    console.log(name);
    fn(ok);
    console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  console.log(`${n} assertions, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
