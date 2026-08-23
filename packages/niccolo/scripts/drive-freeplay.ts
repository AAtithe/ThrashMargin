/**
 * Free play and the AI rivals (Phase 27) — the mode itself, and the three fairness rules the design
 * doc states as the *reason* an information-only difficulty model is honest.
 *
 * The old scripted driver for `aiTrader.ts` proved the engine in isolation (fresher information
 * wins 12/12 seeds, a bigger ship is an upgrade, its sales move the player's market). It was never
 * committed and the engine was never wired to anything. This driver covers the wiring, and re-pins
 * the fairness claims now that the trader reads real prices through the demand layer and sells
 * through `sellProceeds` — both of which it previously bypassed.
 */
import { createInitialState } from '../src/sim/state';
import { processAction } from '../src/sim/actions';
import { applyBackgroundFlows, deriveMarketCauses, driftScarcity, priceAt, sellProceeds } from '../src/sim/market';
import { AI_PROFILES, aiNetWorth, createAiTrader, refreshAiKnowledge, resolveAiWeek, seedHomeKnowledge } from '../src/sim/aiTrader';
import {
  FREEPLAY_START_CASH, FREEPLAY_TARGET_NET_WORTH, checkFreeplayWin, createRivals,
  isFreeplay, playerNetWorth, resolveFreeplayWeek, resolveWeeklyRivalPlants, standings,
} from '../src/sim/freeplay';
import { describeMarketCause } from '../src/components/marketCauseText';
import { CITIES } from '../src/sim/content';
import { findVesselType } from '../src/sim/shipyard';
import type { ActiveMarketEvent, AiTrader, GameState } from '../src/sim/types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
}

/** A deterministic LCG standing in for Math.random, so a claim about *which* opponent wins is a
 * claim about the model and not about the dice. */
function seededRandom(seed: number): () => number {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}
function withSeed<T>(seed: number, fn: () => T): T {
  const real = Math.random;
  Math.random = seededRandom(seed);
  try { return fn(); } finally { Math.random = real; }
}

function freeplay(rivals: 0 | 1 | 2 | 3 = 2): GameState {
  return createInitialState('fp', 'Test house', { freeplay: true, rivals });
}
const embargo = (cityId: string, goodId: string): ActiveMarketEvent => ({
  id: 'emb', templateId: 'me_guild_embargo', kind: 'guild_embargo', cityId, goodId,
  multiplier: 1, blocksTrade: true, startedWeek: 0, endsWeek: 99,
  headline: 'The guild has closed the trade.',
});
const festival = (cityId: string, goodId: string, multiplier: number): ActiveMarketEvent => ({
  id: 'fest', templateId: 'me_doge_wedding', kind: 'festival_demand', cityId, goodId,
  multiplier, blocksTrade: false, startedWeek: 0, endsWeek: 99,
  headline: 'A wedding nobody can ignore.',
});

// ---------------------------------------------------------------------------
console.log('\n1. The mode: what free play switches off, and on');
// ---------------------------------------------------------------------------
{
  const fp = freeplay();
  check('the state declares its mode', fp.mode === 'freeplay' && isFreeplay(fp));
  check('a campaign does not', !isFreeplay(createInitialState('c', 'C', { skipPrologue: true })));
  check('and neither does an older save with no mode field',
    !isFreeplay({ ...freeplay(), mode: undefined } as GameState));

  // The scripted layer is *absent*, not suppressed — the specific bug this guards is that free play
  // sets chapter0_complete (it unlocks wages and warehousing) and Chapter 1's opener triggers on
  // exactly that flag.
  check('no scripted event is queued at creation', fp.pendingEvents.length === 0, `${fp.pendingEvents.length}`);
  let stepped = fp;
  for (let i = 0; i < 12; i++) stepped = processAction(stepped, { type: 'ADVANCE_WEEK' });
  check('and none appears over twelve weeks', stepped.pendingEvents.length === 0, `${stepped.pendingEvents.length}`);
  check('nothing has fired at all', stepped.firedEvents.length === 0, stepped.firedEvents.join(','));
  check('no chapter flag has been set', !Object.keys(stepped.flags).some(f => /^chapter[1-8]_/.test(f)),
    Object.keys(stepped.flags).join(','));
  check('the campaign, by contrast, queues its opener at once',
    createInitialState('c', 'C', { skipPrologue: true }).pendingEvents.length > 0);

  check('objectives are hidden — they are chapter objectives and there are no chapters', fp.objectivesHidden === true);
  check('the player starts with working capital', fp.cash === FREEPLAY_START_CASH);
  check('a ship and a courier', fp.vessels.length === 2 && fp.vessels.some(v => v.kind === 'ship'));
  check('the standing systems are unlocked', fp.flags.chapter0_complete === true);
  check('and the week still advances normally', stepped.week === 12);
}

