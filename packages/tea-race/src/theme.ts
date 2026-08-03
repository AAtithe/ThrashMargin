/**
 * The Tea Race's visual identity, in one place.
 *
 * Two chart treatments were mocked up and shown before any of this was built (the lesson this repo
 * has now learned three times over on Niccolo's map: prototype a look, get a reaction, then write
 * the code). Both are kept here and `CHART_STYLE` picks between them — switching the whole board
 * is one word, so neither direction is wasted work.
 *
 * The surrounding UI palette is deliberately NOT a third scheme. It is the ship's-log chrome the
 * chart sits inside: dark slate ground, brass and verdigris for the two things that matter most
 * (money and the sea), warm paper for text. Slab serif for display, because a 19th-century
 * shipping notice is exactly what a commission card is.
 */

export type ChartStyleName = 'engraver' | 'printed';

export interface ChartPalette {
  sea: string;
  land: string;
  coast: string;
  graticule: string;
  equator: string;
  /** A sea leg nobody is currently sailing. */
  route: string;
  /** The leg a selected ship is running. */
  routeLive: string;
  port: string;
  portHome: string;
  /** A port named by one of the five face-up commissions. */
  portContract: string;
  label: string;
  labelHalo: string;
  distance: string;
  /** A leg whose prevailing wind is fair this season. */
  windFair: string;
  /** A leg that has to be beaten against. */
  windFoul: string;
  /** Waters that carry a piracy rating. */
  piracy: string;
}

export const CHART_PALETTES: Record<ChartStyleName, ChartPalette> = {
  // Dark, high-contrast, bone coastline on near-black water.
  engraver: {
    sea: '#0a151a',
    land: '#16242b',
    coast: '#e2d3ae',
    graticule: '#1f3540',
    equator: '#2c4a58',
    route: '#3f5f6b',
    routeLive: '#d98f3c',
    port: '#e8d9b4',
    portHome: '#d98f3c',
    portContract: '#6fb0a4',
    label: '#cfc3a4',
    labelHalo: '#0a151a',
    distance: '#5d7684',
    windFair: '#7fb069',
    windFoul: '#c2606a',
    piracy: '#c2606a',
  },
  // Pale, like a printed board on a table.
  printed: {
    sea: '#b9c8c6',
    land: '#e7dcc0',
    coast: '#6d6046',
    graticule: '#a8b8b6',
    equator: '#8b9c99',
    route: '#8a7f68',
    routeLive: '#a8342f',
    port: '#3a3226',
    portHome: '#a8342f',
    portContract: '#2c6f66',
    label: '#2f2a20',
    labelHalo: '#dfe6e4',
    distance: '#7d7159',
    windFair: '#2f6b3a',
    windFoul: '#a8342f',
    piracy: '#8c2b26',
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
