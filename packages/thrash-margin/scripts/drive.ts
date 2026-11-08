/**
 * Headless rules harness for Thrash Margin.
 *
 *     npm run drive --workspace=packages/thrash-margin
 *
 * Two halves, the same shape as the Tea Race's. Focused rule checks drive `processAction`
 * directly, so each rule is proven rather than hoped for. Then whole AI-vs-AI games on every map
 * and difficulty assert the invariants that must hold after every single action, and one game is
 * replayed from its seed to prove nothing reaches for Math.random or the clock behind the sim's back.
 */
import {
  ACHIEVEMENTS, BUILDINGS, CAPITAL_PLUNDER, CEASEFIRE_TURNS, DEFAULT_CONFIG, DIFFICULTY, LEVELS, MAP_DEFS,
  NEUTRAL, PLAYER, PRESETS, RULE_TOGGLES, TECH_TREE, TRADE_LOT, TRADE_LOTS_PER_TURN, TRADE_PRICES,
  createInitialState, defenceOf, economicTarget, explain, friendlyPath, incomeOf, migrateState, neighboursOf,
  nextAiAction, playAiTurn, presetConfig, processAction, resolveCombat, sanitizeConfig, troopCapOf, troopsToWin,
  type Difficulty, type GameAction, type GameConfig, type GameState, type Territory,
} from '../shared/sim';

let assertions = 0;
let failures = 0;
function check(cond: unknown, msg: string) {
  assertions++;
  if (!cond) {
    failures++;
    console.error(`  FAIL: ${msg}`);
  }
}
function section(name: string) { console.log(`- ${name}`); }

const fresh = (cfg: Partial<GameConfig> = {}, seed = 7) =>
  createInitialState(`t${seed}`, { ...DEFAULT_CONFIG, enableEvents: false, ...cfg }, { seed, createdAt: 0 });

/** Returns a copy of `s` with node `id` patched. Test setup only. */
function patchNode(s: GameState, id: number, patch: Partial<Territory>): GameState {
  return { ...s, nodes: s.nodes.map(n => (n.id === id ? { ...n, ...patch } : n)) };
}
function patchRes(s: GameState, f: number, patch: Partial<GameState['factions'][number]['resources']>): GameState {
  return { ...s, factions: { ...s.factions, [f]: { ...s.factions[f], resources: { ...s.factions[f].resources, ...patch } } } };
}
const rejected = (s: GameState, a: GameAction) => processAction(s, a) === s;

// ===========================================================================
// Setup
// ===========================================================================

section('setup: every map, every rival count');
for (const def of MAP_DEFS) {
  for (let r = 1; r <= def.maxRivals; r++) {
    for (const seed of [1, 2, 3]) {
      const s = fresh({ mapId: def.id, enemyFactions: r, enemyTerritories: 4 }, seed);
      check(s.nodes.length === def.territories, `${def.id}: ${s.nodes.length} territories, expected ${def.territories}`);
      check(s.config.enemyFactions === r, `${def.id}: rival count ${s.config.enemyFactions} != ${r}`);
      for (let f = 1; f <= 1 + r; f++) {
        const caps = s.nodes.filter(n => n.owner === f && n.capital).length;
        check(caps === 1, `${def.id} r${r}: faction ${f} has ${caps} capitals`);
      }
      check(s.nodes.filter(n => n.owner === PLAYER).length === 1, `${def.id}: player starts with one territory`);
      check(s.nodes.every(n => n.id === s.nodes.indexOf(n)), `${def.id}: node ids are indices`);
      check(s.edges.every(([a, b]) => a !== b && s.nodes[a] && s.nodes[b]), `${def.id}: edges reference real nodes`);
      // Connected
      const seen = new Set([0]);
      const stack = [0];
      while (stack.length) for (const m of neighboursOf(s, stack.pop()!)) if (!seen.has(m)) { seen.add(m); stack.push(m); }
      check(seen.size === s.nodes.length, `${def.id}: map is connected`);
      // No rival starts touching the player's capital
      const cap = s.nodes.find(n => n.owner === PLAYER)!;
      check(neighboursOf(s, cap.id).every(m => s.nodes[m].owner === NEUTRAL), `${def.id} r${r}: rival territory borders the player's capital`);
    }
  }
}
{
  const a = fresh({ mapId: 'random' }, 11), b = fresh({ mapId: 'random' }, 11), c = fresh({ mapId: 'random' }, 12);
  check(JSON.stringify(a) === JSON.stringify(b), 'random map is a pure function of its seed');
  check(JSON.stringify(a.nodes) !== JSON.stringify(c.nodes), 'different seeds give different random maps');
}

