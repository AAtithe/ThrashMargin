/**
 * Generals (fireline-round6-design.md, workstream C). Two layers, both off by default.
 *
 * Doctrine Generals: each seat may fight under one of its army's two Generals
 * (`setup.generalPicks`). The pick becomes that side's Perks when the battle is made (side 0's in
 * `s.perks`, the rest in `s.sidePerks`, read through perksFor), plus a few prices on some kinds
 * alone and, for the Air doctrine, a quicker rearm, both read from here.
 *
 * The field General (`setup.generals`, advanced tech only): one General unit per side, trained at
 * the Barracks. Its command aura marks its own side's units within GENERAL_AURA_RANGE every
 * GENERAL_AURA_TICKS (like the Medic's scan), and a marked unit hits harder and fires faster
 * (tick.ts, beside veterancy). A mark is a mark: two Generals never stack. If the General falls, the
 * aura goes with it and the doctrine counts at half strength (the perks replaced, never edited in
 * place) until a replacement arrives; a replacement may be queued GENERAL_REPLACE_TICKS after the fall.
 *
 * Pure, like the rest of src/sim: no Math.random, no clock. A computer seat's doctrine, when the
 * setup leaves it to chance, comes from a generator seeded from rngSeed and a constant, never from
 * the battle's own stream, so nothing else in the battle moves.
 */
import {
  GENERAL_AURA_DAMAGE,
  GENERAL_AURA_RANGE,
  GENERAL_AURA_RELOAD,
  GENERAL_AURA_TICKS,
  GENERAL_FACTION,
  GENERAL_IDS,
  GENERAL_REPLACE_TICKS,
  GENERALS,
  UNITS,
  type BuildingKind,
  type GeneralId,
  type GeneralSpec,
  type Owner,
  type SkirmishSetup,
  type UnitKind,
  type Weapon,
} from './rules';
import { next } from './rng';
import { sidesOf } from './sides';
import { factionOf } from './specs';
import type { GameState, Perks, Unit } from './types';

/** Mixed into rngSeed for the computer's choice of doctrine ("GENR"), so the battle's own stream is never touched. */
const PICK_SALT = 0x47454e52;

export const isGeneralId = (g: unknown): g is GeneralId => typeof g === 'string' && (GENERAL_IDS as string[]).includes(g);

/** The field General is in this battle: a skirmish with Generals on and advanced tech. */
export function fieldGenerals(s: GameState): boolean {
  // Never in a planet battle: War for the Planet has no field General (its setups state generals: false).
  return !s.mission && !s.planet && !!s.setup && s.setup.generals === true && s.setup.tech === 'advanced';
}

/** This side's doctrine and the strength it counts at: 1, or 0.5 while its fallen General is unreplaced. */
export function doctrineOf(s: GameState, owner: Owner): { spec: GeneralSpec; scale: number } | null {
  const id = s.players[owner]?.general;
  if (!id || !isGeneralId(id)) return null;
  return { spec: GENERALS[id], scale: s.players[owner].generalLostAt !== undefined ? 0.5 : 1 };
}

/** A multiplier at a share of its strength: 0.8 at half is 0.9. */
const scaled = (mul: number, scale: number): number => (scale === 1 ? mul : 1 + (mul - 1) * scale);

/** A doctrine's Perks, at full strength or halved. */
export function doctrinePerks(spec: GeneralSpec, scale = 1): Perks {
  return {
    harvestMul: scaled(spec.harvestMul, scale),
    buildSpeedMul: scaled(spec.buildSpeedMul, scale),
    costMul: 1,
    unitHpMul: 1,
    powerCooldownMul: scaled(spec.powerCooldownMul, scale),
    extraStartCredits: 0,
  };
}

/** Replaces this side's perks whole (side 0's are s.perks, the rest s.sidePerks: see perksFor). */
function setPerks(s: GameState, owner: Owner, perks: Perks): void {
  if (owner === 0) s.perks = perks;
  else s.sidePerks = { ...(s.sidePerks ?? {}), [owner]: perks };
}

/**
 * At createInitialState, on a skirmish: each seat's pick becomes its doctrine. With Generals on, a
 * computer seat left without one gets one of its army's two at random (seeded). Nothing at all is
 * written when no side ends up with a doctrine, so a default battle is exactly as before.
 */
