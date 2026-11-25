/**
 * Round 7: the adaptive commander (fireline-round7-adaptive.md). With the setup's `adaptive` on, a
 * Normal or Hard commander keeps a scouting memory of what it has actually seen of its enemies,
 * shifts its unit mix toward what counters that, and changes its plan of attack when its waves keep
 * being broken in the same place, when an enemy expands, or when an enemy turtles.
 *
 * Honest information. The commander sees the whole map for its ordinary play (a stated rule, and
 * the rest of ai.ts is unchanged). What it adapts to is only what its own team could see: every
 * ADAPT_SAMPLE ticks it looks through its team's sight (teamVisibility, and a Stealth Tank or Spy
 * only when seenBy says so) and writes down each enemy unit and structure in view. A sighting fades
 * with age (half its weight every ADAPT_HALF_LIFE ticks) and is forgotten when old, or when the spot
 * where it was seen is in view again and the thing is gone.
 *
 * Pure, like the rest of src/sim: no Math.random, no clock, no dice at all. Everything it decides
 * from lives in `s.ai[owner].adapt`, which is only ever replaced, never changed in place (cloneState
 * copies the memory shallowly), so a replay makes exactly the same decisions.
 *
 * Nothing here runs, and nothing in the state changes, unless adaptiveOn is true: with the setup's
 * `adaptive` off (or absent), on Easy, in a mission or in a planet battle, every hook below returns
 * its input unchanged, and the battle plays byte-identically to the commander before round 7.
 */
import { BUILDINGS, DAMAGE_VS, UNITS, type Armor, type Difficulty, type Owner, type UnitKind, type WeaponKind } from './rules';
import { alarm, setupOf, teamVisibility, techAllowed, unlocked } from './state';
import { isEnemy, startOf } from './sides';
import { seenBy } from './sites';
import { buildingCentre, dist, nearestPassable, occupancy, onMap, passable, tileAt } from './grid';
import { buildingSpecOf, unitSpecOf } from './specs';
import { openingMix, openingOf } from './aiOpening';
import { armyValue, enemyArmyValue } from './aiStrength';
import type { AdaptMemory, AdaptPlan, AdaptSighting, AdaptSite, GameState, Unit } from './types';

// ---- Numbers ---------------------------------------------------------------------------------

/** The composition classes, in the order of AdaptMemory.lean. */
export const ADAPT_CLASSES = ['infantry', 'light', 'heavy', 'artillery', 'air', 'navy', 'static'] as const;
export type AdaptClass = (typeof ADAPT_CLASSES)[number];
const INF = 0;
const LIGHT = 1;
const HEAVY = 2;
const ART = 3;
const AIR = 4;
const NAVY = 5;
const STATIC = 6;

/**
 * What it reads (2026-11-25): the whole map, as the rest of the commander always has (a stated rule
 * of the game). Round 7 first read only its team's sight, so the layer meant to sharpen the commander
 * read less than the commander it sharpened: blind until minute 8 against a tank column, then reading
 * it as infantry from the rocketeers in front, it overrode the commander's correct whole-map read and
 * did slightly worse. Stealth Tanks and Spies are still read only where seenBy says so. What side 0
 * is told is unchanged: only news it can see for itself.
 */
export const ADAPT_WHOLE_MAP = true;

/** Ticks between looks round (five seconds). */
export const ADAPT_SAMPLE = 50;
/** A sighting's weight halves every this many ticks (three minutes); a structure's three times slower. */
export const ADAPT_HALF_LIFE = 1800;
/** A unit sighting is forgotten after this many ticks; a structure after three times as long. */
export const ADAPT_FORGET = 4 * ADAPT_HALF_LIFE;
/** At most this many sightings of each sort are kept (the newest). */
const KEEP_SEEN = 120;
const KEEP_SITES = 80;
/** Credits' worth of sightings below which the commander has not seen enough to answer anything. */
const ENOUGH_SEEN = 1200;
/** Recent breaks only: older than this, a broken wave no longer counts toward changing the plan. */
const BREAK_MEMORY = 3600;
/** Two breaks this close (tiles) are "the same place". */
const SAME_PLACE = 12;
/** The share of the mix any one kind may reach (or its share before adapting, if that was higher). */
export const ADAPT_MAX_SHARE = 0.5;
/** A kind's weight never falls below this share of what it was before adapting. */
export const ADAPT_MIN_FACTOR = 0.5;
/** A kind's weight never rises above this many times what it was before adapting. */
export const ADAPT_MAX_FACTOR = 2.5;
/**
 * A one-sided enemy (2026-11-25): when one class is at least ADAPT_ONE_SIDED of what has been seen, the
 * answer goes further than the usual bounds, up to ADAPT_ONE_SIDED_FACTOR times a kind's weight and
 * ADAPT_ONE_SIDED_SHARE of the mix, scaled in from the threshold. A player repeating one plan fields a
 * one-sided army, and that is what this commander exists to punish.
 */
export const ADAPT_ONE_SIDED = 0.6;
export const ADAPT_ONE_SIDED_FACTOR = 5;
export const ADAPT_ONE_SIDED_SHARE = 0.8;