// ---------------------------------------------------------------------------
console.log('\n2. Rivals exist, are seated apart, and actually trade');
// ---------------------------------------------------------------------------
{
  check('two rivals by default', (freeplay().aiTraders ?? []).length === 2);
  check('three when asked', (freeplay(3).aiTraders ?? []).length === 3);
  check('none when asked for none', (freeplay(0).aiTraders ?? []).length === 0);
  const three = freeplay(3).aiTraders!;
  check('each rival sits in a different port',
    new Set(three.map(t => t.vessels[0].location)).size === 3, three.map(t => t.vessels[0].location).join(','));
  check('each has distinct capital', new Set(three.map(t => t.cash)).size === 3);
  check('each has a distinct information lag — the difficulty dial',
    new Set(three.map(t => t.reportLagWeeks)).size === 3, three.map(t => t.reportLagWeeks).join(','));
  check('no rival is omniscient', three.every(t => t.reportLagWeeks > 0));
  check('each knows only its own home market at the start',
    three.every(t => Object.keys(t.remembered).length === 1
      && t.remembered[t.vessels[0].location] !== undefined));

  // They must really trade when the clock runs, not merely exist.
  const traded = withSeed(7, () => {
    let s = freeplay(2);
    let notes = 0;
    for (let i = 0; i < 60; i++) { s = processAction(s, { type: 'ADVANCE_WEEK' }); notes += (s.lastAiNotes ?? []).length; }
    return { s, notes };
  });
  check('rivals trade over sixty weeks', traded.notes > 20, `${traded.notes} trades`);
  check('and compound their capital',
    traded.s.aiTraders!.some(t => aiNetWorth(t, traded.s.scarcity, traded.s.marketEvents) > 700),
    traded.s.aiTraders!.map(t => aiNetWorth(t, traded.s.scarcity, traded.s.marketEvents)).join('/'));
  check('they explore beyond home', traded.s.aiTraders!.every(t => Object.keys(t.remembered).length > 1),
    traded.s.aiTraders!.map(t => Object.keys(t.remembered).length).join('/'));
  check('the week report never accumulates', (traded.s.lastAiNotes ?? []).length < 20);
  check('a campaign runs the rival step for nothing',
    (processAction(createInitialState('c', 'C', { skipPrologue: true }), { type: 'ADVANCE_WEEK' }).lastAiNotes ?? []).length === 0);
}

