/**
 * The air war (2026-11-10): the Recon Plane, the Interceptor and Countermeasures. Each section
 * proves a rule by what happens in the simulation. Imported by drive.ts, so its assertions count in
 * the main totals. Helpers are drive-air.ts's.
 */
import { processAction } from '../src/sim/actions';
import { isAir, padSpot } from '../src/sim/air';
import { canAttack, canQueue } from '../src/sim/commands';
import { buildingCentre, dist } from '../src/sim/grid';
import { isDetected } from '../src/sim/mission';
import {
  AIR_AMMO,
  AIR_MENU,
  COUNTERMEASURES_DAMAGE,
  DAMAGE_VS,
  DETECTOR_RANGE,
  FUEL_RESERVE,
  FUEL_TICKS,
  HELIPAD_SLOTS,
  UNLOAD_RADIUS,
  airSlotsOf,
  SCRAMBLE_LEASH,
  SCRAMBLE_RANGE,
  STANDARD_TECH,
  STEALTH_DETECT_RANGE,
  UNITS,
  UPGRADE_ORDER,
  UPGRADES,
  hitsAir,
  hitsGround,
  type BuildingKind,
} from '../src/sim/rules';
import { stealthSeen } from '../src/sim/sites';
import { boardProblem, unloadProblem } from '../src/sim/transport';
import { addBuilding, createInitialState, migrateState } from '../src/sim/state';
import type { GameState } from '../src/sim/types';
import { airArena, copy, padWith, put, quietCommander, tick, tickUntil, unitIn } from './drive-air';

type Ok = (cond: unknown, what: string) => void;

function rules(ok: Ok): void {
  for (const k of ['reconplane', 'interceptor'] as const) {
    ok(UNITS[k].category === 'air' && UNITS[k].armor === 'aircraft', `${k}: an aircraft`);
    ok(AIR_MENU.includes(k) && !STANDARD_TECH.includes(k), `${k}: on the Air tab, advanced tech only`);
    ok((AIR_AMMO[k] ?? 0) > FUEL_RESERVE, `${k}: carries loads`);
  }
  ok(!UNITS.reconplane.weapon && UNITS.reconplane.detector === true, 'the Recon Plane is unarmed, and a detector');
  ok(UNITS.reconplane.sight > UNITS.gunship.sight + 2, 'and sees much further than a Gunship');
  ok(DETECTOR_RANGE > STEALTH_DETECT_RANGE * 2, 'its detection reaches far beyond anyone else\'s');
  const w = UNITS.interceptor.weapon!;
  ok(hitsAir(w) && !hitsGround(w), 'the Interceptor fires at aircraft only');
  ok(UNITS.interceptor.speed > UNITS.bomber.speed, 'and outruns a Bomber');
  ok(UPGRADE_ORDER.includes('countermeasures') && UPGRADES.countermeasures.requires.includes('helipad'), 'Countermeasures: on the Research list, needs a Helipad');
  ok(COUNTERMEASURES_DAMAGE > 0 && COUNTERMEASURES_DAMAGE < 1, 'Countermeasures: cuts anti-air damage');

  // Standard tech offers neither; advanced offers both, the Interceptor only with a Research Lab.
  const grant = (s: GameState, kinds: BuildingKind[]) => {
    kinds.forEach((k, i) => addBuilding(s, 0, k, 1 + i * 4, 1, -100));
    s.players[0].credits = 50000;
    return s;
  };
  const std = grant(copy(createInitialState('aw-std', 'aw-std', { seed: 'aw-std', createdAt: 0, setup: { map: 'classic', tech: 'standard' } })), ['power', 'factory', 'uplink', 'helipad', 'researchlab']);
  ok(!canQueue(std, 0, 'air', 'reconplane') && !canQueue(std, 0, 'air', 'interceptor'), 'standard tech: neither is offered');
  const noLab = grant(airArena('aw-nolab').s, ['power', 'power', 'factory', 'uplink', 'helipad']);
  ok(canQueue(noLab, 0, 'air', 'reconplane'), 'advanced tech: a Helipad offers the Recon Plane');
  ok(!canQueue(noLab, 0, 'air', 'interceptor'), 'but not the Interceptor without a Research Lab');
  const lab = grant(airArena('aw-lab').s, ['power', 'power', 'factory', 'uplink', 'helipad', 'researchlab']);
  ok(canQueue(lab, 0, 'air', 'interceptor'), 'with a Research Lab it does');
}

