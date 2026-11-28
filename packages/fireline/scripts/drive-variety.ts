/**
 * Commander characters and battlefield events (2026-11-28; src/sim/characters.ts, src/sim/events.ts,
 * src/sim/aiEvents.ts, fireline-design.md). Its sections run inside scripts/drive.ts and count in its
 * totals.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { processAction } from '../src/sim/actions';
import { setAutopilotAi } from '../src/sim/ai';
import { scaledFor } from '../src/sim/aiScale';
import { CHARACTER_IDS, STRIKER_FIRST_FLOOR, characterAdjust, characterForSeed, characterMix, characterOf, characterSpec, characterTactics, charactersOn } from '../src/sim/characters';
import {
  DROP_MAX,
  DROP_REACH,
  DROP_VALUE,
  EVENT_FIRST,
  EVENT_GAP,
  EVENT_SPREAD,
  ORE_STRIKE_HEART,
  RELIEF_HOLD_TICKS,
  eventCopies,
  eventsOn,
  eventsStep,
  fireEvent,
  migrateEvents,
  reliefKinds,
} from '../src/sim/events';
import { dist } from '../src/sim/grid';
import { DEFAULT_SETUP, DIFFICULTIES, LEGACY_SETUP, difficultyForPace, type Owner, type SkirmishSetup, type UnitKind } from '../src/sim/rules';
import { addUnit, createInitialState, migrateState, normaliseSetup } from '../src/sim/state';
import { startOf } from '../src/sim/sides';
import type { GameState } from '../src/sim/types';

type Ok = (cond: unknown, what: string) => void;

const hash = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const copy = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
const BOTH: Partial<SkirmishSetup> = { map: 'plains', tech: 'advanced', characters: true, events: true };
const fresh = (setup: Partial<SkirmishSetup> = BOTH, seed = 'variety', autopilot = false): GameState =>
  createInitialState(seed, seed, { seed, createdAt: 0, setup, autopilot, difficulty: 'normal' });

/** Runs `fn` with every computer side doing nothing, so a section sees only the rules. */
function quiet(fn: (ok: Ok) => void): (ok: Ok) => void {
  return ok => {
    for (const o of [0, 1, 2, 3] as Owner[]) setAutopilotAi(() => {}, o);
    try {
      fn(ok);
    } finally {
      for (const o of [0, 1, 2, 3] as Owner[]) setAutopilotAi(null, o);
    }
  };
}

function setup(ok: Ok): void {
  ok(DEFAULT_SETUP.characters === true && DEFAULT_SETUP.events === true, 'a new skirmish has characters and events on');
  ok(LEGACY_SETUP.characters === false && LEGACY_SETUP.events === false, 'the legacy setup has both off');
  const partial = normaliseSetup({ map: 'plains' });
  ok(partial.characters === false && partial.events === false, 'a partial setup without them reads as off, whatever the base');
  const on = normaliseSetup({ ...DEFAULT_SETUP });
  ok(on.characters === true && on.events === true, 'the default setup keeps both on');
  const junk = normaliseSetup({ ...DEFAULT_SETUP, characters: 'yes' as unknown as boolean, events: 1 as unknown as boolean });
  ok(junk.characters === false && junk.events === false, 'anything but true reads as off');
  // The two keys come last, after adaptive.
  const keys = Object.keys(on);
  ok(JSON.stringify(keys.slice(-3)) === JSON.stringify(['adaptive', 'characters', 'events']), 'the two keys come last, after adaptive');
  // An older save (a setup without the keys) loads with both off and no events.
  const s = fresh({ map: 'plains', tech: 'advanced' });
  const raw = copy(s) as unknown as { setup: Record<string, unknown> };
  delete raw.setup.characters;
  delete raw.setup.events;
  const back = migrateState(raw)!;
  ok(back && back.setup!.characters === false && back.setup!.events === false && back.events === undefined, 'an older save loads with both off and no events');
  ok(!charactersOn(back) && !eventsOn(back), 'and neither is in play');
  // A battle with them off has no events at all.
  ok(fresh({ map: 'plains' }).events === undefined, 'no events state without the setup');
  // Never in a mission or a planet battle, even with the setup's keys on.
  const m = fresh();
  m.mission = {} as GameState['mission'];
  ok(!charactersOn(m) && !eventsOn(m) && characterOf(m, 1) === null, 'a mission has neither');
  const p = fresh();
  p.planet = {} as GameState['planet'];
  ok(!charactersOn(p) && !eventsOn(p), 'a planet battle has neither');
}

