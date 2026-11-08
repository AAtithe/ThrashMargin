/**
 * The strip over the board while the AI factions' turns are replayed: whose turn it is, a summary
 * of what they did, the beat being shown, and a way out. Purely visual: the game behind it is
 * already resolved and saved, and any click or key skips (see useSkipOnInput in Game.tsx).
 */
import { FACTION_COLORS, factionName, type GameState } from 'shared/sim';
import type { Beat } from '../game/replay';
import { FONT, UI } from '../theme';

export default function ReplayBanner({ state, beats, index, onSkip }: {
  state: GameState;
  beats: Beat[];
  /** Beats revealed so far (1 … beats.length while playing). */
  index: number;
  onSkip: () => void;
}) {
  const current = beats[Math.max(0, index - 1)];
  if (!current) return null;
  // The banner of the faction whose beat is showing.
  let b = Math.max(0, index - 1);
  while (b > 0 && beats[b].kind !== 'banner') b--;
  const banner = beats[b];
  const fc = FACTION_COLORS[banner.faction] ?? FACTION_COLORS[0];
  const factions = beats.filter(x => x.kind === 'banner');
  const nth = factions.indexOf(banner) + 1;
  const line = current.kind === 'banner' ? null : current;

  return (
    <div role="status" aria-live="polite"
      style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 20, width: 'min(440px, calc(100% - 32px))', pointerEvents: 'none' }}>
      <div key={`banner-${b}`} className="tm-anim-rise"
        style={{ background: UI.panel, border: `1px solid ${UI.ruleStrong}`, borderLeft: `4px solid ${fc.fill}`, borderRadius: 8, padding: '8px 12px', boxShadow: `0 8px 24px ${UI.shadow}`, display: 'grid', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: fc.fill, border: `1px solid ${fc.edge}`, flexShrink: 0 }} />
          <span style={{ fontFamily: FONT.display, fontSize: 15, fontWeight: 600, color: UI.text }}>{factionName(state, banner.faction)}</span>
          <span style={{ fontSize: 11.5, color: UI.textSoft, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{banner.text}</span>
          {factions.length > 1 && <span className="tm-num" style={{ fontSize: 10.5, color: UI.textFaint, fontFamily: FONT.data }}>{nth}/{factions.length}</span>}
          <button type="button" onClick={onSkip} className="tm-btn"
            style={{ pointerEvents: 'auto', background: 'transparent', border: `1px solid ${UI.rule}`, color: UI.textSoft, borderRadius: 5, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}>
            Skip
          </button>
        </div>
        <div key={`line-${index}`} className={line ? 'tm-anim-fade' : undefined}
          style={{ fontSize: 12, lineHeight: 1.4, color: line?.againstViewer ? UI.bad : UI.text, minHeight: 17 }}>
          {line ? line.text : <span style={{ color: UI.textFaint }}>Click or press any key to skip</span>}
        </div>
      </div>
    </div>
  );
}