/** Fuel: it burns off the pad, circles where it is sent, turns home at the reserve and refuels. */
function reconFlight(ok: Ok): void {
  const { s, cx, cy } = airArena('aw-recon');
  const { pad, craft } = padWith(s, 0, cx - 8, cy + 4, ['reconplane']);
  const r = craft[0];
  ok(r.ammo === AIR_AMMO.reconplane && r.order.type === 'rearm', 'a new Recon Plane starts fuelled, parked on its pad');
  ok(!canAttack(s, 0, [r.id], pad.id), 'it can never be ordered to attack');
  const parked = tick(s, FUEL_TICKS * 3);
  ok(unitIn(parked, r.id)!.ammo === AIR_AMMO.reconplane, 'parked, it burns no fuel');

  const goal = { x: cx + 6.5, y: cy - 6.5 };
  let t = processAction(s, { type: 'move', ids: [r.id], x: goal.x, y: goal.y });
  t = tickUntil(t, x => unitIn(x, r.id)!.order.type === 'idle', 400);
  ok(unitIn(t, r.id)!.order.type === 'idle', 'sent somewhere, it gets there');
  let far = 0;
  let moved = 0;
  let last = unitIn(t, r.id)!;
  for (let i = 0; i < 200 && unitIn(t, r.id)!.order.type === 'idle'; i++) {
    t = tick(t);
    const u = unitIn(t, r.id)!;
    far = Math.max(far, dist(u.x, u.y, goal.x, goal.y));
    moved += dist(u.x, u.y, last.x, last.y);
    last = u;
  }
  ok(far < 4.5 && moved > 20, `and circles there (furthest ${far.toFixed(1)} tiles out, ${moved.toFixed(0)} tiles flown)`);
  t = tickUntil(t, x => unitIn(x, r.id)!.order.type === 'rearm', AIR_AMMO.reconplane! * FUEL_TICKS + 10);
  const low = unitIn(t, r.id)!;
  ok(low.order.type === 'rearm' && low.ammo === FUEL_RESERVE, `its fuel runs down and it turns for home with ${FUEL_RESERVE} loads left (${low.ammo})`);
  ok(t.tick - s.tick >= (AIR_AMMO.reconplane! - FUEL_RESERVE - 1) * FUEL_TICKS, `after about a minute aloft (${t.tick - s.tick} ticks)`);
  t = tickUntil(t, x => unitIn(x, r.id)!.ammo === AIR_AMMO.reconplane, 2000);
  const back = unitIn(t, r.id)!;
  const spot = padSpot(t, pad, back);
  ok(back.ammo === AIR_AMMO.reconplane && back.x === spot.x && back.y === spot.y, 'lands on its pad and refuels in full');
  const still = tick(t, 300);
  ok(unitIn(still, r.id)!.x === spot.x && unitIn(still, r.id)!.order.type === 'rearm', 'and stays parked');

  // Waypoints make a patrol: it visits each in turn.
  {
    let p = processAction(s, { type: 'move', ids: [r.id], x: cx + 6.5, y: cy + 0.5 });
    p = processAction(p, { type: 'move', ids: [r.id], x: cx - 6.5, y: cy - 6.5, queue: true });
    let near = false;
    for (let i = 0; i < 400 && !near; i++) {
      p = tick(p);
      const u = unitIn(p, r.id)!;
      near = dist(u.x, u.y, cx + 6.5, cy + 0.5) < 0.5;
    }
    p = tickUntil(p, x => unitIn(x, r.id)!.order.type === 'idle', 400);
    const u = unitIn(p, r.id)!;
    ok(near && dist(u.x, u.y, cx - 6.5, cy - 6.5) < 0.5, 'shift-click waypoints: it flies each in turn');
  }
  // Replays exactly.
  const a = tick(processAction(s, { type: 'move', ids: [r.id], x: goal.x, y: goal.y }), 900);
  const b = tick(processAction(s, { type: 'move', ids: [r.id], x: goal.x, y: goal.y }), 900);
  ok(JSON.stringify(a) === JSON.stringify(b), 'a sortie replays byte-identically');
}

