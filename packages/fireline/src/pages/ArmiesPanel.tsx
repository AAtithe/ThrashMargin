/**
 * How to play: the two armies (fireline-round6-design.md, workstream A). Every number is read from
 * the rules through the per-army specs, so the tables cannot drift from what a battle plays.
 *
 * Also home to ItemTile, the unit and structure tile the How to play grids and this panel share
 * (HowToPlay imports it from here, since this file is already imported by that page).
 */
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ManualSection, bodySmall } from '../components/ui';
import { Button } from '../lib/Kit';
import { iconFor } from '../game/icons';
import { listedCost, statsOf } from '../game/Sidebar';
import {
  BUILDINGS,
  FACTION_DOCTRINES,
  FACTION_MENUS,
  FACTION_NAMES,
  FACTION_OVERLAY,
  FACTIONS,
  STANDARD_TECH,
  TICKS_PER_SECOND,
  UNITS,
  type BuildingKind,
  type Faction,
  type UnitKind,
} from '../sim/rules';
import { buildingSpecFor, unitSpecFor } from '../sim/specs';

type Kind = BuildingKind | UnitKind;

// ---- The tile -----------------------------------------------------------------------------------

/** One headline number on a tile, shown as a chip: a label over a tabular value. */
export type TileStat = { key: string; label: string; value: string; unit?: string };

const fmt = (n: number) => n.toLocaleString('en-GB');

/** The headline numbers for a kind as an army fields it: cost, health, power, speed and range. */
export function tileStats(k: Kind, f: Faction = 'meridian', opts: { speed?: boolean } = {}): TileStat[] {
  const isB = k in BUILDINGS;
  const s = isB ? buildingSpecFor(f, k as BuildingKind) : unitSpecFor(f, k as UnitKind);
  // A hero's recruit price, not the campaign's 0 (listedCost).
  const out: TileStat[] = [
    { key: 'cost', label: 'Cost', value: fmt(listedCost(k, f).cost), unit: 'cr' },
    { key: 'hp', label: 'HP', value: fmt(s.hp) },
  ];
  if (isB) {
    const p = (s as { power: number }).power;
    out.push({ key: 'power', label: 'Power', value: p > 0 ? `+${p}` : p < 0 ? `−${-p}` : '0' });
  }
  if (!isB && opts.speed) out.push({ key: 'speed', label: 'Speed', value: ((s as { speed: number }).speed * TICKS_PER_SECOND).toFixed(2), unit: 't/s' });
  if (s.weapon) out.push({ key: 'range', label: 'Range', value: `${s.weapon.range}` });
  return out;
}

/** A blurb clamped to a few lines, with a More/Less toggle when (and only when) it overflows. */
function Blurb({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const id = useId();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, text]);
  return (
    <>
      <p ref={ref} id={id} className="fl-howto-blurb" data-open={open ? '1' : undefined}>
        {text}
      </p>
      {(overflows || open) && (
        <Button tone="quiet" size="small" className="fl-howto-more" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>
          {open ? 'Less' : 'More'}
        </Button>
      )}
    </>
  );
}

/**
 * A unit or structure: its icon as a banner, the name with its Advanced badge (and army tag) on one
 * line, the headline numbers as chips, the blurb, and every number behind a disclosure.
 */