function characters(ok: Ok): void {
  // Drawn from the seed text: the same seed, the same commander; spread over all five.
  const counts = new Map<string, number>();
  for (let i = 0; i < 400; i++) {
    const c = characterForSeed(`seed-${i}`, 1);
    counts.set(c, (counts.get(c) ?? 0) + 1);
    ok(characterForSeed(`seed-${i}`, 1) === c, `seed-${i} draws the same character twice`);
  }
  for (const c of CHARACTER_IDS) ok((counts.get(c) ?? 0) >= 50 && (counts.get(c) ?? 0) <= 115, `${c} drawn ${counts.get(c)} times in 400 (between 50 and 115)`);
  // Seats draw separately: across seeds, seats 1 and 2 differ often.
  let differ = 0;
  for (let i = 0; i < 100; i++) if (characterForSeed(`s${i}`, 1) !== characterForSeed(`s${i}`, 2)) differ++;
  ok(differ >= 60, `seats 1 and 2 differ in ${differ} of 100 seeds`);
  // Side 0 has none unless the computer plays it.
  const s = fresh(BOTH, 'char-a');
  ok(characterOf(s, 0) === null && characterOf(s, 1) !== null, 'side 0 has no character; side 1 has one');
  ok(characterOf(fresh(BOTH, 'char-a', true), 0) !== null, 'side 0 has one under the autopilot');
  ok(characterOf(fresh({ ...BOTH, characters: false }, 'char-a'), 1) === null, 'none with characters off');
  // The adjustments: Steady is the difficulty itself; the others move the clock the stated way.
  for (const diff of ['easy', 'normal', 'hard'] as const) {
    const d = DIFFICULTIES[diff];
    const st = characterAdjust('steady', d);
    ok(st === d, `${diff}: Steady is the difficulty's own numbers`);
    const k = characterAdjust('striker', d);
    const b = characterAdjust('bulwark', d);
    const h = characterAdjust('hunter', d);
    const u = characterAdjust('builder', d);
    ok(k.firstAttack < d.firstAttack && k.attackInterval < d.attackInterval && k.firstWave <= d.firstWave && k.turrets <= d.turrets, `${diff}: a Striker is earlier, more often, smaller, with fewer turrets`);
    ok(b.firstAttack > d.firstAttack && b.firstWave > d.firstWave && b.turrets > d.turrets && b.waveCap > d.waveCap, `${diff}: a Bulwark is later, larger and better defended`);
    ok(h.firstAttack <= d.firstAttack && h.waveCap <= d.waveCap, `${diff}: a Hunter's main waves are no larger`);
    ok(u.firstAttack > d.firstAttack && u.refineries > d.refineries && u.waveCap > d.waveCap, `${diff}: a Builder has more Refineries and comes later with more`);
    ok(k.firstWave >= 3 && k.waveCap >= 6, `${diff}: a Striker's waves keep a floor`);
    ok(k.firstAttack >= Math.min(d.firstAttack, STRIKER_FIRST_FLOOR), `${diff}: a Striker never attacks before the guided battle is done`);
  }
  // Tactics: a Hunter raids at every difficulty, Easy included, sooner and more often.
  const seedFor = (want: string) => {
    for (let i = 0; i < 500; i++) if (characterForSeed(`find-${i}`, 1) === want) return `find-${i}`;
    throw new Error(`no seed draws ${want}`);
  };
  const hunter = fresh(BOTH, seedFor('hunter'));
  const t0 = { extraHaulers: 0, raidSize: 0, firstRaid: 0, raidInterval: 0, rocketTurrets: 0, walls: 0, lateRefineries: 1 };
  const th = characterTactics(hunter, 1, t0);
  ok(th.raidSize >= 2 && th.firstRaid > 0 && th.raidInterval > 0, 'a Hunter raids even where the difficulty does not');
  const tn = characterTactics(hunter, 1, { ...t0, raidSize: 2, firstRaid: 4200, raidInterval: 2400 });
  ok(tn.raidSize === 4 && tn.firstRaid < 4200 && tn.raidInterval < 2400, 'a Hunter raids with more, sooner and more often');
  const bulwark = fresh(BOTH, seedFor('bulwark'));
  ok(characterTactics(bulwark, 1, t0).walls === 4 && characterTactics(bulwark, 1, t0).rocketTurrets === 2, 'a Bulwark adds walls and Rocket Turrets');
  const steady = fresh(BOTH, seedFor('steady'));
  ok(characterTactics(steady, 1, t0) === t0, 'Steady tactics are the same object');
  // Taste: Steady's mix is the same array; a Bulwark weights artillery up and buggies down.
  const mix: [UnitKind, number][] = [['tank', 5], ['buggy', 1], ['artillery', 1]];
  ok(characterMix(steady, 1, mix) === mix, "Steady's mix is the same array");
  const bm = characterMix(bulwark, 1, mix);
  ok(bm[2][1] > 1 && bm[1][1] < 1 && bm[0][1] === 5, 'a Bulwark favours artillery over buggies, tanks unchanged');
  // The first attack in a new battle follows the character, on every map size.
  for (const size of ['standard', 'large'] as const) {
    for (const want of ['striker', 'bulwark', 'steady'] as const) {
      const seed = seedFor(want);
      const g = fresh({ ...BOTH, size }, seed);
      const plain = scaledFor(g, difficultyForPace('normal', g.setup!.pace));
      ok(g.ai[1].nextAttack === characterSpec(g, 1, plain).firstAttack, `${size}, ${want}: the first attack is on its character's clock`);
      if (want === 'striker') ok(g.ai[1].nextAttack < plain.firstAttack, `${size}: a Striker's first attack is earlier`);
      if (want === 'bulwark') ok(g.ai[1].nextAttack > plain.firstAttack, `${size}: a Bulwark's first attack is later`);
      if (want === 'steady') ok(g.ai[1].nextAttack === plain.firstAttack, `${size}: Steady's first attack is as before`);
    }
  }
  // Purity: the pick never moves the battle's stream.
  const a = fresh(BOTH, 'purity');
  const b = fresh({ ...BOTH, characters: false }, 'purity');
  ok(a.rngSeed === b.rngSeed, 'the battle stream starts in the same place with or without characters');
}