// ---------------------------------------------------------------------------
console.log('\n3. The three fairness rules, re-pinned after the Phase 27 rewiring');
// ---------------------------------------------------------------------------
{
  const base = freeplay(1);
  const trader = base.aiTraders![0];

  // RULE 1 — it never reads a market it has not reached. This was got wrong once (accidental
  // omniscience) and is the whole basis of the difficulty model.
  const refreshed = refreshAiKnowledge(trader, base.scarcity, 100, base.marketEvents);
  const marketCities = CITIES.filter(c => c.market && Object.keys(c.market).length > 0).length;
  check('an enormous lag does not reveal unvisited cities',
    Object.keys(refreshed.remembered).length < marketCities,
    `${Object.keys(refreshed.remembered).length} of ${marketCities}`);
  check('it knows only where it has stood', Object.keys(refreshed.remembered).length === 1);

  // RULE 2 — it trades on the prices the player trades on. The demand layer was the gap: `priceAt`
  // without `events` omits the demand factor entirely, so a trader reading that way would remember
  // and act on numbers no player can transact at.
  const feasted = { ...base, marketEvents: [festival('venice', 'silk', 2.0)] };
  const withDemand = seedHomeKnowledge(
    createAiTrader({ ...AI_PROFILES.steady, id: 'x', name: 'X', homeCity: 'venice' }),
    feasted.scarcity, 0, feasted.marketEvents,
  );
  const withoutDemand = seedHomeKnowledge(
    createAiTrader({ ...AI_PROFILES.steady, id: 'y', name: 'Y', homeCity: 'venice' }),
    feasted.scarcity, 0, undefined,
  );
  const playerPrice = priceAt(feasted.scarcity, 'venice', 'silk', feasted.marketEvents)!;
  check('a demand event really moves the price the player pays',
    playerPrice > priceAt(feasted.scarcity, 'venice', 'silk')!, `${playerPrice}`);
  check('the rival remembers the price the PLAYER would pay',
    withDemand.remembered.venice.prices.silk === playerPrice,
    `${withDemand.remembered.venice.prices.silk} vs ${playerPrice}`);
  check('and would have remembered a fiction without the demand layer threaded through',
    withoutDemand.remembered.venice.prices.silk !== playerPrice);

  // RULE 2b — its selling is priced by the same function the player's is (Phase 26's fix). Before
  // this the AI got snapshot-times-quantity, i.e. a systematically better price than the player for
  // the identical trade.
  const loaded: AiTrader = {
    ...trader,
    vessels: [{ ...trader.vessels[0], location: 'venice', cargo: { silk: 6 }, destination: null }],
    remembered: { venice: { week: 0, prices: { silk: 1 } } },
  };
  const before = loaded.cash;
  const result = resolveAiWeek(loaded, base.scarcity, 1, base.marketEvents);
  const sold = (result.notes.find(n => n.direction === -1)?.quantity) ?? 0;
  if (sold > 0) {
    const playerWouldGet = sellProceeds(base.scarcity, 'venice', 'silk', sold, base.marketEvents)!.revenue;
    check('the rival realises exactly what the player would for the same sale',
      Math.abs((result.trader.cash - before) - playerWouldGet) < 0.001,
      `${(result.trader.cash - before).toFixed(3)} vs ${playerWouldGet.toFixed(3)}`);
    const snapshot = priceAt(base.scarcity, 'venice', 'silk')! * sold;
    check('which is strictly less than the snapshot price it used to get',
      playerWouldGet < snapshot, `${playerWouldGet.toFixed(1)} vs ${snapshot}`);
  } else {
    check('the rival realises exactly what the player would for the same sale', false, 'it did not sell');
    check('which is strictly less than the snapshot price it used to get', false, 'it did not sell');
  }

  // RULE 2c — its buying moves no price, exactly as the player's does not. Needs beliefs about a
  // *second* market to buy against: a trader that knows only where it is standing has no run to
  // plan and correctly explores instead of buying.
  const buying = resolveAiWeek(
    {
      ...trader,
      cash: 2000,
      vessels: [{ ...trader.vessels[0], location: 'bruges', cargo: {}, destination: null }],
      remembered: {
        bruges: { week: 1, prices: { cloth: 20 } },
        london: { week: 1, prices: { cloth: 200 } },
      },
    },
    base.scarcity, 1, base.marketEvents,
  );
  const bought = buying.notes.filter(n => n.direction === 1);
  if (bought.length > 0) {
    check('a rival buying moves no price at all',
      bought.every(n => priceAt(buying.scarcity, n.cityId, n.goodId, base.marketEvents)
        === priceAt(base.scarcity, n.cityId, n.goodId, base.marketEvents)));
  } else {
    check('a rival buying moves no price at all', false, 'it bought nothing');
  }

  // RULE 3 — a closed market is closed to it too.
  const closed = { ...base, marketEvents: [embargo('venice', 'silk')] };
  const seeded = seedHomeKnowledge(
    createAiTrader({ ...AI_PROFILES.steady, id: 'z', name: 'Z', homeCity: 'venice' }),
    closed.scarcity, 0, closed.marketEvents,
  );
  check('an embargoed good is not even remembered', seeded.remembered.venice.prices.silk === undefined);
  check('though the rest of that market still is', Object.keys(seeded.remembered.venice.prices).length > 0);
  const blockedRun = resolveAiWeek(
    { ...seeded, cash: 2000, vessels: [{ ...seeded.vessels[0], cargo: { silk: 6 } }] },
    closed.scarcity, 1, closed.marketEvents,
  );
  check('and it cannot sell into a market an event has closed',
    !blockedRun.notes.some(n => n.goodId === 'silk' && n.cityId === 'venice'));
}

