import { UI } from '../theme';
import { findCity } from '../sim/content';
import {
  FREEPLAY_TARGET_NET_WORTH,
  checkFreeplayWin,
  rivalSeat,
  standings,
} from '../sim/freeplay';
import { agentPlacementCost } from '../sim/houses';
import type { GameState } from '../sim/types';

/**
 * Free play's standings (Phase 27).
 *
 * **On showing a score at all.** §11 and Phase 15 both rejected an ambient net-worth readout, and
 * Phase 25 deferred the real figure to the epilogue — because in the story campaign a permanently
 * visible number becomes a de facto win condition and quietly undermines "no scripted victory".
 * This panel is not a reversal of that call: it renders only in free play, which is an explicitly
 * competitive sandbox with a stated target, where hiding the score would make the mode unplayable
 * rather than principled. A campaign save has no rivals to stand against and never reaches here.
 *
 * One action lives here (Phase 29): placing an agent inside a rival's counting house. It sits on
 * this panel rather than with the other agent placements in `HousesPanel` because the target is a
 * *rival*, and this is the screen where the player is already looking at rivals — and because a
 * rival is a free-play object, so an entry point in the campaign's own Houses panel would be dead
 * there. Everything else on this screen stays read-only.
 */

const LABEL: React.CSSProperties = {
  fontSize: '0.75rem',
  letterSpacing: '0.15em',
  textTransform: 'uppercase',
  color: UI.textSoft,
  margin: '0.9rem 0 0.4rem',
};

const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '0.5rem',
  padding: '0.4rem 0',
  borderBottom: `1px solid ${UI.rule}`,
  fontSize: '0.82rem',
};

interface StandingsPanelProps {
  state: GameState;
  onPlaceAgent: (traderId: string) => void;
}

export default function StandingsPanel({ state, onPlaceAgent }: StandingsPanelProps) {
  const table = standings(state);
  const leader = table[0]?.netWorth ?? 0;
  const win = checkFreeplayWin(state);
  const notes = (state.lastAiNotes ?? []).filter(() => true);

  return (
    <div>
      {state.freeplayWonWeek !== undefined && (
        <p style={{ fontSize: '0.8rem', color: win.playerWon ? UI.good : UI.warn, margin: '0 0 0.6rem' }}>
          {win.playerWon
            ? `The house passed ${FREEPLAY_TARGET_NET_WORTH.toLocaleString()}f in week ${state.freeplayWonWeek}. You have won — and nothing stops you carrying on.`
            : `${win.winners[0]?.name ?? 'A rival'} passed ${FREEPLAY_TARGET_NET_WORTH.toLocaleString()}f in week ${state.freeplayWonWeek}. The board is still open if you want it back.`}
        </p>
      )}

      <p style={{ ...LABEL, marginTop: 0 }}>Standing — first to {FREEPLAY_TARGET_NET_WORTH.toLocaleString()}f</p>
      {table.map((row, i) => {
        // A bar against the leader rather than against the target: early on every bar would be a
        // sliver, and the question the player is actually asking is "how far behind am I".
        const share = leader > 0 ? Math.max(0, Math.min(1, row.netWorth / leader)) : 0;
        const seat = row.isPlayer ? null : rivalSeat(row.id);
        return (
          <div key={row.id} style={ROW}>
            <span style={{ flex: 1 }}>
              <span style={{ color: UI.textFaint, fontSize: '0.72rem' }}>{i + 1}. </span>
              <span style={{ color: row.isPlayer ? UI.brass : UI.text }}>{row.name}</span>
              {seat && <span style={{ color: UI.textSoft, fontSize: '0.7rem' }}> — out of {seat}</span>}
              {row.netWorth >= FREEPLAY_TARGET_NET_WORTH && (
                <span style={{ color: UI.good, fontSize: '0.7rem' }}> · past the post</span>
              )}
              <span
                style={{
                  display: 'block',
                  marginTop: '0.2rem',
                  height: '3px',
                  width: `${Math.round(share * 100)}%`,
                  background: row.isPlayer ? UI.brass : UI.ruleStrong,
                }}
              />
            </span>
            <span style={{ color: row.isPlayer ? UI.brass : UI.textSoft, fontFamily: 'inherit' }}>
              {row.netWorth.toLocaleString()}f
            </span>
          </div>
        );
      })}

      <p style={LABEL}>Agents inside their houses</p>
      {state.lastRivalPlant?.week === state.week && (
        <p style={{ fontSize: '0.78rem', color: UI.verdigris, margin: '0 0 0.4rem' }}>
          {state.lastRivalPlant.agentName} has got a false price into {state.lastRivalPlant.traderName}
          {"'"}s books for {state.lastRivalPlant.cityName}. They will trade on it until their own next
          report from there contradicts it.
        </p>
      )}
      {(state.aiTraders ?? []).map(t => {
        const inside = state.agents.some(a => a.placement.type === 'rival' && a.placement.traderId === t.id);
        const cost = agentPlacementCost(state.agents);
        return (
          <div key={t.id} style={{ ...ROW, borderBottom: 'none', padding: '0.25rem 0' }}>
            <span style={{ flex: 1 }}>
              {t.name}
              {inside && <span style={{ color: UI.verdigris, fontSize: '0.72rem' }}> — we have a man inside</span>}
            </span>
            {!inside && (
              <button
                style={{
                  background: UI.panel, border: `1px solid ${UI.rule}`, color: UI.text,
                  fontFamily: 'inherit', fontSize: '0.7rem', padding: '0.15rem 0.45rem',
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}
                disabled={cost > state.cash}
                onClick={() => onPlaceAgent(t.id)}
              >
                Place an agent — {cost}f{cost > state.cash && ' (short)'}
              </button>
            )}
          </div>
        );
      })}
      <p style={{ fontSize: '0.72rem', color: UI.textFaint, margin: '0.3rem 0 0', fontStyle: 'italic' }}>
        A man inside feeds their counting house a false price now and then. It holds only until their
        own next report from that city arrives — so the better-informed the rival, the shorter the lie
        lasts.
      </p>

      <p style={LABEL}>What the rivals did this week</p>
      {notes.length === 0 ? (
        <p style={{ fontSize: '0.75rem', color: UI.textFaint, margin: 0, fontStyle: 'italic' }}>
          Nothing reported — their hulls are at sea.
        </p>
      ) : (
        notes.slice(0, 8).map((n, i) => (
          <p key={`${n.traderId}-${n.goodId}-${i}`} style={{ fontSize: '0.76rem', color: UI.textSoft, margin: '0 0 0.2rem' }}>
            {n.traderName} {n.direction === 1 ? 'bought' : 'sold'} {n.quantity} at{' '}
            {findCity(n.cityId)?.name ?? n.cityId}.
          </p>
        ))
      )}
      {notes.length > 8 && (
        <p style={{ fontSize: '0.72rem', color: UI.textFaint, margin: '0.2rem 0 0' }}>
          …and {notes.length - 8} more.
        </p>
      )}

      <p style={{ fontSize: '0.72rem', color: UI.textFaint, margin: '0.8rem 0 0', fontStyle: 'italic' }}>
        A rival never sees a price it has not reached, never ignores travel time, and never trades at
        a price you could not also get. What separates them is capital and how fresh their reports
        are — which is what your own couriers are for.
      </p>
    </div>
  );
}
