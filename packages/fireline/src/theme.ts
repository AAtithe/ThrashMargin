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
  /** Each side's colour in the chrome (names, scoreboard rows), indexed by Owner. */
  side: ['var(--ui-side-0)', 'var(--ui-side-1)', 'var(--ui-side-2)', 'var(--ui-side-3)'] as const,
};

/**
 * War for the Planet (fireline-planet-design.md, section 17): the planet map's and the war
 * screens' colour tokens. Values in styles.css, one block per mode; canvas code reads them with
 * getComputedStyle (game/planetArt.ts), so the map follows the theme too. `faction` is indexed by
 * FactionId; --pl-f0 matches --ui-team.
 */
export const PL = {
  sea: 'var(--pl-sea)',
  seaDeep: 'var(--pl-sea-deep)',
  landNeutral: 'var(--pl-land-neutral)',
  border: 'var(--pl-border)',
  borderStrong: 'var(--pl-border-strong)',
  faction: ['var(--pl-f0)', 'var(--pl-f1)', 'var(--pl-f2)', 'var(--pl-f3)', 'var(--pl-f4)'] as const,
  route: 'var(--pl-route)',
  routeBlocked: 'var(--pl-route-blocked)',
  select: 'var(--pl-select)',
  cut: 'var(--pl-cut)',
  city: 'var(--pl-city)',
  capital: 'var(--pl-capital)',
  label: 'var(--pl-label)',
  name: 'var(--pl-name)',
  halo: 'var(--pl-halo)',
  war: 'var(--pl-war)',
  ceasefire: 'var(--pl-ceasefire)',
  trade: 'var(--pl-trade)',
  alliance: 'var(--pl-alliance)',
  trustTrack: 'var(--pl-trust-track)',
  trustFill: 'var(--pl-trust-fill)',
};

export const FONT = {
  display: '"Bahnschrift", "DIN Alternate", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif',
  body: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

/**
 * Team colours on the battlefield, indexed by Owner: canvas paint, the same in both modes like the
 * rest of ART (the chrome's own side colours are the --ui-side-N tokens in styles.css, UI.side).
 * `mark` is the emblem painted on every unit and structure, so sides read apart without colour.
 * Sides 2 and 3 exist for battles of three or four sides.
 */
export const TEAM = {
  0: { main: '#3b7ddd', dark: '#1d4683', light: '#9cc8ff', name: 'Meridian Corps', mark: 'diamond' },
  1: { main: '#d4443a', dark: '#7a1d17', light: '#ffab9c', name: 'Ashen Combine', mark: 'triangle' },
  2: { main: '#3f9d4a', dark: '#1d5124', light: '#a8e6a0', name: 'Verdant Front', mark: 'circle' },
  3: { main: '#d99a1e', dark: '#7a5208', light: '#ffd98a', name: 'Ochre Legion', mark: 'square' },
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