/** Detection: a Stealth Tank or a Spy under a Recon Plane is seen, and the guns there use it. */
function reconDetection(ok: Ok): void {
  const { s, cx, cy } = airArena('aw-detect');
  const turret = addBuilding(s, 0, 'turret', cx - 2, cy, -100);
  const st = put(s, 1, 'stealthtank', cx + 2.5, cy + 0.5, { stance: 'hold' });
  ok(!stealthSeen(s, st, 0), 'a Stealth Tank four tiles from a Gun Turret is unseen');
  const quiet = tick(s, 100);
  ok(unitIn(quiet, st.id)!.hp === UNITS.stealthtank.hp, 'and the turret leaves it alone');
  const r = put(s, 0, 'reconplane', cx + 2.5 + DETECTOR_RANGE - 1, cy + 0.5, { order: { type: 'idle' } });
  ok(stealthSeen(s, st, 0), `a Recon Plane ${DETECTOR_RANGE - 1} tiles off uncovers it`);
  const shot = tick(s, 100);
  ok(unitIn(shot, st.id)!.hp < UNITS.stealthtank.hp, 'and the turret opens fire');
  r.x = cx + 2.5 + DETECTOR_RANGE + 1.5;
  ok(!stealthSeen(s, st, 0), 'beyond its detection range it does not');
  void turret;

  // A Spy, the same.
  const spySide = copy(s);
  spySide.units = spySide.units.filter(u => u.kind !== 'stealthtank' && u.kind !== 'reconplane');
  const spy = put(spySide, 1, 'spy', cx + 4.5, cy + 4.5);
  ok(!isDetected(spySide, spy, 0), 'a Spy in the open, far from anything of ours, is hidden');
  put(spySide, 0, 'reconplane', cx + 4.5 + DETECTOR_RANGE - 1, cy + 4.5, { order: { type: 'idle' } });
  ok(isDetected(spySide, spy, 0), 'a Recon Plane overhead spots him');

  // An ally's Recon Plane uncovers it for the whole team (three sides, 0 and 2 against 1).
  const team = airArena('aw-team', { map: 'plains', tech: 'advanced', credits: 20000, sides: 3, mode: 'teams' });
  const st2 = put(team.s, 1, 'stealthtank', team.cx + 0.5, team.cy + 0.5, { stance: 'hold' });
  ok(!stealthSeen(team.s, st2, 0), 'three sides: unseen by side 0 at first');
  put(team.s, 2, 'reconplane', team.cx + 4.5, team.cy + 0.5, { order: { type: 'idle' } });
  ok(stealthSeen(team.s, st2, 0), 'an ally\'s Recon Plane uncovers it for side 0 too');
}

/** The Interceptor: kills aircraft, never touches the ground, scrambles from its pad and comes home. */
function interceptors(ok: Ok): void {
  {
    const { s, cx, cy } = airArena('aw-int-kill');
    const i = put(s, 0, 'interceptor', cx - 2.5, cy + 0.5);
    const tank = put(s, 1, 'tank', cx + 0.5, cy + 0.5, { stance: 'hold' });
    const g = put(s, 1, 'gunship', cx + 1.5, cy + 2.5, { stance: 'hold', ammo: 0, order: { type: 'idle' } });
    ok(canAttack(s, 0, [i.id], g.id) && !canAttack(s, 0, [i.id], tank.id), 'may be ordered at an aircraft, never at a tank');
    const t = tickUntil(s, x => !unitIn(x, g.id), 600);
    ok(!unitIn(t, g.id), 'an idle Interceptor shoots down a Gunship in reach');
    ok(unitIn(t, tank.id)!.hp === UNITS.tank.hp, 'and never touches the tank under it');
    const fired = AIR_AMMO.interceptor! - unitIn(t, i.id)!.ammo!;
    ok(fired >= 1 && fired <= AIR_AMMO.interceptor!, `spending missiles from its load (${fired})`);
  }
  // Scramble: parked on its pad, at an intruder within range of the pad; home again after.
  {
    const { s, cx, cy } = airArena('aw-scramble');
    const { pad, craft } = padWith(s, 0, cx - 8, cy - 1, ['interceptor']);
    const i = craft[0];
    const c = buildingCentre(pad);
    const quiet = tick(s, 200);
    ok(unitIn(quiet, i.id)!.order.type === 'rearm', 'with the sky clear it stays parked');
    const g = put(s, 1, 'gunship', c.x + SCRAMBLE_RANGE - 1.5, c.y, { stance: 'hold', ammo: 0, order: { type: 'idle' } });
    let t = tickUntil(s, x => !!unitIn(x, i.id)!.scramble, 10);
    ok(!!unitIn(t, i.id)!.scramble && unitIn(t, i.id)!.order.type === 'attack', 'an enemy aircraft comes within range of its pad: it scrambles');
    t = tickUntil(t, x => !unitIn(x, g.id), 600);
    ok(!unitIn(t, g.id), 'and shoots it down');
    t = tickUntil(t, x => unitIn(x, i.id)!.order.type === 'rearm' && unitIn(x, i.id)!.ammo === AIR_AMMO.interceptor, 1500);
    const back = unitIn(t, i.id)!;
    const spot = padSpot(t, pad, back);
    ok(back.order.type === 'rearm' && !back.scramble && back.x === spot.x && back.y === spot.y && back.ammo === AIR_AMMO.interceptor, 'then lands and rearms');

    // Out of range of the pad: it stays down.
    const out = copy(s);
    unitIn(out, g.id)!.x = c.x + SCRAMBLE_RANGE + 2;
    const o = tick(out, 60);
    ok(unitIn(o, i.id)!.order.type === 'rearm' && !unitIn(o, i.id)!.scramble, 'an aircraft beyond scramble range draws nothing');
    // On hold: never.
    const hold = copy(s);
    unitIn(hold, i.id)!.stance = 'hold';
    const h = tick(hold, 60);
    ok(unitIn(h, i.id)!.order.type === 'rearm', 'on hold, it never scrambles');
    // A Bomber passing over on a run: it scrambles at that too, and the leash brings it back.
    const flee = copy(s);
    const fg = unitIn(flee, g.id)!;
    fg.kind = 'bomber';
    fg.hp = UNITS.bomber.hp;
    fg.order = { type: 'move', x: s.mapW - 1, y: c.y };
    let f = tickUntil(flee, x => !!unitIn(x, i.id)!.scramble, 10);
    ok(!!unitIn(f, i.id)!.scramble, 'a Bomber passing near the pad draws a scramble');
    let maxOut = 0;
    let broke = false;
    for (let k = 0; k < 900; k++) {
      f = tick(f);
      const u = unitIn(f, i.id)!;
      maxOut = Math.max(maxOut, dist(u.x, u.y, c.x, c.y));
      if (u.order.type === 'rearm' && unitIn(f, g.id)) broke = true;
      if (!unitIn(f, g.id) || broke) break;
    }
    ok(maxOut <= SCRAMBLE_LEASH + 0.5, `a chase never takes it beyond the leash (${maxOut.toFixed(1)} of ${SCRAMBLE_LEASH} tiles)`);
    ok(broke || !unitIn(f, g.id), `it either brings the Bomber down or breaks off and heads home (${broke ? 'broke off' : 'shot down'}, ${maxOut.toFixed(1)} tiles out)`);
    // A player's order ends the scramble.
    const ordered = processAction(tickUntil(s, x => !!unitIn(x, i.id)!.scramble, 10), { type: 'move', ids: [i.id], x: cx + 4.5, y: cy + 4.5 });
    ok(!unitIn(ordered, i.id)!.scramble, 'an order of the player\'s ends the scramble');
    // Replays exactly.
    ok(JSON.stringify(tick(s, 700)) === JSON.stringify(tick(s, 700)), 'a scramble replays byte-identically');
  }
  // Air to air: Interceptors against Bombers on an attack-move escort.
  {
    const { s, cx, cy } = airArena('aw-escort');
    const a = put(s, 0, 'interceptor', cx - 6.5, cy + 0.5);
    const b = put(s, 1, 'interceptor', cx + 6.5, cy + 0.5);
    const t = processAction(s, { type: 'move', ids: [a.id], x: cx + 6.5, y: cy + 0.5, attackMove: true });
    const r = tickUntil(t, x => !unitIn(x, a.id) || !unitIn(x, b.id), 1000);
    ok(!unitIn(r, a.id) || !unitIn(r, b.id) || unitIn(r, a.id)!.hp < UNITS.interceptor.hp, 'two Interceptors fight each other');
  }
}

