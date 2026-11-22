import { ManualSection as Section, bodySmall } from '../components/ui';
import {
  BUILDINGS,
  BUNKER_DAMAGE,
  BUNKER_SLOTS,
  CACHE_CAPTURE_TICKS,
  CACHE_PLACE_RANGE,
  CACHE_RADIUS,
  INTEL_RADIUS,
  STRUCTURE_LEVELS,
  TICKS_PER_SECOND,
  UPGRADE_DAMAGE_TAKEN,
  type BuildingKind,
} from '../sim/rules';

/** Round 7 (fireline-round7-structures.md): How to play's section on structure upgrades and strategic structures, every number from rules.ts. */
export function StructuresHelp() {
  const kinds = Object.keys(STRUCTURE_LEVELS) as BuildingKind[];
  return (
    <Section title="Upgrades and strategic structures">
      <ul style={{ ...bodySmall, margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <li>
          With <strong>Structure upgrades</strong> on (advanced tech), select one of your structures and press <strong>Upgrade</strong>.
          These can rise a level: {kinds.map(k => BUILDINGS[k].name).join(', ')}. The work is paid at once and takes time (half speed
          short of power); it keeps working at its old level meanwhile but takes {Math.round((UPGRADE_DAMAGE_TAKEN - 1) * 100)}% more
          damage, and a cancel pays everything back. Each level is a choice against building another: an upgrade needs no ground, crew or
          (mostly) power, but puts more of your strength in one place. The stat cards give every level.
        </li>
        <li>
          With <strong>Strategic structures</strong> on: a <strong>Fortified Bunker</strong> holds {BUNKER_SLOTS} infantry (select them and
          right-click it). Inside they are safe from artillery, bombs and splash and fire out at {Math.round(BUNKER_DAMAGE * 100)}% strength,
          but they cannot be sent anywhere until you unload them, and if it falls they come out hurt.
        </li>
        <li>
          A <strong>Supply Cache</strong> mends your infantry and vehicles within {CACHE_RADIUS} tiles, and can be set down within{' '}
          {CACHE_PLACE_RANGE} tiles of any of your troops, far from home. Enemy infantry beside it with none of yours there take it in{' '}
          {Math.round(CACHE_CAPTURE_TICKS / TICKS_PER_SECOND)} seconds.
        </li>
        <li>
          An <strong>Intelligence Centre</strong>, while powered, shows every enemy&apos;s research and production in an Intelligence panel,
          reveals enemy structures within {INTEL_RADIUS} tiles, and sees through their Decoys there. It is dear and draws heavy power.
        </li>
        <li>
          A <strong>Decoy</strong> passes, to the enemy, for any 2 by 2 structure you choose. The computer aims barrages, missiles, bombers
          and artillery by what it sees, so a Decoy can pull a strike off the real thing. It is worth nothing and keeps no side in the battle.
        </li>
      </ul>
    </Section>
  );
}
