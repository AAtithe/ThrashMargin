const WRAP: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  fontSize: '0.78rem',
  color: '#8a7a5a',
};

const SEGMENT: React.CSSProperties = {
  width: '0.5rem',
  height: '0.5rem',
  background: '#e8d5a3',
  display: 'inline-block',
};

interface CampaignProgressProps {
  chapterNumber: number;
  title: string;
}

/**
 * Ambient "what arc am I in" readout (Phase 15) — sits in the header alongside the existing
 * cash/hold/week/conscience line, giving a constant throughline outside the one-time chapter-close
 * card's own moment. Deliberately does NOT show "Chapter N of 8" or size the segment row against
 * an eventual total: Section 14 ("Scope Control") treats chapters 5-8 as unconfirmed, not a
 * committed roadmap, so baking a denominator into this UI — even just in the width math, not the
 * label text — would silently promise content that isn't decided yet. Instead, one filled segment
 * renders per chapter that actually exists *so far* (0 through the current one), with nothing
 * unfilled trailing it to imply a fixed remaining count.
 */
export default function CampaignProgress({ chapterNumber, title }: CampaignProgressProps) {
  return (
    <div style={WRAP}>
      <span>
        Chapter {chapterNumber} — {title}
      </span>
      <span style={{ display: 'flex', gap: '0.15rem' }}>
        {Array.from({ length: chapterNumber + 1 }, (_, i) => (
          <span key={i} style={SEGMENT} />
        ))}
      </span>
    </div>
  );
}
