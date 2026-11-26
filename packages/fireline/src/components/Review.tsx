/**
 * The after-action review screen (fireline-round7-review.md): what the battle recorded
 * (src/sim/history.ts) drawn as line charts, one line per side, with the turning points
 * (src/sim/review.ts) and an events timeline. Desktop first; it scrolls on a phone.
 *
 * ReviewButton is the one way in: a button that opens the screen over everything (a portal on
 * document.body), from the end-of-battle card, the paused card, the battle menu and a planet
 * battle's result. While it is open it takes every key, so the battle's own shortcuts stay still.
 *
 * Colours are the theme's tokens (UI.side, styles.css), never literals; each chart carries a
 * plain-words summary as its caption, so nothing is read from colour alone.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { DecodedHistory, HistoryEvent } from '../sim/history';
import { clockOf, kindName, plural, reviewOf, type Finding, type Review } from '../sim/review';
import { TICKS_PER_SECOND } from '../sim/rules';
import type { GameState } from '../sim/types';
import { TEAM, UI } from '../theme';

type Mark = 'diamond' | 'triangle' | 'circle' | 'square';

interface Line {
  side: number;
  name: string;
  colour: string;
  mark: Mark;
  values: number[];
}

/** Opens the review of `s` (the battle so far, or the whole of it once it is over). */
export function ReviewButton({ s, label = 'Review the battle', className = 'fl-d-btn', style, testId = 'review-open' }: { s: GameState; label?: string; className?: string; style?: CSSProperties; testId?: string }) {
  const [open, setOpen] = useState(false);
  if (!s.history) return null;
  return (
    <>
      <button type="button" className={className} style={style} onClick={() => setOpen(true)} data-testid={testId}>
        {label}
      </button>
      {open && createPortal(<ReviewScreen s={s} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

export function ReviewScreen({ s, onClose }: { s: GameState; onClose: () => void }) {
  const r = useMemo(() => reviewOf(s), [s]);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [filter, setFilter] = useState<'key' | 'you' | 'all'>('key');
  // Every key is the review's while it is open: Escape closes it, nothing reaches the battle.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', stop, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', stop, true);
      before?.focus?.();
    };
  }, [onClose]);

  const lines = (pick: (o: number, d: DecodedHistory) => number[]): Line[] =>
    r ? s.players.map((p, o) => ({ side: o, name: o === 0 ? 'You' : p.name, colour: sideColour(s, o), mark: TEAM[o as 0 | 1 | 2 | 3].mark as Mark, values: pick(o, r.data) })) : [];

  const over = s.winner !== null;
  return (
    <div className="fl-rv-scrim" onPointerDown={e => e.stopPropagation()}>
      <div className="fl-rv fl-scroll" role="dialog" aria-modal="true" aria-labelledby="fl-rv-title" data-testid="review">
        <header className="fl-rv-head">
          <div>
            <p className="fl-rv-eyebrow">
              {s.name} · {over ? `ended at ${clockOf(s.tick)}` : `so far, at ${clockOf(s.tick)}`}
            </p>
            <h2 className="fl-rv-title" id="fl-rv-title">
              After-action review
            </h2>
          </div>
          <button ref={closeRef} type="button" className="fl-d-btn" onClick={onClose} data-testid="review-close">
            Close <kbd>Esc</kbd>
          </button>
        </header>
        {!r ? (
          <p className="fl-rv-empty">This battle kept no record: it began before battles were recorded.</p>
        ) : (
          <>
            <p className="fl-rv-headline" data-testid="review-headline">
              {r.review.headline}
            </p>
            <Legend lines={lines(() => [])} />
            <div className="fl-rv-body">
              <section className="fl-rv-points" aria-labelledby="fl-rv-points">
                <h3 className="fl-d-sect" id="fl-rv-points">
                  Turning points
                </h3>
                <TurningPoints review={r.review} />
              </section>
              <section className="fl-rv-charts" aria-label="Charts">
                <Chart title="Income a minute, two-minute average" unit="credits a minute" lines={lines((o, d) => perMinute(d.sides[o].income, d.every))} d={r.data} marks={r.review.findings} />
                <Chart title="Army value" unit="credits" lines={lines((o, d) => d.sides[o].army)} d={r.data} marks={r.review.findings} />
                <Chart title="Structure value" unit="credits" lines={lines((o, d) => d.sides[o].structures)} d={r.data} marks={r.review.findings} />
                <Chart title="Units and structures lost, running total" unit="lost" lines={lines((o, d) => running(d.sides[o].lost))} d={r.data} marks={r.review.findings} />
                <Chart title="Credits held" unit="credits" lines={lines((o, d) => d.sides[o].credits)} d={r.data} marks={r.review.findings} />
                <Chart title="Ore within reach of each side's structures" unit="% of the ore" percent lines={lines((o, d) => d.sides[o].ore.map(v => v / 10))} d={r.data} marks={r.review.findings} />
              </section>
            </div>
            <Timeline s={s} d={r.data} filter={filter} setFilter={setFilter} />
          </>
        )}
      </div>
    </div>
  );
}

const stop = (e: KeyboardEvent) => e.stopPropagation();
/** Income a minute, averaged over the two minutes to each sample, as the review's own rule reads it. */
const perMinute = (income: number[], every: number): number[] => {
  const span = Math.max(1, Math.round((2 * 60 * TICKS_PER_SECOND) / every));
  return income.map((_, i) => {
    const from = Math.max(0, i - span + 1);
    const part = income.slice(from, i + 1);
    return Math.round((part.reduce((a, b) => a + b, 0) / part.length) * ((60 * TICKS_PER_SECOND) / every));
  });
};
const running = (byCat: number[][]): number[] => {
  const n = byCat[0]?.length ?? 0;
  const out: number[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    for (const c of byCat) t += c[i] ?? 0;
    out.push(t);
  }
  return out;
};

/** Two sides: the battle's own blue and red tokens; more: each side's token. */
function sideColour(s: GameState, o: number): string {
  if (s.players.length === 2) return o === 0 ? UI.team : UI.enemy;
  return UI.side[o as 0 | 1 | 2 | 3];
}

function MarkIcon({ mark, colour, x = 0, y = 0, r = 4.5 }: { mark: Mark; colour: string; x?: number; y?: number; r?: number }) {
  const ring = { fill: colour, stroke: 'var(--ui-panel)', strokeWidth: 1.5 };
  if (mark === 'circle') return <circle cx={x} cy={y} r={r} {...ring} />;
  if (mark === 'square') return <rect x={x - r * 0.85} y={y - r * 0.85} width={r * 1.7} height={r * 1.7} {...ring} />;
  if (mark === 'triangle') return <path d={`M${x},${y - r} L${x + r},${y + r * 0.8} L${x - r},${y + r * 0.8} Z`} {...ring} />;
  return <path d={`M${x},${y - r} L${x + r},${y} L${x},${y + r} L${x - r},${y} Z`} {...ring} />;
}

function Legend({ lines }: { lines: Line[] }) {
  return (
    <ul className="fl-rv-legend" aria-label="Sides">
      {lines.map(l => (
        <li key={l.side}>
          <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true">
            <MarkIcon mark={l.mark} colour={l.colour} r={5} />
          </svg>
          <span className="fl-rv-legend-line" style={{ background: l.colour }} aria-hidden="true" />
          {l.name}
        </li>
      ))}
      <li className="fl-rv-legend-note">Numbered rules mark the turning points.</li>
    </ul>
  );
}

function TurningPoints({ review }: { review: Review }) {
  if (!review.findings.length) return <p className="fl-rv-empty">Nothing stood out: no turning point passed the review's thresholds yet.</p>;
  return (
    <ol className="fl-rv-list" data-testid="review-points">
      {review.findings.map((f, i) => (
        <li key={`${f.rule}-${f.tick}`} className="fl-rv-point" data-tone={f.tone} data-rule={f.rule}>
          <span className="fl-rv-num" aria-hidden="true">
            {i + 1}
          </span>
          <div>
            <p className="fl-rv-point-head">
              <strong>{f.title}</strong>
              <span className="fl-rv-time">{f.until !== undefined && f.until !== f.tick ? `${clockOf(f.tick)} to ${clockOf(f.until)}` : f.tick ? clockOf(f.tick) : 'Whole battle'}</span>
            </p>
            <p className="fl-rv-text">{f.text}</p>
            <p className="fl-rv-advice">
              <span className="fl-rv-advice-label">A stronger commander: </span>
              {f.advice}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---- Charts ----------------------------------------------------------------------------------------

const W = 520;
const H = 190;
const PAD = { l: 52, r: 14, t: 14, b: 26 };

/** The y axis: four steps of 1, 2, 2.5 or 5 times a power of ten, reaching at least the largest value. */
function niceTop(v: number): number {
  if (v <= 0) return 4;
  const raw = v / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p * 4;
  return 40 * p;
}

const short = (v: number) => (Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}k` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : `${Math.round(v)}`);
const full = (v: number) => Math.round(v).toLocaleString('en-GB');

/** The chart in words: each side's peak and where it ended. */
function summarise(lines: Line[], ticks: number[], unit: string, percent: boolean): string {
  if (!ticks.length) return 'Nothing recorded yet.';
  const fmt = (v: number) => (percent ? `${Math.round(v)}%` : full(v));
  const peaks = lines.map(l => {
    let at = 0;
    l.values.forEach((v, i) => {
      if (v > l.values[at]) at = i;
    });
    return `${l.name} peaked at ${fmt(l.values[at] ?? 0)} at ${clockOf(ticks[at])}`;
  });
  const end = lines.map(l => `${l.name === 'You' ? 'you' : l.name} ${fmt(l.values[l.values.length - 1] ?? 0)}`);
  return `${peaks.join('; ')}. At ${clockOf(ticks[ticks.length - 1])}: ${end.join(', ')}${percent ? '' : ` ${unit}`}.`;
}

function Chart({ title, unit, lines, d, marks, percent = false }: { title: string; unit: string; lines: Line[]; d: DecodedHistory; marks: Finding[]; percent?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const ticks = d.ticks;
  const end = Math.max(ticks[ticks.length - 1] ?? 1, 1);
  const top = percent ? 100 : niceTop(Math.max(4, ...lines.flatMap(l => l.values)));
  const x = (t: number) => PAD.l + (t / end) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / top) * (H - PAD.t - PAD.b);
  // Minutes along the bottom: every 5, 10 or 15 so there are at most seven labels.
  const mins = end / (60 * TICKS_PER_SECOND);
  const step = [1, 2, 5, 10, 15, 30].find(m => mins / m <= 7) ?? 60;
  const xs: number[] = [];
  for (let m = 0; m <= mins; m += step) xs.push(m * 60 * TICKS_PER_SECOND);
  const ys = [0, 0.25, 0.5, 0.75, 1].map(f => f * top);
  const summary = summarise(lines, ticks, unit, percent);
  const id = `fl-rv-${title.replace(/\W+/g, '-').toLowerCase()}`;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = (((e.clientX - box.left) / box.width) * W - PAD.l) / (W - PAD.l - PAD.r);
    let best = 0;
    ticks.forEach((tk, i) => {
      if (Math.abs(tk / end - t) < Math.abs(ticks[best] / end - t)) best = i;
    });
    setHover(ticks.length ? best : null);
  };
  const fmt = (v: number) => (percent ? `${Math.round(v)}%` : full(v));
  return (
    <figure className="fl-rv-chart" data-testid="review-chart" aria-labelledby={`${id}-t`}>
      <h4 className="fl-rv-chart-title" id={`${id}-t`}>
        {title}
      </h4>
      <div className="fl-rv-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${summary}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {ys.map(v => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'fl-rv-axis' : 'fl-rv-grid'} />
              <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="fl-rv-tick">
                {percent ? `${v}%` : short(v)}
              </text>
            </g>
          ))}
          {xs.map(t => (
            <text key={t} x={x(t)} y={H - 8} textAnchor="middle" className="fl-rv-tick">
              {clockOf(t)}
            </text>
          ))}
          {marks.map((f, i) => (
            <g key={`${f.rule}-${f.tick}`} className="fl-rv-mark">
              <line x1={x(f.tick)} x2={x(f.tick)} y1={PAD.t} y2={H - PAD.b} />
              <text x={x(f.tick) + 3} y={PAD.t + 8}>
                {i + 1}
              </text>
            </g>
          ))}
          {lines.map(l => {
            if (!l.values.length) return null;
            const pts = [`${x(0)},${y(l.values[0])}`, ...l.values.map((v, i) => `${x(ticks[i])},${y(v)}`)];
            const last = l.values.length - 1;
            return (
              <g key={l.side}>
                <polyline points={pts.join(' ')} fill="none" stroke={l.colour} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                <MarkIcon mark={l.mark} colour={l.colour} x={x(ticks[last])} y={y(l.values[last])} />
              </g>
            );
          })}
          {hover !== null && (
            <g>
              <line x1={x(ticks[hover])} x2={x(ticks[hover])} y1={PAD.t} y2={H - PAD.b} className="fl-rv-cross" />
              {lines.map(l => (
                <MarkIcon key={l.side} mark={l.mark} colour={l.colour} x={x(ticks[hover])} y={y(l.values[hover] ?? 0)} r={4} />
              ))}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div className="fl-rv-tip" style={{ left: `${(x(ticks[hover]) / W) * 100}%` }} role="presentation">
            <strong>{clockOf(ticks[hover])}</strong>
            {lines.map(l => (
              <span key={l.side}>
                <svg width="10" height="10" viewBox="-5 -5 10 10" aria-hidden="true">
                  <MarkIcon mark={l.mark} colour={l.colour} r={4} />
                </svg>
                {l.name} {fmt(l.values[hover] ?? 0)}
              </span>
            ))}
          </div>
        )}
      </div>
      <figcaption className="fl-rv-caption">{summary}</figcaption>
    </figure>
  );
}

// ---- The events timeline ---------------------------------------------------------------------------

const KEY_KINDS = new Set<HistoryEvent['kind']>(['lost', 'losses', 'hero', 'general']);

function eventText(s: GameState, e: HistoryEvent): string {
  const you = e.side === 0;
  const who = you ? 'You' : s.players[e.side]?.name ?? `Side ${e.side}`;
  const your = you ? 'Your' : `${who}'s`;
  const name = kindName(e.what);
  const a = `${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}`;
  switch (e.kind) {
    case 'built':
      return `${who} built ${a}.`;
    case 'lost':
      return `${who} lost ${a}.`;
    case 'research':
      return `${who} finished ${name}.`;
    case 'power':
      return `${who} called ${a}.`;
    case 'site':
      return `${who} took ${a}.`;
    case 'hero':
      return `${your} ${name} fell.`;
    case 'general':
      return `${your} General fell.`;
    case 'losses': {
      const by = e.by === 'defences' ? 'defences' : plural(kindName(e.by ?? ''), 2);
      if (e.total && e.total !== e.n && (e.n ?? 0) < 3) return `${who} lost ${e.total} units in thirty seconds, most to ${by}.`;
      return e.total && e.total !== e.n
        ? `${who} lost ${e.total} units in thirty seconds, ${e.n} of them ${plural(name, e.n ?? 0)}, most to ${by}.`
        : `${who} lost ${e.n} ${plural(name, e.n ?? 0)} in thirty seconds, most to ${by}.`;
    }
  }
}

function Timeline({ s, d, filter, setFilter }: { s: GameState; d: DecodedHistory; filter: 'key' | 'you' | 'all'; setFilter: (f: 'key' | 'you' | 'all') => void }) {
  const shown = d.events.filter(e => (filter === 'all' ? true : filter === 'you' ? e.side === 0 : KEY_KINDS.has(e.kind) || (e.kind === 'built' && e.side === 0) || e.kind === 'research'));
  const end = Math.max(d.ticks[d.ticks.length - 1] ?? 1, s.tick, 1);
  const lanes = s.players.length;
  const SW = 1000;
  const lane = 18;
  const SH = lanes * lane + 22;
  const xs = (t: number) => 70 + (t / end) * (SW - 84);
  const filters: [typeof filter, string][] = [
    ['key', 'Key events'],
    ['you', 'Yours'],
    ['all', 'Everything'],
  ];
  return (
    <section className="fl-rv-events" aria-labelledby="fl-rv-events">
      <div className="fl-rv-events-head">
        <h3 className="fl-d-sect" id="fl-rv-events">
          Events
        </h3>
        <div className="fl-d-group" role="group" aria-label="Which events">
          {filters.map(([k, label]) => (
            <button key={k} type="button" className="fl-d-btn" aria-pressed={filter === k} onClick={() => setFilter(k)} data-testid={`review-filter-${k}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <svg className="fl-rv-strip" viewBox={`0 0 ${SW} ${SH}`} role="img" aria-label={`${shown.length} events over ${clockOf(end)}, one row per side; listed in full below.`}>
        {Array.from({ length: lanes }, (_, o) => (
          <g key={o}>
            <text x={4} y={o * lane + 14} className="fl-rv-tick">
              {o === 0 ? 'You' : s.players[o].name.split(' ')[0]}
            </text>
            <line x1={70} x2={SW - 14} y1={o * lane + 10} y2={o * lane + 10} className="fl-rv-grid" />
          </g>
        ))}
        {shown.map((e, i) => (
          <g key={i}>
            <title>{`${clockOf(e.tick)} ${eventText(s, e)}`}</title>
            <MarkIcon mark={TEAM[e.side as 0 | 1 | 2 | 3].mark as Mark} colour={sideColour(s, e.side)} x={xs(e.tick)} y={e.side * lane + 10} r={KEY_KINDS.has(e.kind) ? 5 : 3.5} />
          </g>
        ))}
        <text x={70} y={SH - 4} className="fl-rv-tick">
          0:00
        </text>
        <text x={SW - 14} y={SH - 4} textAnchor="end" className="fl-rv-tick">
          {clockOf(end)}
        </text>
      </svg>
      {s.history?.capped !== undefined && (
        <p className="fl-rv-caption">
          From {clockOf(s.history.capped)} this long battle's record keeps only losses, research and commanders falling, to stay small.
        </p>
      )}
      <ol className="fl-rv-events-list fl-scroll" data-testid="review-events">
        {shown.length ? (
          shown.map((e, i) => (
            <li key={i} data-kind={e.kind}>
              <span className="fl-rv-time">{clockOf(e.tick)}</span>
              <svg width="10" height="10" viewBox="-5 -5 10 10" aria-hidden="true">
                <MarkIcon mark={TEAM[e.side as 0 | 1 | 2 | 3].mark as Mark} colour={sideColour(s, e.side)} r={4} />
              </svg>
              <span>{eventText(s, e)}</span>
            </li>
          ))
        ) : (
          <li>None yet.</li>
        )}
      </ol>
    </section>
  );
}
