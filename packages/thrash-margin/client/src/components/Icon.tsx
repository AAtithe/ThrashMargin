/**
 * A small line-icon set drawn on a 16-unit grid in currentColor. Replaces the emoji the prototype
 * used for icons, which rendered differently on every platform and could not take a colour.
 */
import type { CSSProperties } from 'react';

export type IconName =
  | 'gold' | 'food' | 'mat' | 'influence' | 'pop' | 'troops' | 'ap'
  | 'attack' | 'move' | 'build' | 'upgrade' | 'research' | 'capital' | 'stronghold'
  | 'annex' | 'spy' | 'trade' | 'undo' | 'next' | 'log' | 'ledger' | 'help' | 'close'
  | 'plus' | 'minus' | 'reset' | 'warn' | 'check' | 'peace' | 'flag' | 'eye' | 'fog';

const PATHS: Record<IconName, JSX.Element> = {
  gold: <><circle cx="8" cy="8" r="5.5" /><path d="M8 5v6M6.3 6.4h2.6a1.1 1.1 0 0 1 0 2.2H7.1a1.1 1.1 0 0 0 0 2.2h2.6" /></>,
  food: <><path d="M8 14V6" /><path d="M8 6c0-2 1.5-3.5 3-3.5 0 2-1.5 3.5-3 3.5zM8 6C8 4 6.5 2.5 5 2.5 5 4.5 6.5 6 8 6z" /><path d="M8 10c0-1.6 1.3-2.8 2.8-2.8 0 1.6-1.3 2.8-2.8 2.8zM8 10c0-1.6-1.3-2.8-2.8-2.8 0 1.6 1.3 2.8 2.8 2.8z" /></>,
  mat: <><path d="M2.5 6.5 8 3.5l5.5 3L8 9.5z" /><path d="M2.5 6.5v4L8 13.5l5.5-3v-4M8 9.5v4" /></>,
  influence: <><path d="M3 11.5h10L12 5l-2.5 2.5L8 4 6.5 7.5 4 5z" /><path d="M3 13.5h10" /></>,
  pop: <><circle cx="6" cy="5.5" r="2" /><path d="M2.5 13c.4-2.2 1.8-3.5 3.5-3.5s3.1 1.3 3.5 3.5" /><circle cx="11" cy="6" r="1.6" /><path d="M10.2 9.7c1.6-.2 2.9.9 3.3 3.3" /></>,
  troops: <><path d="M8 2.5 3.5 4.2v3.6c0 2.9 1.9 4.9 4.5 5.7 2.6-.8 4.5-2.8 4.5-5.7V4.2z" /></>,
  ap: <><path d="M9 2 4.5 9H8l-1 5 4.5-7H8z" /></>,
  attack: <><path d="M3 3l7.5 7.5M13 3 5.5 10.5" /><path d="M9 12l3 1.5L10.5 10M7 12l-3 1.5L5.5 10" /></>,
  move: <><path d="M2.5 8h10M10 5l3 3-3 3" /></>,
  build: <><path d="M9.5 3.5 12.5 6.5 6 13H3v-3z" /><path d="M8 5l3 3" /></>,
  upgrade: <><path d="M4 9.5 8 5.5l4 4M4 13l4-4 4 4" /></>,
  research: <><path d="M6.5 2.5h3M7 2.5v4L3.5 12.5a1 1 0 0 0 .9 1.5h7.2a1 1 0 0 0 .9-1.5L9 6.5v-4" /><path d="M5 10h6" /></>,
  capital: <><path d="M2.5 12h11L12.5 5 10 7.5 8 3.5 6 7.5 3.5 5z" /></>,
  stronghold: <><path d="M8 2.5l1.7 3.5 3.8.5-2.8 2.6.7 3.8L8 11.1l-3.4 1.8.7-3.8-2.8-2.6 3.8-.5z" /></>,
  annex: <><path d="M4 14V2.5M4 3h7.5l-1.5 2.5 1.5 2.5H4" /></>,
  spy: <><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></>,
  trade: <><path d="M8 2.5v11M4 13.5h8M3 5h10" /><path d="M3 5 1.5 9h3zM13 5l-1.5 4h3z" /></>,
  undo: <><path d="M5.5 4 2.5 7l3 3" /><path d="M2.5 7H10a3.5 3.5 0 0 1 0 7H7" /></>,
  next: <><path d="M3 8h9M9 4.5 12.5 8 9 11.5" /></>,
  log: <><path d="M3 4h10M3 8h10M3 12h6" /></>,
  ledger: <><path d="M3.5 2.5h7l2 2v9h-9z" /><path d="M5.5 7h5M5.5 9.5h5M5.5 12h3" /></>,
  help: <><circle cx="8" cy="8" r="5.5" /><path d="M6.5 6.3a1.6 1.6 0 1 1 2.2 1.5c-.5.2-.7.6-.7 1.1v.4M8 11.3v.2" /></>,
  close: <><path d="M4 4l8 8M12 4l-8 8" /></>,
  plus: <><path d="M8 3.5v9M3.5 8h9" /></>,
  minus: <><path d="M3.5 8h9" /></>,
  reset: <><path d="M3 8a5 5 0 1 0 1.5-3.5" /><path d="M3 2.5V5h2.5" /></>,
  warn: <><path d="M8 2.5 14 13H2z" /><path d="M8 6.5v3M8 11.3v.2" /></>,
  check: <><path d="M3 8.5 6.5 12 13 4.5" /></>,
  peace: <><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5v11M8 8l-3.8 3.8M8 8l3.8 3.8" /></>,
  flag: <><path d="M4 14V2.5M4 3h8l-2 3 2 3H4" /></>,
  eye: <><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></>,
  fog: <><path d="M2 6h9M4 9h10M2 12h8" /></>,
};

export default function Icon({ name, size = 14, color, style, title }: {
  name: IconName;
  size?: number;
  color?: string;
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke={color ?? 'currentColor'} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, verticalAlign: 'middle', ...style }}
      role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}