/** Countermeasures: flak and anti-air missiles take a quarter less; bullets do not change. */
function countermeasures(ok: Ok): void {
  const taken = (cm: boolean, shooter: 'flakcannon' | 'skyhunter'): number => {
    const { s, cx, cy } = airArena(`aw-cm-${shooter}`);
    if (cm) s.players[1].upgrades = ['countermeasures'];
    if (shooter === 'flakcannon') addBuilding(s, 0, 'flakcannon', cx, cy, -100);
    else put(s, 0, 'skyhunter', cx + 0.5, cy + 0.5);
    const g = put(s, 1, 'gunship', cx + 3.5, cy + 0.5, { stance: 'hold', ammo: 0, order: { type: 'idle' } });
    const t = tickUntil(s, x => (unitIn(x, g.id)?.hp ?? 0) < UNITS.gunship.hp, 200);
    return UNITS.gunship.hp - unitIn(t, g.id)!.hp;
  };
  for (const k of ['flakcannon', 'skyhunter'] as const) {
    const plain = taken(false, k);
    const cm = taken(true, k);
    ok(cm < plain && Math.abs(cm - plain * COUNTERMEASURES_DAMAGE) <= 1, `${k}: a hit takes ${cm} with Countermeasures, ${plain} without`);
  }
  // Bullets: unchanged.
  const bullets = (cm: boolean): number => {
    const { s, cx, cy } = airArena('aw-cm-bullet');
    if (cm) s.players[1].upgrades = ['countermeasures'];
    put(s, 0, 'rifleman', cx + 0.5, cy + 0.5);
    const g = put(s, 1, 'gunship', cx + 2.5, cy + 0.5, { stance: 'hold', ammo: 0, order: { type: 'idle' } });
    const t = tickUntil(s, x => (unitIn(x, g.id)?.hp ?? 0) < UNITS.gunship.hp, 200);
    return UNITS.gunship.hp - unitIn(t, g.id)!.hp;
  };
  ok(bullets(true) === bullets(false) && bullets(false) === Math.max(1, Math.round(UNITS.rifleman.weapon!.damage * DAMAGE_VS.bullet.aircraft)), 'a rifleman\'s bullet takes the same either way');
}

