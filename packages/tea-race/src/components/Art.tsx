import type { CSSProperties, ReactNode } from 'react';
import { UI } from '../theme';
import type { ShipClassId } from '../sim/rules';

/**
 * The game's illustrations, all inline SVG so they theme with the page and cost no requests.
 *
 * Drawn as small engraved vignettes rather than icons: line work in `currentColor`, washes from the
 * UI tokens, so a card coloured for a storm draws its storm in the storm's colour and the whole set
 * follows light and dark mode without a second palette. Nothing here knows about game state.
 */

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
};

/** One die face. `tone` colours the pips; a spent die is drawn faint. */
export function Die({
  value,
  size = 18,
  tone = UI.text,
  faint = false,
  title,
}: {
  value: number;
  size?: number;
  tone?: string;
  faint?: boolean;
  title?: string;
}) {
  const pips = PIPS[value] ?? [];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      style={{ display: 'inline-block', verticalAlign: 'middle', opacity: faint ? 0.45 : 1, flex: '0 0 auto' }}
      role="img"
      aria-label={title ?? `a ${value}`}
    >
      <rect x={1} y={1} width={18} height={18} rx={4} fill={UI.panel} stroke={tone} strokeWidth={1.3} />
      {pips.map(([x, y], i) => (
        <circle key={i} cx={1 + x * 18} cy={1 + y * 18} r={1.75} fill={tone} />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Ships, in profile
// ---------------------------------------------------------------------------

/**
 * A ship side-on, by hull class: the clipper long and lofty, the barque deep and square, the
 * Indiaman with a row of gunports. Her owner's colour is the hull; a damaged ship has lost her
 * fore-topmast and flies a broken stump.
 */
export function ShipProfile({
  shipClass = 'clipper',
  colour,
  width = 64,
  damaged = false,
  pennant,
  heel = 0,
}: {
  shipClass?: ShipClassId;
  colour: string;
  width?: number;
  damaged?: boolean;
  /** A small flag at the mainmast head — gold for a ship in the tea race. */
  pennant?: string;
  /** Degrees of heel, for a ship being driven. */
  heel?: number;
}) {
  const barque = shipClass === 'barque';
  const indiaman = shipClass === 'indiaman';
  const deck = 31;
  // Mizzen, main, fore — the bow is to the right. A barque is shorter-sparred and fuller in the
  // sail; an Indiaman sits between the two.
  const scale = barque ? 0.84 : indiaman ? 0.9 : 1;
  const masts = [
    { x: 25, h: 21 * scale },
    { x: 42, h: 26 * scale },
    { x: 58, h: 24 * scale },
  ];
  const sailWidth = barque ? 15 : 13;

  /** Square sails up a mast: course, topsail, topgallant, royal, narrowing aloft. */
  const squares = (x: number, h: number, key: string) => {
    const tiers = h > 20 ? 4 : 3;
    const out: ReactNode[] = [];
    const span = h - 3;
    for (let t = 0; t < tiers; t++) {
      const yBottom = deck - 2.5 - (span / tiers) * t;
      const yTop = yBottom - (span / tiers) + 0.9;
      const wBottom = sailWidth * (1 - t * 0.17);
      const wTop = sailWidth * (1 - (t + 1) * 0.17) + 1;
      out.push(
        <path
          key={`${key}-${t}`}
          d={`M${x - wTop / 2} ${yTop} L${x + wTop / 2} ${yTop} Q${x + wBottom / 2 + 0.8} ${(yTop + yBottom) / 2} ${x + wBottom / 2} ${yBottom} L${x - wBottom / 2} ${yBottom} Q${x - wBottom / 2 + 0.8} ${(yTop + yBottom) / 2} ${x - wTop / 2} ${yTop} Z`}
          fill={UI.panel}
          stroke="currentColor"
          strokeWidth={0.6}
        />,
      );
    }
    return out;
  };

  const fore = masts[2];
  const foreHeight = damaged ? fore.h * 0.5 : fore.h;

  return (
    <svg
      width={width}
      height={width * 0.62}
      viewBox="0 0 80 50"
      style={{ display: 'block', color: UI.textSoft, overflow: 'visible', flex: '0 0 auto' }}
      aria-hidden="true"
    >
      <path d="M0 43 Q10 40 20 43 T40 43 T60 43 T80 43" fill="none" stroke={UI.verdigris} strokeWidth={0.9} opacity={0.7} />
      <path d="M4 47 Q14 44 24 47 T44 47 T64 47 T84 47" fill="none" stroke={UI.verdigris} strokeWidth={0.7} opacity={0.4} />
      <g transform={`rotate(${heel} 40 40)`}>
        {/* Bowsprit, stays and jib, to the fore topmast head. */}
        <line x1={68} y1={deck} x2={79} y2={deck - 6} stroke="currentColor" strokeWidth={1} />
        <path
          d={`M${fore.x + 1} ${deck - foreHeight + 2} L78 ${deck - 5.5} L${fore.x + 3} ${deck - 3} Z`}
          fill={UI.panel}
          stroke="currentColor"
          strokeWidth={0.6}
        />
        {/* Spanker abaft the mizzen. */}
        <path
          d={`M${masts[0].x - 1} ${deck - 3} L${masts[0].x - 1} ${deck - masts[0].h + 5} L${masts[0].x - 11} ${deck - masts[0].h + 9} L${masts[0].x - 13} ${deck - 3} Z`}
          fill={UI.panel}
          stroke="currentColor"
          strokeWidth={0.6}
        />
        {masts.map((m, i) => {
          const broken = damaged && i === 2;
          const h = broken ? foreHeight : m.h;
          return (
            <g key={m.x}>
              <line x1={m.x} y1={deck} x2={m.x} y2={deck - h - 1} stroke="currentColor" strokeWidth={1.1} />
              {squares(m.x, h, `m${i}`)}
              {broken && <path d={`M${m.x} ${deck - h - 1} l3.5 -2.5 l-1 -2`} stroke={UI.bad} strokeWidth={1.2} fill="none" />}
            </g>
          );
        })}
        {pennant && (
          <path d={`M${masts[1].x} ${deck - masts[1].h - 1} l9 2 l-9 2.4 Z`} fill={pennant} stroke="currentColor" strokeWidth={0.3} />
        )}
        {/* Hull: a fine entry, a long run, a counter stern. A barque is fuller and deeper. */}
        <path
          d={
            barque
              ? `M7 ${deck - 1} L71 ${deck} Q70 ${deck + 9} 60 ${deck + 10} L15 ${deck + 10} Q8 ${deck + 8} 7 ${deck - 1} Z`
              : `M6 ${deck - 2} L72 ${deck - 1} Q68 ${deck + 8} 56 ${deck + 9} L16 ${deck + 9} Q9 ${deck + 7} 6 ${deck - 2} Z`
          }
          fill={colour}
          stroke="currentColor"
          strokeWidth={0.9}
        />
        <path d={`M8 ${deck + 1.6} L70 ${deck + 2.2}`} stroke={UI.panel} strokeWidth={0.9} opacity={0.85} />
        {indiaman &&
          [17, 25, 33, 41, 49, 57].map(x => (
            <rect key={x} x={x} y={deck + 3.6} width={3} height={2.4} fill={UI.text} opacity={0.85} />
          ))}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Vignettes
// ---------------------------------------------------------------------------

export type VignetteKind =
  | 'storm'
  | 'piracy'
  | 'insurance'
  | 'contract'
  | 'event'
  | 'declare'
  | 'lapse'
  | 'victory'
  | 'teaRace'
  | 'derelict'
  | 'castaways'
  | 'trader'
  | 'pilot'
  | 'crackOn'
  | 'spar'
  | 'repair'
  | 'deliver';

const wave = (y: number, o = 1, w = 0.9) => (
  <path
    d={`M0 ${y} Q6 ${y - 3} 12 ${y} T24 ${y} T36 ${y} T48 ${y}`}
    fill="none"
    stroke="currentColor"
    strokeWidth={w}
    opacity={o}
  />
);

/** A tiny ship for inside a vignette. */
const littleShip = (x: number, y: number, s = 1, damaged = false) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-9 0 L9 0 Q7 4 4 4 L-6 4 Q-8 3 -9 0 Z" fill="currentColor" />
    <line x1={-3} y1={0} x2={-3} y2={damaged ? -6 : -12} stroke="currentColor" strokeWidth={0.9} />
    <line x1={3} y1={0} x2={3} y2={-13} stroke="currentColor" strokeWidth={0.9} />
    {!damaged && <path d="M-6 -11 L0 -11 L-0.5 -3 L-5.5 -3 Z" fill={UI.panel} stroke="currentColor" strokeWidth={0.6} />}
    <path d="M0 -12 L6 -12 L5.5 -3 L0.5 -3 Z" fill={UI.panel} stroke="currentColor" strokeWidth={0.6} />
  </g>
);

const SCENES: Record<VignetteKind, ReactNode> = {
  storm: (
    <>
      <path d="M8 14 Q8 6 17 7 Q20 1 28 4 Q36 2 38 9 Q45 10 42 16 Z" fill={UI.panelRaised} stroke="currentColor" strokeWidth={0.9} />
      <path d="M24 16 L20 25 L25 25 L21 33" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
      <g transform="rotate(-14 24 36)">{littleShip(30, 37, 0.8)}</g>
      {wave(41, 1, 1.1)}
      {wave(45, 0.6)}
      <path d="M6 20 l-2 6 M12 20 l-2 6 M36 20 l-2 6 M42 20 l-2 6" stroke="currentColor" strokeWidth={0.6} opacity={0.6} />
    </>
  ),
  piracy: (
    <>
      <path d="M14 8 L34 8 Q36 16 34 24 L14 24 Z" fill="currentColor" />
      <line x1={14} y1={6} x2={14} y2={42} stroke="currentColor" strokeWidth={1.2} />
      <circle cx={24} cy={14} r={3.4} fill={UI.panel} />
      <rect x={22.2} y={16} width={3.6} height={2} fill={UI.panel} />
      <path d="M18 20 L30 23 M30 20 L18 23" stroke={UI.panel} strokeWidth={1.4} />
      {wave(42, 1)}
      {wave(46, 0.5)}
    </>
  ),
  insurance: (
    <>
      <rect x={12} y={6} width={24} height={32} fill={UI.panel} stroke="currentColor" strokeWidth={0.9} />
      <path d="M16 12 H32 M16 16 H32 M16 20 H28 M16 24 H30" stroke="currentColor" strokeWidth={0.7} opacity={0.6} />
      <circle cx={30} cy={33} r={5} fill="currentColor" />
      <path d="M27.5 33 l2 2 l3.5 -4" stroke={UI.panel} strokeWidth={1.2} fill="none" />
    </>
  ),
  contract: (
    <>
      <path d="M10 8 H34 L38 12 V40 H10 Z" fill={UI.panel} stroke="currentColor" strokeWidth={0.9} />
      <path d="M14 15 H32 M14 20 H34 M14 25 H30" stroke="currentColor" strokeWidth={0.7} opacity={0.6} />
      <circle cx={30} cy={33} r={4} fill={UI.bad} opacity={0.85} />
      <path d="M28 37 l-1 5 l3 -2 l3 2 l-1 -5" fill={UI.bad} opacity={0.85} />
    </>
  ),
  event: (
    <>
      <rect x={6} y={10} width={36} height={28} fill={UI.panel} stroke="currentColor" strokeWidth={0.9} />
      <rect x={9} y={13} width={30} height={6} fill="currentColor" />
      <path d="M9 23 H24 M9 27 H24 M9 31 H24 M9 35 H20" stroke="currentColor" strokeWidth={0.7} opacity={0.6} />
      <rect x={27} y={23} width={12} height={12} fill={UI.panelRaised} stroke="currentColor" strokeWidth={0.6} />
    </>
  ),
  declare: (
    <>
      <path d="M24 6 L27.5 17 H39 L29.8 23.8 L33.2 35 L24 28 L14.8 35 L18.2 23.8 L9 17 H20.5 Z" fill="currentColor" />
      <path d="M8 40 H40" stroke="currentColor" strokeWidth={0.9} />
    </>
  ),
  lapse: (
    <>
      <rect x={12} y={8} width={24} height={30} fill={UI.panel} stroke="currentColor" strokeWidth={0.9} />
      <path d="M12 8 L36 38 M36 8 L12 38" stroke={UI.bad} strokeWidth={1.6} />
    </>
  ),
  victory: (
    <>
      <path d="M10 34 L12 14 L19 22 L24 10 L29 22 L36 14 L38 34 Z" fill="currentColor" />
      <rect x={10} y={35} width={28} height={4} fill="currentColor" />
      <circle cx={24} cy={10} r={2} fill={UI.panel} />
    </>
  ),
  teaRace: (
    <>
      <rect x={4} y={26} width={14} height={13} fill={UI.tintBrass} stroke="currentColor" strokeWidth={0.9} />
      <path d="M4 30 H18 M11 26 V39" stroke="currentColor" strokeWidth={0.6} opacity={0.7} />
      <path d="M7 34 q2 -3 4 0 q2 3 4 0" fill="none" stroke="currentColor" strokeWidth={0.7} />
      {littleShip(32, 30, 1.05)}
      <path d="M41 6 V20" stroke="currentColor" strokeWidth={0.9} />
      <path d="M41 6 H47 V11 H41 Z" fill="currentColor" />
      <path d="M41 6 H44 V8.5 H41 Z M44 8.5 H47 V11 H44 Z" fill={UI.panel} />
      {wave(39, 0.9)}
      {wave(44, 0.5)}
    </>
  ),
  derelict: (
    <>
      <g transform="rotate(18 24 30)">
        <path d="M8 30 L38 30 Q36 37 32 37 L12 37 Q9 35 8 30 Z" fill="currentColor" />
        <line x1={18} y1={30} x2={18} y2={22} stroke="currentColor" strokeWidth={1.1} />
        <path d="M18 22 l4 -3" stroke="currentColor" strokeWidth={1.1} />
        <line x1={28} y1={30} x2={28} y2={25} stroke="currentColor" strokeWidth={1.1} />
      </g>
      {wave(40, 1)}
      {wave(45, 0.5)}
      <circle cx={38} cy={10} r={3} fill="none" stroke="currentColor" strokeWidth={0.7} opacity={0.6} />
    </>
  ),
  castaways: (
    <>
      <path d="M6 36 Q24 26 42 36 Z" fill={UI.tintBrass} stroke="currentColor" strokeWidth={0.8} />
      <path d="M30 34 Q31 22 28 12" fill="none" stroke="currentColor" strokeWidth={1.3} />
      <path d="M28 12 q-8 -2 -12 4 M28 12 q8 -3 12 3 M28 12 q-3 -6 -9 -6 M28 12 q4 -6 10 -5" fill="none" stroke="currentColor" strokeWidth={1} />
      <path d="M14 30 Q12 22 16 16 Q12 12 15 8" fill="none" stroke="currentColor" strokeWidth={0.8} opacity={0.6} strokeDasharray="2 2" />
      {wave(41, 1)}
      {wave(46, 0.5)}
    </>
  ),
  trader: (
    <>
      <path d="M8 32 L38 32 Q36 38 30 38 L14 38 Q9 37 8 32 Z" fill="currentColor" />
      <line x1={22} y1={32} x2={22} y2={8} stroke="currentColor" strokeWidth={1} />
      <path d="M22 8 Q36 14 34 30 L22 30 Z" fill={UI.panel} stroke="currentColor" strokeWidth={0.8} />
      <path d="M23 13 H31 M23 18 H34 M23 23 H34" stroke="currentColor" strokeWidth={0.5} opacity={0.6} />
      <rect x={10} y={27} width={6} height={5} fill={UI.tintBrass} stroke="currentColor" strokeWidth={0.6} />
      {wave(42, 1)}
      {wave(46, 0.5)}
    </>
  ),
  pilot: (
    <>
      <path d="M12 34 L32 34 Q30 39 26 39 L16 39 Q13 38 12 34 Z" fill="currentColor" />
      <line x1={22} y1={34} x2={22} y2={20} stroke="currentColor" strokeWidth={0.9} />
      <path d="M22 20 L30 32 L22 32 Z" fill={UI.panel} stroke="currentColor" strokeWidth={0.7} />
      <rect x={34} y={10} width={6} height={8} fill={UI.tintBrass} stroke="currentColor" strokeWidth={0.8} />
      <path d="M37 8 v2 M33 18 h8" stroke="currentColor" strokeWidth={0.8} />
      <path d="M37 14 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0" fill="none" stroke={UI.brass} strokeWidth={0.5} opacity={0.6} />
      <path d="M2 26 q4 -2 6 0 q3 2 6 0" fill="none" stroke="currentColor" strokeWidth={0.7} opacity={0.6} />
      {wave(43, 1)}
    </>
  ),
  crackOn: (
    <>
      <g transform="rotate(-12 24 32)">{littleShip(24, 32, 1.4)}</g>
      <path d="M38 34 q4 -6 8 -4 M36 30 q5 -8 10 -7 M40 38 q3 -3 7 -2" fill="none" stroke="currentColor" strokeWidth={0.8} />
      <path d="M2 14 H12 M0 19 H9 M3 24 H11" stroke="currentColor" strokeWidth={0.8} opacity={0.6} />
      {wave(42, 1, 1.1)}
      {wave(46, 0.5)}
    </>
  ),
  spar: (
    <>
      {littleShip(24, 34, 1.4, true)}
      <path d="M20 10 l6 5 m-6 0 l6 -5" stroke={UI.bad} strokeWidth={1.4} />
      <path d="M30 14 l9 6" stroke="currentColor" strokeWidth={1.3} />
      {wave(42, 1)}
      {wave(46, 0.5)}
    </>
  ),
  repair: (
    <>
      <path d="M10 38 L30 18" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" />
      <rect x={26} y={8} width={14} height={8} rx={1} transform="rotate(45 33 12)" fill="currentColor" />
      <path d="M14 14 L34 34" stroke="currentColor" strokeWidth={1.2} strokeDasharray="2 2" opacity={0.6} />
      <path d="M6 42 H42" stroke="currentColor" strokeWidth={0.9} />
    </>
  ),
  deliver: (
    <>
      <path d="M8 40 H40" stroke="currentColor" strokeWidth={0.9} />
      <line x1={12} y1={40} x2={12} y2={8} stroke="currentColor" strokeWidth={1.2} />
      <line x1={12} y1={8} x2={34} y2={12} stroke="currentColor" strokeWidth={1.2} />
      <line x1={30} y1={11} x2={30} y2={22} stroke="currentColor" strokeWidth={0.7} />
      <rect x={25} y={22} width={10} height={8} fill={UI.tintBrass} stroke="currentColor" strokeWidth={0.8} />
      <rect x={18} y={32} width={10} height={8} fill={UI.tintBrass} stroke="currentColor" strokeWidth={0.8} />
      <rect x={29} y={32} width={10} height={8} fill={UI.tintBrass} stroke="currentColor" strokeWidth={0.8} />
    </>
  ),
};

/** A small engraved scene, drawn in its colour. */
export function Vignette({
  kind,
  size = 44,
  colour,
  style,
}: {
  kind: VignetteKind;
  size?: number;
  colour?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      style={{ display: 'block', flex: '0 0 auto', color: colour ?? UI.textSoft, overflow: 'hidden', ...style }}
      aria-hidden="true"
    >
      {SCENES[kind]}
    </svg>
  );
}

/** A single tea chest, the race's mark wherever it appears. */
export function TeaChest({ size = 14, colour = UI.brass }: { size?: number; colour?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={{ display: 'inline-block', verticalAlign: 'middle' }} aria-hidden="true">
      <rect x={1.5} y={3} width={13} height={11} fill={UI.tintBrass} stroke={colour} strokeWidth={1.1} />
      <path d="M1.5 6.5 H14.5 M8 3 V14" stroke={colour} strokeWidth={0.8} />
      <path d="M4 10 q1.5 -2 3 0 q1.5 2 3 0" fill="none" stroke={colour} strokeWidth={0.8} />
    </svg>
  );
}