/** The mix's bounds and the strength multiplier for a lean: the usual ones, widened against a one-sided enemy. */
export function adaptLimits(lean: number[]): { maxShare: number; maxFactor: number; boost: number } {
  const total = lean.reduce((a, b) => a + b, 0);
  const top = total > 0 ? Math.max(...lean) / total : 0;
  const k = Math.max(0, Math.min(1, (top - ADAPT_ONE_SIDED) / (1 - ADAPT_ONE_SIDED)));
  return {
    maxShare: ADAPT_MAX_SHARE + k * (ADAPT_ONE_SIDED_SHARE - ADAPT_MAX_SHARE),
    maxFactor: ADAPT_MAX_FACTOR + k * (ADAPT_ONE_SIDED_FACTOR - ADAPT_MAX_FACTOR),
    boost: 1 + 2 * k,
  };
}

/** Defences seen at or above which an enemy is turtling (an ordinary Hard base has six). */
export const TURTLE_DEFENCES = 8;
/** Shortest gap between two lines in side 0's log about this commander's changes (five minutes). */
const TELL_GAP = 3000;

interface AdaptTuning {
  /** How strongly the mix answers what it has seen (0 none, 1 fully). */
  strength: number;
  /** Share of the gap between the lean and what it has seen closed at each look (gradual change). */
  rate: number;
  /** Ticks a plan is held before it may change again. */
  hold: number;
  /** The plans this difficulty uses beyond 'direct'. */
  plans: AdaptPlan[];
  /** Extra units a wave waits for while the plan is 'siege'. */
  siegeWave: number;
}

/** Hard adapts fully; Normal more slowly and only partly (no economy raids, no expansion hunting). */
export const ADAPT_TUNING: Record<'normal' | 'hard', AdaptTuning> = {
  // 2026-11-25: Normal answers fully and faster (was strength 0.5, rate 0.1). The scripted-opening test
  // showed half strength at a tenth a look changed nothing that mattered in a 15-minute battle.
  normal: { strength: 1, rate: 0.25, hold: 1200, plans: ['flank', 'siege'], siegeWave: 2 },
  hard: { strength: 1, rate: 0.25, hold: 600, plans: ['flank', 'raid', 'expand', 'siege'], siegeWave: 4 },
};

// ---- Test hooks (scripts only) ----------------------------------------------------------------

/**
 * For scripts/ai-ladder.ts and scripts/drive-adaptive.ts only: force a side's commander to adapt
 * (true) or not (false) whatever the setup says, to measure one against the other. Nothing in the
 * game calls it; with no override set (the default) the setup decides.
 */
const overrides: (boolean | null)[] = [null, null, null, null];
export function setAdaptiveOverride(owner: Owner, on: boolean | null): void {
  overrides[owner] = on;
}

/** For the ladder's ablations only: which halves adapt (the mix, the plans). Both, unless a script says otherwise. */
const parts = { mix: true, plans: true };
export function setAdaptiveParts(mix: boolean, plans: boolean): void {
  parts.mix = mix;
  parts.plans = plans;
}

// ---- When it runs -----------------------------------------------------------------------------

function difficultyOf(s: GameState, owner: Owner): Difficulty {
  return owner === 0 && s.autopilotDifficulty ? s.autopilotDifficulty : s.difficulty;
}

/** True when this side's commander adapts: the setup asks for it, Normal or Hard, a skirmish (never a mission or a planet battle). */
export function adaptiveOn(s: GameState, owner: Owner): boolean {
  if (s.mission || s.planet || !s.setup) return false;
  const forced = overrides[owner];
  if (forced === false) return false;
  if (forced !== true && setupOf(s).adaptive !== true) return false;
  return difficultyOf(s, owner) !== 'easy';
}

function tuningOf(s: GameState, owner: Owner): AdaptTuning {
  return ADAPT_TUNING[difficultyOf(s, owner) === 'hard' ? 'hard' : 'normal'];
}

