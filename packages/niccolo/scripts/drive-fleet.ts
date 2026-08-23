/**
 * Fleet growth (Phase 28) — classes, speed, upkeep, and above all the soft-lock the spec has warned
 * about since Chapter 4.
 *
 * The warning in `freeplay-and-trading-design.md` Part 4 names `vesselKindAt` as the hazard. That is
 * out of date: every one of those triggers was already migrated to `vesselIdAt` in Phase 20. The
 * live hazard is the *other* half of the same problem — four triggers across Chapters 4, 5 and 7
 * name `ship_1` by id, and selling that hull would make three chapters unsatisfiable. Section 4
 * below is the one that matters.
 */
import { createInitialState } from '../src/sim/state';
import { processAction } from '../src/sim/actions';
import { EVENTS, findRoute } from '../src/sim/content';
import {
  RESALE_FRACTION, SHIPYARD_CITY_IDS, VESSEL_TYPES, buyVessel, findVesselType,
  fleetUpkeepPerWeek, isShipyard, resaleValue, resolveWeeklyFleet, sellVessel, vesselSpeed,
  vesselUpkeep,
} from '../src/sim/shipyard';
import { checkTriggers } from '../src/sim/events';
import type { GameAction, GameState, Vessel } from '../src/sim/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}
function threw(fn: () => unknown): string | null {
  try { fn(); return null; } catch (e) { return (e as Error).message; }
}
function seed(cash = 4000): GameState {
  const base = createInitialState('drv28', 'Fleet', { skipPrologue: true });
  return { ...base, cash, firedEvents: EVENTS.map(e => e.id), pendingEvents: [] };
}
const act = (s: GameState, a: GameAction) => processAction(s, a);
const SHIP = 'ship_1';

// ---------------------------------------------------------------------------
console.log('\n1. The classes, and what makes them a choice rather than a shopping list');
// ---------------------------------------------------------------------------
{
  check('every class is authored with a full record', VESSEL_TYPES.every(t =>
    !!t.id && !!t.name && !!t.kind && !!t.note && t.cost > 0 && t.upkeepPerWeek > 0 && t.speed > 0));
  check('ids are unique', new Set(VESSEL_TYPES.map(t => t.id)).size === VESSEL_TYPES.length);
  check('the three ship classes the spec names all exist',
    ['cog', 'carrack', 'galley'].every(id => findVesselType(id)?.kind === 'ship'));
  const cog = findVesselType('cog')!, carrack = findVesselType('carrack')!, galley = findVesselType('galley')!;
  // The spec's own shape: bigger is slower, small is fast. If any of these inverted, class would
  // collapse back into "buy the biggest you can afford".
  check('the carrack carries most and is slowest',
    carrack.capacity > cog.capacity && carrack.speed > cog.speed);
  check('the galley carries least and is fastest',
    galley.capacity < cog.capacity && galley.speed < cog.speed);
  check('and neither is simply better — each costs more than the cog',
    carrack.cost > cog.cost && galley.cost > cog.cost);
  check('a courier class exists and carries nothing', findVesselType('courier')!.capacity === 0);
  check('resale is a real haircut, never a way to raise money', RESALE_FRACTION < 1);
  check('so buying then selling immediately loses money',
    VESSEL_TYPES.every(t => resaleValue({ typeId: t.id, kind: t.kind } as Vessel) < t.cost));
  // No arbitrage in either direction, including for the *untyped* hulls a campaign starts with.
  // Pricing every untyped hull off the cog valued the house's own courier above the price of a new
  // one — selling the rider and buying a replacement was free money. Found by reading the live UI.
  check('an untyped hull never sells for more than a new one of its kind costs',
    (['ship', 'courier'] as const).every(kind => {
      const cheapest = Math.min(...VESSEL_TYPES.filter(t => t.kind === kind).map(t => t.cost));
      return resaleValue({ kind } as Vessel) < cheapest;
    }));
  check('and an untyped courier is valued as a courier, not as a ship',
    resaleValue({ kind: 'courier' } as Vessel) < resaleValue({ kind: 'ship' } as Vessel));
}

