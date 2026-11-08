import { COURSE, CONFIG, DESTINATION, barMax, barTick, currentLodging, xpToNext } from '../sim/content';
import { MISSION, missionReady } from '../sim/missions';
import { BAR_IDS } from '../sim/types';
import type { BarId, GameState } from '../sim/types';
import { BAR_COLOURS, FONT, UI } from '../theme';
import { duration, gr } from '../lib/format';
import { Meter } from './ui';
import { usePace } from '../lib/motion';
import { Tally, TimerBar } from './motion';

const HOUR = 60 * 60 * 1000;
const plain = (n: number) => String(n);
const count = (n: number) => n.toLocaleString('en-GB');

const BAR_NAMES: Record<BarId, string> = { energy: 'Energy', nerve: 'Nerve', spirits: 'Spirits', health: 'Health' };

function BarLine({ s, bar, now }: { s: GameState; bar: BarId; now: number }) {
  const pace = usePace();
  const b = s.bars[bar];
  const max = barMax(s, bar);
  const tick = barTick(s, bar);
  const full = b.cur >= max;
  const nextAt = b.anchor + tick.ms;
  const fullAt = b.anchor + Math.ceil((max - b.cur) / tick.amount) * tick.ms;
  // Where the bar is part way to by now: the sim adds `amount` at each tick, the screen shows the
  // stretch between. Display only; the number beside it stays the true, whole value. A full bar keeps
  // the faint layer too (level with the solid one), so a sudden loss leaves it trailing down behind.
  const ahead =
    pace === 'off' ? undefined : full ? b.cur : Math.min(max, b.cur + (tick.amount * Math.max(0, Math.min(tick.ms, now - b.anchor))) / tick.ms);
  return (
    <div style={{ marginBottom: '0.7rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: 3 }}>
        <span style={{ color: UI.textSoft }}>{BAR_NAMES[bar]}</span>
        <span style={{ fontFamily: FONT.data, color: b.cur > max ? UI.warn : UI.text }}>
          <Tally value={b.cur} format={plain} float="left" ms={400} />/{max}
        </span>
      </div>
      <Meter value={b.cur} max={max} colour={BAR_COLOURS[bar]} ahead={ahead} />
      <div style={{ fontFamily: FONT.data, fontSize: '0.65rem', color: UI.textFaint, marginTop: 2 }}>
        {full ? 'Full' : `+${tick.amount} in ${duration(nextAt - now)} · full in ${duration(fullAt - now)}`}
      </div>
    </div>
  );
}

export function statusLine(s: GameState, now: number): { text: string; colour: string } {
  const st = s.status;
  switch (st.kind) {
    case 'free':
      return { text: 'In Bruges', colour: UI.good };
    case 'abroad':
      return { text: `In ${DESTINATION[st.city]?.name ?? st.city}`, colour: UI.verdigris };
    case 'travelling':
      return { text: `Bound for ${st.to === 'bruges' ? 'Bruges' : DESTINATION[st.to]?.name ?? st.to}, ${duration(st.arrives - now)}`, colour: UI.verdigris };
    case 'infirmary':
      return { text: `In the Infirmary, ${duration(st.until - now)}`, colour: UI.bad };
    case 'steen':
      return { text: `In the Steen, ${duration(st.until - now)}`, colour: UI.bad };
  }
}

export default function StatusRail({ s, now }: { s: GameState; now: number }) {
  const status = statusLine(s, now);
  const need = xpToNext(s.level);
  return (
    <aside style={{ width: 230, flexShrink: 0, padding: '1rem', borderRight: `1px solid ${UI.rule}`, background: UI.panel }}>
      <div style={{ fontFamily: FONT.display, fontSize: '1.2rem', color: UI.brass }}>{s.name}</div>
      <div style={{ fontSize: '0.75rem', color: UI.textSoft, marginBottom: '0.4rem' }}>
        Level <Tally key={s.id} value={s.level} format={plain} /> · standing <Tally key={`st-${s.id}`} value={s.standing} format={count} />
      </div>
      <div style={{ marginBottom: '0.8rem' }}>
        <Meter value={s.xp} max={s.level >= CONFIG.levels.maxLevel ? 1 : need} colour={UI.brass} height={4} />
        <div style={{ fontFamily: FONT.data, fontSize: '0.65rem', color: UI.textFaint, marginTop: 2 }}>
          <Tally key={`${s.id}-${s.level}`} value={s.xp} format={plain} float="right" />/{need} experience
        </div>
      </div>
      <div style={{ fontFamily: FONT.data, fontSize: '1rem', color: UI.text, marginBottom: '0.2rem' }}>
        <Tally key={s.id} value={s.groats} format={gr} float="right" />
      </div>
      {s.deposit && (
        <div style={{ fontFamily: FONT.data, fontSize: '0.68rem', color: UI.textFaint, marginBottom: '0.2rem' }}>
          + {gr(s.deposit.amount)} with the Medici
        </div>
      )}
      <div style={{ fontSize: '0.78rem', color: status.colour, margin: '0.4rem 0 1rem' }}>
        {status.text}
        {s.status.kind === 'travelling' && <TimerBar start={s.status.departs} end={s.status.arrives} now={now} colour={UI.verdigris} style={{ marginBottom: 0 }} />}
      </div>
      {/* The guided first hours spotlight this block whole: the four bars are one lesson, not four. */}
      <div id="nr-bars">
        {BAR_IDS.map(bar => (
          <BarLine key={bar} s={s} bar={bar} now={now} />
        ))}
      </div>
      <div style={{ fontSize: '0.7rem', color: UI.textFaint, marginTop: '0.8rem', lineHeight: 1.4 }}>
        Lodging: {currentLodging(s).name}
        {s.course && (
          <div style={{ marginTop: 4 }}>
            Studying, {duration(s.course.ends - now)} left
            <TimerBar start={s.course.ends - (COURSE[s.course.id]?.hours ?? 0) * HOUR} end={s.course.ends} now={now} colour={UI.verdigris} style={{ height: 3, margin: '0.25rem 0 0' }} />
          </div>
        )}
        {s.missions.active && (
          <div style={{ marginTop: 4, color: missionReady(s) ? UI.good : UI.textFaint }}>
            Mission: {MISSION[s.missions.active.id]?.title}
            {missionReady(s) ? ', ready to report' : s.missions.active.deadline !== null ? `, ${duration(s.missions.active.deadline - now)} left` : ''}
          </div>
        )}
      </div>
    </aside>
  );
}
