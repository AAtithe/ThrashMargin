/**
 * Thrash Margin's visual identity in one place.
 *
 * A war room, after dark or by daylight: charcoal or parchment ground, and one colour per resource
 * so the ledger reads at a glance (brass for gold, field green for food, slate violet for
 * materials). Faction colours live with the factions in shared/sim/content.ts so the map and the
 * sim agree, and are the same in both modes.
 *
 * Every value here is a CSS variable reference. The actual colours, one set per mode, are in
 * styles.css; lib/colorScheme.ts picks the mode. Because these are strings like `var(--ui-bad)`,
 * never append hex alpha to them (`${UI.bad}55`): add a token instead.
 */
export const UI = {
  ground: 'var(--ui-ground)',
  panel: 'var(--ui-panel)',
  panelRaised: 'var(--ui-panel-raised)',
  panelSunk: 'var(--ui-panel-sunk)',
  rule: 'var(--ui-rule)',
  ruleStrong: 'var(--ui-rule-strong)',

  text: 'var(--ui-text)',
  textSoft: 'var(--ui-text-soft)',
  textFaint: 'var(--ui-text-faint)',

  accent: 'var(--ui-accent)',
  accentInk: 'var(--ui-accent-ink)',

  gold: 'var(--ui-gold)',
  food: 'var(--ui-food)',
  mat: 'var(--ui-mat)',
  influence: 'var(--ui-influence)',
  pop: 'var(--ui-pop)',
  troops: 'var(--ui-troops)',
  ap: 'var(--ui-ap)',

  good: 'var(--ui-good)',
  warn: 'var(--ui-warn)',
  bad: 'var(--ui-bad)',
  move: 'var(--ui-move)',
  attack: 'var(--ui-attack)',
  annex: 'var(--ui-annex)',

  /** Tinted surfaces behind the coloured button tones, alerts and completed items. */
  dangerBg: 'var(--ui-danger-bg)',
  dangerText: 'var(--ui-danger-text)',
  moveBg: 'var(--ui-move-bg)',
  moveText: 'var(--ui-move-text)',
  attackBg: 'var(--ui-attack-bg)',
  attackText: 'var(--ui-attack-text)',
  goodBg: 'var(--ui-good-bg)',
  goodRule: 'var(--ui-good-rule)',
  accentBg: 'var(--ui-accent-bg)',
  scrim: 'var(--ui-scrim)',
  shadow: 'var(--ui-shadow)',
} as const;

export const FONT = {
  display: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
  body: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  data: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
} as const;

export const MAP = {
  sea: 'var(--map-sea)',
  seaDeep: 'var(--map-sea-deep)',
  land: 'var(--map-land)',
  coast: 'var(--map-coast)',
  label: 'var(--map-label)',
  labelHalo: 'var(--map-label-halo)',
  fog: 'var(--map-fog)',
  fogEdge: 'var(--map-fog-edge)',
  /** Unowned territory: its outline, its troop disc, and that disc's ring. */
  neutralEdge: 'var(--map-neutral-edge)',
  neutralFill: 'var(--map-neutral-fill)',
  neutralRing: 'var(--map-neutral-ring)',
  control: 'var(--map-control)',
  terrain: {
    plains: 'var(--map-terrain-plains)',
    forest: 'var(--map-terrain-forest)',
    mountain: 'var(--map-terrain-mountain)',
    coast: 'var(--map-terrain-coast)',
    desert: 'var(--map-terrain-desert)',
  } as Record<string, string>,
} as const;

/** Signed number for rates: +3, -2, 0. */
export const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