// ---------------------------------------------------------------------------
console.log('\n2. Buying and selling, and where');
// ---------------------------------------------------------------------------
{
  const s = seed();
  check('shipyards are a short named list, not every port', SHIPYARD_CITY_IDS.length <= 4);
  check('and the home port is one of them', isShipyard('bruges'));
  check('a random port is not', !isShipyard('timbuktu'));

  const bought = act(s, { type: 'BUY_VESSEL', typeId: 'carrack' });
  const carrack = findVesselType('carrack')!;
  check('buying charges the class price', bought.cash === s.cash - carrack.cost);
  check('and adds a hull', bought.vessels.length === s.vessels.length + 1);
  const newHull = bought.vessels[bought.vessels.length - 1];
  check('with the class capacity', newHull.capacity === carrack.capacity);
  check('the class recorded on it', newHull.typeId === 'carrack');
  check('docked where it was bought', newHull.location === 'bruges' && !newHull.destination);
  check('and an id that collides with nothing', bought.vessels.filter(v => v.id === newHull.id).length === 1);

  check('an unknown class is refused',
    threw(() => act(s, { type: 'BUY_VESSEL', typeId: 'dromon' }))?.includes('No such vessel class') === true);
  check('too little cash is refused',
    threw(() => act({ ...s, cash: 10 }, { type: 'BUY_VESSEL', typeId: 'carrack' }))?.includes('Not enough cash') === true);

  // Nobody at a yard: send every hull away.
  const away = { ...s, vessels: s.vessels.map(v => ({ ...v, location: 'timbuktu' })) };
  check('buying with nobody at a shipyard is refused',
    threw(() => act(away, { type: 'BUY_VESSEL', typeId: 'cog' }))?.includes('nobody at a shipyard') === true);
  // Exile closes the yard along with the port.
  const exiled = { ...s, flags: { ...s.flags, exiled_from_flanders: true } };
  check('a yard in a city closed by exile is refused',
    threw(() => act(exiled, { type: 'BUY_VESSEL', typeId: 'cog' }))?.includes('closed to the house') === true);

  // Naming.
  const named = act(s, { type: 'BUY_VESSEL', typeId: 'galley', name: 'The Ghost' });
  check('a hull can be named', named.vessels[named.vessels.length - 1].name === 'The Ghost');
  check('and gets a default name otherwise', newHull.name.length > 0 && newHull.name.includes('Carrack'));

  // Selling.
  const sold = act(bought, { type: 'SELL_VESSEL', vesselId: newHull.id });
  check('selling returns the resale value', sold.cash === bought.cash + resaleValue(newHull));
  check('and removes the hull', !sold.vessels.some(v => v.id === newHull.id));
  check('a round trip through the yard loses money', sold.cash < s.cash);
  check('selling a hull that does not exist is refused',
    threw(() => act(s, { type: 'SELL_VESSEL', vesselId: 'ship_99' }))?.includes('No such vessel') === true);
  check('selling away from a yard is refused',
    threw(() => act({ ...bought, vessels: bought.vessels.map(v => v.id === newHull.id ? { ...v, location: 'naples' } : v) },
      { type: 'SELL_VESSEL', vesselId: newHull.id }))?.includes('must be at Bruges') === true);

  // Ids are never recycled — content names ids, so a reused id could satisfy another chapter.
  const rebought = act(sold, { type: 'BUY_VESSEL', typeId: 'cog' });
  check('an id is never reused after a sale',
    rebought.vessels[rebought.vessels.length - 1].id !== newHull.id,
    `${rebought.vessels[rebought.vessels.length - 1].id} vs ${newHull.id}`);
}

