export interface SectionDef {
  id: string;
  glyph: string;
  label: string;
  /** A dot shown on the tab when there's something fresh worth a look — deliberately a coarse
   * "something changed" signal (see callers for exactly what each section checks), not true
   * per-item read/unread tracking. */
  badge?: boolean;
}

/**
 * A single horizontal bar of section tabs, sitting above the map.
 *
 * Deliberately horizontal rather than the vertical column this started as: ten tabs at ~65px each
 * overflowed a short viewport, and because the column scrolled *internally* the tabs below the fold
 * (Household among them) simply looked absent — a player reported being unable to reassign anyone
 * because the tab had effectively vanished. A single row fits every section on screen at once at any
 * realistic window height, and `flexWrap` handles genuinely narrow widths by wrapping to a second
 * line rather than hiding anything.
 */
const RAIL: React.CSSProperties = {
  flexShrink: 0,
  background: '#161009',
  borderBottom: '1px solid #2a2117',
  display: 'flex',
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'stretch',
  padding: '0 0.75rem',
  gap: '0.1rem',
};

const TAB: React.CSSProperties = {
  position: 'relative',
  background: 'none',
  // Longhands only, never the `border` shorthand alongside a `borderBottom` longhand: toggling
  // between TAB and TAB_ACTIVE on the same element then makes React drop one against the other
  // ("Removing borderLeft border" — a real dev warning this codebase has already been bitten by,
  // not a lint nag). Any future active/hover variant here must keep to longhands too.
  borderTop: 'none',
  borderRight: 'none',
  borderLeft: 'none',
  borderBottom: '2px solid transparent',
  color: '#8a7a5a',
  fontFamily: 'inherit',
  padding: '0.5rem 0.7rem',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: '0.35rem',
  whiteSpace: 'nowrap',
};

const TAB_ACTIVE: React.CSSProperties = {
  ...TAB,
  color: '#e8d5a3',
  borderBottom: '2px solid #c9a24a',
  background: 'rgba(201,162,74,0.09)',
};

const GLYPH: React.CSSProperties = { fontSize: '0.95rem', lineHeight: 1 };

const LABEL: React.CSSProperties = {
  fontSize: '0.62rem',
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
};

const BADGE: React.CSSProperties = {
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  background: '#c9a24a',
  flexShrink: 0,
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