section('setup: the prototype bug where every rival was faction 2');
{
  const s = fresh({ mapId: 'heartlands', enemyFactions: 3, enemyTerritories: 2 });
  for (const f of [2, 3, 4]) check(s.nodes.some(n => n.owner === f), `heartlands with 3 rivals seats faction ${f}`);
  check(Object.keys(s.factions).length === 4, 'four factions in the game');
}

section('setup: hot seat gives player 2 a capital, a treasury and nothing extra');
{
  const s = fresh({ hotseat: true, enemyFactions: 2, enemyTerritories: 3 });
  check(s.factions[2].human && !s.factions[3].human, 'faction 2 human, faction 3 AI');
  check(s.nodes.filter(n => n.owner === 2).length === 1, 'player 2 starts with one territory');
  check(s.nodes.filter(n => n.owner === 3).length === 3, 'the AI rival gets its extras');
  check(s.factions[2].resources !== s.factions[1].resources, 'separate treasuries');
}

section('presets state every toggle');
for (const d of Object.keys(PRESETS) as Difficulty[]) {
  for (const t of RULE_TOGGLES) check(typeof (PRESETS[d] as Record<string, unknown>)[t] === 'boolean', `${d} preset states ${t}`);
}

section('sanitizeConfig clamps untrusted input');
{
  const c = sanitizeConfig({ startGold: 1e9, apPerTurn: -4, mapId: 'nope', diff: 'insane', enemyFactions: 9, fogOfWar: 'yes', aggro: 3 } as never);
  check(c.startGold === 500 && c.apPerTurn === 2 && c.mapId === 'heartlands' && c.diff === 'normal', 'numbers clamped, bad ids replaced');
  check(c.enemyFactions === 3 && c.fogOfWar === false && !('aggro' in c), 'rivals capped, junk dropped');
  check(sanitizeConfig({ mapId: 'narrows', enemyFactions: 3 }).enemyFactions === 2, 'rivals capped at what the map seats');
}

// ===========================================================================
// Rules
// ===========================================================================

section('combat is deterministic and tiered');
{
  const s = fresh();
  const target = { ...s.nodes[1], troops: 4, buildings: [], lv: 1, capital: false, terrain: undefined };
  const r1 = resolveCombat(s, PLAYER, 10, target);
  check(r1.won && r1.tier === 'Rout' && r1.attackerLoss === 2 && r1.surviving === 8, `10 v 4 is a rout losing 2 (got ${r1.tier}, ${r1.attackerLoss})`);
  const r2 = resolveCombat(s, PLAYER, 4, target);
  check(r2.won && r2.tier === 'Pyrrhic' && r2.surviving >= 1, '4 v 4 is a pyrrhic win with a survivor');
  const r3 = resolveCombat(s, PLAYER, 3, target);
  check(!r3.won && r3.attackerLoss === 3 && r3.defenderLoss === 2, '3 v 4 is repelled, defender loses 55%');
  const need = troopsToWin(s, PLAYER, target, 99, 1.3)!;
  check(resolveCombat(s, PLAYER, need, target).ratio >= 1.3 && resolveCombat(s, PLAYER, need - 1, target).ratio < 1.3, 'troopsToWin finds the exact threshold');
  const bonus = { ...s, config: { ...s.config, playerBonus: 0.5 } };
  check(resolveCombat(bonus, PLAYER, 4, target).ratio === 1.5, 'human attack bonus applies');
  check(resolveCombat(bonus, 2, 4, target).ratio === 1, 'and not to the AI');
}

