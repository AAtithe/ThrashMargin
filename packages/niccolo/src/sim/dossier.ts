import { HOUSES } from './content';
import type { EvidenceItem, EvidenceTrack, GameState, House } from './types';

/**
 * The Evidence Board's own small model (design doc §11 screen 7, the screen Section 12 names as
 * Chapter 5's system: "evidence board full UI in Ch5"). Deliberately thin, in the same reduced-
 * fidelity spirit as `condotta.ts` and `estates.ts` on their own first outings: evidence is held,
 * counted per track, and — for the one track that has a question with an answer — read against a
 * threshold. There is no scoring, no partial-credit weighting, and no per-item reliability, because
 * §8 describes the dossier as a *collection* the player assembles, and reliability already has a
 * home in the news system rather than needing a second one here.
 */

type EvidenceSpec = Omit<EvidenceItem, 'discoveredWeek'>;

/**
 * How many items on a house's own track are enough to name its backers. Three, matching the number
 * of leads Chapter 5's Vatachino actually has authored — chosen so every route to the answer is
 * real: the chapter's own events hand over two of them, and the third comes either from an agent
 * placed inside the house (early, cheap, and uncertain) or from paying an informant outright late
 * in the chapter (certain, and expensive). Neither route is required to *resolve* the Vatachino
 * thread; both only decide whether it resolves with a name attached.
 */
export const UNMASK_EVIDENCE_THRESHOLD = 3;

/** Add a newly discovered item, unless it's already pinned — mirrors `addSecret`'s own idempotency,
 * for the same reason: an event fires once, but an agent surfacing leads runs every week and must
 * never double-count one it already handed over. */
export function addEvidence(evidence: EvidenceItem[], week: number, spec: EvidenceSpec): EvidenceItem[] {
  if (evidence.some(e => e.id === spec.id)) return evidence;
  return [...evidence, { ...spec, discoveredWeek: week }];
}

export function evidenceOnTrack(evidence: EvidenceItem[], track: EvidenceTrack): EvidenceItem[] {
  return evidence.filter(e => e.track === track);
}

/** True once this house's own track holds enough to name its backers. A house with no
 * `hiddenBackers` has nothing to unmask and is never "unmasked". */
export function backersKnown(house: House, state: GameState): boolean {
  if (!house.hiddenBackers) return false;
  return !!state.flags[house.hiddenBackers.revealedByFlag];
}

/**
 * Runs every ADVANCE_WEEK. Returns the flag ids that should now be set because the player has
 * assembled enough of a masked house's track — generic over every house carrying `hiddenBackers`,
 * so a later chapter's own masked house inherits this for free rather than needing the Vatachino's
 * name written into the engine. Returns an empty array in the common case, so the caller can skip
 * touching `flags` at all.
 */
export function resolveUnmasking(state: GameState): string[] {
  const evidence = state.evidence ?? [];
  const out: string[] = [];
  for (const house of HOUSES) {
    const hidden = house.hiddenBackers;
    if (!hidden) continue;
    if (state.flags[hidden.revealedByFlag]) continue;
    if (evidenceOnTrack(evidence, hidden.track).length >= UNMASK_EVIDENCE_THRESHOLD) {
      out.push(hidden.revealedByFlag);
    }
  }
  return out;
}
