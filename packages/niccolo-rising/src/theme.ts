/**
 * Niccolò Rising's palette: Banco di Niccolò's chrome (itself Tea Race's), duplicated on purpose so
 * the portal reads as one place. Cross-package imports do not survive Vercel's file tracing.
 * There is no chart in this game, so only the chrome is carried over.
 */
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

/** One colour per bar, so a glance at the rail reads without labels. */
export const BAR_COLOURS = {
  energy: 'var(--bar-energy)',
  nerve: 'var(--bar-nerve)',
  spirits: 'var(--bar-spirits)',
  health: 'var(--bar-health)',
} as const;

export const FONT = {
  display: '"Superclarendon", "Rockwell", "Bookman Old Style", Georgia, serif',
  body: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
  data: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
} as const;
