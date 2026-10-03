/**
 * Thrash Margin's visual identity in one place.
 *
 * A war room after dark: charcoal ground, parchment text, and one colour per resource so the
 * ledger reads at a glance (brass for gold, field green for food, slate violet for materials).
 * Faction colours live with the factions in shared/sim/content.ts so the map and the sim agree.
 */
export const UI = {
  ground: '#0e1115',
  panel: '#151a20',
  panelRaised: '#1c232b',
  panelSunk: '#11151a',
  rule: '#28313b',
  ruleStrong: '#3a4653',

  text: '#ebe5d6',
  textSoft: '#a7afb9',
  textFaint: '#6e7782',

  accent: '#e3c27a',
  accentInk: '#1a1408',

  gold: '#d9a64a',
  food: '#82b366',
  mat: '#a891d9',
  influence: '#d97f9f',
  pop: '#6fb2c6',
  troops: '#e8dcc0',
  ap: '#e3c27a',

  good: '#7fb069',
  warn: '#d9a441',
  bad: '#d0605a',
  move: '#5cc0b0',
  attack: '#e07a4f',
  annex: '#d97f9f',
} as const;

export const FONT = {
  display: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
  body: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  data: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
} as const;

export const MAP = {
  sea: '#0b1420',
  seaDeep: '#070c14',
  land: '#1a1f24',
  coast: '#6f8fa3',
  label: '#e9e2cf',
  labelHalo: '#0b0f14',
  fog: '#141a21',
  fogEdge: '#232b35',
  terrain: {
    plains: '#4a4d45',
    forest: '#2f4a33',
    mountain: '#5a5650',
    coast: '#36586a',
    desert: '#7a6640',
  } as Record<string, string>,
} as const;

/** Signed number for rates: +3, -2, 0. */
export const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