// ---------------------------------------------------------------------------
console.log('\n4. Rivals crowd each other, and are named in the price narration');
// ---------------------------------------------------------------------------
{
  // Threaded in turn, not resolved against one snapshot — otherwise any number of rivals could sell
  // into a market at its untouched price, which is Phase 26's snapshot bug one level up.
  const base = freeplay(0);
  const mk = (id: string): AiTrader => ({
    ...createAiTrader({ ...AI_PROFILES.steady, id, name: id, homeCity: 'venice' }),
    vessels: [{ ...createAiTrader({ ...AI_PROFILES.steady, id, name: id, homeCity: 'venice' }).vessels[0], cargo: { silk: 6 } }],
    remembered: { venice: { week: 0, prices: { silk: 1 } } },
  });
  const first = mk('A'), second = mk('B');
  const one = resolveAiWeek(first, base.scarcity, 1, base.marketEvents);
  const two = resolveAiWeek(second, one.scarcity, 1, base.marketEvents);
  const firstGain = one.trader.cash - first.cash;
  const secondGain = two.trader.cash - second.cash;
  check('two rivals selling the same good into the same port crowd each other',
    secondGain < firstGain, `${firstGain.toFixed(1)} then ${secondGain.toFixed(1)}`);
  const together = resolveFreeplayWeek({ ...base, aiTraders: [first, second] }, 1);
  check('resolveFreeplayWeek threads them in turn, matching the manual chain',
    Math.abs(together.aiTraders[1].cash - two.trader.cash) < 0.001);
  check('and reports both sets of trades', together.notes.length === one.notes.length + two.notes.length);

  // Narration: a rival's trade must be named, not filed as anonymous "unknown flows".
  const causes = deriveMarketCauses(base.scarcity, base.scarcity, base.scarcity, together.scarcity, [], together.notes);
  const rivalNotes = Object.values(causes).flat().filter(c => c.kind === 'rival_trade');
  check('a rival trade is attributed to the rival', rivalNotes.length > 0, JSON.stringify(causes).slice(0, 120));
  if (rivalNotes.length > 0) {
    check('and names them', !!rivalNotes[0].houseName);
    const text = describeMarketCause(rivalNotes[0], 'Venice');
    check('the narration reads as competition, not scenery', /bidding against/.test(text), text);
    check('with no placeholder left unfilled', !/\{\w+\}/.test(text));
  } else {
    check('and names them', false); check('the narration reads as competition, not scenery', false);
    check('with no placeholder left unfilled', false);
  }
}

