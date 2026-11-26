import { SelectField } from '../lib/Kit';
import {
  BUILDINGS,
  BUNKER_SLOTS,
  CACHE_RADIUS,
  DECOY_DEFAULT,
  INTEL_RADIUS,
  STRUCTURE_LEVELS,
  TICKS_PER_SECOND,
  UNITS,
  UPGRADES,
  maxLevelOf,
  type BuildingKind,
  type Category,
  type Owner,
} from '../sim/rules';
import { enemiesOf } from '../sim/sides';
import { buildingSpec, unitSpecOf } from '../sim/specs';
import { buildTicksFor, techAllowed } from '../sim/state';
import { researchTicksOf } from '../sim/research';
import {
  DISGUISES,
  garrisonCount,
  intelActive,
  levelOf,
  levelSpecOf,
  nextLevelOf,
  strategicOn,
  upgradePrice,
  upgradesOn,
} from '../sim/structures';
import type { Building, GameAction, GameState } from '../sim/types';
import { FONT, UI } from '../theme';

/**
 * Round 7 (fireline-round7-structures.md): what the selection panel says about one of your
 * structures under the round-7 options (its level and the next, an upgrade's progress, a Bunker's
 * garrison, a Cache being taken, a Decoy's look), and the Intelligence panel. The buttons (Upgrade,
 * Cancel upgrade, Unload) are selection actions (selectionActions.ts); only the Decoy's look is
 * chosen here. Colours only through theme tokens.
 */

const note = { margin: 0, fontSize: '0.72rem', lineHeight: 1.4, color: UI.textSoft } as const;
const secs = (ticks: number) => `${Math.round(ticks / TICKS_PER_SECOND)}s`;

function Progress({ frac, label }: { frac: number; label: string }) {
  const f = Math.max(0, Math.min(1, frac));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f * 100)} className="fl-d-hp" data-tone="good">
      <div style={{ width: `${f * 100}%` }} />
    </div>
  );
}

/** The level a structure stands at and what the next one gives; the work under way, if any. */
function LevelNote({ state, building }: { state: GameState; building: Building }) {
  const levels = STRUCTURE_LEVELS[building.kind];
  if (!levels) return null;
  const level = levelOf(building);
  const max = maxLevelOf(building.kind);
  const here = levelSpecOf(building);
  const next = nextLevelOf(building);
  const price = upgradePrice(state, building);
  return (
    <div data-testid="level-note" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <p style={note}>
        <strong style={{ color: UI.text }}>
          Level {level} of {max}
          {here ? `: ${here.name}` : ''}
        </strong>
        {here ? ` (${here.blurb}).` : '.'}
        {next && !building.upgrade && ` Next, ${next.name}: ${next.blurb}, for ${price.credits} credits${price.alloys ? ` and ${price.alloys} alloys` : ''}, ${secs(next.ticks)} of work.`}
      </p>
      {building.upgrade && next && (
        <>
          <Progress frac={building.upgrade.progress / next.ticks} label={`Upgrade to ${next.name}`} />
          <p data-testid="upgrade-note" style={{ ...note, color: UI.warn }}>
            Upgrading to {next.name}: {Math.round((100 * building.upgrade.progress) / next.ticks)}%. Taking a quarter more damage until it is done.
          </p>
        </>
      )}
    </div>
  );
}

/** The Decoy's look: what enemies take it for. */
function DecoyLook({ state, building, dispatch }: { state: GameState; building: Building; dispatch: (a: GameAction) => boolean }) {
  const look = building.disguise ?? DECOY_DEFAULT;
  const options = DISGUISES.filter(k => techAllowed(state, building.owner, k));
  return (
    <SelectField
      label="Looks like, to the enemy"
      hint="The enemy's strikes, bombers and guns treat it as this, unless an Intelligence Centre of theirs covers it."
      data-testid="decoy-look"
      value={look}
      onChange={e => dispatch({ type: 'disguise', id: building.id, as: e.target.value as BuildingKind })}
    >
      {options.map(k => (
        <option key={k} value={k}>
          {buildingSpec(state, building.owner, k).name}
        </option>
      ))}
    </SelectField>
  );
}