/** Off is the earlier battle exactly: with both off, and with both absent, the same battle tick for tick. */
function offIsUnchanged(ok: Ok): void {
  for (const seed of ['off-1', 'off-2']) {
    const base: Partial<SkirmishSetup> = { map: 'random', tech: 'advanced', research: 'lines', adaptive: true, fortification: true };
    let x = createInitialState(seed, seed, { seed, createdAt: 0, setup: base, autopilot: true, difficulty: 'normal' });
    let y = createInitialState(seed, seed, { seed, createdAt: 0, setup: { ...base, characters: false, events: false }, autopilot: true, difficulty: 'normal' });
    for (let i = 0; i < 60; i++) {
      x = processAction(x, { type: 'tick', n: 50 });
      y = processAction(y, { type: 'tick', n: 50 });
    }
    ok(hash(x) === hash(y), `${seed}: off and absent play the same battle for five minutes`);
    ok(x.events === undefined && !x.ai.some(m => 'eventParty' in m), `${seed}: no events state and no party memory`);
  }
}

function schedule(ok: Ok): void {
  for (let i = 0; i < 40; i++) {
    const s = fresh(BOTH, `sched-${i}`);
    const ev = s.events!;
    ok(ev && ev.n === 0 && ev.live.length === 0, `sched-${i}: events start empty`);
    ok(ev.next >= EVENT_FIRST && ev.next < EVENT_FIRST + EVENT_SPREAD, `sched-${i}: the first event between five and seven minutes (${ev.next})`);
    ok(fresh(BOTH, `sched-${i}`).events!.next === ev.next, `sched-${i}: the same seed, the same schedule`);
  }
  quiet(ok2 => {
    const s = fresh(BOTH, 'sched-run');
    const first = s.events!.next;
    s.tick = first;
    eventsStep(s);
    ok2(s.events!.n === 1, 'the event fires on its tick');
    ok2(s.events!.next >= first + EVENT_GAP && s.events!.next < first + EVENT_GAP + EVENT_SPREAD, 'the next one six to eight minutes later');
    ok2(s.log.some(l => /Ore strike|Supply drop/.test(l.text)), 'the first event is a drop or an ore strike, announced');
    ok2(!s.log.some(l => /Relief column/.test(l.text)), 'never the relief column first');
  })(ok);
}