/** Troop Carriers: boarding, flying, setting down, refusal over water, and going down with them. */
function carriers(ok: Ok): void {
  ok(UNITS.carrier.carries === 6 && !UNITS.carrier.weapon && AIR_MENU.includes('carrier'), 'the Troop Carrier: unarmed, carries six, on the Air tab');
  const { s, cx, cy } = airArena('aw-carrier');
  const { pad, craft } = padWith(s, 0, cx - 7, cy - 1, ['carrier']);
  const c = craft[0];
  const men = Array.from({ length: 7 }, (_, i) => put(s, 0, i % 2 ? 'grenadier' : 'rifleman', cx - 3.5 + (i % 4), cy + 2.5 + Math.floor(i / 4)));
  men[0].hp = 30;
  men[0].kills = 3;
  const tank = put(s, 0, 'tank', cx - 2.5, cy + 5.5);
  ok(boardProblem(s, 0, [tank.id], c.id) !== null, 'a tank cannot board');
  ok(processAction(s, { type: 'board', ids: [tank.id], carrier: c.id }) === s, 'and the action is refused');
  let t = processAction(s, { type: 'board', ids: men.map(u => u.id).concat(tank.id), carrier: c.id });
  ok(t !== s, 'infantry ordered aboard');
  t = tickUntil(t, x => (unitIn(x, c.id)!.carried?.length ?? 0) >= 6, 600);
  t = tick(t, 120);
  const full = unitIn(t, c.id)!;
  ok(full.carried?.length === 6, `six climb in (${full.carried?.length})`);
  ok(full.carried!.every(r => !unitIn(t, r.id)), 'and leave the map while aboard');
  const seventh = men.find(m => !full.carried!.some(r => r.id === m.id))!;
  ok(!!unitIn(t, seventh.id) && !unitIn(t, seventh.id)!.boarding, 'the seventh, finding it full, stays behind');
  const hurt = full.carried!.find(r => r.id === men[0].id);
  ok(!!hurt && hurt.hp === 30 && hurt.kills === 3, 'a passenger keeps its health and its kills');
  ok(processAction(t, { type: 'board', ids: [seventh.id], carrier: c.id }) === t, 'boarding a full carrier is refused');
  ok(dist(full.x, full.y, pad.x + 0.5, pad.y + 1) < 1, 'it boarded them parked on its pad');

  // Over open ground: Unload sets them down at once, each on a tile of its own close by.
  let f = processAction(t, { type: 'move', ids: [c.id], x: cx + 4.5, y: cy - 4.5 });
  f = tickUntil(f, x => unitIn(x, c.id)!.order.type === 'idle', 400);
  const there = unitIn(f, c.id)!;
  let u = processAction(f, { type: 'unload', id: c.id });
  ok(u !== f, 'Unload over open ground is accepted');
  const out = full.carried!.map(r => unitIn(u, r.id));
  ok(out.every(Boolean) && !unitIn(u, c.id)!.carried, 'all six are set down at once');
  const tiles = new Set(out.map(r => Math.floor(r!.y) * u.mapW + Math.floor(r!.x)));
  ok(tiles.size === 6 && out.every(r => dist(r!.x, r!.y, there.x, there.y) <= UNLOAD_RADIUS + 1), 'each on its own tile, beside the carrier');
  ok(unitIn(u, men[0].id)!.hp === 30, 'with the health it had');
  ok(processAction(u, { type: 'unload', id: c.id }) === u, 'with nobody aboard, Unload is refused');
  u = tick(u, 30);
  ok(out.every(r => unitIn(u, r!.id)), 'and they stand there');

  // Unload given in flight: they get out where it stops.
  let d = processAction(t, { type: 'move', ids: [c.id], x: cx + 5.5, y: cy + 5.5 });
  d = processAction(d, { type: 'unload', id: c.id });
  ok(unitIn(d, c.id)!.drop === true && (unitIn(d, c.id)!.carried?.length ?? 0) === 6, 'Unload in flight: they stay aboard until it stops');
  d = tickUntil(d, x => !unitIn(x, c.id)!.carried, 400);
  const stop = unitIn(d, c.id)!;
  ok(!stop.carried && !stop.drop && dist(stop.x, stop.y, cx + 5.5, cy + 5.5) < 0.5, 'and get out where it stops');

  // Over water: no ground to stand on, so it cannot unload.
  {
    const w = copy(t);
    const tl = w.tiles.split('');
    for (let y = cy - 8; y <= cy + 8; y++) for (let x = cx + 1; x <= cx + 8; x++) tl[y * w.mapW + x] = 'w';
    w.tiles = tl.join('');
    let m = processAction(w, { type: 'move', ids: [c.id], x: cx + 5.5, y: cy + 0.5 });
    m = tickUntil(m, x => unitIn(x, c.id)!.order.type === 'idle', 400);
    ok(unloadProblem(m, 0, c.id) !== null && processAction(m, { type: 'unload', id: c.id }) === m, 'over water it cannot unload');
  }

  // Shot down with them aboard: all lost.
  {
    const k = copy(t);
    addBuilding(k, 1, 'flakcannon', cx + 2, cy - 4, -100);
    let m = processAction(k, { type: 'move', ids: [c.id], x: cx + 2.5, y: cy - 4.5 });
    const lost = k.players[0].stats.lost;
    m = tickUntil(m, x => !unitIn(x, c.id), 2000);
    ok(!unitIn(m, c.id) && full.carried!.every(r => !unitIn(m, r.id)), 'a carrier shot down takes its passengers with it');
    ok(m.players[0].stats.lost === lost + 7, `counted as seven losses (${m.players[0].stats.lost - lost})`);
  }
  // Replays exactly.
  const r1 = tick(processAction(s, { type: 'board', ids: men.map(u => u.id), carrier: c.id }), 600);
  const r2 = tick(processAction(s, { type: 'board', ids: men.map(u => u.id), carrier: c.id }), 600);
  ok(JSON.stringify(r1) === JSON.stringify(r2), 'boarding replays byte-identically');
}

