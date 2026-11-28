/**
 * The newer support powers: the cruise missile, the Iron Dome and the paratroopers (POWERS in
 * rules.ts, called by doPower in mission.ts, the dome's interceptions in support.ts). The harness
 * sections, imported by drive.ts so their assertions count in the main totals.
 */
import { processAction } from '../src/sim/actions';
import { domeSpot, setAutopilotAi } from '../src/sim/ai';
import { occupancy } from '../src/sim/grid';
import { doPower, powerProblem } from '../src/sim/mission';
import {
  CRUISE_DAMAGE,
  IRON_DOME_CHANCE,
  DAMAGE_VS,
  FLIGHT_TICKS,
  IRON_DOME_SHOTS,
  IRON_DOME_TICKS,
  MISSION_STRUCTURE_POWERS,
  PARADROP,
  PARADROP_CLEARANCE,
  POWERS,
  SKIRMISH_POWERS,
  type Owner,
  type SupportPower,
  type WeaponKind,
} from '../src/sim/rules';
import { addBuilding, addUnit, cloneState, createInitialState, migrateState } from '../src/sim/state';
import type { GameState, Projectile } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

const copy = <T>(s: T): T => JSON.parse(JSON.stringify(s));
function tick(s: GameState, n = 1): GameState {
  for (let left = n; left > 0; left -= 500) s = processAction(s, { type: 'tick', n: Math.min(500, left) });
  return s;
}

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
 * An advanced skirmish on open plains, every unit gone, nobody attacking, 17 by 17 tiles of grass
 * cleared round (cx, cy) and seen by side 0, and both sides holding every new power, charged.
 */
function arena(seed: string) {
  const s = copy(createInitialState(seed, seed, { seed, createdAt: 0, setup: { map: 'plains', tech: 'advanced', credits: 20000 } }));
  s.units = [];
  for (const m of s.ai) m.nextAttack = 1e9;
  const occ = occupancy(s);
  const cx = Math.floor(s.mapW / 2);
  const cy = Math.floor(s.mapH / 2);
  const tiles = s.tiles.split('');
  const seen = s.explored.split('');
  for (let y = cy - 8; y <= cy + 8; y++)
    for (let x = cx - 8; x <= cx + 8; x++) {
      const k = y * s.mapW + x;
      if (occ[k]) throw new Error('a structure in the middle of the support arena');
      tiles[k] = 'g';
      s.ore[k] = 0;
      seen[k] = '1';
    }
  s.tiles = tiles.join('');
  s.explored = seen.join('');
  s.powers = [
    { cruise: 0, irondome: 0, paradrop: 0 },
    { cruise: 0, irondome: 0, paradrop: 0 },
  ];
  return { s, cx, cy };
}

/** A projectile of `owner`'s, fired now from (fx, fy) to (tx, ty), landing 12 ticks later. */
function shot(s: GameState, owner: Owner, weapon: WeaponKind, fx: number, fy: number, tx: number, ty: number, o: Partial<Projectile> = {}): Projectile {
  const p: Projectile = { id: s.nextId++, owner, weapon, fromX: fx, fromY: fy, toX: tx, toY: ty, firedAt: s.tick, hitAt: s.tick + 12, target: 0, damage: 200, splash: 1.2, shooter: 0, ...o };
  s.projectiles.push(p);
  return p;
}

function rules(ok: Ok): void {
  const added: SupportPower[] = ['cruise', 'irondome', 'paradrop'];
  for (const p of added) {
    ok(p in POWERS && POWERS[p].cooldown > 0 && POWERS[p].name.length > 0, `${p}: a named power with a cooldown`);
    ok(p in SKIRMISH_POWERS, `${p}: granted by a structure in an advanced skirmish`);
    ok(!(p in MISSION_STRUCTURE_POWERS), `${p}: not granted by structures in a campaign mission, so missions play as swept`);
  }
  ok(SKIRMISH_POWERS.cruise === 'strikecommand' && SKIRMISH_POWERS.irondome === 'flakcannon' && SKIRMISH_POWERS.paradrop === 'helipad', 'from the Strike Command, the Flak Cannon and the Helipad');
  ok(JSON.stringify(Object.keys(MISSION_STRUCTURE_POWERS).sort()) === '["barrage","missile","recon"]', 'missions keep the original three structure powers');
  ok('cruise' in DAMAGE_VS && 'cruise' in FLIGHT_TICKS && FLIGHT_TICKS.cruise < FLIGHT_TICKS.missile, 'the cruise missile has a damage table and a shorter flight than the missile strike');
  ok(POWERS.cruise.cooldown < POWERS.missile.cooldown && POWERS.cruise.radius < POWERS.missile.radius, 'more often than the missile strike, and a tighter blast');
}

