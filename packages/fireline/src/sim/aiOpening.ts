// Scripted openings: a side that plays one fixed plan every game, for measuring the adaptive
// commander (fireline-round7-adaptive.md, "The scripted-opening test"). Harness only: set through
// setOpening by scripts/ai-ladder.ts (--opening) and scripts/drive-adaptive.ts, never by the game,
// and nothing here is saved, so every battle a player fights is untouched.
//
// A side with an opening is played by the ordinary commander (its economy, research, timing and
// waves are unchanged, and it earns nothing extra) but trains only the opening's units, at the
// opening's weights, whatever it sees. It never adapts: its waves always take the direct approach.
// That is the player the adaptive commander is meant to punish: one who repeats the same plan.
import { HERO_KINDS, UNITS, type Category, type Owner, type UnitKind } from './rules';
import { canQueue, doCancel, doQueue } from './commands';
import { costFor, lineCount } from './state';
import type { GameState } from './types';

export type Opening = 'armour' | 'infantry' | 'siege';
export const OPENINGS: Opening[] = ['armour', 'infantry', 'siege'];

export interface OpeningSpec {
  name: string;
  /** What the side trains from its War Factories, by weight. */
  vehicle: [UnitKind, number][];
  /** What it trains from its Barracks, by weight (medics still come as the commander adds them). */
  infantry: [UnitKind, number][];
  /** Most of the opening's infantry standing and queued at once, so its credits go on vehicles. Absent: no cap. */
  infantryCap?: number;
}

export const OPENING_SPECS: Record<Opening, OpeningSpec> = {
  // A tank column with rocket infantry in support.
  armour: { name: 'Tank column', vehicle: [['tank', 1]], infantry: [['rocketeer', 1]], infantryCap: 6 },
  // Massed infantry with fast buggies.
  infantry: { name: 'Infantry flood', vehicle: [['buggy', 1]], infantry: [['rifleman', 2], ['grenadier', 2], ['rocketeer', 1]] },
  // Artillery behind a screen of tanks.
  siege: { name: 'Artillery siege', vehicle: [['artillery', 2], ['tank', 1]], infantry: [['rifleman', 1]], infantryCap: 6 },
};

const set: (Opening | null)[] = [null, null, null, null];

/** Give a side a fixed opening, or null for none. Harness only. */
export function setOpening(owner: Owner, opening: Opening | null): void {
  set[owner] = opening;
}

/** The side's opening, or null (every battle a player fights). */
export const openingOf = (owner: Owner): Opening | null => set[owner] ?? null;

/**
 * The unit weights for this slot: the opening's when the side has one, else `choices` unchanged.
 * The commander's picker skips kinds it cannot train yet, as it always does.
 */
export function openingMix(owner: Owner, choices: [UnitKind, number][], slot: 'vehicle' | 'infantry'): [UnitKind, number][] {
  const o = set[owner];
  if (!o) return choices;
  return OPENING_SPECS[o][slot].map(([k, w]) => [k, w]);
}

/** Units every side may train whatever its opening: the economy, support, heroes and the General. */
const SUPPORT: UnitKind[] = ['hauler', 'medic', 'repairtruck', 'basetruck', 'general', ...HERO_KINDS];
const QUEUES: Category[] = ['infantry', 'vehicle', 'air', 'naval'];

/**
 * After the commander's turn (runAi): take back anything queued that the opening does not field (the
 * commander's anti-air answers, aircraft, raids by other kinds) and any infantry past the cap, every
 * one refunded as the player's Cancel refunds it. A no-op for a side without an opening.
 */
export function openingGuard(s: GameState, owner: Owner): void {
  const o = set[owner];
  if (!o) return;
  const spec = OPENING_SPECS[o];
  const allowed = new Set<UnitKind>([...spec.vehicle, ...spec.infantry].map(([k]) => k).concat(SUPPORT));
  const p = s.players[owner];
  for (const cat of QUEUES)
    for (let i = p.queues[cat].length - 1; i >= 0; i--) {
      const kind = p.queues[cat][i].kind;
      if (kind in UNITS && !allowed.has(kind as UnitKind)) doCancel(s, owner, cat, kind);
    }
  produce(s, owner, spec);
  if (spec.infantryCap === undefined) return;
  const mine = new Set(spec.infantry.map(([k]) => k));
  let n = s.units.filter(u => u.owner === owner && u.hp > 0 && mine.has(u.kind)).length;
  const q = s.players[owner].queues.infantry;
  n += q.filter(x => mine.has(x.kind as UnitKind)).length;
  for (let i = q.length - 1; i >= 0 && n > spec.infantryCap; i--)
    if (mine.has(q[i].kind as UnitKind)) {
      doCancel(s, owner, 'infantry', q[i].kind);
      n--;
    }
}

/** Credits a scripted side keeps back from its own production, for the commander's structures and research. */
export const OPENING_RESERVE = 600;

/**
 * Keeps the opening's lines busy from credits to spare, as a player committed to one plan does: the
 * ordinary commander often banks its credits for research and builds little, which would leave a
 * "tank column" with no tanks. One item a line, the kind furthest below its share of the plan
 * (standing and queued), so the choice is fixed by the state, never by a draw.
 */
function produce(s: GameState, owner: Owner, spec: OpeningSpec): void {
  const p = s.players[owner];
  for (const cat of ['vehicle', 'infantry'] as const) {
    const plan = spec[cat];
    const total = plan.reduce((a, [, w]) => a + w, 0);
    const count = (k: UnitKind) => s.units.filter(u => u.owner === owner && u.hp > 0 && u.kind === k).length + p.queues[cat].filter(q => q.kind === k).length;
    if (cat === 'infantry' && spec.infantryCap !== undefined && plan.reduce((a, [k]) => a + count(k), 0) >= spec.infantryCap) continue;
    if (p.queues[cat].length >= lineCount(s, owner, cat)) continue;
    const have = plan.reduce((a, [k]) => a + count(k), 0);
    const open = plan.filter(([k]) => canQueue(s, owner, cat, k));
    if (!open.length) continue;
    // Furthest below its share; ties to the plan's order.
    let best = open[0];
    let gap = -Infinity;
    for (const e of open) {
      const g = e[1] / total - (have ? count(e[0]) / have : 0);
      if (g > gap) {
        gap = g;
        best = e;
      }
    }
    if (p.credits >= costFor(s, owner, best[0]) + OPENING_RESERVE) doQueue(s, owner, cat, best[0]);
  }
}