/** The Heavy Bomber: a whole Helipad to itself, and a run of ten heavy bombs. */
function heavyBomber(ok: Ok): void {
  ok(airSlotsOf('heavybomber') === HELIPAD_SLOTS && AIR_AMMO.heavybomber === 10, 'takes a whole Helipad, carries ten bombs');
  ok(UNITS.heavybomber.hp > UNITS.bomber.hp * 2 && UNITS.heavybomber.weapon!.damage > UNITS.bomber.weapon!.damage, 'far tougher and harder-hitting than a Bomber');
  const { s, cx, cy } = airArena('aw-heavy');
  for (const k of ['power', 'power', 'power', 'factory', 'uplink', 'techcentre', 'researchlab'] as BuildingKind[]) addBuilding(s, 0, k, 1 + s.buildings.length * 4, 1, -100);
  s.players[0].credits = 50000;
  const { pad } = padWith(s, 0, cx - 7, cy + 4, ['gunship']);
  ok(!canQueue(s, 0, 'air', 'heavybomber'), 'a Helipad with a Gunship on it has no room for one');
  const empty = copy(s);
  empty.units = empty.units.filter(u => u.kind !== 'gunship');
  ok(canQueue(empty, 0, 'air', 'heavybomber'), 'an empty one has');
  const q = processAction(empty, { type: 'queue', category: 'air', kind: 'heavybomber' });
  ok(!canQueue(q, 0, 'air', 'gunship'), 'and once one is queued, nothing else fits on it');
  // A run: ten bombs on a cluster of structures.
  const t0 = copy(empty);
  const hb = put(t0, 0, 'heavybomber', cx - 7, cy + 5);
  hb.pad = pad.id;
  const target = addBuilding(t0, 1, 'barracks', cx + 3, cy - 3, -100);
  let t = processAction(t0, { type: 'attack', ids: [hb.id], target: target.id });
  let bombs = 0;
  const seen = new Set<number>();
  for (let i = 0; i < 600; i++) {
    t = tick(t);
    for (const p of t.projectiles) if (p.weapon === 'bomb' && !seen.has(p.id)) {
      seen.add(p.id);
      bombs++;
    }
    if (unitIn(t, hb.id)!.order.type === 'rearm' && bombs) break;
  }
  ok(bombs === 10, `a run drops all ten bombs (${bombs})`);
  ok(!t.buildings.find(b => b.id === target.id), 'and flattens a Barracks in one run');
  t = tickUntil(t, x => unitIn(x, hb.id)!.ammo === AIR_AMMO.heavybomber, 4000);
  const back = unitIn(t, hb.id)!;
  ok(back.ammo === AIR_AMMO.heavybomber && back.x === pad.x + HELIPAD_SLOTS / 2, 'then lands in the middle of its pad and rearms');
}

