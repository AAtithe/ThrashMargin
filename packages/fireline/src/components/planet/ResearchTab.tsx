/**
 * War for the Planet: the Research screen (fireline-planet-design.md, sections 6.4 and 17). W4.
 * Round 5's five development lines, the doctrine fork after each Mk II, vehicle loadouts, the
 * current project and science per turn. Every check is src/planet/research.ts.
 */
import { factionIncome } from '../../planet/economy';
import { prerequisiteProblem, scienceCost } from '../../planet/research';
import { ARMY_KINDS } from '../../planet/types';
import { LINES, LINE_ORDER, MODULES, MODULE_ORDER, MODULE_SLOTS, UPGRADES, type LineId, type ModuleId, type UnitKind, type UpgradeId } from '../../sim/rules';
import { OrderButton, unitName, type PlanetProps } from './common';

export default function ResearchTab({ s, map, act }: PlanetProps) {
  const r = s.factions[0].research;
  const science = factionIncome(s, 0).income.science;
  const cur = r.current;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <section className="fl-pl-card" data-testid="research-current">
        <h3>Research</h3>
        <span className="fl-small">
          {science} science a turn, from research institutes and the capital. One project at a time; switching discards its progress.
        </span>
        {cur ? (
          <div>
            <strong>{UPGRADES[cur].name}</strong>{' '}
            <span className="fl-small">
              {r.points} / {scienceCost(cur)} science
              {science > 0 ? `, about ${Math.max(1, Math.ceil((scienceCost(cur) - r.points) / science))} more turns` : ', no science coming in'}
            </span>
            <span className="fl-bar fl-bar-wide">
              <span style={{ width: `${Math.min(100, Math.round((100 * r.points) / scienceCost(cur)))}%` }} />
            </span>
          </div>
        ) : (
          <span className="fl-small">No project. Choose one below.</span>
        )}
      </section>

      <section className="fl-pl-card">
        <h3>Development lines</h3>
        <div className="fl-pl-lines">
          {LINE_ORDER.map(line => (
            <Line key={line} line={line} s={s} map={map} act={act} />
          ))}
        </div>
      </section>

      <section className="fl-pl-card" data-testid="loadouts">
        <h3>Loadouts</h3>
        <span className="fl-small">Modules fitted to every vehicle of a kind in your battles. Each module is unlocked by research.</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {ARMY_KINDS.filter(k => MODULE_SLOTS[k as UnitKind]).map(k => (
            <Loadout key={k} kind={k as UnitKind} s={s} map={map} act={act} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Node({ id, s, act }: Omit<PlanetProps, 'map'> & { id: UpgradeId }) {
  const r = s.factions[0].research;
  const done = r.done.includes(id);
  const current = r.current === id;
  const pre = prerequisiteProblem(r, id);
  const state = done ? 'done' : current ? 'current' : pre ? 'locked' : 'open';
  return (
    <div className="fl-pl-node" data-state={state} data-testid={`research-${id}`} title={UPGRADES[id].blurb}>
      <strong>{UPGRADES[id].name}</strong>
      <span className="fl-small">{UPGRADES[id].blurb}</span>
      <span className="fl-small">
        {done ? 'Researched' : current ? `${r.points} / ${scienceCost(id)} science` : `${scienceCost(id)} science`}
      </span>
      {!done && !current && (
        <OrderButton s={s} act={act} a={{ type: 'research', upgrade: id }}>
          Research
        </OrderButton>
      )}
    </div>
  );
}

function Line({ line, s, act }: PlanetProps & { line: LineId }) {
  const l = LINES[line];
  const r = s.factions[0].research;
  const doc = r.doctrines[line];
  return (
    <div className="fl-pl-line" data-testid={`line-${line}`}>
      <strong>{l.name}</strong>
      <Node id={l.marks[0]} s={s} act={act} />
      <Node id={l.marks[1]} s={s} act={act} />
      <div className="fl-pl-fork">
        {l.fork.map(b =>
          doc === b ? (
            <Node key={b} id={b} s={s} act={act} />
          ) : doc ? null : (
            <div key={b} className="fl-pl-node" data-state={r.done.includes(l.marks[1]) ? 'open' : 'locked'} title={UPGRADES[b].blurb}>
              <strong>{UPGRADES[b].name}</strong>
              <span className="fl-small">{UPGRADES[b].blurb}</span>
              <OrderButton s={s} act={act} a={{ type: 'doctrine', line, branch: b }} testId={`doctrine-${b}`}>
                Choose this doctrine
              </OrderButton>
            </div>
          ),
        )}
        {!doc && <span className="fl-small">A doctrine is free and permanent: it opens one Mk III branch and closes the other.</span>}
      </div>
    </div>
  );
}

function Loadout({ kind, s, act }: PlanetProps & { kind: UnitKind }) {
  const r = s.factions[0].research;
  const slots = MODULE_SLOTS[kind] ?? 0;
  const fitted: ModuleId[] = r.loadouts[kind] ?? [];
  const mods = MODULE_ORDER.filter(m => MODULES[m].fits.includes(kind));
  return (
    <div className="fl-loadout-row">
      <span className="fl-loadout-kind">
        {unitName(kind)} <span className="fl-loadout-slots">{fitted.length}/{slots} slots</span>
      </span>
      <div className="fl-loadout-chips">
        {mods.map(m => {
          const on = fitted.includes(m);
          const next = on ? fitted.filter(x => x !== m) : [...fitted, m];
          const unlocked = r.done.includes(MODULES[m].unlock);
          const full = !on && fitted.length >= slots;
          return (
            <button
              key={m}
              type="button"
              className="fl-loadout-chip"
              aria-pressed={on}
              disabled={!unlocked || full}
              title={!unlocked ? `Needs ${UPGRADES[MODULES[m].unlock].name}.` : full ? 'Every slot is full: take a module off first.' : MODULES[m].blurb}
              onClick={() => act({ type: 'loadout', kind, modules: next })}
            >
              {MODULES[m].name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
