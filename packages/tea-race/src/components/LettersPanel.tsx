import { goodName, portName } from '../sim/content';
import { lettersOn, pairKey } from '../sim/letters';
import { FONT, UI, money } from '../theme';
import { Button, Label, Panel, bodySmall, dataText } from './ui';
import type { Captain, GameAction, GameState, Letter } from '../sim/types';

/**
 * The captain's post: the letter in hand, if any, then everything the post has left standing —
 * dispatches to carry, a patron to repay, wagers open — and the head-to-head with each rival.
 */
export default function LettersPanel({
  state,
  captain,
  dispatch,
  enabled,
}: {
  state: GameState;
  captain: Captain;
  dispatch: (action: GameAction) => void;
  enabled: boolean;
}) {
  if (!lettersOn(state) && !state.rampPlan?.letters) return null;
  const letter = state.letters?.[captain.id];
  const errands = captain.errands ?? [];
  const wagers = (state.wagers ?? []).filter(w => w.a === captain.id || w.b === captain.id);
  const nameOf = (id: string) => state.captains.find(c => c.id === id)?.name ?? id;
  const records = state.captains
    .filter(c => c.id !== captain.id)
    .map(c => {
      const r = state.rivalries?.[pairKey(captain.id, c.id)] ?? {};
      return { rival: c, won: r[captain.id] ?? 0, lost: r[c.id] ?? 0 };
    })
    .filter(r => r.won + r.lost > 0);
  const quiet = !letter && errands.length === 0 && wagers.length === 0 && !captain.patron && records.length === 0;

  return (
    <Panel title="The post" aside={<Label>{letter ? 'a letter for you' : 'letters and wagers'}</Label>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
        {!lettersOn(state) && (
          <p style={{ ...bodySmall, margin: 0, fontSize: '0.76rem', color: UI.textFaint }}>The post starts to arrive in Era II.</p>
        )}
        {letter && (
          <LetterCard
            letter={letter}
            cash={captain.cash}
            rivalCash={state.captains.find(c => c.id === letter.rivalId)?.cash}
            enabled={enabled}
            onAnswer={accept => dispatch({ type: 'ANSWER_LETTER', accept })}
          />
        )}
        {lettersOn(state) && quiet && (
          <p style={{ ...bodySmall, margin: 0, fontSize: '0.76rem', color: UI.textFaint }}>
            Nothing in the post. Letters arrive at the top of a turn, about one turn in six.
          </p>
        )}

        {errands.map(e => (
          <Line key={`e${e.id}`} tone={state.round >= e.byRound - 2 ? UI.warn : UI.verdigris}>
            Dispatches for <strong>{portName(e.port)}</strong> by round {e.byRound} ({e.byRound - state.round} left) —{' '}
            {money(e.reward)}, bond {money(e.bond)}
          </Line>
        ))}
        {captain.patron && (
          <Line tone={state.round > captain.patron.byRound ? UI.bad : UI.warn}>
            Owed to a patron: {money(captain.patron.amount)}
            {state.round > captain.patron.byRound ? ', overdue, taken from your landings' : ` by round ${captain.patron.byRound}`}
          </Line>
        )}
        {wagers.map(w => (
          <Line key={`w${w.id}`} tone={UI.brass}>
            Wager with {nameOf(w.a === captain.id ? w.b : w.a)}: first to land {goodName(w.good)} at {portName(w.destination)} takes{' '}
            {money(w.stake * 2)}
          </Line>
        ))}
        {records.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', borderTop: `1px solid ${UI.rule}`, paddingTop: '0.35rem' }}>
            <span style={{ ...dataText, fontSize: '0.58rem', letterSpacing: '0.14em', color: UI.textFaint, textTransform: 'uppercase' }}>
              Head to head
            </span>
            {records.map(r => (
              <span key={r.rival.id} style={{ ...dataText, fontSize: '0.7rem', color: UI.textSoft, display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: r.rival.colour }} />
                <span style={{ flex: 1 }}>{r.rival.name}</span>
                <span style={{ color: r.won > r.lost ? UI.good : r.won < r.lost ? UI.bad : UI.textSoft }}>
                  {r.won}–{r.lost}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Line({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span style={{ ...bodySmall, fontSize: '0.74rem', borderLeft: `3px solid ${tone}`, paddingLeft: '0.45rem', lineHeight: 1.4 }}>
      {children}
    </span>
  );
}

/** The letter itself: a folded sheet, a wax seal, and the two answers. */
function LetterCard({
  letter: l,
  cash,
  rivalCash,
  enabled,
  onAnswer,
}: {
  letter: Letter;
  cash: number;
  rivalCash?: number;
  enabled: boolean;
  onAnswer: (accept: boolean) => void;
}) {
  const price = l.kind === 'patron' ? 0 : (l.kind === 'wager' ? l.stake : l.cost) ?? 0;
  const blocked =
    cash < price
      ? `you have only ${money(cash)}`
      : l.kind === 'wager' && rivalCash !== undefined && rivalCash < (l.stake ?? 0)
        ? 'your rival cannot cover the stake any more'
        : null;
  return (
    <div style={sheet}>
      <svg width="100%" height={10} viewBox="0 0 300 10" preserveAspectRatio="none" style={{ display: 'block', position: 'absolute', top: 0, left: 0 }} aria-hidden="true">
        <path d="M0 0 L150 9 L300 0" fill="none" stroke={UI.ruleStrong} strokeWidth={0.8} />
      </svg>
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
        <WaxSeal kind={l.kind} />
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          <span style={{ fontFamily: FONT.display, fontSize: '0.95rem', color: UI.text }}>{l.headline}</span>
          <span style={{ fontFamily: FONT.body, fontStyle: 'italic', fontSize: '0.8rem', lineHeight: 1.45, color: UI.textSoft }}>{l.body}</span>
          <span style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.15rem' }}>
            <Button tone="primary" disabled={!enabled || blocked !== null} title={blocked ?? undefined} onClick={() => onAnswer(true)} style={{ padding: '0.25rem 0.55rem' }}>
              {l.accept}
            </Button>
            <Button tone="quiet" disabled={!enabled} onClick={() => onAnswer(false)} style={{ padding: '0.25rem 0.55rem' }}>
              {l.decline}
            </Button>
          </span>
          {blocked && <span style={{ ...dataText, fontSize: '0.66rem', color: UI.warn }}>Cannot: {blocked}.</span>}
          <span style={{ ...dataText, fontSize: '0.6rem', color: UI.textFaint }}>Unanswered by the end of the turn, it is declined.</span>
        </div>
      </div>
    </div>
  );
}

/** A wax seal, its device by who sent the letter. */
function WaxSeal({ kind }: { kind: Letter['kind'] }) {
  const device: Record<Letter['kind'], string> = {
    // An anchor for the Admiralty, a bottle for the hands, a mallet for the yard, a coin for the
    // patron, crossed pennants for a rival's challenge.
    dispatch: 'M20 10 V30 M14 14 H26 M12 26 Q20 34 28 26',
    shoreLeave: 'M17 10 H23 V15 L26 20 V31 H14 V20 L17 15 Z',
    shipwright: 'M12 28 L24 16 M22 12 L30 20 L26 24 L18 16 Z',
    patron: 'M20 11 A9 9 0 1 0 20.01 11 M20 15 V25 M17 17 H22 Q24 17 24 19 Q24 21 20 21 Q16 21 16 23 Q16 25 19 25 H23',
    wager: 'M12 30 L20 12 L28 18 L20 20 Z M28 30 L20 12',
  };
  return (
    <svg width={44} height={44} viewBox="0 0 40 40" style={{ flex: '0 0 auto' }} aria-hidden="true">
      <path
        d="M20 2 Q25 1 27 5 Q32 4 33 9 Q38 11 36 16 Q39 20 36 24 Q38 29 33 31 Q32 36 27 35 Q25 39 20 38 Q15 39 13 35 Q8 36 7 31 Q2 29 4 24 Q1 20 4 16 Q2 11 7 9 Q8 4 13 5 Q15 1 20 2 Z"
        fill={UI.ensign}
      />
      <circle cx={20} cy={20} r={12.5} fill="none" stroke={UI.panel} strokeWidth={0.8} opacity={0.6} />
      <path d={device[kind]} fill="none" stroke={UI.panel} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
    </svg>
  );
}

const sheet: React.CSSProperties = {
  position: 'relative',
  border: `1px solid ${UI.ruleStrong}`,
  background: UI.tintBrass,
  padding: '0.85rem 0.7rem 0.6rem',
  boxShadow: `0 3px 10px ${UI.shadow}`,
};