function blank(): AdaptMemory {
  return { at: -ADAPT_SAMPLE, seen: [], sites: [], lean: ADAPT_CLASSES.map(() => 0), plan: 'direct', planAt: 0, flank: null, breaks: [], phase: 0, waveAt: [0, 0], told: '' };
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const PLANS: AdaptPlan[] = ['direct', 'flank', 'raid', 'expand', 'siege'];

/** The memory, made sound: a save from before round 7, or a damaged one, starts afresh. Never changes it in place. */
function memoryOf(s: GameState, owner: Owner): AdaptMemory {
  const m = s.ai[owner].adapt as Partial<AdaptMemory> | undefined;
  const sound =
    !!m &&
    typeof m === 'object' &&
    num(m.at) &&
    Array.isArray(m.seen) &&
    m.seen.every(r => !!r && num(r.id) && num(r.o) && num(r.c) && r.c >= 0 && r.c < ADAPT_CLASSES.length && num(r.v) && num(r.t) && num(r.x) && num(r.y)) &&
    Array.isArray(m.sites) &&
    m.sites.every(r => !!r && num(r.id) && num(r.o) && typeof r.k === 'string' && num(r.t) && num(r.x) && num(r.y)) &&
    Array.isArray(m.lean) &&
    m.lean.length === ADAPT_CLASSES.length &&
    m.lean.every(v => num(v) && v >= 0 && v <= 1) &&
    PLANS.includes(m.plan as AdaptPlan) &&
    num(m.planAt) &&
    (m.flank === null || (Array.isArray(m.flank) && m.flank.length === 2 && m.flank.every(num))) &&
    Array.isArray(m.breaks) &&
    m.breaks.every(b => Array.isArray(b) && b.length === 3 && b.every(num)) &&
    num(m.phase) &&
    Array.isArray(m.waveAt) &&
    m.waveAt.length === 2 &&
    m.waveAt.every(num) &&
    typeof m.told === 'string';
  if (sound) return m as AdaptMemory;
  const fresh = blank();
  s.ai[owner].adapt = fresh;
  return fresh;
}

/** Replace the memory with a changed copy (never change the stored one in place). */
function put(s: GameState, owner: Owner, patch: Partial<AdaptMemory>): AdaptMemory {
  const next = { ...memoryOf(s, owner), ...patch };
  s.ai[owner].adapt = next;
  return next;
}

// ---- Seeing ------------------------------------------------------------------------------------

/** The composition class of a unit, or -1 for one that does not fight (haulers, Medics, trucks). */
export function classOf(s: GameState, u: Unit): number {
  const spec = unitSpecOf(s, u);
  if (!spec.weapon) return -1;
  if (spec.category === 'air') return AIR;
  if (spec.category === 'naval') return NAVY;
  if (spec.category === 'infantry') return INF;
  if (u.kind === 'artillery' || u.kind === 'missilecarrier' || spec.weapon.kind === 'artillery') return ART;
  return spec.armor === 'heavy' ? HEAVY : LIGHT;
}

/** The structures that tell the commander what an enemy is teching toward ('pointdefence' counts if a later round adds it). */
const TECH_SIGNALS = ['techcentre', 'helipad', 'researchlab', 'pointdefence'];
/** Structures worth remembering: the defences, the tech signals, and the economy (for raids and expansions). */
const REMEMBERED = new Set<string>(['hq', 'refinery', 'fieldyard', ...TECH_SIGNALS]);
const isDefence = (kind: string): boolean => !!(BUILDINGS as Record<string, { weapon?: unknown; wall?: true }>)[kind]?.weapon;

const decay = (age: number, halfLife: number): number => Math.pow(0.5, Math.max(0, age) / halfLife);

/**
 * One look round: every enemy unit and structure within this side's team sight is written down
 * (or its sighting refreshed); sightings too old are forgotten, as is anything whose spot is in view
 * again with nothing there. Exported for the harness, which calls it directly to test sight.
 */
export function observe(s: GameState, owner: Owner): AdaptMemory {
  const mem = memoryOf(s, owner);
  const vis = teamVisibility(s, owner);
  // 2026-11-25: the whole map (ADAPT_WHOLE_MAP), as the rest of the commander has always read it.
  const inView = (x: number, y: number) => {
    if (ADAPT_WHOLE_MAP) return true;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    return onMap(s, tx, ty) && vis[tileAt(s, tx, ty)] === 1;
  };
  const seenNow = new Map<number, AdaptSighting>();
  for (const u of s.units) {
    if (u.hp <= 0 || !isEnemy(s, owner, u.owner) || !inView(u.x, u.y)) continue;
    if ((u.kind === 'spy' || UNITS[u.kind].stealth) && !seenBy(s, u, owner)) continue;
    const c = classOf(s, u);
    if (c < 0) continue;
    const spec = unitSpecOf(s, u);
    seenNow.set(u.id, { id: u.id, o: u.owner, c, v: spec.cost > 0 ? spec.cost : 600, t: s.tick, x: Math.round(u.x * 10) / 10, y: Math.round(u.y * 10) / 10 });
  }
  const alive = new Set(s.units.map(u => u.id));
  const seen: AdaptSighting[] = [];
  for (const r of mem.seen) {
    if (seenNow.has(r.id)) continue;
    if (s.tick - r.t > ADAPT_FORGET) continue;
    // Its spot is in view and it is no longer standing anywhere: it is gone.
    if (!alive.has(r.id) && inView(r.x, r.y)) continue;
    seen.push(r);
  }
  for (const r of seenNow.values()) seen.push(r);
  seen.sort((a, b) => b.t - a.t || a.id - b.id);
  const sitesNow = new Map<number, AdaptSite>();
  for (const b of s.buildings) {
    if (b.hp <= 0 || !isEnemy(s, owner, b.owner)) continue;
    if (!REMEMBERED.has(b.kind) && !isDefence(b.kind)) continue;
    const c = buildingCentre(b);
    // Any tile of it in view will do: a corner of a large structure is enough to know it is there.
    const spec = buildingSpecOf(s, b);
    let any = false;
    for (let y = b.y; y < b.y + spec.h && !any; y++) for (let x = b.x; x < b.x + spec.w; x++) if (onMap(s, x, y) && (ADAPT_WHOLE_MAP || vis[tileAt(s, x, y)])) any = true;
    if (!any) continue;
    sitesNow.set(b.id, { id: b.id, o: b.owner, k: b.kind, t: s.tick, x: c.x, y: c.y });
  }
  const standing = new Set(s.buildings.filter(b => b.hp > 0).map(b => b.id));
  const sites: AdaptSite[] = [];
  for (const r of mem.sites) {
    if (sitesNow.has(r.id)) continue;
    if (s.tick - r.t > 3 * ADAPT_FORGET) continue;
    if (!standing.has(r.id) && inView(r.x, r.y)) continue;
    sites.push(r);
  }
  for (const r of sitesNow.values()) sites.push(r);
  sites.sort((a, b) => b.t - a.t || a.id - b.id);
  return put(s, owner, { at: s.tick, seen: seen.slice(0, KEEP_SEEN), sites: sites.slice(0, KEEP_SITES) });
}

export interface AdaptSummary {
  /** Credits' worth of what it remembers, faded by age, per class (ADAPT_CLASSES). */
  worth: number[];
  /** Shares of that worth per class (all 0 when it has seen too little). */
  shares: number[];
  total: number;
  /** Static defences remembered. */
  defences: number;
  /** Tech signals remembered, by kind. */
  tech: Record<string, boolean>;
  /** Enemy economy away from its home: refineries and Field Yards at least 14 tiles from its yard. */
  expansions: AdaptSite[];
}

/** What the memory adds up to now. Pure: reads the memory only. */
export function summarise(s: GameState, owner: Owner, mem: AdaptMemory = memoryOf(s, owner)): AdaptSummary {
  const worth = ADAPT_CLASSES.map(() => 0);
  for (const r of mem.seen) worth[r.c] += r.v * decay(s.tick - r.t, ADAPT_HALF_LIFE);
  let defences = 0;
  const tech: Record<string, boolean> = {};
  const homes = new Map<number, { x: number; y: number }>();
  for (const r of mem.sites) {
    if (isDefence(r.k)) {
      const spec = (BUILDINGS as Record<string, { cost: number }>)[r.k];
      worth[STATIC] += (spec?.cost ?? 600) * decay(s.tick - r.t, 3 * ADAPT_HALF_LIFE);
      defences++;
    }
    if (TECH_SIGNALS.includes(r.k)) tech[r.k] = true;
    if (r.k === 'hq' && !homes.has(r.o)) homes.set(r.o, { x: r.x, y: r.y });
  }
  const expansions: AdaptSite[] = [];
  for (const r of mem.sites) {
    if (r.k !== 'refinery' && r.k !== 'fieldyard') continue;
    // Where an enemy's yard is: as seen, or its start (the map is no secret).
    const home = homes.get(r.o) ?? startOf(s, r.o as Owner);
    if (dist(r.x, r.y, home.x + 1.5, home.y + 1.5) >= 14) expansions.push(r);
  }
  const total = worth.reduce((a, b) => a + b, 0);
  const shares = total >= ENOUGH_SEEN ? worth.map(w => w / total) : worth.map(() => 0);
  return { worth, shares, total, defences, tech, expansions };
}

// ---- Deciding ----------------------------------------------------------------------------------

/**
 * Called once a decision, at its start (ai.ts). Every ADAPT_SAMPLE ticks: a look round, the lean
 * moved a step toward what has been seen, and the plan reconsidered.
 */
export function adaptObserve(s: GameState, owner: Owner): void {
  if (!adaptiveOn(s, owner)) return;
  const before = memoryOf(s, owner);
  if (s.tick - before.at < ADAPT_SAMPLE) return;
  const t = tuningOf(s, owner);
  const mem = observe(s, owner);
  const sum = summarise(s, owner, mem);
  // Tech signals: a Helipad means aircraft are coming, a Tech Centre heavy armour, whether or not
  // they have been seen yet: a floor under the lean, small, so a signal alone never turns the mix.
  const target = sum.shares.slice();
  // Defences: every base has a few (Hard builds six), so they only count as something to answer
  // once there are more than an ordinary base holds (TURTLE_DEFENCES): a turtle. Measured: answering
  // an ordinary base's turrets put the mix into siege guns for the whole battle and lost games.
  if (sum.defences < TURTLE_DEFENCES) {
    const rest = 1 - target[STATIC];
    target[STATIC] = 0;
    if (rest > 0) for (let i = 0; i < target.length; i++) target[i] /= rest;
  }
  if (sum.tech.helipad) target[AIR] = Math.max(target[AIR], 0.15);
  if (sum.tech.techcentre) target[HEAVY] = Math.max(target[HEAVY], 0.15);
  const lean = mem.lean.map((v, i) => Math.round((v + (Math.min(1, target[i]) - v) * t.rate) * 1000) / 1000);
  let plan = mem.plan;
  let planAt = mem.planAt;
  let flank = mem.flank;
  if (s.tick - mem.planAt >= t.hold) {
    const next = choosePlan(s, mem, sum, t);
    if (next.plan !== plan || next.refresh) {
      plan = next.plan;
      planAt = s.tick;
      // A new flank is worked out when the plan next needs one (adaptStage); a raid keeps the flank's approach.
      if (next.plan !== 'raid') flank = null;
    }
  }
  const after = put(s, owner, { lean, plan, planAt, flank });
  tell(s, owner, after);
}

/** The recent breaks (after tick `since`) that cluster round one place, or null. */
function clusteredBreaks(s: GameState, mem: AdaptMemory, since = -Infinity): { x: number; y: number; n: number } | null {
  const recent = mem.breaks.filter(b => s.tick - b[2] <= BREAK_MEMORY && b[2] > since);
  if (recent.length < 2) return null;
  // The newest break, and how many recent ones lie close to it.
  const last = recent[recent.length - 1];
  const near = recent.filter(b => dist(b[0], b[1], last[0], last[1]) <= SAME_PLACE);
  if (near.length < 2) return null;
  return { x: near.reduce((a, b) => a + b[0], 0) / near.length, y: near.reduce((a, b) => a + b[1], 0) / near.length, n: near.length };
}

/**
 * The plan for the next while, and whether a flank should be worked out afresh (the same plan, but
 * broken again on it). Only what it has seen and what happened to its own waves.
 */
function choosePlan(s: GameState, mem: AdaptMemory, sum: AdaptSummary, t: AdaptTuning): { plan: AdaptPlan; refresh: boolean } {
  const allowed = (p: AdaptPlan) => t.plans.includes(p);
  // Turtling: a ring of defences and little else. Tech up and mass siege before going in.
  if (allowed('siege') && sum.defences >= TURTLE_DEFENCES && sum.shares[STATIC] >= 0.35) return { plan: 'siege', refresh: false };
  if (mem.plan === 'flank' || mem.plan === 'raid') {
    // Broken twice again since the plan began. From a flank: Hard goes for the economy, Normal
    // tries the other side. From a raid that still broke: back to the start.
    if (clusteredBreaks(s, mem, mem.planAt)) {
      if (mem.plan === 'raid') return { plan: 'direct', refresh: false };
      return allowed('raid') ? { plan: 'raid', refresh: false } : { plan: 'flank', refresh: true };
    }
    return { plan: mem.plan, refresh: false };
  }
  // Broken twice in the same place: come at it another way.
  if (allowed('flank') && clusteredBreaks(s, mem)) return { plan: 'flank', refresh: true };
  // An enemy expanding fast: hit the expansions (Hard).
  if (allowed('expand') && sum.expansions.length > 0) return { plan: 'expand', refresh: false };
  // Nothing left to answer: the direct approach.
  return { plan: 'direct', refresh: false };
}

// ---- What answers what ------------------------------------------------------------------------

/**
 * How a credit spent on each kind fares against a credit spent on each class, measured in the real
 * engine by scripts/adapt-matchups.ts (equal-credit fights in the open, both sides attack-moving at
 * each other, or the group attacking a powered ring of defences): the log of the share of value each
 * side had left, so 0 is an even trade, +1 leaves the kind about e times better off, and +-3 is a
 * wipe-out. Columns in ADAPT_CLASSES order; null where the fight is not measured (aircraft need
 * their pads, ships the sea), which classScores fills from DAMAGE_VS. Rerun the script after any
 * change to unit stats and paste its output here.
 */
export const MATCHUPS: Partial<Record<UnitKind, (number | null)[]>> = {
  rifleman: [-0.21, 2.67, 0.72, 0.23, null, null, -0.83],
  rocketeer: [-1.98, 0.25, 1.14, 0.06, null, null, 0.36],
  grenadier: [1.69, 1.72, -0.24, 0.03, null, null, 0.69],
  sapper: [-1.89, -0.05, -0.87, -2.58, null, null, -1.78],
  buggy: [-0.8, -0.07, -2.8, 1.35, null, null, -2.96],
  raider: [-2.88, -1.17, -1.28, 1.27, null, null, -2.63],
  tank: [-1.88, 2.26, 1.52, 2.72, null, null, -1.4],
  artillery: [2.75, -0.88, -2.66, -0.61, null, null, -0.69],
  flametank: [2.51, 2.56, -1.33, 2.51, null, null, -2.4],
  missilecarrier: [-2.89, -2.71, -2.5, 0.1, null, null, 1.07],
  bastion: [-2.38, 0.98, -0.23, 2.49, null, null, 0.11],
  railtank: [-2.62, 1.9, 0.74, 2.7, null, null, 0.06],
  stealthtank: [-2.93, -2.6, -2.48, 0.99, null, null, -2.76],
};

const scoreCache = new Map<string, number[]>();
/**
 * A kind's score against each class: MATCHUPS where measured, and otherwise from DAMAGE_VS: against
 * aircraft, a weapon that can fire on them scores by its damage to them (Flak Tracks and Skyhunters
 * well, riflemen' bullets a little) and one that cannot scores -1; against ships 0 (the navy answers
 * ships); a kind that cannot fire on the ground at all (the anti-air) scores -1 against every ground class.
 */
export function classScores(kind: UnitKind): number[] {
  let v = scoreCache.get(kind);
  if (!v) {
    const w = UNITS[kind].weapon;
    const ground = !!w && (w.canHitGround ?? true);
    const air = !!w && (w.canHitAir ?? w.kind === 'bullet');
    const row = MATCHUPS[kind];
    v = ADAPT_CLASSES.map((_, c) => {
      const m = row?.[c];
      if (m !== null && m !== undefined) return m;
      if (c === AIR) return air && w ? 3 * DAMAGE_VS[w.kind].aircraft - 1 : -1;
      if (c === NAVY) return 0;
      return ground ? 0 : -1;
    });
    scoreCache.set(kind, v);
  }
  return v;
}

/**
 * The unit mix, adapted (ai.ts passes each weighted list of choices through this before drawing).
 * Each kind's weight is scaled by how well a credit spent on it fights what the commander leans
 * toward (classScores: the measured MATCHUPS, and DAMAGE_VS where unmeasured), plus a few doctrines (fast
 * raiders against artillery, siege against defences, anti-air against aircraft), bounded: no kind
 * falls below ADAPT_MIN_FACTOR of its weight or rises above ADAPT_MAX_FACTOR of it, and no kind
 * takes more than ADAPT_MAX_SHARE of the mix (or its share before adapting, where that was already
 * more), so the army never becomes one kind. Off, or with nothing seen: the list itself, unchanged.
 */
export function adaptMix(s: GameState, owner: Owner, choices: [UnitKind, number][], slot: 'vehicle' | 'infantry'): [UnitKind, number][] {
  // The scripted-opening test (aiOpening.ts, harness only): a side playing a fixed opening trains its units and nothing else.
  if (openingOf(owner)) return openingMix(owner, choices, slot);
  if (!adaptiveOn(s, owner) || !parts.mix) return choices;
  const mem = memoryOf(s, owner);
  return mixFor(choices, mem.lean, tuningOf(s, owner).strength, slot, k => techAllowed(s, owner, k) && unlocked(s, owner, k));
}

/** How hard the matchup score pushes a weight (a factor of e^(GAIN * strength * score)). */
const GAIN = 0.4;

/** The pure core of adaptMix, exported for the harness. `open` says which kinds can be trained. */
export function mixFor(
  choices: [UnitKind, number][],
  lean: number[],
  strength: number,
  slot: 'vehicle' | 'infantry',
  open: (k: UnitKind) => boolean,
): [UnitKind, number][] {
  const leanTotal = lean.reduce((a, b) => a + b, 0);
  if (leanTotal <= 0.001 || strength <= 0) return choices;
  const list: [UnitKind, number][] = choices.map(([k, w]) => [k, w]);
  // Anti-air joins the list against aircraft, in proportion to the lean: Flak Tracks with the vehicles, Skyhunters with the infantry.
  const aaKind: UnitKind = slot === 'vehicle' ? 'flaktrack' : 'skyhunter';
  const baseTotal = list.reduce((a, [, w]) => a + w, 0);
  if (lean[AIR] > 0.05 && !list.some(([k]) => k === aaKind)) list.push([aaKind, baseTotal * 0.15 * lean[AIR]]);
  // A kind's score: its matchup against each class (classScores), weighted by the lean.
  const score = (k: UnitKind): number => {
    const v = classScores(k);
    let e = 0;
    for (let c = 0; c < ADAPT_CLASSES.length; c++) e += lean[c] * v[c];
    return e / leanTotal;
  };
  const openList = list.filter(([k, w]) => w > 0 && open(k));
  if (openList.length < 2) return choices;
  const before = openList.reduce((a, [, w]) => a + w, 0);
  const mean = openList.reduce((a, [k, w]) => a + score(k) * w, 0) / before;
  const doctrine = (k: UnitKind): number => {
    let d = 0;
    // Artillery and missile carriers are run down by something fast.
    if (k === 'buggy' || k === 'raider' || k === 'stealthtank') d += lean[ART] * 2;
    // A ring of defences: outrange it.
    if (k === 'artillery' || k === 'missilecarrier' || k === 'bastion') d += lean[STATIC] * 1.5;
    // Aircraft: anti-air, the more the more of them.
    if (k === aaKind) d += lean[AIR] * 8;
    return d;
  };
  const lim = adaptLimits(lean);
  const scaled: [UnitKind, number][] = list.map(([k, w]) => {
    if (w <= 0 || !open(k)) return [k, w];
    const f = Math.exp(strength * lim.boost * (GAIN * (score(k) - mean) + doctrine(k)));
    return [k, w * Math.max(ADAPT_MIN_FACTOR, Math.min(lim.maxFactor, f))];
  });
  return capShares(scaled, list, open, lim.maxShare);
}

/** No open kind above maxShare (ADAPT_MAX_SHARE, widened by adaptLimits) of the mix (or its share before adapting, where that was higher). */
function capShares(scaled: [UnitKind, number][], base: [UnitKind, number][], open: (k: UnitKind) => boolean, maxShare = ADAPT_MAX_SHARE): [UnitKind, number][] {
  const out = scaled.map(([k, w]): [UnitKind, number] => [k, w]);
  const idx = out.map((_, i) => i).filter(i => out[i][1] > 0 && open(out[i][0]));
  const baseTotal = idx.reduce((a, i) => a + base[i][1], 0);
  const cap = (i: number) => Math.max(maxShare, base[i][1] / baseTotal);
  // A few passes: lowering one kind raises the others' shares.
  for (let pass = 0; pass < 6; pass++) {
    const total = idx.reduce((a, i) => a + out[i][1], 0);
    let changed = false;
    for (const i of idx) {
      const share = out[i][1] / total;
      if (share <= cap(i) + 1e-9) continue;
      // Solve w' / (total - w + w') = cap for w'.
      const rest = total - out[i][1];
      out[i][1] = (cap(i) * rest) / (1 - cap(i));
      changed = true;
    }
    if (!changed) break;
  }
  return out;
}

/** Standard tech: the rifleman's share of the infantry, adapted the same way. */
export function adaptShare(s: GameState, owner: Owner, a: UnitKind, b: UnitKind, shareA: number, slot: 'vehicle' | 'infantry'): number {
  if (!adaptiveOn(s, owner)) return shareA;
  const mixed = adaptMix(s, owner, [[a, shareA], [b, 1 - shareA]], slot).filter(([k]) => k === a || k === b);
  const total = mixed.reduce((x, [, w]) => x + w, 0);
  return total > 0 ? mixed[0][1] / total : shareA;
}

// ---- The plan's hooks into the wave -----------------------------------------------------------

/**
 * Where a wave gathers before it sets off: the staging point, or on a flank (or a raid, which goes
 * the flank's way) a second staging point off to one side, away from where the waves were broken,
 * on open ground the army can walk to. Off, or with no such place: `stage` itself.
 */
export function adaptStage(s: GameState, owner: Owner, stage: { x: number; y: number }, home: { x: number; y: number }, enemyHome: { x: number; y: number }): { x: number; y: number } {
  if (!adaptiveOn(s, owner) || !parts.plans) return stage;
  const mem = memoryOf(s, owner);
  if (mem.plan !== 'flank' && mem.plan !== 'raid') return stage;
  if (mem.flank) return { x: mem.flank[0], y: mem.flank[1] };
  const at = flankPoint(s, owner, mem, stage, home, enemyHome);
  if (!at) {
    // Nowhere to flank from (a narrow map): back to the direct approach.
    put(s, owner, { plan: 'direct', planAt: s.tick, flank: null });
    return stage;
  }
  put(s, owner, { flank: [at.x, at.y] });
  return at;
}

function flankPoint(
  s: GameState,
  owner: Owner,
  mem: AdaptMemory,
  stage: { x: number; y: number },
  home: { x: number; y: number },
  enemyHome: { x: number; y: number },
): { x: number; y: number } | null {
  const d = dist(home.x, home.y, enemyHome.x, enemyHome.y) || 1;
  const ux = (enemyHome.x - home.x) / d;
  const uy = (enemyHome.y - home.y) / d;
  const mid = { x: home.x + ux * d * 0.42, y: home.y + uy * d * 0.42 };
  const off = Math.max(8, Math.min(18, d * 0.3));
  const cluster = clusteredBreaks(s, mem) ?? (mem.breaks.length ? { x: mem.breaks[mem.breaks.length - 1][0], y: mem.breaks[mem.breaks.length - 1][1] } : null);
  const sides = [1, -1].map(k => ({ x: mid.x - uy * off * k, y: mid.y + ux * off * k }));
  // The side further from where the waves were broken first; with nothing to go on, the first.
  if (cluster) sides.sort((a, b) => dist(b.x, b.y, cluster.x, cluster.y) - dist(a.x, a.y, cluster.x, cluster.y));
  const occ = occupancy(s);
  const reach = walkFrom(s, occ, stage);
  for (const p of sides) {
    const spot = clearGround(s, occ, p);
    if (spot && reach[tileAt(s, Math.floor(spot.x), Math.floor(spot.y))]) return spot;
  }
  return null;
}

/** Nearest point to p, within 6 tiles, with open ground two tiles all round. */
function clearGround(s: GameState, occ: Int32Array, p: { x: number; y: number }): { x: number; y: number } | null {
  const cx = Math.floor(p.x);
  const cy = Math.floor(p.y);
  for (let r = 0; r <= 6; r++)
    for (let iy = -r; iy <= r; iy++)
      for (let ix = -r; ix <= r; ix++) {
        if (Math.max(Math.abs(ix), Math.abs(iy)) !== r) continue;
        let ok = true;
        for (let ey = -2; ey <= 2 && ok; ey++)
          for (let ex = -2; ex <= 2; ex++)
            if (!passable(s, occ, cx + ix + ex, cy + iy + ey)) {
              ok = false;
              break;
            }
        if (ok) return { x: cx + ix + 0.5, y: cy + iy + 0.5 };
      }
  return null;
}

/** Every tile reachable over open ground (4-way) from p. */
function walkFrom(s: GameState, occ: Int32Array, p: { x: number; y: number }): Uint8Array {
  const n = s.mapW * s.mapH;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const start = nearestPassable(s, occ, p.x, p.y);
  if (start < 0) return seen;
  seen[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const k = queue[head++];
    const x = k % s.mapW;
    const y = (k / s.mapW) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!passable(s, occ, nx, ny)) continue;
      const m = tileAt(s, nx, ny);
      if (seen[m]) continue;
      seen[m] = 1;
      queue[tail++] = m;
    }
  }
  return seen;
}