function oldSaves(ok: Ok): void {
  const { s, cx, cy } = airArena('aw-save');
  const g = put(s, 0, 'gunship', cx + 0.5, cy + 0.5, { scramble: true });
  const tank = put(s, 0, 'tank', cx + 2.5, cy + 0.5, { scramble: true });
  const i = put(s, 0, 'interceptor', cx + 4.5, cy + 0.5, { scramble: true, order: { type: 'idle' } });
  const m = migrateState(JSON.parse(JSON.stringify(s)));
  ok(!!m && !unitIn(m, g.id)!.scramble && !unitIn(m, tank.id)!.scramble, 'a scramble on anything but an Interceptor is dropped');
  ok(!!m && unitIn(m, i.id)!.scramble === true, 'an Interceptor\'s is kept');
  const junk = JSON.parse(JSON.stringify(s));
  junk.players[0].upgrades = ['countermeasures', 'nonsense', 'countermeasures'];
  const j = migrateState(junk);
  ok(!!j && JSON.stringify(j.players[0].upgrades) === '["countermeasures"]', 'Countermeasures survives a save; junk and repeats do not');
  // Passengers: kept on a carrier if they are infantry; dropped from anything else; a junk airlift cleared.
  const c = put(s, 0, 'carrier', cx + 6.5, cy + 0.5, { order: { type: 'idle' } });
  const rider = put(copy(s), 0, 'rifleman', 0.5, 0.5);
  c.carried = [rider, { kind: 'tank', hp: 100, id: 999 } as never, { nonsense: true } as never];
  tank.carried = [rider];
  const raw = JSON.parse(JSON.stringify(s));
  raw.ai[1].airlift = { carrier: 'x' };
  const k = migrateState(raw);
  ok(!!k && unitIn(k, c.id)!.carried?.length === 1 && unitIn(k, c.id)!.carried![0].kind === 'rifleman', 'a carrier keeps its infantry and loses anything else');
  ok(!!k && !unitIn(k, tank.id)!.carried, 'a tank carries nobody');
  ok(!!k && k.ai[1].airlift === null, 'a malformed airlift is cleared');
}

/** The computer: Interceptors against an opponent's aircraft, a Recon Plane against Stealth Tanks. */
function computer(ok: Ok): void {
  const quiet = (seed: string, enemy: 'air' | 'stealth'): GameState => {
    let s = copy(createInitialState(seed, seed, { seed, createdAt: 0, difficulty: 'hard', setup: { map: 'plains', tech: 'advanced', credits: 10000 } }));
    s.units = s.units.filter(u => u.owner !== 0);
    for (const m of s.ai) {
      m.nextAttack = 1e9;
      m.nextRaid = 1e9;
    }
    const hq = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
    if (enemy === 'air') padWith(s, 0, hq.x + 4, hq.y, ['gunship', 'gunship']);
    else put(s, 0, 'stealthtank', hq.x + 4.5, hq.y + 4.5, { stance: 'hold' });
    return s;
  };
  {
    let s = quiet('aw-ai-air', 'air');
    let at = -1;
    for (let k = 0; k < 120 && at < 0; k++) {
      s = tick(s, 100);
      if (s.units.some(u => u.owner === 1 && u.kind === 'interceptor')) at = s.tick;
    }
    ok(at > 0, `on Hard, faced with Gunships, the computer flies an Interceptor (from minute ${(at / 600).toFixed(1)})`);
    const parked = s.units.filter(u => u.owner === 1 && u.kind === 'interceptor').every(u => u.order.type === 'rearm' || u.scramble);
    ok(parked, 'and keeps it on its pad, ready to scramble');
  }
  {
    let s = quiet('aw-ai-stealth', 'stealth');
    const st = s.units.find(u => u.kind === 'stealthtank')!;
    let at = -1;
    let seen = false;
    for (let k = 0; k < 150 && !seen; k++) {
      s = tick(s, 100);
      if (at < 0 && s.units.some(u => u.owner === 1 && u.kind === 'reconplane')) at = s.tick;
      const tank = unitIn(s, st.id);
      if (at > 0 && (!tank || stealthSeen(s, tank, 1))) seen = true;
    }
    ok(at > 0, `faced with a Stealth Tank, it flies a Recon Plane (from minute ${(at / 600).toFixed(1)})`);
    ok(seen, 'and sends it over the tank, which its side then sees');
  }
  // An enemy Gunship over one of its haulers, out of any scramble range: the commander sends an
  // Interceptor after it, which shoots it down.
  {
    const { s, cx, cy } = airArena('aw-ai-defend');
    const { pad, craft } = padWith(s, 1, cx + 6, cy + 6, ['interceptor']);
    const hauler = put(s, 1, 'hauler', cx - 14.5, cy + 0.5, { stance: 'hold' });
    const g = put(s, 0, 'gunship', cx - 14.5, cy + 2.5, { stance: 'hold', ammo: 0, order: { type: 'idle' } });
    const c = buildingCentre(pad);
    ok(dist(c.x, c.y, g.x, g.y) > SCRAMBLE_RANGE, 'a Gunship over a hauler beyond the pad\'s scramble range');
    let t = tickUntil(s, x => unitIn(x, craft[0].id)!.order.type === 'attack', 600);
    const o = unitIn(t, craft[0].id)!.order;
    ok(o.type === 'attack' && o.target === g.id, 'the commander sends its Interceptor after it');
    t = tickUntil(t, x => !unitIn(x, g.id), 1200);
    ok(!unitIn(t, g.id) && !!unitIn(t, hauler.id), 'which shoots it down');
  }
  // Airlift: a Hard commander with a Troop Carrier and infantry at home flies them at a refinery.
  {
    let s = quiet('aw-ai-airlift', 'air');
    s.ai[1].nextAirStrike = 0;
    let lifted = 0;
    let setDown = false;
    for (let k = 0; k < 200 && !setDown; k++) {
      s = tick(s, 50);
      for (const c of s.units) if (c.owner === 1 && c.kind === 'carrier') lifted = Math.max(lifted, c.carried?.length ?? 0);
      const enemyHq = s.buildings.find(b => b.owner === 0 && b.kind === 'hq');
      if (lifted && enemyHq && s.units.some(u => u.owner === 1 && UNITS[u.kind].category === 'infantry' && dist(u.x, u.y, enemyHq.x, enemyHq.y) < 14)) setDown = true;
    }
    ok(lifted >= 4, `on Hard, the computer loads a Troop Carrier (${lifted} aboard at most)`);
    ok(setDown, 'and sets them down by the opponent\'s base');
  }
  // Normal on Easy does none of it.
  {
    let s = quiet('aw-ai-easy', 'air');
    s.difficulty = 'easy';
    for (let k = 0; k < 90; k++) s = tick(s, 100);
    ok(!s.units.some(u => u.owner === 1 && (u.kind === 'interceptor' || u.kind === 'reconplane')), 'on Easy it flies neither');
  }
}