// ---------------------------------------------------------------------------
console.log('\n5. Standings and the win condition');
// ---------------------------------------------------------------------------
{
  const s = freeplay(2);
  const table = standings(s);
  check('the table holds the player and every rival', table.length === 3);
  check('exactly one row is the player', table.filter(r => r.isPlayer).length === 1);
  check('sorted richest first', table.every((r, i) => i === 0 || table[i - 1].netWorth >= r.netWorth));
  check('the player is named from the save', table.find(r => r.isPlayer)!.name === 'Test house');
  check('an unnamed house still gets a label',
    standings({ ...s, name: undefined }).find(r => r.isPlayer)!.name.length > 0);
  check('ordering is stable across repeat calls', JSON.stringify(standings(s)) === JSON.stringify(standings(s)));

  // The player's own figure: cash, cargo, stored goods, the hulls, and obligations both ways.
  // Asserted as *deltas* from the opening figure rather than against a literal, so Phase 28 adding
  // hull value to the balance sheet does not make four arithmetic assertions read as failures when
  // the arithmetic is fine.
  const opening = playerNetWorth(s);
  check('net worth opens above the starting cash, because the hulls count',
    opening > FREEPLAY_START_CASH, `${opening} vs ${FREEPLAY_START_CASH} cash`);
  const owing = { ...s, obligations: [{ id: 'o', kind: 'bill' as const, direction: 'payable' as const, amount: 100, currency: 'florin', dueWeek: 20, settled: false, counterparty: 'x' }] } as GameState;
  check('a payable subtracts', playerNetWorth(owing) === opening - 100);
  const owed = { ...owing, obligations: owing.obligations.map(o => ({ ...o, direction: 'receivable' as const })) };
  check('a receivable adds', playerNetWorth(owed) === opening + 100);
  check('a settled obligation counts for nothing',
    playerNetWorth({ ...owing, obligations: owing.obligations.map(o => ({ ...o, settled: true })) }) === opening);
  // And buying a hull must not read as a loss — the reason hulls are counted at all.
  const withHull = processAction(s, { type: 'BUY_VESSEL', typeId: 'cog' });
  check('converting cash into a hull is not a fall in the standings',
    playerNetWorth(withHull) > opening - findVesselType('cog')!.cost,
    `${playerNetWorth(withHull)} vs ${opening}`);

  // Win condition.
  check('nobody has won at week zero', checkFreeplayWin(s).winners.length === 0 && !checkFreeplayWin(s).playerWon);
  // Headroom over the weekly commitments (wages, and anything else advanceWeek draws) — at
  // target + 1 the very upkeep run that precedes the win check pulls the house back under it.
  const rich = { ...s, cash: FREEPLAY_TARGET_NET_WORTH + 500 };
  check('the player crossing the line wins', checkFreeplayWin(rich).playerWon);
  const richRival: GameState = {
    ...s, aiTraders: s.aiTraders!.map((t, i) => (i === 0 ? { ...t, cash: FREEPLAY_TARGET_NET_WORTH + 1 } : t)),
  };
  const rivalWin = checkFreeplayWin(richRival);
  check('a rival crossing it wins too', rivalWin.winners.length === 1 && !rivalWin.playerWon);
  check('and the winner is named', rivalWin.winners[0].name === s.aiTraders![0].name);

  // Recorded by ADVANCE_WEEK, once, and it does NOT stop the clock.
  const won = processAction(rich, { type: 'ADVANCE_WEEK' });
  check('the win week is stamped', won.freeplayWonWeek === won.week, `${won.freeplayWonWeek}`);
  const after = processAction(won, { type: 'ADVANCE_WEEK' });
  check('the clock keeps running afterwards — a sandbox has no story to end', after.week === won.week + 1);
  check('and the stamp is never rewritten', after.freeplayWonWeek === won.freeplayWonWeek);
  check('a campaign never stamps it',
    processAction(createInitialState('c', 'C', { skipPrologue: true }), { type: 'ADVANCE_WEEK' }).freeplayWonWeek === undefined);
  check('the target is a real climb from the starting capital', FREEPLAY_TARGET_NET_WORTH > FREEPLAY_START_CASH * 15);
}