/**
 * Where the wave goes: `fallback` (the ordinary choice), or for a raid the enemy economy it
 * remembers (a refinery or Field Yard, the nearest to `from`), or for an expansion hunt the nearest
 * expansion it has seen. Only what it has seen: with nothing remembered, the ordinary choice.
 */
export function adaptTarget(s: GameState, owner: Owner, fallback: { x: number; y: number }, from: { x: number; y: number }): { x: number; y: number } {
  if (!adaptiveOn(s, owner) || !parts.plans) return fallback;
  const mem = memoryOf(s, owner);
  if (mem.plan !== 'raid' && mem.plan !== 'expand') return fallback;
  const list = mem.plan === 'expand' ? summarise(s, owner, mem).expansions : mem.sites.filter(r => r.k === 'refinery' || r.k === 'fieldyard');
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const r of list) {
    const d = dist(from.x, from.y, r.x, r.y);
    if (d < bestD) {
      bestD = d;
      best = { x: r.x, y: r.y };
    }
  }
  return best ?? fallback;
}

/** The size a wave waits for: larger while the plan is a siege (the overdue rule still sends it, so it never stalls). */
export function adaptWaveSize(s: GameState, owner: Owner, size: number, cap: number): number {
  if (!adaptiveOn(s, owner) || !parts.plans) return size;
  const mem = memoryOf(s, owner);
  if (mem.plan !== 'siege') return size;
  return Math.min(cap + tuningOf(s, owner).siegeWave, size + tuningOf(s, owner).siegeWave);
}

