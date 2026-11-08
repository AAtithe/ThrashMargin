/**
 * Fireline's visual identity.
 *
 * UI colours are CSS variables (values in styles.css, one block per mode), so the chrome follows
 * the portal's light or dark choice. ART is the battlefield's own palette: canvas paint, the same
 * in both modes, like a printed map is the same whatever the room's lighting.
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
  accent: 'var(--ui-accent)',
  info: 'var(--ui-info)',
  good: 'var(--ui-good)',
  warn: 'var(--ui-warn)',
  bad: 'var(--ui-bad)',
  scrim: 'var(--ui-scrim)',
  shadow: 'var(--ui-shadow)',
  tintAccent: 'var(--ui-tint-accent)',
  tintBad: 'var(--ui-tint-bad)',
  tintGood: 'var(--ui-tint-good)',
  hud: 'var(--ui-hud)',
  team: 'var(--ui-team)',
  enemy: 'var(--ui-enemy)',
};

export const FONT = {
  display: '"Bahnschrift", "DIN Alternate", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif',
  body: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

/** Team colours on the battlefield. */
export const TEAM = {
  0: { main: '#3b7ddd', dark: '#1d4683', light: '#9cc8ff', name: 'Meridian Corps' },
  1: { main: '#d4443a', dark: '#7a1d17', light: '#ffab9c', name: 'Ashen Combine' },
} as const;

export const ART = {
  grass: ['#4d6a32', '#526f35', '#48632e', '#557336'],
  grassDark: '#3d5527',
  grassLight: '#6a8a45',
  dirt: ['#7b6446', '#81694a', '#74603f'],
  dirtDark: '#5f4c33',
  dirtLight: '#9a8460',
  sand: '#b9a277',
  water: '#2b5a73',
  waterDeep: '#1e4459',
  waterLight: '#5d93ad',
  rock: '#77746c',
  rockDark: '#4d4a44',
  rockLight: '#a6a298',
  treeDark: '#24411f',
  tree: '#2f5a28',
  treeLight: '#4d7d3a',
  ore: '#d9b23a',
  oreGlow: '#fff1a8',
  oreDark: '#8a6a18',
  oreGround: 'rgba(150, 120, 40, 0.35)',
  concrete: '#8b8f8c',
  concreteDark: '#5d625f',
  concreteLight: '#b5b9b4',
  metal: '#6e767a',
  metalDark: '#3f4548',
  shadow: 'rgba(0, 0, 0, 0.32)',
  hazard: '#e3b12c',
  select: '#7dff8a',
  selectEnemy: '#ff7d6e',
  hpGood: '#5fd068',
  hpMid: '#e8c440',
  hpBad: '#e8503f',
  fog: [6, 9, 10] as [number, number, number],
};

export const money = (n: number) => `${Math.floor(n).toLocaleString('en-GB')}`;
