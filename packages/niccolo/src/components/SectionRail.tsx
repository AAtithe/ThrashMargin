import { UI } from '../theme';

export interface SectionDef {
  id: string;
  glyph: string;
  label: string;
  /** A dot shown on the tab when there's something fresh worth a look — deliberately a coarse
   * "something changed" signal (see callers for exactly what each section checks), not true
   * per-item read/unread tracking. */
  badge?: boolean;
  /** Which cluster this tab sits in (e.g. "Voyage", "House", "Story"). Tabs are still one flat,
   * always-visible row — grouping is a label plus a divider, not a collapse — see the file header
   * comment for why an actually-collapsing rail was rejected. Consecutive same-group entries in
   * the `sections` array render together; an ungrouped tab (no `group`) stands alone. */
  group?: string;
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
  background: UI.panelRaised,
  borderBottom: `1px solid ${UI.rule}`,
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
  color: UI.textSoft,
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
  color: UI.brass,
  borderBottom: `2px solid ${UI.brass}`,
  background: UI.tintBrass,
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
  background: UI.brass,
  flexShrink: 0,
};

const CLUSTER: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
};

/** A thin rule between clusters — height-fixed rather than `alignItems: 'stretch'`-driven, since
 * the rail wraps to a second line at narrow widths and a stretched divider would then span however
 * tall that wrapped row happens to be. */
const DIVIDER: React.CSSProperties = {
  width: 1,
  height: '1.3rem',
  background: UI.rule,
  margin: '0 0.5rem',
  flexShrink: 0,
};

const GROUP_LABEL: React.CSSProperties = {
  fontSize: '0.56rem',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: UI.textFaint,
  marginRight: '0.35rem',
  whiteSpace: 'nowrap',
};

interface SectionRailProps {
  sections: SectionDef[];
  active: string | null;
  onSelect: (id: string) => void;
}

/**
 * Grouping is a label plus a divider, not a collapse. Every tab stays clickable in one flat row —
 * an accordion that shows only one cluster's tabs at a time would reintroduce the exact bug this
 * rail was built to fix (see the file header comment): a section a player needs sitting one click
 * further away, easy to mistake for "not there at all". Consecutive entries sharing a `group` are
 * simply visually clustered together; an ungrouped tab stands alone with no label or divider of
 * its own.
 */
export default function SectionRail({ sections, active, onSelect }: SectionRailProps) {
  let lastGroup: string | undefined;
  return (
    <div id="section-rail" style={RAIL}>
      {sections.map((s, i) => {
        const startsNewGroup = s.group !== lastGroup;
        lastGroup = s.group;
        return (
          <div key={s.id} style={CLUSTER}>
            {startsNewGroup && i > 0 && <span style={DIVIDER} />}
            {startsNewGroup && s.group && <span style={GROUP_LABEL}>{s.group}</span>}
            <button
              id={`section-tab-${s.id}`}
              style={s.id === active ? TAB_ACTIVE : TAB}
              onClick={() => onSelect(s.id)}
            >
              <span style={GLYPH}>{s.glyph}</span>
              <span style={LABEL}>{s.label}</span>
              {s.badge && <span style={BADGE} />}
            </button>
          </div>
        );
      })}
    </div>
  );
}