/**
 * Fair to every seat: each yard's nearest copy is as far from it as every other yard's nearest copy
 * (within a couple of tiles: three sides are rounded to tiles and nudged). That is the race each side runs.
 */
function fair(s: GameState, spots: { x: number; y: number }[]): boolean {
  const ds = s.players.map((_, o) => {
    const st = startOf(s, o as Owner);
    return Math.min(...spots.map(p => dist(p.x + 0.5, p.y + 0.5, st.x + 1.5, st.y + 1.5)));
  });
  return Math.max(...ds) - Math.min(...ds) <= 2.5;
}

function placement(ok: Ok): void {
  for (const sides of [2, 3, 4] as const) {
    for (let i = 0; i < 6; i++) {
      const s = fresh({ ...BOTH, map: 'random', sides }, `place-${sides}-${i}`);
      for (const kind of ['drop', 'ore'] as const) {
        const before = s.events!.live.length;
        fireEvent(s, kind);
        const made = s.events!.live.slice(before);
        if (!made.length) {
          ok(s.log.length > 0, `${sides} sides, ${kind}: no spot on this map is allowed (nothing placed)`);
          continue;
        }
        ok(made.length === sides, `${sides} sides, ${kind} ${i}: one per side (${made.length})`);
        ok(fair(s, made), `${sides} sides, ${kind} ${i}: every yard as far from its nearest copy`);
        ok(
          made.every(e => 'gdpb'.includes(s.tiles[e.y * s.mapW + e.x])),
          `${sides} sides, ${kind} ${i}: on walkable ground`,
        );
      }
    }
  }
  // The copies helper: two sides mirror through the middle; four turn by quarters.
  const two = fresh(BOTH, 'copies');
  const c2 = eventCopies(two, 20, 40);
  ok(!c2 || (c2[1].x === two.mapW - 21 && c2[1].y === two.mapH - 41), 'two sides: the point mirror');
}