export function applyDoctrines(s: GameState, setup: SkirmishSetup): void {
  let seed = (s.rngSeed ^ PICK_SALT) | 0;
  for (const o of sidesOf(s)) {
    let pick: GeneralId | null = setup.generalPicks?.[o] ?? null;
    if (pick && GENERAL_FACTION[pick] !== factionOf(s, o)) pick = null;
    if (!pick && setup.generals && o !== 0) {
      const own = GENERAL_IDS.filter(g => GENERAL_FACTION[g] === factionOf(s, o));
      const r = next(seed);
      seed = r.seed;
      pick = own.length ? own[Math.floor(r.value * own.length)] : null;
    }
    if (!pick) continue;
    s.players[o].general = pick;
    setPerks(s, o, doctrinePerks(GENERALS[pick]));
  }
}

/** A doctrine's price on this kind alone (1 without one), folded into costFor's multiplier. */
export function doctrineCostMul(s: GameState, owner: Owner, kind: BuildingKind | UnitKind): number {
  const d = s.players[owner]?.general ? doctrineOf(s, owner) : null;
  if (!d) return 1;
  let mul = d.spec.costs[kind] ?? 1;
  if (kind in UNITS && UNITS[kind as UnitKind].airRole) mul *= d.spec.airCostMul;
  return scaled(mul, d.scale);
}

/** This side's field General, if one stands. */
export function generalOf(s: GameState, owner: Owner): Unit | undefined {
  return s.units.find(u => u.owner === owner && u.kind === 'general' && u.hp > 0);
}

/** Field Generals this side has: standing, plus any in its infantry queue. */
export function generalsOf(s: GameState, owner: Owner): number {
  let n = 0;
  for (const u of s.units) if (u.owner === owner && u.kind === 'general' && u.hp > 0) n++;
  for (const q of s.players[owner].queues.infantry) if (q.kind === 'general') n++;
  return n;
}

/** Ticks until this side may queue a replacement General; 0 when it may. */
export function generalCooldown(s: GameState, owner: Owner): number {
  const at = s.players[owner].generalLostAt;
  return at === undefined ? 0 : Math.max(0, at + GENERAL_REPLACE_TICKS - s.tick);
}

/** canQueue's rule for the General: one per side, standing or queued, and not before the replacement cooldown. */
export function generalQueueable(s: GameState, owner: Owner): boolean {
  return fieldGenerals(s) && generalsOf(s, owner) === 0 && generalCooldown(s, owner) === 0;
}

/** True while this unit stands in its own side's General's aura. */
export const inAura = (s: GameState, u: Unit): boolean => u.aura !== undefined && u.aura > s.tick;

const auraWeapons = new WeakMap<Weapon, Weapon>();
/** The weapon as fired inside an aura: GENERAL_AURA_DAMAGE times the damage, GENERAL_AURA_RELOAD times the reload. Constant data, cached. */
export function auraWeapon(w: Weapon): Weapon {
  let a = auraWeapons.get(w);
  if (!a) {
    a = { ...w, damage: w.damage * GENERAL_AURA_DAMAGE, cooldown: Math.max(1, Math.round(w.cooldown * GENERAL_AURA_RELOAD)) };
    auraWeapons.set(w, a);
  }
  return a;
}

function say(s: GameState, text: string, tone: 'info' | 'good' | 'bad'): void {
  s.log.push({ tick: s.tick, text, tone });
  if (s.log.length > 40) s.log.splice(0, s.log.length - 40);
}

/**
 * Once a tick, from step (tick.ts), before the units move: the field Generals' falls and
 * replacements, the aura scan, and the Air doctrine's quicker rearm. Returns at once in a mission,
 * a battle without a setup, and a skirmish with neither a doctrine nor Generals on.
 */
export function generalsStep(s: GameState): void {
  if (s.mission || !s.setup) return;
  const field = fieldGenerals(s);
  if (field) fieldStep(s);
  for (const o of sidesOf(s)) {
    const d = s.players[o].general ? doctrineOf(s, o) : null;
    if (d && d.spec.rearmMul < 1) quickRearm(s, o, scaled(d.spec.rearmMul, d.scale));
  }
}