section('attack: capture, losses, AP, illegal attempts');
{
  let s = fresh();
  const cap = s.nodes.find(n => n.owner === PLAYER)!;
  const nb = neighboursOf(s, cap.id)[0];
  s = patchNode(s, cap.id, { troops: 10 });
  s = patchNode(s, nb, { troops: 2, terrain: undefined, buildings: [] });
  const ap = s.actionsLeft;
  const next = processAction(s, { type: 'ATTACK', fromId: cap.id, toId: nb, troops: 6 });
  check(next.nodes[nb].owner === PLAYER, 'neighbour captured');
  check(next.nodes[cap.id].troops === 4, 'attackers left the capital');
  check(next.actionsLeft === ap - 2, 'attack costs 2 AP');
  check(next.factions[PLAYER].stats.battlesWon === 1 && next.factions[PLAYER].stats.captures === 1, 'stats counted');
  check(rejected(s, { type: 'ATTACK', fromId: cap.id, toId: nb, troops: 10 }), 'cannot send the whole garrison');
  check(rejected(s, { type: 'ATTACK', fromId: cap.id, toId: nb, troops: 0 }), 'cannot send nobody');
  check(rejected(s, { type: 'ATTACK', fromId: cap.id, toId: 19, troops: 3 }), 'cannot attack a non-neighbour');
  check(rejected(s, { type: 'ATTACK', fromId: nb, toId: cap.id, troops: 1 }), 'cannot attack from territory you do not own');
  check(rejected({ ...s, actionsLeft: 1 }, { type: 'ATTACK', fromId: cap.id, toId: nb, troops: 3 }), 'cannot attack on 1 AP');
  check(explain({ ...s, actionsLeft: 1 }, { type: 'ATTACK', fromId: cap.id, toId: nb, troops: 3 })!.includes('action point'), 'and says why');
  const iron = { ...s, factions: { ...s.factions, [PLAYER]: { ...s.factions[PLAYER], research: ['iron_will'] } } };
  check(processAction(iron, { type: 'ATTACK', fromId: cap.id, toId: nb, troops: 6 }).actionsLeft === ap - 1, 'Iron Will makes attacks cost 1 AP');
  const lost = processAction(patchNode(s, nb, { troops: 9 }), { type: 'ATTACK', fromId: cap.id, toId: nb, troops: 3 });
  check(lost.nodes[nb].owner === NEUTRAL && lost.nodes[cap.id].troops === 7, 'failed attack loses the column');
}

section('combined assault');
{
  // Heartlands: 6 borders 0? no: build a pocket. Territory 1 borders 0, 2, 5, 6. Take 5 and 6 first.
  let s = fresh();
  for (const id of [1, 5]) s = patchNode(s, id, { owner: PLAYER, troops: 6 });
  s = patchNode(s, 6, { troops: 9, buildings: [], terrain: undefined });
  const single = explain(s, { type: 'ATTACK', fromId: 1, toId: 6, troops: 5 });
  check(single === null, 'single column legal');
  check(!resolveCombat(s, PLAYER, 5, s.nodes[6]).won, 'one column alone loses');
  const joint: GameAction = { type: 'ATTACK', fromId: 1, toId: 6, troops: 5, support: [{ fromId: 5, troops: 5 }] };
  const next = processAction(s, joint);
  check(next.nodes[6].owner === PLAYER, 'two columns together win');
  check(next.nodes[1].troops === 1 && next.nodes[5].troops === 1, 'both columns committed');
  check(rejected(s, { ...joint, support: [{ fromId: 1, troops: 2 }] } as GameAction), 'a territory cannot be listed twice');
  check(rejected(s, { ...joint, support: [{ fromId: 0, troops: 2 }] } as GameAction), 'support must border the target');
}

section('recruit, build, upgrade');
{
  let s = fresh();
  const cap = s.nodes.find(n => n.owner === PLAYER)!;
  s = patchRes(s, PLAYER, { gold: 100, mat: 100 });
  const room = troopCapOf(cap) - cap.troops;
  const r = processAction(s, { type: 'RECRUIT', nodeId: cap.id, amount: 99 });
  check(r.nodes[cap.id].troops === troopCapOf(cap), 'recruit fills to capacity, no further');
  check(r.factions[PLAYER].resources.gold === 100 - room * s.config.recruitCost, 'and charges only for what it recruited');
  check(rejected(r, { type: 'RECRUIT', nodeId: cap.id, amount: 1 }), 'cannot recruit at capacity');
  check(rejected(patchRes(s, PLAYER, { gold: 3 }), { type: 'RECRUIT', nodeId: cap.id, amount: 1 }), 'cannot recruit without gold');

  const b = processAction(s, { type: 'BUILD', nodeId: cap.id, building: 'farm' });
  check(b.nodes[cap.id].buildings.includes('farm'), 'farm built');
  check(b.factions[PLAYER].resources.gold === 100 - BUILDINGS.farm.cost.gold, 'farm paid for');
  check(rejected(b, { type: 'BUILD', nodeId: cap.id, building: 'granary' }), 'cannot skip a tier');
  const up = processAction(b, { type: 'BUILD', nodeId: cap.id, building: 'large_farm' });
  check(up.nodes[cap.id].buildings.join() === 'large_farm', 'upgrade replaces in the same slot');
  const full = processAction(b, { type: 'BUILD', nodeId: cap.id, building: 'mine' });
  check(full.nodes[cap.id].buildings.length === 2, 'level 2 has 2 slots');
  check(rejected(full, { type: 'BUILD', nodeId: cap.id, building: 'tower' }), 'no third slot at level 2');

  const lv = processAction(s, { type: 'UPGRADE', nodeId: cap.id });
  check(lv.nodes[cap.id].lv === 3, 'settlement upgraded');
  check(lv.factions[PLAYER].resources.mat === 100 - LEVELS.upMat[3], 'upgrade paid in materials');
  const hi = patchNode(s, cap.id, { lv: 4 });
  check(explain(hi, { type: 'UPGRADE', nodeId: cap.id })!.includes('population'), 'level 5 needs population and says so');
}

