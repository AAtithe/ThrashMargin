/**
 * Generals (fireline-round6-design.md, workstream C): everything of theirs on screen. The setup
 * fields, the General's button in a battle, its note in the selection panel, and How to play's panel.
 * Each is placed by one line between workstream C's markers in the file that shows it.
 */
import { fieldGenerals, generalCooldown, generalOf } from '../sim/generals';
import {
  GENERAL_AURA_DAMAGE,
  GENERAL_AURA_RANGE,
  GENERAL_AURA_RELOAD,
  GENERAL_FACTION,
  GENERAL_IDS,
  GENERAL_REPLACE_TICKS,
  GENERALS,
  UNITS,
  type Faction,
  type GeneralId,
  type SkirmishSetup,
} from '../sim/rules';
import { maxHpOf } from '../sim/state';
import type { GameState, Unit } from '../sim/types';
import { Label, ManualSection, bodySmall } from './ui';

const pct = (mul: number) => `${Math.round(Math.abs(1 - mul) * 100)}%`;
const seconds = (ticks: number) => Math.ceil(ticks / 10);

/** The setup's two fields: a doctrine General per seat, and Generals (the field General) off or on. */
export function GeneralsSetup({ value, set }: { value: SkirmishSetup; set: (patch: Partial<SkirmishSetup>) => void }) {
  const advanced = value.tech === 'advanced';
  const on = advanced && value.generals === true;
  const seats = Array.from({ length: value.sides }, (_, i) => i);
  const factionAt = (i: number): Faction => value.factions?.[i] ?? 'meridian';
  const pickAt = (i: number): GeneralId | null => {
    const g = value.generalPicks?.[i] ?? null;
    return g && GENERAL_FACTION[g] === factionAt(i) ? g : null;
  };
  const pick = (i: number, g: GeneralId | null) => set({ generalPicks: seats.map(j => (j === i ? g : pickAt(j))) });
  const label = (i: number) => (i === 0 ? 'You' : value.sides === 2 ? 'Computer' : `Computer ${i}`);
  return (
    <>
      <div className="fl-setup-field" data-testid="generals-doctrine">
        <Label>Doctrine General</Label>
        <div className="fl-gen-seats">
          {seats.map(i => {
            const chosen = pickAt(i);
            const own = GENERAL_IDS.filter(g => GENERAL_FACTION[g] === factionAt(i));
            return (
              <div key={i} className="fl-gen-seat">
                <span className="fl-gen-seat-name">{label(i)}</span>
                <div className="fl-seg" role="radiogroup" aria-label={`Doctrine General: ${label(i)}`}>
                  <button type="button" role="radio" aria-checked={chosen === null} data-testid={`general-${i}-none`} onClick={() => pick(i, null)}>
                    {i > 0 && on ? 'Any' : 'None'}
                  </button>
                  {own.map(g => (
                    <button key={g} type="button" role="radio" aria-checked={chosen === g} data-testid={`general-${i}-${g}`} title={GENERALS[g].blurb} onClick={() => pick(i, g)}>
                      {GENERALS[g].name.replace('General ', '')} ({GENERALS[g].doctrine})
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="fl-setup-note" data-testid="generals-doctrine-note">
          {pickAt(0) ? `${GENERALS[pickAt(0)!].name}: ${GENERALS[pickAt(0)!].blurb}` : 'No doctrine for you: every price and rate as standard.'}
          {on ? ' With Generals on, a computer seat left on Any fights under one of its army\'s two, chosen by the seed.' : ''}
        </p>
      </div>
      <div className="fl-setup-field" data-testid="generals-field">
        <Label>Generals</Label>
        <div className="fl-seg" role="radiogroup" aria-label="Generals">
          {[false, true].map(v => (
            <button
              key={v ? 'on' : 'off'}
              type="button"
              role="radio"
              aria-checked={!!value.generals === v}
              disabled={!advanced && v}
              data-testid={`generals-${v ? 'on' : 'off'}`}
              onClick={() => set({ generals: v })}
            >
              {v ? 'On' : 'Off'}
            </button>
          ))}
        </div>
        <p className="fl-setup-note">
          {!advanced
            ? 'Advanced tech only.'
            : on
              ? `Every side may field one General, trained at the Barracks once a Comms Uplink stands. Units within ${GENERAL_AURA_RANGE} tiles of it hit ${pct(GENERAL_AURA_DAMAGE)} harder and fire ${pct(GENERAL_AURA_RELOAD)} faster. Lose it and the doctrine counts at half until a replacement arrives.`
              : 'No field Generals: the doctrine, if any, holds all battle.'}
        </p>
      </div>
    </>
  );
}

/** What the General's button should do when pressed (or 0 is pressed): select it, or with it already the whole selection, centre on it. */
export function generalPress(s: GameState, selected: Set<number>): { select: Set<number> } | { centre: { x: number; y: number } } | null {
  const g = generalOf(s, 0);
  if (!g) return null;
  if (selected.size === 1 && selected.has(g.id)) return { centre: { x: g.x, y: g.y } };
  return { select: new Set([g.id]) };
}

/** The General's button beside the hero and power bars: its health, or why there is none. Skirmish with Generals on only. */
export function GeneralButton({
  s,
  selected,
  onPress,
  lift = 0,
  inline = false,
}: {
  s: GameState;
  selected: Set<number>;
  onPress: () => void;
  lift?: number;
  /** In the bar row beside the hero and power bars (round 6 integration), rather than in its own corner. */
  inline?: boolean;
}) {
  if (!fieldGenerals(s) || s.winner !== null) return null;
  const g = generalOf(s, 0);
  const p = s.players[0];
  const doctrine = p.general ? GENERALS[p.general] : null;
  const queued = p.queues.infantry.some(q => q.kind === 'general');
  const wait = generalCooldown(s, 0);
  let status: string;
  if (g) status = doctrine ? `${doctrine.doctrine} doctrine at full strength` : 'Command aura';
  else if (queued) status = 'In training at the Barracks';
  else if (wait > 0) status = `Fallen: a replacement in ${seconds(wait)}s`;
  else if (p.generalLostAt !== undefined) status = 'Fallen: train a replacement';
  else status = 'Train one at the Barracks';
  const hp = g ? Math.max(0, Math.min(1, g.hp / maxHpOf(g))) : 0;
  return (
    <div className={inline ? 'fl-genbar fl-genbar-inline' : 'fl-genbar'} style={lift && !inline ? { bottom: 10 + lift } : undefined}>
      {inline && (
        <span className="fl-d-dock-label" aria-hidden="true">
          General
        </span>
      )}
      <button
        type="button"
        className="fl-genbtn"
        data-testid="general-button"
        data-selected={g && selected.has(g.id) ? '1' : '0'}
        data-fallen={!g && p.generalLostAt !== undefined ? '1' : '0'}
        data-ready={g ? '1' : '0'}
        disabled={!g}
        title={g ? 'Select your General (0); press again to jump to it' : status}
        onClick={onPress}
      >
        <span className="fl-genbtn-star" aria-hidden="true">
          ★
        </span>
        <span className="fl-genbtn-info">
          <strong>
            {doctrine ? doctrine.name : 'General'} <kbd>0</kbd>
          </strong>
          <span>{status}</span>
          {g && (
            <span className="fl-genbtn-hp" aria-label={`Health ${Math.round(hp * 100)}%`}>
              <span style={{ width: `${hp * 100}%` }} data-low={hp < 0.4 ? '1' : '0'} />
            </span>
          )}
          {!g && p.generalLostAt !== undefined && doctrine && <span className="fl-genbtn-half">Doctrine at half strength</span>}
        </span>
      </button>
    </div>
  );
}

/** The selection panel's note when a General is selected: what its aura does. */
export function GeneralNote({ units }: { units: Unit[] }) {
  if (!units.some(u => u.kind === 'general')) return null;
  return (
    <p className="fl-gen-note" data-testid="general-note">
      Command aura: your units within {GENERAL_AURA_RANGE} tiles hit {pct(GENERAL_AURA_DAMAGE)} harder and fire {pct(GENERAL_AURA_RELOAD)} faster. Two auras do not add up.
    </p>
  );
}

/** How to play: Generals. */
export function GeneralsPanel() {
  return (
    <ManualSection title="Generals">
      <ul style={{ ...bodySmall, margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <li>
          In a skirmish each side may fight under a doctrine General, chosen in the setup: one of its army&apos;s two. Each changes a few
          prices and rates for that side alone.
        </li>
        {GENERAL_IDS.map(g => (
          <li key={g}>
            <strong>
              {GENERALS[g].name} ({GENERALS[g].doctrine})
            </strong>
            : {GENERALS[g].blurb}
          </li>
        ))}
        <li>
          With <strong>Generals</strong> on (advanced tech), every side may also field one General unit ({UNITS.general.cost} credits, at the
          Barracks once a Comms Uplink stands). Your units within {GENERAL_AURA_RANGE} tiles of it hit {pct(GENERAL_AURA_DAMAGE)} harder and
          fire {pct(GENERAL_AURA_RELOAD)} faster; two Generals&apos; auras do not add up. Press <kbd>0</kbd> to select yours, twice to jump to it.
        </li>
        <li>
          If your General falls, its aura goes with it and your doctrine counts at half strength until a replacement arrives. A replacement
          may be trained {seconds(GENERAL_REPLACE_TICKS)} seconds after the fall. The computer keeps its General behind its attack and pulls it
          back when it is badly hurt.
        </li>
      </ul>
    </ManualSection>
  );
}