function cruise(ok: Ok): void {
  const { s, cx, cy } = arena('support-cruise');
  const target = addBuilding(s, 1, 'factory', cx + 2, cy + 2, -100);
  const hp = target.hp;
  const at = { x: target.x + 1.5, y: target.y + 1.5 };
  const before = cloneState(s);
  ok(powerProblem(s, 0, 'cruise', at.x, at.y) === null, 'side 0 may call the cruise missile');
  let t = processAction(s, { type: 'power', power: 'cruise', x: at.x, y: at.y });
  ok(t !== s, 'the call is taken');
  ok(JSON.stringify(s) === JSON.stringify(before), 'and the state it was called on is untouched');
  const m = t.projectiles.find(p => p.weapon === 'cruise');
  ok(m && m.owner === 0 && t.projectiles.filter(p => p.weapon === 'cruise').length === 1, 'one cruise missile in the air');
  ok(m && m.hitAt - m.firedAt === FLIGHT_TICKS.cruise && m.damage === CRUISE_DAMAGE && m.splash === POWERS.cruise.radius, 'with its flight, damage and blast');
  ok(t.powers![0].cruise === POWERS.cruise.cooldown, 'and it is recharging');
  ok(processAction(t, { type: 'power', power: 'cruise', x: at.x, y: at.y }) === t, 'a second call while charging is refused with the same state');
  ok(!t.effects.some(e => e.kind === 'missile'), 'no warning marker, unlike the missile strike');
  t = tick(t, FLIGHT_TICKS.cruise + 1);
  const hit = t.buildings.find(b => b.id === target.id);
  const lost = hp - (hit?.hp ?? 0);
  ok(lost >= CRUISE_DAMAGE * 0.9 && lost <= CRUISE_DAMAGE * 1.2, `it lands, taking about ${CRUISE_DAMAGE} from a structure at its centre (${lost})`);
  ok(!t.projectiles.some(p => p.weapon === 'cruise'), 'and is gone');
  // The computer's: announced to the player.
  const c = copy(s);
  doPower(c, 1, 'cruise', cx - 3.5, cy - 3.5);
  ok(c.log.some(l => l.tone === 'bad' && /cruise/i.test(l.text)), "an enemy cruise missile is announced");
  // Replays: the same call on the same state gives the same battle.
  const a = tick(processAction(s, { type: 'power', power: 'cruise', x: at.x, y: at.y }), 60);
  const b = tick(processAction(copy(s), { type: 'power', power: 'cruise', x: at.x, y: at.y }), 60);
  ok(JSON.stringify(a) === JSON.stringify(b), 'a cruise strike replays exactly');
}