// ---------------------------------------------------------------------------
console.log('\n6. The difficulty model, re-measured after the Phase 27 rewiring');
// ---------------------------------------------------------------------------
{
  // The claims below were originally established by an *uncommitted* driver against the old
  // snapshot sell pricing. Phase 26 changed what every sale realises and Phase 27 put the AI on
  // that same function, so none of it could be assumed to still hold — and one of them did not.
  //
  // `resolveAiWeek` never calls Math.random itself, so the market has to be moved between weeks the
  // way `advanceWeek` moves it, or every "seed" is the same deterministic run. That mistake made
  // the first attempt at this section report 0/12 from what was really a sample of one.
  const runTrader = (lag: number, capacity: number, cash: number, seed: number): number =>
    withSeed(seed, () => {
      const base = freeplay(0);
      let t = seedHomeKnowledge(
        createAiTrader({ startingCash: cash, reportLagWeeks: lag, shipCapacity: capacity, id: 't', name: 'T', homeCity: 'bruges' }),
        base.scarcity, 0, base.marketEvents,
      );
      let scarcity = base.scarcity;
      for (let w = 1; w <= 80; w++) {
        scarcity = driftScarcity(applyBackgroundFlows(scarcity));
        const r = resolveAiWeek(t, scarcity, w, base.marketEvents);
        t = r.trader; scarcity = r.scarcity;
      }
      return aiNetWorth(t, scarcity, base.marketEvents);
    });

  // CLAIM 1 — fresher information alone wins. Identical capital and hull; only the lag differs.
  // This is the design's central claim and the whole justification for an information-only
  // difficulty model, so it is asserted at strength rather than as "not worse".
  // CLAUDE.md's own earned rule: "win-rate comparisons need 150+ seeds. At 20 the noise is about
  // ±10 points and at 40 about ±8; three difficulty levels once read as non-monotonic purely from
  // sampling." An 80-week run is cheap here, so there is no reason to sit under that bar.
  const SEEDS = 150;
  let sharper = 0;
  for (let i = 1; i <= SEEDS; i++) {
    if (runTrader(2, 20, 600, i * 977) > runTrader(10, 20, 600, i * 977)) sharper++;
  }
  console.log(`       measured: fresher information (lag 2 vs lag 10) wins ${sharper}/${SEEDS}`);
  check(`fresher information alone wins ${SEEDS} seeds`, sharper >= SEEDS * 0.7, `${sharper}/${SEEDS}`);

  // The inversion this guards against was real and its cause was the opposite of what it looked
  // like: with only exploration as a fallback, a well-informed trader that had just crushed its own
  // market saw that accurately, found no positive margin, and *sat* — while an ignorant one still
  // believed the old price and traded anyway. Staler information won 23 of 24 seeds. Accuracy was
  // being punished with idleness, which `sailTowardBestKnownMarket` is the fix for.
  check('and it is not merely a coin flip', sharper > SEEDS * 0.6, `${sharper}/${SEEDS}`);

  // CLAIM 2 — the three shipped profiles are ordered in strength. This is what the player actually
  // meets, so it matters more than any single component of the dial.
  const PROFILE_SEEDS = 150;
  let ordered = 0, ruthlessOverSteady = 0;
  for (let i = 1; i <= PROFILE_SEEDS; i++) {
    const seed = i * 613;
    const c = runTrader(AI_PROFILES.cautious.reportLagWeeks, AI_PROFILES.cautious.shipCapacity, AI_PROFILES.cautious.startingCash, seed);
    const st = runTrader(AI_PROFILES.steady.reportLagWeeks, AI_PROFILES.steady.shipCapacity, AI_PROFILES.steady.startingCash, seed);
    const r = runTrader(AI_PROFILES.ruthless.reportLagWeeks, AI_PROFILES.ruthless.shipCapacity, AI_PROFILES.ruthless.startingCash, seed);
    if (r > st) ruthlessOverSteady++;
    if (r > st && st > c) ordered++;
  }
  console.log(`       measured: ruthless>steady ${ruthlessOverSteady}/${PROFILE_SEEDS}, all three ordered ${ordered}/${PROFILE_SEEDS}`);
  check('ruthless beats steady on essentially every seed', ruthlessOverSteady >= PROFILE_SEEDS * 0.95,
    `${ruthlessOverSteady}/${PROFILE_SEEDS}`);
  check('and the three profiles come out fully ordered', ordered >= PROFILE_SEEDS * 0.9,
    `${ordered}/${PROFILE_SEEDS}`);

  // CLAIM 3, recorded as a KNOWN LIMIT rather than asserted as a win. Extra hull beyond what a
  // market can absorb and what cash can fill is worth very little in this economy: a single good is
  // capped at ABSORBABLE_UNITS and selling is metered, so a large hull mostly buys time in port. The
  // old driver's "a bigger ship is an upgrade, 10/12" was measured when a big load sold at one
  // untouched snapshot price; it does not survive honest pricing, and the same diminishing return
  // shows up in capital (the cautious trader compounds at a *higher multiple* than the ruthless one
  // and still never catches it in absolute terms). Asserted only as "not catastrophic", which is
  // what the game actually needs — the profiles are ordered by capital, and capital does work.
  let biggerNotWorseByMuch = 0;
  const HULL_SEEDS = 60;
  for (let i = 1; i <= HULL_SEEDS; i++) {
    const seed = i * 811;
    if (runTrader(4, 30, 600, seed) > runTrader(4, 12, 600, seed) * 0.75) biggerNotWorseByMuch++;
  }
  console.log(`       measured: a 30-unit hull holds within 25% of a 12-unit hull on ${biggerNotWorseByMuch}/${HULL_SEEDS}`);
  check('a larger hull is at least not a serious handicap',
    biggerNotWorseByMuch >= HULL_SEEDS * 0.7, `${biggerNotWorseByMuch}/${HULL_SEEDS}`);
}

