/**
 * Fireline Grand War: the guided first battle in a Frontier war, played in a real browser. The same
 * driver as fireline.cjs (every check it makes holds here), begun from the lobby's Grand War panel,
 * with the war's two steps walked as a person would: the gauge read, then the panel opened, a
 * ceasefire proposed on Diplomacy and the panel closed. The step waits on the proposal, never on the
 * answer (which depends on how strong both sides have grown, and so on timing). The card must hide
 * while the panel is open and return on the same step. The save must show the proposal was made.
 *
 *   npm run tours -- fireline-grand
 */
process.env.TOUR_GRAND = '1';
require('./fireline.cjs');