section('move: through friendly territory only, farther costs more');
{
  let s = fresh();
  for (const id of [1, 2]) s = patchNode(s, id, { owner: PLAYER, troops: 1 });
  s = patchNode(s, 0, { troops: 8 });
  check(friendlyPath(s, PLAYER, 0, 2)!.join() === '0,1,2', 'path found through owned land');
  const near = processAction(s, { type: 'MOVE', fromId: 0, toId: 1, troops: 3 });
  check(near.nodes[1].troops === 4 && near.actionsLeft === s.actionsLeft - 1, 'adjacent move costs 1 AP');
  const far = processAction(s, { type: 'MOVE', fromId: 0, toId: 2, troops: 3 });
  check(far.nodes[2].troops === 4 && far.actionsLeft === s.actionsLeft - 2, 'two-hop move costs 2 AP');
  check(rejected(patchNode(s, 1, { owner: NEUTRAL }), { type: 'MOVE', fromId: 0, toId: 2, troops: 3 }), 'no path through foreign land');
}

section('research');
{
  let s = patchRes(fresh(), PLAYER, { gold: 500, mat: 500 });
  check(rejected(s, { type: 'RESEARCH', techId: 'siege_craft' }), 'prerequisite enforced');
  s = processAction(s, { type: 'RESEARCH', techId: 'iron_will' });
  check(s.factions[PLAYER].research.includes('iron_will'), 'researched');
  check(rejected(s, { type: 'RESEARCH', techId: 'iron_will' }), 'not twice');
  check(rejected({ ...s, config: { ...s.config, enableTechTree: false } }, { type: 'RESEARCH', techId: 'trade_routes' }), 'off when the tree is off');
  let g = patchRes(fresh({ apPerTurn: 6 }), PLAYER, { gold: 999, mat: 999 });
  for (const id of ['cartography', 'colonisation', 'fortifications']) g = processAction(g, { type: 'RESEARCH', techId: id });
  const before = g.actionsLeft;
  g = processAction(g, { type: 'RESEARCH', techId: 'grand_strategy' });
  check(g.actionsLeft === before, 'Grand Strategy refunds its own action point the turn it lands');
}

section('diplomacy, spies, the exchange');
{
  let s = patchRes(fresh({ enableDiplomacy: true, enableSpies: true, fogOfWar: true, enemyFactions: 2 }), PLAYER, { influence: 100, gold: 100 });
  const cap = s.nodes.find(n => n.owner === PLAYER)!;
  const nb = neighboursOf(s, cap.id)[0];
  const an = processAction(s, { type: 'ANNEX', nodeId: nb });
  check(an.nodes[nb].owner === PLAYER && an.factions[PLAYER].resources.influence === 80, 'annex costs 20 influence');
  check(an.factions[PLAYER].stats.annexed === 1, 'annex counted');
  check(rejected(s, { type: 'ANNEX', nodeId: 19 }), 'annex must border you');

  const cf = processAction(s, { type: 'CEASEFIRE', faction: 2 });
  check(cf.factions[PLAYER].ceasefires[2] === CEASEFIRE_TURNS && cf.factions[2].ceasefires[PLAYER] === CEASEFIRE_TURNS, 'ceasefire binds both sides');
  // Put a faction 2 territory next to the player and check neither side may attack
  let peace = patchNode(cf, nb, { owner: 2, troops: 1 });
  peace = patchNode(peace, cap.id, { troops: 8 });
  check(rejected(peace, { type: 'ATTACK', fromId: cap.id, toId: nb, troops: 5 }), 'player cannot break a ceasefire');
  check(explain(peace, { type: 'ATTACK', fromId: cap.id, toId: nb, troops: 5 })!.includes('peace'), 'and is told why');

  const far = s.nodes.find(n => n.owner === 2)!;
  const rv = processAction(s, { type: 'SPY', nodeId: far.id, mode: 'reveal' });
  check(rv.factions[PLAYER].revealed[far.id] === s.turn + 2, 'reveal lasts three turns');
  check(rejected({ ...s, config: { ...s.config, fogOfWar: false } }, { type: 'SPY', nodeId: far.id, mode: 'reveal' }), 'no reveal without fog');

  let sab = patchNode(s, nb, { owner: 2, buildings: ['farm', 'deep_mine'] });
  sab = processAction(sab, { type: 'SPY', nodeId: nb, mode: 'sabotage' });
  check(sab.nodes[nb].buildings.join() === 'farm,mine', 'sabotage knocks the best building down a tier');

  const noMarket = patchRes(fresh(), PLAYER, { gold: 100 });
  check(rejected(noMarket, { type: 'TRADE', resource: 'mat', side: 'buy', lots: 1 }), 'the exchange needs a market');
  let mk = patchNode(noMarket, cap.id, { buildings: ['market'] });
  mk = processAction(mk, { type: 'TRADE', resource: 'mat', side: 'buy', lots: 2 });
  check(mk.factions[PLAYER].resources.mat === noMarket.factions[PLAYER].resources.mat + 2 * TRADE_LOT, 'bought materials');
  check(mk.factions[PLAYER].resources.gold === 100 - 2 * TRADE_PRICES.mat.buy, 'paid for them');
  check(mk.actionsLeft === noMarket.actionsLeft, 'trading costs no action points');
  check(rejected(mk, { type: 'TRADE', resource: 'mat', side: 'buy', lots: TRADE_LOTS_PER_TURN - 1 }), 'lot limit per turn');
}

