/**
 * Banco di Niccolò's visual identity, in one place.
 *
 * Ported deliberately from `packages/tea-race/src/theme.ts` (same values, duplicated on purpose —
 * see the portal integration note in the Tea Race project memory: cross-package imports don't
 * survive Vercel's file tracing) so the two games read as one portal rather than two separate
 * projects. Before this file existed, every one of Niccolò's ~25 components hardcoded its own hex
 * colours; this replaces all of them.
 *
 * `GEO` is the one addition Tea Race doesn't need: Niccolò's chart is a real-geography backdrop
 * with hachured land, rivers and relief (`sim/geography.ts`), where Tea Race's is a flat filled
 * landmass. Its tones are derived from the shared `CHART` palette rather than invented separately,
 * so a future palette swap (the one word in `CHART_STYLE`) still reskins the whole map.
 */

export type ChartStyleName = 'engraver' | 'printed';

export interface ChartPalette {
  sea: string;
  land: string;
  coast: string;
  graticule: string;
  equator: string;
  /** A route nobody is currently sailing. */
  route: string;
  /** The leg a selected vessel is running. */
  routeLive: string;
  port: string;
  portHome: string;
  /** A port named by one of the five face-up commissions (Tea Race only; unused here, kept for
   * parity so both games' palettes stay structurally identical). */
  portContract: string;
  label: string;
  labelHalo: string;
  distance: string;
  windFair: string;
  windFoul: string;
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

/** Change this one word to reskin the entire chart. Kept in step with Tea Race's own choice. */
export const CHART_STYLE: ChartStyleName = 'printed';

export const CHART = CHART_PALETTES[CHART_STYLE];

/**
 * Geography-specific tones, derived from `CHART` rather than authored separately, so a future
 * `CHART_STYLE` flip reskins the hachured backdrop along with everything else.
 */
export const GEO = {
  /** Ground fill under the hachure pattern. */
  landGround: CHART.land,
  /** The hachure strokes themselves and the coastline ink. */
  hatch: CHART.coast,
  /** River ink. */
  water: CHART.route,
  /** Mountain relief strokes. */
  relief: CHART.distance,
  /** Beyond the sheet's edge — only ever visible for a stray frame, since the sea rect is drawn
   * oversized specifically to cover it (see MapView's own note on this). Matched to `sea` rather
   * than a separate colour so that stray frame is invisible rather than a flash of mismatched tone. */
  void: CHART.sea,
} as const;

/** The chrome the chart sits in — identical to Tea Race's, which is the point. */
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
