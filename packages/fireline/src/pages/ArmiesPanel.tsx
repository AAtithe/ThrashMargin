/**
 * How to play: the two armies (fireline-round6-design.md, workstream A). Every number is read from
 * the rules through the per-army specs, so the tables cannot drift from what a battle plays.
 */
import { Panel, bodySmall } from '../components/ui';
import { iconFor } from '../game/icons';
import { listedCost, statsOf } from '../game/Sidebar';
import {
  BUILDINGS,
  FACTION_DOCTRINES,
  FACTION_MENUS,
  FACTION_NAMES,
  FACTION_OVERLAY,
  FACTIONS,
  UNITS,
  type BuildingKind,
  type Faction,
  type UnitKind,
} from '../sim/rules';
import { buildingSpecFor, unitSpecFor } from '../sim/specs';

type Kind = BuildingKind | UnitKind;

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

/** One army's numbers for a kind, in one short line. */
function facts(f: Faction, k: Kind): string {
  const s = specOf(f, k);
  const out = [`${listedCost(k, f).cost} credits`, `${s.hp} hp`];
  if (!(k in BUILDINGS)) out.push(`${((s as { speed: number }).speed * 10).toFixed(2)} tiles/s`);
  if (s.weapon) out.push(`range ${s.weapon.range}`);
  return out.join(' · ');
}

export default function ArmiesPanel() {
  return (
    <Panel title="Two armies">
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
      <div className="fl-armies-grid">
        {FACTIONS.map(f =>
          SIGNATURE[f].map(k => (
            <div key={k} className="fl-armies-tile" data-army={f}>
              <img src={iconFor(k)} alt="" width={96} height={64} />
              <div className="fl-armies-body">
                <strong>
                  {specOf(f, k).name} <span className="fl-army-tag" data-army={f}>{FACTION_NAMES[f]}</span>
                </strong>
                <span className="fl-armies-facts">{facts(f, k)}</span>
                <span>{specOf(f, k).blurb}</span>
                <details>
                  <summary>All numbers</summary>
                  <dl>
                    {statsOf(k, f).map(r => (
                      <div key={r.label}>
                        <dt>{r.label}</dt>
                        <dd>{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </div>
            </div>
          )),
        )}
      </div>
      <div className="fl-armies-table-wrap">
        <table className="fl-armies-table" data-testid="armies-table">
          <thead>
            <tr>
              <th scope="col">Shared item</th>
              {FACTIONS.map(f => (
                <th key={f} scope="col">
                  {FACTION_NAMES[f]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CHANGED.map(k => (
              <tr key={k}>
                <th scope="row">{specOf('meridian', k).name}</th>
                {FACTIONS.map(f => (
                  <td key={f}>{facts(f, k)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