/**
 * Called once a decision, at its end (ai.ts). Notices a wave that was broken (it was attacking at
 * the last decision and is not now) and remembers where.
 */
export function adaptAfter(s: GameState, owner: Owner): void {
  if (!adaptiveOn(s, owner)) return;
  const ai = s.ai[owner];
  const mem = memoryOf(s, owner);
  let breaks = mem.breaks;
  let waveAt = mem.waveAt;
  if (mem.phase === 2 && ai.wavePhase !== 2) breaks = [...breaks, [waveAt[0], waveAt[1], s.tick] as [number, number, number]].slice(-4);
  if (ai.wavePhase === 2) {
    const members = ai.waveIds.map(id => s.units.find(u => u.id === id)).filter((u): u is Unit => !!u);
    if (members.length) {
      const x = members.reduce((a, u) => a + u.x, 0) / members.length;
      const y = members.reduce((a, u) => a + u.y, 0) / members.length;
      waveAt = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    }
  }
  if (breaks === mem.breaks && waveAt === mem.waveAt && mem.phase === ai.wavePhase) return;
  put(s, owner, { breaks, waveAt, phase: ai.wavePhase });
}

// ---- Telling side 0 ----------------------------------------------------------------------------

/** What side 0 may read, per change: the units it would have to see, and the line. */
const NEWS: { key: string; cls: number; kinds: UnitKind[]; text: string }[] = [
  { key: 'infantry', cls: INF, kinds: ['grenadier', 'flametank'], text: 'The enemy is answering your infantry with grenadiers and flame tanks.' },
  { key: 'heavy', cls: HEAVY, kinds: ['rocketeer', 'missilecarrier'], text: 'The enemy is massing rocket infantry against your armour.' },
  { key: 'light', cls: LIGHT, kinds: ['tank', 'rocketeer'], text: 'The enemy is answering your light vehicles with tanks and rockets.' },
  { key: 'air', cls: AIR, kinds: ['flaktrack', 'skyhunter'], text: 'The enemy is bringing up anti-air against your aircraft.' },
  { key: 'artillery', cls: ART, kinds: ['buggy', 'raider'], text: 'Enemy raiders are hunting your artillery.' },
  { key: 'static', cls: STATIC, kinds: ['artillery', 'missilecarrier', 'bastion'], text: 'The enemy is massing siege guns outside your defences.' },
];