// ---------------------------------------------------------------------------
console.log('\n3. Class changes the passage, and a convoy moves at its slowest');
// ---------------------------------------------------------------------------
{
  const route = findRoute('bruges', 'calais')!;
  const s = seed();

  const untyped = act(s, { type: 'DISPATCH_VESSEL', vesselId: SHIP, destinationId: 'calais' });
  check('an untyped hull sails at exactly the old speed',
    untyped.vessels.find(v => v.id === SHIP)!.weeksRemaining === route.distanceWeeks,
    `${untyped.vessels.find(v => v.id === SHIP)!.weeksRemaining} vs ${route.distanceWeeks}`);

  const withGalley = act(s, { type: 'BUY_VESSEL', typeId: 'galley' });
  const galleyId = withGalley.vessels[withGalley.vessels.length - 1].id;
  const galleySailing = act(withGalley, { type: 'DISPATCH_VESSEL', vesselId: galleyId, destinationId: 'calais' });
  const galleyWeeks = galleySailing.vessels.find(v => v.id === galleyId)!.weeksRemaining;

  const withCarrack = act(s, { type: 'BUY_VESSEL', typeId: 'carrack' });
  const carrackId = withCarrack.vessels[withCarrack.vessels.length - 1].id;
  const carrackSailing = act(withCarrack, { type: 'DISPATCH_VESSEL', vesselId: carrackId, destinationId: 'calais' });
  const carrackWeeks = carrackSailing.vessels.find(v => v.id === carrackId)!.weeksRemaining;

  check('a carrack is slower than an untyped hull on the same route', carrackWeeks > route.distanceWeeks,
    `${carrackWeeks} vs ${route.distanceWeeks}`);
  check('a galley is no slower', galleyWeeks <= route.distanceWeeks, `${galleyWeeks} vs ${route.distanceWeeks}`);
  check('and a galley beats a carrack', galleyWeeks < carrackWeeks, `${galleyWeeks} vs ${carrackWeeks}`);
  check('no passage is ever less than a week', galleyWeeks >= 1);

  // A convoy sails at its slowest member — otherwise sailing together would not mean arriving
  // together, which is the only reason `Convoy` exists.
  let convoy = act(s, { type: 'BUY_VESSEL', typeId: 'carrack' });
  const slowId = convoy.vessels[convoy.vessels.length - 1].id;
  convoy = act(convoy, { type: 'BUY_VESSEL', typeId: 'galley' });
  const fastId = convoy.vessels[convoy.vessels.length - 1].id;
  convoy = act(convoy, { type: 'FORM_CONVOY', vesselIds: [slowId, fastId] });
  const sailed = act(convoy, { type: 'DISPATCH_VESSEL', vesselId: fastId, destinationId: 'calais' });
  const slowLeg = sailed.vessels.find(v => v.id === slowId)!;
  const fastLeg = sailed.vessels.find(v => v.id === fastId)!;
  check('both convoy members sail', !!slowLeg.destination && !!fastLeg.destination);
  check('and arrive on the same week', slowLeg.weeksRemaining === fastLeg.weeksRemaining,
    `${slowLeg.weeksRemaining} vs ${fastLeg.weeksRemaining}`);
  check('at the slower hull’s pace, not the faster', fastLeg.weeksRemaining === carrackWeeks,
    `${fastLeg.weeksRemaining} vs carrack ${carrackWeeks}`);
}