function fieldStep(s: GameState): void {
  const standing: Unit[] = [];
  for (const u of s.units) if (u.kind === 'general' && u.hp > 0) standing.push(u);
  for (const o of sidesOf(s)) {
    const p = s.players[o];
    const g = standing.find(u => u.owner === o);
    if (p.generalUnit !== undefined && !standing.some(u => u.id === p.generalUnit && u.owner === o)) {
      // Fallen: the aura goes with it and the doctrine counts at half until a replacement arrives.
      delete p.generalUnit;
      p.generalLostAt = s.tick;
      const d = doctrineOf(s, o);
      if (d) setPerks(s, o, doctrinePerks(d.spec, 0.5));
      if (o === 0) say(s, 'Your General has fallen. The doctrine is at half strength until a replacement arrives (one may be trained in two minutes).', 'bad');
      else say(s, 'An enemy General has fallen.', 'good');
    }
    if (g && p.generalUnit === undefined) {
      p.generalUnit = g.id;
      if (p.generalLostAt !== undefined) {
        delete p.generalLostAt;
        const d = doctrineOf(s, o);
        if (d) setPerks(s, o, doctrinePerks(d.spec));
        if (o === 0) say(s, 'A new General has taken command. The doctrine is back at full strength.', 'good');
      }
    }
  }
  if (s.tick % GENERAL_AURA_TICKS !== 0) return;
  const until = s.tick + GENERAL_AURA_TICKS;
  const r2 = GENERAL_AURA_RANGE * GENERAL_AURA_RANGE;
  for (const u of s.units) {
    if (u.hp <= 0) continue;
    let on = false;
    for (const g of standing) {
      if (g.owner !== u.owner) continue;
      const dx = u.x - g.x;
      const dy = u.y - g.y;
      if (dx * dx + dy * dy <= r2) {
        on = true;
        break;
      }
    }
    if (on) u.aura = until;
    else if (u.aura !== undefined) delete u.aura;
  }
}

/**
 * The Air doctrine: aircraft rearming at a Helipad take on loads faster. Rearming counts a load down
 * on the unit's cooldown (air.ts); this takes one more tick off it every `period` ticks, so a load
 * takes `mul` of the time.
 */
function quickRearm(s: GameState, owner: Owner, mul: number): void {
  const period = Math.max(1, Math.round(1 / (1 / mul - 1)));
  for (const u of s.units) {
    if (u.owner !== owner || u.order.type !== 'rearm' || u.cooldown <= 1 || !UNITS[u.kind].airRole) continue;
    if ((s.tick + u.id) % period === 0) u.cooldown--;
  }
}

/**
 * migrateRound6's part for Generals, on the copy migrateState builds: a doctrine that is not a
 * General of the side's own army is dropped, as are malformed ids and ticks, and a malformed aura
 * mark. A state without any of these is left exactly as it was.
 */
export function migrateGenerals(out: GameState): void {
  const intOk = (n: unknown, min: number) => Number.isInteger(n) && (n as number) >= min;
  const badPlayer = (p: GameState['players'][number]) =>
    (p.general !== undefined && (!isGeneralId(p.general) || GENERAL_FACTION[p.general] !== factionOf(out, p.owner))) ||
    (p.generalUnit !== undefined && !intOk(p.generalUnit, 1)) ||
    (p.generalLostAt !== undefined && !intOk(p.generalLostAt, 0));
  if (out.players.some(badPlayer)) {
    out.players = out.players.map(p => {
      if (!badPlayer(p)) return p;
      const c = { ...p };
      if (c.general !== undefined && (!isGeneralId(c.general) || GENERAL_FACTION[c.general] !== factionOf(out, c.owner))) delete c.general;
      if (c.generalUnit !== undefined && !intOk(c.generalUnit, 1)) delete c.generalUnit;
      if (c.generalLostAt !== undefined && !intOk(c.generalLostAt, 0)) delete c.generalLostAt;
      return c;
    });
  }
  if (out.units.some(u => u.aura !== undefined && !Number.isFinite(u.aura))) {
    out.units = out.units.map(u => {
      if (u.aura === undefined || Number.isFinite(u.aura)) return u;
      const c = { ...u };
      delete c.aura;
      return c;
    });
  }
  const badMem = (m: GameState['ai'][number]) =>
    !!m &&
    ((m.generalBack !== undefined && typeof m.generalBack !== 'boolean') ||
      (m.generalFund !== undefined && !(Number.isFinite(m.generalFund) && (m.generalFund as number) >= 0)));
  if (Array.isArray(out.ai) && out.ai.some(badMem)) {
    out.ai = out.ai.map(m => {
      if (!badMem(m)) return m;
      const c = { ...m };
      if (c.generalBack !== undefined && typeof c.generalBack !== 'boolean') delete c.generalBack;
      if (c.generalFund !== undefined && !(Number.isFinite(c.generalFund) && (c.generalFund as number) >= 0)) delete c.generalFund;
      return c;
    });
  }
}