function ironDome(ok: Ok): void {
  const { s, cx, cy } = arena('support-dome');
  const keep = addBuilding(s, 0, 'factory', cx - 1, cy - 1, -100);
  const hp = keep.hp;
  const c = { x: cx + 0.5, y: cy + 0.5 };
  // Without a dome the shells land.
  {
    const n = copy(s);
    shot(n, 1, 'artillery', 2, 2, c.x, c.y);
    const t = tick(n, 14);
    ok(t.buildings.find(b => b.id === keep.id)!.hp < hp, 'without a dome, a shell lands');
    ok(t.domes === undefined, 'and no dome is in the state');
  }
  let t = processAction(s, { type: 'power', power: 'irondome', x: c.x, y: c.y });
  ok(t.domes?.length === 1 && t.domes[0][4] === 0 && t.domes[0][5] === IRON_DOME_SHOTS, 'the dome is up, with its shots');
  ok(t.powers![0].irondome === POWERS.irondome.cooldown, 'and recharging');
  t = copy(t);
  shot(t, 1, 'artillery', 2, 2, c.x, c.y);
  shot(t, 1, 'missile', 2, 2, c.x + 1, c.y, { hitAt: t.tick + 20, damage: 800, splash: 4 });
  shot(t, 1, 'cruise', 2, 2, c.x, c.y + 1, { hitAt: t.tick + 16, damage: 650, splash: 1.5 });
  shot(t, 1, 'bomb', c.x, c.y, c.x - 1, c.y);
  const direct = shot(t, 1, 'shell', 2, 2, c.x, c.y, { target: keep.id, splash: 0, hitAt: t.tick + 2, damage: 40 });
  const far = shot(t, 1, 'artillery', 2, 2, c.x + POWERS.irondome.radius + 3, c.y);
  const own = shot(t, 0, 'artillery', 2, 2, c.x, c.y - 1);
  let shots = 0;
  let downs = 0;
  let sawDirect = false;
  let sawFar = false;
  let sawOwn = false;
  const tried = new Set<string>();
  let again = false;
  for (let i = 0; i < 24; i++) {
    t = processAction(t, { type: 'tick' });
    for (const e of t.effects) {
      if (e.kind !== 'intercept' || e.at !== t.tick) continue;
      shots++;
      if (e.size) downs++;
      if (tried.has(e.weapon!)) again = true;
      tried.add(e.weapon!);
    }
    if (t.effects.some(e => e.kind === 'boom' && e.at === t.tick && e.weapon === 'shell')) sawDirect = true;
    if (t.effects.some(e => e.kind === 'boom' && e.at === t.tick && e.x === far.toX && e.y === far.toY)) sawFar = true;
    if (t.effects.some(e => e.kind === 'boom' && e.at === t.tick && e.x === own.toX && e.y === own.toY)) sawOwn = true;
  }
  ok(shots === 4 && !again && ['artillery', 'missile', 'cruise', 'bomb'].every(w => tried.has(w)), `it fires once each at the shell, the missile, the cruise missile and the bomb (${shots} shots, ${downs} down)`);
  ok(t.domes?.[0][5] === IRON_DOME_SHOTS - 4, 'four shots spent');
  ok(sawDirect && direct, 'a tank shell is not something the dome fires at');
  ok(sawFar, 'fire landing outside the dome lands');
  ok(sawOwn, "its own side's fire lands");
  // How often a shot brings its target down: three in four, from the battle's seed.
  {
    let hits = 0;
    const trials = 200;
    for (let k = 0; k < trials; k++) {
      const n = copy(processAction(s, { type: 'power', power: 'irondome', x: c.x, y: c.y }));
      n.rngSeed = 7919 * (k + 1);
      const p = shot(n, 1, 'artillery', 2, 2, c.x, c.y);
      const m = tick(n, 14);
      if (m.effects.some(e => e.kind === 'intercept' && e.size === 1)) hits++;
      if (k === 0) ok(m.projectiles.every(q => q.id !== p.id), 'brought down or landed, the shell is gone');
    }
    const share = hits / trials;
    ok(Math.abs(share - IRON_DOME_CHANCE) < 0.1, `about ${IRON_DOME_CHANCE * 100}% are brought down (${(share * 100).toFixed(0)}% of ${trials})`);
    const a = tick(processAction(s, { type: 'power', power: 'irondome', x: c.x, y: c.y }), 1);
    const b = tick(processAction(copy(s), { type: 'power', power: 'irondome', x: c.x, y: c.y }), 1);
    for (const x of [a, b]) for (let q = 0; q < 6; q++) shot(x, 1, 'artillery', 2, 2, c.x + q - 3, c.y, { id: 900000 + q });
    ok(JSON.stringify(tick(a, 20)) === JSON.stringify(tick(b, 20)), 'and the same battle brings down the same ones');
  }
  // Spent: more than its shots, and the rest land.
  {
    const n = copy(processAction(s, { type: 'power', power: 'irondome', x: c.x, y: c.y }));
    for (let i = 0; i < IRON_DOME_SHOTS + 3; i++) shot(n, 1, 'artillery', 2, 2, c.x + (i % 3) - 1, c.y, { hitAt: n.tick + 10 + (i % 4) });
    let m = n;
    let landed = 0;
    let fired = 0;
    let down = 0;
    for (let i = 0; i < 20; i++) {
      m = processAction(m, { type: 'tick' });
      for (const e of m.effects) if (e.kind === 'intercept' && e.at === m.tick) {
        fired++;
        if (e.size) down++;
      }
      landed += m.effects.filter(e => e.kind === 'boom' && e.at === m.tick && e.weapon === 'artillery').length;
    }
    ok(fired === IRON_DOME_SHOTS && down + landed === IRON_DOME_SHOTS + 3, `it fires ${IRON_DOME_SHOTS} shots and no more (${down} down, ${landed} landed)`);
    ok(m.domes === undefined, 'and, spent, it is gone');
  }
  // It lasts its time.
  {
    const n = processAction(s, { type: 'power', power: 'irondome', x: c.x, y: c.y });
    const late = tick(n, IRON_DOME_TICKS + 1);
    ok(late.domes === undefined, 'after its time it is gone');
    const m = copy(late);
    shot(m, 1, 'artillery', 2, 2, c.x, c.y);
    ok(!tick(m, 14).effects.some(e => e.kind === 'intercept'), 'and fire lands again');
  }
  // Saves.
  {
    const n = processAction(s, { type: 'power', power: 'irondome', x: c.x, y: c.y });
    const back = migrateState(copy(n));
    ok(back && JSON.stringify(back.domes) === JSON.stringify(n.domes), 'a save keeps the dome');
    const junk = copy(n) as unknown as Record<string, unknown>;
    junk.domes = [[1, 2, 3], [c.x, c.y, 6, 9999, 7, 12], 'x', [c.x, c.y, 6, 9999, 1, 12]];
    const fixed = migrateState(junk as never);
    ok(fixed && fixed.domes?.length === 1 && fixed.domes[0][4] === 1, 'a malformed dome, or one for a side not in the battle, is dropped');
    junk.domes = 'nonsense';
    ok(migrateState(junk as never)?.domes === undefined, 'nonsense for domes is dropped');
  }
  // The computer raises one over heavy fire coming at its own ground, and not for a stray shell.
  {
    const n = copy(s);
    const theirs = addBuilding(n, 1, 'factory', cx + 3, cy + 3, -100);
    const at = { x: theirs.x + 1.5, y: theirs.y + 1.5 };
    shot(n, 0, 'artillery', 2, 2, at.x, at.y, { hitAt: n.tick + 20 });
    ok(domeSpot(n, 1) === null, 'one shell is not worth a dome');
    shot(n, 0, 'missile', 2, 2, at.x, at.y, { hitAt: n.tick + 30, damage: 800, splash: 4 });
    const spot = domeSpot(n, 1);
    ok(spot && Math.hypot(spot.x - at.x, spot.y - at.y) < 1, 'a missile strike on its factory is');
    ok(domeSpot(n, 0) === null, 'side 0 sees nothing coming at itself');
  }
}