// ---------------------------------------------------------------------------
console.log('\n4. THE SOFT-LOCK: content names ship_1 by id, and a fleet can sell it');
// ---------------------------------------------------------------------------
{
  // The four trigger sites, read out of content rather than hardcoded here, so a fifth added later
  // is covered by the same assertions.
  const pinned = EVENTS.filter(e => e.trigger?.vesselIdAt);
  check(`content pins specific hulls in ${pinned.length} triggers`, pinned.length >= 4, `${pinned.length}`);
  check('every one of them names ship_1',
    pinned.every(e => e.trigger!.vesselIdAt!.vesselId === 'ship_1'),
    pinned.map(e => e.trigger!.vesselIdAt!.vesselId).join(','));
  // The stale warning in the spec: these used to be `vesselKindAt`. Assert the migration held, or a
  // regression there silently reopens the *earlier* bug (wrong hull fires the homecoming).
  check('and none has regressed to a bare kind check',
    EVENTS.filter(e => e.trigger?.vesselKindAt).length === 0,
    `${EVENTS.filter(e => e.trigger?.vesselKindAt).length} still on vesselKindAt`);

  // GUARD 1 — a hull carrying live scripted business cannot be sold at all.
  const s = seed();
  const sailing = act(s, { type: 'DISPATCH_VESSEL', vesselId: SHIP, destinationId: 'calais' });
  check('a hull under way cannot be sold',
    threw(() => act(sailing, { type: 'SELL_VESSEL', vesselId: SHIP }))?.includes('under way') === true);
  const loaded = act(act(s, { type: 'BUY_GOOD', vesselId: SHIP, goodId: 'cloth', quantity: 3 }), { type: 'BUY_VESSEL', typeId: 'cog' });
  check('a hull with cargo aboard cannot be sold',
    threw(() => act(loaded, { type: 'SELL_VESSEL', vesselId: SHIP }))?.includes('carrying cargo') === true);
  let conv = act(s, { type: 'BUY_VESSEL', typeId: 'cog' });
  const mate = conv.vessels[conv.vessels.length - 1].id;
  conv = act(conv, { type: 'FORM_CONVOY', vesselIds: [SHIP, mate] });
  check('a hull in the convoy cannot be sold',
    threw(() => act(conv, { type: 'SELL_VESSEL', vesselId: SHIP }))?.includes('convoy') === true);
  const insured = { ...act(s, { type: 'BUY_VESSEL', typeId: 'cog' }), insurance: [{ vesselId: SHIP, routeId: 'r', coverage: 10, premiumPaid: 1 }] };
  check('a hull with a policy running cannot be sold',
    threw(() => act(insured, { type: 'SELL_VESSEL', vesselId: SHIP }))?.includes('policy') === true);
  const onExpedition = { ...act(s, { type: 'BUY_VESSEL', typeId: 'cog' }), expedition: { vesselId: SHIP, stage: 'outbound', weeksInStage: 0, conscienceSpent: 0 } } as unknown as GameState;
  check('the expedition’s own hull cannot be sold',
    threw(() => act(onExpedition, { type: 'SELL_VESSEL', vesselId: SHIP }))?.includes('expedition') === true);
  check('and the house can never sell its only hull',
    threw(() => act(s, { type: 'SELL_VESSEL', vesselId: SHIP }))?.includes('only hull') === true);

  // GUARD 2 — the trigger itself degrades, so a hull sold long after its chapter cannot orphan a
  // later one. This is the assertion that actually proves no soft-lock.
  const pinnedEvent = pinned.find(e => e.trigger!.vesselIdAt!.location === 'bruges')!;
  const trig = pinnedEvent.trigger!.vesselIdAt!;
  const base: GameState = {
    ...createInitialState('sl', 'SL', { skipPrologue: true }),
    firedEvents: EVENTS.filter(e => e.id !== pinnedEvent.id).map(e => e.id),
    pendingEvents: [],
    // `chapter0_complete` must survive: `checkTriggers` gates every non-prologue event on it, so
    // building the flag set from the trigger alone silently blocks the very event under test.
    flags: {
      chapter0_complete: true,
      ...Object.fromEntries([...(pinnedEvent.trigger!.flags ?? []), pinnedEvent.trigger!.flag]
        .filter(Boolean).map(f => [f as string, true])),
    },
  };
  // With ship_1 present but elsewhere: must NOT fire.
  const elsewhere = checkTriggers({ ...base, vessels: base.vessels.map(v => v.id === SHIP ? { ...v, location: 'naples' } : v) });
  check('the pinned trigger does not fire with ship_1 at the wrong port',
    !elsewhere.pendingEvents.includes(pinnedEvent.id));
  // With ship_1 present and there: fires.
  const there = checkTriggers({ ...base, vessels: base.vessels.map(v => v.id === SHIP ? { ...v, location: trig.location } : v) });
  check('and does fire with ship_1 at the right one', there.pendingEvents.includes(pinnedEvent.id));
  // ship_1 SOLD, replaced by a bought hull at the same port: must still be reachable, or the
  // chapter can never close.
  const replacement: Vessel = {
    id: 'ship_7', kind: 'ship', name: 'A later hull', location: trig.location,
    destination: null, routeId: null, weeksRemaining: 0, cargo: {}, capacity: 20, typeId: 'cog',
  };
  const afterSale = checkTriggers({ ...base, vessels: [...base.vessels.filter(v => v.id !== SHIP), replacement] });
  check('with ship_1 SOLD, a later hull at the same port still satisfies it',
    afterSale.pendingEvents.includes(pinnedEvent.id));
  // ...but only a ship. A courier idling at the home port must not fire a homecoming — that was the
  // original bug a bare `location` check caused, and the fallback must not reintroduce it.
  const courierOnly = checkTriggers({ ...base, vessels: base.vessels.filter(v => v.kind === 'courier').map(v => ({ ...v, location: trig.location })) });
  check('but the ever-present home courier alone does not', !courierOnly.pendingEvents.includes(pinnedEvent.id));
  const noneThere = checkTriggers({
    ...base,
    vessels: [...base.vessels.filter(v => v.id !== SHIP), { ...replacement, location: 'naples' }],
  });
  check('and neither does a later hull at the wrong port', !noneThere.pendingEvents.includes(pinnedEvent.id));
}

