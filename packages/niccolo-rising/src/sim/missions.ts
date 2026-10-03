/**
 * Missions (Phase 5): the first novel's arc told as a chain of Torn-style missions.
 *
 * Pure helpers only. The verbs that accept, complete and abandon a mission, and the deadline that
 * fails one, live in `actions.ts` with every other verb, because they share its logging, rewards
 * and rejection machinery. This file answers three questions for both the reducer and the UI:
 * which missions can be taken now, how far along each objective is, and what an event counts for.
 */
import missionsJson from '../content/missions.json';
import { CONTRACT, COURSE, DESTINATION, ITEM, JOB, OPPONENT, SCHEME } from './content';
import type { GameState, Mission, MissionEvent, Objective } from './types';

export const MISSIONS = missionsJson as Mission[];

export const MISSION: Record<string, Mission> = {};
for (const m of MISSIONS) MISSION[m.id] = m;

/** Counting objectives keep a running total in `progress`; the rest are read live. */
export function isCounting(o: Objective): boolean {
  return o.kind === 'scheme' || o.kind === 'duel' || o.kind === 'train' || o.kind === 'arrive';
}

/** Missions the player could accept right now, ignoring whether one is already active. */
export function availableMissions(s: GameState): Mission[] {
  return MISSIONS.filter(
    m =>
      !s.missions.done.includes(m.id) &&
      s.missions.active?.id !== m.id &&
      (!m.after || s.missions.done.includes(m.after)),
  );
}

/** The next mission in the chain, whether or not the level requirement is met yet. */
export function nextMission(s: GameState): Mission | null {
  return availableMissions(s)[0] ?? null;
}

export interface ObjectiveStatus {
  label: string;
  have: number;
  need: number;
  met: boolean;
}

/** "Bolt of Lucchese silk" reads "bolt of Lucchese silk": only the first letter drops, so proper names survive. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Where one objective of the active mission stands. `progress` is the stored count for its slot. */
export function objectiveStatus(s: GameState, o: Objective, progress: number): ObjectiveStatus {
  const out = (label: string, have: number, need: number): ObjectiveStatus => ({
    label,
    have: Math.min(have, need),
    need,
    met: have >= need,
  });
  switch (o.kind) {
    case 'scheme':
      return out(
        o.schemeId ? `Pull off ${(SCHEME[o.schemeId] ? lowerFirst(SCHEME[o.schemeId].name) : undefined) ?? o.schemeId}` : 'Pull off schemes of any kind',
        progress,
        o.count,
      );
    case 'duel':
      return out(o.opponentId ? `Beat ${OPPONENT[o.opponentId]?.name ?? o.opponentId}` : 'Win duels against anyone', progress, o.count);
    case 'train':
      return out(o.stat ? `Train ${o.stat}` : 'Gain battle stats in the yards', Math.floor(progress), o.amount);
    case 'arrive':
      return out(`Travel to ${DESTINATION[o.city]?.name ?? o.city}`, progress, 1);
    case 'deliver':
      return out(`Bring ${(ITEM[o.itemId] ? lowerFirst(ITEM[o.itemId].name) : undefined) ?? o.itemId}`, s.inventory[o.itemId] ?? 0, o.qty);
    case 'pay':
      return out('Put groats into it', s.groats, o.groats);
    case 'course':
      return out(`Complete ${COURSE[o.courseId]?.name ?? o.courseId}`, s.coursesDone.includes(o.courseId) ? 1 : 0, 1);
    case 'job': {
      const job = JOB[o.jobId];
      const holding = s.job?.id === o.jobId ? s.job.rank + 1 : 0;
      return out(`Hold the post of ${job?.ranks[o.rank]?.name ?? 'a post'} at ${job?.name ?? o.jobId}`, holding >= o.rank + 1 ? 1 : 0, 1);
    }
    case 'level':
      return out(`Reach level ${o.level}`, s.level, o.level);
    case 'work':
      return out(`Raise your ${o.stat}`, Math.floor(s.work[o.stat]), o.value);
  }
}

/** Every objective of the active mission, in order. Empty when no mission is active. */
export function activeStatus(s: GameState): ObjectiveStatus[] {
  const a = s.missions.active;
  const m = a ? MISSION[a.id] : null;
  if (!a || !m) return [];
  return m.objectives.map((o, i) => objectiveStatus(s, o, a.progress[i] ?? 0));
}

/** Whether the active mission can be handed in. */
export function missionReady(s: GameState): boolean {
  const st = activeStatus(s);
  return st.length > 0 && st.every(x => x.met);
}

/** The same, for the house contract in hand (Phase 6). Contracts reuse the mission objectives. */
export function contractStatus(s: GameState): ObjectiveStatus[] {
  const c = s.house?.contract;
  const def = c ? CONTRACT[c.id]?.contract : null;
  if (!c || !def) return [];
  return def.objectives.map((o, i) => objectiveStatus(s, o, c.progress[i] ?? 0));
}

export function contractReady(s: GameState): boolean {
  const st = contractStatus(s);
  return st.length > 0 && st.every(x => x.met);
}

/** The cap a counting objective's stored count stops at; zero for holding objectives. */
export function objectiveCap(o: Objective): number {
  return o.kind === 'train' ? o.amount : o.kind === 'arrive' ? 1 : o.kind === 'scheme' || o.kind === 'duel' ? o.count : 0;
}

/** Counts events against one list of objectives, mutating `progress`. Returns whether any count moved. */
function trackObjectives(objectives: Objective[], progress: number[], events: MissionEvent[]): boolean {
  let changed = false;
  objectives.forEach((o, i) => {
    let add = 0;
    for (const e of events) {
      if (o.kind === 'scheme' && e.kind === 'scheme' && (!o.schemeId || o.schemeId === e.schemeId)) add += 1;
      else if (o.kind === 'duel' && e.kind === 'duel' && (!o.opponentId || o.opponentId === e.opponentId)) add += 1;
      else if (o.kind === 'train' && e.kind === 'train' && (!o.stat || o.stat === e.stat)) add += e.gain;
      else if (o.kind === 'arrive' && e.kind === 'arrive' && o.city === e.city) add += 1;
    }
    if (add === 0) return;
    const before = progress[i] ?? 0;
    const after = Math.min(objectiveCap(o), Math.round((before + add) * 100) / 100);
    if (after !== before) {
      progress[i] = after;
      changed = true;
    }
  });
  return changed;
}

/**
 * Counts events against the active mission's and the house contract's counting objectives. Mutates
 * the draft; returns whether any count moved. One event can count for both: a duel won for a
 * mission is still a duel won for the house. Counts stop at each objective's target.
 */
export function trackEvents(d: GameState, events: MissionEvent[]): boolean {
  if (events.length === 0) return false;
  let changed = false;
  const a = d.missions.active;
  const m = a ? MISSION[a.id] : null;
  if (a && m && trackObjectives(m.objectives, a.progress, events)) changed = true;
  const c = d.house?.contract;
  const def = c ? CONTRACT[c.id]?.contract : null;
  if (c && def && trackObjectives(def.objectives, c.progress, events)) changed = true;
  return changed;
}
