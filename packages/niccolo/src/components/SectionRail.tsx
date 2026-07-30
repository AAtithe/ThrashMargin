export interface SectionDef {
  id: string;
  glyph: string;
  label: string;
  /** A dot shown on the tab when there's something fresh worth a look — deliberately a coarse
   * "something changed" signal (see callers for exactly what each section checks), not true
   * per-item read/unread tracking. */
  badge?: boolean;
}

const RAIL: React.CSSProperties = {
  width: '58px',
  flexShrink: 0,
  background: '#161009',
  borderRight: '1px solid #2a2117',
  display: 'flex',
  flexDirection: 'column',
  paddingTop: '0.8rem',
  gap: '0.1rem',
  overflowY: 'auto',
};

const TAB: React.CSSProperties = {
  position: 'relative',
  background: 'none',
  border: 'none',
  borderLeft: '3px solid transparent',
  color: '#8a7a5a',
  fontFamily: 'inherit',
  padding: '0.65rem 0.25rem',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.3rem',
};

const TAB_ACTIVE: React.CSSProperties = {
  ...TAB,
  color: '#e8d5a3',
  borderLeft: '3px solid #c9a24a',
  background: 'rgba(201,162,74,0.09)',
};

const GLYPH: React.CSSProperties = { fontSize: '1.05rem', lineHeight: 1 };

const LABEL: React.CSSProperties = {
  writingMode: 'vertical-rl',
  textOrientation: 'mixed',
  fontSize: '0.6rem',
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
};

const BADGE: React.CSSProperties = {
  position: 'absolute',
  top: '4px',
  right: '6px',
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  background: '#c9a24a',
};

interface SectionRailProps {
  sections: SectionDef[];
  active: string | null;
  onSelect: (id: string) => void;
}

export default function SectionRail({ sections, active, onSelect }: SectionRailProps) {
  return (
    <div id="section-rail" style={RAIL}>
      {sections.map(s => (
        <button
          key={s.id}
          id={`section-tab-${s.id}`}
          style={s.id === active ? TAB_ACTIVE : TAB}
          onClick={() => onSelect(s.id)}
        >
          <span style={GLYPH}>{s.glyph}</span>
          <span style={LABEL}>{s.label}</span>
          {s.badge && <span style={BADGE} />}
        </button>
      ))}
    </div>
  );
}