function crates(ok: Ok): void {
  const s = fresh(BOTH, 'crates');
  fireEvent(s, 'drop');
  const live = s.events!.live.filter(e => e.kind === 'drop');
  ok(live.length === 2, 'two crates');
  ok(live.every(e => e.value === DROP_VALUE), `the first drop is worth ${DROP_VALUE}`);
  const e = live[0];
  const credits = s.players[0].credits;
  // A unit just out of reach takes nothing; within reach, side 0 takes it.
  const u = addUnit(s, 0, 'rifleman', e.x + 0.5 + DROP_REACH + 0.3, e.y + 0.5);
  eventsStep(s);
  ok(s.events!.live.some(x => x.id === e.id), 'out of reach: still there');
  u.x = e.x + 0.6;
  u.y = e.y + 0.5;
  eventsStep(s);
  ok(!s.events!.live.some(x => x.id === e.id) && s.players[0].credits === credits + DROP_VALUE, 'within reach: taken, credits paid');
  // The nearer of two units takes it; an aircraft takes nothing.
  const e2 = s.events!.live.find(x => x.kind === 'drop')!;
  const near = addUnit(s, 1, 'rifleman', e2.x + 0.5, e2.y + 0.6);
  addUnit(s, 0, 'rifleman', e2.x + 0.5, e2.y + 1.4);
  const c1 = s.players[1].credits;
  eventsStep(s);
  ok(s.players[1].credits === c1 + DROP_VALUE && near.owner === 1, 'the nearer unit takes it');
  // Values rise and are capped.
  const v = fresh(BOTH, 'crate-values');
  for (let i = 0; i < 12; i++) fireEvent(v, 'drop');
  ok(v.events!.live.every(x => x.value <= DROP_MAX) && v.events!.live.some(x => x.value === DROP_MAX), 'values rise to the cap and no further');
  // Unclaimed, a crate goes at its time.
  const w = fresh(BOTH, 'crate-expire');
  fireEvent(w, 'drop');
  const until = w.events!.live[0].until;
  w.tick = until;
  eventsStep(w);
  ok(w.events!.live.length === 0 && w.log.some(l => /unclaimed/.test(l.text)), 'unclaimed crates are lost at their time');
  // An aircraft cannot take one.
  const a = fresh(BOTH, 'crate-air');
  fireEvent(a, 'drop');
  const ea = a.events!.live[0];
  addUnit(a, 0, 'gunship', ea.x + 0.5, ea.y + 0.5);
  const ca = a.players[0].credits;
  eventsStep(a);
  ok(a.players[0].credits === ca && a.events!.live.some(x => x.id === ea.id), 'an aircraft takes nothing');
}

function ore(ok: Ok): void {
  const s = fresh(BOTH, 'ore-strike');
  const before = s.ore.reduce((a, b) => a + b, 0);
  fireEvent(s, 'ore');
  const after = s.ore.reduce((a, b) => a + b, 0);
  const marks = s.events!.live.filter(e => e.kind === 'ore');
  ok(marks.length === 2, 'an ore mark per side');
  ok(after > before + 4000, `ore added (${after - before})`);
  for (const m of marks) ok(s.ore[m.y * s.mapW + m.x] === ORE_STRIKE_HEART || s.tiles[m.y * s.mapW + m.x] !== 'g', 'the heart of each field is full');
  ok(s.ore.every(Number.isInteger), 'ore stays whole numbers (saves pack it)');
  // Equal ore for each side.
  const near = (m: { x: number; y: number }) => {
    let t = 0;
    for (let y = m.y - 3; y <= m.y + 3; y++) for (let x = m.x - 3; x <= m.x + 3; x++) t += s.ore[y * s.mapW + x] ?? 0;
    return t;
  };
  ok(Math.abs(near(marks[0]) - near(marks[1])) <= 600, 'each side gets about the same ore');
  s.tick = marks[0].until;
  eventsStep(s);
  ok(!s.events!.live.some(e => e.kind === 'ore'), 'the marks fade');
}

