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
export const UI = {
  ground: '#0d1419',
  panel: '#141e25',
  panelRaised: '#1b272f',
  rule: '#26343d',
  ruleStrong: '#3a4b56',

  text: '#e6ddc9',
  textSoft: '#93a3ad',
  textFaint: '#63737d',

  brass: '#d09a4e',
  verdigris: '#6fb0a4',
  ensign: '#c2606a',

  /** Semantic, and separate from the accent hue above. */
  good: '#7fb069',
  warn: '#d9a441',
  bad: '#c2606a',
} as const;

export const FONT = {
  display: '"Superclarendon", "Rockwell", "Bookman Old Style", Georgia, serif',
  body: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
  data: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
} as const;

export const money = (n: number) => `£${n.toLocaleString('en-GB')}`;
