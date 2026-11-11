/**
 * Scripted players for the campaign, used by campaign-check (one plan per mission, must win) and
 * campaign-sweep (many plans per mission, counts wins). They exist to answer one question: can this
 * mission be won, at this campaign difficulty, by a player who uses what the mission gives them?
 *
 * The base player: the skirmish commander runs side 0's economy and army (autopilot), held at home
 * until a chosen minute and then sent at the mission's own target; a script plays the heroes and the
 * support powers as a player would. Its commander never gets to attack on its own: left to itself,
 * it threw its whole army into the enemy's turrets at four and a half minutes in every base mission.
 *
 * Not a substitute for playing. A scripted player that loses proves little (it does not micro, and
 * its heroes go in on a timer); one that wins proves the mission can be won.
 */
import { campaignMission, heroesFor, missionContext, applyOutcome, newCampaign } from '../src/campaign/progression';
import { missionById, MISSIONS } from '../src/campaign/missions';
import type { CampaignState } from '../src/campaign/types';
import { processAction } from '../src/sim/actions';
import { distToBuilding } from '../src/sim/grid';
import { abilityProblem, createMissionState, powerProblem } from '../src/sim/mission';
import { BUILDINGS, type BuildingKind, type Difficulty, type HeroKind } from '../src/sim/rules';
import type { Building, GameState, MissionOutcome } from '../src/sim/types';

export interface PlayResult {
  mission: string;
  level: Difficulty;
  plan: string;
  result: 'won' | 'lost' | 'unfinished';
  ticks: number;
  lostBecause?: string;
}

/** The campaign on reaching this mission, every mission before it won, at this difficulty. */
export function campaignAt(id: string, level: Difficulty): CampaignState {
  let c: CampaignState = newCampaign('Player');
  for (const m of MISSIONS) {
    if (m.id === id) break;
    const heroes: MissionOutcome['heroes'] = {};
    for (const h of heroesFor(c, m)) heroes[h] = { xp: c.heroes[h].xp, alive: true };
    c = applyOutcome(c, m, { missionId: m.id, won: true, stars: 1, ticks: 6000, kills: 0, losses: 0, heroes });
  }
  return { ...c, difficulty: level };
}

/** The mission's opening battle, as the campaign would deploy it. */
export function startAt(id: string, level: Difficulty): GameState {
  const m = missionById(id)!;
  const c = campaignAt(id, level);
  return createMissionState(campaignMission(c, m), missionContext(c, m, `play-${id}-${level}`, 1000));
}

