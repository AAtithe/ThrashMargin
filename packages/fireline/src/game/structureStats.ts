import {
  BUNKER_DAMAGE,
  BUNKER_RANGE,
  BUNKER_SLOTS,
  CACHE_CAPTURE_TICKS,
  CACHE_HEAL,
  CACHE_MAX,
  CACHE_PLACE_RANGE,
  CACHE_RADIUS,
  CACHE_REPAIR,
  CACHE_TICKS,
  INTEL_RADIUS,
  STRUCTURE_LEVELS,
  TICKS_PER_SECOND,
  UPGRADE_DAMAGE_TAKEN,
  type BuildingKind,
  type UnitKind,
} from '../sim/rules';
import type { StatRow } from './Sidebar';
import type { GameState } from '../sim/types';
import { upgradesOn } from '../sim/structures';

/**
 * Round 7 (fireline-round7-structures.md): the stat card rows for the four strategic structures and
 * for a structure's levels, every number read from rules.ts.
 */
const secs = (ticks: number) => `${+(ticks / TICKS_PER_SECOND).toFixed(1)}s`;

/** `state` given: the levels only when that battle has structure upgrades on. */
export function structureStatRows(kind: BuildingKind | UnitKind, state?: GameState): StatRow[] {
  const rows: StatRow[] = [];
  const levels = !state || upgradesOn(state) ? STRUCTURE_LEVELS[kind as BuildingKind] : undefined;
  if (levels)
    levels.forEach((lv, i) =>
      rows.push({ label: `Level ${i + 2}`, value: `${lv.name}: ${lv.blurb}. ${lv.cost} credits, ${secs(lv.ticks)}; ${Math.round((UPGRADE_DAMAGE_TAKEN - 1) * 100)}% more damage taken while it works` }),
    );
  if (kind === 'bunker') {
    rows.push({ label: 'Garrison', value: `Up to ${BUNKER_SLOTS} infantry; safe from artillery, bombs and splash while it stands` });
    rows.push({ label: 'Fires', value: `Each soldier inside at ${Math.round(BUNKER_DAMAGE * 100)}% of its damage, ${BUNKER_RANGE} tile further from the Bunker's centre` });
    rows.push({ label: 'Cost of it', value: 'Those inside go nowhere until unloaded; if it falls they come out at half their health' });
  }
  if (kind === 'supplycache') {
    rows.push({ label: 'Mends', value: `Your infantry ${CACHE_HEAL} hp and vehicles ${CACHE_REPAIR} hp every ${secs(CACHE_TICKS)}, within ${CACHE_RADIUS} tiles` });
    rows.push({ label: 'Placed', value: `Near your base, or within ${CACHE_PLACE_RANGE} tiles of any of your ground troops; at most ${CACHE_MAX}` });
    rows.push({ label: 'Taken', value: `By enemy infantry beside it with none of yours there, in ${secs(CACHE_CAPTURE_TICKS)}` });
    rows.push({ label: 'Note', value: 'Keeps no side in the battle and extends no base.' });
  }
  if (kind === 'intelcentre') {
    rows.push({ label: 'Shows', value: "Every enemy's research and production queues, while powered" });
    rows.push({ label: 'Reveals', value: `Enemy structures within ${INTEL_RADIUS} tiles, and sees through their Decoys there` });
  }
  if (kind === 'decoy') {
    rows.push({ label: 'Passes for', value: 'Any 2×2 structure you choose, to the enemy: their strikes, bombers and guns treat it as one' });
    rows.push({ label: 'Note', value: 'Worth nothing: keeps no side in the battle, extends no base, sends out no crew.' });
  }
  return rows;
}
