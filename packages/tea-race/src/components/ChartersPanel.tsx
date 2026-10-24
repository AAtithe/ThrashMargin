import { charterText, chartersOn } from '../sim/charters';
import { regionName } from '../sim/content';
import { FONT, UI, money } from '../theme';
import { Label, Panel, bodySmall, dataText } from './ui';
import type { Captain, Charter, GameState } from '../sim/types';

/**
 * Owners' charters: yours in full, everyone else's in one line each. Public on purpose — reading
 * what a rival's owners want from them is how you guess where she is going next.
 */
export default function ChartersPanel({ state, captain }: { state: GameState; captain: Captain }) {
  if (!chartersOn(state)) return null;
  const rivals = state.captains.filter(c => c.id !== captain.id);
  return (
    <Panel title="Owners' charters" aside={<Label>{`${captain.chartersDone ?? 0} completed`}</Label>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
        {(captain.charters ?? []).map(c => (
          <CharterCard key={c.id} charter={c} colour={captain.colour} />
        ))}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', borderTop: `1px solid ${UI.rule}`, paddingTop: '0.4rem' }}>
          <span style={{ ...dataText, fontSize: '0.6rem', letterSpacing: '0.14em', color: UI.textFaint, textTransform: 'uppercase' }}>
            What their owners want
          </span>
          {rivals.map(r => (
            <span key={r.id} style={{ ...bodySmall, fontSize: '0.72rem', display: 'flex', gap: '0.35rem', alignItems: 'baseline' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: r.colour, flex: '0 0 auto', alignSelf: 'center' }} />
              <span style={{ color: UI.textSoft }}>
                {(r.charters ?? []).map(c => `${charterText(c).toLowerCase()} (${c.progress}/${c.target})`).join('; ') || 'nothing in hand'}
              </span>
            </span>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function CharterCard({ charter: c, colour }: { charter: Charter; colour: string }) {
  const pct = Math.round((c.progress / c.target) * 100);
  return (
    <div style={card}>
      <Seal colour={colour} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'baseline' }}>
          <span style={{ fontFamily: FONT.display, fontSize: '0.84rem', color: UI.text }}>{charterText(c)}</span>
          <span style={{ ...dataText, fontSize: '0.7rem', color: UI.brass, whiteSpace: 'nowrap' }}>{money(c.reward)}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <span style={track} role="progressbar" aria-valuemin={0} aria-valuemax={c.target} aria-valuenow={c.progress}>
            <span style={{ ...fill, width: `${pct}%` }} />
          </span>
          <span style={{ ...dataText, fontSize: '0.66rem', color: UI.textSoft }}>
            {c.progress}/{c.target}
          </span>
        </span>
        {c.kind === 'spread' && (c.regions?.length ?? 0) > 0 && (
          <span style={{ ...bodySmall, fontSize: '0.68rem', color: UI.textFaint }}>
            So far: {c.regions!.map(regionName).join(', ')}
          </span>
        )}
      </div>
    </div>
  );
}

/** A wax seal on the corner of the owners' letter, in the captain's colour. */
function Seal({ colour }: { colour: string }) {
  return (
    <svg width={34} height={38} viewBox="0 0 34 38" style={{ flex: '0 0 auto' }} aria-hidden="true">
      <rect x={1} y={1} width={26} height={32} fill={UI.panel} stroke={UI.ruleStrong} strokeWidth={1} />
      <path d="M5 8 H23 M5 12 H23 M5 16 H19 M5 20 H21" stroke={UI.textFaint} strokeWidth={0.8} />
      <circle cx={24} cy={28} r={8} fill={colour} stroke={UI.text} strokeWidth={0.6} />
      <circle cx={24} cy={28} r={5} fill="none" stroke={UI.panel} strokeWidth={0.8} opacity={0.8} />
      <path d="M21.5 28 l2 2 l3.5 -4" fill="none" stroke={UI.panel} strokeWidth={1} />
    </svg>
  );
}

const card: React.CSSProperties = {
  display: 'flex',
  gap: '0.55rem',
  alignItems: 'flex-start',
  border: `1px solid ${UI.rule}`,
  borderRadius: 2,
  padding: '0.45rem 0.5rem',
};

const track: React.CSSProperties = {
  flex: 1,
  height: 6,
  background: UI.panelRaised,
  border: `1px solid ${UI.rule}`,
  borderRadius: 3,
  overflow: 'hidden',
  display: 'block',
};

const fill: React.CSSProperties = {
  display: 'block',
  height: '100%',
  background: UI.brass,
  transition: 'width 400ms ease',
};
