import { currentEra, levelDriven, nextEraOf, scheduleFor, tableLevel } from '../sim/eras';
import { FONT, UI } from '../theme';
import type { GameState, Hazards } from '../sim/types';

export const RULE_LABELS: Partial<Record<keyof Hazards, string>> = {
  weather: 'wind and weather',
  shipClasses: 'ship classes',
  quaysideSales: 'quayside sales',
  charters: 'charters',
  piracy: 'pirates',
  encounters: 'encounters',
  pressSail: 'cracking on',
  renown: 'renown',
  letters: 'letters',
  events: 'world events',
  wages: 'wages',
  loans: 'loans',
  teaRace: 'the tea race',
  deadlines: 'commissions on a clock',
  stocks: 'the exchange',
  agents: 'port agents',
  hostileBids: 'hostile bids',
};

/**
 * Where the game stands in its growth: a timeline of the stages, today marked on it, and what the
 * next one brings. Stages follow the career level when careers are on, the calendar otherwise. The
 * point of a ramp is that you can see it coming — and, when it follows your level, that you can see
 * what earning the next one will open.
 */
export default function EraBanner({ state }: { state: GameState }) {
  const plan = state.rampPlan;
  if (!plan) return null;
  const byLevel = levelDriven(plan, state.rules);
  const schedule = scheduleFor(plan, state.rules);
  const current = currentEra(state);
  const shown = schedule.find(e => e.era === (state.era ?? 1)) ?? current;
  const coming = nextEraOf(state);
  // Only what this game was set up with will actually arrive.
  const brings = coming ? coming.brings.filter(k => plan[k]).map(k => RULE_LABELS[k] ?? k) : [];
  const level = tableLevel(state);

  // In rounds, the timeline runs to the last era's start plus as long again as era II; in levels,
  // from level 1 to the last stage's level.
  const pos = (e: (typeof schedule)[number]) =>
    byLevel
      ? `${(((e.level ?? 1) - 1) / ((schedule[schedule.length - 1].level ?? 1) - 1)) * 100}%`
      : `${Math.min(100, ((e.from - 1) / (schedule[schedule.length - 1].from + 17)) * 100)}%`;
  const now = byLevel
    ? `${Math.min(100, ((level - 1) / ((schedule[schedule.length - 1].level ?? 1) - 1)) * 100)}%`
    : `${Math.min(100, ((state.round - 1) / (schedule[schedule.length - 1].from + 17)) * 100)}%`;

  return (
    <div style={bar}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap', minWidth: 0 }}>
        <span style={{ fontFamily: FONT.data, fontSize: '0.62rem', letterSpacing: '0.14em', color: UI.textFaint, textTransform: 'uppercase' }}>
          {byLevel ? `Stage ${shown.era} of ${schedule.length}` : `Era ${roman(shown.era)}`}
        </span>
        <span style={{ fontFamily: FONT.display, fontSize: '0.9rem', color: UI.brass }}>{shown.name}</span>
        <span style={{ fontFamily: FONT.body, fontSize: '0.76rem', color: UI.textSoft }}>
          {coming
            ? byLevel
              ? `Reach level ${coming.level} to open ${coming.name.toLowerCase()}${brings.length ? `: ${brings.join(', ')}` : ''}.`
              : `${coming.name} from round ${coming.from}${brings.length ? `: ${brings.join(', ')}` : ''}.`
            : 'Every rule of this game is now in play.'}
        </span>
      </div>
      <div style={{ position: 'relative', height: 18, flex: '1 1 220px', minWidth: 160 }} aria-hidden="true">
        <div style={{ position: 'absolute', left: 0, right: 0, top: 8, height: 2, background: UI.rule }} />
        <div style={{ position: 'absolute', left: 0, width: now, top: 8, height: 2, background: UI.brass }} />
        {schedule.map(e => (
          <span
            key={e.era}
            title={byLevel ? `${e.name}, at level ${e.level}` : `Era ${roman(e.era)}: ${e.name}, from round ${e.from}`}
            style={{
              position: 'absolute',
              left: pos(e),
              top: 3,
              width: 12,
              height: 12,
              marginLeft: -6,
              borderRadius: '50%',
              border: `2px solid ${e.era <= shown.era ? UI.brass : UI.ruleStrong}`,
              background: e.era <= shown.era ? UI.brass : UI.panel,
              boxSizing: 'border-box',
            }}
          />
        ))}
        <span style={{ position: 'absolute', left: now, top: 1, width: 2, height: 16, marginLeft: -1, background: UI.text }} />
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