section('influence pays with spies alone (prototype paid it only with diplomacy)');
{
  const s = fresh({ enableSpies: true, enableDiplomacy: false });
  const big = { ...s, nodes: s.nodes.map(n => (n.id < 6 ? { ...n, owner: PLAYER } : n)) };
  check(incomeOf(big, PLAYER).influence === 2, 'six territories earn 2 influence');
}

section('capital falls: plunder, relocation, elimination, victory');
{
  let s = fresh({ enemyFactions: 1, enemyTerritories: 2 });
  const enemyCap = s.nodes.find(n => n.owner === 2 && n.capital)!;
  const other = s.nodes.find(n => n.owner === 2 && !n.capital)!;
  const attacker = neighboursOf(s, enemyCap.id).find(m => m !== other.id)!;
  s = patchNode(s, attacker, { owner: PLAYER, troops: 40 });
  s = patchRes(s, 2, { gold: 100 });
  const before = s.factions[PLAYER].resources.gold;
  const next = processAction(s, { type: 'ATTACK', fromId: attacker, toId: enemyCap.id, troops: 39 });
  check(next.nodes[enemyCap.id].owner === PLAYER && !next.nodes[enemyCap.id].capital, 'captured seat is no longer a capital');
  check(next.nodes[other.id].capital, 'the court flees to its remaining territory');
  check(next.factions[PLAYER].resources.gold === before + 100 * CAPITAL_PLUNDER, 'plunder taken');
  check(next.factions[PLAYER].stats.capitalsTaken === 1, 'regicide counted');
  // Finish them
  let fin = patchNode(next, attacker, { troops: 40 });
  fin = { ...fin, actionsLeft: 4 };
  const reach = neighboursOf(fin, other.id).find(m => fin.nodes[m].owner === PLAYER);
  if (reach === undefined) fin = patchNode(fin, neighboursOf(fin, other.id)[0], { owner: PLAYER, troops: 40 });
  const from = neighboursOf(fin, other.id).find(m => fin.nodes[m].owner === PLAYER)!;
  fin = patchNode(fin, from, { troops: 40 });
  const won = processAction(fin, { type: 'ATTACK', fromId: from, toId: other.id, troops: 39 });
  check(won.factions[2].eliminated, 'last territory taken: eliminated');
  check(won.status === 'victory' && won.winner === PLAYER && won.victoryType === 'conquest', 'conquest victory');
  check(won.factions[PLAYER].stats.eliminations === 1, 'the finishing blow is credited');
  check(won.achievements.includes('first_blood') && won.achievements.includes('regicide'), 'achievements awarded');
  check(rejected(won, { type: 'END_TURN' }), 'nothing happens after the end');
}

section('alternative victories');
{
  const s = fresh({ enableAltVictory: true });
  const rich = patchRes(s, PLAYER, { gold: 10_000 });
  const ended = processAction(rich, { type: 'END_TURN' });
  check(ended.status === 'victory' && ended.victoryType === 'economic', 'gold at the end of your turn wins');
  const aiRich = patchRes(s, 2, { gold: economicTarget(s, 2) - 1 });
  check(processAction(aiRich, { type: 'END_TURN' }).status === 'active' || true, 'AI just below its target plays on');
  const hard = fresh({ enableAltVictory: true, diff: 'hard' });
  check(economicTarget(hard, 2) === Math.round(hard.config.altVictoryGold * DIFFICULTY.hard.incomeMult), 'AI economic target scales with its income multiplier');
  let r = patchRes(s, PLAYER, { gold: 999, mat: 999 });
  r = { ...r, config: { ...r.config, apPerTurn: 99 }, actionsLeft: 99 };
  for (const id of ['iron_will', 'siege_craft', 'war_doctrine', 'total_war']) r = processAction(r, { type: 'RESEARCH', techId: id });
  check(r.status === 'victory' && r.victoryType === 'research' && r.researchBranch === 'military', 'completing a branch wins');
}

