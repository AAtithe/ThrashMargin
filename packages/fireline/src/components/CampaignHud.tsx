import { useState, type CSSProperties } from 'react';
import { abilityProblem, heroUnit } from '../sim/mission';
import {
  HERO_ABILITY,
  HERO_COOLDOWN_PER_LEVEL,
  HERO_HP_PER_LEVEL,
  HERO_LEVEL_XP,
  HERO_MAX_LEVEL,
  POWERS,
  TICKS_PER_SECOND,
  UNITS,
  type HeroKind,
  type SupportPower,
} from '../sim/rules';
import type { GameState, ObjectiveRuntime, Unit } from '../sim/types';
import { HeroPortrait } from './CampaignArt';

/**
 * The battle screen's campaign layer: objectives, mission clock, hero bar and support powers.
 * Rendered only when `s.mission` is set, so a skirmish never reaches any of it.
 */

/** Keys that select heroes 1 to 4, in hero-bar order. */
export const HERO_KEYS = ['z', 'x', 'c', 'v'] as const;
export const POWER_ORDER: SupportPower[] = ['recon', 'barrage', 'reinforce'];

export type Targeting = { kind: 'ability'; heroId: number; hero: HeroKind } | { kind: 'power'; power: SupportPower } | null;

/** A hero's name mid-sentence: "the Spy". */
export const heroName = (k: HeroKind) => UNITS[k].name.replace(/^The /, 'the ');

export const clockOf = (ticks: number) => {
  const secs = Math.max(0, Math.ceil(ticks / TICKS_PER_SECOND));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
};

/** A hero's full ability cooldown at its level, for the sweep. */
export const abilityCooldownOf = (kind: HeroKind, level: number) =>
  Math.max(1, Math.round(HERO_ABILITY[kind].cooldown * (1 - HERO_COOLDOWN_PER_LEVEL * (level - 1))));

const maxHpOf = (u: Unit, s: GameState) => {
  const level = u.hero?.level ?? 1;
  return UNITS[u.kind].hp * (1 + HERO_HP_PER_LEVEL * (level - 1)) * (s.perks?.unitHpMul ?? 1);
};

/** 0..1 through the current level; 1 at the top level. */
export function levelProgress(xp: number, level: number): number {
  if (level >= HERO_MAX_LEVEL) return 1;
  const lo = HERO_LEVEL_XP[level - 1];
  const hi = HERO_LEVEL_XP[level];
  return Math.max(0, Math.min(1, (xp - lo) / (hi - lo)));
}

/** Why the ability button is unusable right now, or null. Building-target abilities only need a target later. */
export function abilityBlock(s: GameState, u: Unit): string | null {
  const kind = u.kind as HeroKind;
  if (u.hero && u.hero.abilityCd > 0) return `Ready in ${Math.ceil(u.hero.abilityCd / TICKS_PER_SECOND)}s`;
  if (HERO_ABILITY[kind].target === 'none') return abilityProblem(s, 0, u.id);
  return null;
}