/**
 * A real Hard battle in which side 0 starts with a Helipad and two Gunships: side 1's commander
 * answers with Interceptors, they fire, and the battle replays exactly.
 */
function battle(ok: Ok): void {
  const play = (): { s: GameState; aa: number; kinds: Set<string> } => {
    let s = copy(createInitialState('aw-battle', 'aw-battle', { seed: 'aw-battle', difficulty: 'hard', createdAt: 0, autopilot: true, setup: { map: 'plains', tech: 'advanced' } }));
    s.autopilotDifficulty = 'hard';
    // Side 0 starts with a Helipad and two Gunships, so side 1's commander has an air arm to answer.
    const hq = s.buildings.find(b => b.owner === 0 && b.kind === 'hq')!;
    padWith(s, 0, hq.x + 4, hq.y, ['gunship', 'gunship']);
    let aa = 0;
    const kinds = new Set<string>();
    const seen = new Set<number>();
    while (s.winner === null && s.tick < 30000) {
      s = tick(s, 20);
      for (const u of s.units) if (isAir(u)) kinds.add(u.kind);
      for (const p of s.projectiles) {
        if (seen.has(p.id) || p.weapon !== 'aamissile') continue;
        seen.add(p.id);
        const sh = p.shooter ? unitIn(s, p.shooter) : undefined;
        if (sh && sh.kind === 'interceptor') aa++;
      }
    }
    return { s, aa, kinds };
  };
  const a = play();
  ok(a.s.winner !== null, `a Hard battle with gunships from the start finishes (side ${a.s.winner} at minute ${Math.round(a.s.tick / 600)})`);
  ok(a.kinds.has('interceptor'), `side 1 answers with Interceptors (aircraft seen: ${[...a.kinds].join(', ')}; ${a.aa} air-to-air missiles)`);
  const b = play();
  ok(JSON.stringify(a.s) === JSON.stringify(b.s), 'and it replays byte-identically');
  console.log(`  air war battle on Hard: aircraft ${[...a.kinds].join(', ')}; ${a.aa} interceptor missiles; ${a.s.winner === null ? 'unfinished' : `side ${a.s.winner} won at ${Math.round(a.s.tick / 600)} min`}`);
}


export const sections: [string, (ok: Ok) => void][] = [
  ['Air war: rules', rules],
  ['Air war: the Recon Plane in flight', quietCommander(reconFlight)],
  ['Air war: detection', quietCommander(reconDetection)],
  ['Air war: Interceptors', quietCommander(interceptors)],
  ['Air war: Countermeasures', quietCommander(countermeasures)],
  ['Air war: Troop Carriers', quietCommander(carriers)],
  ['Air war: the Heavy Bomber', quietCommander(heavyBomber)],
  ['Air war: older saves', oldSaves],
  ['Air war: the computer', computer],
  ['Air war: a battle', battle],
];
