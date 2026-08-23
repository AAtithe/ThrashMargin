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

/**
 * The parentage resolution (Chapter 8, Phase 25).
 *
 * **Scales, never gates.** §8 promises "a hidden dossier the player assembles across all 8 chapters
 * … the resolution follows the novels' answer and fires in Chapter 8." The obvious implementation —
 * a threshold, like the Vatachino's — would be wrong here in a way that matters: every parentage
 * piece before Phase 22 sat behind an optional branch, and a player who declined them all would
 * arrive at the finale with nothing to resolve and a chapter that could not close. Phase 22
 * guaranteed a floor of two, but the right shape is still a *reading* rather than a pass mark: a
 * full dossier names the answer outright, a thin one gets something Jordan can still deny.
 *
 * That also makes fifty hours of optional diligence visibly worth something, which a threshold
 * cannot — under a threshold the fourth piece and the eighth are identical.
 */
export type ParentageConfidence = 'unproven' | 'circumstantial' | 'documented' | 'incontestable';

/** Piece counts at which the reading changes. Deliberately reachable: two is the guaranteed floor
 * (Marian's indenture and Godscalc's letter), and the top band needs real work across three
 * chapters rather than a lucky run. */
export const PARENTAGE_BANDS: { min: number; confidence: ParentageConfidence }[] = [
  { min: 7, confidence: 'incontestable' },
  { min: 5, confidence: 'documented' },
  { min: 3, confidence: 'circumstantial' },
  { min: 0, confidence: 'unproven' },
];

export interface ParentageReading {
  pieces: number;
  confidence: ParentageConfidence;
  /** The flag Chapter 8's content branches on, so the resolution is authored as content like every
   * other outcome rather than hard-coded into a component. */
  flag: string;
  /** True once the dossier is strong enough that the answer can be asserted rather than suspected —
   * the line between "we believe" and "we can prove", which is the whole of the St Pol endgame. */
  provable: boolean;
}

export function readParentage(state: GameState): ParentageReading {
  const pieces = evidenceOnTrack(state.evidence ?? [], 'parentage').length;
  const confidence = PARENTAGE_BANDS.find(b => pieces >= b.min)!.confidence;
  return {
    pieces,
    confidence,
    flag: `parentage_${confidence}`,
    provable: confidence === 'documented' || confidence === 'incontestable',
  };
}