// ---------------------------------------------------------------------------
console.log('\n5. Upkeep: an overlarge fleet genuinely hurts');
// ---------------------------------------------------------------------------
{
  const s = seed();
  check('the starting fleet costs nothing new', fleetUpkeepPerWeek(s) === 0);
  check('because untyped hulls have no class to maintain', s.vessels.every(v => vesselUpkeep(v) === 0));

  const one = act(s, { type: 'BUY_VESSEL', typeId: 'carrack' });
  check('a bought hull draws upkeep', fleetUpkeepPerWeek(one) === findVesselType('carrack')!.upkeepPerWeek);
  const two = act(one, { type: 'BUY_VESSEL', typeId: 'galley' });
  check('and upkeep is the sum of the fleet',
    fleetUpkeepPerWeek(two) === findVesselType('carrack')!.upkeepPerWeek + findVesselType('galley')!.upkeepPerWeek);

  const before = two.cash;
  const advanced = act(two, { type: 'ADVANCE_WEEK' });
  check('ADVANCE_WEEK actually draws it', advanced.cash < before - fleetUpkeepPerWeek(two) + 1);
  check('and no hull is laid up while it can be paid', !advanced.vesselLaidUp);
  check('the fleet is intact', advanced.vessels.length === two.vessels.length);

  // Cannot pay: laid up, not repossessed — losing a 520f hull over an 8f shortfall would be a
  // punishment out of all proportion, and would remove the player's ability to earn it back.
  const broke = resolveWeeklyFleet({ ...two, cash: 0 }, 5);
  check('a shortfall lays a hull up rather than taking it', broke.vessels.length === two.vessels.length);
  check('and says which', broke.laidUp?.vesselName === two.vessels.find(v => v.typeId === 'carrack')!.name,
    broke.laidUp?.vesselName);
  check('the dearest hull is the one laid up', broke.laidUp?.week === 5);
  const laid = broke.vessels.find(v => v.name === broke.laidUp!.vesselName)!;
  check('a laid-up hull loses its class', laid.typeId === undefined);
  check('so it costs nothing further', vesselUpkeep(laid) === 0);
  check('and sails at the default speed again', vesselSpeed(laid) === 1);
  check('but keeps its hold — it is unmaintained, not scuttled', laid.capacity === findVesselType('carrack')!.capacity);
  check('only one hull is laid up per week', broke.vessels.filter(v => v.typeId === undefined).length
    === two.vessels.filter(v => v.typeId === undefined).length + 1);
  check('cash never goes negative', broke.cash >= 0);

  // Through the real pipeline, and reported for exactly one week.
  const laidThroughWeek = act({ ...two, cash: 0 }, { type: 'ADVANCE_WEEK' });
  check('ADVANCE_WEEK reports the lay-up with the new week',
    laidThroughWeek.vesselLaidUp?.week === laidThroughWeek.week, `${laidThroughWeek.vesselLaidUp?.week}`);
  check('and the next week clears the report',
    !act({ ...laidThroughWeek, cash: 5000 }, { type: 'ADVANCE_WEEK' }).vesselLaidUp);
}

// ---------------------------------------------------------------------------
console.log('\n6. Save compatibility, and a full fleet through a real year');
// ---------------------------------------------------------------------------
{
  const legacy = seed();
  delete (legacy as Partial<GameState>).vesselLaidUp;
  legacy.vessels = legacy.vessels.map(v => { const { typeId: _t, ...rest } = v; return rest as Vessel; });
  const advanced = act(legacy, { type: 'ADVANCE_WEEK' });
  check('a pre-Phase-28 save advances without throwing', advanced.week === legacy.week + 1);
  check('and is charged no upkeep it never agreed to', fleetUpkeepPerWeek(advanced) === 0);
  check('helpers are safe on an untyped hull',
    vesselSpeed(legacy.vessels[0]) === 1 && vesselUpkeep(legacy.vessels[0]) === 0 && resaleValue(legacy.vessels[0]) > 0);
  check('and a hull can still be bought on it', act(legacy, { type: 'BUY_VESSEL', typeId: 'cog' }).vessels.length === 3);

  // A five-hull fleet run for a year: nothing throws, upkeep bites, and the generic per-vessel
  // systems (voyage risk, sabotage, expedition) keep iterating cleanly over more hulls than the
  // campaign ever granted.
  let big = seed(6000);
  for (const t of ['cog', 'carrack', 'galley', 'courier']) big = act(big, { type: 'BUY_VESSEL', typeId: t });
  // Two to begin with (ship_1 and the courier) plus four bought.
  check('six hulls in the fleet', big.vessels.length === 6, `${big.vessels.length}`);
  const start = big.cash;
  for (let w = 0; w < 52; w++) big = act(big, { type: 'ADVANCE_WEEK' });
  check('a year with five hulls does not throw', big.week === 52);
  check('and an overlarge fleet genuinely costs', big.cash < start, `${Math.round(start)} -> ${Math.round(big.cash)}`);
  check('every hull still has a valid location', big.vessels.every(v => !!v.location || !!v.destination));
  check('and no hull has a negative passage', big.vessels.every(v => v.weeksRemaining >= 0));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