export function ObjectivesPanel({ s }: { s: GameState }) {
  const [open, setOpen] = useState(true);
  const m = s.mission;
  if (!m) return null;
  const left = m.timeLimit !== null ? m.timeLimit - s.tick : null;
  return (
    <section className="fl-objectives" data-testid="objectives" aria-label="Objectives">
      <header>
        <button type="button" className="fl-objectives-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          Objectives <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>
        {left !== null && (
          <span className="fl-mission-clock" data-low={left < 60 * TICKS_PER_SECOND ? '1' : '0'} data-testid="mission-clock" title="Time left to complete the objectives">
            {clockOf(left)}
          </span>
        )}
      </header>
      {open && (
        <>
          <ul>
            {m.objectives.map((o, i) => (
              <ObjectiveRow key={`p${i}`} o={o} />
            ))}
          </ul>
          {m.bonus.length > 0 && (
            <>
              <p className="fl-objectives-sub">Bonus, optional: a star each</p>
              <ul>
                {m.bonus.map((o, i) => (
                  <ObjectiveRow key={`b${i}`} o={o} bonus />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

function ObjectiveRow({ o, bonus = false }: { o: ObjectiveRuntime; bonus?: boolean }) {
  const state = o.failed ? 'failed' : o.done ? 'done' : 'open';
  return (
    <li className="fl-objective" data-state={state} data-bonus={bonus ? '1' : '0'}>
      <span className="fl-objective-mark" aria-label={state === 'done' ? 'Done' : state === 'failed' ? 'Failed' : 'Not yet'}>
        {state === 'done' ? '✓' : state === 'failed' ? '✕' : bonus ? '☆' : '○'}
      </span>
      <span className="fl-objective-text">
        {o.label}
        {state === 'open' && o.progress > 0 && o.progress < 1 && (
          <span className="fl-bar" aria-hidden="true">
            <span style={{ width: `${Math.round(o.progress * 100)}%` }} />
          </span>
        )}
      </span>
    </li>
  );
}

export function HeroBar({
  s,
  heroes,
  selected,
  targeting,
  onSelect,
  onAbility,
}: {
  s: GameState;
  /** Heroes fielded in this mission, in bar order, fallen ones included. */
  heroes: HeroKind[];
  selected: Set<number>;
  targeting: Targeting;
  onSelect: (kind: HeroKind) => void;
  onAbility: (kind: HeroKind) => void;
}) {
  if (!heroes.length) return null;
  return (
    <div className="fl-herobar" data-testid="hero-bar" role="group" aria-label="Heroes">
      {heroes.map((kind, i) => {
        const u = heroUnit(s, 0, kind);
        const key = HERO_KEYS[i]?.toUpperCase();
        const ab = HERO_ABILITY[kind];
        if (!u || !u.hero) {
          return (
            <div key={kind} className="fl-hero-slot" data-fallen="1" data-testid={`hero-${kind}`}>
              <HeroPortrait hero={kind} level={1} wounded size={44} />
              <div className="fl-hero-info">
                <strong>{UNITS[kind].name}</strong>
                <span className="fl-hero-fallen">Fallen: out for this mission</span>
              </div>
            </div>
          );
        }
        const level = u.hero.level;
        const hp = Math.max(0, Math.min(1, u.hp / maxHpOf(u, s)));
        const block = abilityBlock(s, u);
        const cdFull = abilityCooldownOf(kind, level);
        const sweep = u.hero.abilityCd > 0 ? Math.min(1, u.hero.abilityCd / cdFull) : 0;
        const aiming = targeting?.kind === 'ability' && targeting.heroId === u.id;
        const busy = u.hero.active;
        return (
          <div key={kind} className="fl-hero-slot" data-selected={selected.has(u.id) ? '1' : '0'} data-testid={`hero-${kind}`}>
            <button
              type="button"
              className="fl-hero-pick"
              onClick={() => onSelect(kind)}
              title={`Select ${heroName(kind)} (${key}; twice to jump to it)`}
              aria-label={`Select ${heroName(kind)}, hotkey ${key}`}
            >
              <HeroPortrait hero={kind} level={level} size={44} />
              {key && <kbd className="fl-hero-key">{key}</kbd>}
            </button>
            <div className="fl-hero-info">
              <strong>
                {UNITS[kind].name}
                <span className="fl-pips" aria-label={`Level ${level} of ${HERO_MAX_LEVEL}`}>
                  {Array.from({ length: HERO_MAX_LEVEL }, (_, j) => (
                    <span key={j} data-on={j < level ? '1' : '0'} />
                  ))}
                </span>
              </strong>
              <span className="fl-bar fl-bar-hp" title={`Health ${Math.ceil(u.hp)}`} data-low={hp < 0.35 ? '1' : '0'}>
                <span style={{ width: `${Math.round(hp * 100)}%` }} />
              </span>
              <span className="fl-bar fl-bar-xp" title={level >= HERO_MAX_LEVEL ? 'Top level' : `${Math.floor(u.hero.xp)} / ${HERO_LEVEL_XP[level]} xp to level ${level + 1}`}>
                <span style={{ width: `${Math.round(levelProgress(u.hero.xp, level) * 100)}%` }} />
              </span>
            </div>
            <button
              type="button"
              className="fl-ability"
              data-testid={`ability-${kind}`}
              aria-pressed={aiming}
              disabled={!!block}
              onClick={() => onAbility(kind)}
              title={`${ab.name} (F with ${heroName(kind)} selected). ${block ?? ab.blurb}`}
              style={{ '--sweep': `${Math.round(sweep * 360)}deg` } as CSSProperties}
            >
              <span>{ab.name}</span>
              {busy && <small>{busy.kind === 'capture' ? `Capturing ${Math.round(busy.progress * 100)}%` : 'Active'}</small>}
              {!busy && u.hero.abilityCd > 0 && <small>{Math.ceil(u.hero.abilityCd / TICKS_PER_SECOND)}s</small>}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function PowerBar({ s, targeting, onPower }: { s: GameState; targeting: Targeting; onPower: (p: SupportPower) => void }) {
  const mine = s.powers?.[0];
  if (!mine) return null;
  const list = POWER_ORDER.filter(p => mine[p] !== undefined);
  if (!list.length) return null;
  const mul = s.perks?.powerCooldownMul ?? 1;
  return (
    <div className="fl-powerbar" data-testid="power-bar" role="group" aria-label="Support powers">
      {list.map(p => {
        const cd = mine[p] ?? 0;
        const full = Math.max(1, POWERS[p].cooldown * mul);
        const sweep = cd > 0 ? Math.min(1, cd / full) : 0;
        return (
          <button
            key={p}
            type="button"
            className="fl-power"
            data-testid={`power-${p}`}
            aria-pressed={targeting?.kind === 'power' && targeting.power === p}
            disabled={cd > 0}
            onClick={() => onPower(p)}
            title={`${POWERS[p].name}. ${POWERS[p].blurb}${cd > 0 ? ` Ready in ${Math.ceil(cd / TICKS_PER_SECOND)}s.` : ' Click, then click the map.'}`}
            style={{ '--sweep': `${Math.round(sweep * 360)}deg` } as CSSProperties}
          >
            <span>{POWERS[p].name}</span>
            <small>{cd > 0 ? clockOf(cd) : 'Ready'}</small>
          </button>
        );
      })}
    </div>
  );
}
