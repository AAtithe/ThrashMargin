/**
 * Steady Eddie's visual identity, in one place.
 *
 * Forked from The Tea Race's theme.ts (see steady-eddie-design.md), which itself settled two chart
 * treatments as an Artifact before any map code was written — the lesson worth keeping is prototype
 * a look, get a reaction, then write the code. `CHART_STYLE` still switches the whole board in one
 * word.
 *
 * The surrounding UI palette is deliberately NOT a third scheme. It is the haulier's-office chrome
 * the chart sits inside: dark slate ground, brass and verdigris for the two things that matter most
 * (money and the road network), warm paper for text. Slab serif for display, because a consignment
 * note reads like exactly this kind of shipping notice.
 */

export type ChartStyleName = 'engraver' | 'printed';

export interface ChartPalette {
  sea: string;
  land: string;
  coast: string;
  graticule: string;
  /** A road leg nobody is currently driving. */
  route: string;
  /** The leg a selected vehicle is running. */
  routeLive: string;
  depot: string;
  depotHome: string;
  /** A depot named by one of the five face-up commissions. */
  depotContract: string;
  label: string;
  labelHalo: string;
  distance: string;
  /** A leg prone to fog, snow or flooding — worse in season. */
  weatherRisk: string;
  /** Roads that carry a theft rating. */
  theft: string;
}

export const CHART_PALETTES: Record<ChartStyleName, ChartPalette> = {
  // Dark, high-contrast, bone coastline on near-black water.
  engraver: {
    sea: '#0a151a',
    land: '#16242b',
    coast: '#e2d3ae',
    graticule: '#1f3540',
    route: '#3f5f6b',
    routeLive: '#d98f3c',
    depot: '#e8d9b4',
    depotHome: '#d98f3c',
    depotContract: '#6fb0a4',
    label: '#cfc3a4',
    labelHalo: '#0a151a',
    distance: '#5d7684',
    weatherRisk: '#6a8fae',
    theft: '#c2606a',
  },
  // Pale, like a printed board on a table.
  printed: {
    sea: '#b9c8c6',
    land: '#e7dcc0',
    coast: '#6d6046',
    graticule: '#a8b8b6',
    route: '#8a7f68',
    routeLive: '#a8342f',
    depot: '#3a3226',
    depotHome: '#a8342f',
    depotContract: '#2c6f66',
    label: '#2f2a20',
    labelHalo: '#dfe6e4',
    distance: '#7d7159',
    weatherRisk: '#3a6a8c',
    theft: '#8c2b26',
  },
};

/** Change this one word to reskin the entire board. */
export const CHART_STYLE: ChartStyleName = 'printed';

export const CHART = CHART_PALETTES[CHART_STYLE];

/** The chrome the chart sits in. */
/*
 * Every colour below is a CSS variable reference; the light and dark values live in styles.css and
 * lib/colorScheme.ts picks between them. Never append hex alpha (`${UI.bad}55`): add a token.
 */
export const UI = {
  ground: 'var(--ui-ground)',
  panel: 'var(--ui-panel)',
  panelRaised: 'var(--ui-panel-raised)',
  rule: 'var(--ui-rule)',
  ruleStrong: 'var(--ui-rule-strong)',

  text: 'var(--ui-text)',
  textSoft: 'var(--ui-text-soft)',
  textFaint: 'var(--ui-text-faint)',

  brass: 'var(--ui-brass)',
  verdigris: 'var(--ui-verdigris)',
  ensign: 'var(--ui-ensign)',

  /** Semantic, and separate from the accent hue above. */
  good: 'var(--ui-good)',
  warn: 'var(--ui-warn)',
  bad: 'var(--ui-bad)',

  /** Overlay backdrops, the hotseat privacy cover, and drop shadows. */
  scrim: 'var(--ui-scrim)',
  scrimLight: 'var(--ui-scrim-light)',
  cover: 'var(--ui-cover)',
  shadow: 'var(--ui-shadow)',
  /** Faint washes behind callouts. */
  tintVerdigris: 'var(--ui-tint-verdigris)',
  tintWarn: 'var(--ui-tint-warn)',
  tintBad: 'var(--ui-tint-bad)',
  tintBrass: 'var(--ui-tint-brass)',
  badRule: 'var(--ui-bad-rule)',
} as const;

export const FONT = {
  display: '"Superclarendon", "Rockwell", "Bookman Old Style", Georgia, serif',
  body: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
  data: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
} as const;

export const money = (n: number) => `£${n.toLocaleString('en-GB')}`;
