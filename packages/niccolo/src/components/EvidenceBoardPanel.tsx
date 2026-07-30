import { findCity } from '../sim/content';
import { UNMASK_EVIDENCE_THRESHOLD, evidenceOnTrack } from '../sim/dossier';
import type { EvidenceItem, EvidenceTrack, House } from '../sim/types';

/**
 * The Evidence Board (design doc §11 screen 7, and Section 12's own named system for Chapter 5:
 * "evidence board full UI in Ch5"). Two tracks, side by side down the popup: the long parentage
 * dossier §8 describes as assembled across all eight chapters (so this reads as deliberately
 * unfinished — there is no progress bar toward an answer, because the answer is Chapter 8's), and
 * the short Vatachino track, which *does* have a threshold and shows progress toward it.
 *
 * Read-only by design. Nothing on this screen is an action: evidence arrives from a scripted event's
 * choice or from an agent already placed inside a masked house, and the unmasking happens on its own
 * the week the dossier completes. That's the same read-only discipline `ObjectivesPanel` uses, and
 * for the same reason — a board that could be "submitted" would turn a collection into a puzzle the
 * design doc never asked for.
 */

const LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: '#8a7a5a',
  margin: '0.9rem 0 0.4rem',
};

const ROW: React.CSSProperties = {
  padding: '0.4rem 0',
  borderBottom: '1px solid #2a2117',
  fontSize: '0.78rem',
};

const KIND_LABEL: Record<EvidenceItem['kind'], string> = {
  document: 'document',
  testimony: 'testimony',
  date: 'date',
};

function EvidenceRows({ items }: { items: EvidenceItem[] }) {
  if (items.length === 0) {
    return (
      <p style={{ fontSize: '0.75rem', color: '#6a5a40', margin: '0 0 0.3rem', fontStyle: 'italic' }}>
        Nothing pinned here yet.
      </p>
    );
  }
  return (
    <>
      {items.map(e => (
        <div key={e.id} style={ROW}>
          <div>
            {e.name}{' '}
            <span style={{ fontSize: '0.68rem', color: '#8a7a5a' }}>({KIND_LABEL[e.kind]}, week {e.discoveredWeek})</span>
          </div>
          <div style={{ fontSize: '0.7rem', color: '#8a7a5a' }}>{e.description}</div>
        </div>
      ))}
    </>
  );
}

interface EvidenceBoardPanelProps {
  evidence: EvidenceItem[];
  houses: House[];
  flags: Record<string, boolean>;
}

export default function EvidenceBoardPanel({ evidence, houses, flags }: EvidenceBoardPanelProps) {
  // Only the tracks that actually have content or a live question — Chapters 1-4 set nothing on
  // either, so a campaign that hasn't reached Chapter 5 sees this whole section not offered at all
  // (see GameScreen's rail gating), and a campaign mid-Chapter-5 sees the tracks fill in as they do.
  const maskedHouses = houses.filter(h => h.hiddenBackers);

  return (
    <div>
      <p style={{ ...LABEL, marginTop: 0 }}>The parentage dossier</p>
      <p style={{ fontSize: '0.75rem', color: '#8a7a5a', margin: '0 0 0.4rem' }}>
        Assembled a piece at a time, across years. Nothing here answers the question yet.
      </p>
      <EvidenceRows items={evidenceOnTrack(evidence, 'parentage')} />

      {maskedHouses.map(house => {
        const hidden = house.hiddenBackers!;
        const held = evidenceOnTrack(evidence, hidden.track as EvidenceTrack);
        const unmasked = !!flags[hidden.revealedByFlag];
        return (
          <div key={house.id}>
            <p style={LABEL}>{house.name} — who stands behind it</p>
            <p style={{ fontSize: '0.75rem', color: unmasked ? '#3a6b5a' : '#a08040', margin: '0 0 0.4rem' }}>
              {unmasked
                ? 'Named.'
                : `${held.length} of ${UNMASK_EVIDENCE_THRESHOLD} pieces in hand — not yet enough to name anybody.`}
            </p>
            {unmasked && (
              <p style={{ fontSize: '0.78rem', color: '#e8d5a3', margin: '0 0 0.5rem' }}>{hidden.text}</p>
            )}
            <EvidenceRows items={held} />
            {!unmasked && (
              <p style={{ fontSize: '0.7rem', color: '#6a5a40', margin: '0.4rem 0 0', fontStyle: 'italic' }}>
                An agent placed inside the company may send more. So, for a price, may a notary.
                Seat: {findCity(house.homeCity)?.name ?? house.homeCity}.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