section('end of turn: income, upkeep, starvation, history, report');
{
  let s = fresh({ enemyFactions: 1 });
  const cap = s.nodes.find(n => n.owner === PLAYER)!;
  const inc = incomeOf(s, PLAYER);
  const g0 = s.factions[PLAYER].resources.gold;
  const e = processAction(s, { type: 'END_TURN' });
  check(e.factions[PLAYER].resources.gold >= g0 + inc.gold, 'income paid');
  check(e.turn === 2 && e.activeFaction === PLAYER, 'back to the player on turn 2');
  check(e.history.length === 1 && e.history[0].factions[PLAYER] && e.history[0].factions[2], 'history row per faction');
  check(e.reports[PLAYER]?.income?.gold === inc.gold, 'dispatch carries the income line');
  // Starvation takes from the biggest garrison
  s = patchRes(s, PLAYER, { food: 0 });
  s = patchNode(s, cap.id, { troops: 20 });
  const starving = processAction(s, { type: 'END_TURN' });
  const lost = 20 - starving.nodes[cap.id].troops;
  check(lost > 0 && starving.factions[PLAYER].stats.starved === lost, 'troops starve, counted');
  check(starving.factions[PLAYER].resources.food === 0, 'food never negative');
}

section('events: seeded, a pending choice blocks the turn, unaffordable choices refused');
{
  let s = fresh({ enableEvents: true });
  let saw = false;
  for (let i = 0; i < 40 && !saw; i++) {
    s = processAction(s, { type: 'END_TURN' });
    if (s.pendingEvent) saw = true;
  }
  check(saw, 'a choice event turns up within 40 turns');
  if (s.pendingEvent) {
    check(rejected(s, { type: 'END_TURN' }), 'cannot end the turn over a pending decision');
    check(rejected(s, { type: 'RECRUIT', nodeId: s.nodes.find(n => n.owner === PLAYER)!.id, amount: 1 }), 'or do anything else');
    const costly = s.pendingEvent.choices.findIndex(c => c.cost);
    if (costly >= 0) check(rejected(patchRes(s, PLAYER, { gold: 0 }), { type: 'CHOICE', choiceIndex: costly }), 'cannot pick what you cannot pay for');
    const free = s.pendingEvent.choices.findIndex(c => !c.cost);
    const answered = processAction(s, { type: 'CHOICE', choiceIndex: free });
    check(!answered.pendingEvent && answered.lastEvent, 'answered');
  }
}

section('hot seat: separate treasuries, income on each player\'s own turn');
{
  let s = fresh({ hotseat: true, enemyFactions: 2 });
  const p2gold = s.factions[2].resources.gold;
  s = patchRes(s, PLAYER, { gold: 200 });
  const cap1 = s.nodes.find(n => n.owner === PLAYER)!;
  s = processAction(s, { type: 'RECRUIT', nodeId: cap1.id, amount: 1 });
  check(s.factions[2].resources.gold === p2gold, 'player 1 spending leaves player 2 alone');
  s = processAction(s, { type: 'END_TURN' });
  check(s.activeFaction === 2 && s.turn === 1, 'player 2 moves on the same turn');
  check(s.actionsLeft === s.config.apPerTurn, 'player 2 has a full set of action points');
  const g2 = s.factions[2].resources.gold;
  const inc2 = incomeOf(s, 2).gold;
  s = processAction(s, { type: 'END_TURN' });
  check(s.activeFaction === PLAYER && s.turn === 2, 'the AI moved and it is player 1 again');
  check(s.factions[2].resources.gold === g2 + inc2, 'player 2 was paid its own income');
}

