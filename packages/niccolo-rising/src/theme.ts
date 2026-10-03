/**
 * Niccolò Rising's palette: Banco di Niccolò's chrome (itself Tea Race's), duplicated on purpose so
 * the portal reads as one place. Cross-package imports do not survive Vercel's file tracing.
 * There is no chart in this game, so only the chrome is carried over.
 */
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

  good: '#7fb069',
  warn: '#d9a441',
  bad: '#c2606a',
} as const;

/** One colour per bar, so a glance at the rail reads without labels. */
export const BAR_COLOURS = {
  energy: '#7fb069',
  nerve: '#c2606a',
  spirits: '#d9a441',
  health: '#6fb0a4',
} as const;

export const FONT = {
  display: '"Superclarendon", "Rockwell", "Bookman Old Style", Georgia, serif',
  body: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
  data: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
} as const;