// ---------------------------------------------------------------------------
console.log('\n6b. Planting false news on a rival — §6\'s last deferred verb');
// ---------------------------------------------------------------------------
{
  const base = freeplay(2);
  const rivalId = base.aiTraders![0].id;

  // Placement is validated against the rivals actually in this game — buying an agent against a
  // trader that is not there would be money spent on something that could never act.
  check('an agent can be placed inside a rival',
    processAction({ ...base, cash: 900 }, { type: 'PLACE_AGENT', placement: { type: 'rival', traderId: rivalId }, name: 'A clerk' })
      .agents.some(a => a.placement.type === 'rival'));
  check('but not inside a rival that is not in this game',
    (() => { try { processAction({ ...base, cash: 900 }, { type: 'PLACE_AGENT', placement: { type: 'rival', traderId: 'rival_nowhere' } }); return false; } catch (e) { return /no such rival/i.test((e as Error).message); } })());
  const once = processAction({ ...base, cash: 900 }, { type: 'PLACE_AGENT', placement: { type: 'rival', traderId: rivalId } });
  check('and never twice inside the same one',
    (() => { try { processAction({ ...once, cash: 900 }, { type: 'PLACE_AGENT', placement: { type: 'rival', traderId: rivalId } }); return false; } catch (e) { return /already has somebody/i.test((e as Error).message); } })());
  check('a campaign has no rivals to place against',
    (() => { try { processAction({ ...createInitialState('c', 'C', { skipPrologue: true }), cash: 900, pendingEvents: [] }, { type: 'PLACE_AGENT', placement: { type: 'rival', traderId: 'rival_venice' } }); return false; } catch { return true; } })());

  // The lie itself. Forced to land, and forced to miss, rather than hoping the dice cooperate.
  const withAgent: GameState = {
    ...base,
    agents: [{ id: 'a1', name: 'A clerk in Venice', placement: { type: 'rival', traderId: rivalId }, placedWeek: 0 }],
    aiTraders: base.aiTraders!.map(t => t.id === rivalId
      ? { ...t, remembered: { ...t.remembered, london: { week: 0, prices: { cloth: 100, wool: 50 } } } }
      : t),
  };
  const real = Math.random;
  let landed: ReturnType<typeof resolveWeeklyRivalPlants> | null = null;
  let missed: ReturnType<typeof resolveWeeklyRivalPlants> | null = null;
  try {
    Math.random = () => 0.01; // below the chance, and picks the first candidate city
    landed = resolveWeeklyRivalPlants(withAgent, 12);
    Math.random = () => 0.99; // above the chance
    missed = resolveWeeklyRivalPlants(withAgent, 12);
  } finally { Math.random = real; }

  check('a landed plant is reported', !!landed!.plant, JSON.stringify(landed!.plant));
  check('and names the rival, the city and the agent',
    !!landed!.plant && landed!.plant.traderName.length > 0 && landed!.plant.cityName.length > 0
      && landed!.plant.agentName === 'A clerk in Venice');
  const before = withAgent.aiTraders!.find(t => t.id === rivalId)!.remembered;
  const after = landed!.aiTraders.find(t => t.id === rivalId)!.remembered;
  const changedCity = Object.keys(after).find(c => JSON.stringify(after[c]) !== JSON.stringify(before[c]))!;
  check('exactly one city’s books are corrupted',
    Object.keys(after).filter(c => JSON.stringify(after[c]) !== JSON.stringify(before[c])).length === 1);
  check('the prices there really moved',
    Object.keys(after[changedCity].prices).some(g => after[changedCity].prices[g] !== before[changedCity].prices[g]));
  check('and no price is ever bent to zero or below',
    Object.values(after[changedCity].prices).every(p => p >= 1));
  check('a missed roll changes nothing at all',
    !missed!.plant && JSON.stringify(missed!.aiTraders) === JSON.stringify(withAgent.aiTraders));
  check('and no agent means no plant, ever',
    !resolveWeeklyRivalPlants(base, 12).plant);

  // The rival’s home market is never lied to it about — it is standing in it. Same rule
  // `corruptNews` applies to the player's own home city.
  const home = base.aiTraders!.find(t => t.id === rivalId)!.vessels[0].location;
  check('a rival is never deceived about the market it is standing in', changedCity !== home,
    `${changedCity} vs home ${home}`);

  // **The property that makes this fair.** The lie is stamped fresh so it survives, but only for
  // that rival's own report lag — so a sharper opponent shakes it off sooner. The difficulty dial
  // doing the work in a third place, with no special case.
  check('the lie is stamped with the current week, so it is not refreshed away on the same tick',
    after[changedCity].week === 12, `${after[changedCity].week}`);
  const trader = landed!.aiTraders.find(t => t.id === rivalId)!;
  const stillLying = refreshAiKnowledge(trader, base.scarcity, 12 + trader.reportLagWeeks - 1, base.marketEvents);
  const washedOut = refreshAiKnowledge(trader, base.scarcity, 12 + trader.reportLagWeeks, base.marketEvents);
  check('it survives inside the rival’s report lag',
    JSON.stringify(stillLying.remembered[changedCity]) === JSON.stringify(after[changedCity]));
  check('and washes out the week that lag expires',
    JSON.stringify(washedOut.remembered[changedCity]) !== JSON.stringify(after[changedCity]));

  // Wired into the real pipeline, not merely callable.
  const stepped = processAction({ ...withAgent, cash: 900 }, { type: 'ADVANCE_WEEK' });
  check('ADVANCE_WEEK runs the plant step without throwing', stepped.week === withAgent.week + 1);
  check('and a campaign runs it for nothing',
    processAction({ ...createInitialState('c2', 'C', { skipPrologue: true }), pendingEvents: [] }, { type: 'ADVANCE_WEEK' }).lastRivalPlant == null);
}