function relief(ok: Ok): void {
  const s = fresh(BOTH, 'relief');
  fireEvent(s, 'relief');
  const b = s.events!.live.find(e => e.kind === 'relief');
  ok(!!b, 'a beacon');
  if (!b) return;
  const at = (o: Owner, kind: UnitKind, dx: number) => addUnit(s, o, kind, b.x + 0.5 + dx, b.y + 0.5);
  // Unarmed units hold nothing.
  at(0, 'medic' as UnitKind, 0.5);
  for (let i = 0; i < 20; i++) {
    s.tick += 10;
    eventsStep(s);
  }
  ok(!b.hold && s.events!.live.find(e => e.id === b.id)?.hold === undefined, 'unarmed units hold nothing');
  // Armed and alone: the hold builds.
  const r0 = at(0, 'rifleman', -0.5);
  for (let i = 0; i < 10; i++) {
    s.tick += 10;
    eventsStep(s);
  }
  const held = s.events!.live.find(e => e.id === b.id)!.hold;
  ok(held && held.team === 0 && held.ticks === 100, 'armed and alone: the hold builds');
  // Contested: it stands still.
  const r1 = at(1, 'rifleman', 1);
  for (let i = 0; i < 10; i++) {
    s.tick += 10;
    eventsStep(s);
  }
  ok(s.events!.live.find(e => e.id === b.id)!.hold!.ticks === 100, 'contested: the hold stands still');
  r1.hp = 0;
  s.units = s.units.filter(u => u.hp > 0);
  // Left alone, it slips back.
  r0.x += 20;
  for (let i = 0; i < 10; i++) {
    s.tick += 10;
    eventsStep(s);
  }
  ok(s.events!.live.find(e => e.id === b.id)!.hold!.ticks === 50, 'left alone: the hold slips back at half the rate');
  r0.x -= 20;
  const units0 = s.units.filter(u => u.owner === 0).length;
  for (let i = 0; i < RELIEF_HOLD_TICKS / 10; i++) {
    s.tick += 10;
    eventsStep(s);
  }
  ok(!s.events!.live.some(e => e.id === b.id), 'held long enough: the beacon is claimed');
  ok(s.units.filter(u => u.owner === 0).length === units0 + reliefKinds(s, 0).length, `the relief column joins side 0 (${reliefKinds(s, 0).length} units)`);
  ok(s.log.some(l => /relief column has joined you/.test(l.text)), 'and side 0 is told');
  // Never twice in a step; an Ashen side's column is what its army fields.
  const ash = fresh({ ...BOTH, factions: ['meridian', 'ashen'] }, 'relief-ash');
  ok(reliefKinds(ash, 1).length === 6, 'an Ashen side gets a full column');
}

function saves(ok: Ok): void {
  const s = fresh(BOTH, 'saves');
  fireEvent(s, 'relief');
  fireEvent(s, 'drop');
  const b = s.events!.live.find(e => e.kind === 'relief');
  if (b) b.hold = { team: 1, ticks: 120 };
  const back = migrateState(copy(s))!;
  ok(hash(back.events) === hash(s.events), 'events survive a save exactly');
  const junk = copy(s) as unknown as { events: unknown };
  junk.events = { n: 'x', live: 5 };
  ok(migrateState(junk)!.events === undefined, 'junk events are dropped');
  const bad = copy(s) as unknown as { events: { live: unknown[] } };
  bad.events.live.push({ id: -1, kind: 'bomb', x: 1, y: 1, value: 1, until: 1 }, { id: 99, kind: 'drop', x: 9999, y: 1, value: 1, until: 1 });
  ok(migrateState(bad)!.events!.live.length === s.events!.live.length, 'bad entries are dropped, good ones kept');
  const off = copy(s) as unknown as { setup: Record<string, unknown> };
  off.setup.events = false;
  ok(migrateState(off)!.events === undefined, 'events dropped when the setup has them off');
  const over = copy(s);
  over.events!.live[0].value = 999999;
  ok(migrateEvents(over.events, s)!.live[0].value <= DROP_MAX, 'a crate is never worth more than the cap on load');
  // The commander's party memory: a junk one is shrugged off by the next decision.
  let t = fresh(BOTH, 'party-junk', true);
  t.ai[1].eventParty = { item: 5, ids: 'x' as unknown as number[] };
  t = processAction(t, { type: 'tick', n: 50 });
  ok(t.ai[1].eventParty === null || t.ai[1].eventParty === undefined || Array.isArray(t.ai[1].eventParty.ids), 'a junk party memory does no harm');
}

