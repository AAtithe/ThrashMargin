import { ERAS, eraFor, nextEra } from '../sim/eras';
import { FONT, UI } from '../theme';
import type { GameState, Hazards } from '../sim/types';

const RULE_NAMES: Partial<Record<keyof Hazards, string>> = {
  piracy: 'pirates',
  encounters: 'encounters',
  pressSail: 'cracking on',
  events: 'world events',
  teaRace: 'the tea race',
  deadlines: 'commissions on a clock',
  hostileBids: 'hostile bids',
};

/**
 * Where the game stands in its eras: a timeline of the three, today marked on it, and what the next
 * one brings. The point of a ramp is that you can see it coming.
 */
export default function EraBanner({ state }: { state: GameState }) {
  const plan = state.rampPlan;
  if (!plan) return null;
  const current = eraFor(state.round);
  const coming = nextEra(current.era);
  // Only what this game was set up with will actually arrive.
  const brings = coming ? coming.brings.filter(k => plan[k]).map(k => RULE_NAMES[k] ?? k) : [];
  // The timeline runs to the last era's start plus as long again as era II, then carries on.
  const span = ERAS[ERAS.length - 1].from + 18;
  const at = (round: number) => `${Math.min(100, ((round - 1) / (span - 1)) * 100)}%`;

  return (
    <div style={bar}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap', minWidth: 0 }}>
        <span style={{ fontFamily: FONT.data, fontSize: '0.62rem', letterSpacing: '0.14em', color: UI.textFaint, textTransform: 'uppercase' }}>
          Era {roman(current.era)}
        </span>
        <span style={{ fontFamily: FONT.display, fontSize: '0.9rem', color: UI.brass }}>{current.name}</span>
        <span style={{ fontFamily: FONT.body, fontSize: '0.76rem', color: UI.textSoft }}>
          {coming
            ? `${coming.name} from round ${coming.from}${brings.length ? `: ${brings.join(', ')}` : ''}.`
            : 'Every rule of this game is now in play.'}
        </span>
      </div>
      <div style={{ position: 'relative', height: 16, flex: '1 1 220px', minWidth: 160 }} aria-hidden="true">
        <div style={{ position: 'absolute', left: 0, right: 0, top: 7, height: 2, background: UI.rule }} />
        <div style={{ position: 'absolute', left: 0, width: at(state.round), top: 7, height: 2, background: UI.brass }} />
        {ERAS.map(e => (
          <span
            key={e.era}
            title={`Era ${roman(e.era)}: ${e.name}, from round ${e.from}`}
            style={{
              position: 'absolute',
              left: at(e.from),
              top: 2,
              width: 12,
              height: 12,
              marginLeft: -6,
              borderRadius: '50%',
              border: `2px solid ${e.era <= current.era ? UI.brass : UI.ruleStrong}`,
              background: e.era <= current.era ? UI.brass : UI.panel,
              boxSizing: 'border-box',
            }}
          />
        ))}
        <span style={{ position: 'absolute', left: at(state.round), top: 0, width: 2, height: 16, marginLeft: -1, background: UI.text }} />
      </div>
    </div>
  );
}

export const roman = (n: number): string => ['I', 'II', 'III', 'IV', 'V'][n - 1] ?? String(n);

const bar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.9rem',
  flexWrap: 'wrap',
  padding: '0.4rem 1rem',
  borderBottom: `1px solid ${UI.rule}`,
  background: UI.tintBrass,
};