/**
 * One line in side 0's log when this commander has visibly changed: its lean toward answering one
 * class has become strong, and side 0 can see at least two of the units that answer it. Never more
 * often than TELL_GAP, never the same news twice running, and only for an enemy of side 0.
 */
function tell(s: GameState, owner: Owner, mem: AdaptMemory): void {
  if (owner === 0 || !isEnemy(s, 0, owner)) return;
  if (s.tick - (s.alarms[`adapt${owner}`] ?? -Infinity) < TELL_GAP) return;
  let top = -1;
  for (let c = 0; c < ADAPT_CLASSES.length; c++) if (mem.lean[c] >= 0.4 && (top < 0 || mem.lean[c] > mem.lean[top])) top = c;
  const news = NEWS.find(n => n.cls === top);
  if (!news || news.key === mem.told) return;
  const theirs = s.units.filter(u => u.owner === owner && news.kinds.includes(u.kind));
  if (theirs.length < 2) return;
  const vis = teamVisibility(s, 0);
  const visible = theirs.filter(u => {
    const tx = Math.floor(u.x);
    const ty = Math.floor(u.y);
    return onMap(s, tx, ty) && vis[tileAt(s, tx, ty)] === 1 && (!UNITS[u.kind].stealth || seenBy(s, u, 0));
  });
  if (visible.length < 2) return;
  alarm(s, `adapt${owner}`, news.text, TELL_GAP, 'info');
  put(s, owner, { told: news.key });
}

// ---- Seizing the moment (2026-11-25) -----------------------------------------------------------

/** Own field army over the enemy's, by price, at or above which the adaptive commander attacks at once. */
export const ADAPT_SEIZE = 1.4;
/** Below this enemy army value (credits) there is no moment to seize: the battle's first minutes. */
export const ADAPT_SEIZE_FLOOR = 1500;

/**
 * True when the adaptive commander should send its wave now rather than at its next scheduled time:
 * its army is ADAPT_SEIZE times the enemy's, as it is straight after an enemy push has broken against
 * its defences. The fixed commander keeps its timetable, and a fixed plan that keeps attacking into a
 * prepared defence is punished for it in the minutes after. Nothing when off.
 */
export function adaptSeize(s: GameState, owner: Owner): boolean {
  if (!adaptiveOn(s, owner)) return false;
  const foe = enemyArmyValue(s, owner);
  return foe >= ADAPT_SEIZE_FLOOR && armyValue(s, owner) >= foe * ADAPT_SEIZE;
}