/** One of your structures under the round-7 options: nothing for anything else. */
export function StructureNotes({ state, building, dispatch, touch }: { state: GameState; building: Building; dispatch: (a: GameAction) => boolean; touch: boolean }) {
  const up = upgradesOn(state) && !!STRUCTURE_LEVELS[building.kind];
  const strat = strategicOn(state);
  if (!up && !strat) return null;
  return (
    <>
      {up && <LevelNote state={state} building={building} />}
      {strat && building.kind === 'bunker' && (
        <p data-testid="garrison-note" style={note}>
          <strong style={{ color: UI.text }}>
            Garrison {garrisonCount(building)}/{BUNKER_SLOTS}
          </strong>
          {garrisonCount(building)
            ? `: ${building.garrison!.map(g => UNITS[g.kind].name).join(', ')}.`
            : '.'}{' '}
          {touch ? 'Select infantry, then tap the Bunker to send them in.' : 'Select infantry and right-click the Bunker to send them in.'}
        </p>
      )}
      {strat && building.kind === 'supplycache' && (
        <p data-testid="cache-note" style={{ ...note, color: building.capture ? UI.warn : UI.textSoft }}>
          {building.capture
            ? `Being taken: ${Math.round(building.capture.progress * 100)}%. Put infantry beside it to stop them.`
            : `Mends your infantry and vehicles within ${CACHE_RADIUS} tiles. Enemy infantry beside it, with none of yours, take it over.`}
        </p>
      )}
      {strat && building.kind === 'intelcentre' && (
        <p style={note}>
          {intelActive(state, building.owner)
            ? `Working: enemy research and production in the Intelligence panel; enemy structures within ${INTEL_RADIUS} tiles revealed, Decoys among them seen for what they are.`
            : 'Dark: short of power. Build a Generator and it works again.'}
        </p>
      )}
      {strat && building.kind === 'decoy' && <DecoyLook state={state} building={building} dispatch={dispatch} />}
    </>
  );
}

/** One queue of an enemy's, as names with the first item's progress. */
function queueLine(state: GameState, owner: Owner, cat: Category): string | null {
  const q = state.players[owner].queues[cat];
  if (!q?.length) return null;
  const head = q[0];
  const name = (k: string) => (k in UNITS ? unitSpecOf(state, { kind: k, owner } as never).name : BUILDINGS[k as BuildingKind].name);
  const total = buildTicksFor(state, owner, head.kind);
  const pct = total ? Math.min(100, Math.round((100 * head.progress) / total)) : 100;
  const rest = q.slice(1).map(x => name(x.kind));
  return `${name(head.kind)} ${pct}%${rest.length ? `, then ${rest.join(', ')}` : ''}`;
}

const CAT_NAMES: [Category, string][] = [
  ['building', 'Structures'],
  ['infantry', 'Infantry'],
  ['vehicle', 'Vehicles'],
  ['air', 'Aircraft'],
  ['naval', 'Ships'],
];

/**
 * The Intelligence panel: while you have a working Intelligence Centre, every enemy's research and
 * production queues. Nothing at all without one.
 */
export function IntelPanel({ state }: { state: GameState }) {
  if (!intelActive(state, 0)) return null;
  return (
    <section className="fl-d-block" aria-label="Intelligence" data-testid="intel-panel">
      <h3 className="fl-d-sect">Intelligence</h3>
      {enemiesOf(state, 0).map(o => {
        const p = state.players[o];
        if (!state.buildings.some(b => b.owner === o)) return null;
        const r = p.research;
        const rows = CAT_NAMES.map(([c, label]) => [label, queueLine(state, o, c)] as const).filter(([, v]) => v);
        return (
          <div key={o} data-testid={`intel-side-${o}`} style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 6 }}>
            <strong style={{ fontSize: '0.74rem', color: UI.side[o] }}>{p.name}</strong>
            <span style={{ ...note, fontFamily: FONT.mono }}>
              Research: {r ? `${UPGRADES[r.id].name} ${Math.min(100, Math.round((100 * r.progress) / Math.max(1, researchTicksOf(state, r.id))))}%` : 'none'}
            </span>
            {rows.length ? (
              rows.map(([label, v]) => (
                <span key={label} style={note}>
                  {label}: {v}
                </span>
              ))
            ) : (
              <span style={note}>Nothing in production.</span>
            )}
          </div>
        );
      })}
    </section>
  );
}