const centre = (b: Building) => ({ x: b.x + BUILDINGS[b.kind].w / 2, y: b.y + BUILDINGS[b.kind].h / 2 });
function nearest<T extends { x: number; y: number }>(list: T[], p: { x: number; y: number }): T | undefined {
  let best: T | undefined;
  let bestD = Infinity;
  for (const t of list) {
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}
const done = (s: GameState, level: Difficulty, id: string, plan: string): PlayResult => ({
  mission: id,
  level,
  plan,
  result: s.mission!.result ?? 'unfinished',
  ticks: s.tick,
  ...(s.mission!.lostBecause ? { lostBecause: s.mission!.lostBecause } : {}),
});

/** A base-mission plan: how strong the computer running side 0 plays, and the minute it attacks. */
export interface BasePlan {
  commander: Difficulty;
  attackAt: number;
}
export const BASE_PLANS: BasePlan[] = (['normal', 'hard'] as Difficulty[]).flatMap(commander => [0, 6, 8, 10, 12, 15].map(attackAt => ({ commander, attackAt })));
export const planName = (p: BasePlan) => `${p.commander} commander, attacks at ${p.attackAt || 'its own time'}${p.attackAt ? ' min' : ''}`;

/**
 * A base mission played by the skirmish commander and a hero script. attackAt 0: the commander
 * attacks when it chooses; otherwise it is held at home and the whole army is sent at the mission's
 * target (or the nearest enemy) from that minute.
 */
export function playBase(id: string, level: Difficulty, plan: BasePlan, maxMinutes = 45): PlayResult {
  let s = startAt(id, level);
  s.autopilot = true;
  s.autopilotDifficulty = plan.commander;
  const first = s.buildings.find(b => b.owner === 0);
  const home = first ? centre(first) : { x: 10, y: 54 };
  const attackAt = plan.attackAt * 600;
  // Heroes go in behind the army: alone at the start, they died within a minute and a half.
  const heroesGo = (plan.attackAt || 8) * 600 + 300;
  const enemyB = (kinds: BuildingKind[]) => s.buildings.filter(b => b.owner === 1 && b.hp > 0 && kinds.includes(b.kind));
  const goals = () =>
    s.mission!.objectives.flatMap(o => (!o.done && (o.spec.kind === 'destroy' || o.spec.kind === 'destroyWithin') ? [o.spec.building] : []));
  const useHero = (kind: HeroKind, prefs: BuildingKind[][]) => {
    const u = s.units.find(v => v.owner === 0 && v.kind === kind && v.hp > 0);
    if (!u) return;
    if (s.tick < heroesGo) {
      if (s.tick % 200 === 0) s = processAction(s, { type: 'move', ids: [u.id], x: home.x, y: home.y });
      return;
    }
    let t: Building | undefined;
    for (const p of prefs) {
      t = nearest(enemyB(p).map(b => ({ ...centre(b), b })), u)?.b;
      if (t) break;
    }
    if (!t) return;
    if (distToBuilding(u.x, u.y, t) <= 1) {
      if (u.hero!.abilityCd === 0 && !abilityProblem(s, 0, u.id, t.id)) s = processAction(s, { type: 'ability', id: u.id, target: t.id });
      else if (u.hero!.abilityCd > 0) s = processAction(s, { type: 'move', ids: [u.id], x: home.x, y: home.y });
    } else if (u.hero!.abilityCd < 120) {
      const c = centre(t);
      s = processAction(s, { type: 'move', ids: [u.id], x: c.x, y: c.y });
    }
  };

  while (!s.mission!.result && s.tick < maxMinutes * 600) {
    if (s.tick % 20 === 0) {
      useHero('commando', [goals(), ['factory'], ['strikecommand', 'techcentre'], ['turret', 'rocketturret'], ['power'], ['refinery', 'barracks', 'uplink', 'hq']]);
      useHero('spy', [['power']]);
      const ace = s.units.find(v => v.owner === 0 && v.kind === 'ace');
      if (ace && ace.hero!.abilityCd === 0 && ace.engage) s = processAction(s, { type: 'ability', id: ace.id });
      const target = nearest([...enemyB(['turret', 'rocketturret']).map(centre), ...s.units.filter(u => u.owner === 1)], home);
      for (const p of ['barrage', 'reinforce', 'recon', 'missile'] as const) {
        const at = p === 'reinforce' ? home : target;
        if (at && s.powers?.[0]?.[p] === 0 && !powerProblem(s, 0, p, at.x, at.y)) s = processAction(s, { type: 'power', power: p, x: at.x, y: at.y });
      }
    }
    // The commander will not train infantry where it may not build the tanks it wants (First Light
    // allows infantry only): it sat on 33,500 credits. Spend them as a player would.
    if (s.tick % 50 === 0 && s.players[0].credits > 8000 && s.buildings.some(b => b.owner === 0 && b.kind === 'barracks')) {
      for (const k of ['rifleman', 'rocketeer', 'rifleman'] as const) if (s.allowed?.includes(k)) s = processAction(s, { type: 'queue', category: 'infantry', kind: k });
    }
    if (attackAt) {
      s.ai[0].nextAttack = 1e9;
      if (s.tick >= attackAt && s.tick % 100 === 0) {
        const army = s.units.filter(u => u.owner === 0 && !u.hero && u.kind !== 'hauler');
        const lead = nearest(army, home) ?? home;
        const t = nearest(enemyB(goals()).map(centre), lead) ?? nearest([...s.buildings.filter(b => b.owner === 1).map(centre), ...s.units.filter(u => u.owner === 1)], lead);
        if (t && army.length) s = processAction(s, { type: 'move', ids: army.map(u => u.id), x: t.x, y: t.y, attackMove: true });
      }
    }
    s = processAction(s, { type: 'tick', n: 10 });
  }
  return done(s, level, id, planName(plan));
}

/**
 * The Quiet Man: the Spy walks to the Comms Uplink by one of three ways, goes in, and walks out to
 * the extraction point; the riflemen hold the extraction point, or shadow the Spy.
 */
export const QUIET_MAN_WAYS: Record<string, { x: number; y: number }[]> = {
  north: [{ x: 6, y: 40 }, { x: 8, y: 20 }, { x: 20, y: 3 }, { x: 40, y: 2 }, { x: 56, y: 2 }],
  middle: [{ x: 20, y: 40 }, { x: 35, y: 20 }, { x: 48, y: 4 }, { x: 56, y: 2 }],
  east: [{ x: 30, y: 55 }, { x: 62, y: 40 }, { x: 62, y: 10 }, { x: 58, y: 3 }],
};
export function playQuietMan(level: Difficulty, way: keyof typeof QUIET_MAN_WAYS, escort: 'extraction' | 'spy'): PlayResult {
  let s = startAt('quiet-man', level);
  const path = QUIET_MAN_WAYS[way];
  let wi = 0;
  let inside = false;
  const exit = { x: 3.5, y: 5.5 };
  while (!s.mission!.result && s.tick < 25 * 600) {
    const spy = s.units.find(u => u.owner === 0 && u.kind === 'spy');
    if (!spy) break;
    const rifles = s.units.filter(u => u.owner === 0 && u.kind === 'rifleman').map(u => u.id);
    const up = s.buildings.find(b => b.kind === 'uplink' && b.owner === 1);
    if (s.tick % 30 === 0 && rifles.length) {
      const to = escort === 'extraction' ? { x: 5.5, y: 8.5 } : { x: spy.x, y: spy.y + 3 };
      s = processAction(s, { type: 'move', ids: rifles, x: to.x, y: to.y, attackMove: true });
    }
    if (!inside && up) {
      if (wi < path.length) {
        const p = path[wi];
        if (s.tick % 20 === 0) s = processAction(s, { type: 'move', ids: [spy.id], x: p.x, y: p.y });
        if (Math.hypot(spy.x - p.x, spy.y - p.y) < 1.5) wi++;
      } else if (distToBuilding(spy.x, spy.y, up) <= 1) {
        if (!abilityProblem(s, 0, spy.id, up.id)) {
          s = processAction(s, { type: 'ability', id: spy.id, target: up.id });
          inside = true;
        }
      } else if (s.tick % 20 === 0) s = processAction(s, { type: 'move', ids: [spy.id], x: up.x + 1, y: up.y - 0.5 });
    } else {
      // Straight for the extraction point (he is quicker than the squad sent after him), stepping
      // off to the south, out of the squad's way, only while Combine troops stand on it.
      const held = s.units.some(u => u.owner === 1 && Math.hypot(u.x - exit.x, u.y - exit.y) < 3);
      const to = held ? { x: 3.5, y: 20.5 } : exit;
      if (s.tick % 20 === 0) s = processAction(s, { type: 'move', ids: [spy.id], x: to.x, y: to.y });
    }
    s = processAction(s, { type: 'tick', n: 5 });
  }
  return done(s, level, 'quiet-man', `${way} way, riflemen ${escort === 'extraction' ? 'hold the extraction point' : 'shadow the Spy'}`);
}

/**
 * Ace of Spades: the column takes the ridge and holds it, the Engineer behind the most damaged
 * tank, the Ace in overdrive when she is fighting. Then 'gather' (wait 30 seconds for the two tanks
 * the hold brings, then sweep), 'sweep' (attack-move at the nearest enemy at once) or 'turrets'
 * (straight at the turrets, one by one).
 */
export function playAceOfSpades(level: Difficulty, plan: 'gather' | 'sweep' | 'turrets'): PlayResult {
  let s = startAt('ace-of-spades', level);
  const ridge = { x: 32.5, y: 32.5 };
  let heldAt = Infinity;
  while (!s.mission!.result && s.tick < 30 * 600) {
    const mine = s.units.filter(u => u.owner === 0);
    const eng = mine.find(u => u.kind === 'engineer');
    const army = mine.filter(u => u.kind !== 'engineer');
    const ace = mine.find(u => u.kind === 'ace');
    if (ace && ace.hero!.abilityCd === 0 && ace.engage) s = processAction(s, { type: 'ability', id: ace.id });
    if (heldAt === Infinity && s.mission!.objectives[0].done) heldAt = s.tick;
    if (s.tick % 40 === 0) {
      const ids = army.map(u => u.id);
      if (s.tick < heldAt || (plan === 'gather' && s.tick < heldAt + 300)) s = processAction(s, { type: 'move', ids, x: ridge.x, y: ridge.y, attackMove: true });
      else {
        const lead = nearest(army, ridge) ?? ridge;
        const foes = [...s.units.filter(u => u.owner === 1), ...s.buildings.filter(b => b.owner === 1).map(b => ({ ...centre(b), id: b.id, kind: b.kind }))];
        const turret = plan === 'turrets' ? nearest(s.buildings.filter(b => b.owner === 1 && b.kind === 'turret').map(b => ({ ...centre(b), id: b.id })), lead) : undefined;
        if (turret) s = processAction(s, { type: 'attack', ids, target: turret.id });
        else {
          const t = nearest(foes, lead);
          if (t) s = processAction(s, { type: 'move', ids, x: t.x, y: t.y, attackMove: true });
        }
      }
      if (eng) {
        const tank = army.filter(u => u.kind === 'tank' || u.kind === 'ace').sort((a, b) => a.hp - b.hp)[0];
        if (tank) s = processAction(s, { type: 'move', ids: [eng.id], x: tank.x - 1, y: tank.y + 1 });
      }
      if (s.powers?.[0]?.recon === 0 && !powerProblem(s, 0, 'recon', 52, 10)) s = processAction(s, { type: 'power', power: 'recon', x: 52, y: 10 });
    }
    s = processAction(s, { type: 'tick', n: 10 });
  }
  return done(s, level, 'ace-of-spades', plan);
}