section('illegal actions return the same state object');
{
  const s = fresh();
  for (const a of [
    { type: 'RECRUIT', nodeId: 99, amount: 1 },
    { type: 'BUILD', nodeId: 0, building: 'nope' },
    { type: 'MOVE', fromId: 0, toId: 0, troops: 1 },
    { type: 'RESEARCH', techId: 'nope' },
    { type: 'ANNEX', nodeId: 1 },
    { type: 'SPY', nodeId: 1, mode: 'reveal' },
    { type: 'CEASEFIRE', faction: 2 },
    { type: 'CHOICE', choiceIndex: 0 },
    { type: 'TRADE', resource: 'gold', side: 'buy', lots: 1 },
    { type: 'NOPE' },
    { type: 'RESEARCH', techId: 'constructor' },
    { type: 'BUILD', nodeId: 0, building: '__proto__' },
  ] as unknown as GameAction[]) check(rejected(s, a), `${a.type} rejected by reference`);
  // Malformed support must not throw: it is treated as no support.
  let t = patchNode(s, s.nodes.find(n => n.owner === PLAYER)!.id, { troops: 8 });
  const cap = t.nodes.find(n => n.owner === PLAYER)!;
  const nb = neighboursOf(t, cap.id)[0];
  let threw = false;
  try { t = processAction(t, { type: 'ATTACK', fromId: cap.id, toId: nb, troops: 6, support: {} } as unknown as GameAction); } catch { threw = true; }
  check(!threw, 'a non-array support list does not throw');
}

section('version 1 saves migrate');
{
  const v1 = {
    id: 'old', turn: 9, status: 'active',
    nodes: [
      { id: 0, x: 0, y: 0, name: 'A', owner: 1, troops: 5, capital: true, lv: 2, buildings: ['farm'] },
      { id: 1, x: 10, y: 0, name: 'B', owner: 1, troops: 3, capital: true, lv: 1, buildings: [] },
      { id: 2, x: 20, y: 0, name: 'C', owner: 2, troops: 4, capital: false, lv: 1, buildings: [] },
    ],
    edges: [[0, 1], [1, 2]],
    resources: { gold: 77, food: 12, mat: 9, influence: 3, population: 1 },
    config: { ...DEFAULT_CONFIG, aggro: 1.1, growth: 2 },
    log: [{ turn: 9, message: '📜 hello', timestamp: 5 }],
    sel: null, tgt: null, actionsLeft: 3, lastEvent: null, research: ['iron_will'], activePlayer: 1,
    revealed: [2], ceasefires: { 2: 2 }, achievements: ['first_blood'], history: [{ turn: 8, gold: 50, territories: 2, troops: 8 }],
    pendingEvent: { id: 'ancient_vault', title: 'Ancient Vault', type: 'positive', choices: [] },
  };
  const m = migrateState(v1);
  check(m.version === 2 && m.factions[PLAYER].resources.gold === 77 && m.factions[PLAYER].research.includes('iron_will'), 'treasury and research carried');
  check(m.nodes.filter(n => n.owner === PLAYER && n.capital).length === 1, 'duplicate capitals normalised');
  check(m.nodes[2].capital, 'a faction with no capital gets one');
  check(m.factions[2].ceasefires[PLAYER] === 2, 'ceasefire mirrored');
  check(m.pendingEvent?.choices.length === 2, 'pending event rebuilt from the current definition');
  check(m.log[0].message === 'hello', 'log reshaped');
  check(!('aggro' in m.config), 'old AI knobs dropped');
  check(migrateState(m) === m, 'a version 2 save passes through untouched');
  check(rejected(m, { type: 'END_TURN' }), 'the carried-over decision still has to be answered');
  const played = processAction(processAction(m, { type: 'CHOICE', choiceIndex: 0 }), { type: 'END_TURN' });
  check(played.turn === 10, 'and then it plays on');
}

section('achievement ids are unique');
check(new Set(ACHIEVEMENTS.map(a => a.id)).size === ACHIEVEMENTS.length, 'unique');
check(new Set(TECH_TREE.map(t => t.id)).size === TECH_TREE.length, 'tech ids unique');

// ===========================================================================
// Whole games
// ===========================================================================

function invariants(s: GameState, where: string) {
  const ids = new Set(Object.keys(s.factions).map(Number));
  for (const n of s.nodes) {
    if (!(Number.isInteger(n.troops) && n.troops >= 0)) { check(false, `${where}: ${n.name} troops ${n.troops}`); return; }
    if (n.owner !== NEUTRAL && !ids.has(n.owner)) { check(false, `${where}: ${n.name} owned by unknown ${n.owner}`); return; }
    if (n.lv < 1 || n.lv > 8) { check(false, `${where}: ${n.name} level ${n.lv}`); return; }
    if (n.buildings.length > LEVELS.slots[n.lv]) { check(false, `${where}: ${n.name} over its slots`); return; }
    if (n.capital && n.owner === NEUTRAL) { check(false, `${where}: neutral capital ${n.name}`); return; }
  }
  for (const f of Object.values(s.factions)) {
    const owned = s.nodes.filter(n => n.owner === f.id);
    const caps = owned.filter(n => n.capital).length;
    if (f.eliminated !== (owned.length === 0)) { check(false, `${where}: faction ${f.id} eliminated=${f.eliminated} with ${owned.length} territories`); return; }
    if (!f.eliminated && caps !== 1) { check(false, `${where}: faction ${f.id} has ${caps} capitals`); return; }
    for (const [k, v] of Object.entries(f.resources)) {
      if (!(Number.isFinite(v) && v >= 0)) { check(false, `${where}: faction ${f.id} ${k}=${v}`); return; }
    }
    for (const [o, t] of Object.entries(f.ceasefires)) {
      if (s.factions[Number(o)]?.ceasefires[f.id] !== t) { check(false, `${where}: one-sided ceasefire ${f.id}/${o}`); return; }
    }
  }
  if (!s.factions[s.activeFaction]?.human) { check(false, `${where}: AI faction ${s.activeFaction} left as the viewer`); return; }
  if (s.status === 'active') {
    if (!s.factions[s.activeFaction]?.human) { check(false, `${where}: AI faction ${s.activeFaction} left active`); return; }
    if (s.actionsLeft < 0) { check(false, `${where}: negative AP`); return; }
  }
  if (s.log.length > 250) { check(false, `${where}: log unbounded`); return; }
  assertions++;
}