/** Whole computer battles with both on: they finish, events fire and are taken, and a replay is exact. */
function battles(ok: Ok, seeds: string[], claimSeeds: string[]): void {
  const CAP = 36000;
  for (const seed of seeds) {
    const run = (save?: number) => {
      let s = createInitialState(seed, seed, { seed, createdAt: 0, setup: { ...DEFAULT_SETUP }, autopilot: true, difficulty: 'normal' });
      let taken = 0;
      let claimedByComputer = 0;
      while (s.winner === null && s.tick < CAP) {
        const before = s.log.length ? s.log[s.log.length - 1] : null;
        s = processAction(s, { type: 'tick', n: 50 });
        const fresh = before ? s.log.slice(s.log.indexOf(s.log.find(l => l === before) ?? s.log[0]) + 1) : s.log;
        for (const l of fresh) {
          if (/crate taken|took a supply crate/i.test(l.text)) taken++;
          if (/took a supply crate|held the beacon/.test(l.text)) claimedByComputer++;
        }
        if (save !== undefined && s.tick === save) s = migrateState(JSON.parse(JSON.stringify(s)))!;
      }
      return { s, taken, claimedByComputer };
    };
    const a = run();
    ok(a.s.winner !== null, `${seed}: finished (${(a.s.tick / 600).toFixed(1)} minutes)`);
    ok((a.s.events?.n ?? 0) >= 1 || a.s.tick < EVENT_FIRST + EVENT_SPREAD, `${seed}: at least one event fired (${a.s.events?.n})`);
    ok(characterOf(a.s, 1) !== null && characterOf(a.s, 0) !== null, `${seed}: both computer seats have a character`);
    const b = run();
    ok(hash(a.s) === hash(b.s), `${seed}: replays byte-identically`);
    const c = run(6000);
    ok(hash(a.s) === hash(c.s), `${seed}: the same through a save at ten minutes`);
    ok(a.s.players.every(p => p.credits >= 0), `${seed}: nobody below nought`);
  }
  // Across a few seeds the computer does take crates (it races for them).
  if (!claimSeeds.length) return;
  let anyTaken = 0;
  for (const seed of claimSeeds) {
    let s = createInitialState(seed, seed, { seed, createdAt: 0, setup: { ...DEFAULT_SETUP }, autopilot: true, difficulty: 'normal' });
    while (s.winner === null && s.tick < 24000) s = processAction(s, { type: 'tick', n: 100 });
    if (s.log.some(l => /crate|beacon/.test(l.text) && /took|taken|held|joined/.test(l.text))) anyTaken++;
  }
  ok(anyTaken >= Math.ceil(claimSeeds.length / 2), `the computers claim events in ${anyTaken} of ${claimSeeds.length} battles`);
}

function purity(ok: Ok): void {
  for (const f of ['characters.ts', 'events.ts', 'aiEvents.ts']) {
    const src = readFileSync(new URL(`../src/sim/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    ok(!/Math\.random|Date\.now|new Date|performance\.now/.test(src), `${f}: no dice and no clock`);
  }
  // An illegal action still returns the same object with events on.
  const s = fresh(BOTH, 'illegal');
  ok(processAction(s, { type: 'sell', id: 999999 }) === s, 'an illegal action returns the same state object');
}

export const sections: [string, (ok: Ok) => void][] = [
  ['Variety: the setup', setup],
  ['Variety: commander characters', characters],
  ['Variety: off is the earlier battle', offIsUnchanged],
  ['Variety: the events schedule', schedule],
  ['Variety: events placed fairly', quiet(placement)],
  ['Variety: supply crates', quiet(crates)],
  ['Variety: ore strikes', quiet(ore)],
  ['Variety: the relief beacon', quiet(relief)],
  ['Variety: saves', saves],
  ['Variety: a computer battle', ok => battles(ok, ['vb-1'], [])],
  ['Variety: whole computer battles', ok => battles(ok, ['vb-2', 'vb-3', 'vb-4'], ['vt-1', 'vt-2', 'vt-3', 'vt-4'])],
  ['Variety: purity', purity],
];