// ---------------------------------------------------------------------------
console.log('\n7. Save compatibility, and the campaign left untouched');
// ---------------------------------------------------------------------------
{
  const created = createInitialState('c', 'C', { skipPrologue: true });
  // A campaign opens with Chapter 1's own event already queued, and `processAction` correctly
  // refuses everything but RESOLVE_EVENT until it is answered — so clear it first, or this is a
  // test of the event gate rather than of save compatibility.
  const legacy = created.pendingEvents.length > 0
    ? processAction(created, { type: 'RESOLVE_EVENT', eventId: created.pendingEvents[0], choiceIndex: 0 })
    : created;
  delete (legacy as Partial<GameState>).mode;
  delete (legacy as Partial<GameState>).aiTraders;
  delete (legacy as Partial<GameState>).lastAiNotes;
  const advanced = processAction(legacy, { type: 'ADVANCE_WEEK' });
  check('a pre-Phase-27 save advances without throwing', advanced.week === legacy.week + 1,
    `week ${advanced.week} from ${legacy.week}, ${legacy.pendingEvents.length} pending`);
  check('and stays a campaign', !isFreeplay(advanced));
  check('helpers are safe on an absent field',
    standings(legacy).length === 1 && resolveFreeplayWeek(legacy, 1).notes.length === 0);
  check('a campaign save keeps firing its own content', advanced.firedEvents.length > 0,
    `${advanced.firedEvents.length} fired`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