function paradrop(ok: Ok): void {
  const { s, cx, cy } = arena('support-paradrop');
  const c = { x: cx + 0.5, y: cy + 0.5 };
  // Unexplored ground.
  {
    const n = copy(s);
    const k = Math.floor(c.y) * n.mapW + Math.floor(c.x);
    n.explored = n.explored.slice(0, k) + '0' + n.explored.slice(k + 1);
    ok(/scouted/.test(powerProblem(n, 0, 'paradrop', c.x, c.y) ?? ''), 'not onto ground side 0 has not seen');
    ok(processAction(n, { type: 'power', power: 'paradrop', x: c.x, y: c.y }) === n, 'refused with the same state');
    ok(powerProblem(n, 1, 'paradrop', c.x, c.y) === null, 'the computer, which sees the map, may');
  }
  // Water, and an enemy structure close by.
  {
    const n = copy(s);
    const k = Math.floor(c.y) * n.mapW + Math.floor(c.x);
    n.tiles = n.tiles.slice(0, k) + 'w' + n.tiles.slice(k + 1);
    ok(/open ground/.test(powerProblem(n, 0, 'paradrop', c.x, c.y) ?? ''), 'not onto water');
    const m = copy(s);
    addBuilding(m, 1, 'power', cx + 2, cy, -100);
    ok(/enemy structures/.test(powerProblem(m, 0, 'paradrop', c.x, c.y) ?? ''), `not within ${PARADROP_CLEARANCE} tiles of an enemy structure`);
    const wall = copy(s);
    addBuilding(wall, 1, 'wall', cx + 2, cy, -100);
    ok(powerProblem(wall, 0, 'paradrop', c.x, c.y) === null, 'a wall does not count as a structure');
  }
  const before = s.units.length;
  const t = processAction(s, { type: 'power', power: 'paradrop', x: c.x, y: c.y });
  const landed = t.units.slice(before);
  ok(landed.length === PARADROP.length && landed.every(u => u.owner === 0), `${PARADROP.length} paratroopers land for side 0`);
  ok(JSON.stringify(landed.map(u => u.kind)) === JSON.stringify(PARADROP), 'the riflemen and Rocketeers');
  ok(landed.every(u => Math.hypot(u.x - c.x, u.y - c.y) <= 3), 'all of them round the drop point');
  ok(t.effects.some(e => e.kind === 'paradrop' && e.size === PARADROP.length), 'the drop is drawn');
  ok(t.powers![0].paradrop === POWERS.paradrop.cooldown, 'and the power recharges');
  // They fight.
  const n = copy(t);
  const foe = addUnit(n, 1, 'rifleman', c.x + 3, c.y);
  const fought = tick(n, 120);
  ok(!fought.units.some(u => u.id === foe.id && u.hp > 0), 'and take on what they find');
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Support powers: the cruise missile, Iron Dome and paratroopers in the rules', rules],
  ['Support powers: the cruise missile', quiet(cruise)],
  ['Support powers: the Iron Dome', quiet(ironDome)],
  ['Support powers: paratroopers', quiet(paradrop)],
];
