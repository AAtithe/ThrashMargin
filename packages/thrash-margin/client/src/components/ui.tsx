/**
 * Shared building blocks: buttons, cards, labels, resource chips, a stepper slider and a modal.
 */
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { FONT, UI, signed } from '../theme';
import Icon, { type IconName } from './Icon';

export const RESOURCE_META: Record<'gold' | 'food' | 'mat' | 'influence' | 'pop' | 'troops' | 'ap', { label: string; icon: IconName; color: string }> = {
  gold: { label: 'Gold', icon: 'gold', color: UI.gold },
  food: { label: 'Food', icon: 'food', color: UI.food },
  mat: { label: 'Materials', icon: 'mat', color: UI.mat },
  influence: { label: 'Influence', icon: 'influence', color: UI.influence },
  pop: { label: 'Population', icon: 'pop', color: UI.pop },
  troops: { label: 'Troops', icon: 'troops', color: UI.troops },
  ap: { label: 'Actions', icon: 'ap', color: UI.ap },
};

type Tone = 'primary' | 'default' | 'danger' | 'quiet' | 'move' | 'attack';

const TONES: Record<Tone, CSSProperties> = {
  primary: { background: UI.accent, color: UI.accentInk, border: `1px solid ${UI.accent}`, fontWeight: 700 },
  default: { background: UI.panelRaised, color: UI.text, border: `1px solid ${UI.ruleStrong}` },
  danger: { background: UI.dangerBg, color: UI.dangerText, border: `1px solid ${UI.bad}` },
  quiet: { background: 'transparent', color: UI.textSoft, border: `1px solid ${UI.rule}` },
  move: { background: UI.moveBg, color: UI.moveText, border: `1px solid ${UI.move}` },
  attack: { background: UI.attackBg, color: UI.attackText, border: `1px solid ${UI.attack}` },
};

export function Button({ children, onClick, disabled, tone = 'default', title, icon, small, full, style }: {
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: Tone;
  title?: string;
  icon?: IconName;
  small?: boolean;
  full?: boolean;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button" className="tm-btn" onClick={onClick} disabled={disabled} title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        padding: small ? '4px 9px' : '7px 12px', borderRadius: 6, fontSize: small ? 12 : 13,
        cursor: disabled ? 'not-allowed' : 'pointer', width: full ? '100%' : undefined, lineHeight: 1.2,
        ...TONES[tone], ...style,
      }}
    >
      {icon && <Icon name={icon} size={small ? 12 : 14} />}
      {children}
    </button>
  );
}

export function Card({ children, title, right, style }: { children: ReactNode; title?: ReactNode; right?: ReactNode; style?: CSSProperties }) {
  return (
    <section style={{ background: UI.panelRaised, border: `1px solid ${UI.rule}`, borderRadius: 8, padding: 12, ...style }}>
      {(title || right) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
          {title && <Label>{title}</Label>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Label({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ fontSize: 10.5, letterSpacing: '0.09em', textTransform: 'uppercase', color: UI.textFaint, fontWeight: 600, ...style }}>
      {children}
    </div>
  );
}

export function Muted({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <p style={{ margin: 0, fontSize: 12, color: UI.textSoft, lineHeight: 1.5, ...style }}>{children}</p>;
}

/** A resource with its stock and, optionally, its per-turn change. */
export function Chip({ kind, value, rate, compact, title }: {
  kind: keyof typeof RESOURCE_META;
  value: number | string;
  rate?: number;
  compact?: boolean;
  title?: string;
}) {
  const m = RESOURCE_META[kind];
  return (
    <span title={title ?? m.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
      <Icon name={m.icon} color={m.color} size={compact ? 13 : 15} />
      <span className="tm-num" style={{ fontFamily: FONT.data, fontSize: compact ? 12 : 13.5, color: UI.text, fontWeight: 600 }}>{value}</span>
      {rate !== undefined && (
        <span className="tm-num" style={{ fontFamily: FONT.data, fontSize: 11, color: rate > 0 ? UI.good : rate < 0 ? UI.bad : UI.textFaint }}>
          {signed(rate)}
        </span>
      )}
    </span>
  );
}

export function Cost({ gold, mat, influence, pop, have }: {
  gold?: number; mat?: number; influence?: number; pop?: number;
  have?: { gold: number; mat: number; influence: number; population: number };
}) {
  const item = (n: number | undefined, kind: 'gold' | 'mat' | 'influence' | 'pop', haveN?: number) => {
    if (!n) return null;
    const short = haveN !== undefined && haveN < n;
    const m = RESOURCE_META[kind];
    return (
      <span key={kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: short ? UI.bad : UI.textSoft }}>
        <Icon name={m.icon} size={11} color={short ? UI.bad : m.color} />
        <span className="tm-num" style={{ fontFamily: FONT.data, fontSize: 11 }}>{n}</span>
      </span>
    );
  };
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      {item(gold, 'gold', have?.gold)}
      {item(mat, 'mat', have?.mat)}
      {item(influence, 'influence', have?.influence)}
      {item(pop, 'pop', have?.population)}
    </span>
  );
}

export function Stat({ label, value, sub, color }: { label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: UI.textFaint }}>{label}</div>
      <div className="tm-num" style={{ fontFamily: FONT.data, fontSize: 15, fontWeight: 700, color: color ?? UI.text }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: UI.textFaint }}>{sub}</div>}
    </div>
  );
}

