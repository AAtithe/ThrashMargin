/**
 * War for the Planet: small pieces shared by the war screens (fireline-planet-design.md, section
 * 17). W4. Presentation only: every rule is read from src/planet/.
 */
import { useId, type CSSProperties, type ReactNode } from 'react';
import { ownerLetter } from '../../game/planetArt';
import { planetActionProblem, type PlanetAction } from '../../planet/turn';
import { factionName } from '../../planet/state';
import { TREATY_NAMES } from '../../planet/diplomacy';
import { RESOURCES, type FactionId, type PlanetMap, type PlanetState, type Resource, type Stance, type Stock } from '../../planet/types';
import { UNITS, VET_KILLS, VET_NAMES, type UnitKind } from '../../sim/rules';
import { PL } from '../../theme';

/** What every war screen is handed: the state, its map, and the one way to change it. */
export interface PlanetProps {
  s: PlanetState;
  map: PlanetMap;
  /** Applies an order through applyPlanetAction; false (with a toast) when it was refused. */
  act: (a: PlanetAction) => boolean;
}

export const RES_NAME: Record<Resource, string> = { ore: 'Ore', fuel: 'Fuel', alloys: 'Alloys', food: 'Food' };

/** "ore 6, alloys 2", or "free". */
export function stockText(st: Partial<Stock>): string {
  const parts = RESOURCES.filter(r => (st[r] ?? 0) !== 0).map(r => `${st[r]} ${r}`);
  return parts.length ? parts.join(', ') : 'free';
}

/** The problem with an order, for a button's title (null: it can be given). */
export const why = (s: PlanetState, a: PlanetAction): string | null => planetActionProblem(s, a, 0);

export const unitName = (k: UnitKind): string => UNITS[k].name;

/** Rookie, Veteran or Elite, from kills (the battle's own thresholds). */
export function rankName(kills: number): string {
  return VET_NAMES[kills >= VET_KILLS[1] ? 2 : kills >= VET_KILLS[0] ? 1 : 0];
}

export const stanceName = (st: Stance): string => (st === 'war' ? 'war' : TREATY_NAMES[st]);

/** A faction's colour as the --fac custom property (a var() string, never a literal), for cards and swatches. */
export const facStyle = (f: number): CSSProperties => (f >= 0 && PL.faction[f] ? ({ '--fac': PL.faction[f] } as CSSProperties) : {});

/**
 * The faction's swatch: its colour as the edge (and a light tint of it inside), its letter inside,
 * so it never relies on colour alone. `lg` is the shield-shaped badge used on faction cards.
 */
export function Swatch({ s, f, size }: { s: PlanetState; f: number; size?: 'lg' }) {
  return (
    <span className="fl-pl-swatch" data-size={size} data-faction={f >= 0 ? f : undefined} style={facStyle(f)} aria-hidden="true">
      {ownerLetter(s, f)}
    </span>
  );
}

export function FactionName({ s, f, size }: { s: PlanetState; f: number; size?: 'lg' }) {
  return (
    <span className="fl-pl-facname">
      <Swatch s={s} f={f} size={size} />
      {f < 0 ? 'Independents' : factionName(s, f)}
    </span>
  );
}

export function StancePill({ st }: { st: Stance }) {
  return (
    <span className="fl-pl-stance" data-stance={st}>
      {stanceName(st)}
    </span>
  );
}

/** Odds as a percentage, coloured by how they lean; `bar` adds a two-part bar (us against them) beside it. */
export function Odds({ p, label = 'Odds', bar = false }: { p: number; label?: string; bar?: boolean }) {
  const tone = p >= 0.6 ? 'good' : p >= 0.4 ? 'even' : 'bad';
  const pct = Math.round(p * 100);
  return (
    <span className="fl-small fl-pl-oddsline">
      {label}
      <span className="fl-pl-odds" data-tone={tone} data-testid="planet-odds">
        {pct}%
      </span>
      {bar && (
        <span className="fl-pl-oddsbar" aria-hidden="true" data-tone={tone}>
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
    </span>
  );
}

/** A labelled button that says, in a visible line under it, why it is disabled. */
export function OrderButton({
  s,
  a,
  act,
  children,
  tone,
  testId,
  id,
  extraProblem,
}: {
  s: PlanetState;
  a: PlanetAction;
  act: (a: PlanetAction) => boolean;
  children: ReactNode;
  tone?: 'primary' | 'danger';
  testId?: string;
  /** An element id, for the guided first turn to ring. */
  id?: string;
  /** A reason from the interface itself (shown first). */
  extraProblem?: string | null;
}) {
  const reasonId = useId();
  const problem = extraProblem ?? why(s, a);
  return (
    <span className="fl-pl-btn-wrap">
      <button
        type="button"
        className={`fl-pl-btn${tone ? ` ${tone}` : ''}`}
        disabled={!!problem}
        aria-describedby={problem ? reasonId : undefined}
        id={id}
        data-testid={testId}
        onClick={() => act(a)}
      >
        {children}
      </button>
      {problem && (
        <span className="fl-pl-why" id={reasonId}>
          {problem}
        </span>
      )}
    </span>
  );
}

/** Turns a treaty has left, in words. */
export function turnsLeftText(ends: number | null, turn: number): string {
  if (ends === null) return 'open-ended';
  const n = ends - turn + 1;
  return n <= 1 ? 'ends this turn' : `${n} turns left`;
}

export const isPlayer = (f: FactionId) => f === 0;