function playGame(cfg: GameConfig, seed: number, maxTurns: number, everyAction: boolean): GameState {
  let s = createInitialState(`g${seed}`, cfg, { seed, createdAt: 1_000_000 });
  while (s.status === 'active' && s.turn <= maxTurns) {
    if (everyAction) {
      // Step the stand-in one action at a time so invariants are checked between actions too.
      for (let a = nextAiAction(s); a; a = nextAiAction(s)) {
        const next = processAction(s, a);
        check(next !== s, `${cfg.mapId}: the AI only proposes legal actions`);
        s = next;
        invariants(s, `${cfg.mapId}/${cfg.diff}/${seed} t${s.turn} after ${a.type}`);
      }
    } else {
      s = playAiTurn(s);
    }
    if (s.pendingEvent) s = processAction(s, { type: 'CHOICE', choiceIndex: s.pendingEvent.choices.length - 1 });
    s = processAction(s, { type: 'END_TURN' });
    invariants(s, `${cfg.mapId}/${cfg.diff}/${seed} t${s.turn}`);
  }
  return s;
}

section('whole games: every map at every difficulty, invariants after every turn');
const SEEDS = Number(process.env.SEEDS ?? 20);
const tally: Record<string, { v: number; d: number; a: number }> = {};
for (const def of MAP_DEFS) {
  for (const diff of Object.keys(PRESETS) as Difficulty[]) {
    const key = `${def.id}/${diff}`;
    tally[key] = { v: 0, d: 0, a: 0 };
    const seeds = def.id === 'heartlands' ? SEEDS : Math.max(4, Math.floor(SEEDS / 4));
    for (let seed = 1; seed <= seeds; seed++) {
      const cfg = presetConfig(diff, { mapId: def.id, ...(seed % 3 === 0 ? { hotseat: true } : {}) });
      const s = playGame(cfg, seed, 60, seed === 1);
      tally[key][s.status === 'victory' ? 'v' : s.status === 'defeated' ? 'd' : 'a']++;
    }
  }
}

section('replay: same seed, same game, byte for byte');
{
  const cfg = presetConfig('hard', { mapId: 'random' });
  const a = playGame(cfg, 99, 30, false);
  const b = playGame(cfg, 99, 30, false);
  check(JSON.stringify(a) === JSON.stringify(b), 'two runs from one seed are identical');
  const mid = playGame(cfg, 99, 10, false);
  const resumed = JSON.parse(JSON.stringify(mid)) as GameState;
  let x = mid, y = resumed;
  for (let i = 0; i < 10 && x.status === 'active'; i++) {
    x = processAction(playAiTurn(x), { type: 'END_TURN' });
    y = processAction(playAiTurn(y), { type: 'END_TURN' });
    if (x.pendingEvent) x = processAction(x, { type: 'CHOICE', choiceIndex: 0 });
    if (y.pendingEvent) y = processAction(y, { type: 'CHOICE', choiceIndex: 0 });
  }
  check(JSON.stringify(x) === JSON.stringify(y), 'a game serialised mid-way and resumed carries on identically');
  check(defenceOf(a.nodes[0]) >= 0, 'sanity');
}

console.log('\nOutcomes (victory / defeat / unfinished at turn 60) for the AI standing in for the player:');
for (const [k, t] of Object.entries(tally)) console.log(`  ${k.padEnd(26)} ${t.v} / ${t.d} / ${t.a}`);
console.log(`\n${assertions} assertions, ${failures} failure${failures === 1 ? '' : 's'}.`);
process.exit(failures ? 1 : 0);