/** Range slider with -/+ steppers and a max button, for troop counts. */
export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label?: ReactNode }) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const btn: CSSProperties = { width: 26, height: 26, borderRadius: 5, background: UI.panel, border: `1px solid ${UI.ruleStrong}`, color: UI.text, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {label && <div style={{ fontSize: 12, color: UI.textSoft, minWidth: 0, flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>}
      <button type="button" aria-label="Fewer" style={btn} onClick={() => onChange(clamp(value - 1))} disabled={value <= min}><Icon name="minus" size={12} /></button>
      <input className="tm-range" type="range" min={min} max={Math.max(min, max)} value={value} onChange={e => onChange(clamp(Number(e.target.value)))} style={{ flex: 1, minWidth: 60 }} aria-label="Amount" />
      <button type="button" aria-label="More" style={btn} onClick={() => onChange(clamp(value + 1))} disabled={value >= max}><Icon name="plus" size={12} /></button>
      <span className="tm-num" style={{ fontFamily: FONT.data, fontSize: 13, fontWeight: 700, minWidth: 24, textAlign: 'right' }}>{value}</span>
      <button type="button" onClick={() => onChange(max)} style={{ ...btn, width: 'auto', padding: '0 7px', fontSize: 11, color: UI.textSoft }} disabled={value >= max}>max</button>
    </div>
  );
}

export function Modal({ children, onClose, width = 460, label }: { children: ReactNode; onClose?: () => void; width?: number; label: string }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      role="dialog" aria-modal="true" aria-label={label}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: UI.scrim, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        className="tm-modal" onClick={e => e.stopPropagation()}
        style={{ background: UI.panel, border: `1px solid ${UI.ruleStrong}`, borderRadius: 12, width: '100%', maxWidth: width, maxHeight: '88vh', overflowY: 'auto', boxShadow: `0 24px 60px ${UI.shadow}` }}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ title, kicker, onClose, color }: { title: ReactNode; kicker?: ReactNode; onClose?: () => void; color?: string }) {
  return (
    <div style={{ padding: '16px 18px 12px', borderBottom: `1px solid ${UI.rule}`, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ flex: 1 }}>
        {kicker && <Label style={{ color: color ?? UI.textFaint, marginBottom: 4 }}>{kicker}</Label>}
        <h2 style={{ margin: 0, fontFamily: FONT.display, fontSize: 21, fontWeight: 600, color: UI.text }}>{title}</h2>
      </div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: UI.textSoft, cursor: 'pointer', padding: 4 }}>
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

/** A disabled control's reason, shown under it so nobody has to hover to learn why. */
export function Why({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return <div style={{ fontSize: 11, color: UI.warn, marginTop: 4, lineHeight: 1.4 }}>{text}</div>;
}