export function ItemTile({
  kind,
  name,
  blurb,
  stats,
  rows,
  needs,
  army,
}: {
  kind: Kind;
  name: string;
  blurb: string;
  stats: TileStat[];
  rows: { label: string; value: string }[];
  needs?: string;
  army?: Faction;
}) {
  const advanced = !STANDARD_TECH.includes(kind);
  return (
    <article className="fl-howto-tile" data-tech={advanced ? 'advanced' : 'standard'} data-army={army}>
      <div className="fl-howto-banner">
        <img src={iconFor(kind)} alt="" width={96} height={64} />
      </div>
      <div className="fl-howto-body">
        <div className="fl-howto-name">
          <strong>{name}</strong>
          {advanced && <span className="fl-howto-badge">Advanced</span>}
          {army && (
            <span className="fl-army-tag" data-army={army}>
              {FACTION_NAMES[army]}
            </span>
          )}
        </div>
        <dl className="fl-howto-stats">
          {stats.map(s => (
            <div key={s.key} className="fl-howto-stat" data-stat={s.key}>
              <dt>{s.label}</dt>
              <dd>
                {s.value}
                {s.unit && <span className="fl-howto-unit"> {s.unit}</span>}
              </dd>
            </div>
          ))}
        </dl>
        <Blurb text={blurb} />
        <details className="fl-howto-all">
          <summary>All numbers</summary>
          <dl>
            {rows.map(r => (
              <div key={r.label}>
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        </details>
        {needs && <span className="fl-howto-needs">Needs: {needs}</span>}
      </div>
    </article>
  );
}

// ---- The armies --------------------------------------------------------------------------------

/** Every kind an army's overlay changes, units first, in catalogue order. */
const CHANGED: Kind[] = [
  ...(Object.keys(UNITS) as UnitKind[]).filter(k => FACTIONS.some(f => FACTION_OVERLAY[f].units?.[k])),
  ...(Object.keys(BUILDINGS) as BuildingKind[]).filter(k => FACTIONS.some(f => FACTION_OVERLAY[f].buildings?.[k])),
];

/** Each army's own items: what its lists add. */
const SIGNATURE: Record<Faction, Kind[]> = Object.fromEntries(
  FACTIONS.map(f => [f, Object.values(FACTION_MENUS[f].add ?? {}).flatMap(list => [...(list ?? [])])]),
) as Record<Faction, Kind[]>;

const specOf = (f: Faction, k: Kind) => (k in BUILDINGS ? buildingSpecFor(f, k as BuildingKind) : unitSpecFor(f, k as UnitKind));

/** The numbers an army's overlay can change, and which way is better for each. */
type CmpKey = 'cost' | 'hp' | 'speed' | 'range';
const CMP: { key: CmpKey; label: string; low: boolean; better: string; worse: string; show: (n: number) => string }[] = [
  { key: 'cost', label: 'Cost', low: true, better: 'cheaper', worse: 'dearer', show: n => fmt(n) },
  { key: 'hp', label: 'HP', low: false, better: 'more health', worse: 'less health', show: n => fmt(n) },
  { key: 'speed', label: 'Speed', low: false, better: 'faster', worse: 'slower', show: n => (n * TICKS_PER_SECOND).toFixed(2) },
  { key: 'range', label: 'Range', low: false, better: 'longer range', worse: 'shorter range', show: n => `${n}` },
];

function numbersOf(f: Faction, k: Kind): Partial<Record<CmpKey, number>> {
  const s = specOf(f, k);
  return {
    cost: listedCost(k, f).cost,
    hp: s.hp,
    speed: k in BUILDINGS ? undefined : (s as { speed: number }).speed,
    range: s.weapon?.range,
  };
}

/** Better or worse than the other armies on one number; 'differs' between the best and the worst. */
type Mark = 'better' | 'worse' | 'differs' | undefined;

type Cell = { key: CmpKey; label: string; value: string; mark: Mark };

/** The comparison, worked out once from the rules: one row per changed kind, one cell per army and number. */
const COMPARISON: { kind: Kind; name: string; cells: Record<Faction, (Cell | null)[]> }[] = CHANGED.map(k => {
  const nums = Object.fromEntries(FACTIONS.map(f => [f, numbersOf(f, k)])) as Record<Faction, Partial<Record<CmpKey, number>>>;
  const cells = Object.fromEntries(FACTIONS.map(f => [f, [] as (Cell | null)[]])) as Record<Faction, (Cell | null)[]>;
  for (const c of CMP) {
    const vals = FACTIONS.map(f => nums[f][c.key]);
    const known = vals.filter((v): v is number => v !== undefined);
    const lo = Math.min(...known);
    const hi = Math.max(...known);
    const full = known.length === vals.length;
    for (const f of FACTIONS) {
      const v = nums[f][c.key];
      if (v === undefined) {
        cells[f].push(null);
        continue;
      }
      const mark: Mark = !full || lo === hi ? undefined : v === (c.low ? lo : hi) ? 'better' : v === (c.low ? hi : lo) ? 'worse' : 'differs';
      cells[f].push({ key: c.key, label: c.label, value: c.show(v), mark });
    }
  }
  return { kind: k, name: specOf('meridian', k).name, cells };
});

/** Per army, how many shared items it is better or worse on, number by number. */
const SUMMARY: Record<Faction, { key: CmpKey; mark: 'better' | 'worse'; words: string; count: number }[]> = Object.fromEntries(
  FACTIONS.map(f => {
    const out: { key: CmpKey; mark: 'better' | 'worse'; words: string; count: number }[] = [];
    for (const c of CMP)
      for (const mark of ['better', 'worse'] as const) {
        const count = COMPARISON.filter(row => row.cells[f].some(cell => cell?.key === c.key && cell.mark === mark)).length;
        if (count) out.push({ key: c.key, mark, words: mark === 'better' ? c.better : c.worse, count });
      }
    return [f, out];
  }),
) as Record<Faction, { key: CmpKey; mark: 'better' | 'worse'; words: string; count: number }[]>;

const SYMBOL: Record<Exclude<Mark, undefined>, string> = { better: '▲', worse: '▼', differs: '≠' };
const WORDS: Record<Exclude<Mark, undefined>, string> = { better: 'better', worse: 'worse', differs: 'different' };

function MarkSign({ mark }: { mark: Mark }): ReactNode {
  if (!mark) return null;
  return (
    <>
      <span className="fl-armies-sign" aria-hidden="true">
        {SYMBOL[mark]}
      </span>
      <span className="kit-sr-only"> ({WORDS[mark]})</span>
    </>
  );
}

export default function ArmiesPanel() {
  const other = (f: Faction) => FACTIONS.filter(g => g !== f).map(g => FACTION_NAMES[g]).join(' and ');
  return (
    <ManualSection title="Two armies">
      <ul style={{ ...bodySmall, margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <li>
          In a skirmish every seat picks an <strong>Army</strong> in the lobby. The campaign is always fought as {FACTION_NAMES.meridian}.
        </li>
        {FACTIONS.map(f => (
          <li key={f}>
            <strong>{FACTION_NAMES[f]}</strong>: {FACTION_DOCTRINES[f]}
          </li>
        ))}
        <li>
          Each army's own units are advanced tech, and only that army can build them. The rest of the lists are shared; only the
          numbers differ, as below.
        </li>
      </ul>
      <div className="fl-howto-grid">
        {FACTIONS.map(f =>
          SIGNATURE[f].map(k => {
            const spec = specOf(f, k);
            return (
              <ItemTile
                key={k}
                kind={k}
                army={f}
                name={spec.name}
                blurb={spec.blurb}
                stats={tileStats(k, f, { speed: true })}
                rows={statsOf(k, f)}
              />
            );
          }),
        )}
      </div>
      <div className="fl-armies-apart">
        <h3 className="fl-armies-apart-h">What sets each army apart, on the shared items</h3>
        <ul className="fl-armies-apart-list">
          {FACTIONS.map(f => (
            <li key={f} className="fl-armies-apart-army" data-army={f}>
              <span className="fl-army-tag" data-army={f}>
                {FACTION_NAMES[f]}
              </span>
              <span className="kit-sr-only">, against {other(f)}:</span>
              <ul className="fl-armies-apart-chips">
                {SUMMARY[f].map(s => (
                  <li key={`${s.key}-${s.mark}`} className="fl-armies-apart-chip" data-mark={s.mark}>
                    <span className="fl-armies-sign" aria-hidden="true">
                      {SYMBOL[s.mark]}
                    </span>{' '}
                    {s.words} <span className="fl-armies-apart-n">
                      on {s.count} of {COMPARISON.length}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="fl-armies-legend">
          <span>
            <span className="fl-armies-sign" data-mark="better" aria-hidden="true">
              {SYMBOL.better}
            </span>{' '}
            better than the other army
          </span>
          <span>
            <span className="fl-armies-sign" data-mark="worse" aria-hidden="true">
              {SYMBOL.worse}
            </span>{' '}
            worse
          </span>
          <span>Unmarked: the same in both. Cheaper counts as better.</span>
        </p>
      </div>
      <div className="fl-armies-table-wrap">
        <table className="fl-armies-table fl-armies-cmp-table" data-testid="armies-table">
          <thead>
            <tr>
              <th scope="col" rowSpan={2}>
                Shared item
              </th>
              {FACTIONS.map(f => (
                <th key={f} scope="colgroup" colSpan={CMP.length} className="fl-armies-cmp-army" data-army={f}>
                  {FACTION_NAMES[f]}
                </th>
              ))}
            </tr>
            <tr>
              {FACTIONS.map(f =>
                CMP.map((c, i) => (
                  <th key={`${f}-${c.key}`} scope="col" className="fl-armies-cmp-stat" data-first={i === 0 ? '1' : undefined}>
                    {c.label}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map(row => (
              <tr key={row.kind}>
                <th scope="row">{row.name}</th>
                {FACTIONS.map(f =>
                  row.cells[f].map((c, i) => (
                    <td key={`${f}-${CMP[i].key}`} className="fl-armies-cmp-val" data-mark={c?.mark} data-first={i === 0 ? '1' : undefined}>
                      {c ? (
                        <>
                          {c.value}
                          <MarkSign mark={c.mark} />
                        </>
                      ) : (
                        <span className="fl-armies-na">
                          <span aria-hidden="true">{'\u2013'}</span>
                          <span className="kit-sr-only">not applicable</span>
                        </span>
                      )}
                    </td>
                  )),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ManualSection>
  );
}
